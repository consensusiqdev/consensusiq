"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FREE_WATCHLIST_LIMIT,
  addToLocalWatchlist,
  getLocalWatchlist,
  removeFromLocalWatchlist,
} from "@/lib/localWatchlist";

export default function LocalWatchlistClient() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Reading localStorage during the initial render would mismatch server/client hydration (same
  // reasoning as DashboardClient.tsx's filter restoration) — resolve it in an effect instead.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setTickers(getLocalWatchlist());
    setHydrated(true);
  }, []);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const ticker = input.trim().toUpperCase();
    if (!ticker) return;
    const result = addToLocalWatchlist(ticker);
    if (result === "limit-reached") {
      setError(`Limit von ${FREE_WATCHLIST_LIMIT} erreicht.`);
      return;
    }
    setError(null);
    setTickers(getLocalWatchlist());
    setInput("");
  }

  function handleRemove(ticker: string) {
    removeFromLocalWatchlist(ticker);
    setTickers(getLocalWatchlist());
    setError(null);
  }

  if (!hydrated) return null;

  return (
    <div>
      <form onSubmit={handleAdd} className="flex gap-2.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ticker, z.B. AAPL"
          className="flex-1 rounded-md border border-border bg-bg-panel-2 px-3 py-2.5 font-mono text-[13px] uppercase text-text outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-md bg-accent px-5 py-2.5 font-mono text-[12.5px] font-medium uppercase tracking-wide text-[#14100a] transition hover:brightness-110"
        >
          Hinzufügen
        </button>
      </form>

      {error && (
        <p className="mt-3 font-mono text-[12.5px] text-no">
          {error}{" "}
          <Link href="/pricing" className="underline hover:text-accent">
            Mit Abo unbegrenzt →
          </Link>
        </p>
      )}

      <div className="mt-6">
        {tickers.length === 0 ? (
          <p className="font-mono text-[12.5px] leading-relaxed text-text-faint">
            Noch keine Aktien beobachtet. Füge bis zu {FREE_WATCHLIST_LIMIT} Ticker hinzu — wird nur
            in diesem Browser gespeichert, kein Login nötig.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tickers.map((t) => (
              <span
                key={t}
                className="flex items-center gap-2 rounded-full border border-border bg-bg-panel-2 py-1.5 pl-3.5 pr-2 font-mono text-[13px] text-text"
              >
                {t}
                <button
                  type="button"
                  onClick={() => handleRemove(t)}
                  aria-label={`${t} entfernen`}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-text-faint hover:bg-bg-hover hover:text-no"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="mt-4 border-t border-dashed border-border-soft pt-3 font-mono text-[11px] text-text-faint">
        {tickers.length}/{FREE_WATCHLIST_LIMIT} belegt, nur in diesem Browser gespeichert.{" "}
        <Link href="/pricing" className="text-accent hover:underline">
          Mit Abo: unbegrenzt beobachten + E-Mail-Alerts →
        </Link>
      </p>
    </div>
  );
}
