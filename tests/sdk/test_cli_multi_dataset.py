"""QC-30 to QC-37: the repeatable ``--dataset`` of ``qym run create``."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import pytest
from _union_support import fake_platform  # noqa: F401  (pytest fixture)
from typer.testing import CliRunner

from qym import DatasetRef
from qym.cli.app import app

TASK = "def answer(question):\n    return question\n"


class _Stop(Exception):
    pass


@pytest.fixture()
def captured(monkeypatch) -> Dict[str, Any]:
    seen: Dict[str, Any] = {}

    class FakeEvaluator:
        def __init__(self, task, dataset, metrics, config=None, **kwargs):
            seen.update(dataset=dataset, metrics=metrics, config=dict(config or {}), kwargs=kwargs)
            raise _Stop()

    monkeypatch.setattr("qym.core.evaluator.Evaluator", FakeEvaluator)
    return seen


@pytest.fixture()
def task_file(tmp_path: Path) -> Path:
    path = tmp_path / "task.py"
    path.write_text(TASK)
    return path


def _run(task_file: Path, *args: str, json_mode: bool = False):
    argv = (["--json"] if json_mode else []) + [
        "run", "create", "--task-file", str(task_file), "--task-function", "answer",
        "--metrics", "exact_match", "--no-progress", *args,
    ]
    return CliRunner().invoke(app, argv)


def test_single_dataset_is_today_s_call(captured, task_file):
    result = _run(task_file, "--dataset", "support-tickets", "--dataset-version", "v3")
    assert captured["dataset"] == "support-tickets"  # a plain string, not a list
    assert captured["config"]["dataset_version"] == "v3"
    assert "dataset_alias" not in captured["config"]
    assert result.exit_code == 1  # the fake stops the run


def test_repeated_datasets_parse_suffixes(captured, task_file, tmp_path):
    local = tmp_path / "x@y.csv"
    local.write_text("input,expected_output\na,b\n")
    _run(
        task_file,
        "--dataset", "support-tickets@v3",
        "--dataset", "support-tickets@v4",
        "--dataset", "billing-faq@alias:production",
        "--dataset", "plain",
        "--dataset", str(local),
    )
    refs: List[Any] = captured["dataset"]
    assert refs[0] == DatasetRef("support-tickets", version="v3")
    assert refs[1] == DatasetRef("support-tickets", version="v4")
    assert refs[2] == DatasetRef("billing-faq", alias="production")
    assert refs[3] == "plain"
    assert refs[4] == str(local)  # a path is a path, never parsed for @


def test_flags_are_defaults_for_values_without_a_suffix(captured, task_file):
    _run(
        task_file,
        "--dataset", "a@v3", "--dataset", "b",
        "--dataset-version", "v9", "--dataset-alias", "staging",
    )
    assert captured["dataset"] == [DatasetRef("a", version="v3"), "b"]
    # The suffix wins for a; b keeps the default through the config (version wins over alias).
    assert captured["config"]["dataset_version"] == "v9"


def test_suffixed_only_datasets_accept_and_ignore_the_flags(captured, task_file):
    result = _run(task_file, "--dataset", "a@v3", "--dataset", "b@v4", "--dataset-version", "v9")
    assert captured["dataset"] == [DatasetRef("a", version="v3"), DatasetRef("b", version="v4")]
    assert result.exit_code == 1


@pytest.mark.parametrize("value", ["a@", "a@alias:", "@v3"])
def test_malformed_values_are_usage_errors(captured, task_file, value):
    result = _run(task_file, "--dataset", "good", "--dataset", value)
    assert result.exit_code == 2
    assert value in result.output
    assert "dataset" not in captured


def test_dataset_file_is_exclusive_with_a_list(captured, task_file, tmp_path):
    csv_path = tmp_path / "f.csv"
    csv_path.write_text("input,expected_output\na,b\n")
    result = _run(task_file, "--dataset", "a", "--dataset", "b", "--dataset-file", str(csv_path))
    assert result.exit_code == 2
    assert "Provide either --dataset (repeatable) or --dataset-file, not both." in result.output
    single = _run(task_file, "--dataset", "a", "--dataset-file", str(csv_path))
    assert single.exit_code == 2
    assert "Provide exactly one of --dataset or --dataset-file/--dataset-csv." in single.output


def test_more_than_fifty_is_a_usage_error(captured, task_file):
    args: List[str] = []
    for n in range(51):
        args += ["--dataset", f"d{n}@v1"]
    result = _run(task_file, *args)
    assert result.exit_code == 2
    assert "at most 50 datasets per run" in result.output


def test_union_run_prints_datasets_in_json_and_console_lines(task_file, tmp_path):
    first = tmp_path / "first.csv"
    second = tmp_path / "second.csv"
    first.write_text("id,input,expected_output\ni1,a,a\ni2,b,b\n")
    second.write_text("id,input,expected_output\ni1,c,c\n")
    result = CliRunner().invoke(
        app,
        [
            "--json", "run", "create", "--task-file", str(task_file), "--task-function", "answer",
            "--metrics", "exact_match", "--no-progress", "--no-ui", "--csv-id-col", "id",
            "--config", json.dumps({"otel_enabled": False, "checkpoint_enabled": False, "output_dir": str(tmp_path)}),
            "--dataset", str(first), "--dataset", str(second),
        ],
    )
    assert result.exit_code == 0, result.output
    assert "Dataset first.csv: 2 items" in result.output or "first.csv" in result.output
    payload = json.loads(result.stdout[result.stdout.index("{"):])
    assert payload["dataset_name"] == "first.csv + second.csv"
    assert [d["dataset"] for d in payload["datasets"]] == ["first.csv", "second.csv"]
    assert payload["total_items"] == 3


def test_missing_entry_exits_with_not_found(fake_platform, task_file, tmp_path):
    result = _run(task_file, "--dataset", "support-tickets", "--dataset", "billing-faq@v9")
    assert result.exit_code == 3
    assert "Dataset 'billing-faq' version 'v9' not found" in result.output


def test_repeated_resolved_pair_is_a_usage_error(fake_platform, task_file):
    result = _run(task_file, "--dataset", "support-tickets@v3", "--dataset", "support-tickets@alias:production")
    assert result.exit_code == 2
    assert "dataset support-tickets v3 is listed twice" in result.output
