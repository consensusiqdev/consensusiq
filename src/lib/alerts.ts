import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { getSubscriptionStatus, getWatchersForTicker } from "@/lib/db";
import { sendWatchlistAlertEmail } from "@/lib/email";
import type { Transaction } from "@/types/filing";

/**
 * For each newly-ingested transaction, finds subscribers watching that ticker and emails them
 * one consolidated alert per user per run (not one email per transaction). Only currently-active
 * subscribers are notified — a lapsed subscriber's old watchlist rows stay in the DB but stop
 * triggering emails, so the alert feature stays tied to the paid subscription over time.
 */
export async function sendWatchlistAlerts(newTransactions: Transaction[]): Promise<{ emailsSent: number }> {
  if (newTransactions.length === 0) return { emailsSent: 0 };

  // Fetch watchers per distinct ticker, then check subscription status per distinct user once —
  // avoids re-checking the same user's status per ticker they watch (a real network round trip
  // each, on Turso, unlike the old local-sync-SQLite version of this).
  const distinctTickers = [...new Set(newTransactions.map((t) => t.ticker))];
  const watchersByTicker = new Map(
    await Promise.all(
      distinctTickers.map(async (ticker) => [ticker, await getWatchersForTicker(ticker)] as const)
    )
  );

  const distinctUsers = [...new Set([...watchersByTicker.values()].flat())];
  const statusByUser = new Map(
    await Promise.all(
      distinctUsers.map(async (clerkUserId) => [clerkUserId, await getSubscriptionStatus(clerkUserId)] as const)
    )
  );

  const byUser = new Map<string, Transaction[]>();
  for (const t of newTransactions) {
    for (const clerkUserId of watchersByTicker.get(t.ticker) ?? []) {
      if (statusByUser.get(clerkUserId) !== "active") continue;
      const list = byUser.get(clerkUserId) ?? [];
      list.push(t);
      byUser.set(clerkUserId, list);
    }
  }

  if (byUser.size === 0) return { emailsSent: 0 };

  const client = await clerkClient();
  let emailsSent = 0;

  for (const [clerkUserId, transactions] of byUser) {
    try {
      const user = await client.users.getUser(clerkUserId);
      const email = user.primaryEmailAddress?.emailAddress;
      if (!email) continue;
      await sendWatchlistAlertEmail(email, transactions);
      emailsSent++;
    } catch (err) {
      console.error(`[alerts] Konnte Alert für ${clerkUserId} nicht senden:`, err);
    }
  }

  return { emailsSent };
}
