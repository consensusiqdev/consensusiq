# Projektstand InsiderAlign

Laufende Übergabe-Notiz. Sie hält fest, was gebaut ist, was noch offen liegt, und die paar
Entscheidungen, die man nicht aus dem Code herauslesen kann. Beim Aufgreifen zuerst hier
nachsehen — dann `src/lib/research/README.md` und `src/lib/research/BACKFILL.md` für die
Auswertungsseite.

## Wo die Dinge stehen

Auf `main`:

- **Backtest-Harness** unter `src/lib/research/` samt `scripts/backtest.mjs` und
  `scripts/sync-prices.mjs`. Erste Tests des Projekts überhaupt in `scripts/test-research.mjs`
  (41 Stück, `npm test`).
- **Fonds-Kontext auf der Unternehmensseite** (`InstitutionalPanel`), inklusive der Korrektur, dass
  ein vollständiger Fonds-Ausstieg im Smart-Money-Konsens als Verkauf zählt.
- **`InfoDot`** statt `title=`-Tooltips, damit Erklärungen auf dem Handy erreichbar sind.
- **Watchlist-Alarme feuern nicht mehr auf RSU-Zuteilungen.** Die Ursache war, dass dasselbe
  Prädikat achtmal über fünf Dateien kopiert war und einer Kopie eine Bedingung fehlte. Es steht
  jetzt einmal in `consensus.ts` als `isOpenMarketTrade` / `isIndependentDecision` — wer eine neue
  Auswertung baut, benutzt diese beiden und schreibt die Bedingung nicht neu.
- **Beide lokalen Nachläufe**: `scripts/backfill-form4.mjs` und `scripts/backfill-positions.mjs`.

Offen auf `claude/cache-components-migration-mhhp7x`: die **Cache-Components-Migration**. Mergt
konfliktfrei auf `main` (nachgeprüft). Ihre eigene Notiz liegt auf dem Branch unter
`docs/cache-components-migration.md` und beschreibt den gebauten Stand samt zweier
Caching-Regressionen, die dort schon gefunden und behoben wurden.

Ein Zwischenschritt von mir — eine `unstable_cache`-Schicht in `src/lib/cached.ts` — wurde
**bewusst verworfen**, bevor er gemergt wurde. Die Migration löst dieselbe Sache an der Ursache:
sie zieht `getActiveSubscriberId()` aus dem gemeinsamen Datenpfad, statt nur die teure Arbeit
darunter zu cachen. Beides zusammen hätte `unstable_cache` innerhalb von `use cache`-Scopes
verschachtelt. Falls die Datei irgendwo wieder auftaucht: sie gehört nicht zurück.

## Die Lizenz-Grenze, die im Code steckt

Der ursprüngliche Einwand gegen Börsenkurse war die **Weiterverbreitung** an Endnutzer. Interne
abgeleitete Statistik ist ein anderer Fall — und genau diese Trennung ist im Code durchgesetzt,
nicht bloß dokumentiert:

- Nichts unter `src/lib/research/` wird aus `src/app/**` importiert.
- Nichts dort hängt an `db.ts` oder `server-only`.
- Die Tabelle `daily_prices` wird von **keinem** Anwendungscode gelesen.
- Es gibt weder Cron noch API-Route für irgendetwas davon.

Kurse werden lokal geholt, lokal gerechnet, und nur eine abgeleitete Kennzahl verlässt den Rechner.
Wer das aufweicht — etwa Backtest-Ergebnisse auf `/methodik` zeigen will —, zeigt aggregierte
Kennzahlen, niemals Kursreihen.

## Die beiden Nachläufe

Laufen **lokal auf dem PC des Nutzers**, nicht auf Vercel: einmalige Vorgänge über Stunden, die
jedes Function-Limit sprengen und sonst Invocations verbrennen. Die Daten landen trotzdem in der
echten Turso-Datenbank — die ist gehostet und vom eigenen Rechner genauso erreichbar.

```powershell
git pull origin main
node --env-file=.env.local scripts/add-backfilled-column.mjs   # einmalig
npm run research:positions                                      # insider_positions, Erstbefüllung
npm run research:backfill -- --limit 3                          # Form 4, erst klein antesten
```

Beide sind jederzeit mit Strg-C abbrechbar und machen beim Neustart weiter. Danach hat der Cron
unter `/api/cron/backfill` nur noch Neuzugänge einzusammeln und darf **deutlich seltener** laufen —
Stunden statt Minuten. Der Ingest-Cron bleibt unverändert, der holt die neuen Meldungen.

Der Stichtag `2023-04-01` in beiden Richtungen (Nachlauf schreibt `backfilled = 1`, Backtest
ignoriert nachgeladene Zeilen davor) ist kein Detail: SECs `aff10b5One`-Checkbox ist erst seit der
Regeländerung 2023 Pflicht, ältere Meldungen läsen sich sonst als „kein Planhandel". Ausführlich in
`src/lib/research/BACKFILL.md`.

## Was noch offen ist

Aus dem Projektaudit, unbearbeitet:

- Body-Scroll-Sperre bei Modals, Dialog-Semantik.
- `checkSavedScreensAndAlert()` rechnet die komplette Signal-Pipeline **pro gespeichertem Screen**
  neu.
- Watchlist nimmt beliebige Ticker an, ohne sie zu prüfen.

Ideen, bewusst nicht angefangen: Backtest-Ergebnisse auf `/methodik` (siehe Lizenz-Grenze oben),
Alarme auf Fonds-Bewegungen, Score-Schwelle für Watchlist-Alarme, Insider-übergreifende Ansicht.

Offen auf dem Migrations-Branch: eine **echte Vorher/Nachher-Messung** fehlt. Clerk lehnt jeden
nicht-echten Publishable Key ab und `ClerkProvider` sitzt im Root-Layout, also liefert lokal jede
Route 500. Clerk zu stubben würde `auth()` ausschalten — genau die Variable, um die es geht.

## Fallen, die schon zugeschnappt sind

**Gecachte Werte müssen JSON-serialisierbar sein.** `getTickerIndustries()` gibt eine `Map` zurück;
durch `unstable_cache` wurde daraus `{}`, und Branchen-Badge und Peer-Chips verschwanden **lautlos**
— kein Log, identische Typen. Nur im gerenderten HTML zu sehen. (Bei `use cache` sind Map/Set/Date
laut Doku unterstützt, die Falle überträgt sich also nicht.)

**`○` in der Routen-Tabelle beweist nicht, dass eine Route in Ordnung ist.** Es unterscheidet nicht
zwischen „statisch und revalidiert" und „statisch und für immer eingefroren". Nur
`.next/prerender-manifest.json` zeigt `initialRevalidateSeconds: false`. Genau daran hingen die zwei
Regressionen, die der Migrations-Branch selbst wieder eingefangen hat.

**Ohne realistisch große Fixture misst man nichts.** Bei ~90 Transaktionen überwiegt der
Cache-Overhead und eine Verbesserung sieht aus wie eine Verschlechterung. Erst bei ~15.000 Zeilen
werden die Marktdurchläufe real.

**Vor jeder Messung den alten Server wirklich beenden.** `pkill` in einer verketteten Bash-Zeile
bricht die Kette ab, der alte `next start` überlebt, und man misst gegen den vorigen Build. PID über
`ps aux | grep next-server` holen und einzeln `kill -9`. Ebenso: `git stash push` braucht `-u`,
sonst bleiben neue Dateien liegen und man misst zweimal denselben Stand.

**In der Entwicklungsumgebung ist sec.gov nicht erreichbar** (sofortiges 403) und die Datenbank ist
eine lokale Datei statt eines Netz-Hops zu Turso. Beide Kosten, gegen die gecacht wird, fehlen
lokal. `next build` scheitert deshalb an `/methodik`, das gegen SEC prerendert.

**Wenn etwas „bei mir nicht angezeigt" wird:** erst prüfen, ob der Stand überhaupt auf `main` ist.
Das war schon einmal die ganze Erklärung.
