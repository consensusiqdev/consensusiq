import Link from "next/link";
import TopBar from "@/components/Layout/TopBar";
import DashboardClient from "@/components/dashboard/DashboardClient";
import { DEFAULT_FILTERS } from "@/components/dashboard/FilterBar";
import { getDashboardInitialData } from "@/lib/signalsQuery";
import { getActiveSubscriberId } from "@/lib/subscription";

// This page reads the visitor's Clerk session before it can decide whether to include the premium
// enrichment, so it can never produce a static shell — the actual caching (matching the old 5-min
// ISR window, same cadence as cron/ingest) now lives on getDashboardInitialData's 'use cache' scope.
export const instant = false;

export default async function DashboardPage() {
  const isSubscriber = Boolean(await getActiveSubscriberId());
  const initialData = await getDashboardInitialData(DEFAULT_FILTERS, isSubscriber);

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto max-w-7xl px-6 py-8 sm:px-10 sm:py-10">
        <TopBar />
        <DashboardClient initialData={initialData} />

        <footer className="mt-8 border-t border-border-soft pt-4 font-mono text-[11.5px] leading-relaxed text-text-faint">
          <p>
            <strong className="text-text-dim">Über dieses Tool:</strong> Alle Daten stammen live
            von der öffentlichen SEC-EDGAR-API (sec.gov) — Form-4-Meldungen von Vorständen,
            Directors und Großaktionären (10%+) sind gesetzlich vorgeschriebene Offenlegungen nach
            Section 16 des Securities Exchange Act und ohnehin öffentlich einsehbar; dieses Tool
            aggregiert sie nur. Zwischen Handel und Meldung liegen typischerweise rund 2 Werktage
            — die gezeigten Signale spiegeln also offengelegten, nicht Echtzeit-Handel wider.
            Vergangenes Insiderverhalten ist keine Garantie für künftige Kursentwicklung. Keine
            Finanzberatung. Nicht mit der SEC verbunden.
          </p>

          <p className="mt-3 border-t border-dashed border-border-soft pt-3">
            <strong className="text-text-dim">Methodik &amp; Herausgeber</strong> (Angabe gemäß
            Art. 20 EU-Marktmissbrauchsverordnung i.V.m. Delegierter Verordnung (EU) 2016/958):
            Herausgeber ist [Name/Firma, siehe{" "}
            <Link href="/impressum" className="text-accent hover:underline">
              Impressum
            </Link>
            ]. Der „Signal Score&quot; (−100 bis +100, negativ = verkaufgeführt, positiv =
            kaufgeführt) je Ticker kombiniert zu gleichen Teilen (1) den Anteil der Insider auf der
            jeweils führenden Seite (Kauf/Verkauf) an allen im Zeitraum aktiven Insidern, (2) deren
            Anteil am gesamten gehandelten Dollar-Volumen, (3) den durchschnittlichen Anteil des
            jeweils zuvor gehaltenen Aktienbestands, der gehandelt wurde, und (4) wie zeitlich eng
            beieinander diese Insider gehandelt haben; Kauf-geführter Konsens
            wird zusätzlich mit ×1,15 gewichtet, Verkauf-geführter mit ×0,85. Diese Einordnung
            wurde nicht in Übereinstimmung mit den Rechtsvorschriften zur Förderung der
            Unabhängigkeit von Finanzanalysen erstellt und unterliegt keinem Verbot des Handels
            vor ihrer Verbreitung. InsiderAlign und sein Betreiber halten keine Positionen in den
            hier genannten Wertpapieren und erhalten keine Vergütung von den genannten
            Unternehmen. <Link href="/methodik" className="text-accent hover:underline">Ausführliche Methodik →</Link>
          </p>

          <p className="mt-3 border-t border-dashed border-border-soft pt-3">
            Rechtliche Angaben zum Betreiber: <Link href="/impressum" className="hover:text-accent hover:underline">Impressum</Link>{" "}
            · <Link href="/datenschutz" className="hover:text-accent hover:underline">Datenschutz</Link>
          </p>
        </footer>
      </div>
    </main>
  );
}
