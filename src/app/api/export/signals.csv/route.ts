import { NextRequest, NextResponse } from "next/server";
import { getFilteredSignals, parseSignalsQueryParams } from "@/lib/signalsQuery";

const COLUMNS = [
  "ticker",
  "companyName",
  "industry",
  "signalScore",
  "leadSide",
  "leadCount",
  "totalParticipants",
  "totalValueUsd",
  "consensusSince",
] as const;

function csvField(value: string | number | null): string {
  const s = value == null ? "" : String(value);
  // Quote whenever the field could otherwise be misread — comma, quote, or newline.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Public endpoint, same reasoning as /api/signals — no auth gate. Same query params as
// /api/signals (windowDays/minAgree/minUsd/buysOnly/sortBy); no params = same defaults as the
// dashboard.
export async function GET(request: NextRequest) {
  const query = parseSignalsQueryParams(request.nextUrl.searchParams);
  const signals = await getFilteredSignals(query);

  const lines = [COLUMNS.join(",")];
  for (const s of signals) {
    lines.push(
      COLUMNS.map((col) => {
        switch (col) {
          case "ticker":
            return csvField(s.ticker);
          case "companyName":
            return csvField(s.companyName);
          case "industry":
            return csvField(s.industry);
          case "signalScore":
            return csvField(s.signalScore);
          case "leadSide":
            return csvField(s.leadSide);
          case "leadCount":
            return csvField(s.leadCount);
          case "totalParticipants":
            return csvField(s.totalParticipants);
          case "totalValueUsd":
            return csvField(Math.round(s.totalValueAll));
          case "consensusSince":
            return csvField(s.consensusSince);
        }
      }).join(",")
    );
  }

  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="insideralign-signals.csv"`,
    },
  });
}
