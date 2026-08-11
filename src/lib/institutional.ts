import "server-only";
import { INSTITUTIONAL_FILERS, type InstitutionalFiler } from "@/lib/institutionalFilers";
import { fetchLatest13F, fetchPreviousQuarter13F, type Form13F } from "@/lib/secEdgar";
import { resolveCusipsToTickers } from "@/lib/openfigi";
import {
  getFundHoldings,
  getFundLatestQuarters,
  getFundQuarterFiling,
  getFundRecentQuarters,
  getInstitutionalActivity,
  upsertInstitutionalHolding,
  type InstitutionalHoldingRow,
} from "@/lib/db";
import type { FundOverview, InstitutionalEvent, InstitutionalMove } from "@/types/filing";

const UPSERT_CONCURRENCY = 10; // Turso rejected an unbounded Promise.all for a large fund
// ("Database connections limit exceeded, try to reduce concurrency") — real incident, took down
// an unrelated prod build (the "/institutional" static page also queries the DB, so it failed to
// prerender while a huge batch of concurrent upserts was in flight). Same worker-pool pattern as
// secEdgar.ts's fetchForm4Transactions(), just bounding DB writes instead of HTTP fetches.

/** Resolves one 13F filing's CUSIPs to tickers and upserts every holding line — shared by the
 * regular latest-quarter ingest and the one-time previous-quarter backfill below. */
async function ingestFiling(fund: InstitutionalFiler, filing: Form13F): Promise<number> {
  const tickerByCusip = await resolveCusipsToTickers(filing.holdings.map((h) => h.cusip));

  let idx = 0;
  async function worker() {
    while (idx < filing.holdings.length) {
      const holding = filing.holdings[idx++];
      await upsertInstitutionalHolding({
        fundCik: fund.cik,
        fundName: fund.name,
        cusip: holding.cusip,
        ticker: tickerByCusip.get(holding.cusip) ?? null,
        issuerName: holding.issuerName,
        quarter: filing.quarter,
        shares: holding.shares,
        valueUsd: holding.valueUsd,
        filedDate: filing.filedDate,
        sourceUrl: filing.sourceUrl,
      });
    }
  }

  const workers = Array.from({ length: Math.min(UPSERT_CONCURRENCY, filing.holdings.length) }, () => worker());
  await Promise.all(workers);

  return filing.holdings.length;
}

/**
 * Pulls each curated fund's latest 13F-HR, resolves CUSIPs to tickers, and upserts one row per
 * (fund, cusip, quarter) — idempotent via the DB's UNIQUE constraint, safe to call repeatedly.
 * Not part of the 5-minute Form 4 loop — 13F is quarterly, so instrumentation.ts runs this on its
 * own, much longer interval.
 */
export async function ingestInstitutionalHoldings(): Promise<{ fundsProcessed: number; holdingsWritten: number }> {
  let fundsProcessed = 0;
  let holdingsWritten = 0;

  for (const fund of INSTITUTIONAL_FILERS) {
    try {
      const filing = await fetchLatest13F(fund.cik);
      if (!filing) continue;
      fundsProcessed++;
      holdingsWritten += await ingestFiling(fund, filing);
    } catch (err) {
      console.warn(`[institutional] ${fund.name} (CIK ${fund.cik}) fehlgeschlagen:`, err);
    }
  }

  return { fundsProcessed, holdingsWritten };
}

/**
 * One-time (per fund) backfill: ensures each fund has at least 2 distinct quarters on record so
 * "biggest position changes" (getBiggestInstitutionalMoves()) has a baseline to diff against from
 * day one, instead of waiting ~3 months for organic quarterly ingestion to accumulate a second
 * quarter on its own. Processes exactly ONE fund per call (the first one still missing a second
 * quarter) — a large fund's CUSIP resolution alone (e.g. Citadel's ~6700 positions, 300ms-throttled
 * OpenFIGI batches of 100) can approach a single serverless invocation's time budget on its own, so
 * looping all 20 funds in one call risks a platform-level timeout kill partway through, same
 * reasoning as insiderPositions.ts's batched Form-4 backfill. Safe to call repeatedly — becomes a
 * no-op once every fund has cleared the one-time gap. Not wired into the daily cron schedule (see
 * /api/cron/institutional-backfill) — meant to be triggered manually, once per fund (~20 calls).
 *
 * Fetches exactly ONE filing per call — never both latest and previous in the same invocation.
 * A fund with zero quarters on record (a brand-new addition to INSTITUTIONAL_FILERS, or one that
 * was previously blocked by a now-fixed parsing bug — e.g. Bridgewater's namespace-prefixed XML,
 * which silently produced zero holdings) gets its LATEST quarter first; a fund that already has
 * exactly one quarter (the normal case: latest already landed via the regular daily ingest) gets
 * its PREVIOUS quarter next call. Splitting these into separate calls, rather than fetching both
 * at once, matters in practice: a large fund's single-quarter CUSIP resolution alone (e.g. Point72,
 * hundreds of positions, 300ms-throttled OpenFIGI batches of 100) can already approach a serverless
 * invocation's time budget — doing two quarters' worth in one call hit FUNCTION_INVOCATION_TIMEOUT
 * in prod. A fund needing both quarters just costs 2 calls instead of 1; harmless for a one-time
 * manual backfill.
 */
export async function backfillPreviousQuarterHoldings(): Promise<{ fund: string | null; step: "latest" | "previous" | null; holdingsWritten: number }> {
  const recentQuarters = await getFundRecentQuarters();

  const fund = INSTITUTIONAL_FILERS.find((f) => {
    const [, previousOnRecord] = recentQuarters.get(f.cik) ?? [undefined, undefined];
    return !previousOnRecord;
  });
  if (!fund) return { fund: null, step: null, holdingsWritten: 0 }; // every fund already has a diffable baseline

  const hasLatest = !!recentQuarters.get(fund.cik)?.[0];
  const step: "latest" | "previous" = hasLatest ? "previous" : "latest";

  try {
    const filing = step === "latest" ? await fetchLatest13F(fund.cik) : await fetchPreviousQuarter13F(fund.cik);
    const holdingsWritten = filing ? await ingestFiling(fund, filing) : 0;
    return { fund: fund.name, step, holdingsWritten };
  } catch (err) {
    console.warn(`[institutional-backfill] ${fund.name} (CIK ${fund.cik}, ${step}) fehlgeschlagen:`, err);
    return { fund: fund.name, step, holdingsWritten: 0 };
  }
}

function buildEvent(
  fundCik: string,
  current: InstitutionalHoldingRow,
  previous: InstitutionalHoldingRow | undefined,
  closedAt: { filed_date: string; source_url: string } | undefined
): InstitutionalEvent {
  if (closedAt) {
    return {
      fundName: current.fund_name,
      changeType: "CLOSED",
      shares: 0,
      valueUsd: 0,
      changePct: null,
      quarter: current.quarter,
      filedDate: closedAt.filed_date,
      sourceUrl: closedAt.source_url,
    };
  }

  const currentShares = current.shares ?? 0;
  const prevShares = previous?.shares ?? null;
  const changeType: InstitutionalEvent["changeType"] =
    prevShares == null ? "OPENED" : currentShares >= prevShares ? "INCREASED" : "DECREASED";
  const changePct = prevShares != null && prevShares > 0 ? (currentShares - prevShares) / prevShares : null;

  return {
    fundName: current.fund_name,
    changeType,
    shares: currentShares,
    valueUsd: current.value_usd ?? 0,
    changePct,
    quarter: current.quarter,
    filedDate: current.filed_date,
    sourceUrl: current.source_url,
  };
}

/**
 * Per tracked fund, compares this ticker's two most recent quarters on record to produce one
 * timeline-ready change event. A fund with only one quarter of data → OPENED (no prior baseline
 * to compare against — genuinely could be a pre-existing long-held position we just started
 * tracking, not necessarily a brand-new buy; not distinguishable without pre-2026 data).
 */
export async function getInstitutionalTimelineEvents(ticker: string): Promise<InstitutionalEvent[]> {
  const [rows, fundLatestQuarters] = await Promise.all([
    getInstitutionalActivity(ticker), // ordered by fund_cik, quarter DESC
    getFundLatestQuarters(),
  ]);

  const byFund = new Map<string, InstitutionalHoldingRow[]>();
  for (const row of rows) {
    const list = byFund.get(row.fund_cik) ?? [];
    list.push(row);
    byFund.set(row.fund_cik, list);
  }

  const events: InstitutionalEvent[] = [];
  for (const [fundCik, fundRows] of byFund) {
    const [current, previous] = fundRows;
    if (!current) continue;

    const fundLatestOverall = fundLatestQuarters.get(fundCik);
    const wasClosed = fundLatestOverall != null && fundLatestOverall > current.quarter;
    const closedAt = wasClosed ? await getFundQuarterFiling(fundCik, fundLatestOverall!) : undefined;

    events.push(buildEvent(fundCik, current, previous, closedAt));
  }

  return events;
}

/**
 * One card per tracked fund for the /institutional overview page: every reported holding sorted
 * by value descending, total portfolio value, and position count. `null` per-fund entries mean we
 * don't have any 13F on record yet for that fund (e.g. the daily institutional cron hasn't
 * caught up to it) — the page shows a "noch keine Daten" state for those rather than omitting them.
 */
export async function getInstitutionalOverview(): Promise<FundOverview[]> {
  const fundLatestQuarters = await getFundLatestQuarters();

  return Promise.all(
    INSTITUTIONAL_FILERS.map(async (fund): Promise<FundOverview> => {
      const quarter = fundLatestQuarters.get(fund.cik);
      if (!quarter) return null;

      const [holdings, filing] = await Promise.all([
        getFundHoldings(fund.cik, quarter),
        getFundQuarterFiling(fund.cik, quarter),
      ]);
      if (!filing) return null;

      const sorted = [...holdings].sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0));
      const totalValueUsd = holdings.reduce((sum, h) => sum + (h.value_usd ?? 0), 0);

      return {
        fundCik: fund.cik,
        fundName: fund.name,
        quarter,
        filedDate: filing.filed_date,
        sourceUrl: filing.source_url,
        totalValueUsd,
        positionCount: holdings.length,
        holdings: sorted.map((h) => ({
          ticker: h.ticker,
          issuerName: h.issuer_name,
          shares: h.shares,
          valueUsd: h.value_usd,
        })),
      };
    })
  );
}

/**
 * Every tracked fund's quarter-over-quarter position changes, ranked by absolute dollar change —
 * "which companies did these funds move the most in/out of this quarter", across all funds at
 * once (as opposed to getInstitutionalTimelineEvents(), which is the same underlying diff but
 * scoped to one ticker for the company-page timeline). A fund needs at least two quarters on
 * record to produce any moves; funds we've only just started tracking contribute nothing here
 * until their second 13F comes in — same reasoning as buildEvent()'s OPENED fallback.
 */
export async function getBiggestInstitutionalMoves(limit = 15): Promise<{
  increases: InstitutionalMove[];
  decreases: InstitutionalMove[];
}> {
  const quartersByFund = await getFundRecentQuarters();

  const perFundMoves = await Promise.all(
    [...quartersByFund.entries()].map(async ([fundCik, [currentQuarter, previousQuarter]]) => {
      if (!currentQuarter || !previousQuarter) return [];

      const fund = INSTITUTIONAL_FILERS.find((f) => f.cik === fundCik);
      if (!fund) return [];

      const [currentHoldings, previousHoldings, filing] = await Promise.all([
        getFundHoldings(fundCik, currentQuarter),
        getFundHoldings(fundCik, previousQuarter),
        getFundQuarterFiling(fundCik, currentQuarter),
      ]);
      if (!filing) return [];

      // Diff by CUSIP would be more precise than by ticker (share-class quirks aside), but
      // getFundHoldings() doesn't currently return cusip — ticker is good enough here since a
      // fund holding the exact same company under two different tickers in the same quarter is
      // not a real-world case worth guarding against.
      const previousByTicker = new Map(previousHoldings.filter((h) => h.ticker).map((h) => [h.ticker!, h]));
      const seen = new Set<string>();
      const moves: InstitutionalMove[] = [];

      for (const h of currentHoldings) {
        if (!h.ticker) continue; // can't attribute an unresolved CUSIP to a company page — skip
        seen.add(h.ticker);
        const prev = previousByTicker.get(h.ticker);
        const valueUsd = h.value_usd ?? 0;
        const previousValueUsd = prev?.value_usd ?? 0;
        const changeUsd = valueUsd - previousValueUsd;
        if (changeUsd === 0) continue; // unchanged position — not a "move"
        moves.push({
          fundName: fund.name,
          ticker: h.ticker,
          issuerName: h.issuer_name,
          changeType: prev ? (changeUsd >= 0 ? "INCREASED" : "DECREASED") : "OPENED",
          valueUsd,
          previousValueUsd,
          changeUsd,
          changePct: previousValueUsd > 0 ? changeUsd / previousValueUsd : null,
          quarter: currentQuarter,
          filedDate: filing.filed_date,
          sourceUrl: filing.source_url,
        });
      }

      for (const h of previousHoldings) {
        if (!h.ticker || seen.has(h.ticker)) continue;
        const previousValueUsd = h.value_usd ?? 0;
        if (previousValueUsd === 0) continue;
        moves.push({
          fundName: fund.name,
          ticker: h.ticker,
          issuerName: h.issuer_name,
          changeType: "CLOSED",
          valueUsd: 0,
          previousValueUsd,
          changeUsd: -previousValueUsd,
          changePct: -1,
          quarter: currentQuarter,
          filedDate: filing.filed_date,
          sourceUrl: filing.source_url,
        });
      }

      return moves;
    })
  );

  const allMoves = perFundMoves.flat();
  const increases = allMoves
    .filter((m) => m.changeUsd > 0)
    .sort((a, b) => b.changeUsd - a.changeUsd)
    .slice(0, limit);
  const decreases = allMoves
    .filter((m) => m.changeUsd < 0)
    .sort((a, b) => a.changeUsd - b.changeUsd)
    .slice(0, limit);

  return { increases, decreases };
}
