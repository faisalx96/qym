"""Overview trend (C056) and the previous run a run compares with (C057)."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from qym_platform.api import dashboard_stats
from qym_platform.db.models import (
    Dataset,
    DatasetVersion,
    Run,
    RunItemScore,
    RunWorkflowStatus,
)
from test_dashboard_durable_summaries import drain, item, run
from test_minimize_errors import _principal, _spec

NOW = datetime.utcnow().replace(microsecond=0)


def _scored_run(
    db,
    run_id,
    *,
    days_ago,
    scores,
    task="task",
    model="openai/model",
    status=RunWorkflowStatus.COMPLETED,
    primary="score",
    hours=12,
    **kwargs,
):
    started = (NOW - timedelta(days=days_ago)).replace(hour=hours, minute=0, second=0)
    run(
        db,
        run_id=run_id,
        task=task,
        model=model,
        metrics=["other", "score"],
        status=status,
        started_at=started,
        created_at=started,
        run_metadata={"total_items": len(scores)},
        **kwargs,
    )
    db.add(_spec(run_id, "other", 0, "maximize"))
    db.add(
        _spec(
            run_id,
            "score",
            1,
            "minimize" if primary == "cost" else "maximize",
            is_primary=primary == "score",
        )
    )
    for index, value in enumerate(scores):
        item(db, item_id="i%d" % index, run_id=run_id, index=index)
        db.add(
            RunItemScore(
                run_id=run_id,
                item_id="i%d" % index,
                metric_name="score",
                score_numeric=value,
            )
        )
        db.add(
            RunItemScore(
                run_id=run_id,
                item_id="i%d" % index,
                metric_name="other",
                score_numeric=0.5,
            )
        )


def _trend(database, **payload):
    with Session(database) as db:
        return dashboard_stats.dashboard_trend(
            {"project_slug": "test", **payload}, db=db, principal=_principal(db)
        )


def test_trend_is_the_primary_metric_per_day_with_the_period_before(database):
    with Session(database) as db:
        _scored_run(db, "today", days_ago=0, scores=[1.0, 1.0])  # 1.0
        _scored_run(db, "today-2", days_ago=0, scores=[0.0, 1.0])  # 0.5
        _scored_run(db, "three", days_ago=3, scores=[0.5, 0.5])  # 0.5
        _scored_run(
            db, "before", days_ago=9, scores=[0.0, 0.5]
        )  # 0.25, previous 7 days
        _scored_run(
            db, "live", days_ago=1, scores=[0.0, 0.0], status=RunWorkflowStatus.RUNNING
        )
        _scored_run(db, "other-task", days_ago=1, scores=[0.1], task="small")
        _scored_run(db, "gone", days_ago=2, scores=[0.0, 0.0])
        db.commit()
        db.get(Run, "gone").deleted_at = NOW
        db.commit()
    drain(database)
    data = _trend(database, days=7)
    assert data["task"] == "task"  # most finished runs in the range
    assert [entry["task"] for entry in data["tasks"]] == ["task", "small"]
    assert data["metric"] == "score" and data["direction"] == "maximize"
    assert len(data["points"]) == 7
    assert data["points"][-1]["date"] == NOW.date().isoformat()
    by_day = {point["date"]: point for point in data["points"]}
    today = by_day[NOW.date().isoformat()]
    assert today["runs"] == 2 and today["metric_mean"] == pytest.approx(0.75)
    assert today["execution_success"] == pytest.approx(1.0)
    three = by_day[(NOW - timedelta(days=3)).date().isoformat()]
    assert three["runs"] == 1 and three["metric_mean"] == pytest.approx(0.5)
    # The running run and the deleted run count nowhere.
    assert sum(point["runs"] for point in data["points"]) == 3
    summary = data["summary"]
    assert summary["runs"] == 3 and summary["metric_mean"] == pytest.approx(2.0 / 3)
    assert summary["previous_runs"] == 1
    assert summary["previous_metric_mean"] == pytest.approx(0.25)
    assert summary["delta"] == pytest.approx(2.0 / 3 - 0.25)

    small = _trend(database, days=7, task="small")
    assert small["task"] == "small" and small["summary"]["runs"] == 1
    # An unknown task falls back to the default.
    assert _trend(database, days=7, task="nope")["task"] == "task"
    wide = _trend(database, days=30)
    assert len(wide["points"]) == 30 and wide["summary"]["runs"] == 4


def test_trend_never_mixes_datasets(database):
    """Runs on another dataset score other items: a day that mixes them would
    read a change of dataset as a change of quality. The trend follows one
    task on one dataset, the busiest by default, and lists the others."""
    with Session(database) as db:
        _scored_run(db, "easy-1", days_ago=0, scores=[1.0], dataset="easy")
        _scored_run(db, "hard-1", days_ago=0, scores=[0.0], dataset="hard")
        _scored_run(db, "hard-2", days_ago=1, scores=[0.2], dataset="hard")
        _scored_run(db, "hard-old", days_ago=8, scores=[0.4], dataset="hard")
        _scored_run(db, "easy-old", days_ago=8, scores=[1.0], dataset="easy")
        db.commit()
    drain(database)
    data = _trend(database, days=7)
    assert (data["task"], data["dataset"]) == ("task", "hard")
    assert [(e["task"], e["dataset"], e["runs"]) for e in data["tasks"]] == [
        ("task", "hard", 2),
        ("task", "easy", 1),
    ]
    today = data["points"][-1]
    assert today["runs"] == 1 and today["metric_mean"] == pytest.approx(0.0)
    assert data["summary"]["metric_mean"] == pytest.approx(0.1)
    assert data["summary"]["previous_metric_mean"] == pytest.approx(0.4)
    easy = _trend(database, days=7, task="task", dataset="easy")
    assert easy["dataset"] == "easy" and easy["summary"]["runs"] == 1
    assert easy["summary"]["metric_mean"] == pytest.approx(1.0)
    assert easy["summary"]["previous_metric_mean"] == pytest.approx(1.0)
    # A task alone takes its busiest dataset; an unknown dataset too.
    assert _trend(database, days=7, task="task")["dataset"] == "hard"
    assert _trend(database, days=7, task="task", dataset="nope")["dataset"] == "hard"


def test_trend_days_are_the_viewers_local_days(database):
    with Session(database) as db:
        # 23:00 UTC yesterday is today in UTC+3.
        _scored_run(db, "late", days_ago=1, scores=[1.0], hours=23)
        db.commit()
    drain(database)
    utc = _trend(database, days=7)
    east = _trend(database, days=7, tz_offset_minutes=180)
    yesterday = (NOW - timedelta(days=1)).replace(hour=23, minute=0, second=0)
    assert [p["date"] for p in utc["points"] if p["runs"]] == [
        yesterday.date().isoformat()
    ]
    # The same run is on the next local day three hours east of UTC.
    assert [p["date"] for p in east["points"] if p["runs"]] == [
        (yesterday + timedelta(minutes=180)).date().isoformat()
    ]


def test_trend_without_finished_runs_in_range_says_when_the_last_one_was(database):
    with Session(database) as db:
        _scored_run(db, "old", days_ago=23, scores=[1.0])
        db.commit()
    drain(database)
    data = _trend(database, days=7)
    assert data["task"] == "task" and data["summary"]["runs"] == 0
    assert data["latest_run_at"].startswith(
        (NOW - timedelta(days=23)).date().isoformat()
    )
    assert all(point["runs"] == 0 for point in data["points"])


def test_trend_validates_its_request(database):
    for bad in (
        {"days": 14},
        {"days": True},
        {"task": 3},
        {"tz_offset_minutes": 10000},
        {"dataset": 3},
        {"extra": 1},
    ):
        with pytest.raises(HTTPException) as raised:
            _trend(database, **bad)
        assert raised.value.status_code == 400
    assert _trend(database, days=7)["task"] is None


def _previous(database, run_id):
    with Session(database) as db:
        return dashboard_stats.dashboard_previous_run(
            run_id=run_id, db=db, principal=_principal(db)
        )


def test_previous_run_is_the_last_finished_run_of_the_same_task_model_and_dataset(
    database,
):
    with Session(database) as db:
        db.add(
            Dataset(
                id="d",
                project_id="p",
                name="dataset",
                slug="dataset",
                created_by_user_id="u",
            )
        )
        db.flush()
        for vid in ("v1", "v2"):
            db.add(
                DatasetVersion(
                    id=vid, dataset_id="d", version=vid, created_by_user_id="u"
                )
            )
        db.flush()
        _scored_run(
            db, "oldest", days_ago=5, scores=[0.2, 0.2], dataset_version_id="v1"
        )
        _scored_run(
            db, "previous", days_ago=3, scores=[0.4, 0.6], dataset_version_id="v1"
        )
        _scored_run(
            db, "other-model", days_ago=2, scores=[1.0], model="anthropic/other"
        )
        _scored_run(db, "other-dataset", days_ago=2, scores=[1.0], dataset="elsewhere")
        _scored_run(
            db, "running", days_ago=1, scores=[1.0], status=RunWorkflowStatus.RUNNING
        )
        _scored_run(db, "deleted", days_ago=1, scores=[1.0])
        _scored_run(
            db, "current", days_ago=0, scores=[0.9, 0.7], dataset_version_id="v2"
        )
        _scored_run(db, "later", days_ago=0, scores=[0.1], hours=23)
        db.commit()
        db.get(Run, "deleted").deleted_at = NOW
        db.commit()
    drain(database)
    data = _previous(database, "current")
    assert data["previous"]["run_id"] == "previous"
    assert data["dataset_version"] == "v2"
    assert data["previous"]["dataset_version"] == "v1"
    assert data["dataset_version_mismatch"] is True
    primary = data["primary"]
    assert primary["metric"] == "score" and primary["direction"] == "maximize"
    assert primary["value"] == pytest.approx(0.8)
    assert primary["previous_value"] == pytest.approx(0.5)
    assert primary["delta"] == pytest.approx(0.3)
    assert _previous(database, "previous")["previous"]["run_id"] == "oldest"
    assert _previous(database, "oldest")["previous"] is None
    with pytest.raises(HTTPException) as raised:
        _previous(database, "nope")
    assert raised.value.status_code == 404
