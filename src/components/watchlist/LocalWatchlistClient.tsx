"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FREE_WATCHLIST_LIMIT,
  addToLocalWatchlist,
  getLocalWatchlist,
  removeFromLocalWatchlist,
} from "@/lib/localWatchlist";
import TickerAutocompleteInput from "@/components/ui/TickerAutocompleteInput";
import WatchlistCard from "@/components/watchlist/WatchlistCard";

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

  function addTicker(raw: string) {
    const ticker = raw.trim().toUpperCase();
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addTicker(input);
        }}
        className="flex gap-2.5"
      >
        <TickerAutocompleteInput
          value={input}
          onChange={setInput}
          onSelect={addTicker}
          placeholder="Ticker oder Unternehmen…"
          className="w-full rounded-md border border-border bg-bg-panel-2 px-3 py-2.5 font-mono text-[13px] uppercase text-text outline-none focus:border-accent"
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
          <div className="space-y-2.5">
            {tickers.map((t) => (
              <WatchlistCard key={t} ticker={t} onRemove={handleRemove} />
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
