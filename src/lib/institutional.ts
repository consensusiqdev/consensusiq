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
 * One-time (per fund) backfill: fetches the quarter BEFORE each fund's latest 13F-HR, so
 * "biggest position changes" (getBiggestInstitutionalMoves()) has a baseline to diff against from
 * day one, instead of waiting ~3 months for organic quarterly ingestion to accumulate a second
 * quarter on its own. Skips any fund that already has 2+ distinct quarters on record — safe to
 * call repeatedly (e.g. if a run times out partway through), and becomes a permanent no-op once
 * every fund has cleared the one-time gap. Not wired into the daily cron schedule (see
 * /api/cron/institutional-backfill) — meant to be triggered manually, once.
 */
export async function backfillPreviousQuarterHoldings(): Promise<{ fundsProcessed: number; holdingsWritten: number }> {
  const recentQuarters = await getFundRecentQuarters();
  let fundsProcessed = 0;
  let holdingsWritten = 0;

  for (const fund of INSTITUTIONAL_FILERS) {
    const [, previousOnRecord] = recentQuarters.get(fund.cik) ?? [undefined, undefined];
    if (previousOnRecord) continue; // already has a diffable baseline

    try {
      const filing = await fetchPreviousQuarter13F(fund.cik);
      if (!filing) continue;
      fundsProcessed++;
      holdingsWritten += await ingestFiling(fund, filing);
    } catch (err) {
      console.warn(`[institutional-backfill] ${fund.name} (CIK ${fund.cik}) fehlgeschlagen:`, err);
    }
  }

  return { fundsProcessed, holdingsWritten };
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
