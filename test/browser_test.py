"""Test du site dans Chromium, avec OpenF1 simulé (aucun accès réseau). Données : fixture_data.py
Usage : python3 test/browser_test.py [chemin/vers/echarts.min.js] [dossier_captures]"""
import json, sys, os
from urllib.parse import urlparse, unquote
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from fixture_data import DATA, location, _parse

ECHARTS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "node_modules", "echarts", "dist", "echarts.min.js")
SHOTS = sys.argv[2] if len(sys.argv) > 2 else "/tmp"
INDEX = "file://" + os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "index.html"))
calls = []

def handle(route):
    u = urlparse(route.request.url); ep = u.path.rsplit("/", 1)[-1]; calls.append(ep)
    if ep == "location":
        q = {}
        for part in u.query.split("&"):
            part = unquote(part)
            for op in (">", "<", "="):
                if op in part:
                    k, v = part.split(op, 1); q[k + (op if op != "=" else "")] = unquote(v); break
        body = location(int(q["driver_number"]), _parse(q["date>"]), _parse(q["date<"]))
    else:
        body = DATA[ep]
    route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(body))

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for scheme, w in [("light", 1300), ("dark", 390)]:
        ctx = b.new_context(viewport={"width": w, "height": 900}, color_scheme=scheme)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and "fonts" not in m.text and errors.append(m.text))
        page.route("https://fonts.googleapis.com/**", lambda r: r.abort())
        page.route("**/echarts.min.js", lambda r: r.fulfill(path=ECHARTS, content_type="application/javascript"))
        page.route("https://api.openf1.org/**", handle)
        page.goto(INDEX)
        page.wait_for_selector("#home .hf", timeout=20000)
        print("Accueil :", page.locator("#home .hf-name").inner_text(), "|", len(page.locator("#home .hr").all()), "autres GP")
        page.click("#home .hf")
        page.wait_for_selector("#tower .tower-row", timeout=20000)
        page.wait_for_timeout(1500)
        if scheme == "light":
            print("GP proposés :", page.locator("#gp option").all_inner_texts())
            print("Titre :", page.locator("#headline").inner_text())
            print("KPI :", " | ".join(page.locator("#kpis .kpi .l").all_inner_texts()))
            print("Direction de course :", " | ".join(page.locator("#log .log-row").all_inner_texts()).replace("\n", " "))
            print("Duels :", page.locator("#read-duels").inner_text())
            page.screenshot(path=f"{SHOTS}/site_top.png")
            page.locator("#mchaps").scroll_into_view_if_needed(); page.wait_for_timeout(600)
            page.screenshot(path=f"{SHOTS}/site_chapitres.png")
            chap = lambda c: (page.evaluate(f"navGo(`#${{parseHash().g}}/{c}`)"), page.wait_for_timeout(1500))
            page.click("#mchaps .mc[data-ch=course]"); page.wait_for_timeout(2500)
            print("Panneau ouvert :", page.evaluate("location.hash"), page.evaluate("!!document.querySelector('#mchap-body #course')"))
            page.click("#play"); page.wait_for_timeout(2500); page.click("#play")
            print("Replay arrêté au tour", page.evaluate("replayLap"))
            page.screenshot(path=f"{SHOTS}/site_course.png")
            page.click("#course-chips [data-code='LEC']"); page.wait_for_timeout(500)
            print("Suivi :", page.locator("#follow-txt").inner_text())
            for c, sec in [("course", "#course"), ("pneus", "#u-deg"), ("pneus", "#u-pits")]:
                chap(c); page.locator(f"{sec} .acc-btn").first.scroll_into_view_if_needed(); page.locator(f"{sec} .acc-btn").first.click(); page.wait_for_timeout(900)
            page.screenshot(path=f"{SHOTS}/site_strat.png")
            print("Arrêts :", page.locator("#read-pits").inner_text())
            print("Usure :", page.locator("#read-deg").inner_text())
            chap("explorer")
            for code in ["PIA", "VER", "RUS"]: page.click(f"#ex-chips [data-code='{code}']"); page.wait_for_timeout(300)
            print("5e pilote refusé :", page.evaluate("exSel"), "|", page.locator("#toast").inner_text())
            page.click("#ex-ref [data-ref='VER']"); page.click("[data-ex=gap]"); page.wait_for_timeout(1200)
            print("Écart en piste :", page.locator("#read-ex").inner_text(), "|", page.locator("#how-ex").inner_text().replace("\n", " "))
            page.screenshot(path=f"{SHOTS}/site_ecart.png")
            page.click("[data-ex=laps]"); page.wait_for_timeout(600); print("Temps au tour :", page.locator("#read-ex").inner_text())
            page.click("[data-ex=box]"); page.wait_for_timeout(1500)
            print("Régularité :", page.locator("#read-ex").inner_text().replace("\n", " "))
            page.screenshot(path=f"{SHOTS}/site_regularite.png")
            page.click("[data-ex=circuit]"); page.locator("#circ").scroll_into_view_if_needed(); page.wait_for_timeout(9000)
            print("Circuit :", page.locator("#circ-who").inner_text().replace("\n", " "), "|", page.locator("#cside").inner_text().replace("\n", " "))
            page.screenshot(path=f"{SHOTS}/site_circuit.png")
            page.keyboard.press("Escape"); page.wait_for_timeout(800)
            print("Échap :", page.evaluate("location.hash"), "fermé :", page.evaluate("document.querySelector('#mchap').hidden"))
            page.click("nav.sections a[href='#duels']"); page.wait_for_timeout(1200)
            print("Menu du haut :", page.evaluate("location.hash"))
            page.mouse.click(10, 450); page.wait_for_timeout(800)
            print("Clic à côté :", page.evaluate("location.hash"), "fermé :", page.evaluate("document.querySelector('#mchap').hidden"))
            page.evaluate("showDuel(computeDuels()[0])"); page.wait_for_timeout(4500)
            page.screenshot(path=f"{SHOTS}/site_duel.png"); page.keyboard.press("Escape"); page.wait_for_timeout(500)
            page.select_option("#gp", index=0); page.wait_for_timeout(3000)
            print("Après changement de GP :", page.locator("#headline").inner_text())
            page.screenshot(path=f"{SHOTS}/site_full.png", full_page=True)
            n = len(calls); page.reload(); page.wait_for_selector("#tower .tower-row", timeout=20000)
            print("Appels au rechargement (cache local) :", calls[n:])
        else:
            print("Mobile scrollWidth :", page.evaluate("document.documentElement.scrollWidth"))
            page.screenshot(path=f"{SHOTS}/site_mobile_top.png")
            page.locator("#mchaps .mc").first.scroll_into_view_if_needed(); page.screenshot(path=f"{SHOTS}/site_mobile_chaps.png")
            page.click("#mchaps .mc[data-ch=course]"); page.wait_for_timeout(1500)
            print("Chapitre ouvert :", page.evaluate("location.hash"), page.evaluate("!!document.querySelector('#mchap-body #course')"))
            page.screenshot(path=f"{SHOTS}/site_mobile_course.png")
            page.click("#mchap-next"); page.wait_for_timeout(1200); print("Suivant :", page.evaluate("location.hash"))
            page.go_back(); page.wait_for_timeout(800)
            print("Retour :", page.evaluate("location.hash"), "chapitre fermé :", page.evaluate("document.querySelector('#mchap').hidden"), "| section remise :", page.evaluate("document.querySelector('main > #rythme') !== null"))
            page.go_back(); page.wait_for_timeout(800); print("Accueil revenu :", page.evaluate("!document.querySelector('#home').hidden"))
            page.screenshot(path=f"{SHOTS}/site_mobile_dark.png", full_page=True)
        ctx.close()
    b.close()
print("Erreurs JS :", errors or "aucune")
