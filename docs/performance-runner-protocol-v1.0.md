# Performance Runner Protocol — Integration Guide v1.0

v1.0 — first version. The qym backend and the runner are both built against
this file.

The performance runner is a headless program that runs the load-test suite (k6)
against the system under test and reports to qym. A person sets up, starts,
watches and stops a run in qym's pages; the runner does the work. This guide is
everything the runner needs to know about qym, and everything qym's runner
routes must do. It describes
`packages/platform/qym_platform/api/performance_ingest.py` and
`packages/platform/qym_platform/services/performance_*.py`.

```
 browser ── qym (pages, API, database) ──── runner (Node + k6) ──── Insightor
            a person sets up, starts,        asks qym for a job,     the system
            stops and reads a run            runs k6, reports back   under test
```

- **qym** stores targets and their sign-in tokens (encrypted), runs, status, the
  questions asked, the log, the result and the report file. It never talks to
  the system under test and never opens a connection to the runner.
- **The runner** makes every call in this guide. It is the only part that
  reaches the system under test, so the load comes from where the runner sits.
- One runner per project, one run at a time per runner and per target.

Words used below:

| Word | Meaning |
|---|---|
| target | The system under test, as a Manager added it in qym: a name, an address (base URL), its sign-in tokens and its limits. Nothing is built in |
| run | One execution of one test (Breakpoint, Smoke or Soak) against one target |
| runner key | The name the runner registers under, for example `perf-runner-1` |
| instance | One runner process. Every process start is a new instance |
| users | Simulated users (k6 virtual users) |
| level | Breakpoint only: a number of users that is held for a while and judged |
| answer | One question sent and its reply, complete or failed |
| token | `refresh_token` or `access_token` of the one sign-in a target has |

Units are in the field names: `_s` is seconds (number, may have decimals),
`_seconds` is whole seconds, `_ms` is milliseconds, `_pct` is 0–100, `_rate` is
0–1, `_at` is a timestamp. Fields without a unit suffix that count things are
integers.

Every choice between alternatives made while writing this contract is marked
**Decision:** with its reason. "DESIGN.md" and "the outline" in those notes are
the design papers this guide was written from; they are not part of this
repository.

---

## 1. Base URL, mounting, and auth

The router prefix is `/v1/projects/{project_id}/performance`. Use the project's
**ID**, not its slug. Create a project API key in **Project settings → API keys**
and send it on every request, with the instance header:

```text
Authorization: Bearer <project API key>
X-Qym-Runner-Instance: <instance id>
Content-Type: application/json
```

The report upload sends `Content-Type: text/html` and the raw file instead
(section 3.10).

**Instance id.** At every process start the runner makes a new random id (a
UUID is recommended; allowed: `^[A-Za-z0-9_.:-]{1,64}$`), keeps it in memory
only, and sends it in `X-Qym-Runner-Instance` on **all twelve routes**. A
request without the header gets `422`.
**Decision:** the instance id travels in a header and not in the request bodies
(the outline had it in four bodies), because the report body is raw HTML and
the two reads have no body, yet every one of them must be tied to one process.

The key must belong to the project in the path. Its owner must remain active and
retain project access. An archived project refuses these routes. Any project key
may register a runner and report for it, but **only the key a Manager chose on
the Runner page receives token values** (section 4.1). UI authentication being
disabled in a local deployment does not remove the API-key requirement.

The routes are mounted like the Live ingest routes: the main app serves them
when `QYM_MAIN_INCLUDE_INGEST` is enabled, and the ingestion service serves them
under `QYM_INGESTION_PREFIX` (default `/ingestion`), for example
`/ingestion/v1/projects/{project_id}/performance/runners/{key}`. Unprefixed
ingestion routes depend on `QYM_INGESTION_LEGACY_PATHS`. Set `BASE_URL` to the
service origin plus its deployed prefix, without a trailing slash.

During maintenance, **all twelve routes** return `503` with
`{"detail":"Platform is in maintenance mode; retry later"}` and
`Retry-After: 60`. For the runner this is the same as qym being unreachable
(section 2.3): a maintenance longer than 120 seconds ends a running test.

When the Performance area is switched off in a deployment
(`QYM_PERFORMANCE_ENABLED=false`), all twelve routes answer `404` with
`{"detail":"Performance is switched off"}`. No run can be started then, so the
runner only waits: it treats the answer like `401`.

The curl examples share these shell variables:

```bash
BASE_URL="https://qym.example.test"   # append /ingestion if using the alias
API_KEY="replace-with-project-api-key"
PROJECT_ID="replace-with-project-id"
INSTANCE="0b5d7c3e-91a4-4f2b-8e6d-5c1f0a9b7e42"
RUNNER="$BASE_URL/v1/projects/$PROJECT_ID/performance/runners/perf-runner-1"
RUN="$RUNNER/runs/7d3b6c1e-2f4a-4b8e-9c57-0a1d2e3f4a5b"
AUTH=(-H "Authorization: Bearer $API_KEY" -H "X-Qym-Runner-Instance: $INSTANCE")
```

The examples use one sample run throughout: a Breakpoint test on
`Insightor · Preprod` with 60 users, step 10, a hold of 450 seconds and a limit
of 180 seconds. It is planned for 3,000 seconds, breaks the time limit at 50
users and stops by itself after 2,399 seconds.

---

## 2. Runner lifecycle

### 2.1 What the runner does

1. **Start.** Make an instance id. Register (3.1). Registration is the first
   call of every process.
2. **Idle.** Send a heartbeat every **10 seconds** (3.2), always, also during a
   run. Read the control document every **10 seconds** (3.3).
3. **Claim.** When the control document shows a run with status `queued`, claim
   it at once (3.4). From here on read the control document every **2 seconds**.
4. **Pre-flight.** Download the questions of the pinned dataset version (3.11)
   and write the question file (4.8). Check the sign-in with one refresh call
   to the target. Validate the plan with `k6 inspect` and compare its stages
   with `config.plan` (4.2). Report `starting` while this goes on. Any failure
   ends the run: report `failed` with the reason in plain words (3.5).
5. **Run.** Start k6. Report progress every **5 seconds** (3.5), the first time
   with status `running`. Send finished questions (3.6) and log lines (3.7) in
   batches, and events (3.8) when something worth a line on the timeline
   happens.
6. **Stop.** Stop k6 as soon as qym asks: `state` is `stopping` in the control
   document, `stop_requested` is true in a progress response, or a progress
   report is refused with `stop_requested`. Send k6 an interrupt; if it has not
   exited after **20 seconds**, kill it.
7. **Token.** When the refresh token is rejected, report
   `waiting_for_token` (4.3). When the control document carries a newer token,
   check it with one refresh call, hand it to the simulated users and report
   the result.
8. **End.** When k6 has exited: send the remaining questions and log lines, the
   summary (3.9) and the report (3.10), then the last progress report with the
   final status (`finished`, `stopped`, `failed` or `interrupted`). Go back to
   step 2.
   **Decision:** the summary and the report are sent before the final status,
   so that a page that sees "finished" also finds the result; if the runner
   dies in between, the run ends as interrupted and keeps what arrived.

Send ISO 8601 timestamps with an explicit UTC offset, preferably `Z`. Returned
timestamps use `Z`. Everything qym decides about time (silence, expiry, the late
window) uses qym's **receive time**, never a timestamp the runner sent.

### 2.2 Run states

A state says where the process is or how it ended. The result of the test (the
verdict) is a separate value and lives in the summary (4.7).

| Status | Meaning | Final |
|---|---|---|
| `queued` | Started by a person, not yet claimed | no |
| `starting` | Claimed; the runner is in pre-flight | no |
| `running` | k6 is running | no |
| `stopping` | A stop is under way | no |
| `finished` | k6 ran to its own end (the plan's end, or the auto-stop at a broken level) | yes |
| `stopped` | Ended by a person's stop | yes |
| `failed` | Could not start, bad input, or k6 broke | yes |
| `interrupted` | The runner was lost or shut down | yes |
| `expired` | Nobody claimed it in time | yes |

**Decision:** the word is `finished` (DESIGN.md) and not `done` (the outline),
because DESIGN.md wins where the two differ.

| From | Event | To | Who triggers it |
|---|---|---|---|
| — | Start accepted | `queued` | person, in the page |
| `queued` | Claim (3.4) | `starting` | runner |
| `queued` | Stop pressed | `stopped` | person; at once, no runner involved |
| `queued` | Not claimed for 600 s (`QYM_PERFORMANCE_QUEUE_TIMEOUT_SECONDS`) | `expired` | qym |
| `starting` | Progress with `running` | `running` | runner |
| `starting` | Progress with `failed` (pre-flight failed) | `failed` | runner |
| `starting`, `running` | Stop pressed | `stopping` | person; `stop_requested` becomes true |
| `starting`, `running` | Progress with `stopping` (the runner stops k6 by itself) | `stopping` | runner |
| `running`, `stopping` | Progress with `finished` (k6 exit code 0 or 99) | `finished` | runner |
| `stopping` that never reported `running` | Progress with `finished` | `stopped` | runner; qym stores `stopped` and answers `status: "stopped"` |
| `starting`, `running`, `stopping` | Progress with `stopped` (k6 exit code 105 or 103 after a stop request, or killed after 20 s) | `stopped` | runner |
| `running`, `stopping` | Progress with `failed` (exit code 107, any other code, no exit code without a stop) | `failed` | runner |
| `starting`, `running`, `stopping` | Progress with `interrupted` (the runner is shutting down) | `interrupted` | runner |
| `starting`, `running`, `stopping` | A new instance registers under the runner key | `interrupted` | qym, in the registration's transaction |
| `starting`, `running`, `stopping` | No sign of life for 120 s | `interrupted` | qym (sweep every 15 s, and on every read and runner contact) |
| `starting`, `running`, `stopping` | Stop pressed while the runner has been silent for 120 s | `interrupted` | person; at once |
| any final status | Late window: for 600 s (`QYM_PERFORMANCE_LATE_WINDOW_SECONDS`) questions, log lines, the summary, the report and a rotated token are still accepted from the claiming instance | unchanged | runner |
| any final status | Anything else | unchanged; progress is refused | — |

Nothing returns to `queued`. `finished` straight from `starting` is refused
(`invalid_transition`): a run cannot finish without having run. For the same
reason a run that went `starting` → `stopping` without an accepted `running`
report never ends `finished`: a `finished` report there is accepted (`200`,
`accepted: true`) and stored as `stopped`, with `status_reason`
`stopped_by_person` when a person pressed Stop and null otherwise; the answer's
`status` is `stopped`. A `failed` report there stays `failed`.

**Decision:** a stop pressed on a claimed run sets `stopping` at once (the
outline only set a flag), so that the stored status alone is true and a later
`running` report is an invalid step by the same rule as any other.
**Decision:** the runner may report `interrupted` itself when its process is
told to shut down (SIGTERM), because that is neither a person's stop nor a
failure of the test; it must first stop k6 and send what was measured.

### 2.3 A lost run never resumes

1. **Claimed once.** A run is claimed by one instance, one time. No route sets
   `queued` again. A second claim by the same instance returns the same answer;
   a claim by any other instance is refused. Once the run is final, every
   claim is refused, also one by the instance that had claimed it.
2. **A new process is a new instance.** The runner never stores its instance id
   and never reuses one. When a new instance registers under the runner key
   while a run claimed by an earlier instance is not final, qym ends that run as
   `interrupted` in the same transaction. The new instance starts idle.
3. **Registration is the only way in.** The runner routes (heartbeat, control,
   events, claim) compare the header with the registered instance; the run
   routes compare it with the instance that claimed the run. Both answer
   `409 instance_mismatch` when they differ. An instance that gets this answer
   on a runner route has been replaced: it stops k6, sends what it measured
   for its own run (rule 6), and exits. It must not register again.
   **Decision:** only registration replaces the instance (the outline also let
   a heartbeat do it), so that one stray request can never end a run.
4. **120 seconds of silence, qym's side.** A sign of life is, from the
   claiming instance, a progress report answered `200`, or a heartbeat
   answered `204` that names the run (`run_id` is the run's id) and is working
   on it (`state` is `preflight`, `running`, `stopping` or `finishing`); the
   claim itself counts as the first. A heartbeat with `state: "idle"`, or one
   that names another run or none, keeps the process registered but is not a
   sign of life for the run: a runner that dropped its run (for example after
   a refused final report) lets it end by this rule, also when Stop was
   pressed (`stopping` ends `interrupted` with `status_reason`
   `runner_silent`; Stop pressed after the 120 seconds gives
   `stopped_while_runner_silent`). When qym has had no sign of
   life for `QYM_PERFORMANCE_STALE_AFTER_SECONDS` (default **120**), the run
   becomes `interrupted`. Such a run ended at the moment the 120 seconds ran
   out, whenever qym noticed it: its late window (rule 6) is counted from
   there. In the same way an unclaimed run expired when its 600 seconds ran
   out.
   **Decision:** reading the control document is not a sign of life, so that a
   read never writes and the two calls that carry state decide.
5. **120 seconds of silence, the runner's side.** qym counts as reached when a
   control read is answered `200` or `304`, or a progress report is answered
   `200`: these are the two calls that can carry a stop. When neither has
   happened for 120 seconds the runner stops k6 by itself, because the stop
   button could no longer reach it.
   **Decision:** the runner's clock is tied to the calls that can carry a stop,
   so every other answer counts as "not reached", including `401` and `403`: a
   key that stopped working cuts the stop channel exactly like a dead network.
6. **What was measured is kept.** `interrupted` is final: progress is refused
   (`409 run_finished`) and the run can never run again. For
   `QYM_PERFORMANCE_LATE_WINDOW_SECONDS` (default **600**) after the end of a
   run, whatever its final status, qym still accepts questions, log lines, the
   summary, the report and a rotated token from the instance that claimed it.
   After that these routes answer `409 run_closed`.
7. **When in doubt, stop.** If the control document does not name the run the
   runner is executing (`run` is null or has another id), or a progress report
   gets `409 run_finished`, the runner stops k6 immediately and goes to rule 6.

The runner container may use a restart policy such as `unless-stopped`: rule 2
makes a restart safe. Run exactly one process per runner key; two processes
keep replacing each other and no run survives.

### 2.4 Timing

| What | Value | Setting or source |
|---|---|---|
| Heartbeat | every 10 s | runner |
| Control read, idle | every 10 s | runner |
| Control read, from claim to the final status | every 2 s | runner |
| Progress report | every 5 s | runner |
| Questions and log batches | every 5 s, or sooner when 100 records or 250 lines wait | runner |
| Runner counts as ready for a new run | last heartbeat at most 30 s old | `QYM_PERFORMANCE_RUNNER_FRESH_SECONDS` |
| Silence that ends a run (both directions) | 120 s | `QYM_PERFORMANCE_STALE_AFTER_SECONDS` |
| Unclaimed run expires | 600 s | `QYM_PERFORMANCE_QUEUE_TIMEOUT_SECONDS` |
| Late window after the end of a run | 600 s | `QYM_PERFORMANCE_LATE_WINDOW_SECONDS` |
| Stop reaches the runner | within 2 s (control), 5 s (progress) | — |
| k6 killed if it has not exited after a stop | 20 s | runner |

**Decision:** "ready for a new run" (30 seconds) is its own setting, apart from
the 120 seconds that end a run, because a start should be refused quickly when
the runner is gone, while a running test should survive a short qym restart.
**Decision:** the late window has its own setting name; the outline fixed it at
10 minutes without one.

The control document repeats these numbers in `limits` (4.1). The runner reads
them from there and does not hard-code them.

---

## 3. Endpoints

All paths in this section are relative to
`/v1/projects/{project_id}/performance`. `key` must match
`^[A-Za-z0-9_.:-]{1,100}$`. `run_id` is the run's id as the control document
gives it.

There are **twelve** routes: the eleven of the design outline and one more, for
reporting a rotated refresh token (3.12). DESIGN.md section 4 still says
eleven; twelve is the right count, because DESIGN.md itself asks the runner to
report a rotated token back, and that needs a route.
**Decision:** the rotated token has its own route and does not ride in the
progress report, because a progress body is stored and shown as it is, may be
dropped or overtaken by a later one, and has no answer that confirms the token
was saved; a lost report would leave the saved sign-in dead for the next run.

Typed request objects reject unknown fields (`extra="forbid"`): the register,
heartbeat, claim, progress envelope, question record, log line, event and
token bodies. The free dictionaries `info`, `details`, `progress`, the summary
and `suite_summary` keep extra keys. Non-finite numbers (`NaN`, `Infinity`) are
refused everywhere.

**Nesting.** A JSON body may nest objects and arrays at most **32** levels
deep; the body itself is level 1 (the shapes of this guide need at most 6).
A deeper body is refused before any field is checked, with `422` and the
validation array `[{"loc":["body"],"type":"json_too_deep","msg":"JSON must not
nest objects and arrays deeper than 32 levels"}]`, on every route. Nothing
deeper is ever stored.

**NUL characters.** qym removes every NUL character (U+0000, `\u0000` in JSON)
from every string and every key of a JSON body before it checks the body. A
NUL is never a reason to refuse a body; the stored text is the text without it.

**Times.** Every time field must still be a valid time once moved to UTC: the
years 1 to 9999. Otherwise the field fails validation with `time must fall
between the years 1 and 9999 in UTC`: a question record or a log line is
rejected alone (`results[].status: "rejected"`, the batch answers `200`);
any other body is refused with the `422` validation array.

**Codes every route can return**, and what the runner does:

| HTTP | Meaning | Runner action |
|---|---|---|
| `401` | Missing or invalid key | Not reached (2.3 rule 5). Log once. Keep trying at the normal pace |
| `403` | Key of another project, owner disabled or removed | As `401` |
| `404` `Project not found` | Wrong project id | As `401`; a configuration error |
| `404` `Performance is switched off` | The area is switched off in this deployment | As `401` |
| `409` project archived | The project is archived | As `401` |
| `422` validation array | Bad body, key or header | A bug in the runner. Do not retry the same body. Send an event (3.8) |
| `503` | Maintenance | Not reached. Retry after `Retry-After` |
| `500`–`599`, timeout, no connection | qym is down or slow | Not reached. Retry as in section 5 |

### 3.1 `PUT /runners/{key}` — register this process

```bash
curl -sS -X PUT "$RUNNER" "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"name":"perf-runner-1","info":{"runner_version":"0.1.0","k6_version":"1.4.2","suite_commit":"d0688f8","node_version":"20.18.0","host":"perf-runner-7c9d","location":"Preprod cluster"}}'
```

| Field | Type | Required | Limits / default |
|---|---|---|---|
| `name` | string | yes | 1–200 characters; shown on the Runner page |
| `info` | object | no | Default `{}`; free metadata, at most 8 KiB as compact JSON; keys that look like credentials are dropped (section 6) |

Recommended `info` keys: `runner_version`, `k6_version`, `suite_commit`,
`node_version`, `host`, `location` (where the load comes from, in words).

Response (`201` when the runner key is new, `200` otherwise):

```json
{"id":"c2a4e6f8-1b3d-4f5a-8c7e-9d0b1a2c3e4f","key":"perf-runner-1","name":"perf-runner-1","info":{"runner_version":"0.1.0","k6_version":"1.4.2","suite_commit":"d0688f8","node_version":"20.18.0","host":"perf-runner-7c9d","location":"Preprod cluster"},"instance_id":"0b5d7c3e-91a4-4f2b-8e6d-5c1f0a9b7e42","tokens_disclosed":true,"interrupted_run_id":null,"created_at":"2026-11-12T08:15:00Z","registered_at":"2026-11-20T10:58:12Z"}
```

| Response field | Type | Meaning |
|---|---|---|
| `id` | string | The runner's id in qym |
| `key`, `name`, `info` | string, string, object | As stored |
| `instance_id` | string | The instance now registered: the header's value |
| `tokens_disclosed` | boolean | Whether this API key is the chosen runner key. When false, the runner cannot run a test (4.1): say so in the log at start |
| `interrupted_run_id` | string or null | The run this registration ended as `interrupted`, if any |
| `created_at`, `registered_at` | datetime | First registration of the key; this registration |

Registration replaces `name`, `info` and the instance, and counts as a
heartbeat. Repeating it with the same instance changes nothing else.

When a Manager chose the runner key on the Runner page before any runner had
connected, qym already holds a runner row that was never registered. The first
registration takes that row over under the key in the path and answers `201`.

**Decision:** a project has one runner in this version, so registering a second
runner key in the same project is refused; the table allows more later, but the
start route would not know which runner to give a run to.

| HTTP | `error.code` | Meaning | Runner action |
|---|---|---|---|
| `201`, `200` | — | Registered | Go on to heartbeat and control |
| `409` | `runner_limit_reached` | The project already has a runner under another key | Configuration error: log and exit |
| `401`, `403`, `404`, `409` archived, `422`, `503`, `5xx` | — | Shared | As in the table above; retry registration every 10 s |

### 3.2 `POST /runners/{key}/heartbeat` — say the process is alive

```bash
curl -sS -X POST "$RUNNER/heartbeat" "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"at":"2026-11-20T11:23:30Z","state":"running","run_id":"7d3b6c1e-2f4a-4b8e-9c57-0a1d2e3f4a5b"}'
```

| Field | Type | Required | Limits / default |
|---|---|---|---|
| `at` | datetime | yes | The runner's clock; shown, never used for liveness |
| `state` | string | yes | `idle`, `preflight`, `running`, `stopping` or `finishing` (k6 has exited, results are being sent) |
| `run_id` | string or null | no | Default null; at most 36 characters; the run this instance is working on. Send it from the claim until the final status is accepted: only a heartbeat that names the run and is not `idle` keeps the run alive (2.3 rule 4). A `run_id` that is not a run of this runner is not kept |

Response: **`204 No Content`**. Send it every 10 seconds whether or not a run is
active. A heartbeat is not retried: the next one replaces it.

| HTTP | `error.code` | Meaning | Runner action |
|---|---|---|---|
| `204` | — | Recorded | — |
| `404` | `runner_not_found` | This key was never registered | Register (3.1), then go on |
| `409` | `instance_mismatch` | Another process registered under this key | Stop k6, send results for your own run, exit (2.3 rule 3) |
| shared | — | — | As in the shared table |

### 3.3 `GET /runners/{key}/control` — read what qym wants

```bash
curl -sS "$RUNNER/control" "${AUTH[@]}" -H 'If-None-Match: W/"previous-etag"'
```

No body. Pass the last response's weak `ETag` in `If-None-Match`. A changed
document returns `200` with `ETag` and `Cache-Control: no-store`; an unchanged
one returns `304` with `ETag` and no body. Keep the last document in memory
only: it can hold token values, so it must never be written to a log, a file or
a cache. Section 4.1 defines the document and shows one example per situation.

Read it every 10 seconds when idle and every 2 seconds from the claim until the
final status has been accepted. A read is not a sign of life (2.3 rule 4).

| HTTP | `error.code` | Meaning | Runner action |
|---|---|---|---|
| `200` | — | New document | Act on it (4.1) |
| `304` | — | Nothing changed | Keep the last document |
| `404` | `runner_not_found` | Not registered | Register, then go on |
| `409` | `instance_mismatch` | Replaced by another process | As in 3.2 |
| `500` | `secret_cannot_be_decrypted` | A stored token cannot be decrypted | Counts as not reached; send an event when qym answers again; a person must save the token again |
| shared | — | — | As in the shared table |

### 3.4 `POST /runners/{key}/runs/{run_id}/claim` — take a queued run

```bash
curl -sS -X POST "$RUN/claim" "${AUTH[@]}" -H "Content-Type: application/json" -d '{}'
```

The body is the empty object `{}`; the instance comes from the header.

Response (`200`):

```json
{"id":"7d3b6c1e-2f4a-4b8e-9c57-0a1d2e3f4a5b","status":"starting","claimed_at":"2026-11-20T11:01:42Z"}
```

`id` and `status` are strings, `claimed_at` a UTC timestamp. The same instance
claiming again gets the same `200` with the first `claimed_at`. The claim is
the first sign of life: the first progress report is due within 120 seconds,
and should come within 5.

| HTTP | `error.code` | Meaning | Runner action |
|---|---|---|---|
| `200` | — | The run is yours, status `starting` | Start pre-flight |
| `404` | `run_not_found` | Unknown run, or a run of another runner | Forget the run; back to idle |
| `409` | `run_not_queued` | Already claimed by another instance, or already final (stopped, expired) | Forget the run; back to idle. Never start k6 for it |
| `409` | `instance_mismatch` | This instance is not the registered one | As in 3.2 |
| shared | — | — | Retry the claim on the next control read while the run is still `queued` |

A claim whose answer was lost (timeout) is safe to repeat.

### 3.5 `POST /runners/{key}/runs/{run_id}/progress` — report status

```bash
curl -sS -X POST "$RUN/progress" "${AUTH[@]}" -H "Content-Type: application/json" \
  --data-binary @progress.json
```

```json
{"seq":262,"status":"running","at":"2026-11-20T11:23:30Z","progress":{"phase":"hold","elapsed_s":1290.0,"users":30},"error":null,"exit_code":null}
```

(The `progress` object is shortened here; section 4.3 has it in full.)

| Field | Type | Required | Limits / default |
|---|---|---|---|
| `seq` | integer | yes | 1–2,147,483,647; rises by at least 1 with every report of this run |
| `status` | string | yes | `starting`, `running`, `stopping`, `finished`, `stopped`, `failed` or `interrupted` |
| `at` | datetime | yes | The runner's clock when the report was built |
| `progress` | object | yes | Section 4.3; `{}` is allowed at any time and carries no numbers: it never replaces the last stored object |
| `error` | string or null | no | Default null. Required in words for `failed` and `interrupted`; kept for `stopped`; cut to 2,000 characters |
| `exit_code` | integer or null | no | Default null. k6's exit code, on a final status |

The body is limited to **64 KiB (65536 bytes)**.

Response (`200`):

```json
{"id":"7d3b6c1e-2f4a-4b8e-9c57-0a1d2e3f4a5b","status":"running","accepted":true,"stop_requested":false,"stop_reason":null,"token_needed":null,"token_versions":{"refresh_token":3,"access_token":2}}
```

| Response field | Type | Meaning |
|---|---|---|
| `id` | string | The run |
| `status` | string | The stored status after this report |
| `accepted` | boolean | False when `seq` was not higher than the last stored one: the report was ignored, which is not an error |
| `stop_requested` | boolean | True: stop k6 now |
| `stop_reason` | string or null | What the person wrote, if anything |
| `token_needed` | string or null | The token name qym is asking a person for |
| `token_versions` | object | Version of each saved token of the target, now. A number higher than the one the runner holds means a new token waits in the control document: read it at once |

Rules:

- The first `running` sets the run's start time. A final status sets its finish
  time and opens the late window. After that every progress report is refused.
- `starting` or `running` after a stop request is refused with
  `409 stop_requested`. Treat it exactly like `stop_requested: true`.
- These counters must never go down within a run: `answers.sent`,
  `answers.finished`, `answers.ok`, `answers.errors`, `answers.interrupted`,
  every value of `errors_by_kind`, and `answers` of every entry of `levels`.
  `levels` never loses an entry.
- A counter that is missing from a report that is not `{}` counts as 0.
- A progress report is not retried. The next one replaces it; only the report
  with the final status is retried until it is answered (section 5).
- An accepted or ignored report (`200`) is a sign of life; a refused one is not.
- qym copies `progress.waiting_for_token` to the run only when the version the
  runner says it holds (`progress.auth.token_versions`) equals the saved
  version; otherwise a newer token is already on its way and nobody is asked.
  `waiting_for_token` is `refresh_token`, `access_token` or null; a report
  without the field says the runner is not waiting.

| HTTP | `error.code` | Meaning | Runner action |
|---|---|---|---|
| `200` | — | Stored, or ignored (`accepted: false`) | Act on `stop_requested` and `token_versions` |
| `404` | `run_not_found` | Unknown run | Stop k6; back to idle |
| `409` | `run_not_claimed` | The run is still `queued` | A bug: claim first |
| `409` | `instance_mismatch` | The run was claimed by another instance | Stop k6; back to idle |
| `409` | `stop_requested` | A stop is waiting | Stop k6; then report `stopping` or the final status |
| `409` | `run_finished` | The run is already final; `error.details.status` says which | Stop k6 at once if it still runs. Send no more progress. Send results (2.3 rule 6) |
| `409` | `invalid_transition` | This status cannot follow the stored one | A bug: log it, send an event |
| `413` | `payload_too_large` | Body above 64 KiB | Drop `levels[].by_tier`, then send again |
| `422` | `counters_must_not_decrease` | A counter went down | A bug: log it, send an event, keep reporting |
| shared | — | — | As in the shared table |

### 3.6 `POST /runners/{key}/runs/{run_id}/questions` — send finished questions

```bash
curl -sS -X POST "$RUN/questions" "${AUTH[@]}" -H "Content-Type: application/json" \
  --data-binary @questions.json
```

The body has one required field, `records`: a list of 1 to **200** question
records (section 4.4). The body is limited to **1 MiB (1048576 bytes)**.

Response (`200`):

```json
{"accepted":2,"duplicates":0,"rejected":0,"dropped":0,"results":[{"seq":458,"status":"created","error":null},{"seq":459,"status":"created","error":null}]}
```

| Response field | Type | Meaning |
|---|---|---|
| `accepted` | integer | Records stored by this request |
| `duplicates` | integer | Records whose `seq` was already stored; left as they are |
| `rejected` | integer | Records refused one by one |
| `dropped` | integer | Records of this request above the per-run limit of 50,000; not stored (see below) |
| `results` | array | One entry per input, in input order |
| `results[].seq` | integer or null | The record's `seq`, or null when unreadable |
| `results[].status` | string | `created`, `duplicate`, `rejected` or `dropped` |
| `results[].error` | string or null | One line on rejection, otherwise null |

Each record is checked and stored on its own: one bad record is rejected alone.

Above the per-run limit, every record that is not stored yet is answered
`dropped`. The run counts each dropped `seq` once: qym counts a drop only for a
`seq` above the highest one it has already counted as dropped, so a batch sent
again after a lost answer is never counted twice. Send batches in `seq` order.
At the first drop qym writes the event `questions_limit_reached` (level
`warning`, `details: {"limit", "dropped_through_seq"}`) on the run's timeline.

Even a batch in which every record is rejected returns `200`. Accepted while
the run is `starting`, `running` or `stopping`, and during the late window.

| HTTP | `error.code` | Meaning | Runner action |
|---|---|---|---|
| `200` | — | Batch processed | Remove `created`, `duplicate` and `dropped` records from the buffer; log `rejected` ones and drop them |
| `404` | `run_not_found` | Unknown run | Drop the buffer |
| `409` | `run_not_claimed` | Run still `queued` | A bug |
| `409` | `instance_mismatch` | Claimed by another instance | Drop the buffer |
| `409` | `run_closed` | The late window is over | Drop the buffer |
| `413` | `payload_too_large` | Body above 1 MiB | Halve the batch and send again |
| `422` | `too_many_records` | More than 200 records | Split |
| shared | — | — | Keep the buffer and retry (section 5) |

### 3.7 `POST /runners/{key}/runs/{run_id}/log` — send log lines

```bash
curl -sS -X POST "$RUN/log" "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"lines":[{"seq":1411,"at":"2026-11-20T11:23:27.210Z","level":"info","message":"request  level=30  user=30  status=200    30.1 s  simple   simple_marital_status_values"}]}'
```

The body has one required field, `lines`: a list of 1 to **500** log lines
(section 4.5). The body is limited to **256 KiB (262144 bytes)**.

Response (`200`):

```json
{"accepted":1,"duplicates":0,"rejected":0,"dropped":0}
```

All four are integers with the meanings of 3.6; `dropped` counts lines above
the per-run limit of 50,000, and the run counts each dropped `seq` once, as in
3.6 (event `log_limit_reached`). A rejected line (bad level, missing field) does
not stop the others. Accepted in the same states as questions.

Status codes and runner actions are those of 3.6, with `too_many_lines` in
place of `too_many_records` and 256 KiB in place of 1 MiB.

### 3.8 `POST /runners/{key}/events` — report what happened

```bash
curl -sS -X POST "$RUNNER/events" "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"events":[{"at":"2026-11-20T11:11:00.004Z","level":"info","code":"level_passed","message":"Level 10 passed: p95 67.8 s, errors 0.9%","details":{"level":10,"p95_ms":67830,"error_pct":0.86},"run_id":"7d3b6c1e-2f4a-4b8e-9c57-0a1d2e3f4a5b"}]}'
```

The body has one required field, `events`: a list of at most **100** events
(section 4.6); an empty list is allowed. The body is limited to
**256 KiB (262144 bytes)**.

Response (`200`): `{"accepted":1}`. `accepted` counts events stored by this
request; a repeated event (4.6) is not counted. Events belong to the runner,
not to a run's state: they are accepted at any time, with or without `run_id`.
A `run_id` that is not a run of this runner is not kept: the event is stored
without a run.

| HTTP | `error.code` | Meaning | Runner action |
|---|---|---|---|
| `200` | — | Stored | Remove them from the buffer |
| `404` | `runner_not_found` | Not registered | Register, then send again |
| `409` | `instance_mismatch` | Replaced by another process | Drop them; as in 3.2 |
| `413` | `payload_too_large` | Body above 256 KiB | Split |
| `422` | `too_many_events` | More than 100 events | Split |
| `422` | validation array | One event is invalid: the whole request is refused | A bug: drop the batch, log it |
| shared | — | — | Keep at most 500 events and retry; drop the oldest `info` events first |

### 3.9 `PUT /runners/{key}/runs/{run_id}/summary` — send the result

```bash
curl -sS -X PUT "$RUN/summary" "${AUTH[@]}" -H "Content-Type: application/json" \
  --data-binary @summary.json
```

The body is the summary object of section 4.7, limited to
**256 KiB (262144 bytes)**. Send it once k6 has exited and written its result
file, before the final progress report. A run whose k6 was killed has no result
file and gets no summary.

Response (`200`):

```json
{"id":"7d3b6c1e-2f4a-4b8e-9c57-0a1d2e3f4a5b","verdict":"breakpoint_found"}
```

Repeating the PUT replaces the stored summary. qym copies the headline values
into the run row for the history table. Accepted in the same states as
questions (3.6).

qym masks every string of the summary, keys included, before it is stored, as
it masks a log line (section 6): a current token value in any spelling and
token-shaped text become `[REDACTED]`. The summary is not refused for a token.

| HTTP | `error.code` | Meaning | Runner action |
|---|---|---|---|
| `200` | — | Stored | Go on to the report |
| `404` | `run_not_found` | Unknown run | Give up |
| `409` | `run_not_claimed`, `instance_mismatch` | Not this instance's run | Give up |
| `409` | `run_closed` | The late window is over | Give up; keep the file in the work folder and log where it is |
| `413` | `payload_too_large` | Above 256 KiB | Send again without `suite_summary`; then without `levels[].by_tier` |
| `422` | validation array | A field is wrong, or `test_type` is not the run's test type | A bug: send an event; keep the file |
| shared | — | — | Retry until the late window is over (section 5) |

### 3.10 `PUT /runners/{key}/runs/{run_id}/report` — upload the report file

Send the HTML file as the raw request body with `Content-Type: text/html` (a
`charset` parameter is allowed). Do not JSON-encode it, base64-encode it or
wrap it in multipart form data. The body must be valid UTF-8.

```bash
curl -sS -X PUT "$RUN/report" "${AUTH[@]}" -H "Content-Type: text/html; charset=utf-8" \
  --data-binary @breakpoint-report.html
```

Response: `204 No Content` on both creation and replacement. The file is
limited to `QYM_PERFORMANCE_REPORT_MAX_BYTES` (default **5242880**, 5 MiB);
both `Content-Length` and streamed bytes are checked. qym stores it compressed
with its size and SHA-256, and offers it as a download only: it is never shown
as a page.

For Breakpoint the runner builds the file from the result file and its raw log
with the suite's report tool (about 340 KB with the raw log of a 6-minute run,
245 KB without). For Smoke and Soak it is the file k6 wrote.
**Decision:** the runner leaves the raw log out of the report when
`config.options.store_answers` is false or when the file would exceed the
limit, because the raw log carries the answers and grows with the run.

| HTTP | `error.code` | Meaning | Runner action |
|---|---|---|---|
| `204` | — | Stored | Send the final progress report |
| `404`, `409` | as 3.9 | As 3.9 | Give up; keep the file |
| `413` | `payload_too_large` | Above the limit | Build it again without the raw log and send once more; if still too large, send an event `report_too_large` and go on without a report |
| `415` | `unsupported_content_type` | Not `text/html` | A bug |
| `422` | `report_not_utf8` | Not valid UTF-8 | A bug: send an event; go on without a report |
| `422` | `contains_token` | A saved token value (in any spelling of section 6) or a JWT-shaped string is in the file | Never retry as it is. Send an event `report_refused`; go on without a report |
| shared | — | — | Retry until the late window is over |

Accepted in the same states as questions (3.6). A missing report never holds
back the final status.

### 3.11 `GET /runners/{key}/runs/{run_id}/dataset-items` — read the questions

```bash
curl -sS "$RUN/dataset-items?limit=500" "${AUTH[@]}"
```

| Query parameter | Type | Default / limits |
|---|---|---|
| `limit` | integer | Default `500`; `1`–`1000` |
| `after` | string | The `next_after` of the previous page; omit for the first page |

Response (`200`), items of the dataset version the run pinned, in the order of
their position in the dataset; disabled items are left out:

```json
{"items":[{"item_id":"simple_demographics_rows","index":1,"input":"كم عدد الصفوف في جدول الديموغرافيا؟","expected_output":null,"metadata":{"tier":"simple","must_not_contain":["لا توجد بيانات","عذراً","لا أستطيع","غير متوفر"]},"labels":[]}],"next_after":null,"total":139}
```

| Response field | Type | Meaning |
|---|---|---|
| `items` | array | Up to `limit` items |
| `items[].item_id` | string | The item's id in the dataset; 1–200 characters |
| `items[].index` | integer | Its position in the dataset |
| `items[].input` | any JSON value | A string, or an object with a `question` string (4.8) |
| `items[].expected_output` | any JSON value or null | Not used by the runner |
| `items[].metadata` | object | `tier` is filled from the resolved kind when absent or invalid (4.8); `follow_up`, `must_not_contain`, `follow_up_must_not_contain` and all other keys stay as stored |
| `items[].labels` | array of strings | Not used by the runner |
| `next_after` | string or null | Pass it as `after` for the next page; null on the last page. Opaque |
| `total` | integer | Number of items all pages together return |

Read until `next_after` is null and check that the number of items equals
`total`; if it does not, read again from the start, and fail the run after the
third try. Allowed while the run is `starting`, `running` or `stopping`.

**Decision:** the runner reads questions through this route and not through
the datasets API, because the ingestion service does not serve `/v1/datasets`,
the run pins a version id while a version alias can move, the datasets list
computes summaries the runner does not need, and access to the dataset is
checked once, for the person who starts the run.

| HTTP | `error.code` | Meaning | Runner action |
|---|---|---|---|
| `200` | — | A page | Read on |
| `404` | `run_not_found` | Unknown run | Back to idle |
| `409` | `run_not_claimed`, `instance_mismatch` | Not this instance's run | Back to idle |
| `409` | `run_finished` | The run is final | Stop; back to idle |
| `422` | validation array | Bad `after` or `limit` | Start again from the first page |
| shared | — | — | Retry (section 5); after 120 s the run is lost anyway |

### 3.12 `PUT /runners/{key}/runs/{run_id}/tokens/{name}` — report a rotated token

Insightor does not replace refresh tokens today. If a refresh answer ever
carries a refresh token different from the one sent, the runner reports the new
value here, so that the saved sign-in stays valid for the next run. `name` is
`refresh_token`; no other name is accepted in this version.

```bash
curl -sS -X PUT "$RUN/tokens/refresh_token" "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"value":"example-rotated-refresh-token-c81f","replaces_version":3,"expires_at":null}'
```

| Field | Type | Required | Limits / default |
|---|---|---|---|
| `value` | string | yes | 1–8,192 characters; the new token |
| `replaces_version` | integer | yes | The version of the token the runner was using when it was replaced |
| `expires_at` | datetime or null | no | Default null; when the new token ends, if the runner knows |

Response (`200`):

```json
{"name":"refresh_token","version":4,"hint":"c81f"}
```

`version` is the saved version now and `hint` the last 4 characters (empty for
a token shorter than 12 characters, section 6). The runner
records `version` as the one it holds, so that the next control document is not
taken for a hand-off. qym writes an audit row and an event `token_rotated`.
For each run and token name, the first rotation creates that event and later rotations update its `count`, latest `version` and `hint`, `last_at` (UTC timestamp) and message while preserving its first time and position; idempotent retries do not increment it, and each person’s hand-off keeps its own `token_supplied` event.

**Decision:** the write is a compare-and-set on the version, so that a token a
person saved in the meantime is never overwritten by an older rotation.
A repeat of a request that already succeeded (same value, `replaces_version`
one below the saved version) returns the same `200`.

| HTTP | `error.code` | Meaning | Runner action |
|---|---|---|---|
| `200` | — | Saved | Record the new version |
| `403` | `tokens_not_disclosed` | This API key is not the chosen runner key | Send an event; go on |
| `404` | `run_not_found` | Unknown run | Give up |
| `409` | `token_version_conflict` | A newer token was saved by a person | Read the control document and use that token |
| `409` | `run_not_claimed`, `instance_mismatch`, `run_closed` | Not this instance's run, or too late | Give up; send an event `token_rotation_lost` |
| `422` | validation array | Unknown `name`, empty value | A bug |
| shared | — | — | Retry until the late window is over; the value stays in memory only |

---

## 4. Schemas

### 4.1 Control document

| Field | Type | Meaning |
|---|---|---|
| `state` | string | What the runner should be doing: `idle`, `queued`, `active` or `stopping` |
| `run` | object or null | The run of this runner that is not final; null when there is none |
| `run.id` | string | The run's id |
| `run.number` | integer | The run's number in the project, for the report's header |
| `run.project_name` | string | The project's name, for the report's header |
| `run.status` | string | `queued`, `starting`, `running` or `stopping` |
| `run.requested_at` | datetime | When the person started it |
| `run.stop_requested` | boolean | True once a person pressed Stop |
| `run.stop_reason` | string or null | What the person wrote |
| `run.config` | object | The frozen settings of the run (4.2), dataset facts included |
| `run.tokens` | array | The target's tokens with their values. Only for the chosen runner key |
| `run.tokens[].name` | string | `refresh_token` or `access_token` |
| `run.tokens[].value` | string | The token |
| `run.tokens[].hint` | string | Its last 4 characters; empty for a token shorter than 12 characters |
| `run.tokens[].version` | integer | Rises by 1 each time the token is replaced |
| `run.tokens[].expires_at` | datetime or null | When it ends, if a person said so |
| `run.tokens_withheld` | boolean | `true` instead of `tokens`, for any other project key or when no runner key is chosen |
| `run.tokens_digest` | string | HMAC-SHA-256 over the names, versions and values, under a key derived from qym's encryption key; changes when any token changes. A key that is not shown the tokens cannot use it to check a guess of their values |
| `run.token_needed` | string or null | The token name a person is being asked for |
| `last_run` | object or null | The runner's most recent final run while its late window is open |
| `last_run.id`, `last_run.status` | string | That run and how it ended |
| `last_run.finished_at`, `last_run.accepts_results_until` | datetime | End of the run; end of the late window |
| `limits` | object | The numbers of sections 2.4 and 5, as this qym is configured |

`state` follows from the run: `idle` when `run` is null, `queued` when its
status is `queued`, `stopping` when its status is `stopping` or
`stop_requested` is true, otherwise `active`.

Only the chosen, non-revoked runner key receives `tokens`. Other valid project
keys read the same document with `tokens_withheld: true`; this is a successful
`200`, not a `403`. A runner that finds `tokens_withheld` on a queued run
claims it and reports `failed` with the error "This runner's API key is not the
runner key chosen in qym".
**Decision:** claim and fail, instead of leaving the run unclaimed, because the
person then reads the reason within seconds and not "expired" after ten
minutes.

The `ETag` covers `state`, the run's id, status, stop flag and reason,
`tokens_digest`, `token_needed`, the chosen key, whether tokens were disclosed,
`last_run` and `limits`. Withheld and disclosed documents never validate each
other.

**Decision:** `state` takes the four words above (the outline left its values
open), because they are exactly the four things a runner can be asked to do.
**Decision:** the dataset facts are inside `run.config` only (the outline also
listed them beside it), so that one snapshot holds everything frozen at start.
**Decision:** `last_run` is added, so that a runner whose run was ended by qym
can see how it ended and until when results are still taken.

What the runner does with a document:

| Situation | Runner action |
|---|---|
| `state: idle`, runner has no run | Nothing |
| `state: idle` or another run id, runner is running k6 | Stop k6 at once (2.3 rule 7); send results while `last_run.accepts_results_until` is in the future |
| `state: queued` | Claim (3.4) |
| `state: active` | Go on. Compare `tokens[].version` with the versions held |
| `state: stopping` | Stop k6 if it runs; finish as in 2.1 step 8 |
| a token version higher than the one held | Hand-off: check the new token with one refresh call, then give it to the users |

**Idle**

```json
{
  "state": "idle",
  "run": null,
  "last_run": null,
  "limits": {
    "heartbeat_interval_s": 10, "control_interval_idle_s": 10, "control_interval_run_s": 2,
    "progress_interval_s": 5, "stale_after_s": 120, "late_window_s": 600, "stop_kill_after_s": 20,
    "progress_max_bytes": 65536,
    "questions_batch_max": 200, "questions_max_bytes": 1048576, "questions_per_run_max": 50000,
    "log_batch_max": 500, "log_max_bytes": 262144, "log_lines_per_run_max": 50000,
    "events_batch_max": 100, "events_max_bytes": 262144,
    "summary_max_bytes": 262144, "report_max_bytes": 5242880,
    "question_chars_max": 2000, "answer_chars_max": 1000, "log_message_chars_max": 2000
  }
}
```

The other examples leave `limits` out to stay readable; it is always present.

**Job queued** (the sample run, three seconds after the person pressed Start)

```json
{
  "state": "queued",
  "run": {
    "id": "7d3b6c1e-2f4a-4b8e-9c57-0a1d2e3f4a5b",
    "status": "queued",
    "requested_at": "2026-11-20T11:01:39Z",
    "stop_requested": false,
    "stop_reason": null,
    "config": {
      "schema": 1,
      "test_type": "breakpoint",
      "target": {
        "id": "8f0f6f0e-3c1d-4a7b-9e2f-6b5a4c3d2e1f",
        "name": "Insightor · Preprod",
        "is_production": false,
        "base_url": "https://insightor.ingress.preprod.example.org",
        "chat_path": "/change/api/chat",
        "auth_server": null,
        "token_refresh_path": "/auth/token",
        "refresh_cookie_name": "estishraf_rt"
      },
      "tokens": [
        {"name": "refresh_token", "hint": "41bd", "version": 3},
        {"name": "access_token", "hint": "0c2e", "version": 2}
      ],
      "plan": {
        "baseline_users": 5, "max_users": 60, "step_users": 10, "hold_seconds": 450,
        "limit_ms": 180000, "max_error_rate_pct": 10, "follow_up_rate": 0.3,
        "abort_on_break": true, "timeout_seconds": 540,
        "users": null, "duration_seconds": null, "min_quality": null, "max_no_data_pct": null,
        "levels": [10, 20, 30, 40, 50, 60],
        "total_seconds": 3000,
        "warmup_seconds": 30,
        "stages": [
          {"role": "baseline", "target_users": 5, "start_s": 0, "end_s": 60},
          {"role": "ramp", "target_users": 10, "start_s": 60, "end_s": 90},
          {"role": "hold", "target_users": 10, "start_s": 90, "end_s": 540},
          {"role": "ramp", "target_users": 20, "start_s": 540, "end_s": 570},
          {"role": "hold", "target_users": 20, "start_s": 570, "end_s": 1020},
          {"role": "ramp", "target_users": 30, "start_s": 1020, "end_s": 1050},
          {"role": "hold", "target_users": 30, "start_s": 1050, "end_s": 1500},
          {"role": "ramp", "target_users": 40, "start_s": 1500, "end_s": 1530},
          {"role": "hold", "target_users": 40, "start_s": 1530, "end_s": 1980},
          {"role": "ramp", "target_users": 50, "start_s": 1980, "end_s": 2010},
          {"role": "hold", "target_users": 50, "start_s": 2010, "end_s": 2460},
          {"role": "ramp", "target_users": 60, "start_s": 2460, "end_s": 2490},
          {"role": "hold", "target_users": 60, "start_s": 2490, "end_s": 2940},
          {"role": "cooldown", "target_users": 5, "start_s": 2940, "end_s": 2970},
          {"role": "cooldown", "target_users": 0, "start_s": 2970, "end_s": 3000}
        ]
      },
      "mix": {"simple": 50, "medium": 35, "complex": 15},
      "dataset": {
        "id": "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
        "name": "Insightor load questions",
        "version_id": "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
        "version": "v3",
        "item_count": 139,
        "content_hash": "3b7e0c1f9a2d4e6f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f",
        "tier_counts": {"simple": 30, "medium": 38, "complex": 71},
        "single_kind": false
      },
      "options": {"store_answers": true, "question_sent_lines": true},
      "note": ""
    },
    "tokens": [
      {"name": "refresh_token", "value": "example-refresh-token-41bd", "hint": "41bd", "version": 3, "expires_at": null},
      {"name": "access_token", "value": "example-access-token-0c2e", "hint": "0c2e", "version": 2, "expires_at": null}
    ],
    "tokens_digest": "9d4c1e7a0b3f5d286a1c4e7f9b2d5a8c0e3f6b9d2a5c8e1f4b7d0a3c6e9f2b5d",
    "token_needed": null
  },
  "last_run": null
}
```

**Running** (the same run after the claim and the first `running` report)

```json
{
  "state": "active",
  "run": {
    "id": "7d3b6c1e-2f4a-4b8e-9c57-0a1d2e3f4a5b",
    "status": "running",
    "requested_at": "2026-11-20T11:01:39Z",
    "stop_requested": false,
    "stop_reason": null,
    "config": {"schema": 1, "test_type": "breakpoint", "note": "the full object, exactly as in the queued example"},
    "tokens": [
      {"name": "refresh_token", "value": "example-refresh-token-41bd", "hint": "41bd", "version": 3, "expires_at": null},
      {"name": "access_token", "value": "example-access-token-0c2e", "hint": "0c2e", "version": 2, "expires_at": null}
    ],
    "tokens_digest": "9d4c1e7a0b3f5d286a1c4e7f9b2d5a8c0e3f6b9d2a5c8e1f4b7d0a3c6e9f2b5d",
    "token_needed": null
  },
  "last_run": null
}
```

In the next three examples `config`, `requested_at` and `last_run` are the same
as above and are left out.

**Stop requested** (a person pressed Stop; the status is already `stopping`)

```json
{
  "state": "stopping",
  "run": {
    "id": "7d3b6c1e-2f4a-4b8e-9c57-0a1d2e3f4a5b",
    "status": "stopping",
    "stop_requested": true,
    "stop_reason": "Preprod is needed for a release check",
    "tokens": [
      {"name": "refresh_token", "value": "example-refresh-token-41bd", "hint": "41bd", "version": 3, "expires_at": null},
      {"name": "access_token", "value": "example-access-token-0c2e", "hint": "0c2e", "version": 2, "expires_at": null}
    ],
    "tokens_digest": "9d4c1e7a0b3f5d286a1c4e7f9b2d5a8c0e3f6b9d2a5c8e1f4b7d0a3c6e9f2b5d",
    "token_needed": null
  }
}
```

**Token needed** (the refresh token was rejected; the runner reported
`waiting_for_token: "refresh_token"` while holding version 3, and qym now asks
a person). The document still carries the rejected token: nothing newer exists.

```json
{
  "state": "active",
  "run": {
    "id": "7d3b6c1e-2f4a-4b8e-9c57-0a1d2e3f4a5b",
    "status": "running",
    "stop_requested": false,
    "stop_reason": null,
    "tokens": [
      {"name": "refresh_token", "value": "example-refresh-token-41bd", "hint": "41bd", "version": 3, "expires_at": null},
      {"name": "access_token", "value": "example-access-token-0c2e", "hint": "0c2e", "version": 2, "expires_at": null}
    ],
    "tokens_digest": "9d4c1e7a0b3f5d286a1c4e7f9b2d5a8c0e3f6b9d2a5c8e1f4b7d0a3c6e9f2b5d",
    "token_needed": "refresh_token"
  }
}
```

**Token supplied** (a person pasted a new refresh token in the run page: its
version is 4, the digest changed, `token_needed` is cleared)

```json
{
  "state": "active",
  "run": {
    "id": "7d3b6c1e-2f4a-4b8e-9c57-0a1d2e3f4a5b",
    "status": "running",
    "stop_requested": false,
    "stop_reason": null,
    "tokens": [
      {"name": "refresh_token", "value": "example-new-refresh-token-7a2e", "hint": "7a2e", "version": 4, "expires_at": null},
      {"name": "access_token", "value": "example-access-token-0c2e", "hint": "0c2e", "version": 2, "expires_at": null}
    ],
    "tokens_digest": "1f6a9c2e5b8d0f3a6c9e2b5d8f1a4c7e0b3d6f9a2c5e8b1d4f7a0c3e6b9d2f5a",
    "token_needed": null
  }
}
```

The hand-off, step by step:

1. The runner's own refresh call is rejected (HTTP 400, 401 or 403). It reports
   `auth.state: "rejected"` and `waiting_for_token: "refresh_token"` with the
   version it holds.
2. qym sets `token_needed`. The run page asks for a new token.
3. A person saves one. Its version rises, `token_needed` is cleared, the digest
   and so the `ETag` change. Progress responses show the new number in
   `token_versions`.
4. The runner reads the control document (`200`), checks the new refresh token
   with one refresh call, and hands it to the simulated users. It reports
   `waiting_for_token: null` and `auth.state: "recovered"` with the new version.
5. If the new token is rejected too, the runner reports `waiting_for_token`
   again, now holding the new version, and qym asks again.

The users pick a new token up within about 30 seconds. A level in which sign-in
errors happened is shown and not counted; that is the suite's rule and it stays.

### 4.2 Run config

`run.config` is written by qym when the run is started and never changes.

| Field | Type | Meaning |
|---|---|---|
| `schema` | integer | `1` |
| `test_type` | string | `breakpoint`, `smoke` or `soak` |
| `target.id`, `target.name` | strings | The target as a Manager saved it; for the log and the report |
| `target.is_production` | boolean | The target is marked as production |
| `target.base_url` | string | Origin of the system under test, without a trailing slash |
| `target.chat_path` | string | Path of the chat route; the suite's `/change/api/chat` unless the Manager changed it |
| `target.auth_server` | string or null | Origin of a separate sign-in host; null means `base_url`. Not in the target dialog: null unless set through the API |
| `target.token_refresh_path` | string | Path of the sign-in renewal (refresh) route; the suite's `/auth/token` unless the Manager changed it |
| `target.refresh_cookie_name` | string | Name of the cookie that carries the refresh token. Not in the target dialog: the suite's `estishraf_rt` unless set through the API |
| `tokens[]` | `{name, hint, version}` | Which tokens were saved when the run was started; never values |
| `plan.baseline_users` | integer or null | Breakpoint: users of the first stage |
| `plan.max_users`, `plan.step_users` | integer or null | Breakpoint: highest level asked for; users added per level |
| `plan.hold_seconds` | integer or null | Breakpoint: seconds each level is held |
| `plan.limit_ms` | integer | Time limit for 95% of answers; a multiple of 1000 |
| `plan.max_error_rate_pct` | integer | Highest error rate, percent |
| `plan.follow_up_rate` | number or null | Breakpoint: share of answers followed by a follow-up question, 0–1 |
| `plan.abort_on_break` | boolean or null | Breakpoint: stop by itself at the first broken level |
| `plan.timeout_seconds` | integer | Seconds after which one answer is given up |
| `plan.users`, `plan.duration_seconds` | integer or null | Smoke and Soak: users and length |
| `plan.min_quality` | number or null | Smoke and Soak: lowest mean quality score, 0–100 |
| `plan.max_no_data_pct` | number or null | Smoke and Soak: highest share of "no data" answers |
| `plan.levels` | array of integers | Computed by qym: the levels, or `[users]` for Smoke and Soak |
| `plan.total_seconds` | integer | Computed by qym: the planned length |
| `plan.warmup_seconds` | integer | Seconds at the start whose answers are not measured |
| `plan.stages[]` | `{role, target_users, start_s, end_s}` | Computed by qym: `role` is `baseline`, `ramp`, `hold`, `cooldown`, or `steady` for the single stage of Smoke and Soak |
| `mix` | `{simple, medium, complex}` | Share of each tier in percent; integers that add up to 100 |
| `dataset.id`, `dataset.name` | strings | The dataset |
| `dataset.version_id`, `dataset.version` | strings | The pinned version and its label |
| `dataset.item_count` | integer | Items route 3.11 returns |
| `dataset.content_hash` | string | The version's content hash, for the record |
| `dataset.tier_counts` | `{simple, medium, complex}` | Items per tier as qym counted them at the start |
| `dataset.single_kind` | boolean | True when no item of the version has a valid kind in `metadata.tier` or `metadata.complexity`: all its questions count as one kind (4.8) |
| `options.store_answers` | boolean | False: send `answer: null` with every question and build the report without the raw log |
| `options.question_sent_lines` | boolean | True: ask the suite for a line when a question is sent, so that answers in flight can be counted |
| `note` | string | The person's note; up to 500 characters |

**Targets.** A target is added and edited by a Manager in qym, in the first
step of the New run page: a name, an address (`base_url`: scheme and host, the
suite's `BASE_URL`), the chat path and the sign-in renewal path (both default
to the suite's), an optional highest number of users, and a production switch.
Nothing is built in and there is no fixed list of environments. Two targets of
a project cannot share a name or an address. Changing the address removes the
target's saved tokens. A target that has runs is archived, not deleted.
`run.config.target` is a copy taken when the run was started, so a later edit
of the target never changes the address a run ran against. The start route
refuses a plan above the target's highest number of users; the runner does not
check it again.

Allowed plan values:

| Field | From | To |
|---|---|---|
| `baseline_users`, `max_users`, `step_users`, `users` | 1 | 200 (`QYM_PERFORMANCE_MAX_USERS`), and the target's own highest number of users when one is set |
| `hold_seconds` | 30 | 3600 |
| `limit_ms` | 1000 | 900000, multiples of 1000 |
| `max_error_rate_pct` | 1 | 100 |
| `follow_up_rate` | 0 | 1 |
| `timeout_seconds` | 30 | 900 |
| `duration_seconds` (Soak) | 60 | 28800 (`QYM_PERFORMANCE_MAX_DURATION_SECONDS`) |
| `total_seconds` | — | 28800 (the same setting), and the target's own limit when one is set |

**Decision:** these ranges are the terminal tool's own input rules narrowed by
the platform caps; neither DESIGN.md nor the outline fixes them, and the layout
page uses narrower sliders. The one value DESIGN.md does fix is the longest
run: 8 hours (section 9, decision 12), so the cap is 28,800 seconds. The first
draft of this guide had 7,200.

Smoke is always 1 user for 180 seconds. Its limits and Soak's come from
`plan.limit_ms`, `plan.max_error_rate_pct`, `plan.min_quality` (default 70) and
`plan.max_no_data_pct` (default 20).

**Plan check.** Before starting k6 the runner runs `k6 inspect` on the script
with the job's settings and compares what k6 returns with `config.plan`: for
Breakpoint the list of stages (each length must equal `end_s − start_s`, each
target `target_users`) and their sum against `total_seconds`; for Smoke and
Soak the users and the length. If anything differs the runner does not start
k6 and reports `failed` with "The plan qym computed differs from the plan the
suite would run". The rules themselves, with test cases for both ports, are in
`tests/platform/performance/plan_cases.json`.

The runner also refuses, before starting k6, a dataset that has no usable
question in a tier whose `mix` share is above 0. A dataset without any resolved kind is
a case of its own (`dataset.single_kind`, section 4.8).

How the runner turns the config into the suite's settings is its own business;
for orientation only:

| Config | Suite variable |
|---|---|
| `target.base_url`, `target.chat_path` | `BASE_URL`, `CONVERSATIONS_ENDPOINT` |
| `target.auth_server`, `target.token_refresh_path`, `target.refresh_cookie_name` | `AUTH_SERVER`, `TOKEN_REFRESH_ENDPOINT`, `REFRESH_COOKIE_NAME` |
| tokens | `AUTH_TYPE=token`, `ACCESS_TOKEN`, `REFRESH_TOKEN`, and the runner's own token endpoint in `TOKEN_BROKER_URL` |
| `plan.baseline_users`, `max_users`, `step_users`, `hold_seconds` | `BASELINE_VUS`, `MAX_VUS`, `STEP_SIZE`, `HOLD_DURATION` |
| `plan.limit_ms`, `max_error_rate_pct` | `MAX_ACCEPTABLE_RESPONSE_MS`, `MAX_ERROR_RATE_PCT` (Breakpoint); `SMOKE_MAX_ACCEPTABLE_RESPONSE_MS`, `SMOKE_MAX_ERROR_RATE_PCT` (Smoke); the same two with `SOAK_` (Soak) |
| `plan.min_quality`, `max_no_data_pct` | `SMOKE_MIN_QUALITY_SCORE`, `SMOKE_MAX_NO_DATA_PCT` (Smoke); the same two with `SOAK_` (Soak) |
| `plan.follow_up_rate`, `abort_on_break`, `timeout_seconds` | `FOLLOWUP_RATE`, `ABORT_ON_BREAK`, `SSE_TIMEOUT` |
| `plan.users`, `duration_seconds` | `SMOKE_VUS`, `SMOKE_DURATION` or `SOAK_VUS`, `SOAK_DURATION` |
| the question file | `QUESTIONS_FILE` (the path of the file the runner wrote) |
| `mix` | `QUESTION_MIX=<simple>,<medium>,<complex>` (percent, adding up to 100) |
| always | `QUESTION_LINE_KEYS=true` (one shared key on the request, question and answer lines) |
| `options.question_sent_lines` | `QUESTION_SENT_LINES=true` (one `[SENT]` line when a question is sent) |

A wrong value of one of these settings stops the suite at start-up with exit
code 107. The exact settings and line formats, the `[SENT]` line and the shared
key included, are in `runner/CONTRACT.md` of the suite repository.

k6 never receives the runner's qym key.

### 4.3 Progress object

Everything the run page shows while a run is live comes from the last progress
object. The runner computes it from k6's lines; the numbers of the summary
(4.7) come from k6 itself and replace it at the end.

| Field | Type | Unit | Meaning |
|---|---|---|---|
| `phase` | string | — | `preflight`, `baseline`, `ramp`, `hold`, `cooldown`, `steady` (Smoke and Soak), `stopping` or `finishing` |
| `step` | string or null | — | During `preflight`: `dataset`, `sign_in`, `plan_check` or `starting_k6` |
| `elapsed_s` | number | seconds | Time since k6 started, as k6 reports it; 0 before |
| `planned_s` | integer | seconds | `config.plan.total_seconds` |
| `stage` | object or null | — | The stage k6 is in: `{index, of, role, target_users, start_s, end_s}`; `index` counts from 1 |
| `level` | integer or null | users | The level being held; null outside a hold |
| `users` | integer or null | users | Users active now, as k6 reports them |
| `users_max` | integer or null | users | Most users the plan reaches |
| `answers.sent` | integer or null | answers | Questions sent so far; null when `question_sent_lines` is off |
| `answers.finished` | integer | answers | Answers that came back or failed, whole run |
| `answers.ok` | integer | answers | Of those, without error |
| `answers.errors` | integer | answers | Of those, with an error (sum of `errors_by_kind`) |
| `answers.interrupted` | integer | answers | Cut off by the end of the run; not errors |
| `answers.in_flight` | integer or null | answers | Sent and not yet finished; null when `question_sent_lines` is off |
| `answers.oldest_in_flight_s` | number or null | seconds | Age of the oldest answer in flight; null when none or unknown |
| `answers.follow_ups` | integer | answers | Finished answers that were follow-up questions |
| `answers.warmup` | integer | answers | Finished answers inside the warm-up; not measured |
| `errors_by_kind` | object | answers | `auth`, `rate_limit`, `server`, `network`, `run_failed`, `other` (below) |
| `p95_ms` | number or null | ms | 95th percentile of the answer time over all finished answers so far |
| `ttfb_p95_ms` | number or null | ms | 95th percentile of the time to the first byte so far |
| `quality_mean` | number or null | 0–100 | Mean quality score so far, warm-up excluded |
| `no_data_pct` | number or null | percent | Share of answers that said "no data", warm-up excluded |
| `levels` | array | — | One entry per level whose hold has begun (below); `[]` for Smoke and Soak |
| `auth.state` | string | — | `ok`, `rejected` (the refresh token is refused) or `recovered` (a new token works) |
| `auth.token_versions` | object | — | Version of each token the runner holds now |
| `auth.refresh_ok`, `auth.refresh_failed` | integers | calls | Refresh calls by the simulated users so far |
| `auth.users_rejected`, `auth.users_recovered` | integers | users | Users whose refresh was refused; users that picked a new token up |
| `auth.rejected_at`, `auth.recovered_at` | datetime or null | — | First refusal; first success after it |
| `waiting_for_token` | string or null | — | The token name the runner needs from a person; null when none |
| `dropped.questions`, `dropped.log_lines` | integers | records | What the runner had to throw away (section 5) |

Error kinds, by the suite's own rule:

| Kind | An answer counts here when |
|---|---|
| `auth` | HTTP 401 or 403 |
| `rate_limit` | HTTP 429 |
| `server` | HTTP 500–599 |
| `network` | No HTTP answer: timeout or connection error |
| `run_failed` | HTTP 200 but the answer says the run failed |
| `other` | Any other status that is not 200 |

**Decision:** six kinds, the ones the suite's live view already uses (the
layout sketch had four), because k6 cannot tell a timeout from a lost
connection and both are `network`.

An entry of `levels`:

| Field | Type | Unit | Meaning |
|---|---|---|---|
| `level` | integer | users | The level |
| `state` | string | — | `running` while its hold lasts, then `done` |
| `hold_elapsed_pct` | number | percent | How much of the hold has passed; 100 when it ran to its end |
| `answers` | integer | answers | Answers counted for this level: sent during its hold, outside the warm-up, not interrupted |
| `errors`, `error_pct` | integer, number | answers, percent | Errors among them |
| `auth_errors` | integer | answers | Of those, HTTP 401 or 403 |
| `interrupted` | integer | answers | Sent during the hold and cut off by the end of the run |
| `p50_ms`, `p95_ms`, `max_ms` | number or null | ms | Answer time |
| `ttfb_p95_ms` | number or null | ms | Time to the first byte |
| `per_minute` | number | answers/min | `answers` divided by the minutes of the hold that have passed |
| `quality_mean`, `no_data_pct` | number or null | 0–100, percent | As above, for this level |
| `result` | string | — | `pass`, `break`, `auth` (sign-in errors: not counted) or `no_data`; while `state` is `running` it is what the level looks like so far |
| `reason` | string or null | — | For `break`: `latency`, `errors` or `both` |

A level is judged by the suite's rule: `auth` when `auth_errors` is above 0;
otherwise `break` when `p95_ms` is at or above `plan.limit_ms` or `error_pct` is
at or above `plan.max_error_rate_pct`; otherwise `pass`.

**Decision:** the field is `waiting_for_token` with the token name, plus the
versions the runner holds (the outline had `waiting = "token:<name>"`), so that
qym can tell a stale request for a token from a real one without parsing text.
**Decision:** the phase of Smoke and Soak is called `steady` (the suite writes
`none`), because `none` reads as "nothing is running".

The sample run at 1,290 seconds:

```json
{
  "phase": "hold",
  "step": null,
  "elapsed_s": 1290.0,
  "planned_s": 3000,
  "stage": {"index": 7, "of": 15, "role": "hold", "target_users": 30, "start_s": 1050, "end_s": 1500},
  "level": 30,
  "users": 30,
  "users_max": 60,
  "answers": {"sent": 475, "finished": 449, "ok": 447, "errors": 2, "interrupted": 0, "in_flight": 26, "oldest_in_flight_s": 101.1, "follow_ups": 71, "warmup": 7},
  "errors_by_kind": {"auth": 0, "rate_limit": 0, "server": 2, "network": 0, "run_failed": 0, "other": 0},
  "p95_ms": 87529,
  "ttfb_p95_ms": 31940,
  "quality_mean": 99.0,
  "no_data_pct": 2.5,
  "levels": [
    {"level": 10, "state": "done", "hold_elapsed_pct": 100, "answers": 116, "errors": 1, "error_pct": 0.86, "auth_errors": 0, "interrupted": 0, "p50_ms": 25037, "p95_ms": 67830, "max_ms": 87468, "ttfb_p95_ms": 27020, "per_minute": 15.5, "quality_mean": 98.6, "no_data_pct": 4.3, "result": "pass", "reason": null},
    {"level": 20, "state": "done", "hold_elapsed_pct": 100, "answers": 194, "errors": 1, "error_pct": 0.52, "auth_errors": 0, "interrupted": 0, "p50_ms": 33597, "p95_ms": 84729, "max_ms": 107308, "ttfb_p95_ms": 32762, "per_minute": 25.9, "quality_mean": 99.5, "no_data_pct": 1.0, "result": "pass", "reason": null},
    {"level": 30, "state": "running", "hold_elapsed_pct": 53.3, "answers": 89, "errors": 0, "error_pct": 0.0, "auth_errors": 0, "interrupted": 0, "p50_ms": 40654, "p95_ms": 107112, "max_ms": 121300, "ttfb_p95_ms": 41330, "per_minute": 22.3, "quality_mean": 99.1, "no_data_pct": 2.2, "result": "pass", "reason": null}
  ],
  "auth": {"state": "ok", "token_versions": {"refresh_token": 3, "access_token": 2}, "refresh_ok": 61, "refresh_failed": 0, "users_rejected": 0, "users_recovered": 0, "rejected_at": null, "recovered_at": null},
  "waiting_for_token": null,
  "dropped": {"questions": 0, "log_lines": 0}
}
```

qym checks the fields named in this section and keeps keys it does not know, so
a newer runner can add a field without a qym release.

### 4.4 Question record

One record per answer that finished, failed or was cut off, in the order they
ended.

| Field | Type | Required | Limits / default |
|---|---|---|---|
| `seq` | integer | yes | 1–2,147,483,647; unique within the run; the record's identity |
| `asked_at` | datetime | yes | When the question was sent |
| `elapsed_s` | number | yes | Seconds since k6 started, when the question was sent |
| `stage` | string | yes | `baseline`, `ramp`, `hold`, `cooldown` or `steady` |
| `level` | integer or null | no | Default null. The level this answer is counted in; null when it is not counted in any |
| `user` | integer | yes | Number of the simulated user, from 1 |
| `tier` | string | yes | `simple`, `medium` or `complex` |
| `question_id` | string | yes | 1–200 characters; the dataset item's `item_id`. A follow-up carries the id of the item it follows |
| `is_followup` | boolean | no | Default false |
| `question` | string | yes | The text sent; qym keeps the first 2,000 characters |
| `status` | string | yes | `ok`, `error` or `interrupted` |
| `http_status` | integer | yes | 0–599; 0 when there was no HTTP answer |
| `error_kind` | string or null | no | Default null; one of the six kinds of 4.3 when `status` is `error` |
| `duration_ms` | number | yes | Time until the answer was complete or failed; finite, not negative |
| `ttfb_ms` | number or null | no | Default null; time to the first byte |
| `quality` | number or null | no | Default null; 0–100. Null in the warm-up and for errors |
| `no_data` | boolean | no | Default false; the answer said it has no data |
| `warmup` | boolean | no | Default false; sent inside the warm-up |
| `attempts` | integer | no | Default 1; tries the suite needed |
| `answer` | string or null | no | Default null; the first 1,000 characters of the answer. Always null when `options.store_answers` is false |
| `answer_truncated` | boolean | no | Default false; the suite cut the answer |

qym removes NUL characters, cuts `question` at 2,000 and `answer` at 1,000
characters, and sets `answer_truncated` when it cut the answer. It stores no
answer for a run that was started with `options.store_answers` false, and it
replaces an exact occurrence of a current token value in either text with
`[REDACTED]`.

**Decision:** `level` is null for an answer that no level counts (outside a
hold, inside the warm-up, interrupted), and `stage` says where it was sent, so
that filtering the questions by level gives exactly the answers behind that
level's numbers. The outline's table has no column for `stage`, `user`,
`elapsed_s`, `warmup` and `attempts`; the pages need them.
**Decision:** `status` takes three words, `ok`, `error` and `interrupted`,
because an answer cut off by the end of the run is neither.

```json
{"seq":458,"asked_at":"2026-11-20T11:22:48.300Z","elapsed_s":1248.3,"stage":"hold","level":30,"user":25,"tier":"simple","question_id":"simple_citizens_count","is_followup":false,"question":"كم عدد المواطنين الموجودين الآن؟","status":"ok","http_status":200,"error_kind":null,"duration_ms":33319,"ttfb_ms":12518,"quality":100,"no_data":false,"warmup":false,"attempts":1,"answer":"عدد المواطنين 18,792,262","answer_truncated":false}
```

### 4.5 Log line

| Field | Type | Required | Limits / default |
|---|---|---|---|
| `seq` | integer | yes | 1–2,147,483,647; unique within the run, in the order the lines were written |
| `at` | datetime | yes | When the line was written |
| `level` | string | yes | `info`, `warning` or `error` |
| `message` | string | yes | 1 character or more; qym keeps the first 2,000 and masks tokens (section 6) |

The log is what a person reads to follow a run; qym does not parse it.
**Decision:** the runner sends a chosen log and not k6's raw output, because
the raw output repeats the questions and answers that travel as records, and a
progress line every second would be most of it.

Sent: the suite's start lines; one line per finished question (as in the 3.7
example); every sign-in line of level warning or error; sign-in lines of level
info gathered into one line per 30 seconds; stage changes; every k6 warning and
error; the result table k6 prints at the end; the runner's own notes, starting
with `runner: `. Not sent: the question and answer lines, the raw telemetry
lines and k6's progress line.

### 4.6 Event

| Field | Type | Required | Limits / default |
|---|---|---|---|
| `at` | datetime | yes | When it happened |
| `level` | string | yes | `info`, `warning` or `error` |
| `code` | string | yes | 1–60 characters, `^[a-z0-9_]+$` |
| `message` | string | yes | 1–2,000 characters, plain words |
| `details` | object | no | Default `{}`; finite JSON; credential keys dropped (section 6) |
| `run_id` | string or null | no | Default null; the run it belongs to. With a run id the event appears on that run's timeline |

**Decision:** an event's identity is the runner, `run_id`, `at` and `code`; a
repeat is ignored. That makes a retry after a lost answer safe without a new
column. Give two events of the same code different times.

Codes the pages know (others are shown as they come): `run_started`,
`stage_started`, `level_passed`, `level_broke`, `level_not_counted`,
`first_slow_answer`, `first_error`, `auto_stop`, `stop_received`, `k6_exited`,
`k6_killed`, `token_rejected`, `token_accepted`, `token_picked_up`,
`preflight_failed`, `qym_unreachable`, `records_dropped`, `items_skipped`,
`report_too_large`, `report_refused`, `summary_refused`, `token_rotation_lost`.
qym writes its own events on the same timeline: `claimed`, `stop_requested`,
`token_supplied`, `token_rotated`, `interrupted`, `expired`.

### 4.7 Summary

The summary is the suite's own result, renamed field by field. Nothing is
recomputed except where the table says "runner".

| Field | Type | Meaning |
|---|---|---|
| `schema` | integer | `1` |
| `test_type` | string | `breakpoint`, `smoke` or `soak` |
| `verdict` | string | The suite's word, unchanged. Breakpoint: `breakpoint_found`, `not_reached`, `invalid_auth`, `invalid_no_data`. Smoke and Soak: `pass`, `fail` |
| `verdict_reason` | string or null | The suite's sentence |
| `ended_by` | string | `plan` (ran to its end), `auto_stop` (stopped itself at a broken level), `stop` (a person), `runner` (the runner stopped it), `error` |
| `exit_code` | integer or null | k6's exit code |
| `started_at`, `ended_at` | datetime | As the suite measured |
| `target_url` | string | The chat URL the suite called |
| `headline` | object | The values the history table shows (below) |
| `thresholds` | array | One line per limit: `{scope, metric, expression, measured, ok}` |
| `levels` | array | Breakpoint: one entry per planned level. `[]` for Smoke and Soak |
| `overall` | object | Whole-run numbers of the suite |
| `auth` | object | Sign-in health |
| `counts` | object | Volume |
| `plan` | object | The settings and stages the suite resolved |
| `suite_summary` | object | The suite's result file, unchanged |

`overall`, `auth`, `counts`, `plan` and `suite_summary` may be left out (the
example in section 8 leaves them out); the other fields are required, and
`test_type` must be the test type of the run.

`headline`, every field a number or null (absent means null):

| Field | Unit | Meaning |
|---|---|---|
| `safe_load_users` | users | The highest level that passed |
| `breaking_level_users` | users | The level that broke a limit |
| `breaking_reason` | — | A string: `latency`, `errors` or `both` |
| `recommended_max_users` | users | 80% of the safe load |
| `p95_at_safe_load_ms` | ms | 95th percentile of the answer time at the safe load |
| `answers_measured` | answers | Answers the verdict rests on |
| `duration_s` | seconds | Run length |
| `p95_ms` | ms | 95th percentile over the whole run |
| `answers_total`, `errors_total` | answers | All finished answers of the run; errors among them |
| `error_rate_pct` | percent | `errors_total` of `answers_total` |
| `ttfb_p95_ms` | ms | Time to the first byte, whole run |
| `max_users` | users | Most users active at once |
| `quality_mean` | 0–100 | Mean quality score |

An entry of `thresholds`: `scope` (string, `run`), `metric` (string),
`expression` (string, as k6 writes it), `measured` (number or null), `ok`
(boolean).

**Decision:** the verdict keeps the suite's words (DESIGN.md), and `verdict` is
required: a run without a result file gets no summary at all, so that a stored
verdict is always one the suite gave.
**Decision:** the suite's file rides along unchanged in `suite_summary`, so
that any number can be compared with the terminal tool's without the runner.

How the pages word a verdict: `breakpoint_found` "Breaks at N users" with the
reason (time or errors), `not_reached` "No break up to N users", `invalid_auth`
"Not valid: sign-in", `invalid_no_data` "No measurement", `pass` "Passed",
`fail` "Failed". A stopped or interrupted run keeps the verdict of what was
measured; the status says how it ended.

**Mapping, Breakpoint** (left: `breakpoint-summary-<stamp>.json`):

| Suite field | Protocol field | Note |
|---|---|---|
| `test` | `test_type` | |
| `verdict` | `verdict` | Unchanged |
| `verdictReason` | `verdict_reason` | |
| `startedAt`, `endedAt` | `started_at`, `ended_at` | |
| `targetUrl` | `target_url` | |
| `maxSustainableVUs` | `headline.safe_load_users` | The highest level that passed below the first break; 0 when none |
| `breakingPointVUs` | `headline.breaking_level_users` | Null unless the verdict is `breakpoint_found` |
| `firstBreachReason` | `headline.breaking_reason` | `latency`, `errors` or `both`; null unless `breakpoint_found` |
| `firstBreachLevel` | — | Not carried on its own: it equals `breakingPointVUs` whenever the verdict is `breakpoint_found`. Kept in `suite_summary` |
| `recommendedProductionMaxVUs` | `headline.recommended_max_users` | 80% of the safe load, rounded down |
| `levels[level = maxSustainableVUs].p95Ms` | `headline.p95_at_safe_load_ms` | Null when the safe load is 0 |
| `totalQuestionsSent` | `headline.answers_measured` | Answers counted in the holds; equals the sum of `levels[].answers` |
| `elapsedTestSeconds` | `headline.duration_s` | Run length |
| `overallGates.llmResponseP95Ms` | `headline.p95_ms`, `overall.p95_ms` | Whole run, all levels mixed |
| — (runner) | `headline.answers_total`, `headline.errors_total`, `headline.error_rate_pct` | All finished answers of the run and the errors among them, from the runner's counters |
| — (runner) | `headline.ttfb_p95_ms` | From the runner's counters |
| — (runner) | `headline.max_users` | Most users k6 reported as active |
| `levels[].qualityAvg` weighted by `requests` | `headline.quality_mean` | |
| `overallGates.llmResponseP95Ms`, `latencyGatePass` | `thresholds[]` `{scope: "run", metric: "llm_response_duration", expression: "p(95)<" + config.maxAcceptableMs, measured, ok}` | |
| `overallGates.httpReqFailedRate`, `errorGatePass` | `thresholds[]` `{scope: "run", metric: "http_req_failed", expression: "rate<" + config.maxErrorRatePct / 100, measured, ok}` | |
| `overallGates.httpReqFailedRate` | `overall.http_failed_rate` | Over all HTTP calls, sign-in included |
| `levels[].level` | `levels[].level` | |
| `levels[].requests` | `levels[].answers` | |
| `levels[].interrupted` | `levels[].interrupted` | |
| `levels[].p50Ms`, `p90Ms`, `p95Ms`, `p99Ms` | `levels[].p50_ms`, `p90_ms`, `p95_ms`, `p99_ms` | |
| `levels[].avgMs`, `minMs`, `maxMs` | `levels[].avg_ms`, `min_ms`, `max_ms` | |
| `levels[].ttfbP50Ms`, `ttfbP95Ms` | `levels[].ttfb_p50_ms`, `ttfb_p95_ms` | Time to the first byte |
| `levels[].errorPct` | `levels[].error_pct` | |
| `levels[].noDataPct` | `levels[].no_data_pct` | |
| `levels[].authErrorPct`, `authContaminated` | `levels[].auth_error_pct`, `auth_contaminated` | |
| `levels[].qualityAvg` | `levels[].quality_mean` | |
| `levels[].followUps` | `levels[].follow_ups` | |
| `levels[].throughputPerMin` | `levels[].per_minute` | Answers divided by the hold in minutes |
| `levels[].holdStartSec`, `holdEndSec` | `levels[].hold_start_s`, `hold_end_s` | |
| `levels[].byComplexity.<tier>.requests`, `avgMs`, `p95Ms` | `levels[].by_tier.<tier>.answers`, `avg_ms`, `p95_ms` | |
| `levels[].passed`, `latencyBreach`, `errorBreach`, `hasData` | `levels[].passed`, `latency_breach`, `error_breach`, `has_data` | |
| `levels[]` (four flags above) | `levels[].result` | The suite's table word in lower case: `auth` when `authContaminated`; else `no_data` when not `hasData`; else `pass` when `passed`; else `break` |
| — (runner) | `levels[].hold_elapsed_pct` | How much of the hold had passed when the run ended |
| `authHealth.refreshOk`, `refreshFailed`, `refreshTransient`, `noToken`, `brokerPickups` | `auth.refresh_ok`, `refresh_failed`, `refresh_transient`, `no_token`, `broker_pickups` | |
| `authHealth.firstRefreshFailureSec`, `firstAuthErrorSec`, `refreshTokenRejected` | `auth.first_refresh_failure_s`, `first_auth_error_s`, `refresh_token_rejected` | |
| `authIncident.firstFailureSec`, `recoveredSec`, `contaminatedLevels`, `cleanLevels` | `auth.incident.first_failure_s`, `recovered_s`, `contaminated_levels`, `clean_levels` | `auth.incident` is null when `authIncident` is null. The five counters `authIncident` repeats are those of `authHealth` |
| `cleanUntilLevel` | `auth.clean_until_level` | |
| `totalIterations`, `totalFollowUps`, `interruptedRequests` | `counts.iterations`, `follow_ups`, `interrupted` | |
| `questionsByComplexity` | `counts.by_tier` | |
| `questionSet` | `plan.question_set` | |
| `config.baselineVUs`, `maxVUs`, `stepSize`, `holdDuration` | `plan.baseline_users`, `max_users`, `step_users`, `hold_seconds` | |
| `config.maxAcceptableMs`, `maxErrorRatePct`, `followUpRate`, `abortOnBreak`, `abortGrace` | `plan.limit_ms`, `max_error_rate_pct`, `follow_up_rate`, `abort_on_break`, `abort_grace` | |
| `config.levels`, `rampSeconds`, `baselineHoldSeconds`, `warmupSeconds`, `sseTimeoutSec` | `plan.levels`, `ramp_seconds`, `baseline_seconds`, `warmup_seconds`, `timeout_seconds` | |
| `stagePlan[].role`, `target`, `startSec`, `endSec` | `plan.stages[].role`, `target_users`, `start_s`, `end_s` | |
| the whole file | `suite_summary` | Unchanged |
| — (runner) | `ended_by`, `exit_code` | Exit code 0: `plan`. 99: `auto_stop` when `abort_on_break` is on and the run ended before `total_seconds`, otherwise `plan`. 105 or 103: `stop` after a stop request, otherwise `runner` |

The suite judges every level that has data, also one whose hold was cut short
by a stop. `hold_elapsed_pct` lets a page say so; the verdict is not changed.

**Every level entry is complete.** The summary has one entry per planned level,
also for a level the run never reached (`has_data: false`, `result: "no_data"`).
qym refuses a summary with the `422` validation array, and stores nothing, when
an entry lacks one of these fields:

- `level` (a whole number), `result` (`pass`, `break`, `auth` or `no_data`);
- `has_data`, `passed`, `latency_breach`, `error_breach`: JSON `true` or `false`;
- `answers` (a whole number), `hold_elapsed_pct` and `error_pct` (0 to 100),
  `per_minute` (0 or more): numbers when `has_data` is `true`. A level without
  data (`has_data: false`) may send them as `null`; the key is never left out.
  A level with data that sends one of them as `null` is refused the same way;
- `p50_ms`, `p95_ms`, `p99_ms`, `ttfb_p95_ms`, `no_data_pct`, `quality_mean`: a
  number, or `null` when the suite has none; the key is never left out.

The pages show "–" for a number sent as `null`.

`by_tier` may be left out to fit the size cap (`413`). When it is sent, it holds
`simple`, `medium` and `complex`, each with `answers`, `avg_ms` and `p95_ms` (a
number or `null`). Every other field of the table above is kept as sent.

**Mapping, Smoke and Soak** (left: `summary-<stamp>.json`, 17 fields):

| Suite field | Protocol field | Note |
|---|---|---|
| `test` | `test_type` | |
| `verdict` | `verdict` | `pass` or `fail`, unchanged |
| — | `verdict_reason` | Null |
| `startedAt`, `endedAt` | `started_at`, `ended_at` | |
| `targetUrl` | `target_url` | |
| `questions` | `headline.answers_measured` | |
| `endedAt` − `startedAt` | `headline.duration_s` | Run length |
| `p95Ms` | `headline.p95_ms`, `overall.p95_ms` | |
| `qualityAvg` | `headline.quality_mean`, `overall.quality_mean` | |
| — (runner) | `headline.answers_total`, `errors_total`, `error_rate_pct`, `ttfb_p95_ms`, `max_users` | As for Breakpoint |
| — | `headline.safe_load_users`, `breaking_level_users`, `breaking_reason`, `recommended_max_users`, `p95_at_safe_load_ms` | Null |
| `thresholds["<metric>: <expression>"].ok`, `.value` | `thresholds[]` `{scope: "run", metric, expression, measured, ok}` | The key is split at the first `": "`; `measured` is null when `value` is absent |
| `requests` | `overall.http_requests` | All HTTP calls, sign-in included |
| `httpFailedRate` | `overall.http_failed_rate` | |
| `p50Ms`, `p99Ms`, `maxMs` | `overall.p50_ms`, `p99_ms`, `max_ms` | |
| `noDataRate` × 100 | `overall.no_data_pct` | |
| `checksRate` | `overall.checks_rate` | |
| `followUps` | `counts.follow_ups` | |
| the whole file | `suite_summary` | Unchanged |

`levels` is `[]`; `auth`, `plan` and the rest of `counts` are filled from the
runner's own counters where the suite's file has nothing, and are null
otherwise.

The sample run's summary (two of the six `levels` entries and one of the
fifteen `plan.stages` entries shown, `suite_summary` left out):

```json
{
  "schema": 1,
  "test_type": "breakpoint",
  "verdict": "breakpoint_found",
  "verdict_reason": "Breaks at 50 VUs (latency).",
  "ended_by": "auto_stop",
  "exit_code": 99,
  "started_at": "2026-11-20T11:02:00.412Z",
  "ended_at": "2026-11-20T11:41:59.630Z",
  "target_url": "https://insightor.ingress.preprod.example.org/change/api/chat",
  "headline": {
    "safe_load_users": 40,
    "breaking_level_users": 50,
    "breaking_reason": "latency",
    "recommended_max_users": 32,
    "p95_at_safe_load_ms": 147628,
    "answers_measured": 913,
    "duration_s": 2399.2,
    "p95_ms": 136309,
    "answers_total": 1008,
    "errors_total": 8,
    "error_rate_pct": 0.79,
    "ttfb_p95_ms": 48606,
    "max_users": 50,
    "quality_mean": 98.9
  },
  "thresholds": [
    {"scope": "run", "metric": "llm_response_duration", "expression": "p(95)<180000", "measured": 136309, "ok": true},
    {"scope": "run", "metric": "http_req_failed", "expression": "rate<0.1", "measured": 0.0066, "ok": true}
  ],
  "levels": [
    {
      "level": 40, "answers": 240, "interrupted": 0,
      "p50_ms": 54188, "p90_ms": 131400, "p95_ms": 147628, "p99_ms": 165973, "avg_ms": 66210, "min_ms": 8104, "max_ms": 170217,
      "ttfb_p50_ms": 19386, "ttfb_p95_ms": 51618,
      "error_pct": 0, "no_data_pct": 2.9, "auth_error_pct": 0, "auth_contaminated": false,
      "quality_mean": 98.9, "follow_ups": 45, "per_minute": 32.0, "hold_start_s": 1530, "hold_end_s": 1980,
      "by_tier": {"simple": {"answers": 121, "avg_ms": 31870, "p95_ms": 49257}, "medium": {"answers": 83, "avg_ms": 61530, "p95_ms": 93348}, "complex": {"answers": 36, "avg_ms": 118900, "p95_ms": 166289}},
      "passed": true, "latency_breach": false, "error_breach": false, "has_data": true,
      "result": "pass", "hold_elapsed_pct": 100
    },
    {
      "level": 50, "answers": 144, "interrupted": 44,
      "p50_ms": 63105, "p90_ms": 171950, "p95_ms": 196426, "p99_ms": 224184, "avg_ms": 82310, "min_ms": 9412, "max_ms": 238757,
      "ttfb_p50_ms": 24176, "ttfb_p95_ms": 70248,
      "error_pct": 2.78, "no_data_pct": 3.6, "auth_error_pct": 0, "auth_contaminated": false,
      "quality_mean": 98.9, "follow_ups": 21, "per_minute": 19.2, "hold_start_s": 2010, "hold_end_s": 2460,
      "by_tier": {"simple": {"answers": 70, "avg_ms": 38200, "p95_ms": 65472}, "medium": {"answers": 52, "avg_ms": 79840, "p95_ms": 118109}, "complex": {"answers": 22, "avg_ms": 151700, "p95_ms": 224308}},
      "passed": false, "latency_breach": true, "error_breach": false, "has_data": true,
      "result": "break", "hold_elapsed_pct": 86.5
    }
  ],
  "overall": {"http_requests": null, "http_failed_rate": 0.0066, "p50_ms": null, "p95_ms": 136309, "p99_ms": null, "max_ms": null, "quality_mean": null, "no_data_pct": null, "checks_rate": null},
  "auth": {"refresh_ok": 163, "refresh_failed": 0, "refresh_transient": 0, "no_token": 0, "broker_pickups": 0, "first_refresh_failure_s": null, "first_auth_error_s": null, "refresh_token_rejected": false, "incident": null, "clean_until_level": null},
  "counts": {"iterations": 866, "follow_ups": 158, "interrupted": 44, "by_tier": {"simple": 457, "medium": 320, "complex": 136}},
  "plan": {"question_set": "full-mix", "baseline_users": 5, "max_users": 60, "step_users": 10, "hold_seconds": 450, "limit_ms": 180000, "max_error_rate_pct": 10, "follow_up_rate": 0.3, "abort_on_break": true, "abort_grace": "30s", "levels": [10, 20, 30, 40, 50, 60], "ramp_seconds": 30, "baseline_seconds": 60, "warmup_seconds": 30, "timeout_seconds": 540, "stages": [{"role": "baseline", "target_users": 5, "start_s": 0, "end_s": 60}]}
}
```

qym checks `schema`, `test_type`, `verdict` (one of the words of that test
type), `ended_by` and the types inside `headline`, `thresholds` and `levels`,
keeps keys it does not know, and refuses a body that contains a current token
value (section 6).

### 4.8 Dataset items and the question file

Questions come from the project's datasets in qym's Datasets tab. A question
file uploaded from the New run page is converted to the item shape below when
it is uploaded, and saved there as a normal dataset. No field mapping travels
with a run: the runner knows this one shape only.

The suite reads its questions from one file with three lists, `simple`,
`medium` and `complex`. The runner builds that file from the items of
route 3.11:

| Dataset item | Suite question | Rule |
|---|---|---|
| `item_id` | `id` | Unchanged |
| `input` | `question` | The string itself, or `input.question` when `input` is an object |
| `metadata.tier` | which list the question goes into | `simple`, `medium` or `complex`; qym resolves the stored kind as described below |
| `metadata.follow_up` | `followUpQuestions[0].question` | A string; absent or empty means no follow-up |
| `metadata.must_not_contain` | `mustNotContain` | A list of strings; absent means `[]`. Used by the quality score only |
| `metadata.follow_up_must_not_contain` | `followUpQuestions[0].mustNotContain` | Optional. Absent: the follow-up uses the item's own list |
| — | `expectedResponseContains`, `expectedResponsePattern` | Always `[]` and `null`; the question bank does not use them |

**Decision:** `metadata.follow_up_must_not_contain` is an addition to the
mapping of DESIGN.md. In the suite's question bank all 133 follow-ups have a
list of their own that differs from their question's list, and without the
extra field their quality scores would differ from the terminal tool's.

Rules:

- qym resolves each stored item's kind from `metadata.tier` first, then
  `metadata.complexity`. Each value is accepted only if, after trimming spaces
  and ignoring letter case, it is `simple`, `medium` or `complex`. A valid
  `tier` wins; if neither field is valid, the item has no kind. Dataset counts
  and start checks use this same rule.
- Route 3.11 always gives the runner the resolved kind as the lowercase word
  in `metadata.tier` (a stored `" Simple "` or a `complexity` of `Medium`
  arrives as `simple` and `medium`). It preserves every other field and never
  changes the stored item. No runner change or new image is needed for
  complexity-only datasets.
- All three lists are always written, empty or not: the suite refuses a file
  with a list missing.
- An item is **skipped** when its question text is empty, its `tier` is missing
  or not one of the three words (except in a dataset without any tier, see the
  decision below), or its `item_id` contains the text `followup`
  (the suite would count it as a follow-up). The runner writes one warning line
  with the number of skipped items and sends an event `items_skipped`.
- The runner compares its own count per tier with `config.dataset.tier_counts`.
  When a tier whose `mix` share is above 0 has no usable question, it does not
  start k6 and reports `failed` with "The dataset has no <tier> questions, but
  the mix asks for <n>%".
- Every question the suite asks then carries a dataset `item_id`, which comes
  back as `question_id` in the question records.
- Other `metadata` keys (for example `description` or `group`), `labels` and
  `expected_output` are ignored by the runner.

**Decision (pending Ali):** a dataset version in which **no** item has a
valid kind in either `metadata.tier` or `metadata.complexity` can still be used.
All its questions count as one kind and the mix is ignored. qym then stores
`dataset.single_kind: true`, `tier_counts` as
`{"simple": 0, "medium": <usable items>, "complex": 0}` and `mix` as
`{"simple": 0, "medium": 100, "complex": 0}`, whatever mix the page sent. The
runner writes every usable item into the `medium` list; the word is only the
suite's list name here, and the pages show no kind for such a run. The skip
rule for a missing tier does not apply, and a follow-up is asked only where an
item has `metadata.follow_up`. A version in which only some items lack a resolved
kind keeps the rules above: those items are skipped. Ali was asked on 2026-11-22
and has not objected; the rule is not confirmed, and the choice of the
`medium` list is this contract's.

An item with a follow-up, and the question it becomes:

```json
{"item_id":"simple_demographics_1","index":0,"input":"كم عدد الذكور والإناث في قاعدة البيانات؟","expected_output":null,"metadata":{"tier":"simple","follow_up":"ما هي النسبة المئوية للذكور؟","must_not_contain":["لا توجد بيانات","عذراً","لا أستطيع","غير متوفر"],"follow_up_must_not_contain":["لا توجد بيانات","عذراً"]},"labels":[]}
```

```json
{"id":"simple_demographics_1","question":"كم عدد الذكور والإناث في قاعدة البيانات؟","expectedResponsePattern":null,"expectedResponseContains":[],"mustNotContain":["لا توجد بيانات","عذراً","لا أستطيع","غير متوفر"],"followUpQuestions":[{"question":"ما هي النسبة المئوية للذكور؟","expectedResponsePattern":null,"expectedResponseContains":[],"mustNotContain":["لا توجد بيانات","عذراً"]}]}
```

---

## 5. Idempotency, limits, retries and timeouts

- Runner identity is `(project_id, key)`. Registration replaces `name`, `info`
  and the instance. Repeating it with the same instance is harmless.
- A claim is safe to repeat by the same instance. Nothing else can claim.
- Question identity is `(run_id, seq)` and log line identity is `(run_id, seq)`.
  A repeated record is counted in `duplicates`, left as it is, and is never an
  error. Sending a whole batch again after a lost answer is therefore safe.
- Progress carries a rising `seq`; a report that is not newer than the stored
  one is ignored with `accepted: false`. The final status is set once.
- Summary and report are replaced by a repeated PUT.
- Event identity is `(runner, run_id, at, code)`; a repeat is ignored.
- A token rotation is a compare-and-set on the version; its repeat is answered
  like the first time.
- Heartbeats are not idempotent and need not be: each one only moves a time.

Limits:

| What | Limit | Above it |
|---|---|---|
| Progress body | 64 KiB | `413` |
| Questions per request | 200 records, 1 MiB | `422 too_many_records`, `413` |
| Log lines per request | 500 lines, 256 KiB | `422 too_many_lines`, `413` |
| Events per request | 100 events, 256 KiB | `422 too_many_events`, `413` |
| Summary | 256 KiB | `413` |
| Report | `QYM_PERFORMANCE_REPORT_MAX_BYTES`, 5 MiB | `413` |
| Questions per run | 50,000 | Counted in `dropped`, not stored |
| Log lines per run | 50,000 | Counted in `dropped`, not stored |
| Question text | 2,000 characters | Cut by qym |
| Answer text | 1,000 characters | Cut by qym, `answer_truncated` set |
| Log message, `error` | 2,000 characters | Cut by qym |
| `info` | 8 KiB | `422` |

**Decision:** the progress body has its own small limit (the outline named
none), because qym rewrites it into the run row every 5 seconds.

Both `Content-Length` and streamed bytes are checked before a body is parsed.
There is no rate limit on the runner routes in v1.0.

**Timeouts the runner uses for its calls to qym:** 5 seconds to connect; 10
seconds in all for heartbeat, control, claim and progress; 30 seconds for
questions, log, events, summary, dataset items and the token route; 60 seconds
for the report.

**Retries.** Retry only after a shared failure of section 3 (`401`, `403`,
`503`, `5xx`, a timeout, no connection) or a `409` commit conflict
(`Performance data conflicts with existing data`). Never repeat any other
`4xx` body unchanged.

| Call | Retry |
|---|---|
| Heartbeat, control read, progress (not final) | None. The next one in 10, 2 or 5 seconds replaces it |
| Claim | On the next control read, while the run is still `queued` |
| Questions, log, events | Keep the batch; wait 1, 2, 4, 8, then 15 seconds between tries, with a random part of up to a quarter |
| Final progress, summary, report, token rotation | The same waits, until answered or until the late window is over |
| Dataset items | The same waits; the run is lost after 120 seconds anyway |
| Registration | Every 10 seconds until it succeeds |

**What to buffer, what to drop:**

| Data | Buffer | When the buffer is full |
|---|---|---|
| Progress, heartbeat | Nothing: only the newest matters | — |
| Questions | All of them, in memory and as a file in the run's work folder | Never dropped before the per-run limit of 50,000 |
| Log lines | Up to 50,000 | Drop the oldest `info` lines first; count them in `progress.dropped.log_lines` and write one line saying how many |
| Events | Up to 500 | Drop the oldest `info` events first |
| Summary, report | The files in the work folder | Kept until sent or until the late window is over |
| Tokens | In memory only | Never written anywhere |

**When qym is unreachable:**

1. Keep k6 running and keep buffering. Keep trying at the normal pace.
2. After **120 seconds** without reaching qym: stop k6 (interrupt, kill after
   20 seconds). qym will have ended the run as `interrupted` by the same clock.
3. Keep the work folder. Keep trying to send the questions, the log, the
   summary and the report for **10 minutes** after k6 exited, or until qym
   answers `409 run_closed`.
4. Then give up, write where the files are in the runner's own log, and go back
   to idle. Never start k6 for that run again.

The same steps apply when the runner process is told to shut down: stop k6,
send what was measured, report `interrupted` if qym can be reached, exit.

---

## 6. Redaction

Token values leave qym only in the control document, and only for the chosen
runner key. Everywhere else a token is a name, a version and its last 4
characters; a token shorter than **12** characters shows none.

The runner:

- keeps tokens and the control document in memory only; never in a file, a
  log line, an event, a record or the report;
- gives k6 a minimal environment and never its own qym key;
- before sending any log line, event message or `error` text, replaces every
  token value it holds, every `Bearer <text>`, every value of the refresh
  cookie and every JWT-shaped string (`eyJ…` with two dots) with `[REDACTED]`;
- sends `answer: null` and leaves the raw log out of the report when
  `options.store_answers` is false;
- removes the tokens it obtained **during the run** (access tokens the target
  issued when the runner refreshed the sign-in, a rotated refresh token) from
  everything it sends, the summary and the report file included: qym never
  stored them, so it can only find them by their shape (masked in the summary
  and in log lines, refused in the report).

qym, on its side and whatever the runner did:

- masks, before storing a **log line**, an **event message**, a run's `error`,
  the runner's **name**, a question's `question_id` and the **summary**:
  the target's current token values in every spelling qym can predict (as
  they are; JSON-escaped, also with `\/`; HTML-escaped; URL-encoded with or
  without `/` kept and with `+` for a space, hex in either case; inside
  standard or URL-safe base64 text), `Bearer …`, `Authorization: …` (also
  with the value in `[…]`, `<…>`, `(…)` or quotes), `Cookie:` / `Cookies:` /
  `Set-Cookie:` values, the value after the refresh cookie name or
  `refresh_token` / `access_token` followed by `=` or `:`, and JWT-shaped
  strings; the string keys and values of a progress object, of `info`, of
  event `details` and of the summary are masked the same way; question and
  answer text only lose the token values (they are measured content);
- **refuses** a **report** that contains a current token value in one of
  those spellings, or a JWT-shaped string (`eyJ…` with two dots), with
  `422 contains_token`: masking could break the file;
- cannot find a token that is split across two lines, records or requests,
  nor an opaque token it never saw: the runner's own masking (above) is the
  only protection there;
- drops, in `info` and in event `details`, every key that contains `api_key`,
  `apikey`, `password`, `secret`, `token`, `credential`, `authorization` or
  `cookie` (case-insensitive), at any depth. The fixed fields of this guide
  whose names contain `token` (`token_versions`, `waiting_for_token`,
  `token_needed`) hold names and numbers, never values, and are kept;
- never writes request bodies or credentials to its own logs.

---

## 7. Errors

Request errors include `error: {code, message, details, request_id}` and keep
`{"detail":"message"}` as an alias. Validation errors use
`{"detail":[{"loc":[...],"msg":"...","type":"..."}]}`. A successful questions
or log response can still report single records as rejected.

| HTTP | `error.code` | Exact detail | Meaning / action |
|---|---|---|---|
| `401` | — | `Missing Bearer API key` | Send the Authorization header |
| `401` | — | `Invalid API key` | Unknown or revoked key; `X-Qym-Key-State: invalid` |
| `403` | `forbidden` | `API key belongs to another project` | Use the project id of the key |
| `403` | `user_disabled` | `User disabled` | The key's owner is inactive |
| `403` | `forbidden` | `API key owner is no longer a member of this project` | Restore the owner's access or use another key |
| `403` | `tokens_not_disclosed` | `this API key is not the runner key` | Token route only; choose this key on the Runner page |
| `404` | — | `Project not found` | Wrong project id |
| `404` | `performance_is_switched_off` | `Performance is switched off` | The area is switched off in this deployment (`QYM_PERFORMANCE_ENABLED`) |
| `404` | `runner_not_found` | `performance runner not found` | Register first |
| `404` | `run_not_found` | `performance run not found` | Unknown run, or a run of another runner |
| `409` | — | `Project is archived; its API keys stop working until an admin unarchives it` | Nothing runs in an archived project |
| `409` | `runner_limit_reached` | `this project already has a runner` | One runner key per project |
| `409` | `instance_mismatch` | `another runner process holds this runner or run` | Stop k6; a replaced process exits |
| `409` | `run_not_queued` | `run is not waiting to be claimed` | Forget the run |
| `409` | `run_not_claimed` | `run has not been claimed` | Claim first |
| `409` | `stop_requested` | `stop requested` | Stop k6 |
| `409` | `run_finished` | `run already finished` | Stop k6; no more progress; `error.details.status` has the final status |
| `409` | `run_closed` | `run no longer accepts results` | The late window is over; give up |
| `409` | `invalid_transition` | `status cannot follow the current status` | A bug in the runner |
| `409` | `token_version_conflict` | `a newer token is saved` | Read the control document |
| `409` | — | `Performance data conflicts with existing data` | A commit conflict; retry once |
| `413` | `payload_too_large` | `The event batch exceeds ...; send smaller batches.` | Split or shorten the body |
| `415` | `unsupported_content_type` | `unsupported content type` | Report route: send `text/html` |
| `422` | `counters_must_not_decrease` | `counters must not decrease` | Progress counters only rise |
| `422` | `too_many_records`, `too_many_lines`, `too_many_events` | `too many records`, `too many lines`, `too many events` | Split the batch |
| `422` | `report_not_utf8` | `report is not UTF-8` | Send UTF-8 |
| `422` | `contains_token` | `the body contains a sign-in token` | Report route only; remove the token, never retry unchanged |
| `422` | — | Validation detail array | Missing header or field, wrong type, unknown field, bad key, JSON nested deeper than 32 levels (`json_too_deep`), a time outside the years 1 to 9999 in UTC |
| `500` | `secret_cannot_be_decrypted` | `secret cannot be decrypted` | Control route: a person must save the token again |
| `503` | — | `Platform is in maintenance mode; retry later` | Not reached; `Retry-After: 60` |
| `200`, rejected record | — | `<field.path>: <validation message>` | Fix this record; the others were stored |
| `200`, rejected record | — | `record must be a JSON object` | An entry is not an object |

Unhandled failures may return `500`: treat them as "not reached".

---

## 8. One whole run, call by call

The sample run. Times are UTC; the run starts at 11:02:00 and k6 ends 2,399
seconds later. Paths are relative to the router prefix; every call carries the
key and the instance header.

| # | Time | Call | Body (short) | Answer |
|---|---|---|---|---|
| 1 | 10:58:12 | `PUT /runners/perf-runner-1` | `{"name":"perf-runner-1","info":{…}}` | `200`, `tokens_disclosed: true`, `interrupted_run_id: null` |
| 2 | 10:58:12 | `POST /runners/perf-runner-1/heartbeat` | `{"at":…,"state":"idle","run_id":null}` | `204`. Repeated every 10 s until the process ends |
| 3 | 10:58:12 | `GET /runners/perf-runner-1/control` | — | `200`, `state: "idle"`, `ETag: W/"a1…"`. Repeated every 10 s: `304` |
| 4 | 11:01:42 | `GET …/control` | — | `200`, `state: "queued"`, the run with `config` and `tokens` (the person pressed Start at 11:01:39) |
| 5 | 11:01:42 | `POST …/runs/7d3b…/claim` | `{}` | `200`, `status: "starting"`. Control is now read every 2 s |
| 6 | 11:01:43 | `POST …/runs/7d3b…/progress` | `seq 1`, `starting`, `phase: "preflight"`, `step: "dataset"` | `200`, `stop_requested: false` |
| 7 | 11:01:43 | `GET …/runs/7d3b…/dataset-items?limit=500` | — | `200`, 139 items, `next_after: null`, `total: 139`. The question file is written: 30, 38 and 71 questions |
| 8 | 11:01:45 | (not qym) one refresh call to the target with the refresh token | — | HTTP 200: the sign-in works |
| 9 | 11:01:48 | `POST …/progress` | `seq 2`, `starting`, `step: "plan_check"` | `200`. `k6 inspect` returns 15 stages, 3,000 s in all: equal to `config.plan` |
| 10 | 11:01:58 | `POST …/progress` | `seq 3`, `starting`, `step: "starting_k6"` | `200` |
| 11 | 11:02:00 | `POST …/progress` | `seq 4`, `running`, `phase: "baseline"`, `elapsed_s: 0.4`, `users: 1` | `200`, `status: "running"`. From here every 5 s |
| 12 | 11:02:00 | `POST …/events` | `run_started`, `stage_started` (baseline) | `200`, `accepted: 2` |
| 13 | 11:02:05 | `POST …/log` | the suite's start lines, `seq 1`–`16` | `200`, `accepted: 16` |
| 14 | 11:02:31 | `POST …/questions` | the first 3 finished answers, `seq 1`–`3` | `200`, `accepted: 3`. Then every 5 s when something waits |
| 15 | 11:11:00 | `POST …/events` | `level_passed` (level 10: p95 67.8 s, errors 0.9%), `stage_started` (ramp to 20) | `200` |
| 16 | 11:23:30 | `POST …/progress` | `seq 262`, `running`: the object of section 4.3 | `200` |
| 17 | 11:23:32 | `GET …/control` | `If-None-Match: W/"c7…"` | `304`. About 1,200 such reads in this run |
| 18 | 11:41:53 | `POST …/events` | `auto_stop` (level 50 reached the limit at 2,393 s) | `200` |
| 19 | 11:41:59 | k6 exits with code 99; the result file is there | — | — |
| 20 | 11:41:59 | `POST …/progress` | `seq 484`, `running`, `phase: "finishing"`, `users: 0` | `200` |
| 21 | 11:42:00 | `POST …/questions` | the last 12 records, the last `seq` is 1,052 (1,008 finished and 44 interrupted) | `200`, `accepted: 12` |
| 22 | 11:42:00 | `POST …/log` | the last lines and the result table | `200` |
| 23 | 11:42:00 | `PUT …/runs/7d3b…/summary` | the object of section 4.7 | `200`, `verdict: "breakpoint_found"` |
| 24 | 11:42:01 | `PUT …/runs/7d3b…/report` | the HTML file, about 1.5 MB with the raw log | `204` |
| 25 | 11:42:02 | `POST …/events` | `k6_exited` (code 99, 2,399 s) | `200` |
| 26 | 11:42:02 | `POST …/progress` | `seq 485`, `finished`, `exit_code: 99`, the last counters | `200`, `status: "finished"` |
| 27 | 11:42:04 | `GET …/control` | — | `200`, `state: "idle"`, `run: null`, `last_run.status: "finished"`, `accepts_results_until: 11:52:02`. Back to every 10 s |

In the whole run: about 240 heartbeats, 1,200 control reads, 485 progress
reports, 1,052 question records and about 1,500 log lines.

Two variants of the same run:

**A person stops it at 11:26:40.** The page sets the status to `stopping`. At
most 2 seconds later a control read returns `200` with `state: "stopping"`. The
runner interrupts k6, which exits with code 105 in well under a second and
writes its result file. Then calls 21–25 as above, and the last progress report
carries `stopped` and `exit_code: 105`. The summary's verdict is what the suite
measured up to that moment: `not_reached` with a safe load of 30, because the
hold at 30 users was almost over and the suite judges every level that has
data. `ended_by` is `stop`.

**The sign-in is revoked at 11:23:02.** The runner's refresh call gets HTTP
401. Its next progress report says `auth.state: "rejected"` and
`waiting_for_token: "refresh_token"` with version 3. A control read returns
`token_needed: "refresh_token"`. At 11:24:30 a person pastes a new token; the
next progress response shows `token_versions.refresh_token: 4`; the runner
reads the control document (`200`, the "token supplied" example), checks the
token with one refresh call, hands it to the users, and reports
`waiting_for_token: null`, `auth.state: "recovered"`. The level in which the
sign-in errors happened ends with `result: "auth"` and is not counted.

A minimal runner in Python (standard library only) that claims one queued run
and walks it to `finished` with made-up numbers. Start a run in the New run
page first.

```python
BASE_URL = "https://qym.example.test"  # append /ingestion if needed
API_KEY = "replace-with-project-api-key"
PROJECT_ID = "replace-with-project-id"

import json
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

INSTANCE = str(uuid.uuid4())
RUNNER = f"/v1/projects/{PROJECT_ID}/performance/runners/example-runner"


def now():
    return datetime.now(timezone.utc).isoformat()


def call(method, path, body=None, content_type="application/json"):
    data = body if isinstance(body, bytes) else None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        BASE_URL.rstrip("/") + path, data=data, method=method,
        headers={"Authorization": f"Bearer {API_KEY}", "X-Qym-Runner-Instance": INSTANCE,
                 "Content-Type": content_type},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


call("PUT", RUNNER, {"name": "Example runner", "info": {"runner_version": "example"}})
while True:
    call("POST", RUNNER + "/heartbeat", {"at": now(), "state": "idle", "run_id": None})
    control = call("GET", RUNNER + "/control")
    if control["state"] == "queued":
        break
    time.sleep(10)

run_id = control["run"]["id"]
RUN = f"{RUNNER}/runs/{run_id}"
call("POST", RUN + "/claim", {})
items, after = [], None
while True:
    page = call("GET", RUN + "/dataset-items?limit=500" + (f"&after={after}" if after else ""))
    items += page["items"]
    after = page["next_after"]
    if after is None:
        break
kinds = {"auth": 0, "rate_limit": 0, "server": 0, "network": 0, "run_failed": 0, "other": 0}
progress = {"phase": "steady", "elapsed_s": 5.0, "planned_s": control["run"]["config"]["plan"]["total_seconds"],
            "users": 1, "answers": {"sent": 1, "finished": 1, "ok": 1, "errors": 0, "interrupted": 0,
                                    "in_flight": 0, "oldest_in_flight_s": None, "follow_ups": 0, "warmup": 0},
            "errors_by_kind": kinds, "p95_ms": 4200, "levels": [],
            "auth": {"state": "ok", "token_versions": {}}, "waiting_for_token": None}
call("POST", RUN + "/progress", {"seq": 1, "status": "running", "at": now(), "progress": progress})
first = items[0]
question = first["input"] if isinstance(first["input"], str) else first["input"]["question"]
report = call("POST", RUN + "/questions", {"records": [{
    "seq": 1, "asked_at": now(), "elapsed_s": 0.8, "stage": "steady", "level": None, "user": 1,
    "tier": first["metadata"].get("tier", "medium"), "question_id": first["item_id"], "question": question,
    "status": "ok", "http_status": 200, "duration_ms": 4200, "ttfb_ms": 1300, "quality": 100}]})
if report["rejected"]:
    raise RuntimeError(report["results"])
call("POST", RUN + "/log", {"lines": [{"seq": 1, "at": now(), "level": "info", "message": "runner: example run"}]})
test_type = control["run"]["config"]["test_type"]
call("PUT", RUN + "/summary", {
    "schema": 1, "test_type": test_type, "verdict_reason": None,
    "verdict": "invalid_no_data" if test_type == "breakpoint" else "pass",
    "ended_by": "plan", "exit_code": 0, "started_at": now(), "ended_at": now(),
    "target_url": control["run"]["config"]["target"]["base_url"],
    "headline": {"answers_measured": 1, "duration_s": 5.0, "p95_ms": 4200, "answers_total": 1,
                 "errors_total": 0, "error_rate_pct": 0.0, "max_users": 1, "quality_mean": 100},
    "thresholds": [], "levels": []})
call("PUT", RUN + "/report", b"<!doctype html><title>Example report</title><p>Example.</p>", "text/html; charset=utf-8")
final = call("POST", RUN + "/progress", {"seq": 2, "status": "finished", "at": now(), "progress": progress, "exit_code": 0})
print(final["status"])
```

The numbers are invented, so a Breakpoint run gets the verdict
`invalid_no_data` and a Smoke or Soak run `pass`.

---

## 9. Quick reference

Prepend the deployed ingestion prefix when required. Every route needs the
`Authorization` and `X-Qym-Runner-Instance` headers.

| # | Method | Path | Purpose | Success code |
|---|---|---|---|---|
| 1 | `PUT` | `/v1/projects/{project_id}/performance/runners/{key}` | Register this process | `201` / `200` |
| 2 | `POST` | `/v1/projects/{project_id}/performance/runners/{key}/heartbeat` | Sign of life | `204` |
| 3 | `GET` | `/v1/projects/{project_id}/performance/runners/{key}/control` | Read the control document | `200` / `304` |
| 4 | `POST` | `/v1/projects/{project_id}/performance/runners/{key}/runs/{run_id}/claim` | Take a queued run, once | `200` |
| 5 | `POST` | `/v1/projects/{project_id}/performance/runners/{key}/runs/{run_id}/progress` | Report status and progress | `200` |
| 6 | `POST` | `/v1/projects/{project_id}/performance/runners/{key}/runs/{run_id}/questions` | Send finished questions | `200` |
| 7 | `POST` | `/v1/projects/{project_id}/performance/runners/{key}/runs/{run_id}/log` | Send log lines | `200` |
| 8 | `POST` | `/v1/projects/{project_id}/performance/runners/{key}/events` | Report runner events | `200` |
| 9 | `PUT` | `/v1/projects/{project_id}/performance/runners/{key}/runs/{run_id}/summary` | Store the result | `200` |
| 10 | `PUT` | `/v1/projects/{project_id}/performance/runners/{key}/runs/{run_id}/report` | Store the report file (raw HTML) | `204` |
| 11 | `GET` | `/v1/projects/{project_id}/performance/runners/{key}/runs/{run_id}/dataset-items` | Read the pinned questions | `200` |
| 12 | `PUT` | `/v1/projects/{project_id}/performance/runners/{key}/runs/{run_id}/tokens/{name}` | Report a rotated refresh token | `200` |

Settings named in this guide: `QYM_PERFORMANCE_STALE_AFTER_SECONDS` (120),
`QYM_PERFORMANCE_RUNNER_FRESH_SECONDS` (30),
`QYM_PERFORMANCE_QUEUE_TIMEOUT_SECONDS` (600),
`QYM_PERFORMANCE_LATE_WINDOW_SECONDS` (600),
`QYM_PERFORMANCE_REPORT_MAX_BYTES` (5242880),
`QYM_PERFORMANCE_MAX_USERS` (200),
`QYM_PERFORMANCE_MAX_DURATION_SECONDS` (28800).

Changelog: v1.0 (2026-11): first version (draft).


## 10. Estishraf Platform extension

The twelve routes above retain their chat shapes, defaults, limits and errors.
Missing target kind and missing `info.supported_target_kinds` mean chat.
A platform-capable process registers `supported_target_kinds: ["chat", "estishraf_platform"]`.
Only that process may receive or claim an Estishraf Platform run; incompatible
registration fails queued platform work with `runner_kind_unsupported`.

Two additive routes share API-key authentication, claiming-instance ownership,
maintenance protection and the existing late-results window:

| Method | Path | Result |
|---|---|---|
| PUT | `/v1/projects/{project_id}/performance/runners/{key}/runs/{run_id}/discovery` | Atomic sanitized discovery; identical retry accepted, different retry `discovery_conflict` |
| POST | `/v1/projects/{project_id}/performance/runners/{key}/runs/{run_id}/steps` | Per-record created/duplicate/rejected/dropped acknowledgement |

Both are also mounted below the configured ingestion prefix. Chat refuses these
operations with `wrong_target_kind`; platform refuses question ingest and dataset
items. Platform progress and summaries use closed workload-specific objects.
`steps_limit_reached` records the detail cap once, with a dropped-sequence high-water
mark; aggregates remain separate from capped details. `records_dropped` records
invalid steps. `discovery_completed` and `discovery_partial` carry counts only.

Platform targets store an immutable kind, an origin with no path prefix, and the
session/discovery/chart route templates in settings. Smoke and Breakpoint start
without a dataset. Config is frozen as schema, test_type, target, tokens, plan and
note; discovery records the separately resolved plan. Smoke resolves one user and
one iteration per runnable dashboard, with an automatic budget of
max(600, ceil(N * (limit_ms/1000 + F*filter_reference_ms/1000 + pause_seconds)) + 60).
Breakpoint includes the maximum level, a 60-second baseline, each ramp and hold,
and two cooldown ramps. Platform Breakpoint requires `ramp_seconds` from 1 to
3600 (default 30): “Give at least 1 second to reach each level”. A zero-second
ramp is refused before queueing. Chat plans are unchanged. A resolved plan never
exceeds the frozen duration cap.

One encrypted `session_cookie` replaces the chat token pair. Save and rotation
accept at most 16384 UTF-8 bytes of the whole Cookie header. Hints contain only the
unique cookie count and saved UTC timestamp: exactly “1 cookie, saved <UTC
timestamp>” for one, and “N cookies, saved <UTC timestamp>” for more than one.
Versions never reset after deletion;
a credential generation prevents late rotations restoring an edited/deleted jar.
Rotation is compare-and-set, including idempotent repeats. Historical encrypted
jars carry encrypted replacement timestamps and remain only while an earlier
run of the target is not final or is within `performance_late_window_seconds`
after its end; stored-data retention periods do not extend this window, and
without such a run a replaced jar is dropped immediately. Retention prunes
expired history; the 256-version cap evicts the oldest value and never refuses
a new sign-in save. Encryption-key rotation covers history.
The header, each pair and each value are masked in plain, JSON, URL, HTML and
base64 spellings. Percent, JSON and HTML escapes are normalized before matching,
including partial and mixed encodings, for at most eight shrinking passes;
unresolved deeper encoding is masked or refused. The normalization work is at
most eight scans of the input, including megabyte reports. Reports containing a known
value are refused with `contains_token`. Page responses never disclose the jar.

Platform discovery is capped at 16 MiB, 10000 dashboards and 100000 chart
associations. Step batches have at most 200 records / 1 MiB, each record at most
8192 bytes; retained detail defaults to 50000 rows. Progress is capped at 256 KiB;
summary at 16 MiB. The six deployment caps can only lower these ceilings (see
Operations). Capable platform control advertises these in addition to unchanged
shared limits; chat and idle control keep the original limit object.

Pages opt in with `X-Qym-Performance-Platform: 1`. Without it, mixed collection
reads show chat only and direct platform run/download reads return 404. Reads are
private/no-store and vary by that header. Platform run polling omits dashboard
arrays: discovery, steps and dashboard results have separate paged reads; steps
also have a formula-protected UTF-8 BOM CSV download. Retention removes step detail
with questions/logs, keeping discovery, summary and historical counts until run
retention. Capacity cards and platform trends are separate per target/kind.

Platform free text is masked before storage: target display names, run notes,
stop reasons, runner names/info, event messages/codes/details, progress messages
and error codes, run errors, log lines, discovery/step/result titles and IDs,
summary identity labels, source/mapped verdict reasons and summary target_url.
Event codes retain the documented lowercase/digit/underscore pattern and
1–60-character bound; a known credential used as a valid code becomes `redacted`
before deduplication. Unknown validation keys are replaced by a count and the
fixed message “Unknown fields are not allowed”; schema-owned field locations stay.
Summary target_url must equal the frozen origin before it is masked for storage.
Positive safe load must refer to a tested, passing, sign-in-clean planned level;
its recommendation and breakpoint fields must agree with the level flags/verdict.
