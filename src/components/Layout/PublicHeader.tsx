"use client";

import Link from "next/link";
import { useUser, UserButton } from "@clerk/nextjs";

export default function PublicHeader() {
  const { isSignedIn } = useUser();

  return (
    <header className="border-b border-border-soft">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-4 sm:px-10">
        <Link
          href="/"
          className="font-mono text-sm font-semibold uppercase tracking-[0.14em] text-accent"
        >
          InsiderAlign
        </Link>

        <nav className="flex flex-wrap items-center gap-3 font-mono text-[13px] text-text-dim sm:gap-5">
          <Link href="/dashboard" className="hover:text-text">
            Dashboard
          </Link>
          <Link href="/pricing" className="hover:text-text">
            Watchlist-Alerts
          </Link>

          {isSignedIn ? (
            <>
              <Link href="/watchlist" className="hover:text-text">
                Watchlist
              </Link>
              <UserButton />
            </>
          ) : (
            <>
              <Link href="/sign-in" className="hover:text-text">
                Anmelden
              </Link>
              <Link
                href="/sign-up"
                className="rounded-md bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-[#14100a] transition hover:brightness-110"
              >
                Jetzt starten
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
