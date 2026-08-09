import type { Metadata } from "next";
import PricingClient from "@/components/pricing/PricingClient";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Preise — Watchlist & Insider-Alerts | InsiderAlign",
  description:
    "Watchlist + sofortige E-Mail-Alerts bei neuen Insider-Meldungen für 1,49 € / Monat. Das Dashboard bleibt komplett kostenlos, ganz ohne Konto.",
  path: "/pricing",
});

export default function PricingPage() {
  return <PricingClient />;
}
