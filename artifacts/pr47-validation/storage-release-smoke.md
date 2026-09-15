# Storage and deployment verification

Worktree: `/Users/faisalbh/qym-pr47-integration`.
Frozen source: `bded819a3093fe2a8487dbf597ecdb073eaec5c0`.

## Final packaged runtime: passed

Built both wheels from the frozen commit and installed them with `--no-deps`
into an isolated `/tmp` target, using Python 3.11.14 dependencies. Every checked
package import resolved to that installation; the processes ran outside the
checkout. The native server was PostgreSQL 16.15 with LZ4 enabled.

- Installed migrations upgraded a fresh `qym_native_smoke` database to `0057`.
- Separate API and worker processes used their production role entrypoints.
- Prefixed health and Admin Maintenance requests returned 200. The seven served
  dashboard/UI assets matched installed wheel bytes, including the final
  `dashboard.js`, `run.html`, and `compare.html`.
- Authenticated ingest returned 503 with `Retry-After: 60` in maintenance mode.
- Three fresh worker processes each completed a seeded cleanup job: two old
  published events and their cause rows were removed, using one-row batches.
  All three workers exited 0. The startup migration's FK-validation job also
  completed successfully.
- The API completed its application shutdown. Uvicorn then re-raised SIGTERM,
  as its installed signal handler specifies, yielding exit -15. All smoke
  processes stopped, the HTTP port was released, and no smoke DB sessions remain.

See `native-wheel-runtime.json`, `native-wheel-setup.log`, the three
`native-wheel-worker-*.log` files, and `native-wheel-api-0.log`. The first run
incorrectly expected API exit 0 despite complete graceful shutdown; that harness
failure is retained under `native-wheel-first-run/`. The corrected full smoke
then passed. No application change was needed for that expectation.

The final Docker image rebuild/runtime check remains blocked by OrbStack.

## Storage

The storage and deployment targeted run passed 28 tests across `test_retention.py`,
`test_storage_safety.py`, `test_maintenance_jobs.py`, and
`test_deployment_config.py`. It exercised the actual PostgreSQL Alembic chain and
public restore endpoint. See `storage-full-final.log`. This run preceded the
worker initialization and event cleanup fixes described below.

- Restore commits after candidate selection: HTTP 200, run/items remain.
- Purge holds the row first: restore waits, returns 404, no false restore audit.
- Concurrent purges delete once. A lagging dashboard projection delays purge
  until the worker removes numeric contributions.
- Restore during active dashboard deletion cleanup completes without a deadlock.
  The regression first reproduced a PostgreSQL deadlock in the public endpoint;
  the corrected partition-before-projection lock order passes. The failing run is
  retained in `restore-dashboard-concurrency-before.log`.
- Legacy copy retains soft-deleted runs, freezes the cutoff across restarts,
  and copies all history when retention is disabled.
- Drop rejects unrelated destination rows and wrong partition keys, including
  `force=true`; failed DDL rolls back. Maintenance mode is required.
- A final verification transaction prevents destination mutation and lease
  reclaim; prior cancellation and stale owners cannot drop the table.
- After legacy drop, purge resumes normally.

The suite includes distinct lease owners for workers created in one process.

## Worker cold start and event cleanup

The final cold Docker start exposed concurrent SQLAlchemy model initialization:
one loop queried the ORM while the other was importing core models. The captured
failure is `docker-worker-mapper-race.log`. A deterministic fresh-process test
reproduces that ordering (`worker-cold-start-before-fix.log`). The entrypoint now
imports all models and configures their mappings before either thread starts.

The regression then exposed a PostgreSQL event cleanup query using a nonexistent
`id` column. Cleanup now batches by the real `source_version` key and removes
associated cause rows before events. The new PostgreSQL regression verifies
that unpublished rows survive. It and the deterministic worker startup test
passed in the native LZ4-enabled PostgreSQL run (`postgres-lz4-312.log`,
`postgres-lz4-312.jsonl`: 75 tests passed, including all storage-safety cases).

The exact fresh-process startup regression passed on Python 3.9, 3.11, and 3.12
against isolated SQLite files, completing a queued job and shutting down cleanly.
See `worker-sqlite-python39.log`, `worker-sqlite-python311.log`, and
`worker-sqlite-python312.log`. Local maintenance/deployment tests also passed
10 tests with one PostgreSQL-dependent skip (`worker-nonpg-final.log`).

The original Docker-backed PostgreSQL reruns stalled when OrbStack's Docker
socket and service ports stopped responding. The native PostgreSQL fallback
completed those checks, including the latest storage/worker regressions. No
Docker restart was attempted because that would affect pre-existing application
containers. The final Docker rebuild remains blocked; the earlier Docker smoke
below predates the worker and cleanup fixes.

## Earlier Docker smoke (before the worker and cleanup fixes)

Built the earlier runtime image from the integration checkout. The smoke deployment used
the repository compose file plus an isolated image/port override. It used only
`qym-pr47-smoke-*` resources and the disposable `qym_smoke` database in
`qym-pr47-integration-postgres`. Existing application containers were not changed.

The API migrated to `0057` before the worker started. The worker completed the
queued FK validation job (`docker-migration-jobs.log`, `docker-worker.log`).
Both roles received maintenance mode, structural event
mode, and explicit retention values through the stock compose environment mapping.

The API healthcheck passed with `/qym-check` as its root path. Required assets and
the Admin Maintenance API returned 200. An authenticated ingest request returned
503 with `Retry-After: 60`. See `docker-http-smoke.json`, `api-settings.json`,
`worker-settings.json`, and `docker-api-final.log` (which also records a successful
request for `compare.html`).

Despite their filenames, `docker-build-final.log`, `docker-image-id.json`, and
`docker-source-check.json` describe the earlier image. `docker-worker-final.log`
records its later failed cold start. The attempted build with both worker fixes
was interrupted during the backend stall; no successful final-image Docker
startup or completed final-image cleanup job is claimed.

## Packages

Current wheel hashes and comparisons are in `wheel-assets.json`. All package
Python sources, served dashboard/UI assets, and every migration (including
`0057`) match the checkout byte-for-byte: 63 SDK files and 217 platform files.
The tracked but unmounted `_static/app` bundle is outside existing package-data; that unrelated
packaging scope remains unchanged.

These are functional and migration checks on disposable data. They do not certify
production database capacity, production migration duration, or a live rollout.
