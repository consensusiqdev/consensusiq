"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function WatchButton({ ticker, className }: { ticker: string; className?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "added">("idle");

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (state === "added") return;
    setState("loading");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      if (res.status === 401 || res.status === 402) {
        router.push("/pricing");
        return;
      }
      if (!res.ok) throw new Error();
      setState("added");
    } catch {
      setState("idle");
    }
  }

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
      {state === "added" ? "★ Beobachtet" : "☆ Beobachten"}
    </button>
  );
}
