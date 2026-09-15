# Operations: storage, retention, maintenance, and the recovery runbook

Production runs on Kubernetes (image → Harbor → Helm values → ArgoCD). There is no
shell on the database host, so every operation below is driven from **values.yaml**
(environment variables) or the **Admin → Maintenance** page in the platform UI.

## How the pieces fit

| Component | What it does | Where |
|---|---|---|
| API pod(s) | Serve HTTP; apply Alembic migrations on start (instant DDL only) | `QYM_ROLE=api` |
| Worker pod | Dashboard summary backfill + maintenance jobs + hourly retention | `QYM_ROLE=worker`, `QYM_SKIP_MIGRATIONS=1`, command `python -m qym_platform.worker` |
| Maintenance jobs | Long operations (reclaim, index builds, span copy, purges) in small committed steps, resumable after a pod restart | `Admin → Maintenance`, `GET/POST /api/admin/maintenance/jobs` |
| Maintenance mode | Ingest answers `503 Retry-After: 60`; SDKs buffer (16 MiB RAM + 256 MiB disk) and retry; UI stays readable | `QYM_MAINTENANCE_MODE=1` |

A single-container deployment keeps working unchanged: `QYM_ROLE=all` (default) runs
the API and both loops in one process.

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
- Deleting a run: soft delete as before; the worker purges it (cascade) after the grace period.

## Migrations and large tables

Migrations run in the API pod's entrypoint before readiness, so they only perform
instant DDL. Anything that would scan or rewrite a large table is **queued as a
maintenance job** by the migration itself; you will see it in Admin → Maintenance
after the deploy:

| Migration | Instant part | Deferred job (if table is large) |
|---|---|---|
| 0051 | `maintenance_jobs` table; drops 3 redundant indexes | `create_deferred_indexes` — `ix_run_events_run_type_seq` |
| 0052 | — | `alter_column_types` — bigint/jsonb rewrite (run in maintenance mode) |
| 0053 | new partitioned `spans`, old table → `spans_legacy` | `migrate_spans` (you queue it), then `drop_legacy_spans` |
| 0054 | cascading FKs `NOT VALID` | `validate_foreign_keys` |
| 0055 | — | `create_deferred_indexes` — extrema partial indexes |

## Recovery runbook (database near its volume limit)

Rehearsed end-to-end on the perf lab (`docs/internal/PERF_LAB.md`) before running in production.

**Before the window**
1. Admin → Maintenance → *Refresh*: note `run_events` / `spans` sizes and `span_completed` payload bytes.
2. Confirm Helm values are ready: worker Deployment added, `QYM_ROLE=api` on the API, image tag of this release.

**Window (2–4 h, mostly waiting)**
1. values.yaml: `QYM_MAINTENANCE_MODE=1` on the current API → sync. Running evals pause (SDK retries).
2. Deploy the new image. Migrations 0051–0055 run at pod start (seconds). Deferred jobs appear queued.
3. Admin → Maintenance, in order (each finishes before the next):
   1. `drop_redundant_indexes` — only if 0051 could not (already done otherwise). Frees GBs instantly.
   2. `reclaim_run_events` — deletes the duplicated `span_completed` rows in batches with periodic `VACUUM`.
      Watch *rows deleted*; the table stops growing immediately, its file shrinks after the rewrite below.
   3. `alter_column_types` — rewrites `run_events` (and any other large table) to bigint/jsonb. Needs
      free space ≈ the live size of `run_events` after reclaim (~10 GB). This also returns the reclaimed space.
   4. `migrate_spans` — copies the last `QYM_SPAN_RETENTION_DAYS` of spans into the partitioned table.
   5. Verify: `spans` row count ≈ `spans_legacy` rows in the window (the `drop_legacy_spans` job refuses otherwise).
   6. `drop_legacy_spans` (type the name to confirm) — returns ~25 GB.
   7. `create_deferred_indexes`, `validate_foreign_keys` — can run after reopening.
4. values.yaml: `QYM_MAINTENANCE_MODE=0`, `QYM_EVENT_LOG_MODE=structural` → sync. Start the worker Deployment.
5. Runs appear immediately with a *pending* badge and fill in as the worker publishes (no more hidden history).

**Rollback**: redeploy the previous image any time before `drop_legacy_spans`; the old code
tolerates the new columns and the missing duplicate rows. After 0053, `alembic downgrade 0052`
restores `spans_legacy` as `spans`.

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

`pg_dump` of raw tables is the largest, least valuable part of a backup. Exclude them and rely on
retention + derived tables: `pg_dump -Fd -j2 --exclude-table-data='spans*' --exclude-table-data=run_events
--exclude-table-data=dashboard_change_events`. Keep backups off the database volume.

## Worker Deployment (Helm/Kubernetes sketch)

Same image as the API; only the command and two variables differ. One replica.

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

And on the API Deployment add `QYM_ROLE=api` so it no longer runs the background loops.
