import "server-only";
import { createClient } from "@libsql/client";
import type { Transaction } from "@/types/filing";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const insertTransactionSql = `INSERT OR IGNORE INTO transactions
   (source_id, filer_type, filer_id, filer_name, filer_role, ticker, company_name, side, transaction_code,
    shares, price_per_share, value_usd, shares_owned_after, transaction_date, filed_date, source_url, ingested_at, near_offering)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function transactionArgs(entry: Transaction) {
  return [
    entry.id,
    entry.filerType,
    entry.filerId,
    entry.filerName,
    entry.filerRole ?? null,
    entry.ticker,
    entry.companyName,
    entry.side,
    entry.transactionCode,
    entry.shares,
    entry.pricePerShare,
    entry.valueUsd,
    entry.sharesOwnedAfter,
    entry.transactionDate,
    entry.filedDate,
    entry.sourceUrl,
    Date.now(),
    entry.nearOffering ? 1 : 0,
  ];
}

export async function insertTransaction(entry: Transaction): Promise<boolean> {
  const result = await client.execute({ sql: insertTransactionSql, args: transactionArgs(entry) });
  return result.rowsAffected > 0;
}

/** Batched insert for hot ingest loops — one network round trip per chunk instead of one per row. Returns whether each row (by array position) was newly inserted. */
export async function insertTransactionsBatch(entries: Transaction[]): Promise<boolean[]> {
  if (entries.length === 0) return [];
  const results = await client.batch(
    entries.map((entry) => ({ sql: insertTransactionSql, args: transactionArgs(entry) })),
    "write"
  );
  return results.map((r) => r.rowsAffected > 0);
}

export type TransactionRow = {
  filer_id: string;
  filer_type: string;
  filer_name: string;
  filer_role: string | null;
  ticker: string;
  company_name: string;
  side: string;
  transaction_code: string | null;
  shares: number | null;
  price_per_share: number | null;
  value_usd: number | null;
  shares_owned_after: number | null;
  transaction_date: string;
  filed_date: string;
  source_url: string;
  near_offering: number | null;
};

const COLUMNS = `filer_id, filer_type, filer_name, filer_role, ticker, company_name, side, transaction_code,
          shares, price_per_share, value_usd, shares_owned_after, transaction_date, filed_date, source_url, near_offering`;

// Only genuine open-market trades ever feed the main consensus/signal-score computation — see
// the note on TransactionCode in types/filing.ts. `getTransactionsSince`/`getTickerHistory`
// return everything we've tracked (including compensation-related events); it's the API routes'
// job to filter to `transaction_code IN ('P','S')` before computing signals.
const sinceSql = `SELECT ${COLUMNS} FROM transactions WHERE filed_date >= ? ORDER BY filed_date DESC`;

export async function getTransactionsSince(filedAfterIso: string): Promise<TransactionRow[]> {
  const result = await client.execute({ sql: sinceSql, args: [filedAfterIso] });
  return result.rows as unknown as TransactionRow[];
}

const tickerHistorySql = `SELECT ${COLUMNS} FROM transactions WHERE ticker = ? ORDER BY transaction_date ASC`;

export async function getTickerHistory(ticker: string): Promise<TransactionRow[]> {
  const result = await client.execute({ sql: tickerHistorySql, args: [ticker] });
  return result.rows as unknown as TransactionRow[];
}

const filerTickerHistorySql = `SELECT ${COLUMNS} FROM transactions WHERE ticker = ? AND filer_id = ? ORDER BY transaction_date ASC`;

/** One filer's full transaction history at one company, oldest first — every tracked code (not
 * just P/S), since the insider-detail shares-over-time view needs the true holdings trajectory,
 * not just open-market trades. */
export async function getFilerTransactionHistory(ticker: string, filerId: string): Promise<TransactionRow[]> {
  const result = await client.execute({ sql: filerTickerHistorySql, args: [ticker, filerId] });
  return result.rows as unknown as TransactionRow[];
}

const allTickersSql = `SELECT DISTINCT ticker FROM transactions`;

export async function getAllTickers(): Promise<string[]> {
  const result = await client.execute(allTickersSql);
  return (result.rows as unknown as { ticker: string }[]).map((r) => r.ticker);
}

const allCompaniesSql = `SELECT ticker, MAX(company_name) as company_name FROM transactions GROUP BY ticker ORDER BY ticker`;

export type CompanyRow = { ticker: string; company_name: string };

/** Every tracked ticker with its company name, for the company-search box — small enough
 * (hundreds, not thousands, of rows) to fetch once and filter client-side rather than building
 * a server-side search endpoint. */
export async function getAllCompanies(): Promise<CompanyRow[]> {
  const result = await client.execute(allCompaniesSql);
  return result.rows as unknown as CompanyRow[];
}

const mostRecentBuyBeforeSql = `SELECT transaction_date, price_per_share, shares, transaction_code FROM transactions
   WHERE filer_id = ? AND ticker = ? AND side = 'BUY' AND transaction_date < ?
   ORDER BY transaction_date DESC LIMIT 1`;

export type PriorBuyRow = {
  transaction_date: string;
  price_per_share: number | null;
  shares: number | null;
  transaction_code: string | null;
};

/** Premium feature: the most recent open-market BUY we've tracked for this filer+ticker before a given sale date. */
export async function getMostRecentBuyBefore(
  filerId: string,
  ticker: string,
  beforeDate: string
): Promise<PriorBuyRow | undefined> {
  const result = await client.execute({ sql: mostRecentBuyBeforeSql, args: [filerId, ticker, beforeDate] });
  return (result.rows[0] as unknown as PriorBuyRow) ?? undefined;
}

const upsertSubscriptionSql = `INSERT INTO subscriptions (clerk_user_id, status, lemonsqueezy_subscription_id, renews_at, updated_at)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(clerk_user_id) DO UPDATE SET
     status = excluded.status,
     lemonsqueezy_subscription_id = excluded.lemonsqueezy_subscription_id,
     renews_at = excluded.renews_at,
     updated_at = excluded.updated_at`;

export async function upsertSubscription(entry: {
  clerkUserId: string;
  status: string;
  lemonsqueezySubscriptionId: string | null;
  renewsAt: number | null;
}): Promise<void> {
  await client.execute({
    sql: upsertSubscriptionSql,
    args: [entry.clerkUserId, entry.status, entry.lemonsqueezySubscriptionId, entry.renewsAt, Date.now()],
  });
}

const subscriptionStatusSql = `SELECT status FROM subscriptions WHERE clerk_user_id = ?`;

export async function getSubscriptionStatus(clerkUserId: string): Promise<"active" | "inactive"> {
  const result = await client.execute({ sql: subscriptionStatusSql, args: [clerkUserId] });
  const row = result.rows[0] as unknown as { status: string } | undefined;
  return row?.status === "active" ? "active" : "inactive";
}

const addWatchlistSql = `INSERT OR IGNORE INTO watchlist (clerk_user_id, ticker, created_at) VALUES (?, ?, ?)`;

export async function addWatchlistEntry(clerkUserId: string, ticker: string): Promise<boolean> {
  const result = await client.execute({
    sql: addWatchlistSql,
    args: [clerkUserId, ticker.toUpperCase(), Date.now()],
  });
  return result.rowsAffected > 0;
}

const removeWatchlistSql = `DELETE FROM watchlist WHERE clerk_user_id = ? AND ticker = ?`;

export async function removeWatchlistEntry(clerkUserId: string, ticker: string): Promise<void> {
  await client.execute({ sql: removeWatchlistSql, args: [clerkUserId, ticker.toUpperCase()] });
}

const watchlistForUserSql = `SELECT ticker FROM watchlist WHERE clerk_user_id = ? ORDER BY created_at DESC`;

export async function getWatchlistForUser(clerkUserId: string): Promise<string[]> {
  const result = await client.execute({ sql: watchlistForUserSql, args: [clerkUserId] });
  return (result.rows as unknown as { ticker: string }[]).map((r) => r.ticker);
}

const watchersForTickerSql = `SELECT clerk_user_id FROM watchlist WHERE ticker = ?`;

export async function getWatchersForTicker(ticker: string): Promise<string[]> {
  const result = await client.execute({ sql: watchersForTickerSql, args: [ticker] });
  return (result.rows as unknown as { clerk_user_id: string }[]).map((r) => r.clerk_user_id);
}

const upsertTickerMetadataSql = `INSERT INTO ticker_metadata (ticker, sic_code, industry, updated_at)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(ticker) DO UPDATE SET sic_code = excluded.sic_code, industry = excluded.industry, updated_at = excluded.updated_at`;

export async function upsertTickerMetadata(ticker: string, sicCode: string, industry: string): Promise<void> {
  await client.execute({ sql: upsertTickerMetadataSql, args: [ticker, sicCode, industry, Date.now()] });
}

const tickerIndustriesSql = `SELECT ticker, industry FROM ticker_metadata`;

export async function getTickerIndustries(): Promise<Map<string, string>> {
  const result = await client.execute(tickerIndustriesSql);
  const rows = result.rows as unknown as { ticker: string; industry: string }[];
  return new Map(rows.map((r) => [r.ticker, r.industry]));
}

/** Which of the given tickers don't have an SIC lookup on record yet — drives the lazy per-ingest backfill in ingest.ts. */
export async function tickerMetadataMissing(tickers: string[]): Promise<string[]> {
  if (tickers.length === 0) return [];
  const placeholders = tickers.map(() => "?").join(",");
  const result = await client.execute({
    sql: `SELECT ticker FROM ticker_metadata WHERE ticker IN (${placeholders})`,
    args: tickers,
  });
  const known = new Set((result.rows as unknown as { ticker: string }[]).map((r) => r.ticker));
  return [...new Set(tickers)].filter((t) => !known.has(t));
}

const upsertInstitutionalHoldingSql = `INSERT INTO institutional_holdings
     (fund_cik, fund_name, cusip, ticker, issuer_name, quarter, shares, value_usd, filed_date, source_url, ingested_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(fund_cik, cusip, quarter) DO UPDATE SET
     ticker = excluded.ticker,
     shares = excluded.shares,
     value_usd = excluded.value_usd,
     filed_date = excluded.filed_date,
     source_url = excluded.source_url,
     ingested_at = excluded.ingested_at`;

export async function upsertInstitutionalHolding(entry: {
  fundCik: string;
  fundName: string;
  cusip: string;
  ticker: string | null;
  issuerName: string;
  quarter: string;
  shares: number | null;
  valueUsd: number | null;
  filedDate: string;
  sourceUrl: string;
}): Promise<void> {
  await client.execute({
    sql: upsertInstitutionalHoldingSql,
    args: [
      entry.fundCik,
      entry.fundName,
      entry.cusip,
      entry.ticker,
      entry.issuerName,
      entry.quarter,
      entry.shares,
      entry.valueUsd,
      entry.filedDate,
      entry.sourceUrl,
      Date.now(),
    ],
  });
}

export type InstitutionalHoldingRow = {
  fund_cik: string;
  fund_name: string;
  cusip: string;
  ticker: string | null;
  quarter: string;
  shares: number | null;
  value_usd: number | null;
  filed_date: string;
  source_url: string;
};

const institutionalActivitySql = `SELECT fund_cik, fund_name, cusip, ticker, quarter, shares, value_usd, filed_date, source_url
   FROM institutional_holdings WHERE ticker = ? ORDER BY fund_cik, quarter DESC`;

/** All tracked-fund holding snapshots for a ticker, newest quarter first per fund — caller diffs consecutive quarters per fund. */
export async function getInstitutionalActivity(ticker: string): Promise<InstitutionalHoldingRow[]> {
  const result = await client.execute({ sql: institutionalActivitySql, args: [ticker] });
  return result.rows as unknown as InstitutionalHoldingRow[];
}

const recentGlobalQuartersSql = `SELECT DISTINCT quarter FROM institutional_holdings ORDER BY quarter DESC LIMIT ?`;

/** The N most recent distinct quarters seen across ANY tracked fund — 13F periods are always
 * calendar-quarter-end, so this single global list (not a per-fund one) is the right window for
 * a cross-fund rolling score: every fund's "2026-Q1" means the same thing. */
export async function getRecentGlobalQuarters(limit: number): Promise<string[]> {
  const result = await client.execute({ sql: recentGlobalQuartersSql, args: [limit] });
  return (result.rows as unknown as { quarter: string }[]).map((r) => r.quarter);
}

export type TickerQuarterHoldingRow = {
  fund_cik: string;
  fund_name: string;
  ticker: string;
  issuer_name: string;
  quarter: string;
  value_usd: number | null;
};

/** Every resolved-ticker holding line across a set of quarters — the raw material for the
 * rolling institutional-consensus score, grouped/diffed by the caller per ticker per fund.
 * Unresolved CUSIPs (ticker IS NULL) are excluded — can't attribute them to a company page. */
export async function getHoldingsForQuarters(quarters: string[]): Promise<TickerQuarterHoldingRow[]> {
  if (quarters.length === 0) return [];
  const placeholders = quarters.map(() => "?").join(",");
  const sql = `SELECT fund_cik, fund_name, ticker, issuer_name, quarter, value_usd
     FROM institutional_holdings WHERE ticker IS NOT NULL AND quarter IN (${placeholders})`;
  const result = await client.execute({ sql, args: quarters });
  return result.rows as unknown as TickerQuarterHoldingRow[];
}

/** Each fund's total portfolio value per quarter (sum across ALL its holdings, not just one
 * ticker) — needed to turn a raw position value into a portfolio-weight, the "conviction" signal
 * for the institutional-consensus score (mirrors consensus.ts's pctOfPriorHoldings in spirit). */
export async function getFundTotalsForQuarters(quarters: string[]): Promise<Map<string, number>> {
  if (quarters.length === 0) return new Map();
  const placeholders = quarters.map(() => "?").join(",");
  const sql = `SELECT fund_cik, quarter, SUM(value_usd) as total
     FROM institutional_holdings WHERE quarter IN (${placeholders}) GROUP BY fund_cik, quarter`;
  const result = await client.execute({ sql, args: quarters });
  const rows = result.rows as unknown as { fund_cik: string; quarter: string; total: number }[];
  return new Map(rows.map((r) => [`${r.fund_cik}:${r.quarter}`, r.total]));
}

export type FundHoldingRow = {
  ticker: string | null;
  issuer_name: string;
  shares: number | null;
  value_usd: number | null;
};

const fundHoldingsSql = `SELECT ticker, issuer_name, shares, value_usd
   FROM institutional_holdings WHERE fund_cik = ? AND quarter = ? ORDER BY value_usd DESC`;

/** Every position a fund reported for one quarter (all of it, not just top N) — the /institutional overview page sorts/slices/sums this itself. */
export async function getFundHoldings(fundCik: string, quarter: string): Promise<FundHoldingRow[]> {
  const result = await client.execute({ sql: fundHoldingsSql, args: [fundCik, quarter] });
  return result.rows as unknown as FundHoldingRow[];
}

const fundLatestQuarterSql = `SELECT fund_cik, MAX(quarter) as quarter FROM institutional_holdings GROUP BY fund_cik`;

/** Most recent quarter we have ANY holding on record for, per fund — lexicographic "YYYY-QN" comparison works since it sorts chronologically. Used to detect a fund closing a position (present in an older quarter, absent from its latest filing). */
export async function getFundLatestQuarters(): Promise<Map<string, string>> {
  const result = await client.execute(fundLatestQuarterSql);
  const rows = result.rows as unknown as { fund_cik: string; quarter: string }[];
  return new Map(rows.map((r) => [r.fund_cik, r.quarter]));
}

const distinctFundQuartersSql = `SELECT DISTINCT fund_cik, quarter FROM institutional_holdings ORDER BY fund_cik, quarter DESC`;

/** Per fund, its two most recent distinct quarters on record (newest first; second element is
 * undefined if we only have one quarter for that fund yet) — used to quarter-over-quarter diff
 * every fund's holdings for the "biggest position changes" feature, not just a single ticker. */
export async function getFundRecentQuarters(): Promise<Map<string, [string, string | undefined]>> {
  const result = await client.execute(distinctFundQuartersSql);
  const rows = result.rows as unknown as { fund_cik: string; quarter: string }[];
  const byFund = new Map<string, string[]>();
  for (const r of rows) {
    const list = byFund.get(r.fund_cik) ?? [];
    if (list.length < 2) list.push(r.quarter);
    byFund.set(r.fund_cik, list);
  }

  const result2 = new Map<string, [string, string | undefined]>();
  for (const [cik, quarters] of byFund) {
    result2.set(cik, [quarters[0], quarters[1]]);
  }
  return result2;
}

const fundQuarterFilingSql = `SELECT filed_date, source_url FROM institutional_holdings WHERE fund_cik = ? AND quarter = ? LIMIT 1`;

/** Filing metadata for any holding row of a fund's given quarter — same filing, so filed_date/source_url are identical across that fund's rows for that quarter. */
export async function getFundQuarterFiling(
  fundCik: string,
  quarter: string
): Promise<{ filed_date: string; source_url: string } | undefined> {
  const result = await client.execute({ sql: fundQuarterFilingSql, args: [fundCik, quarter] });
  return (result.rows[0] as unknown as { filed_date: string; source_url: string }) ?? undefined;
}

const tweetedAtSql = `SELECT tweeted_at FROM tweeted_signals WHERE ticker = ?`;

/** Cooldown check for the Twitter bot — avoids re-posting about the same ticker while a cluster persists across ingest cycles. */
export async function wasRecentlyTweeted(ticker: string, cooldownMs: number): Promise<boolean> {
  const result = await client.execute({ sql: tweetedAtSql, args: [ticker] });
  const row = result.rows[0] as unknown as { tweeted_at: number } | undefined;
  return row != null && Date.now() - row.tweeted_at < cooldownMs;
}

const recordTweetSql = `INSERT INTO tweeted_signals (ticker, lead_count, tweeted_at) VALUES (?, ?, ?)
   ON CONFLICT(ticker) DO UPDATE SET lead_count = excluded.lead_count, tweeted_at = excluded.tweeted_at`;

export async function recordTweet(ticker: string, leadCount: number): Promise<void> {
  await client.execute({ sql: recordTweetSql, args: [ticker, leadCount, Date.now()] });
}

const upsertInsiderPositionSql = `INSERT INTO insider_positions (ticker, filer_id, filer_name, filer_role, shares, as_of_date, source_type, source_url, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(ticker, filer_id) DO UPDATE SET
     filer_name = excluded.filer_name,
     filer_role = excluded.filer_role,
     shares = excluded.shares,
     as_of_date = excluded.as_of_date,
     source_type = excluded.source_type,
     source_url = excluded.source_url,
     updated_at = excluded.updated_at
   WHERE excluded.as_of_date >= insider_positions.as_of_date`;

/** Only overwrites if the new snapshot is at least as recent as what's on record — so out-of-order backfill/real-time processing can never regress a position to a stale value. */
export async function upsertInsiderPosition(entry: {
  ticker: string;
  filerId: string;
  filerName: string;
  filerRole?: string;
  shares: number | null;
  asOfDate: string;
  sourceType: "FORM3" | "FORM4" | "FORM5";
  sourceUrl: string;
}): Promise<void> {
  await client.execute({
    sql: upsertInsiderPositionSql,
    args: [
      entry.ticker,
      entry.filerId,
      entry.filerName,
      entry.filerRole ?? null,
      entry.shares,
      entry.asOfDate,
      entry.sourceType,
      entry.sourceUrl,
      Date.now(),
    ],
  });
}

export type InsiderPositionRow = {
  filer_id: string;
  filer_name: string;
  filer_role: string | null;
  shares: number | null;
  as_of_date: string;
  source_type: string;
  source_url: string;
};

const insiderPositionsSql = `SELECT filer_id, filer_name, filer_role, shares, as_of_date, source_type, source_url
   FROM insider_positions WHERE ticker = ? ORDER BY shares DESC LIMIT ? OFFSET ?`;

export async function getInsiderPositions(
  ticker: string,
  limit: number,
  offset: number
): Promise<InsiderPositionRow[]> {
  const result = await client.execute({ sql: insiderPositionsSql, args: [ticker, limit, offset] });
  return result.rows as unknown as InsiderPositionRow[];
}

const insiderPositionsCountSql = `SELECT COUNT(*) as c FROM insider_positions WHERE ticker = ?`;

export async function getInsiderPositionsCount(ticker: string): Promise<number> {
  const result = await client.execute({ sql: insiderPositionsCountSql, args: [ticker] });
  return Number((result.rows[0] as unknown as { c: number }).c);
}

const resumeBackfillTickerSql = `SELECT ticker FROM insider_backfill_status WHERE status = 'in_progress' LIMIT 1`;

const freshBackfillTickerSql = `SELECT t.ticker FROM (SELECT DISTINCT ticker FROM transactions) t
   LEFT JOIN insider_backfill_status b ON b.ticker = t.ticker
   WHERE b.ticker IS NULL LIMIT 1`;

/** A ticker to work on this cycle — resumes an already-started (but not yet fully processed)
 * ticker before picking a fresh one, so a large company's backfill finishes across several
 * cycles instead of a new ticker cutting in line every time. */
export async function getNextBackfillTicker(): Promise<string | null> {
  const resuming = await client.execute(resumeBackfillTickerSql);
  const resumingRow = resuming.rows[0] as unknown as { ticker: string } | undefined;
  if (resumingRow) return resumingRow.ticker;

  const fresh = await client.execute(freshBackfillTickerSql);
  const freshRow = fresh.rows[0] as unknown as { ticker: string } | undefined;
  return freshRow?.ticker ?? null;
}

const backfillProgressSql = `SELECT processed_count FROM insider_backfill_status WHERE ticker = ?`;

/** How many of the ticker's historical filings have already been processed across prior cycles — 0 if this is its first cycle. */
export async function getBackfillProgress(ticker: string): Promise<number> {
  const result = await client.execute({ sql: backfillProgressSql, args: [ticker] });
  const row = result.rows[0] as unknown as { processed_count: number } | undefined;
  return row ? Number(row.processed_count) : 0;
}

const updateBackfillProgressSql = `INSERT INTO insider_backfill_status (ticker, status, processed_count) VALUES (?, 'in_progress', ?)
   ON CONFLICT(ticker) DO UPDATE SET status = 'in_progress', processed_count = excluded.processed_count`;

/** Records partial progress on a ticker whose historical backfill spans multiple cycles (batched to stay under the external scheduler's 30s request timeout). */
export async function updateBackfillProgress(ticker: string, processedCount: number): Promise<void> {
  await client.execute({ sql: updateBackfillProgressSql, args: [ticker, processedCount] });
}

const markBackfillSql = `INSERT INTO insider_backfill_status (ticker, status, completed_at) VALUES (?, 'done', ?)
   ON CONFLICT(ticker) DO UPDATE SET status = 'done', completed_at = excluded.completed_at`;

export async function markBackfillDone(ticker: string): Promise<void> {
  await client.execute({ sql: markBackfillSql, args: [ticker, Date.now()] });
}

const backfillDoneSql = `SELECT 1 FROM insider_backfill_status WHERE ticker = ? AND status = 'done'`;

export async function isBackfillComplete(ticker: string): Promise<boolean> {
  const result = await client.execute({ sql: backfillDoneSql, args: [ticker] });
  return result.rows.length > 0;
}

const totalInsiderPositionsSql = `SELECT COUNT(*) as c FROM insider_positions`;

/** Size of the whole insider roster across every tracked company — unlike the time-windowed "Beobachtete Insider" KPI, this isn't filtered by recent trading activity. */
export async function getTotalInsiderPositionsCount(): Promise<number> {
  const result = await client.execute(totalInsiderPositionsSql);
  return Number((result.rows[0] as unknown as { c: number }).c);
}
