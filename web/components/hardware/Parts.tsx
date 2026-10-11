"use client";

import { memo } from "react";
import { SIGNAL, alpha } from "@/components/lab/palette";
import type { Activity } from "@/lib/hardware/activity";
import { linkShape, type Detail, type Placed } from "@/lib/hardware/tree";
import type { Box, Link } from "@/lib/hardware/types";
import { BoardArt, DecorArt, Preview, WireArt, partArt } from "./art";
import type { Fades } from "./fades";
import styles from "./hardware.module.css";
import { inParent, partState, type PartState } from "./state";

// How each part, wire and frame of the hardware view is drawn: the drawing of
// the hardware (art.tsx), and over it an outline that lights up with the
// trace. Names are drawn in a layer of their own (Labels.tsx). Parts are
// focusable for the keyboard, but the pointer never reaches them: a clear pane
// over the drawing takes it, and the view finds the part under the pointer
// itself (pickAt), far cheaper than the browser testing thousands of shapes
// on every frame of a zoom.

interface PartViewProps {
  node: Placed;
  detail: Detail;
  activity: Activity;
  active: boolean;
  /** The one part in the tab order; arrow keys move between parts. */
  tabStop: string;
  fades: Fades;
  onDive: (p: Placed) => void;
  onReveal: (p: Placed) => void;
  onArrow: (p: Placed, key: string) => boolean;
}

/** Does the part, or a part inside it, have this id? */
function holds(node: Placed, id: string): boolean {
  return node.depth === 0 || id === node.id || id.startsWith(`${node.id}.`);
}

// For each activity, a signature of how each part and the parts inside it are lit.
const activityKeys = new WeakMap<Activity, Map<string, string>>();

function activityKey(activity: Activity, node: Placed): string {
  let keys = activityKeys.get(activity);
  if (!keys) {
    keys = new Map();
    activityKeys.set(activity, keys);
  }
  const known = keys.get(node.id);
  if (known !== undefined) return known;
  const own = activity.current.has(node.id) ? "c" : activity.touched.has(node.id) ? "t" : "-";
  // A part's parent being in use decides whether an unused part dims.
  const parent = node.parent && activity.touched.has(node.parent.id) ? "^" : "";
  const links = (node.part.links ?? [])
    .filter((l) => activity.links.has(`${node.id}:${l.id}`))
    .map((l) => l.id)
    .join(",");
  const key = `${own}${parent}${links}(${node.children.map((c) => activityKey(activity, c)).join("")})`;
  keys.set(node.id, key);
  return key;
}

// A part is drawn again only when something about it, or a part inside it,
// changed: zooming opens a few parts at a time, not the whole drawing.
function samePart(a: PartViewProps, b: PartViewProps): boolean {
  if (a.node !== b.node || a.active !== b.active || a.fades !== b.fades) return false;
  if (a.onDive !== b.onDive || a.onReveal !== b.onReveal || a.onArrow !== b.onArrow) return false;
  const id = a.node.id;
  if (a.detail !== b.detail && a.detail.keys.get(id) !== b.detail.keys.get(id)) return false;
  if (a.activity !== b.activity && activityKey(a.activity, a.node) !== activityKey(b.activity, b.node)) return false;
  if (a.tabStop !== b.tabStop && (holds(a.node, a.tabStop) || holds(a.node, b.tabStop))) return false;
  return true;
}

export const PartView = memo(function PartView({
  node,
  detail,
  activity,
  active,
  tabStop,
  fades,
  onDive,
  onReveal,
  onArrow,
}: PartViewProps) {
  const open = detail.open.has(node.id);
  const state = partState(node, activity, active);
  const reachable = node.depth === 0 || detail.interactive.has(node.id);

  return (
    <g className={styles.group} style={{ opacity: state === "dim" ? 0.45 : 1 }}>
      {node.depth > 0 && (
        <PartBox
          node={node}
          state={state}
          open={open}
          full={detail.full.has(node.id)}
          drawn={detail.drawn.has(node.id)}
          reachable={reachable}
          tabbable={reachable && node.id === tabStop}
          fades={fades}
          onDive={onDive}
          onReveal={onReveal}
          onArrow={onArrow}
        />
      )}
      {open && (
        <g ref={node.depth > 0 ? fades.track(node.id, "children") : undefined}>
          {node.part.frames?.map((frame) =>
            frame.kind === "board" ? (
              <BoardArt key={frame.label} box={inParent(node, frame.box)} />
            ) : (
              <FrameOutline key={frame.label} box={inParent(node, frame.box)} unit={node.unit} />
            ),
          )}
          {node.part.decor?.map((decor, i) => (
            <DecorArt key={i} decor={decor} box={inParent(node, decor.box)} />
          ))}
          {node.part.links?.map((link) => (
            <LinkView key={link.id} parent={node} link={link} lit={activity.links.has(`${node.id}:${link.id}`)} />
          ))}
          {node.children.map((child) => (
            <PartView
              key={child.id}
              node={child}
              detail={detail}
              activity={activity}
              active={active}
              tabStop={tabStop}
              fades={fades}
              onDive={onDive}
              onReveal={onReveal}
              onArrow={onArrow}
            />
          ))}
        </g>
      )}
    </g>
  );
}, samePart);

function PartBox({
  node,
  state,
  open,
  full,
  drawn,
  reachable,
  tabbable,
  fades,
  onDive,
  onReveal,
  onArrow,
}: {
  node: Placed;
  state: PartState;
  open: boolean;
  full: boolean;
  /** On screen or near it; otherwise only the outline is drawn, for keyboard focus. */
  drawn: boolean;
  reachable: boolean;
  tabbable: boolean;
  fades: Fades;
  onDive: (p: Placed) => void;
  onReveal: (p: Placed) => void;
  onArrow: (p: Placed, key: string) => boolean;
}) {
  const { world: w, part } = node;
  const lit = state === "current" || state === "touched";
  const art = drawn ? partArt(node) : null;
  const box = { x: w.x, y: w.y, width: w.w, height: w.h, rx: Math.min(w.w, w.h) * 0.03 };

  return (
    <g
      role="button"
      tabIndex={tabbable ? 0 : -1}
      aria-hidden={reachable ? undefined : true}
      aria-label={`${part.label}. ${part.about}`}
      data-part={node.id}
      className={styles.part}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDive(node);
        } else if (e.key.startsWith("Arrow") && onArrow(node, e.key)) {
          e.preventDefault();
        }
      }}
      // Only assistive technology clicks a part: the pointer never hits one.
      onClick={() => onDive(node)}
      onFocus={(e) => {
        if (e.currentTarget.matches(":focus-visible")) onReveal(node);
      }}
    >
      {art && (
        <g transform={`translate(${w.x} ${w.y})`}>
          {art.base}
          {open && art.open}
          {/* What hides the children: a lid fades out as they fade in; a preview of them stays until they are fully shown. */}
          {!full &&
            (art.cover ? (
              <g ref={fades.track(node.id, "cover")}>{art.cover}</g>
            ) : node.children.length > 0 ? (
              <Preview node={node} />
            ) : null)}
        </g>
      )}
      {state === "current" && (
        <rect className={styles.pulse} {...box} fill="none" stroke={SIGNAL} vectorEffect="non-scaling-stroke" />
      )}
      <rect
        className={styles.box}
        {...box}
        fill={state === "current" ? alpha(SIGNAL, 0.16) : lit ? alpha(SIGNAL, 0.08) : "none"}
        stroke={state === "current" ? SIGNAL : lit ? alpha(SIGNAL, 0.6) : "rgba(255,255,255,0.12)"}
        strokeWidth={state === "current" ? 2.4 : lit ? 1.6 : 1}
        vectorEffect="non-scaling-stroke"
      />
      {/* Flashed by "Show in Hardware", to point out the part. */}
      <rect
        data-spot
        {...box}
        fill="none"
        stroke="#ffffff"
        strokeWidth={3}
        opacity={0}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function LinkView({ parent, link, lit }: { parent: Placed; link: Link; lit: boolean }) {
  const { points } = linkShape(parent, link);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  return (
    <g>
      <WireArt points={points} cable={link.cable} />
      {lit && (
        <>
          <path
            d={d}
            fill="none"
            stroke={SIGNAL}
            strokeOpacity={0.25}
            strokeWidth={8}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path d={d} fill="none" stroke={SIGNAL} strokeWidth={2.2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </>
      )}
    </g>
  );
}

/** The space around the computer: a dashed outline, since it is not a thing you could hold. */
function FrameOutline({ box, unit }: { box: Box; unit: number }) {
  return (
    <rect
      x={box.x}
      y={box.y}
      width={box.w}
      height={box.h}
      rx={14 * unit}
      fill="rgba(255,255,255,0.015)"
      stroke="rgba(255,255,255,0.12)"
      strokeDasharray="6 6"
      vectorEffect="non-scaling-stroke"
    />
  );
}
