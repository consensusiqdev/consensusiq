"use client";

import { useState } from "react";
import Link from "next/link";
import type { TickerSignal } from "@/types/filing";
import ConvictionBar from "@/components/ui/ConvictionBar";
import Badge from "@/components/ui/Badge";
import { fmtAcquisitionLabel, fmtDate, fmtPct, fmtRelativeTime, fmtShares, fmtUsd, sideChipClass } from "@/lib/format";
import { pctOfPriorHoldings } from "@/lib/consensus";
import WatchButton from "@/components/ui/WatchButton";

function scoreTierClass(score: number): string {
  if (score >= 80) return "border-accent text-accent";
  if (score >= 50) return "border-border text-text-dim";
  return "border-border text-text-faint";
}

export default function TickerCard({ signal }: { signal: TickerSignal }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`cursor-pointer rounded-lg border bg-bg-panel-2 p-3.5 transition-colors hover:border-[#3a4150] ${
        open ? "border-accent" : "border-border"
      }`}
      onClick={() => setOpen((v) => !v)}
    >
      <div className="flex items-start justify-between gap-3.5">
        <div className="flex items-start gap-2.5">
          <div
            className={`flex shrink-0 flex-col items-center justify-center rounded-md border px-2 py-1 ${scoreTierClass(signal.signalScore)}`}
          >
            <span className="font-mono text-[15px] font-bold leading-none">
              {signal.signalScore}
            </span>
            <span className="mt-0.5 font-mono text-[8px] uppercase leading-none tracking-wide">
              Score
            </span>
          </div>

          <a
            href={`https://finance.yahoo.com/quote/${encodeURIComponent(signal.ticker)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[14.5px] font-semibold leading-snug text-text hover:underline hover:decoration-accent"
          >
            <span className="font-mono text-accent">{signal.ticker}</span>{" "}
            <span className="text-text-dim">{signal.companyName}</span>
          </a>
        </div>

        <div className="whitespace-nowrap text-right font-mono text-[13px] text-text-dim">
          Volumen
          <br />
          <b className="text-text">{fmtUsd(signal.totalValueAll)}</b>
          <br />
          <Link
            href={`/ticker/${encodeURIComponent(signal.ticker)}`}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 inline-block text-[11px] text-accent hover:underline"
          >
            Handelshistorie →
          </Link>
          <br />
          <WatchButton ticker={signal.ticker} className="mt-1 text-[11px] text-text-dim hover:text-accent" />
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2.5">
        <ConvictionBar sides={signal.sides} totalParticipants={signal.totalParticipants} />
        <div className="whitespace-nowrap font-mono text-xs text-text-dim">
          <b className="text-text">
            {signal.leadCount}/{signal.totalParticipants}
          </b>{" "}
          bei „{signal.leadSide === "BUY" ? "Kauf" : "Verkauf"}“
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-3.5 font-mono text-[11px] text-text-faint">
        <span>
          Konsens <b className="text-text-dim">{fmtRelativeTime(signal.consensusSince)}</b>{" "}
          beobachtet
        </span>
      </div>

      {open && (
        <div
          className="mt-3 space-y-2.5 border-t border-dashed border-border pt-3"
          onClick={(e) => e.stopPropagation()}
        >
          {signal.sides.map((s) => (
            <div key={s.side}>
              <div className="mb-1 font-mono text-[10.5px] uppercase text-text-faint">
                {s.side === "BUY" ? "Kauf" : "Verkauf"} · {s.filers.length} Insider · {fmtUsd(s.totalValue)}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[...s.filers]
                  .sort((a, b) => b.valueUsd - a.valueUsd)
                  .map((f) => {
                    const pct = pctOfPriorHoldings(s.side, f.shares, f.sharesOwnedAfter);
                    return (
                      <a
                        key={f.filerId}
                        href={f.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg border border-border bg-bg-panel py-1 pl-0.5 pr-2.5 font-mono text-[11px] hover:border-accent"
                      >
                        <Badge variant={sideChipClass(s.side)}>{s.side}</Badge>
                        <span>{f.filerName}</span>
                        {f.filerRole && <span className="text-text-faint">({f.filerRole})</span>}
                        <span className="text-text-dim">
                          {fmtShares(f.shares)} Aktien
                          {pct != null && (
                            <span className="text-accent"> ({fmtPct(pct)} des Bestands)</span>
                          )}
                        </span>
                        <span className="text-text-faint">· {fmtUsd(f.valueUsd)}</span>
                        <span className="text-text-faint">· {fmtDate(f.transactionDate)}</span>
                        <span className="text-text-faint">
                          · hält jetzt noch {fmtShares(f.sharesOwnedAfter)}
                        </span>
                        {f.priorAcquisition && (
                          <span className="text-text-faint">· {fmtAcquisitionLabel(f.priorAcquisition)}</span>
                        )}
                      </a>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
