import { NextRequest, NextResponse } from "next/server";
import { getTickerDetail } from "@/lib/tickerDetail";

// Public endpoint — see /api/signals/route.ts for the same note (subscription is checked only
// to gate the premium prior-acquisition enrichment, never to block access).
export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "ticker fehlt" }, { status: 400 });
  }

  const detail = await getTickerDetail(ticker);
  return NextResponse.json(detail);
}
