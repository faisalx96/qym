"""Concurrent reads share work without crossing revisions, projects or permissions."""

from concurrent.futures import ThreadPoolExecutor
import threading
from unittest.mock import patch

from sqlalchemy.orm import Session
from qym_platform.api import dashboard
from qym_platform.db.models import RunItemScore, RunWorkflowStatus
from qym_platform.services.dashboard_cache import DashboardSnapshotCache
from test_dashboard_durable_summaries import database, run, item, drain


def test_concurrent_misses_compute_once_and_failed_work_can_retry():
    cache = DashboardSnapshotCache()
    started = threading.Event()
    release = threading.Event()
    calls = []

    def compute():
        calls.append(1)
        started.set()
        assert release.wait(5)
        return {"total": 5}

    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = [
            pool.submit(cache.get_or_compute, "same-revision", compute)
            for _ in range(12)
        ]
        assert started.wait(5)
        release.set()
        assert all(f.result() == {"total": 5} for f in futures)
    assert len(calls) == 1

    def failed():
        raise RuntimeError("database temporarily unavailable")

    try:
        cache.get_or_compute("next", failed)
    except RuntimeError:
        pass
    else:
        raise AssertionError("a failed read was published")
    assert cache.get_or_compute("next", lambda: {"total": 6}) == {"total": 6}


def test_cache_bounds_and_expiry(monkeypatch):
    clock = [10.0]
    monkeypatch.setattr(
        "qym_platform.services.dashboard_cache.time.monotonic", lambda: clock[0]
    )
    cache = DashboardSnapshotCache(max_entries=2, max_bytes=100, ttl=5)
    calls = []

    def read(key):
        return cache.get_or_compute(key, lambda: (calls.append(key) or {"key": key}))

    read("a")
    read("b")
    read("a")
    read("c")
    read("b")
    assert calls == ["a", "b", "c", "b"]
    clock[0] = 20.0
    read("b")
    assert calls[-2:] == ["b", "b"]
    big = lambda: "x" * 101
    cache.get_or_compute("oversize", big)
    assert "oversize" not in cache._entries
    assert cache._bytes <= 100 and len(cache._entries) <= 2


def test_api_cache_invalidates_on_publication_and_keeps_request_permissions(database):
    with Session(database) as db:
        run(db, status=RunWorkflowStatus.COMPLETED)
        item(db)
        db.add(
            RunItemScore(
                run_id="r", item_id="i", metric_name="score", score_numeric=1, meta={}
            )
        )
        db.commit()
    drain(database)
    overview_cache = DashboardSnapshotCache()
    page_cache = DashboardSnapshotCache()
    with patch.object(dashboard, "_overview_cache", overview_cache), patch.object(
        dashboard, "_page_cache", page_cache
    ), patch.object(
        dashboard, "_build_overview", wraps=dashboard._build_overview
    ) as build:

        def read(project, filters=None, sort="time-desc"):
            with Session(database) as db:
                return dashboard._overview(
                    db, project, filters or {}, sort
                ), dashboard._page(
                    db, project, filters or {}, limit=50, offset=0, sort=sort
                )

        manager = {"id": "p", "role": "MANAGER"}
        member = {"id": "p", "role": "MEMBER"}
        first, page = read(manager)
        second, member_page = read(member)
        assert build.call_count == 1
        assert second["project"]["role"] == member_page["project"]["role"] == "MEMBER"
        assert first["project"]["role"] == page["project"]["role"] == "MANAGER"
        read(member, {"tasks": ["missing"]})
        assert build.call_count == 2
        with Session(database) as db:
            score = db.query(RunItemScore).one()
            score.meta = {"status": "error"}
            score.score_numeric = 0
            db.commit()
        drain(database)
        updated, updated_page = read(member)
        assert build.call_count == 3
        assert updated["revision"] > first["revision"]
        assert updated_page["rows"][0]["execution_error_count"] == 1
        assert updated_page["rows"][0]["metric_averages"]["score"] == 0
