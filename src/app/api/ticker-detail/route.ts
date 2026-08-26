import { NextRequest, NextResponse } from "next/server";
import { getTickerDetail } from "@/lib/tickerDetail";
import { getActiveSubscriberId } from "@/lib/subscription";

// Public endpoint — see /api/signals/route.ts for the same note (subscription is checked only
// to gate the premium prior-acquisition enrichment, never to block access).
export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "ticker fehlt" }, { status: 400 });
  }

  const isSubscriber = Boolean(await getActiveSubscriberId());
  const detail = await getTickerDetail(ticker, isSubscriber);
  return NextResponse.json(detail);
}
