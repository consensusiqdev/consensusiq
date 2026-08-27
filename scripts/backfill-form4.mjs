// Historischer Form-4-Nachlauf: holt für jeden getrackten Ticker dessen komplette Form-4-Historie
// von SEC EDGAR und schreibt sie in `transactions`. Voraussetzung dafür, dass der Backtest in
// src/lib/research/ überhaupt etwas aussagen kann — siehe BACKFILL.md.
//
// Läuft LOKAL, nicht auf Vercel: ein Lauf dauert Stunden und sprengt jedes Function-Limit um
// Größenordnungen; außerdem ist es ein einmaliger Vorgang, kein Betriebsablauf. Die Daten landen
// trotzdem in der echten Datenbank — Turso ist ein gehosteter Dienst, den dieser Rechner genauso
// erreicht wie Vercel es tut.
//
//   node --env-file=.env.local scripts/backfill-form4.mjs
//   node --env-file=.env.local scripts/backfill-form4.mjs --tickers AAPL,MSFT
//   node --env-file=.env.local scripts/backfill-form4.mjs --from 2023-04-01 --limit 20
//   node --env-file=.env.local scripts/backfill-form4.mjs --retry-failed
//
// Jederzeit mit Strg-C abbrechbar: der Fortschritt steht pro Ticker in `form4_backfill_status`,
// ein Neustart macht dort weiter, wo der letzte Lauf stand. `processed_accessions` und das
// INSERT-OR-IGNORE auf `transactions` machen doppelt verarbeitete Meldungen ohnehin folgenlos.
//
// Eine Meldung, die fetchTransactionsForAccessions() nicht laden konnte, zählt trotzdem als
// "erledigt" für den Ticker-Fortschritt oben und würde sonst nie wiederholt. Sie landet stattdessen
// in `backfill_failures`; `--retry-failed` arbeitet gezielt nur diese Zeilen ab, unabhängig vom
// Ticker-Durchlauf — sinnvoll Stunden später, wenn SEC nicht mehr drosselt. Setzt
// scripts/add-backfill-failures-table.mjs voraus.
import { createClient } from "@libsql/client";

// secEdgar.ts wirft schon beim Laden, wenn SEC_EDGAR_USER_AGENT fehlt — und `import` läuft vor
// jedem Code hier. Deshalb erst prüfen, dann dynamisch nachladen: sonst begrüßt der allererste
// Lauf ohne .env.local einen mit einem Stacktrace statt mit dem, was zu tun ist.
requireEnv();
const { accessionFromFilingRef, fetchFilingsByForm, fetchTransactionsForAccessions } = await import(
  "../src/lib/secEdgar.ts"
);

// SECs `aff10b5One`-Checkbox (Quelle für is_plan_trade) ist erst seit der Regeländerung 2023
// Pflicht. Ältere Meldungen kämen ohne Kennzeichen an und läsen sich als "kein Planhandel" —
// und weil der Score Planhandel ausschließt, würde der Backtest darauf Signale bewerten, die die
// Live-App nie erzeugt hätte. Deshalb ist hier per Vorgabe Schluss; wer bewusst tiefer will
// (etwa für die Unternehmensseiten, die die Flags nicht brauchen), setzt --from.
const DEFAULT_FROM = "2023-04-01";
const FILING_CHUNK_SIZE = 25; // Fortschritt wird je Block gespeichert, damit ein Abbruch wenig kostet
const INSERT_CHUNK_SIZE = 40; // wie in ingest.ts: kleine Turso-Roundtrips statt einem riesigen

const args = parseArgs(process.argv.slice(2));
const client = createDbClient();

if (args.retryFailed) {
  await retryFailed(args.limit);
  process.exit(0);
}

const tickers = args.tickers ?? (await trackedTickers());
console.log(
  `Form-4-Nachlauf · ${tickers.length} Ticker · ab ${args.from}` +
    (args.limit ? ` · max. ${args.limit} Ticker in diesem Lauf` : "")
);
console.log("Abbruch mit Strg-C ist sicher — der Fortschritt wird je Ticker gespeichert.\n");

let tickersDone = 0;
let totalWritten = 0;
const started = Date.now();

for (const ticker of tickers) {
  if (args.limit && tickersDone >= args.limit) {
    console.log(`\n--limit ${args.limit} erreicht — Rest bleibt für den nächsten Lauf.`);
    break;
  }

  const status = await getStatus(ticker);
  if (status?.completed_at && !args.force) {
    continue; // in einem früheren Lauf schon fertig
  }

  try {
    const written = await backfillTicker(ticker, status?.filings_done ?? 0);
    totalWritten += written;
  } catch (err) {
    // Ein Ticker, dessen Filing-Liste oder Meldungen sich nicht laden lassen, darf einen Lauf über
    // hunderte Ticker nicht kippen. Er bleibt unmarkiert und wird beim nächsten Lauf neu versucht.
    console.warn(`  ${ticker}: FEHLGESCHLAGEN — ${err instanceof Error ? err.message : err}`);
  }
  tickersDone++;
}

const minutes = Math.round((Date.now() - started) / 60000);
console.log(`\nFertig: ${tickersDone} Ticker bearbeitet, ${totalWritten} Transaktionen neu geschrieben (${minutes} min).`);
const open = await countOpenTickers();
console.log(
  open === 0
    ? "Alle getrackten Ticker sind nachgeladen."
    : `${open} Ticker noch offen — Skript einfach erneut starten, es macht dort weiter.`
);
const failedCount = await countUnresolvedFailures("form4");
if (failedCount > 0) {
  console.log(`${failedCount} Meldungen aus diesem oder früheren Läufen sind noch offen — --retry-failed nachschieben.`);
}

// ---------------------------------------------------------------------------

async function backfillTicker(ticker, alreadyDone) {
  // `deep` folgt SECs ausgelagerten älteren Filing-Seiten — ohne das reicht die Historie bei einem
  // vielfilenden Emittenten oft nur ein bis zwei Jahre zurück.
  const filings = (await fetchFilingsByForm(ticker, ["4"], { deep: true }))
    .filter((f) => f.filedDate >= args.from)
    // Älteste zuerst: bricht der Lauf ab, ist der bereits geschriebene Teil ein zusammenhängender
    // Zeitraum und keine Handvoll Löcher über die ganze Historie verteilt.
    .sort((a, b) => a.filedDate.localeCompare(b.filedDate));

  if (filings.length === 0) {
    await markCompleted(ticker, 0, 0);
    console.log(`  ${ticker}: keine Form-4-Meldungen ab ${args.from}`);
    return 0;
  }

  let done = Math.min(alreadyDone, filings.length);
  let written = 0;
  const resumeNote = done > 0 ? ` (Wiederaufnahme bei ${done})` : "";
  process.stdout.write(`  ${ticker}: ${filings.length} Meldungen${resumeNote} … `);

  while (done < filings.length) {
    const chunk = filings.slice(done, done + FILING_CHUNK_SIZE);
    const { transactions, succeededAccessionNumbers } = await fetchTransactionsForAccessions(
      chunk.map(accessionFromFilingRef)
    );
    written += await insertTransactions(transactions);

    const succeeded = new Set(succeededAccessionNumbers);
    for (const filing of chunk) {
      if (!succeeded.has(filing.accessionNumber)) await recordFailure(ticker, filing);
    }

    done += chunk.length;
    await saveProgress(ticker, filings.length, done, written);
    process.stdout.write(".");
  }

  await markCompleted(ticker, filings.length, written);
  console.log(` ${written} Transaktionen`);
  return written;
}

/** Arbeitet gezielt nur `backfill_failures`-Zeilen ab, unabhängig vom normalen Ticker-Durchlauf
 * oben — der Sinn ist, das Stunden später erneut laufen zu lassen, wenn eine SEC-seitige Drosselung
 * sich gelegt hat. */
async function retryFailed(limit) {
  const rows = await getUnresolvedFailures("form4", limit);
  if (rows.length === 0) {
    console.log("Keine offenen Fehlschläge für den Form-4-Nachlauf.");
    return;
  }
  console.log(`Wiederhole ${rows.length} zuvor fehlgeschlagene Meldungen … `);
  const accessions = rows.map((row) =>
    accessionFromFilingRef({ cik: row.cik, accessionNumber: row.accession_number, filedDate: row.filed_date })
  );
  const { transactions, succeededAccessionNumbers } = await fetchTransactionsForAccessions(accessions);
  const written = await insertTransactions(transactions);

  const succeeded = new Set(succeededAccessionNumbers);
  for (const row of rows) {
    if (succeeded.has(row.accession_number)) await resolveFailure("form4", row.ticker, row.accession_number);
    else await bumpFailure("form4", row.ticker, row.accession_number);
  }
  console.log(`${succeeded.size}/${rows.length} beim Wiederholen erfolgreich, ${written} Transaktionen geschrieben.`);
}

/**
 * Schreibt mit demselben INSERT-OR-IGNORE wie der Live-Ingest, nur mit `backfilled = 1`. Das
 * Kennzeichen ist der ganze Punkt: der Backtest muss unterscheiden können, welchen Zeilen er die
 * Flags glauben darf (siehe DEFAULT_FROM oben). Eine bereits vom Live-Ingest geschriebene Zeile
 * gewinnt und behält `backfilled = 0` — das IGNORE lässt sie unangetastet.
 */
async function insertTransactions(transactions) {
  if (transactions.length === 0) return 0;

  const sql = `INSERT OR IGNORE INTO transactions
     (source_id, filer_type, filer_id, filer_name, filer_role, ticker, company_name, side, transaction_code,
      shares, price_per_share, value_usd, shares_owned_after, transaction_date, filed_date, source_url,
      ingested_at, near_offering, is_plan_trade, is_c_suite, is_fresh_insider, backfilled)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`;

  let written = 0;
  for (let i = 0; i < transactions.length; i += INSERT_CHUNK_SIZE) {
    const chunk = transactions.slice(i, i + INSERT_CHUNK_SIZE);
    const results = await client.batch(
      chunk.map((t) => ({
        sql,
        args: [
          t.id,
          t.filerType,
          t.filerId,
          t.filerName,
          t.filerRole ?? null,
          t.ticker,
          t.companyName,
          t.side,
          t.transactionCode,
          t.shares,
          t.pricePerShare,
          t.valueUsd,
          t.sharesOwnedAfter,
          t.transactionDate,
          t.filedDate,
          t.sourceUrl,
          Date.now(),
          t.nearOffering ? 1 : 0,
          t.isPlanTrade ? 1 : 0,
          t.isCSuite ? 1 : 0,
          // is_fresh_insider bleibt bewusst 0: der Wert bräuchte die Form-3-Ersterfassung aus der
          // Zeit VOR der jeweiligen Transaktion, die für den Nachlauf-Zeitraum nicht vorliegt. Er
          // fließt nicht in den Signal Score ein (nur ins Badge), verfälscht also nichts.
          0,
        ],
      })),
      "write"
    );
    written += results.filter((r) => r.rowsAffected > 0).length;
  }
  return written;
}

// ---------------------------------------------------------------------------

function requireEnv() {
  const missing = ["TURSO_DATABASE_URL", "SEC_EDGAR_USER_AGENT"].filter((k) => !process.env[k]);
  if (missing.length === 0) return;
  console.error(`Fehlende Umgebungsvariablen: ${missing.join(", ")}`);
  console.error("SEC verlangt einen identifizierenden User-Agent, Format: \"AppName (kontakt@domain.tld)\".");
  console.error("Beispiel:");
  console.error("  node --env-file=.env.local scripts/backfill-form4.mjs");
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
    sql: "SELECT filings_done, completed_at FROM form4_backfill_status WHERE ticker = ?",
    args: [ticker],
  });
  return result.rows[0] ?? null;
}

async function saveProgress(ticker, total, done, written) {
  await client.execute({
    sql: `INSERT INTO form4_backfill_status (ticker, filings_total, filings_done, transactions_written)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(ticker) DO UPDATE SET
            filings_total = excluded.filings_total,
            filings_done = excluded.filings_done,
            transactions_written = excluded.transactions_written`,
    args: [ticker, total, done, written],
  });
}

async function markCompleted(ticker, total, written) {
  await client.execute({
    sql: `INSERT INTO form4_backfill_status (ticker, filings_total, filings_done, transactions_written, completed_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(ticker) DO UPDATE SET
            filings_total = excluded.filings_total,
            filings_done = excluded.filings_done,
            transactions_written = excluded.transactions_written,
            completed_at = excluded.completed_at`,
    args: [ticker, total, total, written, Date.now()],
  });
}

/** Bewahrt eine Meldung, die fetchTransactionsForAccessions() nicht laden konnte, statt sie nur zu
 * loggen (das tut die Funktion selbst schon) — sonst gilt sie für den Ticker-Fortschritt als
 * erledigt und wird nie wiederholt. Absichtlich mit eigenem try/catch: fehlt die Tabelle
 * (add-backfill-failures-table.mjs noch nicht gelaufen), soll das den Backfill nicht mit umwerfen. */
async function recordFailure(ticker, filing) {
  const now = Date.now();
  try {
    await client.execute({
      sql: `INSERT INTO backfill_failures
              (script, ticker, cik, accession_number, filed_date, form, attempts, last_error, first_failed_at, last_attempt_at)
            VALUES ('form4', ?, ?, ?, ?, '4', 1, ?, ?, ?)
            ON CONFLICT(script, ticker, accession_number) DO UPDATE SET
              attempts = backfill_failures.attempts + 1,
              last_error = excluded.last_error,
              last_attempt_at = excluded.last_attempt_at,
              resolved_at = NULL`,
      args: [
        ticker,
        filing.cik,
        filing.accessionNumber,
        filing.filedDate ?? null,
        "Fetch/Parse fehlgeschlagen (siehe Konsole)",
        now,
        now,
      ],
    });
  } catch (recordErr) {
    console.warn(
      `    Konnte Fehlschlag nicht in backfill_failures speichern (Tabelle angelegt? scripts/add-backfill-failures-table.mjs): ${recordErr instanceof Error ? recordErr.message : recordErr}`
    );
  }
}

async function resolveFailure(script, ticker, accessionNumber) {
  await client.execute({
    sql: `UPDATE backfill_failures SET resolved_at = ? WHERE script = ? AND ticker = ? AND accession_number = ?`,
    args: [Date.now(), script, ticker, accessionNumber],
  });
}

async function bumpFailure(script, ticker, accessionNumber) {
  await client.execute({
    sql: `UPDATE backfill_failures SET attempts = attempts + 1, last_attempt_at = ?
          WHERE script = ? AND ticker = ? AND accession_number = ?`,
    args: [Date.now(), script, ticker, accessionNumber],
  });
}

async function getUnresolvedFailures(script, limit) {
  const result = await client.execute({
    sql: limit
      ? `SELECT ticker, cik, accession_number, filed_date, form FROM backfill_failures
          WHERE script = ? AND resolved_at IS NULL ORDER BY first_failed_at LIMIT ?`
      : `SELECT ticker, cik, accession_number, filed_date, form FROM backfill_failures
          WHERE script = ? AND resolved_at IS NULL ORDER BY first_failed_at`,
    args: limit ? [script, limit] : [script],
  });
  return result.rows;
}

async function countUnresolvedFailures(script) {
  const result = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM backfill_failures WHERE script = ? AND resolved_at IS NULL`,
    args: [script],
  });
  return Number(result.rows[0]?.n ?? 0);
}

async function countOpenTickers() {
  const result = await client.execute(
    `SELECT COUNT(*) AS n FROM (SELECT DISTINCT ticker FROM transactions) t
      WHERE t.ticker NOT IN (SELECT ticker FROM form4_backfill_status WHERE completed_at IS NOT NULL)`
  );
  return Number(result.rows[0]?.n ?? 0);
}

function parseArgs(argv) {
  const parsed = { from: DEFAULT_FROM, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") parsed.force = true;
    else if (arg === "--retry-failed") parsed.retryFailed = true;
    else if (arg === "--from") parsed.from = requireIsoDate(argv[++i], arg);
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

function requireIsoDate(value, flag) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
    console.error(`${flag} braucht ein ISO-Datum (YYYY-MM-DD), war: ${value}`);
    process.exit(1);
  }
  return value;
}

function requirePositiveInt(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(`${flag} braucht eine ganze Zahl > 0, war: ${value}`);
    process.exit(1);
  }
  return parsed;
}
