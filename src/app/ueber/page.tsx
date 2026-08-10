import type { Metadata } from "next";
import Link from "next/link";
import PublicHeader from "@/components/Layout/PublicHeader";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Über InsiderAlign — SEC Insider-Trading-Tracker | InsiderAlign",
  description:
    "Worauf setzen Firmen-Insider gerade — und stimmen sie überein? InsiderAlign wertet öffentliche SEC-Form-4-Meldungen aus und zeigt Insider-Konsens-Signale.",
  path: "/ueber",
});

const FEATURES = [
  {
    title: "Live Konsens-Signale",
    body: "Beobachtet öffentlich gemeldete SEC-Form-4-Insidergeschäfte und zeigt, wann sich mehrere Insider unabhängig voneinander für dieselbe Seite (Kauf oder Verkauf) derselben Aktie entscheiden.",
  },
  {
    title: "Gewichteter Signal Score",
    body: "Kombiniert Kopfzahl, Dollar-Volumen und den Anteil des jeweils eigenen Bestands, der gehandelt wurde, zu einer 0–100-Kennzahl pro Ticker — Insider-Käufe zählen dabei stärker als Verkäufe.",
  },
  {
    title: "Insider-Rolle",
    body: "Zeigt, ob es sich um Vorstand, Director oder Großaktionär (10%+) handelt — Kontext statt nur ein Name.",
  },
  {
    title: "Verlaufs-Historie",
    body: "Zeitverlauf gemeldeter Transaktionen je Ticker: seit wann ein Konsens besteht und wer zuletzt gehandelt hat.",
  },
  {
    title: "Watchlist-Alerts",
    body: "Trag ein, welche Aktien du hältst, und bekomm eine E-Mail, sobald es dazu eine neue Insider-Meldung gibt. Der einzige Teil, der ein Abo braucht — das Dashboard selbst ist komplett kostenlos.",
  },
];

export default function AboutPage() {
  return (
    <>
      <PublicHeader />

      <main className="mx-auto max-w-5xl px-6 py-16 sm:px-10 sm:py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          SEC EDGAR · Insider-Trading-Tracker
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight text-text sm:text-6xl">
          Worauf setzen Firmen-Insider gerade — und stimmen sie überein?
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-text-dim">
          InsiderAlign wertet öffentlich gemeldete SEC-Form-4-Insidergeschäfte aus und zeigt, wann
          mehrere Vorstände, Directors oder Großaktionäre unabhängig voneinander dieselbe Aktie
          kaufen oder verkaufen — samt Signal Score und Verlaufs-Historie. Komplett kostenlos,
          kein Konto nötig.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="rounded-md bg-accent px-5 py-3 text-sm font-semibold text-[#14100a] transition hover:brightness-110"
          >
            Kostenlos ansehen
          </Link>
          <Link
            href="/pricing"
            className="rounded-md border border-border px-5 py-3 text-sm font-semibold text-text-dim transition hover:border-accent hover:text-text"
          >
            Watchlist-Alerts (1,49€/Monat)
          </Link>
        </div>

        <section className="mt-20 grid gap-5 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-bg-panel p-6">
              <h2 className="text-lg font-semibold text-text">{f.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-text-dim">{f.body}</p>
            </div>
          ))}
        </section>

        <footer className="mt-20 border-t border-border-soft pt-6 font-mono text-[11.5px] leading-relaxed text-text-faint">
          <p>
            Alle Daten stammen von der öffentlichen SEC-EDGAR-API (sec.gov) — Form-4-Meldungen
            sind gesetzlich vorgeschriebene Offenlegungen nach Section 16 des Securities Exchange
            Act, gemeldet mit ca. 2 Werktagen Verzug. Keine Finanzberatung, nicht mit der SEC
            verbunden.
          </p>
          <p className="mt-2 flex gap-4">
            <Link href="/impressum" className="hover:text-text-dim">
              Impressum
            </Link>
            <Link href="/datenschutz" className="hover:text-text-dim">
              Datenschutz
            </Link>
          </p>
        </footer>
      </main>
    </>
  );
}
