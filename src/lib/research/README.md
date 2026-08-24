# Signal-Score-Forschung (intern)

Werkzeug, um den Signal Score an echten Kursen nachzurechnen: hat ein kaufgeführtes Signal
tatsächlich outperformt, und welche der vier Bestandteile tragen dazu bei?

**Nichts davon geht live auf die Seite.** Das ist keine Nachlässigkeit, sondern der Punkt.

## Warum das lizenzrechtlich geht

Die Idee war schon einmal da und ist an den API-Rechten gescheitert. Der Fall, den die Anbieter
teuer lizenzieren, ist **Redistribution**: Kurse an Endnutzer weiterreichen — als Chart, als Zahl
im Dashboard, als Feld in einer API-Antwort. Das war die ursprünglich angedachte Variante, und
daran hat es zu Recht gehakt.

Was hier passiert, ist ein anderer Fall: Kurse werden lokal geholt, lokal verrechnet, und heraus
kommt eine eigene abgeleitete Kennzahl ("kaufgeführte Signale lagen nach 21 Handelstagen im Schnitt
X % über dem Markt"). Es verlässt kein einziger Kurswert das Haus.

Damit das nicht durch schleichende Bequemlichkeit kippt, ist die Grenze im Code gezogen und nicht
nur in der Absicht:

- Kein Modul unter `src/lib/research/` wird aus `src/app/**` importiert.
- Nichts hier hängt an `src/lib/db.ts` oder `server-only` — die Module laufen ausschließlich über
  die Skripte in `scripts/` und können gar nicht erst in einem Route-Bundle landen.
- Die Tabelle `daily_prices` wird von keinem Anwendungscode gelesen.
- Es gibt keinen Cron und keine API-Route dafür. Alles läuft manuell, lokal.

Wer das später aufweichen will (etwa einen Kurs im Dashboard zeigen), braucht vorher eine
Redistribution-Lizenz. Die Trennlinie verläuft genau hier.

## Einrichtung

```bash
node --env-file=.env.local scripts/add-daily-prices-table.mjs   # einmalig
npm run research:prices                                          # Kurse holen
npm run research:backtest                                        # auswerten
```

`npm run research:prices` holt End-of-Day-Kurse für jeden getrackten Ticker plus `SPY` als
Referenzindex. Zweitläufe laden nur ab dem letzten gespeicherten Handelstag nach.

**Anbieter:** ohne Konfiguration Stooq (kein Key, volle Historie). Stooq-Kurse sind
split-, aber **nicht dividendenbereinigt** — bei ausschüttungsstarken Werten fehlt die Dividende in
der Rendite, was Kaufsignale dort systematisch etwas zu schlecht aussehen lässt. Mit gesetztem
`TIINGO_API_KEY` wird stattdessen Tiingos `adjClose` verwendet (Splits **und** Dividenden). Für
belastbare Ergebnisse ist das die bessere Grundlage; das kostenlose Kontingent reicht für unsere
Tickerzahl.

Nach einem Anbieterwechsel einmal `npm run research:prices -- --force --from 2021-01-01`, sonst
liegen unterschiedlich bereinigte Kurse nebeneinander in einer Serie.

## Was der Backtest macht

Für jeden Handelstag D wird der Konsens genau so berechnet, wie ihn das Dashboard an diesem Tag
gezeigt hätte, und dann gemessen, was danach mit dem Kurs passiert ist.

Drei Punkte, an denen ein Backtest sonst falsch wird und die hier bewusst gesetzt sind:

1. **`filedDate`, nicht `transactionDate`.** Der Handel liegt typischerweise zwei Werktage vor der
   Meldung. Handelbar war die Information erst mit der Veröffentlichung. Wer auf das Handelsdatum
   abstellt, testet Wissen, das an diesem Tag niemand hatte.
2. **Einstieg am Folgetag.** Form-4-Meldungen laufen über den ganzen Tag ein; ein Einstieg zum
   Schluss des Signaltages unterstellt Wissen, das man um 9:30 Uhr noch nicht hatte.
3. **Überrendite gegen SPY, nicht absolute Rendite.** +8 % in einem Markt, der 10 % gemacht hat,
   ist keine gute Prognose. Ohne Benchmark misst ein Backtest hauptsächlich den Gesamtmarkt.

Dazu ein **Cooldown** (Vorgabe: ein Fenster): ein Signal bleibt über sein ganzes Fenster sichtbar
und würde sonst an jedem Handelstag erneut gezählt — dieselbe Beobachtung, zehnfach, mit fast
derselben Rendite. Das bläht die Stichprobe auf und lässt jede t-Statistik weit zu gut aussehen.

Bewertet wird mit derselben Funktion, die die Live-App benutzt (`scoreFromComponents()` in
`src/lib/consensus.ts`) — nicht mit einem Nachbau, der auseinanderlaufen kann.

## Wie der Bericht zu lesen ist

**IC (Information Coefficient)** — Rangkorrelation zwischen Score und Überrendite. Grobe
Einordnung aus der Praxis: unter 0,02 ist nichts, 0,03–0,05 ist ein real nutzbares Signal, über
0,10 über viele Ereignisse ist außergewöhnlich und meist ein Hinweis auf einen Fehler im Aufbau.

**Die wichtigste Unterscheidung im ganzen Bericht:**

| Spalte | misst |
|---|---|
| IC (mit Richtung) | Kauf/Verkauf-Einschätzung **und** Stärke zusammen |
| IC (nur Stärke) | nur die Stärke, Seiteneffekt herausgerechnet |

Das Vorzeichen des Scores hängt allein an der führenden Seite — Kauf ist positiv, Verkauf negativ,
immer. Taugen Kaufsignale generell etwas, sieht deshalb **jeder** Bestandteil in der
Richtungs-Spalte gut aus, auch ein völlig uninformativer. Zum Vergleichen von Bestandteilen und
Gewichtungen taugt nur die Stärke-Spalte. Aus demselben Grund ändert sich die Trefferquote nicht,
wenn man an den Gewichten dreht.

**Score-Quantile** — entscheidend ist nicht das Vorzeichen einzelner Zeilen, sondern ob die
Überrendite von Q1 nach Qn **monoton steigt**. Ein Score, bei dem ein +80 nicht verlässlich besser
abschneidet als ein +20, ist als Rangfolge unbrauchbar, auch wenn er im Mittel richtig liegt.

**Gewichtungs-Varianten** — "ohne X" setzt einen Bestandteil auf 0, "nur X" isoliert ihn. Steigt
der IC, wenn ein Bestandteil wegfällt, schadet er mehr, als er nützt.

## Bevor die Gewichte angefasst werden

```bash
npm run research:backtest -- --split
```

Das rechnet die Variantentabelle getrennt für die ältere und die jüngere Hälfte der Ereignisse.
**Nur eine Variante, die auf beiden Hälften vorn liegt, ist ein Grund, `DEFAULT_SCORE_WEIGHTS` in
`src/lib/consensus.ts` zu ändern.** Wer genug Varianten durchprobiert, findet immer eine, die auf
einer gegebenen Stichprobe gewinnt — das ist dann an deren Rauschen angepasst und hält in der
Zukunft nicht.

Weitere Grenzen, die der Bericht selbst am Ende ausweist:

- Gebühren, Spread und Marktwirkung sind nicht eingerechnet. Kleine Überrenditen sind real nicht
  handelbar.
- Signale verschiedener Ticker am selben Tag teilen dieselbe Marktlage. Die t-Werte behandeln sie
  trotzdem als unabhängig und fallen dadurch zu optimistisch aus.
- Signale ohne Kursdaten fallen aus der Stichprobe — und zwar nicht zufällig, sondern bevorzugt bei
  kleinen und delisteten Werten. Der Bericht weist den Anteil aus; wird er groß, ist die Stichprobe
  verzerrt.
- Unter 30 Ereignissen entscheiden ein, zwei Ausreißer das Vorzeichen. Der Bericht markiert das.

## Voraussetzung: genug Historie

Das ist aktuell die eigentliche Grenze. Die Tabelle `transactions` enthält nur, was seit Beginn des
Ingests eingelaufen ist — für einen 21-Handelstage-Horizont braucht es Signale, die mindestens
einen Monat zurückliegen, für belastbare Aussagen einige hundert davon.

Kurse lassen sich sofort Jahre zurück laden; die Insider-Meldungen sind der Engpass. Solange die
Historie zu dünn ist, meldet der Bericht das ehrlich, statt Zahlen auszugeben, die nach etwas
aussehen. Sobald genug Zeit vergangen ist, wird derselbe Aufruf ohne Änderung aussagekräftig.

Wer das beschleunigen will, müsste Form-4-Meldungen historisch nachladen (SEC EDGAR
`full-index/{Jahr}/QTR{n}/form.idx` gibt alle Accession-Nummern eines Quartals; der vorhandene
Parser `fetchTransactionsForAccessions()` in `src/lib/secEdgar.ts` kann sie direkt verarbeiten).
Bei SECs Limit von 10 Anfragen/Sekunde ist das ein Lauf über Stunden bis Tage — eigenes Vorhaben,
bewusst nicht Teil dieses Werkzeugs.

## Optionen

| Option | Vorgabe | |
|---|---|---|
| `--window` | 14 | Beobachtungsfenster in Tagen (wie auf dem Dashboard) |
| `--min-agree` | 3 | Mindestzahl unabhängiger Insider |
| `--min-usd` | 1000 | Mindestvolumen je Transaktion |
| `--horizons` | 5,21,63 | Auswertungshorizonte in Handelstagen |
| `--cooldown` | = `--window` | Mindestabstand zwischen zwei Ereignissen desselben Tickers |
| `--buckets` | 5 | Anzahl Score-Quantile |
| `--from`, `--to` | offen | Auswertungszeitraum eingrenzen |
| `--split` | aus | Out-of-Sample-Gegenprobe |
| `--include-plan-trades` | aus | 10b5-1-Planhandel mitzählen (siehe unten) |
| `--json` | aus | vollständiger Bericht als JSON |

`--include-plan-trades` ist die einzige Option, die von der Live-Filterung abweicht: Planhandel
nach Rule 10b5-1 ist im Score komplett ausgeschlossen, weil er auf einem vorab festgelegten Plan
beruht statt auf einer spontanen Entscheidung. Nachgerechnet wurde diese Annahme nie. Beide
Läufe vergleichen beantwortet das.

## Tests

```bash
npm test
```

Deckt die Score-Formel (inklusive der Zusicherung, dass die Auslagerung in
`scoreFromComponents()` den live gezeigten Score um keinen Punkt verändert hat), die Statistik und
die Kurs-Parser ab. In einer Auswertung fällt ein Vorzeichenfehler sonst nicht auf: eine kaputte UI
sieht man, eine Korrelation mit falschem Vorzeichen liefert klaglos eine plausibel aussehende Zahl
— und auf deren Basis würden dann die Gewichte verstellt.
