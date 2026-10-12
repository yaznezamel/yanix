# 0008. Number the route, draw software as glass, and source every figure

- Status: accepted
- Date: 2026-10-12

## Context

Three complaints about the lab's traces, from using it:

- **The flow.** Each step drew one line that grew across the software map. It
  was hard to tell where a step started, which way it went, or how many stops
  it made.
- **The explanations.** They said what happens but rarely how much: how many
  bytes cross the wire, how big a key share is, how many samples a sound card
  reads each second. The request was real amounts of data, and examples from
  AWS, "as much as possible".
- **The layers.** Software and hardware looked alike, so the point where a
  driver hands work to a chip was easy to miss.

FR7 asks for the active component and connection to be highlighted at each
step, FR13 for the layers to look distinct during a trace, NFR1 for 60 fps,
NFR3 for reduced motion, and NFR9 for a source behind every size or latency
figure.

## Options considered

For the route:

1. **Keep the growing line**, thicker and brighter. Cheap, but it still shows
   neither the order nor the count of the stops.
2. **Number the stops and light them in turn.** Each hop is a straight line
   from one box's edge to the next, the signal pauses at each stop, and the
   story repeats the route as numbered chips.

For the layers:

1. **Colour bands only**, as before. Distinct, but flat.
2. **Glass over a board.** Hardware drawn solid on a static circuit-board
   background, software as translucent panes above it, and a contact rail
   where the kernel meets the hardware, labelled with the three ways they talk
   (MMIO, DMA, interrupts).

For figures and AWS examples:

1. **Typical values** where no exact one is known. Easy to write, but NFR9
   forbids figures without a source, and a guessed number taught as fact is
   worse than none.
2. **Only figures with a source**: computed from the model's own structures
   (the packet headers and kernel structs it already sizes), taken from a
   specification or from a kernel constant at the pinned version, or measured
   and labelled as measured. A figure that depends on an assumption names it
   ("at 1 Gbit/s", "per 1920×1080 frame").
3. **An AWS note on every step.** Many would be forced; an inaccurate analogy
   teaches the wrong thing about both sides.
4. **An AWS note where an AWS service does the same thing**, stated as AWS
   documents it, and none where the comparison would be forced.

## Decision

Route option 2, layer option 2, and figure options 2 and 4.

- `web/lib/xray/geometry.ts` builds each step's hops and the position of each
  stop's number. `XRayMap` draws the numbers, and lights each stop when the
  signal gets there (passed, current, ahead). The time per hop is equal
  rather than proportional to length, so short hops are not skipped.
- The board, panes and contact rail are one memoised SVG layer, so the glass
  costs about 1 fps in the headless frame-rate check.
- `Step.data` holds a step's amount and what it is. When a step has packets
  whose headers all have sizes, `dataOf()` works the amount out from them
  instead, adding the 4-byte Ethernet checksum on the wire. `Step.aws` holds a
  service name and a short note (60 words at most, tested). When packets fill
  the panel beside the story, a row of chips under the route shows the amount
  and the service, and each chip scrolls to its full sentence.

## Sources

Measured, on 2026-10-12, with headless Chromium 141.0.7390.37 connecting to
`openssl s_server -msg` (OpenSSL 3.0.13) on localhost, server name
www.example.com:

- The ClientHello is a 1,536-byte handshake message in a 1,541-byte TLS
  record. Its key_share extension is 1,263 bytes: a 1-byte GREASE share, a
  1,216-byte X25519MLKEM768 share and a 32-byte X25519 share.
- The client's Finished is 36 bytes (a 32-byte verify_data) in a 58-byte
  encrypted record.

From specifications and from Linux v7.2:

- ML-KEM-768 sizes (1,184-byte key, 1,088-byte ciphertext): FIPS 203.
- DHCP's fixed fields (236 bytes and a 4-byte magic cookie): RFC 2131.
- TLS 1.3's Finished message: RFC 8446, section 4.4.4.
- A first window of 10 segments: `TCP_INIT_CWND` in `include/net/tcp.h`, and
  RFC 6928.
- A pipe's 16 page-sized slots: `PIPE_DEF_BUFFERS` in
  `include/linux/pipe_fs_i.h`.
- The scan code event before each key event: `hidinput_hid_event()` in
  `drivers/hid/hid-input.c`.
- ENA's low-latency queue (descriptors and the first 96 bytes pushed to the
  device), MSI-X per queue pair and RSS:
  `Documentation/networking/device_drivers/ethernet/amazon/ena.rst`.
- Wayland message sizes: the wire format in the Wayland protocol
  specification (an 8-byte header; a string is a 32-bit length, then its
  bytes and a NUL, padded to 4).
- Audio rates: PipeWire's defaults in `src/daemon/pipewire.conf.in` (48,000
  Hz, a 1,024-sample quantum), as `scenarios/media.ts` already cites.

From AWS's documentation, for the figures in AWS notes (the
[archived documentation sources](https://github.com/awsdocs) where the pages
themselves could not be fetched):

- Route 53 Resolver at the VPC's base address plus two and at
  169.254.169.253, and 1,024 packets per second per network interface:
  [vpc-dns.md](https://github.com/awsdocs/amazon-vpc-user-guide/blob/master/doc_source/vpc-dns.md).
- A subnet's base address plus one for the VPC router, and no broadcast in a
  VPC:
  [subnet-sizing.md](https://github.com/awsdocs/amazon-vpc-user-guide/blob/master/doc_source/subnet-sizing.md).
- NAT gateway: 55,000 simultaneous connections to each unique destination, per
  address:
  [vpc-nat-gateway.md](https://github.com/awsdocs/amazon-vpc-user-guide/blob/master/doc_source/vpc-nat-gateway.md).
- Flow logs' tcp-flags bitmask (18 for SYN-ACK):
  [flow-logs.md](https://github.com/awsdocs/amazon-vpc-user-guide/blob/master/doc_source/flow-logs.md).
- Four name servers per Route 53 hosted zone, and their name format:
  [SOA-NSrecords.md](https://github.com/awsdocs/amazon-route53-docs/blob/main/doc_source/SOA-NSrecords.md).
- ALB idle timeout, 60 seconds by default, 1 to 4,000:
  [load balancer attributes](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html).
- ALB certificates chosen by SNI:
  [announcement, 2017](https://aws.amazon.com/about-aws/whats-new/2017/10/elastic-load-balancing-application-load-balancers-now-support-multiple-ssl-certificates-and-smart-certificate-selection-using-server-name-indication-sni/).
- EC2 Instance Connect keys usable for 60 seconds:
  [Instance Connect](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-connect-methods.html).
- Lifecycle hooks wait one hour by default:
  [lifecycle hooks](https://docs.aws.amazon.com/autoscaling/ec2/userguide/adding-lifecycle-hooks.html).
- Spot interruption notices two minutes ahead:
  [interruption notices](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-instance-termination-notices.html).
- UEFI as the default boot mode on Graviton instance types:
  [boot modes](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ami-boot.html).

The other AWS notes describe documented behaviour without figures.

## Consequences

- Steps take longer to read; the engine's reading time already counts the data
  line and the AWS note.
- The measured TLS sizes belong to one browser version. Chromium changes its
  ClientHello often (key shares, GREASE, extensions), so re-measure when the
  lab's reference browser moves on.
- AWS quotas and defaults change. The AWS cards don't link their sources in
  the lab yet; this list does. Revisit if a card's figure is questioned: a
  `source` link on `Step.aws` would put it next to the note.
- AWS notes are comparisons, not claims that AWS runs the lab's code, except
  where it does: EC2's ENA driver and NVMe devices are in the same kernel.
