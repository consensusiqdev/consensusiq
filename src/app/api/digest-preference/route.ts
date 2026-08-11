import { NextRequest, NextResponse } from "next/server";
import { clearDigestPreference, getDigestPreference, setDigestPreference, type DigestFrequency } from "@/lib/db";
import { getActiveSubscriberId } from "@/lib/subscription";

const VALID_FREQUENCIES: DigestFrequency[] = ["daily", "weekly"];

export async function GET() {
  const userId = await getActiveSubscriberId();
  if (!userId) {
    return NextResponse.json({ error: "Kein aktives Abo" }, { status: 402 });
  }
  return NextResponse.json({ preference: await getDigestPreference(userId) });
}

export async function POST(request: NextRequest) {
  const userId = await getActiveSubscriberId();
  if (!userId) {
    return NextResponse.json({ error: "Kein aktives Abo" }, { status: 402 });
  }

  const body = await request.json().catch(() => null);
  const frequency = body?.frequency;
  if (!VALID_FREQUENCIES.includes(frequency)) {
    return NextResponse.json({ error: "frequency muss 'daily' oder 'weekly' sein" }, { status: 400 });
  }

  await setDigestPreference(userId, frequency);
  return NextResponse.json({ preference: await getDigestPreference(userId) });
}

export async function DELETE() {
  const userId = await getActiveSubscriberId();
  if (!userId) {
    return NextResponse.json({ error: "Kein aktives Abo" }, { status: 402 });
  }

  await clearDigestPreference(userId);
  return NextResponse.json({ preference: null });
}
