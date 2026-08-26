import "server-only";
import { INSTITUTIONAL_FILERS, type InstitutionalFiler } from "@/lib/institutionalFilers";
import { fetchLatest13F, fetchPreviousQuarter13F, type Form13F } from "@/lib/secEdgar";
import { resolveCusipsToTickers } from "@/lib/openfigi";
import {
  getFundHoldings,
  getFundLatestQuarters,
  getFundQuarterFiling,
  getFundRecentQuarters,
  getFundTotalsForQuarters,
  getHoldingsForQuarters,
  getInstitutionalActivity,
  getRecentGlobalQuarters,
  upsertInstitutionalHolding,
  type InstitutionalHoldingRow,
} from "@/lib/db";
import type {
  FundOverview,
  InstitutionalConsensusSignal,
  InstitutionalEvent,
  InstitutionalMove,
} from "@/types/filing";

const UPSERT_CONCURRENCY = 10; // Turso rejected an unbounded Promise.all for a large fund
// ("Database connections limit exceeded, try to reduce concurrency") — real incident, took down
// an unrelated prod build (the "/institutional" static page also queries the DB, so it failed to
// prerender while a huge batch of concurrent upserts was in flight). Same worker-pool pattern as
// secEdgar.ts's fetchTransactionsForAccessions(), just bounding DB writes instead of HTTP fetches.

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

const CONSENSUS_WINDOW_QUARTERS = 4; // ~1 year rolling window
const MIN_ACTIVE_FUNDS = 2; // below this a "cluster" is just one fund's own decision, not a consensus

type FundTickerTrend = { fundCik: string; fundName: string; start: number; end: number; startWeight: number; endWeight: number };

/**
 * Cross-fund "smart money consensus" score per ticker, rolled up over however many of the last 4
 * global calendar quarters each fund actually has on record (2-4 — the rolling window grows as
 * more history gets backfilled; see the 2026-08-11 backfill work). Structurally mirrors
 * consensus.ts's summarizeTickers() — same "3-component average × side-multiplier" shape — but
 * built from institutional position changes instead of Form-4 insider trades. Deliberately kept
 * separate from the insider signal for now (a combined cross-signal is a possible follow-up).
 *
 * For each fund that has ≥2 of the window's quarters on record for a given ticker, compares its
 * EARLIEST vs LATEST recorded value within the window (not consecutive-quarter deltas — a fund
 * that only has 2 of the 4 quarters, e.g. one just added to the tracked list, still contributes a
 * meaningful start→end comparison over whatever span it actually has).
 */
export async function computeInstitutionalConsensus(limit = 20): Promise<InstitutionalConsensusSignal[]> {
  const quarters = await getRecentGlobalQuarters(CONSENSUS_WINDOW_QUARTERS);
  if (quarters.length < 2) return []; // no rolling comparison possible yet

  const [holdings, fundTotals, fundLatestQuarters] = await Promise.all([
    getHoldingsForQuarters(quarters),
    getFundTotalsForQuarters(quarters),
    getFundLatestQuarters(),
  ]);

  // ticker -> fund_cik -> quarter -> value_usd
  const byTicker = new Map<string, Map<string, Map<string, number>>>();
  const companyNameByTicker = new Map<string, string>();
  const fundNameByCik = new Map<string, string>();

  for (const h of holdings) {
    fundNameByCik.set(h.fund_cik, h.fund_name);
    companyNameByTicker.set(h.ticker, h.issuer_name);
    let byFund = byTicker.get(h.ticker);
    if (!byFund) {
      byFund = new Map();
      byTicker.set(h.ticker, byFund);
    }
    let byQuarter = byFund.get(h.fund_cik);
    if (!byQuarter) {
      byQuarter = new Map();
      byFund.set(h.fund_cik, byQuarter);
    }
    byQuarter.set(h.quarter, (byQuarter.get(h.quarter) ?? 0) + (h.value_usd ?? 0));
  }

  const sortedQuarters = [...quarters].sort(); // "YYYY-QN" sorts chronologically ascending as a string
  const signals: InstitutionalConsensusSignal[] = [];

  for (const [ticker, byFund] of byTicker) {
    const signal = consensusFromFundTrends(
      ticker,
      companyNameByTicker.get(ticker) ?? ticker,
      byFund,
      sortedQuarters,
      fundTotals,
      fundNameByCik,
      fundLatestQuarters
    );
    if (signal) signals.push(signal);
  }

  signals.sort((a, b) => Math.abs(b.consensusScore) - Math.abs(a.consensusScore) || Math.abs(b.netValueChangeUsd) - Math.abs(a.netValueChangeUsd));
  return signals.slice(0, limit);
}

/**
 * The consensus score for a single ticker, given that ticker's per-fund quarterly values. Split
 * out of computeInstitutionalConsensus() so the company page can get the score for ONE ticker
 * (via getInstitutionalConsensusForTicker below) without pulling every fund's entire holdings
 * across four quarters — and, more importantly, so both paths share one definition of the score.
 * A visitor arriving from /institutional must see the same number on the company page they just
 * clicked; two copies of this formula would eventually disagree.
 *
 * `byFund` maps fund CIK -> quarter -> position value. Returns null when fewer than
 * MIN_ACTIVE_FUNDS funds have a measurable trend — one fund moving alone is a decision, not a
 * consensus.
 *
 * `fundLatestQuarters` (fund CIK -> most recent quarter that fund has ANY 13F on record for, any
 * ticker) is what makes a full exit visible. `institutional_holdings` only ever has a row for a
 * quarter a fund actually held the position — a fund that sells out entirely leaves no row at all
 * for the next quarter, not a row with value 0. Without this, such a fund has a single data point
 * in the window, fails the "≥2 quarters" check below, and drops out of the trend calculation
 * completely — the single strongest possible sell signal (going to zero) would count for nothing.
 */
function consensusFromFundTrends(
  ticker: string,
  companyName: string,
  byFund: Map<string, Map<string, number>>,
  sortedQuarters: string[],
  fundTotals: Map<string, number>,
  fundNameByCik: Map<string, string>,
  fundLatestQuarters: Map<string, string>
): InstitutionalConsensusSignal | null {
  const trends: FundTickerTrend[] = [];

  for (const [fundCik, byQuarter] of byFund) {
    const quartersPresent = sortedQuarters.filter((q) => byQuarter.has(q));
    if (quartersPresent.length === 0) continue; // no data point in the window at all

    const lastPresentQuarter = quartersPresent[quartersPresent.length - 1];
    // Detected the same way getInstitutionalTimelineEvents()'s CLOSED events are: the fund has
    // since filed a 13F (for other tickers) more recent than the last one where this ticker still
    // showed up — string comparison works, "YYYY-QN" sorts chronologically.
    const fundLatestQuarter = fundLatestQuarters.get(fundCik);
    const isClosed = fundLatestQuarter !== undefined && fundLatestQuarter > lastPresentQuarter;

    if (quartersPresent.length < 2 && !isClosed) continue; // one data point, no known close either

    const firstQ = quartersPresent[0];
    const start = byQuarter.get(firstQ)!;
    // A closed position ends at 0 regardless of whether a later window quarter has a row for it —
    // there is no later row, that IS the close.
    const end = isClosed ? 0 : byQuarter.get(lastPresentQuarter)!;
    if (start === end) continue; // unchanged — not part of a "move"

    const startTotal = fundTotals.get(`${fundCik}:${firstQ}`) ?? 0;
    const endTotal = isClosed ? 0 : (fundTotals.get(`${fundCik}:${lastPresentQuarter}`) ?? 0);
    trends.push({
      fundCik,
      fundName: fundNameByCik.get(fundCik) ?? fundCik,
      start,
      end,
      startWeight: startTotal > 0 ? start / startTotal : 0,
      endWeight: endTotal > 0 ? end / endTotal : 0,
    });
  }

  if (trends.length < MIN_ACTIVE_FUNDS) return null;

  const accumulating = trends.filter((t) => t.end > t.start);
  const distributing = trends.filter((t) => t.end < t.start);
  const leadSide: "ACCUMULATING" | "DISTRIBUTING" = accumulating.length >= distributing.length ? "ACCUMULATING" : "DISTRIBUTING";
  const leading = leadSide === "ACCUMULATING" ? accumulating : distributing;

  const headcountRatio = leading.length / trends.length;

  const totalAbsChange = trends.reduce((sum, t) => sum + Math.abs(t.end - t.start), 0);
  const leadingAbsChange = leading.reduce((sum, t) => sum + Math.abs(t.end - t.start), 0);
  const dollarWeightedRatio = totalAbsChange > 0 ? leadingAbsChange / totalAbsChange : 0;

  // How much of the fund's OWN portfolio conviction shifted into (or out of) this position,
  // not just headline dollars — a $50M add is trivial for a $600B portfolio but everything for
  // a $2B one. Mirrors pctOfPriorHoldings()'s "ratio of a reference base" shape: bounded (0,1),
  // a brand-new position (startWeight 0) scores the max 1, a fully-closed one (endWeight 0)
  // scores the min 0 — consistent with "how much of the after-state is the new side."
  const convictionRatios = leading.map((t) => (t.endWeight + t.startWeight > 0 ? t.endWeight / (t.endWeight + t.startWeight) : 0));
  const avgConvictionRatio = convictionRatios.reduce((sum, r) => sum + r, 0) / convictionRatios.length;

  const rawScore = 100 * ((headcountRatio + dollarWeightedRatio + avgConvictionRatio) / 3);
  const sideMultiplier = leadSide === "ACCUMULATING" ? 1.15 : 0.85;
  const magnitude = Math.round(Math.min(100, Math.max(0, rawScore * sideMultiplier)));
  // Same signed convention as the insider Signal Score — distribution-led reads negative.
  const consensusScore = leadSide === "DISTRIBUTING" ? -magnitude : magnitude;

  const netValueChangeUsd = trends.reduce((sum, t) => sum + (t.end - t.start), 0);
  const quartersUsed = Math.max(...trends.map((t) => sortedQuarters.filter((q) => byFund.get(t.fundCik)?.has(q)).length));

  return {
    ticker,
    companyName,
    fundsAccumulating: accumulating.length,
    fundsDistributing: distributing.length,
    leadSide,
    headcountRatio,
    dollarWeightedRatio,
    avgConvictionRatio,
    sideMultiplier,
    consensusScore,
    netValueChangeUsd,
    quartersUsed,
  };
}

/**
 * The Smart-Money-Konsens score for one ticker — the same number the /institutional page ranks by,
 * so a company page reached from that list can show what the visitor just clicked on instead of
 * dropping the fund context entirely. Reads only this ticker's holdings plus the per-fund
 * portfolio totals, rather than every fund's full book like computeInstitutionalConsensus() does.
 *
 * null means "no cross-fund consensus", not "no fund activity": a single fund moving, or funds
 * with only one quarter on record, produce timeline events (getInstitutionalTimelineEvents) but no
 * score. The company page shows the per-fund detail either way.
 */
export async function getInstitutionalConsensusForTicker(
  ticker: string
): Promise<InstitutionalConsensusSignal | null> {
  const quarters = await getRecentGlobalQuarters(CONSENSUS_WINDOW_QUARTERS);
  if (quarters.length < 2) return null; // no rolling comparison possible yet

  const [rows, fundTotals, fundLatestQuarters] = await Promise.all([
    getInstitutionalActivity(ticker),
    getFundTotalsForQuarters(quarters),
    getFundLatestQuarters(),
  ]);

  const inWindow = new Set(quarters);
  const byFund = new Map<string, Map<string, number>>();
  const fundNameByCik = new Map<string, string>();
  let companyName = ticker;

  for (const row of rows) {
    if (!inWindow.has(row.quarter)) continue;
    fundNameByCik.set(row.fund_cik, row.fund_name);
    if (row.issuer_name) companyName = row.issuer_name;

    let byQuarter = byFund.get(row.fund_cik);
    if (!byQuarter) {
      byQuarter = new Map();
      byFund.set(row.fund_cik, byQuarter);
    }
    // Summed, not overwritten — a fund can report the same ticker on several lines in one filing
    // (different share classes resolving to one ticker). Mirrors computeInstitutionalConsensus().
    byQuarter.set(row.quarter, (byQuarter.get(row.quarter) ?? 0) + (row.value_usd ?? 0));
  }

  return consensusFromFundTrends(
    ticker,
    companyName,
    byFund,
    [...quarters].sort(),
    fundTotals,
    fundNameByCik,
    fundLatestQuarters
  );
}
