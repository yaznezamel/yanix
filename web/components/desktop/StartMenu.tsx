"use client";

import { AnimatePresence, motion } from "motion/react";
import { SearchIcon } from "./icons";

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
}

export function StartMenu({ open, items, onClose }: StartMenuProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close start menu"
            className="absolute inset-0 z-[55] cursor-default"
            onClick={onClose}
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
                    onClose();
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
              <span className="font-mono text-[10.5px] text-white/40">Linux · simulated</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
