/**
 * Curated "smart money" 13F filers whose quarterly institutional-holdings changes get tracked —
 * not the full universe of ~5000+ 13F filers (a much bigger, unfiltered SEC bulk dataset).
 * CIKs verified 2026-08-07 against SEC EDGAR company search, not from memory.
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
];
