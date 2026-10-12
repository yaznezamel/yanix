"use client";

import { useRef } from "react";
import {
  ADD_UP,
  ADD_UP_RBP,
  ARRAY_MAP,
  ARRAY_PAGES,
  CORES_MAIN,
  CORES_RETURNS,
  DESCRIPTOR,
  GUARD,
  SLICE,
  arrayMapping,
  coresLayoutOf,
  stackMapping,
  type CoresLayout,
} from "@/lib/xray/cores/layout";
import {
  CORES_CHANGE,
  coreKey,
  idKey,
  sliceKey,
  stackKey,
  threadKey,
  type CoresState,
  type ThreadState,
  type Worker,
} from "@/lib/xray/cores/program";
import { CORES_C } from "@/lib/xray/cores/source";
import {
  Changed,
  Frame,
  FrameGuide,
  LineBytes,
  Panel,
  Source,
  Unset,
  ViewHeader,
  hex,
  useChangesInView,
  type Slot,
} from "./memoryParts";

// The Memory tab for examples/cores/cores.c: what each core runs, each thread
// with its own stack and add_up() frame, main()'s frame with the ids[] and
// slices[] the threads share, and where all of it sits in the address space.
// Which core runs what is the lab's model of the scheduler (lib/xray/cores);
// the addresses come from real runs.

const STAGE: Record<CoresState["stage"], string> = {
  starting: "not started yet",
  running: "running",
  threads: "waiting for a number of threads",
  exited: "exited",
};

const STATE: Record<ThreadState, string> = {
  new: "being created",
  queued: "waiting for a core",
  running: "running add_up()",
  done: "finished",
  joined: "finished and joined",
};

export function CoresView({ program }: { program: CoresState }) {
  const layout = coresLayoutOf(program.run);
  const changed = new Set(program.changed);
  const exited = program.stage === "exited";
  const box = useRef<HTMLDivElement>(null);
  useChangesInView(box, program);
  if (program.stage === "starting") {
    return (
      <div className="h-full overflow-y-auto px-3 pb-3">
        <ViewHeader command="./cores" stage={STAGE.starting} exited={false} run={program.run} />
        <p className="max-w-[60ch] text-[12.5px] leading-relaxed text-lab-muted">
          bash is about to start ./cores: there is no process yet, so no memory to show. It appears when the child
          that bash creates calls execve().
        </p>
      </div>
    );
  }
  return (
    <div ref={box} className="@container h-full overflow-y-auto px-3 pb-3">
      <ViewHeader command="./cores" stage={STAGE[program.stage]} exited={exited} run={program.run} hungUp={program.hungUp} />
      {/* One column when narrow; the cores across the top when wider; then the threads and main() side by side. */}
      <div
        className={`grid items-start gap-3 [grid-template-areas:'cores'_'source'_'threads'_'main'_'map'] @2xl:grid-cols-2 @2xl:[grid-template-areas:'cores_cores'_'source_source'_'threads_main'_'map_map'] @5xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)] @5xl:[grid-template-areas:'cores_cores_cores'_'source_threads_main'_'map_threads_main'] ${
          exited ? "grayscale" : ""
        }`}
      >
        <div className="min-w-0 [grid-area:cores]">
          <Cores program={program} changed={changed} />
        </div>
        <div className="min-w-0 [grid-area:source]">
          <Source name="cores.c" lines={CORES_C} at={program.at} />
        </div>
        <div className="min-w-0 [grid-area:threads]">
          <Threads program={program} layout={layout} changed={changed} />
        </div>
        <div className="min-w-0 [grid-area:main]">
          <MainFrame program={program} layout={layout} changed={changed} />
        </div>
        <div className="min-w-0 [grid-area:map]">
          <AddressSpace program={program} layout={layout} changed={changed} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- cores

function Cores({ program, changed }: { program: CoresState; changed: Set<string> }) {
  const lit = changed.has(CORES_CHANGE.cores);
  const worker = (n: number) => program.workers.find((w) => w.n === n);
  // Once the process is gone, none of its threads runs anywhere.
  const cores = program.stage === "exited" ? program.cores.map(() => ({ running: null, queued: null })) : program.cores;
  return (
    <Panel title="Cores" sub="what each core runs of this program: the kernel decides" lit={lit}>
      <ol className="grid grid-cols-2 gap-1.5 p-1.5 @lg:grid-cols-4">
        {cores.map((core, i) => {
          const running = core.running;
          const hot = changed.has(coreKey(i)) || (typeof running === "number" && changed.has(threadKey(running)));
          const busy = running !== null;
          const w = typeof running === "number" ? worker(running) : undefined;
          return (
            <li
              key={i}
              data-changed={hot || undefined}
              className={`flex min-h-[4.25rem] flex-col gap-0.5 rounded-md border px-2 py-1.5 ${
                busy ? "border-signal/50 bg-signal/[0.07]" : "border-lab-line bg-white/[0.02]"
              } ${hot ? "ring-1 ring-signal/60" : ""}`}
            >
              <span className="flex items-baseline justify-between gap-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-lab-muted">
                Core {i}
                {hot && <Changed />}
              </span>
              <span className={`font-mono text-[12.5px] ${busy ? "text-lab-ink" : "text-lab-muted"}`}>
                {running === "main" ? (program.inMain ? "main()" : "start-up") : typeof running === "number" ? `thread ${running}` : "idle"}
              </span>
              <span className="text-[11px] leading-snug text-lab-muted">
                {running === "main"
                  ? program.inMain
                    ? "the process's first thread"
                    : "its first thread: ld.so and the C library, before main()"
                  : w
                    ? w.state === "running"
                      ? `add_up(): marks ${w.first}–${w.first + w.count - 1}`
                      : STATE[w.state]
                    : "nothing of ours to run"}
              </span>
              {core.queued !== null && (
                <span className="text-[11px] text-[#ffb35c]">thread {core.queued} waits in its run queue</span>
              )}
            </li>
          );
        })}
      </ol>
      {program.stage === "threads" && (
        <p className="border-t border-lab-line px-2.5 py-1.5 text-[11px] text-lab-muted">
          main() is asleep in read(), waiting for you: a sleeping thread takes no core.
        </p>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- threads

function Threads({ program, layout, changed }: { program: CoresState; layout: CoresLayout; changed: Set<string> }) {
  const lit = program.workers.some((w) => changed.has(threadKey(w.n)));
  if (program.workers.length === 0) {
    return (
      <Panel title="Threads" sub="each with its own stack" lit={false}>
        <p className="px-2.5 py-2 text-[12.5px] text-lab-muted">
          Only main() so far. Type a number of threads, and pthread_create() starts them: each gets its own stack
          and its own registers, and shares everything else.
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="Threads" sub="each with its own stack; the array is shared" lit={lit}>
      {program.workers.map((w) => (
        <ThreadRows key={w.n} worker={w} layout={layout} changed={changed} />
      ))}
    </Panel>
  );
}

function ThreadRows({ worker: w, layout, changed }: { worker: Worker; layout: CoresLayout; changed: Set<string> }) {
  const stack = stackMapping(layout, w.stack);
  const rbp = stack.top - ADD_UP_RBP;
  const hot = changed.has(threadKey(w.n));
  const slice = layout.rbp + CORES_MAIN.slices + (w.n - 1) * SLICE.size;
  const marks = `marks ${w.first}–${w.first + w.count - 1}`;

  // A joined thread is gone: one line is enough, so the threads still running stay in view.
  if (w.state === "joined") {
    return (
      <p
        data-changed={hot || undefined}
        className={`flex flex-wrap items-baseline gap-x-2 border-t border-lab-line px-2.5 py-1.5 first:border-t-0 ${hot ? "bg-signal/[0.06]" : ""}`}
      >
        <span className={`font-mono text-[12px] font-semibold ${hot ? "text-signal" : "text-lab-ink"}`}>thread {w.n}</span>
        <span className="rounded bg-white/[0.06] px-1 font-mono text-[10.5px] text-lab-ink/85">{STATE.joined}</span>
        <span className="font-mono text-[10.5px] text-lab-muted">
          core {w.core} · {marks} · sum {w.sum} · its stack kept for the next thread
        </span>
        {hot && <Changed />}
      </p>
    );
  }

  const ran = w.state !== "queued" && w.state !== "new";
  const finished = w.state === "done";
  const slots: Slot[] = [
    { offset: 0x8, name: "return address", value: hex(layout.libc + CORES_RETURNS.addUp), note: "into start_thread(), in the C library" },
    { offset: ADD_UP.slice, name: "slice", value: hex(slice), note: `→ slices[${w.n - 1}], in main()'s stack` },
    {
      key: threadKey(w.n),
      offset: ADD_UP.i,
      name: "i",
      value: finished ? String(w.first + w.count) : ran ? `${w.first} → ${w.first + w.count - 1}` : <Unset />,
      note: finished ? "the loop is over" : ran ? "counting through its part" : undefined,
    },
    {
      key: threadKey(w.n),
      offset: ADD_UP.sum,
      name: "sum",
      value: finished ? String(w.sum) : ran ? "adding up…" : <Unset />,
    },
  ];
  const where = w.state === "new" ? "no core yet" : w.state === "queued" ? `queued on core ${w.core}` : `core ${w.core}`;
  return (
    <div data-changed={hot || undefined} className={`border-t border-lab-line first:border-t-0 ${hot ? "bg-signal/[0.06]" : ""}`}>
      <p className="flex flex-wrap items-baseline gap-x-2 px-2.5 pt-1.5">
        <span className={`font-mono text-[12px] font-semibold ${hot ? "text-signal" : "text-lab-ink"}`}>thread {w.n}</span>
        <span className="rounded bg-white/[0.06] px-1 font-mono text-[10.5px] text-lab-ink/85">{STATE[w.state]}</span>
        <span className="font-mono text-[10.5px] text-lab-muted">
          {where} · {marks}
        </span>
        {hot && <Changed />}
      </p>
      <p className="px-2.5 font-mono text-[10.5px] text-lab-muted">
        stack {hex(stack.start + GUARD)}–{hex(stack.top)} · pthread_t {hex(stack.top - DESCRIPTOR)}
      </p>
      {ran ? (
        <Frame title="add_up()" detail={`${ADD_UP.size} bytes below rbp = ${hex(rbp)}`} lit={false} slots={slots} changed={changed} />
      ) : (
        <p className="px-2.5 pb-1.5 text-[11px] text-lab-muted">
          {w.state === "new"
            ? "Its stack and its descriptor are ready, but the kernel has no task for it yet: clone3() comes next."
            : "Not running yet: no add_up() frame."}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- main()

function MainFrame({ program, layout, changed }: { program: CoresState; layout: CoresLayout; changed: Set<string> }) {
  if (!program.inMain) {
    return (
      <Panel title="main()'s stack" sub="grows down ↓" lit={changed.has(CORES_CHANGE.main)}>
        <p className="px-2.5 py-2 text-[12.5px] text-lab-muted">
          {program.at > 0 ? "main() has returned: no frame is left." : "main() has not started yet."}
        </p>
      </Panel>
    );
  }
  const array = arrayMapping(layout);
  // What an earlier round left: real bytes on the stack, but not this round's.
  const old = new Set(program.stale);
  const kept = (key: string, value: React.ReactNode) => (old.has(key) ? <span className="text-lab-muted">{value}</span> : value);
  const left = (key: string, note?: string) => (old.has(key) ? `${note ? `${note}, ` : ""}left from an earlier round` : note);
  const slotOf = (t: number): Slot => {
    const slice = program.slices[t];
    const key = sliceKey(t);
    return {
      key,
      offset: CORES_MAIN.slices + t * SLICE.size,
      name: `slices[${t}]`,
      value: slice ? kept(key, `{first ${slice.first}, count ${slice.count}, sum ${slice.sum}, cpu ${slice.cpu}}`) : <Unset />,
      note: left(key),
    };
  };
  const idOf = (t: number): Slot => {
    const id = program.ids[t];
    const key = idKey(t);
    return {
      key,
      offset: CORES_MAIN.ids + t * 8,
      name: `ids[${t}]`,
      value: id ? kept(key, hex(stackMapping(layout, id.stack).top - DESCRIPTOR)) : <Unset />,
      note: id ? left(key, `thread ${id.thread}'s descriptor`) : undefined,
    };
  };
  const slots: Slot[] = [
    { offset: 0x8, name: "return address", value: hex(layout.libc + CORES_RETURNS.main), note: "into the C library" },
    { offset: 0, name: "saved rbp", value: <span className="text-lab-muted">the caller&apos;s</span> },
    { offset: CORES_MAIN.canary, name: "canary", value: <span className="text-lab-muted">random, low byte 00</span> },
    { key: CORES_CHANGE.line, offset: CORES_MAIN.line, name: "char line[16]", value: <LineBytes bytes={program.line} shown={16} /> },
    ...[3, 2, 1, 0].map(slotOf),
    ...[3, 2, 1, 0].map(idOf),
    { key: CORES_CHANGE.threads, offset: CORES_MAIN.threads, name: "threads", value: program.threads === null ? <Unset /> : String(program.threads) },
    { key: CORES_CHANGE.per, offset: CORES_MAIN.per, name: "per", value: program.per === null ? <Unset /> : String(program.per) },
    {
      key: CORES_CHANGE.marks,
      offset: CORES_MAIN.marks,
      name: "marks",
      value: program.mapped ? hex(array.pointer) : <Unset />,
      note: program.mapped ? "→ the array's own mapping" : undefined,
    },
    {
      key: CORES_CHANGE.total,
      offset: CORES_MAIN.total,
      name: "total",
      value: program.total === null ? <Unset /> : kept(CORES_CHANGE.total, String(program.total)),
      note: left(CORES_CHANGE.total),
    },
  ];
  const keys = new Set<string>([CORES_CHANGE.main, CORES_CHANGE.line, CORES_CHANGE.threads, CORES_CHANGE.per, CORES_CHANGE.marks, CORES_CHANGE.total]);
  const lit = [...changed].some((k) => keys.has(k) || k.startsWith("slices:") || k.startsWith("ids:"));
  return (
    <Panel title="main()'s stack" sub="grows down ↓ · the threads read and write slices[] here" lit={lit}>
      <Frame
        title="main()"
        detail={`${CORES_MAIN.size} bytes below rbp = ${hex(layout.rbp)}`}
        lit={changed.has(CORES_CHANGE.main)}
        slots={slots}
        changed={changed}
      />
      <FrameGuide />
    </Panel>
  );
}

// ---------------------------------------------------------------- address space

function AddressSpace({ program, layout, changed }: { program: CoresState; layout: CoresLayout; changed: Set<string> }) {
  const array = arrayMapping(layout);
  const user = (index: number) => program.workers.find((w) => w.stack === index && w.state !== "joined");
  const stacks = Array.from({ length: program.stacks }, (_, index) => {
    const m = stackMapping(layout, index);
    const w = user(index);
    return {
      name: w ? `thread ${w.n}'s stack` : "a thread stack, kept",
      range: `${hex(m.start)} – ${hex(m.top)}`,
      note: w ? "8 MiB, and a guard page under it" : "in glibc's cache, its RAM given back",
      lit: changed.has(stackKey(index)),
    };
  });
  const buffers = [
    program.out && `stdout's buffer holds "${program.out}"`,
    program.inbuf && `stdin's buffer: last read "${program.inbuf.replace(/\n/g, "\\n")}"`,
  ].filter(Boolean);
  const regions = [
    { name: "[stack]", range: `${hex(layout.stack[0])} – ${hex(layout.stack[1])}`, note: "main()'s stack", lit: changed.has(CORES_CHANGE.main) },
    { name: "libc.so.6 and ld.so", range: hex(layout.libc), note: "the C library, threads included", lit: false },
    {
      name: "the array",
      range: program.mapped ? `${hex(array.start)} – ${hex(array.start + ARRAY_MAP)}` : "not mapped",
      note: program.mapped
        ? `${ARRAY_PAGES} pages${program.filled ? ", every one with RAM behind it" : ", none with RAM yet"} · shared by every thread`
        : program.at > 0
          ? "handed back with munmap()"
          : "malloc() maps it first",
      lit: changed.has(CORES_CHANGE.array),
    },
    ...stacks,
    {
      name: "[heap]",
      range: program.heap.size > 0 ? `${hex(layout.heap)} – ${hex(layout.heap + program.heap.size)}` : "none yet",
      note: `the C library's chunks: the tcache, stdout's and stdin's buffers${buffers.length > 0 ? ` · ${buffers.join(" · ")}` : ""}`,
      lit: [CORES_CHANGE.heap, CORES_CHANGE.stdout, CORES_CHANGE.stdin].some((k) => changed.has(k)),
    },
    { name: "cores", range: hex(layout.exe), note: "the program: code and data", lit: false },
  ];
  return (
    <section aria-label="Address space" className="rounded-lg border border-lab-line bg-lab-panel2/60">
      <h3 className="border-b border-lab-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-lab-muted">
        Address space <span className="normal-case tracking-normal">· high addresses first · one for all threads</span>
      </h3>
      <ol className="flex flex-col gap-px p-1.5">
        {regions.map((r, i) => (
          <li
            key={`${r.name}-${i}`}
            data-changed={r.lit || undefined}
            className={`grid grid-cols-[auto_1fr] items-baseline gap-x-2 rounded px-1.5 py-1 ${r.lit ? "bg-signal/12 ring-1 ring-signal/50" : ""}`}
          >
            <span className={`font-mono text-[11.5px] ${r.lit ? "text-signal" : "text-lab-ink/90"}`}>{r.name}</span>
            <span className="truncate text-right font-mono text-[10.5px] text-lab-muted">{r.range}</span>
            <span className="col-span-2 break-words text-[11px] text-lab-muted">{r.note}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
