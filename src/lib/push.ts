import "server-only";
import webpush from "web-push";
import { getPushSubscriptionsForUsers, removePushSubscription, type PushSubscriptionRow } from "@/lib/db";

// Lazy, not called at module scope: Next.js's build-time "Collecting page data" step evaluates
// route modules (to inspect their config/runtime), which runs top-level code even though the
// route itself never executes — a module-scope webpush.setVapidDetails() call crashed the ENTIRE
// build the moment the VAPID env vars were missing/misconfigured, taking down every route that
// transitively imports this file (e.g. /api/screens), not just push sending. Deliberately
// re-invoked on every send rather than cached behind a boolean: setVapidDetails() itself is cheap
// (no network call, just validates+stores the keys), and re-running it avoids a stale/empty cache
// if this ever runs somewhere env vars can change between calls (e.g. a long-lived dev process).
function ensureVapidConfigured(): void {
  webpush.setVapidDetails(
    // mailto:/https: subject is required by the Web Push protocol so a push service can contact
    // the sender if something's wrong (e.g. sending too aggressively) — using the site URL rather
    // than a mailto since there's no dedicated inbox for this yet (see the Impressum/age-gate notes).
    "https://insider-align.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
}

export type PushPayload = {
  title: string;
  body: string;
  url: string; // opened on notification click, see public/sw.js
};

async function sendToSubscription(sub: PushSubscriptionRow, payload: PushPayload): Promise<void> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
  } catch (err) {
    // 404/410 = the push service itself says this subscription is gone for good (browser
    // uninstalled, permission revoked, endpoint rotated past its old identity, etc.) — stop
    // sending to it. Any other error (network blip, 5xx from the push service) is left alone;
    // it'll just be retried next time an alert fires.
    const statusCode = (err as { statusCode?: number } | null)?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      await removePushSubscription(sub.endpoint).catch(() => {});
    } else {
      console.error(`[push] Zustellung an ${sub.endpoint.slice(0, 60)}… fehlgeschlagen:`, err);
    }
  }
}

/**
 * Sends one push notification to every device a set of users have subscribed on — same "batched
 * per distinct user" shape as the email alert senders (alerts.ts/screens.ts), fanned out in
 * parallel since a dead/slow subscription shouldn't hold up the others. `payloadForUser` is a
 * function (not a single shared payload) so each recipient can get their own title/body/url, e.g.
 * a saved-screen alert naming that user's screen.
 */
export async function sendPushToUsers(
  clerkUserIds: string[],
  payloadForUser: (clerkUserId: string) => PushPayload
): Promise<{ sent: number }> {
  if (clerkUserIds.length === 0) return { sent: 0 };

  const subsByUser = await getPushSubscriptionsForUsers(clerkUserIds);
  // Skip VAPID setup entirely (and the possible throw if the keys are missing/malformed) when
  // nobody in this batch has a subscription anyway — same "don't do the work if there's nothing
  // to send" short-circuit the rest of this function already has via the length checks below.
  if ([...subsByUser.values()].every((subs) => subs.length === 0)) return { sent: 0 };
  ensureVapidConfigured();
  const jobs: Promise<void>[] = [];
  let sent = 0;

  for (const [clerkUserId, subs] of subsByUser) {
    if (subs.length === 0) continue;
    const payload = payloadForUser(clerkUserId);
    for (const sub of subs) {
      sent++;
      jobs.push(sendToSubscription(sub, payload));
    }
  }

  await Promise.all(jobs);
  return { sent };
}
