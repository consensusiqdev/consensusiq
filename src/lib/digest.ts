import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { getAllDigestPreferences, getSubscriptionStatus, markDigestSent, type DigestPreferenceRow } from "@/lib/db";
import { getFilteredSignals } from "@/lib/signalsQuery";
import { sendDigestEmail } from "@/lib/email";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_N = 5;

function isDue(pref: DigestPreferenceRow, now: number): boolean {
  if (pref.last_sent_at == null) return true;
  const intervalMs = pref.frequency === "weekly" ? 7 * DAY_MS : DAY_MS;
  return now - pref.last_sent_at >= intervalMs;
}

/**
 * Runs on the existing 5-min ingest cron (see cronJobs.ts) — deliberately NOT its own cron
 * schedule, to avoid adding a third external cron-job.org job or risking Vercel Hobby's native
 * cron job-count limit. Instead, every cycle checks each opted-in subscriber's last_sent_at and
 * only actually emails/updates it once the daily/weekly interval has elapsed — a few minutes of
 * slop against the "exact" 24h/7d mark is irrelevant for a digest. Unlike the watchlist/screen
 * alerts, this must run unconditionally every cycle (not just when new transactions landed),
 * since it's a time-based check, not a data-change check.
 */
export async function checkAndSendDigests(): Promise<{ emailsSent: number }> {
  const allPrefs = await getAllDigestPreferences();
  if (allPrefs.length === 0) return { emailsSent: 0 };

  const now = Date.now();
  const duePrefs = allPrefs.filter((p) => isDue(p, now));
  if (duePrefs.length === 0) return { emailsSent: 0 };

  const statusByUser = new Map(
    await Promise.all(duePrefs.map(async (p) => [p.clerk_user_id, await getSubscriptionStatus(p.clerk_user_id)] as const))
  );

  const client = await clerkClient();
  let emailsSent = 0;

  for (const pref of duePrefs) {
    if (statusByUser.get(pref.clerk_user_id) !== "active") continue;

    try {
      const windowDays = pref.frequency === "weekly" ? 7 : 1;
      const signals = await getFilteredSignals({
        windowDays,
        minAgree: 3,
        minUsd: 1000,
        buysOnly: false,
        cSuiteOnly: false,
        sortBy: "score",
      });
      const top = signals.slice(0, TOP_N);

      if (top.length > 0) {
        const user = await client.users.getUser(pref.clerk_user_id);
        const email = user.primaryEmailAddress?.emailAddress;
        if (email) {
          await sendDigestEmail(email, pref.frequency, top);
          emailsSent++;
        }
      }
      // Marks the check as done even with zero matching signals or a missing email — a quiet
      // period just means no email this cycle, not a reason to re-check every 5 minutes until
      // something appears (which would send a stale, oddly-timed digest days later instead).
      await markDigestSent(pref.clerk_user_id, now);
    } catch (err) {
      console.error(`[digest] Konnte Digest für ${pref.clerk_user_id} nicht prüfen/senden:`, err);
    }
  }

  return { emailsSent };
}
