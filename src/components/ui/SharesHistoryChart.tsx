import type { SharesHistoryPoint } from "@/lib/insiderDetail";
import { fmtDate, fmtShares, sideColor } from "@/lib/format";

/**
 * Step chart of an insider's holdings over time — holdings stay flat between transactions and
 * jump at each one, so a staircase line (not a diagonal one) is the honest shape here. Points
 * flagged `anomaly` (a holdings jump that doesn't match the recorded trade size — most likely an
 * untracked stock split, see insiderDetail.ts) render in a distinct warning color with a native
 * SVG tooltip, since we deliberately don't try to silently "correct" the numbers.
 */
export default function SharesHistoryChart({
  points,
  width = 480,
  height = 140,
}: {
  points: SharesHistoryPoint[];
  width?: number;
  height?: number;
}) {
  if (points.length === 0) {
    return <div className="font-mono text-[11px] text-text-faint">Keine Bestandsdaten verfügbar.</div>;
  }

  const padX = 4;
  const padY = 10;
  const maxShares = Math.max(...points.map((p) => p.shares));
  const minShares = Math.min(0, ...points.map((p) => p.shares));
  const range = maxShares - minShares || 1;

  const x = (i: number) =>
    points.length > 1 ? padX + (i / (points.length - 1)) * (width - 2 * padX) : width / 2;
  const y = (shares: number) => height - padY - ((shares - minShares) / range) * (height - 2 * padY);

  const stepSegments: string[] = [];
  points.forEach((p, i) => {
    if (i === 0) {
      stepSegments.push(`${x(i)},${y(p.shares)}`);
    } else {
      const prev = points[i - 1];
      stepSegments.push(`${x(i)},${y(prev.shares)}`); // horizontal hold
      stepSegments.push(`${x(i)},${y(p.shares)}`); // vertical jump
    }
  });

  const hasAnomaly = points.some((p) => p.anomaly);

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="w-full overflow-visible">
        <polyline points={stepSegments.join(" ")} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} opacity={0.85} />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.shares)}
            r={p.anomaly ? 4 : 2.5}
            fill={p.anomaly ? "var(--color-no)" : sideColor(p.side)}
            stroke={p.anomaly ? "var(--bg-panel)" : "none"}
            strokeWidth={p.anomaly ? 1.5 : 0}
          >
            <title>
              {fmtDate(p.date)}: {fmtShares(p.shares)} Aktien
              {p.anomaly
                ? " — möglicher Split o.ä., Bestandssprung passt nicht zum gemeldeten Trade (nicht bereinigt)"
                : ""}
            </title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-text-faint">
        <span>{fmtDate(points[0].date)}</span>
        <span>{fmtDate(points[points.length - 1].date)}</span>
      </div>
      {hasAnomaly && (
        <p className="mt-1.5 font-mono text-[10px] text-no">
          ⬤ Markierte Punkte: Bestandssprung passt nicht zum gemeldeten Trade — evtl. Aktien-Split,
          nicht automatisch bereinigt.
        </p>
      )}
    </div>
  );
}
