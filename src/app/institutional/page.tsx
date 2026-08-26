import type { Metadata } from "next";
import Link from "next/link";
import { cacheLife } from "next/cache";
import TopBar from "@/components/Layout/TopBar";
import Badge from "@/components/ui/Badge";
import FundHoldingsList from "@/components/institutional/FundHoldingsList";
import { computeInstitutionalConsensus, getBiggestInstitutionalMoves, getInstitutionalOverview } from "@/lib/institutional";
import { INSTITUTIONAL_FILERS } from "@/lib/institutionalFilers";
import { fmtDate, fmtPct, fmtSignalScore, fmtUsd, scoreTierClass } from "@/lib/format";
import { pageMetadata } from "@/lib/seo";
import type { FundOverview, InstitutionalConsensusSignal, InstitutionalMove } from "@/types/filing";

export const metadata: Metadata = pageMetadata({
  title: "Institutionelle Investoren — 13F-Holdings | InsiderAlign",
  description: `Die letzten SEC-13F-Meldungen von ${INSTITUTIONAL_FILERS.length} beobachteten "Smart Money"-Fonds (Berkshire Hathaway, Renaissance Technologies, Citadel, ARK u.a.) — Smart-Money-Konsens, größte Auf-/Abstockungen und alle Positionen pro Fonds.`,
  path: "/institutional",
});

export default async function InstitutionalPage() {
  "use cache";
  cacheLife("dailyRefresh"); // 13F only refreshes 1x/24h server-side, no reason to compute this more often

  const [funds, moves, consensus] = await Promise.all([
    getInstitutionalOverview(),
    getBiggestInstitutionalMoves(),
    computeInstitutionalConsensus(),
  ]);
  const fundCount = INSTITUTIONAL_FILERS.length;

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto max-w-5xl px-6 py-8 sm:px-10 sm:py-10">
        <TopBar />
        <Link href="/dashboard" className="font-mono text-[11px] text-text-faint hover:text-accent hover:underline">
          ← Zurück zum Dashboard
        </Link>

        <h2 className="mt-3 text-2xl font-bold text-text">Institutionelle Investoren</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-dim">
          Die letzten SEC-Form-13F-Quartalsmeldungen von {fundCount} beobachteten &bdquo;Smart
          Money&ldquo;-Fonds — alle gemeldeten Positionen nach Marktwert sortiert. 13F-Meldungen
          sind verpflichtend innerhalb von 45 Tagen nach Quartalsende, spiegeln also den Bestand
          zum Quartalsende wider, nicht den aktuellen Stand.
        </p>

        {consensus.length > 0 && (
          <div className="mt-6 rounded-xl border border-border bg-bg-panel p-5">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-text-dim">
              Smart-Money-Konsens
            </h3>
            <p className="mt-1 font-mono text-[11px] text-text-faint">
              Fonds, die unabhängig voneinander in dieselbe Richtung umschichten — rollierend über
              die letzten {Math.max(...consensus.map((c) => c.quartersUsed))} verfügbaren
              Quartale, mindestens 2 Fonds aktiv.
            </p>
            <div className="mt-4 space-y-2">
              {consensus.map((c) => (
                <ConsensusRow key={c.ticker} c={c} />
              ))}
            </div>
          </div>
        )}

        {(moves.increases.length > 0 || moves.decreases.length > 0) && (
          <div className="mt-6 rounded-xl border border-border bg-bg-panel p-5">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-text-dim">
              Größte Positionsänderungen zum Vorquartal
            </h3>
            <p className="mt-1 font-mono text-[11px] text-text-faint">
              Über alle {fundCount} Fonds hinweg, nach Dollar-Veränderung sortiert.
            </p>
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              <MovesList title="Aufgestockt / neu eröffnet" moves={moves.increases} />
              <MovesList title="Reduziert / geschlossen" moves={moves.decreases} />
            </div>
          </div>
        )}

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {funds.map((fund, i) => (
            <FundCard key={INSTITUTIONAL_FILERS[i].cik} fund={fund} fallbackName={INSTITUTIONAL_FILERS[i].name} />
          ))}
        </div>
      </div>
    </main>
  );
}

function ConsensusRow({ c }: { c: InstitutionalConsensusSignal }) {
  const activeFunds = c.fundsAccumulating + c.fundsDistributing;
  const leadCount = c.leadSide === "ACCUMULATING" ? c.fundsAccumulating : c.fundsDistributing;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-panel-2 px-3 py-2.5">
      <div
        className={`flex shrink-0 flex-col items-center justify-center rounded-md border px-2 py-1 ${scoreTierClass(c.consensusScore)}`}
      >
        <span className="font-mono text-[14px] font-bold leading-none">{fmtSignalScore(c.consensusScore)}</span>
        <span className="mt-0.5 font-mono text-[8px] uppercase leading-none tracking-wide">Score</span>
      </div>

      <Link
        href={`/company/${c.ticker}`}
        className="text-[13.5px] font-semibold text-text hover:underline hover:decoration-accent"
      >
        <span className="font-mono text-accent">{c.ticker}</span>{" "}
        <span className="text-text-dim">{c.companyName}</span>
      </Link>

      <span className="ml-auto whitespace-nowrap font-mono text-[11px] text-text-dim">
        <b className="text-text">
          {leadCount}/{activeFunds}
        </b>{" "}
        Fonds bei „{c.leadSide === "ACCUMULATING" ? "Aufbau" : "Abbau"}“
      </span>

      <span className="whitespace-nowrap font-mono text-[11px] text-text-faint">
        {c.netValueChangeUsd >= 0 ? "+" : ""}
        {fmtUsd(c.netValueChangeUsd)} netto · {c.quartersUsed} Quartale
      </span>
    </div>
  );
}

function MovesList({ title, moves }: { title: string; moves: InstitutionalMove[] }) {
  if (moves.length === 0) {
    return (
      <div>
        <h4 className="font-mono text-[10px] uppercase tracking-wide text-text-faint">{title}</h4>
        <p className="mt-2 font-mono text-[11.5px] text-text-faint">Keine Daten.</p>
      </div>
    );
  }

  return (
    <div>
      <h4 className="font-mono text-[10px] uppercase tracking-wide text-text-faint">{title}</h4>
      <ol className="mt-2 space-y-1.5">
        {moves.map((m, idx) => (
          <li
            key={`${m.fundName}:${m.ticker}:${idx}`}
            className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[11px]"
          >
            <Badge variant={m.changeUsd >= 0 ? "yes" : "no"}>
              {m.changeType === "OPENED" ? "Neu" : m.changeType === "CLOSED" ? "Zu" : m.changeType === "INCREASED" ? "Auf" : "Ab"}
            </Badge>
            {m.ticker ? (
              <Link href={`/company/${encodeURIComponent(m.ticker)}`} className="text-accent hover:underline">
                {m.ticker}
              </Link>
            ) : (
              <span className="text-text-faint">?</span>
            )}
            <span className="min-w-0 truncate text-text-dim">{m.fundName}</span>
            <span className="whitespace-nowrap text-text">
              {m.changeUsd >= 0 ? "+" : ""}
              {fmtUsd(m.changeUsd)}
            </span>
            {m.changePct != null && m.changeType !== "CLOSED" && (
              <span className="whitespace-nowrap text-text-faint">
                ({m.changeUsd >= 0 ? "+" : ""}
                {fmtPct(m.changePct)})
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
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

      <FundHoldingsList holdings={fund.holdings} />
    </div>
  );
}
