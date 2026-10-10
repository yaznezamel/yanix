import { describe, expect, it } from "vitest";
import { fit, toScreen } from "./camera";
import {
  TREE,
  coverage,
  labelWidth,
  levelOfDetail,
  limitsFor,
  openness,
  opennessCss,
  pickAt,
  refocus,
} from "./tree";

const view = { width: 600, height: 600 };
const part = (id: string) => {
  const p = TREE.byId.get(id);
  if (!p) throw new Error(`no part ${id}`);
  return p;
};
const centre = (id: string) => {
  const w = part(id).world;
  return { x: w.x + w.w / 2, y: w.y + w.h / 2 };
};

describe("hardware tree", () => {
  it("places children in world coordinates through their parent's scale", () => {
    const cpu = part("cpu");
    const core = part("cpu.core0");
    expect(cpu.world).toEqual({ x: 340, y: 90, w: 260, h: 260 });
    expect(core.world.x).toBeCloseTo(340 + 50 * 0.26);
    expect(core.world.w).toBeCloseTo(210 * 0.26);
    const l1d = part("cpu.core0.l1d");
    expect(l1d.depth).toBe(3);
    expect(l1d.world.x).toBeGreaterThan(core.world.x);
    expect(l1d.world.x + l1d.world.w).toBeLessThan(core.world.x + core.world.w);
  });

  it("opens a part once it is big enough on screen for its children's labels", () => {
    const cpu = part("cpu");
    expect(openness(TREE.root, 0.01)).toBe(1);
    expect(openness(cpu, 0.1)).toBe(0);
    expect(openness(cpu, 10)).toBe(1);
    expect(openness(part("dimm0"), 10)).toBe(0);
    // Fully open, a core is wide enough for its label.
    const k = (cpu.openAt * 1.15) / cpu.world.w;
    expect(part("cpu.core0").world.w * k).toBeGreaterThanOrEqual(labelWidth("Core 0"));
    expect(opennessCss(cpu)).toMatch(/^clamp\(0, calc\(\(var\(--zoom\) \* 260 - [\d.]+\) \/ [\d.]+\), 1\)$/);
  });

  it("shows the whole computer first, with every top-level part clickable", () => {
    const cam = fit(TREE.root.world, view);
    const detail = levelOfDetail(TREE, cam, view);
    expect([...detail.open]).toEqual(["computer"]);
    expect(detail.interactive).toEqual(new Set(TREE.root.children.map((c) => c.id)));
  });

  it("opens only what is on screen once you dive in", () => {
    const cam = fit(part("cpu.core0").world, view);
    const detail = levelOfDetail(TREE, cam, view);
    expect(detail.open.has("cpu")).toBe(true);
    expect(detail.open.has("cpu.core0")).toBe(true);
    // Core 3 would be big enough, but it is off screen.
    expect(openness(part("cpu.core3"), cam.k)).toBe(1);
    expect(detail.open.has("cpu.core3")).toBe(false);
    expect(detail.interactive.has("cpu.core0.l1d")).toBe(true);
  });

  it("picks the deepest clearly shown part under a point", () => {
    const whole = fit(TREE.root.world, view);
    expect(pickAt(TREE, whole.k, centre("cpu.core0"))?.id).toBe("cpu");
    const inCpu = fit(part("cpu").world, view);
    expect(pickAt(TREE, inCpu.k, centre("cpu.core0"))?.id).toBe("cpu.core0");
    expect(pickAt(TREE, inCpu.k, { x: 5, y: 5 })).toBeNull();
  });

  it("keeps the part you flew to in focus until you zoom well out of it", () => {
    const cam = fit(part("cpu").world, view);
    // The wide L3 cache sits under the centre, but it does not fill the view.
    expect(coverage(part("cpu.l3"), cam, view)).toBeLessThan(0.5);
    expect(refocus(TREE, cam, view, "cpu").id).toBe("cpu");
    expect(refocus(TREE, { ...cam, k: cam.k * 0.8 }, view, "cpu").id).toBe("cpu");
    expect(refocus(TREE, { ...cam, k: cam.k * 0.4 }, view, "cpu").id).toBe("computer");
  });

  it("moves the focus into a child that fills the view, and off a part you pan away from", () => {
    const core = fit(part("cpu.core0").world, view);
    expect(refocus(TREE, core, view, "computer").id).toBe("cpu.core0");
    const next = { ...core, x: core.x + part("cpu.core0").world.w * 1.1 };
    expect(refocus(TREE, next, view, "cpu.core0").id).toBe("cpu.core1");
    const ssd = fit(part("ssd").world, view);
    // A long, thin part never fills the view, but stays in focus once you fly to it.
    expect(refocus(TREE, ssd, view, "ssd").id).toBe("ssd");
    expect(refocus(TREE, ssd, view, "computer").id).toBe("computer");
  });

  it("lets you zoom from a bit beyond the whole computer to well into the smallest part", () => {
    const limits = limitsFor(TREE, view);
    expect(limits.minK).toBeLessThan(fit(TREE.root.world, view).k);
    for (const p of TREE.all) expect(fit(p.world, view).k).toBeLessThan(limits.maxK);
    // At the deepest zoom, a register file label is comfortably readable.
    const regs = part("cpu.core0.regs");
    expect(regs.world.w * limits.maxK).toBeGreaterThan(400);
    const s = toScreen(fit(regs.world, view), view, centre("cpu.core0.regs"));
    expect(s.x).toBeCloseTo(300);
  });
});
