"""Test du dashboard dans Chromium, avec OpenF1 simulé (aucun accès réseau). Données : fixture_data.py"""
import json, sys, os
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from fixture_data import DATA
calls = []

def handle(route):
    u = urlparse(route.request.url); ep = u.path.rsplit("/",1)[-1]; calls.append(ep)
    route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin":"*"}, body=json.dumps(DATA[ep]))

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for scheme, w in [("light", 1200), ("dark", 400)]:
        ctx = b.new_context(viewport={"width": w, "height": 900}, color_scheme=scheme)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.route("https://fonts.googleapis.com/**", lambda r: r.abort())
        page.route("https://api.openf1.org/**", handle)
        page.goto("file:///home/claude/f1-gaps/index.html")
        page.wait_for_selector(".verdict", timeout=15000)
        if scheme == "light":
            opts = page.locator("#gp option").all_inner_texts()
            print("GP proposés:", opts)
            print("Verdict (McLaren par défaut):", page.locator(".verdict p").inner_text())
            print("Appels API:", calls)
            print("Sous-titre:", page.locator(".card .sub").nth(0).inner_text())
            page.screenshot(path="/tmp/claude-0/shot_duel.png", full_page=True)
            page.wait_for_timeout(400); page.check("#outliers"); page.screenshot(path="/tmp/claude-0/shot_outliers.png", full_page=True); page.wait_for_timeout(400)
            page.locator("#gapchart svg").scroll_into_view_if_needed()
            gb = page.locator("#gapchart svg").bounding_box()
            page.mouse.move(gb["x"] + gb["width"]*0.9, gb["y"] + 60)
            print("Tooltip écart:", page.locator("#gapchart .tip").inner_text().replace("\n"," | "))
            # 3 pilotes dont un abandon
            page.click("button.drv[data-dn='16']"); page.click("button.drv[data-dn='87']")
            page.wait_for_selector("#bars svg"); page.wait_for_timeout(400)
            print("Tableau:\n", page.locator("table").inner_text())
            page.locator("#chart svg").scroll_into_view_if_needed()
            box = page.locator("#chart svg").bounding_box()
            page.mouse.move(box["x"] + box["width"]*0.33, box["y"] + 100)
            print("Tooltip:", page.locator("#chart .tip").inner_text().replace("\n"," | "))
            page.screenshot(path="/tmp/claude-0/shot_multi.png", full_page=True)
            n_calls = len(calls)
            page.reload(); page.wait_for_selector(".verdict", timeout=15000)
            print("Appels au rechargement (cache local):", calls[n_calls:])
        else:
            sw = page.evaluate("document.documentElement.scrollWidth")
            print("Mobile scrollWidth:", sw)
            page.screenshot(path="/tmp/claude-0/shot_mobile_dark.png", full_page=True)
        ctx.close()
    b.close()
print("Erreurs JS:", errors or "aucune")
