/* Headless-Test der Panel-Runtime (DOM + LightweightCharts gestubbt).
 * Prüft: Laden vor core.js, Hinzufügen, Overlay vs. Pane, Legende,
 * Einstellungen übernehmen, Sichtbarkeit, Entfernen, Persistenz.
 * Ausführen:  node tests/test_panel.js
 */
const fs = require('fs');
const path = require('path');

// ── Minimal-DOM ───────────────────────────────────────────────────────────
function mkEl(tag) {
  const el = {
    tagName: tag, children: [], style: {}, dataset: {}, className: '',
    _html: '', value: '', type: '', checked: false, clientWidth: 400, clientHeight: 130,
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; this.children = []; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); },
    querySelector(sel) { return mkEl('div'); },
    querySelectorAll() { return []; },
    addEventListener() {}, focus() {}, closest() { return this; },
  };
  return el;
}
const byId = {};
global.document = {
  head: mkEl('head'),
  createElement: mkEl,
  getElementById(id) { return byId[id] || (byId[id] = mkEl('div')); },
  addEventListener() {},
};
global.window = global;
global.addEventListener = function () {};
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] || null; },
  setItem(k, v) { this._d[k] = v; },
};

// ── LightweightCharts-Stub ────────────────────────────────────────────────
let seriesCount = 0;
function mkSeries(kind) {
  seriesCount++;
  return { kind, data: null, setData(d) { this.data = d; }, applyOptions() {} };
}
function mkChart() {
  const created = [];
  return {
    created,
    addLineSeries(o) { const s = mkSeries('line'); s.opts = o; created.push(s); return s; },
    addHistogramSeries(o) { const s = mkSeries('hist'); s.opts = o; created.push(s); return s; },
    addAreaSeries(o) { const s = mkSeries('area'); s.opts = o; created.push(s); return s; },
    removeSeries(s) { const i = created.indexOf(s); if (i >= 0) created.splice(i, 1); },
    resize() {}, remove() {},
    timeScale: () => ({
      getVisibleRange: () => ({ from: 1, to: 2 }),
      setVisibleRange() {},
      subscribeVisibleTimeRangeChange() {},
    }),
  };
}
global.LightweightCharts = { createChart: mkChart, CrosshairMode: { Normal: 0 } };

// ── WICHTIG: panel.js VOR core.js laden (echte Ladereihenfolge im Browser) ──
const IND = path.join(__dirname, '..', 'static', 'indicators');
require(path.join(IND, 'panel.js'));
let fails = 0;
const ok = (name, cond) => { console.log((cond ? '  OK   ' : '  FAIL ') + name); if (!cond) fails++; };

ok('panel.js laedt ohne core.js', !!TradePro.IndicatorPanel);

require(path.join(IND, 'core.js'));
for (const folder of ['builtin', 'custom']) {
  for (const f of fs.readdirSync(path.join(IND, folder)).filter(x => x.endsWith('.js')).sort()) {
    require(path.join(IND, folder, f));
  }
}
ok('core.js + Module registriert (' + TradePro.Indicators.all().length + ')', TradePro.Indicators.all().length >= 10);

// ── Panel anhaengen ───────────────────────────────────────────────────────
const candles = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_klines.json'), 'utf8'));
const mainChart = mkChart();
const panesEl = mkEl('div');
const legendEl = mkEl('div');

const P = TradePro.IndicatorPanel;
P.attach({
  chart: mainChart, chartOpts: { crosshair: {} },
  getCandles: () => candles, toLocalTime: t => t,
  panesEl, mainLegendEl: legendEl,
});
ok('attach() ohne gespeicherte Indikatoren', P.instances.length === 0);

// ── Overlay hinzufuegen ───────────────────────────────────────────────────
const ema = P.addIndicator('ema');
ok('EMA hinzugefuegt', P.instances.length === 1);
ok('EMA rendert auf Haupt-Chart (Overlay)', mainChart.created.length === 1);
ok('EMA erzeugt KEIN eigenes Pane', panesEl.children.length === 0);
ok('EMA-Serie hat Daten', mainChart.created[0].data && mainChart.created[0].data.length > 200);
ok('EMA-Legende enthaelt letzten Wert', typeof ema.lastValues.line === 'number');

// ── Pane-Indikator hinzufuegen ────────────────────────────────────────────
const macd = P.addIndicator('macd');
ok('MACD hinzugefuegt', P.instances.length === 2);
ok('MACD erzeugt eigenes Pane', panesEl.children.length === 1);
ok('MACD hat 3 Plots (hist/macd/signal)', macd.series.length === 3);
ok('MACD landet NICHT auf Haupt-Chart', mainChart.created.length === 1);

// ── Einstellungen aendern ─────────────────────────────────────────────────
const before = ema.lastValues.line;
P.updateInputs(ema.id, { length: 200 });
ok('EMA(200) liefert anderen Wert als EMA(21)', ema.lastValues.line !== before);
ok('Keine Serien-Leaks nach Re-Render (Overlay bleibt 1)', mainChart.created.length === 1);
ok('Keine Serien-Leaks im Pane (bleibt 3)', macd.series.length === 3);

// ── Sichtbarkeit ──────────────────────────────────────────────────────────
P.setVisible(ema.id, false);
ok('Ausgeblendeter Indikator entfernt seine Serien', mainChart.created.length === 0);
P.setVisible(ema.id, true);
ok('Wieder eingeblendet -> Serie zurueck', mainChart.created.length === 1);

// ── Persistenz ────────────────────────────────────────────────────────────
const saved = JSON.parse(localStorage.getItem('tradepro.indicators.v1') || '[]');
ok('LocalStorage enthaelt 2 Indikatoren', saved.length === 2);
ok('LocalStorage speichert Inputs', saved.find(s => s.defId === 'ema').inputs.length === 200);

// ── Entfernen ─────────────────────────────────────────────────────────────
P.removeInstance(macd.id);
ok('MACD entfernt', P.instances.length === 1);
ok('MACD-Pane aus DOM entfernt', panesEl.children.length === 0);
P.removeInstance(ema.id);
ok('EMA entfernt, Haupt-Chart sauber', P.instances.length === 0 && mainChart.created.length === 0);

// ── Alle Indikatoren durchspielen ─────────────────────────────────────────
let allOk = true;
for (const def of TradePro.Indicators.all()) {
  const inst = P.addIndicator(def.id);
  if (!inst || !inst.series.length) { console.log('  FAIL rendert nicht: ' + def.id); allOk = false; }
  P.removeInstance(inst.id);
}
ok('Alle registrierten Indikatoren rendern', allOk);
ok('Nach Aufraeumen keine Instanzen offen', P.instances.length === 0);

console.log('\n' + (fails === 0 ? 'ALLE PANEL-TESTS BESTANDEN' : fails + ' FEHLER'));
process.exit(fails === 0 ? 0 : 1);
