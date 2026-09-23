"""Browser check for public aggregate counts; uses synthetic data only.

python tests/analytics-ui.py http://127.0.0.1:4313
"""
import json
import tempfile
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright, expect

base_url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4313'
errors = []
mode = {'failed': False, 'requests': 0}


def respond(route, data, status=200):
    route.fulfill(status=status, content_type='application/json', body=json.dumps(data))


def summary(route):
    mode['requests'] += 1
    if mode['failed']:
        respond(route, {'error': 'Unavailable'}, 503)
    else:
        respond(route, {'totalVisits': 12345, 'todayVisits': 67, 'uniqueIps': 123, 'todayIps': 12})


with sync_playwright() as p:
    launch = {'headless': True}
    if not Path(p.chromium.executable_path).exists():
        launch['channel'] = 'chrome'
    browser = p.chromium.launch(**launch)
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('https://fonts.googleapis.com/**', lambda route: route.abort())
    page.route('https://fonts.gstatic.com/**', lambda route: route.abort())
    page.route('**/api/actresses?*', lambda route: respond(route, {'data': [], 'pagination': {'page': 1, 'pages': 1, 'total': 0}}))
    page.route('**/api/analytics/summary', summary)
    page.goto(base_url)
    page.wait_for_load_state('networkidle')
    expect(page.locator('#visitCount')).to_have_text('\u7d2f\u8ba1\u8bbf\u95ee 12,345 \u00b7 \u4eca\u65e5 67')
    assert mode['requests'] == 1
    assert page.locator('a[href*="analytics"], input[type="password"]').count() == 0
    page.locator('#search').fill('example')
    page.wait_for_load_state('networkidle')
    assert mode['requests'] == 1
    page.locator('.site-footer').scroll_into_view_if_needed()
    artifacts = Path(tempfile.gettempdir()) / 'atlas-analytics-qa'
    artifacts.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(artifacts / 'desktop.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.locator('.site-footer').scroll_into_view_if_needed()
    page.screenshot(path=str(artifacts / 'mobile.png'), full_page=True)
    assert page.locator('body').evaluate('el => el.scrollWidth <= window.innerWidth')
    assert page.locator('.site-footer').evaluate('el => el.scrollWidth <= el.clientWidth')
    mode['failed'] = True
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(page.locator('#visitCount')).to_have_text('\u8bbf\u95ee\u7edf\u8ba1\u6682\u4e0d\u53ef\u7528')
    expect(page.locator('#search')).to_be_enabled()
    mode['failed'] = False
    page.reload()
    expect(page.locator('#visitCount')).to_contain_text('12,345')
    assert not errors, errors
    print('PASS: footer counts, no records entry or secret field, desktop/mobile, failure and reload recovery.')
    print('Screenshots:', artifacts)
    browser.close()
