import type { TickerSignal } from "@/types/filing";
import TickerCard from "@/components/dashboard/TickerCard";

export default function SignalFeed({ signals }: { signals: TickerSignal[] }) {
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
          signals.map((s) => <TickerCard key={s.ticker} signal={s} />)
        )}
      </div>
    </section>
  );
}
