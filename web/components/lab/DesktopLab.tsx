"use client";

import { MotionConfig, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Desktop } from "@/components/desktop/Desktop";
import { finePointer } from "@/components/desktop/TerminalApp";
import { VirtualScreen } from "@/components/desktop/VirtualScreen";
import { HardwareView, type HardwareHandle } from "@/components/hardware/HardwareView";
import {
  INITIAL_PLAYER,
  committedApps,
  currentApps,
  fieldLocked,
  machineAt,
  playerReducer,
  visibleSteps,
  type PlayerAction,
} from "@/lib/xray/engine";
import { buildPath } from "@/lib/xray/geometry";
import { programReads } from "@/lib/xray/scenarios";
import { framesAround } from "@/lib/xray/packets";
import type { AppId, Detail, MachineState, NodeId, ScenarioRequest } from "@/lib/xray/types";
import { Narration } from "./Narration";
import { PacketPanel } from "./PacketPanel";
import { PlaybackBar } from "./PlaybackBar";
import { QuickActions } from "./QuickActions";
import { XRayMap } from "./XRayMap";
import styles from "./lab.module.css";
import { MemoryView } from "./MemoryView";
import { LAYER_HEX, LAYER_NAME } from "./palette";
import { usePlayhead } from "./usePlayhead";

type LayoutMode = "screen" | "split" | "machine";

/** The ways to look inside: the software path a trace takes, the hardware it runs on, a program's memory. */
type MachineTab = "software" | "hardware" | "memory";

const MACHINE_TABS: { value: MachineTab; label: string }[] = [
  { value: "software", label: "Software path" },
  { value: "hardware", label: "Hardware" },
  { value: "memory", label: "Memory" },
];

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

/** More height under the screen while a C program runs: its answer bar (84px) and a gap. */
const ANSWER_BAR = "96px";

function cacheChips(m: MachineState): { label: string; state: string; warm: boolean; hint: string }[] {
  const files = m.pageCache.length;
  return [
    { label: "ARP", warm: m.arpCached, state: m.arpCached ? "warm" : "cold", hint: "The router's MAC address is in the neighbour table" },
    { label: "DNS", warm: m.dnsCached, state: m.dnsCached ? "warm" : "cold", hint: "The router and resolver cache www.example.com" },
    {
      label: "TLS conn",
      warm: m.connectionOpen,
      state: m.connectionOpen ? "open" : "closed",
      hint: "Chromium keeps an HTTPS connection open",
    },
    {
      label: "Page cache",
      warm: files > 0,
      state: files === 0 ? "cold" : files === 1 ? "1 file" : `${files} files`,
      hint: files === 0 ? "No file or program of yours is in RAM yet" : `In RAM: ${m.pageCache.join(", ")}`,
    },
  ];
}

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

export function DesktopLab() {
  const reduced = useReducedMotion() ?? false;
  const [state, dispatch] = useReducer(playerReducer, INITIAL_PLAYER);
  const [layoutOverride, setLayoutOverride] = useState<LayoutMode | null>(null);
  const [selected, setSelected] = useState<NodeId | null>(null);
  const [tab, setTab] = useState<MachineTab>("software");
  const resumeAfterScrub = useRef(false);
  const hardware = useRef<HardwareHandle>(null);
  /** The first run of a C program opens the Memory tab; after that the tab is yours to choose. */
  const [shownMemory, setShownMemory] = useState(false);
  const [seenRun, setSeenRun] = useState(0);

  const run = state.run;
  const scenario = run?.scenario ?? null;
  // A new trace: if it is the first C program to run, show its memory. (A line that waited in the TTY can start one too.)
  if (run && run.seq !== seenRun) {
    setSeenRun(run.seq);
    if (run.scenario.kind === "runProgram" && !shownMemory) {
      setShownMemory(true);
      setTab("memory");
    }
  }
  const steps = useMemo(
    () => (scenario ? visibleSteps(scenario, state.detail) : []),
    [scenario, state.detail],
  );
  const step = run ? (steps[run.index] ?? null) : null;
  const status = run?.status ?? null;
  const stepKey = run && step ? `${run.seq}:${run.replay}:${step.id}` : "idle";
  const geometry = useMemo(() => (step ? buildPath(step.path) : null), [step]);
  const playhead = usePlayhead({
    step,
    stepKey,
    index: run?.index ?? 0,
    status,
    speed: state.speed,
    reduced,
    nodeAt: geometry?.nodeAt ?? null,
    dispatch,
  });
  const reached = playhead.reached;
  const apps = currentApps(state);
  const machine = machineAt(state);
  const scenarioNodes = useMemo(
    () => (scenario ? new Set(scenario.steps.flatMap((s) => s.path)) : null),
    [scenario],
  );

  const autoLayout: LayoutMode = !run ? "screen" : status === "done" ? "split" : run.scenario.focus;
  const layout = layoutOverride ?? autoLayout;

  // Keyboard: space plays or pauses, arrows step, unless you are typing or a
  // control already used the key (the hardware view pans with the arrows).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
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

  function start(action: PlayerAction) {
    setSelected(null);
    // Like a page load, a new trace takes focus off the button that started
    // it, so Space then pauses the trace instead of pressing the button again.
    if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    dispatch(action);
  }

  /** A line from the terminal or the answer bar: the engine decides who reads it, and when (lib/xray/shell.ts). */
  function handleCommand(raw: string) {
    start({ type: "command", text: raw });
  }

  function request(req: ScenarioRequest) {
    start({ type: "start", request: req });
  }

  /** To the end of the trace, where the program asks; the answer box takes the keyboard. */
  function skipToQuestion() {
    dispatch({ type: "finish" });
    requestAnimationFrame(() => {
      if (finePointer()) document.getElementById("program-answer")?.focus({ preventScroll: true });
    });
  }

  /** After a "Try it" button on a phone, bring the story into view (the panel above it shrinks). */
  function showStory() {
    requestAnimationFrame(() =>
      document
        .getElementById("lab-story")
        ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }),
    );
  }

  /** From a box's details: switch to the hardware view and fly to the parts it stands for. */
  function showInHardware(id: NodeId) {
    setTab("hardware");
    // The hardware panel is inert until the switch renders.
    requestAnimationFrame(() => {
      hardware.current?.show(id);
      hardware.current?.focus();
    });
  }

  /**
   * Opening a box's details pauses the trace, so the story does not run on
   * unseen. On a phone the details are above the map: bring them into view.
   */
  function handleSelect(id: NodeId) {
    setSelected(id);
    if (status === "playing") dispatch({ type: "pause" });
    requestAnimationFrame(() =>
      document
        .getElementById("lab-story")
        ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" }),
    );
  }

  /** Dragging the timeline pauses the trace, and lets it play on when you let go. */
  function handleScrub(scrubbing: boolean) {
    if (scrubbing) {
      resumeAfterScrub.current = status === "playing";
      if (resumeAfterScrub.current) dispatch({ type: "pause" });
    } else if (resumeAfterScrub.current) {
      resumeAfterScrub.current = false;
      dispatch({ type: "play" });
    }
  }

  /** The first key typed into a field is traced, unless another trace is still going. */
  function handleKeystroke(app: "browser" | "editor", key: string) {
    if (run && status !== "done") return;
    dispatch({ type: "start", request: { kind: "keystroke", app, key } });
  }

  function handlePaste(app: "browser" | "editor") {
    const clip = apps.clipboard;
    if (!clip) return;
    // Pasting into the app that owns the clipboard needs no round trip: it has the text.
    if (clip.owner === app) {
      if (app === "browser") dispatch({ type: "draft", text: apps.browser.draft + clip.text });
      else dispatch({ type: "editorText", text: apps.editor.text + clip.text });
      return;
    }
    request({ kind: "paste", app, source: clip.owner, text: clip.text });
  }

  const tracing: AppId | null = run && status !== "done" ? run.scenario.app : null;
  const active = run !== null && status !== "done";
  // The C program as it will be when this trace is over: still running, and maybe waiting for a line.
  const program = committedApps(state).program;
  const programRuns = program !== null && program.stage !== "exited" && apps.windows.terminal === "open";
  const toQuestion = active && programReads(program);
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
              <Segmented<LayoutMode | "auto">
                label="Layout"
                value={layoutOverride ?? "auto"}
                onChange={(value) => setLayoutOverride(value === "auto" ? null : value)}
                options={[
                  { value: "auto", label: "Auto" },
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
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-lab-line bg-lab-panel2 px-2 py-1">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-lab-muted">Caches</span>
              {cacheChips(machine).map((c) => (
                <span
                  key={c.label}
                  title={c.hint}
                  className={`whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10.5px] ${
                    c.warm ? "bg-[#7ee0a1]/15 text-[#7ee0a1]" : "bg-white/5 text-lab-muted"
                  }`}
                >
                  {c.label} {c.state}
                </span>
              ))}
              <button
                type="button"
                onClick={() => dispatch({ type: "clearCaches" })}
                aria-label="Clear caches"
                title="Forget what the machine has cached, so the next run starts cold"
                className="ml-1 min-h-6 rounded px-2 text-[11px] text-lab-ink/80 hover:bg-white/10"
              >
                Clear
              </button>
            </div>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col gap-3 p-3 xl:flex-row">
          <div
            className={`flex min-h-0 min-w-0 flex-col gap-3 transition-[flex-basis] duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none xl:shrink-0 xl:basis-(--left) ${styles.column}`}
            style={
              {
                "--left": LEFT_BASIS[layout],
                "--reserve": programRuns ? `calc(${PANELS_RESERVE[layout]} + ${ANSWER_BAR})` : PANELS_RESERVE[layout],
              } as React.CSSProperties
            }
          >
            <div
              className={`rounded-xl border border-lab-line bg-[#05070a] p-2 shadow-[0_10px_40px_rgba(0,0,0,0.5)] ${styles.bezel}`}
            >
              <VirtualScreen>
                <Desktop
                  apps={apps}
                  tracing={tracing}
                  typedAhead={state.typedAhead}
                  locked={{
                    draft: fieldLocked(state, "draft"),
                    editor: fieldLocked(state, "editor"),
                    player: fieldLocked(state, "player"),
                  }}
                  restarting={run?.scenario.kind === "restart"}
                  loggingIn={active && run?.scenario.kind === "login"}
                  onLaunch={(app) => request({ kind: "launch", app })}
                  onClose={(app) => dispatch({ type: "closeApp", app })}
                  onWelcome={(open) => dispatch({ type: "window", id: "welcome", status: open ? "open" : "closed" })}
                  onSearch={(query) => request({ kind: "search", query })}
                  onDraft={(text) => dispatch({ type: "draft", text })}
                  onCommand={handleCommand}
                  onOpenFile={() => request({ kind: "openFile" })}
                  onEditorText={(text) => dispatch({ type: "editorText", text })}
                  onKeystroke={handleKeystroke}
                  onCopy={(app, text) => request({ kind: "copy", app, text })}
                  onPaste={handlePaste}
                  onPlay={(media) => request({ kind: "play", media })}
                  onPause={() => dispatch({ type: "media", patch: { playing: false } })}
                  onPower={(kind) => request({ kind })}
                />
              </VirtualScreen>
            </div>
            <QuickActions
              apps={apps}
              program={programRuns ? program : null}
              typedAhead={state.typedAhead}
              toQuestion={toQuestion}
              playing={active ? (run?.scenario.title ?? null) : null}
              onRequest={request}
              onCommand={handleCommand}
              onFinish={skipToQuestion}
              onStarted={showStory}
            />
            <div
              className={`grid min-h-0 flex-1 gap-3 ${
                layout === "machine"
                  ? packet
                    ? "xl:grid-cols-1 xl:grid-rows-[minmax(170px,1.3fr)_minmax(170px,1fr)]"
                    : "xl:grid-cols-1 xl:grid-rows-[minmax(170px,1fr)_auto]"
                  : "md:grid-cols-2"
              }`}
            >
              <div id="lab-story" className={panelClass}>
                <Narration
                  step={step}
                  next={nextStep}
                  position={run ? { index: run.index, total: steps.length } : null}
                  scenarioTitle={run?.scenario.title ?? null}
                  selected={selected}
                  onCloseInspector={() => setSelected(null)}
                  onShowInHardware={showInHardware}
                />
              </div>
              <div className={panelClass}>
                <PacketPanel packet={packet} previous={previousPacket} />
              </div>
            </div>
          </div>

          <div className="flex min-h-[540px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-lab-line bg-lab-panel">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 pt-2 pb-1">
              <div
                role="tablist"
                aria-label="Look inside the machine"
                className="flex items-center gap-0.5 rounded-md border border-lab-line bg-lab-panel2 p-0.5"
                onKeyDown={(e) => {
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                  e.preventDefault();
                  const i = MACHINE_TABS.findIndex((t) => t.value === tab);
                  const step = e.key === "ArrowRight" ? 1 : MACHINE_TABS.length - 1;
                  const next = MACHINE_TABS[(i + step) % MACHINE_TABS.length]!.value;
                  setTab(next);
                  document.getElementById(`machine-tab-${next}`)?.focus();
                }}
              >
                {MACHINE_TABS.map((t) => (
                  <button
                    key={t.value}
                    id={`machine-tab-${t.value}`}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.value}
                    aria-controls={`machine-panel-${t.value}`}
                    tabIndex={tab === t.value ? 0 : -1}
                    onClick={() => setTab(t.value)}
                    className={`rounded px-2.5 py-1 text-[12px] transition ${
                      tab === t.value ? "bg-white/10 text-lab-ink" : "text-lab-muted hover:text-lab-ink"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {layout === "screen" && (
                <button
                  type="button"
                  onClick={() => setLayoutOverride("machine")}
                  title="Give the machine views more room (the Machine layout)"
                  className="hidden min-h-7 rounded-md border border-lab-line px-2 text-[12px] text-lab-ink/85 hover:border-white/25 xl:block"
                >
                  Bigger map ⤢
                </button>
              )}
              {/* Both legends hold the same cell, so switching tabs never resizes the view under them. */}
              <div className="grid">
                <span
                  aria-hidden={tab !== "software"}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-lab-muted [grid-area:1/1] ${tab === "software" ? "" : "invisible"}`}
                >
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
                <span
                  aria-hidden={tab !== "hardware"}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-lab-muted [grid-area:1/1] ${tab === "hardware" ? "" : "invisible"}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm border-2 border-signal shadow-[0_0_6px_var(--color-signal)]" />
                    Signal here
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm border border-signal/60 bg-signal/10" />
                    Used in this step
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm border border-white/15 bg-white/20 opacity-45" />
                    Not part of this step
                  </span>
                </span>
                <span
                  aria-hidden={tab !== "memory"}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-lab-muted [grid-area:1/1] ${tab === "memory" ? "" : "invisible"}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm bg-signal/25 ring-1 ring-signal/60" />
                    Changed in this step
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-lab-ink/80">?</span>
                    Not written yet
                  </span>
                </span>
              </div>
            </div>
            <div className="relative min-h-0 flex-1">
              <div
                id="machine-panel-software"
                role="tabpanel"
                aria-labelledby="machine-tab-software"
                inert={tab !== "software"}
                className={`absolute inset-0 overflow-x-auto xl:overflow-hidden ${tab === "software" ? "" : "invisible"}`}
              >
                <div className="h-full min-w-[680px] px-2 pb-2 xl:min-w-0">
                  <XRayMap
                    step={step}
                    stepKey={stepKey}
                    geometry={geometry}
                    progress={playhead.progress}
                    reached={reached}
                    selected={selected}
                    scenarioNodes={scenarioNodes}
                    onSelect={handleSelect}
                  />
                </div>
              </div>
              <div
                id="machine-panel-hardware"
                role="tabpanel"
                aria-labelledby="machine-tab-hardware"
                inert={tab !== "hardware"}
                className={`absolute inset-0 ${tab === "hardware" ? "" : "invisible"}`}
              >
                <HardwareView ref={hardware} step={step} reached={reached} reduced={reduced} />
              </div>
              <div
                id="machine-panel-memory"
                role="tabpanel"
                aria-labelledby="machine-tab-memory"
                inert={tab !== "memory"}
                className={`absolute inset-0 pt-1 ${tab === "memory" ? "" : "invisible"}`}
              >
                <MemoryView
                  program={apps.program}
                  terminalOpen={apps.windows.terminal === "open"}
                  onRun={(name) => handleCommand(`./${name}`)}
                  onOpenTerminal={() => request({ kind: "launch", app: "terminal" })}
                />
              </div>
            </div>
          </div>
        </main>

        <footer className="sticky bottom-0 z-20 border-t border-lab-line bg-lab-bg/95 px-4 py-3 backdrop-blur-sm xl:static">
          <PlaybackBar
            steps={steps}
            index={run?.index ?? 0}
            status={status}
            onSkipToQuestion={toQuestion ? skipToQuestion : null}
            speed={state.speed}
            fraction={playhead.fraction}
            onAction={(type) => dispatch({ type })}
            onSeek={playhead.seek}
            onScrub={handleScrub}
            onSpeed={(speed) => dispatch({ type: "speed", speed })}
          />
        </footer>
      </div>
    </MotionConfig>
  );
}
