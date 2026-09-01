// Prueft die Ausfuehrungsreihenfolge beim Parsen — nicht nur das Endergebnis.
//
// DER FEHLER, DER HIERHER FUEHRTE:
// MobileBars.init() stand bei Zeile 2283, das Sheet-Markup aber erst ab 2597.
// Browser fuehren Inline-Skripte WAEHREND des Parsens aus, also existierten
// die Sheets noch nicht. $('mToolsBtn').onclick warf TypeError, was den
// gesamten restlichen Skriptblock abbrach — samt init(), reloadAll() und
// resizeCharts(). Der Chart wurde erstellt, bekam aber nie Groesse und Daten:
// "der chart ladet wird aber nicht angezeigt".
//
// Warum die anderen Tests das nicht fanden: sie fuehren die Skriptbloecke
// NACH dem vollstaendigen Parsen aus, wenn alles Markup laengst da ist.
// Dieser Test simuliert echtes Streaming-Parsing.
//
// Ausfuehren:  node tests/script-order.test.js

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
const lineOf = idx => html.slice(0, idx).split('\n').length;

console.log('── Dokument-Reihenfolge: Zugriff vor Markup? ──');

// Alle IDs einsammeln, die im Markup definiert werden, mit ihrer Position.
const markupPos = {};
for (const m of html.matchAll(/id="([\w-]+)"/g)) {
  if (!(m[1] in markupPos)) markupPos[m[1]] = m.index;
}

// Top-Level-Aufrufe, die beim Parsen sofort laufen (nicht in Funktionen).
// Wir pruefen die bekannten Einstiegspunkte.
const entryCalls = ['MobileBars.init();', 'init();'];
entryCalls.forEach(call => {
  const idx = html.lastIndexOf('\n' + call);
  if (idx < 0) { console.log('   (' + call + ' nicht als Top-Level gefunden)'); return; }
  console.log('   ' + call + ' @ Zeile ' + lineOf(idx));
});

// Kernpruefung: die Sheet-Elemente muessen VOR jedem Top-Level-Aufruf stehen,
// der sie anfasst.
const sheetIds = ['mToolsBtn', 'mTfBtn', 'mStatsBtn', 'mToolsModal', 'mTfModal',
                  'mStatsModal', 'mToolsHost', 'mTfHost', 'mStatsHost',
                  'mToolsBackdrop', 'mTfBackdrop', 'mStatsBackdrop'];

const initCallIdx = html.lastIndexOf('\ninit();');
const appInitLine = lineOf(initCallIdx);
console.log('   App-init() @ Zeile ' + appInitLine + '\n');

// Der App-Start muss an DOMContentLoaded gebunden sein, wenn Markup nach dem
// Skriptblock folgt. Nur dann ist die Reihenfolge unkritisch.
const deferred = /document\.readyState === 'loading'[\s\S]{0,200}?addEventListener\('DOMContentLoaded', init/.test(html);
chk('App-init() ist an DOMContentLoaded gebunden', deferred);

sheetIds.forEach(id => {
  const pos = markupPos[id];
  chk(id + ' im Markup vorhanden', pos !== undefined);
  if (pos !== undefined && !deferred) {
    chk(id + ' steht vor dem init()-Aufruf', pos < initCallIdx,
        'Markup@' + lineOf(pos) + ' init@' + appInitLine);
  }
});

console.log('── MobileBars.init() darf nicht vor dem Markup stehen ──');
// Es darf KEINEN Top-Level-Aufruf von MobileBars.init() geben, der vor dem
// Sheet-Markup liegt. Innerhalb von Funktionen ist er unkritisch.
const firstSheetMarkup = Math.min(...sheetIds.map(i => markupPos[i]).filter(v => v !== undefined));
const topLevelInits = [...html.matchAll(/^MobileBars\.init\(\);/gm)].map(m => m.index);
const badInits = topLevelInits.filter(i => i < firstSheetMarkup);
chk('kein Top-Level MobileBars.init() vor dem Sheet-Markup', badInits.length === 0,
    badInits.map(i => 'Zeile ' + lineOf(i)).join(', '));

console.log('── init() ist gegen zu fruehen Aufruf abgesichert ──');
const guard = /function init\(\)\s*\{[\s\S]{0,400}?addEventListener\('DOMContentLoaded'/.test(html);
chk('init() wartet notfalls auf DOMContentLoaded', guard);

console.log('── Streaming-Simulation: Skript sieht nur vorheriges Markup ──');
// Realistischer Test: jeden Inline-Block genau in dem DOM-Zustand ausfuehren,
// der beim Parsen an dieser Stelle existiert.
const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const blocks = [];
let sm;
while ((sm = scriptRe.exec(html))) blocks.push({ code: sm[1], end: sm.index });

let failure = null;
blocks.forEach((b, i) => {
  if (failure) return;
  // DOM nur bis zum Beginn dieses Skripts aufbauen.
  const partial = html.slice(0, b.end) + '</body></html>';
  const dom = new JSDOM(partial, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;

  // Nur die Existenz der angefassten Elemente interessiert uns hier, daher
  // pruefen wir gezielt die Sheet-IDs statt den ganzen Block auszufuehren.
  const missing = sheetIds.filter(id => !w.document.getElementById(id));
  const touches = /MobileBars\.init\(\)/.test(b.code) && /^MobileBars\.init\(\);/m.test(b.code);
  if (touches && missing.length) {
    failure = 'Block ' + i + ' ruft MobileBars.init() auf, aber es fehlen: ' + missing.join(', ');
  }
  dom.window.close();
});
chk('kein Skriptblock greift auf noch nicht geparste Sheets zu', !failure, failure);

console.log(ok ? '\nAlle Tests bestanden.' : '\nFEHLGESCHLAGEN.');
process.exit(ok ? 0 : 1);
