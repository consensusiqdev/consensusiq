import "server-only";
import {
  fetchFilingsByForm,
  fetchOwnershipPosition,
  fetchRecentForm3Accessions,
} from "@/lib/secEdgar";
import { getNextBackfillTicker, markBackfillDone, upsertInsiderPosition } from "@/lib/db";

function sourceTypeForForm(form: string): "FORM3" | "FORM4" | "FORM5" {
  if (form === "3") return "FORM3";
  if (form === "5") return "FORM5";
  return "FORM4";
}

/**
 * Real-time-forward coverage: polls the same global "getcurrent" Form 3 feed pattern already used
 * for Form 4, so newly-appointed insiders show up in `insider_positions` within one 5-min cycle.
 * Doesn't touch older history — that's `backfillNextTicker`'s job.
 */
export async function ingestNewForm3Positions(): Promise<{ processed: number }> {
  const accessions = await fetchRecentForm3Accessions(100);
  let processed = 0;

  for (const accession of accessions) {
    try {
      const position = await fetchOwnershipPosition(accession.cik, accession.accessionNumber);
      if (!position) continue;
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
    } catch (err) {
      console.warn(`[insiderPositions] Form 3 ${accession.accessionNumber} fehlgeschlagen:`, err);
    }
  }

  return { processed };
}

/**
 * The slow catch-up crawl: one not-yet-backfilled ticker per call, its *entire* Form 3/4/5 history
 * (not just what we've observed since we started tracking). Deliberately one company at a time —
 * a company can have 50-200+ historical insider filings, and this shares the same SEC fetch
 * throttle as every other loop, so spreading the work out avoids hammering SEC in one burst.
 */
export async function backfillNextTicker(): Promise<{ ticker: string | null; processed: number }> {
  const ticker = await getNextBackfillTicker();
  if (!ticker) return { ticker: null, processed: 0 };

  let processed = 0;
  try {
    const filings = await fetchFilingsByForm(ticker, ["3", "4", "5"]);
    for (const filing of filings) {
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
  } finally {
    // Mark done even on partial failure — a ticker with a few unparseable old filings shouldn't
    // block forever and keep getting re-picked every cycle instead of moving on to the next one.
    await markBackfillDone(ticker);
  }

  return { ticker, processed };
}
