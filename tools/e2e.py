"""카메라 없이 가짜 손 관절 데이터를 넣어 화면 흐름을 확인하고 스크린샷을 남긴다.

사용법: python3 tools/e2e.py <스크린샷 폴더>
"""
import functools
import http.server
import json
import os
import subprocess
import sys
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots'
os.makedirs(OUT, exist_ok=True)
fixtures = json.loads(subprocess.check_output(['node', os.path.join(ROOT, 'tools', 'make-fixtures.mjs')]))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{server.server_port}/?test'

FEED = """async ([frames, ms]) => {
  for (const f of frames) {
    window.__ksl.feed({ hand: true, lm: f.lm, p: f.p, mirror: false });
    await new Promise((r) => setTimeout(r, ms));
  }
}"""

errors = []
checks = []

def check(name, ok, detail=''):
    checks.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  ({detail})' if detail else ''))

def setup(page):
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function('window.__ksl !== undefined')
    page.evaluate('document.fonts.ready')

def load_templates(page):
    page.evaluate("""(t) => {
      const k = window.__ksl;
      k.store.importJson(JSON.stringify(t));
      k.refit();
      k.cameraOn();
      const c = document.getElementById('overlay'); c.width = 640; c.height = 480;
    }""", fixtures['templates'])

def feed(page, label, n=24, ms=33):
    page.evaluate(FEED, [fixtures['frames'][label][:n], ms])

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 860}, device_scale_factor=1)
    setup(page)
    page.screenshot(path=f'{OUT}/01-first-visit.png', full_page=True)
    check('처음에는 카메라 켜기 버튼이 보인다', page.is_visible('#camera-btn'))

    load_templates(page)
    feed(page, 'ㄱ', 26)
    check('자유 연습: 손모양을 유지하면 인식한 자음에 들어간다', 'ㄱ' in page.inner_text('#typed'), page.inner_text('#typed'))
    check('자유 연습: 카드에 지금 자음이 보인다', page.inner_text('#glyph') == 'ㄱ', page.inner_text('#glyph'))
    page.screenshot(path=f'{OUT}/02-practice-free.png', full_page=True)

    page.click('.letter[data-ch="ㄴ"]')
    feed(page, 'ㄴ', 22)
    check('목표 연습: 맞히면 도장이 찍힌다', 'show' in page.get_attribute('#stamp', 'class'))
    page.screenshot(path=f'{OUT}/03-practice-stamp.png')
    page.wait_for_timeout(900)
    check('목표 연습: 맞히면 다음 자음으로 넘어간다', page.inner_text('#glyph') == 'ㄷ', page.inner_text('#glyph'))
    feed(page, 'ㄴ', 24)
    check('목표 연습: 방금 맞힌 손모양을 들고 있어도 오답으로 잡지 않는다', page.inner_text('#card-note') == '', page.inner_text('#card-note'))
    feed(page, 'ㅁ', 24)
    check('목표 연습: 다른 손모양이면 무엇으로 보이는지 알려 준다', 'ㅁ으로' in page.inner_text('#card-note'), page.inner_text('#card-note'))
    page.screenshot(path=f'{OUT}/04-practice-target.png', full_page=True)

    page.click('.mode[data-mode="attack"]')
    page.evaluate('window.__ksl.game.duration = 8')
    page.click('#attack-start')
    page.wait_for_timeout(3300)
    shot = False
    t0 = time.time()
    while page.evaluate('window.__ksl.game.running') and time.time() - t0 < 12:
        target = page.evaluate('window.__ksl.game.target')
        feed(page, target, 18)
        if not shot:
            page.screenshot(path=f'{OUT}/05-attack-live.png')
            shot = True
    page.wait_for_timeout(300)
    score = int(page.inner_text('#final-score'))
    check('60초 도전: 목표 자음을 만들면 점수가 오르고 결과가 나온다', score > 0 and page.is_visible('#attack-result'), f'{score}점')
    page.screenshot(path=f'{OUT}/06-attack-result.png', full_page=True)

    page.click('.mode[data-mode="record"]')
    page.click('.letter[data-ch="ㅎ"]')
    page.click('#record-btn')
    page.evaluate(FEED, [(fixtures['frames']['ㅇ'] * 5)[:170], 33])
    page.wait_for_timeout(200)
    takes = page.evaluate("window.__ksl.store.takes('ㅎ')")
    check('기준 만들기: 녹화하면 내 기준에 저장된다', takes == 1, f'{takes}번')
    check('기준 만들기: 녹화 뒤 자음 칸에 횟수가 보인다', page.inner_text('.letter[data-ch="ㅎ"] .l-meta') == '1번')
    page.click('#check-btn')
    check('기준 점검 결과가 나온다', '맞힌 비율' in page.inner_text('#check-result'), page.inner_text('#check-result')[:80])
    page.screenshot(path=f'{OUT}/07-record.png', full_page=True)

    m = browser.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    setup(m)
    m.screenshot(path=f'{OUT}/08-mobile.png', full_page=True)
    load_templates(m)
    m.click('.letter[data-ch="ㄷ"]')
    feed(m, 'ㄷ', 10)
    m.screenshot(path=f'{OUT}/09-mobile-practice.png', full_page=True)
    browser.close()

server.shutdown()
check('콘솔 오류가 없다', not errors, '; '.join(errors)[:300])
failed = [c for c in checks if not c[1]]
print(f'{len(checks) - len(failed)}/{len(checks)} passed')
sys.exit(1 if failed else 0)
