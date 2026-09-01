// Wertet die Mobil-CSS-Regeln (max-width: 820px) wirklich aus.
//
// jsdom ignoriert Media Queries beim Rendern. Trick: wir ziehen die
// @media-Bloecke aus dem CSS und injizieren ihren Inhalt als normale Regeln.
// Danach entspricht getComputedStyle dem, was ein 390px-Handy sieht.
//
// Ausfuehren:  node tests/mobile-render.test.js

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

// Balancierte @media-Bloecke extrahieren (verschachtelte {} korrekt zaehlen).
function extractMedia(css, predicate) {
  const out = [];
  const re = /@media([^{]+)\{/g;
  let m;
  while ((m = re.exec(css))) {
    let i = re.lastIndex, depth = 1;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    if (predicate(m[1])) out.push(css.slice(re.lastIndex, i - 1));
  }
  return out;
}

const css = html.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];

// Alles, was bei 390px Breite greift: max-width >= 390 (und 420er-Breakpoint).
const applies = q => {
  const mw = /max-width:\s*(\d+)px/.exec(q);
  if (!mw) return false;
  if (/min-width:\s*(\d+)px/.test(q)) {
    const mn = +/min-width:\s*(\d+)px/.exec(q)[1];
    if (390 < mn) return false;
  }
  if (/orientation:\s*landscape/.test(q)) return false;
  return 390 <= +mw[1];
};

const mobileCss = extractMedia(css, applies).join('\n');
console.log('Mobile-Regeln injiziert: ' + mobileCss.length + ' Zeichen\n');

const dom = new JSDOM(html, { pretendToBeVisual: true });
const w = dom.window, d = w.document;
const style = d.createElement('style');
style.textContent = mobileCss;
d.head.appendChild(style);
const cs = el => w.getComputedStyle(el);

console.log('── Sichtbarkeitskette des Charts bei 390px ──');
const chart = d.getElementById('chart');
let el = chart, hidden = null;
while (el && el !== d.body) {
  if (cs(el).display === 'none') { hidden = (el.id || el.className || el.tagName); break; }
  el = el.parentElement;
}
chk('kein Vorfahre von #chart ist display:none', !hidden, 'versteckt durch: ' + hidden);

['chart-main', 'chart-area', 'main'].forEach(c => {
  const n = d.querySelector('.' + c);
  chk('.' + c + ' sichtbar', n && cs(n).display !== 'none', n ? cs(n).display : 'fehlt');
});

console.log('── Hoehenkette: darf nirgends auf 0 kollabieren ──');
// .main ist flex:1 unter body (flex column). .chart-area flex:1 darin,
// .chart-main flex:1 darin. Entscheidend ist, dass min-height:0 gesetzt ist
// UND keine feste Hoehe 0 dazwischenkommt.
const main = d.querySelector('.main');
const area = d.querySelector('.chart-area');
const cmain = d.querySelector('.chart-main');
chk('.main hat flex-grow', cs(main).flexGrow === '1', 'flex-grow=' + cs(main).flexGrow);
chk('.chart-area hat flex-grow', cs(area).flexGrow === '1', 'flex-grow=' + cs(area).flexGrow);
chk('.chart-main hat flex-grow', cs(cmain).flexGrow === '1', 'flex-grow=' + cs(cmain).flexGrow);
chk('.chart-main hoehe nicht fix 0', cs(cmain).height !== '0px', 'height=' + cs(cmain).height);
chk('#chart position absolute', cs(chart).position === 'absolute', cs(chart).position);

console.log('── Kopfleiste: wirklich nur EINE Zeile? ──');
chk('.ticker-stats sichtbar (steht jetzt in der Bottom-Bar)',
  cs(d.querySelector('.ticker-stats')).display !== 'none');
chk('.bottom-bar sichtbar', cs(d.getElementById('bottomBar')).display !== 'none');
chk('.ticker-stats liegt NICHT mehr in der Topbar',
  !d.querySelector('.topbar').contains(d.querySelector('.ticker-stats')));
chk('.tf-bar ausgeblendet', cs(d.querySelector('.tf-bar')).display === 'none');
chk('.topbar sichtbar', cs(d.querySelector('.topbar')).display !== 'none');
// Der Preis-Trigger entfaellt bewusst — der Kurs steht dauerhaft unten.
chk('Preis-Trigger existiert nicht mehr', d.getElementById('mStatsBtn') === null);
chk('uebrige Trigger sichtbar',
  ['mTfBtn', 'mToolsBtn'].every(id => cs(d.getElementById(id)).display !== 'none'));

console.log('── KRITISCH: #chartTools liegt in der versteckten .tf-bar ──');
const tools = d.getElementById('chartTools');
const toolsHidden = cs(tools).display === 'none' || cs(tools.closest('.tf-bar')).display === 'none';
console.log('   #chartTools effektiv versteckt: ' + toolsHidden);
console.log('   -> auf Mobil OK, solange MobileBars die Buttons ins Sheet verschiebt');

console.log('── Sheets geschlossen: duerfen Chart nicht ueberlagern ──');
['mToolsModal', 'mTfModal', 'mStatsModal'].forEach(id => {
  chk(id + ' -> display:none', cs(d.getElementById(id)).display === 'none', cs(d.getElementById(id)).display);
});

console.log('── Sub-Chart / Panes ──');
const subw = d.querySelector('.subchart-wrap');
// Der Sub-Chart ist standardmaessig AUS und damit bewusst eingeklappt.
if (subw) chk('.subchart-wrap startet eingeklappt', !subw.classList.contains('show'));
const panes = d.getElementById('indPanes');
if (panes) chk('#indPanes sichtbar', cs(panes).display !== 'none', cs(panes).display);

console.log(ok ? '\nAlle Tests bestanden.' : '\nFEHLGESCHLAGEN.');
process.exit(ok ? 0 : 1);
