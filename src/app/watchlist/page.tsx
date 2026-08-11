import type { Metadata } from "next";
import TopBar from "@/components/Layout/TopBar";
import WatchlistClient from "@/components/watchlist/WatchlistClient";
import LocalWatchlistClient from "@/components/watchlist/LocalWatchlistClient";
import { getActiveSubscriberId } from "@/lib/subscription";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Watchlist | InsiderAlign",
  description: "Deine beobachteten Aktien und Insider-Alert-Einstellungen.",
  path: "/watchlist",
});

export default async function WatchlistPage() {
  // Unlike before, non-subscribers no longer get redirected away — they see a free,
  // localStorage-backed watchlist (capped at 5, see localWatchlist.ts) instead.
  const subscriberId = await getActiveSubscriberId();

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10 sm:py-10">
        <TopBar />

        <h2 className="text-2xl font-bold text-text">Watchlist</h2>

        {subscriberId ? (
          <>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-dim">
              Trag die Aktien ein, die du hältst. Sobald für einen Ticker eine neue
              SEC-Form-4-Meldung erfasst wird, bekommst du eine E-Mail.
            </p>
            <div className="mt-6 rounded-xl border border-border bg-bg-panel p-5">
              <WatchlistClient />
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-dim">
              Bis zu 5 Aktien kostenlos beobachten, ganz ohne Login — gespeichert in diesem Browser.
              Mit Abo: unbegrenzt viele Ticker plus E-Mail-Alerts bei neuen Insider-Meldungen.
            </p>
            <div className="mt-6 rounded-xl border border-border bg-bg-panel p-5">
              <LocalWatchlistClient />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
