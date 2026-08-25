// Tests für die Offline-Forschung (src/lib/research/ + die Score-Formel in src/lib/consensus.ts).
//
//   node --test scripts/test-research.mjs      (oder: npm test)
//
// Warum ausgerechnet hier Tests stehen und sonst nirgends im Projekt: In einer Auswertung fällt ein
// Vorzeichenfehler nicht auf. Eine kaputte UI sieht man, eine Korrelation mit falschem Vorzeichen
// liefert klaglos eine Zahl, die plausibel aussieht — und auf deren Basis würden dann die
// Score-Gewichte verstellt. Dieselbe Logik gilt für die Kurs-Parser: Stooq antwortet auch im
// Fehlerfall mit HTTP 200, ein stiller Fehlgriff landet als Lücke in der Stichprobe.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SCORE_WEIGHTS, SCORE_COMPONENT_KEYS, scoreFromComponents, sideMultiplierFor } from "../src/lib/consensus.ts";
import {
  benchmarkReturnBetween, fetchDailyCloses, firstBarAfter, forwardReturn, indexOfDateOnOrBefore,
  parseStooqCsv, parseTiingoJson, resolveProvider, toStooqSymbol,
} from "../src/lib/research/prices.ts";
import {
  bucketByScore, compareGroups, componentIcs, correlationTStat, evaluateSideAsymmetry, evaluateVariants,
  longShortSpread, median, quantileBuckets, ranks, spearman, stdDev, summarizeHorizon, tStat, welchTTest,
} from "../src/lib/research/backtest.ts";

const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg} — war ${actual}, erwartet ${expected}`);

// ---------------------------------------------------------------------------

describe("Score-Formel", () => {
  const components = { convictionRatio: 1, dollarWeightedRatio: 0.8, avgHoldingsPct: 0.2, clusterTightnessRatio: 1 };

  // Die wichtigste Zusicherung im ganzen Projekt: die Auslagerung der Formel aus summarizeTickers()
  // in scoreFromComponents() darf den live gezeigten Score um keinen Punkt verändert haben.
  it("entspricht mit Standardgewichten exakt der ursprünglichen Formel", () => {
    for (const c of [components, { convictionRatio: 0, dollarWeightedRatio: 0, avgHoldingsPct: 0, clusterTightnessRatio: 0 },
                     { convictionRatio: 1, dollarWeightedRatio: 1, avgHoldingsPct: 1, clusterTightnessRatio: 1 },
                     { convictionRatio: 0.33, dollarWeightedRatio: 0.67, avgHoldingsPct: 0.5, clusterTightnessRatio: 0.11 }]) {
      const raw = 100 * ((c.convictionRatio + c.dollarWeightedRatio + c.avgHoldingsPct + c.clusterTightnessRatio) / 4);
      assert.equal(scoreFromComponents(c, "BUY"), Math.round(Math.min(100, Math.max(0, raw * 1.15))));
      assert.equal(scoreFromComponents(c, "SELL"), -Math.round(Math.min(100, Math.max(0, raw * 0.85))));
    }
  });

  it("gibt Verkaufskonsens negativ und Kaufkonsens positiv aus", () => {
    assert.ok(scoreFromComponents(components, "BUY") > 0);
    assert.ok(scoreFromComponents(components, "SELL") < 0);
  });

  it("deckelt bei ±100", () => {
    const maxed = { convictionRatio: 1, dollarWeightedRatio: 1, avgHoldingsPct: 1, clusterTightnessRatio: 1 };
    assert.equal(scoreFromComponents(maxed, "BUY"), 100, "1,15 × 100 muss auf 100 gedeckelt werden");
  });

  it("gewichtet Bestandteile relativ, nicht absolut", () => {
    const c = { convictionRatio: 1, dollarWeightedRatio: 0, avgHoldingsPct: 0, clusterTightnessRatio: 0 };
    // Nur ein Bestandteil aktiv -> der Nenner ist 1, nicht 4: der Score ist voll, nicht ein Viertel.
    const onlyFirst = { ...DEFAULT_SCORE_WEIGHTS, dollarWeightedRatio: 0, avgHoldingsPct: 0, clusterTightnessRatio: 0 };
    assert.equal(scoreFromComponents(c, "BUY", onlyFirst), 100);
    assert.equal(scoreFromComponents(c, "BUY"), 29, "mit allen vier Gewichten nur ein Viertel davon");
  });

  it("liefert 0 statt NaN, wenn alle Gewichte 0 sind", () => {
    const zero = Object.fromEntries(SCORE_COMPONENT_KEYS.map((k) => [k, 0]));
    assert.equal(scoreFromComponents(components, "BUY", { ...DEFAULT_SCORE_WEIGHTS, ...zero }), 0);
  });

  it("wendet die Seiten-Asymmetrie an", () => {
    assert.equal(sideMultiplierFor("BUY"), 1.15);
    assert.equal(sideMultiplierFor("SELL"), 0.85);
    const symmetric = { ...DEFAULT_SCORE_WEIGHTS, buyMultiplier: 1, sellMultiplier: 1 };
    assert.equal(Math.abs(scoreFromComponents(components, "BUY", symmetric)),
                 Math.abs(scoreFromComponents(components, "SELL", symmetric)));
  });
});

// ---------------------------------------------------------------------------

describe("Statistik", () => {
  it("Spearman erkennt monotone Zusammenhänge unabhängig von der Skala", () => {
    assert.equal(spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), 1);
    assert.equal(spearman([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]), -1);
    // Rang statt Pearson: ein einzelner Ausreißer darf das Ergebnis nicht bestimmen.
    assert.equal(spearman([1, 2, 3, 4, 5], [1, 2, 3, 4, 1000]), 1);
  });

  it("Spearman gibt null zurück statt eine Scheinzahl", () => {
    assert.equal(spearman([1, 2], [1, 2]), null, "zu wenig Punkte");
    assert.equal(spearman([1, 1, 1, 1], [1, 2, 3, 4]), null, "konstante Reihe hat keine Korrelation");
  });

  it("Ränge mitteln bei Gleichstand", () => {
    assert.deepEqual(ranks([5, 5, 1, 3]), [3.5, 3.5, 1, 2]);
    assert.deepEqual(ranks([7, 7, 7]), [2, 2, 2]);
  });

  it("median und stdDev", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    near(stdDev([2, 4, 4, 4, 5, 5, 7, 9]), 2.13808993529939, "Stichproben-SD (n−1)");
    assert.equal(stdDev([5]), 0);
  });

  it("t-Statistiken", () => {
    assert.equal(tStat([1, 1, 1, 1]), null, "ohne Streuung kein t");
    assert.ok(tStat([1, 2, 3, 4, 5]) > 2);
    assert.equal(correlationTStat(1, 50), null, "perfekte Korrelation hat kein endliches t");
    assert.ok(correlationTStat(0.3, 100) > 2);
  });

  it("Welch-Test trennt zwei Gruppen", () => {
    const result = welchTTest([10, 11, 12, 11], [1, 2, 3, 2]);
    assert.ok(result.t > 5, "deutlich getrennte Gruppen");
    near(result.diff, 9, "Mittelwertdifferenz");
    assert.equal(welchTTest([1], [2, 3]), null, "zu kleine Gruppe");
  });

  it("Quantile teilen ohne Verlust und ohne leere Eimer", () => {
    const buckets = quantileBuckets([5, 1, 4, 2, 3], (v) => v, 5);
    assert.deepEqual(buckets, [[1], [2], [3], [4], [5]]);
    assert.equal(quantileBuckets([1, 2, 3], (v) => v, 5).length, 3, "mehr Eimer als Elemente");
    assert.deepEqual(quantileBuckets([], (v) => v, 5), []);
  });
});

// ---------------------------------------------------------------------------

/** Ereignis mit vorgegebener Überrendite — `excess` wird direkt gesetzt, damit die Auswertung
 * gegen einen bekannten Sollwert prüfbar ist statt gegen simulierte Kurse. */
function event(score, side, excess, extras = {}) {
  return {
    cohortDate: extras.cohortDate ?? "2026-01-01",
    ticker: extras.ticker ?? "T",
    side,
    leadCount: extras.leadCount ?? 3,
    totalValueAll: 1e6,
    cSuiteShare: extras.cSuiteShare ?? 0,
    hasFreshInsider: extras.hasFreshInsider ?? false,
    components: extras.components ?? {
      convictionRatio: Math.abs(score) / 100, dollarWeightedRatio: 0.5, avgHoldingsPct: 0.5, clusterTightnessRatio: 0.5,
    },
    signalScore: score,
    entryDate: "2026-01-02",
    returns: { 21: { raw: excess, benchmark: 0, excess } },
  };
}

describe("Auswertung", () => {
  // Score und Überrendite laufen perfekt gleich: jede Kennzahl muss das eindeutig zeigen.
  const perfect = [event(90, "BUY", 0.09), event(60, "BUY", 0.05), event(30, "BUY", 0.02),
                   event(-30, "SELL", -0.02), event(-60, "SELL", -0.05), event(-90, "SELL", -0.09)];

  it("erkennt ein perfektes Signal", () => {
    const s = summarizeHorizon(perfect, 21);
    assert.equal(s.n, 6);
    assert.equal(s.ic, 1, "perfekte Rangkorrelation");
    assert.equal(s.directionalHitRate, 1, "jede Richtung getroffen");
    assert.ok(s.meanDirectionalExcess > 0, "Effekt in Signalrichtung positiv");
    assert.equal(s.reliable, false, "n=6 ist unter der Verlässlichkeitsschwelle");
  });

  it("erkennt ein invertiertes Signal", () => {
    const inverted = perfect.map((e) => ({ ...e, returns: { 21: { raw: 0, benchmark: 0, excess: -e.returns[21].excess } } }));
    const s = summarizeHorizon(inverted, 21);
    assert.equal(s.ic, -1);
    assert.equal(s.directionalHitRate, 0);
    assert.ok(s.meanDirectionalExcess < 0);
  });

  it("ignoriert Ereignisse ohne abgeschlossenen Horizont", () => {
    const withPending = [...perfect, { ...event(50, "BUY", 0), returns: {} }];
    assert.equal(summarizeHorizon(withPending, 21).n, 6, "das offene Ereignis zählt nicht mit");
    assert.equal(summarizeHorizon(perfect, 63).n, 0, "Horizont gar nicht vorhanden");
  });

  it("Quantile steigen bei einem funktionierenden Score monoton", () => {
    const rows = bucketByScore(perfect, 21, 3);
    assert.equal(rows.length, 3);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i].meanExcess > rows[i - 1].meanExcess, `Q${i + 1} muss über Q${i} liegen`);
    }
  });

  it("Long/Short-Spanne ist positiv, wenn oben mehr verdient wird als unten", () => {
    const result = longShortSpread(perfect, 21, (e) => e.signalScore, 3);
    assert.ok(result.spread > 0);
    near(result.spread, 0.07 - -0.07, "Ø oberstes minus Ø unterstes Quantil");
  });

  // Der Kern der Bestandteils-Analyse: der richtungsbereinigte IC muss einen informativen von
  // einem uninformativen Bestandteil trennen können — der richtungsbehaftete kann das nicht.
  it("trennt informative von uninformativen Bestandteilen", () => {
    const events = [];
    for (let i = 0; i < 40; i++) {
      const strength = i / 40;                      // trägt Information
      const noise = ((i * 37) % 40) / 40;           // trägt keine
      const side = i % 2 === 0 ? "BUY" : "SELL";
      events.push(event(50, side, (side === "BUY" ? 1 : -1) * strength * 0.1, {
        components: { convictionRatio: strength, dollarWeightedRatio: noise, avgHoldingsPct: 0.5, clusterTightnessRatio: 0.5 },
      }));
    }
    const [conviction, dollar] = componentIcs(events, 21, ["convictionRatio", "dollarWeightedRatio"]);
    assert.ok(conviction.withinSideIc > 0.9, `informativer Bestandteil: ${conviction.withinSideIc}`);
    assert.ok(Math.abs(dollar.withinSideIc) < 0.35, `uninformativer Bestandteil: ${dollar.withinSideIc}`);
    // Beide sehen mit Richtung gut aus — genau deshalb ist diese Spalte nicht zum Vergleich geeignet.
    assert.ok(conviction.ic > 0.5 && dollar.ic > 0.5, "der Seiteneffekt hebt beide gleichermaßen");
  });

  it("vergleicht Gewichtungs-Varianten auf derselben Stichprobe", () => {
    const variants = [
      { label: "live", score: (c, s) => scoreFromComponents(c, s) },
      { label: "nur Kopfzahl", score: (c, s) => scoreFromComponents(c, s, { ...DEFAULT_SCORE_WEIGHTS, dollarWeightedRatio: 0, avgHoldingsPct: 0, clusterTightnessRatio: 0 }) },
    ];
    const results = evaluateVariants(perfect, 21, variants, 3);
    assert.equal(results.length, 2);
    assert.equal(results[0].n, results[1].n, "identische Stichprobe, sonst wäre der Vergleich wertlos");
    for (const r of results) assert.ok(r.ic !== null && r.strengthIc !== null);
  });

  it("misst die Kauf/Verkauf-Asymmetrie in Signalrichtung", () => {
    // Kaufsignale liefern +4 %, Verkaufssignale −2 % (also 2 % in ihrer Richtung): Verhältnis 2.
    const asym = [event(80, "BUY", 0.04), event(80, "BUY", 0.04), event(-80, "SELL", -0.02), event(-80, "SELL", -0.02)];
    const result = evaluateSideAsymmetry(asym, 21);
    near(result.buy.meanExcess, 0.04, "Kaufseite");
    near(result.sell.meanExcess, 0.02, "Verkaufsseite wird für den Vergleich umgedreht");
    near(result.impliedBuyEdge, 2, "gemessenes Verhältnis der Effektstärken");
  });

  it("gibt kein Verhältnis aus, wenn eine Seite nichts zeigt", () => {
    const noEdge = [event(80, "BUY", -0.01), event(-80, "SELL", -0.02)];
    assert.equal(evaluateSideAsymmetry(noEdge, 21).impliedBuyEdge, null);
  });

  it("vergleicht Merkmalsgruppen", () => {
    const events = [event(50, "BUY", 0.05, { cSuiteShare: 1 }), event(50, "BUY", 0.06, { cSuiteShare: 1 }),
                    event(50, "BUY", 0.01, { cSuiteShare: 0 }), event(50, "BUY", 0.00, { cSuiteShare: 0 })];
    const result = compareGroups(events, 21, "C-Suite", (e) => e.cSuiteShare >= 0.5, { a: "mit", b: "ohne" });
    assert.equal(result.groupA.n, 2);
    assert.equal(result.groupB.n, 2);
    near(result.diff, 0.055 - 0.005, "Differenz der Gruppenmittelwerte");
  });

  it("bleibt bei leerer Eingabe stabil", () => {
    const s = summarizeHorizon([], 21);
    assert.equal(s.n, 0);
    assert.equal(s.ic, null);
    assert.equal(s.reliable, false);
    assert.deepEqual(bucketByScore([], 21, 5), []);
    assert.equal(longShortSpread([], 21, (e) => e.signalScore, 5), null);
    assert.equal(evaluateSideAsymmetry([], 21).impliedBuyEdge, null);
  });
});

// ---------------------------------------------------------------------------

describe("Kursdaten", () => {
  const csv = `Date,Open,High,Low,Close,Volume
2026-08-17,100.0,101.0,99.0,100.50,1000
2026-08-18,100.5,N/D,N/D,N/D,0
2026-08-19,101.0,103.0,100.5,102.00,1200
2026-08-20,102.0,104.0,101.0,103.50,900
`;

  it("liest Stooq-CSV und überspringt Zeilen ohne Kurs", () => {
    const bars = parseStooqCsv(csv, "AAPL");
    assert.deepEqual(bars.map((b) => b.date), ["2026-08-17", "2026-08-19", "2026-08-20"]);
    assert.equal(bars[0].close, 100.5);
  });

  it("liest die Close-Spalte über den Header, nicht über die Position", () => {
    assert.equal(parseStooqCsv("Date,Close,Open\n2026-08-17,55.5,50.0\n", "X")[0].close, 55.5);
  });

  // Stooq antwortet auch bei Rate-Limit und Fehlern mit HTTP 200 — ohne diese Prüfung wäre der
  // Fehlerfall von "Ticker existiert, hat aber keine Historie" nicht zu unterscheiden.
  it("wirft bei Nicht-CSV-Antworten statt still leer zurückzugeben", () => {
    assert.throws(() => parseStooqCsv("Exceeded the daily hits limit", "AAPL"), /kein CSV/);
    assert.throws(() => parseStooqCsv("", "AAPL"), /kein CSV/);
    assert.throws(() => parseStooqCsv("<html><body>error</body></html>", "AAPL"), /kein CSV/);
  });

  it("bevorzugt bei Tiingo adjClose und sortiert aufsteigend", () => {
    const bars = parseTiingoJson([
      { date: "2026-08-19T00:00:00.000Z", close: 200, adjClose: 100 },
      { date: "2026-08-17T00:00:00.000Z", close: 190, adjClose: 95 },
      { date: "2026-08-18T00:00:00.000Z", close: 0, adjClose: null },
    ], "AAPL");
    assert.deepEqual(bars, [{ date: "2026-08-17", close: 95 }, { date: "2026-08-19", close: 100 }]);
    assert.throws(() => parseTiingoJson({ detail: "Not authorized" }, "AAPL"), /kein Array/);
  });

  it("dedupliziert doppelte Handelstage", () => {
    assert.deepEqual(
      parseTiingoJson([{ date: "2026-08-17T00:00:00Z", adjClose: 1 }, { date: "2026-08-17T00:00:00Z", adjClose: 2 }], "X"),
      [{ date: "2026-08-17", close: 2 }]
    );
  });

  it("bildet Doppelklassen-Ticker auf die Stooq-Schreibweise ab", () => {
    assert.equal(toStooqSymbol("BRK.B"), "brk-b.us");
    assert.equal(toStooqSymbol(" aapl "), "aapl.us");
  });

  it("wählt den Anbieter nach vorhandenem Key", () => {
    assert.equal(resolveProvider({}), "stooq");
    assert.equal(resolveProvider({ TIINGO_API_KEY: "k" }), "tiingo");
  });

  const series = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"]
    .map((date, i) => ({ date, close: 100 + i * 10 }));

  // Der Einstieg liegt STRIKT nach dem Signaltag: Form-4-Meldungen laufen über den ganzen Tag ein,
  // ein Einstieg zum Schluss desselben Tages würde den Backtest besser aussehen lassen, als er ist.
  it("findet den ersten Handelstag nach dem Signal", () => {
    assert.equal(firstBarAfter(series, "2026-08-04"), 2);
    assert.equal(firstBarAfter(series, "2026-08-01"), 0, "Signal vor Serienbeginn");
    assert.equal(firstBarAfter(series, "2026-08-07"), null, "Serie endet am Signaltag");
    assert.equal(indexOfDateOnOrBefore(series, "2026-08-05"), 2);
    assert.equal(indexOfDateOnOrBefore(series, "2026-08-01"), null);
  });

  it("rechnet Vorwärtsrenditen über Handelstage", () => {
    near(forwardReturn(series, 0, 2), 0.2, "120/100 − 1");
    assert.equal(forwardReturn(series, 3, 5), null, "Serie reicht nicht bis zum Horizontende");
    assert.equal(forwardReturn(series, -1, 1), null);
  });

  it("misst die Benchmark-Rendite über dieselbe Kalenderspanne", () => {
    const bench = [{ date: "2026-08-04", close: 50 }, { date: "2026-08-06", close: 55 }];
    near(benchmarkReturnBetween(bench, "2026-08-05", "2026-08-07"), 0.1, "je nächstfrüherer Handelstag");
    assert.equal(benchmarkReturnBetween(bench, "2026-08-01", "2026-08-06"), null, "Benchmark beginnt später");
  });

  it("holt Kurse beim richtigen Anbieter und hält den Key aus der URL", async () => {
    let seenUrl;
    let seenHeaders;
    const mockFetch = async (url, init) => {
      seenUrl = String(url);
      seenHeaders = init?.headers;
      return { ok: true, text: async () => csv, json: async () => [{ date: "2026-08-19T00:00:00Z", adjClose: 7 }] };
    };

    const bars = await fetchDailyCloses("BRK.B", { provider: "stooq", from: "2026-08-19", fetchImpl: mockFetch });
    assert.match(seenUrl, /s=brk-b\.us/);
    assert.match(seenUrl, /d1=20260819/);
    assert.deepEqual(bars.map((b) => b.date), ["2026-08-19", "2026-08-20"], "--from filtert auch clientseitig nach");

    await fetchDailyCloses("AAPL", { provider: "tiingo", apiKey: "secret", fetchImpl: mockFetch });
    assert.equal(seenHeaders.Authorization, "Token secret");
    assert.doesNotMatch(seenUrl, /secret/, "der Key darf nie in einer URL landen (Logs, Fehlermeldungen)");
  });

  it("meldet HTTP- und Konfigurationsfehler, statt sie zu verschlucken", async () => {
    await assert.rejects(
      fetchDailyCloses("AAPL", { provider: "stooq", fetchImpl: async () => ({ ok: false, status: 429 }) }),
      /Stooq 429/
    );
    await assert.rejects(
      fetchDailyCloses("AAPL", { provider: "tiingo", apiKey: null, fetchImpl: async () => ({ ok: true }) }),
      /TIINGO_API_KEY fehlt/
    );
  });
});
