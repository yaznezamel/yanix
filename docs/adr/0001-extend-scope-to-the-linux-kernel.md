# 0001. Extend scope to the Linux kernel, syscall to silicon

- Status: accepted
- Date: 2026-10-10

## Context

The original plan covered hardware only: System, CPU package and core levels.
Its flagship scenario, "read 4 KB from a file", already depends on the kernel
(syscall, page cache, block layer, driver, interrupt handling), but the plan
had no way to show those steps. I also want to visualise the Linux kernel.

## Options considered

1. Extend this project: kernel subsystems and hardware in one map, with
   traces crossing both. One engine, one product. Raises MVP scope.
2. Pivot to kernel only. Same engine, loses the hardware story the read trace
   needs.
3. A separate kernel project later. Keeps the MVP small, but duplicates the
   engine and splits the read trace across two tools.

On the data source: a teaching model (hand written content, scripted traces)
versus live tracing of a real kernel with eBPF or ftrace. Live tracing needs a
privileged agent on a Linux host and is a different product.

## Decision

Option 1, as a teaching model. Components gain a `layer` field (`user`,
`kernel`, `hardware`). The MVP adds one Kernel level (no deeper), a user
process node, and turns scenario 2 into a `read()` trace from syscall to
silicon. Live tracing is a non goal.

## Consequences

- The engine (component tree, levels, traces) is unchanged; most new work is
  content in phase 1, about one extra week overall.
- Kernel content must pin one kernel release and link every symbol to source
  at that version, since internals change between releases.
- Deeper kernel levels and more kernel scenarios wait until v0.2.
- Revisit if phase 1 content takes more than twice its estimate.
