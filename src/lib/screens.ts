import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import {
  createSavedScreen,
  deleteSavedScreen,
  getAllSavedScreens,
  getSavedScreensForUser,
  getSeenTickersForScreen,
  getSubscriptionStatus,
  markTickersSeenForScreen,
  type SavedScreenCriteria,
  type SavedScreenRow,
} from "@/lib/db";
import { getFilteredSignals } from "@/lib/signalsQuery";
import { sendScreenAlertEmail } from "@/lib/email";
import { sendPushToUsers } from "@/lib/push";
import type { TickerSignal } from "@/types/filing";

export type { SavedScreenRow };

async function matchingSignalsForScreen(row: {
  window_days: number;
  min_agree: number;
  min_usd: number;
  buys_only: number;
  c_suite_only: number;
  industry: string | null;
}): Promise<TickerSignal[]> {
  const signals = await getFilteredSignals({
    windowDays: row.window_days,
    minAgree: row.min_agree,
    minUsd: row.min_usd,
    buysOnly: row.buys_only === 1,
    cSuiteOnly: row.c_suite_only === 1,
    sortBy: "score",
  });
  return row.industry ? signals.filter((s) => s.industry === row.industry) : signals;
}

/** Creates a screen and immediately seeds it with whatever currently matches, so the next ingest
 * cron check only ever alerts on genuinely NEW entries — not the screen's entire starting list. */
export async function createScreen(clerkUserId: string, criteria: SavedScreenCriteria): Promise<number> {
  const screenId = await createSavedScreen(clerkUserId, criteria);
  const initialMatches = await matchingSignalsForScreen({
    window_days: criteria.windowDays,
    min_agree: criteria.minAgree,
    min_usd: criteria.minUsd,
    buys_only: criteria.buysOnly ? 1 : 0,
    c_suite_only: criteria.cSuiteOnly ? 1 : 0,
    industry: criteria.industry,
  });
  await markTickersSeenForScreen(
    screenId,
    initialMatches.map((s) => s.ticker)
  );
  return screenId;
}

export { getSavedScreensForUser, deleteSavedScreen };

/**
 * Runs on the ingest cron cycle (see cronJobs.ts), right after the watchlist alert check: for
 * every saved screen belonging to a currently-active subscriber, checks for tickers that newly
 * match the screen's criteria and weren't seen before, and emails one consolidated alert per
 * screen if any are found. Same "check subscription once per distinct user" batching as
 * sendWatchlistAlerts() in alerts.ts.
 */
export async function checkSavedScreensAndAlert(): Promise<{ emailsSent: number; pushSent: number }> {
  const allScreens = await getAllSavedScreens();
  if (allScreens.length === 0) return { emailsSent: 0, pushSent: 0 };

  const distinctUsers = [...new Set(allScreens.map((s) => s.clerk_user_id))];
  const statusByUser = new Map(
    await Promise.all(distinctUsers.map(async (id) => [id, await getSubscriptionStatus(id)] as const))
  );
  const activeScreens = allScreens.filter((s) => statusByUser.get(s.clerk_user_id) === "active");
  if (activeScreens.length === 0) return { emailsSent: 0, pushSent: 0 };

  const client = await clerkClient();
  let emailsSent = 0;
  // One push payload per (user, screen) pair that actually got new matches this cycle — a user
  // with two screens that both matched gets two separate notifications, same as they'd get two
  // separate emails, one per screen.
  const pushJobs: { clerkUserId: string; payload: { title: string; body: string; url: string } }[] = [];

  for (const screen of activeScreens) {
    try {
      const [matches, seen] = await Promise.all([matchingSignalsForScreen(screen), getSeenTickersForScreen(screen.id)]);
      const newMatches = matches.filter((s) => !seen.has(s.ticker));
      if (newMatches.length === 0) continue;

      const user = await client.users.getUser(screen.clerk_user_id);
      const email = user.primaryEmailAddress?.emailAddress;
      if (email) {
        await sendScreenAlertEmail(email, screen.name, newMatches);
        emailsSent++;
      }

      const tickers = newMatches.map((s) => s.ticker);
      pushJobs.push({
        clerkUserId: screen.clerk_user_id,
        payload: {
          title: `Screen „${screen.name}“`,
          body:
            tickers.length === 1
              ? `Neuer Treffer: ${tickers[0]}`
              : `${tickers.length} neue Treffer: ${tickers.slice(0, 4).join(", ")}${tickers.length > 4 ? "…" : ""}`,
          url: tickers.length === 1 ? `/company/${tickers[0]}` : "/dashboard",
        },
      });

      await markTickersSeenForScreen(screen.id, tickers);
    } catch (err) {
      console.error(`[screens] Screen "${screen.name}" (${screen.id}) konnte nicht geprüft werden:`, err);
    }
  }

  // Own try/catch, same reasoning as alerts.ts — push is additive, never blocks the email path.
  let pushSent = 0;
  try {
    // sendPushToUsers dedupes by user internally via getPushSubscriptionsForUsers, but here the
    // SAME user can legitimately appear twice (two screens matched) wanting DIFFERENT payloads —
    // so each job is sent as its own one-user call rather than batching by clerkUserId.
    const results = await Promise.all(
      pushJobs.map((job) => sendPushToUsers([job.clerkUserId], () => job.payload))
    );
    pushSent = results.reduce((sum, r) => sum + r.sent, 0);
  } catch (err) {
    console.error("[screens] Push-Versand fehlgeschlagen:", err);
  }

  return { emailsSent, pushSent };
}
