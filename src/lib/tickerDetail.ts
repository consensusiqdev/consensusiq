import "server-only";
import { getTickerHistory, getTickerIndustries } from "@/lib/db";
import { getInstitutionalTimelineEvents } from "@/lib/institutional";
import { enrichTransactionsWithAcquisitionHistory } from "@/lib/premium";
import { fetchCompanyEvents } from "@/lib/secEdgar";
import { buildTickerMap, computeSignalHistory, summarizeTickers, type SignalHistoryPoint } from "@/lib/consensus";
import { getSectorOverview } from "@/lib/sectors";
import { getActiveSubscriberId } from "@/lib/subscription";
import type { CompanyEvent, InstitutionalEvent, Transaction, TickerSignal, TransactionSide } from "@/types/filing";

// Fixed window for the "current" signal score shown on public/SEO pages (company page, peers) —
// same reasoning as sectors.ts: filter-independent, so numbers stay comparable across pages
// regardless of what any individual visitor has set on the dashboard.
const CURRENT_WINDOW_DAYS = 30;
const MIN_USD = 1000;
const PEER_LIMIT = 5;

export type TickerDetail = {
  ticker: string;
  companyName: string;
  industry: string | null;
  stats: { buyCount: number; sellCount: number; distinctFilers: number; total: number };
  transactions: Transaction[];
  companyEvents: CompanyEvent[];
  institutionalEvents: InstitutionalEvent[];
  signalScore: number | null;
  leadSide: TransactionSide | null;
  leadCount: number;
  signalHistory: SignalHistoryPoint[];
  peers: TickerSignal[];
};

/**
 * Everything needed for a ticker's detail view — both the dashboard's modal (via
 * api/ticker-detail/route.ts, a thin wrapper around this) and the public /company/[ticker] page
 * call this directly, so the two never drift out of sync.
 */
export async function getTickerDetail(ticker: string): Promise<TickerDetail> {
  const rows = await getTickerHistory(ticker);
  const allTransactions: Transaction[] = rows.map((r, i) => ({
    id: `${ticker}:${r.filer_id}:${r.transaction_date}:${i}`,
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

  // The visible trading-history list stays open-market-only, same reasoning as /api/signals —
  // grants/exercises aren't trading decisions and would misleadingly show up with a BUY badge.
  const transactions = allTransactions.filter((t) => t.transactionCode === "P" || t.transactionCode === "S");
  // Additionally excludes nearOffering trades — same reasoning as /api/signals — but only for the
  // score computations below; the visible history list above still shows them, flagged, per the
  // `nearOffering` field's own doc comment ("still shown ... for transparency").
  const openMarketOnly = transactions.filter((t) => !t.nearOffering);

  const companyName = transactions[0]?.companyName ?? allTransactions[0]?.companyName ?? ticker;
  const buyCount = transactions.filter((t) => t.side === "BUY").length;
  const sellCount = transactions.length - buyCount;
  const distinctFilers = new Set(transactions.map((t) => t.filerId)).size;

  // Newest first for the detail view (getTickerHistory orders oldest-first for chart-style use).
  const sorted = [...transactions].sort((a, b) => (a.transactionDate < b.transactionDate ? 1 : -1));

  if (await getActiveSubscriberId()) {
    await enrichTransactionsWithAcquisitionHistory(sorted);
  }

  const companyEvents = await fetchCompanyEvents(ticker).catch((err) => {
    console.warn(`[tickerDetail] Company-Events für ${ticker} konnten nicht geladen werden:`, err);
    return [];
  });

  let institutionalEvents: InstitutionalEvent[] = [];
  try {
    institutionalEvents = await getInstitutionalTimelineEvents(ticker);
  } catch (err) {
    console.warn(`[tickerDetail] Institutionelle Aktivität für ${ticker} konnte nicht geladen werden:`, err);
  }

  const industries = await getTickerIndustries();
  const industry = industries.get(ticker) ?? null;

  const currentWindowStart = new Date(Date.now() - CURRENT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const currentWindowTx = openMarketOnly.filter((t) => t.filedDate >= currentWindowStart);
  const [currentSignal] = currentWindowTx.length > 0 ? summarizeTickers(buildTickerMap(currentWindowTx, MIN_USD)) : [];

  const signalHistory = computeSignalHistory(openMarketOnly, 12, MIN_USD);

  let peers: TickerSignal[] = [];
  if (industry) {
    const overview = await getSectorOverview(industry);
    peers = overview.signals
      .filter((s) => s.ticker !== ticker)
      .sort((a, b) => b.signalScore - a.signalScore)
      .slice(0, PEER_LIMIT);
  }

  return {
    ticker,
    companyName,
    industry,
    stats: { buyCount, sellCount, distinctFilers, total: transactions.length },
    transactions: sorted,
    companyEvents,
    institutionalEvents,
    signalScore: currentSignal?.signalScore ?? null,
    leadSide: currentSignal?.leadSide ?? null,
    leadCount: currentSignal?.leadCount ?? 0,
    signalHistory,
    peers,
  };
}
