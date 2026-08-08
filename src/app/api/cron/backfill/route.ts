import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { runBackfillCycle } from "@/lib/cronJobs";

export const maxDuration = 60;

// Triggered externally (cron-job.org, every 3 min) — same reasoning as /api/cron/ingest.
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runBackfillCycle();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/backfill] fehlgeschlagen:", err);
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
