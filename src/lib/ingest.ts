import "server-only";
import { fetchCongressTransactions } from "@/lib/congressTrading";
import { fetchForm4Transactions, fetchTickerSic } from "@/lib/secEdgar";
import {
  getAllTickers,
  insertTransactionsBatch,
  tickerMetadataMissing,
  upsertInsiderPosition,
  upsertTickerMetadata,
} from "@/lib/db";
import type { Transaction } from "@/types/filing";

const FORM4_FETCH_COUNT = 200;
// Chunk size for batched Turso inserts — keeps each network round trip small/fast rather than
// one round trip per row (was free on local sync SQLite, isn't on a hosted DB).
const INSERT_CHUNK_SIZE = 40;

// Lazily backfills industry/sector metadata for any ticker that doesn't have it yet — checked
// against every distinct ticker we've ever tracked (cheap indexed lookup), not just this cycle's
// new transactions, so the ~217 tickers already tracked before this feature shipped get caught
// up too, not just brand-new ones. A handful of misses per cycle in steady state.
async function backfillTickerMetadata(): Promise<void> {
  const missing = await tickerMetadataMissing(await getAllTickers());
  for (const ticker of missing) {
    try {
      const sic = await fetchTickerSic(ticker);
      if (sic) await upsertTickerMetadata(ticker, sic.sic, sic.industry);
    } catch (err) {
      console.warn(`[ingest] SIC-Lookup für ${ticker} fehlgeschlagen:`, err);
    }
  }
}

export async function ingestTransactions(): Promise<{
  fetched: number;
  written: number;
  newTransactions: Transaction[];
}> {
  // count=200 per poll covers the most recent Form 4 filings only — a burst of more filings
  // than that between two 5-minute polls could be missed (no pagination/cursor). Same class
  // of gap-tolerance the old Polymarket top-25 leaderboard already had, not a regression.
  const [secTx, congressTx] = await Promise.all([
    fetchForm4Transactions(FORM4_FETCH_COUNT).catch((err) => {
      console.error("[ingest] SEC EDGAR fehlgeschlagen:", err);
      return [];
    }),
    fetchCongressTransactions().catch(() => []),
  ]);

  const candidates = [...secTx, ...congressTx];
  const newTransactions: Transaction[] = [];

  for (let i = 0; i < candidates.length; i += INSERT_CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + INSERT_CHUNK_SIZE);
    const inserted = await insertTransactionsBatch(chunk);
    inserted.forEach((wasNew, idx) => {
      if (wasNew) newTransactions.push(chunk[idx]);
    });
  }

  // Any tracked code (not just P/S) updates the insider's true current position — a grant or
  // option exercise changes real share count just as much as an open-market trade does. Data
  // already in hand, no extra SEC fetch needed. Independent writes, so fan out in parallel.
  await Promise.all(
    newTransactions
      .filter((tx) => tx.filerType === "insider" && tx.sharesOwnedAfter != null)
      .map((tx) =>
        upsertInsiderPosition({
          ticker: tx.ticker,
          filerId: tx.filerId,
          filerName: tx.filerName,
          filerRole: tx.filerRole,
          shares: tx.sharesOwnedAfter,
          asOfDate: tx.transactionDate,
          sourceType: "FORM4",
          sourceUrl: tx.sourceUrl,
        })
      )
  );

  await backfillTickerMetadata();

  return { fetched: secTx.length + congressTx.length, written: newTransactions.length, newTransactions };
}
