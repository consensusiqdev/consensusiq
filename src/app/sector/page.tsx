import type { Metadata } from "next";
import Link from "next/link";
import { cacheLife } from "next/cache";
import TopBar from "@/components/Layout/TopBar";
import { listIndustriesWithCounts } from "@/lib/sectors";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Branchen — Insider-Signale nach Sektor | InsiderAlign",
  description:
    "Alle beobachteten Branchen im Überblick — Insider-Kauf-/Verkaufskonsens gruppiert nach Sektor (SEC SIC-Klassifikation).",
  path: "/sector",
});

export default async function SectorHubPage() {
  "use cache";
  cacheLife("publicIsr");

  const industries = await listIndustriesWithCounts();

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10 sm:py-10">
        <TopBar />

        <Link href="/dashboard" className="font-mono text-[11px] text-text-faint hover:text-accent hover:underline">
          ← Zurück zum Dashboard
        </Link>

        <h2 className="mt-3 text-2xl font-bold text-text">Branchen</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-dim">
          Insider-Konsenssignale gruppiert nach Branche (SEC-SIC-Klassifikation) — {industries.length}{" "}
          Branchen aktuell beobachtet.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {industries.map(({ industry, slug, tickerCount }) => (
            <Link
              key={slug}
              href={`/sector/${slug}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-panel-2 px-3.5 py-2.5 hover:border-accent"
            >
              <span className="text-sm text-text">{industry}</span>
              <span className="whitespace-nowrap font-mono text-[11px] text-text-faint">
                {tickerCount} Ticker
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
