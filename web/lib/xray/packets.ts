import type { Header, Packet, PacketFrame } from "./types";

// Addresses come from the ranges reserved for documentation (RFC 5737 for
// IPv4, RFC 7042 for MAC addresses), so nothing here points at a real host.
export const NET = {
  host: { ip: "192.168.1.23", mac: "00:00:5e:00:53:01" },
  router: { ip: "192.168.1.1", mac: "00:00:5e:00:53:fe", publicIp: "198.51.100.7" },
  resolver: { ip: "198.51.100.53" },
  server: { name: "www.example.com", ip: "203.0.113.10" },
  ports: { dnsClient: 53214, routerDns: 61003, tcpClient: 41870 },
} as const;

export function searchPath(query: string): string {
  return `/search?q=${encodeURIComponent(query.trim())}`;
}

export function searchUrl(query: string): string {
  return `https://${NET.server.name}${searchPath(query)}`;
}

type Station = "host" | "router" | "broadcast";

const MAC: Record<Station, string> = {
  host: NET.host.mac,
  router: NET.router.mac,
  broadcast: "ff:ff:ff:ff:ff:ff",
};

const MAC_LABEL: Record<Station, string> = {
  host: "this computer",
  router: "home router",
  broadcast: "everyone",
};

export function eth(dst: Station, type: "IPv4" | "ARP"): Header {
  const src: Station = dst === "host" ? "router" : "host";
  return {
    kind: "eth",
    title: "Ethernet",
    bytes: 14,
    fields: [
      { name: "Destination", value: `${MAC[dst]} (${MAC_LABEL[dst]})` },
      { name: "Source", value: `${MAC[src]} (${MAC_LABEL[src]})` },
      { name: "Type", value: type === "IPv4" ? "0x0800 IPv4" : "0x0806 ARP" },
    ],
  };
}

export function ipv4(
  src: string,
  dst: string,
  proto: "UDP" | "TCP",
  ttl: number | string = 64,
): Header {
  return {
    kind: "ip",
    title: "IPv4",
    bytes: 20,
    fields: [
      { name: "Source", value: src },
      { name: "Destination", value: dst },
      { name: "TTL", value: String(ttl) },
      { name: "Protocol", value: proto === "UDP" ? "17 (UDP)" : "6 (TCP)" },
    ],
  };
}

export function udp(sport: number, dport: number): Header {
  return {
    kind: "udp",
    title: "UDP",
    bytes: 8,
    fields: [
      { name: "Source port", value: String(sport) },
      { name: "Destination port", value: dport === 53 ? "53 (DNS)" : String(dport) },
    ],
  };
}

export function tcp(
  sport: number,
  dport: number,
  flags: string,
  extra: { bytes?: number; note?: string } = {},
): Header {
  const fields = [
    { name: "Source port", value: sport === 443 ? "443 (HTTPS)" : String(sport) },
    { name: "Destination port", value: dport === 443 ? "443 (HTTPS)" : String(dport) },
    { name: "Flags", value: flags },
  ];
  if (extra.note) fields.push({ name: "Note", value: extra.note });
  return { kind: "tcp", title: "TCP", bytes: extra.bytes, fields };
}

export const dnsQuery: Header = {
  kind: "dns",
  title: "DNS query",
  bytes: 33,
  fields: [
    { name: "ID", value: "0x1a2b" },
    { name: "Question", value: "www.example.com, type A (IPv4)" },
    { name: "Flags", value: "recursion desired" },
  ],
};

export const dnsAnswer: Header = {
  kind: "dns",
  title: "DNS answer",
  bytes: 49,
  fields: [
    { name: "ID", value: "0x1a2b (matches the query)" },
    { name: "Answer", value: "www.example.com A 203.0.113.10" },
    { name: "TTL", value: "3600 s in this example" },
  ],
};

export function arp(op: "request" | "reply"): Header {
  return {
    kind: "arp",
    title: op === "request" ? "ARP request" : "ARP reply",
    bytes: 28,
    fields:
      op === "request"
        ? [
            { name: "Question", value: "Who has 192.168.1.1?" },
            { name: "Tell", value: `${NET.host.ip} (${NET.host.mac})` },
          ]
        : [
            { name: "Answer", value: `192.168.1.1 is at ${NET.router.mac}` },
            { name: "To", value: NET.host.ip },
          ],
  };
}

export function tls(title: string, value: string, encrypted: boolean): Header {
  return {
    kind: "tls",
    title,
    encrypted,
    fields: [{ name: encrypted ? "Ciphertext" : "Contents", value }],
  };
}

export function http(title: string, fields: Header["fields"]): Header {
  return { kind: "http", title, fields };
}

export function frame(at: number, caption: string, ...headers: Header[]): PacketFrame {
  return { at, packet: { caption, headers } };
}

export function packetAt(frames: PacketFrame[] | undefined, index: number): Packet | null {
  if (!frames || frames.length === 0) return null;
  let current: PacketFrame | null = null;
  for (const f of frames) {
    if (f.at <= index) current = f;
  }
  return (current ?? frames[0] ?? null)?.packet ?? null;
}

/** The packet at a path position, and the version just before it in the same step. */
export function framesAround(
  frames: PacketFrame[] | undefined,
  index: number,
): { current: Packet | null; previous: Packet | null } {
  if (!frames || frames.length === 0) return { current: null, previous: null };
  let i = 0;
  frames.forEach((f, k) => {
    if (f.at <= index) i = k;
  });
  return { current: frames[i]?.packet ?? null, previous: i > 0 ? (frames[i - 1]?.packet ?? null) : null };
}

export function packetBytes(packet: Packet): number | null {
  let total = 0;
  for (const h of packet.headers) {
    if (h.bytes === undefined) return null;
    total += h.bytes;
  }
  return total;
}
