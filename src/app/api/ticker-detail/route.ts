import { NextRequest, NextResponse } from "next/server";
import { getTickerHistory } from "@/lib/db";
import { getInstitutionalTimelineEvents } from "@/lib/institutional";
import { enrichTransactionsWithAcquisitionHistory } from "@/lib/premium";
import { fetchCompanyEvents } from "@/lib/secEdgar";
import type { Transaction } from "@/types/filing";
import { getActiveSubscriberId } from "@/lib/subscription";

// Public endpoint — see /api/signals/route.ts for the same note (subscription is checked only
// to gate the premium prior-acquisition enrichment, never to block access).
export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "ticker fehlt" }, { status: 400 });
  }

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
  // They're still in `allTransactions` in the DB and get found by the premium lookup below.
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
    console.warn(`[ticker-detail] Company-Events für ${ticker} konnten nicht geladen werden:`, err);
    return [];
  });

  let institutionalEvents: Awaited<ReturnType<typeof getInstitutionalTimelineEvents>> = [];
  try {
    institutionalEvents = await getInstitutionalTimelineEvents(ticker);
  } catch (err) {
    console.warn(`[ticker-detail] Institutionelle Aktivität für ${ticker} konnte nicht geladen werden:`, err);
  }

  return NextResponse.json({
    ticker,
    companyName,
    stats: { buyCount, sellCount, distinctFilers, total: transactions.length },
    transactions: sorted,
    companyEvents,
    institutionalEvents,
  });
}
