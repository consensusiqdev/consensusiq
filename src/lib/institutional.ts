import "server-only";
import { INSTITUTIONAL_FILERS } from "@/lib/institutionalFilers";
import { fetchLatest13F } from "@/lib/secEdgar";
import { resolveCusipsToTickers } from "@/lib/openfigi";
import {
  getFundHoldings,
  getFundLatestQuarters,
  getFundQuarterFiling,
  getInstitutionalActivity,
  upsertInstitutionalHolding,
  type InstitutionalHoldingRow,
} from "@/lib/db";
import type { FundOverview, InstitutionalEvent } from "@/types/filing";

const TOP_HOLDINGS_PER_FUND = 10;

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
      holdingsWritten += filing.holdings.length;
    } catch (err) {
      console.warn(`[institutional] ${fund.name} (CIK ${fund.cik}) fehlgeschlagen:`, err);
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
 * One card per tracked fund for the /institutional overview page: its latest 13F snapshot's top
 * holdings by value, total portfolio value, and position count. `null` per-fund entries mean we
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
        topHoldings: sorted.slice(0, TOP_HOLDINGS_PER_FUND).map((h) => ({
          ticker: h.ticker,
          issuerName: h.issuer_name,
          shares: h.shares,
          valueUsd: h.value_usd,
        })),
      };
    })
  );
}
