"use client";

import { useEffect, useState } from "react";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import InsiderDetailModal from "@/components/dashboard/InsiderDetailModal";
import { fmtDate, fmtShares } from "@/lib/format";

const PAGE_SIZE = 5;

type InsiderPosition = {
  filerId: string;
  filerName: string;
  filerRole: string | null;
  shares: number | null;
  asOfDate: string;
  sourceType: "FORM3" | "FORM4" | "FORM5";
  sourceUrl: string;
};

const SOURCE_LABELS: Record<InsiderPosition["sourceType"], string> = {
  FORM3: "Form 3",
  FORM4: "Form 4",
  FORM5: "Form 5",
};

export default function CompanyInsidersClient({ ticker }: { ticker: string }) {
  const [positions, setPositions] = useState<InsiderPosition[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [backfillComplete, setBackfillComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilerId, setSelectedFilerId] = useState<string | null>(null);

  async function loadPage(offset: number) {
    const res = await fetch(`/api/company-insiders?ticker=${encodeURIComponent(ticker)}&offset=${offset}&limit=${PAGE_SIZE}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `Fehler ${res.status}`);
    return body as {
      positions: InsiderPosition[];
      total: number;
      hasMore: boolean;
      backfillComplete: boolean;
    };
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    loadPage(0)
      .then((body) => {
        setPositions(body.positions);
        setTotal(body.total);
        setHasMore(body.hasMore);
        setBackfillComplete(body.backfillComplete);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Unbekannter Fehler"))
      .finally(() => setLoading(false));
  }, [ticker]);

  async function handleLoadMore() {
    setLoadingMore(true);
    try {
      const body = await loadPage(positions.length);
      setPositions((prev) => [...prev, ...body.positions]);
      setHasMore(body.hasMore);
      setBackfillComplete(body.backfillComplete);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 font-mono text-[12.5px] text-text-faint">
        <Spinner className="h-3.5 w-3.5" />
        Lädt Insider…
      </p>
    );
  }
  if (error) {
    return <p className="font-mono text-[12.5px] text-no">{error}</p>;
  }
  if (positions.length === 0) {
    return (
      <p className="font-mono text-[12.5px] text-text-faint">
        Noch keine Insider für {ticker} erfasst — wir beobachten seit dem 06.08.2026 und laden
        ältere Historie im Hintergrund nach.
      </p>
    );
  }

  return (
    <div>
      {!backfillComplete && (
        <p className="mb-3 rounded-lg border border-dashed border-border bg-bg-panel-2 px-3 py-2 font-mono text-[11px] text-text-faint">
          Wir laden gerade weitere Insider dieser Firma nach — diese Liste wächst mit der Zeit.
        </p>
      )}

      <div className="space-y-1.5">
        {positions.map((p) => (
          <div
            key={p.filerId}
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-border bg-bg-panel-2 px-3 py-2 font-mono text-[12px] hover:border-accent"
          >
            <button
              type="button"
              onClick={() => setSelectedFilerId(p.filerId)}
              className="text-text hover:text-accent hover:underline"
            >
              {p.filerName}
            </button>
            {p.filerRole && <span className="text-text-faint">({p.filerRole})</span>}
            <span className="ml-auto text-text-dim">{fmtShares(p.shares)} Aktien</span>
            <Badge variant="other">{SOURCE_LABELS[p.sourceType]}</Badge>
            <span className="text-text-faint">Stand {fmtDate(p.asOfDate)}</span>
            <a
              href={p.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="SEC-Quelle öffnen"
              className="text-text-faint hover:text-accent"
            >
              ↗
            </a>
          </div>
        ))}
      </div>

      <InsiderDetailModal ticker={ticker} filerId={selectedFilerId} onClose={() => setSelectedFilerId(null)} />

      <p className="mt-3 font-mono text-[11px] text-text-faint">
        {positions.length} von {total} bekannten Insidern
      </p>

      {hasMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loadingMore}
          className="mt-2 rounded-md border border-border bg-bg-panel-2 px-3 py-1.5 font-mono text-[12px] text-text-dim hover:border-accent disabled:opacity-50"
        >
          {loadingMore ? "Lädt…" : "Mehr laden"}
        </button>
      )}
    </div>
  );
}
