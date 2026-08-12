// One-time schema change: adds c_suite_only to saved_screens, so a saved screen can also require
// the new "Nur C-Suite" dashboard filter, not just window/min-agree/min-usd/buys-only/industry.
// Run with: node --env-file=.env.local scripts/add-c-suite-only-to-screens.mjs
import { createClient } from "@libsql/client";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL) {
  console.error("TURSO_DATABASE_URL fehlt. Beispiel:");
  console.error("  node --env-file=.env.local scripts/add-c-suite-only-to-screens.mjs");
  process.exit(1);
}

const client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });

const columns = await client.execute("PRAGMA table_info(saved_screens)");
const alreadyExists = columns.rows.some((r) => r.name === "c_suite_only");

if (alreadyExists) {
  console.log("c_suite_only existiert bereits — nichts zu tun.");
} else {
  await client.execute("ALTER TABLE saved_screens ADD COLUMN c_suite_only INTEGER DEFAULT 0");
  console.log("Spalte c_suite_only zu saved_screens hinzugefügt (Default 0 für alle bestehenden Zeilen).");
}
