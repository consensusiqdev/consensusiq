import { NextRequest, NextResponse } from "next/server";
import { addPushSubscription, removePushSubscription } from "@/lib/db";
import { getActiveSubscriberId } from "@/lib/subscription";

/** Same gating as digest-preference/route.ts — push alerts are a delivery channel for the
 * already-subscription-gated watchlist/saved-screen alerts, not a separate free feature. */
export async function POST(request: NextRequest) {
  const userId = await getActiveSubscriberId();
  if (!userId) {
    return NextResponse.json({ error: "Kein aktives Abo" }, { status: 402 });
  }

  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
    return NextResponse.json({ error: "Ungültiges Subscription-Objekt" }, { status: 400 });
  }

  await addPushSubscription(userId, endpoint, p256dh, auth);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const userId = await getActiveSubscriberId();
  if (!userId) {
    return NextResponse.json({ error: "Kein aktives Abo" }, { status: 402 });
  }

  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (typeof endpoint !== "string") {
    return NextResponse.json({ error: "endpoint fehlt" }, { status: 400 });
  }

  // Deliberately doesn't check that this endpoint actually belongs to userId before deleting —
  // an endpoint is an unguessable per-device secret from the push service, knowing it is itself
  // sufficient proof of control over that subscription (same trust model the browser's own
  // PushManager API uses).
  await removePushSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
