import type { Transaction } from "@/types/filing";
import { fmtDate, fmtUsd } from "@/lib/format";

export default function TopBuysRail({
  topBuys,
  onSelectTicker,
}: {
  topBuys: Transaction[];
  onSelectTicker: (ticker: string) => void;
}) {
  return (
    <aside className="rounded-xl border border-border bg-bg-panel p-4">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-text-dim">
        Größte Käufe
      </h2>

      {topBuys.length === 0 ? (
        <p className="px-1 py-4 font-mono text-[11.5px] leading-relaxed text-text-faint">
          Aktuell keine Insider-Käufe im gewählten Zeitraum erfasst.
        </p>
      ) : (
        <div className="flex max-h-[640px] flex-col gap-0.5 overflow-y-auto">
          {topBuys.map((t, idx) => (
            <button
              type="button"
              key={t.id}
              onClick={() => onSelectTicker(t.ticker)}
              className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-bg-hover"
            >
              <span className="w-[18px] shrink-0 text-right font-mono text-[11px] text-text-faint">
                #{idx + 1}
              </span>

              <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-bg-panel-2 font-mono text-[10px] text-yes">
                {t.ticker.slice(0, 3)}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-text">
                  {t.filerName}
                  {t.filerRole && <span className="text-text-faint"> ({t.filerRole})</span>}
                </span>
                <span className="block font-mono text-[11px] text-text-dim">
                  {t.ticker} · {fmtUsd(t.valueUsd)} · {fmtDate(t.transactionDate)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
