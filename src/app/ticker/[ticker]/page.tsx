import type { Metadata } from "next";
import Link from "next/link";
import TopBar from "@/components/Layout/TopBar";
import TickerDetailView from "@/components/dashboard/TickerDetailView";
import { getTickerDetail } from "@/lib/tickerDetail";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const { ticker: raw } = await params;
  const ticker = raw.toUpperCase();
  const detail = await getTickerDetail(ticker);

  return {
    title: `${ticker} — ${detail.companyName} Insider-Trading | ConsensusIQ`,
    description: `SEC-Form-4-Insiderhandel bei ${detail.companyName} (${ticker}): ${detail.stats.buyCount} Käufe, ${detail.stats.sellCount} Verkäufe von ${detail.stats.distinctFilers} Insidern.`,
  };
}

export default async function TickerPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ticker = raw.toUpperCase();
  const detail = await getTickerDetail(ticker);

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10 sm:py-10">
        <TopBar />
        <Link href="/dashboard" className="font-mono text-[11px] text-text-faint hover:text-accent hover:underline">
          ← Zurück zum Dashboard
        </Link>
        <div className="mt-6 rounded-xl border border-border bg-bg-panel p-5">
          <TickerDetailView detail={detail} ticker={ticker} />
        </div>
      </div>
    </main>
  );
}
