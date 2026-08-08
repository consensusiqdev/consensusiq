import { NextRequest, NextResponse } from "next/server";
import { getInsiderPositions, getInsiderPositionsCount, isBackfillComplete } from "@/lib/db";

const DEFAULT_LIMIT = 5;

// Public endpoint, same reasoning as /api/signals and /api/ticker-detail — no auth gate.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ticker = params.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "ticker fehlt" }, { status: 400 });
  }

  const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(50, Math.max(1, parseInt(params.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));

  const [rows, total, backfillComplete] = await Promise.all([
    getInsiderPositions(ticker, limit, offset),
    getInsiderPositionsCount(ticker),
    isBackfillComplete(ticker),
  ]);

  const positions = rows.map((r) => ({
    filerId: r.filer_id,
    filerName: r.filer_name,
    filerRole: r.filer_role,
    shares: r.shares,
    asOfDate: r.as_of_date,
    sourceType: r.source_type,
    sourceUrl: r.source_url,
  }));

  return NextResponse.json({
    ticker,
    positions,
    total,
    hasMore: offset + positions.length < total,
    backfillComplete,
  });
}
