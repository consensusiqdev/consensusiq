import "server-only";
import { ingestTransactions } from "@/lib/ingest";
import { sendWatchlistAlerts } from "@/lib/alerts";
import { backfillPreviousQuarterHoldings, ingestInstitutionalHoldings } from "@/lib/institutional";
import { checkAndPostTwitterSignals } from "@/lib/twitterBot";
import { ingestNewForm3Positions, backfillNextTicker } from "@/lib/insiderPositions";

/**
 * The 5-min cycle: Form 4 ingest → watchlist alert emails for anything new → Twitter bot check →
 * real-time Form 3 (new insider) feed. Shared between local dev's setInterval loop
 * (instrumentation.ts) and the production /api/cron/ingest route — same logic either way, only
 * the trigger differs.
 */
export async function runIngestCycle(): Promise<void> {
  try {
    const result = await ingestTransactions();
    console.log(
      `[ingest] ${new Date().toISOString()} — ${result.fetched} Filings geladen, ${result.written} neue Transaktionen`
    );

    if (result.newTransactions.length > 0) {
      const { emailsSent } = await sendWatchlistAlerts(result.newTransactions);
      if (emailsSent > 0) console.log(`[alerts] ${emailsSent} E-Mails verschickt`);
    }
  } catch (err) {
    console.error("[ingest] fehlgeschlagen:", err);
    throw err;
  }

  // Own try/catch — a Twitter hiccup should never take down the core ingest cycle. Dry-run by
  // default (see twitter.ts) until TWITTER_BOT_ENABLED + real credentials are set.
  try {
    await checkAndPostTwitterSignals();
  } catch (err) {
    console.error("[twitter] fehlgeschlagen:", err);
  }

  try {
    const result = await ingestNewForm3Positions();
    console.log(`[insiderPositions] ${result.processed} neue Form-3-Positionen verarbeitet`);
  } catch (err) {
    console.error("[insiderPositions] Form-3-Feed fehlgeschlagen:", err);
  }
}

/** The 24h cycle: refresh the curated funds' latest 13F holdings. */
export async function runInstitutionalCycle(): Promise<void> {
  const result = await ingestInstitutionalHoldings();
  console.log(
    `[institutional] ${new Date().toISOString()} — ${result.fundsProcessed} Fonds verarbeitet, ${result.holdingsWritten} Positionen geschrieben`
  );
}

/** One-time, manually-triggered: seeds each fund's previous-quarter 13F as a diffable baseline
 * for "biggest position changes" (see institutional.ts's backfillPreviousQuarterHoldings() doc
 * comment). Not on the daily schedule — call /api/cron/institutional-backfill directly once. */
export async function runInstitutionalBackfillCycle(): Promise<void> {
  const result = await backfillPreviousQuarterHoldings();
  console.log(
    `[institutional-backfill] ${new Date().toISOString()} — ${result.fundsProcessed} Fonds verarbeitet, ${result.holdingsWritten} Positionen geschrieben`
  );
}

/** The 3-min cycle: one batch of a ticker's Form 3/4/5 insider backfill (may span multiple cycles for large companies). */
export async function runBackfillCycle(): Promise<{ ticker: string | null; processed: number; done: boolean }> {
  const result = await backfillNextTicker();
  if (result.ticker) {
    console.log(
      `[insiderPositions] Backfill ${result.ticker}: ${result.processed} Meldungen verarbeitet${result.done ? " (fertig)" : " (wird fortgesetzt)"}`
    );
  }
  return result;
}
