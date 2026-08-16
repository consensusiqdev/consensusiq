// One-time schema change: adds the processed_accessions table backing the ingest-cost
// optimization in ingest.ts / insiderPositions.ts — SEC EDGAR's "getcurrent" feed returns the last
// N filings on every poll regardless of how many are actually new since the last poll, and without
// this table every one of those N filings got re-fetched and re-parsed (real CPU, not just wasted
// network) on every 5-min cycle even though the vast majority were already processed. Accession
// numbers are immutable once filed (an amendment gets its own new accession number), so once an
// accession is successfully fetched+parsed+persisted it never needs revisiting.
// Run with: node --env-file=.env.local scripts/add-processed-accessions-table.mjs
import { createClient } from "@libsql/client";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL) {
  console.error("TURSO_DATABASE_URL fehlt. Beispiel:");
  console.error("  node --env-file=.env.local scripts/add-processed-accessions-table.mjs");
  process.exit(1);
}

const client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });

await client.execute(`CREATE TABLE IF NOT EXISTS processed_accessions (
  accession_number TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
)`);

console.log("processed_accessions bereit.");
