# Evaluation Service API — Integration Guide

Source: `src/evaluation_service/api.py` (router), mounted by `src/evaluation_service/main.py`.

This service accepts evaluation-run requests, persists them, hands them off to a Celery
worker fleet, and lets callers poll for status/results. It never runs an eval inline —
`POST /evals` always returns immediately.

---

## 1. Base URL, mounting, and auth

- Router prefix: **`/evals`** (set in `api.py` via `APIRouter(prefix="/evals", ...)`).
- `main.py` optionally adds a further prefix from the `EVAL_SERVER_PREFIX` env var, so the
  real path is:
  - `{EVAL_SERVER_PREFIX}/evals/...` if that env var is set, otherwise
  - `/evals/...`
  Confirm with whoever deploys the service which one applies to your environment.
- **Every request must carry an API key**, enforced by `APIKeyMiddleware` in `main.py`
  *before* it reaches the router:

  ```
  Authorization: Bearer <EVAL_API_KEY>
  ```

  The middleware compares the token verbatim against the server's `EVAL_API_KEY` env var.
  A missing or mismatched header returns **401** with `{"detail": "Invalid or missing API key"}`
  for *every* route, including ones that don't otherwise exist — the check runs first.

- Content type: `application/json` for all request bodies.

---

## 2. Job lifecycle

Jobs move through a fixed state machine, stored in Postgres (`eval_jobs.eval_jobs` table)
and mirrored in every response:

```
PENDING → RUNNING → SUCCEEDED
                   → FAILED        (*see caveat in §6*)
        → CANCELLED (only while PENDING or RUNNING)
```

- `POST /evals` creates the row as `PENDING` and enqueues a Celery task (`run_eval_job`)
  on the `evals` queue. It returns as soon as the DB row is committed and the task is
  handed to the broker — **it never waits for the eval to run.**
- A Celery Beat task (`dispatch_pending_jobs`) re-enqueues any `PENDING` job every 60s as
  a crash-recovery net, in case the initial `.delay()` call failed to reach the broker.
- The worker flips the row to `RUNNING` (stamping `started_at`) right before it starts
  building the agent/evaluator, and to `SUCCEEDED` (stamping `finished_at`, `result`,
  `exit_code=0`) once the run and its analysis finish.
- Cancellation is **cooperative metadata only**: `POST /evals/{id}/cancel` flips the DB
  status to `CANCELLED`, but if the worker has already picked the job up and moved it to
  `RUNNING`, the running process is *not* interrupted. The one place cancellation is
  actually checked is at the top of `run_eval_job`, so it only reliably stops a job that
  is still `PENDING` when the worker dequeues it.
- Typical run time is bounded by Celery's task time limits: soft limit ~6900s, hard limit
  7200s (`celery_app.py`). Design your polling/timeout strategy around a ~2 hour ceiling.

### 2.1 Priority preemption

Every job carries a `priority`: `LOW`, `NORMAL` (default), or `HIGH`. `HIGH` is a hard
preemption tier:

> **Two layers, not one — a broker-native layer for ordering, plus an application-layer
> kill switch for `HIGH`.**
>
> Kombu's SQLAlchemy transport — this service's *original* broker
> (`sqla+postgresql://...`, `celery_app.py`) — states in its own module docstring
> "**Supports Priority: no**", and its `_get` dequeues with a plain `ORDER BY sent_at, id`:
> strict FIFO, no priority column on the message table at all.
> ([source](https://github.com/celery/kombu/blob/main/kombu/transport/sqlalchemy/__init__.py))
> So on that broker, `LOW` and `NORMAL` jobs were indistinguishable in dequeue order —
> only `HIGH`'s kill/reject behavior (below) did anything.
>
> This service is moving to Redis as its broker, which *does* support real message
> priority, and the code is wired to take advantage of it as soon as `CELERY_BROKER_URL`
> points at Redis (no further code change needed at cutover) — each of
> the 3 tiers is mapped (`models.JOB_PRIORITY_TO_CELERY`) onto Redis's native 0–9 priority
> scale (**0 is highest**, the reverse of RabbitMQ) and passed on every dispatch via
> `run_eval_job.apply_async(args=[...], priority=...)`, in both `api.py` and the
> crash-recovery path in `tasks.dispatch_pending_jobs`. `celery_app.py` configures
> `broker_transport_options` with `priority_steps=[0, 5, 9]` (one Redis list per tier
> under the `evals` queue) and — critically — `queue_order_strategy: "priority"`, which
> Celery's own docs say is required for Redis priority to do anything at all; it is *not*
> a default even on Redis. `worker_prefetch_multiplier=1` (already set here, for an
> unrelated fairness reason) is also load-bearing for this: a higher prefetch would let a
> worker grab a batch of low-priority messages before a higher-priority one ever reaches
> the broker. This is all gated on `BROKER_URL.startswith("redis")`, so it's inert (and
> Celery docs call even the Redis case "approximate at best" — it's still emulated via
> separate lists, not true broker-level priority the way RabbitMQ's `x-max-priority` is)
> if the broker is ever something else again.
>
> **This ordering layer is a *scheduling preference*, not a guarantee** — it decides which
> queued message a worker pulls next when a slot frees up. It does nothing to a job that's
> already `RUNNING`, and doesn't reject new submissions. That stronger behavior — kill
> what's running, refuse what's below it — is what `HIGH` gets on top, described next, and
> that part is unconditional: it doesn't depend on the broker at all.

- **Submitting a `HIGH` priority job immediately kills every other active job ranked
  below `HIGH`** (any `LOW` or `NORMAL` job that is `PENDING` or `RUNNING`, regardless of
  which user issued it). A `RUNNING` victim is hard-terminated — the worker OS process
  executing it is sent a kill signal via Celery's `control.revoke(..., terminate=True)`,
  stopping it mid-execution; a `PENDING` victim is simply marked `CANCELLED` before a
  worker ever picks it up. Both end up `status="CANCELLED"` with
  `error="preempted by higher-priority job <id>"`.
- **While any `HIGH` job is `PENDING` or `RUNNING`, `POST /evals` rejects (409) any new
  submission below `HIGH`.** Submissions *at* `HIGH` are always accepted — `HIGH` jobs
  never block or preempt each other; any number can run concurrently.
- Once every `HIGH` job has reached a terminal status (`SUCCEEDED`/`FAILED`/`CANCELLED`),
  lower-priority submissions are accepted again automatically — there's no separate lock
  to release; each `POST /evals` just checks "is any `HIGH` job currently active?" live.

⚠️ **Two things worth knowing before depending on this:**
1. **Broker reliability is unverified for this deployment.** Real termination depends on
   Celery's control channel actually delivering `revoke(terminate=True)` to the correct
   worker process. Celery's remote-control commands are built on the broker's pub/sub —
   Redis (this service's target broker) supports this natively and is the common,
   well-tested case; kombu's SQLAlchemy transport (the *original* broker) supports control
   commands only via polling and is far less proven for it. So the Redis move should make
   this *more* reliable, not less — but confirm in staging either way that a `RUNNING`
   low-priority job actually dies (not just gets marked `CANCELLED` in the DB) before
   depending on it in production.
2. **There's a small race window.** Preemption reads active lower-priority jobs and then
   updates them with no row locking in between. A job that flips `PENDING → RUNNING` (and
   gets assigned a worker process) in that window can end up marked `CANCELLED` without
   actually being killed — it will keep running to completion despite the status saying
   otherwise. Rare in practice, but don't build safety-critical assumptions on it.

Manual cancellation (`POST /evals/{job_id}/cancel`, §3.5) uses this same hard-kill
mechanism now — both paths call the same `_terminate_if_running` helper, so the broker-
reliability caveat and the "small race window" note above apply equally to it.

---

## 3. Endpoints

### 3.1 `POST /evals` — create and enqueue an eval job

- **Status code:** `202 Accepted`
- **Request body:** `EvalJobCreate` (see §4) — **`user_id` is required**; the job row is
  linked to this user (`EvalJob.user_id`) for the lifetime of the job. `priority`
  (`LOW`/`NORMAL`/`HIGH`) is optional, defaulting to `NORMAL` — see §2.1 for what `HIGH`
  does.
- **`qym_api_key` is required for qym integrations:** a qym platform API key that
  belongs to **the user submitting the job** (the same user as `user_id`), scoped to the
  qym project the run should land in. The worker hands it to the qym SDK
  (`QYM_API_KEY`) so the run it uploads is authenticated as that user, in that
  project. See §4 for how to treat it (it is a secret).
- **Response body:** `EvalJobRead` (see §5)
- **Status code `409`** if `priority` is below `HIGH` and a `HIGH` priority job is
  currently active (§2.1) — `{"detail": "cannot accept <priority> priority job while HIGH
  priority job <id> is active"}`.

```bash
curl -sS -X POST "$BASE_URL/evals" \
  -H "Authorization: Bearer $EVAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "user_id": "user-123",
        "qym_api_key": "qym_...key of user-123...",
        "priority": "HIGH",
        "evaluator": {
          "dataset": "my-dataset-id",
          "model": "gpt-4o",
          "config": {
            "run_name": "smoke-test",
            "samples": 3,
            "report_k": 1,
            "max_concurrency": 5
          }
        }
      }'
```

Omitting `user_id` returns **422**. Omitting `priority` defaults to `NORMAL`.

Response (`202`):

```json
{
  "id": "5b1e...uuid...",
  "status": "PENDING",
  "priority": "HIGH",
  "user_id": "user-123",
  "cancelled_by_user_id": null,
  "created_at": "2026-09-27T10:00:00+00:00",
  "updated_at": null,
  "env_overrides": {},
  "eval_input": {
    "dataset": "my-dataset-id",
    "dataset_version": null,
    "config": { "...": "full merged EvaluatorRequestConfig, with defaults filled in" },
    "model": "gpt-4o",
    "report_k": null
  },
  "result": null,
  "error": null
}
```

### 3.2 `GET /evals` — list jobs (paginated, filterable)

| Query param | Type                     | Default | Notes |
|---|---|---|---|
| `status` | `PENDING\|RUNNING\|SUCCEEDED\|FAILED\|CANCELLED` | none | exact match; omit for all statuses |
| `user_id` | `str` | none | exact match; omit to list jobs for all users |
| `priority` | `LOW\|NORMAL\|HIGH` | none | exact match; omit for all priorities |
| `limit`  | int, `1..500` | `50` | page size |
| `offset` | int, `>=0`    | `0`  | page offset |

Ordered by `created_at desc` (newest first).

```bash
curl -sS "$BASE_URL/evals?status=SUCCEEDED&user_id=user-123&limit=20&offset=0" \
  -H "Authorization: Bearer $EVAL_API_KEY"
```

Response (`200`):

```json
{
  "total": 137,
  "limit": 20,
  "offset": 0,
  "items": [ { "...": "EvalJobRead-shaped dict" }, "..." ]
}
```

An invalid `status` value (e.g. `?status=DONE`) returns **422** (FastAPI/Pydantic enum
validation). `GET /evals` performs no ownership filtering on its own — pass `user_id`
explicitly if you want to scope results to one user; nothing stops a caller from listing
every user's jobs.

### 3.3 `GET /evals/env-overrides/schema` — introspect the env-overrides schema

Returns the full JSON Schema (Pydantic `model_json_schema()`, draft 2020-12 shape, with
`$defs` for nested objects) for the `env_overrides` object accepted by `POST /evals`. Use
this so an integrating app can discover the whitelist of overridable env vars, their
types, enums, and numeric constraints (e.g. `MILVUS_SEARCH_THRESHOLD`'s `0..1` range, or
that `LLM_OVERRIDES.endpoints` must be non-empty) programmatically, instead of hardcoding
§4.3 by hand or reading `env_spec.py`.

```bash
curl -sS "$BASE_URL/evals/env-overrides/schema" \
  -H "Authorization: Bearer $EVAL_API_KEY"
```

Response (`200`, abbreviated):

```json
{
  "$defs": {
    "EndpointConfig": { "additionalProperties": false, "properties": { "...": "..." } },
    "RoleConfig": { "...": "..." },
    "LlmOverrides": { "...": "..." },
    "ResponseFormat": { "...": "..." }
  },
  "additionalProperties": false,
  "properties": {
    "LLM_OVERRIDES": { "anyOf": [ { "$ref": "#/$defs/LlmOverrides" }, { "type": "null" } ] },
    "MILVUS_SEARCH_THRESHOLD": { "anyOf": [ { "maximum": 1.0, "minimum": 0.0, "type": "number" }, { "type": "null" } ] },
    "...": "one entry per whitelisted env var in §4.3"
  },
  "title": "EnvOverrides",
  "type": "object"
}
```

This route is registered at a two-segment path (`/env-overrides/schema`) specifically so
it can never be shadowed by or collide with the single-segment `/{job_id}` route.

### 3.4 `GET /evals/{job_id}` — fetch one job

- `job_id` is a UUID path param (invalid UUID → **422**).
- Returns **404** `{"detail": "eval job not found"}` if no such job exists.

```bash
curl -sS "$BASE_URL/evals/5b1e...uuid..." \
  -H "Authorization: Bearer $EVAL_API_KEY"
```

This is the endpoint to poll after creating a job — poll until `status` is one of
`SUCCEEDED`, `FAILED`, `CANCELLED`.

### 3.5 `POST /evals/{job_id}/cancel` — request cancellation

- **Request body:** `{"user_id": "<str>"}` — **required**. This is recorded on the job
  as `cancelled_by_user_id` for audit/traceability **only** — cancelling is *not*
  restricted to the `user_id` that created the job. Any caller with a valid API key can
  cancel any job, regardless of who issued it; there is no ownership check.
- Returns **404** if the job doesn't exist.
- Returns **409** `{"detail": "cannot cancel job in status <status>"}` if the job is
  already in a terminal state (`SUCCEEDED`/`FAILED`/`CANCELLED`) — cancel is only valid
  from `PENDING` or `RUNNING`.
- **Hard-terminates a `RUNNING` job.** Same mechanism as priority preemption (§2.1): if
  the job is currently `RUNNING`, the worker OS process executing it is sent
  `celery_app.control.revoke(celery_task_id, terminate=True)` *before* the row is updated.
  A `PENDING` job has no process yet, so it's just marked `CANCELLED` — it self-skips the
  moment a worker dequeues it. Same broker-reliability caveat as §2.1 applies — verify in
  staging that the worker process actually dies.
- On success, flips status to `CANCELLED`, stamps `cancelled_by_user_id` and
  `finished_at`, and returns the updated `EvalJobRead`.

```bash
curl -sS -X POST "$BASE_URL/evals/5b1e...uuid.../cancel" \
  -H "Authorization: Bearer $EVAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "user-123"}'
```

---

## 4. Request schema — `EvalJobCreate`

```
EvalJobCreate
├── user_id:       str                      # required, min_length=1 — links the job to a caller
├── qym_api_key:   str                      # qym API key of the submitting user (secret) — see below
├── priority:      LOW | NORMAL | HIGH = NORMAL   # optional — see §2.1 for HIGH's preemption behavior
├── env_overrides: EnvOverrides = {}        # optional, whitelisted env-var overrides
└── evaluator:     EvaluatorInputs          # required
```

### 4.0 `qym_api_key`

| Field | Type | Required | Notes |
|---|---|---|---|
| `qym_api_key` | `str` | **yes, for qym integrations** | qym platform API key of the user who submits the job (the same user as `user_id`), scoped to the target qym project. The worker uses it as the qym SDK's `QYM_API_KEY` when it uploads the run, so the run is created as that user in that project. |

Rules for callers and for the service:
- **Per submitting user.** Never pass a shared or service-account key: the key decides
  who owns the uploaded run and which project it lands in, so it must point to the user
  in `user_id`.
- **It is a secret.** Send it only over HTTPS. The service must not log it or echo it
  back in `EvalJobRead` (the same concern as D1 for `LLM_OVERRIDES.endpoints.*.api_key`);
  callers should still redact it from anything they store.
- **Lifetime.** The key has to stay valid until the job reaches a terminal status and the
  run upload has finished. A caller that mints a key per job should revoke it only after
  that.

### 4.1 `evaluator` (`EvaluatorInputs`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `dataset` | `str` | **yes** | dataset id/path, or an inline dataset object as a string per your dataset loader's convention |
| `dataset_version` | `str` | no | |
| `model` | `str` or `List[str]` | no | falls back to the worker's `MODEL` env var if omitted |
| `config` | `EvaluatorRequestConfig` | no | overlaid on the server's default eval config |
| `report_k` | `int, >=1` | no | top-level convenience; must be `<= samples` (validated) |

> **Note:** a `metrics` field exists on the underlying evaluator and is read by the worker
> (`eval_input.get("metrics")`), but it is currently commented out of this schema, so there
> is **no way to select a metric subset through the API today** — every job runs the full
> default metric set. Don't rely on passing `metrics` in the body; it will be silently
> dropped (extra fields on `EvaluatorInputs` are ignored, not rejected).

Cross-field validation: if both a top-level `report_k` and `config.report_k`/`config.samples`
are present, the *effective* `report_k` (top-level wins) must not exceed `config.samples`,
or the request is rejected with **422**.

### 4.2 `evaluator.config` (`EvaluatorRequestConfig`)

`extra="forbid"` — **any unrecognized key in `config` is a 422**, not a silent no-op. Fields:

| Field | Type | Default |
|---|---|---|
| `run_name` | `str \| null` | `null` |
| `task_name` | `str \| null` | `null` |
| `max_concurrency` | `int >= 1` | `10` |
| `max_metric_concurrency` | `int >= 1` | `1` |
| `timeout` | `float > 0 \| null` | `300` |
| `metric_timeout` | `float > 0 \| null` | `180.0` |
| `metric_max_retries` | `int >= 0` | `2` |
| `max_retries` | `int >= 0` | `2` |
| `samples` | `int >= 1` | `1` |
| `report_k` | `int >= 1 \| null` | `null` — must be `<= samples` |
| `run_metadata` | `dict` | `{}` |
| `git_branch` / `git_commit` | `str \| null` | `null` |
| `model` / `model_full` | `str \| null` | `null` |
| `models` | `List[str] \| null` | `null` — also accepts a comma-separated string, e.g. `"gpt-4o,gpt-4o-mini"`, normalized into a list |
| `force_model_override` | `bool` | `false` |
| `dataset_version` / `dataset_alias` | `str \| null` | `null` |
| `live_mode` | `"local" \| "platform" \| "auto"` | `"platform"` |

Deliberately **not** accepted here (server-owned): `should_stop`, `ui_port`,
`cli_invocation`, `output_dir`, checkpoint/resume settings, `otel_*`, `phoenix_*`,
`platform_*`.

### 4.3 `env_overrides` (`EnvOverrides`)

A strict, exhaustive whitelist of environment variables a single run may override in the
worker process — everything else (`POSTGRESQL_*`, Redis/broker settings, `AUTH_URL_JWKS`,
etc.) is immutable and cannot be pushed through this field. `extra="forbid"` — an
unlisted key is a **422**. Booleans accept real booleans or the strings
`"true"/"1"/"yes"` / `"false"/"0"/"no"`.

Whitelisted variables (all optional):

- **LLM routing:** `LLM_OVERRIDES` (structured object, see below)
- **Feature toggles:** `ENABLE_RESPONSE_DRAFTING`, `BRIEF_ENABLED`,
  `SKILL_TRIGGERS_ENABLED`, `ROUTER_SKILL_HINTS_ENABLED`, `SKILL_TOOL_ENABLED`,
  `VIZ_ENFORCEMENT_ENABLED`
- **Table selection / RAG:** `TABLE_SELECTION_MODE` (`rag`\|`llm_direct`\|`pure_llm`),
  `USE_LLM_TABLE_SELECTION`, `RAG_ITERATION` (`""`, `"latest"`, or a number string),
  `MILVUS_SEARCH_THRESHOLD` (0–1)
- **SQL runner:** `SQL_RESULT_LIMIT` (1–100000)
- **Context management:** `CONTEXT_MAX_TOKENS`, `CONTEXT_COMPACT_THRESHOLD` (0–1),
  `CONTEXT_KEEP_RECENT`
- **Visualization pipeline:** `VIZ_LLM_ENABLED`, `VIZ_LLM_TIMEOUT`,
  `VIZ_LLM_MIN_CONFIDENCE` (0–1), `VIZ_LLM_MODEL`, `VIZ_SEMANTIC_INFERENCE_ENABLED`,
  `VIZ_DATA_TRANSFORM_ENABLED`, `VIZ_MAX_CATEGORIES` (>=2), `VIZ_MAX_GROUPS` (>=2),
  `VIZ_DIVERSITY_ENABLED`
- **Misc:** `REQUEST_TIMEOUT` (0 < x <= 3600)

#### `LLM_OVERRIDES` shape

```jsonc
{
  "endpoints": {                 // required, at least one entry
    "primary": {                 // "primary" MUST exist — agent defaults fall back to it
      "model": "gpt-4o",
      "base_url": "https://...",
      "api_key": "sk-...",
      "timeout": 60,
      "max_attempts": 3,
      "max_connections": 100,     // optional
      "max_keepalive": 20,        // optional
      "connect_timeout": 5        // optional
    }
  },
  // Any of these role blocks may be present; each is optional and independently shaped:
  "main": { "endpoint": "primary", "temperature": 0.2, "max_tokens": 4096,
            "reasoning_enabled": true, "reasoning_effort": "medium",
            "top_p": 0.9, "seed": 42,
            "response_format": { "type": "json_object" } },
  "router": { "...": "same RoleConfig shape" },
  "brief": {}, "drafting": {}, "finalize": {}, "audit": {}, "compaction": {},
  "table_selector_rerank": {}, "table_selector_decide": {},
  "report_sub_agent": {}, "report_definition_sub_agent": {}, "report_planner": {},
  "report_definition_extractor": {}, "report_summary": {},
  "chart_suggester_detailed": {}, "chart_suggester_quick": {},
  "out_of_scope": {}, "spatial_join_dedup": {}, "spatial_join_infer": {},
  "question_alignment": {}, "followup_suggester": {}, "input_completion": {},
  "cot_summarizer": {}, "conversation_title": {}
}
```

Validation rules enforced at request time (422 on violation):
- `endpoints` must be non-empty and must contain the key `"primary"`.
- Every role's `endpoint` (if set) must reference a key that exists in `endpoints`.
- Every field on `EndpointConfig`/`RoleConfig` is validated (types, ranges) and
  `extra="forbid"` applies at every level — typo a key and you get a 422, not a silently
  ignored field.

Server-side, this whole object is re-serialized to a single compact JSON string and set as
the `LLM_OVERRIDES` env var in the worker process before any agent code is imported.

---

## 5. Response schema — `EvalJobRead`

```jsonc
{
  "id": "uuid-string",
  "status": "PENDING | RUNNING | SUCCEEDED | FAILED | CANCELLED",
  "priority": "LOW | NORMAL | HIGH",
  "user_id": "user-123",
  "cancelled_by_user_id": null,
  "created_at": "2026-09-27T10:00:00+00:00",
  "updated_at": null,
  "env_overrides": { "...": "flattened {ENV_VAR: string} dict, as stored" },
  "eval_input": { "...": "the validated evaluator input, as stored" },
  "result": null,
  "error": null
}
```

`user_id` is set once at creation and never changes. `cancelled_by_user_id` stays `null`
until `POST /evals/{job_id}/cancel` is called, at which point it's set to whatever
`user_id` was supplied in the cancel request body — which is **not necessarily the same**
as the creating `user_id` (see §3.5). Both fields are `null` for jobs created before this
column existed (nullable at the DB level for migration safety).

Once `status` reaches `SUCCEEDED`, `result` is populated with the analysis payload built
by `runner.py`'s `_analyze_report`, always including at least:

```jsonc
{
  "run_name": "...",
  "dataset": "...",
  "versioning_metadata": {
    "agent_version": "... or null",
    "kb_version": "... or null"
  },
  "analysis_metric": "accuracy",
  // plus whatever analyze_group_runs returns, e.g.:
  "pass_at_k": "...", "pass_hat_k": "...", "consistency": "...",
  "reliability": "...", "items": "..."
}
```

### ⚠️ Versioning lives in `result.versioning_metadata` — read it from there

`agent_version` and `kb_version` are **not** top-level keys of `result`. Both are nested
inside a single `versioning_metadata` object, so clients must read
`result.versioning_metadata.agent_version` and `result.versioning_metadata.kb_version`.
Reading `result.agent_version` / `result.kb_version` returns `undefined`/`None` without
any error, so a mistake here fails silently and every run looks unversioned.

| Field | Source (in `runner.py`, at job completion) | Can be `null`? |
|---|---|---|
| `versioning_metadata.agent_version` | The worker's `AGENT_VERSION` env var | Yes, if `AGENT_VERSION` isn't set on the worker |
| `versioning_metadata.kb_version` | `get_kb_version()`: the most recent `cms.snapshot` id, whether it was created or reverted to (successful reverts only) | No: a `cms.snapshot` row must exist, or the job fails while writing its result |

Why it matters for integration:
- These two values are what tie an eval result to the exact agent build and knowledge-base
  snapshot it measured. Without them you can't compare runs, spot regressions, or attribute a
  score change to an agent change versus a KB change.
- Both values are captured **when the job finishes**, not when it's submitted. If the KB
  snapshot changes or is reverted while a job is running, `kb_version` shows the snapshot
  that was current at completion.
- Treat the pair as a single versioning key. Store and display `versioning_metadata` as a
  whole, and group or compare runs on both fields together.
- Only `SUCCEEDED` jobs have `result` (and so `versioning_metadata`). It isn't available
  while a job is `PENDING`/`RUNNING`, or for `FAILED`/`CANCELLED` jobs.
- Jobs that finished before this change have the old flat shape (`result.agent_version`,
  `result.kb_version`) in the database. If you read historical jobs, fall back to the flat
  keys when `versioning_metadata` is missing.

### ⚠️ Fields present in the DB row but **not** in the API response

`EvalJob.to_dict()` (what the router actually returns) also includes `exit_code`,
`started_at`, `finished_at`, and `celery_task_id` (the id of the Celery task currently/last
executing this job, used internally by priority preemption — see §2.1). Because the routes
declare `response_model=EvalJobRead`
and that schema doesn't define those fields, **FastAPI strips them out of the
response** — they exist in the database but you will never see them over this API as
currently defined. Likewise, `updated_at` is declared on `EvalJobRead` but there is no
corresponding column or assignment anywhere in the model/worker code, so **`updated_at`
will always serialize as `null`.** If you need `started_at`/`finished_at`/`exit_code`/
`celery_task_id`, they are not reachable through this API today — you'd need a
schema/response-model change on the service side.

---

## 6. Error responses & known caveats

| Status | When |
|---|---|
| `401` | Missing/incorrect `Authorization: Bearer <EVAL_API_KEY>` header (checked for every route by middleware, before routing) |
| `404` | `GET /evals/{job_id}` or `POST /evals/{job_id}/cancel` with an unknown `job_id` |
| `409` | Cancel requested on a job already in a terminal state (`SUCCEEDED`/`FAILED`/`CANCELLED`); or `POST /evals` with `priority` below `HIGH` while a `HIGH` job is active (§2.1) |
| `422` | Body/query fails Pydantic validation — bad UUID, bad enum value, `extra="forbid"` violation in `config`/`env_overrides`/`LLM_OVERRIDES`, `report_k > samples`, etc. FastAPI's default validation error shape (`{"detail": [...]}`) applies |

**Important lifecycle caveat — jobs can get stuck showing `RUNNING` after a real failure.**
In `tasks.py`, the exception-handling branch that would call `_finish(job_id, JobStatus.FAILED, ...)`
and set `job.error` is currently commented out. If `run_job` raises inside the worker, the
task lets the exception propagate to Celery (which will mark the *Celery* task result as
failed internally, and retry/reject per `task_acks_late`/`task_reject_on_worker_lost`), but
**the `eval_jobs` row is never updated to `FAILED`** — it stays at `RUNNING` indefinitely
from the API's point of view, and `error` stays `null`. If you're building a client that
polls this API and expects to observe `FAILED` on a genuine failure, be aware that today it
may not happen; treat a job stuck in `RUNNING` past a reasonable timeout as a probable
failure and don't assume `error` will ever be populated. This is a good thing to confirm
with the service owner before depending on `FAILED`/`error` semantics.

**Cancelling a `RUNNING` job now hard-kills it — via both paths.** Manual
`POST /evals/{job_id}/cancel` and `HIGH` priority preemption (§2.1) share the same
`_terminate_if_running` helper: both send `celery_app.control.revoke(celery_task_id,
terminate=True)` to the worker process actually executing the job, before updating the
row. Both are subject to the same broker-reliability caveat as §2.1 — verify in staging
that the worker process actually dies, don't just trust the `CANCELLED` status.

---

## 7. End-to-end example (Python)

```python
import time
import requests

BASE_URL = "https://your-eval-service.example.com"  # + EVAL_SERVER_PREFIX if configured
HEADERS = {
    "Authorization": f"Bearer {EVAL_API_KEY}",
    "Content-Type": "application/json",
}

def submit_job(user_id: str, qym_api_key: str, dataset: str, model: str,
               samples: int = 1, priority: str = "NORMAL") -> dict:
    resp = requests.post(
        f"{BASE_URL}/evals",
        headers=HEADERS,
        json={
            "user_id": user_id,
            "qym_api_key": qym_api_key,   # qym API key of `user_id` (secret)
            "priority": priority,   # "LOW" | "NORMAL" | "HIGH" — see §2.1
            "evaluator": {
                "dataset": dataset,
                "model": model,
                "config": {"run_name": "ci-smoke", "samples": samples},
            }
        },
    )
    if resp.status_code == 409:
        # a HIGH priority job is currently active and this submission ranked below it
        raise RuntimeError(f"blocked by an active HIGH priority job: {resp.json()}")
    resp.raise_for_status()
    return resp.json()

def cancel_job(job_id: str, user_id: str) -> dict:
    resp = requests.post(
        f"{BASE_URL}/evals/{job_id}/cancel",
        headers=HEADERS,
        json={"user_id": user_id},   # audit trail only — not an ownership check
    )
    resp.raise_for_status()
    return resp.json()

def get_env_overrides_schema() -> dict:
    """Fetch the whitelist of overridable env vars, live from the server."""
    resp = requests.get(f"{BASE_URL}/evals/env-overrides/schema", headers=HEADERS)
    resp.raise_for_status()
    return resp.json()

def poll_job(job_id: str, timeout_s: int = 7200, interval_s: int = 10) -> dict:
    deadline = time.monotonic() + timeout_s
    terminal = {"SUCCEEDED", "FAILED", "CANCELLED"}
    while time.monotonic() < deadline:
        resp = requests.get(f"{BASE_URL}/evals/{job_id}", headers=HEADERS)
        resp.raise_for_status()
        job = resp.json()
        if job["status"] in terminal:
            return job
        time.sleep(interval_s)
    raise TimeoutError(f"job {job_id} did not finish within {timeout_s}s")

job = submit_job(user_id="user-123", qym_api_key=QYM_API_KEY_OF_USER_123,
                 dataset="my-dataset-id", model="gpt-4o")
final = poll_job(job["id"])
if final["status"] == "SUCCEEDED":
    print(final["result"])
else:
    # note: `error` may be null even on failure — see §6 caveat
    print("job ended in", final["status"], final.get("error"))
```

---

## 8. Quick reference

| Method | Path | Purpose | Success code |
|---|---|---|---|
| `POST` | `/evals` | Create + enqueue an eval job (`user_id` and `qym_api_key` of that user required, `priority` optional) | `202` / `409` if blocked by an active `HIGH` job |
| `GET` | `/evals` | List jobs (paginated, `status`/`user_id`/`priority` filters) | `200` |
| `GET` | `/evals/env-overrides/schema` | JSON Schema for `env_overrides` | `200` |
| `GET` | `/evals/{job_id}` | Fetch one job (poll this) | `200` |
| `POST` | `/evals/{job_id}/cancel` | Request cancellation (`user_id` required, audit-only) | `200` |

All paths are relative to `{EVAL_SERVER_PREFIX}/evals` if `EVAL_SERVER_PREFIX` is set on
the server, otherwise `/evals`. All routes require `Authorization: Bearer <EVAL_API_KEY>`.
