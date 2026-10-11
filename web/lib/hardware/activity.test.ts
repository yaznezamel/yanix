import { describe, expect, it } from "vitest";
import type { NodeId, Step } from "@/lib/xray/types";
import { IDLE, activityAt, linksBetween, shortestLinks } from "./activity";
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
});
