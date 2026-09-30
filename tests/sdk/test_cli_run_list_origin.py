"""`qym run list --origin` and the SDK run-listing origin filter (#41, plan §11)."""

from __future__ import annotations

import json
from typing import Any, List

import pytest
from typer.testing import CliRunner

from qym.cli._platform_api import PlatformAPIClient, normalize_run_origin
from qym.cli.app import app
from qym.platform import PlatformClient

OFFICIAL_RUN = {
    "run_id": "run-official-1",
    "task_name": "qa",
    "model_name": "gpt-x",
    "status": "completed",
    "success_rate": 0.9,
    "total_items": 10,
    "timestamp": "2026-09-02T10:00:00Z",
    "origin": "official",
    "experiment": {"id": "exp-1", "name": "Nightly sweep", "job_id": "job-1"},
}
LOCAL_RUN = {
    "run_id": "run-local-1",
    "task_name": "qa",
    "model_name": "gpt-x",
    "status": "completed",
    "success_rate": 0.5,
    "total_items": 10,
    "timestamp": "2026-09-01T10:00:00Z",
    "origin": "local",
    "experiment": None,
}
# A row from a platform that predates run origins.
LEGACY_RUN = {
    "run_id": "run-legacy-1",
    "task_name": "summarize",
    "model_name": "gpt-y",
    "status": "completed",
    "success_rate": 0.7,
    "total_items": 5,
    "timestamp": "2026-08-01T10:00:00Z",
}


def _payload() -> dict:
    return {
        "tasks": {
            "qa": {"gpt-x": [dict(OFFICIAL_RUN), dict(LOCAL_RUN)]},
            "summarize": {"gpt-y": [dict(LEGACY_RUN)]},
        }
    }


@pytest.fixture
def get_paths(monkeypatch) -> List[str]:
    """Stub PlatformAPIClient._get; record requested paths."""
    paths: List[str] = []

    def fake_get(self: Any, path: str, timeout: int = 30) -> Any:
        paths.append(path)
        return _payload()

    monkeypatch.setattr(PlatformAPIClient, "_get", fake_get)
    return paths


def _invoke(*args: str):
    return CliRunner().invoke(app, list(args))


# ── SDK client ──────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw, expected",
    [(None, None), ("", None), ("official", "official"), (" Local ", "local"), ("ALL", "all")],
)
def test_normalize_run_origin(raw, expected) -> None:
    assert normalize_run_origin(raw) == expected


def test_normalize_run_origin_rejects_unknown_values() -> None:
    with pytest.raises(ValueError, match="official, local, all"):
        normalize_run_origin("remote")


def test_list_runs_passes_origin_and_keeps_origin_fields(get_paths) -> None:
    client = PlatformAPIClient(platform_url="https://platform.example")

    data = client.list_runs(origin="official")

    assert get_paths == ["/api/runs?origin=official"]
    # Rows from a server that ignored the filter are filtered client-side too.
    assert data["tasks"] == {"qa": {"gpt-x": [OFFICIAL_RUN]}}


def test_list_runs_without_origin_sends_no_filter(get_paths) -> None:
    PlatformAPIClient(platform_url="https://platform.example").list_runs()
    PlatformAPIClient(platform_url="https://platform.example").list_runs(origin="all")

    assert get_paths == ["/api/runs", "/api/runs?origin=all"]


def test_list_runs_local_includes_rows_without_origin(get_paths) -> None:
    data = PlatformAPIClient(platform_url="https://p.example").list_runs(origin="local")

    assert data["tasks"] == {
        "qa": {"gpt-x": [LOCAL_RUN]},
        "summarize": {"gpt-y": [LEGACY_RUN]},
    }


def test_list_runs_invalid_origin_raises_before_request(get_paths) -> None:
    with pytest.raises(ValueError):
        PlatformAPIClient(platform_url="https://p.example").list_runs(origin="bogus")
    assert get_paths == []


def test_platform_client_list_runs_delegates_with_origin(get_paths) -> None:
    client = PlatformClient("https://platform.example/", "key-123")

    data = client.list_runs(origin="official")

    assert get_paths == ["/api/runs?origin=official"]
    assert data["tasks"]["qa"]["gpt-x"][0]["experiment"]["name"] == "Nightly sweep"
    with pytest.raises(ValueError):
        client.list_runs(origin="nope")


# ── CLI integration ─────────────────────────────────────────


def test_cli_run_list_origin_official_json(get_paths) -> None:
    result = _invoke("--json", "run", "list", "--origin", "official")

    assert result.exit_code == 0, result.output
    assert get_paths == ["/api/runs?origin=official"]
    body = json.loads(result.stdout)
    assert body["total"] == 1
    run = body["runs"][0]
    assert run["run_id"] == "run-official-1"
    assert run["origin"] == "official"
    assert run["experiment"] == {"id": "exp-1", "name": "Nightly sweep", "job_id": "job-1"}


def test_cli_run_list_json_always_includes_origin(get_paths) -> None:
    result = _invoke("--json", "run", "list")

    assert result.exit_code == 0, result.output
    assert get_paths == ["/api/runs"]
    runs = {r["run_id"]: r for r in json.loads(result.stdout)["runs"]}
    assert runs["run-official-1"]["origin"] == "official"
    assert runs["run-local-1"]["origin"] == "local"
    assert runs["run-legacy-1"]["origin"] == "local"
    assert runs["run-legacy-1"]["experiment"] is None


def test_cli_run_list_invalid_origin_is_usage_error(get_paths) -> None:
    result = _invoke("--json", "run", "list", "--origin", "remote")

    assert result.exit_code == 2
    assert get_paths == []
    err = json.loads(result.stdout)
    assert err["error"] == "usage_error"
    assert "remote" in err["message"]


def test_cli_run_list_human_output_marks_official_runs(get_paths, monkeypatch) -> None:
    from rich.console import Console

    import qym.cli.run as run_module

    console = Console(record=True, width=250)
    monkeypatch.setattr(run_module, "err_console", console)

    result = _invoke("run", "list")

    assert result.exit_code == 0, result.output
    text = console.export_text()
    assert "Origin" in text
    assert "Official run · Nightly sweep" in text
    assert "Local" in text
