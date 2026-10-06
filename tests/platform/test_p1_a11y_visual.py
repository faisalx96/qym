"""Static and API contracts for the P1 accessibility and visual fixes.

- C046: the mono token reaches a real system mono on macOS Chrome (Menlo),
  not Courier.
- C053: one text-direction policy (QymSafe.isRTL / textDirAttrs) shared by
  every page; the Arabic leading wins over page rules.
- C049: no page closes a modal by hiding it inline, and the confirm dialog
  has no document-level Enter that confirms from a focused Cancel.
- C038: Compare names the requested runs the server could not return.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / "packages/platform/qym_platform/_static"
DASHBOARD = STATIC / "dashboard"
for src in (ROOT / "packages" / "platform", ROOT / "packages" / "sdk"):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))


def _read(name: str) -> str:
    return (DASHBOARD / name).read_text(encoding="utf-8")


# ── C046 ─────────────────────────────────────────────────────────────────────

def _families(stack: str) -> list[str]:
    return [part.strip().strip("'\"") for part in stack.split(",")]


def test_mono_token_reaches_menlo_before_the_generic_fallback() -> None:
    css = _read("dashboard.css")
    match = re.search(r"--font-mono:\s*([^;]+);", css)
    assert match, "dashboard.css lost --font-mono"
    families = _families(match.group(1))
    assert families[0] == "Qym Arabic"
    assert families[-1] == "monospace"
    # Safari resolves ui-monospace / SFMono-Regular; Chrome on macOS only sees
    # Menlo. Without Menlo the generic 'monospace' is Courier.
    for family in ("ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono"):
        assert family in families, family
    assert families.index("Menlo") < families.index("monospace")


def test_no_literal_mono_stack_falls_back_to_courier() -> None:
    """Every hardcoded mono stack also names Menlo (the token is preferred)."""
    stacks = re.compile(r"font-family:\s*([^;{}\"`]*?monospace)\s*[;}\"]")
    problems = []
    for path in list(DASHBOARD.glob("*.css")) + list(DASHBOARD.glob("*.html")) + [STATIC / "ui" / "app.css"]:
        for match in stacks.finditer(path.read_text(encoding="utf-8")):
            stack = match.group(1)
            if "var(--font-mono" in stack:
                continue
            if "Menlo" not in stack:
                problems.append(f"{path.name}: {stack}")
    assert not problems, problems


# ── C053 ─────────────────────────────────────────────────────────────────────

def _node(script: str) -> str:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required for the shared text-direction contract")
    source = "global.window = global;\n" + _read("qym_safe.js") + "\n" + script
    result = subprocess.run([node, "-e", source], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def test_text_direction_policy_marks_arabic_and_auto_detects_the_rest() -> None:
    out = _node(
        """
        const Q = window.QymSafe;
        const lines = [
          Q.isRTL('ما هي أكبر مدينة؟'),
          Q.isRTL('SELECT name FROM cities -- المدن'),
          Q.textDirAttrs('ما هي أكبر مدينة؟'),
          Q.textDirAttrs('Hello'),
          Q.textBlock('ما هي أكبر مدينة؟', { mode: 'raw' }),
          Q.textBlock('Hello', { mode: 'raw', dir: 'rtl' }),
        ];
        console.log(JSON.stringify(lines));
        """
    )
    assert out == (
        '[true,false," dir=\\"rtl\\" lang=\\"ar\\""," dir=\\"auto\\"",'
        '"<div class=\\"qym-text qym-text--prose\\" data-qym-text-mode=\\"raw\\" dir=\\"rtl\\" lang=\\"ar\\">ما هي أكبر مدينة؟</div>",'
        '"<div class=\\"qym-text qym-text--prose\\" data-qym-text-mode=\\"raw\\" dir=\\"rtl\\" lang=\\"ar\\">Hello</div>"]'
    )


def test_pages_share_one_direction_policy() -> None:
    arabic_ranges = re.compile(r"\\u0600-\\u06FF\\u0750-\\u077F")
    # One detector: run and compare delegate; nobody else re-implements it.
    for name in ("run.html", "compare.html", "reviews.html", "datasets.html", "trace_viewer.js", "playground.js"):
        source = _read(name)
        assert "QymSafe." in source
        assert not arabic_ranges.search(source) or name == "trace_viewer.js", name
    for name in ("run.html", "compare.html"):
        assert "return QymSafe.isRTL(text);" in _read(name)
    reviews = _read("reviews.html")
    assert "${QymSafe.textDirAttrs(display)}" in reviews
    assert "QymSafe.textDirAttrs(text)" in reviews
    trace = _read("trace_viewer.js")
    assert "cm.view.EditorView.perLineTextDirection.of(true)" in trace
    assert trace.count("${dirAttrs(") >= 8
    assert "_dirAttrs(text)" in _read("playground.js")
    datasets = _read("datasets.html")
    rule = re.search(r"\.dsx-code-hl, \.dsx-code-input, [^{]*\{([^}]*)\}", datasets)
    assert rule and "unicode-bidi: plaintext" in rule.group(1) and "text-align: start" in rule.group(1)
    assert "QymSafe.applyTextDir(preview" in datasets
    for name in ("run.html", "compare.html"):
        source = _read(name)
        assert "QymSafe.textDirAttrs(titleText)" in source
        table = re.search(r"\.formatted-table-cell \.meta-table \{([^}]*)\}", source)
        assert table and "font-size: var(--font-sm)" in table.group(1), name
        assert 'lang="ar" style="text-align:right;display:block;"' in source


def test_arabic_leading_outranks_page_line_heights() -> None:
    css = _read("dashboard.css")
    assert re.search(
        r'\[dir="rtl"\],\s*\[dir="rtl"\]\[lang="ar"\]:not\(#qym-rtl-leading\)\s*\{\s*line-height: 1\.7;',
        css,
    )


# ── C049 ─────────────────────────────────────────────────────────────────────

def test_no_modal_is_closed_by_an_inline_display_toggle() -> None:
    inline = re.compile(r"""onclick="document\.getElementById\('[\w-]*modal[\w-]*'\)\.style\.display='none'""")
    offenders = [p.name for p in DASHBOARD.glob("*.html") if inline.search(p.read_text(encoding="utf-8"))]
    assert offenders == []


def test_dialogs_use_the_shared_focus_contract() -> None:
    shell = _read("shell.js")
    assert "e.key === 'Enter' && (!input || document.activeElement === input)" not in shell
    assert "initialFocus: input || (destructive ? cancelBtn : confirmBtn)" in shell
    assert shell.count("manageDialog(") >= 5
    components = _read("ui_components.js")
    for contract in (
        "openDialog: openDialog",
        "releaseDialog: releaseDialog",
        "renderErrorState: renderErrorState",
        "classifyError: classifyError",
        "document.addEventListener('focusin'",
    ):
        assert contract in components, contract
    for name in ("datasets.html", "project_settings.html", "reviews.html", "admin.html", "compare.html", "run.html", "dashboard.js", "trace_viewer.js"):
        assert re.search(r"openDialog(\?\.)?\(", _read(name)), name
    # Body-mounted editors on run and compare use the contract too: the
    # compare root-cause issue editor (Escape closes it) and the run page's
    # diagnosis category picker.
    compare = _read("compare.html")
    editor = compare[compare.index("function showRootCauseIssuesEditor("):]
    editor = editor[:editor.index("\n      }\n")]
    assert "openDialog(editorPanel" in editor and "onEscape: cleanup" in editor
    assert "releaseDialog(editorPanel)" in editor
    run = _read("run.html")
    picker = run[run.index("function showRootCauseCategoryPicker("):]
    picker = picker[:picker.index("\n      }\n")]
    assert "openDialog(panel, { initialFocus: searchInput })" in picker
    assert "releaseDialog(panel)" in picker
    assert ".tv-shell" in _read("dashboard.css")
    trace = _read("trace_viewer.js")
    assert 'el.setAttribute("inert", "");' in trace
    assert '<aside class="tv-drawer" role="dialog" aria-label="Trace viewer" tabindex="-1">' in trace


# ── C038: Compare API ────────────────────────────────────────────────────────

@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    if "openai" not in sys.modules:
        sys.modules["openai"] = MagicMock()
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from qym_platform.app import create_app
    from qym_platform.db.base import Base
    from qym_platform.db.models import Project, ProjectMembership, ProjectRole, Run, RunWorkflowStatus, User, UserRole
    from qym_platform.deps import get_db

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as db:
        db.add_all([
            User(id="mgr", email="mgr@x.com", role=UserRole.MEMBER),
            User(id="outsider", email="outsider@x.com", role=UserRole.MEMBER),
            Project(id="pa", name="A", slug="pa", created_by_user_id="mgr", is_active=True),
        ])
        db.flush()
        db.add(ProjectMembership(project_id="pa", user_id="mgr", role=ProjectRole.MANAGER))
        for run_id in ("r1", "r2"):
            db.add(Run(
                id=run_id, project_id="pa", created_by_user_id="mgr", owner_user_id="mgr", task="t",
                dataset="d", metrics=["m"], run_metadata={}, run_config={"run_name": run_id},
                status=RunWorkflowStatus.COMPLETED,
            ))
        db.commit()
    app = create_app()

    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    engine.dispose()


def _headers(email: str) -> dict:
    return {"X-User-Email": email, "Origin": "http://localhost:8000"}


def test_compare_lists_requested_runs_it_could_not_return(client) -> None:
    data = client.get("/api/compare?files=r1&files=gone&files=r2", headers=_headers("mgr@x.com")).json()
    assert [run["run"]["run_id"] for run in data["runs"]] == ["r1", "r2"]
    assert data["missing_runs"] == [{"run_id": "gone"}]

    hidden = client.get("/api/compare?files=r1&files=r2", headers=_headers("outsider@x.com")).json()
    assert hidden["runs"] == []
    assert hidden["missing_runs"] == [{"run_id": "r1"}, {"run_id": "r2"}]
