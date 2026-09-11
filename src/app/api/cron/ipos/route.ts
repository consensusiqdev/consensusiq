import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { runIpoDiscoveryCycle } from "@/lib/cronJobs";

export const maxDuration = 60;

// Triggered by Vercel's native daily Cron (see vercel.json) — genuine first-time IPOs are rare
// enough that daily is plenty, same reasoning as /api/cron/institutional.
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await runIpoDiscoveryCycle();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[cron/ipos] fehlgeschlagen:", err);
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
