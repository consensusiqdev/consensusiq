import type { TickerSignal, Transaction } from "@/types/filing";
import TopBuysRail from "@/components/dashboard/TopBuysRail";
import SignalFeed from "@/components/dashboard/SignalFeed";

export default function DashboardLayout({
  topBuys,
  signals,
}: {
  topBuys: Transaction[];
  signals: TickerSignal[];
}) {
  return (
    <section className="mt-6 grid items-start gap-5 lg:grid-cols-[260px_1fr]">
      <TopBuysRail topBuys={topBuys} />
      <SignalFeed signals={signals} />
    </section>
  );
}
