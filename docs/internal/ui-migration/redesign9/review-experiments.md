# Round 9 review: experiment creation, Customize bar, Review, preset editor, environment pages and tables

Reviewer: independent agent (stage 3 of 3). Branch `ui/redesign9-review`, combined tip `ab1607d5`. Spec: `experiments.md` (72 criteria
`C-<point>-<n>`, J1 to J4 as decided by the orchestrator). Measured in Chromium (Playwright) against the production build
(`npm run build`, served by the platform on :8994, SQLite, two fake Evaluation Services on :9094 / :9095 with `--datasets --tasks`),
dark theme, 1440x900 (1440x1000 where the spec says so), 1024 and 390, seed = the A seed (`frontend/scripts/seed_experiments.py`
data: project `exp-demo`, environments production and staging, datasets support-tickets v1-v3 and billing-faq v1-v2, a 3-value timeout
sweep) plus staging capped at NORMAL (production at HIGH). Scripts and raw output are the reviewer's scratchpad (`r9/rv/m*.cjs`).
Where a number is a computed colour it is the resolved colour composited over its ancestors. "e2e" means the Playwright spec passed in
the gate of section 6 and its assertion was read.

## 1. Criterion table

Verdicts: M = MEETS, F = MEETS WITH FIXES, X = DOES NOT MEET. Amendments are judged by the brief's rule (spec carries number and reason
marked **amended**, and an e2e asserts the same number).

### Point 1: boxes (shots `review-create-home-{1440,390}`, pair `mock-page-create-home-*` / `after-page-create-home-*`)

| Id | Required | Measured | V |
|---|---|---|---|
| C-1-1 | env and dataset box `--bg-elevated` #222232, 1.10 +- 0.02 on the card (#1a1a28), lighter at 1440/1024/390 | #222232 on #1a1a28, 1.099, lighter, at 1440 and 390 (same tokens at 1024); dataset box identical | M |
| C-1-2 | 1px `--border-default`, radius md, padding 8 14 | 1px #3b3b54, 8px, 8px 14px at 1440, 1024, 390 | M |
| C-1-3 | accent border + 3px rail, tint fill, border vs fill >= 6:1, same border-inline-start as Start-from | 1px + 3px solid #00d4aa, fill #1e3740, 6.56:1; Start-from card 3px solid rgb(0,212,170) (its fill #173038 differs from the box fill by design of the mix) | M |
| C-1-4 | hover `--bg-hover` #2a2a3c, cursor auto (1440) | #2a2a3c, auto | M |
| C-1-5 | flagged: `--error` border and rail, `env-flag` text >= 4.5:1, box keeps checked box | border #ef4444, rail 3px #ef4444, flag text #ee7778 5.62:1, checkbox checked, same at 1440/1024/390 | M |
| C-1-6 **amended** | 0 non-Tag elements darker than their container; text >= 4.5:1 | 0 darker, 0 low-contrast text nodes (1440, 390); spec carries the amendment with axe 4.0-4.2:1; e2e asserts the same (tags excluded, 4.5) | M |
| C-1-7 | ticked box with Versions 88 +- 6 (1440) / 112 +- 8 (390) | 1440: 87.8. 390: production (two tags) 111.8; staging (three tags, the third is "Default preset v1") 135.8 and 1024 production 111.8. The spec line is not amended for the third tag; e2e asserts 136 +- 8 | F |

### Point 2: task (shots `review-create-home-flagged-*`, `review-launch-models-1440`)

| Id | Required | Measured | V |
|---|---|---|---|
| C-2-1 | 0 Select/Task control in a box; exactly 1 Task select | 0 in boxes, 1 `task-select` at all widths | M |
| C-2-2 **amended** | directly above env-section, gap 14; 74 +- 4 / 148 +- 12 / <= 92 | 73.8 / 152 / 89.2, gap 14.0; spec carries the amendment, e2e asserts 74+-4, 148+-12, <=92 | M |
| C-2-3 | 24 px, 360 wide (1440, 1024), card content width at 390, "Worker default" first, descriptions name offerors | 24; 360; 237 (= card content, spec says 235); items "Worker default - Every environment runs its own default", "Answer ticket - ... production and staging", "Summarize thread - staging only" | M |
| C-2-4 | union by id, first appearance, Worker default first; 1 request per environment, 0 extra | list order and de-duplication as required (production+staging: Worker default, Answer ticket, Classify intent, Summarize thread); 1 request per environment, 0 extra: onLoad 0, after production 1, after staging 2, after re-ticking 2 | M |
| C-2-5 | 0 ticked: disabled, "Pick an environment first", same height | disabled, text present, 73.8 / 89.2 / 152 with 0, 1, 2 ticked (0 px change) | M |
| C-2-6 | flag box, availability tag danger, 1 problem naming env and task, Launch disabled; fixing clears all four within 600 ms | all four appear within 3 ms and Launch / Launch as is are disabled; the problem text names the task by id ("summarize", not "Summarize thread"); clearing took 780 ms (dry-run debounce 600 + request) at all widths | F |
| C-2-7 | section absent when no env declares `task` | not reproducible live (the schema is cached); e2e `multi-task.spec.ts` "C-2-7" passed | M |
| C-2-8 | launch body: one string or absent; clone of per-env shows the common value or "Different per environment", read only | body `task: "answer-ticket"`; Worker default sends no `task`; clone with equal per-env values shows "Answer ticket", with different values "Different per environment" and a disabled select | M |

### Point 3: one bar (shots `review-customize-settings-*`, `review-create-home-flagged-390`)

| Id | Required | Measured | V |
|---|---|---|---|
| C-3-1 | six steps: 56 +- 1, top edge fixed, 0 style differences | height 56, same bg #222232, border, radius 8, shadow, `position: sticky` on all six steps (1440, 1024). The top edge is NOT fixed: bar y = 819.3 (where), 745.1 (start), 844 (models..review) at 1440 and 844 / 792.9 / 844 at 1024, because short steps leave the sticky bar under the content instead of at the viewport bottom, so the bar jumps between steps | F |
| C-3-2 | six parts, 5 buttons, every step, every width | `bar-back, bar-skip, bar-continue, bar-status, bar-cancel, bar-launch`, 5 buttons, 6 steps x 3 widths | M |
| C-3-3 | x differs <= 1 px across steps (1440) | 0 px (Back 227, Skip 289, Continue 402, status 491, Cancel 1198, Launch 1270; same at 1024 and 390) | M |
| C-3-4 | Skip and Continue disabled and out of the Tab order on review, enabled elsewhere | disabled on review, enabled on the other five steps (`disabled` and `aria-disabled="true"`, no tabindex; Tab from Back lands on Cancel) | M |
| C-3-5 | label `Launch N runs`, fixed min width, nothing moves | min-inline-size 120; Launch spans 1270-1390 and Cancel 1198-1262 with 6 runs and with 1 run (label "Launch 6 runs" / "Launch") | M |
| C-3-6 | all buttons 24 high, 11/600, no 32 / 42 px bar | 24, 11px/600 for all 5 buttons on 6 steps; 0 `Step navigation` elements outside the bar | M |
| C-3-7 | 390: two rows, <= 91, no overflow, 5 buttons, no menu | 90.8 with a one-line status, scrollWidth = clientWidth (277), 5 buttons. A short problem ("Fix 1 problem first: Name") stays 90.8; a long problem that wraps makes it 110 (the flagged-task text, shot `review-create-home-flagged-390`): the spec line carries no such case and the e2e limit was changed to 112 without an amendment | F |
| C-3-8 | home bar same chrome, 56 (110 at 390 with the name row) | 1440: 56, chrome identical to the wizard bar. 390: 90.8 (no env), 110.2 (name missing), 127 ("Ready: Default preset v1 - staging on production, staging"), 130.6 (flagged). Spec says 110, the implementer's 112 limit is not in the spec, and the common "Ready" state is 127 | X |
| C-3-9 | StepNav / WizardBar removed; Back from step 1 returns to Start | 0 outside the bar; Back from step 1 lands on `/experiments/new` with the home bar | M |

### Point 4: review only on its own step

| Id | Required | Measured | V |
|---|---|---|---|
| C-4-1 | review summary present on review (1), absent on 5 other steps | 1 / 0,0,0,0,0 at 1440, 1024, 390; 0 `aside[aria-label=Review]` | M |
| C-4-2 | steps 1-5 full column 1193, 0 aside, settings table scroller 1193 | main 1193 (777 at 1024, 279 at 390) on all steps, 0 `.aside`; the settings step has no `table` element, its blocks span the 1193 column (shot `review-customize-settings-1440`) | M |
| C-4-3 | bar shows run count and first problem on every step; the link switches step and focuses the field | "1 run to launch / Fix 1 problem first: Name" on step 5; the link goes to `?step=where` and focuses the name input | M |
| C-4-4 | `?step=review` works, Edit links | all measurements used `?step=`; Edit links e2e (`r9-create` C-4-3/4-4) | M |

### Point 5: readable review (shot pair `mock-page-review-*` / `review-review-{1440,390}`)

| Id | Required | Measured | V |
|---|---|---|---|
| C-5-1 | label 160 +- 1, value <= 76ch, rows >= 32, no 1151 px line | grid 160px + 547.2 px (= 76ch), rows 32 (43.6 for the two-line Versions), longest value 547.2 | M |
| C-5-2 | 390: label above value, no overflow, padding 4 | label above value, padding 4px 0, scrollWidth 390 | M |
| C-5-3 | one tr per run (6), 32 +- 1, all facts readable, 0 disclosures | 6 rows of 32, 0 `details`, environment, swept value, priority in cells | M |
| C-5-4 | columns `#` + varying + Priority | `# / Environment / Swept setting / Priority`; dataset and task omitted (one value) | M |
| C-5-5 | count 18/700 mono next to "runs to launch" 15/650 | 18px/700 Qym Mono; "runs to launch" 15px/650 | M |
| C-5-6 | 390: 6 run cards, label 96, <= 110 | 6 cards, 107.6 high, label column 96 | M |
| C-5-7 **amended** | Summary, Runs, Changes, Checks cards; Changes and Checks share a row at >= 960 (589.5 each), gaps 14, stack below | 589.5 + 14 + 589.5 at 1440, stacked at 390, gaps 14. The spec carries number and reason, but the e2e asserts only "same row" and the 14 px gap, not 589.5 | X |
| C-5-8 | smallest text 11, labels >= 4.5, titles 15, 0 `--text-dim` | sizes 11/12/15/18 only, 0 text under 4.5:1, 0 uses of #6b6b80 | M |
| C-5-9 **amended** | Summary and first 4 run rows on the first screen at 1440x1000 | Summary ends 571.1, run 4 ends 804.8, bar top 944 (also above the 844 bar top of a 900 frame); e2e at 1440x1000 | M |

### Point 6: priority per run

| Id | Required | Measured | V |
|---|---|---|---|
| C-6-1 | 6 selects, 120x24, "Priority of run N", Low/Normal/High | 6, 120x24, names "Priority of run 1..6", options Low, Normal, High | M |
| C-6-2 | default = experiment priority, 0 changed on load | all Normal, 0 `run-changed` | M |
| C-6-3 | High on run 1: only run 1 changed, `job_priorities` for that run, ack shown | 1 changed row ("changed"), dry-run body `job_priorities` = exactly one entry (production, combo 0, HIGH), `review-ack` shown | M |
| C-6-4 | non-manager: High aria-disabled "Only project managers", impossible by mouse and keyboard | with `/v1/me` role forced to MEMBER: option "High - Only project managers" aria-disabled; forced click and End+Enter change nothing (0 changed, 0 ack) | M |
| C-6-5 | cap NORMAL: High disabled with reason; cap HIGH keeps it | staging run: "High - Capped at Normal on staging" disabled; production run accepted High (launch body) | M |
| C-6-6 | ack callout border `--warning`, unchecked, Launch disabled, status "Acknowledge the preemption to launch" (danger); ticked: enabled, body `acknowledge_preemption: true`; 0 High: no callout | border 1px #f59e0b (= `--warning`), unchecked, Launch disabled, status text as required; after ticking enabled and the launch body carried `acknowledge_preemption: true` with the one job entry (request aborted before it reached the service); no callout with 0 High. Status text #ee7778 (`--error` family) | M |
| C-6-7 | set all in one action, clears markers at the default, absent for 1 run | Low: 6 changed + Reset; Normal: 0 changed; absent with one run | M |
| C-6-8 | experiment-level change moves unchanged rows only | run 1 High (changed), experiment set to Low: rows 2-6 Low, run 1 stays High, 1 changed, Summary "Low (the default of every run below)" | M |
| C-6-9 | row 32 +- 1 with marker, nowrap, column 240; 390 select 120x24 | rows 32, marker nowrap, select 120x24 at both widths; the cell is 280 wide (spec 240, no visual effect) | M |
| C-6-10 | 1 run: no table, no `job_priorities` | no table, no select, no set-all, Summary "Priority Normal", body has no `job_priorities` | M |
| C-6-11 | detail page and queue show the job's own priority, High in danger tone | detail job table: Tag per job, High #ee6e6f on #2e1a23 (danger), Low/Normal neutral, meta "Priority Normal - 1 High run"; queue column shows "High" / "Normal" as plain text (not a Tag) | M |

### Point 7: one environment page (shot pair `mock-page-environment-*` / `review-env-{experiments,settings}-{1440,390}`)

| Id | Required | Measured | V |
|---|---|---|---|
| C-7-1 | both entries land on the same pathname, 0 dialogs | `/projects/exp-demo/environments/<id>` from both (the settings entry carries `?from=settings`, J1); 0 `[role=dialog]` | M |
| C-7-2 | identical DOM text and section list, body 1193 | `innerText` equal (1975 chars each), nine sections `env-section-status..connection` in the same order, body 1193 in both | M |
| C-7-3 | 390 same sections, 279, no overflow | 279, nine sections, scrollWidth 390 | M |
| C-7-4 | `?env=` redirects (replace); `promote=` still reaches the editor | `settings?tab=environments&env=<id>` lands on the page with 1 history entry (Back goes to the list); `promote` hand-off e2e (`r9-environments` C-7-4) | M |
| C-7-5 | h1 name, URL description, All environments link, Experiments tabs with Environments selected | h1 "production", tabs Experiments / Queue / Environments* ; back link "All environments" -> `/environments` (experiments entry) and "Project settings" -> `settings?tab=environments` (settings entry, J1); URL description and Disabled tag by e2e | M |
| C-7-6 | one 56 px sticky footer, Delete environment / Save changes, no Close | 56, sticky, #222232, shadow, buttons "Delete environment", "Save changes", 0 Close | M |
| C-7-7 | Tasks lists the ids and the default; 404/405/422 shows the line and 0 tags | 3 tags + "default: Answer ticket"; with the fake answering 422: "This service does not offer task selection." and 0 tags | M |

### Point 8: preset editor = Customize (shots `review-preset-edit-*`, `review-preset-publish-1440`, pair `review-launch-models-1440` / `review-editor-models-1440`)

| Id | Required | Measured | V |
|---|---|---|---|
| C-8-1 | same Stepper, 5 segments, same geometry, 0 Outline pills | `data-mode=editor`, 5 segments (launch 6), label 12px (11 at 390) in both, 0 outline | M |
| C-8-2 | same six parts and styles; `Publish v<N>`, disabled until blocker empty | six parts, 5 buttons, 56 (110.2 at 390 with a wrapped status), same bg/border/radius/shadow as Customize; "Publish v2", disabled with "0 changes vs v1 - No changes from Default preset v1 yet."; enabling by e2e `r9-editor` | M |
| C-8-3 | one panel with h2 18/650 and rail badges, 0 collapsible LaunchSection headers | one h2 (18px/650) per step, 0 `launch-section` | M |
| C-8-4 | `data-part` set and control roles identical on models, settings, evaluation | `data-part` sets equal (0 differences, 1440 and 390 on all three steps) and settings / evaluation have the same 11 / 17 controls with the same names. The Models step has 8 controls in the editor against 16 in Customize: "+ Temporary model", "+ models" (x2), "+ Add LLM endpoint", "Edit LLM groups", "endpoint name" and the Temporary segment are absent (shot pair). That is reasonable for a preset but it is a control difference the spec and the notes do not record | F |
| C-8-5 | Summary rows, release notes (required, 4 rows, counter), Changes, Checks, no aside, doc <= 1050 | rows Environment, Task, Dataset, Compared with, Changes; textarea with "0 / 5000"; Changes and Checks side by side; content about 953 px high at 1440x900 | M |
| C-8-6 | step 1 <= 900 at 1440 and <= 1300 at 390 | 754 (content bottom 704 + 50 header) and 1085. Deviation: step 1 keeps the single `DatasetPicker` (a preset holds one dataset, backend refuses `datasets`), the spec asked for `DatasetsCard`; spec section 9 allowed this only "if the backend allows it" and the table was never amended | F |
| C-8-7 | behaviour unchanged (conflict check, leave guard, `?from=` / `?promote=`, toast, return) | e2e `preset-editor.spec.ts`, `r9-editor.spec.ts`, `environments.spec.ts` (section 6) | M |
| C-8-8 | title "Default preset - <env>", meta, action "Back to the environment" | "Default preset - staging", "Exp Demo - Compared with: Default preset v1", "Back to the environment" | M |

### Point 9: clickable tables (shots `review-env-table-{hover,focus}-1440`, `review-env-experiments-390`)

| Id | Required | Measured | V |
|---|---|---|---|
| C-9-1 | `tr[data-row-id]` pointer, `data-clickable`, 40 | pointer, `data-clickable` on 2/2 rows, 40, in both places | M |
| C-9-2 | any cell navigates; actions do not; drag does not | all 9 cells navigate (name, URL, health, schema, groups, preset, cap, chevron, actions area outside the button); the ... menu opens "Test production" and stays; 114 px drag selects 15 characters and stays | M |
| C-9-3 | cells `--bg-hover`, name underlined, chevron muted -> primary | rest #14141e, hover all 9 cells #2a2a3c, underline, chevron #9a9ab2 -> #ededf0 | M |
| C-9-4 | Tab reaches the row, arrows move, 2px accent ring, >= 3:1 | one row tabindex 0 (others -1), row focused after 4 Tabs, `:focus-visible`, 2px inset #00d4aa, 7.36:1 | M |
| C-9-5 | Enter opens, Space nothing, Ctrl+click new tab | Space stays, Enter opens, Ctrl+click opens a popup with the page | M |
| C-9-6 | name is `<a href>`, middle-click opens, Disabled tag stays | `A` with the href; middle-click opens a tab; no disabled environment in the seed (e2e) | M |
| C-9-7 | chevron on every row at rest, 14x14 | 2 chevrons for 2 rows, 14x14, opacity 1 | M |
| C-9-8 | 390: whole card opens, chevron, More does not navigate | 277 px card, pointer, chevron; More expands and stays; a click on the body navigates (both places) | M |
| C-9-9 | same columns, row height, cursor, behaviour in both places | same 9 headers, same `data-part`s, 40, pointer; only the href differs (`?from=settings`) | M |

### Orchestrator decisions

| Id | Measured | V |
|---|---|---|
| J1 | settings entry: back link "Project settings" -> `/projects/exp-demo/settings?tab=environments`; Experiments entry: "All environments"; legacy `?env=` keeps `from=settings` | M |
| J2 | a named task a ticked environment does not offer flags the box, Launch / Launch as is disabled; v1.3 case e2e (`multi-task` "unsupported one offers only Worker default") and backend `task_unsupported` | M |
| J3 | "Set every run to" stays in the runs header (C-6-7) | M |
| J4 | tie-break in the claim order (section 4); live: with a High job the production combo-0 job was the first RUNNING | M |

Totals (72 criteria): 64 MEETS, 6 MEETS WITH FIXES, 2 DOES NOT MEET. J1-J4: 4 MEETS.

## 2. Findings

Blocker: none.

Required:
1. C-3-8: the home bar at 390 is 127 px with the ordinary "Ready: ..." status and 130.6 px with a flagged task (110.2 with a missing name), against 110 in the spec and 112 in the e2e. Fix: keep the status on one line (truncate, or move the destination text to a title) or amend the spec with the measured maximum and assert it; today the e2e passes only because its state has a short status.
2. C-3-1: the bar's top edge is not fixed across steps: y = 819.3 / 745.1 / 844 at 1440 (where / start / others), 844 / 792.9 / 844 at 1024. Owner point 3 ("no tabs that suddenly appear") is about a bar that does not move; make the bar bottom-pinned in the scroller (`margin-top: auto` in a column container) and assert `y` equal on all steps.
3. C-5-7: add the amendment's own number to the e2e (`near(changes.width, 589.5, 1)`); the measured value is right.
4. C-8-4 and C-8-6: record in the spec (and a test) the two real differences between the editor and Customize: the Models step omits the temporary-model, "+ models", endpoint and "Edit LLM groups" controls (16 against 8), and step 1 keeps `DatasetPicker`. Without that, "zero control differences" is not true as written. If the owner wants zero, the Models step needs those controls (they are meaningless in a preset), so the recommendation is a spec amendment.
5. C-3-7 / C-1-7: the spec lines do not carry the 110 / 112 and the three-tag 135.8 cases the implementer relaxed in the e2e (112; 136 +- 8). Add them as **amended** with number and reason.

Optional:
6. C-2-6: clearing takes 780 ms, not 600; state the number as the dry-run debounce plus the request, or shorten it. The problem text names the task by its id ("summarize"), not its name ("Summarize thread").
7. C-6-9: the priority column is 280 px, the spec says 240.
8. C-3-5: with one run the label is "Launch", not "Launch 1 run".
9. C-6-11: the queue shows the job's own priority as text; only the detail table uses a Tag.
10. Pre-existing, not round 9: on the experiment detail page the Queue and Matrix cards start with an empty band and a rule above the title (`review-detail-priority-1440.png`).

## 3. Owner's reading (nine QA points)

| Point | Does the page answer the sentence? | Shots |
|---|---|---|
| 1 boxes too dark and confusing | Yes. Every box is lighter than its card (1.099:1), selected = accent border, 3px rail and tint (6.56:1), flagged = red border and rail with a line of text; unticked and selected cannot be confused. | `mock-page-create-home-1440` / `review-create-home-1440`, `-flagged-` |
| 2 task not inside the environments | Yes. One Task card above both boxes, 0 selects in boxes; the flagged environment explains itself. | same pair, `review-create-home-flagged-1440` |
| 3 one bottom bar | Mostly. Same element, same six parts, same x (0 px difference) and fixed labels on all six steps at three widths; but the bar sits at three different heights on short steps (finding 2) and at 390 the home bar grows to 127-131 px (finding 1). | `mock-page-customize-*` / `review-customize-settings-*`, `review-create-home-flagged-390` |
| 4 review not in the environment configuration | Yes. Review summary exists on the Review step only; the settings tables use the full 1193 px column. | `review-customize-settings-1440` |
| 5 more readable review | Yes. Summary rows with a 160 px label and a 76ch value, one row per run with 32 px rows, 18 px count; cards at 390. | `mock-page-review-1440` / `review-review-1440`, `-390` |
| 6 priority per run | Yes. A Low / Normal / High select in every run row, changed marker, High gated by manager, by the environment cap and by the acknowledgement, stored per job and shown on the detail page. | `review-review-1440`, `review-detail-priority-1440` |
| 7 same page from settings and experiments | Yes. Same route, same component, text equal character for character, 1193 / 279 px in both; only the back link differs (J1). The breadcrumb still reads Experiments > Environments in the settings entry. | `mock-page-environment-*` / `review-env-experiments-1440` vs `review-env-settings-1440` |
| 8 preset editor = Customize | Almost. Same stepper, bar, review, step bodies (0 `data-part` differences), but the Models step has half the controls and step 1 has one dataset picker; both are sensible for a preset and undocumented. | `mock-page-preset-edit-1440` / `review-preset-edit-1440`, `review-editor-models-1440` vs `review-launch-models-1440` |
| 9 clickable rows | Yes. Chevron on every row at rest, pointer, whole-row fill, underlined name and brighter chevron on hover, 2px accent ring on focus; the same in both places and as cards at 390. | `mock-page-environments-table-1440` / `review-env-table-hover-1440`, `review-env-table-focus-1440` |

## 4. Backend (spec 11.1, 11.2, 11.6)

Read: `api/experiments.py`, `services/eval_queue.py`, `services/eval_dispatcher.py`, `migrations/versions/0102_job_priority.py`,
`db/models.py`, and `tests/platform/test_experiments_api.py` (job priority cases), `test_migrations.py`, `test_experiment_datasets.py`.

* J4 tie-break: `priority_rank()` (HIGH 0, NORMAL / NULL 1, LOW 2) is the third key of `EvalDispatcher.claim` after `coalesce(next_attempt_at, created_at), created_at`, and of `eval_queue.dispatch_order()`. All jobs of one launch share `created_at = now`, so the tie-break applies inside one experiment only, as specified. Test: `test_dispatch_order_submits_high_runs_first_within_an_experiment`.
* Per-job cap: `_resolve_job_priorities` checks every job against its own environment's `max_priority` (422 "Priority HIGH exceeds the maximum allowed on: <env>"); manager rule: any HIGH needs `is_project_manager` (403). Tests `test_job_priority_is_capped_by_its_own_environment`, `test_job_priority_high_needs_a_project_manager`.
* Acknowledgement: `_require_preemption_ack(bool(high_envs), high_envs, ack)` fires when any job is HIGH, the warning names only the High environments, `preemption_acknowledged_at` is set when any job is HIGH. Test `test_job_priorities_are_stored_per_job_and_counted`.
* Unknown keys: 422 `job_priority_unknown` (`test_job_priority_unknown_key_is_a_422`).
* Retry: uses `eval_queue.job_priority(job, experiment)` for the cap check, the ack and the stored value (`test_retry_keeps_the_jobs_own_priority`); retried jobs are the only other `EvalExperimentJob` constructor.
* Task pointer: `_task_error(..., per_environment)` gives `/evaluator/task` for the string form and keeps `/evaluator/task/<envId>` for the object form (`test_task_unsupported_for_a_service_without_it`).
* Migration 0093: nullable `VARCHAR(10)`, Python backfill from `request_body.priority` else the experiment's, downgrade by batch. Round-trip tests `test_job_priority_migration_round_trips` (SQLite) and `test_job_priority_migration_postgres_round_trips` (PostgreSQL); run against the reviewer's container (section 6).
* Untested: the dispatcher ordering on PostgreSQL (`CASE` in `ORDER BY` with `FOR UPDATE SKIP LOCKED`, the ordering test is SQLite), the NULL-priority rank for rows written by an older build while a mixed deployment runs, and a non-manager retrying a HIGH job (403 on retry).

## 5. Follow-up measurements

Re-measured after the first pass, production build, 1440x900 unless noted:

* C-2-4: GET `/eval-environments/<id>/tasks` count: 0 on load, 1 after ticking production, 2 after staging, 2 after unticking and re-ticking staging.
* C-3-4: `bar-skip` and `bar-continue` on review carry `disabled` and `aria-disabled="true"`; Tab from Back goes to Cancel.
* C-5-5: count 18px/700, "runs to launch" 15px/650.
* C-6-6: the status text "Acknowledge the preemption to launch" is #ee7778 (`--error` #ef4444 family).
* C-4-2: no `table` in the settings step; `customize` is 1193 wide.
* C-3-7 at 390 with a missing name the wizard bar is 90.8 (status "Fix 1 problem first: Name").


## 6. Gate

Environment: project `.venv` (Python 3.11), Node 24, ports platform 8994, Vite 5994, fakes 9094 / 9095, stub LLM 9994, all through
`gated-heavy.sh`; the Postgres cases ran against the container `qym-test-pg-r9-review` (port 55439).

| Run | Result |
|---|---|
| `npm run build` (cost 2) | built (the platform served it for all measurements) |
| `npx playwright test e2e/experiments` (cost 3) | 290 passed, 1 skipped, 2 failed (below) |
| `npx playwright test e2e/shell` (cost 3) | 99 passed, 8 skipped, 0 failed |
| `pytest -n 2` on `test_experiment_datasets`, `test_eval_queue`, `test_migrations`, `test_experiments_api`, `test_change_request_v14`, `test_feedback_pack` (cost 3, PostgreSQL on) | 232 passed, 1 failed |

Failures at the combined tip:

1. `e2e/experiments/launch/r9-create.spec.ts` C-4-3 / C-4-4: failed in the full run (heading "Where it runs" not visible within 8 s, test took 9.2 s) and passed alone (3.3 s): load flakiness, not a defect (the same flow was measured by hand: the link goes to `?step=where`, focus on the name input).
2. `e2e/experiments/launch/review-d.spec.ts:337` QD-5..QD-16: expects the combined-run help text "One run over the 2 dataset versions together..." but the page now shows "2 runs per environment, one per dataset version, grouped under this experiment." That is the merged default run shape (`fix/multi-dataset-default-one-each`, not a round 9 criterion): the spec was not updated for the new default, so it fails on the combined tip. Required fix for the orchestrator: select the combined shape in that test (as `af1ca0d2` did for another spec).
3. `tests/platform/test_feedback_pack.py::test_the_committed_pack_is_current` fails: `knowledge_platform.json` is stale at `ab1607d5` (regenerated at `3b8a06d1`, before B's merge). Run `python -m qym_platform.tools.build_feedback_pack` and commit. `test_change_request_v14` passed on PostgreSQL (and SQLite).

Not run by me: the full `tests/platform` and Vitest/`npm run check` (A and B ran them), SDK tests.

