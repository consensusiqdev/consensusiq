import Link from "next/link";
import TopBar from "@/components/Layout/TopBar";
import CompanyInsidersClient from "@/components/company/CompanyInsidersClient";

export default async function CompanyPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10 sm:py-10">
        <TopBar />

        <Link href="/dashboard" className="font-mono text-[11px] text-text-faint hover:text-accent hover:underline">
          ← Zurück zum Dashboard
        </Link>

        <h2 className="mt-3 text-2xl font-bold text-text">
          <span className="font-mono text-accent">{ticker}</span> — Alle Insider &amp; Positionen
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-dim">
          Bekannte Insider (Vorstände, Directors, Großaktionäre) mit ihrer zuletzt gemeldeten
          Positionsgröße — nicht nur die, die zuletzt gehandelt haben.
        </p>

        <div className="mt-6 rounded-xl border border-border bg-bg-panel p-5">
          <CompanyInsidersClient ticker={ticker} />
        </div>
      </div>
    </main>
  );
}
