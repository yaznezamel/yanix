// Core types for the desktop lab: the machine map, scenarios, packets and the
// state of the simulated apps. Scenario data lives in TypeScript for now; it
// moves to content/*.yaml once the catalog API exists (FR12).

export type Layer = "user" | "kernel" | "hardware" | "network";

export type NodeId =
  // user space
  | "shell"
  | "terminal"
  | "bash"
  | "cat"
  | "browser"
  | "renderer"
  | "netsvc"
  | "glibc"
  // kernel
  | "syscall"
  | "vfs"
  | "pagecache"
  | "ext4"
  | "block"
  | "nvme"
  | "proc"
  | "mm"
  | "tty"
  | "input"
  | "sched"
  | "drm"
  | "irq"
  | "socket"
  | "udp"
  | "tcp"
  | "ip"
  | "neigh"
  | "qdisc"
  | "nicdrv"
  // hardware
  | "inputdev"
  | "ssd"
  | "cpu"
  | "ram"
  | "nic"
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

export type HeaderKind =
  | "eth"
  | "arp"
  | "ip"
  | "udp"
  | "tcp"
  | "dns"
  | "tls"
  | "http";

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
  | "input"
  | "launch"
  | "dns"
  | "arp"
  | "tcp"
  | "tls"
  | "http"
  | "render"
  | "file"
  | "output";

/** Order of magnitude only: real timings vary with hardware and network. */
export type Timescale = "ns" | "us" | "ms";

export type Detail = "overview" | "deep";

export type AppId = "browser" | "terminal";

export interface BrowserState {
  page: "newtab" | "results";
  query: string;
  url: string;
  title: string;
  loading: boolean;
  status: string | null;
  progress: number;
  secure: boolean;
}

export interface TermLine {
  kind: "banner" | "prompt" | "output" | "hint";
  text: string;
}

export interface TerminalState {
  lines: TermLine[];
  busy: boolean;
}

export interface AppState {
  browser: BrowserState;
  terminal: TerminalState;
}

export interface UiEffect {
  browser?: Partial<BrowserState>;
  terminalAppend?: TermLine[];
  terminalBusy?: boolean;
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
}

export type ScenarioRequest =
  | { kind: "launch"; app: AppId }
  | { kind: "search"; query: string }
  | { kind: "readFile" };

export interface Scenario {
  kind: ScenarioRequest["kind"];
  app: AppId;
  title: string;
  /** Which pane deserves the space while this scenario plays. */
  focus: "split" | "machine";
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
  /** notes.txt is in the page cache. */
  fileCached: boolean;
}
