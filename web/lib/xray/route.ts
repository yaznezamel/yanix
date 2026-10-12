import { BANDS, NODES, NODE_IDS, centerOf, viaOverride, type Point } from "./nodes";
import type { NodeId } from "./types";

// The way a hop goes from one box of the map to the next without cutting
// through any other: straight when nothing is in the way, otherwise the
// shortest way around the corners of the boxes that are (a visibility graph).
// A route may cross the system call bar only between user space and the
// layers below it, since every way down passes it.

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A hop's way: where it leaves the first box, its turns, and where it reaches the second. */
export interface Route {
  start: Point;
  via: Point[];
  end: Point;
}

/** How far outside a box a detour keeps: about half the narrowest gap between boxes. */
const MARGIN = 4;
/** Detours stay this far inside a layer's border, so none runs along its edge. */
const BAND_INSET = 6;
/** How much a line may graze a box's border before it counts as crossing it. */
const GRAZE = 1;
/** Where a route may meet a bar: not right at its rounded ends. */
const BAR_END = 16;
/** The cost of meeting a bar away from the point straight above or below the other box, per unit. */
const BAR_SHIFT = 0.5;

/** Does the segment from a to b pass through the inside of the box (Liang–Barsky)? */
export function crosses(a: Point, b: Point, r: Rect, inset = GRAZE): boolean {
  const x0 = r.x + inset;
  const x1 = r.x + r.w - inset;
  const y0 = r.y + inset;
  const y1 = r.y + r.h - inset;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const sides: [number, number][] = [
    [-dx, a.x - x0],
    [dx, x1 - a.x],
    [-dy, a.y - y0],
    [dy, y1 - a.y],
  ];
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t1 - t0 > 1e-9;
}

const inside = (p: Point, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

const BOXES = NODE_IDS.filter((id) => !NODES[id].bar);
const BARS = NODE_IDS.filter((id) => NODES[id].bar);

/** The boxes a hop must not cross: all but its own two, and the bars unless it goes between user space and below. */
function obstacles(a: NodeId, b: NodeId): NodeId[] {
  const user = (id: NodeId) => NODES[id].layer === "user";
  const throughBar = user(a) !== user(b);
  return NODE_IDS.filter((id) => id !== a && id !== b && !(NODES[id].bar && throughBar));
}

const clear = (p: Point, q: Point, blocks: NodeId[]) => blocks.every((id) => !crosses(p, q, NODES[id]));

interface Corners {
  points: Point[];
  /** For each pair of corners, whether the line between them stays clear of every box, and whether it crosses a bar. */
  seen: Uint8Array;
}

let cornerGraph: Corners | null = null;

/** The corners every detour turns at, and which can see which: built once, the first time a detour is needed. */
function corners(): Corners {
  if (cornerGraph) return cornerGraph;
  const points: Point[] = [];
  for (const id of BOXES) {
    const n = NODES[id];
    for (const x of [n.x - MARGIN, n.x + n.w + MARGIN]) {
      for (const y of [n.y - MARGIN, n.y + n.h + MARGIN]) {
        const p = { x, y };
        const inBand = BANDS.some((b) =>
          inside(p, { x: b.x + BAND_INSET, y: b.y + BAND_INSET, w: b.w - 2 * BAND_INSET, h: b.h - 2 * BAND_INSET }),
        );
        if (inBand && NODE_IDS.every((other) => !inside(p, NODES[other]))) points.push(p);
      }
    }
  }
  const count = points.length;
  // 0: blocked; 1: clear; 2: clear of the boxes, but across a bar.
  const seen = new Uint8Array(count * count);
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const p = points[i]!;
      const q = points[j]!;
      if (!clear(p, q, BOXES)) continue;
      const value = BARS.some((id) => crosses(p, q, NODES[id])) ? 2 : 1;
      seen[i * count + j] = value;
      seen[j * count + i] = value;
    }
  }
  cornerGraph = { points, seen };
  return cornerGraph;
}

interface End {
  point: Point;
  /** What it costs to use this end instead of the natural one. */
  cost: number;
}

/**
 * Where a hop may leave or reach a box: its centre, or for a bar, any point
 * along it, best straight above or below the other box.
 */
function ends(id: NodeId, other: NodeId): End[] {
  const node = NODES[id];
  if (!node.bar) return [{ point: centerOf(id), cost: 0 }];
  const lo = node.x + BAR_END;
  const hi = node.x + node.w - BAR_END;
  const y = node.y + node.h / 2;
  const natural = Math.min(hi, Math.max(lo, centerOf(other).x));
  const xs = new Set([natural, ...corners().points.map((p) => p.x).filter((x) => x >= lo && x <= hi)]);
  return [...xs].map((x) => ({ point: { x, y }, cost: Math.abs(x - natural) * BAR_SHIFT }));
}

const cache = new Map<string, Route>();

/** The way from box a to box b. */
export function route(a: NodeId, b: NodeId): Route {
  const key = `${a}>${b}`;
  const known = cache.get(key);
  if (known) return known;
  const found = findRoute(a, b);
  cache.set(key, found);
  return found;
}

function findRoute(a: NodeId, b: NodeId): Route {
  const starts = ends(a, b);
  const goals = ends(b, a);
  const override = viaOverride(a, b);
  if (override) return { start: starts[0]!.point, via: override, end: goals[0]!.point };

  const blocks = obstacles(a, b);
  const natural = { start: starts[0]!.point, end: goals[0]!.point };
  if (clear(natural.start, natural.end, blocks)) return { ...natural, via: [] };

  // A straight line can still do, from another point along a bar.
  let straight: Route | null = null;
  let straightCost = Number.POSITIVE_INFINITY;
  for (const start of starts) {
    for (const goal of goals) {
      const d = start.cost + goal.cost + distance(start.point, goal.point);
      if (d < straightCost && clear(start.point, goal.point, blocks)) {
        straightCost = d;
        straight = { start: start.point, via: [], end: goal.point };
      }
    }
  }

  // Dijkstra over the corners, from every way out of a to every way into b.
  const { points, seen } = corners();
  const count = points.length;
  const barAllowed = blocks.every((id) => !NODES[id].bar);
  const usable = (i: number, j: number) => {
    const s = seen[i * count + j];
    return s === 1 || (s === 2 && barAllowed);
  };
  const dist = new Float64Array(count).fill(Number.POSITIVE_INFINITY);
  const from = new Int32Array(count).fill(-1);
  const startOf = new Int32Array(count).fill(-1);
  for (const [s, start] of starts.entries()) {
    for (let i = 0; i < count; i++) {
      const p = points[i]!;
      if (!clear(start.point, p, blocks)) continue;
      const d = start.cost + distance(start.point, p);
      if (d < dist[i]!) {
        dist[i] = d;
        startOf[i] = s;
      }
    }
  }
  // How each corner reaches b's best end, if it can see one.
  const goalCost = new Float64Array(count).fill(Number.POSITIVE_INFINITY);
  const goalOf = new Int32Array(count).fill(-1);
  for (let i = 0; i < count; i++) {
    for (const [g, goal] of goals.entries()) {
      if (!clear(points[i]!, goal.point, blocks)) continue;
      const d = goal.cost + distance(points[i]!, goal.point);
      if (d < goalCost[i]!) {
        goalCost[i] = d;
        goalOf[i] = g;
      }
    }
  }
  const done = new Uint8Array(count);
  let best = Number.POSITIVE_INFINITY;
  let last = -1;
  for (;;) {
    let u = -1;
    for (let i = 0; i < count; i++) if (!done[i] && (u === -1 || dist[i]! < dist[u]!)) u = i;
    if (u === -1 || dist[u] === Number.POSITIVE_INFINITY || dist[u]! >= best) break;
    done[u] = 1;
    if (dist[u]! + goalCost[u]! < best) {
      best = dist[u]! + goalCost[u]!;
      last = u;
    }
    for (let v = 0; v < count; v++) {
      if (done[v] || !usable(u, v)) continue;
      const d = dist[u]! + distance(points[u]!, points[v]!);
      if (d < dist[v]!) {
        dist[v] = d;
        from[v] = u;
        startOf[v] = startOf[u]!;
      }
    }
  }
  if (straight && straightCost <= best) return straight;
  // No way round (it should not happen on this map): go straight.
  if (last === -1) return { ...natural, via: [] };
  const via: Point[] = [];
  for (let i = last; i !== -1; i = from[i]!) via.unshift(points[i]!);
  return { start: starts[startOf[last]!]!.point, via, end: goals[goalOf[last]!]!.point };
}
