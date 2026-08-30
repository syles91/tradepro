/* ══════════════════════════════════════════════════════════════════════════
 *  TradePro — Modular Indicator Engine (core)
 *
 *  Ein Indikator ist eine eigenständige JS-Datei, die sich per
 *  TradePro.Indicators.register({...}) selbst registriert. Neue Indikatoren
 *  werden einfach nach static/indicators/custom/ gelegt — der Server listet
 *  sie unter /api/indicators/modules, das Terminal lädt sie automatisch.
 *
 *  Definition-Schema:
 *  {
 *    id:       'ema',                       // eindeutig
 *    name:     'Moving Average Exponential',
 *    short:    'EMA',                       // Kürzel für Legende
 *    category: 'Trend',                     // Gruppierung im Panel
 *    pane:     'main' | 'separate',         // Overlay oder eigenes Pane
 *    precision: 2,                          // optional (separate pane)
 *    inputs: [
 *      { key:'length', label:'Länge', type:'number', default:9, min:1, max:1000 },
 *      { key:'source', label:'Quelle', type:'select', default:'close',
 *        options:[['close','Close'],['open','Open']] },
 *      { key:'color',  label:'Farbe', type:'color', default:'#f7c948' },
 *      { key:'on',     label:'Anzeigen', type:'bool', default:true }
 *    ],
 *    plots: [
 *      { key:'line', type:'line'|'histogram'|'area'|'band', label:'EMA',
 *        color:'#f7c948', lineWidth:2, colorFrom:'color' }   // colorFrom = Input-Key
 *    ],
 *    calc(ctx) { return { line: [{time, value}, ...] }; }
 *  }
 *
 *  ctx = { candles, open[], high[], low[], close[], volume[], time[],
 *          inputs, math, toLocalTime }
 * ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  // ── Mathe-Bibliothek für Indikator-Autoren ────────────────────────────────
  const math = {
    sma(src, len) {
      const out = new Array(src.length).fill(null);
      if (len <= 0) return out;
      let sum = 0;
      for (let i = 0; i < src.length; i++) {
        sum += src[i];
        if (i >= len) sum -= src[i - len];
        if (i >= len - 1) out[i] = sum / len;
      }
      return out;
    },
    ema(src, len) {
      const out = new Array(src.length).fill(null);
      if (!src.length || len <= 0) return out;
      const k = 2 / (len + 1);
      let seed = 0;
      const n = Math.min(len, src.length);
      for (let i = 0; i < n; i++) seed += src[i];
      seed /= n;
      out[n - 1] = seed;
      for (let i = n; i < src.length; i++) out[i] = src[i] * k + out[i - 1] * (1 - k);
      return out;
    },
    rma(src, len) {
      const out = new Array(src.length).fill(null);
      if (src.length < len || len <= 0) return out;
      let sum = 0;
      for (let i = 0; i < len; i++) sum += src[i];
      out[len - 1] = sum / len;
      for (let i = len; i < src.length; i++) out[i] = (out[i - 1] * (len - 1) + src[i]) / len;
      return out;
    },
    wma(src, len) {
      const out = new Array(src.length).fill(null);
      const denom = (len * (len + 1)) / 2;
      for (let i = len - 1; i < src.length; i++) {
        let acc = 0;
        for (let j = 0; j < len; j++) acc += src[i - j] * (len - j);
        out[i] = acc / denom;
      }
      return out;
    },
    stdev(src, len) {
      const out = new Array(src.length).fill(null);
      const mean = math.sma(src, len);
      for (let i = len - 1; i < src.length; i++) {
        let acc = 0;
        for (let j = 0; j < len; j++) { const d = src[i - j] - mean[i]; acc += d * d; }
        out[i] = Math.sqrt(acc / len);
      }
      return out;
    },
    highest(src, len) {
      const out = new Array(src.length).fill(null);
      for (let i = len - 1; i < src.length; i++) {
        let m = -Infinity;
        for (let j = 0; j < len; j++) m = Math.max(m, src[i - j]);
        out[i] = m;
      }
      return out;
    },
    lowest(src, len) {
      const out = new Array(src.length).fill(null);
      for (let i = len - 1; i < src.length; i++) {
        let m = Infinity;
        for (let j = 0; j < len; j++) m = Math.min(m, src[i - j]);
        out[i] = m;
      }
      return out;
    },
    trueRange(high, low, close) {
      const out = new Array(high.length).fill(null);
      for (let i = 1; i < high.length; i++) {
        out[i] = Math.max(high[i] - low[i],
                          Math.abs(high[i] - close[i - 1]),
                          Math.abs(low[i] - close[i - 1]));
      }
      out[0] = high[0] - low[0];
      return out;
    },
    /** Serie [{time,value}] aus einem Werte-Array bauen (null wird verworfen). */
    toSeries(times, values, toLocalTime) {
      const out = [];
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v == null || !isFinite(v)) continue;
        out.push({ time: toLocalTime ? toLocalTime(times[i]) : times[i], value: v });
      }
      return out;
    },
  };

  // ── Registry ──────────────────────────────────────────────────────────────
  const defs = new Map();       // id -> definition
  const listeners = [];

  function register(def) {
    if (!def || !def.id) { console.warn('[Indicators] Definition ohne id ignoriert', def); return; }
    if (typeof def.calc !== 'function') { console.warn('[Indicators] calc() fehlt:', def.id); return; }
    def.short = def.short || def.id.toUpperCase();
    def.name = def.name || def.short;
    def.category = def.category || 'Sonstige';
    def.pane = def.pane === 'separate' ? 'separate' : 'main';
    def.inputs = def.inputs || [];
    def.plots = def.plots || [{ key: 'line', type: 'line', label: def.short }];
    defs.set(def.id, def);
    listeners.forEach(fn => { try { fn(def); } catch (e) {} });
    return def;
  }

  function get(id) { return defs.get(id); }
  function all() { return Array.from(defs.values()); }
  function onRegister(fn) { listeners.push(fn); }

  function defaults(def) {
    const o = {};
    (def.inputs || []).forEach(i => { o[i.key] = i.default; });
    return o;
  }

  /** Indikator berechnen — kapselt Fehler, damit ein defektes Modul das
   *  Terminal nicht lahmlegt. */
  function compute(def, candles, inputs, toLocalTime) {
    if (!candles || !candles.length) return {};
    const ctx = {
      candles,
      time: candles.map(c => c.time),
      open: candles.map(c => +c.open),
      high: candles.map(c => +c.high),
      low: candles.map(c => +c.low),
      close: candles.map(c => +c.close),
      volume: candles.map(c => +(c.volume || 0)),
      inputs: inputs || {},
      math,
      toLocalTime: toLocalTime || (t => t),
    };
    ctx.source = key => ({
      close: ctx.close, open: ctx.open, high: ctx.high, low: ctx.low,
      hl2: ctx.high.map((h, i) => (h + ctx.low[i]) / 2),
      hlc3: ctx.high.map((h, i) => (h + ctx.low[i] + ctx.close[i]) / 3),
      ohlc4: ctx.high.map((h, i) => (ctx.open[i] + h + ctx.low[i] + ctx.close[i]) / 4),
    }[key] || ctx.close);
    try {
      return def.calc(ctx) || {};
    } catch (e) {
      console.error('[Indicators] calc-Fehler in "' + def.id + '"', e);
      return {};
    }
  }

  /** Lädt Indikator-Module dynamisch nach (Reihenfolge egal). */
  async function loadModules(urls) {
    const results = await Promise.all(urls.map(url => new Promise(resolve => {
      const s = document.createElement('script');
      s.src = url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now();
      s.async = false;
      s.onload = () => resolve({ url, ok: true });
      s.onerror = () => { console.error('[Indicators] Modul nicht ladbar:', url); resolve({ url, ok: false }); };
      document.head.appendChild(s);
    })));
    return results;
  }

  global.TradePro = global.TradePro || {};
  global.TradePro.Indicators = { register, get, all, defaults, compute, loadModules, onRegister, math };
})(window);
