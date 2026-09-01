# Tests

Leichtgewichtige Node-Tests ohne Test-Framework — direkt ausführbar.

## Voraussetzung

Die meisten Tests brauchen jsdom:

```bash
npm install jsdom
# oder mit externer Installation:
NODE_PATH=/pfad/zu/node_modules node tests/<name>.test.js
```

`timeaxis.test.js` läuft ohne Abhängigkeiten.

## Ausführen

```bash
node tests/page-boot.test.js      # lädt die Seite wie ein Browser (wichtigster Test)
node tests/script-order.test.js   # Skript-/Markup-Reihenfolge beim Parsen
node tests/mobile-render.test.js  # gerendertes Mobil-Layout bei 390px
node tests/sheet-css.test.js      # CSS-Vertrag der Bottom-Sheets
node tests/chart-layout.test.js   # Sichtbarkeitskette des Charts
node tests/mobilebars.test.js     # DOM-Umzug, Handler, Rotation
node tests/timeaxis.test.js       # Zeitachsen-Synchronisation
```

Alle beenden mit Exit-Code 0 bei Erfolg, 1 bei Fehler.

## Was abgedeckt ist

**`page-boot.test.js`** — Parst und startet die Seite wie ein echter Browser
(`runScripts: 'dangerously'`), mit gestubbten Netzwerk- und Chart-Aufrufen.
Prüft, dass die Initialisierung wirklich durchläuft: keine Skriptfehler,
`MobileBars` definiert, Chart erstellt, `/api/klines` angefordert. Dieser Test
fängt Fehler, die erst beim echten Laden auftreten.

**`script-order.test.js`** — Inline-Skripte laufen *während* des Parsens.
Greift ein Skript auf Markup zu, das weiter unten steht, liefert
`getElementById` null → TypeError → der restliche Block wird abgebrochen.
Prüft, dass der App-Start an `DOMContentLoaded` gebunden ist und kein
Top-Level-Aufruf auf noch ungeparste Elemente zugreift.

**`mobile-render.test.js`** — jsdom wertet Media Queries nicht aus; dieser Test
injiziert die `max-width`-Blöcke als normale Regeln und prüft damit das
tatsächliche 390px-Layout: Sichtbarkeitskette des Charts, Flex-Höhenkette,
und dass wirklich nur eine Kopfleiste sichtbar ist.

**`sheet-css.test.js`** — Wertet die echten CSS-Regeln via `getComputedStyle`
aus: Sheets geschlossen → `display:none`, mit `.open` → sichtbar, und kein
Vorfahre einer Kennzahl ist `display:none`.

**`chart-layout.test.js`** — Sichtbarkeitskette `#chart` → `.chart-main` →
`.chart-area` → `.main`, plus die Ladeanzeige: `.chart-loading` liegt deckend
über dem Chart und muss auch im Fehlerfall (nach `catch`) wieder ausgeblendet
werden.

**`mobilebars.test.js`** — Auf Mobil werden Timeframes, Chart-Werkzeuge und
Ticker-Kennzahlen in Bottom-Sheets *verschoben* (nicht kopiert). Getestet:
Umzug in beide Richtungen inkl. Rotation, Handler-Integrität,
ID-Eindeutigkeit, Sheet-Steuerung, Idempotenz.

**`timeaxis.test.js`** — `alignToMainTime()` / `alignToChartTime()` reihen
Sub-Chart- und Indikator-Werte in die Zeit-Domain des Haupt-Charts ein, damit
`setVisibleRange()` nicht auf den kürzeren Datenbereich klemmt.

## Gelernte Lektion

Struktur-Tests allein reichen bei UI-Code nicht. Drei Fehler rutschten
nacheinander durch, weil die Tests jeweils eine Ebene zu hoch ansetzten:

1. `classList` geprüft, aber nicht die gerenderte CSS-Kaskade
   → Sheets waren dauerhaft `display:none` (`sheet-css.test.js`)
2. CSS geprüft, aber ohne Media Queries
   → Mobil-Layout ungetestet (`mobile-render.test.js`)
3. Skripte *nach* dem Parsen ausgeführt statt währenddessen
   → Zugriff auf ungeparstes Markup unentdeckt (`page-boot.test.js`,
     `script-order.test.js`)

Bei UI-Änderungen deshalb immer `page-boot.test.js` mitlaufen lassen — er ist
dem echten Browser am nächsten.
