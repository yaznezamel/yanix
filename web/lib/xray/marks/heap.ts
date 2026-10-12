// glibc's malloc as examples/marks/marks.c drives it, for one thread. The
// rules follow glibc 2.39's malloc/malloc.c on x86-64; the layouts they give
// match what gdb showed for the real program (see layout.test.ts).
//
// The heap is a row of chunks. Each starts with a 16-byte header (the
// previous chunk's size when it is free, then this chunk's size), and the
// program gets a pointer just past it. The space after the last chunk is the
// top chunk: malloc() carves new chunks from its start, and asks the kernel
// to move the end of the heap (brk) when it runs out.

/** Bytes from the start of a chunk to the pointer malloc() returns. */
export const HEADER = 0x10;
/** The smallest chunk: a header and room for two list pointers once freed. */
export const MIN_CHUNK = 0x20;
export const PAGE = 0x1000;
/** M_TOP_PAD's default: extra bytes asked of the kernel each time the heap grows. */
export const TOP_PAD = 0x20000;
/** Freed chunks each tcache list keeps, and the largest chunk it takes. */
export const TCACHE_COUNT = 7;
export const TCACHE_MAX = 0x410;
/** The largest chunk a fastbin takes (64 * SIZE_SZ / 4 on 64-bit). */
export const FASTBIN_MAX = 0x80;

/**
 * Where a chunk is: in use by the program, or free in one of glibc's lists.
 * The program frees nothing until its last lines, and every free before that
 * fits in the tcache, so only those last frees can reach a fastbin or a bin.
 */
export type ChunkState = "used" | "tcache" | "fastbin" | "bin";

export interface Chunk {
  /** Offset of the chunk's header from the heap's start. */
  at: number;
  size: number;
  state: ChunkState;
  /** What the chunk holds, for the memory view: "tcache", "stdout", "stdin", "name" or "students". */
  tag: string;
}

export interface Heap {
  /** Bytes between the heap's start and the program break: 0 until the first malloc(). */
  size: number;
  /** Chunks in address order. The top chunk starts where the last one ends. */
  chunks: Chunk[];
  /** Offset of the top chunk. */
  top: number;
  /** Freed chunks by size, most recently freed first. */
  tcache: Record<number, number[]>;
}

export const NO_HEAP: Heap = { size: 0, chunks: [], top: 0, tcache: {} };

/** The chunk size for a request: header and alignment included, at least MIN_CHUNK (request2size). */
export function chunkSize(request: number): number {
  return Math.max(MIN_CHUNK, (request + 8 + 15) & ~15);
}

export const topSize = (heap: Heap): number => heap.size - heap.top;

const alignUp = (n: number, to: number) => Math.ceil(n / to) * to;

function chunkAt(heap: Heap, at: number): Chunk {
  const chunk = heap.chunks.find((c) => c.at === at);
  if (!chunk) throw new Error(`no chunk at ${at.toString(16)}`);
  return chunk;
}

function replace(heap: Heap, at: number, next: Chunk[]): Chunk[] {
  return heap.chunks.flatMap((c) => (c.at === at ? next : [c]));
}

export interface Carved {
  heap: Heap;
  /** Offset of the new chunk. */
  at: number;
  /** Bytes the heap grew with brk() first, or 0. */
  grew: number;
}

/**
 * A chunk from the top (_int_malloc's last resort, and sysmalloc). When the
 * top is too small, the heap grows by what is missing plus M_TOP_PAD, rounded
 * up to whole pages: the first time, from nothing to 132 KiB at once.
 */
export function fromTop(heap: Heap, size: number, tag: string): Carved {
  let grew = 0;
  if (topSize(heap) < size + MIN_CHUNK) {
    grew = alignUp(size + TOP_PAD + MIN_CHUNK - topSize(heap), PAGE);
  }
  const at = heap.top;
  return {
    heap: { ...heap, size: heap.size + grew, top: at + size, chunks: [...heap.chunks, { at, size, state: "used", tag }] },
    at,
    grew,
  };
}

export interface Allocated extends Carved {
  /** The tcache had a chunk of that size, or the top was split. */
  from: "tcache" | "top";
}

/**
 * malloc(): the tcache first, newest chunk first, then the top. The very
 * first call also allocates the tcache itself (tcache_init), so it needs a
 * heap before your request is served.
 */
export function malloc(heap: Heap, request: number, tag: string): Allocated {
  const size = chunkSize(request);
  const cached = heap.tcache[size] ?? [];
  const reuse = cached[0];
  if (reuse !== undefined) {
    const chunk = chunkAt(heap, reuse);
    return {
      heap: {
        ...heap,
        chunks: replace(heap, reuse, [{ ...chunk, state: "used", tag }]),
        tcache: { ...heap.tcache, [size]: cached.slice(1) },
      },
      at: reuse,
      grew: 0,
      from: "tcache",
    };
  }
  return { ...fromTop(heap, size, tag), from: "top" };
}

/** The first malloc() of a program: the tcache's own chunk, from a heap brk() just made. */
export function initTcache(heap: Heap): Carved {
  return fromTop(heap, chunkSize(0x280), "tcache");
}

export interface Freed {
  heap: Heap;
  /** Where the chunk went; "top" when it merged into the top chunk. */
  to: ChunkState | "top";
}

/** free(): into the tcache while its list has room, else a fastbin, else merged with free neighbours. */
export function free(heap: Heap, at: number): Freed {
  const chunk = chunkAt(heap, at);
  if (chunk.state !== "used") throw new Error(`double free at ${at.toString(16)}`);
  const list = heap.tcache[chunk.size] ?? [];
  if (chunk.size <= TCACHE_MAX && list.length < TCACHE_COUNT) {
    return {
      heap: {
        ...heap,
        chunks: replace(heap, at, [{ ...chunk, state: "tcache" }]),
        tcache: { ...heap.tcache, [chunk.size]: [at, ...list] },
      },
      to: "tcache",
    };
  }
  if (chunk.size <= FASTBIN_MAX) {
    return { heap: { ...heap, chunks: replace(heap, at, [{ ...chunk, state: "fastbin" }]) }, to: "fastbin" };
  }
  // Chunks in the tcache and fastbins still count as in use, so only a
  // neighbour in a bin merges (_int_free_merge_chunk).
  const index = heap.chunks.indexOf(chunk);
  const before = heap.chunks[index - 1];
  const after = heap.chunks[index + 1];
  let start = chunk.at;
  let size = chunk.size;
  let chunks = heap.chunks.filter((c) => c !== chunk);
  if (before?.state === "bin") {
    start = before.at;
    size += before.size;
    chunks = chunks.filter((c) => c !== before);
  }
  if (!after) {
    return { heap: { ...heap, chunks, top: start }, to: "top" };
  }
  if (after.state === "bin") {
    size += after.size;
    chunks = chunks.filter((c) => c !== after);
  }
  const merged: Chunk = { at: start, size, state: "bin", tag: "free" };
  return {
    heap: { ...heap, chunks: [...chunks, merged].sort((a, b) => a.at - b.at) },
    to: "bin",
  };
}

export interface Reallocated extends Carved {
  /**
   * What realloc() did: "malloc" for a null pointer, "fits" when the chunk is
   * already big enough, "grew" when it took space from the top right after
   * it, "moved" when it had to copy into a new chunk and free the old one.
   */
  how: "malloc" | "fits" | "grew" | "moved";
  from?: "tcache" | "top";
  /** The old chunk, freed into the tcache, when the block moved. */
  freed?: number;
}

/** realloc() (__libc_realloc, then _int_realloc for an existing chunk). */
export function realloc(heap: Heap, at: number | null, request: number, tag: string): Reallocated {
  if (at === null) {
    const got = malloc(heap, request, tag);
    return { ...got, how: "malloc" };
  }
  const size = chunkSize(request);
  const chunk = chunkAt(heap, at);
  if (chunk.size >= size) {
    // Never the case in marks.c, whose array only grows; a big enough
    // remainder would be split off and freed.
    if (chunk.size - size < MIN_CHUNK) return { heap, at, grew: 0, how: "fits" };
    const kept: Chunk = { ...chunk, size };
    const rest: Chunk = { at: at + size, size: chunk.size - size, state: "used", tag: "free" };
    const split = { ...heap, chunks: replace(heap, at, [kept, rest]) };
    return { heap: free(split, rest.at).heap, at, grew: 0, how: "fits" };
  }
  // Right before the top: take what it needs from there, as long as at
  // least a minimal top chunk is left. Nothing is copied.
  if (chunk.at + chunk.size === heap.top && chunk.size + topSize(heap) >= size + MIN_CHUNK) {
    return {
      heap: { ...heap, top: at + size, chunks: replace(heap, at, [{ ...chunk, size }]) },
      at,
      grew: 0,
      how: "grew",
    };
  }
  // Otherwise a new chunk, which _int_malloc takes from the top: it never
  // looks in the tcache, and there is nothing in the other lists yet. The
  // contents are copied, and the old chunk is freed (into the tcache).
  const fresh = fromTop(heap, size, tag);
  const freed = free(fresh.heap, at);
  return { heap: freed.heap, at: fresh.at, grew: fresh.grew, how: "moved", from: "top", freed: at };
}

/** Pages of the heap that a range of bytes touches. */
export function pagesOf(start: number, length: number): number[] {
  if (length <= 0) return [];
  const first = Math.floor(start / PAGE);
  const last = Math.floor((start + length - 1) / PAGE);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
