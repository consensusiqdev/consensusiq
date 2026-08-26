import type { Transaction, TickerSide, TickerSignal, TransactionSide, FilerSummary } from "@/types/filing";

/** Anything a Form 4 can report that we track — including compensation events. See TransactionCode. */
type TradeLike = Pick<Transaction, "transactionCode" | "nearOffering" | "isPlanTrade">;

/**
 * An actual open-market trade (code P or S), as opposed to a compensation event — a grant, an
 * option exercise, a tax withholding. Those change share counts but are not decisions to buy or
 * sell, so they belong in a holdings history but never in a trading signal.
 */
export function isOpenMarketTrade(t: TradeLike): boolean {
  return t.transactionCode === "P" || t.transactionCode === "S";
}

/**
 * An open-market trade that also reflects an INDEPENDENT decision — the bar the Signal Score, the
 * alerts and the digests all measure against. On top of isOpenMarketTrade() this drops:
 *
 * - `nearOffering`: buying into an IPO/follow-on is a coordinated allocation, not conviction.
 * - `isPlanTrade`: a Rule 10b5-1(c) plan trade was scheduled months earlier, so it says nothing
 *   about what the insider thinks today.
 *
 * Lives here, next to the score it feeds, because this predicate had been copy-pasted into five
 * different modules — and the one path that forgot a clause (watchlist alerts, which notified on
 * routine RSU grants as if they were conviction buys) went unnoticed precisely because there was
 * no single definition for it to visibly diverge from.
 */
export function isIndependentDecision(t: TradeLike): boolean {
  return isOpenMarketTrade(t) && !t.nearOffering && !t.isPlanTrade;
}

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

// Reference span for the cluster-tightness component below — deliberately a fixed constant, not
// the caller's selected windowDays, so tightness reads the same regardless of which
// Beobachtungszeitraum a visitor has chosen (a genuinely tight 3-day cluster shouldn't score
// differently just because someone widened the window to 90 days to see more tickers at once).
// 14 days matches the dashboard's own default windowDays as a reasonable "same-ish news cycle" scale.
const CLUSTER_TIGHTNESS_REFERENCE_DAYS = 14;

/** The four 0..1 ratios the Signal Score blends — see the /methodik page for what each one means. */
export type ScoreComponents = {
  convictionRatio: number;
  dollarWeightedRatio: number;
  avgHoldingsPct: number;
  clusterTightnessRatio: number;
};

export const SCORE_COMPONENT_KEYS = [
  "convictionRatio",
  "dollarWeightedRatio",
  "avgHoldingsPct",
  "clusterTightnessRatio",
] as const satisfies readonly (keyof ScoreComponents)[];

/**
 * Relative weight of each component plus the buy/sell asymmetry. Only DEFAULT_SCORE_WEIGHTS is
 * ever used by the app itself — the parameter exists so the offline research harness
 * (src/lib/research/, never imported by any route) can re-score the same historical signals under
 * alternative weightings and measure which components actually predict forward returns. Changing
 * the live score means changing DEFAULT_SCORE_WEIGHTS here, not passing weights from a route.
 */
export type ScoreWeights = ScoreComponents & {
  buyMultiplier: number;
  sellMultiplier: number;
};

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  convictionRatio: 1,
  dollarWeightedRatio: 1,
  avgHoldingsPct: 1,
  clusterTightnessRatio: 1,
  // Insider BUYING is historically a much stronger, more voluntary signal than SELLING (which is
  // routinely driven by diversification, taxes, or RSU vesting rather than conviction) — so a
  // BUY-led consensus is boosted and a SELL-led one discounted, on top of the same component
  // blend used for both.
  buyMultiplier: 1.15,
  sellMultiplier: 0.85,
};

export function sideMultiplierFor(side: TransactionSide, weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS): number {
  return side === "BUY" ? weights.buyMultiplier : weights.sellMultiplier;
}

/**
 * The Signal Score formula itself, isolated from how the components are derived: a weighted mean
 * of the four 0..1 ratios, scaled to 0..100, tilted by the side multiplier, then signed so the
 * number alone conveys direction — a sell-led consensus is NEGATIVE (down to -100), a buy-led one
 * positive. With DEFAULT_SCORE_WEIGHTS the weighted mean is a plain average of the four.
 */
export function scoreFromComponents(
  components: ScoreComponents,
  side: TransactionSide,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS
): number {
  const totalWeight = SCORE_COMPONENT_KEYS.reduce((sum, key) => sum + weights[key], 0);
  if (totalWeight <= 0) return 0; // an all-zero weighting has no opinion; don't divide by zero
  const weightedMean =
    SCORE_COMPONENT_KEYS.reduce((sum, key) => sum + weights[key] * components[key], 0) / totalWeight;

  const magnitude = Math.round(
    Math.min(100, Math.max(0, 100 * weightedMean * sideMultiplierFor(side, weights)))
  );
  return side === "SELL" ? -magnitude : magnitude;
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

    // How tightly clustered in time the leading side's trades are — 3 insiders buying within the
    // same 2 days reads as a much stronger, more coordinated-feeling signal than the same 3 insiders
    // spread across 90 days, which the headcount/dollar/holdings-% components alone can't
    // distinguish (they're time-blind). A single-filer "cluster" has nothing to spread, so it's
    // treated as maximally tight (1) rather than penalized for having no second data point.
    const leadTransactionTimes = leading.filers.map((f) => new Date(f.transactionDate).getTime());
    const clusterTightnessRatio =
      leadTransactionTimes.length > 1
        ? Math.max(
            0,
            Math.min(
              1,
              1 -
                (Math.max(...leadTransactionTimes) - Math.min(...leadTransactionTimes)) /
                  (CLUSTER_TIGHTNESS_REFERENCE_DAYS * 24 * 60 * 60 * 1000)
            )
          )
        : 1;

    const components: ScoreComponents = {
      convictionRatio,
      dollarWeightedRatio,
      avgHoldingsPct,
      clusterTightnessRatio,
    };
    const sideMultiplier = sideMultiplierFor(leading.side);
    const signalScore = scoreFromComponents(components, leading.side);

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
      ...components,
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
    // By strength (magnitude), not raw signed value — a -95 (extreme sell-off) is a stronger
    // signal than a +40 (mild buy), even though 40 > -95 numerically. Otherwise every buy-led
    // ticker would always rank above every sell-led one regardless of actual conviction.
    sorted.sort((a, b) => Math.abs(b.signalScore) - Math.abs(a.signalScore));
  } else {
    sorted.sort(
      (a, b) =>
        b.leadCount - a.leadCount || b.convictionRatio - a.convictionRatio || b.totalValueAll - a.totalValueAll
    );
  }
  return sorted;
}
