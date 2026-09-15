"""Install final wheels and smoke-test separate API/worker roles on native PG16.

Run only after source freeze and the root agent's matrix scheduling approval.
The database URL must name the dedicated qym_native_smoke DB on localhost:15449.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ARTIFACTS = Path(__file__).resolve().parent
TOKEN = "disposable-native-wheel-smoke-2026"
GUARD = r'''
import importlib.util, json, os
from pathlib import Path
root = Path(os.environ["QYM_WHEEL_TARGET"]).resolve()
paths = {}
for name in ("qym", "qym_platform", "qym_platform.worker", "qym_platform.services.maintenance"):
    path = Path(importlib.util.find_spec(name).origin).resolve()
    assert root in path.parents, (name, str(path), str(root))
    paths[name] = str(path)
print("WHEEL_IMPORT_PATHS=" + json.dumps(paths), flush=True)
'''
SETUP = GUARD + r'''
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from alembic import command
from alembic.config import Config
from qym_platform.db.models import User, UserRole, Project, ApiKey
from qym_platform.security import api_key_prefix, hash_api_key
url = make_url(os.environ["QYM_DATABASE_URL"])
assert url.host == "127.0.0.1" and url.port == 15449 and url.database == "qym_native_smoke", url
admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
with admin.connect() as conn:
    assert not conn.scalar(text("SELECT 1 FROM pg_database WHERE datname='qym_native_smoke'")), "Smoke database already exists; refusing to replace it"
    conn.execute(text("CREATE DATABASE qym_native_smoke"))
admin.dispose()
config = Config()
config.set_main_option("script_location", str(root / "qym_platform/migrations"))
command.upgrade(config, "head")
engine = create_engine(url)
with engine.connect() as conn:
    assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0057"
    print("POSTGRES_VERSION=" + conn.scalar(text("SELECT version()")))
with Session(engine) as db:
    db.add(User(id="native-smoke-user", email="native-smoke@example.test", display_name="Native Smoke", role=UserRole.ADMIN))
    db.flush()
    db.add(Project(id="native-smoke-project", name="Native Smoke", slug="native-smoke", created_by_user_id="native-smoke-user"))
    db.flush()
    token = os.environ["QYM_SMOKE_TOKEN"]
    db.add(ApiKey(id="native-smoke-key", user_id="native-smoke-user", project_id="native-smoke-project", name="Smoke", prefix=api_key_prefix(token), key_hash=hash_api_key(token), scopes=["ingest"]))
    db.commit()
engine.dispose()
'''
SEED_EVENTS = GUARD + r'''
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from qym_platform.db.models import DashboardChangeEvent, DashboardEventCause
engine = create_engine(os.environ["QYM_DATABASE_URL"])
with Session(engine) as db:
    db.info["dashboard_projection_worker"] = True
    # No source runs or partitions: the dashboard worker has nothing to rebuild.
    # Only the maintenance job can remove these published orphaned events.
    for version in (1001, 1002):
        db.add(DashboardChangeEvent(source_version=version, event_id="native-smoke-event-"+str(version), project_key="native-smoke-project", partition_key="absent-run", record_key="absent-run:item:"+str(version), record_kind="item", created_at=datetime.utcnow()-timedelta(days=30), published_at=datetime.utcnow()-timedelta(days=30)))
        db.add(DashboardEventCause(source_version=version,cause_key="native-smoke-cause"))
    db.commit()
engine.dispose()
'''
VERIFY = GUARD + r'''
from sqlalchemy import create_engine, text
engine = create_engine(os.environ["QYM_DATABASE_URL"])
with engine.connect() as conn:
    assert conn.scalar(text("SELECT count(*) FROM dashboard_change_events WHERE source_version IN (1001,1002)")) == 0
    assert conn.scalar(text("SELECT count(*) FROM dashboard_event_causes WHERE source_version IN (1001,1002)")) == 0
    jobs = [dict(r._mapping) for r in conn.execute(text("SELECT kind,status FROM maintenance_jobs ORDER BY created_at"))]
    assert jobs and all(j["status"] == "succeeded" for j in jobs), jobs
    print("FINAL_JOBS=" + json.dumps(jobs))
engine.dispose()
'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", default="/tmp/qym-pr47-py311/bin/python")
    parser.add_argument("--database-url", default="postgresql+psycopg2://qym_review:qym_review@127.0.0.1:15449/qym_native_smoke")
    parser.add_argument("--port", type=int, default=18082)
    args = parser.parse_args()
    # Refuse to collide with another service before creating any database.
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", args.port))
    target = Path(tempfile.mkdtemp(prefix="qym-pr47-wheel-runtime-", dir="/tmp"))
    cwd = Path(tempfile.mkdtemp(prefix="qym-pr47-wheel-smoke-cwd-", dir="/tmp"))
    wheels = sorted((ARTIFACTS / "wheels").glob("*.whl"))
    assert len(wheels) == 2, wheels
    source_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ARTIFACTS.parents[1], text=True).strip()
    subprocess.run(["git", "diff", "--quiet", "HEAD", "--", "packages/sdk/qym", "packages/platform/qym_platform"], cwd=ARTIFACTS.parents[1], check=True)
    report = {"source_commit": source_commit, "runtime_python": subprocess.check_output([args.python, "--version"], text=True).strip(), "runtime_target": str(target), "cwd": str(cwd), "wheels": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in wheels}, "worker_starts": [], "http": {}}
    report_path = ARTIFACTS / "native-wheel-runtime.json"
    environment = {k:v for k,v in os.environ.items() if not k.startswith("QYM_")}
    environment.update(PYTHONPATH=str(target), PYTHON_DOTENV_DISABLED="1", QYM_WHEEL_TARGET=str(target), QYM_DATABASE_URL=args.database_url, QYM_ENVIRONMENT="test", QYM_AUTH_MODE="none", QYM_AUTH_SESSION_SECRET="disposable-native-wheel-session-secret", QYM_AUTH_LOCAL_ENABLED="false", QYM_ROOT_PATH="/qym-check", QYM_BASE_URL=f"http://localhost:{args.port}/qym-check", QYM_MAINTENANCE_MODE="true", QYM_EVENT_LOG_MODE="structural", QYM_SPAN_RETENTION_DAYS="75", QYM_DELETED_RUN_GRACE_DAYS="45", QYM_SMOKE_TOKEN=TOKEN)

    def run_child(name, code, role="api"):
        with (ARTIFACTS / name).open("w") as log:
            subprocess.run([args.python, "-c", code], cwd=cwd, env={**environment,"QYM_ROLE":role}, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=120)

    def request(path, payload=None):
        headers = {"Origin": f"http://localhost:{args.port}"}
        body = None
        if payload is not None:
            body=json.dumps(payload).encode()
            headers["Content-Type"]="application/json"
        with urlopen(Request(f"http://127.0.0.1:{args.port}/qym-check" + path, data=body, headers=headers),timeout=10) as response:
            return response.status, response.read(), dict(response.headers)

    processes = []
    log_handles = []
    def start(role, cycle=0):
        log_path=ARTIFACTS / f"native-wheel-{role}-{cycle}.log"
        log=log_path.open("w")
        log_handles.append(log)
        if role == "worker":
            code=GUARD+'\nimport runpy\nrunpy.run_module("qym_platform.worker", run_name="__main__")\n'
        else:
            code=GUARD+f'\nimport uvicorn\nuvicorn.run("qym_platform.main:app", host="127.0.0.1", port={args.port})\n'
        process=subprocess.Popen([args.python,"-c",code],cwd=cwd,env={**environment,"QYM_ROLE":role},stdout=log,stderr=subprocess.STDOUT)
        processes.append(process)
        return process,log_path

    def stop(process, api_log=None):
        process.terminate()
        try:
            process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
            raise AssertionError("Packaged runtime did not shut down cleanly")
        if api_log is not None:
            # Uvicorn restores and re-raises SIGTERM after graceful shutdown.
            assert process.returncode in (0, -15), process.returncode
            log_text = api_log.read_text()
            assert "Application shutdown complete." in log_text, log_text
            assert "Finished server process" in log_text, log_text
        else:
            assert process.returncode == 0, process.returncode

    try:
        with (ARTIFACTS / "native-wheel-install.log").open("w") as log:
            subprocess.run(["uv","pip","install","--python",args.python,"--target",str(target),"--no-deps",*(str(p) for p in wheels)],stdout=log,stderr=subprocess.STDOUT,check=True,timeout=120)
        run_child("native-wheel-setup.log",SETUP)
        report["migration_head"]="0057"
        setup_log=(ARTIFACTS / "native-wheel-setup.log").read_text()
        report["import_paths"]=json.loads(next(line.removeprefix("WHEEL_IMPORT_PATHS=") for line in setup_log.splitlines() if line.startswith("WHEEL_IMPORT_PATHS=")))
        report["postgres_version"]=next(line.removeprefix("POSTGRES_VERSION=") for line in setup_log.splitlines() if line.startswith("POSTGRES_VERSION="))
        assert report["postgres_version"].startswith("PostgreSQL 16.15 "), report["postgres_version"]
        api,api_log=start("api")
        deadline=time.monotonic()+45
        while time.monotonic()<deadline:
            assert api.poll() is None, api_log.read_text()
            try:
                status,body,_=request("/healthz")
                if status==200:break
            except (URLError,ConnectionError,TimeoutError):pass
            time.sleep(.2)
        else:raise AssertionError("Packaged API readiness timed out")
        for path in ("/healthz","/static/run.html","/static/analyzer.html","/static/compare.html","/static/dashboard.css","/static/dashboard.js","/static/shell.js","/ui/app.js","/api/admin/maintenance"):
            status,body,headers=request(path)
            result={"status":status,"bytes":len(body)}
            assert status==200,(path,status)
            if path.startswith("/static/") or path.startswith("/ui/"):
                relative="_static/dashboard/"+path.removeprefix("/static/") if path.startswith("/static/") else "_static/ui/"+path.removeprefix("/ui/")
                expected=(target/"qym_platform"/relative).read_bytes()
                assert body==expected,path
                result["matches_installed_wheel"]=True
            report["http"][path]=result
        try:
            request_obj=Request(f"http://127.0.0.1:{args.port}/qym-check/v1/runs",data=json.dumps({"task":"smoke","dataset":"smoke","metrics":[]}).encode(),headers={"Authorization":"Bearer "+TOKEN,"Content-Type":"application/json"})
            urlopen(request_obj,timeout=10)
            raise AssertionError("Expected maintenance rejection")
        except HTTPError as response:
            assert response.code==503 and response.headers.get("Retry-After")=="60"
            report["maintenance_ingest"]={"status":response.code,"retry_after":response.headers.get("Retry-After"),"body":response.read().decode()}
        for cycle in range(1,4):
            run_child(f"native-wheel-seed-{cycle}.log",SEED_EVENTS)
            _,body,_=request("/api/admin/maintenance/jobs",{"kind":"prune_dashboard_events","params":{"days":7,"batch":1}})
            job_id=json.loads(body)["id"]
            worker,worker_log=start("worker",cycle)
            deadline=time.monotonic()+45
            while time.monotonic()<deadline:
                assert worker.poll() is None,worker_log.read_text()
                _,body,_=request("/api/admin/maintenance/jobs/"+job_id)
                job=json.loads(body)
                if job["status"] not in {"queued","running"}:
                    assert job["status"]=="succeeded",job
                    assert job["progress"]["rows_deleted"]==2,job
                    break
                time.sleep(.2)
            else:raise AssertionError("Packaged worker job timed out")
            stop(worker)
            assert "failed to initialize" not in worker_log.read_text()
            run_child(f"native-wheel-verify-{cycle}.log",VERIFY)
            report["worker_starts"].append({"cycle":cycle,"pid":worker.pid,"job_id":job_id,"status":job["status"],"rows_deleted":job["progress"]["rows_deleted"],"exit_code":worker.returncode})
            report_path.write_text(json.dumps(report,indent=2)+"\n")
        stop(api, api_log)
        report["api_exit_code"]=api.returncode
        report["api_graceful_shutdown"]=True
        report["status"]="passed"
    except BaseException as error:
        report["status"]="failed"
        report["error"]=f"{type(error).__name__}: {error}"
        raise
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
                try:process.wait(timeout=20)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
        for handle in log_handles:handle.close()
        report_path.write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2))


if __name__ == "__main__":
    main()
