import "server-only";
import { getTransactionsSince, recordTweet, wasRecentlyTweeted } from "@/lib/db";
import { computeConsensus } from "@/lib/consensus";
import { postTweet } from "@/lib/twitter";
import type { Transaction, TickerSignal } from "@/types/filing";

const WINDOW_DAYS = 14;
const MIN_SIGNAL_SCORE = 65;
const MIN_LEAD_COUNT = 3;
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // don't re-post the same ticker within a week

function isTweetWorthy(s: TickerSignal): boolean {
  return s.leadSide === "BUY" && s.signalScore >= MIN_SIGNAL_SCORE && s.leadCount >= MIN_LEAD_COUNT;
}

export function buildTweetText(signal: TickerSignal): string {
  const link = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`;
  return (
    `🔍 ${signal.leadCount} insiders independently bought $${signal.ticker} ` +
    `(Signal Score: ${signal.signalScore}/100)\n\n${link}\n\n#insidertrading #stocks`
  );
}

/**
 * Checks the current BUY-led consensus signals for a tweet-worthy cluster and posts (or, absent
 * TWITTER_BOT_ENABLED, dry-run logs) at most one per call — deliberately conservative: X has no
 * free tier as of 2026, and only the strongest clusters are worth the per-post cost anyway.
 */
export async function checkAndPostTwitterSignals(): Promise<void> {
  const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await getTransactionsSince(windowStart);

  const openMarketOnly: Transaction[] = rows
    .filter(
      (r) =>
        (r.transaction_code === "P" || r.transaction_code === "S") &&
        r.near_offering !== 1 &&
        r.is_plan_trade !== 1
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
      transactionCode: r.transaction_code as Transaction["transactionCode"],
      shares: r.shares,
      pricePerShare: r.price_per_share,
      valueUsd: r.value_usd,
      sharesOwnedAfter: r.shares_owned_after,
      transactionDate: r.transaction_date,
      filedDate: r.filed_date,
      sourceUrl: r.source_url,
      accessionNumber: "",
      nearOffering: false, // already filtered out above
      isPlanTrade: false, // already filtered out above
      isCSuite: r.is_c_suite === 1,
    }));

  const signals = computeConsensus(openMarketOnly, 1000);

  // Array.prototype.find can't take an async predicate (the callback's Promise is always
  // truthy, silently breaking the cooldown check) — a plain loop is required here.
  let candidate: TickerSignal | undefined;
  for (const s of signals.filter(isTweetWorthy)) {
    if (!(await wasRecentlyTweeted(s.ticker, COOLDOWN_MS))) {
      candidate = s;
      break;
    }
  }

  if (!candidate) return;

  await postTweet(buildTweetText(candidate));
  await recordTweet(candidate.ticker, candidate.leadCount);
}
