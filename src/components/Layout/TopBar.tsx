"use client";

import Link from "next/link";
import { useUser, UserButton } from "@clerk/nextjs";
import ThemeToggle from "@/components/ui/ThemeToggle";
import CompanySearch from "@/components/ui/CompanySearch";

export default function TopBar() {
  const { isSignedIn } = useUser();

  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-border-soft pb-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          SEC EDGAR · Öffentliche Insider-Meldungen
        </p>

        <h1 className="mt-2 text-4xl font-bold tracking-tight text-text sm:text-5xl">
          InsiderAlign
        </h1>

        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-dim sm:text-[14.5px]">
          Beobachtet gesetzlich vorgeschriebene SEC-Form-4-Meldungen von Vorständen, Directors
          und Großaktionären und zeigt, bei welchen Aktien sich mehrere Insider unabhängig
          voneinander für dieselbe Seite entscheiden.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <CompanySearch />
        <Link
          href="/institutional"
          className="rounded-md border border-border px-3 py-2 font-mono text-[12.5px] text-text-dim hover:border-accent hover:text-text"
        >
          Institutionell
        </Link>
        <Link
          href="/compare"
          className="rounded-md border border-border px-3 py-2 font-mono text-[12.5px] text-text-dim hover:border-accent hover:text-text"
        >
          Vergleichen
        </Link>
        <ThemeToggle />

        {isSignedIn ? (
          <>
            <Link
              href="/watchlist"
              className="rounded-md border border-border px-3 py-2 font-mono text-[12.5px] text-text-dim hover:border-accent hover:text-text"
            >
              Watchlist
            </Link>
            <div
              className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: "var(--bg-panel-2)", border: "1px solid var(--border)" }}
            >
              <UserButton
                afterSwitchSessionUrl="/dashboard"
                appearance={{
                  elements: {
                    avatarBox: "h-8 w-8",
                    rootBox: "flex items-center justify-center",
                  },
                }}
              />
            </div>
          </>
        ) : (
          <Link
            href="/pricing"
            className="rounded-md bg-accent px-3.5 py-2 font-mono text-[12.5px] font-medium text-[#14100a] transition hover:brightness-110"
          >
            Alerts aktivieren
          </Link>
        )}
      </div>
    </header>
  );
}
