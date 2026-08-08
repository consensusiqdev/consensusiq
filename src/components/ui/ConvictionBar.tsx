import type { TickerSide } from "@/types/filing";
import { sideColor } from "@/lib/format";

export default function ConvictionBar({
  sides,
  totalParticipants,
}: {
  sides: TickerSide[];
  totalParticipants: number;
}) {
  return (
    <div className="flex h-[9px] flex-1 overflow-hidden rounded-full bg-border-soft">
      {sides.map((s) => {
        const width = (s.filers.length / totalParticipants) * 100;
        return (
          <span
            key={s.side}
            style={{ width: `${width}%`, background: sideColor(s.side) }}
            className="h-full"
          />
        );
      })}
    </div>
  );
}
