# Geplant: historischer Form-4-Nachlauf

Notiz für später, nicht umgesetzt. Der Backtest in diesem Verzeichnis funktioniert, hat aber zu
wenig Historie, um etwas auszusagen — `transactions` enthält nur, was seit Beginn des Ingests
eingelaufen ist. Kurse lassen sich sofort Jahre zurück laden, die Insider-Meldungen sind der
Engpass. Das hier ist der Weg, sie nachzuziehen.

Nützt nicht nur der Auswertung: tiefere Historie verbessert auch die Unternehmensseiten und die
`priorAcquisition`-Anreicherung, die heute an "Ingest-Start" endet.

## Ansatz

SEC EDGAR veröffentlicht pro Quartal einen vollständigen Filing-Index:

```
https://www.sec.gov/Archives/edgar/full-index/{Jahr}/QTR{1-4}/form.idx
```

Feste Spaltenbreiten, eine Zeile je Filer und Filing: `Form Type | Company Name | CIK | Date Filed |
File Name`. Aus dem Dateinamen (`edgar/data/{cik}/{accession}.txt`) fallen Accession-Nummer und CIK
direkt heraus — zusammen mit dem Datum ist das genau das, was `Form4Accession` in
`src/lib/secEdgar.ts` braucht:

```ts
{ accessionNumber, cik, indexUrl, filedAt }
// indexUrl = `${SEC_BASE}/Archives/edgar/data/${cik}/${accessionNumber.replace(/-/g,"")}/index.json`
```

Ab da übernimmt der vorhandene Parser unverändert: `fetchTransactionsForAccessions()` liefert
fertige `Transaction[]`, `insertTransactionsBatch()` schreibt sie mit `INSERT OR IGNORE`, und
`processed_accessions` macht Wiederanläufe billig. Es ist also kein neuer Parser nötig, nur eine
andere Quelle für die Accession-Liste.

**Wichtig:** dieselbe Meldung erscheint in `form.idx` mehrfach — einmal je beteiligtem Filer
(Issuer und jeder Reporting Owner). Nach `accessionNumber` deduplizieren.

## Was es kostet

Im Code nachgesehen, nicht geschätzt:

- `throttledFetch` in `secEdgar.ts` erzwingt `REQUEST_DELAY_MS = 120` modulweit — die `concurrency
  = 5` in `fetchTransactionsForAccessions()` bringt deshalb keinen Durchsatz, alles serialisiert
  über die Drossel.
- `fetchFilingOwnershipXml()` macht **zwei** Anfragen je Meldung (`index.json`, dann die XML).

Macht ~240 ms je Meldung, also rund **15.000 Meldungen pro Stunde**. Bei grob 300.000 Form-4-
Meldungen pro Jahr über den Gesamtmarkt wären das ~20 Stunden für ein Jahr Vollabdeckung.

Die Offering-Prüfung (`hasRecentOffering`) fällt kaum ins Gewicht: `tickerCikMap` und
`submissionsCache` sind modulweit gecacht, das kostet ungefähr eine Anfrage je Issuer statt je
Meldung.

## Der Hebel: nicht alles holen

Für die Auswertung reichen die Meldungen zu den Tickern, die wir ohnehin verfolgen — ein paar
hundert Unternehmen von mehreren tausend Emittenten. Da der Issuer als eigene Zeile in `form.idx`
steht, lässt sich vorab nach Issuer-CIK filtern und erst danach herunterladen. Das schneidet das
Volumen um mehr als eine Größenordnung und bringt die 20 Stunden auf einen Nachmittag.

Issuer-CIKs kommen aus SECs `company_tickers.json`, das `getCikForTicker()` bereits lädt und cacht.

Rückwärts laufen lassen (jüngstes Quartal zuerst): dann ist die Auswertung schon nutzbar, während
ältere Quartale noch nachlaufen.

## Der Stolperstein, der den Backtest still verfälschen würde

Drei Felder lassen sich historisch **nicht** vollständig rekonstruieren, und alle drei greifen
direkt in die Score-Berechnung ein:

| Feld | Problem |
|---|---|
| `is_plan_trade` | SECs `aff10b5One` ist erst seit der Regeländerung 2023 Pflichtfeld. Davor gibt es keinen Wert — nachgeladene Meldungen bekämen also 0. |
| `is_fresh_insider` | Braucht `insider_positions`-Historie (Form-3-Ersterfassung) aus der Zeit *vor* der jeweiligen Transaktion. Die existiert für den Nachlauf-Zeitraum nicht. |
| `is_c_suite` | Kommt aus dem Freitext `officerTitle` derselben Meldung, ist also verfügbar — hier ist nichts kaputt. |

`is_plan_trade` ist der gefährliche Fall: der Score schließt Planhandel aus, und für nachgeladene
Meldungen sähe es aus, als hätte es damals gar keinen gegeben. Der Backtest würde dann auf
Signalen laufen, die die Live-App so nie erzeugt hätte — und zwar ohne dass irgendetwas auffällt.

Also beim Nachladen zwingend eine Spalte mitschreiben, ab wann die Flags belastbar sind (etwa
`flags_complete_from` oder schlicht ein `backfilled`-Marker je Zeile), und den Backtest defaulten
lassen, nur Zeiträume mit vollständigen Flags auszuwerten. Lieber weniger Ereignisse als
still falsche.

## Wo das läuft

Lokal, als Skript in `scripts/`, in der Machart der übrigen Wartungsskripte. Nicht als Cron und
nicht als API-Route — die Laufzeit sprengt jedes Serverless-Limit um Größenordnungen, und es ist
ein einmaliger Vorgang, kein Betriebsablauf.
