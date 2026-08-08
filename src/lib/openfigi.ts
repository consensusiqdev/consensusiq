import "server-only";

const OPENFIGI_API_KEY = process.env.OPENFIGI_API_KEY;
const BATCH_SIZE = 100; // OpenFIGI's max jobs per /v3/mapping call with an API key
const BATCH_DELAY_MS = 300; // stays comfortably under the 25-requests/6s rate limit

type OpenFigiMappingResult = { data?: { ticker?: string; marketSector?: string; exchCode?: string }[] };

/**
 * 13F filings identify positions by CUSIP with often-abbreviated/inconsistent issuer names
 * ("ALLY FINL INC" vs our own "Ally Financial Inc.") — too unreliable to fuzzy-match by name, so
 * this resolves the security identifier directly via OpenFIGI (free, MIT-licensed FIGI mapping
 * service; needs OPENFIGI_API_KEY from a free openfigi.com signup). Only equities are kept — a
 * CUSIP can map to multiple instrument types/exchanges, and we only care about the US common
 * stock ticker. CUSIPs that don't resolve (e.g. delisted, non-equity, or OpenFIGI has no record)
 * are simply omitted from the returned map — callers store the raw CUSIP either way.
 */
export async function resolveCusipsToTickers(cusips: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(cusips)];
  if (unique.length === 0) return result;

  if (!OPENFIGI_API_KEY) {
    console.warn("[openfigi] OPENFIGI_API_KEY nicht gesetzt — CUSIP-Ticker-Auflösung übersprungen.");
    return result;
  }

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const res = await fetch("https://api.openfigi.com/v3/mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-OPENFIGI-APIKEY": OPENFIGI_API_KEY },
      body: JSON.stringify(batch.map((cusip) => ({ idType: "ID_CUSIP", idValue: cusip }))),
    });

    if (!res.ok) {
      console.warn(`[openfigi] Mapping-Request fehlgeschlagen (${res.status}) — Batch übersprungen.`);
      continue;
    }

    const body = (await res.json()) as OpenFigiMappingResult[];
    body.forEach((entry, idx) => {
      const equities = entry.data?.filter((d) => d.marketSector === "Equity" && d.ticker) ?? [];
      // A CUSIP maps to one listing per exchange (foreign exchanges included, e.g. German listings
      // of a US stock under a different legacy ticker) — "US" (the composite/primary US listing)
      // is what we actually want; without this a real case turned up Chevron as "CHV" (a German
      // listing's old ticker) instead of the correct current "CVX".
      const match = equities.find((d) => d.exchCode === "US") ?? equities[0];
      if (match?.ticker) result.set(batch[idx], match.ticker);
    });

    if (i + BATCH_SIZE < unique.length) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  return result;
}
