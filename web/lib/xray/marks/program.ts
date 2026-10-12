import { HEADER, NO_HEAP, PAGE, type Heap } from "./heap";

// The state of examples/marks/marks.c while it runs in the lab: main()'s
// locals, the frame below main()'s when there is one, the heap, and what the
// C library holds in its buffers. Each step of a trace carries a copy, so the
// memory view can be scrubbed back and forth like everything else.
//
// A null value is memory the program has not written: whatever bytes were
// there before. C does not clear locals, and neither does this model.

/** The signal that ended a program, if one did: its terminal hung up, or Ctrl+C. */
export type Ending = "hangup" | "interrupt";

/** What the program is doing: not started yet, running, blocked in fgets() waiting for a name, marks or y/n, or gone. */
export type Stage = "starting" | "running" | "name" | "marks" | "again" | "exited";

/** A function main() called whose frame is on the stack right now. */
export type Callee =
  | { fn: "read_marks"; i: number | null }
  | { fn: "average"; student: number; sum: number | null; i: number | null };

export interface Student {
  /** Heap offset of the name's bytes: what students[i].name points to. */
  name: number;
  marks: number[];
}

export interface ProgramState {
  kind: "marks";
  /** Which run of ./marks this is: each picks other addresses (ASLR). */
  run: number;
  stage: Stage;
  /** The line of marks.c the step is about; 0 before main() runs. */
  at: number;
  /** main() has a frame: from its first instruction until it returns. */
  inMain: boolean;
  callee: Callee | null;
  /** char line[64], byte by byte. */
  line: (number | null)[];
  /** struct student s: the name pointer (a heap offset) and the marks. */
  s: { name: number | null; marks: (number | null)[] };
  /** The students pointer as a heap offset; 0 is NULL. */
  students: number;
  count: number;
  got: number | null;
  grown: number | null;
  /** The counters of main()'s two last loops: printing, then freeing. */
  printI: number | null;
  freeI: number | null;
  heap: Heap;
  /** Pages of the heap with RAM behind them, written at least once. */
  pages: number[];
  /** The text in each name chunk, by chunk offset. */
  names: Record<number, string>;
  /** The array's contents, as main() stored them. */
  list: Student[];
  /** Text in stdout's buffer that is not written yet. */
  out: string;
  /** The last bytes read() put in stdin's buffer. */
  inbuf: string;
  /** What the step changed, for the memory view to point out (see CHANGE). */
  changed: string[];
  /** A signal ended it: its terminal hung up (closed while it ran), or Ctrl+C. */
  endedBy?: Ending;
}

/**
 * Keys for the parts of memory a step changes. Chunks are "heap:" plus their
 * offset, pages "page:" plus their number.
 */
export const CHANGE = {
  line: "line",
  name: "s.name",
  marks: "s.marks",
  students: "students",
  count: "count",
  got: "got",
  grown: "grown",
  printI: "printI",
  freeI: "freeI",
  main: "frame:main",
  callee: "frame:callee",
  calleeVars: "callee",
  brk: "brk",
  top: "top",
  stdout: "stdout",
  stdin: "stdin",
  tcache: "tcache",
} as const;

export const chunkKey = (at: number) => `heap:${at}`;
export const pageKey = (page: number) => `page:${page}`;

export const SUBJECTS = 3;
export const LINE_SIZE = 64;

/** The program as bash is about to start it: no process yet; after execve(), no main() and no heap. */
export function startProgram(run: number): ProgramState {
  return {
    kind: "marks",
    run,
    stage: "starting",
    at: 0,
    inMain: false,
    callee: null,
    line: Array.from({ length: LINE_SIZE }, () => null),
    s: { name: null, marks: [null, null, null] },
    students: 0,
    count: 0,
    got: null,
    grown: null,
    printI: null,
    freeI: null,
    heap: NO_HEAP,
    pages: [],
    names: {},
    list: [],
    out: "",
    inbuf: "",
    changed: [],
  };
}

const encoder = new TextEncoder();

/** The bytes of a string in UTF-8, as the terminal sends them. */
export function bytesOf(text: string): number[] {
  return Array.from(encoder.encode(text));
}

const decoder = new TextDecoder();

export function textOf(bytes: number[]): string {
  return decoder.decode(new Uint8Array(bytes));
}

/** The C string at the start of line[]: its bytes up to the first '\0'. */
export function cString(line: (number | null)[]): number[] {
  const out: number[] = [];
  for (const b of line) {
    if (b === null || b === 0) break;
    out.push(b);
  }
  return out;
}

/** fgets(line, 64, stdin) for a line typed with Enter: the bytes, '\n' included, then '\0'. */
export function fgetsInto(line: (number | null)[], typed: string): (number | null)[] {
  const bytes = [...bytesOf(typed), 0x0a, 0];
  if (bytes.length > LINE_SIZE) throw new Error("line too long for line[64]");
  return line.map((b, i) => (i < bytes.length ? bytes[i]! : b));
}

/** strcspn(line, "\n"): how many bytes come before the first newline. */
export function strcspnNewline(line: (number | null)[]): number {
  const s = cString(line);
  const at = s.indexOf(0x0a);
  return at === -1 ? s.length : at;
}

/** The longest line the lab lets you type: fgets() then reads it, newline and all, in one go. */
export const MAX_INPUT_BYTES = LINE_SIZE - 2;

/** Cuts typed text to what one fgets() reads whole (line[64] by default), at a character boundary. */
export function fitInput(text: string, max = MAX_INPUT_BYTES): string {
  let out = "";
  for (const ch of text) {
    if (bytesOf(out + ch).length > max) break;
    out += ch;
  }
  return out;
}

const isSpace = (b: number) => b === 0x20 || (b >= 0x09 && b <= 0x0d);
const isDigit = (b: number) => b >= 0x30 && b <= 0x39;

// long is 64 bits on x86-64. (BigInt() rather than 1n: the project targets ES2017.)
const LONG_MAX = BigInt("9223372036854775807");
const LONG_MIN = BigInt("-9223372036854775808");

export interface Scanned {
  /** What sscanf() returns: conversions done, or -1 (EOF) if the input ended before the first. */
  result: number;
  /** The values stored, in order: only the successful conversions. */
  values: number[];
}

/**
 * sscanf(line, "%d %d …", ...) with `count` conversions, as glibc does it:
 * each %d skips white space, reads an optional sign and at least one digit
 * (strtol saturates at long's range, then the value is cut to an int), and
 * the first failure stops it.
 */
export function scanInts(bytes: number[], count: number): Scanned {
  const values: number[] = [];
  let i = 0;
  for (let n = 0; n < count; n++) {
    while (i < bytes.length && isSpace(bytes[i]!)) i++;
    if (i >= bytes.length) return { result: n === 0 ? -1 : n, values };
    let j = i;
    if (bytes[j] === 0x2b || bytes[j] === 0x2d) j++;
    const digitsStart = j;
    while (j < bytes.length && isDigit(bytes[j]!)) j++;
    if (j === digitsStart) return { result: n, values };
    let value = BigInt(textOf(bytes.slice(digitsStart, j)));
    if (bytes[i] === 0x2d) value = -value;
    if (value > LONG_MAX) value = LONG_MAX;
    if (value < LONG_MIN) value = LONG_MIN;
    values.push(Number(BigInt.asIntN(32, value)));
    i = j;
  }
  return { result: count, values };
}

/** sscanf(line, "%d %d %d", ...): read_marks()'s three marks. */
export function scanMarks(bytes: number[]): Scanned {
  return scanInts(bytes, SUBJECTS);
}

/** read_marks()'s check after sscanf(): the index of the first mark outside 0 to 100, or -1. */
export function badMark(marks: number[]): number {
  return marks.findIndex((m) => m < 0 || m > 100);
}

/** printf("%-12s %3d %3d %3d   average %5.1f\n", ...): widths count bytes, as C does. */
export function formatRow(name: string, marks: number[]): string {
  const pad = Math.max(0, 12 - bytesOf(name).length);
  const n = (m: number) => String(m).padStart(3);
  const sum = marks.reduce((a, b) => a + b, 0);
  return `${name}${" ".repeat(pad)} ${n(marks[0]!)} ${n(marks[1]!)} ${n(marks[2]!)}   average ${(sum / SUBJECTS).toFixed(1).padStart(5)}`;
}

/** The pointer malloc() returns for a chunk. */
export const userOf = (chunk: number) => chunk + HEADER;
export const chunkOf = (pointer: number) => pointer - HEADER;

export const pageOf = (offset: number) => Math.floor(offset / PAGE);
