// Prueft den Liquidation-Heatmap-Indikator als Overlay im Hauptchart:
// Markup, CSS, Verdrahtung und den Renderer gegen gemockte Chart-Achsen.
//
// Ausfuehren:  NODE_PATH=/pfad/zu/node_modules node tests/liqheat-overlay.test.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP = path.join(__dirname, '..', 'static', 'app.html');
const html = fs.readFileSync(APP, 'utf8');

let ok = true;
const chk = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (c || !extra ? '' : '   [' + extra + ']'));
  if (!c) ok = false;
};

console.log('── Verdrahtung im Quelltext ──');
chk('Toggle-Button #lhToggle vorhanden', /id="lhToggle"/.test(html));
chk('Overlay-Canvas #lhCanvas vorhanden', /id="lhCanvas"/.test(html));
chk('Canvas ist klickdurchlaessig',
  /id="lhCanvas"[^>]*pointer-events:\s*none/.test(html),
  'sonst blockiert das Overlay die Chart-Bedienung');
chk('Canvas liegt unter dem Volume Profile',
  /id="lhCanvas"[^>]*z-index:\s*2/.test(html) &&
  /id="vpCanvas"[^>]*z-index:\s*3/.test(html));
chk('Overlay startet versteckt', /id="lhCanvas"[^>]*display:\s*none/.test(html));
chk('nutzt priceToCoordinate der Kerzenserie',
  /candleSeries\.priceToCoordinate\(d\.low/.test(html));
chk('nutzt timeToCoordinate der Zeitachse',
  /ts\.timeToCoordinate\(toLocalTime\(d\.times\[i\]\)\)/.test(html),
  'ohne toLocalTime waere die Heatmap zeitversetzt');
chk('Redraw bei Zoom/Pan verdrahtet',
  /subscribeVisibleLogicalRangeChange[\s\S]{0,160}drawLiqHeatOverlay/.test(html));
chk('Redraw bei Resize verdrahtet',
  /resizeCharts[\s\S]{0,400}State\.showLH\) drawLiqHeatOverlay/.test(html));
chk('Redraw-Timer fuer vertikalen Zoom',
  /setInterval\(\(\) => \{ if \(State\.showLH\) drawLiqHeatOverlay\(\); \}, 600\)/.test(html));
chk('Timeframe-Wechsel laedt das Overlay neu',
  /switchTF[\s\S]{0,400}State\.showLH.*loadLiqHeatOverlay/.test(html));
chk('reloadAll invalidiert den Overlay-Cache',
  /State\.lhData = null;\s*\n\s*if \(State\.showLH\) loadLiqHeatOverlay/.test(html));
chk('State-Felder deklariert',
  /showLH: false/.test(html) && /lhData: null/.test(html) &&
  /lhThreshold:/.test(html));

const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window, d = w.document;
const cs = el => w.getComputedStyle(el);

console.log('── Markup & CSS ──');
const cv = d.getElementById('lhCanvas');
const lg = d.getElementById('lhLegend');
chk('#lhCanvas im DOM', !!cv);
chk('#lhLegend im DOM', !!lg);
chk('#lhMax im DOM', !!d.getElementById('lhMax'));
chk('#lhStatus im DOM', !!d.getElementById('lhStatus'));
chk('Canvas ist Geschwister von #chart',
  cv.parentElement === d.getElementById('chart').parentElement);
chk('Legende startet versteckt', lg.style.display === 'none');
chk('Legende ist absolut positioniert', cs(lg).position === 'absolute');
chk('Legende ist klickdurchlaessig', cs(lg).pointerEvents === 'none');
chk('Toggle-Button in der Chart-Toolbar',
  !!d.querySelector('#lhToggle') &&
  d.getElementById('lhToggle').classList.contains('chart-type-btn'));
chk('Toggle-Button startet inaktiv',
  !d.getElementById('lhToggle').classList.contains('active'));

console.log('── Renderer gegen gemockte Chart-Achsen ──');

// Chart-Mocks: lineare Preis- und Zeitachsen, damit die erwarteten
// Koordinaten exakt nachrechenbar sind.
const CH_W = 800, CH_H = 400;
const P_LO = 90, P_HI = 110;                 // Preisspanne des sichtbaren Charts
const T0 = 1700000000, T_STEP = 900;
const COLS = 40, ROWS = 50;

const priceToY = p => CH_H - ((p - P_LO) / (P_HI - P_LO)) * CH_H;
const timeToX = t => ((t - T0) / (T_STEP * (COLS - 1))) * CH_W;

let priceCalls = 0, timeCalls = 0;
w.candleSeries = {
  priceToCoordinate: p => { priceCalls++; return priceToY(p); },
};
w.chart = {
  timeScale: () => ({ timeToCoordinate: t => { timeCalls++; return timeToX(t); } }),
};
// Der Chart rechnet in Zurich-Zeit; im Test genuegt eine feste Verschiebung,
// solange sie in Mock und Renderer identisch angewandt wird.
w.toLocalTime = s => s;

const drawn = [];
const calls = { fillRect: 0, clearRect: 0 };
let lastFill = null, compositeOps = [];
const ctxStub = {
  setTransform() {}, clearRect() { calls.clearRect++; },
  fillRect(x, y, wd, ht) { calls.fillRect++; drawn.push({ x, y, w: wd, h: ht, fill: lastFill }); },
  set fillStyle(v) { lastFill = v; }, get fillStyle() { return lastFill; },
  set globalCompositeOperation(v) { compositeOps.push(v); },
  get globalCompositeOperation() { return compositeOps[compositeOps.length - 1]; },
};
w.HTMLCanvasElement.prototype.getContext = () => ctxStub;

const setSize = (el, wpx, hpx) => {
  Object.defineProperty(el, 'clientWidth', { value: wpx, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: hpx, configurable: true });
};
setSize(d.getElementById('chart'), CH_W, CH_H);

// Mock-Heatmap: ein einziges kraeftiges Band bei genau Preis 100.
const HLO = 80, HHI = 120, BIN = (HHI - HLO) / ROWS;   // 0.8 pro Bin
const BAND_ROW = Math.floor((100 - HLO) / BIN);        // Bin, der Preis 100 enthaelt
const hmock = {
  symbol: 'BTCUSDT', exchange: 'binance', window: '1d', interval: '15m',
  price: 100, oiUsd: 8.4e9, low: HLO, high: HHI, binSize: BIN,
  priceBins: ROWS, maxValue: 1e8,
  times: Array.from({ length: COLS }, (_, i) => T0 + i * T_STEP),
  prices: Array.from({ length: ROWS }, (_, i) => HLO + (i + 0.5) * BIN),
  candles: Array.from({ length: COLS }, (_, i) => ({
    time: T0 + i * T_STEP, open: 100, high: 101, low: 99, close: 100 })),
  matrix: Array.from({ length: COLS }, () =>
    Array.from({ length: ROWS }, (_, y) => (y === BAND_ROW ? 1e8 : 0))),
};

// Overlay-Codeblock extrahieren und isoliert ausfuehren.
const start = html.indexOf('//  INDIKATOR: LIQUIDATION HEATMAP ALS CHART-OVERLAY');
const end = html.indexOf('function drawValueAreaLines()', start);
chk('Overlay-Codeblock gefunden', start > 0 && end > start);
w.State = { symbol: 'BTCUSDT', exchange: 'binance', tf: '15m',
            showLH: true, lhData: hmock, lhLoading: false, lhThreshold: 0.12 };
w.lmFmtUsd = v => (v / 1e6).toFixed(1) + 'M';

let threw = null;
try { w.eval(html.slice(start, end)); w.drawLiqHeatOverlay(); }
catch (e) { threw = e; }
chk('drawLiqHeatOverlay() laeuft ohne Fehler', !threw, threw && threw.message);
chk('Canvas wird sichtbar geschaltet', cv.style.display === 'block');
chk('Legende wird sichtbar', lg.style.display === 'flex');
chk('Canvas wird vor dem Zeichnen geleert', calls.clearRect === 1);
chk('Chart-Preisachse wird benutzt', priceCalls > 0, String(priceCalls));
chk('Chart-Zeitachse wird benutzt', timeCalls >= COLS, String(timeCalls));

console.log('── Geometrie: klebt das Band am richtigen Preis? ──');
chk('genau eine Zelle pro Spalte gezeichnet', drawn.length === COLS,
  String(drawn.length));
const expTop = priceToY(HLO + (BAND_ROW + 1) * BIN);
const expBot = priceToY(HLO + BAND_ROW * BIN);
const cell = drawn[0];
chk('Band liegt auf der Chart-Y-Koordinate des Preisbins',
  Math.abs(cell.y - Math.min(expTop, expBot)) < 0.51,
  `y=${cell.y.toFixed(2)} erwartet ${Math.min(expTop, expBot).toFixed(2)}`);
chk('Bandhoehe entspricht der Bin-Hoehe im Chart',
  Math.abs(cell.h - Math.abs(expBot - expTop)) < 0.51,
  `h=${cell.h.toFixed(2)} erwartet ${Math.abs(expBot - expTop).toFixed(2)}`);
chk('Preis 100 liegt innerhalb des gezeichneten Bandes',
  priceToY(100) >= cell.y - 0.5 && priceToY(100) <= cell.y + cell.h + 0.5,
  `y(100)=${priceToY(100).toFixed(1)} band=${cell.y.toFixed(1)}..${(cell.y + cell.h).toFixed(1)}`);
chk('erste Spalte startet am linken Chart-Rand',
  Math.abs(cell.x + cell.w / 2 - timeToX(T0)) < 1.5,
  `x=${cell.x.toFixed(2)}`);
const lastCell = drawn[drawn.length - 1];
chk('letzte Spalte endet am rechten Chart-Rand',
  Math.abs(lastCell.x + lastCell.w / 2 - timeToX(T0 + (COLS - 1) * T_STEP)) < 1.5,
  `x=${lastCell.x.toFixed(2)} erwartet ${timeToX(T0 + (COLS - 1) * T_STEP).toFixed(2)}`);
chk('Spaltenbreite entspricht dem Chart-Kerzenabstand',
  Math.abs(cell.w - (CH_W / (COLS - 1) + 0.5)) < 0.6,
  `w=${cell.w.toFixed(2)}`);
chk('Zellen ueberlappen leicht (keine Luecken)',
  cell.w > CH_W / (COLS - 1) - 0.01);

console.log('── Darstellung ──');
chk('additiver Blend-Modus wird gesetzt und zurueckgesetzt',
  compositeOps.includes('lighter') &&
  compositeOps[compositeOps.length - 1] === 'source-over',
  compositeOps.join(','));
chk('Farbe ist halbtransparent (Kerzen bleiben lesbar)',
  /^rgba\(\d+,\d+,\d+,0?\.\d+\)$/.test(cell.fill), cell.fill);
const alpha = parseFloat(cell.fill.split(',')[3]);
chk('staerkste Zelle bleibt unter Alpha 0.7', alpha <= 0.7, String(alpha));
chk('Legende zeigt das Maximum', d.getElementById('lhMax').textContent === '100.0M',
  d.getElementById('lhMax').textContent);
chk('lhColor liefert dunkel bei t=0', w.lhColor(0, 1) === 'rgba(4,2,15,1)');
chk('lhColor liefert hell bei t=1', w.lhColor(1, 1) === 'rgba(252,253,191,1)');
chk('lhColor klemmt Werte ausserhalb 0..1',
  w.lhColor(-3, 1) === w.lhColor(0, 1) && w.lhColor(9, 1) === w.lhColor(1, 1));

console.log('── Timeframe-Zuordnung ──');
chk('1m -> 12h', w.lhWindowForTF('1m') === '12h');
chk('15m -> 3d', w.lhWindowForTF('15m') === '3d');
chk('1h -> 1w', w.lhWindowForTF('1h') === '1w');
chk('4h -> 1m', w.lhWindowForTF('4h') === '1m');
chk('unbekannter TF faellt auf 1d zurueck', w.lhWindowForTF('xyz') === '1d');
chk('alle Ziele sind gueltige API-Fenster',
  ['1m', '5m', '15m', '30m', '1h', '4h', '1d']
    .every(tf => ['12h', '1d', '3d', '1w', '1m'].includes(w.lhWindowForTF(tf))));

console.log('── Aus-Zustand & Randfaelle ──');
w.State.showLH = false;
w.drawLiqHeatOverlay();
chk('ausgeschaltet: Canvas versteckt', cv.style.display === 'none');
chk('ausgeschaltet: Legende versteckt', lg.style.display === 'none');

w.State.showLH = true;
w.State.lhData = null;
let threw2 = null;
try { w.drawLiqHeatOverlay(); } catch (e) { threw2 = e; }
chk('ohne Daten wirft nicht', !threw2, threw2 && threw2.message);
chk('ohne Daten Canvas versteckt', cv.style.display === 'none');

// Zeitraum komplett ausserhalb der Sicht -> timeToCoordinate liefert null.
w.chart = { timeScale: () => ({ timeToCoordinate: () => null }) };
w.State.lhData = hmock;
const before = drawn.length;
let threw3 = null;
try { w.drawLiqHeatOverlay(); } catch (e) { threw3 = e; }
chk('Zeitraum ausserhalb der Sicht wirft nicht', !threw3, threw3 && threw3.message);
chk('Zeitraum ausserhalb der Sicht zeichnet nichts', drawn.length === before);

// Preisachse ausserhalb des Sichtbereichs -> priceToCoordinate liefert null.
w.chart = { timeScale: () => ({ timeToCoordinate: t => timeToX(t) }) };
w.candleSeries = { priceToCoordinate: () => null };
let threw4 = null;
try { w.drawLiqHeatOverlay(); } catch (e) { threw4 = e; }
chk('Preisachse ausserhalb der Sicht wirft nicht', !threw4, threw4 && threw4.message);

w.candleSeries = { priceToCoordinate: p => priceToY(p) };
let threw5 = null;
try { w.State.lhData = { matrix: [], times: [], prices: [], candles: [],
                         maxValue: 0, low: 0, high: 0, priceBins: 0 };
      w.drawLiqHeatOverlay(); } catch (e) { threw5 = e; }
chk('leere Matrix wirft nicht', !threw5, threw5 && threw5.message);

console.log('\n' + (ok ? 'ALLE TESTS BESTANDEN' : 'TESTS FEHLGESCHLAGEN'));
process.exit(ok ? 0 : 1);
