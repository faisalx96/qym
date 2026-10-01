"""Decoded Arabic matching on SQLite and an optional PostgreSQL test database.

Every case runs twice: on the stored ``search_text`` written at insert time
(C031) and on legacy rows whose ``search_text`` is still NULL (written before
migration 0066, not yet reached by the backfill), which must match the same.
"""

import os
from uuid import uuid4

import pytest
from sqlalchemy import String, cast, create_engine, update
from sqlalchemy.orm import Session

from qym_platform.db.base import Base
from qym_platform.db.models import Dataset, DatasetItem, DatasetVersion, Project, User
from qym_platform.services.dataset_search import filter_dataset_item_search


@pytest.fixture(scope="module", params=["sqlite", "postgresql"])
def search_engine(request):
    url = "sqlite://"
    if request.param == "postgresql":
        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("Set QYM_TEST_POSTGRES_URL to exercise PostgreSQL search")
    engine = create_engine(url)
    # A private schema keeps this test isolated from other database contents.
    schema = "test_dataset_search_" + uuid4().hex
    if request.param == "postgresql":
        with engine.begin() as connection:
            connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        engine = engine.execution_options(schema_translate_map={None: schema})
    Base.metadata.create_all(engine)
    yield engine
    if request.param == "postgresql":
        with engine.begin() as connection:
            connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
    engine.dispose()


@pytest.fixture(params=["stored", "legacy"])
def search_db(search_engine, request):
    with search_engine.connect() as connection:
        transaction = connection.begin()
        with Session(connection) as db:
            db.add(
                User(
                    id="search-user", email="search@example.test", display_name="Search"
                )
            )
            db.flush()
            db.add(
                Project(
                    id="search-project",
                    name="Search",
                    slug="search",
                    created_by_user_id="search-user",
                )
            )
            db.flush()
            db.add(
                Dataset(
                    id="search-dataset",
                    project_id="search-project",
                    name="Search",
                    slug="search",
                    created_by_user_id="search-user",
                )
            )
            db.flush()
            db.add(
                DatasetVersion(
                    id="search-version",
                    dataset_id="search-dataset",
                    version="v1",
                    created_by_user_id="search-user",
                )
            )
            db.flush()
            for index, (item_id, input_value, expected) in enumerate(
                [
                    ("أحمد-١", "ما عاصمة السُّـعودِيَّة؟", "الرِّيَاض"),
                    (
                        "nested",
                        {"messages": [{"content": "زيارة إلى مَكَّـة"}]},
                        ["مصطفى", "ﻻ شيء"],
                    ),
                    ("english", "Late invoice payment 100%", "Contact BILLING support"),
                    ("under_score", None, None),
                ]
            ):
                db.add(
                    DatasetItem(
                        dataset_version_id="search-version",
                        item_id=item_id,
                        index=index,
                        input=input_value,
                        expected_output=expected,
                        item_metadata=(
                            {"category": "فَواتير", "source": "Ticket-42"}
                            if item_id == "english"
                            else {"hidden": "بيانات سرية"}
                        ),
                        fingerprint="test",
                    )
                )
            db.flush()
            if request.param == "legacy":
                db.execute(update(DatasetItem).values(search_text=None))
                db.expire_all()
            yield db
        transaction.rollback()


@pytest.mark.parametrize(
    "search, expected",
    [
        ("السعودية", ["أحمد-١"]),
        (" السُّعُودِيَّة ", ["أحمد-١"]),
        ("الرياض", ["أحمد-١"]),
        ("احمد", ["أحمد-١"]),
        ("ا\u0654حمد", ["أحمد-١"]),
        ("مكة", ["nested"]),
        ("الي", ["nested"]),
        ("مصطفي", ["nested"]),
        ("لا شيء", ["nested"]),
        ("billing", ["english"]),
        ("PAYMENT", ["english"]),
        ("late payment", []),
        ("%", ["english"]),
        ("_", ["under_score"]),
        # Metadata is searched too (category and source values were invisible before).
        ("بيانات سرية", ["أحمد-١", "nested", "under_score"]),
        ("فواتير", ["english"]),
        ("ticket-42", ["english"]),
        ("مفقود", []),
    ],
)
def test_search_matches_decoded_and_normalized_values(search_db, search, expected):
    query = search_db.query(DatasetItem).filter(
        DatasetItem.dataset_version_id == "search-version"
    )
    matches = (
        filter_dataset_item_search(search_db, query, search)
        .order_by(DatasetItem.index)
        .all()
    )
    assert [item.item_id for item in matches] == expected


def test_existing_escaped_json_search_is_filtered_before_pagination(search_db):
    raw = (
        search_db.query(cast(DatasetItem.input, String))
        .filter(DatasetItem.item_id == "أحمد-١")
        .scalar()
    )
    assert "\\u" in raw
    assert "السعودية" not in raw
    # Searching "مكة" matches the nested JSON of one item; filtering happens
    # before paging, so the second page of a two-hit search is the second hit.
    query = filter_dataset_item_search(
        search_db, search_db.query(DatasetItem), "ر"
    ).order_by(DatasetItem.index)
    # ر: الرياض (expected), زيارة (nested input), سرية (metadata of the rest).
    assert query.count() == 4
    assert [row.item_id for row in query.offset(1).limit(1)] == ["nested"]
    only_input = filter_dataset_item_search(
        search_db, search_db.query(DatasetItem), "مكة"
    ).order_by(DatasetItem.index)
    assert [row.item_id for row in only_input] == ["nested"]


def test_search_text_is_written_on_insert_and_update(search_db, request):
    if request.node.callspec.params["search_db"] == "legacy":
        pytest.skip("legacy rows have no stored search text")
    item = search_db.query(DatasetItem).filter(DatasetItem.item_id == "english").one()
    assert "billing" in item.search_text and "ticket-42" in item.search_text
    item.expected_output = "Ask the أَرشيف team"
    search_db.flush()
    assert "ارشيف" in item.search_text and "billing" not in item.search_text
    query = search_db.query(DatasetItem).filter(DatasetItem.dataset_version_id == "search-version")
    assert [row.item_id for row in filter_dataset_item_search(search_db, query, "ارشيف", version_id="search-version")] == ["english"]


@pytest.mark.parametrize("search", ["", "  ", "ـُّ"])
def test_empty_normalized_search_does_not_remove_items(search_db, search):
    query = filter_dataset_item_search(search_db, search_db.query(DatasetItem), search)
    assert query.count() == 4
