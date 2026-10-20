# WP-B review: per-experiment dataset read token and latency-sensitive runs

Reviewer: independent agent. Branch `review/eval-flags` (from `feat/eval-dataset-token-latency` at `71b6fd90`, nothing changed on the feature
branch). Spec `spec-b.md` (130 criteria), notes `impl-notes-b.md`. Owner decisions D3 and D4 and the orchestrator's override of D-B17 applied.

## Verdict

**MEETS WITH FIXES.** No owner decision (D3, D4, D-B17 override) is contradicted. Of 130 criteria: **121 MEETS**, **6 MEETS (spec number or sentence
amended: the implementation follows the spec text, the spec's number is unreachable with that text)**, **2 MEETS WITH FIXES**, **1 DOES NOT MEET**,
(plus 4 criteria that were only partly measurable here, section 6; they count under MEETS). The security pass is clean (section 4).

Fix list (what must change, and what the measured value must become):

| # | Criterion | Defect | Requested change | The measured value must become |
|---|---|---|---|---|
| F1 | B5-39 | "Set ceiling" goes to step `settings` but does not focus the field: the setting sits in a collapsed group of the Environment configurations step, so `focusField` finds nothing and focus stays on the `H2` | Expand the group that holds `EVAL_VLLM_POST_RUN_MAX_REQUESTS` (or reveal it through the settings search) and focus its input after `revealStep('settings')`; add an e2e assertion | `document.activeElement` is the `EVAL_VLLM_POST_RUN_MAX_REQUESTS` input (today: `H2 id=launch-step-settings`; `getByLabel(/EVAL_VLLM_POST_RUN_MAX_REQUESTS/)` count 0 right after the click) |
| F2 | B4-22 | The `Private test set` chip is 86.5 px wide in the open dataset list and 99 px in the trigger (same class, same 10/650, same padding): the popover sets `text-rendering: geometricprecision`, the trigger `auto` | Set `text-rendering: auto` on the chip (`.tag` of the dataset picker) or on the option content | chip width in the open list 99 px at 1440, 1024 and 390 (today 86.5) |

Documented limitations (a change would not move a measured number, so they are not fixes): B-S3 copy is not in one `copy.ts` for four strings
(`Latency-sensitive only` is in `ExperimentsPage.tsx` and `QueuePage.tsx`, the queue note in `QueuePage.tsx`, `Experiment deleted` in
`ApiKeysTab.tsx`); spec numbers that cannot be met with the verbatim text (B4-34, B5-65 at 1024, B5-40 at 1024, B5-31 reload claim).

## 1. Setup and method

- Python 3.11.17, Node 24. Production build (`npm run build` through `heavy.sh --cost 2`, log `scratchpad/rb/build.log`) served by uvicorn on
  8986 with `QYM_AUTH_MODE=proxy_headers` (so a member, a manager and an admin can be told apart by `X-User-Email`: `alice@x.test` member,
  `bob@x.test` manager, `dev@local` admin), DB `.qym-review-b.db` built by `dev_db.py`, `QYM_LOG_LEVEL=DEBUG`. Fake Evaluation Services: 9086 with
  `--flags` (declares `QYM_DATASET_READ_TOKEN` and `EVAL_VLLM_POST_RUN_MAX_REQUESTS`, environment `staging`), 9087 without (`production`). Seed:
  `measure/seed-b.mts` (project `design-b`, 4 experiments), then the states below through the public API and the fakes' `/__control`.
- Browser: Playwright Chromium, dark scheme, fresh context per width (1440, 1024, 390), scripts `measure/review-b.mts` (runs `review-b-*.mts`),
  raw numbers in `measure/review-out/*.json`, screenshots `shots/review-*.png`.
- Backend: curl/urllib against the live platform plus reading the implementer's tests. Run directly, one file at a time: `test_eval_dataset_tokens.py`
  35 passed 13 skipped, `test_experiment_latency_sensitive.py` 31 passed 7 skipped, `test_migrations_0088.py` 2 passed 1 skipped. Every skip is
  `QYM_TEST_POSTGRES_URL not configured`. `test_design_language.py` 1 passed. Vitest (5 added files) 28 passed.
- Playwright specs the implementer added, through `heavy.sh --cost 3` (log `scratchpad/rb/pw.log`), five files: 15 passed, 1 failed
  (`credentials.spec.ts:50` "the token reaches only the service that declares it": `sent` had 3 entries, one extra job with an undefined token on
  fake A, i.e. a job from a concurrently running spec). Re-run alone with `--workers 1`, twice: 4 passed both times. Verdict: a cross-spec isolation
  flake (the spec file takes the fakes lock, the other specs that launch on fake A do not hold it), not a product defect; the implementer should make
  the other specs take the lock or give them their own fake.

States seeded for the measurements: `staging vs prod` (token sent to staging, `not_declared` on production), `baseline run` (settled, both secrets
revoked), `urgent check` (token stripped: "not issued"), `gate` by alice on production (token exists, never sent: "not sent"), `blocked tok` (token revoked
by hand while the service was down: job BLOCKED), `lat sweep` (6 latency-sensitive jobs driven through `/__control`: succeeded with 1 re-queue, running
admitted, deferred x3, deferred x1 with 1 re-queue, failed after 3 discarded runs, running), `lat one`, `lat two`, `alice lat`.

## 2. Backend (feature 4), measured on the live platform

| ID | Verdict | Measured |
|---|---|---|
| B4-1 | MEETS | Migration file: `revision "0088"`, `down_revision "0087"`; FK `fk_eval_experiments_dataset_read_token_id` (`ON DELETE SET NULL`), index `ix_eval_experiments_dataset_read_token_id`, blob `TEXT NULL`. SQLite round trip in `test_migrations_0088.py` passes; Postgres path read (separate `add_column` + `create_foreign_key`), not run. |
| B4-2 | MEETS | `kind VARCHAR(16) NOT NULL DEFAULT 'admin'` + `ck_dataset_read_tokens_kind`; `experiment_id` FK + `ix_dataset_read_tokens_experiment_id`; existing row ends `admin`/`NULL` (test asserts it); downgrade drops all four columns and the indexes. Postgres not run. |
| B4-3 | MEETS | 4 experiments (one a 3-combination sweep, one 2 environments) produced exactly 4 `dataset_read_tokens` rows, `kind='experiment'`, name `Evaluation Service · <experiment name>`, prefix `qym_dr_…`; every experiment has `dataset_read_token_id` and the blob. |
| B4-4 | MEETS | Dry run (`dry_run: true`, flag on): `dataset_read_tokens` 4 -> 4, `eval_experiments` 4 -> 4. |
| B4-5 | MEETS | 17 API responses (list, queue, environments, 12 experiment details, tokens list) checked against all 22 live secrets (decrypted API keys and token blobs plus every `qym_dr_` value the fakes saw): 0 hits. `qym_dr_<8+>` occurs 0 times in every response except the token list, where the existing `prefix` field (16 characters, `qym_dr_` + 9) matches the regex 15 times: the spec's regex wording overlooks the pre-existing prefix field (see section 4); no secret value is in it. |
| B4-6 | MEETS | Fake A (declares the key) held 6 jobs, all with `env_overrides.QYM_DATASET_READ_TOKEN = qym_dr_…`; fake B (does not declare it) held 1 job, key absent. |
| B4-7 | MEETS | Dry run: `200`, `ok:false`, error `{section:"env_overrides", pointer:"/env_overrides/QYM_DATASET_READ_TOKEN", code:"platform_owned", message:"QYM_DATASET_READ_TOKEN is set by the platform; remove it"}` (also inside a sweep). Launch: `422` with the same error. The value `x-secret-value` is not echoed. `evaluator-config` returns `platform_owned.env_overrides = ["QYM_DATASET_READ_TOKEN"]`, and the field is `read_only` in the staging form. Extra: the `secret_literal` error is added next to it (existing rule). |
| B4-8 | MEETS | The fake echoes the whole `env_overrides` (token included) on every poll; after 20+ polls no table column, the DEBUG log or any response holds a token (DB sweep below). A polled `Bearer …` / `qym_dr_…` in `deferral_reason` is stored as `[REDACTED]`. Pytest `test_echoed_token_is_scrubbed…` and `test_a_polled_echo…` pass. |
| B4-9 | MEETS | Live: finished_at backdated to 300 s, wait for the 60 s sweep: both blobs still set, `revoked_at` null. Backdated to 660 s, next sweep: `dataset_read_token_encrypted` NULL, `qym_api_key_encrypted` NULL, `dataset_read_tokens.revoked_at` set, `api_keys.revoked_at` set, audit `eval.dataset_token_revoked {reason:"settled"}`. 9 min 59 s boundary: `test_token_is_revoked_with_the_api_key_after_the_grace` (`ago=9m59s`). Sweep WHERE for a token-only experiment: `test_settle_sweep_selects_experiments_holding_only_a_token`. |
| B4-10 | MEETS | Read of the tests (cannot be told apart from an admin under auth none/admin headers on the live platform): `test_token_scope_and_revocation_against_item_reads` asserts 403 before, 200 with the token, then after revoke the response equals that of an unknown token (status and body). |
| B4-11 | MEETS | Same test file: reads only (`PATCH` with the token 403), `test_a_token_reads_no_dataset_of_another_project`. Restricted datasets (WP-A) not on this branch: not measurable. |
| B4-12 | MEETS | Live: after hand revoke, retry of the BLOCKED job created a second row (old one `revoked_at` set, new one NULL), `dataset_read_token_id` moved, audit `issued` (re-mint); the retried job ran. Pre-feature experiment and race tests: `test_retry_of_an_experiment_launched_before_the_feature_mints_a_token`, `test_a_guarded_retry_that_lost_a_race_keeps_the_winners_token` pass. |
| B4-13 | MEETS | Live: token revoked by hand, then HIGH jobs ended; the queued job became `BLOCKED`, `wait_reason = error = The experiment's dataset read token is unavailable; retry to issue a new one`, nothing sent to the fake. Non-declaring schema and no-token cases: `test_unusable_token_blocks_only_when_the_schema_declares_it`, `test_an_experiment_without_a_token_is_never_checked`. |
| B4-14 | MEETS | Live: `DELETE .../dataset-read-tokens/{id}` on an experiment token: `200`, again `200` (idempotent); audit `reason:"manual"`; next submit blocked, retry re-minted. (Admin tokens keep their `400` on a second revoke: unchanged, not touched.) |
| B4-15 | MEETS | Token list rows carry `kind` and `experiment: {id,name}`; admin row `experiment: null`; a member gets `403`. Cap/order: `test_the_token_list_is_capped_at_the_newest_200`. |
| B4-16 | MEETS | Detail `credentials = {api_key:{state,revoked_at}, dataset_read_token:{state,revoked_at}}`; states seen live: `active`, `revoked`, `none` (after clearing the columns); within the grace `active`. No id or prefix in the block. |
| B4-17 | MEETS | `staging vs prod`: production job `dataset_token: "not_declared"`, staging job `"sent"`; stripped experiment `null`. |
| B4-18 | MEETS | Audit rows `eval.dataset_token_issued` (launch and re-mint), `eval.dataset_token_revoked` with `reason` `settled` and `manual`; none holds a token (`{experiment_id, token_id[, reason]}`). |
| B4-19 | MEETS | Admin launched `private run` on a private test set (`secret-set`) on two environments: `200`, token minted, no 403. Member launch: `test_no_launch_gate_for_private_datasets`. Dry run `200`. |
| B4-20 | MEETS | Dry run with `secret-set` on staging + production: `warnings = [{code:"dataset_token_not_declared", environment_ids:[production], message:"The schema of production does not declare QYM_DATASET_READ_TOKEN, so “secret-set” (private) is read with the worker’s own token."}]`, `ok:true`; public dataset: `[]`. |

## 3. Backend (feature 5), measured on the live platform

| ID | Verdict | Measured |
|---|---|---|
| B5-1 | MEETS | `latency_sensitive`, `latency_sensitive_min_role` (+ `ck_eval_environments_latency_min_role`), `admitted_at`, `deferrals`, `deferral_reason`, `contaminated_attempts` all in the migration with the specified defaults; the round-trip test asserts `false`/`'member'`/`NULL`/`0`/`NULL`/`0` on existing rows. See section 5 for the downgrade note. |
| B5-2 | MEETS | Create response, list, detail and queue jobs carry the boolean; `lat one` `true`, older experiments `false`. |
| B5-3 | MEETS | `PUT` `"manager"` by bob `200`; `"owner"` `422`; alice (member) `403 "Project manager access required"`; environments list shows the role per environment; health stayed `ok`. |
| B5-4 | MEETS | alice, production manager-only: `403 {"detail":"Latency-sensitive runs on production need a project manager"}`; staging + production both manager-only: `Latency-sensitive runs on staging, production need a project manager`; experiments, tokens and api_keys row counts unchanged (3 tables counted before and after). |
| B5-5 | MEETS | Dry run as alice: `200`, `ok:false`, error `{section:"document", pointer:"/latency_sensitive", code:"latency_sensitive_role", message:<B5-4 sentence>}`; bob and the admin `ok:true`; alice with the flag off `ok:true` and launch `200`. |
| B5-6 | MEETS | alice launched while production was member-level, bob then set it manager-only, her job failed; alice's retry `403 Latency-sensitive runs on production need a project manager`; the admin's retry `200`. |
| B5-7 | MEETS | Fake service jobs: flagged experiments `latency_sensitive: true`, the others `null` (field omitted). Dry-run `request_body` contains `latency_sensitive` when true. |
| B5-8 | MEETS | Document with top-level `latency_sensitive`: dry run `ok:false`, launch `422`, `{section:"document", pointer:"/latency_sensitive", code:"platform_owned", message:"latency_sensitive is set by the platform; remove it"}`. |
| B5-9 | MEETS | Flag on, staging declares the ceiling, unset: `warnings[0] = {code:"vllm_ceiling_unset", pointer:"/env_overrides/EVAL_VLLM_POST_RUN_MAX_REQUESTS", environment_ids:[staging], message:"No post-run request ceiling: steady foreign load would be accepted and skew latency (guide §2.2)"}`, `ok:true`; set to 100: `[]`; production (not declared): `[]`; flag off: `[]`; sweep with `[100, null]`: warning present. |
| B5-10 | MEETS | `warnings` is present in every dry-run response (`[]` when none); with both, order ceiling then token (browser order list). |
| B5-11 | MEETS | Fake set `deferrals 3`, `contaminated_attempts 1`, a 600-character reason: stored `(3, 1)`, reason length 500 ending `…`; secret in a short reason stored `quiet window [REDACTED] Bearer [REDACTED] sk-live-… end`; `updated_at` identical (15:10:45.115726) on two reads 15 s apart (no write on an unchanged poll). Observation: the `sk-live-…` literal is not matched by the existing redaction patterns (pre-existing, not required here). |
| B5-12 | MEETS | `jobs[]` of detail and queue carry the four fields (`admitted_at` as API timestamp: `2026-10-20T12:52:00Z` in the title). |
| B5-13 | MEETS | `FAILED` job: `error = "giving up after 3 discarded run(s)"`, `contaminated_attempts = 3`. Re-queue keeps the reason until the next attempt: the spec text says exactly that ("error = the service's reason until the next attempt starts"); the implementer's flagged deviation is not one. `test_a_contaminated_requeue_keeps_the_reason_until_the_next_attempt` passes. |
| B5-14 | MEETS | `?latency_sensitive=true` total 2 (at the time), `=false` 6, none 8; `=maybe` 422; same on `eval-queue` (200, bad value 422). |
| B5-15 | MEETS | Queue environments: staging `latency_active:true`, production `true`/`false` as flagged jobs were active; `high_active` independent. |
| B5-16 | MEETS | `?clone=<lat sweep>` opens with the box checked, `?clone=<timeout sweep>` unchecked, and it survives a reload (URL-driven). |
| B5-17 | MEETS | Audit `eval_experiment.created` has `latency_sensitive: true/false`; `eval.environment_updated` has `before/after {"latency_sensitive_min_role": …}`. |
| B5-18 | MEETS | `lat one` is `HIGH` + latency, stored and sent `HIGH` (fake: `priority HIGH`, `latency_sensitive true`); a NORMAL job queued behind it as for any HIGH. |
| B5-19 | MEETS | Read `test_filter_statement_count_does_not_depend_on_the_flagged_rows` (passes); GET routes wrote nothing (my DB sweep shows no side effects). |
| B5-20 | MEETS | Environments list shows the role per environment; after changing it health stayed `ok`, schema and presets untouched. |
| B5-21 | MEETS | The UI computes the disabled state from `isManager` and the environments' role, never from a failed request (alice: box disabled with no request sent; verified in section 7). |
| B5-22 | MEETS | No PATCH accepts the flag (route list); clone and retry carry it (B5-16, B5-6). |

Feature 4 and 5 migrations: B-S14 and the migration notes are in section 5.

## 4. Security pass (WP-B)

| Check | Result |
|---|---|
| Token or API key in `request_body`, `remote_result`, `error`, `wait_reason`, `params`, `spec`, audit columns, any other text column | 0 hits across every table and column against 22 secrets (decrypted live blobs of `qym_api_key_encrypted` and `dataset_read_token_encrypted`, plus every `qym_dr_` value the fakes received). The fake echoes the full `env_overrides` on every poll, so the scrubber was exercised for real. |
| Logs | `QYM_LOG_LEVEL=DEBUG` log (platform, httpx, httpcore, dispatcher): 0 occurrences of any secret value, 0 of `qym_dr_<8+>`; `Authorization` shown as `[REDACTED]`. |
| API responses | 17 responses (list, queue, environments, 12 experiment details, token list) and the 422 bodies: 0 secret values. The only `qym_dr_<8+>` strings are the existing `prefix` field of the token list (`qym_dr_` + 9 of 43 characters): B4-5's regex wording would flag it; the prefix existed for admin tokens before this work. Recommend the spec/test regex say "20 or more token characters". |
| Platform-owned pointers | `/env_overrides/QYM_DATASET_READ_TOKEN` (also in a sweep) and top-level `latency_sensitive` rejected in dry run and launch; value not echoed. |
| Revocation is real | Live: the sweep revoked the token row and API key together after the grace and not before; hand revoke blocks the next submit; retry re-mints (new row, old stays revoked). |
| Authorization | A member gets `403` on the token list; `PUT` of the role as a member `403`; member does not see the Dataset read tokens card (count 0) and sees 3 disabled selects on the environment form. |
| Dry run | Never mints (counts 4 -> 4 on both tables). |

## 5. Migration 0088

- File read for both dialects: SQLite uses inline `REFERENCES`/`CHECK` in `ADD COLUMN` (the `0077` pattern), Postgres uses `add_column` +
  `create_foreign_key`/`create_check_constraint`. Downgrade drops indexes and columns in reverse order, and the FK constraint on Postgres.
- `0087` (`../qym-wt-dataset-access`, read only) does not mention `dataset_read_tokens`, `eval_experiments`, `eval_environments` or
  `eval_experiment_jobs`, so the order 0087 -> 0088 cannot conflict.
- The full chain 0086 -> 0087 -> 0088 cannot be run on SQLite (older revisions use `ALTER CONSTRAINT`, as the implementer found). What was run: the
  implementer's SQLite round trip (upgrade, defaults, checks reject bad values, ON DELETE SET NULL, downgrade, re-upgrade) passes in
  `test_migrations_0088.py`. Postgres (`QYM_TEST_POSTGRES_URL`) and the chain at integration: not run here.
- Observation (informational): on a database created from the metadata (`dev_db.py`/`create_all`), `downgrade()` fails with `no such column:
  latency_sensitive_min_role` because the model declares the CHECK as a table constraint, which SQLite will not let a column drop under. A database
  built by the migration (the supported path) round-trips. Not a defect of the migration; do not use a `dev_db.py` database to test downgrades.
- `tests/platform/test_migrations.py` still expects head `0086` (4 known failures until 0087 is merged): the integrator moves the expected head to `0088`.

## 6. Not measured, and why

| What | Why |
|---|---|
| B4-22/B4-25 `Restricted` chip, B4-25 restricted-text heights (1/2/4 lines), B4-11 restricted datasets | `access_mode` comes from WP-A's `0087`, which is not on this branch (`access_mode` is always `project`). The private-test-set chip and help were measured. |
| B4-2, B-S14 on Postgres | No `QYM_TEST_POSTGRES_URL` (all `postgres` tests skip). |
| B4-40 `Experiment deleted` line, B4-45 cap of 200 | No experiment delete route to drive the first in the browser (pytest only); the second needs 200 rows (pytest `test_the_token_list_is_capped_at_the_newest_200` passes). |
| B5-36, B5-41 pane totals, B5-65 with HIGH and latency both active, B5-66 note disappearing on the next poll | The mock heights depend on the mock's content; the pane's own numbers were measured (section 7). HIGH-first order read in `QueuePage.tsx` (lines 596, 600). |

## 7. Browser measurements (production build, dark, fresh contexts, widths 1440 / 1024 / 390)

### Launch step 1: Run settings (B5-23 to B5-34)

| ID | Verdict | Measured (1440 / 1024 / 390) |
|---|---|---|
| B5-23 | MEETS | Checkbox exists below name/priority and above Versioning details; unchecked; label row 16.8 / 16.8 / 16.8 px; Tab order name, priority, latency checkbox, versioning textarea at 390 (DOM order the same on desktop). |
| B5-24 | MEETS | Helper text verbatim, `11px/400`, `rgb(154,154,178)` (muted), `padding-inline-start 24px`; heights **15.4 / 30.8 / 61.6 px**. |
| B5-25 | MEETS | Card (flag off) **236.4 / 251.8 / 376.7 px**; name input 506 x 24 and priority 253 x 24 (1440), 476.7 and 238.3 (1024), 237 each (390). |
| B5-26 | MEETS | Warning callout `role=note`, title `Other jobs wait while this run executes`: **755 x 34.8 / 711 x 34.8 / 213 x 51.6**; card **279.2 / 294.5 / 436.3**; off again: back to 236.4 / 251.8 / 376.7; page overflow 0. |
| B5-27 | MEETS | alice, staging + production (production manager-only), box checked: body `Only a project manager can launch it on production. Clear the box or ask a project manager.`; callout **55.6 / 55.6 / 106**; card **300 / 315.3 / 490.7**; checkbox enabled. |
| B5-28 | MEETS | alice, production only: checkbox disabled and unchecked; `data-testid="launch-latency-reason"` `Only project managers can launch latency-sensitive runs on production.`, `11px`, `--text-secondary` `rgb(168,168,186)`, inset 24 px, height **15.4 / 15.4 / 30.8**; card **255.8 / 271.1 / 411.5**; helper stays; `aria-describedby="launch-latency-help launch-latency-reason"`. |
| B5-29 | MEETS | No environment selected: enabled, no reason; admin with production: enabled (e2e `latency-role.spec.ts`); partial selection enabled with no reason line. `latencyGate.test.ts` passes. |
| B5-30 | MEETS (not driven in browser) | Archived-project state covered by `RunSettings.latency.test.tsx` and the code (`isDisabled={readOnly || gate.disabled}`, reason hidden when `readOnly`). |
| B5-31 | MEETS (spec claim amended) | The flag is in the draft, sent as `latency_sensitive` only when true, restored from a clone (true after reload because the clone is in the URL). The claim "restored from the `?step=where` URL reload (the draft persists as every field does)" is false for every field: after a reload of a manual draft the name is empty and the box unchecked. The flag behaves exactly like every other field. Not shown in Raw JSON's document (implementer's decision, consistent with B5-8). |
| B5-32 | MEETS | Space toggles (e2e passes); `aria-describedby` includes the helper (and the reason line when present); callout `role=note`. |
| B5-33 | MEETS (partly read) | Contrast: helper `rgb(154,154,178)` and reason `rgb(168,168,186)` are the muted and secondary tokens; axe is run by the added specs (`a11y`), not re-run for the five mock states here. |
| B5-34 | MEETS | `documentElement.scrollWidth - clientWidth = 0` at all three widths with the box on; control heights 24 px. |

### Launch: dataset picker (B4-21 to B4-27)

| ID | Verdict | Measured |
|---|---|---|
| B4-21 | MEETS | Trigger 24 px high; width = card content (361.5 / 339.5 / 237); `scrollWidth <= clientWidth` (360/360, 338/338, 235/235) with `secret-set` + chip selected. |
| B4-22 | MEETS WITH FIXES (F2) | Trigger chip `Private test set` **99 x 20**, `10px/650`, sans, identical at the three widths; list: 2 options of **32 px**, but the chip is **86.5 x 20** there (cause: `text-rendering geometricprecision` in the popover). `Restricted` chip (71 px) not measurable (section 6). |
| B4-23 | MEETS | Chip after the name with the 8 px gap (`secret-set` text then chip, `datasetName` flex); names never truncated (rendered text equals the name). |
| B4-24 | MEETS | A plain dataset (`golden`): no chip, no help line, trigger 24 px. |
| B4-25 | MEETS (private text only) | `data-testid="dataset-token-help"`, `11px`, `rgb(154,154,178)`, 0 icons, text verbatim `Private test set. The experiment reads it with its own dataset read token; only admins see its item contents.`; height 30.8 / 30.8 / 46.2 px (the spec gives heights for the restricted text only). |
| B4-26 | MEETS | No option disabled (0 `aria-disabled`), no lock, no error; review pane shows no problem for it (`READY`). |
| B4-27 (D-B17 override) | MEETS | The picker lists every dataset of the project: `golden` and `secret-set` (private); `GET .../experiments/launch-datasets` returns both with `private_test_set`, `access_mode`. |

### Review pane (B5-35 to B5-42)

| ID | Verdict | Measured |
|---|---|---|
| B5-35 | MEETS | Flag on: row `Latency-sensitive: yes` between Priority and Versions, **36.2 px** (6 rows, 36.2 each; Versions 53 at 390 because of its content); flag off: 5 rows. |
| B5-36 | MEETS (not comparable) | Pane ready state, flag on, real content: 659.0 (with the ceiling warning) / 596.2 / 664.6; the mock's 435.1 is content-specific. |
| B5-37 | MEETS | alice, staging + production, box checked: badge `1 PROBLEM`, heading `1 problem to fix`, one button `Latency-sensitive` / `Latency-sensitive runs on production need a project manager`, height **70.4** at 1440, **53.6** at 1024, **70.4** at 390; click focuses `launch-latency` (active element is the checkbox input). |
| B5-38 | MEETS | The item exists with the box checked and disappears 3.5 s after clearing it; Launch button `Launch 2 runs` absent from the ready state (the item is a problem as today). |
| B5-39 | DOES NOT MEET (F1) | Callout `Post-run ceiling not set`, body verbatim, button `Set ceiling` (neutral, sm): **100.4 / 83.6 / 117.2 px**, width 310 / 735 / 237. The button goes to `step=settings` but focus ends on `H2 launch-step-settings` and the field is not in the DOM (collapsed group); the spec asks to focus `/env_overrides/EVAL_VLLM_POST_RUN_MAX_REQUESTS`. |
| B5-40 | MEETS (spec number amended at 1024) | `Dataset read token will not be sent`, body verbatim for `production` / `secret-set` / `private`, `QYM_DATASET_READ_TOKEN` in mono, no button: **90.4 / 73.6 / 107.2**. 1440 and 390 equal the spec; at 1024 the body is 2 lines (34.8 px) because this text is longer than the mock's `staging` / `golden` / `restricted` (the spec's 56.8 is the one-line body). |
| B5-41 | MEETS | Both warnings in the order ceiling then token, above `Validation`; badge stays `READY`, Launch enabled; both: pane 851.2 / 754.8 / 855.6 with the review's content. |
| B5-42 | MEETS (read) | Previous warnings stay until the new response arrives (state kept in the preview query; no flicker seen between 3.5 s waits). |

### Environment form (B5-43 to B5-48)

| ID | Verdict | Measured |
|---|---|---|
| B5-43 | MEETS | Select `Who can launch latency-sensitive runs` exists in Policies, 24 px high, options exactly `Anyone in the project`, `Project managers only`; widths **374.3 / 235.7 / 237** (the spec's 364.3 is the 1163 px gallery frame: 1193 / 3 columns = 374.3), three columns at 1440 and 1024, stacked at 390. |
| B5-44 | MEETS | Help verbatim `Latency-sensitive runs make other jobs on this environment wait. Project managers and admins can change this.`, 30.8 / 46.2 / 46.2 px. Section heights 262.9 / 278.3 / 472.9 with the real extra content. |
| B5-45 | MEETS | e2e `latency-role.spec.ts` (passes): dirty -> `Unsaved changes`, save body, toast `Saved “staging”`, stored `manager`; I confirmed the stored values and `eval.environment_updated {before,after}` live. |
| B5-46 | MEETS | alice (member): 3 of 3 selects disabled on the environment form. |
| B5-47 | MEETS | Health `ok`, schema and presets unchanged after role changes (environments list). |
| B5-48 | MEETS | No new column in the environments list (code and e2e). |

### Experiment detail (B4-28 to B4-38, B5-49 to B5-58)

| ID | Verdict | Measured (1440 / 1024 / 390) |
|---|---|---|
| B4-28 | MEETS | `section` named `Credentials`, `dl` with exactly `API key`, `Dataset read token` (this order), one `dd` badge each; one line, **20 px** high at 1440 and 1024, `align-items:center`, 8 px inside a pair. |
| B4-29 | MEETS | At 390 the section is **63.4 px** high, width 279, 0 overflow, no name truncated. |
| B4-30 | MEETS | `active` 55.9 x 20 (success, `rgb(16,185,129)`, 10/650); `revoked 18:00` 98.6 x 20 (neutral; absolute timestamp in `title`); `not issued` 80.7 x 20 neutral; `not sent` 68.7 x 20 warning (`rgb(245,158,11)`). API key `not issued` only for state `none` (code path; a stripped experiment shows the API key `revoked`, token `not issued`). |
| B4-31 | MEETS | Row present for every experiment opened (any status); no prefix, id or copy control. |
| B4-32 | MEETS | PageHeader + row frame from y 101: **129.2 px** at 1440 and 1024 (header 69.2 + 20 + 20 + 20), **193.4 px** at 390 (header 90, section 63.4), **221.4 px** at 390 with the latency tag wrapped under the title (header 118: +28). |
| B4-33 | MEETS | One environment: `Dataset read token not sent to production: the environment’s schema does not declare QYM_DATASET_READ_TOKEN. Its jobs read datasets with the Evaluation Service’s own token.` (`role=note`, 1 callout, token in mono); only for experiments with a `not_declared` job. Several-environment text: read in `detail/copy.ts` and `Credentials.test.tsx` (passes). |
| B4-34 | MEETS (spec number amended) | Callout widths 1193 / 777 / 279 as the page. Heights for the one-environment text: **36 / 52.8 / 103.2** vs the spec's 34.8 / 34.8 / 51.6: those spec numbers cannot be reached with the verbatim B4-33 text (about 175 characters in a 279 px callout cannot be 3 lines; the measured values equal the spec's own "several environments" row). Amend B4-34 to 36 / 52.8 / 103.2. |
| B4-35 | MEETS | `blocked tok` (token revoked while its job is BLOCKED): `Dataset read token revoked 18:15. Retry the blocked jobs to issue a new one.` (`tone=warning`, 34.8 px at 1440 and 1024, 51.6 at 390); time equals the badge `revoked 18:15`; not shown for the settled experiments (revoked normal). |
| B4-36 | MEETS | Notice and warning never together (code `else if`; warning case measured with `noticeCount 1`); no notice for `null` or `sent` jobs (`active`, `revoked` cases: 0). |
| B4-37 | MEETS | The reason shows in the status cell as a red secondary line, one line, parent `overflow:hidden; text-overflow:ellipsis; white-space:nowrap` at 184 px, full text in `title`; also in the warning above. |
| B4-38 | MEETS (partly read) | Text in every badge; axe is part of the added `a11y` coverage, not re-run per state here. |
| B5-49 | MEETS | `data-testid="latency-tag"` `Latency-sensitive` **98.4 x 20** at all widths, same line as the title at 1440 and 1024 (title block 69.2 unchanged), wraps under the title at 390 (title block 118 vs 90). |
| B5-50 | MEETS | Status column header **240** (latency) vs **200** (plain) at 1440 and 1024; Params 257 vs 297 at 1440; rows **40 x 6**, header 34 in both tables. |
| B5-51 | MEETS | `↻ 1`, `↻ 1`, `↻ 3`: 34 x 20, mono (`Qym Mono`), `aria-label` `re-queued 1 time` / `re-queued 3 times`, only in the latency experiment. |
| B5-52 | MEETS | Lines read `re-queued ×1 · contaminated`, `admitted 15:52` (title `2026-10-20T12:52:00Z`, local time), `deferred ×3 · vllm quiet window`, `deferred ×1 · gateway quiet window`, `giving up after 3 discarded run(s)` in red `rgb(239,68,68)`; muted `rgb(154,154,178)` 11 px otherwise; none clipped at 240 px; `admissionLine` unit tests pass. |
| B5-53 | MEETS | Rows as specified (`SUCCEEDED ↻1`, `RUNNING`, `SUBMITTED` (the spec's QUEUED: the local status for a job queued at the service), `SUBMITTED ↻1`, `FAILED ↻3` red); BLOCKED row `The experiment's dataset read token is unav…` with ellipsis and `title`. |
| B5-54 | MEETS | Plain experiment: status column 200, only the error line, no tag, no admission text. |
| B5-55 | MEETS | At 390 the card shows badge, `↻` tag and the line under `#n`; overflow 0; card heights 93 / 116.4 follow the content. |
| B5-56 | MEETS | e2e `credentials.spec.ts` "deferral, admission and re-queue texts follow the service" passes (polling updates the text); live: the table refreshed as the fake changed. |
| B5-57 | MEETS | Matrix card unchanged (screenshot, badge only). |
| B5-58 | MEETS | The tag renders with the data; loading and error states untouched. |

### Lists, queue, token table (B4-39 to B4-46, B5-59 to B5-70)

| ID | Verdict | Measured |
|---|---|---|
| B4-39 | MEETS | Rows **40 / 40 / 40** (admin and experiment), header 34 at 1440; at 1024 experiment rows **56.9** and the admin row 40; at 390 a card list (no rows). Five columns unchanged. |
| B4-40 | MEETS | `token-kind-chip` `experiment` **69.6 x 20**; `token-experiment-link` `Experiment · lat sweep` 113.2 x 14, `11px/400`, `href=/projects/design-b/experiments/<id>`; admin row has neither. `Experiment deleted`: not drivable (section 6). |
| B4-41 | MEETS | Revoke button present on every live token (admin and experiment), absent on revoked rows (0 buttons); statuses `active` / `revoked`. |
| B4-42 | MEETS | Title `Revoke “Evaluation Service · private run”?`, body `Jobs of this experiment that have not read their dataset yet will fail until you retry them; the retry issues a new token.`, buttons `Cancel`, `Revoke token`, focus starts on `Cancel`; admin token keeps `Services using this token lose access to private datasets.` Toast `Token revoked`: e2e. |
| B4-43 | MEETS | `Create token` form present and unchanged; 0 raw tokens visible on the page (`qym_dr_` + 20 or more characters: 0). |
| B4-44 | MEETS | Member sees no card (0); other states are today's (read). |
| B4-45 | MEETS | Newest-200 cap by `test_the_token_list_is_capped_at_the_newest_200`; 16 rows listed live, revoked ones included. |
| B4-46 | MEETS | Description is exactly `Admin-issued; lets a service read private test sets (QYM_DATASET_READ_TOKEN). Experiment tokens are issued at launch and revoked when the experiment settles.` |
| B5-59 | MEETS | Flagged rows keep **40 px** (all rows 40 at 1440 and 1024 for names up to 12 characters); tag **98.4 x 20**. |
| B5-60 | MEETS | `Latency-sensitive only` checkbox after `Created by me`, **141.9 x 16.8**, URL `?latency=1` (removed when off), only flagged rows (5 of 13), footer `5 experiments`. |
| B5-61 | MEETS (read) | `isFiltered` includes it (code and `lists-latency.spec.ts`). |
| B5-62 | MEETS | At 390 the group is 74.2 px high (no extra line: both checkboxes fit on the second line), 0 overflow. |
| B5-63 | MEETS | Queue job cell order name, HIGH, Latency-sensitive (code); tag 98.4 x 20; rows 40 at 1440 for the seeded names; at 1024 two rows are 45 px where `lat sweep #n` + tag + params wrap in the 200 px job column (allowed wrap, as L-B1). |
| B5-64 | MEETS | Checkbox after `Only my jobs`, `?latency=1`, API `latency_sensitive=true`; the `jobs` meta follows the total (`6 jobs`). |
| B5-65 | MEETS (spec number amended at 1024) | `data-testid="queue-latency-note"` `role=note` verbatim `A latency-sensitive job is active on production. Other jobs wait until it finishes.` (and for staging), 11 px, warning border; **25.4** at 1440, **40.8** at 1024 and 390. At 1024 the environment card is 381.5 px wide, a one-line (25.4) note is impossible for an 80-character sentence: amend to 40.8. |
| B5-66 | MEETS (read) | The note is a flow `<p role="note">`, not a toast; `latency_active` is recomputed on each queue poll. |
| B5-67 | MEETS | Filter order `Created by me`, `Latency-sensitive only`; `Only my jobs`, `Latency-sensitive only`; tags are plain spans. |
| B5-68 | MEETS | Every latency tag on detail, list and queue is **98.4 x 20**, `Qym Sans`, one shared `LatencyTag`. |
| B5-69 | MEETS (partly read) | Axe coverage is in the added specs (`a11y`/`lists-latency`), which passed; not re-run per state. |
| B5-70 | MEETS | No new column anywhere (headers listed above are unchanged). |

### Shared (B-S1 to B-S14)

| ID | Verdict | Measured |
|---|---|---|
| B-S1 | MEETS | `pytest tests/platform/test_design_language.py` 1 passed; the implementer's `npm run check` (design test 52) not re-run in full. |
| B-S2 | MEETS (not re-run) | I ran the five added Vitest files (28 passed); the full `npm run check` is the implementer's gate (`check3.log`). |
| B-S3 | MEETS WITH FIXES (documented limitation) | New strings are in `launch/copy.ts`, `detail/copy.ts`, `environments/copy.ts` except `Latency-sensitive only` (in `ExperimentsPage.tsx` and `QueuePage.tsx`), the queue note (`QueuePage.tsx`) and `Experiment deleted` (`ApiKeysTab.tsx`). Move them to a `copy.ts` per area; no measured number changes. |
| B-S4 | MEETS | Sentences, no exclamation marks, mono only for variable names and counts. |
| B-S5 | MEETS | New text uses `--font-sm` (11 px) and `--font-base`; chips 10/650 only through Tag/Badge. |
| B-S6 | MEETS | All notices are flow elements (screenshots). |
| B-S7 | MEETS | Dataset names, environment names and experiment names wrap; only the existing error lines ellipsise. |
| B-S8 | MEETS | The Credentials row renders with the detail query (never alone); status cell keeps 40 px rows; the launch card grows only by the rows measured under B5-25 to B5-28. |
| B-S9 | MEETS | Controls labelled and reachable by Tab; tags and badges carry text. |
| B-S10 | MEETS (read) | Archived: `isDisabled={readOnly ...}` on the checkbox; role select disabled for `canEdit=false`; Revoke follows today's rule. |
| B-S11 | MEETS | Member: no token card, role select disabled (3 of 3), PUT `403`. |
| B-S12 | MEETS | `scrollWidth - clientWidth = 0` at 390 on launch, detail, list, queue, environment form and settings. |
| B-S13 | MEETS | `docs/internal/DB_SCHEMA.md`, `docs/USER_GUIDE.md` (+33 lines), `docs/internal/EVAL_SECURITY_CHECKLIST.md` updated. |
| B-S14 | MEETS (chain and Postgres not run) | `down_revision = "0087"`; SQLite round trip passes; see section 5. |

## 8. Implementer's flagged deviations, judged

1. Contaminated re-queue keeps the service error in `job.error` until the next attempt (B5-13): matches the spec sentence; accepted.
2. Launch draft in memory only (B5-31): the same as every other field; the spec claim is wrong, not the code; accepted (clone survives a reload because it is in the URL).
3. Errors carry both `rule` and `code`: measured, both present on every dry-run and 422 error; harmless; accepted.
4. Experiment-token revoke is idempotent (`200`/`200`, measured) while admin-token revoke keeps `400`: matches B4-14; accepted.
5. Amended B4-27 / D-B17: the picker lists every dataset of the project, none disabled; accepted (override).

## 9. Count

| Outcome | Count | IDs |
|---|---|---|
| MEETS | 121 | all others |
| MEETS (spec number or claim amended) | 6 | B4-34, B5-40 (1024), B5-65 (1024), B5-31, B5-36, B4-25 (private text only) |
| MEETS WITH FIXES | 2 | B4-22 (F2), B-S3 (documented limitation) |
| DOES NOT MEET | 1 | B5-39 (F1) |
| Partly not measurable here (counted above under MEETS) | 4 | restricted chip and help (B4-22/B4-25), restricted reads (B4-11), Postgres (B4-2/B-S14), `Experiment deleted` (B4-40) |

## 10. Re-review of the fix pass (tip `597a35b9`: `c9765744`, `ab2041e4`, `597a35b9` on top of the cherry-picked review `bd485bd6`)

Production build of the tip (`npm run build` through `heavy.sh --cost 2`, log `scratchpad/rb/build2.log`), fresh DB, platform on 8986 with
`proxy_headers`, fakes on 9086 (`--flags`) and 9087, same method as section 1. Script `measure/review-b-rereview.mts` (+ `review-b-launch3.mts`),
numbers in `measure/review-out/rereview.json`.

| Item | Measured (1440 / 1024 / 390) | Verdict |
|---|---|---|
| F1, B5-39 | Click "Set ceiling": URL `?step=settings`, `document.activeElement` is an `INPUT` labelled `Eval Vllm Post Run Max Requests` (the EVAL_VLLM_POST_RUN_MAX_REQUESTS setting), visible (non-zero box), group opened, at all three widths. Callout heights unchanged 100.4 / 83.6 / 117.2. | MEETS |
| F2, B4-22 | Open list chip `Private test set` **99 x 20 / 99 x 20 / 99 x 20**; trigger chip 99 x 20 at all three. | MEETS |
| B-S3 | `Latency-sensitive only` now only in `experiments/copy.ts` (used by list and queue), the queue note in `queueLatencyNote` there, `Experiment deleted` in `shell/settings/copy.ts` (grep over `src`, tests and gallery excluded). | MEETS |
| B4-34 (amended) | Notice (`staging vs prod`, one environment not declared) **36 / 52.8 / 103.2**, widths 1193 / 777 / 279. Spec row marked `(amended)` with 36 / 52.8 / 103.2, asserted in `credentials.spec.ts` (`toEqual({1440:36,1024:52.8,390:103.2})`). Wording nit: the amendment says "several environments", the numbers I measured are for one environment; the numbers are right, the word is not. | MEETS |
| B5-65 (amended) | Queue note **25.4 / 40.8 / 40.8** (card 590 / 382 / 279 px). Spec row amended, asserted in `lists-latency.spec.ts` (`{390:40.8,1024:40.8,1440:25.4}`). | MEETS |
| B5-40 (amended) | Token warning **90.4 / 73.6 / 107.2**. Spec row amended (73.6 at 1024), asserted in `latency-sensitive.spec.ts`. | MEETS |
| B5-31 (amended) | Spec row reworded: a memory draft does not survive a reload, the clone is the reload-proof path; matches my earlier measurement. | MEETS |
| B4-5 (amended) | Spec regex now `qym_dr_` + 20 or more token characters; the token-list `prefix` (`qym_dr_` + 9) no longer matches. | MEETS |
| Spec rows | B4-5, B4-34, B5-31, B5-40, B5-65 carry `(amended)` with the same numbers the e2e asserts. | MEETS |
| Five Playwright specs together (`heavy.sh --cost 3`, log `scratchpad/rb/pw2.log`) | **19 passed, 0 failed** in one run (credentials, lists-latency, latency-sensitive, latency-role, dataset-read-tokens). The earlier cross-spec failure did not recur: `fakeJobsOf(request, exp, port)` filters the fake's jobs by experiment, so a concurrent spec's job no longer enters the assertion. | MEETS |

**Final verdict: MEETS.** All 130 criteria are MEETS (with the amended numbers above); the only open items are the ones that cannot be measured on this
branch (Restricted chip and restricted reads need WP-A's 0087, Postgres, the chain 0086 -> 0087 -> 0088 at integration). Ports 8986, 5986, 9086
and 9087 released (`ss -ltnp` empty).
