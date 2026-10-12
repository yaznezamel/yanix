import { describe, expect, it } from "vitest";
import {
  MAX_FLIGHT_MS,
  cameraTransform,
  clampCamera,
  fit,
  flight,
  panBy,
  placeBeside,
  screenBox,
  toScreen,
  toWorld,
  visibleBox,
  zoomAround,
  type Limits,
} from "./camera";

const view = { width: 800, height: 600 };
const limits: Limits = { minK: 0.1, maxK: 100, bounds: { x: 0, y: 0, w: 1000, h: 1000 } };

describe("camera", () => {
  it("fits a box into the view, centred, with a margin on the tighter side", () => {
    const cam = fit({ x: 100, y: 200, w: 400, h: 100 }, view, 0.1);
    expect(cam.x).toBe(300);
    expect(cam.y).toBe(250);
    // Width is the tighter side: 400 units fill 80% of 800 px.
    expect(cam.k).toBeCloseTo(1.6);
    const box = visibleBox(cam, view);
    expect(box.w).toBeCloseTo(500);
    expect(box.x).toBeCloseTo(50);
  });

  it("converts between world and screen both ways", () => {
    const cam = { x: 420, y: 130, k: 3.5 };
    const p = { x: 123, y: 456 };
    const back = toWorld(cam, view, toScreen(cam, view, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
    expect(toScreen(cam, view, { x: cam.x, y: cam.y })).toEqual({ x: 400, y: 300 });
  });

  it("matches toScreen in the SVG transform", () => {
    const cam = { x: 420, y: 130, k: 2 };
    const [a, , , d, e, f] = cameraTransform(cam, view).match(/-?[\d.]+/g)!.map(Number);
    const p = { x: 500, y: 200 };
    expect({ x: a! * p.x + e!, y: d! * p.y + f! }).toEqual(toScreen(cam, view, p));
  });

  it("zooms around the pointer: the point under it stays put", () => {
    const cam = { x: 500, y: 500, k: 1 };
    const anchor = { x: 650, y: 120 };
    const before = toWorld(cam, view, anchor);
    const zoomed = zoomAround(cam, view, 2.5, anchor, limits);
    expect(zoomed.k).toBeCloseTo(2.5);
    const after = toWorld(zoomed, view, anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("stops zooming at the limits", () => {
    const cam = { x: 500, y: 500, k: 50 };
    expect(zoomAround(cam, view, 10, { x: 400, y: 300 }, limits).k).toBe(100);
    expect(zoomAround({ ...cam, k: 0.2 }, view, 0.1, { x: 400, y: 300 }, limits).k).toBe(0.1);
  });

  it("pans with the drag and keeps the centre over the world", () => {
    const cam = { x: 500, y: 500, k: 2 };
    expect(panBy(cam, 100, -40, limits)).toEqual({ x: 450, y: 520, k: 2 });
    expect(clampCamera({ x: -50, y: 2000, k: 500 }, limits)).toEqual({ x: 0, y: 1000, k: 100 });
  });

  it("flies from one camera to another within the time budget", () => {
    const from = { x: 500, y: 500, k: 0.5 };
    const to = { x: 120, y: 840, k: 6 };
    const f = flight(from, to, view);
    expect(f.duration).toBeGreaterThan(0);
    expect(f.duration).toBeLessThanOrEqual(MAX_FLIGHT_MS);
    expect(f.at(0).x).toBeCloseTo(from.x);
    expect(f.at(0).k).toBeCloseTo(from.k);
    expect(f.at(1)).toEqual(to);
    const mid = f.at(0.5);
    expect(mid.k).toBeGreaterThan(Math.min(from.k, to.k) * 0.5);
    expect(flight(to, to, view).duration).toBe(0);
  });

  it("puts a part's card beside it, on the side with room, and always inside the view", () => {
    const card = { width: 200, height: 100 };
    // Room on the right.
    expect(placeBeside({ x: 100, y: 100, w: 50, h: 50 }, card, view)).toEqual({ x: 160, y: 100 });
    // No room on the right: the left.
    expect(placeBeside({ x: 650, y: 100, w: 50, h: 50 }, card, view)).toEqual({ x: 440, y: 100 });
    // A part near the bottom: the card moves up to stay in the view.
    expect(placeBeside({ x: 100, y: 580, w: 50, h: 10 }, card, view).y).toBe(600 - 8 - 100);
    // A wide part: below it.
    expect(placeBeside({ x: 20, y: 100, w: 760, h: 50 }, card, view)).toEqual({ x: 20, y: 160 });
    // A part that fills the view: in its top corner.
    expect(placeBeside({ x: -100, y: -100, w: 1000, h: 800 }, card, view)).toEqual({ x: 8, y: 8 });
    // The pointer is a box of no size.
    expect(placeBeside({ x: 300, y: 200, w: 0, h: 0 }, card, view, 16)).toEqual({ x: 316, y: 200 });
  });

  it("finds a world box on screen", () => {
    const cam = { x: 500, y: 500, k: 2 };
    expect(screenBox(cam, view, { x: 500, y: 500, w: 10, h: 20 })).toEqual({ x: 400, y: 300, w: 20, h: 40 });
  });
});
