/* RSI — Relative Strength Index (eigenes Pane, 0–100) */
TradePro.Indicators.register({
  id: 'rsi',
  name: 'Relative Strength Index',
  short: 'RSI',
  category: 'Oszillatoren',
  pane: 'separate',
  precision: 2,
  inputs: [
    { key: 'length', label: 'Länge', type: 'number', default: 14, min: 1, max: 500 },
    { key: 'color', label: 'Farbe', type: 'color', default: '#b39ddb' },
    { key: 'ob', label: 'Overbought', type: 'number', default: 70, min: 50, max: 100 },
    { key: 'os', label: 'Oversold', type: 'number', default: 30, min: 0, max: 50 },
  ],
  plots: [
    { key: 'line', type: 'line', label: 'RSI', colorFrom: 'color', lineWidth: 2 },
    { key: 'ob', type: 'line', label: 'OB', color: '#ef5350', lineWidth: 1, lineStyle: 2, noLegend: true },
    { key: 'os', type: 'line', label: 'OS', color: '#26a69a', lineWidth: 1, lineStyle: 2, noLegend: true },
  ],
  legend: i => 'RSI ' + i.length,
  calc(ctx) {
    const len = +ctx.inputs.length;
    const gains = [0], losses = [0];
    for (let i = 1; i < ctx.close.length; i++) {
      const ch = ctx.close[i] - ctx.close[i - 1];
      gains.push(Math.max(ch, 0));
      losses.push(Math.max(-ch, 0));
    }
    const ag = ctx.math.rma(gains, len), al = ctx.math.rma(losses, len);
    const rsi = ag.map((g, i) => {
      if (g == null || al[i] == null) return null;
      if (al[i] === 0) return 100;
      return 100 - 100 / (1 + g / al[i]);
    });
    const line = ctx.math.toSeries(ctx.time, rsi, ctx.toLocalTime);
    const bound = v => line.length ? [{ time: line[0].time, value: v }, { time: line[line.length - 1].time, value: v }] : [];
    return { line, ob: bound(+ctx.inputs.ob), os: bound(+ctx.inputs.os) };
  },
});

/* MACD (eigenes Pane, Linie + Signal + Histogramm) */
TradePro.Indicators.register({
  id: 'macd',
  name: 'MACD',
  short: 'MACD',
  category: 'Oszillatoren',
  pane: 'separate',
  precision: 4,
  inputs: [
    { key: 'fast', label: 'Fast', type: 'number', default: 12, min: 1, max: 200 },
    { key: 'slow', label: 'Slow', type: 'number', default: 26, min: 1, max: 400 },
    { key: 'signal', label: 'Signal', type: 'number', default: 9, min: 1, max: 200 },
    { key: 'macdColor', label: 'MACD', type: 'color', default: '#2962ff' },
    { key: 'sigColor', label: 'Signal', type: 'color', default: '#ff9800' },
  ],
  plots: [
    { key: 'hist', type: 'histogram', label: 'Hist' },
    { key: 'macd', type: 'line', label: 'MACD', colorFrom: 'macdColor', lineWidth: 2 },
    { key: 'signal', type: 'line', label: 'Signal', colorFrom: 'sigColor', lineWidth: 2 },
  ],
  legend: i => 'MACD ' + i.fast + ', ' + i.slow + ', ' + i.signal,
  calc(ctx) {
    const ef = ctx.math.ema(ctx.close, +ctx.inputs.fast);
    const es = ctx.math.ema(ctx.close, +ctx.inputs.slow);
    const macd = ef.map((v, i) => (v == null || es[i] == null) ? null : v - es[i]);
    const valid = macd.map(v => v == null ? 0 : v);
    const sig = ctx.math.ema(valid, +ctx.inputs.signal).map((v, i) => macd[i] == null ? null : v);
    const hist = macd.map((v, i) => (v == null || sig[i] == null) ? null : v - sig[i]);
    const histSeries = [];
    for (let i = 0; i < hist.length; i++) {
      if (hist[i] == null) continue;
      const rising = i > 0 && hist[i - 1] != null ? hist[i] >= hist[i - 1] : true;
      histSeries.push({
        time: ctx.toLocalTime(ctx.time[i]), value: hist[i],
        color: hist[i] >= 0 ? (rising ? '#26a69a' : 'rgba(38,166,154,.45)')
                            : (rising ? 'rgba(239,83,80,.45)' : '#ef5350'),
      });
    }
    return {
      macd: ctx.math.toSeries(ctx.time, macd, ctx.toLocalTime),
      signal: ctx.math.toSeries(ctx.time, sig, ctx.toLocalTime),
      hist: histSeries,
    };
  },
});

/* Stochastic (eigenes Pane) */
TradePro.Indicators.register({
  id: 'stoch',
  name: 'Stochastic',
  short: 'STOCH',
  category: 'Oszillatoren',
  pane: 'separate',
  precision: 2,
  inputs: [
    { key: 'k', label: '%K Länge', type: 'number', default: 14, min: 1, max: 200 },
    { key: 'smooth', label: '%K Glättung', type: 'number', default: 3, min: 1, max: 50 },
    { key: 'd', label: '%D Länge', type: 'number', default: 3, min: 1, max: 50 },
  ],
  plots: [
    { key: 'k', type: 'line', label: '%K', color: '#2962ff', lineWidth: 2 },
    { key: 'd', type: 'line', label: '%D', color: '#ff9800', lineWidth: 2 },
    { key: 'ob', type: 'line', label: 'OB', color: '#ef5350', lineWidth: 1, lineStyle: 2, noLegend: true },
    { key: 'os', type: 'line', label: 'OS', color: '#26a69a', lineWidth: 1, lineStyle: 2, noLegend: true },
  ],
  legend: i => 'Stoch ' + i.k + ', ' + i.smooth + ', ' + i.d,
  calc(ctx) {
    const hh = ctx.math.highest(ctx.high, +ctx.inputs.k);
    const ll = ctx.math.lowest(ctx.low, +ctx.inputs.k);
    const raw = ctx.close.map((c, i) => {
      if (hh[i] == null || ll[i] == null || hh[i] === ll[i]) return null;
      return 100 * (c - ll[i]) / (hh[i] - ll[i]);
    });
    const kArr = ctx.math.sma(raw.map(v => v == null ? 0 : v), +ctx.inputs.smooth).map((v, i) => raw[i] == null ? null : v);
    const dArr = ctx.math.sma(kArr.map(v => v == null ? 0 : v), +ctx.inputs.d).map((v, i) => kArr[i] == null ? null : v);
    const k = ctx.math.toSeries(ctx.time, kArr, ctx.toLocalTime);
    const bound = v => k.length ? [{ time: k[0].time, value: v }, { time: k[k.length - 1].time, value: v }] : [];
    return { k, d: ctx.math.toSeries(ctx.time, dArr, ctx.toLocalTime), ob: bound(80), os: bound(20) };
  },
});
