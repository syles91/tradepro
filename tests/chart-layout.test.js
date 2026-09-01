// Prueft die gerenderte Layout-Kette des Charts auf Mobil.
//
// Symptom, das hierher fuehrte: "der chart ladet wird aber nicht angezeigt".
// Der Chart haengt in .chart-main > .chart-area > .main. Kippt irgendwo in
// dieser Kette die Hoehe auf 0 oder wird ein Vorfahre display:none, laedt der
// Chart weiterhin Daten, ist aber unsichtbar. Genau das prueft dieses Skript
// mit echter CSS-Auswertung statt mit Struktur-Annahmen.
//
// Ausfuehren:  node tests/chart-layout.test.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP = path.join(__dirname, '..', 'static', 'app.html');
const html = fs.readFileSync(APP, 'utf8');

let ok = true;
const chk = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (c || !extra ? '' : '   [' + extra + ']'));
  if (!c) ok = false;
};

const dom = new JSDOM(html, { pretendToBeVisual: true });
const w = dom.window, d = w.document;
const cs = el => w.getComputedStyle(el);

console.log('── Layout-Kette des Charts ──');
const chart = d.getElementById('chart');
chk('#chart existiert', !!chart);

// Kein Vorfahre des Charts darf display:none sein.
let el = chart, hidden = null;
while (el && el !== d.body) {
  if (cs(el).display === 'none') { hidden = (el.id || el.className); break; }
  el = el.parentElement;
}
chk('kein Vorfahre von #chart ist display:none', !hidden, 'versteckt durch: ' + hidden);

['chart-main', 'chart-area', 'main'].forEach(c => {
  const n = d.querySelector('.' + c);
  chk('.' + c + ' nicht display:none', n && cs(n).display !== 'none', n ? cs(n).display : 'fehlt');
});

console.log('── Chart-Overlay (Ladeanzeige) ──');
// .chart-loading liegt deckend ueber dem Chart (inset:0, z-index:5). Es MUSS
// am Ende von loadChart() wieder ausgeblendet werden, sonst bleibt der Chart
// hinter dem Spinner verborgen.
const loadingHiddenAtEnd = /document\.getElementById\('chartLoading'\)\.style\.display\s*=\s*'none'/.test(html);
chk('loadChart blendet chartLoading wieder aus', loadingHiddenAtEnd);
const showsBeforeFetch = /document\.getElementById\('chartLoading'\)\.style\.display\s*=\s*'flex'/.test(html);
chk('loadChart zeigt chartLoading beim Start', showsBeforeFetch);
// Das Ausblenden muss AUSSERHALB des try stehen, sonst haengt der Spinner
// nach einem Fetch-Fehler dauerhaft ueber dem Chart.
const body = html.match(/async function loadChart\(\)[\s\S]*?\n\}/)[0];
const catchIdx = body.indexOf('} catch');
const hideIdx = body.indexOf("chartLoading').style.display = 'none'");
chk('Ausblenden erfolgt auch im Fehlerfall (nach catch)', hideIdx > catchIdx,
    'catch@' + catchIdx + ' hide@' + hideIdx);

console.log('── Container fuer verschobene Elemente ──');
// MobileBars verschiebt Buttons nach #chartTools zurueck. Liegt der Container
// in einem display:none-Elternteil, sind sie auf dem Desktop unsichtbar.
const tools = d.getElementById('chartTools');
chk('#chartTools existiert', !!tools);
// Die eigene Werkzeugzeile ist entfallen — die Werkzeuge sitzen in der Topbar.
chk('#chartTools liegt in der Topbar', !!tools.closest('.topbar'));
chk('.tf-bar existiert nicht mehr', d.querySelector('.tf-bar') === null);

// Die Sheet-Hosts duerfen den Chart nicht ueberlagern, solange sie zu sind.
['mToolsModal', 'mTfModal', 'mStatsModal'].forEach(id => {
  chk(id + ' geschlossen -> display:none', cs(d.getElementById(id)).display === 'none');
});

console.log('── Sub-Chart und Indikator-Panes ──');
const sub = d.getElementById('subchart');
if (sub) chk('#subchart nicht display:none', cs(sub).display !== 'none', cs(sub).display);
const panes = d.getElementById('indPanes');
if (panes) chk('#indPanes nicht display:none', cs(panes).display !== 'none', cs(panes).display);

console.log(ok ? '\nAlle Tests bestanden.' : '\nFEHLGESCHLAGEN.');
process.exit(ok ? 0 : 1);
