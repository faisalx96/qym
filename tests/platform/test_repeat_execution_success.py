"""C011: Execution success counts each repeat-run item pass once.

A repeat run keeps one RunItem per item, overwritten by whichever pass arrives
last, so an item that failed pass 1 and succeeded pass 2 used to read as a
success (and the reverse as a failure). Every view now counts item passes,
each judged by that pass's last attempt, like task_error_count.
"""

import json
from contextlib import contextmanager
from datetime import datetime
from uuid import NAMESPACE_URL, uuid5

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from qym_platform.api import dashboard
from qym_platform.api import insights as insights_api
from qym_platform.api import runs as runs_api
from qym_platform.auth import Principal
from qym_platform.db.dashboard_models import DashboardPartitionState as Partition
from qym_platform.db.dashboard_models import DashboardRunSummary as Summary
from qym_platform.db.models import (
    RunEvent,
    RunItemAttempt,
    RunWorkflowStatus,
    User,
)
from qym_platform.services import dashboard_summaries as service
from test_dashboard_durable_summaries import (
    assert_legacy_parity,
    drain,
    item,
    legacy,
    projected,
    run,
)

ITEMS = ("a", "b", "c")
LIVE = "00000000-0000-4000-8000-00000000c011"


def _attempt(db, item_id, pass_number, status, *, run_id="r", attempt_number=1):
    db.add(
        RunItemAttempt(
            run_id=run_id,
            item_id=item_id,
            pass_number=pass_number,
            attempt_number=attempt_number,
            status=status,
            is_last_attempt=True,
        )
    )


def _event(db, sequence, kind, item_id, pass_number, *, run_id="r", **payload):
    db.add(
        RunEvent(
            run_id=run_id,
            event_id=f"{run_id}-{sequence}",
            sequence=sequence,
            type=kind,
            sent_at=datetime(2026, 9, 1, 12),
            payload={"item_id": item_id, "pass_number": pass_number, **payload},
        )
    )


def _repeat_run(db, run_id="r", **kwargs):
    return run(
        db,
        run_id,
        samples=2,
        metrics=["score"],
        status=RunWorkflowStatus.COMPLETED,
        run_metadata={"total_items": 4, "last_completed_pass": 2},
        **kwargs,
    )


def _seed(db, first, last, *, run_id="r"):
    """4 items x 2 passes; item "flaky" ends pass 1 with ``first`` and pass 2
    with ``last``. Its RunItem mirrors only the pass that arrived last."""
    _repeat_run(db, run_id)
    for item_id in ITEMS:
        item(db, item_id=item_id, run_id=run_id)
        for pass_number in (1, 2):
            _attempt(db, item_id, pass_number, "completed", run_id=run_id)
    failed_last = last == "failed"
    item(
        db,
        item_id="flaky",
        run_id=run_id,
        output=None if failed_last else "answer",
        error="task unavailable" if failed_last else None,
    )
    # A retried pass is judged by its last attempt only.
    db.add(
        RunItemAttempt(
            run_id=run_id,
            item_id="flaky",
            pass_number=1,
            attempt_number=1,
            status="failed" if first == "completed" else "completed",
            is_last_attempt=False,
        )
    )
    _attempt(db, "flaky", 1, first, run_id=run_id, attempt_number=2)
    _attempt(db, "flaky", 2, last, run_id=run_id)
    db.commit()


@contextmanager
def _statements(engine):
    statements = []

    def capture(conn, cursor, sql, *args):
        statements.append(sql.lower())

    event.listen(engine, "before_cursor_execute", capture)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", capture)


def _principal(db):
    return Principal(user=db.get(User, "u"), auth_type="none")


def _insights(db):
    return insights_api.project_insights(
        project_slug="test",
        period="all",
        task=None,
        dataset=None,
        dataset_version_id=None,
        model=None,
        status=None,
        db=db,
        principal=_principal(db),
    )["runs"]


def _kpis(db, **filters):
    conditions = dashboard._base_conditions({"id": "p"}) + dashboard._filter_conditions(
        filters
    )
    return dashboard._kpis(db, conditions, filtered=bool(filters))


def _assert_per_pass(payload, *, executions=8, successes=7, task_errors=1):
    assert payload["execution_count"] == executions
    assert payload["execution_success_count"] == successes
    assert payload["success_rate"] == pytest.approx(successes / executions)
    assert payload["task_error_count"] == task_errors
    # The same executions task_error_count counts are the ones that failed.
    assert successes + task_errors == executions


@pytest.mark.parametrize(
    "first, last",
    [("failed", "completed"), ("completed", "failed")],
    ids=["earlier-failure-later-success", "earlier-success-later-failure"],
)
def test_every_view_counts_each_item_pass(database, first, last):
    with Session(database) as db:
        _seed(db, first, last)
        # Before publication, multi-run views count from source rows.
        unpublished = [
            _insights(db)[0]["success_rate"],
            runs_api._build_models_runs_data(db, [db.get(runs_api.Run, "r")])[0][
                "snapshot"
            ]["stats"]["success_rate"],
        ]

    listed = legacy(database)
    drain(database)
    published = projected(database)
    with Session(database) as db:
        target = db.get(runs_api.Run, "r")
        computed = runs_api._compute_run_summary(db, target)
        detail = runs_api._build_run_data(db, target)
        compact = runs_api._build_run_data(db, target, compact=True)
        with _statements(database) as statements:
            points = _insights(db)
            models = runs_api._build_models_runs_data(db, [target])[0]["snapshot"]
        # Published runs read their counts from the summary, not attempt rows.
        assert not any("run_item_attempts" in sql for sql in statements)
        kpis = _kpis(db)
        rate = db.get(Summary, "r").success_rate

    # 4 items x 2 passes; one pass of "flaky" failed, whichever came last.
    for payload in (listed, published, computed):
        _assert_per_pass(payload)
        # The logical-item fields keep their meaning (last-arriving pass).
        assert payload["total_items"] == 4
        assert payload["error_count"] == (1 if last == "failed" else 0)
    assert_legacy_parity(database)
    assert rate == pytest.approx(7 / 8)

    # Run page: the run and its stats state the same per-pass rate.
    for data in (detail, compact):
        stats = data["snapshot"]["stats"]
        assert stats["execution_count"] == 8
        assert stats["execution_success_count"] == 7
        assert stats["success_rate"] == pytest.approx(87.5)
        assert data["run"]["execution_count"] == 8
        assert data["run"]["execution_success_count"] == 7
        # One unit per name: stats.success_rate stays a percentage.
        assert "success_rate" not in data["run"]

    # Insights reliability and the Models snapshot, before and after publication.
    assert points[0]["success_rate"] == pytest.approx(7 / 8)
    assert models["stats"]["execution_count"] == 8
    assert models["stats"]["success_rate"] == pytest.approx(87.5)
    assert unpublished == [pytest.approx(7 / 8), pytest.approx(87.5)]

    # KPIs weight Execution success by item passes; Items stays logical items.
    assert kpis["items"] == 4
    assert kpis["execution_success"] == pytest.approx(7 / 8)
    assert kpis["runs_with_errors"] == 1


def test_legacy_sdk_events_count_passes_without_attempt_rows(database):
    """A pass reported only by item events is judged by those events."""
    with Session(database) as db:
        _repeat_run(db)
        for item_id in ITEMS:
            item(db, item_id=item_id)
            for pass_number in (1, 2):
                _attempt(db, item_id, pass_number, "completed")
        item(db, item_id="flaky")
        # No attempt rows for "flaky": pass 1 failed, pass 2 succeeded on a retry.
        _event(db, 1, "item_failed", "flaky", 1)
        _event(db, 2, "item_completed", "flaky", 2, retry_count=1)
        db.commit()

    listed = legacy(database)
    drain(database)
    published = projected(database)
    with Session(database) as db:
        computed = runs_api._compute_run_summary(db, db.get(runs_api.Run, "r"))
        kpis = _kpis(db)
    for payload in (listed, published, computed):
        _assert_per_pass(payload)
    assert_legacy_parity(database)
    assert kpis["execution_success"] == pytest.approx(7 / 8)


def test_classic_runs_keep_item_counts_and_kpis_weight_by_executions(database):
    with Session(database) as db:
        # Classic: 3 items, one task error -> 2 / 3 executions succeeded.
        run(db, "classic", task="classic", status=RunWorkflowStatus.COMPLETED)
        item(db, item_id="x", run_id="classic")
        item(db, item_id="y", run_id="classic")
        item(db, item_id="z", run_id="classic", output=None, error="boom")
        db.commit()
        _seed(db, "failed", "completed", run_id="repeat")

    listed = legacy(database, "classic")
    drain(database)
    published = projected(database, "classic")
    with Session(database) as db:
        computed = runs_api._compute_run_summary(db, db.get(runs_api.Run, "classic"))
        both = _kpis(db)
        classic_only = _kpis(db, tasks=["classic"])
        repeat_only = _kpis(db, tasks=["task"])
    for payload in (listed, published, computed):
        assert payload["execution_count"] == payload["total_items"] == 3
        assert payload["execution_success_count"] == payload["success_count"] == 2
        assert payload["success_rate"] == pytest.approx(2 / 3)
    assert_legacy_parity(database, "classic")
    # (2 + 7) / (3 + 8): the repeat run weighs its 8 item passes, not 4 items.
    assert both["items"] == 7
    assert both["execution_success"] == pytest.approx(9 / 11)
    assert classic_only["execution_success"] == pytest.approx(2 / 3)
    assert repeat_only["execution_success"] == pytest.approx(7 / 8)


def _ingest(database, monkeypatch, lines):
    """Send NDJSON events for run LIVE through the real ingest endpoint."""
    from fastapi.testclient import TestClient

    from qym_platform.app import create_app
    from qym_platform.db.models import ApiKey, ProjectMembership
    from qym_platform.deps import get_db
    from qym_platform.security import api_key_prefix, hash_api_key

    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    token = "live-ingest-token"
    with Session(database) as db:
        db.add_all(
            [
                ProjectMembership(user_id="u", project_id="p"),
                ApiKey(
                    id="key",
                    user_id="u",
                    project_id="p",
                    name="Test",
                    prefix=api_key_prefix(token),
                    key_hash=hash_api_key(token),
                    scopes=[],
                ),
            ]
        )
        run(db, LIVE, samples=2, metrics=["score"], run_config={"samples": 2})
        db.commit()

    def session():
        with Session(database) as db:
            yield db

    app = create_app()
    app.dependency_overrides[get_db] = session
    body = "\n".join(
        json.dumps(
            {
                "schema_version": 1,
                "event_id": str(uuid5(NAMESPACE_URL, f"live-{sequence}")),
                "sequence": sequence,
                "sent_at": "2026-09-01T12:00:00Z",
                "type": kind,
                "run_id": LIVE,
                "payload": payload,
            }
        )
        for sequence, (kind, payload) in enumerate(lines, start=1)
    )
    with TestClient(app) as client:
        response = client.post(
            f"/v1/runs/{LIVE}/events",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/x-ndjson",
            },
            content=body + "\n",
        )
    assert response.status_code == 200, response.text
    assert response.json()["rejected"] == 0


@pytest.mark.parametrize("failed_pass", [1, 2], ids=["pass-1-fails", "pass-2-fails"])
@pytest.mark.parametrize(
    "report", ["item_failed-only", "item_failed-then-completed-attempt"]
)
def test_live_ingest_counts_passes_failed_only_by_item_failed(
    database, monkeypatch, failed_pass, report
):
    """An SDK can report a failed pass without a failed final attempt: before
    any attempt starts (crash, cancellation), or when metrics raise after the
    task succeeded. Live ingest bulk-inserts events, so the summary, the KPIs
    and every published view used to miss that pass (and its task error)."""
    lines = []
    for pass_number in (1, 2):
        for index, item_id in enumerate(("a", "b")):
            ids = {"item_id": item_id, "index": index, "pass_number": pass_number}
            attempt = {**ids, "attempt_number": 1}
            finished = (
                "item_attempt_finished",
                {**attempt, "status": "completed", "is_last_attempt": True},
            )
            lines.append(("item_started", {**ids, "input": {"q": item_id}}))
            if item_id == "b" and pass_number == failed_pass:
                if report == "item_failed-only":
                    lines.append(("item_failed", {**ids, "error": "crashed"}))
                else:
                    lines.append(("item_attempt_started", attempt))
                    lines.append(("item_failed", {**ids, "error": "metric raised"}))
                    lines.append(finished)
                continue
            lines += [
                ("item_attempt_started", attempt),
                (
                    "metric_scored",
                    {**ids, "metric_name": "score", "score_numeric": 1.0},
                ),
                ("item_completed", {**ids, "output": "answer", "latency_ms": 5.0}),
                finished,
            ]
        lines.append(("pass_completed", {"pass_number": pass_number, "samples": 2}))
    _ingest(database, monkeypatch, lines)

    listed = legacy(database, LIVE)
    drain(database)
    published = projected(database, LIVE)
    with Session(database) as db:
        kpis = _kpis(db)
    # 2 items x 2 passes; one pass of "b" failed, whichever came last.
    for payload in (listed, published):
        _assert_per_pass(payload, executions=4, successes=3)
    assert_legacy_parity(database, LIVE)
    assert kpis["execution_success"] == pytest.approx(3 / 4)
    assert kpis["runs_with_errors"] == 1


def test_multi_run_views_read_only_current_publications(database):
    """Insights and Models reuse published counts only while they are current."""
    with Session(database) as db:
        _seed(db, "failed", "completed")
    drain(database)
    with Session(database) as db:
        db.info["dashboard_projection_worker"] = True
        summary = db.get(Summary, "r")
        summary.data = {**summary.data, "execution_success_count": 2}
        db.commit()
        assert _insights(db)[0]["success_rate"] == pytest.approx(2 / 8)
        target = db.get(runs_api.Run, "r")
        # The run page too: no attempt/event scan for a current publication.
        page = runs_api._build_run_data(db, target)
        assert page["snapshot"]["stats"]["execution_success_count"] == 2
        # A source change is waiting to be applied: count from source rows.
        db.get(Partition, "r").queue_state = "pending"
        db.commit()
        assert _insights(db)[0]["success_rate"] == pytest.approx(7 / 8)
        stats = runs_api._build_models_runs_data(db, [target])[0]["snapshot"]["stats"]
        assert stats["execution_success_count"] == 7
        page = runs_api._build_run_data(db, target)
        assert page["snapshot"]["stats"]["execution_success_count"] == 7
        # Item batches (details, search) skip the whole-run count.
        batch = runs_api._build_run_data(db, target, item_ids=["flaky"])
        assert batch["snapshot"]["stats"]["execution_count"] == 1


def test_summaries_before_shape_four_fall_back_to_items_then_refresh(database):
    """Published summaries are refreshed from numeric records, not source rows."""
    with Session(database) as db:
        _seed(db, "failed", "completed")
    drain(database)
    with Session(database) as db:
        summary = db.get(Summary, "r")
        revision = summary.projection_revision
        data = dict(summary.data)
        for key in ("execution_count", "execution_success_count"):
            data.pop(key)
        data.update(summary_shape=3, success_rate=1.0)
        summary.data = data
        db.commit()
        # Until the worker republishes, KPIs read the item-level numbers.
        assert _kpis(db)["execution_success"] == pytest.approx(1.0)

    with _statements(database) as statements:
        with Session(database) as db:
            assert service.reconcile_summary_shapes(db) == 1
            db.commit()
        drain(database)
    _assert_per_pass(projected(database))
    assert projected(database)["summary_shape"] == service.SUMMARY_SHAPE == 5
    assert not any(
        table in sql
        for sql in statements
        for table in (
            "run_events",
            "run_items",
            "run_item_scores",
            "run_item_pass_scores",
            "run_item_attempts",
        )
    )
    with Session(database) as db:
        assert db.get(Summary, "r").projection_revision > revision
        assert db.get(Partition, "r").queue_state == "ready"
        assert _kpis(db)["execution_success"] == pytest.approx(7 / 8)


def test_maintenance_job_repairs_runs_whose_item_failed_events_were_never_projected(
    database,
):
    """Runs ingested before live events were projected: the upgrade job finds
    passes that failed only through item_failed and rebuilds just those runs."""
    from sqlalchemy import insert
    from sqlalchemy.orm import sessionmaker

    from qym_platform.db.maintenance_models import MaintenanceJob
    from qym_platform.services import maintenance

    def seed(db, run_id, *, failed_attempt=False, bulk=True):
        _repeat_run(db, run_id)
        for item_id in ("a", "b"):
            item(db, item_id=item_id, run_id=run_id)
            _attempt(db, item_id, 1, "completed", run_id=run_id)
        _attempt(db, "a", 2, "completed", run_id=run_id)
        if failed_attempt:
            _attempt(db, "b", 2, "failed", run_id=run_id)
        failure = {
            "run_id": run_id,
            # Event ids are unique per run only.
            "event_id": "pass-2-failed",
            "sequence": 1,
            "type": "item_failed",
            "sent_at": datetime(2026, 9, 1, 12),
            "payload": {"item_id": "b", "pass_number": 2},
        }
        if bulk:
            # The old live ingest path: a Core insert the outbox never saw.
            db.execute(insert(RunEvent), [failure])
        else:
            db.add(RunEvent(**failure))
        db.commit()

    with Session(database) as db:
        seed(db, "missed")
        seed(db, "attempted", failed_attempt=True)
        seed(db, "projected", bulk=False)
    drain(database)
    # The missed failure is absent from every published number.
    assert projected(database, "missed")["execution_count"] == 3
    assert projected(database, "missed")["task_error_count"] == 0

    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        job = maintenance.enqueue(db, "project_item_failure_events", {"window": 1})
        db.commit()
        job_id = job.id
    worker = maintenance.MaintenanceWorker(factory, database)
    assert worker.tick() == "succeeded"
    with factory() as db:
        row = db.get(MaintenanceJob, job_id)
        assert row.progress["phase"] == "done"
        # Only the run whose failure was never projected is rebuilt.
        assert row.progress["runs"] == ["missed"]
        assert db.get(Partition, "missed").queue_state == "backfill"
        assert db.get(Partition, "attempted").queue_state == "ready"
        assert db.get(Partition, "projected").queue_state == "ready"

    drain(database)
    for run_id in ("missed", "attempted", "projected"):
        _assert_per_pass(projected(database, run_id), executions=4, successes=3)
        assert_legacy_parity(database, run_id)
