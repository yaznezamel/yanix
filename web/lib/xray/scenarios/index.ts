import { NOTES_FILE } from "../apps";
import { searchUrl } from "../packets";
import type { AppState, MachineState, Program, Scenario, ScenarioRequest } from "../types";
import { copy, paste } from "./clipboard";
import { openFile, readFile } from "./files";
import { keystroke } from "./keyboard";
import { coresInput, runCores } from "./cores";
import { launch } from "./launch";
import { marksInput, runMarks } from "./marks";
import { play } from "./media";
import { boot, login, restart, shutdown } from "./power";
import { webSearch } from "./web";

// Every scenario is a list of steps built from the machine's current state:
// what is cached decides which steps happen at all. Texts stay short; the
// node inspector carries the longer explanations.

export { APP_NODE } from "./launch";

/** `apps` is what is on screen when the request is made: the program's next trace starts from its state. */
export function buildScenario(request: ScenarioRequest, machine: MachineState, apps: AppState): Scenario {
  switch (request.kind) {
    case "launch":
      return launch(request.app, machine);
    case "search":
      return webSearch(request.query, machine);
    case "readFile":
      return readFile(machine);
    case "openFile":
      return openFile(machine);
    case "keystroke":
      return keystroke(request.app, request.key);
    case "copy":
      return copy(request.app, request.text);
    case "paste":
      return paste(request.app, request.source, request.text);
    case "play":
      return play(request.media, machine);
    case "boot":
      return boot();
    case "login":
      return login();
    case "shutdown":
      return shutdown();
    case "restart":
      return restart();
    case "runProgram":
      return request.program === "cores" ? runCores(apps) : runMarks(apps);
    case "programInput":
      return programInput(apps, request.text);
  }
}

/** Is the C program in the terminal blocked in fgets(), waiting for a line? */
export function programReads(program: Program | null): boolean {
  if (!program) return false;
  return program.kind === "marks"
    ? program.stage === "name" || program.stage === "marks" || program.stage === "again"
    : program.stage === "threads";
}

/** A line typed into the terminal while a C program reads it. */
function programInput(apps: AppState, text: string): Scenario {
  const program = apps.program;
  if (program && programReads(program)) {
    return program.kind === "marks" ? marksInput(program, text) : coresInput(program, text);
  }
  return {
    kind: "programInput",
    app: "terminal",
    title: "Nothing is reading",
    focus: "split",
    steps: [
      {
        id: "nobody",
        phase: "input",
        path: ["terminal", "syscall", "tty"],
        title: "Nothing is reading",
        body: "No program is waiting for this line, so it waits in the TTY's buffer.",
        ui: { terminalBusy: false },
      },
    ],
  };
}

/** What the machine remembers once the scenario has run: everything its steps learned. */
export function machineAfter(scenario: Scenario, machine: MachineState): MachineState {
  return scenario.steps.reduce<MachineState>(
    (known, step) => (step.learns ? { ...known, ...step.learns } : known),
    machine,
  );
}

/** What changes on screen the moment the user acts, before any step plays. */
export function applyTrigger(request: ScenarioRequest, apps: AppState): AppState {
  switch (request.kind) {
    case "search": {
      const query = request.query.trim();
      return {
        ...apps,
        browser: {
          ...apps.browser,
          draft: query,
          query,
          url: searchUrl(query),
          loading: true,
          status: null,
          progress: 0.02,
        },
      };
    }
    case "readFile":
      return {
        ...apps,
        terminal: {
          lines: [...apps.terminal.lines, { kind: "prompt", text: "cat notes.txt" }],
          busy: true,
        },
      };
    case "openFile":
      return { ...apps, editor: { file: NOTES_FILE, text: "", loading: true } };
    case "runProgram":
      return {
        ...apps,
        terminal: { lines: [...apps.terminal.lines, { kind: "prompt", text: `./${request.program}` }], busy: true },
      };
    case "programInput": {
      // The TTY echoes what you type as you type it: it is on screen before the program reads it.
      const lines = [...apps.terminal.lines];
      const last = lines.length - 1;
      const ask = lines[last];
      if (ask?.kind === "ask" && ask.answer === undefined) lines[last] = { ...ask, answer: request.text };
      else lines.push({ kind: "output", text: request.text });
      return { ...apps, terminal: { lines, busy: true } };
    }
    case "launch":
      return { ...apps, windows: { ...apps.windows, [request.app]: "starting" } };
    case "play":
      return { ...apps, player: { media: request.media, playing: false, status: "Starting…" } };
    case "keystroke":
    case "copy":
    case "paste":
    case "boot":
    case "login":
    case "shutdown":
    case "restart":
      return apps;
  }
}
