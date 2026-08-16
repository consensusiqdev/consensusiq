import "server-only";
import {
  fetchFilingsByForm,
  fetchOwnershipPosition,
  fetchRecentForm3Accessions,
} from "@/lib/secEdgar";
import {
  getBackfillProgress,
  getNextBackfillTicker,
  getProcessedAccessions,
  markAccessionsProcessed,
  markBackfillDone,
  updateBackfillProgress,
  upsertInsiderPosition,
} from "@/lib/db";

// Caps how many filings one backfill cycle fetches — the external scheduler (cron-job.org, free
// tier) hard-times-out any request at 30s, and a company can have 50-200+ historical filings, far
// more than fits in that budget. At ~120ms SEC throttle + network latency per filing, 15 stays
// comfortably inside 30s even on a slow run.
const BACKFILL_BATCH_SIZE = 15;

function sourceTypeForForm(form: string): "FORM3" | "FORM4" | "FORM5" {
  if (form === "3") return "FORM3";
  if (form === "5") return "FORM5";
  return "FORM4";
}

/**
 * Real-time-forward coverage: polls the same global "getcurrent" Form 3 feed pattern already used
 * for Form 4, so newly-appointed insiders show up in `insider_positions` within one 5-min cycle.
 * Doesn't touch older history — that's `backfillNextTicker`'s job.
 *
 * Same processed_accessions skip as ingest.ts's Form 4 path: this feed returns the same rolling
 * ~100-most-recent window on every poll, so without filtering out already-handled accessions this
 * re-fetched+re-parsed nearly all of them again every 5 minutes for no reason.
 */
export async function ingestNewForm3Positions(): Promise<{ processed: number; newAccessions: number }> {
  const allAccessions = await fetchRecentForm3Accessions(100);
  const alreadyProcessed = await getProcessedAccessions(allAccessions.map((a) => a.accessionNumber));
  const accessions = allAccessions.filter((a) => !alreadyProcessed.has(a.accessionNumber));

  let processed = 0;
  const succeeded: string[] = [];

  for (const accession of accessions) {
    try {
      const position = await fetchOwnershipPosition(accession.cik, accession.accessionNumber);
      if (position) {
        await upsertInsiderPosition({
          ticker: position.ticker,
          filerId: position.filerId,
          filerName: position.filerName,
          filerRole: position.filerRole,
          shares: position.shares,
          asOfDate: position.asOfDate,
          sourceType: "FORM3",
          sourceUrl: position.sourceUrl,
        });
        processed++;
      }
      // A filing that legitimately yields no position (e.g. couldn't resolve a ticker) is still a
      // successful fetch+parse, not a failure — mark it processed either way so it isn't retried
      // forever. Only the catch block below (a genuine fetch/parse error) skips marking.
      succeeded.push(accession.accessionNumber);
    } catch (err) {
      console.warn(`[insiderPositions] Form 3 ${accession.accessionNumber} fehlgeschlagen:`, err);
    }
  }

  await markAccessionsProcessed(succeeded);

  return { processed, newAccessions: accessions.length };
}

/**
 * The slow catch-up crawl: works through one not-yet-backfilled ticker's *entire* Form 3/4/5
 * history (not just what we've observed since we started tracking), in batches of
 * `BACKFILL_BATCH_SIZE` filings per cycle — a company can have 50-200+ historical filings, far
 * more than fits in one cycle's time budget, so a large ticker resumes across several cycles
 * (tracked via `processed_count` in `insider_backfill_status`) instead of doing it all at once.
 */
export async function backfillNextTicker(): Promise<{ ticker: string | null; processed: number; done: boolean }> {
  const ticker = await getNextBackfillTicker();
  if (!ticker) return { ticker: null, processed: 0, done: false };

  const alreadyProcessed = await getBackfillProgress(ticker);
  let processed = 0;
  let done = false;

  try {
    const filings = await fetchFilingsByForm(ticker, ["3", "4", "5"]);
    const batch = filings.slice(alreadyProcessed, alreadyProcessed + BACKFILL_BATCH_SIZE);

    for (const filing of batch) {
      try {
        const position = await fetchOwnershipPosition(filing.cik, filing.accessionNumber);
        if (!position) continue;
        await upsertInsiderPosition({
          ticker: position.ticker,
          filerId: position.filerId,
          filerName: position.filerName,
          filerRole: position.filerRole,
          shares: position.shares,
          asOfDate: position.asOfDate,
          sourceType: sourceTypeForForm(filing.form),
          sourceUrl: position.sourceUrl,
        });
        processed++;
      } catch (err) {
        console.warn(`[insiderPositions] Backfill ${ticker} ${filing.accessionNumber} fehlgeschlagen:`, err);
      }
    }

    const newProcessedCount = alreadyProcessed + batch.length;
    if (newProcessedCount >= filings.length) {
      // Mark done even if some individual filings failed above — a ticker with a few
      // unparseable old filings shouldn't block forever and keep getting re-picked.
      await markBackfillDone(ticker);
      done = true;
    } else {
      await updateBackfillProgress(ticker, newProcessedCount);
    }
  } catch (err) {
    // Couldn't even fetch the filings list — mark done anyway so a permanently-broken ticker
    // doesn't get re-picked forever instead of the queue moving on.
    console.warn(`[insiderPositions] Backfill ${ticker} Filing-Liste fehlgeschlagen:`, err);
    await markBackfillDone(ticker);
    done = true;
  }

  return { ticker, processed, done };
}
