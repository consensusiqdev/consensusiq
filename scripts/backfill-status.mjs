// Read-only Fortschrittsanzeige für die beiden historischen Nachläufe (backfill-positions.mjs,
// backfill-form4.mjs) — für den Fall, dass ihr Konsolen-Output nicht mehr sichtbar ist (Terminal
// zu, über Nacht gelaufen, ...). Fragt einfach dieselben Fortschritts-Tabellen ab, die die Skripte
// selbst schreiben (siehe deren Kommentare), macht sonst nichts.
//
//   node --env-file=.env.local scripts/backfill-status.mjs
import { createClient } from "@libsql/client";

requireEnv();
const client = createDbClient();

const totalTickers = await trackedTickerCount();
console.log(`${totalTickers} getrackte Ticker (DISTINCT ticker in transactions).\n`);

await printProgress({
  label: "Positions-Nachlauf (insider_positions, insider_backfill_status)",
  runCommand: "npm run research:positions",
  sql: `SELECT
          SUM(CASE WHEN b.status = 'done' THEN 1 ELSE 0 END) AS done,
          SUM(CASE WHEN b.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
          SUM(CASE WHEN b.ticker IS NULL THEN 1 ELSE 0 END) AS not_started
        FROM (SELECT DISTINCT ticker FROM transactions) t
        LEFT JOIN insider_backfill_status b ON b.ticker = t.ticker`,
  failureScript: "positions",
});

await printProgress({
  label: "Form-4-Nachlauf (form4_backfill_status)",
  runCommand: "npm run research:backfill",
  sql: `SELECT
          SUM(CASE WHEN f.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done,
          SUM(CASE WHEN f.ticker IS NOT NULL AND f.completed_at IS NULL THEN 1 ELSE 0 END) AS in_progress,
          SUM(CASE WHEN f.ticker IS NULL THEN 1 ELSE 0 END) AS not_started
        FROM (SELECT DISTINCT ticker FROM transactions) t
        LEFT JOIN form4_backfill_status f ON f.ticker = t.ticker`,
  failureScript: "form4",
  missingTableHint: "form4_backfill_status fehlt noch — einmalig scripts/add-backfilled-column.mjs laufen lassen.",
});

// ---------------------------------------------------------------------------

async function printProgress({ label, runCommand, sql, failureScript, missingTableHint }) {
  console.log(label);
  let row;
  try {
    const result = await client.execute(sql);
    row = result.rows[0];
  } catch (err) {
    console.log(`  Konnte Status nicht lesen: ${err instanceof Error ? err.message : err}`);
    if (missingTableHint) console.log(`  ${missingTableHint}`);
    console.log("");
    return;
  }

  const done = Number(row?.done ?? 0);
  const inProgress = Number(row?.in_progress ?? 0);
  const notStarted = Number(row?.not_started ?? 0);
  const total = done + inProgress + notStarted;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  console.log(`  ${done}/${total} Ticker fertig (${pct}%), ${inProgress} in Arbeit, ${notStarted} noch offen.`);
  console.log(
    notStarted === 0 && inProgress === 0
      ? "  Vollständig durchgelaufen."
      : `  Weiter geht's mit: ${runCommand}`
  );

  const failed = await countUnresolvedFailures(failureScript);
  if (failed > 0) {
    console.log(`  ${failed} zuvor fehlgeschlagene Meldungen offen — ${runCommand} -- --retry-failed nachschieben.`);
  }
  console.log("");
}

async function countUnresolvedFailures(script) {
  try {
    const result = await client.execute({
      sql: `SELECT COUNT(*) AS n FROM backfill_failures WHERE script = ? AND resolved_at IS NULL`,
      args: [script],
    });
    return Number(result.rows[0]?.n ?? 0);
  } catch {
    // backfill_failures existiert erst nach scripts/add-backfill-failures-table.mjs — vor dieser
    // einmaligen Migration gibt es per Definition keine offenen Fehlschläge zu melden.
    return 0;
  }
}

async function trackedTickerCount() {
  const result = await client.execute("SELECT COUNT(DISTINCT ticker) AS n FROM transactions");
  return Number(result.rows[0]?.n ?? 0);
}

function requireEnv() {
  if (process.env.TURSO_DATABASE_URL) return;
  console.error("Fehlende Umgebungsvariable: TURSO_DATABASE_URL");
  console.error("Beispiel:");
  console.error("  node --env-file=.env.local scripts/backfill-status.mjs");
  process.exit(1);
}

function createDbClient() {
  return createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
}
