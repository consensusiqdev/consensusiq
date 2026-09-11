import type { Metadata } from "next";
import Link from "next/link";
import { cacheLife } from "next/cache";
import TopBar from "@/components/Layout/TopBar";
import Badge from "@/components/ui/Badge";
import { listIpos } from "@/lib/ipos";
import { fmtDate } from "@/lib/format";
import { pageMetadata } from "@/lib/seo";
import type { IpoListing } from "@/types/filing";

export const metadata: Metadata = pageMetadata({
  title: "Neue Börsengänge (IPOs) | InsiderAlign",
  description:
    "Frisch börsennotierte Unternehmen, erkannt an ihrem SEC-Form-424B4-Prospekt — mit Hinweis, ob Insider bei der Erstplatzierung selbst mitgezeichnet haben.",
  path: "/ipos",
});

export default async function IposPage() {
  "use cache";
  cacheLife("dailyRefresh"); // Discovery-Cron läuft 1x/24h, siehe /api/cron/ipos

  const ipos = await listIpos();

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10 sm:py-10">
        <TopBar />

        <Link href="/dashboard" className="font-mono text-[11px] text-text-faint hover:text-accent hover:underline">
          ← Zurück zum Dashboard
        </Link>

        <h2 className="mt-3 text-2xl font-bold text-text">Neue Börsengänge</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-dim">
          Unternehmen, deren erster finaler Angebotsprospekt (SEC-Form 424B4) neu erkannt wurde —
          mit Hinweis, ob Insider bei der Erstplatzierung selbst mitgezeichnet haben. Ein Follow-on-
          Angebot bereits gehandelter Unternehmen zählt nicht als IPO und taucht hier nicht auf.
        </p>

        {ipos.length === 0 ? (
          <p className="mt-8 font-mono text-[12px] text-text-faint">
            Noch keine IPOs erfasst — der tägliche Scan läuft, aber echte Erstnotierungen sind
            selten.
          </p>
        ) : (
          <div className="mt-6 space-y-2">
            {ipos.map((ipo) => (
              <IpoRow key={ipo.ticker} ipo={ipo} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function IpoRow({ ipo }: { ipo: IpoListing }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-bg-panel-2 px-3.5 py-2.5">
      <Link
        href={`/company/${encodeURIComponent(ipo.ticker)}`}
        className="text-[13.5px] font-semibold text-text hover:underline hover:decoration-accent"
      >
        <span className="font-mono text-accent">{ipo.ticker}</span>{" "}
        <span className="text-text-dim">{ipo.companyName}</span>
      </Link>

      <span className="font-mono text-[11px] text-text-faint">IPO {fmtDate(ipo.filedDate)}</span>

      <SubscriptionBadge ipo={ipo} />

      <a
        href={ipo.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto whitespace-nowrap font-mono text-[10.5px] text-text-faint hover:text-accent hover:underline"
      >
        424B4 ↗
      </a>
    </div>
  );
}

function SubscriptionBadge({ ipo }: { ipo: IpoListing }) {
  if (!ipo.hasAnyActivity) {
    return <Badge variant="other">Noch keine Insider-Meldungen</Badge>;
  }
  if (ipo.insiderSubscriberCount === 0) {
    return <Badge variant="no">Keine Insider-Zeichnung</Badge>;
  }
  return (
    <Badge variant="yes">
      {ipo.insiderSubscriberCount} Insider {ipo.insiderSubscriberCount === 1 ? "hat" : "haben"} mitgezeichnet
    </Badge>
  );
}
