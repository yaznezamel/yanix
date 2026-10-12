import { CORES_C } from "../cores/source";
import {
  ADD_UP_RBP,
  ARRAY_MAP,
  ARRAY_PAGES,
  CORES_MAIN,
  DESCRIPTOR,
  MARKS,
  STACK_MAP,
  arrayMapping,
  coresLayoutOf,
  stackMapping,
  type CoresLayout,
} from "../cores/layout";
import {
  CORES_CHANGE,
  PROMPT,
  averageLine,
  mainCore,
  mainWakes,
  parseThreads,
  placeThread,
  sleepMain,
  sliceOf,
  stackKey,
  startCores,
  sumOf,
  takeStack,
  threadExits,
  threadKey,
  threadLine,
  type CoresState,
  type Worker,
} from "../cores/program";
import { initTcache, malloc } from "../marks/heap";
import { fgetsInto, userOf } from "../marks/program";
import { findLine } from "../marks/source";
import { dataFrame } from "../structs";
import type { AppState, CodeRef, Scenario, Step } from "../types";
import {
  ALU,
  CODE,
  MEMORY,
  PROGRAM,
  exitSteps,
  printLines,
  promptStep,
  startSteps,
  syscall,
  tracer,
  typedSteps,
  unitsOf,
  waitSteps,
  type Tracer,
} from "./program";

// examples/cores/cores.c in the lab's terminal: ./cores fills a million
// marks, then each number you type starts that many threads. A round shows
// what threads are: a stack each (mmap), a task each that shares the
// process's memory (clone3), the scheduler placing them on cores, all of
// them working at once, and main() sleeping in pthread_join() on a futex
// until each one exits. Steps name the cores they run on (Step.cores), so
// the hardware view lights several at once.

const at = (text: string, after?: number) => findLine(CORES_C, text, after);
const LINE = {
  main: at("int main(void)"),
  malloc: at("int *marks = malloc"),
  fill: at("marks[i] = i % 101;"),
  prompt: at('printf("How many threads'),
  fgets: at("if (!fgets(line, sizeof line, stdin))"),
  sscanf: at('if (sscanf(line, "%d"'),
  zero: at("if (threads == 0)"),
  per: at("size_t per = MARKS / threads;"),
  create: at("if (pthread_create("),
  addUp: at("sum += slice->marks[i];"),
  store: at("slice->sum = sum;"),
  join: at("pthread_join(ids[t], NULL);"),
  printThread: at('printf("thread %d'),
  average: at('printf("average'),
  free: at("free(marks);"),
  ret: at("return 0;"),
} as const;

const T = {
  create: { project: "glibc", path: "nptl/pthread_create.c", symbol: "__pthread_create_2_1" },
  allocateStack: { project: "glibc", path: "nptl/allocatestack.c", symbol: "allocate_stack" },
  cachedStack: { project: "glibc", path: "nptl/allocatestack.c", symbol: "get_cached_stack" },
  cloneInternal: { project: "glibc", path: "sysdeps/unix/sysv/linux/clone-internal.c", symbol: "__clone_internal" },
  startThread: { project: "glibc", path: "nptl/pthread_create.c", symbol: "start_thread" },
  adviseStack: { project: "glibc", path: "nptl/allocatestack.c", symbol: "advise_stack_range" },
  join: { project: "glibc", path: "nptl/pthread_join_common.c", symbol: "__pthread_clockjoin_ex" },
  queueStack: { project: "glibc", path: "nptl/nptl-stack.c", symbol: "queue_stack" },
  getcpu: { project: "glibc", path: "sysdeps/unix/sysv/linux/sched_getcpu.c", symbol: "sched_getcpu" },
  mmapChunk: { project: "glibc", path: "malloc/malloc.c", symbol: "sysmalloc_mmap" },
  munmapChunk: { project: "glibc", path: "malloc/malloc.c", symbol: "munmap_chunk" },
  mmap: { project: "linux", path: "mm/mmap.c", symbol: "do_mmap" },
  mprotect: { project: "linux", path: "mm/mprotect.c", symbol: "do_mprotect_pkey" },
  copyProcess: { project: "linux", path: "kernel/fork.c", symbol: "copy_process" },
  newTask: { project: "linux", path: "kernel/sched/core.c", symbol: "wake_up_new_task" },
  placeTask: { project: "linux", path: "kernel/sched/fair.c", symbol: "select_task_rq_fair" },
  futexWait: { project: "linux", path: "kernel/futex/waitwake.c", symbol: "futex_wait" },
  futexWake: { project: "linux", path: "kernel/futex/waitwake.c", symbol: "futex_wake" },
  mmRelease: { project: "linux", path: "kernel/fork.c", symbol: "mm_release" },
  dontneed: { project: "linux", path: "mm/madvise.c", symbol: "madvise_dontneed_single_vma" },
  munmap: { project: "linux", path: "mm/mmap.c", symbol: "munmap" },
} satisfies Record<string, CodeRef>;

const hex = (n: number) => `0x${n.toString(16)}`;
const coresNamed = (cores: number[]) =>
  cores.length === 1 ? `core ${cores[0]}` : `cores ${cores.slice(0, -1).join(", ")} and ${cores.at(-1)}`;
const english = ["no", "one", "two", "three", "four"];

/** Where read() puts what you type: stdin's buffer, the chunk the first fgets() made. */
function stdinOf(t: Tracer<CoresState>, layout: CoresLayout): string {
  const chunk = t.state.heap.chunks.find((c) => c.tag === "stdin");
  return chunk ? hex(layout.heap + userOf(chunk.at)) : "stdin's buffer";
}

/** The units of the cores that run a step's code: they load, add and keep a sum each. */
function workingUnits(cores: number[]): string[] {
  return cores.flatMap((core) => unitsOf(core, ["regs", "exec", "tlb", "l1d", "l2"]));
}

// ---------------------------------------------------------------- ./cores

function runSteps(t: Tracer<CoresState>, layout: CoresLayout): void {
  startSteps(t, {
    command: "./cores",
    name: "cores",
    exe: layout.exe,
    heap: layout.heap,
    ld: layout.ld,
    stack: layout.stack[0],
    libc: " pthread_create() and pthread_join() are in there too: since glibc 2.34 the threads library is part of libc.so.6.",
  });
  t.add(
    {
      id: "main",
      phase: "app",
      path: [PROGRAM],
      parts: MEMORY,
      title: "main() gets a stack frame",
      body: `main() saves the caller's rbp and moves rsp down ${CORES_MAIN.size} bytes: room for marks, line, threads, per, total, and the arrays ids[4] and slices[4] that the threads will use. Nothing is cleared, apart from the canary that the stack protector checks before main() returns.`,
      code: [CODE.startMain],
      timescale: "ns",
    },
    { inMain: true, at: LINE.main },
    [CORES_CHANGE.main],
  );

  const array = arrayMapping(layout);
  const heap = initTcache(t.state.heap).heap;
  t.add(
    {
      id: "malloc",
      phase: "memory",
      path: [PROGRAM, "glibc", "syscall", "mm"],
      frames: [
        dataFrame(2, "System calls", "A heap, then a mapping of its own", syscall("brk(), then mmap()", [
          { name: "brk", value: `${hex(layout.heap)} → ${hex(layout.heap + heap.size)}: 132 KiB of heap, for the tcache` },
          { name: "mmap", value: `${ARRAY_MAP} bytes (${ARRAY_PAGES} pages), read and write, at ${hex(array.start)}` },
          { name: "Returns", value: `${hex(array.pointer)} to main(): 16 bytes in, after malloc()'s header` },
        ])),
      ],
      title: "malloc(): too big for the heap",
      body: `The first malloc() sets up the tcache, which needs a heap: brk() makes one of 132 KiB, as for ./marks. But 4,000,000 bytes is far above M_MMAP_THRESHOLD (128 KiB by default), so the array is not carved from the heap: sysmalloc() asks the kernel for a mapping of its own with mmap(), ${ARRAY_MAP} bytes, the array and a 16-byte header rounded up to ${ARRAY_PAGES} whole pages. The kernel only records the area: no RAM yet.`,
      code: [CODE.malloc, T.mmapChunk, T.mmap],
      timescale: "us",
    },
    { heap, mapped: true, at: LINE.malloc },
    [CORES_CHANGE.marks, CORES_CHANGE.array, CORES_CHANGE.heap],
  );
  t.add(
    {
      id: "fill",
      phase: "memory",
      path: [PROGRAM, "mm", "ram"],
      parts: [...MEMORY, ...ALU],
      frames: [
        dataFrame(1, "Page faults", "One for each new page", {
          kind: "reg",
          title: "Page faults",
          fields: [
            { name: "Pages", value: `${ARRAY_PAGES}, each faulting on the first write to it` },
            { name: "Each one", value: "a write from user mode to a page not present: the kernel maps a zeroed 4 KiB page" },
          ],
        }),
      ],
      title: "Filling the array: a page fault per page",
      body: `The loop writes a million ints, 4 bytes each, one after the other. Each time it reaches a page that nothing has written yet, the CPU raises a page fault and the kernel maps a zeroed page of RAM there: ${ARRAY_PAGES} pages, so almost a thousand page faults, the price of first touching memory. Between them, the loop runs without the kernel.`,
      code: [CODE.fault, CODE.anonPage],
      timescale: "ms",
    },
    { filled: true, at: LINE.fill },
    [CORES_CHANGE.array],
  );
  const stdout = malloc(t.state.heap, 1024, "stdout");
  const stdin = malloc(stdout.heap, 1024, "stdin");
  promptStep(
    t,
    "printf",
    PROMPT,
    LINE.prompt,
    "printf() needs a buffer for stdout, and the fgets() after it one for stdin: 1024 bytes each, carved from the heap that brk() made, as in ./marks. The question waits in stdout's buffer: it has no newline.",
  );
  t.add(
    {
      id: "buffers",
      phase: "memory",
      path: [PROGRAM, "glibc"],
      parts: MEMORY,
      title: "fgets(): stdin's buffer",
      body: "fgets(line, sizeof line, stdin) asks for a line. stdin's buffer is made now, from the heap: no system call, the heap has room.",
      code: [CODE.fgets, CODE.doallocate],
      timescale: "us",
    },
    { heap: stdin.heap, at: LINE.fgets },
    [CORES_CHANGE.heap],
  );
  waitSteps(t, LINE.fgets, "threads", "There is nothing to read yet:", stdinOf(t, layout), sleepMain(t.state));
}

// ---------------------------------------------------------------- a round

function roundSteps(t: Tracer<CoresState>, layout: CoresLayout, typed: string, threads: number): void {
  const per = Math.floor(MARKS / threads);
  t.add(
    {
      id: "sscanf",
      phase: "app",
      path: ["glibc", PROGRAM],
      parts: MEMORY,
      title: `${threads} thread${threads === 1 ? "" : "s"}`,
      body: `fgets() copies your line into line[16], and sscanf() reads the number: threads = ${threads}. Each thread gets per = 1000000 / ${threads} = ${per} marks${MARKS % threads === 0 ? "" : ", and the last one also what is left over"}. main() fills in slices[t] for each: where the array is, where its part starts, how many marks.`,
      code: [CODE.fgets, CODE.sscanf],
      timescale: "ns",
    },
    { line: fgetsInto(t.state.line, typed), threads, per, total: null, workers: [], at: LINE.per },
    [CORES_CHANGE.line, CORES_CHANGE.threads, CORES_CHANGE.per, CORES_CHANGE.slices],
  );

  // Thread 1, in full: its stack, then clone3() and a core.
  const firstStack = takeStack(t.state);
  const mapping = stackMapping(layout, firstStack.stack);
  const first = createWorker(1, threads, firstStack.stack);
  t.add(
    {
      id: "stack-1",
      phase: "memory",
      path: [PROGRAM, "glibc", "syscall", "mm"],
      frames: firstStack.reused
        ? undefined
        : [
            dataFrame(2, "System calls", "A stack for thread 1", syscall("mmap(), then mprotect()", [
              { name: "mmap", value: `${STACK_MAP} bytes at ${hex(mapping.start)}, no access, a stack mapping` },
              { name: "mprotect", value: `all but the lowest 4 KiB: read and write` },
              { name: "Guard page", value: `${hex(mapping.start)}: left inaccessible` },
            ])),
          ],
      title: firstStack.reused ? "pthread_create(): a stack from the cache" : "pthread_create(): a stack for thread 1",
      body: firstStack.reused
        ? `pthread_create() needs a stack for the new thread. glibc kept the stacks of the threads that finished last round, after giving their RAM back: allocate_stack() takes the newest one from its cache. No mmap() this time. pthread_t, the value stored in ids[0], is the address of the thread's descriptor at the top of that stack: ${hex(mapping.top - DESCRIPTOR)}.`
        : `pthread_create() first needs a stack for the new thread. allocate_stack() asks the kernel for 8 MiB and 4 KiB with mmap(), with no access at all, then mprotect() makes all but the lowest page readable and writable. That page stays a guard: a thread that runs off the end of its stack hits it and crashes, instead of silently overwriting its neighbour. glibc puts the thread's descriptor at the top of the stack; pthread_t, the value stored in ids[0], is its address: ${hex(mapping.top - DESCRIPTOR)}.`,
      code: firstStack.reused ? [T.create, T.cachedStack] : [T.create, T.allocateStack, T.mmap, T.mprotect],
      timescale: "us",
    },
    { stacks: firstStack.stacks, cache: firstStack.cache, at: LINE.create },
    [stackKey(firstStack.stack), CORES_CHANGE.ids],
  );
  const main = mainCore(t.state) ?? 0;
  const placed = placeThread(t.state.cores, 1);
  t.add(
    {
      id: "clone-1",
      phase: "launch",
      path: ["glibc", "syscall", "proc", "sched"],
      cores: [main, placed.core],
      frames: [
        dataFrame(1, "System call", "A new thread in the same process", syscall("clone3()", [
          { name: "Shares", value: "CLONE_VM (memory), CLONE_FS, CLONE_FILES, CLONE_SIGHAND" },
          { name: "Same process", value: "CLONE_THREAD: one PID, a new thread ID" },
          { name: "Stack", value: `the new mapping: stack=${hex(mapping.start)}, stack_size=0x7fff80` },
          { name: "When it exits", value: "CLONE_CHILD_CLEARTID: zero its thread ID and wake waiters" },
        ])),
      ],
      title: "clone3(): a new thread",
      body: `clone3() asks the kernel for a new task that shares almost everything with main(): the same memory, the same open files and signal handlers, the same process. Only its registers and its stack are its own. It starts in start_thread(), which calls add_up(&slices[0]). wake_up_new_task() then asks the scheduler for a core: core ${placed.core} is idle, so thread 1 starts there, while main() goes on on core ${main}.`,
      code: [T.cloneInternal, T.copyProcess, T.newTask, T.placeTask],
      timescale: "us",
    },
    { cores: placed.cores, workers: [{ ...first, core: placed.core, state: "running" }] },
    [threadKey(1), CORES_CHANGE.cores],
  );

  // The other threads, together.
  if (threads > 1) {
    const changed: string[] = [CORES_CHANGE.cores, CORES_CHANGE.ids];
    let cores = t.state.cores;
    let stacks = { stacks: t.state.stacks, cache: t.state.cache };
    const workers: Worker[] = [...t.state.workers];
    const reused: number[] = [];
    for (let n = 2; n <= threads; n++) {
      const stack = takeStack(stacks);
      stacks = { stacks: stack.stacks, cache: stack.cache };
      if (stack.reused) reused.push(n);
      const worker = createWorker(n, threads, stack.stack);
      const place = placeThread(cores, n);
      cores = place.cores;
      workers.push({ ...worker, core: place.core, state: place.queued ? "queued" : "running", late: place.queued });
      changed.push(threadKey(n), stackKey(stack.stack));
    }
    const running = workers.filter((w) => w.n > 1 && w.state === "running");
    const waiting = workers.filter((w) => w.state === "queued");
    const others = threads === 2 ? "thread 2" : `threads 2 to ${threads}`;
    const fromCache = reused.length === threads - 1 ? " from the cache" : reused.length > 0 ? " from the cache while it has some" : "";
    t.add(
      {
        id: "clone-rest",
        phase: "launch",
        path: [PROGRAM, "glibc", "syscall", "proc", "sched"],
        cores: [main, ...running.map((w) => w.core)],
        title: threads === 2 ? "Thread 2" : `Threads 2 to ${threads}`,
        body: `The loop goes round again for ${others}: ${
          threads === 2 ? `a stack${fromCache} and a clone3()` : `a stack each${fromCache}, and a clone3() each`
        }. ${running.map((w, i) => `${i === 0 ? "Thread" : "thread"} ${w.n} gets core ${w.core}`).join(", ")}.${
          waiting.length > 0
            ? ` Thread ${waiting[0]!.n} finds every core busy, main() included, so the scheduler puts it in the run queue of core ${waiting[0]!.core}: it waits its turn.`
            : ""
        } Creating a thread takes microseconds; the adding takes milliseconds, so they all start almost together.`,
        code: [T.create, T.cloneInternal, T.newTask, T.placeTask],
        timescale: "us",
      },
      { cores, workers, stacks: stacks.stacks, cache: stacks.cache, at: LINE.create },
      changed,
    );
  }

  // main() waits for thread 1.
  const sleeping = sleepMain(t.state);
  const takeover = t.state.workers.find((w) => w.state === "queued");
  t.add(
    {
      id: "join",
      phase: "app",
      path: [PROGRAM, "glibc", "syscall", "sched"],
      cores: [main],
      frames: [
        dataFrame(2, "System call", "main() goes to sleep", syscall("futex(…, FUTEX_WAIT_BITSET, …)", [
          { name: "Word", value: `${hex(mapping.top - DESCRIPTOR + 0x2d0)}: thread 1's ID, in its descriptor` },
          { name: "Sleep while", value: "the word still holds that ID" },
        ])),
      ],
      title: "pthread_join(): main() sleeps",
      body: `main() calls pthread_join(ids[0]). Thread 1 is still adding, so glibc waits on a futex: a word in thread 1's descriptor that holds its thread ID until it exits. futex() puts main() to sleep in the kernel${
        takeover ? `, and core ${main} is free for thread ${takeover.n}, which was waiting in its run queue.` : `, and core ${main} has nothing of ours to run.`
      }`,
      code: [T.join, T.futexWait],
      timescale: "us",
    },
    {
      ...sleeping,
      workers: t.state.workers.map((w) => (w.state === "queued" ? { ...w, state: "running" } : w)),
      at: LINE.join,
    },
    [CORES_CHANGE.cores, ...(takeover ? [threadKey(takeover.n)] : [])],
  );

  // Everyone adds at once.
  const busy = t.state.workers.filter((w) => w.state === "running");
  const busyCores = busy.map((w) => w.core).sort((a, b) => a - b);
  t.add(
    {
      id: "add",
      phase: "app",
      // The loads bring the array from RAM into the cores: the signal ends at the cores.
      path: ["ram", PROGRAM],
      cores: busyCores,
      parts: workingUnits(busyCores),
      title: threads === 1 ? "One core adds a million marks" : `${english[threads]![0]!.toUpperCase()}${english[threads]!.slice(1)} cores at once`,
      body:
        threads === 1
          ? `Thread 1 adds up all million marks on core ${busy[0]?.core ?? 1}, alone: sum += slice->marks[i], a load and an add for each mark, with i and sum on its own stack. main() sleeps, and the other cores have nothing of ours to do. Try 4 threads next: on the 4-core machine the program was measured on, that took about a third of the time.`
          : `Each thread runs add_up() on its own core (${coresNamed(busyCores)}), with its own registers and its own stack, over its own part of the same array: sum += slice->marks[i], a load and an add for each mark. Each core loads through its own L1 and L2 caches; what they don't hold comes from the shared L3 cache or from RAM, through the one memory controller every core uses. That sharing is one reason ${threads} threads are faster than one, but not ${threads} times faster.`,
      code: [T.startThread],
      timescale: "ms",
    },
    { at: LINE.addUp },
    busy.map((w) => threadKey(w.n)),
  );

  // Thread 1 finishes; main() wakes and prints.
  finishSteps(t, layout, 1, true);
  const early = t.state.workers.filter((w) => w.n > 1 && w.state === "running" && !w.late);
  if (early.length > 0) {
    let cores = t.state.cores;
    for (const w of early) cores = threadExits(cores, w.n);
    const done = early.map((w) => ({ ...w, state: "joined" as const, sum: sumOf(w.first, w.count) }));
    const workers = t.state.workers.map((w) => done.find((d) => d.n === w.n) ?? w);
    const names = early.length === 1 ? `Thread ${early[0]!.n}` : `Threads ${early.map((w) => w.n).join(" and ")}`;
    t.add(
      {
        id: "joins",
        phase: "app",
        path: [PROGRAM, "glibc"],
        cores: [mainCore({ ...t.state, cores }) ?? 0],
        title: `${names} done too`,
        body: `${names} had as much work and started microseconds after thread 1, so ${early.length === 1 ? "it has" : "they have"} finished by now, or ${early.length === 1 ? "is" : "are"} about to: each pthread_join() returns at once, or after a short sleep, and glibc keeps each stack for later. main() adds ${early.length === 1 ? "its sum" : "their sums"} to total.`,
        code: [T.join, T.queueStack],
        timescale: "us",
      },
      {
        cores,
        workers,
        total: (t.state.total ?? 0) + done.reduce((a, w) => a + (w.sum ?? 0), 0),
        cache: [...done.map((w) => w.stack).reverse(), ...t.state.cache],
        at: LINE.join,
      },
      [CORES_CHANGE.cores, CORES_CHANGE.total, CORES_CHANGE.slices, ...done.map((w) => threadKey(w.n))],
    );
    printLines(t, "print-rest", done.map(threadLine), LINE.printThread, early.length === 1 ? `printf(): thread ${early[0]!.n}'s line` : "printf(): their lines", "One printf() each, and each ends with a newline, so each is written at once: one write() per line.");
  }
  const last = t.state.workers.find((w) => w.state === "running");
  if (last) {
    t.add(
      {
        id: "join-again",
        phase: "app",
        path: [PROGRAM, "glibc", "syscall", "sched"],
        cores: [mainCore(t.state) ?? 0],
        title: `pthread_join(): waiting for thread ${last.n}`,
        body: `Thread ${last.n} only got a core when main() first went to sleep, so it is still adding. pthread_join(ids[${last.n - 1}]) waits on its futex, and main() sleeps again.`,
        code: [T.join, T.futexWait],
        timescale: "us",
      },
      { ...sleepMain(t.state), at: LINE.join },
      [CORES_CHANGE.cores],
    );
    finishSteps(t, layout, last.n, false);
  }

  printLines(t, "average", [averageLine(t.state.total ?? 0)], LINE.average, "The average", "total holds every thread's sum now, the whole million marks: main() divides it by the number of marks and prints the average. Then the loop asks again.");
  t.add({ id: "round", phase: "app", path: [PROGRAM], title: "Round done", body: "Every thread has been joined. Their stacks stay in glibc's cache, ready for the next round; the kernel's side of each thread is gone.", timescale: "ns", mode: "deep" }, { rounds: t.state.rounds + 1 });
  promptStep(t, "printf-again", PROMPT, LINE.prompt, "The question again, into stdout's buffer.");
  waitSteps(t, LINE.fgets, "threads", "fgets() asks for the next number.", stdinOf(t, layout), sleepMain(t.state));
}

function createWorker(n: number, threads: number, stack: number): Worker {
  const { first, count } = sliceOf(n - 1, threads);
  return { n, first, count, state: "running", core: 0, stack, sum: null, late: false };
}

/** Thread n finishes: its result, its exit, main() waking and printing its line. */
function finishSteps(t: Tracer<CoresState>, layout: CoresLayout, n: number, firstToFinish: boolean): void {
  const worker = t.state.workers.find((w) => w.n === n)!;
  const sum = sumOf(worker.first, worker.count);
  const mapping = stackMapping(layout, worker.stack);
  const exited = threadExits(t.state.cores, n);
  const woke = mainWakes(exited, t.state.mainLast);
  t.add(
    {
      id: `exit-${n}`,
      phase: "launch",
      path: [PROGRAM, "syscall", "proc", "sched"],
      cores: [worker.core],
      frames: [
        dataFrame(1, "System calls", `Thread ${n} ends`, syscall("madvise(), then exit()", [
          { name: "madvise", value: `MADV_DONTNEED on most of the stack at ${hex(mapping.start)}: its RAM goes back` },
          { name: "exit", value: "ends this thread only; exit_group() would end them all" },
          { name: "Then", value: "the kernel zeroes the thread-ID word and wakes the futex" },
        ])),
      ],
      title: firstToFinish ? "Thread 1 finishes" : `Thread ${n} finishes last`,
      body: `${
        firstToFinish
          ? `add_up() writes its sum, ${sum}, and the core it is on into slices[0]: into main()'s stack. One thread writing to another's stack is fine here, because the memory is shared and main() reads it only after the join.`
          : `Thread ${n} finishes last, on core ${worker.core}, and writes its sum into slices[${n - 1}].`
      } start_thread() gives back the RAM of the stack it no longer needs with madvise(), and calls exit(), which ends this thread only. As clone3() asked, the kernel zeroes the thread-ID word and wakes the futex: main() wakes up, on core ${woke.core}.`,
      code: [T.getcpu, T.adviseStack, T.dontneed, T.mmRelease, T.futexWake],
      timescale: "us",
    },
    {
      cores: woke.cores,
      mainLast: woke.core,
      workers: t.state.workers.map((w) => (w.n === n ? { ...w, state: "done", sum } : w)),
      at: LINE.store,
    },
    [threadKey(n), CORES_CHANGE.cores, CORES_CHANGE.slices, stackKey(worker.stack)],
  );
  const joined = t.state.workers.map((w) => (w.n === n ? { ...w, state: "joined" as const } : w));
  t.add(
    {
      id: `joined-${n}`,
      phase: "app",
      path: ["sched", PROGRAM],
      cores: [woke.core],
      title: `pthread_join() returns`,
      body: `Back in main(): pthread_join() sees the thread-ID word at 0, keeps thread ${n}'s stack in glibc's cache for later, and returns. total += slices[${n - 1}].sum adds ${sum} to the total.`,
      code: [T.join, T.queueStack],
      timescale: "us",
    },
    {
      workers: joined,
      total: (t.state.total ?? 0) + sum,
      cache: [worker.stack, ...t.state.cache],
      at: LINE.join,
    },
    [threadKey(n), CORES_CHANGE.total],
  );
  const line = threadLine({ ...worker, sum });
  printLines(t, `print-${n}`, [line], LINE.printThread, `printf(): thread ${n}'s line`, `The line ends with a newline, so stdout, line-buffered on a terminal, writes it at once: "finished on CPU ${worker.core}" is what sched_getcpu() told the thread. On a real machine that number changes from run to run.`);
}

// ---------------------------------------------------------------- other answers

function rejectSteps(t: Tracer<CoresState>, layout: CoresLayout, typed: string): void {
  t.add(
    {
      id: "sscanf",
      phase: "app",
      path: ["glibc", PROGRAM],
      parts: MEMORY,
      title: "Not a number from 0 to 4",
      body: "fgets() copies your line into line[16], but sscanf() finds no number at the start of it, or a number outside 0 to 4. continue skips the rest of the loop, back to its top: the question again.",
      code: [CODE.fgets, CODE.sscanf],
      timescale: "ns",
    },
    { line: fgetsInto(t.state.line, typed), at: LINE.sscanf },
    [CORES_CHANGE.line],
  );
  promptStep(t, "printf-again", PROMPT, LINE.prompt, "The question again, into stdout's buffer.");
  waitSteps(t, LINE.fgets, "threads", "fgets() asks for a new line.", stdinOf(t, layout), sleepMain(t.state));
}

function stopSteps(t: Tracer<CoresState>, layout: CoresLayout, typed: string): void {
  const array = arrayMapping(layout);
  t.add(
    {
      id: "sscanf",
      phase: "app",
      path: ["glibc", PROGRAM],
      parts: MEMORY,
      title: "0: stop",
      body: "sscanf() reads 0, so break leaves the loop.",
      code: [CODE.sscanf],
      timescale: "ns",
    },
    { line: fgetsInto(t.state.line, typed), threads: 0, at: LINE.zero },
    [CORES_CHANGE.line, CORES_CHANGE.threads],
  );
  t.add(
    {
      id: "free",
      phase: "memory",
      path: [PROGRAM, "glibc", "syscall", "mm"],
      frames: [
        dataFrame(2, "System call", "The array goes back to the kernel", syscall("munmap()", [
          { name: "Address", value: hex(array.start) },
          { name: "Length", value: `${ARRAY_MAP} bytes, ${ARRAY_PAGES} pages` },
        ])),
      ],
      title: "free(): straight back to the kernel",
      body: `The array's chunk has a mapping of its own, so free() does not keep it for later, as it keeps small chunks: munmap_chunk() hands the whole mapping back with munmap(), and its ${ARRAY_PAGES} pages of RAM are free again at once.`,
      code: [CODE.free, T.munmapChunk, T.munmap],
      timescale: "us",
    },
    { mapped: false, filled: false, at: LINE.free },
    [CORES_CHANGE.array, CORES_CHANGE.marks],
  );
  exitSteps(t, "cores", LINE.ret, { inMain: false }, " The stacks glibc kept for threads go with the rest of the address space.");
}

// ---------------------------------------------------------------- scenarios

export function runCores(apps: AppState): Scenario {
  const previous = apps.program?.kind === "cores" ? apps.program.run : -1;
  const start = startCores(previous + 1);
  const t = tracer<CoresState>(start);
  runSteps(t, coresLayoutOf(start.run));
  return { kind: "runProgram", app: "terminal", title: "./cores", focus: "split", steps: t.steps };
}

export function coresInput(program: CoresState, text: string): Scenario {
  const layout = coresLayoutOf(program.run);
  const t = tracer<CoresState>({ ...program, changed: [] });
  const waking = mainWakes(t.state.cores, t.state.mainLast);
  typedSteps(t, text, LINE.fgets, stdinOf(t, layout), { cores: waking.cores, mainLast: waking.core });
  const threads = parseThreads(text);
  if (threads === null) rejectSteps(t, layout, text);
  else if (threads === 0) stopSteps(t, layout, text);
  else roundSteps(t, layout, text, threads);
  const said = text === "" ? "(an empty line)" : text;
  return { kind: "programInput", app: "terminal", title: `Threads: ${said}`, focus: "split", steps: t.steps };
}

/** Exposed for tests. */
export const _forTests = { ADD_UP_RBP, LINE } satisfies Record<string, unknown>;
export type { Step };
