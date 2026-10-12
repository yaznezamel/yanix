import {
  NET,
  arp,
  dnsAnswer,
  dnsQuery,
  eth,
  frame,
  http,
  ipv4,
  searchPath,
  searchUrl,
  tcp,
  tls,
  udp,
} from "../packets";
import type { AwsNote, Header, MachineState, NodeId, Scenario, Step } from "../types";
import { keysStep } from "./common";

// A web search, from the Enter key to pixels: DNS (with ARP when the router's
// MAC address is unknown), the TCP and TLS handshakes, HTTP/2 and rendering.
// What is cached decides which of those happen at all.

const H = NET.host.ip;
const R = NET.router.ip;
const PUB = NET.router.publicIp;
const RES = NET.resolver.ip;
const SRV = NET.server.ip;
const P = NET.ports;

// Headers reused across steps.
const ethOut = eth("router", "IPv4");
const ethIn = eth("host", "IPv4");
const udpOut = udp(P.dnsClient, 53);
const udpIn = udp(53, P.dnsClient);
const ipDnsOut = ipv4(H, R, "UDP");
const ipDnsIn = ipv4(R, H, "UDP");
const ipTcpOut = ipv4(H, SRV, "TCP");
const ipTcpNat = ipv4(PUB, SRV, "TCP", 63);
const ipTcpFromServer = ipv4(SRV, PUB, "TCP", "set by the server, minus each hop");
const ipTcpToHost = ipv4(SRV, H, "TCP", "set by the server, minus each hop");
const tcpSyn = tcp(P.tcpClient, 443, "SYN", {
  bytes: 40,
  note: "random sequence number · MSS, SACK, timestamps, window scale",
});
const tcpSynAck = tcp(443, P.tcpClient, "SYN, ACK");
const tcpAck = tcp(P.tcpClient, 443, "ACK");
const tcpDataOut = tcp(P.tcpClient, 443, "ACK, PSH");
const tcpDataIn = tcp(443, P.tcpClient, "ACK, PSH");

const clientHello = tls(
  "TLS ClientHello",
  "TLS 1.3 and 1.2 · key share · SNI www.example.com · ALPN h2",
  false,
);
const serverHello: Header = {
  kind: "tls",
  title: "TLS ServerHello",
  fields: [
    { name: "Contents", value: "TLS 1.3 · the server's key share" },
    { name: "Ciphertext", value: "certificate, signature and Finished, already encrypted" },
  ],
};
const clientFinished = tls("TLS Finished", "encrypted with the new session keys", true);
const appDataOut = tls("TLS application data", "an HTTP/2 request nobody on the way can read", true);
const appDataIn = tls("TLS application data", "the HTTP/2 response, still encrypted", true);
const httpResponse = http("HTTP/2 response (decrypted)", [
  { name: ":status", value: "200" },
  { name: "content-type", value: "text/html" },
]);

function httpRequest(query: string): Header {
  return http("HTTP/2 request (before encryption)", [
    { name: ":method", value: "GET" },
    { name: ":authority", value: NET.server.name },
    { name: ":path", value: searchPath(query) },
  ]);
}

const DNS_Q = "DNS query: the IPv4 address of www.example.com?";
const DNS_A = "DNS answer: www.example.com is 203.0.113.10";

// Where AWS does the same, for steps of either view: in the overview one step
// sweeps the stack, in the deep dive one step per layer carries the note.
const AWS_DNS_QUOTA: AwsNote = {
  service: "Amazon Route 53 Resolver",
  text: "On EC2 this query would go to the Route 53 Resolver, and each network interface may send it at most 1,024 packets per second, a quota that can't be raised. Every lookup here costs two packets, A and AAAA, which is why busy instances run a local DNS cache in front of it.",
};
const AWS_ENA_TX: AwsNote = {
  service: "Elastic Network Adapter (ENA)",
  text: "On current EC2 instances the network card is the Elastic Network Adapter, a Nitro card. Its driver in this same kernel, drivers/net/ethernet/amazon/ena, fills transmit rings the same way: descriptors in RAM, then a doorbell write that tells the card there is work.",
};
const AWS_ENA_RX: AwsNote = {
  service: "Elastic Network Adapter (ENA)",
  text: "An ENA card has several queue pairs, each with its own MSI-X interrupt, and receive-side scaling hashes each connection to one queue. Different vCPUs can then handle different connections at the same time.",
};
const AWS_FLOW_LOGS: AwsNote = {
  service: "Amazon VPC Flow Logs",
  text: "In a VPC, flow logs record connections like this one: addresses, ports, packets, bytes, and whether security groups and network ACLs accepted or rejected them. Their tcp-flags field is a bitmask of the flags seen: 2 for this SYN, 18 for the SYN-ACK that answers it.",
};

// ---------------------------------------------------------------- search

function dnsSteps(m: MachineState): Step[] {
  const steps: Step[] = [
    {
      id: "host-cache",
      phase: "dns",
      mode: "deep",
      path: ["netsvc"],
      title: "Is the address already known?",
      body: "The network service checks its own host cache first. Nothing for www.example.com, so it asks the system resolver.",
      code: [{ project: "chromium", path: "net/dns/host_resolver_manager.cc" }],
      timescale: "ns",
    },
    {
      id: "getaddrinfo",
      phase: "dns",
      path: ["netsvc", "glibc"],
      title: "getaddrinfo(\"www.example.com\")",
      body: "glibc's resolver follows /etc/nsswitch.conf: /etc/hosts first, then DNS. /etc/resolv.conf names the DNS server: the home router, 192.168.1.1, as DHCP said at boot. Many distributions put a local cache (systemd-resolved) in between; this model leaves it out.",
      code: [{ project: "glibc", path: "nss/getaddrinfo.c", symbol: "getaddrinfo" }],
      timescale: "us",
      aws: {
        service: "Amazon Route 53 Resolver",
        text: "On an EC2 instance, DHCP names a different DNS server: the Route 53 Resolver, at the VPC's base address plus two (10.0.0.2 in a 10.0.0.0/16 VPC), and also at 169.254.169.253.",
      },
      ui: { browser: { status: "Resolving host…", progress: 0.1 } },
    },
    {
      id: "udp-socket",
      phase: "dns",
      mode: "deep",
      path: ["glibc", "syscall", "socket"],
      title: "socket(): a UDP socket",
      body: "glibc asks for a UDP socket. The kernel allocates a struct socket and its struct sock, and returns a file descriptor.",
      code: [
        { project: "linux", path: "net/socket.c", symbol: "__sys_socket" },
        { project: "linux", path: "net/ipv4/af_inet.c", symbol: "inet_create" },
      ],
      timescale: "us",
    },
  ];

  // Transmit, overview: one sweep down the stack (stopping at the neighbour
  // layer when ARP has to run first).
  const sweep: NodeId[] = m.arpCached
    ? ["glibc", "syscall", "socket", "udp", "ip", "neigh", "qdisc", "nicdrv", "nic"]
    : ["glibc", "syscall", "socket", "udp", "ip", "neigh"];
  const sweepFrames = [
    frame(0, DNS_Q, dnsQuery),
    frame(3, DNS_Q, udpOut, dnsQuery),
    frame(4, DNS_Q, ipDnsOut, udpOut, dnsQuery),
  ];
  if (m.arpCached) sweepFrames.push(frame(5, DNS_Q, ethOut, ipDnsOut, udpOut, dnsQuery));
  steps.push({
    id: "dns-tx",
    phase: "dns",
    mode: "overview",
    path: sweep,
    frames: sweepFrames,
    title: "sendmmsg(): down the network stack",
    body: m.arpCached
      ? "glibc sends the question, together with the IPv6 (AAAA) one, in a single sendmmsg() call. UDP adds ports, IP adds addresses and a route, the neighbour layer adds the router's MAC address from its cache, and the driver hands the frame to the card."
      : "glibc sends the question, together with the IPv6 (AAAA) one, in a single sendmmsg() call. UDP adds ports and IP adds addresses and a route. But the neighbour layer doesn't know the router's MAC address yet.",
    code: [
      { project: "glibc", path: "resolv/res_send.c" },
      { project: "linux", path: "net/ipv4/udp.c", symbol: "udp_sendmsg" },
      { project: "linux", path: "net/core/dev.c", symbol: "__dev_queue_xmit" },
    ],
    timescale: "us",
    aws: AWS_DNS_QUOTA,
  });

  // Transmit, deep dive: one step per layer.
  steps.push(
    {
      id: "dns-syscall",
      phase: "dns",
      mode: "deep",
      path: ["glibc", "syscall", "socket"],
      frames: [frame(0, DNS_Q, dnsQuery)],
      title: "sendmmsg(): the query enters the kernel",
      body: "glibc builds a 33-byte DNS question and sends it, with the IPv6 (AAAA) question, in one sendmmsg() system call. The CPU switches from user mode to kernel mode.",
      code: [{ project: "linux", path: "net/socket.c", symbol: "__sys_sendmmsg" }],
      timescale: "ns",
      data: {
        amount: "2 × 33 bytes",
        what: "two DNS questions, A (IPv4) and AAAA (IPv6), copied from glibc's memory into the kernel by one system call",
      },
      aws: AWS_DNS_QUOTA,
    },
    {
      id: "dns-udp",
      phase: "dns",
      mode: "deep",
      path: ["socket", "udp"],
      frames: [frame(0, DNS_Q, dnsQuery), frame(1, DNS_Q, udpOut, dnsQuery)],
      title: "UDP adds ports",
      body: "udp_sendmsg() adds an 8-byte header: source port 53214, picked from the ephemeral range 32768–60999, and destination port 53, the DNS port.",
      code: [{ project: "linux", path: "net/ipv4/udp.c", symbol: "udp_sendmsg" }],
      timescale: "us",
    },
    {
      id: "dns-ip",
      phase: "dns",
      mode: "deep",
      path: ["udp", "ip"],
      frames: [frame(0, DNS_Q, udpOut, dnsQuery), frame(1, DNS_Q, ipDnsOut, udpOut, dnsQuery)],
      title: "IP: addresses and a route",
      body: "The routing table (FIB) says 192.168.1.1 is on the local network, reachable directly through eth0. A 20-byte IPv4 header is added: source 192.168.1.23, destination 192.168.1.1, TTL 64.",
      code: [
        { project: "linux", path: "net/ipv4/route.c", symbol: "ip_route_output_flow" },
        { project: "linux", path: "net/ipv4/ip_output.c", symbol: "ip_make_skb" },
      ],
      timescale: "us",
      aws: {
        service: "Amazon VPC route tables",
        text: "A VPC's route table makes the same choice one level out: a local route for addresses inside the VPC, and 0.0.0.0/0 to an internet gateway or a NAT gateway for everything else. As in the FIB, the most specific matching route wins.",
      },
    },
    {
      id: "dns-netfilter",
      phase: "dns",
      mode: "deep",
      path: ["ip"],
      frames: [frame(0, DNS_Q, ipDnsOut, udpOut, dnsQuery)],
      title: "Firewall hooks",
      body: "Netfilter runs the OUTPUT and POSTROUTING hooks, where nftables or iptables rules could drop or rewrite the packet. Nothing objects, so it continues.",
      code: [{ project: "linux", path: "net/netfilter/core.c", symbol: "nf_hook_slow" }],
      timescale: "ns",
      aws: {
        service: "Security groups and network ACLs",
        text: "nftables rules live in this kernel, so root on the machine can change them. A security group is a stateful firewall on an EC2 instance's network interface, outside its operating system: nothing inside the instance can turn it off. Network ACLs add stateless rules at the subnet's edge.",
      },
    },
  );
  if (m.arpCached) {
    steps.push({
      id: "dns-neigh",
      phase: "dns",
      mode: "deep",
      path: ["ip", "neigh"],
      frames: [
        frame(0, DNS_Q, ipDnsOut, udpOut, dnsQuery),
        frame(1, DNS_Q, ethOut, ipDnsOut, udpOut, dnsQuery),
      ],
      title: "Neighbour: the router's MAC address",
      body: "The neighbour table already maps 192.168.1.1 to 00:00:5e:00:53:fe, so a 14-byte Ethernet header goes on: destination the router, source this computer, type IPv4.",
      code: [{ project: "linux", path: "net/core/neighbour.c" }],
      timescale: "ns",
    });
  } else {
    steps.push({
      id: "dns-neigh-miss",
      phase: "dns",
      mode: "deep",
      path: ["ip", "neigh"],
      frames: [frame(0, DNS_Q, ipDnsOut, udpOut, dnsQuery)],
      title: "Neighbour: who is 192.168.1.1?",
      body: "The neighbour table has no entry for the router yet. The kernel parks the DNS packet on the entry's queue and asks with ARP.",
      code: [
        { project: "linux", path: "net/core/neighbour.c", symbol: "__neigh_event_send" },
      ],
      timescale: "ns",
    });
  }

  if (!m.arpCached) {
    steps.push(
      {
        id: "arp-request",
        phase: "arp",
        path: ["neigh", "nicdrv", "nic", "router"],
        frames: [frame(0, "ARP request: who has 192.168.1.1?", eth("broadcast", "ARP"), arp("request"))],
        title: "ARP: who has 192.168.1.1?",
        body: "The kernel broadcasts an ARP request to every device on the local network: who has 192.168.1.1? Tell 192.168.1.23.",
        code: [{ project: "linux", path: "net/ipv4/arp.c", symbol: "arp_solicit" }],
        timescale: "us",
        aws: {
          service: "Amazon VPC",
          text: "An EC2 instance asks the same about its gateway, the VPC router, which always sits at the subnet's base address plus one (10.0.0.1 in 10.0.0.0/24). A VPC doesn't support broadcast, though, so the request is never flooded to the other instances in the subnet.",
        },
      },
      {
        id: "arp-reply",
        phase: "arp",
        path: ["router", "nic", "irq", "nicdrv", "neigh"],
        frames: [frame(0, "ARP reply: 192.168.1.1 is at 00:00:5e:00:53:fe", eth("host", "ARP"), arp("reply"))],
        title: "ARP reply: the router's MAC address",
        learns: { arpCached: true },
        body: "The router answers just this computer: 192.168.1.1 is at 00:00:5e:00:53:fe. The kernel stores that in the neighbour table and releases the parked DNS packet.",
        code: [{ project: "linux", path: "net/ipv4/arp.c", symbol: "arp_rcv" }],
        timescale: "us",
      },
      {
        id: "dns-tx-release",
        phase: "dns",
        mode: "overview",
        path: ["neigh", "qdisc", "nicdrv", "nic"],
        frames: [frame(0, DNS_Q, ethOut, ipDnsOut, udpOut, dnsQuery)],
        title: "The DNS query goes on its way",
        body: "With the MAC address known, the Ethernet header goes on, the frame passes the queue and the driver, and the card fetches it from RAM with DMA.",
        code: [{ project: "linux", path: "net/core/dev.c", symbol: "dev_hard_start_xmit" }],
        timescale: "us",
        aws: AWS_ENA_TX,
      },
      {
        id: "dns-neigh-release",
        phase: "dns",
        mode: "deep",
        path: ["neigh"],
        frames: [frame(0, DNS_Q, ethOut, ipDnsOut, udpOut, dnsQuery)],
        title: "The parked packet goes on",
        body: "With the router's MAC address known, the kernel adds the 14-byte Ethernet header to the parked DNS packet and sends it on.",
        code: [{ project: "linux", path: "net/core/neighbour.c" }],
        timescale: "ns",
      },
    );
  }

  const onWire = [ethOut, ipDnsOut, udpOut, dnsQuery];
  steps.push(
    {
      id: "dns-qdisc",
      phase: "dns",
      mode: "deep",
      path: ["neigh", "qdisc"],
      frames: [frame(0, DNS_Q, ...onWire)],
      title: "The queueing discipline",
      body: "dev_queue_xmit() hands the frame to the interface's qdisc (often fq_codel), which decides what goes next and keeps queues short.",
      code: [{ project: "linux", path: "net/core/dev.c", symbol: "__dev_queue_xmit" }],
      timescale: "us",
    },
    {
      id: "dns-driver",
      phase: "dns",
      mode: "deep",
      path: ["qdisc", "nicdrv"],
      frames: [frame(0, DNS_Q, ...onWire)],
      title: "The driver fills a descriptor",
      body: "The driver writes a descriptor (where the frame sits in RAM and how long it is) into the transmit ring, then writes the card's tail register to signal new work.",
      code: [
        { project: "linux", path: "net/core/dev.c", symbol: "dev_hard_start_xmit" },
        { project: "linux", path: "drivers/net/ethernet/realtek/r8169_main.c", symbol: "rtl8169_start_xmit" },
      ],
      timescale: "us",
      aws: AWS_ENA_TX,
    },
    {
      id: "dns-dma",
      phase: "dns",
      mode: "deep",
      path: ["nicdrv", "ram", "nic"],
      frames: [frame(0, DNS_Q, ...onWire)],
      title: "DMA: the card fetches the frame",
      body: "The network card reads the descriptor, then the frame itself, straight from RAM with DMA. From here on the CPU is free to do other work.",
      timescale: "us",
      aws: {
        service: "Elastic Network Adapter (ENA)",
        text: "ENA's low-latency queue mode skips this fetch for small packets: the driver pushes the descriptor and the first 96 bytes of the packet straight into the card's memory. This 75-byte frame would fit whole, so the card would read nothing from RAM.",
      },
    },
    {
      id: "dns-wire",
      phase: "dns",
      path: ["nic", "router"],
      frames: [frame(0, DNS_Q, ...onWire)],
      title: "On the wire",
      body: "The card appends a 4-byte checksum (FCS) and sends the frame, 79 bytes in all, as electrical signals over the Ethernet cable to the router. At 1 Gbit/s that takes under a microsecond.",
      timescale: "us",
    },
  );

  if (m.dnsCached) {
    steps.push({
      id: "router-cache",
      phase: "dns",
      path: ["router"],
      frames: [frame(0, DNS_Q, ipDnsOut, udpOut, dnsQuery)],
      title: "The router answers from its cache",
      body: "The router's DNS forwarder looked up www.example.com a moment ago and still has the answer cached, so nothing leaves your home.",
      timescale: "us",
      aws: {
        service: "Amazon Route 53 Resolver",
        text: "The Route 53 Resolver is a caching resolver too: it keeps each answer for as long as the record's TTL allows, so repeated lookups from a VPC's instances are answered at once.",
      },
    });
  } else {
    const fwdIp = ipv4(PUB, RES, "UDP");
    const fwdUdp = udp(P.routerDns, 53);
    steps.push(
      {
        id: "router-forward",
        phase: "dns",
        path: ["router", "isp", "resolver"],
        frames: [
          frame(0, DNS_Q, ipDnsOut, udpOut, dnsQuery),
          frame(1, DNS_Q, fwdIp, fwdUdp, dnsQuery),
        ],
        title: "The router forwards the question",
        body: "The router's DNS forwarder (often dnsmasq) has nothing cached, so it asks your ISP's recursive resolver, sending from its own public address, 198.51.100.7.",
        timescale: "ms",
        aws: {
          service: "Amazon Route 53 Resolver",
          text: "In a VPC the Route 53 Resolver does both jobs, the router's and the ISP resolver's: it answers from its cache or resolves the name itself. Names you choose, such as corp.example.com, can go to your own DNS servers instead, through a forwarding rule and an outbound endpoint.",
        },
      },
      {
        id: "resolver-root",
        phase: "dns",
        path: ["resolver", "root", "resolver"],
        frames: [frame(0, "Where is www.example.com?", ipv4(RES, "a root server", "UDP"), udp(P.routerDns, 53), dnsQuery)],
        title: "Ask a root server",
        body: "The resolver starts at the top of the DNS tree. A root server doesn't know www.example.com, but it knows who serves .com and replies with a referral to them.",
        timescale: "ms",
      },
      {
        id: "resolver-tld",
        phase: "dns",
        path: ["resolver", "tld", "resolver"],
        frames: [frame(0, "Where is www.example.com?", ipv4(RES, "a .com server", "UDP"), udp(P.routerDns, 53), dnsQuery)],
        title: "Ask a .com server",
        body: "A .com server doesn't have the address either, but it knows example.com's name servers and refers the resolver to them.",
        timescale: "ms",
      },
      {
        id: "resolver-auth",
        phase: "dns",
        path: ["resolver", "auth", "resolver"],
        frames: [frame(0, "Where is www.example.com?", ipv4(RES, "an example.com server", "UDP"), udp(P.routerDns, 53), dnsQuery)],
        title: "Ask example.com's own server",
        body: "The authoritative server answers: www.example.com is 203.0.113.10. Busy resolvers usually have the root and .com referrals cached already; this shows the full walk.",
        timescale: "ms",
        aws: {
          service: "Amazon Route 53",
          text: "If example.com were a public hosted zone in Route 53, this server would be one of the four name servers Route 53 lists for every hosted zone, with names like ns-2048.awsdns-64.com, ns-2049.awsdns-65.net, ns-2050.awsdns-66.org and ns-2051.awsdns-67.co.uk.",
        },
      },
      {
        id: "resolver-answer",
        phase: "dns",
        path: ["resolver", "isp", "router"],
        frames: [frame(0, DNS_A, ipv4(RES, PUB, "UDP"), udp(53, P.routerDns), dnsAnswer)],
        title: "The answer comes back",
        learns: { dnsCached: true },
        body: "The resolver caches the answer for its TTL and sends it to the router, which keeps a copy in its own cache for next time.",
        timescale: "ms",
        aws: {
          service: "Amazon Route 53",
          text: "The TTL, 3600 seconds here, is how long every cache on the way may reuse this answer. It also sets how fast DNS failover can be: when a Route 53 health check switches a record to a standby, resolvers keep handing out the old address until their copy expires.",
        },
      },
    );
  }

  const inFrame = [ethIn, ipDnsIn, udpIn, dnsAnswer];
  steps.push(
    {
      id: "router-reply",
      phase: "dns",
      path: ["router", "nic"],
      frames: [frame(0, DNS_A, ...inFrame)],
      title: "Back on our cable",
      body: "The router wraps the answer in a new Ethernet frame addressed to this computer: destination MAC 00:00:5e:00:53:01, destination port 53214.",
      timescale: "us",
    },
    {
      id: "dns-rx",
      phase: "dns",
      mode: "overview",
      path: ["nic", "ram", "irq", "nicdrv", "ip", "udp", "socket"],
      frames: [
        frame(0, DNS_A, ...inFrame),
        frame(4, DNS_A, ipDnsIn, udpIn, dnsAnswer),
        frame(5, DNS_A, udpIn, dnsAnswer),
        frame(6, DNS_A, dnsAnswer),
      ],
      title: "Up the network stack",
      body: "The card writes the frame into RAM with DMA and raises an interrupt. The driver's NAPI poll hands it to the stack: the Ethernet and IP headers are checked and removed, and UDP queues the answer on the socket waiting on port 53214.",
      code: [
        { project: "linux", path: "net/core/dev.c", symbol: "net_rx_action" },
        { project: "linux", path: "net/ipv4/udp.c", symbol: "udp_rcv" },
      ],
      timescale: "us",
      aws: AWS_ENA_RX,
    },
    {
      id: "rx-dma",
      phase: "dns",
      mode: "deep",
      path: ["nic", "ram"],
      frames: [frame(0, DNS_A, ...inFrame)],
      title: "The card writes the frame into RAM",
      body: "The driver gave the card empty buffers in a receive ring. The card checks the checksum, copies the frame into the next buffer with DMA and marks the descriptor done.",
      timescale: "us",
    },
    {
      id: "rx-irq",
      phase: "dns",
      mode: "deep",
      path: ["nic", "irq"],
      frames: [frame(0, DNS_A, ...inFrame)],
      title: "Interrupt",
      body: "The card raises an interrupt (MSI-X). The driver's handler does very little: it masks the card's interrupts and schedules NAPI.",
      code: [
        { project: "linux", path: "kernel/irq/handle.c" },
        { project: "linux", path: "net/core/dev.c", symbol: "__napi_schedule" },
      ],
      timescale: "us",
      aws: AWS_ENA_RX,
    },
    {
      id: "rx-napi",
      phase: "dns",
      mode: "deep",
      path: ["irq", "nicdrv"],
      frames: [frame(0, DNS_A, ...inFrame)],
      title: "NAPI poll in a softirq",
      body: "In the NET_RX softirq, net_rx_action() calls the driver's poll function, which wraps each new frame in an sk_buff. Polling a batch instead of taking one interrupt per packet keeps busy links efficient.",
      code: [
        { project: "linux", path: "net/core/dev.c", symbol: "net_rx_action" },
        { project: "linux", path: "drivers/net/ethernet/realtek/r8169_main.c", symbol: "rtl8169_poll" },
      ],
      timescale: "us",
    },
    {
      id: "rx-eth",
      phase: "dns",
      mode: "deep",
      path: ["nicdrv", "ip"],
      frames: [frame(0, DNS_A, ...inFrame), frame(1, DNS_A, ipDnsIn, udpIn, dnsAnswer)],
      title: "The Ethernet header comes off",
      body: "eth_type_trans() reads the EtherType, 0x0800 (IPv4); the 14-byte Ethernet header is pulled off and the packet goes to IPv4.",
      code: [
        { project: "linux", path: "net/ethernet/eth.c", symbol: "eth_type_trans" },
        { project: "linux", path: "net/core/dev.c", symbol: "__netif_receive_skb_core" },
      ],
      timescale: "us",
    },
    {
      id: "rx-ip",
      phase: "dns",
      mode: "deep",
      path: ["ip"],
      frames: [frame(0, DNS_A, ipDnsIn, udpIn, dnsAnswer)],
      title: "IP: is this for me?",
      body: "ip_rcv() checks the header and runs the PREROUTING hook. The route lookup says 192.168.1.23 is a local address, so ip_local_deliver() runs the INPUT hook and passes the packet to UDP.",
      code: [
        { project: "linux", path: "net/ipv4/ip_input.c", symbol: "ip_rcv" },
        { project: "linux", path: "net/ipv4/ip_input.c", symbol: "ip_local_deliver" },
      ],
      timescale: "us",
    },
    {
      id: "rx-udp",
      phase: "dns",
      mode: "deep",
      path: ["ip", "udp", "socket"],
      frames: [
        frame(0, DNS_A, ipDnsIn, udpIn, dnsAnswer),
        frame(1, DNS_A, udpIn, dnsAnswer),
        frame(2, DNS_A, dnsAnswer),
      ],
      title: "UDP finds the socket",
      body: "udp_rcv() looks up the socket bound to port 53214, appends the answer to its receive queue and wakes up whoever waits on it.",
      code: [
        { project: "linux", path: "net/ipv4/udp.c", symbol: "udp_rcv" },
        { project: "linux", path: "net/core/sock.c", symbol: "sock_def_readable" },
      ],
      timescale: "us",
    },
    {
      id: "rx-wake",
      phase: "dns",
      mode: "deep",
      path: ["socket", "sched", "glibc"],
      title: "glibc wakes up",
      body: "glibc was blocked in poll() on the socket. The wake-up makes its thread runnable again, and the scheduler gives it a CPU core.",
      code: [{ project: "linux", path: "kernel/sched/core.c", symbol: "try_to_wake_up" }],
      timescale: "us",
    },
    {
      id: "dns-recv",
      phase: "dns",
      path: ["socket", "syscall", "glibc"],
      frames: [frame(0, DNS_A, dnsAnswer)],
      title: "recvfrom(): the answer reaches glibc",
      body: "glibc calls recvfrom(). The kernel copies the answer from the socket's queue into glibc's memory and returns to user mode. glibc parses it: www.example.com is 203.0.113.10.",
      code: [
        { project: "linux", path: "net/ipv4/udp.c", symbol: "udp_recvmsg" },
        { project: "linux", path: "net/core/datagram.c", symbol: "skb_copy_datagram_iter" },
      ],
      timescale: "us",
    },
    {
      id: "dns-done",
      phase: "dns",
      path: ["glibc", "netsvc"],
      title: "Name resolved",
      body: "getaddrinfo() returns 203.0.113.10 to the network service. Now it can open a connection.",
      timescale: "ns",
      ui: { browser: { status: "Connecting to www.example.com…", progress: 0.25 } },
    },
  );
  return steps;
}

function tcpSteps(): Step[] {
  const synOut = [ethOut, ipTcpOut, tcpSyn];
  return [
    {
      id: "tcp-syn",
      phase: "tcp",
      mode: "overview",
      path: ["netsvc", "syscall", "socket", "tcp", "ip", "neigh", "nicdrv", "nic"],
      frames: [
        frame(3, "TCP SYN: let's talk", tcpSyn),
        frame(4, "TCP SYN: let's talk", ipTcpOut, tcpSyn),
        frame(5, "TCP SYN: let's talk", ...synOut),
      ],
      title: "connect(): TCP sends a SYN",
      body: "The network service opens a TCP socket and calls connect() to 203.0.113.10, port 443. The kernel picks source port 41870, moves the socket to SYN-SENT and sends a SYN. The router's MAC address is cached now, so no ARP this time.",
      code: [
        { project: "linux", path: "net/ipv4/tcp_ipv4.c", symbol: "tcp_v4_connect" },
        { project: "linux", path: "net/ipv4/tcp_output.c", symbol: "tcp_connect" },
      ],
      timescale: "us",
      aws: AWS_FLOW_LOGS,
    },
    {
      id: "tcp-connect",
      phase: "tcp",
      mode: "deep",
      path: ["netsvc", "syscall", "socket", "tcp"],
      frames: [frame(3, "TCP SYN: let's talk", tcpSyn)],
      title: "connect(): TCP builds a SYN",
      body: "A non-blocking connect() returns at once; the browser learns the result later through epoll. tcp_v4_connect() picks source port 41870, sets the state to SYN-SENT and builds a SYN with a random initial sequence number.",
      code: [
        { project: "linux", path: "net/ipv4/af_inet.c", symbol: "inet_stream_connect" },
        { project: "linux", path: "net/ipv4/tcp_ipv4.c", symbol: "tcp_v4_connect" },
      ],
      timescale: "us",
    },
    {
      id: "tcp-syn-out",
      phase: "tcp",
      mode: "deep",
      path: ["tcp", "ip", "neigh", "qdisc", "nicdrv", "nic"],
      frames: [
        frame(0, "TCP SYN: let's talk", tcpSyn),
        frame(1, "TCP SYN: let's talk", ipTcpOut, tcpSyn),
        frame(2, "TCP SYN: let's talk", ...synOut),
      ],
      title: "Down the same road as the DNS query",
      body: "IP routes it to the router (the default gateway), the neighbour table supplies the router's MAC address from its cache, and the qdisc, driver and DMA send it out.",
      code: [{ project: "linux", path: "net/ipv4/ip_output.c", symbol: "__ip_queue_xmit" }],
      timescale: "us",
      aws: AWS_FLOW_LOGS,
    },
    {
      id: "tcp-nat",
      phase: "tcp",
      path: ["nic", "router", "isp", "server"],
      frames: [
        frame(0, "TCP SYN", ...synOut),
        frame(2, "TCP SYN, after NAT", ipTcpNat, tcpSyn),
      ],
      title: "NAT: the router swaps the address",
      body: "The router replaces the private source address 192.168.1.23 with its public address 198.51.100.7, records the mapping in its connection table, lowers the TTL by one and forwards the SYN across the internet.",
      timescale: "ms",
      aws: {
        service: "AWS NAT gateway",
        text: "A NAT gateway does this for instances in a private subnet: it replaces their private source address with its own Elastic IP address and translates the replies back. Each of its addresses supports up to 55,000 simultaneous connections to each unique destination (the same IP address, port and protocol).",
      },
    },
    {
      id: "tcp-synack",
      phase: "tcp",
      path: ["server", "isp", "router", "nic"],
      frames: [
        frame(0, "TCP SYN-ACK: sure", ipTcpFromServer, tcpSynAck),
        frame(3, "TCP SYN-ACK, after NAT", ethIn, ipTcpToHost, tcpSynAck),
      ],
      title: "SYN-ACK comes back",
      body: "The server accepts with a SYN-ACK. The router finds the mapping in its connection table, rewrites the destination back to 192.168.1.23 and sends it to this computer.",
      timescale: "ms",
      aws: {
        service: "Elastic Load Balancing",
        text: "Behind an Application Load Balancer, this SYN-ACK would come from the load balancer itself: an ALB completes the handshake and opens its own connections to your servers. A Network Load Balancer passes the TCP connection through, so the server behind it answers.",
      },
    },
    {
      id: "tcp-established",
      phase: "tcp",
      path: ["nic", "irq", "nicdrv", "ip", "tcp"],
      frames: [
        frame(0, "TCP SYN-ACK", ethIn, ipTcpToHost, tcpSynAck),
        frame(3, "TCP SYN-ACK", ipTcpToHost, tcpSynAck),
        frame(4, "TCP SYN-ACK", tcpSynAck),
      ],
      title: "The kernel completes the handshake",
      body: "tcp_v4_rcv() matches the SYN-ACK to the waiting socket. tcp_rcv_state_process() moves it to ESTABLISHED and sends the final ACK itself: the browser doesn't have to do anything for it.",
      code: [
        { project: "linux", path: "net/ipv4/tcp_ipv4.c", symbol: "tcp_v4_rcv" },
        { project: "linux", path: "net/ipv4/tcp_input.c", symbol: "tcp_rcv_state_process" },
      ],
      timescale: "us",
    },
    {
      id: "tcp-ack",
      phase: "tcp",
      path: ["tcp", "ip", "nicdrv", "nic", "router", "isp", "server"],
      frames: [
        frame(0, "TCP ACK: connected", tcpAck),
        frame(1, "TCP ACK: connected", ipTcpOut, tcpAck),
        frame(2, "TCP ACK: connected", ethOut, ipTcpOut, tcpAck),
        frame(5, "TCP ACK, after NAT", ipTcpNat, tcpAck),
      ],
      title: "ACK: connected",
      body: "The ACK completes the three-way handshake. epoll reports the socket as writable, so the network service knows the connection is ready.",
      timescale: "ms",
      ui: { browser: { status: "Establishing secure connection…", progress: 0.38 } },
    },
  ];
}

const OUT_PATH: NodeId[] = [
  "netsvc", "syscall", "socket", "tcp", "ip", "nicdrv", "nic", "router", "isp", "server",
];
const IN_PATH: NodeId[] = [
  "server", "isp", "router", "nic", "irq", "nicdrv", "ip", "tcp", "socket", "syscall", "netsvc",
];

function outFrames(caption: string, payload: Header, plain?: Header) {
  return [
    ...(plain ? [frame(0, caption, plain)] : [frame(0, caption, payload)]),
    frame(1, caption, payload),
    frame(3, caption, tcpDataOut, payload),
    frame(4, caption, ipTcpOut, tcpDataOut, payload),
    frame(5, caption, ethOut, ipTcpOut, tcpDataOut, payload),
    frame(8, `${caption}, after NAT`, ipTcpNat, tcpDataOut, payload),
  ];
}

function inFrames(caption: string, payload: Header, plain?: Header) {
  const frames = [
    frame(0, caption, ipTcpFromServer, tcpDataIn, payload),
    frame(3, `${caption}, after NAT`, ethIn, ipTcpToHost, tcpDataIn, payload),
    frame(6, caption, ipTcpToHost, tcpDataIn, payload),
    frame(7, caption, tcpDataIn, payload),
    frame(8, caption, payload),
  ];
  if (plain) frames.push(frame(10, caption, plain));
  return frames;
}

function tlsSteps(): Step[] {
  return [
    {
      id: "tls-hello",
      phase: "tls",
      path: OUT_PATH,
      frames: outFrames("TLS ClientHello", clientHello),
      title: "TLS: ClientHello",
      body: "Encryption happens in user space. BoringSSL, inside the network service, builds a ClientHello: the TLS versions it supports, a key share and the server name (SNI), still readable at this point. The kernel just carries bytes.",
      code: [{ project: "boringssl", path: "ssl/handshake_client.cc" }],
      timescale: "ms",
      data: {
        amount: "1,541 bytes",
        what: "the ClientHello in one TLS record, as Chromium 141 sent it (measured). 1,216 of those bytes are one post-quantum key share, ML-KEM-768 with X25519, so on Ethernet it takes two TCP segments.",
      },
      aws: {
        service: "Application Load Balancer",
        text: "The server name in this ClientHello (SNI) is how one load balancer serves many sites: an ALB's HTTPS listener can hold several certificates and picks the one that matches the name the browser asked for.",
      },
    },
    {
      id: "tls-serverhello",
      phase: "tls",
      path: IN_PATH,
      frames: inFrames("TLS ServerHello", serverHello),
      title: "ServerHello and an encrypted certificate",
      body: "The server picks TLS 1.3 and sends its key share, then encrypts everything after it, certificate included. The kernel acknowledges and orders the TCP segments and wakes the network service to read them.",
      timescale: "ms",
      data: {
        amount: "1,120 bytes",
        what: "the server's key share alone, when it accepts the post-quantum group: an ML-KEM-768 ciphertext (1,088 bytes, FIPS 203) and an X25519 key (32 bytes). The certificate chain follows, encrypted.",
      },
      aws: {
        service: "Elastic Load Balancing",
        text: "On an ALB, the listener's security policy decides what the server may pick here: which TLS versions and cipher suites it accepts. ELBSecurityPolicy-TLS13-1-2-2021-06, for example, allows TLS 1.3 and 1.2 only.",
      },
    },
    {
      id: "tls-verify",
      phase: "tls",
      path: ["netsvc"],
      title: "Checking the certificate",
      learns: { connectionOpen: true },
      body: "Both sides derive the same session keys from the key shares. The network service checks that the certificate is valid for www.example.com and chains to a trusted root, and that the server proved it holds the private key. The lock icon appears.",
      ui: { browser: { secure: true, progress: 0.5 } },
      aws: {
        service: "AWS Certificate Manager",
        text: "The certificate checked here could come from ACM, which issues public certificates for load balancers and CloudFront at no extra cost and renews them automatically before they expire.",
      },
    },
    {
      id: "tls-finished",
      phase: "tls",
      mode: "deep",
      path: OUT_PATH,
      frames: outFrames("TLS Finished", clientFinished),
      title: "Client Finished",
      body: "The browser sends its Finished message, already encrypted. From here on, every byte is ciphertext to the kernel, the router and your ISP.",
      timescale: "ms",
      data: {
        amount: "36 bytes",
        what: "the Finished message, as Chromium 141 sent it (measured): a 32-byte keyed hash (HMAC-SHA-256) of the whole handshake, in a 58-byte encrypted record",
      },
    },
  ];
}

function httpSteps(query: string, reused: boolean): Step[] {
  return [
    {
      id: "http-request",
      phase: "http",
      path: OUT_PATH,
      frames: outFrames("HTTP/2 request", appDataOut, httpRequest(query)),
      title: reused ? "Straight to the request" : "The HTTP/2 request, encrypted",
      body: reused
        ? "The connection from your last search is still open: no DNS lookup, no TCP handshake, no TLS handshake. The encrypted HTTP/2 request goes straight out."
        : `Over the encrypted connection the browser sends an HTTP/2 request: GET ${searchPath(query)}. Every router on the way sees only encrypted bytes.`,
      code: [{ project: "chromium", path: "net/spdy/" }],
      timescale: "ms",
      ui: { browser: { status: "Waiting for www.example.com…", progress: 0.6 } },
      aws: {
        service: "Application Load Balancer",
        text: "An ALB decrypts this request and routes on what it carries: the host name, the path (/search here), headers or query strings. It takes HTTP/2 from browsers and sends HTTP/1.1 to its targets unless the target group asks for HTTP/2 or gRPC.",
      },
    },
    {
      id: "http-server",
      phase: "http",
      path: ["server"],
      title: "The server builds the page",
      body: "The server runs the search and renders the HTML. This happens far away; your computer just waits, and the browser stays responsive.",
      timescale: "ms",
      aws: {
        service: "Elastic Load Balancing",
        text: "On AWS the page could be built by EC2 instances, containers on Amazon ECS, or a Lambda function: an Application Load Balancer can send requests to any of them, and the browser can't tell which.",
      },
    },
    {
      id: "http-response",
      phase: "http",
      path: IN_PATH,
      frames: inFrames("HTTP/2 response", appDataIn, httpResponse),
      title: "The response streams back",
      body: "The HTML arrives as many TCP segments. The kernel acknowledges them, puts them in order and queues the bytes; the network service reads and decrypts them.",
      timescale: "ms",
      ui: { browser: { status: "Transferring data from www.example.com…", progress: 0.8 } },
      data: {
        amount: "1,448 bytes",
        what: "the most ciphertext one TCP segment carries on Ethernet: a 1,500-byte packet minus 20 bytes of IP header and 32 of TCP header with timestamps. A Linux server may send 10 segments, about 14 KB, before the first ACK comes back (TCP_INIT_CWND).",
      },
      aws: {
        service: "Amazon CloudFront",
        text: "CloudFront can compress a page like this with Brotli or gzip on the way, when the browser's Accept-Encoding header allows it, so fewer segments cross the internet.",
      },
    },
    {
      id: "http-ipc",
      phase: "render",
      path: ["netsvc", "renderer"],
      frames: [frame(0, "HTML for the renderer", httpResponse)],
      title: "Handing the page to the renderer",
      body: "The network service streams the decrypted HTML to a sandboxed renderer process through Chromium's IPC (Mojo), which on Linux runs over Unix domain sockets and shared memory.",
      code: [{ project: "chromium", path: "mojo/" }],
      timescale: "us",
    },
  ];
}

export function webSearch(query: string, m: MachineState): Scenario {
  const reused = m.connectionOpen;
  const steps: Step[] = [
    keysStep("key", "browser", "You press Enter", "Chromium"),
    {
      id: "omnibox",
      phase: "input",
      path: ["browser", "netsvc"],
      title: "Words become a URL",
      body: `The omnibox sees words, not an address, so it builds a search URL: ${searchUrl(query)}. The browser process asks the network service, a separate process, to fetch it.`,
      code: [{ project: "chromium", path: "services/network/" }],
      timescale: "us",
      ui: { browser: { progress: 0.05 } },
    },
  ];
  if (!reused) {
    steps.push(...dnsSteps(m), ...tcpSteps(), ...tlsSteps());
  }
  steps.push(...httpSteps(query, reused), {
    id: "render",
    phase: "render",
    path: ["renderer", "browser", "syscall", "drm", "display"],
    title: "From HTML to pixels",
    body: "The renderer parses the HTML, computes styles and layout, and paints. The browser's GPU process turns that into GPU work for the graphics driver, and the compositor shows the new frame.",
    code: [{ project: "linux", path: "drivers/gpu/drm/drm_ioctl.c" }],
    timescale: "ms",
    ui: {
      browser: {
        page: "results",
        loading: false,
        status: null,
        progress: 1,
        title: `${query.trim()} – Example Search`,
      },
    },
  });
  steps.push({
    id: "done",
    phase: "render",
    path: ["browser"],
    title: reused ? "Done: one round trip" : "Done, and a lot got cached",
    aws: {
      service: "Elastic Load Balancing",
      text: "Reuse has a time limit: an Application Load Balancer closes a connection that has carried no data for 60 seconds, its default idle timeout (adjustable from 1 to 4,000 seconds).",
    },
    body: reused
      ? "One encrypted request and response, no handshakes. Close the browser to drop the connection, or clear the caches to start cold."
      : "Search again and it is faster: the router and resolver cached the address, the kernel cached the router's MAC address, and the browser keeps this connection open.",
  });
  return {
    kind: "search",
    app: "browser",
    title: `Searching “${query.trim()}”`,
    focus: "machine",
    steps,
  };
}
