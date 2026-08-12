import { NextRequest, NextResponse } from "next/server";
import { deleteSavedScreen, getSavedScreensForUser } from "@/lib/db";
import { createScreen } from "@/lib/screens";
import { getActiveSubscriberId } from "@/lib/subscription";

export async function GET() {
  const userId = await getActiveSubscriberId();
  if (!userId) {
    return NextResponse.json({ error: "Kein aktives Abo" }, { status: 402 });
  }
  return NextResponse.json({ screens: await getSavedScreensForUser(userId) });
}

export async function POST(request: NextRequest) {
  const userId = await getActiveSubscriberId();
  if (!userId) {
    return NextResponse.json({ error: "Kein aktives Abo" }, { status: 402 });
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  const windowDays = Math.min(90, Math.max(1, parseInt(body?.windowDays, 10) || 14));
  const minAgree = Math.max(1, parseInt(body?.minAgree, 10) || 3);
  const minUsd = Math.max(0, parseFloat(body?.minUsd) || 0);
  const buysOnly = body?.buysOnly === true;
  const cSuiteOnly = body?.cSuiteOnly === true;
  const industry = typeof body?.industry === "string" && body.industry.trim() ? body.industry.trim() : null;

  if (!name) {
    return NextResponse.json({ error: "name fehlt" }, { status: 400 });
  }

  await createScreen(userId, { name, windowDays, minAgree, minUsd, buysOnly, cSuiteOnly, industry });
  return NextResponse.json({ screens: await getSavedScreensForUser(userId) });
}

export async function DELETE(request: NextRequest) {
  const userId = await getActiveSubscriberId();
  if (!userId) {
    return NextResponse.json({ error: "Kein aktives Abo" }, { status: 402 });
  }

  const idParam = request.nextUrl.searchParams.get("id");
  const id = idParam ? parseInt(idParam, 10) : NaN;
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id fehlt" }, { status: 400 });
  }

  await deleteSavedScreen(userId, id);
  return NextResponse.json({ screens: await getSavedScreensForUser(userId) });
}
