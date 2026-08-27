"use client";

import { useEffect, useState } from "react";
import type { InsiderTransaction, SharesHistoryPoint, TrackRecord } from "@/lib/insiderDetail";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import SharesHistoryChart from "@/components/ui/SharesHistoryChart";
import { fmtDate, fmtShares, fmtUsd, sideChipClass } from "@/lib/format";

type Detail = {
  filerId: string;
  filerName: string;
  filerRole?: string;
  ticker: string;
  companyName: string;
  currentShares: number | null;
  transactions: InsiderTransaction[];
  sharesHistory: SharesHistoryPoint[];
  trackRecord: TrackRecord;
};

/** Reusable insider-detail modal — opened from both CompanyInsidersClient (roster on
 * /company/[ticker]) and TickerDetailModal's trade history (dashboard), so it takes
 * ticker/filerId as props rather than reading route params. Renders on top of whatever else is
 * open (z-[60], one above TickerDetailModal's z-50) since it can be stacked on that modal too. */
export default function InsiderDetailModal({
  ticker,
  filerId,
  onClose,
}: {
  ticker: string;
  filerId: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filerId) return;
    setDetail(null);
    setError(null);
    setLoading(true);
    const controller = new AbortController();

    fetch(`/api/insider-detail?ticker=${encodeURIComponent(ticker)}&filerId=${encodeURIComponent(filerId)}`, {
      signal: controller.signal,
    })
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
  }, [ticker, filerId]);

  useEffect(() => {
    if (!filerId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filerId, onClose]);

  if (!filerId) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-border bg-bg-panel p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-bold text-text">
              {detail ? detail.filerName : "Insider"}
              {detail?.filerRole && <span className="ml-1.5 text-sm font-normal text-text-faint">({detail.filerRole})</span>}
            </div>
            {detail && (
              <div className="mt-1 flex flex-wrap gap-3 font-mono text-[11px] text-text-faint">
                <span className="text-accent">{detail.ticker}</span>
                <a
                  href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(filerId)}&type=4&dateb=&owner=include&count=40`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent hover:underline"
                >
                  Alle Meldungen bei SEC EDGAR ↗
                </a>
              </div>
            )}
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
          <p className="mt-6 flex items-center gap-2 font-mono text-[12.5px] text-text-faint">
            <Spinner className="h-3.5 w-3.5" />
            Lädt Insider-Details…
          </p>
        )}
        {error && <p className="mt-6 font-mono text-[12.5px] text-no">{error}</p>}

        {detail && (
          <>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat label="Aktuelle Position" value={fmtShares(detail.currentShares)} />
              <Stat label="Transaktionen" value={String(detail.transactions.length)} />
              <Stat
                label="Erste Meldung"
                value={
                  detail.transactions.length > 0
                    ? fmtDate(detail.transactions[detail.transactions.length - 1].transactionDate)
                    : "—"
                }
              />
            </div>

            {(detail.trackRecord.totalBuys > 0 || detail.trackRecord.totalSells > 0) && (
              <div className="mt-4 rounded-lg border border-border bg-bg-panel-2 px-3 py-2.5">
                <p className="font-mono text-[9.5px] uppercase tracking-wide text-text-faint">
                  Track Record bei {detail.ticker}
                </p>
                <p className="mt-1.5 font-mono text-[11.5px] leading-relaxed text-text-dim">
                  <b className="text-text">{detail.trackRecord.totalBuys}</b> Käufe, davon{" "}
                  <b className="text-text">{detail.trackRecord.buysInCluster}</b> als Teil eines
                  Insider-Konsens (3+ gleichzeitig aktive Insider) und{" "}
                  <b className="text-text">{detail.trackRecord.largeBuys}</b> deutlich größer als
                  sein/ihr eigener Durchschnitt · <b className="text-text">{detail.trackRecord.totalSells}</b>{" "}
                  Verkäufe, davon <b className="text-text">{detail.trackRecord.sellsInCluster}</b> im
                  Konsens und <b className="text-text">{detail.trackRecord.largeSells}</b> ungewöhnlich groß.
                </p>
              </div>
            )}

            <div className="mt-4 rounded-lg border border-border bg-bg-panel-2 px-3 py-2.5">
              <p className="font-mono text-[9.5px] uppercase tracking-wide text-text-faint">
                Aktienbestand über Zeit
              </p>
              <div className="mt-2">
                <SharesHistoryChart points={detail.sharesHistory} />
              </div>
            </div>

            <div className="mt-4 max-h-[35vh] overflow-y-auto border-t border-dashed border-border pt-3">
              <ol className="ml-2 space-y-1.5 border-l border-border">
                {detail.transactions.map((t) => (
                  <li key={t.id} className="relative pl-4">
                    <span
                      className={`absolute -left-[5px] top-2 h-2 w-2 rounded-full ring-2 ring-bg-panel ${
                        t.side === "BUY" ? "bg-yes" : "bg-no"
                      }`}
                    />
                    <a
                      href={t.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-border bg-bg-panel-2 px-2.5 py-1.5 font-mono text-[11px] hover:border-accent"
                    >
                      <Badge variant={sideChipClass(t.side)}>{t.side}</Badge>
                      <span className="text-text-dim">{fmtShares(t.shares)} Aktien</span>
                      <span className="text-text-faint">· {fmtUsd(t.valueUsd)}</span>
                      <span className="text-text-faint">· Code {t.transactionCode}</span>
                      {t.clusterParticipants > 1 && (
                        <span className="text-accent">· {t.clusterParticipants} Insider gleichzeitig aktiv</span>
                      )}
                      {/* 2x threshold mirrors SIZE_MULTIPLE_THRESHOLD in insiderDetail.ts — not
                          importable here (server-only module), kept in sync manually. */}
                      {t.sizeMultiple != null && t.sizeMultiple >= 2 && (
                        <span className="text-accent">· {t.sizeMultiple.toFixed(1)}× größer als Durchschnitt</span>
                      )}
                      <span className="ml-auto text-text-faint">{fmtDate(t.transactionDate)}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-panel-2 px-3 py-2 text-center">
      <div className="text-lg font-bold text-text">{value}</div>
      <div className="font-mono text-[9.5px] uppercase tracking-wide text-text-faint">{label}</div>
    </div>
  );
}
