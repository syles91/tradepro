/* Bollinger Bands (Overlay, 3 Plots) */
TradePro.Indicators.register({
  id: 'bb',
  name: 'Bollinger Bands',
  short: 'BB',
  category: 'Volatilität',
  pane: 'main',
  inputs: [
    { key: 'length', label: 'Länge', type: 'number', default: 20, min: 2, max: 500 },
    { key: 'mult', label: 'StdDev', type: 'number', default: 2, min: 0.1, max: 10, step: 0.1 },
    { key: 'color', label: 'Bänder', type: 'color', default: '#5b8def' },
    { key: 'basisColor', label: 'Mittellinie', type: 'color', default: '#ff9800' },
  ],
  plots: [
    { key: 'upper', type: 'line', label: 'Upper', colorFrom: 'color', lineWidth: 1 },
    { key: 'basis', type: 'line', label: 'Basis', colorFrom: 'basisColor', lineWidth: 1, lineStyle: 2 },
    { key: 'lower', type: 'line', label: 'Lower', colorFrom: 'color', lineWidth: 1 },
  ],
  legend: i => 'BB ' + i.length + ', ' + i.mult,
  calc(ctx) {
    const len = +ctx.inputs.length, mult = +ctx.inputs.mult;
    const basis = ctx.math.sma(ctx.close, len);
    const dev = ctx.math.stdev(ctx.close, len);
    const up = basis.map((b, i) => (b == null || dev[i] == null) ? null : b + mult * dev[i]);
    const lo = basis.map((b, i) => (b == null || dev[i] == null) ? null : b - mult * dev[i]);
    return {
      upper: ctx.math.toSeries(ctx.time, up, ctx.toLocalTime),
      basis: ctx.math.toSeries(ctx.time, basis, ctx.toLocalTime),
      lower: ctx.math.toSeries(ctx.time, lo, ctx.toLocalTime),
    };
  },
});

/* ATR — Average True Range (eigenes Pane) */
TradePro.Indicators.register({
  id: 'atr',
  name: 'Average True Range',
  short: 'ATR',
  category: 'Volatilität',
  pane: 'separate',
  precision: 4,
  inputs: [
    { key: 'length', label: 'Länge', type: 'number', default: 14, min: 1, max: 500 },
    { key: 'color', label: 'Farbe', type: 'color', default: '#b39ddb' },
  ],
  plots: [{ key: 'line', type: 'line', label: 'ATR', colorFrom: 'color', lineWidth: 2 }],
  legend: i => 'ATR ' + i.length,
  calc(ctx) {
    const tr = ctx.math.trueRange(ctx.high, ctx.low, ctx.close);
    return { line: ctx.math.toSeries(ctx.time, ctx.math.rma(tr, +ctx.inputs.length), ctx.toLocalTime) };
  },
});

/* SuperTrend (Overlay) */
TradePro.Indicators.register({
  id: 'supertrend',
  name: 'SuperTrend',
  short: 'ST',
  category: 'Trend',
  pane: 'main',
  inputs: [
    { key: 'length', label: 'ATR Länge', type: 'number', default: 10, min: 1, max: 200 },
    { key: 'mult', label: 'Faktor', type: 'number', default: 3, min: 0.5, max: 20, step: 0.1 },
    { key: 'upColor', label: 'Bullish', type: 'color', default: '#26a69a' },
    { key: 'dnColor', label: 'Bearish', type: 'color', default: '#ef5350' },
  ],
  plots: [{ key: 'line', type: 'colored-line', label: 'SuperTrend', lineWidth: 2 }],
  legend: i => 'SuperTrend ' + i.length + ', ' + i.mult,
  calc(ctx) {
    const len = +ctx.inputs.length, mult = +ctx.inputs.mult;
    const atr = ctx.math.rma(ctx.math.trueRange(ctx.high, ctx.low, ctx.close), len);
    const out = [];
    let upper = null, lower = null, trend = 1;
    for (let i = 0; i < ctx.close.length; i++) {
      if (atr[i] == null) continue;
      const mid = (ctx.high[i] + ctx.low[i]) / 2;
      let ub = mid + mult * atr[i];
      let lb = mid - mult * atr[i];
      if (upper != null && (ub < upper || ctx.close[i - 1] > upper)) upper = ub; else if (upper == null) upper = ub; 
      if (lower != null && (lb > lower || ctx.close[i - 1] < lower)) lower = lb; else if (lower == null) lower = lb;
      if (ctx.close[i] > upper) trend = 1;
      else if (ctx.close[i] < lower) trend = -1;
      const value = trend === 1 ? lower : upper;
      out.push({
        time: ctx.toLocalTime(ctx.time[i]), value,
        color: trend === 1 ? ctx.inputs.upColor : ctx.inputs.dnColor,
      });
    }
    return { line: out };
  },
});
