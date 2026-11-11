# Round 9 design spec: experiment creation, Customize bar, Review, preset editor, environment pages and tables

Branch `ui/redesign9-experiments` (from UI-redesign 2c45762d). Stage 1 of 3 (design). Owner QA of 2026-10-28, nine points; decisions
I1 (one task per experiment), I2 (Low / Normal / High per run), I3 (the Experiments -> Environments detail page is the reference) are final.
Earlier criteria (`redesign/experiments-create.md`, `redesign2/review-experiments-versions.md`, `06-experiments-eval-queue.md`) still
hold unless a criterion below amends them (section 8 lists the amendments).

Evidence. Measurements: `measure/*.cjs` (Playwright, dark theme, platform :8988 on SQLite, Vite dev server :5988; the dev server is
used instead of a production build because only layout and computed style are measured; seed `measure/seed_r9.py`: project
`exp-demo`, environments production and staging on two fake Evaluation Services with `--datasets --tasks`, datasets
support-tickets v1-v3, billing-faq v1-v2, refund-cases, golden, a default preset v1 and a saved preset on staging, four experiments incl.
a 3-value timeout sweep). Shots: `shots/current-*.png` (today), `shots/mock-page-*.png` (composed mocks), `shots/sheet-*.png` (appendix).
The mocks are the gallery `/__ui#round9` (`frontend/src/features/dev/Round9Mocks.tsx`, `.module.css`) and, one page each and light,
`/__mock/round9/<variant>` (`round9Register.ts`). All mock pages are drawn in the real shell at 1440 (column 1193) and 390 (column 279).
Mock numbers below are measured on those mocks (`measure/mm.cjs`).

## 0. Principles (what the nine points have in common)

1. **One surface level per container, never darker than what holds it.** A selectable thing sits on `--bg-elevated` over a
   `--bg-surface` card, with `--border-default`; selected = accent border + 3px `--rail-width` rail + `--tint-soft` accent tint (the Start-from
   card recipe). Nothing nests a darker well inside a card.
2. **One bar, one set of slots.** The Customize bar never gains or loses a control from step to step; a control that does not apply is
   disabled in place.
3. **A step shows its own content only.** Summary, run count and the launch decision live in the bar (count, first problem) and on the Review
   step (everything else).
4. **Facts in cells, not sentences.** The review lists runs as rows (one fact per cell), not as one paragraph per block.
5. **One page per thing.** An environment has one URL and one component; the preset editor is the Customize wizard in another mode.
6. **A row that opens something opens from anywhere on the row**, shows it at rest (chevron) and on hover/focus (fill, cursor, ring).

## 1. Measurements of today's pages (`current-*`)

### 1.1 Creation home and step 1 (`current-create-home-{1440,1024,390}.png`, `current-create-home-empty-*`)

Page ground `--bg-void` #101018; the Card holding Environments and Datasets is `--bg-surface` #1a1a28 (1.10:1 on the ground, 1px
`--border-subtle`, radius 8, padding 14 20). Inside it:

| Element (class today) | Fill | Border | Contrast fill vs its card | Size 1440 / 1024 / 390 |
|---|---|---|---|---|
| environment box `li[data-selected]` (`.env`) | `--bg-base` #14141e | 1px `--border-subtle` (1.33:1 on its own fill); selected 1px `--accent-primary` | **1.06:1, and darker than the card**; 1.04:1 against the page ground | 547x143 / 339x167 / 237x191 (staging, ticked: tags, Versions, Task) |
| dataset box `li[data-dataset-box]` | `--bg-base` | 1px `--border-subtle` | 1.06:1, darker | 547x67 / 339x67 / 237x67 |
| task Select inside the box `[data-env-task] button` | `--bg-elevated` | 1px `--border-default` | 1.17:1 on the box | 492x24 (one per ticked environment, 24 px under the Versions line) |
| start card `[role=radio]` (for comparison) | `--bg-surface` / selected accent tint | 1px subtle / accent + 3px rail | n/a | 374x127 |

Finding (point 1): the two boxes are the only elements of the page that are darker than the surface that holds them, so they read as holes
in the card (same level as the page ground, 1.04:1) and an unticked box looks identical to a dataset entry. Selection is shown by a 1px
border only (no fill change), while the Start-from card below it uses a rail and a tint: two selection languages on one page. Finding
(point 2): each ticked environment box carries its own Task Select (`[data-env-task]`, a third line under Versions); two ticked
environments show two selects for what is meant as one experiment-wide choice, and a task is invisible until an environment is ticked.

### 1.2 Customize bottom bar: step x buttons (`current-step-*-{1440,1024,390}.png`, `measure/m_bar.cjs`)

Three different bars exist today (class: `.nav` surface/`--border-subtle` 42 px; `.wizardBar` elevated/`--border-default` 56 px; `.homeBar`
elevated 56 px, 110 px two-row on a phone), chosen by width and by step:

| Step | 1440 (aside 352 px at the right of the step) | 1024 (and anything under 1200) | 390 |
|---|---|---|---|
| where | StepNav h42 sticky: **Continue to starting point**; aside Review with **Cancel, Raw JSON, Launch** (h32) | WizardBar h56 sticky: Continue to starting point, problem link, Cancel, Launch (h24) + Review card under the step | WizardBar (Continue, overflow menu, Launch) + Review card |
| start | StepNav: Back, Continue to models; aside Review | WizardBar: Back, Continue, problem, Cancel, Launch | WizardBar |
| models | StepNav: Back, **Skip to review**, Continue to environment configurations; aside | WizardBar: Back, Skip, Continue, problem, Cancel, Launch | WizardBar |
| settings | **WizardBar h56 (Back, Skip to review, Continue, "1 run to launch", problem link, Cancel, Launch) and the Review card (1193x490) under the step, no aside** | same | same |
| evaluation | StepNav: Back, Skip to review, Continue to review and launch; aside | WizardBar | WizardBar |
| review | StepNav: Back only; Review card 1193x536 with Cancel, Launch (h32) inside it | StepNav Back only; Review card | same |
| home (`.homeBar`) | name field, status, Customize, Launch as is (h56) | same | two rows 83 px |

Heights: nav 42 / bar 56 / aside buttons 32 / bar buttons 24. So, at 1440, Skip to review and Launch appear in the bar only on step 4 (and
Skip only on 3 to 5); at 1024 and 390 they are in the bar everywhere. This is the surprise of point 3. Why the Review card is under the
Environment configurations step (point 4): `LaunchWizard.tsx` sets `compactReview = step === 'settings'` (the wide override tables
do not fit beside a 22rem rail) and `reviewBelow = !showAside && step !== 'review'`, so the whole `ReviewPane` is rendered below the step on
that step and, under 1200 px, below every step. It is a layout workaround, not a design choice.

### 1.3 Review (`current-step-review-*`, `current-review-sweep-*`, `measure/m_review.cjs`)

One Card `aside[aria-label=Review]` 1193x553 (390: 279x569) with: `h3` Review 15/600; Summary `dl` one column (label above value, **label 11/600
caps muted 15 px tall, value 12/400 17 px; both 1151 px wide at 1440**, i.e. a 1151 px line); the run count "3 runs to launch" (26/700 mono) and
a 11 px muted math line; "Changes by step" `h4` 13/600 with rows; "Validation" `h4`; a closed `<details>` "Run names" whose items are 15 px
rows ("timeout sweep (copy) · timeout=10"). A sweep of 3 or 6 runs is therefore **one number and a closed disclosure**: to know which environment,
dataset, swept value and priority run 4 gets, the reader opens "Run names" and parses a sentence; the dataset of a run, its task and its priority
appear nowhere per run (Datasets and Priority are one global line each). Text sizes are 11 and 12 px; nothing is larger than 15 px
except the digit.

### 1.4 Preset editor versus Customize (`current-preset-editor-*`, `measure/m_editor.cjs`)

`DefaultPresetEditorPage` stacks everything (docH 1563 at 1440, 2548 at 390): `Outline` pills (Models | Environment configurations |
Evaluation configurations | Raw JSON), `EditorEntry` (Environment + Task + `DatasetPicker` + "Compared with"), the four `LaunchSection`
panels all mounted with collapsible headers, and `PublishPane` (aside 352 px, "Review and publish": summary, release notes, Cancel / Publish v2, h32).
Controls that differ from Customize: no Stepper (0 vs 6 segments); no step panels (4 stacked sections with chevrons vs one panel with an `h2`);
Outline pills vs rail; `DatasetPicker` (one Select + version Select) vs `DatasetsCard` (several datasets, versions, shape); Task inside the
environment line vs the Task row of the box; no bar at all (`[aria-label=Launch]` count 0) with Cancel/Publish in an aside; summary KeyValueGrid
vs the review; section header badges vs the rail badges; header "Back to the environment" vs "← Start / All experiments". 0 of the Customize
controls are shared except the section bodies.

### 1.5 Environment detail pages (`current-envdetail-{page,settings}-{1440,390}.png`, `measure/m_envdetail.cjs`)

Both render `EnvironmentPanelBody`: Status, Schema, LLM model groups, Default preset, Saved presets, Ranking, Policies, Connection, footer
(Delete / Save). Differences: **container** (page: `PageHeader` h1 + URL + "All environments" + Experiments tabs, body 1193 px, doc 2076 px high at 1440;
settings: a 640 px `Drawer` over the settings page, body 599 px, header title + URL + x, footer with an extra Close, same sections 543 vs 397 px
for LLM groups, 266 vs 228 for presets), **route** (`/environments/:id` vs `?tab=environments&env=:id`), crumbs (Experiments > Environments > staging vs
Settings), tabs (Experiments / Queue / Environments vs the settings tabs behind a scrim). Sections: identical list of 8 + footer.

### 1.6 Environment tables (`current-envtable-*`, `measure/m_envtable.cjs`, `t3.cjs`)

Both places use `EnvironmentsList` (`DataTable density="regular"`, row 40 px at 1440 and 1024; at 390 a card list with a "More" line). Row `tr` cursor
`auto`, no `data-clickable`, no `rowHref` / `onRowOpen`; hover fill is `td` `--bg-hover` rgb(42,42,60). The click target is the name `<button>` 71x18 px (`cursor:
pointer`, colour primary, accent on its own hover); a click on the URL, health or any other cell does nothing (measured: url unchanged, no
drawer). The "Manage production" icon button is a hover/focus-only row action (`.tr:hover .rowActions`). At rest nothing says the row opens.
At 390 the whole card has no click target besides the name.

## 2. Point 1: dataset and environment boxes too dark and confusing

Decision. Boxes sit on `--bg-elevated` with `--border-default`; hover `--bg-hover`; selected = `--accent-primary` border + `--rail-width` rail + `--tint-soft`
accent tint over `--bg-elevated`; flagged = `--error` border and rail. The Versions line stays inside a selected environment box under a
`--border-subtle` hairline; the Task select leaves the box (point 2). Same recipe for the dataset boxes (never selected: unselected state).
Shots: `mock-page-create-home-{1440,390}`, `sheet-boxes-{1440,390}`.

Reference contrasts (measured with `measure/pw.cjs contrast`): elevated vs surface 1.10:1; hover vs surface 1.22:1; border-default vs surface 1.59:1; accent
border vs the selected fill 6.56:1; selected fill vs surface 1.37:1; text-primary on elevated 13.38:1, text-secondary 6.68:1, text-muted 5.69:1, text-muted on the
selected fill 4.56:1 (so descriptions inside a selected box use `--text-secondary`).

| Id | Element (`data-part`) | Width | Criterion |
|---|---|---|---|
| C-1-1 | `env-box` `[data-state=unselected]`, `dataset-box` | 1440, 1024, 390 | computed background `--bg-elevated` (#222232), never `--bg-base`; luminance contrast against its card (`--bg-surface`) 1.10 +- 0.02 and the box is lighter than the card at every width |
| C-1-2 | same | all | border 1px `--border-default` (#3b3b54); radius `--radius-md`; padding 8 14 |
| C-1-3 | `env-box` `[data-state=selected]` | all | border `--accent-primary` 1px plus 3px inline-start rail of the same colour; fill = `--bg-elevated` mixed with `--tint-soft` accent; contrast of the accent border against the fill >= 6:1; the Start-from `[role=radio][aria-checked=true]` uses the same border, rail and tint (identical computed `border-inline-start`) |
| C-1-4 | `env-box` hover | 1440 | background `--bg-hover` (#2a2a3c) on an unselected box; cursor `auto` (the checkbox label is the control) |
| C-1-5 | `env-box` `[data-state=flagged]` | all | border and rail `--error`, a `data-part=env-flag` line in `--error` text >= 4.5:1 on the box; the box keeps its checked checkbox |
| C-1-6 **amended** (implementation A: tags excluded; their tone tint sits on an opaque elevated surface because stacking it on the selected tint measured 4.0 to 4.2:1 in axe) | any element inside `env-section` or `dataset-section` | all | 0 non-Tag elements whose background is darker than their container's (`--bg-base` or `--bg-void` inside a card); text contrast >= 4.5:1 for every text node on its resolved background |
| C-1-7 **amended** (fix pass: an environment that carries a third tag, "Default preset v1", wraps it to a second tag row at 390; measured 135.8 px, +24 px) | `env-box` heights | 1440 / 390 | ticked box with Versions: 88 +- 6 / 112 +- 8 px (mock 87.8 / 111.8; today 143 / 191 with the Task row); with the third "Default preset v1" tag at 390: 136 +- 8 px (measured 135.8); unticked-to-ticked change adds only the Versions line height |

## 3. Point 2: the task is not inside the environments (decision I1)

Decision. A **Task section** (`task-section`, a Card, full width) sits above the Environments / Datasets row on the home view and on Customize step 1 (below the
Name and priority card). It holds one `Select` (`task-select`, 360 px, 24 px high; 100% width at 390), an availability row (`task-availability`:
"Offered by" + one `Tag` per ticked environment, success when it offers the chosen task, danger "staging: not offered" when not) and one help
line. The list is the union of the ticked environments' tasks (`GET /evals/tasks`, cached as today), first item "Worker default" (the value when no
task is chosen), each item's `description` says who offers it ("production and staging", "production only"). The section is rendered when at least
one active environment of the project declares `task` (known from the environments list, so the page never changes height by ticking);
with no environment ticked it is disabled and reads "Pick an environment first". A chosen task that a ticked environment does not offer flags that environment's box
(C-1-5), turns its availability tag danger, adds a review problem "<env> does not offer the task <name>" (focus goes to the Task select) and
disables Launch / Launch as is; changing the task or unticking the environment clears it. Environments of a v1.3 service (no `task` capability) offer only "Worker
default": choosing another task flags them the same way (backend rule `task_unsupported`, see section 10). Old experiments with per-environment tasks
display unchanged (read-only, the experiment detail already reads `params.task`). Shots: `mock-page-create-home-*`, `mock-page-create-home-flagged-*`,
`mock-page-customize-where-*`, `sheet-task-*`, `sheet-boxes-*`.

| Id | Element | Width | Criterion |
|---|---|---|---|
| C-2-1 | `env-box` (all states) | all | contains 0 `Select` and 0 element named Task; the Task Select count on the page is exactly 1 (today: one per ticked environment) |
| C-2-2 **amended** (measured on the card's content block, as the mock; 1024: help wraps, <= 92) | `task-section` | 1440 / 1024 / 390 | directly above `env-section`; 0 px vertical gap difference to the other cards (14 px); height 74 +- 4 px at 1440 (mock 73.6), 148 +- 12 at 390 |
| C-2-3 | `task-select` | 1440 / 390 | 24 px high; 360 px wide at 1440 and 1024, the card's content width at 390 (235 px); first item "Worker default"; items carry a description naming the offering environments |
| C-2-4 | task list | 1440 | items = union of the ticked environments' lists, de-duplicated by id, in the order of first appearance, "Worker default" first; one request per environment (cache keys unchanged: `useEnvTasks`), 0 extra requests when ticking a second environment already read |
| C-2-5 | `task-section` with 0 ticked | all | Select disabled, text "Pick an environment first"; the section height equals its height with environments ticked +- 0 px (the availability row reserves its line) |
| C-2-6 | flagged environment | all | the chosen task is not in environment E's list: `env-box[data-state=flagged]` for E, availability tag for E danger, 1 review problem with the environment name and the task name, Launch disabled; fixing it removes all four within 1000 ms (**amended**, fix pass: the 600 ms dry-run debounce plus its request, measured 780 ms at 1440, 1024 and 390; the e2e waits 1000 ms); the problem names the task by its listed name ("Summarize thread"), by its id only when no ticked environment lists it (fix pass) |
| C-2-7 | `task-section` hidden | all | when no active environment declares `task` (all v1.3 services) the section is not rendered and nothing reserves space |
| C-2-8 | stored spec | n/a | launch spec carries `evaluator.task` as one string (or absent for Worker default); `/evaluator/task/{env.id}` is derived, never edited in the UI; clone of an old per-environment experiment shows the Task section with the common value or "Different per environment" (read-only, disabled select) |

## 4. Point 3: one bottom bar (decision: slots, not variants)

Decision. One component `LaunchBar` (recipe `.bar` in `Round9Mocks.module.css`) replaces `StepNav`, `WizardBar` and the chrome of `HomeBar`.
Sticky at the bottom of the scroller (compositor `position: sticky; bottom: 0`), `min-height: var(--bar-action-h)` (56 px), `--bg-elevated`,
1px `--border-default`, `--radius-md`, `--shadow-popover`, padding 8 14, gap 14, every button `size="sm"` (24 px). **Six slots, fixed order, on all six steps**:
Back | Skip to review | Continue | status (count of runs + first problem link, or "Ready") | Cancel | Launch N runs. Back goes to the Start view on step 1.
A slot that does not apply is **disabled, never removed**: Skip to review and Continue are disabled on Review and Launch is disabled while there are
problems. Labels are fixed (no "Continue to <next step>"; the destination is the button's `title` and `aria-label`), so no button moves
when the step changes. The home view keeps its content (name field, status, Customize, Launch as is) in the same chrome. At 390 the bar is two
rows (status row, then buttons row; the home view adds the name row and is 90.8 px too, see C-3-8), 91 px high (mock 90.8; 56 + `--space-lg` + `--space-xs`, a token expression, not a number), Skip shows "Skip"; the same five buttons, no overflow menu. In editor mode (point 8) Launch reads "Publish v2" and the status
reads "3 changes vs v1". The aside review (352 px) and the review card under the step disappear (point 4), so the launch decision has one home. Shots:
`mock-page-customize-{where,models,settings}-*`, `mock-page-review-*`, `sheet-bar-{1440,390}`.

| Id | Element | Width | Criterion |
|---|---|---|---|
| C-3-1 | `launch-bar` | 1440 / 1024 | on each of the six steps: height 56 +- 1 (token), top edge fixed (sticky, `position: sticky`; **fix pass**: the page fills the scroller and the bar is pinned to the page's bottom edge, so its top edge is the same on all six steps and on the home view and its bottom edge is the viewport bottom at 1440, 1024 and 390, within 0.5 px; before: 819.3 / 745.1 / 844 at 1440, 844 / 792.9 / 844 at 1024), identical computed background, border, radius, shadow (6 steps, 0 differences) |
| C-3-2 | `bar-back`, `bar-skip`, `bar-continue`, `bar-status`, `bar-cancel`, `bar-launch` | 1440 / 1024 / 390 | exactly these six parts on every step; the count of buttons in the bar is 5 on every step at every width (Back, Skip, Continue, Cancel, Launch); 0 parts added or removed between steps |
| C-3-3 | the same | 1440 | x of each part differs by <= 1 px across the six steps (the status flexes; Back at left, Launch at right edge) |
| C-3-4 | `bar-skip`, `bar-continue` | review step | `aria-disabled` true and not focusable by Tab; on every other step enabled |
| C-3-5 | `bar-launch` | all | label `Launch N runs`, `min-inline-size` fixed so the label change 1 -> 12 runs moves nothing; primary variant; disabled with the first problem shown in `bar-status` |
| C-3-6 | all bar buttons | all | height 24 +- 0; fonts 11/600; there is no button of another height (0 of 32 or 42 px bars) in the page footer area |
| C-3-7 **amended** (fix pass: a long problem text wrapped the status to a second line and made the bar 110 px; at 390 the problem text after "Fix N problems first" is hidden, the field and the Problems list carry it, so the status is one line in every state) | `launch-bar` at 390 | 390 | two rows, height <= 91 px (measured 90.8 in every state), 0 horizontal overflow (`scrollWidth <= clientWidth`), the five buttons visible without a menu |
| C-3-8 **amended** (fix pass: measured 90.8 with no environment, 110.2 with the name missing, 127 with the ordinary "Ready: ..." status and 130.6 with a flagged task, against 110; at 390 the destination after "Ready", the problem text and the run count of a blocked form are hidden, because the cards above and the field carry them; the bar is then 90.8 px in every state) | `launch-bar` on the home view | 1440 / 390 | same background, border, radius, shadow, height 56 (90.8 at 390: status, name row and buttons, in every state, ready, name missing and task not offered); parts `bar-name`, `bar-status`, `bar-customize`, `bar-launch` |
| C-3-9 | `StepNav`, `WizardBar` | n/a | removed: 0 elements with `aria-label="Step navigation"` outside `launch-bar`; the step rail (Stepper) stays the other way to jump |

## 5. Point 4: the review does not belong to the environment configuration

Finding (section 1.2): the Review card was moved under the Environment configurations step as a width workaround and under every step below 1200 px.
Decision. The Review card is rendered on the **Review step only**. Other steps show their own content full width (the settings tables get the
whole 1193 px instead of 841 px beside a rail); their live feedback is the bar (run count and first problem), the rail badges (changed and problem
counts) and the existing per-section problem lists. Shots: `mock-page-customize-settings-*` (no review), `mock-page-customize-models-*`.

| Id | Element | Width | Criterion |
|---|---|---|---|
| C-4-1 | `aside[aria-label=Review]` / `review-summary` | 1440 / 1024 / 390 | present on the review step (count 1), absent on where, start, models, settings, evaluation (count 0) |
| C-4-2 | `customize` main column | 1440 | on steps 1 to 5 its width is the full column (1193 px), no 22rem aside (`.aside` count 0); the settings table scroller is 1193 px wide (today 841) |
| C-4-3 | bar status | all | on every step the bar shows `N runs to launch` and the first problem (link focuses the field and switches step) |
| C-4-4 | tests and URLs | n/a | `?step=review` unchanged; "Edit" links of the review switch step and focus the field (existing behaviour) |

## 6. Point 5: a more readable review

Decision. The Review step is three framed cards in one column: **Summary**, **runs to launch**, and two cards side by side (>= 960 px) **Changes from
the starting point** and **Checks**; then "Show raw JSON". Details:

1. Summary: `KV` rows, label column 160 px (`--font-sm` / 600 / `--text-muted`), value column at most `--field-measure` (76ch), row min-height `--row-compact` 32 px with a
   `--border-subtle` hairline between rows, value `--font-base` primary, mono for ids (datasets, versions). Rows: Name, Starts from, Task, Environments, Datasets, Priority
   ("Normal (the default of every run below)"), Versions (+ Latency-sensitive when set). Under 760 px label stacks over value.
2. Runs card: card header = the count (`--font-xl` mono 700) + "runs to launch" (`--font-lg` 650) and, right, the math line in `--font-sm` muted
   ("3 timeout values x 2 environments = 6 runs"). Body: a table, **one row per run, one fact per cell**: `#`, Environment, Dataset (name + version, mono), Swept
   setting (`Tag kind="data"`, "timeout 10"), Task, Priority (point 6). A column that carries one value for every run (one environment, one dataset, no sweep, one task)
   is not drawn; the table never has fewer than `#` and Priority. Row height `--row-compact` 32 px. Under 760 px each run is a card (96 px label column).
3. "Changes" rows 32 px with an Edit ghost button; "Checks": a `Badge` Ready / "N problems", the problem list (rows with Show), the warnings (ceiling, token, task
   unverified) as callouts above it; the old "Run names" disclosure is replaced by the table (the run name pattern stays in the experiment name row).
4. Typography: nothing below `--font-sm` (11 px) except tags; titles `--font-lg`; the count `--font-xl`.

Shots: `mock-page-review-{1440,390}`, `mock-page-preset-publish-*` (the same Summary card).

| Id | Element | Width | Criterion |
|---|---|---|---|
| C-5-1 | `review-kv` rows | 1440 | label column 160 +- 1 px; value column max-width `--field-measure` (76ch); row height >= 32 px; no value line longer than 76ch (today 1151 px) |
| C-5-2 | `review-kv` | 390 | label above value, no horizontal overflow, row padding 4 px |
| C-5-3 | `runs-table` rows | 1440 | one `tr` per run (6 for the sweep seed); row height 32 +- 1; every run's environment, dataset, swept value, task and priority is readable without a click or a hover (0 disclosures) |
| C-5-4 | `runs-table` columns | 1440 | columns present = `#`, plus only those that vary (environment, dataset, swept setting, task), plus Priority; 0 columns whose 6 cells hold the same text (except `#`, Priority) |
| C-5-5 | `run-count` | all | font 18 px / 700 mono in the card header, next to "runs to launch" (15/650); today 26 px mono in the aside |
| C-5-6 | `runs-table` at 390 | 390 | replaced by `runs-cards`: one card per run, label column 96 px, 6 cards for 6 runs, card height <= 110 px |
| C-5-7 **amended** (543 px contradicts 14 px gaps in a 1193 px column: two equal columns of 589.5 px) | review cards | 1440 / 390 | Summary, Runs, Changes, Checks are `Card`s; Changes and Checks share a row at >= 960 px (two columns of 589.5 px at 1440), stack below; gaps 14 px |
| C-5-8 | text sizes | all | smallest non-tag text 11 px; every label >= 4.5:1; section titles 15 px; 0 text uses `--text-dim` |
| C-5-9 **amended** (the mock numbers need a 1000 px frame) | first screen of the Review step | 1440 x 1000 | the Summary and the first 4 run rows are visible without scrolling at 1440x900 (mock: summary ends at y 553, run rows 4 end by y 940 in a 1000 px frame; the bar is sticky) |

## 7. Point 6: a priority dropdown per run (decision I2)

Decision. Each run row has a `Select` (`run-priority`, 120 px, 24 px) with **Low / Normal / High**. Default for every row = the experiment's priority (step 1 control;
when it is "Environment default", the resolved value shown as text, e.g. Normal); a row the user changes shows a "changed" marker (dot + text, `run-changed`) and
the header carries "Set every run to [Low / Normal / High]" (`review-priority-all`; resets every row, and a "Reset" appears when any row differs).
Rules, same as the experiment value: **High needs a project manager** (option disabled, description "Only project managers"); **High is capped by the run's
environment `max_priority`** (option disabled, "Capped at NORMAL on staging"); **any High run needs the preemption acknowledgement** (one callout above the table:
"1 run is High ... [ ] I understand that High runs can preempt other work"; Launch stays disabled until ticked; the existing `preemption_warning` text names the environments of High runs only);
changing the experiment-level priority in step 1 changes every row that has no individual choice. Stored per job (section 10). Shots: `mock-page-review-*`, `sheet-priority-*`.

| Id | Element | Width | Criterion |
|---|---|---|---|
| C-6-1 | `run-priority` | 1440 | one per run row (6 for 6 runs), 120 x 24 px, accessible name "Priority of run N", options exactly Low, Normal, High in that order |
| C-6-2 | default | all | value equals the experiment-level priority (Normal for "Environment default (NORMAL)"); 0 rows marked changed on load |
| C-6-3 | change | 1440 | choosing High on run 1 marks only run 1 `run-changed`, sets `job_priorities` for exactly that run in the dry-run request, and shows `review-ack` (1 run is High) |
| C-6-4 | non-manager | all | High option `aria-disabled`, description "Only project managers"; selecting it is impossible by mouse and keyboard |
| C-6-5 | env cap | all | for a run on an environment with `max_priority` NORMAL, High is disabled with the reason; a run on an environment with cap HIGH keeps it |
| C-6-6 | acknowledgement | all | with >= 1 High run: callout `review-ack` present (border `--warning`), checkbox unchecked, `bar-launch` disabled and `bar-status` reads "Acknowledge the preemption to launch" (danger); after ticking: launch enabled and the body carries `acknowledge_preemption: true`; with 0 High runs: callout absent, no checkbox |
| C-6-7 | "Set every run to" | 1440 | sets all rows in one action, clears the changed markers when it equals the experiment default; absent when the sweep has 1 run |
| C-6-8 | experiment-level change | all | editing the step-1 priority changes the value of every row not individually changed, and leaves changed rows alone |
| C-6-9 | sizes | 1440 / 390 | row height stays 32 +- 1 with the marker (nowrap, column 240 px, measured 240 in the fix pass; before 280); at 390 the select sits in the run card, 120 x 24 |
| C-6-10 | 1 run | all | with a single run the table is not drawn; priority shows only in Summary (C-5 rows) and the experiment-level control; `job_priorities` is absent |
| C-6-11 | experiment detail | 1440 | the job table of the experiment detail page and the queue show the job's own priority (today the experiment's): a Tag per job, High in the existing danger tone |

## 8. Point 7: one environment page (decision I3)

Decision. **`/projects/:slug/environments/:envId` is the only environment detail**. The Project settings -> Environments tab keeps its list (same
`EnvironmentsList`, same row-opens behaviour, point 9) and a row navigates to that route; `?tab=environments&env=<id>` (and the old `?env=` forms) redirect
(`replace`) to it, `promote=` hand-offs unchanged. `EnvironmentsPanel`'s `EnvironmentDrawer` is deleted. The page is the reference (section 1.5): `PageHeader`
(name, URL, "All environments"), the Experiments tabs, then the sections in this order: Status, Schema, **Tasks** (new, read-only list of what the service offers + default,
the data of `useEnvTasks`; supports the Task section of point 2 and shows 404/422 as "This service does not offer task selection"), LLM model groups, Default preset,
Saved presets, Ranking, Policies, Connection, footer (Delete environment | Save changes; no Close). Shots: `mock-page-environment-experiments-*`,
`mock-page-environment-settings-*` (identical by construction: same component, the only difference is the browser history), `current-envdetail-*`.

| Id | Element | Width | Criterion |
|---|---|---|---|
| C-7-1 | route | n/a | opening an environment from Experiments -> Environments and from Project settings -> Environments lands on the same pathname `/projects/<slug>/environments/<id>`; 0 `[role=dialog]` / drawer opened for an environment anywhere |
| C-7-2 | `env-page` | 1440 | the two entries render identical DOM text and the same section list (`env-section-*`): status, schema, tasks, groups, preset, saved presets, ranking, policies, connection; body width 1193 px (today 599 in the drawer) |
| C-7-3 | `env-page` | 390 | same sections, body 279 px, no horizontal overflow |
| C-7-4 | legacy URLs | n/a | `?tab=environments&env=<id>` redirects to the route (replace, 1 history entry); `?promote=...` still reaches the preset editor |
| C-7-5 | header | all | h1 = environment name, description = URL, `All environments` link to `/environments`, Experiments tabs with Environments selected; Disabled tag when inactive |
| C-7-6 | `env-footer` | all | one footer: Delete environment, Save changes (sticky bar, 56 px, the shared recipe); Close absent |
| C-7-7 | Tasks section | 1440 | lists the ids/names of `GET /evals/tasks` with the default marked; a 404/405/422 service shows the "does not offer task selection" line and 0 tags |

## 9. Point 8: the preset editor is the Customize wizard (zero control differences)

Decision. `DefaultPresetEditorPage` renders `LaunchWizard` with `mode="editor"` inside the same `LaunchProvider`. Same Stepper, same step panels, same `LaunchBar`, same Review
step (the Summary card and Changes and Checks cards), same Models / Environment configurations / Evaluation configurations bodies. What changes is only the
**step set and the content of two steps**, because name, priority, latency, environment choice and Start from do not exist for a preset:

| Step (id) | Launch mode | Editor mode |
|---|---|---|
| 1 `where` | Where it runs (Name and priority, Task, Environments, Datasets) | **Environment and dataset**: Compared with card (version, N changes, Undo all changes, release notes of the base, drift callouts), Task, Environment (one, fixed) and `DatasetsCard` |
| 2 `start` | Starting point | not present |
| `models`, `settings`, `evaluation` | same | same (identical components) |
| last `review` | Review and launch: Summary, Runs, Changes, Checks, raw JSON | **Review and publish**: Summary (Environment, Task, Dataset, Compared with, Changes), **Release notes** (required textarea, 0 / 5000), Changes, Checks (Validation, publish blockers: `publishBlocker`), raw JSON |
| bar | Back, Skip to review, Continue, status "N runs to launch", Cancel, **Launch N runs** | same slots, status "N changes vs vX", Cancel goes to the environment, **Publish vN** |

Props of the shared component (implementation contract): `LaunchWizard({ mode: 'launch' | 'editor', steps: readonly WizardStepDef[], step, onGo, onCancel, primary: { label, disabled, loading, onPress },
status: ReactNode, renderStep(step): ReactNode, review: ReactNode })`. `WIZARD_STEPS` stays the launch step list; `EDITOR_STEPS = [where "Environment and dataset", models, settings, evaluation, review "Review and publish"]`
(the same ids, so `stepOfItem`, `useStep` and `heldOnHome` keep working; `?step=` works in the editor too). `EditorEntry` is split: Compared with becomes a step-1 card, the dataset
picker is replaced by `DatasetsCard` (a preset may carry several datasets only if the backend allows it, see section 10); `PublishPane` is replaced by the Review step plus the bar.
The `Outline` pills and the 22rem aside are deleted from the editor. Shots: `mock-page-preset-edit-*`, `mock-page-preset-publish-*`.

| Id | Element | Width | Criterion |
|---|---|---|---|
| C-8-1 | `customize[data-mode=editor]` | 1440 / 390 | contains the same Stepper component (`aria-label="Steps"`), 5 segments, same geometry (4 px bars, label 12 px) as Customize; 0 `Outline` pills |
| C-8-2 | `launch-bar` | all | the same six parts, same computed styles as C-3-1; Launch label `Publish v<N>`; disabled until `publishBlocker` is empty (unchanged, notes written, no problems) |
| C-8-3 | step panels | all | one panel at a time with an `h2` (`--font-xl` 650) and the rail badges; 0 collapsible `LaunchSection` headers; Models, Environment configurations, Evaluation configurations bodies render the same components as Customize (same DOM subtree classes) |
| C-8-4 **amended** (fix pass: a preset holds no per-launch secrets and no temporary models, so these controls cannot exist in the editor) | difference list | n/a | automated check: the set of `data-part` on the models, settings and evaluation steps is identical in both modes (0 differences); the controls (role and name) of settings and evaluation are identical (11 / 17, 0 differences); the editor's Models step has Customize's controls minus exactly `+ Temporary model`, `+ models` (both rows), `+ Add LLM endpoint`, `Edit LLM groups` and the `New LLM endpoint name` field (16 against 8 as counted by the review, the e2e asserts the named set), and adds none; the only differing steps are 1 and last, per the table |
| C-8-5 | Review and publish | 1440 | Summary rows Environment, Task, Dataset, Compared with, Changes; Release notes textarea (required, 4 rows, counter), Changes by step with Edit, Checks; no aside; doc height <= 1050 at 1440 (mock 1046) |
| C-8-6 **amended** (fix pass: a preset holds one dataset and the backend refuses `datasets`, so step 1 keeps the single `DatasetPicker`, not the Datasets card; section 9 allowed the card only if the backend allows it) | doc height | 1440 / 390 | step 1 of the editor <= 900 px high at 1440 and <= 1300 at 390 (today the page is 1563 / 2548 stacked; measured 754 / 1085); 0 `datasets-fieldset`, 0 Add dataset button |
| C-8-7 | behaviour | n/a | unchanged: stale-version conflict check, "Leave without publishing?" guard, `?from=` and `?promote=` drafts, publish toast, return to the environment page |
| C-8-8 | header | all | title "Default preset · <env>", meta "<project> · Compared with: Default preset vN", action "← Back to the environment" |

## 10. Point 9: environment tables, the whole row opens

Decision. `EnvironmentsList` passes `rowHref={(env) => environmentPath(slug, env.id)}` (so the table gets `data-clickable`, `cursor: pointer`, the whole row as target, Enter on
the focused row, Ctrl/Cmd-click opens a tab, the keyboard row navigation) in both places. The name cell becomes a real link (`<a href>`) so middle-click and "copy link" work; it
does not intercept row clicks (the row handler ignores `INTERACTIVE` targets, so a click on the link follows the link once). A chevron cell (`env-row-chevron`, 14 px
`chevron-right`, `--text-muted`, `--text-primary` on row hover/focus) closes every row at rest; the hover-only "Manage" icon button is removed (the row is the action);
"Run default preset" and "Test connection" stay as row actions (overflow menu). The name underlines on row hover. At 390 the card list gets the same: the whole card opens,
chevron at the name line's end. Shots: `mock-page-environments-table-{1440,390}`, `-hover-1440`, `-focus-1440`, `sheet-table-*`, `current-envtable-*`.

| Id | Element | Width | Criterion |
|---|---|---|---|
| C-9-1 | `env-row` (`tr[data-row-id]`) | 1440 / 1024 | `cursor: pointer` (today `auto`), `data-clickable` present, height 40 +- 0 (unchanged) |
| C-9-2 | any cell of the row (URL, health, schema, groups, preset, cap, chevron) | 1440 | a click navigates to `/projects/<slug>/environments/<id>` (today: only the name); a click on the row actions (menu, Run default preset) does not navigate; selecting text (drag) does not navigate |
| C-9-3 | hover | 1440 | all cells' background `--bg-hover` (#2a2a3c, already true) and the name underlined; the chevron colour changes from `--text-muted` to `--text-primary`; measured with the pointer on the URL cell |
| C-9-4 | focus | 1440 | Tab reaches the row (`tabindex=0` on one row, arrows move); `:focus-visible` draws the 2px accent ring (`--focus-ring`) around the row; contrast of the ring against the row >= 3:1 |
| C-9-5 | keyboard | 1440 | Enter on the focused row opens the environment page; Space does nothing; Ctrl/Cmd+Enter or Ctrl/Cmd+click opens a new tab |
| C-9-6 | name | all | rendered as `<a href="/projects/<slug>/environments/<id>">`; middle-click opens a new tab; `Disabled` tag stays beside it |
| C-9-7 | chevron | 1440 / 390 | present at rest on every row (count = rows), 14 x 14 px, visible without hover; 0 hover-only affordances needed to know the row opens |
| C-9-8 | 390 cards | 390 | the whole card (279 px wide) opens; card hover/pressed per the DataTable card recipe; chevron present; the "More" line still expands without navigating |
| C-9-9 | both places | 1440 | Experiments -> Environments and Project settings -> Environments tables have the same columns, row height, cursor and behaviour (0 differences in the list of `data-part`s and computed cursor) |

## 11. Implementation requirements

### 11.1 Task per experiment (decision I1)

* **Spec shape: no migration.** The stored spec already accepts `evaluator.task` as a string or an object keyed by environment id (`services/eval_datasets.py` `_normalize_task`,
  `task_for_environment`; the dispatcher resolves the id per environment, `unit_document`). The UI now writes the **string form** (`"task": "answer-ticket"`; absent for Worker default). Nothing is
  rewritten in the database, old experiments with the object form keep being read (the detail page reads `params.task` per job). `GET /experiments/{id}` keeps returning what is stored.
* **Validation** (already per environment in `api/experiments.py` around the `task_id` loop): `task_unsupported` (environment declares no `task`) and `task_unknown` (id not in its live list) become
  the errors behind C-2-6. Their `environment_id` field is what flags the box; add `pointer: "/evaluator/task"` (today `/evaluator/task/<envId>`) so the UI focuses the single Task Select. A
  service whose list could not be read keeps the `task_unverified` warning. Make `_normalize_task` accept the string form with the **same** error codes (it does) and drop
  the `task_unknown_environment` check for strings (n/a).
* **Frontend model**: `doc.selection.tasks` (map by environment) becomes `doc.selection.task: string | null`; `setTask`, `changedTasks`, `diffCount().tasks`, the launch body builder (`buildSpec`/`evaluator.ts`),
  `pointers.ts` (`/evaluator/task` replaces `/evaluator/task/{env.id}`), `validation.ts` (union list, flagged environments from the dry-run errors with `environment_id`), the review "Changes" row ("Task changed"),
  clone (`?clone=` of an object form: all values equal -> that value, else "different per environment", read-only) and the editor (preset `evaluator.task` is already a string, `eval_presets.py` l.296). `EnvTask` is deleted;
  `TaskCard` (new, `entry/TaskCard.tsx`) uses `useEnvTaskLists(projectId, selectedEnvs)` (exists) for the union and offering sets.
* **Tests**: unit for the union/offer logic; e2e `multi-task.spec.ts` rewritten (one Select, flagged box, launch blocked, fixed by unticking); `tests/platform` task validation cases keep passing (string form is the same code path).

### 11.2 Per-job priority (decision I2)

* **API, launch body** (`ExperimentCreateRequest`): new optional `job_priorities: List[JobPriority]` where `JobPriority = {environment_id: str, combo_index: int, dataset_index: int = 0, priority: EvalPriority}`
  (the three keys already identify a job in the dry-run preview: `jobs[].environment_id/combo_index/dataset_index`). Unlisted jobs get the experiment priority (the existing `priority` / environment default).
  Unknown keys -> 422 `job_priority_unknown`. Dry run echoes the effective priority in `jobs[].priority` and returns `preemption_warning` naming the environments of High jobs only.
* **Rules** in `_resolve_priority` generalised to `_resolve_job_priorities(db, principal, project_id, envs, planned, requested, per_job)`: each job's priority must not exceed **its environment's** `max_priority`
  (422 "Priority HIGH exceeds the maximum allowed on: <env>"); HIGH anywhere needs `is_project_manager` (403 as today); `_require_preemption_ack` triggers when **any** job is HIGH
  (acknowledgement is experiment-level; `preemption_acknowledged_at` set when any job is HIGH, today only when `experiment.priority == HIGH`, l.1653 and the retry path l.2128).
* **Storage**: `eval_experiment_jobs.priority` new nullable `String(10)` column (values LOW/NORMAL/HIGH; NULL = the experiment's), Alembic **0102** (key-scopes' branch took 0101 `api_key_kind`: take
  the next free revision after the merge, `down_revision` accordingly), backfill from `request_body->>'priority'` in Python (works on SQLite and PostgreSQL), no data change for readers. `_request_body(...)` already writes
  `out["priority"]` per job: pass the job's priority, so what the Evaluation Service receives is unchanged in shape (`POST /evals` already has a per-job `priority`, guide v1.3 section 4).
* **Reads**: `eval_queue.job_priority(job, experiment)` returns `job.priority` first, then `request_body.priority`, then the experiment's (already the order of the last two); job payloads (`_job_view`, queue items `api/eval_queue.py` l.313,
  experiment detail `jobs[]`) gain `priority`; the experiment payload keeps `priority` (the default) and gains `priorities: {LOW: n, NORMAL: n, HIGH: n}`; the High count feeds the existing "high" badge.
  Retry (`api/experiments.py` ~l.2055 and l.2128) uses the **job's** priority (`_resolve_priority(..., [env], job_priority)`) and acks if it is HIGH.
* **Dispatcher ordering**: across experiments unchanged (priority is enforced by the Evaluation Service; `eval_queue.py` header). **Within one experiment** the claim order gets a tie-break so higher-priority jobs of a sweep are submitted first: `order_by(coalesce(next_attempt_at, created_at), created_at, priority_rank DESC, combo_index, dataset_index)` with `priority_rank` a CASE over the new column (HIGH 2, NORMAL 1, LOW 0, NULL -> the experiment's rank via join, or store the resolved value at launch so no join is needed: recommended, set `job.priority` always at launch). See question Q4.
* **CLI / SDK read side**: `qym run list` carries runs, not jobs; jobs are read in `qym experiment` commands if present (grep `eval_experiment` in `packages/sdk/qym/cli`): add `priority` to the job rows of
  `--json` when they exist; no SDK model change otherwise. Docs: `docs/USER_GUIDE.md` (experiments: priority per run) and `docs/internal/OPERATIONS.md` queue note.
* **Frontend**: `doc.jobPriorities: Record<jobKey, Priority>` (key `${envId}:${combo}:${dataset}` from the dry-run preview), `useDryRun` sends `job_priorities`, `ReviewRuns` (new) renders the table from `preview.data.jobs`; the `RunSettings` priority remains the default; the ack checkbox state is shared with the existing HIGH callout.
* **Tests**: platform unit (cap per environment, non-manager, ack required with one High job, retry keeps the job's priority, ordering tie-break); API contract test for `job_priorities` unknown key; Postgres migration test; e2e `review-d.spec.ts` extended.

### 11.3 Environment route unification (I3)

Delete `EnvironmentDrawer` from `EnvironmentsPanel.tsx`; `onOpen` navigates to `environmentPath(slug, env.id)`; keep the `?env=` effect as a redirect (`<Navigate replace>`); `EnvironmentPanelBody`
loses `onClose` (footer without Close); `EnvironmentPage` is the only host; add the read-only Tasks section (`EnvironmentSections.tsx`, `useEnvTasks`). Page crumbs unchanged. Update `e2e/experiments/cutover-environments.spec.ts` and `tests` that assert the drawer.

### 11.4 Preset editor reuse

Section 9. Files: `launch/wizard/LaunchWizard.tsx` (props), `launch/wizard/steps.ts` (`EDITOR_STEPS`), `launch/review/ReviewPane.tsx` -> `ReviewStep.tsx` (+ `PublishReview` using `editor`, `PublishPane`'s release notes and `publishBlocker`), `launch/review/LaunchBar.tsx` (new, replaces `WizardBar`, `StepNav`, `HomeBar` chrome), `environments/DefaultPresetEditorPage.tsx` (wizard host, keeps conflict/guard/publish code),
`environments/editor/EditorEntry.tsx` (-> `ComparedWithCard`). `LaunchProvider` already has `mode="editor"` and `useStep` works for any id set (check `parseStep` against the active step list).

### 11.5 Tables

`EnvironmentsList.tsx`: `rowHref`, name as `<a>`/`LinkButton`, chevron column, drop the `manage` row action (keep `run-default` and `test`); card mode in `ui/DataTable` already honours `data-clickable`; verify the card click target. `EnvironmentsTable.module.css`: `.nameLink` underline on row hover, `.chev`.

### 11.6 Evaluation Service side: no addendum required

The task-per-experiment change does **not** alter the `POST /evals` body versus `docs/evaluation-service-change-request-v1.4.md`: the platform still creates one job per environment and unit, and each job's
`evaluator.task` is a single string id from that service's `GET /evals/tasks` (section 4) or absent. What changes is only who picks it (one choice for all environments) and that the platform
now refuses to launch when a ticked service does not list the id (the same `422 unknown task: <id>` it would have returned at submit). Per-job priority likewise uses the existing `priority`
field of `POST /evals` (guide v1.3 section 4), one job at a time. If the team wants it on record, this optional one-paragraph note can be appended to section 4 of the change request:

> **4.4 Task ids across deployments (informative).** A qym experiment names one task and runs it on every selected environment, one job per environment. Deployments that serve the same agent
> should therefore register the same task `id` (the `name` may differ). qym checks the id against each service's `GET /evals/tasks` before it launches and does not send the job to a service that
> does not list it; the service-side `422 unknown task: <id>` remains the authority. No new field, status code or endpoint.

## 12. Design-language amendments (section 6 amendment rule)

1. `DESIGN_LANGUAGE.md` 3.2, Card paragraph: add **"Option box"** = a selectable box inside a card is `--bg-elevated` with `--border-default` (1.10:1 and 1.59:1 on `--bg-surface`), hover `--bg-hover`, selected = accent border + `--rail-width` rail + `--tint-soft`
   tint, flagged = `--error` border + rail; never `--bg-base` inside a card. Reason: measured 1.06:1 darker-than-card boxes (section 2 of this spec).
2. 3.2 Sticky bars: the action-bar family is one recipe (`LaunchBar`: elevated, `--border-default`, `--shadow-popover`, 56 px, buttons 24 px); a 42 px surface-coloured step nav is retired. Wizard bars keep **the same slots on every step** (disabled, not removed).
3. 3.4: a table whose rows open a page sets `rowHref`/`onRowOpen` (whole-row target, pointer, Enter, chevron at rest, name as a link); hover-only row buttons are not the only way to open.
4. Section 7 new rule: **"A control the user needs on every step appears on every step."** Optional controls are disabled in place; a bar that gains buttons on some pages is read as a different page (owner QA 2026-10-28, point 3). Criterion: part count per step identical.
5. Amended earlier criteria: `redesign/experiments-create.md` 5.2 "review in the side column on steps 1-5" is replaced by C-4-1 (Review step only); its StepNav ("Back / Continue to <next> / Skip to review" under each step) is replaced by C-3-2 (one bar, fixed labels); the
   per-environment Task row (`06` section on tasks, `multi-launch` criteria for `[data-env-task]`) is replaced by C-2-1 and C-2-3; the environment drawer of `06` section 2.9 is replaced by C-7-1.

## 13. Criteria count and shot list

Criteria: point 1: 7 (C-1-1..7), point 2: 8, point 3: 9, point 4: 4, point 5: 9, point 6: 11, point 7: 7, point 8: 8, point 9: 9 = **72**.

Shots (`shots/`): `current-create-home-{1440,1024,390}`, `current-create-home-empty-{1440,1024,390}`, `current-step-{where,start,models,settings,evaluation,review}-{1440,1024,390}`,
`current-review-sweep-{1440,390}`, `current-review-sweep-names-{1440,390}`, `current-preset-editor-{1440,1024,390}`, `current-envdetail-{page,settings}-{1440,390}`,
`current-envtable-{page,settings}-{1440,390}`, `current-envtable-page-hover-1440`; composed mocks `mock-page-{create-home,create-home-flagged,customize-where,customize-models,customize-settings,review,preset-edit,preset-publish,environment-experiments,environment-settings,environments-table}-{1440,390}`
plus `mock-page-environments-table-{hover,focus}-1440`; appendix `sheet-{bar,boxes,task,priority,table}-{1440,390}`.

## 14. Questions for the owner (what the measurements leave open)

1. **Return path from Project settings.** With one route (I3), "All environments" goes to Experiments -> Environments; someone who came from Project settings -> Environments lands in the Experiments area. Recommended: keep it (one page, one back link). Alternative: honour `?from=settings` and label the link "Project settings".
2. **Task for services without task selection.** An environment whose service declares no `task` offers only "Worker default" (section 3). If the user picks a named task while such an environment is ticked, it is flagged and launch blocks. Alternative: silently run Worker default there (the platform did that before for jobs without a stored task). Recommended: block and flag (an experiment is meant to compare like with like).
3. **"Set every run to" shortcut** in the runs header (C-6-7). Not in the owner's words; useful from 6 runs up. Recommended: keep; remove if it reads as clutter.
4. **Submission order inside a sweep.** The design makes High runs be submitted first within one experiment (tie-break in the dispatcher claim query, section 11.2). Across experiments the platform stays neutral because the Evaluation Service decides by priority. Recommended: yes; the alternative is to leave submit order by combination index and rely on the service alone.
