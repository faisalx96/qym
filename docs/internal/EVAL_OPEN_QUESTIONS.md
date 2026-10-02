# Evaluation Service integration: open questions and decisions taken

This file tracks decisions about the Evaluation Service integration (branch
`experiments-platform`, issues in `EVAL_SERVICE_INTEGRATION_ISSUES.xlsx`) that were made
without product review, so implementation could keep going. Each entry lists the
question, the decision now in the code, the reasoning, and how to reverse it.

**Status key:**
- **Implemented:** the decision is in the code.
- **In progress:** a fix branch is being built.
- **Kept:** the current behaviour stays as it is; it is recorded here for review.
- **Needs external input:** only someone outside the team (for example the Evaluation
  Service team) can answer it.

Please review each entry and either confirm it or reply with the change you want.

---

## A. Critical (security, data loss or cost)

### A1. Remote jobs qym can no longer stop (Implemented)

**Question.** A job marked TIMED_OUT, or CANCELLED after the 2h15m cancel give-up, can
keep running on the Evaluation Service. qym then has no way to cancel it:
- the queue cancel returns `already_terminal`;
- the orphan cancel refuses it, because its remote id matches a local job;
- it no longer counts toward the environment's in-flight cap.

**Decision.**
- Before marking a job TIMED_OUT, the dispatcher makes one best-effort remote cancel.
- Remote jobs whose local job has finished show as "stale" in the remote queue, and
  managers can cancel them like orphans (audit-logged).
- Stale remote jobs count toward the in-flight cap, taken from the snapshot.

**Why.** Remote jobs that can't be stopped waste service capacity. Ignoring them in the
cap could overload a shared environment.

**Reverse.** Drop the cap accounting if the Evaluation Service enforces its own
concurrency limits.

**Notes on the implementation.**
- Stale counts come from the remote snapshot, so they can lag by up to 30s. A job that
  just finished locally may briefly count toward the cap.
- If the cancel at timeout gets a 409, the job becomes TIMED_OUT with the note
  "already finished".
- Plan §13, §13.1 and §14.1 still describe the old orphan-only cancel and the old cap.
  The runbook is current.

### A2. Encryption key rotation (Implemented)

**Question.** There is a single Fernet key, `QYM_LLM_CONFIG_ENCRYPTION_KEY`. Rotating
it breaks every stored API key. Launch tokens are also derived from that key, so a
rotation between launch and submit turns those runs local.

**Decision.**
- Add `QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS` (MultiFernet): new values are encrypted
  with the current key, and any listed key can decrypt.
- At dispatch, launch tokens also try the previous keys against the stored hash.
- Add a re-encryption tool.
- The rotation procedure is documented in `OPERATIONS.md`.

**Why.** Rotating keys is a basic operational need. Before this, rotating meant losing
every stored key.

**Question for review.** Should rotation also be recorded in the audit log, and is there
a policy on how often to rotate?

### A3. HTTPS for models used in experiments (Implemented; closes security open item O1)

**Question.** Environment URLs must be HTTPS, but project LLM connections and temporary
models accept public `http://`. When a connection's key is sent to an experiment
environment, the model URL it points at could be plain HTTP.

**Decision.**
- Temporary models, and connections bound to experiment slots, must be HTTPS.
- Turning on "Available for experiments" for an `http://` connection is refused.
- `QYM_ALLOW_PRIVATE_LLM_BASE_URLS` keeps local development working.
- Analyzer connections are unaffected.

**Why.** Experiments send keys to a third system, so the stricter rule should apply
there.

**Reverse.** Turn the error into a warning in the model picker.

**Effects to review.**
- Connections already marked "Available for experiments" that use `http://` keep the
  flag. They show as disabled in the picker and are refused at launch and at dispatch.
  Editing one with the box still ticked returns 400.
- Jobs already queued with an `http://` model become BLOCKED (`https_required`) at
  dispatch.
- A temporary model on a model-only slot, which never sends its URL, is still refused
  at launch if its URL is `http://`.

### A4. API validation errors echoed secrets (Implemented, #42)

A FastAPI 422 response used to include the request body, including API keys and
launch tokens. An app-wide handler now masks them (`validation_errors.py`).

**Question for review.** Should the same handler apply to every non-eval endpoint too?
It already applies app-wide, so confirm that this is intended.

### A7. `qym_api_key` on job creation (Implemented)

**Change requested.** `POST /evals` must carry a `qym_api_key` that points to the user
submitting the job, so the uploaded run is authenticated as that user in the right
project. The API guide is updated in §3.1, a new §4.0 and §7.

**Decisions.**
- **Owner.** The key belongs to the experiment creator, the same user sent as
  `user_id`. Retries submitted by a manager still use the creator's key.
- **Minting.** One dedicated platform API key is minted per experiment at launch (named
  "Evaluation Service · …", minimal ingest scopes). It is stored encrypted (migration
  0065) and added to the submitted body in memory only.
- **Revocation.** The key is revoked automatically once every job has reached a
  terminal status. It stays valid while a job is BLOCKED, because a blocked job can be
  retried. A retry after revocation mints a new key.
- **Unavailable key.** If the key or the creator's membership is gone, the job is
  BLOCKED instead of submitted.
- **Creator left the project.** A retry is refused (409) with a hint to clone the
  experiment and launch it as yourself.
- **Experiments launched before 0065.** They have no key, so their queued jobs are
  BLOCKED ("key unavailable") until retried, which mints one.

**Questions for review.**
- If a manager retries someone else's experiment, should the key (and run ownership)
  move to the manager?
- Should these keys be hidden from the user's API-key list rather than just clearly
  named?
- Will the Evaluation Service echo `qym_api_key` in `EvalJobRead`? qym redacts it
  anyway.

### A5. Redaction limits (Kept)

Redaction works by key name and on JSON inside strings. A secret sitting in free text
inside a service result (for example "Bearer …" in a notes field) is not scrubbed.
Scrubbing every string by pattern could corrupt real results.

**Question for the Evaluation Service team.** Can they guarantee that keys never appear
in free-text fields? This is related to D1.

### A6. The Evaluation Service echoes keys (D1) (Needs external input, issue #1)

The platform redacts everywhere, but the service should stop echoing
`LLM_OVERRIDES.endpoints.*.api_key` in `EvalJobRead.env_overrides`. The other API gaps
D2, D3, D5–D7 and D9 are also still open with the service team.

---

## B. Behaviour that differs from the plan (Kept; confirm or ask for a change)

### B1. Queue order ignores priority

The queue page shows the dispatcher's real claim order: `next_attempt_at`, then
`created_at`, then combo, then id. The plan says "priority, then created_at".

**Why kept.** Priority is enforced by the Evaluation Service (HIGH preemption), and the
page should show what the dispatcher actually does. A test keeps the two orders in sync.

**Alternative.** Make the dispatcher claim HIGH jobs first.

### B2. Temporary keys are cleared when jobs are BLOCKED, not only when they reach a terminal status

A BLOCKED job only moves forward through a retry, and a retry asks for the key again.
So clearing keys early just shortens how long they are stored.

**Reverse.** Remove `BLOCKED` from `SETTLED_JOB_STATUSES`.

### B3. Schemas without `additionalProperties` are validated as closed

A key the schema doesn't declare is a `not_in_environment` error, and saved preset
validation follows the same rule. JSON Schema's default is open.

**Why.** A key the service would silently ignore means a setting the user thinks was
applied but wasn't.

**Risk.** A real service schema that relies on silent pass-through keys will reject
them. It should declare `additionalProperties: true`.

### B4. Best-run eligibility includes SUBMITTED and APPROVED runs

The plan says COMPLETED only. Runs in review or approved can also rank; REJECTED runs
cannot, but they still get `eval_run_scores` rows. A job that ended FAILED or TIMED_OUT
still counts if its run completed and was scored.

**Question.** Should REJECTED runs get no score rows at all? Should failed jobs be
excluded?

### B5. Saved presets cannot be deleted

Presets are append-only by design (versions are immutable), and there is no delete
route.

**Question.** Is a soft delete (archive) needed for saved presets?

### B6. "Cancel all queued in experiment" also cancels BLOCKED jobs

Blocked jobs never reached the service either, and the confirmation dialog lists them.

### B7. Official runs are owned by the experiment creator

`owner_user_id` is the creator; `created_by_user_id` is the environment's ingest
principal. Views filtered by owner (for example product evals) list official runs under
the creator.

### B8. TIMED_OUT only applies to RUNNING jobs

A SUBMITTED job (remote PENDING), or one on an unreachable or paused service, never
times out. The plan says any job with no change for 2h15m.

**Question.** Should a long PENDING state also time out? If so, what threshold, given
that HIGH preemption can make queues long?

### B9. A paused environment resumes by itself

After a 401 the environment is paused, and it is probed every 5 minutes; it resumes by
itself once the probe succeeds. The plan only says "pause".

### B10. The "runs arriving in project X" health error doesn't pause dispatch

It sets `health_error` only. It clears on the next successful Test or schema refresh.

### B11. "Save to project models" is manager-only

The plan allows anyone who can manage connections. The code requires a project manager,
because it creates a shared, key-bearing connection.

### B12. Remote snapshot refresh

The snapshot refreshes on page view when it is older than 30s, instead of "viewed in
the last 5 minutes" (there is no `last_viewed_at` column).

### B13. Other differences, listed for completeness

- **Migrations:** the plan names `0058_eval_service_integration`; the code uses
  0060–0064.
- **Job statuses:** SUBMITTING and CANCELLING are stored statuses.
- **Default priority:** when none is requested, the lowest `default_priority` among the
  selected environments.
- **Origin facet:** it is not on Compare (Compare shows the badge only).
- **Retry:** only the newest attempt can be retried, and a BLOCKED job is cancelled
  first.
- **No save-preset route:** there is no `POST …/jobs/{jid}/save-preset`. The UI uses the
  presets API, and promote uses `GET …/promote-prefill`.
- **Poll schedule:** 10s, then 30s, then 60s after 30 minutes.
- **Experiment status rule:** QUEUED plus BLOCKED jobs give RUNNING.
- **Remote-cancel give-up:** after 2h15m.

### B14. Filtering on `versioning_metadata` (Implemented)

**Question.** The run page and the launch form showed agent and KB versions, but no list
could filter on them. How should filtering work, given the service may add keys?

**Decision.**
- **Any key.** One row per run and key in `dashboard_run_versions` (0066), written by
  the dashboard worker with the run's dimension. No key name is hard-coded: the UI
  builds one dropdown per key it sees, and the APIs take `key=value`.
- **Matching.** Values of one key are alternatives, and different keys must all match.
  `__empty__` matches runs without the key, for example local runs.
- **Values.** Stored as strings: numbers as text, booleans as `true`/`false`, nested
  values as compact JSON. `null` or blank counts as missing. At most 32 keys per run,
  keys up to 100 characters and values up to 500. A longer key or value is not
  filterable rather than truncated, and the run page still shows it.
- **Experiments.** An experiment matches when one job's linked run matches every key.
  A job whose run was hard-deleted no longer matches. The page has one single-value
  select per key, not a multi-select.
- **Facets.** Values are listed newest first, capped at 500 per key.
- **Timing.** The versions appear a few seconds after the job finishes, once the worker
  republishes the run. The service only reports them at completion.
- **Not done.** The runs table has no versioning column.

**Why.** An indexed side table keeps filters to index lookups on large projects, and
the dashboard cache invalidates with the run's republished revision. Using the
projection matches how every other runs-list filter works.

**To reverse or extend.** Add a column in `dashboard.js` from `run.versioning`. Change
the limits in `services/run_versioning.py`. Use a multi-select on Experiments if
alternatives are needed there.

---

## C. Operational follow-ups (not blocking)

- **C1. Browser verification.** No browser or node was available, so all new UI was
  checked with static tests and a syntax check only. A manual pass is needed on: the
  launch form (bases, Advanced panel, sweeps, best run), the experiment matrix, the
  queue page, the official defaults editor and promote, and the run Experiment panel.
- **C2. Deploy step.** After migrations 0060–0064, run
  `python -m qym_platform.tools.backfill_eval_run_scores` once.
- **C3. Stylesheets after client-side navigation.** The shell's client-side navigation
  doesn't carry `<link>` stylesheets. Some pages load them on mount; others (for
  example Project settings → Environments) may show unstyled until a full reload.
- **C4. Stale migration head in `OPERATIONS.md`.** Older text in the file still says the
  migration chain head is `0057` (main has 0058/0059, and eval adds 0060–0064).
- **C5. Old `shell.js` version (fixed).** All pages now load `shell.js?v=…-16`, so browsers fetch the copy that has the Experiments nav item.
- **C6. Dispatcher load test.** This runs outside CI. The slow 64-job test needs
  `QYM_TEST_SLOW=1`, and the Postgres variants need `QYM_TEST_POSTGRES_URL`. Consider
  adding a CI job for the Postgres variants.
