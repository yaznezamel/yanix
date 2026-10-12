"use client";

import { AnimatePresence, motion } from "motion/react";
import { Fragment, useRef } from "react";
import { whereIs } from "@/lib/hardware/activity";
import { TREE, lineage } from "@/lib/hardware/tree";
import { NODES } from "@/lib/xray/nodes";
import { dataOf } from "@/lib/xray/packets";
import type { CodeRef, NodeId, Step } from "@/lib/xray/types";
import { CORES_C } from "@/lib/xray/cores/source";
import { MARKS_C, codeAt } from "@/lib/xray/marks/source";
import { Glossed } from "./glossary";
import { MoreButton, MoreFade, useMoreCue } from "./moreCue";
import { AwsCard, shortService } from "./PacketPanel";
import { LAYER_HEX, LAYER_NAME, PHASE_NAME, TIMESCALE } from "./palette";

interface NarrationProps {
  step: Step | null;
  next: Step | null;
  position: { index: number; total: number } | null;
  scenarioTitle: string | null;
  /** The stop of the step's route the signal has reached, as the map numbers them (from 0). */
  reached: number;
  selected: NodeId | null;
  onCloseInspector: () => void;
  /** Switch to the hardware view and fly to where a box of the map is in the hardware. */
  onShowInHardware: (id: NodeId) => void;
  /** Reading on (More, or a chip that jumps to a sentence) pauses the trace, so it does not move on mid-sentence. */
  onRead: () => void;
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
  reached,
  selected,
  onCloseInspector,
  onShowInHardware,
  onRead,
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
    <StepStory
      step={step}
      next={next}
      position={position}
      scenarioTitle={scenarioTitle}
      reached={reached}
      onRead={onRead}
    />
  );
}

/**
 * Where the signal is on the step's route, numbered as on the map: the stop
 * before, the stop it is at and the next, on one line that never scrolls.
 * The map shows the whole route.
 */
function RouteLine({ path, reached }: { path: NodeId[]; reached: number }) {
  if (path.length < 2) return null;
  const at = Math.min(reached, path.length - 1);
  const shown = [at - 1, at, at + 1].filter((i) => i >= 0 && i < path.length);
  return (
    <>
      <p className="sr-only">
        Route: {path.map((id, i) => `${i + 1}, ${NODES[id].label}`).join("; ")}.
      </p>
      <div aria-hidden className="flex min-w-0 shrink-0 items-center gap-1 text-[11.5px] leading-none">
        {shown.map((i, k) => {
          const state = i < at ? "done" : i === at ? "current" : "ahead";
          return (
            <Fragment key={i}>
              {k > 0 && <span className={state === "ahead" ? "text-lab-muted/60" : "text-signal/70"}>→</span>}
              <span
                className={`flex min-w-0 items-center gap-1 rounded-full py-0.5 pr-1.5 pl-0.5 ${
                  state === "current"
                    ? "shrink-0 bg-signal/15 text-lab-ink ring-1 ring-signal"
                    : state === "done"
                      ? "text-lab-ink/80"
                      : "text-lab-muted"
                }`}
              >
                <span
                  className={`grid size-[18px] shrink-0 place-items-center rounded-full font-mono text-[10.5px] font-bold ${
                    state === "current"
                      ? "bg-signal text-[#03141a]"
                      : state === "done"
                        ? "bg-[#0c3540] text-signal"
                        : "border border-white/35 text-lab-ink/75"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="truncate">{NODES[path[i]!].label}</span>
              </span>
            </Fragment>
          );
        })}
        <span className="ml-auto shrink-0 pl-1 font-mono text-[10.5px] text-lab-muted">{path.length} stops</span>
      </div>
    </>
  );
}

/**
 * The step's figures at a glance, for a step whose packets fill the panel
 * beside the story: how much it moves, and where AWS does the same. Each chip
 * jumps to its full sentence, below the step's text.
 */
function Facts({
  amount,
  service,
  onData,
  onAws,
}: {
  amount: string | null;
  service: string | null;
  onData: () => void;
  onAws: () => void;
}) {
  return (
    <>
      {amount && (
        <button
          type="button"
          onClick={onData}
          title="How much data this step moves"
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-signal/30 bg-signal/[0.06] py-0.5 pr-2 pl-0.5 font-sans text-[11.5px] leading-none hover:border-signal/70"
        >
          <span className="rounded-full bg-signal/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-signal">
            Data
          </span>
          <span className="font-mono font-semibold text-lab-ink">{amount}</span>
        </button>
      )}
      {service && (
        <button
          type="button"
          onClick={onAws}
          title={`On AWS: ${service}`}
          // Rather than shrink to a few letters, the chip moves to a line of its own.
          className="flex max-w-full shrink-0 items-center gap-1.5 rounded-full border border-[#ff9900]/35 bg-[#ff9900]/[0.06] py-0.5 pr-2 pl-0.5 font-sans text-[11.5px] leading-none hover:border-[#ff9900]/70"
        >
          <span className="shrink-0 rounded-full bg-[#ff9900]/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#ffb547]">
            AWS
          </span>
          <span className="truncate font-semibold text-[#ffd08a]">{shortService(service)}</span>
        </button>
      )}
    </>
  );
}

function Intro() {
  const { watch, more, scrollDown } = useMoreCue();
  return (
    <section aria-label="Story" className="flex h-full min-h-0 flex-col gap-2 p-4">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={watch} className="flex min-h-0 flex-1 flex-col justify-center-safe gap-2.5 overflow-y-auto">
          <h2 className="text-lg font-semibold text-lab-ink">Use the computer, watch the machine</h2>
          <p className="text-[14px] leading-relaxed text-lab-ink/80">
            Use it like any computer: search the web in <strong className="text-lab-ink">Chromium</strong>,
            open notes.txt in the <strong className="text-lab-ink">Text Editor</strong>, play a sound in{" "}
            <strong className="text-lab-ink">Videos</strong>, type, copy and paste, or run the small C
            programs <strong className="font-mono text-lab-ink">./marks</strong> and{" "}
            <strong className="font-mono text-lab-ink">./cores</strong> in the{" "}
            <strong className="text-lab-ink">Terminal</strong>. Or shut it down and start it again from the
            Start menu.
          </p>
          <p className="text-[12.5px] leading-relaxed text-lab-muted">
            Every action is traced from your screen through the kernel and the hardware. Next to the
            screen, <strong className="font-medium text-lab-ink/90">Software path</strong> shows the code
            each step runs through, stop by numbered stop, and{" "}
            <strong className="font-medium text-lab-ink/90">Hardware</strong> shows the parts of the computer
            it uses: zoom into the CPU to see its cores.{" "}
            <strong className="font-medium text-lab-ink/90">Memory</strong> shows a C program&apos;s stack, heap
            and threads as it runs. Each step says how much data it moves and, where it fits, how AWS does
            the same. Click any box to learn what it is. The steps are scripted for teaching, not traced
            live, and simplified: wired Ethernet, IPv4, one example of each program.
          </p>
        </div>
        {more && <MoreFade />}
      </div>
      {more && (
        <div className="flex shrink-0 justify-end">
          <MoreButton onMore={scrollDown} />
        </div>
      )}
    </section>
  );
}

/**
 * One step of the story. Its title and where the signal is stay put; the
 * text scrolls under them, with a cue when there is more to read.
 */
function StepStory({
  step,
  next,
  position,
  scenarioTitle,
  reached,
  onRead,
}: {
  step: Step;
  next: Step | null;
  position: { index: number; total: number };
  scenarioTitle: string | null;
  reached: number;
  onRead: () => void;
}) {
  // The scrolling text is a new element for every step; the cue follows it.
  const { watch, more, scrollDown, reveal } = useMoreCue();
  const dataLine = useRef<HTMLParagraphElement>(null);
  const awsCard = useRef<HTMLDivElement>(null);
  const layers = Array.from(new Set(step.path.map((id) => NODES[id].layer)));
  const data = dataOf(step);
  // With packets in flight the panel beside the story shows them, so the
  // step's data line and AWS note sit below its text: name them up front.
  // Without, that panel shows the data and the AWS note itself.
  const withPackets = (step.frames?.length ?? 0) > 0;
  const facts = withPackets && (data !== null || step.aws !== undefined);
  // A step of ./marks: the line of C it is about.
  const program = step.ui?.program;
  const code = program && program.stage !== "exited" ? codeAt(program.kind === "cores" ? CORES_C : MARKS_C, program.at) : null;
  const file = program?.kind === "cores" ? "cores.c" : "marks.c";

  return (
    <section aria-label="Story" aria-live="polite" className="flex h-full min-h-0 flex-col gap-2.5 p-4">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 font-mono text-[11px] text-lab-muted">
        <span className="shrink-0 rounded bg-signal/15 px-2 py-0.5 uppercase tracking-[0.12em] text-signal">
          {PHASE_NAME[step.phase]}
        </span>
        <span className="shrink-0" title={`Step ${position.index + 1} of ${position.total}`}>
          <span className="sr-only">Step </span>
          {position.index + 1}/{position.total}
        </span>
        {facts ? (
          <Facts
            amount={data?.amount ?? null}
            service={withPackets ? (step.aws?.service ?? null) : null}
            onData={() => {
              onRead();
              reveal(dataLine.current);
            }}
            onAws={() => {
              onRead();
              reveal(awsCard.current);
            }}
          />
        ) : (
          <span className="min-w-0 truncate" title={scenarioTitle ?? undefined}>
            · {scenarioTitle}
          </span>
        )}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
          className="flex min-h-0 flex-1 flex-col gap-2.5"
        >
          <h2 className="shrink-0 text-xl font-semibold leading-tight text-lab-ink [text-wrap:balance]">
            {step.title}
          </h2>
          <RouteLine path={step.path} reached={reached} />
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div ref={watch} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
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
              {code && (
                <p className="flex min-w-0 shrink-0 items-baseline gap-2 rounded-md border border-lab-line bg-lab-panel2 px-2.5 py-1.5 font-mono text-[12px]">
                  <span className="shrink-0 text-lab-muted">
                    {file}:{program?.at}
                  </span>
                  <span className="min-w-0 truncate text-lab-ink" title={code}>
                    {code}
                  </span>
                </p>
              )}
              {/* No ligatures: C's -> must not turn into an arrow. */}
              <p className="text-[14px] leading-relaxed text-lab-ink/85 [font-variant-ligatures:none] [font-feature-settings:'calt'_0]">
                <Glossed text={step.body} />
              </p>
              {data && withPackets && (
                <p
                  ref={dataLine}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border border-signal/25 bg-signal/[0.05] px-2.5 py-1.5"
                >
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-signal">Data</span>
                  <span className="font-mono text-[14px] font-semibold text-lab-ink">{data.amount}</span>
                  <span className="text-[12.5px] leading-snug text-lab-ink/80">
                    <Glossed text={data.what} />
                  </span>
                </p>
              )}
              {/* A step with packets keeps the panel beside the story for them: its AWS note goes here. */}
              {step.aws && withPackets && (
                <div ref={awsCard}>
                  <AwsCard aws={step.aws} />
                </div>
              )}
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
            </div>
            {more && <MoreFade />}
          </div>
        </motion.div>
      </AnimatePresence>
      {(next || more) && (
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {next && (
            <p className="min-w-0 flex-1 truncate text-[12px] text-lab-muted">
              Next: <span className="text-lab-ink/70">{next.title}</span>
            </p>
          )}
          {more && (
            <span className="ml-auto">
              <MoreButton
                onMore={() => {
                  onRead();
                  scrollDown();
                }}
              />
            </span>
          )}
        </div>
      )}
    </section>
  );
}
