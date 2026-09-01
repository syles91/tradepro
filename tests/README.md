# Tests

Leichtgewichtige Node-Tests ohne Test-Framework — direkt ausführbar.

## Voraussetzung

Nur `mobilebars.test.js` braucht jsdom:

```bash
npm install jsdom          # oder: NODE_PATH=/pfad/zu/node_modules
```

## Ausführen

```bash
node tests/mobilebars.test.js     # Mobile-Kopfleiste (DOM-Umzug, Handler, Rotation)
node tests/timeaxis.test.js       # Zeitachsen-Synchronisation der Sub-Charts
```

Beide beenden mit Exit-Code 0 bei Erfolg, 1 bei Fehler.

## Was abgedeckt ist

**`mobilebars.test.js`** — Auf Mobil werden Timeframes, Chart-Werkzeuge und
Ticker-Kennzahlen aus der Kopfleiste in Bottom-Sheets *verschoben* (nicht
kopiert). Das ist die riskante Stelle: ginge dabei ein Klick-Handler verloren
oder entstünden doppelte IDs, wäre die Mobil-UI still kaputt. Getestet werden
der Umzug in beide Richtungen (inkl. Geräterotation), Handler-Integrität,
ID-Eindeutigkeit, Sheet-Steuerung und Idempotenz.

**`timeaxis.test.js`** — `alignToMainTime()` / `alignToChartTime()` reihen
Sub-Chart- und Indikator-Werte in die Zeit-Domain des Haupt-Charts ein.
Ohne diese Ausrichtung klemmt `setVisibleRange()` auf den kürzeren Datenbereich
der jeweiligen Serie, und die Zeitlinien laufen sichtbar auseinander.
