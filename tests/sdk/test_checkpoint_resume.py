import pytest

from qym.core.checkpoint import (
    CheckpointWriter,
    load_checkpoint_state,
    iter_checkpoint_rows,
    parse_checkpoint_row,
    serialize_checkpoint_row,
)


def test_checkpoint_round_trip(tmp_path):
    path = tmp_path / "checkpoint.csv"
    writer = CheckpointWriter(str(path), metrics=["m1"])
    writer.open()

    row = serialize_checkpoint_row(
        dataset_name="ds",
        run_name="run",
        run_metadata={},
        run_config={},
        trace_id="t1",
        item_id="item_0",
        item_input="input",
        item_metadata={"a": 1},
        output="out",
        expected_output="exp",
        time_seconds=0.2,
        task_started_at_ms=123,
        scores={"m1": 0.75},
        metric_meta={"m1": {"note": "ok"}},
    )
    writer.append_row(row)
    writer.close()

    state = load_checkpoint_state(str(path))
    assert state is not None
    assert state.completed_item_ids == {"item_0"}
    assert state.error_item_ids == set()

    rows = list(iter_checkpoint_rows(str(path)))
    assert len(rows) == 1
    item_id, result, is_error = parse_checkpoint_row(rows[0], ["m1"])
    assert item_id == "item_0"
    assert is_error is False
    score = result["scores"]["m1"]
    assert isinstance(score, dict)
    assert score["score"] == 0.75


def _round_trip(tmp_path, score, *, output="out"):
    """Write one score as the evaluator does and read it back on resume."""
    from qym.core.checkpoint import checkpoint_score

    cell, meta = checkpoint_score(score)
    return _read_back(tmp_path, cell, meta, output=output)


def _read_back(tmp_path, cell, meta=None, *, output="out"):
    path = tmp_path / "checkpoint.csv"
    path.unlink(missing_ok=True)
    writer = CheckpointWriter(str(path), metrics=["judge"])
    writer.open()
    writer.append_row(
        serialize_checkpoint_row(
            dataset_name="ds",
            run_name="run",
            run_metadata={},
            run_config={},
            trace_id="",
            item_id="item_0",
            item_input="input",
            item_metadata={},
            output=output,
            expected_output="exp",
            time_seconds=0.1,
            task_started_at_ms=None,
            scores={"judge": cell},
            metric_meta={"judge": meta} if meta else {},
        )
    )
    writer.close()
    state = load_checkpoint_state(str(path))
    row = next(iter(iter_checkpoint_rows(str(path))))
    _, result, is_error = parse_checkpoint_row(row, ["judge"])
    assert is_error == (state.error_item_ids == {"item_0"})
    return row["judge_score"], result["scores"]["judge"], is_error


def test_metric_result_is_written_as_its_number(tmp_path):
    from qym.core.results import score_outcome
    from qym.metrics.result import MetricResult

    healthy = MetricResult(score=0.1, label="NO_ERROR", explanation="ERROR: none", kind="llm")
    cell, score, is_error = _round_trip(tmp_path, healthy)
    assert (cell, is_error) == ("0.1", False)
    assert score_outcome(score) == (0.1, False)
    assert score["metadata"] == {"label": "NO_ERROR", "explanation": "ERROR: none", "kind": "llm"}

    failed = MetricResult(score=0.0, metadata={"status": "timeout", "error": "slow judge"})
    cell, score, is_error = _round_trip(tmp_path, failed)
    assert (cell, is_error) == ("ERROR: slow judge", False)
    assert score_outcome(score) == (None, True)


def test_scorer_error_on_the_first_metric_is_not_a_failed_task(tmp_path):
    from qym.core.results import score_outcome

    cell, score, is_error = _round_trip(tmp_path, {"score": 0, "error": "judge down"})
    assert (cell, is_error) == ("ERROR: judge down", False)
    assert score_outcome(score) == (None, True)
    # The failed-task row the evaluator writes is still one.
    _, score, is_error = _read_back(tmp_path, "N/A", output="ERROR: task raised")
    assert is_error is True
    # An output that only starts like the marker, with a score, is a result.
    _, score, is_error = _read_back(tmp_path, 0.5, output="ERROR: the model said so")
    assert (is_error, score) == (False, 0.5)


def test_legacy_metric_result_text_is_read_without_running_it(tmp_path):
    from qym.core.results import score_outcome

    legacy = (
        "MetricResult(score=0.9, label='NO_ERROR', explanation='ERROR: none', "
        "kind='llm', direction='maximize', metadata={'judge_model': 'x'})"
    )
    _, score, is_error = _read_back(tmp_path, legacy)
    assert is_error is False
    assert score_outcome(score) == (0.9, False)
    assert score["metadata"] == {
        "judge_model": "x",
        "label": "NO_ERROR",
        "explanation": "ERROR: none",
        "kind": "llm",
    }

    legacy_error = "MetricResult(score=0.0, label=None, explanation=None, kind='code', direction='maximize', metadata={'status': 'error', 'error': 'boom'})"
    _, score, _ = _read_back(tmp_path, legacy_error)
    assert score_outcome(score) == (None, True)


@pytest.mark.parametrize(
    "unreadable",
    [
        "MetricResult(score=nan, label=None, metadata={})",
        "MetricResult(score=0.5, label=None, metadata={'at': datetime.datetime(2026, 1, 1)})",
        "MetricResult(score=__import__('os').system('exit 1'), metadata={})",
        "MetricResult(score='0.5', metadata={})",
        "MetricResult(score=0.5, metadata={}",
    ],
)
def test_unreadable_legacy_score_is_unavailable_not_guessed(tmp_path, unreadable):
    from qym.core.checkpoint import UNREADABLE_SCORE_KEY
    from qym.core.results import score_outcome

    _, score, is_error = _read_back(tmp_path, unreadable)
    assert is_error is False
    assert score_outcome(score) == (None, False)
    assert score["metadata"][UNREADABLE_SCORE_KEY] is True


@pytest.mark.parametrize("unscored", [None, "", "N/A"])
def test_unscored_value_stays_unscored(tmp_path, unscored):
    from qym.core.results import score_outcome

    _, score, is_error = _read_back(tmp_path, unscored)
    assert is_error is False
    assert score_outcome(score) == (None, False)
