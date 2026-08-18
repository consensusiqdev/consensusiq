"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/Badge";
import CrossSignalBadge from "@/components/ui/CrossSignalBadge";
import Sparkline from "@/components/ui/Sparkline";
import { fmtSignalScore, fmtUsd, scoreTierClass } from "@/lib/format";
import type { TickerDetail } from "@/lib/tickerDetail";

/** Per-watchlist-ticker summary card — deliberately fetches the same /api/ticker-detail the
 * dashboard modal and /company/[ticker] use, rather than the dashboard's TickerSignal shape, since
 * a watched ticker frequently has NO active signal in the current window (TickerCard assumes one
 * always exists) and this still needs to render something useful for it. */
export default function WatchlistCard({
  ticker,
  onRemove,
}: {
  ticker: string;
  onRemove: (ticker: string) => void;
}) {
  const [detail, setDetail] = useState<TickerDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(false);
    fetch(`/api/ticker-detail?ticker=${encodeURIComponent(ticker)}`)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((body: TickerDetail) => {
        if (!cancelled) setDetail(body);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  if (error) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border bg-bg-panel-2 p-3.5 font-mono text-[12.5px] text-text-faint">
        <span>{ticker} — Daten aktuell nicht ladbar</span>
        <button
          type="button"
          onClick={() => onRemove(ticker)}
          aria-label={`${ticker} entfernen`}
          className="text-text-faint hover:text-no"
        >
          ✕ Entfernen
        </button>
      </div>
    );
  }

  if (!detail) {
    return <div className="h-[92px] animate-pulse rounded-lg border border-border bg-bg-panel-2" />;
  }

  const totalValue = detail.transactions.reduce((sum, t) => sum + (t.valueUsd ?? 0), 0);

  return (
    <div className="rounded-lg border border-border bg-bg-panel-2 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3.5">
        <div className="flex items-start gap-2.5">
          <div
            className={`flex shrink-0 flex-col items-center justify-center rounded-md border px-2 py-1 ${
              detail.signalScore != null ? scoreTierClass(detail.signalScore) : "border-border text-text-faint"
            }`}
          >
            <span className="font-mono text-[15px] font-bold leading-none">
              {detail.signalScore != null ? fmtSignalScore(detail.signalScore) : "—"}
            </span>
            <span className="mt-0.5 font-mono text-[8px] uppercase leading-none tracking-wide">Score</span>
          </div>

          <div>
            <Link
              href={`/company/${detail.ticker}`}
              className="text-[14.5px] font-semibold leading-snug text-text hover:underline hover:decoration-accent"
            >
              <span className="font-mono text-accent">{detail.ticker}</span>{" "}
              <span className="text-text-dim">{detail.companyName}</span>
            </Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {detail.industry && <Badge variant="accent">{detail.industry}</Badge>}
              <CrossSignalBadge events={detail.institutionalEvents} />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-start gap-3">
          <div className="whitespace-nowrap text-right font-mono text-[12px] text-text-dim">
            Volumen
            <br />
            <b className="text-text">{fmtUsd(totalValue)}</b>
          </div>
          <button
            type="button"
            onClick={() => onRemove(ticker)}
            aria-label={`${ticker} entfernen`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-faint hover:bg-bg-hover hover:text-no"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-dashed border-border-soft pt-2.5">
        <p className="font-mono text-[11px] text-text-faint">
          {detail.signalScore != null ? (
            <>
              <b className="text-text-dim">{detail.leadCount}</b> Insider auf „
              {detail.leadSide === "BUY" ? "Kauf" : "Verkauf"}“-Seite (30 Tage)
            </>
          ) : (
            "Kein aktives Signal in den letzten 30 Tagen"
          )}
        </p>
        <Sparkline points={detail.signalHistory} width={100} height={28} />
      </div>
    </div>
  );
}
