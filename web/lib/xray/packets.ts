import type { Header, Packet, PacketFrame, Step, StepData } from "./types";

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
  // Documentation addresses aside, these two have fixed meanings (RFC 1122).
  const note = (a: string) =>
    a === "0.0.0.0" ? "0.0.0.0 (no address yet)" : a === "255.255.255.255" ? "255.255.255.255 (everyone)" : a;
  return {
    kind: "ip",
    title: "IPv4",
    bytes: 20,
    fields: [
      { name: "Source", value: note(src) },
      { name: "Destination", value: note(dst) },
      { name: "TTL", value: String(ttl) },
      { name: "Protocol", value: proto === "UDP" ? "17 (UDP)" : "6 (TCP)" },
    ],
  };
}

const WELL_KNOWN_PORTS: Record<number, string> = {
  53: "53 (DNS)",
  67: "67 (DHCP server)",
  68: "68 (DHCP client)",
};

const portLabel = (port: number) => WELL_KNOWN_PORTS[port] ?? String(port);

export function udp(sport: number, dport: number): Header {
  return {
    kind: "udp",
    title: "UDP",
    bytes: 8,
    fields: [
      { name: "Source port", value: portLabel(sport) },
      { name: "Destination port", value: portLabel(dport) },
    ],
  };
}

type DhcpMessage = "DISCOVER" | "OFFER" | "REQUEST" | "ACK";

/** DHCP (RFC 2131); the message type travels in option 53. */
export function dhcp(type: DhcpMessage): Header {
  const code = { DISCOVER: 1, OFFER: 2, REQUEST: 3, ACK: 5 }[type];
  const fields: Header["fields"] = [{ name: "Message", value: `DHCP${type} (option 53 = ${code})` }];
  if (type === "DISCOVER") {
    fields.push(
      { name: "Client", value: `${NET.host.mac} (this computer)` },
      { name: "Asks for", value: "an address, the router, DNS servers" },
    );
  } else if (type === "REQUEST") {
    fields.push(
      { name: "Requested address", value: NET.host.ip },
      { name: "Server", value: NET.router.ip },
    );
  } else {
    fields.push({ name: "Your address", value: NET.host.ip });
    if (type === "ACK") {
      fields.push(
        { name: "Router", value: NET.router.ip },
        { name: "DNS server", value: NET.router.ip },
        { name: "Lease", value: "a time limit, then it renews" },
      );
    } else {
      fields.push({ name: "Server", value: NET.router.ip });
    }
  }
  return { kind: "dhcp", title: `DHCP ${type}`, fields };
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

/**
 * What a step moves: its own figure, or, for a step that carries a packet,
 * report or command of known size, that packet's bytes. Ethernet frames add
 * a 4-byte checksum (the FCS) on the wire.
 */
export function dataOf(step: Step): StepData | null {
  if (step.data) return step.data;
  const packet = step.frames?.at(-1)?.packet;
  if (!packet) return null;
  const bytes = packetBytes(packet);
  if (bytes === null) return null;
  const wire = packet.headers[0]?.kind === "eth";
  return { amount: `${bytes} bytes${wire ? " + 4" : ""}`, what: `${packet.caption}${wire ? ", and a 4-byte checksum on the wire" : ""}` };
}

export function packetBytes(packet: Packet): number | null {
  let total = 0;
  for (const h of packet.headers) {
    if (h.bytes === undefined) return null;
    total += h.bytes;
  }
  return total;
}
