"""Round 7 (Q2): ``GET /api/runs/{id}/group-metrics?view=group`` is a plain read.

The runs-table strip shows five numbers (Pass@k, Pass^k, Avg@k, Consistency, Reliability). The default response also
carries the accuracy-vs-k band, the distribution and the uncertainty, which need an item bootstrap in pure Python
(2,630 ms for 10 passes x 300 items, 10,900 ms for 10 x 1,200). ``view=group`` returns only the group set, never calls the
bootstrap and never writes ``run_metric_analyses``; without ``view`` the response is unchanged.
"""

from __future__ import annotations

import json
import os
import statistics
import time

import pytest
from fastapi.testclient import TestClient
from qym_platform.api import runs as runs_api
from qym_platform.auth import Principal
from qym_platform.db.models import (
    RunItemPassScore,
    RunMetricAnalysis,
    RunMetricSpec,
    RunWorkflowStatus,
    User,
)
from sqlalchemy.orm import Session
from test_dashboard_durable_summaries import run

STRICT = os.environ.get("QYM_PERF_STRICT") == "1"
PASSES = 10
# the spec's targets (qa.md Q2-1) and the margin for a shared CI machine: the old bootstrap took 2,630 and 10,900 ms,
# so even the margin separates the two behaviours by 10x
LIMIT_MS = {1200: 60 if STRICT else 300, 300: 25 if STRICT else 120}
WARM_MS = 15 if STRICT else 60


def _seed(
    db: Session, items: int, *, run_id: str = "r", report_k: int | None = None
) -> None:
    config = {"samples": PASSES}
    if report_k is not None:
        config["report_k"] = report_k
    run(
        db,
        run_id=run_id,
        metrics=["correct", "quality"],
        samples=PASSES,
        status=RunWorkflowStatus.COMPLETED,
        run_config=config,
        run_metadata={"total_items": items, "last_completed_pass": PASSES},
    )
    db.add_all(
        [
            RunMetricSpec(
                run_id=run_id,
                metric_name="correct",
                position=0,
                schema_version=2,
                score_type="boolean",
                direction="maximize",
                pass_threshold=1.0,
                sample_reducer="mean",
                run_reducer="mean",
                is_primary=True,
            ),
            RunMetricSpec(
                run_id=run_id,
                metric_name="quality",
                position=1,
                schema_version=2,
                score_type="percentage",
                direction="maximize",
                pass_threshold=0.7,
                sample_reducer="mean",
                run_reducer="mean",
                is_primary=None,
            ),
        ]
    )
    rows = []
    for i in range(items):
        item_id = f"q-{i:04d}"
        stable = i % 5 != 0
        for p in range(1, PASSES + 1):
            correct = (0 if i % 4 == 0 else 1) if stable else (i + p) % 2
            quality = min(
                1.0,
                max(0.0, (0.8 if correct else 0.4) + ((i * 7 + p * 3) % 10 - 5) / 50),
            )
            rows.append((item_id, "correct", p, float(correct)))
            rows.append((item_id, "quality", p, round(quality, 3)))
    db.bulk_insert_mappings(
        RunItemPassScore,
        [
            {
                "run_id": run_id,
                "item_id": i,
                "metric_name": m,
                "pass_number": p,
                "score_numeric": s,
            }
            for i, m, p, s in rows
        ],
    )
    db.commit()


def _principal(db: Session) -> Principal:
    return Principal(user=db.get(User, "u"), auth_type="none")


def _group(db, **kw):
    return runs_api.run_group_metrics("r", db=db, principal=_principal(db), **kw)


def test_view_group_returns_exactly_the_strip_payload_and_writes_nothing(database):
    with Session(database) as db:
        _seed(db, 30)
        before = db.query(RunMetricAnalysis).count()
        grouped = _group(db, metric="quality", threshold=0.7, view="group")
        assert (
            db.query(RunMetricAnalysis).count() == before == 0
        )  # a GET that writes nothing
        # Q2-1: the keys are exactly these, and the payload is small enough to prefetch for every run of a page
        assert set(grouped) == {
            "run_id",
            "metric",
            "direction",
            "threshold",
            "samples",
            "report_k",
            "group",
        }
        assert len(json.dumps(grouped)) <= 700
        assert grouped["samples"] == PASSES and grouped["group"]["k"] == PASSES
        # the five statistics of the strip are all there
        for stat in (
            "pass_at_k",
            "pass_hat_k",
            "avg_at_k",
            "consistency",
            "reliability",
        ):
            assert stat in grouped["group"]

        full = _group(db, metric="quality", threshold=0.7)
        # the two views cannot disagree on `group` (or on anything else they share)
        assert full["group"] == grouped["group"]
        for key in (
            "run_id",
            "metric",
            "direction",
            "threshold",
            "samples",
            "report_k",
        ):
            assert full[key] == grouped[key], key


def test_view_group_defaults_metric_and_threshold_like_the_default_view(database):
    with Session(database) as db:
        _seed(db, 12, report_k=4)
        grouped = _group(db, metric=None, threshold=None, view="group")
        full = _group(db, metric=None, threshold=None)
        assert grouped["metric"] == "correct" and grouped["threshold"] == pytest.approx(
            1.0
        )
        assert grouped["report_k"] == 4
        assert grouped["group"] == full["group"]


def test_default_view_is_unchanged_and_cached(database):
    with Session(database) as db:
        _seed(db, 30)
        first = _group(db, metric="quality", threshold=0.7)
        # Q2-2: every key of the full response, the band keyed by k
        assert set(first) == {
            "run_id",
            "metric",
            "direction",
            "threshold",
            "samples",
            "report_k",
            "group",
            "band",
            "distribution",
            "uncertainty",
        }
        assert set(first["band"]) == set(range(1, PASSES + 1))
        assert set(first["uncertainty"]) == {
            "confidence",
            "bootstrap_iterations",
            "minimum_items",
            "method",
            "method_version",
        }
        assert db.query(RunMetricAnalysis).count() == 1
        t = time.perf_counter()
        second = _group(db, metric="quality", threshold=0.7)
        warm_ms = (time.perf_counter() - t) * 1000
        assert second["band"] == first["band"]
        assert db.query(RunMetricAnalysis).count() == 1
        assert warm_ms <= WARM_MS, f"cached default view took {warm_ms:.1f} ms"
        # the strip's request does not disturb the cache the run page uses
        _group(db, metric="quality", threshold=0.7, view="group")
        assert db.query(RunMetricAnalysis).count() == 1


@pytest.mark.parametrize("items", [300, 1200])
def test_view_group_is_fast_on_a_cold_run(database, items):
    """Q2-1: the first request for a (metric, threshold) used to pay the bootstrap; now it reads the passes once."""
    with Session(database) as db:
        _seed(db, items)
        times = []
        for threshold in (
            0.5,
            0.6,
            0.7,
            0.8,
            0.9,
        ):  # five distinct keys: every one is a first request
            t = time.perf_counter()
            _group(db, metric="quality", threshold=threshold, view="group")
            times.append((time.perf_counter() - t) * 1000)
        assert db.query(RunMetricAnalysis).count() == 0
        median = statistics.median(times)
        assert (
            median <= LIMIT_MS[items]
        ), f"{items} items: median {median:.1f} ms of {[round(x, 1) for x in times]}"


def test_endpoint_accepts_view_group_and_rejects_other_views(monkeypatch):
    """The query parameter is wired through HTTP (member of the project, proxy-header auth)."""
    from _helpers import _make_env
    from qym_platform.db.models import Project, ProjectMembership, ProjectRole, UserRole

    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    app, factory = _make_env()
    with factory() as db:
        member = User(id="u", email="member@example.com", role=UserRole.MEMBER)
        db.add(member)
        db.add(Project(id="p", name="P", slug="p", created_by_user_id="u"))
        db.flush()
        db.add(ProjectMembership(project_id="p", user_id="u", role=ProjectRole.MANAGER))
        db.commit()
        _seed(db, 15)
    headers = {"X-User-Email": "member@example.com", "Origin": "http://localhost:8000"}
    with TestClient(app) as client:
        grouped = client.get(
            "/api/runs/r/group-metrics?metric=quality&threshold=0.7&view=group",
            headers=headers,
        )
        assert grouped.status_code == 200, grouped.text
        assert set(grouped.json()) == {
            "run_id",
            "metric",
            "direction",
            "threshold",
            "samples",
            "report_k",
            "group",
        }
        assert len(grouped.content) <= 700
        full = client.get(
            "/api/runs/r/group-metrics?metric=quality&threshold=0.7", headers=headers
        )
        assert full.status_code == 200 and "band" in full.json()
        assert full.json()["group"] == grouped.json()["group"]
        bogus = client.get("/api/runs/r/group-metrics?view=everything", headers=headers)
        assert bogus.status_code == 422
