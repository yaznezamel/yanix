import { MEDIA, isCached, withCached } from "../apps";
import { dataFrame, pcm, wayland } from "../structs";
import type { MachineState, Media, Scenario, Step } from "../types";
import { clickStep } from "./common";

// Playing a sound (and, for a video, its pictures). Audio is soft real time:
// the sound card reads samples at a fixed rate no matter what, so PipeWire's
// real-time thread must keep its ring buffer ahead of the hardware. Figures
// below are PipeWire's defaults (src/daemon/pipewire.conf.in): 48,000 Hz and
// a quantum of 1,024 samples, which is 1024 / 48000 s, about 21 ms.

export function play(media: Media, m: MachineState): Scenario {
  const { title, file, kind } = MEDIA[media];
  const cached = isCached(m, file);
  const video = media === "video";

  const steps: Step[] = [
    clickStep("click", "player", "You press Play", "the player's window"),
    {
      id: "read",
      phase: "file",
      cache: cached ? "hit" : "miss",
      path: cached
        ? ["player", "syscall", "vfs", "pagecache"]
        : ["player", "syscall", "vfs", "pagecache", "ext4", "block", "nvme", "ssd", "ram"],
      learns: withCached(m, file),
      title: cached ? "Reading the file, from RAM" : "Reading the file, from the SSD",
      body: cached
        ? `The player reads ${file.slice(file.lastIndexOf("/") + 1)} (${kind}) through the page cache. It's still in RAM from last time, so no disk is involved.`
        : `The player reads ${file.slice(file.lastIndexOf("/") + 1)} (${kind}). It isn't in the page cache, so the reads go all the way down to the SSD, the same path as opening any file. Players read ahead in chunks while they play.`,
      code: [{ project: "linux", path: "mm/filemap.c", symbol: "filemap_read" }],
      timescale: "us",
      aws: {
        service: "Amazon S3",
        text: "Reading ahead in chunks is how players stream from S3 too: a byte-range GET fetches just the next part of a large object, so playback can start before the whole file has arrived.",
      },
    },
    {
      id: "decode",
      phase: "audio",
      path: ["player", "cpu"],
      frames: [dataFrame(1, "Audio samples", "Decoded, ready to play", pcm("48,000 samples per second, per channel", "16-bit or float samples; PipeWire mixes in 32-bit float"))],
      title: "Decoding: compressed to raw samples",
      body: "The player's decoder (GStreamer) turns the compressed Opus stream into raw samples: 48,000 per second for each of the two channels. This is ordinary work on the CPU, in user space.",
      timescale: "us",
      data: {
        amount: "384,000 bytes a second",
        what: "of decoded sound in PipeWire's 32-bit float format: 48,000 samples × 2 channels × 4 bytes. As 16-bit samples, half that.",
      },
      aws: {
        service: "AWS Elemental MediaConvert",
        text: "This is the work AWS Elemental MediaConvert does at scale: it decodes media files and encodes them again in the formats and sizes each device needs, on AWS's machines instead of yours.",
      },
    },
  ];

  if (video) {
    steps.push({
      id: "video-decode",
      phase: "video",
      path: ["player", "syscall", "drm", "display"],
      title: "Video frames: decoded on the GPU",
      body: "Decoding video is heavy, so the player can hand it to the GPU's video decoder through VA-API and the DRM driver. Each decoded frame stays in GPU memory as a buffer other processes can share (a dma-buf), so the pixels are never copied around.",
      code: [{ project: "linux", path: "drivers/gpu/drm/drm_ioctl.c" }],
      timescale: "ms",
      data: {
        amount: "3,110,400 bytes",
        what: "per decoded 1920×1080 frame in NV12, the layout VA-API decoders give for 8-bit video: 1.5 bytes per pixel. At 30 frames a second that is 93 MB/s, which is why the frames stay in GPU memory.",
      },
      aws: {
        service: "Amazon EC2 G4dn instances",
        text: "GPU instances such as G4dn, with NVIDIA T4 GPUs, carry the same kind of fixed-function video decoder and encoder, used to transcode video or stream games without loading the CPUs.",
      },
    });
  }

  steps.push(
    {
      id: "to-pipewire",
      phase: "audio",
      path: ["player", "syscall", "ipc", "syscall", "pipewire"],
      title: "Into PipeWire's shared buffers",
      body: "The player hands its samples to PipeWire, directly or through PipeWire's PulseAudio-compatible service. They go into buffers in shared memory that both processes mapped, so the samples never travel through a socket; only small messages and wake-ups do.",
      code: [
        { project: "pipewire", path: "src/pipewire/stream.c", symbol: "pw_stream_queue_buffer" },
        { project: "linux", path: "mm/memfd.c", symbol: "memfd_create" },
      ],
      timescale: "us",
    },
    {
      id: "quantum",
      phase: "audio",
      path: ["pipewire", "sched"],
      title: "A deadline every 21 milliseconds",
      body: "PipeWire's data thread wakes on a timer once per quantum, by default 1,024 samples: about 21 ms at 48,000 samples per second. Each time it mixes every stream (your sound and any others) and converts the result for the sound card.",
      code: [
        { project: "pipewire", path: "src/daemon/pipewire.conf.in" },
        { project: "pipewire", path: "spa/plugins/alsa/alsa-pcm.c", symbol: "spa_alsa_write" },
        { project: "linux", path: "fs/timerfd.c" },
      ],
      timescale: "ms",
      data: {
        amount: "8 KiB",
        what: "per quantum: 1,024 samples × 2 channels × 4 bytes of float, mixed and passed on every 21.3 ms (1,024 ÷ 48,000 s)",
      },
      aws: {
        service: "AWS Elemental MediaLive",
        text: "Live media keeps the same kind of deadline at any scale: AWS Elemental MediaLive encodes live video as it arrives, and it can't fall behind for long, because viewers' players, like this sound card, consume at a fixed rate.",
      },
    },
    {
      id: "realtime",
      phase: "audio",
      path: ["pipewire", "services", "sched"],
      title: "Real-time priority",
      body: "Audio can't wait: if the sound card runs out of samples, you hear a click (an underrun, or xrun). So PipeWire runs its data thread under a real-time policy: SCHED_FIFO when it may set that itself, or SCHED_RR granted by RTKit, a system service. When its timer fires, the scheduler runs it ahead of every normal task on that core.",
      code: [
        { project: "linux", path: "kernel/sched/rt.c", symbol: "pick_task_rt" },
        { project: "pipewire", path: "src/modules/module-rt.c" },
        { project: "rtkit", path: "rtkit-daemon.c" },
      ],
      timescale: "us",
    },
    {
      id: "ring-buffer",
      phase: "audio",
      path: ["pipewire", "syscall", "alsa", "ram"],
      title: "Into the sound card's ring buffer",
      body: "PipeWire writes the mixed samples into ALSA's ring buffer: memory the sound driver set aside for DMA, which PipeWire mapped into its own address space with mmap(). Filling it is just writing to memory, with no system call per sample.",
      code: [
        { project: "linux", path: "sound/core/pcm_native.c" },
        { project: "pipewire", path: "spa/plugins/alsa/alsa-pcm.c" },
      ],
      timescale: "us",
    },
    {
      id: "hda-dma",
      phase: "audio",
      path: ["ram", "hda"],
      title: "The sound card reads on its own",
      body: "The HD Audio controller works through a list of buffer segments in RAM (its buffer descriptor list) and fetches the samples with DMA at exactly the sample rate, whatever the CPU is doing.",
      code: [{ project: "linux", path: "sound/hda/core/stream.c", symbol: "snd_hdac_stream_setup" }],
      timescale: "us",
      data: {
        amount: "192,000 bytes a second",
        what: "for 16-bit stereo at 48 kHz: 48,000 × 2 channels × 2 bytes, fetched steadily whatever the CPU is doing. Cards fed 24- or 32-bit samples (in 4-byte slots) fetch twice that.",
      },
    },
    {
      id: "codec",
      phase: "audio",
      path: ["hda", "speakers"],
      title: "Numbers become sound",
      body: "The controller streams the samples over the HD Audio link to the codec chip. Its digital-to-analog converter turns 48,000 numbers a second per channel into a voltage that moves the speaker.",
      timescale: "us",
      ui: { player: { playing: true, status: null } },
    },
    {
      id: "period-irq",
      phase: "audio",
      mode: "deep",
      path: ["hda", "cpu", "irq", "alsa"],
      title: "Interrupts mark the progress",
      body: "Each time the controller finishes a period of the buffer it can raise an interrupt; the driver calls snd_pcm_period_elapsed(), which updates the hardware position and wakes any waiter. PipeWire mostly schedules from its own timer and that position instead, which needs fewer interrupts.",
      code: [
        { project: "linux", path: "sound/hda/common/controller.c", symbol: "azx_interrupt" },
        { project: "linux", path: "sound/core/pcm_lib.c", symbol: "snd_pcm_period_elapsed" },
      ],
      timescale: "us",
    },
  );

  if (video) {
    steps.push(
      {
        id: "present",
        phase: "video",
        path: ["player", "syscall", "ipc", "syscall", "shell"],
        frames: [
          dataFrame(
            0,
            "Wayland message",
            "A new frame for the window",
            wayland("wl_surface.attach", [{ name: "buffer", value: "the decoded frame, shared, not copied" }], 20),
            wayland("wl_surface.commit", [{ name: "meaning", value: "show the new state" }], 8),
          ),
        ],
        title: "Each frame when the sound says so",
        body: "The player shows each video frame when the audio clock reaches the frame's timestamp, so picture and sound stay in sync. It attaches the frame's buffer to its window's surface and commits it to the compositor.",
        code: [{ project: "wayland", path: "protocol/wayland.xml" }],
        timescale: "ms",
        data: {
          amount: "28 bytes",
          what: "two Wayland messages, attach (20 bytes) and commit (8). The frame's pixels, about 3.1 MB at 1080p, stay where the GPU decoded them; only a reference travels.",
        },
      },
      {
        id: "vblank",
        phase: "video",
        path: ["shell", "syscall", "drm", "display"],
        title: "A flip between two refreshes",
        body: "The compositor composes the new picture and asks the DRM driver to switch to it at the next vertical blank, the pause between two screen refreshes, so you never see half of one frame and half of the next.",
        code: [
          { project: "linux", path: "drivers/gpu/drm/drm_atomic_uapi.c", symbol: "drm_mode_atomic_ioctl" },
          { project: "linux", path: "drivers/gpu/drm/drm_vblank.c", symbol: "drm_crtc_handle_vblank" },
        ],
        timescale: "ms",
      },
    );
  }

  steps.push(
    {
      id: "juggling",
      phase: "audio",
      path: ["sched"],
      title: "Juggling deadlines",
      body: "Everything else keeps running: the scheduler shares the cores fairly among normal tasks and lets PipeWire's real-time thread jump the queue whenever its timer fires. The ring buffer is the safety margin. A bigger one survives longer hiccups but adds delay between action and sound, which is why calls and games use small quanta and music can afford large ones.",
      code: [{ project: "linux", path: "kernel/sched/rt.c" }],
      timescale: "ms",
    },
    {
      id: "loop",
      phase: "audio",
      path: ["pipewire", "alsa", "hda", "speakers"],
      title: "And again, every quantum",
      body: video
        ? "For as long as the video plays, both loops repeat: samples a little ahead of the sound card, frames in time for each refresh."
        : "For as long as the sound plays, the loop repeats: decode a little ahead, mix, write into the ring buffer, and let DMA play it out.",
    },
  );

  return { kind: "play", app: "player", title: `Playing “${title}”`, focus: "split", steps };
}
