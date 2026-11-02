"""QC-90: the real SDK ``Evaluator`` over two platform datasets, uploaded to the platform, then every read."""

from __future__ import annotations

import json
from urllib.parse import urlparse

import pytest
from _helpers import app_client
from _union_run import TOKEN, auth, seed_api_key, seed_dataset
from sqlalchemy.orm import sessionmaker


class _Response:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None


@pytest.fixture(autouse=True)
def _auth_none(monkeypatch):
    """The UI routes read as the dev user: other test modules leave their auth mode in the environment."""
    monkeypatch.setenv("QYM_AUTH_MODE", "none")


@pytest.fixture()
def wired(database, monkeypatch):
    """The SDK's HTTP calls routed to the in-process platform."""
    from qym.core import dataset as dataset_module
    from qym.platform import client as client_module

    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as session:
        seed_api_key(session)
        tickets = seed_dataset(
            session, "support-tickets", {"v3": ["t-1", "t-2", "t-3"], "v4": ["t-1", "t-2"]}
        )
        billing = seed_dataset(
            session, "billing-faq", {"v7": ["b-1", "b-2"]}, aliases={"production": "v7"}
        )
    with app_client(factory) as http:

        def urlopen(req, timeout=None):
            parsed = urlparse(req.full_url)
            response = http.get(f"{parsed.path}?{parsed.query}", headers=auth())
            assert response.status_code == 200, response.text
            return _Response(response.json())

        def post_json(url, payload, key, **kwargs):
            response = http.post(urlparse(url).path, json=payload, headers=auth())
            assert response.status_code == 200, response.text
            return response.json()

        def post_ndjson(url, payload, key, **kwargs):
            response = http.post(
                urlparse(url).path,
                content=payload,
                headers={**auth(), "Content-Type": "application/x-ndjson"},
            )
            assert response.status_code == 200, response.text
            return response.json()

        monkeypatch.setenv("QYM_BASE_URL", "http://testserver")
        monkeypatch.setenv("QYM_API_KEY", TOKEN)
        monkeypatch.setattr(dataset_module.request, "urlopen", urlopen)
        monkeypatch.setattr(client_module, "_post_json", post_json)
        monkeypatch.setattr(client_module, "_post_ndjson", post_ndjson)
        yield http, factory, tickets, billing


def _task(q):
    return "a"


def test_union_run_roundtrip(wired, tmp_path):
    from qym import DatasetRef, Evaluator

    http, factory, tickets, billing = wired
    evaluator = Evaluator(
        _task,
        [DatasetRef("support-tickets", version="v3"), DatasetRef("support-tickets", version="v4"), "billing-faq"],
        ["exact_match"],
        config={
            "otel_enabled": False,
            "checkpoint_enabled": False,
            "output_dir": str(tmp_path),
            "run_name": "sdk-union",
            "platform_api_key": TOKEN,
            "platform_url": "http://testserver",
        },
    )
    result = evaluator.run(show_tui=False, auto_save=False)
    assert result.total_items == 7
    runs = http.get("/api/runs?project_slug=test").json()["tasks"]
    listed = [r for models in runs.values() for rows in models.values() for r in rows]
    assert len(listed) == 1 and listed[0]["dataset_count"] == 3
    run_id = listed[0]["run_id"]
    payload = http.get(f"/api/runs/{run_id}?view=summary").json()["run"]
    assert payload["dataset_count"] == 3
    assert [(d["dataset"], d["version"], d["items"]) for d in payload["datasets"]] == [
        ("support-tickets", "v3", 3),
        ("support-tickets", "v4", 2),
        ("billing-faq", "v7", 2),
    ]
    assert payload["datasets"][2]["alias"] == "production"
    assert payload["datasets"][0]["dataset_slug"] == "support-tickets"
    # Every item reached the platform under its namespaced id, with its source link and position.
    from qym_platform.db.models import RunItem

    with factory() as session:
        items = {i.item_id: i for i in session.query(RunItem).filter(RunItem.run_id == run_id)}
    assert len(items) == 7
    assert items["support-tickets@v4/t-1"].dataset_position == 1
    assert items["support-tickets@v4/t-1"].dataset_item_pk == tickets["items"]["v4"]["t-1"]
    assert items["billing-faq@v7/b-2"].dataset_item_pk == billing["items"]["v7"]["b-2"]
    breakdown = http.get(f"/api/runs/{run_id}/datasets").json()
    assert [(d["dataset"], d["version"], d["items"]) for d in breakdown["datasets"]] == [
        ("support-tickets", "v3", 3),
        ("support-tickets", "v4", 2),
        ("billing-faq", "v7", 2),
    ]
    assert all(d["metrics"]["exact_match"]["mean"] == 1.0 for d in breakdown["datasets"])
    assert breakdown["run"]["items"] == 7
    # The dataset pages list the run under every dataset it evaluated, once.
    for name in ("support-tickets", "billing-faq"):
        body = http.get(f"/v1/datasets/{name}/runs", headers=auth()).json()
        assert [r["id"] for r in body["runs"]] == [run_id]


def test_single_dataset_sdk_run_is_a_plain_run(wired, tmp_path):
    from qym import Evaluator

    http, factory, *_ = wired
    Evaluator(
        _task,
        "support-tickets",
        ["exact_match"],
        config={
            "otel_enabled": False,
            "checkpoint_enabled": False,
            "output_dir": str(tmp_path),
            "run_name": "sdk-single",
            "dataset_version": "v3",
            "platform_api_key": TOKEN,
            "platform_url": "http://testserver",
        },
    ).run(show_tui=False, auto_save=False)
    runs = http.get("/api/runs?project_slug=test").json()["tasks"]
    listed = [r for models in runs.values() for rows in models.values() for r in rows]
    run_id = listed[0]["run_id"]
    assert listed[0]["dataset_count"] == 1
    from qym_platform.db.models import RunDataset

    with factory() as session:
        assert session.query(RunDataset).count() == 0
    payload = http.get(f"/api/runs/{run_id}?view=summary").json()["run"]
    assert payload["dataset_count"] == 1 and len(payload["datasets"]) == 1
