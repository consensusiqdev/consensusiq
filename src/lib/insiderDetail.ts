import "server-only";
import { getFilerTransactionHistory, getTickerHistory } from "@/lib/db";
import type { FilerType, Transaction, TransactionSide } from "@/types/filing";

// A jump in reported holdings that doesn't match the recorded trade size is flagged as an
// "anomaly" rather than silently trusted — the most common real-world cause is an untracked
// corporate action (stock split, reverse split) that Form 4 doesn't reliably mark with its own
// transaction code. We deliberately do NOT try to back these out/adjust the numbers (that would
// need a real split-history data source, which this app doesn't have — see project notes); we
// just mark the point so it isn't misread as a huge, real trade.
const ANOMALY_ABS_TOLERANCE = 10; // shares — ignores tiny rounding noise
const ANOMALY_REL_TOLERANCE = 0.05; // 5% of the prior known holding

// Same default window as the dashboard's own "Beobachtungszeitraum" — used here retrospectively
// (±N days around each of the insider's own trades) to answer "was this trade part of a broader
// cluster, or a solo move?", not as a rolling "since now" window like everywhere else.
const CLUSTER_WINDOW_DAYS = 14;
// Matches the dashboard's own default "Min. Übereinstimmung" — count of 3+ distinct filers
// (including this one) trading the same side in the window counts as a real cluster.
const MIN_CLUSTER_SIZE = 3;

export type SharesHistoryPoint = {
  date: string; // transactionDate
  shares: number; // sharesOwnedAfter at this point
  side: TransactionSide;
  anomaly: boolean;
};

/** A transaction plus how many distinct filers (including this insider) traded the SAME side
 * within ±CLUSTER_WINDOW_DAYS of it — was this insider acting alone, or alongside others? Only
 * meaningful for genuine open-market trades; non-open-market lines get clusterParticipants: 1. */
export type InsiderTransaction = Transaction & { clusterParticipants: number };

export type TrackRecord = {
  totalBuys: number;
  totalSells: number;
  buysInCluster: number;
  sellsInCluster: number;
};

export type InsiderDetail = {
  filerId: string;
  filerName: string;
  filerType: FilerType;
  filerRole?: string;
  ticker: string;
  companyName: string;
  currentShares: number | null;
  transactions: InsiderTransaction[]; // newest first
  sharesHistory: SharesHistoryPoint[]; // oldest first, for the chart
  trackRecord: TrackRecord;
};

/** Full detail for one insider at one company — transaction history, current holdings, a
 * shares-over-time series with untracked-jump ("possible split") points flagged, and a track
 * record of whether their open-market trades tend to happen solo or as part of a wider cluster of
 * other insiders trading the same side around the same time. */
export async function getInsiderDetail(ticker: string, filerId: string): Promise<InsiderDetail | null> {
  const [rows, tickerRows] = await Promise.all([getFilerTransactionHistory(ticker, filerId), getTickerHistory(ticker)]);
  if (rows.length === 0) return null;

  // Every open-market trade at this ticker, by ANY filer — used only to count cluster
  // participants around each of this insider's own trades, same exclusions as the signal score
  // itself (nearOffering/isPlanTrade trades aren't independent decisions, don't count as "activity").
  const allOpenMarket = tickerRows
    .filter((r) => (r.transaction_code === "P" || r.transaction_code === "S") && r.near_offering !== 1 && r.is_plan_trade !== 1)
    .map((r) => ({ filerId: r.filer_id, side: r.side as TransactionSide, filedDate: r.filed_date }));

  function clusterParticipantsFor(side: TransactionSide, filedDate: string): number {
    const center = new Date(filedDate).getTime();
    const windowMs = CLUSTER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const participants = new Set(
      allOpenMarket
        .filter((t) => t.side === side && Math.abs(new Date(t.filedDate).getTime() - center) <= windowMs)
        .map((t) => t.filerId)
    );
    return participants.size;
  }

  const transactionsAsc: InsiderTransaction[] = rows.map((r, i) => {
    const base: Transaction = {
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
    };
    const isOpenMarket = (base.transactionCode === "P" || base.transactionCode === "S") && !base.nearOffering && !base.isPlanTrade;
    return { ...base, clusterParticipants: isOpenMarket ? clusterParticipantsFor(base.side, base.filedDate) : 1 };
  });

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

  const ownOpenMarket = transactionsAsc.filter(
    (t) => (t.transactionCode === "P" || t.transactionCode === "S") && !t.nearOffering && !t.isPlanTrade
  );
  const trackRecord: TrackRecord = {
    totalBuys: ownOpenMarket.filter((t) => t.side === "BUY").length,
    totalSells: ownOpenMarket.filter((t) => t.side === "SELL").length,
    buysInCluster: ownOpenMarket.filter((t) => t.side === "BUY" && t.clusterParticipants >= MIN_CLUSTER_SIZE).length,
    sellsInCluster: ownOpenMarket.filter((t) => t.side === "SELL" && t.clusterParticipants >= MIN_CLUSTER_SIZE).length,
  };

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
    trackRecord,
  };
}
