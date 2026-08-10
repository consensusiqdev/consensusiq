"use client";

import { useState } from "react";
import Link from "next/link";
import { fmtShares, fmtUsd } from "@/lib/format";
import type { FundHolding } from "@/types/filing";

const PAGE_SIZE = 10;

/** A fund's holdings list, expandable beyond the initial 10 — same "N weitere laden" pattern as
 * SignalFeed.tsx's dashboard pagination, just without a resetKey since a fund card's holdings
 * never change out from under it after mount. */
export default function FundHoldingsList({ holdings }: { holdings: FundHolding[] }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visible = holdings.slice(0, visibleCount);
  const remaining = holdings.length - visible.length;

  return (
    <>
      <ol className="mt-3 space-y-1 border-t border-dashed border-border pt-3">
        {visible.map((h, idx) => (
          <li
            key={`${h.ticker ?? h.issuerName}:${idx}`}
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11.5px]"
          >
            <span className="w-[20px] shrink-0 text-right text-text-faint">{idx + 1}.</span>
            {h.ticker ? (
              <Link href={`/company/${encodeURIComponent(h.ticker)}`} className="text-accent hover:underline">
                {h.ticker}
              </Link>
            ) : (
              <span className="text-text-faint">?</span>
            )}
            <span className="min-w-0 flex-1 truncate text-text-dim">{h.issuerName}</span>
            <span className="whitespace-nowrap text-text">{fmtUsd(h.valueUsd)}</span>
            <span className="whitespace-nowrap text-text-faint">· {fmtShares(h.shares)}</span>
          </li>
        ))}
      </ol>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
          className="mt-2 font-mono text-[11px] text-accent hover:underline"
        >
          {Math.min(remaining, PAGE_SIZE)} weitere laden ({remaining} übrig)
        </button>
      )}
    </>
  );
}
