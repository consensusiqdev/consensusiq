import { NextRequest, NextResponse } from "next/server";
import { getFilteredSignalsCached, parseSignalsQueryParams } from "@/lib/signalsQuery";
import { clientIp, isRateLimited } from "@/lib/rateLimit";

const RATE_LIMIT_PER_MINUTE = 20;

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
  if (isRateLimited(`csv:${clientIp(request)}`, RATE_LIMIT_PER_MINUTE)) {
    return NextResponse.json({ error: "Zu viele Anfragen" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const query = parseSignalsQueryParams(request.nextUrl.searchParams);
  const signals = await getFilteredSignalsCached(query);

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
