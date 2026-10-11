"use client";

import { useEffect, useRef } from "react";
import { PROMPT } from "@/lib/xray/apps";
import type { TerminalState } from "@/lib/xray/types";
import styles from "../lab/lab.module.css";

interface TerminalAppProps {
  state: TerminalState;
  onCommand: (command: string) => void;
}

const QUICK = ["cat notes.txt", "help", "clear"];

export function TerminalApp({ state, onCommand }: TerminalAppProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const count = state.lines.length;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, state.busy]);

  return (
    <div
      className="flex h-full flex-col bg-[#0c0d10] font-mono text-[12.5px] leading-[1.55] text-[#e8edf2]"
      onClick={() => inputRef.current?.focus()}
    >
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {state.lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-words">
            {line.kind === "prompt" ? (
              <>
                <span className="text-[#5eead4]">{PROMPT}</span> {line.text}
              </>
            ) : (
              <span
                className={
                  line.kind === "banner"
                    ? "text-signal"
                    : line.kind === "hint"
                      ? "text-white/45"
                      : "text-[#e8edf2]"
                }
              >
                {line.text}
              </span>
            )}
          </div>
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
              onCommand(typeof value === "string" ? value : "");
              e.currentTarget.reset();
            }}
          >
            <span className="shrink-0 text-[#5eead4]">{PROMPT}</span>
            <input
              ref={inputRef}
              name="command"
              aria-label="Terminal command"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[#e8edf2] caret-signal outline-none"
            />
          </form>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-white/10 bg-black/30 px-3 py-1.5 text-[11px]">
        <span className="text-white/60">Try</span>
        {QUICK.map((cmd) => (
          <button
            key={cmd}
            type="button"
            disabled={state.busy}
            onClick={(e) => {
              e.stopPropagation();
              onCommand(cmd);
            }}
            className="rounded border border-white/15 px-2 py-0.5 text-white/80 hover:bg-white/[0.06] disabled:opacity-40"
          >
            {cmd}
          </button>
        ))}
      </div>
    </div>
  );
}
