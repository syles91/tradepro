/* Headless-Test der modularen Indikator-Engine mit echten BTCUSDT-Kerzen.
 * Ausführen:  node tests/test_indicators.js
 */
const fs = require('fs');
const path = require('path');
global.window = global;
global.TradePro = {};
global.document = { head: { appendChild() {} }, createElement() { return {}; } };

const IND = path.join(__dirname, '..', 'static', 'indicators');
require(path.join(IND, 'core.js'));
for (const folder of ['builtin', 'custom']) {
  for (const f of fs.readdirSync(path.join(IND, folder)).filter(x => x.endsWith('.js')).sort()) {
    require(path.join(IND, folder, f));
  }
}

const Reg = TradePro.Indicators;
const candles = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_klines.json'), 'utf8'));
console.log('Kerzen:', candles.length, '| letzter Close:', candles[candles.length - 1].close);
console.log('Registrierte Indikatoren:', Reg.all().length, '\n');

let fails = 0;
for (const def of Reg.all()) {
  const inputs = Reg.defaults(def);
  const res = Reg.compute(def, candles, inputs, t => t);
  const parts = [];
  for (const plot of def.plots) {
    const d = res[plot.key];
    if (!d || !d.length) { parts.push(plot.key + '=LEER'); fails++; continue; }
    if (d.some(p => !isFinite(p.value) || p.time == null)) { parts.push(plot.key + '=NaN!'); fails++; continue; }
    let sorted = true;
    for (let i = 1; i < d.length; i++) if (d[i].time <= d[i - 1].time) { sorted = false; break; }
    if (!sorted) { parts.push(plot.key + '=ZEIT-UNSORTIERT'); fails++; continue; }
    parts.push(plot.key + '=' + d.length + 'pts last=' + d[d.length - 1].value.toFixed(4));
  }
  console.log((def.pane === 'separate' ? '[Pane]   ' : '[Overlay]') + ' ' +
    def.short.padEnd(7) + (def.legend ? def.legend(inputs) : def.name).padEnd(26) + parts.join(' | '));
}

// Gegenprobe EMA(21)
const closes = candles.map(c => +c.close);
const emaRef = (() => {
  const k = 2 / 22; let s = 0;
  for (let i = 0; i < 21; i++) s += closes[i]; s /= 21;
  for (let i = 21; i < closes.length; i++) s = closes[i] * k + s * (1 - k);
  return s;
})();
const emaOut = Reg.compute(Reg.get('ema'), candles, { length: 21, source: 'close' }, t => t).line;
const diff = Math.abs(emaOut[emaOut.length - 1].value - emaRef);
console.log('\nEMA(21) Gegenprobe: engine=' + emaOut[emaOut.length - 1].value.toFixed(6) +
  ' ref=' + emaRef.toFixed(6) + ' diff=' + diff.toExponential(2) + (diff < 1e-9 ? ' OK' : ' FEHLER'));
if (diff >= 1e-9) fails++;

// RSI Wertebereich
const rsi = Reg.compute(Reg.get('rsi'), candles, Reg.defaults(Reg.get('rsi')), t => t).line;
const rsiOk = rsi.every(p => p.value >= 0 && p.value <= 100);
console.log('RSI 0-100:', rsiOk ? 'OK' : 'FEHLER', '| letzter RSI =', rsi[rsi.length - 1].value.toFixed(2));
if (!rsiOk) fails++;

// Bollinger: upper > basis > lower
const bb = Reg.compute(Reg.get('bb'), candles, Reg.defaults(Reg.get('bb')), t => t);
const bbOk = bb.upper.every((u, i) => u.value >= bb.basis[i].value && bb.basis[i].value >= bb.lower[i].value);
console.log('BB Ordnung upper>=basis>=lower:', bbOk ? 'OK' : 'FEHLER');
if (!bbOk) fails++;

// Fehlerhaftes Modul darf Engine nicht killen
Reg.register({ id: '__broken', name: 'Broken', calc() { throw new Error('boom'); } });
const safe = Reg.compute(Reg.get('__broken'), candles, {}, t => t);
console.log('Defektes Modul abgefangen:', JSON.stringify(safe) === '{}' ? 'OK' : 'FEHLER');

console.log('\n' + (fails === 0 ? 'ALLE TESTS BESTANDEN' : fails + ' FEHLER'));
process.exit(fails === 0 ? 0 : 1);
