"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { InstitutionalEvent } from "@/types/filing";
import { fmtInstitutionalLabel, fmtUsd, summarizeCrossSignal } from "@/lib/format";
import Badge from "@/components/ui/Badge";

/** Small hint badge: are the tracked 13F "smart money" funds also active in this ticker right now,
 * and in which direction. Not a combined score — deliberately kept separate from the insider
 * Signal Score (see /methodik's "Institutionelle 13F-Daten" section for why). Click expands the
 * per-fund breakdown (size + since-when) using `fmtInstitutionalLabel` — the same formatting
 * already used for the /institutional timeline, just surfaced right where the hint is instead of
 * sending the click away to a different page first. */
export default function CrossSignalBadge({ events }: { events: InstitutionalEvent[] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const summary = summarizeCrossSignal(events);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("click", onClickOutside);
    return () => window.removeEventListener("click", onClickOutside);
  }, [open]);

  if (!summary) return null;

  const variant = summary.direction === "BUYING" ? "yes" : summary.direction === "SELLING" ? "no" : "other";

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <Badge variant={variant}>{summary.label}</Badge>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-30 mt-1.5 w-72 max-w-[85vw] rounded-lg border border-border bg-bg-panel-2 p-3 font-mono text-[11px] leading-relaxed text-text-dim shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <ul className="space-y-1.5">
            {[...events]
              .sort((a, b) => (a.quarter > b.quarter ? -1 : 1))
              .map((e, i) => (
                <li key={`${e.fundName}:${e.quarter}:${i}`} className="flex items-baseline justify-between gap-2.5">
                  <span className="text-text-dim">{fmtInstitutionalLabel(e)}</span>
                  <span className="shrink-0 text-text">{fmtUsd(e.valueUsd)}</span>
                </li>
              ))}
          </ul>
          <p className="mt-2 border-t border-dashed border-border pt-2 text-text-faint">
            13F-Daten sind bis zu 45 Tage alt und decken max. die letzten 2 gemeldeten Quartale ab.
          </p>
          <Link href="/institutional" className="mt-1.5 block text-accent hover:underline">
            Alle 20 Fonds ansehen →
          </Link>
        </div>
      )}
    </div>
  );
}
