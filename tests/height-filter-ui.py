"""Verify height filters in the browser using synthetic archive data.

python tests/height-filter-ui.py http://127.0.0.1:4314
"""
import json
from pathlib import Path
import sys
import tempfile
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

base_url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4314'
requests = []
errors = []
heights = [159, 160, 170, 171, None] + [165] * 30
records = [{'actress_id': str(index), 'name': 'Sample ' + str(index), 'height_cm': height} for index, height in enumerate(heights)]


def respond(route, data, status=200):
    route.fulfill(status=status, content_type='application/json', body=json.dumps(data))


def actresses(route):
    query = {key: value[0] for key, value in parse_qs(urlparse(route.request.url).query).items()}
    requests.append(query)
    minimum = float(query['height_min']) if 'height_min' in query else None
    maximum = float(query['height_max']) if 'height_max' in query else None
    if minimum is not None and maximum is not None and minimum > maximum:
        respond(route, {'error': '\u8eab\u9ad8\u4e0b\u9650\u4e0d\u80fd\u5927\u4e8e\u4e0a\u9650\u3002'}, 400)
        return
    matches = [record for record in records if
               (minimum is None or (record['height_cm'] is not None and record['height_cm'] >= minimum)) and
               (maximum is None or (record['height_cm'] is not None and record['height_cm'] <= maximum))]
    page = int(query.get('page', 1))
    limit = int(query.get('limit', 12))
    respond(route, {'data': matches[(page - 1) * limit:page * limit], 'pagination': {
        'page': page, 'limit': limit, 'total': len(matches), 'pages': (len(matches) + limit - 1) // limit}})


with sync_playwright() as p:
    launch = {'headless': True}
    if not Path(p.chromium.executable_path).exists():
        launch['channel'] = 'chrome'
    browser = p.chromium.launch(**launch)
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('https://fonts.googleapis.com/**', lambda route: route.abort())
    page.route('https://fonts.gstatic.com/**', lambda route: route.abort())
    page.route('**/api/analytics/summary', lambda route: respond(route, {'totalVisits': 1, 'todayVisits': 1}))
    page.route('**/api/actresses?*', actresses)
    page.goto(base_url)
    page.wait_for_load_state('networkidle')
    low = page.locator('[data-k="height_min"]')
    high = page.locator('[data-k="height_max"]')
    expect(low).to_be_visible()
    expect(high).to_be_visible()
    low.fill('160')
    high.fill('170')
    page.locator('#applyAdvanced').click()
    expect(page.locator('#totalTop')).to_have_text('32')
    assert requests[-1]['height_min'] == '160'
    assert requests[-1]['height_max'] == '170'
    page.locator('#next').click()
    expect(page.locator('#pageLabel')).to_have_text('2 / 3')
    assert requests[-1]['height_min'] == '160' and requests[-1]['height_max'] == '170'
    page.locator('[data-sort="birthday"]').click()
    expect(page.locator('#pageLabel')).to_have_text('1 / 3')
    assert requests[-1]['sort'] == 'birthday' and requests[-1]['height_min'] == '160'
    page.locator('#next').click()
    expect(page.locator('#pageLabel')).to_have_text('2 / 3')
    low.fill('165')
    high.fill('165')
    page.locator('#applyAdvanced').click()
    expect(page.locator('#totalTop')).to_have_text('30')
    expect(page.locator('#pageLabel')).to_have_text('1 / 3')
    artifacts = Path(tempfile.gettempdir()) / 'atlas-height-qa'
    artifacts.mkdir(parents=True, exist_ok=True)
    page.locator('.advanced').screenshot(path=str(artifacts / 'desktop.png'))
    page.set_viewport_size({'width': 390, 'height': 844})
    low.scroll_into_view_if_needed()
    page.locator('.advanced').screenshot(path=str(artifacts / 'mobile.png'))
    assert page.locator('body').evaluate('el => el.scrollWidth <= window.innerWidth')
    low.fill('170')
    high.fill('160')
    page.locator('#applyAdvanced').click()
    expect(page.locator('#notice')).to_contain_text('\u8eab\u9ad8\u4e0b\u9650\u4e0d\u80fd\u5927\u4e8e\u4e0a\u9650')
    low.fill('')
    page.locator('#applyAdvanced').click()
    expect(page.locator('#totalTop')).to_have_text('2')
    expect(page.locator('#notice')).not_to_be_visible()
    assert 'height_min' not in requests[-1] and requests[-1]['height_max'] == '160'
    high.fill('')
    page.locator('#applyAdvanced').click()
    expect(page.locator('#totalTop')).to_have_text('35')
    assert 'height_min' not in requests[-1] and 'height_max' not in requests[-1]
    assert not errors, errors
    print('PASS: height bounds, equality, pagination reset, sort persistence, clear filters, errors, desktop/mobile.')
    print('Screenshots:', artifacts)
    browser.close()
