# perf: storage, worker and read-path overhaul (DB 100 GB → ~25 GB, repeat-run pages 2–6× faster)

> This file is the PR description for branch `perf/storage-worker-overhaul`. Paste it into the PR body.

## Why

Production hit its 100 GB volume: `run_events` 35 GB, `spans` 25 GB for ~3000 runs. The summary worker re-queued every run at ~6 s/run and hid them meanwhile; deletes were unresponsive; 12-repeat runs stalled on interaction.

Root causes (all verified on a 58 GB prod-shaped copy, see `artifacts/perf/README.md`):
1. Every span was stored **twice** (once in `spans`, once verbatim as a `span_completed` row in `run_events`) — that alone is ~25 GB. No retention anywhere.
2. The worker recomputed min/max over a whole project-day of numeric rows per published run.
3. Repeat-run pages replayed the entire event log on every open and every 100-item scroll.
4. Default SQLAlchemy pool (15 connections), no timeouts, stock Postgres config, 600 k-round API-key hashing on every SDK batch.

## What changes

**Storage** — spans stored once; `spans` is a monthly range-partitioned table (jsonb, LZ4, scalar columns for kind/scope/model/tokens); `run_events` and large JSON columns are bigint/jsonb; redundant indexes dropped, `(run_id, type, sequence)` added; cascading FKs. **Retention**: raw spans older than 60 days are dropped by partition; soft-deleted runs are purged after 30 days. Age-based trace retention preserves derived data. Hard deletion of a soft-deleted run removes its associated items, outputs, scores, and summaries after the grace period.

**Operations** — a maintenance-job framework (`maintenance_jobs` table, resumable, one job at a time) with an **Admin → Maintenance** tab: table sizes, queue/cancel/start jobs, typed confirmation for irreversible ones. Large storage rewrites are queued as jobs; the pass-review backfill in migration 0057 runs during startup. `QYM_MAINTENANCE_MODE=1` makes ingest answer `503 Retry-After` (SDKs buffer and retry). `QYM_ROLE=api|worker|all`; the default `all` runs the loops in the API, and a standalone worker process is optional.

**Worker** — cheap extrema repair (hour range, day folded from hours); runs are listed as *pending* instead of hidden during backfill; own connection pool; throttled discovery; instant hide/show on delete/restore.

**Read path** — repeat-pass state from `run_item_attempts` (RUNNING rows written at attempt start) instead of event replay; step-latency without loading JSON; API-key verification cache; pool sizing + statement/lock timeouts; set-based pass deletion.

**Frontend** — poll backoff while the worker publishes, overview only when it changed, gzip, live poll 500 ms → 2 s, delete toast.

## Measured (same 3000-run database, before → after)

| | before | after |
|---|---|---|
| Database size | 58.0 GB | **26.1 GB** |
| `run_events` | 29.2 GB | 4.3 GB |
| `spans` | 23.1 GB | 12.0 GB (60-day window, 3 partitions) |
| 12-repeat run open (p50) | 1,141 ms | **502 ms** |
| items batch, 100 items × 12 passes | 1,167 ms | **628 ms** |
| passes panel | 615 ms | **95 ms** |
| legacy `/api/runs` page | 288 ms (16.6 s cold) | 101 ms |
| pass delete (12 × 100 run) | 2.0 s | **0.84 s** |
| run delete → gone from list | 1.7 s (worker lag) | next request |

Previous PR rehearsal reported 1067 passing tests and migrations 0051–0056 on the 58 GB copy in 35 s. These figures predate the integration fixes. Current validation is recorded under `artifacts/pr47-validation/`.

---

## Deployment of the combined release

Use [OPERATIONS.md](OPERATIONS.md) for the full sequence. The combined migration
head is `0057`; the original pass-review migration `0051` was moved after the
storage migrations. Rehearse from a populated `0050` database before production.
Migration `0057` backfills pass approvals during startup, so its duration depends
on the existing data.

### Before deployment

- Build the tested image and record its digest and the currently deployed digest.
- Take a complete database backup, including spans, events, approvals, and catalogs.
  Restore it into a disposable database and check the data before destructive work.
- Record actual table sizes and free space. Historical timings and disk savings
  above are from the earlier performance rehearsal, not guarantees for this merge.
- Pause ingestion on every API. Use `QYM_MAINTENANCE_MODE=1` when the current image
  supports it; otherwise pause ingress first. Confirm ingest returns 503.
- If you use the optional separate worker, give it the same database, maintenance,
  and retention settings as the API.
  Keep `QYM_EVENT_LOG_MODE=full` during migration.

### Apply migrations and run jobs

1. Deploy the new API with the default `QYM_ROLE=all`; let one migration runner
   upgrade to `0057`. The API process runs the queued jobs itself. Optional split
   layout: set `QYM_ROLE=api` on the API and, after it is healthy, start one
   worker using the same image, `QYM_ROLE=worker`, and `QYM_SKIP_MIGRATIONS=1`.
2. Inspect auto-queued index and FK-validation jobs. Leave `alter_column_types`
   paused until there is enough disk for the rewrite. Investigate failed jobs.
3. Run `reclaim_run_events` to delete duplicate `span_completed` events. VACUUM
   makes space reusable; the later rewrite can return space to the filesystem.
4. Run `migrate_spans` with the intended retention policy. It freezes its cutoff
   across batches and restarts and includes soft-deleted restorable runs.
   `retention_days=0` preserves all history. Use the same policy for the drop.
5. After copy succeeds, queue `drop_legacy_spans` and enter its typed confirmation.
   Maintenance mode is required. The job checks every retained legacy span against
   `(run_id, span_id, run_created_at)`, then drops the table in the same locked
   transaction. Extra destination rows and `force=true` cannot bypass missing
   spans. A failed verification or DROP keeps the legacy table intact. Resolve
   the error and rerun the copy. Run mutations can wait during this final step.
6. Complete `alter_column_types` while maintenance mode remains enabled. It may
   run before span copy if enough free space is available. Confirm required index
   and FK-validation jobs succeeded and the maintenance worker reports running.
7. Verify representative outputs, traces, scores, approved categories, and pass
   reviews. Then set `QYM_MAINTENANCE_MODE=0` and `QYM_EVENT_LOG_MODE=structural`
   on every role. Keep the process that runs the loops up and confirm buffered SDK events resume.

Purge waits while `spans_legacy` exists and until dashboard deletion publication
has removed the run's numeric contributions. Once both finish, eligible purges
resume. Restore and purge serialize on the run row: a committed restore survives;
a restore that loses to a completed purge returns 404.

### Checks after reopening

- Pending runs become ready without dashboard errors.
- A running retry remains active and legacy split-batch events retain pass outputs.
- Cancellation keeps per-pass error details and force stop finishes.
- Deleting and restoring a run works. Deleting an earlier pass preserves the
  remaining pass's approved review and allows resetting it.
- The API (and the worker, if used) remain healthy. Record final sizes against the rehearsal.

### Rollback

An old image alone is not a safe rollback after `0053`: its span writer does not
supply the new partition key. `alembic downgrade 0052` deletes the new span table
and reverses `0057`, deleting pass-scoped review records. It cannot recreate
`spans_legacy` after that table has been dropped.

Prefer a forward fix after reopening. If rollback is necessary, stop writes and
workers, save the current state, and restore the verified complete pre-deployment
backup with the matching old image into a separate database. Reconcile any writes
made after the backup before switching services. A backup that excludes raw tables
cannot recover data removed by these operations.

### Failed or interrupted work

Read the job error before re-queueing. Missing-span failures require completing
the copy. Worker restarts resume from saved progress; an interrupted atomic DROP
is either committed or rolled back. Do not assume that a queued job has completed,
or that approximate row counts establish migration completeness.

---

### New environment variables (defaults are safe)
`QYM_ROLE` (all) · `QYM_MAINTENANCE_MODE` (false) · `QYM_EVENT_LOG_MODE` (full) · `QYM_SPAN_MAX_BYTES` (1 MiB) · `QYM_SPAN_RETENTION_DAYS` (60) · `QYM_DELETED_RUN_GRACE_DAYS` (30) · `QYM_DB_POOL_SIZE`/`QYM_DB_MAX_OVERFLOW` (10/10) · `QYM_DB_WORKER_POOL_SIZE`/`QYM_DB_WORKER_MAX_OVERFLOW` (3/2) · `QYM_DB_STATEMENT_TIMEOUT_MS` (30000) · `QYM_DB_LOCK_TIMEOUT_MS` (5000) · `QYM_REQUEST_TIMING` (false).

### Follow-ups (not in this PR)
Message dedup for trace conversations (≈ −5 GB more); lazy per-pass loading on the repeat-run page; `strip_event_bodies` job for the existing 3 GB of bodies in `run_events`; the local `.env` leaking into tests.
