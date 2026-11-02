"""QC-27 to QC-29: the create-run payload with and without ``datasets``."""

from __future__ import annotations

import json

from qym.platform import client as client_module
from qym.platform.client import PlatformClient

GOLDEN_SINGLE = {
    "external_run_id": "r1",
    "task": "answer",
    "dataset": "support-tickets",
    "model": "gpt-4o",
    "metrics": ["exact_match"],
    "metric_specs": {},
    "run_metadata": {"total_items": 3},
    "run_config": {"max_concurrency": 4},
    "dataset_id": "ds-1",
    "dataset_version_id": "dv-1",
    "dataset_alias": "production",
}


def _create(monkeypatch, **extra):
    sent = {}

    def post(url, payload, key, **kwargs):
        sent["url"], sent["payload"], sent["key"] = url, payload, key
        return {"run_id": "run-1", "live_url": "http://platform/run/run-1"}

    monkeypatch.setattr(client_module, "_post_json", post)
    PlatformClient("http://platform", "key").create_run(
        external_run_id="r1",
        task="answer",
        dataset=extra.pop("dataset", "support-tickets"),
        model="gpt-4o",
        metrics=["exact_match"],
        run_metadata={"total_items": 3},
        run_config={"max_concurrency": 4},
        dataset_id="ds-1",
        dataset_version_id="dv-1",
        dataset_alias="production",
        **extra,
    )
    return sent["payload"]


ENTRIES = [
    {"dataset": "support-tickets", "dataset_id": "ds-1", "dataset_version_id": "dv-1",
     "version": "v3", "alias": "production", "items": 3, "disabled_items": 0},
    {"dataset": "billing-faq", "dataset_id": "ds-2", "dataset_version_id": "dv-2",
     "version": "v7", "alias": None, "items": 2, "disabled_items": 1},
]


def test_single_dataset_body_is_byte_identical_to_2_0_0(monkeypatch):
    payload = _create(monkeypatch)
    assert json.dumps(payload, sort_keys=True) == json.dumps(GOLDEN_SINGLE, sort_keys=True)
    # None and a one-entry list are the same as no list.
    assert _create(monkeypatch, datasets=None) == payload
    assert _create(monkeypatch, datasets=ENTRIES[:1]) == payload
    assert _create(monkeypatch, datasets=[]) == payload


def test_union_body_adds_only_the_datasets_key(monkeypatch):
    payload = _create(monkeypatch, datasets=ENTRIES, dataset="a@v3 + b@v7")
    assert payload["datasets"] == ENTRIES
    assert payload["dataset"] == "a@v3 + b@v7"
    rest = {k: v for k, v in payload.items() if k not in ("datasets", "dataset")}
    assert rest == {k: v for k, v in GOLDEN_SINGLE.items() if k != "dataset"}
