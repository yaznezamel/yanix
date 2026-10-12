import { NO_HEAP, type Heap } from "../marks/heap";
import { bytesOf, scanInts } from "../marks/program";
import { MARKS, MAX_THREADS } from "./layout";

// The state of examples/cores/cores.c while it runs in the lab: main()'s
// locals, this round's threads, the stacks glibc made for them, and which
// core runs what. Each step of a trace carries a copy, as for ./marks.
//
// Where threads run is the lab's model of the scheduler, not a measurement:
// a new thread goes to an idle core, the lowest-numbered first, or waits in
// the run queue of main()'s core when every core is busy; a thread that
// wakes up gets its last core back if it is idle, else an idle one. The real
// kernel weighs much more (load, caches, power), and the real program prints
// where each thread finished, which changes from run to run.

/** Not started yet (bash is about to run it), running, blocked in fgets() for a number, or gone. */
export type CoresStage = "starting" | "running" | "threads" | "exited";

/**
 * Where a thread is: being created (glibc has its stack and descriptor, the
 * kernel has no task yet), waiting for a core, running add_up(), finished, or
 * joined by main().
 */
export type ThreadState = "new" | "queued" | "running" | "done" | "joined";

export interface Worker {
  /** 1 to 4: the order main() created them in, as the program numbers them. */
  n: number;
  first: number;
  count: number;
  state: ThreadState;
  /** The core the scheduler placed it on: it runs, and finishes, there. Not placed yet while new. */
  core: number;
  /** Which of glibc's stack mappings it uses (0 is the first ever made). */
  stack: number;
  /** It found every core busy when it was created, so it started late. */
  late: boolean;
  /** add_up()'s result, once it has finished. */
  sum: number | null;
}

/**
 * slices[t] in main()'s frame. The compound literal that main() assigns
 * names marks, first and count; C zeroes the members it does not name, so
 * sum and cpu are 0 until the thread writes its result.
 */
export interface SliceValue {
  first: number;
  count: number;
  sum: number;
  cpu: number;
}

/** ids[t]: the pthread_t that pthread_create() stored, the address of the thread's descriptor. */
export interface IdValue {
  /** The thread it named, and the stack mapping its descriptor sits at the top of. */
  thread: number;
  stack: number;
}

/** What one core runs, as far as this program goes. */
export interface CoreUse {
  /** main() or a thread's number; null when the core runs nothing of ours. */
  running: "main" | number | null;
  /** A thread waiting in this core's run queue. */
  queued: number | null;
}

export interface CoresState {
  kind: "cores";
  /** Which run of ./cores this is: each picks other addresses (ASLR). */
  run: number;
  stage: CoresStage;
  /** The line of cores.c the step is about; 0 before main() runs. */
  at: number;
  inMain: boolean;
  /** char line[16], byte by byte; null where nothing was written. */
  line: (number | null)[];
  /** The array is mapped (main()'s marks points to it), and filled. */
  mapped: boolean;
  filled: boolean;
  /** main()'s locals; null until written. */
  threads: number | null;
  per: number | null;
  total: number | null;
  /** The arrays main() and the threads share, element by element; null until written. */
  slices: (SliceValue | null)[];
  ids: (IdValue | null)[];
  /**
   * Change keys of main()'s loop variables that still hold an earlier
   * round's values: the bytes stay on the stack until this round writes them.
   */
  stale: string[];
  /** This round's threads, in the order they were created. */
  workers: Worker[];
  /** Stack mappings glibc has made, and the ones it keeps for new threads (newest first). */
  stacks: number;
  cache: number[];
  cores: CoreUse[];
  /** The core main() ran on last: where it goes back to after sleeping, if that core is idle. */
  mainLast: number;
  /** The heap: only the C library's chunks (the tcache, stdio's buffers). */
  heap: Heap;
  /** Rounds finished: how many times threads were started and joined. */
  rounds: number;
  /** Text in stdout's buffer that is not written yet, and the last line read(). */
  out: string;
  inbuf: string;
  /** What the step changed, for the view to point out (see CORES_CHANGE). */
  changed: string[];
  /** Its terminal was closed while it ran: the kernel hung up the pseudo-terminal, and it ended. */
  hungUp?: boolean;
}

export const CORES_CHANGE = {
  main: "frame:main",
  line: "line",
  marks: "marks",
  array: "array",
  threads: "threads",
  per: "per",
  total: "total",
  slices: "slices",
  ids: "ids",
  cores: "cores",
  heap: "heap",
  stdout: "stdout",
  stdin: "stdin",
} as const;

/** Change keys for one thread, one of glibc's stack mappings, one core, and one element of slices[] or ids[]. */
export const threadKey = (n: number) => `thread:${n}`;
export const stackKey = (index: number) => `stack:${index}`;
export const coreKey = (core: number) => `core:${core}`;
export const sliceKey = (t: number) => `slices:${t}`;
export const idKey = (t: number) => `ids:${t}`;

export const LINE_SIZE = 16;
export const CORE_COUNT = 4;

/** The program as bash is about to start it: no process yet, so no memory either. */
export function startCores(run: number): CoresState {
  return {
    kind: "cores",
    run,
    stage: "starting",
    at: 0,
    inMain: false,
    line: Array.from({ length: LINE_SIZE }, () => null),
    mapped: false,
    filled: false,
    threads: null,
    per: null,
    total: null,
    slices: Array.from({ length: MAX_THREADS }, () => null),
    ids: Array.from({ length: MAX_THREADS }, () => null),
    stale: [],
    workers: [],
    stacks: 0,
    cache: [],
    // Before main() runs, the process's only thread runs on core 0, as every trace does.
    cores: Array.from({ length: CORE_COUNT }, (_, i) => ({ running: i === 0 ? "main" : null, queued: null })),
    mainLast: 0,
    heap: NO_HEAP,
    rounds: 0,
    out: "",
    inbuf: "",
    changed: [],
  };
}

/** sum of i % 101 for i from 0 up to n (not included): what the array's first n marks add up to. */
function prefix(n: number): number {
  const whole = Math.floor(n / 101);
  const rest = n % 101;
  return whole * 5050 + (rest * (rest - 1)) / 2;
}

/** What add_up() returns for a slice: marks[i] is i % 101. */
export function sumOf(first: number, count: number): number {
  return prefix(first + count) - prefix(first);
}

/** The slice main() gives thread t (from 0): equal parts, the last one taking what is left. */
export function sliceOf(t: number, threads: number): { first: number; count: number } {
  const per = Math.floor(MARKS / threads);
  return { first: t * per, count: t === threads - 1 ? MARKS - t * per : per };
}

/**
 * sscanf(line, "%d", &threads) on what you typed: what it returns (1, 0 when
 * the line starts with something else, -1 when it holds only white space),
 * and what it stores in threads, if anything.
 */
export function scanThreads(text: string): { result: number; threads: number | null } {
  const { result, values } = scanInts(bytesOf(`${text}\n`), 1);
  return { result, threads: result === 1 ? (values[0] ?? null) : null };
}

/** sscanf() then the range check: the number of threads, or null to ask again. */
export function parseThreads(text: string): number | null {
  const n = scanThreads(text).threads;
  return n !== null && n >= 0 && n <= MAX_THREADS ? n : null;
}

/** The longest line the lab lets you type: fgets(line, 16, stdin) reads it whole, with its newline. */
export const MAX_THREADS_INPUT = LINE_SIZE - 2;

export function threadLine(w: Worker): string {
  return `thread ${w.n}: marks ${w.first} to ${w.first + w.count - 1} add up to ${w.sum ?? 0} (finished on CPU ${w.core})`;
}

export function averageLine(total: number): string {
  return `average of ${MARKS} marks: ${(total / MARKS).toFixed(5)}`;
}

export const PROMPT = `How many threads (1 to ${MAX_THREADS}, 0 to stop)? `;

// ---------------------------------------------------------------- scheduling

/** The core main() runs on, or null while it sleeps. */
export function mainCore(state: CoresState): number | null {
  const index = state.cores.findIndex((c) => c.running === "main");
  return index === -1 ? null : index;
}

const idle = (cores: CoreUse[]) => cores.findIndex((c) => c.running === null && c.queued === null);

/** A new thread: to an idle core, or into the run queue of main()'s core. */
export function placeThread(cores: CoreUse[], n: number): { cores: CoreUse[]; core: number; queued: boolean } {
  const free = idle(cores);
  if (free !== -1) {
    return { cores: cores.map((c, i) => (i === free ? { ...c, running: n } : c)), core: free, queued: false };
  }
  const main = cores.findIndex((c) => c.running === "main");
  const core = main === -1 ? 0 : main;
  return { cores: cores.map((c, i) => (i === core ? { ...c, queued: n } : c)), core, queued: true };
}

/** main() goes to sleep: a thread waiting for its core runs instead. */
export function mainSleeps(cores: CoreUse[]): CoreUse[] {
  return cores.map((c) => (c.running === "main" ? { running: c.queued, queued: null } : c));
}

/** main() goes to sleep, remembering the core it was on. */
export function sleepMain(state: CoresState): Pick<CoresState, "cores" | "mainLast"> {
  return { cores: mainSleeps(state.cores), mainLast: mainCore(state) ?? state.mainLast };
}

/** The change keys for the cores whose occupant changes, and for the panel that shows them. */
export function coreChanges(before: CoreUse[], after: CoreUse[]): string[] {
  const keys = after.flatMap((c, i) => {
    const was = before[i];
    return was && was.running === c.running && was.queued === c.queued ? [] : [coreKey(i)];
  });
  return keys.length > 0 ? [CORES_CHANGE.cores, ...keys] : [];
}

/** A thread exits: its core is free. */
export function threadExits(cores: CoreUse[], n: number): CoreUse[] {
  return cores.map((c) => (c.running === n ? { running: c.queued, queued: null } : c));
}

/** main() wakes up: on its last core if that is idle, else on an idle one. */
export function mainWakes(cores: CoreUse[], last: number): { cores: CoreUse[]; core: number } {
  const lastIdle = cores[last]?.running === null;
  const core = lastIdle ? last : idle(cores);
  const target = core === -1 ? last : core;
  return { cores: cores.map((c, i) => (i === target ? { ...c, running: "main" } : c)), core: target };
}

/** A stack for a new thread: the newest one glibc kept, or a new mapping. */
export function takeStack(state: Pick<CoresState, "stacks" | "cache">): { stack: number; reused: boolean; stacks: number; cache: number[] } {
  const [cached, ...rest] = state.cache;
  if (cached !== undefined) return { stack: cached, reused: true, stacks: state.stacks, cache: rest };
  return { stack: state.stacks, reused: false, stacks: state.stacks + 1, cache: state.cache };
}
