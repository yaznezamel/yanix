import { Fragment, type ReactNode } from "react";

// Abbreviations the traces use, spelled out where they first appear in a
// text: underlined with dots, and explained on hover.

const GLOSSARY: Record<string, string> = {
  ACM: "AWS Certificate Manager: issues and renews TLS certificates",
  ACPI: "Advanced Configuration and Power Interface: how the OS finds devices, manages power and turns the machine off",
  ALB: "Application Load Balancer: AWS's HTTP load balancer",
  AMI: "Amazon Machine Image: the disk image an EC2 instance starts from",
  ARP: "Address Resolution Protocol: asks the local network which MAC address has an IP address",
  ASLR: "Address space layout randomisation: a program's memory regions start at different addresses each run",
  DHCP: "Dynamic Host Configuration Protocol: how a computer gets its IP address when it joins a network",
  DMA: "Direct memory access: a device copies data to or from RAM by itself, without the CPU",
  EBS: "Elastic Block Store: network disks for EC2 instances",
  EC2: "Elastic Compute Cloud: AWS's virtual machines",
  ENA: "Elastic Network Adapter: the network card of current EC2 instances",
  FCS: "Frame check sequence: the 4-byte checksum at the end of every Ethernet frame",
  HID: "Human interface device: the USB class for keyboards and mice",
  IRQ: "Interrupt request: a device's signal that it needs the CPU",
  MAC: "Media access control address: a network card's own 48-bit hardware address",
  MMIO: "Memory-mapped I/O: a device's registers, read and written by the CPU at memory addresses",
  "ML-KEM-768": "A post-quantum key exchange, standardised in FIPS 203",
  "MSI-X": "Message-signalled interrupts: a device interrupts the CPU by writing to a set address, with one vector per queue",
  MSS: "Maximum segment size: the most data one TCP segment carries",
  MTU: "Maximum transmission unit: the largest packet a link carries, 1,500 bytes on Ethernet",
  NAPI: "The kernel's way of receiving packets in batches: polling the card instead of one interrupt per packet",
  NAT: "Network address translation: a router swaps private addresses for its own public one",
  NIC: "Network interface card: the network card",
  NLB: "Network Load Balancer: AWS's TCP and UDP load balancer",
  NVMe: "NVM Express: the protocol SSDs speak over PCIe",
  PCIe: "PCI Express: the fast serial links between the CPU and devices",
  PTY: "Pseudo-terminal: a pair of devices joined by the kernel, one end for the terminal app, the other for the shell",
  RSS: "Receive-side scaling: the network card spreads connections over several queues, and so over several CPU cores",
  SNI: "Server Name Indication: the site's name, sent in the first TLS message",
  SNS: "Simple Notification Service: AWS's publish and subscribe messaging",
  SQS: "Simple Queue Service: AWS's message queues",
  TLB: "Translation lookaside buffer: the CPU's cache of address translations",
  TTL: "Time to live: how long an answer may be cached (DNS), or how many more routers a packet may cross (IP)",
  UEFI: "Unified Extensible Firmware Interface: the firmware that starts a PC",
  vCPU: "Virtual CPU: what EC2 counts as one CPU; on most x86 types, one hardware thread of a core",
  VPC: "Virtual Private Cloud: your own private network inside AWS",
  X25519: "An elliptic-curve key exchange (RFC 7748)",
};

const TERMS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
const PATTERN = new RegExp(`(?<![\\w-])(${TERMS.map(escape).join("|")})s?(?![\\w-])`, "g");

/** The text, with the first use of each abbreviation in it explained. */
export function Glossed({ text }: { text: string }): ReactNode {
  const parts: ReactNode[] = [];
  const seen = new Set<string>();
  let last = 0;
  for (const match of text.matchAll(PATTERN)) {
    const term = match[1]!;
    if (seen.has(term)) continue;
    seen.add(term);
    const at = match.index;
    parts.push(text.slice(last, at));
    parts.push(
      <abbr
        key={at}
        title={GLOSSARY[term]}
        className="cursor-help underline decoration-white/35 decoration-dotted underline-offset-[3px]"
      >
        {match[0]}
      </abbr>,
    );
    last = at + match[0].length;
  }
  if (parts.length === 0) return text;
  parts.push(text.slice(last));
  return <Fragment>{parts}</Fragment>;
}
