# WP-D review: launch and service contract

Review stage (independent) of `spec-d.md` (QD-1 to QD-102) and `docs/evaluation-service-change-request-v1.4.md` on branch `feat/multi-dataset-launch`.
Measured 2026-10-23 in Chromium (Playwright, dark scheme, `document.fonts.ready` awaited) at 1440 / 1024 / 390 on the e2e seeds
(two datasets with versions plus a third, `production` on a v1.4 fake with `datasets` and `task`, `staging` on a v1.3 fake, a second v1.3 service for the
nine-job detail), SQLite for the browser, SQLite and PostgreSQL 16 for the platform tests. Evidence keys: **[R]** = measured by me in this review
(`frontend/e2e/experiments/launch/review-d.spec.ts` and the numbers the implementer's specs write with `QYM_SHOTS_DIR`), **[T]** = a named test of the package
that I ran and that passed (PA `test_experiment_datasets.py`, PT `test_env_tasks_proxy.py`, PD `test_eval_dispatcher_datasets.py`, PJ `test_eval_job_dataset_index.py`,
PM `test_migrations_0090.py`, PP `test_eval_presets.py`; V Vitest; E-D / E-T / E-R / E-C / E-X the five e2e specs of the implementation notes).
Decisions F1 to F4 and QD-D1 to QD-D15 are not reviewed.

## Result

| Verdict | Criteria (QD-1 to QD-102) | Change request checklist (CR-1 to CR-10) |
|---|---|---|
| MEETS | 97 | 9 |
| MEETS WITH FIXES | 1 | 1 |
| DOES NOT MEET | 4 | 0 |

Not MEETS: QD-22 (DOES NOT MEET (1024 production number only)); QD-23 (DOES NOT MEET (page height number; bar meets; cause is the seed's Start from card)); QD-27 (DOES NOT MEET (heights; content as specified)); QD-41 (MEETS WITH FIXES (59.4 to 57.0)); QD-45 (DOES NOT MEET (heights; widths meet)); CR-4 (MEETS WITH FIXES); 

Every DOES NOT MEET is a number that differs from the spec while the behaviour is the specified one; none is a functional defect. They are documented
limitations (no fix changes the value: the cause is the seed, a spec number that contradicts the spec's own rule, or a composition I could not reproduce).
The one defect found and fixed in code is QD-41.

## Fix pass on the five known failures

| Test | Cause | Change |
|---|---|---|
| `latency-sensitive.spec.ts` "a private test set carries its badge and the token help; plain datasets carry none" | opened with `?env=` (carries `golden`) and clicked the single Dataset select, which exists only in the zero state (QD-D1, deviation 9) | rewritten for the card: the carried `golden` box has no chip; `Add another dataset` menu lists `secret-set` with the `Private test set` chip (99 x 20, selectable); choosing it puts the chip on its box; Remove both boxes, then the zero-state select lists both with the same chip (99 x 20), `golden` without. The token help is asserted as before. The Add menu's chip now carries `data-testid="dataset-chip"` like the box and the select (one attribute in `DatasetsCard.tsx`) |
| same file "the not-sent warning reads the same sentence and measures the amended heights (B5-40)" | same | `Remove golden`, then choose `golden-private` in the zero-state select; the sentence is asserted verbatim and the heights are unchanged: 90.4 / 73.6 / 107.2 (1440 / 1024 / 390), the asserted 73.6 at 1024 passes without changing a number (before = after) |
| `cutover-launch.spec.ts` "a saved preset fills every field ..." | the first page load of a worker compiles the app in Vite; with two workers `openLaunch` waited the 8 s default for the step heading (failure at `launchSupport.ts:134`); passes alone in 5 s | the heading wait in `openLaunch` is 25 s, with a comment |
| `queue.spec.ts` "remote queue ... orphan" | waited 8 s for the `in flight` link after the remote list had loaded, two workers and the fakes share a small machine; passes alone | that wait is 25 s, with a comment |
| `a11y.spec.ts` "every page" | passes alone (5.6 s, 11 of 11 in 51 s). The failure was the 25 s poll of `waitForExperiment` (job sync of the platform) inside its `beforeAll` under load | `waitForExperiment` polls up to 60 s (returns as soon as ready), with a comment |

Final counts: `e2e/experiments/launch` 155 passed (before the review's own spec), `e2e/experiments` without launch 82 passed (a11y and queue green), then
the launch folder again with `review-d.spec.ts` (see Gate).

## Further checks (with numbers)

| Check | Result |
|---|---|
| Single-dataset path unchanged | one dataset on Latest = 2 clicks for the dataset (3 with the environment tick); `buildSpec` evaluator keys of the real launch POST: `["config","dataset"]` (no `datasets`, `run_shape`, `dataset_version` or `task`), equal to the last dry run (`review-d-single-path.json`) |
| Loading frames = loaded heights (rule 7) | task row: 24 = 24; production box 143 = 143 / 167 = 167 / 215 = 215 and staging 115 / 139 / 187 equal at 1440 / 1024 / 390 while the task list loads (1.5 s delay). Datasets card with dataset versions loading (1.5 s delay): box 67 = 67 and fieldset 117.2 = 117.2 (1440, 1024), 136.6 = 136.6 (390). Limitation outside WP-D: the transient `Checking schema…` tag (commit 3dd430ab) wraps the environment tags line for about 80 ms at 1024 and 390, so a box reads 191 then 167 (239 then 215) right after load; the box is stable from the moment the tag is gone, and the task row does not move it |
| No horizontal overflow | home, step 1, review and detail: `scrollWidth - clientWidth` = 0 at 1440, 1024 and 390 (twelve readings) |
| Keyboard order | Tab from the first trigger: `Versions · 2 of support-tickets`, `Remove support-tickets`, `Versions · 2 of billing-faq`, `Remove billing-faq`, `Add another dataset`, the run-shape radio (one stop) |
| axe | 0 serious / critical violations on the home view, step 1, review and detail at 1440, 1024 and 390 (twelve passes, finite animations settled first). My first review run showed contrast failures on the review step; they were half-faded colours during the step-enter animation, gone once the animations finished (`settled`) |
| Documents | `RELEASE_NOTES.md` (head `0090`, `QYM_EVAL_MAX_DATASETS`), `USER_GUIDE.md` (section `Experiments: several datasets and a task per environment`, 20 versions, sweep cap, one-dataset unchanged), `docs/internal/OPERATIONS.md` (head `0090` x3, 0090 row, setting row), `AGENTS.md` (`QYM_EVAL_MAX_DATASETS` default 20) agree with the spec; `settings.py` `eval_max_datasets` default 20; the migration chain head is `0090` (`test_migrations.py`) |
| Change request examples against the platform's schemas | new `tests/platform/test_change_request_v14.py` (3 tests, SQLite and PostgreSQL): section 8 schema additions, section 4.2 tasks example, section 3.1 request example. Found one text contradiction (empty task list), fixed |
| Spec test plan vs the tree | the spec's section 9 names `test_experiment_task.py`, `test_experiment_clone.py` and an extended `test_launch_flags.py`; the implementation put those cases in `test_experiment_datasets.py` (all QD-76 to QD-88 and QD-63 tests pass there). A documentation difference, not a gap |

## Fixes made in the review (before / after)

| Item | Before | After | Commit |
|---|---|---|---|
| QD-41 review Datasets row | 59.4 (lines 18 + 18 + gap 4); my first guess, a flex `li`, did not move the value and was reverted | `Text variant="sm"` for name and references like the spec's mock: lines 16.8 / 16.8, row 57.0 at 1440 / 1024 / 390 | 86aef605 |
| Change request: empty task list | `hides the control` (sections 4.2, 8, 12) | `shows the control disabled, reading No tasks listed` | 238b4ab7 |
| `latency-sensitive` x 2, `cutover-launch`, `queue`, `a11y` | red or timing out | green (counts below) | 026169b9, a292199d |
| Add menu chips | no test id | `data-testid="dataset-chip"` | 026169b9 |

## Documented limitations (DOES NOT MEET, no value to change)

- QD-22 (1024, production 191 against 167): the box holds `Healthy`, `Priority up to HIGH`, `Default preset v1` and `1 combined run` (375 px of tags) in 321.5 px, so the shape tag wraps. The spec applies exactly this rule to staging (163 = 139 + 24) and forgot it for production. A different value needs a different tags row (spec amendment).
- QD-23 (page height 1073 / 1249 / 1913 against 900 / 1012.5 / 1770.6): the seed's saved preset puts a `Start from` card below the Environments / Datasets row; the mock drew none. Bar 56 / 56 / 82.8 and the row heights are the spec's.
- QD-27, QD-45 (review pane 770 / 676.4 / 756.1 and 722.4 / 722.4 / 802.1 against 700.8 / 653.2 / 764.9 and 653.2 / 653.2 / 764.9): the pane carries the `Changes by step` block (about 97 px) and this does not explain the whole gap; I could not reproduce the mock's composition. Widths (352 / 777 / 279, 1193 / 777 / 279) match. After the QD-41 fix the real heights are 2.4 px lower than listed here.

## Not measured, and why

- The Evaluation Service half of the change request (validators, route, worker, union run, `result.datasets`): there is no v1.4 service; the fake echoes what it is sent. CR-2 and CR-8 are verified only for consistency of the document with the platform.
- QD-61 over a long run (one poll interval measured, as the implementation notes say).
- Matrix and history heights of QD-56 are the product's own `MatrixCard`, re-measured under spec section 12 (784.5 / 784.5 / 926.5 with three environments); I compared structure and the one number the mock shares (history table 559).
- Full-suite platform tests (`tests/platform` in chunks): not re-run in this review (only the touched files, below); the implementation's gate (impl-notes section 6) records them and nothing in platform code changed since except the new test file.

## Criteria

| Criterion | What I measured (element, width, number, or test and result) | Spec value | Verdict |
|---|---|---|---|
| QD-1 | [R] Dataset select 547.5 / 339.5 / 237 wide, 24 high (`measure-d-home-*.json`); no fieldset, no `run-shape` in the zero state (E-D `QD-1, QD-9` passed) | 547.5 / 339.5 / 237 x 24; card 73.4 at 390 | MEETS |
| QD-2 | [R] after the first choice `fieldset[data-testid=datasets-fieldset]` with one `li[data-dataset-box]`, no run shape (E-D passed; `review-d.spec` QD-8/7 test returns to the Select after two Removes) | fieldset, one box, foot, no shape | MEETS |
| QD-3 | [R] box 67 high at 1440 / 1024 / 390 (547.5 / 339.5 / 237 wide); name never truncated (`overflowing()` empty in E-D) | 67 at all widths | MEETS |
| QD-4 | [R] trigger 97 x 24 (spec <= 139), `aria-haspopup=dialog`; accessible name `Versions · N of <dataset>` (deviation 2: axe label-content-name-mismatch); tags 20 high | 24 high, <= 139, name `Versions of <dataset>` | MEETS |
| QD-5 | [R] panel rows 32 / 32 / 32 / 32 / 32: `Latest version`, `Version v3`, `v2`, `v1`, `Alias production`; 0 search, 0 select-all, 0 Only (`review-d-panel.json`); Space / Escape returns to trigger (E-D passed) | 32 px rows, no search/Select all/Only, Latest first, newest first | MEETS |
| QD-6 | [R] `pair-count` reads `1 dataset version`, `2 dataset versions from 2 datasets`, `4 dataset versions from 2 datasets`; bar `5 runs to launch` / `8` (E-D, `review-d.spec`) | texts of QD-6 | MEETS |
| QD-7 | [T] V `datasets.test` (`setEntryRefs` snaps to Latest), V DatasetsCard, E-D (`QD-5 to QD-8` passed) | last reference re-ticks Latest, announced | MEETS |
| QD-8 | [R] two Removes return to the Select (`review-d.spec`); focus to the next trigger / foot button (E-D `QD-5 to QD-8` passed) | Remove returns to QD-1; focus moves | MEETS |
| QD-9 | [R] dataset costs 2 clicks (`review-d-single-path.json`: clicks 2, 3 with the tick); evaluator keys of the launch POST `["config","dataset"]`, dry run equals launch | 2 clicks, no `dataset_version` | MEETS |
| QD-10 | [R] single-dataset fieldset 117.2 / 117.2 / 136.6; no `run-shape`, no `env-shape-tag`; no `Datasets and task` card on a plain detail (E-X plain) | 117.2 / 117.2 / 136.6 | MEETS |
| QD-11 | [T] E-D: menu lists the project's datasets minus chosen (2 left), button disabled when none; V DatasetsCard.chips. Menu chips now carry `dataset-chip` (review commit 026169b9) | Add another dataset, 159 x 24, menu without chosen ones | MEETS |
| QD-12 | [R] run-shape block 67.8 / 67.8 / 83.2, control 24 high and full width; options `Combine into one run` (default) and `One run each`; absent below two pairs | 67.8 / 67.8 / 83.2, 24 | MEETS |
| QD-13 | [R] help text compared character for character: combined `One run over the 2 dataset versions together. Every item records its dataset and version, and scores break down per dataset.`, one each `2 runs per environment, one per dataset version, grouped under this experiment.` | text of section 2.1 | MEETS |
| QD-14 | [R] composed fieldset 264 / 283.4 / 298.8; Environments card about 447 high at 1440 (screenshot, rows 146 to 593) | 264 / 283.4 / 298.8 | MEETS |
| QD-15 | [R] chip `Private test set` 99 x 20 in the zero-state list and in the Add menu and on the box; token help line on the first chipped box only (`latency-sensitive.spec` rewritten; V DatasetsCard.chips) | chips and help per box, one help line | MEETS |
| QD-16 | [R] legend `Datasets` computed 13px/600, identical to the `Environments` legend (13px/600); design-language test passes (`npm run check`). The spec's `12 px` is a slip: both legends are 13 | same recipe as Environments, no new token | MEETS |
| QD-17 | [R] Tab order from the first trigger: `Versions · 2 of support-tickets`, `Remove support-tickets`, `Versions · 2 of billing-faq`, `Remove billing-faq`, `Add another dataset`, run-shape radio (one stop); axe 0 serious at 1440 / 1024 / 390 on the home view (`review-d.spec`) | order and axe 0 | MEETS |
| QD-18 | [R] `scrollWidth - clientWidth` = 0 on home, step 1, review and detail at 1440 / 1024 / 390 (`review-d-views-*.json`); card overflowing() empty | 0 px overflow | MEETS |
| QD-19 | [T] V datasets.test, E-D (shape stays `One run each` after removing and re-adding a dataset; `buildSpec` omits it for one pair) | shape survives, hidden for one pair | MEETS |
| QD-20 | [R] `env-shape-tag`: `1 combined run` 88.6 x 20, warning tag 229.2 x 20 at 1440 / 1024, 219 x 26 at 390 (wraps); one per ticked environment, none for one pair | 88.6 / 229.2 / 26 high at 390 | MEETS |
| QD-21 | [R] production `1 combined run`, staging `4 runs, one per dataset version (older service)`; One run each: both `4 runs, one per dataset version`; bar 5 then 8 (E-D passed) | tags and counts 5 / 8 | MEETS |
| QD-22 | [R] staging 115 / 163 / 217 ok; production with task row 143 / 191 / 215: at 1024 the box is 191, spec 167. The spec's own rule (the box grows by the tag row where the tag wraps, staging 163 = 139 + 24) applies to production too: Healthy + Priority + Default preset + `1 combined run` = 375 px of tags in a 321.5 px box. Spec number is wrong, behaviour follows its rule (deviation 3) | 115 / 163 / 217 and 143 / 167 / 215 | DOES NOT MEET (1024 production number only) |
| QD-23 | [R] home bar 56 / 56 / 82.8 ok; page (scroll) height 1073 / 1249 / 1913 against 900 / 1012.5 / 1770.6. The seed has a saved preset, so the `Start from` card sits below the Environments/Datasets row (screenshot `after-d-home-composed-1440.png`); the mock drew no such card. Zero state of the same seed 1057 / 1148 / 1584: composing four dataset versions adds +16 / +101 / +329 to that page (the Environments card sets the row at 1440) | 900 / 1012.5 / 1770.6; bar 56 / 56 / 82.8 | DOES NOT MEET (page height number; bar meets; cause is the seed's Start from card) |
| QD-24 | [T] E-R `QD-24`: changing only the task or the shape issues one dry run each; Launch as is posts the same evaluator as the last dry run (`review-d-single-path`) | one dry run per change | MEETS |
| QD-25 | [T] E-D `QD-25 to QD-28`: inner text of card and boxes equal on home and step 1; contents 361.5 wide | same DOM and text, contents 361.5 | MEETS |
| QD-26 | [R] step 1: fieldset 361.5 x 264, production box 167 with the task row (`measure-d-step1-1440.json`, `measure-d-task-step1-1440.json`: row 343.5, select 306.1) | 264 / 167 at 1440 | MEETS |
| QD-27 | [R] review rail 352 x 770 (1440), 777 x 676.4 (1024), 279 x 756.1 (390) against 700.8 / 653.2 / 764.9. The pane holds a `Changes by step` block (heading + `Datasets changed` and `Task changed: production` rows, about 97 px in `after-d-review-pane-1440.png`) that implementation deviation 5 says the mock did not draw; I could not reproduce the mock's 700.8 composition, so the whole gap is not explained. Env lines 34.2 / 49.6 as specified. After the QD-41 fix the pane is 2.4 px lower than the number above | 700.8 / 653.2 / 764.9 | DOES NOT MEET (heights; content as specified) |
| QD-28 | [T] E-D `QD-25 to QD-28` and E-T `QD-28, QD-31`: 0 requests for versions / tasks / dataset versions Home to Customize; third environment issues the versions request and one tasks request | 0 requests; exactly the new ones | MEETS |
| QD-29 | [T] V datasets.test (`diffCount`), E-D `QD-29`: datasets once, shape once, task per environment | counts once / per environment | MEETS |
| QD-30 | [R] row 24 high directly after `[data-env-version]`, select 24 high, width 492.1 / 284.1 / 181.6 (spec 477.1 at a 514.5 content: the real card is 547.5, deviation 6); box +28 (115 to 143 at 1440, 139 to 167 at 1024, 187 to 215 at 390) | one row, 24 high; box +28 | MEETS |
| QD-31 | [T] E-T `QD-28, QD-31`: no row and no request for the environment without `task`; one request on first tick, none on untick or Customize, one per Refresh | requests as specified | MEETS |
| QD-32 | [T] V TaskRow + E-T geometry: `Worker default` first and selected, tasks in service order, description on a second line | Worker default first | MEETS |
| QD-33 | [R] task row loading frame: row 24 = 24 and box 143 = 143 (1440), 167 = 167 (1024), 215 = 215 (390), staging 115 / 139 / 187 equal (`review-d-loading-*.json`, once the pre-existing transient `Checking schema…` tag is gone). That tag (commit 3dd430ab, not WP-D) wraps the tags line for about 80 ms at 1024 and 390 (box 191 then 167, 239 then 215): documented limitation, not in this package | delta 0 +- 1 at 3 widths | MEETS |
| QD-34 | [T] E-T `QD-34`: select disabled showing `No tasks listed`, row 24 | disabled, `No tasks listed` | MEETS |
| QD-35 | [T] E-T `QD-35`: `Couldn't read tasks: <reason>`, launch not blocked | error text, min 24 | MEETS |
| QD-36 | [T] E-T `QD-36` for 404 / 405 / 422: no row, no error text, no console error | no row, no error | MEETS |
| QD-37 | [T] E-T `QD-37`: archived project, select disabled with its value | disabled | MEETS |
| QD-38 | [T] V datasets.test, E-T `QD-38`: request carries `evaluator.task` by environment id; unticking drops it | entry dropped with the environment | MEETS |
| QD-39 | [T] V TaskRow, E-T: accessible name `Refresh versions and tasks of <env>` with the row, `Refresh versions of <env>` without; second press harmless | names and one refetch | MEETS |
| QD-40 | [R] Environments row 107.2 / 91.8 / 122.5 (1440 / 1024 / 390); `review-env-lines` items 34.2 and 49.6 (1440), 34.2 / 34.2 (1024), 49.6 / 49.6 (390); text `production 1 combined run of 4 dataset versions · task Answer a ticket`, `staging 4 runs, one per dataset version (older Evaluation Service) · Worker default task` | 107.2 at 1440; lines 34.2 / 49.6 | MEETS |
| QD-41 | [R] Datasets row measured 59.4 before the fix (dataset lines were `base` text, 18 px each); `ReviewPane.tsx` now uses the small text size like the spec's mock (commit 86aef605): lines 16.8 / 16.8, Datasets row 57.0 at 1440 / 1024 / 390; Run shape row 36.2 (present only for N >= 2, V ReviewPane) | 57 / 36.2 | MEETS WITH FIXES (59.4 to 57.0) |
| QD-42 | [T] V ReviewPane + E-R `QD-42, QD-43`: one dataset and no task reads as before (`Environments` `staging, production`, `Dataset` one line, no `Run shape`) | today's text | MEETS |
| QD-43 | [T] E-R: composed `5` and `= 1 combination × (production: 1 combined run + staging: 4 runs) = 5 runs`; One run each `8` and `= 1 combination × (2 environments × 4 dataset versions) = 8 runs` | 5 and 8 with math lines | MEETS |
| QD-44 | [T] E-R `QD-44`: `Over the run limit` with `choose “Combine into one run”` text, 0 create requests, Launch disabled | callout, disabled | MEETS |
| QD-45 | [R] review step pane width 1193 / 777 / 279 ok; height 722.4 / 722.4 / 802.1 against 653.2 / 653.2 / 764.9 (same unexplained gap as QD-27, +69 / +69 / +37; the `Changes by step` block is part of it) | 653.2 / 653.2 / 764.9 | DOES NOT MEET (heights; widths meet) |
| QD-46 | [T] E-R `QD-46`: Edit on `Datasets changed` opens step 1 and focuses the first Versions trigger | focus first trigger | MEETS |
| QD-47 | [T] E-R `QD-47, QD-48`: Raw JSON shows `evaluator.datasets`, `run_shape`, `task`; a single pair shows neither; V datasets.test | form order, nothing for one pair | MEETS |
| QD-48 | [T] E-R `QD-47, QD-48`: Apply updates the form, re-serialised text equals the applied text; invalid text changes nothing (V datasets.test round trip) | round trip, 0 differences | MEETS |
| QD-49 | [T] E-R `QD-49, QD-50, QD-51` and V datasets.test: problems carry the pointers and texts of QD-49 with `stepId: where`; click focuses the field | texts and pointers | MEETS |
| QD-50 | [T] PA errors + V `locate`: server `form_pointer` maps back to the same fields; E-R | same pointers | MEETS |
| QD-51 | [T] E-R `QD-49, QD-50, QD-51`: `task_unverified` warning callout, never blocks | warning, no block | MEETS |
| QD-52 | [T] E-R `QD-52`: Launch posts once, 5 runs, 5 jobs, `job_count` 5, detail opens (`measure-d-launch.json`: jobs 5, production 1, staging 4) | one post, job_count = count | MEETS |
| QD-53 | [R] three environments, 4 dataset versions, 9 jobs: card 1193 x 213.3 / 777 x 268.1 / 279 x 318.3 (`review-d-numbers-*.json`), exactly the spec; plain experiment has no `Datasets and task` card (E-X plain); strip 81.4 / 81.4 / 242.1 | 213.3 / 268.1 / 318.3 | MEETS |
| QD-54 | [T] E-X `QD-53 to QD-58`: one `Tag kind=dataset` per pair in order, `Run shape` text, `What each environment ran` with task name or `Worker default task` | tags, shape, per-environment lines | MEETS |
| QD-55 | [R] stat strip 81.4 / 81.4 / 242.1; counts current jobs (9 in my launch, 5 in E-X) | 81.4 / 81.4 / 242.1 | MEETS |
| QD-56 | [R] 5 rows (`All 4 dataset versions` / `combined` first, then `<dataset> · <version>` with `#0 · pair k`, `—` where no job); matrix card 784.5 / 784.5 / 926.5 high with three environments (527.5 / 667.5 / 809.5 with E-X's two). Spec 413.2 / 425.2 / 665.2 was the mock's `DataTable`; spec section 12 reserves the re-measure for the product's `MatrixCard` (deviation 7) | 5 rows; height amended by spec section 12 | MEETS (structure; height re-measured per section 12) |
| QD-57 | [R] job history table 559 high at 1440 and 1024 (spec 559); groups: combined first, then the pairs, collapsible (E-X); group header `Tag kind=dataset` 20 high at 1440 / 1024 and 26 at 390 (label wraps), `review-d-numbers-*.json` | table 559; header tag 20, 26 at 390 | MEETS |
| QD-58 | [T] E-X: `Task` column visible above 480 px, shows `Answer a ticket` / `Worker default` | Task column 170 | MEETS |
| QD-59 | [T] E-X `QD-59` + PA retry + PJ: retry makes attempt 2 of the same pair and supersedes only it; matrix cell `↻ 1 earlier` | attempt + 1 same pair | MEETS |
| QD-60 | [T] E-X `QD-60`, PA queue rows: queue page shows `#0 · 2` for a fanned-out job | combo + ` · k` | MEETS |
| QD-61 | [T] E-X `QD-61`: one poll interval, group order and row heights unchanged (limit: not a long run, impl-notes section 5) | 0 layout shift | MEETS |
| QD-62 | [R] overflow 0 on the detail at 1440 / 1024 / 390; axe 0 serious at all three (`review-d.spec`) | 0 overflow | MEETS |
| QD-63 | [T] E-C `QD-63, QD-70` + PA `test_clone_returns_the_stored_selection_and_relaunches_identically`: same card, shape, tasks; relaunch bodies equal | round trip | MEETS |
| QD-64 | [T] E-C `QD-64`: task of an unticked environment dropped with the note; V datasets.test string task | note + string applies | MEETS |
| QD-65 | [T] PP (`test_eval_presets.py`): 422 `not_in_preset` for datasets / run_shape / object task, string task passes; V `buildPresetConfig` strips | 422 and strip | MEETS |
| QD-66 | [T] E-C `QD-66` + V: a starting point never touches datasets or shape; task string seeds only the base environment | untouched | MEETS |
| QD-67 | [T] V datasets.test (`baselineFrom`, `resetAll`): list, shape, tasks restored by Undo all (limit: union run base is WP-C) | baseline restored | MEETS |
| QD-68 | [T] E-C `QD-68`: `Top-scoring run` card names the first dataset and `and N more dataset(s)` | text | MEETS |
| QD-69 | [T] E-C `QD-69`: editor keeps the single Dataset select, no run shape, task row for its environment | single select | MEETS |
| QD-70 | [T] E-C `QD-63, QD-70`: rerun keeps shape and list, same job count per environment | same jobs | MEETS |
| QD-71 | [T] PA `test_entry_with_version_and_alias_is_invalid`, `test_malformed_entries_are_invalid` (SQLite and PostgreSQL green) | datasets_invalid with pointers | MEETS |
| QD-72 | [T] PA `test_one_entry_collapses_to_the_scalar_form`, `test_scalar_only_spec_is_unchanged`, `test_one_pair_list_is_stored_like_scalars`, `test_single_dataset_launch_is_unchanged` | scalar form stored, no list | MEETS |
| QD-73 | [T] PA `test_duplicates_and_limit`: `datasets_duplicate`, `datasets_limit` | 422 texts | MEETS |
| QD-74 | [T] PA `test_scalar_must_equal_entry_zero` | datasets_conflict | MEETS |
| QD-75 | [T] PA `test_run_shape_rules` | run_shape_invalid / without_datasets / default stored | MEETS |
| QD-76 | [T] PA `test_task_forms`, `test_string_task_applies_to_every_environment` | task forms | MEETS |
| QD-77 | [T] PA `test_task_unsupported_for_a_service_without_it`: text `Environment "staging" does not offer task selection; clear its task or deselect it.` | task_unsupported | MEETS |
| QD-78 | [T] PA `test_unknown_task_is_an_error`, `test_unverifiable_task_is_a_warning`, `test_task_per_environment_is_sent_and_stored` (`params.task = {id, name}`) | task_unknown / task_unverified | MEETS |
| QD-79 | [T] PA `test_fan_out_counts_and_bodies` (5 jobs), `test_one_each_fans_out_everywhere` (8), `test_sweep_multiplies_units_and_cap` (10 / 16, `sweep_cap` 422 on create, dry run reports without 422), indexes 0..N-1 | 5 / 8 / 10 / 16, cap | MEETS |
| QD-80 | [T] PA `test_sweep_rules`, `test_sweep_of_datasets_is_refused`, `test_task_sweep_makes_one_job_per_value` | sweep rule and text | MEETS |
| QD-81 | [T] PA `test_fan_out_counts_and_bodies`: combined has list + `dataset` + `dataset_version`, others none, no `run_shape` in any body, `task` only when non-null. Also `test_change_request_v14` (review): the CR's section 3.1 request is sent with `dataset` = first, `dataset_version` = first version, `datasets`, `task` | bodies | MEETS |
| QD-82 | [T] PA same test: run names `... · support-tickets v4`, `... · refund-cases latest` | pair run names | MEETS |
| QD-83 | [T] PA same test: `qym_config` of each job holds its unit's evaluator, no `run_shape` | qym_config per unit | MEETS |
| QD-84 | [T] PA `test_fan_out_counts_and_bodies` (`datasets_plan`), `test_errors_and_dry_run` | dry run plan | MEETS |
| QD-85 | [T] PA: detail `selection` for composed and for an old experiment (`datasets` of one entry, `run_shape: null`, `tasks: {}`) | selection object | MEETS |
| QD-86 | [T] PA `test_stored_spec_is_intent_not_expansion` | intent stored | MEETS |
| QD-87 | [T] PA bodies assertion (`run_shape` absent from every `request_body`), PD `test_run_shape_never_reaches_a_service`, E-R fake received | no run_shape toward a service | MEETS |
| QD-88 | [T] PA `test_dataset_token_warning_once_per_dataset` | once per dataset | MEETS |
| QD-89 | [T] PA `test_rate_limit_and_priority_rules_still_apply`; full suite in the gate (impl-notes section 6) | unchanged | MEETS |
| QD-90 | [T] PJ and PM on PostgreSQL 16 (container `qym-test-pg-multi-launch`): 135 passed, 0 skipped for the seven platform files of this package | Postgres green | MEETS |
| QD-91 | [T] PJ `test_a_retry_supersedes_only_its_own_pair`, PA `test_retry_keeps_the_pair_and_supersedes_only_itself` | own pair only | MEETS |
| QD-92 | [T] PJ `test_dispatch_order_follows_dataset_index`, PA `test_queue_order_includes_the_pair` | queue order | MEETS |
| QD-93 | [T] PT `test_tasks_are_listed_and_trimmed`, `test_non_members_are_refused` | 200 body, 403/404 for outsiders | MEETS |
| QD-94 | [T] PT `test_unsupported_answers` (404/405/422), `test_a_v13_service_answers_the_uuid_422`, `test_503_is_an_error_with_the_reason`, `test_unreachable_service_is_an_error`, `test_schema_without_task_makes_no_call` (0 service calls) | status table | MEETS |
| QD-95 | [T] PT `test_tasks_are_listed_and_trimmed` (trim), key absent from every error body (`assert KEY not in json.dumps(body)`); review test `test_the_tasks_response_of_section_4_2_...` keeps the CR's example entries unchanged | trim, no key | MEETS |
| QD-96 | [T] PT `test_capabilities_follow_the_stored_schema`, `test_capabilities_helper`; review test confirms the CR's section 8 additions make both capabilities true and v1.3 schema false | capabilities | MEETS |
| QD-97 | [T] PT `test_tasks_list_answers` (200, 404, 405, 422, 503, invalid JSON) | client unit tests | MEETS |
| QD-98 | [T] PD `test_single_dataset_body_is_the_v13_body`, `test_combined_job_sends_the_list_and_the_task`, `test_fanned_out_job_sends_one_pair`, E-R (fake received) | bodies per case | MEETS |
| QD-99 | [T] PD `test_guard_blocks_a_list_...` (wait_reason `The Evaluation Service no longer accepts datasets; launch again`), `..._a_task_...` (`... accepts task; launch again`), schema-less case; declared schema submits | guard | MEETS |
| QD-100 | [T] PA retry test: stored body resent, same `dataset_index`, attempt + 1 | retry | MEETS |
| QD-101 | [T] fake exercised by every E-* spec (v1.4 flags, 422 `unknown task`, v1.3 mode); E-T for the control endpoints | fake behaviour | MEETS |
| QD-102 | [T] PM: SQLite round trip with a linked run (downgrade refuses with a fan-out and changes nothing), revision chain, PostgreSQL real chain 0089 -> 0090 -> 0089 -> 0090 (3 passed on PostgreSQL 16); `tests/platform/test_migrations.py` head `0090` | 0090 up / down | MEETS |

## Change request checklist (`docs/evaluation-service-change-request-v1.4.md`)

| Item | What I checked | Verdict |
|---|---|---|
| CR-1 `DatasetRef` shape and 1 to 50 entries (section 3.1) | [T] `test_change_request_v14::test_the_request_example_of_section_3_1_...` takes the document's own request example (3 entries incl. an alias) through the create API: body `datasets` = the entries (keys only `dataset` / `version` / `alias`, nulls omitted), `dataset` = first entry, `dataset_version` = `v3`, `task` = `answer-ticket`, no `run_shape`. Platform cap is 20 (CR section 3.2 says so) | MEETS |
| CR-2 validators and exact texts the service must return (section 5) | Service-side, not testable here. The platform's own texts (`datasets_invalid`, `datasets_duplicate`, `datasets_conflict`, `task_unknown`) are separate (QD-71 to QD-78). I read section 5 against QD-71 / QD-73 / QD-74: same rules (empty, > limit, both version and alias, duplicate, `dataset` != entry 0, unknown task); the platform never sends an empty list (QD-72 collapses one entry; an empty list is refused by the form and the API) | MEETS (document consistent with the platform's rules; service half is the service team's) |
| CR-3 `GET /evals/tasks`, registered before `/{job_id}`, 200 / 503, one `default` (section 4.2) | [T] the document's 200 example passes the platform's `_trim_tasks` unchanged (id, name, description, default) and has exactly one default; 503 `{"detail": "could not list tasks: <reason>"}` shows the reason (`test_503_is_an_error_with_the_reason`); 404 / 405 / 422 = unsupported (`test_unsupported_answers`, `test_a_v13_service_answers_the_uuid_422`) | MEETS |
| CR-4 empty list behaviour (sections 4.2, 8, 12 row 8) | Found a contradiction: the document said an empty list `hides the control` and that support needs `at least one task`, the platform (QD-34, E-T `QD-34`) shows the control disabled with `No tasks listed`. Fixed the three sentences in `docs/evaluation-service-change-request-v1.4.md` (commit 238b4ab7) | MEETS WITH FIXES |
| CR-5 capability detection by the schema (section 8) | [T] the document's exact schema additions merged into the v1.3 fixture make `evaluator_capabilities` = `{datasets: true, task: true}`; the v1.3 fixture gives both false; `required` stays `["dataset"]`; the platform fixture `eval_evaluator_schema-v14.json` declares the same two keys | MEETS |
| CR-6 v1.3 service is never sent the new keys (section 7) | [T] PA `test_fan_out_counts_and_bodies` (staging gets one pair per job, no `datasets`), PD `test_guard_blocks_a_list_...` and `..._a_task_...` (stored body blocked when the schema stops declaring them), `test_task_unsupported_for_a_service_without_it` | MEETS |
| CR-7 v1.4 request bodies and `eval_input` echo (sections 3.1, 6) | [T] bodies as CR-1; the platform omits null `version` / `alias` keys on the wire (impl deviation 13), which the document's `DatasetRef` (defaults null, `extra=forbid`) accepts; the echo shows nulls after the service's validation. No `run_shape` toward the service | MEETS |
| CR-8 union semantics, SDK >= 2.1.0, `result.datasets`, upload payload (section 3.2, 6) | Not measurable on the platform side in this package: the union run's upload is WP-C (`spec-c.md` section 7); the document defers to it and the platform reads `datasets` from a run's `qym_config.evaluator` only (QD-67). Not verified against a real service (the fake echoes `datasets` / `task`, QD-101) | MEETS (document consistent; service behaviour not measurable here) |
| CR-9 appendix examples (curl, Python, guide sections A to G) | Read against the code: the Python example sends `dataset` = first pair and `dataset_version` = first pair's version like the platform; curl example bodies are valid v1.3-shaped requests. No contradiction found other than CR-4 | MEETS |
| CR-10 checklist of section 11 (11 items) | Items are for the Evaluation Service team (model, validators, route, registry, worker, echo, schema declaration, v1.3 contract tests, tests, guide merge, notice). The document lists them with exact texts and the platform detects each of them by the schema (CR-5), so the team can ship them independently; nothing on the platform side needs a change when the build declares the fields | MEETS |

## Gate

Logs in the session scratchpad `review-d/logs/` (`/tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/51864cf7-e4e4-455d-967b-8153416bc257/scratchpad/review-d/logs/`); every heavy run went through `gated-heavy.sh` (cost 3, 2 workers).

| Command | Result | Log |
|---|---|---|
| `playwright test e2e/experiments/launch` (first, before the review's spec) | 155 passed | `e2e-launch.log` |
| `playwright test e2e/experiments` without launch (14 files) | 82 passed (a11y, queue green) | `e2e-rest.log` |
| `npm run check` after the review's changes | typecheck, ESLint (0 warnings), Stylelint clean; Vitest 192 files / 1627 passed; design-language 54 passed | `check2.log` |
| `playwright test e2e/experiments/launch` (with `review-d.spec.ts`, after the QD-41 fix) | one run 167 passed, 1 failed (`tables.spec.ts` sweep dialog "element is outside of the viewport", unrelated, 3 of 3 pass alone); rerun 168 passed | `e2e-launch3.log`, `e2e-launch4.log` |
| implementation's five measuring specs with `QYM_SHOTS_DIR` | 43 passed | `measure.log` |
| platform: `test_experiment_datasets`, `test_env_tasks_proxy`, `test_eval_dispatcher_datasets`, `test_eval_job_dataset_index`, `test_migrations_0090`, `test_eval_presets`, `test_eval_service_client` | 135 passed on PostgreSQL 16 and SQLite (60 passed, 11 skipped on SQLite alone: the PostgreSQL cases) | run directly |
| platform: `test_change_request_v14.py` (new), `test_migrations.py`, `test_design_language.py` | passed | run directly |

No platform code changed in the review; `tests/platform` in chunks was not re-run (see Not measured).
