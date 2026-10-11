import { describe, expect, it } from "vitest";
import { activityAt } from "@/lib/hardware/activity";
import { TREE } from "@/lib/hardware/tree";
import type { NodeId, Step } from "@/lib/xray/types";
import { dimmed, partState } from "./state";

const part = (id: string) => TREE.byId.get(id)!;

function step(path: NodeId[]): Step {
  return { id: "test", phase: "disk", path, title: "Test", body: "A test step." };
}

describe("how parts show a step", () => {
  it("lights the core that runs the code, and leaves its units neither used nor unused", () => {
    const running = activityAt(TREE, step(["vfs"]), 0);
    expect(partState(part("cpu.core0"), running, true)).toBe("current");
    // Which units the code uses is not modelled yet: they must not look unused.
    expect(partState(part("cpu.core0.exec"), running, true)).toBe("idle");
    expect(dimmed(part("cpu.core0.exec"), running, true)).toBe(false);
    // The other cores are not used, and the other parts of the computer dim.
    expect(partState(part("cpu.core1"), running, true)).toBe("dim");
    expect(partState(part("ssd"), running, true)).toBe("dim");
  });

  it("lights the units a step names, and leaves the core's other units as they are", () => {
    const store: Step = { ...step(["marks"]), parts: ["cpu.core0.l1d", "cpu.core0.tlb"] };
    const running = activityAt(TREE, store, 0);
    expect(partState(part("cpu.core0"), running, true)).toBe("current");
    expect(partState(part("cpu.core0.l1d"), running, true)).toBe("touched");
    expect(partState(part("cpu.core0.tlb"), running, true)).toBe("touched");
    // Every instruction is fetched and decoded: those units are never unused.
    expect(partState(part("cpu.core0.decode"), running, true)).toBe("idle");
    // Another core's units follow their core.
    expect(partState(part("cpu.core1.l1d"), running, true)).toBe("idle");
    expect(dimmed(part("cpu.core1.l1d"), running, true)).toBe(true);
  });

  it("dims a part inside a dimmed part with it, and nothing when no trace runs", () => {
    const dma = activityAt(TREE, step(["ssd", "ram"]), 1);
    expect(partState(part("cpu.core0"), dma, true)).toBe("dim");
    expect(dimmed(part("cpu.core0.exec"), dma, true)).toBe(true);
    expect(partState(part("ssd"), dma, false)).toBe("idle");
  });
});
