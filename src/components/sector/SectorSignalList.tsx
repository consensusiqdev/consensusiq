"use client";

import { useRouter } from "next/navigation";
import type { TickerSignal } from "@/types/filing";
import SignalFeed from "@/components/dashboard/SignalFeed";

/** Reuses the dashboard's SignalFeed (data already computed server-side) but routes ticker
 * selection to the public /company/[ticker] page instead of opening the dashboard's modal. */
export default function SectorSignalList({ signals }: { signals: TickerSignal[] }) {
  const router = useRouter();

  return (
    <SignalFeed
      signals={signals}
      onSelectTicker={(ticker) => router.push(`/company/${ticker}`)}
      resetKey="sector"
    />
  );
}
