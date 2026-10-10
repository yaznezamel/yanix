"use client";

import { MotionConfig, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Desktop } from "@/components/desktop/Desktop";
import { VirtualScreen } from "@/components/desktop/VirtualScreen";
import {
  INITIAL_PLAYER,
  currentApps,
  machineAt,
  playerReducer,
  stepMs,
  visibleSteps,
  type PlayerAction,
} from "@/lib/xray/engine";
import { framesAround } from "@/lib/xray/packets";
import type { AppId, Detail, MachineState, NodeId, TermLine } from "@/lib/xray/types";
import { Narration } from "./Narration";
import { PacketPanel } from "./PacketPanel";
import { PlaybackBar } from "./PlaybackBar";
import { XRayMap } from "./XRayMap";
import styles from "./lab.module.css";
import { LAYER_HEX, LAYER_NAME } from "./palette";

type LayoutMode = "screen" | "split" | "machine";

const LEFT_BASIS: Record<LayoutMode, string> = {
  screen: "60%",
  split: "46%",
  machine: "30%",
};

/** Height kept under the screen on wide screens: the panels' minimum, the gap and the bezel. */
const PANELS_RESERVE: Record<LayoutMode, string> = {
  screen: "230px",
  split: "230px",
  machine: "382px",
};

const CACHE_LABELS: { key: keyof MachineState; label: string; hint: string }[] = [
  { key: "arpCached", label: "ARP", hint: "The router's MAC address is in the neighbour table" },
  { key: "dnsCached", label: "DNS", hint: "The router and resolver cache www.example.com" },
  { key: "connectionOpen", label: "TLS conn", hint: "Chromium keeps an HTTPS connection open" },
  { key: "fileCached", label: "Page cache", hint: "notes.txt is in RAM" },
];

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5 rounded-md border border-lab-line bg-lab-panel2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-2.5 py-1 text-[12px] transition ${
            value === o.value ? "bg-white/10 text-lab-ink" : "text-lab-muted hover:text-lab-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function terminalReply(command: string): TermLine[] {
  const [name = "", ...args] = command.split(" ");
  const echo: TermLine = { kind: "prompt", text: command };
  switch (name) {
    case "":
      return [echo];
    case "help":
      return [
        echo,
        { kind: "output", text: "Traced: cat notes.txt   read a file through VFS, the page cache and the SSD" },
        { kind: "output", text: "Also:   ls · clear · help" },
        { kind: "hint", text: "Searches in Chromium trace the network path." },
      ];
    case "ls":
      return [echo, { kind: "output", text: "notes.txt" }];
    case "cat":
      return [echo, { kind: "output", text: `cat: ${args.join(" ") || "-"}: No such file or directory` }];
    default:
      return [
        echo,
        { kind: "output", text: `bash: ${name}: command not found` },
        { kind: "hint", text: "Only cat notes.txt is traced so far. Type help." },
      ];
  }
}

export function DesktopLab() {
  const reduced = useReducedMotion() ?? false;
  const [state, dispatch] = useReducer(playerReducer, INITIAL_PLAYER);
  const [layoutOverride, setLayoutOverride] = useState<LayoutMode | null>(null);
  const [selected, setSelected] = useState<NodeId | null>(null);
  const [reach, setReach] = useState<{ key: string; index: number }>({ key: "", index: 0 });

  const run = state.run;
  const scenario = run?.scenario ?? null;
  const steps = useMemo(
    () => (scenario ? visibleSteps(scenario, state.detail) : []),
    [scenario, state.detail],
  );
  const step = run ? (steps[run.index] ?? null) : null;
  const status = run?.status ?? null;
  const stepKey = run && step ? `${run.seq}:${run.replay}:${step.id}` : "idle";
  const reached = reach.key === stepKey ? reach.index : 0;
  const apps = currentApps(state);
  const machine = machineAt(state);
  const scenarioNodes = useMemo(
    () => (scenario ? new Set(scenario.steps.flatMap((s) => s.path)) : null),
    [scenario],
  );

  const autoLayout: LayoutMode = !run ? "screen" : status === "done" ? "split" : run.scenario.focus;
  const layout = layoutOverride ?? autoLayout;

  // Advance to the next step when this one has had its travel and reading time.
  useEffect(() => {
    if (!step || status !== "playing") return;
    const timer = setTimeout(() => dispatch({ type: "tick" }), stepMs(step, state.speed));
    return () => clearTimeout(timer);
  }, [step, stepKey, status, state.speed]);

  // Keyboard: space plays or pauses, arrows step, unless you are typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.key === " " && !(target instanceof HTMLButtonElement)) {
        e.preventDefault();
        dispatch({ type: "toggle" });
      } else if (e.key === "ArrowRight") {
        dispatch({ type: "next" });
      } else if (e.key === "ArrowLeft") {
        dispatch({ type: "prev" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleReach = useCallback((key: string, index: number) => {
    setReach({ key, index });
  }, []);

  function start(action: PlayerAction) {
    setLayoutOverride(null);
    setSelected(null);
    dispatch(action);
  }

  function handleCommand(raw: string) {
    const command = raw.trim().replace(/\s+/g, " ");
    if (command === "cat notes.txt") {
      start({ type: "start", request: { kind: "readFile" } });
    } else if (command === "clear") {
      dispatch({ type: "terminal", clear: true });
    } else {
      dispatch({ type: "terminal", append: terminalReply(command) });
    }
  }

  const tracing: AppId | null = run && status !== "done" ? run.scenario.app : null;
  const { current: packet, previous: previousPacket } = framesAround(step?.frames, reached);
  const nextStep = run ? (steps[run.index + 1] ?? null) : null;
  const panelClass = `min-h-[200px] overflow-hidden rounded-xl border border-lab-line bg-lab-panel ${
    layout === "machine" ? "xl:min-h-0" : ""
  }`;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-dvh flex-col bg-lab-bg text-lab-ink xl:h-[max(100dvh,640px)]">
        <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-lab-line px-4 py-2.5">
          <Link href="/" className="text-[20px] font-bold tracking-tight">
            yan<span className="text-signal">i</span>x
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-lab-muted">Desktop lab</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="hidden xl:block">
              <Segmented
                label="Layout"
                value={layout}
                onChange={setLayoutOverride}
                options={[
                  { value: "screen", label: "Screen" },
                  { value: "split", label: "Split" },
                  { value: "machine", label: "Machine" },
                ]}
              />
            </div>
            <Segmented<Detail>
              label="Detail"
              value={state.detail}
              onChange={(detail) => dispatch({ type: "detail", detail })}
              options={[
                { value: "overview", label: "Overview" },
                { value: "deep", label: "Deep dive" },
              ]}
            />
            <div className="flex items-center gap-1.5 rounded-md border border-lab-line bg-lab-panel2 px-2 py-1">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-lab-muted">Caches</span>
              {CACHE_LABELS.map((c) => (
                <span
                  key={c.key}
                  title={c.hint}
                  className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] ${
                    machine[c.key]
                      ? "bg-[#7ee0a1]/15 text-[#7ee0a1]"
                      : "bg-white/5 text-lab-muted"
                  }`}
                >
                  {c.label} {machine[c.key] ? "warm" : "cold"}
                </span>
              ))}
              <button
                type="button"
                onClick={() => dispatch({ type: "clearCaches" })}
                className="ml-1 rounded px-1.5 py-0.5 text-[11px] text-lab-ink/80 hover:bg-white/10"
              >
                Clear
              </button>
            </div>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col gap-3 p-3 xl:flex-row">
          <div
            className={`flex min-h-0 min-w-0 flex-col gap-3 transition-[flex-basis] duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] xl:shrink-0 xl:basis-(--left) ${styles.column}`}
            style={
              { "--left": LEFT_BASIS[layout], "--reserve": PANELS_RESERVE[layout] } as React.CSSProperties
            }
          >
            <div
              className={`rounded-xl border border-lab-line bg-[#05070a] p-2 shadow-[0_10px_40px_rgba(0,0,0,0.5)] ${styles.bezel}`}
            >
              <VirtualScreen>
                <Desktop
                  apps={apps}
                  tracing={tracing}
                  onLaunch={(app) => start({ type: "start", request: { kind: "launch", app } })}
                  onClose={(app) => dispatch({ type: "closeApp", app })}
                  onSearch={(query) => start({ type: "start", request: { kind: "search", query } })}
                  onCommand={handleCommand}
                />
              </VirtualScreen>
            </div>
            <div
              className={`grid min-h-0 flex-1 gap-3 ${
                layout === "machine"
                  ? "xl:grid-cols-1 xl:grid-rows-[minmax(170px,1.3fr)_minmax(170px,1fr)]"
                  : "md:grid-cols-2"
              }`}
            >
              <div className={panelClass}>
                <Narration
                  step={step}
                  next={nextStep}
                  position={run ? { index: run.index, total: steps.length } : null}
                  scenarioTitle={run?.scenario.title ?? null}
                  selected={selected}
                  onCloseInspector={() => setSelected(null)}
                />
              </div>
              <div className={panelClass}>
                <PacketPanel packet={packet} previous={previousPacket} />
              </div>
            </div>
          </div>

          <div className="relative min-h-[460px] min-w-0 flex-1 overflow-hidden rounded-xl border border-lab-line bg-lab-panel">
            <div className="pointer-events-none absolute inset-x-3 top-2 z-10 flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-lab-muted">
                Inside the machine
              </span>
              <span className="hidden flex-wrap items-center gap-3 text-[11px] text-lab-muted sm:flex">
                {(["user", "kernel", "hardware", "network"] as const).map((layer) => (
                  <span key={layer} className="flex items-center gap-1.5">
                    <span className="size-2 rounded-sm" style={{ background: LAYER_HEX[layer] }} />
                    {LAYER_NAME[layer]}
                  </span>
                ))}
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-4 rounded bg-signal shadow-[0_0_6px_var(--color-signal)]" />
                  Signal
                </span>
              </span>
            </div>
            <div className="h-full overflow-x-auto xl:overflow-hidden">
              <div className="h-full min-w-[680px] p-2 pt-7 xl:min-w-0">
                <XRayMap
                  step={step}
                  stepKey={stepKey}
                  reached={reached}
                  playing={status === "playing"}
                  speed={state.speed}
                  reduced={reduced}
                  selected={selected}
                  scenarioNodes={scenarioNodes}
                  onSelect={setSelected}
                  onReach={handleReach}
                />
              </div>
            </div>
          </div>
        </main>

        <footer className="border-t border-lab-line px-4 py-3">
          <PlaybackBar
            steps={steps}
            index={run?.index ?? 0}
            status={status}
            speed={state.speed}
            onAction={(type) => dispatch({ type })}
            onSeek={(index) => dispatch({ type: "seek", index })}
            onSpeed={(speed) => dispatch({ type: "speed", speed })}
          />
        </footer>
      </div>
    </MotionConfig>
  );
}
