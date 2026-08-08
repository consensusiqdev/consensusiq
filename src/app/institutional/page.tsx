import type { Metadata } from "next";
import Link from "next/link";
import TopBar from "@/components/Layout/TopBar";
import { getInstitutionalOverview } from "@/lib/institutional";
import { INSTITUTIONAL_FILERS } from "@/lib/institutionalFilers";
import { fmtDate, fmtShares, fmtUsd } from "@/lib/format";
import type { FundOverview } from "@/types/filing";

export const metadata: Metadata = {
  title: "Institutionelle Investoren — 13F-Holdings | InsiderAlign",
  description:
    "Die letzten SEC-13F-Meldungen von 10 beobachteten \"Smart Money\"-Fonds (Berkshire Hathaway, Renaissance Technologies, Citadel, ARK u.a.) — größte Positionen pro Fonds.",
};

export const revalidate = 3600; // 13F only refreshes 1x/24h server-side, no reason to compute this more often

export default async function InstitutionalPage() {
  const funds = await getInstitutionalOverview();

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto max-w-5xl px-6 py-8 sm:px-10 sm:py-10">
        <TopBar />
        <Link href="/dashboard" className="font-mono text-[11px] text-text-faint hover:text-accent hover:underline">
          ← Zurück zum Dashboard
        </Link>

        <h2 className="mt-3 text-2xl font-bold text-text">Institutionelle Investoren</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-dim">
          Die letzten SEC-Form-13F-Quartalsmeldungen von 10 beobachteten &bdquo;Smart
          Money&ldquo;-Fonds — jeweils die größten Positionen nach Marktwert. 13F-Meldungen sind
          verpflichtend innerhalb von 45 Tagen nach Quartalsende, spiegeln also den Bestand zum
          Quartalsende wider, nicht den aktuellen Stand.
        </p>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {funds.map((fund, i) => (
            <FundCard key={INSTITUTIONAL_FILERS[i].cik} fund={fund} fallbackName={INSTITUTIONAL_FILERS[i].name} />
          ))}
        </div>
      </div>
    </main>
  );
}

function FundCard({ fund, fallbackName }: { fund: FundOverview; fallbackName: string }) {
  if (!fund) {
    return (
      <div className="rounded-xl border border-border bg-bg-panel p-4">
        <h3 className="text-[15px] font-semibold text-text">{fallbackName}</h3>
        <p className="mt-2 font-mono text-[11.5px] text-text-faint">
          Noch keine 13F-Meldung erfasst — wird nachgezogen.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-text">{fund.fundName}</h3>
        <span className="whitespace-nowrap font-mono text-[10.5px] text-text-faint">{fund.quarter}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-text-faint">
        <span>
          Portfolio: <b className="text-text-dim">{fmtUsd(fund.totalValueUsd)}</b>
        </span>
        <span>
          {fund.positionCount} Position{fund.positionCount === 1 ? "" : "en"}
        </span>
        <a href={fund.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">
          13F vom {fmtDate(fund.filedDate)} ↗
        </a>
      </div>

      <ol className="mt-3 space-y-1 border-t border-dashed border-border pt-3">
        {fund.topHoldings.map((h, idx) => (
          <li
            key={`${h.ticker ?? h.issuerName}:${idx}`}
            className="flex items-center gap-2 font-mono text-[11.5px]"
          >
            <span className="w-[16px] shrink-0 text-right text-text-faint">{idx + 1}.</span>
            {h.ticker ? (
              <Link
                href={`/company/${encodeURIComponent(h.ticker)}`}
                className="text-accent hover:underline"
              >
                {h.ticker}
              </Link>
            ) : (
              <span className="text-text-faint">?</span>
            )}
            <span className="min-w-0 flex-1 truncate text-text-dim">{h.issuerName}</span>
            <span className="whitespace-nowrap text-text">{fmtUsd(h.valueUsd)}</span>
            <span className="whitespace-nowrap text-text-faint">· {fmtShares(h.shares)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
