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

/** Resolves one 13F filing's CUSIPs to tickers and upserts every holding line — shared by the
 * regular latest-quarter ingest and the one-time previous-quarter backfill below. */
async function ingestFiling(fund: InstitutionalFiler, filing: Form13F): Promise<number> {
  const tickerByCusip = await resolveCusipsToTickers(filing.holdings.map((h) => h.cusip));

  await Promise.all(
    filing.holdings.map((holding) =>
      upsertInstitutionalHolding({
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
      })
    )
  );

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
 * Fetches BOTH the latest and previous-quarter 13F, not just the previous one: for the normal case
 * (a fund whose latest quarter already made it into the DB via the regular daily ingest) the latest
 * fetch is a harmless redundant no-op upsert. But a fund whose latest quarter never actually made it
 * in — e.g. Bridgewater, whose info-table XML used a namespace-prefix dialect the parser silently
 * turned into zero holdings before that bug was fixed — would otherwise loop forever: only ever
 * fetching the previous quarter can never grow its DB record past 1 distinct quarter, so the
 * "needs backfill" check above would keep re-selecting it every single call with no progress.
 */
export async function backfillPreviousQuarterHoldings(): Promise<{ fund: string | null; holdingsWritten: number }> {
  const recentQuarters = await getFundRecentQuarters();

  const fund = INSTITUTIONAL_FILERS.find((f) => {
    const [, previousOnRecord] = recentQuarters.get(f.cik) ?? [undefined, undefined];
    return !previousOnRecord;
  });
  if (!fund) return { fund: null, holdingsWritten: 0 }; // every fund already has a diffable baseline

  try {
    let holdingsWritten = 0;
    const latest = await fetchLatest13F(fund.cik);
    if (latest) holdingsWritten += await ingestFiling(fund, latest);
    const previous = await fetchPreviousQuarter13F(fund.cik);
    if (previous) holdingsWritten += await ingestFiling(fund, previous);
    return { fund: fund.name, holdingsWritten };
  } catch (err) {
    console.warn(`[institutional-backfill] ${fund.name} (CIK ${fund.cik}) fehlgeschlagen:`, err);
    return { fund: fund.name, holdingsWritten: 0 };
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
