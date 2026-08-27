import { NextRequest, NextResponse } from "next/server";
import { getFilteredSignalsCached, parseSignalsQueryParams } from "@/lib/signalsQuery";
import { fmtSignalScore, fmtUsd } from "@/lib/format";
import { SITE_NAME, SITE_URL } from "@/lib/seo";
import { clientIp, isRateLimited } from "@/lib/rateLimit";

const RATE_LIMIT_PER_MINUTE = 20;

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const FEED_LIMIT = 50;

// Public endpoint — no auth gate, same reasoning as the other read-only signal endpoints. Same
// query params as /api/signals (windowDays/minAgree/minUsd/buysOnly/sortBy) so a subscribed feed
// URL can encode a specific filter combination, same as bookmarking a dashboard URL would.
export async function GET(request: NextRequest) {
  if (isRateLimited(`rss:${clientIp(request)}`, RATE_LIMIT_PER_MINUTE)) {
    return NextResponse.json({ error: "Zu viele Anfragen" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const query = parseSignalsQueryParams(request.nextUrl.searchParams);
  const signals = (await getFilteredSignalsCached(query)).slice(0, FEED_LIMIT);

  const items = signals
    .map((s) => {
      const link = `${SITE_URL}/company/${s.ticker}`;
      const sideLabel = s.leadSide === "BUY" ? "Kauf" : "Verkauf";
      const title = xmlEscape(`${s.ticker} — Signal Score ${fmtSignalScore(s.signalScore)} (${sideLabel})`);
      const description = xmlEscape(
        `${s.companyName}: ${s.leadCount}/${s.totalParticipants} Insider auf der ${sideLabel}-Seite, ` +
          `Signal Score ${fmtSignalScore(s.signalScore)}, ${fmtUsd(s.totalValueAll)} Gesamtvolumen.`
      );
      const pubDate = new Date(s.consensusSince ?? Date.now()).toUTCString();

      return `    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${description}</description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xmlEscape(SITE_NAME)} — Insider-Konsens-Signale</title>
    <link>${SITE_URL}/dashboard</link>
    <description>Aktuelle Insider-Konsenssignale — mehrere Insider kaufen oder verkaufen unabhängig voneinander dieselbe Aktie.</description>
    <language>de-de</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;

  return new NextResponse(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
