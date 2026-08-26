// One-time schema change: marks which `transactions` rows came from the historical Form 4 backfill
// (scripts/backfill-form4.mjs) rather than from the live ingest.
//
// This exists for one specific reason. SEC's `aff10b5One` checkbox — the source of `is_plan_trade`
// — only became mandatory with the 2023 insider-trading-arrangements rule. Backfilled filings from
// before that carry no such flag, so they land as "no plan trade" whether or not one existed. The
// Signal Score EXCLUDES plan trades, so a backtest run over that period would be scoring signals
// the live app would never have produced, and nothing about the numbers would look wrong.
//
// The marker lets the backtest scope itself to rows whose flags are actually trustworthy instead of
// silently mixing the two. See src/lib/research/BACKFILL.md.
//
// Run with: node --env-file=.env.local scripts/add-backfilled-column.mjs
import { createClient } from "@libsql/client";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL) {
  console.error("TURSO_DATABASE_URL fehlt. Beispiel:");
  console.error("  node --env-file=.env.local scripts/add-backfilled-column.mjs");
  process.exit(1);
}

const client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });

// Existing rows all came from the live ingest, so the 0 default is already correct for them.
try {
  await client.execute(`ALTER TABLE transactions ADD COLUMN backfilled INTEGER NOT NULL DEFAULT 0`);
  console.log("Spalte transactions.backfilled angelegt.");
} catch (err) {
  if (String(err).includes("duplicate column name")) {
    console.log("Spalte transactions.backfilled existiert bereits — nichts zu tun.");
  } else {
    throw err;
  }
}

// The backfill walks one ticker at a time and has to survive interruption over a multi-hour run.
await client.execute(`CREATE TABLE IF NOT EXISTS form4_backfill_status (
  ticker TEXT PRIMARY KEY,
  filings_total INTEGER NOT NULL DEFAULT 0,
  filings_done INTEGER NOT NULL DEFAULT 0,
  transactions_written INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER
)`);

console.log("form4_backfill_status bereit.");
