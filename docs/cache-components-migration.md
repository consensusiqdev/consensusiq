# Cache Components: Migration, Befund und Fallen

Status: **umgesetzt**. Diese Datei war ursprünglich eine Übergabe-Notiz über eine offene
Migration (PR #5, Commit `3c8a206`); sie beschreibt jetzt den durchgeführten Umbau. Der Befund
darin ist unverändert gültig — er wurde vor dem Umbau unabhängig reproduziert.

---

## Der Befund

Vier Seiten deklarierten ein `revalidate`, und **bei keiner davon griff es**. Ursache:
`getTickerDetail()` → `getActiveSubscriberId()` → Clerks `auth()`. Das liest Header und stuft die
ganze Route als dynamisch ein — das `revalidate` daneben ist dann wirkungslos, ohne Warnung.

Belegt durch die Routen-Tabelle aus `next build`, vorher (`2867783`) gegen nachher:

| Route | vorher | nachher |
|---|---|---|
| `/company/[ticker]` | `ƒ` — `revalidate=1800` wirkungslos | `◐` |
| `/sector/[slug]` | `ƒ` — `revalidate=1800` wirkungslos | `◐` |
| `/compare/[tickerA]/[tickerB]` | `ƒ` — `revalidate=1800` wirkungslos | `◐` |
| `/dashboard` | `ƒ` — `revalidate=300` wirkungslos | `ƒ` (jetzt bewusst, s. u.) |
| `/institutional` | `○ 1h` | `○ 1h 1d` |
| `/methodik` | `○ 1h` | `○ 1h 1d` |
| `/sector` | `○ 30m` | `○ 30m 1d` |

Dass genau die drei Seiten **ohne** `auth()` im Datenpfad korrekt statisch waren, ist der Beweis
für die Ursache.

---

## Was umgebaut wurde

`cacheComponents: true` in `next.config.ts`, plus drei benannte `cacheLife`-Profile, die die alten
ISR-Fenster eins zu eins abbilden: `ingestCadence` (300 s), `publicIsr` (1800 s), `dailyRefresh`
(3600 s). Jedes `export const revalidate` ist ersatzlos entfallen.

Das entscheidende Muster für die auth-abhängigen Seiten: **`auth()` wandert aus dem Cache-Scope
heraus.** Gecachte Funktionen dürfen Header/Cookies nicht lesen. Statt dessen liest die Seite die
Session und übergibt das Ergebnis als einfaches Argument:

```ts
// Seite (ungecacht):
const isSubscriber = Boolean(await getActiveSubscriberId());
const detail = await getTickerDetail(ticker, isSubscriber);

// lib (gecacht):
export async function getTickerDetail(ticker: string, isSubscriber: boolean) {
  "use cache";
  cacheLife("publicIsr");
  ...
}
```

`isSubscriber` ist damit Teil des Cache-Keys — Abonnenten und anonyme Besucher bekommen getrennte
Einträge, die Premium-Anreicherung kann nicht zwischen ihnen durchsickern.

Wo eine Route prinzipbedingt nicht sofort rendern kann, steht `export const instant = false` mit
Begründung im Code: `/dashboard` und `/watchlist` (lesen die Session), `/compare` (liest
`searchParams`), `/sign-in`, `/sign-up` (Redirect je nach Session), sowie `/sector/[slug]` und
`/compare/[a]/[b]` (keine `generateStaticParams`, Params also nie vorab bekannt). Das Caching
sitzt dort auf den Datenfunktionen statt auf der Seite.

---

## Zwei Regressionen, die erst der Tabellenvergleich zeigte

Beide sind behoben (Commit „Fix two caching regressions…"), aber das Muster lohnt sich zu kennen:

**`/api/companies` wurde von `ƒ` zu `○` — und das war eine Verschlechterung.** Unter Cache
Components prerendert ein GET-Handler, wenn ihn nichts daran hindert. Im Prerender-Manifest stand
`initialRevalidateSeconds: false`: beim Build eingefroren, **revalidiert nie**. Die Firmenliste
hinter der Suchbox wäre bis zum nächsten Deploy eingefroren gewesen. `use cache` lässt sich nicht
auf den Handler-Export selbst anwenden — der Datenzugriff muss in eine gecachte Hilfsfunktion mit
explizitem `cacheLife`.

**`/sitemap.xml` wurde von `○` zu `ƒ`.** Das `new Date()` für `lastModified` plus zwei ungecachte
DB-Reads (alle Ticker, alle Branchen) genügen, um den statischen Shell zu blockieren — jeder
Crawler-Aufruf hätte beides neu abgefragt. `"use cache"` auf der Sitemap-Funktion stellt die
prerenderte Datei wieder her.

**Daraus die wichtigste Lehre für den nächsten Durchgang:** `○` allein sagt *nicht*, dass eine
Route in Ordnung ist. Es unterscheidet nicht zwischen „statisch und revalidiert" und „statisch und
für immer eingefroren". Der Beweis steht in `.next/prerender-manifest.json`:

```bash
node -e "const r=require('./.next/prerender-manifest.json').routes;
  for (const k of Object.keys(r)) if (r[k].initialRevalidateSeconds===false) console.log('eingefroren:', k)"
```

Nach dem Fix steht in dieser Liste keine datenlesende Route mehr — nur noch echter statischer
Inhalt (Impressum, Datenschutz, Icons, `robots.txt`, Manifest).

---

## Fallen aus der Vorgänger-Notiz — was davon hier noch gilt

**1. Gecachte `Map` wird zu `{}`.** Galt für `unstable_cache` (JSON-Serialisierung) und hat dort
Branchen-Badge und Peer-Chips lautlos verschwinden lassen. **Unter `use cache` gilt das so nicht:**
die Doku listet `Map`, `Set`, `Date`, `TypedArray` ausdrücklich als unterstützt, Argumente wie
Rückgabewerte (RSC-Serialisierung, kein `JSON.stringify`). Unabhängig davon überquert hier keine
`Map` eine Cache-Grenze: `getTickerIndustries()` wird ausschließlich *innerhalb* schon gecachter
Funktionen aufgerufen und sofort per `.get()` konsumiert.

**2. Nach Cache-Änderungen ins gerenderte HTML schauen, nicht nur auf die Typen.** Weiterhin
richtig — **hier aber nicht durchführbar:** Clerk lehnt in der Entwicklungsumgebung jeden
nicht-echten Publishable Key ab (`Error: Publishable key not valid`), und `ClerkProvider` steht im
Root-Layout, also liefert *jede* Route 500. Ein Stub für Clerk würde genau die Variable
ausschalten, um die es geht (`auth()` ist die Ursache der Dynamik) — die Messung wäre wertlos.
Deshalb steht dieser Schritt aus, siehe „Noch offen".

**3. Ohne realistisch große Fixture misst man nichts.** Unverändert gültig. Erst ab ~15.000 Zeilen
werden die Marktdurchläufe real; bei ~90 Transaktionen überwiegt der Cache-Overhead und die
Änderung sieht *langsamer* aus.

**4. Vor jeder Messung den alten Server wirklich beenden.** Unverändert gültig, und mir in anderer
Form ebenfalls passiert: ein per `&`/`disown` gestarteter Hintergrundprozess überlebt den
Tool-Aufruf nicht zuverlässig. Prozess-Status vor jeder Messung explizit prüfen
(`ps aux | grep next-server`), nicht annehmen.

**5. sec.gov ist aus der Entwicklungsumgebung nicht erreichbar** (sofortiges 403), die Datenbank
ist eine lokale Datei statt eines Netz-Hops zu Turso. Genau die beiden Kosten, gegen die gecacht
wird, fehlen lokal.

**6. `next build` scheitert lokal an `/methodik`.** Weiterhin so. Sauberer als
`dynamic = "force-dynamic"` (das es unter Cache Components ohnehin nicht mehr gibt): `SEC_BASE` in
`src/lib/secEdgar.ts` temporär auf einen lokalen Stub umbiegen, bauen, danach
`git checkout -- src/lib/secEdgar.ts`.

---

## Verifikation dieses Umbaus

- Vollständiger `next build` mit Cache Components: alle 41 Routen prerendern, Tabelle oben.
- Prerender-Manifest auf eingefrorene Datenrouten geprüft (siehe Regressions-Abschnitt).
- `npm test` 41/41; `npm run lint` unverändert bei den 20 Findings, die `main` schon hat.
- Vorher/Nachher-Tabellen aus zwei echten Builds desselben Codestands in derselben Umgebung.

---

## Noch offen

- **Die Messung.** Es gibt weiterhin keine Vergleichsbasis für diesen Umbau — Grund oben unter
  Falle 2. Die Zahlen der Vorgänger-Notiz (~0,98 s → ~0,12 s) beziehen sich auf die
  `unstable_cache`-Zwischenlösung aus PR #5, nicht auf diesen Stand. Nachzuholen in einer Umgebung
  mit gültigen Clerk-Keys und einer Fixture in realistischer Größe. Erneut geprüft beim Merge dieses
  Branches auf `claude/cache-components-migration-5objk3`: diese Umgebung hat zusätzlich weder
  `TURSO_DATABASE_URL` noch irgendeine `.env.local`, `next build` scheitert also schon vor dem
  Clerk-Problem am DB-Client. Kein neuer Befund, nur dieselbe Blockade aus einer anderen Umgebung
  bestätigt.
- **`generateStaticParams` fehlt für alle dynamischen Routen.** Deshalb `instant = false` auf
  `/sector/[slug]` und `/compare/[a]/[b]`. Mit vorab gerenderten Top-Tickern/-Branchen ließe sich
  das gegen echte App-Shells eintauschen.
- ~~**`getFilteredSignals()` ist ungecacht.**~~ Erledigt: `getFilteredSignalsCached()` in
  `signalsQuery.ts` deckt jetzt `/feed.xml` und den CSV-Export ab (`cacheLife("ingestCadence")`,
  wie `/dashboard`). Bewusst als eigene Funktion und nicht als `"use cache"` auf
  `getFilteredSignals()` selbst: `checkSavedScreensAndAlert()`, `digest.ts` und die
  Perzentil-Berechnung in `tickerDetail.ts` rufen die ungecachte Funktion mit Erwartung auf den
  aktuellen DB-Stand auf — ein Alarm-Pfad, der bis zu 5 Minuten alte Daten sieht, wäre eine
  Regression, kein Fix.
- **Konflikt mit PR #5.** Aufgelöst: PR #5 wurde vor dem Merge auf den ersten Commit (den lokalen
  Positions-Nachlauf) eingedampft, `src/lib/cached.ts` kam nie auf `main`. Dieser Umbau mergt
  konfliktfrei.
