"""Regression tests for the P1 final review fixes (API, services, static).

Each test names the finding it covers. Browser checks for the run page live in
test_p1_final_fixes_browser.py.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import event, update

from qym_platform.db.models import (
    AuditLog,
    CorrectionStatus,
    Dataset,
    DatasetItem,
    DatasetVersion,
    Project,
    ReviewCorrection,
    Run,
    RunItem,
    RunItemPassScore,
    RunItemScore,
    User,
    UserRole,
)

from test_review_rules import (  # noqa: F401  (fixtures)
    ADMIN,
    MANAGER,
    MEMBER,
    OUTSIDER,
    OWNER,
    _correction,
    _ok,
    _rules,
    _run,
    _ui,
    client,
    session_factory,
)

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = ROOT / "packages/platform/qym_platform/_static/dashboard"


def _read(name: str) -> str:
    return (DASHBOARD / name).read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Static page fixes
# ---------------------------------------------------------------------------


def test_project_settings_document_listeners_end_with_the_page():
    """C067/C043: the member-picker click listener used to outlive Settings."""
    source = _read("project_settings.html")
    for match in re.finditer(r"(document|window)\.addEventListener\('([a-zA-Z]+)'", source):
        if match.group(2) == "DOMContentLoaded":
            continue
        # The listener's own options argument closes the call.
        depth, i = 0, match.end()
        while i < len(source):
            char = source[i]
            if char == "(":
                depth += 1
            elif char == ")":
                if depth == 0:
                    break
                depth -= 1
            i += 1
        call = source[match.start() : i + 1]
        assert "pageListen(" in call, call[:160]
    body = source[source.index("function closeMemberResults()") :][:400]
    assert "if (!input || !results) return;" in body


def test_help_modal_escape_fallback_releases_the_dialog():
    """C049/C071: the leftover Escape branch hid the modal without releaseDialog."""
    source = _read("dashboard.js")
    assert "el('help-modal').style.display = 'none'" not in source
    branch = source[source.index("el('help-modal')?.style.display === 'flex'") :][:200]
    assert "hideLegacyModal(el('help-modal'))" in branch


def test_time_range_popover_outranks_the_shared_dropdown_anatomy():
    """C054: same-specificity rule in the later stylesheet dropped the padding."""
    css = _read("dashboard.css")
    rule = re.search(r"\n([^\n{}]*time-range-dropdown[^\n{}]*)\{([^}]*)\}", css)
    assert rule, "time-range dropdown rule missing"
    selector, body = rule.group(1).strip(), rule.group(2)
    assert selector == ".multi-select-dropdown.time-range-dropdown"
    assert "padding: var(--space-md)" in body and "min-width: 260px" in body


def test_transfer_picker_leaves_out_disabled_members(client, session_factory):
    """C072/C067: a disabled member was offered and then refused by the server."""
    with session_factory() as db:
        db.get(User, "member-1").is_active = False
        db.commit()
    members = _ok(client.get("/v1/projects/project-1/members", headers=_ui(MANAGER)))["members"]
    by_id = {m["user_id"]: m for m in members}
    assert by_id["member-1"]["is_active"] is False
    assert by_id["owner-1"]["is_active"] is True
    source = _read("dashboard.js")
    picker = source[source.index("async function showTransferOwnershipModal") :][:2400]
    assert "m.is_active !== false" in picker


def test_dataset_compare_tab_switch_drops_responses_in_flight():
    """C181/C321: a slow response for another tab overwrote the chosen tab."""
    source = _read("datasets.html")
    handler = source[source.index("navigate({ cmpTab: k }, { replace: true, silent: true });") :][:400]
    assert "++loadSeq;" in handler
    assert handler.index("++loadSeq;") < handler.index("renderList(k, true)")
    assert "if (seq !== loadSeq || kind !== state.cmpTab || !listEl.isConnected) return;" in source


def test_analyzer_requests_samples_only_for_repeat_runs():
    """C027: /passes was fetched (and its server work paid) for every run."""
    source = _read("analyzer.html")
    start = source.index("'?view=summary'")
    loader = source[start - 600 : start + 2400]
    assert "Promise.all" not in loader
    condition = loader.index("if (sampleCount > 1 || data.run.metadata?.has_repeat_pass_context) {")
    assert loader.index("+ '/passes'") > condition


# ---------------------------------------------------------------------------
# C074: author delete of a decided correction, run-page issue_index bypass
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "rules",
    [
        {"correction_approvers": "managers"},
        {"correction_require_different_reviewer": True},
    ],
)
def test_author_cannot_delete_a_decided_correction_under_strict_rules(client, session_factory, rules):
    with session_factory() as db:
        _run(db, "r1")
        approved = _correction(db, author="member-1", status=CorrectionStatus.APPROVED, reviewer="manager-1")
        rejected = _correction(db, author="member-1", status=CorrectionStatus.REJECTED, reviewer="manager-1")
        pending = _correction(db, author="member-1")
    _ok(_rules(client, **rules))
    single = client.delete(f"/api/corrections/{approved}", headers=_ui(MEMBER))
    assert single.status_code == 403, single.text
    bulk = client.post(
        "/api/corrections/bulk",
        json={"ids": [rejected], "action": "delete"},
        headers=_ui(MEMBER),
    )
    assert bulk.status_code == 403, bulk.text
    with session_factory() as db:
        row = db.get(ReviewCorrection, approved)
        assert (row.status, row.is_active, row.reviewed_by_user_id) == (
            CorrectionStatus.APPROVED,
            True,
            "manager-1",
        )
        assert db.get(ReviewCorrection, rejected).is_active is True
    # Withdrawing their own unreviewed work stays allowed.
    _ok(client.delete(f"/api/corrections/{pending}", headers=_ui(MEMBER)))


def test_author_delete_of_a_decided_correction_is_unchanged_on_default_rules(client, session_factory):
    with session_factory() as db:
        _run(db, "r1")
        approved = _correction(db, author="member-1", status=CorrectionStatus.APPROVED, reviewer="manager-1")
    _ok(client.delete(f"/api/corrections/{approved}", headers=_ui(MEMBER)))


def test_issue_approval_by_index_follows_the_different_reviewer_rule(client, session_factory):
    with session_factory() as db:
        _run(db, "r1")
    _ok(_rules(client, correction_require_different_reviewer=True))
    issue = {"category": "Retrieval miss", "finding": "owner wrote this"}
    issue_id = str(uuid.uuid4())
    base = {"run_id": "r1", "item_id": "item-1", "metric_name": "accuracy"}
    _ok(
        client.post(
            "/api/runs/update_root_cause_issue",
            json={**base, "action": "add", "client_issue_id": issue_id, "issue": issue},
            headers=_ui(OWNER),
        )
    )
    by_index = client.post(
        "/api/runs/update_root_cause_issue",
        json={**base, "action": "approve", "issue_id": None, "issue_index": 0, "expected_issue": issue},
        headers=_ui(OWNER),
    )
    assert by_index.status_code == 403, by_index.text
    assert "different reviewer" in by_index.json()["detail"]
    with session_factory() as db:
        assert {row.status for row in db.query(ReviewCorrection)} == {CorrectionStatus.PENDING}
    # Another member may approve it by index.
    _ok(
        client.post(
            "/api/runs/update_root_cause_issue",
            json={**base, "action": "approve", "issue_id": None, "issue_index": 0, "expected_issue": issue},
            headers=_ui(MEMBER),
        )
    )


# ---------------------------------------------------------------------------
# C042/C074: bulk decisions return the decided rows
# ---------------------------------------------------------------------------


def test_bulk_approve_returns_rows_with_reviewer_and_self_review(client, session_factory):
    with session_factory() as db:
        _run(db, "r1")
        _run(db, "r2")
        mine = _correction(db, author="member-1")
        theirs = _correction(db, run_id="r2", author="owner-1")
    body = _ok(
        client.post(
            "/api/corrections/bulk",
            json={"ids": [mine, theirs], "action": "approve", "comment": "ok"},
            headers=_ui(MEMBER),
        )
    )
    assert body["affected"] == 2
    rows = {row["id"]: row for row in body["corrections"]}
    assert set(rows) == {mine, theirs}
    for row in rows.values():
        assert row["status"] == "approved"
        assert row["reviewed_by"]["email"] == MEMBER
        assert "review_block" in row
    assert rows[mine]["self_reviewed"] is True
    assert rows[theirs]["self_reviewed"] is False
    source = _read("reviews.html")
    assert "applyBulkStatusUpdate(ids, 'approved', comment, result && result.corrections)" in source
    assert "summaryRow(c, { ...updated, status })" in source


# ---------------------------------------------------------------------------
# C061: bulk submit names a run only to someone who may see it
# ---------------------------------------------------------------------------


def test_bulk_submit_does_not_name_a_run_to_a_non_member(client, session_factory):
    with session_factory() as db:
        _run(db, "secret-run")
        run = db.get(Run, "secret-run")
        run.run_config = {"run_name": "Quarterly secret eval"}
        db.commit()
    outsider = client.post("/v1/runs/submit", json={"run_ids": ["secret-run"]}, headers=_ui(OUTSIDER))
    assert outsider.status_code == 403
    assert "Quarterly secret eval" not in outsider.text
    assert "secret-run" in outsider.json()["detail"]


# ---------------------------------------------------------------------------
# C067: the last-active-admin guard locks the admin rows
# ---------------------------------------------------------------------------


def test_last_admin_guard_locks_admin_rows_before_counting(client, session_factory, monkeypatch):
    from qym_platform.api import web

    calls = []
    real = web._other_active_admins_locked

    def spy(db, user_id):
        calls.append(user_id)
        return real(db, user_id)

    monkeypatch.setattr(web, "_other_active_admins_locked", spy)
    with session_factory() as db:
        db.add(User(id="admin-2", email="admin2@example.com", role=UserRole.ADMIN))
        db.commit()
    _ok(client.put("/v1/admin/users/admin-2", json={"is_active": False}, headers=_ui(ADMIN)))
    _ok(client.delete("/v1/admin/users/admin-2", headers=_ui(ADMIN)))
    assert calls == ["admin-2"]  # disabled first: the delete is not of an active admin
    with session_factory() as db:
        db.add(User(id="admin-3", email="admin3@example.com", role=UserRole.ADMIN))
        db.commit()
    _ok(client.delete("/v1/admin/users/admin-3", headers=_ui(ADMIN)))
    assert calls == ["admin-2", "admin-3"]
    statement = str(
        sa.select(User.id).where(User.role == UserRole.ADMIN).with_for_update().compile(
            dialect=sa.dialects.postgresql.dialect()
        )
    )
    assert "FOR UPDATE" in statement


# ---------------------------------------------------------------------------
# C067/C075: login throttle behind an untrusted proxy
# ---------------------------------------------------------------------------


def test_startup_warns_when_password_sign_in_trusts_no_proxy():
    from qym_platform.login_throttle import proxy_trust_warning
    from qym_platform.settings import PlatformSettings

    prod = PlatformSettings(auth_mode="proxy_headers", auth_local_enabled=True, environment="production")
    assert "FORWARDED_ALLOW_IPS" in proxy_trust_warning(prod, {})
    assert proxy_trust_warning(prod, {"FORWARDED_ALLOW_IPS": "10.0.0.0/8"}) is None
    assert proxy_trust_warning(prod, {"QYM_UVICORN_ARGS": "--proxy-headers --forwarded-allow-ips=*"}) is None
    dev = PlatformSettings(auth_mode="proxy_headers", auth_local_enabled=True, environment="dev")
    assert proxy_trust_warning(dev, {}) is None
    off = PlatformSettings(auth_mode="proxy_headers", auth_local_enabled=False, environment="production")
    assert proxy_trust_warning(off, {}) is None
    ops = (ROOT / "docs/internal/OPERATIONS.md").read_text(encoding="utf-8")
    assert "counted per API process" in ops and "FORWARDED_ALLOW_IPS" in ops
    assert "`0065` and a healthy API" not in ops
    assert "migrated to `0065`" not in ops


# ---------------------------------------------------------------------------
# C065/C027: reasons and one-sample views read only what they return
# ---------------------------------------------------------------------------


def _repeat_run(db, run_id="rep"):
    db.add(
        Run(
            id=run_id,
            project_id="project-1",
            created_by_user_id="owner-1",
            owner_user_id="owner-1",
            task="task",
            dataset="dataset",
            metrics=["accuracy", "judge"],
            run_metadata={},
            run_config={"run_name": run_id},
            samples=3,
            status="COMPLETED",
        )
    )
    db.flush()
    for index in range(4):
        item_id = f"item-{index}"
        db.add(RunItem(run_id=run_id, item_id=item_id, index=index, input={"q": index}, output="x" * 500, latency_ms=5, item_metadata={}))
        db.add(
            RunItemScore(
                run_id=run_id, item_id=item_id, metric_name="accuracy",
                score_numeric=0.5, score_raw=0.5,
                meta={"reason": f"run-level {index}", "pass_note": "kept"},
                label="run-label",
            )
        )
        for pass_number in (1, 2, 3):
            meta = {}
            if index % 2 == 0:
                meta = {"reason": f"pass {pass_number} reason {index}", "_qym_pass_analysis": {"x": 1}}
            if index == 3 and pass_number == 2:
                meta = {"status": "error", "error": "judge 429"}
            db.add(
                RunItemPassScore(
                    run_id=run_id, item_id=item_id, metric_name="accuracy",
                    pass_number=pass_number,
                    score_numeric=None if index == 1 and pass_number == 3 else float(pass_number % 2),
                    meta=meta,
                    label="L" if index == 2 else None,
                    explanation="E" if index == 0 and pass_number == 1 else None,
                )
            )
    db.commit()


def _single_run(db, run_id="single"):
    db.add(
        Run(
            id=run_id, project_id="project-1", created_by_user_id="owner-1", owner_user_id="owner-1",
            task="task", dataset="dataset", metrics=["accuracy"], run_metadata={},
            run_config={"run_name": run_id}, samples=1, status="COMPLETED",
        )
    )
    db.flush()
    for index, meta in enumerate([{"reason": "r"}, {}, None, {"explanation": "why"}]):
        db.add(RunItem(run_id=run_id, item_id=f"s-{index}", index=index, input={}, output="o", latency_ms=1, item_metadata={}))
        db.add(
            RunItemScore(
                run_id=run_id, item_id=f"s-{index}", metric_name="accuracy",
                score_numeric=0.0, score_raw=0.0, meta=meta,
                label="lbl" if index == 1 else None,
                explanation="exp" if index == 2 else None,
            )
        )
    db.commit()


def _oracle_reasons(db, run_id, ids, metric, pass_number):
    """The previous implementation: the full row build, then pick the meta."""
    from qym_platform.api.runs import _build_run_data
    from qym_platform.services.run_payloads import reason_fields

    data = _build_run_data(db, db.get(Run, run_id), item_ids=ids)
    reasons = {}
    for row in data["snapshot"]["rows"]:
        meta = (row.get("metric_meta") or {}).get(metric)
        metas = (row.get("pass_metric_meta") or {}).get(metric)
        if pass_number is not None and isinstance(metas, list):
            meta = metas[pass_number - 1] if len(metas) >= pass_number else None
        reasons[row["item_id"]] = reason_fields(meta)
    return reasons


@pytest.mark.parametrize("pass_number", [None, 1, 2, 3, 4])
@pytest.mark.parametrize("metric", ["accuracy", "judge", "unknown"])
def test_item_reasons_match_the_row_build_without_building_rows(client, session_factory, monkeypatch, pass_number, metric):
    from qym_platform.api import runs as runs_api

    with session_factory() as db:
        _repeat_run(db)
        _single_run(db)
    original = runs_api._build_run_data

    def forbidden(*args, **kwargs):
        raise AssertionError("reasons must not build full rows")

    for run_id, ids in (("rep", ["item-0", "item-1", "item-2", "item-3", "missing"]), ("single", ["s-0", "s-1", "s-2", "s-3"])):
        with session_factory() as db:
            monkeypatch.setattr(runs_api, "_build_run_data", original)
            expected = _oracle_reasons(db, run_id, ids, metric, pass_number)
        monkeypatch.setattr(runs_api, "_build_run_data", forbidden)
        payload = {"item_ids": ids, "metric": metric}
        if pass_number is not None:
            payload["pass_number"] = pass_number
        body = _ok(client.post(f"/api/runs/{run_id}/items/reasons", json=payload, headers=_ui(OWNER)))
        assert body["reasons"] == expected, (run_id, metric, pass_number)
        monkeypatch.setattr(runs_api, "_build_run_data", original)


@pytest.mark.parametrize("pass_number", [1, 2, 3])
def test_one_sample_view_matches_full_build_scoped_and_loads_one_pass(client, session_factory, pass_number):
    from qym_platform.api.runs import _build_run_data
    from qym_platform.services.run_payloads import scope_row_to_pass

    with session_factory() as db:
        _repeat_run(db)
        expected = _build_run_data(db, db.get(Run, "rep"), compact=True)
    expected_rows = [scope_row_to_pass(row, pass_number) for row in expected["snapshot"]["rows"]]
    engine = None
    with session_factory() as db:
        engine = db.get_bind()
    statements = []

    def capture(conn, cursor, statement, params, context, executemany):
        statements.append((statement, params))

    event.listen(engine, "before_cursor_execute", capture)
    try:
        body = _ok(
            client.get(f"/api/runs/rep?view=compact&pass_number={pass_number}", headers=_ui(OWNER))
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert body["snapshot"]["rows"] == expected_rows
    assert body["snapshot"]["pass_number"] == pass_number
    # Attempt outputs are read for the shown pass only (the state query reads
    # none; this run has no attempt rows, so no output read happens at all).
    attempt_reads = [
        statement
        for statement, _ in statements
        if "FROM run_item_attempts" in statement and "run_item_attempts.output" in statement
    ]
    for statement in attempt_reads:
        assert "pass_number =" in statement or "CASE WHEN" in statement, statement


# ---------------------------------------------------------------------------
# C031/C033: dataset backfill, legacy search, lineage, compare, catalog
# ---------------------------------------------------------------------------


@pytest.fixture()
def maint_db():
    from sqlalchemy.orm import sessionmaker

    from qym_platform.db.base import Base

    engine = sa.create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=sa.pool.StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        db.add(User(id="u", email="u@x.com"))
        db.add(Project(id="p", name="P", slug="p", created_by_user_id="u"))
        db.add(Dataset(id="d", project_id="p", name="D", slug="d", created_by_user_id="u"))
        db.commit()
    yield engine, factory
    engine.dispose()


def test_backfill_finishes_with_more_than_one_batch_of_versions(maint_db):
    """Detached version after commit failed the job at 20+ versions."""
    from qym_platform.services import maintenance

    engine, factory = maint_db
    with factory() as db:
        parent = None
        for n in range(26):
            # A few drafts (and their children) can never store counts and
            # are selected again by every run of the job.
            status = "draft" if n % 5 == 0 else "published"
            db.add(DatasetVersion(id=f"v{n:02d}", dataset_id="d", version=f"v{n}", status=status, parent_version_id=parent, created_by_user_id="u"))
            db.flush()
            db.add(DatasetItem(dataset_version_id=f"v{n:02d}", item_id="a", index=0, input=f"text {n}", fingerprint=str(n)))
            parent = f"v{n:02d}"
        db.commit()
        db.execute(update(DatasetItem).values(search_text=None))
        db.commit()
        maintenance.enqueue(db, "backfill_dataset_search_text", {})
        db.commit()
    worker = maintenance.MaintenanceWorker(factory, engine)
    assert worker.tick() == "succeeded"
    with factory() as db:
        assert db.query(DatasetItem).filter(DatasetItem.search_text.is_(None)).count() == 0
        counted = db.query(DatasetVersion).filter(DatasetVersion.change_counts.isnot(None)).count()
    assert counted > 0


def test_backfill_writes_a_window_in_one_statement(maint_db):
    from qym_platform.services import maintenance

    engine, factory = maint_db
    with factory() as db:
        db.add(DatasetVersion(id="v1", dataset_id="d", version="v1", status="published", created_by_user_id="u"))
        db.flush()
        for n in range(30):
            db.add(DatasetItem(dataset_version_id="v1", item_id=f"i{n}", index=n, input=f"t{n}", fingerprint=str(n)))
        db.commit()
        db.execute(update(DatasetItem).values(search_text=None))
        db.commit()
        maintenance.enqueue(db, "backfill_dataset_search_text", {"window": 50})
        db.commit()
    updates = []

    def capture(conn, cursor, statement, params, context, executemany):
        if statement.lstrip().upper().startswith("UPDATE DATASET_ITEMS"):
            updates.append(executemany)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        assert maintenance.MaintenanceWorker(factory, engine).tick() == "succeeded"
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert updates == [True]  # one executemany for the 30-row window


@pytest.mark.parametrize(
    "needle",
    ['"refund', "null", 'said "hi"', 'said \\"hi', "{}", "refund policy"],
)
def test_search_matches_the_same_before_and_after_the_backfill(maint_db, needle):
    from qym_platform.services.dataset_search import filter_dataset_item_search

    _, factory = maint_db
    with factory() as db:
        db.add(DatasetVersion(id="v1", dataset_id="d", version="v1", status="published", created_by_user_id="u"))
        db.flush()
        bodies = [
            ("refund policy", None, None),
            ('she said "hi"', {"answer": "ok"}, {"tag": "x"}),
            ("plain", "null", None),
        ]
        for pair in ("a", "b"):
            for n, (value, expected, metadata) in enumerate(bodies):
                db.add(DatasetItem(dataset_version_id="v1", item_id=f"{pair}{n}", index=n, input=value, expected_output=expected, item_metadata=metadata, fingerprint=f"{pair}{n}"))
        db.commit()
        # The "a" items predate migration 0068.
        db.execute(update(DatasetItem).where(DatasetItem.item_id.like("a%")).values(search_text=None))
        db.commit()
        query = db.query(DatasetItem).filter(DatasetItem.dataset_version_id == "v1")
        found = {item.item_id for item in filter_dataset_item_search(db, query, needle, version_id="v1")}
    legacy = {item_id[1:] for item_id in found if item_id.startswith("a")}
    stored = {item_id[1:] for item_id in found if item_id.startswith("b")}
    assert legacy == stored, (needle, sorted(found))


def test_lineage_counts_follow_the_compare_rule_and_load_no_bodies(maint_db):
    from qym_platform.services.dataset_versions import compute_change_counts

    engine, factory = maint_db
    with factory() as db:
        db.add(DatasetVersion(id="v1", dataset_id="d", version="v1", status="published", created_by_user_id="u"))
        db.add(DatasetVersion(id="v2", dataset_id="d", version="v2", status="draft", parent_version_id="v1", created_by_user_id="u"))
        db.flush()
        # Whitespace-only and mutable-metadata-only edits keep the fingerprint:
        # Compare lists them as unchanged, so Lineage must too.
        db.add(DatasetItem(dataset_version_id="v1", item_id="a", index=0, input="x", item_metadata={"root_cause": "old"}, fingerprint="fa"))
        db.add(DatasetItem(dataset_version_id="v2", item_id="a", index=0, input="x ", item_metadata={"root_cause": "new"}, fingerprint="fa"))
        db.add(DatasetItem(dataset_version_id="v1", item_id="b", index=1, input="y", fingerprint="fb"))
        db.add(DatasetItem(dataset_version_id="v2", item_id="b", index=1, input="z", fingerprint="fb2"))
        db.commit()
    statements = []
    event.listen(engine, "before_cursor_execute", lambda *a: statements.append(a[2]))
    with factory() as db:
        counts = compute_change_counts(db, db.get(DatasetVersion, "v2"))
    assert counts == {"added": 0, "modified": 1, "deleted": 0, "unchanged": 1}
    reads = [s for s in statements if "FROM dataset_items" in s]
    assert reads and not any("dataset_items.input" in s for s in reads)


def test_item_edits_no_longer_run_an_empty_child_counts_update():
    source = (ROOT / "packages/platform/qym_platform/api/datasets.py").read_text(encoding="utf-8")
    assert "invalidate_child_counts" not in source


def _compare_env(maint_db, n_changed=3, n_unchanged=4):
    engine, factory = maint_db
    with factory() as db:
        db.add(DatasetVersion(id="v1", dataset_id="d", version="v1", status="published", created_by_user_id="u"))
        db.add(DatasetVersion(id="v2", dataset_id="d", version="v2", status="published", parent_version_id="v1", created_by_user_id="u"))
        db.flush()
        index = 0
        for n in range(n_changed):
            db.add(DatasetItem(dataset_version_id="v1", item_id=f"c{n}", index=index, input="old", fingerprint=f"c{n}-old"))
            db.add(DatasetItem(dataset_version_id="v2", item_id=f"c{n}", index=index, input="new", fingerprint=f"c{n}-new"))
            index += 1
        for n in range(n_unchanged):
            for version in ("v1", "v2"):
                db.add(DatasetItem(dataset_version_id=version, item_id=f"u{n}", index=index, input="same", fingerprint=f"u{n}"))
            index += 1
        db.add(DatasetItem(dataset_version_id="v2", item_id="added", index=index, input="new", fingerprint="added"))
        db.commit()
    return engine, factory


@pytest.fixture()
def dataset_client(maint_db, monkeypatch):
    from fastapi.testclient import TestClient

    from qym_platform.app import create_app
    from qym_platform.deps import get_db

    monkeypatch.setenv("QYM_AUTH_MODE", "none")
    engine, factory = maint_db
    app = create_app()

    def override():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_paged_compare_returns_only_its_page(maint_db, dataset_client):
    _compare_env(maint_db)
    url = "/v1/datasets/d/versions/v2:compare"
    paged = dataset_client.get(url, params={"project_slug": "p", "base": "v1", "include_diffs": 1, "kind": "changed", "limit": 2})
    body = _ok(paged)
    assert [row["item_id"] for row in body["field_diffs"]] == ["c0", "c1"] or len(body["field_diffs"]) == 2
    assert body["summary"] == {"added": 1, "removed": 0, "changed": 3, "unchanged": 4}
    for key in ("added", "removed", "changed", "unchanged", "timestamps"):
        assert key not in body, key
    full = _ok(dataset_client.get(url, params={"project_slug": "p", "base": "v1"}))
    assert len(full["changed"]) == 3 and len(full["unchanged"]) == 4 and "timestamps" in full


def test_unpaged_compare_loads_no_unchanged_bodies(maint_db, dataset_client):
    _compare_env(maint_db)
    loaded = []
    listener = lambda target, context: loaded.append(target.item_id)  # noqa: E731
    event.listen(DatasetItem, "load", listener)
    try:
        body = _ok(
            dataset_client.get(
                "/v1/datasets/d/versions/v2:compare",
                params={"project_slug": "p", "base": "v1", "include_diffs": 1},
            )
        )
    finally:
        event.remove(DatasetItem, "load", listener)
    assert len(body["field_diffs"]) == 3
    assert not [item_id for item_id in loaded if item_id.startswith("u")], loaded


def test_catalog_loads_only_the_versions_it_shows(maint_db, dataset_client):
    engine, factory = maint_db
    from datetime import datetime, timedelta

    with factory() as db:
        start = datetime(2026, 1, 1)
        for n in range(12):
            db.add(DatasetVersion(id=f"v{n:02d}", dataset_id="d", version=f"v{n}", status="published", created_by_user_id="u", created_at=start + timedelta(days=n)))
        db.commit()
    loaded = []
    listener = lambda target, context: loaded.append(target.id)  # noqa: E731
    event.listen(DatasetVersion, "load", listener)
    try:
        body = _ok(dataset_client.get("/v1/datasets", params={"project_slug": "p"}))
    finally:
        event.remove(DatasetVersion, "load", listener)
    (row,) = body["datasets"]
    assert row["latest_version"]["version"] == "v11"
    assert set(loaded) == {"v11"}


def test_item_page_window_runs_over_narrow_rows(maint_db, dataset_client):
    engine, factory = maint_db
    with factory() as db:
        db.add(DatasetVersion(id="v1", dataset_id="d", version="v1", status="published", created_by_user_id="u"))
        db.flush()
        for n in range(8):
            db.add(DatasetItem(dataset_version_id="v1", item_id=f"i{n}", index=n, input=f"text {n}", fingerprint=str(n)))
        db.commit()
    statements = []
    capture = lambda conn, cursor, statement, *rest: statements.append(statement)  # noqa: E731
    event.listen(engine, "before_cursor_execute", capture)
    try:
        body = _ok(dataset_client.get("/v1/datasets/d/versions/v1/items", params={"project_slug": "p", "limit": 3, "search": "text"}))
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert [item["item_id"] for item in body["items"]] == ["i0", "i1", "i2"] and body["total"] == 8
    windows = [s for s in statements if "OVER ()" in s]
    assert len(windows) == 1
    assert "dataset_items.input" not in windows[0]
