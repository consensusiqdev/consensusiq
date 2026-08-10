import type { Metadata } from "next";
import Link from "next/link";
import TopBar from "@/components/Layout/TopBar";
import CompanyInsidersClient from "@/components/company/CompanyInsidersClient";
import CompanyHistoryButton from "@/components/company/CompanyHistoryButton";
import Badge from "@/components/ui/Badge";
import Sparkline from "@/components/ui/Sparkline";
import EventItem from "@/components/dashboard/EventItem";
import { getTickerDetail } from "@/lib/tickerDetail";
import { slugifyIndustry } from "@/lib/sectors";
import { fmtUsd } from "@/lib/format";
import { pageMetadata, SITE_URL } from "@/lib/seo";

export const revalidate = 1800; // public/SEO page — 30min ISR keeps crawler load off the DB without going stale

function scoreTierClass(score: number): string {
  if (score >= 80) return "border-accent text-accent";
  if (score >= 50) return "border-border text-text-dim";
  return "border-border text-text-faint";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();
  const detail = await getTickerDetail(ticker);

  const scoreText = detail.signalScore != null ? `Signal Score ${detail.signalScore}/100` : "noch kein aktives Signal";
  const industryText = detail.industry ? ` — ${detail.industry}` : "";
  const title = `${ticker} Insider-Trades & Signal Score | InsiderAlign`;
  const description = `${detail.companyName}: ${detail.stats.distinctFilers} bekannte Insider, ${scoreText}${industryText}. Alle SEC-Form-4-Insidergeschäfte und Positionen im Überblick.`;

  return pageMetadata({ title, description, path: `/company/${ticker}` });
}

export default async function CompanyPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();
  const detail = await getTickerDetail(ticker);

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "InsiderAlign", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Dashboard", item: `${SITE_URL}/dashboard` },
      { "@type": "ListItem", position: 3, name: ticker, item: `${SITE_URL}/company/${ticker}` },
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

        <Link href="/dashboard" className="font-mono text-[11px] text-text-faint hover:text-accent hover:underline">
          ← Zurück zum Dashboard
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-bold text-text">
            <span className="font-mono text-accent">{ticker}</span>{" "}
            <span className="text-text-dim">{detail.companyName}</span>
          </h2>
          {detail.industry && (
            <Link href={`/sector/${slugifyIndustry(detail.industry)}`}>
              <Badge variant="accent">{detail.industry}</Badge>
            </Link>
          )}
          <CompanyHistoryButton ticker={ticker} />
          <Link
            href={`/compare?a=${ticker}`}
            className="rounded-md border border-border px-3 py-1.5 font-mono text-[11.5px] text-text-dim hover:border-accent hover:text-text"
          >
            Vergleichen
          </Link>
          <a
            href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(ticker)}&type=4&dateb=&owner=include&count=40`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-border px-3 py-1.5 font-mono text-[11.5px] text-text-dim hover:border-accent hover:text-text"
          >
            SEC-Meldungen ↗
          </a>
        </div>

        <div className="mt-6 rounded-xl border border-border bg-bg-panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-text-faint">
                Aktueller Signal Score (30 Tage)
              </p>
              {detail.signalScore != null ? (
                <p className="mt-1 text-sm leading-relaxed text-text-dim">
                  <b className="text-text">{detail.leadCount}</b> Insider auf der{" "}
                  <b className="text-text">{detail.leadSide === "BUY" ? "Kauf" : "Verkauf"}</b>-Seite —
                  Signal Score{" "}
                  <span
                    className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono font-bold ${scoreTierClass(detail.signalScore)}`}
                  >
                    {detail.signalScore}
                  </span>
                  /100.
                </p>
              ) : (
                <p className="mt-1 text-sm text-text-faint">Kein aktives Signal in den letzten 30 Tagen.</p>
              )}
              <p className="mt-2 font-mono text-[11px] text-text-faint">
                {detail.stats.distinctFilers} bekannte Insider · {fmtUsd(
                  detail.transactions.reduce((sum, t) => sum + (t.valueUsd ?? 0), 0)
                )}{" "}
                Gesamtvolumen
              </p>
            </div>

            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-text-faint">Verlauf (12 Wochen)</p>
              <div className="mt-1.5">
                <Sparkline points={detail.signalHistory} />
              </div>
            </div>
          </div>

          {detail.peers.length > 0 && (
            <div className="mt-5 border-t border-dashed border-border-soft pt-4">
              <p className="font-mono text-[10px] uppercase tracking-wide text-text-faint">
                Weitere Signale in „{detail.industry}"
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {detail.peers.map((peer) => (
                  <Link
                    key={peer.ticker}
                    href={`/company/${peer.ticker}`}
                    className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-[11.5px] text-text-dim hover:border-accent hover:text-text"
                  >
                    <span className="text-accent">{peer.ticker}</span>
                    <span className="text-text-faint">{peer.signalScore}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {detail.companyEvents.length > 0 && (
          <div className="mt-6 rounded-xl border border-border bg-bg-panel p-5">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-text-dim">
              Unternehmens-Ereignisse
            </h3>
            <ol className="mt-3 ml-2 space-y-1.5 border-l border-border">
              {[...detail.companyEvents]
                .sort((a, b) => (a.filedDate < b.filedDate ? 1 : -1))
                .slice(0, 8)
                .map((e, i) => (
                  <EventItem key={`${e.type}:${e.filedDate}:${e.sourceUrl}:${i}`} e={e} />
                ))}
            </ol>
          </div>
        )}

        <p className="mt-6 max-w-xl text-sm leading-relaxed text-text-dim">
          Bekannte Insider (Vorstände, Directors, Großaktionäre) mit ihrer zuletzt gemeldeten
          Positionsgröße.
        </p>

        <div className="mt-6 rounded-xl border border-border bg-bg-panel p-5">
          <CompanyInsidersClient ticker={ticker} />
        </div>
      </div>
    </main>
  );
}
