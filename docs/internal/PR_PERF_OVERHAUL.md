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

**Storage** — spans stored once; `spans` is a monthly range-partitioned table (jsonb, LZ4, scalar columns for kind/scope/model/tokens); `run_events` and large JSON columns are bigint/jsonb; redundant indexes dropped, `(run_id, type, sequence)` added; cascading FKs. **Retention**: raw spans older than 60 days are dropped by partition; soft-deleted runs are purged after 30 days. Derived data (items, outputs, scores, summaries) is never pruned.

**Operations** — a maintenance-job framework (`maintenance_jobs` table, resumable, one job at a time) with an **Admin → Maintenance** tab: table sizes, queue/cancel/start jobs, typed confirmation for irreversible ones. Migrations stay instant DDL; anything heavy is queued as a job. `QYM_MAINTENANCE_MODE=1` makes ingest answer `503 Retry-After` (SDKs buffer and retry). `QYM_ROLE=api|worker|all` + standalone worker process.

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

Tests: 1067 passed (sqlite + PostgreSQL). Migrations 0051–0056 applied to the 58 GB copy in 35 s; the full reclaim sequence was rehearsed end-to-end through the Admin tab.

---

## PRODUCTION DEPLOYMENT — do this today, in order

Everything is driven from **values.yaml** and the **Admin → Maintenance** tab. No shell on the VM is needed. Budget ~3 hours, most of it waiting on two jobs. Expect ~70 GB back.

### 0. Before you start (5 min)
- [ ] Merge this PR. Build and upload the image exactly as usual (`docker compose -f docker/docker-compose.yml build` → Filestash → Harbor). Note the tag.
- [ ] Open prod **Admin → Maintenance** *after* deploy for numbers; before deploy, just note the current DB size if you have it.
- [ ] Tell users: evals started during the window will pause and resume automatically (SDK retries for up to 256 MB of buffered events); the UI stays readable.

### 1. Helm values — one change, three edits
In `values.yaml`:
1. Set the new image tag.
2. On the **API** Deployment env add:
   ```
   QYM_ROLE: "api"
   QYM_MAINTENANCE_MODE: "1"        # temporary, removed in step 5
   QYM_EVENT_LOG_MODE: "full"       # switched to "structural" in step 5
   QYM_SPAN_RETENTION_DAYS: "60"
   QYM_DELETED_RUN_GRACE_DAYS: "30"
   ```
3. Add a **worker** Deployment (same image, same secret/env as the API), 1 replica:
   ```yaml
   command: ["python", "-m", "qym_platform.worker"]
   env:
     - { name: QYM_ROLE, value: "worker" }
     - { name: QYM_SKIP_MIGRATIONS, value: "1" }
   resources: { requests: { cpu: "250m", memory: "512Mi" }, limits: { memory: "1Gi" } }
   ```
   (Full sketch in `docs/internal/OPERATIONS.md`.) It must start **after** the API pod is healthy once, so the migrations have run; if your chart can't express that, just sync the API first and the worker a minute later.
4. Commit → Argo syncs. The API pod runs migrations 0051–0056 at start (seconds) and comes up in maintenance mode. The worker pod starts and immediately runs the jobs the migrations queued.

### 2. Watch the auto-queued jobs finish (Admin → Maintenance, ~10 min)
You will see these already in the list; they run by themselves in this order:
- `create_deferred_indexes` — builds `ix_run_events_run_type_seq` concurrently (~5 min on prod size)
- `validate_foreign_keys` — seconds
- `create_deferred_indexes` — the two dashboard extrema indexes (~1 min)
- `alter_column_types` — shows **paused**. Leave it paused for now.

The Refresh button reloads sizes; the page auto-refreshes every 3 s while a job runs.

### 3. Reclaim the duplicated span rows (~25–40 min)
- Job: **`reclaim_run_events`**, params `{"batch_runs": 25, "vacuum_every": 40}` → Queue job.
- Progress reads `N/3000 runs, M rows deleted`. Expect ~8–9 M rows. It VACUUMs as it goes; `run_events` size on the page starts falling before it finishes.
- If it ever shows *failed*, just queue it again — it re-scans from the start and skips what's already gone.

### 4. Rewrite `run_events` to bigint/jsonb (~5 min) — returns the space to disk
- Find the paused **`alter_column_types`** row → **Start**.
- Needs free space ≈ the live size of `run_events` after reclaim (~10 GB). If the volume is *that* full, skip this step now and do it after step 6 — nothing else depends on it.

### 5. Copy the last 60 days of spans, then drop the old table (~20 min)
- Job: **`migrate_spans`**, params `{}` (uses `QYM_SPAN_RETENTION_DAYS`). Progress: `runs, spans copied`.
- When it says `done`, job: **`drop_legacy_spans`** — type `drop_legacy_spans` in the confirm box. It refuses if the copy is incomplete. This is the moment ~25 GB comes back.

### 6. Reopen
values.yaml: `QYM_MAINTENANCE_MODE: "0"`, `QYM_EVENT_LOG_MODE: "structural"` → sync. Paused SDK clients resume within a minute.

### 7. Verify (5 min)
- Runs list shows history; any run still catching up carries a *pending* badge and fills in.
- Open a 12-repeat run, scroll, open the passes panel — sub-second.
- Delete a test run: it disappears on the next refresh; it is in Trash and restorable.
- Admin → Maintenance: DB size should read ~25–30 GB; `run_events` ≈ 4 GB; `spans_y2026m0x` partitions ≈ 3–5 GB each; workers both *running*.

### 8. Postgres settings — from your workstation, once, whenever convenient
These cannot be applied from inside the app. Connect to prod Postgres as superuser (the DB port is reachable from your work machine) and run the block under "Postgres settings (16 GB host)" in `docs/internal/OPERATIONS.md` (`shared_buffers=4GB`, `work_mem=32MB`, `random_page_cost=1.1`, LZ4 default, autovacuum tuning). `shared_buffers` takes effect after a Postgres restart; everything else after `SELECT pg_reload_conf();`. Also `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` so the Maintenance tab's slow-query panel is populated.

### Rollback
- Any time before step 5's `drop_legacy_spans`: redeploy the previous image tag. The old code tolerates the new columns and the missing duplicate rows.
- After the drop: raw traces older than the copy window are gone by design; everything derived is intact. The old image would still run against the schema (`alembic downgrade 0052` restores the old spans table name if ever needed).

### If something looks wrong
- A job *failed* → open its **Log** (button on the row). Every job is safe to re-queue.
- Runs missing from the list → they show as *pending*; check the worker pod is up (Maintenance tab says "maintenance worker running").
- Ingest returning 503 → `QYM_MAINTENANCE_MODE` is still `1`.
- Worker pod restarts → it resumes the current job from its saved cursor; nothing to do.

---

### New environment variables (defaults are safe)
`QYM_ROLE` (all) · `QYM_MAINTENANCE_MODE` (false) · `QYM_EVENT_LOG_MODE` (full) · `QYM_SPAN_MAX_BYTES` (1 MiB) · `QYM_SPAN_RETENTION_DAYS` (60) · `QYM_DELETED_RUN_GRACE_DAYS` (30) · `QYM_DB_POOL_SIZE`/`QYM_DB_MAX_OVERFLOW` (10/10) · `QYM_DB_WORKER_POOL_SIZE`/`QYM_DB_WORKER_MAX_OVERFLOW` (3/2) · `QYM_DB_STATEMENT_TIMEOUT_MS` (30000) · `QYM_DB_LOCK_TIMEOUT_MS` (5000) · `QYM_REQUEST_TIMING` (false).

### Follow-ups (not in this PR)
Message dedup for trace conversations (≈ −5 GB more); lazy per-pass loading on the repeat-run page; `strip_event_bodies` job for the existing 3 GB of bodies in `run_events`; the local `.env` leaking into tests.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
