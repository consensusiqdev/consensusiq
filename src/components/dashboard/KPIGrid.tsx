import type { FilerSummary, TickerSignal } from "@/types/filing";
import { fmtUsd } from "@/lib/format";

type Delta = { text: string; positive: boolean } | null;

/** How many of the currently active signals first formed today (earliest leading-side filing = today). */
function newSignalsToday(signals: TickerSignal[]): number {
  const today = new Date().toISOString().slice(0, 10);
  return signals.filter((s) => s.consensusSince === today).length;
}

// Always "this calendar month vs. last calendar month" — fixed and independent of the
// Beobachtungszeitraum filter, so the label means the same thing no matter what's selected.
function volumeDelta(currentMonth: number, previousMonth: number | null): Delta {
  if (previousMonth == null) return null;
  if (previousMonth === 0) {
    // No data at all last month (e.g. near the start of data collection) — a % change is
    // undefined here, so show the actual new amount instead of a meaningless "∞%".
    return currentMonth > 0
      ? { text: `+${fmtUsd(currentMonth)} ggü. letztem Monat (neu)`, positive: true }
      : null;
  }
  const pct = ((currentMonth - previousMonth) / previousMonth) * 100;
  if (Math.abs(pct) < 0.5) return null;
  const sign = pct > 0 ? "↑" : "↓";
  return { text: `${sign} ${Math.abs(pct).toFixed(1)}% ggü. letztem Monat`, positive: pct > 0 };
}

export default function KPIGrid({
  filers,
  signals,
  totalInsidersTracked,
  windowDays,
  currentMonthValueUsd,
  previousMonthValueUsd,
}: {
  filers: FilerSummary[];
  signals: TickerSignal[];
  totalInsidersTracked: number;
  windowDays: number;
  currentMonthValueUsd: number | null;
  previousMonthValueUsd: number | null;
}) {
  const totalValue = signals.reduce((sum, s) => sum + s.totalValueAll, 0);
  const topSignalScore = signals.length > 0 ? Math.max(...signals.map((s) => s.signalScore)) : null;

  const todayCount = newSignalsToday(signals);
  const signalsDelta: Delta = todayCount > 0 ? { text: `↑ ${todayCount} heute`, positive: true } : null;
  const volumeDeltaInfo = volumeDelta(currentMonthValueUsd ?? 0, previousMonthValueUsd);

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
    { title: "Aktive Signale", value: String(signals.length), delta: signalsDelta },
    { title: "Transaktionsvolumen", value: fmtUsd(totalValue), delta: volumeDeltaInfo },
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
          {item.delta && (
            <p
              className="mt-1 font-mono text-[11px]"
              style={{ color: item.delta.positive ? "var(--color-yes)" : "var(--color-no)" }}
            >
              {item.delta.text}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
