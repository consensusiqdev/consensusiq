import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { createCheckoutUrl } from "@/lib/lemonsqueezy";

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  if (!email) {
    return NextResponse.json({ error: "Keine E-Mail-Adresse hinterlegt" }, { status: 400 });
  }

  try {
    const url = await createCheckoutUrl(userId, email);
    return NextResponse.json({ url });
  } catch (err) {
    console.error("POST /api/checkout failed:", err);
    const message = err instanceof Error ? err.message : "Unbekannter Fehler";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
