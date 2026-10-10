import { NOTES_FILE } from "../apps";
import { searchUrl } from "../packets";
import type { AppState, MachineState, Scenario, ScenarioRequest } from "../types";
import { copy, paste } from "./clipboard";
import { openFile, readFile } from "./files";
import { keystroke } from "./keyboard";
import { launch } from "./launch";
import { play } from "./media";
import { boot, login, restart, shutdown } from "./power";
import { webSearch } from "./web";

// Every scenario is a list of steps built from the machine's current state:
// what is cached decides which steps happen at all. Texts stay short; the
// node inspector carries the longer explanations.

export { APP_NODE } from "./launch";

export function buildScenario(request: ScenarioRequest, machine: MachineState): Scenario {
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
  }
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
