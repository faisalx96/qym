"""Lost item outcomes in completed runs use the attempt evidence (C024 x C011/C015).

Since C024 a run whose only losses are rejected events completes, flagged
Incomplete. When the rejected event is an item's item_failed, the platform
used to count that item (or pass) as a clean result. Now, through the real
ingest endpoint:

- classic run, item_failed rejected: the item's final attempt failed, so it
  is a task error in Execution success, the error counts and the means;
- classic run, item_failed and item_attempt_finished rejected together (the
  official SDK's path when the database refuses the error text): the item has
  no outcome at all. It shows as "not received" (its row state and a count),
  is left out of Execution success and of the means, and is not a success.
  So is an item whose completion events were rejected while its scores
  arrived;
- repeat run, item_failed rejected: the pass whose final attempt failed is a
  task-failed pass in the means (0, or left out when lower is better), in
  source rows and the published projection alike.

The Incomplete flag stays on every such run. A run in review is judged by
how it ran, not by its review status: a failed run's item without an outcome
is never "not received", before, during or after review.
"""

from __future__ import annotations

import json
from datetime import datetime
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from qym_platform.api import ingest
from qym_platform.api import insights as insights_api
from qym_platform.api import runs as runs_api
from qym_platform.auth import Principal, require_api_key_principal
from qym_platform.db.models import (
    CorrectionStatus,
    ReviewCorrection,
    Run,
    RunItem,
    RunItemPassScore,
    RunItemScore,
    RunWorkflowStatus,
    User,
)
from qym_platform.deps import get_db
from qym_platform.services import dashboard_summaries
from qym_platform.services.insights_engine import build_insight_data
from qym_platform.services.root_cause_dashboard import DashboardFilters, _load_snapshot
from qym_platform.services.run_means import item_not_received
from test_dashboard_durable_summaries import (
    drain,
    legacy,
    projected,
)
from test_ingest_partial_rejection import _emulate_postgres_value_checks
from test_minimize_errors import JS_MEANS, _approx, _node, _principal, _rows

def rid(name):
    """Run ids are UUIDs; derive readable, stable ones from test names."""
    return str(uuid5(NAMESPACE_URL, "qym-test/" + name))


# The database refuses NUL in text (PostgreSQL; emulated on SQLite).
REFUSED = "tool crashed: \x00"
SPECS = {
    "q": {"score_type": "percentage", "direction": "maximize", "schema_version": 2},
    "h": {"score_type": "percentage", "direction": "minimize", "schema_version": 2},
    "u": {"score_type": "percentage", "schema_version": 2},
}


class Emitter:
    """SDK-shaped events for one run, posted to the real ingest endpoint."""

    def __init__(self, client, run_id, samples, metrics):
        self.client, self.run_id = client, run_id
        self.samples, self.metrics = samples, list(metrics)
        self.sequence = 0

    def event(self, kind, payload):
        self.sequence += 1
        return {
            "schema_version": 1,
            "event_id": str(uuid4()),
            "sequence": self.sequence,
            "sent_at": "2026-09-30T00:00:00Z",
            "type": kind,
            "run_id": self.run_id,
            "payload": payload,
        }

    def post(self, events):
        response = self.client.post(
            f"/v1/runs/{self.run_id}/events",
            content="\n".join(json.dumps(event) for event in events),
            headers={"content-type": "application/x-ndjson"},
        )
        assert response.status_code in (200, 422), response.text
        return response.json()

    def started(self, total_items):
        return [
            self.event(
                "run_started",
                {
                    "task": "t",
                    "dataset": "d",
                    "metrics": self.metrics,
                    "metric_specs": {name: SPECS[name] for name in self.metrics},
                    "total_items": total_items,
                    "run_config": {"samples": self.samples},
                    "started_at": "2026-09-30T00:00:00Z",
                },
            )
        ]

    def _begin(self, item_id, index, pass_number):
        ids = {"item_id": item_id, "index": index, "pass_number": pass_number}
        return ids, [
            self.event("item_started", {**ids, "input": f"question {index}"}),
            self.event("item_attempt_started", {**ids, "attempt_number": 1}),
        ]

    def passed(self, item_id, index, pass_number, scores, *, output="answer"):
        """A task that answered and was scored (the SDK scores before it
        reports the final attempt and item_completed)."""
        ids, events = self._begin(item_id, index, pass_number)
        for metric, value in scores.items():
            events.append(
                self.event(
                    "metric_scored",
                    {
                        "item_id": item_id,
                        "pass_number": pass_number,
                        "metric_name": metric,
                        "score_numeric": value,
                    },
                )
            )
        finished = {"attempt_number": 1, "latency_ms": 5.0, "is_last_attempt": True}
        events.append(
            self.event(
                "item_attempt_finished",
                {**ids, **finished, "status": "completed", "output": output},
            )
        )
        events.append(
            self.event("item_completed", {**ids, "output": output, "latency_ms": 5.0})
        )
        return events

    def failed(self, item_id, index, pass_number, *, error, attempt_error):
        """A task that failed: the SDK sends item_failed, then its final attempt."""
        ids, events = self._begin(item_id, index, pass_number)
        events.append(
            self.event("item_failed", {**ids, "error": error, "latency_ms": 5.0})
        )
        events.append(
            self.event(
                "item_attempt_finished",
                {
                    **ids,
                    "attempt_number": 1,
                    "status": "failed",
                    "error": attempt_error,
                    "latency_ms": 5.0,
                    "is_last_attempt": True,
                },
            )
        )
        return events

    def completed(self, total_items, rejected, final_status="COMPLETED"):
        return [
            self.event(
                "run_completed",
                {
                    "ended_at": "2026-09-30T00:01:00Z",
                    "final_status": final_status,
                    "summary": {"total_items": total_items, "rejected_events": rejected},
                },
            )
        ]


@pytest.fixture()
def emitter(database):
    """``make(name, samples, metrics)`` returns an Emitter for a new run
    (its id is ``rid(name)``)."""
    _emulate_postgres_value_checks(database)
    app = FastAPI()
    app.include_router(ingest.router)

    def session():
        with Session(database, autoflush=False) as db:
            yield db

    app.dependency_overrides[get_db] = session
    app.dependency_overrides[require_api_key_principal] = lambda: Principal(
        user=User(id="u"), auth_type="api_key", project_id="p"
    )
    with TestClient(app, raise_server_exceptions=False) as client:

        def make(name, samples, metrics):
            run_id = rid(name)
            with Session(database) as db:
                db.add(
                    Run(
                        id=run_id,
                        project_id="p",
                        owner_user_id="u",
                        created_by_user_id="u",
                        task="t",
                        dataset="d",
                        metrics=list(metrics),
                        status=RunWorkflowStatus.RUNNING,
                        run_metadata={},
                        run_config={},
                    )
                )
                db.commit()
            return Emitter(client, run_id, samples, metrics)

        yield make


def _views(engine, run_id):
    """Source list row, published summary and run detail, plus the run page."""
    source = legacy(engine, run_id)
    drain(engine)
    published = projected(engine, run_id)
    with Session(engine) as db:
        detail = runs_api._compute_run_summary(db, db.get(Run, run_id))
    return {"legacy": source, "projected": published, "detail": detail}, _rows(
        engine, run_id
    )


def _js_means(snapshot, metrics):
    return _node(
        JS_MEANS,
        {"rows": snapshot["rows"], "metrics": metrics, "specs": snapshot["metric_specs"]},
    )


def _classic(emitter, name, third):
    """item-0 and item-1 answer (q 1.0 / 0.5, h 0.2 / 0.4); item-2 is ``third``."""
    run = emitter(name, 1, ["q", "h"])
    events = run.started(3)
    events += run.passed("item-0", 0, 1, {"q": 1.0, "h": 0.2})
    events += run.passed("item-1", 1, 1, {"q": 0.5, "h": 0.4})
    events += third(run)
    body = run.post(events)
    run.post(run.completed(3, body["rejected"]))
    return body


def test_classic_item_whose_item_failed_was_rejected_is_a_task_error(database, emitter):
    body = _classic(
        emitter,
        "c-failed",
        lambda run: run.failed(
            "item-2", 2, 1, error=REFUSED, attempt_error="tool crashed"
        ),
    )
    assert body["rejected"] == 1
    assert body["rejected_events"][0]["type"] == "item_failed"
    with Session(database) as db:
        item = db.query(RunItem).filter_by(run_id=rid("c-failed"), item_id="item-2").one()
        # The failed final attempt stands in for the rejected item_failed.
        assert item.error == "tool crashed" and item.output is None
        run = db.get(Run, rid("c-failed"))
        assert run.status == RunWorkflowStatus.COMPLETED
        assert run.run_metadata["ingest_incomplete"]["rejected_events"] == 1

    views, snapshot = _views(database, rid("c-failed"))
    for name, payload in views.items():
        assert payload["error_count"] == 1, name
        assert payload["task_error_count"] == 1, name
        assert payload["execution_error_count"] == 1, name
        assert payload["not_received_count"] == 0, name
        assert payload["success_count"] == 2, name
        assert (payload["execution_count"], payload["execution_success_count"]) == (
            3,
            2,
        ), name
        assert payload["success_rate"] == pytest.approx(2 / 3), name
        # q counts the failed task as 0; lower-is-better h leaves it out.
        assert payload["metric_averages"] == _approx({"q": 0.5, "h": 0.3}), name
    rows = {row["item_id"]: row for row in snapshot["rows"]}
    assert rows["item-2"]["status"] == "error"
    assert _js_means(snapshot, ["q", "h"]) == _approx({"q": 0.5, "h": 0.3})


@pytest.mark.parametrize(
    "case",
    [
        # The official SDK: both events carry the error the database refuses.
        "item_failed_and_final_attempt",
        # item_completed and its final attempt carry an output the database
        # refuses; the item's scores arrived on their own.
        "completion_and_final_attempt",
    ],
)
def test_classic_item_without_any_outcome_is_not_received(database, emitter, case):
    name = "c-" + case.replace("_", "-")
    run_id = rid(name)

    def third(run):
        if case == "item_failed_and_final_attempt":
            return run.failed("item-2", 2, 1, error=REFUSED, attempt_error=REFUSED)
        return run.passed("item-2", 2, 1, {"q": 0.0, "h": 0.0}, output=REFUSED)

    body = _classic(emitter, name, third)
    assert body["rejected"] == 2
    with Session(database) as db:
        item = db.query(RunItem).filter_by(run_id=run_id, item_id="item-2").one()
        run = db.get(Run, run_id)
        assert run.status == RunWorkflowStatus.COMPLETED
        assert item_not_received(
            run.status, run.samples, item.error, item.output, item.latency_ms
        )
        assert run.run_metadata["ingest_incomplete"]["rejected_events"] == 2

    views, snapshot = _views(database, run_id)
    for name, payload in views.items():
        assert payload["not_received_count"] == 1, name
        # Neither an error nor a success, nor an execution.
        assert payload["error_count"] == payload["task_error_count"] == 0, name
        assert payload["success_count"] == 2, name
        assert (payload["execution_count"], payload["execution_success_count"]) == (
            2,
            2,
        ), name
        assert payload["success_rate"] == pytest.approx(1.0), name
        # Left out of the means, whatever scores arrived for it.
        assert payload["metric_averages"] == _approx({"q": 0.75, "h": 0.3}), name
        assert payload["total_items"] == 3, name
    rows = {row["item_id"]: row for row in snapshot["rows"]}
    assert rows["item-2"]["status"] == "not_received"
    assert rows["item-2"]["output_received"] is False
    assert snapshot["stats"]["not_received"] == 1
    assert snapshot["stats"]["execution_count"] == 2
    assert snapshot["stats"]["success_rate"] == pytest.approx(100.0)
    assert _js_means(snapshot, ["q", "h"]) == _approx({"q": 0.75, "h": 0.3})
    with Session(database) as db:
        models = runs_api.models_runs_data(
            files=[run_id], db=db, principal=_principal(db)
        )["runs"][0]
    stats = models["snapshot"]["stats"]
    assert (stats["not_received"], stats["execution_count"]) == (1, 2)
    status = {row["item_id"]: row["status"] for row in models["snapshot"]["rows"]}
    assert status["item-2"] == "not_received"


def test_items_of_a_running_run_are_not_judged_as_not_received(database, emitter):
    run = emitter("c-live", 1, ["q"])
    run.post(run.started(2) + run.passed("item-0", 0, 1, {"q": 1.0}))
    run.post(run._begin("item-1", 1, 1)[1])
    source = legacy(database, rid("c-live"))
    assert source["not_received_count"] == 0
    with Session(database) as db:
        item = db.query(RunItem).filter_by(run_id=rid("c-live"), item_id="item-1").one()
        assert not item_not_received(
            db.get(Run, rid("c-live")).status, 1, item.error, item.output, item.latency_ms
        )


def _repeat(emitter, name, refused):
    """samples=2: item-0 answers both passes; item-1 answers pass 1 and fails
    pass 2. ``refused`` names the pass-2 events the database refuses."""
    run = emitter(name, 2, ["u", "h"])
    events = run.started(2)
    for pass_number in (1, 2):
        events += run.passed("item-0", 0, pass_number, {"u": 0.8, "h": 0.2})
    events += run.passed("item-1", 1, 1, {"u": 0.8, "h": 0.4})
    events += run.failed(
        "item-1",
        1,
        2,
        error=REFUSED if "item_failed" in refused else "tool crashed",
        attempt_error=REFUSED if "attempt" in refused else "tool crashed",
    )
    body = run.post(events)
    assert body["rejected"] == len(refused)
    run.post(run.completed(2, body["rejected"]))


@pytest.mark.parametrize("refused", [(), ("item_failed",)])
def test_repeat_pass_whose_item_failed_was_rejected_counts_as_a_failed_task(
    database, emitter, refused
):
    name = "r-" + ("-".join(refused) or "accepted")
    run_id = rid(name)
    _repeat(emitter, name, refused)
    with Session(database) as db:
        passes = {
            row.metric_name: row
            for row in db.query(RunItemPassScore).filter_by(
                run_id=run_id, item_id="item-1", pass_number=2
            )
        }
        # The failed final attempt stored the pass as a failed task, as
        # item_failed does.
        assert {name: (row.score_numeric, row.label) for name, row in passes.items()} == {
            "u": (0.0, "error"),
            "h": (0.0, "error"),
        }
        assert all(row.meta.get("task_error") is True for row in passes.values())
        stored = {
            row.metric_name: row.score_numeric
            for row in db.query(RunItemScore).filter_by(run_id=run_id, item_id="item-1")
        }
        assert stored == _approx({"u": 0.4, "h": 0.4})
        flag = (db.get(Run, run_id).run_metadata or {}).get("ingest_incomplete")
        assert bool(flag) is bool(refused)

    views, snapshot = _views(database, run_id)
    for name, payload in views.items():
        # u (no direction): item-1 is (0.8 + 0) / 2, the run (0.8 + 0.4) / 2.
        # h (lower is better): the failed pass is left out, item-1 is 0.4.
        assert payload["metric_averages"] == _approx({"u": 0.6, "h": 0.3}), name
        assert payload["task_error_count"] == 1, name
        assert (payload["execution_count"], payload["execution_success_count"]) == (
            4,
            3,
        ), name
    for name in ("legacy", "projected"):
        strip = {p["pass_number"]: p for p in views[name]["pass_summaries"]}
        # The primary metric is u (the first): pass 2 counts the failure as 0.
        assert strip[2]["primary_score"] == pytest.approx(0.4), name
        assert strip[2]["task_error_count"] == 1, name
    with Session(database) as db:
        means = {
            p["pass_number"]: p["metric_means"]
            for p in runs_api.run_passes(run_id, db, _principal(db))["passes"]
        }
    assert means[2] == _approx({"u": 0.4, "h": 0.2})
    assert _js_means(snapshot, ["u", "h"]) == _approx({"u": 0.6, "h": 0.3})


def test_repeat_pass_without_any_outcome_stays_out_of_the_means(database, emitter):
    """item_failed and its final attempt both rejected: nothing says the pass
    failed. Its pass has no score, so the means cover the passes that
    arrived, and the run is flagged Incomplete."""
    _repeat(emitter, "r-both", ("item_failed", "attempt"))
    with Session(database) as db:
        assert (
            db.query(RunItemPassScore)
            .filter_by(run_id=rid("r-both"), item_id="item-1", pass_number=2)
            .count()
            == 0
        )
        flag = db.get(Run, rid("r-both")).run_metadata["ingest_incomplete"]
        assert flag["rejected_events"] == 2
    views, snapshot = _views(database, rid("r-both"))
    for name, payload in views.items():
        assert payload["metric_averages"] == _approx({"u": 0.8, "h": 0.3}), name
        assert payload["task_error_count"] == 0, name
    assert _js_means(snapshot, ["u", "h"]) == _approx({"u": 0.8, "h": 0.3})


def test_not_received_rule_matches_in_python_and_sql(database):
    """An output set to None is stored as JSON null, one never set as SQL
    NULL: both are no output. A run in review is judged by how it ran: its
    recorded outcome, else its run_completed event, else completed (uploads
    and imports). Live and stopped runs keep their own status."""
    from qym_platform.db.models import Approval, RunEvent
    from qym_platform.services.run_review import REVIEW_STATUSES
    from qym_platform.services.run_means import execution_outcomes, not_received_items
    from test_dashboard_durable_summaries import item, run

    def event(db, run_id, sequence, final_status):
        db.add(
            RunEvent(
                run_id=run_id,
                event_id=f"{run_id}-{sequence}",
                sequence=sequence,
                type="run_completed",
                sent_at=datetime(2026, 9, 30),
                payload={"final_status": final_status},
            )
        )

    runs = (
        ("done", RunWorkflowStatus.COMPLETED, 1),
        ("approved", RunWorkflowStatus.APPROVED, 1),
        ("failed", RunWorkflowStatus.FAILED, 1),
        ("submitted-failed", RunWorkflowStatus.SUBMITTED, 1),
        ("approved-failed-event", RunWorkflowStatus.APPROVED, 1),
        ("rejected-done-event", RunWorkflowStatus.REJECTED, 1),
        ("live", RunWorkflowStatus.RUNNING, 1),
        ("stopped", RunWorkflowStatus.STOPPED, 1),
        ("repeat", RunWorkflowStatus.COMPLETED, 2),
    )
    with Session(database) as db:
        for run_id, status, samples in runs:
            run(db, run_id=run_id, status=status, samples=samples)
            item(db, item_id="answered", run_id=run_id)
            item(db, item_id="failed", run_id=run_id, output=None, error="boom")
            item(db, item_id="none", run_id=run_id, output=None, latency_ms=None)
            db.add(RunItem(run_id=run_id, item_id="unset", input="x"))
        db.add(
            Approval(
                run_id="submitted-failed",
                submitted_by_user_id="u",
                execution_status="FAILED",
            )
        )
        # Reviews started before outcomes were recorded: the last event wins.
        event(db, "approved-failed-event", 1, "COMPLETED")
        event(db, "approved-failed-event", 2, "FAILED")
        event(db, "rejected-done-event", 1, "COMPLETED")
        # A live run's event cannot make it completed before it ends.
        event(db, "live", 1, "COMPLETED")
        db.commit()
        found = not_received_items(db, [run_id for run_id, _, _ in runs])
        assert found == {
            "done": {"none", "unset"},
            "approved": {"none", "unset"},
            "rejected-done-event": {"none", "unset"},
        }
        outcomes = execution_outcomes(db, db.query(Run).all())
        assert outcomes["submitted-failed"] == RunWorkflowStatus.FAILED
        assert outcomes["approved-failed-event"] == RunWorkflowStatus.FAILED
        assert outcomes["live"] == RunWorkflowStatus.RUNNING
        # A review status is not an outcome: it does not say the run completed.
        for status in REVIEW_STATUSES:
            assert not item_not_received(status, 1, None, None, None), status
        for row in db.query(RunItem):
            run_row = db.get(Run, row.run_id)
            assert item_not_received(
                outcomes[row.run_id],
                run_row.samples,
                row.error,
                row.output,
                row.latency_ms,
            ) == (row.item_id in found.get(row.run_id, ())), (row.run_id, row.item_id)


COUNTED = (
    "not_received_count",
    "execution_count",
    "execution_success_count",
    "success_count",
    "error_count",
    "task_error_count",
    "success_rate",
    "metric_averages",
)


def _counts(engine, run_id, *, repair=False):
    """The execution counts and means of one run in every view that shows
    them. ``repair`` rebuilds its published summary from the source first."""
    if repair:
        with Session(engine) as db:
            assert dashboard_summaries.request_dashboard_repair(db, run_id)
            db.commit()
    views, snapshot = _views(engine, run_id)
    found = {
        name: {key: payload[key] for key in COUNTED} for name, payload in views.items()
    }
    found["run page"] = {
        "stats": {
            key: snapshot["stats"][key]
            for key in ("not_received", "execution_count", "success_rate")
        },
        "rows": {row["item_id"]: row["status"] for row in snapshot["rows"]},
        "means": _js_means(snapshot, ["q", "h"]),
    }
    with Session(engine) as db:
        principal = _principal(db)
        models = runs_api.models_runs_data(files=[run_id], db=db, principal=principal)
        stats = models["runs"][0]["snapshot"]["stats"]
        found["models"] = {
            key: stats[key] for key in ("not_received", "execution_count")
        }
        point = next(
            point
            for point in insights_api.project_insights(
                project_slug="test",
                period="all",
                task=None,
                dataset=None,
                dataset_version_id=None,
                model=None,
                status=None,
                db=db,
                principal=principal,
            )["runs"]
            if point["run_id"] == run_id
        )
        found["insights"] = {
            key: point[key] for key in ("success_rate", "metric_averages")
        }
        snapshot = _load_snapshot(db, "p", DashboardFilters(), include_changes=False)
        found["root cause"] = {
            metric: dict(stat)
            for (stat_run, metric), stat in snapshot.score_stats.items()
            if stat_run == run_id
        }
        found["insights engine"] = {
            insight.category: {
                metric: dict(counts) for metric, counts in insight.metrics.items()
            }
            for insight in build_insight_data(
                db, "p", run_ids=[run_id], minimum_category_items=1
            )
        }
    return found


def _review(engine, run_id, *actions):
    """Apply review transitions (and trash/restore) through the endpoints;
    returns the run's status after the last one."""
    with Session(engine) as db:
        principal = _principal(db)
        for action in actions:
            if action == "submit":
                runs_api.submit_run(run_id, db=db, principal=principal)
            elif action == "trash":
                runs_api.delete_run({"file_path": run_id}, db=db, principal=principal)
            elif action == "restore":
                runs_api.restore_run({"run_id": run_id}, db=db, principal=principal)
            else:
                decide = getattr(runs_api, f"{action}_run")
                decide(run_id, {}, db=db, principal=principal)
        db.expire_all()
        return db.get(Run, run_id).status


def _reviewed(database, emitter, name, final_status):
    """item-0 answers (q 1.0, h 0.2), item-1 fails, item-2's completion
    events are refused while its scores arrived (q 0.0, h 0.0). Every item
    has one root-cause category, so the Insights engine judges them."""
    run = emitter(name, 1, ["q", "h"])
    events = run.started(3)
    events += run.passed("item-0", 0, 1, {"q": 1.0, "h": 0.2})
    events += run.failed(
        "item-1", 1, 1, error="tool crashed", attempt_error="tool crashed"
    )
    events += run.passed("item-2", 2, 1, {"q": 0.0, "h": 0.0}, output=REFUSED)
    body = run.post(events)
    run.post(run.completed(3, body["rejected"], final_status))
    with Session(database) as db:
        for row in db.query(RunItem).filter_by(run_id=run.run_id):
            row.item_metadata = {
                "metric_analyses": {"q": {"root_causes": ["Reasoning-Error"]}}
            }
            db.add(
                ReviewCorrection(
                    run_id=run.run_id,
                    item_id=row.item_id,
                    metric_name="q",
                    task="t",
                    ai_root_cause="Reasoning-Error",
                    ai_root_causes=["Reasoning-Error"],
                    human_root_cause="Reasoning-Error",
                    human_root_causes=["Reasoning-Error"],
                    status=CorrectionStatus.APPROVED,
                    is_active=True,
                )
            )
        db.commit()


def test_review_transitions_keep_a_failed_runs_counts(database, emitter):
    """runs.status shows the review while a run is in review. A failed run
    in review is still a failed run: its item without an outcome is not
    "not received", so its counts and means stay as they were. A completed
    run in review keeps counting it as not received."""
    lifecycle = [
        (("submit",), "SUBMITTED"),
        (("approve",), "APPROVED"),
        # Withdrawing returns the run to how it ran.
        (("unapprove",), None),
        (("submit", "reject"), "REJECTED"),
        (("unreject",), None),
        (("submit", "reject", "submit"), "SUBMITTED"),
        (("approve", "trash", "restore"), "APPROVED"),
    ]
    # item-1's task error counts as 0 for q and is left out of h (lower is
    # better); item-2 counts only in the failed run.
    for name, outcome, not_received, means, judged in (
        (
            "c-review-failed",
            "FAILED",
            0,
            {"q": 1 / 3, "h": 0.1},
            {"q": {"success": 1, "fail": 2}, "h": {"success": 2, "fail": 1}},
        ),
        (
            "c-review-done",
            "COMPLETED",
            1,
            {"q": 0.5, "h": 0.2},
            {"q": {"success": 1, "fail": 1}, "h": {"success": 1, "fail": 1}},
        ),
    ):
        _reviewed(database, emitter, name, outcome)
        run_id = rid(name)
        before = _counts(database, run_id)
        # item-1 is a task error; item-2 is a success where it was executed.
        success_rate = (2 - not_received) / (3 - not_received)
        for view in ("legacy", "projected", "detail"):
            assert before[view]["not_received_count"] == not_received, (name, view)
            assert before[view]["execution_count"] == 3 - not_received, (name, view)
            assert before[view]["success_rate"] == pytest.approx(success_rate)
            assert before[view]["metric_averages"] == _approx(means), (name, view)
        assert before["run page"]["rows"]["item-2"] == (
            "not_received" if not_received else "completed"
        )
        assert before["models"]["not_received"] == not_received
        assert before["insights"]["success_rate"] == pytest.approx(success_rate)
        assert before["insights"]["metric_averages"] == _approx(means)
        assert before["insights engine"] == {"Reasoning-Error": judged}
        for actions, status in lifecycle:
            assert _review(database, run_id, *actions) == (status or outcome), (
                name,
                actions,
            )
            assert _counts(database, run_id) == before, (name, actions)
            # The published summary rebuilt from the source while in review.
            assert _counts(database, run_id, repair=True) == before, (name, actions)
        # A score edit in review returns the row as the run page shows it.
        with Session(database) as db:
            edited = runs_api.update_metric(
                {
                    "file_path": run_id,
                    "row_index": 2,
                    "metric_name": "h",
                    "new_score": 0.0,
                },
                db=db,
                principal=_principal(db),
            )
        assert edited["row"]["status"] == before["run page"]["rows"]["item-2"]


def test_models_reads_run_items_once_when_no_item_can_be_not_received(
    database, emitter
):
    """The Models payload looks for items never received only in runs that
    have a candidate (no error, no latency): a complete run's items are read
    once, not scanned again (hot path on large databases)."""
    from sqlalchemy import event

    run_id = rid("c-complete")
    _classic(
        emitter,
        "c-complete",
        lambda run: run.failed(
            "item-2", 2, 1, error="tool crashed", attempt_error="tool crashed"
        ),
    )
    statements = []

    def capture(conn, cursor, sql, *args):
        statements.append(sql.lower())

    event.listen(database, "before_cursor_execute", capture)
    try:
        with Session(database) as db:
            models = runs_api.models_runs_data(
                files=[run_id], db=db, principal=_principal(db)
            )["runs"][0]
    finally:
        event.remove(database, "before_cursor_execute", capture)
    assert models["snapshot"]["stats"]["not_received"] == 0
    item_reads = [
        sql for sql in statements if "from run_items" in sql and "select" in sql
    ]
    assert len(item_reads) == 1, item_reads
