"""Self-contained HTML exports (a run page, a comparison) with every asset inlined.

``GET /api/runs/{id}/export-html`` and ``GET /api/compare/export-html`` are
features of the server, not pages: the file opens offline, so the run page it
is built from (``export_templates/run/``: the frozen run template with its CSS
and scripts) is inlined here and fed the run's data through
``window.__QYM_EXPORT_DATA__``.
"""

from __future__ import annotations

import html as html_lib
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Sequence

from qym_platform.services.compare_export import build_comparison, render_comparison_html

EXPORT_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "export_templates" / "run"


def build_run_export_html(data: Dict[str, Any]) -> str:
    """The run page for ``data`` (the run payload) as one offline HTML document."""
    dashboard_dir = EXPORT_TEMPLATE_DIR

    # Read source files
    run_html = (dashboard_dir / "run.html").read_text(encoding="utf-8")
    css_content = (dashboard_dir / "dashboard.css").read_text(encoding="utf-8")
    shell_css_content = (dashboard_dir / "shell.css").read_text(encoding="utf-8")
    ui_components_css_content = (dashboard_dir / "ui_components.css").read_text(
        encoding="utf-8"
    )
    latency_traces_css = (dashboard_dir / "latency_traces.css").read_text(encoding="utf-8")
    versioning_details_css = (dashboard_dir / "run_versioning_details.css").read_text(
        encoding="utf-8"
    )
    ui_components_js = (dashboard_dir / "ui_components.js").read_text(encoding="utf-8")
    metrics_js = (dashboard_dir / "metrics.js").read_text(encoding="utf-8")
    safe_js = (dashboard_dir / "qym_safe.js").read_text(encoding="utf-8")

    # Inline dashboard.css
    run_html = re.sub(
        r'\s*<link\s+rel="stylesheet"\s+href="/static/dashboard\.css(?:\?[^"]*)?">\s*',
        lambda _match: f"<style>\n{css_content}\n</style>",
        run_html,
        count=1,
    )
    run_html = re.sub(
        r'\s*<link\s+rel="stylesheet"\s+href="/static/shell\.css(?:\?[^"]*)?">\s*',
        lambda _match: f"<style>\n{shell_css_content}\n</style>",
        run_html,
        count=1,
    )
    run_html = re.sub(
        r'\s*<link\s+rel="stylesheet"\s+href="/static/ui_components\.css(?:\?[^"]*)?">\s*',
        lambda _match: f"<style>\n{ui_components_css_content}\n</style>",
        run_html,
        count=1,
    )
    run_html = re.sub(
        r'\s*<link\s+rel="stylesheet"\s+href="/static/latency_traces\.css(?:\?[^"]*)?">\s*',
        lambda _match: f"<style>\n{latency_traces_css}\n</style>",
        run_html,
        count=1,
    )
    json_viewer_css = (dashboard_dir / "json_viewer.css").read_text(encoding="utf-8")
    run_html = re.sub(
        r'\s*<link\s+rel="stylesheet"\s+href="/static/json_viewer\.css(?:\?[^"]*)?">\s*',
        lambda _match: f"<style>\n{json_viewer_css}\n</style>",
        run_html,
        count=1,
    )
    run_html = re.sub(
        r'\s*<link\s+rel="stylesheet"\s+href="/static/run_versioning_details\.css(?:\?[^"]*)?">\s*',
        lambda _match: f"<style>\n{versioning_details_css}\n</style>",
        run_html,
        count=1,
    )

    # Inline the shared escaping/text layer first: every other script uses it.
    run_html = re.sub(
        r'\s*<script\s+src="/static/qym_safe\.js(?:\?[^"]*)?"></script>\s*',
        lambda _match: f"<script>\n{safe_js}\n</script>",
        run_html,
        count=1,
    )

    # Inline metrics.js
    run_html = re.sub(
        r'\s*<script\s+src="/static/metrics\.js(?:\?[^"]*)?"></script>\s*',
        lambda _match: f"<script>\n{metrics_js}\n</script>",
        run_html,
        count=1,
    )
    run_html = re.sub(
        r'\s*<script\s+defer\s+src="/static/ui_components\.js(?:\?[^"]*)?"></script>\s*',
        lambda _match: f"<script>\n{ui_components_js}\n</script>",
        run_html,
        count=1,
    )

    trace_viewer_path = dashboard_dir / "trace_viewer.js"
    if trace_viewer_path.exists():
        trace_viewer_js = trace_viewer_path.read_text(encoding="utf-8")
        run_html = re.sub(
            r'\s*<script\s+src="/static/trace_viewer\.js(?:\?[^"]*)?"></script>\s*',
            lambda _match: f"<script>\n{trace_viewer_js}\n</script>",
            run_html,
            count=1,
        )

    # The run page's own helpers (failure reasons, sticky section nav, the
    # Response time charts of Latency and traces, the versioning details) work
    # offline, so the export keeps them.
    for page_script in (
        "item_reasons.js",
        "run_section_nav.js",
        "latency_traces.js",
        "json_viewer.js",
        "run_versioning_details.js",
    ):
        page_script_js = (dashboard_dir / page_script).read_text(encoding="utf-8")
        run_html = re.sub(
            r'\s*<script\s+src="/static/'
            + re.escape(page_script)
            + r'(?:\?[^"]*)?"></script>\s*',
            lambda _match, source=page_script_js: f"<script>\n{source}\n</script>",
            run_html,
            count=1,
        )

    # Remove browser/session-only scripts that are not needed in standalone export.
    run_html = re.sub(
        r'\s*<script\s+src="/static/auth\.js(?:\?[^"]*)?"></script>\s*', "\n", run_html
    )
    run_html = re.sub(
        r'\s*<script\s+src="/static/shell\.js(?:\?[^"]*)?"></script>\s*', "\n", run_html
    )
    run_html = re.sub(
        r'\s*<script\s+src="/static/playground\.js(?:\?[^"]*)?"></script>\s*',
        "\n",
        run_html,
    )

    # Export embeds full rows and needs no network hydration helper.
    run_html = re.sub(
        r'\s*<script\s+(?:defer\s+)?src="/static/run_details\.js(?:\?[^"]*)?"></script>\s*',
        "\n", run_html,
    )
    # The Experiment panel (#26) links into the platform; exports leave it out.
    # Review history and step latency load from the API, which an offline file
    # cannot reach; run.html skips both sections in exports (IS_EXPORT). Any
    # other script still pointing at /static/ would only fail to load offline.
    run_html = re.sub(
        r'\s*<script\s+(?:defer\s+)?src="/static/[^"]+"></script>\s*',
        "\n",
        run_html,
    )

    # Remove favicon (would be a broken link)
    run_html = re.sub(
        r'\s*<link\s+rel="icon"\s+type="image/png"\s+href="/static/qym_icon\.png(?:\?[^"]*)?">\s*',
        "\n",
        run_html,
        count=1,
    )

    # Serialize data. Escape every "<" (JSON has none outside strings) so stored
    # text can neither close this script ("</script>") nor switch the parser
    # into a comment state that swallows it ("<!--<script>").
    data_json = json.dumps(data, ensure_ascii=False, default=str)
    data_json = data_json.replace("<", "\\u003c")

    # Inject export flag + data before the main inline <script> block
    export_script = (
        "<script>\n"
        "window.__QYM_EXPORT__ = true;\n"
        f"window.__QYM_EXPORT_DATA__ = {data_json};\n"
        "</script>\n"
    )
    # Insert just before the main <script> that starts the app
    run_html = run_html.replace(
        "  <script>\n    (() => {",
        f"{export_script}  <script>\n    (() => {{",
        1,
    )
    return run_html


def run_export_filename(data: Dict[str, Any], fallback: str) -> str:
    run_name = data["run"].get("run_name", fallback)
    safe_name = re.sub(r"[^\w\-.]", "_", str(run_name))[:80]
    return f"qym-run-{safe_name}.html"


_COMPARE_STYLE = """
:root { color-scheme: dark; --bg: #0f1115; --panel: #171a21; --line: #2a2f3a; --text: #e6e8ee; --muted: #9aa3b2; --accent: #7aa2ff; --good: #4ade80; --bad: #f87171; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, sans-serif; display: flex; flex-direction: column; min-height: 100vh; }
header { padding: 16px 20px 8px; }
h1 { margin: 0 0 4px; font-size: 18px; }
h2 { margin: 16px 20px 4px; font-size: 15px; }
.muted { color: var(--muted); }
p.muted { margin: 0 20px 6px; }
.cmp { padding-bottom: 20px; }
.cmp table { display: block; overflow-x: auto; max-width: calc(100% - 40px); }
table { border-collapse: collapse; margin: 8px 20px 12px; background: var(--panel); }
th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
td.preview { max-width: 38ch; overflow-wrap: anywhere; }
.delta[data-verdict=improved] { color: var(--good); }
.delta[data-verdict=regressed] { color: var(--bad); }
.pill[data-state=pass] { color: var(--good); }
.pill[data-state=fail] { color: var(--bad); }
.pill[data-state=error] { color: #fbbf24; }
.strip { display: flex; gap: 16px; flex-wrap: wrap; list-style: none; margin: 4px 20px 8px; padding: 0; }
[role=tablist] { display: flex; gap: 4px; padding: 0 20px; flex-wrap: wrap; }
[role=tab] { background: var(--panel); color: var(--muted); border: 1px solid var(--line); border-bottom: 0; padding: 6px 12px; border-radius: 6px 6px 0 0; cursor: pointer; font: inherit; }
[role=tab][aria-selected=true] { color: var(--text); border-color: var(--accent); }
iframe { flex: 1; width: 100%; min-height: 70vh; border: 0; border-top: 1px solid var(--line); background: var(--bg); }
[role=tabpanel][hidden] { display: none; }
"""

_COMPARE_SCRIPT = """
(function () {
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role=tab]'));
  var frames = Array.prototype.slice.call(document.querySelectorAll('[role=tabpanel]'));
  function select(i) {
    tabs.forEach(function (t, j) { t.setAttribute('aria-selected', String(i === j)); t.tabIndex = i === j ? 0 : -1; });
    frames.forEach(function (f, j) { f.hidden = i !== j; });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { select(i); });
    t.addEventListener('keydown', function (e) {
      var n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
      if (n >= 0 && n < tabs.length) { select(n); tabs[n].focus(); }
    });
  });
  select(0);
})();
"""


def _label(data: Dict[str, Any], index: int) -> str:
    run = data.get("run") or {}
    return str(run.get("run_name") or run.get("run_id") or f"run {index + 1}")


def build_compare_export_html(payloads: Sequence[Dict[str, Any]]) -> str:
    """One offline document for several runs: a Comparison tab, then a tab per run.

    The Comparison tab carries what the Compare page shows: per-run averages with
    deltas against the baseline (95% band, p-value), the winner / stat strip and the
    aligned item-level diff (``services/compare_export.py``). Each run tab is that run's
    own self-contained export (``build_run_export_html``) inside a ``srcdoc`` frame, so
    the runs' scripts and styles cannot collide and nothing in a stored value can reach
    the outer page.
    """
    esc = html_lib.escape
    comparison = build_comparison(payloads)
    tabs: List[str] = [
        '<button role="tab" type="button" aria-selected="true" aria-controls="comparison" id="tab-comparison">Comparison</button>'
    ]
    frames: List[str] = [
        '<div id="comparison" role="tabpanel" aria-labelledby="tab-comparison">'
        + render_comparison_html(comparison)
        + "</div>"
    ]
    for index, data in enumerate(payloads):
        label = _label(data, index)
        letter = chr(ord("A") + index) if index < 26 else str(index + 1)
        tabs.append(
            f'<button role="tab" type="button" aria-selected="false" aria-controls="run-{index}" id="tab-{index}">'
            f"{esc(letter)} · {esc(label)}</button>"
        )
        frames.append(
            f'<iframe id="run-{index}" role="tabpanel" aria-labelledby="tab-{index}" title="{esc(label, quote=True)}" '
            f'sandbox="allow-scripts allow-same-origin allow-modals allow-downloads" '
            f'srcdoc="{esc(build_run_export_html(data), quote=True)}"></iframe>'
        )
    summary = json.dumps([_label(d, i) for i, d in enumerate(payloads)], ensure_ascii=False).replace("<", "\\u003c")
    return (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        "<title>qym comparison</title>\n"
        f"<style>{_COMPARE_STYLE}</style>\n</head>\n<body>\n"
        "<header><h1>Run comparison</h1>"
        f"<div class=\"muted\">{len(payloads)} runs. The Comparison tab summarises them; each other tab is that run's full offline report.</div></header>\n"
        f"<div role=\"tablist\" aria-label=\"Runs\">{''.join(tabs)}</div>\n"
        + "\n".join(frames)
        + f"\n<script>window.__QYM_COMPARE_EXPORT_RUNS__ = {summary};{_COMPARE_SCRIPT}</script>\n</body>\n</html>\n"
    )
