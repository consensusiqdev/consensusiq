/**
 * Auswertungs-Statistik für die Signal-Score-Forschung: nimmt fertige Signal-Ereignisse mit ihren
 * Vorwärtsrenditen entgegen und beantwortet die eigentliche Frage — welche Bestandteile des Scores
 * sagen tatsächlich etwas vorher, und welche sind Rauschen.
 *
 * Bewusst ohne jeden Wert-Import (nur `import type`): dadurch lässt sich die Datei direkt aus einem
 * .mjs-Skript unter node laden (Node ≥22 strippt Typen selbst), ohne Bundler, Alias-Loader oder
 * zusätzliche Dependency. Was das Modul an Score-Logik braucht, bekommt es als Funktion
 * hereingereicht (siehe `ScoreVariant`) — damit gibt es weiterhin genau eine Definition der
 * Score-Formel, nämlich `scoreFromComponents()` in src/lib/consensus.ts.
 *
 * Rein rechnende Bibliothek: kein Netz, keine Datenbank, keine Ausgabe. Das Zusammensuchen der
 * Daten und das Formatieren des Berichts liegt in scripts/backtest.mjs.
 */
import type { ScoreComponents, ScoreWeights } from "@/lib/consensus";
import type { TransactionSide } from "@/types/filing";

/**
 * Unterhalb dieser Stichprobengröße wird jede Kennzahl als unbelastbar markiert. 30 ist kein
 * magischer Wert, sondern die übliche Faustregel, ab der eine t-Statistik überhaupt anfängt,
 * ungefähr zu stimmen — bei weniger Ereignissen entscheiden ein, zwei Ausreißer das Vorzeichen.
 */
export const MIN_RELIABLE_SAMPLE = 30;

/** Auswertungshorizonte in Handelstagen: ~1 Woche, ~1 Monat, ~1 Quartal. */
export const DEFAULT_HORIZONS = [5, 21, 63] as const;

export type HorizonReturns = {
  /** Rendite des Tickers selbst. */
  raw: number;
  /** Rendite des Referenzindex über dieselbe Kalenderspanne. */
  benchmark: number;
  /** raw − benchmark. Die einzige Zahl, die für "hat das Signal funktioniert" zählt. */
  excess: number;
};

/**
 * Ein Signal, wie es an einem bestimmten Tag auf dem Dashboard gestanden HÄTTE, plus was danach
 * mit dem Kurs passiert ist. `cohortDate` ist der Beobachtungstag: in die zugrunde liegende
 * Konsens-Berechnung dürfen ausschließlich Meldungen mit `filedDate <= cohortDate` eingeflossen
 * sein, sonst enthält das Ergebnis Wissen aus der Zukunft und der ganze Backtest ist wertlos.
 */
export type SignalEvent = {
  cohortDate: string;
  ticker: string;
  side: TransactionSide;
  leadCount: number;
  totalValueAll: number;
  /** Anteil der Insider auf der führenden Seite mit C-Suite-Titel (0..1). */
  cSuiteShare: number;
  /** Mindestens ein "frisch eingestiegener" Insider auf der führenden Seite. */
  hasFreshInsider: boolean;
  components: ScoreComponents;
  /** Score nach der aktuell live geschalteten Formel. */
  signalScore: number;
  /** Handelstag des unterstellten Einstiegs (erster Handelstag NACH cohortDate). */
  entryDate: string;
  /** Pro Horizont in Handelstagen; fehlt, wenn die Kurshistorie noch nicht so weit reicht. */
  returns: Record<number, HorizonReturns | undefined>;
};

/** Eine zu testende Score-Variante — Label plus die Funktion, die den Score neu berechnet. */
export type ScoreVariant = {
  label: string;
  weights?: ScoreWeights;
  score: (components: ScoreComponents, side: TransactionSide) => number;
};

// ---------------------------------------------------------------------------
// Statistische Grundlagen
// ---------------------------------------------------------------------------

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Stichproben-Standardabweichung (n−1). */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  // Konstante Reihe: Korrelation ist undefiniert, nicht 0 (passiert real, z.B. wenn alle Signale
  // eines Laufs denselben gerundeten Score tragen).
  if (varX === 0 || varY === 0) return null;
  return cov / Math.sqrt(varX * varY);
}

/** Ränge mit Durchschnittsrang bei Gleichstand — bei einem auf ganze Zahlen gerundeten Score sind
 * Gleichstände die Regel, nicht die Ausnahme, und naive Ränge würden sie willkürlich auflösen. */
export function ranks(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) result[order[k].index] = averageRank;
    i = j + 1;
  }
  return result;
}

/**
 * Spearman-Rangkorrelation — in der Quant-Sprache der "Information Coefficient" (IC) eines
 * Signals. Rang statt Pearson, weil Renditeverteilungen fette Ränder haben: ein einzelner
 * Übernahmekandidat mit +80 % würde eine Pearson-Korrelation im Alleingang bestimmen.
 *
 * Grobe Einordnung aus der Praxis: |IC| < 0,02 ist nichts, 0,03–0,05 ist ein real nutzbares
 * Signal, > 0,10 über viele Ereignisse ist außergewöhnlich (und meist ein Hinweis auf einen
 * Lookahead-Fehler im Aufbau).
 */
export function spearman(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  return pearson(ranks(xs.slice(0, n)), ranks(ys.slice(0, n)));
}

/** t-Statistik einer Korrelation gegen H0: ρ = 0. */
export function correlationTStat(r: number, n: number): number | null {
  if (n < 3 || Math.abs(r) >= 1) return null;
  return r * Math.sqrt((n - 2) / (1 - r * r));
}

/** t-Statistik des Mittelwerts gegen H0: μ = 0. |t| > 2 ist die übliche Daumenregel. */
export function tStat(values: number[]): number | null {
  if (values.length < 2) return null;
  const sd = stdDev(values);
  if (sd === 0) return null;
  return mean(values) / (sd / Math.sqrt(values.length));
}

/** Welch-t für zwei Gruppen mit ungleicher Varianz/Größe (z.B. Kauf- gegen Verkaufsseite). */
export function welchTTest(
  a: number[],
  b: number[]
): { t: number; df: number; meanA: number; meanB: number; diff: number } | null {
  if (a.length < 2 || b.length < 2) return null;
  const varA = stdDev(a) ** 2 / a.length;
  const varB = stdDev(b) ** 2 / b.length;
  const denominator = varA + varB;
  if (denominator === 0) return null;
  const meanA = mean(a);
  const meanB = mean(b);
  return {
    t: (meanA - meanB) / Math.sqrt(denominator),
    df: denominator ** 2 / (varA ** 2 / (a.length - 1) + varB ** 2 / (b.length - 1)),
    meanA,
    meanB,
    diff: meanA - meanB,
  };
}

/** Teilt nach `value` sortiert in `count` möglichst gleich große Gruppen (aufsteigend). */
export function quantileBuckets<T>(items: T[], value: (item: T) => number, count: number): T[][] {
  if (items.length === 0 || count < 1) return [];
  const sorted = [...items].sort((a, b) => value(a) - value(b));
  const buckets: T[][] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * sorted.length) / count);
    const end = Math.floor(((i + 1) * sorted.length) / count);
    if (end > start) buckets.push(sorted.slice(start, end));
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Auswertungen
// ---------------------------------------------------------------------------

/** Ereignisse, für die der Horizont schon vollständig verstrichen ist. */
export function eventsWithReturns(events: SignalEvent[], horizon: number): SignalEvent[] {
  return events.filter((e) => e.returns[horizon] !== undefined);
}

function excessOf(event: SignalEvent, horizon: number): number {
  return event.returns[horizon]!.excess;
}

/**
 * Überrendite IN RICHTUNG des Signals: bei Kaufkonsens die Überrendite selbst, bei Verkaufskonsens
 * die negierte. Positiv heißt damit auf beiden Seiten dasselbe — "das Signal lag richtig" — und
 * erst dadurch lassen sich Kauf- und Verkaufssignale überhaupt zusammen mitteln.
 */
function directionalExcessOf(event: SignalEvent, horizon: number): number {
  return excessOf(event, horizon) * (event.side === "BUY" ? 1 : -1);
}

export type HorizonSummary = {
  horizon: number;
  n: number;
  /** Spearman(signalScore, Überrendite). Positiv = der Score zeigt in die richtige Richtung. */
  ic: number | null;
  icTStat: number | null;
  /** Mittlere Überrendite in Signalrichtung — positiv = die Signale lagen im Mittel richtig. */
  meanDirectionalExcess: number;
  medianDirectionalExcess: number;
  meanDirectionalTStat: number | null;
  /** Anteil der Ereignisse, bei denen die Richtung des Signals zur Überrendite passte. */
  directionalHitRate: number;
  reliable: boolean;
};

/**
 * Kernauswertung pro Horizont.
 *
 * Wichtig zur Lesart von `directionalHitRate`: das Vorzeichen des Scores ist per Konstruktion immer
 * das der führenden Seite (Kauf = positiv, Verkauf = negativ). Die Trefferquote misst deshalb
 * ausschließlich, ob die Kauf/Verkauf-Einschätzung stimmte — sie sagt nichts über die Stärke des
 * Scores und ändert sich folglich auch nicht, wenn man die Gewichte verschiebt. Für die Stärke
 * sind IC und die Long/Short-Spanne zuständig.
 */
export function summarizeHorizon(events: SignalEvent[], horizon: number): HorizonSummary {
  const usable = eventsWithReturns(events, horizon);
  const scores = usable.map((e) => e.signalScore);
  const excess = usable.map((e) => excessOf(e, horizon));
  const directionalExcess = usable.map((e) => directionalExcessOf(e, horizon));
  const ic = spearman(scores, excess);

  const directional = usable.filter((e) => e.signalScore !== 0 && excessOf(e, horizon) !== 0);
  const hits = directional.filter((e) => Math.sign(e.signalScore) === Math.sign(excessOf(e, horizon)));

  return {
    horizon,
    n: usable.length,
    ic,
    icTStat: ic === null ? null : correlationTStat(ic, usable.length),
    meanDirectionalExcess: mean(directionalExcess),
    medianDirectionalExcess: median(directionalExcess),
    meanDirectionalTStat: tStat(directionalExcess),
    directionalHitRate: directional.length === 0 ? 0 : hits.length / directional.length,
    reliable: usable.length >= MIN_RELIABLE_SAMPLE,
  };
}

export type BucketRow = {
  label: string;
  n: number;
  meanScore: number;
  meanExcess: number;
  medianExcess: number;
  shareOutperforming: number;
};

/**
 * Score-Quantile gegen Überrendite. Die Frage dahinter ist nicht "ist der Mittelwert positiv",
 * sondern ob die Überrendite über die Buckets hinweg MONOTON steigt — ein Score, bei dem ein +80
 * nicht verlässlich besser abschneidet als ein +20, ist als Rangfolge unbrauchbar, selbst wenn er
 * im Mittel richtig liegt.
 */
export function bucketByScore(events: SignalEvent[], horizon: number, bucketCount = 5): BucketRow[] {
  const usable = eventsWithReturns(events, horizon);
  return quantileBuckets(usable, (e) => e.signalScore, bucketCount).map((bucket, index) => {
    const excess = bucket.map((e) => excessOf(e, horizon));
    const scores = bucket.map((e) => e.signalScore);
    return {
      label: `Q${index + 1} (Score ${formatRange(scores)})`,
      n: bucket.length,
      meanScore: mean(scores),
      meanExcess: mean(excess),
      medianExcess: median(excess),
      shareOutperforming: excess.filter((r) => r > 0).length / (excess.length || 1),
    };
  });
}

function formatRange(values: number[]): string {
  if (values.length === 0) return "–";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? `${min}` : `${min}…${max}`;
}

/**
 * Mittlere Überrendite des obersten Score-Quantils minus die des untersten — die praktische
 * Übersetzung von "der Score funktioniert": das ist, was ein Long/Short-Korb verdient hätte, der
 * die stärksten Kaufsignale kauft und die stärksten Verkaufssignale leerverkauft.
 */
export function longShortSpread(
  events: SignalEvent[],
  horizon: number,
  score: (event: SignalEvent) => number,
  bucketCount = 5
): { spread: number; n: number; tStat: number | null } | null {
  const usable = eventsWithReturns(events, horizon);
  const buckets = quantileBuckets(usable, score, bucketCount);
  if (buckets.length < 2) return null;

  const top = buckets[buckets.length - 1].map((e) => excessOf(e, horizon));
  const bottom = buckets[0].map((e) => excessOf(e, horizon));
  const welch = welchTTest(top, bottom);
  return {
    spread: mean(top) - mean(bottom),
    n: top.length + bottom.length,
    tStat: welch?.t ?? null,
  };
}

export type ComponentIc = {
  component: string;
  /** IC des richtungsbehafteten Bestandteils gegen die Überrendite — siehe `componentIcs()`. */
  ic: number | null;
  tStat: number | null;
  /** IC innerhalb der Signalrichtung: misst die STÄRKE, nicht die Kauf/Verkauf-Einschätzung. */
  withinSideIc: number | null;
  withinSideTStat: number | null;
  n: number;
};

/**
 * Wie gut sagt jeder einzelne Bestandteil für sich die Überrendite vorher? Zwei Kennzahlen, weil
 * die beiden zusammen erst die Frage beantworten, für die dieses Werkzeug gebaut ist:
 *
 * `ic` — der mit dem Vorzeichen der führenden Seite versehene Bestandteil gegen die Überrendite.
 * Direkt vergleichbar mit dem IC des Gesamtscores. ACHTUNG: dieser Wert enthält zwangsläufig auch
 * den Effekt der Kauf/Verkauf-Einschätzung, weil jeder Bestandteil dasselbe Vorzeichen bekommt.
 * Taugen alle Kaufsignale etwas, sieht dadurch JEDER Bestandteil gut aus, auch ein völlig
 * uninformativer — die vier Werte sind deshalb nicht dafür geeignet, Bestandteile untereinander
 * zu vergleichen.
 *
 * `withinSideIc` — der rohe Bestandteil gegen die Überrendite in Signalrichtung. Der gemeinsame
 * Seiteneffekt fällt heraus, übrig bleibt genau die Frage: sagt ein HÖHERER Wert dieses
 * Bestandteils innerhalb derselben Richtung eine größere Bewegung voraus? Das ist die Zahl, auf
 * die es bei der Gewichtung ankommt; nahe 0 heißt, der Bestandteil trägt nichts bei.
 */
export function componentIcs(
  events: SignalEvent[],
  horizon: number,
  componentKeys: readonly (keyof ScoreComponents)[]
): ComponentIc[] {
  const usable = eventsWithReturns(events, horizon);
  const excess = usable.map((e) => excessOf(e, horizon));
  const directionalExcess = usable.map((e) => directionalExcessOf(e, horizon));

  return componentKeys.map((key) => {
    const raw = usable.map((e) => e.components[key]);
    const signed = usable.map((e, i) => raw[i] * (e.side === "BUY" ? 1 : -1));
    const ic = spearman(signed, excess);
    const withinSideIc = spearman(raw, directionalExcess);
    return {
      component: key,
      ic,
      tStat: ic === null ? null : correlationTStat(ic, usable.length),
      withinSideIc,
      withinSideTStat: withinSideIc === null ? null : correlationTStat(withinSideIc, usable.length),
      n: usable.length,
    };
  });
}

export type VariantResult = {
  label: string;
  n: number;
  ic: number | null;
  icTStat: number | null;
  /** IC der Score-STÄRKE innerhalb der Signalrichtung — siehe `evaluateVariants()`. */
  strengthIc: number | null;
  longShortSpread: number | null;
};

/**
 * Dieselben Ereignisse unter alternativen Gewichtungen neu bewertet — das eigentliche
 * Optimierungswerkzeug. Weil nur die Gewichte variieren und die Ereignisse identisch bleiben, ist
 * der Vergleich zwischen den Varianten sauber (dieselbe Stichprobe, dieselben Kurse); nur der
 * ABSTAND zur Referenzvariante ist aussagekräftig, nicht der absolute IC einer einzelnen.
 *
 * `strengthIc` ist dabei die trennschärfere der beiden Kennzahlen: das Vorzeichen des Scores hängt
 * nur an der führenden Seite und ist über alle Varianten hinweg identisch, die Gewichte verändern
 * ausschließlich den BETRAG. `ic` misst beides zusammen und wird dadurch vom (unveränderlichen)
 * Seiteneffekt dominiert; `strengthIc` vergleicht nur den Betrag mit der Bewegung in
 * Signalrichtung und zeigt deshalb Gewichtungsunterschiede sehr viel deutlicher.
 *
 * Der übliche Fallstrick: wer genug Varianten durchprobiert, findet immer eine, die auf DIESER
 * Stichprobe besser aussieht. Ein Vorsprung ist erst dann ein Ergebnis, wenn er über mehrere
 * Horizonte hinweg stabil ist und auf einer separaten Zeitspanne standhält (--split im Skript).
 */
export function evaluateVariants(
  events: SignalEvent[],
  horizon: number,
  variants: ScoreVariant[],
  bucketCount = 5
): VariantResult[] {
  const usable = eventsWithReturns(events, horizon);
  const excess = usable.map((e) => excessOf(e, horizon));
  const directionalExcess = usable.map((e) => directionalExcessOf(e, horizon));

  return variants.map((variant) => {
    const scoreOf = (event: SignalEvent) => variant.score(event.components, event.side);
    const scores = usable.map(scoreOf);
    const ic = spearman(scores, excess);

    return {
      label: variant.label,
      n: usable.length,
      ic,
      icTStat: ic === null ? null : correlationTStat(ic, usable.length),
      strengthIc: spearman(scores.map(Math.abs), directionalExcess),
      longShortSpread: longShortSpread(usable, horizon, scoreOf, bucketCount)?.spread ?? null,
    };
  });
}

export type GroupComparison = {
  label: string;
  groupA: { label: string; n: number; meanExcess: number };
  groupB: { label: string; n: number; meanExcess: number };
  diff: number;
  tStat: number | null;
};

/** Mittlere Überrendite zweier Teilmengen gegeneinander — für die Ja/Nein-Merkmale (Kauf- gegen
 * Verkaufsseite, C-Suite, frisch eingestiegene Insider), die keine 0..1-Skala haben und daher
 * nicht in `componentIcs()` passen. */
export function compareGroups(
  events: SignalEvent[],
  horizon: number,
  label: string,
  predicate: (event: SignalEvent) => boolean,
  labels: { a: string; b: string }
): GroupComparison {
  const usable = eventsWithReturns(events, horizon);
  const a = usable.filter(predicate).map((e) => excessOf(e, horizon));
  const b = usable.filter((e) => !predicate(e)).map((e) => excessOf(e, horizon));
  const welch = welchTTest(a, b);

  return {
    label,
    groupA: { label: labels.a, n: a.length, meanExcess: mean(a) },
    groupB: { label: labels.b, n: b.length, meanExcess: mean(b) },
    diff: mean(a) - mean(b),
    tStat: welch?.t ?? null,
  };
}

/**
 * Prüft die Kauf/Verkauf-Asymmetrie (aktuell ×1,15 / ×0,85) an den Daten: verdient ein Kaufsignal
 * wirklich mehr Überrendite, als ein Verkaufssignal kostet? Die Multiplikatoren sind aus der
 * Literatur übernommen und bisher nie an der eigenen Stichprobe nachgerechnet worden.
 *
 * `impliedBuyEdge` ist das Verhältnis der beiden gemessenen Effektstärken, auf dieselbe Skala wie
 * buyMultiplier/sellMultiplier gebracht: liegt es deutlich unter 1,15/0,85 ≈ 1,35, ist die
 * Asymmetrie zu stark eingestellt, liegt es darüber, zu schwach. Null, solange eine Seite keinen
 * messbaren Effekt zeigt (dann sagen die Daten schlicht nichts über das Verhältnis).
 */
export function evaluateSideAsymmetry(
  events: SignalEvent[],
  horizon: number
): {
  buy: { n: number; meanExcess: number; tStat: number | null };
  sell: { n: number; meanExcess: number; tStat: number | null };
  impliedBuyEdge: number | null;
} {
  const usable = eventsWithReturns(events, horizon);
  const buy = usable.filter((e) => e.side === "BUY").map((e) => excessOf(e, horizon));
  // Verkaufssignale zeigen nach unten: das Vorzeichen wird gedreht, damit "hat funktioniert" auf
  // beiden Seiten dasselbe bedeutet (positiv = die Richtung des Signals war richtig).
  const sell = usable.filter((e) => e.side === "SELL").map((e) => -excessOf(e, horizon));

  const buyEdge = mean(buy);
  const sellEdge = mean(sell);
  return {
    buy: { n: buy.length, meanExcess: buyEdge, tStat: tStat(buy) },
    sell: { n: sell.length, meanExcess: sellEdge, tStat: tStat(sell) },
    impliedBuyEdge: buyEdge > 0 && sellEdge > 0 ? buyEdge / sellEdge : null,
  };
}
