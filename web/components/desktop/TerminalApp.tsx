"use client";

import { useEffect, useRef } from "react";
import { PROMPT } from "@/lib/xray/apps";
import { programReads } from "@/lib/xray/scenarios";
import { CONTROL_KEYS, controlKey, inputLimit, programAnswers, shownLine } from "@/lib/xray/shell";
import type { Program, TermLine, TerminalState } from "@/lib/xray/types";
import styles from "../lab/lab.module.css";

interface TerminalAppProps {
  state: TerminalState;
  /** The C program running in the terminal, if any: while it reads, what you type goes to it. */
  program: Program | null;
  /** Lines typed while a trace still plays: they wait in the TTY until something reads them. */
  typedAhead: string[];
  onCommand: (command: string) => void;
  /** Ctrl+C or Ctrl+D. */
  onControl: (key: "c" | "d") => void;
}

const SHELL_QUICK = ["./marks", "./cores", "cat notes.txt", "help", "clear"];

/** A mouse or trackpad: focusing a field there does not open an on-screen keyboard over the page. */
export const finePointer = () => window.matchMedia("(pointer: fine)").matches;

export function TerminalApp({ state, program, typedAhead, onCommand, onControl }: TerminalAppProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const count = state.lines.length;
  const reads = programReads(program);
  const last = state.lines[count - 1];
  // A program's question, still unanswered: the input goes on its line.
  const asking = !state.busy && reads && last?.kind === "ask" && last.answer === undefined ? last : null;
  const lines = asking ? state.lines.slice(0, -1) : state.lines;
  const quick = reads ? programAnswers(program) : SHELL_QUICK;
  const name = program?.kind === "cores" ? "cores" : "marks";
  const runs = program !== null && program.stage !== "starting" && program.stage !== "exited";

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, state.busy, typedAhead.length]);

  // A window that opens takes the keyboard, as on a desktop.
  useEffect(() => {
    if (finePointer()) inputRef.current?.focus({ preventScroll: true });
  }, []);

  /** The field stays where it is while a trace plays: what you type then waits in the TTY. */
  function send(text: string) {
    onCommand(text);
    if (finePointer()) inputRef.current?.focus({ preventScroll: true });
  }

  function control(key: "c" | "d") {
    onControl(key);
    if (finePointer()) inputRef.current?.focus({ preventScroll: true });
  }

  return (
    <div
      className="flex h-full flex-col bg-[#0c0d10] font-mono text-[12.5px] leading-[1.55] text-[#e8edf2]"
      onClick={() => inputRef.current?.focus()}
    >
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <div role="log" aria-label="Terminal output">
          {lines.map((line, i) => (
            <Line key={i} line={line} />
          ))}
          {typedAhead.map((text, i) => (
            <div key={`ahead-${i}`} className="whitespace-pre-wrap break-words text-white/55">
              {shownLine(text)}
              <span className="text-white/40"> · typed ahead: it waits in the TTY until something reads it</span>
            </div>
          ))}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get("command");
            send(typeof value === "string" ? value : "");
            e.currentTarget.reset();
          }}
        >
          {state.busy ? (
            <span className={`shrink-0 text-white/40 ${styles.blink}`} aria-hidden>
              ▋
            </span>
          ) : asking ? (
            <span className="shrink-0 whitespace-pre text-[#e8edf2]">{asking.text.trimEnd()}</span>
          ) : reads ? null : (
            <span className="shrink-0 text-[#5eead4]">{PROMPT}</span>
          )}
          <input
            ref={inputRef}
            name="command"
            aria-label={
              state.busy
                ? "Type ahead: the line waits in the TTY until something reads it"
                : asking
                  ? `${name} asks: ${asking.text.trim()}`
                  : reads
                    ? `Input for ${name}`
                    : "Terminal command"
            }
            autoComplete="off"
            spellCheck={false}
            maxLength={reads ? inputLimit(program) : undefined}
            onKeyDown={(e) => {
              // A terminal's keys, not the browser's: Ctrl+C interrupts (unless text is selected, to copy), and
              // Ctrl+D at the start of a line ends the input.
              const key = controlKey(e);
              const field = e.currentTarget;
              if (key === "c" && field.selectionStart !== field.selectionEnd) return;
              if (key === null) return;
              e.preventDefault();
              if (key === "c") field.value = "";
              if (key === "c" || field.value === "") control(key);
            }}
            className="min-w-0 flex-1 rounded-sm bg-transparent text-[#e8edf2] caret-signal outline-none focus-visible:ring-1 focus-visible:ring-signal/50"
          />
        </form>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-white/10 bg-black/30 px-3 py-1.5 text-[11px]">
        <span className="text-white/60">{reads ? "Answer" : "Try"}</span>
        {quick.map((cmd) => (
          <button
            key={cmd}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              send(cmd);
            }}
            className="shrink-0 whitespace-nowrap rounded border border-white/15 px-2 py-0.5 text-white/80 hover:bg-white/[0.06]"
          >
            {cmd}
          </button>
        ))}
        {runs &&
          CONTROL_KEYS.map((k) => (
            <button
              key={k.key}
              type="button"
              title={`${k.label}: ${k.what}`}
              onClick={(e) => {
                e.stopPropagation();
                control(k.key);
              }}
              className="shrink-0 whitespace-nowrap rounded border border-white/15 px-2 py-0.5 text-white/60 hover:bg-white/[0.06]"
            >
              {k.label}
            </button>
          ))}
        <span className="ml-auto min-w-0 truncate text-white/45">
          {state.busy ? "running: what you type waits in the TTY" : reads ? `${name} is reading what you type` : ""}
        </span>
      </div>
    </div>
  );
}

function Line({ line }: { line: TermLine }) {
  switch (line.kind) {
    case "prompt":
      return (
        <div className="whitespace-pre-wrap break-words">
          <span className="text-[#5eead4]">{PROMPT}</span> {line.text}
        </div>
      );
    case "ask":
      // A prompt printed without a newline, and the answer typed after it.
      return (
        <div className="whitespace-pre-wrap break-words">
          {line.text}
          {line.answer}
        </div>
      );
    default:
      return (
        <div
          className={`whitespace-pre-wrap break-words ${
            line.kind === "banner" ? "text-signal" : line.kind === "hint" ? "text-white/45" : "text-[#e8edf2]"
          }`}
        >
          {line.text}
        </div>
      );
  }
}
