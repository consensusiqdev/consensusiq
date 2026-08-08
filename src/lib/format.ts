import type { CompanyEvent, InstitutionalEvent, PriorAcquisition } from "@/types/filing";

export function fmtUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
  return "$" + n.toFixed(0);
}

export function fmtPct(n: number): string {
  return (n * 100).toFixed(0) + "%";
}

export function fmtShares(n: number | null): string {
  if (n == null) return "unbekannt";
  return n.toLocaleString("de-DE");
}

/** Per-share price with cents, e.g. "$45.20" — fmtUsd rounds to whole dollars, too coarse here. */
export function fmtPrice(n: number | null): string {
  if (n == null) return "—";
  return "$" + n.toFixed(2);
}

/**
 * Human phrase for a premium "where did these shares come from" lookup, tailored to the actual
 * SEC transaction code — a stock grant isn't a "purchase", saying so would be actively wrong.
 */
export function fmtAcquisitionLabel(a: PriorAcquisition): string {
  const date = fmtDate(a.date);
  switch (a.code) {
    case "P":
      return `gekauft am ${date} für ${fmtPrice(a.pricePerShare)}`;
    case "A":
      return `als Aktienvergütung erhalten am ${date}`;
    case "M":
      return `durch Optionsausübung erhalten am ${date}${a.pricePerShare != null ? ` für ${fmtPrice(a.pricePerShare)}` : ""}`;
    case "G":
      return `geschenkt erhalten am ${date}`;
    default:
      return `erworben am ${date}`;
  }
}

export function initials(name: string): string {
  if (!name) return "??";
  return name.slice(0, 2).toUpperCase();
}

export function sideColor(side: string): string {
  return side === "BUY" ? "var(--color-yes)" : "var(--color-no)";
}

export function fmtCompanyEventLabel(e: CompanyEvent): string {
  switch (e.type) {
    case "AGM_ANNOUNCED":
      return "Hauptversammlung einberufen";
    case "AGM_RESULTS":
      return "Abstimmungsergebnisse Hauptversammlung";
    case "EXEC_CHANGE":
      return "Wechsel in der Geschäftsführung";
    case "INSIDER_JOINED":
      return "Neuer Insider gemeldet";
    case "ACTIVIST_STAKE":
      return "Großaktionär meldet Beteiligung (13D)";
    case "IPO_OR_OFFERING":
      return "Börsengang / Aktienangebot";
  }
}

export function fmtInstitutionalLabel(e: InstitutionalEvent): string {
  const quarter = e.quarter.replace("-", " ");
  switch (e.changeType) {
    case "OPENED":
      return `${e.fundName} eröffnet neue Position (${quarter})`;
    case "INCREASED":
      return `${e.fundName} erhöht Position${e.changePct != null ? ` (+${fmtPct(e.changePct)})` : ""} (${quarter})`;
    case "DECREASED":
      return `${e.fundName} reduziert Position${e.changePct != null ? ` (${fmtPct(e.changePct)})` : ""} (${quarter})`;
    case "CLOSED":
      return `${e.fundName} schließt Position vollständig (${quarter})`;
  }
}

export function institutionalChipClass(changeType: InstitutionalEvent["changeType"]): "yes" | "no" | "other" {
  if (changeType === "OPENED" || changeType === "INCREASED") return "yes";
  if (changeType === "DECREASED" || changeType === "CLOSED") return "no";
  return "other";
}

export function sideChipClass(side: string): "yes" | "no" | "other" {
  if (side === "BUY") return "yes";
  if (side === "SELL") return "no";
  return "other";
}

/** Returns a phrase like "seit heute" / "seit 1 Tag" / "seit 3 Tagen", or "unbekannt". Takes an ISO date string. */
export function fmtRelativeTime(isoDate: string | null): string {
  if (isoDate == null) return "unbekannt";
  const days = Math.floor((Date.now() - new Date(isoDate).getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "seit heute";
  if (days === 1) return "seit 1 Tag";
  return `seit ${days} Tagen`;
}

/** Compact "06.08.2026" style date for chart axis labels/cards. Takes an ISO date string. */
export function fmtDate(isoDate: string): string {
  const d = new Date(isoDate);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${d.getUTCFullYear()}`;
}

const FILER_PALETTE = [
  "var(--color-accent)",
  "var(--color-alt1)",
  "var(--color-alt2)",
  "var(--color-yes)",
  "var(--color-no)",
  "#4fb6c9",
];

/** Deterministic line color per filer index, independent of side. */
export function filerColor(idx: number): string {
  return FILER_PALETTE[idx % FILER_PALETTE.length];
}
