# TradePro — Modulares Indikator-System

TradingView-artiges Indikator-Panel. Ein Indikator ist **eine eigenständige
JS-Datei**. Neue Indikatoren werden per Drop-in importiert — keine Änderung am
Terminal-Code, kein Server-Neustart.

## Verzeichnisse

```
static/indicators/
├── core.js                  # Registry + Mathe-Bibliothek (nicht ändern)
├── panel.js                 # Panel-Runtime: Panes, Legenden, Dialoge
├── builtin/                 # mitgelieferte Indikatoren
│   ├── ma.js                # EMA, SMA, VWAP
│   ├── oscillators.js       # RSI, MACD, Stochastic
│   └── volatility.js        # Bollinger Bands, ATR, SuperTrend
└── custom/                  # ← eigene Indikatoren hier ablegen
    ├── example_donchian.js
    └── momentum.js
```

Der Endpoint `GET /api/indicators/modules` listet alle `.js`-Dateien aus
`builtin/` und `custom/` (alphabetisch, `core.js` immer zuerst). Das Frontend
lädt diese Liste beim Start. Dateien mit `_`-Präfix werden ignoriert.

## Neuen Indikator importieren

1. Datei nach `static/indicators/custom/mein_indikator.js` legen
2. Browser neu laden — fertig. Der Indikator steht im Panel unter **ƒ Indikatoren**.

## Definitions-Schema

```js
TradePro.Indicators.register({
  id:       'mein_ind',        // eindeutig, Pflicht
  name:     'Mein Indikator',  // Anzeigename im Browser
  short:    'MI',              // Kürzel
  category: 'Trend',           // Gruppierung ('Trend', 'Oszillatoren', 'Volatilität', …)
  pane:     'main',            // 'main' = Overlay im Chart | 'separate' = eigenes Pane
  precision: 2,                // Nachkommastellen (nur bei 'separate')

  inputs: [
    { key:'length', label:'Länge',  type:'number', default:14, min:1, max:500, step:1 },
    { key:'source', label:'Quelle', type:'select', default:'close',
      options:[['close','Close'],['hl2','HL2']] },
    { key:'color',  label:'Farbe',  type:'color',  default:'#f7c948' },
    { key:'flag',   label:'Aktiv',  type:'bool',   default:true },
  ],

  plots: [
    // type: 'line' | 'histogram' | 'area'
    { key:'line', type:'line', label:'MI',
      colorFrom:'color',      // Farbe aus diesem Input-Key ziehen
      widthFrom:'lineWidth',  // Breite aus Input-Key
      lineWidth:2, lineStyle:0, noLegend:false },
  ],

  legend: i => 'MI ' + i.length,   // Text in der Chart-Legende

  calc(ctx) {
    const src = ctx.source(ctx.inputs.source);
    const vals = ctx.math.ema(src, +ctx.inputs.length);
    return { line: ctx.math.toSeries(ctx.time, vals, ctx.toLocalTime) };
  },
});
```

### `ctx` in `calc()`

| Feld | Beschreibung |
|---|---|
| `ctx.candles` | Roh-Kerzen |
| `ctx.open/high/low/close/volume/time` | Arrays (`time` = Unix-Sekunden UTC) |
| `ctx.inputs` | aktuelle Nutzer-Einstellungen |
| `ctx.source(key)` | `close`, `open`, `high`, `low`, `hl2`, `hlc3`, `ohlc4` |
| `ctx.math` | Mathe-Bibliothek (unten) |
| `ctx.toLocalTime(t)` | UTC → Europe/Zurich (**immer** anwenden, sonst falsche Achse) |

### `ctx.math`

`sma`, `ema`, `rma`, `wma`, `stdev`, `highest`, `lowest`, `trueRange`,
`toSeries(times, values, toLocalTime)`.

`toSeries` verwirft `null`/`NaN` automatisch — Lücken am Serienanfang sind also
unkritisch.

### Rückgabe von `calc()`

Objekt mit einem Key pro Plot: `{ plotKey: [{ time, value, color? }, ...] }`.
`color` pro Punkt wird bei `histogram` und `line` unterstützt (siehe SuperTrend,
MACD-Histogramm).

## Bedienung im Terminal

- **ƒ Indikatoren** in der Timeframe-Leiste → Suche + Kategorien
- Legende im Chart: 👁 ein/aus · ⚙ Einstellungen · ✕ entfernen
- Overlay-Indikatoren liegen im Hauptchart, `separate` bekommen ein eigenes,
  zeitsynchrones Pane unter dem Chart
- Auswahl und Einstellungen werden in `localStorage` unter
  `tradepro.indicators.v1` gespeichert und beim nächsten Besuch wiederhergestellt

## JS-API (Konsole / Automatisierung)

```js
TradePro.IndicatorPanel.addIndicator('rsi');           // -> Instanz
TradePro.IndicatorPanel.updateInputs(id, {length:21}); // Inputs ändern
TradePro.IndicatorPanel.setVisible(id, false);         // ausblenden
TradePro.IndicatorPanel.removeInstance(id);
TradePro.IndicatorPanel.instances;                     // aktive Instanzen
TradePro.Indicators.all();                             // registrierte Definitionen
```

## Tests

```bash
node tests/test_indicators.js   # Berechnungen gegen echte BTCUSDT-Kerzen
node tests/test_panel.js        # Panel-Runtime (DOM/Chart gestubbt)
```

`tests/fixture_klines.json` enthält 300 echte 5m-Kerzen aus `/api/klines`.

## Robustheit

Ein defektes Modul kann das Terminal nicht lahmlegen: Fehler beim Laden
(`onerror`) und beim Rechnen (`try/catch` in `compute`) werden abgefangen und nur
auf der Konsole geloggt — die übrigen Indikatoren laufen weiter.
