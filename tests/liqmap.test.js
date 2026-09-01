// Prueft das Liquidation-Map-Panel: Markup, CSS-Sichtbarkeit, Tab-Verdrahtung
// und den Canvas-Renderer gegen eine gemockte API-Antwort.
//
// Ausfuehren:  node tests/liqmap.test.js
//              NODE_PATH=/pfad/zu/node_modules node tests/liqmap.test.js

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

// ── Statische Analyse (kein DOM noetig) ──────────────────────────────────────
console.log('── Verdrahtung im Quelltext ──');
chk('Tab-Button "liqmap" vorhanden', /data-tab="liqmap"/.test(html));
chk('Pane #paneLiqMap vorhanden', /id="paneLiqMap"/.test(html));
chk('Tab-Switch schaltet paneLiqMap',
  /paneLiqMap'\)\.style\.display\s*=\s*tab === 'liqmap'/.test(html));
chk('Tab-Switch laedt die Map',
  /tab === 'liqmap'.*loadLiquidationMap\(\)/s.test(html));
chk('ruft /api/liquidation_map auf', /\/api\/liquidation_map\?symbol=/.test(html));
chk('reloadAll invalidiert den Map-Cache',
  /LM\.data = null;/.test(html) && /typeof LM !== 'undefined'/.test(html));
chk('LM als var deklariert (kein TDZ beim Boot)',
  /var LM = \{ window: '1d'/.test(html),
  'const/let wuerde in reloadAll() einen ReferenceError werfen');
chk('Fenster-Buttons fuer alle 5 Zeitraeume',
  ['12h', '1d', '3d', '1w', '1m'].every(w => html.includes(`data-win="${w}"`)));

// ── Gerendertes DOM ──────────────────────────────────────────────────────────
// runScripts:'outside-only' gibt uns ein window.eval mit echtem DOM-Scope,
// fuehrt aber die Skripte der Seite selbst NICHT aus — wir wollen nur den
// Liquidation-Map-Block isoliert testen, nicht die ganze App booten.
const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window, d = w.document;
const cs = el => w.getComputedStyle(el);

console.log('── Markup & CSS ──');
const pane = d.getElementById('paneLiqMap');
chk('#paneLiqMap im DOM', !!pane);
['lmCanvas', 'lmLegend', 'lmMeta', 'lmClusters', 'lmLoading', 'lmRefresh', 'lmWindows']
  .forEach(id => chk('#' + id + ' existiert', !!d.getElementById(id)));

chk('Tab sitzt in .side-tabs',
  !!d.querySelector('.side-tabs [data-tab="liqmap"]'));
chk('Pane ist Kind der Sidebar', pane && pane.closest('#sidebar') !== null);
chk('Pane hat Klasse side-pane', pane && pane.classList.contains('side-pane'));
chk('Pane startet versteckt', pane && cs(pane).display === 'none');

const wrap = d.querySelector('.lm-chart-wrap');
chk('.lm-chart-wrap hat feste Hoehe', wrap && cs(wrap).height === '300px',
  wrap ? cs(wrap).height : 'fehlt');
chk('.lm-chart-wrap ist positioniert (fuer Overlay)',
  wrap && cs(wrap).position === 'relative');
chk('genau ein .lm-win ist initial aktiv',
  d.querySelectorAll('.lm-win.active').length === 1);
chk('aktives Fenster ist 1d',
  d.querySelector('.lm-win.active').dataset.win === '1d');

// ── Renderer gegen Mock-Daten ────────────────────────────────────────────────
console.log('── Renderer (Mock-Daten) ──');

// Canvas-Kontext stubben: jsdom hat kein 2D-Backend. Wir zaehlen die Aufrufe,
// um zu pruefen, dass tatsaechlich gezeichnet wird.
const calls = { fillRect: 0, stroke: 0, fillText: 0, moveTo: 0, lineTo: 0 };
const ctxStub = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'canvas') return null;
    return (...a) => { if (prop in calls) calls[prop]++; return undefined; };
  },
  set() { return true; },
});
w.HTMLCanvasElement.prototype.getContext = () => ctxStub;

// Layout-Masse liefern (jsdom meldet sonst ueberall 0).
const setSize = (el, wpx, hpx) => {
  Object.defineProperty(el, 'clientWidth', { value: wpx, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: hpx, configurable: true });
};
setSize(wrap, 400, 300);

const price = 100;
const levels = [];
for (let i = 0; i < 60; i++) {
  const p = 80 + i * (40 / 60);
  const isLong = p < price;
  const usd = 1e6 * (1 + Math.sin(i));
  levels.push({
    price: p, total: Math.abs(usd),
    byLeverage: { '10': Math.abs(usd) * 0.6, '50': Math.abs(usd) * 0.4 },
    side: isLong ? 'long' : 'short',
    longUsd: isLong ? Math.abs(usd) : 0,
    shortUsd: isLong ? 0 : Math.abs(usd),
    cumulative: Math.abs(usd) * (i + 1),
  });
}
const mock = {
  symbol: 'BTCUSDT', exchange: 'binance', window: '1d', price,
  oiUsd: 8.4e9, low: 80, high: 120, binSize: 40 / 60,
  maxTotal: Math.max(...levels.map(l => l.total)),
  totalUsd: levels.reduce((s, l) => s + l.total, 0),
  levels,
  tiers: [
    { leverage: 10, color: '#4bc0f0', usd: 3e9 },
    { leverage: 25, color: '#2ee6a8', usd: 2.4e9 },
    { leverage: 50, color: '#f7c948', usd: 2e9 },
    { leverage: 100, color: '#ff7a45', usd: 9e8 },
  ],
  clustersBelow: [{ price: 92, usd: 4.7e8, side: 'long', distPct: -8 }],
  clustersAbove: [{ price: 108, usd: 5.2e8, side: 'short', distPct: 8 }],
};

// Die Renderfunktionen aus app.html isoliert auswerten. Wir ziehen den
// Liquidation-Map-Block aus dem Quelltext und fuehren ihn im DOM-Kontext aus.
const start = html.indexOf('//  LIQUIDATION MAP');
const end = html.indexOf("document.querySelectorAll('.side-tab')", start);
chk('Liquidation-Map-Codeblock gefunden', start > 0 && end > start);
const block = html.slice(start, end);

w.State = { symbol: 'BTCUSDT', exchange: 'binance' };
w.fetch = () => Promise.resolve({ json: () => Promise.resolve(mock) });
let threw = null;
try {
  w.eval(block);
  w.LM.data = mock;
  w.renderLiqMap();
} catch (e) { threw = e; }
chk('renderLiqMap() laeuft ohne Fehler', !threw, threw && threw.message);

chk('Balken werden gezeichnet (fillRect > 60)', calls.fillRect > 60, String(calls.fillRect));
chk('Kurven/Linien werden gezeichnet (stroke > 0)', calls.stroke > 0, String(calls.stroke));
chk('Achsenbeschriftung wird gezeichnet (fillText > 0)', calls.fillText > 0, String(calls.fillText));

console.log('── Ausgabe im DOM ──');
const legend = d.getElementById('lmLegend').innerHTML;
chk('Legende zeigt alle 4 Hebel',
  ['10x', '25x', '50x', '100x'].every(t => legend.includes(t)), legend.slice(0, 120));
chk('Legende nutzt die Tier-Farben', legend.includes('#ff7a45'));

const meta = d.getElementById('lmMeta').textContent;
chk('Meta zeigt Open Interest formatiert', /8\.40B/.test(meta), meta);
chk('Meta zeigt den Preis', meta.includes('100'), meta);

const clusters = d.getElementById('lmClusters');
chk('zwei Cluster gerendert', clusters.querySelectorAll('.lm-cluster').length === 2,
  String(clusters.querySelectorAll('.lm-cluster').length));
chk('Cluster oberhalb ist "up" (Shorts)',
  !!clusters.querySelector('.lm-cluster.up') &&
  clusters.querySelector('.lm-cluster.up').textContent.includes('Shorts liquidiert'));
chk('Cluster unterhalb ist "down" (Longs)',
  !!clusters.querySelector('.lm-cluster.down') &&
  clusters.querySelector('.lm-cluster.down').textContent.includes('Longs liquidiert'));
chk('Cluster absteigend nach USD sortiert',
  clusters.querySelector('.lm-cluster').textContent.includes('108'),
  'groesster Cluster (520M @ 108) muss zuerst stehen');

console.log('── Fenster-Umschaltung ──');
const btn3d = d.querySelector('.lm-win[data-win="3d"]');
btn3d.click();
chk('Klick setzt LM.window', w.LM.window === '3d', w.LM.window);
chk('Klick verschiebt die active-Klasse', btn3d.classList.contains('active'));
chk('nur ein Fenster aktiv', d.querySelectorAll('.lm-win.active').length === 1);

console.log('── Leerer Zustand ──');
w.LM.data = null;
let threw2 = null;
try { w.renderLiqMap(); } catch (e) { threw2 = e; }
chk('renderLiqMap() ohne Daten wirft nicht', !threw2, threw2 && threw2.message);
chk('Legende geleert', d.getElementById('lmLegend').innerHTML === '');
chk('Cluster zeigen Leermeldung',
  d.getElementById('lmClusters').textContent.includes('Keine Cluster'));

console.log('\n' + (ok ? 'ALLE TESTS BESTANDEN' : 'TESTS FEHLGESCHLAGEN'));
process.exit(ok ? 0 : 1);
