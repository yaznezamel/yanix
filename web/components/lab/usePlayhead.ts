"use client";

import { animate, cubicBezier, useMotionValue, type MotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { readMs, travelMs, type PlayerAction, type RunStatus, type Speed } from "@/lib/xray/engine";
import { nodeIndexAt } from "@/lib/xray/geometry";
import type { Step } from "@/lib/xray/types";

// One clock for every view of a trace. `fraction` runs from 0 to 1 through a
// step: first the signal travels along the step's path, then there is time to
// read. The software map and the hardware view both draw from it, the timeline
// shows it, and dragging the timeline sets it, so scrubbing moves every view
// together, mid-step included. When a step's time is up, the clock asks the
// reducer for the next step.

const TRAVEL_EASE = cubicBezier(0.42, 0, 0.2, 1);

export interface Playhead {
  /** How far through the current step, from 0 to 1. */
  fraction: MotionValue<number>;
  /** How far the signal has travelled along the step's path, from 0 to 1. */
  progress: MotionValue<number>;
  /** The last path node the signal has reached. */
  reached: number;
  /** Jump to a point in the trace: a step, and how far through it. */
  seek: (index: number, fraction: number) => void;
}

interface PlayheadOptions {
  step: Step | null;
  /** Changes whenever a different step, or a replay of one, is shown. */
  stepKey: string;
  index: number;
  status: RunStatus | null;
  speed: Speed;
  reduced: boolean;
  /** Where along the path each node sits (from buildPath). */
  nodeAt: number[] | null;
  dispatch: (action: PlayerAction) => void;
}

export function usePlayhead({
  step,
  stepKey,
  index,
  status,
  speed,
  reduced,
  nodeAt,
  dispatch,
}: PlayheadOptions): Playhead {
  const fraction = useMotionValue(0);
  const progress = useMotionValue(0);
  const [reach, setReach] = useState({ key: "", index: 0 });
  // Bumped when a seek moves the clock within the same step, to restart it from there.
  const [restarts, setRestarts] = useState(0);
  const pending = useRef<{ index: number; fraction: number } | null>(null);
  const indexRef = useRef(index);
  const travel = step ? travelMs(step, 1) : 0;
  const total = step ? travel + readMs(step, 1) : 0;

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // The signal travels during the first part of the step, eased; with reduced
  // motion it is simply there.
  useEffect(() => {
    const toProgress = (f: number) =>
      reduced || travel === 0 ? 1 : TRAVEL_EASE(Math.min(1, (f * total) / travel));
    const offFraction = fraction.on("change", (f) => progress.set(toProgress(f)));
    const offProgress = progress.on("change", (p) => {
      if (!nodeAt) return;
      const i = nodeIndexAt(nodeAt, p);
      setReach((r) => (r.key === stepKey && r.index === i ? r : { key: stepKey, index: i }));
    });
    progress.set(toProgress(fraction.get()));
    return () => {
      offFraction();
      offProgress();
    };
  }, [stepKey, travel, total, reduced, nodeAt, fraction, progress]);

  // A new step starts at its beginning, or where a seek asked for.
  useEffect(() => {
    const wanted = pending.current;
    pending.current = null;
    fraction.jump(wanted && wanted.index === indexRef.current ? wanted.fraction : 0);
  }, [stepKey, fraction]);

  // Run the clock while playing; when the step's time is up, go to the next.
  useEffect(() => {
    if (!step || status === null) return;
    if (status === "done") {
      fraction.jump(1);
      return;
    }
    if (status !== "playing") return;
    const from = fraction.get();
    const controls = animate(fraction, 1, {
      duration: ((1 - from) * total) / speed / 1000,
      ease: "linear",
      onComplete: () => dispatch({ type: "tick" }),
    });
    return () => controls.stop();
  }, [step, stepKey, status, speed, total, restarts, fraction, dispatch]);

  const seek = useCallback(
    (target: number, at: number) => {
      const clamped = Math.min(1, Math.max(0, at));
      dispatch({ type: "seek", index: target, partial: clamped < 1 });
      if (target === indexRef.current) {
        fraction.jump(clamped);
        setRestarts((n) => n + 1);
      } else {
        pending.current = { index: target, fraction: clamped };
      }
    },
    [dispatch, fraction],
  );

  const fallback = nodeAt ? nodeIndexAt(nodeAt, reduced ? 1 : 0) : 0;
  return {
    fraction,
    progress,
    reached: reach.key === stepKey ? reach.index : fallback,
    seek,
  };
}
