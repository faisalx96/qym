# WP-D: launch and service contract (several datasets and versions, run shape, task selection)

Status: design stage. No product component, route or model was changed. Added: the gallery mock
`frontend/src/features/dev/MultiLaunchMocks.tsx` (+ `.module.css`, wired into `/__ui#multi-launch` in `UiGalleryPage.tsx`), the measure scripts
under `measure/`, the screenshots under `shots/`, `docs/evaluation-service-change-request-v1.4.md` (decision F4) and this document. The mocks are the
visual contract: where this text and a mock disagree, the number in this text wins and the mock is a bug. CSS marked "recipe" in
`MultiLaunchMocks.module.css` is what the implementer moves into `entry.module.css` / the components.

Branch `feat/multi-dataset-launch` (from `0d725715`). Brief and owner decisions F1 to F4 (final): `BRIEF.md`. Measured 2026-10-22 at 1440, 1024 and 390 px
(launch column 1193 / 777 / 279; step column 821 / 777 / 279; review rail 352), Playwright Chromium (headless shell), dark scheme, SQLite, platform on 8996,
Vite on 5996, two fake Evaluation Services (`frontend/scripts/fake_eval_service.py --flags`) on 9096 and 9097. WP-C's `spec-c.md` did not exist when this was
written: what a union run uploads is marked "per WP-C".

## 0. Reading guide and summary

Owner request (BRIEF section 1): several datasets and several versions per dataset in one experiment, and a task to run the evaluation on, each with a change
request to the Evaluation Service team. Decisions: F1 the user chooses at launch between "Combine into one run" and "One run each"; F2 the service lists the
tasks per environment, the wizard reads them live; F3 an environment whose service has no `datasets` field gets one job per pair; F4 one change-request document.

| Surface | Criteria |
|---|---|
| Launch home view, Datasets card, run shape, environment boxes (`launch/home/LaunchHome.tsx`, `entry/DatasetPicker.tsx`, `entry/EnvironmentPicker.tsx`) | QD-1 to QD-24 |
| Customize step 1 (`entry/EntryBlock.tsx`) | QD-25 to QD-29 |
| Task control per environment (`entry/VersionsBlock.tsx` area, new `entry/TaskRow.tsx`) | QD-30 to QD-39 |
| Review pane, problems, raw JSON | QD-40 to QD-52 |
| Experiment detail | QD-53 to QD-62 |
| Clone, rerun, presets, best-run base | QD-63 to QD-70 |
| Experiments API, platform rules, sweeps, fan-out, cap | QD-71 to QD-92 |
| Proxy route, capabilities, dispatcher | QD-93 to QD-102 |

102 numbered criteria. Decisions: section 8. Test plan: 9. Hand-off: 10. Migration: 11. Limits: 12.

### What the measurements changed about the brief (read this first)

1. **The Dataset card is not a "list of datasets with versions" today, it is two Selects** (Dataset, Dataset version; content 94.8 px high at all three widths).
   The path to a dataset is two clicks (open the select, choose). The design keeps exactly that select as the zero-selection state (QD-1), so one dataset on
   Latest version is still two clicks (QD-9).
2. **The versions of an Evaluation Service and the new task row share one box.** After amendment 8c of the previous round the ticked environment's box already
   holds the `Versions` line (53 / 77 / 101 px). The task row is the next line of the same box (24 px + 4 px gap), so a service without tasks changes nothing (QD-31).
3. **Today's job identity cannot express a fan-out.** `eval_experiment_jobs` is unique on `(experiment, environment, combo_index, attempt)`: two pairs of one
   environment and one combination would collide. A new column `dataset_index` (migration 0090) is needed; the brief's "spec JSON may be enough" holds for the
   spec, not for the jobs (decision QD-D5).
4. **`GET /evals/tasks` on a v1.3 service answers 422, not 404** (the `{job_id}` UUID route captures `tasks`). The change request and the proxy treat 404, 405 and
   422 as "unsupported" (QD-94).
5. **A v1.3 service silently drops unknown `evaluator` keys** (guide 4.1). Sending `datasets` or `task` to it would run the first dataset and the default task
   with a `202`. The platform therefore never sends either to an environment whose stored schema does not declare it, and a dispatcher guard blocks a stored body
   whose environment lost the declaration (QD-99).
6. **The schema endpoint is `GET /evals/evaluator/schema`**, not `/evals/schema` as the brief wrote.

### Screenshots (`shots/`, dark)

Baseline (today, real app): `current-launch-home-{1440,1024,390}.png` (both environments ticked, one dataset), `current-launch-home-empty-*.png`,
`current-launch-step1-*.png`, `current-detail-*.png`. Composed page mocks: `mock-d-page-home-*`, `mock-d-page-step1-*`, `mock-d-page-review-*`,
`mock-d-page-detail-*` (each at 1440, 1024 and 390). State sheets (1440 and 390): `mock-d-s-single`, `mock-d-s-picker`, `mock-d-s-shape`, `mock-d-s-task`,
`mock-d-s-env`, `mock-d-s-problems`, `mock-d-s-raw`.

### How it was measured (`measure/`, Node 24, Playwright from `frontend/node_modules`)

`seed-md.mts` (project `design-md`, datasets support-tickets v1 to v3, billing-faq v1 v2, refund-cases v1, environments staging and production, one experiment),
`current-launch.mts` and `current-detail.mts` (baseline into `baseline/current-*.json`), `mock-shots.mts` and `mock-measure.mts` (mocks into `baseline/mock-*.json`
and `shots/`). Run with `PERF_BASE=http://127.0.0.1:8996 VITE_BASE=http://127.0.0.1:5996 SEED_MD=measure/seed-md.json node <script>.mts`.

## 1. Measured baseline (today)

Real app, both environments ticked, dataset `support-tickets` on Latest version, default preset (`baseline/current-launch-*.json`).

| Element | 1440 | 1024 | 390 |
|---|---|---|---|
| Launch column / step column | 1193 / 821 | 777 / 777 | 279 / 279 |
| Environments card, Dataset card (home) | 589.5 each | 381.5 each | 279 each, stacked |
| Dataset card content (two labelled Selects) | 547.5 x 94.8 | 339.5 x 94.8 | 237 x 94.8 |
| Dataset / Dataset version select | 547.5 x 24 each | 339.5 x 24 | 237 x 24 |
| Environment box, ticked, with Versions | 115 | 139 | 163 (production), 187 (staging) |
| Versions line | 529.5 x 53 | 321.5 x 77 | 219 x 101 |
| Home bar (`role=region` Launch) | 56 | 56 | 82.8 |
| Step 1 name card | 821 x 117.6 | 777 x 133 | 279 x 227.1 |
| Step 1 environment fieldset / box | 361.5 x 371.8 / 361.5 x 139 | 339.5 x 371.8 / 339.5 x 139 | 237 x 443.8 / 237 x 163 and 187 |
| Review pane | 352 x 617.8 (right rail) | 777 x 555 (below the step) | 279 x 606.6 |
| Review summary row | 310 x 36.2 | 735 x 36.2 | 237 x 36.2 |
| Review `Versions` row | 310 x 71.8 | 735 x 55 | 237 x 88.6 |
| Experiment detail: header / stat strip / matrix (1 job) / job history (1 job) | 69.2 / 81.4 / 267.5 / 287.5 (row 40) | measured in `current-detail-1024.json` | `current-detail-390.json` |

Clicks to a ready home view (`clicksToReady`): tick environment (1), open Dataset (2), choose the dataset (3). The Dataset version select defaults to
`Latest version` (no click). Then name (typing) and `Launch as is`.

Review text today for two environments: `Dataset` row `support-tickets` (no version), `Versions` row, `= 1 combination × 2 environments = 2 runs`.

## 2. Design

### 2.1 The home view (`/__ui#multi-launch`, `md-page-home`, `mock-d-page-home-*`)

The page keeps its three blocks: Environments card + Datasets card (`.where`, two columns from 1100 px, one column below 760 px), Start from, home bar. What changes:

**Datasets card** (`DatasetsCard`, replaces `DatasetPicker`'s two selects):

- **Nothing chosen**: today's `Select` labelled `Dataset`, placeholder `Choose a dataset`, 24 px. Choosing a dataset (click 2) replaces it with the list.
- **One or more chosen**: `<fieldset data-testid="datasets-fieldset">` with legend `Datasets`, then one **dataset box** per dataset (`li[data-dataset-box="<name>"]`), then
  the foot, then (only from two dataset versions) the run shape.
- **Dataset box** (recipe `.dsBox`, same 1 px frame, padding and radius as an environment box without the selected outline): row 1 the dataset name (wraps, never
  truncated), its `Restricted` / `Private test set` chip, and `Remove <name>` (`IconButton`, 24 px). Row 2, after a 1 px rule, the **versions row** (`.dsRefs`): the
  `MultiSelect` trigger (`triggerVariant="bar"`, label `Versions`, value `· N`) followed by one `Tag kind="version"` per chosen reference, in the order of the
  list below. The chosen references are visible without opening anything (DESIGN_LANGUAGE 6, density not disclosure).
- **References offered** (the `MultiSelect` panel, checkboxes, no search, no "Select all", no "Only"): `Latest version` first (today's default, the dataset's
  `production` alias), then `Version vN` for every version newest first with a `draft` tag where unpublished, then `Alias <name>`. `Latest version` is an
  ordinary checkbox (decision QD-D3). Unticking the last reference snaps back to `Latest version`, announced in the polite region (`1 dataset version`).
- **Foot** (`.dsFoot`): ghost small button `Add another dataset` (opens the dataset list without the datasets already chosen; any dataset of the project, as today,
  decision D3 of the dataset-access round) and the polite text `N dataset versions from M datasets` (`data-testid="pair-count"`, `1 dataset version` for one).
- **Run shape** (`data-testid="run-shape"`, only when N >= 2): `SegmentedControl` labelled `Run shape`, options `Combine into one run` (default) and `One run each`, and
  one help line (`.help`): combined `One run over the N dataset versions together. Every item records its dataset and version, and scores break down per
  dataset.`; one each `N runs per environment, one per dataset version, grouped under this experiment.`

**Environment boxes** (`EnvironmentPicker`, ticked box): after the `Versions` line a **task row** (section 2.3). In the tags row, only when N >= 2, one more tag
(`data-testid="env-shape-tag"`) says what this environment will receive (this is also where the home view, which has no review pane, says it):

| Case | Tag text | Tone |
|---|---|---|
| service takes a list, `Combine into one run` | `1 combined run` | info |
| service takes a list, `One run each` | `N runs, one per dataset version` | info |
| service takes no list, `Combine into one run` (the F3 fan-out) | `N runs, one per dataset version (older service)` | warning |
| service takes no list, `One run each` | `N runs, one per dataset version` | info |
| no evaluator schema yet / checking | as "takes no list" until the schema says otherwise | as that row |

**Home bar**: unchanged (56 / 56 / 82.8 px). `{n} runs to launch` counts the jobs (QD-6). Status line unchanged.

**Start from**: the best-run card text names the first dataset and `and N more dataset(s)`; its scope uses the first dataset (decision QD-D9).

### 2.2 Customize step 1 (`md-page-step1`)

Same `DatasetsCard` and environment boxes (the same components, as the versions block was shared in the previous round), in the step's `.where` row (cards 403.5 wide at
1440, contents 361.5). The review pane is the right rail at 1440 (352 px), below the step at 1024 and 390.

### 2.3 The task control (`entry/TaskRow.tsx`, `md-s-task`)

Inside each ticked environment's box, directly under the `Versions` line, a row `Task` (label, `.versionLabel` style) + a `Select` (24 px, label hidden, accessible name
`Task of <environment>`). First option `Worker default` (value null, always first), then the service's tasks in its order, each with its `description` as the second
line of the option. It exists only when the environment accepts a task (its stored evaluator schema declares `task`, known immediately from the environment record) and
the service lists tasks:

| State | Row |
|---|---|
| schema has no `task` | no row, no request (QD-31) |
| reading | label + a 24 px placeholder (`.taskSkel`), `Reading tasks…` visually hidden `role=status`; the box has its loaded height (rule 7) |
| ok, chosen / `Worker default` | the select; the chosen task's name |
| ok, empty list | the select disabled showing `No tasks listed` (keeps the row) |
| error (503, unreachable, 401) | `Couldn't read tasks: <reason>` in `--error`, the row keeps 24 px (`min-block-size`) |
| service answers 404 / 405 / 422 (schema said yes, service says no) | no row; the environment is treated as without tasks |
| archived project | the select disabled |

Fetch: one react-query entry per environment (`launchKeys.tasks`, `staleTime: Infinity`), enabled only for a ticked environment whose schema declares `task`; the
box's `Refresh` button reads versions **and** tasks (its accessible name becomes `Refresh versions and tasks of <environment>` when the row exists). Home view and
step 1 share the entry (0 extra requests on Customize).

The task is **per environment** in the form (`doc.tasks: Record<envId, string | null>`), stored in the spec as `evaluator.task` (section 3).

### 2.4 Review pane (`md-page-review`, `md-s-problems`)

Rows (`KeyValueGrid`, one column): `Environments` becomes a per-environment list only when N >= 2 or an environment has a task chosen
(`data-testid="review-env-lines"`): bold name, then one muted line `1 combined run of 4 dataset versions · task Answer a ticket` or `4 runs, one per dataset
version (older Evaluation Service) · Worker default task`. With one dataset and no task it stays `staging, production`. `Dataset` becomes `Datasets` (N >= 2): one
line per dataset (`data-testid="review-datasets"`), name in mono, its references muted (`v3, v4`). New row `Run shape` (N >= 2): `Combine into one run` / `One run
each`. The runs count and its math line follow the real job count: `= 1 combination × (production: 1 combined run + staging: 4 runs) = 5 runs`. Problems list as today
(QD-49). Over the cap: the existing `Over the run limit` callout, text extended with `or choose “Combine into one run”`.

### 2.5 Raw JSON (`md-s-raw`)

The editor shows `evaluator.datasets` (list of `{dataset, version, alias}`), `evaluator.run_shape` and `evaluator.task` next to the mirrored scalars `dataset` /
`dataset_version`. Apply parses them back into the form (section 3.1). Errors name the pointer: `/evaluator/datasets/1: give a version or an alias, not both.`

### 2.6 Experiment detail (`md-page-detail`)

New card `Datasets and task` (`section[aria-label="Datasets and task"]`, `Card tone="meta"`, under the header and the cancel button): `Datasets` (one `Tag kind="dataset"`
per `name · version`, `data-testid="detail-datasets"`), `Run shape`, and `What each environment ran` (`data-testid="detail-env-lines"`: environment, what it received, the task
name or `Worker default task`). Shown only when the experiment has `datasets` or any task. The Matrix card gets one row per (combination, dataset key): a combined job sits on a row
`All N dataset versions` / `combined`, a fanned-out pair on its own row `<dataset> · <version>` with `#<combo> · pair <k>` under it, `—` where an environment has no job for the row. The
Job history table gets groups by dataset version (`DataTable groupBy`, group label = `Tag kind="dataset"`), the combined job first; shown when any job has a dataset
(combined or pair), flat otherwise. A `Task` column (170 px, priority 3) shows the job's task name.

### 2.7 Clone, rerun, presets, best-run base

- **Clone / rerun**: the spec is copied as is (`datasets`, `run_shape`, `task`). `task` entries of environments not selected in the new launch are dropped with a base note `Task for <env> was not carried (environment not selected)`. `Rerun` is clone plus launch of the same document.
- **Presets** (default and saved): hold no `datasets` and no `run_shape` (the dataset choice belongs to the launch; the existing single `dataset` stays allowed). A preset may hold `evaluator.task` as a **string** (its environment's own id). `buildPresetConfig` strips `datasets`, `run_shape` and an object `task`; the API refuses them in a preset (QD-65).
- **Best-run base**: the run's `run_metadata.qym_config.evaluator` carries that job's effective evaluator: a fanned-out job gives a single pair, a combined job gives `datasets` + `run_shape: "combined"`; the base applies it while the Datasets card is untouched (same rule as today's `datasetChanged`), the `task` string becomes the base environment's entry.
- **Sweeps**: a sweep may cover `evaluator.task` (string scalars, one job per value); `datasets`, `run_shape`, `dataset` and `dataset_version` cannot be swept once `datasets` is set (QD-80).

## 3. Experiments API (`api/experiments.py`, new `services/eval_datasets.py`)

### 3.1 Spec shape (stored in `eval_experiments.spec`, no new column)

```jsonc
"evaluator": {
  "dataset": "support-tickets",            // always the first pair (scalar form, what every reader of today's spec understands)
  "dataset_version": "v3",
  "datasets": [ {"dataset": "support-tickets", "version": "v3", "alias": null}, ... ],   // NEW, only with 2..20 entries
  "run_shape": "combined" | "one_each",    // NEW, platform-only (never sent to a service), only with `datasets`, default "combined"
  "task": "answer-ticket" | {"<environment id>": "answer-ticket" | null},               // NEW; object = per environment
  "config": { "dataset_alias": null, ... }
}
```

Normalisation (`eval_datasets.normalize`, runs first, on the request's spec; the stored spec is the normalised one):

1. `datasets` with exactly one entry collapses to the scalar form (`dataset`, `dataset_version`, `config.dataset_alias`) and `datasets` / `run_shape` are dropped: a one-pair experiment is stored byte for byte as today (QD-72).
2. Entries: object with keys `dataset` (1 to 200 chars), `version`, `alias` (string or null, at most 100 chars); at most one of `version` / `alias`; no unknown keys; no entry equal to an earlier one; at most **20** entries (`QYM_EVAL_MAX_DATASETS`, default 20).
3. Mirror: `evaluator.dataset` = entry 0's dataset, `dataset_version` = its version, `config.dataset_alias` = its alias. A caller-supplied scalar that differs from entry 0 is `422`.
4. `run_shape` accepted values `combined` / `one_each`; without `datasets` (after collapsing) it is dropped silently only when it equals the default, else `422` `run_shape_without_datasets`.
5. `task`: string (applies to every selected environment) or object keyed by selected environment ids (a key outside the request is `422` `task_unknown_environment`); values string (1 to 100 chars, `^[A-Za-z0-9_.:-]+$`) or null.

Errors use the existing shape (`section`, `pointer`, `form_pointer`, `rule`, `message`, `environment_id`): rules `datasets_invalid`, `datasets_duplicate`, `datasets_limit`, `datasets_conflict`, `run_shape_invalid`, `run_shape_without_datasets`, `task_invalid`, `task_unknown_environment`, `task_unsupported`, `task_unknown` (texts in QD-71 to QD-79). `EvaluatorInputs` (the static mirror, `eval_config.py`) gains `datasets` and `task`; `PLATFORM_OWNED_EVALUATOR_FIELDS` is unchanged (the form edits them); `run_shape` is stripped in `_materialize` and never reaches a body.

### 3.2 Capabilities per environment

`eval_evaluator_schema.evaluator_capabilities(schema_json) -> {"datasets": bool, "task": bool}` = the property is declared in `properties`. No stored evaluator schema = both false. The environment payload (list and get) gains `evaluator_capabilities`. Refreshing the schema (once per launch visit) updates it.

### 3.3 Expansion (the F3 fan-out)

After the sweep plan (`eval_sweeps.expand`) and before validation, for every (combination, environment) the units are:

| Spec | Environment | Units | Job evaluator |
|---|---|---|---|
| no `datasets` | any | 1 | as today |
| `combined` | takes a list | 1 | `dataset`, `dataset_version`, `datasets` (list) |
| `combined` | takes no list | N | one pair each: `dataset`, `dataset_version`, `config.dataset_alias`; no `datasets` |
| `one_each` | any | N | one pair each, as above |

Every body has `run_shape` removed. `task` is resolved per environment to a string or removed (null / absent = default). A fanned-out job has `dataset_index = i` (its position in `datasets`), `params.dataset = {dataset, version, alias}`; a combined multi job has `params.datasets` (the list); both keep `params.sweep`. Run name = `eval_sweeps.run_name(...)` + ` · <dataset> <version or alias>` for a fanned-out unit (200 char cap as today). `qym_config` is built from the unit's document (so the best-run base of a job is exactly its evaluator). The dataset read-token warnings (`dataset_token_warnings`) look at every dataset of the unit documents, not only `evaluator.dataset`.

**Sweep cap**: jobs = (product of axis lengths) x (sum over environments of their units). The sum is passed to `eval_sweeps.expand` as `environment_count`, so `QYM_EVAL_SWEEP_MAX_JOBS` (64) is checked before anything is validated or written, with the existing `sweep_cap` error (QD-79). The dry run and the form's estimate use the same formula (capabilities come from the environment records).

### 3.4 Task validation

- An environment with a non-null task that does not declare `task`: error `task_unsupported`, `Environment "staging" does not offer task selection; clear its task or deselect it.`
- Dry run and real create read `GET /evals/tasks` for each environment with a non-null task (one call per environment, in parallel, 5 s timeout, per request only): id absent: `task_unknown`, `Environment "production" does not list the task "route-ticket".`; service error: warning `task_unverified` (never an error; the service itself answers `422 unknown task` at submit and the job fails with that text). The task's display name is stored in `params.task = {"id", "name"}` (name falls back to the id).

### 3.5 Responses

- **Dry run**: per preview job `dataset_index`, `dataset`, `datasets`, `task`; top level `datasets_plan: [{environment_id, environment_name, mode: "single" | "combined" | "fan_out", units, reason: null | "service_without_datasets" | "run_shape"}]`; `warnings` gains `task_unverified`; `jobs`/`job_count` use the unit count.
- **Detail** (`GET .../experiments/{id}`): `selection: {datasets: [...], run_shape, tasks: {env_id: {id, name} | null}}` (datasets from the spec; a scalar-only spec gives one entry and `run_shape: null`), and per job `dataset_index`, `dataset`, `datasets`, `task`. `qym_config` stays secret-free as today.
- **Clone prefill**: the spec as stored (QD-63).
- The list payload is unchanged (decision QD-D11).

## 4. The platform proxy for the service's task list

`GET /v1/projects/{pid}/eval-environments/{eid}/tasks` (member access, like `versioning-details`; reads only, stores nothing), always 200:

```json
{"environment_id": "…", "status": "ok" | "unsupported" | "error",
 "tasks": [{"id": "answer-ticket", "name": "Answer a ticket", "description": null, "default": true}],
 "error": null, "fetched_at": "…"}
```

`unsupported`: the stored schema does not declare `task` (no service call), or the service answers 404 / 405 / 422. `error`: 503 (the service's reason, redacted), unreachable, 401. Entries are trimmed to the contract (ids matching the pattern, `name` 120, `description` 500, at most 200 entries; invalid entries are skipped), the key is never in the response. `EvalServiceClient.tasks_list()` returns `None` for 404 / 405 / 422 and raises `TasksUnavailable(reason)` for 503, mirroring `versioning_details_current`.

## 5. The dispatcher

The stored job body is sent as is; nothing is derived at dispatch. What is sent:

| Case | `evaluator` of the submitted body |
|---|---|
| single dataset, no task | exactly today's (v1.3) body |
| combined on a service with `datasets` | `dataset`, `dataset_version`, `datasets` (list), `task` when chosen, `config` |
| fanned-out unit | `dataset`, `dataset_version`, `config.dataset_alias` of that pair, `task` when chosen; no `datasets` |
| any | never `run_shape` (stripped again in `_submit_body` as a defence) |

**Guard** (QD-99): before submit, a body that holds `evaluator.datasets` or a non-null `evaluator.task` while the environment's **current** stored evaluator schema no longer declares the property is not sent: the job becomes `BLOCKED` with `wait_reason` `The Evaluation Service no longer accepts <datasets|task>; launch again`. (A service that drops unknown keys would otherwise run the wrong thing with a 202.) Retry of a fanned-out job resends its stored body with the same `dataset_index`.

## 6. Acceptance criteria

Home view numbers are measured on the composed mock at the real column (`measure/baseline/mock-*.json`); `W` = 1440 / 1024 / 390 and the values are quoted in that order.

### Launch home view, Datasets card (QD-1 to QD-24)

| ID | Criterion |
|---|---|
| QD-1 | `/experiments/new` with no dataset chosen shows today's DOM in the Dataset card: one `Select` named `Dataset`, 24 px high, 547.5 / 339.5 / 237 px wide, placeholder `Choose a dataset`; no `fieldset[data-testid="datasets-fieldset"]`, no `run-shape`. Card 73.4 px at 390 (as today). |
| QD-2 | Choosing a dataset replaces the Select with `fieldset[data-testid="datasets-fieldset"]` (legend `Datasets`) holding one `li[data-dataset-box]` for it, the foot, and no run shape. |
| QD-3 | A dataset box is 547.5 / 339.5 / 237 px wide and **67 px high at all three widths** (name row 24 + rule + versions row 29 + padding) for one to three references; the `Versions` trigger and the tags sit on one line; with more tags they wrap and the box grows by 24 px per extra line. Name wraps, never truncated (`scrollWidth <= clientWidth`, no ellipsis). |
| QD-4 | The versions row shows the trigger `Versions · N` (24 px high, 139 px or less wide, `aria-haspopup=dialog`, accessible name `Versions of <dataset>`) and one tag per chosen reference, 20 px high (`v3` 28 px wide), `kind="version"` (mono, meta tone), in list order, visible without interaction. |
| QD-5 | The trigger opens a panel of checkbox rows (32 px, no search, no Select all, no Only): `Latest version`, versions newest first (draft ones tagged `draft`), aliases. Arrow keys move, Space toggles, Escape returns to the trigger. Ticking changes the tags and `pair-count` at once. |
| QD-6 | `[data-testid="pair-count"]` (polite) reads `1 dataset version`, `2 dataset versions from 2 datasets`, `4 dataset versions from 2 datasets`; the home bar's `{n} runs to launch` and the review count use the real job count (section 3.3). |
| QD-7 | Unticking the last reference of a dataset re-ticks `Latest version` and the polite region says so; a dataset never has zero references from the form. |
| QD-8 | `Remove <dataset>` removes its box and its references; removing the last one returns to the QD-1 Select. Focus moves to the next box's trigger, else to the foot's button. |
| QD-9 | **Single path unchanged in clicks**: from an empty home view, one environment ticked, then `Dataset` opened and a dataset chosen is 3 clicks in total and the home bar is ready (name aside); the dataset costs 2 clicks as today. The dataset is on `Latest version` without a further click (`evaluator.dataset_version` absent, as today). |
| QD-10 | One dataset on `Latest version`: fieldset **117.2 px at 1440 and 1024, 136.6 px at 390** (today 94.8: +22.4 / +22.4 / +41.8 px), no run shape, no `env-shape-tag`, no `Datasets and task` card on the detail. |
| QD-11 | `Add another dataset` (small, neutral, plus glyph, 159 x 24 px) lists the project's datasets minus the chosen ones (same chips and help line as today for restricted and private datasets); a chosen dataset is not offered twice; with none left the button is disabled. |
| QD-12 | The run shape appears **only** when the pair count is 2 or more (`[data-testid="run-shape"]` count 1; 0 below). It is a `radiogroup` named `Run shape`, 24 px high, 547.5 / 339.5 / 237 px wide, options `Combine into one run` (selected by default) and `One run each`. Block 67.8 px at 1440 and 1024, 83.2 at 390 (two help lines). |
| QD-13 | Help text exactly as in section 2.1, with N the pair count; it changes with the selection. |
| QD-14 | Dataset card with 2 datasets x 2 versions and the run shape (the composed mock): fieldset **264 px at 1440 and 1024 (283.4 at 1024: the foot wraps), 329.5 at 390**; the Environments card in the same row is 447 px (1440) so the row height is set by the environments, not by the Datasets card. |
| QD-15 | `Restricted` / `Private test set` chip and the token help line behave as today, per dataset box (the help line for the first chosen restricted or private dataset only, one line). |
| QD-16 | `Datasets` fieldset legend is 12 px / 600 like `Environments`; no new token, colour or font role (design-language test passes). |
| QD-17 | Tab order in the card: boxes in order (`Versions` trigger, `Remove`), `Add another dataset`, the run shape radios (one Tab stop). Axe: 0 serious violations at 1440 and 390. |
| QD-18 | The page has 0 px horizontal overflow at 1440, 1024, 390; every box, tag and the segmented control has `scrollWidth <= clientWidth`. |
| QD-19 | `Combine into one run` stays selected across adding and removing datasets; returning to one pair hides the control and keeps the choice in the document (it is not sent for a single pair). |
| QD-20 | **Environment tag** (`[data-testid="env-shape-tag"]`, 20 px high, 10 px / 650, sans): exactly one per ticked environment when N >= 2, 0 otherwise; text per the table in 2.1; `1 combined run` is 88.6 px wide, the warning tag 229.2 px (wraps under 237 px content at 390: 26 px high). |
| QD-21 | Mixed environments (production takes a list, staging does not, `Combine`): production's tag reads `1 combined run` (info), staging's `4 runs, one per dataset version (older service)` (warning); switching to `One run each` makes both `4 runs, one per dataset version` (info). The home bar count is 5 then 8. |
| QD-22 | The environment box grows only by the tag row where the tag wraps: staging (with the warning tag) is 115 px at 1440 (the tag fits on the tags line, same as today), 163 px at 1024 and 217 px at 390 (tag on its own line); production with the task row is 143 / 167 / 215 px. |
| QD-23 | Home page height with the composed state (2 environments, 2 datasets x 2 versions): 900 px at 1440 (one screen, no scroll, as today's seeded page), 1012.5 at 1024, 1770.6 at 390. Home bar 56 / 56 / 82.8 px unchanged. |
| QD-24 | `Launch as is` is enabled when no problems; it sends the spec of section 3.1 with a single `dry_run` first (the existing 0.5 s debounced dry run), once per change. Changing only a task or the run shape triggers one dry run. |

### Customize step 1 (QD-25 to QD-29)

| ID | Criterion |
|---|---|
| QD-25 | `/experiments/new?step=where` renders the same `DatasetsCard` and environment boxes: same DOM and text as the home view for the same document (0 differences), in the step's `.where` row: cards 403.5 / 381.5 / 279 px, contents 361.5 / 339.5 / 237. |
| QD-26 | Boxes at 361.5 px: dataset box 67; production box with Versions (77) and task row 167 px; staging with the warning tag 163 px (1440); `Datasets` fieldset 264 px. At 1024 (339.5): 167 and 163; at 390 (237): 215 and 217. |
| QD-27 | Review rail (right column, 352 x 700.8 px with the composed state; today 617.8) at 1440; below the step at 1024 (777 x 653.2) and 390 (279 x 764.9). |
| QD-28 | Home to Customize issues 0 requests for versions, tasks or dataset versions (shared cache entries); ticking a third environment issues exactly the versions request and, when its schema declares `task`, one tasks request. |
| QD-29 | Step 1's change count (the stepper tag) counts `Datasets changed` once, a changed task once per environment, a changed run shape once. |

### Task control (QD-30 to QD-39)

| ID | Criterion |
|---|---|
| QD-30 | In a ticked box whose schema declares `task` and whose list is non-empty there is exactly one `[data-env-task="<env>"]` row, directly after `[data-env-version]`, 24 px high: a `Task` label and a 24 px `Select` (measured 477.1 / 284.1 / 181.6 px wide at box contents of 514.5 / 321.5 / 219 px; 296.6 at the 334 px sheet frame). The box is 28 px taller with it (24 + 4 gap). |
| QD-31 | An environment whose schema does not declare `task` has no row and the page issues 0 `/tasks` requests for it; a ticked environment that does has exactly one on first tick, none on untick or Customize, exactly one per `Refresh`. |
| QD-32 | First option `Worker default` (value null), then the tasks in the service's order; each option shows `name` and, when present, `description` on a second line; the trigger shows the name. `Worker default` is selected on a new launch. |
| QD-33 | Loading: row 24 px with `.taskSkel` (24 px high, full width), `Reading tasks…` `role=status` visually hidden; the box height equals the loaded height (delta 0 +- 1 px at 1440, 1024, 390; test with a 1 s delayed fake). |
| QD-34 | Empty list: select disabled showing `No tasks listed`, row 24 px. |
| QD-35 | Error: `Couldn't read tasks: <reason>` in `--error`, row min 24 px (20 px of text, never shorter than the loaded row), wraps at 390; launching is not blocked. |
| QD-36 | Fake answers 404, 405 or 422: no row, no error text, no console error (status `unsupported`). |
| QD-37 | Archived project: select disabled, value shown. |
| QD-38 | The chosen task is part of the document per environment; unticking the environment drops its entry (and a later re-tick starts at `Worker default`). The review pane and the detail show the task by name. |
| QD-39 | `Refresh` in a box refetches versions and tasks; its accessible name is `Refresh versions and tasks of <env>` when the task row exists, `Refresh versions of <env>` otherwise; a second press while in flight is harmless. |

### Review pane, problems, raw JSON (QD-40 to QD-52)

| ID | Criterion |
|---|---|
| QD-40 | With 2 datasets x 2 versions, production combined with a task and staging fanned out: `Environments` row 107.2 px at the 310 px row (1440 rail), two lines `[data-testid="review-env-lines"] li` of 34.2 and 49.6 px; text per section 2.4. |
| QD-41 | `Datasets` row 57 px: two lines (name mono, references muted), `[data-testid="review-datasets"]`; `Run shape` row 36.2 px, present only for N >= 2. |
| QD-42 | With one dataset and no task chosen the review is today's: `Environments` `staging, production`, `Dataset` one line, no `Run shape`, no `Datasets` plural (0 differences from the baseline text). |
| QD-43 | The runs count and the math line use the real job count: composed state `5`, `= 1 combination × (production: 1 combined run + staging: 4 runs) = 5 runs`; `One run each`, two environments: `8` and `= 1 combination × (2 environments × 4 dataset versions) = 8 runs`. |
| QD-44 | Over the cap (`> QYM_EVAL_SWEEP_MAX_JOBS`): the existing callout `Over the run limit`, 0 requests to create, `Launch` disabled; the text contains `choose “Combine into one run”` when the shape is `One run each`. |
| QD-45 | Review step (`?step=review`): pane full width (1193 / 777 / 279), 653.2 / 653.2 / 764.9 px with the composed state; Raw JSON card 279.6 px high text block. |
| QD-46 | Review item `Edit` for `Datasets changed` opens step 1 and focuses the Datasets card's first trigger. |
| QD-47 | Raw JSON shows `evaluator.datasets`, `run_shape` and `task` (object by environment id) in the form's order; a single pair shows no `datasets` and no `run_shape` (today's text). |
| QD-48 | Raw JSON Apply with a valid `datasets` / `run_shape` / `task` updates the form (the Datasets card, the shape and the task rows) and a re-serialised text equals the applied text (round trip, 0 differences). Invalid text is rejected and nothing changes. |
| QD-49 | Problems (client validation, `validation.ts`, each with `stepId: 'where'`, pointer in brackets): `/evaluator/dataset`: `Choose a dataset.`; `/evaluator/datasets/<i>`: `<dataset>: choose at least one version.`; `/evaluator/datasets`: `<dataset> <ref> is chosen twice.`, `At most 20 dataset versions per experiment.`; `/evaluator/task/<envId>`: `<env>: the service does not list the task “<id>”.` and `<env>: this Evaluation Service does not offer task selection.`. Clicking a problem focuses the field (the box or the task row). |
| QD-50 | Server errors for the same rules map back to the same pointers (the dry run's `errors` with `form_pointer`), so a raw JSON edit shows them in the review pane. |
| QD-51 | A review-pane warning `task_unverified`: `Couldn't confirm the tasks of <env>; the service checks them when the job starts.` (warning callout, never blocks). |
| QD-52 | `Launch N runs` posts once; the 201 response's `job_count` equals the review count; the experiment page opens. |

### Experiment detail (QD-53 to QD-62)

| ID | Criterion |
|---|---|
| QD-53 | `section[aria-label="Datasets and task"]` exists only when the experiment has `datasets` or a task; 1193 x 213.3 at 1440, 777 x 268.1 at 1024, 279 x 318.3 at 390 for the composed example (4 datasets versions, 3 environments); a plain experiment has 0 and its page equals the baseline (header 69.2, strip 81.4). |
| QD-54 | `[data-testid="detail-datasets"]` shows one `Tag kind="dataset"` per pair (`support-tickets · v3`), in order; `Run shape` shows `Combine into one run` / `One run each` for N >= 2; `What each environment ran` lists every environment with its text and task name (`Worker default task` when none). |
| QD-55 | Stat strip counts current jobs (9 in the example); 81.4 px at 1440 and 1024, 242.1 at 390. |
| QD-56 | Matrix: one row per (combination, dataset key); the combined job on its own first row `All 4 dataset versions` / `combined`; fanned-out pairs on rows `<dataset> · <version>` with `#<combo> · pair <k>`; `—` where an environment has no job for that row. Example: 5 rows, card 413.2 / 425.2 / 665.2 px. A plain experiment's matrix is unchanged (one row per combination). |
| QD-57 | Job history groups by dataset version when any job has `dataset` or `datasets`: group header = `Tag kind="dataset"` (20 px) + the table's own count, the combined job's group first; collapsible; flat table otherwise. Example table 559 px high at 1440 and 1024. |
| QD-58 | `Task` column (170 px, priority 3) shows the task name or `Worker default`. |
| QD-59 | Retrying a fanned-out job creates attempt + 1 with the same `combo_index`, `dataset_index` and `params.dataset`; the matrix cell shows `↻ 1 earlier`; `Retry failed (n)` counts per job. |
| QD-60 | Cancelling and the queue strip work per job; the queue page's `combo_index` column shows `#<combo>` and, for a fanned-out job, ` · <k>` (`dataset_index + 1`). |
| QD-61 | Detail polling keeps the grouping stable: no group reorders, row heights unchanged between polls (0 layout shift). |
| QD-62 | The page has 0 px overflow at 1440, 1024, 390; the history table card layout at 390 keeps the group header (26 px when the label wraps). |

### Clone, rerun, presets, best-run base (QD-63 to QD-70)

| ID | Criterion |
|---|---|
| QD-63 | `GET .../experiments/{id}/clone` returns the stored `datasets`, `run_shape` and `task`; the launch form shows the same Datasets card, shape and per-environment tasks (round trip: the cloned dry run's job bodies equal the original's). |
| QD-64 | Clone into a different environment set: a `task` entry for an unticked environment is dropped with the base note `Task for <env> was not carried (environment not selected)`; a string `task` applies to every ticked environment that offers tasks. |
| QD-65 | Presets: `POST .../presets` with `evaluator.datasets` or `run_shape` answers `422` (`not_in_preset`, `A preset does not hold a dataset list or a run shape; choose them at launch.`); `evaluator.task` as a string passes; as an object `422`. `buildPresetConfig` strips the three. |
| QD-66 | Starting from a preset never touches the Datasets card or the shape; its `task` string seeds the base environment's row if that environment lists the id, else it is dropped with a note. |
| QD-67 | Best-run base: a combined job's run gives `datasets` + `combined`; a fanned-out job's run gives its one pair; the Datasets card is filled only while untouched; `Undo all changes` restores the baseline datasets, shape and tasks. |
| QD-68 | `Top-scoring run` card text: `…on <first dataset>` plus `and N more dataset(s)`; the best-run scope query uses the first dataset (QD-D9). |
| QD-69 | Default-preset editor (`mode: editor`): no Datasets multi-select (single `Dataset` select as today, a preset's `dataset` is optional), no run shape; the task row is offered for its one environment. |
| QD-70 | Rerun of an experiment with a fan-out keeps the shape and the dataset list, and runs the same number of jobs per environment. |

### Experiments API (QD-71 to QD-92)

| ID | Request -> response |
|---|---|
| QD-71 | `datasets` entry with `version` and `alias` -> `422`, error `{rule: "datasets_invalid", pointer: "/evaluator/datasets/0", message: "give a version or an alias, not both"}`; unknown key, blank `dataset`, non-object entry, `version` over 100 chars -> the same rule with the matching message. |
| QD-72 | `datasets` with one entry -> `201`, stored `spec.evaluator` has `dataset`, `dataset_version` / `config.dataset_alias` and **no** `datasets` / `run_shape` (identical to the same request in scalar form); a scalar-only request is stored unchanged (golden payload test). |
| QD-73 | Duplicate entries -> `422` `datasets_duplicate`, `support-tickets v3 is chosen twice.`; more than 20 -> `datasets_limit`, `At most 20 dataset versions per experiment.` |
| QD-74 | `evaluator.dataset` different from entry 0 -> `422` `datasets_conflict`, `evaluator.dataset must equal the first dataset in evaluator.datasets`; equal or absent passes and is filled. |
| QD-75 | `run_shape` not `combined` / `one_each` -> `422` `run_shape_invalid`; with fewer than two pairs and a non-default value -> `run_shape_without_datasets`; absent with two pairs = `combined`, stored explicitly. |
| QD-76 | `task` string for every environment, object per environment, null; an object key outside `environment_ids` -> `422` `task_unknown_environment`; bad pattern -> `task_invalid`. |
| QD-77 | `task` on an environment whose schema does not declare it -> `task_unsupported`, `Environment "staging" does not offer task selection; clear its task or deselect it.` (also for the string form, per such environment). |
| QD-78 | Live check (fake): unknown id -> `task_unknown`, `Environment "production" does not list the task "route-ticket".`; service 503 or timeout -> create succeeds, warning `task_unverified`; stored `params.task` holds `{id, name}` (name from the list, else the id). |
| QD-79 | Fan-out counts: composed state (2 environments, one takes a list, 4 pairs, `combined`) -> 5 jobs; `one_each` -> 8; with a 2-value sweep 10 and 16; over `QYM_EVAL_SWEEP_MAX_JOBS` -> `422` `sweep_cap` before any validation or row, and the dry run reports it without 422. Jobs of one environment and combination have `dataset_index` 0..N-1. |
| QD-80 | Sweeps: `{"sweep": [...]}` on `/evaluator/datasets`, `/evaluator/run_shape`, and on `/evaluator/dataset` or `/evaluator/dataset_version` while `datasets` is present -> `422` `sweep`, `Dataset versions cannot be swept; choose “One run each” to run each one.`; `/evaluator/task` with string values is accepted (one job per value). |
| QD-81 | Job bodies: combined on a list-taking environment has `evaluator.datasets` (list), `dataset`, `dataset_version`; every other job has none of `datasets`; **no body anywhere has `run_shape`**; `task` appears only for environments with a non-null task. |
| QD-82 | A fanned-out job's `evaluator` has that pair's `dataset`, `dataset_version` (or `config.dataset_alias`), run name `<name> · <combo label> · <env> · support-tickets v3` (names deduplicated as today, 200 chars). |
| QD-83 | `qym_config` of every job holds its unit's evaluator (best-run base reads it); secrets stay `{"$secret": "redacted"}`. |
| QD-84 | Dry run: `datasets_plan` per environment (`mode`, `units`, `reason`), per preview job `dataset_index`, `dataset` / `datasets`, `task`; `ok` false with the errors of QD-71 to QD-77. |
| QD-85 | Detail: `selection` object and per-job `dataset_index`, `dataset`, `datasets`, `task` as section 3.5; an old experiment (no datasets) has `selection.datasets` of one entry and `run_shape: null`, `tasks: {}`. |
| QD-86 | Stored `eval_experiments.spec` carries user intent (`datasets`, `run_shape`, `task`) and never an expansion; changing a service's capabilities later does not change the stored spec. |
| QD-87 | Platform-only: a body, `qym_config` or any response never carries `run_shape` toward a service; the spec and the detail's `selection` do. |
| QD-88 | `dataset_token_warnings`: a restricted or private dataset in the list of any unit raises `dataset_token_not_declared` once per dataset (not per unit). |
| QD-89 | The experiment create rate limit, HIGH priority rules, latency gate and base-source checks are unchanged (existing tests pass untouched). |
| QD-90 | Postgres: the new unique constraint and column work (create, fan-out, retry, `superseded_job_ids`) with `QYM_TEST_POSTGRES_URL`. |
| QD-91 | `superseded_job_ids` keys on `(environment_id, combo_index, dataset_index)`: a retry supersedes only its own pair's earlier attempt. |
| QD-92 | Queue order: `(COALESCE(next_attempt_at, created_at), created_at, combo_index, dataset_index, id)`. |

### Proxy route, capabilities, dispatcher (QD-93 to QD-102)

| ID | Request -> response |
|---|---|
| QD-93 | `GET .../eval-environments/{eid}/tasks` -> `200`, body of section 4; non-member `403`/`404` as `versioning-details`; archived project fine (read). |
| QD-94 | Fake answering `{tasks:[...]}` -> `ok`; 404, 405, 422 -> `unsupported`, `tasks: []`, `error: null`; 503 `{"detail":"could not list tasks: x"}` -> `error` with `x`; connection refused -> `error` (redacted); stored schema without `task` -> `unsupported` with **0** service calls. |
| QD-95 | Entries trimmed and filtered (id pattern, lengths, at most 200); the API key never appears in `error`. |
| QD-96 | Environment list/get gain `evaluator_capabilities: {datasets, task}`; no evaluator schema -> both false; after a schema refresh that declares them -> true without a restart. |
| QD-97 | `EvalServiceClient.tasks_list()` unit-tested for 200, 404, 405, 422, 503, invalid JSON (`EvalServiceError`). |
| QD-98 | Dispatcher sends: single -> the v1.3 body byte for byte (golden); combined -> list + task; fanned-out -> single pair, no list; never `run_shape` (table in section 5). |
| QD-99 | Guard: stored body with `datasets` / task, environment's current schema without the property -> not submitted, job `BLOCKED`, `wait_reason` `The Evaluation Service no longer accepts datasets; launch again` (or `task`); a schema that declares it submits normally. |
| QD-100 | Retry of a fanned-out job resends its stored body (same pair, same `dataset_index`), attempt + 1. |
| QD-101 | The fake service stores and echoes `eval_input.datasets` / `task`, answers `422 unknown task: <id>` for a task outside its list, and with the flags off behaves like v1.3 (drops the keys, `GET /evals/tasks` -> 422). |
| QD-102 | Migration 0090 (`down_revision = "0089"`): adds `eval_experiment_jobs.dataset_index INTEGER NOT NULL DEFAULT 0`, `ck_eval_experiment_jobs_dataset_index (dataset_index >= 0)`, replaces `uq_eval_experiment_job_attempt` with a unique on `(experiment_id, environment_id, combo_index, dataset_index, attempt)`; downgrade restores it (refuses with a clear error if fan-out rows exist); existing rows get 0; tested on SQLite (create_all) and Postgres (Alembic up/down). |

## 7. Frontend model and wiring (for the implementer)

| Today | New |
|---|---|
| `LaunchDocument.dataset: DatasetChoice` | `datasets: DatasetEntry[]` (`{name, refs: string[]}`, ref `''` Latest, `v:<v>`, `a:<alias>`), the single `custom` dataset string kept as a one-entry custom state; `runShape: 'combined' \| 'one_each'`; `tasks: Record<envId, string \| null>`. `doc.dataset` stays as a derived view of entry 0 for code that reads one dataset (best-run scope, `datasetValue`). |
| `buildSpec` `dataset`, `dataset_version`, `config.dataset_alias` | same scalars from entry 0; with 2+ pairs also `datasets`, `run_shape`; `task` object from the document (omit nulls and empty). One pair: byte-identical to today. |
| `datasetChanged` | compares entries and refs; shape and tasks counted separately (`stepChangeCount`). |
| `PSEUDO` / `pointerToFieldName` | fields `/evaluator/datasets`, `/evaluator/run_shape`, `/evaluator/task/<envId>`; `heldOnHome` includes them. |
| `runEstimate(spec, envCount, cap)` | `runEstimate(spec, envUnits[], cap)` with units per environment from `evaluator_capabilities` (section 3.3). |
| `rawJson.ts` `EVALUATOR_KEYS` | add `datasets`, `run_shape`, `task`; `DATASET_SWEEP_MESSAGE` text per QD-80. |
| `useDatasetVersions(slug, name)` | one query per dataset box (cached by name). |
| `api/launch.ts` | `launchKeys.tasks`, `useEnvTasks(pid, eid, enabled)`, `EnvTasksPayload`; `EvalEnvironment.evaluator_capabilities`. |

## 8. Decisions

| Id | Decision | Reason | How to reverse |
|---|---|---|---|
| QD-D1 | The Datasets card keeps today's single `Select` as its zero state and adds the list after the first choice. | One dataset on Latest stays two clicks (BRIEF 6); the first interaction is the one users know. | Always show the list with an inline add select (one more 24 px row). |
| QD-D2 | The run shape is a `SegmentedControl` inside the Datasets card, visible from two pairs, default `Combine into one run`. | F1 names both; the combined run is the headline of the request and the only shape that gives the per-dataset breakdown; fan-out is one click away. | Default `One run each` (the shape every service supports). |
| QD-D3 | `Latest version` is an ordinary checkbox among the references; unticking the last snaps back to it. | A user may want Latest plus a pinned older version; an exclusive Latest would need a mode switch. A dataset with zero references has no meaning. | Make Latest exclusive. |
| QD-D4 | Per-environment task lives in the spec as `evaluator.task`, a string (all environments) or an object by environment id; the form always writes the object. | F2 says the list is per environment and the box owns the control; ids differ between registries; the brief fixed the key name `evaluator.task`. | Store `evaluator.tasks` only. |
| QD-D5 | New column `eval_experiment_jobs.dataset_index` (migration 0090) and a wider unique constraint. | Two jobs of one environment and combination would collide otherwise; encoding the pair into `combo_index` would break `eval_best_run_base`, which re-finds the sweep combination by that index, and the matrix. | Encode `combo_index = combo * 32 + pair` (no migration, breaks the two readers). |
| QD-D6 | A `datasets` list of one entry collapses to the scalar form. | A one-pair experiment must stay byte for byte today's (SDK/clone/readers, "keep the single support"). | Store the list always. |
| QD-D7 | Limit of 20 dataset versions per experiment (`QYM_EVAL_MAX_DATASETS`), and the sweep cap applies to the fan-out. | Bounded payload and a bounded request fan-out; 20 pairs x 2 environments already hit the cap of 64 with a 2-value sweep. | Raise the setting. |
| QD-D8 | Tasks are not live-validated as an error: unreachable service = warning `task_unverified`. | The service validates at submit; failing a launch because a list could not be read would block a launch the service may accept. | Make it an error. |
| QD-D9 | Best-run scope and the `Top-scoring run` text use the first dataset. | The best-run index is per dataset version; a union has no single score. | Disable best runs while more than one dataset is chosen. |
| QD-D10 | Environment tag on the home view instead of a review pane there. | The home view has no review pane; the numbers and the F3 note must be visible where the choice is made (density, not disclosure). | Put the note only in the bar's status line. |
| QD-D11 | The experiments list is unchanged. | Not asked; a Datasets column would widen a table with 5 columns at 1024. | Add a `Datasets` tag line under the name. |
| QD-D12 | A dispatcher guard blocks a stored body whose environment no longer declares `datasets` / `task`. | Silent wrong evaluation (a 202 on the first dataset) is the worst failure mode of a service that drops unknown keys. | Remove the guard. |
| QD-D13 | The versions-line `Refresh` also reads tasks. | One refresh per box (QA4-6 amended); two buttons would clutter a box that already holds Details and Refresh. | A second ghost button in the task row. |
| QD-D14 | The change request treats 404, 405 and 422 as "tasks unsupported" and asks to register the route before `/{job_id}`. | Measured behaviour of a UUID route. | n/a |
| QD-D15 | `Add another dataset` is a small neutral button, not a second select. | Keeps the single-dataset card 22.4 px taller rather than 46; the control is rare. | A visible select. |

## 9. Test plan

| File | Covers |
|---|---|
| `tests/platform/test_experiment_datasets.py` (new) | QD-71 to QD-77, QD-79 to QD-87, QD-91: normalisation, golden single-pair payload, errors, fan-out counts per case, cap, names, `qym_config`, sweeps, dry-run plan, detail selection. |
| `tests/platform/test_experiment_task.py` (new) | QD-76 to QD-78: per-environment task, support check, live check with the fake and failures. |
| `tests/platform/test_env_tasks_proxy.py` (new) | QD-93 to QD-97, QD-96: states, trimming, 0 service calls without `task`, key never echoed. |
| `tests/platform/test_eval_job_dataset_index.py` (new, runs on Postgres too) | QD-90, QD-91, QD-92, QD-100, QD-102: model, constraint, retry, queue order, migration up/down. |
| `tests/platform/test_eval_dispatcher_datasets.py` (new) | QD-98, QD-99: bodies per case, guard. |
| `tests/platform/test_eval_presets.py` (extend) | QD-65. |
| `tests/platform/test_experiment_clone.py` (extend) | QD-63, QD-64. |
| `tests/platform/test_launch_flags.py` (extend) | QD-88. |
| `tests/platform/test_eval_service_client.py` (extend) | QD-97. |
| `frontend/src/features/experiments/launch/model/datasets.test.ts` (new), `spec.test.ts`, `validation.test.ts`, `rawJson.test.ts`, `layering.test.ts`, `sweeps.test.ts`, `evaluator.test.ts` (extend) | QD-19, QD-29, QD-43, QD-47 to QD-49, QD-63 to QD-68, QD-72, QD-80, section 7 mappings, one-pair byte identity. |
| `launch/entry/__tests__/DatasetsCard.test.tsx`, `TaskRow.test.tsx`, `EnvironmentTags.test.tsx` (new) | QD-1 to QD-13, QD-20 to QD-22, QD-30 to QD-39. |
| `launch/review/__tests__/ReviewPane.test.tsx` (extend) | QD-40 to QD-44. |
| `features/experiments/lib/lib.test.ts` (extend) | QD-56 matrix rows, QD-57 groups, QD-59. |
| `frontend/src/__tests__/design-language.test.ts` + `pytest tests/platform/test_design_language.py` | QD-16, no new tokens. |
| `frontend/e2e/experiments/launch/multi-datasets.spec.ts` (new) | QD-1 to QD-24, QD-25 to QD-29 at three widths with axe, click count QD-9, request counts. |
| `frontend/e2e/experiments/launch/multi-task.spec.ts` (new) | QD-30 to QD-39 with the fake (list, 404, 422, 503, delay). |
| `frontend/e2e/experiments/launch/multi-review.spec.ts` (new) | QD-40 to QD-52, fan-out launch with a fake without `datasets`, raw JSON round trip. |
| `frontend/e2e/experiments/detail-datasets.spec.ts` (new) | QD-53 to QD-62, retry of a fanned-out job. |
| `frontend/e2e/experiments/launch/clone-multi.spec.ts` (new) | QD-63 to QD-70. |
| Fake service `frontend/scripts/fake_eval_service.py` (the brief wrote `frontend/e2e`; the fake lives in `scripts/`) | flags `--datasets` (schema declares `datasets` and `$defs.DatasetRef`), `--tasks` (declares `task`, serves `GET /evals/tasks`); `POST /__control/capabilities {"datasets": bool, "task": bool}`; `POST /__control/tasks {"tasks": [...], "status": 200\|404\|422\|503, "delay_ms": n}`; submit stores and echoes `datasets` / `task`, `422 {"detail": "unknown task: x"}`; flags off = v1.3 (`/evals/tasks` -> 422 UUID error, keys dropped). `tests/platform/fixtures/eval_evaluator_schema.json` gets a `-v14` sibling with the two properties. |

## 10. Hand-off (build order)

1. Migration 0090 + model (`dataset_index`, constraint), `superseded_job_ids`, queue order, retry copy (QD-90 to QD-92, QD-100, QD-102). Rebase on WP-C's 0089 when it exists.
2. `services/eval_evaluator_schema.evaluator_capabilities`, environment payload, `EvalServiceClient.tasks_list`, the proxy route (QD-93 to QD-97).
3. `services/eval_datasets.py` (normalise, validate, units), `EvaluatorInputs` additions, `_materialize` strips `run_shape`, `eval_sweeps.run_name` suffix, `create_experiment` expansion and cap, `qym_config`, dry-run plan, detail `selection`, clone, presets refusal, token warnings (QD-71 to QD-89).
4. Dispatcher guard and body tests (QD-98, QD-99).
5. Fake service flags, then the platform tests of section 9.
6. Frontend model (`datasets`, `runShape`, `tasks`, `buildSpec`, validation, rawJson, layering, estimate), api hooks.
7. UI: `DatasetsCard`, `TaskRow`, environment tags, review pane, step 1; then detail (selection card, matrix rows, grouped history).
8. e2e specs, `npm run check` and `pytest tests/platform` in chunks through `scripts/heavy.sh`, Postgres run; USER_GUIDE and `docs/internal/OPERATIONS.md` (`QYM_EVAL_MAX_DATASETS`), AGENTS.md env var list.

## 11. Migration note

0090 is needed (QD-D5): one column and one constraint on `eval_experiment_jobs`. Everything else lives in the spec JSON and `params`. `QYM_EVAL_MAX_DATASETS` (default 20) is the only new setting. No backfill.

## 12. Limits of this design stage

- The mocks are static: request counts (QD-28, QD-31), the live task fetch states (QD-33 loading with a delay, QD-36), polling stability (QD-61) and every API criterion are specified from the code and verified by the tests above, not by a mock. The mock of the loading and error states shows the geometry only.
- The `MultiSelect` panel is the real primitive and opens in the gallery; the "last version snaps back" frame is drawn statically. The accessible name `Versions of <dataset>` needs a new optional prop on `MultiSelect` (the trigger text is `Versions · N`); the mock uses the plain label.
- State-sheet columns are 352 px frames (content 310), not real column widths; the criteria quote the composed pages and the `md-s-single` real-column frame.
- The experiment detail mock draws Matrix with `DataTable` (the product's `MatrixCard` is a raw table that the design-language test allows only there); the implementation extends `MatrixCard` and `lib/matrix.ts`, and the heights of QD-56 are re-measured then (amendment rule, DESIGN_LANGUAGE 6).
- The blank band above `SectionHeader` in card titles is how the real detail page renders today (`current-detail-1440.png`); the mock reproduces it on purpose.
- WP-C's upload details (what a union run sends) are "per WP-C" in the change request; nothing here depends on them.
- Not designed: a `Datasets` column on the experiments list (QD-D11), best runs across a union (QD-D9), sweeping tasks in the form (API accepts it, the form does not offer it).
