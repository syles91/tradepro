// Prueft die TATSAECHLICH gerenderten CSS-Werte der Mobile-Sheets.
//
// Warum eigenes Skript: der jsdom-Test in mobilebars.test.js prueft nur
// classList und DOM-Struktur. Genau dort schluepfte der Fehler durch, bei dem
// die Sheets die .ind-modal-Klassen benutzten (per style.display gesteuert)
// und deshalb dauerhaft display:none blieben — samt aller hineinverschobenen
// Kennzahlen. Hier wird das CSS wirklich geparst und die Kaskade ausgewertet.
//
// Ausfuehren:  node tests/sheet-css.test.js

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

// resources/pretendToBeVisual sorgt dafuer, dass getComputedStyle die
// <style>-Regeln der Seite tatsaechlich anwendet.
const dom = new JSDOM(html, { pretendToBeVisual: true });
const w = dom.window, d = w.document;
const cs = el => w.getComputedStyle(el);

const sheets = ['mToolsModal', 'mTfModal', 'mStatsModal'];
const backs = ['mToolsBackdrop', 'mTfBackdrop', 'mStatsBackdrop'];

console.log('── Grundzustand: Sheets geschlossen ──');
sheets.forEach(id => {
  const v = cs(d.getElementById(id)).display;
  chk(id + ' geschlossen -> display:none', v === 'none', 'display=' + v);
});
backs.forEach(id => {
  const v = cs(d.getElementById(id)).display;
  chk(id + ' geschlossen -> display:none', v === 'none', 'display=' + v);
});

console.log('── Geoeffnet: .open muss sichtbar schalten ──');
sheets.forEach(id => {
  const el = d.getElementById(id);
  el.classList.add('open');
  const v = cs(el).display;
  chk(id + ' mit .open -> sichtbar', v === 'flex', 'display=' + v);
  el.classList.remove('open');
});
backs.forEach(id => {
  const el = d.getElementById(id);
  el.classList.add('open');
  const v = cs(el).display;
  chk(id + ' mit .open -> sichtbar', v === 'block', 'display=' + v);
  el.classList.remove('open');
});

console.log('── Kernregression: Inhalte duerfen nicht dauerhaft versteckt sein ──');
// Ein geoeffnetes Sheet muss seinen Host UND die darin liegenden Kennzahlen
// sichtbar machen. Genau das war zuvor gebrochen.
const stats = d.getElementById('mStatsModal');
stats.classList.add('open');
const host = d.getElementById('mStatsHost');
chk('Stats-Host im offenen Sheet sichtbar', cs(host).display !== 'none', 'display=' + cs(host).display);

// Kennzahl testweise ins Sheet haengen (wie MobileBars es zur Laufzeit tut)
const price = d.getElementById('tPrice');
host.appendChild(price.closest('.stat'));
chk('Kennzahl im offenen Sheet sichtbar', cs(price).display !== 'none', 'display=' + cs(price).display);
let el = price, hidden = null;
while (el && el !== d.body) {
  if (cs(el).display === 'none') { hidden = el.id || el.className; break; }
  el = el.parentElement;
}
chk('kein Vorfahre der Kennzahl ist display:none', !hidden, 'versteckt durch: ' + hidden);
stats.classList.remove('open');

console.log('── Keine Klassenkollision mit dem Indikator-Panel ──');
sheets.concat(backs).forEach(id => {
  const c = d.getElementById(id).className;
  chk(id + ' ohne ind-modal/ind-backdrop', !/\bind-(modal|backdrop)\b/.test(c), c);
});

console.log(ok ? '\nAlle Tests bestanden.' : '\nFEHLGESCHLAGEN.');
process.exit(ok ? 0 : 1);
