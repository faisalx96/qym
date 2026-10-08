"""SDK ``versioning_details``: config, create_run payload, Evaluator, CLI."""

from __future__ import annotations

import json
from typing import Any, Dict, List

import pytest
from pydantic import ValidationError
from typer.testing import CliRunner

from qym.cli._platform_api import PlatformAPIClient
from qym.cli.app import app
from qym.cli.run import parse_versioning_details
from qym.core.config import EvaluatorConfig, normalize_versioning_details
from qym.core.dataset import CsvDataset
from qym.core.evaluator import Evaluator
from qym.platform import client as client_module


# ------------------------------------------------------------------ config


def test_config_defaults_to_empty_and_normalizes():
    assert EvaluatorConfig().versioning_details == {}
    config = EvaluatorConfig(
        versioning_details={" agent_version ": "v2", "kb": 381, "drop": None}
    )
    assert config.versioning_details == {"agent_version": "v2", "kb": 381}


@pytest.mark.parametrize(
    "bad",
    [
        "agent=v2",
        {"": "blank"},
        {"k" * 101: 1},
        {f"k{i}": i for i in range(51)},
        {"big": "x" * 16_001},
    ],
)
def test_config_refuses_invalid_details(bad):
    with pytest.raises(ValidationError):
        EvaluatorConfig(versioning_details=bad)
    with pytest.raises(ValueError):
        normalize_versioning_details(bad)


# ------------------------------------------------------------------ client


def _capture_post(monkeypatch) -> List[Dict[str, Any]]:
    payloads: List[Dict[str, Any]] = []

    def fake_post_json(url, payload, api_key, *, timeout=30):
        payloads.append(payload)
        return {"run_id": "run-1", "live_url": "https://p.example/runs/run-1"}

    monkeypatch.setattr(client_module, "_post_json", fake_post_json)
    return payloads


def _create(**extra):
    return client_module.PlatformClient("https://p.example", "key").create_run(
        external_run_id=None,
        task="t",
        dataset="d",
        model=None,
        metrics=[],
        run_metadata={},
        run_config={},
        **extra,
    )


def test_create_run_sends_versioning_details_only_when_set(monkeypatch):
    payloads = _capture_post(monkeypatch)
    _create()
    _create(versioning_details={})
    _create(versioning_details={"agent_version": "v2"})
    assert "versioning_details" not in payloads[0]
    assert "versioning_details" not in payloads[1]
    assert payloads[2]["versioning_details"] == {"agent_version": "v2"}


# ------------------------------------------------------------------ evaluator


@pytest.mark.asyncio
async def test_evaluator_sends_details_and_keeps_them_on_the_result(
    tmp_path, monkeypatch
):
    p = tmp_path / "qa.csv"
    p.write_text("q,a\nhello,hello\n", encoding="utf-8")
    created: List[Dict[str, Any]] = []

    class FakeHandle:
        run_id = "platform-run-1"
        live_url = "http://example/live/platform-run-1"

    class FakePlatformClient:
        def __init__(self, platform_url=None, api_key=None):
            pass

        def create_run(self, **kwargs):
            created.append(kwargs)
            return FakeHandle()

    class FakeStream:
        def __init__(self, platform_url=None, api_key=None, run_id=None):
            pass

        def emit(self, event_type, payload, sync=False):
            return None

        def close(self):
            return None

    monkeypatch.setattr("qym.core.evaluator.PlatformClient", FakePlatformClient)
    monkeypatch.setattr("qym.core.evaluator.PlatformEventStream", FakeStream)
    evaluator = Evaluator(
        task=lambda input_data: input_data,
        dataset=CsvDataset(p, input_col="q", expected_col="a"),
        metrics=[],
        config={
            "run_name": "versioned",
            "task_name": "echo_task",
            "output_dir": str(tmp_path / "results"),
            "otel_enabled": False,
            "platform_api_key": "k",
            "platform_url": "http://example",
            "versioning_details": {"agent_version": "v2", "kb": 381},
        },
    )
    result = await evaluator.arun(show_tui=False, auto_save=False)

    assert created[0]["versioning_details"] == {"agent_version": "v2", "kb": 381}
    assert result.versioning_details == {"agent_version": "v2", "kb": 381}
    assert result.to_dict()["versioning_details"] == {"agent_version": "v2", "kb": 381}


# ------------------------------------------------------------------ CLI


def test_parse_versioning_details_merges_json_then_pairs():
    assert parse_versioning_details(
        ["agent_version=v3", "url=a=b"], '{"agent_version": "v2", "kb": 381}'
    ) == {"agent_version": "v3", "kb": 381, "url": "a=b"}
    assert parse_versioning_details() == {}


@pytest.mark.parametrize(
    "entries,text",
    [(["novalue"], None), (["=v"], None), (None, "{bad"), (None, "[1, 2]")],
)
def test_parse_versioning_details_refuses_bad_input(entries, text):
    with pytest.raises(ValueError):
        parse_versioning_details(entries, text)


def test_run_create_rejects_bad_versioning_detail_with_usage_error():
    result = CliRunner().invoke(
        app,
        [
            "--json",
            "run",
            "create",
            "--task-file",
            "x.py",
            "--task-function",
            "f",
            "--dataset",
            "d",
            "--metrics",
            "exact_match",
            "--versioning-detail",
            "no-equals-sign",
        ],
    )
    assert result.exit_code == 2, result.output


def test_run_create_passes_versioning_details_to_the_evaluator(tmp_path, monkeypatch):
    task_file = tmp_path / "task.py"
    task_file.write_text("def f(x):\n    return x\n", encoding="utf-8")
    seen: Dict[str, Any] = {}

    class FakeResult:
        run_name = "r"
        success_rate = 1.0
        interrupted = False
        html_url = None

        def to_dict(self):
            return {"run_name": "r"}

    class FakeEvaluator:
        def __init__(self, task, dataset, metrics, config, model=None):
            seen.update(config)

        def run(self, show_progress=True, show_table=True):
            return FakeResult()

    monkeypatch.setattr("qym.core.evaluator.Evaluator", FakeEvaluator)
    monkeypatch.delenv("QYM_API_KEY", raising=False)
    result = CliRunner().invoke(
        app,
        [
            "--json",
            "run",
            "create",
            "--task-file",
            str(task_file),
            "--task-function",
            "f",
            "--dataset",
            "d",
            "--metrics",
            "exact_match",
            "--config",
            json.dumps({"versioning_details": {"suite": "nightly", "kb": 1}}),
            "--versioning-details",
            '{"kb": 381}',
            "--versioning-detail",
            "agent_version=v2",
        ],
    )
    assert result.exit_code == 0, result.output
    assert seen["versioning_details"] == {
        "suite": "nightly",
        "kb": 381,
        "agent_version": "v2",
    }


def test_run_list_json_rows_always_carry_versioning_details(monkeypatch):
    rows = [
        {"run_id": "a", "timestamp": "2", "versioning_details": {"agent": "v2"}},
        {"run_id": "legacy", "timestamp": "1"},
    ]

    def fake_get(self, path, timeout=30):
        return {"tasks": {"qa": {"m": [dict(r) for r in rows]}}}

    monkeypatch.setattr(PlatformAPIClient, "_get", fake_get)
    result = CliRunner().invoke(app, ["--json", "run", "list"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.stdout)
    by_id = {row["run_id"]: row for row in data["runs"]}
    assert by_id["a"]["versioning_details"] == {"agent": "v2"}
    assert by_id["legacy"]["versioning_details"] == {}
