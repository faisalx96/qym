"""QC-7, QC-10 to QC-20: loading, identity, tags, label and description of a union."""

from __future__ import annotations

import hashlib
import logging

import pytest
from _union_support import fake_platform  # noqa: F401  (pytest fixture)

from qym import DatasetRef, InMemoryDataset
from qym.core.dataset import UnionDataset, resolve_datasets, union_item_id
from qym.utils.errors import DatasetNotFoundError


def _union(*entries, **kwargs):
    return resolve_datasets(list(entries), **kwargs)


def test_items_load_in_list_order_with_namespaced_ids(fake_platform):
    union = _union(
        DatasetRef("support-tickets", version="v3"),
        DatasetRef("support-tickets", version="v4"),
        DatasetRef("billing-faq", alias="production"),
    )
    assert isinstance(union, UnionDataset)
    items = union.get_items()
    assert [i.id for i in items] == [
        "support-tickets@v3/t-1",
        "support-tickets@v3/t-2",
        "support-tickets@v3/t-3",
        "support-tickets@v4/t-1",
        "support-tickets@v4/t-2",
        "billing-faq@v7/b-1",
        "billing-faq@v7/b-2",
    ]
    # The raw ids t-1 / t-2 exist in both versions: two distinct items.
    assert len({i.id for i in items}) == 7
    # Sequential, in list order, each entry read once.
    assert [p.split("/")[5] for p in fake_platform.requests] == ["v3", "v4", "production"]
    assert union.get_items() is items  # cached


def test_every_item_is_tagged_and_keeps_its_source_key(fake_platform):
    union = _union(DatasetRef("support-tickets", version="v3"), "billing-faq")
    items = union.get_items()
    first, last = items[0], items[-1]
    assert first.metadata["slice"] == "a"  # existing keys stay
    assert first.metadata["qym_dataset"] == "support-tickets"
    assert first.metadata["qym_dataset_version"] == "v3"
    assert first.metadata["qym_dataset_index"] == 0
    assert first.metadata["qym_item_id"] == "t-1"
    assert first.metadata["qym_dataset_version_id"] == "dv-support-tickets-v3"
    assert last.metadata["qym_dataset_index"] == 1
    assert last.metadata["qym_dataset_version"] == "v7"  # alias resolved before the id is built
    assert first.dataset_item_pk is not None and first.dataset_item_pk != last.dataset_item_pk


def test_label_is_deterministic_from_the_request(fake_platform):
    union = _union(
        DatasetRef("support-tickets", version="v3"),
        DatasetRef("support-tickets", version="v4"),
        DatasetRef("billing-faq", alias="production"),
        "plain",
        InMemoryDataset([{"input": 1}], name="mem"),
    )
    assert union.name == "support-tickets@v3 + support-tickets@v4 + billing-faq@production + plain + mem"


def test_long_label_is_cut_at_an_entry_boundary():
    entries = [InMemoryDataset([{"input": n}], name=f"dataset-number-{n:02d}") for n in range(12)]
    label = UnionDataset([(e, e) for e in entries]).name
    assert len(label) <= 120
    assert label.endswith(" more") and " + dataset-number-00 + " in " + " + label
    shown = label.rsplit(" + ", 1)[0].split(" + ")
    assert all(part.startswith("dataset-number-") for part in shown)


def test_describe_lists_one_dict_per_entry(fake_platform):
    fake_platform.datasets["support-tickets"]["disabled"] = {"v4": 2}
    union = _union(
        DatasetRef("support-tickets", version="v4"),
        "billing-faq",
        InMemoryDataset([{"input": 1}, {"input": 2}], name="local"),
    )
    assert union.describe() == [
        {
            "dataset": "support-tickets", "dataset_id": "ds-support-tickets",
            "dataset_version_id": "dv-support-tickets-v4", "version": "v4",
            "alias": None, "items": 2, "disabled_items": 2,
        },
        {
            "dataset": "billing-faq", "dataset_id": "ds-billing-faq",
            "dataset_version_id": "dv-billing-faq-v7", "version": "v7",
            "alias": "production", "items": 2, "disabled_items": 0,
        },
        {
            "dataset": "local", "dataset_id": None, "dataset_version_id": None,
            "version": None, "alias": None, "items": 2, "disabled_items": 0,
        },
    ]
    assert union.disabled_count == 2
    assert union.id == "ds-support-tickets" and union.dataset_version_id == "dv-support-tickets-v4"
    assert union.version == "v4"


def test_same_resolved_version_twice_is_refused(fake_platform):
    union = _union(DatasetRef("support-tickets", alias="production"), DatasetRef("support-tickets", version="v3"))
    with pytest.raises(ValueError, match="dataset support-tickets v3 is listed twice"):
        union.get_items()


def test_same_local_object_twice_is_refused(tmp_path):
    path = tmp_path / "c.csv"
    path.write_text("input,expected_output\nx,y\n")
    from qym import CsvDataset

    union = _union(CsvDataset(path), CsvDataset(path, name="other"))
    with pytest.raises(ValueError, match="is listed twice"):
        union.get_items()


def test_missing_dataset_or_version_names_the_entry(fake_platform):
    with pytest.raises(DatasetNotFoundError, match=r"Dataset 'billing-faq' version 'v9' not found"):
        _union("support-tickets", DatasetRef("billing-faq", version="v9")).get_items()
    with pytest.raises(DatasetNotFoundError, match=r"Dataset 'nope'"):
        _union("support-tickets", "nope").get_items()


def test_empty_entry_is_kept_with_zero_items(fake_platform, caplog):
    fake_platform.datasets["empty"] = {"versions": {"v1": []}, "aliases": {"production": "v1"}}
    union = _union("support-tickets", "empty")
    with caplog.at_level(logging.WARNING, logger="qym.core.dataset"):
        union.get_items()
    assert union.describe()[1]["items"] == 0
    assert "dataset empty v1 has no active items" in caplog.text


def test_input_columns_are_common_or_empty_with_a_warning(fake_platform, caplog):
    fake_platform.datasets["support-tickets"]["input_cols"] = ["q"]
    fake_platform.datasets["billing-faq"]["input_cols"] = ["q"]
    same = _union("support-tickets", "billing-faq")
    same.get_items()
    assert same.input_cols == ["q"]
    fake_platform.datasets["billing-faq"]["input_cols"] = ["question"]
    different = _union("support-tickets", "billing-faq")
    with caplog.at_level(logging.WARNING, logger="qym.core.dataset"):
        different.get_items()
    assert different.input_cols == []
    assert "datasets have different input columns" in caplog.text


def test_overwritten_metadata_keys_warn_once(caplog):
    a = InMemoryDataset([{"id": "1", "input": 1, "metadata": {"qym_dataset": "mine"}}], name="a")
    b = InMemoryDataset([{"id": "1", "input": 1, "metadata": {"qym_item_id": "x"}}], name="b")
    with caplog.at_level(logging.WARNING, logger="qym.core.dataset"):
        items = _union(a, b).get_items()
    assert items[0].metadata["qym_dataset"] == "a"
    assert caplog.text.count("were overwritten") == 1


def test_long_ids_are_shortened_deterministically():
    raw = "r" * 300
    short = union_item_id("support-tickets@v3", raw)
    assert len(short) <= 200
    assert short == union_item_id("support-tickets@v3", raw)
    assert short.startswith("support-tickets@v3/") or short.startswith("ds-")
    long_label = "L" * 150
    shortened = union_item_id(long_label, "x" * 100)
    assert shortened.startswith("ds-" + hashlib.sha1(long_label.encode()).hexdigest()[:8])
    assert len(shortened) <= 200
    both = union_item_id(long_label, raw)
    assert len(both) == 200 and both.endswith("~" + hashlib.sha1(raw.encode()).hexdigest()[:8])
    # Two different long raw ids stay different.
    assert union_item_id("a@v1", "x" * 250) != union_item_id("a@v1", "x" * 250 + "y")


def test_single_entry_carries_no_union_tags(fake_platform):
    single = resolve_datasets(["support-tickets"])
    assert all("qym_dataset" not in i.metadata for i in single.get_items())
    assert single.get_items()[0].id == "t-1"
