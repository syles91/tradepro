/* ══════════════════════════════════════════════════════════════════════════
 *  BEISPIEL für eigene Indikatoren.
 *  Datei nach static/indicators/custom/ legen → wird beim Laden automatisch
 *  erkannt (kein Code-Änderung nötig).
 * ══════════════════════════════════════════════════════════════════════════ */

/* Donchian Channel (Overlay) */
TradePro.Indicators.register({
  id: 'donchian',
  name: 'Donchian Channel',
  short: 'DC',
  category: 'Volatilität',
  pane: 'main',
  inputs: [
    { key: 'length', label: 'Länge', type: 'number', default: 20, min: 2, max: 500 },
    { key: 'color', label: 'Farbe', type: 'color', default: '#2ebd9e' },
  ],
  plots: [
    { key: 'upper', type: 'line', label: 'Upper', colorFrom: 'color', lineWidth: 1 },
    { key: 'lower', type: 'line', label: 'Lower', colorFrom: 'color', lineWidth: 1 },
    { key: 'mid', type: 'line', label: 'Mid', colorFrom: 'color', lineWidth: 1, lineStyle: 2 },
  ],
  legend: i => 'Donchian ' + i.length,
  calc(ctx) {
    const len = +ctx.inputs.length;
    const hh = ctx.math.highest(ctx.high, len);
    const ll = ctx.math.lowest(ctx.low, len);
    const mid = hh.map((h, i) => (h == null || ll[i] == null) ? null : (h + ll[i]) / 2);
    return {
      upper: ctx.math.toSeries(ctx.time, hh, ctx.toLocalTime),
      lower: ctx.math.toSeries(ctx.time, ll, ctx.toLocalTime),
      mid: ctx.math.toSeries(ctx.time, mid, ctx.toLocalTime),
    };
  },
});
