# Operations: storage, retention, maintenance, and the recovery runbook

Production runs on Kubernetes (image → Harbor → Helm values → ArgoCD). There is no
shell on the database host, so every operation below is driven from **values.yaml**
(environment variables) or the **Admin → Maintenance** page in the platform UI.

## How the pieces fit

| Component | What it does | Where |
|---|---|---|
| API pod(s) | Serve HTTP; apply Alembic migrations on start; run the dashboard summary backfill, maintenance jobs, and hourly retention | `QYM_ROLE=all` (default) |
| Worker pod (optional) | Runs the background loops in a separate process | `QYM_ROLE=worker`, `QYM_SKIP_MIGRATIONS=1`, command `python -m qym_platform.worker`; set `QYM_ROLE=api` on the API |
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
| `QYM_MAINTENANCE_MODE` | `false` | Reject ingest with 503 during a window |
| `QYM_EVENT_LOG_MODE` | `full` | `structural` drops item/metric bodies from `run_events` (bodies live in `run_items`/attempts/scores). Enable after the new image is live |
| `QYM_SPAN_MAX_BYTES` | `1048576` | Safety ceiling per span; larger spans keep scalar attributes only and are flagged |
| `QYM_SPAN_RETENTION_DAYS` | `60` | Raw traces older than this are dropped by partition (0 = keep forever) |
| `QYM_DELETED_RUN_GRACE_DAYS` | `30` | Soft-deleted runs are hard-deleted after this |
| `QYM_DB_POOL_SIZE` / `QYM_DB_MAX_OVERFLOW` | `10` / `10` | API connection pool |
| `QYM_DB_WORKER_POOL_SIZE` / `QYM_DB_WORKER_MAX_OVERFLOW` | `3` / `2` | Worker pool |
| `QYM_DB_STATEMENT_TIMEOUT_MS` | `30000` | Per-statement guard on API connections |
| `QYM_DB_LOCK_TIMEOUT_MS` | `5000` | Lock-wait guard (all roles) |
| `QYM_REQUEST_TIMING` | `false` | `Server-Timing` header + per-request log line |

## Storage model after this release

- `spans` — one row per span, **partitioned monthly by `run_created_at`**, jsonb + LZ4.
  Retention = drop partition. Scalar columns (`oi_kind`, `usage_scope`, `model_name`,
  `tool_name`, `token_*`) serve statistics without touching the JSON.
- `run_events` — structural history only (no `span_completed` rows). bigint id, jsonb.
- Deleting a run hides it immediately. After the grace period, purge locks and
  rechecks the run before deleting it. A restore that commits first prevents purge;
  a restore after purge returns 404. Purge waits for dashboard deletion publication
  and for `spans_legacy` to be removed. It resumes after those steps finish.

## Migrations and large tables

The combined migration chain has one head, `0057`, following `0050` through
`0051`–`0056`. Migrations run before API readiness. Large storage rewrites and index
builds are deferred to maintenance jobs. Migration `0057` also backfills existing
pass approvals in bounded batches within its migration transaction; measure its
startup time on a populated copy before setting deployment readiness deadlines.

| Migration | Work during startup | Deferred job (if table is large) |
|---|---|---|
| 0051 | `maintenance_jobs` table; drops 3 redundant indexes | `create_deferred_indexes` — `ix_run_events_run_type_seq` |
| 0052 | — | `alter_column_types` — bigint/jsonb rewrite (run in maintenance mode) |
| 0053 | new partitioned `spans`, old table → `spans_legacy` | `migrate_spans` (you queue it), then `drop_legacy_spans` |
| 0054 | cascading FKs `NOT VALID` | `validate_foreign_keys` |
| 0055 | — | `create_deferred_indexes` — extrema partial indexes |
| 0056 | `dashboard_run_dimensions.hidden_at` | None |
| 0057 | Pass review scope, deleted-pass marker, index, and approval/catalog backfill | Runs during migration |

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
   `0057` and a healthy API. The API process then runs every queued job itself.
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

## Optional separate worker Deployment (Helm/Kubernetes sketch)

Not required. The default `QYM_ROLE=all` API Deployment runs the background loops.
Use this layout to keep long maintenance jobs away from API rollouts and probes,
or to run several API replicas with one background process. Same image as the
API; only the command and two variables differ. One replica. Inherit maintenance
mode and retention settings from the same configuration as the API. Start this
deployment only after the API has migrated to `0057`.

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
```

And on the API Deployment set `QYM_ROLE=api` so it no longer runs the background
loops. Without that setting the API keeps running them, which is safe but redundant.
