import type { Metadata } from "next";
import Link from "next/link";
import TopBar from "@/components/Layout/TopBar";
import Badge from "@/components/ui/Badge";
import Sparkline from "@/components/ui/Sparkline";
import ComparePicker from "@/components/ui/ComparePicker";
import { getTickerComparisonData, type TickerComparisonData } from "@/lib/tickerDetail";
import { slugifyIndustry } from "@/lib/sectors";
import { fmtUsd, fmtDate, sideChipClass } from "@/lib/format";
import { pageMetadata, SITE_URL } from "@/lib/seo";

export const revalidate = 1800; // same ISR window as /company/[ticker] — public page, keeps crawler/refresh load off the DB

function scoreTierClass(score: number): string {
  if (score >= 80) return "border-accent text-accent";
  if (score >= 50) return "border-border text-text-dim";
  return "border-border text-text-faint";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tickerA: string; tickerB: string }>;
}): Promise<Metadata> {
  const { tickerA: rawA, tickerB: rawB } = await params;
  const tickerA = rawA.toUpperCase();
  const tickerB = rawB.toUpperCase();
  const title = `${tickerA} vs. ${tickerB} — Insider-Signal-Vergleich | InsiderAlign`;
  const description = `Signal Score, Insider-Konsens und Handelsvolumen von ${tickerA} und ${tickerB} direkt nebeneinander.`;
  return pageMetadata({ title, description, path: `/compare/${tickerA}/${tickerB}` });
}

function CompareColumn({ data }: { data: TickerComparisonData }) {
  const hasData = data.stats.total > 0;

  return (
    <div className="flex-1 rounded-xl border border-border bg-bg-panel p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/company/${data.ticker}`}
          className="text-[15px] font-semibold leading-snug text-text hover:underline hover:decoration-accent"
        >
          <span className="font-mono text-accent">{data.ticker}</span>{" "}
          <span className="text-text-dim">{data.companyName}</span>
        </Link>
        {data.industry && (
          <Link href={`/sector/${slugifyIndustry(data.industry)}`}>
            <Badge variant="accent">{data.industry}</Badge>
          </Link>
        )}
      </div>

      {!hasData ? (
        <p className="mt-4 font-mono text-[12px] text-text-faint">Keine Handelsdaten bekannt.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-text-faint">
                Signal Score (30 Tage)
              </p>
              {data.signalScore != null ? (
                <p className="mt-1 text-[13px] leading-relaxed text-text-dim">
                  <b className="text-text">{data.leadCount}</b> Insider auf der{" "}
                  <b className="text-text">{data.leadSide === "BUY" ? "Kauf" : "Verkauf"}</b>-Seite —{" "}
                  <span
                    className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono font-bold ${scoreTierClass(data.signalScore)}`}
                  >
                    {data.signalScore}
                  </span>
                  /100
                </p>
              ) : (
                <p className="mt-1 text-[13px] text-text-faint">Kein aktives Signal in den letzten 30 Tagen.</p>
              )}
            </div>

            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-text-faint">Verlauf (12 Wochen)</p>
              <div className="mt-1.5">
                <Sparkline points={data.signalHistory} width={160} />
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-dashed border-border-soft pt-3 font-mono text-[11.5px] text-text-dim">
            <span>Bekannte Insider</span>
            <span className="text-right text-text">{data.stats.distinctFilers}</span>
            <span>Käufe / Verkäufe</span>
            <span className="text-right text-text">
              {data.stats.buyCount} / {data.stats.sellCount}
            </span>
            <span>Gesamtvolumen</span>
            <span className="text-right text-text">{fmtUsd(data.stats.totalVolumeUsd)}</span>
          </div>

          {data.recentTransactions.length > 0 && (
            <div className="mt-4 border-t border-dashed border-border-soft pt-3">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-text-faint">Letzte Trades</p>
              <div className="space-y-1.5">
                {data.recentTransactions.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                    <Badge variant={sideChipClass(t.side)}>{t.side}</Badge>
                    <span className="truncate text-text-dim">{t.filerName}</span>
                    <span className="whitespace-nowrap text-text-faint">
                      · {fmtUsd(t.valueUsd)} · {fmtDate(t.transactionDate)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default async function CompareTickersPage({
  params,
}: {
  params: Promise<{ tickerA: string; tickerB: string }>;
}) {
  const { tickerA: rawA, tickerB: rawB } = await params;
  const tickerA = rawA.toUpperCase();
  const tickerB = rawB.toUpperCase();

  const [dataA, dataB] = await Promise.all([
    getTickerComparisonData(tickerA),
    getTickerComparisonData(tickerB),
  ]);

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "InsiderAlign", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Vergleich", item: `${SITE_URL}/compare` },
      {
        "@type": "ListItem",
        position: 3,
        name: `${tickerA} vs. ${tickerB}`,
        item: `${SITE_URL}/compare/${tickerA}/${tickerB}`,
      },
    ],
  };

  return (
    <main className="min-h-screen bg-bg text-text">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <div className="mx-auto max-w-5xl px-6 py-8 sm:px-10 sm:py-10">
        <TopBar />

        <Link href="/dashboard" className="font-mono text-[11px] text-text-faint hover:text-accent hover:underline">
          ← Zurück zum Dashboard
        </Link>

        <h2 className="mt-3 text-2xl font-bold text-text">
          <span className="font-mono text-accent">{tickerA}</span> vs.{" "}
          <span className="font-mono text-accent">{tickerB}</span>
        </h2>

        <div className="mt-4 rounded-xl border border-border bg-bg-panel-2 p-4">
          <ComparePicker initialTickerA={tickerA} initialTickerB={tickerB} />
        </div>

        <div className="mt-6 flex flex-col gap-4 md:flex-row">
          <CompareColumn data={dataA} />
          <CompareColumn data={dataB} />
        </div>
      </div>
    </main>
  );
}
