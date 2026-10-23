# WP-D implementation notes: launch and service contract

Branch `feat/multi-dataset-launch` (design `d20efbd4`, `850f26e8`, `6a386b6a`; implementation below). Spec: `spec-d.md` (QD-1 to QD-102,
decisions QD-D1 to QD-D15). Owner decisions F1 to F4: `BRIEF.md`. Measured with Playwright Chromium (headless), dark scheme, SQLite, platform
on 9000, Vite on 6010 (see deviation 1), two fake Evaluation Services on 9100 (v1.4: `datasets` and `task`) and 9101 (v1.3).
After-screenshots: `shots/after-d-*.png` (1440 / 1024 / 390); the measured numbers: `measure/after-d/*.json` (written by the e2e specs when
`QYM_SHOTS_DIR` is set). Change request: `docs/evaluation-service-change-request-v1.4.md` (finalised against `spec-c.md` section 7).

## 1. What was built (build order of spec section 10)

| Step | Commit subject | Files |
|---|---|---|
| 1 migration and model | `feat(experiments): eval_experiment_jobs.dataset_index and the wider job key (migration 0090)` (0089 cherry-picked from the SDK branch first) | `migrations/versions/0090_eval_job_dataset_index.py`, `db/models.py`, `services/eval_queue.py` (`dispatch_order`), `services/eval_dispatcher.py` (`claim` order) |
| 2 capabilities, client, proxy | `feat(environments): evaluator capabilities, tasks_list client call and the tasks proxy route` | `services/eval_evaluator_schema.py` (`evaluator_capabilities`), `services/eval_service_client.py` (`tasks_list`, `TasksUnavailable`), `api/eval_environments.py` (`evaluator_capabilities` on list/get, `GET .../{eid}/tasks`) |
| 3 experiments API | `feat(experiments): several dataset versions, run shape and per-environment task in the experiments API` | new `services/eval_datasets.py` (normalize, units, task check), `api/experiments.py` (expansion, cap, `datasets_plan`, `selection`, retry copies `dataset_index`, clone `environment_names`), `services/eval_config.py` (`EvaluatorInputs.datasets/task`, `run_shape` stripped in `_materialize`), `services/eval_sweeps.py` (`run_name` suffix, cap text), `services/eval_launch_flags.py` (token warnings over every dataset), `services/eval_experiments.py` (`qym_launch.dataset_index`), `settings.py` (`QYM_EVAL_MAX_DATASETS`) |
| 4 dispatcher and presets | `feat(experiments): dispatcher guard for datasets and task, presets refuse a dataset list` | `services/eval_dispatcher.py` (guard, `run_shape` defence), `services/eval_presets.py` |
| 5 fake service and tests | `test(experiments): datasets, task and tasks proxy tests; fake Evaluation Service v1.4 flags` | `frontend/scripts/fake_eval_service.py` (`--datasets`, `--tasks`, `/__control/capabilities`, `/__control/tasks`), `tests/platform/fixtures/eval_evaluator_schema-v14.json`, platform tests of section 2 |
| 6 frontend model | `feat(launch): dataset selection, run shape and task in the launch model` | `launch/model/datasets.ts` (new), `types.ts`, `document.ts`, `spec.ts`, `validation.ts`, `layering.ts`, `rawJson.ts`, `sweeps.ts` (`runEstimate` units), `api/launch.ts` (`useEnvTasks`, `useEnvTaskLists`), `useEnvData.ts` (capabilities, task ids) |
| 7 UI | `feat(launch): Datasets card, task row, environment shape tags and review lines`, `feat(experiments): detail page shows datasets, task, matrix rows per dataset version and grouped job history` | `entry/DatasetsCard.tsx`, `entry/TaskRow.tsx`, `entry/EnvironmentPicker.tsx` (shape tag), `entry/VersionsBlock.tsx` (Refresh), `review/ReviewPane.tsx`, `wizard/LaunchWizard.tsx`, `detail/SelectionCard.tsx`, `detail/MatrixCard.tsx`, `detail/JobHistoryCard.tsx`, `lib/matrix.ts`, `queue/` (`comboText`), `ui/MultiSelect` (`nameSuffix`) |
| 8 e2e, docs | `test(launch): ...`, `docs: user guide and agents.md ...`, `docs(eval service): change request v1.4 finalised ...` | `frontend/e2e/experiments/launch/multi-*.spec.ts`, `clone-multi.spec.ts`, `detail-datasets.spec.ts`; `docs/USER_GUIDE.md`, `docs/internal/OPERATIONS.md` (head 0090, `QYM_EVAL_MAX_DATASETS`), `docs/RELEASE_NOTES.md` (new top entry "October 2026 — Platform 2.1.0 / SDK 2.1.0", `### Experiments`), `AGENTS.md` |

Design decisions kept as written: QD-D1 (single Select as the zero state), D2 (shape control from two pairs), D3 (Latest is a checkbox), D4 (`evaluator.task` string or
object; the form writes the object), D5 (migration 0090), D6 (one entry collapses to the scalar form), D7 (20 versions, sweep cap on the fan-out), D8 (an unreadable task list is
a warning), D9 (best-run text and scope use the first dataset), D10 (shape tag in the box), D11 (list unchanged), D12 (dispatcher guard), D13 (Refresh reads tasks too),
D14 (404/405/422 = unsupported), D15 (`Add another dataset` is a small button, a menu).

How the model keeps one dataset exactly as before (spec section 7 asked for `doc.datasets`): `doc.dataset` stays the primary choice (name, first reference) and the new
`doc.selection` holds `extraRefs` (further references of the primary dataset), `more` (the other datasets), `runShape` and `tasks`. A one-dataset document therefore has the
same fields, the same `buildSpec` output (asserted: `evaluator` is `{dataset}` only) and every existing reader (`datasetValue`, layering, editor, best-run text) is untouched.
`datasetEntries(doc)` / `withEntries(doc, entries)` convert both ways.

## 2. Criterion -> change -> test

Tests: `PA` = `tests/platform/test_experiment_datasets.py`, `PT` = `test_env_tasks_proxy.py`, `PD` = `test_eval_dispatcher_datasets.py`, `PJ` = `test_eval_job_dataset_index.py`,
`PM` = `test_migrations_0090.py`, `PP` = `test_eval_presets.py`; `V` = vitest (`launch/model/datasets.test.ts`, `__tests__/DatasetsCard*.test.tsx`, `TaskRow.test.tsx`,
`EnvironmentTags.test.tsx`, `review/__tests__/ReviewPane.test.tsx`, `lib/lib.test.ts`); `E-D` = `e2e/experiments/launch/multi-datasets.spec.ts`, `E-T` = `multi-task.spec.ts`,
`E-R` = `multi-review.spec.ts`, `E-C` = `clone-multi.spec.ts`, `E-X` = `e2e/experiments/detail-datasets.spec.ts`.

| QD | Change | Test |
|---|---|---|
| 1, 2 | `DatasetsCard`: no dataset = today's `Select` (24 px, placeholder), first choice replaces it with `fieldset[data-testid=datasets-fieldset]` (legend `Datasets`) | V DatasetsCard (zero state, fieldset after choosing), E-D `QD-1, QD-9` |
| 3, 4 | `DatasetBox` (`li[data-dataset-box]`, `.dsBox` recipe moved into `entry.module.css`), `Versions` trigger (`MultiSelect` bar variant, `nameSuffix`) and one `Tag kind=version` per reference | V DatasetsCard (name, tags), E-D composed card (box 67, trigger 24 x 97, tags) |
| 5 | `MultiSelect` panel: Latest first, versions as the API lists them (newest first), `draft` tag, aliases; no search, no Select all, no Only | V DatasetsCard (order, draft), E-D references test (Space, Escape returns to the trigger) |
| 6 | `pairCountText` in `[data-testid=pair-count]` (polite); the home bar and the review use the real job count (`unitsInfo`, `runCount`) | V DatasetsCard, V datasets.test (runCount 5 / 8), E-D |
| 7 | `setEntryRefs` snaps an empty list back to Latest; the polite text says so | V datasets.test, V DatasetsCard, E-D |
| 8 | `removeDataset` (promotes the next dataset to primary); focus goes to the next box's trigger, else the foot's button | V datasets.test, V DatasetsCard, E-D (focus to billing-faq's trigger) |
| 9 | the zero state is today's Select: tick (1), open (2), choose (3); Latest sends no `dataset_version` | E-D `QD-1, QD-9` (3 clicks, dry run carries `dataset` only) |
| 10 | measured: single dataset fieldset 117.2 / 117.2 / 136.6 | E-D composed card at three widths |
| 11 | `Add another dataset` = `DropdownMenu` of the project's datasets minus the chosen ones, disabled when none is left | V DatasetsCard, V DatasetsCard.chips, E-D |
| 12, 13 | `RunShapeControl` (`SegmentedControl` `Run shape`, help text from `SHAPE_HELP`), rendered only from two pairs | V DatasetsCard, E-D (block 67.8 / 67.8 / 83.2, control 24) |
| 14 | composed card measured 264 / 283.4 / 298.8 | E-D |
| 15 | chip and token help line per box (first chip only) | V DatasetsCard (`QD-15`), V DatasetsCard.chips |
| 16 | `.legend` reused (same as Environments); no new token (`design-language` test) | `npm run test:design`, `pytest tests/platform/test_design_language.py` |
| 17 | DOM order Versions trigger, Remove (CSS grid places it in row 1), Add, shape radios; axe 0 serious at 1440 and 390 | V DatasetsCard (Tab order), E-D (axe) |
| 18 | no overflow; names wrap | E-D (`overflowing`, `expectNoPageOverflow` at three widths) |
| 19 | `selection.runShape` survives list edits; `buildSpec` omits it for one pair | V datasets.test, E-D |
| 20, 21 | `shapeTag` in `EnvironmentPicker` (`env-shape-tag`, info / warning), capabilities from the environment record | V EnvironmentTags, E-D (88.6 / 229.2 wide, 20 high; 5 then 8 runs) |
| 22 | measured box heights (see section 3) | E-D |
| 23 | measured home page and bar | E-D (bar 56 / 56 / 82.8) |
| 24 | `dryRunKey` covers the new spec keys: one dry run per change | E-R `QD-24` |
| 25 | the same `DatasetsCard` and environment boxes on step 1 | E-D `QD-25 to QD-28` (inner text equal, 361.5 wide contents) |
| 26 | measured on step 1: fieldset 264, production 167 (task, no tag wrap) | E-D, E-T step 1 |
| 27 | review rail measured (770 at 1440, see deviation 5) | E-R |
| 28 | one react-query entry per environment for versions and tasks, shared by home and step 1 | E-T (`QD-28, QD-31`), E-D (no new requests on Customize) |
| 29 | `diffCount` counts datasets once, shape once, tasks per environment; `LaunchWizard` step 1 tag | V datasets.test, E-D `QD-29` |
| 30, 32 | `EnvTask` / `TaskRow` under `EnvVersions`: `Task` label + `Select` (`Worker default`, tasks with descriptions) | V TaskRow, E-T geometry (24 high; 284.1 / 181.6 wide at 1024 / 390) |
| 31 | no row and no request for an environment without `task`; one request on first tick, none on untick or Customize | V TaskRow, E-T |
| 33 | skeleton + hidden `role=status`, box height delta 0 | V TaskRow, E-T (143 = 143) |
| 34, 35, 36, 37 | disabled `No tasks listed`; `Couldn't read tasks: <reason>`; unsupported = no row; archived = disabled select | V TaskRow, E-T (503, 404, 405, 422, archive) |
| 38 | `setTask` / `toggleEnvironment` drops the entry; the request carries `evaluator.task` by environment id | V datasets.test, E-T `QD-38` |
| 39 | `Refresh versions and tasks of <env>` when the row exists | V TaskRow, E-T |
| 40, 41, 42 | `EnvLines`, `DatasetLines`, `Run shape` row in `ReviewPane` (today's text for one dataset and no task) | V ReviewPane, E-R (line heights 34.2 / 49.6, datasets lines) |
| 43 | `runEstimate(spec, envCount, cap, units)` + `unitsMath` | V datasets.test, V ReviewPane, E-R |
| 44 | `Over the run limit` text adds `or choose “Combine into one run”`; no create request, Launch disabled | V ReviewPane, E-R `QD-44` |
| 45 | review step pane measured | E-R |
| 46 | `Edit` on `Datasets changed` reveals step 1 and focuses the first Versions trigger | E-R `QD-46` |
| 47, 48 | `readDatasets` / `readTask` / `listFrom` in `rawJson.ts`; round trip | V datasets.test (round trip, invalid), E-R `QD-47, QD-48` |
| 49 | `datasetErrors`, `taskErrors` in `validation.ts`; `locate` maps `/evaluator/datasets`, `run_shape`, `task/<env>` to step 1 | V datasets.test, E-R `QD-49` |
| 50 | server errors keep their `pointer`, `locate` handles them | PA (errors), V datasets.test (locate) |
| 51 | `task_unverified` callout in `LaunchWarnings` | E-R `QD-51` |
| 52 | launch posts once; `job_count` equals the review count | E-R (5 runs, 5 jobs, `job_count` 5) |
| 53, 54 | `SelectionCard` (`section[aria-label="Datasets and task"]`, `detail-datasets`, shape, `detail-env-lines`); `selection` in the detail payload | E-X, PA (selection) |
| 55 | the stat strip counts current jobs | E-X (5) |
| 56 | `buildMatrix` rows per (combination, dataset): `All 4 dataset versions` / `combined`, `<dataset> · <version>` / `#0 · pair k`, `—` | V lib.test, E-X |
| 57 | job history `groupBy`: combined first, then pairs, collapsible | V lib.test (`jobGroup`), E-X |
| 58 | `Task` column (170, priority 3) | E-X |
| 59 | retry copies `dataset_index`, `params`; `retry_of_job_id` supersedes only its row | PA (retry), PJ, E-X `QD-59` |
| 60 | queue rows carry `dataset_index`; `comboText` shows `#0 · 2` | PA (queue rows), E-X `QD-60` |
| 61 | stable ordering (rows sorted by group order) | E-X `QD-61` (one poll, row heights equal) |
| 62 | no overflow | E-X |
| 63 | clone returns the spec as stored; `baselineFrom` reads `datasets`, `run_shape`, `task` | PA (clone round trip), E-C `QD-63, QD-70` |
| 64 | task entries of environments not ticked dropped with a note naming them (`environment_names` on the clone prefill) | V datasets.test, E-C `QD-64` |
| 65 | presets refuse `datasets` / `run_shape` / an object `task`; `buildPresetConfig` strips them | PP, V datasets.test |
| 66 | `taskEnvId` seeds only the base environment's row (and only when it lists the id); the Datasets card is untouched by a starting point | V datasets.test, E-C `QD-66` |
| 67 | `baselineFrom` reads a best run's `datasets`; `resetAll` restores list, shape, tasks | V datasets.test |
| 68 | `bestRunDatasets` in `StartFrom` | E-C `QD-68` |
| 69 | the editor keeps `DatasetPicker` (single select) and gets `EnvTask` for its environment | E-C `QD-69` |
| 70 | rerun = clone + launch: same jobs per environment, same `selection` | E-C `QD-63, QD-70` |
| 71 to 77 | `eval_datasets.normalize` and the per-environment task checks in `create_experiment` | PA (`test_entry_with_version_and_alias...`, malformed entries, duplicates and limit, scalar conflict, run shape rules, task forms, task_unsupported) |
| 78 | `check_tasks` (one parallel read per environment, 5 s), `task_unknown` error, `task_unverified` warning, `params.task = {id, name}` | PA (`test_task_per_environment...`, `test_unknown_task...`, `test_unverifiable_task...`) |
| 79 | units per environment feed `eval_sweeps.expand(environment_count=...)`; `sweep_cap` before any write | PA (`test_fan_out_counts_and_bodies`, `test_one_each...`, `test_sweep_multiplies_units_and_cap`) |
| 80 | `normalize` refuses sweeps on datasets, shape and the mirrored scalars; a task sweep is accepted | PA (`test_sweep_rules`, `test_task_sweep_makes_one_job_per_value`) |
| 81, 82, 83 | `unit_document`, `params`, run name suffix, `qym_config` from the unit | PA (`test_fan_out_counts_and_bodies`) |
| 84 | dry run `datasets_plan`, per-job `dataset_index`, `dataset`, `datasets`, `task` | PA (`test_fan_out_counts_and_bodies`, `test_errors_and_dry_run`) |
| 85 | detail `selection` and per-job fields | PA, E-X |
| 86 | the stored spec is intent, not expansion | PA (`test_stored_spec_is_intent_not_expansion`) |
| 87 | no body, `qym_config` or response toward a service carries `run_shape` | PA (bodies), PD, E-R (fake received) |
| 88 | token warnings iterate every dataset once | PA (`test_dataset_token_warning_once_per_dataset`) |
| 89 | rate limit, priority, latency gate untouched | the existing `tests/platform` suite, PA (`test_rate_limit_and_priority_rules_still_apply`) |
| 90 | model, constraint, retry and ordering on PostgreSQL | PJ and PM run on both backends |
| 91 | `superseded_job_ids` already keys on `retry_of_job_id`: a retry supersedes only its own pair | PJ, PA |
| 92 | `dispatch_order()` and `claim` order by `dataset_index` | PJ (claim order), PA |
| 93 to 95 | proxy route `GET .../eval-environments/{eid}/tasks` (status ok / unsupported / error, trimmed entries, no key in the body) | PT |
| 96 | `evaluator_capabilities` on environment list and get | PT |
| 97 | `EvalServiceClient.tasks_list` for 200, 404, 405, 422, 503, invalid JSON | PT (`test_tasks_list_answers`) |
| 98 | dispatcher sends the stored body; `run_shape` removed as a defence | PD, E-R (fake received: list + task / one pair each) |
| 99 | `_unsupported_evaluator_keys` guard: `BLOCKED`, `wait_reason` `The Evaluation Service no longer accepts datasets; launch again` | PD |
| 100 | retry resends the stored body with the same `dataset_index` | PA (retry), PD |
| 101 | the fake stores and echoes `datasets` / `task`, `422 unknown task: <id>`, flags off = v1.3 | exercised by every e2e spec |
| 102 | migration 0090 (column, check, wider key; downgrade refuses while a fan-out exists; SQLite batch rebuild keeps run links) | PM (SQLite round trip with a linked run, PostgreSQL real chain 0089 -> 0090 -> 0089 -> 0090), `test_migrations.py` (head `0090`) |

## 3. Measured numbers next to the spec's

Spec value / measured (Chromium, web fonts). Everything not listed matches to the first decimal.

| Element | 1440 | 1024 | 390 |
|---|---|---|---|
| Dataset Select (QD-1) width | 547.5 / 547.5 | 339.5 / 339.5 | 237 / 237 |
| Single dataset fieldset (QD-10) | 117.2 / 117.2 | 117.2 / 117.2 | 136.6 / 136.6 |
| Dataset box (QD-3) | 67 / 67 | 67 / 67 | 67 / 67 |
| Versions trigger (QD-4) | 24 high, <= 139 / 24 x 97 | same | same |
| Run shape block (QD-12) | 67.8 / 67.8 | 67.8 / 67.8 | 83.2 / 83.2 |
| Composed fieldset (QD-14) | 264 / 264 | 283.4 / 283.4 | 298.8 / 298.8 |
| `1 combined run` tag (QD-20) | 88.6 / 88.6 | 88.6 / 88.6 | 88.6 / 88.6 |
| Warning tag (QD-20) | 229.2 / 229.2 | 229.2 / 229.2 | 26 high, 219 wide / 26 high, 219 wide (wraps) |
| Staging box with the warning tag (QD-22) | 115 / 115 | 163 / 163 | 217 / 217 |
| Production box with task row (QD-22) | 143 / 143 | 167 / **191** (deviation 3) | 215 / 215 |
| Home bar (QD-23) | 56 / 56 | 56 / 56 | 82.8 / 82.8 |
| Task row (QD-30) | 24 / 24 | 24 / 24 | 24 / 24 |
| Task select width (QD-30) | 477.1 / 492.1 (deviation 6) | 284.1 / 284.1 | 181.6 / 181.6 |
| Task loading frame (QD-33) box delta | 0 / 0 | | |
| Step 1: fieldset / production box (QD-26) | 264 / 264, 167 / 167 | | |
| Review pane, composed (QD-27, QD-45) | 700.8 / 770 (deviation 5) | 653.2 / 676.4 | 764.9 / 756.1 |
| Review env lines (QD-40) | 34.2 and 49.6 / 34.2 and 49.6 | 34.2 / 34.2 | 49.6 / 49.6 |
| Detail card (QD-53) | 213.3 / 175.2 (2 environments, deviation 8) | 268.1 / 214.5 | 318.3 / 264.7 |
| Detail matrix (QD-56) | 413.2 / 527.5 (deviation 7) | 425.2 / 667.5 | 665.2 / 809.5 |
| Stat strip (QD-55) | 81.4 / 81.4 | 81.4 / 81.4 | 242.1 / 242.1 |

## 4. Deviations, with reasons

1. **Vite port 6010, not 6000.** `fetch` (undici, used by `e2e/global-setup.ts`) refuses port 6000 (`bad port`, it is on the browser's unsafe-port list). Everything else on the assigned ports (platform 9000, fakes 9100 / 9101).
2. **The Versions trigger's accessible name is `Versions · N of <dataset>`, not `Versions of <dataset>` (QD-4).** axe reports a serious `label-content-name-mismatch` when the visible text (`Versions · 2`) is not inside the accessible name. New optional `MultiSelect` prop `nameSuffix` composes it.
3. **Production box at 1024 is 191 px with two environments ticked and datasets chosen, 167 px with the task row only (QD-22).** The `1 combined run` tag does not fit the tags line next to `Healthy`, `Priority up to HIGH` and `Default preset v1` in a 321.5 px box and wraps (+24). At 1440 and 390 the numbers are the spec's.
4. **Page heights (QD-23)** are measured as the scroll height of the app shell (1073 / 1249 / 1913), which includes the page header and the `Start from` cards below the fold (the seeded project has a saved preset). The mock composed pages did not draw those cards; the home bar (56 / 56 / 82.8), the cards and the box heights are the spec's.
5. **Review rail (QD-27, QD-45)** is 770 / 676.4 / 756.1 against 700.8 / 653.2 / 764.9: the real pane has the `Changes by step` rows for `Datasets changed`, `Run shape changed` and `Task changed: production` (three rows with an `Edit` button) that the mock did not draw.
6. **Task select width at 1440 is 492.1** (spec 477.1): the spec measured it in a 514.5 px sheet content, the real home card has 547.5. 1024 and 390 match.
7. **Matrix and history heights (QD-56, QD-57)** differ from the mock's `DataTable` by design (spec section 12): the product's `MatrixCard` is a raw table with cell actions.
8. **The detail example has two environments and five jobs** (the seed of the e2e), not three environments and nine jobs; the card and strip heights follow.
9. **Changing the dataset of a carried starting point is `Remove` then choose (3 clicks)** instead of the two-click Select (a consequence of QD-D1; the empty home view is still 3 clicks in total, QD-9).
10. **The detail payload lists the experiment's environments in launch order** (it was sorted by id). Needed so the detail card and the matrix columns read in the order the user chose.
11. **Clone prefill gains `environment_names`** (not in the spec) so the QD-64 note can name an environment that is no longer available.
12. **Raw JSON refuses a swept `task`** ("cannot be swept in this form") although the API accepts it (QD-80: the form does not offer it).
13. **`evaluator.datasets` entries on the wire omit null keys** (`{dataset, version}` instead of `{dataset, version, alias: null}`); the server normalises both.
14. The home bar hides the run count below 961 px (existing behaviour); the e2e checks it is attached, the review pane shows it.

## 5. Not done / limits

- QD-61 is checked over one poll interval with row heights and group order, not over a long run.
- No e2e for presets saved from a multi-dataset experiment (the API refusal is a platform test and the form strips the keys, `buildPresetConfig` unit test).
- A combined job's run as a best-run base is WP-C's `union_run` rule; this package reads `datasets` from a run's `qym_config.evaluator` (a combined job's snapshot has no `run_shape`, QD-87, so the form takes the default shape `combined`).

## 6. Gate (2026-10-23, after the 2026-10-22 18:45 session kill; every run through the session gate lock, `-n 2`, cost 3 unless noted)

Logs: `scratchpad/wp-d/logs/` of the session.

| Command | Result | Log |
|---|---|---|
| pytest SQLite chunks d_aa..d_af | passed | `pytest-sqlite-d_*.log`, `pytest-sqlite2-d_*.log` |
| pytest SQLite chunks d_ag, d_ah | 410 passed / 65 skipped; 325 passed / 89 skipped | `pytest-sqlite3-d_ag.log`, `pytest-sqlite3-d_ah.log` |
| pytest PostgreSQL d_aa..d_ah | 613/11, 537/3, 307, 711/4, 369/21, 410/9, 475, 413/1 passed/skipped; one timing failure in d_ab (`test_dataset_items_batch.py::test_a_batch_of_5000_items_uses_a_constant_number_of_statements`, 1.106 s against 1.0 s under load, untouched code, passes alone) | `pytest-pg-d_*.log`, `pytest-pg.summary` |
| `tests/platform/test_migrations_0090.py` on PostgreSQL | 3 passed | run directly |
| `pytest tests/sdk -q -n 2` | 500 passed, 4 skipped | `sdk.log` |
| `pytest tests/platform/test_design_language.py` | passed | `designlang.log` |
| `npm run check` | Vitest 1627 passed, design-language 54 passed, typecheck / ESLint / Stylelint clean | `check.log` |
| `npm run build`, `npm run build:sdk` | built | `build.log`, `buildsdk.log` |
| Playwright `e2e/experiments/launch` (2 workers) | 152 passed, 3 failed: `cutover-launch.spec.ts` "a saved preset fills every field" (passes alone: load), `latency-sensitive.spec.ts` "a private test set carries its badge" and "the not-sent warning reads the same sentence" (fail alone: these two tests click the single Dataset select after the starting point carried `golden`; with QD-D1 a carried dataset is a box with Remove, not a select; the tests predate the card and are rewritten in the review's fix pass) | `e2e-launch.log`, `e2e-rerun-failing.log` |
| Playwright `e2e/experiments` without launch (2 workers) | 70 passed, 2 failed: `a11y.spec.ts` "every page" (120 s timeout waiting for a fake job to succeed under load), `queue.spec.ts` "remote queue ... orphan" (passes alone: load) | `e2e-experiments.log`, `e2e-rerun-failing.log` |

The two deterministic failures and the three load failures are handed to the review stage's fix pass.
