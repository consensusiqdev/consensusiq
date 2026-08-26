"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A short explanation attached to a label, reachable by tap as well as by hover.
 *
 * Replaces `title="…"`, which renders as a native tooltip only on mouse hover and is therefore
 * completely unreachable on a touch device — the same gap the Signal Score badge had. That matters
 * here because these particular explanations are load-bearing rather than decorative: they are the
 * only place the app says what a 10b5-1 plan trade is, or which roles the C-Suite filter actually
 * keeps. On an iPad that text simply did not exist.
 *
 * `label` stays visible and carries the marker; the explanation opens on tap or click, closes on
 * click-outside or Escape. Same interaction contract as ScoreBadge, deliberately — one popover
 * behaviour across the app rather than two that drift.
 */
export default function InfoDot({
  label,
  children,
  align = "left",
  ariaLabel = "Erklärung anzeigen",
}: {
  /**
   * The visible text the explanation belongs to, e.g. "10b5-1-Plan". Omit it to render the marker
   * on its own — needed next to a checkbox, where the text belongs to the <label> and a nested
   * button would toggle the box instead of opening the explanation.
   */
  label?: React.ReactNode;
  /** The explanation itself. */
  children: React.ReactNode;
  /** Which edge the panel is pinned to — "right" keeps it on screen near the viewport's right. */
  align?: "left" | "right";
  /** Announced to screen readers; only meaningful when there is no visible `label`. */
  ariaLabel?: string;
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

  return (
    <button
      ref={containerRef}
      type="button"
      aria-expanded={open}
      aria-label={label === undefined ? ariaLabel : undefined}
      className="group relative inline-flex cursor-pointer items-baseline gap-1 rounded text-left align-baseline transition-colors hover:text-text-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      onClick={(e) => {
        e.stopPropagation();
        setOpen((v) => !v);
      }}
    >
      {label}
      {/* Without a marker the label reads as plain text and nobody discovers it can be tapped. */}
      <span aria-hidden className="text-[9px] leading-none text-text-faint">
        ⓘ
      </span>

      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-30 mt-1.5 block w-60 max-w-[80vw] cursor-auto rounded-lg border border-border bg-bg-panel-2 p-2.5 text-left font-mono text-[11px] font-normal leading-relaxed text-text-dim shadow-lg group-hover:block ${
          align === "right" ? "right-0" : "left-0"
        } ${open ? "block" : "hidden"}`}
      >
        {children}
      </span>
    </button>
  );
}
