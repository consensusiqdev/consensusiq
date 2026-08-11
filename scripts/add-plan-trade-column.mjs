// One-time schema change: adds the is_plan_trade column used to flag Rule 10b5-1 trading-plan
// transactions (see aff10b5One parsing in secEdgar.ts) so they can be excluded from the signal
// score, same treatment as the existing near_offering column.
// Run with: node --env-file=.env.local scripts/add-plan-trade-column.mjs
import { createClient } from "@libsql/client";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL) {
  console.error("TURSO_DATABASE_URL fehlt. Beispiel:");
  console.error("  node --env-file=.env.local scripts/add-plan-trade-column.mjs");
  process.exit(1);
}

const client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });

const columns = await client.execute("PRAGMA table_info(transactions)");
const alreadyExists = columns.rows.some((r) => r.name === "is_plan_trade");

if (alreadyExists) {
  console.log("is_plan_trade existiert bereits — nichts zu tun.");
} else {
  await client.execute("ALTER TABLE transactions ADD COLUMN is_plan_trade INTEGER DEFAULT 0");
  console.log("Spalte is_plan_trade hinzugefügt (Default 0 für alle bestehenden Zeilen).");
}
