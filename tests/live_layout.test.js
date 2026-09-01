// Bootet die LIVE vom Server ausgelieferte Seite in JSDOM und prueft, dass
// das neue Layout im echten Auslieferungszustand fehlerfrei laeuft.
// Erwartet die Seite unter /tmp/live_app.html (per curl geholt).

const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('/tmp/live_app.html', 'utf8');
let ok = true;
const chk = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (c || !extra ? '' : '   [' + extra + ']'));
  if (!c) ok = false;
};

const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://127.0.0.1:7777/',
  beforeParse(w) {
    // Netzwerk und Chart-Bibliothek stubben — uns interessiert nur, ob der
    // eigene Skriptblock ohne Fehler durchlaeuft und die Handler bindet.
    w.fetch = () => new Promise(() => {});
    w.WebSocket = function () { this.close = () => {}; this.send = () => {}; };
    w.requestAnimationFrame = cb => setTimeout(cb, 0);
    const stubSeries = () => ({
      setData: () => {}, update: () => {}, applyOptions: () => {},
      priceToCoordinate: () => 100, createPriceLine: () => ({}), removePriceLine: () => {},
      setMarkers: () => {},
      // Die App ruft volumeSeries.priceScale().applyOptions(...) auf.
      priceScale: () => ({ applyOptions: () => {} }),
    });
    w.matchMedia = q => ({
      matches: false, media: q,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, onchange: null,
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
    w.addEventListener('error', e => errors.push(e.message || String(e.error)));
    const origErr = w.console.error;
    w.console.error = (...a) => { errors.push(a.join(' ')); origErr.apply(w.console, a); };
  },
});

const w = dom.window, d = w.document;

setTimeout(() => {
  console.log('── Boot der ausgelieferten Seite ──');
  const fatal = errors.filter(e =>
    /is not defined|is not a function|Cannot read|before initialization|SyntaxError/.test(e));
  chk('kein fataler JS-Fehler beim Boot', fatal.length === 0, fatal.slice(0, 3).join(' | '));
  // State/MobileBars sind per const/let deklariert und haengen daher nicht
  // automatisch am window — im Skript-Kontext ausgewertet.
  const State = dom.window.eval('typeof State !== "undefined" ? State : null');
  chk('State wurde initialisiert', State && typeof State === 'object');
  chk('MobileBars ist verfuegbar', typeof w.MobileBars === 'object');

  console.log('── Layout im Auslieferungszustand ──');
  chk('#bottomBar vorhanden', !!d.getElementById('bottomBar'));
  chk('7 Timeframes in der Bottom-Bar',
    d.querySelectorAll('#bbTfs .tf-btn').length === 7);
  chk('Kennzahlen in der Bottom-Bar',
    d.querySelectorAll('#bottomBar .stat').length === 7);
  chk('Topbar ohne Kennzahlen',
    d.querySelectorAll('.topbar .stat').length === 0);
  chk('Topbar ohne Timeframes',
    d.querySelectorAll('.topbar .tf-btn').length === 0);

  console.log('── Dropdown funktioniert wirklich ──');
  const sel = d.getElementById('subSelect');
  const btn = d.getElementById('subSelectBtn');
  chk('Menue startet geschlossen', !sel.classList.contains('open'));
  btn.click();
  chk('Klick oeffnet das Menue', sel.classList.contains('open'));
  chk('aria-expanded wird gesetzt', btn.getAttribute('aria-expanded') === 'true');

  // Auswahl treffen: Funding
  d.querySelector('.sub-opt[data-sub="funding"]').click();
  chk('Auswahl setzt State.subType', State.subType === 'funding', String(State.subType));
  chk('Auswahl schliesst das Menue', !sel.classList.contains('open'));
  chk('Beschriftung folgt der Auswahl',
    d.getElementById('subSelectLabel').textContent.includes('Funding'),
    d.getElementById('subSelectLabel').textContent);
  chk('aktive Option ist markiert',
    d.querySelector('.sub-opt.active').dataset.sub === 'funding');

  // "Aus" blendet den Sub-Chart aus
  d.querySelector('.sub-opt[data-sub="none"]').click();
  chk('"Aus" versteckt den Sub-Chart',
    !d.getElementById('subWrap').classList.contains('show'));
  d.querySelector('.sub-opt[data-sub="oi"]').click();
  chk('Auswahl zeigt den Sub-Chart wieder',
    d.getElementById('subWrap').classList.contains('show'));

  // Klick daneben schliesst
  btn.click();
  chk('erneut geoeffnet', sel.classList.contains('open'));
  d.body.click();
  chk('Klick daneben schliesst das Menue', !sel.classList.contains('open'));

  console.log('── Timeframes in der Bottom-Bar sind verdrahtet ──');
  const before = State.tf;
  d.querySelector('#bbTfs [data-tf="1h"]').click();
  chk('TF-Klick aendert State.tf', State.tf === '1h', before + ' -> ' + State.tf);
  chk('aktiver TF-Button ist markiert',
    d.querySelector('#bbTfs .tf-btn.active').dataset.tf === '1h');

  console.log('\n' + (ok ? 'ALLE TESTS BESTANDEN' : 'TESTS FEHLGESCHLAGEN'));
  process.exit(ok ? 0 : 1);
}, 900);
