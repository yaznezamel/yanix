import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_HEAP, chunkSize, free, fromTop, initTcache, malloc, pagesOf, realloc, topSize, type Heap } from "./heap";
import { CALLEE, MAIN, layoutOf } from "./layout";
import {
  badMark,
  bytesOf,
  cString,
  fgetsInto,
  fitInput,
  formatRow,
  MAX_INPUT_BYTES,
  scanMarks,
  startProgram,
  strcspnNewline,
} from "./program";
import { MARKS_C, lineOf, sourceLine } from "./source";

// The numbers here were measured on the real program with gdb (see
// examples/marks/README.md): three students, Yazn, Sam and Lee, typed in on a
// pseudo-terminal. The model must give the same layout.

const layout = (heap: Heap) => heap.chunks.map((c) => `${c.at.toString(16)}:${c.size.toString(16)}`);

describe("the C source", () => {
  it("is examples/marks/marks.c, line for line", () => {
    const file = readFileSync(join(__dirname, "../../../../examples/marks/marks.c"), "utf8");
    expect(MARKS_C.join("\n")).toBe(file.replace(/\n$/, ""));
  });

  it("finds lines by their text", () => {
    expect(lineOf("s.name = strdup(line)")).toBe(66);
    expect(lineOf("free(students);")).toBe(100);
    expect(lineOf("return 0;")).toBe(37);
    expect(lineOf("return 0;", 54)).toBe(101);
    expect(() => lineOf("no such code")).toThrow();
    expect(sourceLine(66)).toBe("s.name = strdup(line);");
    expect(sourceLine(0)).toBeNull();
  });
});

describe("the malloc model", () => {
  it("sizes chunks as glibc does: 16-byte steps, header included, 32 at least", () => {
    expect(chunkSize(0)).toBe(0x20);
    expect(chunkSize(5)).toBe(0x20);
    expect(chunkSize(24)).toBe(0x20);
    expect(chunkSize(25)).toBe(0x30);
    expect(chunkSize(48)).toBe(0x40);
    expect(chunkSize(72)).toBe(0x50);
    expect(chunkSize(0x280)).toBe(0x290);
    expect(chunkSize(1024)).toBe(0x410);
  });

  it("grows the heap by 132 KiB on the first malloc(), for the tcache", () => {
    const first = initTcache(NO_HEAP);
    expect(first.grew).toBe(0x21000);
    expect(first.at).toBe(0);
    expect(layout(first.heap)).toEqual(["0:290"]);
  });

  it("lays out three students as gdb showed", () => {
    let heap = initTcache(NO_HEAP).heap;
    heap = malloc(heap, 1024, "stdout").heap;
    heap = malloc(heap, 1024, "stdin").heap;
    expect(layout(heap)).toEqual(["0:290", "290:410", "6a0:410"]);

    const yazn = malloc(heap, 5, "name");
    expect([yazn.at, yazn.from, yazn.grew]).toEqual([0xab0, "top", 0]);
    const one = realloc(yazn.heap, null, 24, "students");
    expect([one.at, one.how]).toEqual([0xad0, "malloc"]);
    expect(topSize(one.heap)).toBe(0x20510);

    const sam = malloc(one.heap, 4, "name");
    expect(sam.at).toBe(0xaf0);
    const two = realloc(sam.heap, one.at, 48, "students");
    expect([two.at, two.how, two.freed]).toEqual([0xb10, "moved", 0xad0]);
    expect(two.heap.tcache[0x20]).toEqual([0xad0]);

    const lee = malloc(two.heap, 4, "name");
    expect([lee.at, lee.from]).toEqual([0xad0, "tcache"]);
    const three = realloc(lee.heap, two.at, 72, "students");
    expect([three.at, three.how]).toEqual([0xb10, "grew"]);
    expect(layout(three.heap)).toEqual(["0:290", "290:410", "6a0:410", "ab0:20", "ad0:20", "af0:20", "b10:50"]);
    expect(three.heap.top).toBe(0xb60);
    expect(topSize(three.heap)).toBe(0x204a0);

    // The program's last lines: every name, then the array. All into the tcache.
    let end = three.heap;
    for (const name of [0xab0, 0xaf0, 0xad0]) end = free(end, name).heap;
    const last = free(end, 0xb10);
    expect(last.to).toBe("tcache");
    expect(last.heap.tcache[0x20]?.length).toBe(3);
    expect(last.heap.tcache[0x50]?.length).toBe(1);
    expect(last.heap.size).toBe(0x21000);
  });

  it("keeps seven chunks per tcache list, then uses a fastbin, then merges into the top", () => {
    let heap = initTcache(NO_HEAP).heap;
    const small: number[] = [];
    for (let i = 0; i < 8; i++) {
      const got = malloc(heap, 8, "name");
      heap = got.heap;
      small.push(got.at);
    }
    // 0xd0-byte chunks are too big for a fastbin.
    const big: number[] = [];
    for (let i = 0; i < 9; i++) {
      const got = malloc(heap, 200, "students");
      heap = got.heap;
      big.push(got.at);
    }
    for (const at of small.slice(0, 7)) {
      const freed = free(heap, at);
      expect(freed.to).toBe("tcache");
      heap = freed.heap;
    }
    const eighth = free(heap, small[7]!);
    expect(eighth.to).toBe("fastbin");
    heap = eighth.heap;
    for (const at of big.slice(1, 8)) heap = free(heap, at).heap;
    // That list is full now: the first big chunk goes to a bin, the last merges into the top.
    const binned = free(heap, big[0]!);
    expect(binned.to).toBe("bin");
    const topped = free(binned.heap, big[8]!);
    expect(topped.to).toBe("top");
    expect(topped.heap.top).toBe(big[8]);
  });

  it("grows the heap again, by what is missing plus M_TOP_PAD, when the top runs out", () => {
    const start = initTcache(NO_HEAP).heap;
    const full = fromTop(start, topSize(start) - 0x100, "students").heap;
    const next = malloc(full, 0x200, "name");
    // 0x210 needed, 0x100 left: 0x210 + 0x20000 + 0x20 - 0x100, in whole pages.
    expect(next.grew).toBe(0x21000);
    expect(next.heap.size).toBe(0x42000);
    expect(next.at).toBe(full.top);
  });

  it("names the pages a range touches", () => {
    expect(pagesOf(0xab0, 5)).toEqual([0]);
    expect(pagesOf(0xff8, 16)).toEqual([0, 1]);
    expect(pagesOf(0x1000, 0)).toEqual([]);
  });
});

describe("the C semantics", () => {
  it("reads a line with fgets() and cuts the newline with strcspn()", () => {
    const line = fgetsInto(startProgram(0).line, "Yazn");
    expect(line.slice(0, 7)).toEqual([0x59, 0x61, 0x7a, 0x6e, 0x0a, 0, null]);
    expect(strcspnNewline(line)).toBe(4);
    const again = fgetsInto(fgetsInto(line, "72 85 90"), "y");
    // The old bytes stay after the new string's '\0'.
    expect(cString(again)).toEqual([0x79, 0x0a]);
    expect(again[3]).toBe(0x38);
  });

  it("parses marks as sscanf(\"%d %d %d\") does", () => {
    expect(scanMarks(bytesOf("72 85 90\n"))).toEqual({ result: 3, values: [72, 85, 90] });
    expect(scanMarks(bytesOf("  +7\t-3 100\n"))).toEqual({ result: 3, values: [7, -3, 100] });
    expect(scanMarks(bytesOf("50 abc\n"))).toEqual({ result: 1, values: [50] });
    expect(scanMarks(bytesOf("72.5 80 90\n"))).toEqual({ result: 1, values: [72] });
    expect(scanMarks(bytesOf("\n"))).toEqual({ result: -1, values: [] });
    expect(scanMarks(bytesOf("abc\n"))).toEqual({ result: 0, values: [] });
    expect(scanMarks(bytesOf("1 2\n"))).toEqual({ result: 2, values: [1, 2] });
    // strtol saturates at long's range; the cast to int keeps the low 32 bits.
    expect(scanMarks(bytesOf("4294967297 0 0\n")).values[0]).toBe(1);
    expect(scanMarks(bytesOf("99999999999999999999 0 0\n")).values[0]).toBe(-1);
  });

  it("finds the first mark out of range", () => {
    expect(badMark([72, 85, 90])).toBe(-1);
    expect(badMark([72, 101, -1])).toBe(1);
  });

  it("prints rows as printf(\"%-12s %3d %3d %3d   average %5.1f\") does", () => {
    expect(formatRow("Yazn", [72, 85, 90])).toBe("Yazn          72  85  90   average  82.3");
    expect(formatRow("Sam", [60, 70, 80])).toBe("Sam           60  70  80   average  70.0");
    expect(formatRow("Bartholomew Jr", [100, 100, 100])).toBe("Bartholomew Jr 100 100 100   average 100.0");
  });

  it("keeps typed lines short enough for one fgets()", () => {
    expect(fitInput("x".repeat(100))).toHaveLength(MAX_INPUT_BYTES);
    expect(bytesOf(fitInput("é".repeat(40))).length).toBeLessThanOrEqual(MAX_INPUT_BYTES);
  });
});

describe("the measured layout", () => {
  it("places main()'s locals inside its 160-byte frame, and read_marks() below it", () => {
    for (const offset of [MAIN.line, MAIN.s, MAIN.grown, MAIN.count, MAIN.students, MAIN.got]) {
      expect(offset).toBeLessThan(0);
      expect(offset).toBeGreaterThanOrEqual(-MAIN.size);
    }
    // gdb: main()'s rbp 0x7fffffffc770, read_marks()'s 0x7fffffffc6c0.
    expect(0x7fffffffc770 + CALLEE.rbp).toBe(0x7fffffffc6c0);
  });

  it("changes addresses from run to run (ASLR), with pages and frames aligned", () => {
    const a = layoutOf(0);
    const b = layoutOf(1);
    expect(a.heap).not.toBe(b.heap);
    for (const l of [a, b, layoutOf(2)]) {
      expect(l.heap % 0x1000).toBe(0);
      expect(l.rbp % 16).toBe(0);
      expect(l.rbp).toBeGreaterThan(l.stack[0]);
      expect(l.rbp).toBeLessThan(l.stack[1]);
    }
  });
});
