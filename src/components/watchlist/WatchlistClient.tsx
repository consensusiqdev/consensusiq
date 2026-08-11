"use client";

import { useEffect, useState } from "react";
import WatchlistCard from "@/components/watchlist/WatchlistCard";

export default function WatchlistClient() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/watchlist")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Fehler ${res.status}`);
        setTickers(body.tickers);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Unbekannter Fehler"))
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const ticker = input.trim().toUpperCase();
    if (!ticker) return;
    setError(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Fehler ${res.status}`);
      setTickers(body.tickers);
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    }
  }

  async function handleRemove(ticker: string) {
    setError(null);
    try {
      const res = await fetch(`/api/watchlist?ticker=${encodeURIComponent(ticker)}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Fehler ${res.status}`);
      setTickers(body.tickers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    }
  }

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

      {error && <p className="mt-3 font-mono text-[12.5px] text-no">{error}</p>}

      <div className="mt-6">
        {loading ? (
          <p className="font-mono text-[12.5px] text-text-faint">Lädt…</p>
        ) : tickers.length === 0 ? (
          <p className="font-mono text-[12.5px] leading-relaxed text-text-faint">
            Noch keine Aktien beobachtet. Füge einen Ticker hinzu, um per E-Mail informiert zu
            werden, sobald es dazu neue Insider-Meldungen gibt.
          </p>
        ) : (
          <div className="space-y-2.5">
            {tickers.map((t) => (
              <WatchlistCard key={t} ticker={t} onRemove={handleRemove} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
