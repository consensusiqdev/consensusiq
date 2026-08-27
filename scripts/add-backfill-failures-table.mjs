// One-time schema change: a durable record of which SEC EDGAR filing a historical backfill
// (backfill-positions.mjs, backfill-form4.mjs) failed to fetch, instead of only a console line.
//
// Both backfills advance their per-ticker progress counter past a filing regardless of whether it
// succeeded (see the while-loops in those scripts) — a re-run of the same ticker never revisits a
// filing that already counted as "done". Without a separate record, a bout of SEC EDGAR throttling
// (503/429) that outlasts throttledFetch()'s own retry (see secEdgar.ts) drops that filing for
// good. This table is that record: each script upserts a row per failure, and `--retry-failed`
// retries exactly those rows, independent of the normal ticker walk — useful hours later, once
// SEC has stopped throttling this client.
//
// Run with: node --env-file=.env.local scripts/add-backfill-failures-table.mjs
import { createClient } from "@libsql/client";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;

if (!TURSO_DATABASE_URL) {
  console.error("TURSO_DATABASE_URL fehlt. Beispiel:");
  console.error("  node --env-file=.env.local scripts/add-backfill-failures-table.mjs");
  process.exit(1);
}

const client = createClient({ url: TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

await client.execute(`CREATE TABLE IF NOT EXISTS backfill_failures (
  script TEXT NOT NULL,
  ticker TEXT NOT NULL,
  cik TEXT NOT NULL,
  accession_number TEXT NOT NULL,
  filed_date TEXT,
  form TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  first_failed_at INTEGER NOT NULL,
  last_attempt_at INTEGER NOT NULL,
  resolved_at INTEGER,
  PRIMARY KEY (script, ticker, accession_number)
)`);

console.log("backfill_failures bereit.");
