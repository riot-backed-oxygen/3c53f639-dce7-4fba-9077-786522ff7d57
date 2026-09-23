"""Browser regression: run against the app with Playwright installed.

python tests/translation-ui.py http://127.0.0.1:4310
Uses synthetic data and stubbed translations; sends no archive text externally.
"""
import json
import os
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright, expect

base_url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4310"
requests = []
errors = []
original = "今日はいい天気です。"
translated = "今天天气不错。"
actress = {"actress_id": "demo", "name": "测试档案", "name_kana": "テスト", "profile_text": original}
movie = {"id": "DEMO-001", "title": original, "date": "2026-09-24", "img": "", "stars": [], "genres": [], "samples": []}
mode = {"value": "success"}


def respond(route, data, status=200):
    route.fulfill(status=status, content_type="application/json", body=json.dumps(data, ensure_ascii=False))


def translate(route):
    requests.append(route.request.post_data_json)
    if mode["value"] == "quota":
        respond(route, {"error": "免费翻译额度已用完，请稍后再试。"}, 429)
    elif mode["value"] == "html":
        respond(route, {"translatedText": "<img src=x onerror=alert(1)>测试译文", "provider": "MyMemory"})
    else:
        respond(route, {"translatedText": translated, "provider": "MyMemory"})


with sync_playwright() as p:
    # Use installed Chrome when the Playwright browser bundle is unavailable.
    launch = {"headless": True}
    if not Path(p.chromium.executable_path).exists():
        launch["channel"] = "chrome"
    browser = p.chromium.launch(**launch)
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.route("https://fonts.googleapis.com/**", lambda route: route.abort())
    page.route("https://fonts.gstatic.com/**", lambda route: route.abort())
    page.route("**/api/actresses?*", lambda route: respond(route, {"data": [actress], "pagination": {"page": 1, "pages": 1, "total": 1}}))
    page.route("**/api/actresses/demo", lambda route: respond(route, {"data": actress}))
    page.route("**/api/javbus/search?*", lambda route: respond(route, {"movies": [movie]}))
    page.route("**/api/javbus/movies/DEMO-001", lambda route: respond(route, movie))
    page.route("**/api/translate", translate)
    page.goto(base_url)
    page.wait_for_load_state("networkidle")
    expect(page.locator(".card")).to_have_count(1)
    assert len(requests) == 0
    page.locator(".card-info").click()
    expect(page.locator("#modal")).to_be_visible()
    profile_button = page.locator("#detail .translate-btn")
    profile_button.click()
    expect(page.locator("#detail .bio")).to_have_text(translated)
    assert requests == [{"text": original}]
    expect(profile_button).to_have_attribute("aria-pressed", "true")
    profile_button.click()
    expect(page.locator("#detail .bio")).to_have_text(original)
    profile_button.click()
    expect(page.locator("#detail .bio")).to_have_text(translated)
    assert len(requests) == 1, "Toggling must reuse the fetched translation"
    page.locator("#worksBtn").click()
    expect(page.locator(".movie-card")).to_have_count(1)
    page.locator(".movie-card .translate-btn").click()
    expect(page.locator(".movie-card p")).to_have_text(translated)
    expect(page.locator("#moviePage")).not_to_be_visible()
    expect(page.locator("#javbusDialog")).to_be_visible()
    page.locator(".movie-card b").click()
    expect(page.locator("#moviePage")).to_be_visible()
    expect(page.locator("#moviePage h2")).to_have_text(original)
    detail_button = page.locator("#moviePage .translate-btn")
    mode["value"] = "quota"
    detail_button.click()
    expect(page.locator("#moviePage .translation-error")).to_contain_text("额度已用完")
    expect(page.locator("#moviePage h2")).to_have_text(original)
    expect(detail_button).to_be_enabled()
    mode["value"] = "success"
    detail_button.click()
    expect(page.locator("#moviePage h2")).to_have_text(translated)
    artifact_dir = Path(os.environ.get("TEMP", ".")) / "atlas-translation-qa"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(artifact_dir / "translation-desktop.png"))
    page.set_viewport_size({"width": 390, "height": 844})
    page.screenshot(path=str(artifact_dir / "translation-mobile.png"))
    assert page.locator("#moviePage").evaluate("el => el.scrollWidth <= el.clientWidth + 1")
    # Fresh controls after navigation must not reuse another element's display state.
    page.locator("#moviePageClose").click()
    page.locator(".movie-card b").click()
    expect(page.locator("#moviePage h2")).to_have_text(original)
    mode["value"] = "html"
    page.locator("#moviePage .translate-btn").click()
    expect(page.locator("#moviePage h2")).to_have_text("<img src=x onerror=alert(1)>测试译文")
    expect(page.locator("#moviePage h2 img")).to_have_count(0)
    assert not errors, errors
    print("PASS: profile/list/detail translation, toggles, quota retry, plain-text safety, mobile layout")
    print("Screenshots:", artifact_dir)
    browser.close()
