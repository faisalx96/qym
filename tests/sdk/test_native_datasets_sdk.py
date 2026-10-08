from __future__ import annotations

import json
from pathlib import Path

import pytest

from qym.core.dataset import InMemoryDataset, JsonlDataset, resolve_dataset
from qym.utils.errors import DatasetNotFoundError


def test_jsonl_dataset_generates_stable_item_id(tmp_path: Path) -> None:
    path = tmp_path / "items.jsonl"
    path.write_text(json.dumps({"input": {"q": "hi"}, "expected_output": "ok", "metadata": {"slice": "smoke"}}) + "\n")

    dataset = JsonlDataset(path)
    item = dataset.get_items()[0]

    assert item.id.startswith("ds_")
    assert item.input == {"q": "hi"}
    assert item.expected_output == "ok"
    assert item.metadata == {"slice": "smoke"}


def test_in_memory_dataset() -> None:
    dataset = InMemoryDataset([{"id": "a", "input": "x", "expected": "y"}], name="mem")

    assert dataset.name == "mem"
    assert dataset.get_items()[0].id == "a"
    assert len(dataset) == 1


def test_named_dataset_without_platform_config_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("QYM_BASE_URL", raising=False)
    monkeypatch.delenv("QYM_API_KEY", raising=False)

    with pytest.raises(DatasetNotFoundError):
        resolve_dataset("not-a-local-file")


class _Response:
    def __init__(self, payload: dict) -> None:
        self._body = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *exc: object) -> None:
        return None


def _capture_requests(monkeypatch: pytest.MonkeyPatch) -> list:
    from qym.core import dataset as dataset_module

    seen: list = []

    def fake_urlopen(req, timeout=None):
        seen.append(req)
        return _Response({"items": [{"item_id": "a", "input": "x"}], "next_offset": None})

    monkeypatch.setattr(dataset_module.request, "urlopen", fake_urlopen)
    return seen


def test_platform_dataset_sends_read_token_only_when_set(monkeypatch: pytest.MonkeyPatch) -> None:
    from qym.core.dataset import QymDataset

    monkeypatch.setenv("QYM_BASE_URL", "http://platform")
    monkeypatch.setenv("QYM_API_KEY", "user-key")
    monkeypatch.delenv("QYM_DATASET_READ_TOKEN", raising=False)
    seen = _capture_requests(monkeypatch)

    QymDataset("secret").get_items()
    assert seen[0].get_header("Authorization") == "Bearer user-key"
    assert seen[0].get_header("X-qym-dataset-read-token") is None

    monkeypatch.setenv("QYM_DATASET_READ_TOKEN", "qym_dr_service")
    QymDataset("secret").get_items()
    # The user's key still authenticates; the token rides along for the read.
    assert seen[1].get_header("Authorization") == "Bearer user-key"
    assert seen[1].get_header("X-qym-dataset-read-token") == "qym_dr_service"
