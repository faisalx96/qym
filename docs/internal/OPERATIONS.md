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

## Evaluation Service experiments

This section is the runbook for Evaluation Service experiments: remote deployments
("environments") that qym launches evaluation jobs on. The user-facing workflow is in
the [Platform User Guide](../../packages/platform/docs/USER_GUIDE.md#experiments-evaluation-service).
The service's HTTP contract is in
[`evaluation-service-api-integration.md`](../evaluation-service-api-integration.md).
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
`max_inflight_jobs` (default 5), `default_priority` and `max_priority` (default
`NORMAL`), `allow_connection_keys` (default off; reset when the URL changes).

### Deploying the release

The Evaluation Service tables come in migrations `0060`–`0064` on top of `0059`:

| Migration | Adds | Startup cost |
|---|---|---|
| `0060` | `eval_environments`, `eval_environment_schemas`, `eval_model_slots`; `project_llm_connections.available_for_experiments` | New tables and a constant-default column: instant |
| `0061` | `eval_experiments`, `eval_experiment_jobs`, `eval_remote_queue_snapshots`; `runs.origin` (default `local`, indexed) and `runs.experiment_job_id` | The `origin` column uses a constant default (no rewrite on PostgreSQL 11+), but its CHECK constraint and index scan `runs` once |
| `0062` | `eval_config_presets`, `eval_config_preset_versions` | New tables: instant |
| `0063` | `eval_experiment_jobs.attempt` and `retry_of_job_id`; per-attempt unique key | Small table |
| `0064` | `eval_run_scores` (best-run index, created empty); `eval_experiment_jobs.run_linked_at` | New table: instant |

Steps:

1. Set `QYM_LLM_CONFIG_ENCRYPTION_KEY` on every API and worker process (if it isn't
   already set for LLM connections), plus any `QYM_EVAL_*` overrides.
2. Deploy the image. The API applies migrations up to `0064` before it reports ready,
   as for every release. A split worker starts after the API, with
   `QYM_SKIP_MIGRATIONS=1`. On a large `runs` table, time the `0061` scan on a
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

Rollback: `alembic downgrade` below `0061` drops `runs.origin` and every experiment
row. `0063`'s downgrade keeps only the latest attempt of each combination. Prefer a
forward fix once experiments have run.

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
   env-overrides schema, and proposes model slots. The URL must be `https://` unless
   `QYM_ALLOW_PRIVATE_LLM_BASE_URLS` is set.
4. Confirm the model slots (**Group LLM settings**) and, if the service may receive
   provider keys, turn on **Allow connection keys**.

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

**Inflight cap.** A job occupies a slot on its environment while it is `SUBMITTING`,
`SUBMITTED`, `RUNNING` or `CANCELLING`. `QUEUED → SUBMITTING` is one conditional
`UPDATE` that re-counts the slots (under a lock on the environment row on PostgreSQL),
so several pods never exceed `max_inflight_jobs`. A job over the cap waits with
`Inflight cap n/cap` and is rechecked every 10s. The cap only counts qym's own jobs.

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
  (the service's 7200s hard limit plus margin) becomes `TIMED_OUT`. The clock only
  runs while the job is `RUNNING` and qym can observe it: a job still `PENDING` on
  the service (`SUBMITTED`) never times out, and neither does one whose service is
  unreachable or paused.

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
(`… gave up after 2h15m`), because the service's hard limit has ended the remote job
either way and the job should stop holding an inflight slot. After a remote cancel, the
linked run is marked `STOPPED` with `status_reason = cancelled_from_queue`, unless it
already ended; a killed worker never sends a terminal event.

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
2. Check the Queue page's **Remote queue**. If the remote job is still listed there
   as `RUNNING`, it still holds a service worker, but qym no longer counts it against
   the inflight cap. qym cannot stop it: the job is terminal, so the queue cancel
   answers `already_terminal`, and the orphan cancel refuses it (`refused_local_job`)
   because it matches a local job. Cancel it on the service directly:
   `curl -X POST "$BASE_URL/evals/<remote_job_id>/cancel" -H "Authorization: Bearer $EVAL_API_KEY" -H "Content-Type: application/json" -d '{"user_id": "<your qym user id>"}'`
   (API guide §3.5).
3. **Retry** once the service is healthy.

The same applies to a job that the dispatcher cancelled after giving up on the remote
cancel (`… gave up after 2h15m`).

**Jobs that do not move** (not blocked):

| `wait_reason` | Meaning | Action |
|---|---|---|
| empty on a `QUEUED` job | No dispatcher has claimed it | Check that a process with `QYM_ROLE=all` or `worker` runs, and its logs for `eval dispatcher tick failed` |
| `Inflight cap n/cap` | The environment has `max_inflight_jobs` jobs in flight | Wait, cancel something, or raise the cap |
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

### Orphans

The **Remote queue** on the Queue page lists each active environment's `PENDING` and
`RUNNING` remote jobs from the latest snapshot. A remote job whose id matches no local
job of any status is an **orphan**. Common causes:

- a job whose `POST /evals` answer was lost is `SUBMITTING` without a `remote_job_id`
  until reconcile adopts it. Its remote job shows as an orphan meanwhile. This clears
  itself within a few minutes;
- jobs submitted to the service by something other than this qym (see D8 below), or
  by a qym database that was since restored from a backup;
- jobs created before the integration.

Only project managers can cancel orphans (**Cancel selected orphans**, or
`POST /v1/projects/{pid}/eval-queue/remote/cancel` with up to 200 ids). The call goes
straight to the service with the manager's user id. Ids that match a local job are
refused (`refused_local_job`: cancel those through the normal queue cancel, which keeps
the job, run and experiment consistent), and ids that are not in the latest snapshot
are refused (`not_in_snapshot`). Every id sent is audit-logged as
`eval_remote_job.cancel`. Cancelling the orphan of a job still being reconciled is safe:
reconcile adopts the remote job and the next poll records it as `CANCELLED`.

A snapshot shows "fetched … ago". `fetch_error` means the last refresh failed and the
items are from the last success. A paused (401) environment is not called; its snapshot
only records why.

### Assumption D8: qym is the service's only caller

The Evaluation Service has no job ownership: any holder of `EVAL_API_KEY` can list and
cancel every job. qym relies on being the **only** caller of each environment:

- the remote snapshot filters by status only, not by `user_id`, so every remote job is
  shown and any job qym doesn't know is an orphan that a manager may cancel;
- the inflight cap counts qym's jobs only, so other callers' jobs make the service
  slower without qym backing off;
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
cancel, and the inflight cap held in every run. On PostgreSQL, pod count barely changes
drain time because the inflight caps are the bottleneck. Reproduce with
`python tests/platform/eval_dispatch_loadtest.py --workers 8 --faults` (set
`QYM_TEST_POSTGRES_URL` for PostgreSQL). The experiment status recompute is shared by
the API (cancel, retry) and the dispatcher and locks the experiment row on PostgreSQL,
so a queue cancel racing the dispatcher settling the last job still settles the
experiment (`test_eval_dispatcher_concurrency.py::test_queue_cancel_racing_a_dispatcher_settle_settles_the_experiment`).
