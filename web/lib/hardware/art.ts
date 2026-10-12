import type { Point } from "./camera";
import type { Box, Look, Part } from "./types";

// Shapes for the hardware drawings (components/hardware/art). Everything is in
// a part's own box, from (0, 0) to (w, h) in world units, and comes back as
// SVG path data, so a texture of fifty rectangles is one element to draw.
// Textures that look random, such as the logic on a die, come from a seeded
// generator: a part looks the same on every visit, and the four cores of the
// CPU are copies of one another, as on a real chip.

/**
 * How a part is drawn: its own look, or one that suits its kind ("core" is
 * plain silicon under the core's units; null draws nothing, as for the
 * whole computer, which is drawn as its boards).
 */
export function lookOf(part: Part): Look | "core" | null {
  if (part.look) return part.look;
  switch (part.kind) {
    case "cache":
      return "sram";
    case "block":
    case "unit":
      return "logic";
    case "core":
      return "core";
    default:
      return null;
  }
}

/** A 32-bit hash of a string (FNV-1a), to seed a part's textures. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A seeded generator of numbers from 0 (included) to 1 (excluded): mulberry32. */
export function random(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Two decimals are plenty for a drawing, and keep the path data short. */
function n(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Rectangles as one path. */
export function rectsPath(rects: Box[]): string {
  return rects.map((r) => `M${n(r.x)} ${n(r.y)}h${n(r.w)}v${n(r.h)}h${n(-r.w)}z`).join("");
}

/** A polyline as path data. */
export function polylinePath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${n(p.x)} ${n(p.y)}`).join("");
}

/**
 * Standard-cell logic as a photo of a die shows it: blocks of a few shades
 * packed into a box. The blocks scale with the box, so a small block and a
 * large one look alike. Returns one list of rectangles per shade.
 */
export function logicCells(w: number, h: number, seed: number, shades = 5, count = 44): Box[][] {
  const rand = random(seed);
  const pad = Math.min(w, h) * 0.05;
  const s = Math.min(Math.sqrt(w * h) / 6, Math.min(w, h) * 0.45);
  const groups: Box[][] = Array.from({ length: shades }, () => []);
  for (let i = 0; i < count; i++) {
    const rw = Math.min(w - 2 * pad, s * (0.3 + rand() * 1.3));
    const rh = Math.min(h - 2 * pad, s * (0.2 + rand() * 0.8));
    const x = pad + rand() * (w - 2 * pad - rw);
    const y = pad + rand() * (h - 2 * pad - rh);
    groups[Math.floor(rand() * shades)]!.push({ x, y, w: rw, h: rh });
  }
  return groups;
}

/** Thin horizontal strips across a box, evenly spaced: the power rails over a block of logic. */
export function rails(w: number, h: number, count: number, thickness: number): Box[] {
  const pad = Math.min(w, h) * 0.05;
  return Array.from({ length: count }, (_, i) => ({
    x: pad,
    y: pad + ((i + 0.5) * (h - 2 * pad)) / count - thickness / 2,
    w: w - 2 * pad,
    h: thickness,
  }));
}

/** Horizontal lines across a box, `spacing` apart: the rows of standard cells in a block of logic. */
export function rowsPath(w: number, h: number, spacing: number): string {
  const count = Math.max(1, Math.floor(h / spacing));
  const parts: string[] = [];
  for (let i = 1; i < count; i++) parts.push(`M0 ${n((i * h) / count)}H${n(w)}`);
  return parts.join("");
}

/** The lines of a grid of cells about `cell` units wide, filling the box exactly. */
export function gridPath(w: number, h: number, cell: number): string {
  const cols = Math.max(1, Math.round(w / cell));
  const rows = Math.max(1, Math.round(h / cell));
  const parts: string[] = [];
  for (let i = 1; i < cols; i++) parts.push(`M${n((i * w) / cols)} 0V${n(h)}`);
  for (let j = 1; j < rows; j++) parts.push(`M0 ${n((j * h) / rows)}H${n(w)}`);
  return parts.join("");
}

/** Bands that split a box into cols × rows banks, `gap` units wide. */
export function bankGaps(w: number, h: number, cols: number, rows: number, gap: number): Box[] {
  const gaps: Box[] = [];
  for (let i = 1; i < cols; i++) gaps.push({ x: (i * w) / cols - gap / 2, y: 0, w: gap, h });
  for (let j = 1; j < rows; j++) gaps.push({ x: 0, y: (j * h) / rows - gap / 2, w, h: gap });
  return gaps;
}

/**
 * Evenly spaced stripes across a box, such as heatsink fins or the gold
 * contacts on a card's edge: `pitch` from one stripe to the next, each
 * `share` of the pitch thick. Vertical stripes run top to bottom.
 */
export function stripes(box: Box, pitch: number, share: number, vertical: boolean): Box[] {
  const length = vertical ? box.w : box.h;
  const count = Math.max(1, Math.floor(length / pitch));
  // Centre the stripes, so both ends of the box look the same.
  const start = (length - (count - 1) * pitch - pitch * share) / 2;
  return Array.from({ length: count }, (_, i) => {
    const at = start + i * pitch;
    return vertical
      ? { x: box.x + at, y: box.y, w: pitch * share, h: box.h }
      : { x: box.x, y: box.y + at, w: box.w, h: pitch * share };
  });
}

/** `count` boxes of the same size in a row (or a column), with equal gaps between them and at both ends. */
export function spread(box: Box, count: number, size: number, vertical: boolean): Box[] {
  const length = vertical ? box.h : box.w;
  const gap = (length - count * size) / (count + 1);
  return Array.from({ length: count }, (_, i) => {
    const at = gap + i * (size + gap);
    return vertical ? { x: box.x, y: box.y + at, w: box.w, h: size } : { x: box.x + at, y: box.y, w: size, h: box.h };
  });
}

/**
 * A polyline moved sideways by `d` (to the right of its direction for d > 0),
 * with mitred corners: one of the parallel wires of a bus on a board.
 */
export function offsetPolyline(points: Point[], d: number): Point[] {
  const normals: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    normals.push({ x: -(b.y - a.y) / length, y: (b.x - a.x) / length });
  }
  if (normals.length === 0) return points;
  return points.map((p, i) => {
    const before = normals[Math.max(0, i - 1)]!;
    const after = normals[Math.min(normals.length - 1, i)]!;
    const dot = before.x * after.x + before.y * after.y;
    // A sharp turn back would need an endless mitre: square it off instead.
    if (dot < -0.9) return { x: p.x + after.x * d, y: p.y + after.y * d };
    const scale = d / (1 + dot);
    return { x: p.x + (before.x + after.x) * scale, y: p.y + (before.y + after.y) * scale };
  });
}

/** `count` parallel polylines `spacing` apart, centred on the original: the wires of a bus. */
export function bundle(points: Point[], count: number, spacing: number): Point[][] {
  return Array.from({ length: count }, (_, i) => offsetPolyline(points, (i - (count - 1) / 2) * spacing));
}

/** The blades of a fan around (cx, cy), from the hub out to radius r, as one path. */
export function fanBlades(cx: number, cy: number, r: number, hub: number, blades: number): string {
  const at = (radius: number, angle: number) => `${n(cx + radius * Math.cos(angle))} ${n(cy + radius * Math.sin(angle))}`;
  const step = (2 * Math.PI) / blades;
  const parts: string[] = [];
  for (let i = 0; i < blades; i++) {
    const a = i * step;
    // Each blade sweeps back as it goes out, like a real fan's.
    parts.push(
      `M${at(hub, a)}Q${at((hub + r) / 2, a + step * 0.15)} ${at(r, a + step * 0.55)}` +
        `L${at(r, a + step * 0.95)}Q${at((hub + r) / 2, a + step * 0.6)} ${at(hub, a + step * 0.5)}z`,
    );
  }
  return parts.join("");
}

/** The pins along the four sides of a square chip package (a QFP or QFN), `perSide` on each. */
export function packagePins(body: Box, perSide: number, length: number, width: number): Box[] {
  const pins: Box[] = [];
  const along = (size: number) => spread({ x: 0, y: 0, w: size, h: size }, perSide, width, false);
  for (const p of along(body.w)) {
    pins.push({ x: body.x + p.x, y: body.y - length, w: width, h: length });
    pins.push({ x: body.x + p.x, y: body.y + body.h, w: width, h: length });
  }
  for (const p of along(body.h)) {
    pins.push({ x: body.x - length, y: body.y + p.x, w: length, h: width });
    pins.push({ x: body.x + body.w, y: body.y + p.x, w: length, h: width });
  }
  return pins;
}

/**
 * Short wires and vias scattered over a board, as one path each: the faint
 * texture of a motherboard's routing, under its parts.
 */
export function routing(w: number, h: number, seed: number, count: number): { wires: string; vias: string } {
  const rand = random(seed);
  const wires: string[] = [];
  const vias: string[] = [];
  const r = 1.6;
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const run = (20 + rand() * 70) * (rand() < 0.5 ? -1 : 1);
    const turn = (8 + rand() * 30) * (rand() < 0.5 ? -1 : 1);
    // Boards route at 0 and 45 degrees: a straight run, then a diagonal.
    const across = rand() < 0.5;
    const straight = run - Math.sign(run) * Math.abs(turn);
    const bend = across ? { x: x + straight, y } : { x, y: y + straight };
    const end = across ? { x: x + run, y: y + turn } : { x: x + turn, y: y + run };
    if (end.x < 0 || end.x > w || end.y < 0 || end.y > h) continue;
    wires.push(`M${n(x)} ${n(y)}L${n(bend.x)} ${n(bend.y)}L${n(end.x)} ${n(end.y)}`);
    vias.push(`M${n(end.x - r)} ${n(end.y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`);
  }
  return { wires: wires.join(""), vias: vias.join("") };
}
