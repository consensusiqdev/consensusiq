// One-time schema change: adds the saved_screens + saved_screen_seen_tickers tables backing the
// "saved screens with alerts" feature (a subscriber saves a filter combination, gets emailed when
// a ticker newly matches it — not just single-ticker watchlist alerts).
// Run with: node --env-file=.env.local scripts/add-saved-screens-tables.mjs
import { createClient } from "@libsql/client";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL) {
  console.error("TURSO_DATABASE_URL fehlt. Beispiel:");
  console.error("  node --env-file=.env.local scripts/add-saved-screens-tables.mjs");
  process.exit(1);
}

const client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });

await client.execute(`CREATE TABLE IF NOT EXISTS saved_screens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clerk_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  window_days INTEGER NOT NULL,
  min_agree INTEGER NOT NULL,
  min_usd REAL NOT NULL,
  buys_only INTEGER NOT NULL,
  industry TEXT,
  created_at INTEGER NOT NULL
)`);

await client.execute(`CREATE TABLE IF NOT EXISTS saved_screen_seen_tickers (
  screen_id INTEGER NOT NULL,
  ticker TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (screen_id, ticker)
)`);

console.log("saved_screens + saved_screen_seen_tickers bereit.");
