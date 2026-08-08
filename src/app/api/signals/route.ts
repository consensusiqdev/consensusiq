import { NextRequest, NextResponse } from "next/server";
import { getTickerIndustries, getTotalInsiderPositionsCount, getTransactionsSince } from "@/lib/db";
import {
  computeConsensus,
  filterAndSortConsensus,
  summarizeFilers,
  topBuyTransactions,
  type SortOption,
} from "@/lib/consensus";
import { enrichSignalsWithAcquisitionHistory } from "@/lib/premium";
import type { Transaction } from "@/types/filing";
import { getActiveSubscriberId } from "@/lib/subscription";

const SORT_OPTIONS: SortOption[] = ["consensus", "exposure", "conviction", "score"];

function pick<T extends string>(value: string | null, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

// Public endpoint (no auth gate) — the dashboard is free to browse; only the watchlist/alerts
// feature (src/app/api/watchlist/route.ts) requires an active subscription. We still check
// subscription status here, but only to decide whether to include the premium
// "when did they buy the shares they're now selling" enrichment — never to block access.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const sortBy = pick(params.get("sortBy"), SORT_OPTIONS, "consensus");
  const windowDays = Math.min(90, Math.max(1, parseInt(params.get("windowDays") ?? "14", 10) || 14));
  const minAgree = Math.max(1, parseInt(params.get("minAgree") ?? "3", 10) || 3);
  const minUsd = Math.max(0, parseFloat(params.get("minUsd") ?? "1000") || 0);
  const buysOnly = params.get("buysOnly") !== "false";

  try {
    const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    // Fetches two windows' worth (current + the immediately preceding, equal-length one) in a
    // single query, so the KPI row can show "vs. vorheriger Zeitraum" without a second round trip.
    const previousWindowStart = new Date(Date.now() - windowDays * 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const rows = await getTransactionsSince(previousWindowStart);

    // Includes every tracked code (open-market trades + compensation-related events like grants/
    // exercises) — only used here to build `filers`/`topBuys`/signals off the open-market subset
    // below; the wider set exists so the premium acquisition-history lookup (queried separately,
    // straight from the DB) has grants/exercises to find.
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

    // The main consensus/signal-score computation only ever considers genuine open-market trades
    // — grants, option exercises, tax-withholding dispositions, and gifts are not voluntary
    // trading decisions and would just dilute the signal (see TransactionCode in types/filing.ts).
    // Same reasoning excludes `nearOffering` trades: a "P" purchase made as part of a coordinated
    // IPO-directed share allocation (verified real case: BRVE, 6 insiders at the identical $18.00
    // offer price on the same day) isn't an independent conviction decision either.
    const openMarketOnly = allTransactions.filter(
      (t) => (t.transactionCode === "P" || t.transactionCode === "S") && !t.nearOffering
    );
    const currentOpenMarket = openMarketOnly.filter((t) => t.filedDate >= windowStart);
    const previousOpenMarket = openMarketOnly.filter((t) => t.filedDate < windowStart);

    const transactions = buysOnly ? currentOpenMarket.filter((t) => t.side === "BUY") : currentOpenMarket;
    const previousTransactions = buysOnly
      ? previousOpenMarket.filter((t) => t.side === "BUY")
      : previousOpenMarket;

    const filers = summarizeFilers(transactions);
    const allSignals = computeConsensus(transactions, minUsd);
    const signals = filterAndSortConsensus(allSignals, minAgree, sortBy);
    const industries = await getTickerIndustries();
    for (const s of signals) s.industry = industries.get(s.ticker) ?? null;
    // Independent of `buysOnly` — always surfaces real purchases, even while the main list
    // is showing sell-side consensus (buys are rarer, so this shouldn't be hidden by a filter
    // meant for the ticker-consensus list). Uses openMarketOnly, not allTransactions — a stock
    // grant isn't a "buy" worth highlighting here.
    const topBuys = topBuyTransactions(currentOpenMarket);

    // Same pipeline (minUsd/minAgree/buysOnly-filtered) run on the immediately preceding,
    // equal-length window — powers the KPI row's "vs. vorheriger Zeitraum" deltas. Only the
    // aggregate volume is needed here, not per-ticker detail.
    const previousSignals = filterAndSortConsensus(
      computeConsensus(previousTransactions, minUsd),
      minAgree,
      sortBy
    );
    const previousPeriodValueUsd = previousSignals.reduce((sum, s) => sum + s.totalValueAll, 0);

    if (await getActiveSubscriberId()) {
      await enrichSignalsWithAcquisitionHistory(signals);
    }

    return NextResponse.json({
      filers,
      signals,
      topBuys,
      totalInsidersTracked: await getTotalInsiderPositionsCount(),
      previousPeriodValueUsd,
    });
  } catch (err) {
    console.error("GET /api/signals failed:", err);
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
