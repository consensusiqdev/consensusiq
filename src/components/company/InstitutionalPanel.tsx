import Link from "next/link";
import Badge from "@/components/ui/Badge";
import { INSTITUTIONAL_FILERS } from "@/lib/institutionalFilers";
import {
  fmtDate,
  fmtInstitutionalLabel,
  fmtSignalScore,
  fmtUsd,
  institutionalChipClass,
  scoreTierClass,
} from "@/lib/format";
import type { InstitutionalConsensusSignal, InstitutionalEvent, TransactionSide } from "@/types/filing";

/**
 * What the tracked 13F funds are doing in this ticker, on the company page itself.
 *
 * Exists because of a concrete confusion: arriving from /institutional's Smart-Money-Konsens list
 * ("3/4 Fonds bei Aufbau, Score +72") landed on a page whose headline said the insiders are
 * SELLING, with the fund side reduced to a small badge in the button row that had to be found and
 * clicked. Two contradicting numbers and no explanation of how they relate.
 *
 * So this panel does three things the badge could not: it repeats the score the visitor just
 * clicked on, it names the contradiction out loud when there is one, and it explains why the two
 * sides can legitimately disagree — they describe different time spans, which is invisible unless
 * both dates are shown side by side.
 *
 * Deliberately still NOT a combined score: insider and institutional consensus stay separate
 * numbers (see /methodik). This only puts them next to each other and interprets the gap.
 */
export default function InstitutionalPanel({
  events,
  consensus,
  insiderScore,
  insiderLeadSide,
  insiderWindowDays,
}: {
  events: InstitutionalEvent[];
  consensus: InstitutionalConsensusSignal | null;
  insiderScore: number | null;
  insiderLeadSide: TransactionSide | null;
  insiderWindowDays: number;
}) {
  if (!consensus && events.length === 0) return null;

  // Newest quarter first; within a quarter the biggest position first.
  const sortedEvents = [...events].sort(
    (a, b) => (a.quarter > b.quarter ? -1 : a.quarter < b.quarter ? 1 : b.valueUsd - a.valueUsd)
  );
  const latest = sortedEvents[0];

  const buyingFunds = sortedEvents.filter((e) => e.changeType === "OPENED" || e.changeType === "INCREASED").length;
  const sellingFunds = sortedEvents.length - buyingFunds;

  /**
   * Prefer the consensus score's side — that is what /institutional ranks by, so it is what the
   * visitor clicked on. Without one, fall back to the plain majority of fund moves rather than
   * summarizeCrossSignal()'s direction: that helper reports "MIXED" as soon as a single fund sits
   * on the other side, so a lopsided 4-auf/1-ab would yield no direction and the whole comparison
   * would silently vanish — on exactly the tickers where it is most worth making. Only a genuine
   * tie leaves the direction open.
   */
  const fundDirection = consensus
    ? consensus.leadSide === "ACCUMULATING"
      ? "BUYING"
      : "SELLING"
    : buyingFunds > sellingFunds
      ? "BUYING"
      : sellingFunds > buyingFunds
        ? "SELLING"
        : null;

  // Funds the consensus score could actually score (two quarters on record and a changed position)
  // vs. those that only produce a timeline entry. Without naming the difference, the summary line
  // reads as contradicting the list right under it.
  const comparedFunds = consensus ? consensus.fundsAccumulating + consensus.fundsDistributing : 0;
  const uncomparedFunds = Math.max(0, sortedEvents.length - comparedFunds);

  const comparable = insiderLeadSide !== null && (fundDirection === "BUYING" || fundDirection === "SELLING");
  const aligned = comparable && (insiderLeadSide === "BUY") === (fundDirection === "BUYING");
  const diverging = comparable && !aligned;

  const fundVerb = fundDirection === "BUYING" ? "bauen auf" : fundDirection === "SELLING" ? "bauen ab" : "sind gemischt aktiv";
  const insiderVerb = insiderLeadSide === "BUY" ? "kaufen" : "verkaufen";

  return (
    <div className="mt-6 rounded-xl border border-border bg-bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-text-dim">
          Institutionelle Investoren (13F)
        </h3>
        {consensus && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-text-faint">Smart-Money-Konsens</span>
            <span
              className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[13px] font-bold ${scoreTierClass(consensus.consensusScore)}`}
            >
              {fmtSignalScore(consensus.consensusScore)}
            </span>
          </div>
        )}
      </div>

      {/* The headline the visitor came for: how does this relate to the insider number above? */}
      {comparable && (
        <div
          className={`mt-3 rounded-lg border px-3 py-2.5 ${diverging ? "border-border bg-bg-panel-2" : "border-border-soft bg-bg-panel-2"}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={diverging ? "no" : "yes"}>
              {diverging ? "Gegenläufig" : "Gleichgerichtet"}
            </Badge>
            <span className="text-[13px] font-semibold text-text">
              {diverging ? "Fonds und Insider zeigen in verschiedene Richtungen" : "Fonds und Insider zeigen in dieselbe Richtung"}
            </span>
          </div>

          <p className="mt-1.5 text-sm leading-relaxed text-text-dim">
            Insider {insiderVerb}
            {insiderScore != null && (
              <>
                {" "}
                (Signal Score <b className="text-text">{fmtSignalScore(insiderScore)}</b>, letzte {insiderWindowDays} Tage)
              </>
            )}{" "}
            — Fonds {fundVerb}
            {latest && (
              <>
                {" "}
                (Stand {latest.quarter.replace("-", " ")}, gemeldet am {fmtDate(latest.filedDate)})
              </>
            )}
            .
          </p>

          {diverging && (
            // The single most useful thing this panel says — without it a visitor reasonably reads
            // the two numbers as the site contradicting itself. Set in text-dim rather than the
            // fainter tone a footnote would get: it is the answer this panel exists for, so it is
            // stepped down from the summary above it by size, not by contrast.
            <p className="mt-2 text-[13px] leading-relaxed text-text-dim">
              Das ist meist kein Widerspruch, sondern ein Zeitversatz: 13F-Meldungen zeigen den
              Bestand zum <b className="text-text">Quartalsende</b> und erscheinen bis zu 45 Tage
              später — die Fonds können also längst umgeschichtet haben, bevor die hier gezeigten
              Insider-Meldungen überhaupt eingingen. Dazu kommt: Insider melden einzelne
              Transaktionen innerhalb von zwei Werktagen, Fonds nur Quartals-Bestände. Und
              Insider-Verkäufe sind häufig Diversifikation, Steuerzahlung oder auslaufende
              Vesting-Pläne statt einer Einschätzung zum Unternehmen — deshalb geht ein
              verkaufsgeführter Konsens ohnehin abgeschwächt in den Signal Score ein.
            </p>
          )}
        </div>
      )}

      {consensus && (
        <p className="mt-3 font-mono text-[11px] text-text-dim">
          {/* "Im Quartalsvergleich" is load-bearing, not filler: the score only counts funds with
              at least two quarters on record, so this number is legitimately smaller than the list
              below it. Saying what it counts is what stops that gap from reading as an error. */}
          Im Quartalsvergleich:{" "}
          <b className="text-text">
            {consensus.leadSide === "ACCUMULATING" ? consensus.fundsAccumulating : consensus.fundsDistributing} von{" "}
            {comparedFunds}
          </b>{" "}
          Fonds {consensus.leadSide === "ACCUMULATING" ? "bauen auf" : "bauen ab"} ·{" "}
          {/* Sign rendered here rather than passed into fmtUsd, which would put it after the
              currency symbol ("$-213.00M"). */}
          {consensus.netValueChangeUsd >= 0 ? "+" : "−"}
          {fmtUsd(Math.abs(consensus.netValueChangeUsd))} netto · Basis: {consensus.quartersUsed} Quartale
          {uncomparedFunds > 0 && (
            <>
              {" "}
              · {uncomparedFunds} weitere{uncomparedFunds === 1 ? "r Fonds" : " Fonds"} ohne Vorquartals-Vergleich
            </>
          )}
        </p>
      )}

      {/* Same reasoning as the line above: /institutional shows a score for tickers that have one,
          so its absence here needs a reason, otherwise it reads as missing data. */}
      {!consensus && (
        <p className="mt-3 font-mono text-[11px] text-text-faint">
          Noch kein Smart-Money-Konsens — dafür müssen mindestens zwei Fonds diesen Wert über zwei
          gemeldete Quartale hinweg im Bestand haben.
        </p>
      )}

      <ul className="mt-3 space-y-1.5">
        {sortedEvents.map((e, i) => (
          <li
            key={`${e.fundName}:${e.quarter}:${i}`}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-[11.5px]"
          >
            <Badge variant={institutionalChipClass(e.changeType)}>
              {e.changeType === "OPENED"
                ? "Neu"
                : e.changeType === "CLOSED"
                  ? "Zu"
                  : e.changeType === "INCREASED"
                    ? "Auf"
                    : "Ab"}
            </Badge>
            <span className="min-w-0 flex-1 text-text-dim">{fmtInstitutionalLabel(e)}</span>
            <span className="whitespace-nowrap text-text">{fmtUsd(e.valueUsd)}</span>
            <a
              href={e.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="whitespace-nowrap text-text-faint hover:text-accent hover:underline"
            >
              13F ↗
            </a>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-border-soft pt-2.5 font-mono text-[11px] text-text-faint">
        <span>13F-Daten sind bis zu 45 Tage alt und decken die letzten gemeldeten Quartale ab.</span>
        <Link href="/institutional" className="text-accent hover:underline">
          Alle {INSTITUTIONAL_FILERS.length} Fonds ansehen →
        </Link>
      </div>
    </div>
  );
}
