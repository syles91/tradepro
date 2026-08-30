/* Momentum — simple Drop-in-Demo für den Import-Workflow.
 * Datei liegt in static/indicators/custom/ und wurde ohne Neustart
 * vom /api/indicators/modules-Endpoint automatisch erkannt.
 */
TradePro.Indicators.register({
  id: 'momentum',
  name: 'Momentum',
  short: 'MOM',
  category: 'Oszillatoren',
  pane: 'separate',
  precision: 2,
  inputs: [
    { key: 'length', label: 'Länge', type: 'number', default: 10, min: 1, max: 500 },
    { key: 'color', label: 'Farbe', type: 'color', default: '#2ebd9e' },
  ],
  plots: [
    { key: 'line', type: 'line', label: 'MOM', colorFrom: 'color', lineWidth: 2 },
    { key: 'zero', type: 'line', label: '0', color: '#787b86', lineWidth: 1, lineStyle: 2, noLegend: true },
  ],
  legend: i => 'Momentum ' + i.length,
  calc(ctx) {
    const len = +ctx.inputs.length;
    const out = ctx.close.map((c, i) => i < len ? null : c - ctx.close[i - len]);
    const line = ctx.math.toSeries(ctx.time, out, ctx.toLocalTime);
    return {
      line,
      zero: line.length ? [{ time: line[0].time, value: 0 }, { time: line[line.length - 1].time, value: 0 }] : [],
    };
  },
});
