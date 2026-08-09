import { NextRequest, NextResponse } from "next/server";
import { getInsiderDetail } from "@/lib/insiderDetail";

// Public endpoint, same reasoning as /api/signals and /api/ticker-detail — no auth gate.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ticker = params.get("ticker");
  const filerId = params.get("filerId");
  if (!ticker || !filerId) {
    return NextResponse.json({ error: "ticker oder filerId fehlt" }, { status: 400 });
  }

  const detail = await getInsiderDetail(ticker, filerId);
  if (!detail) {
    return NextResponse.json({ error: "Kein Insider mit dieser ID für diesen Ticker gefunden" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
