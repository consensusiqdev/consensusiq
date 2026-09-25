// One-time schema change: adds a standalone index on transactions.filed_date.
//
// The only existing indexes on `transactions` are (ticker, filed_date) and (filer_id, ticker) —
// both lead with a column that getTransactionsSince() (db.ts) never filters on, since it only
// ever does `WHERE filed_date >= ?`. SQLite can't use a composite index whose leading column isn't
// constrained, so every getTransactionsSince() call — which is most of the app's read path:
// /api/signals (uncached, hit on every dashboard load and filter change), the CSV/RSS export, the
// digest/screen/watchlist checks on the 5-min ingest cycle — did a full table scan instead of an
// index range scan. Turso bills "rows read" on rows actually scanned, not rows returned, so this
// was reading the ENTIRE transactions table on every one of those calls; the multi-year historical
// backfill (backfill-form4.mjs) made that table dramatically bigger, and with it this cost.
//
// Run with: node --env-file=.env.local scripts/add-transactions-filed-date-index.mjs
import { createClient } from "@libsql/client";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;

if (!TURSO_DATABASE_URL) {
  console.error("TURSO_DATABASE_URL fehlt. Beispiel:");
  console.error("  node --env-file=.env.local scripts/add-transactions-filed-date-index.mjs");
  process.exit(1);
}

const client = createClient({ url: TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

console.log("Lege Index an — bei der aktuellen Tabellengröße kann das einen Moment dauern...");
await client.execute(`CREATE INDEX IF NOT EXISTS idx_transactions_filed_date ON transactions (filed_date)`);

console.log("idx_transactions_filed_date bereit.");
