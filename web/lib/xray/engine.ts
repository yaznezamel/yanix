import {
  COLD_MACHINE,
  INITIAL_APPS,
  applyTrigger,
  buildScenario,
  machineAfter,
} from "./scenarios";
import type {
  AppId,
  AppState,
  Detail,
  MachineState,
  Scenario,
  ScenarioRequest,
  Step,
  TermLine,
  UiEffect,
} from "./types";

// The playback engine is a pure reducer: every button, timer tick and app
// action is an action, and the screen is derived from (scenario, step index).
// Scrubbing backwards therefore rewinds the apps too.

export type Speed = 0.5 | 1 | 2;
export type RunStatus = "playing" | "paused" | "done";

export interface Run {
  /** Increments on every start, so animations re-key per run. */
  seq: number;
  /** Increments on restart, so the first step re-animates. */
  replay: number;
  scenario: Scenario;
  /** Index into the steps visible at the current detail level. */
  index: number;
  status: RunStatus;
  /** App state right after the user's action, before any step's effect. */
  base: AppState;
  /** What the machine knew when the run started. */
  before: MachineState;
}

export interface PlayerState {
  machine: MachineState;
  /** Committed app state; while a run is active the run's base is newer. */
  apps: AppState;
  run: Run | null;
  detail: Detail;
  speed: Speed;
  seq: number;
}

export const INITIAL_PLAYER: PlayerState = {
  machine: COLD_MACHINE,
  apps: INITIAL_APPS,
  run: null,
  detail: "overview",
  speed: 1,
  seq: 0,
};

export type PlayerAction =
  | { type: "start"; request: ScenarioRequest }
  | { type: "play" }
  | { type: "pause" }
  | { type: "toggle" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "seek"; index: number }
  | { type: "tick" }
  | { type: "finish" }
  | { type: "restart" }
  | { type: "detail"; detail: Detail }
  | { type: "speed"; speed: Speed }
  | { type: "clearCaches" }
  | { type: "closeApp"; app: AppId }
  | { type: "terminal"; append?: TermLine[]; clear?: boolean }
  | { type: "dismiss" };

export function visibleSteps(scenario: Scenario, detail: Detail): Step[] {
  return scenario.steps.filter((s) => s.mode === undefined || s.mode === detail);
}

export function applyEffect(apps: AppState, ui: UiEffect | undefined): AppState {
  if (!ui) return apps;
  let next = apps;
  if (ui.browser) next = { ...next, browser: { ...next.browser, ...ui.browser } };
  if (ui.terminalAppend || ui.terminalBusy !== undefined) {
    next = {
      ...next,
      terminal: {
        lines: ui.terminalAppend
          ? [...next.terminal.lines, ...ui.terminalAppend]
          : next.terminal.lines,
        busy: ui.terminalBusy ?? next.terminal.busy,
      },
    };
  }
  return next;
}

function applyUpTo(run: Run, fullIndex: number): AppState {
  let apps = run.base;
  for (let i = 0; i <= fullIndex && i < run.scenario.steps.length; i++) {
    apps = applyEffect(apps, run.scenario.steps[i]?.ui);
  }
  return apps;
}

/** Apps as they look at the current step (hidden deep steps still count). */
export function appsAt(run: Run, detail: Detail): AppState {
  const current = visibleSteps(run.scenario, detail)[run.index];
  if (!current) return run.base;
  return applyUpTo(run, run.scenario.steps.indexOf(current));
}

export function finalApps(run: Run): AppState {
  return applyUpTo(run, run.scenario.steps.length - 1);
}

export function currentApps(state: PlayerState): AppState {
  return state.run ? appsAt(state.run, state.detail) : state.apps;
}

/**
 * What the machine knows at the current step: caches warm up at the step that
 * fills them. The reducer already stores the end state for the next run.
 */
export function machineAt(state: PlayerState): MachineState {
  const run = state.run;
  if (!run || run.status === "done") return state.machine;
  const current = visibleSteps(run.scenario, state.detail)[run.index];
  const position = current ? run.scenario.steps.indexOf(current) : -1;
  let machine = run.before;
  for (let i = 0; i <= position; i++) {
    const learns = run.scenario.steps[i]?.learns;
    if (learns) machine = { ...machine, ...learns };
  }
  return machine;
}

export function currentStep(state: PlayerState): Step | null {
  if (!state.run) return null;
  return visibleSteps(state.run.scenario, state.detail)[state.run.index] ?? null;
}

function committed(state: PlayerState): AppState {
  return state.run ? finalApps(state.run) : state.apps;
}

function lastIndex(state: PlayerState): number {
  return state.run ? visibleSteps(state.run.scenario, state.detail).length - 1 : 0;
}

export function remapIndex(
  scenario: Scenario,
  from: Detail,
  to: Detail,
  index: number,
): number {
  const current = visibleSteps(scenario, from)[index];
  if (!current) return 0;
  const position = scenario.steps.indexOf(current);
  let best = 0;
  visibleSteps(scenario, to).forEach((step, i) => {
    if (scenario.steps.indexOf(step) <= position) best = i;
  });
  return best;
}

function withRun(state: PlayerState, patch: Partial<Run>): PlayerState {
  return state.run ? { ...state, run: { ...state.run, ...patch } } : state;
}

/** Apply a change to the app state the user is looking at right now. */
function mutateApps(state: PlayerState, fn: (apps: AppState) => AppState): PlayerState {
  if (state.run) return { ...state, run: { ...state.run, base: fn(state.run.base) } };
  return { ...state, apps: fn(state.apps) };
}

function resetApp(apps: AppState, app: AppId): AppState {
  return { ...apps, [app]: INITIAL_APPS[app] };
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  const run = state.run;
  switch (action.type) {
    case "start": {
      const apps = committed(state);
      const scenario = buildScenario(action.request, state.machine);
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        apps,
        machine: machineAfter(action.request, state.machine),
        run: {
          seq,
          replay: 0,
          scenario,
          index: 0,
          status: "playing",
          base: applyTrigger(action.request, apps),
          before: state.machine,
        },
      };
    }
    case "play":
      if (!run) return state;
      if (run.status === "done") {
        return withRun(state, { index: 0, replay: run.replay + 1, status: "playing" });
      }
      return withRun(state, { status: "playing" });
    case "pause":
      return run && run.status === "playing" ? withRun(state, { status: "paused" }) : state;
    case "toggle":
      if (!run) return state;
      return playerReducer(state, { type: run.status === "playing" ? "pause" : "play" });
    case "next": {
      if (!run) return state;
      const last = lastIndex(state);
      if (run.index >= last) return withRun(state, { status: "done" });
      return withRun(state, { index: run.index + 1 });
    }
    case "prev":
      if (!run) return state;
      return withRun(state, {
        index: Math.max(0, run.index - 1),
        status: run.status === "done" ? "paused" : run.status,
      });
    case "seek": {
      if (!run) return state;
      const index = Math.min(lastIndex(state), Math.max(0, action.index));
      return withRun(state, {
        index,
        status: run.status === "done" && index < lastIndex(state) ? "paused" : run.status,
      });
    }
    case "tick": {
      if (!run || run.status !== "playing") return state;
      const last = lastIndex(state);
      if (run.index >= last) return withRun(state, { status: "done" });
      return withRun(state, { index: run.index + 1 });
    }
    case "finish":
      return run ? withRun(state, { index: lastIndex(state), status: "done" }) : state;
    case "restart":
      return run ? withRun(state, { index: 0, replay: run.replay + 1, status: "playing" }) : state;
    case "detail": {
      if (action.detail === state.detail) return state;
      if (!run) return { ...state, detail: action.detail };
      return {
        ...state,
        detail: action.detail,
        run: { ...run, index: remapIndex(run.scenario, state.detail, action.detail, run.index) },
      };
    }
    case "speed":
      return { ...state, speed: action.speed };
    case "clearCaches":
      return {
        ...state,
        machine: COLD_MACHINE,
        run: run ? { ...run, before: COLD_MACHINE } : null,
      };
    case "closeApp": {
      const machine =
        action.app === "browser" ? { ...state.machine, connectionOpen: false } : state.machine;
      if (run && run.scenario.app === action.app) {
        return { ...state, machine, run: null, apps: resetApp(committed(state), action.app) };
      }
      const next = mutateApps({ ...state, machine }, (apps) => resetApp(apps, action.app));
      return next.run && action.app === "browser"
        ? { ...next, run: { ...next.run, before: { ...next.run.before, connectionOpen: false } } }
        : next;
    }
    case "terminal":
      return mutateApps(state, (apps) => ({
        ...apps,
        terminal: {
          ...apps.terminal,
          lines: [...(action.clear ? [] : apps.terminal.lines), ...(action.append ?? [])],
        },
      }));
    case "dismiss":
      return run ? { ...state, apps: committed(state), run: null } : state;
  }
}

// Timing. Travel time grows with the number of hops; reading time with the
// length of the text. Both scale with the chosen speed.

export function travelMs(step: Step, speed: Speed): number {
  const hops = step.path.length - 1;
  if (hops <= 0) return 0;
  return Math.min(3000, 240 + hops * 300) / speed;
}

export function readMs(step: Step, speed: Speed): number {
  const words = `${step.title} ${step.body}`.split(/\s+/).length;
  return Math.min(5200, Math.max(1600, 700 + words * 48)) / speed;
}

export function stepMs(step: Step, speed: Speed): number {
  return travelMs(step, speed) + readMs(step, speed);
}
