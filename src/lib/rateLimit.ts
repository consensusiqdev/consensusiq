import type { NextRequest } from "next/server";

// In-memory, per-instance fixed-window limiter — deliberately not backed by Turso. These guard
// public read endpoints (CSV/RSS export) whose data is already free on the dashboard; a DB write
// on every request would cost more than the cached query it protects. Not distributed: each
// Vercel instance counts independently, so a determined multi-region client could exceed the
// nominal limit. Accepted tradeoff for a low-stakes endpoint, not something guarding auth or
// payment.
const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

// Guards against unbounded growth if the process stays warm across many distinct IPs — a crude
// full clear is fine since the window is only a minute anyway, the map recovers immediately.
const MAX_TRACKED_KEYS = 5000;

/** True if `key` has been called more than `limit` times within the current one-minute window. */
export function isRateLimited(key: string, limit: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  bucket.count++;
  return bucket.count > limit;
}

/** Vercel sets x-forwarded-for; NextRequest no longer exposes .ip directly (removed in Next 15). */
export function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
