import { CLOSED_WINDOWS, COLD_MACHINE, FRESH_APPS, INITIAL_APPS } from "./apps";
import { applyTrigger, buildScenario, machineAfter } from "./scenarios";
import { EOT, command } from "./shell";
import type {
  AppId,
  AppState,
  Detail,
  MachineState,
  MediaState,
  Scenario,
  ScenarioRequest,
  Step,
  TermLine,
  UiEffect,
  WindowId,
  WindowStatus,
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
  /**
   * Lines typed into the terminal while its trace plays. Like typed-ahead
   * input in a real TTY they wait, and are read one at a time once the trace
   * is over: by the program if it waits for a line, else by bash.
   */
  typedAhead: string[];
}

export const INITIAL_PLAYER: PlayerState = {
  machine: COLD_MACHINE,
  apps: INITIAL_APPS,
  run: null,
  detail: "overview",
  speed: 1,
  seq: 0,
  typedAhead: [],
};

export type PlayerAction =
  | { type: "start"; request: ScenarioRequest }
  | { type: "play" }
  | { type: "pause" }
  | { type: "toggle" }
  | { type: "next" }
  | { type: "prev" }
  /** `partial`: the seek lands part way through the step, so a finished run is open again. */
  | { type: "seek"; index: number; partial?: boolean }
  | { type: "tick" }
  | { type: "finish" }
  | { type: "restart" }
  | { type: "detail"; detail: Detail }
  | { type: "speed"; speed: Speed }
  | { type: "clearCaches" }
  | { type: "closeApp"; app: AppId }
  | { type: "window"; id: WindowId; status: WindowStatus }
  | { type: "terminal"; append?: TermLine[]; clear?: boolean }
  /** A line typed into the terminal and sent with Enter. */
  | { type: "command"; text: string }
  /** Ctrl+C or Ctrl+D typed into the terminal. */
  | { type: "control"; key: "c" | "d" }
  | { type: "draft"; text: string }
  | { type: "editorText"; text: string }
  | { type: "media"; patch: Partial<MediaState> }
  | { type: "dismiss" };

export function visibleSteps(scenario: Scenario, detail: Detail): Step[] {
  return scenario.steps.filter((s) => s.mode === undefined || s.mode === detail);
}

export function applyEffect(apps: AppState, ui: UiEffect | undefined): AppState {
  if (!ui) return apps;
  let next = apps;
  if (ui.closeAll) next = { ...next, ...FRESH_APPS, windows: CLOSED_WINDOWS, clipboard: null };
  if (ui.screen) next = { ...next, screen: ui.screen };
  if (ui.clearBootLog) next = { ...next, bootLog: [] };
  if (ui.bootLog) next = { ...next, bootLog: [...next.bootLog, ...ui.bootLog] };
  if (ui.windows) next = { ...next, windows: { ...next.windows, ...ui.windows } };
  if (ui.browser) next = { ...next, browser: { ...next.browser, ...ui.browser } };
  if (ui.draftInsert) {
    next = { ...next, browser: { ...next.browser, draft: next.browser.draft + ui.draftInsert } };
  }
  if (ui.editor) next = { ...next, editor: { ...next.editor, ...ui.editor } };
  if (ui.editorInsert) {
    next = { ...next, editor: { ...next.editor, text: next.editor.text + ui.editorInsert } };
  }
  if (ui.player) next = { ...next, player: { ...next.player, ...ui.player } };
  if (ui.clipboard !== undefined) next = { ...next, clipboard: ui.clipboard };
  if (ui.program !== undefined) next = { ...next, program: ui.program };
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

/** The apps as the next trace will start from them: the end of the current one. */
export function committedApps(state: PlayerState): AppState {
  return state.run ? finalApps(state.run) : state.apps;
}

const committed = committedApps;

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

/** App state the user can edit directly, which some traces also change. */
export type UserField = "draft" | "editor" | "player";

function touches(run: Run, field: UserField): boolean {
  return run.scenario.steps.some(({ ui }) => {
    if (!ui) return false;
    if (ui.closeAll) return true;
    switch (field) {
      case "draft":
        return ui.draftInsert !== undefined || ui.browser?.draft !== undefined;
      case "editor":
        return ui.editor !== undefined || ui.editorInsert !== undefined;
      case "player":
        return ui.player !== undefined;
    }
  });
}

/**
 * A field that the running trace will still change is read-only until the
 * trace ends; otherwise the step would overwrite (or repeat) what you typed.
 */
export function fieldLocked(state: PlayerState, field: UserField): boolean {
  const run = state.run;
  return run !== null && run.status !== "done" && touches(run, field);
}

/** Edit a user field: once a trace that touched it is over, commit that trace first. */
function editApps(state: PlayerState, field: UserField, fn: (apps: AppState) => AppState): PlayerState {
  const run = state.run;
  if (run && touches(run, field)) {
    if (run.status !== "done") return state;
    return { ...state, apps: fn(finalApps(run)), run: null };
  }
  return mutateApps(state, fn);
}

/**
 * The app quits: its window closes, its state resets, and any clipboard it
 * owned is gone. `program` is the C program as it was on screen then.
 */
function closeApp(apps: AppState, app: AppId, program = apps.program): AppState {
  const next: AppState = {
    ...apps,
    windows: { ...apps.windows, [app]: "closed" },
    clipboard: apps.clipboard?.owner === app ? null : apps.clipboard,
  };
  switch (app) {
    case "browser":
      return { ...next, browser: FRESH_APPS.browser };
    case "terminal": {
      // Closing the terminal hangs up its pseudo-terminal, and a program running in it ends:
      // the Memory tab keeps its last state and says why.
      const running = program !== null && program.stage !== "starting" && program.stage !== "exited";
      return {
        ...next,
        terminal: FRESH_APPS.terminal,
        program: running ? { ...program, stage: "exited", endedBy: "hangup", changed: [] } : null,
      };
    }
    case "editor":
      return { ...next, editor: FRESH_APPS.editor };
    case "player":
      return { ...next, player: FRESH_APPS.player };
  }
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  return settle(reduce(state, action));
}

/** A trace starts from these apps and this machine; the scenario's steps decide what it learns. */
function begin(state: PlayerState, request: ScenarioRequest, apps: AppState, machine: MachineState): PlayerState {
  const scenario = buildScenario(request, machine, apps);
  const seq = state.seq + 1;
  return {
    ...state,
    seq,
    apps,
    machine: machineAfter(scenario, machine),
    run: {
      seq,
      replay: 0,
      scenario,
      index: 0,
      status: "playing",
      base: applyTrigger(request, apps),
      before: machine,
    },
  };
}

/** bash prints at once, below what the last trace printed: that trace is over. */
function print(state: PlayerState, action: PlayerAction & { type: "terminal" }): PlayerState {
  const run = state.run;
  const settled = run && run.status === "done" ? { ...state, apps: committed(state), run: null } : state;
  return reduce(settled, action);
}

/**
 * Ctrl+C. The line discipline sends SIGINT at once, so a program's trace is
 * cut where the playhead is and the interrupt starts from there; the line
 * typed so far, and any waiting ones, are thrown away. At bash's prompt the
 * TTY echoes ^C and bash prints a new prompt.
 */
function interrupt(state: PlayerState): PlayerState {
  const run = state.run;
  const cut = run !== null && run.status !== "done" && run.scenario.app === "terminal";
  const apps = cut ? currentApps(state) : committed(state);
  const program = apps.program;
  const runs = program !== null && program.stage !== "starting" && program.stage !== "exited";
  if (!runs) return cut ? state : print(state, { type: "terminal", append: [{ kind: "prompt", text: "^C" }] });
  return begin({ ...state, typedAhead: [] }, { kind: "interrupt" }, apps, cut ? machineAt(state) : state.machine);
}

/** Once nothing plays, the next line that waited in the TTY is read. */
function settle(state: PlayerState): PlayerState {
  const [line, ...rest] = state.typedAhead;
  if (line === undefined || (state.run && state.run.status !== "done")) return state;
  return playerReducer({ ...state, typedAhead: rest }, { type: "command", text: line });
}

function reduce(state: PlayerState, action: PlayerAction): PlayerState {
  const run = state.run;
  switch (action.type) {
    case "start": {
      const apps = committed(state);
      // An app that is already starting or open isn't launched again.
      if (action.request.kind === "launch" && apps.windows[action.request.app] !== "closed") return state;
      return begin(state, action.request, apps, state.machine);
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
      const last = lastIndex(state);
      const index = Math.min(last, Math.max(0, action.index));
      const reopened = run.status === "done" && (index < last || action.partial === true);
      return withRun(state, { index, status: reopened ? "paused" : run.status });
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
      // Closing the terminal throws away what was typed into it.
      const typedAhead = action.app === "terminal" ? [] : state.typedAhead;
      if (run && run.scenario.app === action.app) {
        const apps = closeApp(committed(state), action.app, currentApps(state).program);
        return { ...state, machine, typedAhead, run: null, apps };
      }
      const next = mutateApps({ ...state, machine, typedAhead }, (apps) => closeApp(apps, action.app));
      return next.run && action.app === "browser"
        ? { ...next, run: { ...next.run, before: { ...next.run.before, connectionOpen: false } } }
        : next;
    }
    case "window":
      return mutateApps(state, (apps) => ({
        ...apps,
        windows: { ...apps.windows, [action.id]: action.status },
      }));
    case "draft":
      return editApps(state, "draft", (apps) => ({ ...apps, browser: { ...apps.browser, draft: action.text } }));
    case "editorText":
      return editApps(state, "editor", (apps) => ({ ...apps, editor: { ...apps.editor, text: action.text } }));
    case "media":
      return editApps(state, "player", (apps) => ({ ...apps, player: { ...apps.player, ...action.patch } }));
    case "command": {
      // Typed while the terminal's trace plays: the line waits in the TTY until the trace is over.
      if (run && run.status !== "done" && run.scenario.app === "terminal") {
        return { ...state, typedAhead: [...state.typedAhead, action.text] };
      }
      const effect = command(action.text, committed(state));
      if (effect.kind === "trace") return reduce(state, { type: "start", request: effect.request });
      return effect.kind === "clear"
        ? print(state, { type: "terminal", clear: true })
        : print(state, { type: "terminal", append: effect.lines });
    }
    case "control":
      // Ctrl+D is a byte like any other: it waits with typed-ahead lines. Ctrl+C acts at once.
      return action.key === "d" ? reduce(state, { type: "command", text: EOT }) : interrupt(state);
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

// Timing. Travel time grows with the number of hops, about two thirds of a
// second each, so every numbered stop on the map lights in turn; reading time
// grows with the length of the text, at about 240 words a minute (a careful
// pace for technical text), so a student can read each step before the next
// one. Both scale with the chosen speed.

const READ_MS_PER_WORD = 250;
const READ_BASE_MS = 1200;
const READ_MIN_MS = 3500;
const READ_MAX_MS = 22000;

export function travelMs(step: Step, speed: Speed): number {
  const hops = step.path.length - 1;
  if (hops <= 0) return 0;
  return Math.min(6000, 200 + hops * 650) / speed;
}

export function readMs(step: Step, speed: Speed): number {
  const words = `${step.title} ${step.body}`.split(/\s+/).length;
  return Math.min(READ_MAX_MS, Math.max(READ_MIN_MS, READ_BASE_MS + words * READ_MS_PER_WORD)) / speed;
}

export function stepMs(step: Step, speed: Speed): number {
  return travelMs(step, speed) + readMs(step, speed);
}
