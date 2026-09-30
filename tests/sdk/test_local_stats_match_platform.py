"""The SDK's local stats follow the platform's error rule (final review, option B).

A run's local summary (``get_metric_stats``, ``group_stats``, ``pass_means``
and everything built on them: ``summary()``, ``to_dict()``, the Rich panel)
must read the same numbers as the platform for the same run. The platform
rule (qym_platform/services/run_means.py): a task error or scorer error counts
as 0 for a higher-is-better metric and for one that declares no direction,
and is left out of the mean (with an error count) for a lower-is-better
metric. Repeat runs judge every pass that way, and an errored pass is never a
pass.

Each test streams a real SDK evaluation into the full platform app and
compares the SDK's numbers with the runs list (before and after the dashboard
projection publishes the run), the passes endpoint and the group metrics.
"""

from __future__ import annotations

import io
import os
import sys
from unittest.mock import MagicMock
from urllib.error import HTTPError
from urllib.parse import urlsplit

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("sqlalchemy")

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from qym import Evaluator, InMemoryDataset
from qym.metrics.result import MetricResult
from qym.metrics.spec import Metric
from qym.platform import client as client_module
from qym.platform.client import PlatformEventStream

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
if "openai" not in sys.modules:
    sys.modules["openai"] = MagicMock()

from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.dashboard_models import DashboardPartitionState
from qym_platform.db.models import (
    ApiKey,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.security import api_key_prefix, hash_api_key
from qym_platform.services.dashboard_summaries import drain_dashboard_changes

TOKEN = "local-stats-token"
OWNER = "owner@example.com"
UI = {"X-User-Email": OWNER, "Origin": "http://localhost:8000"}


@pytest.fixture()
def platform(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_ALLOW_LEGACY_EMPTY_API_KEY_SCOPES", "true")
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with SessionLocal() as db:
        db.add(User(id="owner-1", email=OWNER, role=UserRole.MEMBER))
        db.flush()
        db.add(
            Project(
                id="project-1",
                name="Project",
                slug="project",
                created_by_user_id="owner-1",
            )
        )
        db.flush()
        db.add_all(
            [
                ProjectMembership(
                    project_id="project-1", user_id="owner-1", role=ProjectRole.MEMBER
                ),
                ApiKey(
                    id="key-1",
                    user_id="owner-1",
                    project_id="project-1",
                    name="runner",
                    prefix=api_key_prefix(TOKEN),
                    key_hash=hash_api_key(TOKEN),
                    scopes=[],
                ),
            ]
        )
        db.commit()

    app = create_app()

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            key = {"Authorization": f"Bearer {TOKEN}"}

            def post_json(url, payload, api_key, **kwargs):
                response = client.post(urlsplit(url).path, json=payload, headers=key)
                response.raise_for_status()
                return response.json()

            def post_ndjson(url, payload, api_key, **kwargs):
                response = client.post(
                    urlsplit(url).path,
                    content=payload,
                    headers={**key, "content-type": "application/x-ndjson"},
                )
                if response.status_code >= 400:
                    raise HTTPError(
                        url,
                        response.status_code,
                        response.text,
                        response.headers,
                        io.BytesIO(response.content),
                    )
                return response.json()

            monkeypatch.setattr(client_module, "_post_json", post_json)
            monkeypatch.setattr(client_module, "_post_ndjson", post_ndjson)
            monkeypatch.setattr(PlatformEventStream, "FLUSH_INTERVAL", 0.005)
            yield engine, client
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def _drain(engine):
    for _ in range(50):
        with Session(engine, autoflush=False) as db:
            drain_dashboard_changes(db)
            db.commit()
            pending = db.scalar(
                select(func.count())
                .select_from(DashboardPartitionState)
                .where(DashboardPartitionState.queue_state.in_(["pending", "backfill"]))
            )
        if not pending:
            return
    raise AssertionError("dashboard projection did not settle")


def _runs_row(client, run_id):
    response = client.get("/api/runs?project_slug=project", headers=UI)
    assert response.status_code == 200, response.text
    [row] = [
        row
        for models in response.json()["tasks"].values()
        for rows in models.values()
        for row in rows
        if row["run_id"] == run_id
    ]
    return row


def _dataset():
    return InMemoryDataset(
        [
            {"id": f"item-{i}", "input": str(i), "expected_output": str(i)}
            for i in range(5)
        ]
    )


def _config(tmp_path, name):
    return {
        "run_name": name,
        "task_name": name,
        "checkpoint_enabled": False,
        "otel_enabled": False,
        "max_concurrency": 1,
        "max_retries": 0,
        "metric_max_retries": 0,
        "platform_api_key": TOKEN,
        "platform_url": "http://testserver",
        "output_dir": str(tmp_path),
    }


def _metrics(qual_values, plain_values, cost_values):
    """A higher-is-better, an undeclared and a lower-is-better metric; each
    raises (a scorer error) where its table has no value."""

    def pick(table, output):
        value = table.get(output)
        if value is None:
            raise RuntimeError(f"cannot judge {output}")
        return value

    def qual(output, expected=None):
        return pick(qual_values, output)

    def plain(output, expected=None):
        return pick(plain_values, output)

    def cost(output, expected=None):
        return pick(cost_values, output)

    return [
        Metric(qual, score_type="percentage", direction="maximize", pass_threshold=0.5),
        plain,  # a plain callable declares no direction
        Metric(cost, score_type="number", direction="minimize", pass_threshold=15),
    ]



def _run_id(engine):
    with Session(engine) as db:
        return db.query(Run).one().id


def _assert_run_means_match(client, engine, result, run_id):
    """The runs list (source rows, then the published projection) reads the
    SDK's means and error counts."""
    stats = {metric: result.get_metric_stats(metric) for metric in result.metrics}
    exported = result.to_dict()["metric_stats"]
    means = {metric: stats[metric]["mean"] for metric in result.metrics}
    for published in (False, True):
        if published:
            _drain(engine)
        row = _runs_row(client, run_id)
        assert row["metric_averages"] == pytest.approx(means), published
        # Task errors are the run's own: every metric reports the same count.
        assert row["task_error_count"] == stats[result.metrics[0]]["task_error_count"]
        assert row["metric_error_counts"] == {
            metric: stats[metric]["metric_error_count"]
            for metric in result.metrics
            if stats[metric]["metric_error_count"]
        }
    for metric in result.metrics:
        assert exported[metric]["mean"] == pytest.approx(means[metric])
    return stats


@pytest.mark.asyncio
async def test_classic_run_means_and_error_counts_match_the_platform(
    platform, tmp_path
):
    engine, client = platform

    def task(value):
        if value == "3":
            raise RuntimeError("task failed")
        return value

    evaluator = Evaluator(
        task,
        _dataset(),
        _metrics(
            {"0": 0.9, "2": 0.6, "4": 0.3},  # item-1: scorer error
            {"0": 0.5, "1": 0.2, "4": 1.0},  # item-2: scorer error
            {"0": 4.0, "1": 6.0, "4": 8.0},  # item-2: scorer error
        ),
        config=_config(tmp_path, "classic-rule"),
    )
    result = await evaluator.arun(show_tui=False, auto_save=False)
    stats = _assert_run_means_match(client, engine, result, _run_id(engine))

    # The rule by hand: the scorer error and the failed task (item-3) count
    # as 0 for the higher-is-better and the undeclared metric...
    assert stats["qual"]["mean"] == pytest.approx((0.9 + 0 + 0.6 + 0 + 0.3) / 5)
    assert stats["plain"]["mean"] == pytest.approx((0.5 + 0.2 + 0 + 0 + 1.0) / 5)
    assert stats["qual"]["count"] == stats["plain"]["count"] == 5
    # ...and are left out of the lower-is-better mean, and counted.
    assert stats["cost"]["mean"] == pytest.approx((4.0 + 6.0 + 8.0) / 3)
    assert stats["cost"]["count"] == 3
    assert stats["cost"]["errors_left_out"] is True
    assert (
        stats["cost"]["error_count"],
        stats["cost"]["task_error_count"],
        stats["cost"]["metric_error_count"],
    ) == (2, 1, 1)
    assert (stats["cost"]["min"], stats["cost"]["max"]) == (4.0, 8.0)


@pytest.mark.asyncio
async def test_repeat_run_means_passes_and_group_metrics_match_the_platform(
    platform, tmp_path
):
    engine, client = platform
    calls = {}

    def task(value):
        # item-3 fails both passes; item-1 fails pass 1 only. (A task that
        # fails only its last pass is left out here: the platform still reads
        # RunItem.error, the last pass's outcome, for the item; that is a
        # separate review finding.)
        n = calls[value] = calls.get(value, 0) + 1
        if value == "3" or (value == "1" and n == 1):
            raise RuntimeError("task failed")
        return f"{value}:{n}"

    evaluator = Evaluator(
        task,
        _dataset(),
        _metrics(
            # scorer errors: qual on item-2 pass 2, plain and cost on item-0 pass 1
            {"0:1": 0.9, "0:2": 0.8, "1:2": 0.6, "2:1": 0.6, "4:1": 0.3, "4:2": 0.2},
            {"0:2": 0.6, "1:2": 0.3, "2:1": 0.4, "2:2": 0.5, "4:1": 1.0, "4:2": 1.1},
            {"0:2": 2.0, "1:2": 12.0, "2:1": 21.0, "2:2": 22.0, "4:1": 41.0, "4:2": 42.0},
        ),
        samples=2,
        config=_config(tmp_path, "repeat-rule"),
    )
    result = await evaluator.arun(show_tui=False, auto_save=False)
    run_id = _run_id(engine)

    # Group metrics (Pass@k, Pass^k, Avg@k, Max@k, ...) and per-pass means,
    # read before the projection drains.
    for metric in result.metrics:
        group = client.get(
            f"/api/runs/{run_id}/group-metrics?metric={metric}", headers=UI
        ).json()["group"]
        mine = result.group_stats(metric)
        for key in (
            "threshold",
            "total_items",
            "pass_at_k",
            "pass_hat_k",
            "avg_at_k",
            "max_at_k",
            "consistency",
            "reliability",
        ):
            assert mine[key] == pytest.approx(group[key]), (metric, key)
    passes = client.get(f"/api/runs/{run_id}/passes", headers=UI).json()["passes"]
    for entry in passes:
        assert result.pass_means(entry["pass_number"]) == pytest.approx(
            entry["metric_means"]
        )

    stats = _assert_run_means_match(client, engine, result, run_id)
    # Each item is the mean over its passes; an errored pass counts as 0...
    assert stats["qual"]["mean"] == pytest.approx(
        ((0.9 + 0.8) / 2 + (0 + 0.6) / 2 + (0.6 + 0) / 2 + 0 + (0.3 + 0.2) / 2) / 5
    )
    assert stats["plain"]["mean"] == pytest.approx(
        ((0 + 0.6) / 2 + (0 + 0.3) / 2 + (0.4 + 0.5) / 2 + 0 + (1.0 + 1.1) / 2) / 5
    )
    # ...or is left out when lower is better (item-3 has no pass to count).
    assert stats["cost"]["mean"] == pytest.approx((2.0 + 12.0 + 21.5 + 41.5) / 4)
    assert (stats["cost"]["task_error_count"], stats["cost"]["metric_error_count"]) == (
        3,
        1,
    )
    # Lower passes for a lower-is-better metric; an errored pass never does,
    # and Max@k is each item's lowest (best) score.
    group = result.group_stats("cost")
    assert group["direction"] == "minimize" and group["threshold"] == 15.0
    assert group["pass_at_k"] == pytest.approx(2 / 5)  # item-0 and item-1
    assert group["pass_hat_k"] == 0.0
    assert group["max_at_k"] == pytest.approx((2.0 + 12.0 + 21.0 + 41.0) / 4)


@pytest.mark.parametrize("samples", [1, 2])
@pytest.mark.asyncio
async def test_a_metric_reporting_its_own_error_status_counts_as_zero_on_both_sides(
    platform, tmp_path, samples
):
    """A metric may return its own ``metadata.status`` (error, failed,
    timeout) together with a score. That is a scorer error: 0 in the mean of a
    higher-is-better or undeclared metric, and never a pass. The platform
    counts the score it stores, so the SDK records 0 for it (it stored the
    returned score: classic platform mean 0.91 for judged, local 0.54)."""
    engine, client = platform
    calls = {}

    def task(value):
        n = calls[value] = calls.get(value, 0) + 1
        return f"{value}:{n}"

    def judged(output, expected=None):
        if output in ("1:1", "2:2"):
            return MetricResult(score=0.95, label="good", metadata={"status": "error"})
        if output.startswith("3:"):
            return {"score": 0.9, "metadata": {"status": "timeout"}}
        return MetricResult(score=0.9, label="good")

    def plain(output, expected=None):
        if output.startswith("4:"):
            return {"score": 1.0, "metadata": {"status": "failed"}}
        return 0.6

    evaluator = Evaluator(
        task,
        _dataset(),
        [
            Metric(
                judged, score_type="percentage", direction="maximize", pass_threshold=0.5
            ),
            plain,
        ],
        samples=samples,
        config=_config(tmp_path, f"declared-status-{samples}"),
    )
    result = await evaluator.arun(show_tui=False, auto_save=False)
    run_id = _run_id(engine)
    stats = _assert_run_means_match(client, engine, result, run_id)

    assert stats["plain"]["mean"] == pytest.approx((0.6 * 4) / 5)
    if samples == 1:
        assert stats["judged"]["mean"] == pytest.approx((0.9 * 3) / 5)
        assert stats["judged"]["metric_error_count"] == 2
        return
    assert stats["judged"]["mean"] == pytest.approx(
        (0.9 + (0 + 0.9) / 2 + (0.9 + 0) / 2 + 0 + 0.9) / 5
    )
    for metric in result.metrics:
        group = client.get(
            f"/api/runs/{run_id}/group-metrics?metric={metric}", headers=UI
        ).json()["group"]
        mine = result.group_stats(metric)
        for key in ("pass_at_k", "pass_hat_k", "avg_at_k", "max_at_k", "reliability"):
            assert mine[key] == pytest.approx(group[key]), (metric, key)
    # An errored pass is never a pass, whatever score came with the error:
    # item-3 errored on both passes and item-1/item-2 on one each.
    judged_group = result.group_stats("judged")
    assert judged_group["pass_at_k"] == pytest.approx(4 / 5)
    assert judged_group["pass_hat_k"] == pytest.approx(2 / 5)
