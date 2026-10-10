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
  tls: "#7ee0a1",
  http: "#ff7ab6",
};

export const HEADER_TAG: Record<HeaderKind, string> = {
  eth: "ETH",
  arp: "ARP",
  ip: "IP",
  udp: "UDP",
  tcp: "TCP",
  dns: "DNS",
  tls: "TLS",
  http: "HTTP",
};

export const PHASE_NAME: Record<Phase, string> = {
  input: "Input",
  launch: "Process",
  dns: "DNS",
  arp: "ARP",
  tcp: "TCP",
  tls: "TLS",
  http: "HTTP",
  render: "Render",
  file: "File I/O",
  output: "Output",
};

export const TIMESCALE: Record<Timescale, { label: string; hint: string }> = {
  ns: { label: "nanoseconds", hint: "Up to about a microsecond" },
  us: { label: "microseconds", hint: "Millionths of a second" },
  ms: { label: "milliseconds", hint: "Thousandths of a second: network round trips live here" },
};
