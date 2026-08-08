import type { Metadata } from "next";
import Link from "next/link";
import TopBar from "@/components/Layout/TopBar";

export const metadata: Metadata = {
  title: "Methodik | InsiderAlign",
  description:
    "Wie InsiderAlign den Signal Score berechnet, welche Daten einfließen und die gesetzlichen Pflichtangaben nach Art. 20 EU-Marktmissbrauchsverordnung.",
};

export default function MethodikPage() {
  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10 sm:py-10">
        <TopBar />
        <Link href="/dashboard" className="font-mono text-[11px] text-text-faint hover:text-accent hover:underline">
          ← Zurück zum Dashboard
        </Link>

        <h2 className="mt-3 text-2xl font-bold text-text">Methodik</h2>

        <div className="mt-6 space-y-8 text-sm leading-relaxed text-text-dim">
          <section>
            <h3 className="text-[15px] font-semibold text-text">Datenquelle &amp; Aktualität</h3>
            <p className="mt-2">
              Alle Transaktionsdaten stammen direkt von der öffentlichen SEC-EDGAR-API (sec.gov).
              Form-4-Meldungen von Vorständen, Directors und Großaktionären (10 %+ Beteiligung)
              sind gesetzlich vorgeschriebene Offenlegungen nach Section 16 des Securities Exchange
              Act und ohnehin öffentlich einsehbar — InsiderAlign aggregiert und ordnet sie nur ein,
              erhebt keine eigenen Daten. Zwischen dem eigentlichen Handel und der Veröffentlichung
              der Meldung liegen typischerweise rund zwei Werktage; die auf dem Dashboard gezeigten
              Signale spiegeln also offengelegten Handel wider, nicht Echtzeit-Transaktionen.
            </p>
          </section>

          <section>
            <h3 className="text-[15px] font-semibold text-text">Der Signal Score</h3>
            <p className="mt-2">
              Jeder Ticker mit mindestens der eingestellten Mindestanzahl unabhängig handelnder
              Insider bekommt einen Signal Score von 0–100. Er setzt sich zu gleichen Teilen aus
              drei Faktoren zusammen:
            </p>
            <ol className="mt-3 space-y-2.5 border-l border-border pl-4">
              <li>
                <b className="text-text">Kopfzahl-Anteil</b> — wie viele der im Zeitraum aktiven
                Insider dieses Tickers auf der führenden Seite (Kauf oder Verkauf) stehen, relativ
                zu allen aktiven Insidern.
              </li>
              <li>
                <b className="text-text">Dollar-Anteil</b> — wie viel des gesamten gehandelten
                Volumens (in USD) auf die führende Seite entfällt.
              </li>
              <li>
                <b className="text-text">Ø Anteil des Altbestands</b> — im Schnitt, wie viel
                Prozent ihres vor der Transaktion gehaltenen Aktienbestands die Insider auf der
                führenden Seite tatsächlich gehandelt haben (via <code>sharesOwnedAfter</code>) —
                ein kleiner Trade eines Großaktionärs zählt hier anders als der komplette Ausstieg
                eines kleineren Insiders.
              </li>
            </ol>
            <p className="mt-3">
              Kauf-geführter Konsens wird danach zusätzlich mit ×1,15 gewichtet, Verkauf-geführter
              mit ×0,85 — unabhängiges Insider-Kaufen ist ein selteneres, freiwilligeres Signal als
              routinemäßiges Verkaufen (z. B. zur Diversifikation oder Steuerzahlung).
            </p>
            <p className="mt-3">
              Nur echte Marktkäufe/-verkäufe (SEC-Transaktionscodes P/S) fließen in den Score ein —
              Aktienvergütungen, Optionsausübungen und ähnliche Vorgänge sind keine freiwilligen
              Handelsentscheidungen und würden das Signal verwässern. Käufe innerhalb von 7 Tagen
              nach einem Börsengang/Angebot (424B4) werden ebenfalls ausgeschlossen — koordinierte
              IPO-Zuteilungen sind keine unabhängige Konviktion.
            </p>
          </section>

          <section>
            <h3 className="text-[15px] font-semibold text-text">Institutionelle 13F-Daten</h3>
            <p className="mt-2">
              Zusätzlich beobachtet InsiderAlign die quartalsweisen SEC-Form-13F-Meldungen von 10
              ausgewählten &bdquo;Smart Money&ldquo;-Fonds (u. a. Berkshire Hathaway, Renaissance
              Technologies, Citadel Advisors, ARK, Pershing Square) — nicht das gesamte Universum
              der ca. 5.000+ 13F-Pflichtigen. Positions-Änderungen werden quartalsweise verglichen:
              eine neue Position gilt als &bdquo;eröffnet&ldquo;, eine komplett verschwundene als
              &bdquo;geschlossen&ldquo; (13F listet nur aktuelle Bestände, ein Ausstieg wird also
              aus dem Fehlen einer Zeile geschlossen, nicht aus einer expliziten Null). 13F-Daten
              sind grundsätzlich bis zu 45 Tage alt (gesetzliche Meldefrist nach Quartalsende) und
              erfassen keine Nachmeldungen/Amendments.
            </p>
          </section>

          <section className="border-t border-dashed border-border-soft pt-6">
            <h3 className="text-[15px] font-semibold text-text">
              Herausgeber &amp; Pflichtangabe nach Art. 20 EU-Marktmissbrauchsverordnung
            </h3>
            <p className="mt-2 font-mono text-[12.5px] leading-relaxed">
              (Angabe gemäß Art. 20 EU-Marktmissbrauchsverordnung i. V. m. Delegierter Verordnung
              (EU) 2016/958): Herausgeber ist [Name/Firma, siehe Impressum]. Diese Einordnung wurde
              nicht in Übereinstimmung mit den Rechtsvorschriften zur Förderung der Unabhängigkeit
              von Finanzanalysen erstellt und unterliegt keinem Verbot des Handels vor ihrer
              Verbreitung. InsiderAlign und sein Betreiber halten keine Positionen in den hier
              genannten Wertpapieren und erhalten keine Vergütung von den genannten Unternehmen.
            </p>
          </section>

          <section>
            <h3 className="text-[15px] font-semibold text-text">Haftungsausschluss</h3>
            <p className="mt-2 font-mono text-[12.5px] leading-relaxed">
              Vergangenes Insiderverhalten ist keine Garantie für künftige Kursentwicklung. Alle
              Angaben ohne Gewähr für Richtigkeit, Vollständigkeit oder Aktualität. Keine
              Finanzberatung. InsiderAlign steht in keiner Verbindung zur SEC.
            </p>
          </section>

          <p className="border-t border-border-soft pt-4 font-mono text-[11px] text-text-faint">
            Rechtliche Angaben zum Betreiber: <Link href="/impressum" className="hover:text-accent hover:underline">Impressum</Link>{" "}
            · <Link href="/datenschutz" className="hover:text-accent hover:underline">Datenschutz</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
