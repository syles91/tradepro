/* Headless-Test der responsiven Panel-Logik (Viewport-abhängiges JS).
 * Prüft, dass die Höhenbudgetierung und die kompakte Legende bei
 * verschiedenen Viewports korrekt greifen — ohne echten Browser.
 * Ausführen:  node tests/test_responsive_logic.js
 */
const fs = require('fs');
const path = require('path');

function mkEl(tag) {
  return {
    tagName: tag, children: [], style: {}, dataset: {}, className: '',
    _html: '', value: '', type: '', checked: false, clientWidth: 400, clientHeight: 130,
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); },
    querySelector() { return mkEl('div'); },
    querySelectorAll() { return []; },
    addEventListener() {}, focus() {}, closest() { return this; },
  };
}
const byId = {};
// Simuliert die feststehenden Chrome-Elemente (Topbar, TF-Leiste, Subchart,
// Mobile-Nav), deren Hoehe applyPaneHeights vom Budget abzieht.
let chromeHeights = { '.topbar': 54, '.tf-bar': 46, '.subchart-wrap.show': 130, '.subchart-tabs': 42, '.mobile-nav': 0 };
function chromeEl(h) {
  return { offsetParent: h > 0 ? {} : null, getBoundingClientRect: () => ({ height: h }) };
}
global.document = {
  head: mkEl('head'), createElement: mkEl,
  getElementById(id) { return byId[id] || (byId[id] = mkEl('div')); },
  querySelectorAll(sel) {
    if (sel.includes('.topbar')) {
      return Object.values(chromeHeights).map(chromeEl).filter(e => e.offsetParent);
    }
    return [];
  },
  addEventListener() {},
};
global.window = global;
const listeners = {};
global.addEventListener = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
global.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } };
global.innerWidth = 1920;
global.innerHeight = 1080;

function mkChart() {
  const created = [];
  return {
    created,
    addLineSeries(o) { const s = { setData(d) { this.data = d; }, applyOptions() {}, opts: o }; created.push(s); return s; },
    addHistogramSeries(o) { return this.addLineSeries(o); },
    addAreaSeries(o) { return this.addLineSeries(o); },
    removeSeries(s) { const i = created.indexOf(s); if (i >= 0) created.splice(i, 1); },
    resize() {}, remove() {},
    timeScale: () => ({
      getVisibleRange: () => ({ from: 1, to: 2 }), setVisibleRange() {},
      subscribeVisibleTimeRangeChange() {},
    }),
  };
}
global.LightweightCharts = { createChart: mkChart, CrosshairMode: { Normal: 0 } };

const IND = path.join(__dirname, '..', 'static', 'indicators');
require(path.join(IND, 'panel.js'));
require(path.join(IND, 'core.js'));
for (const folder of ['builtin', 'custom']) {
  for (const f of fs.readdirSync(path.join(IND, folder)).filter(x => x.endsWith('.js')).sort()) {
    require(path.join(IND, folder, f));
  }
}

let fails = 0;
const ok = (n, c, d = '') => { console.log((c ? '  OK   ' : '  FAIL ') + n + (!c && d ? '   (' + d + ')' : '')); if (!c) fails++; };

const candles = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_klines.json'), 'utf8'));
const P = TradePro.IndicatorPanel;
const panesEl = mkEl('div');
P.attach({
  chart: mkChart(), chartOpts: { crosshair: {} },
  getCandles: () => candles, toLocalTime: t => t,
  panesEl, mainLegendEl: mkEl('div'),
});

// 3 Pane-Indikatoren = Worst Case
const insts = ['rsi', 'macd', 'atr'].map(id => P.addIndicator(id));
ok('3 Pane-Indikatoren aktiv', panesEl.children.length === 3);

const VIEWPORTS = [
  ['Desktop 1920x1080', 1920, 1080, 84, 130],
  ['Laptop 1366x768',   1366,  768, 84, 130],
  ['Tablet 820x1180',    820, 1180, 64, 104],
  ['iPhone 390x844',     390,  844, 64,  92],
  ['Klein 360x740',      360,  740, 64,  92],
  ['Quer 844x390',       844,  390, 56,  74],
];

for (const [label, w, h, min, max] of VIEWPORTS) {
  global.innerWidth = w;
  global.innerHeight = h;
  P.resizeAll();
  const hs = insts.map(i => parseInt(i.paneEl.style.height, 10));
  const total = hs.reduce((a, b) => a + b, 0);
  const inRange = hs.every(x => x >= min && x <= max);
  ok(label + ' Pane-Hoehen in [' + min + ',' + max + ']: ' + hs.join('/'), inRange, hs.join('/'));
  ok(label + ' Panes gesamt < 55% Viewport (' + total + '/' + h + ')', total < h * 0.55, total + ' >= ' + Math.round(h * 0.55));
}

// Kompakte Legende auf schmalen Screens
global.innerWidth = 1920; global.innerHeight = 1080;
P.renderAll();
const wide = insts[1].legendEl.innerHTML; // MACD
global.innerWidth = 390; global.innerHeight = 844;
P.renderAll();
const narrow = insts[1].legendEl.innerHTML;
ok('Breite Legende zeigt volle Parameter', wide.includes('MACD 12, 26, 9'), wide.slice(0, 80));
ok('Schmale Legende kuerzt auf Kuerzel', narrow.includes('>MACD<') && !narrow.includes('12, 26, 9'), narrow.slice(0, 80));
const wideVals = (wide.match(/ind-val/g) || []).length;
const narrowVals = (narrow.match(/ind-val/g) || []).length;
ok('Schmale Legende zeigt weniger Werte (' + narrowVals + ' < ' + wideVals + ')', narrowVals < wideVals);

// Resize-Listener registriert (Rotation)
ok('resize-Listener registriert', (listeners.resize || []).length >= 1);
ok('orientationchange-Listener registriert', (listeners.orientationchange || []).length >= 1);

// Ein einzelnes Pane darf auf Desktop volle Höhe haben
insts.slice(1).forEach(i => P.removeInstance(i.id));
global.innerWidth = 1920; global.innerHeight = 1080;
P.resizeAll();
ok('Einzelnes Pane auf Desktop = 130px', parseInt(insts[0].paneEl.style.height, 10) === 130,
   insts[0].paneEl.style.height);

console.log('\n' + (fails === 0 ? 'ALLE RESPONSIVE-LOGIK-TESTS BESTANDEN' : fails + ' FEHLER'));
process.exit(fails === 0 ? 0 : 1);
