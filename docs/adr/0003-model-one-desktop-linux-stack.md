# 0003. Model one desktop Linux stack in the desktop lab

- Status: accepted
- Date: 2026-10-10

## Context

I asked for more traces in the desktop lab (ADR 0002): starting and shutting
down the computer, opening a file (with the page cache hit or miss), launching
an app (fork, exec, the ELF loader, dynamic linking, virtual memory), typing,
playing sound or video, and copy and paste.

Below the kernel, Linux is fairly uniform. Above it, every distribution makes
different choices: X11 or Wayland, GNOME or KDE, PipeWire or PulseAudio, GRUB
or systemd-boot. Each trace has to name the programs it passes through, and
link them to source (NFR9).

## Options considered

1. Generic names only ("the display server", "the sound server"). Hard to be
   wrong, but there is no code to link to, and the traces get vague.
2. One concrete, current stack, named and linked to its source, with notes
   where others differ. Specific and checkable, but true for that stack only.
3. Several stacks side by side. Most complete, but it multiplies the work and
   the screen space.

## Decision

Option 2. The lab models an x86-64 UEFI PC running systemd, a GNOME-style
Wayland session (Mutter as the example compositor, GTK apps), PipeWire for
audio, glibc, and Chromium. A step says so where another stack would behave
differently, for example GNOME's clipboard manager, or systemd-resolved
between glibc and the DNS server.

Every code reference was checked to exist in the current source on the date
above: Linux v7.2 and the default branches of glibc, systemd, PipeWire,
Wayland, Mutter, GTK, libxkbcommon, Linux-PAM, RTKit, Chromium, BoringSSL and
coreutils. The figures come from those sources too: PipeWire's default clock
rate and quantum, struct and message sizes from kernel headers and protocol
files, ACPI and NVMe register layouts.

Two engine rules came with it. Screens and windows are part of the traced
state, so a window appears when the app draws its first frame and scrubbing
back hides it again. A field that a running trace will change (a document
being loaded, a search box being pasted into) is read-only until the trace
ends.

## Consequences

- The traces can be concrete: real function names, file paths, message
  formats and defaults, each one checked.
- Kernel references are checked against v7.2 but not pinned to it. Task 1.6
  still picks the release to pin, and some names will need updating then
  (for example `anon_pipe_read`, which older kernels call `pipe_read`).
- Other stacks (X11, KDE, PulseAudio) are not shown. Adding one would be a
  separate set of scenarios, not a change to these.
- Revisit when task 1.6 pins a kernel release: re-check every reference
  against it, ideally with a script that CI runs once the content is YAML
  (L.4).
