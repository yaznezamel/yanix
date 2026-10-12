"use client";

import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { USER } from "@/lib/xray/apps";
import styles from "../lab/lab.module.css";
import { PowerIcon, StartIcon } from "./icons";

// What the screen shows while the computer is off, starting or stopping. The
// firmware logo, boot menu and console are generic stand-ins for whatever a
// real machine's firmware and distribution show.

export function OffScreen({ onPowerOn, restarting }: { onPowerOn: () => void; restarting: boolean }) {
  // A restart powers back on by itself: the screen just stays dark for a moment.
  if (restarting) return <div className="h-full w-full bg-black" aria-label="Restarting" />;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-black text-white">
      <button
        type="button"
        onClick={onPowerOn}
        aria-label="Power on"
        className="group grid size-20 place-items-center rounded-full border border-white/15 bg-white/[0.04] text-white/70 transition hover:border-signal/60 hover:text-signal hover:shadow-[0_0_28px_rgba(63,224,255,0.35)]"
      >
        <PowerIcon className="size-9" />
      </button>
      <p className="text-[13px] text-white/65">The computer is off. Press the power button.</p>
      <span className="absolute bottom-4 right-5 flex items-center gap-2 text-[10.5px] text-white/55">
        <span className="size-1.5 rounded-full bg-[#ffb35c]/70" />
        standby power
      </span>
    </div>
  );
}

export function FirmwareScreen() {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-black text-white">
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6 }}
        className="flex items-center gap-4"
      >
        <StartIcon className="size-16" />
        <span className="text-[44px] font-bold tracking-tight">
          yan<span className="text-signal">i</span>x
        </span>
      </motion.div>
      <svg viewBox="0 0 16 16" className={`mt-14 size-6 ${styles.spin}`} aria-hidden>
        <circle cx="8" cy="8" r="6" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
        <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <p className="absolute bottom-5 font-mono text-[11px] text-white/60">
        Press F2 for setup · F12 for the boot menu (simulated firmware)
      </p>
    </div>
  );
}

const BOOT_ENTRIES = ["Yanix Linux", "Advanced options for Yanix Linux", "UEFI firmware settings"];

export function BootloaderScreen() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-[#05060a] font-mono text-[14px] text-[#c8ced8]">
      <div className="w-[620px] border border-[#c8ced8]/60 px-1 py-2">
        {BOOT_ENTRIES.map((entry, i) => (
          <div key={entry} className={`px-3 py-0.5 ${i === 0 ? "bg-[#c8ced8] text-[#05060a]" : ""}`}>
            {i === 0 ? "*" : " "}
            {entry}
          </div>
        ))}
        <div className="h-24" />
      </div>
      <p className="mt-4 w-[620px] text-[12.5px] leading-relaxed text-[#c8ced8]/75">
        Use the ↑ and ↓ keys to select an entry. The highlighted entry will be started
        automatically in a few seconds. (Simulated boot menu.)
      </p>
    </div>
  );
}

export function KernelScreen({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <div ref={ref} className="h-full w-full overflow-hidden bg-black px-4 py-3 font-mono text-[12px] leading-[1.6] text-[#d7dde6]">
      <p className="mb-1 text-[10.5px] text-white/60">Simulated console: real message formats, illustrative values</p>
      {lines.map((line, i) => (
        <motion.p
          key={`${i}-${line}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, delay: Math.min(i, 6) * 0.04 }}
          className={line.startsWith("[  OK  ]") ? "whitespace-pre" : "whitespace-pre-wrap"}
        >
          {line.startsWith("[  OK  ]") ? (
            <>
              [  <span className="text-[#7ee0a1]">OK</span>  ]{line.slice(8)}
            </>
          ) : (
            line
          )}
        </motion.p>
      ))}
      <span className={`inline-block h-3.5 w-2 bg-[#d7dde6] ${styles.blink}`} />
    </div>
  );
}

export function LoginScreen({ onLogin, busy }: { onLogin: () => void; busy: boolean }) {
  return (
    <div className={`relative flex h-full w-full flex-col items-center justify-center ${styles.wallpaper}`}>
      <div className="absolute inset-0 bg-black/45 backdrop-blur-md" />
      <div className="relative flex flex-col items-center gap-3 text-white">
        <div className="grid size-24 place-items-center rounded-full bg-[#3fe0ff]/20 text-[36px] font-semibold text-signal ring-2 ring-white/20">
          Y
        </div>
        <p className="text-[18px] font-semibold">{USER}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) onLogin();
          }}
          className="mt-2 flex items-center gap-2"
        >
          <input
            type="password"
            aria-label="Password"
            readOnly
            value="password"
            className="w-56 rounded-md border border-white/20 bg-black/40 px-3 py-2 text-[13px] text-white outline-none focus:border-signal"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-signal px-4 py-2 text-[13px] font-semibold text-[#03141a] hover:brightness-110 disabled:opacity-50"
          >
            Log in
          </button>
        </form>
        <p className="text-[11.5px] text-white/50">The password is filled in for you.</p>
      </div>
    </div>
  );
}

export function ShutdownScreen({ restarting }: { restarting: boolean }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-[#0a1020] text-white">
      <svg viewBox="0 0 16 16" className={`size-8 ${styles.spin}`} aria-hidden>
        <circle cx="8" cy="8" r="6" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
        <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="#3fe0ff" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <p className="text-[16px] text-white/85">{restarting ? "Restarting…" : "Shutting down…"}</p>
    </div>
  );
}
