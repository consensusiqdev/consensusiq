// Füllt die daily_prices-Tabelle mit End-of-Day-Kursen für alle getrackten Ticker plus den
// Referenzindex. Voraussetzung für scripts/backtest.mjs.
//
// Läuft ausschließlich lokal/manuell — bewusst kein Cron, keine API-Route: die Kurse sind ein
// internes Forschungsartefakt und sollen keinen Weg in die ausgelieferte App finden (siehe
// Kopfkommentar in src/lib/research/prices.ts).
//
//   node --env-file=.env.local scripts/sync-prices.mjs
//   node --env-file=.env.local scripts/sync-prices.mjs --from 2022-01-01
//   node --env-file=.env.local scripts/sync-prices.mjs --tickers AAPL,MSFT --force
//
// Ohne --force wird pro Ticker nur ab dem letzten bereits gespeicherten Handelstag nachgeladen,
// der Zweitlauf ist also billig. Mit --force wird die volle Historie ab --from neu geholt (nötig
// nach einem Anbieterwechsel oder einem Aktiensplit, der die Altkurse rückwirkend ändert).
import { createClient } from "@libsql/client";
import { BENCHMARK_SYMBOL, DEFAULT_REQUEST_DELAY_MS, fetchDailyCloses, resolveProvider } from "../src/lib/research/prices.ts";

const DEFAULT_FROM = "2021-01-01";
const WRITE_CHUNK_SIZE = 500;

const args = parseArgs(process.argv.slice(2));
const client = createDbClient();
const provider = args.provider ?? resolveProvider();
const from = args.from ?? DEFAULT_FROM;

const tickers = args.tickers ?? (await trackedTickers());
// Der Benchmark ist kein getrackter Ticker, wird aber für jede Überrendite gebraucht.
const symbols = [...new Set([BENCHMARK_SYMBOL, ...tickers])];

console.log(
  `Provider: ${provider} · Zeitraum ab ${from} · ${symbols.length} Symbole${args.force ? " · voller Neuabruf" : ""}`
);
if (provider === "stooq") {
  console.log(
    "Hinweis: Stooq-Kurse sind split-, aber nicht dividendenbereinigt. Für saubere Renditen TIINGO_API_KEY setzen."
  );
}

let written = 0;
const failed = [];

for (const [index, symbol] of symbols.entries()) {
  const start = args.force ? from : maxDate(await lastStoredDate(symbol), from);
  try {
    const bars = await fetchDailyCloses(symbol, { provider, from: start });
    const newBars = args.force ? bars : bars.filter((bar) => bar.date > start);
    await storeBars(symbol, newBars);
    written += newBars.length;
    console.log(`[${index + 1}/${symbols.length}] ${symbol}: ${newBars.length} Handelstage (ab ${start})`);
  } catch (err) {
    // Weiterlaufen statt abbrechen: ein einzelner Ticker ohne Kursdaten (Delisting, Übernahme,
    // Tippfehler in einer alten Meldung) darf einen Lauf über hunderte Symbole nicht kippen. Die
    // Sammelmeldung am Ende ist wichtig — fehlende Kurse fallen im Backtest sonst stillschweigend
    // aus der Stichprobe, und zwar nicht zufällig, sondern bevorzugt bei kleinen Werten.
    failed.push({ symbol, message: err instanceof Error ? err.message : String(err) });
    console.warn(`[${index + 1}/${symbols.length}] ${symbol}: FEHLGESCHLAGEN — ${err instanceof Error ? err.message : err}`);
  }

  if (index < symbols.length - 1) await sleep(DEFAULT_REQUEST_DELAY_MS);
}

console.log(`\nFertig: ${written} Kurszeilen geschrieben.`);
if (failed.length > 0) {
  console.log(`${failed.length} Symbole ohne Kurse:`);
  for (const { symbol, message } of failed) console.log(`  ${symbol} — ${message}`);
}
if (!failed.some((f) => f.symbol === BENCHMARK_SYMBOL)) {
  console.log(`Benchmark ${BENCHMARK_SYMBOL} vorhanden — scripts/backtest.mjs kann laufen.`);
} else {
  console.error(`\nOHNE ${BENCHMARK_SYMBOL} kann der Backtest keine Überrendite rechnen.`);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------

function createDbClient() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.error("TURSO_DATABASE_URL fehlt. Beispiel:");
    console.error("  node --env-file=.env.local scripts/sync-prices.mjs");
    process.exit(1);
  }
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
}

async function trackedTickers() {
  const result = await client.execute("SELECT DISTINCT ticker FROM transactions ORDER BY ticker");
  return result.rows.map((row) => row.ticker);
}

async function lastStoredDate(symbol) {
  const result = await client.execute({
    sql: "SELECT MAX(date) AS max_date FROM daily_prices WHERE ticker = ? AND provider = ?",
    args: [symbol, provider],
  });
  return result.rows[0]?.max_date ?? null;
}

async function storeBars(symbol, bars) {
  const now = Date.now();
  const sql = `INSERT INTO daily_prices (ticker, date, close, provider, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ticker, date) DO UPDATE SET close = excluded.close, provider = excluded.provider, updated_at = excluded.updated_at`;

  for (let i = 0; i < bars.length; i += WRITE_CHUNK_SIZE) {
    const chunk = bars.slice(i, i + WRITE_CHUNK_SIZE);
    await client.batch(
      chunk.map((bar) => ({ sql, args: [symbol, bar.date, bar.close, provider, now] })),
      "write"
    );
  }
}

function maxDate(a, b) {
  if (!a) return b;
  return a > b ? a : b;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const parsed = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") parsed.force = true;
    else if (arg === "--from") parsed.from = argv[++i];
    else if (arg === "--provider") parsed.provider = argv[++i];
    else if (arg === "--tickers") parsed.tickers = argv[++i].split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
    else {
      console.error(`Unbekanntes Argument: ${arg}`);
      process.exit(1);
    }
  }
  if (parsed.provider && parsed.provider !== "stooq" && parsed.provider !== "tiingo") {
    console.error(`--provider muss 'stooq' oder 'tiingo' sein, war: ${parsed.provider}`);
    process.exit(1);
  }
  if (parsed.from && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.from)) {
    console.error(`--from muss ein ISO-Datum sein (YYYY-MM-DD), war: ${parsed.from}`);
    process.exit(1);
  }
  return parsed;
}
