import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { upsertSubscription } from "@/lib/db";

const ACTIVE_STATUSES = new Set(["active", "on_trial"]);

export async function POST(request: NextRequest) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("LEMONSQUEEZY_WEBHOOK_SECRET ist nicht gesetzt.");
    return NextResponse.json({ error: "Webhook nicht konfiguriert" }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-signature") ?? "";
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  const valid =
    expected.length === signature.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

  if (!valid) {
    return NextResponse.json({ error: "Ungültige Signatur" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const eventName: string | undefined = payload?.meta?.event_name;
  const clerkUserId: string | undefined = payload?.meta?.custom_data?.clerk_user_id;
  const attributes = payload?.data?.attributes ?? {};

  // Payment-related events (subscription_payment_success/failed/recovered/refunded) carry a
  // "subscription-invoices" resource in `data`, not the subscription itself — its `status`
  // ("paid"/"pending"/...) is unrelated to subscription status and must not overwrite it.
  const isSubscriptionResource = payload?.data?.type === "subscriptions";
  const isSubscriptionEvent = typeof eventName === "string" && eventName.startsWith("subscription_");

  if (clerkUserId && isSubscriptionEvent && isSubscriptionResource) {
    await upsertSubscription({
      clerkUserId,
      status: ACTIVE_STATUSES.has(attributes.status) ? "active" : "inactive",
      lemonsqueezySubscriptionId: payload.data?.id ? String(payload.data.id) : null,
      renewsAt: attributes.renews_at ? new Date(attributes.renews_at).getTime() : null,
    });
  }

  return NextResponse.json({ received: true });
}
