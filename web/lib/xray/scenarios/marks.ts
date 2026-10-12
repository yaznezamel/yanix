import { HEADER, PAGE, chunkSize, free, initTcache, malloc, pagesOf, realloc } from "../marks/heap";
import { CALLEE, MAIN, STUDENT_SIZE, TTY_BLOCK, hex, layoutOf, type Layout } from "../marks/layout";
import {
  CHANGE,
  SUBJECTS,
  badMark,
  bytesOf,
  chunkKey,
  cString,
  fgetsInto,
  formatRow,
  pageKey,
  scanMarks,
  startProgram,
  strcspnNewline,
  textOf,
  userOf,
  type ProgramState,
} from "../marks/program";
import { lineOf } from "../marks/source";
import { dataFrame } from "../structs";
import type { AppState, Header, NodeId, Scenario } from "../types";
import {
  ALU,
  CODE as C,
  MEMORY,
  PROGRAM,
  eofSteps,
  exitSteps,
  interruptSteps,
  promptStep,
  quoted,
  startSteps,
  syscall,
  tracer,
  typedSteps,
  unitsOf,
  waitSteps,
  type Tracer as ProgramTracer,
} from "./program";

// examples/marks/marks.c running in the lab's terminal: ./marks starts it, and
// every line you type is a trace of its own, from the keyboard through the
// TTY to the program, and on through the C library, the kernel and the CPU.
// Each step carries the program's memory as it is after that step, so the
// Memory tab follows the playhead. Everything the program does to memory
// comes from lib/xray/marks, which reproduces what gdb showed of the real
// program (glibc 2.39, GCC 13.3, x86-64).

type Tracer = ProgramTracer<ProgramState>;

const at = (text: string, after?: number) => lineOf(text, after);
const LINE = {
  main: at("int main(void)"),
  promptName: at('printf("Student name: ")'),
  fgetsName: at("if (!fgets(line, sizeof line, stdin))"),
  strcspn: at("line[strcspn(line"),
  strdup: at("s.name = strdup(line)"),
  promptMarks: at('printf("Marks for %s'),
  callReadMarks: at("while ((got = read_marks"),
  retry: at('printf("Please type 3 whole numbers'),
  fgetsMarks: at("if (!fgets(line, size, stdin))"),
  sscanf: at("if (sscanf(line"),
  check: at("if (marks[i] < 0 || marks[i] > 100)"),
  realloc: at("struct student *grown = realloc"),
  store: at("students[count++] = s;"),
  promptAgain: at('printf("Add another student?'),
  fgetsAgain: at("if (!fgets(line, sizeof line, stdin) || (line[0]"),
  breakName: at("break;", lineOf("if (!fgets(line, sizeof line, stdin))")),
  freeName: at("free(s.name);"),
  breakAgain: at("break;", lineOf("if (!fgets(line, sizeof line, stdin) || (line[0]")),
  sum: at("sum += marks[i];"),
  divide: at("return (double)sum / n;"),
  printRow: at('printf("%-12s'),
  freeNames: at("free(students[i].name);"),
  freeArray: at("free(students);"),
  // main()'s, not read_marks()'s.
  ret: at("return 0;", lineOf("int main(void)")),
} as const;

// ---------------------------------------------------------------- data

function chunkHeader(heap: Layout["heap"], atChunk: number, size: number, what: string): Header {
  return {
    kind: "heap",
    title: `Chunk at heap + ${hex(atChunk)}`,
    bytes: size,
    fields: [
      { name: "Size field", value: `${hex(size + 1)}: ${size} bytes, and bit 0 set (the chunk before it is in use)` },
      { name: "Pointer returned", value: `${hex(heap + userOf(atChunk))}, 16 bytes in` },
      { name: "Holds", value: what },
    ],
  };
}

// ---------------------------------------------------------------- tracing

const layout = (t: Tracer) => layoutOf(t.state.run);
const addr = (t: Tracer, offset: number) => hex(layout(t).heap + offset);

/** Where read() puts what you type: stdin's buffer, the chunk the first fgets() made. */
function stdinBuffer(t: Tracer): string {
  const chunk = t.state.heap.chunks.find((c) => c.tag === "stdin");
  return chunk ? addr(t, userOf(chunk.at)) : "stdin's buffer";
}

/**
 * Writes to the heap at these ranges (offsets, lengths): a page nothing has
 * written yet has no RAM behind it, so the first write to it faults.
 */
function touch(t: Tracer, from: NodeId, ranges: [number, number][], line: number): void {
  const fresh = [...new Set(ranges.flatMap(([start, length]) => pagesOf(start, length)))]
    .filter((page) => !t.state.pages.includes(page))
    .sort((a, b) => a - b);
  if (fresh.length === 0) return;
  const first = t.state.pages.length === 0;
  const page = fresh[0]!;
  let faulting = page * PAGE;
  for (const [start, length] of ranges) {
    const first = Math.max(start, page * PAGE);
    if (first < start + length && Math.floor(first / PAGE) === page) {
      faulting = first;
      break;
    }
  }
  t.add(
    {
      id: `fault-${page}`,
      phase: "memory",
      path: [from, "mm", "ram"],
      parts: unitsOf(0, ["tlb", "exec"]),
      frames: [
        dataFrame(0, "Page fault", "What the CPU tells the kernel", {
          kind: "reg",
          title: "Page fault",
          fields: [
            { name: "Address (CR2)", value: `${addr(t, faulting)}, in the [heap] area` },
            { name: "Error code", value: "0x6: a write, from user mode, to a page that is not present" },
          ],
        }),
      ],
      title: first ? "A page fault: the heap gets RAM" : "Another page fault: one more page",
      body: first
        ? "The first write into the new heap finds no page behind the address: the TLB has no translation, the page tables have no entry, so the CPU stops the instruction and raises a page fault. The kernel's handler finds the address inside the [heap] area, takes a free page of RAM, fills it with zeros (no program may see another's old data), maps it, and runs the instruction again. Only now does the heap use RAM: one 4 KiB page."
        : `This write reaches page ${page} of the heap, which nothing has written yet: another page fault, another zeroed page of RAM mapped in. The heap's ${Math.round(t.state.heap.size / 1024)} KiB were only promised; RAM arrives one page at a time, as the program uses it.`,
      code: [C.fault, C.userFault, C.anonPage],
      timescale: "us",
    },
    { pages: [...t.state.pages, ...fresh].sort((a, b) => a - b), at: line },
    fresh.map(pageKey),
  );
}

/** Ranges a new chunk from the top writes: its size field and the top's new one. */
function carving(atChunk: number, size: number): [number, number][] {
  return [
    [atChunk + 8, 8],
    [atChunk + size + 8, 8],
  ];
}

function growStep(t: Tracer, grew: number, line: number): void {
  const heap = { ...t.state.heap, size: t.state.heap.size + grew };
  t.add(
    {
      id: "brk-more",
      phase: "memory",
      path: ["glibc", "syscall", "mm"],
      frames: [
        dataFrame(1, "System call", "Moving the end of the heap", syscall("brk()", [
          { name: "From", value: hex(layout(t).heap + heap.size - grew) },
          { name: "To", value: hex(layout(t).heap + heap.size) },
          { name: "Grows by", value: `${hex(grew)} bytes` },
        ])),
      ],
      title: "brk(): the heap grows again",
      body: `The top chunk is too small for this request, so sysmalloc() moves the program break again: what is missing plus M_TOP_PAD, ${hex(grew)} bytes, in whole pages. The [heap] area grows; RAM still only arrives page by page.`,
      code: [C.sysmalloc, C.brk, C.doBrk],
      timescale: "us",
    },
    { heap, at: line },
    [CHANGE.brk, CHANGE.top],
  );
}

// ---------------------------------------------------------------- ./marks

function runSteps(t: Tracer): void {
  const L = layout(t);
  startSteps(t, {
    command: "./marks",
    name: "marks",
    exe: L.exe,
    heap: L.heap,
    ld: L.ld,
    stack: L.stack[0],
  });
  t.add(
    {
      id: "main",
      phase: "app",
      path: [PROGRAM],
      parts: MEMORY,
      title: "main() gets a stack frame",
      body: `main() starts as most functions do without optimisation: it saves the caller's rbp, points rbp at that saved value, and moves the stack pointer rsp down ${MAIN.size} bytes in one instruction. Those ${MAIN.size} bytes are main()'s frame: line, s, students, count and the rest, each at a fixed distance from rbp. Nothing is cleared. Only students = NULL and count = 0 are written, and a random canary that the compiler's stack protector checks before main() returns.`,
      code: [C.startMain],
      timescale: "ns",
    },
    { inMain: true, at: LINE.main },
    [CHANGE.main, CHANGE.students, CHANGE.count],
  );
  t.add({
    id: "fstat",
    phase: "output",
    mode: "deep",
    path: [PROGRAM, "glibc", "syscall", "vfs"],
    frames: [
      dataFrame(3, "System call", "What is standard output?", syscall("fstat(1, …)", [
        { name: "Type", value: "S_IFCHR: a character device" },
        { name: "Device", value: "major 136: a pseudo-terminal, /dev/pts/N" },
        { name: "Block size", value: `${TTY_BLOCK} bytes` },
      ])),
    ],
    title: "printf(): what is stdout?",
    body: `printf("Student name: ") is the C library's code. stdout has no buffer yet, so it makes one, and asks the kernel what stdout is with fstat(): a pseudo-terminal. So the buffer is line-buffered (it is written out at each newline) and ${TTY_BLOCK} bytes, the terminal's block size.`,
    code: [C.doallocate, C.fstat],
    timescale: "us",
  }, { at: LINE.promptName });
  t.add(
    {
      id: "first-malloc",
      phase: "memory",
      path: [PROGRAM, "glibc"],
      title: "The first malloc()",
      body: `printf() calls malloc(${TTY_BLOCK}) for stdout's buffer: the program's first allocation. malloc() first sets up its tcache, a cache of freed chunks for this thread, which needs a chunk of its own. And there is no heap to carve chunks from yet.`,
      code: [C.malloc, C.tcacheInit],
      timescale: "ns",
    },
    { at: LINE.promptName },
  );
  const tcache = initTcache(t.state.heap);
  t.add(
    {
      id: "brk",
      phase: "memory",
      path: ["glibc", "syscall", "mm"],
      frames: [
        dataFrame(1, "System call", "Moving the end of the heap", syscall("brk()", [
          { name: "From", value: hex(L.heap) },
          { name: "To", value: hex(L.heap + tcache.grew) },
          { name: "Grows by", value: `${hex(tcache.grew)} bytes (${tcache.grew / 1024} KiB)` },
        ])),
      ],
      title: "brk(): the heap is born",
      body: `sysmalloc() asks the kernel to move the program break, the end of the heap: brk(NULL) to read where it is, then brk(${hex(L.heap + tcache.grew)}). It asks for ${tcache.grew / 1024} KiB at once: what it needs, plus M_TOP_PAD (128 KiB by default), rounded up to whole pages, so most allocations after this need no system call. The kernel's do_brk_flags() only extends the memory map with a [heap] area: no RAM is used yet.`,
      code: [C.sysmalloc, C.brk, C.doBrk],
      timescale: "us",
    },
    { heap: { ...t.state.heap, size: tcache.grew }, at: LINE.promptName },
    [CHANGE.brk, CHANGE.top],
  );
  touch(t, "glibc", [[8, 8]], LINE.promptName);
  const stdout = malloc(tcache.heap, TTY_BLOCK, "stdout");
  t.add(
    {
      id: "first-chunks",
      phase: "memory",
      path: ["glibc", PROGRAM],
      parts: MEMORY,
      frames: [
        dataFrame(0, "Heap chunk", "stdout's buffer", chunkHeader(L.heap, stdout.at, chunkSize(TTY_BLOCK), `stdout's buffer, ${TTY_BLOCK} bytes`)),
      ],
      title: "The first chunks",
      body: `malloc() carves chunks from the start of the heap: ${hex(0x290)} bytes for the tcache, then ${hex(chunkSize(TTY_BLOCK))} for stdout's buffer (${TTY_BLOCK} bytes, plus an 8-byte size field, rounded up to 16). The rest of the heap is the top chunk, for later. printf() copies "Student name: " into the buffer, and stops: no newline, so nothing is written yet.`,
      code: [C.tcacheInit, C.intMalloc],
      timescale: "ns",
    },
    { heap: stdout.heap, out: "Student name: ", at: LINE.promptName },
    [chunkKey(tcache.at), chunkKey(stdout.at), CHANGE.top, CHANGE.stdout],
  );
  const stdin = malloc(stdout.heap, TTY_BLOCK, "stdin");
  touch(t, "glibc", carving(stdin.at, chunkSize(TTY_BLOCK)), LINE.fgetsName);
  t.add(
    {
      id: "stdin-buffer",
      phase: "memory",
      path: [PROGRAM, "glibc"],
      parts: MEMORY,
      title: "fgets(): stdin needs a buffer too",
      body: `fgets(line, sizeof line, stdin) asks the C library for a line. stdin has no buffer either: the same again, fstat(0), then malloc(${TTY_BLOCK}), a third chunk from the top. This time the heap has room: no brk(), and no page fault, since the chunk is on the page that is already there.`,
      code: [C.fgets, C.underflow, C.doallocate],
      timescale: "us",
    },
    { heap: stdin.heap, at: LINE.fgetsName },
    [chunkKey(stdin.at), CHANGE.top],
  );
  waitSteps(t, LINE.fgetsName, "name", "There is nothing to read yet:", stdinBuffer(t));
}

// ---------------------------------------------------------------- a name

function nameSteps(t: Tracer, typed: string): void {
  typedSteps(t, typed, LINE.fgetsName, stdinBuffer(t));
  const line = fgetsInto(t.state.line, typed);
  t.add(
    {
      id: "fgets",
      phase: "app",
      path: ["glibc", PROGRAM],
      parts: MEMORY,
      title: "fgets() fills line[]",
      body: "fgets() copies bytes from stdin's buffer into line[], in main()'s frame on the stack, up to and including the newline, then a '\\0' to end the string. The bytes after it keep whatever was there before: fgets() writes only what it read.",
      code: [C.fgets, C.getline],
      timescale: "ns",
    },
    { line, at: LINE.fgetsName },
    [CHANGE.line],
  );
  const cut = strcspnNewline(line);
  const cutLine = line.map((b, i) => (i === cut ? 0 : b));
  t.add(
    {
      id: "strcspn",
      phase: "app",
      path: [PROGRAM],
      parts: MEMORY,
      title: "The newline goes",
      body: `strcspn(line, "\\n") counts the bytes before the first newline: ${cut}. line[${cut}] = '\\0' then ends the string there, with a single one-byte store.`,
      code: [{ project: "glibc", path: "string/strcspn.c" }],
      timescale: "ns",
    },
    { line: cutLine, at: LINE.strcspn },
    [CHANGE.line],
  );

  const name = textOf(cString(cutLine));
  const size = bytesOf(name).length + 1;
  const got = malloc(t.state.heap, size, "name");
  const reused = got.from === "tcache" ? t.state.heap.chunks.find((c) => c.at === got.at) : undefined;
  if (got.grew > 0) growStep(t, got.grew, LINE.strdup);
  touch(t, "glibc", [...(got.from === "top" ? carving(got.at, chunkSize(size)) : []), [userOf(got.at), size]], LINE.strdup);
  const chunk = chunkSize(size);
  const where =
    got.from === "tcache"
      ? `The tcache holds a free chunk of exactly that size${reused?.tag === "students" ? " (the students array's old chunk, freed by realloc())" : ""}, so malloc() takes it, newest first: no carving and no system call.`
      : "The tcache has no free chunk that size, so malloc() carves one from the start of the top chunk.";
  t.add(
    {
      id: "strdup",
      phase: "memory",
      path: [PROGRAM, "glibc"],
      parts: MEMORY,
      frames: [dataFrame(1, "Heap chunk", "A copy of the name", chunkHeader(layout(t).heap, got.at, chunk, `${quoted(name, 24)} and its '\\0'`))],
      title: "strdup(): a copy on the heap",
      body: `strdup() measures the name, ${size} bytes with its '\\0', and calls malloc(${size}). The smallest chunk that holds it is ${chunk} bytes: an 8-byte size field, the bytes, rounding to 16, and never under 32. ${where} strdup() copies the bytes in and returns their address, which main() stores in s.name.`,
      code: [C.strdup, got.from === "tcache" ? C.tcacheGet : C.intMalloc],
      timescale: "ns",
    },
    {
      heap: got.heap,
      names: { ...t.state.names, [got.at]: name },
      s: { ...t.state.s, name: userOf(got.at) },
      at: LINE.strdup,
    },
    [chunkKey(got.at), CHANGE.name, ...(got.from === "top" ? [CHANGE.top] : [CHANGE.tcache])],
  );

  const prompt = `Marks for ${name} (3 numbers, 0 to 100): `;
  promptStep(
    t,
    "printf-marks",
    prompt,
    LINE.promptMarks,
    `printf() formats the next prompt into stdout's buffer, reading the name through the pointer in s.name: from the heap. It ends without a newline, so it waits in the buffer.`,
  );
  callReadMarks(t);
  waitSteps(t, LINE.fgetsMarks, "marks", "Inside read_marks(), fgets() asks for the next line.", stdinBuffer(t));
}

function callReadMarks(t: Tracer): void {
  t.add(
    {
      id: "call",
      phase: "app",
      path: [PROGRAM],
      parts: MEMORY,
      title: "read_marks() gets a frame",
      body: `main() calls read_marks(line, sizeof line, s.marks). The three arguments travel in registers (rdi, rsi and rdx, by the x86-64 calling convention); call pushes the return address, and read_marks() saves rbp and moves rsp down ${CALLEE.readMarks.size} bytes. Its frame holds copies of the arguments, two addresses in main()'s frame and the number 64, and its own i. Arrays are never copied into a call: only their addresses are.`,
      timescale: "ns",
    },
    { callee: { fn: "read_marks", i: null }, at: LINE.callReadMarks },
    [CHANGE.callee],
  );
}

// ---------------------------------------------------------------- marks

function marksSteps(t: Tracer, typed: string): void {
  typedSteps(t, typed, LINE.fgetsMarks, stdinBuffer(t));
  const line = fgetsInto(t.state.line, typed);
  t.add(
    {
      id: "fgets",
      phase: "app",
      path: ["glibc", PROGRAM],
      parts: MEMORY,
      title: "fgets() fills line[] again",
      body: "fgets() copies the line into line[]. Inside read_marks(), line is a pointer to main()'s array, so the bytes land in main()'s frame, over what was there before.",
      code: [C.fgets, C.getline],
      timescale: "ns",
    },
    { line, at: LINE.fgetsMarks },
    [CHANGE.line],
  );
  const scanned = scanMarks(cString(line));
  const marks = t.state.s.marks.map((m, i) => scanned.values[i] ?? m);
  const ok = scanned.result === SUBJECTS;
  const bad = ok ? badMark(scanned.values) : -1;
  const valid = ok && bad === -1;
  const shownValues = scanned.values.join(", ");
  t.add(
    {
      id: "sscanf",
      phase: "app",
      path: [PROGRAM, "glibc"],
      parts: [...MEMORY],
      title: ok ? "sscanf() reads three numbers" : "sscanf() stops early",
      body: ok
        ? `sscanf() turns the digits into numbers, ${shownValues}, and stores each as a 4-byte int in s.marks through the marks pointer: into main()'s frame again. It returns 3, so read_marks() goes on to check them.`
        : scanned.result === -1
          ? "sscanf() finds no number at all, only the end of the line, and returns EOF (-1), not 3. Nothing is stored, and read_marks() returns 0."
          : `sscanf() reads ${scanned.result === 0 ? "no number" : `${shownValues}`}, then meets something that is not a number and stops. It returns ${scanned.result}, not 3. ${scanned.result === 0 ? "Nothing is stored" : "What it read is stored in s.marks all the same"}, and read_marks() returns 0.`,
      code: [C.sscanf],
      timescale: "ns",
    },
    { s: { ...t.state.s, marks }, at: LINE.sscanf },
    scanned.values.length > 0 ? [CHANGE.marks] : [],
  );
  if (ok) {
    const i = bad === -1 ? SUBJECTS : bad;
    t.add(
      {
        id: "check",
        phase: "app",
        path: [PROGRAM],
        parts: ALU,
        title: valid ? "Every mark from 0 to 100" : `Mark ${bad + 1} is out of range`,
        body: valid
          ? "The loop compares each mark with 0 and with 100: a compare and a conditional jump each time, with i counting in read_marks()'s frame. All three pass, so read_marks() returns 1."
          : `The loop compares each mark with 0 and with 100, i counting in read_marks()'s frame. ${scanned.values[bad]} fails, so read_marks() returns 0 straight away.`,
        timescale: "ns",
      },
      { callee: { fn: "read_marks", i }, at: LINE.check },
      [CHANGE.calleeVars],
    );
  }
  const gotValue = valid ? 1 : 0;
  t.add(
    {
      id: "return",
      phase: "app",
      path: [PROGRAM],
      parts: ALU,
      title: `read_marks() returns ${gotValue}`,
      body: `The result goes back in a register, eax. read_marks() restores rbp, and ret pops the return address into rip: main() carries on where it called, and stores ${gotValue} in got. The ${CALLEE.readMarks.size} bytes below main()'s frame are not a frame any more; they keep read_marks()'s values until the next call writes over them.`,
      timescale: "ns",
    },
    { callee: null, got: gotValue, at: LINE.callReadMarks },
    [CHANGE.callee, CHANGE.got],
  );
  if (!valid) {
    promptStep(
      t,
      "retry",
      "Please type 3 whole numbers from 0 to 100: ",
      LINE.retry,
      "got is 0, so the while loop prints a hint and calls read_marks() again. The hint goes into stdout's buffer and waits there: no newline.",
    );
    callReadMarks(t);
    waitSteps(t, LINE.fgetsMarks, "marks", "read_marks() calls fgets() again.", stdinBuffer(t));
    return;
  }

  // The array grows by one student.
  const count = t.state.count;
  const request = (count + 1) * STUDENT_SIZE;
  const before = t.state.heap;
  const old = t.state.students === 0 ? null : t.state.students - HEADER;
  const grown = realloc(before, old, request, "students");
  if (grown.grew > 0) growStep(t, grown.grew, LINE.realloc);
  const newSize = chunkSize(request);
  const oldChunk = old === null ? undefined : before.chunks.find((c) => c.at === old);
  touch(
    t,
    "glibc",
    grown.how === "grew"
      ? [[grown.at + 8, 8], [grown.at + newSize + 8, 8]]
      : grown.how === "moved" || grown.from === "top"
        ? [...carving(grown.at, newSize), [userOf(grown.at), count * STUDENT_SIZE]]
        : [],
    LINE.realloc,
  );
  const next = oldChunk ? before.chunks[before.chunks.indexOf(oldChunk) + 1] : undefined;
  const blocker =
    next?.tag === "name" && t.state.names[next.at] !== undefined
      ? `the chunk of ${quoted(t.state.names[next.at]!, 20)}`
      : "another chunk";
  const realloced =
    grown.how === "malloc"
      ? `students is NULL, so realloc(NULL, ${request}) works as malloc(${request}): a ${newSize}-byte chunk${grown.from === "tcache" ? " from the tcache" : ", carved from the top"}. Its address goes in grown.`
      : grown.how === "grew"
        ? `The array's chunk ends where the top chunk starts, so realloc() grows it where it is: from ${oldChunk?.size ?? 0} to ${newSize} bytes, and the top shrinks. Nothing is copied, and the address stays the same.`
        : grown.how === "moved"
          ? `The array can't grow where it is: ${blocker} sits right after it. realloc() takes a new ${newSize}-byte chunk from the top, copies the ${count * STUDENT_SIZE} bytes of the students so far, and frees the old chunk into the tcache. The old address is stale now: main() must use the one realloc() returns.`
          : `The chunk already has room for ${count + 1} students, so realloc() returns the same address.`;
  t.add(
    {
      id: "realloc",
      phase: "memory",
      path: [PROGRAM, "glibc"],
      parts: MEMORY,
      frames: [dataFrame(1, "Heap chunk", "The students array", chunkHeader(layout(t).heap, grown.at, newSize, `${count + 1} × struct student, ${STUDENT_SIZE} bytes each`))],
      title:
        grown.how === "malloc"
          ? "realloc(): the array is born"
          : grown.how === "grew"
            ? "realloc(): the array grows in place"
            : grown.how === "moved"
              ? "realloc(): the array moves"
              : "realloc(): room already",
      body: `realloc(students, ${count + 1} × ${STUDENT_SIZE}) asks for room for one more student. ${realloced}`,
      code: [C.realloc, ...(grown.how === "moved" ? [C.tcachePut] : grown.how === "malloc" ? [C.malloc] : [])],
      timescale: "ns",
    },
    { heap: grown.heap, grown: userOf(grown.at), at: LINE.realloc },
    [
      chunkKey(grown.at),
      CHANGE.grown,
      ...(grown.how === "moved" && grown.freed !== undefined ? [chunkKey(grown.freed), CHANGE.tcache] : []),
      ...(grown.how !== "fits" ? [CHANGE.top] : []),
    ],
  );
  touch(t, PROGRAM, [[userOf(grown.at) + count * STUDENT_SIZE, STUDENT_SIZE]], LINE.store);
  const s = t.state.s;
  t.add(
    {
      id: "store",
      phase: "app",
      path: [PROGRAM],
      parts: MEMORY,
      title: "students[count++] = s",
      body: `students = grown keeps the new address. Then the struct is copied into the array's last place: ${STUDENT_SIZE} bytes, the name pointer, the three marks, and 4 bytes of padding that are copied as they are. The name itself is not copied: s.name and the array now point to the same chunk. count becomes ${count + 1}.`,
      timescale: "ns",
    },
    {
      students: userOf(grown.at),
      list: [...t.state.list, { name: s.name ?? 0, marks: s.marks.map((m) => m ?? 0) }],
      count: count + 1,
      at: LINE.store,
    },
    [CHANGE.students, CHANGE.count, chunkKey(grown.at)],
  );
  promptStep(
    t,
    "printf-again",
    "Add another student? (y/n) ",
    LINE.promptAgain,
    "The next question goes into stdout's buffer, and waits: no newline at its end.",
  );
  waitSteps(t, LINE.fgetsAgain, "again", "fgets() asks for your answer.", stdinBuffer(t));
}

// ---------------------------------------------------------------- y or n

function againSteps(t: Tracer, typed: string): void {
  typedSteps(t, typed, LINE.fgetsAgain, stdinBuffer(t));
  const line = fgetsInto(t.state.line, typed);
  const more = line[0] === 0x79 || line[0] === 0x59;
  t.add(
    {
      id: "fgets",
      phase: "app",
      path: ["glibc", PROGRAM],
      parts: MEMORY,
      title: more ? "Another student" : "No more students",
      body: more
        ? "fgets() puts your answer in line[], over the start of what was there. line[0] is 'y', so the loop goes round again."
        : `fgets() puts your answer in line[]. line[0] is ${line[0] === 0x0a ? "the newline" : `'${String.fromCharCode(line[0] ?? 63)}'`}, not 'y', so break leaves the loop.`,
      code: [C.fgets],
      timescale: "ns",
    },
    { line, at: LINE.fgetsAgain },
    [CHANGE.line],
  );
  if (more) {
    promptStep(t, "printf-name", "Student name: ", LINE.promptName, "The first prompt again, into stdout's buffer. Both buffers exist now: no fstat(), no malloc().");
    waitSteps(t, LINE.fgetsName, "name", "fgets() asks for the next name.", stdinBuffer(t));
    return;
  }
  finishSteps(t);
}

function finishSteps(t: Tracer): void {
  const { list, names } = t.state;
  const first = list[0];
  if (first) {
    const sum = first.marks.reduce((a, b) => a + b, 0);
    t.add(
      {
        id: "average",
        phase: "app",
        path: [PROGRAM],
        parts: MEMORY,
        title: "average() in the red zone",
        body: `For each student, main() first works out the arguments of printf(), and so calls average(students[i].marks, 3). average() calls no other function, so the compiler doesn't even move rsp: its locals, sum and i, live in the red zone, the 128 bytes below rsp that the x86-64 ABI promises signal handlers will leave alone. sum += marks[i] loads each mark from the array on the heap.`,
        timescale: "ns",
      },
      { callee: { fn: "average", student: 0, sum, i: SUBJECTS }, printI: 0, at: LINE.sum },
      [CHANGE.callee, CHANGE.printI],
    );
    t.add(
      {
        id: "divide",
        phase: "app",
        path: [PROGRAM],
        parts: ALU,
        title: "Floating point",
        body: `(double)sum / n: the cvtsi2sd instruction turns the ints into doubles in xmm registers, and divsd divides them, in the vector part of the execution units. average() returns ${third(sum)} in xmm0 and pops its saved rbp; it never moved rsp, so there is nothing else to give back.`,
        timescale: "ns",
      },
      { at: LINE.divide },
    );
  }
  const rows = list.map((st) => formatRow(names[st.name - HEADER] ?? "", st.marks));
  t.add(
    {
      id: "rows",
      phase: "output",
      path: [PROGRAM, "glibc", "syscall", "tty", "terminal"],
      frames: rows.length
        ? [dataFrame(2, "System call", "One row, one write()", syscall("write(1, …)", [
            { name: "File descriptor", value: "1: standard output" },
            { name: "Bytes", value: quoted(`${rows[0]}\n`, 44) },
            { name: "Count", value: String(bytesOf(`${rows[0]}\n`).length) },
          ]))]
        : undefined,
      title: rows.length === 0 ? "No rows to print" : rows.length === 1 ? "The row is printed" : `${rows.length} rows, ${rows.length} write() calls`,
      body:
        rows.length === 0
          ? "No students, so the loops do nothing."
          : `printf() formats each row into stdout's buffer, and the newline at its end flushes it: stdout is line-buffered, so each row is one write(), one trip through the kernel to the terminal.`,
      code: [C.write, C.ttyWrite],
      timescale: "us",
      ui: { terminalAppend: rows.map((text) => ({ kind: "output" as const, text })) },
    },
    { callee: null, printI: list.length, at: LINE.printRow },
    [CHANGE.callee, CHANGE.printI],
  );
  let heap = t.state.heap;
  const tos: string[] = [];
  for (const st of list) {
    const freed = free(heap, st.name - HEADER);
    heap = freed.heap;
    tos.push(freed.to);
  }
  const arrayChunk = t.state.students === 0 ? null : t.state.students - HEADER;
  if (arrayChunk !== null) {
    const freed = free(heap, arrayChunk);
    heap = freed.heap;
    tos.push(freed.to);
  }
  const allTcache = tos.every((to) => to === "tcache");
  t.add(
    {
      id: "free",
      phase: "memory",
      path: [PROGRAM, "glibc"],
      parts: MEMORY,
      title: list.length === 0 ? "free(NULL)" : "free(): back to the tcache",
      body:
        list.length === 0
          ? "No student was stored, so the loop frees no name, and students is still NULL: free(NULL) does nothing at all, as the C standard says it must."
          : `free() puts each name's chunk, then the array's, ${allTcache ? "in the tcache" : "in the tcache while its list has room, otherwise in another free list"}: one list per chunk size, newest first, up to 7 each. The chunks stay part of the heap, their first 16 bytes now the list's links. free() almost never gives memory back to the kernel: a later malloc() would reuse these chunks.`,
      code: [C.free, C.tcachePut],
      timescale: "ns",
    },
    { heap, freeI: list.length, at: LINE.freeArray },
    [...list.map((st) => chunkKey(st.name - HEADER)), ...(arrayChunk === null ? [] : [chunkKey(arrayChunk)]), CHANGE.freeI, CHANGE.tcache],
  );
  exitSteps(t, "marks", LINE.ret, { inMain: false }, "");
}

/** sum / 3 as a person would write it: exact, or with an ellipsis. */
function third(sum: number): string {
  return sum % SUBJECTS === 0 ? (sum / SUBJECTS).toFixed(1) : `${(sum / SUBJECTS).toFixed(3)}…`;
}

// ---------------------------------------------------------------- scenarios

export function runMarks(apps: AppState): Scenario {
  const previous = apps.program?.kind === "marks" ? apps.program.run : -1;
  const t = tracer<ProgramState>(startProgram(previous + 1));
  runSteps(t);
  return { kind: "runProgram", app: "terminal", title: "./marks", focus: "split", steps: t.steps };
}

// ---------------------------------------------------------------- Ctrl+D and Ctrl+C

/** Ctrl+D while ./marks waits for a line: fgets() returns NULL, and main() leaves its loop as for n. */
export function marksEof(program: ProgramState): Scenario {
  const t = tracer<ProgramState>({ ...program, changed: [] });
  const stage = program.stage;
  eofSteps(t, stage === "name" ? LINE.fgetsName : stage === "marks" ? LINE.fgetsMarks : LINE.fgetsAgain, stdinBuffer(t));
  if (stage === "marks") {
    t.add(
      {
        id: "return",
        phase: "app",
        path: [PROGRAM],
        parts: ALU,
        title: "read_marks() returns -1",
        body: "fgets() returned NULL, so read_marks() returns -1 at once, as its comment promises for the end of input. main() stores -1 in got: the while loop stops, since -1 is not 0.",
        timescale: "ns",
      },
      { callee: null, got: -1, at: LINE.callReadMarks },
      [CHANGE.callee, CHANGE.got],
    );
    const name = t.state.s.name;
    if (name !== null && name !== 0) {
      const freed = free(t.state.heap, name - HEADER);
      t.add(
        {
          id: "free-name",
          phase: "memory",
          path: [PROGRAM, "glibc"],
          parts: MEMORY,
          title: "free(s.name), then break",
          body: `got < 0: no student will hold the name strdup() copied, so main() frees it before break leaves the loop. Its chunk goes to the ${freed.to === "tcache" ? "tcache" : "free lists"}, and s.name keeps the old address: a dangling pointer, which nothing uses again.`,
          code: [C.free, C.tcachePut],
          timescale: "ns",
        },
        { heap: freed.heap, at: LINE.freeName },
        [chunkKey(name - HEADER), CHANGE.tcache],
      );
    }
  } else {
    t.add(
      {
        id: "break",
        phase: "app",
        path: [PROGRAM],
        parts: ALU,
        title: "fgets() returned NULL: break",
        body:
          stage === "name"
            ? "main() tests what fgets() returned: NULL, so break leaves the loop before strdup(). line[] keeps what it held."
            : "fgets() returned NULL, so the condition is true without even looking at line[0]: break leaves the loop, as n does.",
        timescale: "ns",
      },
      { at: stage === "name" ? LINE.breakName : LINE.breakAgain },
    );
  }
  finishSteps(t);
  return { kind: "programEof", app: "terminal", title: "Ctrl+D: end of input", focus: "split", steps: t.steps };
}

/** Ctrl+C while ./marks runs: SIGINT ends it wherever it is, without a free() or a return from main(). */
export function marksInterrupt(program: ProgramState): Scenario {
  const t = tracer<ProgramState>({ ...program, changed: [] });
  const asleep = program.stage !== "running";
  interruptSteps(t, {
    name: "./marks",
    line: program.at,
    sleeping: asleep ? ["main(), asleep in read()"] : [],
    running: asleep ? [] : [{ what: "./marks", core: 0 }],
    waiting: [],
    patch: { inMain: false, callee: null, endedBy: "interrupt" },
    undone: "main() never returns, and neither free() nor exit() runs, so the C library tidies up nothing.",
  });
  return { kind: "interrupt", app: "terminal", title: "Ctrl+C: SIGINT", focus: "split", steps: t.steps };
}

/** A line typed while ./marks waits for a name, marks, or y or n. */
export function marksInput(program: ProgramState, text: string): Scenario {
  const t = tracer<ProgramState>({ ...program, changed: [] });
  const said = text === "" ? "(an empty line)" : text;
  const title =
    program.stage === "name" ? `Name: ${said}` : program.stage === "marks" ? `Marks: ${said}` : `Another? ${said}`;
  if (program.stage === "name") nameSteps(t, text);
  else if (program.stage === "marks") marksSteps(t, text);
  else againSteps(t, text);
  return { kind: "programInput", app: "terminal", title, focus: "split", steps: t.steps };
}
