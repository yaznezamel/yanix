import { APPS, isCached, withCached } from "../apps";
import { dataFrame, elfHeader, programHeaders, vma } from "../structs";
import type { AppId, MachineState, NodeId, Scenario, Step } from "../types";
import { clickStep, drawStep } from "./common";

// Launching an app: clone() makes a process, execve() swaps in a new program,
// the kernel maps it instead of reading it, the dynamic linker brings in the
// shared libraries, and page faults load code on first touch. The window only
// appears when the app draws its first frame.

export const APP_NODE: Record<AppId, NodeId> = {
  browser: "browser",
  terminal: "terminal",
  editor: "editor",
  player: "player",
};

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function appSpecific(app: AppId): Step[] {
  switch (app) {
    case "browser":
      return [
        {
          id: "helpers",
          phase: "launch",
          path: ["browser", "proc", "netsvc", "renderer"],
          title: "Chromium starts its helper processes",
          body: "Chromium splits its work across processes: a network service, a GPU process and sandboxed renderers. On Linux, renderers are forked from a zygote process started early on, so each new one starts fast.",
          code: [{ project: "chromium", path: "content/zygote/" }],
          timescale: "ms",
        },
      ];
    case "terminal":
      return [
        {
          id: "pty",
          phase: "launch",
          path: ["terminal", "syscall", "tty", "bash"],
          title: "bash gets a pseudo-terminal",
          body: "The terminal opens /dev/ptmx to get a pseudo-terminal pair, starts bash with clone() and execve(), and gives bash the other end, /dev/pts/N, as its keyboard and screen.",
          code: [{ project: "linux", path: "drivers/tty/pty.c" }],
          timescale: "us",
        },
      ];
    default:
      return [];
  }
}

export function launch(app: AppId, m: MachineState): Scenario {
  const { name, program, libraries } = APPS[app];
  const node = APP_NODE[app];
  const file = basename(program);
  const cached = isCached(m, program);
  const programMaps = [
    vma(`${file} code`, "r-x", "the program file"),
    vma(`${file} data`, "rw-", "the program file, copied on write"),
    vma("ld-linux-x86-64.so.2", "r-x", "the dynamic linker's file"),
    vma("[stack]", "rw-", "anonymous memory: arguments, environment, auxiliary vector"),
  ];
  const libraryMaps = libraries.map((lib) => vma(lib, "r-x", "the library file, shared with every process using it"));

  const steps: Step[] = [
    clickStep("click", "shell", `You click ${name}`, `the ${name} icon`),
    {
      id: "clone",
      phase: "launch",
      path: ["shell", "syscall", "proc"],
      title: "clone(): a new process",
      body: "The shell asks the kernel for a new process. glibc's fork() and posix_spawn() are both built on the clone() family of system calls. The kernel creates a task_struct for the child, with a copy of the parent's open files and of its memory map.",
      code: [
        { project: "linux", path: "kernel/fork.c", symbol: "kernel_clone" },
        { project: "linux", path: "kernel/fork.c", symbol: "copy_process" },
        { project: "glibc", path: "sysdeps/unix/sysv/linux/spawni.c", symbol: "__spawni" },
      ],
      timescale: "us",
      data: { amount: "0 pages copied", what: "the child gets a copy of the parent's open files and memory map, not of its memory" },
      aws: {
        service: "Amazon EC2",
        text: "clone() is the EC2 console's \"Launch more like this\": a new instance set up like the one you started from, before anything runs on it. What it then runs is execve()'s choice, as it is the AMI's.",
      },
    },
    {
      id: "cow",
      phase: "memory",
      path: ["proc", "mm"],
      title: "Copy-on-write: no memory is copied",
      body: "The child's memory map is a copy, but the memory isn't: parent and child share the same physical pages, marked read-only, and a page is copied only when one of them writes to it. posix_spawn() goes further: the child borrows the parent's memory outright until it calls execve().",
      code: [
        { project: "linux", path: "kernel/fork.c", symbol: "dup_mm" },
        { project: "linux", path: "mm/memory.c", symbol: "copy_page_range" },
      ],
      timescale: "us",
      data: { amount: "0 bytes copied", what: "parent and child share every page read-only; a 4 KiB page is copied only when one of them writes to it" },
      aws: {
        service: "Amazon EBS snapshots",
        text: "EBS snapshots are incremental: a new snapshot shares every unchanged block with the one before and stores only what changed. Copy-on-write memory works the same way: parent and child share every page until one of them writes.",
      },
    },
    {
      id: "runqueue",
      phase: "launch",
      mode: "deep",
      path: ["proc", "sched"],
      title: "The scheduler picks it up",
      body: "wake_up_new_task() puts the new task on a run queue, and the scheduler soon gives it a CPU core.",
      code: [{ project: "linux", path: "kernel/sched/core.c", symbol: "wake_up_new_task" }],
      timescale: "us",
      aws: {
        service: "Amazon ECS",
        text: "Placing a new task on a core is ECS task placement in miniature: ECS applies a strategy (spread, binpack, random) to pick the instance for a new task; the Linux scheduler picks a CPU, preferring an idle one.",
      },
    },
    {
      id: "execve",
      phase: "launch",
      path: ["proc", "vfs"],
      frames: [dataFrame(0, "ELF header", `${file}: what kind of program?`, elfHeader(program), programHeaders)],
      title: `execve("${program}")`,
      body: `The child calls execve() with ${name}'s program file. The kernel opens it and reads its first bytes: the ELF header and program headers, which say how to load it. Then it throws away the old memory map. From here on the process belongs to the new program.`,
      code: [
        { project: "linux", path: "fs/exec.c", symbol: "do_execveat_common" },
        { project: "linux", path: "fs/binfmt_elf.c", symbol: "load_elf_binary" },
      ],
      timescale: "us",
      aws: {
        service: "Amazon EC2",
        text: "execve() is RunInstances with an AMI: the image says how to lay the machine out (the ELF program headers, like an AMI's block device mappings), and the kernel builds a fresh one from it.",
      },
    },
    {
      id: "map",
      phase: "memory",
      path: ["vfs", "mm"],
      frames: [dataFrame(1, "Memory map", `${file}'s new address space`, ...programMaps)],
      title: "Mapping, not loading",
      body: "load_elf_binary() builds a fresh address space: the program's code (read and execute) and data (read and write) are mapped from the file, the dynamic linker named in the INTERP header is mapped too, and a stack holds the arguments, the environment and the auxiliary vector. Base addresses are random (ASLR). Almost nothing has been read from disk yet.",
      code: [
        { project: "linux", path: "fs/binfmt_elf.c", symbol: "elf_load" },
        { project: "linux", path: "mm/mmap.c", symbol: "do_mmap" },
      ],
      timescale: "us",
      data: { amount: "0 bytes read", what: "the code and data are mapped from the file; their pages arrive on first touch" },
      aws: {
        service: "Amazon EBS",
        text: "Mapping is not loading, as attaching a volume restored from a snapshot is not downloading it: both are usable at once, and each page, or block, is fetched the first time it is touched.",
      },
    },
    {
      id: "interp",
      phase: "linking",
      path: ["mm", "syscall", "glibc"],
      title: "Two programs, not one",
      body: "execve() returns to user mode, but not in the program: execution starts in the dynamic linker, /lib64/ld-linux-x86-64.so.2, which finishes the loading in user space.",
      code: [{ project: "glibc", path: "elf/rtld.c", symbol: "_dl_start" }],
      timescale: "us",
    },
    {
      id: "libraries",
      phase: "linking",
      path: ["glibc", "syscall", "vfs", "mm"],
      frames: [
        dataFrame(0, "Memory map", "Before the libraries", ...programMaps),
        dataFrame(3, "Memory map", "Shared libraries mapped in", ...programMaps.slice(0, 3), ...libraryMaps, programMaps[3]!),
      ],
      title: "ld.so maps the shared libraries",
      body: `The dynamic linker reads the list of libraries the program needs, such as ${libraries.join(", ")}, finds each one through /etc/ld.so.cache, opens it and maps it with mmap(). Libraries other programs use are already in the page cache, and their code pages are shared between processes, not copied.`,
      code: [
        { project: "glibc", path: "elf/dl-load.c", symbol: "_dl_map_object" },
        { project: "glibc", path: "elf/dl-cache.c", symbol: "_dl_load_cache_lookup" },
      ],
      timescale: "us",
      data: { amount: `${libraries.length}+ libraries`, what: "mapped, not copied: their code pages in the page cache are shared by every process that uses them" },
      aws: {
        service: "AWS Lambda layers",
        text: "A library is published once and used by many programs, as a Lambda layer is published once and attached to many functions. Here even the RAM is shared: one copy of each library's code for every process.",
      },
    },
    {
      id: "relocate",
      phase: "linking",
      path: ["glibc", node],
      title: "Relocations, then main()",
      body: "Every library landed at a random address, so ld.so fills tables of pointers (the GOT) with the real addresses of the functions and data the program uses, then makes those tables read-only. It runs each library's initialisers and jumps to the program's entry point, which calls __libc_start_main() and finally main().",
      code: [
        { project: "glibc", path: "elf/dl-reloc.c", symbol: "_dl_relocate_object" },
        { project: "glibc", path: "csu/libc-start.c", symbol: "__libc_start_main" },
      ],
      timescale: "us",
      data: { amount: "8 bytes per entry", what: "each GOT entry the linker fills is a 64-bit address; then the table is made read-only (RELRO)" },
      aws: {
        service: "AWS Cloud Map",
        text: "Relocation is service discovery for code: the program asks for printf() by name, and ld.so fills in where it landed this run, as Cloud Map resolves a service's name to the addresses its instances have now.",
      },
    },
    {
      id: "page-faults",
      phase: "memory",
      cache: cached ? "hit" : "miss",
      path: cached
        ? [node, "mm", "pagecache"]
        : [node, "mm", "pagecache", "ext4", "block", "nvme", "ssd", "ram"],
      learns: withCached(m, program),
      title: cached ? "Page faults, served from RAM" : "Page faults that wait for the SSD",
      body: cached
        ? `main() runs code that is mapped but not in the page tables yet. Each first touch of a page raises a page fault: the kernel finds the page in the page cache (${name} ran before) and maps it in. These are minor faults: no disk at all, which is why a second launch is quick.`
        : `main() runs code that is mapped but not in the page tables yet. Each first touch of a page raises a page fault. The libraries are in the page cache already, but ${name}'s own code isn't, so those faults are major faults: they wait for the SSD, by the same path as reading a file. That is why the first launch is the slowest.`,
      code: [
        { project: "linux", path: "arch/x86/mm/fault.c", symbol: "exc_page_fault" },
        { project: "linux", path: "mm/memory.c", symbol: "handle_mm_fault" },
        { project: "linux", path: "mm/filemap.c", symbol: "filemap_fault" },
      ],
      timescale: "us",
      data: cached
        ? { amount: "4 KiB per fault", what: "minor faults: each maps a page that is already in the page cache, with no disk" }
        : { amount: "4 KiB per fault", what: "major faults: each waits for the SSD to read the page, then maps it" },
      aws: {
        service: "Amazon EBS",
        text: cached
          ? "Minor faults are reads of an EBS volume whose blocks are already initialized: no extra trip, full speed. This launch pays almost nothing for the program's code."
          : "Major faults are the first read of each block of a volume restored from a snapshot: slow once, fast after. That is why a first launch is slow and a second one is quick.",
      },
    },
    {
      id: "tlb",
      phase: "memory",
      mode: "deep",
      path: ["mm", "cpu"],
      title: "Page tables and the TLB",
      body: "The kernel writes each new mapping into the process's page tables: four levels on most x86-64 machines, five on some. The CPU's memory management unit walks them in hardware and keeps recent translations in the TLB, so later accesses to the page need no kernel at all.",
      code: [{ project: "linux", path: "arch/x86/mm/fault.c", symbol: "do_user_addr_fault" }],
      timescale: "ns",
      data: { amount: "4 levels", what: "of page tables, each a 4 KiB page of 512 entries of 8 bytes; the TLB caches the translations it walks" },
      aws: {
        service: "Amazon Route 53 Resolver",
        text: "The TLB is a cache of lookups, as a resolver's cache is: the full walk (four tables, like a DNS query from the root down) happens once, and the answer is reused until it changes.",
      },
    },
    ...appSpecific(app),
    {
      id: "wayland",
      phase: "launch",
      path: [node, "syscall", "ipc", "syscall", "shell"],
      title: "Connecting to the compositor",
      body: `${name} connects to the compositor's Wayland socket, a Unix socket in its runtime directory ($XDG_RUNTIME_DIR). It learns which interfaces the compositor offers, receives the keyboard map, and creates a surface: the thing that will become its window.`,
      code: [
        { project: "linux", path: "net/unix/af_unix.c", symbol: "unix_stream_connect" },
        { project: "wayland", path: "protocol/wayland.xml" },
      ],
      timescale: "ms",
    },
    drawStep(
      "draw",
      node,
      "The window appears",
      `${name} draws its first frame with the GPU and attaches it to its surface; the compositor places the window on screen. Only now does the window exist for you.`,
      { windows: { [app]: "open" } },
    ),
  ];
  return { kind: "launch", app, title: `Launching ${name}`, focus: "split", steps };
}
