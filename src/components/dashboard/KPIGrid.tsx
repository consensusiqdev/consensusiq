import type { FilerSummary, TickerSignal } from "@/types/filing";
import { fmtUsd } from "@/lib/format";

export default function KPIGrid({
  filers,
  signals,
  totalInsidersTracked,
  windowDays,
}: {
  filers: FilerSummary[];
  signals: TickerSignal[];
  totalInsidersTracked: number;
  windowDays: number;
}) {
  const totalValue = signals.reduce((sum, s) => sum + s.totalValueAll, 0);
  const topSignalScore = signals.length > 0 ? Math.max(...signals.map((s) => s.signalScore)) : null;

  const items = [
    // One combined card instead of two disconnected insider-counts — "Insider-Datenbank" is the
    // whole roster we've built up (every insider of every tracked company, not time-windowed);
    // the subtitle shows how many of those are the "Beobachtete Insider" from the old separate
    // tile — actually trading within the currently selected window. Keeping them together makes
    // the relationship ("386 of these 727 are currently active") legible at a glance.
    {
      title: "Insider-Datenbank",
      value: String(totalInsidersTracked),
      subtitle: `${filers.length} davon aktiv (${windowDays} Tage)`,
    },
    { title: "Aktive Signale", value: String(signals.length) },
    { title: "Transaktionsvolumen", value: fmtUsd(totalValue) },
    {
      title: "Bester Signal Score",
      value: topSignalScore == null ? "—" : String(topSignalScore),
      highlight: true,
    },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.title}
          className={`rounded-xl border bg-bg-panel p-5 ${
            item.highlight ? "border-accent" : "border-border"
          }`}
        >
          <p className={item.highlight ? "text-accent" : "text-text-dim"}>{item.title}</p>
          <h2
            className={`mt-2.5 text-3xl font-bold sm:text-4xl ${
              item.highlight ? "text-accent" : "text-text"
            }`}
          >
            {item.value}
          </h2>
          {item.subtitle && <p className="mt-1 font-mono text-[11px] text-text-faint">{item.subtitle}</p>}
        </div>
      ))}
    </section>
  );
}
