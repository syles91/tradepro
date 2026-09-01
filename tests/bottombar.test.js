// Prueft das umgebaute Layout:
//  - Topbar entlastet (kein Kurs, keine Timeframes mehr)
//  - Bottom-Bar ganz unten mit Timeframes + Kennzahlen
//  - Sub-Chart-Auswahl als Dropdown statt Tab-Leiste
//
// Ausfuehren:  NODE_PATH=/pfad/zu/node_modules node tests/bottombar.test.js

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

const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window, d = w.document;
const cs = el => w.getComputedStyle(el);

console.log('── Topbar ist entlastet ──');
const topbar = d.querySelector('.topbar');
chk('Topbar existiert', !!topbar);
chk('keine Kennzahlen mehr in der Topbar',
  topbar.querySelectorAll('.stat').length === 0,
  String(topbar.querySelectorAll('.stat').length));
chk('keine Timeframe-Buttons in der Topbar',
  topbar.querySelectorAll('.tf-btn').length === 0);
chk('#tickerStats liegt NICHT in der Topbar',
  !topbar.contains(d.getElementById('tickerStats')));
// Die Symbol-Box ist ebenfalls nach unten gewandert.
chk('Symbol-Box NICHT mehr in der Topbar', !topbar.querySelector('#symbolBox'));
chk('Symbol-Box sitzt in der Bottom-Bar',
  !!d.getElementById('bottomBar').querySelector('#symbolBox'));
chk('Exchange-Switch bleibt in der Topbar', !!topbar.querySelector('#exchangeSwitch'));
chk('Aktionsknoepfe bleiben oben',
  !!topbar.querySelector('#aiTrigger') && !!topbar.querySelector('#settingsBtn'));

console.log('── Bottom-Bar existiert und sitzt ganz unten ──');
const bb = d.getElementById('bottomBar');
chk('#bottomBar im DOM', !!bb);
chk('#bbTfs im DOM', !!d.getElementById('bbTfs'));
chk('#tickerStats liegt in der Bottom-Bar', bb.contains(d.getElementById('tickerStats')));
chk('7 Timeframes in der Bottom-Bar',
  d.querySelectorAll('#bbTfs .tf-btn').length === 7,
  String(d.querySelectorAll('#bbTfs .tf-btn').length));
chk('TF-Reihenfolge stimmt',
  [...d.querySelectorAll('#bbTfs .tf-btn')].map(b => b.dataset.tf).join(',')
    === '1m,3m,5m,15m,1h,4h,1d');
chk('5m ist vorausgewaehlt',
  d.querySelector('#bbTfs .tf-btn.active').dataset.tf === '5m');
chk('7 Kennzahlen in der Bottom-Bar',
  bb.querySelectorAll('.stat').length === 7);
chk('Preis-Element vorhanden', !!bb.querySelector('#tPrice'));
chk('Open Interest vorhanden', !!bb.querySelector('#tOi'));
chk('Funding vorhanden', !!bb.querySelector('#tFunding'));
chk('Reihenfolge: Symbol, TF-Trigger, TFs, Kennzahlen',
  [...bb.children].map(e => e.id).join(',') === 'symbolBox,mTfBtn,bbTfs,tickerStats',
  [...bb.children].map(e => e.id).join(','));

// Direktes Kind von <body> und letzte sichtbare Leiste vor den Overlays:
// nur so sitzt sie wirklich am unteren Fensterrand.
chk('Bottom-Bar ist direktes Kind von <body>', bb.parentElement === d.body);
const mainEl = d.querySelector('.main');
chk('Bottom-Bar steht im DOM NACH .main',
  !!(mainEl.compareDocumentPosition(bb) & 4),
  'sonst landet sie nicht unten');
chk('Bottom-Bar steht NACH der Chart-Werkzeugleiste',
  !!(d.getElementById('tfBar').compareDocumentPosition(bb) & 4));

console.log('── Bottom-Bar: Layout-CSS ──');
chk('.bottom-bar ist flex', cs(bb).display === 'flex');
chk('.bottom-bar schrumpft nicht weg', cs(bb).flexShrink === '0',
  'sonst quetscht der Chart sie zusammen');
chk('.bottom-bar hat feste Hoehe', cs(bb).height === '46px', cs(bb).height);
chk('.bottom-bar hat obere Trennlinie',
  /1px/.test(cs(bb).borderTopWidth) || cs(bb).borderTopStyle === 'solid',
  cs(bb).borderTopStyle);
chk('body ist Spalten-Flexbox (Bar landet unten)',
  cs(d.body).display === 'flex' && cs(d.body).flexDirection === 'column');
chk('.main nimmt den Rest ein', cs(mainEl).flexGrow === '1');
chk('.ticker-stats hat kein Topbar-Padding mehr',
  cs(d.getElementById('tickerStats')).paddingLeft === '0px',
  cs(d.getElementById('tickerStats')).paddingLeft);

console.log('── Chart-Werkzeugleiste: nur noch Werkzeuge ──');
const tfBar = d.getElementById('tfBar');
chk('.tf-bar enthaelt keine Timeframes mehr',
  tfBar.querySelectorAll('.tf-btn').length === 0);
chk('.tf-bar enthaelt kein Divider-Relikt',
  tfBar.querySelectorAll('.tf-divider').length === 0);
chk('#chartTools bleibt in der .tf-bar', !!tfBar.querySelector('#chartTools'));
chk('Werkzeuge weiterhin vorhanden',
  tfBar.querySelectorAll('.chart-type-btn').length === 7,
  String(tfBar.querySelectorAll('.chart-type-btn').length));
chk('Liq-Heat-Button weiterhin da', !!tfBar.querySelector('#lhToggle'));

console.log('── Sub-Chart-Auswahl als Dropdown ──');
chk('keine alten .subchart-tab-Elemente mehr',
  d.querySelectorAll('.subchart-tab').length === 0,
  String(d.querySelectorAll('.subchart-tab').length));
const sel = d.getElementById('subSelect');
const btn = d.getElementById('subSelectBtn');
const menu = d.getElementById('subMenu');
chk('#subSelect im DOM', !!sel);
chk('#subSelectBtn im DOM', !!btn);
chk('#subMenu im DOM', !!menu);
chk('#subSelectLabel im DOM', !!d.getElementById('subSelectLabel'));
chk('5 Auswahloptionen', d.querySelectorAll('.sub-opt').length === 5,
  String(d.querySelectorAll('.sub-opt').length));
chk('alle Optionen erhalten',
  [...d.querySelectorAll('.sub-opt')].map(o => o.dataset.sub).join(',')
    === 'oi,funding,ls,cvd,none');
// Standardmaessig ist der Sub-Chart AUS — mehr Platz fuer den Hauptchart.
chk('"Aus" ist vorausgewaehlt',
  d.querySelector('.sub-opt.active').dataset.sub === 'none',
  d.querySelector('.sub-opt.active').dataset.sub);
chk('Beschriftung zeigt "Aus"',
  d.getElementById('subSelectLabel').textContent.includes('Aus'));
chk('State startet mit subType none', /subType:\s*'none'/.test(html));
chk('Sub-Chart startet eingeklappt',
  !d.getElementById('subWrap').classList.contains('show'));
chk('Button ist als Listbox-Trigger ausgezeichnet',
  btn.getAttribute('aria-haspopup') === 'listbox' &&
  btn.getAttribute('aria-expanded') === 'false');
chk('Menue hat role=listbox', menu.getAttribute('role') === 'listbox');

console.log('── Dropdown: CSS-Verhalten ──');
chk('Menue ist geschlossen unsichtbar', cs(menu).display === 'none');
chk('.sub-select ist Positions-Anker', cs(sel).position === 'relative');
chk('Menue ist absolut positioniert', cs(menu).position === 'absolute');
// Die Auswahl sitzt jetzt oben in der Werkzeugleiste -> Menue klappt nach UNTEN.
chk('Menue oeffnet nach UNTEN (top gesetzt)',
  cs(menu).top !== 'auto' && cs(menu).top !== '',
  'die Werkzeugleiste sitzt oben am Bildschirm');
chk('Menue liegt ueber dem Chart', parseInt(cs(menu).zIndex, 10) >= 20,
  cs(menu).zIndex);
// Regression: overflow auf der umgebenden Leiste schnitt das aufklappende
// Menue ab, dadurch liess es sich nicht oeffnen. Jetzt scrollt nur der
// innere Werkzeug-Container.
const tfBarRule = (html.match(/\.tf-bar\s*\{([^}]*)\}/) || [, ''])[1];
chk('Werkzeugleiste clippt das Menue nicht',
  !/overflow-x:\s*auto/.test(tfBarRule) && !/overflow:\s*hidden/.test(tfBarRule),
  tfBarRule.trim());
chk('stattdessen scrollt der Werkzeug-Container',
  /\.chart-tools\s*\{[^}]*overflow-x:\s*auto/.test(html));
chk('alte Sub-Leiste ist ganz entfallen', d.getElementById('subTabs') === null);
chk('keine .subchart-tabs-Regeln mehr', !/\.subchart-tabs\s*\{/.test(html));
sel.classList.add('open');
chk('geoeffnet wird das Menue sichtbar', cs(menu).display === 'block');
sel.classList.remove('open');
chk('wieder geschlossen', cs(menu).display === 'none');

console.log('── Verdrahtung im Quelltext ──');
chk('Optionen sind verdrahtet',
  /querySelectorAll\('\.sub-opt'\)\.forEach\(t => t\.onclick = \(\) => switchSub/.test(html));
chk('switchSub markiert die Option',
  /switchSub[\s\S]{0,300}querySelectorAll\('\.sub-opt'\)/.test(html));
chk('switchSub aktualisiert die Beschriftung',
  /label\.textContent = sel\.textContent/.test(html));
chk('switchSub schliesst das Menue',
  /function switchSub\(type\)[\s\S]{0,700}?closeSubMenu\(\)/.test(html));
chk('Klick daneben schliesst das Menue',
  /!s\.contains\(e\.target\)\) closeSubMenu\(\)/.test(html));
chk('Escape schliesst das Menue',
  /e\.key === 'Escape'\) closeSubMenu\(\)/.test(html));
chk('Toggle stoppt die Klick-Propagierung',
  /subSelectBtn'\)\.onclick[\s\S]{0,120}stopPropagation/.test(html),
  'sonst schliesst der Dokument-Handler sofort wieder');
chk('MobileBars holt die TFs aus #bbTfs',
  /querySelectorAll\('#bbTfs \.tf-btn'\)\.forEach\(b => tfHost\.appendChild/.test(html));
chk('MobileBars raeumt die TFs nach #bbTfs zurueck',
  /querySelectorAll\('#mTfHost \.tf-btn'\)\.forEach\(b => bbTfs\.appendChild/.test(html));
chk('kein Divider-Relikt mehr in MobileBars',
  !/tf-divider/.test(html), 'Divider wurde entfernt');

console.log('── Mobil & Fullscreen ──');
chk('Bottom-Bar bleibt mobil sichtbar (Kurs/OI unten statt im Sheet)',
  /@media[^{]*max-width:\s*820px[\s\S]{0,4000}\.bottom-bar\s*\{[^}]*display:\s*flex/.test(html));
chk('Bottom-Bar sitzt mobil ueber der Mobile-Nav',
  /\.bottom-bar\s*\{[^}]*bottom:\s*calc\(var\(--bottom-nav-h\)/.test(html));
chk('.main reserviert Platz fuer Nav UND Bottom-Bar',
  /--bottom-nav-h\)\s*\+\s*var\(--bottom-bar-h\)/.test(html),
  'sonst verdeckt die Leiste den Chart');
chk('Bottom-Bar wird im Chart-Fullscreen ausgeblendet',
  /body\.chart-fullscreen[\s\S]{0,200}\.bottom-bar/.test(html));

console.log('\n' + (ok ? 'ALLE TESTS BESTANDEN' : 'TESTS FEHLGESCHLAGEN'));
process.exit(ok ? 0 : 1);
