import type { TickerSignal, Transaction } from "@/types/filing";
import TopBuysRail from "@/components/dashboard/TopBuysRail";
import SignalFeed from "@/components/dashboard/SignalFeed";

export default function DashboardLayout({
  topBuys,
  signals,
  onSelectTicker,
  onSelectFiler,
  resetKey,
}: {
  topBuys: Transaction[];
  signals: TickerSignal[];
  onSelectTicker: (ticker: string) => void;
  onSelectFiler: (ticker: string, filerId: string) => void;
  resetKey: string;
}) {
  return (
    <section className="mt-6 grid items-start gap-5 lg:grid-cols-[260px_1fr]">
      <TopBuysRail topBuys={topBuys} onSelectTicker={onSelectTicker} onSelectFiler={onSelectFiler} />
      <SignalFeed signals={signals} onSelectTicker={onSelectTicker} resetKey={resetKey} />
    </section>
  );
}
