// Testet die MobileBars-Umzugslogik im echten DOM (jsdom).
//
// Kernrisiko dieser Loesung: die Buttons werden zwischen Topbar und
// Bottom-Sheets VERSCHOBEN. Geht dabei ein Handler verloren oder entstehen
// doppelte IDs, ist die Mobil-UI still kaputt. Genau das pruefen wir hier.
//
// Ausfuehren:  node tests/mobilebars.test.js
// Benoetigt jsdom (siehe tests/README.md).

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP = path.join(__dirname, '..', 'static', 'app.html');
const html = fs.readFileSync(APP, 'utf8');

let ok = true;
const chk = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + n); if (!c) ok = false; };

// Viewport steuerbar machen: matchMedia liefert, was wir vorgeben.
let MOBILE = true;
const listeners = [];

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window, d = w.document;
w.matchMedia = () => ({
  get matches() { return MOBILE; },
  addEventListener: (_, fn) => listeners.push(fn),
  addListener: fn => listeners.push(fn),
});

// Minimal-Stubs fuer alles, was MobileBars anfasst.
w.State = { tf: '5m' };
w.fmt = { price: v => String(v), pct: v => v + '%' };
w.resizeCharts = () => {};

const clicks = [];
w.__clicks = clicks;

// Nur den MobileBars-Block aus app.html extrahieren.
const m = html.match(/const MobileBars = \(\(\) => \{[\s\S]*?\n\}\)\(\);/);
if (!m) { console.error('FAIL: MobileBars-Block nicht gefunden'); process.exit(1); }

w.eval(`
  ${m[0]}
  window.MobileBars = MobileBars;
  // Handler wie in app.html registrieren — VOR init(), das ist die
  // entscheidende Reihenfolge.
  document.querySelectorAll('.tf-btn').forEach(b => b.onclick = () => window.__clicks.push('tf:'+b.dataset.tf));
  document.querySelectorAll('.ex-btn').forEach(b => b.onclick = () => window.__clicks.push('ex:'+b.dataset.ex));
  document.getElementById('vpToggle').onclick = () => window.__clicks.push('vp');
  MobileBars.init();
`);

const tfHost = d.getElementById('mTfHost');
const toolsHost = d.getElementById('mToolsHost');
const statsHost = d.getElementById('mStatsHost');

// ── Mobil: alles in den Sheets? ──
chk('7 Timeframes im TF-Sheet', tfHost.querySelectorAll('.tf-btn').length === 7);
chk('6 Werkzeuge im Tools-Sheet', toolsHost.querySelectorAll('.chart-type-btn').length === 6);
chk('7 Kennzahlen im Stats-Sheet', statsHost.querySelectorAll('.stat').length === 7);
chk('Exchange-Switch im Stats-Sheet', !!statsHost.querySelector('#exchangeSwitch'));
chk('tf-bar ist leer', d.querySelectorAll('.tf-bar .tf-btn').length === 0);
chk('ticker-stats ist leer', d.querySelectorAll('.ticker-stats .stat').length === 0);
chk('Indikator-Button im Sheet', !!toolsHost.querySelector('#indBrowserBtn'));
chk('Aktiv-Button im Sheet', !!toolsHost.querySelector('#indManageBtn'));

// ── Keine doppelten IDs (der Kernfehler beim Kopieren statt Verschieben) ──
const ids = [...d.querySelectorAll('[id]')].map(e => e.id);
const dupes = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
chk('keine doppelten IDs' + (dupes.length ? ' (' + dupes + ')' : ''), dupes.length === 0);

// ── Handler ueberleben den Umzug ──
tfHost.querySelector('[data-tf="1h"]').click();
chk('TF-Klick im Sheet feuert Handler', clicks.includes('tf:1h'));
statsHost.querySelector('[data-ex="bybit"]').click();
chk('Exchange-Klick im Sheet feuert Handler', clicks.includes('ex:bybit'));
toolsHost.querySelector('#vpToggle').click();
chk('Werkzeug-Klick im Sheet feuert Handler', clicks.includes('vp'));

// ── Sheets oeffnen/schliessen ──
d.getElementById('mTfBtn').click();
chk('TF-Sheet oeffnet', d.getElementById('mTfModal').classList.contains('open'));
d.getElementById('mToolsBtn').click();
chk('Tools-Sheet oeffnet', d.getElementById('mToolsModal').classList.contains('open'));
chk('TF-Sheet schliesst dabei (nie zwei offen)', !d.getElementById('mTfModal').classList.contains('open'));
d.getElementById('mToolsClose').click();
chk('Tools-Sheet schliesst per X', !d.getElementById('mToolsModal').classList.contains('open'));
d.getElementById('mStatsBtn').click();
d.getElementById('mStatsBackdrop').click();
chk('Stats-Sheet schliesst per Backdrop', !d.getElementById('mStatsModal').classList.contains('open'));

d.getElementById('mTfBtn').click();
tfHost.querySelector('[data-tf="4h"]').click();
chk('TF-Auswahl schliesst das Sheet', !d.getElementById('mTfModal').classList.contains('open'));

d.getElementById('mToolsBtn').click();
toolsHost.querySelector('#vpToggle').click();
chk('Werkzeug-Auswahl schliesst das Sheet', !d.getElementById('mToolsModal').classList.contains('open'));

// ── Trigger-Labels ──
w.State.tf = '15m';
w.MobileBars.updateTriggers();
chk('TF-Trigger zeigt aktuellen Timeframe', d.getElementById('mTfBtnLabel').textContent === '15m');
w.MobileBars.updateTriggers({ price: 42000, change: -1.5 });
chk('Preis-Trigger aktualisiert', d.getElementById('mStatsBtnPrice').textContent === '42000');
chk('Aenderung rot bei Minus', d.getElementById('mStatsBtnChg').className.includes('red'));
w.MobileBars.updateTriggers({ price: 43000, change: 2.1 });
chk('Aenderung gruen bei Plus', d.getElementById('mStatsBtnChg').className.includes('green'));

// ── Rotation zu Desktop: alles zurueck an seinen Platz ──
MOBILE = false;
listeners.forEach(fn => fn());
chk('Desktop: Timeframes zurueck in tf-bar', d.querySelectorAll('.tf-bar .tf-btn').length === 7);
chk('Desktop: Werkzeuge zurueck in chart-tools', d.querySelectorAll('#chartTools .chart-type-btn').length === 6);
chk('Desktop: Kennzahlen zurueck in ticker-stats', d.querySelectorAll('.ticker-stats .stat').length === 7);
chk('Desktop: Exchange zurueck in Topbar', !!d.querySelector('.topbar > #exchangeSwitch'));
chk('Desktop: Sheets leer', tfHost.children.length === 0 && statsHost.children.length === 0 && toolsHost.children.length === 0);
chk('Desktop: TF-Reihenfolge korrekt',
  [...d.querySelectorAll('.tf-bar .tf-btn')].map(b => b.dataset.tf).join(',') === '1m,3m,5m,15m,1h,4h,1d');
chk('Desktop: Divider steht nach den TFs',
  [...d.querySelector('.tf-bar').children].findIndex(e => e.classList.contains('tf-divider')) === 7);
chk('Desktop: Exchange steht vor der Symbol-Box',
  d.querySelector('#exchangeSwitch').compareDocumentPosition(d.querySelector('#symbolBox')) & 4);

clicks.length = 0;
d.querySelector('.tf-bar [data-tf="1d"]').click();
chk('Desktop: TF-Handler weiterhin aktiv', clicks.includes('tf:1d'));
d.querySelector('.topbar [data-ex="binance"]').click();
chk('Desktop: Exchange-Handler weiterhin aktiv', clicks.includes('ex:binance'));

// ── Zurueck zu Mobil (Rotation hin und her) ──
MOBILE = true;
listeners.forEach(fn => fn());
chk('Rotation zurueck: wieder 7 TFs im Sheet', tfHost.querySelectorAll('.tf-btn').length === 7);
chk('Rotation zurueck: wieder 6 Werkzeuge im Sheet', toolsHost.querySelectorAll('.chart-type-btn').length === 6);
chk('Rotation zurueck: keine doppelten IDs',
  (() => { const a = [...d.querySelectorAll('[id]')].map(e => e.id); return a.length === new Set(a).size; })());
clicks.length = 0;
tfHost.querySelector('[data-tf="3m"]').click();
chk('Rotation zurueck: Handler intakt', clicks.includes('tf:3m'));

// Mehrfaches syncLayout darf nichts verdoppeln (Idempotenz).
w.MobileBars.syncLayout();
w.MobileBars.syncLayout();
chk('syncLayout ist idempotent', tfHost.querySelectorAll('.tf-btn').length === 7);

console.log(ok ? '\nAlle Tests bestanden.' : '\nFEHLGESCHLAGEN.');
process.exit(ok ? 0 : 1);
