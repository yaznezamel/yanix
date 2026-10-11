"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useRef, useState } from "react";
import { whereIs } from "@/lib/hardware/activity";
import { TREE, lineage } from "@/lib/hardware/tree";
import { NODES } from "@/lib/xray/nodes";
import type { CodeRef, NodeId, Step } from "@/lib/xray/types";
import { LAYER_HEX, LAYER_NAME, PHASE_NAME, TIMESCALE } from "./palette";

interface NarrationProps {
  step: Step | null;
  next: Step | null;
  position: { index: number; total: number } | null;
  scenarioTitle: string | null;
  selected: NodeId | null;
  onCloseInspector: () => void;
  /** Switch to the hardware view and fly to where a box of the map is in the hardware. */
  onShowInHardware: (id: NodeId) => void;
}

/** Watches a scrolling text box: is there more below the fold? */
function useMoreCue() {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);
  const watch = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el;
    if (!el) return;
    const update = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 6);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, []);
  const scrollDown = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollBy({ top: el.clientHeight * 0.75, behavior: "smooth" });
  }, []);
  return { watch, more, scrollDown };
}

/** A fade and a "More" button over the bottom of a text that scrolls. */
function MoreCue({ onMore }: { onMore: () => void }) {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-lab-panel to-transparent"
      />
      <button
        type="button"
        onClick={onMore}
        className="absolute right-0 bottom-0 rounded-full border border-lab-line bg-lab-panel2 px-2.5 py-1 text-[11.5px] text-lab-ink shadow-md hover:border-white/30"
      >
        More ↓
      </button>
    </>
  );
}

function CodeChip({ code }: { code: CodeRef }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded border border-lab-line bg-black/30 px-2 py-0.5 font-mono text-[11px] text-lab-ink/85">
      <span className="text-lab-muted">{code.project}</span>
      <span className="truncate">
        {code.path}
        {code.symbol ? ` · ${code.symbol}()` : ""}
      </span>
    </span>
  );
}

export function Narration({
  step,
  next,
  position,
  scenarioTitle,
  selected,
  onCloseInspector,
  onShowInHardware,
}: NarrationProps) {
  if (selected) {
    const node = NODES[selected];
    const where = whereIs(TREE, selected);
    const names = where.parts.map((p) =>
      lineage(p)
        .slice(1)
        .map((q) => q.part.label)
        .join(" › "),
    );
    return (
      <section aria-label="Component" className="flex h-full flex-col gap-3 overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-3">
          <span
            className="rounded-full border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.1em]"
            style={{ color: LAYER_HEX[node.layer], borderColor: LAYER_HEX[node.layer] }}
          >
            {LAYER_NAME[node.layer]}
          </span>
          <button
            type="button"
            onClick={onCloseInspector}
            className="rounded px-2 py-1 text-xs text-lab-muted hover:bg-white/5 hover:text-lab-ink"
          >
            Back to the story
          </button>
        </div>
        <h2 className="text-xl font-semibold text-lab-ink">{node.label}</h2>
        {names.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-lab-line bg-black/20 px-3 py-2">
            <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-lab-ink/80">
              <span className="text-lab-muted">
                {where.how === "runs" ? "Runs on " : where.how === "held" ? "Kept in " : "In the hardware: "}
              </span>
              {names.join(" and ")}
            </p>
            <button
              type="button"
              onClick={() => onShowInHardware(selected)}
              className="min-h-8 shrink-0 rounded-md border border-signal/50 px-2.5 text-[12.5px] text-signal hover:bg-signal/10"
            >
              Show in Hardware
            </button>
          </div>
        )}
        <p className="text-[14px] leading-relaxed text-lab-ink/85">{node.about}</p>
        {node.code && (
          <div className="flex flex-wrap gap-1.5">
            {node.code.map((c) => (
              <CodeChip key={`${c.path}-${c.symbol ?? ""}`} code={c} />
            ))}
          </div>
        )}
        {node.code?.some((c) => c.project === "linux") && (
          <p className="text-[11.5px] text-lab-muted">
            Kernel paths refer to recent Linux releases; links will pin one version once the
            project picks it.
          </p>
        )}
      </section>
    );
  }

  if (!step || !position) return <Intro />;

  return (
    <StepStory step={step} next={next} position={position} scenarioTitle={scenarioTitle} />
  );
}

function Intro() {
  const { watch, more, scrollDown } = useMoreCue();
  return (
    <section aria-label="Story" className="relative flex h-full min-h-0 flex-col p-4">
      <div ref={watch} className="flex min-h-0 flex-1 flex-col justify-center-safe gap-2.5 overflow-y-auto">
        <h2 className="text-lg font-semibold text-lab-ink">Use the computer, watch the machine</h2>
        <p className="text-[14px] leading-relaxed text-lab-ink/80">
          Use it like any computer: search the web in <strong className="text-lab-ink">Chromium</strong>,
          open notes.txt in the <strong className="text-lab-ink">Text Editor</strong>, play a sound in{" "}
          <strong className="text-lab-ink">Videos</strong>, type, copy and paste. Or shut it down and
          start it again from the Start menu.
        </p>
        <p className="text-[12.5px] leading-relaxed text-lab-muted">
          Every action is traced from your screen through the kernel and the hardware. Next to the
          screen, <strong className="font-medium text-lab-ink/90">Software path</strong> shows the code
          each step runs through, and <strong className="font-medium text-lab-ink/90">Hardware</strong>{" "}
          shows the parts of the computer it uses: zoom into the CPU to see its cores. Click any box to
          learn what it is. The steps are scripted for teaching, not traced live, and simplified: wired
          Ethernet, IPv4, one example of each program.
        </p>
      </div>
      {more && (
        <div className="absolute inset-x-4 bottom-4">
          <MoreCue onMore={scrollDown} />
        </div>
      )}
    </section>
  );
}

/** One step of the story. Long steps scroll, with a cue that there is more to read. */
function StepStory({
  step,
  next,
  position,
  scenarioTitle,
}: {
  step: Step;
  next: Step | null;
  position: { index: number; total: number };
  scenarioTitle: string | null;
}) {
  // The scrolling text is a new element for every step; the cue follows it.
  const { watch, more, scrollDown } = useMoreCue();
  const layers = Array.from(new Set(step.path.map((id) => NODES[id].layer)));

  return (
    <section aria-label="Story" aria-live="polite" className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-lab-muted">
        <span className="shrink-0 rounded bg-signal/15 px-2 py-0.5 uppercase tracking-[0.12em] text-signal">
          {PHASE_NAME[step.phase]}
        </span>
        <span className="shrink-0">
          step {position.index + 1} of {position.total}
        </span>
        <span className="min-w-0 truncate" title={scenarioTitle ?? undefined}>
          · {scenarioTitle}
        </span>
      </div>
      <div className="relative flex min-h-0 flex-col">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step.id}
          ref={watch}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
          className="flex min-h-0 flex-col gap-3 overflow-y-auto"
        >
          {step.cache && (
            <div
              className={`flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium ${
                step.cache === "hit" ? "bg-[#7ee0a1]/12 text-[#7ee0a1]" : "bg-[#ffb35c]/12 text-[#ffb35c]"
              }`}
            >
              <span className="rounded bg-current/15 px-1.5 font-mono text-[11px] font-bold">
                {step.cache === "hit" ? "HIT" : "MISS"}
              </span>
              {step.cache === "hit"
                ? "In the page cache: served from RAM, the disk is never touched"
                : "Not in the page cache: this read has to go to the SSD"}
            </div>
          )}
          <h2 className="text-xl font-semibold leading-tight text-lab-ink [text-wrap:balance]">
            {step.title}
          </h2>
          <p className="text-[14px] leading-relaxed text-lab-ink/85">{step.body}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {layers.map((layer) => (
              <span
                key={layer}
                className="rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em]"
                style={{ color: LAYER_HEX[layer], borderColor: `${LAYER_HEX[layer]}80` }}
              >
                {LAYER_NAME[layer]}
              </span>
            ))}
            {step.timescale && (
              <span
                className="rounded-full border border-white/15 px-2 py-0.5 font-mono text-[10.5px] text-lab-ink/80"
                title={`${TIMESCALE[step.timescale].hint}. Order of magnitude only; real timings vary.`}
              >
                ≈ {TIMESCALE[step.timescale].label}
              </span>
            )}
          </div>
          {step.code && step.code.length > 0 && (
            <p
              className="line-clamp-2 font-mono text-[11px] leading-relaxed text-lab-ink/70"
              title={step.code.map((c) => `${c.project}: ${c.path}${c.symbol ? ` ${c.symbol}()` : ""}`).join("\n")}
            >
              <span className="text-lab-muted">source </span>
              {step.code.map((c, i) => (
                <span key={`${c.project}-${c.path}-${c.symbol ?? ""}`}>
                  {i > 0 && <span className="text-lab-muted"> · </span>}
                  <span className="text-lab-muted">{c.project}/</span>
                  {c.path}
                  {c.symbol && <span className="text-signal/80"> {c.symbol}()</span>}
                </span>
              ))}
            </p>
          )}
        </motion.div>
      </AnimatePresence>
      {more && <MoreCue onMore={scrollDown} />}
      </div>
      {next && (
        <p className="mt-auto shrink-0 truncate text-[12px] text-lab-muted">
          Next: <span className="text-lab-ink/70">{next.title}</span>
        </p>
      )}
    </section>
  );
}
