"use client";

import { useEffect, useRef } from "react";
import { cString, textOf, type Ending } from "@/lib/xray/marks/program";

// Pieces the Memory tab's views share: a panel, a stack frame's rows, the
// source with the current line, and a strip of bytes. Values the program has
// not written are shown as "?", and what the current step changed is marked
// (data-changed), and scrolled into view.

export const hex = (n: number) => `0x${n.toString(16)}`;
const signed = (n: number) => (n < 0 ? `−${hex(-n)}` : `+${hex(n)}`);

export function Unset() {
  return <span className="text-lab-muted">?</span>;
}

/**
 * Keeps what a step changed in view inside the tab's scroll box, as a
 * debugger follows the current line: the changes and the current source line
 * together if they fit, else all the changes, else the first one. The box
 * stays put when they are in view already.
 */
export function useChangesInView(box: React.RefObject<HTMLDivElement | null>, step: unknown) {
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const changes = [...el.querySelectorAll<HTMLElement>("[data-changed]")].map((c) => c.getBoundingClientRect());
    if (changes.length === 0) return;
    const context = [...el.querySelectorAll<HTMLElement>("[aria-current='step']")].map((c) => c.getBoundingClientRect());
    const view = el.getBoundingClientRect();
    const margin = 8;
    const span = (rects: DOMRect[]) => ({
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    });
    const fits = (r: { top: number; bottom: number }) => r.bottom - r.top + 2 * margin <= view.height;
    const all = span([...changes, ...context]);
    const target = fits(all) ? all : fits(span(changes)) ? span(changes) : changes[0]!;
    let delta = 0;
    if (target.top < view.top + margin) delta = target.top - view.top - margin;
    else if (target.bottom > view.bottom - margin) {
      delta = Math.min(target.bottom - view.bottom + margin, target.top - view.top - margin);
    }
    if (Math.abs(delta) < 1) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ top: delta, behavior: reduce ? "auto" : "smooth" });
  }, [box, step]);
}

export function Changed() {
  return <span className="ml-1.5 font-sans text-[10px] font-medium text-signal">changed</span>;
}

export function Panel({ title, sub, lit, children }: { title: string; sub: string; lit: boolean; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      className={`rounded-lg border bg-lab-panel2/60 ${lit ? "border-signal/50" : "border-lab-line"}`}
    >
      <h3 className="flex flex-wrap items-baseline gap-x-2 border-b border-lab-line px-2.5 py-1.5">
        <span className={`font-mono text-[11px] uppercase tracking-[0.1em] ${lit ? "text-signal" : "text-lab-muted"}`}>
          {title}
        </span>
        <span className="font-mono text-[10.5px] text-lab-muted">{sub}</span>
      </h3>
      {children}
    </section>
  );
}

/** The top of a view: the program, what it is doing, and a word on its addresses. */
export function ViewHeader({
  command,
  stage,
  exited,
  run,
  endedBy,
}: {
  command: string;
  stage: string;
  exited: boolean;
  run: number;
  /** The signal that ended the program, if one did. */
  endedBy?: Ending;
}) {
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-2">
        <h2 className="font-mono text-[13px] font-semibold text-lab-ink">{command}</h2>
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${exited ? "bg-white/5 text-lab-muted" : "bg-signal/12 text-signal"}`}
        >
          {stage}
        </span>
        <span className="text-[11.5px] text-lab-muted">
          Addresses from a real run of the program. ASLR (address space layout randomisation) gives every run
          new ones: this is run {run + 1}.
        </span>
      </div>
      {exited && endedBy === "hangup" && (
        <p className="mb-3 rounded-md border border-lab-line bg-lab-panel2 px-3 py-2 text-[12.5px] text-lab-ink/85">
          The Terminal was closed while {command} ran. Closing it closed one end of the pseudo-terminal, and the kernel
          hung up the other: it sent SIGHUP to bash, which passes it on to its jobs as it exits, and a read() from the
          hung-up terminal returns end of file. Either way {command} ended, and the kernel took back every page. This
          is how its memory looked last. Open the Terminal and type{" "}
          <span className="font-mono text-signal">{command}</span> to run it again.
        </p>
      )}
      {exited && endedBy === "interrupt" && (
        <p className="mb-3 rounded-md border border-lab-line bg-lab-panel2 px-3 py-2 text-[12.5px] text-lab-ink/85">
          Ctrl+C sent SIGINT, and its default action ended the process: main() never returned, and no free() ran,
          but the kernel took back every page all the same. This is how its memory looked last. Type{" "}
          <span className="font-mono text-signal">{command}</span> in the Terminal to run it again.
        </p>
      )}
      {exited && endedBy === undefined && (
        <p className="mb-3 rounded-md border border-lab-line bg-lab-panel2 px-3 py-2 text-[12.5px] text-lab-ink/85">
          The process has exited and the kernel has taken back every page. This is how its memory looked last.
          Type <span className="font-mono text-signal">{command}</span> in the Terminal to run it again.
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------- source

/** Lines around the current one that stay bright. */
const CONTEXT = 4;

export function Source({ name, lines, at }: { name: string; lines: readonly string[]; at: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  // Scroll the box, not the page, so the current line is in the middle.
  useEffect(() => {
    const box = boxRef.current;
    const line = lineRef.current;
    if (!box || !line) return;
    box.scrollTop = line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2;
  }, [at]);

  return (
    <section aria-label="Source code" className="rounded-lg border border-lab-line bg-lab-panel2/60">
      <h3 className="flex items-baseline justify-between gap-2 border-b border-lab-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-lab-muted">
        {name}
        <span className="normal-case tracking-normal">{at > 0 ? `line ${at}` : "before main()"}</span>
      </h3>
      <div
        ref={boxRef}
        className="relative max-h-[10.5rem] overflow-y-auto py-1 font-mono text-[11.5px] leading-[1.6] @5xl:max-h-[20rem]"
      >
        {lines.map((text, i) => {
          const n = i + 1;
          const current = n === at;
          return (
            <div
              key={n}
              ref={current ? lineRef : undefined}
              aria-current={current ? "step" : undefined}
              className={`flex gap-2 pr-2 whitespace-pre ${
                current ? "bg-signal/15 text-lab-ink" : Math.abs(n - at) <= CONTEXT ? "text-lab-ink/80" : "text-lab-ink/55"
              }`}
            >
              <span className={`w-8 shrink-0 text-right ${current ? "text-signal" : "text-lab-muted"}`}>
                {current ? "▶" : n}
              </span>
              <span>{text.replace(/\t/g, "    ")}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- stack frames

export interface Slot {
  /** The change key that marks this slot as changed. */
  key?: string;
  /** Offset from the frame's rbp. */
  offset: number;
  name: string;
  value: React.ReactNode;
  note?: string;
}

export function Frame({
  title,
  detail,
  slots,
  lit,
  changed,
}: {
  title: string;
  detail: string;
  slots: Slot[];
  lit: boolean;
  changed: Set<string>;
}) {
  return (
    <div className={`border-t border-lab-line first:border-t-0 ${lit ? "bg-signal/[0.06]" : ""}`}>
      <p data-changed={lit || undefined} className="flex flex-wrap items-baseline gap-x-2 px-2.5 pt-1.5 pb-0.5">
        <span className={`font-mono text-[12px] font-semibold ${lit ? "text-signal" : "text-lab-ink"}`}>{title}</span>
        <span className="font-mono text-[10.5px] text-lab-muted">{detail}</span>
        {lit && <Changed />}
      </p>
      <dl className="grid grid-cols-[4.6rem_minmax(0,auto)_minmax(0,1fr)] items-baseline gap-x-2 px-1.5 pb-1.5">
        {slots.map((slot) => {
          const hot = slot.key !== undefined && changed.has(slot.key);
          return (
            <div
              key={`${slot.name}-${slot.offset}`}
              data-changed={hot || undefined}
              className={`col-span-3 grid grid-cols-subgrid items-baseline rounded px-1 py-[3px] ${hot ? "bg-signal/12 ring-1 ring-signal/50" : ""}`}
            >
              <dt className="font-mono text-[10.5px] text-lab-muted" title="Offset from this frame's rbp">
                rbp{signed(slot.offset)}
              </dt>
              <dt className={`font-mono text-[11.5px] ${hot ? "text-signal" : "text-lab-ink/90"}`}>{slot.name}</dt>
              <dd className="min-w-0 break-words font-mono text-[11.5px] text-lab-ink/90">
                {slot.value}
                {slot.note && <span className="text-lab-muted"> {slot.note}</span>}
                {hot && <Changed />}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/** What a frame's terms mean, under the frames: rbp, rsp and the canary. */
export function FrameGuide() {
  return (
    <p className="border-t border-lab-line px-2.5 py-1.5 text-[11px] leading-snug text-lab-muted">
      rbp, the frame pointer, is a register that holds the address of the frame&apos;s base: each local sits at a fixed
      offset below it. rsp, the stack pointer, marks the frame&apos;s bottom, the end of the stack. The canary is a random
      value the compiler puts under the return address and checks before the function returns, to catch a buffer
      overflow.
    </p>
  );
}

// ---------------------------------------------------------------- bytes

/** A char array: the string it holds, then its first bytes one by one ('\0' and '\n' marked). */
export function LineBytes({ bytes, shown = 20 }: { bytes: (number | null)[]; shown?: number }) {
  const string = textOf(cString(bytes));
  const written = bytes.some((b) => b !== null);
  if (!written) return <Unset />;
  const count = Math.min(shown, bytes.length);
  return (
    <span className="inline-flex flex-col gap-1">
      <span>&quot;{string.replace(/\n/g, "\\n")}&quot;</span>
      <span className="flex flex-wrap gap-px" aria-label="The first bytes of line">
        {bytes.slice(0, count).map((b, i) => (
          <span
            key={i}
            title={b === null ? "not written yet" : `line[${i}] = ${hex(b)}`}
            className={`grid h-[18px] min-w-[18px] place-items-center rounded-[3px] px-0.5 text-[10.5px] ${
              b === null
                ? "bg-white/[0.03] text-lab-muted/60"
                : b === 0
                  ? "bg-[#ffb35c]/15 text-[#ffb35c]"
                  : b === 0x0a
                    ? "bg-[#c0a6ff]/15 text-[#c0a6ff]"
                    : "bg-white/[0.07] text-lab-ink"
            }`}
          >
            {b === null ? "·" : b === 0 ? "\\0" : b === 0x0a ? "\\n" : b === 0x20 ? "␣" : b > 0x20 && b < 0x7f ? String.fromCharCode(b) : "•"}
          </span>
        ))}
        {bytes.length > count && <span className="self-center text-[10px] text-lab-muted">…{bytes.length - count} more</span>}
      </span>
    </span>
  );
}
