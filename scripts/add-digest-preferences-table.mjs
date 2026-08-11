// One-time schema change: adds the digest_preferences table backing the opt-in daily/weekly
// digest email (curated top signals) — presence of a row = opted in at that frequency, no row =
// off. Run with: node --env-file=.env.local scripts/add-digest-preferences-table.mjs
import { createClient } from "@libsql/client";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL) {
  console.error("TURSO_DATABASE_URL fehlt. Beispiel:");
  console.error("  node --env-file=.env.local scripts/add-digest-preferences-table.mjs");
  process.exit(1);
}

const client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });

await client.execute(`CREATE TABLE IF NOT EXISTS digest_preferences (
  clerk_user_id TEXT PRIMARY KEY,
  frequency TEXT NOT NULL,
  last_sent_at INTEGER
)`);

console.log("digest_preferences bereit.");
