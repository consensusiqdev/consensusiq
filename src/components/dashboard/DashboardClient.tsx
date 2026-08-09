"use client";

import { useEffect, useMemo, useState } from "react";
import type { FilerSummary, TickerSignal, Transaction } from "@/types/filing";
import FilterBar, { type DashboardFilters } from "@/components/dashboard/FilterBar";
import KPIGrid from "@/components/dashboard/KPIGrid";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import TickerDetailModal from "@/components/dashboard/TickerDetailModal";
import InsiderDetailModal from "@/components/dashboard/InsiderDetailModal";

const DEFAULT_FILTERS: DashboardFilters = {
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

const MIN_USD_DEBOUNCE_MS = 400;

export default function DashboardClient() {
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [debouncedMinUsd, setDebouncedMinUsd] = useState(filters.minUsd);
  const [filers, setFilers] = useState<FilerSummary[]>([]);
  const [signals, setSignals] = useState<TickerSignal[]>([]);
  const [topBuys, setTopBuys] = useState<Transaction[]>([]);
  const [totalInsidersTracked, setTotalInsidersTracked] = useState(0);
  const [currentMonthValueUsd, setCurrentMonthValueUsd] = useState<number | null>(null);
  const [previousMonthValueUsd, setPreviousMonthValueUsd] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [detailTicker, setDetailTicker] = useState<string | null>(null);
  const [selectedFiler, setSelectedFiler] = useState<{ ticker: string; filerId: string } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedMinUsd(filters.minUsd), MIN_USD_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [filters.minUsd]);

  useEffect(() => {
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
  }, [filters.windowDays, filters.minAgree, debouncedMinUsd, filters.buysOnly, filters.sortBy, refreshNonce]);

  function handleChange(patch: Partial<DashboardFilters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
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
