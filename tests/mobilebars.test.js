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
// Das Marktdaten-Sheet ist entfallen: Kennzahlen stehen dauerhaft in der
// Bottom-Bar, der Exchange-Umschalter oben links in der Topbar.

// ── Mobil: alles in den Sheets? ──
chk('7 Timeframes im TF-Sheet', tfHost.querySelectorAll('.tf-btn').length === 7);
chk('7 Werkzeuge im Tools-Sheet', toolsHost.querySelectorAll('.chart-type-btn').length === 7);
// Weder Kennzahlen noch Exchange-Umschalter wandern ins Sheet.
chk('Exchange-Umschalter bleibt in der Topbar',
  d.querySelector('.topbar').contains(d.getElementById('exchangeSwitch')));
chk('Marktdaten-Sheet existiert nicht mehr',
  d.getElementById('mStatsModal') === null);
chk('Bottom-Bar TFs sind leer', d.querySelectorAll('#bbTfs .tf-btn').length === 0);
chk('Kennzahlen bleiben in der Bottom-Bar',
  d.querySelectorAll('#bottomBar .stat').length === 7,
  String(d.querySelectorAll('#bottomBar .stat').length));
chk('Indikator-Button im Sheet', !!toolsHost.querySelector('#indBrowserBtn'));
chk('Liq-Heat-Button im Sheet', !!toolsHost.querySelector('#lhToggle'));
chk('Aktiv-Button im Sheet', !!toolsHost.querySelector('#indManageBtn'));

// ── Keine doppelten IDs (der Kernfehler beim Kopieren statt Verschieben) ──
const ids = [...d.querySelectorAll('[id]')].map(e => e.id);
const dupes = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
chk('keine doppelten IDs' + (dupes.length ? ' (' + dupes + ')' : ''), dupes.length === 0);

// ── Handler ueberleben den Umzug ──
tfHost.querySelector('[data-tf="1h"]').click();
chk('TF-Klick im Sheet feuert Handler', clicks.includes('tf:1h'));
// Der Exchange-Umschalter bleibt oben links in der Topbar stehen.
d.getElementById('exchangeSwitch').querySelector('[data-ex="bybit"]').click();
chk('Exchange-Klick in der Topbar feuert Handler', clicks.includes('ex:bybit'));
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
// Backdrop-Verhalten am verbleibenden TF-Sheet pruefen.
d.getElementById('mTfModal').classList.add('open');
d.getElementById('mTfBackdrop').click();
chk('Sheet schliesst per Backdrop', !d.getElementById('mTfModal').classList.contains('open'));

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
// Preis/Aenderung werden nicht mehr als Trigger gespiegelt — sie stehen
// dauerhaft in der Bottom-Bar und werden dort direkt aktualisiert.
chk('kein Preis-Trigger mehr im Markup', d.getElementById('mStatsBtn') === null);
chk('Kurs steht stattdessen in der Bottom-Bar',
  d.getElementById('bottomBar').contains(d.getElementById('tPrice')));

// ── CSS-Vertrag der Sheets ────────────────────────────────────────────────
// Regressionsschutz: die Sheets wurden anfangs mit den .ind-modal-Klassen des
// Indikator-Panels gebaut. Jene schalten ueber style.display, nicht ueber
// .open — die Sheets blieben deshalb dauerhaft display:none und mit ihnen
// ALLE hineinverschobenen Kennzahlen und Timeframes. Das sah aus, als wuerden
// die Daten nicht laden. Diese Pruefungen halten den Vertrag fest.
const css = html.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const cssHas = re => re.test(css);

chk('Sheets nutzen eigene Klasse .m-sheet (nicht .ind-modal)',
  [...d.querySelectorAll('#mToolsModal, #mTfModal')]
    .every(e => e.classList.contains('m-sheet') && !e.classList.contains('ind-modal')));
chk('Backdrops nutzen .m-sheet-backdrop (nicht .ind-backdrop)',
  [...d.querySelectorAll('#mToolsBackdrop, #mTfBackdrop')]
    .every(e => e.classList.contains('m-sheet-backdrop') && !e.classList.contains('ind-backdrop')));
chk('CSS definiert .m-sheet.open mit display', cssHas(/\.m-sheet\.open\s*\{[^}]*display:\s*flex/));
chk('CSS definiert .m-sheet-backdrop.open mit display', cssHas(/\.m-sheet-backdrop\.open\s*\{[^}]*display:\s*block/));
chk('CSS definiert .m-sheet Grundzustand display:none', cssHas(/\.m-sheet\s*\{[^}]*display:\s*none/));

// Die Hosts duerfen NICHT in einem per style.display gesteuerten Container
// haengen — sonst waeren die verschobenen Elemente unerreichbar.
chk('Hosts liegen in .m-sheet-Containern',
  ['mToolsHost', 'mTfHost']
    .every(id => d.getElementById(id).closest('.m-sheet')));

// ── Datenfluss: Kennzahlen bleiben per ID erreichbar, auch im Sheet ───────
// updateTicker() adressiert ueber getElementById. Waeren die Knoten beim
// Verschieben verloren gegangen oder dupliziert, liefe die Kursanzeige leer.
chk('Kennzahl-IDs nach Umzug erreichbar',
  ['tPrice', 'tChange', 'tHigh', 'tLow', 'tVol', 'tOi', 'tFunding']
    .every(id => !!d.getElementById(id)));
chk('Kennzahl-Knoten liegen in der Bottom-Bar',
  ['tPrice', 'tOi'].every(id => d.getElementById('bottomBar').contains(d.getElementById(id))));
d.getElementById('tPrice').textContent = '43210';
chk('Kennzahl beschreibbar', d.getElementById('tPrice').textContent === '43210');

// ── Rotation zu Desktop: alles zurueck an seinen Platz ──
MOBILE = false;
listeners.forEach(fn => fn());
chk('Desktop: Timeframes zurueck in die Bottom-Bar', d.querySelectorAll('#bbTfs .tf-btn').length === 7);
chk('Desktop: Werkzeuge zurueck in chart-tools', d.querySelectorAll('#chartTools .chart-type-btn').length === 7);
chk('Desktop: Kennzahlen weiterhin in der Bottom-Bar', d.querySelectorAll('#bottomBar .stat').length === 7);
chk('Desktop: Exchange zurueck in Topbar', !!d.querySelector('.topbar > #exchangeSwitch'));
chk('Desktop: Sheets leer', tfHost.children.length === 0 && toolsHost.children.length === 0);
chk('Desktop: TF-Reihenfolge korrekt',
  [...d.querySelectorAll('#bbTfs .tf-btn')].map(b => b.dataset.tf).join(',') === '1m,3m,5m,15m,1h,4h,1d');
chk('Desktop: Bottom-Bar mit Kennzahlen, Symbol, TF-Trigger und TFs',
  [...d.getElementById('bottomBar').children].map(e => e.id).join(',')
    === 'tickerStats,symbolBox,mTfBtn,bbTfs',
  [...d.getElementById('bottomBar').children].map(e => e.id).join(','));
chk('Desktop: Symbol-Box sitzt unten, nicht in der Topbar',
  !d.querySelector('.topbar #symbolBox'));

clicks.length = 0;
d.querySelector('#bbTfs [data-tf="1d"]').click();
chk('Desktop: TF-Handler weiterhin aktiv', clicks.includes('tf:1d'));
d.querySelector('.topbar [data-ex="binance"]').click();
chk('Desktop: Exchange-Handler weiterhin aktiv', clicks.includes('ex:binance'));

// ── Zurueck zu Mobil (Rotation hin und her) ──
MOBILE = true;
listeners.forEach(fn => fn());
chk('Rotation zurueck: wieder 7 TFs im Sheet', tfHost.querySelectorAll('.tf-btn').length === 7);
chk('Rotation zurueck: wieder 7 Werkzeuge im Sheet', toolsHost.querySelectorAll('.chart-type-btn').length === 7);
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
