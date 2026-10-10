import { describe, expect, it } from "vitest";
import { NODES, NODE_IDS } from "@/lib/xray/nodes";
import { partsFor } from "./activity";
import { TREE, type Placed } from "./tree";
import type { Box } from "./types";

// The hierarchy is hand-written data, so these tests check what a typo would
// break: unique ids, parts inside their parents, wires that start and end on
// the parts they connect, and a part for every node the traces visit.

const EPS = 0.5;

function inside(inner: Box, outer: { w: number; h: number }): boolean {
  return inner.x >= 0 && inner.y >= 0 && inner.x + inner.w <= outer.w && inner.y + inner.h <= outer.h;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function onEdge(box: Box, [x, y]: [number, number]): boolean {
  const withinX = x >= box.x - EPS && x <= box.x + box.w + EPS;
  const withinY = y >= box.y - EPS && y <= box.y + box.h + EPS;
  const onVertical = Math.abs(x - box.x) <= EPS || Math.abs(x - (box.x + box.w)) <= EPS;
  const onHorizontal = Math.abs(y - box.y) <= EPS || Math.abs(y - (box.y + box.h)) <= EPS;
  return withinX && withinY && (onVertical || onHorizontal);
}

/** Does the axis-aligned segment pass through the inside of the box? */
function crosses(box: Box, [x1, y1]: [number, number], [x2, y2]: [number, number]): boolean {
  const left = box.x + EPS;
  const right = box.x + box.w - EPS;
  const top = box.y + EPS;
  const bottom = box.y + box.h - EPS;
  if (x1 === x2) {
    return x1 > left && x1 < right && Math.max(y1, y2) > top && Math.min(y1, y2) < bottom;
  }
  return y1 > top && y1 < bottom && Math.max(x1, x2) > left && Math.min(x1, x2) < right;
}

const withChildren: Placed[] = TREE.all.filter((p) => p.children.length > 0);

describe("hardware hierarchy", () => {
  it("gives every part a unique id made of simple keys", () => {
    expect(new Set(TREE.all.map((p) => p.id)).size).toBe(TREE.all.length);
    for (const p of TREE.all) expect(p.part.key).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(TREE.byId.get("cpu.core0.l1d")?.part.label).toBe("L1 data cache");
  });

  it("describes every part", () => {
    for (const p of TREE.all) {
      expect(p.part.label.length, p.id).toBeGreaterThan(0);
      expect(p.part.about, p.id).toMatch(/\.$/);
    }
  });

  it("keeps the inner space of a part in proportion with its box", () => {
    for (const p of withChildren) {
      const inner = p.part.inner!;
      expect(inner, p.id).toBeDefined();
      expect(inner.w / inner.h, p.id).toBeCloseTo(p.part.box.w / p.part.box.h, 2);
      expect(Number.isFinite(p.openAt), p.id).toBe(true);
    }
  });

  it("places children inside their parent without overlapping", () => {
    for (const p of withChildren) {
      const inner = p.part.inner!;
      const kids = p.part.children!;
      for (const [i, child] of kids.entries()) {
        expect(inside(child.box, inner), `${p.id} > ${child.key}`).toBe(true);
        for (const other of kids.slice(i + 1)) {
          expect(overlaps(child.box, other.box), `${child.key} overlaps ${other.key}`).toBe(false);
        }
      }
      for (const frame of p.part.frames ?? []) expect(inside(frame.box, inner), frame.label).toBe(true);
    }
  });

  it("routes each link from one child's edge to the other's, around everything else", () => {
    for (const p of withChildren) {
      const links = p.part.links ?? [];
      expect(new Set(links.map((l) => l.id)).size, p.id).toBe(links.length);
      const byKey = new Map(p.part.children!.map((c) => [c.key, c]));
      for (const link of links) {
        const from = byKey.get(link.from);
        const to = byKey.get(link.to);
        expect(from, `${link.id}: ${link.from}`).toBeDefined();
        expect(to, `${link.id}: ${link.to}`).toBeDefined();
        const first = link.points[0]!;
        const last = link.points[link.points.length - 1]!;
        expect(onEdge(from!.box, first), `${link.id} starts on ${link.from}`).toBe(true);
        expect(onEdge(to!.box, last), `${link.id} ends on ${link.to}`).toBe(true);
        for (let i = 1; i < link.points.length; i++) {
          const a = link.points[i - 1]!;
          const b = link.points[i]!;
          expect(a[0] === b[0] || a[1] === b[1], `${link.id} segment ${i} is straight`).toBe(true);
          for (const child of p.part.children!) {
            if (child === from || child === to) continue;
            expect(crosses(child.box, a, b), `${link.id} crosses ${child.key}`).toBe(false);
          }
        }
      }
    }
  });

  it("has a part for every node a trace can visit", () => {
    for (const id of NODE_IDS) {
      expect(partsFor(TREE, id).length, id).toBeGreaterThan(0);
    }
  });

  it("maps only hardware and network nodes directly; software runs on the CPU", () => {
    for (const p of TREE.all) {
      for (const node of p.part.maps ?? []) {
        expect(["hardware", "network"], `${p.id} maps ${node}`).toContain(NODES[node].layer);
      }
    }
    expect(partsFor(TREE, "vfs").map((p) => p.id)).toEqual(["cpu"]);
    expect(partsFor(TREE, "browser").map((p) => p.id)).toEqual(["cpu"]);
  });
});
