"use client";

import { useState } from "react";
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

/** Breaks the 0-100 signalScore back down into its three equally-weighted thirds plus the
 *  buy/sell multiplier — mirrors the exact math in consensus.ts's summarizeTickers(). */
function scoreBreakdown(signal: TickerSignal) {
  const third = 100 / 3;
  const headcountPts = signal.convictionRatio * third;
  const dollarPts = signal.dollarWeightedRatio * third;
  const holdingsPts = signal.avgHoldingsPct * third;
  const rawScore = headcountPts + dollarPts + holdingsPts;
  const afterMultiplier = rawScore * signal.sideMultiplier;
  return { headcountPts, dollarPts, holdingsPts, rawScore, afterMultiplier };
}

function ScoreTooltip({ signal }: { signal: TickerSignal }) {
  const { headcountPts, dollarPts, holdingsPts, rawScore, afterMultiplier } = scoreBreakdown(signal);
  const multiplierLabel =
    signal.leadSide === "BUY"
      ? `× ${signal.sideMultiplier.toFixed(2)} (kaufgeführter Konsens)`
      : `× ${signal.sideMultiplier.toFixed(2)} (verkaufgeführter Konsens)`;
  const wasClamped = afterMultiplier !== signal.signalScore && (afterMultiplier > 100 || afterMultiplier < 0);

  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-64 -translate-x-1/2 rounded-lg border border-border bg-bg-panel-2 p-3 font-mono text-[11px] leading-relaxed text-text-dim shadow-lg group-hover:block"
    >
      <div className="mb-2 flex items-baseline justify-between text-text">
        <span className="text-[10px] uppercase tracking-wide text-text-faint">Signal Score</span>
        <span className="text-[13px] font-bold">{signal.signalScore}</span>
      </div>

      <div className="flex justify-between">
        <span>Kopfzahl-Anteil</span>
        <span className="text-text">+{headcountPts.toFixed(1)}</span>
      </div>
      <div className="flex justify-between">
        <span>Dollar-Anteil</span>
        <span className="text-text">+{dollarPts.toFixed(1)}</span>
      </div>
      <div className="flex justify-between">
        <span>Ø Altbestand gehandelt</span>
        <span className="text-text">+{holdingsPts.toFixed(1)}</span>
      </div>

      <div className="mt-1.5 flex justify-between border-t border-dashed border-border pt-1.5">
        <span>Basiswert</span>
        <span className="text-text">{rawScore.toFixed(1)}</span>
      </div>
      <div className="flex justify-between">
        <span>{multiplierLabel}</span>
        <span className="text-text">{afterMultiplier.toFixed(1)}</span>
      </div>

      <div className="mt-1.5 flex justify-between border-t border-border pt-1.5 text-text">
        <span className="font-semibold">Signal Score{wasClamped ? " (gedeckelt)" : ""}</span>
        <span className="font-bold">{signal.signalScore}</span>
      </div>
    </div>
  );
}

export default function TickerCard({
  signal,
  onSelectTicker,
}: {
  signal: TickerSignal;
  onSelectTicker: (ticker: string) => void;
}) {
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
            className={`group relative flex shrink-0 flex-col items-center justify-center rounded-md border px-2 py-1 ${scoreTierClass(signal.signalScore)}`}
          >
            <span className="font-mono text-[15px] font-bold leading-none">
              {signal.signalScore}
            </span>
            <span className="mt-0.5 font-mono text-[8px] uppercase leading-none tracking-wide">
              Score
            </span>
            <ScoreTooltip signal={signal} />
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
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectTicker(signal.ticker);
            }}
            className="mt-1 text-[11px] text-accent hover:underline"
          >
            Handelshistorie →
          </button>
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
