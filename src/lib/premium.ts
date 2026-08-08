import "server-only";
import { getMostRecentBuyBefore } from "@/lib/db";
import type { Transaction, TickerSignal, TransactionCode } from "@/types/filing";

/**
 * Server-only module: everything here touches db.ts (Turso/libSQL), which must never end up in a
 * client bundle. Deliberately kept separate from consensus.ts, which IS imported by client
 * components ("use client" TickerCard.tsx etc. use `pctOfPriorHoldings`) — mixing the two once
 * caused Turbopack to try to bundle node:sqlite for the browser and hard-crash
 * ("the chunking context (unknown) does not support external modules (request: node:sqlite)").
 * That crash mode is gone now that db.ts talks over HTTPS instead of a native module, but the
 * "never import db.ts from a client component" rule still stands — a client-side import would
 * now silently ship TURSO_AUTH_TOKEN to the browser instead of crashing the build.
 * Only ever import this from API routes, never from a component.
 */

async function lookupPriorAcquisition(filerId: string, ticker: string, beforeDate: string) {
  const prior = await getMostRecentBuyBefore(filerId, ticker, beforeDate);
  if (!prior) return null;
  return {
    date: prior.transaction_date,
    pricePerShare: prior.price_per_share,
    shares: prior.shares,
    // Pre-code-widening rows have no transaction_code on record — treat as a plain purchase,
    // the best guess available for that older data.
    code: (prior.transaction_code ?? "P") as TransactionCode,
  };
}

/**
 * Premium feature (active-subscriber only, caller decides whether to invoke this — it's not
 * gated internally): for every SELL transaction, looks up the most recent share-acquiring event
 * we've tracked for that same filer+ticker beforehand — an open-market buy, a grant, an option
 * exercise, etc. (see TransactionCode). Mutates `transactions` in place, setting
 * `priorAcquisition` (an object if found, `null` if genuinely nothing on record — many sells will
 * still be `null` since plenty of holdings predate when we started tracking, 2026-08-06).
 */
export async function enrichTransactionsWithAcquisitionHistory(transactions: Transaction[]): Promise<void> {
  const sells = transactions.filter((t) => t.side === "SELL");
  const results = await Promise.all(
    sells.map((t) => lookupPriorAcquisition(t.filerId, t.ticker, t.transactionDate))
  );
  sells.forEach((t, i) => {
    t.priorAcquisition = results[i];
  });
}

/** Same premium enrichment as above, applied to the per-side filer breakdown inside TickerSignal. */
type PriorAcquisitionResult = Awaited<ReturnType<typeof lookupPriorAcquisition>>;

export async function enrichSignalsWithAcquisitionHistory(signals: TickerSignal[]): Promise<void> {
  const targets: {
    filerId: string;
    ticker: string;
    transactionDate: string;
    setPrior: (v: PriorAcquisitionResult) => void;
  }[] = [];
  for (const signal of signals) {
    for (const side of signal.sides) {
      if (side.side !== "SELL") continue;
      for (const f of side.filers) {
        targets.push({
          filerId: f.filerId,
          ticker: signal.ticker,
          transactionDate: f.transactionDate,
          setPrior: (v) => {
            f.priorAcquisition = v;
          },
        });
      }
    }
  }

  const results = await Promise.all(
    targets.map((t) => lookupPriorAcquisition(t.filerId, t.ticker, t.transactionDate))
  );
  targets.forEach((t, i) => t.setPrior(results[i]));
}
