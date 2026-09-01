// Prueft im MOBILEN Viewport gegen die LIVE ausgelieferte Seite:
//  1. Das Dropdown der unteren Leiste laesst sich wirklich oeffnen
//     (Regression: overflow:auto auf .subchart-tabs schnitt es ab).
//  2. Kurs, Open Interest & Co. stehen sichtbar in der unteren Leiste.
// Erwartet die Seite unter /tmp/live_app.html.

const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('/tmp/live_app.html', 'utf8');
let ok = true;
const chk = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (c || !extra ? '' : '   [' + extra + ']'));
  if (!c) ok = false;
};

// Handy-Viewport wie im Screenshot (591x1280 -> ~390px CSS-Breite).
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:7777/',
  beforeParse(w) {
    Object.defineProperty(w, 'innerWidth', { value: 390, writable: true });
    Object.defineProperty(w, 'innerHeight', { value: 844, writable: true });
    w.fetch = () => new Promise(() => {});
    w.WebSocket = function () { this.close = () => {}; this.send = () => {}; };
    w.requestAnimationFrame = cb => setTimeout(cb, 0);
    // matchMedia so stubben, dass Mobil-Queries greifen.
    w.matchMedia = q => ({
      matches: /max-width:\s*(8[2-9]\d|9\d\d|1\d{3})px/.test(q) || /max-width:\s*820px/.test(q),
      media: q, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, onchange: null,
    });
    const stubSeries = () => ({
      setData: () => {}, update: () => {}, applyOptions: () => {},
      priceToCoordinate: () => 100, createPriceLine: () => ({}), removePriceLine: () => {},
      setMarkers: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    });
    w.LightweightCharts = {
      createChart: () => ({
        addCandlestickSeries: stubSeries, addHistogramSeries: stubSeries,
        addLineSeries: stubSeries, addAreaSeries: stubSeries, addBarSeries: stubSeries,
        addBaselineSeries: stubSeries,
        timeScale: () => ({
          fitContent: () => {}, applyOptions: () => {},
          subscribeVisibleLogicalRangeChange: () => {}, setVisibleLogicalRange: () => {},
          subscribeVisibleTimeRangeChange: () => {}, setVisibleRange: () => {},
          getVisibleRange: () => ({ from: 0, to: 100 }),
          getVisibleLogicalRange: () => ({ from: 0, to: 100 }),
          timeToCoordinate: () => 50, logicalToCoordinate: () => 50,
          coordinateToLogical: () => 0, coordinateToTime: () => 0,
          scrollToPosition: () => {}, scrollToRealTime: () => {},
        }),
        priceScale: () => ({ applyOptions: () => {} }),
        applyOptions: () => {}, resize: () => {}, remove: () => {},
        subscribeCrosshairMove: () => {}, subscribeClick: () => {},
      }),
      ColorType: { Solid: 'solid' }, LineStyle: { Dotted: 1, Dashed: 2, Solid: 0 },
      CrosshairMode: { Normal: 0, Magnet: 1 },
    };
  },
});

const w = dom.window, d = w.document;
const cs = el => w.getComputedStyle(el);

setTimeout(() => {
  // ZUERST der unberuehrte Startzustand — spaetere Klicks veraendern ihn.
  const State0 = w.eval('typeof State !== "undefined" ? State : null');
  console.log('── Sub-Chart standardmaessig aus (Startzustand) ──');
  chk('State.subType startet auf none', State0.subType === 'none', String(State0.subType));
  chk('Beschriftung zeigt "Aus"',
    d.getElementById('subSelectLabel').textContent.includes('Aus'));
  chk('"Aus" ist die aktive Option',
    d.querySelector('.sub-opt.active').dataset.sub === 'none');
  chk('Sub-Chart-Bereich ist eingeklappt',
    !d.getElementById('subWrap').classList.contains('show'));

  console.log('── Beschwerde 1: "unten geht dropdown nicht auf" ──');
  const sel = d.getElementById('subSelect');
  const btn = d.getElementById('subSelectBtn');
  const menu = d.getElementById('subMenu');
  // Die eigene Sub-Leiste ist entfallen; die Auswahl sitzt in der
  // Chart-Werkzeugleiste (.tf-bar > #chartTools).
  const bar = d.getElementById('tfBar');

  // Kernursache: die Leiste darf das absolut positionierte Menue nicht clippen.
  const ov = cs(bar).overflow, ovx = cs(bar).overflowX;
  chk('Leiste clippt nicht (overflow)', ov !== 'hidden' && ov !== 'auto', 'overflow=' + ov);
  chk('Leiste clippt nicht (overflow-x)', ovx !== 'hidden' && ovx !== 'auto', 'overflow-x=' + ovx);

  chk('Menue startet geschlossen', cs(menu).display === 'none');
  btn.click();
  chk('Klick oeffnet das Menue', sel.classList.contains('open'));
  chk('Menue ist nun sichtbar', cs(menu).display === 'block', cs(menu).display);
  chk('aria-expanded=true', btn.getAttribute('aria-expanded') === 'true');
  chk('Menue oeffnet nach unten', cs(menu).top !== 'auto' && cs(menu).top !== '');
  chk('alle 5 Optionen erreichbar', d.querySelectorAll('#subMenu .sub-opt').length === 5);

  // Auswahl wirklich durchfuehren
  const State = w.eval('typeof State !== "undefined" ? State : null');
  d.querySelector('.sub-opt[data-sub="funding"]').click();
  chk('Auswahl wirkt (State.subType)', State.subType === 'funding', String(State.subType));
  chk('Menue schliesst nach Auswahl', cs(menu).display === 'none');
  chk('Beschriftung folgt', d.getElementById('subSelectLabel').textContent.includes('Funding'));
  d.querySelector('.sub-opt[data-sub="none"]').click();  // zurueck auf den Standard

  console.log('── Beschwerde 2: "die aus der oberen leiste sind noch nicht in der unteren" ──');
  const bb = d.getElementById('bottomBar');
  // WICHTIG: JSDOM wertet @media-Regeln NICHT aus — getComputedStyle liefert
  // hier immer die Desktop-Werte. Die mobil-spezifischen Eigenschaften werden
  // deshalb direkt am Regeltext geprueft; DOM-Struktur und Verhalten oben
  // sind davon unberuehrt und weiterhin echt getestet.
  // Es gibt MEHRERE 820px-Bloecke — alle einsammeln und den nehmen,
  // der die .bottom-bar-Regel enthaelt.
  function mediaBlocks(src) {
    const out = [];
    const re = /@media\s*\(max-width:\s*820px\)\s*\{/g;
    let m;
    while ((m = re.exec(src))) {
      const open = m.index + m[0].length - 1;
      let depth = 0;
      for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) { out.push(src.slice(open + 1, i)); break; }
      }
    }
    return out;
  }
  const blocks = mediaBlocks(html);
  const mobileCss = blocks.find(b => /\.bottom-bar\s*\{/.test(b)) || '';
  function mediaRule(sel) {
    const esc = sel.replace('.', '\\.');
    for (const b of mediaBlocks(html)) {
      const m = b.match(new RegExp(esc + '\\s*\\{([^}]*)\\}'));
      if (m) return m[1];
    }
    return '';
  }
  const bbRule = (mobileCss.match(/\.bottom-bar\s*\{([^}]*)\}/) || [, ''])[1];
  chk('Mobil-Block mit .bottom-bar gefunden', mobileCss.length > 0,
    blocks.length + ' Bloecke durchsucht');
  chk('Bottom-Bar mobil auf display:flex', /display:\s*flex/.test(bbRule), bbRule.trim());
  chk('Bottom-Bar mobil fixiert', /position:\s*fixed/.test(bbRule));
  chk('Bottom-Bar sitzt ueber der Mobile-Nav',
    /bottom:\s*calc\(var\(--bottom-nav-h\)/.test(bbRule));
  chk('Bottom-Bar liegt unter den Sheets (z-index < 300)',
    (() => { const m = bbRule.match(/z-index:\s*(\d+)/); return m && +m[1] < 300; })(),
    (bbRule.match(/z-index:\s*(\d+)/) || [])[1]);
  chk('ticker-stats wird mobil NICHT ausgeblendet',
    !/\.ticker-stats\s*\{\s*display:\s*none/.test(mobileCss));

  const stats = d.getElementById('tickerStats');
  chk('Kennzahlen-Container sichtbar', cs(stats).display !== 'none', cs(stats).display);
  chk('Kennzahlen liegen in der Bottom-Bar', bb.contains(stats));

  // Genau die Werte aus der alten Kopfzeile:
  const ids = { tPrice: 'Preis', tChange: '24h', tHigh: 'Hoch', tLow: 'Tief',
                tVol: 'Volumen', tOi: 'Open Interest', tFunding: 'Funding' };
  Object.entries(ids).forEach(([id, label]) => {
    const el = d.getElementById(id);
    chk(label + ' steht unten', !!el && bb.contains(el) && cs(el).display !== 'none');
  });

  chk('Topbar enthaelt KEINE Kennzahlen mehr',
    d.querySelectorAll('.topbar .stat').length === 0);
  chk('Preis-Trigger oben ist weg',
    d.getElementById('mStatsBtn') === null);
  chk('Kennzahlen NICHT ins Sheet abgewandert',
    d.querySelectorAll('#mStatsHost .stat').length === 0,
    String(d.querySelectorAll('#mStatsHost .stat').length));
  chk('Exchange-Umschalter bleibt im Sheet',
    !!d.querySelector('#mStatsHost #exchangeSwitch'));

  console.log('── Symbol-Box & Timeframe unten ──');
  const sb = d.getElementById('symbolBox');
  chk('Symbol-Box liegt in der Bottom-Bar', bb.contains(sb));
  chk('Symbol-Box NICHT mehr in der Topbar', !d.querySelector('.topbar #symbolBox'));
  chk('TF-Trigger liegt in der Bottom-Bar', bb.contains(d.getElementById('mTfBtn')));
  chk('Preis-Trigger ganz entfernt', d.getElementById('mStatsBtn') === null);

  // Regression-Falle: die Bar darf das nach oben aufklappende Symbol-Menue
  // nicht per overflow abschneiden (gleicher Bug wie zuvor beim Sub-Dropdown).
  chk('Bar clippt das Symbol-Menue nicht (mobil)',
    !/overflow-x:\s*auto/.test(bbRule) && !/overflow:\s*hidden/.test(bbRule),
    bbRule.trim());
  // Desktop-Regel: klappt nach oben auf (Box sitzt unten).
  const ddRule = (html.match(/\.dropdown\s*\{([^}]*)\}/) || [, ''])[1];
  chk('Symbol-Dropdown klappt nach OBEN auf', /bottom:\s*calc\(100%/.test(ddRule), ddRule.trim());
  chk('Symbol-Dropdown nicht mehr top-verankert', !/top:\s*52px/.test(ddRule));
  chk('Suchfeld vorhanden', !!d.getElementById('symbolSearch'));

  console.log('── Reihenfolge in der Leiste ──');
  chk('Timeframe-Bereich ganz rechts', bb.lastElementChild.id === 'bbTfs');
  chk('TF-Trigger direkt davor (mobil sichtbar)',
    bb.lastElementChild.previousElementSibling.id === 'mTfBtn');
  chk('Symbol-Auswahl zweit-rechts',
    bb.lastElementChild.previousElementSibling
      .previousElementSibling.id === 'symbolBox');
  chk('Kennzahlen ganz links', bb.firstElementChild.id === 'tickerStats');

  console.log('── Symbol-Fenster mobil (Tastatur-Bug) ──');
  // Kern des Bugs: .dropdown stand mobil auf top:54px, waehrend die
  // Symbol-Box unten sitzt -> Liste ausserhalb des Sichtfelds, nur Tastatur.
  const ddMobile = mediaRule('.dropdown');
  chk('Symbol-Fenster ist nicht mehr oben verankert',
    !/top:\s*54px/.test(ddMobile), ddMobile.trim());
  chk('Symbol-Fenster klappt von UNTEN auf',
    /bottom:\s*calc\(/.test(ddMobile) && /top:\s*auto/.test(ddMobile));
  chk('sitzt oberhalb von Bottom-Bar und Nav',
    /--bottom-nav-h/.test(ddMobile) && /--bottom-bar-h/.test(ddMobile));
  chk('Hoehe auf freien Platz begrenzt', /max-height:/.test(ddMobile));

  // Kein Autofokus mobil: sonst schiebt sich die Tastatur ueber die Liste.
  chk('kein Autofokus des Suchfelds auf dem Handy',
    /matchMedia\('\(max-width: 820px\)'\)\.matches/.test(html) &&
    /if \(!window\.matchMedia/.test(html));

  const dd2 = d.getElementById('symbolDropdown');
  const sb2 = d.getElementById('symbolBox');
  chk('Symbolliste startet geschlossen', !dd2.classList.contains('show'));
  sb2.click();
  chk('Antippen oeffnet die Symbolliste', dd2.classList.contains('show'));
  chk('Liste ist sichtbar', cs(dd2).display === 'block', cs(dd2).display);
  chk('Suchfeld hat NICHT automatisch den Fokus',
    d.activeElement !== d.getElementById('symbolSearch'),
    String(d.activeElement && d.activeElement.id));
  d.getElementById('chartTools').dispatchEvent(
    new w.MouseEvent('click', { bubbles: true }));
  chk('Klick daneben schliesst wieder', !dd2.classList.contains('show'));

  console.log('── Sub-Auswahl oben bei den Werkzeugen ──');
  chk('alte Sub-Leiste existiert nicht mehr', d.getElementById('subTabs') === null);
  // Mobil hat MobileBars die Werkzeuge bereits ins Werkzeug-Sheet geraeumt —
  // die Auswahl faehrt als Kind von #chartTools automatisch mit.
  chk('Auswahl mobil im Werkzeug-Sheet',
    d.getElementById('mToolsHost').contains(d.getElementById('subSelect')));
  chk('Auswahl auf dem Desktop in #chartTools',
    /<div class="chart-tools" id="chartTools">[\s\S]{0,1200}id="subSelect"/.test(html));
  chk('Auswahl im Sheet schliesst das Sheet',
    /closest\('\.sub-opt'\)\) close\('tools'\)/.test(html));
  chk('CVD weiterhin waehlbar',
    !!d.querySelector('.sub-opt[data-sub="cvd"]'));
  chk('Funding weiterhin waehlbar',
    !!d.querySelector('.sub-opt[data-sub="funding"]'));

  console.log('── Kein Ueberlappen mit der Mobile-Nav ──');
  chk('Chart reserviert Platz fuer Nav + Bottom-Bar',
    /--bottom-nav-h\)\s*\+\s*var\(--bottom-bar-h\)/.test(html));
  chk('--bottom-bar-h ist definiert', /--bottom-bar-h:\s*\d+px/.test(html));

  console.log('\n' + (ok ? 'ALLE TESTS BESTANDEN' : 'TESTS FEHLGESCHLAGEN'));
  process.exit(ok ? 0 : 1);
}, 900);
