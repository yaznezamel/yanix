import type { Part } from "./types";

// The computer as a tree of parts, from the whole machine (L0) down to the
// units of one CPU core (L2). Each part places its children in its own
// coordinate space (`inner`), so a level can be laid out without caring how
// big it ends up on screen.
//
// This is a generic teaching PC, not a model of a real board or chip: the
// layouts are illustrative and no sizes or speeds are given (NFR9). Phase 1
// draws every part as a plain box; later phases add the hardware drawings,
// the data path below L2, and the insides of RAM, the SSD and the network
// controller.

const CORE_UNITS: Part[] = [
  {
    key: "fetch",
    label: "Fetch",
    sub: "branch predictor",
    kind: "unit",
    box: { x: 50, y: 110, w: 900, h: 130 },
    about:
      "Fetches the next instructions from the L1 instruction cache. A branch predictor guesses where each branch will go, so fetching does not have to wait for the answer.",
  },
  {
    key: "decode",
    label: "Decode",
    sub: "x86-64 → micro-ops",
    kind: "unit",
    box: { x: 50, y: 260, w: 900, h: 110 },
    about:
      "Turns x86-64 instructions, which vary in length and complexity, into simpler internal operations (micro-ops) that the rest of the core works with.",
  },
  {
    key: "schedule",
    label: "Schedule",
    sub: "out of order",
    kind: "unit",
    box: { x: 50, y: 390, w: 900, h: 110 },
    about:
      "Renames registers and holds micro-ops until their inputs are ready, then sends them to the execution units, often out of program order. Results are still committed in program order.",
  },
  {
    key: "regs",
    label: "Registers",
    sub: "rax · rsp · …",
    kind: "unit",
    box: { x: 50, y: 520, w: 280, h: 240 },
    about:
      "The fastest storage, holding the values instructions work on right now. The registers a program names, such as rax and rsp, map onto a larger physical register file.",
  },
  {
    key: "exec",
    label: "Execution units",
    short: "Execute",
    sub: "ALU · load/store · vector",
    kind: "unit",
    box: { x: 350, y: 520, w: 600, h: 240 },
    about:
      "Do the work: integer arithmetic in the ALUs (arithmetic logic units), vector arithmetic, branches, and the loads and stores that read and write memory through the L1 data cache.",
  },
  {
    key: "l1i",
    label: "L1 instruction cache",
    short: "L1i",
    kind: "cache",
    box: { x: 50, y: 780, w: 280, h: 180 },
    about: "A small, very fast cache of the instructions this core is about to run.",
  },
  {
    key: "l1d",
    label: "L1 data cache",
    short: "L1d",
    kind: "cache",
    box: { x: 350, y: 780, w: 290, h: 180 },
    about:
      "A small, very fast cache of the data this core is using right now. Every load and store looks here first.",
  },
  {
    key: "tlb",
    label: "TLB",
    sub: "address translation",
    kind: "cache",
    box: { x: 660, y: 780, w: 290, h: 180 },
    about:
      "Caches recent translations from virtual to physical addresses. On a miss, a page walker reads the page tables in memory; if there is no valid mapping, the CPU raises a page fault for the kernel.",
  },
  {
    key: "l2",
    label: "L2 cache",
    sub: "private to this core",
    kind: "cache",
    box: { x: 50, y: 980, w: 900, h: 270 },
    about: "A bigger, slower cache that only this core uses. L1 misses look here before going to the shared L3.",
  },
];

function core(i: number): Part {
  const about =
    "Runs one stream of instructions: it fetches, decodes and executes them, with many in flight at once. Each core has its own registers, execution units and L1 and L2 caches.";
  return {
    key: `core${i}`,
    label: `Core ${i}`,
    sub: "fetch · decode · execute",
    kind: "core",
    box: { x: 50 + i * 230, y: 100, w: 210, h: 273 },
    inner: { w: 1000, h: 1300 },
    // A real scheduler spreads work over all cores; this model runs every trace on core 0.
    ...(i === 0
      ? { about: `${about} In this model, every trace runs on core 0.`, runs: ["user", "kernel"] as ("user" | "kernel")[] }
      : { about }),
    children: CORE_UNITS,
  };
}

const CPU: Part = {
  key: "cpu",
  label: "CPU",
  sub: "processor",
  kind: "package",
  box: { x: 340, y: 90, w: 260, h: 260 },
  inner: { w: 1000, h: 1000 },
  about:
    "Runs every instruction, of your programs and of the kernel. It reads and writes RAM through its own memory controller and talks to fast devices, such as the graphics card and the SSD, over PCIe (the fast serial links inside a PC); slower devices go through the chipset.",
  maps: ["cpu"],
  hub: "interconnect",
  children: [
    core(0),
    core(1),
    core(2),
    core(3),
    {
      key: "interconnect",
      label: "Interconnect",
      sub: "on-chip network",
      kind: "block",
      box: { x: 50, y: 390, w: 900, h: 60 },
      about:
        "Carries requests and data between the cores, the L3 cache, the memory controller and the I/O block. Real chips use a ring, a mesh or a crossbar.",
    },
    {
      key: "l3",
      label: "L3 cache",
      sub: "shared by all cores",
      kind: "cache",
      box: { x: 50, y: 465, w: 900, h: 215 },
      about:
        "A large cache shared by all cores. Data that one core loaded can be found here by another, without a trip to RAM.",
    },
    {
      key: "imc",
      label: "Memory controller",
      short: "Memory",
      sub: "channels A · B",
      kind: "block",
      box: { x: 50, y: 700, w: 430, h: 250 },
      about:
        "Turns memory requests into commands for the DRAM chips on the memory channels, one per RAM stick in this computer. Devices' DMA (direct memory access) to RAM goes through it too.",
    },
    {
      key: "io",
      label: "PCIe and I/O",
      short: "I/O",
      sub: "root complex",
      kind: "block",
      box: { x: 520, y: 700, w: 430, h: 250 },
      about:
        "Where PCIe starts (the root complex): it connects the CPU to PCIe devices, here the graphics card and the SSD, and to the chipset. Device DMA enters here on its way to the memory controller, and so do most device interrupts, which PCIe devices send as small memory writes (MSI, message signalled interrupts).",
    },
  ],
};

const CHIPSET: Part = {
  key: "chipset",
  label: "Chipset",
  sub: "USB · audio · power",
  kind: "chip",
  box: { x: 250, y: 560, w: 160, h: 160 },
  inner: { w: 1000, h: 1000 },
  about:
    "A hub for slower devices: USB, audio, power management, the firmware chip and extra PCIe lanes. One fast link connects it to the CPU.",
  children: [
    {
      key: "usb",
      label: "USB controller",
      short: "USB",
      sub: "xHCI",
      kind: "block",
      box: { x: 60, y: 120, w: 420, h: 380 },
      about:
        "Polls USB devices such as the keyboard, moves their data to and from RAM with DMA, and raises an interrupt when a transfer completes. xHCI is the standard interface for USB host controllers.",
      maps: ["usbhc"],
    },
    {
      key: "audio",
      label: "HD Audio controller",
      short: "Audio",
      sub: "HDA",
      kind: "block",
      box: { x: 520, y: 120, w: 420, h: 380 },
      about:
        "Reads sound samples from a ring buffer in RAM with DMA and streams them to the audio codec over the HD Audio (HDA) link.",
      maps: ["hda"],
    },
    {
      key: "power",
      label: "Power management",
      short: "Power",
      sub: "ACPI",
      kind: "block",
      box: { x: 60, y: 540, w: 420, h: 400 },
      about:
        "Watches the power button even while the computer is off, switches the power supply on, and off again when the operating system asks for soft-off: state S5 in ACPI, the standard for power management.",
      maps: ["pmc"],
    },
    {
      key: "lanes",
      label: "PCIe and SPI",
      sub: "network · firmware",
      kind: "block",
      box: { x: 520, y: 540, w: 420, h: 400 },
      about: "More PCIe lanes, for devices such as the Ethernet controller, and the SPI bus to the firmware chip.",
    },
  ],
};

export const MACHINE: Part = {
  key: "computer",
  label: "Computer",
  kind: "machine",
  box: { x: 0, y: 0, w: 1000, h: 1000 },
  inner: { w: 1000, h: 1000 },
  about:
    "A desktop PC: the motherboard inside the case and the devices plugged into it. The layout is illustrative: real boards differ in where parts sit and which chip some devices connect to. Click a part to look inside.",
  openAt: 0,
  frames: [
    { label: "Motherboard", box: { x: 20, y: 20, w: 960, h: 720 } },
    { label: "Outside the case", box: { x: 20, y: 790, w: 960, h: 190 } },
  ],
  children: [
    CPU,
    {
      key: "dimm0",
      label: "RAM stick 1",
      short: "RAM 1",
      sub: "DIMM · channel A",
      kind: "module",
      box: { x: 650, y: 70, w: 72, h: 310 },
      about:
        "A memory module (DIMM): a small board of DRAM (dynamic RAM) chips. RAM holds the running programs, their data, the kernel's page tables and the page cache, and loses everything when the power goes off. Two sticks on two channels let the memory controller spread accesses across both.",
      maps: ["ram", "pagecache", "mm"],
    },
    {
      key: "dimm1",
      label: "RAM stick 2",
      short: "RAM 2",
      sub: "DIMM · channel B",
      kind: "module",
      box: { x: 760, y: 70, w: 72, h: 310 },
      about:
        "The second memory module, on its own channel. Together with the first it makes up the computer's RAM.",
      maps: ["ram", "pagecache", "mm"],
    },
    {
      key: "ssd",
      label: "NVMe SSD",
      short: "SSD",
      sub: "M.2 · PCIe",
      kind: "card",
      box: { x: 70, y: 190, w: 220, h: 60 },
      about:
        "Flash storage with its own controller, on a small M.2 card; NVMe is the protocol it speaks over PCIe. It reads commands from queues in RAM, moves the data with DMA (direct memory access: it writes RAM itself, without the CPU copying) and raises an interrupt when a command completes.",
      maps: ["ssd"],
    },
    {
      key: "flash",
      label: "Firmware chip",
      short: "Firmware",
      sub: "UEFI · SPI flash",
      kind: "chip",
      box: { x: 230, y: 450, w: 140, h: 64 },
      about:
        "A small flash chip holding the UEFI firmware (the successor to the BIOS), the first code the CPU runs at power-on. It hangs off a slow serial bus (SPI).",
      maps: ["firmware"],
    },
    {
      key: "nic",
      label: "Ethernet controller",
      short: "Ethernet",
      sub: "network chip",
      kind: "chip",
      box: { x: 60, y: 570, w: 150, h: 130 },
      about:
        "Moves Ethernet frames between the cable and RAM with DMA, checks their checksums, and raises an interrupt when frames arrive. On many boards it is a chip near the back panel, connected to the chipset.",
      maps: ["nic"],
    },
    CHIPSET,
    {
      key: "codec",
      label: "Audio codec",
      short: "Audio",
      sub: "DAC · jacks",
      kind: "chip",
      box: { x: 450, y: 570, w: 140, h: 130 },
      about:
        "Converts digital samples into the analog signal for the speakers (a digital-to-analog converter, DAC), and a microphone's signal back into samples. It gets its samples from the chipset's HD Audio controller.",
      maps: ["hda"],
    },
    {
      key: "gpu",
      label: "Graphics card",
      short: "GPU",
      sub: "PCIe x16 slot",
      kind: "card",
      box: { x: 630, y: 540, w: 320, h: 160 },
      about:
        "The GPU draws the desktop into a framebuffer, and its display controller sends that picture to the monitor at a fixed refresh rate. It sits in the long PCIe x16 slot, wired to the CPU.",
      maps: ["display"],
    },
    {
      key: "network",
      label: "Network",
      sub: "router · internet",
      kind: "network",
      box: { x: 40, y: 810, w: 190, h: 140 },
      about:
        "Everything outside the computer: your router, your internet provider and the servers you talk to. Packets leave through the Ethernet cable.",
      maps: ["router", "isp", "resolver", "root", "tld", "auth", "server"],
    },
    {
      key: "keyboard",
      label: "Keyboard and mouse",
      short: "Keyboard, mouse",
      sub: "USB",
      kind: "peripheral",
      box: { x: 250, y: 830, w: 250, h: 100 },
      about:
        "Each has a small controller of its own that turns key presses, movements and clicks into reports. They cannot interrupt the computer: the USB host controller polls them for reports at a fixed interval.",
      maps: ["inputdev"],
    },
    {
      key: "speakers",
      label: "Speakers",
      sub: "analog audio",
      kind: "peripheral",
      box: { x: 520, y: 830, w: 150, h: 100 },
      about:
        "Move with the voltage from the codec. Nothing is buffered here: if samples stop arriving in time, you hear a click or a gap.",
      maps: ["speakers"],
    },
    {
      key: "monitor",
      label: "Monitor",
      sub: "DisplayPort · HDMI",
      kind: "peripheral",
      box: { x: 690, y: 810, w: 270, h: 150 },
      about: "Shows the picture the graphics card sends over the cable, redrawn at a fixed refresh rate.",
      maps: ["display"],
    },
  ],
  links: [
    {
      id: "channel-a",
      from: "cpu",
      to: "dimm0",
      label: "memory channel A",
      points: [[600, 160], [650, 160]],
      enters: { cpu: "imc" },
    },
    {
      id: "channel-b",
      from: "cpu",
      to: "dimm1",
      label: "memory channel B",
      points: [[600, 330], [630, 330], [630, 410], [796, 410], [796, 380]],
      enters: { cpu: "imc" },
    },
    { id: "pcie-ssd", from: "cpu", to: "ssd", label: "PCIe", points: [[340, 220], [290, 220]], enters: { cpu: "io" } },
    {
      id: "pcie-gpu",
      from: "cpu",
      to: "gpu",
      label: "PCIe x16",
      points: [[580, 350], [580, 470], [790, 470], [790, 540]],
      enters: { cpu: "io" },
    },
    {
      id: "chipset-link",
      from: "chipset",
      to: "cpu",
      label: "chipset link",
      points: [[385, 560], [385, 350]],
      enters: { cpu: "io" },
    },
    {
      id: "spi",
      from: "chipset",
      to: "flash",
      label: "SPI",
      points: [[305, 560], [305, 514]],
      enters: { chipset: "lanes" },
    },
    {
      id: "pcie-nic",
      from: "chipset",
      to: "nic",
      label: "PCIe",
      points: [[250, 635], [210, 635]],
      enters: { chipset: "lanes" },
    },
    {
      id: "hda-link",
      from: "chipset",
      to: "codec",
      label: "HD Audio",
      points: [[410, 635], [450, 635]],
      enters: { chipset: "audio" },
    },
    {
      id: "ethernet",
      from: "nic",
      to: "network",
      label: "Ethernet cable",
      points: [[135, 700], [135, 810]],
      labelSide: "left",
    },
    {
      id: "usb",
      from: "chipset",
      to: "keyboard",
      label: "USB",
      points: [[330, 720], [330, 830]],
      enters: { chipset: "usb" },
    },
    { id: "jack", from: "codec", to: "speakers", label: "audio jack", points: [[560, 700], [560, 830]] },
    { id: "display", from: "gpu", to: "monitor", label: "DisplayPort", points: [[820, 700], [820, 810]] },
  ],
};
