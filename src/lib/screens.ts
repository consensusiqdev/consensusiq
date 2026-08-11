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
import type { TickerSignal } from "@/types/filing";

export type { SavedScreenRow };

async function matchingSignalsForScreen(row: {
  window_days: number;
  min_agree: number;
  min_usd: number;
  buys_only: number;
  industry: string | null;
}): Promise<TickerSignal[]> {
  const signals = await getFilteredSignals({
    windowDays: row.window_days,
    minAgree: row.min_agree,
    minUsd: row.min_usd,
    buysOnly: row.buys_only === 1,
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
export async function checkSavedScreensAndAlert(): Promise<{ emailsSent: number }> {
  const allScreens = await getAllSavedScreens();
  if (allScreens.length === 0) return { emailsSent: 0 };

  const distinctUsers = [...new Set(allScreens.map((s) => s.clerk_user_id))];
  const statusByUser = new Map(
    await Promise.all(distinctUsers.map(async (id) => [id, await getSubscriptionStatus(id)] as const))
  );
  const activeScreens = allScreens.filter((s) => statusByUser.get(s.clerk_user_id) === "active");
  if (activeScreens.length === 0) return { emailsSent: 0 };

  const client = await clerkClient();
  let emailsSent = 0;

  for (const screen of activeScreens) {
    try {
      const [matches, seen] = await Promise.all([matchingSignalsForScreen(screen), getSeenTickersForScreen(screen.id)]);
      const newMatches = matches.filter((s) => !seen.has(s.ticker));
      if (newMatches.length === 0) continue;

      const user = await client.users.getUser(screen.clerk_user_id);
      const email = user.primaryEmailAddress?.emailAddress;
      if (!email) continue;

      await sendScreenAlertEmail(email, screen.name, newMatches);
      await markTickersSeenForScreen(
        screen.id,
        newMatches.map((s) => s.ticker)
      );
      emailsSent++;
    } catch (err) {
      console.error(`[screens] Screen "${screen.name}" (${screen.id}) konnte nicht geprüft werden:`, err);
    }
  }

  return { emailsSent };
}
