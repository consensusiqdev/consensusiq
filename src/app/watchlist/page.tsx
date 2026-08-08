import TopBar from "@/components/Layout/TopBar";
import WatchlistClient from "@/components/watchlist/WatchlistClient";
import { requireActiveSubscription } from "@/lib/subscription";

export default async function WatchlistPage() {
  await requireActiveSubscription();

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10 sm:py-10">
        <TopBar />

        <h2 className="text-2xl font-bold text-text">Watchlist</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-dim">
          Trag die Aktien ein, die du hältst. Sobald für einen Ticker eine neue
          SEC-Form-4-Meldung erfasst wird, bekommst du eine E-Mail.
        </p>

        <div className="mt-6 rounded-xl border border-border bg-bg-panel p-5">
          <WatchlistClient />
        </div>
      </div>
    </main>
  );
}
