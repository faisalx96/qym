# Evaluation Service Integration Plan

Status: proposal (v2) · Branch: `experiments-platform` · Source contract:
[`docs/evaluation-service-api-integration.md`](../evaluation-service-api-integration.md)

## 1. Goal

Let a qym project launch evaluation experiments on one or more remote **Evaluation
Service** deployments ("environments"), configure them through a form generated from each
environment's live `env_overrides` schema, sweep any input over several values, bind LLM
endpoints to the project's saved models, and start from either the **official defaults**
or the **best previous run** on that environment.

### 1.1 Requirements → design

| # | Requirement | Design element | § |
|---|---|---|---|
| R1 | Define a new environment per project (URL + API key) or reuse an existing one | `eval_environments` (project-scoped) + Settings → Environments + picker in the launch form | 4.1, 5, 12.1 |
| R2 | On definition, fetch the env-overrides schema and build a configurable form; every input accepts multiple values (sweep) | Versioned schema cache → normalized form descriptor → generic renderer with multi-value inputs | 4.2, 6, 8 |
| R3 | After parsing, prompt the user to group LLM fields (api_key, url, model_name) into one object; later just pick project models | Auto-detected **model slots**, confirmed by the user, bound to `ProjectLlmConnection`s at launch | 4.3, 7 |
| R4 | Run with the **official defaults** (admin-curated) or the **best run's** config, stored in `config.run_metadata` | Versioned `eval_config_presets` + `run_metadata.qym_config` snapshot + a best-run ranker over official runs | 4.4, 9, 10 |
| R5 | View and edit an advanced section: custom evaluation inputs and role overrides | Advanced panel: evaluator config, custom `run_metadata`, `LLM_OVERRIDES` role table, raw JSON view that stays in sync with the form | 8.4 |
| R6 | See the job queue and cancel jobs that are no longer needed | Queue view per project/environment (platform jobs + remote queue snapshot), single and bulk cancel | 13.1, 14.1, 12.2 |
| — | Official vs local runs (kept in scope) | One-time launch token verified at ingest → `runs.origin` | 11 |

### 1.2 Decisions taken (from clarification round)

| Topic | Decision |
|---|---|
| "Official default configuration" | An admin-curated, versioned **preset** per environment, stored in qym (not the service's implicit env defaults, which the API does not expose) |
| "Best run" | Among **official** runs of that environment on the selected **dataset version**, rank by a chosen metric (project default, user can change it); tie-break on pass@k, then recency |
| Model catalogue | **Reuse `ProjectLlmConnection`**, the same list the root-cause analyzer uses; users may also add a **temporary model** for one experiment |
| Promote to official | Always opens the preset editor for review; never publishes directly |
| Caps | 64 jobs per sweep, 5 in-flight jobs per environment (both configurable) |
| Job queue | Users see queued/running jobs and can cancel them individually or in bulk |
| Official vs local tagging | **Keep**: launch token + `runs.origin` |
| Sweep semantics | **Cartesian grid** by default, plus **linked groups** whose inputs move together; hard cap on job count |
| LLM grouping | **Auto-detect, user confirms**; mapping saved per environment and re-proposed when the schema changes |
| `HIGH` priority | Project managers / platform admins only, capped per environment, explicit preemption acknowledgement |

### 1.3 What exists and is reused (verified in code)

| Asset | Location | Use here |
|---|---|---|
| `ProjectLlmConnection`: name, base_url, model, Fernet-encrypted key, `last4`, `is_default` | `db/models.py:363`; CRUD + `/test` in `api/projects.py:489-650`; UI in `_static/dashboard/project_settings.html:269` | Model catalogue for slots (R3) |
| `secrets.py` (Fernet via `QYM_LLM_CONFIG_ENCRYPTION_KEY`) | `secrets.py` | Encrypt env API keys and ad-hoc keys |
| `validate_llm_base_url` / `create_llm_http_client` (SSRF-safe transport) | `llm_endpoint_security.py:42,142` | Env URL validation + outbound client |
| Background loops, `QYM_ROLE=all/worker/api` | `worker.py`, `services/maintenance.py` | Host the dispatcher |
| Ingest `create_run` persists `run_metadata`/`run_config` verbatim | `api/ingest.py:797-798` | Launch-token verification + config snapshot |
| SDK passes `EvaluatorConfig.run_metadata` through to ingest | `packages/sdk/qym/core/config.py:38`, `core/results.py` | `config.run_metadata` reaches `runs.run_metadata` |
| Per-item scores + metric direction | `RunItemScore`, `RunMetricSpec.direction` (`db/models.py:713,729`) | Best-run scoring |
| Repeat analysis (pass@k, pass^k) | `services/repeat_analysis.py` | Tie-breaker score |
| Roles: platform `ADMIN`; project `MEMBER`/`MANAGER`; `is_project_manager()` | `db/models.py:35-42`, `permissions.py:32` | Permission gates ("manager" below = project manager or platform admin) |
| CodeMirror bundle | `_static/dashboard/codemirror-bundle.js` | Raw JSON editor in the advanced panel |

**Frontend note.** The served UI is the vanilla HTML/JS in `_static/dashboard/` (mounted
at `/static` in `app.py:135`). `_static/app/` is a compiled React bundle that is committed
but **not mounted**, and its source is not in the repo. All new UI goes into
`_static/dashboard/` and must follow `docs/DESIGN_LANGUAGE.md`
(`tests/platform/test_design_language.py`).

**Not reused:** `services/product_evals.py` runs the SDK in-process with process-local
job state. Here qym is the *client* of a remote runner, so state must be DB-backed and
multi-process safe.

## 2. Architecture

```
Browser ──► qym API ──(1) create experiment + N jobs (DB, status=QUEUED)
                          │
            qym worker: EvalDispatcher (leased loop, SKIP LOCKED)
                          │ (2) POST {env}/evals          Bearer <env key>
                          │ (3) GET  {env}/evals/{id}     poll with backoff
                          │ (4) POST {env}/evals/{id}/cancel
                          ▼
             Evaluation Service (env A, env B, …) ── Celery ── qym SDK task
                          │  live_mode="platform", QYM_BASE_URL/QYM_API_KEY on the worker
                          │  config.run_metadata = {qym_launch, qym_config}
                          ▼
qym ingest POST /runs ──(5) verify launch token → origin=official, link run↔job,
                            check run arrived in the env's project, strip token
                          │
                (6) on run completion → score snapshot → best-run index
```

A job's status comes from two sources: the **remote job** (coarse, with known gaps) and the
**linked qym run** (detailed, live). §13 defines how they are merged.

## 3. Asks for the Evaluation Service team (raise first)

| # | Gap (guide §) | Impact on this plan | Ask | Platform fallback |
|---|---|---|---|---|
| D1 | `EvalJobRead.env_overrides` echoes `LLM_OVERRIDES…api_key` in plaintext to anyone with the env key (§5) | Provider keys from `ProjectLlmConnection` would sit readable on the service | Redact `api_key` in responses; encrypt at rest | Redact on every read before storing; environment-level opt-in before connection keys are sent (§7.4) |
| D2 | `FAILED` never written; jobs stay `RUNNING` (§6) | Failure not observable remotely | Uncomment `_finish(FAILED)` | Merge with linked-run status + 2h15m timeout (§13) |
| D3 | `started_at`/`finished_at`/`exit_code` stripped (§5) | Weak timing | Add to `EvalJobRead` | Use linked run timestamps |
| D4 | Runs are ingested under the service's own `QYM_API_KEY` project (`platform_*` is server-owned, §4.2) | **Resolved:** each environment is configured with its project's qym key | — | One URL per project (§4.1); ingest verifies the project (§11) |
| D5 | No schema for `EvaluatorRequestConfig` | Evaluator form must be hand-maintained | `GET /evals/evaluator-config/schema` | Static descriptor in qym (§8.4) |
| D6 | Schema carries no guaranteed `default` values; no "effective env" endpoint | Form can't show what the worker would use when a field is unset | Include `default` in `EnvOverrides` fields, or `GET /evals/env-defaults` | Unset fields show "inherited from environment"; official preset makes defaults explicit |
| D7 | `metrics` not selectable (§4.1) | Every run executes the full metric set; ranking metric must be one of them | Re-enable the field | Metric picker used only for ranking, not execution |
| D8 | No ownership on list/cancel (§3.2, §3.5) | **Resolved:** qym is the only caller, so every remote job is qym's | — | Full remote queue shown; managers may cancel orphans (§12.2a) |
| D9 | `HIGH` kills every lower job, all users (§2.1) | One user can wipe another's runs | — | Permission + cap + acknowledgement (§5.3) |

## 4. Data model (migration `0058_eval_service_integration`)

All tables are project-scoped through `project_id` (directly or through their parent).
IDs are `String(36)` UUIDs like the rest of the schema; JSON columns use the `BIG_JSON`
type already used in `db/models.py`.

### 4.1 `eval_environments`

| Column | Notes |
|---|---|
| `id`, `project_id` FK | unique `(project_id, name)` |
| `name`, `description` | |
| `base_url` str(500) | full prefix incl. `EVAL_SERVER_PREFIX`, **without** `/evals`; normalized (no trailing `/`) |
| `api_key_encrypted`, `api_key_last4` | `EVAL_API_KEY` via `secrets.py`; never returned |
| `default_priority`, `max_priority` | enum `LOW/NORMAL/HIGH`; defaults `NORMAL` / `NORMAL`. Raising `max_priority` to `HIGH` requires manager |
| ~~`max_inflight_jobs` int~~ | removed (migration 0080): the Evaluation Service limits and queues runs itself |
| `allow_connection_keys` bool | default `false`; opt-in to send decrypted `ProjectLlmConnection` keys to this env (D1) |
| `current_schema_id` FK → `eval_environment_schemas` | |
| `ranking_metric`, `ranking_k` | default metric and k for best-run ranking (§10); nullable → project default |
| `health_status`, `health_checked_at`, `health_error` | from `/test` |
| `is_active`, `created_by_user_id`, `created_at`, `updated_at` | soft-disable when referenced by jobs |

**Reusing an existing environment:** environments are listed per project, and the launch
form offers them in a picker.

**One environment URL = one project.** Routing into the right project happens at the
environment: each deployment sends its runs to qym with the API key of the project that
defines it. So an environment URL can't be registered in two projects, or one project's
runs would land in the other. This is enforced by a platform-wide unique index on the
normalized `base_url` of active environments. Creating a duplicate is refused with
"This environment already belongs to project *X*". There is no cross-project copy.

### 4.2 `eval_environment_schemas` (immutable history)

| Column | Notes |
|---|---|
| `id`, `environment_id`, `schema_hash` (sha256 of canonical JSON) | unique `(environment_id, schema_hash)` |
| `schema_json` | raw response of `GET /evals/env-overrides/schema` |
| `form_descriptor` | normalized descriptor (§6), cached |
| `fetched_at`, `first_seen_at` | |

Every job pins the `schema_id` it was validated against. A schema refresh that yields a new
hash inserts a row, moves `current_schema_id`, and triggers slot re-proposal (§7.3).

### 4.3 `eval_model_slots` (confirmed LLM grouping, R3)

One row per logical "model object" in an environment's schema.

| Column | Notes |
|---|---|
| `id`, `environment_id`, `schema_id` | slots are tied to the schema they were confirmed on |
| `slot_key` | e.g. `endpoint:primary`, `endpoint:fast`, `flat:VIZ_LLM` |
| `kind` | `endpoint` (an `LLM_OVERRIDES.endpoints.<name>` entry) or `flat` (top-level env vars) |
| `label` | user-facing name, e.g. "Primary model", "Visualization model" |
| `field_map` JSON | `{"model": "<json-pointer>", "base_url": "<ptr>|null", "api_key": "<ptr>|null"}` |
| `transport_fields` JSON | pointers left editable per slot: `timeout`, `max_attempts`, `max_connections`, `max_keepalive`, `connect_timeout` |
| `required` bool | `endpoint:primary` is always required (service rule) |
| `status` | `proposed` / `confirmed` / `stale` (field vanished from a newer schema) |
| `confirmed_by_user_id`, `confirmed_at` | |

### 4.4 `eval_config_presets` + `eval_config_preset_versions` (official defaults, R4)

`eval_config_presets`: `id`, `environment_id`, `name`, `kind` (`official` | `saved`),
`current_version_id`, `created_by_user_id`, timestamps. Each environment has at most
one `official` preset (partial unique index). Any member can create `saved` presets (named
personal/team starting points); only managers can publish the official one.

`eval_config_preset_versions` (immutable):

| Column | Notes |
|---|---|
| `id`, `preset_id`, `version` int | unique `(preset_id, version)` |
| `schema_id` | schema the config was authored against |
| `config` JSON | a **config document** (§8.1) with no sweeps: `evaluator`, `env_overrides` (secret-free), `slot_bindings` |
| `notes`, `published_by_user_id`, `published_at` | |

Publishing a new official version never mutates old versions, so a run always points
to the exact defaults it was launched from.

### 4.5 `eval_experiments` (one launch = one sweep)

| Column | Notes |
|---|---|
| `id`, `project_id`, `created_by_user_id`, `name`, `description` | |
| `environment_ids` JSON | one or more envs from the same project |
| `base_source` JSON | `{"kind": "official", "preset_version_id": …}` / `{"kind": "best_run", "run_id": …, "metric": …}` / `{"kind": "saved", "preset_version_id": …}` / `{"kind": "blank"}` / `{"kind": "clone", "experiment_id": …}` |
| `spec` JSON | config document **with sweeps and links** (§8.1); secrets only as refs |
| `secrets_encrypted` | Fernet blob `{ref_id: value}` for temporary-model keys typed in the form (§7.5); cleared once all jobs are terminal |
| `priority`, `preemption_acknowledged_at` | |
| `status` | aggregate: `QUEUED/RUNNING/COMPLETED/PARTIAL/FAILED/CANCELLED` |
| `job_count`, `created_at`, `updated_at`, `cancelled_at`, `cancelled_by_user_id` | |

### 4.6 `eval_experiment_jobs` (one combination × one environment)

| Column | Notes |
|---|---|
| `id`, `experiment_id`, `environment_id`, `combo_index` | unique `(experiment_id, environment_id, combo_index)` |
| `params` JSON | swept values for this combo (redacted; model slots as connection **names**) |
| `request_body` JSON | materialized `EvalJobCreate` with secret refs |
| `schema_id` | |
| `launch_token_hash` | sha256 of the one-time token (§11) |
| `remote_job_id`, `remote_status`, `remote_result` (redacted), `remote_versioning` | `remote_versioning` = `result.versioning_metadata` with a fallback to the legacy flat keys (guide §5) |
| `status` | platform status (§13) |
| `run_id` FK nullable (`ON DELETE SET NULL`) | set at ingest link |
| `error`, `submit_attempts`, `next_attempt_at`, `lease_owner`, `lease_until`, `submitted_at`, `last_polled_at`, `finished_at` | |
| `wait_reason` | why a non-terminal job isn't progressing (`HIGH job <id> active`, `env unhealthy`, `model missing`); shown in the queue |
| `cancel_requested_at`, `cancelled_by_user_id`, `cancel_reason` | set by the queue's cancel action (§13.1) |

Index `(status, next_attempt_at)` for the dispatcher; `(environment_id, status)` for the queue view.

### 4.6a `eval_remote_queue_snapshots`

The latest view of each environment's remote queue, refreshed by the dispatcher (§13), so
page loads never hit the service directly.

| Column | Notes |
|---|---|
| `environment_id` PK, `fetched_at`, `fetch_error` | |
| `items` JSON | `PENDING`/`RUNNING` remote jobs: `{remote_job_id, status, priority, user_id, created_at, run_name}` only; `env_overrides` and `eval_input` are **never** stored (D1) |

### 4.7 `eval_run_scores` (best-run index, R4)

Snapshot written once when a linked official run reaches `COMPLETED` (and refreshed if the
run is re-scored):

| Column | Notes |
|---|---|
| `run_id` PK part, `metric_name` PK part | |
| `project_id`, `environment_id`, `dataset_id`, `dataset_version_id` | denormalized for ranking |
| `mean_score` float | mean of `RunItemScore.score_numeric` |
| `direction` | from `RunMetricSpec.direction` (`maximize`/`minimize`) |
| `pass_at_k` JSON | `{k: value}` from `repeat_analysis` / service `result` |
| `item_count`, `error_item_count`, `completed_at` | |

Index `(environment_id, dataset_version_id, metric_name, mean_score)`. Ranking is then a single
indexed query instead of aggregating `run_item_scores` on every form load.

### 4.8 `runs` additions

- `origin` enum `local|official`, `server_default='local'`, indexed; backfill all to `local`.
- `experiment_job_id` FK nullable (`ON DELETE SET NULL`).

### 4.9 `project_llm_connections` additions

- `available_for_experiments` bool, default `true` (lets a project keep analyzer-only
  connections out of the model picker).
- The Settings subtitle changes from "Providers for AI-assisted root cause analysis" to
  "Providers for root cause analysis and experiments".

## 5. Environments (R1)

### 5.1 API — `api/eval_environments.py`

Members may read environments; managers may write them.

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/projects/{pid}/eval-environments` | list (key as `••••last4`, health, schema hash, slot status) |
| POST | `/v1/projects/{pid}/eval-environments` | create → validate URL → `/test` → fetch schema → propose slots; returns env + proposed slots |
| PUT | `…/{eid}` | update; blank `api_key` keeps the stored one (same rule as LLM connections) |
| DELETE | `…/{eid}` | hard delete if unused, otherwise soft-disable |
| POST | `…/{eid}/test` | `GET /evals?limit=1` (auth probe) + schema fetch; stores health |
| POST | `…/{eid}/schema/refresh` | refetch; returns `{changed, added[], removed[], changed_types[]}` diff |
| GET | `…/{eid}/form` | form descriptor for the current schema (§6) |
| GET/PUT | `…/{eid}/model-slots` | list proposals/confirmed slots; confirm/edit (§7) |
| GET/POST | `…/{eid}/presets`, `…/presets/{id}/versions` | presets (§9) |
| GET | `…/{eid}/best-runs?dataset_id=&metric=&k=&limit=5` | ranked candidates (§10) |

### 5.2 Client — `services/eval_service_client.py`

A thin `httpx` wrapper built on `create_llm_http_client(allow_private=settings.allow_private_llm_base_urls)`,
so SSRF checks apply because the platform sends decrypted keys to this host.

- Methods: `submit(body)`, `get(job_id)`, `cancel(job_id, user_id)`, `list(**filters)`,
  `env_overrides_schema()`.
- Error mapping: `401 → EnvAuthError`; `404 → RemoteNotFound`; `409` parsed from `detail`
  into `HighPriorityActive(job_id)` or `NotCancellable(status)`; `422 → RequestRejected(errors)`
  with Pydantic `loc` paths preserved; transport/5xx → `RetryableError`.
- Timeouts: 5s connect / 30s read. Logging redacts `Authorization` and any `api_key`.

### 5.3 Priority policy

- Requested priority must be `<= environment.max_priority`.
- `HIGH` requires a manager **and** `acknowledge_preemption: true` in the request. The UI
  warns "Launching at HIGH cancels every running LOW/NORMAL job on *env* for all users."
- A `409 HighPriorityActive` on submit does not fail the job. The job waits with backoff
  and the UI shows "Waiting: HIGH job `<id>` active on *env*".

## 6. Schema → form descriptor (R2)

`services/eval_schema_form.py` converts the raw JSON Schema into a flat, UI-ready
descriptor so the browser never has to interpret `$ref`/`anyOf`:

1. Resolve `$ref` against `$defs`; collapse `anyOf[X, {type: null}]` to `X` + `nullable: true`.
2. Walk the schema and emit fields keyed by JSON pointer, e.g.
   `/MILVUS_SEARCH_THRESHOLD`, `/LLM_OVERRIDES/endpoints/{endpoint}/model`,
   `/LLM_OVERRIDES/{role}/temperature`.
   - **Maps** (`additionalProperties: {$ref: EndpointConfig}`) become *collections* with a
     templated child path `{endpoint}`; the user adds or removes entries (`primary` is fixed).
   - **Role blocks** (`main`, `router`, … all sharing `RoleConfig`) collapse into a *role
     table* descriptor: one row per role name found in the schema, with the `RoleConfig` fields
     as columns. New roles added by the service therefore appear without a qym release.
3. Per field: `type` (`boolean|integer|number|string|enum|object`), `enum`,
   `minimum/maximum/exclusiveMinimum`, `pattern`, `default` (if present, D6),
   `description`, `nullable`, `sweepable` (all scalars), `secret` (name matches
   `api_key|*_API_KEY|*_TOKEN`), `widget`:
   `toggle | select | number | number-range | text | url | secret | model-name | endpoint-ref`.
4. Grouping for display, using a name-prefix table mirroring guide §4.3: LLM routing,
   Feature toggles, Table selection / RAG, SQL runner, Context management, Visualization,
   Misc. Unmatched fields fall into **Other**.
5. Service quirks encoded in the descriptor: booleans are always sent as real booleans
   (the service accepts strings too); `RAG_ITERATION` is a string widget with the hints
   `""`, `"latest"` and digits; `endpoints` must contain `primary`; a role's `endpoint` must
   reference an existing endpoint key.

**Multi-environment launches:** the form renders the **union** of the selected
environments' descriptors. A field missing from one environment gets a badge ("not in
*env B*"). Setting it on a job for that environment is a validation error, never a silent
remote 422.

## 7. LLM model slots (R3)

### 7.1 Auto-detection (runs on every new schema hash)

`services/eval_model_slots.py` proposes slots:

1. **Structural:** each entry of `LLM_OVERRIDES.endpoints` becomes `endpoint:<name>`
   (`EndpointConfig.model/base_url/api_key` map directly). `primary` is always proposed and
   required. The endpoint map is open-ended, so the user can add more endpoint slots
   (e.g. `fast`).
2. **Name-based, for flat env vars:** group top-level fields that share a prefix and end
   in `_MODEL`/`_MODEL_NAME`, `_BASE_URL`/`_URL`/`_ENDPOINT`, `_API_KEY`/`_KEY`
   (`VIZ_LLM_MODEL` → `flat:VIZ_LLM` with only `model` mapped). A group with only a model
   field is still a valid slot: binding it sends just the connection's model name.
3. The rules live in one table, so they are easy to extend.

### 7.2 Confirmation prompt

Right after an environment is created (and after any schema change that alters slots),
the UI shows a **"Group LLM settings"** step:

- one card per proposed slot, showing which schema fields it will fill;
- actions: rename, merge/split fields, remove the slot (fields stay as plain inputs), add
  a slot manually by picking fields;
- **Confirm** stores the slots as `confirmed`. Until confirmation the launch form still
  works and shows LLM fields as raw inputs, with a banner "Group LLM settings to pick
  project models".

### 7.3 Schema drift

On a new schema hash the confirmed slots are carried forward when their pointers still exist.
Slots whose fields disappeared become `stale`, new candidates are `proposed`, and the
banner comes back. Existing presets and best-run configs are re-mapped the same way (§9.3).

### 7.4 Binding a slot at launch

Each slot takes a **binding**:

| Binding | Fills | Stored in spec as | Resolved |
|---|---|---|---|
| Project model | model + base_url + api_key from a `ProjectLlmConnection` | `{"connection_id": …}` | at dispatch time: decrypt key, read the current model/base_url |
| Temporary model | user-typed model/base_url/key, used only in this experiment (§7.5) | literals + `{"$secret": ref}` for the key | at dispatch time |
| Inherit | nothing (slot omitted) | — | worker's own env |

- A slot's binding is **sweepable**: multi-selecting three project models yields three
  combos. The model picker lists connections with `available_for_experiments = true`.
- Connection keys are only sent to environments with `allow_connection_keys = true`. For
  other environments the picker shows the connection disabled, with a tooltip explaining why.
- Transport fields of an endpoint slot stay as normal (sweepable) inputs.
- `evaluator.model` (and `config.model`) is set to the bound `primary` model name so qym's
  Models page groups runs correctly.
- Dispatch re-resolves connections each time, so rotated keys are picked up on retry. A
  deleted connection moves the job to `BLOCKED` ("model *X* no longer exists").

### 7.5 Temporary models

For a model the user wants to try once without adding it to the project catalogue:

- In any slot's model picker, **"+ Temporary model"** opens an inline form (label, model,
  base URL, API key) and adds a chip styled differently from saved connections. It can
  be multi-selected and swept like any other model.
- The base URL goes through the same `validate_llm_base_url` check as connections. The key
  is encrypted into `experiments.secrets_encrypted` and never returned. The key is **only
  sent to environments with `allow_connection_keys`**, the same opt-in as saved keys.
- Lifetime: the key is kept until every job of the experiment is terminal, then cleared.
  Retrying a job afterwards asks for the key again. Clone and presets copy label, model
  and base URL but never the key.
- **"Save to project models"** checkbox (default off) creates a `ProjectLlmConnection`
  instead, when the user has permission to manage connections.
- In `qym_config` and `params` it appears as `{"temporary": {"label", "model", "base_url"}}`.
  A best run that used a temporary model loads with that slot unbound and a prompt to pick
  a saved model or re-enter the key.

## 8. Launch form, sweeps and advanced panel (R2, R5)

### 8.1 Config document (single shape used everywhere)

Presets, best-run snapshots, experiment specs and the JSON editor all use one document:

```jsonc
{
  "schema_hash": "…",
  "evaluator": {
    "dataset": "playground_set_v2",          // or dataset_id + alias/version from the picker
    "dataset_version": null,
    "config": { "samples": 3, "report_k": 1, "max_concurrency": 5,
                "run_metadata": { "team": "rag" } }   // user keys only; qym_* reserved
  },
  "slot_bindings": {
    "endpoint:primary": { "connection_id": "c-gpt4o" },
    "endpoint:fast":    { "temporary": { "label": "mini trial", "model": "gpt-4o-mini",
                                         "base_url": "https://…", "api_key": { "$secret": "k1" } } },
    "flat:VIZ_LLM":     { "connection_id": "c-qwen" }
  },
  "env_overrides": {                          // non-slot fields only
    "TABLE_SELECTION_MODE": "rag",
    "MILVUS_SEARCH_THRESHOLD": 0.7,
    "LLM_OVERRIDES": {
      "endpoints": { "primary": { "timeout": 60, "max_attempts": 3 } },
      "main":   { "endpoint": "primary", "temperature": 0.2 },
      "router": { "endpoint": "fast" }
    }
  }
}
```

In an **experiment spec**, any scalar or binding may instead be
`{"sweep": [v1, v2, …]}`, and a top-level `"links": [["/env_overrides/X", "/evaluator/config/Y"], …]`
declares linked groups.

### 8.2 Layering in the form

```
base (official preset v7 | best run abc123 | saved preset | blank | clone)
  └─ user edits          (field shows a "changed" dot + reset-to-base)
       └─ sweep values   (field becomes a chip list)
```

The header shows the base source and a **diff vs base** counter. "Reset all to base"
and "Switch base" keep the user's edits that also exist on the new base, after confirmation.

### 8.3 Multi-value inputs and sweeps

- Every sweepable field has an **"+ values"** affordance that turns it into chips. Numbers
  also get a range helper (start/stop/step) that expands client-side into an explicit list,
  so the stored spec is always explicit. Booleans offer `[true, false]` as a single click.
  Enums offer multi-select.
- **Grid** expansion across all swept fields; **linked groups** zip their members
  (equal-length lists enforced) and act as a single axis in the grid. A typical use:
  "model X always with temperature 0.2, model Y with 0.7".
- Jobs = `∏ axis lengths × number of environments`. Hard cap `QYM_EVAL_SWEEP_MAX_JOBS`
  (default 64). The live preview disables submit when over the cap.
- `services/eval_sweeps.py` validation for each (combo, env):
  1. materialize the concrete `EvalJobCreate` (bindings resolved to placeholders, nulls
     stripped);
  2. validate against that env's schema with `jsonschema` Draft 2020-12;
  3. mirror the service's cross-field rules locally: `endpoints` non-empty with `primary`,
     each role `endpoint` exists, effective `report_k <= samples`, and `evaluator.config`
     passes `extra="forbid"` against the static descriptor.
- `dry_run: true` returns the expanded matrix (params, generated run names, per-env
  errors mapped back to form pointers, job count) without persisting it. This powers the
  **Preview N runs** panel.
- Run name: `"{experiment.name} · {short param label}"`, deterministic and truncated,
  e.g. `rag-vs-model · primary=gpt-4o thr=0.7`.

### 8.4 Advanced panel (R5)

Collapsed by default. Three tabs:

1. **Evaluation inputs.** A static descriptor for `EvaluatorRequestConfig` (guide §4.2),
   rendered with the same widgets and sweep support: `samples`, `report_k`,
   `max_concurrency`, `max_metric_concurrency`, `timeout`, `metric_timeout`,
   `max_retries`, `metric_max_retries`, `task_name`, `git_branch`, `git_commit`,
   `dataset_version`/`dataset_alias`, `force_model_override`. Plus:
   - **custom `run_metadata`** as a key/value editor (JSON values allowed; the `qym_*`
     prefix is reserved and rejected);
   - **custom dataset string** (a raw `evaluator.dataset` value per the service loader's
     convention) as an alternative to the dataset picker.
   The platform owns these fields and they are shown read-only: `run_name` (generated,
   with an optional user prefix), `live_mode` (always `platform`), `model/models` (from the
   `primary` slot), and the reserved `run_metadata.qym_*` keys.
2. **Role overrides.** The role table from §6: rows = roles in the schema (`main`,
   `router`, `brief`, …); columns = `endpoint` (dropdown of endpoint slots defined in
   this form), `temperature`, `max_tokens`, `top_p`, `seed`, `reasoning_enabled`,
   `reasoning_effort`, `response_format`. Cells are sweepable. Filters: "overridden only"
   and search. An unset cell means the service default.
3. **Raw JSON.** A CodeMirror editor over the §8.1 document (sweeps included), with
   two-way sync: edits are schema-validated on blur and flow back into the form. Secrets
   are shown as `{"$secret": "…"}` / `{"connection_id": "…"}`, never as values.

## 9. Official defaults and saved presets (R4a)

### 9.1 Authoring

- A manager opens **Environments → *env* → Official defaults**, which is the same form
  without sweeps, then **Publish** (with required release notes). This creates
  `eval_config_preset_versions.version = n+1`.
- A "Promote to official" action exists on (a) any saved preset, (b) any completed
  official run's config (typically the current best run) and (c) any experiment matrix
  cell. It **always** opens the official-defaults editor prefilled with that config and
  a diff against the current official version. Nothing is published until the manager
  reviews it and clicks Publish. Temporary-model slots must be rebound to saved
  connections before publishing.
- Slot bindings in the official preset reference project connections by id. If a referenced
  connection is deleted, the preset shows a warning and launching from it requires re-picking
  the model.

### 9.2 Launch from official defaults

"Run official defaults" is a one-click action on the environment card and the default base
in the launch form. It creates a 1-job experiment (no sweep) with
`base_source = {kind: official, preset_version_id}`.

### 9.3 Re-mapping onto a newer schema

When a preset (or best-run snapshot) was authored on a different `schema_hash`,
`services/eval_presets.remap(config, from_schema, to_schema)` does the following:

- keeps values whose pointer still exists and still validates;
- drops the rest and lists them to the user ("3 settings no longer supported: …");
- leaves new fields unset (inherit);
- carries slot bindings forward by `slot_key`.

## 10. Best run as a base (R4b)

### 10.1 What gets stored per run

At dispatch time the platform sets two reserved keys in `evaluator.config.run_metadata`,
which the SDK carries into `runs.run_metadata`:

```jsonc
"qym_launch": { "experiment_id": "…", "job_id": "…", "environment_id": "…",
                "combo_index": 3, "token": "<one-time, stripped at ingest>" },
"qym_config": {                        // the §8.1 document for THIS combo, sweeps resolved
  "schema_hash": "…",
  "base_source": { "kind": "official", "preset_version_id": "…" },
  "evaluator":   { … },
  "slot_bindings": { "endpoint:primary": { "connection_id": "c-gpt4o", "name": "GPT-4o prod", "model": "gpt-4o" } },
  "env_overrides": { … }                // secret-free
}
```

- `qym_config` never contains secrets: connection bindings carry id + display name +
  model; temporary-model keys are dropped (`{"$secret": "redacted"}`).
- The job row (`request_body` + `params`) remains the source of truth. `qym_config` is the
  portable copy that makes a run self-describing (visible on the run page, exportable, and
  usable if the job row is gone).

### 10.2 Ranking

`services/eval_best_run.py`:

- **Scope, chosen before retrieval.** "Start from → Best run" first asks the user what to
  rank on, and nothing is retrieved until they click **Find best runs**:
  - **Dataset:** any dataset of the project that has eligible runs, or *Any dataset*.
  - **Dataset version:** one version of that dataset, or *Any version*.
  - **Versioning:** one select per `versioning_metadata` key the eligible runs reported
    (`agent_version`, `kb_version`, or any key the service adds), each defaulting to
    *Any*. Values come from `dashboard_run_versions`.

  Each choice narrows the ranking, and whatever is left on *Any* is not constrained.
  Leaving everything on *Any* retrieves the **global** best run of the environment:
  every eligible run across datasets and versions, including runs on a custom dataset
  string. Scores from different datasets or versions are not strictly comparable, so
  the picker says so whenever no version is chosen. The prompt's options come from
  `GET …/best-runs/scope`: datasets and versions with eligible runs, and the versioning
  values those runs reported, each with run counts.
- **Eligible:** `runs.origin = official`, linked to a job on this environment, status
  `COMPLETED`, not soft-deleted, inside the chosen scope, and having an
  `eval_run_scores` row for the chosen metric. When a chosen version has no run, the UI
  says so and links to the latest version of that dataset that has runs.
- **Metric:** selector defaults to `environment.ranking_metric`, otherwise the most common
  metric in the scope (then on the environment). It respects `direction`.
- **Order:** `mean_score` (by direction) → `pass_at_k[k]` → `item_count` (larger runs
  first) → most recent.
- Excludes runs with `error_item_count / item_count > 20%` by default (toggleable), so
  a run that "wins" by crashing on hard items is not picked.
- `GET …/best-runs?dataset_id=&dataset_version_id=&versioning=key%3Dvalue` returns the top
  5 in the scope, each with its dataset and version, score, pass@k, agent/KB versions
  (`remote_versioning`), a params summary and age, so the user can pick another one. The
  response echoes the `scope` (`global: true` when nothing was chosen).
- **Reading the stored config.** Ranking selects only the columns it shows. The params
  summary comes from `run_metadata.qym_config`, which holds `env_overrides`, `evaluator`
  and `slot_bindings`. It is extracted with a SQL JSON path (`->` on PostgreSQL,
  `JSON_EXTRACT` on SQLite) in the same query. The rest of `run_metadata`, `run_config`
  and the job's `request_body` are never loaded. `remote_result` is read only for jobs
  that finished before `remote_versioning` was stored, in one query.

### 10.3 Launching from best run

"Start from best run" loads `qym_config` from the chosen run (falling back to the job
row), re-maps it onto the current schema (§9.3), and re-resolves connection bindings.
Only that key is read, with a JSON path: `run_metadata.qym_config`, else the job's
`request_body.evaluator.config.run_metadata.qym_config`. Promote-to-official reads a
run's config the same way (`services/eval_config_snapshot.py`).
Deleted connections become an unbound slot with a warning. The form header shows
"Base: run *abc123* · accuracy 0.84 · agent v1.12 / kb 381". Because agent and KB
versions may have changed since that run, the header warns when the environment's latest
`remote_versioning` differs.

## 11. Official vs local runs

**Definition.** A run is *official* only if the platform dispatched it to a registered
environment and ingest verified the link. Everything else (laptop, CI, copied metadata)
is *local*.

**Link protocol** (in `api/ingest.py` `create_run`, before persisting):

1. If `run_metadata.qym_launch` is present, look up the job by `job_id`. Require
   `sha256(token) == launch_token_hash` and `job.run_id IS NULL` (one-time use).
2. Require `run.project_id == experiment.project_id`. The run already arrives in the right
   project, because the environment ingests with that project's key (§4.1). There's no
   re-homing, and a mismatch means the deployment is misconfigured: the run stays `local`,
   and the environment gets `health_error = "runs arriving in project X"`.
3. On success: `origin = official`, `experiment_job_id = job.id`,
   `owner_user_id = experiment.created_by_user_id` (`created_by_user_id` stays the
   environment's ingest principal for audit), `job.run_id = run.id`.
4. **Always strip** `qym_launch.token` from stored metadata.
5. On any mismatch, store the run as `local`, keep `qym_launch` minus the token, and log a
   warning. The run still appears but never counts as official or best.
6. The SDK's `summary` updates later merge into `run_metadata`
   (`api/ingest.py:1666-1674`). The merge must never re-introduce the token or override
   `origin`.

**Where it shows:**

- Runs list, Overview, Models and Compare get an **Origin** facet (Official / Local / All)
  plus a badge.
- Official runs get an **Experiment** panel (environment, base source, swept params,
  remote job id, service `result`, versioning) and a "Rerun with this config" action.
- `origin` becomes a filter on `/api/runs`, `qym run list --origin`, and the SDK.

**Naming:** "Official defaults" (§9) and "official runs" are different concepts. The UI
labels the preset **Official defaults** and the badge **Official run** to keep them
distinct.

## 12. UI (in `_static/dashboard/`, per `docs/DESIGN_LANGUAGE.md`)

### 12.1 Project Settings → new **Environments** tab (`project_settings.html`)

- Table: name, URL, health dot, schema hash + fetched time, slot status
  (✓ grouped / ⚠ needs grouping), official preset version, priority cap,
  actions.
- **Add environment** dialog, three steps:
  1. **Connect:** name, base URL (hint: include `EVAL_SERVER_PREFIX`), API key, "Test".
  2. **Review settings:** read-only preview of the generated form, grouped, with field count.
  3. **Group LLM settings:** slot confirmation (§7.2).
  Step 1 also shows a reminder that the deployment must ingest with **this project's**
  qym API key, with a link to create one. It refuses a URL already registered in
  another project.
- Environment detail drawer: Official defaults (edit/publish/history), saved presets,
  refresh schema (with diff), ranking metric, policies (`max_priority`,
  `allow_connection_keys`).

### 12.2 **Experiments** page (new `experiments.html` + `experiments.js`, route `/projects/{slug}/experiments` following the `project_models` route pattern in `api/runs.py:2026`)

- List: name, environments, base source, jobs (✓/✗/running), best score, creator, age.
- **New experiment** (single page, sticky right-hand preview):
  1. Environment picker (multi; "+ New environment" opens the §12.1 dialog inline).
  2. Dataset picker (native datasets + version/alias) or custom dataset string.
  3. **Start from:** segmented control *Official defaults · Best run · Saved preset · Blank*.
     "Best run" first asks for the scope (dataset, version, versioning; *Any* leaves a
     part open) and retrieves nothing until **Find best runs**. It then shows the top-5
     list (§10.2) with the metric selector, and loads the top run as the base.
  4. **Models:** one card per confirmed slot with a multi-select of project models,
     plus "+ Temporary model" and Inherit.
  5. **Settings:** the generated grouped form with search, a "changed only" filter, and
     multi-value affordances.
  6. **Advanced** (§8.4).
  7. Priority (HIGH is gated) and name.
  - Preview panel: job count vs cap, axes summary, per-env validation errors (click →
    field), generated run names, **Launch** button.
- **Experiment detail:** matrix (rows = combos, columns = environments). Each cell shows
  status, headline metric and a run link. Also: bulk "Compare selected", cancel/retry per
  job or all, a param-vs-metric chart over `params`, and "Save as preset" / "Promote to
  official" on any cell.

### 12.3 Existing pages

### 12.2a **Queue** page (new `eval_queue.html`, route `/projects/{slug}/experiments/queue`, also a tab on the Experiments page)

- Environment selector (all / one), with a header per environment: in-flight `n/5`,
  queued count, health, and a banner when a `HIGH` job is active.
- **Our jobs** table: every non-terminal job of this project (`QUEUED`, `SUBMITTED`,
  `RUNNING`, `BLOCKED`), with columns experiment, params summary, environment, priority,
  status, `wait_reason`, created by, age, elapsed, and a linked-run progress bar (items done
  / total, from the live run). Filters: mine / all, status, experiment. Sorted in dispatch
  order (priority, then `created_at`).
- **Cancel:** a row action plus **bulk cancel** of the selected rows, and "Cancel all queued
  in this experiment". The confirmation dialog splits the selection:
  - *Queued here (not yet sent)*: removed immediately, nothing reaches the service;
  - *Submitted/running on the service*: "will be hard-stopped; partial results stay on
    the linked run";
  - rows the user isn't allowed to cancel are listed and skipped.
  An optional reason is stored in `cancel_reason`.
- **Remote queue** (collapsible): the environment's `PENDING`/`RUNNING` jobs from the latest
  snapshot, with "fetched 20s ago". qym is the service's only caller and the environment
  belongs to this project, so every remote job should match one of our jobs. A job that
  doesn't match is an **orphan**, for example submitted just before a crash and never
  reconciled, or created before the integration. Orphans are listed with priority, status,
  age and the remote `user_id` (a qym user id), and **managers can cancel them** from here.
  That cancel calls the service directly because there's no local job row.
- The page refreshes with the existing poll-backoff pattern and pauses when the tab is hidden.

### 12.3 Existing pages

- LLM connections: `available_for_experiments` toggle and the updated subtitle.
- Experiment detail: a queue strip showing this experiment's pending jobs, with the same
  cancel actions.
- Run page: Experiment panel (§11), "Rerun with this config".
- Runs list: Origin facet + badge + experiment column.

## 13. Dispatcher and status model

`services/eval_dispatcher.py` → `EvalDispatcher` thread started by `worker.py` (and by
the API process when `QYM_ROLE=all`), mirroring `MaintenanceWorker`. Jobs are claimed with
`SELECT … FOR UPDATE SKIP LOCKED` plus a lease, so several worker pods are safe.

```
QUEUED ─submit─► SUBMITTED ─remote RUNNING or run linked─► RUNNING ─► SUCCEEDED
  │ ▲              │                                          ├──► FAILED
  │ └ 409 HIGH / transport error: backoff                     ├──► CANCELLED
  ├──► BLOCKED (422 / missing connection / 401 env)           └──► TIMED_OUT
  └──► CANCELLED        SUBMITTED/RUNNING ─queue cancel─► CANCELLING ─► CANCELLED
```

- **Submit** every queued job (no platform in-flight cap since migration 0080; the service queues). Secrets are decrypted in memory only.
  - `202` → `SUBMITTED` and store `remote_job_id`.
  - `409 HIGH active` → backoff (30s → 5m).
  - `422` → `BLOCKED`, with `loc` mapped back to form pointers.
  - `401` → mark the environment unhealthy and pause its queue.
  - Crash safety: persist a `submitting` marker before the call. On recovery, reconcile via
    `GET /evals?user_id=<creator>`, matching `eval_input.config.run_metadata.qym_launch.job_id`,
    before any resubmit.
- **Poll** every 10s for the first 5 minutes, then 30s, then 60s. On `SUCCEEDED`, store
  the redacted `result` and `versioning_metadata` (legacy fallback).
- **Merge:** a linked run's `COMPLETED/FAILED/STOPPED` wins over a remote `RUNNING` (D2).
  With no remote change and no run events for 2h15m (7200s hard limit + margin) →
  `TIMED_OUT`.
- **Completion hook:** job terminal + run `COMPLETED` → write `eval_run_scores` (§4.7).
- **Cancel** (see §13.1 for the queue flow): `POST /evals/{id}/cancel` with
  `user_id = qym user id`. A `409` (already terminal) triggers a re-poll. Queued jobs are
  cancelled locally without calling the service.
- **Retry:** clones the job with a new token and a new row, keeping the old one for history.
- `user_id` sent to the service is the experiment creator's qym user id.
- **Remote queue snapshot:** every 30s per active environment (only while it has
  non-terminal jobs from this platform, or a queue page viewed it in the last 5 minutes),
  call `GET /evals?status=PENDING` and `?status=RUNNING` (`limit=500`), strip everything
  except the columns in §4.6a, and upsert the snapshot.

### 13.1 Cancelling from the queue

`cancel_jobs(job_ids, user, reason)`:

1. Permission per job: the experiment creator, or a manager. Others → `forbidden` for that id.
2. `QUEUED`/`BLOCKED` → `CANCELLED` in one transaction, guarded by
   `status IN (…) AND lease_owner IS NULL`. If the dispatcher holds the lease (submitting
   right now), set `cancel_requested_at`. The dispatcher checks it right after `202` and
   immediately cancels remotely.
3. `SUBMITTED`/`RUNNING` → set `cancel_requested_at` and mark the job `CANCELLING`
   (a transient UI status). The dispatcher performs the remote cancel on its next tick
   (not in the HTTP request), so bulk cancels of many jobs don't block the page and get
   retry/backoff.
   - Remote `200` → `CANCELLED`.
   - `409` terminal → re-poll and record the real final status.
   - Transport error → retry, keeping `CANCELLING`.
   - `404` → `CANCELLED` with a note.
4. Linked run: after a remote cancel, the linked qym run is marked `STOPPED` with
   `status_reason = "cancelled_from_queue"` if it hasn't already received a terminal
   event, because a killed worker never sends one.
5. The experiment aggregate status is recomputed. Cancelled jobs can still be retried.
6. Audit-log entry per cancel (existing `AuditLog`).

Returns per-id outcomes: `cancelled | cancelling | forbidden | already_terminal`.

## 14. Experiments API — `api/experiments.py`

| Method | Path | Purpose | Role |
|---|---|---|---|
| POST | `/v1/projects/{pid}/experiments` | create, or `dry_run` preview | member (manager for HIGH) |
| GET | `/v1/projects/{pid}/experiments` | list (status/env/creator filters) | member |
| GET | `…/{xid}` | detail + job matrix + linked run summaries | member |
| POST | `…/{xid}/cancel` · `…/jobs/{jid}/cancel` · `…/jobs/{jid}/retry` | control | creator or manager |
| POST | `…/{xid}/clone` | prefill form (secrets excluded) | member |
| POST | `…/{xid}/jobs/{jid}/save-preset` | save the combo's config as a saved/official preset | member / manager |

Rate limit experiment creation per user.

### 14.1 Queue API

| Method | Path | Purpose | Role |
|---|---|---|---|
| GET | `/v1/projects/{pid}/eval-queue?environment_id=&status=&mine=&experiment_id=` | non-terminal jobs in dispatch order, with `wait_reason` and linked-run progress | member |
| GET | `/v1/projects/{pid}/eval-queue/remote?environment_id=` | latest remote snapshot (§4.6a), own jobs matched, orphans flagged | member |
| POST | `/v1/projects/{pid}/eval-queue/remote/cancel` | `{environment_id, remote_job_ids: [...]}`; orphans only (ids matching a local job are refused and must go through `/cancel`) | manager |
| POST | `/v1/projects/{pid}/eval-queue/cancel` | body `{job_ids: [...], reason?}` (max 200) or `{experiment_id, statuses: ["QUEUED"]}`; per-id outcomes (§13.1) | creator per job, or manager |

## 15. Security checklist

- Env keys and ad-hoc keys are Fernet-encrypted, never returned, never logged, and never
  stored in `spec`, `params`, `qym_config` or remote-response copies.
- Refuse environment creation without `QYM_LLM_CONFIG_ENCRYPTION_KEY` (same rule as LLM
  connections).
- HTTPS-only environment URLs unless `QYM_ALLOW_PRIVATE_LLM_BASE_URLS`; SSRF-safe
  transport.
- Connection keys go only to environments with `allow_connection_keys`, and only a manager
  can enable it.
- Redact `LLM_OVERRIDES.endpoints.*.api_key` in every remote response before storing or
  returning it (D1).
- Launch token is one-time and stripped. The `qym_*` run_metadata keys are reserved and
  user input may not set them.
- `HIGH` is gated by cap, role and acknowledgement.
- An environment URL is bound to one project, and ingest rejects official status for runs
  arriving in any other project.
- Cancelling orphan remote jobs (no local job row) is manager-only and audit-logged.

## 16. Phasing

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0** | Raise D1–D3, D5–D7, D9 with the service team; agree D6 | Written answers; D1/D2 scheduled |
| **P1 Environments** | Migration (env, schema, slot tables; connection flag; unique `base_url`), client, CRUD/test/refresh, form descriptor, slot detection + confirmation, Settings → Environments | Register two envs, see their generated forms, confirm slots |
| **P2 Single launch + origin + queue** | Experiment/job tables, dispatcher, launch form without sweeps (blank base), model binding incl. temporary models, advanced panel (evaluation inputs + role overrides + raw JSON), ingest linking, `runs.origin`, Origin facet, queue page + cancel (§13.1) + remote snapshot | One official run end-to-end with a project model bound to `primary`; a queued and a running job cancelled from the queue page |
| **P3 Official defaults** | Preset tables, publish/history UI, "Run official defaults", schema re-mapping | Manager publishes v1; a member launches it in one click |
| **P4 Sweeps** | Sweep values, linked groups, grid expansion, cap, `dry_run` preview, experiment matrix | 2 models × 2 thresholds × 2 envs = 8 runs from one submit |
| **P5 Best run** | `eval_run_scores` + completion hook + backfill, ranking API, "Start from best run", promote-to-official | Launch from best run reproduces its config; drift warnings shown |
| **P6 Hardening** | Multi-pod lease test, load test, CLI `--origin`, docs (`USER_GUIDE.md`, `OPERATIONS.md` runbook) | Runbook merged |

## 17. Tests (`tests/platform/`)

- `test_eval_schema_form.py`: `$ref`/`anyOf` resolution, map/collection handling, role table
  collapse, grouping, unknown fields → Other, the guide's example schema.
- `test_eval_model_slots.py`: structural + name-based detection, `primary` required,
  drift → stale/proposed, confirmation persistence.
- `test_eval_sweeps.py`: grid, linked groups, cap, per-env validation, cross-field rules,
  secrets never leaking into `params`/`qym_config`/responses.
- `test_eval_presets.py`: versioning immutability, one official per env, re-mapping across
  schema hashes, deleted connection handling.
- `test_eval_best_run.py`: eligibility (origin, dataset, status, error ratio), direction,
  tie-breakers, legacy `versioning_metadata` fallback.
- `test_eval_service_client.py`: `httpx.MockTransport` for 202/401/404/409 (both kinds)/422/5xx.
- `test_eval_dispatcher.py`: no in-flight cap, HIGH backoff, poll backoff, merge with run
  status, TIMED_OUT, cancel, crash-mid-submit reconcile, two workers never double-submit.
- `test_eval_queue.py`: ordering and `wait_reason`, permissions (creator vs manager vs
  other member), bulk cancel with mixed statuses, cancel racing a submit (lease held →
  cancel right after `202`), `CANCELLING` retry on transport error, linked run marked
  `STOPPED`, remote snapshot redaction (no `env_overrides`/`eval_input` stored), orphan
  detection, and orphan cancel (manager only; refused for ids that match a local job).
- `test_eval_temporary_models.py`: key encrypted and cleared after terminal, never in
  `qym_config`/clone/preset, blocked for envs without `allow_connection_keys`, "save to
  project models" path, best-run reload leaves the slot unbound.
- `test_eval_run_linking.py`: valid token in the env's project → official; run arriving
  in a different project → local + environment `health_error`; replayed token, wrong job,
  missing job → local; token stripped; summary merge can't re-add the token.
- `test_eval_environments_api.py` / `test_experiments_api.py`: permissions (member vs
  manager), key masking, connection-key opt-in, HIGH gating, duplicate `base_url` across
  projects refused.
- `test_migrations.py`: extend for 0058 up/down and `origin` backfill.
- `test_design_language.py` must pass for all new/changed dashboard files.

## 18. Open questions

None outstanding.

Resolved (2026-09-29):
- **Project routing (D4):** each environment ingests with its own project's qym API key, so
  runs arrive in the right project. qym verifies this instead of re-homing runs (§11), and
  an environment URL belongs to exactly one project (§4.1).
- **Access (D8):** qym is the Evaluation Service's only caller. The remote queue shows all
  jobs, and managers can cancel orphans (§12.2a).
- Also: best-run ranking was first limited to the launch form's dataset **version**.
  Since 2026-10-02 the user chooses the scope before retrieval (dataset, version,
  versioning), and an unchosen part is open, up to a global ranking (§10.2);
promote-to-official always opens the editor for review; caps of 64 jobs per sweep and 5
in-flight per environment accepted; users may add **temporary models** (§7.5).
