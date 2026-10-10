"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { packetBytes } from "@/lib/xray/packets";
import type { Header, Packet } from "@/lib/xray/types";
import { HEADER_COLOR, HEADER_TAG } from "./palette";

interface PacketPanelProps {
  packet: Packet | null;
  previous: Packet | null;
}

const sameHeader = (a: Header, b: Header) => a.kind === b.kind && a.title === b.title;

function changedFields(header: Header, previous: Packet | null): Set<string> {
  const changed = new Set<string>();
  const before = previous?.headers.find((h) => sameHeader(h, header));
  if (!before) return changed;
  for (const field of header.fields) {
    const old = before.fields.find((f) => f.name === field.name);
    if (old && old.value !== field.value) changed.add(field.name);
  }
  return changed;
}

/** One line per header, so a whole packet fits in a small panel. */
function summary(header: Header): string {
  const value = (name: string) => header.fields.find((f) => f.name === name)?.value ?? "";
  const label = (v: string) => v.match(/\(([^)]+)\)/)?.[1] ?? v;
  switch (header.kind) {
    case "eth":
      return `${label(value("Source"))} → ${label(value("Destination"))}`;
    case "ip":
      return `${value("Source")} → ${value("Destination")} · TTL ${value("TTL")}`;
    case "udp":
      return `port ${value("Source port")} → ${value("Destination port")}`;
    case "tcp":
      return `port ${value("Source port")} → ${value("Destination port")} · ${value("Flags")}`;
    case "dns":
      return value("Question") || value("Answer");
    case "arp":
      return value("Question") || value("Answer");
    case "tls":
      return header.fields[0]?.value ?? "";
    case "http":
      return header.fields.map((f) => f.value).join(" ");
  }
}

export function PacketPanel({ packet, previous }: PacketPanelProps) {
  const [showAll, setShowAll] = useState(false);

  if (!packet) {
    return (
      <section aria-label="Packet" className="flex h-full flex-col gap-2 p-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-lab-muted">Packet</h2>
        <p className="text-[13px] leading-relaxed text-lab-muted">
          No packet in this step. When data crosses the network stack, its headers appear here as
          each layer adds or removes them.
        </p>
      </section>
    );
  }

  const bytes = packetBytes(packet);
  const isNew = (header: Header) =>
    previous !== null && !previous.headers.some((h) => sameHeader(h, header));
  const changes = packet.headers.map((h) => changedFields(h, previous));
  const anyFocus = packet.headers.some((h, i) => isNew(h) || (changes[i]?.size ?? 0) > 0);

  return (
    <section aria-label="Packet" className="flex h-full min-h-0 flex-col gap-2.5 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-lab-muted">Packet</h2>
        <div className="flex items-center gap-2">
          {bytes !== null && (
            <span className="font-mono text-[10.5px] text-lab-muted">
              {bytes} B{packet.headers[0]?.kind === "eth" ? " + 4 B checksum" : ""}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            aria-pressed={showAll}
            className="rounded border border-lab-line px-1.5 py-0.5 text-[10.5px] text-lab-muted hover:text-lab-ink"
          >
            {showAll ? "Key fields" : "All fields"}
          </button>
        </div>
      </div>
      <p className="text-[13px] font-medium leading-snug text-lab-ink">{packet.caption}</p>

      <div className="flex h-6 w-full shrink-0 overflow-hidden rounded-md ring-1 ring-white/10" aria-hidden>
        <AnimatePresence initial={false}>
          {packet.headers.map((header) => (
            <motion.div
              key={`${header.kind}-${header.title}`}
              layout
              initial={{ opacity: 0, scaleX: 0.4 }}
              animate={{ opacity: 1, scaleX: 1 }}
              exit={{ opacity: 0, scaleX: 0.4 }}
              transition={{ duration: 0.3 }}
              className="flex origin-left items-center justify-center font-mono text-[10px] font-bold text-[#05080b]"
              style={{
                flexGrow: header.bytes ?? 24,
                background: header.encrypted
                  ? `repeating-linear-gradient(135deg, ${HEADER_COLOR[header.kind]} 0 6px, color-mix(in srgb, ${HEADER_COLOR[header.kind]} 70%, black) 6px 12px)`
                  : HEADER_COLOR[header.kind],
              }}
            >
              {HEADER_TAG[header.kind]}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <ol className="flex min-h-0 flex-col gap-1.5 overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {packet.headers.map((header, i) => {
            const changed = changes[i] ?? new Set<string>();
            const fresh = isNew(header);
            const focus = showAll || fresh || changed.size > 0 || (!anyFocus && i === 0);
            return (
              <motion.li
                key={`${header.kind}-${header.title}`}
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.3 }}
                className="rounded-md border border-lab-line bg-lab-panel2/70 px-2.5 py-1.5"
                style={{ borderLeft: `3px solid ${HEADER_COLOR[header.kind]}` }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-lab-ink">
                    {header.title}
                    {header.encrypted && (
                      <span className="ml-1.5 text-[10.5px] font-normal text-[#7ee0a1]">encrypted</span>
                    )}
                    {fresh && <span className="ml-1.5 text-[10.5px] font-normal text-signal">added</span>}
                  </span>
                  {header.bytes !== undefined && (
                    <span className="font-mono text-[10px] text-lab-muted">{header.bytes} B</span>
                  )}
                </div>
                {focus ? (
                  <dl className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-3 text-[11.5px]">
                    {header.fields.map((field) => (
                      <div key={field.name} className="contents">
                        <dt className="text-lab-muted">{field.name}</dt>
                        <dd
                          className={`min-w-0 break-words font-mono text-[11px] ${
                            changed.has(field.name) ? "text-signal" : "text-lab-ink/90"
                          }`}
                        >
                          {field.value}
                          {changed.has(field.name) && <span className="ml-1 text-[10px]">changed</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="truncate font-mono text-[11px] text-lab-ink/70">{summary(header)}</p>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </section>
  );
}
