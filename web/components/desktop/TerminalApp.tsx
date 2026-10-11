"use client";

import { useEffect, useRef } from "react";
import { PROMPT } from "@/lib/xray/apps";
import { MAX_INPUT_BYTES, type ProgramState } from "@/lib/xray/marks/program";
import type { TermLine, TerminalState } from "@/lib/xray/types";
import styles from "../lab/lab.module.css";

interface TerminalAppProps {
  state: TerminalState;
  /** The C program running in the terminal, if any: while it reads, what you type goes to it. */
  program: ProgramState | null;
  onCommand: (command: string) => void;
}

const SHELL_QUICK = ["./marks", "cat notes.txt", "help", "clear"];

/** Answers to try for each of the program's questions: a good one, and one it should reject or end on. */
export const PROGRAM_ANSWERS: Partial<Record<ProgramState["stage"], string[]>> = {
  name: ["Ada", "Linus"],
  marks: ["72 85 90", "90 abc"],
  again: ["y", "n"],
};

/** Is the program blocked in read(), waiting for a line? */
export function programReads(program: ProgramState | null): boolean {
  return program !== null && (program.stage === "name" || program.stage === "marks" || program.stage === "again");
}

export function TerminalApp({ state, program, onCommand }: TerminalAppProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Typing goes on where it left off: the field comes back focused after a trace you started from it. */
  const refocus = useRef(false);
  const count = state.lines.length;
  const reads = programReads(program);
  const last = state.lines[count - 1];
  // A program's question, still unanswered: the input goes on its line.
  const asking = reads && last?.kind === "ask" && last.answer === undefined ? last : null;
  const lines = asking ? state.lines.slice(0, -1) : state.lines;
  const quick = reads ? (PROGRAM_ANSWERS[program!.stage] ?? []) : SHELL_QUICK;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, state.busy]);

  useEffect(() => {
    if (!state.busy && refocus.current) {
      refocus.current = false;
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [state.busy]);

  function send(text: string, fromField: boolean) {
    refocus.current = fromField;
    onCommand(text);
  }

  return (
    <div
      className="flex h-full flex-col bg-[#0c0d10] font-mono text-[12.5px] leading-[1.55] text-[#e8edf2]"
      onClick={() => inputRef.current?.focus()}
    >
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {lines.map((line, i) => (
          <Line key={i} line={line} />
        ))}
        {state.busy ? (
          <div className="text-white/40">
            <span className={styles.blink}>▋</span>
          </div>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get("command");
              send(typeof value === "string" ? value : "", true);
              e.currentTarget.reset();
            }}
          >
            {reads ? (
              asking && <span className="shrink-0 whitespace-pre text-[#e8edf2]">{asking.text.trimEnd()}</span>
            ) : (
              <span className="shrink-0 text-[#5eead4]">{PROMPT}</span>
            )}
            <input
              ref={inputRef}
              name="command"
              aria-label={asking ? `marks asks: ${asking.text.trim()}` : reads ? "Input for marks" : "Terminal command"}
              autoComplete="off"
              spellCheck={false}
              maxLength={reads ? MAX_INPUT_BYTES : undefined}
              className="min-w-0 flex-1 bg-transparent text-[#e8edf2] caret-signal outline-none"
            />
          </form>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-white/10 bg-black/30 px-3 py-1.5 text-[11px]">
        <span className="text-white/60">{reads ? "Answer" : "Try"}</span>
        {quick.map((cmd) => (
          <button
            key={cmd}
            type="button"
            disabled={state.busy}
            onClick={(e) => {
              e.stopPropagation();
              send(cmd, false);
            }}
            className="rounded border border-white/15 px-2 py-0.5 text-white/80 hover:bg-white/[0.06] disabled:opacity-40"
          >
            {cmd}
          </button>
        ))}
        {reads && <span className="ml-auto truncate text-white/45">marks is reading what you type</span>}
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
