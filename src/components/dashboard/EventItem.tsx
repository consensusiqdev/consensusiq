import type { CompanyEvent } from "@/types/filing";
import Badge from "@/components/ui/Badge";
import { fmtCompanyEventLabel, fmtDate } from "@/lib/format";

/** Shared between TickerDetailModal's timeline and the /company/[ticker] page's own events
 * section — no hooks, so it renders fine from either a client or server component tree. */
export default function EventItem({ e }: { e: CompanyEvent }) {
  return (
    <li className="relative pl-4">
      <span
        className={`absolute -left-[5px] top-1.5 h-2 w-2 rounded-full ring-2 ring-bg-panel ${
          e.upcoming ? "bg-accent" : "bg-text-faint"
        }`}
      />
      <a
        href={e.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-2.5 py-1 font-mono text-[10.5px] ${
          e.upcoming ? "border border-border bg-bg-panel-2 text-text hover:border-accent" : "text-text-faint hover:text-text"
        }`}
      >
        {e.upcoming && <Badge variant="accent">Bevorstehend</Badge>}
        <span>{fmtCompanyEventLabel(e)}</span>
        {/* Says outright what a title="…" tooltip used to explain on hover only. This row is
            already a link into the filing, and nothing may be nested inside it that opens a
            popover — so the shortest reachable form of the explanation is the visible text. */}
        {e.upcoming && <span className="text-text-faint">· genauer Termin nur in der Meldung</span>}
        <span className="ml-auto">{fmtDate(e.filedDate)}</span>
      </a>
    </li>
  );
}
