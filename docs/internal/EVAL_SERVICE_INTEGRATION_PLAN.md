# Evaluation Service Integration Plan

Status: proposal · Branch: `experiments-platform` · Source contract:
[`docs/evaluation-service-api-integration.md`](../evaluation-service-api-integration.md)

## 1. Goal

Let qym users launch evaluations on one or more external **Evaluation Service**
deployments ("environments") from the platform, tune them through an advanced
config form generated from each environment's `env_overrides` schema, sweep any
field over several values, bind LLM endpoints to platform-defined models, and see
the resulting runs clearly separated as **official** (launched by the platform)
vs **local** (anything else sent through the SDK).

### Requirements → design mapping

| Requirement | Design element |
|---|---|
| Multiple environments, same API contract | `eval_environments` table + one `EvalServiceClient` (§4, §5) |
| Advanced config generated from env overrides | Schema cache per environment → normalized form descriptor (§6) |
| Every field supports multiple values (sweep) | Sweep spec with `{"sweep": [...]}` value wrappers, grid/zip expansion (§7) |
| Pick api_keys, urls, model names inside overrides | Endpoint binding widgets: platform model, custom (encrypted), or literal (§8) |
| Choose models from platform-defined models | Reuse `ProjectLlmConnection` as the model catalogue (§8) |
| Official vs local runs | `runs.origin` + verified launch token on ingest (§9) |

### What already exists and is reused

- `ProjectLlmConnection` (`db/models.py:363`) — named base_url/model/encrypted key per
  project, CRUD + `/test` in `api/projects.py:489-650`. This **is** the "platform
  defined models" catalogue.
- `secrets.py` — Fernet encryption keyed by `QYM_LLM_CONFIG_ENCRYPTION_KEY`.
- `llm_endpoint_security.py` — URL validation / SSRF checks for outbound calls.
- `worker.py` + `MaintenanceJob` lease pattern (`lease_owner`/`lease_until`) — model for a
  durable, multi-process-safe background dispatcher.
- Ingest `POST /runs` (`api/ingest.py:750`) — already accepts `run_metadata`; the hook
  point for linking official runs.
- Native datasets + aliases — dataset picker for `evaluator.dataset`/`dataset_version`.

The existing Product Eval API (`services/product_evals.py`) is **not** reused: it runs
the SDK in-process with process-local job state. This integration is the opposite
direction (qym is the *client* of a remote runner) and must be DB-backed.

## 2. Architecture

```
 Browser ──► qym API ──(1) create experiment + jobs (DB, status=QUEUED)
                         │
                qym worker: EvalDispatcher (leased loop)
                         │ (2) POST {env}/evals  (Bearer env key)
                         │ (3) GET  {env}/evals/{id}  poll
                         ▼
             Evaluation Service env A / env B / ...
                         │ Celery worker runs qym SDK, live_mode=platform
                         │ run_metadata.qym_launch = {job_id, token}
                         ▼
 qym ingest POST /runs ──(4) verify token + env ingest key → origin=official,
                              link run ↔ experiment job, move to launch project
```

Two status sources are merged per job: the remote job status (coarse, has known gaps)
and the linked qym run lifecycle (rich, live, has stale detection). §10 defines the merge.

## 3. Dependencies / asks for the Evaluation Service team

These gaps in the service contract change the platform design; raise them first.

| # | Gap (guide §) | Impact | Ask | Platform fallback |
|---|---|---|---|---|
| D1 | `env_overrides` returned verbatim in `EvalJobRead` incl. `LLM_OVERRIDES.*.api_key` (§5) | Provider keys stored in plaintext on the service and readable by anyone with `EVAL_API_KEY` via `GET /evals` | Redact `api_key` in responses; ideally encrypt at rest | Never persist remote responses unredacted; redact on read |
| D2 | `FAILED` never written; jobs stick at `RUNNING` (§6) | Can't detect failure | Uncomment `_finish(FAILED)` | Merge with qym run status + 2h15m hard timeout (§10) |
| D3 | `started_at`/`finished_at`/`exit_code` stripped (§5) | Weak timing | Add to `EvalJobRead` | Use linked run timestamps |
| D4 | Runs reach qym under the service's own `QYM_API_KEY` project (`platform_*` server-owned, §4.2) | Runs land in the wrong project | Accept a per-job target project, or keep one service key per env | Ingest re-homes the run by launch token (§9) |
| D5 | `HIGH` priority kills every other user's jobs (§2.1) | One qym user can wipe others' runs | Nothing required | Gate `HIGH` by env policy + project role (§5.3) |
| D6 | `metrics` not selectable (§4.1) | No metric picker | Re-enable field | Hide metric selection for now |
| D7 | No ownership on cancel / list (§3.2, §3.5) | Cross-tenant visibility | Nothing required | Platform only ever acts on job ids it created |

## 4. Data model (migration `0058_eval_service_integration`)

### 4.1 `eval_environments`

| Column | Type | Notes |
|---|---|---|
| `id` | str(36) PK | |
| `project_id` | FK projects | environments are project-scoped |
| `name` | str(200) | unique per project |
| `base_url` | str(500) | full prefix incl. `EVAL_SERVER_PREFIX`, without `/evals` |
| `api_key_encrypted` / `api_key_last4` | text / str(8) | `EVAL_API_KEY`, via `secrets.py` |
| `ingest_api_key_id` | FK api_keys, nullable | the qym key the service uses to stream runs back (§9) |
| `default_priority` | enum LOW/NORMAL/HIGH | default `NORMAL` |
| `max_priority` | enum | default `NORMAL`; `HIGH` requires project admin to set |
| `max_inflight_jobs` | int | dispatcher throttle per env, default 5 |
| `allow_platform_model_keys` | bool | opt-in to send decrypted connection keys to this env |
| `schema_json` / `schema_hash` / `schema_fetched_at` | json / str(64) / datetime | cache of `GET /evals/env-overrides/schema` |
| `health_status` / `health_checked_at` / `health_error` | str / datetime / text | from `/test` |
| `is_active`, `created_by_user_id`, `created_at`, `updated_at` | | |

Schema history: keep an `eval_environment_schemas(environment_id, hash, schema_json,
fetched_at)` row per distinct hash so every job pins the exact schema it was validated
against (`schema_hash` on the job).

### 4.2 `eval_experiments` (one launch = one sweep, possibly across envs)

| Column | Notes |
|---|---|
| `id`, `project_id`, `created_by_user_id`, `name`, `description` | |
| `spec` | JSON, the sweep spec (§7) with secrets replaced by `{"$secret": "<path>"}` refs |
| `secrets_encrypted` | Fernet blob `{path: value}` for custom api_keys typed in the form |
| `priority` | requested priority |
| `status` | derived aggregate: `QUEUED/RUNNING/COMPLETED/PARTIAL/FAILED/CANCELLED` |
| `job_count`, `created_at`, `updated_at`, `cancelled_at`, `cancelled_by_user_id` | |

`secrets_encrypted` is cleared once every job is terminal (retry needs re-entry of
custom keys; platform-model keys are always re-resolved from the connection).

### 4.3 `eval_experiment_jobs` (one expanded combination × one environment)

| Column | Notes |
|---|---|
| `id` PK, `experiment_id`, `environment_id`, `combo_index` | |
| `params` | JSON: the swept values for this combo, redacted, used as labels/chart dimensions |
| `request_body` | JSON `EvalJobCreate` with secrets as refs (resolved only at dispatch) |
| `schema_hash` | schema version it was validated against |
| `launch_token_hash` | sha256 of the one-time link token (§9) |
| `remote_job_id` | UUID from `POST /evals` |
| `remote_status` | last seen PENDING/RUNNING/SUCCEEDED/FAILED/CANCELLED |
| `status` | platform status (§10) |
| `run_id` | FK runs, nullable, set on ingest link |
| `result` | JSON `result` from the service (pass_at_k, consistency, ...) |
| `error`, `submit_attempts`, `next_attempt_at`, `lease_owner`, `lease_until`, `submitted_at`, `last_polled_at`, `finished_at` | |

Index `(status, next_attempt_at)` for the dispatcher; unique `(experiment_id, environment_id, combo_index)`.

### 4.4 `runs` additions

- `origin` — enum `local | official`, `server_default='local'`, indexed. All existing runs
  backfill to `local`.
- `experiment_job_id` — FK nullable, `ON DELETE SET NULL`.

## 5. Environments

### 5.1 API (`api/eval_environments.py`, project admin for writes, members read)

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/projects/{pid}/eval-environments` | list (keys shown as `••••last4`) |
| POST | `/v1/projects/{pid}/eval-environments` | create; fetches schema immediately |
| PUT | `/v1/projects/{pid}/eval-environments/{eid}` | update; blank api_key keeps existing (same rule as LLM connections) |
| DELETE | `…/{eid}` | soft-disable if it has jobs, hard delete otherwise |
| POST | `…/{eid}/test` | `GET /evals?limit=1` (auth) + schema fetch; stores health |
| GET | `…/{eid}/schema?refresh=true` | cached raw schema + hash |
| GET | `…/{eid}/form` | normalized form descriptor (§6) |

### 5.2 Client (`services/eval_service_client.py`)

Thin `httpx` wrapper, one instance per environment: `submit`, `get`, `cancel`, `list`,
`env_overrides_schema`. Maps `401→EnvAuthError`, `409→HighPriorityActive | NotCancellable`
(parsed from `detail`), `422→RequestRejected(detail)`, `404→RemoteNotFound`,
transport errors → retryable. Timeouts 10s connect/30s read. Base URL validated with
`validate_llm_base_url` rules (https required unless `QYM_ALLOW_PRIVATE_LLM_BASE_URLS`),
because decrypted provider keys are sent to it.

### 5.3 Priority policy

- Request priority must be `<= environment.max_priority`.
- `HIGH` additionally requires project admin and an explicit confirmation flag in the
  request (`acknowledge_preemption: true`); the UI shows "This kills every running
  LOW/NORMAL job on *env* for all users".

## 6. Advanced config form from the env-overrides schema

`services/eval_schema_form.py` turns the raw JSON Schema into a UI-ready descriptor so
the frontend never interprets `$ref`/`anyOf` itself:

1. Resolve `$ref`s against `$defs`; collapse `anyOf[X, null]` to `X` + `nullable`.
2. Emit a flat, ordered field list with JSON-pointer paths, e.g.
   `/MILVUS_SEARCH_THRESHOLD`, `/LLM_OVERRIDES/endpoints/{name}/model`,
   `/LLM_OVERRIDES/main/temperature`.
3. Per field: `type` (bool/int/number/string/enum/object/map), `enum`, `minimum`/`maximum`,
   `default`, `description`, `nullable`, `sweepable` (every scalar = true), and a `widget`:
   - `boolean` for toggles (service also accepts `"true"/"1"/"yes"`; platform always sends real booleans),
   - `enum` for `TABLE_SELECTION_MODE`, `reasoning_effort`, …,
   - `number-range` when both bounds exist (`MILVUS_SEARCH_THRESHOLD`, `CONTEXT_COMPACT_THRESHOLD`),
   - `endpoint` for any object matching `$defs/EndpointConfig` (§8),
   - `endpoint-ref` for `RoleConfig.endpoint` (dropdown of endpoint keys defined in the same form),
   - `secret` for any string property named `api_key` / `*_API_KEY`,
   - `url` for `base_url` / `*_URL`,
   - `model-name` for `model` / `*_MODEL` strings (e.g. `VIZ_LLM_MODEL`) — free text with
     suggestions from platform models.
4. Group for display by the guide's categories (LLM routing, feature toggles, table
   selection/RAG, SQL, context, visualization, misc); unknown new fields fall into
   "Other" automatically, so a schema change on the service needs no qym release.

Detection is structural first (`$defs` name), name-based second. Keep the name rules in
one table so they are easy to extend.

**Multiple environments in one launch:** the form renders the **union** of the selected
environments' fields. A field missing from an environment's schema is badged
"not supported by *env*"; setting it to a non-default value blocks that environment at
validation time (clear error rather than a silent 422 at dispatch).

**Evaluator config** (`EvaluatorRequestConfig`, guide §4.2) is not in the served schema,
so qym ships a static descriptor for it with the same widget/sweep semantics:
`samples`, `report_k`, `max_concurrency`, `max_metric_concurrency`, `timeout`,
`metric_timeout`, `max_retries`, `metric_max_retries`, `git_branch`, `git_commit`.
Platform-owned (not editable): `run_name` (generated), `run_metadata` (carries the launch
token), `live_mode` (forced `"platform"`), `model`/`models` (derived from bindings).
Ask the service team to expose `EvaluatorRequestConfig` via a schema endpoint too, then
generate it the same way.

## 7. Sweeps

### 7.1 Spec format (request body of `POST /v1/projects/{pid}/experiments`)

```jsonc
{
  "name": "rag-threshold-vs-model",
  "environment_ids": ["env-staging", "env-perf"],
  "priority": "NORMAL",
  "sweep_mode": "grid",                       // "grid" (cartesian) | "zip" (paired, equal lengths)
  "evaluator": {
    "dataset": {"name": "playground_set_v2", "alias": "production"},
    "config": {
      "samples": {"sweep": [1, 3]},
      "max_concurrency": 5
    }
  },
  "env_overrides": {
    "TABLE_SELECTION_MODE": {"sweep": ["rag", "llm_direct"]},
    "MILVUS_SEARCH_THRESHOLD": {"sweep": [0.5, 0.7, 0.9]},
    "LLM_OVERRIDES": {
      "endpoints": {
        "primary": {
          "binding": {"sweep": [{"platform_model": "conn-gpt4o"}, {"platform_model": "conn-qwen"}]},
          "timeout": 60, "max_attempts": 3
        },
        "fast": {"binding": {"custom": {"model": "gpt-4o-mini", "base_url": "https://…", "api_key": {"$secret": "k1"}}}}
      },
      "main":   {"endpoint": "primary", "temperature": {"sweep": [0, 0.2]}},
      "router": {"endpoint": "fast"}
    }
  },
  "dry_run": false
}
```

Value forms at any scalar (or endpoint binding) position:
- literal → fixed value,
- `{"sweep": [v1, v2, …]}` → sweep axis (values individually validated),
- `{"$secret": "<id>"}` → reference into the request's `secrets` map (never echoed back).

Numeric fields also accept a range helper in the UI (`start/stop/step`) that is expanded
client-side into an explicit list, so the stored spec is always explicit.

### 7.2 Expansion and validation (`services/eval_sweeps.py`)

1. Collect sweep axes with their JSON-pointer paths.
2. `grid`: cartesian product; `zip`: all axes must have equal length.
   Optional `link` groups (paths that move together inside a grid) cover cases like
   "model X always with temperature Y".
3. Multiply by environments: `jobs = combos × len(environment_ids)`.
4. Hard cap `QYM_EVAL_SWEEP_MAX_JOBS` (default 64); the UI shows the live count and
   blocks over-cap submits.
5. For each (combo, environment): materialize the concrete `EvalJobCreate` with
   placeholder secrets, strip nulls, and validate with `jsonschema` (Draft 2020-12)
   against that environment's cached schema, plus the service's cross-field rules
   mirrored locally: `endpoints` non-empty and contains `primary`; every role
   `endpoint` references an existing key; effective `report_k <= samples`.
6. `dry_run: true` returns the expanded matrix (params per job, per-env errors, count)
   without persisting — powers the "Preview N runs" panel.

### 7.3 Run naming and labels

- `run_name`: `"{experiment.name} · {short param label}"`, e.g.
  `rag-threshold-vs-model · primary=gpt-4o thr=0.7 mode=rag k=3` (truncated, stable order).
- `evaluator.model`: the bound primary model name, so qym's Models page groups correctly.
- `run_metadata.qym_launch = {experiment_id, job_id, environment, params, token}` —
  `params` (redacted) becomes queryable dimensions for comparisons.

## 8. Endpoint bindings and platform models

An `endpoint` widget (any `EndpointConfig`) has a **binding** that supplies
`model` + `base_url` + `api_key` together, plus freely editable transport fields
(`timeout`, `max_attempts`, `max_connections`, `max_keepalive`, `connect_timeout`):

| Binding | Source | Stored as | Resolved |
|---|---|---|---|
| `platform_model` | a `ProjectLlmConnection` id | connection id | at dispatch: decrypt key, read current model/base_url |
| `custom` | user-typed model/base_url/api_key | model/base_url literal, key in `secrets_encrypted` | at dispatch |
| `inherit` | leave the endpoint out | nothing | service defaults |

Rules:
- Sweeping models = sweeping the `binding` of an endpoint (usually `primary`), so a sweep
  over three platform models yields three runs.
- A `platform_model` binding is only allowed when the environment has
  `allow_platform_model_keys = true` (admin opt-in: keys leave qym).
- `model-name` string fields (`VIZ_LLM_MODEL`, role-less model strings) offer platform
  models as suggestions but store only the model name.
- Add optional `ProjectLlmConnection.usable_in_experiments` (bool, default true) and
  `display_label`; the `/llm-connections` list already gives the picker everything else.
- Dispatch re-resolves connections each time, so a rotated key is picked up on retry;
  a deleted connection fails that job with `binding_missing` before submit.

## 9. Official vs local runs

**Definition.** A run is *official* only if it was produced by a job the platform
dispatched to a registered environment and the link was verified on ingest. Everything
else — SDK runs from laptops, CI, or anyone copying metadata — is *local*.

**Link protocol.**
1. At dispatch the worker generates a random 32-byte `token`, stores
   `sha256(token)` on the job, and sends `run_metadata.qym_launch.token = token`.
2. In `create_run` (`api/ingest.py:750`), if `run_metadata.qym_launch` is present:
   - look up the job by `job_id`; require `sha256(token) == launch_token_hash`,
     `job.run_id IS NULL` (one-time), and — when the environment has
     `ingest_api_key_id` — that the principal's key id matches it;
   - on success: `origin=official`, `experiment_job_id=job.id`,
     `project_id=experiment.project_id` (fixes D4), `owner_user_id=experiment.created_by_user_id`
     (keep `created_by_user_id` as the service principal for audit), set `job.run_id`;
   - always **strip `token`** from stored `run_metadata`;
   - on any mismatch: store as `local`, keep `qym_launch` minus token, log a warning.
3. Since ingest is authenticated by the env's key, a local user cannot mint official runs
   without both a live token and that key.

**Behaviour differences.**
- Runs list / Overview / Models / Compare get an **Origin** facet (Official / Local / All)
  and an "Official" badge; project setting `default_run_origin_filter` (default All).
- Official runs show an "Experiment" panel: environment, swept params, remote job id,
  service `result` (pass@k, consistency, reliability), link back to the experiment.
- Official runs cannot be renamed or soft-deleted by non-admins; deleting an experiment
  does not delete runs (FK set null).
- `origin` is added to `/api/runs` filters, `qym run list --origin`, and SDK `run list`.

## 10. Dispatcher and status model

`services/eval_dispatcher.py` → `EvalDispatcher` thread started from `worker.py` (and the
API process when `QYM_ROLE=all`), mirroring `MaintenanceWorker`. Jobs are claimed with
`SELECT … FOR UPDATE SKIP LOCKED` + lease, so multiple worker pods are safe.

Platform job statuses:

```
QUEUED ──submit──► SUBMITTED ──remote RUNNING or run linked──► RUNNING ──► SUCCEEDED
   │  ▲               │                                           ├──► FAILED
   │  └─ 409 HIGH active / transport error: backoff, stay QUEUED  ├──► CANCELLED
   ├──► BLOCKED (validation/binding error, needs user)            └──► TIMED_OUT
   └──► CANCELLED
```

Loop (every 5s tick, per-job `next_attempt_at`):
- **Submit** `QUEUED` jobs while env inflight `< max_inflight_jobs`. Resolve secrets in
  memory only. `202` → `SUBMITTED` + `remote_job_id`. `409 HIGH active` → backoff
  (30s → 5m) and surface "waiting: HIGH job on env". `422` → `BLOCKED` with the
  field errors mapped back to form paths. `401` → mark environment unhealthy, pause its jobs.
  Idempotency: persist a `submitting` marker before the call; if the worker dies mid-call,
  the reconcile step lists `GET /evals?user_id=<qym user>` and matches by
  `eval_input.config.run_metadata.qym_launch.job_id` before resubmitting.
- **Poll** non-terminal submitted jobs: 10s for the first 5 min, then 30s, then 60s.
  Store `remote_status`; on `SUCCEEDED` store `result` (redacted per D1).
- **Merge** with the linked run: linked run `completed/failed/stopped` is authoritative
  for failure/stop even if the service still says `RUNNING` (D2).
  `RUNNING` with no remote change and no run events for 2h15m (Celery hard limit 7200s
  + margin) → `TIMED_OUT`.
- **Cancel**: `POST /evals/{id}/cancel` with `user_id = qym user id`; `409` already
  terminal → just re-poll. Experiment cancel = cancel all non-terminal jobs; queued jobs
  are cancelled locally without calling the service.
- **Retry**: `POST …/jobs/{jid}/retry` clones the job (new token, new row), keeping the
  old one for history.
- `user_id` sent to the service = qym user id of the experiment creator.

Experiment aggregate status is recomputed after each job transition.

## 11. Experiments API (`api/experiments.py`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/projects/{pid}/experiments` | create (or `dry_run` preview) |
| GET | `/v1/projects/{pid}/experiments` | list, filter by status/env/creator |
| GET | `/v1/projects/{pid}/experiments/{xid}` | detail + job matrix + linked run summaries |
| POST | `…/{xid}/cancel` | cancel all |
| POST | `…/{xid}/jobs/{jid}/cancel` / `/retry` | per job |
| POST | `…/{xid}/clone` | prefill the launch form from an existing spec (secrets excluded) |

Permissions: project members may launch at `<= NORMAL`; admins required for `HIGH`
and for environment management. Rate limit per user on create.

## 12. UI (frontend source → `_static/app`; follow `docs/DESIGN_LANGUAGE.md`)

1. **Settings → Environments**: table (name, URL, health, schema fetched, priority cap,
   inflight cap), add/edit dialog (URL, key, ingest key picker, policies), Test button,
   "Refresh schema" with a diff of added/removed fields.
2. **Experiments → New**:
   - step 1: environments (multi-select, health shown), dataset + version/alias picker,
     priority;
   - step 2: *Models* — endpoint cards (`primary` first) with binding picker
     (platform model dropdown with multi-select to sweep / custom / inherit); roles table
     with endpoint dropdown and sampling params;
   - step 3: *Advanced* — generated form grouped by category, search box, "changed only"
     toggle; every sweepable field has a "＋ values" affordance turning it into chips;
   - side panel: live **run preview** (from `dry_run`): count, per-env validation errors,
     generated run names; submit disabled over cap.
3. **Experiment detail**: matrix (rows = combos, columns = environments), cell = status +
   headline metric, click → run; bulk "Compare selected"; cancel/retry; param-vs-metric
   chart using `params` dimensions.
4. **Runs list**: Origin facet + badge; experiment column.

## 13. Security checklist

- Environment keys and custom provider keys: Fernet via `secrets.py`; never returned,
  never logged (`_safe_error`-style redaction in the client), never in `spec`/`params`.
- Refuse environment creation when `QYM_LLM_CONFIG_ENCRYPTION_KEY` is unset (same as
  LLM connections).
- https-only environment URLs unless `QYM_ALLOW_PRIVATE_LLM_BASE_URLS`.
- Platform-model keys only to environments with explicit opt-in.
- Redact `env_overrides.LLM_OVERRIDES.endpoints.*.api_key` in anything read back from
  the service before storing/returning (D1).
- Launch token one-time and stripped from stored metadata.
- `HIGH` gated by policy + role + acknowledgement.

## 14. Phasing

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0** | Raise D1–D7 with service team; agree on D4 (project routing) | Written answers; D1/D2 scheduled |
| **P1** Environments | Migration (env tables), client, CRUD/test/schema/form endpoints, Settings UI | Can register two envs and see their generated forms |
| **P2** Single launch + origin | Experiments/jobs tables, dispatcher (submit/poll/cancel/timeout), ingest link, `runs.origin`, Origin facet | One official run visible end-to-end; local runs unchanged |
| **P3** Bindings + sweeps | Endpoint bindings with platform models, secret refs, sweep expansion, `dry_run`, launch wizard | 2 models × 2 thresholds × 2 envs = 8 official runs from one submit |
| **P4** Results UX | Experiment matrix, compare preselection, param charts, clone/retry, CLI `--origin` | Users can answer "which config wins" without leaving the page |
| **P5** Hardening | Load test dispatcher, multi-pod lease test, docs (`USER_GUIDE.md` section, API guide) | Runbook in `docs/internal/OPERATIONS.md` |

## 15. Tests (`tests/platform/`)

- `test_eval_schema_form.py` — `$ref`/`anyOf` resolution, widget detection, grouping,
  unknown fields, schema from the guide's example.
- `test_eval_sweeps.py` — grid/zip/link expansion, cap, per-env validation, cross-field
  rules, secret refs never leak into `params`/responses.
- `test_eval_service_client.py` — `httpx.MockTransport` for 202/401/404/409(both kinds)/422.
- `test_eval_dispatcher.py` — submit backoff on HIGH 409, inflight cap, poll backoff,
  run-status merge, TIMED_OUT, cancel, crash-mid-submit reconcile, two workers never
  double-submit.
- `test_eval_run_linking.py` — valid token → official + re-homed project; replayed token,
  wrong key, missing job → local; token stripped.
- `test_eval_environments_api.py` / `test_experiments_api.py` — permissions, HIGH gating,
  key masking, platform-model opt-in.
- `test_migrations.py` — extend for 0058 up/down and `origin` backfill.
- Browser: launch wizard preview count, Origin facet (`test_design_language.py` must pass).

## 16. Open questions

1. D4: can the service accept a target project/key per job, or do we rely on re-homing?
2. Should environments be project-scoped (proposed) or platform-wide with per-project grants?
3. Should official-ness also require the dataset to be a published platform version?
4. Default sweep cap (64) and per-env inflight cap (5) — acceptable for the Celery fleet?
5. Retention for `secrets_encrypted` after completion (proposed: clear immediately).
