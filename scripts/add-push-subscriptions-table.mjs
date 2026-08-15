// One-time schema change: adds the push_subscriptions table backing Web Push alerts (real-time
// browser/OS notifications for watchlist + saved-screen matches, in addition to the existing
// email alerts — see src/lib/push.ts). endpoint is the primary key since it's globally unique per
// browser/device subscription; one clerk_user_id can have several rows (multiple devices).
// Run with: node --env-file=.env.local scripts/add-push-subscriptions-table.mjs
import { createClient } from "@libsql/client";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL) {
  console.error("TURSO_DATABASE_URL fehlt. Beispiel:");
  console.error("  node --env-file=.env.local scripts/add-push-subscriptions-table.mjs");
  process.exit(1);
}

const client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });

await client.execute(`CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);

console.log("push_subscriptions bereit.");
