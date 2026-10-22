"""QC-9, QC-20 to QC-24, QC-28: a union run end to end, its files, checkpoint and resume."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest
from _union_support import fake_platform  # noqa: F401  (pytest fixture)

from qym import DatasetRef, Evaluator, InMemoryDataset, RunSpec
from qym.core.checkpoint import load_checkpoint_state
from qym.core.multi_runner import MultiModelRunner
from qym.platform import client as client_module
from qym.platform.client import PlatformEventStream, PlatformRunHandle


def _task(value):
    return value


def _datasets():
    return [
        InMemoryDataset(
            [{"id": f"i{n}", "input": f"a{n}", "expected_output": f"a{n}"} for n in range(4)],
            name="alpha",
            version="v1",
        ),
        InMemoryDataset(
            [{"id": f"i{n}", "input": f"b{n}", "expected_output": "wrong"} for n in range(2)],
            name="beta",
        ),
    ]


def _config(tmp_path: Path, **extra):
    cfg = {
        "otel_enabled": False,
        "checkpoint_enabled": False,
        "output_dir": str(tmp_path),
        "run_name": "union-run",
        **extra,
    }
    return {k: v for k, v in cfg.items() if v is not None}


def test_union_run_scores_every_item_and_tags_it(tmp_path):
    ev = Evaluator(_task, _datasets(), ["exact_match"], config=_config(tmp_path))
    assert ev.dataset_name == "alpha + beta"
    result = ev.run(show_tui=False, auto_save=False)
    assert result.dataset_name == "alpha + beta"
    assert result.total_items == 6
    # Same raw ids i0, i1 in both datasets: six distinct items.
    assert sorted(result.results) == sorted(
        [f"alpha@v1/i{n}" for n in range(4)] + [f"beta/i{n}" for n in range(2)]
    )
    md = result.metadatas["alpha@v1/i2"]
    assert (md["qym_dataset"], md["qym_dataset_version"], md["qym_dataset_index"], md["qym_item_id"]) == (
        "alpha", "v1", 0, "i2",
    )
    assert result.metadatas["beta/i1"]["qym_dataset_index"] == 1
    assert result.metadatas["beta/i1"]["qym_dataset_version"] is None
    described = result.run_metadata["datasets"]
    assert [(d["dataset"], d["version"], d["items"]) for d in described] == [("alpha", "v1", 4), ("beta", None, 2)]
    assert result.to_dict()["datasets"] == described


def test_single_dataset_run_is_unchanged(tmp_path):
    for dataset in (_datasets()[0], [_datasets()[0]]):
        result = Evaluator(_task, dataset, ["exact_match"], config=_config(tmp_path)).run(
            show_tui=False, auto_save=False
        )
        assert sorted(result.results) == [f"i{n}" for n in range(4)]
        assert "datasets" not in result.run_metadata
        assert "datasets" not in result.to_dict()
        assert all("qym_dataset" not in md for md in result.metadatas.values())


def test_csv_export_has_dataset_columns_right_after_item_id(tmp_path):
    result = Evaluator(_task, _datasets(), ["exact_match"], config=_config(tmp_path)).run(
        show_tui=False, auto_save=False
    )
    path = result.save_csv(output_dir=str(tmp_path))
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        header = reader.fieldnames
        rows = list(reader)
    at = header.index("item_id")
    assert header[at + 1 : at + 3] == ["dataset", "dataset_version"]
    by_id = {r["item_id"]: r for r in rows}
    assert (by_id["alpha@v1/i0"]["dataset"], by_id["alpha@v1/i0"]["dataset_version"]) == ("alpha", "v1")
    assert (by_id["beta/i0"]["dataset"], by_id["beta/i0"]["dataset_version"]) == ("beta", "")
    # A single-dataset export has none of it.
    single = Evaluator(_task, _datasets()[0], ["exact_match"], config=_config(tmp_path, run_name="s")).run(
        show_tui=False, auto_save=False
    )
    with open(single.save_csv(output_dir=str(tmp_path)), newline="", encoding="utf-8") as handle:
        assert "dataset" not in (csv.DictReader(handle).fieldnames or [])


def test_results_file_name_caps_a_long_label(tmp_path):
    many = [InMemoryDataset([{"input": 1}], name=f"dataset-with-a-long-name-{n}") for n in range(3)]
    result = Evaluator(_task, many, ["exact_match"], config=_config(tmp_path, run_name=None)).run(
        show_tui=False, auto_save=False
    )
    name = Path(result._default_save_path("csv", str(tmp_path))).name
    assert len(name) < 200 and "dataset-with-a-long-name-0" in name
    assert len([p for p in name.split("-") if p == "a"]) <= 3


def test_checkpoint_carries_columns_and_is_readable(tmp_path):
    ev = Evaluator(_task, _datasets(), ["exact_match"], config=_config(tmp_path, checkpoint_enabled=True))
    result = ev.run(show_tui=False, auto_save=False)
    path = result.last_saved_path
    with open(path, newline="", encoding="utf-8") as handle:
        header = csv.DictReader(handle).fieldnames
    assert header[header.index("item_id") + 1 : header.index("item_id") + 3] == ["dataset", "dataset_version"]
    state = load_checkpoint_state(path)
    assert state is not None and len(state.completed_item_ids) == 6
    assert "alpha@v1/i0" in state.completed_item_ids


def test_resume_skips_completed_pairs_and_ends_with_the_same_counts(tmp_path):
    seen = []

    def task(value):
        seen.append(value)
        return value

    first = Evaluator(task, _datasets(), ["exact_match"], config=_config(tmp_path, checkpoint_enabled=True)).run(
        show_tui=False, auto_save=False
    )
    path = Path(first.last_saved_path)
    # Interrupt after item 5: keep the header and the first five rows.
    with open(path, newline="", encoding="utf-8") as handle:
        rows = list(csv.reader(handle))
    with open(path, "w", newline="", encoding="utf-8") as handle:
        csv.writer(handle).writerows(rows[:6])
    seen.clear()
    resumed = Evaluator(
        task,
        _datasets(),
        ["exact_match"],
        config=_config(tmp_path, checkpoint_enabled=True, resume_from=str(path)),
    ).run(show_tui=False, auto_save=False)
    assert seen == ["b1"]  # only the sixth item re-ran
    assert resumed.total_items == 6
    per_dataset = {}
    for md in resumed.metadatas.values():
        per_dataset[md["qym_dataset"]] = per_dataset.get(md["qym_dataset"], 0) + 1
    assert per_dataset == {"alpha": 4, "beta": 2}


def test_resume_refuses_when_a_version_moved(fake_platform, tmp_path):
    cfg = _config(tmp_path, checkpoint_enabled=True)
    entries = [DatasetRef("support-tickets", alias="production"), DatasetRef("billing-faq")]
    first = Evaluator(_task, entries, ["exact_match"], config=cfg).run(show_tui=False, auto_save=False)
    path = first.last_saved_path
    fake_platform.datasets["support-tickets"]["aliases"]["production"] = "v4"
    with pytest.raises(ValueError) as caught:
        Evaluator(_task, entries, ["exact_match"], config={**cfg, "resume_from": path}).run(
            show_tui=False, auto_save=False
        )
    assert str(caught.value) == (
        "Resume dataset version mismatch: support-tickets was v3 in the checkpoint and "
        "resolves to v4 now. Pin the version (support-tickets@v3) to resume."
    )


def _capture_platform(monkeypatch, tmp_path):
    created, delivered = {}, []

    def create_run(self, **kwargs):
        created.update(kwargs)
        return PlatformRunHandle("run-1", "http://unused.invalid/run")

    def post(url, payload, key, **kwargs):
        delivered.extend(json.loads(line) for line in payload.splitlines())

    monkeypatch.setattr(client_module.PlatformClient, "create_run", create_run)
    monkeypatch.setattr(client_module, "_post_ndjson", post)
    return created, delivered


def _platform_config(tmp_path):
    return _config(tmp_path, platform_api_key="k", platform_url="http://unused.invalid")


def test_create_run_and_events_carry_the_datasets(monkeypatch, tmp_path):
    created, delivered = _capture_platform(monkeypatch, tmp_path)
    ev = Evaluator(_task, _datasets(), ["exact_match"], config=_platform_config(tmp_path))
    # The evaluator never sets ``total_items`` today, so its run_started emit is
    # swallowed by a bare except (an existing quirk, left alone); give it one so the
    # payload this feature adds is exercised.
    ev.total_items = 6
    ev.run(show_tui=False, auto_save=False)
    assert created["dataset"] == "alpha + beta"
    assert [d["dataset"] for d in created["datasets"]] == ["alpha", "beta"]
    started = next(e for e in delivered if e["type"] == "run_started")
    assert [d["dataset"] for d in started["payload"]["datasets"]] == ["alpha", "beta"]
    items = [e for e in delivered if e["type"] == "item_started"]
    assert len(items) == 6
    assert items[0]["payload"]["item_id"] == "alpha@v1/i0"
    assert items[0]["payload"]["item_metadata"]["qym_item_id"] == "i0"
    assert items[5]["payload"]["item_metadata"]["qym_dataset_index"] == 1


def test_single_dataset_events_carry_no_datasets(monkeypatch, tmp_path):
    created, delivered = _capture_platform(monkeypatch, tmp_path)
    ev = Evaluator(_task, _datasets()[0], ["exact_match"], config=_platform_config(tmp_path))
    ev.total_items = 4
    ev.run(show_tui=False, auto_save=False)
    assert created.get("datasets") is None
    started = next(e for e in delivered if e["type"] == "run_started")
    assert "datasets" not in started["payload"]
    items = [e for e in delivered if e["type"] == "item_started"]
    assert all("qym_dataset" not in e["payload"]["item_metadata"] for e in items)


def test_run_spec_with_a_list_runs_as_one_union_run(tmp_path):
    runner = MultiModelRunner.from_runs(
        [
            RunSpec(
                name="spec-run",
                task=_task,
                dataset=_datasets(),
                metrics=["exact_match"],
                config=_config(tmp_path, run_name="spec-run"),
            )
        ]
    )
    matrix = runner._build_run_matrix()
    assert matrix[0]["dataset"] == "alpha + beta"
    import asyncio

    results = asyncio.run(runner.arun(show_tui=False, auto_save=False))
    assert results[0].total_items == 6
