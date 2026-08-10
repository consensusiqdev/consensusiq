import "server-only";
import { getTickerIndustries, getTransactionsSince } from "@/lib/db";
import { computeConsensus, filterAndSortConsensus, type SortOption } from "@/lib/consensus";
import type { Transaction, TickerSignal } from "@/types/filing";

export const SORT_OPTIONS: SortOption[] = ["consensus", "exposure", "conviction", "score"];

export type SignalsQueryParams = {
  windowDays: number;
  minAgree: number;
  minUsd: number;
  buysOnly: boolean;
  sortBy: SortOption;
};

/** Same defaults/clamping as /api/signals/route.ts — kept identical so a CSV/RSS URL with no
 * query params matches what the dashboard shows by default — note this is NOT the same as
 * /api/signals/route.ts's own internal fallback defaults (sortBy "consensus", buysOnly true):
 * those never actually apply in practice since DashboardClient always sends every param
 * explicitly, whereas a bare /feed.xml or CSV export with no params relies on these being right. */
export function parseSignalsQueryParams(params: URLSearchParams): SignalsQueryParams {
  const sortByRaw = params.get("sortBy");
  const sortBy = SORT_OPTIONS.includes(sortByRaw as SortOption) ? (sortByRaw as SortOption) : "score";
  const windowDays = Math.min(90, Math.max(1, parseInt(params.get("windowDays") ?? "14", 10) || 14));
  const minAgree = Math.max(1, parseInt(params.get("minAgree") ?? "3", 10) || 3);
  const minUsd = Math.max(0, parseFloat(params.get("minUsd") ?? "1000") || 0);
  const buysOnly = params.get("buysOnly") === "true";
  return { windowDays, minAgree, minUsd, buysOnly, sortBy };
}

/**
 * The ticker-consensus list only, filtered/sorted the same way as /api/signals — reused by the
 * CSV export and RSS feed, which don't need /api/signals' extra filers/topBuys/month-over-month
 * fields. Not refactored into /api/signals/route.ts itself to avoid touching a well-exercised
 * route for this; that route keeps its own (slightly larger) copy of the same filtering steps.
 */
export async function getFilteredSignals(query: SignalsQueryParams): Promise<TickerSignal[]> {
  const windowStart = new Date(Date.now() - query.windowDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await getTransactionsSince(windowStart);

  const allTransactions: Transaction[] = rows.map((r, i) => ({
    id: `${r.ticker}:${r.filer_id}:${r.transaction_date}:${i}`,
    filerId: r.filer_id,
    filerType: r.filer_type as Transaction["filerType"],
    filerName: r.filer_name,
    filerRole: r.filer_role ?? undefined,
    ticker: r.ticker,
    companyName: r.company_name,
    side: r.side as Transaction["side"],
    transactionCode: (r.transaction_code ?? "P") as Transaction["transactionCode"],
    shares: r.shares,
    pricePerShare: r.price_per_share,
    valueUsd: r.value_usd,
    sharesOwnedAfter: r.shares_owned_after,
    transactionDate: r.transaction_date,
    filedDate: r.filed_date,
    sourceUrl: r.source_url,
    accessionNumber: "",
    nearOffering: r.near_offering === 1,
  }));

  const openMarketOnly = allTransactions.filter(
    (t) => (t.transactionCode === "P" || t.transactionCode === "S") && !t.nearOffering
  );
  const currentOpenMarket = openMarketOnly.filter((t) => t.filedDate >= windowStart);
  const transactions = query.buysOnly ? currentOpenMarket.filter((t) => t.side === "BUY") : currentOpenMarket;

  const allSignals = computeConsensus(transactions, query.minUsd);
  const signals = filterAndSortConsensus(allSignals, query.minAgree, query.sortBy);

  const industries = await getTickerIndustries();
  for (const s of signals) s.industry = industries.get(s.ticker) ?? null;

  return signals;
}
