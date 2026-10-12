import { describe, expect, it } from "vitest";
import type { NodeId, Step } from "@/lib/xray/types";
import { COLD_MACHINE, INITIAL_APPS } from "@/lib/xray/apps";
import { buildScenario } from "@/lib/xray/scenarios";
import { IDLE, activityAt, coreIndex, linksBetween, shortestLinks, softwareOn, whereIs } from "./activity";
import { TREE } from "./tree";

function step(path: NodeId[]): Step {
  return { id: "test", phase: "disk", path, title: "Test", body: "A test step." };
}

const part = (id: string) => TREE.byId.get(id)!;

describe("hardware activity", () => {
  it("is idle without a step", () => {
    expect(activityAt(TREE, null, 0)).toBe(IDLE);
  });

  it("lights the SSD, then the links its DMA takes to both RAM sticks", () => {
    const dma = step(["ssd", "ram", "cpu"]);
    const start = activityAt(TREE, dma, 0);
    expect([...start.current]).toEqual(["ssd"]);
    // The DMA crosses the CPU: in at the I/O block, through the interconnect, out of the memory controller.
    expect(start.touched).toEqual(
      new Set(["ssd", "dimm0", "dimm1", "cpu", "cpu.io", "cpu.interconnect", "cpu.imc"]),
    );
    // The hop under way already shows: SSD to the CPU's PCIe, then a memory channel.
    expect(start.links).toEqual(
      new Set(["computer:pcie-ssd", "computer:channel-a", "computer:channel-b"]),
    );
    const end = activityAt(TREE, dma, 2);
    expect([...end.current]).toEqual(["cpu"]);
  });

  it("runs kernel and user code on core 0 of the CPU", () => {
    const syscall = step(["browser", "syscall", "vfs"]);
    const now = activityAt(TREE, syscall, 1);
    expect(now.current).toEqual(new Set(["cpu", "cpu.core0"]));
    expect(now.links.size).toBe(0);
  });

  it("uses the parts a step names, while the signal stays at the core", () => {
    const store: Step = { ...step(["program"]), parts: ["cpu.core0.l1d", "cpu.core0.regs", "no.such.part"] };
    const now = activityAt(TREE, store, 0);
    expect(now.current).toEqual(new Set(["cpu", "cpu.core0"]));
    expect(now.touched).toEqual(new Set(["cpu", "cpu.core0", "cpu.core0.l1d", "cpu.core0.regs"]));
  });

  it("runs a step on the cores it names, each fetching from RAM through the memory controller", () => {
    const parallel: Step = { ...step(["program", "ram"]), cores: [0, 1, 2, 3] };
    const now = activityAt(TREE, parallel, 0);
    expect(now.current).toEqual(new Set(["cpu", "cpu.core0", "cpu.core1", "cpu.core2", "cpu.core3"]));
    for (const id of ["cpu.interconnect", "cpu.imc", "dimm0", "dimm1"]) expect(now.touched.has(id)).toBe(true);
    expect(now.links).toEqual(new Set(["computer:channel-a", "computer:channel-b"]));
    // Without cores, code runs on core 0 alone.
    expect(activityAt(TREE, step(["program"]), 0).current).toEqual(new Set(["cpu", "cpu.core0"]));
  });

  it("sends a disk command from core 0 through the interconnect and the I/O block", () => {
    const submit = activityAt(TREE, step(["nvme", "ssd"]), 1);
    expect([...submit.links]).toEqual(["computer:pcie-ssd"]);
    for (const id of ["cpu.core0", "cpu.interconnect", "cpu.io", "ssd"]) expect(submit.touched.has(id)).toBe(true);
    expect(submit.touched.has("cpu.imc")).toBe(false);
  });

  it("keeps the page cache in RAM: the kernel's lookup lights the RAM sticks too", () => {
    const lookup = activityAt(TREE, step(["vfs", "pagecache"]), 1);
    for (const id of ["cpu.core0", "dimm0", "dimm1"]) expect(lookup.current.has(id)).toBe(true);
    expect(lookup.links).toEqual(new Set(["computer:channel-a", "computer:channel-b"]));
  });

  it("makes a busy controller's chip busy too", () => {
    const keypress = step(["inputdev", "usbhc", "irq"]);
    const atController = activityAt(TREE, keypress, 1);
    expect(atController.current).toEqual(new Set(["chipset", "chipset.usb"]));
    expect(atController.links).toEqual(new Set(["computer:usb", "computer:chipset-link"]));
  });

  it("sends network hops through the Ethernet cable", () => {
    const out = activityAt(TREE, step(["nicdrv", "nic", "router", "isp"]), 3);
    expect([...out.current]).toEqual(["network"]);
    expect(out.links.has("computer:ethernet")).toBe(true);
    expect(out.links.has("computer:pcie-nic")).toBe(true);
  });

  it("finds the shortest chain of links between two parts", () => {
    expect(shortestLinks(TREE.root, "chipset", "dimm1")).toEqual(["chipset-link", "channel-b"]);
    expect(shortestLinks(TREE.root, "keyboard", "keyboard")).toEqual([]);
    expect(linksBetween(part("cpu.core0"), part("cpu"))).toEqual([]);
    expect(linksBetween(part("chipset.audio"), part("speakers"))).toEqual([
      "computer:hda-link",
      "computer:jack",
    ]);
  });

  it("finds where a box of the software map is in the hardware", () => {
    const ids = (node: Parameters<typeof whereIs>[1]) => {
      const w = whereIs(TREE, node);
      return { how: w.how, parts: w.parts.map((p) => p.id) };
    };
    // The page cache is data, kept in RAM, though the kernel code that manages it runs on a core.
    expect(ids("pagecache")).toEqual({ how: "held", parts: ["dimm0", "dimm1"] });
    expect(ids("vfs")).toEqual({ how: "runs", parts: ["cpu.core0"] });
    expect(ids("browser")).toEqual({ how: "runs", parts: ["cpu.core0"] });
    expect(ids("ssd")).toEqual({ how: "is", parts: ["ssd"] });
    expect(ids("usbhc")).toEqual({ how: "is", parts: ["chipset.usb"] });
    expect(ids("display")).toEqual({ how: "is", parts: ["gpu", "monitor"] });
  });
});

describe("the software a core runs", () => {
  it("reads core numbers from part ids", () => {
    expect(coreIndex("cpu.core2")).toBe(2);
    expect(coreIndex("cpu.core2.l1d")).toBeNull();
    expect(coreIndex("ram")).toBeNull();
  });

  it("names the thread the scheduler model put on each core while ./cores adds", () => {
    const start = buildScenario({ kind: "runProgram", program: "cores" }, COLD_MACHINE, INITIAL_APPS);
    const asking = start.steps.at(-1)!.ui!.program!;
    const round = buildScenario({ kind: "programInput", text: "4" }, COLD_MACHINE, { ...INITIAL_APPS, program: asking });
    const add = round.steps.find((s) => s.id === "add")!;
    const last = add.path.length - 1;
    expect([0, 1, 2, 3].map((core) => softwareOn(add, core, last)?.what)).toEqual([
      "./cores: thread 4, add_up()",
      "./cores: thread 1, add_up()",
      "./cores: thread 2, add_up()",
      "./cores: thread 3, add_up()",
    ]);
  });

  it("says what code the signal is in for other traces, and which layer it belongs to", () => {
    const step: Step = { id: "x", phase: "app", path: ["glibc", "syscall", "vfs"], title: "x", body: "x" };
    expect(softwareOn(step, 0, 0)).toEqual({ what: "glibc", layer: "user" });
    expect(softwareOn(step, 0, 2)).toEqual({ what: "VFS", layer: "kernel" });
    expect(softwareOn(null, 0, 0)).toBeNull();
  });
});
