"use client";

import { useEffect, useRef } from "react";
import { finePointer } from "@/components/desktop/TerminalApp";
import { SUGGESTED_QUERIES } from "@/lib/xray/apps";
import { programReads } from "@/lib/xray/scenarios";
import { inputLimit, programAnswers } from "@/lib/xray/shell";
import type { AppId, AppState, Program, ScenarioRequest, TermLine } from "@/lib/xray/types";

// On a phone the simulated screen is too small to tap, so the same actions are
// offered as full-size buttons under it. Each one starts the trace the desktop
// would: open an app first, then do the thing it is for. While a trace plays
// the panel shrinks to one line, so the story right below it stays in view.
// While a C program runs in the terminal, its answer bar shows at every
// width: the terminal's own text is small on the simulated screen.

interface QuickActionsProps {
  apps: AppState;
  /** The C program running in the open terminal, as it is once the playing trace is over. */
  program: Program | null;
  /** Lines typed while the trace plays, waiting in the TTY. */
  typedAhead: string[];
  /** The playing trace ends with the program asking for a line. */
  toQuestion: boolean;
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

export function QuickActions(props: QuickActionsProps) {
  const { apps, program, playing, onRequest, onCommand, onFinish, onStarted } = props;
  if (program) return <ProgramInput {...props} program={program} />;

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

/** What the program printed since you last answered it (before the question it asks now), the newest last. */
function recentOutput(lines: TermLine[], max: number): string[] {
  const out: string[] = [];
  let i = lines.length - 1;
  const asking = lines[i];
  if (asking?.kind === "ask" && asking.answer === undefined) i--;
  for (; i >= 0 && out.length < max; i--) {
    const line = lines[i]!;
    if (line.kind !== "output") break;
    out.unshift(line.text);
  }
  return out;
}

/**
 * The C program's answer bar. While it reads, its question and a field to
 * answer it; while a trace plays, a way to skip to the question, or to type
 * ahead: the line waits in the TTY until the program reads it. On a phone it
 * also shows what the program printed last; on a wide screen it keeps to two
 * rows, so the screen above it keeps its size.
 */
function ProgramInput({
  apps,
  program,
  typedAhead,
  toQuestion,
  playing,
  onCommand,
  onFinish,
  onStarted,
}: QuickActionsProps & { program: Program }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const name = program.kind;
  const reading = playing === null && programReads(apps.program);
  const last = apps.terminal.lines.at(-1);
  const question = reading && last?.kind === "ask" && last.answer === undefined ? last.text.trim() : null;
  const answers = programAnswers(program);
  const output = recentOutput(apps.terminal.lines, 5);
  const said =
    question ??
    (typedAhead.length > 0
      ? `Waiting in the TTY: ${typedAhead.join(" · ")}`
      : reading
        ? "reading a line"
        : "type ahead, and your line waits in the TTY until it reads");

  // The question comes: if nothing else has the keyboard, the field takes it.
  useEffect(() => {
    if (!reading || !finePointer()) return;
    const active = document.activeElement;
    if (active === null || active === document.body) inputRef.current?.focus({ preventScroll: true });
  }, [reading]);

  const keyboard = () => {
    if (finePointer()) inputRef.current?.focus({ preventScroll: true });
  };

  function send(text: string, fromField: boolean) {
    onCommand(text);
    onStarted();
    if (fromField) inputRef.current?.focus({ preventScroll: true });
    else keyboard();
  }

  return (
    <section
      aria-label={`Answer ./${name}`}
      className="rounded-xl border border-lab-line bg-lab-panel p-3 xl:h-[84px] xl:py-2.5"
    >
      <form
        className="flex flex-col gap-2 xl:gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get("answer");
          send(typeof value === "string" ? value : "", true);
          e.currentTarget.reset();
        }}
      >
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-lab-muted xl:hidden">
          ./{name} {reading ? "asks" : "is running"}
        </h2>
        {output.length > 0 && (
          <pre
            aria-label={`What ./${name} printed last`}
            className="max-h-40 overflow-y-auto rounded-md bg-[#0c0d10] px-2.5 py-1.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words text-[#e8edf2] xl:hidden"
          >
            {output.join("\n")}
          </pre>
        )}
        <label
          htmlFor="program-answer"
          title={question ?? undefined}
          className={`font-mono text-[13px] xl:truncate ${question ? "text-lab-ink" : "text-lab-muted"}`}
        >
          <span className="hidden text-lab-muted xl:inline">
            ./{name} {reading ? "asks" : "is running"}:{" "}
          </span>
          {said}
          {name === "marks" && reading && (
            <span className="text-lab-muted"> · to finish, answer n when it asks for another</span>
          )}
        </label>
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:gap-2.5">
          <div className="flex gap-2 xl:min-w-0 xl:flex-1">
            <input
              ref={inputRef}
              id="program-answer"
              name="answer"
              autoComplete="off"
              spellCheck={false}
              maxLength={inputLimit(program)}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-lab-line bg-lab-panel2 px-3 font-mono text-[14px] text-lab-ink outline-none focus:border-signal/60 focus-visible:ring-2 focus-visible:ring-signal/40 xl:min-h-9"
            />
            <button
              type="submit"
              className="min-h-11 shrink-0 rounded-lg border border-signal/60 bg-signal/10 px-4 text-[14px] font-medium text-signal xl:min-h-9"
            >
              Enter
            </button>
          </div>
          {toQuestion ? (
            <button
              type="button"
              onClick={() => {
                onFinish();
                keyboard();
              }}
              className="min-h-9 self-start whitespace-nowrap rounded-md border border-signal/60 bg-signal/10 px-2.5 text-[13px] font-medium text-signal xl:self-auto"
            >
              Skip to the question
            </button>
          ) : (
            answers.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:flex-nowrap">
                <span className="text-[12px] text-lab-muted xl:sr-only">Or answer</span>
                {answers.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => send(a, false)}
                    className="min-h-9 whitespace-nowrap rounded-md border border-lab-line bg-lab-panel2 px-2.5 font-mono text-[13px] text-lab-ink"
                  >
                    {a}
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      </form>
    </section>
  );
}
