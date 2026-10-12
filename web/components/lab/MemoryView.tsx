"use client";

import { useRef } from "react";
import { HEADER, PAGE, topSize, type Chunk } from "@/lib/xray/marks/heap";
import { CALLEE, MAIN, MAPPED, RETURNS, STUDENT_SIZE, TTY_BLOCK, hex, layoutOf, type Layout } from "@/lib/xray/marks/layout";
import { CHANGE, chunkKey, userOf, type ProgramState } from "@/lib/xray/marks/program";
import { MARKS_C } from "@/lib/xray/marks/source";
import type { Program } from "@/lib/xray/types";
import { CoresView } from "./CoresView";
import { Changed, Frame, FrameGuide, LineBytes, Panel, Source, Unset, ViewHeader, useChangesInView, type Slot } from "./memoryParts";

// The Memory tab: the memory of the C program in the terminal as the trace
// goes, read like a debugger shows it. This file draws examples/marks/marks.c;
// CoresView.tsx draws examples/cores/cores.c. The source line a step is about, main()'s
// stack frame and the one below it, the heap's chunks, and where both sit in
// the address space. What the current step changed is marked. Addresses come
// from real runs (lib/xray/marks/layout.ts); ASLR changes them on every run.

interface MemoryViewProps {
  program: Program | null;
  /** The terminal is open, so a program can be typed in it. */
  terminalOpen: boolean;
  onRun: (program: "marks" | "cores") => void;
  onOpenTerminal: () => void;
}

/** The program that ran last in the terminal, or how to start one. */
export function MemoryView({ program, terminalOpen, onRun, onOpenTerminal }: MemoryViewProps) {
  if (!program) return <Empty terminalOpen={terminalOpen} onRun={onRun} onOpenTerminal={onOpenTerminal} />;
  return program.kind === "cores" ? <CoresView program={program} /> : <MarksView program={program} />;
}

const STAGE: Record<ProgramState["stage"], string> = {
  starting: "not started yet",
  running: "running",
  name: "waiting for a name",
  marks: "waiting for marks",
  again: "waiting for y or n",
  exited: "exited",
};

const STACK_KEYS = new Set<string>([
  CHANGE.line,
  CHANGE.name,
  CHANGE.marks,
  CHANGE.students,
  CHANGE.count,
  CHANGE.got,
  CHANGE.grown,
  CHANGE.printI,
  CHANGE.freeI,
  CHANGE.main,
  CHANGE.callee,
  CHANGE.calleeVars,
]);

const isHeapKey = (key: string) =>
  key.startsWith("heap:") || key.startsWith("page:") || ([CHANGE.brk, CHANGE.top, CHANGE.tcache, CHANGE.stdout, CHANGE.stdin] as string[]).includes(key);

function MarksView({ program }: { program: ProgramState }) {
  const layout = layoutOf(program.run);
  const changed = new Set(program.changed);
  const exited = program.stage === "exited";
  const box = useRef<HTMLDivElement>(null);
  useChangesInView(box, program);
  if (program.stage === "starting") {
    return (
      <div className="h-full overflow-y-auto px-3 pb-3">
        <ViewHeader command="./marks" stage={STAGE.starting} exited={false} run={program.run} />
        <p className="max-w-[60ch] text-[12.5px] leading-relaxed text-lab-muted">
          bash is about to start ./marks: there is no process yet, so no memory to show. It appears when the child
          that bash creates calls execve().
        </p>
      </div>
    );
  }

  return (
    <div ref={box} className="@container h-full overflow-y-auto px-3 pb-3">
      <ViewHeader command="./marks" stage={STAGE[program.stage]} exited={exited} run={program.run} hungUp={program.hungUp} />
      {/* One column when narrow; the source above the stack and the heap when wider; three columns when wide. */}
      <div
        className={`grid items-start gap-3 [grid-template-areas:'source'_'stack'_'heap'_'map'] @2xl:grid-cols-2 @2xl:[grid-template-areas:'source_source'_'stack_heap'_'map_map'] @5xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)] @5xl:[grid-template-areas:'source_stack_heap'_'map_stack_heap'] ${
          exited ? "grayscale" : ""
        }`}
      >
        <div className="min-w-0 [grid-area:source]">
          <Source name="marks.c" lines={MARKS_C} at={program.at} />
        </div>
        <div className="min-w-0 [grid-area:stack]">
          <Stack program={program} layout={layout} changed={changed} />
        </div>
        <div className="min-w-0 [grid-area:heap]">
          <HeapView program={program} layout={layout} changed={changed} />
        </div>
        <div className="min-w-0 [grid-area:map]">
          <AddressSpace program={program} layout={layout} changed={changed} />
        </div>
      </div>
    </div>
  );
}

const BUTTON =
  "min-h-9 rounded-md border border-signal/60 bg-signal/10 px-3 font-mono text-[13px] font-medium text-signal hover:bg-signal/20";

function Empty({ terminalOpen, onRun, onOpenTerminal }: Omit<MemoryViewProps, "program">) {
  return (
    <div className="flex h-full flex-col items-start justify-center-safe gap-3 overflow-y-auto px-5 py-4">
      <h2 className="text-lg font-semibold text-lab-ink">Inside a running program</h2>
      <p className="max-w-[60ch] text-[14px] leading-relaxed text-lab-ink/85">
        Two small C programs run in the Terminal, and this tab shows what they do with memory at every step
        of their traces, next to the line of C that did it.
      </p>
      <ul className="flex max-w-[60ch] flex-col gap-2 text-[13.5px] leading-relaxed text-lab-ink/85">
        <li>
          <span className="font-mono text-signal">./marks</span> asks for students&apos; names and marks, and
          keeps them on its stack and its heap: frames, chunks, strdup() and realloc().
        </li>
        <li>
          <span className="font-mono text-signal">./cores</span> adds up a million marks with up to four threads,
          which the kernel runs on different cores at the same time: a stack each, one shared array.
        </li>
      </ul>
      <div className="flex flex-wrap gap-2">
        {terminalOpen ? (
          (["marks", "cores"] as const).map((name) => (
            <button key={name} type="button" onClick={() => onRun(name)} className={BUTTON}>
              Run ./{name}
            </button>
          ))
        ) : (
          <button type="button" onClick={onOpenTerminal} className={BUTTON}>
            Open the Terminal
          </button>
        )}
      </div>
      {!terminalOpen && <p className="text-[12px] text-lab-muted">Then type ./marks or ./cores in it, or come back here.</p>}
      <p className="max-w-[60ch] text-[12px] leading-relaxed text-lab-muted">
        The programs are in <span className="font-mono">examples/</span> in the repository: build them with make on
        any Linux machine and watch them for real with strace and gdb.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- address space

function AddressSpace({ program, layout, changed }: { program: ProgramState; layout: Layout; changed: Set<string> }) {
  const stack = [...changed].some((k) => STACK_KEYS.has(k));
  const heap = [...changed].some(isHeapKey);
  const size = program.heap.size;
  const regions = [
    { name: "[stack]", range: `${hex(layout.stack[0])} – ${hex(layout.stack[1])}`, note: "grows down", lit: stack },
    { name: "ld-linux-x86-64.so.2", range: `${hex(layout.ld)} – ${hex(layout.ld + MAPPED.ld)}`, note: "the dynamic linker", lit: false },
    { name: "libc.so.6", range: `${hex(layout.libc)} – ${hex(layout.libc + MAPPED.libc)}`, note: "the C library", lit: false },
    {
      name: "[heap]",
      range: size > 0 ? `${hex(layout.heap)} – ${hex(layout.heap + size)}` : `none yet: the break is at ${hex(layout.heap)}`,
      note: size > 0 ? `grows up · ${program.pages.length} of ${size / PAGE} pages in RAM` : "",
      lit: heap,
    },
    { name: "marks", range: `${hex(layout.exe)} – ${hex(layout.exe + MAPPED.exe)}`, note: "the program: code and data", lit: false },
  ];
  return (
    <section aria-label="Address space" className="rounded-lg border border-lab-line bg-lab-panel2/60">
      <h3 className="border-b border-lab-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-lab-muted">
        Address space <span className="normal-case tracking-normal">· high addresses first</span>
      </h3>
      <ol className="flex flex-col gap-px p-1.5">
        {regions.map((r) => (
          <li
            key={r.name}
            className={`grid grid-cols-[auto_1fr] items-baseline gap-x-2 rounded px-1.5 py-1 ${
              r.lit ? "bg-signal/12 ring-1 ring-signal/50" : ""
            }`}
          >
            <span className={`font-mono text-[11.5px] ${r.lit ? "text-signal" : "text-lab-ink/90"}`}>{r.name}</span>
            <span className="truncate text-right font-mono text-[10.5px] text-lab-muted">{r.range}</span>
            {r.note && <span className="col-span-2 text-[11px] text-lab-muted">{r.note}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- stack

function pointerTo(layout: Layout, program: ProgramState, offset: number | null): React.ReactNode {
  if (offset === null) return <Unset />;
  if (offset === 0) return <span className="text-lab-ink/90">NULL</span>;
  const chunk = offset - HEADER;
  const name = program.names[chunk];
  return (
    <>
      {hex(layout.heap + offset)}
      <span className="text-lab-muted">
        {" "}
        → heap{name !== undefined && program.heap.chunks.some((c) => c.at === chunk && c.tag === "name" && c.state === "used") ? ` · "${name}"` : ""}
      </span>
    </>
  );
}

function Stack({ program, layout, changed }: { program: ProgramState; layout: Layout; changed: Set<string> }) {
  if (!program.inMain) {
    return (
      <Panel title="Stack" sub="grows down ↓" lit={changed.has(CHANGE.main)}>
        <p className="px-2.5 py-2 text-[12.5px] text-lab-muted">
          {program.at > 0
            ? "main() has returned: no frame is left."
            : "main() has not started yet: the stack holds the program's arguments, its environment and the C library's start-up frames."}
        </p>
      </Panel>
    );
  }
  const { s } = program;
  const mainSlots: Slot[] = [
    { offset: MAIN.ret, name: "return address", value: hex(layout.libc + RETURNS.main), note: "into the C library" },
    { offset: MAIN.savedRbp, name: "saved rbp", value: <span className="text-lab-muted">the caller&apos;s</span> },
    { offset: MAIN.canary, name: "canary", value: <span className="text-lab-muted">random, low byte 00</span> },
    { key: CHANGE.line, offset: MAIN.line, name: "char line[64]", value: <LineBytes bytes={program.line} /> },
    { key: CHANGE.marks, offset: MAIN.s + 8, name: "s.marks[3]", value: <Ints values={s.marks} /> },
    { key: CHANGE.name, offset: MAIN.s, name: "s.name", value: pointerTo(layout, program, s.name) },
    { key: CHANGE.grown, offset: MAIN.grown, name: "grown", value: pointerTo(layout, program, program.grown) },
    ...(program.printI !== null ? [{ key: CHANGE.printI, offset: MAIN.printI, name: "i (printing)", value: String(program.printI) }] : []),
    ...(program.freeI !== null ? [{ key: CHANGE.freeI, offset: MAIN.freeI, name: "i (freeing)", value: String(program.freeI) }] : []),
    { key: CHANGE.count, offset: MAIN.count, name: "count", value: String(program.count) },
    { key: CHANGE.students, offset: MAIN.students, name: "students", value: pointerTo(layout, program, program.students) },
    { key: CHANGE.got, offset: MAIN.got, name: "got", value: program.got === null ? <Unset /> : String(program.got) },
  ];
  const callee = program.callee;
  const calleeRbp = layout.rbp + CALLEE.rbp;
  const lineAddress = hex(layout.rbp + MAIN.line);
  return (
    <Panel title="Stack" sub="grows down ↓" lit={[...changed].some((k) => STACK_KEYS.has(k))}>
      <Frame
        title="main()"
        detail={`${MAIN.size} bytes below rbp = ${hex(layout.rbp)}`}
        lit={changed.has(CHANGE.main)}
        slots={mainSlots}
        changed={changed}
      />
      {callee?.fn === "read_marks" && (
        <Frame
          title="read_marks()"
          detail={`${CALLEE.readMarks.size} bytes below rbp = ${hex(calleeRbp)}`}
          lit={changed.has(CHANGE.callee)}
          changed={changed}
          slots={[
            { offset: 0x8, name: "return address", value: hex(layout.exe + RETURNS.readMarks), note: "back into main()" },
            { offset: 0, name: "saved rbp", value: hex(layout.rbp), note: "main()'s" },
            { key: CHANGE.calleeVars, offset: CALLEE.readMarks.i, name: "i", value: callee.i === null ? <Unset /> : String(callee.i) },
            { offset: CALLEE.readMarks.line, name: "line", value: lineAddress, note: "→ main()'s line[]" },
            { offset: CALLEE.readMarks.lineSize, name: "size", value: "64" },
            { offset: CALLEE.readMarks.marks, name: "marks", value: hex(layout.rbp + MAIN.s + 8), note: "→ main()'s s.marks" },
          ]}
        />
      )}
      {callee?.fn === "average" && (
        <Frame
          title="average()"
          detail={`rsp stays at rbp = ${hex(calleeRbp)}: its locals are in the red zone below it`}
          lit={changed.has(CHANGE.callee)}
          changed={changed}
          slots={[
            { offset: 0x8, name: "return address", value: hex(layout.exe + RETURNS.average), note: "back into main()" },
            { offset: 0, name: "saved rbp", value: hex(layout.rbp), note: "main()'s" },
            { key: CHANGE.callee, offset: CALLEE.average.i, name: "i", value: callee.i === null ? <Unset /> : String(callee.i) },
            { key: CHANGE.callee, offset: CALLEE.average.sum, name: "sum", value: callee.sum === null ? <Unset /> : String(callee.sum) },
            {
              offset: CALLEE.average.marks,
              name: "marks",
              value: hex(layout.heap + program.students + callee.student * STUDENT_SIZE + 8),
              note: `→ students[${callee.student}].marks, on the heap`,
            },
            { offset: CALLEE.average.n, name: "n", value: "3" },
          ]}
        />
      )}
      <FrameGuide />
    </Panel>
  );
}

function Ints({ values }: { values: (number | null)[] }) {
  return (
    <span>
      {"{ "}
      {values.map((v, i) => (
        <span key={i}>
          {i > 0 && ", "}
          {v === null ? <Unset /> : v}
        </span>
      ))}
      {" }"}
    </span>
  );
}

// ---------------------------------------------------------------- heap

const STATE_LABEL: Record<Chunk["state"], string> = {
  used: "in use",
  tcache: "free · tcache",
  fastbin: "free · fastbin",
  bin: "free · bin",
};

function HeapView({ program, layout, changed }: { program: ProgramState; layout: Layout; changed: Set<string> }) {
  const { heap } = program;
  const lit = [...changed].some(isHeapKey);
  if (heap.size === 0) {
    return (
      <Panel title="Heap" sub="grows up ↑" lit={lit}>
        <p className="px-2.5 py-2 text-[12.5px] text-lab-muted">
          No heap yet. The first malloc() will ask the kernel for one with brk().
        </p>
      </Panel>
    );
  }
  // Who points at each chunk: main()'s variables and the array's names.
  const pointers = new Map<number, string[]>();
  const point = (offset: number | null, label: string) => {
    if (offset === null || offset === 0) return;
    const at = offset - HEADER;
    pointers.set(at, [...(pointers.get(at) ?? []), label]);
  };
  point(program.s.name, "s.name");
  point(program.students, "students");
  if (program.grown !== program.students) point(program.grown, "grown");
  program.list.forEach((st, i) => point(st.name, `students[${i}].name`));
  const tcache = Object.entries(heap.tcache)
    .filter(([, list]) => list.length > 0)
    .map(([size, list]) => `${hex(Number(size))} ×${list.length}`);

  return (
    <Panel
      title="Heap"
      sub={`grows up ↑ · starts at ${hex(layout.heap)} · ${hex(heap.size)} bytes from brk()`}
      lit={lit}
    >
      <ol className="flex flex-col gap-px p-1.5">
        {heap.chunks.map((chunk) => (
          <ChunkRow
            key={chunk.at}
            chunk={chunk}
            program={program}
            pointers={pointers.get(chunk.at) ?? []}
            hot={
              changed.has(chunkKey(chunk.at)) ||
              (chunk.tag === "stdout" && changed.has(CHANGE.stdout)) ||
              (chunk.tag === "stdin" && changed.has(CHANGE.stdin)) ||
              (chunk.tag === "tcache" && changed.has(CHANGE.tcache))
            }
          />
        ))}
        <li
          data-changed={changed.has(CHANGE.top) || changed.has(CHANGE.brk) || undefined}
          className={`grid grid-cols-[4.6rem_3.4rem_minmax(0,1fr)] items-baseline gap-x-2 rounded px-1 py-[3px] ${
            changed.has(CHANGE.top) || changed.has(CHANGE.brk) ? "bg-signal/12 ring-1 ring-signal/50" : ""
          }`}
        >
          <span className="font-mono text-[10.5px] text-lab-muted">+{hex(heap.top)}</span>
          <span className="font-mono text-[11px] text-lab-muted">{hex(topSize(heap))}</span>
          <span className="font-mono text-[11.5px] text-lab-ink/70">
            top chunk <span className="text-lab-muted">· free, for later chunks</span>
            {(changed.has(CHANGE.top) || changed.has(CHANGE.brk)) && <Changed />}
          </span>
        </li>
      </ol>
      <p className="border-t border-lab-line px-2.5 py-1.5 text-[11px] text-lab-muted">
        Offsets from the heap&apos;s start; each chunk begins with a 16-byte header, and pointers point just past
        it. {program.pages.length} of {heap.size / PAGE} pages have RAM behind them
        {[...changed].some((k) => k.startsWith("page:")) && <span className="text-signal"> (one just arrived)</span>}.
        {tcache.length > 0 && <> tcache lists: {tcache.join(", ")}.</>}
      </p>
    </Panel>
  );
}

function ChunkRow({
  chunk,
  program,
  pointers,
  hot,
}: {
  chunk: Chunk;
  program: ProgramState;
  pointers: string[];
  hot: boolean;
}) {
  const free = chunk.state !== "used";
  return (
    <li
      data-changed={hot || undefined}
      className={`grid grid-cols-[4.6rem_3.4rem_minmax(0,1fr)] items-baseline gap-x-2 rounded px-1 py-[3px] ${
        hot ? "bg-signal/12 ring-1 ring-signal/50" : ""
      }`}
    >
      <span className="font-mono text-[10.5px] text-lab-muted" title={`Chunk header at heap + ${hex(chunk.at)}`}>
        +{hex(chunk.at)}
      </span>
      <span className="font-mono text-[11px] text-lab-ink/80" title={`${chunk.size} bytes`}>
        {hex(chunk.size)}
      </span>
      <span className={`min-w-0 break-words font-mono text-[11.5px] ${free ? "text-lab-muted" : "text-lab-ink/90"}`}>
        {free ? (
          <>
            <span className="rounded bg-white/[0.06] px-1 text-[10.5px]">{STATE_LABEL[chunk.state]}</span>{" "}
            was {describe(chunk, program, true)}
          </>
        ) : (
          describe(chunk, program, false)
        )}
        {pointers.length > 0 && (
          <span className={free ? "text-lab-muted" : "text-[#c0a6ff]"}>
            {" "}
            ← {pointers.join(", ")}
            {free && " (dangling: the chunk is free)"}
          </span>
        )}
        {hot && <Changed />}
      </span>
    </li>
  );
}

/** What a chunk holds, in words. */
function describe(chunk: Chunk, program: ProgramState, freed: boolean): React.ReactNode {
  switch (chunk.tag) {
    case "tcache":
      return "glibc's tcache: a list head and a count per chunk size";
    case "stdout":
      return (
        <>
          stdout&apos;s buffer, {TTY_BLOCK} bytes
          <span className="text-lab-muted">
            {program.out ? ` · waiting to be written: "${program.out}"` : " · empty: all written"}
          </span>
        </>
      );
    case "stdin":
      return (
        <>
          stdin&apos;s buffer, {TTY_BLOCK} bytes
          {program.inbuf && <span className="text-lab-muted"> · last read: &quot;{program.inbuf.replace(/\n/g, "\\n")}&quot;</span>}
        </>
      );
    case "name": {
      const name = program.names[chunk.at] ?? "";
      return freed ? `a name` : <>&quot;{name}&quot; and its \0</>;
    }
    case "students": {
      if (freed) return "the students array";
      const isArray = program.students === userOf(chunk.at);
      if (!isArray) return "the students array";
      return (
        <>
          the students array, {program.count} × {STUDENT_SIZE} bytes
          <span className="text-lab-muted">
            {program.list.length > 0 &&
              ` · ${program.list
                .map((st) => `{${program.names[st.name - HEADER] ?? "?"}, ${st.marks.join(" ")}}`)
                .join(" ")}`}
          </span>
        </>
      );
    }
    default:
      return "free space";
  }
}
