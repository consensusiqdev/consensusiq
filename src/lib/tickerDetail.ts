import "server-only";
import { getTickerHistory, getTickerIndustries } from "@/lib/db";
import { getInstitutionalConsensusForTicker, getInstitutionalTimelineEvents } from "@/lib/institutional";
import { enrichTransactionsWithAcquisitionHistory } from "@/lib/premium";
import { fetchCompanyEvents } from "@/lib/secEdgar";
import {
  buildTickerMap,
  computeSignalHistory,
  summarizeTickers,
  type ScoreComponents,
  type SignalHistoryPoint,
} from "@/lib/consensus";
import { getSectorOverview } from "@/lib/sectors";
import { getFilteredSignals } from "@/lib/signalsQuery";
import { getActiveSubscriberId } from "@/lib/subscription";
import type {
  CompanyEvent,
  InstitutionalConsensusSignal,
  InstitutionalEvent,
  Transaction,
  TickerSignal,
  TransactionSide,
} from "@/types/filing";

// Fixed window for the "current" signal score shown on public/SEO pages (company page, peers) —
// same reasoning as sectors.ts: filter-independent, so numbers stay comparable across pages
// regardless of what any individual visitor has set on the dashboard.
export const CURRENT_WINDOW_DAYS = 30;
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
  // The same Smart-Money-Konsens score the /institutional page ranks by, so a visitor arriving
  // from that list sees the number they clicked on. null = no cross-fund consensus (fewer than 2
  // funds with a measurable trend) — which is NOT the same as no fund activity, see
  // institutionalEvents above.
  institutionalConsensus: InstitutionalConsensusSignal | null;
  signalScore: number | null;
  leadSide: TransactionSide | null;
  leadCount: number;
  // The four ratios `signalScore` was built from, so the score can be tapped open into its own
  // breakdown here too — the dashboard card has always offered that, the company page could not,
  // because these never left computeConsensus(). null whenever there is no active signal.
  scoreComponents: ScoreComponents | null;
  scoreSideMultiplier: number | null;
  signalHistory: SignalHistoryPoint[];
  peers: TickerSignal[];
  // Where this ticker's current score ranks among every OTHER ticker with an active signal right
  // now, same window/$-threshold basis as signalScore itself ("stronger than N% of..." by
  // magnitude, direction-agnostic — see the abs() comparison in getTickerDetail below), and how
  // many other tickers that comparison is against. null/0 when there's no active signal to rank,
  // or nothing else currently active to compare against.
  scorePercentile: number | null;
  activeSignalCount: number;
};

function mapRowsToTransactions(ticker: string, rows: Awaited<ReturnType<typeof getTickerHistory>>): Transaction[] {
  return rows.map((r, i) => ({
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
    isPlanTrade: r.is_plan_trade === 1,
    isCSuite: r.is_c_suite === 1,
    isFreshInsider: r.is_fresh_insider === 1,
  }));
}

export type TickerSummary = {
  ticker: string;
  companyName: string;
  industry: string | null;
  signalScore: number | null;
  leadSide: TransactionSide | null;
  leadCount: number;
};

/** Lightweight subset of getTickerDetail() — just the current signal, no SEC EDGAR company-events/
 * institutional-timeline calls or premium enrichment. Used by the opengraph-image route, which
 * gets re-fetched by link-preview crawlers and shouldn't pay for the full detail computation. */
export async function getTickerSummary(ticker: string): Promise<TickerSummary> {
  const [rows, industries] = await Promise.all([getTickerHistory(ticker), getTickerIndustries()]);
  const transactions = mapRowsToTransactions(ticker, rows);
  const companyName = transactions[transactions.length - 1]?.companyName ?? ticker;
  const industry = industries.get(ticker) ?? null;

  const currentWindowStart = new Date(Date.now() - CURRENT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const currentWindowTx = transactions.filter(
    (t) =>
      (t.transactionCode === "P" || t.transactionCode === "S") &&
      !t.nearOffering &&
      !t.isPlanTrade &&
      t.filedDate >= currentWindowStart
  );
  const [currentSignal] = currentWindowTx.length > 0 ? summarizeTickers(buildTickerMap(currentWindowTx, MIN_USD)) : [];

  return {
    ticker,
    companyName,
    industry,
    signalScore: currentSignal?.signalScore ?? null,
    leadSide: currentSignal?.leadSide ?? null,
    leadCount: currentSignal?.leadCount ?? 0,
  };
}

export type TickerComparisonData = {
  ticker: string;
  companyName: string;
  industry: string | null;
  stats: { buyCount: number; sellCount: number; distinctFilers: number; total: number; totalVolumeUsd: number };
  signalScore: number | null;
  leadSide: TransactionSide | null;
  leadCount: number;
  signalHistory: SignalHistoryPoint[];
  recentTransactions: Transaction[];
};

const RECENT_TRANSACTIONS_LIMIT = 5;

/** Lightweight subset of getTickerDetail() for the /compare page — same reasoning as
 * getTickerSummary() above: two tickers get fetched per page load, so this deliberately skips the
 * live SEC EDGAR company-events/institutional-timeline calls and premium enrichment, none of which
 * the comparison view needs. */
export async function getTickerComparisonData(ticker: string): Promise<TickerComparisonData> {
  const [rows, industries] = await Promise.all([getTickerHistory(ticker), getTickerIndustries()]);
  const allTransactions = mapRowsToTransactions(ticker, rows);
  const transactions = allTransactions.filter((t) => t.transactionCode === "P" || t.transactionCode === "S");
  const openMarketOnly = transactions.filter((t) => !t.nearOffering && !t.isPlanTrade);

  const companyName = transactions[0]?.companyName ?? allTransactions[0]?.companyName ?? ticker;
  const industry = industries.get(ticker) ?? null;
  const buyCount = transactions.filter((t) => t.side === "BUY").length;
  const sellCount = transactions.length - buyCount;
  const distinctFilers = new Set(transactions.map((t) => t.filerId)).size;
  const totalVolumeUsd = transactions.reduce((sum, t) => sum + (t.valueUsd ?? 0), 0);

  const sorted = [...transactions].sort((a, b) => (a.transactionDate < b.transactionDate ? 1 : -1));

  const currentWindowStart = new Date(Date.now() - CURRENT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const currentWindowTx = openMarketOnly.filter((t) => t.filedDate >= currentWindowStart);
  const [currentSignal] = currentWindowTx.length > 0 ? summarizeTickers(buildTickerMap(currentWindowTx, MIN_USD)) : [];

  const signalHistory = computeSignalHistory(openMarketOnly, 12, MIN_USD);

  return {
    ticker,
    companyName,
    industry,
    stats: { buyCount, sellCount, distinctFilers, total: transactions.length, totalVolumeUsd },
    signalScore: currentSignal?.signalScore ?? null,
    leadSide: currentSignal?.leadSide ?? null,
    leadCount: currentSignal?.leadCount ?? 0,
    signalHistory,
    recentTransactions: sorted.slice(0, RECENT_TRANSACTIONS_LIMIT),
  };
}

/**
 * Everything needed for a ticker's detail view — both the dashboard's modal (via
 * api/ticker-detail/route.ts, a thin wrapper around this) and the public /company/[ticker] page
 * call this directly, so the two never drift out of sync.
 */
export async function getTickerDetail(ticker: string): Promise<TickerDetail> {
  // These five don't depend on each other, and fetchCompanyEvents() in particular is a live SEC
  // EDGAR round trip behind a 120ms throttle — awaited one after another (as this used to be) the
  // page waited for their sum instead of their max, which is most of why it felt slow.
  const [rows, companyEvents, institutionalEvents, institutionalConsensus, industries] = await Promise.all([
    getTickerHistory(ticker),
    fetchCompanyEvents(ticker).catch((err) => {
      console.warn(`[tickerDetail] Company-Events für ${ticker} konnten nicht geladen werden:`, err);
      return [] as CompanyEvent[];
    }),
    getInstitutionalTimelineEvents(ticker).catch((err) => {
      console.warn(`[tickerDetail] Institutionelle Aktivität für ${ticker} konnte nicht geladen werden:`, err);
      return [] as InstitutionalEvent[];
    }),
    getInstitutionalConsensusForTicker(ticker).catch((err) => {
      console.warn(`[tickerDetail] Smart-Money-Konsens für ${ticker} konnte nicht berechnet werden:`, err);
      return null;
    }),
    getTickerIndustries(),
  ]);

  const allTransactions = mapRowsToTransactions(ticker, rows);

  // The visible trading-history list stays open-market-only, same reasoning as /api/signals —
  // grants/exercises aren't trading decisions and would misleadingly show up with a BUY badge.
  const transactions = allTransactions.filter((t) => t.transactionCode === "P" || t.transactionCode === "S");
  // Additionally excludes nearOffering/isPlanTrade trades — same reasoning as /api/signals — but
  // only for the score computations below; the visible history list above still shows them,
  // flagged, per those fields' own doc comments ("still shown ... for transparency").
  const openMarketOnly = transactions.filter((t) => !t.nearOffering && !t.isPlanTrade);

  const companyName = transactions[0]?.companyName ?? allTransactions[0]?.companyName ?? ticker;
  const buyCount = transactions.filter((t) => t.side === "BUY").length;
  const sellCount = transactions.length - buyCount;
  const distinctFilers = new Set(transactions.map((t) => t.filerId)).size;

  // Newest first for the detail view (getTickerHistory orders oldest-first for chart-style use).
  const sorted = [...transactions].sort((a, b) => (a.transactionDate < b.transactionDate ? 1 : -1));

  if (await getActiveSubscriberId()) {
    await enrichTransactionsWithAcquisitionHistory(sorted);
  }

  const industry = industries.get(ticker) ?? null;

  const currentWindowStart = new Date(Date.now() - CURRENT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const currentWindowTx = openMarketOnly.filter((t) => t.filedDate >= currentWindowStart);
  const [currentSignal] = currentWindowTx.length > 0 ? summarizeTickers(buildTickerMap(currentWindowTx, MIN_USD)) : [];

  // Percentile among every OTHER ticker currently scored under the exact same basis (minAgree: 1
  // mirrors that this ticker's own score above also has no minAgree floor) — apples to apples,
  // not compared against the dashboard's filter-dependent list.
  let scorePercentile: number | null = null;
  let activeSignalCount = 0;
  if (currentSignal) {
    try {
      const allActive = await getFilteredSignals({
        windowDays: CURRENT_WINDOW_DAYS,
        minAgree: 1,
        minUsd: MIN_USD,
        buysOnly: false,
        cSuiteOnly: false,
        sortBy: "score",
      });
      const others = allActive.filter((s) => s.ticker !== ticker);
      activeSignalCount = others.length;
      if (others.length > 0) {
        // By magnitude, not signed value — "stronger" means more conviction in either direction,
        // so an extreme sell-off (e.g. -95) should rank near the top, not near the bottom just
        // because it's numerically less than a middling buy signal.
        const currentMagnitude = Math.abs(currentSignal.signalScore);
        const below = others.filter((s) => Math.abs(s.signalScore) <= currentMagnitude).length;
        scorePercentile = Math.round((below / others.length) * 100);
      }
    } catch (err) {
      console.warn(`[tickerDetail] Percentile für ${ticker} konnte nicht berechnet werden:`, err);
    }
  }

  const signalHistory = computeSignalHistory(openMarketOnly, 12, MIN_USD);

  let peers: TickerSignal[] = [];
  if (industry) {
    const overview = await getSectorOverview(industry);
    peers = overview.signals
      .filter((s) => s.ticker !== ticker)
      .sort((a, b) => Math.abs(b.signalScore) - Math.abs(a.signalScore))
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
    institutionalConsensus,
    signalScore: currentSignal?.signalScore ?? null,
    leadSide: currentSignal?.leadSide ?? null,
    leadCount: currentSignal?.leadCount ?? 0,
    scoreComponents: currentSignal
      ? {
          convictionRatio: currentSignal.convictionRatio,
          dollarWeightedRatio: currentSignal.dollarWeightedRatio,
          avgHoldingsPct: currentSignal.avgHoldingsPct,
          clusterTightnessRatio: currentSignal.clusterTightnessRatio,
        }
      : null,
    scoreSideMultiplier: currentSignal?.sideMultiplier ?? null,
    signalHistory,
    peers,
    scorePercentile,
    activeSignalCount,
  };
}
