"""`qym run list --versioning KEY=VALUE` and the SDK's versioning_metadata filter."""

from __future__ import annotations

import json
from typing import Any, List

import pytest
from typer.testing import CliRunner

from qym.cli._platform_api import (
    PlatformAPIClient,
    parse_versioning_filters,
    run_matches_versioning,
)
from qym.cli.app import app
from qym.platform import PlatformClient

RUNS = [
    {
        "run_id": "run-a",
        "task_name": "qa",
        "model_name": "gpt-x",
        "status": "completed",
        "timestamp": "2026-09-03T10:00:00Z",
        "origin": "official",
        "versioning": {"agent_version": "v1", "kb_version": "381"},
    },
    {
        "run_id": "run-b",
        "task_name": "qa",
        "model_name": "gpt-x",
        "status": "completed",
        "timestamp": "2026-09-02T10:00:00Z",
        "origin": "official",
        "versioning": {"agent_version": "v2", "prompt_version": "p7"},
    },
    # A row from a platform that predates versioning.
    {
        "run_id": "run-legacy",
        "task_name": "qa",
        "model_name": "gpt-x",
        "status": "completed",
        "timestamp": "2026-09-01T10:00:00Z",
    },
]


@pytest.fixture
def get_paths(monkeypatch) -> List[str]:
    """Stub PlatformAPIClient._get like a platform that ignores the filter."""
    paths: List[str] = []

    def fake_get(self: Any, path: str, timeout: int = 30) -> Any:
        paths.append(path)
        return {"tasks": {"qa": {"gpt-x": [dict(run) for run in RUNS]}}}

    monkeypatch.setattr(PlatformAPIClient, "_get", fake_get)
    return paths


def _run_ids(data: dict) -> List[str]:
    return [
        run["run_id"]
        for models in data["tasks"].values()
        for runs in models.values()
        for run in runs
    ]


def test_parse_versioning_filters() -> None:
    assert parse_versioning_filters(None) == {}
    assert parse_versioning_filters(
        ["agent_version=v1", "agent_version=v2", "agent_version=v1", "kb_version=a=b"]
    ) == {"agent_version": ["v1", "v2"], "kb_version": ["a=b"]}
    for bad in (["agent_version"], ["=v1"]):
        with pytest.raises(ValueError):
            parse_versioning_filters(bad)


def test_run_matches_versioning() -> None:
    run = {"versioning": {"agent_version": "v1", "kb_version": 381}}
    assert run_matches_versioning(run, {})
    assert run_matches_versioning(run, {"agent_version": ["v1", "v2"]})
    assert run_matches_versioning(run, {"kb_version": ["381"]})
    assert not run_matches_versioning(
        run, {"agent_version": ["v1"], "kb_version": ["1"]}
    )
    assert run_matches_versioning(run, {"prompt_version": ["__empty__"]})
    assert run_matches_versioning({}, {"agent_version": ["__empty__"]})
    assert not run_matches_versioning({}, {"agent_version": ["v1"]})


def test_list_runs_sends_versioning_and_filters_locally(get_paths) -> None:
    data = PlatformAPIClient(platform_url="https://p.example").list_runs(
        origin="official", versioning=["agent_version=v1", "kb_version=381"]
    )
    assert get_paths == [
        "/api/runs?origin=official&versioning=agent_version%3Dv1"
        "&versioning=kb_version%3D381"
    ]
    assert _run_ids(data) == ["run-a"]


def test_list_runs_invalid_versioning_raises_before_request(get_paths) -> None:
    with pytest.raises(ValueError):
        PlatformAPIClient(platform_url="https://p.example").list_runs(
            versioning=["agent_version"]
        )
    assert get_paths == []


def test_platform_client_list_runs_delegates_with_versioning(get_paths) -> None:
    client = PlatformClient("https://platform.example/", "key-123")
    data = client.list_runs(versioning=["prompt_version=p7"])
    assert get_paths == ["/api/runs?versioning=prompt_version%3Dp7"]
    assert _run_ids(data) == ["run-b"]


def test_cli_run_list_versioning_json(get_paths) -> None:
    result = CliRunner().invoke(
        app,
        [
            "--json",
            "run",
            "list",
            "--versioning",
            "agent_version=v1",
            "--versioning",
            "agent_version=v2",
        ],
    )
    assert result.exit_code == 0, result.output
    runs = json.loads(result.stdout)["runs"]
    assert [run["run_id"] for run in runs] == ["run-a", "run-b"]
    assert runs[1]["versioning"] == {"agent_version": "v2", "prompt_version": "p7"}


def test_cli_run_list_json_always_includes_versioning(get_paths) -> None:
    result = CliRunner().invoke(app, ["--json", "run", "list"])
    assert result.exit_code == 0, result.output
    runs = {run["run_id"]: run for run in json.loads(result.stdout)["runs"]}
    assert runs["run-legacy"]["versioning"] == {}


def test_cli_run_list_invalid_versioning_is_usage_error(get_paths) -> None:
    result = CliRunner().invoke(app, ["--json", "run", "list", "--versioning", "v1"])
    assert result.exit_code == 2
    assert get_paths == []
    err = json.loads(result.stdout)
    assert err["error"] == "usage_error"
    assert "KEY=VALUE" in err["message"]
