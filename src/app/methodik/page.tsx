import type { Metadata } from "next";
import Link from "next/link";
import TopBar from "@/components/Layout/TopBar";
import { getTrackedCompanyCount } from "@/lib/db";
import { getExchangeListedCompanyCount } from "@/lib/secEdgar";

export const metadata: Metadata = {
  title: "Methodik | InsiderAlign",
  description:
    "Wie InsiderAlign den Signal Score berechnet, welche Daten einfließen und die gesetzlichen Pflichtangaben nach Art. 20 EU-Marktmissbrauchsverordnung.",
};

// SEC's exchange-ticker list only changes as new listings/delistings happen — daily refresh is plenty.
export const revalidate = 3600;

export default async function MethodikPage() {
  const [trackedCompanyCount, exchangeListedCompanyCount] = await Promise.all([
    getTrackedCompanyCount(),
    getExchangeListedCompanyCount(),
  ]);

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
            <h3 className="text-[15px] font-semibold text-text">Abdeckung</h3>
            <p className="mt-2">
              InsiderAlign verfolgt aktuell <b className="text-text">{trackedCompanyCount}</b> Unternehmen
              mit mindestens einer erfassten Form-4-Meldung — von rund{" "}
              <b className="text-text">{exchangeListedCompanyCount.toLocaleString("de-DE")}</b> an NYSE
              und Nasdaq gelisteten Tickern laut SEC EDGAR. Diese Vergleichszahl enthält auch ETFs,
              Trusts und andere Produkte ohne eigene Vorstände/Directors, die nie eine Form-4-Meldung
              haben werden — die tatsächliche Abdeckung unter operativ tätigen Unternehmen liegt also
              höher, als der reine Bruchteil nahelegt. Es gibt kein festes Ziel-Universum: Jede neu
              eingehende SEC-Form-4-Meldung wird automatisch aufgenommen, die Liste wächst laufend an
              Handelstagen.
            </p>
          </section>

          <section>
            <h3 className="text-[15px] font-semibold text-text">Der Signal Score</h3>
            <p className="mt-2">
              Jeder Ticker mit mindestens der eingestellten Mindestanzahl unabhängig handelnder
              Insider bekommt einen Signal Score von −100 bis +100. Ein positiver Wert steht für
              kaufgeführten, ein negativer für verkaufgeführten Konsens — die Stärke (0 = kein
              nennenswertes Signal, 100/−100 = maximale Konviktion) setzt sich zu gleichen Teilen
              aus vier Faktoren zusammen:
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
              <li>
                <b className="text-text">Cluster-Enge</b> — wie zeitlich nah beieinander die
                Insider der führenden Seite gehandelt haben (Referenzfenster: 14 Tage). Mehrere
                Insider, die praktisch am selben Tag kaufen oder verkaufen, wirken koordinierter
                als dieselbe Anzahl über Monate verteilt — ein einzelner Insider auf der führenden
                Seite gilt automatisch als maximal eng (nichts, womit er sich zeitlich streuen
                könnte).
              </li>
            </ol>
            <p className="mt-3">
              Kauf-geführter Konsens wird danach zusätzlich mit ×1,15 gewichtet, Verkauf-geführter
              mit ×0,85 — unabhängiges Insider-Kaufen ist ein selteneres, freiwilligeres Signal als
              routinemäßiges Verkaufen (z. B. zur Diversifikation oder Steuerzahlung). Das Ergebnis
              wird bei Verkauf-geführtem Konsens negativ ausgegeben, bei Kauf-geführtem positiv —
              die Zahl allein zeigt damit sofort die Richtung, ohne dass die Beschriftung daneben
              gelesen werden muss.
            </p>
            <p className="mt-3">
              Nur echte Marktkäufe/-verkäufe (SEC-Transaktionscodes P/S) fließen in den Score ein —
              Aktienvergütungen, Optionsausübungen und ähnliche Vorgänge sind keine freiwilligen
              Handelsentscheidungen und würden das Signal verwässern. Käufe innerhalb von 7 Tagen
              nach einem Börsengang/Angebot (424B4) werden ebenfalls ausgeschlossen — koordinierte
              IPO-Zuteilungen sind keine unabhängige Konviktion. Ebenso ausgeschlossen: Trades, bei
              denen die Meldung selbst einen Rule-10b5-1(c)-Handelsplan angekreuzt hat — die
              Ausführung erfolgt dann automatisch zu einem vorab festgelegten Zeitpunkt, nicht als
              spontane Entscheidung. Alle drei Kategorien bleiben in der vollständigen
              Handelshistorie sichtbar (entsprechend gekennzeichnet), fließen aber nicht in den
              Score ein.
            </p>
            <p className="mt-3">
              Zusätzlich rein informativ markiert (ebenfalls ohne Einfluss auf den Score, da nicht
              eindeutig ist, ob es ein stärkeres oder schwächeres Signal ist): Käufe von Insidern,
              die laut SEC-Form-3 erst innerhalb der letzten 30 Tage neu bei der Firma
              aufgetaucht sind (&bdquo;Frisch eingestiegen&ldquo;). Kein rückwirkendes Backfill —
              nur ab Einführung dieser Markierung neu erfasste Trades können sie tragen.
            </p>
          </section>

          <section>
            <h3 className="text-[15px] font-semibold text-text">Institutionelle 13F-Daten</h3>
            <p className="mt-2">
              Zusätzlich beobachtet InsiderAlign die quartalsweisen SEC-Form-13F-Meldungen von 20
              ausgewählten &bdquo;Smart Money&ldquo;-Fonds (u. a. Berkshire Hathaway, Renaissance
              Technologies, Citadel Advisors, ARK, Pershing Square, Elliott Investment Management) —
              nicht das gesamte Universum der ca. 5.000+ 13F-Pflichtigen, und bewusst ohne breite
              Indexfonds (Vanguard, BlackRock etc.), deren 13F nur die jeweilige Indexgewichtung
              spiegelt. Positions-Änderungen werden quartalsweise verglichen: eine neue Position
              gilt als &bdquo;eröffnet&ldquo;, eine komplett verschwundene als
              &bdquo;geschlossen&ldquo; (13F listet nur aktuelle Bestände, ein Ausstieg wird also
              aus dem Fehlen einer Zeile geschlossen, nicht aus einer expliziten Null). 13F-Daten
              sind grundsätzlich bis zu 45 Tage alt (gesetzliche Meldefrist nach Quartalsende) und
              erfassen keine Nachmeldungen/Amendments.
            </p>
            <p className="mt-3">
              Der &bdquo;Smart-Money-Konsens&ldquo;-Score (−100 bis +100, positiv = aufbaugeführt,
              negativ = abbaugeführt, auf{" "}
              <Link href="/institutional" className="text-accent hover:underline">
                /institutional
              </Link>
              ) überträgt dieselbe Logik wie der Signal Score auf institutionelle Daten: rollierend
              über die letzten bis zu 4 verfügbaren Quartale wird pro Aktie verglichen, wie viele
              der 20 Fonds ihre Position auf- bzw. abgebaut haben. Die Stärke des Scores ist zu
              gleichen Teilen zusammengesetzt aus (1) dem Anteil der Fonds auf der führenden Seite
              an allen in dieser Aktie aktiven Fonds, (2) deren Anteil am gesamten bewegten
              Dollar-Volumen und (3) dem durchschnittlichen Anteil des jeweiligen
              Portfolio-Gewichts, das neu hinzukam bzw. abgebaut wurde — ein Fonds, der eine
              Position von 0 auf 3 % seines Portfolios aufbaut, zählt stärker als einer, der eine
              bereits große Position nur geringfügig aufstockt. Aufbau-geführter Konsens wird mit
              ×1,15 gewichtet und positiv ausgegeben, Abbau-geführter mit ×0,85 und negativ —
              dieselbe Asymmetrie und dasselbe Vorzeichen-Prinzip wie beim Insider-Signal-Score.
              Mindestens 2 Fonds müssen in der Aktie aktiv sein, damit ein Score berechnet wird.
              Bewusst getrennt vom Insider-Signal-Score gehalten (kein kombiniertes Cross-Signal,
              Stand heute).
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
