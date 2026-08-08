// One-time migration: copies data/consensusiq.db (local node:sqlite) into a Turso database.
// Run with: node --env-file=.env.local scripts/migrate-to-turso.mjs
// Safe to re-run — every write uses INSERT OR IGNORE against the same unique constraints the
// live schema already has, so it never double-inserts or regresses a row.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createClient } from "@libsql/client";

const DB_PATH = join(process.cwd(), "data", "consensusiq.db");
const BATCH_SIZE = 150;

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL) {
  console.error("TURSO_DATABASE_URL fehlt. Beispiel:");
  console.error("  node --env-file=.env.local scripts/migrate-to-turso.mjs");
  process.exit(1);
}

const client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });
const local = new DatabaseSync(DB_PATH, { readOnly: true });

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL UNIQUE,
    filer_type TEXT NOT NULL,
    filer_id TEXT NOT NULL,
    filer_name TEXT NOT NULL,
    filer_role TEXT,
    ticker TEXT NOT NULL,
    company_name TEXT NOT NULL,
    side TEXT NOT NULL,
    transaction_code TEXT,
    shares REAL,
    price_per_share REAL,
    value_usd REAL,
    shares_owned_after REAL,
    transaction_date TEXT NOT NULL,
    filed_date TEXT NOT NULL,
    source_url TEXT NOT NULL,
    ingested_at INTEGER NOT NULL,
    near_offering INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_ticker ON transactions (ticker, filed_date)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_filer ON transactions (filer_id, ticker)`,
  `CREATE TABLE IF NOT EXISTS subscriptions (
    clerk_user_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    lemonsqueezy_subscription_id TEXT,
    renews_at INTEGER,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clerk_user_id TEXT NOT NULL,
    ticker TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(clerk_user_id, ticker)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_watchlist_ticker ON watchlist (ticker)`,
  `CREATE TABLE IF NOT EXISTS ticker_metadata (
    ticker TEXT PRIMARY KEY,
    sic_code TEXT,
    industry TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS institutional_holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fund_cik TEXT NOT NULL,
    fund_name TEXT NOT NULL,
    cusip TEXT NOT NULL,
    ticker TEXT,
    issuer_name TEXT NOT NULL,
    quarter TEXT NOT NULL,
    shares REAL,
    value_usd REAL,
    filed_date TEXT NOT NULL,
    source_url TEXT NOT NULL,
    ingested_at INTEGER NOT NULL,
    UNIQUE(fund_cik, cusip, quarter)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_institutional_ticker ON institutional_holdings (ticker, quarter)`,
  `CREATE TABLE IF NOT EXISTS tweeted_signals (
    ticker TEXT PRIMARY KEY,
    lead_count INTEGER NOT NULL,
    tweeted_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS insider_positions (
    ticker TEXT NOT NULL,
    filer_id TEXT NOT NULL,
    filer_name TEXT NOT NULL,
    filer_role TEXT,
    shares REAL,
    as_of_date TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_url TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (ticker, filer_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_insider_positions_ticker ON insider_positions (ticker, shares DESC)`,
  `CREATE TABLE IF NOT EXISTS insider_backfill_status (
    ticker TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    completed_at INTEGER,
    processed_count INTEGER NOT NULL DEFAULT 0
  )`,
];

// [table name, INSERT OR IGNORE statement, ordered column list matching a `SELECT col, col, ... FROM table`]
const TABLES = [
  {
    name: "transactions",
    columns: [
      "source_id", "filer_type", "filer_id", "filer_name", "filer_role", "ticker", "company_name",
      "side", "transaction_code", "shares", "price_per_share", "value_usd", "shares_owned_after",
      "transaction_date", "filed_date", "source_url", "ingested_at", "near_offering",
    ],
  },
  { name: "subscriptions", columns: ["clerk_user_id", "status", "lemonsqueezy_subscription_id", "renews_at", "updated_at"] },
  { name: "watchlist", columns: ["clerk_user_id", "ticker", "created_at"] },
  { name: "ticker_metadata", columns: ["ticker", "sic_code", "industry", "updated_at"] },
  {
    name: "institutional_holdings",
    columns: [
      "fund_cik", "fund_name", "cusip", "ticker", "issuer_name", "quarter", "shares", "value_usd",
      "filed_date", "source_url", "ingested_at",
    ],
  },
  { name: "tweeted_signals", columns: ["ticker", "lead_count", "tweeted_at"] },
  {
    name: "insider_positions",
    columns: ["ticker", "filer_id", "filer_name", "filer_role", "shares", "as_of_date", "source_type", "source_url", "updated_at"],
  },
  { name: "insider_backfill_status", columns: ["ticker", "status", "completed_at"] },
];

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function bootstrapSchema() {
  await client.batch(
    SCHEMA_STATEMENTS.map((sql) => ({ sql, args: [] })),
    "write"
  );
  console.log(`Schema bootstrapped (${SCHEMA_STATEMENTS.length} statements).`);
}

async function migrateTable(table) {
  const cols = table.columns.join(", ");
  const rows = local.prepare(`SELECT ${cols} FROM ${table.name}`).all();
  const placeholders = table.columns.map(() => "?").join(", ");
  const insertSql = `INSERT OR IGNORE INTO ${table.name} (${cols}) VALUES (${placeholders})`;

  let inserted = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const results = await client.batch(
      batch.map((row) => ({ sql: insertSql, args: table.columns.map((c) => row[c] ?? null) })),
      "write"
    );
    inserted += results.reduce((sum, r) => sum + (r.rowsAffected > 0 ? 1 : 0), 0);
  }

  const destCount = await client.execute(`SELECT COUNT(*) as c FROM ${table.name}`);
  console.log(
    `${table.name}: source=${rows.length} turso=${Number(destCount.rows[0].c)} (${inserted} neu eingefügt)`
  );
}

async function main() {
  console.log(`Migriere ${DB_PATH} -> ${TURSO_DATABASE_URL}`);
  await bootstrapSchema();
  for (const table of TABLES) {
    await migrateTable(table);
  }
  local.close();
  console.log("Fertig.");
}

main().catch((err) => {
  console.error("Migration fehlgeschlagen:", err);
  process.exit(1);
});
