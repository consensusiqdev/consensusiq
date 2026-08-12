import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import TopBar from "@/components/Layout/TopBar";
import SectorSignalList from "@/components/sector/SectorSignalList";
import Sparkline from "@/components/ui/Sparkline";
import { getSectorOverview, getSectorSignalHistory, resolveIndustryFromSlug, summarizeIndustryTrend } from "@/lib/sectors";
import { pageMetadata, SITE_URL } from "@/lib/seo";

export const revalidate = 1800;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const industry = await resolveIndustryFromSlug(slug);
  if (!industry) return pageMetadata({ title: "Branche nicht gefunden | InsiderAlign", description: "", path: `/sector/${slug}` });

  const title = `${industry} — Insider-Signale nach Branche | InsiderAlign`;
  const description = `Insider-Kauf-/Verkaufskonsens für alle Ticker der Branche „${industry}" auf InsiderAlign — Signal Score, Beteiligte Insider, Handelsvolumen.`;
  return pageMetadata({ title, description, path: `/sector/${slug}` });
}

export default async function SectorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const industry = await resolveIndustryFromSlug(slug);
  if (!industry) notFound();

  const [overview, trendHistory] = await Promise.all([getSectorOverview(industry), getSectorSignalHistory(industry)]);
  const signals = [...overview.signals].sort((a, b) => b.signalScore - a.signalScore);
  const trend = summarizeIndustryTrend(trendHistory);

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "InsiderAlign", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Branchen", item: `${SITE_URL}/sector` },
      { "@type": "ListItem", position: 3, name: industry, item: `${SITE_URL}/sector/${slug}` },
    ],
  };

  return (
    <main className="min-h-screen bg-bg text-text">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10 sm:py-10">
        <TopBar />

        <Link href="/sector" className="font-mono text-[11px] text-text-faint hover:text-accent hover:underline">
          ← Alle Branchen
        </Link>

        <h2 className="mt-3 text-2xl font-bold text-text">{industry}</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-dim">
          {overview.tickerCount} bekannte Ticker in dieser Branche. Aktuelle Insider-Konsenssignale
          der letzten 30 Tage, sortiert nach Signal Score.
        </p>

        <div className="mt-6 rounded-xl border border-border bg-bg-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-text-faint">
                Insider-Stimmung, letzte 12 Wochen
              </p>
              <p className="mt-1 max-w-md text-sm leading-relaxed text-text-dim">
                {trend.direction === "unknown" && "Noch nicht genug Aktivität für einen verlässlichen Trend."}
                {trend.direction === "up" && (
                  <>
                    <span className="font-semibold text-yes">↑ Aufwärts</span> — Ø Signal Score{" "}
                    {trend.recentAvg?.toFixed(0)} in den letzten 4 Wochen, gegenüber {trend.priorAvg?.toFixed(0)} in
                    den 4 Wochen davor.
                  </>
                )}
                {trend.direction === "down" && (
                  <>
                    <span className="font-semibold text-no">↓ Abwärts</span> — Ø Signal Score{" "}
                    {trend.recentAvg?.toFixed(0)} in den letzten 4 Wochen, gegenüber {trend.priorAvg?.toFixed(0)} in
                    den 4 Wochen davor.
                  </>
                )}
                {trend.direction === "flat" && (
                  <>
                    Seitwärts — Ø Signal Score {trend.recentAvg?.toFixed(0)} in den letzten 4 Wochen, kaum verändert
                    gegenüber {trend.priorAvg?.toFixed(0)} in den 4 Wochen davor.
                  </>
                )}
              </p>
            </div>
            <Sparkline points={trendHistory} width={200} height={44} />
          </div>
        </div>

        <div className="mt-6">
          <SectorSignalList signals={signals} />
        </div>
      </div>
    </main>
  );
}
