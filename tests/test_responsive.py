"""Responsive-Test des TradePro-Terminals mit echtem Chromium (Playwright).

Prüft für Desktop-, Tablet- und Handy-Viewports:
  - kein horizontaler Overflow
  - Indikator-Panel öffnet und fügt Indikatoren hinzu
  - Chart behält nutzbare Höhe, auch mit mehreren Panes
  - Touch-Targets sind gross genug
  - Legende und Modals bleiben im sichtbaren Bereich
  - keine JS-Fehler in der Konsole

Ausführen:
    .venv-test/bin/python tests/test_responsive.py
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:7777"
SHOTS = "/opt/data/crypto-dashboard/tests/screenshots"

VIEWPORTS = [
    ("desktop-1920", 1920, 1080, False),
    ("laptop-1366",  1366,  768, False),
    ("tablet-820",    820, 1180, True),
    ("iphone-390",    390,  844, True),
    ("small-360",     360,  740, True),
    ("landscape-844", 844,  390, True),
]

# Indikatoren, die zusammen 3 eigene Panes erzeugen (Worst Case für Höhe)
PANE_INDICATORS = ["rsi", "macd", "atr"]
OVERLAY_INDICATORS = ["ema", "bb"]

failures = []
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    if not cond:
        failures.append(f"{name} — {detail}")


def run():
    import os
    os.makedirs(SHOTS, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--no-sandbox"])
        for label, w, h, touch in VIEWPORTS:
            ctx = browser.new_context(
                viewport={"width": w, "height": h},
                is_mobile=touch,
                has_touch=touch,
                device_scale_factor=2 if touch else 1,
            )
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

            # Login (Demo-Konto) — der Demo-Button postet fertige Zugangsdaten
            page.goto(f"{BASE}/login", wait_until="domcontentloaded")
            page.click("button.demo")
            page.wait_for_load_state("networkidle")

            page.goto(BASE, wait_until="networkidle")
            # State ist per `const` deklariert und liegt nicht auf window —
            # die Bereitschaft daher am Panel-Objekt festmachen.
            page.wait_for_function(
                "() => window.TradePro && window.TradePro.IndicatorPanel "
                "&& window.TradePro.Indicators && window.TradePro.Indicators.all().length > 0",
                timeout=30000)
            page.wait_for_timeout(900)

            pfx = f"[{label}]"

            # ── Indikatoren hinzufügen (über die echte JS-API) ───────────────
            page.evaluate(
                """(ids) => {
                    localStorage.removeItem('tradepro.indicators.v1');
                    TradePro.IndicatorPanel.instances.slice().forEach(i =>
                        TradePro.IndicatorPanel.removeInstance(i.id));
                    ids.forEach(id => TradePro.IndicatorPanel.addIndicator(id));
                }""",
                OVERLAY_INDICATORS + PANE_INDICATORS,
            )
            page.wait_for_timeout(700)

            count = page.evaluate("TradePro.IndicatorPanel.instances.length")
            check(f"{pfx} 5 Indikatoren aktiv", count == 5, f"aktiv={count}")

            # ── Kein horizontaler Overflow ───────────────────────────────────
            overflow = page.evaluate(
                "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            check(f"{pfx} kein H-Overflow", overflow <= 1, f"overflow={overflow}px")

            # ── Chart behält nutzbare Höhe ───────────────────────────────────
            dims = page.evaluate("""() => {
                const cm = document.querySelector('.chart-main');
                const panes = document.getElementById('indPanes');
                return {
                    chart: cm ? Math.round(cm.getBoundingClientRect().height) : 0,
                    panes: panes ? Math.round(panes.getBoundingClientRect().height) : 0,
                    vh: window.innerHeight,
                };
            }""")
            min_chart = 150 if dims["vh"] < 500 else 200
            check(f"{pfx} Chart-Hoehe >= {min_chart}px", dims["chart"] >= min_chart,
                  f"chart={dims['chart']}px panes={dims['panes']}px vh={dims['vh']}")
            check(f"{pfx} Panes < 55% der Hoehe", dims["panes"] < dims["vh"] * 0.55,
                  f"panes={dims['panes']}px vh={dims['vh']}")

            # ── Panes sichtbar und nicht kollabiert ──────────────────────────
            pane_hs = page.evaluate("""() => [...document.querySelectorAll('.ind-pane')]
                .map(p => Math.round(p.getBoundingClientRect().height))""")
            check(f"{pfx} 3 Panes gerendert", len(pane_hs) == 3, f"panes={pane_hs}")
            check(f"{pfx} kein Pane kollabiert", all(x >= 50 for x in pane_hs), f"hoehen={pane_hs}")

            # ── Legende innerhalb des Viewports ──────────────────────────────
            leg = page.evaluate("""() => {
                const l = document.getElementById('chartIndLegend');
                if (!l) return null;
                const r = l.getBoundingClientRect();
                return { right: Math.round(r.right), w: Math.round(r.width), rows: l.children.length };
            }""")
            if leg:
                check(f"{pfx} Legende im Viewport", leg["right"] <= w + 1,
                      f"right={leg['right']} viewport={w}")

            # ── Indikator-Browser oeffnen ────────────────────────────────────
            page.click("#indBrowserBtn")
            page.wait_for_timeout(450)
            modal = page.evaluate("""() => {
                const m = document.getElementById('indBrowserModal');
                const r = m.getBoundingClientRect();
                return {
                    visible: getComputedStyle(m).display !== 'none',
                    top: Math.round(r.top), bottom: Math.round(r.bottom),
                    left: Math.round(r.left), right: Math.round(r.right),
                    h: Math.round(r.height),
                };
            }""")
            check(f"{pfx} Browser-Dialog sichtbar", modal["visible"], str(modal))
            check(f"{pfx} Dialog horizontal im Viewport",
                  modal["left"] >= -1 and modal["right"] <= w + 1, str(modal))
            check(f"{pfx} Dialog vertikal im Viewport",
                  modal["top"] >= -1 and modal["bottom"] <= h + 1, str(modal))

            # Suche funktioniert
            page.fill("#indSearch", "rsi")
            page.wait_for_timeout(300)
            hits = page.evaluate("document.querySelectorAll('#indBrowserList .ind-item').length")
            check(f"{pfx} Suche filtert", hits >= 1, f"treffer={hits}")

            # Touch-Target-Groesse der Listeneintraege
            if touch:
                item_h = page.evaluate("""() => {
                    const it = document.querySelector('#indBrowserList .ind-item');
                    return it ? Math.round(it.getBoundingClientRect().height) : 0;
                }""")
                check(f"{pfx} Listeneintrag >= 44px", item_h >= 44, f"hoehe={item_h}px")

            page.screenshot(path=f"{SHOTS}/{label}-browser.png")
            page.keyboard.press("Escape")
            page.wait_for_timeout(350)

            # ── Einstellungs-Dialog ──────────────────────────────────────────
            page.evaluate("""() => {
                const inst = TradePro.IndicatorPanel.instances.find(i => i.defId === 'rsi');
                document.querySelectorAll('.ind-legend-row').forEach(r => {
                    if (+r.dataset.inst === inst.id) r.querySelector('[data-act="settings"]').click();
                });
            }""")
            page.wait_for_timeout(400)
            sett = page.evaluate("""() => {
                const m = document.getElementById('indSettingsModal');
                const r = m.getBoundingClientRect();
                return { visible: getComputedStyle(m).display !== 'none',
                         left: Math.round(r.left), right: Math.round(r.right),
                         top: Math.round(r.top), bottom: Math.round(r.bottom) };
            }""")
            check(f"{pfx} Settings-Dialog sichtbar", sett["visible"], str(sett))
            check(f"{pfx} Settings im Viewport",
                  sett["left"] >= -1 and sett["right"] <= w + 1
                  and sett["top"] >= -1 and sett["bottom"] <= h + 1, str(sett))

            if touch:
                btn_h = page.evaluate("""() => {
                    const b = document.getElementById('indSettingsApply');
                    return b ? Math.round(b.getBoundingClientRect().height) : 0;
                }""")
                check(f"{pfx} Uebernehmen-Button >= 44px", btn_h >= 44, f"hoehe={btn_h}px")

            page.screenshot(path=f"{SHOTS}/{label}-settings.png")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)

            # ── Aktions-Buttons auf Touch ohne Hover sichtbar ────────────────
            if touch:
                opacity = page.evaluate("""() => {
                    const a = document.querySelector('.ind-legend-row .ind-actions');
                    return a ? getComputedStyle(a).opacity : '0';
                }""")
                check(f"{pfx} Legenden-Aktionen ohne Hover sichtbar",
                      float(opacity) > 0.5, f"opacity={opacity}")

            page.screenshot(path=f"{SHOTS}/{label}-chart.png", full_page=False)

            # ── Konsole sauber ───────────────────────────────────────────────
            real = [e for e in errors if "favicon" not in e.lower() and "ERR_" not in e]
            check(f"{pfx} keine JS-Fehler", not real, "; ".join(real[:2]))

            ctx.close()
        browser.close()


run()

print()
for name, okk, detail in results:
    print(("  OK   " if okk else "  FAIL ") + name + (f"   ({detail})" if detail and not okk else ""))
print(f"\n{len(results) - len(failures)}/{len(results)} Checks bestanden")
if failures:
    print("\nFEHLER:")
    for f in failures:
        print("  - " + f)
print(f"\nScreenshots: {SHOTS}")
sys.exit(1 if failures else 0)
