"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addToLocalWatchlist, isInLocalWatchlist, FREE_WATCHLIST_LIMIT } from "@/lib/localWatchlist";

export default function WatchButton({ ticker, className }: { ticker: string; className?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "added" | "limit">("idle");

  // Only ever set "added" from a passive mount check — never "limit", since that would risk
  // mislabeling a real subscriber whose browser happens to also hold 5 local picks from before
  // they subscribed. "limit" is only ever reached as the *result* of an actual failed API call below.
  useEffect(() => {
    if (isInLocalWatchlist(ticker)) setState("added");
  }, [ticker]);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (state === "added" || state === "loading") return;
    if (state === "limit") {
      router.push("/pricing");
      return;
    }
    setState("loading");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      if (res.status === 401 || res.status === 402) {
        const result = addToLocalWatchlist(ticker);
        setState(result === "limit-reached" ? "limit" : "added");
        return;
      }
      if (!res.ok) throw new Error();
      setState("added");
    } catch {
      setState("idle");
    }
  }

  const label =
    state === "added"
      ? "★ Beobachtet"
      : state === "limit"
        ? `${FREE_WATCHLIST_LIMIT}/${FREE_WATCHLIST_LIMIT} · Abo →`
        : "☆ Beobachten";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === "loading"}
      className={
        className ??
        "text-[11px] text-text-dim hover:text-accent disabled:opacity-50"
      }
    >
      {label}
    </button>
  );
}
