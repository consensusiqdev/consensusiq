import "server-only";
import { getFilerTransactionHistory } from "@/lib/db";
import type { FilerType, Transaction, TransactionSide } from "@/types/filing";

// A jump in reported holdings that doesn't match the recorded trade size is flagged as an
// "anomaly" rather than silently trusted — the most common real-world cause is an untracked
// corporate action (stock split, reverse split) that Form 4 doesn't reliably mark with its own
// transaction code. We deliberately do NOT try to back these out/adjust the numbers (that would
// need a real split-history data source, which this app doesn't have — see project notes); we
// just mark the point so it isn't misread as a huge, real trade.
const ANOMALY_ABS_TOLERANCE = 10; // shares — ignores tiny rounding noise
const ANOMALY_REL_TOLERANCE = 0.05; // 5% of the prior known holding

export type SharesHistoryPoint = {
  date: string; // transactionDate
  shares: number; // sharesOwnedAfter at this point
  side: TransactionSide;
  anomaly: boolean;
};

export type InsiderDetail = {
  filerId: string;
  filerName: string;
  filerType: FilerType;
  filerRole?: string;
  ticker: string;
  companyName: string;
  currentShares: number | null;
  transactions: Transaction[]; // newest first
  sharesHistory: SharesHistoryPoint[]; // oldest first, for the chart
};

/** Full detail for one insider at one company — transaction history, current holdings, and a
 * shares-over-time series with untracked-jump ("possible split") points flagged. */
export async function getInsiderDetail(ticker: string, filerId: string): Promise<InsiderDetail | null> {
  const rows = await getFilerTransactionHistory(ticker, filerId);
  if (rows.length === 0) return null;

  const transactionsAsc: Transaction[] = rows.map((r, i) => ({
    id: `${ticker}:${filerId}:${r.transaction_date}:${i}`,
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
    isPlanTrade: r.is_plan_trade === 1,
  }));

  const sharesHistory: SharesHistoryPoint[] = [];
  let prevShares: number | null = null;
  for (const t of transactionsAsc) {
    if (t.sharesOwnedAfter == null) continue;

    let anomaly = false;
    if (prevShares != null && t.shares != null) {
      const expected = t.side === "BUY" ? prevShares + t.shares : prevShares - t.shares;
      const diff = Math.abs(t.sharesOwnedAfter - expected);
      anomaly = diff > ANOMALY_ABS_TOLERANCE && diff > prevShares * ANOMALY_REL_TOLERANCE;
    }

    sharesHistory.push({ date: t.transactionDate, shares: t.sharesOwnedAfter, side: t.side, anomaly });
    prevShares = t.sharesOwnedAfter;
  }

  const last = transactionsAsc[transactionsAsc.length - 1];

  return {
    filerId,
    filerName: last.filerName,
    filerType: last.filerType,
    filerRole: last.filerRole,
    ticker,
    companyName: last.companyName,
    currentShares: sharesHistory.length > 0 ? sharesHistory[sharesHistory.length - 1].shares : null,
    transactions: [...transactionsAsc].sort((a, b) => (a.transactionDate < b.transactionDate ? 1 : -1)),
    sharesHistory,
  };
}
