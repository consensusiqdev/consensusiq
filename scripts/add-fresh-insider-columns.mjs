// One-time schema change for the "frisch eingestiegen und kauft schon" flag:
//  - transactions.is_fresh_insider: set at ingest time when a BUY's filer first appeared in
//    insider_positions via a Form 3 within FRESH_INSIDER_WINDOW_DAYS before this trade.
//  - insider_positions.first_seen_date / first_seen_source_type: new columns that, unlike the
//    rest of that table, are NEVER overwritten after their first insert (see upsertInsiderPositionSql
//    in db.ts) — they preserve the original first-seen snapshot even as the row's other columns
//    keep advancing to the insider's latest known position.
// Run with: node --env-file=.env.local scripts/add-fresh-insider-columns.mjs
import { createClient } from "@libsql/client";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL) {
  console.error("TURSO_DATABASE_URL fehlt. Beispiel:");
  console.error("  node --env-file=.env.local scripts/add-fresh-insider-columns.mjs");
  process.exit(1);
}

const client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });

async function addColumnIfMissing(table, column, ddl) {
  const columns = await client.execute(`PRAGMA table_info(${table})`);
  const alreadyExists = columns.rows.some((r) => r.name === column);
  if (alreadyExists) {
    console.log(`${table}.${column} existiert bereits — nichts zu tun.`);
  } else {
    await client.execute(ddl);
    console.log(`Spalte ${table}.${column} hinzugefügt.`);
  }
}

await addColumnIfMissing(
  "transactions",
  "is_fresh_insider",
  "ALTER TABLE transactions ADD COLUMN is_fresh_insider INTEGER DEFAULT 0"
);
await addColumnIfMissing(
  "insider_positions",
  "first_seen_date",
  "ALTER TABLE insider_positions ADD COLUMN first_seen_date TEXT"
);
await addColumnIfMissing(
  "insider_positions",
  "first_seen_source_type",
  "ALTER TABLE insider_positions ADD COLUMN first_seen_source_type TEXT"
);
