import { describe, expect, it } from "vitest";
import {
  bankGaps,
  bundle,
  gridPath,
  hashSeed,
  logicCells,
  lookOf,
  offsetPolyline,
  packagePins,
  random,
  rectsPath,
  routing,
  spread,
  stripes,
} from "./art";
import { TREE } from "./tree";
import type { Box } from "./types";

const within = (box: Box, outer: Box, eps = 1e-6) =>
  box.x >= outer.x - eps &&
  box.y >= outer.y - eps &&
  box.x + box.w <= outer.x + outer.w + eps &&
  box.y + box.h <= outer.y + outer.h + eps;

/** Every number in a path's data, in pairs: the points it visits. */
function points(d: string): [number, number][] {
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pairs.push([nums[i]!, nums[i + 1]!]);
  return pairs;
}

describe("hardware art", () => {
  it("draws every part but the whole computer, which is drawn as its boards", () => {
    for (const p of TREE.all) {
      if (p.depth === 0) expect(lookOf(p.part)).toBeNull();
      else expect(lookOf(p.part), p.id).not.toBeNull();
    }
    expect(lookOf(TREE.byId.get("cpu.l3")!.part)).toBe("sram");
    expect(lookOf(TREE.byId.get("cpu.core0.fetch")!.part)).toBe("logic");
    expect(lookOf(TREE.byId.get("cpu.core0")!.part)).toBe("core");
  });

  it("makes the same texture from the same seed, and a different one from another", () => {
    expect(hashSeed("fetch")).toBe(hashSeed("fetch"));
    expect(hashSeed("fetch")).not.toBe(hashSeed("decode"));
    const a = random(42);
    const b = random(42);
    const values = Array.from({ length: 100 }, () => a());
    expect(values).toEqual(Array.from({ length: 100 }, () => b()));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(logicCells(80, 40, 1)).toEqual(logicCells(80, 40, 1));
    expect(logicCells(80, 40, 1)).not.toEqual(logicCells(80, 40, 2));
  });

  it("keeps logic cells inside their block, however long and thin it is", () => {
    for (const [w, h] of [
      [100, 100],
      [49, 7],
      [7, 49],
      [234, 56],
    ] as const) {
      const groups = logicCells(w, h, 7, 5, 60);
      expect(groups).toHaveLength(5);
      expect(groups.flat()).toHaveLength(60);
      for (const cell of groups.flat()) {
        expect(within(cell, { x: 0, y: 0, w, h }), `${w}x${h}`).toBe(true);
        expect(cell.w).toBeGreaterThan(0);
        expect(cell.h).toBeGreaterThan(0);
      }
    }
  });

  it("splits memory arrays into a grid of cells and banks", () => {
    // 100 x 50 with cells of 10: 9 inner vertical lines and 4 horizontal ones.
    expect(gridPath(100, 50, 10).match(/M/g)).toHaveLength(13);
    const gaps = bankGaps(100, 50, 4, 2, 2);
    expect(gaps).toHaveLength(4);
    expect(gaps.map((g) => g.x + g.w / 2).slice(0, 3)).toEqual([25, 50, 75]);
  });

  it("spaces stripes and rows of chips evenly inside their box", () => {
    const box = { x: 10, y: 20, w: 100, h: 10 };
    const fins = stripes(box, 10, 0.5, true);
    expect(fins).toHaveLength(10);
    for (const f of fins) expect(within(f, box)).toBe(true);
    // Centred: the same room at both ends.
    expect(fins[0]!.x - box.x).toBeCloseTo(box.x + box.w - (fins[9]!.x + fins[9]!.w));

    const chips = spread({ x: 0, y: 0, w: 10, h: 100 }, 4, 16, true);
    const gaps = [chips[0]!.y, ...chips.slice(1).map((c, i) => c.y - (chips[i]!.y + 16)), 100 - (chips[3]!.y + 16)];
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!);
  });

  it("offsets a wire sideways and keeps its corners square", () => {
    const right = offsetPolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      2,
    );
    // Travelling right, positive offsets go down the screen (to the right of travel).
    expect(right).toEqual([
      { x: 0, y: 2 },
      { x: 10, y: 2 },
    ]);
    const corner = offsetPolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      2,
    );
    expect(corner[1]!.x).toBeCloseTo(8);
    expect(corner[1]!.y).toBeCloseTo(2);
    expect(corner[2]).toEqual({ x: 8, y: 10 });
  });

  it("draws a bus as parallel wires centred on the link", () => {
    const wires = bundle(
      [
        { x: 0, y: 0 },
        { x: 0, y: 50 },
      ],
      4,
      2,
    );
    expect(wires.map((w) => w[0]!.x)).toEqual([3, 1, -1, -3]);
  });

  it("puts a chip's pins around its body, touching it", () => {
    const body = { x: 10, y: 10, w: 40, h: 40 };
    const pins = packagePins(body, 6, 4, 2);
    expect(pins).toHaveLength(24);
    for (const pin of pins) {
      const touches =
        pin.y + pin.h === body.y || pin.y === body.y + body.h || pin.x + pin.w === body.x || pin.x === body.x + body.w;
      expect(touches).toBe(true);
    }
  });

  it("keeps a board's faint routing on the board", () => {
    const { wires, vias } = routing(960, 720, 7, 170);
    for (const [x, y] of points(wires)) {
      expect(x).toBeGreaterThanOrEqual(-0.01);
      expect(x).toBeLessThanOrEqual(960.01);
      expect(y).toBeGreaterThanOrEqual(-0.01);
      expect(y).toBeLessThanOrEqual(720.01);
    }
    expect(vias.length).toBeGreaterThan(0);
    expect(rectsPath([{ x: 1, y: 2, w: 3, h: 4 }])).toBe("M1 2h3v4h-3z");
  });
});
