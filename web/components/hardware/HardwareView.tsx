"use client";

import { animate, type AnimationPlaybackControls } from "motion/react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { activityAt, whereIs, type Activity } from "@/lib/hardware/activity";
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
  placeBeside,
  screenBox,
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
  clickableZoom,
  commonAncestor,
  fullyOpenZoom,
  levelOfDetail,
  limitsFor,
  lineage,
  pickAt,
  refocus,
  unionBox,
  type Detail,
  type Placed,
} from "@/lib/hardware/tree";
import { NODES } from "@/lib/xray/nodes";
import type { NodeId, Step } from "@/lib/xray/types";
import { LAYER_NAME } from "@/components/lab/palette";
import styles from "./hardware.module.css";
import { ArtDefs } from "./art";
import { Fades } from "./fades";
import { LabelLayer } from "./Labels";
import { PartCard } from "./PartCard";
import { PartView } from "./Parts";

// The hardware view: the computer as nested parts you can zoom into, from the
// motherboard down to the units of a CPU core. One camera (lib/hardware/
// camera.ts) moves the whole drawing with a single SVG transform, so zooming
// and panning never re-render React. What is drawn (which parts show their
// children) is recomputed at most once per frame, and only re-renders when it
// changes, and then in the background: on a slow machine the camera keeps
// moving while a part's insides are drawn. Per frame, the camera also places
// the layer of names and sets the opacity of the groups that fade with the
// zoom (fades.ts), and nothing else.

type Gesture =
  | { kind: "drag"; start: Point; from: Camera; moved: boolean }
  | { kind: "pinch"; distance: number; middle: Point; from: Camera };

/** What the lab can ask of the view. */
export interface HardwareHandle {
  /** Fly to where a node of the software map is in the hardware, and point it out. */
  show: (node: NodeId) => void;
  /** Put keyboard focus on the view (and bring it into sight). */
  focus: () => void;
}

interface HardwareViewProps {
  step: Step | null;
  /** Last path node the signal has reached in this step. */
  reached: number;
  reduced: boolean;
  ref?: React.Ref<HardwareHandle>;
}

/** A part's card, shown beside the pointer or beside the part with keyboard focus. */
interface CardAnchor {
  id: string;
  by: "pointer" | "focus";
}

const KEY_ZOOM = 1.6;
/** How long the pointer rests on a part before its card shows. */
const HOVER_MS = 400;
/** For this long after a card goes, the next part's card shows at once: moving between parts crosses bare board. */
const GRACE_MS = 600;
const KEY_PAN = 80;
const CLICK_SLOP = 5;
/** How far beside a part, in pixels, a tap still picks it. */
const TOUCH_SLOP = 12;
/** Below this width the lab scrolls as a page, so the view leaves plain scrolling and one-finger swipes to it. */
const IMMERSIVE = "(min-width: 80rem)";

const ARROWS: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

const INITIAL_DETAIL: Detail = {
  open: new Set([TREE.root.id]),
  full: new Set([TREE.root.id]),
  drawn: new Set(),
  interactive: new Set(TREE.root.children.map((c) => c.id)),
  labels: new Map(),
  linkLabels: new Set(),
  legends: new Set(),
  keys: new Map(),
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

export function HardwareView({ step, reached, reduced, ref }: HardwareViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  // A clear pane over the drawing takes the pointer, so the browser never
  // looks for the shape under it (on every frame of a zoom, it would).
  const glassRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const aboutRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const labelsRef = useRef<SVGGElement>(null);
  const hoverRef = useRef<SVGRectElement>(null);
  const camRef = useRef<Camera | null>(null);
  const sizeRef = useRef<Size>({ width: 0, height: 0 });
  const limitsRef = useRef<Limits | null>(null);
  const flightRef = useRef<AnimationPlaybackControls | null>(null);
  // Where the flight under way is headed, worked out from the view's size, so a resize can re-aim it.
  const goalRef = useRef<{ target: () => Camera; byHand: boolean; done?: () => void } | null>(null);
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
  // The part that holds the view's one place in the tab order.
  const [rover, setRover] = useState(TREE.root.children[0]!.id);
  const [card, setCard] = useState<CardAnchor | null>(null);
  // What "Show in Hardware" pointed at, when it is several parts: said in the description until you move on.
  const [note, setNote] = useState<string | null>(null);
  const noteShown = useRef(false);
  // The view or one of its parts has keyboard focus: the hint names the keys.
  const [keyboard, setKeyboard] = useState(false);
  const [fades] = useState(() => new Fades());
  const cardRef = useRef<HTMLDivElement>(null);
  const cardSize = useRef<Size>({ width: 0, height: 0 });
  // The card as code outside a render sees it (a camera move, a pointer move).
  const cardAt = useRef<CardAnchor | null>(null);
  const hoverId = useRef<string | null>(null);
  const hoverTimer = useRef(0);
  const cardGoneAt = useRef(Number.NEGATIVE_INFINITY);
  const pointerAt = useRef<Point>({ x: 0, y: 0 });
  const detailRef = useRef(detail);
  const hintId = useId();

  // What is drawn lags what should be, while a slow machine catches up.
  const shown = useDeferredValue(detail);

  useEffect(() => {
    detailRef.current = shown;
  }, [shown]);

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

  useEffect(
    () => () => {
      window.clearTimeout(nudgeTimer.current);
      window.clearTimeout(hoverTimer.current);
    },
    [],
  );

  const showNote = useCallback((text: string | null) => {
    noteShown.current = text !== null;
    setNote(text);
  }, []);

  const showCard = useCallback((next: CardAnchor | null) => {
    window.clearTimeout(hoverTimer.current);
    cardAt.current = next;
    setCard(next);
  }, []);

  /** Outlines the part under the pointer, as a hint that a click opens it. */
  const markHover = useCallback((id: string | null) => {
    if (id === hoverId.current) return;
    hoverId.current = id;
    const outline = hoverRef.current;
    const node = id ? TREE.byId.get(id) : undefined;
    if (glassRef.current) glassRef.current.style.cursor = node ? "pointer" : "";
    if (!outline) return;
    if (!node) {
      outline.setAttribute("visibility", "hidden");
      return;
    }
    const w = node.world;
    outline.setAttribute("x", String(w.x));
    outline.setAttribute("y", String(w.y));
    outline.setAttribute("width", String(w.w));
    outline.setAttribute("height", String(w.h));
    outline.setAttribute("rx", String(Math.min(w.w, w.h) * 0.03));
    outline.setAttribute("visibility", "visible");
  }, []);

  /** Puts the card beside its part, or beside the pointer, without a render. */
  const placeCard = useCallback(() => {
    const el = cardRef.current;
    const at = cardAt.current;
    const cam = camRef.current;
    const node = at ? TREE.byId.get(at.id) : undefined;
    if (!el || !at || !cam || !node) return;
    const view = sizeRef.current;
    const anchor = at.by === "pointer" ? { ...pointerAt.current, w: 0, h: 0 } : screenBox(cam, view, node.world);
    const p = placeBeside(anchor, cardSize.current, view, at.by === "pointer" ? 16 : 10);
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    el.style.opacity = "1";
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
      const size = sizeRef.current;
      worldRef.current?.setAttribute("transform", cameraTransform(cam, size));
      const names = labelsRef.current?.style;
      names?.setProperty("--k", String(cam.k));
      names?.setProperty("--tx", `${size.width / 2 - cam.x * cam.k}px`);
      names?.setProperty("--ty", `${size.height / 2 - cam.y * cam.k}px`);
      fades.zoom(cam.k);
      if (byHand) {
        movedByHand.current = true;
        if (noteShown.current) showNote(null);
      }
      // A card follows its part; the pointer's goes, since the part under the pointer may change.
      window.clearTimeout(hoverTimer.current);
      if (cardAt.current?.by === "pointer") showCard(null);
      else if (cardAt.current) placeCard();
      markHover(null);
      refresh();
    },
    [refresh, showCard, placeCard, markHover, showNote, fades],
  );

  const stopFlight = useCallback(() => {
    flightRef.current?.stop();
    flightRef.current = null;
    goalRef.current = null;
  }, []);

  /**
   * Glide to a camera (van Wijk and Nuij's zoom path, under half a second), or
   * jump with reduced motion. The target is worked out from the view's size
   * when asked, so that a resize during the flight can re-aim it. `done` runs
   * on arrival.
   */
  const flyTo = useCallback(
    (target: () => Camera, byHand: boolean, done?: () => void) => {
      const from = camRef.current;
      const limits = limitsRef.current;
      if (!from || !limits) return;
      const to = clampCamera(target(), limits);
      stopFlight();
      const path = flight(from, to, sizeRef.current);
      if (reducedRef.current || path.duration === 0) {
        apply(to, byHand);
        done?.();
        return;
      }
      const controls = animate(0, 1, {
        duration: path.duration / 1000,
        ease: "easeInOut",
        onUpdate: (t) => apply(path.at(t), byHand),
        onComplete: () => {
          if (flightRef.current === controls) {
            flightRef.current = null;
            goalRef.current = null;
          }
          done?.();
        },
      });
      flightRef.current = controls;
      goalRef.current = { target, byHand, done };
    },
    [apply, stopFlight],
  );

  /**
   * The camera that frames a part. It goes close enough for the part's insides
   * to be fully shown when that costs only a little of its edges, and always
   * close enough for them to be clicked.
   */
  const framing = useCallback(
    (p: Placed): Camera => {
      const size = sizeRef.current;
      const free = insets();
      const framed = fit(p.world, size, FIT_MARGIN, free);
      const k = Math.max(framed.k, Math.min(fullyOpenZoom(p), framed.k * 1.35), clickableZoom(p));
      return centreOn(p.world, k, free);
    },
    [insets],
  );

  /** Fly to a part and frame it: the part becomes what you are looking at. */
  const dive = useCallback(
    (p: Placed, done?: () => void) => {
      const svg = svgRef.current;
      // A part had keyboard focus (not the view itself, as after a click).
      const hadFocus = svg !== null && svg !== document.activeElement && svg.contains(document.activeElement);
      // A card would sit over the insides you are about to see.
      showCard(null);
      showNote(null);
      changeFocus(p.id);
      if (p.depth > 0) setRover(p.id);
      flyTo(() => framing(p), false, done);
      // Keep keyboard focus on what you are looking at; the part you left may disappear.
      if (hadFocus && svg) {
        const el = p.depth > 0 ? svg.querySelector<SVGGElement>(`[data-part="${p.id}"]`) : null;
        quietFocus.current = true;
        (el ?? svg).focus({ preventScroll: true });
        quietFocus.current = false;
      }
    },
    [changeFocus, flyTo, framing, showCard, showNote],
  );

  const goUp = useCallback((): boolean => {
    const parent = TREE.byId.get(focusRef.current)?.parent;
    if (!parent) return false;
    dive(parent);
    return true;
  }, [dive]);

  /**
   * Arrow keys on a part move to the nearest part in that direction. On the
   * part you are looking at, they go into it, to its first part.
   */
  const arrow = useCallback((from: Placed, key: string): boolean => {
    const dir = ARROWS[key];
    if (!dir) return false;
    if (from.id === focusRef.current) {
      const first = from.children.find((c) => detailRef.current.interactive.has(c.id));
      if (first) {
        setRover(first.id);
        svgRef.current?.querySelector<SVGGElement>(`[data-part="${first.id}"]`)?.focus();
        return true;
      }
    }
    const a = { x: from.world.x + from.world.w / 2, y: from.world.y + from.world.h / 2 };
    let best: Placed | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const id of detailRef.current.interactive) {
      const p = TREE.byId.get(id);
      if (!p || p === from) continue;
      const dx = p.world.x + p.world.w / 2 - a.x;
      const dy = p.world.y + p.world.h / 2 - a.y;
      const along = dx * dir[0] + dy * dir[1];
      if (along <= 0.001) continue;
      const score = along + Math.abs(dx * dir[1] - dy * dir[0]) * 2;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (!best) return false;
    setRover(best.id);
    svgRef.current?.querySelector<SVGGElement>(`[data-part="${best.id}"]`)?.focus();
    return true;
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const cam = camRef.current;
      const limits = limitsRef.current;
      if (!cam || !limits) return;
      flyTo(() => {
        const size = sizeRef.current;
        return zoomAround(cam, size, factor, freeCentre(size, insets()), limits);
      }, true);
    },
    [flyTo, insets],
  );

  /** Tabbing to a part shows its card, and brings the part into view if it is off screen. */
  const reveal = useCallback(
    (p: Placed) => {
      setRover(p.id);
      const cam = camRef.current;
      if (!cam || quietFocus.current) return;
      showCard({ id: p.id, by: "focus" });
      const size = sizeRef.current;
      const a = toScreen(cam, size, { x: p.world.x, y: p.world.y });
      const b = toScreen(cam, size, { x: p.world.x + p.world.w, y: p.world.y + p.world.h });
      const free = insets();
      if (a.x >= free.left && a.y >= free.top && b.x <= size.width - free.right && b.y <= size.height - free.bottom) {
        return;
      }
      flyTo(() => {
        const free = insets();
        return centreOn(p.world, Math.min(cam.k, fit(p.world, sizeRef.current, FIT_MARGIN, free).k), free);
      }, true);
    },
    [flyTo, insets, showCard],
  );

  /** Flashes an outline around parts, to point them out. */
  const spot = useCallback((parts: Placed[]) => {
    let tries = 0;
    const attempt = () => {
      const svg = svgRef.current;
      if (!svg) return;
      const outlines = parts.map((p) => svg.querySelector<SVGRectElement>(`[data-part="${p.id}"] > [data-spot]`));
      // The parts appear a frame or two after the camera arrives.
      if (outlines.includes(null) && tries++ < 20) {
        requestAnimationFrame(attempt);
        return;
      }
      for (const outline of outlines) {
        if (reducedRef.current) {
          outline?.animate([{ opacity: 1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 2400 });
        } else {
          outline?.animate(
            [
              { opacity: 1, strokeWidth: "3px" },
              { opacity: 0, strokeWidth: "16px" },
            ],
            { duration: 1000, iterations: 3, easing: "ease-out" },
          );
        }
      }
    };
    requestAnimationFrame(attempt);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      show(node: NodeId) {
        const { how, parts } = whereIs(TREE, node);
        if (parts.length === 0) return;
        const done = () => spot(parts);
        if (parts.length === 1) {
          dive(parts[0]!, done);
          return;
        }
        // Several parts, such as both RAM sticks: frame them together, looking
        // at the part that holds them, and say what they are.
        const box = unionBox(parts.map((p) => p.world));
        showCard(null);
        changeFocus(commonAncestor(parts).id);
        const names = parts.map((p) =>
          lineage(p)
            .slice(1)
            .map((q) => q.part.label)
            .join(" › "),
        );
        const verb = how === "held" ? "is kept in" : how === "runs" ? "runs on" : "is drawn here as";
        showNote(`${NODES[node].label} ${verb} ${names.join(" and ")}.`);
        flyTo(
          () => {
            const free = insets();
            return centreOn(box, fit(box, sizeRef.current, FIT_MARGIN, free).k, free);
          },
          false,
          done,
        );
      },
      focus() {
        svgRef.current?.focus();
      },
    }),
    [dive, changeFocus, flyTo, insets, spot, showCard, showNote],
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
      // A flight under way (such as "Show in Hardware" while the tab switches) goes on, re-aimed.
      const goal = flightRef.current ? goalRef.current : null;
      stopFlight();
      const cam = camRef.current;
      if (!cam || before.width === 0) {
        apply(clampCamera(fit(TREE.root.world, size, FIT_MARGIN, insetsRef.current), limits), false);
      } else {
        const scale = Math.min(width / before.width, height / before.height);
        apply(clampCamera({ ...cam, k: cam.k * scale }, limits), false);
      }
      if (goal) flyTo(goal.target, goal.byHand, goal.done);
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
  }, [apply, stopFlight, flyTo]);

  // The wheel zooms around the pointer. React's onWheel is passive, so it
  // cannot stop the page from scrolling; a native listener can.
  useEffect(() => {
    const glass = glassRef.current;
    if (!glass) return;
    const immersive = window.matchMedia(IMMERSIVE);
    function onWheel(e: WheelEvent) {
      const cam = camRef.current;
      const limits = limitsRef.current;
      if (!cam || !limits) return;
      // When the lab scrolls as a page, a plain wheel scrolls it; Ctrl or ⌘ (and a trackpad pinch) zooms.
      if (!immersive.matches && !e.ctrlKey && !e.metaKey) {
        showNudge("Hold Ctrl or ⌘ and scroll to zoom");
        return;
      }
      e.preventDefault();
      stopFlight();
      // As in d3-zoom, a mouse wheel notch zooms about 1.15x. A trackpad pinch
      // arrives as small wheel steps with ctrlKey set, so those count ten
      // times as much; a mouse wheel turned with Ctrl held does not.
      const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002;
      const pinch = e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaY) < 50;
      const factor = Math.min(1.35, Math.max(1 / 1.35, 2 ** (-e.deltaY * unit * (pinch ? 10 : 1))));
      // Measure where the view is once per burst of wheel events, not on every event.
      const rect = viewRect(e.timeStamp - lastWheel.current > 250);
      lastWheel.current = e.timeStamp;
      if (!rect) return;
      apply(
        zoomAround(cam, sizeRef.current, factor, { x: e.clientX - rect.left, y: e.clientY - rect.top }, limits),
        true,
      );
    }
    glass.addEventListener("wheel", onWheel, { passive: false });
    return () => glass.removeEventListener("wheel", onWheel);
  }, [apply, stopFlight, viewRect, showNudge]);

  function local(e: React.PointerEvent): Point {
    const rect = viewRect();
    return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 };
  }

  /** The pointer rests on a part: its card shows after a moment, or at once if a card is up already. */
  function hover(p: Point) {
    pointerAt.current = p;
    const cam = camRef.current;
    if (!cam || flightRef.current) return;
    const id = pickAt(TREE, cam.k, toWorld(cam, sizeRef.current, p))?.id ?? null;
    if (id === hoverId.current) {
      if (cardAt.current?.by === "pointer") placeCard();
      return;
    }
    markHover(id);
    window.clearTimeout(hoverTimer.current);
    if (id === null) {
      if (cardAt.current?.by === "pointer") {
        showCard(null);
        cardGoneAt.current = performance.now();
      }
    } else if (cardAt.current || performance.now() - cardGoneAt.current < GRACE_MS) {
      showCard({ id, by: "pointer" });
    } else {
      hoverTimer.current = window.setTimeout(() => showCard({ id, by: "pointer" }), HOVER_MS);
    }
  }

  function onPointerLeave(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "touch") return;
    markHover(null);
    window.clearTimeout(hoverTimer.current);
    if (cardAt.current?.by === "pointer") showCard(null);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const cam = camRef.current;
    if (!cam) return;
    // A click or a drag starts: no card in the way.
    markHover(null);
    if (cardAt.current) showCard(null);
    else window.clearTimeout(hoverTimer.current);
    // Keep keyboard focus on the view (not on the part under the pointer), so
    // a click does not also count as tabbing to a part.
    e.preventDefault();
    svgRef.current?.focus({ preventScroll: true });
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

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const pointers = pointersRef.current;
    if (pointers.size === 0 && e.pointerType !== "touch") hover(local(e));
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

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
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
      // A fingertip is wider than some parts on a phone: a tap just beside one still picks it.
      const slop = e.pointerType === "touch" ? TOUCH_SLOP / cam.k : 0;
      const hit = pickAt(TREE, cam.k, toWorld(cam, sizeRef.current, local(e)), slop);
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
    // A part already used the key (arrows move between parts there).
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
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
      case "Enter":
        // On the view itself, Enter goes to the parts: to the one in the tab order.
        if (e.target !== svgRef.current) return;
        svgRef.current?.querySelector<SVGGElement>('[data-part][tabindex="0"]')?.focus();
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
  const cardNode = card ? TREE.byId.get(card.id) : undefined;

  // Measure the card once its content is in, then place it.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!card || !el) return;
    cardSize.current = { width: el.offsetWidth, height: el.offsetHeight };
    placeCard();
  }, [card, activity, placeCard]);
  // The part in the tab order: the last one you were on, or the nearest part
  // around it that can still be reached at this zoom.
  const tabStop = useMemo(() => {
    let p = TREE.byId.get(rover);
    while (p && !shown.interactive.has(p.id)) p = p.parent ?? undefined;
    return p && p.depth > 0 ? p.id : TREE.root.children[0]!.id;
  }, [rover, shown]);
  const focused = TREE.byId.get(focus) ?? TREE.root;
  const trail = lineage(focused);
  const busy = step ? busiest(activity) : [];
  // The program or kernel code the signal is in, which a core is running.
  const here = step ? NODES[step.path[Math.min(reached, step.path.length - 1)]!] : null;
  const running = here && (here.layer === "user" || here.layer === "kernel") ? here : null;

  return (
    <div
      className="relative h-full w-full"
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        if (e.target instanceof Element && e.target.matches(":focus-visible")) setKeyboard(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboard(false);
      }}
    >
      <svg
        ref={svgRef}
        className={`h-full w-full select-none ${styles.view}`}
        role="group"
        tabIndex={0}
        aria-label={`Hardware view, looking at ${focused.part.label}`}
        aria-describedby={hintId}
        onBlur={() => {
          if (cardAt.current?.by === "focus") showCard(null);
        }}
      >
        <ArtDefs />
        <g ref={worldRef} style={ready ? undefined : { visibility: "hidden" }}>
          <PartView
            node={TREE.root}
            detail={shown}
            activity={activity}
            active={step !== null}
            tabStop={tabStop}
            fades={fades}
            onDive={dive}
            onReveal={reveal}
            onArrow={arrow}
          />
          <rect
            ref={hoverRef}
            fill="none"
            stroke="rgba(255,255,255,0.6)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            visibility="hidden"
          />
        </g>
        <g ref={labelsRef} aria-hidden="true" style={ready ? undefined : { visibility: "hidden" }}>
          <LabelLayer detail={shown} activity={activity} active={step !== null} fades={fades} />
        </g>
      </svg>
      {/* Takes the pointer for the drawing: the view finds the part under it itself (pickAt). */}
      <div
        ref={glassRef}
        aria-hidden
        className={`absolute inset-0 select-none ${styles.canvas}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
      />

      <div
        ref={navRef}
        className="pointer-events-none absolute inset-x-3 top-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
      >
        <nav
          aria-label="Where you are"
          className="flex flex-wrap items-center gap-1 rounded-md bg-lab-panel/85 px-1 text-[12px] backdrop-blur-sm"
        >
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
        {/* A disclosure, so the explanation can be read with a tap or the keyboard, not only on hover. */}
        <details className="pointer-events-auto relative">
          <summary className="cursor-pointer list-none rounded border border-lab-line bg-lab-panel/80 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-lab-muted hover:text-lab-ink [&::-webkit-details-marker]:hidden">
            Illustrative layout
          </summary>
          <p className="absolute top-full right-0 z-20 mt-1 w-64 rounded-md border border-lab-line bg-lab-bg/95 px-2.5 py-2 text-[12px] leading-snug text-lab-ink/85 shadow-lg">
            A generic teaching PC. The parts and how they connect are typical, but where they sit, their
            shapes and the CPU&apos;s insides are not taken from any real board or chip, and no sizes or
            speeds are shown.
          </p>
        </details>
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

      {card && cardNode && (
        <PartCard
          ref={cardRef}
          node={cardNode}
          activity={activity}
          active={step !== null}
          running={running ? `${running.label} (${LAYER_NAME[running.layer].toLowerCase()})` : null}
          by={card.by}
        />
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
        {note && (
          <p role="status" className="mb-1 text-[12.5px] font-medium leading-snug text-signal">
            {note}
          </p>
        )}
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
          {keyboard ? (
            <span>
              Tab or Enter moves into the parts · arrow keys go from part to part · Enter looks inside · Esc
              goes up · + and − zoom
            </span>
          ) : (
            <>
              <span className="hidden xl:inline pointer-coarse:hidden">
                Click a part to zoom into it · scroll to zoom · drag to move · Esc goes up a level
              </span>
              <span className="xl:hidden pointer-coarse:hidden">
                Click a part to zoom into it · Ctrl or ⌘ + scroll to zoom · drag to move · Esc goes up a level
              </span>
              <span className="hidden pointer-coarse:xl:inline">
                Tap a part to zoom into it · pinch to zoom · drag to move
              </span>
              <span className="hidden pointer-coarse:inline pointer-coarse:xl:hidden">
                Tap a part to zoom into it · two fingers move and zoom
              </span>
            </>
          )}
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
