"""QC-1 to QC-6, QC-8, QC-31: DatasetRef, the dataset argument, resolve_datasets."""

from __future__ import annotations

from pathlib import Path

import pytest
from _union_support import fake_platform  # noqa: F401  (pytest fixture)

from qym import CsvDataset, DatasetRef, Evaluator, InMemoryDataset
from qym.core.dataset import QymDataset, UnionDataset, resolve_dataset, resolve_datasets


def _task(question):
    return question


def test_ref_rules():
    ref = DatasetRef("a", version="v3")
    assert (ref.name, ref.version, ref.alias) == ("a", "v3", None)
    with pytest.raises(ValueError, match="a version or an alias, not both"):
        DatasetRef("a", version="v3", alias="production")
    with pytest.raises(ValueError):
        DatasetRef("")
    with pytest.raises(Exception):
        ref.name = "b"  # frozen


def test_from_dict_reads_the_service_keys_and_ignores_the_rest():
    ref = DatasetRef.from_dict({"dataset": "a", "version": "v3", "alias": None, "extra": 1})
    assert ref == DatasetRef("a", "v3", None)
    assert DatasetRef.from_dict({"dataset": "a", "alias": "staging"}) == DatasetRef("a", alias="staging")


@pytest.mark.parametrize(
    "text, expected",
    [
        ("support-tickets", DatasetRef("support-tickets")),
        ("support-tickets@v3", DatasetRef("support-tickets", version="v3")),
        ("billing@alias:production", DatasetRef("billing", alias="production")),
        ("a@b@v3", DatasetRef("a@b", version="v3")),
    ],
)
def test_parse_grammar(text, expected):
    assert DatasetRef.parse(text) == expected


@pytest.mark.parametrize("text", ["name@", "name@alias:", "@v3", ""])
def test_parse_rejects_malformed_values(text):
    with pytest.raises(ValueError):
        DatasetRef.parse(text)


def test_parse_prefers_an_existing_path(tmp_path: Path):
    path = tmp_path / "a@b.csv"
    path.write_text("input,expected_output\nx,y\n")
    assert DatasetRef.parse(str(path)) == DatasetRef(str(path))


def test_dataset_argument_type_errors():
    for bad in (5, None, object()):
        with pytest.raises(TypeError, match="dataset must be a name, a DatasetRef"):
            Evaluator(_task, bad, ["exact_match"])
    with pytest.raises(TypeError):
        Evaluator(_task, ["a", 5], ["exact_match"])
    with pytest.raises(ValueError, match="dataset list is empty"):
        Evaluator(_task, [], ["exact_match"])
    with pytest.raises(ValueError, match="at most 50 datasets per run"):
        resolve_datasets([InMemoryDataset([{"input": 1}], name=f"d{i}") for i in range(51)])


def test_single_spellings_are_the_same_call(fake_platform, tmp_path):
    spellings = ["support-tickets", ["support-tickets"], DatasetRef("support-tickets"), [DatasetRef("support-tickets")]]
    seen = []
    for dataset in spellings:
        ev = Evaluator(_task, dataset, ["exact_match"], config={"otel_enabled": False, "checkpoint_enabled": False})
        assert isinstance(ev.dataset, QymDataset)
        assert ev.dataset_name == "support-tickets"
        seen.append([item.id for item in ev.dataset.get_items()])
    assert all(ids == seen[0] for ids in seen)


def test_ref_with_version_is_name_plus_config_version(fake_platform):
    ref = Evaluator(_task, DatasetRef("support-tickets", version="v4"), ["exact_match"]).dataset
    cfg = Evaluator(
        _task, "support-tickets", ["exact_match"], config={"dataset_version": "v4"}
    ).dataset
    assert [i.id for i in ref.get_items()] == [i.id for i in cfg.get_items()] == ["t-1", "t-2"]
    assert ref.version == cfg.version == "v4"


def test_plain_string_in_list_uses_config_defaults_a_ref_ignores_them(fake_platform):
    ev = Evaluator(
        _task,
        ["support-tickets", DatasetRef("billing-faq")],
        ["exact_match"],
        config={"dataset_version": "v4"},
    )
    assert isinstance(ev.dataset, UnionDataset)
    first, second = ev.dataset.entries
    assert first.dataset.version == "v4"
    assert second.dataset.version is None and second.dataset.alias == "production"


def test_string_in_list_is_never_parsed_for_at(fake_platform):
    ev = Evaluator(_task, ["support-tickets@v3", "billing-faq"], ["exact_match"])
    assert ev.dataset.entries[0].dataset.name == "support-tickets@v3"


def test_local_file_ref_with_version_is_an_error(tmp_path):
    path = tmp_path / "cases.csv"
    path.write_text("input,expected_output\nx,y\n")
    with pytest.raises(ValueError, match="a local file has no version"):
        resolve_datasets([DatasetRef(str(path), version="v1"), InMemoryDataset([{"input": 1}])])
    with pytest.raises(ValueError, match="a local file has no version"):
        resolve_dataset(DatasetRef(str(path), alias="production"))
    assert isinstance(resolve_dataset(DatasetRef(str(path))), CsvDataset)


def test_resolve_datasets_single_returns_the_same_object(fake_platform):
    single = resolve_datasets(["support-tickets"])
    assert isinstance(single, QymDataset)
    mem = InMemoryDataset([{"input": 1}])
    assert resolve_datasets([mem]) is mem
    assert isinstance(resolve_datasets([mem, InMemoryDataset([{"input": 2}], name="b")]), UnionDataset)


def test_resolve_dataset_accepts_a_ref(fake_platform):
    ds = resolve_dataset(DatasetRef("support-tickets", alias="staging"), version="v3")
    assert ds.alias == "staging" and ds.version is None
