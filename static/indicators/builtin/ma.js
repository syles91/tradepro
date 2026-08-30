/* EMA — Exponential Moving Average (Overlay) */
TradePro.Indicators.register({
  id: 'ema',
  name: 'Moving Average Exponential',
  short: 'EMA',
  category: 'Trend',
  pane: 'main',
  inputs: [
    { key: 'length', label: 'Länge', type: 'number', default: 21, min: 1, max: 1000 },
    { key: 'source', label: 'Quelle', type: 'select', default: 'close',
      options: [['close','Close'],['open','Open'],['high','High'],['low','Low'],['hl2','HL2'],['hlc3','HLC3'],['ohlc4','OHLC4']] },
    { key: 'color', label: 'Farbe', type: 'color', default: '#f7c948' },
    { key: 'lineWidth', label: 'Breite', type: 'number', default: 2, min: 1, max: 5 },
  ],
  plots: [{ key: 'line', type: 'line', label: 'EMA', colorFrom: 'color', widthFrom: 'lineWidth' }],
  legend: i => 'EMA ' + i.length,
  calc(ctx) {
    const src = ctx.source(ctx.inputs.source);
    return { line: ctx.math.toSeries(ctx.time, ctx.math.ema(src, +ctx.inputs.length), ctx.toLocalTime) };
  },
});

/* SMA — Simple Moving Average (Overlay) */
TradePro.Indicators.register({
  id: 'sma',
  name: 'Moving Average Simple',
  short: 'SMA',
  category: 'Trend',
  pane: 'main',
  inputs: [
    { key: 'length', label: 'Länge', type: 'number', default: 50, min: 1, max: 1000 },
    { key: 'source', label: 'Quelle', type: 'select', default: 'close',
      options: [['close','Close'],['open','Open'],['hl2','HL2'],['hlc3','HLC3'],['ohlc4','OHLC4']] },
    { key: 'color', label: 'Farbe', type: 'color', default: '#5b8def' },
    { key: 'lineWidth', label: 'Breite', type: 'number', default: 2, min: 1, max: 5 },
  ],
  plots: [{ key: 'line', type: 'line', label: 'SMA', colorFrom: 'color', widthFrom: 'lineWidth' }],
  legend: i => 'SMA ' + i.length,
  calc(ctx) {
    const src = ctx.source(ctx.inputs.source);
    return { line: ctx.math.toSeries(ctx.time, ctx.math.sma(src, +ctx.inputs.length), ctx.toLocalTime) };
  },
});

/* VWAP — Volume Weighted Average Price (Session-basiert, täglich) */
TradePro.Indicators.register({
  id: 'vwap',
  name: 'VWAP (Session)',
  short: 'VWAP',
  category: 'Trend',
  pane: 'main',
  inputs: [
    { key: 'color', label: 'Farbe', type: 'color', default: '#ff9800' },
    { key: 'lineWidth', label: 'Breite', type: 'number', default: 2, min: 1, max: 5 },
  ],
  plots: [{ key: 'line', type: 'line', label: 'VWAP', colorFrom: 'color', widthFrom: 'lineWidth' }],
  legend: () => 'VWAP',
  calc(ctx) {
    const out = new Array(ctx.close.length).fill(null);
    let pv = 0, vol = 0, day = null;
    for (let i = 0; i < ctx.close.length; i++) {
      const d = Math.floor(ctx.time[i] / 86400);
      if (d !== day) { day = d; pv = 0; vol = 0; }
      const tp = (ctx.high[i] + ctx.low[i] + ctx.close[i]) / 3;
      pv += tp * ctx.volume[i];
      vol += ctx.volume[i];
      out[i] = vol > 0 ? pv / vol : null;
    }
    return { line: ctx.math.toSeries(ctx.time, out, ctx.toLocalTime) };
  },
});
