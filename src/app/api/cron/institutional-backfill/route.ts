import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { runInstitutionalBackfillCycle } from "@/lib/cronJobs";

export const maxDuration = 60;

// Deliberately NOT in vercel.json's schedule — a one-time backfill, one fund per call (a large
// fund's OpenFIGI CUSIP resolution alone can approach the time budget), not a recurring job.
// Trigger manually and repeatedly, once per fund: `curl -H "Authorization: Bearer $CRON_SECRET" https://www.insider-align.com/api/cron/institutional-backfill`
// — response's `fund` is null once every fund has a diffable baseline. Use the `www.` host
// directly: the apex domain 308-redirects there, and curl (and most HTTP clients) drop the
// Authorization header across a cross-host redirect by default.
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runInstitutionalBackfillCycle();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/institutional-backfill] fehlgeschlagen:", err);
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
