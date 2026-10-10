import type { Layer, MachineNode, NodeId } from "./types";

// The machine map, drawn in a 1000 x 760 coordinate space. Hardware and
// software are placed by hand so related parts stack: storage on the left,
// shared kernel services in the middle, networking on the right.

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
  // User space
  {
    id: "shell",
    label: "Desktop shell",
    sub: "compositor",
    layer: "user",
    x: 16, y: 40, w: 170, h: 46,
    about:
      "The desktop shell draws the taskbar and windows. Its compositor reads input events from the kernel, decides which window receives them, and combines all windows into the picture on screen.",
  },
  {
    id: "terminal",
    label: "Terminal",
    sub: "emulator",
    layer: "user",
    x: 16, y: 106, w: 104, h: 46,
    about:
      "A terminal emulator is an ordinary program that stands in for a hardware terminal. It owns one end of a pseudo-terminal; the shell running inside it owns the other end.",
    code: [{ project: "linux", path: "drivers/tty/pty.c" }],
  },
  {
    id: "bash",
    label: "bash",
    sub: "shell",
    layer: "user",
    x: 128, y: 106, w: 74, h: 46,
    about:
      "The shell reads your command line, starts programs with clone() and execve(), and waits for them to finish.",
    code: [{ project: "bash", path: "execute_cmd.c" }],
  },
  {
    id: "cat",
    label: "cat",
    sub: "coreutils",
    layer: "user",
    x: 210, y: 106, w: 74, h: 46,
    about:
      "cat opens a file, read()s it into a buffer and write()s the bytes to its standard output, which here is the terminal.",
    code: [{ project: "coreutils", path: "src/cat.c" }],
  },
  {
    id: "browser",
    label: "Browser",
    sub: "Chromium · UI",
    layer: "user",
    x: 380, y: 40, w: 156, h: 46,
    about:
      "Chromium's browser process runs the window, tabs and omnibox and coordinates the other processes. It never parses web pages itself: that work happens in separate, sandboxed processes.",
    code: [{ project: "chromium", path: "chrome/browser/" }],
  },
  {
    id: "renderer",
    label: "Renderer",
    sub: "HTML → pixels",
    layer: "user",
    x: 544, y: 40, w: 164, h: 46,
    about:
      "A renderer process turns HTML, CSS and JavaScript into pixels. It runs in a sandbox with almost no direct access to the system, and asks other processes for network data and drawing.",
    code: [{ project: "chromium", path: "content/renderer/" }],
  },
  {
    id: "netsvc",
    label: "Network service",
    sub: "HTTP · TLS",
    layer: "user",
    x: 380, y: 106, w: 156, h: 46,
    about:
      "Chromium's network service makes every network request: it resolves names, opens TCP connections, runs TLS with BoringSSL and speaks HTTP. On desktop Linux it runs in its own process.",
    code: [
      { project: "chromium", path: "services/network/" },
      { project: "chromium", path: "net/" },
    ],
  },
  {
    id: "glibc",
    label: "glibc resolver",
    sub: "getaddrinfo()",
    layer: "user",
    x: 544, y: 106, w: 164, h: 46,
    about:
      "The GNU C library implements getaddrinfo(). Its resolver follows /etc/nsswitch.conf, checks /etc/hosts, reads the DNS server from /etc/resolv.conf and sends queries over UDP. Chromium can also use its own built-in DNS client; both send the same kind of packet.",
    code: [
      { project: "glibc", path: "sysdeps/posix/getaddrinfo.c" },
      { project: "glibc", path: "resolv/res_send.c" },
    ],
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
      "File contents the kernel keeps in otherwise free RAM. A hit means no disk access at all; a miss sends a read down the storage stack.",
    code: [{ project: "linux", path: "mm/filemap.c", symbol: "filemap_read" }],
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
      "Memory management maps virtual addresses to physical pages. When a program touches a page that is not mapped yet, the CPU raises a page fault and the kernel fills it in, often from the page cache.",
    code: [
      { project: "linux", path: "mm/memory.c", symbol: "handle_mm_fault" },
      { project: "linux", path: "mm/filemap.c", symbol: "filemap_fault" },
    ],
  },
  {
    id: "tty",
    label: "TTY",
    sub: "pseudo-terminals",
    layer: "kernel",
    x: 214, y: 296, w: 140, h: 40,
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
    x: 364, y: 296, w: 140, h: 40,
    about:
      "The input subsystem turns device reports into standard events (key press, button, movement) and exposes them as /dev/input/event* files through evdev.",
    code: [
      { project: "linux", path: "drivers/input/input.c", symbol: "input_event" },
      { project: "linux", path: "drivers/input/evdev.c" },
    ],
  },
  {
    id: "sched",
    label: "Scheduler",
    sub: "who runs next",
    layer: "kernel",
    x: 214, y: 348, w: 290, h: 40,
    about:
      "The scheduler decides which task runs on each CPU core and for how long. Tasks waiting for I/O sleep; a wake-up makes them runnable again.",
    code: [
      { project: "linux", path: "kernel/sched/core.c", symbol: "schedule" },
      { project: "linux", path: "kernel/sched/core.c", symbol: "try_to_wake_up" },
    ],
  },
  {
    id: "drm",
    label: "Graphics (DRM)",
    sub: "GPU driver",
    layer: "kernel",
    x: 214, y: 400, w: 290, h: 40,
    about:
      "The Direct Rendering Manager is the kernel side of graphics. Programs submit GPU work and display updates through ioctl() calls on /dev/dri/*.",
    code: [{ project: "linux", path: "drivers/gpu/drm/drm_ioctl.c" }],
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

  // Hardware
  {
    id: "inputdev",
    label: "Keyboard & mouse",
    sub: "USB",
    layer: "hardware",
    x: 16, y: 576, w: 170, h: 40,
    about:
      "USB keyboards and mice send small reports. The USB host controller collects them and raises an interrupt when a transfer completes.",
    code: [{ project: "linux", path: "drivers/hid/usbhid/hid-core.c" }],
  },
  {
    id: "ssd",
    label: "NVMe SSD",
    sub: "flash · DMA",
    layer: "hardware",
    x: 16, y: 628, w: 170, h: 112,
    about:
      "Flash storage with its own controller. It fetches commands from queues in RAM, moves data with DMA and raises an interrupt when a command completes.",
  },
  {
    id: "cpu",
    label: "CPU",
    sub: "cores · caches",
    layer: "hardware",
    x: 206, y: 576, w: 128, h: 164,
    about:
      "Runs every instruction: in user mode for programs and in kernel mode for the kernel. System calls, page faults and interrupts switch it between the two.",
  },
  {
    id: "ram",
    label: "RAM",
    sub: "code · page cache · rings",
    layer: "hardware",
    x: 346, y: 576, w: 166, h: 164,
    about:
      "Holds everything that is running: program code, the page cache, socket buffers, and the descriptor rings that devices read and write with DMA.",
  },
  {
    id: "nic",
    label: "Network card",
    sub: "Ethernet · DMA",
    layer: "hardware",
    x: 528, y: 576, w: 180, h: 100,
    about:
      "The network card moves frames between the cable and RAM with DMA, adds and checks the Ethernet checksum, and raises interrupts when frames arrive.",
  },
  {
    id: "display",
    label: "GPU + display",
    sub: "pixels",
    layer: "hardware",
    x: 528, y: 688, w: 180, h: 52,
    about:
      "The GPU draws the composited desktop into a framebuffer, and the display controller sends it to your monitor.",
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
    sub: "192.168.1.1 · NAT · DNS forwarder",
    layer: "network",
    x: 742, y: 586, w: 250, h: 82,
    about:
      "Your home router joins the local network to your ISP. It translates private addresses to its public one (NAT) and often answers DNS queries itself, with its own cache.",
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
  { d: "M 101 284 V 296 M 101 336 V 348 M 101 388 V 400 M 101 440 V 452 M 101 492 V 628" },
  { d: "M 618 284 V 296 M 618 336 V 348 M 618 388 V 400 M 618 440 V 452 M 618 492 V 576" },
];

/** Hand-routed detours so a path does not cut through unrelated boxes. */
const VIA: Partial<Record<`${NodeId}>${NodeId}`, Point[]>> = {
  "resolver>root": [{ x: 862, y: 244 }, { x: 862, y: 60 }],
  "resolver>tld": [{ x: 862, y: 244 }, { x: 862, y: 110 }],
  "resolver>auth": [{ x: 862, y: 244 }, { x: 862, y: 160 }],
};

export function viaPoints(from: NodeId, to: NodeId): Point[] {
  const forward = VIA[`${from}>${to}`];
  if (forward) return forward;
  const backward = VIA[`${to}>${from}`];
  return backward ? [...backward].reverse() : [];
}
