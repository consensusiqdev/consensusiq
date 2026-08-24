// One-time schema change: adds the daily_prices table backing the offline Signal-Score-Forschung
// (src/lib/research/ + scripts/sync-prices.mjs + scripts/backtest.mjs).
//
// Wichtig zur Einordnung: diese Tabelle wird von KEINEM Code unter src/app/** gelesen. Sie ist ein
// reiner Analyse-Cache, damit ein Backtest-Lauf nicht bei jedem Durchgang die komplette Kurshistorie
// neu beim Anbieter abholt. Kurse an Nutzer auszuliefern wäre der lizenzpflichtige Fall — hier
// verlässt kein Kurswert die Auswertung. Siehe den Kopfkommentar in src/lib/research/prices.ts.
//
// Run with: node --env-file=.env.local scripts/add-daily-prices-table.mjs
import { createClient } from "@libsql/client";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL) {
  console.error("TURSO_DATABASE_URL fehlt. Beispiel:");
  console.error("  node --env-file=.env.local scripts/add-daily-prices-table.mjs");
  process.exit(1);
}

const client = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });

// (ticker, date) als Primärschlüssel: macht den Re-Sync idempotent (INSERT OR REPLACE) und deckt
// zugleich den einzigen Lesezugriff ab, den der Backtest macht — ganze Serie eines Tickers,
// aufsteigend nach Datum. `provider` bleibt an der Zeile, weil Stooq- und Tiingo-Kurse
// unterschiedlich bereinigt sind (Splits vs. Splits+Dividenden) und ein stillschweigend gemischter
// Bestand die Renditen verfälschen würde, ohne dass man es der Zahl ansieht.
await client.execute(`CREATE TABLE IF NOT EXISTS daily_prices (
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  close REAL NOT NULL,
  provider TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (ticker, date)
)`);

console.log("daily_prices bereit.");
