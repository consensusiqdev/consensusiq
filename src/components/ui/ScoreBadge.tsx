"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_SCORE_WEIGHTS, SCORE_COMPONENT_KEYS, type ScoreComponents } from "@/lib/consensus";
import { fmtSignalScore, scoreTierClass } from "@/lib/format";
import type { TransactionSide } from "@/types/filing";

const COMPONENT_LABELS: Record<(typeof SCORE_COMPONENT_KEYS)[number], string> = {
  convictionRatio: "Kopfzahl-Anteil",
  dollarWeightedRatio: "Dollar-Anteil",
  avgHoldingsPct: "Ø Altbestand gehandelt",
  clusterTightnessRatio: "Cluster-Enge",
};

/**
 * Points each component contributes to the 0..100 base value, derived from the same
 * DEFAULT_SCORE_WEIGHTS the live score uses rather than hard-coding "a quarter each". Re-weighting
 * the score (the whole point of the offline research harness) would otherwise leave this breakdown
 * quietly claiming a split that no longer matches what the number was built from.
 */
function scoreBreakdown(components: ScoreComponents, sideMultiplier: number) {
  const totalWeight = SCORE_COMPONENT_KEYS.reduce((sum, key) => sum + DEFAULT_SCORE_WEIGHTS[key], 0);
  const points = SCORE_COMPONENT_KEYS.map((key) => ({
    key,
    label: COMPONENT_LABELS[key],
    points: totalWeight > 0 ? (DEFAULT_SCORE_WEIGHTS[key] / totalWeight) * 100 * components[key] : 0,
  }));
  const rawScore = points.reduce((sum, p) => sum + p.points, 0);
  return { points, rawScore, afterMultiplier: rawScore * sideMultiplier };
}

function ScoreTooltip({
  score,
  components,
  sideMultiplier,
  leadSide,
  open,
}: {
  score: number;
  components: ScoreComponents;
  sideMultiplier: number;
  leadSide: TransactionSide;
  open: boolean;
}) {
  const { points, rawScore, afterMultiplier } = scoreBreakdown(components, sideMultiplier);
  const multiplierLabel =
    leadSide === "BUY"
      ? `× ${sideMultiplier.toFixed(2)} (kaufgeführter Konsens)`
      : `× ${sideMultiplier.toFixed(2)} (verkaufgeführter Konsens, → negativ)`;
  const magnitude = Math.abs(score);
  const wasClamped = Math.round(afterMultiplier) !== magnitude && (afterMultiplier > 100 || afterMultiplier < 0);

  return (
    <span
      role="tooltip"
      // max-w keeps the 256px panel inside the viewport when the badge sits near a screen edge —
      // it is anchored to the badge's centre, which on a phone can be a few pixels from the border.
      className={`pointer-events-none absolute left-1/2 top-full z-30 mt-2 block w-64 max-w-[85vw] -translate-x-1/2 cursor-auto rounded-lg border border-border bg-bg-panel-2 p-3 text-left font-mono text-[11px] font-normal leading-relaxed text-text-dim shadow-lg group-hover:block ${
        open ? "block" : "hidden"
      }`}
    >
      <span className="mb-2 flex items-baseline justify-between text-text">
        <span className="text-[10px] uppercase tracking-wide text-text-faint">Signal Score</span>
        <span className="text-[13px] font-bold">{fmtSignalScore(score)}</span>
      </span>

      {points.map((p) => (
        <span key={p.key} className="flex justify-between">
          <span>{p.label}</span>
          <span className="text-text">+{p.points.toFixed(1)}</span>
        </span>
      ))}

      <span className="mt-1.5 flex justify-between border-t border-dashed border-border pt-1.5">
        <span>Basiswert</span>
        <span className="text-text">{rawScore.toFixed(1)}</span>
      </span>
      <span className="flex justify-between">
        <span>{multiplierLabel}</span>
        <span className="text-text">{afterMultiplier.toFixed(1)}</span>
      </span>

      <span className="mt-1.5 flex justify-between border-t border-border pt-1.5 text-text">
        <span className="font-semibold">Signal Score{wasClamped ? " (gedeckelt)" : ""}</span>
        <span className="font-bold">{fmtSignalScore(score)}</span>
      </span>
      <span className="mt-1.5 block border-t border-dashed border-border pt-1.5 text-text-faint">
        Skala −100 (starker Verkauf) bis +100 (starker Kauf).
      </span>
    </span>
  );
}

/**
 * The Signal Score with its breakdown: hover shows it on desktop (CSS `group-hover`), tapping
 * toggles it explicitly so the same explanation is reachable on touch devices, which have no hover
 * state at all.
 *
 * The trigger is a real `<button>`, not a div with an onClick. On iOS Safari — including a page
 * saved to the home screen — a tap on a plain non-interactive element does not reliably produce a
 * click event, so the breakdown was unreachable there; a button also makes it keyboard- and
 * screen-reader-accessible, which the div never was.
 *
 * `layout` picks the presentation: "stacked" is the dashboard card's badge (number over the word
 * "Score"), "inline" sits inside a running sentence, as on the company page.
 */
export default function ScoreBadge({
  score,
  components,
  sideMultiplier,
  leadSide,
  layout = "stacked",
}: {
  score: number;
  components: ScoreComponents;
  sideMultiplier: number;
  leadSide: TransactionSide;
  layout?: "stacked" | "inline";
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("click", onClickOutside);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("click", onClickOutside);
      window.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const shared = `group relative cursor-pointer rounded-md border transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${scoreTierClass(score)}`;

  return (
    <button
      ref={containerRef}
      type="button"
      aria-expanded={open}
      aria-label={`Signal Score ${fmtSignalScore(score)} — Berechnung anzeigen`}
      className={
        layout === "stacked"
          ? `${shared} flex shrink-0 flex-col items-center justify-center px-2 py-1`
          : `${shared} inline-flex items-baseline gap-1 px-1.5 py-0.5 align-middle font-mono font-bold`
      }
      onClick={(e) => {
        e.stopPropagation();
        setOpen((v) => !v);
      }}
    >
      {layout === "stacked" ? (
        <>
          <span className="font-mono text-[15px] font-bold leading-none">{fmtSignalScore(score)}</span>
          <span className="mt-0.5 font-mono text-[8px] uppercase leading-none tracking-wide">Score</span>
        </>
      ) : (
        <>
          <span>{fmtSignalScore(score)}</span>
          {/* Without a marker an inline score reads as plain text and nobody discovers the tap. */}
          <span aria-hidden className="text-[9px] font-normal text-text-faint">ⓘ</span>
        </>
      )}
      <ScoreTooltip
        score={score}
        components={components}
        sideMultiplier={sideMultiplier}
        leadSide={leadSide}
        open={open}
      />
    </button>
  );
}
