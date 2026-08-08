import "server-only";
import { INSTITUTIONAL_FILERS } from "@/lib/institutionalFilers";
import { fetchLatest13F } from "@/lib/secEdgar";
import { resolveCusipsToTickers } from "@/lib/openfigi";
import {
  getFundLatestQuarters,
  getFundQuarterFiling,
  getInstitutionalActivity,
  upsertInstitutionalHolding,
  type InstitutionalHoldingRow,
} from "@/lib/db";
import type { InstitutionalEvent } from "@/types/filing";

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
