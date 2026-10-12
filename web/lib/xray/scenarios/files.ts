import { NOTES_FILE, NOTES_TXT, isCached, withCached } from "../apps";
import { dataFrame, nvmeCompletion, nvmeRead } from "../structs";
import type { MachineState, NodeId, Scenario, Step } from "../types";
import { clickStep, drawStep, keysStep } from "./common";

// Reading a file, from open() to the bytes in a program's buffer. The page
// cache decides everything: a hit copies from RAM, a miss goes all the way
// down to the SSD and back. Both cat in the terminal and the text editor use
// the same kernel path.

/** notes.txt's size: its lines, each ending in a newline. */
const FILE_BYTES = new TextEncoder().encode(`${NOTES_TXT.join("\n")}\n`).length;
const bytes = (text: string) => new TextEncoder().encode(text).length;

interface Reader {
  node: NodeId;
  /** Name used in sentences, e.g. "cat" or "The editor". */
  name: string;
  /** How the program names the file. */
  path: string;
  walk: string;
  fd: string;
}

function readSteps(reader: Reader, m: MachineState, file: string): Step[] {
  const cached = isCached(m, file);
  const Name = reader.name.charAt(0).toUpperCase() + reader.name.slice(1);
  const steps: Step[] = [
    {
      id: "openat",
      phase: "file",
      path: [reader.node, "syscall", "vfs"],
      title: `openat("${reader.path}")`,
      body: `${Name} asks the kernel to open the file for reading. The syscall instruction switches the CPU to kernel mode, and the VFS takes over.`,
      code: [{ project: "linux", path: "fs/open.c", symbol: "do_sys_openat2" }],
      timescale: "us",
      data: { amount: `${bytes(reader.path) + 1} bytes`, what: `the path, "${reader.path}" and its '\\0', copied from ${reader.name}'s memory into the kernel` },
      aws: {
        service: "AWS IAM",
        text: "A system call is like an AWS API call: the program cannot touch the hardware, so it asks a privileged service that checks who is asking before acting. IAM checks policies on every request; the kernel checks the file's owner and mode before it hands out the file.",
      },
    },
    {
      id: "path-walk",
      phase: "file",
      path: ["vfs"],
      title: "Walking the path",
      body: `${reader.walk} Each name is looked up in the dentry cache, a table of recently used names in RAM, so resolving a path rarely needs the disk. Then the VFS checks that you may read the file.`,
      code: [
        { project: "linux", path: "fs/namei.c", symbol: "link_path_walk" },
        { project: "linux", path: "fs/dcache.c", symbol: "__d_lookup_rcu" },
      ],
      timescale: "ns",
      data: {
        amount: `${reader.path.split("/").filter(Boolean).length} ${reader.path.split("/").filter(Boolean).length === 1 ? "name" : "names"}`,
        what: `looked up one at a time in the dentry cache: ${reader.path.split("/").filter(Boolean).join(", then ")}`,
      },
      aws: {
        service: "Amazon S3",
        text: "S3 has no directories to walk: a key like notes/2026/today.txt is a single name, found in one lookup, and its slashes are only characters. A Linux path is walked a directory at a time, which is why the dentry cache keeps recent names in RAM.",
      },
    },
    {
      id: "fd",
      phase: "file",
      mode: "deep",
      path: ["vfs", "proc"],
      title: "A file descriptor",
      body: `The kernel creates a struct file, an open file whose position starts at 0, and installs it in ${reader.name}'s file table at ${reader.fd}. openat() returns that number, and every later call uses it.`,
      code: [
        { project: "linux", path: "fs/file.c", symbol: "alloc_fd" },
        { project: "linux", path: "fs/file.c", symbol: "fd_install" },
      ],
      timescale: "ns",
      data: { amount: "4 bytes", what: "the file descriptor, an int: the index of the open file in the process's table" },
    },
    {
      id: "read",
      phase: "file",
      path: [reader.node, "syscall", "vfs", "pagecache"],
      title: "read(): ask the page cache",
      body: "read() goes through vfs_read() and ext4's read function to filemap_read(), which looks for the file's first page in the page cache: the pages of this file already in RAM, indexed by their position in the file.",
      code: [
        { project: "linux", path: "fs/read_write.c", symbol: "ksys_read" },
        { project: "linux", path: "fs/ext4/file.c", symbol: "ext4_file_read_iter" },
        { project: "linux", path: "mm/filemap.c", symbol: "filemap_read" },
      ],
      timescale: "ns",
      data: { amount: `${FILE_BYTES} bytes`, what: "the whole file, inside the first 4 KiB page: the page cache always works in whole pages" },
    },
    cached
      ? {
          id: "cache-hit",
          phase: "cache",
          cache: "hit",
          path: ["pagecache"],
          title: "Page cache hit",
          body: "The page is already in RAM from the last read. No filesystem lookup, no SSD, no interrupt and no waiting: the kernel can copy the data straight away.",
          code: [{ project: "linux", path: "mm/filemap.c", symbol: "filemap_get_pages" }],
          timescale: "ns",
          data: { amount: "0 bytes from the SSD", what: "the 4 KiB page is already in RAM" },
          aws: {
            service: "Amazon CloudFront",
            text: "This is CloudFront's \"Hit from cloudfront\": the edge location already holds the object and answers without asking the origin. The page cache is the same idea one level down, RAM in front of the SSD.",
          },
        }
      : {
          id: "cache-miss",
          phase: "cache",
          cache: "miss",
          path: ["pagecache"],
          title: "Page cache miss",
          body: "Not in RAM: nothing has read this file since the computer started, or since the cache was dropped. The kernel allocates a page, adds it to the cache locked and empty, and starts a read from the SSD. For a bigger file, readahead would ask for the next pages too, betting you'll read on.",
          code: [
            { project: "linux", path: "mm/filemap.c", symbol: "filemap_get_pages" },
            { project: "linux", path: "mm/readahead.c", symbol: "page_cache_sync_ra" },
          ],
          timescale: "ns",
          data: { amount: "4 KiB", what: "a page of RAM, added to the cache locked and empty, for the SSD to fill" },
          aws: {
            service: "Amazon CloudFront",
            text: "This is CloudFront's \"Miss from cloudfront\": the edge forwards the request to the origin, waits, and keeps a copy for the next viewer, as the kernel keeps this page for the next read.",
          },
        },
  ];

  if (!cached) {
    steps.push(
      {
        id: "ext4",
        phase: "disk",
        path: ["pagecache", "ext4"],
        title: "ext4 finds the block",
        body: "ext4's read code asks ext4_map_blocks() where the file's first block lives on the SSD. The answer comes from the file's extent tree, usually already in memory.",
        code: [
          { project: "linux", path: "fs/ext4/readpage.c", symbol: "ext4_mpage_readpages" },
          { project: "linux", path: "fs/ext4/inode.c", symbol: "ext4_map_blocks" },
        ],
        timescale: "us",
        data: { amount: "1 block", what: "of 4 KiB, ext4's usual block size: where the file's first bytes are on the SSD" },
      },
      {
        id: "bio",
        phase: "disk",
        path: ["ext4", "block"],
        title: "A bio for the block layer",
        body: "ext4 builds a bio, a request that says: read these sectors into this page. submit_bio() hands it to the block layer, which turns it into a request on one of the SSD's hardware queues (blk-mq).",
        code: [
          { project: "linux", path: "block/blk-core.c", symbol: "submit_bio" },
          { project: "linux", path: "block/blk-mq.c", symbol: "blk_mq_submit_bio" },
        ],
        timescale: "us",
        data: { amount: "8 sectors", what: "of 512 bytes, the block layer's unit: one 4 KiB page to read" },
      },
      {
        id: "nvme-cmd",
        phase: "disk",
        path: ["block", "nvme", "ram"],
        frames: [dataFrame(1, "NVMe command", "A read command for the SSD", nvmeRead)],
        title: "The NVMe driver writes a command",
        body: "The driver fills in a 64-byte read command (which blocks to read, and the physical address of the page to fill) and puts it in a submission queue, a ring of commands in RAM.",
        code: [
          { project: "linux", path: "drivers/nvme/host/pci.c", symbol: "nvme_queue_rq" },
          { project: "linux", path: "drivers/nvme/host/core.c", symbol: "nvme_setup_rw" },
        ],
        timescale: "us",
        aws: {
          service: "Amazon EBS on Nitro",
          text: "On Nitro-based EC2 instances, EBS volumes appear as NVMe devices (/dev/nvme0n1): the guest's driver writes these same 64-byte commands, and the Nitro card carries them over the network to the EBS volume instead of to flash on the board.",
        },
      },
      {
        id: "doorbell",
        phase: "disk",
        path: ["nvme", "ssd"],
        frames: [dataFrame(0, "NVMe command", "Waiting in the submission queue", nvmeRead)],
        title: "Ring the doorbell",
        body: "The driver writes the queue's new tail position to the SSD's doorbell register, an address on the PCIe device mapped into memory. That single write tells the SSD there is work.",
        code: [{ project: "linux", path: "drivers/nvme/host/pci.c", symbol: "nvme_write_sq_db" }],
        timescale: "us",
        data: { amount: "4 bytes", what: "the queue's new tail index, one 32-bit write to the doorbell register over PCIe" },
      },
      {
        id: "sleep",
        phase: "disk",
        path: [reader.node, "sched"],
        title: `${Name} waits`,
        body: `${Name} can't go on without the data, so its thread sleeps until the page is unlocked, and the scheduler runs other work on the core in the meantime.`,
        code: [{ project: "linux", path: "kernel/sched/core.c", symbol: "schedule" }],
        timescale: "us",
        data: { amount: "0 CPU", what: "the waiting thread uses no CPU: the core runs other work" },
      },
      {
        id: "ssd-read",
        phase: "disk",
        path: ["ssd"],
        frames: [dataFrame(0, "NVMe command", "Fetched by the SSD", nvmeRead)],
        title: "Inside the SSD",
        body: "The SSD's controller fetches the command from RAM over PCIe, looks up where that block really lives in its flash (its translation layer) and reads the cells. Flash is fast, but much slower than RAM: this is the wait the page cache exists to skip.",
        timescale: "us",
        data: { amount: "4 KiB", what: "read from the flash cells, wherever the SSD's translation layer put the block" },
        aws: {
          service: "Amazon EC2 instance store",
          text: "Some EC2 instance types, such as the I and D families, have NVMe SSDs on the host itself: instance store. Reads take this same path, without a network in between, but the data is lost when the instance stops.",
        },
      },
      {
        id: "dma",
        phase: "disk",
        path: ["ssd", "ram"],
        title: "DMA into the page cache",
        learns: withCached(m, file),
        body: "The SSD writes the data straight into the page-cache page in RAM with DMA. The CPU doesn't copy a byte.",
        timescale: "us",
        data: { amount: "4 KiB", what: "written by the SSD straight into the page-cache page: the CPU copies nothing" },
        aws: {
          service: "AWS Nitro System",
          text: "Nitro cards take storage and networking work off an instance's CPUs: data reaches the instance's memory by DMA while its vCPUs run your code. The same division of labour as here, between the SSD and the CPU.",
        },
      },
      {
        id: "irq",
        phase: "disk",
        path: ["ssd", "irq", "nvme"],
        frames: [dataFrame(0, "NVMe completion", "Done: a completion entry", nvmeCompletion)],
        title: "Completion interrupt",
        body: "The SSD posts a 16-byte completion entry and raises an MSI-X interrupt. The NVMe driver's handler reads it and ends the request; the bio completes, and the page is marked up to date and unlocked.",
        code: [
          { project: "linux", path: "drivers/nvme/host/pci.c", symbol: "nvme_irq" },
          { project: "linux", path: "block/bio.c", symbol: "bio_endio" },
          { project: "linux", path: "mm/filemap.c", symbol: "folio_end_read" },
        ],
        timescale: "us",
      },
      {
        id: "wake",
        phase: "disk",
        path: ["nvme", "sched", reader.node],
        title: `${Name} wakes up`,
        body: "Unlocking the page wakes the sleeping thread. The scheduler puts it back on a core, and read() carries on where it stopped.",
        code: [{ project: "linux", path: "kernel/sched/core.c", symbol: "try_to_wake_up" }],
        timescale: "us",
      },
    );
  }

  steps.push({
    id: "copy",
    phase: "file",
    path: ["pagecache", "syscall", reader.node],
    title: "copy_to_user()",
    body: "filemap_read() copies the bytes from the page-cache page into the buffer the program passed, and read() returns how many it copied. The page stays in the cache for next time.",
    code: [
      { project: "linux", path: "mm/filemap.c", symbol: "filemap_read" },
      { project: "linux", path: "lib/iov_iter.c", symbol: "copy_page_to_iter" },
    ],
    timescale: "ns",
    data: { amount: `${FILE_BYTES} bytes`, what: `copied from the page cache into ${reader.name}'s buffer: the only copy the CPU makes` },
  });
  return steps;
}

function doneStep(m: MachineState, file: string): Step {
  const cached = isCached(m, file);
  return {
    id: "file-done",
    phase: "output",
    path: ["pagecache"],
    title: cached ? "Served from RAM" : "The file stays in RAM",
    body: cached
      ? "No ext4 lookup, no SSD, no interrupt and no sleeping: a page cache hit skips the whole storage stack. That is the whole reason the page cache exists."
      : "notes.txt is now in the page cache, in RAM nobody else needed. Read it again and the second read never reaches the SSD.",
    data: { amount: "4 KiB of RAM", what: "the file's page stays in the page cache until memory is needed for something else" },
    aws: {
      service: "Amazon ElastiCache",
      text: "Keeping hot data in RAM in front of slower storage is what ElastiCache does for a database: the first read pays for the trip, later ones are answered from memory. The page cache does it for every file, with no setup.",
    },
  };
}

// ---------------------------------------------------------------- cat

export function readFile(m: MachineState): Scenario {
  const steps: Step[] = [
    keysStep("key", "terminal", "You press Enter", "Terminal"),
    {
      id: "pty",
      phase: "input",
      path: ["terminal", "syscall", "tty", "bash"],
      title: "Through the pseudo-terminal",
      body: "The terminal writes the Enter key into its end of the pseudo-terminal. The kernel's TTY layer delivers it to bash, which reads it from /dev/pts/N as if from a real keyboard.",
      code: [
        { project: "linux", path: "drivers/tty/pty.c" },
        { project: "linux", path: "drivers/tty/tty_io.c" },
      ],
      timescale: "us",
      data: { amount: `${bytes("cat notes.txt\n")} bytes`, what: `"cat notes.txt\\n", out of the pseudo-terminal's other end to bash` },
    },
    {
      id: "fork-exec",
      phase: "launch",
      path: ["bash", "syscall", "proc", "cat"],
      title: "bash starts cat",
      body: "bash creates a child with clone(), and the child calls execve(\"/usr/bin/cat\"). cat inherits bash's open files, so its output (file descriptor 1) is the same pseudo-terminal.",
      code: [
        { project: "linux", path: "kernel/fork.c", symbol: "kernel_clone" },
        { project: "linux", path: "fs/exec.c", symbol: "do_execveat_common" },
      ],
      timescale: "us",
    },
    ...readSteps(
      {
        node: "cat",
        name: "cat",
        path: "notes.txt",
        walk: "The path is relative, so the VFS starts from cat's current directory, /home/you, and looks up one name: notes.txt.",
        fd: "the lowest free number, 3 (0, 1 and 2 are standard input, output and error)",
      },
      m,
      NOTES_FILE,
    ),
    {
      id: "write",
      phase: "output",
      path: ["cat", "syscall", "tty", "terminal"],
      title: "write() to the terminal",
      body: "cat writes the bytes to file descriptor 1. The TTY layer passes them through the pseudo-terminal to the terminal emulator, which draws the text.",
      code: [
        { project: "linux", path: "fs/read_write.c", symbol: "ksys_write" },
        { project: "linux", path: "drivers/tty/tty_io.c", symbol: "tty_write" },
      ],
      timescale: "us",
      ui: { terminalAppend: NOTES_TXT.map((text) => ({ kind: "output" as const, text })) },
      data: { amount: `${FILE_BYTES} bytes`, what: "the file's bytes, in one write() to the pseudo-terminal" },
    },
    {
      id: "exit",
      phase: "output",
      path: ["cat", "syscall", "proc", "bash"],
      title: "cat exits, bash takes over",
      body: "The next read() returns 0, end of file, so cat calls exit_group(). bash, waiting in wait4(), collects the exit status and prints a new prompt.",
      code: [{ project: "linux", path: "kernel/exit.c", symbol: "do_exit" }],
      timescale: "us",
      ui: { terminalBusy: false },
    },
    doneStep(m, NOTES_FILE),
  ];
  return { kind: "readFile", app: "terminal", title: "cat notes.txt", focus: "machine", steps };
}

// ---------------------------------------------------------------- editor

export function openFile(m: MachineState): Scenario {
  const steps: Step[] = [
    clickStep("click", "editor", "You open notes.txt", "the editor's window"),
    {
      id: "gio",
      phase: "file",
      mode: "deep",
      path: ["editor"],
      title: "GLib turns it into system calls",
      body: "The editor loads files through GLib's file API, which for a local file comes down to the same system calls cat uses: openat(), fstat() for the size, read() and close().",
      timescale: "us",
    },
    ...readSteps(
      {
        node: "editor",
        name: "the editor",
        path: NOTES_FILE,
        walk: "The VFS resolves the path one name at a time from the root: home, you, notes.txt.",
        fd: "the lowest free number (a graphical app already has many files open, such as its Wayland socket)",
      },
      m,
      NOTES_FILE,
    ),
    {
      id: "close",
      phase: "file",
      mode: "deep",
      path: ["editor", "syscall", "vfs"],
      title: "End of file, close()",
      body: "The next read() returns 0, end of file. close() drops the file descriptor and the struct file; the page stays in the page cache.",
      code: [{ project: "linux", path: "fs/open.c" }],
      timescale: "us",
    },
    drawStep(
      "show",
      "editor",
      "The text appears",
      "The editor lays out the text and draws its window with the GPU, then the compositor shows the new frame.",
      { editor: { file: NOTES_FILE, text: NOTES_TXT.join("\n"), loading: false } },
    ),
    doneStep(m, NOTES_FILE),
  ];
  return { kind: "openFile", app: "editor", title: "Opening notes.txt", focus: "split", steps };
}
