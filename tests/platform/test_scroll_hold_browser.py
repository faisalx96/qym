"""The shared scroll hold (ui_components.js): what the reader pressed stays
where it is on screen while the page redraws around it.

A section that got shorter near the end of a scroller, even for a moment
mid-render, let the browser clamp the scroll and the pressed control jumped
away from the pointer (the Overview trend range, expanders on other pages).
Page code placing the view and the reader scrolling still win.
"""

from __future__ import annotations

import pytest

from test_dashboard_paging_browser import browser  # noqa: F401
from test_p1_a11y_visual_browser import PageFixture

pytestmark = pytest.mark.browser

HOLD_PAGE = """<!doctype html><html lang="en"><head>
<script src="/static/ui_components.js"></script>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; }
  #scroller { height: 600px; overflow-y: auto; }
  .block { height: 400px; }
  #panel { height: 500px; }
</style></head><body>
<div id="scroller">
  <div class="block"></div>
  <div id="card"><button id="shrink" type="button">Shrink</button><div id="panel"></div></div>
  <button id="to-top" type="button">To top</button>
</div>
<script>
  const panel = document.getElementById('panel');
  document.getElementById('shrink').addEventListener('click', () => {
    // A redraw that reads layout while its section is briefly empty.
    panel.style.height = '0px';
    void panel.offsetHeight;
    panel.style.height = '120px';
  });
  document.getElementById('to-top').addEventListener('click', () => {
    document.getElementById('scroller').scrollTop = 0;
  });
</script>
</body></html>"""


def _open(browser, hold=True):
    view = PageFixture(browser, {"/hold": HOLD_PAGE}, [])
    view.goto("/hold")
    page = view.page
    if not hold:
        page.evaluate("() => document.getElementById('scroller').setAttribute('data-qym-scroll-hold', 'off')")
    page.evaluate("() => { const s = document.getElementById('scroller'); s.scrollTop = s.scrollHeight; }")
    return view, page


def _top(page, selector):
    return page.evaluate(f"() => document.querySelector('{selector}').getBoundingClientRect().top")


def _frames(page):
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")


def test_pressed_control_stays_put_when_its_section_shrinks_at_the_end(browser):
    view, page = _open(browser)
    try:
        before = _top(page, "#shrink")
        page.click("#shrink")
        _frames(page)
        assert abs(_top(page, "#shrink") - before) < 1
        # The room under it goes as the reader scrolls back up.
        assert page.evaluate("() => document.getElementById('scroller').style.paddingBottom") != ""
        page.mouse.move(300, 300)
        page.mouse.wheel(0, -2000)
        page.wait_for_function("() => document.getElementById('scroller').scrollTop === 0")
        _frames(page)
        assert page.evaluate("() => document.getElementById('scroller').style.paddingBottom") == ""
        assert view.errors == []
    finally:
        view.close()


def test_without_the_hold_the_control_jumps(browser):
    view, page = _open(browser, hold=False)
    try:
        before = _top(page, "#shrink")
        page.click("#shrink")
        _frames(page)
        assert _top(page, "#shrink") - before > 100
    finally:
        view.close()


def test_page_code_placing_the_view_wins_over_the_hold(browser):
    view, page = _open(browser)
    try:
        page.click("#to-top")
        _frames(page)
        assert page.evaluate("() => document.getElementById('scroller').scrollTop") == 0
    finally:
        view.close()
