"""Dataset integrity regressions from the design review (C003, C004, C016, C018, C019).

Covers partial item PATCH, Unicode slugs and name collisions, explicit create/append
upload intents, JSON/JSONL validation, and legacy CSV encoding detection.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.parse import quote, unquote

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("QYM_AUTH_MODE", "none")
os.environ.setdefault("QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8"))
ROOT = Path(__file__).resolve().parents[2]
for src in (ROOT / "packages" / "platform", ROOT / "packages" / "sdk"):
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))

from qym_platform.api.datasets import _decode_csv, _slugify
from qym_platform.app import create_app
from qym_platform.db.base import Base
from qym_platform.db.models import (
    ApiKey,
    Dataset,
    DatasetAlias,
    DatasetItemRevision,
    DatasetVersion,
    Project,
    ProjectMembership,
    ProjectRole,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.security import api_key_prefix, hash_api_key


@pytest.fixture()
def client_and_session(monkeypatch):
    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "none")
    monkeypatch.setenv("QYM_ALLOW_LEGACY_EMPTY_API_KEY_SCOPES", "true")
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with SessionLocal() as session:
        user = User(id="user-1", email="dev@local", display_name="Dev", role=UserRole.ADMIN)
        project = Project(id="project-1", name="Project", slug="project", created_by_user_id=user.id)
        session.add_all(
            [
                user,
                project,
                ProjectMembership(project_id=project.id, user_id=user.id, role=ProjectRole.MANAGER),
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
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield client, SessionLocal
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


AUTH = {"Authorization": "Bearer token-1"}


def _ref(value: str) -> str:
    return quote(value, safe="")


def _upload(client, *, name, content: bytes, filename="data.csv", **fields):
    data = {"name": name}
    data.update({key: value for key, value in fields.items() if value is not None})
    return client.post(
        "/v1/datasets:upload",
        headers=AUTH,
        data=data,
        files={"file": (filename, content, "application/octet-stream")},
    )


def _items(client, dataset_ref: str, version: str = "v1") -> list[dict]:
    resp = client.get(f"/v1/datasets/{_ref(dataset_ref)}/versions/{version}/items", headers=AUTH)
    assert resp.status_code == 200, resp.text
    return resp.json()["items"]


# ---------------------------------------------------------------------------
# C003: PATCH on a dataset item is a partial update.
# ---------------------------------------------------------------------------


def _draft_item(client) -> str:
    assert client.post("/v1/datasets", headers=AUTH, json={"name": "Patch", "slug": "patch"}).status_code == 200
    assert client.post("/v1/datasets/patch/versions", headers=AUTH, json={"version": "v1"}).status_code == 200
    created = client.post(
        "/v1/datasets/patch/versions/v1/items",
        headers=AUTH,
        json={
            "item_id": "case-1",
            "input": {"question": "q"},
            "expected_output": "51",
            "metadata": {"topic": "math"},
            "labels": ["hard", "gold"],
        },
    )
    assert created.status_code == 200, created.text
    return "/v1/datasets/patch/versions/v1/items/case-1"


def test_patch_with_one_field_keeps_every_other_field(client_and_session):
    client, SessionLocal = client_and_session
    url = _draft_item(client)
    original = client.get(url, headers=AUTH).json()["item"]

    only_expected = client.patch(url, headers=AUTH, json={"expected_output": "52"})
    assert only_expected.status_code == 200, only_expected.text
    item = only_expected.json()["item"]
    assert item["expected_output"] == "52"
    assert item["input"] == {"question": "q"}
    assert item["metadata"] == {"topic": "math"}
    assert item["labels"] == ["hard", "gold"]
    assert item["fingerprint"] != original["fingerprint"]

    only_input = client.patch(url, headers=AUTH, json={"input": "new q"})
    assert only_input.status_code == 200, only_input.text
    item = only_input.json()["item"]
    assert item["input"] == "new q"
    assert item["expected_output"] == "52"
    assert item["metadata"] == {"topic": "math"}
    assert item["labels"] == ["hard", "gold"]

    only_metadata = client.patch(url, headers=AUTH, json={"metadata": {"topic": "algebra"}})
    assert only_metadata.status_code == 200, only_metadata.text
    item = only_metadata.json()["item"]
    assert item["metadata"] == {"topic": "algebra"}
    assert (item["input"], item["expected_output"], item["labels"]) == ("new q", "52", ["hard", "gold"])

    only_labels = client.patch(url, headers=AUTH, json={"labels": ["easy"]})
    assert only_labels.status_code == 200, only_labels.text
    item = only_labels.json()["item"]
    assert item["labels"] == ["easy"]
    assert (item["input"], item["expected_output"], item["metadata"]) == ("new q", "52", {"topic": "algebra"})

    # The value types the caller sent are stored as-is (a numeric string stays a string).
    stored = client.get(url, headers=AUTH).json()["item"]
    assert stored["expected_output"] == "52" and isinstance(stored["expected_output"], str)

    # An explicit null still clears a field; omitted fields stay untouched.
    cleared = client.patch(url, headers=AUTH, json={"expected_output": None})
    assert cleared.status_code == 200, cleared.text
    item = cleared.json()["item"]
    assert item["expected_output"] is None
    assert item["labels"] == ["easy"]

    # A full body (the History revert path) still replaces every field.
    revert = client.patch(
        url,
        headers=AUTH,
        json={"item_id": "case-1", "input": "r", "expected_output": 7, "metadata": {}, "labels": []},
    )
    assert revert.status_code == 200, revert.text
    item = revert.json()["item"]
    assert (item["input"], item["expected_output"], item["metadata"], item["labels"]) == ("r", 7, {}, [])


def test_empty_or_unchanged_patch_writes_no_revision(client_and_session):
    client, SessionLocal = client_and_session
    url = _draft_item(client)
    with SessionLocal() as db:
        before = db.query(DatasetItemRevision).count()

    empty = client.patch(url, headers=AUTH, json={})
    assert empty.status_code == 200, empty.text
    same = client.patch(url, headers=AUTH, json={"expected_output": "51"})
    assert same.status_code == 200, same.text
    assert same.json()["item"]["labels"] == ["hard", "gold"]

    with SessionLocal() as db:
        assert db.query(DatasetItemRevision).count() == before


def test_compare_reports_type_only_changes(client_and_session):
    client, _ = client_and_session
    assert client.post("/v1/datasets", headers=AUTH, json={"name": "Typed", "slug": "typed"}).status_code == 200
    assert client.post("/v1/datasets/typed/versions", headers=AUTH, json={"version": "v1"}).status_code == 200
    for item_id, expected in (("a", "51"), ("b", 1)):
        created = client.post(
            "/v1/datasets/typed/versions/v1/items",
            headers=AUTH,
            json={"item_id": item_id, "input": "q", "expected_output": expected},
        )
        assert created.status_code == 200, created.text
    assert client.post("/v1/datasets/typed/versions/v1:publish", headers=AUTH, json={}).status_code == 200
    draft = client.post("/v1/datasets/typed/versions", headers=AUTH, json={"version": "v2", "from_version": "v1"})
    assert draft.status_code == 200, draft.text
    assert client.patch("/v1/datasets/typed/versions/v2/items/a", headers=AUTH, json={"expected_output": 51}).status_code == 200
    assert client.patch("/v1/datasets/typed/versions/v2/items/b", headers=AUTH, json={"expected_output": True}).status_code == 200

    compare = client.get("/v1/datasets/typed/versions/v2:compare?base=v1&include_diffs=1", headers=AUTH)
    assert compare.status_code == 200, compare.text
    fields = {row["item_id"]: row["fields"] for row in compare.json()["field_diffs"]}
    assert fields == {"a": ["expected_output"], "b": ["expected_output"]}


def test_patch_rejects_non_object_metadata(client_and_session):
    client, _ = client_and_session
    url = _draft_item(client)
    bad = client.patch(url, headers=AUTH, json={"metadata": "oops"})
    assert bad.status_code == 422
    assert client.get(url, headers=AUTH).json()["item"]["metadata"] == {"topic": "math"}


# ---------------------------------------------------------------------------
# C004: Unicode-aware slugs; different names never merge.
# ---------------------------------------------------------------------------


def test_slugify_keeps_letters_from_any_script():
    assert _slugify("  Customer Support QA!  ") == "customer-support-qa"
    assert _slugify("snake_case name") == "snake-case-name"
    assert _slugify("بيانات التقييم") == "بيانات-التقييم"
    assert _slugify("أسئلة المرور") == "أسئلة-المرور"
    assert _slugify("بيانات التقييم") != _slugify("أسئلة المرور")
    assert _slugify("Café crème") == "café-crème"
    # Names with no letters or digits get a unique fallback, never a shared constant.
    first, second = _slugify("🚀🚀"), _slugify("!!!")
    assert first.startswith("dataset-") and second.startswith("dataset-")
    assert first != second
    assert len(_slugify("س" * 400)) <= 120


def test_arabic_dataset_names_create_distinct_datasets(client_and_session):
    client, SessionLocal = client_and_session
    first = client.post("/v1/datasets", headers=AUTH, json={"name": "مجموعة فارغة"})
    second = client.post("/v1/datasets", headers=AUTH, json={"name": "مجموعة ثانية"})
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["dataset"]["slug"] == "مجموعة-فارغة"
    assert second.json()["dataset"]["slug"] == "مجموعة-ثانية"

    fetched = client.get(f"/v1/datasets/{_ref('مجموعة-فارغة')}", headers=AUTH)
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["dataset"]["name"] == "مجموعة فارغة"


def test_two_arabic_uploads_do_not_merge_or_move_production(client_and_session):
    client, SessionLocal = client_and_session
    csv_bytes = "question,answer\nما هي عاصمة السعودية؟,الرياض\n".encode("utf-8")
    first = _upload(
        client,
        name="بيانات التقييم",
        content=csv_bytes,
        input_cols="question",
        expected_cols="answer",
        publish="true",
        set_alias="production",
    )
    assert first.status_code == 200, first.text
    second_bytes = "question,answer\nكم عدد أيام الأسبوع؟,سبعة\n".encode("utf-8")
    second = _upload(
        client,
        name="أسئلة المرور",
        content=second_bytes,
        input_cols="question",
        expected_cols="answer",
        publish="true",
        set_alias="production",
    )
    assert second.status_code == 200, second.text

    assert first.json()["dataset"]["id"] != second.json()["dataset"]["id"]
    assert second.json()["dataset"]["name"] == "أسئلة المرور"
    assert second.json()["version"]["version"] == "v1"
    first_items = _items(client, first.json()["dataset"]["slug"], "production")
    assert [row["input"] for row in first_items] == ["ما هي عاصمة السعودية؟"]


@pytest.mark.parametrize(
    "name, slug, fallback",
    [
        ("بيانات التقييم", "بيانات-التقييم", "dataset-v1.jsonl"),
        ("评估数据", "评估数据", "dataset-v1.jsonl"),
        ("Café crème", "café-crème", "cafe-creme-v1.jsonl"),
        ("Plain Name", "plain-name", None),
    ],
)
def test_version_download_names_the_file_in_any_script(client_and_session, name, slug, fallback):
    """A Unicode slug in the Latin-1 Content-Disposition header returned 500."""
    client, SessionLocal = client_and_session
    content = "question,answer\nما هي عاصمة السعودية؟,الرياض\n".encode("utf-8")
    uploaded = _upload(
        client, name=name, content=content, input_cols="question", expected_cols="answer", publish="true"
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["dataset"]["slug"] == slug

    resp = client.get(f"/v1/datasets/{_ref(slug)}/versions/v1:download", headers=AUTH)
    assert resp.status_code == 200, resp.text
    assert [json.loads(line)["input"] for line in resp.text.splitlines()] == ["ما هي عاصمة السعودية؟"]
    disposition = resp.headers["content-disposition"]
    if fallback is None:
        # ASCII names keep the header they had before.
        assert disposition == f'attachment; filename="{slug}-v1.jsonl"'
    else:
        plain, _, encoded = disposition.partition("; filename*=UTF-8''")
        assert plain == f'attachment; filename="{fallback}"'
        assert unquote(encoded) == f"{slug}-v1.jsonl"


def test_upload_never_merges_into_a_dataset_with_a_different_name(client_and_session):
    client, SessionLocal = client_and_session
    csv_bytes = b"input,expected_output\nq,a\n"
    base = _upload(client, name="QA Set", content=csv_bytes, publish="true", set_alias="production")
    assert base.status_code == 200, base.text
    assert base.json()["dataset"]["slug"] == "qa-set"

    # A different display name that happens to produce the same slug is a conflict.
    clash = _upload(client, name="QA_Set", content=csv_bytes, publish="true", set_alias="production")
    assert clash.status_code == 409, clash.text
    assert "qa-set" in clash.json()["detail"]
    assert "QA Set" in clash.json()["detail"]

    # SDK/CI re-uploads by the same name (or by the slug itself) still add a version.
    same_name = _upload(client, name="QA Set", content=csv_bytes)
    assert same_name.status_code == 200, same_name.text
    assert same_name.json()["version"]["version"] == "v2"
    by_slug = _upload(client, name="qa-set", content=csv_bytes)
    assert by_slug.status_code == 200, by_slug.text
    assert by_slug.json()["version"]["version"] == "v3"
    assert by_slug.json()["dataset"]["name"] == "QA Set"

    with SessionLocal() as db:
        assert db.query(Dataset).count() == 1
        alias = db.query(DatasetAlias).filter(DatasetAlias.alias == "production").one()
        version = db.query(DatasetVersion).filter(DatasetVersion.id == alias.dataset_version_id).one()
        assert version.version == "v1"


def test_create_dataset_conflict_names_the_slug(client_and_session):
    client, _ = client_and_session
    assert client.post("/v1/datasets", headers=AUTH, json={"name": "Support QA"}).status_code == 200
    clash = client.post("/v1/datasets", headers=AUTH, json={"name": "support_qa"})
    assert clash.status_code == 409
    assert "support-qa" in clash.json()["detail"]

    # Renaming another dataset's slug onto a taken one is a 409 too (it used to be a 500).
    assert client.post("/v1/datasets", headers=AUTH, json={"name": "Other"}).status_code == 200
    rename = client.patch("/v1/datasets/other", headers=AUTH, json={"slug": "Support QA"})
    assert rename.status_code == 409, rename.text
    assert "support-qa" in rename.json()["detail"] and "Support QA" in rename.json()["detail"]
    assert client.get("/v1/datasets/other", headers=AUTH).json()["dataset"]["slug"] == "other"


def test_legacy_dataset_with_old_slug_still_receives_same_name_uploads(client_and_session):
    client, SessionLocal = client_and_session
    with SessionLocal() as db:
        db.add(
            Dataset(
                id="legacy-ds",
                project_id="project-1",
                name="بيانات التقييم",
                slug="dataset",
                created_by_user_id="user-1",
            )
        )
        db.commit()
    upload = _upload(client, name="بيانات التقييم", content=b"input\nq\n", input_cols="input")
    assert upload.status_code == 200, upload.text
    assert upload.json()["dataset"]["id"] == "legacy-ds"
    other = _upload(client, name="أسئلة المرور", content=b"input\nq\n", input_cols="input")
    assert other.status_code == 200, other.text
    assert other.json()["dataset"]["id"] != "legacy-ds"


def test_upload_matches_an_existing_name_ignoring_case(client_and_session):
    client, SessionLocal = client_and_session
    csv_bytes = b"input\nq\n"
    # A dataset whose slug is not derived from its name (custom slug, or an older slug rule).
    assert client.post("/v1/datasets", headers=AUTH, json={"name": "Customer QA", "slug": "cqa"}).status_code == 200
    with SessionLocal() as db:
        db.add(Dataset(id="legacy-latin", project_id="project-1", name="Café Crème", slug="caf-cr-me", created_by_user_id="user-1"))
        db.commit()

    # "Create dataset" must not create a second dataset whose name differs only in case.
    clash = _upload(client, name="customer qa", content=csv_bytes, input_cols="input", create_only="true")
    assert clash.status_code == 409, clash.text
    assert "Customer QA" in clash.json()["detail"]

    # SDK/CI re-uploads by the same name in another case still append to that dataset.
    appended = _upload(client, name="customer qa", content=csv_bytes, input_cols="input")
    assert appended.status_code == 200, appended.text
    assert appended.json()["dataset"]["slug"] == "cqa"
    legacy = _upload(client, name="café crème", content=csv_bytes, input_cols="input")
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["dataset"]["id"] == "legacy-latin"
    with SessionLocal() as db:
        assert db.query(Dataset).count() == 2


# ---------------------------------------------------------------------------
# C018: explicit create-only and new-version intents on upload.
# ---------------------------------------------------------------------------


def test_create_only_upload_rejects_an_existing_name(client_and_session):
    client, SessionLocal = client_and_session
    csv_bytes = b"input,expected_output\nq,a\n"
    base = _upload(client, name="ragbench-100", content=csv_bytes, publish="true", set_alias="production")
    assert base.status_code == 200, base.text

    clash = _upload(
        client,
        name="ragbench-100",
        content=b"input,expected_output\nother,b\n",
        create_only="true",
        publish="true",
        set_alias="production",
    )
    assert clash.status_code == 409, clash.text
    assert "ragbench-100" in clash.json()["detail"]
    with SessionLocal() as db:
        assert db.query(DatasetVersion).count() == 1
    assert [row["input"] for row in _items(client, "ragbench-100", "production")] == ["q"]

    fresh = _upload(client, name="Fresh set", content=csv_bytes, create_only="true")
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["version"]["version"] == "v1"


def test_upload_to_explicit_dataset_adds_a_version(client_and_session):
    client, _ = client_and_session
    base = _upload(client, name="Target", content=b"input\nq\n", input_cols="input", publish="true", set_alias="production")
    assert base.status_code == 200, base.text
    dataset_id = base.json()["dataset"]["id"]

    appended = _upload(client, name="ignored when dataset_ref is set", content=b"input\nq2\n", input_cols="input", dataset_ref=dataset_id)
    assert appended.status_code == 200, appended.text
    assert appended.json()["dataset"]["id"] == dataset_id
    assert appended.json()["dataset"]["name"] == "Target"
    assert appended.json()["version"]["version"] == "v2"
    assert appended.json()["version"]["status"] == "draft"

    missing = _upload(client, name="Target", content=b"input\nq\n", input_cols="input", dataset_ref="nope")
    assert missing.status_code == 404


# ---------------------------------------------------------------------------
# C016: JSON arrays, explicit format, and line-numbered JSONL errors.
# ---------------------------------------------------------------------------


def test_json_array_upload_is_parsed_as_json(client_and_session):
    client, _ = client_and_session
    content = b'[{"id": "a", "input": "q1", "expected": "x"}, {"input": {"q": 2}, "expected_output": 3}]'
    upload = _upload(client, name="Json array", content=content, filename="rows.json")
    assert upload.status_code == 200, upload.text
    assert upload.json()["version"]["source_type"] == "json"
    rows = _items(client, "json-array")
    assert [(row["item_id"], row["input"], row["expected_output"]) for row in rows][0] == ("a", "q1", "x")
    assert rows[1]["input"] == {"q": 2} and rows[1]["expected_output"] == 3


def test_json_file_with_jsonl_content_and_explicit_format(client_and_session):
    client, _ = client_and_session
    content = b'{"input": "q1"}\n{"input": "q2"}\n'
    as_json_name = _upload(client, name="Lines in json", content=content, filename="rows.json")
    assert as_json_name.status_code == 200, as_json_name.text
    assert len(_items(client, "lines-in-json")) == 2

    explicit = _upload(client, name="Explicit", content=content, filename="rows.txt", format="jsonl")
    assert explicit.status_code == 200, explicit.text
    assert explicit.json()["version"]["source_type"] == "jsonl"

    unknown = _upload(client, name="Unknown", content=content, filename="rows.txt", format="xml")
    assert unknown.status_code == 400


def test_invalid_jsonl_lines_are_reported_with_line_numbers(client_and_session):
    client, SessionLocal = client_and_session
    content = b'{"input": "ok"}\n{bad json}\n\n["not", "object"]\n{"input": "fine"}\n'
    upload = _upload(client, name="Broken", content=content, filename="rows.jsonl")
    assert upload.status_code == 400
    detail = upload.json()["detail"]
    assert "line 2" in detail and "line 4" in detail
    assert "2 of 4" in detail
    with SessionLocal() as db:
        assert db.query(Dataset).count() == 0

    bad_array = _upload(client, name="Bad array", content=b'[{"input": 1}, 5]', filename="rows.json")
    assert bad_array.status_code == 400
    assert "item 2" in bad_array.json()["detail"]

    not_utf8 = _upload(client, name="Latin", content='{"input": "é"}\n'.encode("cp1252"), filename="rows.jsonl")
    assert not_utf8.status_code == 400
    assert "UTF-8" in not_utf8.json()["detail"]


# ---------------------------------------------------------------------------
# C019: Windows-1256 detection and an explicit encoding choice.
# ---------------------------------------------------------------------------

ARABIC_CSV = "question,answer\nما هي عاصمة المملكة العربية السعودية؟,الرياض\nكم عدد أيام الأسبوع؟,سبعة\n"


def test_decode_csv_detects_windows_1256_arabic():
    text, encoding = _decode_csv(ARABIC_CSV.encode("cp1256"))
    assert text == ARABIC_CSV
    assert encoding == "windows-1256"


@pytest.mark.parametrize(
    "text",
    [
        "question;answer\nCafé?;Crème brûlée\nÇa va?;Très bien\n",
        "q,a\nSeñor, ¿cómo está?,Muy bien. ¡Olé!\n",
        "q,a\nGrüße aus der Straße,Schön\nÄpfel und Öl,Übung\n",
        "q,a\nNão, obrigado,Coração\n",
        "q,a\n£100,€5\n",
    ],
)
def test_decode_csv_keeps_windows_1252_for_latin_text(text):
    decoded, encoding = _decode_csv(text.encode("cp1252"))
    assert decoded == text
    assert encoding == "windows-1252"


def test_decode_csv_handles_persian_letters_undefined_in_1252():
    text = "q,a\nپرسش چيست؟,گزارش ژرف\n"
    decoded, encoding = _decode_csv(text.encode("cp1256"))
    assert decoded == text
    assert encoding == "windows-1256"


def test_decode_csv_explicit_encoding():
    raw = ARABIC_CSV.encode("cp1256")
    assert _decode_csv(raw, "windows-1256")[0] == ARABIC_CSV
    assert _decode_csv(ARABIC_CSV.encode("utf-8"), "utf-8")[0] == ARABIC_CSV
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        _decode_csv(raw, "utf-8")
    assert exc.value.status_code == 400
    assert "UTF-8" in exc.value.detail
    with pytest.raises(HTTPException) as exc:
        _decode_csv(raw, "klingon")
    assert exc.value.status_code == 400


def test_arabic_windows_1256_csv_upload_stores_arabic(client_and_session):
    client, _ = client_and_session
    upload = _upload(
        client,
        name="Arabic Excel",
        content=ARABIC_CSV.encode("cp1256"),
        input_cols="question",
        expected_cols="answer",
    )
    assert upload.status_code == 200, upload.text
    assert upload.json()["version"]["schema"]["encoding"] == "windows-1256"
    rows = _items(client, "arabic-excel")
    assert rows[0]["input"] == "ما هي عاصمة المملكة العربية السعودية؟"
    assert rows[1]["expected_output"] == "سبعة"

    forced = _upload(
        client,
        name="Arabic forced",
        content=ARABIC_CSV.encode("cp1256"),
        input_cols="question",
        expected_cols="answer",
        encoding="utf-8",
    )
    assert forced.status_code == 400
    assert "CSV UTF-8" in forced.json()["detail"]
