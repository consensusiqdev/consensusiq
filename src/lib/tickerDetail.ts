import "server-only";
import { cache } from "react";
import { getTickerHistory } from "@/lib/db";
import { getInstitutionalTimelineEvents } from "@/lib/institutional";
import { enrichTransactionsWithAcquisitionHistory } from "@/lib/premium";
import { fetchCompanyEvents } from "@/lib/secEdgar";
import { getActiveSubscriberId } from "@/lib/subscription";
import type { CompanyEvent, InstitutionalEvent, Transaction } from "@/types/filing";

export type TickerDetail = {
  ticker: string;
  companyName: string;
  stats: { buyCount: number; sellCount: number; distinctFilers: number; total: number };
  transactions: Transaction[];
  companyEvents: CompanyEvent[];
  institutionalEvents: InstitutionalEvent[];
};

/**
 * Shared by `/ticker/[ticker]` and its intercepted `@modal` variant — wrapped in React's
 * `cache()` so a page's `generateMetadata` and its render body share one fetch per request
 * instead of hitting SEC EDGAR / Turso twice for the same ticker.
 */
export const getTickerDetail = cache(async (ticker: string): Promise<TickerDetail> => {
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
  // They're still in `allTransactions` and get found by the premium lookup below.
  const transactions = allTransactions.filter((t) => t.transactionCode === "P" || t.transactionCode === "S");

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

  let institutionalEvents: Awaited<ReturnType<typeof getInstitutionalTimelineEvents>> = [];
  try {
    institutionalEvents = await getInstitutionalTimelineEvents(ticker);
  } catch (err) {
    console.warn(`[tickerDetail] Institutionelle Aktivität für ${ticker} konnte nicht geladen werden:`, err);
  }

  return {
    ticker,
    companyName,
    stats: { buyCount, sellCount, distinctFilers, total: transactions.length },
    transactions: sorted,
    companyEvents,
    institutionalEvents,
  };
});
