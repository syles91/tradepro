// Fuehrt die Inline-Skripte der Seite wirklich aus und faengt Fehler ab.
//
// Symptom: "der chart ladet wird aber nicht angezeigt". Wenn ein Skriptfehler
// auf oberster Ebene auftritt, bricht die Ausfuehrung ab — alles danach,
// inklusive init() und resizeCharts(), laeuft nie. Der Chart wird dann zwar
// erstellt, aber nie auf die Containergroesse gebracht.
//
// Ausfuehren:  node tests/boot.test.js

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const APP = path.join(__dirname, '..', 'static', 'app.html');
const html = fs.readFileSync(APP, 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

// Netzwerk und Chart-Bibliothek stubben — wir testen die Boot-Reihenfolge.
const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'http://localhost:7777/static/app.html',
});
const w = dom.window;

const noopSeries = () => ({
  setData(){}, update(){}, applyOptions(){}, setMarkers(){},
  createPriceLine: () => ({}), removePriceLine(){}, priceScale: () => ({ applyOptions(){} }),
});
const noopChart = () => ({
  addCandlestickSeries: noopSeries, addHistogramSeries: noopSeries,
  addLineSeries: noopSeries, addAreaSeries: noopSeries, addBaselineSeries: noopSeries,
  removeSeries(){}, resize(){}, applyOptions(){}, remove(){},
  priceScale: () => ({ applyOptions(){} }),
  timeScale: () => ({
    fitContent(){}, applyOptions(){}, setVisibleRange(){}, getVisibleRange: () => null,
    setVisibleLogicalRange(){}, getVisibleLogicalRange: () => null,
    scrollToRealTime(){}, subscribeVisibleTimeRangeChange(){}, subscribeVisibleLogicalRangeChange(){},
  }),
  subscribeCrosshairMove(){}, subscribeClick(){}, unsubscribeCrosshairMove(){},
});
w.LightweightCharts = {
  createChart: noopChart,
  CrosshairMode: { Normal: 0, Magnet: 1 },
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
  ColorType: { Solid: 'solid' },
  PriceScaleMode: { Normal: 0 },
};
w.fetch = () => Promise.resolve({
  ok: true, status: 200,
  json: () => Promise.resolve([]),
  text: () => Promise.resolve(''),
});
w.WebSocket = function () { return { close(){}, send(){}, addEventListener(){}, readyState: 0 }; };
w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener(){}, addListener(){} }));
w.scrollTo = () => {};
if (!w.navigator.serviceWorker) {
  Object.defineProperty(w.navigator, 'serviceWorker', {
    value: { register: () => Promise.resolve({ addEventListener(){} }), addEventListener(){} },
    configurable: true,
  });
}

// Marker setzen, um zu sehen, wie weit die Ausfuehrung kommt.
w.__reached = [];

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log(blocks.length + ' Inline-Skriptbloecke gefunden\n');

let failedAt = null;
blocks.forEach((code, i) => {
  if (failedAt !== null) { console.log('Block ' + i + ': UEBERSPRUNGEN (vorheriger Fehler)'); return; }
  try {
    w.eval(code);
    console.log('Block ' + i + ' (' + code.length + ' Zeichen): OK');
  } catch (e) {
    failedAt = i;
    console.log('Block ' + i + ' (' + code.length + ' Zeichen): FEHLER');
    console.log('   ' + e.constructor.name + ': ' + e.message);
    const line = (e.stack || '').split('\n').find(l => /<anonymous>|evalmachine/.test(l));
    if (line) console.log('   ' + line.trim());
    // Umgebende Quellzeile suchen
    const m = /:(\d+):(\d+)/.exec(line || '');
    if (m) {
      const lines = code.split('\n');
      const n = +m[1] - 1;
      for (let k = Math.max(0, n - 3); k <= Math.min(lines.length - 1, n + 1); k++) {
        console.log('   ' + (k === n ? '>>' : '  ') + ' ' + (k + 1) + '| ' + lines[k]);
      }
    }
  }
});

console.log('\n── Ergebnis ──');
let ok = true;
if (failedAt !== null) { console.log('FAIL - Skriptfehler in Block ' + failedAt); ok = false; }
else console.log('PASS - alle Bloecke laufen fehlerfrei durch');

if (errors.length) {
  console.log('\nGemeldete Fehler:');
  errors.slice(0, 10).forEach(e => console.log('   ' + e));
  ok = false;
}

// Wurden die zentralen Funktionen erreicht?
['MobileBars', 'State', 'resizeCharts', 'loadChart'].forEach(n => {
  const has = typeof w[n] !== 'undefined';
  console.log((has ? 'PASS' : 'FAIL') + ' - ' + n + ' definiert');
  if (!has) ok = false;
});

process.exit(ok ? 0 : 1);
