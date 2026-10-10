"use client";

import { animate, type AnimationPlaybackControls } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { activityAt, type Activity } from "@/lib/hardware/activity";
import {
  FIT_MARGIN,
  cameraTransform,
  clampCamera,
  fit,
  flight,
  freeCentre,
  panBy,
  toScreen,
  toWorld,
  zoomAround,
  type Camera,
  type Insets,
  type Limits,
  type Point,
  type Size,
} from "@/lib/hardware/camera";
import { TREE, levelOfDetail, limitsFor, lineage, pickAt, refocus, type Detail, type Placed } from "@/lib/hardware/tree";
import type { Step } from "@/lib/xray/types";
import styles from "./hardware.module.css";
import { PartView } from "./Parts";

// The hardware view: the computer as nested parts you can zoom into, from the
// motherboard down to the units of a CPU core. One camera (lib/hardware/
// camera.ts) moves the whole drawing with a single SVG transform, so zooming
// and panning never re-render React. What is drawn (which parts show their
// children) is recomputed at most once per frame, and only re-renders when it
// changes.

type Gesture =
  | { kind: "drag"; start: Point; from: Camera; moved: boolean }
  | { kind: "pinch"; distance: number; middle: Point; from: Camera };

interface HardwareViewProps {
  step: Step | null;
  /** Last path node the signal has reached in this step. */
  reached: number;
  reduced: boolean;
}

const KEY_ZOOM = 1.6;
const KEY_PAN = 80;
const CLICK_SLOP = 5;

const INITIAL_DETAIL: Detail = {
  open: new Set([TREE.root.id]),
  interactive: new Set(TREE.root.children.map((c) => c.id)),
};

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function middle(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** The deepest parts the signal is at: the USB controller rather than the chipset around it. */
function busiest(activity: Activity): Placed[] {
  const ids = [...activity.current];
  return ids
    .filter((id) => !ids.some((other) => other.startsWith(`${id}.`)))
    .map((id) => TREE.byId.get(id))
    .filter((p): p is Placed => p !== undefined);
}

export function HardwareView({ step, reached, reduced }: HardwareViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const aboutRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const camRef = useRef<Camera | null>(null);
  const sizeRef = useRef<Size>({ width: 0, height: 0 });
  const limitsRef = useRef<Limits | null>(null);
  const flightRef = useRef<AnimationPlaybackControls | null>(null);
  const frameRef = useRef(0);
  const movedByHand = useRef(false);
  const focusRef = useRef(TREE.root.id);
  const gestureRef = useRef<Gesture | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const reducedRef = useRef(reduced);
  const [detail, setDetail] = useState<Detail>(INITIAL_DETAIL);
  const [focus, setFocus] = useState(TREE.root.id);
  const [ready, setReady] = useState(false);
  const hintId = useId();

  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  /** The breadcrumb and the description cover the top and bottom of the view; frame parts between them. */
  const insets = useCallback((): Insets => {
    const svg = svgRef.current?.getBoundingClientRect();
    const nav = navRef.current?.getBoundingClientRect();
    const about = aboutRef.current?.getBoundingClientRect();
    if (!svg) return { top: 0, right: 0, bottom: 0, left: 0 };
    return {
      top: nav ? Math.max(0, nav.bottom - svg.top) : 0,
      right: 0,
      bottom: about ? Math.max(0, svg.bottom - about.top) : 0,
      left: 0,
    };
  }, []);

  const changeFocus = useCallback((id: string) => {
    if (focusRef.current === id) return;
    focusRef.current = id;
    setFocus(id);
  }, []);

  // Once per frame at most: which parts to draw, and (after a zoom or drag by
  // hand) which part you are now looking at.
  const refresh = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const cam = camRef.current;
      if (!cam) return;
      const size = sizeRef.current;
      const next = levelOfDetail(TREE, cam, size);
      setDetail((prev) =>
        sameSet(prev.open, next.open) && sameSet(prev.interactive, next.interactive) ? prev : next,
      );
      if (movedByHand.current) {
        movedByHand.current = false;
        const centre = toWorld(cam, size, freeCentre(size, insets()));
        changeFocus(refocus(TREE, cam, size, focusRef.current, centre).id);
      }
    });
  }, [changeFocus, insets]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  const apply = useCallback(
    (cam: Camera, byHand: boolean) => {
      camRef.current = cam;
      worldRef.current?.setAttribute("transform", cameraTransform(cam, sizeRef.current));
      svgRef.current?.style.setProperty("--zoom", String(cam.k));
      if (byHand) movedByHand.current = true;
      refresh();
    },
    [refresh],
  );

  const stopFlight = useCallback(() => {
    flightRef.current?.stop();
    flightRef.current = null;
  }, []);

  /** Glide to a camera (van Wijk and Nuij's zoom path, under half a second), or jump with reduced motion. */
  const flyTo = useCallback(
    (target: Camera, byHand: boolean) => {
      const from = camRef.current;
      const limits = limitsRef.current;
      if (!from || !limits) return;
      const to = clampCamera(target, limits);
      stopFlight();
      const path = flight(from, to, sizeRef.current);
      if (reducedRef.current || path.duration === 0) {
        apply(to, byHand);
        return;
      }
      flightRef.current = animate(0, 1, {
        duration: path.duration / 1000,
        ease: "easeInOut",
        onUpdate: (t) => apply(path.at(t), byHand),
      });
    },
    [apply, stopFlight],
  );

  /** Fly to a part and frame it: the part becomes what you are looking at. */
  const dive = useCallback(
    (p: Placed) => {
      changeFocus(p.id);
      flyTo(fit(p.world, sizeRef.current, FIT_MARGIN, insets()), false);
    },
    [changeFocus, flyTo, insets],
  );

  const goUp = useCallback((): boolean => {
    const parent = TREE.byId.get(focusRef.current)?.parent;
    if (!parent) return false;
    dive(parent);
    return true;
  }, [dive]);

  const zoomBy = useCallback(
    (factor: number) => {
      const cam = camRef.current;
      const limits = limitsRef.current;
      if (!cam || !limits) return;
      const size = sizeRef.current;
      flyTo(zoomAround(cam, size, factor, freeCentre(size, insets()), limits), true);
    },
    [flyTo, insets],
  );

  /** Tabbing to a part that is off screen brings it into view. */
  const reveal = useCallback(
    (p: Placed) => {
      const cam = camRef.current;
      if (!cam) return;
      const size = sizeRef.current;
      const a = toScreen(cam, size, { x: p.world.x, y: p.world.y });
      const b = toScreen(cam, size, { x: p.world.x + p.world.w, y: p.world.y + p.world.h });
      const free = insets();
      if (a.x >= free.left && a.y >= free.top && b.x <= size.width - free.right && b.y <= size.height - free.bottom) {
        return;
      }
      const framed = fit(p.world, size, FIT_MARGIN, free);
      flyTo({ ...framed, k: Math.min(cam.k, framed.k) }, true);
    },
    [flyTo, insets],
  );

  // Size: frame the whole computer the first time, then keep what you were
  // looking at when the panel changes size.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width < 1 || height < 1) return;
      const before = sizeRef.current;
      const size = { width, height };
      sizeRef.current = size;
      const limits = limitsFor(TREE, size);
      limitsRef.current = limits;
      stopFlight();
      const cam = camRef.current;
      if (!cam || before.width === 0) {
        apply(clampCamera(fit(TREE.root.world, size, FIT_MARGIN, insets()), limits), false);
      } else {
        const scale = Math.min(width / before.width, height / before.height);
        apply(clampCamera({ ...cam, k: cam.k * scale }, limits), false);
      }
      setReady(true);
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, [apply, stopFlight, insets]);

  // The wheel zooms around the pointer. React's onWheel is passive, so it
  // cannot stop the page from scrolling; a native listener can.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      const cam = camRef.current;
      const limits = limitsRef.current;
      if (!cam || !limits || !svg) return;
      e.preventDefault();
      stopFlight();
      // Same scaling as d3-zoom: a mouse wheel notch is about 1.15x, a trackpad pinch (ctrlKey) is finer.
      const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002;
      const factor = 2 ** (-e.deltaY * unit * (e.ctrlKey ? 10 : 1));
      const rect = svg.getBoundingClientRect();
      apply(
        zoomAround(cam, sizeRef.current, factor, { x: e.clientX - rect.left, y: e.clientY - rect.top }, limits),
        true,
      );
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [apply, stopFlight]);

  function local(e: React.PointerEvent): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const cam = camRef.current;
    if (!cam) return;
    // Keep keyboard focus on the view (not on the part under the pointer), so
    // a click does not also count as tabbing to a part.
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    stopFlight();
    const p = local(e);
    const pointers = pointersRef.current;
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      gestureRef.current = { kind: "drag", start: p, from: cam, moved: false };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [Point, Point];
      gestureRef.current = { kind: "pinch", distance: distance(a, b), middle: middle(a, b), from: cam };
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const pointers = pointersRef.current;
    const gesture = gestureRef.current;
    const limits = limitsRef.current;
    if (!pointers.has(e.pointerId) || !gesture || !limits) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (gesture.kind === "drag") {
      const dx = p.x - gesture.start.x;
      const dy = p.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
      gesture.moved = true;
      apply(panBy(gesture.from, dx, dy, limits), true);
    } else if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()] as [Point, Point];
      const now = middle(a, b);
      const zoomed = zoomAround(gesture.from, sizeRef.current, distance(a, b) / gesture.distance, gesture.middle, limits);
      apply(panBy(zoomed, now.x - gesture.middle.x, now.y - gesture.middle.y, limits), true);
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const pointers = pointersRef.current;
    if (!pointers.has(e.pointerId)) return;
    const gesture = gestureRef.current;
    pointers.delete(e.pointerId);
    const cam = camRef.current;
    if (e.type === "pointerup" && gesture?.kind === "drag" && !gesture.moved && pointers.size === 0 && cam) {
      const hit = pickAt(TREE, cam.k, toWorld(cam, sizeRef.current, local(e)));
      if (hit) dive(hit);
    }
    if (pointers.size === 0) {
      gestureRef.current = null;
    } else if (gesture?.kind === "pinch" && cam) {
      // One finger stays down after a pinch: carry on as a drag, never as a click.
      const [rest] = [...pointers.values()] as [Point];
      gestureRef.current = { kind: "drag", start: rest, from: cam, moved: true };
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const cam = camRef.current;
    const limits = limitsRef.current;
    if (!cam || !limits) return;
    switch (e.key) {
      case "+":
      case "=":
        zoomBy(KEY_ZOOM);
        break;
      case "-":
      case "_":
        zoomBy(1 / KEY_ZOOM);
        break;
      case "0":
      case "Home":
        dive(TREE.root);
        break;
      case "Escape":
        if (!goUp()) return;
        break;
      case "ArrowLeft":
        apply(panBy(cam, KEY_PAN, 0, limits), true);
        break;
      case "ArrowRight":
        apply(panBy(cam, -KEY_PAN, 0, limits), true);
        break;
      case "ArrowUp":
        apply(panBy(cam, 0, KEY_PAN, limits), true);
        break;
      case "ArrowDown":
        apply(panBy(cam, 0, -KEY_PAN, limits), true);
        break;
      default:
        return;
    }
    // Handled here: the lab's own shortcuts (arrows step the trace) leave it alone.
    e.preventDefault();
  }

  const activity = useMemo(() => activityAt(TREE, step, reached), [step, reached]);
  const focused = TREE.byId.get(focus) ?? TREE.root;
  const trail = lineage(focused);
  const busy = step ? busiest(activity) : [];

  return (
    <div className="relative h-full w-full" onKeyDown={onKeyDown}>
      <svg
        ref={svgRef}
        className={`h-full w-full select-none ${styles.canvas}`}
        role="group"
        tabIndex={0}
        aria-label={`Hardware view, looking at ${focused.part.label}`}
        aria-describedby={hintId}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g ref={worldRef} style={ready ? undefined : { visibility: "hidden" }}>
          <PartView
            node={TREE.root}
            detail={detail}
            activity={activity}
            active={step !== null}
            onDive={dive}
            onReveal={reveal}
          />
        </g>
      </svg>

      <div
        ref={navRef}
        className="pointer-events-none absolute inset-x-3 top-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
      >
        <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1 text-[12px]">
          {trail.map((p, i) => {
            const last = i === trail.length - 1;
            return (
              <span key={p.id} className="flex items-center gap-1">
                {i > 0 && (
                  <span aria-hidden className="text-lab-muted">
                    ›
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => dive(p)}
                  aria-current={last ? "location" : undefined}
                  className={`pointer-events-auto rounded px-1.5 py-0.5 ${
                    last ? "bg-white/10 font-semibold text-lab-ink" : "text-lab-muted hover:bg-white/5 hover:text-lab-ink"
                  }`}
                >
                  {p.part.label}
                </button>
              </span>
            );
          })}
        </nav>
        <span
          className="pointer-events-auto rounded border border-lab-line bg-lab-panel/80 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-lab-muted"
          title="A generic teaching PC: the parts and how they connect are typical, but positions, shapes and the CPU's insides are not taken from any real board or chip, and no sizes or speeds are shown."
        >
          Illustrative layout
        </span>
      </div>

      <div className="absolute right-3 bottom-3 flex flex-col gap-1.5">
        <ControlButton label="Zoom in" onClick={() => zoomBy(KEY_ZOOM)}>
          <path d="M8 3v10M3 8h10" />
        </ControlButton>
        <ControlButton label="Zoom out" onClick={() => zoomBy(1 / KEY_ZOOM)}>
          <path d="M3 8h10" />
        </ControlButton>
        <ControlButton label="Show the whole computer" onClick={() => dive(TREE.root)}>
          <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
        </ControlButton>
      </div>

      <div
        ref={aboutRef}
        className="pointer-events-none absolute bottom-3 left-3 right-16 max-w-[560px] rounded-lg border border-lab-line bg-lab-bg/85 px-3 py-2 backdrop-blur-sm"
      >
        <p className="text-[12.5px] leading-snug text-lab-ink">
          <span className="font-semibold">{focused.part.label}.</span>{" "}
          <span className="text-lab-ink/80">{focused.part.about}</span>
        </p>
        {busy.length > 0 && (
          <p className="mt-1 font-mono text-[11px] text-signal">
            Signal at: {busy.map((p) => p.part.label).join(" and ")}
          </p>
        )}
        <p id={hintId} className="mt-1 text-[11px] text-lab-muted">
          <span className="pointer-coarse:hidden">
            Click a part to zoom into it · scroll to zoom · drag to move · Esc goes up a level
          </span>
          <span className="hidden pointer-coarse:inline">Tap a part to zoom into it · pinch to zoom · drag to move</span>
        </p>
      </div>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-md border border-lab-line bg-lab-panel2/90 text-lab-ink hover:border-white/25"
    >
      <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
        {children}
      </svg>
    </button>
  );
}
