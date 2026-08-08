import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { runIngestCycle } from "@/lib/cronJobs";

export const maxDuration = 60;

// Triggered externally (cron-job.org, every 5 min) — Vercel Hobby's native cron is capped at
// once/day, too coarse for this. Returns non-2xx on failure so the external scheduler's own
// alerting is a real failure signal (there's no long-lived process left to watch this otherwise).
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await runIngestCycle();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[cron/ingest] fehlgeschlagen:", err);
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
