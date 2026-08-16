import "server-only";
import { ingestTransactions } from "@/lib/ingest";
import { sendWatchlistAlerts } from "@/lib/alerts";
import { checkSavedScreensAndAlert } from "@/lib/screens";
import { checkAndSendDigests } from "@/lib/digest";
import { backfillPreviousQuarterHoldings, ingestInstitutionalHoldings } from "@/lib/institutional";
import { checkAndPostTwitterSignals } from "@/lib/twitterBot";
import { ingestNewForm3Positions, backfillNextTicker } from "@/lib/insiderPositions";

/**
 * The 5-min cycle: real-time Form 3 (new insider) feed → Form 4 ingest → watchlist alert emails
 * for anything new → saved-screen alert emails for anything newly matching → digest emails for
 * anyone due → Twitter bot check. Shared between local dev's setInterval loop
 * (instrumentation.ts) and the production /api/cron/ingest route — same logic either way, only
 * the trigger differs.
 *
 * Form 3 deliberately runs FIRST, not last: a brand-new insider who files both a Form 3 and a same-
 * day Form 4 BUY needs their Form 3 already in insider_positions by the time ingestTransactions()
 * runs its "frisch eingestiegen" check (computeFreshInsiderFlags() in ingest.ts) — otherwise that
 * exact "just joined and already buying" case, the one this flag exists for, would be missed on
 * the one cycle it matters most.
 */
export async function runIngestCycle(): Promise<void> {
  try {
    const form3Result = await ingestNewForm3Positions();
    console.log(
      `[insiderPositions] ${form3Result.newAccessions} neu abgerufen, ${form3Result.processed} Form-3-Positionen verarbeitet`
    );
  } catch (err) {
    console.error("[insiderPositions] Form-3-Feed fehlgeschlagen:", err);
  }

  try {
    const result = await ingestTransactions();
    console.log(
      `[ingest] ${new Date().toISOString()} — ${result.fetched} Filings gesehen (${result.newAccessions} davon neu abgerufen), ${result.written} neue Transaktionen`
    );

    if (result.newTransactions.length > 0) {
      const { emailsSent, pushSent } = await sendWatchlistAlerts(result.newTransactions);
      if (emailsSent > 0) console.log(`[alerts] ${emailsSent} E-Mails verschickt`);
      if (pushSent > 0) console.log(`[alerts] ${pushSent} Push-Benachrichtigungen verschickt`);

      // A saved screen's matching set can only change when new transactions land, same gating
      // as the watchlist check above — skip the (relatively expensive, one signals-pipeline-run
      // per screen) check entirely on a quiet cycle.
      try {
        const { emailsSent: screenEmailsSent, pushSent: screenPushSent } = await checkSavedScreensAndAlert();
        if (screenEmailsSent > 0) console.log(`[screens] ${screenEmailsSent} Screen-Alert-E-Mails verschickt`);
        if (screenPushSent > 0) console.log(`[screens] ${screenPushSent} Screen-Alert-Push-Benachrichtigungen verschickt`);
      } catch (err) {
        console.error("[screens] fehlgeschlagen:", err);
      }
    }
  } catch (err) {
    console.error("[ingest] fehlgeschlagen:", err);
    throw err;
  }

  // Unlike the two checks above, this is a TIME-based check (is a user's daily/weekly digest
  // due), not a data-change check — must run every cycle regardless of whether new transactions
  // landed this time. Own try/catch, same reasoning as Twitter below.
  try {
    const { emailsSent: digestEmailsSent } = await checkAndSendDigests();
    if (digestEmailsSent > 0) console.log(`[digest] ${digestEmailsSent} Digest-E-Mails verschickt`);
  } catch (err) {
    console.error("[digest] fehlgeschlagen:", err);
  }

  // Own try/catch — a Twitter hiccup should never take down the core ingest cycle. Dry-run by
  // default (see twitter.ts) until TWITTER_BOT_ENABLED + real credentials are set.
  try {
    await checkAndPostTwitterSignals();
  } catch (err) {
    console.error("[twitter] fehlgeschlagen:", err);
  }
}

/** The 24h cycle: refresh the curated funds' latest 13F holdings. */
export async function runInstitutionalCycle(): Promise<void> {
  const result = await ingestInstitutionalHoldings();
  console.log(
    `[institutional] ${new Date().toISOString()} — ${result.fundsProcessed} Fonds verarbeitet, ${result.holdingsWritten} Positionen geschrieben`
  );
}

/** One-time, manually-triggered: seeds one fund's previous-quarter 13F as a diffable baseline for
 * "biggest position changes" (see institutional.ts's backfillPreviousQuarterHoldings() doc
 * comment) — one fund per call, so call /api/cron/institutional-backfill repeatedly (once per
 * fund) until `fund` comes back null. Not on the daily schedule. */
export async function runInstitutionalBackfillCycle(): Promise<{ fund: string | null; holdingsWritten: number }> {
  const result = await backfillPreviousQuarterHoldings();
  console.log(
    `[institutional-backfill] ${new Date().toISOString()} — ${result.fund ?? "fertig, kein Fonds mehr offen"}: ${result.holdingsWritten} Positionen geschrieben`
  );
  return result;
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
