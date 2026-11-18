"""Chart snapshots (drawn chart as text) and their stylesheets for a live turn."""

from __future__ import annotations

import hashlib
import json
import zlib
from datetime import datetime

import pytest
from test_live_ingest_chart_images import (  # noqa: F401
    OTHER_REF,
    REF,
    TURN_ID,
    _upload,
    session_factory,
)
from test_live_ingest_sources import (  # noqa: F401
    BASE,
    SOURCE,
    _auth_headers,
    _auth_mode,
    _seed_api_key,
)

from _live_support import _png
from qym_platform.db.models import (
    LiveChartImage,
    LiveChartSnapshot,
    LiveChartStyle,
    LiveSource,
    LiveTurn,
    Project,
)
from qym_platform.settings import PlatformSettings

CSS = ".card{color:#123}\n.title::after{content:'رسم'}\n".encode("utf-8")
HTML = (
    '<html lang="ar" dir="rtl"><head></head><body class="page">'
    '<div class="card"><h2 class="title">المبيعات &lt;script&gt; 2026</h2>'
    '<svg viewBox="0 0 10 10"><rect width="4" height="6"></rect></svg></div>'
    "</body></html>"
)
BOX = {"x": 0, "y": 0, "width": 1248, "height": 462}


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _put_style(client, data=CSS, sha256=None, base=BASE, **kwargs):
    headers = {**_auth_headers(), "Content-Type": "text/css"}
    headers.update(kwargs.pop("headers", {}))
    return client.put(
        f"{base}/chart-styles/{_sha(data) if sha256 is None else sha256}",
        headers=headers,
        content=data,
        **kwargs,
    )


def _snapshot(**values):
    return {
        "format": 1,
        "html": HTML,
        "style_sha256": _sha(CSS),
        "viewport_width": 1248,
        "box": dict(BOX),
        **values,
    }


def _put_snapshot(client, body=None, turn_id=TURN_ID, ref=REF, base=BASE, **kwargs):
    headers = {**_auth_headers(), **kwargs.pop("headers", {})}
    if "content" not in kwargs:
        kwargs["json"] = _snapshot() if body is None else body
    return client.put(
        f"{base}/turns/{turn_id}/charts/{ref}/snapshot", headers=headers, **kwargs
    )


@pytest.fixture()
def style(client, session_factory):
    response = _put_style(client)
    assert response.status_code == 204, response.text


def test_style_is_stored_compressed_under_its_hash(
    client, session_factory, monkeypatch
):
    now = datetime(2026, 11, 1, 12)
    monkeypatch.setattr("qym_platform.services.live_ingest.utcnow", lambda: now)
    response = _put_style(client, headers={"Content-Type": "text/css; charset=utf-8"})
    assert response.status_code == 204, response.text
    assert response.content == b""
    with session_factory() as db:
        row = db.query(LiveChartStyle).one()
        assert row.source_id == db.query(LiveSource).one().id
        assert row.sha256 == _sha(CSS)
        assert zlib.decompress(row.css) == CSS
        assert (row.css_size, row.byte_size) == (len(CSS), len(row.css))
        assert row.received_at == now


def test_style_upload_is_idempotent_and_restarts_its_grace(
    client, session_factory, monkeypatch
):
    clock = {"now": datetime(2026, 11, 1, 12)}
    monkeypatch.setattr(
        "qym_platform.services.live_ingest.utcnow", lambda: clock["now"]
    )
    assert _put_style(client).status_code == 204
    with session_factory() as db:
        first = db.query(LiveChartStyle).one()
        first_id, stored = first.id, first.css
    clock["now"] = datetime(2026, 11, 9, 12)
    assert _put_style(client).status_code == 204
    with session_factory() as db:
        row = db.query(LiveChartStyle).one()
        assert (row.id, row.css) == (first_id, stored)
        assert row.received_at == clock["now"]


@pytest.mark.parametrize(
    ("data", "sha256", "detail"),
    [
        (CSS, _sha(b"other"), "sha256 does not match the body"),
        (b"\xff\xfe.card{}", None, "chart style is not UTF-8"),
    ],
)
def test_style_with_wrong_hash_or_encoding_is_422(
    client, session_factory, data, sha256, detail
):
    response = _put_style(client, data, sha256)
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == detail
    with session_factory() as db:
        assert db.query(LiveChartStyle).count() == 0


@pytest.mark.parametrize("sha256", ["abc", _sha(CSS).upper(), _sha(CSS) + "0"])
def test_style_hash_must_be_lower_case_hex(client, session_factory, sha256):
    response = _put_style(client, sha256=sha256)
    assert response.status_code == 422, response.text
    assert any(
        error["loc"] == ["path", "sha256"] for error in response.json()["detail"]
    )


@pytest.mark.parametrize("length", ["declared", "missing", "understated"])
def test_style_over_cap_is_413(client, session_factory, monkeypatch, length):
    limit = 65536
    monkeypatch.setattr(
        "qym_platform.api.live_ingest.ingest_settings",
        lambda: PlatformSettings(live_chart_style_max_bytes=limit),
    )
    data = b"a" * (limit + 1)
    headers = {"Content-Length": "1"} if length == "understated" else {}
    content = data if length == "declared" else iter([data[:limit], data[limit:]])
    response = _put_style(client, content, sha256=_sha(data), headers=headers)
    assert response.status_code == 413, response.text
    assert f"{limit} byte limit" in response.json()["detail"]
    with session_factory() as db:
        assert db.query(LiveChartStyle).count() == 0


@pytest.mark.parametrize(
    "content_type", ["text/plain", "application/json", "text/html"]
)
def test_style_with_another_content_type_is_415(client, content_type):
    response = _put_style(client, headers={"Content-Type": content_type})
    assert response.status_code == 415, response.text
    assert response.json()["detail"] == "unsupported content type"


def test_snapshot_is_stored_compressed_with_its_frame(
    client, session_factory, style, monkeypatch
):
    now = datetime(2026, 11, 1, 12)
    monkeypatch.setattr("qym_platform.services.live_ingest.utcnow", lambda: now)
    box = {"x": 10.6, "y": 0.5, "width": 100.2, "height": 461.5}
    response = _put_snapshot(client, _snapshot(box=box, viewport_height=600))
    assert response.status_code == 204, response.text
    assert response.content == b""
    data = HTML.encode("utf-8")
    with session_factory() as db:
        row = db.query(LiveChartSnapshot).one()
        turn = db.query(LiveTurn).filter_by(turn_id=TURN_ID).one()
        assert (row.turn_pk, row.ref) == (turn.id, REF)
        assert zlib.decompress(row.html) == data
        assert (row.html_size, row.byte_size) == (len(data), len(row.html))
        assert row.sha256 == _sha(data) and row.style_sha256 == _sha(CSS)
        assert (row.viewport_width, row.viewport_height) == (1248, 600)
        # Rounded outward: the stored box covers 10.6..110.8 and 0.5..462.0.
        assert (row.box_x, row.box_y, row.box_width, row.box_height) == (
            10,
            0,
            101,
            462,
        )
        assert row.received_at == now


def test_snapshot_reupload_replaces_the_row(
    client, session_factory, style, monkeypatch
):
    clock = {"now": datetime(2026, 11, 1, 12)}
    monkeypatch.setattr(
        "qym_platform.services.live_ingest.utcnow", lambda: clock["now"]
    )
    assert _put_snapshot(client).status_code == 204
    with session_factory() as db:
        original_id = db.query(LiveChartSnapshot).one().id
    clock["now"] = datetime(2026, 11, 1, 13)
    html = HTML.replace("2026", "2027")
    with session_factory() as db:
        # A producer that does not report the layout height leaves it empty.
        assert db.query(LiveChartSnapshot).one().viewport_height is None
    body = _snapshot(html=html, viewport_width=1300, viewport_height=32768)
    response = _put_snapshot(client, body)
    assert response.status_code == 204, response.text
    with session_factory() as db:
        row = db.query(LiveChartSnapshot).one()
        assert row.id == original_id
        assert zlib.decompress(row.html) == html.encode("utf-8")
        assert row.sha256 == _sha(html.encode("utf-8"))
        assert (row.viewport_width, row.viewport_height) == (1300, 32768)
        assert row.received_at == clock["now"]


def test_snapshot_without_its_style_is_412(client, session_factory):
    response = _put_snapshot(client)
    assert response.status_code == 412, response.text
    assert response.json()["detail"] == "chart style not found"
    with session_factory() as db:
        assert db.query(LiveChartSnapshot).count() == 0
    # The worker then uploads the stylesheet and repeats the snapshot.
    assert _put_style(client).status_code == 204
    assert _put_snapshot(client).status_code == 204


def test_style_of_another_source_does_not_count(client, session_factory):
    other = BASE.replace("worker-1", "worker-2")
    created = client.put(other, headers=_auth_headers(), json=SOURCE)
    assert created.status_code == 201, created.text
    assert _put_style(client, base=other).status_code == 204
    response = _put_snapshot(client)
    assert response.status_code == 412, response.text
    assert _put_style(client).status_code == 204
    with session_factory() as db:
        assert db.query(LiveChartStyle).count() == 2
        assert db.query(LiveChartStyle.source_id).distinct().count() == 2


def test_snapshot_unknown_turn_or_chart_is_404(client, session_factory, style):
    response = _put_snapshot(client, turn_id="unknown")
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "turn not found"
    response = _put_snapshot(client, ref="unknown")
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "chart not found"
    with session_factory() as db:
        db.query(LiveTurn).filter_by(turn_id=TURN_ID).one().summary = {"charts": None}
        db.commit()
    response = _put_snapshot(client)
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "chart not found"
    with session_factory() as db:
        assert db.query(LiveChartSnapshot).count() == 0


def test_snapshot_html_over_cap_is_413(client, session_factory, style, monkeypatch):
    limit = 65536
    monkeypatch.setattr(
        "qym_platform.api.live_ingest.ingest_settings",
        lambda: PlatformSettings(live_chart_snapshot_max_bytes=limit),
    )
    fill = limit - len(HTML.encode("utf-8"))
    fits = HTML.replace("</body>", "x" * fill + "</body>")
    assert len(fits.encode("utf-8")) == limit
    assert _put_snapshot(client, _snapshot(html=fits)).status_code == 204
    # The cap counts UTF-8 bytes, not characters.
    wide = HTML.replace("</body>", "ش" * (fill // 2 + 1) + "</body>")
    assert len(wide) < limit < len(wide.encode("utf-8"))
    response = _put_snapshot(client, _snapshot(html=wide))
    assert response.status_code == 413, response.text
    assert response.json()["detail"] == (
        f"chart snapshot html exceeds the {limit} byte limit"
    )
    # A body beyond any allowed html in its longest JSON form is cut off while read.
    body = json.dumps(_snapshot(html=HTML + "x" * (6 * limit + 4096))).encode()
    response = _put_snapshot(
        client, content=body, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413, response.text
    assert f"{6 * limit + 4096} byte limit" in response.json()["detail"]
    with session_factory() as db:
        assert zlib.decompress(db.query(LiveChartSnapshot).one().html) == fits.encode()


FORBIDDEN_TAGS = [
    "script",
    "iframe",
    "object",
    "embed",
    "link",
    "meta",
    "base",
    "template",
    "noscript",
]


@pytest.mark.parametrize("tag", FORBIDDEN_TAGS)
@pytest.mark.parametrize(
    "form",
    ["<{lower}>", "<{upper} src=x>", "<{title}/>", "< {lower}>", "<{lower}\n>"],
)
def test_snapshot_with_an_active_tag_is_422(client, session_factory, style, tag, form):
    spelled = form.format(lower=tag, upper=tag.upper(), title=tag.title())
    html = HTML.replace("</body>", f"{spelled}</body>")
    response = _put_snapshot(client, _snapshot(html=html))
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == f"snapshot html must not contain <{tag}"
    with session_factory() as db:
        assert db.query(LiveChartSnapshot).count() == 0


# Shaped like a real ApexCharts card: SVG with gradients and titles, a style
# element inside a foreignObject in the body, inline style attributes.
APEX = (
    '<html lang="ar" class="dark"><head></head><body> <div id="root">'
    '<div dir="rtl" class="relative" data-viz-id="bar" data-chart-card="true">'
    '<h3 class="text-sm font-medium">توزيع الرحلات حسب الوجهة</h3>'
    '<div style="width: 100%; height: 400px;"><div style="min-height: 415px;">'
    '<div id="apexchartsab12" class="apexcharts-canvas" style="width: 1214px;">'
    '<svg xmlns="http://www.w3.org/2000/svg" class="apexcharts-svg" '
    'xmlns:data="ApexChartsNS" width="1214" height="400">'
    '<foreignObject x="0" y="0" width="1214" height="400">'
    '<style type="text/css">.apexcharts-legend { display: flex; }</style>'
    '<div class="apexcharts-legend" xmlns="http://www.w3.org/1999/xhtml">'
    '<button type="button" class="apexcharts-legend-series">2026</button></div>'
    "</foreignObject><metadata>ApexCharts</metadata><defs>"
    '<linearGradient id="SvgjsGradient1" x1="0" y1="0" x2="0" y2="1">'
    '<stop offset="0" stop-color="rgba(216,227,240,0.4)" stop-opacity="0.4"></stop>'
    '</linearGradient><clipPath id="gridRectMask"><rect width="1100" height="300">'
    "</rect></clipPath></defs>"
    '<g class="apexcharts-bar-series"><path d="M 60 300 L 60 120 L 110 120 Z" '
    'fill="url(#SvgjsGradient1)" style="fill-opacity: 0.85;"></path></g>'
    '<text x="56.35" y="274" text-anchor="end" font-size="12px">'
    "<tspan>السعودية</tspan><title>المملكة العربية السعودية</title></text>"
    '<image width="16" height="16" href="data:image/png;base64,iVBORw0KGgo="></image>'
    "</svg></div></div></div></div></div> </body></html>"
)


def test_snapshot_shaped_like_a_real_chart_is_accepted(client, session_factory, style):
    for name in ("foreignObject", "linearGradient", "metadata", "<title>", "<style"):
        assert name in APEX
    body = _snapshot(html=APEX, viewport_height=600)
    response = _put_snapshot(client, body)
    assert response.status_code == 204, response.text
    with session_factory() as db:
        assert zlib.decompress(db.query(LiveChartSnapshot).one().html) == APEX.encode()


@pytest.mark.parametrize(
    "element",
    [
        "<metadata>m</metadata>",
        "<foreignObject></foreignObject>",
        "<basefont>",
        "<links></links>",
        "<scripted></scripted>",
        "<embedded></embedded>",
        "<object-view></object-view>",
        "<meta-chart></meta-chart>",
        "<templates></templates>",
        "<noscripts></noscripts>",
        "<iframes></iframes>",
        "<p>a script, an object and a meta tag</p>",
        "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    ],
)
def test_snapshot_tag_rule_matches_whole_names_only(
    client, session_factory, style, element
):
    html = HTML.replace("</body>", f"{element}</body>")
    response = _put_snapshot(client, _snapshot(html=html))
    assert response.status_code == 204, response.text
    with session_factory() as db:
        assert zlib.decompress(db.query(LiveChartSnapshot).one().html) == html.encode()


START = "snapshot html must start with an <html> tag followed by <head></head>"
ONCE = "snapshot html must contain <head></head> exactly once"
TAIL = '<body><div class="card"></div></body></html>'
# Markup that puts something ahead of the head, or only quotes the head, so that
# a page placing its policy "at the head" would place it outside the real one.
MISPLACED_HEAD = [
    '<html><img src="https://x/b"><head></head>' + TAIL,
    "<html><style>@import url(https://x/c)</style><head></head>" + TAIL,
    '<html><body><!--<head></head>--><img src="https://x/d"></body></html>',
    "<html><body><textarea><head></head></textarea>"
    '<img src="https://x/e"></body></html>',
    '<html><svg><image href="https://x/g"/></svg><head></head>' + TAIL,
    '<html><frameset><frame src="https://x/h"></frameset><head></head>',
]


@pytest.mark.parametrize("html", MISPLACED_HEAD)
def test_snapshot_with_anything_ahead_of_its_head_is_422(
    client, session_factory, style, html
):
    assert html.count("<head></head>") == 1
    response = _put_snapshot(client, _snapshot(html=html))
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == START
    with session_factory() as db:
        assert db.query(LiveChartSnapshot).count() == 0


@pytest.mark.parametrize(
    ("start", "accepted"),
    [
        ("<html>", True),
        ('<html lang="ar" class="dark">', True),
        ('<html data-theme lang="ar">', True),
        ('\n\t <html  lang="ar"\n class="a b"  >', True),
        ('<html lang="">', True),
        ("<HTML>", False),
        ("<html lang='ar'>", False),
        ("<html lang=ar>", False),
        ('<html lang="a>b">', False),
        ('<html lang="a<b">', False),
        ('<html lang="ar"class="dark">', False),
        ('<html lang="ar"">', False),
        ("<html/>", False),
        ('<html lang="ar"/>', False),
        ("<htmlx>", False),
        ("<html> ", False),
        ("<html><!-- c -->", False),
        ("<html><body>", False),
        ("x<html>", False),
    ],
)
def test_snapshot_must_open_with_a_plain_html_tag_and_its_empty_head(
    client, session_factory, style, start, accepted
):
    html = start + "<head></head>" + TAIL
    response = _put_snapshot(client, _snapshot(html=html))
    if accepted:
        assert response.status_code == 204, response.text
        with session_factory() as db:
            stored = db.query(LiveChartSnapshot).one().html
            assert zlib.decompress(stored) == html.encode()
    else:
        assert response.status_code == 422, response.text
        assert response.json()["detail"] == START


def test_snapshot_start_rule_reads_a_long_hostile_input_once():
    """No clock here: a pattern that backtracked on these would not come back."""
    from qym_platform.services.live_ingest import ChartImageError, check_snapshot_html

    size = 2 * 1024 * 1024
    hostile = [
        "<html" + " a" * (size // 2),
        "<html" + (" " + "a" * 63) * (size // 64),
        '<html a="' + "x" * size,
        "<html" + ' a="b c"' * (size // 8),
        " " * size + "<div>",
        "<html" + " " * size + "x",
        "<html" + ' a="b"' * (size // 6) + "><head><head></head>",
    ]
    for html in hostile:
        with pytest.raises(ChartImageError) as refused:
            check_snapshot_html(html, 2 * size)
        assert refused.value.status == 422
        assert refused.value.detail == START
    # The same length in the canonical form is read to its end and accepted,
    # and so is a body full of openings that never become a forbidden tag.
    for html in (
        "<html" + ' a="b"' * (size // 6) + "><head></head>" + TAIL,
        "<html><head></head><body>" + ("<" + " " * 1023) * (size // 1024),
        "<html><head></head><body>" + "< script<" * (size // 9),
    ):
        assert check_snapshot_html(html, 2 * size) == html.encode()


@pytest.mark.parametrize(
    ("html", "detail"),
    [
        ("<!doctype html>" + HTML, START),
        ("<div>" + HTML + "</div>", START),
        ("", START),
        (HTML.replace("<head></head>", ""), START),
        (HTML.replace("<head></head>", "<head><style>p{}</style></head>"), START),
        (HTML.replace("<head></head>", "<HEAD></HEAD>"), START),
        (HTML.replace("</body>", "<head></head></body>"), ONCE),
        (HTML.replace("</body>", "<Head></Head></body>"), ONCE),
        (HTML.replace("2026", "\ud800"), "snapshot html is not valid text"),
    ],
)
def test_snapshot_that_is_not_one_chart_document_is_422(
    client, session_factory, style, html, detail
):
    body = json.dumps(_snapshot(html=html)).encode()
    response = _put_snapshot(
        client, content=body, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == detail
    with session_factory() as db:
        assert db.query(LiveChartSnapshot).count() == 0


def test_snapshot_may_start_with_whitespace(client, session_factory, style):
    html = "\n  " + HTML
    assert _put_snapshot(client, _snapshot(html=html)).status_code == 204
    with session_factory() as db:
        assert zlib.decompress(db.query(LiveChartSnapshot).one().html) == html.encode()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("format", 2),
        ("format", None),
        ("viewport_width", 0),
        ("viewport_width", 8193),
        ("viewport_width", 12.5),
        ("viewport_height", 0),
        ("viewport_height", 32769),
        ("viewport_height", 600.5),
        ("style_sha256", "abc"),
        ("style_sha256", _sha(CSS).upper()),
        ("html", None),
        ("box", None),
        ("box", {**BOX, "x": -1}),
        ("box", {**BOX, "y": -0.5}),
        ("box", {**BOX, "width": 0}),
        ("box", {**BOX, "height": -3}),
        ("box", {**BOX, "x": 100001}),
        ("box", {**BOX, "height": 100001}),
        ("box", {"x": 0, "y": 0, "width": 10}),
        ("box", {**BOX, "depth": 1}),
        ("extra", 1),
    ],
)
def test_snapshot_with_an_invalid_field_is_422(
    client, session_factory, style, field, value
):
    response = _put_snapshot(client, _snapshot(**{field: value}))
    assert response.status_code == 422, response.text
    assert any(
        error["loc"][:2] == ["body", field] for error in response.json()["detail"]
    )
    with session_factory() as db:
        assert db.query(LiveChartSnapshot).count() == 0


@pytest.mark.parametrize(
    ("values", "accepted"),
    [
        # The box may pass the page's right edge by one pixel of rounding, no more.
        ({"viewport_width": 1248, "box": {**BOX, "x": 1, "width": 1248}}, True),
        ({"viewport_width": 1248, "box": {**BOX, "x": 1.5, "width": 1248}}, False),
        ({"viewport_width": 640, "box": BOX}, False),
        ({"viewport_width": 100, "box": {**BOX, "x": 50, "width": 52}}, False),
    ],
)
def test_snapshot_box_must_lie_within_the_page_width(
    client, session_factory, style, values, accepted
):
    response = _put_snapshot(client, _snapshot(**values))
    if accepted:
        assert response.status_code == 204, response.text
        return
    assert response.status_code == 422, response.text
    (error,) = response.json()["detail"]
    assert error["loc"] == ["body"]
    assert "box must lie within viewport_width" in error["msg"]
    with session_factory() as db:
        assert db.query(LiveChartSnapshot).count() == 0


@pytest.mark.parametrize(
    ("box", "accepted", "message"),
    [
        ({"x": 0, "y": 0, "width": 100, "height": 2000}, True, None),
        (
            {"x": 0, "y": 0, "width": 100, "height": 2000.5},
            False,
            "box height must be at most 20 times its width",
        ),
        # One pixel wide and a hundred thousand tall made the page millions tall.
        ({"x": 0, "y": 0, "width": 1, "height": 100000}, False, "32768"),
        ({"x": 0, "y": 0, "width": 8192, "height": 32768}, True, None),
        ({"x": 0, "y": 0, "width": 8192, "height": 32768.5}, False, "32768"),
        (
            {"x": 0, "y": 0, "width": 1, "height": 21},
            False,
            "box height must be at most 20 times its width",
        ),
    ],
)
def test_snapshot_box_must_not_be_a_sliver(
    client, session_factory, style, box, accepted, message
):
    response = _put_snapshot(client, _snapshot(viewport_width=8192, box=box))
    if accepted:
        assert response.status_code == 204, response.text
        return
    assert response.status_code == 422, response.text
    (error,) = response.json()["detail"]
    assert error["loc"][:2] == ["body", "box"]
    assert message in error["msg"]
    with session_factory() as db:
        assert db.query(LiveChartSnapshot).count() == 0


@pytest.mark.parametrize("number", ["NaN", "Infinity", "-Infinity"])
def test_snapshot_box_must_be_finite(client, session_factory, style, number):
    body = json.dumps(_snapshot()).replace('"height": 462}', f'"height": {number}}}')
    assert number in body
    response = _put_snapshot(
        client, content=body.encode(), headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422, response.text
    assert any(
        error["loc"] == ["body", "box", "height"] for error in response.json()["detail"]
    )
    with session_factory() as db:
        assert db.query(LiveChartSnapshot).count() == 0


def test_snapshot_cap_blocks_new_refs_but_allows_replacement(
    client, session_factory, style, monkeypatch
):
    monkeypatch.setattr(
        "qym_platform.api.live_ingest.ingest_settings",
        lambda: PlatformSettings(live_chart_images_per_turn=1),
    )
    assert _put_snapshot(client).status_code == 204
    response = _put_snapshot(client, ref=OTHER_REF)
    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "chart snapshot limit reached"
    assert _put_snapshot(client, _snapshot(viewport_width=2000)).status_code == 204
    with session_factory() as db:
        row = db.query(LiveChartSnapshot).one()
        assert (row.ref, row.viewport_width) == (REF, 2000)


def test_snapshot_and_image_replace_each_other(client, session_factory, style):
    assert _upload(client).status_code == 204
    assert _upload(client, ref=OTHER_REF).status_code == 204
    assert _put_snapshot(client).status_code == 204
    with session_factory() as db:
        # Only the same chart's picture goes; the other chart keeps its own.
        assert db.query(LiveChartImage).one().ref == OTHER_REF
        assert db.query(LiveChartSnapshot).one().ref == REF
    assert _put_snapshot(client, ref=OTHER_REF).status_code == 204
    assert _upload(client).status_code == 204
    with session_factory() as db:
        assert db.query(LiveChartImage).one().ref == REF
        assert db.query(LiveChartSnapshot).one().ref == OTHER_REF


def test_refused_snapshot_keeps_the_stored_image(client, session_factory, style):
    assert _upload(client).status_code == 204
    html = HTML.replace("</body>", "<script>1</script></body>")
    assert _put_snapshot(client, _snapshot(html=html)).status_code == 422
    assert _put_snapshot(client, _snapshot(style_sha256=_sha(b"x"))).status_code == 412
    with session_factory() as db:
        assert db.query(LiveChartImage).one().image == _png()
        assert db.query(LiveChartSnapshot).count() == 0


def test_snapshot_turn_id_can_contain_slashes(client, session_factory, style):
    # The id even ends like the image route; the last segments decide the route.
    turn_id = f"conversation/turn/1/charts/{REF}/image"
    with session_factory() as db:
        db.query(LiveTurn).filter_by(turn_id=TURN_ID).one().turn_id = turn_id
        db.commit()
    response = _put_snapshot(client, turn_id=turn_id)
    assert response.status_code == 204, response.text
    with session_factory() as db:
        row = db.query(LiveChartSnapshot).one()
        assert db.get(LiveTurn, row.turn_pk).turn_id == turn_id
        assert db.query(LiveChartImage).count() == 0


def test_chart_puts_do_not_reach_the_greedy_source_routes(
    client, session_factory, monkeypatch
):
    def unexpected(*args, **kwargs):
        pytest.fail("A chart PUT reached a route with a greedy source key")

    for name in ("upsert_source", "replace_metric_specs", "upsert_day"):
        monkeypatch.setattr(f"qym_platform.services.live_ingest.{name}", unexpected)
    assert _put_style(client).status_code == 204
    assert _put_snapshot(client).status_code == 204
    with session_factory() as db:
        assert db.query(LiveSource).one().name == "Production worker"
        assert db.query(LiveChartStyle).count() == 1
        assert db.query(LiveChartSnapshot).count() == 1


def test_source_key_with_a_slash_never_matches_a_chart_route(
    client, session_factory, monkeypatch
):
    def unexpected(*args, **kwargs):
        pytest.fail("A key with a slash reached a write")

    for name in ("store_chart_style", "upsert_chart_snapshot", "upsert_source"):
        monkeypatch.setattr(f"qym_platform.services.live_ingest.{name}", unexpected)
    slashed = BASE.replace("worker-1", "team/worker-1")
    # Both fall through to the source route, which refuses the request.
    for response in (
        _put_style(client, base=slashed),
        _put_snapshot(client, base=slashed),
    ):
        assert response.status_code == 422, response.text
    with session_factory() as db:
        assert db.query(LiveSource).count() == 1
        assert db.query(LiveChartStyle).count() == 0


def test_source_named_like_a_chart_route_keeps_every_route(client, session_factory):
    base = BASE.replace("worker-1", "chart-styles")
    headers = _auth_headers()
    assert client.put(base, headers=headers, json=SOURCE).status_code == 201
    specs = client.put(base + "/metric-specs", headers=headers, json={"specs": []})
    assert specs.status_code == 200, specs.text
    day = client.put(base + "/days/2026-11-01", headers=headers, json={})
    assert day.status_code == 200, day.text
    assert _put_style(client, base=base).status_code == 204
    with session_factory() as db:
        source = db.query(LiveSource).filter_by(key="chart-styles").one()
        assert db.query(LiveChartStyle).one().source_id == source.id
        assert db.query(LiveSource).count() == 2


def test_other_project_key_is_403(client, session_factory):
    with session_factory() as db:
        _seed_api_key(db, token="other-live-token", suffix="2")
    headers = _auth_headers("other-live-token")
    for response in (
        _put_style(client, headers=headers),
        _put_snapshot(client, headers=headers),
    ):
        assert response.status_code == 403, response.text
        assert response.json()["detail"] == "API key belongs to another project"
    with session_factory() as db:
        assert db.query(LiveChartStyle).count() == 0


def test_archived_project_and_maintenance_block_both_uploads(
    client, session_factory, monkeypatch
):
    with session_factory() as db:
        db.get(Project, "live-project-1").is_active = False
        db.commit()
    for response in (_put_style(client), _put_snapshot(client)):
        assert response.status_code == 409, response.text
        assert response.headers["X-Qym-Key-State"] == "project_archived"
    with session_factory() as db:
        db.get(Project, "live-project-1").is_active = True
        db.commit()
    monkeypatch.setattr(
        "qym_platform.api.ingest.ingest_settings",
        lambda: PlatformSettings(maintenance_mode=True),
    )
    for response in (_put_style(client), _put_snapshot(client)):
        assert response.status_code == 503, response.text
        assert response.headers["Retry-After"] == "60"
    with session_factory() as db:
        assert db.query(LiveChartStyle).count() == 0


def test_services_leave_the_commit_to_the_caller(session_factory):
    from qym_platform.api.live_ingest import ChartSnapshotBody
    from qym_platform.services.live_ingest import (
        store_chart_style,
        upsert_chart_snapshot,
    )

    settings = PlatformSettings()
    body = ChartSnapshotBody.model_validate(_snapshot())
    with session_factory() as db:
        source = db.query(LiveSource).one()
        assert store_chart_style(db, source, _sha(CSS), CSS) == "created"
        db.flush()
        assert store_chart_style(db, source, _sha(CSS), CSS) == "present"
        args = (db, source, TURN_ID, REF, body, settings)
        assert upsert_chart_snapshot(*args) == "created"
        db.flush()
        assert upsert_chart_snapshot(*args) == "replaced"
        db.flush()
        assert db.query(LiveChartSnapshot).count() == 1
        db.rollback()
    with session_factory() as db:
        assert db.query(LiveChartSnapshot).count() == 0
        assert db.query(LiveChartStyle).count() == 0


@pytest.mark.parametrize("service", ["main", "ingestion"])
def test_openapi_documents_both_chart_bodies(service):
    from qym_platform.app import create_app, create_ingestion_app

    factory = create_ingestion_app if service == "ingestion" else create_app
    app = factory(PlatformSettings(service=service, database_url="sqlite://"))
    document = app.openapi()
    base = "/v1/projects/{project_id}/live/sources/{key}"
    prefixes = ("", "/ingestion") if service == "ingestion" else ("",)
    for prefix in prefixes:
        style_put = document["paths"][prefix + base + "/chart-styles/{sha256}"]["put"]
        assert style_put["requestBody"] == {
            "required": True,
            "content": {"text/css": {"schema": {"type": "string"}}},
        }
        snapshot_put = document["paths"][
            prefix + base + "/turns/{turn_id}/charts/{ref}/snapshot"
        ]["put"]
        assert snapshot_put["requestBody"] == {
            "required": True,
            "content": {
                "application/json": {
                    "schema": {"$ref": "#/components/schemas/ChartSnapshotBody"}
                }
            },
        }
        for operation in (style_put, snapshot_put):
            assert "204" in operation["responses"]
            assert "content" not in operation["responses"]["204"]
    schemas = document["components"]["schemas"]
    assert set(schemas["ChartSnapshotBody"]["required"]) == {
        "format",
        "html",
        "style_sha256",
        "viewport_width",
        "box",
    }
    assert "ChartBoxBody" in schemas
