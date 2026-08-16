import { XMLParser } from "fast-xml-parser";
import type { CompanyEvent, Transaction, TransactionCode } from "@/types/filing";

const SEC_BASE = "https://www.sec.gov";
const USER_AGENT = process.env.SEC_EDGAR_USER_AGENT;

if (!USER_AGENT) {
  throw new Error(
    "SEC_EDGAR_USER_AGENT ist nicht gesetzt — SEC verlangt einen identifizierenden User-Agent (App-Name + Kontakt-E-Mail) für automatisierte Zugriffe."
  );
}

// Some filing agents wrap the ticker in parentheses in the raw XML (verified live: Sirius XM's
// own Form 4s literally contain "<issuerTradingSymbol>(SIRI)</issuerTradingSymbol>") — strip it,
// or that ticker silently breaks every downstream Yahoo Finance link and ticker-keyed lookup.
function normalizeTicker(raw: string): string {
  return raw.trim().replace(/^\((.+)\)$/, "$1").trim();
}

const REQUEST_DELAY_MS = 120; // shared rate limit, comfortably under SEC's ~10 req/s fair-access ceiling
let lastRequestAt = 0;

async function throttledFetch(url: string): Promise<Response> {
  const wait = lastRequestAt + REQUEST_DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT!, Accept: "*/*" } });
  if (!res.ok) {
    throw new Error(`SEC-EDGAR-Anfrage fehlgeschlagen (${res.status}): ${url}`);
  }
  return res;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Some filers' software wraps every element in a namespace prefix (verified live: Bridgewater
  // Associates' infotable.xml uses "ns1:infoTable", "ns1:cusip", etc., unlike every other tracked
  // fund) — without stripping it, `.informationTable.infoTable` silently resolves to undefined
  // and that filer's holdings parse as an empty array with no error, no exception, nothing to
  // catch. Safe to enable unconditionally: documents with no prefix (the common case) are
  // unaffected, this only ever removes something that would otherwise break the unprefixed
  // property lookups everywhere else in this file.
  removeNSPrefix: true,
  isArray: (name) =>
    name === "entry" || name === "nonDerivativeTransaction" || name === "infoTable" || name === "nonDerivativeHolding",
});

type AtomEntry = {
  title: string;
  link: { "@_href"?: string } | string;
  updated: string;
  category: { "@_term"?: string };
  id: string;
};

export type Form4Accession = {
  accessionNumber: string;
  cik: string;
  indexUrl: string;
  filedAt: string;
};

// Shared by any real-time "getcurrent" feed poll (Form 4 already used this; Form 3 for insider
// positions reuses the exact same mechanism, verified live to work identically for type=3).
async function fetchRecentAccessions(formType: string, count: number): Promise<Form4Accession[]> {
  const url = `${SEC_BASE}/cgi-bin/browse-edgar?action=getcurrent&type=${formType}&company=&dateb=&owner=include&count=${count}&output=atom`;
  const res = await throttledFetch(url);
  const xml = await res.text();
  const parsed = xmlParser.parse(xml) as { feed?: { entry?: AtomEntry[] } };
  const entries = parsed.feed?.entry ?? [];

  const seen = new Map<string, Form4Accession>();
  for (const entry of entries) {
    const term = typeof entry.category === "object" ? entry.category?.["@_term"] : undefined;
    if (term !== formType) continue; // exclude prefix-matched noise (424B2, 497, 40-17G, ...)

    const idMatch = /accession-number=([\d-]+)/.exec(entry.id ?? "");
    const accessionNumber = idMatch?.[1];
    if (!accessionNumber || seen.has(accessionNumber)) continue;

    const href = typeof entry.link === "object" ? entry.link["@_href"] : entry.link;
    const cikMatch = /\/data\/(\d+)\//.exec(href ?? "");
    const cik = cikMatch?.[1];
    if (!cik) continue;

    seen.set(accessionNumber, {
      accessionNumber,
      cik,
      indexUrl: `${SEC_BASE}/Archives/edgar/data/${cik}/${accessionNumber.replace(/-/g, "")}/index.json`,
      filedAt: entry.updated,
    });
  }

  return [...seen.values()];
}

export async function fetchRecentForm4Accessions(count = 100): Promise<Form4Accession[]> {
  return fetchRecentAccessions("4", count);
}

export async function fetchRecentForm3Accessions(count = 100): Promise<Form4Accession[]> {
  return fetchRecentAccessions("3", count);
}

type IndexJson = { directory: { item: { name: string }[] } };

type OwnershipXml = {
  ownershipDocument?: {
    periodOfReport?: string;
    // SEC's own checkbox (mandatory since the 2023 insider-trading-arrangements rule) for whether
    // ANY transaction on this filing was made pursuant to a Rule 10b5-1(c) trading plan — a
    // document-level flag, not per-line, so it applies to every transaction on the same Form 4.
    // Verified live against real EDGAR filings: encoded inconsistently as "0"/"1" in some, "true"/
    // "false" in others — same encoding mess isFlagSet() already handles for isDirector etc.
    aff10b5One?: string | number | boolean;
    issuer?: { issuerCik?: string; issuerName?: string; issuerTradingSymbol?: string };
    reportingOwner?: {
      reportingOwnerId?: { rptOwnerCik?: string | number; rptOwnerName?: string };
      reportingOwnerRelationship?: {
        isDirector?: string | number | boolean;
        isOfficer?: string | number | boolean;
        isTenPercentOwner?: string | number | boolean;
        isOther?: string | number | boolean;
        officerTitle?: string;
      };
    };
    nonDerivativeTable?: {
      nonDerivativeTransaction?: NonDerivativeTransactionXml[];
      nonDerivativeHolding?: NonDerivativeHoldingXml[];
    };
  };
};

type NonDerivativeTransactionXml = {
  transactionDate?: { value?: string };
  transactionCoding?: { transactionCode?: string };
  transactionAmounts?: {
    transactionShares?: { value?: string };
    transactionPricePerShare?: { value?: string };
    transactionAcquiredDisposedCode?: { value?: string };
  };
  postTransactionAmounts?: { sharesOwnedFollowingTransaction?: { value?: string } };
};

// Form 3 (and sometimes Form 5) report standing holdings, not trades — no transaction/price/date,
// just a snapshot. A single reporting owner can have several of these lines (direct ownership plus
// indirect via different trusts/LPs — verified live on a real Form 3), which must be summed for
// their total position, same idea as the 13F multi-manager-slice summation.
type NonDerivativeHoldingXml = {
  postTransactionAmounts?: { sharesOwnedFollowingTransaction?: { value?: string } };
};

// SEC filing agents encode these flags inconsistently across filings: "1"/"0" (parsed by
// fast-xml-parser as numbers) in some, "true"/"false" (parsed as booleans) in others.
function isFlagSet(value?: string | number | boolean): boolean {
  return value === 1 || value === "1" || value === true || value === "true";
}

function filerRole(rel?: {
  isDirector?: string | number | boolean;
  isOfficer?: string | number | boolean;
  isTenPercentOwner?: string | number | boolean;
  isOther?: string | number | boolean;
}): string | undefined {
  if (!rel) return undefined;
  if (isFlagSet(rel.isOfficer)) return "Officer";
  if (isFlagSet(rel.isDirector)) return "Director";
  if (isFlagSet(rel.isTenPercentOwner)) return "10% Owner";
  if (isFlagSet(rel.isOther)) return "Other";
  return undefined;
}

// SEC only gives a free-text officerTitle ("Chief Executive Officer", "EVP & CFO", "Chairman of
// the Board", ...), not a structured seniority level — this keyword match is necessarily a
// heuristic, not exhaustive. Deliberately scoped to the classic "top of the org chart" roles
// (CEO/CFO/COO/President/Chairman), not every VP-level "Chief X Officer" title, since the whole
// point is distinguishing genuinely top-level conviction from routine officer-level activity.
// The negative lookbehinds on "president"/"chair(man)" are load-bearing, not decorative — without
// them "(Executive|Senior|Vice) Vice President" and "Vice Chairman", both genuinely common and
// genuinely NOT C-suite, would false-positive on the bare \bpresident\b / \bchairman\b match
// (confirmed by testing: "Executive Vice President" and "Vice President, Sales" both matched
// before this fix).
const C_SUITE_TITLE_PATTERN =
  /chief (executive|financial|operating) officer|\bceo\b|\bcfo\b|\bcoo\b|(?<!vice[\s-])\bpresident\b|(?<!vice[\s-])\bchair(man|woman|person)?\b/i;

function isCSuiteTitle(officerTitle?: string): boolean {
  return !!officerTitle && C_SUITE_TITLE_PATTERN.test(officerTitle);
}

// Codes we ingest at all — beyond genuine open-market trades (P/S), also the common
// compensation-related events, so the "when/how did they get these shares" origin lookup
// (src/lib/premium.ts) has something to find. IMPORTANT: only P/S ever feed the main
// consensus/signal-score computation (filtered again in the API routes) — these others exist
// purely to answer "where did the shares come from", never to be counted as a trading decision.
//   P = open-market/private purchase       S = open-market/private sale
//   A = grant/award (equity comp)          M = option/derivative exercise
//   F = shares withheld to pay tax on vesting (a disposition, not a voluntary sale)
//   G = gift
const TRACKED_CODES = new Set<TransactionCode>(["P", "S", "A", "M", "F", "G"]);

function isTrackedCode(code: string): code is TransactionCode {
  return TRACKED_CODES.has(code as TransactionCode);
}

export async function fetchFilingOwnershipXml(accession: Form4Accession): Promise<Transaction[]> {
  const indexRes = await throttledFetch(accession.indexUrl);
  const index = (await indexRes.json()) as IndexJson;
  const xmlFile = index.directory.item.find((item) => item.name.toLowerCase().endsWith(".xml"));
  if (!xmlFile) return [];

  const accessionNoDashes = accession.accessionNumber.replace(/-/g, "");
  const xmlUrl = `${SEC_BASE}/Archives/edgar/data/${accession.cik}/${accessionNoDashes}/${xmlFile.name}`;
  const xmlRes = await throttledFetch(xmlUrl);
  const xmlText = await xmlRes.text();
  const parsed = xmlParser.parse(xmlText) as OwnershipXml;
  const doc = parsed.ownershipDocument;
  if (!doc) return [];

  const rawTicker = doc.issuer?.issuerTradingSymbol?.trim();
  const ticker = rawTicker ? normalizeTicker(rawTicker) : rawTicker;
  const companyName = doc.issuer?.issuerName;
  const rawFilerId = doc.reportingOwner?.reportingOwnerId?.rptOwnerCik;
  const filerName = doc.reportingOwner?.reportingOwnerId?.rptOwnerName;
  if (!ticker || !companyName || !rawFilerId || !filerName) return [];
  // fast-xml-parser auto-coerces numeric-looking text to a JS number, dropping leading zeros — force back to string.
  const filerId = String(rawFilerId).padStart(10, "0");

  const filerRoleValue = filerRole(doc.reportingOwner?.reportingOwnerRelationship);
  const isCSuite = isCSuiteTitle(doc.reportingOwner?.reportingOwnerRelationship?.officerTitle);
  const lines = doc.nonDerivativeTable?.nonDerivativeTransaction ?? [];
  const isPlanTrade = isFlagSet(doc.aff10b5One);

  const transactions: Transaction[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = line.transactionCoding?.transactionCode;
    if (!code || !isTrackedCode(code)) continue;

    const shares = Number(line.transactionAmounts?.transactionShares?.value ?? NaN);
    const rawPrice = Number(line.transactionAmounts?.transactionPricePerShare?.value ?? NaN);
    // Filers occasionally enter the total trade value into the per-share field instead of the actual
    // price (e.g. $180,000 total mistyped as $180,000/share) — no real US common stock trades above this
    // except Berkshire Hathaway A-shares, so treat anything past it as that typo rather than a real price.
    const priceLooksLikeTypo = Number.isFinite(rawPrice) && rawPrice > 100_000 && ticker !== "BRK.A";
    const price = priceLooksLikeTypo ? NaN : rawPrice;
    const acquiredDisposed = line.transactionAmounts?.transactionAcquiredDisposedCode?.value;
    const transactionDate = line.transactionDate?.value;
    if (!transactionDate || !acquiredDisposed) continue;

    const nearOffering = await hasRecentOffering(ticker, transactionDate).catch(() => false);

    transactions.push({
      id: `${accession.accessionNumber}:${i}`,
      filerId,
      filerType: "insider",
      filerName,
      filerRole: filerRoleValue,
      ticker,
      companyName,
      side: acquiredDisposed === "A" ? "BUY" : "SELL",
      transactionCode: code,
      shares: Number.isFinite(shares) ? shares : null,
      pricePerShare: Number.isFinite(price) ? price : null,
      valueUsd: priceLooksLikeTypo
        ? rawPrice
        : Number.isFinite(shares) && Number.isFinite(price)
          ? shares * price
          : null,
      sharesOwnedAfter: line.postTransactionAmounts?.sharesOwnedFollowingTransaction?.value
        ? Number(line.postTransactionAmounts.sharesOwnedFollowingTransaction.value)
        : null,
      transactionDate,
      filedDate: accession.filedAt.slice(0, 10),
      sourceUrl: `${SEC_BASE}/Archives/edgar/data/${accession.cik}/${accessionNoDashes}/${accession.accessionNumber}-index.htm`,
      accessionNumber: accession.accessionNumber,
      nearOffering,
      isPlanTrade,
      isCSuite,
      // Requires a DB lookup (insider_positions.first_seen_date) this pure-parsing function has no
      // access to — computeFreshInsiderFlags() in ingest.ts fills in the real value afterward.
      isFreshInsider: false,
    });
  }

  return transactions;
}

export type InsiderPositionRaw = {
  ticker: string;
  companyName: string;
  filerId: string;
  filerName: string;
  filerRole?: string;
  asOfDate: string;
  shares: number | null;
  sourceUrl: string;
};

/**
 * A reporting owner's total current position from a single Form 3/4/5 filing — used to build the
 * per-company insider roster, distinct from `fetchFilingOwnershipXml`'s trade-by-trade Form 4
 * parsing. Works across all three form types since they share the `ownershipDocument` schema:
 * Form 3/5 typically report standing holdings (`nonDerivativeHolding`, possibly several lines per
 * owner to sum), Form 4 reports trades (`nonDerivativeTransaction`) — take the most recent line's
 * post-trade balance when that's what's present instead.
 */
export async function fetchOwnershipPosition(cik: string, accessionNumber: string): Promise<InsiderPositionRaw | null> {
  const accessionNoDashes = accessionNumber.replace(/-/g, "");
  const indexUrl = `${SEC_BASE}/Archives/edgar/data/${Number(cik)}/${accessionNoDashes}/index.json`;
  const indexRes = await throttledFetch(indexUrl);
  const index = (await indexRes.json()) as IndexJson;
  const xmlFile = index.directory.item.find((item) => item.name.toLowerCase().endsWith(".xml"));
  if (!xmlFile) return null;

  const xmlUrl = `${SEC_BASE}/Archives/edgar/data/${Number(cik)}/${accessionNoDashes}/${xmlFile.name}`;
  const xmlRes = await throttledFetch(xmlUrl);
  const parsed = xmlParser.parse(await xmlRes.text()) as OwnershipXml;
  const doc = parsed.ownershipDocument;
  if (!doc) return null;

  const rawTicker = doc.issuer?.issuerTradingSymbol?.trim();
  const ticker = rawTicker ? normalizeTicker(rawTicker) : rawTicker;
  const companyName = doc.issuer?.issuerName;
  const rawFilerId = doc.reportingOwner?.reportingOwnerId?.rptOwnerCik;
  const filerName = doc.reportingOwner?.reportingOwnerId?.rptOwnerName;
  const asOfDate = doc.periodOfReport;
  if (!ticker || !companyName || !rawFilerId || !filerName || !asOfDate) return null;
  const filerId = String(rawFilerId).padStart(10, "0");
  const filerRoleValue = filerRole(doc.reportingOwner?.reportingOwnerRelationship);

  const holdings = doc.nonDerivativeTable?.nonDerivativeHolding;
  const transactionLines = doc.nonDerivativeTable?.nonDerivativeTransaction;

  let shares: number | null = null;
  if (holdings && holdings.length > 0) {
    shares = holdings.reduce(
      (sum, h) => sum + Number(h.postTransactionAmounts?.sharesOwnedFollowingTransaction?.value ?? 0),
      0
    );
  } else if (transactionLines && transactionLines.length > 0) {
    // Most filings list lines chronologically, but don't rely on array order — pick the line
    // with the latest transactionDate, falling back to the last entry if dates are missing.
    const latest = transactionLines.reduce((best, line) =>
      (line.transactionDate?.value ?? "") > (best.transactionDate?.value ?? "") ? line : best
    );
    const value = latest.postTransactionAmounts?.sharesOwnedFollowingTransaction?.value;
    shares = value != null ? Number(value) : null;
  }

  return {
    ticker,
    companyName,
    filerId,
    filerName,
    filerRole: filerRoleValue,
    asOfDate,
    shares,
    sourceUrl: `${SEC_BASE}/Archives/edgar/data/${Number(cik)}/${accessionNoDashes}/${accessionNumber}-index.htm`,
  };
}

type CompanyTickersJson = Record<string, { cik_str: number; ticker: string; title: string }>;

let tickerCikMap: Map<string, string> | null = null;
let tickerCikMapLoadedAt = 0;
const TICKER_CIK_TTL_MS = 24 * 60 * 60 * 1000;

async function getCikForTicker(ticker: string): Promise<string | null> {
  const now = Date.now();
  if (!tickerCikMap || now - tickerCikMapLoadedAt > TICKER_CIK_TTL_MS) {
    const res = await throttledFetch(`${SEC_BASE}/files/company_tickers.json`);
    const json = (await res.json()) as CompanyTickersJson;
    tickerCikMap = new Map(
      Object.values(json).map((row) => [row.ticker.toUpperCase(), String(row.cik_str).padStart(10, "0")])
    );
    tickerCikMapLoadedAt = now;
  }
  return tickerCikMap.get(ticker.toUpperCase()) ?? null;
}

type CompanyTickersExchangeJson = { fields: string[]; data: [number, string, string, string | null][] };

let exchangeListedCount: number | null = null;
let exchangeListedCountLoadedAt = 0;

/** Count of NYSE/Nasdaq-listed tickers per SEC EDGAR's own exchange mapping — used on /methodik as
 * a coverage reference point. Note this also counts ETFs/trusts (e.g. SPY, QQQ), which never file
 * their own Form 4, so it overstates the true target universe of operating companies. */
export async function getExchangeListedCompanyCount(): Promise<number> {
  const now = Date.now();
  if (exchangeListedCount === null || now - exchangeListedCountLoadedAt > TICKER_CIK_TTL_MS) {
    const res = await throttledFetch(`${SEC_BASE}/files/company_tickers_exchange.json`);
    const json = (await res.json()) as CompanyTickersExchangeJson;
    exchangeListedCount = json.data.filter((row) => row[3] === "Nasdaq" || row[3] === "NYSE").length;
    exchangeListedCountLoadedAt = now;
  }
  return exchangeListedCount;
}

type SubmissionsJson = {
  sic?: string;
  sicDescription?: string;
  filings?: {
    recent?: {
      form?: string[];
      filingDate?: string[];
      accessionNumber?: string[];
      items?: string[];
    };
  };
};

const submissionsCache = new Map<string, { fetchedAt: number; data: SubmissionsJson }>();
const SUBMISSIONS_TTL_MS = 60 * 60 * 1000;

// Shared by anything that needs a company's/fund's own SEC filing history by CIK — company
// events, SIC/industry lookup, and (fund CIKs, not resolved via a ticker) 13F discovery. Cached
// once here so opening a ticker's timeline (which wants both events and SIC) only fetches once.
async function fetchSubmissionsByCik(cik: string): Promise<SubmissionsJson> {
  const cached = submissionsCache.get(cik);
  if (cached && Date.now() - cached.fetchedAt < SUBMISSIONS_TTL_MS) return cached.data;

  const res = await throttledFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const data = (await res.json()) as SubmissionsJson;
  submissionsCache.set(cik, { fetchedAt: Date.now(), data });
  return data;
}

export type FilingRef = { cik: string; accessionNumber: string; form: string; filedDate: string };

/**
 * All of a ticker's filings matching the given form types, from its full SEC filing history
 * (`filings.recent`, typically the ~1000 most recent — enough for the Form 3/4/5 insider history
 * of most companies). Used by the slow historical insider-position backfill — one ticker's full
 * history at a time, not a live/real-time feed like `fetchRecentForm3Accessions`.
 */
export async function fetchFilingsByForm(ticker: string, forms: string[]): Promise<FilingRef[]> {
  const cik = await getCikForTicker(ticker);
  if (!cik) return [];

  const { filings } = await fetchSubmissionsByCik(cik);
  const recent = filings?.recent;
  const formList = recent?.form ?? [];

  const refs: FilingRef[] = [];
  formList.forEach((form, i) => {
    if (!forms.includes(form)) return;
    const accessionNumber = recent?.accessionNumber?.[i];
    const filedDate = recent?.filingDate?.[i];
    if (!accessionNumber || !filedDate) return;
    refs.push({ cik, accessionNumber, form, filedDate });
  });
  return refs;
}

// SC 13D filers occasionally use "SCHEDULE 13D" instead of "SC 13D" — match either prefix.
// 13G (passive institutional ownership, e.g. index funds crossing 5%) is deliberately excluded:
// it's filed constantly for any large-cap and reflects passive fund mechanics, not a deliberate
// "smart money" stance the way 13D (active investor, intent to influence) or insider trades do.
function classifyForm(form: string, items: string): CompanyEvent["type"] | null {
  if (form === "DEF 14A") return "AGM_ANNOUNCED";
  if (form.startsWith("8-K") && items.includes("5.07")) return "AGM_RESULTS";
  if (form.startsWith("8-K") && items.includes("5.02")) return "EXEC_CHANGE";
  if (form === "3") return "INSIDER_JOINED";
  if (form.startsWith("SC 13D") || form.startsWith("SCHEDULE 13D")) return "ACTIVIST_STAKE";
  if (form === "424B4") return "IPO_OR_OFFERING"; // final offering prospectus — IPO or follow-on
  return null;
}

/**
 * Real, non-trade company milestones for a ticker's timeline — sourced from the issuer's own SEC
 * filing history (data.sec.gov/submissions), not the Form 4 insider feed. Deliberately limited to
 * structurally identifiable events (form type + item code) rather than attempting to parse actual
 * dates/details out of free-text filing documents, which SEC doesn't expose as structured data and
 * would be unreliable to scrape.
 */
export async function fetchCompanyEvents(ticker: string): Promise<CompanyEvent[]> {
  const cik = await getCikForTicker(ticker);
  if (!cik) return [];

  const { filings } = await fetchSubmissionsByCik(cik);
  const recent = filings?.recent;
  const forms = recent?.form ?? [];

  const events: CompanyEvent[] = [];
  forms.forEach((form, i) => {
    const filedDate = recent?.filingDate?.[i];
    const accessionNumber = recent?.accessionNumber?.[i];
    if (!filedDate || !accessionNumber) return;

    const type = classifyForm(form, recent?.items?.[i] ?? "");
    if (!type) return;

    const sourceUrl = `${SEC_BASE}/Archives/edgar/data/${Number(cik)}/${accessionNumber.replace(/-/g, "")}/${accessionNumber}-index.htm`;
    events.push({ type, filedDate, sourceUrl });
  });

  // An AGM_ANNOUNCED (DEF 14A) is presumed still pending unless a later AGM_RESULTS (8-K Item
  // 5.07) shows the meeting already happened — see the `upcoming` field's doc comment on
  // CompanyEvent for why this is an inference, not an actual extracted meeting date. Only the
  // MOST RECENT DEF 14A is ever eligible — Item 5.07 (results disclosure) has only been required
  // since ~2011, so old pre-2011 announcements would otherwise never find a matching results
  // filing and get permanently, wrongly flagged as "upcoming" decades later.
  const mostRecentAnnounced = events
    .filter((e) => e.type === "AGM_ANNOUNCED")
    .reduce<CompanyEvent | null>((latest, e) => (!latest || e.filedDate > latest.filedDate ? e : latest), null);
  if (mostRecentAnnounced) {
    const resultsDates = events.filter((e) => e.type === "AGM_RESULTS").map((e) => e.filedDate);
    mostRecentAnnounced.upcoming = !resultsDates.some((d) => d > mostRecentAnnounced.filedDate);
  }

  return events;
}

const OFFERING_LOOKBACK_DAYS = 7;

/**
 * True if the issuer filed a 424B4 (final offering prospectus — IPO or follow-on) within the
 * lookback window before `beforeDate`. Used to flag insider "purchases" that are actually
 * coordinated IPO-directed share allocations rather than independent open-market conviction buys
 * — verified on a real case (Braveheart Bio/BRVE): 6 insiders "bought" at the exact same $18.00
 * price on the same day, one day after the 424B4 priced the offering.
 */
export async function hasRecentOffering(ticker: string, beforeDate: string): Promise<boolean> {
  const cik = await getCikForTicker(ticker);
  if (!cik) return false;

  const { filings } = await fetchSubmissionsByCik(cik);
  const recent = filings?.recent;
  const forms = recent?.form ?? [];
  const cutoff = new Date(beforeDate).getTime() - OFFERING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  return forms.some((form, i) => {
    if (form !== "424B4") return false;
    const filedDate = recent?.filingDate?.[i];
    if (!filedDate) return false;
    const filedAt = new Date(filedDate).getTime();
    return filedAt >= cutoff && filedAt <= new Date(beforeDate).getTime();
  });
}

/** SEC's own industry classification (SIC) for a ticker's issuer — sourced from the same submissions endpoint as company events. */
export async function fetchTickerSic(ticker: string): Promise<{ sic: string; industry: string } | null> {
  const cik = await getCikForTicker(ticker);
  if (!cik) return null;

  const { sic, sicDescription } = await fetchSubmissionsByCik(cik);
  if (!sic || !sicDescription) return null;
  return { sic, industry: sicDescription };
}

export type Form13FHolding = { cusip: string; issuerName: string; shares: number; valueUsd: number };
export type Form13F = { quarter: string; filedDate: string; holdings: Form13FHolding[]; sourceUrl: string };

type Form13FPrimaryDoc = { edgarSubmission?: { headerData?: { filerInfo?: { periodOfReport?: string } } } };

type Form13FInfoTableXml = {
  informationTable?: {
    infoTable?: {
      nameOfIssuer?: string;
      // fast-xml-parser auto-coerces numeric-looking text to a JS number, silently dropping
      // leading zeros — a real, all-digit CUSIP starting with "0" (e.g. Apple's 037833100)
      // otherwise loses a character and fails every downstream CUSIP lookup/match.
      cusip?: string | number;
      value?: string | number;
      shrsOrPrnAmt?: { sshPrnamt?: string | number };
    }[];
  };
};

// periodOfReport comes as "MM-DD-YYYY" (a quarter-end date, e.g. "03-31-2026") — convert to a
// stable "YYYY-QN" key used to dedupe/diff holdings across quarters.
function periodToQuarter(period: string): string | null {
  const [month, , year] = period.split("-");
  if (!month || !year) return null;
  return `${year}-Q${Math.ceil(Number(month) / 3)}`;
}

/**
 * A tracked fund's Nth-most-recent 13F-HR holdings (occurrenceIndex 0 = latest, 1 = the quarter
 * before that, ...), summed per CUSIP. A single filer commonly splits one position across several
 * <infoTable> lines for different "Other Included Managers" within one umbrella filing (verified
 * on Berkshire's own filing) — those must be summed, not treated as separate positions.
 * Amendments (13F-HR/A) are deliberately not consulted for v1 — a known, documented limitation,
 * not an oversight.
 */
async function fetch13FAtOccurrence(fundCik: string, occurrenceIndex: number): Promise<Form13F | null> {
  const { filings } = await fetchSubmissionsByCik(fundCik);
  const recent = filings?.recent;
  const matchingIndexes = recent?.form?.reduce<number[]>((acc, f, i) => {
    if (f === "13F-HR") acc.push(i);
    return acc;
  }, []);
  const idx = matchingIndexes?.[occurrenceIndex] ?? -1;
  if (idx === -1 || !recent) return null;

  const accessionNumber = recent.accessionNumber?.[idx];
  const filedDate = recent.filingDate?.[idx];
  if (!accessionNumber || !filedDate) return null;

  const accessionNoDashes = accessionNumber.replace(/-/g, "");
  const baseUrl = `${SEC_BASE}/Archives/edgar/data/${Number(fundCik)}/${accessionNoDashes}`;

  const indexRes = await throttledFetch(`${baseUrl}/index.json`);
  const index = (await indexRes.json()) as IndexJson;
  // The info-table XML has an unpredictable filename (e.g. "53405.xml") unlike the cover page,
  // which is always "primary_doc.xml" — find it by elimination, same approach as Form 4 parsing.
  const infoTableFile = index.directory.item.find(
    (item) => item.name.toLowerCase().endsWith(".xml") && item.name.toLowerCase() !== "primary_doc.xml"
  );
  if (!infoTableFile) return null;

  const [primaryRes, infoTableRes] = await Promise.all([
    throttledFetch(`${baseUrl}/primary_doc.xml`),
    throttledFetch(`${baseUrl}/${infoTableFile.name}`),
  ]);

  const primaryDoc = xmlParser.parse(await primaryRes.text()) as Form13FPrimaryDoc;
  const periodOfReport = primaryDoc.edgarSubmission?.headerData?.filerInfo?.periodOfReport;
  const quarter = periodOfReport ? periodToQuarter(periodOfReport) : null;
  if (!quarter) return null;

  const infoTableXml = xmlParser.parse(await infoTableRes.text()) as Form13FInfoTableXml;
  const lines = infoTableXml.informationTable?.infoTable ?? [];

  // The <value> element is the position's total market value in whole USD (verified against a
  // real filing: Berkshire's ALLY FINL INC line implies ~$39/share at real-world Ally Financial
  // prices only when read as whole dollars, not thousands, despite older 13F documentation
  // suggesting a thousands scale for the legacy paper/ASCII format).
  const byCusip = new Map<string, Form13FHolding>();
  for (const line of lines) {
    const cusip = line.cusip != null ? String(line.cusip).padStart(9, "0") : null;
    const issuerName = line.nameOfIssuer;
    if (!cusip || !issuerName) continue;

    const shares = Number(line.shrsOrPrnAmt?.sshPrnamt ?? 0);
    const valueUsd = Number(line.value ?? 0);

    const existing = byCusip.get(cusip);
    if (existing) {
      existing.shares += shares;
      existing.valueUsd += valueUsd;
    } else {
      byCusip.set(cusip, { cusip, issuerName, shares, valueUsd });
    }
  }

  return {
    quarter,
    filedDate,
    holdings: [...byCusip.values()],
    sourceUrl: `${baseUrl}/${accessionNumber}-index.htm`,
  };
}

export function fetchLatest13F(fundCik: string): Promise<Form13F | null> {
  return fetch13FAtOccurrence(fundCik, 0);
}

/** The quarter before the fund's latest 13F-HR — used once per fund to seed a diffable baseline
 * for the "biggest position changes" feature (see institutional.ts's backfillPreviousQuarterHoldings()),
 * since regular ingestion only ever pulls the latest filing going forward. */
export function fetchPreviousQuarter13F(fundCik: string): Promise<Form13F | null> {
  return fetch13FAtOccurrence(fundCik, 1);
}

export type AccessionFetchResult = {
  transactions: Transaction[];
  // Accessions that were successfully fetched+parsed (even if they yielded zero tracked
  // transactions — a filing with only non-tracked codes is a valid, successful result, not a
  // failure). Callers should only persist these as "processed" (see processed_accessions in
  // db.ts) AFTER their transactions are actually written — a fetch/parse success here doesn't by
  // itself guarantee the DB write later succeeds too.
  succeededAccessionNumbers: string[];
};

/**
 * Fetches+parses a GIVEN list of accessions (not "however many are currently recent" — the caller
 * decides which ones are actually worth fetching, typically by filtering fetchRecentForm4Accessions'
 * output down to ones not already in processed_accessions, since SEC's "getcurrent" feed returns
 * the same rolling set of recent filings on every poll regardless of how many are genuinely new
 * since the last one).
 */
export async function fetchTransactionsForAccessions(
  accessions: Form4Accession[],
  concurrency = 5
): Promise<AccessionFetchResult> {
  const results: Transaction[][] = new Array(accessions.length);
  const succeeded: boolean[] = new Array(accessions.length).fill(false);
  let idx = 0;

  async function worker() {
    while (idx < accessions.length) {
      const cur = idx++;
      const accession = accessions[cur];
      try {
        results[cur] = await fetchFilingOwnershipXml(accession);
        succeeded[cur] = true;
      } catch (err) {
        console.warn(`[secEdgar] Filing ${accession.accessionNumber} konnte nicht geladen werden:`, err);
        results[cur] = [];
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, accessions.length) }, () => worker());
  await Promise.all(workers);

  return {
    transactions: results.flat(),
    succeededAccessionNumbers: accessions.filter((_, i) => succeeded[i]).map((a) => a.accessionNumber),
  };
}
