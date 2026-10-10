"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRef } from "react";
import { SUGGESTED_QUERIES } from "@/lib/xray/apps";
import type { BrowserState } from "@/lib/xray/types";
import styles from "../lab/lab.module.css";
import { InfoIcon, LockIcon, SearchIcon } from "./icons";

// Real references for what the trace just showed. The results page is a
// simulation, so it always offers these instead of pretending to search.
const LEARNING_LINKS = [
  {
    title: "RFC 1034: Domain names, concepts and facilities",
    url: "https://www.rfc-editor.org/rfc/rfc1034",
    snippet: "Names, zones, referrals and recursive resolvers: the DNS walk from root to example.com.",
  },
  {
    title: "RFC 3022: Traditional IP Network Address Translator",
    url: "https://www.rfc-editor.org/rfc/rfc3022",
    snippet: "How your router shares one public address and rewrites packets on the way out and in.",
  },
  {
    title: "RFC 9293: Transmission Control Protocol",
    url: "https://www.rfc-editor.org/rfc/rfc9293",
    snippet: "The three-way handshake you just watched, sequence numbers and everything after.",
  },
  {
    title: "RFC 8446: The Transport Layer Security (TLS) Protocol Version 1.3",
    url: "https://www.rfc-editor.org/rfc/rfc8446",
    snippet: "ClientHello, ServerHello, key shares and the encrypted certificate.",
  },
  {
    title: "RFC 9113: HTTP/2",
    url: "https://www.rfc-editor.org/rfc/rfc9113",
    snippet: "Frames and streams: why one connection can carry many requests.",
  },
  {
    title: "Linux kernel networking documentation",
    url: "https://docs.kernel.org/networking/index.html",
    snippet: "NAPI, sockets, netfilter and the rest of the stack, from the kernel's own docs.",
  },
];

interface BrowserAppProps {
  state: BrowserState;
  /** A trace is about to change the search box, so typing waits. */
  locked: boolean;
  canPaste: boolean;
  onSearch: (query: string) => void;
  onDraft: (text: string) => void;
  onKeystroke: (key: string) => void;
  onCopy: (text: string) => void;
  onPaste: () => void;
}

type SearchBoxProps = Omit<BrowserAppProps, "state" | "onSearch"> & { draft: string; large?: boolean };

function Wordmark({ small }: { small?: boolean }) {
  return (
    <span className={`font-semibold tracking-tight ${small ? "text-[18px]" : "text-[40px]"}`}>
      <span className="bg-gradient-to-r from-[#6aa8ff] to-[#3fe0ff] bg-clip-text text-transparent">example</span>
      <span className="text-white/90"> search</span>
    </span>
  );
}

/** The page's search box. Its text lives in the lab's state, so traces can paste into it. */
function SearchForm({
  draft,
  large,
  locked,
  canPaste,
  onSubmit,
  onDraft,
  onKeystroke,
  onCopy,
  onPaste,
}: SearchBoxProps & { onSubmit: () => void }) {
  const tracedThisFocus = useRef(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) onSubmit();
      }}
      className={`flex w-full items-center gap-2 rounded-full border border-white/15 bg-[#303134] px-4 ${
        large ? "h-11" : "h-8"
      } focus-within:border-[#6aa8ff]`}
    >
      <SearchIcon className="size-4 shrink-0 text-white/50" />
      <input
        name="q"
        value={draft}
        readOnly={locked}
        onChange={(e) => onDraft(e.target.value)}
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
          const el = e.currentTarget;
          const text = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
          if (text.trim()) onCopy(text);
        }}
        onCut={(e) => e.preventDefault()}
        onPaste={(e) => {
          e.preventDefault();
          if (canPaste && !locked) onPaste();
        }}
        aria-label="Search"
        autoComplete="off"
        placeholder="Search the web"
        className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/40"
      />
    </form>
  );
}

export function BrowserTabs({ state }: { state: BrowserState }) {
  return (
    <div className="flex h-full min-w-0 items-end gap-1 pt-1.5">
      <div className="flex h-full min-w-0 max-w-[220px] items-center gap-2 rounded-t-lg bg-[#35363a] px-3 text-[12px] text-white/90">
        {state.loading ? (
          <svg viewBox="0 0 16 16" className={`size-3.5 shrink-0 ${styles.spin}`} aria-hidden>
            <circle cx="8" cy="8" r="6" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />
            <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="#6aa8ff" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <span className="grid size-3.5 shrink-0 place-items-center rounded-full bg-[#6aa8ff] text-[8px] font-bold text-[#0b1a33]">
            e
          </span>
        )}
        <span className="truncate">{state.title}</span>
      </div>
      <span className="pb-2 text-[15px] leading-none text-white/50" aria-hidden>
        +
      </span>
    </div>
  );
}

export function BrowserApp({ state, onSearch, ...box }: BrowserAppProps) {
  return (
    <div className="flex h-full flex-col bg-[#202124] text-white">
      <div className="flex h-10 shrink-0 items-center gap-2 bg-[#35363a] px-2">
        {["M10 3 5 8l5 5", "m6 3 5 5-5 5"].map((d) => (
          <span key={d} className="grid size-7 place-items-center rounded-full text-white/45">
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
              <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </span>
        ))}
        <span className="grid size-7 place-items-center rounded-full text-white/70">
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
            <path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v3h-3" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </span>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get("omnibox");
            if (typeof value === "string" && value.trim()) onSearch(value);
          }}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full bg-[#202124] px-3 ring-1 ring-transparent focus-within:ring-[#6aa8ff]"
        >
          <span className={state.secure ? "text-white/80" : "text-white/45"} title={state.secure ? "Connection is secure" : undefined}>
            {state.url ? (
              state.secure ? <LockIcon className="size-3.5" /> : <InfoIcon className="size-3.5" />
            ) : (
              <SearchIcon className="size-3.5" />
            )}
          </span>
          <input
            key={state.url || "new-tab"}
            name="omnibox"
            defaultValue={state.url}
            aria-label="Address and search bar"
            autoComplete="off"
            placeholder="Search or type a URL"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-white/90 outline-none placeholder:text-white/40"
          />
        </form>
        <span className="grid size-7 place-items-center rounded-full bg-[#3fe0ff]/20 text-[11px] font-semibold text-signal">
          Y
        </span>
      </div>
      <div className="relative h-[2px] shrink-0 bg-transparent">
        {state.loading && (
          <motion.div
            className="absolute inset-y-0 left-0 bg-[#6aa8ff]"
            initial={false}
            animate={{ width: `${Math.round(state.progress * 100)}%` }}
            transition={{ duration: 0.5 }}
          />
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {state.page === "newtab" ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 px-10 pb-8">
            <Wordmark />
            <div className="w-full max-w-[460px]">
              <SearchForm draft={state.draft} large onSubmit={() => onSearch(state.draft)} {...box} />
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTED_QUERIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onSearch(q)}
                  className="rounded-full border border-white/15 px-3 py-1 text-[12px] text-white/80 hover:bg-white/[0.06]"
                >
                  {q}
                </button>
              ))}
            </div>
            <p className="max-w-[420px] text-center text-[11px] leading-relaxed text-white/40">
              Searches go to www.example.com, a name reserved for examples. The trace is real
              networking; the results page is simulated.
            </p>
          </div>
        ) : (
          <div className="px-6 py-4">
            <div className="flex items-center gap-4 border-b border-white/10 pb-3">
              <Wordmark small />
              <div className="max-w-[360px] flex-1">
                <SearchForm draft={state.draft} onSubmit={() => onSearch(state.draft)} {...box} />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-white/40">
              Simulated results: links to the specifications behind what you just watched.
            </p>
            <ol className="mt-3 flex flex-col gap-4">
              {LEARNING_LINKS.map((link) => (
                <li key={link.url}>
                  <p className="truncate text-[11px] text-white/50">{link.url}</p>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[15px] text-[#8ab4f8] hover:underline"
                  >
                    {link.title}
                  </a>
                  <p className="text-[12.5px] text-white/70">{link.snippet}</p>
                </li>
              ))}
            </ol>
          </div>
        )}

        <AnimatePresence>
          {state.status && (
            <motion.div
              key="status"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="sticky bottom-0 left-0 inline-block max-w-[70%] truncate rounded-tr-md border-r border-t border-white/10 bg-[#35363a] px-2.5 py-1 text-[11.5px] text-white/85"
            >
              {state.status}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
