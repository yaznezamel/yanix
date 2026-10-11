import { describe, expect, it } from "vitest";
import { fit, toScreen } from "./camera";
import {
  CLICKABLE,
  TREE,
  clickableZoom,
  commonAncestor,
  coverage,
  fullyOpenZoom,
  labelFit,
  labelWidth,
  levelOfDetail,
  linkShape,
  limitsFor,
  openness,
  pickAt,
  refocus,
  unionBox,
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

  it("always names the parts of the whole computer, shrinking or moving the name rather than hiding it", () => {
    // The map panel beside the screen on a 1280 px laptop is about 490 px wide.
    const narrow = { width: 490, height: 700 };
    const k = fit(TREE.root.world, narrow).k;
    for (const p of TREE.root.children) expect(labelFit(p, k).place, p.id).not.toBe("none");
    const keyboard = labelFit(part("keyboard"), k);
    expect(keyboard.place).toBe("inside");
    if (keyboard.place === "inside") expect(keyboard.size).toBeLessThan(12);
    // On a phone, a small part's name moves under its box.
    expect(labelFit(part("flash"), fit(TREE.root.world, { width: 360, height: 520 }).k).place).toBe("below");
    // Parts inside the CPU only get a name once they are big enough for one.
    expect(labelFit(part("cpu.core0"), k).place).toBe("none");
  });

  it("switches between the full and the short name at a fixed size, never half way", () => {
    const gpu = part("gpu");
    const full = labelWidth(gpu.part.label) / gpu.world.w;
    expect(labelFit(gpu, full * 1.01)).toMatchObject({ place: "inside", text: "Graphics card", size: 12 });
    expect(labelFit(gpu, full * 0.99)).toMatchObject({ place: "inside", text: "GPU", size: 12 });
  });

  it("dives close enough for a part's insides to be fully shown", () => {
    for (const id of ["cpu", "cpu.core0", "chipset"]) {
      expect(openness(part(id), fullyOpenZoom(part(id)))).toBeCloseTo(1);
    }
    expect(fullyOpenZoom(part("dimm0"))).toBe(0);
  });

  it("gives the level of detail a signature that only changes when the drawing does", () => {
    const cam = fit(part("cpu").world, view);
    const a = levelOfDetail(TREE, cam, view);
    expect(levelOfDetail(TREE, { ...cam, x: cam.x + 0.01 }, view).signature).toBe(a.signature);
    expect(levelOfDetail(TREE, { ...cam, k: cam.k * 3 }, view).signature).not.toBe(a.signature);
  });

  it("takes the lid off the CPU only once you zoom in, and draws only what is near the view", () => {
    const whole = levelOfDetail(TREE, fit(TREE.root.world, view), view);
    expect(whole.open.has("cpu")).toBe(false);
    expect(whole.drawn).toEqual(new Set(TREE.root.children.map((c) => c.id)));
    const inCpu = levelOfDetail(TREE, fit(part("cpu").world, view), view);
    expect(inCpu.full.has("cpu")).toBe(true);
    const inCore = levelOfDetail(TREE, fit(part("cpu.core0").world, view), view);
    expect(inCore.drawn.has("cpu.core0.l1d")).toBe(true);
    // Far from core 0, the monitor is only an outline that keyboard focus can reach.
    expect(inCore.drawn.has("monitor")).toBe(false);
  });

  it("gives each part a key that changes only when it, or a part inside it, is drawn differently", () => {
    const at = (k: number) => levelOfDetail(TREE, { ...centre("cpu.core0"), k }, view);
    const before = at(3.2);
    const after = at(3.5);
    expect(before.signature.startsWith(before.keys.get(TREE.root.id)!)).toBe(true);
    // Core 0 starts to show its units; the L3 cache next to it looks the same.
    expect(after.open.has("cpu.core0")).toBe(true);
    expect(before.open.has("cpu.core0")).toBe(false);
    expect(after.keys.get("cpu.core0")).not.toBe(before.keys.get("cpu.core0"));
    expect(after.keys.get("cpu")).not.toBe(before.keys.get("cpu"));
    expect(after.keys.get("cpu.l3")).toBe(before.keys.get("cpu.l3"));
    // A part's key includes the keys of the parts inside it.
    for (const child of part("cpu").children) expect(after.keys.get("cpu")).toContain(after.keys.get(child.id));
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

  it("frames several parts together, from the part that holds them all", () => {
    expect(unionBox([part("dimm0").world, part("dimm1").world])).toEqual({ x: 650, y: 70, w: 182, h: 310 });
    expect(commonAncestor([part("dimm0"), part("dimm1")]).id).toBe("computer");
    expect(commonAncestor([part("cpu.core0.l1d"), part("cpu.l3")]).id).toBe("cpu");
    expect(commonAncestor([part("cpu.core0")]).id).toBe("cpu.core0");
  });

  it("dives close enough for a part's insides to be clicked, even on a small screen", () => {
    const cpu = part("cpu");
    expect(openness(cpu, clickableZoom(cpu))).toBeCloseTo(CLICKABLE);
    expect(CLICKABLE).toBeGreaterThan(0.5);
    expect(clickableZoom(part("ssd"))).toBe(0);
  });

  it("lets a tap just beside a small part pick it", () => {
    const whole = fit(TREE.root.world, { width: 340, height: 420 }).k;
    const flash = part("flash").world;
    const beside = { x: flash.x - 4, y: flash.y + flash.h / 2 };
    expect(pickAt(TREE, whole, beside)).toBeNull();
    expect(pickAt(TREE, whole, beside, 12 / whole)?.id).toBe("flash");
  });

  it("wraps a thin part's name under it to its width, so neighbours' names do not run together", () => {
    const tiny = 0.2;
    const fitted = labelFit(part("dimm0"), tiny);
    expect(fitted.place).toBe("below");
    if (fitted.place === "below") expect(fitted.lines).toEqual(["RAM", "1"]);
  });

  it("names frames and wires only when there is room, not on a phone's overview", () => {
    const small = { width: 340, height: 420 };
    const phone = levelOfDetail(TREE, fit(TREE.root.world, small), small);
    expect(phone.legends.size).toBe(0);
    expect(phone.linkLabels.size).toBe(0);
    // The map panel beside the screen on a 1280 px laptop is about 490 px wide.
    const narrow = { width: 490, height: 700 };
    const laptop = levelOfDetail(TREE, fit(TREE.root.world, narrow), narrow);
    expect(laptop.legends).toEqual(new Set(["computer:Motherboard", "computer:Outside the case"]));
    expect(laptop.linkLabels.size).toBeGreaterThan(0);
  });

  it("puts a wire's name where the link asks along its longest run", () => {
    const usb = TREE.root.part.links!.find((l) => l.id === "usb")!;
    const { label } = linkShape(TREE.root, usb);
    expect(label.y).toBeCloseTo(720 + 0.25 * 110);
  });
});
