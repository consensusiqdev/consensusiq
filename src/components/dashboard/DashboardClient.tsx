"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FilerSummary, TickerSignal, Transaction } from "@/types/filing";
import FilterBar, { DEFAULT_FILTERS, type DashboardFilters } from "@/components/dashboard/FilterBar";
import KPIGrid from "@/components/dashboard/KPIGrid";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import TickerDetailModal from "@/components/dashboard/TickerDetailModal";
import InsiderDetailModal from "@/components/dashboard/InsiderDetailModal";
import type { DashboardData } from "@/lib/signalsQuery";

const MIN_USD_DEBOUNCE_MS = 400;
const FILTERS_STORAGE_KEY = "insider-align-filters";

/** `initialData` is fetched server-side for DEFAULT_FILTERS specifically (see dashboard/page.tsx)
 * so the very first paint already has real content — without it, this component briefly rendered
 * with empty arrays and then popped in up to 10 ticker cards once the client fetch resolved, which
 * was the dashboard's dominant Cumulative Layout Shift contributor (Speed Insights flagged
 * CLS 0.58 / RES 60, both far worse than every other route). */
export default function DashboardClient({ initialData }: { initialData: DashboardData }) {
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [debouncedMinUsd, setDebouncedMinUsd] = useState(filters.minUsd);
  const [filers, setFilers] = useState<FilerSummary[]>(initialData.filers);
  const [signals, setSignals] = useState<TickerSignal[]>(initialData.signals);
  const [topBuys, setTopBuys] = useState<Transaction[]>(initialData.topBuys);
  const [totalInsidersTracked, setTotalInsidersTracked] = useState(initialData.totalInsidersTracked);
  const [currentMonthValueUsd, setCurrentMonthValueUsd] = useState<number | null>(initialData.currentMonthValueUsd);
  const [previousMonthValueUsd, setPreviousMonthValueUsd] = useState<number | null>(initialData.previousMonthValueUsd);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [detailTicker, setDetailTicker] = useState<string | null>(null);
  const [selectedFiler, setSelectedFiler] = useState<{ ticker: string; filerId: string } | null>(null);
  // The very first fetch-effect run, if the restored filters turn out to still be the defaults,
  // would just re-fetch the exact same data initialData already has — skip that one round trip.
  // A restored NON-default filter set still needs its own fetch, same as a manual refresh.
  const skipNextFetchRef = useRef(true);

  // Restore persisted filters once on mount — deliberately a useEffect (not a lazy useState
  // initializer) since this component's page is statically prerendered; reading localStorage
  // during the initial render would mismatch between server and client hydration. The main fetch
  // effect below waits for `filtersHydrated` so this doesn't cause an extra throwaway fetch with
  // the defaults before the restored filters are applied.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(FILTERS_STORAGE_KEY);
      if (stored) setFilters((prev) => ({ ...prev, ...JSON.parse(stored) }));
    } catch {
      // Corrupt/inaccessible localStorage — just keep the defaults.
    }
    setFiltersHydrated(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedMinUsd(filters.minUsd), MIN_USD_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [filters.minUsd]);

  useEffect(() => {
    if (!filtersHydrated) return;

    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      const isStillDefaultFilters =
        filters.windowDays === DEFAULT_FILTERS.windowDays &&
        filters.minAgree === DEFAULT_FILTERS.minAgree &&
        debouncedMinUsd === DEFAULT_FILTERS.minUsd &&
        filters.buysOnly === DEFAULT_FILTERS.buysOnly &&
        filters.sortBy === DEFAULT_FILTERS.sortBy;
      if (isStillDefaultFilters && refreshNonce === 0) return; // initialData already covers this
    }

    const controller = new AbortController();
    // Standard fetch-in-effect pattern (see react.dev/reference/react/useEffect#fetching-data-with-effects);
    // no data-fetching library in this project yet to hand this off to.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams({
      windowDays: String(filters.windowDays),
      minAgree: String(filters.minAgree),
      minUsd: String(debouncedMinUsd),
      buysOnly: String(filters.buysOnly),
      sortBy: filters.sortBy,
    });

    fetch(`/api/signals?${params}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Fehler ${res.status}`);
        setFilers(body.filers);
        setSignals(body.signals);
        setTopBuys(body.topBuys);
        setTotalInsidersTracked(body.totalInsidersTracked ?? 0);
        setCurrentMonthValueUsd(body.currentMonthValueUsd ?? null);
        setPreviousMonthValueUsd(body.previousMonthValueUsd ?? null);
        setUpdatedAt(new Date());
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [filtersHydrated, filters.windowDays, filters.minAgree, debouncedMinUsd, filters.buysOnly, filters.sortBy, refreshNonce]);

  function handleChange(patch: Partial<DashboardFilters>) {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable/full — filter still applies for this session, just won't persist.
      }
      return next;
    });
  }

  // Purely local filter — the API already attaches `industry` to every signal, so narrowing by
  // it doesn't need a refetch. Only applied to the ticker-consensus list, not KPIGrid/topBuys.
  const industries = useMemo(
    () => [...new Set(signals.map((s) => s.industry).filter((i): i is string => i != null))].sort(),
    [signals]
  );
  const filteredSignals = filters.industry
    ? signals.filter((s) => s.industry === filters.industry)
    : signals;

  function handleRefresh() {
    setRefreshNonce((n) => n + 1);
  }

  const updatedLabel = updatedAt
    ? `Aktualisiert ${updatedAt.toLocaleTimeString("de-DE")}`
    : "Noch nicht aktualisiert";

  return (
    <>
      <FilterBar
        filters={filters}
        onChange={handleChange}
        onRefresh={handleRefresh}
        isRefreshing={isLoading}
        updatedLabel={updatedLabel}
        industries={industries}
      />

      {error && (
        <div className="mb-4 rounded-lg border border-[#4a2323] bg-[#1c1211] px-3.5 py-2.5 font-mono text-[12.5px] text-[#f0a6a1]">
          {error}
        </div>
      )}

      <KPIGrid
        filers={filers}
        signals={signals}
        totalInsidersTracked={totalInsidersTracked}
        windowDays={filters.windowDays}
        currentMonthValueUsd={currentMonthValueUsd}
        previousMonthValueUsd={previousMonthValueUsd}
      />
      <DashboardLayout
        topBuys={topBuys}
        signals={filteredSignals}
        onSelectTicker={setDetailTicker}
        onSelectFiler={(ticker, filerId) => setSelectedFiler({ ticker, filerId })}
        resetKey={JSON.stringify(filters) + refreshNonce}
      />

      <TickerDetailModal ticker={detailTicker} onClose={() => setDetailTicker(null)} />
      <InsiderDetailModal
        ticker={selectedFiler?.ticker ?? ""}
        filerId={selectedFiler?.filerId ?? null}
        onClose={() => setSelectedFiler(null)}
      />
    </>
  );
}
