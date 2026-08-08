import { useEffect, useState } from "react";
import type { TickerSignal } from "@/types/filing";
import TickerCard from "@/components/dashboard/TickerCard";

const PAGE_SIZE = 10;

export default function SignalFeed({
  signals,
  onSelectTicker,
  resetKey,
}: {
  signals: TickerSignal[];
  onSelectTicker: (ticker: string) => void;
  resetKey: string;
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Jump back to the top page whenever the filters change (new fetch / new set of tickers) —
  // but not on incidental re-renders (e.g. opening the ticker detail modal) that leave the
  // underlying signal set untouched.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [resetKey]);

  const visibleSignals = signals.slice(0, visibleCount);
  const remaining = signals.length - visibleSignals.length;

  return (
    <section className="rounded-xl border border-border bg-bg-panel p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-dim">
          Insider-Konsens
        </h2>
        <span className="font-mono text-[11px] text-text-faint">
          {signals.length} Ticker
        </span>
      </div>

      <div className="mt-1 flex flex-col gap-2.5">
        {signals.length === 0 ? (
          <div className="px-2.5 py-8 text-center font-mono text-[12.5px] leading-relaxed text-text-faint">
            Kein Ticker erreicht aktuell die gewählte Mindest-Übereinstimmung.
            <br />
            Versuch eine niedrigere Schwelle, einen längeren Beobachtungszeitraum oder einen
            kleineren Mindest-Transaktionswert.
          </div>
        ) : (
          visibleSignals.map((s) => (
            <TickerCard key={s.ticker} signal={s} onSelectTicker={onSelectTicker} />
          ))
        )}
      </div>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
          className="mt-3 w-full rounded-md border border-border py-2 font-mono text-[12px] text-text-dim transition hover:border-accent hover:text-text"
        >
          {Math.min(remaining, PAGE_SIZE)} weitere laden ({remaining} übrig)
        </button>
      )}
    </section>
  );
}
