"use client";

import { inputLimit, programAnswers } from "@/components/desktop/TerminalApp";
import { SUGGESTED_QUERIES } from "@/lib/xray/apps";
import { programReads } from "@/lib/xray/scenarios";
import type { AppId, AppState, ScenarioRequest } from "@/lib/xray/types";

// On a phone the simulated screen is too small to tap, so the same actions are
// offered as full-size buttons under it. Each one starts the trace the desktop
// would: open an app first, then do the thing it is for. While a trace plays
// the panel shrinks to one line, so the story right below it stays in view.

interface QuickActionsProps {
  apps: AppState;
  /** The trace that is playing, if any: the panel shrinks to one line meanwhile. */
  playing: string | null;
  onRequest: (request: ScenarioRequest) => void;
  onCommand: (command: string) => void;
  onFinish: () => void;
  /** Called after an action starts a trace, to bring its story into view. */
  onStarted: () => void;
}

interface Action {
  label: string;
  detail: string;
  run: () => void;
  disabled?: boolean;
}

const APP_NAME: Record<AppId, string> = {
  browser: "Chromium",
  terminal: "the Terminal",
  editor: "the Text Editor",
  player: "Videos",
};

function actionsFor(apps: AppState, onRequest: (r: ScenarioRequest) => void, onCommand: (c: string) => void): Action[] {
  const open = (app: AppId) => apps.windows[app] === "open";
  const launch = (app: AppId): Action => ({
    label: `Open ${APP_NAME[app]}`,
    detail: "Launch it: a new process, the program loaded, its window drawn",
    run: () => onRequest({ kind: "launch", app }),
    disabled: apps.windows[app] === "starting",
  });

  if (apps.screen === "off") {
    return [{ label: "Press the power button", detail: "Firmware, bootloader, kernel, systemd", run: () => onRequest({ kind: "boot" }) }];
  }
  if (apps.screen === "login") {
    return [{ label: "Log in", detail: "PAM checks the password, logind starts your session", run: () => onRequest({ kind: "login" }) }];
  }
  if (apps.screen !== "desktop") return [];

  const actions: Action[] = [];
  const query = SUGGESTED_QUERIES[0] ?? "how does dns work";
  if (!open("browser")) actions.push(launch("browser"));
  else {
    actions.push(
      {
        label: `Search “${query}”`,
        detail: "DNS, TCP, TLS and HTTP, packet by packet",
        run: () => onRequest({ kind: "search", query }),
      },
      {
        label: "Type a letter in the search box",
        detail: "A key press: USB, an interrupt, the input layer, the compositor",
        run: () => onRequest({ kind: "keystroke", app: "browser", key: "h" }),
      },
    );
  }

  if (!open("editor")) actions.push(launch("editor"));
  else {
    actions.push({
      label: "Open notes.txt",
      detail: "open() and read(): the page cache, then the SSD if it misses",
      run: () => onRequest({ kind: "openFile" }),
    });
    const line = apps.editor.file ? apps.editor.text.split("\n").find((l) => l.trim() !== "") : undefined;
    if (line) {
      actions.push({
        label: "Copy a line of notes.txt",
        detail: "The editor offers the text; the compositor holds the offer",
        run: () => onRequest({ kind: "copy", app: "editor", text: line }),
      });
    }
  }

  const clip = apps.clipboard;
  if (clip && clip.owner !== "browser" && open("browser")) {
    actions.push({
      label: "Paste into the search box",
      detail: "The text moves from app to app through a pipe",
      run: () => onRequest({ kind: "paste", app: "browser", source: clip.owner, text: clip.text }),
    });
  }

  actions.push(
    open("player")
      ? {
          label: "Play a sound",
          detail: "PipeWire, the ring buffer, the sound card",
          run: () => onRequest({ kind: "play", media: "audio" }),
        }
      : launch("player"),
    ...(open("terminal")
      ? [
          {
            label: "Run ./cores",
            detail: "Threads on every core: stacks, clone3() and the scheduler",
            run: () => onCommand("./cores"),
          },
          {
            label: "Run ./marks",
            detail: "A C program: watch its stack and heap in the Memory tab",
            run: () => onCommand("./marks"),
          },
          { label: "Run cat notes.txt", detail: "A process, a pseudo-terminal and a read", run: () => onCommand("cat notes.txt") },
        ]
      : [launch("terminal")]),
    {
      label: "Restart the computer",
      detail: "Shutdown, then boot from the firmware up",
      run: () => onRequest({ kind: "restart" }),
    },
    {
      label: "Shut down",
      detail: "Services stop, the disk is synced, the power goes off",
      run: () => onRequest({ kind: "shutdown" }),
    },
  );
  return actions;
}

export function QuickActions({ apps, playing, onRequest, onCommand, onFinish, onStarted }: QuickActionsProps) {
  if (playing !== null) {
    return (
      <section
        aria-label="Try it"
        className="flex items-center gap-2 rounded-xl border border-lab-line bg-lab-panel px-3 py-2 md:hidden"
      >
        <span className="min-w-0 flex-1 truncate text-[13px] text-lab-ink">
          <span className="text-lab-muted">Playing: </span>
          {playing}
        </span>
        <button
          type="button"
          onClick={onFinish}
          className="min-h-9 shrink-0 rounded-md border border-lab-line bg-lab-panel2 px-2.5 text-[12.5px] text-lab-ink"
        >
          Skip to end
        </button>
      </section>
    );
  }

  if (programReads(apps.program) && apps.windows.terminal === "open") {
    return <ProgramInput apps={apps} onCommand={onCommand} onStarted={onStarted} />;
  }

  const actions = actionsFor(apps, onRequest, onCommand);
  if (actions.length === 0) return null;
  return (
    <section aria-label="Try it" className="rounded-xl border border-lab-line bg-lab-panel p-3 md:hidden">
      <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-lab-muted">Try it</h2>
      <div className="grid gap-2">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => {
              a.run();
              onStarted();
            }}
            disabled={a.disabled}
            className="flex min-h-11 flex-col items-start rounded-lg border border-lab-line bg-lab-panel2 px-3 py-2 text-left hover:border-white/25 disabled:opacity-50"
          >
            <span className="text-[14px] font-semibold text-lab-ink">{a.label}</span>
            <span className="text-[12px] text-lab-muted">{a.detail}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** ./marks is waiting for a line: type it here, since the terminal on the small screen is hard to reach. */
function ProgramInput({
  apps,
  onCommand,
  onStarted,
}: Pick<QuickActionsProps, "apps" | "onCommand" | "onStarted">) {
  const last = apps.terminal.lines.at(-1);
  const name = apps.program?.kind === "cores" ? "cores" : "marks";
  const question = last?.kind === "ask" && last.answer === undefined ? last.text.trim() : `${name} is reading`;
  const answers = programAnswers(apps.program);
  function send(text: string) {
    onCommand(text);
    onStarted();
  }
  return (
    <section aria-label={`Answer ./${name}`} className="rounded-xl border border-lab-line bg-lab-panel p-3 md:hidden">
      <h2 className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-lab-muted">./{name} asks</h2>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get("answer");
          send(typeof value === "string" ? value : "");
          e.currentTarget.reset();
        }}
      >
        <label htmlFor="program-answer" className="font-mono text-[13px] text-lab-ink">
          {question}
        </label>
        <div className="flex gap-2">
          <input
            id="program-answer"
            name="answer"
            autoComplete="off"
            spellCheck={false}
            maxLength={inputLimit(apps.program)}
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-lab-line bg-lab-panel2 px-3 font-mono text-[14px] text-lab-ink outline-none focus:border-signal/60"
          />
          <button
            type="submit"
            className="min-h-11 shrink-0 rounded-lg border border-signal/60 bg-signal/10 px-4 text-[14px] font-medium text-signal"
          >
            Enter
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-lab-muted">Or answer</span>
          {answers.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => send(a)}
              className="min-h-9 rounded-md border border-lab-line bg-lab-panel2 px-2.5 font-mono text-[13px] text-lab-ink"
            >
              {a}
            </button>
          ))}
        </div>
      </form>
    </section>
  );
}
