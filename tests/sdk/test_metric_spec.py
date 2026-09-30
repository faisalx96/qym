"""Typed metric declaration and validation tests."""

import pytest

from qym import Metric, MetricSpec
from qym.core.dataset import InMemoryDataset
from qym.core.evaluator import Evaluator
from qym.core.multi_runner import MultiModelRunner


def _dataset():
    return InMemoryDataset([{"input": "x", "expected": "x"}], name="typed")


def test_metric_compact_form_is_resolved_by_evaluator():
    def passed(output, expected):
        return output == expected

    evaluator = Evaluator(
        lambda value: value,
        _dataset(),
        [Metric(passed, score_type="boolean")],
        config={"otel_enabled": False, "live_mode": "local"},
    )

    assert evaluator.metrics == {"passed": passed}
    assert evaluator.metric_specs["passed"].score_type == "boolean"
    # Schema 2: direction is None unless declared (C008).
    assert evaluator._metric_specs_payload()["passed"]["schema_version"] == 2


def test_metric_compact_form_is_preserved_by_parallel_runner():
    def passed(output, expected):
        return output == expected

    metric = Metric(passed, score_type="boolean")
    runner = MultiModelRunner.from_runs(
        [
            {
                "name": "typed-parallel",
                "task": lambda value: value,
                "dataset": _dataset(),
                "metrics": [metric],
                "config": {"otel_enabled": False, "live_mode": "local"},
            }
        ]
    )

    assert runner.specs[0].metrics == [metric]
    assert runner._build_run_matrix()[0]["metrics"] == ["passed"]


@pytest.mark.parametrize(
    ("score_type", "value", "expected"),
    [
        ("boolean", True, 1.0),
        ("boolean", False, 0.0),
        ("boolean", 1, 1.0),
        ("percentage", 0.4, 0.4),
        ("count", 3, 3.0),
        ("number", 0.4, 0.4),
    ],
)
def test_metric_spec_validates_observations(score_type, value, expected):
    assert MetricSpec(score_type=score_type).validate_score(value) == expected


@pytest.mark.parametrize(
    ("score_type", "value"),
    [
        ("boolean", 0.5),
        ("percentage", 1.1),
        ("percentage", True),
        ("count", 2.5),
        ("count", -1),
        ("number", float("inf")),
    ],
)
def test_metric_spec_rejects_ambiguous_or_invalid_observations(score_type, value):
    with pytest.raises((TypeError, ValueError)):
        MetricSpec(score_type=score_type).validate_score(value)


def test_metric_requires_explicit_type_or_spec():
    with pytest.raises(ValueError, match="score_type"):
        Metric(lambda output: 1)


def test_duplicate_metric_names_are_rejected():
    def score(output):
        return 1

    with pytest.raises(ValueError, match="Duplicate metric name"):
        Evaluator(
            lambda value: value,
            _dataset(),
            [Metric(score, score_type="count"), Metric(score, score_type="count")],
            config={"otel_enabled": False, "live_mode": "local"},
        )


def test_direction_is_undeclared_unless_given():
    """C008: an undeclared direction is sent as None (shown neutrally)."""
    assert MetricSpec(score_type="percentage").direction is None
    assert MetricSpec(score_type="percentage").to_dict()["direction"] is None
    assert Metric(lambda o: 1, name="m", score_type="count").spec.direction is None
    spec = MetricSpec(score_type="percentage", direction="minimize")
    assert spec.to_dict()["direction"] == "minimize"
    with pytest.raises(ValueError, match="direction"):
        MetricSpec(score_type="percentage", direction="lower")


def test_builtin_metrics_declare_their_direction():
    from qym.metrics import builtin_metric_specs

    assert builtin_metric_specs["exact_match"].direction == "maximize"
    assert builtin_metric_specs["response_time"].direction == "minimize"
    assert builtin_metric_specs["token_count"].direction == "minimize"
    assert all(spec.direction for spec in builtin_metric_specs.values())


def test_primary_metric_is_declared_in_the_spec_payload():
    def empty(output, expected):
        return output == ""

    def accuracy(output, expected):
        return output == expected

    metrics = [
        Metric(empty, score_type="boolean", direction="minimize"),
        Metric(accuracy, score_type="boolean", direction="maximize"),
    ]
    config = {"otel_enabled": False, "live_mode": "local"}
    evaluator = Evaluator(
        lambda value: value,
        _dataset(),
        metrics,
        config=dict(config),
        primary_metric="accuracy",
    )
    payload = evaluator._metric_specs_payload()
    assert payload["accuracy"]["primary"] is True
    assert "primary" not in payload["empty"]
    assert payload["empty"]["direction"] == "minimize"

    configured = Evaluator(
        lambda value: value,
        _dataset(),
        metrics,
        config={**config, "primary_metric": "empty"},
    )
    assert configured._metric_specs_payload()["empty"]["primary"] is True
    undeclared = Evaluator(lambda value: value, _dataset(), metrics, config=dict(config))
    assert not any(
        spec.get("primary") for spec in undeclared._metric_specs_payload().values()
    )
    with pytest.raises(ValueError, match="primary_metric"):
        Evaluator(
            lambda value: value,
            _dataset(),
            metrics,
            config=dict(config),
            primary_metric="missing",
        )
