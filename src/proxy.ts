import { clerkMiddleware } from "@clerk/nextjs/server";

// Only initializes Clerk's auth context for every request — actual access control
// happens per-resource (requireActiveSubscription / getActiveSubscriberId in
// src/lib/subscription.ts), per Clerk's current guidance against path-matching-based
// protection in proxy/middleware.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
