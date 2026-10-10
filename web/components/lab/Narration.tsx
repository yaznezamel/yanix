"use client";

import { AnimatePresence, motion } from "motion/react";
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
}: NarrationProps) {
  if (selected) {
    const node = NODES[selected];
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

  if (!step || !position) {
    return (
      <section
        aria-label="Story"
        className="flex h-full flex-col justify-center-safe gap-2.5 overflow-y-auto p-4"
      >
        <h2 className="text-lg font-semibold text-lab-ink">Use the computer, watch the machine</h2>
        <p className="text-[14px] leading-relaxed text-lab-ink/80">
          Use it like any computer: search the web in <strong className="text-lab-ink">Chromium</strong>,
          open notes.txt in the <strong className="text-lab-ink">Text Editor</strong>, play a sound in{" "}
          <strong className="text-lab-ink">Videos</strong>, type, copy and paste. Or shut it down and
          start it again from the Start menu.
        </p>
        <p className="text-[12.5px] leading-relaxed text-lab-muted">
          Every action is traced from your screen through the kernel and the hardware. Click any box
          in the machine view to see what it is. The steps are scripted for teaching, not traced
          live, and simplified: wired Ethernet, IPv4, one example of each program.
        </p>
      </section>
    );
  }

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
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step.id}
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
      {next && (
        <p className="mt-auto shrink-0 truncate text-[12px] text-lab-muted">
          Next: <span className="text-lab-ink/70">{next.title}</span>
        </p>
      )}
    </section>
  );
}
