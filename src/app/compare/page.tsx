import type { Metadata } from "next";
import Link from "next/link";
import TopBar from "@/components/Layout/TopBar";
import ComparePicker from "@/components/ui/ComparePicker";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Ticker vergleichen — Insider-Signale gegenüberstellen | InsiderAlign",
  description:
    "Zwei Aktien direkt nebeneinander vergleichen: Signal Score, Insider-Kauf-/Verkaufskonsens und Handelsvolumen.",
  path: "/compare",
});

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { a, b } = await searchParams;

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10 sm:py-10">
        <TopBar />

        <Link href="/dashboard" className="font-mono text-[11px] text-text-faint hover:text-accent hover:underline">
          ← Zurück zum Dashboard
        </Link>

        <h2 className="mt-3 text-2xl font-bold text-text">Ticker vergleichen</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-dim">
          Zwei Aktien direkt nebeneinander: Signal Score, Insider-Konsens und Handelsvolumen im
          Vergleich.
        </p>

        <div className="mt-6 rounded-xl border border-border bg-bg-panel p-5">
          <ComparePicker initialTickerA={a?.toUpperCase()} initialTickerB={b?.toUpperCase()} />
        </div>
      </div>
    </main>
  );
}
