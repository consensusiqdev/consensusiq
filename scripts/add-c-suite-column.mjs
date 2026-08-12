// One-time schema change: adds the is_c_suite column used to flag CEO/CFO/COO/President/Chairman
// trades (parsed from the reporting owner's free-text officerTitle, see isCSuiteTitle() in
// secEdgar.ts) so the dashboard can offer an opt-in "Nur C-Suite" filter.
// Run with: node --env-file=.env.local scripts/add-c-suite-column.mjs
import { createClient } from "@libsql/client";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL) {
  console.error("TURSO_DATABASE_URL fehlt. Beispiel:");
  console.error("  node --env-file=.env.local scripts/add-c-suite-column.mjs");
  process.exit(1);
}

const client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });

const columns = await client.execute("PRAGMA table_info(transactions)");
const alreadyExists = columns.rows.some((r) => r.name === "is_c_suite");

if (alreadyExists) {
  console.log("is_c_suite existiert bereits — nichts zu tun.");
} else {
  await client.execute("ALTER TABLE transactions ADD COLUMN is_c_suite INTEGER DEFAULT 0");
  console.log("Spalte is_c_suite hinzugefügt (Default 0 für alle bestehenden Zeilen).");
}
