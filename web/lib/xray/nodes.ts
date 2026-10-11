import type { Layer, MachineNode, NodeId } from "./types";

// The machine map, drawn in a 1000 x 760 coordinate space. Hardware and
// software are placed by hand so related parts stack: storage on the left,
// shared kernel services in the middle, networking on the right, and the
// chipset's controllers along the bottom.

export const VIEW = { width: 1000, height: 760 } as const;

export interface Band {
  layer: Layer;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const BANDS: Band[] = [
  { layer: "user", label: "USER SPACE", x: 8, y: 8, w: 708, h: 170 },
  { layer: "kernel", label: "KERNEL", x: 8, y: 186, w: 708, h: 368 },
  { layer: "hardware", label: "HARDWARE", x: 8, y: 562, w: 708, h: 190 },
  { layer: "network", label: "NETWORK", x: 730, y: 8, w: 262, h: 744 },
];

const NODE_LIST: MachineNode[] = [
  // User space, top row
  {
    id: "shell",
    label: "Desktop shell",
    sub: "compositor",
    layer: "user",
    x: 16, y: 40, w: 120, h: 46,
    about:
      "The desktop shell draws the taskbar and windows. On Wayland it is also the display server (the compositor): it reads input from the kernel, decides which window receives it, brokers the clipboard between apps, and combines every window into the picture on screen.",
    code: [
      { project: "mutter", path: "src/wayland/meta-wayland-keyboard.c" },
      { project: "mutter", path: "src/wayland/meta-wayland-data-device.c" },
    ],
  },
  {
    id: "services",
    label: "System services",
    sub: "systemd · logind",
    layer: "user",
    x: 144, y: 40, w: 140, h: 46,
    about:
      "Background programs that run the system. systemd is process 1: it starts every other service and stops them at shutdown. logind tracks user sessions and handles power-off requests; udev reacts to devices; the network manager gets an IP address with DHCP.",
    code: [
      { project: "systemd", path: "src/core/main.c" },
      { project: "systemd", path: "src/login/logind-dbus.c" },
    ],
  },
  {
    id: "player",
    label: "Media player",
    sub: "Videos · GStreamer",
    layer: "user",
    x: 292, y: 40, w: 144, h: 46,
    about:
      "A media player reads a compressed audio or video file, decodes it into raw samples and frames on the CPU (or the GPU for video), and hands them on: sound to PipeWire, pictures to the compositor.",
  },
  {
    id: "browser",
    label: "Browser",
    sub: "Chromium · UI",
    layer: "user",
    x: 444, y: 40, w: 128, h: 46,
    about:
      "Chromium's browser process runs the window, tabs and omnibox and coordinates the other processes. It never parses web pages itself: that work happens in separate, sandboxed processes.",
    code: [
      { project: "chromium", path: "chrome/browser/" },
      { project: "chromium", path: "ui/ozone/platform/wayland/host/wayland_keyboard.cc" },
    ],
  },
  {
    id: "renderer",
    label: "Renderer",
    sub: "HTML → pixels",
    layer: "user",
    x: 580, y: 40, w: 128, h: 46,
    about:
      "A renderer process turns HTML, CSS and JavaScript into pixels. It runs in a sandbox with almost no direct access to the system, and asks other processes for network data and drawing.",
    code: [{ project: "chromium", path: "content/renderer/" }],
  },

  // User space, bottom row
  {
    id: "terminal",
    label: "Terminal",
    sub: "emulator",
    layer: "user",
    x: 16, y: 106, w: 72, h: 46,
    about:
      "A terminal emulator is an ordinary program that stands in for a hardware terminal. It owns one end of a pseudo-terminal; the shell running inside it owns the other end.",
    code: [{ project: "linux", path: "drivers/tty/pty.c" }],
  },
  {
    id: "bash",
    label: "bash",
    sub: "shell",
    layer: "user",
    x: 96, y: 106, w: 56, h: 46,
    about:
      "The shell reads your command line, starts programs with clone() and execve(), and waits for them to finish.",
    code: [{ project: "bash", path: "execute_cmd.c" }],
  },
  {
    id: "cat",
    label: "cat",
    sub: "coreutils",
    layer: "user",
    x: 160, y: 106, w: 64, h: 46,
    about:
      "cat opens a file, read()s it into a buffer and write()s the bytes to its standard output, which here is the terminal.",
    code: [{ project: "coreutils", path: "src/cat.c" }],
  },
  {
    id: "editor",
    label: "Text editor",
    sub: "GTK app",
    layer: "user",
    x: 232, y: 106, w: 86, h: 46,
    about:
      "A GTK text editor. Like every graphical app on Wayland it talks to the compositor over a Unix socket: it receives key and pointer events, offers and receives clipboard data, and hands over finished frames.",
    code: [
      { project: "gtk", path: "gdk/wayland/gdkseat-wayland.c" },
      { project: "gtk", path: "gdk/wayland/gdkclipboard-wayland.c" },
    ],
  },
  {
    id: "pipewire",
    label: "PipeWire",
    sub: "audio server",
    layer: "user",
    x: 326, y: 106, w: 88, h: 46,
    about:
      "PipeWire routes and mixes audio between apps and devices. Its real-time data thread wakes on a timer once per quantum, mixes every stream and writes the result into the sound card's buffer before the hardware needs it.",
    code: [
      { project: "pipewire", path: "spa/plugins/alsa/alsa-pcm.c" },
      { project: "pipewire", path: "src/modules/module-rt.c" },
    ],
  },
  {
    id: "netsvc",
    label: "Network service",
    sub: "HTTP · TLS",
    layer: "user",
    x: 422, y: 106, w: 108, h: 46,
    about:
      "Chromium's network service makes every network request: it resolves names, opens TCP connections, runs TLS with BoringSSL and speaks HTTP. On desktop Linux it runs in its own process.",
    code: [
      { project: "chromium", path: "services/network/" },
      { project: "chromium", path: "net/" },
    ],
  },
  {
    id: "glibc",
    label: "glibc",
    sub: "C library",
    layer: "user",
    x: 538, y: 106, w: 96, h: 46,
    about:
      "The GNU C library is loaded into almost every process. Its dynamic linker, ld.so, maps a program's shared libraries when it starts. It implements printf() and fgets() with buffers of its own, and malloc() and free() by carving the heap into chunks, asking the kernel for more with brk() or mmap() only now and then. Its resolver implements getaddrinfo(): it follows /etc/nsswitch.conf, checks /etc/hosts and sends DNS queries over UDP. Chromium can also use its own DNS client; both send the same kind of packet.",
    code: [
      { project: "glibc", path: "elf/rtld.c", symbol: "dl_main" },
      { project: "glibc", path: "nss/getaddrinfo.c", symbol: "getaddrinfo" },
      { project: "glibc", path: "resolv/res_send.c" },
      { project: "glibc", path: "malloc/malloc.c", symbol: "__libc_malloc" },
    ],
  },
  {
    id: "marks",
    label: "marks",
    sub: "C program",
    layer: "user",
    x: 642, y: 106, w: 66, h: 46,
    about:
      "examples/marks/marks.c, a small C program you run from the terminal with ./marks. It reads each name into an array on its stack, copies it to the heap with strdup(), and keeps the students in an array on the heap that realloc() grows. The Memory tab shows its stack frames and heap chunks as it runs.",
  },

  // Kernel
  {
    id: "syscall",
    label: "System call interface",
    sub: "user mode ↔ kernel mode",
    layer: "kernel",
    x: 16, y: 198, w: 692, h: 30,
    bar: true,
    about:
      "Every request from a program to the kernel enters here. The syscall instruction switches the CPU to kernel mode and jumps to the kernel's entry code, which dispatches on the system call number.",
    code: [{ project: "linux", path: "arch/x86/entry/entry_64.S", symbol: "entry_SYSCALL_64" }],
  },
  {
    id: "vfs",
    label: "VFS",
    sub: "open · read · write",
    layer: "kernel",
    x: 16, y: 244, w: 170, h: 40,
    about:
      "The Virtual File System gives every filesystem the same interface. It resolves paths through the dentry cache, checks permissions and calls into the right filesystem.",
    code: [
      { project: "linux", path: "fs/namei.c", symbol: "path_openat" },
      { project: "linux", path: "fs/read_write.c", symbol: "vfs_read" },
    ],
  },
  {
    id: "pagecache",
    label: "Page cache",
    sub: "files in RAM",
    layer: "kernel",
    x: 16, y: 296, w: 170, h: 40,
    about:
      "File contents the kernel keeps in otherwise free RAM: documents, but also the programs and libraries you run. A hit means no disk access at all; a miss sends a read down the storage stack.",
    code: [
      { project: "linux", path: "mm/filemap.c", symbol: "filemap_read" },
      { project: "linux", path: "mm/readahead.c", symbol: "page_cache_sync_ra" },
    ],
  },
  {
    id: "ext4",
    label: "ext4",
    sub: "filesystem",
    layer: "kernel",
    x: 16, y: 348, w: 170, h: 40,
    about:
      "The ext4 filesystem translates a position inside a file into block numbers on the device, using the file's extent tree.",
    code: [{ project: "linux", path: "fs/ext4/inode.c", symbol: "ext4_map_blocks" }],
  },
  {
    id: "block",
    label: "Block layer",
    sub: "bio · blk-mq",
    layer: "kernel",
    x: 16, y: 400, w: 170, h: 40,
    about:
      "The block layer turns filesystem requests (bios) into device requests, merging and scheduling them through blk-mq.",
    code: [
      { project: "linux", path: "block/blk-core.c", symbol: "submit_bio" },
      { project: "linux", path: "block/blk-mq.c" },
    ],
  },
  {
    id: "nvme",
    label: "NVMe driver",
    sub: "queues · doorbells",
    layer: "kernel",
    x: 16, y: 452, w: 170, h: 40,
    about:
      "The NVMe driver writes commands into submission queues in RAM, rings the SSD's doorbell register and handles completion interrupts.",
    code: [
      { project: "linux", path: "drivers/nvme/host/pci.c", symbol: "nvme_queue_rq" },
      { project: "linux", path: "drivers/nvme/host/pci.c", symbol: "nvme_irq" },
    ],
  },
  {
    id: "proc",
    label: "Processes",
    sub: "clone · execve",
    layer: "kernel",
    x: 214, y: 244, w: 140, h: 40,
    about:
      "Process management: clone() creates processes and threads (one task_struct each), execve() replaces a process's program, and exit_group() and wait4() end the story.",
    code: [
      { project: "linux", path: "kernel/fork.c", symbol: "kernel_clone" },
      { project: "linux", path: "fs/exec.c" },
      { project: "linux", path: "kernel/exit.c", symbol: "do_exit" },
    ],
  },
  {
    id: "mm",
    label: "Memory",
    sub: "page faults",
    layer: "kernel",
    x: 364, y: 244, w: 140, h: 40,
    about:
      "Memory management gives every process its own virtual address space. It records which ranges are mapped to what (VMAs), fills in page tables, and handles page faults when a program touches a page that is not mapped yet, often from the page cache.",
    code: [
      { project: "linux", path: "mm/memory.c", symbol: "handle_mm_fault" },
      { project: "linux", path: "mm/mmap.c", symbol: "do_mmap" },
    ],
  },
  {
    id: "sched",
    label: "Scheduler",
    sub: "who runs next",
    layer: "kernel",
    x: 214, y: 296, w: 140, h: 40,
    about:
      "The scheduler decides which task runs on each CPU core and for how long. Tasks waiting for I/O sleep; a wake-up makes them runnable again. Real-time tasks, such as audio threads, run before every normal one.",
    code: [
      { project: "linux", path: "kernel/sched/core.c", symbol: "schedule" },
      { project: "linux", path: "kernel/sched/core.c", symbol: "try_to_wake_up" },
      { project: "linux", path: "kernel/sched/rt.c" },
    ],
  },
  {
    id: "ipc",
    label: "IPC",
    sub: "Unix sockets · pipes",
    layer: "kernel",
    x: 364, y: 296, w: 140, h: 40,
    about:
      "Inter-process communication: Unix domain sockets carry Wayland, D-Bus and PipeWire messages between programs on the same machine, and can pass open files along; pipes are one-way byte channels. The kernel copies the bytes and wakes the reader.",
    code: [
      { project: "linux", path: "net/unix/af_unix.c" },
      { project: "linux", path: "fs/pipe.c" },
    ],
  },
  {
    id: "tty",
    label: "TTY",
    sub: "pseudo-terminals",
    layer: "kernel",
    x: 214, y: 348, w: 140, h: 40,
    about:
      "The TTY layer connects terminals to programs. A pseudo-terminal pair (/dev/ptmx and /dev/pts/N) lets a terminal emulator stand in for a real keyboard and screen.",
    code: [
      { project: "linux", path: "drivers/tty/pty.c" },
      { project: "linux", path: "drivers/tty/n_tty.c" },
    ],
  },
  {
    id: "input",
    label: "Input",
    sub: "evdev",
    layer: "kernel",
    x: 364, y: 348, w: 140, h: 40,
    about:
      "The input subsystem turns device reports into standard events (key press, button, movement) and exposes them as /dev/input/event* files through evdev.",
    code: [
      { project: "linux", path: "drivers/input/input.c", symbol: "input_event" },
      { project: "linux", path: "drivers/input/evdev.c" },
    ],
  },
  {
    id: "drm",
    label: "Graphics (DRM)",
    sub: "GPU driver",
    layer: "kernel",
    x: 214, y: 400, w: 140, h: 40,
    about:
      "The Direct Rendering Manager is the kernel side of graphics. Programs submit GPU work and display updates through ioctl() calls on /dev/dri/*; the compositor uses it to set the display mode and flip to each new frame.",
    code: [
      { project: "linux", path: "drivers/gpu/drm/drm_ioctl.c" },
      { project: "linux", path: "drivers/gpu/drm/drm_atomic_uapi.c", symbol: "drm_mode_atomic_ioctl" },
    ],
  },
  {
    id: "alsa",
    label: "Sound (ALSA)",
    sub: "PCM · HD Audio",
    layer: "kernel",
    x: 364, y: 400, w: 140, h: 40,
    about:
      "ALSA is the kernel's sound subsystem. A PCM device exposes a ring buffer that the sound card reads with DMA; programs map it into memory and keep it filled ahead of the hardware.",
    code: [
      { project: "linux", path: "sound/core/pcm_native.c" },
      { project: "linux", path: "sound/core/pcm_lib.c", symbol: "snd_pcm_period_elapsed" },
    ],
  },
  {
    id: "acpi",
    label: "Power (ACPI)",
    sub: "power off · reset",
    layer: "kernel",
    x: 214, y: 452, w: 140, h: 40,
    about:
      "ACPI is how the firmware describes power management to the operating system. To power off, the kernel shuts devices down and writes the sleep state S5 (soft off) into the chipset's power-management register.",
    code: [
      { project: "linux", path: "kernel/reboot.c", symbol: "kernel_power_off" },
      { project: "linux", path: "drivers/acpi/sleep.c", symbol: "acpi_power_off" },
    ],
  },
  {
    id: "usbdrv",
    label: "USB · HID",
    sub: "xHCI · usbhid",
    layer: "kernel",
    x: 364, y: 452, w: 140, h: 40,
    about:
      "USB drivers: the xHCI driver runs the USB host controller, and the HID drivers understand keyboards and mice, turning their reports into input events.",
    code: [
      { project: "linux", path: "drivers/usb/host/xhci-ring.c", symbol: "xhci_irq" },
      { project: "linux", path: "drivers/hid/usbhid/hid-core.c", symbol: "hid_irq_in" },
      { project: "linux", path: "drivers/hid/hid-input.c", symbol: "hidinput_hid_event" },
    ],
  },
  {
    id: "irq",
    label: "Interrupts",
    sub: "IRQ · softirq",
    layer: "kernel",
    x: 214, y: 504, w: 290, h: 40,
    about:
      "Hardware raises interrupts to get the CPU's attention. Handlers do the minimum and defer the rest to softirqs, such as NET_RX for incoming packets.",
    code: [
      { project: "linux", path: "kernel/irq/handle.c" },
      { project: "linux", path: "kernel/softirq.c" },
    ],
  },
  {
    id: "socket",
    label: "Socket layer",
    sub: "net/socket.c",
    layer: "kernel",
    x: 528, y: 244, w: 180, h: 40,
    about:
      "The socket layer turns system calls such as sendmsg() and recvmsg() into calls on the right protocol, and holds each socket's send and receive queues.",
    code: [
      { project: "linux", path: "net/socket.c" },
      { project: "linux", path: "net/ipv4/af_inet.c" },
    ],
  },
  {
    id: "udp",
    label: "UDP",
    sub: "datagrams",
    layer: "kernel",
    x: 528, y: 296, w: 85, h: 40,
    about:
      "UDP adds an 8-byte header with ports, a length and a checksum. No connection and no retransmission: a good fit for small request/response protocols such as DNS.",
    code: [
      { project: "linux", path: "net/ipv4/udp.c", symbol: "udp_sendmsg" },
      { project: "linux", path: "net/ipv4/udp.c", symbol: "udp_rcv" },
    ],
  },
  {
    id: "tcp",
    label: "TCP",
    sub: "streams",
    layer: "kernel",
    x: 623, y: 296, w: 85, h: 40,
    about:
      "TCP gives programs a reliable, ordered byte stream on top of packets: handshakes, sequence numbers, acknowledgements, retransmission and congestion control.",
    code: [
      { project: "linux", path: "net/ipv4/tcp_ipv4.c", symbol: "tcp_v4_connect" },
      { project: "linux", path: "net/ipv4/tcp_input.c", symbol: "tcp_rcv_state_process" },
      { project: "linux", path: "net/ipv4/tcp_output.c", symbol: "tcp_connect" },
    ],
  },
  {
    id: "ip",
    label: "IP",
    sub: "routing · netfilter",
    layer: "kernel",
    x: 528, y: 348, w: 180, h: 40,
    about:
      "IPv4 adds source and destination addresses and a TTL, looks up the route in the FIB, and runs the netfilter hooks where firewall rules apply.",
    code: [
      { project: "linux", path: "net/ipv4/ip_output.c" },
      { project: "linux", path: "net/ipv4/ip_input.c" },
      { project: "linux", path: "net/ipv4/route.c" },
    ],
  },
  {
    id: "neigh",
    label: "Neighbour",
    sub: "ARP",
    layer: "kernel",
    x: 528, y: 400, w: 85, h: 40,
    about:
      "The neighbour subsystem maps next-hop IP addresses to MAC addresses, using ARP for IPv4, and caches the answers in the neighbour table (ip neigh).",
    code: [
      { project: "linux", path: "net/core/neighbour.c" },
      { project: "linux", path: "net/ipv4/arp.c" },
    ],
  },
  {
    id: "qdisc",
    label: "Queue",
    sub: "qdisc",
    layer: "kernel",
    x: 623, y: 400, w: 85, h: 40,
    about:
      "Each network interface has a queueing discipline (qdisc), such as fq_codel, that decides which packet goes next and keeps queues short.",
    code: [
      { project: "linux", path: "net/core/dev.c", symbol: "__dev_queue_xmit" },
      { project: "linux", path: "net/sched/sch_generic.c" },
    ],
  },
  {
    id: "nicdrv",
    label: "NIC driver",
    sub: "NAPI · rings",
    layer: "kernel",
    x: 528, y: 452, w: 180, h: 40,
    about:
      "The network card's driver feeds descriptors into transmit and receive rings in RAM. On receive, NAPI polls the ring from a softirq instead of taking one interrupt per packet.",
    code: [
      { project: "linux", path: "net/core/dev.c", symbol: "net_rx_action" },
      { project: "linux", path: "drivers/net/ethernet/realtek/r8169_main.c" },
    ],
  },

  // Hardware, top row
  {
    id: "ssd",
    label: "NVMe SSD",
    sub: "flash · DMA",
    layer: "hardware",
    x: 16, y: 582, w: 170, h: 96,
    about:
      "Flash storage with its own controller. It fetches commands from queues in RAM, moves data with DMA and raises an interrupt when a command completes.",
  },
  {
    id: "cpu",
    label: "CPU",
    sub: "cores · caches",
    layer: "hardware",
    x: 206, y: 582, w: 128, h: 96,
    about:
      "Runs every instruction: in user mode for programs and in kernel mode for the kernel. System calls, page faults and interrupts switch it between the two. Its memory management unit translates every address through page tables.",
  },
  {
    id: "ram",
    label: "RAM",
    sub: "code · page cache · rings",
    layer: "hardware",
    x: 346, y: 582, w: 166, h: 96,
    about:
      "Holds everything that is running: program code, the page cache, socket buffers, and the rings and buffers that devices read and write with DMA. It forgets everything when the power goes off.",
  },
  {
    id: "nic",
    label: "Network card",
    sub: "Ethernet · DMA",
    layer: "hardware",
    x: 528, y: 582, w: 180, h: 96,
    about:
      "The network card moves frames between the cable and RAM with DMA, adds and checks the Ethernet checksum, and raises interrupts when frames arrive.",
  },

  // Hardware, bottom row: peripherals and the chipset's controllers
  {
    id: "inputdev",
    label: "Keyboard",
    sub: "mouse · USB",
    layer: "hardware",
    x: 16, y: 688, w: 96, h: 48,
    about:
      "A USB keyboard has its own small controller that scans the keys and prepares reports. It cannot interrupt the computer: the USB host controller asks it for news at a fixed interval.",
    code: [{ project: "linux", path: "drivers/hid/usbhid/hid-core.c" }],
  },
  {
    id: "usbhc",
    label: "USB",
    sub: "xHCI",
    layer: "hardware",
    x: 120, y: 688, w: 70, h: 48,
    about:
      "The USB host controller, part of the chipset. It polls devices, moves their data to and from RAM with DMA, and raises an interrupt when a transfer completes.",
  },
  {
    id: "pmc",
    label: "Power",
    sub: "ACPI · S5",
    layer: "hardware",
    x: 196, y: 688, w: 70, h: 48,
    about:
      "The chipset's power management. It watches the power button even when the computer is off, switches the power supply on, and switches it off when the operating system writes the soft-off state.",
  },
  {
    id: "firmware",
    label: "Firmware",
    sub: "UEFI flash",
    layer: "hardware",
    x: 272, y: 688, w: 70, h: 48,
    about:
      "A flash chip holding the UEFI firmware, the first code the CPU runs. It initialises memory and devices, then loads a bootloader from the SSD.",
  },
  {
    id: "hda",
    label: "Audio",
    sub: "HD Audio",
    layer: "hardware",
    x: 348, y: 688, w: 70, h: 48,
    about:
      "The HD Audio controller in the chipset reads samples from a buffer in RAM with DMA and streams them to the codec chip, whose digital-to-analog converter drives the speakers.",
  },
  {
    id: "speakers",
    label: "Speakers",
    sub: "analog out",
    layer: "hardware",
    x: 424, y: 688, w: 96, h: 48,
    about:
      "Speakers or headphones move with the voltage from the codec. There is no buffer here: if the samples stop arriving in time, you hear it.",
  },
  {
    id: "display",
    label: "GPU + display",
    sub: "pixels",
    layer: "hardware",
    x: 528, y: 688, w: 180, h: 48,
    about:
      "The GPU draws the composited desktop into a framebuffer, and the display controller sends it to your monitor, refreshing at a fixed rate.",
  },

  // Network
  {
    id: "server",
    label: "Web server",
    sub: "203.0.113.10",
    layer: "network",
    x: 742, y: 40, w: 110, h: 84,
    about:
      "The web server for www.example.com. This simulation uses documentation addresses (RFC 5737), so 203.0.113.10 is a stand-in, not the real server's address.",
  },
  {
    id: "root",
    label: "Root DNS",
    sub: "“.”",
    layer: "network",
    x: 876, y: 40, w: 116, h: 40,
    about:
      "The root name servers know where every top-level domain (.com, .org and the rest) is served. They answer with referrals, not final answers.",
  },
  {
    id: "tld",
    label: ".com DNS",
    sub: "top-level domain",
    layer: "network",
    x: 876, y: 90, w: 116, h: 40,
    about:
      "The .com name servers know which name servers are responsible for each .com domain, such as example.com.",
  },
  {
    id: "auth",
    label: "example.com",
    sub: "authoritative DNS",
    layer: "network",
    x: 876, y: 140, w: 116, h: 40,
    about:
      "The authoritative name servers for example.com hold its actual records, such as the address of www.example.com.",
  },
  {
    id: "resolver",
    label: "DNS resolver",
    sub: "198.51.100.53",
    layer: "network",
    x: 876, y: 214, w: 116, h: 60,
    about:
      "A recursive resolver, usually run by your ISP, does the DNS legwork: it asks the root, then .com, then example.com's own servers, and caches each answer for its TTL.",
  },
  {
    id: "isp",
    label: "ISP network",
    sub: "routes toward the internet",
    layer: "network",
    x: 742, y: 360, w: 250, h: 50,
    about:
      "Your internet provider's routers carry packets toward their destination, hop by hop. Each router lowers the TTL by one and picks the next hop.",
  },
  {
    id: "router",
    label: "Home router",
    sub: "192.168.1.1 · NAT · DNS · DHCP",
    layer: "network",
    x: 742, y: 586, w: 250, h: 82,
    about:
      "Your home router joins the local network to your ISP. It hands out local addresses (DHCP), translates private addresses to its public one (NAT) and often answers DNS queries itself, with its own cache.",
  },
];

export const NODES: Record<NodeId, MachineNode> = Object.fromEntries(
  NODE_LIST.map((node) => [node.id, node]),
) as Record<NodeId, MachineNode>;

export const NODE_IDS = NODE_LIST.map((node) => node.id);

export interface Point {
  x: number;
  y: number;
}

export function centerOf(id: NodeId): Point {
  const n = NODES[id];
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}

/** Faint links that show how things are physically or logically wired. */
export const TOPOLOGY: { d: string; label?: string; lx?: number; ly?: number }[] = [
  { d: "M 708 627 H 742", label: "cable", lx: 725, ly: 620 },
  { d: "M 867 586 V 410" },
  { d: "M 820 360 L 797 124" },
  { d: "M 934 360 V 274" },
  { d: "M 876 244 H 862 V 60 H 876 M 862 110 H 876 M 862 160 H 876" },
  { d: "M 101 284 V 296 M 101 336 V 348 M 101 388 V 400 M 101 440 V 452 M 101 492 V 582" },
  { d: "M 618 284 V 296 M 618 336 V 348 M 618 388 V 400 M 618 440 V 452 M 618 492 V 582" },
  { d: "M 116 683 H 422 V 741 H 116 Z", label: "chipset", lx: 269, ly: 750 },
];

/** Hand-routed detours so a path does not cut through unrelated boxes. */
const VIA: Partial<Record<`${NodeId}>${NodeId}`, Point[]>> = {
  "resolver>root": [{ x: 862, y: 244 }, { x: 862, y: 60 }],
  "resolver>tld": [{ x: 862, y: 244 }, { x: 862, y: 110 }],
  "resolver>auth": [{ x: 862, y: 244 }, { x: 862, y: 160 }],
};

// The kernel's middle column is two boxes wide. Paths between a box there and
// the system call bar, or between boxes two or more rows apart on the same
// side, run up the gap beside the column instead of through the boxes.
const CENTRE = { left: 214, right: 504, split: 364, firstRow: 244 } as const;
const TRUNK = { left: 200, right: 516 } as const;

function inCentre(id: NodeId): boolean {
  const n = NODES[id];
  return n.layer === "kernel" && !n.bar && n.x >= CENTRE.left && n.x + n.w <= CENTRE.right;
}

function side(id: NodeId): "left" | "right" | "both" {
  const n = NODES[id];
  if (n.w > CENTRE.split - CENTRE.left) return "both";
  return n.x < CENTRE.split ? "left" : "right";
}

function trunkRoute(from: NodeId, to: NodeId): Point[] {
  const a = NODES[from];
  const b = NODES[to];
  if (b.bar && inCentre(from) && a.y > CENTRE.firstRow) {
    const s = side(from);
    if (s === "both") return [];
    const x = TRUNK[s];
    return [{ x, y: centerOf(from).y }, { x, y: CENTRE.firstRow - 6 }];
  }
  if (inCentre(from) && inCentre(to)) {
    const sa = side(from);
    const sb = side(to);
    const rows = Math.abs(a.y - b.y) / 52;
    if (rows >= 2 && (sa === sb || sa === "both" || sb === "both")) {
      const s = sa === "both" ? sb : sa;
      if (s === "both") return [];
      const x = TRUNK[s];
      return [{ x, y: centerOf(from).y }, { x, y: centerOf(to).y }];
    }
  }
  return [];
}

export function viaPoints(from: NodeId, to: NodeId): Point[] {
  const forward = VIA[`${from}>${to}`];
  if (forward) return forward;
  const backward = VIA[`${to}>${from}`];
  if (backward) return [...backward].reverse();
  const trunk = trunkRoute(from, to);
  if (trunk.length > 0) return trunk;
  return [...trunkRoute(to, from)].reverse();
}
