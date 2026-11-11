# Live Evaluation Ingest API — Integration Guide v1.2

v1.2 — control document, job progress, worker events, heartbeat `control` block.

v1.1 — chart images. Additive to v1.0; existing producers keep working.

The evaluation worker publishes its configuration, daily counters, evaluated turns,
and active probe results through this API. Writes are synchronous: a successful
response means the transaction has committed. This guide describes
`packages/platform/qym_platform/api/live_ingest.py` and
`packages/platform/qym_platform/services/live_ingest.py`.

---

## 1. Base URL, mounting, and auth

The router prefix is `/v1/projects/{project_id}/live`. Use the project's **ID**,
not its slug. Create a project API key in **Project settings → API keys** and send
it on every request, including reconciliation reads:

```text
Authorization: Bearer <project API key>
Content-Type: application/json
```

Chart image uploads use `Content-Type: image/png` and a raw PNG body instead
(section 3.8).

The key must belong to the project in the path. Its owner must remain active and
retain project access. An archived project refuses ingestion. UI authentication
being disabled in a local deployment does not remove the API-key requirement.

The main app serves these routes when `QYM_MAIN_INCLUDE_INGEST` is enabled. The
ingestion service also serves them under `QYM_INGESTION_PREFIX` (default
`/ingestion`), for example
`/ingestion/v1/projects/{project_id}/live/sources/{key}`. Unprefixed ingestion
routes depend on `QYM_INGESTION_LEGACY_PATHS`. Set `BASE_URL` to the service origin
plus its deployed prefix, without a trailing slash; append the router path once.

During maintenance, **all eleven routes**, including `GET turns/ids`, return
`503` with `{"detail":"Platform is in maintenance mode; retry later"}` and
`Retry-After: 60`. Retain pending data and retry after that delay.

The curl examples below share these shell variables:

```bash
BASE_URL="https://evaluation.example.test"  # append /ingestion if using the alias
API_KEY="replace-with-project-api-key"
PROJECT_ID="replace-with-project-id"
SOURCE="$BASE_URL/v1/projects/$PROJECT_ID/live/sources/example-worker"
DAY="2026-11-01"
```

---

## 2. Producer lifecycle

1. At startup, register a stable source key with its name, environment and worker
   configuration. Reuse that key on restart.
2. Publish the complete metric-spec set at startup and whenever it changes.
3. Create a `running` day row at the start of the worker's reporting day. Refresh
   its complete counters as work progresses. At rollover, re-send the previous
   day with `status: "closed"` and `closed_at`, then open the new day.
4. Send a heartbeat after every poll, including polls that found no turns. Include
   `current_day`, `last_poll_at`, and changed worker metadata.
5. After each evaluation, push the turn and its complete score set. Batch buffered
   turns within the configured cap and inspect every result for rejection.
   After a turn is accepted, upload any chart screenshots using its
   `summary.charts[].ref` values.
6. After each probe sweep, push the canary results with their original check times.
7. On restart or during reconciliation, call `GET .../turns/ids?day=YYYY-MM-DD` and
   compare the returned list with local IDs. Push missing or re-evaluated turns.

Send ISO 8601 timestamps with an explicit UTC offset, preferably `Z`. Stored
timestamps are normalized to UTC; returned timestamps use `Z`. Naive timestamps
are treated as UTC. A source's `day_key_timezone` is informational: send an
explicit turn `day` to implement the worker's reporting boundary. Otherwise the
API takes the date component of `turn_at` **before** converting it to UTC.

Heartbeat liveness uses the platform's **receive time**, not the supplied `at`.
Replaying an old heartbeat therefore makes the source fresh now. Historical
heartbeats cannot simulate past outages. With `current_day`, each receipt adds
one to that day's `polls`; `max_poll_gap_s` records the largest nonnegative gap
between successive source heartbeat receipts. A heartbeat creates a missing day
row, but does not fill the day's worker-owned counters or poll timestamps.

---

## 3. Endpoints

All paths in this section are relative to `/v1/projects/{project_id}/live`.
`key` must match `^[A-Za-z0-9_.:-]{1,100}$`: 1–100 ASCII letters, digits,
underscores, dots, colons or hyphens. Slashes are invalid, including encoded ones.
Dates use `YYYY-MM-DD`.

All typed request objects reject unknown fields (`extra="forbid"`). This includes
source, heartbeat, spec, day, turn, score and canary objects and their enclosing
batches. Explicit JSON dictionaries such as `summary`, `detail`, `worker`,
`parameters`, `meta`, SQL entries and categorical value entries preserve extra
keys. Section 6 gives the exact shared error texts.

Models allow lax scalar coercion, including numeric strings, integral floats for
integers, epoch seconds for datetimes, and a full midnight timestamp for the
`{day}` path. Producers should send the documented types rather than rely on
these conversions.

### 3.1 `PUT /sources/{key}` — register or update the source

```bash
curl -sS -X PUT "$SOURCE" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Evaluation worker","environment":"preprod","worker":{"poll_interval_s":60,"judges":{"a":"judge-a","b":"judge-b"},"eval_code_version":"v1"},"day_key_timezone":"UTC"}'
```

| Field | Type | Required | Limits / default |
|---|---|---|---|
| `name` | string | yes | 1–200 characters |
| `environment` | string | yes | 1–50 characters; free text |
| `product` | string or null | no | Up to 100 characters; default null; optional display label |
| `worker` | object | no | Default `{}`; arbitrary metadata |
| `day_key_timezone` | string | no | 1–40 characters; default `UTC`; no timezone-name validation |

Recommended `worker` keys are `worker_version`, `eval_code_version`, `suite`,
`judges: {a, b}`, `poll_interval_s`, `config_hash`, and `manifest_hash`.

Response (`201` on creation, `200` on replacement):

```json
{"id":"source-uuid","key":"example-worker","name":"Evaluation worker","environment":"preprod","product":null,"worker":{"poll_interval_s":60,"judges":{"a":"judge-a","b":"judge-b"},"eval_code_version":"v1"},"created_at":"2026-11-01T00:00:00Z"}
```

The response always has these seven fields: `id` (UUID string), `key`, `name`,
`environment` (strings), `product` (nullable string), `worker` (object), and
`created_at` (UTC timestamp). It does not echo `day_key_timezone`. Re-registration
preserves the source ID and creation time, and replaces the reported configuration;
omitted optional fields take their defaults.

**Status codes:** `201` created; `200` replaced; `401` missing/invalid key; `403`
project or owner access denied; `409` archived project or database conflict;
`422` invalid body/key; `503` maintenance.

### 3.2 `POST /sources/{key}/heartbeat` — report a poll

```bash
curl -sS -X POST "$SOURCE/heartbeat" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"at":"2026-11-01T00:01:00Z","last_poll_at":"2026-11-01T00:01:00Z","current_day":"2026-11-01","worker":{"eval_code_version":"v1"}}'
```

| Field | Type | Required | Limits / default |
|---|---|---|---|
| `at` | datetime | yes | Worker timestamp; accepted but does not drive liveness |
| `last_poll_at` | datetime or null | no | Default null; replaces source `last_poll_at`, including when omitted |
| `current_day` | date or null | no | Default null; when present, increments that day's heartbeat counters |
| `worker` | object or null | no | Default null; when present, shallow-merges top-level keys into source `worker` |

Response: **`204 No Content`**, empty body. A nested `worker` object such as
`judges` is replaced as a whole when supplied; it is not recursively merged.

**Status codes:** `204` recorded; `401` missing/invalid key; `403` access denied;
`404` source/project absent; `409` archived project or database conflict; `422`
invalid body/key; `503` maintenance.

### 3.3 `PUT /sources/{key}/metric-specs` — replace the metric set

```bash
curl -sS -X PUT "$SOURCE/metric-specs" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"specs":[{"metric_name":"agent_success","group":"quality","label":"Agent success","score_type":"percentage","direction":"maximize","pass_threshold":0.5,"is_primary":true},{"metric_name":"response_latency","group":"latency","label":"Response latency","score_type":"duration","direction":"minimize","unit":"ms","position":1}]}'
```

The required `specs` field is a list of the objects below. An empty list clears the
spec set. There is no list-length cap here. Names must be unique within the set;
duplicate names cause a database conflict. At most one spec may be primary.

| Field | Type | Required | Limits / default |
|---|---|---|---|
| `metric_name` | string | yes | 1–200 characters; identity of the metric |
| `group` | string | yes | 1–50 characters; e.g. `quality`, `diagnosis`, `charts`, `service`, `latency` |
| `label` | string | yes | 1–120 characters; plain display text |
| `score_type` | string | yes | `percentage`, `boolean`, `numeric`, `categorical`, `duration` |
| `direction` | string or null | no | `maximize`, `minimize`, or null (default) |
| `pass_threshold` | number or null | no | Default null; must be finite if supplied |
| `unit` | string or null | no | Up to 80 characters; default null |
| `precision` | integer or null | no | Nonnegative; default null |
| `is_primary` | boolean | no | Default false; at most one true in the set |
| `position` | integer | no | Nonnegative; default 0 |
| `description` | string or null | no | Default null; no explicit text cap |
| `values` | array of objects or null | no | Default null; categorical entries described below |

For categorical metrics, use `values: [{"value":"ok","label":"OK","tone":"accent"}]`.
The presentation contract supports tones `accent`, `success`, `info`, `warning`, `danger`,
`meta` and `neutral` (give each label its own tone: two labels with one tone are
indistinguishable in the mix bar and the trend); the ingest validator accepts arbitrary
objects in this list.
`percentage` scores conventionally use 0–1, boolean scores 0/1, and duration
scores the declared unit. The ingest API does not enforce these metric-specific
ranges or validate score values against categorical entries.

Response (`200`):

```json
{"count":2}
```

`count` is the integer number of specs stored by this replacement. Removed specs
do not delete existing turn scores.

**Status codes:** `200` replaced; `401` missing/invalid key; `403` access denied;
`404` source/project absent; `409` archived project or database conflict (including
duplicate names); `422` invalid body/key or multiple primary metrics; `503` maintenance.

### 3.4 `PUT /sources/{key}/days/{day}` — publish daily counters

```bash
curl -sS -X PUT "$SOURCE/days/$DAY" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"run_ref":"daily-2026-11-01","status":"running","turns_seen":2,"evaluated":2,"failed":0,"incomplete":0,"excluded":0,"first_poll_at":"2026-11-01T00:00:00Z","last_poll_at":"2026-11-01T00:01:00Z","parameters":{"eval_code_version":"v1"}}'
```

All fields are optional; `{}` creates or resets a running day with defaults.

| Field | Type | Required | Limits / default |
|---|---|---|---|
| `run_ref` | string or null | no | Up to 100 characters; default null |
| `status` | string | no | `running` (default) or `closed` |
| `turns_seen` | integer | no | 0–2,147,483,647; default 0 |
| `evaluated` | integer | no | 0–2,147,483,647; default 0 |
| `failed` | integer | no | 0–2,147,483,647; default 0 |
| `incomplete` | integer | no | 0–2,147,483,647; default 0 |
| `excluded` | integer | no | 0–2,147,483,647; default 0 |
| `first_poll_at` | datetime or null | no | Default null |
| `last_poll_at` | datetime or null | no | Default null |
| `closed_at` | datetime or null | no | Default null; send explicitly when closing |
| `parameters` | object | no | Default `{}`; recorded worker configuration |

Response (`200`, both creation and replacement):

```json
{"id":"day-uuid","source_id":"source-uuid","day":"2026-11-01","run_ref":"daily-2026-11-01","status":"running","turns_seen":2,"evaluated":2,"failed":0,"incomplete":0,"excluded":0,"first_poll_at":"2026-11-01T00:00:00Z","last_poll_at":"2026-11-01T00:01:00Z","closed_at":null,"polls":1,"max_poll_gap_s":0,"parameters":{"eval_code_version":"v1"}}
```

The response echoes all request fields after defaults and UTC normalization, plus
`id`, `source_id` (UUID strings), `day` (date), `polls` and `max_poll_gap_s`
(nonnegative integers). The last two are maintained by heartbeats and survive
day replacement. This endpoint replaces worker counters; it does not add to them
or infer them from turns. `status: "closed"` alone does not set `closed_at`.

**Status codes:** `200` stored; `401` missing/invalid key; `403` access denied;
`404` source/project absent; `409` archived project or database conflict; `422`
invalid body/key/day; `503` maintenance.

### 3.5 `POST /sources/{key}/turns` — publish evaluated turns

```bash
curl -sS -X POST "$SOURCE/turns" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"turns":[{"turn_id":"turn-1","day":"2026-11-01","turn_at":"2026-11-01T00:00:10Z","status":"completed","question":"How many records are in the sample?","answer":"There are 24 records.","scores":[{"metric_name":"agent_success","score_numeric":1.0}]}]}'
```

The body has one required field, `turns`, a list of 1 to
`QYM_LIVE_TURN_BATCH_MAX` entries (default 100). Section 4 defines each Turn.
Individual invalid entries are rejected without preventing valid entries from
being stored. Even a batch in which every turn is rejected returns `200`.

Response (`200`):

```json
{"accepted":1,"updated":0,"rejected":0,"results":[{"turn_id":"turn-1","status":"created","error":null,"notes":[]}]}
```

| Response field | Type | Meaning |
|---|---|---|
| `accepted` | integer | Newly created turns; excludes replacements |
| `updated` | integer | Successful replacements |
| `rejected` | integer | Rejected entries; no change stored for each rejected entry |
| `results` | array | One entry per input, in input order, including duplicate IDs |
| `results[].turn_id` | string or null | Supplied string ID, or null when unavailable |
| `results[].status` | string | `created`, `updated`, or `rejected` |
| `results[].error` | string or null | Null on success; one-line validation/database error on rejection |
| `results[].notes` | array of strings | Nonfatal notes, e.g. `unknown metric accuracy` or `detail truncated` |

**Status codes:** `200` batch processed (inspect rejections); `401` missing/invalid
key; `403` access denied; `404` source/project absent; `409` archived project or
batch commit conflict; `422` malformed JSON, invalid envelope/key, empty/non-list
`turns`, or batch above the configured cap; `503` maintenance. Turn-field
validation failures appear inside `200`, not as HTTP `422`.

### 3.6 `POST /sources/{key}/canaries` — publish active probes

```bash
curl -sS -X POST "$SOURCE/canaries" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"results":[{"canary":"sql_execution","checked_at":"2026-11-01T00:02:00Z","status":"ok","latency_ms":24.5,"detail":{"rows":1},"eval_code_version":"v1"}]}'
```

The required `results` list contains these objects. An empty list is allowed;
there is no explicit list-length cap. Invalid entries reject the whole request
with `422`; canaries do not use per-entry rejection reports.

| Field | Type | Required | Limits / default |
|---|---|---|---|
| `canary` | string | yes | 1–50 characters; stable probe name |
| `checked_at` | datetime | yes | Original probe check time |
| `status` | string | yes | `ok`, `failed`, or `skipped` |
| `fault` | string or null | no | Up to 20 characters; default null; free text |
| `latency_ms` | number or null | no | Default null; milliseconds; must be finite if supplied |
| `detail` | object | no | Default `{}`; no live-turn detail cap applied here |
| `eval_code_version` | string or null | no | Up to 100 characters; default null |

Response (`200`):

```json
{"accepted":1}
```

`accepted` counts newly inserted checks. An existing `(source, canary, checked_at)`
after UTC normalization is ignored, including duplicates within the same request;
it is not replaced. A repeated request can therefore return `{"accepted":0}`.

**Status codes:** `200` processed; `401` missing/invalid key; `403` access denied;
`404` source/project absent; `409` archived project or database conflict; `422`
invalid envelope, canary or key; `503` maintenance.

### 3.7 `GET /sources/{key}/turns/ids?day=YYYY-MM-DD` — reconcile a day

```bash
curl -sS "$SOURCE/turns/ids?day=$DAY" -H "Authorization: Bearer $API_KEY"
```

No body. The `day` query parameter is required and must be a date. The source
must exist; a day with no matching turns returns an empty list even if no day row
exists. Selection uses each turn's stored reporting day, not its timestamp.

Response (`200`), sorted by `turn_id`, without pagination:

```json
{"turn_ids":["turn-1","turn-2"]}
```

`turn_ids` is an array of strings.

**Status codes:** `200` listed; `401` missing/invalid key; `403` access denied;
`404` source/project absent; `409` archived project; `422` missing/invalid day or
invalid key; `503` maintenance.

### 3.8 `PUT /sources/{key}/turns/{turn_id}/charts/{ref}/image` — upload a chart screenshot

Send the PNG as the raw request body with `Content-Type: image/png` and the
project API key. Do not JSON-encode, base64-encode or wrap it in multipart form
data. The turn must already exist, and `ref` must match one of its
`summary.charts[].ref` values: that reference links the screenshot to the chart.

```bash
curl -sS -X PUT "$SOURCE/turns/turn-1/charts/chart-1/image" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: image/png" \
  --data-binary @chart.png
```

Response: `204 No Content` on both creation and replacement. Repeating the PUT
for the same turn and ref replaces the stored bytes and image metadata. It does
not consume another image slot, even when the turn is at its image limit.

The platform limits each image to `QYM_LIVE_CHART_IMAGE_MAX_BYTES` (default
**2097152**, 2 MiB; minimum **65536**). Both `Content-Length` and streamed bytes
are checked. This limit is separate from the JSON ingest body cap. At most
`QYM_LIVE_CHART_IMAGES_PER_TURN` distinct refs may have images on one turn
(default **10**). The PNG signature and IHDR must be readable.

| HTTP / scope | Exact detail or message | Meaning / action |
|---|---|---|
| `404` | `turn not found` | Push the turn before its screenshots |
| `404` | `chart not found` | Use a ref declared in this turn's `summary.charts` |
| `409` | `chart image limit reached` | The turn already has the configured number of distinct image refs; replacing an existing ref is allowed |
| `409` | `Project is archived; its API keys stop working until an admin unarchives it` | Same archived-project guard as other key-only writes |
| `413` | `The event batch exceeds ...; send smaller batches.` | Image body exceeds `QYM_LIVE_CHART_IMAGE_MAX_BYTES`; reduce the PNG size |
| `415` | `unsupported content type` | Send `Content-Type: image/png` |
| `422` | `invalid PNG` | PNG signature or IHDR is unreadable |
| `503` | `Platform is in maintenance mode; retry later` | Buffer and retry; `Retry-After: 60` |

The authentication, source lookup and path validation errors in section 6 also
apply. Re-pushing a turn keeps images whose refs remain in `summary.charts` and
drops images whose refs disappeared. Images follow the turn's retention
(180 days by default) and are removed when the project is deleted.


### 3.9 `GET /sources/{key}/control` — Control document

```bash
curl -sS "$SOURCE/control" -H "Authorization: Bearer $API_KEY" \
  -H 'If-None-Match: W/"previous-etag"'
```

No body. Poll every **10 seconds**, passing the last response's weak `ETag` in
`If-None-Match`. A changed document returns `200`, `ETag` and
`Cache-Control: no-store`; an unchanged document returns `304` with `ETag` and
no body. Keep the last document in worker memory; do not put secrets in logs or
shared caches. Continue control polling while paused so resume can be observed.

| Response field | Type | Meaning |
|---|---|---|
| `state` | string | Desired state: `running` or `paused` |
| `state_changed_at` | datetime or null | Last state change |
| `state_changed_by` | string or null | Display name of the user who changed state |
| `settings` | object or null | Latest version; null until the first version is saved |
| `settings.version` | integer | Monotonically increasing version |
| `settings.created_at`, `settings.created_by` | datetime, string or null | Version creation time and creator display name |
| `settings.values` | object | Saved non-secret settings, including models and database connection |
| `settings.secrets_digest` | string | SHA-256 digest of resolved secrets; changes when credentials change |
| `settings.errors` | array of strings | Empty when resolution succeeds; otherwise `connection missing` or `connection has no api key` |
| `settings.secrets` | object | Resolved credentials, only for the selected worker key |
| `settings.secrets_withheld` | boolean | `true` instead of `secrets` for other project keys, or when no worker key is selected |
| `jobs` | array | Queued and running jobs, ordered by request time then ID |
| `jobs[].id`, `jobs[].kind` | string | Job ID and `backfill_preview` or `backfill` |
| `jobs[].params` | object | `since_day`, `until_day`, UTC `since`/`until`, and `limit` |
| `jobs[].status`, `jobs[].progress` | string, object | Current status and counters |
| `jobs[].cancel_requested` | boolean | Worker should stop this job between turns |

Only the source's chosen, non-revoked worker API key receives `secrets`.
Other valid project keys can read the document with `secrets_withheld: true`;
this is a successful `200`, not a `403`. Authentication still rejects invalid,
revoked and out-of-project keys. Secret resolution errors in `errors` do not
change the HTTP status; do not apply an incomplete configuration. A stored
secret that cannot be decrypted returns `500` (`secret_cannot_be_decrypted`).

### 3.10 `POST /sources/{key}/jobs/{job_id}/progress` — Job progress

```json
{"status":"running","progress":{"found":20,"skipped_existing":5,"evaluated":3,"failed":0}}
```

| Field | Type | Required | Limits / default |
|---|---|---|---|
| `status` | string | yes | `running`, `done`, `failed`, or `cancelled` |
| `progress` | object | no | Default `{}`; finite JSON; counters described below |
| `error` | string or null | no | Default null; stored for `failed`, truncated to 2,000 characters |

Response (`200`): `{"id":"job-uuid","status":"running","progress":{"found":20,"skipped_existing":5,"evaluated":3,"failed":0}}`.

A queued or running job accepts `running` or a terminal status (`done`, `failed`,
`cancelled`). The first `running` sets its start time; a terminal status sets
its finish time. Terminal jobs reject all later updates, including retries.
A pending cancellation rejects `running`; acknowledge with `cancelled` and the
latest counters. Cancellation of a queued job finishes it immediately.

The counters `found`, `skipped_existing`, `evaluated` and `failed` must be
nonnegative integers (not booleans) and must never decrease. An omitted counter
is treated as zero, so send the complete latest counters on every update,
including completion and cancellation.

| HTTP / scope | `error.code` | Exact detail or message | Meaning / action |
|---|---|---|---|
| `404` | `job_not_found` | `job not found` | Unknown job, or job belongs to another source |
| `409` | `job_already_finished` | `job already finished` | Job is already done, failed or cancelled |
| `409` | `job_cancelled` | `job cancelled` | Cancellation is pending; stop sending `running` |
| `422` | `counters_must_not_decrease` | `counters must not decrease` | Send all counters as nonnegative, nondecreasing integers |

### 3.11 `POST /sources/{key}/events` — Worker events

```json
{"events":[{"at":"2026-11-01T00:02:00Z","level":"error","component":"database","code":"connection_failed","message":"Database connection failed","details":{"host":"db.example.test"}}]}
```

| Field | Type | Required | Limits / default |
|---|---|---|---|
| `events` | array | yes | Empty allowed; at most `QYM_LIVE_EVENTS_BATCH_MAX` (default 100) |
| `events[].at` | datetime | yes | Original event timestamp |
| `events[].level` | string | yes | `error` or `warning` |
| `events[].component` | string | yes | 1–30 characters, `^[a-z_]+$` |
| `events[].code` | string | yes | 1–60 characters, `^[a-z0-9_]+$` |
| `events[].message` | string | yes | 1–2,000 characters |
| `events[].details` | object | no | Default `{}`; finite JSON; credential keys dropped |

The body cap is **256 KiB (262144 bytes)**, independent of the general ingest
JSON cap. Response (`200`): `{"accepted":1}`. `accepted` counts distinct event
groups touched, not individual input events. Events with the same source and
fingerprint merge within a rolling **15-minute** window based on event times:
`count` increases, first/last times expand, and details become the latest supplied
object. Retries increase the count. The fingerprint uses component, code and a
message normalized for case, whitespace, long hex identifiers and numbers.

Detail keys containing `api_key`, `apikey`, `password`, `secret`, `token`,
`credential`, `authorization` or `cookie` (case-insensitive) are dropped
recursively, including inside arrays. This does not scrub message text or
arbitrary string values: workers must not send credentials there.

| HTTP / scope | `error.code` | Exact detail or message | Meaning / action |
|---|---|---|---|
| `422` | `too_many_events` | `too many events` | Split the batch to the configured event count |
| `413` | `payload_too_large` | `The event batch exceeds ...; send smaller batches.` | Split the body below 256 KiB |
| `403`, shared | `forbidden` | `API key belongs to another project` | Use the key's project ID |
| `403`, shared | `user_disabled` | `User disabled` | Key owner is inactive or missing |
| `403`, shared | `api_key_project_not_found` | `API key project not found` | Key's project is missing |
| `403`, shared | `forbidden` | `API key owner is no longer a member of this project` | Restore owner access |

All three routes also use the shared authentication, archive, source-not-found,
validation and maintenance errors in section 6. Progress bodies use the general
JSON cap; exceeding it also returns `413` / `payload_too_large`.

### 3.12 Heartbeat `control` block

The heartbeat's free-form `worker` dictionary may include `control` below.
This is reported worker state, distinct from the control document's desired
state. Send the whole block each time: heartbeat merging is shallow.

| Field inside `worker.control` | Shape | Worker page use |
|---|---|---|
| `state`, `reason` | strings | Actual worker state and why it is paused, blocked or running |
| `settings_version_applied`, `applied_at` | integer, datetime | Running version and when it was applied |
| `verification` | `{version, ok, checked_at, checks}` | Candidate version verification before apply |
| `verification.checks` | `{name: {ok, latency_ms, error}}` | Individual dependency checks, timings and failures |
| `running` | `{values}` | Effective settings currently in use |
| `models` | `{listed_at, ids}` | Available model IDs and when they were listed |
| `errors_last_hour` | nonnegative integer | Recent problem count, also shown on the overview badge |
| `last_error` | `{at, component, code, message}` | Latest reported problem |
| `job` | `{id, kind, progress}` | Active job and its counters |

The worker verifies a candidate version before applying it and reports the
verification and effective running version here. A saved version is not proof
that the worker has applied it; the Worker page distinguishes the two.

---

## 4. Turn, summary, and Score schema

### 4.1 Turn

Only `turn_id`, `turn_at`, `status`, and `question` are required. Optional fields
are replaced by their defaults when omitted on a re-push. String limits below
are character limits unless explicitly stated otherwise.

| Field | Type | Required | Limits / default |
|---|---|---|---|
| `turn_id` | string | yes | 1–200 characters; stable within a source |
| `turn_at` | datetime | yes | User turn time |
| `status` | string | yes | `completed`, `failed`, `incomplete_ingest` |
| `question` | string | yes | May be empty; strip NUL, keep first 200,000 characters |
| `day` | date or null | no | Default: date component of supplied `turn_at`; explicit day wins |
| `conversation_id` | string or null | no | Up to 200 characters; default null |
| `turn_index` | integer or null | no | 0–2,147,483,647; default null |
| `evaluated_at` | datetime or null | no | Evaluation time; default null |
| `user_ref` | string or null | no | Up to 200 characters; default null; producer's user reference |
| `mode` | string or null | no | Up to 50 characters; default null; e.g. `inquiry`, `report` |
| `outcome` | string or null | no | Up to 30 characters; default null; conventionally `ok`, `agent_failed`, `cancelled`, but not an enum |
| `label` | string or null | no | Up to 60 characters; default null; diagnosis category |
| `label_reason` | string or null | no | Default null; plain explanation; no explicit text cap |
| `answer` | string or null | no | Default null; strip NUL, keep first 200,000 characters |
| `sql` | array of objects | no | Default `[]`; entries conventionally `{text, executed, rows, error}` |
| `latency_ms` | number or null | no | Default null; milliseconds; must be finite if supplied |
| `result_rows` | integer or null | no | 0–2,147,483,647; default null |
| `tool_calls` | integer or null | no | 0–2,147,483,647; default null |
| `trace_url` | string or null | no | Up to 2,000 characters; default null; no URL-format validator |
| `eval_trace_url` | string or null | no | Up to 2,000 characters; default null; no URL-format validator |
| `summary` | object | no | Default `{}`; presentation contract in §4.2; extra nested keys retained |
| `detail` | object or null | no | Default null; opaque producer data; dropped if serialized bytes exceed `QYM_LIVE_DETAIL_MAX_BYTES` (default 524288) |
| `scores` | array of Score | no | Default `[]`; complete score set; names must be unique per turn |

`sql[].text` is SQL text, `executed` a boolean, `rows` a row count or null, and
`error` a string or null. These entry keys are conventions, not nested Pydantic
validation. `id`, `source_id`, `received_at`, and `rejected` are server-owned
fields and must not be sent as Turn fields.

### 4.2 Summary contract

`summary` carries the facts used by the overview and turn views. All fields are
optional; omit unavailable facts rather than inventing a score. The ingest API
validates that `summary` is an object with no nested non-finite numbers: the
shapes below are the producer presentation contract, not additional server-side
field validation. Unknown extra keys are retained and ignored by consumers that
do not recognize them.

| Field | Shape | Meaning |
|---|---|---|
| `router` | `{intent: string, confidence: number}` | Chosen intent and routing confidence |
| `judges` | `{a: Judge, b: Judge}` | Independent judge results, keyed by neutral identifiers |
| `judges.a.model`, `judges.b.model` | string | Judge model identifier |
| `judges.a.compliance`, `judges.b.compliance` | `{sql: number, response: number, overall: number}` | Compliance axes, conventionally 0–1 |
| `judges.a.reasoning`, `judges.b.reasoning` | string | Plain-language explanation of the judgment |
| `judges.a.sql_parts`, `judges.b.sql_parts` | `[{text, executed, rows, error}]` | Judge SQL, execution flag, row count and nullable error |
| `judges.a.vs_agent`, `judges.b.vs_agent` | `{equivalent: boolean, result_set_match: boolean, coverage: {covered, total}}` | Judge comparison with the evaluated answer/query |
| `judges_agree` | boolean | Whether the judges agree on the evaluation |
| `coverage` | `{covered: integer, total: integer}` | Requirements addressed out of requirements checked |
| `cross_review` | `{a_on_b: {text, score}, b_on_a: {text, score}}` | Each judge's review of the other, with text and numeric score when available |
| `deviations` | `[{judge: string, axis: string, text: string}]` | Specific divergences; optional, usually on problem turns |
| `envelope` | `{intent: string, expected_tools: string[], actual_tools: string[], matched: boolean}` | Expected versus observed execution path |
| `tools` | `{calls: integer, budget: integer, failures: Failure[], list?: Tool[]}` | Tool accounting; omit `list` unless available |
| `tools.failures[]` | `{name: string, step: integer, error: string, fault: string}` | Failed call and fault classification |
| `tools.list[]` | `{name: string, step: integer, ok: boolean}` | Observed calls in sequence |
| `sql_notes` | `{reused_by_judges: boolean, dialect_ok: boolean, validator_ok: boolean}` | Query reuse and validation findings |
| `charts` | `[{ref: string, kind: string, scores: {name: number}, issues: string[], reading: string}]` | Chart references, types, metric values, issues and interpretation; `charts[].ref` links each optional screenshot uploaded through section 3.8 |
| `services` | `{name: {status: string, score: number or null, fault: string or null, signals: object}}` | Per-service state and evidence; e.g. status `ok`, `failed`, `skipped`; service names are data |
| `manifest_hash` | string | Reference/configuration manifest identifier |
| `evaluation_failed` | boolean | Whether evaluation itself failed |
| `skipped` | boolean | Whether evaluation was deliberately skipped |
| `skip_reason` | string | Explanation when `skipped` is true |
| `eval_meta` | object | Model names, code version, attempt, durations, mode and other evaluation metadata |
| `replaced_at` | UTC datetime string | Server-added on a successful replacement |
| `detail_truncated` | boolean | Server sets true when oversized detail is dropped |
| `text_truncated` | boolean | Server sets true when question or answer is shortened |

`detail` is separate from this contract: it may contain complete per-metric
producer blocks and is displayed as opaque JSON. Consumers must not depend on
producer-specific keys in it for normal views.

A worked `summary` for a turn whose answer missed a requested region:

```json
{
  "router": {"intent": "population_by_region", "confidence": 0.96},
  "judges": {
    "a": {
      "model": "judge-a",
      "compliance": {"sql": 0.6, "response": 0.5, "overall": 0.55},
      "reasoning": "The result omits one of the requested regions.",
      "sql_parts": [{"text": "SELECT region, SUM(population) FROM population_sample GROUP BY region", "executed": true, "rows": 3, "error": null}],
      "vs_agent": {"equivalent": false, "result_set_match": false, "coverage": {"covered": 2, "total": 3}}
    },
    "b": {
      "model": "judge-b",
      "compliance": {"sql": 0.5, "response": 0.5, "overall": 0.5},
      "reasoning": "The totals are plausible but the regional coverage is incomplete.",
      "sql_parts": [{"text": "SELECT region, SUM(population) FROM population_sample GROUP BY region", "executed": true, "rows": 3, "error": null}],
      "vs_agent": {"equivalent": false, "result_set_match": false, "coverage": {"covered": 2, "total": 3}}
    }
  },
  "judges_agree": true,
  "coverage": {"covered": 2, "total": 3},
  "cross_review": {
    "a_on_b": {"text": "The missing region explains the lower score.", "score": 1.0},
    "b_on_a": {"text": "Both queries include all requested regions.", "score": 1.0}
  },
  "deviations": [{"judge": "a", "axis": "response", "text": "One region is missing from the answer."}],
  "envelope": {"intent": "population_by_region", "expected_tools": ["retrieval", "sql_execution", "visualization"], "actual_tools": ["retrieval", "sql_execution", "visualization"], "matched": true},
  "tools": {"calls": 3, "budget": 8, "failures": [], "list": [{"name": "retrieval", "step": 1, "ok": true}, {"name": "sql_execution", "step": 2, "ok": true}, {"name": "visualization", "step": 3, "ok": true}]},
  "sql_notes": {"reused_by_judges": false, "dialect_ok": true, "validator_ok": true},
  "charts": [{"ref": "chart-1", "kind": "bar", "scores": {"chart_fidelity": 0.65, "chart_vision": 0.8}, "issues": ["Missing regional category"], "reading": "The chart compares two of the three requested regions."}],
  "services": {
    "router": {"status": "ok", "score": 1.0, "fault": null, "signals": {"intent_matched": true}},
    "sql_execution": {"status": "ok", "score": 1.0, "fault": null, "signals": {"rows": 2}},
    "finalize": {"status": "failed", "score": 0.0, "fault": "agent", "signals": {"missing_regions": 1}}
  },
  "manifest_hash": "sample-manifest-v1",
  "evaluation_failed": false,
  "skipped": false,
  "eval_meta": {"models": {"a": "judge-a", "b": "judge-b"}, "eval_code_version": "v1", "attempt": 1, "durations": {"evaluation_ms": 2400}, "mode": "inquiry"}
}
```

### 4.3 Score

| Field | Type | Required | Limits / default |
|---|---|---|---|
| `metric_name` | string | yes | 1–200 characters; spec name when known |
| `score_numeric` | number or null | no | Default null; must be finite if supplied |
| `score_raw` | any JSON value | no | Default null; original value, including categorical text |
| `label` | string or null | no | Up to 200 characters; default null |
| `explanation` | string or null | no | Default null; no explicit text cap |
| `meta` | object | no | Default `{}`; extra metric metadata |
| `skipped` | boolean | no | Default false; skipped values do not enter means |
| `skip_reason` | string or null | no | Up to 200 characters; default null |

Send `skipped: true`, `score_numeric: null`, and a clear `skip_reason` when the
metric could not be evaluated. A reason is recommended, not required by the
validator. If all scores for a metric are skipped, its mean is null, not zero.
For categorical scores, use the category in `score_raw` and/or `label`, with a
null numeric score.

---

## 5. Idempotency, replacement, and limits

- Source identity is `(project_id, key)`. Source PUT replaces configuration.
  Heartbeat `worker` metadata alone uses a shallow merge.
- Metric PUT replaces the entire spec set atomically. It permits zero or one
  primary metric; more than one returns `422` with
  `at most one metric may be primary` in the validation message.
- Day identity is `(source_id, day)`. Day PUT replaces worker-owned fields and
  retains `polls` and `max_poll_gap_s`. Counters and turn-derived aggregates are
  independent; publish accurate counters even when some turns await upload.
- Turn identity is `(source_id, turn_id)`. A successful re-push replaces **all**
  turn fields and scores, including omitted optional fields taking defaults.
  `received_at` stays at its first insertion time; the new summary gets
  `summary.replaced_at` at the latest successful replacement. An explicit `day`
  is authoritative even when it differs from `turn_at`'s date.
- Duplicate turn IDs in one batch are processed in order: the last **successful**
  entry wins. Both entries appear in `results`, with the second valid entry
  `updated`. A later rejected entry leaves the earlier successful entry intact.
- Each turn is applied in its own database savepoint. Invalid turn or score fields,
  non-object entries, and recognized database value/constraint errors reject that
  turn only. Duplicate metric names in one turn violate the score uniqueness
  constraint and reject the whole turn. Connection failures or batch-commit
  failures are request-level failures, not guaranteed partial success.
- Unknown metric names are accepted and stored. Each adds
  `unknown metric <name>` to the result's `notes` and the stored turn's
  server-owned `rejected` list. Publish the spec later; do not treat the note as
  a rejected turn. With no notes, stored `rejected` is null.
- NUL characters are stripped from `question` and `answer`; after cleaning, each
  is limited to **200,000 characters**, not bytes. Longer text is shortened and
  sets `summary.text_truncated: true`. Stripping NUL alone does not set the flag.
  Other text fields do not receive this cleaning/truncation rule.
- Detail size is the UTF-8 size of the compact JSON, measured as
  `len(json.dumps(detail, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))`.
  Above `QYM_LIVE_DETAIL_MAX_BYTES` (default **524288**), the **entire detail is dropped
  to null**, not sliced into invalid JSON. The turn is accepted with
  `summary.detail_truncated: true`, a `detail truncated` note, and that note in
  stored `rejected`. This cap does not apply to `summary` or canary `detail`.
- Turn batches must contain 1–`QYM_LIVE_TURN_BATCH_MAX` entries (default **100**).
  This is a turn-count cap, independent of the byte limit below.
- All six JSON-body POST/PUT routes enforce `QYM_LIVE_INGEST_MAX_BODY_BYTES`
  (default **67108864**, 64 MiB; minimum **1048576**). Both `Content-Length`
  and streamed bytes are checked before parsing JSON; oversized bodies return
  `413`. There is no API rate limit in v1.1.
- Non-finite numbers (`NaN`, `Infinity`, `-Infinity`) are rejected in numeric
  scores, turn/canary latency, and metric thresholds. A turn is also rejected
  with `non-finite number in JSON` if any nested value in its `summary`, `detail`,
  `sql`, or any score's `score_raw` or `meta` is non-finite.
- Canary identity is `(source_id, canary, checked_at)` after UTC normalization.
  Re-pushes are ignored, even if their result changed. Heartbeats are not
  idempotent: a retry adds another poll when `current_day` is supplied.

---

## 6. Errors

Request errors include `error: {code, message, details, request_id}` and retain
`{"detail":"message"}` as a compatibility alias. Validation errors use
`{"detail":[{"loc":[...],"msg":"...","type":"..."}]}` with possible additional
fields. Successful turn-batch responses can still contain individual errors.

| HTTP / scope | Exact detail or message | Meaning / action |
|---|---|---|
| `401` | `Missing Bearer API key` | Supply the Authorization header |
| `401` | `Invalid API key` | Unknown, revoked, or mismatched key; `X-Qym-Key-State: invalid` |
| `403` | `API key belongs to another project` | Correct the project ID or use its key |
| `403` | `User disabled` | Key owner inactive/missing; `X-Qym-Key-State: owner_disabled` |
| `403` | `API key project not found` | Key's project missing; `X-Qym-Key-State: project_missing` |
| `403` | `API key owner is no longer a member of this project` | Restore access; `X-Qym-Key-State: owner_removed` |
| `404` | `Project not found` | Scoped project absent (normally auth rejects a missing key project earlier) |
| `404` | `live source not found` | Register this source before sending child requests |
| `409` | `Project is archived; its API keys stop working until an admin unarchives it` | Authentication blocks archived projects; `X-Qym-Key-State: project_archived` |
| `409` | `Project is archived; unarchive it to make changes` | Additional route-level archive guard; `X-Qym-Project-State: archived` |
| `409` | `Live ingest conflicts with existing data` | Commit constraint/value conflict; check payload values, duplicate specs or concurrent writes |
| `413` | `The event batch exceeds ...; send smaller batches.` | Body exceeds `QYM_LIVE_INGEST_MAX_BODY_BYTES`; reduce the payload size |
| `422` | `Turn batch exceeds the configured limit` | Split into smaller batches |
| `422` | Validation detail array | Invalid JSON, missing field, wrong type, extra field, invalid literal, key/date, or multiple primary metrics |
| `503` | `Platform is in maintenance mode; retry later` | Buffer and retry; `Retry-After: 60` |
| `200`, rejected turn | `turn must be a JSON object` | An entry is not an object; returned `turn_id` is null |
| `200`, rejected turn | `<field.path>: <validation message>` | Fix this turn or score; multiple messages joined with `; ` |
| `200`, rejected turn | `Database refused turn values` | Per-turn storage constraint/value failure; fix the payload |
| `200`, rejected turn | `non-finite number in JSON` | Replace non-finite numbers in nested turn or score JSON |

Unhandled infrastructure failures may return `500`; retain the payload, investigate,
and reconcile before retrying. Retrying turn uploads is safe by turn identity, but
check every entry's result even when the HTTP response is successful.

---

## 7. End-to-end example (Python)

This complete example uses only the standard library. Set the three connection
values, then run it against an existing project. The same source and IDs can be
re-pushed; the final output is `["turn-1", "turn-2"]` for a fresh example source.

```python
BASE_URL = "https://evaluation.example.test"  # append /ingestion if needed
API_KEY = "replace-with-project-api-key"
PROJECT_ID = "replace-with-project-id"

import json
import urllib.request
from datetime import datetime, timedelta, timezone


def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        BASE_URL.rstrip("/") + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


now = datetime.now(timezone.utc)
day = now.date().isoformat()
at = now.isoformat()
source = f"/v1/projects/{PROJECT_ID}/live/sources/example-worker"
worker = {"poll_interval_s": 60, "eval_code_version": "v1"}
call("PUT", source, {
    "name": "Evaluation worker", "environment": "preprod",
    "worker": worker, "day_key_timezone": "UTC",
})
call("PUT", source + "/metric-specs", {"specs": [
    {"metric_name": "agent_success", "group": "quality", "label": "Agent success",
     "score_type": "percentage", "direction": "maximize", "pass_threshold": 0.5,
     "is_primary": True},
    {"metric_name": "response_latency", "group": "latency", "label": "Response latency",
     "score_type": "duration", "direction": "minimize", "unit": "ms", "position": 1},
]})
call("PUT", source + "/days/" + day, {
    "run_ref": "daily-" + day, "status": "running", "parameters": worker,
    "first_poll_at": at, "last_poll_at": at,
})
turns = []
for index in range(1, 3):
    turns.append({
        "turn_id": f"turn-{index}", "day": day,
        "turn_at": (now - timedelta(seconds=60 * index)).isoformat(),
        "evaluated_at": at, "status": "completed", "outcome": "ok", "label": "ok",
        "question": f"How many records are in sample {index}?",
        "answer": f"There are {index * 12} records.",
        "latency_ms": 20000.0 * index,
        "summary": {"coverage": {"covered": 1, "total": 1},
                    "evaluation_failed": False, "skipped": False},
        "scores": [
            {"metric_name": "agent_success", "score_numeric": 1.0},
            {"metric_name": "response_latency", "score_numeric": 20000.0 * index},
        ],
    })
report = call("POST", source + "/turns", {"turns": turns})
if report["rejected"]:
    raise RuntimeError(report["results"])
call("PUT", source + "/days/" + day, {
    "run_ref": "daily-" + day, "status": "running", "turns_seen": 2, "evaluated": 2,
    "first_poll_at": at, "last_poll_at": at, "parameters": worker,
})
call("POST", source + "/heartbeat", {
    "at": at, "last_poll_at": at, "current_day": day, "worker": worker,
})
call("POST", source + "/canaries", {"results": [
    {"canary": "sql_execution", "checked_at": at, "status": "ok",
     "latency_ms": 25.0, "detail": {"rows": 1}, "eval_code_version": "v1"},
]})
turn_ids = call("GET", source + "/turns/ids?day=" + day)["turn_ids"]
print(json.dumps(turn_ids))
```

---

## 8. Quick reference

Paths below use the router's literal `{key:path}` and `{turn_id:path}` notation.
`:path` is a route converter, not text to send; substitute the key or turn ID as
in the examples. On the JSON routes it allows invalid slash-containing source
keys to reach validation and receive `422`; the image route accepts turn IDs
containing slashes.
Prepend the deployed ingestion alias prefix when required. The `day` query
parameter is mandatory on the turns/ids route.

| Method | Path | Purpose | Success code |
|---|---|---|---|
| `PUT` | `/v1/projects/{project_id}/live/sources/{key:path}` | Register/replace source | `201` / `200` |
| `POST` | `/v1/projects/{project_id}/live/sources/{key:path}/heartbeat` | Report a poll | `204` |
| `PUT` | `/v1/projects/{project_id}/live/sources/{key:path}/metric-specs` | Replace specs | `200` |
| `PUT` | `/v1/projects/{project_id}/live/sources/{key:path}/days/{day}` | Replace daily counters | `200` |
| `POST` | `/v1/projects/{project_id}/live/sources/{key:path}/turns` | Create/replace turns with per-turn results | `200` |
| `PUT` | `/v1/projects/{project_id}/live/sources/{key}/turns/{turn_id:path}/charts/{ref}/image` | Create/replace chart screenshot (raw PNG) | `204` |
| `POST` | `/v1/projects/{project_id}/live/sources/{key:path}/canaries` | Insert checks once per name and time | `200` |
| `GET` | `/v1/projects/{project_id}/live/sources/{key:path}/turns/ids` | Reconcile IDs (`?day=YYYY-MM-DD`) | `200` |
| `GET` | `/v1/projects/{project_id}/live/sources/{key:path}/control` | Read worker control document | `200` / `304` |
| `POST` | `/v1/projects/{project_id}/live/sources/{key:path}/jobs/{job_id}/progress` | Report job progress | `200` |
| `POST` | `/v1/projects/{project_id}/live/sources/{key:path}/events` | Report worker events | `200` |

Changelog: v1.2 (2026-11): control document, job progress, worker events, heartbeat `control` block; v1.1 (2026-11): chart images; v1.0 (2026-11): first version.
