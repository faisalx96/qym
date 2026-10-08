# Operations: storage, retention, maintenance, recovery, and Evaluation Service experiments

Production runs on Kubernetes (image → Harbor → Helm values → ArgoCD). There is no
shell on the database host, so every operation below is driven from **values.yaml**
(environment variables) or the **Admin → Maintenance** page in the platform UI.

The Evaluation Service runbook (dispatcher, environments, queue triage) is in
[Evaluation Service experiments](#evaluation-service-experiments) at the end of this file.

## How the pieces fit

| Component | What it does | Where |
|---|---|---|
| API pod(s) | Serve HTTP; apply Alembic migrations on start; run the dashboard summary backfill, maintenance jobs, and hourly retention | `QYM_ROLE=all` (default) |
| Worker pod (optional) | Runs the background loops in a separate process | `QYM_ROLE=worker`, `QYM_SKIP_MIGRATIONS=1`, command `python -m qym_platform.worker`; set `QYM_ROLE=api` on the API |
| Web processes (optional) | Several uvicorn processes serve HTTP in one API pod; with `QYM_ROLE=all` one extra process in the same pod runs the background loops | `QYM_WEB_WORKERS=N` (default `1`) |
| Service split (optional) | main (UI + API), ingestion (SDK write path) and workers (loops + queued jobs) as three services behind ingress rules | `QYM_SERVICE=main\|ingestion\|workers`; see [Service split deployment](#service-split-deployment) |
| Maintenance jobs | Reclaim, index builds, span copy, and purges. Progress is saved between steps. Final legacy verification and DROP share one transaction | `Admin → Maintenance`, `GET/POST /api/admin/maintenance/jobs` |
| Maintenance mode | Ingest answers `503 Retry-After: 60`; SDKs buffer (16 MiB RAM + 256 MiB disk) and retry; UI stays readable | `QYM_MAINTENANCE_MODE=1` |

The default deployment is unchanged: `QYM_ROLE=all` runs the API and both loops in
one process. The separate worker pod is an option for isolating long maintenance
jobs from API restarts and probes, or for running several API replicas without
duplicating the background loops. Both layouts are safe: database leases make
sure one process runs a given job.

## Environment variables (new)

| Variable | Default | Meaning |
|---|---|---|
| `QYM_ROLE` | `all` | `api`, `worker`, or `all` |
| `QYM_WEB_WORKERS` | `1` | HTTP processes per API pod. Above 1, see "Several web processes in one pod" |
| `QYM_MAINTENANCE_MODE` | `false` | Reject ingest with 503 during a window |
| `QYM_EVENT_LOG_MODE` | `full` | `structural` drops item/metric bodies from `run_events` (bodies live in `run_items`/attempts/scores). Enable after the new image is live |
| `QYM_SPAN_MAX_BYTES` | `1048576` | Safety ceiling per span; larger spans keep scalar attributes only and are flagged |
| `QYM_SPAN_RETENTION_DAYS` | `60` | Raw traces older than this are dropped by partition (0 = keep forever) |
| `QYM_SPAN_PARTITION_DAYS_AHEAD` | `14` | Daily `spans` partitions kept created this many days ahead (hourly retention pass) |
| `QYM_DELETED_RUN_GRACE_DAYS` | `30` | Soft-deleted runs are hard-deleted after this; time their project spends archived does not count |
| `QYM_AUTH_LOCAL_SIGNUP` | `false` | Email/password self sign-up; off means admins add people (open only while no active admin exists) |
| `QYM_AUTH_LOGIN_MAX_FAILURES_PER_EMAIL` / `..._PER_CLIENT` / `QYM_AUTH_LOGIN_FAILURE_WINDOW_SECONDS` | `5` / `30` / `300` | Failed password sign-ins before `429`. `..._PER_EMAIL` counts one email from one client address and refuses only that client, so the right password from another client still works; `..._PER_CLIENT` counts one address over all emails. "Account already exists" answers at sign-up count only against the client. An attempt counts as a failure from the moment it passes the check until its password proves right, so concurrent attempts cannot get past a limit. All limits are counted per API process (with `QYM_WEB_WORKERS=N` each process counts on its own, so a pod allows up to N times the limit). uvicorn trusts `X-Forwarded-For` only from `FORWARDED_ALLOW_IPS` (default `127.0.0.1`): set `FORWARDED_ALLOW_IPS` (or `--forwarded-allow-ips=...` in `QYM_UVICORN_ARGS`) to the ingress/pod CIDR, otherwise every client shares the ingress address and the per-client limit applies to all of them together. The API logs a warning at startup when password sign-in is on outside dev/test and neither is set |
| `QYM_AUTH_LOGIN_EMAIL_CEILING` / `QYM_AUTH_LOGIN_EMAIL_CEILING_WINDOW_SECONDS` | `50` / `900` | Failed password sign-ins for one email from all clients together; past it, password sign-in for that email answers `429` from every client, even with the right password, until failures age out. Counted per API process |
| `QYM_DB_POOL_SIZE` / `QYM_DB_MAX_OVERFLOW` | `10` / `10` | API connection pool |
| `QYM_HTTP_THREADPOOL_SIZE` | `0` (= `QYM_DB_POOL_SIZE` + `QYM_DB_MAX_OVERFLOW`) | Threads for sync request handlers, per web process. AnyIO's default (40) exceeded the API pool, so under load the extra threads waited `QYM_DB_POOL_TIMEOUT_SECONDS` and failed with pool timeouts; capped, extra requests queue for a thread instead. Raise the pool and this together, keeping pods x processes x pool under `max_connections` |
| `QYM_MIGRATION_LOCK_TIMEOUT` | `10s` | `lock_timeout` for the migration session (`0` disables). See "Migrations and large tables" |
| `QYM_PRODUCT_EVAL_MAX_RETAINED_JOBS` | `100` | Finished product evals kept in each process's memory; older ones are served from `background_jobs` |
| `QYM_DB_WORKER_POOL_SIZE` / `QYM_DB_WORKER_MAX_OVERFLOW` | `3` / `2` | Worker pool |
| `QYM_DB_STATEMENT_TIMEOUT_MS` | `30000` | Per-statement guard on API connections |
| `QYM_DB_LOCK_TIMEOUT_MS` | `5000` | Lock-wait guard (all roles) |
| `QYM_REQUEST_TIMING` | `false` | `Server-Timing` header + per-request log line (logger `qym_platform.middleware.timing`, was `qym.timing`) |
| `QYM_LOG_LEVEL` | `INFO` | Platform log level (`DEBUG`, `INFO`, `WARNING`, `ERROR`). See "Logging" |
| `QYM_LOG_FORMAT` | `text` | `text` or `json` (one JSON object per line). See "Logging" |
| `QYM_MAX_UPLOAD_BYTES` | `104857600` (100 MB) | Largest file a dataset or run upload may carry. Larger multipart bodies get 413 before they are parsed (so they never reach `/tmp`); a multipart request without `Content-Length` gets 411 |
| `QYM_PLATFORM_EVENT_SPILL_BYTES` | `0` in the image (SDK default 256 MB) | Disk overflow for run-event streams. `0` never spills: events wait in memory (16 MB) instead of being written to `/tmp` |
| `QYM_PLATFORM_REQUEST_TIMEOUT` | `60` | SDK client timeout (s) for a mid-run event batch POST. Keep it above the platform's statement timeout (30 s) so the SDK never re-sends a batch the server is still applying |
| `QYM_PLATFORM_DRAIN_REQUEST_TIMEOUT` | `45` | SDK client timeout (s) for batch POSTs while a run drains at close, and for direct sends (`run_completed`, Ctrl+C `STOPPED`) |
| `QYM_PLATFORM_FLUSH_INTERVAL` | `1.0` | SDK cadence (s) for flushing a partly filled batch. It stretches up to 5 s while POSTs take over 1 s; full batches (200 events / 2 MB) still go at once |
| `QYM_PLATFORM_MAX_FIELD_BYTES` | `262144` (256 KB) | Largest string (task output, input, span attribute) the SDK uploads in a run event; longer ones are cut and marked `…[truncated by qym: N bytes omitted]`, and the event payload carries `_qym_truncated`. `0` disables the cap. Local results keep full values |
| `INSIGHTOR_TIMINGS_FILE` | unset | Opt-in JSONL file for `insightor_eval.py` timings. Unset, timings are DEBUG log lines; point it at a mounted volume if you need the file |

## Logging

Every platform module logs through `qym_platform.log` (`logger =
get_logger(__name__)`), so all records sit under the `qym_platform` logger tree
(for example `qym_platform.services.eval_dispatcher`). Each process configures
logging once at start: the API, ingestion and workers app factories,
`python -m qym_platform.worker`, `python -m qym_platform.serve` and the
`qym-platform` CLI. Output goes to stderr (container logs).

- **Level**: `QYM_LOG_LEVEL` (default `INFO`). Lifecycle and state changes
  (runs created/stopped, jobs claimed/finished, workers started/stopped,
  migrations) log at INFO, recoverable problems at WARNING, failures at ERROR
  with their full traceback. Per-item ingest detail is DEBUG only.
- **Format**: `QYM_LOG_FORMAT=text` (default) prints
  `<time> <LEVEL> <logger> [<request id>] <message>` and the traceback below it.
  `QYM_LOG_FORMAT=json` prints one object per line with `timestamp` (UTC),
  `level`, `logger`, `message`, `service` (`QYM_SERVICE`, else `QYM_ROLE`),
  `request_id` (during an HTTP request), `exc_info` (the traceback as one
  string) and any structured fields such as `run_id`. With `json`, uvicorn's
  own `uvicorn` / `uvicorn.access` lines use the same format; Alembic's
  migration output does too.
- **Request ids**: every HTTP response carries `X-Request-ID`. A caller's
  `X-Request-ID` (up to 128 characters of `A-Z a-z 0-9 . _ : -`) is kept,
  otherwise a new id is generated; every log line written while the request runs
  carries it, so an ingress or SDK id can be followed into the platform logs.
- **Unhandled errors**: an exception that escapes a route is logged once by
  `qym_platform.middleware.request_context` as `unhandled error method=… path=…
  request_id=… status=500` with its traceback. The response body is unchanged
  (`Internal Server Error`); uvicorn may print its own `Exception in ASGI
  application` line as well.
- **Secrets**: lines are redacted before they are written. Bearer/Basic
  credentials, `Authorization` headers, `…api_key=`, `…token=`, `…secret=`,
  `password=` style pairs (in text, JSON or Python reprs), passwords in URLs
  (`postgresql://user:…@host`), launch tokens (`qlt_…`) and `sk-…` keys become
  `[REDACTED]`, in messages, structured fields and tracebacks. Code still must
  not log credentials or request bodies on purpose; the filter is the safety
  net.

## Container filesystem (read-only)

The image runs as an unprivileged user (`qym`, uid 10001) and never writes into
its own filesystem: everything durable is in Postgres, logs go to stdout. Run it
with a **read-only root filesystem** and a small **tmpfs at `/tmp`** (multipart
upload parsing and `HOME` use it). `docker/docker-compose.yml` does this for
`api` and `worker`. On Kubernetes:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
volumeMounts:
  - { name: tmp, mountPath: /tmp }
volumes:
  - name: tmp
    emptyDir: { medium: Memory, sizeLimit: 512Mi }   # keep it above QYM_MAX_UPLOAD_BYTES
```

A component that tries to write anywhere else now fails loudly
(`Read-only file system`) instead of filling the container layer.

## Storage model after this release

- `spans` — one row per span, **partitioned daily by `run_created_at`**, jsonb + LZ4.
  Retention = drop partition. Partitions are named `spans_yYYYYmMMdDD`; monthly
  ones (`spans_yYYYYmMM`) from before migration `0085` stay and coexist (see
  "Span partitions" below). Scalar columns (`oi_kind`, `usage_scope`, `model_name`,
  `tool_name`, `token_*`) serve statistics without touching the JSON.
- `run_events` — structural history only (no `span_completed` rows). bigint id, jsonb.
- Deleting a run hides it immediately. After the grace period, purge locks and
  rechecks the run before deleting it. A restore that commits first prevents purge;
  a restore after purge returns 404. Purge waits for dashboard deletion publication
  and for `spans_legacy` to be removed. It resumes after those steps finish.
- Purge skips deleted runs whose project is archived (Restore refuses them too).
  `projects.archived_at` records when the pause started; unarchiving moves each
  deleted run's `runs.purge_clock_started_at` forward by the time since, so its
  grace period resumes where it stopped. Deleted Runs shows "Purge paused while
  the project is archived" instead of a date. An archived project with runs in
  Trash therefore cannot be deleted until it is unarchived and they are purged.

## Migrations and large tables

The combined migration chain has one head, `0086`, following `0050` through
`0051`–`0085`. Migrations run before API readiness. Large storage rewrites and index
builds are deferred to maintenance jobs. Migration `0057` also backfills existing
pass approvals in bounded batches within its migration transaction; measure its
startup time on a populated copy before setting deployment readiness deadlines.
Migrations `0058`–`0084` and `0086` are quick DDL or small job/queue inserts.
`0085` switches `spans` to daily partitions; it locks `spans` for an instant only
to drop still-empty monthly partitions that start after today.

On PostgreSQL every `alembic upgrade` takes a per-schema advisory lock, so
replicas that start together migrate one at a time (the others wait, then find
nothing to do), and sets `lock_timeout` to `QYM_MIGRATION_LOCK_TIMEOUT`
(default `10s`). A DDL statement that cannot get its lock in time fails the
start and the container restarts and retries, instead of queueing every query
on that table behind it. With more than one API replica, prefer running the
migration once per release as its own job (same image, command
`alembic -c packages/platform/qym_platform/migrations/alembic.ini upgrade head`,
for example a Helm pre-upgrade hook) and set `QYM_SKIP_MIGRATIONS=1` on every
replica and worker.

| Migration | Work during startup | Deferred job (if table is large) |
|---|---|---|
| 0051 | `maintenance_jobs` table; drops 3 redundant indexes | `create_deferred_indexes` — `ix_run_events_run_type_seq` |
| 0052 | — | `alter_column_types` — bigint/jsonb rewrite (run in maintenance mode) |
| 0053 | new partitioned `spans`, old table → `spans_legacy` | `migrate_spans` (you queue it), then `drop_legacy_spans` |
| 0054 | cascading FKs `NOT VALID` | `validate_foreign_keys` |
| 0055 | — | `create_deferred_indexes` — extrema partial indexes |
| 0056 | `dashboard_run_dimensions.hidden_at` | None |
| 0057 | Pass review scope, deleted-pass marker, index, and approval/catalog backfill | Runs during migration |
| 0058 | Marks ready dashboard partitions pending | None: the worker republishes each summary from its numeric records (no source rescan) |
| 0059 | `local_auth_credentials.must_change_password` | None |
| 0060 | Marks ready dashboard partitions pending (run means count scorer errors as 0) | None: summary republish, as 0058; `SUMMARY_SHAPE` 5 refreshes the rest |
| 0061 | Empty `user_sessions` table | None. Every signed-in user signs in once after the upgrade |
| 0062 | Empty `run_workflow_events` table, nullable `approvals.execution_status` | None |
| 0063 | `run_metric_specs.direction` nullable, `run_metric_specs.is_primary` | `reclassify_metric_errors` — **queued, runs by itself**: rebuilds runs whose verdict reasons were counted as scorer errors, and marks repeat passes whose task failed after a metric was scored |
| 0064 | — | `project_item_failure_events` — **queued, runs by itself**: rebuilds repeat runs with a pass that failed only through an `item_failed` event |
| 0065 | Nullable `projects.archived_at` and `runs.purge_clock_started_at`; sets `archived_at` on projects already archived (a handful of rows) | None: Trash purging pauses for archived projects from now on |
| 0066 | Empty `background_jobs` table (shared job state for several web processes) | None |
| 0067 | `projects.correction_approvers` (default `members`) and `projects.correction_require_different_reviewer` (default false), constant defaults on the small projects table; nullable `run_workflow_events.on_behalf_of_user_id` | None: every project keeps today's review behaviour until a manager changes it |
| 0068 | Nullable `dataset_items.search_text`, `dataset_versions.change_counts`, `datasets.deleted_by_user_id` | `backfill_dataset_search_text` — **queued, runs by itself** (on every database, an empty one included, since the job also builds the index): fills search text in id windows (one statement per 500-item window), stores lineage counts of published versions, builds the small partial index `ix_dataset_items_unindexed_version` CONCURRENTLY, then runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` and builds `ix_dataset_items_search_trgm` CONCURRENTLY. Without the privilege to create the extension it logs that and skips the trigram index; search stays correct, only unindexed. Until the job reaches a row, search rebuilds that row's text on read; results match except a search for a JSON fragment spanning several keys of one object, whose key order PostgreSQL's JSONB text may differ. If the job ever failed (Admin → Maintenance shows it), start `backfill_dataset_search_text` again there: it resumes and is safe to repeat |
| 0069 | Empty `dashboard_run_overview` (each run's overview inputs) and `dashboard_overview_snapshots` (the overview shared by every process and pod) tables | `backfill_dashboard_overview` — **queued, runs by itself** (on every database; on SQLite, or with no runs, it finishes at once): stores each run's overview inputs in run-key windows (one statement per 500-run window; about 0.4 s per 1,000 runs on the perf lab). Until it reaches a run, the overview reads that run's JSON, with the same numbers; the summary worker stores every run it publishes from the start. Resumable and safe to start again from Admin → Maintenance |
| 0070 | — (one job insert) | `build_runs_search_index` — **queued, runs by itself**: runs `CREATE EXTENSION IF NOT EXISTS pg_trgm`, then builds `ix_dashboard_run_dimensions_search_trgm` (the Runs search box) CONCURRENTLY. Without the privilege to create the extension it logs "runs search index skipped" and finishes; the search stays correct, only unindexed. Safe to start again: it rebuilds the index |
| 0086 | Empty `eval_environment_evaluator_schemas` table; `eval_environments.current_evaluator_schema_id` (nullable) and `evaluator_schema_status` (constant default `unknown`) | None: each environment fetches its evaluator schema on its next **Test**, schema refresh or selection in the launch form |
| 0085 | Drops still-empty monthly `spans` partitions that start after today (brief `ACCESS EXCLUSIVE` on `spans`, under `QYM_MIGRATION_LOCK_TIMEOUT`) and creates daily partitions for the next 14 days | None: the hourly retention pass keeps daily partitions ahead; see "Span partitions" |
| 0071 | Nullable `dashboard_run_dimensions.search_text` (instant) and one job insert, skipped while a `build_runs_search_index` job still waits to start | `build_runs_search_index` (this release's job does all of it) — **queued, runs by itself**: builds the partial index `ix_dashboard_run_dimensions_unsearchable` CONCURRENTLY, fills `search_text` in run-key windows (one statement per 500-run window), then rebuilds `ix_dashboard_run_dimensions_search_trgm` over `search_text` and the run ID, CONCURRENTLY. It replaces `0070`'s index over descriptor expressions, which made every descriptor rewrite of a live run a non-HOT update. Until it reaches a row, the search reads that row's names from its descriptor, with the same results. Without `pg_trgm` it fills the column, logs "runs search index skipped" and finishes. Resumable and safe to start again |

After `0060`/`0064` the dashboard worker republishes every ready summary once
(a "republish wave"; about 45 s per 600 runs on the perf lab, in the
background). Summaries of `SUMMARY_SHAPE` 5 (repeat-run means judge task
errors per pass; a completed run's items never received are counted apart as
`not_received_count`) are rebuilt from the same numeric records; no source
rows are read. `reclassify_metric_errors` and `project_item_failure_events`
request a full source rebuild only for the runs they find affected; estimate
the count before deploying (read-only, works on json and jsonb):

```sql
SELECT count(DISTINCT s.run_id) FROM run_item_scores s JOIN runs r ON r.id = s.run_id
WHERE r.deleted_at IS NULL AND s.meta->>'error' IS NOT NULL
  AND coalesce(lower(trim(s.meta->>'status')), '') NOT IN ('error', 'failed', 'timeout');
-- repeat for run_item_pass_scores
```

Both jobs commit one run at a time and retry a deadlock with the dashboard
worker; check Admin → Maintenance afterwards and re-queue a `failed` job.
`publish_ingest_flags` is **manual**: start it once so runs finished before
this release show the Incomplete tag in the runs list.

### Databases that ran the pre-release branch (old revision 0059)

The rebase onto #52 reused revision ids: the pre-release branch's `0059`
(run means) is not this release's `0059` (`local_auth_credentials.must_change_password`).
Alembic tracks only the id, so a database stamped with the old `0059` would
upgrade to head without an error and never get that column; password sign-in,
sign-up, password change and admin reset then fail with `UndefinedColumn`.

Recover only a database still at the old `0059`, before this version's API or
worker starts against it: their entrypoint runs `alembic upgrade head` first,
and stamping `0058` back after that upgrade makes the replay fail. With the new
image built, the database running and the API and worker stopped, run from the
repository root:

```bash
docker compose -f docker/docker-compose.yml run --rm --no-deps --entrypoint /bin/sh api -ec \
  'alembic -c packages/platform/qym_platform/migrations/alembic.ini stamp 0058 && alembic -c packages/platform/qym_platform/migrations/alembic.ini upgrade head'
```

The `/bin/sh` entrypoint skips the startup migration. This re-applies `0059`
onward; `0060` only re-queues dashboard summaries, so running it again is
harmless. Production never ran the pre-release branch, so
this applies only to development and perf-lab databases (for example the dev
compose `docker-db-1` and `qym-db-perf`). A database at the old `0060`–`0062`
stops the upgrade with a duplicate table or column error instead of skipping
silently. An old `0063` existed only on an unreleased stream branch; it would
also upgrade silently (this release's `0064` and `0065` add nothing it
already has), so recreate such a throwaway database instead.

### API keys that stop working at deploy

Keys of archived projects answer 409 (`X-Qym-Key-State: project_archived`), and
keys whose non-admin owner is no longer a project member answer 403
(`owner_removed`) — including members removed before this release. List them
before deploying so their pipelines can move to a new key:

```sql
SELECT k.id, k.name, k.prefix, u.email, p.slug, p.is_active
FROM api_keys k JOIN users u ON u.id = k.user_id JOIN projects p ON p.id = k.project_id
LEFT JOIN project_memberships m ON m.project_id = k.project_id AND m.user_id = k.user_id
WHERE k.revoked_at IS NULL AND (p.is_active IS NOT TRUE OR (m.id IS NULL AND u.role <> 'ADMIN'));
```

## Recovery runbook (database near its volume limit)

### Before the window

1. Rehearse the combined release on a populated disposable copy. Check pass
   approvals, migration duration, free disk during rewrites, and actual job results.
2. Take a complete database backup or storage snapshot, including raw spans,
   events, approvals, and catalogs. Restore it into a separate database and verify
   it before proceeding. Record the database revision and previous image digest.
3. Build and identify the tested image. Record current table sizes and available
   disk space. The previous performance report is an estimate, not a capacity guarantee.
4. Set `QYM_MAINTENANCE_MODE=1` on every API and worker, keep
   `QYM_EVENT_LOG_MODE=full`, and use the same retention settings for both roles.
   If the currently deployed image does not support maintenance mode, pause ingress
   or stop ingestion before the rollout. Confirm ingest actually returns 503.

### Deploy and run maintenance

1. Deploy the new API with the default `QYM_ROLE=all`. Wait for migration head
   `0086` and a healthy API. The API process then runs every queued job itself.
   Do not restart the API while a job runs; the job resumes, but each restart
   costs time. Optional split layout: set `QYM_ROLE=api` on the API and start
   one worker with the same image and configuration, `QYM_ROLE=worker`, and
   `QYM_SKIP_MIGRATIONS=1`, after the API is healthy. A process with the
   `all` or `worker` role is required to execute every queued job.
2. Inspect auto-queued jobs. Index creation and FK validation can run automatically;
   `alter_column_types` stays paused until space has been reclaimed. A failed job
   must be investigated and completed before relying on its schema change.
3. Run `reclaim_run_events` to remove duplicate `span_completed` events in batches.
   Ordinary VACUUM reuses dead space; a subsequent rewrite may be needed to return
   that space to the filesystem.
4. Start `alter_column_types` when there is enough free space for its largest table
   rewrite. If needed, finish span copy and legacy drop first to free space. Keep
   maintenance mode enabled while any table rewrite runs.
5. Run `migrate_spans`. Each job freezes its retention cutoff across batches and
   restarts. It copies all retained runs, including soft-deleted runs that remain
   restorable. `retention_days=0` copies all history. Record any explicit override
   and use the same retention policy for the drop.
6. After copy succeeds, queue `drop_legacy_spans` with its typed confirmation.
   It requires maintenance mode and verifies every eligible legacy key against
   `(run_id, span_id, run_created_at)` in the destination. Unrelated row counts and
   `force=true` cannot bypass missing data. Verification and DROP hold database
   locks in one transaction, so concurrent writes and retention cannot invalidate
   the check. Run mutations can wait during this step. An uncopied key or failed
   DROP leaves the legacy table intact. Resolve the failure and rerun the copy.
7. Confirm required jobs succeeded, the maintenance worker reports running, and
   representative runs retain outputs, traces, scores, and approved pass reviews.
   Then set `QYM_MAINTENANCE_MODE=0` and `QYM_EVENT_LOG_MODE=structural` on every
   role. Confirm buffered SDK events resume and finish.
8. Check pending dashboard runs become ready, live retries remain active, force
   stop finishes, delete/restore works, and pass deletion preserves review scope.
   Record final sizes and compare them with the rehearsal.

### Rollback

Prefer a forward fix once the new release has accepted writes. Before rollback,
stop API mutations and all workers, and retain a fresh backup of the current state.
Rehearse restoring the complete pre-deployment backup with the matching old image
in a separate database, then switch services to the verified recovery database.
Any writes after that backup must be reconciled before switching.

An image-only rollback after `0053` is not a data-preserving recovery plan. The
old span writer does not supply the new partition key. `alembic downgrade 0052`
drops the new partitioned table; it also reverses `0057`, deleting pass-scoped
review records. Once `spans_legacy` is dropped, downgrade cannot reconstruct it.
Do not drop it until the complete backup has passed a restore check.

## Postgres settings (16 GB host)

Apply from your workstation with a superuser connection (`ALTER SYSTEM`, then `SELECT pg_reload_conf()`;
`shared_buffers` needs a restart) or the equivalent Helm values if Postgres is chart-managed:

```
shared_buffers = 4GB            effective_cache_size = 10GB       work_mem = 32MB
maintenance_work_mem = 512MB    max_wal_size = 4GB                checkpoint_completion_target = 0.9
random_page_cost = 1.1          wal_compression = on              default_toast_compression = lz4
log_min_duration_statement = 500ms
autovacuum_naptime = 15s        autovacuum_vacuum_cost_limit = 1000
ALTER TABLE run_events, dashboard_change_events, dashboard_record_state SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
```

## Backups

A deployment recovery backup must include all table data. A dump that excludes
`spans*`, `run_events`, or dashboard events cannot restore the original database
after destructive maintenance. Use a full `pg_dump` or a consistent storage
snapshot, keep it off the database volume, and test the restore in isolation.
Smaller exports of derived data can supplement that backup but do not replace it.

## Several web processes in one pod (`QYM_WEB_WORKERS`)

One Python process serves every request on one interpreter lock, so a few
people opening large runs or comparisons at once make every other request wait
(perf lab, 4 heavy readers: about 0.25 s for one alone, 0.7 s with 4, 2.3 s with
10, while `/healthz` slowed to 0.8 s at p95). `QYM_WEB_WORKERS=N` (N above 1)
makes the entrypoint start `python -m qym_platform.serve` instead of a single
uvicorn:

- N uvicorn worker processes serve HTTP (`QYM_ROLE=api` inside them);
- with `QYM_ROLE=all` (the default), **one** more process in the same pod runs
  the dashboard summary and maintenance loops, restarted if it exits; with
  `QYM_ROLE=api` (separate worker Deployment) no loop process starts;
- the launcher forwards SIGTERM to all of them and exits when uvicorn exits.

Leaving `QYM_WEB_WORKERS` unset keeps the exact single-process command. Use
`QYM_WEB_WORKERS` rather than `--workers` in `QYM_UVICORN_ARGS`: plain uvicorn
workers would each run the loops (safe through database leases, but redundant
CPU in every HTTP process).

Sizing, per API pod:

- **CPU/memory**: each process holds its own copy of the app (260-340 MB
  resident each in the perf lab after a load test; the loop process about
  75 MB). Start with N = 2-4 and at least N CPU cores' worth of limit.
- **Database connections**: each web process has its own pool
  (`QYM_DB_POOL_SIZE` + `QYM_DB_MAX_OVERFLOW`, 20 by default) and the loop
  process uses the worker pool (5). With N = 4 lower the API pool, e.g.
  `QYM_DB_POOL_SIZE=5`, `QYM_DB_MAX_OVERFLOW=5`, so pods x (N x 10 + 5) stays
  under the server's `max_connections`.
- **Background analyses, rule inference and product evals** run in the web
  process that accepted them; their concurrency limits
  (`QYM_ANALYSIS_JOB_MAX_WORKERS`, product eval workers) apply per process. Their
  state is published to the `background_jobs` table (migration 0066), so a poll,
  a cancel or a project archive handled by another process sees and stops the
  same job. A job whose process stopped (restart, crash, rollout) shows as failed
  within about 15 seconds instead of running forever; start it again.
- **Sign-in failure limits** (`QYM_AUTH_LOGIN_MAX_FAILURES_*` and
  `QYM_AUTH_LOGIN_EMAIL_CEILING`) are counted in each web process, so a pod with
  N processes allows up to N times the limit.

## Recommended production layout

The default `QYM_ROLE=all` with `QYM_WEB_WORKERS=1` puts HTTP, the dashboard
summary, maintenance (retention, purges, backfills), eval-dispatch loops and
in-process product evals in **one** process: a memory spike in any of them
(OOM kill) takes the API down too. The API logs a warning at startup when it
runs this way outside a dev/test `QYM_ENVIRONMENT`. For production:

1. **Migrations**: a one-off job per release (see "Migrations and large
   tables"); `QYM_SKIP_MIGRATIONS=1` everywhere else.
2. **API** Deployment/container: `QYM_ROLE=api`, `QYM_WEB_WORKERS` 2-4 as
   needed, memory limit sized per web process (about 350 MB each plus headroom
   for product evals and analyses, which run in the process that accepted
   them).
3. **Worker**: one replica, `QYM_ROLE=worker`, `QYM_SKIP_MIGRATIONS=1`,
   command `python -m qym_platform.worker`, with its **own** memory limit (start
   at 1 GiB) so a heavy maintenance job is killed and restarted on its own
   (jobs resume from their saved progress) without touching HTTP.

With Docker Compose: set `QYM_ROLE=api` in `.env` and run
`docker compose --profile worker up -d`; the compose file shows example
`mem_limit` values. On Kubernetes use the sketch below.

Retention runs in the worker. Soft-deleted runs are purged in 5000-row
batches (spans, events, items and their scores), each its own transaction,
while the purge holds only the run row; span partitions are created with
`ATTACH PARTITION` and dropped with `DETACH`, both under a 1 s `lock_timeout`
with a few retries, so neither holds locks that stall API queries for long.

### Span partitions

`spans` is range-partitioned by `run_created_at` (its run's creation time),
with a `spans_default` catch-all.

- **Daily from `0085` on.** The hourly retention pass (`run_retention`) keeps
  daily partitions `spans_yYYYYmMMdDD` created for today through
  `QYM_SPAN_PARTITION_DAYS_AHEAD` (default `14`) days ahead, and drops any
  partition (daily or monthly) whose upper bound is more than
  `QYM_SPAN_RETENTION_DAYS` old. Retention therefore frees one day at a time
  instead of one month.
- **Monthly partitions coexist.** Partitions created before `0085` are
  monthly (`spans_yYYYYmMM`) and keep their data. Creation and drops work
  from each partition's bounds, not its name: a day already covered by a
  monthly partition gets no daily one, so daily partitions start where the
  last monthly one ends, and a monthly partition is dropped once its whole
  month is past the window (up to a month later than its last day would be).
- **Migration `0085`** drops the monthly partitions that start after today
  (pre-created ahead and still empty; one that holds rows is kept), then
  creates the daily partitions for the next 14 days. On an upgraded database
  the current month stays monthly and daily partitions take over on the 1st
  of next month. Downgrading leaves the daily partitions in place; the older
  code's retention pass then logs an overlap error each hour when it tries
  to pre-create a monthly partition over them, so recreate monthly partitions
  by hand if you run older code for long.
- **Backfill (`migrate_spans`)** makes room for historic rows with one
  monthly partition per untouched month (not ~30 daily ones) and daily
  partitions only for the uncovered days of a month that daily partitions
  already reach.
- Check what exists with
  `SELECT c.relname, pg_get_expr(c.relpartbound, c.oid) FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'spans'::regclass ORDER BY 1;`
  Rows in `spans_default` mean a partition was missing when they arrived
  (the worker was stopped longer than the days-ahead window, or a run's
  creation time lies outside every partition).

## Optional separate worker Deployment (Helm/Kubernetes sketch)

Not required. The default `QYM_ROLE=all` API Deployment runs the background loops.
Use this layout to keep long maintenance jobs away from API rollouts and probes,
or to run several API replicas with one background process. Same image as the
API; only the command and two variables differ. One replica. Inherit maintenance
mode and retention settings from the same configuration as the API. Start this
deployment only after the API has migrated to `0086`.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: qym-worker }
spec:
  replicas: 1
  selector: { matchLabels: { app: qym-worker } }
  template:
    metadata: { labels: { app: qym-worker } }
    spec:
      containers:
        - name: worker
          image: <same image/tag as qym-api>
          command: ["python", "-m", "qym_platform.worker"]
          envFrom: [{ secretRef: { name: qym-env } }]     # same DB URL / settings as the API
          env:
            - { name: QYM_ROLE, value: "worker" }
            - { name: QYM_SKIP_MIGRATIONS, value: "1" }
          resources: { requests: { cpu: "250m", memory: "512Mi" }, limits: { memory: "1Gi" } }
          # Read-only root and a /tmp emptyDir, as for the API ("Container filesystem").
          securityContext: { runAsNonRoot: true, readOnlyRootFilesystem: true, allowPrivilegeEscalation: false }
          volumeMounts: [{ name: tmp, mountPath: /tmp }]
      volumes: [{ name: tmp, emptyDir: { medium: Memory, sizeLimit: 256Mi } }]
```

And on the API Deployment set `QYM_ROLE=api` so it no longer runs the background
loops. Without that setting the API keeps running them, which is safe but redundant.

## Service split deployment

Optional. The single server (`QYM_SERVICE` unset or `all`, the default) keeps
working exactly as before: same paths, same in-process jobs, same
`docker/docker-compose.yml`. The split runs the same image as three services
that share one PostgreSQL database:

| Service | `QYM_SERVICE` | Serves (prefix env, default) | Runs |
|---|---|---|---|
| **main** | `main` | UI, `/api/*`, every `/v1/*` route (`QYM_MAIN_PREFIX`, `""` = `/`); keeps the ingest routes too unless `QYM_MAIN_INCLUDE_INGEST=false` | HTTP only. Analyses, rule inference and product evals are **queued**, not run |
| **ingestion** | `ingestion` | `POST /v1/runs`, `POST /v1/runs/{id}/events`, `POST /v1/runs:upload` under `QYM_INGESTION_PREFIX` (`/ingestion`) **and** at those legacy paths (`QYM_INGESTION_LEGACY_PATHS=true`); `/healthz` | HTTP only; Bearer API keys only (no session, no UI: any other path is 404) |
| **workers** | `workers` | `/healthz`, `{QYM_WORKERS_PREFIX}/healthz` and `{QYM_WORKERS_PREFIX}/status` (`/workers`) | Dashboard summary, maintenance + hourly retention, Evaluation Service dispatcher, remote queue snapshotter, the **job executor** for queued jobs, and a liveness heartbeat. One uvicorn process |

Every service also answers plain `/healthz` (probe path) and `{prefix}/healthz`.
`QYM_ROOT_PATH` still applies in front of every prefix.

`QYM_SERVICE` wins over the legacy `QYM_ROLE` when set. Unset, `QYM_ROLE`
maps `all → all`, `api → main` and `worker → workers`, with one difference:
a legacy `QYM_ROLE=api` process keeps the single-server HTTP surface and runs
its jobs in-process, as before. Only an explicit `QYM_SERVICE=main` queues
jobs for the workers service.

### How the services communicate

```
 SDK / Evaluation Service ──┐                 ┌─ browser
                            ▼                 ▼
                  ingress (nginx / ingress-nginx)
   /v1/runs, /v1/runs:upload,        /workers/*            everything else
   /v1/runs/{id}/events, /ingestion/*   │                         │
             │                          ▼                         ▼
             ▼                     workers ◄──── DB only ────►  main
         ingestion                  │  ▲  (outbox, leases,        │
             │                      │  │   background_jobs queue, │
             └──────────────► PostgreSQL ◄────────────────────────┘
                                    │
          workers' product-eval runner ──HTTP──► QYM_INTERNAL_PLATFORM_URL (ingress)
```

- **Database only** between main, ingestion and workers. Ingest writes runs,
  items, events and the dashboard outbox; the workers' summary loop publishes
  them. Maintenance jobs use `maintenance_jobs` leases, Evaluation Service
  jobs compare-and-set + `SKIP LOCKED`, exactly as with a separate worker.
- **Job queue** (`background_jobs`, migration `0083`): main inserts a
  `queued` row with the job's `payload` (one unfinished analysis per run and
  pass is still enforced at insert). The workers' executor polls every
  `QYM_JOB_POLL_INTERVAL_SECONDS` (1 s), claims as many rows as it has free
  slots (`SELECT … FOR UPDATE SKIP LOCKED`), clears the payload in the same
  update and runs the job with the same code as the single server. Status,
  active-job lookups, polling, cancel and project archive are answered by main
  from the table. A queued job is never "lost"; if no worker claims it within
  `QYM_JOB_QUEUE_TIMEOUT_SECONDS` (1800) it reads as failed ("No workers
  service picked up this job in time"). A claimed job whose worker stops
  reads as failed after 15 s, as before.
- **Product eval secrets**: the caller's API key and refresh token are stored
  in the payload Fernet-encrypted with `QYM_LLM_CONFIG_ENCRYPTION_KEY` and
  wiped (SQL `NULL`) as soon as a worker claims the job, or when it is
  cancelled. Without the key main refuses product evals with
  `503 queue_unavailable`. Queue capacity: unfinished product evals across all
  workers are capped at `QYM_PRODUCT_EVAL_MAX_QUEUED` (0 = `QYM_PRODUCT_EVAL_MAX_WORKERS`),
  above it `429 queue_full`. The submit call waits up to 5 s for the first run
  id by polling the row.
- **HTTP** is used only by the workers' product-eval runner: its in-process
  SDK talks to `QYM_INTERNAL_PLATFORM_URL` (default `QYM_BASE_URL`), normally
  the ingress's in-cluster address, so run writes reach ingestion and dataset
  reads reach main through the same rules as any SDK.
- **Heartbeat**: each workers process upserts `service_heartbeats` every
  `QYM_SERVICE_HEARTBEAT_SECONDS` (10) with its loop and executor state; a
  clean stop marks it stopped. Admin → Maintenance on main shows "workers
  service alive (n/n processes)" or "NOT RESPONDING". `GET /workers/status`
  answers 503 when a loop or the executor is dead (use it as the liveness probe).
- Links built outside main (`live_url` of `POST /v1/runs`, product-eval run
  and compare URLs) use `QYM_PUBLIC_UI_URL` (default `QYM_BASE_URL`).

### Ingress rules

SDK clients need no change: they keep `QYM_BASE_URL` pointed at the ingress
and the ingress sends exactly the three ingest paths to ingestion. None of
main's own `/v1/runs/*` routes (`submit`, `owner`, `approve`, `reject`,
`unapprove`, `unreject`, `/v1/runs/submit`) matches them (a test asserts the
route sets are disjoint). Paths are passed through unchanged (no rewrite).

| Rule | Service |
|---|---|
| `= /v1/runs` | ingestion |
| `= /v1/runs:upload` | ingestion |
| `~ ^/v1/runs/[^/]+/events$` | ingestion |
| `/ingestion/` | ingestion |
| `/workers/` | workers |
| `/` | main |

nginx: `docker/nginx.split.conf` (used by `docker/docker-compose.split.yml`).
Kubernetes ingress-nginx (the regex rule needs `use-regex`; with it every path of
that Ingress is a regex, so anchor them):

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: qym
  annotations:
    nginx.ingress.kubernetes.io/use-regex: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "110m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-buffering: "off"   # analyze-stream
spec:
  ingressClassName: nginx
  rules:
    - host: qym.example.com
      http:
        paths:
          - { path: "/v1/runs$",              pathType: ImplementationSpecific, backend: { service: { name: qym-ingestion, port: { number: 8000 } } } }
          - { path: "/v1/runs:upload$",       pathType: ImplementationSpecific, backend: { service: { name: qym-ingestion, port: { number: 8000 } } } }
          - { path: "/v1/runs/[^/]+/events$", pathType: ImplementationSpecific, backend: { service: { name: qym-ingestion, port: { number: 8000 } } } }
          - { path: "/ingestion/",            pathType: ImplementationSpecific, backend: { service: { name: qym-ingestion, port: { number: 8000 } } } }
          - { path: "/workers/",              pathType: ImplementationSpecific, backend: { service: { name: qym-workers,   port: { number: 8000 } } } }
          - { path: "/",                      pathType: ImplementationSpecific, backend: { service: { name: qym-main,      port: { number: 8000 } } } }
```

ingress-nginx orders regex locations by path length (longest first), so the
ingest rules win over `/`. Do not expose `/workers/` publicly if you prefer:
probes can use the pod address directly.

### Environment variables per service

Shared (all three, same values):

| Variable | Required | Default | Notes |
|---|---|---|---|
| `QYM_SERVICE` | yes (split) | unset = `QYM_ROLE` | `main`, `ingestion`, `workers` |
| `QYM_DATABASE_URL` | yes | — | Same database for all |
| `QYM_ENVIRONMENT` | yes | `dev` | |
| `QYM_SKIP_MIGRATIONS` | yes | `0` | `1` on every service; one migration job per release |
| `QYM_LLM_CONFIG_ENCRYPTION_KEY` | yes (split) | — | Same key everywhere: main encrypts queued product-eval secrets and LLM connections, workers decrypt them. `..._KEYS_PREVIOUS` as for rotation |
| `QYM_AUTH_MODE` | yes | `none` | Ingestion only authenticates Bearer API keys, but `none` vs others changes key handling |
| `QYM_MAINTENANCE_MODE` | no | `false` | Ingestion answers 503 + `Retry-After`; set on all services for one window |
| `QYM_BASE_URL` | yes | `http://localhost:8000` | Public URL of the ingress (OIDC redirect URIs, same-origin guard, link fallback) |
| `QYM_ROOT_PATH`, `QYM_MAIN_PREFIX`, `QYM_INGESTION_PREFIX`, `QYM_WORKERS_PREFIX` | no | `""`, `""`, `/ingestion`, `/workers` | Keep identical on all services and in the ingress |
| `QYM_DB_LOCK_TIMEOUT_MS`, `QYM_DB_STATEMENT_TIMEOUT_MS`, `QYM_DB_POOL_TIMEOUT_SECONDS` | no | `5000`, `30000`, `10` | |

main:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `QYM_AUTH_SESSION_SECRET`, `QYM_AUTH_LOCAL_*`, `QYM_AUTH_GOOGLE_*`, `QYM_AUTH_GITHUB_*`, `QYM_AUTH_GITLAB_*`, `QYM_ADMIN_BOOTSTRAP_TOKEN` | per auth mode | — | Only main serves sign-in |
| `QYM_WEB_WORKERS` | no | `1` | 2 recommended; no loop process is started for `main` |
| `QYM_DB_POOL_SIZE` / `QYM_DB_MAX_OVERFLOW` / `QYM_HTTP_THREADPOOL_SIZE` | no | `10` / `10` / `0` | Per web process |
| `QYM_MAX_UPLOAD_BYTES` | no | 100 MB | Dataset uploads |
| `QYM_MAIN_INCLUDE_INGEST` | no | `true` | Keep the ingest routes (works without the ingress rules) |
| `QYM_PRODUCT_EVAL_MAX_QUEUED` | no | `0` | Queue cap for product evals (0 = `QYM_PRODUCT_EVAL_MAX_WORKERS`) |
| `QYM_JOB_QUEUE_TIMEOUT_SECONDS` | no | `1800` | Unclaimed queued jobs read as failed after this |
| `QYM_PUBLIC_UI_URL` | no | `QYM_BASE_URL` | Product-eval run/compare links |
| `FORWARDED_ALLOW_IPS` | yes behind an ingress | `127.0.0.1` | Ingress CIDR, for sign-in throttling |

ingestion:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `QYM_PUBLIC_UI_URL` | recommended | `QYM_BASE_URL` | `live_url` in `POST /v1/runs` answers |
| `QYM_INGESTION_LEGACY_PATHS` | no | `true` | Serve `/v1/runs…` at the legacy paths too |
| `QYM_MAX_INGEST_BODY_BYTES` | no | 20 MB | Per events POST |
| `QYM_MAX_UPLOAD_BYTES` | no | 100 MB | `POST /v1/runs:upload` |
| `QYM_EVENT_LOG_MODE` | no | `full` | `structural` after rollout |
| `QYM_SPAN_MAX_BYTES` | no | 1 MiB | |
| `QYM_WEB_WORKERS`, `QYM_DB_POOL_SIZE`, `QYM_DB_MAX_OVERFLOW` | no | `1`, `10`, `10` | Per process; scale with replicas |
| `QYM_RUN_STALE_TIMEOUT_SECONDS` | no | `180` | Same value as main |

workers:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `QYM_INTERNAL_PLATFORM_URL` | recommended | `QYM_BASE_URL` | In-cluster ingress URL for the product-eval runner (e.g. `http://qym-ingress.qym.svc`); it must apply the ingress rules or point at main with `QYM_MAIN_INCLUDE_INGEST=true` |
| `QYM_PUBLIC_UI_URL` | no | `QYM_BASE_URL` | |
| `QYM_DB_WORKER_POOL_SIZE` / `QYM_DB_WORKER_MAX_OVERFLOW` / `QYM_DB_WORKER_STATEMENT_TIMEOUT_MS` | no | `3` / `2` / `300000` | Loops |
| `QYM_DB_POOL_SIZE` / `QYM_DB_MAX_OVERFLOW` | no | `10` / `10` | Pool the jobs use (opened only while jobs run); `5`/`5` is plenty |
| `QYM_ANALYSIS_JOB_MAX_WORKERS`, `QYM_ANALYSIS_MAX_CONCURRENCY`, `QYM_ANALYSIS_MAX_RETRIES` | no | `2`, `20`, `1` | Per workers process |
| `QYM_PRODUCT_EVAL_MAX_WORKERS`, `QYM_PRODUCT_EVAL_*` (concurrency, timeout, run count, default dataset, `MAX_RETAINED_JOBS`) | no | `3`, … | Per workers process |
| `QYM_JOB_POLL_INTERVAL_SECONDS`, `QYM_SERVICE_HEARTBEAT_SECONDS` | no | `1`, `10` | |
| `QYM_EVAL_JOB_TIMEOUT_SECONDS`, `QYM_EVAL_*` | no | `8100` | Evaluation Service dispatcher |
| `QYM_SPAN_RETENTION_DAYS`, `QYM_DELETED_RUN_GRACE_DAYS`, `QYM_SPAN_PARTITION_DAYS_AHEAD` | no | `60`, `30`, `14` | Retention runs here |
| `QYM_ALLOW_PRIVATE_LLM_BASE_URLS` | no | `false` | Analyses call the LLM from here |
| `QYM_INSIGHTOR_EVAL_SCRIPT` | no | repo `insightor_eval.py` | Product-eval preset script |

SDK clients: `QYM_BASE_URL` (the ingress) and `QYM_API_KEY` as before.
**No SDK change or upgrade is needed**: the ingress rules send the ingest
calls to the ingestion service. An external Evaluation Service that streams
runs keeps its qym URL too (point it at the ingress).

### Resources and connection budget

Measured in the smoke run (one host, PostgreSQL 16, `QYM_WEB_WORKERS=2` for
main and ingestion; RSS per process):

| Process | Idle | After smoke (SDK run, analysis, product eval) | Under load | Load |
|---|---|---|---|---|
| main (each of 2) | 142 MB | 160 MB | 312–515 MB peak | 4 parallel run-detail reads of 5,000-item runs (54 MB JSON each) |
| ingestion (each of 2) | 145 MB | 152 MB | 170 MB peak | 4 SDK runs × 5,000 items × ~5 KB in parallel (20,000 items in 57 s) |
| workers (1) | 151 MB | 168 MB | 173 MB peak | the summaries of those runs + a 3-pass product eval (test preset) + a 12-item analysis |

Recommendations (starting points; product evals with the real Insightor
preset and large analyses dominate the workers' memory):

| Service | Request | Limit | Replicas / scaling | Why |
|---|---|---|---|---|
| main | 1 CPU / 1 GiB | 2 CPU / 2 GiB | 2+, HPA on CPU | 2 web processes at 150–515 MB each, run detail/compare JSON of large runs (tens of MB per response), inline LLM streaming and dataset upload parsing |
| ingestion | 500m / 512 MiB | 1.5 CPU / 1.5 GiB | ≥2, HPA on CPU | JSON parsing of event batches; worst case ~12 request threads × 20 MB body × 3–4× parsing overhead; measured steady state stays near 170 MB per process |
| workers | 500m / 1.5 GiB | 2 CPU / 3 GiB | 1 (leases and SKIP LOCKED make more safe) | Loops + maintenance jobs (retention purges, backfills) + up to `QYM_ANALYSIS_JOB_MAX_WORKERS` analyses + `QYM_PRODUCT_EVAL_MAX_WORKERS` in-process SDK Evaluators |

PostgreSQL connections (pool size + overflow per process):

- main: `QYM_WEB_WORKERS` × (`QYM_DB_POOL_SIZE` + `QYM_DB_MAX_OVERFLOW`) = 2 × (6 + 6) = 24 per replica;
- ingestion: 2 × 12 = 24 per replica;
- workers: loops 3 + 2 = 5, jobs pool up to 10 (5 + 5), heartbeat and executor share the loop pool: ~15;
- migration job: 1 while it runs.

With main ×2, ingestion ×2 and one worker: 48 + 48 + 15 = 111, plus psql
and backups; keep the sum below `max_connections` (100 by default: raise it
or lower the pools, e.g. `QYM_DB_POOL_SIZE=5`, `QYM_DB_MAX_OVERFLOW=5`). The
smoke run used 8 API and 3 worker connections at rest.

### Rollout: single server → split

1. **Migrate once**: run the migration job (`alembic -c packages/platform/qym_platform/migrations/alembic.ini upgrade head`, up to revision `0085`) with the new image; set `QYM_SKIP_MIGRATIONS=1` on all three services.
2. Set the **same** `QYM_DATABASE_URL`, `QYM_LLM_CONFIG_ENCRYPTION_KEY`, `QYM_BASE_URL` and prefixes on all services; `QYM_SERVICE=main|ingestion|workers`.
3. Deploy **workers** first (one replica), then **ingestion**, then switch the old API Deployment to **main** (`QYM_SERVICE=main`). Remove a legacy `QYM_ROLE=worker` Deployment (or set `QYM_SERVICE=workers` on it): two loop processes are safe but redundant.
4. Add the **ingress rules** above. Until they exist, main still accepts ingest (`QYM_MAIN_INCLUDE_INGEST=true`).
5. **IdP redirect URIs are unchanged** (`{QYM_BASE_URL}/v1/auth/callback/{provider}`): main's prefix stays `""`.
6. **SDK clients**: nothing to change. An external **Evaluation Service** keeps its qym URL (the ingress); point it straight at the ingestion service only if it bypasses the ingress.
7. Check: `GET /workers/status` is 200, Admin → Maintenance shows the workers service alive, a new SDK run appears in Runs, and an analysis started in the UI completes (its row in `background_jobs` has `claimed_by` set to a workers process).

Rollback: set `QYM_SERVICE=all` (or unset) on main and stop ingestion and
workers. Jobs still queued then are not run by the single server; they read
as failed after `QYM_JOB_QUEUE_TIMEOUT_SECONDS` and can be started again.

## Evaluation Service experiments

This section is the runbook for Evaluation Service experiments: remote deployments
("environments") that qym launches evaluation jobs on. The user-facing workflow is in
the [Platform User Guide](../../packages/platform/docs/USER_GUIDE.md#experiments-evaluation-service).
The service's HTTP contract is in
[`evaluation-service-api-integration-v1.1.md`](../evaluation-service-api-integration-v1.1.md).
Code lives in `packages/platform/qym_platform/services/eval_*.py` and
`api/eval_*.py` / `api/experiments.py`.

### How it works

```
Browser ─► qym API: create experiment + N jobs (status QUEUED)
qym EvalDispatcher (background thread, leased)
   ├─ POST {env}/evals              submit (Bearer <environment key>)
   ├─ GET  {env}/evals/{id}         poll with backoff
   └─ POST {env}/evals/{id}/cancel  cancel
Evaluation Service ─► runs the qym SDK with live_mode=platform
   └─ SDK ingests the run into qym with QYM_API_KEY of the environment's project
qym ingest: verifies the one-time launch token → run origin = official, run ↔ job link
```

Two background threads carry the integration. They run next to the dashboard summary
and maintenance loops:

| Thread | Does | Interval |
|---|---|---|
| `EvalDispatcher` (`services/eval_dispatcher.py`) | Claims due jobs, submits, reconciles, polls, cancels | Ticks every 2s when idle, 0.2s while it has work; up to 20 jobs per tick |
| `RemoteQueueSnapshotter` (`services/eval_remote_queue.py`) | Stores a redacted copy of each environment's remote `PENDING`/`RUNNING` queue for the Queue page | Scans every 5s; refreshes an environment at most every 30s |

The snapshotter refreshes an active environment while it has local jobs in progress.
Viewing the Queue page also schedules a refresh of a snapshot older than 30s. Page
requests never wait on the service.

### Roles and processes

`QYM_ROLE` decides which process runs the two threads:

| `QYM_ROLE` | HTTP | Dispatcher and snapshotter |
|---|---|---|
| `all` (default) | yes | yes, inside the API process |
| `api` | yes | **no** |
| `worker` (`python -m qym_platform.worker`) | no | yes; restarted by the worker if a thread dies |

At least one process with `all` or `worker` must run, or jobs stay `QUEUED` with no
`wait_reason` forever. Several processes are safe: every job is claimed with a
compare-and-set lease (plus `FOR UPDATE SKIP LOCKED` on PostgreSQL), so API replicas
with `QYM_ROLE=all` plus a worker never double-submit. The split-worker layout from
"Optional separate worker Deployment" above covers these threads too; the worker needs
the same `QYM_LLM_CONFIG_ENCRYPTION_KEY` and `QYM_ALLOW_PRIVATE_LLM_BASE_URLS` as the
API, because it decrypts keys and calls the services.

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `QYM_LLM_CONFIG_ENCRYPTION_KEY` | empty | **Required.** Fernet key that encrypts environment keys, LLM connection keys and temporary-model keys. It also derives the one-time launch tokens (HMAC). Without it, creating an environment answers 400, launching or retrying an experiment answers 400, and queued jobs wait with `Launch tokens need QYM_LLM_CONFIG_ENCRYPTION_KEY`. Same value on every API and worker process. |
| `QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS` | empty | Comma-separated keys that were current before a rotation. Still used to decrypt, and to derive launch tokens of jobs launched before the rotation; never used to encrypt. Drop after running `reencrypt_llm_keys` (see below). |
| `QYM_EVAL_SWEEP_MAX_JOBS` | `64` | Maximum jobs per launch (combinations × environments). Larger launches are refused before anything is written. |
| `QYM_EVAL_EXPERIMENT_CREATE_RATE_LIMIT` | `30` | Launches per user per window (`0` disables). Counted from `eval_experiments` rows, so it holds across API processes. Dry-run previews are not counted. Over the limit: 429 with `Retry-After`. |
| `QYM_EVAL_EXPERIMENT_CREATE_RATE_WINDOW_SECONDS` | `3600` | Window of the launch rate limit. |
| `QYM_EVAL_JOB_TIMEOUT_SECONDS` | `8100` (2h15m) | A `RUNNING` job with no remote status change and no linked-run activity for this long becomes `TIMED_OUT`; also how long a failing remote cancel is retried. Keep it above the Evaluation Service's Celery hard limit (`time_limit`, 7200s); raise both together to allow longer evaluations. |
| `QYM_RUN_STALE_TIMEOUT_SECONDS` | `180` | A `RUNNING` run with no event received for this long is shown `STOPPED` (`lease_timeout`) until its next event. Measured on the platform's clock at receipt. |
| `QYM_ROLE` | `all` | See "Roles and processes". |
| `QYM_ALLOW_PRIVATE_LLM_BASE_URLS` | `false` | Allows `http://` and private or loopback environment URLs, private connection and temporary-model URLs, and `http://` models in experiments. Keep it off in shared deployments. |

**Rotating `QYM_LLM_CONFIG_ENCRYPTION_KEY`.** Decryption tries the current key and then
every key in `QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS` (Fernet `MultiFernet`), while
new values are always encrypted with the current key. The dispatcher derives each
job's launch token with whichever configured key matches the job's stored
`launch_token_hash`, so a job launched before the rotation and submitted after it still
links as **official**. Procedure:

1. Generate a new key (`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`).
2. On every API and worker process, set `QYM_LLM_CONFIG_ENCRYPTION_KEY` to the new key
   and add the old key to `QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS` (comma-separated
   if older keys are still listed there).
3. Deploy. Everything keeps working: stored keys decrypt with the previous key.
4. Re-encrypt the stored values with the new key:

   ```bash
   python -m qym_platform.tools.reencrypt_llm_keys --dry-run   # counts only
   python -m qym_platform.tools.reencrypt_llm_keys
   ```

   It covers `project_llm_connections.llm_api_key_encrypted`,
   `eval_environments.api_key_encrypted` and `eval_experiments.secrets_encrypted`,
   commits per batch (`--batch-size`, default 200), skips values already on the
   current key (so it is safe to re-run) and prints JSON counts per column
   (`scanned`, `already_current`, `reencrypted`, `failed`, `failed_ids`,
   `skipped_changed`). It never prints keys. Exit code 1 means some values decrypt
   with no configured key (listed by row id in `failed_ids`); re-enter those keys.
   Exit code 2 means the current key is missing or malformed.
5. Wait until no job launched before step 3 is still `QUEUED`, `BLOCKED` or
   `SUBMITTING`, because their launch tokens still need the old key. Then remove the
   old key from `QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS` and deploy again. A job
   submitted after the old key is gone sends a token that doesn't match; the
   dispatcher logs `launch_token_hash matches no configured encryption key` (job id
   only) and the run is stored as **local**.

Per-environment settings (**Project Settings → Environments → Policies**, manager only):
`default_priority` and `max_priority` (default `NORMAL`), `allow_connection_keys`
(default off; reset when the URL changes). There is no per-environment in-flight cap:
the Evaluation Service limits concurrent runs and queues the rest itself (migration
`0080` drops the former `max_inflight_jobs` column).

### Deploying the release

The Evaluation Service tables come in migrations `0072`–`0082` on top of `0071`:

| Migration | Adds | Startup cost |
|---|---|---|
| `0072` | `eval_environments`, `eval_environment_schemas`, `eval_model_slots`; `project_llm_connections.available_for_experiments` | New tables and a constant-default column: instant |
| `0073` | `eval_experiments`, `eval_experiment_jobs`, `eval_remote_queue_snapshots`; `runs.origin` (default `local`, indexed) and `runs.experiment_job_id` | The `origin` column uses a constant default (no rewrite on PostgreSQL 11+), but its CHECK constraint and index scan `runs` once |
| `0074` | `eval_config_presets`, `eval_config_preset_versions` | New tables: instant |
| `0075` | `eval_experiment_jobs.attempt` and `retry_of_job_id`; per-attempt unique key | Small table |
| `0076` | `eval_run_scores` (best-run index, created empty); `eval_experiment_jobs.run_linked_at` | New table: instant |
| `0077` | `eval_experiments.qym_api_key_id` and `qym_api_key_encrypted` (the submitting user's key) | Nullable columns: instant |
| `0078` | `dashboard_run_versions` (filterable `versioning_metadata`, created empty) | New table: instant. The dashboard worker fills it: its shape reconcile requeues every run linked to a job, in batches of 100 back to back until none is left |
| `0079` | `datasets.private_test_set` (default false) | Constant-default column on the small datasets table: instant |
| `0080` | Drops `eval_environments.max_inflight_jobs` | Small table: instant |
| `0081` | `eval_model_slots.extra_field_maps` (existing slots get `[]`) | Small table: instant |
| `0082` | Empty `dataset_read_tokens` table (admin-issued per-project tokens, hash only) | New table: instant |

Steps:

1. Set `QYM_LLM_CONFIG_ENCRYPTION_KEY` on every API and worker process (if it isn't
   already set for LLM connections), plus any `QYM_EVAL_*` overrides.
2. Deploy the image. The API applies migrations up to `0085` before it reports ready,
   as for every release. A split worker starts after the API, with
   `QYM_SKIP_MIGRATIONS=1`. On a large `runs` table, time the `0073` scan on a
   populated copy before setting readiness deadlines.
3. Run the one-time score backfill once, from an API or worker pod or as a one-off Job
   with the same image and configuration:

   ```bash
   python -m qym_platform.tools.backfill_eval_run_scores [--project-slug SLUG] [--batch-size 200]
   ```

   It fills `eval_run_scores` for official runs scored before the table existed and
   repairs rows a failed completion hook missed. It is idempotent and safe to re-run
   at any time. It prints `{"runs", "scored_runs", "rows", "failed"}` and exits `0`
   on success, `1` when some runs failed, and `3` for an unknown project slug. On a
   fresh deployment there are no official runs yet and it does nothing.
4. Check the logs of the process that runs the loops for `Eval dispatcher started` and
   `Remote queue snapshotter started` (or `qym worker started`).
5. Ask a project manager to register an environment (next section) and launch one
   single-job experiment. Confirm the run arrives with the **Official run** badge.

Rollback: `alembic downgrade` below `0073` drops `runs.origin` and every experiment
row. `0075`'s downgrade keeps only the latest attempt of each combination. Prefer a
forward fix once experiments have run.

### Databases that ran the pre-merge eval branch (old revisions 0060–0070)

Before merging `main`'s `0060`–`0071`, this branch numbered its Evaluation Service
and dataset revisions `0060`–`0070`; they are now `0072`–`0082`. Alembic tracks only
the id, so a database stamped with an old id (for example preprod at the old `0070`,
`dataset_read_tokens`) would run the wrong revisions: `upgrade head` applies `0071`
and then fails in `0072` with a duplicate `eval_environments` table, and `main`'s
`0060`–`0070` never run. None of `main`'s `0060`–`0071` touch the eval or dataset
read token tables, so recover such a database (it must have reached the old `0070`;
upgrade it with the previous image first if not) with the API and worker stopped:

```bash
docker compose -f docker/docker-compose.yml run --rm --no-deps --entrypoint /bin/sh api -ec \
  'A="alembic -c packages/platform/qym_platform/migrations/alembic.ini"; $A stamp 0059 && $A upgrade 0071 && $A stamp 0082'
```

This applies `main`'s `0060`–`0071` on top of the eval tables and marks the eval
revisions as applied. Then start the API as usual.

### Environment setup and the ingest key

An environment needs two keys, going in opposite directions:

| Key | Where it is set | Used for |
|---|---|---|
| Service key (`EVAL_API_KEY` on the service) | Entered in qym when the environment is registered; stored encrypted | qym → service: submit, poll, cancel, list |
| Project API key (`QYM_API_KEY` on the service's workers) | Created in **Project Settings → API keys** of the project that owns the environment; configured on the deployment together with `QYM_BASE_URL` | service → qym: the SDK ingests runs into that project |

Setup, per deployment:

1. In the owning project, create a project API key.
2. On the Evaluation Service deployment, set `QYM_BASE_URL` to the public qym URL
   (including any `QYM_ROOT_PATH` prefix) and `QYM_API_KEY` to that project key.
   qym always sends `live_mode: platform`, so the worker's SDK streams to qym.
3. In qym, a project manager opens **Project Settings → Environments → Add environment**
   and enters the base URL (including the service's `EVAL_SERVER_PREFIX`, without
   `/evals`) and the service key. qym checks `GET /evals?limit=1`, fetches the
   env-overrides schema and the evaluator schema (`GET /evals/evaluator/schema`,
   guide v1.1), and proposes model slots. The URL must be `https://` unless
   `QYM_ALLOW_PRIVATE_LLM_BASE_URLS` is set.
4. Confirm the model slots (**Group LLM settings**) and, if the service may receive
   provider keys, turn on **Allow connection keys**.

**Schemas and refresh.** Each environment keeps two schema histories, each row
immutable and keyed by the sha256 of the canonical JSON: `eval_environment_schemas`
(env-overrides) and `eval_environment_evaluator_schemas` (evaluator, migration
`0086`). **Test**, environment creation and `POST …/eval-environments/{id}/schema/refresh`
re-read both; any project member may refresh (decision B18), and the new-experiment
page refreshes each selected environment once per visit. The refresh answer has
`changed` (either schema), `env_overrides_changed`, the env-overrides diff
(`added`/`removed`/`changed_types`) and an `evaluator` block with its own diff,
`supported` and `status`. On a change the launch form reloads the environment's form
and its Evaluation inputs card, and re-fetches the starting point with
`?remap=current` (B19), which also drops `evaluator.config` keys the new evaluator
schema rejects. The evaluator call never fails a refresh:

| `evaluator_schema_status` | Meaning | What qym uses |
|---|---|---|
| `unknown` | Not fetched since `0086` | The static `EvaluatorRequestConfig` (guide v1.0) |
| `available` | The service answered `GET /evals/evaluator/schema` | That schema: launch form, presets and launch validation |
| `unsupported` | The service answered 404/405 (older than v1.1) | The static `EvaluatorRequestConfig` |

A 401, timeout or 5xx on the evaluator call keeps the stored evaluator schema and
is returned as `evaluator.error`. With an evaluator schema, the experiment's
`versioning_details` are also sent as `evaluator.config.versioning_details`
(decision B23); at link time the run's values then win over the experiment's.

One environment URL belongs to one project. qym normalizes the URL (lower-case host,
no default port, no trailing `/` or `/evals`), and a platform-wide unique index refuses
the same URL in a second project ("already belongs to project X"). Use a separate
deployment per project.

**How official-run linking works** (`services/eval_run_linking.py`):

1. At launch, qym stores `sha256(token)` for each job. The token itself is derived from
   `QYM_LLM_CONFIG_ENCRYPTION_KEY` and the job id, and is never stored.
2. At submit, the dispatcher puts `qym_launch = {experiment_id, job_id, environment_id,
   combo_index, attempt, token}` and a secret-free `qym_config` into
   `evaluator.config.run_metadata`.
3. When the SDK creates the run, ingest looks up the job, verifies the token in
   constant time, requires that the job was never linked (`run_id` and `run_linked_at`
   empty, claimed with a guarded `UPDATE`), and requires that the run arrived in the
   experiment's project.
4. On success the run gets `origin = official`, `experiment_job_id`, and
   `owner_user_id` = the experiment's creator. `created_by_user_id` stays the ingest
   key's principal for audit.
5. The token is always stripped from stored metadata and event payloads. Later
   `run_started`/`metadata_update`/`run_completed` merges cannot change `qym_*` keys.

Any failed check stores the run as **local**, with a warning log line
`run <id>: … stored as local` (unknown job, token that did not verify, replayed token,
job already linked, or another project).

### Environment health

`health_status` is `ok`, `error` or `unknown`, shown as the health dot in Settings and
on the Queue page:

| Symptom | Cause | Fix |
|---|---|---|
| `error` with `Evaluation service rejected the environment API key` | The service answered 401 to a submit, poll, cancel or snapshot. The environment's queue pauses: new submits wait with `Environment unhealthy: API key rejected`, and polls say `Environment unhealthy; status may be stale` | Correct the key (`EVAL_API_KEY`) in qym, or restore it on the service. The dispatcher probes a paused environment every 5 minutes and resumes by itself when the probe passes; **Test** or a key change resumes it at once |
| `error` with a transport or 5xx message | The last **Test** or **Refresh schema** failed | Check the URL, DNS, TLS and the service, then **Test** |
| `unknown` | Never checked, or the URL or key changed | **Test** |
| `health_error = "runs arriving in project X"` | A run with a *valid* launch token arrived in project X, not the environment's project: the deployment ingests with another project's `QYM_API_KEY`. The run is stored local and the job stays unlinked | Set the deployment's `QYM_API_KEY` to a key of the owning project. `health_status` is not changed and dispatch continues, so this message stays until the next successful **Test** or **Refresh schema** clears it. Affected jobs finish from the service's status but never get an official run: **Retry** them after the fix |

A disabled environment (deleted while in use, or deactivated) blocks its queued jobs
with `Environment is disabled`. Jobs already on the service keep being polled.

### Dispatcher behaviour

**Claim and lease.** Each tick claims up to 20 due jobs in `QUEUED`, `SUBMITTING`,
`SUBMITTED`, `RUNNING` or `CANCELLING` whose `next_attempt_at` has passed and whose
lease is free or expired. The claim order is `COALESCE(next_attempt_at, created_at)`,
then `created_at`, then `combo_index`; the Queue page shows jobs in exactly this order.
qym does not order by priority, because the service enforces priority. The lease lasts
`LEASE_SECONDS` = 120s and is renewed before each step.

**No in-flight cap.** qym submits every queued job as soon as a dispatcher claims it:
the Evaluation Service bounds how many runs execute at once and queues the rest
(they show as `PENDING` remotely and `SUBMITTED` here). `QUEUED → SUBMITTING` is one
conditional `UPDATE` (still `QUEUED`, leased by this worker, no cancel requested), so
two pods never submit the same job. A job that loses that race waits with
`Waiting to submit to the evaluation service` and is rechecked after 10s.

**Submit.** `SUBMITTING` is committed before `POST /evals`, as the crash-safety marker.
Keys are decrypted in memory only. Outcomes:

| Answer | Result |
|---|---|
| `202` | `SUBMITTED` (or `RUNNING`), `remote_job_id` stored, first poll in 10s |
| `409`, HIGH job active | Back to `QUEUED` with `HIGH job <id> active`; retried after 30s, 60s, 120s, 240s, then every 5 minutes |
| `409`, other conflict | Back to `QUEUED` with `Evaluation service conflict: …`; retried after 15s doubling to 5 minutes |
| `422` or another 4xx | `BLOCKED` with `Rejected by the evaluation service`; the full message is in `error` |
| `401` | Back to `QUEUED`; the environment is marked unhealthy and paused |
| Timeout, transport error, 5xx, 429 | Stays `SUBMITTING` with `Evaluation service unreachable; checking before resubmitting`; reconciled after at least one lease length |

**SUBMITTING recovery (reconcile).** A `SUBMITTING` job whose lease expired (a pod
crashed mid-submit, or the answer was lost) is never resubmitted blindly. The dispatcher
lists `GET /evals?user_id=<experiment creator>` newest first, in pages of 500 (at most
20 pages, stopping at jobs created more than 10 minutes before the qym job). It matches
`eval_input.config.run_metadata.qym_launch.job_id`. It adopts the remote job when found
(`eval job … reconciled with remote job …`) and resubmits only when not. A failed list
keeps the job `SUBMITTING` and retries; a 401 during reconcile pauses the environment
and keeps the job `SUBMITTING`. If the log shows `reconcile gave up after N pages`, the
creator has more than 10,000 newer remote jobs, and a duplicate submit is possible.

**`LEASE_SECONDS` vs the client timeout.** The service client times out after 5s
connect plus 30s read, well under the 120s lease. Because a `SUBMITTING` job is only
reconciled after its lease expired, the original POST has certainly finished by then,
so reconcile sees its result. If the client timeout is ever raised, raise
`LEASE_SECONDS` with it; a POST that outlives the lease can be submitted twice.

**Poll backoff.** `SUBMITTED`/`RUNNING` jobs are polled every 10s for the first 5
minutes after submit, then every 30s until 30 minutes, then every 60s. A remote
`SUCCEEDED` stores the redacted `result` and `versioning_metadata` (falling back to the
legacy flat `agent_version`/`kb_version` keys). Remote `FAILED`/`CANCELLED` settle the
job. A remote 404 fails it (`The evaluation service no longer knows this job`).

**Merging with the linked run.** The service does not report `FAILED` reliably (D2), so
the linked qym run's status is merged in:

- a `FAILED` run fails the job; a `STOPPED` run fails it, or cancels it when it was
  cancelled from the queue or force-stopped by an admin;
- a `COMPLETED` run while the service still says `RUNNING` waits up to 10 minutes for
  the service's result (`Run completed; waiting for the service result`), then marks
  the job `SUCCEEDED`;
- a `RUNNING` job with no remote status change and no run activity for **2h15m**
  (`QYM_EVAL_JOB_TIMEOUT_SECONDS`; the service's 7200s hard limit plus margin)
  becomes `TIMED_OUT`. The clock only
  runs while the job is `RUNNING` and qym can observe it: a job still `PENDING` on
  the service (`SUBMITTED`) never times out, and neither does one whose service is
  unreachable or paused. Before the transition the dispatcher makes one best-effort
  `POST /evals/{id}/cancel` (as the experiment's creator). Its outcome is appended
  to the job's `error` (`… Remote job cancelled on the evaluation service`,
  `… already finished …`, `… unknown to the evaluation service`, or
  `… not cancelled: …` with the reason). A failed cancel is logged
  (`remote cancel after timeout failed`, redacted) and never blocks the timeout; a
  401 also pauses the environment.

When a job is terminal and its run completed, the completion hook writes the run's
`eval_run_scores` rows. After every status change, the experiment's aggregate status is
recomputed.

**Cancel and `CANCELLING`.** A queue or experiment cancel (the experiment's creator or
a project manager; audit action `eval_job.cancel`):

- cancels `QUEUED`/`BLOCKED` jobs that no dispatcher holds locally, at once;
- moves `SUBMITTED`/`RUNNING` jobs to `CANCELLING`, due now; the dispatcher calls
  `POST /evals/{id}/cancel` with the cancelling user's id on its next tick, so a bulk
  cancel never blocks the request;
- sets `cancel_requested_at` on a job being submitted right now; the dispatcher checks
  it before the submit, right after the `202` (then cancels remotely at once), after a
  reconcile, and on every poll.

`CANCELLING` outcomes: `200` → `CANCELLED`; `404` → `CANCELLED` with a note; `409`
(already finished) → back to `RUNNING`, polled at once to record the real outcome;
`401` → the environment pauses (`Cancelling; environment unhealthy: API key rejected`);
transport error or 5xx → retried with backoff from 15s to 5 minutes
(`Cancelling; evaluation service unreachable, retrying`). After **2h15m** of failed
attempts the dispatcher gives up and marks the job `CANCELLED`
(`… gave up after 2h15m`), because the service's hard limit has usually ended the
remote job by then. If the service still lists it, it becomes a stale remote job:
it keeps counting toward the cap and a manager can cancel it from the remote queue.
After a remote cancel, the
linked run is marked `STOPPED` with `status_reason = cancelled_by_user` (older runs:
`cancelled_from_queue`), unless it already ended; a killed worker never sends a
terminal event. The run page shows who cancelled it.

**Experiment-level Cancel** cancels queued jobs only. Jobs already running (status
`RUNNING` or with a linked run) keep going and are listed in `skipped_running`; send
`{"include_running": true}` (the UI does when nothing else is left) to stop them too.

**Settle sweep.** The experiment creator's qym API key stays valid for 10 minutes
(`KEY_REVOKE_GRACE`) after the last job finishes, so the SDK's last events
(`run_completed` included) still land. The dispatcher then revokes it, and first
closes out the run of any `SUCCEEDED` job that never got `run_completed`: `COMPLETED`
when every item arrived, otherwise `STOPPED` / `upload_incomplete`. A late
`run_completed` still replaces either inferred stop.

**Retry** clones the job into a new attempt row with a new launch token; the old row
stays in the history. A `BLOCKED` job is cancelled first. Retrying needs
`QYM_LLM_CONFIG_ENCRYPTION_KEY`, an active environment, and (at `HIGH`) the same
manager, cap and acknowledgement checks as a launch.

### TIMED_OUT and BLOCKED triage

Start on **Experiments → Queue** (or `GET /v1/projects/{pid}/eval-queue`): each
unfinished job shows `status`, `wait_reason`, `error`, `remote_job_id`,
`remote_status` and its linked run. Finished jobs show their `error` in the experiment's
job history.

**`BLOCKED`** jobs never move again without a retry. Fix the cause, then **Retry**.

| `wait_reason` | Cause | Action |
|---|---|---|
| `Rejected by the evaluation service` | The service answered 422 (or another 4xx). `error` holds its message, with `loc` paths | Usually schema drift: **Refresh schema** on the environment, fix the setting, retry. A 4xx other than 422 may be a service-side bug |
| `Model "X" no longer exists` | The bound project connection was deleted | Relaunch with another model (a retry reuses the same binding) |
| `Model "X" is no longer available for experiments` | **Available for experiments** was cleared on the connection | Re-enable it, then retry |
| `Model "X" uses an http:// base URL. Experiments need an https:// base URL…` (also for temporary models) | The model's base URL is plain `http://`, and `QYM_ALLOW_PRIVATE_LLM_BASE_URLS` is off | Change the connection to `https://` (or relaunch with an `https://` model), then retry |
| `Model "X" has no model name` | The connection has an empty model | Set the model on the connection, then retry |
| `Model "X" needs its API key, but this environment does not accept model keys` (also for temporary models) | **Allow connection keys** is off on the environment | A manager enables it, or relaunch with a keyless model |
| `The API key of model "X" could not be decrypted` | The connection's key was encrypted under a key that is neither `QYM_LLM_CONFIG_ENCRYPTION_KEY` nor listed in `QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS` | Add the old key to `QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS` and run `reencrypt_llm_keys`, or re-enter the connection key; then retry |
| `The API key of temporary model "X" is no longer stored; enter it again` | The experiment's temporary keys were cleared (every job settled) | **Retry** and enter the key when asked |
| `Model slot '…' has no binding` / `has an invalid binding` / `still holds a sweep` | A corrupt stored binding | Relaunch from the form |
| `Environment is disabled` | The environment was disabled | Re-enable it, then retry |
| `Experiment or environment no longer exists` | A parent row was deleted | Nothing to recover; relaunch |

**`TIMED_OUT`** (`No progress from the evaluation service or the linked run for 2h15m`)
means the service kept reporting `RUNNING` with no change and the linked run (if any)
sent no event for 2h15m. The service does not always write `FAILED` (D2), so this is
usually a worker that died.

1. Open the job's linked run. If it has events near the end, the worker died late;
   if there is no run, the worker probably never started the task. The service's logs
   for `remote_job_id` say which.
2. Read the end of `error`: the dispatcher already tried to cancel the remote job.
   `Remote job cancelled on the evaluation service` means the service worker was
   freed; nothing more to do.
3. Otherwise (`… not cancelled: …`), check the Queue page's **Remote queue**. If the
   remote job is still listed there, it carries a **Stale** badge: it still holds a
   service worker. The queue cancel
   no longer applies (the job is terminal, so it answers `already_terminal`); a
   project manager selects the stale job and uses **Cancel selected remote jobs**
   (or `POST /v1/projects/{pid}/eval-queue/remote/cancel` with its
   `remote_job_id`). The cancel is audit-logged. Fix the environment first if the
   note says the key was rejected or the service could not be reached.
4. **Retry** once the service is healthy.

The same applies to a job that the dispatcher cancelled after giving up on the remote
cancel (`… gave up after 2h15m`): if the service still lists it, it is stale.

**Jobs that do not move** (not blocked):

| `wait_reason` | Meaning | Action |
|---|---|---|
| empty on a `QUEUED` job | No dispatcher has claimed it | Check that a process with `QYM_ROLE=all` or `worker` runs, and its logs for `eval dispatcher tick failed` |
| `Waiting to submit to the evaluation service` | Another dispatcher pod took the job first, or it was cancelled meanwhile | None; rechecked after 10s |
| `HIGH job <id> active` | The service refused a submit while a HIGH job runs | Wait; retried with backoff up to every 5 minutes |
| `Environment unhealthy: API key rejected` / `Environment unhealthy` / `Environment has no API key` / `Environment API key cannot be decrypted` / `Environment unavailable: …` | The environment is paused or unusable | See "Environment health"; fix the key or URL |
| `Launch tokens need QYM_LLM_CONFIG_ENCRYPTION_KEY` | The dispatcher's process has no encryption key | Set it on that process |
| `Evaluation service conflict: …` | An unexpected 409 on submit | Retried with backoff; check the service if it persists |
| `Submitting to the evaluation service` | Mid-submit | Normal; if it lasts past 2 minutes, the pod likely died and reconcile runs next |
| `Evaluation service unreachable; checking before resubmitting` | The submit's outcome is unknown | Reconcile runs after at least 120s |
| `Queued on the evaluation service` | Accepted, `PENDING` on the service | The service's own queue is busy; this never times out. Cancel if it is no longer wanted |
| `Evaluation service unreachable; retrying` / `Environment unhealthy; status may be stale` | Polling fails | Check the service; the timeout clock is paused meanwhile |
| `Run completed; waiting for the service result` | The run finished before the service reported | Settles as `SUCCEEDED` within 10 minutes |
| `Already finished on the evaluation service; checking its final status` | A cancel found the job already terminal | Settles on the next poll |
| `Cancelling` / `Cancelling; …` | Remote cancel pending or retrying | Settles as `CANCELLED`, at the latest after 2h15m |

Useful log lines (logger `qym_platform.services.eval_dispatcher`):
`eval environment … rejected its API key; queue paused`,
`eval environment … is healthy again; resuming`, `eval job …: reconciled with remote job …`,
`eval job …: lease lost to another worker` (harmless), `eval job …: database busy,
retrying later` (lock contention; the lease expires and the job is retried),
`eval job …: dispatcher step failed` (the job backs off 5 minutes; investigate).

### Orphans and stale remote jobs

The **Remote queue** on the Queue page lists each active environment's `PENDING` and
`RUNNING` remote jobs from the latest snapshot. A remote job whose id matches no local
job of any status is an **orphan**. A remote job whose id matches a local job that is
already terminal (`TIMED_OUT`, `CANCELLED`, `FAILED` or `SUCCEEDED`) is **stale**
(`stale: true` with the local job in `match`, a **Stale** badge on the page): qym has
stopped tracking it, usually after a timeout whose remote cancel failed or a
`CANCELLING` give-up. A job that finished locally in the last 30s can show as stale
until the next snapshot. Stale jobs still occupy service workers. Common causes of
orphans:

- a job whose `POST /evals` answer was lost is `SUBMITTING` without a `remote_job_id`
  until reconcile adopts it. Its remote job shows as an orphan meanwhile. This clears
  itself within a few minutes;
- jobs submitted to the service by something other than this qym (see D8 below), or
  by a qym database that was since restored from a backup;
- jobs created before the integration.

Only project managers can cancel orphans and stale jobs (**Cancel selected orphans**,
or **Cancel selected remote jobs** when stale jobs are listed, or
`POST /v1/projects/{pid}/eval-queue/remote/cancel` with up to 200 ids). The call goes
straight to the service with the manager's user id. Ids that match a non-terminal
local job are refused (`refused_local_job`: cancel those through the normal queue
cancel, which keeps the job, run and experiment consistent), and ids that are not in
the latest snapshot are refused (`not_in_snapshot`). Every id sent is audit-logged as
`eval_remote_job.cancel`; for a stale job the entry has `stale: true`, the local
`job_id` and its `job_status`, and a successful cancel sets the job's `remote_status`
to `CANCELLED` (its status stays terminal). Cancelling the orphan of a job still being reconciled is safe:
reconcile adopts the remote job and the next poll records it as `CANCELLED`.

A snapshot shows "fetched … ago". `fetch_error` means the last refresh failed and the
items are from the last success. A paused (401) environment is not called; its snapshot
only records why.

### Assumption D8: qym is the service's only caller

The Evaluation Service has no job ownership: any holder of `EVAL_API_KEY` can list and
cancel every job. qym relies on being the **only** caller of each environment:

- the remote snapshot filters by status only, not by `user_id`, so every remote job is
  shown and any job qym doesn't know is an orphan that a manager may cancel;
- other callers' jobs share the service's own concurrency limit and queue with qym's;
- another caller's `HIGH` job preempts qym's running jobs.

Do not share an environment's `EVAL_API_KEY` with other clients. A deployment that has
other callers needs a separate deployment (or key-scoped ownership on the service) for
qym.

### Security notes

- Environment keys and temporary-model keys are Fernet-encrypted at rest, shown only as
  `••••last4`, never returned or logged, and never stored in `spec`, `params`,
  `qym_config` or copies of remote responses. 422 validation errors mask credential
  fields.
- Every remote response is redacted (`LLM_OVERRIDES.endpoints.*.api_key`) before it is
  stored or returned (D1); the remote snapshot keeps an allow-list of columns only.
- Environment URLs are `https://` only (unless `QYM_ALLOW_PRIVATE_LLM_BASE_URLS`), and
  every service call uses the SSRF-safe transport (pinned DNS, no redirects).
- Models used in experiments are `https://` only too (same exception): a temporary
  model with an `http://` base URL is refused at launch (`https_required`), an `http://`
  project connection is listed disabled in the model picker, refused per slot at launch,
  and blocks a queued job at dispatch, and it can't be marked **Available for
  experiments**. Root-cause-analyzer connections still accept public `http://`.
- Model keys only go to environments with **Allow connection keys**, which only a
  manager can enable and which resets when the URL changes.
- `HIGH` priority needs the environment's `max_priority`, a project manager, and an
  explicit acknowledgement, on launch and on retry (D9).
- Audit log actions: `eval_job.cancel`, `eval_job.retry`, `eval_remote_job.cancel`.

The full verification, with the enforcing code and tests, is in
[`EVAL_SECURITY_CHECKLIST.md`](EVAL_SECURITY_CHECKLIST.md).

### Multi-pod and load testing

[`EVAL_DISPATCHER_LOAD_TEST.md`](EVAL_DISPATCHER_LOAD_TEST.md) records the multi-pod
lease test and the 64-job load test on SQLite and PostgreSQL 16 (4 to 32 pods, with
injected timeouts, 5xx, HIGH conflicts and pod crashes): no double submit, no double
cancel. (Those runs predate the removal of the platform in-flight cap; the
harness no longer seeds or checks one.) Reproduce with
`python tests/platform/eval_dispatch_loadtest.py --workers 8 --faults` (set
`QYM_TEST_POSTGRES_URL` for PostgreSQL). The experiment status recompute is shared by
the API (cancel, retry) and the dispatcher and locks the experiment row on PostgreSQL,
so a queue cancel racing the dispatcher settling the last job still settles the
experiment (`test_eval_dispatcher_concurrency.py::test_queue_cancel_racing_a_dispatcher_settle_settles_the_experiment`).
