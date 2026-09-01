// Testet die Zeitachsen-Synchronisation zwischen Haupt- und Sub-Charts.
//
// Hintergrund: setVisibleRange() klemmt in Lightweight Charts auf den
// Datenbereich der jeweiligen Serie. OI/Funding/LS/CVD liefern weniger und
// groebere Punkte als die Kerzen des Haupt-Charts — ohne Ausrichtung zeigt
// der Sub-Chart deshalb ein anderes Zeitfenster (z. B. 23:00-03:00 statt
// 18:00-03:00). alignToMainTime()/alignToChartTime() fuellen die Luecken mit
// Whitespace-Punkten, damit beide Achsen dieselbe Zeit-Domain kennen.
//
// Ausfuehren:  node tests/timeaxis.test.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'static', 'app.html'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'static', 'indicators', 'panel.js'), 'utf8');

let ok = true;
const chk = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + n); if (!c) ok = false; };

// ── alignToMainTime (Sub-Charts in app.html) ──────────────────────────────
const mA = html.match(/function alignToMainTime\(points\)\s*\{[\s\S]*?\n\}/);
if (!mA) { console.error('FAIL: alignToMainTime nicht gefunden'); process.exit(1); }

let State = { candles: [] };
const toLocalTime = t => t;
function mainChartTimes() { return (State.candles || []).map(c => toLocalTime(c.time)); }
eval(mA[0]);

console.log('── alignToMainTime (Sub-Charts) ──');

// Szenario aus dem Fehlerbild: 500 Kerzen a 5min, OI nur 48 Punkte am Rand.
const step = 300, end = 1000000;
State.candles = Array.from({ length: 500 }, (_, i) => ({ time: end - (499 - i) * step }));
const oi = Array.from({ length: 48 }, (_, i) => ({ time: end - (47 - i) * step, value: 8.4 + i * 0.001 }));

const out = alignToMainTime(oi);
chk('Startzeit == Hauptchart-Start', out[0].time === State.candles[0].time);
chk('Endzeit == Hauptchart-Ende', out[out.length - 1].time === State.candles[499].time);
chk('deckt volle Zeitspanne ab', out.length >= 500);
chk('aufsteigend sortiert', out.every((p, i) => i === 0 || p.time > out[i - 1].time));
chk('alle 48 OI-Werte erhalten', out.filter(p => p.value !== undefined).length === 48);
chk('fruehe Punkte sind Whitespace (kein value)', out[0].value === undefined);
chk('letzter Punkt hat echten Wert', out[out.length - 1].value !== undefined);

State.candles = [];
chk('ohne Kerzen unveraendert', alignToMainTime(oi).length === 48);

State.candles = Array.from({ length: 10 }, (_, i) => ({ time: 1000 + i * 100 }));
const odd = [{ time: 450, value: 1 }, { time: 1250, value: 2 }, { time: 1900, value: 3 }];
const o2 = alignToMainTime(odd);
chk('Punkt vor erster Kerze verworfen', !o2.some(p => p.time === 450));
chk('Zwischenpunkt (1250) erhalten', o2.some(p => p.time === 1250 && p.value === 2));
chk('Randfall bleibt sortiert', o2.every((p, i) => i === 0 || p.time >= o2[i - 1].time));

// ── alignToChartTime (Indikator-Panes in panel.js) ────────────────────────
const mB = panel.match(/function alignToChartTime\(data\)\s*\{[\s\S]*?\n  \}/);
if (!mB) { console.error('FAIL: alignToChartTime nicht gefunden'); process.exit(1); }

console.log('── alignToChartTime (Indikator-Panes) ──');

let candles = [];
const ctx = { getCandles: () => candles, toLocalTime: t => t };
eval(mB[0].replace(/^  /gm, ''));

// SMA200 auf 500 Kerzen: der Indikator startet erst bei Kerze 200.
candles = Array.from({ length: 500 }, (_, i) => ({ time: 1000 + i * 300 }));
const sma = candles.slice(199).map(c => ({ time: c.time, value: 42 }));
const s = alignToChartTime(sma);
chk('deckt alle 500 Kerzen ab', s.length === 500);
chk('beginnt bei erster Kerze', s[0].time === candles[0].time);
chk('endet bei letzter Kerze', s[499].time === candles[499].time);
chk('Vorlauf ist Whitespace', s[0].value === undefined && s[198].value === undefined);
chk('alle 301 Werte erhalten', s.filter(p => p.value !== undefined).length === 301);
chk('sortiert', s.every((p, i) => i === 0 || p.time > s[i - 1].time));

candles = [];
chk('ohne Kerzen unveraendert', alignToChartTime(sma).length === sma.length);
candles = Array.from({ length: 5 }, (_, i) => ({ time: i * 100 }));
chk('leere Daten unveraendert', alignToChartTime([]).length === 0);

// ── Verdrahtung: nutzen alle vier Sub-Chart-Typen den Aligner? ────────────
console.log('── Verdrahtung in loadSubChart ──');
chk('OI nutzt Aligner', /d\.value \}\)\)\)/.test(html));
chk('Funding nutzt Aligner', html.includes('alignToMainTime(fpoints)'));
chk('Long/Short nutzt Aligner', html.includes('alignToMainTime(data.global.map'));
chk('CVD nutzt Aligner', html.includes('d.cvd })))'));

console.log(ok ? '\nAlle Tests bestanden.' : '\nFEHLGESCHLAGEN.');
process.exit(ok ? 0 : 1);
