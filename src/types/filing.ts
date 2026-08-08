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

export type FundHolding = {
  ticker: string | null;
  issuerName: string;
  shares: number | null;
  valueUsd: number | null;
};

/** One tracked "smart money" fund's latest 13F snapshot — top holdings by value, for the /institutional overview page. */
export type FundOverview = {
  fundCik: string;
  fundName: string;
  quarter: string;
  filedDate: string;
  sourceUrl: string;
  totalValueUsd: number;
  positionCount: number;
  topHoldings: FundHolding[];
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
  totalValueAll: number;
  observedTopN: number;
  signalScore: number;
  consensusSince: string | null;
};
