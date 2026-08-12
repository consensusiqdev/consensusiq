import type { Transaction, TickerSide, TickerSignal, TransactionSide, FilerSummary } from "@/types/filing";

/**
 * What share of a filer's PRIOR holdings a trade represents — e.g. selling 5 of 100 shares is a
 * very different signal than selling 95 of 100, even at the same headline share count. Derived
 * from `sharesOwnedAfter` (post-trade holdings, from the Form 4 filing itself) and `shares`
 * (this trade's size): for a SELL, prior = after + traded; for a BUY, prior = after − traded.
 */
export function pctOfPriorHoldings(
  side: TransactionSide,
  shares: number | null,
  sharesOwnedAfter: number | null
): number | null {
  if (shares == null || sharesOwnedAfter == null) return null;
  const prior = side === "SELL" ? sharesOwnedAfter + shares : sharesOwnedAfter - shares;
  if (prior <= 0) return null;
  return Math.min(1, shares / prior); // clamp — >100% only possible from a data inconsistency
}

type MutableTickerSide = {
  side: TransactionSide;
  filersById: Map<string, TickerSide["filers"][number]>;
  totalValue: number;
};

type MutableTicker = {
  companyName: string;
  sides: Map<TransactionSide, MutableTickerSide>;
};

export function buildTickerMap(transactions: Transaction[], minUsd: number): Map<string, MutableTicker> {
  const tickers = new Map<string, MutableTicker>();

  for (const t of transactions) {
    if ((t.valueUsd ?? 0) < minUsd) continue;

    let ticker = tickers.get(t.ticker);
    if (!ticker) {
      ticker = { companyName: t.companyName, sides: new Map() };
      tickers.set(t.ticker, ticker);
    }

    let side = ticker.sides.get(t.side);
    if (!side) {
      side = { side: t.side, filersById: new Map(), totalValue: 0 };
      ticker.sides.set(t.side, side);
    }

    // A filer can have multiple transaction lines on the same side of the same ticker within
    // the window (e.g. two separate Form 4 filings) — merge them into one entry per filer so
    // leadCount/convictionRatio count distinct people, not distinct filing lines.
    const existing = side.filersById.get(t.filerId);
    if (existing) {
      existing.valueUsd += t.valueUsd ?? 0;
      existing.shares = existing.shares !== null && t.shares !== null ? existing.shares + t.shares : null;
      if (t.transactionDate > existing.transactionDate) {
        existing.transactionDate = t.transactionDate;
        // sharesOwnedAfter is a point-in-time snapshot — keep the one from the most recent trade.
        existing.sharesOwnedAfter = t.sharesOwnedAfter;
      }
      if (t.filedDate < existing.filedDate) existing.filedDate = t.filedDate; // earliest, for consensusSince
    } else {
      side.filersById.set(t.filerId, {
        filerId: t.filerId,
        filerType: t.filerType,
        filerName: t.filerName,
        filerRole: t.filerRole,
        valueUsd: t.valueUsd ?? 0,
        shares: t.shares,
        sharesOwnedAfter: t.sharesOwnedAfter,
        transactionDate: t.transactionDate,
        filedDate: t.filedDate,
        sourceUrl: t.sourceUrl,
      });
    }
    side.totalValue += t.valueUsd ?? 0;
  }

  return tickers;
}

export function summarizeTickers(tickers: Map<string, MutableTicker>): TickerSignal[] {
  const list: TickerSignal[] = [];

  for (const [ticker, tk] of tickers.entries()) {
    const sidesArr: TickerSide[] = Array.from(tk.sides.values()).map((s) => ({
      side: s.side,
      filers: Array.from(s.filersById.values()),
      totalValue: s.totalValue,
    }));
    sidesArr.sort((a, b) => b.filers.length - a.filers.length || b.totalValue - a.totalValue);

    const uniqueFilers = new Set<string>();
    let totalValueAll = 0;
    for (const s of sidesArr) {
      totalValueAll += s.totalValue;
      for (const f of s.filers) uniqueFilers.add(f.filerId);
    }

    const leading = sidesArr[0];
    const convictionRatio = leading.filers.length / uniqueFilers.size;
    const dollarWeightedRatio = totalValueAll > 0 ? leading.totalValue / totalValueAll : 0;

    // Average, across the leading side's filers, how much of THEIR OWN prior stake they traded —
    // a much stronger conviction signal than raw dollar value (a $1M sale is trivial for a
    // billionaire CEO but everything for a smaller holder). Filers with unknown prior holdings
    // (no sharesOwnedAfter on record) are excluded from the average rather than counted as 0.
    const holdingsPcts = leading.filers
      .map((f) => pctOfPriorHoldings(leading.side, f.shares, f.sharesOwnedAfter))
      .filter((p): p is number => p !== null);
    const avgHoldingsPct =
      holdingsPcts.length > 0 ? holdingsPcts.reduce((sum, p) => sum + p, 0) / holdingsPcts.length : 0;

    // Insider BUYING is historically a much stronger, more voluntary signal than SELLING (which
    // is routinely driven by diversification, taxes, or RSU vesting rather than conviction) — so
    // a BUY-led consensus is boosted and a SELL-led one is discounted, on top of the same
    // headcount/dollar/holdings-% blend used for both.
    const rawScore = 100 * ((convictionRatio + dollarWeightedRatio + avgHoldingsPct) / 3);
    const sideMultiplier = leading.side === "BUY" ? 1.15 : 0.85;
    const signalScore = Math.round(Math.min(100, Math.max(0, rawScore * sideMultiplier)));

    // "Since" the consensus started forming: earliest filing among the leading side's filers.
    const consensusSince = leading.filers.reduce<string | null>(
      (min, f) => (min === null || f.filedDate < min ? f.filedDate : min),
      null
    );

    list.push({
      ticker,
      companyName: tk.companyName,
      industry: null, // attached server-side in the API route from ticker_metadata — consensus.ts stays db-free
      sides: sidesArr,
      totalParticipants: uniqueFilers.size,
      leadCount: leading.filers.length,
      leadSide: leading.side,
      convictionRatio,
      dollarWeightedRatio,
      avgHoldingsPct,
      sideMultiplier,
      totalValueAll,
      observedTopN: uniqueFilers.size,
      signalScore,
      consensusSince,
    });
  }

  list.sort(
    (a, b) =>
      b.leadCount - a.leadCount || b.convictionRatio - a.convictionRatio || b.totalValueAll - a.totalValueAll
  );
  return list;
}

export function computeConsensus(transactions: Transaction[], minUsd: number): TickerSignal[] {
  return summarizeTickers(buildTickerMap(transactions, minUsd));
}

// Ranks filers by total $ value transacted in the current window — the closest available
// substitute for Polymarket's PnL leaderboard, since Form 4 exposes no performance metric.
export function summarizeFilers(transactions: Transaction[]): FilerSummary[] {
  const byFiler = new Map<string, FilerSummary>();

  for (const t of transactions) {
    let f = byFiler.get(t.filerId);
    if (!f) {
      f = {
        id: t.filerId,
        type: t.filerType,
        name: t.filerName,
        role: t.filerRole,
        totalValueUsd: 0,
        transactionCount: 0,
      };
      byFiler.set(t.filerId, f);
    }
    f.totalValueUsd += t.valueUsd ?? 0;
    f.transactionCount += 1;
  }

  return [...byFiler.values()].sort((a, b) => b.totalValueUsd - a.totalValueUsd);
}

// Individual BUY transactions ranked by dollar size — independent of the `buysOnly` toggle
// (which only affects the ticker-consensus list), this surfaces standout purchases even when
// the main list is showing sell-side consensus, since buys are rarer and more attention-worthy.
export function topBuyTransactions(transactions: Transaction[], limit = 8): Transaction[] {
  return transactions
    .filter((t) => t.side === "BUY")
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
    .slice(0, limit);
}

export type SignalHistoryPoint = {
  weekStart: string; // ISO date, start of the 7-day bucket
  score: number | null; // null = no qualifying activity that week — render as a gap, not 0
  leadSide: TransactionSide | null;
};

/**
 * Weekly-bucketed signal-score trend for a single ticker, derived from its own transaction
 * history — there's no persisted score-over-time table, so this recomputes the same
 * buildTickerMap/summarizeTickers pipeline used everywhere else, once per non-overlapping 7-day
 * window. `transactions` must already be pre-filtered by the caller the same way every other
 * consensus computation is (open-market P/S only, `!nearOffering`) — this function doesn't
 * re-filter by transaction code itself, same contract as `computeConsensus`.
 */
export function computeSignalHistory(
  transactions: Transaction[],
  weeks = 12,
  minUsd = 1000
): SignalHistoryPoint[] {
  const now = Date.now();
  const points: SignalHistoryPoint[] = [];

  for (let i = weeks - 1; i >= 0; i--) {
    const windowStartIso = new Date(now - (i + 1) * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const windowEndIso = new Date(now - i * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const bucket = transactions.filter((t) => t.filedDate >= windowStartIso && t.filedDate < windowEndIso);

    const [signal] = bucket.length > 0 ? summarizeTickers(buildTickerMap(bucket, minUsd)) : [];
    points.push({
      weekStart: windowStartIso,
      score: signal?.signalScore ?? null,
      leadSide: signal?.leadSide ?? null,
    });
  }

  return points;
}

// Sentinel ticker used only within computeIndustrySignalHistory() to merge every real ticker in
// an industry into one aggregate bucket — never persisted or shown, just an implementation detail
// of reusing buildTickerMap's per-ticker grouping for a cross-ticker aggregate instead.
const INDUSTRY_AGGREGATE_TICKER = "__industry_aggregate__";

/**
 * Same weekly-bucketed trend as computeSignalHistory(), but aggregated across an entire industry
 * instead of one ticker — is insider sentiment in this industry rising or falling? Relabels every
 * transaction's `ticker` field so buildTickerMap groups the whole industry's activity into a
 * single per-week signal instead of one signal per real ticker (which computeSignalHistory would
 * otherwise arbitrarily pick just one of via its `[signal] = ...` destructure). `transactions`
 * must already be pre-filtered by the caller the same way as computeSignalHistory expects.
 */
export function computeIndustrySignalHistory(
  transactions: Transaction[],
  weeks = 12,
  minUsd = 1000
): SignalHistoryPoint[] {
  const relabeled = transactions.map((t) => ({ ...t, ticker: INDUSTRY_AGGREGATE_TICKER }));
  return computeSignalHistory(relabeled, weeks, minUsd);
}

export type SortOption = "consensus" | "exposure" | "conviction" | "score";

export function filterAndSortConsensus(
  signals: TickerSignal[],
  minAgree: number,
  sortBy: SortOption
): TickerSignal[] {
  const filtered = signals.filter((s) => s.leadCount >= minAgree);

  const sorted = [...filtered];
  if (sortBy === "exposure") {
    sorted.sort((a, b) => b.totalValueAll - a.totalValueAll);
  } else if (sortBy === "conviction") {
    sorted.sort((a, b) => b.convictionRatio - a.convictionRatio);
  } else if (sortBy === "score") {
    sorted.sort((a, b) => b.signalScore - a.signalScore);
  } else {
    sorted.sort(
      (a, b) =>
        b.leadCount - a.leadCount || b.convictionRatio - a.convictionRatio || b.totalValueAll - a.totalValueAll
    );
  }
  return sorted;
}
