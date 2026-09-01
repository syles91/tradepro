/* ══════════════════════════════════════════════════════════════════════════
 *  TradePro — Indicator Panel Runtime
 *
 *  Verwaltet aktive Indikator-Instanzen: Rendering auf dem Haupt-Chart
 *  (Overlays) bzw. in eigenen Panes darunter, Legende mit Einstellungs-/
 *  Sichtbarkeits-/Lösch-Buttons, Einstellungs-Dialog und Persistenz.
 *
 *  Erwartet einen Kontext via TradePro.attachIndicatorPanel({...}).
 * ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const LS_KEY = 'tradepro.indicators.v1';
  // Lazy: core.js wird u. U. NACH panel.js geladen (Server-Discovery ist async),
  // deshalb die Registry erst bei Benutzung auflösen.
  const Reg = new Proxy({}, {
    get: (_, k) => {
      const r = (global.TradePro || {}).Indicators;
      if (!r) throw new Error('[IndicatorPanel] core.js nicht geladen');
      const v = r[k];
      return typeof v === 'function' ? v.bind(r) : v;
    },
  });

  let ctx = null;              // { chart, mainChart, getCandles, toLocalTime, chartOpts, panesEl, mainLegendEl }
  let instances = [];          // aktive Instanzen
  let seq = 1;

  // ── Persistenz ────────────────────────────────────────────────────────────
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(
        instances.map(i => ({ defId: i.defId, inputs: i.inputs, visible: i.visible }))
      ));
    } catch (e) {}
  }
  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
    catch (e) { return []; }
  }

  // ── Pane-Handling ─────────────────────────────────────────────────────────
  function createPane(inst) {
    const wrap = document.createElement('div');
    wrap.className = 'ind-pane';
    wrap.innerHTML = '<div class="ind-pane-chart"></div><div class="ind-legend"></div>';
    ctx.panesEl.appendChild(wrap);

    const host = wrap.querySelector('.ind-pane-chart');
    const chart = LightweightCharts.createChart(host, Object.assign({}, ctx.chartOpts, {
      rightPriceScale: { borderColor: '#232838', scaleMargins: { top: 0.15, bottom: 0.12 } },
      timeScale: { borderColor: '#232838', timeVisible: true, secondsVisible: false, visible: false },
      handleScroll: false, handleScale: false,
      crosshair: ctx.chartOpts.crosshair,
    }));
    inst.paneEl = wrap;
    inst.paneChart = chart;
    inst.legendEl = wrap.querySelector('.ind-legend');
    syncPane(inst);
    resizeAll();
  }

  function syncPane(inst) {
    const r = ctx.chart.timeScale().getVisibleRange();
    if (r) { try { inst.paneChart.timeScale().setVisibleRange(r); } catch (e) {} }
  }

  function destroySeries(inst) {
    (inst.series || []).forEach(s => {
      try { (inst.paneChart || ctx.chart).removeSeries(s); } catch (e) {}
    });
    inst.series = [];
  }

  function removeInstance(id) {
    const idx = instances.findIndex(i => i.id === id);
    if (idx < 0) return;
    const inst = instances[idx];
    destroySeries(inst);
    if (inst.paneChart) { try { inst.paneChart.remove(); } catch (e) {} }
    if (inst.paneEl) inst.paneEl.remove();
    instances.splice(idx, 1);
    save(); renderLegends(); resizeAll();
  }

  // ── Series-Erzeugung ──────────────────────────────────────────────────────
  function makeSeries(target, plot, inst) {
    const color = plot.colorFrom ? (inst.inputs[plot.colorFrom] || plot.color) : (plot.color || '#5b8def');
    const lw = plot.widthFrom ? (+inst.inputs[plot.widthFrom] || plot.lineWidth || 2) : (plot.lineWidth || 2);
    const common = {
      priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: plot.type === 'line',
    };
    if (plot.type === 'histogram') {
      return target.addHistogramSeries(Object.assign({ color }, common));
    }
    if (plot.type === 'area') {
      return target.addAreaSeries(Object.assign({
        lineColor: color, topColor: color + '55', bottomColor: color + '05', lineWidth: lw,
      }, common));
    }
    // line + colored-line
    return target.addLineSeries(Object.assign({
      color, lineWidth: lw, lineStyle: plot.lineStyle || 0,
    }, common));
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function renderInstance(inst) {
    const def = Reg.get(inst.defId);
    if (!def) return;
    const candles = ctx.getCandles();
    destroySeries(inst);
    if (!inst.visible || !candles.length) { renderLegends(); return; }

    if (def.pane === 'separate' && !inst.paneChart) createPane(inst);
    const target = def.pane === 'separate' ? inst.paneChart : ctx.chart;
    if (!target) return;

    const result = Reg.compute(def, candles, inst.inputs, ctx.toLocalTime);
    inst.lastValues = {};

    def.plots.forEach(plot => {
      const data = result[plot.key];
      if (!data || !data.length) return;
      const s = makeSeries(target, plot, inst);
      if (def.pane === 'separate' && def.precision != null) {
        s.applyOptions({ priceFormat: { type: 'price', precision: def.precision, minMove: Math.pow(10, -def.precision) } });
      }
      s.setData(data);
      inst.series.push(s);
      const last = data[data.length - 1];
      if (last && !plot.noLegend) inst.lastValues[plot.key] = last.value;
    });

    if (def.pane === 'separate') syncPane(inst);
    renderLegends();
  }

  function renderAll() {
    instances.forEach(renderInstance);
  }

  // ── Legenden ──────────────────────────────────────────────────────────────
  function legendRow(inst) {
    const def = Reg.get(inst.defId);
    const compact = window.innerWidth <= 420;
    // Auf sehr schmalen Screens nur das Kürzel + erster Wert, sonst wird die
    // Legende breiter als der Chart.
    const title = compact ? def.short : (def.legend ? def.legend(inst.inputs) : def.short);
    let keys = Object.keys(inst.lastValues || {});
    if (compact) keys = keys.slice(0, 1);
    const vals = keys.map(k => {
      const v = inst.lastValues[k];
      return '<span class="ind-val">' + (Math.abs(v) >= 1000 ? v.toFixed(1) : v.toFixed(def.precision != null ? def.precision : 2)) + '</span>';
    }).join('');
    return '<div class="ind-legend-row' + (inst.visible ? '' : ' off') + '" data-inst="' + inst.id + '">' +
      '<span class="ind-name">' + title + '</span>' + vals +
      '<span class="ind-actions">' +
        '<button class="ind-ic" data-act="toggle" title="Ein/Aus">' + (inst.visible ? '👁' : '🚫') + '</button>' +
        '<button class="ind-ic" data-act="settings" title="Einstellungen">⚙</button>' +
        '<button class="ind-ic" data-act="remove" title="Entfernen">✕</button>' +
      '</span></div>';
  }

  function bindLegend(el) {
    el.querySelectorAll('.ind-ic').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const id = +btn.closest('.ind-legend-row').dataset.inst;
        const inst = instances.find(i => i.id === id);
        if (!inst) return;
        const act = btn.dataset.act;
        if (act === 'remove') removeInstance(id);
        else if (act === 'toggle') { inst.visible = !inst.visible; save(); renderInstance(inst); }
        else if (act === 'settings') openSettings(inst);
      };
    });
    // Touch: die Inline-Buttons sind per CSS ausgeblendet — ein Tap auf die
    // Zeile öffnet stattdessen das Verwaltungs-Sheet.
    el.querySelectorAll('.ind-legend-row').forEach(row => {
      row.onclick = e => {
        if (!isTouchLayout()) return;
        e.stopPropagation();
        openManage();
      };
    });
  }

  function renderLegends() {
    const main = instances.filter(i => (Reg.get(i.defId) || {}).pane !== 'separate');
    ctx.mainLegendEl.innerHTML = main.map(legendRow).join('');
    bindLegend(ctx.mainLegendEl);
    instances.forEach(inst => {
      if (inst.legendEl) { inst.legendEl.innerHTML = legendRow(inst); bindLegend(inst.legendEl); }
    });
    renderManage();
    updateManageBtn();
  }

  // ── Verwaltungs-Sheet (primäre Bedienung auf Touch) ───────────────────────
  /** Touch-/Schmal-Layout: dieselben Breakpoints wie im CSS
   *  (max-width 820px sowie Handy-Querformat). */
  function isTouchLayout() {
    return window.matchMedia(
      '(max-width: 820px), (orientation: landscape) and (max-height: 520px) and (max-width: 920px)'
    ).matches;
  }

  function updateManageBtn() {
    const btn = document.getElementById('indManageBtn');
    if (!btn) return;
    const n = instances.length;
    btn.classList.toggle('empty', n === 0);
    const badge = btn.querySelector('.ind-count');
    if (badge) badge.textContent = String(n);
  }

  function manageRow(inst) {
    const def = Reg.get(inst.defId) || {};
    const sub = def.legend ? def.legend(inst.inputs) : (def.short || '');
    const tag = def.pane === 'separate' ? 'Pane' : 'Overlay';
    return '<div class="ind-manage-row' + (inst.visible ? '' : ' off') + '" data-inst="' + inst.id + '">' +
      '<div class="ind-manage-main">' +
        '<div class="ind-manage-name">' + (def.name || def.short || inst.defId) + '</div>' +
        '<div class="ind-manage-sub">' + sub + ' · ' + tag + '</div>' +
      '</div>' +
      '<div class="ind-manage-acts">' +
        '<button data-act="toggle" aria-label="Ein/Aus">' + (inst.visible ? '👁' : '🚫') + '</button>' +
        '<button data-act="settings" aria-label="Einstellungen">⚙</button>' +
        '<button data-act="remove" aria-label="Entfernen">✕</button>' +
      '</div></div>';
  }

  function renderManage() {
    const el = document.getElementById('indManageList');
    if (!el) return;
    if (!instances.length) {
      el.innerHTML = '<div class="ind-manage-empty">Noch keine Indikatoren aktiv.</div>';
      return;
    }
    el.innerHTML = instances.map(manageRow).join('');
    el.querySelectorAll('.ind-manage-acts button').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const id = +btn.closest('.ind-manage-row').dataset.inst;
        const inst = instances.find(i => i.id === id);
        if (!inst) return;
        const act = btn.dataset.act;
        if (act === 'remove') removeInstance(id);
        else if (act === 'toggle') { inst.visible = !inst.visible; save(); renderInstance(inst); }
        else if (act === 'settings') { closeManage(); openSettings(inst); }
      };
    });
  }

  function openManage() {
    renderManage(); updateManageBtn();
    document.getElementById('indManageBackdrop').style.display = 'block';
    document.getElementById('indManageModal').style.display = 'flex';
  }
  function closeManage() {
    document.getElementById('indManageBackdrop').style.display = 'none';
    document.getElementById('indManageModal').style.display = 'none';
  }

  // ── Einstellungs-Dialog ───────────────────────────────────────────────────
  function openSettings(inst) {
    const def = Reg.get(inst.defId);
    const body = def.inputs.map(inp => {
      const val = inst.inputs[inp.key];
      let field;
      if (inp.type === 'select') {
        field = '<select data-key="' + inp.key + '">' +
          inp.options.map(o => '<option value="' + o[0] + '"' + (o[0] === val ? ' selected' : '') + '>' + o[1] + '</option>').join('') +
          '</select>';
      } else if (inp.type === 'color') {
        field = '<input type="color" data-key="' + inp.key + '" value="' + val + '">';
      } else if (inp.type === 'bool') {
        field = '<input type="checkbox" data-key="' + inp.key + '"' + (val ? ' checked' : '') + '>';
      } else {
        field = '<input type="number" data-key="' + inp.key + '" value="' + val + '"' +
          (inp.min != null ? ' min="' + inp.min + '"' : '') +
          (inp.max != null ? ' max="' + inp.max + '"' : '') +
          (inp.step != null ? ' step="' + inp.step + '"' : '') + '>';
      }
      return '<label class="ind-field"><span>' + inp.label + '</span>' + field + '</label>';
    }).join('');

    const modal = document.getElementById('indSettingsModal');
    modal.querySelector('.ind-modal-title').textContent = def.name;
    modal.querySelector('.ind-modal-body').innerHTML = body || '<div class="muted">Keine Einstellungen.</div>';
    modal.dataset.inst = inst.id;
    document.getElementById('indSettingsBackdrop').style.display = 'block';
    modal.style.display = 'flex';
  }

  function closeSettings() {
    document.getElementById('indSettingsBackdrop').style.display = 'none';
    document.getElementById('indSettingsModal').style.display = 'none';
  }

  function applySettings() {
    const modal = document.getElementById('indSettingsModal');
    const inst = instances.find(i => i.id === +modal.dataset.inst);
    if (!inst) return closeSettings();
    modal.querySelectorAll('[data-key]').forEach(el => {
      const k = el.dataset.key;
      inst.inputs[k] = el.type === 'checkbox' ? el.checked
                     : el.type === 'number' ? parseFloat(el.value)
                     : el.value;
    });
    save(); renderInstance(inst); closeSettings();
  }

  // ── Indikator-Browser ─────────────────────────────────────────────────────
  function addIndicator(defId) {
    const def = Reg.get(defId);
    if (!def) return;
    const inst = { id: seq++, defId, inputs: Reg.defaults(def), visible: true, series: [], lastValues: {} };
    instances.push(inst);
    save(); renderInstance(inst);
    return inst;
  }

  function renderBrowser(filter) {
    const q = (filter || '').toLowerCase().trim();
    const list = Reg.all().filter(d =>
      !q || d.name.toLowerCase().includes(q) || d.short.toLowerCase().includes(q) || d.category.toLowerCase().includes(q));
    const cats = {};
    list.forEach(d => { (cats[d.category] = cats[d.category] || []).push(d); });
    const el = document.getElementById('indBrowserList');
    if (!list.length) { el.innerHTML = '<div class="muted" style="padding:14px">Kein Indikator gefunden.</div>'; return; }
    el.innerHTML = Object.keys(cats).sort().map(cat =>
      '<div class="ind-cat">' + cat + '</div>' +
      cats[cat].map(d =>
        '<div class="ind-item" data-def="' + d.id + '">' +
          '<span class="ind-item-name">' + d.name + '</span>' +
          '<span class="ind-item-tag">' + (d.pane === 'separate' ? 'Pane' : 'Overlay') + '</span>' +
        '</div>').join('')
    ).join('');
    el.querySelectorAll('.ind-item').forEach(it => {
      it.onclick = () => { addIndicator(it.dataset.def); closeBrowser(); };
    });
  }

  function openBrowser() {
    document.getElementById('indBrowserBackdrop').style.display = 'block';
    document.getElementById('indBrowserModal').style.display = 'flex';
    const s = document.getElementById('indSearch');
    s.value = ''; renderBrowser('');
    setTimeout(() => s.focus(), 60);
  }
  function closeBrowser() {
    document.getElementById('indBrowserBackdrop').style.display = 'none';
    document.getElementById('indBrowserModal').style.display = 'none';
  }

  // ── Resize / Sync ─────────────────────────────────────────────────────────
  /** Verteilt die verfügbare Höhe auf die Panes. Auf schmalen/kurzen Screens
   *  darf die Summe der Panes den Hauptchart nicht auffressen — daher wird
   *  ab 2 Panes proportional heruntergerechnet (mit sinnvollem Minimum). */
  function applyPaneHeights() {
    const panes = instances.filter(i => i.paneEl);
    if (!panes.length) return;
    const mobile = window.innerWidth <= 820;
    const shortScreen = window.innerHeight <= 520;
    const base = shortScreen ? 74 : mobile ? (window.innerWidth <= 420 ? 92 : 104) : 130;
    const min = shortScreen ? 56 : mobile ? 60 : 84;

    // Der Hauptchart muss nutzbar bleiben. Statt blind einen Prozentsatz der
    // Viewporthöhe zu verteilen, rechnen wir vom tatsächlich freien Platz aus:
    // Viewport minus bereits belegte Chrome-Elemente (Topbar, TF-Leiste,
    // Subchart samt Tabs, Mobile-Nav) minus reservierte Mindest-Charthöhe.
    const chrome = Array.from(document.querySelectorAll(
        '.topbar, .tf-bar, .subchart-wrap.show, .subchart-tabs, .mobile-nav'))
      .reduce((sum, el) => sum + (el.offsetParent === null ? 0 : el.getBoundingClientRect().height), 0);
    const minChart = shortScreen ? 150 : mobile ? 210 : 260;
    const free = window.innerHeight - chrome - minChart;
    const budget = Math.max(min * panes.length * 0.6, Math.min(
      free, window.innerHeight * (shortScreen ? 0.34 : mobile ? 0.42 : 0.46)));

    const h = Math.max(min, Math.min(base, Math.floor(budget / panes.length)));
    panes.forEach(inst => { inst.paneEl.style.height = h + 'px'; });
  }

  function resizeAll() {
    applyPaneHeights();
    instances.forEach(inst => {
      if (!inst.paneChart || !inst.paneEl) return;
      const host = inst.paneEl.querySelector('.ind-pane-chart');
      if (host.clientWidth) inst.paneChart.resize(host.clientWidth, host.clientHeight);
    });
  }

  function syncAllPanes(range) {
    instances.forEach(inst => {
      if (!inst.paneChart) return;
      try { inst.paneChart.timeScale().setVisibleRange(range); } catch (e) {}
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function attach(context) {
    ctx = context;

    ctx.chart.timeScale().subscribeVisibleTimeRangeChange(r => { if (r) syncAllPanes(r); });

    // Bei Resize/Rotation: Panes neu vermessen und Legenden neu rendern, da
    // deren Kompakt-Darstellung von der Viewport-Breite abhängt.
    let lastCompact = window.innerWidth <= 420;
    window.addEventListener('resize', () => {
      resizeAll();
      const nowCompact = window.innerWidth <= 420;
      if (nowCompact !== lastCompact) { lastCompact = nowCompact; renderLegends(); }
    });
    window.addEventListener('orientationchange', () => setTimeout(() => { resizeAll(); renderLegends(); }, 250));

    document.getElementById('indBrowserBtn').onclick = openBrowser;
    const manageBtn = document.getElementById('indManageBtn');
    if (manageBtn) manageBtn.onclick = openManage;
    const manageBackdrop = document.getElementById('indManageBackdrop');
    if (manageBackdrop) manageBackdrop.onclick = closeManage;
    const manageClose = document.getElementById('indManageClose');
    if (manageClose) manageClose.onclick = closeManage;
    const manageAdd = document.getElementById('indManageAdd');
    if (manageAdd) manageAdd.onclick = () => { closeManage(); openBrowser(); };
    document.getElementById('indBrowserBackdrop').onclick = closeBrowser;
    document.getElementById('indBrowserClose').onclick = closeBrowser;
    document.getElementById('indSearch').addEventListener('input', e => renderBrowser(e.target.value));
    document.getElementById('indSettingsBackdrop').onclick = closeSettings;
    document.getElementById('indSettingsCancel').onclick = closeSettings;
    document.getElementById('indSettingsCancelBtn').onclick = closeSettings;
    document.getElementById('indSettingsApply').onclick = applySettings;
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeBrowser(); closeSettings(); closeManage(); }
    });

    // gespeicherte Indikatoren wiederherstellen
    loadSaved().forEach(saved => {
      const def = Reg.get(saved.defId);
      if (!def) return;
      instances.push({
        id: seq++, defId: saved.defId,
        inputs: Object.assign(Reg.defaults(def), saved.inputs || {}),
        visible: saved.visible !== false, series: [], lastValues: {},
      });
    });
    renderAll();
    renderManage();
    updateManageBtn();
  }

  /** Inputs einer Instanz programmatisch setzen (rendert + persistiert). */
  function updateInputs(id, patchObj) {
    const inst = instances.find(i => i.id === id);
    if (!inst) return null;
    Object.assign(inst.inputs, patchObj || {});
    save(); renderInstance(inst);
    return inst;
  }

  /** Sichtbarkeit einer Instanz setzen (rendert + persistiert). */
  function setVisible(id, on) {
    const inst = instances.find(i => i.id === id);
    if (!inst) return null;
    inst.visible = !!on;
    save(); renderInstance(inst);
    return inst;
  }

  global.TradePro = global.TradePro || {};
  global.TradePro.IndicatorPanel = {
    attach, renderAll, resizeAll, addIndicator, removeInstance, updateInputs, setVisible,
    openManage, closeManage,
    get instances() { return instances; },
  };
})(window);
