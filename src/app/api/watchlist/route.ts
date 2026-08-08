import { NextRequest, NextResponse } from "next/server";
import { addWatchlistEntry, getWatchlistForUser, removeWatchlistEntry } from "@/lib/db";
import { getActiveSubscriberId } from "@/lib/subscription";

export async function GET() {
  const userId = await getActiveSubscriberId();
  if (!userId) {
    return NextResponse.json({ error: "Kein aktives Abo" }, { status: 402 });
  }
  return NextResponse.json({ tickers: await getWatchlistForUser(userId) });
}

export async function POST(request: NextRequest) {
  const userId = await getActiveSubscriberId();
  if (!userId) {
    return NextResponse.json({ error: "Kein aktives Abo" }, { status: 402 });
  }

  const body = await request.json().catch(() => null);
  const ticker = typeof body?.ticker === "string" ? body.ticker.trim() : "";
  if (!ticker) {
    return NextResponse.json({ error: "ticker fehlt" }, { status: 400 });
  }

  await addWatchlistEntry(userId, ticker);
  return NextResponse.json({ tickers: await getWatchlistForUser(userId) });
}

export async function DELETE(request: NextRequest) {
  const userId = await getActiveSubscriberId();
  if (!userId) {
    return NextResponse.json({ error: "Kein aktives Abo" }, { status: 402 });
  }

  const ticker = request.nextUrl.searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "ticker fehlt" }, { status: 400 });
  }

  await removeWatchlistEntry(userId, ticker);
  return NextResponse.json({ tickers: await getWatchlistForUser(userId) });
}
