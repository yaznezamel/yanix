"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { PowerIcon, RestartIcon, SearchIcon } from "./icons";

export interface StartItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onOpen: () => void;
}

interface StartMenuProps {
  open: boolean;
  items: StartItem[];
  onClose: () => void;
  onShutdown: () => void;
  onRestart: () => void;
}

export function StartMenu({ open, items, onClose, onShutdown, onRestart }: StartMenuProps) {
  const [powerOpen, setPowerOpen] = useState(false);
  const close = () => {
    setPowerOpen(false);
    onClose();
  };
  return (
    <AnimatePresence>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close start menu"
            className="absolute inset-0 z-[55] cursor-default"
            onClick={close}
          />
          <motion.div
            role="dialog"
            aria-label="Start"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="absolute bottom-14 left-1/2 z-[58] w-[420px] -translate-x-1/2 rounded-xl border border-white/10 bg-[#1f232b]/90 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.6)] backdrop-blur-2xl"
          >
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white/50">
              <SearchIcon className="size-4" />
              Search apps, settings and documents
            </div>
            <p className="mb-2 mt-5 text-[12px] font-semibold text-white/80">Pinned</p>
            <div className="grid grid-cols-4 gap-2">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    item.onOpen();
                    close();
                  }}
                  className="flex flex-col items-center gap-1.5 rounded-md px-1 py-2.5 text-[11.5px] text-white/85 hover:bg-white/[0.08]"
                >
                  <span className="size-8">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-3 text-[12px] text-white/75">
              <span className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-full bg-[#3fe0ff]/20 text-[11px] font-semibold text-signal">
                  Y
                </span>
                you
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-[10.5px] text-white/40">Linux · simulated</span>
                <span className="relative">
                  <button
                    type="button"
                    aria-label="Power"
                    aria-expanded={powerOpen}
                    onClick={() => setPowerOpen((v) => !v)}
                    className="grid size-8 place-items-center rounded-md text-white/80 hover:bg-white/10"
                  >
                    <PowerIcon className="size-4" />
                  </button>
                  {powerOpen && (
                    <div
                      role="menu"
                      aria-label="Power options"
                      className="absolute bottom-10 right-0 w-40 rounded-md border border-white/10 bg-[#262b34] p-1 shadow-[0_12px_30px_rgba(0,0,0,0.5)]"
                    >
                      {[
                        { label: "Shut down", icon: <PowerIcon className="size-4" />, run: onShutdown },
                        { label: "Restart", icon: <RestartIcon className="size-4" />, run: onRestart },
                      ].map((option) => (
                        <button
                          key={option.label}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            close();
                            option.run();
                          }}
                          className="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-[12px] text-white/85 hover:bg-white/10"
                        >
                          {option.icon}
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </span>
              </span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
