# Projektstand InsiderAlign

Laufende Übergabe-Notiz für einen neuen Chat. Hält fest, was in dieser Session passiert ist, welche
Entscheidungen dabei gefallen sind, und woran als Nächstes gearbeitet werden sollte. Für die
Cache-Components-Migration selbst siehe `docs/cache-components-migration.md`, für die
Backfill-Skripte `src/lib/research/BACKFILL.md`.

## Was in dieser Session passiert ist

`main` steht auf `3f6784a`.

**Nicht in dieser Session gebaut, nur gemergt:** die Cache-Components-Migration (`c90ac1e`
bis `af81ae4`) kam fertig von einer parallelen Session — Details in
`docs/cache-components-migration.md`. Diese Session hat sie konfliktfrei nach `main` gemergt und
alles Weitere darauf aufgesetzt.

**In dieser Session, in Reihenfolge:**

- **`833444a`** — Retry mit exponentiellem Backoff für SEC-EDGAR-503/429 in `throttledFetch()`
  (`secEdgar.ts`). Auslöser: ein einzelner 503 ließ eine Meldung bisher sofort und endgültig
  fehlschlagen, obwohl SEC damit meist nur kurz drosselt (verifiziert an einer echten
  Drossel-Serie während eines lokalen Backfills).
- **`c810fa4`** — Tabelle `backfill_failures` (einmalig: `scripts/add-backfill-failures-table.mjs`)
  plus `--retry-failed` auf `backfill-positions.mjs` und `backfill-form4.mjs`. Fängt die Meldungen
  ab, die auch den Retry oben nicht überstehen — sonst wären sie für immer verloren, weil der
  Ticker-Fortschritt trotzdem weiterzählt.
- **`3fc214f`** — Sichtbare Ladeanzeigen: `Spinner`/`PageLoading` (`src/components/ui/`),
  `loading.tsx` für alle acht Routen mit `instant = false` (vorher zeigten die beim Laden gar
  nichts an), Spinner ergänzt an den sieben Stellen, die vorher nur Text zeigten.
- **`419eea7`** — "Anmelden"-Link im Dashboard-Header (`TopBar.tsx`) für abgemeldete Besucher —
  vorher gab's dort nur "Alerts aktivieren" (→ `/pricing`), keinen direkten Login-Weg.
- **`fbc6bbd`** — Watchlist-Link in `TopBar.tsx` jetzt immer sichtbar, nicht mehr nur wenn
  angemeldet. `/watchlist` unterstützt abgemeldete Besucher schon lange mit einer kostenlosen,
  lokal gespeicherten Watchlist (`LocalWatchlistClient`, `localStorage`, Limit 5) — der Link hat
  das nur versteckt.
- **`a92a63d`** — Fehlender Watch-Button in der "Größte Käufe"-Liste (`TopBuysRail.tsx`) ergänzt —
  `TickerCard` (Insider-Konsens-Liste) hatte ihn schon lange, dort nie.
- **`e197a12`** — Watch-Button im Handelshistorie-Modal (`TickerDetailModal.tsx`) aus der Zeile
  mit den blassen Metadaten-Links (`text-text-faint`, kaum sichtbar) gelöst, jetzt ein eigener
  umrandeter Button neben dem Firmennamen.
- **`5702802`** — `TickerAutocompleteInput` (`src/components/ui/`): Ticker-/Firmen-Vorschläge beim
  Tippen, jetzt in beiden Watchlist-Formularen (Abo- und lokale Version) — vorher musste man den
  exakten Ticker kennen, anders als bei der normalen Suche (`CompanySearch`).
- **`e2d61e5`** — Rate-Limiting (20 Requests/Minute/IP, in-memory, kein Turso-Write) auf
  `/api/export/signals.csv` und `/feed.xml` — Antwort auf die Überlegung, die stattdessen hinter
  ein Abo zu legen (dagegen entschieden, siehe unten).
- **`3f6784a`** — Bugfix in `secEdgar.ts`: `issuerTradingSymbol` & Co. kommen bei manchen
  Filing-Agenten als `{"#text": ...}`-Objekt statt als String zurück (fast-xml-parser gibt bei
  XML-Attributen ein Objekt statt eines Strings zurück), warf `.trim is not a function`. Live
  gefunden bei Ticker CRI, Meldung `0001140361-09-023300` von 2009. Neuer `textValue()`-Helfer an
  allen vier betroffenen Feldern in `fetchFilingOwnershipXml` und `fetchOwnershipPosition`.

## Entscheidungen, die man nicht aus dem Code herausliest

- **CSV/RSS bleiben frei, kein Premium-Feature.** Beide exportieren nur, was auf dem Dashboard
  ohnehin schon offen sichtbar ist — nichts Exklusives zu schützen. Rate-Limiting stattdessen,
  falls Missbrauch/Last das eigentliche Anliegen ist (siehe `e2d61e5` oben).
- **Congress-/Government-Insider bleiben vorerst Stub** (`src/lib/congressTrading.ts`, gibt `[]`
  zurück). Die Architektur ist fertig vorbereitet — `FilerType = "insider" | "congress"`,
  DB-Schema (`filer_type`-Spalte) und der Ingest-Merge in `ingest.ts` sind schon quellenneutral,
  insider-spezifische Logik filtert schon korrekt auf `filerType === "insider"`. Es fehlt nur eine
  Datenquelle. Nachgeprüft in dieser Session (nicht nur aus alten Notizen übernommen):
  `senatestockwatcher.com` ist jetzt komplett offline (DNS löst nicht mehr auf, das GitHub-Repo
  dahinter zuletzt im März 2021 aktualisiert), `efdsearch.senate.gov` blockiert weiterhin
  automatisierten Zugriff (Akamai, 403). Neu seit dem letzten Stand: mehrere kostenpflichtige
  Dritt-APIs (Lambda Finance, Disclosed Capitol, EODHD, diverse Apify-Actors) haben das
  Scraping-Problem gelöst und verkaufen den Zugriff. Das wäre der erste kostenpflichtige externe
  Baustein der ganzen Pipeline — deshalb bewusst vertagt statt selbst entschieden.

## Woran weitergemacht werden sollte

- **Der lokale Backfill läuft.** `research:positions` war beim letzten geteilten Log-Ausschnitt
  alphabetisch bei Ticker CVLT, von insgesamt 696 getrackten Tickern laut Start-Zeile
  ("Positions-Nachlauf · 696 Ticker"). Einfach `npm run research:positions` erneut starten, macht
  beim gespeicherten Fortschritt weiter. Am Ende `--retry-failed` auf beiden Backfill-Skripten
  nachschieben, um SEC-Drosselungen einzusammeln, die auch den eingebauten Retry nicht überstanden
  haben (siehe `src/lib/research/BACKFILL.md`, Abschnitt "Wenn SEC drosselt").
- **Die AIT-Lücke von der allerersten 503-Serie** (passiert bevor `backfill_failures` existierte,
  deshalb dort nirgends vermerkt) steht noch aus, falls gewünscht:
  `node --env-file=.env.local scripts/backfill-positions.mjs --tickers AIT --force`. Optional,
  kein Blocker für den Rest.
- **Die Vorher/Nachher-Messung der Cache-Components-Migration fehlt weiterhin** — siehe
  `docs/cache-components-migration.md`, Abschnitt "Noch offen". Blockiert auf gültige Clerk-Keys,
  echte Turso-Anbindung und eine realistisch große Fixture; alle drei fehlen sowohl lokal als auch
  in jeder bisher genutzten Cloud-Sandbox.
- **Aus einem älteren Projekt-Audit, unbearbeitet** (stand auf einem Branch, der nie nach `main`
  gemergt wurde — hier nachgetragen, damit es nicht verloren geht):
  - Body-Scroll-Sperre bei offenen Modals fehlt, ebenso Dialog-Semantik (ARIA).
  - `checkSavedScreensAndAlert()` rechnet die komplette Signal-Pipeline pro gespeichertem Screen
    neu, statt einmal für alle.
  - Die Watchlist (beide Varianten) nimmt jeden eingegebenen Ticker ohne Prüfung an, ob er
    überhaupt existiert oder getrackt wird.
