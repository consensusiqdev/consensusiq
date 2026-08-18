import type { SignalHistoryPoint } from "@/lib/consensus";
import { sideColor } from "@/lib/format";

/**
 * Small inline-SVG line chart of a ticker's weekly signal-score trend. No charting library in
 * this codebase (hand-rolled SVG is the existing convention) — gaps (weeks with no qualifying
 * activity, `score: null`) are skipped rather than interpolated, so a quiet week doesn't
 * misleadingly read as a score of 0.
 */
export default function Sparkline({
  points,
  width = 220,
  height = 48,
}: {
  points: SignalHistoryPoint[];
  width?: number;
  height?: number;
}) {
  const known = points
    .map((p, i) => ({ ...p, i }))
    .filter((p): p is SignalHistoryPoint & { i: number; score: number } => p.score !== null);
  if (known.length === 0) {
    return <div className="font-mono text-[11px] text-text-faint">Noch keine Verlaufsdaten</div>;
  }

  const padY = 4;
  const x = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * width : width / 2);
  // Score range is -100..100 (0 = neutral) — center it vertically instead of anchoring 0 at the
  // bottom, otherwise every sell-led (negative) point would plot off-chart below the frame.
  const y = (score: number) => height / 2 - (score / 100) * (height / 2 - padY);

  // Split into runs of consecutive non-null points so the polyline never bridges a gap.
  const runs: { i: number; score: number }[][] = [];
  let current: { i: number; score: number }[] = [];
  points.forEach((p, i) => {
    if (p.score === null) {
      if (current.length > 0) runs.push(current);
      current = [];
    } else {
      current.push({ i, score: p.score });
    }
  });
  if (current.length > 0) runs.push(current);

  const last = known[known.length - 1];
  const strokeColor = last.leadSide ? sideColor(last.leadSide) : "var(--color-accent)";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="overflow-visible">
      <line
        x1={0}
        x2={width}
        y1={height / 2}
        y2={height / 2}
        stroke="var(--color-border)"
        strokeWidth={1}
        strokeDasharray="2 2"
      />
      {runs.map((run, ri) => (
        <polyline
          key={ri}
          points={run.map((p) => `${x(p.i)},${y(p.score)}`).join(" ")}
          fill="none"
          stroke={strokeColor}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />
      ))}
      {known.map((p, idx) => (
        <circle
          key={p.i}
          cx={x(p.i)}
          cy={y(p.score)}
          r={idx === known.length - 1 ? 2.5 : 1.5}
          fill={p.leadSide ? sideColor(p.leadSide) : "var(--color-accent)"}
        />
      ))}
    </svg>
  );
}
