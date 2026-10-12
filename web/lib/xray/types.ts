// Core types for the desktop lab: the machine map, scenarios, the data that
// travels between layers and the state of the simulated computer. Scenario
// data lives in TypeScript for now; it moves to content/*.yaml once the
// catalog API exists (FR12).

import type { CoresState } from "./cores/program";
import type { ProgramState } from "./marks/program";

/** The C program running in the terminal: examples/marks or examples/cores. */
export type Program = ProgramState | CoresState;

export type Layer = "user" | "kernel" | "hardware" | "network";

export type NodeId =
  // user space
  | "shell"
  | "services"
  | "player"
  | "browser"
  | "renderer"
  | "terminal"
  | "bash"
  | "cat"
  | "editor"
  | "pipewire"
  | "netsvc"
  | "glibc"
  | "program"
  // kernel
  | "syscall"
  | "vfs"
  | "pagecache"
  | "ext4"
  | "block"
  | "nvme"
  | "proc"
  | "mm"
  | "sched"
  | "ipc"
  | "tty"
  | "input"
  | "drm"
  | "alsa"
  | "acpi"
  | "usbdrv"
  | "irq"
  | "socket"
  | "udp"
  | "tcp"
  | "ip"
  | "neigh"
  | "qdisc"
  | "nicdrv"
  // hardware
  | "ssd"
  | "cpu"
  | "ram"
  | "nic"
  | "inputdev"
  | "usbhc"
  | "pmc"
  | "firmware"
  | "hda"
  | "speakers"
  | "display"
  // network
  | "router"
  | "isp"
  | "resolver"
  | "root"
  | "tld"
  | "auth"
  | "server";

export type CodeProject =
  | "linux"
  | "glibc"
  | "systemd"
  | "linux-pam"
  | "wayland"
  | "mutter"
  | "gtk"
  | "libxkbcommon"
  | "pipewire"
  | "rtkit"
  | "chromium"
  | "boringssl"
  | "bash"
  | "coreutils";

export interface CodeRef {
  project: CodeProject;
  path: string;
  symbol?: string;
}

export interface MachineNode {
  id: NodeId;
  label: string;
  sub?: string;
  layer: Layer;
  x: number;
  y: number;
  w: number;
  h: number;
  /** A bar spans its row; paths enter it straight above or below their neighbours. */
  bar?: boolean;
  about: string;
  code?: CodeRef[];
}

/** Kinds of structure shown in the data panel: packet headers and kernel or device data. */
export type HeaderKind =
  | "eth"
  | "arp"
  | "ip"
  | "udp"
  | "tcp"
  | "dns"
  | "dhcp"
  | "tls"
  | "http"
  | "usb"
  | "hid"
  | "evdev"
  | "wayland"
  | "dbus"
  | "pipe"
  | "nvme"
  | "elf"
  | "vma"
  | "pcm"
  | "reg"
  | "syscall"
  | "heap";

export interface Field {
  name: string;
  value: string;
}

export interface Header {
  kind: HeaderKind;
  title: string;
  /** Size in bytes, when it is fixed or known for this example. */
  bytes?: number;
  fields: Field[];
  encrypted?: boolean;
}

export interface Packet {
  /** Heading for the data panel; a network packet when absent. */
  label?: string;
  caption: string;
  /** Outermost header first, as the bytes appear on the wire. */
  headers: Header[];
}

export interface PacketFrame {
  /** Index in the step's path from which this version of the packet applies. */
  at: number;
  packet: Packet;
}

export type Phase =
  | "power"
  | "firmware"
  | "boot"
  | "services"
  | "dhcp"
  | "login"
  | "shutdown"
  | "input"
  | "compositor"
  | "app"
  | "launch"
  | "memory"
  | "linking"
  | "dns"
  | "arp"
  | "tcp"
  | "tls"
  | "http"
  | "render"
  | "file"
  | "cache"
  | "disk"
  | "output"
  | "audio"
  | "video"
  | "clipboard";

/** Order of magnitude only: real timings vary with hardware and network. */
export type Timescale = "ns" | "us" | "ms" | "s";

export type Detail = "overview" | "deep";

export type AppId = "browser" | "terminal" | "editor" | "player";

export type WindowId = AppId | "welcome";

/** A window opens when the app draws its first frame, not when you click. */
export type WindowStatus = "closed" | "starting" | "open";

/** What the screen shows: the desktop, or a stage of powering on and off. */
export type ScreenMode = "desktop" | "off" | "firmware" | "bootloader" | "kernel" | "login" | "shutdown";

export interface BrowserState {
  page: "newtab" | "results";
  /** What is typed in the page's search box. */
  draft: string;
  query: string;
  url: string;
  title: string;
  loading: boolean;
  status: string | null;
  progress: number;
  secure: boolean;
}

export interface TermLine {
  /** "ask" is a program's prompt, printed without a newline: what you type goes after it. */
  kind: "banner" | "prompt" | "output" | "hint" | "ask";
  text: string;
  /** What you typed after an "ask", once you pressed Enter. */
  answer?: string;
}

export interface TerminalState {
  lines: TermLine[];
  busy: boolean;
}

export interface EditorState {
  file: string | null;
  text: string;
  loading: boolean;
}

export type Media = "audio" | "video";

export interface MediaState {
  media: Media;
  playing: boolean;
  status: string | null;
}

export interface Clipboard {
  /** The app that offered the text. It still holds the only copy. */
  owner: AppId;
  text: string;
}

export interface AppState {
  screen: ScreenMode;
  bootLog: string[];
  windows: Record<WindowId, WindowStatus>;
  browser: BrowserState;
  terminal: TerminalState;
  editor: EditorState;
  player: MediaState;
  clipboard: Clipboard | null;
  /** The C program running in the terminal (examples/marks or examples/cores), or null. */
  program: Program | null;
}

/** How a step changes what is on screen. */
export interface UiEffect {
  screen?: ScreenMode;
  bootLog?: string[];
  clearBootLog?: boolean;
  windows?: Partial<Record<WindowId, WindowStatus>>;
  /** Every app quits: windows close and their state resets. */
  closeAll?: boolean;
  browser?: Partial<BrowserState>;
  /** Text added to the end of the browser's search box. */
  draftInsert?: string;
  terminalAppend?: TermLine[];
  terminalBusy?: boolean;
  editor?: Partial<EditorState>;
  /** Text added to the end of the editor's document. */
  editorInsert?: string;
  player?: Partial<MediaState>;
  clipboard?: Clipboard | null;
  /** The program's memory from this step on. */
  program?: Program | null;
}

export interface Step {
  id: string;
  phase: Phase;
  /** Nodes the signal visits in order. One node means "work happens here". */
  path: NodeId[];
  title: string;
  body: string;
  frames?: PacketFrame[];
  code?: CodeRef[];
  timescale?: Timescale;
  /** Shown only in this detail level; undefined means both. */
  mode?: Detail;
  ui?: UiEffect;
  /** What the machine remembers from this step on, e.g. an ARP answer. */
  learns?: Partial<MachineState>;
  /** The page cache lookup that decides whether the disk is needed. */
  cache?: "hit" | "miss";
  /**
   * Parts of the hardware view the step uses besides its path's, by id, such
   * as "cpu.core0.l1d": the units of the core that runs the step's code.
   */
  parts?: string[];
  /**
   * The cores that run the step's code, when they are not just core 0: the
   * threads of ./cores. Each user or kernel box on the path stands for them.
   */
  cores?: number[];
  /** What the step moves, with how much of it: worked out from the model or a measurement, never guessed. */
  data?: StepData;
  /** The same idea where it appears on AWS, for a reader who knows the cloud. Only where the comparison holds. */
  aws?: AwsNote;
}

export interface StepData {
  /** How much, with its unit: "2 bytes", "977 pages (3.8 MiB)". */
  amount: string;
  /** What it is, and from where to where. */
  what: string;
}

export interface AwsNote {
  /** The AWS service or feature, as AWS names it. */
  service: string;
  text: string;
  /** AWS's documentation for the note's figures (NFR9), when it gives any. */
  source?: string;
}

export type ScenarioRequest =
  | { kind: "launch"; app: AppId }
  | { kind: "search"; query: string }
  | { kind: "readFile" }
  | { kind: "openFile" }
  | { kind: "keystroke"; app: "browser" | "editor"; key: string }
  | { kind: "copy"; app: "browser" | "editor"; text: string }
  | { kind: "paste"; app: "browser" | "editor"; source: AppId; text: string }
  | { kind: "play"; media: Media }
  | { kind: "boot" }
  | { kind: "login" }
  | { kind: "shutdown" }
  | { kind: "restart" }
  /** ./marks or ./cores in the terminal: a C program starts. */
  | { kind: "runProgram"; program: "marks" | "cores" }
  /** A line typed into the running program. */
  | { kind: "programInput"; text: string }
  /** Ctrl+D at the start of a line while the program reads: the end of its input. */
  | { kind: "programEof" }
  /** Ctrl+C while a program runs in the terminal: SIGINT. */
  | { kind: "interrupt" };

export interface Scenario {
  kind: ScenarioRequest["kind"];
  /** The app the trace belongs to, or null for the whole system. */
  app: AppId | null;
  title: string;
  /** Which pane deserves the space while this scenario plays. */
  focus: "screen" | "split" | "machine";
  steps: Step[];
}

/** What the machine remembers between scenarios. */
export interface MachineState {
  /** The router's MAC address is in the kernel's neighbour (ARP) table. */
  arpCached: boolean;
  /** The router and resolver have www.example.com in their DNS caches. */
  dnsCached: boolean;
  /** The browser holds an open HTTPS connection to www.example.com. */
  connectionOpen: boolean;
  /** Files, data and programs alike, whose pages are in the page cache. */
  pageCache: string[];
}
