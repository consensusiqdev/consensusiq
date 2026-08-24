/**
 * End-of-day Kursdaten — AUSSCHLIESSLICH für die interne Signal-Score-Forschung.
 *
 * Warum das hier unter src/lib/research/ liegt und nicht neben den übrigen lib-Modulen: Kurse an
 * Endnutzer weiterzureichen (Dashboard-Widget, API-Response, Chart) ist genau der Fall, für den
 * Datenanbieter eine kostenpflichtige Redistribution-Lizenz verlangen — daran ist die Idee beim
 * ersten Anlauf gescheitert. Eine rein interne Auswertung, aus der nur eine eigene abgeleitete
 * Kennzahl entsteht ("kaufgeführte Signale lagen nach 21 Handelstagen im Schnitt X % über dem
 * Markt"), ist ein anderer Fall: es verlässt kein einziger Kurswert das Haus.
 *
 * Damit das auch so bleibt, gilt für dieses Verzeichnis eine harte Regel: nichts hieraus wird
 * jemals aus src/app/** importiert. Kein Modul unter src/lib/research/ hängt an der App-Datenbank
 * (src/lib/db.ts) oder an "server-only", damit es ausschließlich über die Offline-Skripte in
 * scripts/ läuft und gar nicht erst in einem Route-Bundle landen kann.
 *
 * Der eine Anbieter mit brauchbaren, kostenlosen EOD-Daten ohne Key ist Stooq; wer sauber
 * dividendenbereinigte Kurse will (siehe Hinweis bei `adjClose` unten), setzt TIINGO_API_KEY.
 */

/** Ein Handelstag. `close` ist der bereinigte Schlusskurs — siehe `PriceProvider`. */
export type PriceBar = {
  date: string; // ISO (YYYY-MM-DD)
  close: number;
};

/**
 * - `stooq`: kein API-Key nötig, volle Historie, CSV. Kurse sind **split**-bereinigt, aber NICHT
 *   dividendenbereinigt — bei Dividendenzahlungen fehlt die Ausschüttung in der Rendite, was
 *   Kaufsignale bei ausschüttungsstarken Werten systematisch schlechter aussehen lässt. Für die
 *   relative Auswertung (Ticker gegen SPY, beide gleich behandelt) ist der Effekt klein, aber er
 *   ist da und geht tendenziell gegen Value-/Dividendentitel.
 * - `tiingo`: braucht TIINGO_API_KEY (kostenloses Kontingent reicht für unsere Tickerzahl), liefert
 *   `adjClose` inkl. Dividenden. Sauberer, deshalb bevorzugt, sobald ein Key gesetzt ist.
 */
export type PriceProvider = "stooq" | "tiingo";

/** Referenzindex für Überrendite. Ohne Benchmark misst ein Backtest vor allem den Gesamtmarkt. */
export const BENCHMARK_SYMBOL = "SPY";

/** Stooq blockt bei zu vielen Abrufen pro Tag — freiwillige Pause zwischen zwei Symbolen. */
export const DEFAULT_REQUEST_DELAY_MS = 350;

export function resolveProvider(env: Record<string, string | undefined> = process.env): PriceProvider {
  return env.TIINGO_API_KEY ? "tiingo" : "stooq";
}

/**
 * Stooq erwartet Kleinschreibung mit `.us`-Suffix und kennt keinen Punkt in der Klassen-Notation:
 * `BRK.B` heißt dort `brk-b.us`. Betrifft bei uns nur eine Handvoll Doppelklassen-Ticker, ist aber
 * genau die Sorte Detail, an der sonst stillschweigend Kurse für einzelne Werte fehlen.
 */
export function toStooqSymbol(ticker: string): string {
  return `${ticker.trim().toLowerCase().replace(/\./g, "-")}.us`;
}

/**
 * Stooq-CSV: `Date,Open,High,Low,Close,Volume`, aufsteigend nach Datum. Fehlende Werte kommen als
 * `N/D` — solche Zeilen werden übersprungen, nicht als 0 interpretiert.
 *
 * Wirft bei Nicht-CSV-Antworten (Rate-Limit-Hinweis, HTML-Fehlerseite, leerer Body): Stooq
 * antwortet in all diesen Fällen mit HTTP 200, ein stiller Rückgabewert `[]` wäre also von
 * "Ticker existiert, hat aber keine Historie" nicht zu unterscheiden.
 */
export function parseStooqCsv(csv: string, symbol: string): PriceBar[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]?.toLowerCase() ?? "";
  if (!header.startsWith("date,")) {
    const preview = csv.trim().slice(0, 120) || "(leere Antwort)";
    throw new Error(`Stooq lieferte kein CSV für ${symbol}: ${preview}`);
  }

  const closeIndex = header.split(",").indexOf("close");
  if (closeIndex === -1) throw new Error(`Stooq-CSV für ${symbol} hat keine Close-Spalte: ${header}`);

  const bars: PriceBar[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const date = cells[0];
    const close = Number(cells[closeIndex]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !Number.isFinite(close) || close <= 0) continue;
    bars.push({ date, close });
  }
  return sortByDate(bars);
}

type TiingoBar = { date?: unknown; adjClose?: unknown; close?: unknown };

/**
 * Tiingo-JSON: Array aus `{ date: "2026-08-21T00:00:00.000Z", close, adjClose, ... }`.
 * `adjClose` ist der split- UND dividendenbereinigte Kurs und damit der einzig richtige für
 * Renditerechnung; `close` dient nur als Notnagel, falls das Feld mal fehlt.
 */
export function parseTiingoJson(payload: unknown, symbol: string): PriceBar[] {
  if (!Array.isArray(payload)) {
    throw new Error(`Tiingo lieferte kein Array für ${symbol}: ${JSON.stringify(payload).slice(0, 120)}`);
  }

  const bars: PriceBar[] = [];
  for (const raw of payload as TiingoBar[]) {
    const date = typeof raw?.date === "string" ? raw.date.slice(0, 10) : null;
    const close = Number(raw?.adjClose ?? raw?.close);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue;
    bars.push({ date, close });
  }
  return sortByDate(bars);
}

/** Aufsteigend nach Datum und ohne Dubletten (letzter Wert pro Tag gewinnt) — Voraussetzung für
 * jede Index-Arithmetik weiter unten, die sich auf "Position i = i-ter Handelstag" verlässt. */
function sortByDate(bars: PriceBar[]): PriceBar[] {
  const byDate = new Map<string, number>();
  for (const bar of bars) byDate.set(bar.date, bar.close);
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, close]) => ({ date, close }));
}

export type FetchOptions = {
  provider?: PriceProvider;
  /** ISO-Datum; ältere Bars werden verworfen. Ohne Angabe: gesamte verfügbare Historie. */
  from?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

/**
 * Holt die EOD-Historie eines Symbols beim gewählten Anbieter. Wirft bei HTTP- oder Formatfehlern,
 * damit ein einzelner kaputter Ticker im Sync-Skript sichtbar wird, statt als stille Lücke im
 * Backtest zu landen (ein Signal ohne Kurse fällt sonst einfach aus der Stichprobe — und zwar
 * nicht zufällig, sondern bevorzugt bei kleinen/illiquiden Werten).
 */
export async function fetchDailyCloses(ticker: string, options: FetchOptions = {}): Promise<PriceBar[]> {
  const provider = options.provider ?? resolveProvider();
  const doFetch = options.fetchImpl ?? fetch;

  if (provider === "tiingo") {
    const apiKey = options.apiKey ?? process.env.TIINGO_API_KEY;
    if (!apiKey) throw new Error("TIINGO_API_KEY fehlt, obwohl Provider 'tiingo' gewählt wurde.");
    const url = new URL(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(ticker.toLowerCase())}/prices`);
    if (options.from) url.searchParams.set("startDate", options.from);
    // Key im Header statt als Query-Parameter, damit er nicht in Fehlermeldungen/Logs auftaucht.
    const response = await doFetch(url, {
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    });
    if (!response.ok) throw new Error(`Tiingo ${response.status} für ${ticker}`);
    return applyFrom(parseTiingoJson(await response.json(), ticker), options.from);
  }

  const url = new URL("https://stooq.com/q/d/l/");
  url.searchParams.set("s", toStooqSymbol(ticker));
  url.searchParams.set("i", "d");
  if (options.from) url.searchParams.set("d1", options.from.replace(/-/g, ""));
  const response = await doFetch(url);
  if (!response.ok) throw new Error(`Stooq ${response.status} für ${ticker}`);
  return applyFrom(parseStooqCsv(await response.text(), ticker), options.from);
}

function applyFrom(bars: PriceBar[], from?: string): PriceBar[] {
  return from ? bars.filter((b) => b.date >= from) : bars;
}

// ---------------------------------------------------------------------------
// Handelstag-Arithmetik
// ---------------------------------------------------------------------------

/**
 * Index des ersten Handelstags STRIKT nach `isoDate`, oder null wenn die Serie dort endet.
 *
 * Strikt nach, nicht "am oder nach": ein Signal, das am Tag D sichtbar wird, war an diesem Tag
 * nicht zwingend schon zum Handelsschluss bekannt (Form-4-Meldungen laufen über den ganzen Tag,
 * bis 22 Uhr ET, ein). Einstieg zum Schluss des Folgetages ist die konservative Annahme — die
 * andere Variante lässt einen Backtest besser aussehen, als er ist.
 */
export function firstBarAfter(bars: PriceBar[], isoDate: string): number | null {
  // Binäre Suche: pro Backtest-Lauf kommen das hier schnell Zehntausende Aufrufe über Serien mit
  // mehreren Tausend Bars zusammen.
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= isoDate) lo = mid + 1;
    else hi = mid;
  }
  return lo < bars.length ? lo : null;
}

/**
 * Einfache Rendite über `horizonTradingDays` Handelstage ab Position `fromIndex`, oder null wenn
 * die Serie noch nicht so weit reicht. Bewusst Handelstage statt Kalendertage: ein 21-Bar-Horizont
 * ist überall gleich lang, ein 30-Kalendertage-Horizont je nach Feiertagen nicht.
 */
export function forwardReturn(
  bars: PriceBar[],
  fromIndex: number,
  horizonTradingDays: number
): number | null {
  const exitIndex = fromIndex + horizonTradingDays;
  if (fromIndex < 0 || exitIndex >= bars.length) return null;
  const entry = bars[fromIndex].close;
  if (!(entry > 0)) return null;
  return bars[exitIndex].close / entry - 1;
}

/**
 * Benchmark-Rendite über exakt dieselbe Kalenderspanne wie ein Ticker-Trade — über die Datums-
 * grenzen des Trades, nicht über dieselbe Bar-Anzahl. Handelstage können auseinanderlaufen
 * (Handelsaussetzung, verspäteter IPO-Start, Feiertagslücken einzelner Werte); die Überrendite
 * muss aber denselben Zeitraum vergleichen, sonst misst sie teilweise nur Kalenderversatz.
 */
export function benchmarkReturnBetween(
  benchmark: PriceBar[],
  entryDate: string,
  exitDate: string
): number | null {
  const entryIndex = indexOfDateOnOrBefore(benchmark, entryDate);
  const exitIndex = indexOfDateOnOrBefore(benchmark, exitDate);
  if (entryIndex === null || exitIndex === null || exitIndex <= entryIndex) return null;
  const entry = benchmark[entryIndex].close;
  if (!(entry > 0)) return null;
  return benchmark[exitIndex].close / entry - 1;
}

/** Index des letzten Handelstags am oder vor `isoDate`, oder null wenn die Serie später beginnt. */
export function indexOfDateOnOrBefore(bars: PriceBar[], isoDate: string): number | null {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= isoDate) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? lo - 1 : null;
}
