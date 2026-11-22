# Database operations analysis (branch `db-operation-optimization`)

Written 2026-11-17 from the code at `main` 8644c992. Three questions: is everything
async, which operations hold locks longest, and which writes load the database most
and how to cut them. Paths are under `packages/platform/qym_platform/` unless noted.

## 1. Are all operations async?

**No. The data layer is fully synchronous**, and that is by design: SQLAlchemy 2.1 on
`psycopg2` (`db/session.py`), no `asyncpg`, no `AsyncSession`. What makes the service
non-blocking is the thread pool, not coroutines.

| Kind | Count | How the DB is reached |
|---|---|---|
| `def` route handlers | 243 | Starlette runs them on the AnyIO thread pool, one pooled connection each for the whole handler. `app.py` caps the pool at `db_pool_size + db_max_overflow` (20) threads so requests queue instead of timing out on the connection pool. |
| `async def` route handlers | 28 | Run on the event loop. Correct ones push DB work through `run_in_threadpool` (`ingest_events`, `upload_run`, `upload_dataset`, the `prepare()` of the analysis endpoints). |
| Background loops | 6 | Plain threads with their own sessions: dashboard summary worker, maintenance worker, eval dispatcher, remote-queue snapshotter, job executor, heartbeat writer. They never touch the event loop. |
| Analysis / rule-inference jobs | n | Each job gets its own thread and private event loop (`services/analysis_jobs.py::_worker_entry`), so their sync DB calls are off the request loop. |

### Async handlers that block the event loop with synchronous DB calls

*Status (branch `db-operation-optimization`): fixed. `deps.get_async_db` gives the
async handlers an `AsyncSession` on an async engine (`QYM_DB_ASYNC_DRIVER`, the
`[async]` extra) or, without a driver, a thread-pool bridge over the sync session;
every handler below ends its transaction before awaiting a remote call. The analysis
aggregation and the rule writer run through `services/loop_offload.run_blocking_coroutine`
on a worker thread's own loop. The table records what was wrong.*

These run queries, take row locks or commit directly inside the coroutine. While one of
them waits on Postgres, every other coroutine in the process stalls (SSE streams,
`/healthz`, the other async handlers). Sync handlers keep going because they are on
threads.

| Handler | Where the blocking work is |
|---|---|
| `aggregate_saved_analysis_results` (`api/analysis.py:4624`) | `_aggregate_pass_analysis_results` (2978): queries at 2994, `FOR UPDATE` item and pass-score locks at 3134/3139; `_aggregate_run_analysis_results` (3189): `_lock_run_for_save` 3313/3383/3422, `FOR UPDATE` at 3435; then `db.commit()` at 4691. |
| `analyze_run_items` (4868), `analyze_run_items_stream` (5035) | same two aggregation coroutines, commits at 4913/5125. |
| `upload_analysis_document` (5426) | `db.add / commit / refresh` at 5501-5503. |
| `infer_project_analysis_rules` (6495) and the job variant | `_infer_project_analysis_rules_impl` (6199): queries 6213-6231, `refresh(with_for_update)` 6419, commit 6458, all around an awaited model call. |
| `create_environment` (`api/eval_environments.py:780`) | auth queries on the loop, then `await _probe()` (HTTP) **with the session's transaction open**, then `add / flush / commit` on the loop. |
| `test_environment` (997), `refresh_environment_schema` (1047) | same shape: open transaction across the awaited HTTP probe, commit on the loop. |
| `post_message` (`api/feedback.py:431`), `post_turn` (466), `test_agent_connection` (837) | queries and `db.commit()` on the loop (the model turn itself runs on its own sessions, fine). |
| `cancel_orphan_remote_jobs` (`api/eval_queue.py:418`) | commit on the loop after awaited remote calls. |

Two consequences of the "open transaction across an await" shape in the environment
handlers: the connection is one of the 20 pool slots and is held for the probe's full
duration, and it sits `idle in transaction`, so a probe slower than
`db_idle_in_transaction_timeout_ms` (60 s) gets the backend killed and the following
commit fails with a disconnect.

### "Async" in the sense of deferred work

Ingest does its whole unit of work inside the request transaction: event log, items,
attempts, scores, pass scores, spans, trace statistics, ingest-completeness flag and
the best-run score index. Only the dashboard projection is deferred (transactional
outbox, `services/dashboard_outbox.py`). Analysis, rule inference, product evals,
retention and schema maintenance are jobs.

## 2. Operations with the highest lock time

Ranked by lock scope multiplied by how long it is held. The session defaults bound the
damage (`lock_timeout` 5 s, `statement_timeout` 30 s API / 300 s worker,
`idle_in_transaction_session_timeout` 60 s), but they turn a long wait into an error,
not into less contention.

1. **Ingest batch, `_ingest_events_sync` (`api/ingest.py:1494`).** `SELECT runs ... FOR
   UPDATE` on the run row for the whole batch: NDJSON parsing, event-log insert, ORM
   upserts of items/attempts/scores/pass scores, span bulk insert, trace-statistics
   refresh (`services/trace_statistics.py:231` takes the run lock again), the
   completeness flag, and for official runs `sync_run_scores`
   (`services/eval_run_scores.py:280`), which re-aggregates **every** score of the run
   on **every** scored batch, so the lock time per batch grows with the run and the
   total work over a run is quadratic in its item count. Waiting on this lock: review
   transitions (`services/run_review.py:69`), analysis saves (`_lock_run_for_save`),
   run delete, the dashboard worker's `publish_run_status`. The heartbeat fast path and
   the stale-run reconcile use `SKIP LOCKED`, so they do not queue.
2. **Dashboard partition transaction, `process_partition`
   (`services/dashboard_summaries.py:1959`).** Holds the partition row `FOR UPDATE` and
   the project's hour buckets (`_lock_buckets`, 180) while applying up to 500 events and,
   unless deferred, the live summary rebuild ("a dozen aggregate queries"). Ingest's
   `_upsert_partition` (`dashboard_outbox.py:324`) is an `ON CONFLICT DO UPDATE` on the
   same row, so an ingest commit waits behind the worker's partition transaction.
   Bucket rows are per project-hour: every run of a project writing in the same hour
   serializes on them.
3. **Bulk source mutations through the outbox hook, `_bulk_source_mutation`
   (`dashboard_outbox.py:722`).** Any Core `UPDATE`/`DELETE` on a source table first
   runs `SELECT id ... FOR UPDATE` on every matched row, reads the snapshot fields, then
   inserts one outbox row per row, in one transaction. Callers: dataset item edits
   fanning out to `run_items` (`api/datasets.py:1230`, 3555, 3763), repeat-pass deletion
   (`services/repeat_passes.py:246`, 303), guarded bulk stops (`eval_experiments.py:731`).
   Editing a dataset item used by 10 k runs locks 10 k item rows and writes 10 k outbox
   rows at once.
4. **Analysis saves (`api/analysis.py`).** Run lock, then chunked `FOR UPDATE` on item
   rows and pass scores (3134-3147, 3435, 3725/3738). The model call is before the locks
   (good), but the lock-to-commit window runs on the event loop, so any other blocking
   coroutine lengthens it.
5. **Maintenance `drop_legacy_spans` (`services/maintenance.py:1179`).** `LOCK TABLE runs
   IN SHARE MODE` and `spans IN SHARE MODE` for the verification anti-join: blocks every
   insert/update/delete on `runs` and `spans` for the scan. One-off, behind
   `QYM_MAINTENANCE_MODE`.
6. **Migrations.** 55 migration files create indexes; 8 build CONCURRENTLY or defer to
   `create_deferred_indexes`. A plain `CREATE INDEX` holds SHARE on the table (writes
   blocked) for the build. The chain is applied in deployments, so this is a rule for new
   migrations: any index on `runs`, `run_items`, `run_events`, `spans`, the score tables
   or `dashboard_*` goes through the deferred job above a size threshold, as 0098 and
   0101 do.
7. **Retention purge, `_purge_one` (`services/retention.py:329`).** Run row `FOR UPDATE
   SKIP LOCKED` held across all child batches (each batch its own transaction with a 5 s
   lock timeout). Minutes for a large run, but the run is deleted so nothing else wants
   the row; the final transaction locks the partition and the project's overview
   snapshots briefly.
8. **Live ingest.** `_source()` (`api/live_ingest.py:390`) locks the `live_sources` row
   `FOR UPDATE` per request, so every heartbeat, turn batch and event batch of one source
   serializes; `_upsert_turn` locks each turn row and flushes twice per turn;
   `live_events.ingest_events` locks and flushes per event.
9. **Experiment row, `recompute_experiment_status` (`services/eval_experiments.py`).**
   `FOR KEY SHARE` on the experiment at every dispatcher step of every job
   (`eval_dispatcher.py::_with_job`). A 64-job sweep funnels through one row.
10. **Dataset bulk edits (`api/datasets.py:3536`)** lock every item of a version;
    project-level `FOR UPDATE` in analysis rule publishing (`api/analysis.py:7869`,
    10325) serializes per project.

## 3. Most intensive writes and how to reduce them

Ranked by rows and index entries written per unit of product activity.

### 3.1 Ingest (`POST /v1/runs/{id}/events`)

Per batch of N events for a run with M metrics, the request writes:

| Table | Rows | Index entries per row (after 0051/0101) | Note |
|---|---|---|---|
| `run_events` | N | 4 (PK, `uq(run_id,event_id)`, `uq(run_id,sequence)`, `(run_id,type,sequence)`) | JSONB payload; `event_log_mode` defaults to `full`, so item inputs/outputs are stored twice (event log and `run_items`). |
| `run_items` | items | 6 (PK, `uq_run_item`, `run_id`, `(run_id,index)`, `(run_id,trace_id)`, `dataset_item_pk`) | `ix_run_items_run_id` is a prefix of two other indexes. |
| `run_item_attempts` | attempts | 4 | `ix_run_item_attempts_run_id` is a prefix of `(run_id,item_id)`. |
| `run_item_scores` | items × M | 5 (PK, uq, three single-column indexes) | `ix_run_item_scores_run_id` is a prefix of the unique. |
| `run_item_pass_scores` | items × M × passes | 4 incl. the covering index | |
| `spans` | spans | 4 incl. the covering index, per daily partition | Core bulk insert (good). |
| `run_trace_summaries` / `run_trace_contributions` | 1 + touched traces | | The `totals` JSON document is rewritten every batch (TOAST churn). |
| `runs` | 1 | **15 indexes** | `touch_run_event` sets `last_event_at` on every batch and `ix_runs_last_event_at` exists, so each batch's run update is non-HOT and inserts into all 15 indexes. `run_metadata` JSON also rewrites. |
| `dashboard_change_events` (+ causes) | about one per changed source row | 4 | Outbox: roughly doubles the row count of a batch. |
| `dashboard_partition_state` | 1 upsert | 2 | waits on the worker's partition lock (section 2). |
| `eval_run_scores` | delete + M upserts | | official runs only, every scored batch. |

Reductions, in order of payoff per effort:

- **Stop re-aggregating the run on every batch.** Call `sync_run_scores` from ingest only
  when the run is terminal (the dispatcher's `sync_job_scores` already covers the job
  side). Removes the quadratic work and the longest part of the run lock.
- **Make the per-batch `runs` update HOT.** Either drop `ix_runs_last_event_at` (the stale
  sweeps order by a coalesce over three columns, so the index serves little) or move
  liveness to a narrow side row (the partition-state row already changes per batch).
  Add `fillfactor=80` on `runs`. Same reasoning for `eval_experiment_jobs`: its
  `next_attempt_at` is indexed and rewritten every poll.
- **Drop prefix-redundant indexes** after confirming zero scans in
  `pg_stat_user_indexes`: `ix_run_items_run_id`, `ix_run_item_attempts_run_id`,
  `ix_run_item_scores_run_id`, and probably `ix_run_item_scores_item_id` /
  `ix_run_item_scores_metric_name` (used only through `(run_id, …)` paths).
- **Coalesce outbox rows per batch.** One batch produces several snapshots of the same
  item (item, attempt, score, pass score); the worker only needs the last numeric state
  per (partition, item, metric, pass). Deduplicate in `_after_flush` before
  `enqueue_snapshots`, and skip attempt snapshots that carry no numeric change.
- **`event_log_mode=structural` in production** (settings default is `full`): halves
  event-log bytes and TOAST writes for runs with large inputs/outputs.
- **Incremental trace totals.** Keep contributions as rows (they are) and recompute the
  `totals` JSON only at `run_completed` or every k batches, not every batch.
- **Larger SDK batches** amortize the fixed per-batch writes (run row, partition upsert,
  trace summary, score index). The body cap already allows it.

### 3.2 Dashboard projection worker

Writes about as many rows as ingest: per change event an upsert into
`dashboard_record_state` (**6 indexes**), its cause rows, bucket rollups and histograms,
and a JSON rewrite of `dashboard_run_summaries` / `dashboard_run_dimensions`. Every
tick (1 s when idle) also runs `prune_dashboard_state` and, per minute,
`prune_dashboard_events`, whose deletes feed the bloat that
`docs/internal/OPERATIONS.md` already tunes autovacuum for.

- Coalescing at the outbox (3.1) cuts this proportionally.
- `MAX_LATE_EVENT_AGE` is 30 days: published outbox rows and tombstones live a month.
  7 days keeps the two biggest churn tables and their indexes several times smaller.
- The live summary rebuild interval (`QYM_DASHBOARD_LIVE_REFRESH_SECONDS`, 2 s) is the
  knob for heavy ingest; 5-10 s is enough for a list page.

### 3.3 Eval dispatcher polling

Per running job per poll (10 s for the first 5 min, 30 s to 30 min, then 60 s): claim
compare-and-set `UPDATE`, lease renew `UPDATE`, a `FOR UPDATE` read, and the release
`UPDATE` (lease columns cleared, `updated_at` flagged), plus `recompute_experiment_status`
reading every job of the experiment. Three row versions of `eval_experiment_jobs` per
poll with nothing changed; `next_attempt_at` is indexed, so none are HOT. With a 64-job
sweep at the 10 s phase that is about 20 non-HOT updates per second.

- Claim and renew in one statement; skip the release write when the lease would expire
  before the next poll anyway, or keep the lease across polls.
- Recompute the experiment status only when a job's status changed.
- Longer first-phase poll (20-30 s) once the service's queue position is known.

### 3.4 Heartbeats and job registries

- `background_jobs`: a JSON snapshot rewrite every 0.5 s (`FLUSH_SECONDS`) and a
  heartbeat every 2 s per active analysis job (`services/job_registry.py:54`). 2-5 s is
  plenty for a progress bar polled every few seconds.
- `service_heartbeats`: upsert plus a prune `DELETE` every 10 s per process; prune once
  a minute instead.
- Dashboard worker idle tick: five SELECTs and two prune statements every second with
  nothing to do; back off to 5 s after a few idle ticks.

### 3.5 Live ingest

Per turn: a `FOR UPDATE` select, two `DELETE`s (scores, chart images), the turn
upsert (5 indexes), one `INSERT` per score, and two flushes; per worker event a locked
select and a flush. Batch the score inserts (Core `insert(...).values(rows)`), skip the
deletes for newly created turns, flush once per batch.

### 3.6 Analysis saves

`_save_analysis_results` / `_save_pass_analysis_results` rewrite the whole `meta` JSON of
every analysed pass score. Fine per run, but the `background_jobs` snapshot churn above
runs beside it for the job's whole duration.

### 3.7 Already good (keep)

Core bulk inserts for events and spans; `SKIP LOCKED` on every worker claim; daily span
partitions; keyset batch purges with their own transactions; the outbox instead of
synchronous dashboard updates; covering indexes (0101); separate worker pool;
statement, lock and idle timeouts; threadpool capped to the pool.

## 4. Suggested order of work on this branch

Done so far: the async driver path and the handler fixes (section 1), the ingest
write batch size (`QYM_INGEST_WRITE_BATCH_SIZE`) and the dashboard worker batch
settings (`QYM_DASHBOARD_WORKER_*`, section 3.2), all documented in OPERATIONS.md.

1. `sync_run_scores` only on terminal runs (ingest tail, `api/ingest.py:2786`).
2. (done) Move the analysis and environment async handlers' DB work off the loop
   and close the request session before awaiting probes.
3. Outbox coalescing in `_after_flush`.
4. `runs` HOT update: drop `ix_runs_last_event_at` (deferred `DROP INDEX CONCURRENTLY`)
   and set `fillfactor`; same for `eval_experiment_jobs`.
5. Redundant index drops after a `pg_stat_user_indexes` check on the deployed database.
6. Cadence changes: job registry flush/heartbeat, heartbeat prune, idle back-off,
   dispatcher lease writes.
7. `MAX_LATE_EVENT_AGE` 30 → 7 days and `event_log_mode=structural` as deployment
   defaults (documented in OPERATIONS.md).
