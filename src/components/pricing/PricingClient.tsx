"use client";

import { useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import PublicHeader from "@/components/Layout/PublicHeader";

// Nur die Anzeige — der tatsächlich abgerechnete Preis wird in Lemon Squeezy
// an der Variante (LEMONSQUEEZY_VARIANT_ID) eingestellt und muss dort synchron gehalten werden.
const DISPLAY_PRICE = "1,49 €";

export default function PricingClient() {
  const { isSignedIn } = useUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheckout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Checkout konnte nicht erstellt werden");
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      setLoading(false);
    }
  }

  return (
    <>
      <PublicHeader />

      <main className="mx-auto max-w-2xl px-6 py-16 sm:px-10 sm:py-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">Preise</p>
        <h1 className="mt-2 text-4xl font-bold text-text">Nie wieder einen Insider-Trade verpassen</h1>
        <p className="mt-3 max-w-xl text-text-dim">
          Trag ein, welche Aktien du hältst — sobald ein Insider handelt, bekommst du sofort eine
          E-Mail, samt Zusatz-Kontext, den du im freien Dashboard nicht siehst. Das Dashboard
          selbst bleibt dabei komplett kostenlos, ganz ohne Konto.
        </p>

        <div className="mt-8 rounded-xl border border-accent bg-bg-panel p-8">
          <div className="text-5xl font-bold text-text">
            {DISPLAY_PRICE} <span className="text-lg font-normal text-text-dim">/ Monat</span>
          </div>
          <p className="mt-1 font-mono text-[12px] text-text-faint">für Watchlist + Alerts</p>

          <ul className="mt-6 space-y-2 font-mono text-[13px] text-text-dim">
            <li>✓ Watchlist: trag ein, welche Aktien du hältst</li>
            <li>✓ Sofort-Alert per E-Mail bei jeder neuen Insider-Meldung dazu</li>
            <li>✓ Premium-Kontext: siehst, wann ein Insider die Aktien gekauft hat, die er jetzt
              verkauft</li>
            <li>✓ Das komplette Dashboard bleibt natürlich weiterhin inklusive</li>
            <li>✓ Jederzeit kündbar</li>
          </ul>

          {isSignedIn ? (
            <button
              type="button"
              onClick={handleCheckout}
              disabled={loading}
              className="mt-8 w-full rounded-md bg-accent py-3 font-mono text-sm font-semibold text-[#14100a] transition hover:brightness-110 disabled:opacity-50"
            >
              {loading ? "Lädt…" : "Abo abschließen"}
            </button>
          ) : (
            <Link
              href="/sign-up"
              className="mt-8 block w-full rounded-md bg-accent py-3 text-center font-mono text-sm font-semibold text-[#14100a] transition hover:brightness-110"
            >
              Jetzt registrieren
            </Link>
          )}

          {error && <p className="mt-3 font-mono text-[12px] text-no">{error}</p>}
        </div>
      </main>
    </>
  );
}
