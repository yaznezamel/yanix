"use client";

import type { AppId } from "@/lib/xray/types";
import { BrowserIcon, EditorIcon, PlayerIcon, RestartIcon, TerminalIcon } from "./icons";

interface WelcomeAppProps {
  onOpen: (app: AppId) => void;
  onRestart: () => void;
}

const TRIES: { app: AppId; title: string; detail: string; icon: React.ReactNode }[] = [
  {
    app: "browser",
    title: "Search the web",
    detail: "Typing, DNS, ARP, NAT, TCP, TLS and HTTP/2, packet by packet.",
    icon: <BrowserIcon className="size-7" />,
  },
  {
    app: "editor",
    title: "Open a file",
    detail: "open(), read(), the page cache, and the SSD on a miss.",
    icon: <EditorIcon className="size-7" />,
  },
  {
    app: "player",
    title: "Play a sound",
    detail: "Buffers, PipeWire, real-time scheduling and the sound card.",
    icon: <PlayerIcon className="size-7" />,
  },
  {
    app: "terminal",
    title: "Run a command",
    detail: "cat notes.txt: a process, a pseudo-terminal and a read.",
    icon: <TerminalIcon className="size-7" />,
  },
];

export function WelcomeApp({ onOpen, onRestart }: WelcomeAppProps) {
  return (
    <div className="flex h-full flex-col gap-3 bg-[#1b1e24] p-5 text-white">
      <div>
        <h2 className="text-[17px] font-semibold">Welcome to the Yanix desktop</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-white/70">
          A Linux computer you can see inside. Every app launch, key press, file read, sound and
          packet is traced through user space, the kernel and the hardware.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {TRIES.map((t) => (
          <button
            key={t.app}
            type="button"
            onClick={() => onOpen(t.app)}
            className="flex items-start gap-2.5 rounded-lg border border-white/10 bg-white/[0.04] p-2.5 text-left hover:border-[#6aa8ff]/60 hover:bg-white/[0.07]"
          >
            <span className="mt-0.5 shrink-0">{t.icon}</span>
            <span>
              <span className="block text-[12.5px] font-semibold">{t.title}</span>
              <span className="block text-[11px] leading-snug text-white/60">{t.detail}</span>
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onRestart}
        className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-left hover:border-[#ffb35c]/60 hover:bg-white/[0.07]"
      >
        <RestartIcon className="size-5 shrink-0 text-[#ffb35c]" />
        <span className="text-[12px]">
          <span className="font-semibold">Restart the computer</span>
          <span className="text-white/60">: shutdown, firmware, bootloader, kernel, systemd, DHCP.</span>
        </span>
      </button>
      <p className="mt-auto text-[11px] leading-relaxed text-white/45">
        Caches stay warm between runs, like on a real machine: a second read, launch or search does
        less work. Clear them from the top bar, or restart, to start cold.
      </p>
    </div>
  );
}
