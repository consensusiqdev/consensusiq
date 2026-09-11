import "server-only";
import { fetchRecentOfferingAccessions, getTickerForCik } from "@/lib/secEdgar";
import { getProcessedAccessions, insertIpoFiling, markAccessionsProcessed, tickerHasTransactions } from "@/lib/db";

/**
 * Polls SEC's cross-company 424B4 feed (final offering prospectus — IPO or follow-on) and records
 * every filing that's a genuine first-time IPO: a ticker with no prior transaction history at all.
 * A follow-on offering by an already-tracked company hits the same feed but is deliberately not
 * recorded — see tickerHasTransactions().
 *
 * Same processed_accessions dedup as the Form 3/4 pollers in ingest.ts/insiderPositions.ts: SEC's
 * "getcurrent" feed returns the same rolling ~100 most recent filings on every poll regardless of
 * how many are actually new since the last one.
 */
export async function discoverNewIpos(): Promise<{ seen: number; recorded: number }> {
  const accessions = await fetchRecentOfferingAccessions(100);
  const alreadyProcessed = await getProcessedAccessions(accessions.map((a) => a.accessionNumber));
  const candidates = accessions.filter((a) => !alreadyProcessed.has(a.accessionNumber));

  let recorded = 0;
  const succeeded: string[] = [];

  for (const accession of candidates) {
    try {
      const resolved = await getTickerForCik(accession.cik);
      // No exchange-listed ticker for this CIK (debt-only filer, SPAC pre-listing, etc.) — nothing
      // to show on an IPO page keyed by ticker, but still mark processed so this accession isn't
      // re-checked forever.
      if (!resolved) {
        succeeded.push(accession.accessionNumber);
        continue;
      }

      const alreadyTracked = await tickerHasTransactions(resolved.ticker);
      if (!alreadyTracked) {
        await insertIpoFiling({
          ticker: resolved.ticker,
          cik: accession.cik,
          companyName: resolved.companyName,
          filedDate: accession.filedAt.slice(0, 10),
          sourceUrl: accession.indexUrl,
        });
        recorded++;
      }
      succeeded.push(accession.accessionNumber);
    } catch (err) {
      // One unresolvable filing shouldn't drop the rest of this cycle's batch — it stays
      // unprocessed and gets retried on the next poll.
      console.warn(`[ipoDiscovery] Meldung ${accession.accessionNumber} konnte nicht verarbeitet werden:`, err);
    }
  }

  await markAccessionsProcessed(succeeded);
  return { seen: candidates.length, recorded };
}
