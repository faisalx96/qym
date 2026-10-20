# WP-B: per-experiment dataset read token and latency-sensitive runs (design specification)

Status: design stage. No product component, route or model has been changed. The code added is the gallery mock
`frontend/src/features/dev/EvalFlagsMocks.tsx` (+ `EvalFlagsMocks.module.css`, wired into `/__ui#eval-flags` in `UiGalleryPage.tsx`), the
measurement scripts under `measure/`, the screenshots under `shots/` and this document. The mocks are the visual contract: where this
text and a mock disagree, the number in this text wins and the mock is a bug. The CSS in `EvalFlagsMocks.module.css` is the proposed recipe.

Branch `feat/eval-dataset-token-latency` (from the design commit `38d710c5`). Product design: `docs/internal/DATASET_ACCESS_AND_EVAL_FLAGS_DESIGN.md`
sections 4, 5 and the owner decisions D3, D4 (final, not re-opened). Service contract: `docs/evaluation-service-api-integration-v1.3.md` §2.2, §4.3, §4.4.
Measured 2026-10-20 at 1440, 1024 and 390 px (report column 1193, 777, 279 px; launch step-1 column 821, 777, 279; review pane 352, 777, 279),
Playwright Chromium (headless shell), dark scheme, SQLite, platform on 8982, Vite on 5982, two fake Evaluation Services
(`frontend/scripts/fake_eval_service.py`) on 9082 and 9083.

## 0. Reading guide

The owner's features in their words (the five lines of the design document's table; WP-A owns 1 to 3, this spec is 4 and 5):

| WP | Feature | Backend | UI |
|---|---|---|---|
| A | 1. Per-dataset permissions (view / modify) | `dataset_grants` table, `datasets.access_mode`, permission helpers, access routes | Dataset Settings "Access" section, catalog chips, per-dataset read-only plumbing |
| A | 2. Deactivate items temporarily | `dataset_items.disabled_*`, `state` filter on item reads, enable/disable routes, revisions | Items tab state filter + chips, item pane / item page actions and banner |
| A | 3. Batch edit by metadata | metadata filter on item list, `items:batch` action route, metadata facets route | Metadata filter in the items toolbar, "Apply to all N matching" bulk menu with dry-run confirm |
| B | 4. Per-experiment dataset read token | `eval_dataset_tokens` service (mirror of `eval_submitter_keys`), 2 columns on `eval_experiments`, dispatcher injection, revoke on settle | Experiment detail "Credentials" row, token list shows experiment tokens |
| B | 5. Latency-sensitive runs | `eval_experiments.latency_sensitive`, request field, dispatcher body field, env cap, review warnings | Launch "Run settings" switch, review pane row, detail / list / queue tags, job deferral status |

| Feature | Surface (file today) | Criteria |
|---|---|---|
| 4 | Backend: migration, `services/eval_dataset_tokens.py`, dispatcher, platform-owned pointer, scrubbing, revoke, token list route, audit | B4-1 to B4-20 |
| 4 | Launch dataset picker (`launch/entry/DatasetPicker.tsx`) | B4-21 to B4-27 |
| 4 | Experiment detail header "Credentials" row and notices (`detail/ExperimentDetailPage.tsx`) | B4-28 to B4-38 |
| 4 | Project Settings, API keys, Dataset read tokens (`shell/settings/ApiKeysTab.tsx`) | B4-39 to B4-46 |
| 5 | Backend: migration, request field, gate, body field, warnings, poll storage, filters, queue summary | B5-1 to B5-22 |
| 5 | Launch step 1 Run settings (`launch/entry/RunSettings.tsx`) | B5-23 to B5-34 |
| 5 | Review pane (`launch/review/ReviewPane.tsx`) | B5-35 to B5-42 |
| 5 | Environment edit form (`environments/SettingsForm.tsx`) | B5-43 to B5-48 |
| 5 | Experiment detail header tag, jobs table status cell (`detail/`) | B5-49 to B5-58 |
| 5 | Experiments list (`list/ExperimentsPage.tsx`), queue (`queue/QueuePage.tsx`) | B5-59 to B5-70 |

130 numbered criteria in total (46 for feature 4, 70 for feature 5, 14 shared in section 7). Section 7 holds the decisions, section 9 the limits of this
design stage, section 10 the test plan, section 11 the hand-off.

### Screenshots (`docs/internal/feature-rounds/2026-10-dataset-access/shots/`, each under 300 KB, dark scheme)

| File | What |
|---|---|
| `current-launch-run-settings-{1440,1024,390}.png` | the Run settings card today (name, priority, versioning) |
| `current-launch-step1-{1440,1024,390}.png` | launch step 1 with the review pane (column and stacked layouts) |
| `current-detail-header-{1440,1024,390}.png`, `current-detail-jobs-{1440,1024,390}.png` | experiment detail header and Job history |
| `current-list-{1440,1024,390}.png`, `current-queue-{1440,1024,390}.png` | experiments list and queue |
| `current-env-policies-{1440,1024,390}.png` | environment edit form, Policies section |
| `current-settings-tokens-{1440,1024,390}.png` | Project Settings, Dataset read tokens card |
| `mock-ef-run-settings-*`, `mock-ef-review-*`, `mock-ef-dataset-*`, `mock-ef-detail-header-*`, `mock-ef-jobs-*`, `mock-ef-list-queue-*`, `mock-ef-env-form-*`, `mock-ef-tokens-*` (each at 1440, 1024, 390) | the specified design, every state, in the real column widths |

### How it was measured (`measure/`, Node 24, Playwright from `frontend/node_modules`)

```
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; export PYTHONPATH=packages/sdk:packages/platform
python frontend/scripts/dev_db.py sqlite:///$PWD/.qym-design-b.db
python frontend/scripts/fake_eval_service.py 9082 &   python frontend/scripts/fake_eval_service.py 9083 &
QYM_AUTH_MODE=none QYM_DATABASE_URL=sqlite:///$PWD/.qym-design-b.db QYM_ENVIRONMENT=test QYM_ALLOW_PRIVATE_LLM_BASE_URLS=true \
  QYM_LLM_CONFIG_ENCRYPTION_KEY=<fernet key> QYM_BASE_URL=http://127.0.0.1:5982 QYM_EVAL_EXPERIMENT_CREATE_RATE_LIMIT=0 QYM_ROLE=all \
  python -m uvicorn qym_platform.main:app --port 8982 &
(cd frontend && QYM_PLATFORM_PORT=8982 QYM_VITE_PORT=5982 npm run dev -- --port 5982 --strictPort --host 127.0.0.1) &
node docs/internal/feature-rounds/2026-10-dataset-access/measure/seed-b.mts          # project design-b, 2 envs, 4 experiments -> seed-b.json
node docs/internal/feature-rounds/2026-10-dataset-access/measure/current.mts         # current state -> baseline/current-<w>.json + shots/current-*
node docs/internal/feature-rounds/2026-10-dataset-access/measure/mock-measure.mts    # specified design -> baseline/mock-<w>.json
node docs/internal/feature-rounds/2026-10-dataset-access/measure/mock-shots.mts      # shots/mock-*
```

| Script | What it measures |
|---|---|
| `lib-b.mts` | shared helpers (browser, seed, boxes, shots) |
| `seed-b.mts` | the public-API seed; `seed-b.json` (local ids, not committed) is its output |
| `current.mts` | boxes, row heights and font roles of every surface above at the three widths, plus the `current-*` shots |
| `mock-measure.mts` | the same for the gallery frames: card heights per state, helper and callout boxes, badge and tag boxes, table row heights |
| `mock-shots.mts` | the `mock-*` shots, one per case and width |

Numbers in section 2 to 6 are quoted from `measure/baseline/current-*.json` (current) and `mock-*.json` (specified). Gallery frames sit in a case
with 15 px side padding, so a frame that is 1193 px in the app is 1163 px in the gallery; the spec numbers are the app's, the mock numbers are quoted
with their frame width. Machine: shared, medians not needed (geometry is deterministic).

## 1. Summary

| Feature | Today | Design |
|---|---|---|
| 4 | The worker reads private test sets only through a deployment-wide token configured by an admin; the dispatcher sends none. A restricted dataset (WP-A) would be unreadable for the worker too. | One `DatasetReadToken` per experiment, minted at launch, injected only when the environment's schema declares `QYM_DATASET_READ_TOKEN`, revoked with the API key when the experiment settles, re-minted on retry. UI: a Credentials row, a notice when it was not sent, experiment tokens in the admin list, chips in the launch dataset picker. No launch gate (D3). |
| 5 | No way to ask for a quiet gateway. | `latency_sensitive` on the experiment (checkbox in launch step 1), a per-environment minimum role (D4), a review row and two review messages, a tag on detail / list / queue, and the deferral and contamination state in the jobs table. |

## 2. Backend contract, feature 4 (dataset read token)

Everything in this section is testable with curl and sqlite3 against a platform with `QYM_ROLE=all` and a fake service. Names follow
`services/eval_submitter_keys.py`; the new module is `services/eval_dataset_tokens.py` and copies its structure function by function
(`issue_experiment_dataset_token`, `resolve_dataset_token`, `ensure_dataset_token_for_retry`, `revoke_dataset_token_when_settled`, `DatasetTokenUnavailable`).

| ID | Criterion (endpoint, field, number or exact text) |
|---|---|
| B4-1 | Migration `0088_eval_experiment_dataset_token_latency` has `down_revision = "0087"`. Adds `eval_experiments.dataset_read_token_id VARCHAR(36) NULL` (FK `dataset_read_tokens.id` ON DELETE SET NULL, name `fk_eval_experiments_dataset_read_token_id`, index `ix_eval_experiments_dataset_read_token_id`) and `eval_experiments.dataset_read_token_encrypted TEXT NULL`. |
| B4-2 | The same migration adds `dataset_read_tokens.kind VARCHAR(16) NOT NULL server_default 'admin'` with `CHECK (kind IN ('admin','experiment'))` named `ck_dataset_read_tokens_kind`, and `dataset_read_tokens.experiment_id VARCHAR(36) NULL` (FK `eval_experiments.id` ON DELETE SET NULL, indexed). Every existing row ends with `kind = 'admin'`, `experiment_id = NULL`. Downgrade drops all four columns. Runs on a fresh SQLite (`dev_db.py` metadata) and on Postgres. |
| B4-3 | `POST /v1/projects/{pid}/experiments` (not dry run) creates exactly one `dataset_read_tokens` row per experiment, whatever the job count (a 3-combination sweep: `count(*) = 1`): `name = "Evaluation Service · <experiment name>"` (cut to 200 characters with `…`), `kind = 'experiment'`, `experiment_id`, `project_id` = the experiment's project, `created_by_user_id` = the creator, `prefix` starting `qym_dr_`, only the PBKDF2 hash stored. `eval_experiments.dataset_read_token_id` points at it and `dataset_read_token_encrypted` holds the Fernet blob (`secrets.encrypt_llm_api_key`). |
| B4-4 | A dry run (`dry_run: true`) writes 0 rows to `dataset_read_tokens` and leaves `dataset_read_token_id` and the blob unset (row counts before and after are equal). |
| B4-5 | No API response ever contains the token: `GET .../experiments`, `GET .../experiments/{id}`, `GET .../eval-queue`, `GET .../dataset-read-tokens`, the launch response and the dry-run `request_body` contain 0 occurrences of `qym_dr_` followed by 8 or more token characters, and of the decrypted value. The columns `request_body`, `remote_result`, `error`, `wait_reason`, `remote_versioning` and `eval_experiments.spec` contain 0 occurrences too (checked by a pytest that decrypts the blob and greps every text column). |
| B4-6 | Injection: `_submit_body` sets `body["env_overrides"]["QYM_DATASET_READ_TOKEN"]` to the decrypted token **only when** the job's stored schema (`job.schema_id`) declares the property `QYM_DATASET_READ_TOKEN` in its env-overrides schema. Schema declares it: the job the fake service holds (`GET :9082/__control/jobs`) carries the key with a value starting `qym_dr_`. Schema does not declare it (the repo's fixture `eval_env_overrides_schema.json` does not): the key is absent from the body (a service that does not know the key would answer 422). |
| B4-7 | Platform-owned pointer: a document with `/env_overrides/QYM_DATASET_READ_TOKEN` (any value, also inside a sweep) is rejected by dry run (`200`, `ok: false`) and by launch (`422`) with the error `{"section": "env_overrides", "pointer": "/env_overrides/QYM_DATASET_READ_TOKEN", "code": "platform_owned", "message": "QYM_DATASET_READ_TOKEN is set by the platform; remove it"}`. The value is never echoed in the response. `GET .../eval-config` (descriptor) lists it under `platform_owned.env_overrides` and marks the field `read_only` so the launch form hides it. |
| B4-8 | Scrubbing: `eval_service_client` treats `QYM_DATASET_READ_TOKEN` as sensitive (it already ends in `_token`) and adds the pattern `\bqym_dr_[A-Za-z0-9_-]{8,}` to `_TEXT_SECRET_PATTERNS`; `_scrub_outcome` also removes the literal decrypted value. A fake service that echoes `env_overrides` with the token and an error text that contains it leaves 0 occurrences in `remote_result`, `error`, `wait_reason` and the logs. |
| B4-9 | Revoke timing: when every current job is terminal (BLOCKED does not count) and the last finished at least `KEY_REVOKE_GRACE` (10 minutes) ago, one call of `recompute_experiment_status` or the settle sweep sets `dataset_read_tokens.revoked_at` and clears `dataset_read_token_encrypted`, in the same transaction as the API key revoke (`api_keys.revoked_at`). Inside the grace (9 min 59 s) neither is revoked. The sweep's `WHERE` is `qym_api_key_encrypted IS NOT NULL OR dataset_read_token_encrypted IS NOT NULL`. |
| B4-10 | After revoke, `GET /v1/datasets/{ref}/items` on a private test set with `X-Qym-Dataset-Read-Token: <token>` answers exactly as it does for an unknown token (same status and body as with no header). Before revoke it answers 200. |
| B4-11 | Scope: the live token reads items of every dataset of its project, private test sets and (WP-A) restricted datasets included (`200`); it never writes (`POST .../items` with only the token: 401 or 403, unchanged contract of `token_grants_project`); it does not read a dataset of another project (same answer as an unknown token). |
| B4-12 | Retry (`ensure_dataset_token_for_retry`, called next to `ensure_key_for_retry`): a usable token is re-encrypted into a fresh blob (guarded `UPDATE ... WHERE dataset_read_token_encrypted = <seen>`); a revoked, missing or unreadable token is replaced by a new row and `dataset_read_token_id` moves to it; the old row stays revoked. An experiment launched before this feature (`dataset_read_token_id IS NULL`) gets a token minted on its first retry. A concurrent settle and retry end with exactly one winner, as for the API key. |
| B4-13 | Unusable token at submit: when the schema declares the key and the token is revoked, missing or unreadable, the job becomes `BLOCKED` with `wait_reason` = `error` = `The experiment's dataset read token is unavailable; retry to issue a new one`, and nothing is sent. When the schema does not declare the key the job is not blocked (the token is not needed). When the experiment has no token (launched before the feature) nothing is checked. |
| B4-14 | An admin revokes an experiment token by hand with the existing `DELETE /v1/projects/{pid}/dataset-read-tokens/{id}` (200 as for admin tokens); the experiment's next submit blocks as in B4-13 and a retry re-mints (B4-12). Revoking twice is idempotent (200). |
| B4-15 | `GET /v1/projects/{pid}/dataset-read-tokens` (admin only; a member still gets 403) adds to each item `kind` (`"admin"` \| `"experiment"`) and `experiment` (`{"id", "name"}` or `null`; the name is the experiment's current name, `null` when the experiment was deleted). The order and the other fields are unchanged. |
| B4-16 | `GET /v1/projects/{pid}/experiments/{id}` (any project member) adds `credentials`: `{"api_key": {"state", "revoked_at"}, "dataset_read_token": {"state", "revoked_at"}}`. `state` is `"active"` (id set, `revoked_at` null), `"revoked"` (`revoked_at` set, an API timestamp) or `"none"` (no id: launched before the feature). A settled experiment inside the 10-minute grace is still `"active"`. No other credential field (no prefix, no id) is exposed. |
| B4-17 | Each job of the detail payload adds `dataset_token`: `null` when the experiment has no token, `"sent"` when the job's stored schema declares `QYM_DATASET_READ_TOKEN`, `"not_declared"` when it does not. It is derived from `job.schema_id`, nothing is stored (decision D-B2). |
| B4-18 | Audit: `eval.dataset_token_issued` at launch and at each re-mint (`{experiment_id, token_id}`), `eval.dataset_token_revoked` at settle and at a hand revoke (`{experiment_id, token_id, reason: "settled" \| "manual"}`). Neither entry holds the token. |
| B4-19 | No gate (D3): a project member with launch rights POSTs an experiment whose dataset is `restricted` or a private test set: `200`, token minted, no 403. Dry run answers `200`. |
| B4-20 | Dry-run warning: for each environment whose schema does not declare `QYM_DATASET_READ_TOKEN` and a spec whose dataset is restricted or private, the dry-run response's top-level `warnings` holds `{"code": "dataset_token_not_declared", "environment_ids": [...], "message": "The schema of <env names> does not declare QYM_DATASET_READ_TOKEN, so “<dataset>” (<restricted \| private>) is read with the worker’s own token."}` once (environments joined by `, `). Not a blocker: `ok` stays true. A dataset that is neither restricted nor private produces no warning. |

## 3. Launch: dataset picker (feature 4)

Surface: `launch/entry/DatasetPicker.tsx`, the Dataset card of step 1 and of the home view (`data-testid="launch-dataset"`).
Today (`current-launch-step1-*.png`): the card is 404 x 240 px at 1440 beside the Environments card (the two share the 821 px column pair), the
Select trigger is 362 x 24 px, `--font-md` 11 px label, no per-dataset information. At 1024 and 390 the layout is single-column (cards 777 and 279 px wide, content 735 and 237 px).

Design (`mock-ef-dataset-*`): the Select keeps its 24 px trigger. Each dataset that is `access_mode = restricted` shows a passive `Tag` "Restricted"; a
private test set shows a `Tag` "Private test set" (both neutral, sans, 20 px high), after the name, in the trigger and in every option. Options
keep `--dropdown-option-height` (32 px). Selecting such a dataset adds a help line under the select (`--font-sm`, muted, no icon).
The chip data comes from the WP-A catalog payload (`access_mode`) and the existing `private_test_set`; `LaunchContext.datasetNames` becomes
`datasets: {name, accessMode, privateTestSet}[]` (hand-off, section 11).

| ID | Criterion |
|---|---|
| B4-21 | At 1440, 1024 and 390 the trigger of `getByRole('button', {name: 'Dataset'})` is 24 px high; its width is the card content width (1440: 779 in the gallery frame of the 821 px column; 1024: 735; 390: 237) and `scrollWidth <= clientWidth` (name and chip never clipped). |
| B4-22 | A restricted dataset renders the text `Restricted` in an element `data-testid="dataset-chip"`: 20 px high, 71 px wide, `--font-xs` 10 px / 650, sans; a private test set renders `Private test set`, 99 px wide. Same chip in the trigger and in the open list (3 options of 32 px). Measured identical at 1440, 1024 and 390. |
| B4-23 | The chip sits after the name with 8 px gap (`--space-sm`) and wraps under the name when the name is long (flex-wrap, `overflow-wrap: anywhere` on the name); the dataset name is never truncated (no ellipsis, rendered text equals the dataset name). |
| B4-24 | A dataset with neither flag shows no chip and no help line: the card is exactly the height of today's card (trigger 24 px, 0 extra lines). |
| B4-25 | Help line `data-testid="dataset-token-help"`, `--font-sm` 11 px, `--text-muted`, 0 icons. Restricted text, verbatim: `Restricted dataset. The experiment reads it with its own dataset read token; people without access to the dataset see this run’s scores, not its item contents.` Private text, verbatim: `Private test set. The experiment reads it with its own dataset read token; only admins see its item contents.` Heights: 1 line (15.4 px) at 1440, 2 lines (30.8 px) at 1024 for the restricted text, 4 lines (61.6 px) at 390. |
| B4-26 | No launch gate: a restricted dataset is selectable by any member who can launch; no option is disabled, no lock icon, no error. The review pane shows no problem for it. Loading, empty and error states are today's (`Loading datasets…` disabled select; `No datasets in this project`; the page error state). |
| B4-27 (amended: see D-B17 override) | The listed datasets are every dataset of the project the user may **see** (WP-A hides datasets with level `none` from the catalog; the picker lists the catalog, so D3 means "any dataset the member can see", and the dry-run accepts any dataset slug of the project by name). Decision D-B17. |

## 4. Experiment detail: Credentials row (feature 4) and the Latency-sensitive tag (feature 5)

Surface: `detail/ExperimentDetailPage.tsx`, between the `PageHeader` and the headerActions (`data-testid="exp-credentials"`).
Current state (`current-detail-header-*.png`, `measure/baseline/current-*.json`): `PageHeader` 1193 x 69.2 px at 1440 and 777 at 1024 (title 22/650
26.4 px high, meta line 16.8 px high, 372 px wide, one line); at 390 the header is 279 x 90 px (meta wraps to two lines of 16.8 px). Header actions: Retry failed
and Cancel experiment, 32 px high, 13 px / 600, side by side at 1440/1024, stacked at 390 (231 and 271 px from the top). Jobs card 1193 x 367.5 (1440), 777 x 379.5 (1024), 279 x 753.4 (390).
The page stack gap is `--space-lg` (20 px).

Design (`mock-ef-detail-header-*`): one row below the header, above the actions: the eyebrow `Credentials` then two name + `Badge` pairs
(a `section` with a `dl`; names `--font-base` secondary, badges 20 px). Badge copy: `active` (success), `revoked 12:41` (neutral; `HH:mm` for today,
`20 Oct 12:41` for another day, the absolute timestamp in the `title`), `not issued` (neutral; launched before the feature), `not sent` (warning; the token
exists but no job's schema declares it). A `Callout tone="info"` follows when some job did not get the token; `tone="warning"` when the token was revoked
while jobs still need it. Visible to every project member (no secret is shown).

| ID | Criterion |
|---|---|
| B4-28 | The row is a `section` named `Credentials` containing a `dl` with exactly two `dt`: `API key` and `Dataset read token` (in this order), each followed by one `dd` holding one `Badge`. At 1440 and 1024 the section is one line, 20 px high (mock 1163 / 777 px frame), `align-items: center`, gap 14 px between pairs (`--space-md`), 8 px inside a pair (`--space-sm`). |
| B4-29 | At 390 the eyebrow takes its own line and the two pairs wrap under it: section height 63.4 px (measured), width 279, 0 px horizontal overflow, no name truncated. |
| B4-30 | Badge text and tone: active + active: `active`, `active` (success, 55.9 px wide, 20 px high, `--font-xs` 10/650 uppercase by the Badge recipe). Revoked: `revoked 12:41` neutral, 98.6 px wide. Launched before the feature: API key `active`, token `not issued` neutral, 80.7 px wide. Token exists, never sent to any environment: `not sent`, warning tone. The `API key` badge is `not issued` only when `credentials.api_key.state = "none"`. |
| B4-31 | The row appears for every experiment (any status, any role, archived project included, where it is read only). While the detail query is loading the row is not rendered (the page skeleton is today's); on a failed load the page error state replaces the page (today's). The row never shows a prefix, an id or a copy button. |
| B4-32 | The `exp-header-mock` frame (PageHeader + Credentials row, no notice) is 129.2 px high at 1440 and 1024 and 193.4 px at 390 (221.4 px when the Latency-sensitive tag wraps under the title, B5-49). The row itself adds 40 px at 1440 and 1024 (20 px gap + 20 px row) and 83.4 px at 390 (20 px gap + 63.4 px row). |
| B4-33 | Notice for a token that was not sent, tone info, `role="note"`, 1 callout per experiment (not per job), verbatim for one environment: `Dataset read token not sent to staging: the environment’s schema does not declare QYM_DATASET_READ_TOKEN. Its jobs read datasets with the Evaluation Service’s own token.` For several: `Dataset read token not sent to staging, production: the environments’ schemas do not declare QYM_DATASET_READ_TOKEN. Their jobs read datasets with the Evaluation Service’s own token.` Environments are the ones with at least one job whose `dataset_token = "not_declared"`, names in table order joined by `, `; `QYM_DATASET_READ_TOKEN` is a mono span. |
| B4-34 | Notice heights: one environment 34.8 px (1 line) at 1440, 34.8 at 1024, 51.6 px (3 lines) at 390; several environments 36 px at 1440, 52.8 px at 1024, 103.2 px at 390. Callout width = page width (1193 / 777 / 279). |
| B4-35 | Revoked while still needed: when `dataset_read_token.state = "revoked"` and at least one current job is `BLOCKED` with the B4-13 reason, a `Callout tone="warning"` reads verbatim `Dataset read token revoked 12:41. Retry the blocked jobs to issue a new one.` (the time is the badge's). Not shown for a settled experiment (revoked is normal there). |
| B4-36 | The notice and the warning never appear together; the warning wins. Neither appears for a job whose `dataset_token` is `null` (launched before the feature) or `"sent"`. |
| B4-37 | The jobs table shows the B4-13 reason in the status cell like any error (red secondary line, one line with an ellipsis and the full text in `title`; this is today's behaviour for errors and is not changed); the full text is visible without hover in the warning of B4-35. |
| B4-38 | Axe: 0 serious or critical violations on the page with the row, the notice and the warning; the badges' colour is never the only cue (text in every badge). |

## 5. Project Settings: Dataset read tokens (feature 4)

Surface: `shell/settings/ApiKeysTab.tsx`, `ReadTokensCard` (`data-read-tokens`), admins only (unchanged: members and managers do not see the card).
Current state (`current-settings-tokens-*.png`): card 1193 x 289.2 px at 1440 and 777 at 1024 (279 x 320.8 at 390, table becomes cards); columns Name (flex, 599 px at 1440,
183 px at 1024), Prefix 140, Created by 180, Created 130, Status 100; header 34 px, rows 40 px; header text `Dataset read tokens` + one description line.

Design (`mock-ef-tokens-*`): experiment tokens are ordinary rows of the same table. The Name cell is a `TwoLine`: primary = name followed by a passive neutral `Tag`
`experiment` (20 px, 69.6 px wide); secondary = a link `Experiment · <name>` (11 px, accent, to the experiment detail page). Admin tokens keep a one-line cell.
The card description becomes `Admin-issued; lets a service read private test sets (QYM_DATASET_READ_TOKEN). Experiment tokens are issued at launch and revoked when the experiment settles.`

| ID | Criterion |
|---|---|
| B4-39 | The table keeps the five columns and widths above; the Name column adds no new column. Row height 40 px for admin and experiment rows at 1440 (measured 40, 40, 40; header 34). At 1024 an experiment row is 56.9 px high when the name, tag and link wrap (admin row 40); at 390 the table is a card list (no `row` roles). |
| B4-40 | An experiment row shows `Tag` text `experiment` (`data-testid="token-kind-chip"`, 69.6 x 20 px, neutral) and a link (`data-testid="token-experiment-link"`, 139 x 14 px at 11 px / 400) with text `Experiment · <name>` and `href` = the experiment detail path; an admin row shows neither. When the experiment was deleted (`experiment: null`) the secondary line reads `Experiment deleted` in `--text-muted`, no link. |
| B4-41 | The row's Status badge: `active` (success) or `revoked` (neutral), unchanged. The row action `Revoke <name>` (icon `close`, danger) shows for every live token, experiment tokens included. |
| B4-42 | Revoke confirm for an experiment token (verbatim). Title: `Revoke “Evaluation Service · timeout sweep”?` Body: `Jobs of this experiment that have not read their dataset yet will fail until you retry them; the retry issues a new token.` Button `Revoke token` (danger, starts on Cancel). Toast on success: `Token revoked`. Admin tokens keep their text (`Services using this token lose access to private datasets.`). |
| B4-43 | Experiment tokens are never creatable here: the `Create token` form and its secret-reveal dialog are unchanged and create `kind = 'admin'` only. No experiment token value is ever shown. |
| B4-44 | States unchanged: loading (nothing until the list resolves, as today), empty `No read tokens.`, error `Couldn’t load tokens` with Retry, archived project (the form hides, Revoke stays), non-admin (card absent). |
| B4-45 | The list is not paginated today; an experiment per launch makes it grow: the route returns at most the 200 newest tokens ordered by `created_at` descending, admin tokens first only when created later. (A project with more than 200 sees the newest 200; recorded as limit L-B2.) Revoked experiment tokens older than 30 days are still listed. |
| B4-46 | The description text is exactly the string above, `Text variant="sm"` muted, on one line at 1440 (card header 289.2 px total with 3 rows, unchanged for an empty experiment set). |

## 6. Backend contract and surfaces, feature 5 (latency-sensitive runs)

### 6.1 Backend

| ID | Criterion |
|---|---|
| B5-1 | Migration 0088 also adds `eval_experiments.latency_sensitive BOOLEAN NOT NULL server_default false`; `eval_environments.latency_sensitive_min_role VARCHAR(10) NOT NULL server_default 'member'` with `CHECK (latency_sensitive_min_role IN ('member','manager'))` named `ck_eval_environments_latency_min_role`; and on `eval_experiment_jobs`: `admitted_at DATETIME NULL`, `deferrals INTEGER NOT NULL server_default 0`, `deferral_reason VARCHAR(500) NULL`, `contaminated_attempts INTEGER NOT NULL server_default 0` (decision D-B3). Existing rows get `false`, `'member'`, `NULL`, `0`, `NULL`, `0`. |
| B5-2 | `ExperimentCreateRequest.latency_sensitive: bool = False`. The experiment payloads (create response, list items, detail, queue jobs under `latency_sensitive`) carry the stored boolean. `GET .../experiments` of experiments created before the feature returns `false`. |
| B5-3 | Environment payload (`GET/POST/PUT .../eval-environments`) carries `latency_sensitive_min_role` (default `"member"`); `PUT` accepts `"member"` and `"manager"` and answers `422` for any other value; only a project manager or admin may `PUT` (a member keeps getting 403 as today). The launch context carries `latencySensitiveMinRole` per environment. |
| B5-4 | Gate (D4), real launch with `latency_sensitive: true`: for every selected environment with `latency_sensitive_min_role = 'manager'`, a launcher who is neither project manager nor admin gets `403` with detail exactly `Latency-sensitive runs on production need a project manager` (several environments: names joined by `, `, same sentence: `Latency-sensitive runs on staging, production need a project manager`). Nothing is created (0 experiments, 0 tokens, 0 keys). |
| B5-5 | The same check in dry run answers `200` with `ok: false` and `errors` containing `{"section": "document", "pointer": "/latency_sensitive", "code": "latency_sensitive_role", "message": "<the B5-4 sentence>"}` (a blocking review item). A manager or admin, an environment with `'member'`, and a request with `latency_sensitive: false` against a managers-only environment all pass (`200`). |
| B5-6 | Retry re-checks the gate like HIGH: retrying a job of a latency-sensitive experiment on an environment that is now `'manager'` as a non-manager answers `403` with the B5-4 sentence for that environment. |
| B5-7 | Body field: the dispatcher's submit body has top-level `"latency_sensitive": true` when the experiment flag is true and **omits** the field when it is false (older services answer 422 on unknown fields; decision D-B7). The dry-run `request_body` preview shows it when true. |
| B5-8 | `latency_sensitive` joins `PLATFORM_OWNED_BODY_FIELDS`: a raw document with a top-level `latency_sensitive` is rejected (`platform_owned`, pointer `/latency_sensitive`, message `latency_sensitive is set by the platform; remove it`), in dry run (`ok: false`) and launch (`422`). |
| B5-9 | Dry-run warning: when the flag is on, an environment's schema declares `EVAL_VLLM_POST_RUN_MAX_REQUESTS` and the document leaves `/env_overrides/EVAL_VLLM_POST_RUN_MAX_REQUESTS` unset (absent, `null`, or not set in at least one swept combination), the dry-run top-level `warnings` holds `{"code": "vllm_ceiling_unset", "pointer": "/env_overrides/EVAL_VLLM_POST_RUN_MAX_REQUESTS", "environment_ids": [...], "message": "No post-run request ceiling: steady foreign load would be accepted and skew latency (guide §2.2)"}` once. `ok` stays true; launch is not blocked. No warning when the flag is off, when the schema does not declare the variable, or when it is set. |
| B5-10 | `warnings` is a new top-level array of the dry-run response (shared with B4-20); each item has `code`, `message` and optional `environment_ids`; ordered by the codes `vllm_ceiling_unset`, `dataset_token_not_declared`. Absent or `[]` when none (the field exists in every dry-run response). |
| B5-11 | Poll storage: on each poll of a job the dispatcher copies `EvalJobRead.admitted_at`, `deferrals`, `deferral_reason`, `contaminated_attempts` into the four job columns (`admitted_at` becomes `NULL` again on a deferral or re-queue, as the service does). `deferral_reason` goes through `_redacted_text` and is cut to 500 characters. A poll with unchanged values writes nothing (the job's `updated_at` does not move). A service that returns none of the fields (older) leaves `0`/`NULL`. |
| B5-12 | The detail payload (`jobs[]`) and the queue payload (`jobs[]`) carry `admitted_at` (API timestamp or null), `deferrals`, `deferral_reason`, `contaminated_attempts`. |
| B5-13 | A job that the service finishes `FAILED` with `error` ending `giving up after <N> discarded run(s)` keeps that text in `job.error` and `contaminated_attempts = N`. A contaminated re-queue puts the job back to `QUEUED`/`SUBMITTED` per the existing remote-status mapping with `error` = the service's reason until the next attempt starts. |
| B5-14 | List filter: `GET /v1/projects/{pid}/experiments?latency_sensitive=true` returns only flagged experiments (`total` counts only them); `=false` only unflagged; omitted returns all. Same parameter on `GET .../eval-queue` (jobs of flagged experiments only; `total` follows). Any other value: 422. |
| B5-15 | Queue environment summaries carry `latency_active: true` iff a local job of a flagged experiment is in an active status on that environment (same query as `high_active`). |
| B5-16 | Clone: the clone source payload (`?clone=<id>`) carries `latency_sensitive` and the launch form starts with the source's value (the gate still applies at launch). |
| B5-17 | Audit: the launch audit entry (`eval.experiment_created`) records `latency_sensitive`; an environment update that changes the role records `{before, after}` in the existing `eval.environment_updated` entry. |
| B5-18 | A latency-sensitive launch never changes priority, queue order or the HIGH rules: `priority` is stored and sent as today; the flag is orthogonal (a `HIGH` + latency experiment is valid). |
| B5-19 | Performance: the list and queue routes issue the same number of SQL statements with and without the filter and with 1 and 200 flagged experiments (no N+1; the flag is a column of the already loaded row); rows written by a GET = 0. |
| B5-20 | Environments page: `GET .../eval-environments` lists `latency_sensitive_min_role` for every environment; changing it does not reset health, schema or presets. |
| B5-21 | Member vs manager on the context: `GET .../experiments/launch-context` (or the existing launch bootstrap) carries `canManage` already used by the HIGH rule; the UI computes the disabled state of B5-30 from it and the per-environment role, never from a failed request. |
| B5-22 | The flag is immutable after launch (no PATCH route accepts it); clone and retry carry it. |

### 6.2 Launch step 1: Run settings

Surface: `launch/entry/RunSettings.tsx` inside the `Card aria-label="Name and priority"` of `EntryBlock` (wizard step 1, `?step=where`).
Today (`current-launch-run-settings-*.png`): card 821 x 192.2 px at 1440 (777 at 1024, 279 x 286.3 at 390); row 1 is a 2fr / 1fr grid: Experiment name input 506 x 24 px, Priority select 253 x 24 px (at 1024: 476.7 and 238.3; at 390 stacked, 237 each);
row 2 the Versioning textarea 779 x 72 px with its 15.4 px help line. Labels `--font-md` 11 px / 600, help `--font-sm` 11 px muted.
The home view's short path (`LaunchHome`) has no Run settings; the flag lives only in step 1 (decision D-B6).

Design (`mock-ef-run-settings-*`): a `Checkbox` `Latency-sensitive run` directly under the name / priority row, full width of the card (the checkbox with its helper does not fit the 253 px Priority column: decision D-B5),
helper under it in the `checkHelp` recipe of the environment page (`--font-sm`, muted, inline-start padding 24 px = `--space-lg + --space-xs`); a `Callout tone="warning"` when checked.

| ID | Criterion |
|---|---|
| B5-23 | `getByRole('checkbox', {name: 'Latency-sensitive run'})` exists in step 1 below the name/priority row and above Versioning details; unchecked by default; 16.8 px high label row, box 14 px. Present at 1440, 1024 and 390 (stacked layout: after the Priority select). |
| B5-24 | Helper text, verbatim, `--font-sm` 11 px, `--text-muted`, element directly after the checkbox: `Starts only when the gateway is quiet, makes other jobs wait while it runs, and is discarded and re-queued if foreign traffic overlaps. Expect a later start.` Its inline-start padding is 24 px. Height: 15.4 px (1 line) at 1440, 30.8 px (2 lines) at 1024, 61.6 px (4 lines) at 390. |
| B5-25 | Card height, flag off: 236.4 px at 1440, 251.8 px at 1024, 376.7 px at 390 in the 821 / 777 / 279 px gallery frame (today's 192.2 / ~207 / 286.3 px plus the checkbox row 16.8, gap 8 and the helper). The Priority select and the name input keep 253 / 506 px (1440) and 238.3 / 476.7 px (1024). |
| B5-26 | Checked: a `Callout tone="warning"` (`role="note"`, border `--warning` 55%) with title `Other jobs wait while this run executes`, indented 24 px under the helper: 755 px wide and 34.8 px high at 1440 (card 279.2 px), 711 x 34.8 at 1024 (card 294.5), 213 x 51.6 at 390 (card 436.3). Unchecked: no callout (the card returns to B5-25's height). |
| B5-27 | Checked by a non-manager when some, not all, selected environments are managers-only: the callout gets the body line, verbatim, `Only a project manager can launch it on production. Clear the box or ask a project manager.` (several environments: `... on production, edge.`); heights 55.6 px at 1440 and 1024, 106 px at 390 (cards 300 / 315.3 / 490.7 px). The checkbox stays enabled. The review pane then carries the blocking item of B5-38. |
| B5-28 | Disabled with a reason: a non-manager whose every selected environment is managers-only sees the checkbox `isDisabled`, unchecked (a checked box is cleared at the moment it becomes disabled), and a line `data-testid="launch-latency-reason"`, `--font-sm` 11 px, `--text-secondary`, 24 px inset, verbatim `Only project managers can launch latency-sensitive runs on production.` (several: `... on production, edge.`). Height 15.4 px at 1440 and 1024, 30.8 px at 390; card 255.8 / 271.1 / 411.5 px. The helper stays. |
| B5-29 | No environment selected, a manager or admin, or no selected environment is managers-only: the checkbox is enabled and no reason line shows. Environments are the ones in `doc.environmentIds`; the computation is a pure function `latencyGate(envs, canManage, selectedIds)` returning `{disabled, reason, managerOnly: string[]}` (Vitest). |
| B5-30 | Archived project (read only): checkbox disabled (opacity .45 by the Checkbox recipe), no reason line, helper shown, card 236.4 px at 1440 (same as off). The existing `This project is archived, so nothing can be launched.` callout is today's. |
| B5-31 | The flag is in the document state (`doc.latencySensitive`), is sent as `latency_sensitive` in dry run and launch, is restored from a clone (B5-16) and from the `?step=where` URL reload (the draft persists as every field of the doc does), and is shown by `Raw JSON` as `latency_sensitive` only in the request preview, never inside the editable document (it is platform-owned, B5-8). |
| B5-32 | Keyboard: Tab order is name, priority, latency checkbox, versioning textarea; Space toggles; the helper is `aria-describedby` of the checkbox and the reason line too when present; the callout is `role="note"` (not announced on change). |
| B5-33 | Axe: 0 serious or critical violations in each of the five mock states (off, on, on-partial, disabled-all, readonly). Contrast of the helper and reason lines >= 4.5 (muted and secondary tokens). |
| B5-34 | At 390 the card and the page do not scroll horizontally (`scrollWidth - clientWidth = 0`); no label or text is clipped; the control heights stay 24 px. |

### 6.3 Review pane

Surface: `launch/review/ReviewPane.tsx`. Today (`current-launch-step1-*.png`): the pane is a 352 px column right of the form at 1440 (536 px high with 3 problems), stacked full width below it
at 1024 (777 px) and 390 (279 px). The Summary `KeyValueGrid` has one row per fact, 36.2 px high at every width (Environments, Dataset, Start from, Priority, Versions), 44 px pitch.

| ID | Criterion |
|---|---|
| B5-35 | Flag on: the Summary gains the row `Latency-sensitive` = `yes`, after Priority and before Versions, 36.2 px high like its siblings, at 1440, 1024 and 390 (6 rows: 36.2 x 6). Flag off: the row is absent (5 rows, today's pane). |
| B5-36 | Pane height, ready state, flag on: 435.1 px at 1440, 1024 and 390 in the gallery (the pane content does not depend on width until a callout wraps). |
| B5-37 | Blocking item (B5-5): badge `1 problem` (danger), heading `1 problem to fix`, one `ProblemList` button, label `Latency-sensitive`, message `Latency-sensitive runs on production need a project manager`, no pointer line (pseudo pointer `#latency`). 70.4 px high at 1440 (message wraps to 2 lines in the 310 px list), 53.6 px at 1024, 70.4 px at 390; pane 487.5 / 470.7 / 487.5 px. Clicking it focuses the checkbox (`launch-latency` field). |
| B5-38 | The blocking item exists exactly when B5-27's condition holds with the box checked; `Launch` is disabled while it exists (today's rule for problems); clearing the box removes it. |
| B5-39 | Warning `vllm_ceiling_unset`: a `Callout tone="warning"` below the run count with title `Post-run ceiling not set`, body (verbatim) `No post-run request ceiling: steady foreign load would be accepted and skew latency (guide §2.2)` and a `Button size="sm" variant="neutral"` `Set ceiling` that goes to step `settings` and focuses `/env_overrides/EVAL_VLLM_POST_RUN_MAX_REQUESTS`. Heights: 100.4 px (1440), 83.6 px (1024), 117.2 px (390); width = pane content (310 / 735 / 237). |
| B5-40 | Warning `dataset_token_not_declared` (B4-20): `Callout tone="warning"`, title `Dataset read token will not be sent`, body `The schema of staging does not declare QYM_DATASET_READ_TOKEN, so “golden” (restricted) is read with the worker’s own token.` (variable in mono). Heights 90.4 / 56.8 / 107.2 px at 1440 / 1024 / 390. No button. |
| B5-41 | The two warnings render in the order of B5-10, above `Validation`, below the preemption warning when present; they do not change the Badge (`Ready` stays) and do not disable `Launch`. With both: pane 653.8 px (1440), 603.5 px (1024), 687.4 px (390). |
| B5-42 | Loading (`Checking` badge) and error states of the dry run are today's; the warnings are rendered from the last successful dry run and disappear while a new one is pending only if the response replaced them (no flicker: the previous warnings stay until the new response arrives). |

### 6.4 Environment edit form

Surface: `environments/SettingsForm.tsx`, section Policies (`data-section="env-policies"`). Today (`current-env-policies-*.png`): section 1193 x 228.2 px (1440), 777 x 228.2 (1024), 279 x 365.3 (390);
two selects Max priority and Default priority 568.5 px wide each at 1440 (360.5 at 1024, 237 at 390), 24 px high, then the HIGH callout when max is HIGH, then `Allow connection keys` with its help.

Design (`mock-ef-env-form-*`): a third `Select` `Who can launch latency-sensitive runs` in the same `formGrid`, after Default priority, with the help under it.

| ID | Criterion |
|---|---|
| B5-43 | `getByRole('button', {name: /Who can launch latency-sensitive runs/})` exists in Policies; items exactly `Anyone in the project` (`member`, default) and `Project managers only` (`manager`); 24 px high; in the auto-fit grid (`minmax(14em, 1fr)`) it is 364.3 px wide in the 1163 px gallery frame (three columns), 235.7 px at 1024 (three columns), 237 px at 390 (one column, stacked, section 306.1 px high). |
| B5-44 | Help under the select, verbatim, `--font-sm` muted: `Latency-sensitive runs make other jobs on this environment wait. Project managers and admins can change this.` Section height with the third select and help: 160.6 px at 1440, 176 px at 1024, 306.1 px at 390 (gallery frame; the real section adds the HIGH callout and the connection keys block below as today). |
| B5-45 | Dirty tracking: changing the value sets `Unsaved changes` and enables the same `Save changes` as other fields; the body sent is `{"latency_sensitive_min_role": "manager"}` merged into the update; a server `422` maps to the field error `Choose who can launch latency-sensitive runs.`. Toast on save is today's `Saved “<name>”`. |
| B5-46 | Read only (`canEdit = false`, a member or an archived project): the select is rendered, disabled, showing the stored value; 3 disabled selects in the section at every width (measured 3 of 3). The Connection section stays hidden for non-editors (today). |
| B5-47 | Switching the value does not reset health or schema and does not touch presets (B5-20). Existing launches in flight are not affected; the gate applies to launches after the save. |
| B5-48 | The environments list table (`EnvironmentsList`) is unchanged (no new column); the role is visible on the edit form only. |

### 6.5 Experiment detail: tag and jobs table

Surface: `detail/ExperimentDetailPage.tsx` (title row) and `detail/JobHistoryCard.tsx` (Status column). Today (`current-detail-jobs-*.png`):
Job history card 1193 x 367.5 px at 1440; the DataTable has header 34 px, rows 40 px, columns Combo 80, Environment 150, Params 297 (flex), Status 200, Attempt 90, Run 180, Updated 110, Actions 42 (row width 1149);
`minWidth={1000}`, so at 1024 the table scrolls sideways (1000 px of row in 735); at 390 it is a card list. The status cell is `TwoLine`: Badge + optional red error line (11 px, one line, ellipsis, `title`).

Design (`mock-ef-detail-header-*`, `mock-ef-jobs-*`): `Tag tone="info"` `Latency-sensitive` after the status badge in the title row; for a latency-sensitive experiment the Status column is 240 px wide and its second line carries the admission state.

| ID | Criterion |
|---|---|
| B5-49 | Title row: after the experiment status badge a `Tag` (`data-testid="latency-tag"`, text `Latency-sensitive`, info tone, sans, 98.4 x 20 px, `--font-xs` 10/650) exists iff `latency_sensitive`. At 1440 and 1024 it shares the title line (title block height unchanged, 129.2 px frame); at 390 it wraps under the title (title block 54.4 px, page header frame 221.4 px instead of 193.4). |
| B5-50 | Status column width: 240 px for a latency-sensitive experiment, 200 px otherwise (measured `columnheader` Status 240 / 200 at 1440 and 1024). Row heights 40 px for every row (measured 40 x 6 in both tables; header 34). The other column widths are unchanged; the flex Params column absorbs the difference (297 -> 257 px at 1440). |
| B5-51 | `↻ n` tag: when `contaminated_attempts > 0` a `Tag kind="count" tone="info"` after the status badge, text `↻ <n>` (mono, 34 x 20 px for one digit), `aria-label="re-queued <n> times"` (`re-queued 1 time`), only in a latency-sensitive experiment. |
| B5-52 | Secondary line of the Status cell (11 px, `--text-muted`, one line, ellipsis with the full text in `title`; error text red as today). Precedence, first match wins: (1) `job.error` (red); (2) a non-terminal job with `deferrals > 0` and no `admitted_at`: `deferred ×<n> · <deferral_reason>` (for example `deferred ×3 · vllm quiet window`); (3) a `RUNNING` job with `admitted_at`: `admitted 12:52` (`HH:mm`, local, absolute time in `title`); (4) `contaminated_attempts > 0` and not running: `re-queued ×<n> · contaminated`; (5) `wait_reason` for a cancellable job (today's); (6) nothing. The pure function is `admissionLine(job)` (Vitest, exported from `lib/admission.ts`; the mock imports a copy of it). |
| B5-53 | The six mock rows read, in order: `SUCCEEDED ↻1 / re-queued ×1 · contaminated`, `RUNNING / admitted 12:52`, `QUEUED / deferred ×3 · vllm quiet window`, `QUEUED ↻1 / deferred ×1 · gateway quiet window`, `FAILED ↻3 / giving up after 3 discarded run(s)` (red), `BLOCKED / The experiment’s dataset read token is unav...` (red, ellipsis, B4-37). The deferred line fits in 240 px without ellipsis for reasons up to 40 characters; longer reasons end in an ellipsis with the full text in `title` and in the job's `remote` detail. |
| B5-54 | An ordinary experiment (flag off) renders none of B5-51 and B5-52 (2) to (4): rows are identical to today's (status 200 px, error line only). |
| B5-55 | At 390 (card list) the Status field of a card shows the badge, the `↻` tag and the same secondary line under the title `#<n>`; no horizontal overflow (page `scrollWidth - clientWidth = 0`); card heights follow the content (no fixed height). |
| B5-56 | Polling: the table refreshes with the page's existing interval while the experiment is live; a deferral count that increases updates the text without moving the row (row height stays 40 px). |
| B5-57 | Matrix card: unchanged (it shows results, not admission); the job cell's status badge is today's. |
| B5-58 | Loading, empty and error states of the page are today's; the tag is absent while loading (the title row renders with the data). |

### 6.6 Experiments list and queue

Surfaces: `list/ExperimentsPage.tsx`, `queue/QueuePage.tsx`. Today (`current-list-*.png`, `current-queue-*.png`):
list filters group 264.1 x 43.4 px (Status select 150 px, `Created by me` checkbox 100.1 x 16.8 px) at all widths (390: 261 x 74.2, the checkbox on a second line); rows 40 px, header 34, row width 1378 px (the table scrolls inside its 1193 px card);
the Name column is pinned, min 220 px (`TwoLine`: name + description). Queue: rows 40 px, job column 309 px at 1440 and 200 px at 1024 (`jobTitle` flex with a `HIGH` tag, 40 px); environment cards 589.5 x 131.4 px (1440), 381.5 x 146.8 (1024), 279 x 90 and 146.8 (390); the staging card carries the HIGH note.

| ID | Criterion |
|---|---|
| B5-59 | List name cell: for a flagged experiment the primary line is `name` followed by the `Latency-sensitive` Tag (98.4 x 20 px, 8 px gap, `flex-wrap`). Rows keep 40 px at 1440 and 1024 for names up to 16 characters (measured rows 40, 40, 40, 40); a longer name wraps the tag under it and the row grows with the text (limit L-B1). Unflagged rows are unchanged. |
| B5-60 | List filter: a `Checkbox` `Latency-sensitive only` after `Created by me` in the `Filter experiments` group (141.9 x 16.8 px), URL `?latency=1` (removed when off), sent as `latency_sensitive=true`; the page resets to page 1 as every filter does. Checked: only flagged rows (3 of 4 in the mock), footer count follows (`3 experiments`). |
| B5-61 | The filter counts as a filter (`isFiltered`): with it on and 0 results the filtered empty state shows today's `No matching experiments` / `Nothing matches these filters.` and `Clear filters` clears `latency` too. |
| B5-62 | At 390 the filter group wraps like today (group 74.2 px high with two checkboxes; a third adds one 16.8 px line + 8 px gap); the table is a card list and the tag sits after the name in the card title, wrapping under it when needed. 0 px horizontal overflow. |
| B5-63 | Queue job cell: for a flagged experiment `Tag` `Latency-sensitive` after the name link and after the `HIGH` tag when both apply (order: name, HIGH, Latency-sensitive), 8 px gaps, wrap allowed. Rows 40 px at 1440 and 1024 for the seeded names (measured 40, 40, 40). |
| B5-64 | Queue filter: a `Checkbox` `Latency-sensitive only` after `Only my jobs` in `Queue filters`, URL `?latency=1`, API `latency_sensitive=true` (B5-14). Counts in the topbar and the `jobs` meta follow the response `total`. |
| B5-65 | Queue environment card: when `latency_active`, a note under the counts, same recipe as the HIGH note (`--font-sm` 11 px, warning colour on a 1 px warning border, `--control-radius`), verbatim `A latency-sensitive job is active on staging. Other jobs wait until it finishes.` Heights: 25.4 px at 1440 and 1024, 40.8 px at 390 (two lines). When both HIGH and latency are active both notes show, HIGH first. |
| B5-66 | The note is `role="note"` text, not a toast; it disappears on the next poll after the job ends (the queue's 5 s backoff poll). |
| B5-67 | Keyboard: the new checkboxes are in the filter group's Tab order after `Created by me` / `Only my jobs`; the tags are not focusable (passive). |
| B5-68 | Tag recipe check: every `Latency-sensitive` tag on every surface (detail title, list, queue, and the review row is text not a tag) is the same `Tag tone="info"`, 98.4 x 20 px, sans; no page defines its own. |
| B5-69 | Axe: 0 serious or critical violations on list, queue, detail and environment form with the new elements present. |
| B5-70 | The Columns menu and density controls are unaffected (no new column anywhere in this feature). |

## 7. Shared criteria (both features)

| ID | Criterion |
|---|---|
| B-S1 | Design test: `cd frontend && npm run test:design` and `pytest tests/platform/test_design_language.py` pass with the new code: tokens only, no hex, no `font-size` px, no `rgba()`, no `--text-dim` on readable text, no new `Callout`/`Tag` restyle. |
| B-S2 | `cd frontend && npm run check` passes (typecheck, eslint, stylelint, vitest, design). |
| B-S3 | Every new string of sections 2 to 6 appears once, verbatim, in a single `copy.ts` per area (`launch/copy.ts`, `detail/copy.ts`, `environments/copy.ts`) so tests and the reviewer compare one source. |
| B-S4 | Voice: sentences, no exclamation marks, numbers in the sentence, sentence-case labels, mono only for the variable names and counts. |
| B-S5 | No new `--font-*` use outside Badge/Tag: the new rows use `--font-sm` (helper, reason, notes), `--font-base` (names, callout bodies) and the Tag/Badge recipes. |
| B-S6 | No overlay on content: the notices are flow elements; nothing is positioned over text. |
| B-S7 | Names are never truncated: dataset names, environment names in notices, experiment names in tokens wrap; only error secondary lines of the jobs table keep their existing ellipsis (B4-37, B5-53). |
| B-S8 | Layout does not shift when state arrives: the Credentials row is rendered with the experiment detail (same query), the status cell keeps 40 px rows, the launch card grows only by the rows named in B5-25 to B5-28. |
| B-S9 | Keyboard and screen reader: every new control reachable by Tab, labelled, no focus trap; tags and badges carry text. |
| B-S10 | Archived project: no new write control is enabled (checkbox disabled, role select disabled, token Revoke follows today's archived rule). |
| B-S11 | Permission denied: a member opening Project Settings does not see Dataset read tokens (unchanged); a member PUTting the environment role gets 403 and the form is read only. |
| B-S12 | Responsive: at 390 no page of this feature scrolls horizontally (`documentElement.scrollWidth - clientWidth = 0` measured on all eight gallery cases: 0). |
| B-S13 | Docs: `docs/USER_GUIDE.md` (experiments: latency-sensitive; credentials), `docs/internal/EVAL_SECURITY_CHECKLIST.md` (token lifecycle, platform-owned pointer, scrubbing), `docs/internal/DB_SCHEMA.md` (the new columns) updated by the implementer. |
| B-S14 | Migration order: 0088 is written against `down_revision = "0087"` (WP-A) and verified on a fresh SQLite and, with `QYM_TEST_POSTGRES_URL`, on Postgres at integration. |

(The count in section 0 is 130: B4-1 to B4-46, B5-1 to B5-70, B-S1 to B-S14.)

## 8. Copy table (all new strings, verbatim)

| Where | Text |
|---|---|
| Launch checkbox | `Latency-sensitive run` |
| Launch helper | `Starts only when the gateway is quiet, makes other jobs wait while it runs, and is discarded and re-queued if foreign traffic overlaps. Expect a later start.` |
| Launch callout title | `Other jobs wait while this run executes` |
| Launch callout body (manager-only envs, member) | `Only a project manager can launch it on <env list>. Clear the box or ask a project manager.` |
| Launch disabled reason | `Only project managers can launch latency-sensitive runs on <env list>.` |
| 403 / blocking item | `Latency-sensitive runs on <env list> need a project manager` |
| Review row | `Latency-sensitive` = `yes` |
| Ceiling warning | title `Post-run ceiling not set`; body `No post-run request ceiling: steady foreign load would be accepted and skew latency (guide §2.2)`; button `Set ceiling` |
| Token warning | title `Dataset read token will not be sent`; body `The schema of <env list> does not declare QYM_DATASET_READ_TOKEN, so “<dataset>” (<restricted or private>) is read with the worker’s own token.` |
| Dataset chips | `Restricted`, `Private test set` |
| Dataset help | see B4-25 |
| Credentials | eyebrow `Credentials`; `API key`, `Dataset read token`; badges `active`, `revoked 12:41`, `not issued`, `not sent` |
| Token notices | see B4-33, B4-35 |
| Detail tag | `Latency-sensitive` |
| Status cell | `deferred ×<n> · <reason>`, `admitted <HH:mm>`, `re-queued ×<n> · contaminated`, `↻ <n>` with `aria-label` `re-queued <n> times` |
| Blocked reason | `The experiment’s dataset read token is unavailable; retry to issue a new one` (backend text uses a straight apostrophe like `KEY_UNAVAILABLE`) |
| Environment form | label `Who can launch latency-sensitive runs`; items `Anyone in the project`, `Project managers only`; help `Latency-sensitive runs make other jobs on this environment wait. Project managers and admins can change this.`; field error `Choose who can launch latency-sensitive runs.` |
| List / queue filters | `Latency-sensitive only` |
| Queue note | `A latency-sensitive job is active on <env>. Other jobs wait until it finishes.` |
| Tokens | tag `experiment`; link `Experiment · <name>`; `Experiment deleted`; card description and revoke confirm: see B4-39 to B4-42 |

## 9. Decisions (reason, how to reverse)

| ID | Decision | Reason | Reverse |
|---|---|---|---|
| D-B1 | `dataset_read_tokens.experiment_id` (FK, SET NULL) next to `kind`. | The token list needs the experiment link, and a re-mint on retry would otherwise lose it for the old revoked token. | Derive the link by joining `eval_experiments.dataset_read_token_id`; drop the column. |
| D-B2 | The "not sent" notice is derived at read time from `job.schema_id`; one callout per experiment; no per-job detail surface exists today. | Nothing to store or migrate; visible without a click (density rule). | Store a boolean per job at submit and render it per job. |
| D-B3 | Four columns on `eval_experiment_jobs` instead of putting admission data in `remote_result`. | `remote_result` is the final service result (written only at `SUCCEEDED`) and is returned to the browser as the result panel; admission state changes on every poll. | Move the four values into a JSON key of `remote_versioning` or `remote_result`. |
| D-B4 | Admission text goes in the Status cell's second line (as the owner's design says), Status column 240 px for latency experiments; a `↻ n` count tag carries re-queues. | A separate column would add 190 px to a table that already scrolls at 1024; the secondary line keeps rows at 40 px. | Add an `Admission` column and revert to 200 px. |
| D-B5 | The checkbox sits under the name / priority row at card width, not inside the 253 px Priority column. | The helper (4 lines at 253 px) would make the name/priority row taller and misalign the two inputs. | Put it in a third column of row 1 at 1440 and keep the helper as a tooltip (rejected: a tooltip hides default information). |
| D-B6 | The flag is set in wizard step 1 only; the home short path and "Launch as is" cannot set it (default false); a clone carries it. | The short path is "where, what, a name"; a flag that makes other jobs wait deserves the helper text and the callout. | Add the checkbox to `HomeBar`. |
| D-B7 | The body field is sent only when true. | Older services reject unknown top-level fields with 422. | Always send the boolean once all services are on v1.3. |
| D-B8 | Dry run gets a top-level `warnings` array (codes `vllm_ceiling_unset`, `dataset_token_not_declared`). | Per-job `warnings` exist but the review pane shows none; the two new messages are launch-level. | Fold them into per-job `warnings` and aggregate in the client. |
| D-B9 | A retry of an experiment launched before the feature mints a token. | Otherwise old experiments cannot read restricted datasets on retry. | Skip minting when `dataset_read_token_id IS NULL`. |
| D-B10 | A missing, revoked or unreadable token blocks the job only when its schema declares the key. | A service that does not know the key needs no token; blocking it would only add failures. | Block whenever the experiment has a token. |
| D-B11 | `/env_overrides/QYM_DATASET_READ_TOKEN` is platform-owned: presets that already set it fail validation until the key is removed; the form hides the field. | One owner of the value; a user-supplied token would silently override the per-experiment one. | Allow a user value to win over the minted token. |
| D-B12 | List and queue filters are `Checkbox` `Latency-sensitive only` (URL `latency=1`), not `Chip`. | Both pages already use a checkbox for boolean filters (`Created by me`, `Only my jobs`); a Chip is for multi-value filters. | Use a `Chip` with a count. |
| D-B13 | The `Restricted` / `Private test set` / `experiment` labels and the Latency-sensitive label are passive `Tag`s, not `Chip`s. | DESIGN_LANGUAGE: a Chip is an interactive filter; passive metadata is a Tag. WP-A's catalog label should use the same Tag recipe (hand-off note). | Switch to `Chip` if WP-A ships one. |
| D-B14 | The queue shows the environment note `A latency-sensitive job is active on <env>...` (`latency_active`). | The HIGH note exists for the same reason ("other jobs wait") and the owner asked for queue visibility. | Drop the note and the field. |
| D-B15 | Every experiment gets a token (not only those on restricted or private datasets). | The dataset can be changed in a sweep or a preset after the user looked; one token per experiment is cheap and uniform. | Mint only when the dataset is restricted or private at launch. |
| D-B16 | The token list returns the newest 200 rows. | Experiments now add a row per launch; an unbounded list would grow without limit. | Add pagination and a `kind` filter (follow-up). |
| D-B17 | The launch picker lists the catalog the user may see; D3 means no gate on naming a dataset, not visibility of datasets with access level `none`. | WP-A hides those from the catalog; a hidden dataset cannot be picked in the UI, the API still accepts its name (decision recorded for WP-A). | List every dataset of the project with a lock icon. |
| D-B17 (amended, owner override at implementation) | **Overridden by owner decision D3**: the launch picker lists EVERY non-deleted dataset of the project, restricted or private, each with its badge, because any member may launch on any dataset. It does not depend on WP-A's catalog filtering: `GET /v1/projects/{pid}/experiments/launch-datasets` returns `{id, name, slug, private_test_set, access_mode}` by a plain query (`access_mode` is read with `getattr(dataset, "access_mode", "project")` until migration 0087 lands). B4-27 reads accordingly: the picker lists every dataset of the project. | Any member can launch on any dataset; nothing is hidden by a missing grant. | Filter the route by the caller's dataset access level (needs WP-A). |
| D-B18 | Credentials are visible to every project member. | They hold state only (no secret, no prefix). | Show to managers and the creator only. |
| D-B19 | A retry gate (B5-6) mirrors HIGH. | A retry is a new launch of the job. | Check only at launch. |

Limits recorded: L-B1 (a long experiment name wraps the list tag and the row grows), L-B2 (token list capped at 200).

## 10. Not measured in this design stage

- The post-launch states (token active / revoked / not sent, admission text, contamination) cannot be produced by the fake services (they declare neither
  `QYM_DATASET_READ_TOKEN` nor `EVAL_VLLM_POST_RUN_MAX_REQUESTS` and never defer): they are drawn in the gallery mocks only. The implementer extends
  `frontend/scripts/fake_eval_service.py` (a schema variant declaring both keys, `/__control/jobs/{id}` accepting `deferrals`, `deferral_reason`, `admitted_at`, `contaminated_attempts`).
- The backend criteria (B4-1 to B4-20, B5-1 to B5-22) are specified from the code read (`eval_submitter_keys.py`, `eval_dispatcher.py`, `experiments.py`, `eval_config.py`, `eval_service_client.py`) and
  cannot be curl-tested before the implementation; the reviewer tests them then.
- Member (non-manager) states were not captured live: the dev platform runs `QYM_AUTH_MODE=none` (everyone is an admin); the member and archived states are mock frames.
- Python 3.12 of the shared `.venv` is gone from the host (OS upgrade): the platform ran on a throw-away Python 3.9 venv in the scratchpad (`pip install -e packages/sdk -e packages/platform`).
- Real column widths of the Review pane at 1440 are the app's 352 px; the gallery frame is also 352 px.

## 11. Test plan

| Test | Covers |
|---|---|
| `tests/platform/test_eval_dataset_tokens.py` (new; stub service as in `test_experiments_api.py`) | B4-1 to B4-20 (mint, dry run, grep for secrets, injection with and without schema key, platform-owned, scrub, revoke timing with an injected clock, retry races, admin revoke, scope, token list payload, credentials payload, audit, no gate, warning) |
| `tests/platform/test_experiment_latency_sensitive.py` (new) | B5-1 to B5-22 (columns, request field, gate 403 text and dry-run item, retry gate, body field, platform-owned, warnings, poll storage and no-op writes, payload fields, list and queue filter, `latency_active`, clone, N+1 guard) |
| `tests/platform/test_migrations_0088.py` or the existing migration chain test | B4-1, B4-2, B5-1, B-S14 |
| `frontend/src/features/experiments/launch/__tests__/RunSettings.latency.test.tsx` | B5-23 to B5-34 (states, copy, disabled reason, keyboard, axe) |
| `frontend/src/features/experiments/launch/model/latencyGate.test.ts` | B5-29 (pure function) |
| `frontend/src/features/experiments/launch/__tests__/ReviewPane.latency.test.tsx` | B5-35 to B5-42 |
| `frontend/src/features/experiments/launch/__tests__/DatasetPicker.chips.test.tsx` | B4-21 to B4-27 |
| `frontend/src/features/experiments/lib/admission.test.ts` | B5-52, B5-53 (precedence table, `HH:mm`, reason cut) |
| `frontend/src/features/experiments/detail/Credentials.test.tsx` | B4-28 to B4-38 |
| `frontend/src/features/environments/__tests__/SettingsForm.latency.test.tsx` | B5-43 to B5-48 |
| `frontend/src/features/shell/settings/ApiKeysTab.experiment-tokens.test.tsx` | B4-39 to B4-46 |
| `frontend/e2e/experiments/launch/latency-sensitive.spec.ts` | B5-23 to B5-42 against the fake service (measures the numbers of section 6.2 and 6.3 at 1440, 1024, 390) |
| `frontend/e2e/experiments/credentials.spec.ts` | B4-28 to B4-38, B5-49 to B5-58 (needs the extended fake) |
| `frontend/e2e/experiments/lists-latency.spec.ts` | B5-59 to B5-70 |
| `frontend/e2e/environments/latency-role.spec.ts` | B5-43 to B5-48 |
| `frontend/e2e/shell/dataset-read-tokens.spec.ts` | B4-39 to B4-46 |
| `cd frontend && npm run test:design`, `pytest tests/platform/test_design_language.py` | B-S1, B-S2 |

## 12. Hand-off for the implementer (build order)

1. **Migration** `packages/platform/qym_platform/migrations/versions/0088_eval_experiment_dataset_token_latency.py` (`down_revision = "0087"`): the columns of B4-1, B4-2, B5-1; models in `db/models.py` (`EvalExperiment`, `EvalExperimentJob`, `EvalEnvironment`, `DatasetReadToken`); `frontend/scripts/dev_db.py` follows the metadata.
2. **Service** `services/eval_dataset_tokens.py` (copy of `eval_submitter_keys.py`; `issue_token` variant that flushes instead of committing); hook it in `eval_experiments.py` launch, `recompute_experiment_status` and the dispatcher settle sweep (`eval_dispatcher.py`: `_submit_body`, the resolve step, `BLOCKED` text), retry in `api/experiments.py`; `services/dataset_read_tokens.py` unchanged except `issue_token` accepting `kind` and `experiment_id`.
3. **Config and scrubbing**: `services/eval_config.py` (`PLATFORM_OWNED_ENV_OVERRIDES`, `PLATFORM_OWNED_BODY_FIELDS += latency_sensitive`, descriptor `platform_owned.env_overrides`, the form field `read_only`), `services/eval_service_client.py` (`_TEXT_SECRET_PATTERNS`, literal scrub), `eval_dispatcher._scrub_outcome`.
4. **API**: `api/experiments.py` (`latency_sensitive` field and gate, dry-run `warnings`, payloads `credentials`, job `dataset_token`, admission fields, list filter), `api/eval_environments.py` (`latency_sensitive_min_role` in create/update/payload), `api/eval_queue.py` + `services/eval_queue.py` (filter, `latency_active`), `api/projects.py` (token list payload `kind`, `experiment`, cap 200), audit entries.
5. **Poll storage** in the dispatcher's poll path (four job columns, no-op on equal values).
6. **Fake service** `frontend/scripts/fake_eval_service.py`: a schema variant that declares `QYM_DATASET_READ_TOKEN` and `EVAL_VLLM_POST_RUN_MAX_REQUESTS`, control fields for admission data.
7. **API client types** `frontend/src/api/experiments.ts` (`Experiment.latency_sensitive`, `ExperimentDetail.credentials`, `ExperimentJob.dataset_token`, `admitted_at`, `deferrals`, `deferral_reason`, `contaminated_attempts`, list filter), `api/evalCommon.ts` (`EvalEnvironment.latency_sensitive_min_role`), `api/evalEnvironments.ts` (`EnvironmentUpdate`), `api/evalQueue.ts` (`latency_sensitive`, `latency_active`), `api/launch.ts` (datasets with `accessMode`, `privateTestSet`; depends on WP-A's `access_mode`), `api/types.ts` (`DatasetReadToken.kind`, `experiment`).
8. **Launch UI**: `launch/model` (`doc.latencySensitive`, `latencyGate`, request body, review items, `PSEUDO.latency`), `entry/RunSettings.tsx` (checkbox block from `EvalFlagsMocks.module.css`: `.latency`, `.checkHelp`, `.checkReason`, `.callout`), `review/ReviewPane.tsx` (row, warnings), `entry/DatasetPicker.tsx` (`renderItem` with Tag, help line).
9. **Detail UI**: `detail/ExperimentDetailPage.tsx` (title tag, Credentials row and notices; recipe `.creds`, `.credItem`), `detail/JobHistoryCard.tsx` (status column width, `lib/admission.ts`, `↻` tag).
10. **List and queue UI**: `list/ExperimentsPage.tsx`, `queue/QueuePage.tsx` (tag, filter, note).
11. **Environment form**: `environments/SettingsForm.tsx` (third Select, help, dirty tracking, field error in `fieldErrors.ts`).
12. **Settings tokens**: `shell/settings/ApiKeysTab.tsx` (Name cell, confirm text, description).
13. **Docs, tests, gates** per B-S1 to B-S14 and section 11; run everything heavy through `scripts/heavy.sh`.

The review stage measures every criterion above in the browser (and with curl for B4-1..B4-20, B5-1..B5-22) and writes MEETS / MEETS WITH FIXES / DOES NOT MEET with the numbers.
