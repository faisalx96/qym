"""Fakes shared by the multi-dataset SDK tests: a platform that serves dataset items."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, unquote, urlparse

import pytest


class _Response:
    def __init__(self, payload: Dict[str, Any]) -> None:
        self._body = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *exc: object) -> None:
        return None


class FakePlatform:
    """``GET /v1/datasets/{name}/versions/{version|alias}/items`` over a dict.

    ``datasets = {"support-tickets": {"versions": {"v3": ["t-1", "t-2"]},
    "aliases": {"production": "v3"}}}``; the server-side ids are stable per
    ``(dataset, version)``.
    """

    def __init__(self, datasets: Dict[str, Dict[str, Any]]) -> None:
        self.datasets = datasets
        self.requests: List[str] = []

    def urlopen(self, req: Any, timeout: Optional[float] = None) -> _Response:
        import urllib.error

        path = urlparse(req.full_url)
        self.requests.append(path.path)
        parts = path.path.split("/")
        name = unquote(parts[3])
        ref = unquote(parts[5])
        dataset = self.datasets.get(name)
        if dataset is None:
            raise urllib.error.HTTPError(req.full_url, 404, "not found", {}, None)  # type: ignore[arg-type]
        label = dataset.get("aliases", {}).get(ref, ref)
        if label not in dataset["versions"]:
            raise urllib.error.HTTPError(req.full_url, 404, "not found", {}, None)  # type: ignore[arg-type]
        offset = int(parse_qs(path.query).get("offset", ["0"])[0])
        ids = dataset["versions"][label]
        base = abs(hash((name, label))) % 100000 * 1000
        items = [
            {
                "id": base + n,
                "item_id": raw,
                "input": {"q": f"{name}/{label}/{raw}"},
                "expected_output": "ok",
                "metadata": {"slice": "a"},
            }
            for n, raw in enumerate(ids)
        ]
        return _Response(
            {
                "dataset": {"id": f"ds-{name}", "name": name},
                "version": {
                    "id": f"dv-{name}-{label}",
                    "version": label,
                    "disabled_count": dataset.get("disabled", {}).get(label, 0),
                    "schema": {"input_cols": dataset.get("input_cols", [])},
                },
                "items": items[offset:],
                "next_offset": None,
            }
        )


@pytest.fixture()
def fake_platform(monkeypatch: pytest.MonkeyPatch):
    from qym.core import dataset as dataset_module

    monkeypatch.setenv("QYM_BASE_URL", "http://platform.test")
    monkeypatch.setenv("QYM_API_KEY", "key")
    platform = FakePlatform(
        {
            "support-tickets": {
                "versions": {"v3": ["t-1", "t-2", "t-3"], "v4": ["t-1", "t-2"]},
                "aliases": {"production": "v3", "staging": "v4"},
            },
            "billing-faq": {
                "versions": {"v7": ["b-1", "b-2"]},
                "aliases": {"production": "v7"},
            },
        }
    )
    monkeypatch.setattr(dataset_module.request, "urlopen", platform.urlopen)
    return platform
