import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { runInstitutionalCycle } from "@/lib/cronJobs";

export const maxDuration = 60;

// Triggered by Vercel's native daily Cron (see vercel.json) — the only one of the three loops
// that fits Hobby's once/day cap, since 13F filings are quarterly anyway.
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await runInstitutionalCycle();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[cron/institutional] fehlgeschlagen:", err);
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
