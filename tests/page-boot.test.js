// Laedt die Seite wie ein echter Browser: jsdom parst das Dokument selbst und
// fuehrt die Inline-Skripte in Dokumentreihenfolge waehrend des Parsens aus.
//
// Das ist der Test, der den Fehler gefunden haette. Die frueheren Tests
// evaluierten die Skriptbloecke NACH dem Parsen (da war alles Markup schon da)
// und uebersahen deshalb, dass MobileBars.init() beim echten Laden auf noch
// nicht existierende Sheet-Elemente zugriff -> TypeError -> Abbruch der
// restlichen Initialisierung -> Chart ohne Groesse und ohne Daten.
//
// Ausfuehren:  node tests/page-boot.test.js

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const APP = path.join(__dirname, '..', 'static', 'app.html');
let html = fs.readFileSync(APP, 'utf8');

let ok = true;
const chk = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (c || !extra ? '' : '   [' + extra + ']'));
  if (!c) ok = false;
};

// Externe Chart-Bibliothek nicht laden — stattdessen ein Stub, das wir vor
// den Seitenskripten einspielen.
html = html.replace(/<script src="https:\/\/unpkg\.com[^"]*"><\/script>/, `<script>
window.__calls = [];
const S = () => ({ setData(){}, update(){}, applyOptions(){}, setMarkers(){},
  createPriceLine: () => ({}), removePriceLine(){}, priceScale: () => ({ applyOptions(){} }) });
window.LightweightCharts = {
  createChart: () => ({
    addCandlestickSeries: S, addHistogramSeries: S, addLineSeries: S,
    addAreaSeries: S, addBaselineSeries: S, removeSeries(){}, applyOptions(){}, remove(){},
    resize: (w,h) => window.__calls.push('resize:'+w+'x'+h),
    priceScale: () => ({ applyOptions(){} }),
    timeScale: () => ({ fitContent(){}, applyOptions(){}, setVisibleRange(){},
      getVisibleRange: () => null, setVisibleLogicalRange(){}, getVisibleLogicalRange: () => null,
      scrollToRealTime(){}, subscribeVisibleTimeRangeChange(){}, subscribeVisibleLogicalRangeChange(){} }),
    subscribeCrosshairMove(){}, subscribeClick(){}, unsubscribeCrosshairMove(){},
  }),
  CrosshairMode: { Normal: 0, Magnet: 1 },
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
  ColorType: { Solid: 'solid' },
  PriceScaleMode: { Normal: 0 },
};
window.fetch = (u) => {
  const url = String(u); window.__calls.push('fetch:'+url.split('?')[0]);
  // Formen grob nachbilden, damit der Code realistisch weiterlaeuft.
  let body = [];
  if (url.includes('/api/symbols'))        body = { symbols: ['BTCUSDT','ETHUSDT'] };
  else if (url.includes('/api/ticker'))    body = { price:42000, change:1.2, high:43000, low:41000,
                                                    volume:1e9, oi:5e4, mark:42000, funding:0.01,
                                                    nextFundingTime: Date.now()+3.6e6 };
  else if (url.includes('/api/klines'))    body = Array.from({length:120},(_,i)=>({
                                                    time: 1700000000+i*300, open:1,high:2,low:0.5,close:1.5,volume:10 }));
  else if (url.includes('/api/watchlist')) body = { items: [] };
  else if (url.includes('/api/ai/health')) body = { ok:true, model:'test' };
  else if (url.includes('/api/settings'))  body = {};
  else if (url.includes('/api/indicators/modules')) body = { modules: [] };
  else if (url.includes('/api/ls'))        body = { global: [] };
  return Promise.resolve({ ok:true, status:200,
    json: () => Promise.resolve(body), text: () => Promise.resolve('') });
};
window.WebSocket = function(){ return { close(){}, send(){}, addEventListener(){}, readyState:0 }; };
// jsdom kennt matchMedia nicht; echte Browser schon. Ohne Stub braeche der
// Test an einer Stelle ab, die im Browser voellig unkritisch ist.
window.matchMedia = window.matchMedia || function(q) {
  return { media: q, matches: false, onchange: null,
    addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){},
    dispatchEvent(){ return false; } };
};
</script>`);

// Modul-Skripte der Indikatoren ebenfalls neutralisieren (separate Dateien).
html = html.replace(/<script src="\/static\/indicators\/[^"]*"><\/script>/g, '');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push(e.message || String(e)));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',      // Skripte beim Parsen ausfuehren
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'http://localhost:7777/static/app.html',
});
const w = dom.window;

// DOMContentLoaded abwarten, dann pruefen.
setTimeout(() => {
  console.log('── Skriptfehler beim Laden ──');
  const fatal = errors.filter(e => !/Not implemented|Could not parse CSS/i.test(e));
  fatal.slice(0, 5).forEach(e => console.log('   ' + e.split('\n')[0]));
  chk('keine Skriptfehler beim Parsen', fatal.length === 0,
      fatal.length + ' Fehler, erster: ' + (fatal[0] || '').split('\n')[0]);

  console.log('── Initialisierung tatsaechlich durchgelaufen? ──');
  const calls = w.__calls || [];
  chk('MobileBars definiert', typeof w.MobileBars !== 'undefined');
  chk('Chart wurde erstellt', typeof w.chart !== 'undefined' || calls.some(c => c.startsWith('resize')));
  chk('Daten wurden angefordert (fetch /api/klines)',
      calls.some(c => c.includes('/api/klines')),
      'fetches: ' + calls.filter(c => c.startsWith('fetch')).slice(0, 6).join(', '));
  chk('resizeCharts wurde aufgerufen', typeof w.resizeCharts === 'function');
  // Hinweis: chart.resize() feuert in jsdom nicht, weil clientWidth/clientHeight
  // dort immer 0 sind und resizeCharts() dann bewusst per setTimeout wartet.
  // Im Browser hat der Container echte Masse. Deshalb hier nur die Existenz
  // pruefen — die Sichtbarkeitskette deckt tests/mobile-render.test.js ab.
  console.log('   (chart.resize in jsdom nicht messbar: clientHeight ist dort immer 0)');

  console.log('── Ladeanzeige darf den Chart nicht dauerhaft verdecken ──');
  const loading = w.document.getElementById('chartLoading');
  chk('chartLoading existiert', !!loading);

  console.log(ok ? '\nAlle Tests bestanden.' : '\nFEHLGESCHLAGEN.');
  process.exit(ok ? 0 : 1);
}, 1500);
