// Where cores.c's data lives, as measured on the real program (GCC 13.3,
// glibc 2.39, x86-64, 4 cores, built by examples/cores/Makefile, on a
// pseudo-terminal): frame offsets from gdb, the mappings from /proc/PID/maps,
// and three runs' addresses with ASLR on. examples/cores/README.md says how to
// see them yourself.

/** One run's addresses: ASLR picks new ones every time the program starts. */
export interface CoresLayout {
  exe: number;
  /** The heap: here only the C library's own chunks (the tcache, stdio's buffers). */
  heap: number;
  libc: number;
  ld: number;
  stack: [number, number];
  /** main()'s frame pointer. */
  rbp: number;
}

export const CORES_LAYOUTS: CoresLayout[] = [
  {
    exe: 0x5617544b4000,
    heap: 0x561790288000,
    libc: 0x7f8120c00000,
    ld: 0x7f8120e31000,
    stack: [0x7ffe0f082000, 0x7ffe0f0a5000],
    rbp: 0x7ffe0f0a1f80,
  },
  {
    exe: 0x56122401e000,
    heap: 0x56126187a000,
    libc: 0x7f8941600000,
    ld: 0x7f89419b9000,
    stack: [0x7ffd6cfa5000, 0x7ffd6cfc8000],
    rbp: 0x7ffd6cfc41b0,
  },
  {
    exe: 0x55d8d6469000,
    heap: 0x55d907f14000,
    libc: 0x7f7979800000,
    ld: 0x7f7979b62000,
    stack: [0x7fffd370c000, 0x7fffd372f000],
    rbp: 0x7fffd372b650,
  },
];

export function coresLayoutOf(run: number): CoresLayout {
  return CORES_LAYOUTS[run % CORES_LAYOUTS.length]!;
}

/** Marks in the array, and the most threads the program starts. */
export const MARKS = 1000000;
export const MAX_THREADS = 4;

/**
 * The array's mapping: 4,000,000 bytes and malloc()'s 16-byte header, rounded
 * up to whole pages (977). The kernel placed it right below the C library.
 */
export const ARRAY_MAP = 0x3d1000;
export const ARRAY_PAGES = ARRAY_MAP / 0x1000;

/** A thread's stack mapping: 8 MiB (RLIMIT_STACK) and a 4 KiB guard page under it. */
export const STACK_MAP = 0x801000;
export const GUARD = 0x1000;
/** From the top of a thread's stack mapping: glibc's descriptor (pthread_t), and add_up()'s rbp. */
export const DESCRIPTOR = 0x940;
export const ADD_UP_RBP = 0x1140;

/** The array's mapping, and where malloc() put the array in it. */
export function arrayMapping(layout: CoresLayout): { start: number; pointer: number } {
  const start = layout.libc - ARRAY_MAP;
  return { start, pointer: start + 0x10 };
}

/** The n-th stack mapping glibc made (from 0), each below the one before. */
export function stackMapping(layout: CoresLayout, index: number): { start: number; top: number } {
  const top = arrayMapping(layout).start - index * STACK_MAP;
  return { start: top - STACK_MAP, top };
}

/** main()'s frame: 320 bytes below rbp. Offsets are from rbp. */
export const CORES_MAIN = {
  size: 0x140,
  canary: -0x8,
  line: -0x20,
  slices: -0xc0,
  ids: -0xe0,
  threads: -0x110,
  per: -0x118,
  marks: -0x120,
  total: -0x128,
  fillI: -0x130,
  joinT: -0x134,
  createT: -0x138,
} as const;

/** struct slice: a pointer, two size_t, a long and an int, padded to 40 bytes. */
export const SLICE = { size: 40, marks: 0, first: 8, count: 16, sum: 24, cpu: 32 } as const;

/** add_up()'s frame: 48 bytes below its rbp. */
export const ADD_UP = { size: 0x30, slice: -0x8, i: -0x10, sum: -0x18, arg: -0x28 } as const;

/** Return addresses, as offsets into libc.so.6 for this build. */
export const CORES_RETURNS = {
  /** main() returns into __libc_start_call_main(). */
  main: 0x2a1ca,
  /** add_up() returns into start_thread(). */
  addUp: 0x9cb84,
} as const;
