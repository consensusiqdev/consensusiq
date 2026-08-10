import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { runInstitutionalBackfillCycle } from "@/lib/cronJobs";

export const maxDuration = 60;

// Deliberately NOT in vercel.json's schedule — a one-time (per fund) backfill, not a recurring
// job. Trigger manually with `curl -H "Authorization: Bearer $CRON_SECRET" https://insider-align.com/api/cron/institutional-backfill`
// once after deploy; safe to re-run if it times out partway (already-backfilled funds are skipped).
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await runInstitutionalBackfillCycle();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[cron/institutional-backfill] fehlgeschlagen:", err);
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
