"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardFilters } from "@/components/dashboard/FilterBar";

/** Saves the dashboard's current filter combination as a named, alertable "screen" — subscribers
 * get emailed when a ticker newly matches it (see /watchlist's "Gespeicherte Screens" section and
 * checkSavedScreensAndAlert() in screens.ts). Redirects to /pricing on 401/402, same as WatchButton. */
export default function SaveScreenButton({ filters }: { filters: DashboardFilters }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "saved">("idle");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || state === "loading") return;
    setState("loading");
    try {
      const res = await fetch("/api/screens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          windowDays: filters.windowDays,
          minAgree: filters.minAgree,
          minUsd: filters.minUsd,
          buysOnly: filters.buysOnly,
          cSuiteOnly: filters.cSuiteOnly,
          industry: filters.industry || null,
        }),
      });
      if (res.status === 401 || res.status === 402) {
        router.push("/pricing");
        return;
      }
      if (!res.ok) throw new Error();
      setState("saved");
      setName("");
      window.setTimeout(() => {
        setOpen(false);
        setState("idle");
      }, 1500);
    } catch {
      setState("idle");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-3 py-2 font-mono text-[12.5px] text-text-dim hover:border-accent hover:text-text"
      >
        Screen speichern
      </button>
    );
  }

  return (
    <form onSubmit={handleSave} className="flex items-center gap-1.5">
      <input
        type="text"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name, z.B. Biotech-Käufe"
        className="w-[160px] rounded-md border border-border bg-bg-panel-2 px-2.5 py-2 font-mono text-[12.5px] text-text outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={state === "loading" || !name.trim()}
        className="rounded-md bg-accent px-3 py-2 font-mono text-[12.5px] font-medium text-[#14100a] transition hover:brightness-110 disabled:opacity-50"
      >
        {state === "saved" ? "✓ Gespeichert" : "Speichern"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Abbrechen"
        className="text-text-faint hover:text-text"
      >
        ✕
      </button>
    </form>
  );
}
