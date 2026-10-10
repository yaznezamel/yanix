"use client";

import type { RunStatus, Speed } from "@/lib/xray/engine";
import { NODES } from "@/lib/xray/nodes";
import type { Phase, Step } from "@/lib/xray/types";
import { LAYER_HEX, PHASE_NAME } from "./palette";

interface PlaybackBarProps {
  steps: Step[];
  index: number;
  status: RunStatus | null;
  speed: Speed;
  onAction: (action: "toggle" | "next" | "prev" | "restart" | "finish") => void;
  onSeek: (index: number) => void;
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
  speed,
  onAction,
  onSeek,
  onSpeed,
}: PlaybackBarProps) {
  const idle = status === null;
  const playing = status === "playing";
  const spans = phaseSpans(steps);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-1.5">
        <IconButton label="Restart" onClick={() => onAction("restart")} disabled={idle}>
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
          label={playing ? "Pause" : "Play"}
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
            <div className="flex gap-[3px]" role="group" aria-label="Steps">
              {steps.map((step, i) => {
                const layer = NODES[step.path[0]!].layer;
                const state = i < index ? "done" : i === index ? "current" : "todo";
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => onSeek(i)}
                    title={`${i + 1}. ${step.title}`}
                    aria-label={`Step ${i + 1}: ${step.title}`}
                    aria-current={state === "current" ? "step" : undefined}
                    className="h-3 min-w-[6px] flex-1 rounded-[3px] transition"
                    style={{
                      background: LAYER_HEX[layer],
                      opacity: state === "todo" ? 0.22 : state === "done" ? 0.6 : 1,
                      outline: state === "current" ? "2px solid var(--color-signal)" : undefined,
                      outlineOffset: 1,
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
