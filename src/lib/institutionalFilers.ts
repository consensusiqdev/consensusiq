/**
 * Curated "smart money" 13F filers whose quarterly institutional-holdings changes get tracked —
 * not the full universe of ~5000+ 13F filers (a much bigger, unfiltered SEC bulk dataset).
 * CIKs verified 2026-08-07 (first 10) and 2026-08-10 (next 10) against SEC EDGAR company search
 * — each entry's CIK was fetched and confirmed directly against
 * https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=<cik>&type=13F-HR, not from
 * memory or search snippets. Deliberately excludes broad index managers (Vanguard/BlackRock/State
 * Street) — their 13F just mirrors index weights, no stock-picking signal.
 */
export type InstitutionalFiler = { cik: string; name: string };

export const INSTITUTIONAL_FILERS: InstitutionalFiler[] = [
  { cik: "0001067983", name: "Berkshire Hathaway" },
  { cik: "0001037389", name: "Renaissance Technologies" },
  { cik: "0001423053", name: "Citadel Advisors" },
  { cik: "0001697748", name: "ARK Investment Management" },
  { cik: "0001649339", name: "Scion Asset Management" },
  { cik: "0001336528", name: "Pershing Square Capital" },
  { cik: "0001350694", name: "Bridgewater Associates" },
  { cik: "0001536411", name: "Duquesne Family Office" },
  { cik: "0001040273", name: "Third Point" },
  { cik: "0001167483", name: "Tiger Global Management" },
  // Added 2026-08-10 — see doc comment above re: verification method. Greenlight Capital was
  // considered but dropped (its only 13F-HR filer, CIK 0001079114, hasn't filed since early
  // 2024 — stale); Starboard Value substituted in as an equally concentrated activist fund.
  { cik: "0000921669", name: "Carl C. Icahn" },
  { cik: "0001791786", name: "Elliott Investment Management" },
  { cik: "0001656456", name: "Appaloosa LP" },
  { cik: "0001135730", name: "Coatue Management" },
  { cik: "0001103804", name: "Viking Global Investors" },
  { cik: "0001061165", name: "Lone Pine Capital" },
  { cik: "0001061768", name: "Baupost Group" },
  { cik: "0001029160", name: "Soros Fund Management" },
  { cik: "0001603466", name: "Point72 Asset Management" },
  { cik: "0001517137", name: "Starboard Value" },
];
