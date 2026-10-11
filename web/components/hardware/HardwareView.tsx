"use client";

import { animate, type AnimationPlaybackControls } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { activityAt, type Activity } from "@/lib/hardware/activity";
import {
  FIT_MARGIN,
  NO_INSETS,
  cameraTransform,
  centreOn,
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
import {
  TREE,
  fullyOpenZoom,
  levelOfDetail,
  limitsFor,
  lineage,
  pickAt,
  refocus,
  type Detail,
  type Placed,
} from "@/lib/hardware/tree";
import { NODES } from "@/lib/xray/nodes";
import type { Step } from "@/lib/xray/types";
import { LAYER_NAME } from "@/components/lab/palette";
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
/** Below this width the lab scrolls as a page, so the view leaves plain scrolling and one-finger swipes to it. */
const IMMERSIVE = "(min-width: 80rem)";

const INITIAL_DETAIL: Detail = {
  open: new Set([TREE.root.id]),
  interactive: new Set(TREE.root.children.map((c) => c.id)),
  labels: new Map(),
  linkLabels: new Set(),
  signature: "",
};

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
  // Layout reads are cached: reading layout in the middle of a zoom frame
  // forces the browser to recompute styles and layout there and then.
  const rectRef = useRef<DOMRect | null>(null);
  const insetsRef = useRef<Insets>(NO_INSETS);
  const lastWheel = useRef(0);
  // Focusing a part from code must not also trigger "bring it into view".
  const quietFocus = useRef(false);
  const nudgeTimer = useRef(0);
  const [detail, setDetail] = useState<Detail>(INITIAL_DETAIL);
  const [focus, setFocus] = useState(TREE.root.id);
  const [ready, setReady] = useState(false);
  const [nudge, setNudge] = useState<string | null>(null);
  const hintId = useId();

  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  /** The breadcrumb and the description cover the top and bottom of the view; parts are framed between them. */
  const insets = useCallback((): Insets => insetsRef.current, []);

  /** Where the view is on the page, for turning pointer positions into view coordinates. */
  const viewRect = useCallback((fresh = false): DOMRect | null => {
    if (fresh || !rectRef.current) rectRef.current = svgRef.current?.getBoundingClientRect() ?? null;
    return rectRef.current;
  }, []);

  /** A short tip in the middle of the view, for a gesture that did something else. */
  const showNudge = useCallback((text: string) => {
    setNudge(text);
    window.clearTimeout(nudgeTimer.current);
    nudgeTimer.current = window.setTimeout(() => setNudge(null), 1800);
  }, []);

  useEffect(() => () => window.clearTimeout(nudgeTimer.current), []);

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
      setDetail((prev) => (prev.signature === next.signature ? prev : next));
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
      const svg = svgRef.current;
      const hadFocus = svg !== null && svg.contains(document.activeElement);
      changeFocus(p.id);
      const size = sizeRef.current;
      const free = insets();
      // Close enough that the part's insides are fully shown, even if its edges go a little off screen.
      const framed = fit(p.world, size, FIT_MARGIN, free);
      const k = Math.max(framed.k, Math.min(fullyOpenZoom(p), framed.k * 1.35));
      flyTo(centreOn(p.world, k, free), false);
      // Keep keyboard focus on what you are looking at; the part you left may disappear.
      if (hadFocus && svg) {
        const el = p.depth > 0 ? svg.querySelector<SVGGElement>(`[data-part="${p.id}"]`) : null;
        quietFocus.current = true;
        (el ?? svg).focus({ preventScroll: true });
        quietFocus.current = false;
      }
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
      if (!cam || quietFocus.current) return;
      const size = sizeRef.current;
      const a = toScreen(cam, size, { x: p.world.x, y: p.world.y });
      const b = toScreen(cam, size, { x: p.world.x + p.world.w, y: p.world.y + p.world.h });
      const free = insets();
      if (a.x >= free.left && a.y >= free.top && b.x <= size.width - free.right && b.y <= size.height - free.bottom) {
        return;
      }
      const framed = fit(p.world, size, FIT_MARGIN, free);
      flyTo(centreOn(p.world, Math.min(cam.k, framed.k), free), true);
    },
    [flyTo, insets],
  );

  // Size: frame the whole computer the first time, then keep what you were
  // looking at when the panel changes size. The breadcrumb and the description
  // are watched too, since they decide where parts are framed.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver((entries) => {
      // Called after layout, so these reads are free.
      const rect = svg.getBoundingClientRect();
      rectRef.current = rect;
      const nav = navRef.current?.getBoundingClientRect();
      const about = aboutRef.current?.getBoundingClientRect();
      insetsRef.current = {
        top: nav ? Math.max(0, nav.bottom - rect.top) : 0,
        right: 0,
        bottom: about ? Math.max(0, rect.bottom - about.top) : 0,
        left: 0,
      };
      const entry = entries.find((e) => e.target === svg);
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
        apply(clampCamera(fit(TREE.root.world, size, FIT_MARGIN, insetsRef.current), limits), false);
      } else {
        const scale = Math.min(width / before.width, height / before.height);
        apply(clampCamera({ ...cam, k: cam.k * scale }, limits), false);
      }
      setReady(true);
    });
    observer.observe(svg);
    if (navRef.current) observer.observe(navRef.current);
    if (aboutRef.current) observer.observe(aboutRef.current);
    // Scrolling the page moves the view without resizing it.
    const stale = () => {
      rectRef.current = null;
    };
    window.addEventListener("scroll", stale, { capture: true, passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", stale, { capture: true });
    };
  }, [apply, stopFlight]);

  // The wheel zooms around the pointer. React's onWheel is passive, so it
  // cannot stop the page from scrolling; a native listener can.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const immersive = window.matchMedia(IMMERSIVE);
    function onWheel(e: WheelEvent) {
      const cam = camRef.current;
      const limits = limitsRef.current;
      if (!cam || !limits || !svg) return;
      // When the lab scrolls as a page, a plain wheel scrolls it; Ctrl or ⌘ (and a trackpad pinch) zooms.
      if (!immersive.matches && !e.ctrlKey && !e.metaKey) {
        showNudge("Hold Ctrl or ⌘ and scroll to zoom");
        return;
      }
      e.preventDefault();
      stopFlight();
      // Same scaling as d3-zoom: a mouse wheel notch is about 1.15x, a trackpad pinch (ctrlKey) is finer.
      const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002;
      const factor = 2 ** (-e.deltaY * unit * (e.ctrlKey ? 10 : 1));
      // Measure where the view is once per burst of wheel events, not on every event.
      const rect = viewRect(e.timeStamp - lastWheel.current > 250);
      lastWheel.current = e.timeStamp;
      if (!rect) return;
      apply(
        zoomAround(cam, sizeRef.current, factor, { x: e.clientX - rect.left, y: e.clientY - rect.top }, limits),
        true,
      );
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [apply, stopFlight, viewRect, showNudge]);

  function local(e: React.PointerEvent): Point {
    const rect = viewRect();
    return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 };
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
    // One fresh measurement per gesture; moves reuse it.
    viewRect(true);
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
    // The browser took a one-finger swipe to scroll the page (below the wide layout).
    if (e.type === "pointercancel" && e.pointerType === "touch" && gesture?.kind === "drag" && pointers.size === 0) {
      showNudge("Use two fingers to move the drawing");
    }
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
  // The program or kernel code the signal is in, which a core is running.
  const here = step ? NODES[step.path[Math.min(reached, step.path.length - 1)]!] : null;
  const running = here && (here.layer === "user" || here.layer === "kernel") ? here : null;

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
        className="pointer-events-none absolute inset-x-3 top-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
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
                  className={`pointer-events-auto min-h-6 rounded px-1.5 ${
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

      {nudge && (
        <div
          role="status"
          className="pointer-events-none absolute inset-x-0 top-1/3 flex justify-center px-4"
        >
          <span className="rounded-full border border-lab-line bg-lab-bg/90 px-3 py-1.5 text-[12.5px] text-lab-ink shadow-lg">
            {nudge}
          </span>
        </div>
      )}

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
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-signal">Signal at</span>
            {busy.map((p) => (
              <span key={p.id} className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => dive(p)}
                  title={`Zoom to ${p.part.label}`}
                  className="pointer-events-auto min-h-6 rounded border border-signal/50 px-1.5 text-signal hover:bg-signal/10"
                >
                  {lineage(p)
                    .slice(1)
                    .map((q) => q.part.label)
                    .join(" › ")}
                </button>
                {running && p.part.runs?.includes(running.layer as "user" | "kernel") && (
                  <span className="text-lab-ink/85">
                    running {running.label} ({LAYER_NAME[running.layer].toLowerCase()})
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
        <p id={hintId} className="mt-1 text-[11px] text-lab-muted">
          {focused.depth > 0 && focused.children.length === 0 && (
            <span className="block text-lab-ink/70">
              This model has nothing smaller inside this part yet. Esc or the breadcrumb goes back up.
            </span>
          )}
          <span className="hidden xl:inline pointer-coarse:hidden">
            Click a part to zoom into it · scroll to zoom · drag to move · Esc goes up a level
          </span>
          <span className="xl:hidden pointer-coarse:hidden">
            Click a part to zoom into it · Ctrl or ⌘ + scroll to zoom · drag to move · Esc goes up a level
          </span>
          <span className="hidden pointer-coarse:xl:inline">Tap a part to zoom into it · pinch to zoom · drag to move</span>
          <span className="hidden pointer-coarse:inline pointer-coarse:xl:hidden">
            Tap a part to zoom into it · two fingers move and zoom
          </span>
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
