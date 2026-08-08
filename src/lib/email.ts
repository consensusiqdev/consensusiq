import { Resend } from "resend";
import type { Transaction } from "@/types/filing";
import { fmtDate, fmtShares, fmtUsd } from "@/lib/format";

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
        Verwalten: <a href="${process.env.NEXT_PUBLIC_APP_URL}/watchlist" style="color:#b8791f;">Watchlist ansehen</a>.
        Keine Finanzberatung.
      </p>
    </div>`;

  const { error } = await client.emails.send({ from, to, subject, html });
  if (error) {
    console.error("[email] Versand fehlgeschlagen:", error);
  }
}
