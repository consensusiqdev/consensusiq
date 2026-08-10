"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CompanyEvent, InstitutionalEvent, Transaction, TransactionSide } from "@/types/filing";
import Badge from "@/components/ui/Badge";
import WatchButton from "@/components/ui/WatchButton";
import Sparkline from "@/components/ui/Sparkline";
import InsiderDetailModal from "@/components/dashboard/InsiderDetailModal";
import EventItem from "@/components/dashboard/EventItem";
import {
  fmtAcquisitionLabel,
  fmtDate,
  fmtInstitutionalLabel,
  fmtPct,
  fmtShares,
  fmtUsd,
  institutionalChipClass,
  sideChipClass,
} from "@/lib/format";
import { pctOfPriorHoldings, type SignalHistoryPoint } from "@/lib/consensus";

type Detail = {
  ticker: string;
  companyName: string;
  stats: { buyCount: number; sellCount: number; distinctFilers: number; total: number };
  transactions: Transaction[];
  companyEvents: CompanyEvent[];
  institutionalEvents: InstitutionalEvent[];
  signalScore: number | null;
  leadSide: TransactionSide | null;
  signalHistory: SignalHistoryPoint[];
};

type TimelineItem =
  | { kind: "trade"; date: string; transaction: Transaction }
  | { kind: "event"; date: string; event: CompanyEvent }
  | { kind: "institutional"; date: string; event: InstitutionalEvent };

function buildTimeline(detail: Detail): TimelineItem[] {
  const items: TimelineItem[] = [
    ...detail.transactions.map((t): TimelineItem => ({ kind: "trade", date: t.transactionDate, transaction: t })),
    ...detail.companyEvents.map((e): TimelineItem => ({ kind: "event", date: e.filedDate, event: e })),
    ...detail.institutionalEvents.map(
      (e): TimelineItem => ({ kind: "institutional", date: e.filedDate, event: e })
    ),
  ];
  return items.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export default function TickerDetailModal({
  ticker,
  onClose,
}: {
  ticker: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilerId, setSelectedFilerId] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker) return;
    setDetail(null);
    setError(null);
    setLoading(true);
    const controller = new AbortController();

    fetch(`/api/ticker-detail?ticker=${encodeURIComponent(ticker)}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Fehler ${res.status}`);
        setDetail(body);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [ticker]);

  useEffect(() => {
    if (!ticker) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ticker, onClose]);

  if (!ticker) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm"
        onClick={onClose}
      >
      <div
        className="w-full max-w-2xl rounded-xl border border-border bg-bg-panel p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xl font-bold text-text">
              <span className="font-mono text-accent">{ticker}</span>{" "}
              {detail && <span className="text-text-dim">{detail.companyName}</span>}
            </div>
            <div className="mt-1 flex flex-wrap gap-3 font-mono text-[11px] text-text-faint">
              <a
                href={`https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent hover:underline"
              >
                Yahoo Finance ↗
              </a>
              <a
                href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(ticker)}&type=4&dateb=&owner=include&count=40`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent hover:underline"
              >
                SEC EDGAR ↗
              </a>
              <Link href={`/company/${encodeURIComponent(ticker)}`} className="hover:text-accent hover:underline">
                Alle Insider &amp; Positionen →
              </Link>
              <WatchButton ticker={ticker} className="hover:text-accent hover:underline" />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg-panel-2 text-text-dim hover:border-accent hover:text-text"
          >
            ✕
          </button>
        </div>

        {loading && (
          <p className="mt-6 font-mono text-[12.5px] text-text-faint">Lädt Handelshistorie…</p>
        )}
        {error && <p className="mt-6 font-mono text-[12.5px] text-no">{error}</p>}

        {detail && (
          <>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat label="Käufe" value={String(detail.stats.buyCount)} accent="yes" />
              <Stat label="Verkäufe" value={String(detail.stats.sellCount)} accent="no" />
              <Stat label="Insider gesamt" value={String(detail.stats.distinctFilers)} />
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-panel-2 px-3 py-2">
              <div>
                <div className="font-mono text-[9.5px] uppercase tracking-wide text-text-faint">
                  Signal Score (30 Tage)
                </div>
                <div className="text-lg font-bold text-text">
                  {detail.signalScore != null ? detail.signalScore : "—"}
                </div>
              </div>
              <Sparkline points={detail.signalHistory} width={140} height={36} />
            </div>

            <div className="mt-4 max-h-[50vh] overflow-y-auto border-t border-dashed border-border pt-3">
              {detail.transactions.length === 0 &&
              detail.companyEvents.length === 0 &&
              detail.institutionalEvents.length === 0 ? (
                <p className="py-6 text-center font-mono text-[12px] text-text-faint">
                  Keine Ereignisse erfasst.
                </p>
              ) : (
                <ol className="ml-2 space-y-1.5 border-l border-border">
                  {buildTimeline(detail).map((item, index) => {
                    if (item.kind === "trade")
                      return (
                        <TradeItem
                          key={item.transaction.id}
                          t={item.transaction}
                          onSelectFiler={setSelectedFilerId}
                        />
                      );
                    if (item.kind === "event")
                      return (
                        <EventItem
                          key={`${item.event.type}:${item.event.filedDate}:${item.event.sourceUrl}:${index}`}
                          e={item.event}
                        />
                      );
                    return (
                      <InstitutionalItem
                        key={`${item.event.fundName}:${item.event.quarter}:${index}`}
                        e={item.event}
                      />
                    );
                  })}
                </ol>
              )}
            </div>
          </>
        )}
      </div>
      </div>
      <InsiderDetailModal ticker={ticker} filerId={selectedFilerId} onClose={() => setSelectedFilerId(null)} />
    </>
  );
}

function TradeItem({ t, onSelectFiler }: { t: Transaction; onSelectFiler: (filerId: string) => void }) {
  const pct = pctOfPriorHoldings(t.side, t.shares, t.sharesOwnedAfter);
  return (
    <li className="relative pl-4">
      <span
        className={`absolute -left-[5px] top-2 h-2 w-2 rounded-full ring-2 ring-bg-panel ${
          t.side === "BUY" ? "bg-yes" : "bg-no"
        }`}
      />
      <div
        role="link"
        tabIndex={0}
        onClick={() => window.open(t.sourceUrl, "_blank", "noopener,noreferrer")}
        onKeyDown={(e) => {
          if (e.key === "Enter") window.open(t.sourceUrl, "_blank", "noopener,noreferrer");
        }}
        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-border bg-bg-panel-2 px-2.5 py-1.5 font-mono text-[11px] hover:border-accent cursor-pointer"
      >
        <Badge variant={sideChipClass(t.side)}>{t.side}</Badge>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelectFiler(t.filerId);
          }}
          className="text-text hover:text-accent hover:underline"
        >
          {t.filerName}
        </button>
        {t.filerRole && <span className="text-text-faint">({t.filerRole})</span>}
        <span className="text-text-dim">
          {fmtShares(t.shares)} Aktien
          {pct != null && <span className="text-accent"> ({fmtPct(pct)})</span>}
        </span>
        <span className="text-text-faint">· {fmtUsd(t.valueUsd)}</span>
        {t.nearOffering && (
          <span
            className="text-text-faint"
            title="Kauf im Rahmen eines Börsengangs/Angebots — keine unabhängige Kaufentscheidung, zählt nicht in den Signal Score."
          >
            · IPO-Zeichnung
          </span>
        )}
        {t.side === "SELL" &&
          (t.priorAcquisition ? (
            <span className="text-text-faint">· {fmtAcquisitionLabel(t.priorAcquisition)}</span>
          ) : t.priorAcquisition === undefined ? (
            <Link href="/pricing" onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">
              🔒 Herkunft der Aktien (Watchlist-Abo)
            </Link>
          ) : null)}
        <span className="ml-auto text-text-faint">{fmtDate(t.transactionDate)}</span>
      </div>
    </li>
  );
}

function InstitutionalItem({ e }: { e: InstitutionalEvent }) {
  return (
    <li className="relative pl-4">
      <span
        className={`absolute -left-[5px] top-2 h-2 w-2 rounded-full ring-2 ring-bg-panel ${
          institutionalChipClass(e.changeType) === "yes"
            ? "bg-yes"
            : institutionalChipClass(e.changeType) === "no"
              ? "bg-no"
              : "bg-accent"
        }`}
      />
      <a
        href={e.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-border bg-bg-panel-2 px-2.5 py-1.5 font-mono text-[11px] hover:border-accent"
      >
        <Badge variant={institutionalChipClass(e.changeType)}>{e.changeType}</Badge>
        <span className="text-text">{fmtInstitutionalLabel(e)}</span>
        {e.valueUsd > 0 && <span className="text-text-faint">· {fmtUsd(e.valueUsd)}</span>}
        <span className="ml-auto text-text-faint">{fmtDate(e.filedDate)}</span>
      </a>
    </li>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "yes" | "no" }) {
  return (
    <div className="rounded-lg border border-border bg-bg-panel-2 px-3 py-2 text-center">
      <div
        className={`text-lg font-bold ${accent === "yes" ? "text-yes" : accent === "no" ? "text-no" : "text-text"}`}
      >
        {value}
      </div>
      <div className="font-mono text-[9.5px] uppercase tracking-wide text-text-faint">{label}</div>
    </div>
  );
}
