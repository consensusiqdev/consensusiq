export type FilerType = "insider" | "congress"; // "congress" unused in v1, kept for forward-compat

export type Filer = {
  id: string; // insider: zero-padded SEC CIK
  type: FilerType;
  name: string;
  role?: string; // "Director" | "Officer" | "10% Owner" | "Other"
};

export type TransactionSide = "BUY" | "SELL";

/**
 * Raw SEC Form 4 transaction code. Only P/S ever feed the main consensus/signal-score computation
 * (see the `openMarketOnly` filter applied in the API routes) — the others exist purely to power
 * the "where did these shares come from" premium origin lookup (src/lib/premium.ts), never to be
 * counted as a voluntary trading decision.
 *   P = open-market/private purchase   S = open-market/private sale   A = grant/award (equity comp)
 *   M = option/derivative exercise     F = shares withheld for vesting tax   G = gift
 */
export type TransactionCode = "P" | "S" | "A" | "M" | "F" | "G";

/**
 * Premium enrichment for a SELL: the most recent share-acquiring event we have on record for that
 * same filer+ticker before the sale — an open-market buy, a grant, an option exercise, etc. (see
 * `TransactionCode`). Only ever populated from our own tracked history (ingestion started
 * 2026-08-06), so this is frequently unavailable for older holdings or before we started tracking.
 * `null` = looked up, genuinely nothing found. `undefined` (omitted from the API response
 * entirely) = not computed because the viewer isn't an active subscriber.
 */
export type PriorAcquisition = {
  date: string;
  pricePerShare: number | null;
  shares: number | null;
  code: TransactionCode;
};

export type Transaction = {
  id: string; // dedup key: "{accessionNumber}:{lineIndex}"
  filerId: string;
  filerType: FilerType;
  filerName: string;
  filerRole?: string;
  ticker: string;
  companyName: string;
  side: TransactionSide;
  transactionCode: TransactionCode;
  shares: number | null;
  pricePerShare: number | null;
  valueUsd: number | null;
  sharesOwnedAfter: number | null;
  transactionDate: string; // ISO date the trade executed
  filedDate: string; // ISO date the disclosure was filed
  sourceUrl: string;
  accessionNumber: string;
  priorAcquisition?: PriorAcquisition | null;
  // True if the issuer filed a 424B4 (offering prospectus) shortly before this trade — a strong
  // sign it's a coordinated IPO-directed share purchase, not an independent conviction buy.
  // Excluded from the main consensus/signal-score computation for that reason (see /api/signals),
  // but still shown in the full per-ticker trade history for transparency.
  nearOffering: boolean;
  // True if the reporting owner checked the Rule 10b5-1(c) trading-plan box on this Form 4 (SEC's
  // own `aff10b5One` XML field, mandatory since the 2023 insider-trading-arrangements rule) — the
  // trade was executed automatically on a pre-set schedule, not a spontaneous decision. Same
  // "exclude from signal score, still shown for transparency" treatment as `nearOffering`.
  isPlanTrade: boolean;
  // Whether the reporting owner's free-text officerTitle matches a "top of the org chart" role
  // (CEO/CFO/COO/President/Chairman) — see isCSuiteTitle() in secEdgar.ts for the heuristic.
  // Unlike nearOffering/isPlanTrade, this is NOT always excluded — it powers an opt-in "Nur
  // C-Suite" filter (see FilterBar.tsx) that narrows the signal computation on request.
  isCSuite: boolean;
};

export type SideFiler = {
  filerId: string;
  filerType: FilerType;
  filerName: string;
  filerRole?: string;
  valueUsd: number;
  shares: number | null;
  sharesOwnedAfter: number | null;
  transactionDate: string;
  filedDate: string;
  sourceUrl: string;
  priorAcquisition?: PriorAcquisition | null;
};

export type TickerSide = {
  side: TransactionSide;
  filers: SideFiler[];
  totalValue: number;
};

export type FilerSummary = {
  id: string;
  type: FilerType;
  name: string;
  role?: string;
  totalValueUsd: number;
  transactionCount: number;
};

/**
 * A non-trade company event surfaced in the ticker timeline, sourced from the issuer's own SEC
 * filing history (not the insider Form 4 feed) — currently just the two structured, reliably
 * identifiable milestones around the annual shareholder meeting.
 */
export type CompanyEvent = {
  type: "AGM_ANNOUNCED" | "AGM_RESULTS" | "EXEC_CHANGE" | "INSIDER_JOINED" | "ACTIVIST_STAKE" | "IPO_OR_OFFERING";
  filedDate: string;
  sourceUrl: string;
  // AGM_ANNOUNCED only: true if no AGM_RESULTS (8-K Item 5.07) has been filed since this
  // announcement — i.e. the meeting is presumed still pending. Inferred from filing presence,
  // not the actual meeting date: SEC exposes no structured "meeting date" field, and the real
  // date only lives in the DEF 14A's free text (unreliable to parse — see secEdgar.ts).
  upcoming?: boolean;
};

/**
 * A tracked "smart money" fund's quarter-over-quarter position change in a ticker, from SEC Form
 * 13F. CLOSED means the fund held it in an earlier quarter but has since filed a 13F with no row
 * for it (13F only lists current holdings, so a full exit is inferred from absence, not a 0).
 */
export type InstitutionalEvent = {
  fundName: string;
  changeType: "OPENED" | "INCREASED" | "DECREASED" | "CLOSED";
  shares: number;
  valueUsd: number;
  changePct: number | null; // null for OPENED/CLOSED (no meaningful ratio)
  quarter: string;
  filedDate: string;
  sourceUrl: string;
};

/**
 * One fund's quarter-over-quarter change in a single position, for the /institutional page's
 * "biggest moves across all funds" ranking — same underlying diff as InstitutionalEvent, but not
 * scoped to a single ticker's timeline.
 */
export type InstitutionalMove = {
  fundName: string;
  ticker: string | null;
  issuerName: string;
  changeType: "OPENED" | "INCREASED" | "DECREASED" | "CLOSED";
  valueUsd: number; // current value (0 for CLOSED)
  previousValueUsd: number; // 0 for OPENED
  changeUsd: number; // signed: valueUsd - previousValueUsd
  changePct: number | null; // null when previousValueUsd is 0 (OPENED — no ratio makes sense)
  quarter: string;
  filedDate: string;
  sourceUrl: string;
};

/**
 * Cross-fund "smart money consensus" for one ticker, rolled up over however many of the last 4
 * calendar quarters we have on record (2-4 — grows as more history gets backfilled). Mirrors
 * consensus.ts's TickerSignal structurally (same N-component-average × side-multiplier shape,
 * currently 3 components here vs. 4 on the insider score — 13F data has no per-fund transaction
 * timestamp to derive a cluster-tightness component from) but built from 13F position changes
 * across the 20 tracked funds instead of Form-4 insider trades.
 * Deliberately kept separate from TickerSignal/insider data for now — see project notes.
 */
export type InstitutionalConsensusSignal = {
  ticker: string;
  companyName: string;
  fundsAccumulating: number;
  fundsDistributing: number;
  leadSide: "ACCUMULATING" | "DISTRIBUTING";
  headcountRatio: number; // leading side's fund count / all funds active in this ticker
  dollarWeightedRatio: number; // leading side's |Δ$| / total |Δ$| moved by all active funds
  avgConvictionRatio: number; // avg, across the leading side's funds, of end-weight/(end+start-weight) — how much of their own portfolio they shifted, not just headline dollars
  sideMultiplier: number; // 1.15 accumulation-led, 0.85 distribution-led — same asymmetry as the insider score
  consensusScore: number; // 0-100
  netValueChangeUsd: number; // signed, summed across all active funds
  quartersUsed: number; // how many of the last 4 global quarters actually had data for this ticker
};

export type FundHolding = {
  ticker: string | null;
  issuerName: string;
  shares: number | null;
  valueUsd: number | null;
};

/** One tracked "smart money" fund's latest 13F snapshot — every reported holding, sorted by value
 * descending, for the /institutional overview page (which shows a default-visible slice with a
 * "show more" expand, see FundHoldingsList.tsx). */
export type FundOverview = {
  fundCik: string;
  fundName: string;
  quarter: string;
  filedDate: string;
  sourceUrl: string;
  totalValueUsd: number;
  positionCount: number;
  holdings: FundHolding[];
} | null; // null when we don't have any 13F on record yet for this fund

export type TickerSignal = {
  ticker: string;
  companyName: string;
  industry: string | null;
  sides: TickerSide[];
  totalParticipants: number;
  leadCount: number;
  leadSide: TransactionSide;
  convictionRatio: number;
  dollarWeightedRatio: number;
  avgHoldingsPct: number;
  clusterTightnessRatio: number; // 1 = leading side traded on the ~same day, 0 = maximally spread out
  sideMultiplier: number;
  totalValueAll: number;
  observedTopN: number;
  signalScore: number;
  consensusSince: string | null;
};
