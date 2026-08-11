import Link from "next/link";
import type { InstitutionalEvent } from "@/types/filing";
import { summarizeCrossSignal } from "@/lib/format";
import Badge from "@/components/ui/Badge";

/** Small hint badge: are the tracked 13F "smart money" funds also active in this ticker right now,
 * and in which direction. Not a combined score — deliberately kept separate from the insider
 * Signal Score (see /methodik's "Institutionelle 13F-Daten" section for why). */
export default function CrossSignalBadge({ events }: { events: InstitutionalEvent[] }) {
  const summary = summarizeCrossSignal(events);
  if (!summary) return null;

  const variant = summary.direction === "BUYING" ? "yes" : summary.direction === "SELLING" ? "no" : "other";

  return (
    <Link href="/institutional" title={`13F-Stand: ${summary.quarter}`}>
      <Badge variant={variant}>{summary.label}</Badge>
    </Link>
  );
}
