"use client";

import type { MotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { RunStatus, Speed } from "@/lib/xray/engine";
import { NODES } from "@/lib/xray/nodes";
import type { Phase, Step } from "@/lib/xray/types";
import { LAYER_HEX, PHASE_NAME } from "./palette";

interface PlaybackBarProps {
  steps: Step[];
  index: number;
  status: RunStatus | null;
  /** The trace ends with a program asking for a line: jump to its question. */
  onSkipToQuestion: (() => void) | null;
  speed: Speed;
  /** How far through the current step the shared playhead is, from 0 to 1. */
  fraction: MotionValue<number>;
  onAction: (action: "toggle" | "next" | "prev" | "restart" | "finish") => void;
  /** Move the playhead to a step and a point within it. */
  onSeek: (index: number, fraction: number) => void;
  /** Dragging the timeline pauses playback until you let go. */
  onScrub: (scrubbing: boolean) => void;
  onSpeed: (speed: Speed) => void;
}

interface PhaseSpan {
  phase: Phase;
  start: number;
  count: number;
}

function phaseSpans(steps: Step[]): PhaseSpan[] {
  const spans: PhaseSpan[] = [];
  steps.forEach((step, i) => {
    const last = spans[spans.length - 1];
    if (last && last.phase === step.phase) last.count += 1;
    else spans.push({ phase: step.phase, start: i, count: 1 });
  });
  return spans;
}

const SPEEDS: Speed[] = [0.5, 1, 2];

function IconButton({
  label,
  onClick,
  disabled,
  children,
  primary,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-9 place-items-center rounded-md transition disabled:opacity-35 ${
        primary
          ? "w-12 bg-signal text-[#03141a] hover:brightness-110"
          : "w-9 border border-lab-line bg-lab-panel2 text-lab-ink hover:border-white/25"
      }`}
    >
      {children}
    </button>
  );
}

export function PlaybackBar({
  steps,
  index,
  status,
  onSkipToQuestion,
  speed,
  fraction,
  onAction,
  onSeek,
  onScrub,
  onSpeed,
}: PlaybackBarProps) {
  const idle = status === null;
  const playing = status === "playing";
  const spans = phaseSpans(steps);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-1.5">
        <IconButton label="Replay trace" onClick={() => onAction("restart")} disabled={idle}>
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
            <path d="M3 3v4h4" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3.6 6.5A5 5 0 1 1 4 11" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </IconButton>
        <IconButton label="Previous step" onClick={() => onAction("prev")} disabled={idle}>
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
            <path d="M11 3 5 8l6 5z" fill="currentColor" />
            <rect x="3" y="3" width="1.8" height="10" fill="currentColor" />
          </svg>
        </IconButton>
        <IconButton
          label={playing ? "Pause trace" : "Play trace"}
          onClick={() => onAction("toggle")}
          disabled={idle}
          primary
        >
          {playing ? (
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
              <rect x="3.5" y="3" width="3" height="10" fill="currentColor" />
              <rect x="9.5" y="3" width="3" height="10" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
              <path d="M4 3v10l9-5z" fill="currentColor" />
            </svg>
          )}
        </IconButton>
        <IconButton label="Next step" onClick={() => onAction("next")} disabled={idle}>
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
            <path d="m5 3 6 5-6 5z" fill="currentColor" />
            <rect x="11.2" y="3" width="1.8" height="10" fill="currentColor" />
          </svg>
        </IconButton>
        <IconButton label="Skip to the end" onClick={() => onAction("finish")} disabled={idle}>
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
            <path d="m2 3 5 5-5 5zm6 0 5 5-5 5z" fill="currentColor" />
          </svg>
        </IconButton>
        {onSkipToQuestion && (
          <button
            type="button"
            onClick={onSkipToQuestion}
            className="h-9 whitespace-nowrap rounded-md border border-signal/60 bg-signal/10 px-3 text-[12.5px] font-medium text-signal hover:bg-signal/20"
          >
            Skip to the question
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 rounded-md border border-lab-line bg-lab-panel2 p-0.5" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSpeed(s)}
            aria-pressed={speed === s}
            className={`rounded px-2 py-1 font-mono text-[11px] ${
              speed === s ? "bg-white/10 text-lab-ink" : "text-lab-muted hover:text-lab-ink"
            }`}
          >
            {s}×
          </button>
        ))}
      </div>

      <div className="min-w-[240px] flex-1">
        {idle ? (
          <p className="text-[12.5px] text-lab-muted">
            Nothing playing. Do something on the screen to start a trace.
          </p>
        ) : (
          <div>
            <div className="mb-1 flex gap-[3px]" aria-hidden>
              {spans.map((span) => (
                <div
                  key={`${span.phase}-${span.start}`}
                  className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-lab-muted"
                  style={{ flex: `${span.count} 1 0` }}
                >
                  {span.count >= 2 ? PHASE_NAME[span.phase] : ""}
                </div>
              ))}
            </div>
            <Timeline
              steps={steps}
              index={index}
              fraction={fraction}
              onSeek={onSeek}
              onScrub={onScrub}
              onAction={onAction}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Gap between step segments, in pixels. */
const GAP = 3;

/**
 * The trace as a scrubbable timeline, like a video's: one segment per step,
 * coloured by the layer it starts in, and a playhead that moves through each
 * step. Click or drag anywhere to jump there; arrow keys step.
 */
function Timeline({
  steps,
  index,
  fraction,
  onSeek,
  onScrub,
  onAction,
}: {
  steps: Step[];
  index: number;
  fraction: MotionValue<number>;
  onSeek: (index: number, fraction: number) => void;
  onScrub: (scrubbing: boolean) => void;
  onAction: (action: "next" | "prev" | "finish") => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [hover, setHover] = useState<{ index: number; x: number; width: number } | null>(null);
  const count = steps.length;
  const current = steps[index];

  // Follow the shared playhead without re-rendering React on every frame.
  useEffect(() => {
    const place = (f: number) => {
      const head = headRef.current;
      if (!head) return;
      const at = (index + Math.min(1, Math.max(0, f))) / count;
      head.style.left = `calc((100% - ${(count - 1) * GAP}px) * ${at} + ${index * GAP}px)`;
    };
    place(fraction.get());
    return fraction.on("change", place);
  }, [fraction, index, count]);

  function positionAt(clientX: number): { index: number; fraction: number; x: number; width: number } {
    const rect = trackRef.current!.getBoundingClientRect();
    const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
    const segment = (rect.width - (count - 1) * GAP) / count;
    const i = Math.min(count - 1, Math.floor(x / (segment + GAP)));
    const within = (x - i * (segment + GAP)) / segment;
    return { index: i, fraction: Math.min(1, Math.max(0, within)), x, width: rect.width };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    onScrub(true);
    const at = positionAt(e.clientX);
    onSeek(at.index, at.fraction);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const at = positionAt(e.clientX);
    if (dragging.current) onSeek(at.index, at.fraction);
    setHover((h) =>
      h && h.index === at.index && Math.abs(h.x - at.x) < 1 ? h : { index: at.index, x: at.x, width: at.width },
    );
  }

  function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    onScrub(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        onAction("prev");
        break;
      case "ArrowRight":
      case "ArrowUp":
        onAction("next");
        break;
      case "Home":
        onSeek(0, 0);
        break;
      case "End":
        onAction("finish");
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  const tip = hover ? steps[hover.index] : undefined;

  return (
    <div className="relative">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Timeline"
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={index + 1}
        aria-valuetext={current ? `Step ${index + 1} of ${count}: ${current.title}` : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        className="relative flex h-5 cursor-pointer touch-none items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-signal"
        style={{ gap: GAP }}
      >
        {steps.map((step, i) => {
          const layer = NODES[step.path[0]!].layer;
          const state = i < index ? "done" : i === index ? "current" : "todo";
          return (
            <div
              key={step.id}
              aria-hidden
              className="h-3 min-w-[4px] flex-1 rounded-[3px]"
              style={{
                background: LAYER_HEX[layer],
                opacity: state === "todo" ? 0.45 : state === "done" ? 0.7 : 1,
              }}
            />
          );
        })}
        <div
          ref={headRef}
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 w-0.5 -translate-x-1/2 rounded bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]"
        >
          <div className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-white" />
        </div>
      </div>
      {tip && hover && (
        <div
          className="pointer-events-none absolute bottom-full mb-2 max-w-[260px] -translate-x-1/2 truncate rounded-md border border-lab-line bg-lab-panel2 px-2 py-1 text-[11.5px] text-lab-ink shadow-lg"
          style={{ left: Math.max(Math.min(hover.x, hover.width - 80), Math.min(80, hover.width / 2)) }}
        >
          <span className="font-mono text-lab-muted">{hover.index + 1}.</span> {tip.title}
        </div>
      )}
    </div>
  );
}
