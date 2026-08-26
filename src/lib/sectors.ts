import "server-only";
import { cacheLife } from "next/cache";
import { getTickerIndustries, getTransactionsSince, type TransactionRow } from "@/lib/db";
import { computeConsensus, computeIndustrySignalHistory, type SignalHistoryPoint } from "@/lib/consensus";
import type { Transaction, TickerSignal } from "@/types/filing";

// Fixed window for all sector/company SEO pages — these are public, crawlable pages (not the
// dashboard's filter-driven view), so a stable, filter-independent recency window keeps every
// page's numbers comparable to each other. 30 days / $1000 mirrors the same constants used in
// tickerDetail.ts's peers lookup (kept as separate literals there to avoid a circular import).
const WINDOW_DAYS = 30;
const MIN_USD = 1000;
const TREND_WEEKS = 12;

function mapTransactionRow(r: TransactionRow, i: number): Transaction {
  return {
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
    isPlanTrade: r.is_plan_trade === 1,
    isCSuite: r.is_c_suite === 1,
    isFreshInsider: r.is_fresh_insider === 1,
  };
}

async function tickersInIndustry(industry: string): Promise<Set<string>> {
  const industriesMap = await getTickerIndustries();
  return new Set([...industriesMap.entries()].filter(([, ind]) => ind === industry).map(([t]) => t));
}

export function slugifyIndustry(industry: string): string {
  return industry
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Distinct industries currently on record, alongside their slug — the source of truth for both sitemap.ts and slug resolution. */
export async function listIndustries(): Promise<{ industry: string; slug: string }[]> {
  const industries = await getTickerIndustries();
  const distinct = [...new Set(industries.values())];
  return distinct.map((industry) => ({ industry, slug: slugifyIndustry(industry) })).sort((a, b) => a.industry.localeCompare(b.industry));
}

export async function resolveIndustryFromSlug(slug: string): Promise<string | null> {
  "use cache";
  cacheLife("publicIsr");

  const all = await listIndustries();
  return all.find((i) => i.slug === slug)?.industry ?? null;
}

/** Same distinct industries as listIndustries(), but with a ticker count per industry — cheap
 * (derived from the already-fetched ticker→industry map, no transactions query) so the /sector
 * hub page doesn't need to run a full consensus computation per industry just to show counts. */
export async function listIndustriesWithCounts(): Promise<{ industry: string; slug: string; tickerCount: number }[]> {
  const industries = await getTickerIndustries();
  const counts = new Map<string, number>();
  for (const industry of industries.values()) counts.set(industry, (counts.get(industry) ?? 0) + 1);
  return [...counts.entries()]
    .map(([industry, tickerCount]) => ({ industry, slug: slugifyIndustry(industry), tickerCount }))
    .sort((a, b) => b.tickerCount - a.tickerCount);
}

export type SectorOverview = {
  industry: string;
  tickerCount: number;
  signals: TickerSignal[];
};

/** Current signal-score consensus for every ticker in one industry, same recency window as tickerDetail.ts's peers lookup. */
export async function getSectorOverview(industry: string): Promise<SectorOverview> {
  "use cache";
  cacheLife("publicIsr");

  const [inIndustry, windowStart] = await Promise.all([
    tickersInIndustry(industry),
    Promise.resolve(new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)),
  ]);

  const rows = await getTransactionsSince(windowStart);
  const transactions = rows
    .filter(
      (r) =>
        (r.transaction_code === "P" || r.transaction_code === "S") &&
        r.near_offering !== 1 &&
        r.is_plan_trade !== 1 &&
        inIndustry.has(r.ticker)
    )
    .map(mapTransactionRow);

  const signals = computeConsensus(transactions, MIN_USD);
  for (const s of signals) s.industry = industry;

  return { industry, tickerCount: inIndustry.size, signals };
}

/**
 * Weekly-bucketed AGGREGATE signal-score trend for an entire industry — is insider sentiment here
 * rising or falling over the last 12 weeks? Reuses computeSignalHistory's per-ticker week-bucketing
 * pipeline via computeIndustrySignalHistory(), which relabels every transaction under one synthetic
 * "ticker" so the whole industry's activity gets aggregated into a single score per week instead of
 * one score per real ticker. Needs its own (longer) fetch window than getSectorOverview's 30 days.
 */
export async function getSectorSignalHistory(industry: string): Promise<SignalHistoryPoint[]> {
  "use cache";
  cacheLife("publicIsr");

  const [inIndustry, windowStart] = await Promise.all([
    tickersInIndustry(industry),
    Promise.resolve(new Date(Date.now() - TREND_WEEKS * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)),
  ]);

  const rows = await getTransactionsSince(windowStart);
  const transactions = rows
    .filter(
      (r) =>
        (r.transaction_code === "P" || r.transaction_code === "S") &&
        r.near_offering !== 1 &&
        r.is_plan_trade !== 1 &&
        inIndustry.has(r.ticker)
    )
    .map(mapTransactionRow);

  return computeIndustrySignalHistory(transactions, TREND_WEEKS, MIN_USD);
}

export type IndustryTrend = {
  direction: "up" | "down" | "flat" | "unknown";
  recentAvg: number | null;
  priorAvg: number | null;
};

// A difference smaller than this is read as "flat" rather than a real up/down move — signal
// scores naturally jitter week to week even with no real change in sentiment.
const TREND_FLAT_THRESHOLD = 3;

/** Compares the last 4 weeks' average score against the 4 weeks before that — simple, honest
 * "is this heating up or cooling off" read, not a statistical trend test. "unknown" when either
 * half has zero weeks with any qualifying activity (nothing to compare). */
export function summarizeIndustryTrend(history: SignalHistoryPoint[]): IndustryTrend {
  const recent = history
    .slice(-4)
    .map((p) => p.score)
    .filter((s): s is number => s != null);
  const prior = history
    .slice(-8, -4)
    .map((p) => p.score)
    .filter((s): s is number => s != null);

  if (recent.length === 0 || prior.length === 0) {
    return { direction: "unknown", recentAvg: null, priorAvg: null };
  }

  const recentAvg = recent.reduce((sum, s) => sum + s, 0) / recent.length;
  const priorAvg = prior.reduce((sum, s) => sum + s, 0) / prior.length;
  const diff = recentAvg - priorAvg;
  const direction = Math.abs(diff) < TREND_FLAT_THRESHOLD ? "flat" : diff > 0 ? "up" : "down";

  return { direction, recentAvg, priorAvg };
}
