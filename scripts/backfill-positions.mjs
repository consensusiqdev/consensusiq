// Historischer Insider-Positions-Nachlauf: arbeitet für jeden getrackten Ticker die komplette
// Form-3/4/5-Historie ab und schreibt sie nach `insider_positions` — also "wer hält wie viele
// Aktien", die Grundlage der Insider-Liste auf der Unternehmensseite.
//
// Das macht bisher der Cron unter /api/cron/backfill, in Häppchen von 15 Meldungen alle paar
// Minuten. Für die Erstbefüllung ist das der falsche Weg: es zieht sich über Wochen und kostet für
// jeden Anstoß eine Vercel-Invocation. Dieses Skript zieht dieselbe Arbeit lokal an einem Stück
// durch. Danach bleibt dem Cron nur noch, was er gut kann — neu auftauchende Ticker und
// fortlaufende Änderungen.
//
//   node --env-file=.env.local scripts/backfill-positions.mjs
//   node --env-file=.env.local scripts/backfill-positions.mjs --tickers AAPL,MSFT
//   node --env-file=.env.local scripts/backfill-positions.mjs --limit 20
//
// Teilt sich die Fortschritts-Tabelle `insider_backfill_status` mit dem Cron: was hier auf 'done'
// gesetzt wird, überspringt der Cron anschließend (siehe getNextBackfillTicker() in db.ts). Beide
// treten sich also nicht auf die Füße, egal wer zuerst dran war.
//
// Abbruch mit Strg-C ist jederzeit sicher — der Fortschritt steht je Ticker in derselben Tabelle.
import { createClient } from "@libsql/client";

// Wie in backfill-form4.mjs: secEdgar.ts wirft schon beim Laden ohne SEC_EDGAR_USER_AGENT, und
// `import` läuft vor jedem Code hier. Erst prüfen, dann dynamisch nachladen.
requireEnv();
const { fetchFilingsByForm, fetchOwnershipPosition } = await import("../src/lib/secEdgar.ts");

const PROGRESS_CHUNK_SIZE = 15; // wie der Cron: Fortschritt regelmäßig sichern, Abbruch kostet wenig

const args = parseArgs(process.argv.slice(2));
const client = createDbClient();

const tickers = args.tickers ?? (await trackedTickers());
console.log(`Positions-Nachlauf · ${tickers.length} Ticker` + (args.limit ? ` · max. ${args.limit} in diesem Lauf` : ""));
console.log("Abbruch mit Strg-C ist sicher — der Fortschritt wird je Ticker gespeichert.\n");

let tickersDone = 0;
let totalPositions = 0;
let totalRepaired = 0;
const started = Date.now();

for (const ticker of tickers) {
  if (args.limit && tickersDone >= args.limit) {
    console.log(`\n--limit ${args.limit} erreicht — Rest bleibt für den nächsten Lauf.`);
    break;
  }

  const status = await getStatus(ticker);
  if (status?.status === "done" && !args.force) continue;

  try {
    const { positions, repaired } = await backfillTicker(ticker, status?.processed_count ?? 0);
    totalPositions += positions;
    totalRepaired += repaired;
  } catch (err) {
    // Ein kaputter Ticker darf einen Lauf über hunderte nicht kippen — er bleibt offen und wird
    // beim nächsten Lauf (oder vom Cron) erneut versucht.
    console.warn(`  ${ticker}: FEHLGESCHLAGEN — ${err instanceof Error ? err.message : err}`);
  }
  tickersDone++;
}

const minutes = Math.round((Date.now() - started) / 60000);
console.log(`\nFertig: ${tickersDone} Ticker, ${totalPositions} Positionen geschrieben (${minutes} min).`);
if (totalRepaired > 0) {
  console.log(`${totalRepaired} Ersterfassungs-Daten korrigiert — siehe Hinweis unten.`);
}
const open = await countOpenTickers();
console.log(
  open === 0
    ? "Alle getrackten Ticker sind nachgeladen. Der Cron holt ab jetzt nur noch Neuzugänge."
    : `${open} Ticker noch offen — Skript einfach erneut starten, es macht dort weiter.`
);

// ---------------------------------------------------------------------------

async function backfillTicker(ticker, alreadyDone) {
  // `deep` folgt SECs ausgelagerten älteren Filing-Seiten. Der Cron verzichtet bewusst darauf (er
  // will nur den aktuellen Stand je Insider); für die Erstbefüllung ist genau die Tiefe der Punkt.
  const filings = (await fetchFilingsByForm(ticker, ["3", "4", "5"], { deep: true }))
    // Älteste zuerst: entscheidend für first_seen_date weiter unten — die erste Meldung, die wir
    // je Person sehen, muss ihre früheste sein.
    .sort((a, b) => a.filedDate.localeCompare(b.filedDate));

  if (filings.length === 0) {
    await markDone(ticker);
    console.log(`  ${ticker}: keine Form-3/4/5-Meldungen`);
    return { positions: 0, repaired: 0 };
  }

  let done = Math.min(alreadyDone, filings.length);
  let positions = 0;
  let repaired = 0;
  const resumeNote = done > 0 ? ` (Wiederaufnahme bei ${done})` : "";
  process.stdout.write(`  ${ticker}: ${filings.length} Meldungen${resumeNote} … `);

  while (done < filings.length) {
    const chunk = filings.slice(done, done + PROGRESS_CHUNK_SIZE);
    for (const filing of chunk) {
      try {
        const position = await fetchOwnershipPosition(filing.cik, filing.accessionNumber);
        if (!position) continue;
        const sourceType = sourceTypeForForm(filing.form);
        await upsertPosition(position, sourceType);
        if (await repairFirstSeen(position, sourceType)) repaired++;
        positions++;
      } catch (err) {
        console.warn(`\n    ${ticker} ${filing.accessionNumber}: ${err instanceof Error ? err.message : err}`);
      }
    }
    done += chunk.length;
    await saveProgress(ticker, done);
    process.stdout.write(".");
  }

  await markDone(ticker);
  console.log(` ${positions} Positionen${repaired > 0 ? `, ${repaired} korrigiert` : ""}`);
  return { positions, repaired };
}

function sourceTypeForForm(form) {
  if (form === "3") return "FORM3";
  if (form === "5") return "FORM5";
  return "FORM4";
}

/** Identisch zu upsertInsiderPosition() in db.ts — dieselben Spalten, dieselbe Bedingung. db.ts
 * selbst ist `server-only` und aus einem Skript nicht ladbar. */
async function upsertPosition(position, sourceType) {
  await client.execute({
    sql: `INSERT INTO insider_positions
            (ticker, filer_id, filer_name, filer_role, shares, as_of_date, source_type, source_url,
             updated_at, first_seen_date, first_seen_source_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(ticker, filer_id) DO UPDATE SET
            filer_name = excluded.filer_name,
            filer_role = excluded.filer_role,
            shares = excluded.shares,
            as_of_date = excluded.as_of_date,
            source_type = excluded.source_type,
            source_url = excluded.source_url,
            updated_at = excluded.updated_at
          WHERE excluded.as_of_date >= insider_positions.as_of_date`,
    args: [
      position.ticker,
      position.filerId,
      position.filerName,
      position.filerRole ?? null,
      position.shares,
      position.asOfDate,
      sourceType,
      position.sourceUrl,
      Date.now(),
      position.asOfDate,
      sourceType,
    ],
  });
}

/**
 * Setzt `first_seen_date` auf die früheste tatsächlich bekannte Meldung.
 *
 * Der Upsert oben lässt die Spalte bewusst unangetastet — sie wird nur beim allerersten INSERT
 * geschrieben. Im laufenden Betrieb ist das richtig. Für die Erstbefüllung ist es falsch: Insider,
 * die der Live-Ingest schon über eine aktuelle Form 4 kennt, tragen als "erstmals gesehen" das
 * Ingest-Datum, und ihre echte, Jahre ältere Form 3 würde das nie korrigieren. Dieses Skript ist
 * das einzige, das die vollständige Historie sieht — also korrigiert es hier, und zwar nur nach
 * unten (`>` in der Bedingung), damit ein späterer Lauf nichts wieder verschlechtert.
 *
 * Betrifft das "frisch eingestiegen"-Badge; der Signal Score liest die Spalte nicht.
 */
async function repairFirstSeen(position, sourceType) {
  const result = await client.execute({
    sql: `UPDATE insider_positions
             SET first_seen_date = ?, first_seen_source_type = ?
           WHERE ticker = ? AND filer_id = ?
             AND (first_seen_date IS NULL OR first_seen_date > ?)`,
    args: [position.asOfDate, sourceType, position.ticker, position.filerId, position.asOfDate],
  });
  return result.rowsAffected > 0;
}

// ---------------------------------------------------------------------------

function requireEnv() {
  const missing = ["TURSO_DATABASE_URL", "SEC_EDGAR_USER_AGENT"].filter((k) => !process.env[k]);
  if (missing.length === 0) return;
  console.error(`Fehlende Umgebungsvariablen: ${missing.join(", ")}`);
  console.error('SEC verlangt einen identifizierenden User-Agent, Format: "AppName (kontakt@domain.tld)".');
  console.error("Beispiel:");
  console.error("  node --env-file=.env.local scripts/backfill-positions.mjs");
  process.exit(1);
}

function createDbClient() {
  return createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
}

async function trackedTickers() {
  const result = await client.execute("SELECT DISTINCT ticker FROM transactions ORDER BY ticker");
  return result.rows.map((row) => row.ticker);
}

async function getStatus(ticker) {
  const result = await client.execute({
    sql: "SELECT status, processed_count FROM insider_backfill_status WHERE ticker = ?",
    args: [ticker],
  });
  return result.rows[0] ?? null;
}

// Schreibt in dieselbe Tabelle und dieselben Statuswerte, die der Cron liest — 'in_progress' lässt
// ihn den Ticker fortsetzen, 'done' überspringen.
async function saveProgress(ticker, processedCount) {
  await client.execute({
    sql: `INSERT INTO insider_backfill_status (ticker, status, processed_count) VALUES (?, 'in_progress', ?)
          ON CONFLICT(ticker) DO UPDATE SET status = 'in_progress', processed_count = excluded.processed_count`,
    args: [ticker, processedCount],
  });
}

async function markDone(ticker) {
  await client.execute({
    sql: `INSERT INTO insider_backfill_status (ticker, status, completed_at) VALUES (?, 'done', ?)
          ON CONFLICT(ticker) DO UPDATE SET status = 'done', completed_at = excluded.completed_at`,
    args: [ticker, Date.now()],
  });
}

async function countOpenTickers() {
  const result = await client.execute(
    `SELECT COUNT(*) AS n FROM (SELECT DISTINCT ticker FROM transactions) t
      LEFT JOIN insider_backfill_status b ON b.ticker = t.ticker
      WHERE b.ticker IS NULL OR b.status <> 'done'`
  );
  return Number(result.rows[0]?.n ?? 0);
}

function parseArgs(argv) {
  const parsed = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") parsed.force = true;
    else if (arg === "--limit") parsed.limit = requirePositiveInt(argv[++i], arg);
    else if (arg === "--tickers")
      parsed.tickers = argv[++i].split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
    else {
      console.error(`Unbekanntes Argument: ${arg}`);
      process.exit(1);
    }
  }
  return parsed;
}

function requirePositiveInt(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(`${flag} braucht eine ganze Zahl > 0, war: ${value}`);
    process.exit(1);
  }
  return parsed;
}
