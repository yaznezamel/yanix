"use client";

import { BrowserIcon, TerminalIcon } from "./icons";

interface WelcomeAppProps {
  onOpen: (app: "browser" | "terminal") => void;
}

export function WelcomeApp({ onOpen }: WelcomeAppProps) {
  return (
    <div className="flex h-full flex-col gap-4 bg-[#1b1e24] p-5 text-white">
      <div>
        <h2 className="text-[17px] font-semibold">Welcome to the Yanix desktop</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-white/70">
          A Linux computer you can see inside. Use it like any desktop; the machine view next to
          it shows every step your actions take through user space, the kernel, the hardware and
          the network.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onOpen("browser")}
          className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-left hover:border-[#6aa8ff]/60 hover:bg-white/[0.07]"
        >
          <BrowserIcon className="size-8" />
          <span className="text-[13px] font-semibold">Search the web</span>
          <span className="text-[11.5px] text-white/60">DNS, ARP, NAT, TCP, TLS and HTTP/2, packet by packet.</span>
        </button>
        <button
          type="button"
          onClick={() => onOpen("terminal")}
          className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-left hover:border-[#5eead4]/60 hover:bg-white/[0.07]"
        >
          <TerminalIcon className="size-8" />
          <span className="text-[13px] font-semibold">Read a file</span>
          <span className="text-[11.5px] text-white/60">cat notes.txt: VFS, page cache, NVMe, DMA and interrupts.</span>
        </button>
      </div>
      <p className="mt-auto text-[11px] leading-relaxed text-white/45">
        Caches stay warm between runs, like on a real machine: the second search or read is
        faster. Clear them from the top bar to start cold.
      </p>
    </div>
  );
}
