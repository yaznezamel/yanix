"use client";

import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  type AnimationPlaybackControls,
} from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { travelMs, type Speed } from "@/lib/xray/engine";
import { buildPath, nodeIndexAt } from "@/lib/xray/geometry";
import { BANDS, NODES, NODE_IDS, TOPOLOGY, VIEW } from "@/lib/xray/nodes";
import { packetAt } from "@/lib/xray/packets";
import type { Layer, MachineNode, NodeId, Packet, Step } from "@/lib/xray/types";
import styles from "./lab.module.css";
import { HEADER_COLOR, HEADER_TAG, LAYER_HEX, SIGNAL, alpha } from "./palette";

type NodeState = "idle" | "current" | "path" | "scenario" | "dim";

interface XRayMapProps {
  step: Step | null;
  stepKey: string;
  /** Last path node the signal has reached. */
  reached: number;
  playing: boolean;
  speed: Speed;
  reduced: boolean;
  selected: NodeId | null;
  scenarioNodes: ReadonlySet<NodeId> | null;
  onSelect: (id: NodeId) => void;
  onReach: (stepKey: string, index: number) => void;
}

const BOUNDARIES = [
  { id: "syscall", d: "M 8 182 H 716", label: "system calls", x: 712, y: 179 },
  { id: "device", d: "M 8 558 H 716", label: "MMIO · DMA · interrupts", x: 712, y: 555 },
  { id: "cable", d: "M 723 14 V 746", label: "", x: 0, y: 0 },
] as const;

type BoundaryId = (typeof BOUNDARIES)[number]["id"];

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
  reached,
  playing,
  speed,
  reduced,
  selected,
  scenarioNodes,
  onSelect,
  onReach,
}: XRayMapProps) {
  const geometry = useMemo(() => (step ? buildPath(step.path) : null), [step]);
  const baseTravel = step ? travelMs(step, 1) : 0;
  const progress = useMotionValue(0);
  const routeRef = useRef<SVGPathElement>(null);
  const markerRef = useRef<SVGGElement>(null);
  const capsuleRef = useRef<SVGGElement>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const belowRef = useRef(false);
  // Tall boxes keep their label at the top: park the capsule under the signal there.
  const destination = step ? step.path[step.path.length - 1] : undefined;
  const capsuleBelow = destination ? NODES[destination].h >= 60 : false;
  const controlsRef = useRef<AnimationPlaybackControls | null>(null);
  const finishedRef = useRef(false);
  const speedRef = useRef(speed);
  const prevPlaying = useRef(playing);

  // Keep the latest values for the travel effect without restarting it.
  useEffect(() => {
    speedRef.current = speed;
    if (controlsRef.current) controlsRef.current.speed = speed;
  }, [speed]);

  // One travel animation per step: the motion value drives both the glowing
  // trail and the packet marker, so pausing freezes both.
  useEffect(() => {
    const route = routeRef.current;
    const marker = markerRef.current;
    if (!geometry || !route || !marker) return;
    const total = route.getTotalLength();
    const place = (p: number) => {
      const point = route.getPointAtLength(total * p);
      marker.setAttribute("transform", `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`);
      lastPoint.current = { x: point.x, y: point.y };
      placeCapsule(capsuleRef.current, point, capsuleBelow);
    };
    belowRef.current = capsuleBelow;
    finishedRef.current = false;
    progress.jump(0);
    place(0);
    let last = 0;
    const unsubscribe = progress.on("change", (p) => {
      place(p);
      const index = nodeIndexAt(geometry.nodeAt, p);
      if (index !== last) {
        last = index;
        onReach(stepKey, index);
      }
      if (p >= 1) finishedRef.current = true;
    });
    const controls = animate(progress, 1, {
      duration: reduced || baseTravel === 0 ? 0 : baseTravel / 1000,
      ease: [0.42, 0, 0.2, 1],
    });
    controls.speed = speedRef.current;
    controlsRef.current = controls;
    return () => {
      unsubscribe();
      controls.stop();
    };
  }, [stepKey, geometry, baseTravel, reduced, progress, onReach, capsuleBelow]);

  // Pause and resume the travel when the user does.
  useEffect(() => {
    if (prevPlaying.current === playing) return;
    prevPlaying.current = playing;
    const controls = controlsRef.current;
    if (!controls || finishedRef.current) return;
    if (playing) controls.play();
    else controls.pause();
  }, [playing]);

  // The capsule's width changes when headers are added; re-place it then.
  useEffect(() => {
    if (lastPoint.current) placeCapsule(capsuleRef.current, lastPoint.current, belowRef.current);
  });

  const crossed = crossings(step);
  const packet = step ? packetAt(step.frames, reached) : null;
  const current = step ? step.path[Math.min(reached, step.path.length - 1)] : undefined;
  const cacheAt = step?.cache ? step.path.indexOf("pagecache") : -1;
  const showCache = cacheAt >= 0 && reached >= cacheAt;

  function stateOf(id: NodeId): NodeState {
    if (!step) return "idle";
    if (id === current) return "current";
    if (step.path.includes(id)) return "path";
    if (scenarioNodes?.has(id)) return "scenario";
    return "dim";
  }

  return (
    <svg
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      preserveAspectRatio="xMidYMin meet"
      className="h-full w-full select-none"
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
        <pattern id="xray-stripes" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="6" fill="rgba(5,8,11,0.35)" />
        </pattern>
      </defs>

      {BANDS.map((band) => (
        <g key={band.layer}>
          <rect
            x={band.x}
            y={band.y}
            width={band.w}
            height={band.h}
            rx={12}
            fill={alpha(LAYER_HEX[band.layer], 0.045)}
            stroke={alpha(LAYER_HEX[band.layer], 0.14)}
          />
          <text
            x={band.x + 10}
            y={band.y + 18}
            fontSize={10.5}
            letterSpacing="0.14em"
            fill={LAYER_HEX[band.layer]}
            className="font-mono"
          >
            {band.label}
          </text>
        </g>
      ))}

      {BOUNDARIES.map((b) => {
        const active = crossed.has(b.id);
        return (
          <g key={b.id} className={active ? styles.boundaryActive : undefined}>
            <path
              d={b.d}
              stroke={active ? SIGNAL : "rgba(255,255,255,0.14)"}
              strokeWidth={active ? 2 : 1}
              strokeDasharray="5 5"
              filter={active ? "url(#xray-glow)" : undefined}
            />
            {b.label && (
              <text
                x={b.x}
                y={b.y}
                fontSize={10}
                textAnchor="end"
                fill={active ? SIGNAL : "rgba(255,255,255,0.35)"}
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
        <g>
          <path
            ref={routeRef}
            d={geometry.d}
            fill="none"
            stroke={alpha(SIGNAL, 0.35)}
            strokeWidth={1.6}
            strokeLinecap="round"
            className={styles.marching}
          />
          <motion.path
            d={geometry.d}
            fill="none"
            stroke={SIGNAL}
            strokeWidth={3.2}
            strokeLinecap="round"
            filter="url(#xray-glow)"
            style={{ pathLength: progress }}
          />
        </g>
      )}

      {NODE_IDS.map((id) => (
        <NodeBox
          key={id}
          node={NODES[id]}
          state={stateOf(id)}
          selected={selected === id}
          onSelect={onSelect}
        />
      ))}

      {showCache && step?.cache && <CacheBadge key={`${stepKey}-cache`} kind={step.cache} />}

      {geometry && (
        <g ref={markerRef} pointerEvents="none">
          <circle r={13} fill={alpha(SIGNAL, 0.22)} className={styles.halo} />
          <circle r={5.5} fill="#ffffff" filter="url(#xray-glow)" />
          <g ref={capsuleRef} data-width={packet ? packet.headers.length * CAPSULE_SEGMENT : 0}>
            <AnimatePresence>{packet && <Capsule key={stepKey} packet={packet} />}</AnimatePresence>
          </g>
        </g>
      )}
    </svg>
  );
}

function NodeBox({
  node,
  state,
  selected,
  onSelect,
}: {
  node: MachineNode;
  state: NodeState;
  selected: boolean;
  onSelect: (id: NodeId) => void;
}) {
  const hex = LAYER_HEX[node.layer];
  const lit = state === "current" || state === "path";
  const opacity = state === "dim" ? 0.26 : state === "scenario" ? 0.55 : 1;
  const tall = node.h >= 60;
  const labelY = node.bar ? 19 : tall ? 22 : node.h / 2 - 2;
  const subY = tall ? 38 : node.h / 2 + 12;

  return (
    <motion.g
      transform={`translate(${node.x} ${node.y})`}
      initial={false}
      animate={{ opacity }}
      transition={{ duration: 0.35 }}
      role="button"
      tabIndex={0}
      aria-label={`${node.label}. ${node.about}`}
      className={`cursor-pointer outline-none ${styles.node}`}
      onClick={() => onSelect(node.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(node.id);
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
      <rect
        className={styles.box}
        width={node.w}
        height={node.h}
        rx={7}
        fill={lit ? alpha(hex, 0.2) : alpha(hex, 0.07)}
        stroke={lit ? SIGNAL : alpha(hex, 0.5)}
        strokeWidth={state === "current" ? 2.4 : lit ? 1.6 : 1}
        filter={state === "current" ? "url(#xray-glow)" : undefined}
      />
      <Decoration node={node} />
      {node.bar ? (
        <text x={node.w / 2} y={labelY} textAnchor="middle" fontSize={12.5} fontWeight={600} fill="#e8edf2">
          {node.label}
          <tspan fill="#8b96a3" fontSize={10} fontWeight={400} className="font-mono">
            {"   ·   "}
            {node.sub}
          </tspan>
        </text>
      ) : (
        <>
          <text x={10} y={labelY} fontSize={12.5} fontWeight={600} fill="#e8edf2">
            {node.label}
          </text>
          {node.sub && (
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
