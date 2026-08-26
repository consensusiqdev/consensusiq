# Historischer Form-4-Nachlauf

Umgesetzt in `scripts/backfill-form4.mjs`. Diese Datei erklärt, warum es ihn gibt, wie er läuft und
wo seine Grenzen liegen.

`transactions` enthält von Haus aus nur, was seit Beginn des Ingests eingelaufen ist. Kurse lassen
sich sofort Jahre zurück laden, die Insider-Meldungen sind der Engpass — ohne sie kann der Backtest
in diesem Verzeichnis nichts aussagen. Nützt nicht nur der Auswertung: tiefere Historie verbessert
auch die Unternehmensseiten und die `priorAcquisition`-Anreicherung, die sonst an „Ingest-Start"
endet.

## So läuft er

```bash
node --env-file=.env.local scripts/add-backfilled-column.mjs   # einmalig
node --env-file=.env.local scripts/backfill-form4.mjs
```

Läuft **lokal**, nicht auf Vercel. Ein Durchgang dauert Stunden und sprengt jedes Function-Limit um
Größenordnungen; außerdem ist es ein einmaliger Vorgang, kein Betriebsablauf. Er kostet dadurch
keine einzige Vercel-Invocation. Die Daten landen trotzdem in der **echten** Datenbank — Turso ist
ein gehosteter Dienst, den der eigene Rechner genauso erreicht wie Vercel es tut.

Abbruch mit Strg-C ist jederzeit sicher. Der Fortschritt steht pro Ticker in
`form4_backfill_status`, ein Neustart macht dort weiter. Innerhalb eines Tickers wird von alt nach
neu gearbeitet, damit ein abgebrochener Lauf einen zusammenhängenden Zeitraum hinterlässt statt
Löcher über die ganze Historie.

Nützliche Schalter: `--tickers AAPL,MSFT` für einen gezielten Lauf, `--limit 20` um einen Durchgang
zu begrenzen, `--from` um den Stichtag zu verschieben (siehe unten), `--force` um bereits fertige
Ticker erneut zu holen.

## Warum kein `full-index`

Eine frühere Fassung dieser Notiz schlug vor, SECs Quartals-Index
(`full-index/{Jahr}/QTR{n}/form.idx`) zu parsen und daraus die Accession-Nummern zu ziehen, und
bezeichnete das Filtern auf getrackte Ticker als „den Hebel". Beides war unnötig:
**`fetchFilingsByForm(ticker, ["4"])` existiert bereits** und liefert genau das — die
Form-4-Historie eines Tickers. Der vorhandene Positions-Nachlauf (`backfillNextTicker`) benutzt sie
seit jeher, nur mit `["3","4","5"]` und mit `insider_positions` als Ziel.

Der Nachlauf ist deshalb kein neuer Parser, sondern eine andere Quelle für dieselbe Kette:
`fetchFilingsByForm` → `accessionFromFilingRef` → `fetchTransactionsForAccessions` → Insert.

## Wie tief er reicht

SECs Submissions-Endpunkt liefert nur die rund 1000 jüngsten Filings **jeder Art** inline
(`filings.recent`) und lagert Älteres in zusätzliche JSON-Dateien aus. Bei einem vielfilenden
Emittenten sind 1000 Filings schnell nur ein bis zwei Jahre.

`fetchFilingsByForm` folgt diesen ausgelagerten Seiten inzwischen, wenn man `{ deep: true }`
übergibt — der Nachlauf tut das, der Positions-Crawl bewusst nicht (er will nur den aktuellen Stand
je Insider und spart sich die Extra-Anfragen).

## Der Stichtag — der Punkt, an dem es sonst still falsch würde

SECs `aff10b5One`-Checkbox, die Quelle für `is_plan_trade`, ist erst seit der Regeländerung 2023
Pflichtfeld. Ältere Meldungen kommen ohne Kennzeichen an und läsen sich als „kein Planhandel". Da
der Signal Score Planhandel **ausschließt**, würde der Backtest auf solchen Zeilen Signale bewerten,
die die Live-App nie erzeugt hätte — ohne dass an den Zahlen etwas auffiele.

Deshalb zwei Vorkehrungen, die zusammengehören:

- Der Nachlauf schreibt jede Zeile mit `backfilled = 1` und holt per Vorgabe erst ab `2023-04-01`.
- Der Backtest ignoriert nachgeladene Zeilen vor `--trust-flags-from` (Vorgabe ebenfalls
  `2023-04-01`) und weist in der Datengrundlage aus, wie viele das waren. Zeilen aus dem
  Live-Ingest sind nie betroffen.

Wer bewusst tiefer will — etwa für die Unternehmensseiten, die die Flags gar nicht brauchen —
setzt `--from` beim Nachlauf. Der Backtest lässt solche Zeilen dann trotzdem draußen, solange
`--trust-flags-from` nicht mitverschoben wird. Das ist Absicht.

## Was mit den übrigen Flags passiert

Eine frühere Fassung dieser Notiz führte drei problematische Felder auf. Nachgeprüft sind es
weniger:

| Feld | Stand |
|---|---|
| `is_c_suite` | Korrekt. Kommt aus dem `officerTitle` derselben Meldung. |
| `near_offering` | Korrekt. Wird über `hasRecentOffering(ticker, transactionDate)` aus der Filing-Historie nach Datum bestimmt und funktioniert damit rückwirkend genauso. |
| `is_fresh_insider` | Bleibt 0. Bräuchte die Form-3-Ersterfassung aus der Zeit **vor** der jeweiligen Transaktion. Fließt aber **nicht** in den Signal Score ein (nur ins Badge) — verfälscht also keine Auswertung. |
| `is_plan_trade` | Der einzige echte Fall, siehe Stichtag oben. |

Nebenbei aufgefallen und hier nicht behoben: `insider_positions.first_seen_date` wird nur beim
allerersten INSERT geschrieben und danach nie korrigiert. Ein Insider, den der Live-Ingest bereits
kennt, trägt als „erstmals gesehen" das Ingest-Datum — auch wenn später seine echte, ältere Form 3
nachgeladen wird. Betrifft ausschließlich das „frisch eingestiegen"-Badge.

## Was es kostet

`throttledFetch` in `secEdgar.ts` erzwingt `REQUEST_DELAY_MS = 120` modulweit — die `concurrency`
in `fetchTransactionsForAccessions()` bringt deshalb keinen Durchsatz, alles serialisiert über die
Drossel. `fetchFilingOwnershipXml()` macht **zwei** Anfragen je Meldung (`index.json`, dann die
XML), macht ~240 ms pro Meldung.

Bei einigen hundert getrackten Tickern à grob 100–300 Form-4-Meldungen seit 2023 landet man bei
**wenigen Stunden**, nicht bei den zwanzig aus der ersten Schätzung — weil pro Ticker gearbeitet
wird statt über den Gesamtmarkt.

Die Offering-Prüfung fällt kaum ins Gewicht: `tickerCikMap` und `submissionsCache` sind modulweit
gecacht, das kostet ungefähr eine Anfrage je Issuer statt je Meldung.

## Der zweite Nachlauf: Insider-Positionen

`scripts/backfill-positions.mjs` ist das Gegenstück für `insider_positions` — also "wer hält wie
viele Aktien", die Insider-Liste auf der Unternehmensseite. Andere Tabelle, andere Frage, gleiche
Machart:

```bash
npm run research:positions
```

Diese Arbeit macht sonst der Cron unter `/api/cron/backfill`, in Häppchen von 15 Meldungen alle
paar Minuten. Für die **Erstbefüllung** ist das der falsche Weg: es zieht sich über Wochen und
kostet für jeden Anstoß eine Vercel-Invocation, auch wenn nichts zu tun ist. Lokal läuft dieselbe
Arbeit an einem Stück.

Beide teilen sich die Fortschritts-Tabelle `insider_backfill_status`. Was das Skript auf `'done'`
setzt, überspringt der Cron anschließend (siehe `getNextBackfillTicker()` in `db.ts`) — sie treten
sich also nicht auf die Füße, egal wer zuerst dran war. **Nach der Erstbefüllung kann der Cron
deutlich seltener laufen**: er hat dann nur noch neu auftauchende Ticker einzusammeln, und dafür
reicht ein Intervall von Stunden statt Minuten.

Das Skript korrigiert dabei etwas, das nur es korrigieren kann: `first_seen_date` wird im laufenden
Betrieb ausschließlich beim allerersten INSERT geschrieben. Ein Insider, den der Live-Ingest über
eine aktuelle Form 4 kennengelernt hat, trägt als "erstmals gesehen" das Ingest-Datum — auch wenn
seine echte Form 3 Jahre älter ist. Weil dieses Skript als einziges die vollständige Historie sieht
und sie von alt nach neu abarbeitet, setzt es den Wert auf die früheste tatsächlich bekannte
Meldung, und zwar nur nach unten. Betrifft das "frisch eingestiegen"-Badge; der Signal Score liest
die Spalte nicht.

## Danach

`npm run research:prices`, dann `npm run research:backtest -- --split`. Die Datengrundlage im
Bericht zeigt, wie viele Ereignisse tatsächlich zusammengekommen sind — und warnt weiterhin, wenn
es unter `MIN_RELIABLE_SAMPLE` bleibt.
