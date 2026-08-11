import type { SortOption } from "@/lib/consensus";
import SaveScreenButton from "@/components/dashboard/SaveScreenButton";

export type DashboardFilters = {
  windowDays: number;
  minAgree: number;
  minUsd: number;
  buysOnly: boolean;
  sortBy: SortOption;
  // "" = alle Branchen. Rein clientseitig angewendet (siehe DashboardClient) — löst bewusst
  // keinen Refetch aus, da die Branche pro Ticker schon Teil der geladenen Signals ist.
  industry: string;
};

export const DEFAULT_FILTERS: DashboardFilters = {
  windowDays: 14,
  minAgree: 3,
  minUsd: 1000,
  // Multi-insider BUY clusters are genuinely rare (most Form 4 activity is routine selling) —
  // defaulting to buys-only would leave a near-empty dashboard until enough buy data
  // accumulates. Off by default; the checkbox is still there for anyone who wants it.
  buysOnly: false,
  sortBy: "score",
  industry: "",
};

const SORT_LABELS: Record<SortOption, string> = {
  consensus: "Stärkster Konsens",
  exposure: "Größtes Volumen",
  conviction: "Höchste Konviktion",
  score: "Höchster Signal Score",
};

// max-w caps the Branche select specifically — its option text (full SIC industry names) can be
// much longer than a native <select> otherwise sizes itself to, which pushed the whole page wider
// than the viewport on mobile. truncate ellipsizes the closed-state display text.
const SELECT_CLASS =
  "min-w-[110px] max-w-[180px] truncate rounded-md border border-border bg-bg-panel-2 px-2.5 py-2 font-mono text-[13px] text-text outline-none focus:border-accent";
const INPUT_CLASS =
  "w-[100px] rounded-md border border-border bg-bg-panel-2 px-2.5 py-2 font-mono text-[13px] text-text outline-none focus:border-accent";

export default function FilterBar({
  filters,
  onChange,
  onRefresh,
  isRefreshing,
  updatedLabel,
  industries,
}: {
  filters: DashboardFilters;
  onChange: (patch: Partial<DashboardFilters>) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  updatedLabel: string;
  industries: string[];
}) {
  return (
    <section className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-bg-panel p-4">
      <Field label="Beobachtungszeitraum">
        <select
          className={SELECT_CLASS}
          value={filters.windowDays}
          onChange={(e) => onChange({ windowDays: parseInt(e.target.value, 10) })}
        >
          {[7, 14, 30, 45, 90].map((n) => (
            <option key={n} value={n}>
              {n} Tage
            </option>
          ))}
        </select>
      </Field>

      <Field label="Min. Übereinstimmung">
        <select
          className={SELECT_CLASS}
          value={filters.minAgree}
          onChange={(e) => onChange({ minAgree: parseInt(e.target.value, 10) })}
        >
          {[2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} Insider
            </option>
          ))}
        </select>
      </Field>

      <Field label="Min. Transaktionswert">
        <input
          type="number"
          min={0}
          step={500}
          value={filters.minUsd}
          onChange={(e) => onChange({ minUsd: parseFloat(e.target.value) || 0 })}
          className={INPUT_CLASS}
        />
      </Field>

      <Field label="Sortierung">
        <select
          className={SELECT_CLASS}
          value={filters.sortBy}
          onChange={(e) => onChange({ sortBy: e.target.value as SortOption })}
        >
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Branche">
        <select
          className={SELECT_CLASS}
          value={filters.industry}
          onChange={(e) => onChange({ industry: e.target.value })}
        >
          <option value="">Alle</option>
          {industries.map((industry) => (
            <option key={industry} value={industry}>
              {industry}
            </option>
          ))}
        </select>
      </Field>

      <label className="flex items-center gap-1.5 pb-2 text-[12.5px] text-text-dim">
        <input
          type="checkbox"
          checked={filters.buysOnly}
          onChange={(e) => onChange({ buysOnly: e.target.checked })}
          className="h-[15px] w-[15px] accent-accent"
        />
        Nur Käufe
      </label>

      <div className="flex-1" />

      <span className="pb-2 font-mono text-[11px] text-text-faint">{updatedLabel}</span>

      <ExportLinks filters={filters} />

      <SaveScreenButton filters={filters} />

      <button
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        className="rounded-md bg-accent px-4 py-2 font-mono text-[12.5px] font-medium uppercase tracking-wide text-[#14100a] transition hover:brightness-110 disabled:opacity-50"
      >
        {isRefreshing ? "Lädt…" : "Aktualisieren"}
      </button>
    </section>
  );
}

/** CSV/RSS export links, carrying the current filters (minus `industry`, which is a purely
 * client-side narrowing not recognized by the API — same as /api/signals itself). */
function ExportLinks({ filters }: { filters: DashboardFilters }) {
  const params = new URLSearchParams({
    windowDays: String(filters.windowDays),
    minAgree: String(filters.minAgree),
    minUsd: String(filters.minUsd),
    buysOnly: String(filters.buysOnly),
    sortBy: filters.sortBy,
  }).toString();

  return (
    <div className="flex items-center gap-2 pb-2 font-mono text-[11px] text-text-faint">
      <a href={`/api/export/signals.csv?${params}`} className="hover:text-accent hover:underline">
        CSV
      </a>
      <span className="text-border">·</span>
      <a href={`/feed.xml?${params}`} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">
        RSS
      </a>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-[10.5px] uppercase tracking-wide text-text-faint">
        {label}
      </label>
      {children}
    </div>
  );
}
