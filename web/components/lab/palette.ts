import type { HeaderKind, Layer, Phase, Timescale } from "@/lib/xray/types";

export const SIGNAL = "#3fe0ff";

export const LAYER_HEX: Record<Layer, string> = {
  user: "#ff7ab6",
  kernel: "#8fa3ff",
  hardware: "#ffb35c",
  network: "#5eead4",
};

/** rgba() from a #rrggbb colour, for SVG fills that need transparency. */
export function alpha(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const LAYER_COLOR: Record<Layer, string> = {
  user: "var(--color-layer-user)",
  kernel: "var(--color-layer-kernel)",
  hardware: "var(--color-layer-hardware)",
  network: "var(--color-layer-network)",
};

export const LAYER_NAME: Record<Layer, string> = {
  user: "User space",
  kernel: "Kernel",
  hardware: "Hardware",
  network: "Network",
};

export const HEADER_COLOR: Record<HeaderKind, string> = {
  eth: "#ffb35c",
  arp: "#ffd479",
  ip: "#8fa3ff",
  udp: "#c0a6ff",
  tcp: "#c0a6ff",
  dns: "#ff7ab6",
  dhcp: "#ff7ab6",
  tls: "#7ee0a1",
  http: "#ff7ab6",
  usb: "#ffb35c",
  hid: "#ffd479",
  evdev: "#8fa3ff",
  wayland: "#ff7ab6",
  dbus: "#ff9fd0",
  pipe: "#7ee0a1",
  nvme: "#ffb35c",
  elf: "#ffd479",
  vma: "#8fa3ff",
  pcm: "#5eead4",
  reg: "#ffb35c",
  syscall: "#a5b4fc",
  heap: "#f0abfc",
};

export const HEADER_TAG: Record<HeaderKind, string> = {
  eth: "ETH",
  arp: "ARP",
  ip: "IP",
  udp: "UDP",
  tcp: "TCP",
  dns: "DNS",
  dhcp: "DHCP",
  tls: "TLS",
  http: "HTTP",
  usb: "USB",
  hid: "HID",
  evdev: "EV",
  wayland: "WL",
  dbus: "DBUS",
  pipe: "PIPE",
  nvme: "NVMe",
  elf: "ELF",
  vma: "MAP",
  pcm: "PCM",
  reg: "REG",
  syscall: "SYS",
  heap: "HEAP",
};

export const PHASE_NAME: Record<Phase, string> = {
  power: "Power",
  firmware: "Firmware",
  boot: "Boot",
  services: "systemd",
  dhcp: "DHCP",
  login: "Login",
  shutdown: "Shutdown",
  input: "Input",
  compositor: "Compositor",
  app: "App",
  launch: "Process",
  memory: "Memory",
  linking: "Linking",
  dns: "DNS",
  arp: "ARP",
  tcp: "TCP",
  tls: "TLS",
  http: "HTTP",
  render: "Render",
  file: "File I/O",
  cache: "Page cache",
  disk: "Disk",
  output: "Output",
  audio: "Audio",
  video: "Video",
  clipboard: "Clipboard",
};

export const TIMESCALE: Record<Timescale, { label: string; hint: string }> = {
  ns: { label: "nanoseconds", hint: "Up to about a microsecond" },
  us: { label: "microseconds", hint: "Millionths of a second" },
  ms: { label: "milliseconds", hint: "Thousandths of a second: network round trips and USB polling live here" },
  s: { label: "seconds", hint: "Firmware and service start-up can take whole seconds" },
};
