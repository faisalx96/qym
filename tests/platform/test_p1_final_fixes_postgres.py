"""PostgreSQL-only regressions for the P1 final review fixes.

Skipped unless QYM_TEST_POSTGRES_URL points at a database these tests may
create schemas in.
"""

from __future__ import annotations

import os
import threading
import time
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text, update
from sqlalchemy.orm import sessionmaker

from qym_platform.db.base import Base
from qym_platform.db.models import Dataset, DatasetItem, DatasetVersion, Project, User, UserRole


@pytest.fixture()
def pg_engine():
    url = os.environ.get("QYM_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("QYM_TEST_POSTGRES_URL not configured")
    schema = "qym_p1fix_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    # public stays on the path for extensions (pg_trgm's operator classes).
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema},public"})
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def test_job_liveness_uses_the_database_clock(pg_engine, monkeypatch):
    """C036: a reader whose clock runs ahead must not call a live job lost."""
    from qym_platform.services import job_registry as registry_module
    from qym_platform.services.job_registry import JobDescription, JobRegistry

    registry = JobRegistry()
    desc = JobDescription(scope_id="run-1", status="RUNNING", active=True, snapshot={})
    assert registry.track(pg_engine, kind="analysis", job_id="job-1", describe=lambda: desc, on_cancel=lambda: None)
    try:
        real_now = registry_module.utc_now_naive
        # This process's clock is a minute ahead of the database's.
        monkeypatch.setattr(registry_module, "utc_now_naive", lambda: real_now() + timedelta(seconds=60))
        session = sessionmaker(bind=pg_engine)()
        try:
            row = registry.fetch(session, "analysis", "job-1")
            assert row is not None and row["lost"] is False
            assert [r["id"] for r in registry.active(session, "analysis")] == ["job-1"]
        finally:
            session.close()
        # A heartbeat the database clock saw long ago is still lost.
        with pg_engine.begin() as conn:
            conn.execute(
                update(registry_module.BackgroundJob.__table__)
                .values(heartbeat_at=text("timezone('utc', now()) - interval '60 seconds'"))
            )
        session = sessionmaker(bind=pg_engine)()
        try:
            assert registry.fetch(session, "analysis", "job-1")["lost"] is True
        finally:
            session.close()
    finally:
        handle = registry._handles.get("job-1")
        if handle is not None:
            registry._forget(handle)


def test_two_admins_disabling_each_other_leave_one_active(pg_engine):
    """C067: the count runs under a lock on the active admin rows."""
    from qym_platform.api.web import _other_active_admins_locked

    make = sessionmaker(bind=pg_engine, autoflush=False)
    with make() as db:
        db.add_all(
            [
                User(id="a", email="a@x.com", role=UserRole.ADMIN, is_active=True),
                User(id="b", email="b@x.com", role=UserRole.ADMIN, is_active=True),
            ]
        )
        db.commit()
    first, second = make(), make()
    try:
        # A disables B: it sees A, holds the lock, and has not committed yet.
        assert _other_active_admins_locked(first, "b") == ["a"]
        first.get(User, "b").is_active = False
        first.flush()
        seen = {}

        def other_side():
            # B disables A at the same time.
            seen["others"] = _other_active_admins_locked(second, "a")

        worker = threading.Thread(target=other_side)
        worker.start()
        time.sleep(0.5)
        assert worker.is_alive(), "the second count must wait for the first change"
        first.commit()
        worker.join(5)
        # B is no longer active once A's change is in: nobody else is left,
        # so the second request is refused instead of leaving zero admins.
        assert seen["others"] == []
    finally:
        second.rollback()
        first.close()
        second.close()


def _seed_dataset(engine):
    make = sessionmaker(bind=engine)
    with make() as db:
        for row in (
            User(id="u", email="u@x.com"),
            Project(id="p", name="P", slug="p", created_by_user_id="u"),
            Dataset(id="d", project_id="p", name="D", slug="d", created_by_user_id="u"),
            DatasetVersion(id="v1", dataset_id="d", version="v1", status="published", created_by_user_id="u"),
        ):
            db.add(row)
            db.flush()
        db.commit()
    return make


@pytest.mark.parametrize("needle", ['"refund', "null", 'said "hi"', "{}", "refund policy", "اهلا"])
def test_postgres_search_matches_the_same_before_and_after_the_backfill(pg_engine, needle):
    from qym_platform.services.dataset_search import filter_dataset_item_search

    make = _seed_dataset(pg_engine)
    bodies = [
        ("refund policy", None, None),
        ('she said "hi"', {"answer": "ok"}, {"tag": "x"}),
        ("plain", None, {"note": "أهلا"}),
    ]
    with make() as db:
        for pair in ("a", "b"):
            for n, (value, expected, metadata) in enumerate(bodies):
                db.add(DatasetItem(dataset_version_id="v1", item_id=f"{pair}{n}", index=n, input=value, expected_output=expected, item_metadata=metadata, fingerprint=f"{pair}{n}"))
        db.commit()
        db.execute(update(DatasetItem).where(DatasetItem.item_id.like("a%")).values(search_text=None))
        db.commit()
        query = db.query(DatasetItem).filter(DatasetItem.dataset_version_id == "v1")
        found = {item.item_id for item in filter_dataset_item_search(db, query, needle, version_id="v1")}
    assert {i[1:] for i in found if i[0] == "a"} == {i[1:] for i in found if i[0] == "b"}, (needle, sorted(found))


def test_backfill_builds_the_probe_index_and_finishes_on_an_empty_table(pg_engine):
    from qym_platform.services import maintenance

    make = _seed_dataset(pg_engine)
    with make() as db:
        maintenance.enqueue(db, "backfill_dataset_search_text", {})
        db.commit()
    worker = maintenance.MaintenanceWorker(make, pg_engine)
    status = None
    for _ in range(10):
        status = worker.tick()
        if status in ("succeeded", "failed"):
            break
    assert status == "succeeded"
    with pg_engine.connect() as conn:
        indexes = {
            row[0]: row[1]
            for row in conn.execute(
                text("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'dataset_items' AND schemaname = current_schema()")
            )
        }
        has_trgm = conn.execute(text("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")).first() is not None
    assert "ix_dataset_items_unindexed_version" in indexes
    assert "WHERE (search_text IS NULL)" in indexes["ix_dataset_items_unindexed_version"]
    if has_trgm:
        assert "ix_dataset_items_search_trgm" in indexes


def test_backfill_fills_a_window_with_one_update_statement(pg_engine):
    from sqlalchemy import event

    from qym_platform.services import maintenance

    make = _seed_dataset(pg_engine)
    with make() as db:
        for n in range(40):
            db.add(DatasetItem(dataset_version_id="v1", item_id=f"i{n}", index=n, input=f"t{n}", fingerprint=str(n)))
        db.commit()
        db.execute(update(DatasetItem).values(search_text=None))
        db.commit()
        maintenance.enqueue(db, "backfill_dataset_search_text", {"window": 100})
        db.commit()
    updates = []
    listener = lambda conn, cursor, statement, *rest: updates.append(statement) if statement.lstrip().upper().startswith("UPDATE DATASET_ITEMS") else None  # noqa: E731
    event.listen(pg_engine, "before_cursor_execute", listener)
    try:
        worker = maintenance.MaintenanceWorker(make, pg_engine)
        for _ in range(10):
            if worker.tick() in ("succeeded", "failed"):
                break
    finally:
        event.remove(pg_engine, "before_cursor_execute", listener)
    assert len(updates) == 1 and "VALUES" in updates[0].upper()
    with make() as db:
        assert db.query(DatasetItem).filter(DatasetItem.search_text.is_(None)).count() == 0
        assert db.query(DatasetItem).filter(DatasetItem.item_id == "i7").one().search_text.startswith("i7\nt7")
