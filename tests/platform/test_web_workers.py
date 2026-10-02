"""C036: several web worker processes, background loops in one place, shared job state."""

from __future__ import annotations

import asyncio
import os
import signal
import socket
import sys
import threading
import time
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text, update
from sqlalchemy.orm import Session

from qym_platform import serve
from qym_platform.datetime_utils import utc_now_naive
from qym_platform.db.background_job_models import BackgroundJob
from qym_platform.services import job_registry as registry_module
from qym_platform.services.analysis_jobs import AnalysisJobManager, RemoteAnalysisJob
from qym_platform.services.job_registry import job_registry
from qym_platform.services.product_evals import (
    ProductEvalJob,
    ProductEvalJobManager,
    RemoteProductEvalJob,
)

ROOT = Path(__file__).resolve().parents[2]


# -- launcher -----------------------------------------------------------------


def test_default_entrypoint_keeps_the_single_uvicorn_process() -> None:
    entrypoint = (ROOT / "docker" / "entrypoint.sh").read_text(encoding="utf-8")
    assert 'if [ "${QYM_WEB_WORKERS:-1}" != "1" ]; then' in entrypoint
    assert "exec python -m qym_platform.serve" in entrypoint
    # Unset QYM_WEB_WORKERS: the exact single-process command as before.
    assert (
        "exec uvicorn qym_platform.main:app --host 0.0.0.0 --port 8000 ${QYM_UVICORN_ARGS:-}"
        in entrypoint
    )
    compose = (ROOT / "docker" / "docker-compose.yml").read_text(encoding="utf-8")
    assert "QYM_WEB_WORKERS: ${QYM_WEB_WORKERS:-1}" in compose


def test_role_all_with_workers_moves_the_loops_to_one_process() -> None:
    spec = serve.plan({"QYM_ROLE": "all", "QYM_WEB_WORKERS": "4", "QYM_UVICORN_ARGS": "--proxy-headers"})
    argv = spec["uvicorn_argv"]
    assert argv[1:5] == ["-m", "qym_platform.serve", "--uvicorn", "qym_platform.main:app"]
    assert argv[argv.index("--workers") + 1] == "4"
    assert argv[-1] == "--proxy-headers"
    # HTTP workers run no loops; exactly one extra process does.
    assert spec["web_env"]["QYM_ROLE"] == "api"
    assert spec["loops_argv"][1:] == ["-m", "qym_platform.worker"]
    assert spec["loops_env"]["QYM_ROLE"] == "worker"


def test_api_role_and_single_worker_start_no_loop_process() -> None:
    api = serve.plan({"QYM_ROLE": "api", "QYM_WEB_WORKERS": "3"})
    assert api["loops_argv"] is None and api["web_env"]["QYM_ROLE"] == "api"
    single = serve.plan({"QYM_WEB_WORKERS": "1"})
    # One process keeps the loops in-process, exactly like plain uvicorn.
    assert single["loops_argv"] is None
    assert single["web_env"].get("QYM_ROLE", "all") == "all"


@pytest.mark.parametrize("env", [{"QYM_WEB_WORKERS": "0"}, {"QYM_WEB_WORKERS": "four"}, {"QYM_ROLE": "worker"}])
def test_launcher_rejects_bad_configuration(env) -> None:
    with pytest.raises(SystemExit):
        serve.plan(env)


def test_uvicorn_children_use_the_no_delay_protocol(monkeypatch) -> None:
    import importlib

    uvicorn_main = importlib.import_module("uvicorn.main")  # the module, not the command
    seen = {}
    monkeypatch.setattr(uvicorn_main, "run", lambda app, **kwargs: seen.update(kwargs, app=app))
    serve.run_uvicorn(["qym_platform.main:app", "--port", "9", "--workers", "3"])
    assert seen["app"] == "qym_platform.main:app"
    assert seen["workers"] == 3
    assert seen["http"] is serve.HttpProtocol
    seen.clear()
    serve.run_uvicorn(["qym_platform.main:app", "--http", "h11"])
    assert seen["http"] == "h11"


def test_no_delay_protocol_turns_nagle_off() -> None:
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    client = socket.create_connection(listener.getsockname())
    accepted, _ = listener.accept()
    # Rebuilt from a descriptor, as uvicorn's worker processes do: proto 0.
    rebuilt = socket.socket(fileno=accepted.detach())
    try:
        rebuilt.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 0)

        class Transport:
            def get_extra_info(self, name):
                return rebuilt if name == "socket" else None

        serve._set_nodelay(Transport())
        assert rebuilt.getsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY) == 1
    finally:
        rebuilt.close()
        client.close()
        listener.close()


def test_supervisor_restarts_the_loops_and_stops_them_with_the_web(tmp_path: Path) -> None:
    marks = tmp_path / "loops.log"
    loops = (
        "import sys, time\n"
        f"open({str(marks)!r}, 'a').write('start\\n')\n"
        "sys.exit(1) if sum(1 for _ in open(%r)) == 1 else time.sleep(60)\n" % str(marks)
    )
    spec = {
        "workers": 2,
        "uvicorn_argv": [sys.executable, "-c", "import time; time.sleep(2.5)"],
        "web_env": None,
        "loops_argv": [sys.executable, "-c", loops],
        "loops_env": None,
    }
    supervisor = serve._Supervisor(spec)
    started = time.monotonic()
    # run() installs SIGTERM/SIGINT handlers; give pytest its own back after.
    saved = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
        code = supervisor.run()
    finally:
        for sig, handler in saved.items():
            signal.signal(sig, handler)
    assert code == 0
    assert time.monotonic() - started < 20
    # First loop process crashed and was restarted; the second was stopped.
    assert marks.read_text().splitlines() == ["start", "start"]
    assert supervisor.loops.poll() is not None


# -- shared job state -----------------------------------------------------------


@pytest.fixture(params=["sqlite", "postgres"])
def shared_db(request, tmp_path: Path, monkeypatch):
    monkeypatch.setattr(registry_module, "FLUSH_SECONDS", 0.05)
    monkeypatch.setattr(registry_module, "HEARTBEAT_SECONDS", 0.2)
    admin = schema = None
    if request.param == "postgres":
        url = os.environ.get("QYM_TEST_POSTGRES_URL")
        if not url:
            pytest.skip("QYM_TEST_POSTGRES_URL not configured")
        schema = "qym_jobs_" + uuid4().hex
        admin = create_engine(url)
        with admin.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        connect_args = {"options": f"-csearch_path={schema}"}
        engine = create_engine(url, connect_args=connect_args)
    else:
        connect_args = {}
        engine = create_engine(f"sqlite:///{tmp_path / 'jobs.db'}")
    engine.test_connect_args = connect_args  # for tests that build a second engine
    BackgroundJob.__table__.create(engine)
    try:
        yield engine
    finally:
        engine.dispose()
        if admin is not None:
            with admin.begin() as conn:
                conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()


def _until(predicate, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return predicate()


@pytest.fixture
def managers():
    owner, other = AnalysisJobManager(), AnalysisJobManager()
    try:
        yield owner, other
    finally:
        for manager in (owner, other):
            manager.clear()
            manager.shutdown(wait=True)


@pytest.mark.asyncio
async def test_another_process_polls_finds_and_cancels_a_running_analysis(shared_db, managers) -> None:
    owner, other = managers  # two web worker processes
    started = threading.Event()

    async def runner(job):
        owner.update_progress(job, completed=1, total=3)
        started.set()
        await asyncio.Event().wait()
        return {}

    job, created = await owner.submit(
        run_id="run-1", user_id="u", auth_type="none", request_payload={"pass_number": 2},
        progress={"total": 3, "completed": 0}, runner=runner, store_bind=shared_db,
    )
    assert created is True
    assert await asyncio.get_running_loop().run_in_executor(None, started.wait, 5)
    with Session(shared_db) as db:
        assert _until(lambda: (other.get(job.job_id, db=db).snapshot()["progress"] or {}).get("completed") == 1)
        seen = other.get(job.job_id, db=db)
        assert isinstance(seen, RemoteAnalysisJob)
        assert seen.run_id == "run-1" and seen.status == "running"
        assert other.snapshot(seen)["pass_number"] == 2
        # A newly opened page on the other process resumes the same job...
        assert other.active_for_run("run-1", 2, db=db).job_id == job.job_id
        assert other.active_for_run("run-1", None, db=db) is None
        assert "run-1" in other.active_scope_ids(db)
    # ...and a second start there does not launch a duplicate.
    again, created_again = await other.submit(
        run_id="run-1", user_id="u2", auth_type="none", request_payload={"pass_number": 2},
        progress={}, runner=runner, store_bind=shared_db,
    )
    assert created_again is False and again.job_id == job.job_id

    with Session(shared_db) as db:
        cancelled = other.cancel(job.job_id, db=db)
        assert cancelled.status == "cancelled"
        assert other.snapshot(cancelled)["progress"]["phase"] == "cancelled"
    # The owning process stops the job at its next flush.
    assert await asyncio.get_running_loop().run_in_executor(
        None, lambda: _until(lambda: job.status == "cancelled")
    )
    await asyncio.wait_for(asyncio.wrap_future(job.future), timeout=5)
    with Session(shared_db) as db:
        assert other.get(job.job_id, db=db).status == "cancelled"
        assert other.active_for_run("run-1", 2, db=db) is None


@pytest.mark.asyncio
async def test_archive_stops_jobs_of_every_process(shared_db, managers) -> None:
    owner, other = managers

    async def runner(job):
        await asyncio.Event().wait()
        return {}

    job, _ = await owner.submit(
        run_id="run-9", user_id="u", auth_type="none", request_payload={},
        progress={}, runner=runner, store_bind=shared_db,
    )
    with Session(shared_db) as db:
        assert other.cancel_scopes({"run-9"}, db=db) == 1
    assert await asyncio.get_running_loop().run_in_executor(
        None, lambda: _until(lambda: job.status == "cancelled")
    )


@pytest.mark.asyncio
async def test_finished_result_is_visible_to_other_processes(shared_db, managers) -> None:
    owner, other = managers

    async def runner(job):
        return {"total_analyzed": 4}

    job, _ = await owner.submit(
        run_id="run-2", user_id="u", auth_type="none", request_payload={},
        progress={}, runner=runner, store_bind=shared_db,
    )
    await asyncio.wait_for(asyncio.wrap_future(job.future), timeout=5)
    with Session(shared_db) as db:
        seen = other.get(job.job_id, db=db)
        snap = other.snapshot(seen)
        assert seen.status == "completed"
        assert snap["result"] == {"total_analyzed": 4}
        assert snap["completed_at"] is not None
    assert not job_registry.is_tracked(job.job_id)


@pytest.mark.asyncio
async def test_job_of_a_stopped_process_reads_as_failed(shared_db, managers) -> None:
    owner, other = managers

    async def runner(job):
        await asyncio.Event().wait()
        return {}

    job, _ = await owner.submit(
        run_id="run-3", user_id="u", auth_type="none", request_payload={},
        progress={}, runner=runner, store_bind=shared_db,
    )
    # Simulate the owning pod dying: no heartbeat for longer than the limit.
    job_registry._forget(job_registry._handles[job.job_id])
    with shared_db.begin() as conn:
        conn.execute(
            update(BackgroundJob.__table__).values(
                heartbeat_at=utc_now_naive() - timedelta(seconds=registry_module.STALE_AFTER_SECONDS + 5)
            )
        )
    with Session(shared_db) as db:
        seen = other.get(job.job_id, db=db)
        assert seen.status == "failed"
        assert "stopped before it finished" in other.snapshot(seen)["error"]
        assert other.active_for_run("run-3", db=db) is None
    # Starting it again replaces the dead holder instead of waiting forever.
    again, created = await other.submit(
        run_id="run-3", user_id="u", auth_type="none", request_payload={},
        progress={}, runner=runner, store_bind=shared_db,
    )
    assert created is True and again.job_id != job.job_id
    with Session(shared_db) as db:
        assert other.active_for_run("run-3", db=db) is again
        dead = db.get(BackgroundJob, job.job_id)
        assert dead.active is False and dead.status == "failed"


def test_in_memory_sqlite_keeps_jobs_process_local() -> None:
    engine = create_engine("sqlite://")
    assert registry_module.shared_engine(engine) is None
    assert registry_module.shared_engine(create_engine("postgresql+psycopg2://u:p@h/db")) is not None


def test_product_eval_of_another_process_is_readable_and_stoppable(shared_db) -> None:
    job = ProductEvalJob(job_id="eval_shared", preset="test", owner_user_id="u", project_id="p", expected_runs=2)
    job.initialize_planned_runs()
    assert job_registry.track(
        shared_db, kind="product_eval", job_id=job.job_id, describe=job.describe, on_cancel=job.request_stop,
    )
    job.mark(status="RUNNING")
    job.mark_run(sdk_run_id="sdk-1", status="RUNNING", qym_run_id="qym-1")
    other = ProductEvalJobManager(max_workers=1)
    with Session(shared_db) as db:
        assert _until(lambda: other.get("eval_shared", db=db).to_dict()["run_id"] == "qym-1")
        seen = other.get("eval_shared", db=db)
        assert isinstance(seen, RemoteProductEvalJob)
        assert seen.owner_user_id == "u" and seen.project_id == "p"
        assert seen.to_dict()["status"] == "RUNNING"
        assert other.get_by_qym_run_id("qym-1", db=db, eval_id="eval_shared").job_id == "eval_shared"
        stopped = other.stop_project("p", db=db)
        assert [j.job_id for j in stopped] == ["eval_shared"]
        assert stopped[0].to_dict()["status"] == "STOPPED"
    # The SDK run in the owning process sees should_stop at the next flush.
    assert _until(job.stop_requested)
    assert job.to_dict()["status"] == "STOPPED"


@pytest.mark.asyncio
async def test_a_stalled_owner_stops_its_job_once_another_process_took_over(shared_db, managers) -> None:
    owner, other = managers

    async def runner(job):
        await asyncio.Event().wait()
        return {}

    job, _ = await owner.submit(
        run_id="run-4", user_id="u", auth_type="none", request_payload={},
        progress={}, runner=runner, store_bind=shared_db,
    )
    handle = job_registry._handles[job.job_id]
    # The owner is alive but its heartbeats stall (database pool exhausted,
    # slow database...) for longer than the limit: readers call the job lost.
    with handle.lock:
        with shared_db.begin() as conn:
            conn.execute(
                update(BackgroundJob.__table__)
                .where(BackgroundJob.__table__.c.id == job.job_id)
                .values(heartbeat_at=utc_now_naive() - timedelta(seconds=registry_module.STALE_AFTER_SECONDS + 5))
            )
        again, created = await other.submit(
            run_id="run-4", user_id="u", auth_type="none", request_payload={},
            progress={}, runner=runner, store_bind=shared_db,
        )
        assert created is True and again.job_id != job.job_id
    # When the owner's heartbeat resumes it must not keep a duplicate LLM run
    # going (or resurrect its row next to the new holder): it stops its job.
    assert await asyncio.get_running_loop().run_in_executor(
        None, lambda: _until(lambda: job.status == "cancelled")
    )
    with Session(shared_db) as db:
        assert other.active_for_run("run-4", db=db) is again
        replaced = db.get(BackgroundJob, job.job_id)
        assert replaced.active is False and replaced.status == "failed"


@pytest.mark.asyncio
async def test_job_reads_use_the_request_connection_not_a_second_pooled_one(shared_db, managers) -> None:
    owner, other = managers

    async def runner(job):
        await asyncio.Event().wait()
        return {}

    job, _ = await owner.submit(
        run_id="run-5", user_id="u", auth_type="none", request_payload={},
        progress={}, runner=runner, store_bind=shared_db,
    )
    # A web process whose pool is fully held by in-flight requests: a poll that
    # asked the pool for a second connection would wait for the pool timeout,
    # and with every connection held by such polls none could finish.
    tight = create_engine(
        shared_db.url, pool_size=1, max_overflow=0, pool_timeout=1,
        connect_args=shared_db.test_connect_args,
    )
    try:
        with Session(tight) as db:
            db.execute(text("SELECT 1"))  # the request already holds its connection
            assert other.get(job.job_id, db=db).run_id == "run-5"
            assert other.active_for_run("run-5", None, db=db).job_id == job.job_id
            assert "run-5" in other.active_scope_ids(db)
    finally:
        tight.dispose()
        owner.cancel(job.job_id)
