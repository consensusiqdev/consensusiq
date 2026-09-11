// One-time schema change: adds the ipo_filings table backing the /ipos page — records a genuine
// first-time IPO (a 424B4 filed by a ticker with no prior transaction history; a follow-on
// offering by an already-tracked company is NOT recorded here, see tickerHasTransactions() /
// ipoDiscovery.ts) so the page can list them without re-scanning SEC's cross-company filing feed
// on every request.
//
// Run with: node --env-file=.env.local scripts/add-ipo-filings-table.mjs
import { createClient } from "@libsql/client";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;

if (!TURSO_DATABASE_URL) {
  console.error("TURSO_DATABASE_URL fehlt. Beispiel:");
  console.error("  node --env-file=.env.local scripts/add-ipo-filings-table.mjs");
  process.exit(1);
}

const client = createClient({ url: TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

await client.execute(`CREATE TABLE IF NOT EXISTS ipo_filings (
  ticker TEXT PRIMARY KEY,
  cik TEXT NOT NULL,
  company_name TEXT NOT NULL,
  filed_date TEXT NOT NULL,
  source_url TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL
)`);
await client.execute(`CREATE INDEX IF NOT EXISTS idx_ipo_filings_filed_date ON ipo_filings (filed_date DESC)`);

console.log("ipo_filings bereit.");
