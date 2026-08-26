// Signal-Score-Backtest: rekonstruiert, welche Signale an welchem Tag auf dem Dashboard gestanden
// HÄTTEN, misst ihre anschließende Überrendite gegenüber dem Referenzindex und rechnet aus, welche
// Bestandteile des Scores tatsächlich etwas vorhersagen.
//
// Läuft ausschließlich lokal/manuell. Es geht nichts davon live auf die Seite — das Ergebnis ist
// eine Entscheidungsgrundlage dafür, wie DEFAULT_SCORE_WEIGHTS in src/lib/consensus.ts eingestellt
// sein sollte.
//
//   node --env-file=.env.local scripts/backtest.mjs
//   node --env-file=.env.local scripts/backtest.mjs --window 30 --min-agree 2
//   node --env-file=.env.local scripts/backtest.mjs --split          # Out-of-Sample-Gegenprobe
//   node --env-file=.env.local scripts/backtest.mjs --json > report.json
//
// Voraussetzung: scripts/add-daily-prices-table.mjs und scripts/sync-prices.mjs sind gelaufen.
import { createClient } from "@libsql/client";
import {
  DEFAULT_SCORE_WEIGHTS,
  SCORE_COMPONENT_KEYS,
  computeConsensus,
  filterAndSortConsensus,
  scoreFromComponents,
} from "../src/lib/consensus.ts";
import {
  BENCHMARK_SYMBOL,
  benchmarkReturnBetween,
  firstBarAfter,
  forwardReturn,
} from "../src/lib/research/prices.ts";
import {
  DEFAULT_HORIZONS,
  MIN_RELIABLE_SAMPLE,
  bucketByScore,
  compareGroups,
  componentIcs,
  evaluateSideAsymmetry,
  evaluateVariants,
  eventsWithReturns,
  longShortSpread,
  summarizeHorizon,
} from "../src/lib/research/backtest.ts";

const COMPONENT_LABELS = {
  convictionRatio: "Kopfzahl-Anteil",
  dollarWeightedRatio: "Dollar-Anteil",
  avgHoldingsPct: "Ø Anteil Altbestand",
  clusterTightnessRatio: "Cluster-Enge",
};

const args = parseArgs(process.argv.slice(2));
const client = createDbClient();

// --- Daten laden -----------------------------------------------------------

// Die Spalte kommt erst mit scripts/add-backfilled-column.mjs. Ohne sie gibt es auch keine
// nachgeladenen Zeilen, die der Stichtag aussortieren müsste — also einmal nachsehen statt an
// einem rohen SQL-Fehler zu scheitern.
const hasBackfilledColumn = await columnExists("transactions", "backfilled");
const transactions = await loadTransactions();
const backfilledExcluded = hasBackfilledColumn ? await countExcludedBackfilled() : 0;
if (transactions.length === 0) {
  console.error("Keine Transaktionen in der Datenbank. Läuft der Ingest?");
  process.exit(1);
}

const benchmarkBars = await loadPriceSeries(BENCHMARK_SYMBOL);
if (benchmarkBars.length === 0) {
  console.error(`Keine Kurse für den Benchmark ${BENCHMARK_SYMBOL}. Erst 'node scripts/sync-prices.mjs' laufen lassen.`);
  process.exit(1);
}

const priceSeries = await loadAllPriceSeries();

// --- Kohorten bauen und auswerten ------------------------------------------

const { events, diagnostics } = buildEvents();
const report = buildReport();

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport();
}

// ---------------------------------------------------------------------------
// Kohortenbildung
// ---------------------------------------------------------------------------

/**
 * Für jeden Handelstag D im Auswertungszeitraum wird der Konsens exakt so berechnet, wie ihn das
 * Dashboard an diesem Tag gezeigt hätte — mit ausschließlich den Meldungen, die bis einschließlich
 * D eingereicht waren. Genau hier entsteht sonst der klassische Backtest-Fehler: `filedDate <= D`
 * ist die Grenze, nicht `transactionDate`. Der Handel selbst liegt typischerweise zwei Werktage vor
 * der Meldung, aber handelbar war die Information erst mit der Veröffentlichung.
 */
function buildEvents() {
  const sorted = [...transactions].sort((a, b) => a.filedDate.localeCompare(b.filedDate));
  const cohortDates = benchmarkBars
    .map((bar) => bar.date)
    .filter((date) => date >= args.from && date <= args.to);

  const built = [];
  const lastEmitted = new Map(); // ticker -> zuletzt ausgegebenes cohortDate
  const stats = { cohortDates: cohortDates.length, signalsSeen: 0, skippedCooldown: 0, skippedNoPrices: 0 };
  const missingPriceTickers = new Set();

  // Zwei Zeiger über die nach filedDate sortierte Liste statt eines Filters pro Kohortentag —
  // sonst ist der Lauf O(Handelstage × Transaktionen).
  let lo = 0;
  let hi = 0;

  for (const cohortDate of cohortDates) {
    const windowStart = isoDaysBefore(cohortDate, args.windowDays);
    while (hi < sorted.length && sorted[hi].filedDate <= cohortDate) hi++;
    // `>= windowStart`, identisch zu getFilteredSignals() in src/lib/signalsQuery.ts.
    while (lo < hi && sorted[lo].filedDate < windowStart) lo++;
    if (lo >= hi) continue;

    const window = sorted.slice(lo, hi);
    const signals = filterAndSortConsensus(computeConsensus(window, args.minUsd), args.minAgree, "score");
    if (signals.length === 0) continue;

    const flags = buildFlagLookup(window);

    for (const signal of signals) {
      stats.signalsSeen++;

      // Ein Signal bleibt über sein ganzes Fenster hinweg sichtbar und würde sonst an jedem
      // einzelnen Handelstag erneut gezählt — dieselbe Beobachtung mit fast derselben Rendite,
      // zehnfach. Das bläht die Stichprobe auf und lässt jede t-Statistik viel zu gut aussehen.
      const last = lastEmitted.get(signal.ticker);
      if (last && daysBetween(last, cohortDate) < args.cooldownDays) {
        stats.skippedCooldown++;
        continue;
      }

      const bars = priceSeries.get(signal.ticker);
      const entryIndex = bars ? firstBarAfter(bars, cohortDate) : null;
      if (!bars || entryIndex === null) {
        stats.skippedNoPrices++;
        missingPriceTickers.add(signal.ticker);
        continue;
      }

      lastEmitted.set(signal.ticker, cohortDate);
      built.push(makeEvent(signal, cohortDate, bars, entryIndex, flags));
    }
  }

  return {
    events: built,
    diagnostics: {
      ...stats,
      // Der tatsächlich abgedeckte Zeitraum, nicht die (meist offenen) --from/--to-Grenzen.
      cohortRange: [cohortDates[0] ?? null, cohortDates[cohortDates.length - 1] ?? null],
      missingPriceTickers: [...missingPriceTickers].sort(),
    },
  };
}

function makeEvent(signal, cohortDate, bars, entryIndex, flags) {
  const leadFilers = signal.sides[0].filers;
  const lookup = (filerId) => flags.get(`${signal.ticker}:${signal.leadSide}:${filerId}`);
  const cSuiteCount = leadFilers.filter((f) => lookup(f.filerId)?.cSuite).length;

  const entryDate = bars[entryIndex].date;
  const returns = {};
  for (const horizon of args.horizons) {
    const raw = forwardReturn(bars, entryIndex, horizon);
    if (raw === null) continue;
    const benchmark = benchmarkReturnBetween(benchmarkBars, entryDate, bars[entryIndex + horizon].date);
    if (benchmark === null) continue;
    returns[horizon] = { raw, benchmark, excess: raw - benchmark };
  }

  return {
    cohortDate,
    ticker: signal.ticker,
    side: signal.leadSide,
    leadCount: signal.leadCount,
    totalValueAll: signal.totalValueAll,
    cSuiteShare: leadFilers.length > 0 ? cSuiteCount / leadFilers.length : 0,
    hasFreshInsider: leadFilers.some((f) => lookup(f.filerId)?.fresh),
    components: {
      convictionRatio: signal.convictionRatio,
      dollarWeightedRatio: signal.dollarWeightedRatio,
      avgHoldingsPct: signal.avgHoldingsPct,
      clusterTightnessRatio: signal.clusterTightnessRatio,
    },
    signalScore: signal.signalScore,
    entryDate,
    returns,
  };
}

/** isCSuite/isFreshInsider hängen an der einzelnen Transaktion, der Konsens aggregiert aber auf
 * Person — ein Insider zählt als C-Suite, sobald eine seiner Meldungen im Fenster so markiert ist. */
function buildFlagLookup(window) {
  const flags = new Map();
  for (const tx of window) {
    const key = `${tx.ticker}:${tx.side}:${tx.filerId}`;
    const existing = flags.get(key);
    if (existing) {
      existing.cSuite ||= tx.isCSuite;
      existing.fresh ||= tx.isFreshInsider;
    } else {
      flags.set(key, { cSuite: tx.isCSuite, fresh: tx.isFreshInsider });
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Varianten
// ---------------------------------------------------------------------------

/**
 * Die zu vergleichenden Gewichtungen. "ohne X" setzt einen Bestandteil auf 0 (verbessert sich der
 * IC dadurch, schadet der Bestandteil mehr, als er nützt), "nur X" isoliert ihn (wie viel trägt er
 * allein?). Beides zusammen unterscheidet einen Bestandteil, der nichts beiträgt, von einem, der
 * dasselbe misst wie ein anderer.
 */
function buildVariants() {
  const variants = [
    {
      label: "Aktuell (live)",
      weights: DEFAULT_SCORE_WEIGHTS,
    },
    {
      label: "Ohne Seiten-Asymmetrie",
      weights: { ...DEFAULT_SCORE_WEIGHTS, buyMultiplier: 1, sellMultiplier: 1 },
    },
  ];

  for (const key of SCORE_COMPONENT_KEYS) {
    variants.push({ label: `Ohne ${COMPONENT_LABELS[key]}`, weights: { ...DEFAULT_SCORE_WEIGHTS, [key]: 0 } });
  }
  for (const key of SCORE_COMPONENT_KEYS) {
    const onlyThis = Object.fromEntries(SCORE_COMPONENT_KEYS.map((k) => [k, k === key ? 1 : 0]));
    variants.push({ label: `Nur ${COMPONENT_LABELS[key]}`, weights: { ...DEFAULT_SCORE_WEIGHTS, ...onlyThis } });
  }

  // scoreFromComponents() ist dieselbe Funktion, die die Live-App benutzt — die Varianten testen
  // damit die echte Formel und nicht eine nachgebaute Kopie davon.
  return variants.map((variant) => ({
    ...variant,
    score: (components, side) => scoreFromComponents(components, side, variant.weights),
  }));
}

// ---------------------------------------------------------------------------
// Bericht
// ---------------------------------------------------------------------------

function buildReport() {
  const variants = buildVariants();
  const primary = args.horizons.includes(21) ? 21 : args.horizons[args.horizons.length - 1];

  return {
    parameters: {
      windowDays: args.windowDays,
      minAgree: args.minAgree,
      minUsd: args.minUsd,
      cooldownDays: args.cooldownDays,
      horizons: args.horizons,
      from: args.from,
      to: args.to,
      includePlanTrades: args.includePlanTrades,
      trustFlagsFrom: args.trustFlagsFrom,
      benchmark: BENCHMARK_SYMBOL,
      buckets: args.buckets,
    },
    data: {
      transactions: transactions.length,
      filedRange: [transactions[0]?.filedDate, transactions[transactions.length - 1]?.filedDate],
      tickersWithPrices: priceSeries.size,
      backfilledExcluded,
      events: events.length,
      ...diagnostics,
    },
    primaryHorizon: primary,
    horizons: args.horizons.map((horizon) => ({
      ...summarizeHorizon(events, horizon),
      longShort: longShortSpread(events, horizon, (e) => e.signalScore, args.buckets),
    })),
    buckets: bucketByScore(events, primary, args.buckets),
    components: componentIcs(events, primary, SCORE_COMPONENT_KEYS),
    variants: args.horizons.map((horizon) => ({
      horizon,
      results: evaluateVariants(events, horizon, variants, args.buckets),
    })),
    sideAsymmetry: evaluateSideAsymmetry(events, primary),
    groups: [
      compareGroups(events, primary, "C-Suite-geführt", (e) => e.cSuiteShare >= 0.5, {
        a: "≥50 % C-Suite",
        b: "übrige",
      }),
      compareGroups(events, primary, "Frisch eingestiegener Insider", (e) => e.hasFreshInsider, {
        a: "mit",
        b: "ohne",
      }),
      compareGroups(events, primary, "Breiter Konsens", (e) => e.leadCount >= args.minAgree + 2, {
        a: `≥${args.minAgree + 2} Insider`,
        b: "weniger",
      }),
    ],
    split: args.split ? buildSplit(variants, primary) : null,
  };
}

/**
 * Out-of-Sample-Gegenprobe: dieselbe Variantentabelle, einmal auf der älteren und einmal auf der
 * jüngeren Hälfte der Ereignisse. Eine Gewichtung, die nur auf einer Hälfte vorn liegt, ist an das
 * Rauschen dieser Hälfte angepasst und keine Verbesserung — das ist die wichtigste Zahl im ganzen
 * Bericht, wenn es darum geht, DEFAULT_SCORE_WEIGHTS wirklich zu ändern.
 */
function buildSplit(variants, horizon) {
  const usable = eventsWithReturns(events, horizon).sort((a, b) => a.cohortDate.localeCompare(b.cohortDate));
  if (usable.length < 4) return null;

  const mid = Math.floor(usable.length / 2);
  const first = usable.slice(0, mid);
  const second = usable.slice(mid);
  return {
    horizon,
    first: {
      range: [first[0].cohortDate, first[first.length - 1].cohortDate],
      results: evaluateVariants(first, horizon, variants, args.buckets),
    },
    second: {
      range: [second[0].cohortDate, second[second.length - 1].cohortDate],
      results: evaluateVariants(second, horizon, variants, args.buckets),
    },
  };
}

function printReport() {
  const { data, parameters } = report;

  heading("Datengrundlage");
  console.log(`  Transaktionen        ${data.transactions} (${data.filedRange[0]} … ${data.filedRange[1]})`);
  console.log(`  Kohortentage         ${data.cohortDates} Handelstage (${data.cohortRange[0]} … ${data.cohortRange[1]})`);
  console.log(`  Ticker mit Kursen    ${data.tickersWithPrices}`);
  console.log(`  Signale gesehen      ${data.signalsSeen}`);
  console.log(`  davon übersprungen   ${data.skippedCooldown} (Cooldown ${parameters.cooldownDays}d), ${data.skippedNoPrices} (keine Kurse)`);
  console.log(`  Ereignisse           ${data.events}`);
  console.log(
    `  Parameter            Fenster ${parameters.windowDays}d · min. ${parameters.minAgree} Insider · min. $${parameters.minUsd} · Benchmark ${parameters.benchmark}` +
      (parameters.includePlanTrades ? " · inkl. 10b5-1-Planhandel" : "")
  );
  if (data.backfilledExcluded > 0) {
    console.log(
      `  Nachgeladen ignoriert  ${data.backfilledExcluded} Zeilen vor ${parameters.trustFlagsFrom} (Planhandel-Kennzeichen fehlt dort)`
    );
  }
  if (data.missingPriceTickers.length > 0) {
    const preview = data.missingPriceTickers.slice(0, 12).join(", ");
    const rest = data.missingPriceTickers.length > 12 ? ` … (+${data.missingPriceTickers.length - 12})` : "";
    console.log(`  Ohne Kursdaten       ${preview}${rest}`);
  }

  heading("Gesamtbild pro Horizont");
  table(
    ["Horizont", "n", "IC", "t(IC)", "Richtung getroffen", "Ø Effekt in Signalrichtung", "t", "Long/Short"],
    report.horizons.map((h) => [
      `${h.horizon} Handelstage`,
      String(h.n),
      fmtIc(h.ic),
      fmtNum(h.icTStat),
      fmtPctOf(h.directionalHitRate, h.n, false),
      fmtPctOf(h.meanDirectionalExcess, h.n),
      fmtNum(h.meanDirectionalTStat),
      h.longShort && h.longShort.n > 0 ? fmtPct(h.longShort.spread) : "–",
    ])
  );
  console.log("  IC = Spearman(Score, Überrendite). Positiv heißt: der Score zeigt in die richtige Richtung.");
  console.log("  Richtung getroffen = Anteil, bei dem die Kauf/Verkauf-Einschätzung stimmte (0,50 = Münzwurf).");
  console.log("  Ø Effekt in Signalrichtung = Überrendite, bei Verkaufssignalen negiert — positiv = Signal lag richtig.");
  console.log("  Long/Short = was ein Korb aus stärkstem Kauf-Quantil long und stärkstem Verkaufs-Quantil short gebracht hätte.");

  heading(`Score-Quantile (${report.primaryHorizon} Handelstage)`);
  if (report.buckets.length === 0) {
    console.log("  Noch keine Ereignisse mit abgeschlossenem Horizont.");
  } else {
    table(
      ["Bucket", "n", "Ø Score", "Ø Überrendite", "Median", "Anteil > Markt"],
      report.buckets.map((b) => [
        b.label,
        String(b.n),
        fmtNum(b.meanScore, 1),
        fmtPct(b.meanExcess),
        fmtPct(b.medianExcess),
        fmtPct(b.shareOutperforming, false),
      ])
    );
    console.log("  Entscheidend ist nicht das Vorzeichen einzelner Zeilen, sondern ob die Überrendite von Q1 nach Qn steigt.");
  }

  heading(`Bestandteile einzeln (${report.primaryHorizon} Handelstage)`);
  table(
    ["Bestandteil", "IC (mit Richtung)", "t", "IC (nur Stärke)", "t", "n"],
    report.components.map((c) => [
      COMPONENT_LABELS[c.component] ?? c.component,
      fmtIc(c.ic),
      fmtNum(c.tStat),
      fmtIc(c.withinSideIc),
      fmtNum(c.withinSideTStat),
      String(c.n),
    ])
  );
  console.log("  IC (mit Richtung) enthält zwangsläufig auch die Kauf/Verkauf-Einschätzung und sieht deshalb für");
  console.log("  JEDEN Bestandteil gut aus, solange die Seiten-Einschätzung stimmt — nicht zum Vergleich geeignet.");
  console.log("  IC (nur Stärke) rechnet den Seiteneffekt heraus: sagt ein höherer Wert innerhalb derselben Richtung");
  console.log("  eine größere Bewegung voraus? Nahe 0 heißt: der Bestandteil trägt nichts bei. Das ist die Zahl.");

  heading("Gewichtungs-Varianten");
  for (const { horizon, results } of report.variants) {
    const baseline = results[0];
    console.log(`\n  Horizont ${horizon} Handelstage (n = ${baseline?.n ?? 0}):`);
    table(
      ["Variante", "IC (nur Stärke)", "Δ vs. live", "IC (gesamt)", "Long/Short"],
      results.map((r) => [
        r.label,
        fmtIc(r.strengthIc),
        delta(r.strengthIc, baseline?.strengthIc),
        fmtIc(r.ic),
        r.longShortSpread === null ? "–" : fmtPct(r.longShortSpread),
      ]),
      1
    );
  }
  console.log("\n  Verglichen wird über 'IC (nur Stärke)': die Gewichte verändern ausschließlich den BETRAG des Scores,");
  console.log("  sein Vorzeichen hängt allein an der führenden Seite. Ein positives Δ heißt, diese Gewichtung hätte");
  console.log("  die Stärke besser getroffen als die aktuell live geschaltete.");

  if (report.split) {
    heading(`Out-of-Sample-Gegenprobe (${report.split.horizon} Handelstage)`);
    const bySecond = new Map(report.split.second.results.map((r) => [r.label, r]));
    const firstBase = report.split.first.results[0];
    const secondBase = bySecond.get(firstBase?.label);
    table(
      [
        "Variante",
        `Δ ${report.split.first.range[0]}…${report.split.first.range[1]}`,
        `Δ ${report.split.second.range[0]}…${report.split.second.range[1]}`,
        "Urteil",
      ],
      report.split.first.results.slice(1).map((r) => {
        const other = bySecond.get(r.label);
        const deltaFirst = diff(r.strengthIc, firstBase?.strengthIc);
        const deltaSecond = diff(other?.strengthIc, secondBase?.strengthIc);
        const verdict =
          deltaFirst === null || deltaSecond === null
            ? "–"
            : deltaFirst > 0 && deltaSecond > 0
              ? "besser auf beiden Hälften"
              : deltaFirst < 0 && deltaSecond < 0
                ? "schlechter auf beiden"
                : "uneinheitlich";
        return [r.label, fmtNum(deltaFirst, 3, true), fmtNum(deltaSecond, 3, true), verdict];
      }),
      1
    );
    console.log("  Δ = Vorsprung gegenüber der Live-Gewichtung auf der jeweiligen Hälfte (IC nur Stärke).");
    console.log("  Nur 'besser auf beiden Hälften' ist ein Grund, DEFAULT_SCORE_WEIGHTS anzufassen — alles andere");
    console.log("  ist an das Rauschen einer Hälfte angepasst.");
  }

  heading(`Kauf/Verkauf-Asymmetrie (${report.primaryHorizon} Handelstage)`);
  const { buy, sell, impliedBuyEdge } = report.sideAsymmetry;
  table(
    ["Seite", "n", "Ø Effekt in Signalrichtung", "t"],
    [
      ["Kauf-geführt", String(buy.n), fmtPctOf(buy.meanExcess, buy.n), fmtNum(buy.tStat)],
      ["Verkauf-geführt", String(sell.n), fmtPctOf(sell.meanExcess, sell.n), fmtNum(sell.tStat)],
    ]
  );
  const configured = DEFAULT_SCORE_WEIGHTS.buyMultiplier / DEFAULT_SCORE_WEIGHTS.sellMultiplier;
  console.log(`  Eingestelltes Verhältnis: ${configured.toFixed(2)} (${DEFAULT_SCORE_WEIGHTS.buyMultiplier} / ${DEFAULT_SCORE_WEIGHTS.sellMultiplier})`);
  console.log(
    impliedBuyEdge === null
      ? "  Gemessenes Verhältnis: nicht bestimmbar (mindestens eine Seite zeigt keinen positiven Effekt)."
      : `  Gemessenes Verhältnis: ${impliedBuyEdge.toFixed(2)} — ${
          impliedBuyEdge > configured ? "Asymmetrie eher zu schwach" : "Asymmetrie eher zu stark"
        } eingestellt.`
  );

  heading(`Merkmale (${report.primaryHorizon} Handelstage)`);
  table(
    ["Merkmal", "Gruppe A", "n", "Ø Überrendite", "Gruppe B", "n", "Ø Überrendite", "Δ", "t"],
    report.groups.map((g) => [
      g.label,
      g.groupA.label,
      String(g.groupA.n),
      fmtPctOf(g.groupA.meanExcess, g.groupA.n),
      g.groupB.label,
      String(g.groupB.n),
      fmtPctOf(g.groupB.meanExcess, g.groupB.n),
      fmtPctOf(g.diff, Math.min(g.groupA.n, g.groupB.n)),
      fmtNum(g.tStat),
    ])
  );

  printCaveats();
}

function printCaveats() {
  heading("Einordnung");
  const thin = report.horizons.filter((h) => !h.reliable);
  if (thin.length > 0) {
    console.log(
      `  ⚠  Zu wenig Daten für ${thin.map((h) => `${h.horizon}d (n=${h.n})`).join(", ")} — unter ${MIN_RELIABLE_SAMPLE} Ereignissen`
    );
    console.log("     entscheiden ein, zwei Ausreißer das Vorzeichen. Zahlen anschauen, aber nichts danach ändern.");
  }
  if (report.data.skippedNoPrices > 0) {
    const share = report.data.skippedNoPrices / Math.max(1, report.data.signalsSeen - report.data.skippedCooldown);
    console.log(`  ⚠  ${fmtPct(share, false)} der Signale ohne Kursdaten verworfen — das trifft bevorzugt kleine`);
    console.log("     und delistete Werte und verzerrt die Stichprobe, wenn der Anteil groß ist.");
  }
  console.log("  •  Einstieg ist immer der Schlusskurs des Handelstags NACH dem Signal; Gebühren, Spread und");
  console.log("     Marktwirkung sind nicht eingerechnet. Kleine Überrenditen sind real nicht handelbar.");
  console.log("  •  Signale verschiedener Ticker am selben Tag teilen dieselbe Marktlage. Die t-Werte behandeln");
  console.log("     sie trotzdem als unabhängig und fallen dadurch zu optimistisch aus.");
  console.log("  •  Wer genug Varianten durchprobiert, findet immer eine, die auf DIESER Stichprobe gewinnt.");
  console.log("     Ohne --split ist kein Δ IC ein hinreichender Grund, DEFAULT_SCORE_WEIGHTS anzufassen.");
}

// ---------------------------------------------------------------------------
// Datenzugriff
// ---------------------------------------------------------------------------

function createDbClient() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.error("TURSO_DATABASE_URL fehlt. Beispiel:");
    console.error("  node --env-file=.env.local scripts/backtest.mjs");
    process.exit(1);
  }
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
}

/**
 * Dieselbe Vorfilterung wie getFilteredSignals() in src/lib/signalsQuery.ts — nur P/S, kein
 * Handel rund um eine Emission, kein 10b5-1-Planhandel. Weicht das hier ab, misst der Backtest
 * einen Score, den es auf der Seite nie gab.
 *
 * `--include-plan-trades` hebt genau eine dieser Regeln auf: Planhandel ist aktuell komplett
 * ausgeschlossen, ohne dass je nachgerechnet wurde, ob er wirklich nichts beiträgt.
 *
 * Zusätzlich gilt ein Stichtag für nachgeladene Zeilen (`backfilled = 1`): SECs `aff10b5One` ist
 * erst seit der Regeländerung 2023 Pflichtfeld, ältere Meldungen kommen also ohne
 * Planhandel-Kennzeichen an und läsen sich als "kein Planhandel". Da der Score Planhandel
 * ausschließt, würden solche Zeilen den Backtest auf Signalen rechnen lassen, die die Live-App nie
 * erzeugt hätte — ohne dass an den Zahlen etwas auffiele. Zeilen aus dem Live-Ingest sind davon
 * nicht betroffen und bleiben unabhängig vom Stichtag drin. `--trust-flags-from` verschiebt die
 * Grenze bewusst; siehe src/lib/research/BACKFILL.md.
 */
async function loadTransactions() {
  const codes = "('P','S')";
  const planClause = args.includePlanTrades ? "" : " AND COALESCE(is_plan_trade, 0) = 0";
  const backfillClause = hasBackfilledColumn ? " AND (COALESCE(backfilled, 0) = 0 OR filed_date >= ?)" : "";
  const result = await client.execute({
    sql: `SELECT ticker, company_name, filer_id, filer_type, filer_name, filer_role, side, transaction_code,
            shares, price_per_share, value_usd, shares_owned_after, transaction_date, filed_date, source_url,
            COALESCE(is_c_suite, 0) AS is_c_suite, COALESCE(is_fresh_insider, 0) AS is_fresh_insider
       FROM transactions
      WHERE transaction_code IN ${codes}
        AND COALESCE(near_offering, 0) = 0${planClause}${backfillClause}
      ORDER BY filed_date ASC`,
    args: hasBackfilledColumn ? [args.trustFlagsFrom] : [],
  });

  return result.rows.map((row, index) => ({
    id: `${row.ticker}:${row.filer_id}:${row.transaction_date}:${index}`,
    filerId: row.filer_id,
    filerType: row.filer_type,
    filerName: row.filer_name,
    filerRole: row.filer_role ?? undefined,
    ticker: row.ticker,
    companyName: row.company_name,
    side: row.side,
    transactionCode: row.transaction_code ?? "P",
    shares: row.shares,
    pricePerShare: row.price_per_share,
    valueUsd: row.value_usd,
    sharesOwnedAfter: row.shares_owned_after,
    transactionDate: row.transaction_date,
    filedDate: row.filed_date,
    sourceUrl: row.source_url,
    accessionNumber: "",
    nearOffering: false,
    isPlanTrade: false,
    isCSuite: row.is_c_suite === 1,
    isFreshInsider: row.is_fresh_insider === 1,
  }));
}

/** Wie viele nachgeladene Zeilen der Stichtag oben aussortiert — nur zur Ausweisung im Bericht,
 * damit die Lücke sichtbar ist statt still zu wirken. */
async function columnExists(table, column) {
  const result = await client.execute(`PRAGMA table_info(${table})`);
  return result.rows.some((row) => row.name === column);
}

async function countExcludedBackfilled() {
  const result = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM transactions
           WHERE COALESCE(backfilled, 0) = 1 AND filed_date < ?`,
    args: [args.trustFlagsFrom],
  });
  return Number(result.rows[0]?.n ?? 0);
}

async function loadPriceSeries(ticker) {
  const result = await client.execute({
    sql: "SELECT date, close FROM daily_prices WHERE ticker = ? ORDER BY date ASC",
    args: [ticker],
  });
  return result.rows.map((row) => ({ date: row.date, close: Number(row.close) }));
}

async function loadAllPriceSeries() {
  const result = await client.execute("SELECT ticker, date, close FROM daily_prices ORDER BY ticker, date ASC");
  const series = new Map();
  for (const row of result.rows) {
    let bars = series.get(row.ticker);
    if (!bars) {
      bars = [];
      series.set(row.ticker, bars);
    }
    bars.push({ date: row.date, close: Number(row.close) });
  }
  return series;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function isoDaysBefore(isoDate, days) {
  return new Date(new Date(`${isoDate}T00:00:00Z`).getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  return (new Date(`${toIso}T00:00:00Z`) - new Date(`${fromIso}T00:00:00Z`)) / 86_400_000;
}

function heading(text) {
  console.log(`\n${text}`);
  console.log("─".repeat(Math.max(text.length, 60)));
}

/** Spaltenbreiten aus dem Inhalt; `numericFrom` = ab welcher Spalte rechtsbündig gesetzt wird. */
function table(headers, rows, numericFrom = 1) {
  if (rows.length === 0) {
    console.log("  (keine Daten)");
    return;
  }
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => String(row[i] ?? "").length))
  );
  const render = (cells) =>
    "  " + cells.map((cell, i) => (i >= numericFrom ? String(cell ?? "").padStart(widths[i]) : String(cell ?? "").padEnd(widths[i]))).join("  ");

  console.log(render(headers));
  console.log("  " + widths.map((w) => "─".repeat(w)).join("  "));
  for (const row of rows) console.log(render(row));
}

/** Differenz zweier Kennzahlen, null sobald eine davon fehlt. */
function diff(value, baseline) {
  return value === null || value === undefined || baseline === null || baseline === undefined
    ? null
    : value - baseline;
}

function delta(value, baseline) {
  const d = diff(value, baseline);
  return d === null ? "–" : fmtNum(d, 3, true);
}

function fmtNum(value, digits = 2, signed = false) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  const text = value.toFixed(digits);
  return signed && value > 0 ? `+${text}` : text;
}

function fmtIc(value) {
  return fmtNum(value, 3, true);
}

function fmtPct(value, signed = true) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  const text = `${(value * 100).toFixed(2)} %`;
  return signed && value > 0 ? `+${text}` : text;
}

/** Wie fmtPct, aber bei leerer Gruppe "–" statt "0.00 %" — ein Mittelwert über nichts ist keine
 * Messung von null, und genau so würde er sonst gelesen. */
function fmtPctOf(value, n, signed = true) {
  return n > 0 ? fmtPct(value, signed) : "–";
}

function parseArgs(argv) {
  const parsed = {
    windowDays: 14,
    minAgree: 3,
    minUsd: 1000,
    cooldownDays: null, // Vorgabe = windowDays, siehe unten
    horizons: [...DEFAULT_HORIZONS],
    from: "1900-01-01",
    to: new Date().toISOString().slice(0, 10),
    buckets: 5,
    includePlanTrades: false,
    // SECs aff10b5One-Checkbox ist erst seit der Regeländerung 2023 Pflicht — davor nachgeladene
    // Zeilen tragen kein Planhandel-Kennzeichen. Siehe loadTransactions().
    trustFlagsFrom: "2023-04-01",
    split: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--window") parsed.windowDays = requirePositiveInt(argv[++i], arg);
    else if (arg === "--min-agree") parsed.minAgree = requirePositiveInt(argv[++i], arg);
    else if (arg === "--min-usd") parsed.minUsd = requireNonNegativeNumber(argv[++i], arg);
    else if (arg === "--cooldown") parsed.cooldownDays = requireNonNegativeNumber(argv[++i], arg);
    else if (arg === "--buckets") parsed.buckets = requirePositiveInt(argv[++i], arg);
    else if (arg === "--horizons") parsed.horizons = argv[++i].split(",").map((h) => requirePositiveInt(h, arg));
    else if (arg === "--from") parsed.from = requireIsoDate(argv[++i], arg);
    else if (arg === "--to") parsed.to = requireIsoDate(argv[++i], arg);
    else if (arg === "--include-plan-trades") parsed.includePlanTrades = true;
    else if (arg === "--trust-flags-from") parsed.trustFlagsFrom = requireIsoDate(argv[++i], arg);
    else if (arg === "--split") parsed.split = true;
    else if (arg === "--json") parsed.json = true;
    else {
      console.error(`Unbekanntes Argument: ${arg}`);
      process.exit(1);
    }
  }

  // Ein Signal bleibt sein ganzes Fenster lang sichtbar — ein kürzerer Cooldown zählt dieselbe
  // Beobachtung mehrfach. Deshalb standardmäßig genau ein Fenster.
  if (parsed.cooldownDays === null) parsed.cooldownDays = parsed.windowDays;
  parsed.horizons = [...new Set(parsed.horizons)].sort((a, b) => a - b);
  return parsed;
}

function requirePositiveInt(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(`${flag} braucht eine ganze Zahl > 0, war: ${value}`);
    process.exit(1);
  }
  return parsed;
}

function requireNonNegativeNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.error(`${flag} braucht eine Zahl >= 0, war: ${value}`);
    process.exit(1);
  }
  return parsed;
}

function requireIsoDate(value, flag) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
    console.error(`${flag} braucht ein ISO-Datum (YYYY-MM-DD), war: ${value}`);
    process.exit(1);
  }
  return value;
}
