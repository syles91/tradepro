/* ══════════════════════════════════════════════════════════════════════════
   Trading-Dashboard (/trading) und Daten-Terminal (/daten)

   Prueft die beiden neuen Seiten gegen die LIVE ausgelieferte Antwort des
   Servers — nicht gegen die Datei auf der Platte. Damit faellt auf, wenn
   eine Route fehlt oder eine andere Datei ausliefert als gedacht.

   Aufruf:  NODE_PATH=/tmp/tp_dom/node_modules node tests/pages.test.js
   ══════════════════════════════════════════════════════════════════════════ */
const { JSDOM } = require('jsdom');
const { execSync } = require('child_process');

let pass = 0, fail = 0;
function chk(name, cond, info) {
  if (cond) { pass++; console.log('PASS - ' + name); }
  else { fail++; console.log('FAIL - ' + name + (info ? '   [' + info + ']' : '')); }
}

const BASE = process.env.TP_BASE || 'http://127.0.0.1:7777';
const JAR = process.env.TP_JAR || '/tmp/cj3.txt';

function get(path) {
  return execSync(
    `curl -s -b ${JAR} -w '\\n__STATUS__%{http_code}' '${BASE}${path}'`,
    { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 }
  );
}
function split(raw) {
  const i = raw.lastIndexOf('__STATUS__');
  return { body: raw.slice(0, i), status: Number(raw.slice(i + 10).trim()) };
}

// ══ Routen liefern die richtigen Seiten ═══════════════════════════════════
console.log('── Routen ──');
const trading = split(get('/trading'));
const daten = split(get('/daten'));
const css = split(get('/static/terminal.css'));

chk('/trading antwortet mit 200', trading.status === 200, 'HTTP ' + trading.status);
chk('/daten antwortet mit 200', daten.status === 200, 'HTTP ' + daten.status);
chk('gemeinsames terminal.css wird ausgeliefert', css.status === 200, 'HTTP ' + css.status);
chk('terminal.css definiert die Farbvariablen', /--bg:\s*#0b0e11/.test(css.body));

// Beide Seiten muessen das gemeinsame Stylesheet einbinden, sonst laufen
// die Designs auseinander.
chk('/trading bindet terminal.css ein', /terminal\.css/.test(trading.body));
chk('/daten bindet terminal.css ein', /terminal\.css/.test(daten.body));

// ══ Trading-Dashboard ═════════════════════════════════════════════════════
console.log('── Trading: Aufbau ──');
const td = new JSDOM(trading.body, { runScripts: 'outside-only' }).window.document;

['signals', 'trades', 'strategies', 'settings'].forEach(v => {
  chk('Ansicht "' + v + '" vorhanden', !!td.getElementById('v-' + v));
  chk('Reiter fuer "' + v + '" vorhanden', !!td.querySelector('.tab[data-view="' + v + '"]'));
});
chk('genau eine Ansicht ist aktiv', td.querySelectorAll('.view.active').length === 1);
chk('Signale sind die Startansicht', td.getElementById('v-signals').classList.contains('active'));

console.log('── Trading: Inhalte je Bereich ──');
// Signale
['sigList', 'histBody', 'kOpen', 'kR', 'kConf', 'kTotal']
  .forEach(id => chk('Signal-Element #' + id, !!td.getElementById(id)));
// Trades
['pBal', 'pEq', 'pPnl', 'pPos', 'posBody', 'tradeBody']
  .forEach(id => chk('Trade-Element #' + id, !!td.getElementById(id)));
// Strategien
['stratList', 'statBody'].forEach(id => chk('Strategie-Element #' + id, !!td.getElementById(id)));
// Einstellungen — der Nutzer wollte ausdruecklich alle Einstellungen hier.
['tfChips', 'minConf', 'autoPaper', 'risk', 'lev', 'bal', 'save', 'reset']
  .forEach(id => chk('Einstellung #' + id, !!td.getElementById(id)));

console.log('── Trading: angebundene Endpunkte ──');
[
  '/api/signals/open', '/api/signals/history', '/api/analytics/overview',
  '/api/paper/account', '/api/paper/open', '/api/paper/reset',
  '/api/strategies', '/api/settings'
].forEach(ep => chk('nutzt ' + ep, trading.body.indexOf(ep) > 0));

// ══ Daten-Terminal ════════════════════════════════════════════════════════
console.log('── Daten: Aufbau ──');
const dd = new JSDOM(daten.body, { runScripts: 'outside-only' }).window.document;

// Futures-Kennzahlen
['mPrice', 'mOi', 'mFunding', 'mLs']
  .forEach(id => chk('Kennzahl #' + id, !!dd.getElementById(id)));
// Verlaufs-Sparklines
['cOi', 'cFund', 'cLs'].forEach(id => chk('Verlauf #' + id, !!dd.getElementById(id)));
// Orderbook
['bids', 'asks', 'imbBar', 'obSpread'].forEach(id => chk('Orderbook #' + id, !!dd.getElementById(id)));
// Liq-Map
['cLm', 'clusters', 'lmMeta'].forEach(id => chk('Liq-Map #' + id, !!dd.getElementById(id)));
// Symbol-/Exchange-Auswahl
chk('Symbol-Auswahl vorhanden', !!dd.getElementById('symbol'));
chk('Exchange-Auswahl vorhanden', !!dd.getElementById('exchange'));

// Kernvorgabe: Orderbook und Liq-Map sollen NEBENEINANDER liegen, nicht
// untereinander — beide muessen sich denselben zweispaltigen Container teilen.
const obCard = dd.getElementById('bids').closest('.card');
const lmCard = dd.getElementById('cLm').closest('.card');
chk('Orderbook und Liq-Map liegen nebeneinander',
  !!obCard && !!lmCard && obCard.parentElement === lmCard.parentElement &&
  obCard.parentElement.classList.contains('cols-2'));

console.log('── Daten: angebundene Endpunkte ──');
[
  '/api/ticker', '/api/oi_hist', '/api/funding_hist', '/api/ls_hist',
  '/api/orderbook', '/api/liquidation_map', '/api/symbols'
].forEach(ep => chk('nutzt ' + ep, daten.body.indexOf(ep) > 0));

// ══ Navigation zwischen den drei Bereichen ════════════════════════════════
// Das war der eigentliche Fehler: die Seiten existierten, aber es fuehrte
// kein Weg dorthin. Diese Pruefungen halten die Verdrahtung fest.
console.log('── Navigation ──');
const app = split(get('/'));
chk('/ antwortet mit 200', app.status === 200, 'HTTP ' + app.status);
const ad = new JSDOM(app.body, { runScripts: 'outside-only' }).window.document;

chk('Chart-Nav verlinkt auf /trading',
  !!ad.querySelector('.mobile-nav a[href="/trading"]'));
chk('Chart-Nav verlinkt auf /daten',
  !!ad.querySelector('.mobile-nav a[href="/daten"]'));
chk('Chart-Topbar verlinkt auf /trading',
  !!ad.querySelector('.topbar-right a[href="/trading"]'));
chk('Chart-Topbar verlinkt auf /daten',
  !!ad.querySelector('.topbar-right a[href="/daten"]'));

// Die alten Panel-Trigger duerfen nicht mehr angesprochen werden, sonst
// laeuft der Boot in einen Null-Zugriff (genau dieser Fehler ist schon
// zweimal aufgetreten).
chk('kein Zugriff mehr auf entfernte Nav-Trigger',
  !/getElementById\('mnData'\)|getElementById\('mnSignals'\)/.test(app.body));

// Rueckwege: von jeder Seite zurueck zum Chart und zur jeweils anderen.
chk('/trading verlinkt zurueck zum Chart', !!td.querySelector('a[href="/"]'));
chk('/trading verlinkt auf /daten', !!td.querySelector('a[href="/daten"]'));
chk('/daten verlinkt zurueck zum Chart', !!dd.querySelector('a[href="/"]'));
chk('/daten verlinkt auf /trading', !!dd.querySelector('a[href="/trading"]'));

// Jede Seite markiert sich selbst als aktiv.
const tAct = td.querySelector('.mobile-nav .mnav-btn.active');
const dAct = dd.querySelector('.mobile-nav .mnav-btn.active');
chk('/trading markiert sich selbst als aktiv',
  !!tAct && tAct.getAttribute('href') === '/trading');
chk('/daten markiert sich selbst als aktiv',
  !!dAct && dAct.getAttribute('href') === '/daten');

// ══ Ergebnis ══════════════════════════════════════════════════════════════
console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
if (fail) { console.log('TESTS FEHLGESCHLAGEN'); process.exit(1); }
console.log('ALLE TESTS BESTANDEN');
