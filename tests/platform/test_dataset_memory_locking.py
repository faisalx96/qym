"""Dataset routes stay light on memory and short on locks.

Uploads parse off the event loop and insert in batches with an incremental
content hash; publish, copy and download stream; run and item aggregates are
computed in SQL; bulk edits are bounded; unpaged compare diffs are capped.
Each test pins the result to what the previous (load-everything) code
returned.
"""

from __future__ import annotations

import asyncio
import json
import sys
from collections import defaultdict
from typing import Any, Dict, Optional

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from qym_platform.api import datasets as datasets_api
from qym_platform.api.datasets import (
    _content_hash,
    _ContentHasher,
    _item_result_summaries,
    _numeric_score,
    _stream_version_hash,
)
from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    ApiKey,
    DatasetItem,
    DatasetItemRevision,
    DatasetVersion,
    Project,
    ProjectMembership,
    ProjectRole,
    Run,
    RunItem,
    RunItemScore,
    RunWorkflowStatus,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.security import api_key_prefix, hash_api_key
from qym_platform.services.dataset_search import dataset_item_search_text
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

AUTH = {"Authorization": "Bearer token-1"}


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "none")
    monkeypatch.setenv("QYM_ALLOW_LEGACY_EMPTY_API_KEY_SCOPES", "true")
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as session:
        user = User(
            id="user-1", email="dev@local", display_name="Dev", role=UserRole.ADMIN
        )
        project = Project(
            id="project-1", name="Project", slug="project", created_by_user_id=user.id
        )
        session.add_all(
            [
                user,
                project,
                ProjectMembership(
                    project_id=project.id, user_id=user.id, role=ProjectRole.MANAGER
                ),
                ApiKey(
                    id="key-1",
                    user_id=user.id,
                    project_id=project.id,
                    name="test",
                    prefix=api_key_prefix("token-1"),
                    key_hash=hash_api_key("token-1"),
                    scopes=["datasets:read", "datasets:write", "datasets:delete"],
                ),
            ]
        )
        session.commit()
    app = create_app()

    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield client, factory, engine
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def _upload_jsonl(client, name: str, rows: list[dict], **fields):
    content = "\n".join(json.dumps(row, ensure_ascii=False) for row in rows).encode(
        "utf-8"
    )
    data = {"name": name, **fields}
    resp = client.post(
        "/v1/datasets:upload",
        headers=AUTH,
        data=data,
        files={"file": ("items.jsonl", content, "application/octet-stream")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


SAMPLE_ROWS = [
    {
        "item_id": "b",
        "input": {"q": "ما هي عاصمة السعودية؟", "n": 1.5},
        "expected_output": "الرياض",
        "labels": ["x"],
    },
    {
        "item_id": "a",
        "input": "plain",
        "expected_output": None,
        "metadata": {"z": [1, 2.0, True, None], "a": "é"},
    },
    {"input": [1, {"k": "v"}], "expected_output": 0.1},
    {
        "item_id": "c",
        "input": 10**20,
        "expected_output": -0.0,
        "metadata": {},
        "labels": "p, q",
    },
]


# --------------------------------------------------------------- content hash


class _Row:
    def __init__(self, **values: Any) -> None:
        self.__dict__.update(values)


def test_incremental_hash_equals_the_reference_hash():
    rows = [
        _Row(
            index=1,
            item_id="b",
            input={"q": "سؤال", "f": 1.25},
            expected_output=None,
            item_metadata=None,
            labels=None,
            fingerprint="f1",
        ),
        _Row(
            index=0,
            item_id="z",
            input=[1, None, True],
            expected_output="ok",
            item_metadata={"b": 1, "a": 2},
            labels=["l"],
            fingerprint="f2",
        ),
        # Same index: the reference breaks the tie by item_id.
        _Row(
            index=1,
            item_id="a",
            input="x",
            expected_output=0.1,
            item_metadata={},
            labels=[],
            fingerprint=None,
        ),
    ]
    hasher = _ContentHasher()
    for row in sorted(rows, key=lambda r: (r.index, r.item_id)):
        hasher.update(
            row.item_id,
            row.input,
            row.expected_output,
            row.item_metadata,
            row.labels,
            row.fingerprint,
        )
    assert hasher.hexdigest() == _content_hash(rows)
    assert _ContentHasher().hexdigest() == _content_hash([])


def test_upload_and_publish_hashes_equal_the_reference_hash(env):
    client, factory, _ = env
    body = _upload_jsonl(client, "Hashes", SAMPLE_ROWS, publish="true")
    uploaded_hash = body["version"]["content_hash"]
    with factory() as db:
        items = db.query(DatasetItem).all()
        assert uploaded_hash == _content_hash(items)
        # Rows sharing an index are hashed in item_id order, as the reference sorts them.
        version_id = items[0].dataset_version_id
        for item in items:
            item.index = 7
        db.commit()
        items = db.query(DatasetItem).all()
        assert _stream_version_hash(db, version_id) == (
            len(items),
            _content_hash(items),
        )
    draft = client.post(
        "/v1/datasets/hashes/versions", headers=AUTH, json={"from_version": "v1"}
    ).json()["version"]
    published = client.post(
        f"/v1/datasets/hashes/versions/{draft['version']}:publish",
        headers=AUTH,
        json={},
    )
    assert published.status_code == 200, published.text
    with factory() as db:
        copies = (
            db.query(DatasetItem)
            .filter(DatasetItem.dataset_version_id == draft["id"])
            .all()
        )
        assert published.json()["version"]["content_hash"] == _content_hash(copies)
        assert published.json()["version"]["item_count"] == len(SAMPLE_ROWS)


# --------------------------------------------------------------------- upload


def test_upload_parses_off_the_event_loop_and_inserts_without_orm_objects(
    env, monkeypatch
):
    client, factory, _ = env
    seen: list[bool] = []
    parse = datasets_api._items_from_jsonl

    def spy(raw: bytes):
        try:
            asyncio.get_running_loop()
            seen.append(True)
        except RuntimeError:
            seen.append(False)
        return parse(raw)

    monkeypatch.setattr(datasets_api, "_items_from_jsonl", spy)
    created: list[str] = []
    listener = lambda target, args, kwargs: created.append(target)  # noqa: E731
    event.listen(DatasetItem, "init", listener)
    monkeypatch.setattr(datasets_api, "_INSERT_BATCH_SIZE", 2)
    try:
        _upload_jsonl(client, "Loop", SAMPLE_ROWS)
    finally:
        event.remove(DatasetItem, "init", listener)
    assert seen == [False], "parsing must run in the threadpool, not on the event loop"
    assert created == [], "items are inserted with Core, not ORM objects"
    with factory() as db:
        items = db.query(DatasetItem).order_by(DatasetItem.index).all()
        assert [item.index for item in items] == [0, 1, 2, 3]
        assert [item.item_id for item in items][:2] == ["b", "a"]
        assert items[3].labels == ["p", "q"]
        # The text the ORM listener wrote: from the uploaded values, before storage.
        sources = [datasets_api._json_record_item(row) for row in SAMPLE_ROWS]
        for item, source in zip(items, sources):
            assert item.search_text == dataset_item_search_text(
                item.item_id,
                source["input"],
                source["expected_output"],
                source["metadata"],
            )


def test_legacy_csv_is_detected_over_the_whole_file_and_decoded_line_by_line(env):
    client, _, _ = env
    # The sample used for scoring is ASCII; the Arabic rows come after it.
    filler = "".join(f"q{n},a{n}\n" for n in range(40000))
    text = "question,answer\n" + filler + "پرسش ما هي عاصمة السعودية؟,الرياض\n"
    raw = text.encode("cp1256")
    assert len(raw) > datasets_api._ENCODING_SAMPLE_CHARS
    resp = client.post(
        "/v1/datasets:upload",
        headers=AUTH,
        data={
            "name": "Big Arabic",
            "input_cols": "question",
            "expected_cols": "answer",
        },
        files={"file": ("big.csv", raw, "text/csv")},
    )
    assert resp.status_code == 200, resp.text
    # 0x81 is undefined in Windows-1252 and only Windows-1256 decodes the file,
    # exactly as when every candidate decoded the whole file.
    assert resp.json()["version"]["schema"]["encoding"] == "windows-1256"
    assert resp.json()["version"]["item_count"] == 40001
    last = client.get(
        "/v1/datasets/big-arabic/versions/v1/items",
        headers=AUTH,
        params={"offset": 40000},
    ).json()
    assert last["items"][0]["input"] == "پرسش ما هي عاصمة السعودية؟"
    assert last["items"][0]["expected_output"] == "الرياض"


@pytest.mark.parametrize("requested", ["utf-16", "utf-32"])
def test_requested_utf16_and_utf32_without_bom_read_like_bytes_decode(requested):
    text = "q,a\nالشاي,نعم\n"
    raw = text.encode(f"{requested}-{'le' if sys.byteorder == 'little' else 'be'}")
    assert datasets_api._decode_csv(raw, requested) == (
        raw.decode(requested),
        requested,
    )
    reader, used = datasets_api._csv_reader(raw, requested)
    assert used == requested and [dict(row) for row in reader] == [
        {"q": "الشاي", "a": "نعم"}
    ]


def test_csv_with_bom_and_a_quoted_multiline_cell(env):
    client, _, _ = env
    raw = '﻿input;expected_output\n"line one\nline two";yes\nplain;no\n'.encode("utf-8")
    resp = client.post(
        "/v1/datasets:upload",
        headers=AUTH,
        data={"name": "Multiline"},
        files={"file": ("m.csv", raw, "text/csv")},
    )
    assert resp.status_code == 200, resp.text
    items = client.get("/v1/datasets/multiline/versions/v1/items", headers=AUTH).json()[
        "items"
    ]
    assert [(item["input"], item["expected_output"]) for item in items] == [
        ("line one\nline two", "yes"),
        ("plain", "no"),
    ]


def test_jsonl_upload_rejects_non_utf8_and_keeps_u2028_inside_a_line(env):
    client, _, _ = env
    bad = client.post(
        "/v1/datasets:upload",
        headers=AUTH,
        data={"name": "Bad"},
        files={
            "file": (
                "bad.jsonl",
                '{"input": "é"}\n'.encode("cp1252"),
                "application/octet-stream",
            )
        },
    )
    assert (
        bad.status_code == 400
        and bad.json()["detail"] == "JSONL files must be UTF-8 encoded"
    )
    body = _upload_jsonl(client, "Sep", [{"input": "a b"}, {"input": "c"}])
    assert body["version"]["item_count"] == 2


# ------------------------------------------------------- copy, download, runs


def test_derived_version_copies_items_with_insert_select(env):
    client, factory, _ = env
    # SQLite's JSON may normalize odd numbers (1e20, -0.0); keep to plain ones here.
    _upload_jsonl(client, "Copy", SAMPLE_ROWS[:3], publish="true")
    with factory() as db:
        # A row written before search_text existed.
        db.query(DatasetItem).filter(DatasetItem.item_id == "a").update(
            {DatasetItem.search_text: None}
        )
        db.commit()
    resp = client.post(
        "/v1/datasets/copy/versions", headers=AUTH, json={"from_version": "v1"}
    )
    assert resp.status_code == 200, resp.text
    draft = resp.json()["version"]
    assert draft["item_count"] == 3
    with factory() as db:
        source = {
            i.item_id: i
            for i in db.query(DatasetItem).filter(
                DatasetItem.dataset_version_id != draft["id"]
            )
        }
        copies = (
            db.query(DatasetItem)
            .filter(DatasetItem.dataset_version_id == draft["id"])
            .all()
        )
        assert len(copies) == len(source)
        for copy in copies:
            original = source[copy.item_id]
            assert (
                copy.index,
                copy.input,
                copy.expected_output,
                copy.item_metadata,
                copy.labels,
                copy.fingerprint,
            ) == (
                original.index,
                original.input,
                original.expected_output,
                original.item_metadata,
                original.labels,
                original.fingerprint,
            )
            assert copy.search_text == dataset_item_search_text(
                copy.item_id, copy.input, copy.expected_output, copy.item_metadata
            )


def test_download_streams_every_item_in_index_order(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setattr(datasets_api, "_DOWNLOAD_BATCH_SIZE", 3)
    rows = [
        {"item_id": f"i{n}", "input": {"n": n, "t": "نص"}, "labels": ["l"]}
        for n in range(10)
    ]
    _upload_jsonl(client, "Down", rows)
    resp = client.get("/v1/datasets/down/versions/v1:download", headers=AUTH)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/x-ndjson")
    expected = "".join(
        json.dumps(
            {
                "item_id": row["item_id"],
                "input": row["input"],
                "expected_output": None,
                "metadata": {},
                "labels": ["l"],
            },
            ensure_ascii=False,
        )
        + "\n"
        for row in rows
    )
    assert resp.content.decode("utf-8") == expected


def _seed_runs(factory, version_id: str, dataset_id: str) -> None:
    with factory() as db:
        items = {
            i.item_id: i
            for i in db.query(DatasetItem).filter(
                DatasetItem.dataset_version_id == version_id
            )
        }
        for run_id, deleted in (("r1", False), ("r2", False), ("r3", True)):
            db.add(
                Run(
                    id=run_id,
                    project_id="project-1",
                    created_by_user_id="user-1",
                    owner_user_id="user-1",
                    task="t",
                    dataset="d",
                    dataset_id=dataset_id,
                    dataset_version_id=version_id,
                    metrics=["m1", "m2"],
                    run_metadata={},
                    run_config={},
                    status=RunWorkflowStatus.COMPLETED,
                )
            )
            if deleted:
                db.flush()
                db.query(Run).filter(Run.id == run_id).update(
                    {Run.deleted_at: Run.created_at}
                )
        db.flush()
        db.add_all(
            [
                RunItem(
                    run_id="r1",
                    item_id="a",
                    dataset_item_pk=items["a"].id,
                    input="x",
                    latency_ms=10.0,
                ),
                RunItem(
                    run_id="r1",
                    item_id="b",
                    dataset_item_pk=None,
                    input="x",
                    error="",
                    latency_ms=None,
                ),
                RunItem(
                    run_id="r1",
                    item_id="c",
                    dataset_item_pk=items["c"].id,
                    input="x",
                    error="boom",
                    latency_ms=5.0,
                ),
                RunItem(
                    run_id="r2",
                    item_id="a",
                    dataset_item_pk=None,
                    input="x",
                    latency_ms=20.0,
                ),
                RunItem(
                    run_id="r2",
                    item_id="b",
                    dataset_item_pk=items["b"].id,
                    input="x",
                    latency_ms=7.5,
                ),
                RunItem(
                    run_id="r3",
                    item_id="a",
                    dataset_item_pk=items["a"].id,
                    input="x",
                    latency_ms=99.0,
                ),
            ]
        )
        db.add_all(
            [
                RunItemScore(
                    run_id="r1", item_id="a", metric_name="m1", score_numeric=1.0
                ),
                RunItemScore(
                    run_id="r1",
                    item_id="a",
                    metric_name="m2",
                    score_numeric=None,
                    score_raw={"score": "0.25"},
                ),
                RunItemScore(
                    run_id="r1",
                    item_id="b",
                    metric_name="m1",
                    score_numeric=None,
                    score_raw="0.5",
                ),
                RunItemScore(
                    run_id="r1",
                    item_id="b",
                    metric_name="m2",
                    score_numeric=None,
                    score_raw="n/a",
                    explanation="long",
                ),
                RunItemScore(
                    run_id="r1",
                    item_id="c",
                    metric_name="m1",
                    score_numeric=0.0,
                    meta={"big": "x" * 100},
                ),
                RunItemScore(
                    run_id="r2", item_id="a", metric_name="m1", score_numeric=0.5
                ),
                RunItemScore(
                    run_id="r2",
                    item_id="b",
                    metric_name="m1",
                    score_numeric=None,
                    score_raw=True,
                ),
                RunItemScore(
                    run_id="r2",
                    item_id="b",
                    metric_name="m2",
                    score_numeric=None,
                    score_raw=None,
                ),
                RunItemScore(
                    run_id="r3", item_id="a", metric_name="m1", score_numeric=0.0
                ),
            ]
        )
        db.commit()


def _reference_run_averages(
    db, run_ids: list[str]
) -> tuple[Dict[str, Dict[str, float]], Dict[str, Optional[float]]]:
    """The averaging the runs list did over full score rows."""
    by_metric: Dict[str, Dict[str, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    by_run: Dict[str, list[float]] = defaultdict(list)
    for score in db.query(RunItemScore).filter(RunItemScore.run_id.in_(run_ids)):
        value = _numeric_score(score.score_numeric, score.score_raw)
        if value is None:
            continue
        by_metric[score.run_id][score.metric_name].append(value)
        by_run[score.run_id].append(value)
    metrics = {
        run_id: {name: round(sum(v) / len(v), 4) for name, v in sorted(values.items())}
        for run_id, values in by_metric.items()
    }
    evals = {
        run_id: round(sum(v) / len(v), 4) if v else None for run_id, v in by_run.items()
    }
    return metrics, evals


def test_dataset_runs_aggregate_in_sql_like_the_python_average(env):
    client, factory, _ = env
    body = _upload_jsonl(
        client, "Runs", [{"item_id": i, "input": i} for i in ("a", "b", "c")]
    )
    _seed_runs(factory, body["version"]["id"], body["dataset"]["id"])
    loaded: list[Any] = []
    listener = lambda target, context: loaded.append(target)  # noqa: E731
    event.listen(RunItemScore, "load", listener)
    try:
        resp = client.get("/v1/datasets/runs/runs", headers=AUTH)
    finally:
        event.remove(RunItemScore, "load", listener)
    assert resp.status_code == 200, resp.text
    assert loaded == [], "score rows are aggregated in SQL, not loaded"
    runs = {run["id"]: run for run in resp.json()["runs"]}
    with factory() as db:
        metrics, evals = _reference_run_averages(db, list(runs))
    assert set(runs) == {"r1", "r2"}
    for run_id, run in runs.items():
        assert run["metric_averages"] == metrics.get(run_id, {})
        assert run["eval_score"] == evals.get(run_id)
    assert runs["r1"]["metric_averages"] == {"m1": 0.5, "m2": 0.25}
    assert resp.json()["metric_names"] == ["m1", "m2"]


def _reference_summaries(
    db, version_id: str, items: list[Any]
) -> Dict[int, Dict[str, Any]]:
    """The previous row-by-row item summaries (copied), for equivalence."""
    by_pk = {item.id: item for item in items}
    by_item_id = {item.item_id: item for item in items}
    rows = (
        db.query(
            RunItem.run_id,
            RunItem.dataset_item_pk,
            RunItem.item_id,
            RunItem.error,
            RunItem.latency_ms,
        )
        .join(Run, RunItem.run_id == Run.id)
        .filter(Run.deleted_at.is_(None), Run.dataset_version_id == version_id)
        .all()
    )
    summaries = {
        item.id: {
            "run_count": 0,
            "success_count": 0,
            "error_count": 0,
            "avg_latency_ms": None,
            "avg_score": None,
            "metrics": {},
        }
        for item in items
    }
    keys: Dict[int, set] = {item.id: set() for item in items}
    latencies: Dict[int, list[float]] = {item.id: [] for item in items}
    for run_id, pk, run_item_id, error, latency in rows:
        item = by_pk.get(pk) if pk is not None else None
        if item is None:
            item = by_item_id.get(run_item_id)
        if item is None:
            continue
        summary = summaries[item.id]
        summary["run_count"] += 1
        summary["error_count" if error else "success_count"] += 1
        if latency is not None:
            latencies[item.id].append(float(latency))
        keys[item.id].add((run_id, run_item_id))
    scores: Dict[tuple, list] = defaultdict(list)
    for score in db.query(RunItemScore):
        scores[(score.run_id, score.item_id)].append(
            (score.metric_name, _numeric_score(score.score_numeric, score.score_raw))
        )
    for item in items:
        values: list[float] = []
        metrics: Dict[str, Dict[str, Any]] = {}
        for key in keys[item.id]:
            for name, value in scores.get(key, []):
                if value is None:
                    continue
                values.append(value)
                metric = metrics.setdefault(
                    name,
                    {"count": 0, "avg": None, "min": None, "max": None, "_sum": 0.0},
                )
                metric["count"] += 1
                metric["_sum"] += value
                metric["min"] = (
                    value if metric["min"] is None else min(metric["min"], value)
                )
                metric["max"] = (
                    value if metric["max"] is None else max(metric["max"], value)
                )
        for metric in metrics.values():
            metric["avg"] = round(metric.pop("_sum") / metric["count"], 4)
        summary = summaries[item.id]
        summary["avg_latency_ms"] = (
            round(sum(latencies[item.id]) / len(latencies[item.id]), 2)
            if latencies[item.id]
            else None
        )
        summary["avg_score"] = round(sum(values) / len(values), 4) if values else None
        summary["metrics"] = metrics
    return summaries


@pytest.mark.parametrize("filter_limit", [1000, 0])
def test_item_summaries_aggregate_in_sql_like_the_row_by_row_code(
    env, monkeypatch, filter_limit
):
    client, factory, _ = env
    monkeypatch.setattr(datasets_api, "_ITEM_FILTER_LIMIT", filter_limit)
    body = _upload_jsonl(
        client, "Sums", [{"item_id": i, "input": i} for i in ("a", "b", "c")]
    )
    version_id = body["version"]["id"]
    _seed_runs(factory, version_id, body["dataset"]["id"])
    with factory() as db:
        version = db.get(DatasetVersion, version_id)
        items = (
            db.query(DatasetItem.id, DatasetItem.item_id)
            .filter(DatasetItem.dataset_version_id == version_id)
            .all()
        )
        assert _item_result_summaries(db, version, items) == _reference_summaries(
            db, version_id, items
        )
        # A page that lacks item "a" ignores its rows either way.
        page = [row for row in items if row.item_id != "a"]
        assert _item_result_summaries(db, version, page) == _reference_summaries(
            db, version_id, page
        )
    by_runs = client.get(
        "/v1/datasets/sums/versions/v1/items",
        headers=AUTH,
        params={"sort": "runs_desc"},
    ).json()
    assert [item["item_id"] for item in by_runs["items"]] == ["a", "b", "c"]
    by_metric = client.get(
        "/v1/datasets/sums/versions/v1/items",
        headers=AUTH,
        params={"sort": "metric:m1:desc"},
    ).json()
    assert [item["item_id"] for item in by_metric["items"]] == ["a", "b", "c"]
    by_latency = client.get(
        "/v1/datasets/sums/versions/v1/items",
        headers=AUTH,
        params={"sort": "latency_asc"},
    ).json()
    assert [item["item_id"] for item in by_latency["items"]] == ["c", "b", "a"]


def test_edit_count_sort_reads_only_revision_keys(env):
    client, _, _ = env
    _upload_jsonl(
        client, "Edits", [{"item_id": i, "input": i} for i in ("a", "b", "c")]
    )
    for _ in range(2):
        client.patch(
            "/v1/datasets/edits/versions/v1/items/c",
            headers=AUTH,
            json={"input": f"c{_}"},
        )
    client.patch(
        "/v1/datasets/edits/versions/v1/items/a", headers=AUTH, json={"input": "a1"}
    )
    body = client.get(
        "/v1/datasets/edits/versions/v1/items",
        headers=AUTH,
        params={"sort": "edits_desc"},
    ).json()
    assert [(item["item_id"], item["edit_count"]) for item in body["items"]] == [
        ("c", 2),
        ("a", 1),
        ("b", 0),
    ]


# ---------------------------------------------------------------------- bulk


def _draft(client, name: str, rows: list[dict]) -> None:
    _upload_jsonl(client, name, rows)


def test_bulk_rejects_more_than_the_cap(env):
    client, _, _ = env
    _draft(client, "Cap", [{"item_id": "a", "input": "a"}])
    too_many = {
        "upserts": [{"input": n} for n in range(600)],
        "deletes": [f"x{n}" for n in range(401)],
    }
    resp = client.post(
        "/v1/datasets/cap/versions/v1/items:bulk", headers=AUTH, json=too_many
    )
    assert resp.status_code == 422
    assert "1000" in resp.json()["detail"]


def test_bulk_edits_are_set_based_and_number_revisions_in_order(env):
    client, factory, _ = env
    body = _upload_jsonl(
        client, "Bulk", [{"item_id": i, "input": i} for i in ("a", "b", "c")]
    )
    _seed_runs(factory, body["version"]["id"], body["dataset"]["id"])
    resp = client.post(
        "/v1/datasets/bulk/versions/v1/items:bulk",
        headers=AUTH,
        json={
            "deletes": ["a", "a", "missing"],
            "upserts": [
                {"item_id": "b", "input": "b2"},
                {"item_id": "new", "input": "n1"},
                {"input": "generated"},
                {"item_id": "new", "input": "n2"},
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["summary"] == {"created": 2, "updated": 2, "deleted": 1}
    assert out["deleted"] == ["a"]
    assert [row["item_id"] for row in out["created"]] == ["new", "item-5"]
    assert [row["item_id"] for row in out["updated"]] == ["b", "new"]
    assert out["updated"][1]["input"] == "n2"
    with factory() as db:
        version = db.get(DatasetVersion, body["version"]["id"])
        assert version.item_count == 4
        revisions = (
            db.query(DatasetItemRevision)
            .order_by(DatasetItemRevision.revision_number)
            .all()
        )
        assert [r.revision_number for r in revisions] == [1, 2, 3, 4, 5]
        assert [
            (r.change_type, (r.after or r.before)["item_id"]) for r in revisions
        ] == [
            ("deleted", "a"),
            ("updated", "b"),
            ("created", "new"),
            ("created", "item-5"),
            ("updated", "new"),
        ]
        # The deleted item's run results are detached, set-based.
        assert (
            db.query(RunItem)
            .filter(RunItem.item_id == "a", RunItem.dataset_item_pk.isnot(None))
            .count()
            == 0
        )


def test_bulk_create_of_a_taken_id_is_a_conflict_by_name(env):
    client, factory, _ = env
    _draft(
        client,
        "Taken",
        [{"item_id": "a", "input": "a"}, {"item_id": "item-3", "input": "x"}],
    )
    named = client.post(
        "/v1/datasets/taken/versions/v1/items:bulk",
        headers=AUTH,
        json={"upserts": [{"item_id": "a", "op": "create", "input": 1}]},
    )
    assert (
        named.status_code == 409
        and named.json()["detail"] == "Dataset item ID already exists: a"
    )
    # The next index is 2, so the generated ID "item-3" is taken.
    generated = client.post(
        "/v1/datasets/taken/versions/v1/items:bulk",
        headers=AUTH,
        json={"upserts": [{"input": 1}]},
    )
    assert (
        generated.status_code == 409
        and generated.json()["detail"] == "Dataset item ID already exists: item-3"
    )
    with factory() as db:
        assert db.query(DatasetItem).count() == 2
        assert db.query(DatasetItemRevision).count() == 0


# ------------------------------------------------------------------- compare


def test_unpaged_compare_caps_bodies_but_lists_every_changed_field(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setattr(datasets_api, "_COMPARE_DIFF_LIMIT", 2)
    _upload_jsonl(
        client,
        "Cmp",
        [{"item_id": f"i{n}", "input": n} for n in range(5)],
        publish="true",
    )
    client.post("/v1/datasets/cmp/versions", headers=AUTH, json={"from_version": "v1"})
    edits = {
        "upserts": [{"item_id": f"i{n}", "input": n + 100} for n in range(4)]
        + [{"item_id": f"n{n}", "input": n} for n in range(3)]
    }
    assert (
        client.post(
            "/v1/datasets/cmp/versions/v2/items:bulk", headers=AUTH, json=edits
        ).status_code
        == 200
    )
    body = client.get(
        "/v1/datasets/cmp/versions/v2:compare",
        headers=AUTH,
        params={"base": "v1", "include_diffs": 1},
    ).json()
    assert body["summary"] == {"added": 3, "removed": 0, "changed": 4, "unchanged": 1}
    assert len(body["changed"]) == 4 and all(
        entry["fields"] == ["input"] for entry in body["changed"]
    )
    assert len(body["field_diffs"]) == 2 and len(body["added_items"]) == 2
    assert body["diffs_truncated"] is True and body["diffs_limit"] == 2
    plain = client.get(
        "/v1/datasets/cmp/versions/v2:compare", headers=AUTH, params={"base": "v1"}
    ).json()
    assert (
        all(entry["fields"] == ["input"] for entry in plain["changed"])
        and "diffs_truncated" not in plain
    )
