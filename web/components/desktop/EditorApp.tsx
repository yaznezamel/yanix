"use client";

import { useRef, useState } from "react";
import type { EditorState } from "@/lib/xray/types";
import styles from "../lab/lab.module.css";

interface EditorAppProps {
  state: EditorState;
  /** A trace is about to change the document, so typing waits. */
  locked: boolean;
  canPaste: boolean;
  onOpen: () => void;
  onText: (text: string) => void;
  onKeystroke: (key: string) => void;
  onCopy: (text: string) => void;
  onPaste: () => void;
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The selected text, or the line the cursor is on when nothing is selected. */
function selectionOrLine(el: HTMLTextAreaElement): string {
  const { value, selectionStart, selectionEnd } = el;
  if (selectionEnd > selectionStart) return value.slice(selectionStart, selectionEnd);
  const start = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const end = value.indexOf("\n", selectionStart);
  return value.slice(start, end === -1 ? value.length : end).trim();
}

export function EditorApp({ state, locked, canPaste, onOpen, onText, onKeystroke, onCopy, onPaste }: EditorAppProps) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const tracedThisFocus = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const hasFile = state.file !== null;

  function copy() {
    const el = textRef.current;
    if (!el) return;
    const text = selectionOrLine(el);
    if (text) onCopy(text);
  }

  return (
    <div className="flex h-full flex-col bg-[#1e1f22] text-[#e8edf2]">
      <div className="relative flex h-10 shrink-0 items-center gap-1.5 border-b border-white/10 bg-[#2b2d31] px-2 text-[12px]">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          className="rounded-md bg-white/[0.08] px-3 py-1 hover:bg-white/[0.14]"
        >
          Open ▾
        </button>
        {menuOpen && (
          <div className="absolute left-2 top-9 z-10 w-56 rounded-md border border-white/10 bg-[#2b2d31] p-1 shadow-[0_12px_30px_rgba(0,0,0,0.5)]">
            <p className="px-2 pb-1 pt-0.5 text-[10.5px] text-white/45">~/ (home folder)</p>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOpen();
              }}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-white/10"
            >
              notes.txt <span className="text-[10.5px] text-white/40">text file</span>
            </button>
          </div>
        )}
        <span className="mx-auto truncate font-semibold text-white/85">
          {state.file ? fileName(state.file) : "New document"}
        </span>
        <button
          type="button"
          onClick={copy}
          disabled={!hasFile || state.loading}
          className="rounded-md px-2.5 py-1 text-white/80 hover:bg-white/10 disabled:opacity-35"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={onPaste}
          disabled={!canPaste || locked}
          className="rounded-md px-2.5 py-1 text-white/80 hover:bg-white/10 disabled:opacity-35"
        >
          Paste
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {state.loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-[12.5px] text-white/55">
            <svg viewBox="0 0 16 16" className={`size-4 ${styles.spin}`} aria-hidden>
              <circle cx="8" cy="8" r="6" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
              <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="#3fe0ff" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Reading {state.file ? fileName(state.file) : "the file"}…
          </div>
        ) : !hasFile ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-[13px] text-white/70">No file open.</p>
            <button
              type="button"
              onClick={onOpen}
              className="rounded-md bg-signal px-3.5 py-1.5 text-[12.5px] font-semibold text-[#03141a] hover:brightness-110"
            >
              Open notes.txt
            </button>
            <p className="max-w-[300px] text-[11.5px] leading-relaxed text-white/45">
              Open it twice: the first read comes from the SSD, the second from the page cache.
            </p>
          </div>
        ) : (
          <textarea
            ref={textRef}
            aria-label="Document"
            value={state.text}
            readOnly={locked}
            spellCheck={false}
            onChange={(e) => onText(e.target.value)}
            onFocus={() => {
              tracedThisFocus.current = false;
            }}
            onKeyDown={(e) => {
              if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || locked) return;
              if (!tracedThisFocus.current) {
                tracedThisFocus.current = true;
                onKeystroke(e.key);
              }
            }}
            onCopy={(e) => {
              e.preventDefault();
              copy();
            }}
            onCut={(e) => e.preventDefault()}
            onPaste={(e) => {
              e.preventDefault();
              if (canPaste && !locked) onPaste();
            }}
            className="h-full w-full resize-none bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-[#e8edf2] outline-none"
          />
        )}
      </div>

      <div className="flex h-6 shrink-0 items-center justify-between border-t border-white/10 bg-[#2b2d31] px-3 font-mono text-[10.5px] text-white/45">
        <span>{state.file ?? "unsaved"}</span>
        <span>{locked ? "a trace is updating this document" : "Ctrl+C and Ctrl+V go through the compositor"}</span>
      </div>
    </div>
  );
}
