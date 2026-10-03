"""Refused events are tallied on the run and flag it when it completes (C024).

A run whose only losses are events the platform refused (schema errors,
reused sequences, values the database refuses) completes as COMPLETED and is
flagged as incomplete, whichever SDK sent it: new SDKs report the count in
run_completed, old SDKs complete without reading the per-event verdicts.
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy.orm import Session

from qym_platform.db.models import Run, RunItem, RunWorkflowStatus
from qym_platform.services.ingest_completeness import (
    MAX_NAMED_REJECTIONS,
    MAX_REMEMBERED_REJECTIONS,
    describe_ingest_flag,
    ingest_incomplete_flag,
    public_run_metadata,
    record_rejected_events,
    runs_list_ingest_flag,
)
from test_dashboard_durable_summaries import (
    drain,
    item,
    projected,
    run,
)
from test_ingest_partial_rejection import (  # noqa: F401
    _emulate_postgres_value_checks,
    _event,
    _refused_value_event,
    _started,
    api,
)


def _completed(run_id, sequence, total_items, **summary):
    return _event(
        run_id,
        sequence,
        "run_completed",
        {
            "ended_at": "2026-09-05T00:01:00Z",
            "final_status": "COMPLETED",
            "summary": {"total_items": total_items, **summary},
        },
    )


def _run_started(run_id, sequence, total_items, **run_metadata):
    return _event(
        run_id,
        sequence,
        "run_started",
        {
            "task": "t",
            "dataset": "d",
            "metrics": ["score"],
            "total_items": total_items,
            "run_metadata": run_metadata,
            "started_at": "2026-09-05T00:00:00Z",
        },
    )


def _finished(run_id, sequence, index):
    return _event(
        run_id,
        sequence,
        "item_completed",
        {"item_id": f"item-{index}", "output": "ok", "latency_ms": 1},
    )


def _poison(run_id, sequence, index):
    # item_completed without latency_ms: every platform version refuses it.
    return _event(
        run_id,
        sequence,
        "item_completed",
        {"item_id": f"item-{index}", "output": "no latency"},
    )


def _run(engine, run_id):
    with Session(engine) as db:
        return db.get(Run, run_id)


def test_completion_after_a_rejected_event_is_completed_and_flagged(api):
    """An old SDK ignores the verdict and completes: the run is still flagged."""
    engine, run_id, post = api
    poison = _poison(run_id, 4, 1)
    body = post(
        [
            _started(run_id, 1, 0),
            _started(run_id, 2, 1),
            _finished(run_id, 3, 0),
            poison,
        ]
    ).json()
    assert body["rejected"] == 1
    assert body["rejected_events"][0]["item_id"] == "item-1"

    assert post([_completed(run_id, 5, 2)]).status_code == 200

    run = _run(engine, run_id)
    assert run.status == RunWorkflowStatus.COMPLETED
    flag = run.run_metadata["ingest_incomplete"]
    assert flag["expected_items"] == flag["received_items"] == 2
    assert flag["rejected_events"] == 1
    [named] = flag["rejected"]
    assert named["type"] == "item_completed"
    assert named["item_id"] == "item-1"
    assert named["event_id"] == poison["event_id"]
    assert named["sequence"] == 4
    assert "latency_ms" in named["error"]
    assert flag["reason"].startswith("The platform rejected 1 event: item_completed")
    assert "item-1" in flag["reason"] and "latency_ms" in flag["reason"]


def test_refused_events_resent_one_by_one_are_counted_once(api):
    """SDKs resend an all-rejected (422) batch event by event."""
    engine, run_id, post = api
    bad = [_poison(run_id, 1, 0), _poison(run_id, 2, 1)]
    assert post(bad).status_code == 422
    for event in bad:
        assert post([event]).status_code == 422
    # A transport retry of the whole batch is refused again, too.
    assert post(bad).status_code == 422

    assert post([_completed(run_id, 3, 2)]).status_code == 200
    flag = _run(engine, run_id).run_metadata["ingest_incomplete"]
    assert flag["rejected_events"] == 2
    assert [row["item_id"] for row in flag["rejected"]] == ["item-0", "item-1"]
    assert flag["received_items"] == 0 and flag["expected_items"] == 2


def test_resent_lines_without_an_event_id_are_counted_once(api):
    """A transport retry resends the same garbage lines; count them once."""
    engine, run_id, post = api
    batch = [_started(run_id, 1, 0), "not json", '{"type": "item_started"}']
    for _ in range(2):
        body = post(batch).json()
        assert body["rejected"] == 2
    post([_completed(run_id, 2, 1)])
    flag = _run(engine, run_id).run_metadata["ingest_incomplete"]
    assert flag["rejected_events"] == 2


def test_events_naming_another_run_are_not_tallied(api):
    engine, run_id, post = api
    body = post(
        [_started(run_id, 1, 0), _started(str(uuid4()), 2, 1), _completed(run_id, 3, 1)]
    ).json()
    assert (body["applied"], body["rejected"]) == (2, 1)
    metadata = _run(engine, run_id).run_metadata
    assert "ingest_incomplete" not in metadata
    assert "ingest_rejected" not in metadata


def test_reused_sequence_is_tallied_as_a_rejected_event(api):
    engine, run_id, post = api
    first = _started(run_id, 1, 0)
    assert post([first]).status_code == 200
    body = post([_started(run_id, 1, 1), _completed(run_id, 2, 1)]).json()
    assert (body["applied"], body["rejected"]) == (1, 1)

    run = _run(engine, run_id)
    assert run.status == RunWorkflowStatus.COMPLETED
    flag = run.run_metadata["ingest_incomplete"]
    assert flag["rejected_events"] == 1
    assert "already used" in flag["rejected"][0]["error"]


def test_client_count_of_rejections_is_kept_when_higher(api):
    """run_completed carries the SDK's count; the flag keeps the larger one."""
    engine, run_id, post = api
    post([_started(run_id, 1, 0), _poison(run_id, 2, 0)])
    post([_completed(run_id, 3, 1, rejected_events=3)])

    flag = _run(engine, run_id).run_metadata["ingest_incomplete"]
    assert flag["rejected_events"] == 3
    assert len(flag["rejected"]) == 1
    assert flag["reason"].endswith("; and 2 more.")


def test_clean_run_stays_unflagged_and_keeps_the_old_flag_shape(api):
    engine, run_id, post = api
    post([_started(run_id, 1, 0), _finished(run_id, 2, 0), _completed(run_id, 3, 1)])
    metadata = _run(engine, run_id).run_metadata
    assert "ingest_incomplete" not in metadata
    assert "ingest_rejected" not in metadata


def test_event_refused_after_completion_flags_the_completed_run(api):
    engine, run_id, post = api
    post(
        [
            _run_started(run_id, 1, 1),
            _started(run_id, 2, 0),
            _finished(run_id, 3, 0),
            _completed(run_id, 4, 1),
        ]
    )
    assert "ingest_incomplete" not in _run(engine, run_id).run_metadata

    assert post([_poison(run_id, 5, 0)]).status_code == 422

    run = _run(engine, run_id)
    assert run.status == RunWorkflowStatus.COMPLETED
    flag = run.run_metadata["ingest_incomplete"]
    assert flag["rejected_events"] == 1
    assert flag["expected_items"] == flag["received_items"] == 1


def test_late_items_clear_missing_items_but_keep_the_rejections(api):
    engine, run_id, post = api
    post([_started(run_id, 1, 0), _poison(run_id, 2, 0), _completed(run_id, 3, 2)])
    flag = _run(engine, run_id).run_metadata["ingest_incomplete"]
    assert (flag["expected_items"], flag["received_items"]) == (2, 1)
    assert flag["reason"].startswith("1 of 2 items did not reach the platform.")

    post([_started(run_id, 4, 1)])

    flag = _run(engine, run_id).run_metadata["ingest_incomplete"]
    assert (flag["expected_items"], flag["received_items"]) == (2, 2)
    assert flag["rejected_events"] == 1
    assert flag["reason"].startswith("The platform rejected 1 event")


def test_run_started_in_the_same_batch_keeps_the_tally(api):
    """run_started replaces the run metadata; refusals from its batch stay."""
    engine, run_id, post = api
    started = _run_started(run_id, 1, 1, owner_note="kept")
    body = post([started, _started(run_id, 2, 0), _poison(run_id, 3, 0)]).json()
    assert (body["applied"], body["rejected"]) == (2, 1)
    post([_completed(run_id, 4, 1)])

    metadata = _run(engine, run_id).run_metadata
    assert metadata["owner_note"] == "kept"
    assert metadata["ingest_incomplete"]["rejected_events"] == 1


def test_value_the_database_refuses_is_tallied_and_flagged(api):
    engine, run_id, post = api
    _emulate_postgres_value_checks(engine)
    refused = _refused_value_event(run_id, 3, "nul_output")
    body = post(
        [
            _started(run_id, 1, 6),
            _started(run_id, 2, 7),
            refused,
            _completed(run_id, 4, 2),
        ]
    ).json()
    assert (body["applied"], body["rejected"]) == (3, 1)

    run = _run(engine, run_id)
    assert run.status == RunWorkflowStatus.COMPLETED
    flag = run.run_metadata["ingest_incomplete"]
    assert flag["rejected_events"] == 1
    [named] = flag["rejected"]
    assert named["event_id"] == refused["event_id"]
    assert named["item_id"] == "item-7"
    assert "database refused" in named["error"]


def test_database_refusal_isolated_after_completion_flags_the_run(api):
    """The refused line's own transaction runs after run_completed applied."""
    engine, run_id, post = api
    _emulate_postgres_value_checks(engine)
    post([_run_started(run_id, 1, 1), _started(run_id, 2, 7)])
    body = post(
        [_completed(run_id, 3, 1), _refused_value_event(run_id, 4, "nul_output")]
    ).json()
    assert (body["applied"], body["rejected"]) == (1, 1)

    run = _run(engine, run_id)
    assert run.status == RunWorkflowStatus.COMPLETED
    flag = run.run_metadata["ingest_incomplete"]
    assert flag["rejected_events"] == 1
    assert (flag["expected_items"], flag["received_items"]) == (1, 1)


def test_old_sdk_run_without_total_items_is_still_flagged(api):
    engine, run_id, post = api
    post([_started(run_id, 1, 0), _poison(run_id, 2, 0)])
    post(
        [
            _event(
                run_id,
                3,
                "run_completed",
                {"ended_at": "2026-09-05T00:01:00Z", "summary": {}},
            )
        ]
    )
    flag = _run(engine, run_id).run_metadata["ingest_incomplete"]
    assert flag["rejected_events"] == 1
    assert "expected_items" not in flag


def test_tally_names_a_bounded_number_and_remembers_recent_ids():
    run = Run(id=str(uuid4()), status=RunWorkflowStatus.RUNNING, run_metadata={})
    rows = [
        {"event_id": str(uuid4()), "type": "item_completed", "item_id": f"i{n}\x00"}
        for n in range(MAX_REMEMBERED_REJECTIONS + 5)
    ]
    assert record_rejected_events(run, rows)
    assert not record_rejected_events(run, rows[-3:])
    tally = run.run_metadata["ingest_rejected"]
    assert tally["count"] == len(rows)
    assert len(tally["events"]) == MAX_NAMED_REJECTIONS
    assert len(tally["seen"]) == MAX_REMEMBERED_REJECTIONS
    # NUL (the value Postgres refuses) never reaches the stored tally.
    assert tally["events"][0]["item_id"] == "i0"
    assert "seen" not in public_run_metadata(run.run_metadata)["ingest_rejected"]

    flag = ingest_incomplete_flag(run.run_metadata, expected=None, received=0)
    assert flag["rejected_events"] == len(rows)
    assert flag["reason"].endswith(f"; and {len(rows) - MAX_NAMED_REJECTIONS} more.")


def test_reviewed_run_is_not_tallied():
    run = Run(id=str(uuid4()), status=RunWorkflowStatus.APPROVED, run_metadata={})
    assert not record_rejected_events(run, [{"event_id": "e", "error": "bad"}])
    assert run.run_metadata == {}


def test_runs_list_flag_covers_missing_items_and_rejections():
    assert runs_list_ingest_flag({}) is None
    assert runs_list_ingest_flag({"ingest_incomplete": {"expected_items": 3}}) == {
        "missing_items": 3,
        "rejected_events": 0,
        "reason": "3 of 3 items did not reach the platform.",
    }
    flag = {
        "expected_items": 2,
        "received_items": 2,
        "rejected_events": 1,
        "rejected": [{"type": "metric_scored", "item_id": "q9", "error": "bad score"}],
    }
    assert runs_list_ingest_flag({"ingest_incomplete": flag}) == {
        "missing_items": 0,
        "rejected_events": 1,
        "reason": "The platform rejected 1 event: metric_scored for item q9 (bad score).",
    }
    assert describe_ingest_flag({"rejected_events": 2, "rejected": []}) == (
        "The platform rejected 2 events."
    )


def test_runs_list_rows_carry_the_flag(api):
    from unittest.mock import patch

    from qym_platform.api import runs as runs_api
    from qym_platform.auth import Principal
    from qym_platform.db.models import User
    from qym_platform.services.dashboard_summaries import _sync_dimension

    engine, run_id, post = api
    post([_started(run_id, 1, 0), _poison(run_id, 2, 0), _completed(run_id, 3, 1)])
    with Session(engine, autoflush=False) as db:
        dimension, _ = _sync_dimension(db, run_id, 1)
        assert dimension.descriptor["ingest_incomplete"]["rejected_events"] == 1
        assert "item-0" in dimension.descriptor["ingest_incomplete"]["reason"]
        db.rollback()
        assert db.query(RunItem).count() == 1

    # The runs page loads /api/runs. Before the projection publishes a run,
    # its row is built from the run itself and must carry the flag too.
    with Session(engine) as db, patch.object(
        runs_api, "_published_run_rows", return_value={}
    ):
        listing = runs_api.legacy_list_runs(
            limit=100,
            offset=0,
            project_slug="test",
            status=None,
            exclude_live=False,
            include_total=True,
            user=None,
            user_id=None,
            owner_user_id=None,
            db=db,
            principal=Principal(user=db.get(User, "owner"), auth_type="none"),
        )
    [row] = [
        row
        for models in listing["tasks"].values()
        for rows in models.values()
        for row in rows
        if row["run_id"] == run_id
    ]
    assert row["ingest_incomplete"]["rejected_events"] == 1
    assert "item-0" in row["ingest_incomplete"]["reason"]


def test_maintenance_job_publishes_flags_of_runs_finished_before_the_upgrade(
    database,
):
    """Runs flagged before the descriptor carried the flag, on admin request."""
    from qym_platform.db.dashboard_models import DashboardRunDimension
    from qym_platform.db.maintenance_models import MaintenanceJob
    from qym_platform.services import maintenance
    from sqlalchemy.orm import sessionmaker

    with Session(database) as db:
        flagged = {"expected_items": 4, "received_items": 1}
        for run_id, metadata in (
            ("old", {"total_items": 4, "ingest_incomplete": flagged}),
            ("clean", {"total_items": 4}),
            ("zz-old", {"total_items": 4, "ingest_incomplete": flagged}),
        ):
            run(db, run_id=run_id, status=RunWorkflowStatus.COMPLETED)
            db.get(Run, run_id).run_metadata = metadata
            item(db, item_id="a", run_id=run_id)
        db.commit()
    drain(database)
    # Descriptors published by the platform before this change had no flag.
    with Session(database) as db:
        for dimension in db.query(DashboardRunDimension):
            dimension.descriptor = {
                key: value
                for key, value in dimension.descriptor.items()
                if key != "ingest_incomplete"
            }
        db.commit()
    assert "ingest_incomplete" not in projected(database, "old")

    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        job = maintenance.enqueue(db, "publish_ingest_flags", {"window": 2})
        db.commit()
        job_id = job.id
    assert maintenance.MaintenanceWorker(factory, database).tick() == "succeeded"
    with factory() as db:
        assert db.get(MaintenanceJob, job_id).progress["runs_queued"] == 2
    drain(database)

    expected = {
        "missing_items": 3,
        "rejected_events": 0,
        "reason": "3 of 4 items did not reach the platform.",
    }
    assert projected(database, "old")["ingest_incomplete"] == expected
    assert projected(database, "zz-old")["ingest_incomplete"] == expected
    assert projected(database, "clean").get("ingest_incomplete") is None


def test_completing_batch_checks_the_flag_once_and_later_batches_again(api, monkeypatch):
    """run_completed refreshes the flag; the late-event check after the batch
    does not repeat it (each check counts the run's items), but a later batch
    of the flagged run still does."""
    from qym_platform.api import ingest as ingest_api

    engine, run_id, post = api
    real = ingest_api._refresh_ingest_flag
    calls = []

    def spy(*args, **kwargs):
        calls.append(args)
        return real(*args, **kwargs)

    monkeypatch.setattr(ingest_api, "_refresh_ingest_flag", spy)
    post([_started(run_id, 1, 0), _poison(run_id, 2, 0)])
    assert calls == []
    assert post([_completed(run_id, 3, 2)]).status_code == 200
    assert len(calls) == 1
    assert _run(engine, run_id).run_metadata["ingest_incomplete"]["rejected_events"] == 1

    # An item after run_completed in the same batch is checked again.
    calls.clear()
    post([_completed(run_id, 4, 2), _started(run_id, 5, 1)])
    assert len(calls) >= 2
    flag = _run(engine, run_id).run_metadata["ingest_incomplete"]
    assert (flag["expected_items"], flag["received_items"]) == (2, 2)
