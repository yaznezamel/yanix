"use client";

import { AnimatePresence, motion, useTransform, type MotionValue } from "motion/react";
import { memo, useEffect, useRef, useState } from "react";
import type { Hop, PathGeometry } from "@/lib/xray/geometry";
import type { Point } from "@/lib/xray/nodes";
import { BANDS, NODES, NODE_IDS, TOPOLOGY, VIEW, centerOf } from "@/lib/xray/nodes";
import { packetAt } from "@/lib/xray/packets";
import type { Layer, MachineNode, NodeId, Packet, Step } from "@/lib/xray/types";
import styles from "./lab.module.css";
import { HEADER_COLOR, HEADER_TAG, LAYER_HEX, SIGNAL, alpha } from "./palette";

/** A box's part in the step: the stop the signal is at, one it has passed, one still ahead, or none. */
type NodeState = "idle" | "current" | "passed" | "ahead" | "scenario" | "dim";

/** A numbered stop, or a hop between two, relative to the signal. */
type StopState = "done" | "current" | "ahead";

interface XRayMapProps {
  step: Step | null;
  stepKey: string;
  /** The step's route through the map. */
  geometry: PathGeometry | null;
  /** How far the signal has travelled along the route, from the shared playhead. */
  progress: MotionValue<number>;
  /** Last path node the signal has reached. */
  reached: number;
  selected: NodeId | null;
  scenarioNodes: ReadonlySet<NodeId> | null;
  onSelect: (id: NodeId) => void;
}

const BOUNDARIES = [
  { id: "syscall", d: "M 8 182 H 716", label: "system calls", x: 712, y: 179 },
  { id: "device", d: "M 16 558 H 708", label: "MMIO · DMA · interrupts", x: 706, y: 553 },
  { id: "cable", d: "M 723 14 V 746", label: "", x: 0, y: 0 },
] as const;

/** The machine's own area: its layers sit on one board, and the network is outside it. */
const MACHINE = { x: 8, y: 8, w: 708, h: 744 } as const;
const SOFTWARE = BANDS.filter((b) => b.layer === "user" || b.layer === "kernel");
const HARDWARE_BAND = BANDS.find((b) => b.layer === "hardware")!;

/** Where the contacts of the kernel's card meet the board: under the drivers that talk to devices. */
const CONTACTS = [36, 66, 101, 136, 166, 236, 270, 304, 384, 434, 484, 548, 583, 618, 653, 688];

/**
 * The board under the machine's layers: circuit traces, crisp under the
 * hardware and frosted under the software, which floats over it as glass,
 * with soft shadows below each pane. It never changes, so it is drawn once,
 * apart from the map that animates above it.
 */
const Board = memo(function Board() {
  return (
    <svg
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      preserveAspectRatio="xMidYMin meet"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      <defs>
        <pattern id="board-traces" width="56" height="56" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="rgba(255,179,92,0.22)" strokeWidth={1.2}>
            <path d="M 0 12 H 18 L 26 20 H 56" />
            <path d="M 40 0 V 8 L 46 14 V 34 L 40 40 V 56" />
            <path d="M 0 44 H 10 L 16 38 H 30" />
          </g>
          <g fill="rgba(255,179,92,0.3)">
            <circle cx={30} cy={38} r={2.4} />
            <circle cx={18} cy={12} r={1.6} />
            <circle cx={46} cy={24} r={1.6} />
          </g>
        </pattern>
        <filter id="board-frost" x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation={2.2} />
        </filter>
        <filter id="board-shadow" x="-10%" y="-10%" width="120%" height="130%">
          <feGaussianBlur stdDeviation={9} />
        </filter>
        <clipPath id="board-soft">
          {SOFTWARE.map((b) => (
            <rect key={b.layer} x={b.x} y={b.y} width={b.w} height={b.h} rx={12} />
          ))}
        </clipPath>
        <clipPath id="board-hard">
          <rect x={HARDWARE_BAND.x} y={HARDWARE_BAND.y} width={HARDWARE_BAND.w} height={HARDWARE_BAND.h} rx={12} />
        </clipPath>
      </defs>
      <rect x={MACHINE.x} y={MACHINE.y} width={MACHINE.w} height={MACHINE.h} rx={14} fill="#0b0907" />
      <rect
        x={MACHINE.x}
        y={MACHINE.y}
        width={MACHINE.w}
        height={MACHINE.h}
        fill="url(#board-traces)"
        clipPath="url(#board-hard)"
      />
      <g clipPath="url(#board-soft)">
        <rect
          x={MACHINE.x}
          y={MACHINE.y}
          width={MACHINE.w}
          height={MACHINE.h}
          fill="url(#board-traces)"
          opacity={1}
          filter="url(#board-frost)"
        />
      </g>
      {SOFTWARE.map((b) => (
        <rect
          key={b.layer}
          x={b.x + 6}
          y={b.y + 12}
          width={b.w - 12}
          height={b.h - 6}
          rx={12}
          fill="rgba(0,0,0,0.55)"
          filter="url(#board-shadow)"
        />
      ))}
    </svg>
  );
});

type BoundaryId = (typeof BOUNDARIES)[number]["id"];

const ARROWS: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

/** The box an arrow key moves to: the nearest one in that direction, preferring boxes in line. */
function nextInDirection(from: NodeId, key: string): NodeId | null {
  const dir = ARROWS[key];
  if (!dir) return null;
  const a = centerOf(from);
  let best: NodeId | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const id of NODE_IDS) {
    if (id === from) continue;
    const b = centerOf(id);
    const along = (b.x - a.x) * dir[0] + (b.y - a.y) * dir[1];
    if (along <= 1) continue;
    const across = Math.abs((b.x - a.x) * dir[1] - (b.y - a.y) * dir[0]);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

function crossings(step: Step | null): Set<BoundaryId> {
  const crossed = new Set<BoundaryId>();
  if (!step) return crossed;
  for (let i = 1; i < step.path.length; i++) {
    const a = NODES[step.path[i - 1]!].layer;
    const b = NODES[step.path[i]!].layer;
    const pair = new Set<Layer>([a, b]);
    if (pair.has("user") && pair.has("kernel")) crossed.add("syscall");
    if (pair.has("kernel") && pair.has("hardware")) crossed.add("device");
    if (pair.has("network") && pair.size === 2) crossed.add("cable");
  }
  return crossed;
}

export function XRayMap({
  step,
  stepKey,
  geometry,
  progress,
  reached,
  selected,
  scenarioNodes,
  onSelect,
}: XRayMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const routeRef = useRef<SVGPathElement>(null);
  const markerRef = useRef<SVGGElement>(null);
  // The map is one Tab stop; arrow keys move between its boxes.
  const [rover, setRover] = useState<NodeId>(NODE_IDS[0]!);
  // Drawn small, the boxes' second lines would be unreadably tiny: leave them out.
  const [compact, setCompact] = useState(false);
  const capsuleRef = useRef<SVGGElement>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const belowRef = useRef(false);
  // Tall boxes keep their label at the top: park the capsule under the signal there.
  const destination = step ? step.path[step.path.length - 1] : undefined;
  const capsuleBelow = destination ? NODES[destination].h >= 60 : false;

  // The playhead's progress drives both the glowing trail and the packet
  // marker, so pausing or scrubbing the timeline moves both.
  useEffect(() => {
    const route = routeRef.current;
    const marker = markerRef.current;
    if (!geometry || !route || !marker) return;
    const total = route.getTotalLength();
    const place = (p: number) => {
      const point = route.getPointAtLength(total * Math.min(1, Math.max(0, p)));
      marker.setAttribute("transform", `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`);
      lastPoint.current = { x: point.x, y: point.y };
      placeCapsule(capsuleRef.current, point, capsuleBelow);
    };
    belowRef.current = capsuleBelow;
    place(progress.get());
    return progress.on("change", place);
  }, [stepKey, geometry, progress, capsuleBelow]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const scale = Math.min(width / VIEW.width, height / VIEW.height);
      setCompact(scale > 0 && scale < 0.7);
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  function moveFocus(from: NodeId, key: string): boolean {
    const next = nextInDirection(from, key);
    if (!next) return false;
    setRover(next);
    svgRef.current?.querySelector<SVGGElement>(`[data-node="${next}"]`)?.focus();
    return true;
  }

  // The capsule's width changes when headers are added; re-place it then.
  useEffect(() => {
    if (lastPoint.current) placeCapsule(capsuleRef.current, lastPoint.current, belowRef.current);
  });

  const crossed = crossings(step);
  const packet = step ? packetAt(step.frames, reached) : null;
  const at = step ? Math.min(reached, step.path.length - 1) : 0;
  const current = step ? step.path[at] : undefined;
  const cacheAt = step?.cache ? step.path.indexOf("pagecache") : -1;
  const showCache = cacheAt >= 0 && reached >= cacheAt;

  function stateOf(id: NodeId): NodeState {
    if (!step) return "idle";
    if (id === current) return "current";
    const first = step.path.indexOf(id);
    if (first !== -1) return first < at ? "passed" : "ahead";
    if (scenarioNodes?.has(id)) return "scenario";
    return "dim";
  }
  const stop = (i: number): StopState => (i < at ? "done" : i === at ? "current" : "ahead");

  return (
    <div className="relative h-full w-full">
    <Board />
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      preserveAspectRatio="xMidYMin meet"
      className="relative h-full w-full select-none"
      role="group"
      aria-label={step ? `Machine view. ${step.title}` : "Machine view"}
    >
      <defs>
        <filter
          id="xray-glow"
          filterUnits="userSpaceOnUse"
          x={-60}
          y={-60}
          width={VIEW.width + 120}
          height={VIEW.height + 120}
        >
          <feGaussianBlur stdDeviation="3.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="glass-pane" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.12} />
          <stop offset="0.3" stopColor="#ffffff" stopOpacity={0.05} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0.03} />
        </linearGradient>
        <linearGradient id="glass-chip" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.16} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0.04} />
        </linearGradient>
        <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd9a3" stopOpacity={0.55} />
          <stop offset="1" stopColor="#ffb35c" stopOpacity={0.15} />
        </linearGradient>
        <pattern id="xray-stripes" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="6" fill="rgba(5,8,11,0.35)" />
        </pattern>
        {(["done", "current", "ahead"] as const).map((s) => (
          <marker
            key={s}
            id={`hop-${s}`}
            viewBox="0 0 10 10"
            refX={8.6}
            refY={5}
            markerWidth={11}
            markerHeight={11}
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M 0.5 1 L 9.5 5 L 0.5 9 Z" fill={HOP_INK[s]} />
          </marker>
        ))}
      </defs>

      {BANDS.map((band) => {
        const glass = band.layer === "user" || band.layer === "kernel";
        const hue = LAYER_HEX[band.layer];
        return (
          <g key={band.layer}>
            {glass ? (
              // Software: a pane of glass over the board, tinted by its layer, lit along its top edge.
              <>
                <rect x={band.x} y={band.y} width={band.w} height={band.h} rx={12} fill="url(#glass-pane)" />
                <rect
                  x={band.x}
                  y={band.y}
                  width={band.w}
                  height={band.h}
                  rx={12}
                  fill={alpha(hue, 0.06)}
                  stroke="rgba(255,255,255,0.2)"
                />
                <path
                  d={`M ${band.x + 14} ${band.y + 0.75} H ${band.x + band.w - 14}`}
                  stroke="rgba(255,255,255,0.42)"
                  strokeWidth={1}
                />
              </>
            ) : (
              // Hardware and the network: the board itself shows through.
              <rect
                x={band.x}
                y={band.y}
                width={band.w}
                height={band.h}
                rx={12}
                fill={band.layer === "network" ? alpha(hue, 0.045) : "none"}
                stroke={alpha(hue, band.layer === "network" ? 0.14 : 0.3)}
              />
            )}
            <text
              x={band.x + 10}
              // The kernel's label goes at the bottom of its pane: the system call bar spans its top.
              y={band.layer === "kernel" ? band.y + band.h - 12 : band.y + 18}
              fontSize={10.5}
              letterSpacing="0.14em"
              fill={hue}
              className="font-mono"
            >
              {band.label}
              {glass && (
                <tspan fill="rgba(255,255,255,0.45)" letterSpacing="0.04em">
                  {band.layer === "user" ? "   software: programs" : "   software: the kernel"}
                </tspan>
              )}
              {band.layer === "hardware" && (
                <tspan fill="rgba(255,255,255,0.45)" letterSpacing="0.04em">
                  {"   the board and its chips"}
                </tspan>
              )}
            </text>
          </g>
        );
      })}

      {/* Where the kernel's glass meets the board: a row of contacts, as on a card's edge. */}
      <g aria-hidden>
        <rect x={16} y={555} width={692} height={6} rx={1.5} fill="url(#rail)" />
        {CONTACTS.map((x) => (
          <rect key={x} x={x - 3} y={553} width={6} height={10} rx={1} fill="rgba(255,205,140,0.5)" />
        ))}
      </g>

      {BOUNDARIES.map((b) => {
        const active = crossed.has(b.id);
        return (
          <g key={b.id} className={active ? styles.boundaryActive : undefined}>
            <path
              d={b.d}
              stroke={active ? SIGNAL : b.id === "device" ? "none" : "rgba(255,255,255,0.14)"}
              strokeWidth={active ? 2 : 1}
              strokeDasharray={b.id === "device" ? undefined : "5 5"}
              filter={active ? "url(#xray-glow)" : undefined}
            />
            {b.label && (
              <text
                x={b.x}
                y={b.y}
                fontSize={10}
                textAnchor="end"
                fill={active ? SIGNAL : "rgba(255,255,255,0.55)"}
                className="font-mono"
              >
                {b.label}
              </text>
            )}
          </g>
        );
      })}

      {TOPOLOGY.map((t, i) => (
        <g key={i}>
          <path d={t.d} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth={1.5} />
          {t.label && (
            <text
              x={t.lx}
              y={t.ly}
              fontSize={9.5}
              textAnchor="middle"
              fill="rgba(255,255,255,0.4)"
              className="font-mono"
            >
              {t.label}
            </text>
          )}
        </g>
      ))}

      {geometry && (
        // The route as numbered stops joined by arrows: done, the one the signal travels now, and those ahead.
        <g pointerEvents="none" aria-hidden>
          <path ref={routeRef} d={geometry.d} fill="none" stroke="none" />
          {geometry.hops.map((hop, i) => (
            <HopLine key={`${stepKey}-${i}`} hop={hop} state={stop(i)} progress={progress} />
          ))}
        </g>
      )}

      {NODE_IDS.map((id) => (
        <NodeBox
          key={id}
          node={NODES[id]}
          state={stateOf(id)}
          selected={selected === id}
          tabbable={rover === id}
          compact={compact}
          onSelect={onSelect}
          onFocus={setRover}
          onArrow={moveFocus}
        />
      ))}

      {showCache && step?.cache && <CacheBadge key={`${stepKey}-cache`} kind={step.cache} />}

      {geometry && step && (
        <g pointerEvents="none" aria-hidden>
          {geometry.badges.map((point, i) => (
            <StopBadge key={`${stepKey}-${i}`} n={i + 1} at={point} state={stop(i)} />
          ))}
        </g>
      )}

      {geometry && (
        <g ref={markerRef} pointerEvents="none">
          <circle r={9} fill={alpha(SIGNAL, 0.22)} className={styles.halo} />
          <circle r={4} fill="#ffffff" filter="url(#xray-glow)" />
          <g ref={capsuleRef} data-width={packet ? packet.headers.length * CAPSULE_SEGMENT : 0}>
            <AnimatePresence>{packet && <Capsule key={stepKey} packet={packet} />}</AnimatePresence>
          </g>
        </g>
      )}
    </svg>
    </div>
  );
}

function NodeBox({
  node,
  state,
  selected,
  tabbable,
  compact,
  onSelect,
  onFocus,
  onArrow,
}: {
  node: MachineNode;
  state: NodeState;
  selected: boolean;
  tabbable: boolean;
  compact: boolean;
  onSelect: (id: NodeId) => void;
  onFocus: (id: NodeId) => void;
  onArrow: (id: NodeId, key: string) => boolean;
}) {
  const hex = LAYER_HEX[node.layer];
  const lit = state === "current" || state === "passed";
  const opacity = state === "dim" ? 0.55 : state === "scenario" ? 0.7 : 1;
  // Software is glass; hardware is a solid part on the board; the network is out there.
  const glass = node.layer === "user" || node.layer === "kernel";
  const solid = node.layer === "hardware";
  const tall = node.h >= 60;
  const labelY = node.bar ? 19 : tall ? 22 : compact ? node.h / 2 + 4 : node.h / 2 - 2;
  const subY = tall ? 38 : node.h / 2 + 12;

  return (
    <motion.g
      transform={`translate(${node.x} ${node.y})`}
      initial={false}
      animate={{ opacity }}
      transition={{ duration: 0.35 }}
      role="button"
      tabIndex={tabbable ? 0 : -1}
      data-node={node.id}
      aria-label={`${node.label}. ${node.about}`}
      className={`cursor-pointer outline-none ${styles.node}`}
      onClick={() => onSelect(node.id)}
      onFocus={() => onFocus(node.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(node.id);
        } else if (e.key in ARROWS && onArrow(node.id, e.key)) {
          e.preventDefault();
        }
      }}
    >
      {state === "current" && (
        <rect
          className={styles.pulse}
          x={-3}
          y={-3}
          width={node.w + 6}
          height={node.h + 6}
          rx={10}
          fill="none"
          stroke={SIGNAL}
        />
      )}
      {solid && <rect width={node.w} height={node.h} rx={5} fill="#120e0a" />}
      {glass && <rect width={node.w} height={node.h} rx={7} fill="url(#glass-chip)" />}
      <rect
        className={styles.box}
        width={node.w}
        height={node.h}
        rx={glass ? 7 : 5}
        fill={lit ? alpha(hex, 0.2) : alpha(hex, glass ? 0.05 : solid ? 0.06 : 0.07)}
        stroke={lit ? SIGNAL : state === "ahead" ? alpha(SIGNAL, 0.55) : alpha(hex, solid ? 0.6 : 0.5)}
        strokeWidth={state === "current" ? 2.4 : lit ? 1.6 : state === "ahead" ? 1.3 : solid ? 1.3 : 1}
        strokeDasharray={state === "ahead" ? "4 3" : undefined}
        filter={state === "current" ? "url(#xray-glow)" : undefined}
      />
      {glass && !node.bar && (
        <path d={`M 6 0.75 H ${node.w - 6}`} stroke="rgba(255,255,255,0.32)" strokeWidth={1} />
      )}
      <Decoration node={node} />
      {node.bar ? (
        <text x={node.w / 2} y={labelY} textAnchor="middle" fontSize={12.5} fontWeight={600} fill="#e8edf2">
          {node.label}
          {!compact && (
            <tspan fill="#8b96a3" fontSize={10} fontWeight={400} className="font-mono">
              {"   ·   "}
              {node.sub}
            </tspan>
          )}
        </text>
      ) : (
        <>
          <text x={10} y={labelY} fontSize={12.5} fontWeight={600} fill="#e8edf2">
            {node.label}
          </text>
          {node.sub && !compact && (
            <text x={10} y={subY} fontSize={9.5} fill="#8b96a3" className="font-mono">
              {node.sub}
            </text>
          )}
        </>
      )}
      {selected && (
        <rect
          x={-4}
          y={-4}
          width={node.w + 8}
          height={node.h + 8}
          rx={10}
          fill="none"
          stroke="#ffffff"
          strokeDasharray="4 4"
        />
      )}
    </motion.g>
  );
}

function Decoration({ node }: { node: MachineNode }) {
  const hex = LAYER_HEX[node.layer];
  const ink = alpha(hex, 0.32);
  switch (node.id) {
    case "cpu":
      return (
        <g>
          {[0, 1, 2, 3].map((i) => (
            <g key={i} transform={`translate(${12 + (i % 2) * 54} ${46 + Math.floor(i / 2) * 26})`}>
              <rect width={50} height={22} rx={3} fill={alpha(hex, 0.08)} stroke={ink} />
              <text x={25} y={14.5} textAnchor="middle" fontSize={8.5} fill="#8b96a3" className="font-mono">
                core {i}
              </text>
            </g>
          ))}
        </g>
      );
    case "ram":
      return (
        <g>
          {["program code", "page cache", "rings · buffers"].map((label, i) => (
            <g key={label} transform={`translate(12 ${44 + i * 18})`}>
              <rect width={node.w - 24} height={15} rx={3} fill={alpha(hex, 0.08)} stroke={ink} />
              <text x={7} y={11} fontSize={9} fill="#8b96a3" className="font-mono">
                {label}
              </text>
            </g>
          ))}
        </g>
      );
    case "ssd":
      return (
        <g>
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(${12 + i * 52} 48)`}>
              <rect width={44} height={40} rx={3} fill="#0b0e12" stroke={ink} />
              <text x={22} y={24} textAnchor="middle" fontSize={8.5} fill="#8b96a3" className="font-mono">
                NAND
              </text>
            </g>
          ))}
        </g>
      );
    case "nic":
      return (
        <g transform={`translate(${node.w - 44} 52)`}>
          <rect width={32} height={26} rx={3} fill="#0b0e12" stroke={ink} />
          <rect x={8} y={16} width={16} height={10} fill={alpha(hex, 0.3)} />
        </g>
      );
    case "speakers":
      return (
        <g transform={`translate(${node.w - 21} 9)`} fill="none" stroke={ink} strokeWidth={1.4}>
          <path d="M0 5h4l5-4v14l-5-4H0z" fill={alpha(hex, 0.25)} />
          <path d="M12 4.5a5 5 0 0 1 0 7" strokeLinecap="round" />
        </g>
      );
    default:
      return null;
  }
}

const HOP_INK: Record<StopState, string> = {
  done: alpha(SIGNAL, 0.8),
  current: SIGNAL,
  ahead: "rgba(255,255,255,0.42)",
};

/**
 * One hop of the route. Done: a solid arrow. Ahead: a dashed one, so the
 * whole route shows before the signal gets there. The hop the signal travels
 * now draws itself as it goes, from the shared playhead.
 */
function HopLine({ hop, state, progress }: { hop: Hop; state: StopState; progress: MotionValue<number> }) {
  const span = hop.to - hop.from || 1;
  const drawn = useTransform(progress, (p) => Math.min(1, Math.max(0, (p - hop.from) / span)));
  if (state === "done") {
    return <path d={hop.d} fill="none" stroke={HOP_INK.done} strokeWidth={2.2} strokeLinecap="round" markerEnd="url(#hop-done)" />;
  }
  return (
    <g>
      <path
        d={hop.d}
        fill="none"
        stroke={HOP_INK.ahead}
        strokeWidth={1.5}
        strokeDasharray="5 5"
        strokeLinecap="round"
        markerEnd={`url(#hop-${state === "current" ? "current" : "ahead"})`}
      />
      {state === "current" && (
        <motion.path
          d={hop.d}
          fill="none"
          stroke={SIGNAL}
          strokeWidth={3}
          strokeLinecap="round"
          filter="url(#xray-glow)"
          style={{ pathLength: drawn }}
        />
      )}
    </g>
  );
}

/** A stop's number: where it comes in the step, lit when the signal is there. */
function StopBadge({ n, at, state }: { n: number; at: Point; state: StopState }) {
  const fill = state === "current" ? SIGNAL : state === "done" ? "#0c3540" : "#0b0f14";
  const ink = state === "current" ? "#03141a" : state === "done" ? SIGNAL : "rgba(255,255,255,0.75)";
  const ring = state === "ahead" ? "rgba(255,255,255,0.45)" : SIGNAL;
  return (
    <g transform={`translate(${at.x} ${at.y})`}>
      {state === "current" && <circle r={14} fill="none" stroke={SIGNAL} strokeWidth={2} className={styles.ping} />}
      <motion.circle
        r={14}
        fill={fill}
        stroke={ring}
        strokeWidth={1.6}
        initial={false}
        animate={{ scale: state === "current" ? 1.18 : 1 }}
        transition={{ duration: 0.25 }}
        filter={state === "current" ? "url(#xray-glow)" : undefined}
      />
      <text y={5} textAnchor="middle" fontSize={14} fontWeight={800} fill={ink} className="font-mono">
        {n}
      </text>
    </g>
  );
}

/** The moment the page cache decides: HIT means RAM answers, MISS means a trip to the disk. */
function CacheBadge({ kind }: { kind: "hit" | "miss" }) {
  const node = NODES.pagecache;
  const color = kind === "hit" ? "#7ee0a1" : "#ffb35c";
  const cx = node.x + node.w - 34;
  const cy = node.y + node.h / 2;
  return (
    <g pointerEvents="none" aria-hidden>
      <motion.circle
        cx={node.x + node.w / 2}
        cy={cy}
        fill="none"
        stroke={color}
        strokeWidth={2}
        initial={{ r: 24, opacity: 0.85 }}
        animate={{ r: 120, opacity: 0 }}
        transition={{ duration: 1.1, ease: "easeOut" }}
      />
      <g transform={`translate(${cx} ${cy})`}>
        <motion.g
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: [0.4, 1.18, 1], opacity: 1 }}
          transition={{ duration: 0.5, times: [0, 0.6, 1] }}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        >
          <rect x={-31} y={-14} width={62} height={28} rx={14} fill={alpha(color, 0.28)} />
          <rect x={-25} y={-10} width={50} height={20} rx={10} fill={color} />
          <text x={0} y={4} textAnchor="middle" fontSize={11} fontWeight={800} fill="#05080b" className="font-mono">
            {kind === "hit" ? "HIT" : "MISS"}
          </text>
        </motion.g>
      </g>
    </g>
  );
}

const CAPSULE_SEGMENT = 30;

/** Centre the capsule above the signal (or below it), always inside the view. */
function placeCapsule(
  capsule: SVGGElement | null,
  point: { x: number; y: number },
  below: boolean,
) {
  if (!capsule) return;
  const width = Number(capsule.dataset.width ?? 0);
  const dx = Math.max(6 - point.x, Math.min(VIEW.width - 6 - width - point.x, -width / 2));
  const dy = below || point.y < 72 ? 18 : -40;
  capsule.setAttribute("transform", `translate(${dx.toFixed(1)} ${dy})`);
}

function Capsule({ packet }: { packet: Packet }) {
  const segment = CAPSULE_SEGMENT;
  const height = 16;
  const width = packet.headers.length * segment;
  return (
    <motion.g
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <motion.rect
        x={-3}
        y={-3}
        height={height + 6}
        rx={6}
        fill="#05080b"
        stroke="rgba(255,255,255,0.22)"
        initial={false}
        animate={{ width: width + 4 }}
        transition={{ duration: 0.3 }}
      />
      <AnimatePresence initial={false}>
        {packet.headers.map((header, i) => (
          <motion.g
            key={`${header.kind}-${header.title}`}
            initial={{ opacity: 0, x: i * segment - 14 }}
            animate={{ opacity: 1, x: i * segment }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <rect
              width={segment - 2}
              height={height}
              rx={3}
              fill={HEADER_COLOR[header.kind]}
              opacity={header.encrypted ? 0.7 : 0.95}
            />
            {header.encrypted && (
              <rect width={segment - 2} height={height} rx={3} fill="url(#xray-stripes)" />
            )}
            <text
              x={(segment - 2) / 2}
              y={11.5}
              textAnchor="middle"
              fontSize={8.5}
              fontWeight={700}
              fill="#05080b"
              className="font-mono"
            >
              {HEADER_TAG[header.kind]}
            </text>
          </motion.g>
        ))}
      </AnimatePresence>
    </motion.g>
  );
}
