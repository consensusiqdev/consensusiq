import { Resend } from "resend";
import type { Transaction, TickerSignal } from "@/types/filing";
import { fmtDate, fmtShares, fmtSignalScore, fmtUsd } from "@/lib/format";
import { SITE_URL } from "@/lib/seo";

let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resendClient) resendClient = new Resend(apiKey);
  return resendClient;
}

function renderTransactionRow(t: Transaction): string {
  const color = t.side === "BUY" ? "#1f9d6b" : "#d0463f";
  return `
    <tr>
      <td style="padding:6px 10px;font-family:monospace;font-size:12px;color:${color};font-weight:600;">${t.side}</td>
      <td style="padding:6px 10px;font-family:monospace;font-size:12px;">${t.ticker}</td>
      <td style="padding:6px 10px;font-size:13px;">${t.filerName}${t.filerRole ? ` (${t.filerRole})` : ""}</td>
      <td style="padding:6px 10px;font-family:monospace;font-size:12px;">${fmtShares(t.shares)} Aktien</td>
      <td style="padding:6px 10px;font-family:monospace;font-size:12px;">${fmtUsd(t.valueUsd)}</td>
      <td style="padding:6px 10px;font-family:monospace;font-size:11px;color:#6e6e73;">${fmtDate(t.transactionDate)}</td>
      <td style="padding:6px 10px;"><a href="${t.sourceUrl}" style="font-size:11px;color:#b8791f;">Meldung ↗</a></td>
    </tr>`;
}

/** Sends one consolidated alert email listing all new watched-ticker transactions for a user. */
export async function sendWatchlistAlertEmail(to: string, transactions: Transaction[]): Promise<void> {
  const client = getResendClient();
  if (!client) {
    console.warn("[email] RESEND_API_KEY nicht gesetzt — Alert-E-Mail übersprungen.");
    return;
  }
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    console.warn("[email] RESEND_FROM_EMAIL nicht gesetzt — Alert-E-Mail übersprungen.");
    return;
  }
  if (transactions.length === 0) return;

  const tickers = [...new Set(transactions.map((t) => t.ticker))];
  const subject =
    tickers.length === 1
      ? `Neue Insider-Meldung: ${tickers[0]}`
      : `Neue Insider-Meldungen bei ${tickers.length} Aktien deiner Watchlist`;

  const html = `
    <div style="font-family:sans-serif;color:#1d1d1f;">
      <h2 style="font-size:18px;">Insider-Aktivität bei deiner Watchlist</h2>
      <table style="border-collapse:collapse;width:100%;">
        <thead>
          <tr style="text-align:left;border-bottom:1px solid #d2d2d7;">
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Seite</th>
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Ticker</th>
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Insider</th>
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Menge</th>
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Wert</th>
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Datum</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${transactions.map(renderTransactionRow).join("")}</tbody>
      </table>
      <p style="margin-top:20px;font-size:11px;color:#a1a1a6;">
        Du bekommst diese E-Mail, weil du ${tickers.join(", ")} auf deiner InsiderAlign-Watchlist hast.
        Verwalten: <a href="${SITE_URL}/watchlist" style="color:#b8791f;">Watchlist ansehen</a>.
        Keine Finanzberatung.
      </p>
    </div>`;

  const { error } = await client.emails.send({ from, to, subject, html });
  if (error) {
    console.error("[email] Versand fehlgeschlagen:", error);
  }
}

function renderScreenSignalRow(s: TickerSignal): string {
  const color = s.leadSide === "BUY" ? "#1f9d6b" : "#d0463f";
  return `
    <tr>
      <td style="padding:6px 10px;font-family:monospace;font-size:12px;color:${color};font-weight:600;">${s.leadSide}</td>
      <td style="padding:6px 10px;font-family:monospace;font-size:12px;"><a href="${SITE_URL}/company/${s.ticker}" style="color:inherit;">${s.ticker}</a></td>
      <td style="padding:6px 10px;font-size:13px;">${s.companyName}</td>
      <td style="padding:6px 10px;font-family:monospace;font-size:12px;">${fmtSignalScore(s.signalScore)}</td>
      <td style="padding:6px 10px;font-family:monospace;font-size:12px;">${s.leadCount}/${s.totalParticipants}</td>
      <td style="padding:6px 10px;font-family:monospace;font-size:12px;">${fmtUsd(s.totalValueAll)}</td>
    </tr>`;
}

/** Sends one consolidated alert email listing every ticker that newly matches a saved screen's criteria. */
export async function sendScreenAlertEmail(to: string, screenName: string, signals: TickerSignal[]): Promise<void> {
  const client = getResendClient();
  if (!client) {
    console.warn("[email] RESEND_API_KEY nicht gesetzt — Screen-Alert-E-Mail übersprungen.");
    return;
  }
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    console.warn("[email] RESEND_FROM_EMAIL nicht gesetzt — Screen-Alert-E-Mail übersprungen.");
    return;
  }
  if (signals.length === 0) return;

  const subject =
    signals.length === 1
      ? `Neuer Treffer in "${screenName}": ${signals[0].ticker}`
      : `${signals.length} neue Treffer in "${screenName}"`;

  const html = `
    <div style="font-family:sans-serif;color:#1d1d1f;">
      <h2 style="font-size:18px;">Neue Treffer in deinem Screen „${screenName}“</h2>
      <table style="border-collapse:collapse;width:100%;">
        <thead>
          <tr style="text-align:left;border-bottom:1px solid #d2d2d7;">
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Seite</th>
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Ticker</th>
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Unternehmen</th>
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Score</th>
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Insider</th>
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Volumen</th>
          </tr>
        </thead>
        <tbody>${signals.map(renderScreenSignalRow).join("")}</tbody>
      </table>
      <p style="margin-top:20px;font-size:11px;color:#a1a1a6;">
        Du bekommst diese E-Mail, weil diese Aktien neu die Kriterien deines gespeicherten Screens
        „${screenName}“ erfüllen. Verwalten:
        <a href="${SITE_URL}/watchlist" style="color:#b8791f;">Screens ansehen</a>. Keine Finanzberatung.
      </p>
    </div>`;

  const { error } = await client.emails.send({ from, to, subject, html });
  if (error) {
    console.error("[email] Screen-Alert-Versand fehlgeschlagen:", error);
  }
}

/** Sends the opt-in daily/weekly digest: the top signals (by score) over the last 1 or 7 days. */
export async function sendDigestEmail(to: string, frequency: "daily" | "weekly", signals: TickerSignal[]): Promise<void> {
  const client = getResendClient();
  if (!client) {
    console.warn("[email] RESEND_API_KEY nicht gesetzt — Digest-E-Mail übersprungen.");
    return;
  }
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    console.warn("[email] RESEND_FROM_EMAIL nicht gesetzt — Digest-E-Mail übersprungen.");
    return;
  }
  if (signals.length === 0) return;

  const label = frequency === "weekly" ? "Wöchentlicher" : "Täglicher";
  const periodLabel = frequency === "weekly" ? "letzten 7 Tage" : "letzten 24 Stunden";
  const subject = `${label} InsiderAlign-Digest: ${signals.length} Top-Signal${signals.length === 1 ? "" : "e"}`;

  const html = `
    <div style="font-family:sans-serif;color:#1d1d1f;">
      <h2 style="font-size:18px;">${label} Digest — Top-Signale der ${periodLabel}</h2>
      <table style="border-collapse:collapse;width:100%;">
        <thead>
          <tr style="text-align:left;border-bottom:1px solid #d2d2d7;">
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Seite</th>
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Ticker</th>
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Unternehmen</th>
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Score</th>
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Insider</th>
            <th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#6e6e73;">Volumen</th>
          </tr>
        </thead>
        <tbody>${signals.map(renderScreenSignalRow).join("")}</tbody>
      </table>
      <p style="margin-top:20px;font-size:11px;color:#a1a1a6;">
        Du bekommst diese E-Mail, weil du den ${label.toLowerCase()}n Digest abonniert hast.
        Verwalten: <a href="${SITE_URL}/watchlist" style="color:#b8791f;">Einstellungen ansehen</a>.
        Keine Finanzberatung.
      </p>
    </div>`;

  const { error } = await client.emails.send({ from, to, subject, html });
  if (error) {
    console.error("[email] Digest-Versand fehlgeschlagen:", error);
  }
}
