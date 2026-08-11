import "server-only";
import { getTickerIndustries, getTransactionsSince } from "@/lib/db";
import { computeConsensus } from "@/lib/consensus";
import type { Transaction, TickerSignal } from "@/types/filing";

// Fixed window for all sector/company SEO pages — these are public, crawlable pages (not the
// dashboard's filter-driven view), so a stable, filter-independent recency window keeps every
// page's numbers comparable to each other. 30 days / $1000 mirrors the same constants used in
// tickerDetail.ts's peers lookup (kept as separate literals there to avoid a circular import).
const WINDOW_DAYS = 30;
const MIN_USD = 1000;

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
  const [industriesMap, windowStart] = await Promise.all([
    getTickerIndustries(),
    Promise.resolve(new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)),
  ]);

  const tickersInIndustry = new Set([...industriesMap.entries()].filter(([, ind]) => ind === industry).map(([t]) => t));

  const rows = await getTransactionsSince(windowStart);
  const transactions: Transaction[] = rows
    .filter(
      (r) =>
        (r.transaction_code === "P" || r.transaction_code === "S") &&
        r.near_offering !== 1 &&
        r.is_plan_trade !== 1 &&
        tickersInIndustry.has(r.ticker)
    )
    .map((r, i) => ({
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
    }));

  const signals = computeConsensus(transactions, MIN_USD);
  for (const s of signals) s.industry = industry;

  return { industry, tickerCount: tickersInIndustry.size, signals };
}
