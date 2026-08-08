import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getSubscriptionStatus } from "@/lib/db";

/** For pages: redirects to sign-in / pricing if the current user has no active subscription. */
export async function requireActiveSubscription(): Promise<string> {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }
  if ((await getSubscriptionStatus(userId)) !== "active") {
    redirect("/pricing");
  }
  return userId;
}

/** For API routes: returns the Clerk user id if authenticated with an active subscription, else null. */
export async function getActiveSubscriberId(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  return (await getSubscriptionStatus(userId)) === "active" ? userId : null;
}

/** For the sign-in/sign-up pages: sends already-authenticated visitors somewhere useful
 * instead of Clerk's default silent redirect to "/". */
export async function redirectIfSignedIn(): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  redirect((await getSubscriptionStatus(userId)) === "active" ? "/dashboard" : "/pricing");
}
