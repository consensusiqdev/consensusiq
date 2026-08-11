"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const DISMISSED_KEY = "insider-align-onboarding-dismissed";

/** Hidden on both the server render and the first client render, only shown via this effect if the
 * visitor hasn't dismissed it before. Deliberately the inverse of DashboardClient's filter-restore
 * pattern: showing by default and hiding post-hydration would reintroduce a layout shift for every
 * RETURNING (already-dismissed) visitor on every single visit — exactly what the dashboard's CLS
 * fix eliminated. This way only first-time visitors see a shift, and only the once. */
export default function OnboardingBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(DISMISSED_KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Storage unavailable — banner just reappears next visit, not worth failing over.
    }
  }

  if (!visible) return null;

  return (
    <div className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-accent/30 bg-bg-panel px-4 py-3.5 sm:px-5">
      <p className="font-mono text-[12.5px] leading-relaxed text-text-dim">
        <strong className="text-text">Was ist ein Signal Score?</strong> InsiderAlign zeigt Aktien,
        bei denen mehrere Vorstände, Directors oder Großaktionäre unabhängig voneinander in dieselbe
        Richtung handeln — je höher der Score (0–100), desto breiter der Konsens.{" "}
        <Link href="/methodik" className="text-accent hover:underline">
          Wie er berechnet wird →
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hinweis schließen"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-faint hover:bg-bg-hover hover:text-text"
      >
        ✕
      </button>
    </div>
  );
}
