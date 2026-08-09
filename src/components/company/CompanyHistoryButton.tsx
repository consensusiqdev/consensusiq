"use client";

import { useState } from "react";
import TickerDetailModal from "@/components/dashboard/TickerDetailModal";

/** Opens the same trade-history modal used on the dashboard, but from the standalone
 * /company/[ticker] page — the page itself only shows the roster/signal panel, not the full
 * transaction timeline, so this is the only way to reach it after e.g. landing here via search. */
export default function CompanyHistoryButton({ ticker }: { ticker: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-auto rounded-md border border-border px-3 py-1.5 font-mono text-[11.5px] text-text-dim hover:border-accent hover:text-text"
      >
        Handelshistorie ansehen
      </button>
      <TickerDetailModal ticker={open ? ticker : null} onClose={() => setOpen(false)} />
    </>
  );
}
