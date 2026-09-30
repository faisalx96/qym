"""The SDK's local stats use the platform's error rule (final review, option B).

A task error or scorer error counts as 0 for a higher-is-better metric and for
one that declares no direction, and is left out of the mean (with an error
count) for a lower-is-better metric. Repeat runs judge each pass that way; an
errored pass is never a pass. tests/sdk/test_local_stats_match_platform.py
checks the same numbers against the platform app end to end.
"""

import io

import pytest
from rich.console import Console

from qym import Evaluator, InMemoryDataset
from qym.core.results import EvaluationResult, render_results_summary, score_outcome
from qym.metrics.result import MetricResult
from qym.metrics.spec import Metric, MetricSpec

MAXIMIZE = MetricSpec(score_type="percentage", direction="maximize")
MINIMIZE = MetricSpec(score_type="number", direction="minimize")
UNDECLARED = MetricSpec(score_type="legacy")
SCORER_ERROR = {"score": 0, "error": "judge unavailable"}


def _config(tmp_path, **overrides):
    config = {
        "checkpoint_enabled": False,
        "live_mode": "local",
        "output_dir": str(tmp_path),
        "max_concurrency": 1,
        "max_retries": 0,
        "otel_enabled": False,
        "task_name": "t",
        "run_name": "r",
    }
    config.update(overrides)
    return config


def _dataset(n):
    return InMemoryDataset(
        [{"id": f"i{i}", "input": str(i), "expected_output": str(i)} for i in range(n)]
    )


def _render(result, width=160):
    console = Console(file=io.StringIO(), width=width, color_system=None)
    console.print(render_results_summary([result]))
    return console.file.getvalue()


def _classic(spec, scores, task_errors=()):
    result = EvaluationResult("d", "r", ["m"], metric_specs={"m": spec})
    for index, score in enumerate(scores):
        result.add_result(f"i{index}", {"scores": {"m": score}})
    for item_id in task_errors:
        result.add_error(item_id, "task failed")
    return result


def _repeat(spec, passes_by_item):
    """``passes_by_item``: item -> per-pass score, or None for a failed task."""
    result = EvaluationResult("d", "r", ["m"], metric_specs={"m": spec})
    result.samples = max(len(passes) for passes in passes_by_item.values())
    for item_id, passes in passes_by_item.items():
        for number, score in enumerate(passes, start=1):
            if score is None:
                result.add_pass_error(item_id, number, "task failed")
            else:
                result.add_pass_result(item_id, number, {"scores": {"m": score}})
    return result


# ── the review's repros ──────────────────────────────────────────────


@pytest.mark.parametrize("direction", ["maximize", None])
def test_a_scorer_error_counts_as_zero_in_a_run(tmp_path, direction):
    """4 items, the scorer raises on 1: the platform reads 0.75, and so does
    the local summary (it read 1.0)."""

    def quality(output, expected=None):
        if output == "1":
            raise RuntimeError("judge unavailable")
        return 1.0

    metric = (
        Metric(quality, score_type="percentage", direction=direction)
        if direction
        else quality
    )
    result = Evaluator(
        task=lambda value: value,
        dataset=_dataset(4),
        metrics=[metric],
        config=_config(tmp_path),
    ).run(show_tui=False, auto_save=False)

    stats = result.get_metric_stats("quality")
    assert stats["mean"] == pytest.approx(0.75)
    assert (stats["count"], stats["metric_error_count"]) == (4, 1)
    assert stats["errors_left_out"] is False
    assert stats["success_rate"] == pytest.approx(0.75)
    assert result.to_dict()["metric_stats"]["quality"]["mean"] == pytest.approx(0.75)
    assert "Mean: 0.750" in result.summary()
    assert "1 item errored, counted as 0" in result.summary()


def test_a_task_error_counts_as_zero_for_a_higher_is_better_metric():
    result = _classic(MAXIMIZE, [1.0, 1.0, 1.0], task_errors=["i3"])
    stats = result.get_metric_stats("m")
    assert stats["mean"] == pytest.approx(0.75)
    assert (stats["task_error_count"], stats["error_count"]) == (1, 1)
    assert (stats["min"], stats["max"]) == (0.0, 1.0)


def test_lower_is_better_leaves_an_errored_item_out_and_counts_it(tmp_path):
    """cost = 10 with one errored item: the platform reads 10.0 and 1 error."""

    def task(value):
        if value == "1":
            raise RuntimeError("task failed")
        return value

    def cost(output, expected=None):
        return 10.0

    result = Evaluator(
        task=task,
        dataset=_dataset(4),
        metrics=[Metric(cost, score_type="number", direction="minimize")],
        config=_config(tmp_path),
    ).run(show_tui=False, auto_save=False)

    stats = result.get_metric_stats("cost")
    assert stats["mean"] == pytest.approx(10.0)
    assert (stats["count"], stats["error_count"], stats["task_error_count"]) == (3, 1, 1)
    assert stats["errors_left_out"] is True and stats["direction"] == "minimize"
    assert "1 item errored, left out of the mean (lower is better)" in result.summary()

    # A scorer error is left out the same way.
    scorer = _classic(MINIMIZE, [10.0, SCORER_ERROR, 10.0])
    stats = scorer.get_metric_stats("m")
    assert stats["mean"] == pytest.approx(10.0)
    assert (stats["count"], stats["metric_error_count"]) == (2, 1)


def test_repeat_run_lower_is_better_errors_are_not_the_best_score(tmp_path):
    """cost = 10 on 3 items, 1 item errors on both passes: the platform reads
    10.0 (the local mean was 7.5 with min 0.0), and no pass passes at 0.8
    (the local Pass@k was 0.75)."""

    def task(value):
        if value == "3":
            raise RuntimeError("task failed")
        return value

    def cost(output, expected=None):
        return 10.0

    result = Evaluator(
        task=task,
        dataset=_dataset(4),
        metrics=[Metric(cost, score_type="number", direction="minimize")],
        samples=2,
        config=_config(tmp_path),
    ).run(show_tui=False, auto_save=False)

    stats = result.get_metric_stats("cost")
    assert stats["mean"] == pytest.approx(10.0)
    assert (stats["min"], stats["max"]) == (10.0, 10.0)
    assert (stats["count"], stats["task_error_count"]) == (3, 2)  # 2 passes
    assert stats["ci_low"] == stats["ci_high"] == pytest.approx(10.0)

    group = result.group_stats("cost", threshold=0.8)
    assert group["pass_at_k"] == 0.0 and group["pass_hat_k"] == 0.0
    assert group["avg_at_k"] == pytest.approx(10.0)
    assert group["max_at_k"] == pytest.approx(10.0)  # the best (lowest) score
    assert group["direction"] == "minimize"
    assert result.item_pass_scores("cost")["i3"] == [None, None]
    assert result.pass_means(1) == {"cost": pytest.approx(10.0)}


def test_pass_at_k_for_a_lower_is_better_metric_passes_lower_scores():
    result = _repeat(MINIMIZE, {"a": [0.1, 0.5], "b": [0.5, 0.6], "c": [None, 0.1]})
    group = result.group_stats()
    # No pass_threshold declared: 0.2, as on the platform.
    assert group["threshold"] == 0.2
    assert group["pass_at_k"] == pytest.approx(2 / 3)  # a and c pass once
    assert group["pass_hat_k"] == 0.0
    # Best = lowest score, over the passes that did not error.
    assert group["max_at_k"] == pytest.approx((0.1 + 0.5 + 0.1) / 3)
    assert group["avg_at_k"] == pytest.approx((0.1 + 0.5 + 0.5 + 0.6 + 0.1) / 5)
    assert result.pass_at(1) == pytest.approx((0.5 + 0.0 + 0.5) / 3)
    assert result.pass_hat(2) == 0.0
    # A higher-is-better metric keeps ">= threshold" and its best is the max.
    higher = _repeat(MAXIMIZE, {"a": [0.9, 0.1], "b": [None, 0.85]})
    group = higher.group_stats()
    assert (group["threshold"], group["pass_at_k"], group["pass_hat_k"]) == (0.8, 1.0, 0.0)
    assert group["max_at_k"] == pytest.approx((0.9 + 0.85) / 2)


def test_declared_pass_threshold_is_the_default():
    spec = MetricSpec(score_type="number", direction="minimize", pass_threshold=0.55)
    result = _repeat(spec, {"a": [0.5, 0.6]})
    assert result.group_stats()["threshold"] == 0.55
    assert result.group_stats()["pass_at_k"] == 1.0
    assert result.group_stats(threshold=0.4)["pass_at_k"] == 0.0


# ── repeat runs judge each pass ──────────────────────────────────────


def test_repeat_items_are_the_mean_of_their_counted_passes():
    passes = {
        "a": [1.0, 1.0],
        "b": [None, 0.5],  # failed task on pass 1
        "c": [0.4, SCORER_ERROR],  # scorer error on pass 2
        "d": [0.6, None],  # a failed last pass is judged like any other
    }
    higher = _repeat(MAXIMIZE, passes).get_metric_stats("m")
    assert higher["mean"] == pytest.approx((1.0 + 0.25 + 0.2 + 0.3) / 4)
    assert (higher["task_error_count"], higher["metric_error_count"]) == (2, 1)

    lower = _repeat(MINIMIZE, passes)
    stats = lower.get_metric_stats("m")
    assert stats["mean"] == pytest.approx((1.0 + 0.5 + 0.4 + 0.6) / 4)
    assert (stats["min"], stats["max"]) == (0.4, 1.0)
    assert stats["error_count"] == 3
    # The reduced per-item view follows the same rule.
    assert lower.results["b"]["scores"]["m"] == pytest.approx(0.5)
    assert lower.results["c"]["scores"]["m"] == pytest.approx(0.4)
    assert lower.results["d"]["scores"]["m"] == pytest.approx(0.6)
    assert _repeat(MAXIMIZE, passes).results["d"]["scores"]["m"] == pytest.approx(0.3)
    assert lower.pass_means(2) == {"m": pytest.approx((1.0 + 0.5) / 2)}


def test_every_item_errored_on_a_lower_is_better_metric_has_no_mean():
    result = _repeat(MINIMIZE, {"a": [None, SCORER_ERROR], "b": [None, None]})
    stats = result.get_metric_stats("m")
    assert stats["mean"] is None and stats["min"] is None and stats["std"] is None
    assert stats["ci_low"] is None and stats["count"] == 0 and stats["error_count"] == 4
    group = result.group_stats()
    assert group["avg_at_k"] is None and group["max_at_k"] is None
    assert group["pass_at_k"] == 0.0
    assert result.pass_means(1) == {}
    # The item whose passes all errored keeps its scorer error in the view.
    assert result.results["a"]["scores"]["m"] == SCORER_ERROR
    assert "Mean: n/a" in result.summary()
    text = _render(result)
    assert "n/a" in text and "4 left out" in text and "Min@2 n/a" in text

    classic = _classic(MINIMIZE, [SCORER_ERROR], task_errors=["i1"])
    assert classic.get_metric_stats("m")["mean"] is None
    # A higher-is-better metric still reads 0 (as the platform).
    assert _classic(MAXIMIZE, [SCORER_ERROR]).get_metric_stats("m")["mean"] == 0.0


def test_rich_summary_names_how_errors_counted():
    result = EvaluationResult(
        "d", "r", ["q", "cost"], metric_specs={"q": MAXIMIZE, "cost": MINIMIZE}
    )
    result.add_result("i0", {"scores": {"q": 1.0, "cost": 4.0}})
    result.add_result("i1", {"scores": {"q": SCORER_ERROR, "cost": 6.0}})
    result.add_error("i2", "task failed")
    text = _render(result)
    assert "0.333" in text and "5.000" in text
    assert "2 as 0" in text and "1 left out" in text
    assert "q: 2 items errored, counted as 0" in text
    assert "cost: 1 item errored, left out of the mean (lower is better)" in text


def test_rich_summary_keeps_metric_names_on_a_narrow_terminal():
    """The Errors column must not squeeze the metric name out of an
    80-column panel, and a name is printed as text, not Rich markup."""
    result = EvaluationResult(
        "d", "r", ["answer_correctness", "cost[/x]"],
        metric_specs={"cost[/x]": MINIMIZE},
    )
    result.add_result("i0", {"scores": {"answer_correctness": 0.9, "cost[/x]": 4.0}})
    result.add_result(
        "i1", {"scores": {"answer_correctness": SCORER_ERROR, "cost[/x]": SCORER_ERROR}}
    )
    text = _render(result, width=80)
    assert "Metric" in text and "Errors" in text
    assert "answer_correct" in text and "cost[/x]" in text
    assert "cost[/x]: 1 item" in text


# ── reading stored scores ────────────────────────────────────────────


def test_score_outcome_reads_scores_as_the_platform_does():
    assert score_outcome(True) == (1.0, False)
    assert score_outcome(0.4) == (0.4, False)
    assert score_outcome({"score": 0.4, "metadata": {"reason": "ok"}}) == (0.4, False)
    # A scorer error: an error key, or a declared error status.
    assert score_outcome(SCORER_ERROR) == (None, True)
    assert score_outcome({"score": 0.3, "metadata": {"status": "timeout"}}) == (None, True)
    assert score_outcome(MetricResult(score=0.3, metadata={"status": "error"})) == (
        None,
        True,
    )
    # A blank error key is not an error (the SDK scores it normally).
    assert score_outcome({"score": 0.7, "error": ""}) == (0.7, False)
    # A metric returning a MetricResult (LLM judges) is scored, not skipped.
    assert score_outcome(MetricResult(score=0.9, label="good")) == (0.9, False)
    # A resumed checkpoint writes a scorer error as "ERROR: ...".
    assert score_outcome("ERROR: judge unavailable") == (None, True)
    assert score_outcome({"score": "ERROR: x", "metadata": {}}) == (None, True)
    assert score_outcome("N/A") == (None, False)
    # Only that marker: a label that merely starts with "error" is no error.
    assert score_outcome("Errorless") == (None, False)
    assert score_outcome("error-free") == (None, False)
    assert score_outcome(None) == (None, False)


def test_metric_result_scores_count_in_local_stats(tmp_path):
    def judge(output, expected=None):
        return MetricResult(score=0.9, label="good")

    metric = Metric(judge, score_type="percentage", direction="maximize")
    single = Evaluator(
        task=lambda value: value,
        dataset=_dataset(2),
        metrics=[metric],
        config=_config(tmp_path),
    ).run(show_tui=False, auto_save=False)
    assert single.get_metric_stats("judge")["mean"] == pytest.approx(0.9)
    repeat = Evaluator(
        task=lambda value: value,
        dataset=_dataset(2),
        metrics=[metric],
        samples=2,
        config=_config(tmp_path),
    ).run(show_tui=False, auto_save=False)
    assert repeat.get_metric_stats("judge")["mean"] == pytest.approx(0.9)
    assert repeat.group_stats("judge")["pass_at_k"] == 1.0


def test_specs_set_later_re_reduce_and_no_spec_counts_errors_as_zero():
    result = EvaluationResult("d", "r", ["m"])
    result.samples = 2
    result.add_pass_result("a", 1, {"scores": {"m": 4.0}})
    result.add_pass_error("a", 2, "task failed")
    assert result.metric_direction("m") is None
    assert result.get_metric_stats("m")["mean"] == pytest.approx(2.0)
    assert result.results["a"]["scores"]["m"] == pytest.approx(2.0)

    result.metric_specs = {"m": {"direction": "minimize"}}
    assert result.errors_left_out("m")
    assert result.get_metric_stats("m")["mean"] == pytest.approx(4.0)
    assert result.results["a"]["scores"]["m"] == pytest.approx(4.0)
    assert result.to_dict()["metric_specs"] == {"m": {"direction": "minimize"}}
    # A dict spec's direction reads as the platform reads it (declared_direction).
    result.metric_specs = {"m": {"direction": " Minimize "}}
    assert result.metric_direction("m") == "minimize"


def test_evaluator_hands_its_metric_specs_to_the_result(tmp_path):
    def cost(output, expected=None):
        return 1.0

    result = Evaluator(
        task=lambda value: value,
        dataset=_dataset(1),
        metrics=["exact_match", Metric(cost, score_type="number", direction="minimize")],
        config=_config(tmp_path),
    ).run(show_tui=False, auto_save=False)
    assert result.metric_direction("exact_match") == "maximize"
    assert result.metric_direction("cost") == "minimize"
    specs = result.to_dict()["metric_specs"]
    assert specs["cost"]["direction"] == "minimize"
    assert specs["exact_match"]["score_type"] == "boolean"
