"""Metric direction and primary metric come from the run spec (C008).

One rule for every page: the declared direction decides colors, pass/fail,
"best", winners, Sweep verdicts and rankings; a metric without one is shown
neutrally. Views open on the declared primary metric, else the first metric
by spec position (never alphabetical order).
"""

import pytest
from _support_a1 import share_with_react
from fastapi import HTTPException
from qym_platform.api import ingest as ingest_api
from qym_platform.api import runs as runs_api
from qym_platform.auth import Principal
from qym_platform.db.models import (
    RunItemPassScore,
    RunMetricSpec,
    RunWorkflowStatus,
    User,
)
from qym_platform.services.metric_semantics import declared_direction
from sqlalchemy.orm import Session
from test_dashboard_durable_summaries import (
    drain,
    item,
    legacy,
    projected,
    run,
)

# ── one rule: the React lib/metrics.ts and the server agree ─────────────────────────────


SPEC_CASES = [
    (None, None),
    ({}, None),
    ({"score_type": "boolean", "direction": None}, None),
    # Pre-2026-09 SDKs sent "maximize" by default for plain callables.
    ({"score_type": "legacy", "direction": "maximize"}, None),
    ({"score_type": "legacy", "direction": "minimize"}, "minimize"),
    ({"score_type": "percentage", "direction": "maximize"}, "maximize"),
    ({"score_type": "boolean", "direction": "minimize"}, "minimize"),
    ({"score_type": "count", "direction": "sideways"}, None),
    # Schema 2 SDKs send no direction unless declared, so an explicit
    # "maximize" on a plain-callable (legacy) metric is a declaration.
    ({"schema_version": 1, "score_type": "legacy", "direction": "maximize"}, None),
    ({"schema_version": 2, "score_type": "legacy", "direction": "maximize"}, "maximize"),
    ({"schema_version": 2, "score_type": "legacy", "direction": None}, None),
]


def test_explicit_direction_on_a_legacy_metric_survives_ingest():
    """``Metric(fn, score_type="legacy", direction="maximize")`` is declared."""
    from qym.metrics.spec import Metric

    def judged(output, expected):
        return 1.0

    declared = Metric(judged, score_type="legacy", direction="maximize").spec.to_dict()
    assert declared_direction(ingest_api._normalized_metric_spec(declared)) == "maximize"
    # SDK 2.1.0: an undeclared direction is "maximize" again; an explicit None stays neutral.
    undeclared = Metric(judged, score_type="legacy").spec.to_dict()
    assert declared_direction(ingest_api._normalized_metric_spec(undeclared)) == "maximize"
    neutral = Metric(judged, score_type="legacy", direction=None).spec.to_dict()
    assert declared_direction(ingest_api._normalized_metric_spec(neutral)) is None
    # A newer SDK resuming a run a schema 1 SDK started is not a spec change.
    stored = _spec(score_type="legacy", schema_version=1, direction="maximize")
    assert ingest_api._metric_spec_unchanged(
        stored, ingest_api._normalized_metric_spec(undeclared)
    )


@pytest.mark.parametrize("spec, expected", SPEC_CASES)
def test_server_reads_the_declared_direction(spec, expected):
    assert declared_direction(spec) == expected


def test_client_reads_the_same_direction():
    """The React lib/metrics.ts metricDirection reads every case the server does:
    frontend/src/lib/__tests__/cutover-metric-rules.test.ts."""
    share_with_react(
        "metric_direction_cases",
        {"cases": [[spec, expected] for spec, expected in SPEC_CASES]},
    )


# ── server: ingest stores what the SDK declares ─────────────────────────────


def test_ingest_keeps_an_undeclared_direction_and_the_primary_flag():
    normalized = ingest_api._normalized_metric_spec({"score_type": "boolean"})
    assert normalized["direction"] is None
    assert normalized["is_primary"] is False
    declared = ingest_api._normalized_metric_spec(
        {"score_type": "percentage", "direction": "minimize", "primary": True}
    )
    assert declared["direction"] == "minimize"
    assert declared["is_primary"] is True
    with pytest.raises(HTTPException) as exc:
        ingest_api._normalized_metric_spec({"score_type": "boolean", "direction": "down"})
    assert exc.value.status_code == 422


def _spec(**overrides):
    values = dict(
        run_id="r",
        metric_name="empty",
        position=0,
        schema_version=1,
        score_type="boolean",
        direction="maximize",
        pass_threshold=None,
        sample_reducer="mean",
        run_reducer="mean",
        unit=None,
        precision=None,
        is_primary=None,
    )
    values.update(overrides)
    return RunMetricSpec(**values)


def test_resumed_run_from_a_newer_sdk_is_not_a_spec_change():
    # Stored before this change: the old defaults ("maximize", no primary).
    stored = _spec()
    resent = ingest_api._normalized_metric_spec({"score_type": "boolean", "primary": True})
    assert ingest_api._metric_spec_unchanged(stored, resent)
    assert not ingest_api._metric_spec_unchanged(
        stored, ingest_api._normalized_metric_spec({"score_type": "percentage"})
    )
    assert not ingest_api._metric_spec_unchanged(
        _spec(direction=None, is_primary=False),
        ingest_api._normalized_metric_spec({"score_type": "boolean", "direction": "minimize"}),
    )


def test_run_payload_exposes_direction_and_primary(database):
    with Session(database) as db:
        run(db, metrics=["empty", "accuracy"], status=RunWorkflowStatus.COMPLETED)
        db.add(_spec(direction=None, is_primary=None))
        db.add(
            _spec(
                metric_name="accuracy",
                position=1,
                direction="maximize",
                is_primary=True,
            )
        )
        db.commit()
        specs = runs_api._metric_specs_for_runs(db, ["r"])["r"]
    assert list(specs) == ["empty", "accuracy"]
    assert specs["empty"]["direction"] is None
    assert specs["empty"]["primary"] is False
    assert specs["accuracy"]["primary"] is True


# ── server: repeat group metrics follow the direction ──────────────────────


def _seed_repeat(db, *, direction, primary=None):
    run(
        db,
        metrics=["accuracy", "empty"],
        samples=2,
        status=RunWorkflowStatus.COMPLETED,
        run_metadata={"total_items": 2, "last_completed_pass": 2},
    )
    for item_id in ("a", "b"):
        item(db, item_id=item_id)
    db.add(_spec(metric_name="accuracy", position=0, direction="maximize"))
    db.add(
        _spec(metric_name="empty", position=1, direction=direction, is_primary=primary)
    )
    # empty: item a is never empty (0, 0); item b is empty once (1, 0).
    for item_id, scores in (("a", (0.0, 0.0)), ("b", (1.0, 0.0))):
        for pass_number, score in enumerate(scores, start=1):
            db.add(
                RunItemPassScore(
                    run_id="r",
                    item_id=item_id,
                    metric_name="empty",
                    pass_number=pass_number,
                    score_numeric=score,
                )
            )
            db.add(
                RunItemPassScore(
                    run_id="r",
                    item_id=item_id,
                    metric_name="accuracy",
                    pass_number=pass_number,
                    score_numeric=1.0,
                )
            )
    db.commit()


def test_group_metrics_pass_lower_is_better_scores_and_default_to_primary(database):
    with Session(database) as db:
        _seed_repeat(db, direction="minimize", primary=True)
        principal = Principal(user=db.get(User, "u"), auth_type="none")
        payload = runs_api.run_group_metrics("r", metric=None, threshold=None, db=db, principal=principal)
    # The declared primary metric, its direction and the minimize default threshold.
    assert payload["metric"] == "empty"
    assert payload["direction"] == "minimize"
    assert payload["threshold"] == pytest.approx(0.2)
    group = payload["group"]
    # Passing = not empty: item a passes both passes, item b one of two.
    assert group["pass_at_k"] == pytest.approx(1.0)
    assert group["pass_hat_k"] == pytest.approx(0.5)
    assert group["max_at_k"] == pytest.approx(0.0)
    assert payload["distribution"] == [0, 1, 1]


def test_group_metrics_without_primary_use_the_first_metric(database):
    with Session(database) as db:
        _seed_repeat(db, direction=None)
        principal = Principal(user=db.get(User, "u"), auth_type="none")
        payload = runs_api.run_group_metrics("r", metric=None, threshold=None, db=db, principal=principal)
        empty = runs_api.run_group_metrics("r", metric="empty", threshold=None, db=db, principal=principal)
    assert payload["metric"] == "accuracy"
    assert payload["direction"] == "maximize"
    assert empty["direction"] is None
    assert empty["threshold"] == pytest.approx(0.8)


def test_pass_summaries_score_the_declared_primary_metric(database):
    """The runs list drawer paints pass_summaries first; its value must be
    the declared primary metric's, and say which metric it is."""
    with Session(database) as db:
        _seed_repeat(db, direction="minimize", primary=True)
        principal = Principal(user=db.get(User, "u"), auth_type="none")
        passes = runs_api.run_passes("r", db, principal)["passes"]
    expected = {p["pass_number"]: p["metric_means"]["empty"] for p in passes}
    assert expected == {1: pytest.approx(0.5), 2: pytest.approx(0.0)}
    drain(database)
    for name, summary in (("projected", projected(database)), ("legacy", legacy(database))):
        summaries = summary["pass_summaries"]
        assert [s["primary_metric"] for s in summaries] == ["empty", "empty"], name
        assert {s["pass_number"]: s["primary_score"] for s in summaries} == expected, name


def test_server_primary_metric_rule_matches_the_client():
    from qym_platform.services.metric_semantics import primary_metric

    assert primary_metric(["a", "b"], {}) == "a"
    assert primary_metric(["a", "b"], {"b": {"primary": True}}) == "b"
    assert primary_metric(["a", "b"], {"b": {"primary": False}}) == "a"
    assert primary_metric([], {}) is None
    # The client rule (React lib/metrics.ts defaultMetricName) is pinned to the same
    # cases in cutover-metric-rules.test.ts.
