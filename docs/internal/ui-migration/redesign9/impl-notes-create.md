# Round 9, implementation A: experiment creation, one launch bar, review, priority per run, preset editor

Branch `ui/redesign9-create` (design tip 355b7e6e, `feat/experiment-key-scopes` merged first). Contract: `experiments.md`
(points 1-6 and 8). Migration **0099** `eval_experiment_jobs.priority` (chains on 0098 `api_key_kind`). Owner decisions
I1 / I2 and orchestrator decisions J2 (flag and block), J3 (keep "Set every run to"), J4 (High first within an experiment) are implemented.

## Backend (spec 11.1, 11.2, 11.6)

| Requirement | Change | Test |
|---|---|---|
| One task per experiment, per-environment pointer | `api/experiments.py` `_task_error(..., per_environment)`: a string task points at `/evaluator/task`, the old object form keeps `/evaluator/task/<envId>`; J2 is the existing `task_unsupported` 422 naming the environment | `tests/platform/test_experiment_datasets.py::test_task_unsupported_for_a_service_without_it` (pointer updated), `test_string_task_applies_to_every_environment` |
| `job_priorities` in the launch body, 422 `job_priority_unknown` | `JobPriority`, `_resolve_job_priorities` | `test_job_priority_unknown_key_is_a_422` |
| Cap per environment, manager rule | `_resolve_job_priorities` | `test_job_priority_is_capped_by_its_own_environment`, `test_job_priority_high_needs_a_project_manager` |
| Acknowledgement when any job is High, `preemption_warning` names High environments only | `_require_preemption_ack(high, names, ack)`, `_high_env_names` | `test_job_priorities_are_stored_per_job_and_counted` |
| Column, always set at launch | `EvalExperimentJob.priority`, migration `0099_job_priority.py` (Python backfill, both dialects) | `test_job_priority_migration_round_trips` (SQLite, PostgreSQL), `test_all_normal_launch_stores_the_resolved_priority` |
| Retry keeps the job's priority | retry path uses `eval_queue.job_priority(job, experiment)` | `test_retry_keeps_the_jobs_own_priority` |
| `priority` on job payloads, `priorities` counts | `_serialize_job`, `_serialize_experiment`, `_priority_counts` | `test_job_priorities_are_stored_per_job_and_counted` |
| J4 tie-break | `eval_dispatcher.priority_rank()` in the claim order and in `eval_queue.dispatch_order()` | `test_dispatch_order_submits_high_runs_first_within_an_experiment` |
| Docs | `USER_GUIDE.md`, `OPERATIONS.md` (queue order, migration table, head 0099), `RELEASE_NOTES.md`, change request 4.4 (informative, body unchanged) | `test_operations_docs_name_the_current_migration_head` |

No CLI job rows exist (`qym run list` carries runs), so the CLI is unchanged.

## Frontend: criterion -> change -> test

Files: `frontend/src/features/experiments/launch/` (`entry/TaskCard.tsx`, `entry/EnvironmentPicker.tsx`, `entry/entry.module.css`,
`review/LaunchBar.tsx`, `review/ReviewStep.tsx`, `review/ReviewParts.tsx`, `review/reviewStep.module.css`, `wizard/LaunchWizard.tsx`,
`wizard/steps.ts`, `model/jobPriorities.ts`, `model/datasets.ts`), `frontend/src/features/environments/` (`DefaultPresetEditorPage.tsx`,
`editor/ComparedWithCard.tsx`, `editor/EditorWhere.tsx`, `editor/PublishReview.tsx`). Deleted: `StepNav`, `WizardBar`, `LaunchActions`,
`ReviewPane`, `EnvTask` (`TaskRow.tsx`), `Outline`, `PublishPane`. E2E: `e2e/experiments/launch/{r9-create,r9-editor,multi-task}.spec.ts`
(+ `r9Support.ts`), Vitest: `TaskCard`, `ReviewStep`, `LaunchBar`, `jobPriorities`, `wizardLogic`, `datasets`.

| Id | Change | Test |
|---|---|---|
| C-1-1, C-1-2 | `.env` / `.dsBox` on `--bg-elevated`, `--border-default`, padding 8 14, hover `--bg-hover` (`entry.module.css`) | r9-create "boxes are --bg-elevated..." at 1440 / 1024 / 390 |
| C-1-3 | `.env[data-state=selected]` accent border, 3px rail, `--tint-soft` tint; same computed `border-inline-start` as the Start-from card | r9-create C-1-3 |
| C-1-4 | hover `--bg-hover`, cursor auto | r9-create C-1-4 |
| C-1-5 | `data-state=flagged` from the review items (`task_unsupported` / `task_unknown` with `environmentId`), `data-part=env-flag` line | r9-create C-1-5, multi-task C-2-6 |
| C-1-6 | tags in a selected box sit on an opaque elevated surface (axe: stacked tints gave 4.0 to 4.2:1); **amended**: tags are excluded from "darker than the container" | r9-create C-1-6 (1440, 390) |
| C-1-7 | Details / Refresh are text links in the head row, Versions is one inline row: 87.8 px at 1440 (mock 87.8), 111.8 px at 390 (mock 111.8) with two tags; 135.8 px with this seed's third "Default preset v1" tag at 390 | r9-create C-1-1 (1440, 390) |
| C-2-1..2-8 | `TaskCard` (one `Select`, union list by id with who offers each, availability row, help line), `selection.task` + `mixedTasks` in the model, backend pointer `/evaluator/task`, J2 flag and block | multi-task.spec.ts (rewritten), `TaskCard.test.tsx`, `datasets.test.ts` |
| C-3-1..3-9 | `LaunchBar` (`StepsBar` six fixed slots, home chrome shared with `HomeBar`), `launchBar.module.css` | r9-create point 3, `LaunchBar.test.tsx` |
| C-4-1..4-4 | review rendered by `ReviewStep` on the last step only; `.layout` is one column; bar status carries run count and first problem | r9-create point 4 |
| C-5-1..5-9 | `ReviewStep` (Summary rows, runs `DataTable` compact 32 px, cards under 760 px, Changes / Checks side by side) | r9-create points 5 and 6, `ReviewStep.test.tsx` |
| C-6-1..6-11 | `jobPriorities.ts`, `PriorityCell`, `review-priority-all`, `review-ack`, `job_priorities` in the request, prune and stale-key fallback in `useDryRun`, job Priority column on the detail page | r9-create point 6, `jobPriorities.test.ts`, `ReviewStep.test.tsx`, backend tests |
| C-8-1..8-8 | `DefaultPresetEditorPage` renders `LaunchWizard mode="editor"`; `EDITOR_STEPS`; `ComparedWithCard`, `EditorWhere`, `PublishReview`; the leave guard compares `locationKey` (a step change is not leaving) | r9-editor.spec.ts, `preset-editor.spec.ts` |

### Deviations and amendments (measured)

* **C-2-2** is measured on the card's content block (`data-part=task-section` is the inner stack, as in the mock: 73.8 px at 1440, 158.7 at 390); at 1024 the help line wraps and the block is 89 px.
* **C-5-7** says two columns of 543 px; the spec's own 14 px gap and 1193 px column give 589.5 px each (the mock screenshot shows 585). Implemented 589.5 px, equal columns, 14 px gap.
* **C-5-9** names a 1000 px frame (rows end at y 940), not 900: tested at 1440 x 1000.
* **C-3-7** the 390 bar is 91 px with a one-line status and 110 px when a long first problem wraps the status row (two rows of buttons never appear).
* **C-3-8** home bar at 390: 91 px with a one-line status, 110 with a wrapped one.
* **C-6-8** a row the user changed to the value the experiment default later takes keeps its marker (it is an individual choice).
* **C-8-6 / dataset in the editor**: a preset holds one dataset (the backend refuses `datasets`), so step 1 keeps the single `DatasetPicker` instead of `DatasetsCard`; steps 2-4 are identical (C-8-4 test: zero `data-part` differences).
* **J2 consequence for old specs**: the multi-dataset review scenarios used a named task on production with a v1.3 staging; that is now a flagged launch, so those specs run Worker default and the named-task cases live in multi-task.spec.ts.

### Assertions changed in existing specs (and why)

Review text moved from the always-visible aside to the Review step (`toReview` helper, `launchBar` for run count and first problem): entry, evaluation,
latency-sensitive, launch, multi-review, qa-b-home, sweeps, tables, versions. `[data-env-task]` rows gone (one Task section): clone-multi, multi-review,
review-d. Versions Refresh moved to the box head (qa-b-versions, versions: width diff 18 -> 32, line height 77/101 -> at most 50, tab order Refresh before Details).
Dataset box height 67 -> 75 (multi-datasets), token callout 73.6 -> 90.4 px at 1024 (latency-sensitive, now in the half-width Checks card).
HIGH launch needs the checkbox on the Review step instead of the dialog (launch.spec); the server `preemption_acknowledgement_required` resend path keeps the dialog.
Launch as is is `primary` (wizard). The preset editor specs read the release notes on the Review step and Publish from the bar.

## After-shots

`shots/after-page-{create-home, create-home-flagged, customize-where, customize-models, customize-settings, review, preset-edit, preset-publish}-{1440,390}.png`
(16 files). States: create-home = production and staging ticked, two datasets, task "Answer ticket"; create-home-flagged = "Summarize thread"
(only the first service offers it, the second box is flagged); review = the 6-run timeout sweep with run 1 High and run 4 Low (acknowledgement open);
preset-edit = step 1 of the editor; preset-publish = the editor's Review and publish with one change and release notes. Taken against the seeded dev stack
(`frontend/scripts/seed_experiments.py` data plus a sweep experiment) at 1440x900 and 390x844, dark theme.
