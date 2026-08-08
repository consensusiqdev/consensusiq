import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";

/**
 * Shared auth check for /api/cron/* routes. Expects `Authorization: Bearer <CRON_SECRET>` — the
 * exact header Vercel's own native Cron sends automatically when CRON_SECRET is set (so it's
 * zero-config for the daily institutional route), and the same header cron-job.org's free tier
 * can set for the externally-triggered 5-min/3-min routes.
 */
export function isAuthorizedCronRequest(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET ist nicht gesetzt.");
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  return (
    expected.length === header.length && timingSafeEqual(Buffer.from(expected), Buffer.from(header))
  );
}
