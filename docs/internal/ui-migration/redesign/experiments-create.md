# Redesign brief: experiment creation (home + customize)

Area: `experiments-create`. Investigated against the legacy vanilla UI (worktree `qym-wt-legacy` at 7814183, platform :8825)
and the React app on `UI-redesign` (platform :8826, Vite :5826), same seed (`frontend/scripts/seed_experiments.py`: project
`exp-demo`, environments `staging` with default preset v1 + saved preset, `production` bare, dataset `golden`, 4 experiments, two
fake Evaluation Services on 8975/8976). Screenshots (1440 px unless noted) are kept in the scratchpad, not the repo:
`/tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/61846e82-dc0e-402d-b3ec-d3565a3b1b04/scratchpad/ec/`
(`legacy-home.png`, `legacy-home-ready.png`, `legacy-step1..6.png`, `react-home.png`, `react-ready-full.png`, `react-models.png`,
`react-settings.png`, `react-390-fold.png`).

## 1. Feedback point

> experiments creation page lost the intended user experience of a simple home page for non-technical users, and the smooth
> per-section transition in the customize page.

Reading, grounded in the legacy code: the legacy flow was two screens. The **home** (`?new=1`, `renderEntryLayout`,
`experiment_launch.js:3715`) asked for exactly three things: where it runs (tick an environment), what to start from (one of three
big cards, the recommended default preset pre-selected as soon as the environment has one) and a name. Everything else (priority,
versioning details, models, 100+ settings, evaluation inputs, raw JSON) was off that screen. A sticky bar at the bottom carried the
status ("Ready: Default preset v1 on staging") and the two ways forward: **Launch as is** or **Customize ->**. A non-technical
user needed 3 decisions: tick one box, type a name, press Launch as is. The **customize** page was a six-step wizard
(`WIZARD_STEPS`, `experiment_launch.js:3907`): one step on screen at a time under a six-segment progress rail, with Back /
"Continue to <next step>" / "Skip to review", a count badge on the steps that hold edits, and the review panel always in view at
the side (moving into the main column on the last step). "Smooth per-section transition" therefore means: one section at a time,
a rail that shows where you are and how far, an obvious next action, and the page scrolling back to the top of the new step.
Important accuracy note: the legacy wizard had **no animated transition**. A step change is `group.hidden = true/false`
(`setStep`, l.4063) followed by `page.scrollIntoView({block:'start'})` (l.4093); the only CSS motion in the whole flow is a 0.15 s
chevron rotation on `<details>` and `behavior:'smooth'` scrolls when focusing an error. The "smoothness" the product owner
remembers is the guided step-at-a-time structure; the motion spec in section 5 is new and is written to make that structure feel
smooth.

The React app replaced the two screens with one long page (entry block, then five collapsible sections, then a 22rem review
pane), so the short path and the guided steps are both gone.

## 2. Legacy page anatomy

All files in `packages/platform/qym_platform/_static/dashboard/` of the legacy worktree.

### 2.1 Home (entry) page: `experiment_launch.js` `renderEntryLayout` l.3715-3735, `renderStarts` l.3787, `renderEntryBar` l.3852; `experiment_launch.css` l.150-175

Layout (screenshot `legacy-home-ready.png`): back link "<- Experiments" (`.xl-back`, 11 px muted), `h1` "New experiment" (22 px / 650),
one muted line "Pick where it runs and what to start from. You can change anything in Customize.", then:

| Block | Content (exact copy) | Layout / CSS |
|---|---|---|
| Environment card | title "Environment", sub "Each selected environment gets one job."; "+ New environment" button (managers); checkbox list, one row per active environment: name (13 px bold), "Details" link, tags: health ("Healthy"), "Priority up to high", "Default preset v1" (mono), "No schema", "Needs LLM grouping", "Checking schema..." | `.xl-entry-where`: 2 equal columns, `align-items: stretch`, gap `--space-md`; `.xl-env-option` bordered rows, selected = accent border |
| Dataset card | title "Dataset", sub "The project dataset to evaluate on, optionally pinned to a version or alias."; dataset select + "Latest version" select. The dataset is pre-filled when the chosen base (preset) carries one. Empty project: "This project has no datasets yet. Add one under Datasets first." | same row height as Environment card |
| Start from | section title "Start from"; 3 large cards in `.xl-start-grid` (3 columns, gap 16 px, card padding `--space-lg`, radius 10 px): **Recommended / Default preset v1 / "What this environment's managers published." / "<release note>"**; **Best past run / Top-scoring run / "The configuration of a top-scoring official run on golden." / "Choose what "best" means after picking it."**; **Copy an experiment / <most recent experiment name> / "Your most recent experiment." / <its environments>** (loads 3 recent, shows the first). Selected card = 2 px accent border + elevated bg + accent eyebrow. Disabled card = 0.6 opacity with the reason ("Pick an environment first.", "No default preset is published for staging yet.") | `.xl-start-card` is a `<button aria-pressed>`; eyebrow 11 px uppercase, title 15 px, body 12 px |
| Other / Saved presets | sub-label "Saved presets" (or "Other"); compact cards (4-up grid): each saved preset ("Fast timeouts / v1 · by Dev User") and "From scratch / The environment's own settings" | `.xl-start-grid--compact` |
| Base status | label "Default preset v1", "0 changes on top" tag, "Undo all changes", hint "Your changes below are applied on top of it. A changed setting shows a dot; Reset puts back the starting value.", release notes; best-run scope picker only when "Top-scoring run" is chosen | below the cards |
| Entry bar | `position: sticky; bottom: 0` bordered bar: name input "Experiment name" (flex 0 1 320px), status text, buttons **Launch as is** (neutral) and **Customize ->** (accent) | `.xl-entry-bar` |

Behaviour and defaults:
- Nothing is selected on load (no env checked, screenshot `legacy-home.png`: status "Pick an environment."; Default preset card disabled
  "Pick an environment first."; "From scratch" is the selected card). Ticking an environment with a published default preset selects
  "Default preset vN" automatically and triggers the debounced dry run.
- Status text (l.3857): "Pick an environment." / "Checking..." / the server error / "Over the run limit" / "N problem(s) to fix" + a **Show** link /
  "Ready: <base> on <envs>". With environment ticked and no name the status is "1 problem to fix" (the missing name); after typing a name it reads
  "Ready: Default preset v1 on staging" (verified in the browser).
- Decisions to launch a default experiment: tick 1 environment, type a name, click **Launch as is** (3 actions). Priority (defaults to the
  environment's), versioning details, models, settings and evaluation inputs are all inherited from the preset.
- "Show" on a problem that the entry screen does not hold (anything other than name, environment, base, dataset: `entryHolds`, l.3702) switches to Customize
  and jumps to the right step (`focusError`, l.1956).
- The name input is built once so typing is never interrupted by re-renders (l.3867).

### 2.2 Customize page: `renderWizardLayout` l.4000-4060, `setStep`/`placePreview` l.4063-4094; `experiment_launch.css` l.178-200

Header: "<- Start" link (back to the home view, `st.view='entry'`), `h1` "Customize experiment", meta line "Exp-Demo · Starting point: Default preset v1"
(+ a warning tag "Versions changed since this run" when the environment drifted).

Step rail (`ol.xl-steps`, `grid-template-columns: repeat(6, 1fr)`, gap 8 px): each step is a button with a 4 px bar over the label
"<n> <label>"; label 12 px; `--done` (all steps before the current one) = accent bar and secondary text; `--current` = accent bar, primary
text, 600 weight, `aria-current="step"`; upcoming = grey bar, muted text. Steps (non-editor mode): **1 Where it runs** (Name and priority card: name,
priority, versioning details + HIGH callout; Environments; Dataset), **2 Starting point** ("Start from": the same cards as home as a segmented control,
saved preset select, best-run picker, base status), **3 Models** (versions, global model, slot cards, add endpoint), **4 Environment configurations**
(Environment overrides tree with search / "Changed only" / Reset all and `<details>` groups closed by default, Role overrides table, Sweeps card when something is
swept), **5 Evaluation configurations** (evaluation inputs, run metadata, platform-owned), **6 Review and launch** (review panel moved into the main column, then
the Raw JSON card). Steps 4 and 5 carry a changed-count badge (`qym-tag--count`, hidden at 0, title "N settings changed from the starting point").
Mobile (<=960 px): the rail becomes a single column list.

Movement: every rail button is always clickable (no gating, no validation on move; "done" means "earlier", not "valid"). Below the active step: a nav row
`Back` (left) and on the right `Skip to review` (shown from step 3 up to step 5: "The configuration steps are optional") + the accent button
**"Continue to <next step label lowercased>"**. One step group is visible at a time (`.xl-step-group[hidden]{display:none}`); the others stay mounted so state is kept.
On each move the page scrolls to the top of the page (`page.scrollIntoView`). The Review panel (320 px, `position: sticky; top: var(--space-md)`) sits in the side
column on steps 1-5 and is re-parented into the main column on step 6 (`.xl-layout--wide`), where the side column is hidden. Below 1100 px the layout is a single column and the
panel is static.

Validation timing: continuous, not per step. A debounced dry run of `POST /experiments` previews every edit and the Review panel lists errors; clicking an error
(`focusError`) switches to the step that holds the field (`group.hidden` -> `setStep`), clears search / "changed only", opens the enclosing `<details>`, smooth-scrolls to
the field (`block:'center'`), focuses it and flashes it with a 2 px warning outline for 1.6 s (`.xl-flash`). The rail shows no per-step error state. Launch is
in the Review panel (always visible); it runs local validation first and focuses the first error.

Motion inventory (complete, grepped `transition|animation|scroll` in `experiment_launch*.css/js`): `.xl-group > summary::before` and
`.xl-advanced-config > summary::before` chevron `transition: transform 0.15s ease`; `ui_components.css` button/control `transition: ... 0.15s`; smooth scroll in `focusError`
and `advanced.open`. No step enter/exit animation, no height animation, no `prefers-reduced-motion` rules in the launch CSS.

Density: card header padding `--space-md/--space-lg`, section title 15 px (`--font-lg`), field labels 11 px, body 12 px, card radius 8 px, 16 px gaps.

## 3. React page anatomy

Route `/projects/:slug/experiments/new` (`features/experiments/ExperimentsRoutes.tsx`), page `launch/LaunchPage.tsx`. State is one custom `LaunchDocument`
(`launch/model/*`, `LaunchProvider.tsx` 1031 lines) exposed through `useLaunch()` (`LaunchContext.tsx`). **react-hook-form is not used in the launch form**: edits go through
`setDoc(updater)` with pure model functions; the "RHF-safe" names in `registerField` are only DOM-registry keys for focusing. The provider is keyed on `location.search`
(`LaunchPage.tsx` l.130: "A new search string ... is a new form"). Validation is `reviewState()` over the live dry run (`useDryRun`, 600 ms debounce), shown only in the
review pane and per-section problem lists; nothing is gated.

Page structure (screenshots `react-home.png`, `react-ready-full.png`, `react-models.png`, `react-settings.png`):

```
PageHeader "New experiment" / "Pick where it runs, what it runs on and where it starts; the review stays in view."   [All experiments]
.layout (>=1200px: grid minmax(0,1fr) 22rem; else 1 column)
  .main
    Outline (sticky row of 4 buttons: Models | Environment configurations | Evaluation configurations | Raw JSON; hidden until an env is picked)
    EntryBlock (one panel): [EnvironmentPicker | DatasetPicker] / StartFrom cards + BaseStatus / RunSettings (name, priority, versioning textarea, HIGH callout)
    ModelsSection  (collapsible LaunchSection, open by default)
    SettingsSection (open)   [SweepsSection only when swept]   EvaluationSection (closed)   RawJsonSection (closed)
    < 1200px: ReviewPane + MobileLaunchBar (sticky bottom: "N runs to launch", first problem link, Cancel / Raw JSON / Launch)
  .aside (>=1200px, sticky, max-height 100vh-2xl): ReviewPane (summary, "N runs to launch", Changes by step with Edit links, validation list, Cancel / Raw JSON / Launch)
```

Component tree (all under `frontend/src/features/experiments/launch/`):
`LaunchPage` -> `LaunchProvider` -> `LaunchBody` -> { `components/Outline`, `entry/EntryBlock` (`EnvironmentPicker`, `DatasetPicker`, `StartFrom` (`BestRunPicker` from `sections/`, `BaseStatus`), `RunSettings`),
`sections/ModelsSection` | `SettingsSection` | `SweepsSection` | `EvaluationSection` | `RawJsonSection` (each wrapped in `components/LaunchSection`), `review/ReviewPane` (`LaunchActions`), `review/MobileLaunchBar` }.
The same sections and `Outline` are reused by `features/environments/DefaultPresetEditorPage.tsx` (editor mode, `SECTIONS = models, settings, evaluation, raw`, `EditorEntry`, `PublishPane`).

What `LaunchSection` does (`components/LaunchSection.tsx`): heading button with chevron icon swap, a "N changed"/"no changes" count tag, a red problem count, open state in
`sectionState.open`, and `{open ? <div className={sectionBody}>...</div> : null}` (**conditional render, no animation**: measured in the browser, the evaluation card height went
74 px -> 1066 px within one animation frame). Defaults (`useSections.ts`): models/settings/sweeps open, evaluation/raw closed. "Go to section" (`goToSection.ts`, Outline, review "Edit" links)
opens the section and calls `scrollIntoView({block:'center'})` (instant) + focus.

Motion inventory (grepped): `settings.module.css` l.137 control border/shadow `--transition-fast`; nothing else in `launch/`. The global reduced-motion rule is in `styles/base.css` l.92.

Entry block fields shown at once, first screen at 1440x900 (`react-home.png`): Environments, Dataset (+ version), 4 Start-from cards, Experiment name, Priority, Versioning details textarea, review pane with "3 PROBLEMS" red badge and
a Raw JSON button; five more sections below the fold. At 390 px (`react-390-fold.png`) the first screen is Environments, Dataset, Start from with a sticky "0 runs to launch / Fix 3 problems first: Environments" bar.

## 4. Gap analysis

| # | Legacy | React | Why it matters | Proposed change |
|---|---|---|---|---|
| 1 | Two screens: home (3 inputs) and Customize | One page with all fields | Non-technical users face priority, versioning textarea, JSON, 5 sections on first view | Restore a home view and a separate customize wizard (section 5.1 / 5.2) |
| 2 | Name is the only text field on home; priority and versioning live in Customize step 1 | Name + priority + versioning textarea in the entry block | 2 extra decisions before launching | Move priority, versioning details and the HIGH callout to wizard step 1; keep name on the home bar |
| 3 | Sticky entry bar with status + "Launch as is" + "Customize ->" | Review pane (aside) with 3 problem cards at first paint; "Launch as is" is a small button buried in the base status line | The primary decision (launch now vs tweak) is not visible; empty state shows red "3 PROBLEMS" | Home bar per 5.1; show neutral "Pick an environment" status first, red problems only after interaction or Show |
| 4 | Three big start cards (Recommended / Best past run / Copy an experiment) + compact saved presets + From scratch, with eyebrow, body, release-note meta | 4-5 small equal cards, "Recommended" tag, saved presets collapsed into one card + select, "Copy an experiment" is a link-card that remounts the form | Fewer, clearer choices; the legacy copy explains each in a sentence | Rebuild `StartFrom` as 3 large + compact row (5.1) |
| 5 | Selected card has a 2 px accent border; disabled card says why | 1 px accent border; disabled shows reason | Selection is hard to see at a glance | 2 px selected border, same reasons |
| 6 | Environment and Dataset are two cards of equal height | Both in one panel, dataset select only | Less scanning effort; matches legacy | Two cards (5.1) |
| 7 | Six-step wizard with segmented rail, current/done/upcoming states, step count badges | Sticky "Outline" of 4 jump buttons, all sections stacked | No sense of position or completeness; long scroll (the page is ~2000 px tall before any section is expanded) | `Stepper` rail + one `StepPanel` at a time (5.2) |
| 8 | Back / "Continue to <next>" / "Skip to review" under each step | No sequential affordance | The next action is not obvious; the optional steps cannot be skipped explicitly | `StepNav` (5.2) |
| 9 | Review in the side column on steps 1-5, in the main column on step 6, always shows Launch | Review aside always on the right; below 1200 px at the bottom + sticky bar | Same on desktop; React adds a better narrow bar | Keep aside + `MobileLaunchBar`; on the last step the review fills the main column |
| 10 | Step change = `hidden` swap + scroll to top; no animation | Section open/close = conditional render, instant | The feedback asks for "smooth": neither version animates, but the stacked page makes jumps larger | Direction-aware step enter, rail fill, `Collapse` for groups, smooth scroll (5.3) |
| 11 | Errors: click focuses field, switches step, opens `<details>`, flashes outline 1.6 s | Click focuses field, opens section/group; no flash | Without steps the flash is the only guide to the field | Keep React focus logic, add step switch + 1.2 s outline flash token-based |
| 12 | Wizard state lives in memory; no URL | Search params define the form and key the provider | Step must be deep-linkable and not remount the form | `?step=` param excluded from the provider key (5.4) |
| 13 | Changed-count badges only on steps 4 and 5; no error state per step | Count tag + problem tag per section (richer) | React's richer counts are worth keeping | Rail shows changes badge (info) and problem dot (danger) per step |
| 14 | Editor (default preset) uses the same wizard with 6 steps ("Dataset", "Compared with", ...) | Editor page is the stacked page with `Outline` | Keep the two flows consistent | Phase 2: `LaunchWizard` with `mode="editor"` step config |
| 15 | Mobile: rail is a single column list | n/a | A 6-row rail wastes the fold at 390 px | Mobile rail = compact "Step 3 of 6: Models" bar + horizontal dots (5.2) |

## 5. Redesign spec

Everything stays inside `docs/DESIGN_LANGUAGE.md` tokens. No field, validation, URL param or request-body behaviour changes: the model layer (`launch/model`),
`LaunchProvider`, `useLaunch()` and all section bodies are reused as is.

### 5.1 Home view (`LaunchHome`), default route `/experiments/new`

Goal: tick an environment, name it, press Launch as is. Everything else is optional and one click away.

Page structure:
```
PageHeader  "New experiment"   desc "Pick where it runs and what to start from. You can change anything in Customize."   [All experiments]

+--------------------------- Environment ------------+  +--------------- Dataset ----------------------+
| Each selected environment gets one job.  [+ New env]|  | The project dataset to evaluate on ...        |
| [ ] production   Healthy  Priority up to HIGH   Det.|  | [ golden            v ] [ Latest version v ]  |
| [x] staging      Healthy  Priority up to HIGH  v1   |  | (empty: "This project has no datasets yet.")  |
+-----------------------------------------------------+  +-----------------------------------------------+

Start from
+------------------+ +------------------+ +------------------------+
| RECOMMENDED      | | BEST PAST RUN    | | COPY AN EXPERIMENT     |
| Default preset v1| | Top-scoring run  | | urgent check           |
| What this env's  | | The configuration| | Your most recent       |
| managers publ... | | of a top-scoring | | experiment.            |
| "Initial default"| | official run ... | | staging                |
+------------------+ +------------------+ +------------------------+
SAVED PRESETS
+----------------------+ +------------------------+        (compact, 4 across)
| Fast timeouts        | | From scratch           |
| v1 · by Dev User     | | The environment's own  |
+----------------------+ +------------------------+
Default preset v1  [0 changes on top]  Undo all changes          (BaseStatus, notes, best-run scope picker when chosen)

==== sticky bottom bar ===================================================================================
[ Experiment name______________ ]  Ready: Default preset v1 on staging        [Launch as is] [Customize ->]
```
Mobile (390): single column; Environment card, Dataset card, start cards stacked 1-up (compact 2-up), bar becomes two rows (name input full width; status + buttons below, both buttons
full-width half each). No review pane on the home view at any width (the status line and `N runs to launch` text inside the bar replace it).

Rules:
- Home shows only: header, `EnvironmentPicker`, `DatasetPicker`, `StartFrom`, `BaseStatus`, `HomeBar`. Priority, versioning details, Outline, all sections, `ReviewPane`, `MobileLaunchBar` are not rendered on home.
- `StartFrom` becomes two grids: `.startGrid` (3 columns >=960, 1 column below) with the three large cards (Default preset vN [Recommended] / Best run ("Top-scoring run") / Copy an experiment) and `.startGridCompact` (4 columns >=960, 2 below) with each saved preset
  and "From scratch". Copy: reuse the legacy strings quoted in 2.1. "Copy an experiment" keeps its current behaviour (navigates to `?clone=<latest id>`, with the unsaved-changes guard). Selected = 2 px `--accent-primary` border + `--bg-elevated`; disabled = `aria-disabled` 0.6 opacity with the reason as the body text.
  Keep the radiogroup semantics of the current `StartFrom` (role radio, `aria-checked`).
- `HomeBar` (new, `position: sticky; bottom: 0; z-index` same layer as the current `MobileLaunchBar`): `TextField` "Experiment name" (320 px basis, `maxLength=NAME_MAX`, same ref registration `registerField(pointerToFieldName(PSEUDO.name))`),
  status `role="status"` text, and buttons `Launch as is` (`variant="neutral"`, disabled with `readOnly || !review.canLaunch || review.items.length > 0 || isLaunching`, `loading` while launching, uses `launch()`) and `Customize ->` (`variant="accent"`, `goToStep('where')` or the first step that holds a problem).
  Status text: no env -> "Pick an environment."; `preview.loading` -> "Checking..."; `preview.error` -> that error; `review.count.over` -> "Over the run limit"; problems -> "N problem(s) to fix" + `Show` link button (`focusIssue(first)`, which switches to Customize when the field is not on home, see 5.4); else "Ready: <baseLabel> on <env names>".
  Pre-interaction state: the empty form must not look broken. Until an environment is ticked the status is neutral text, not red problems (the red per-problem cards of the review pane do not exist on home).
- Defaults: unchanged from the model (`chooseBase('default')` when the environment has a published default preset; otherwise scratch with a note). Dataset comes from the base. See open question Q1 about pre-ticking a sole environment.
- Not changed: `EnvironmentPicker`, `DatasetPicker`, `BaseStatus` internals (only the container styling and the "Launch as is" button removed from `BaseStatus` since the bar owns it; `flags.canLaunchAsIs` is no longer used by `BaseStatus`, but stays in the context).

### 5.2 Customize view (`LaunchWizard`), `?step=<id>`

Six steps; ids and labels (copy kept from legacy):

| # | id | Label | Content (existing components) |
|---|---|---|---|
| 1 | `where` | Where it runs | "Name and priority" card (name `TextField`, Priority `Select`, Versioning details `Textarea`, HIGH `Callout` = current `RunSettings`), `EnvironmentPicker`, `DatasetPicker` |
| 2 | `start` | Starting point | `StartFrom` (same component as home, rendered in segmented/card form) + `BaseStatus` + `BestRunPicker` |
| 3 | `models` | Models | `ModelsSection` body |
| 4 | `settings` | Environment configurations | `SettingsSection` body, then `SweepsSection` body when swept (as in legacy) |
| 5 | `evaluation` | Evaluation configurations | `EvaluationSection` body |
| 6 | `review` | Review and launch | `ReviewPane` (wide, in the main column) then `RawJsonSection` body |

Layout:
```
<- Start                                           (link: back to home, keeps all edits)
Customize experiment
Exp-Demo · Starting point: Default preset v1   [Versions changed since this run]

[==1 Where it runs][==2 Starting point][==3 Models ][--4 Environment configurations (2)][--5 Evaluation configurations][--6 Review and launch]
 done=accent bar     done              current       upcoming, "(2)" = changed count, red dot = problems

+-------- main (min 0, 1fr) -----------------------------------+  +------ aside 22rem, sticky ------+
| Models                         [no changes]                   |  | Review    READY                 |
| Pick one model for every LLM endpoint, ...                    |  | Environments / Dataset / ...    |
| ... step body ...                                             |  | 1 run to launch                 |
|                                                                |  | Changes by step  (Edit links)   |
| [Back]                    [Skip to review] [Continue to env.. ]|  | Validation  ... [Launch N runs] |
+----------------------------------------------------------------+  +---------------------------------+
Step 6: no aside; the review fills the main column, Raw JSON card under it.
```
Mobile (390): the rail is replaced by a compact header `Step 3 of 6 · Models` with a row of 6 dots (`aria-hidden`; real nav is a `Select`-style dropdown, see below) and the 4 px bar of progress under it; the `MobileLaunchBar` stays (Cancel / Raw JSON / Launch) but is hidden on the review step; `StepNav` sticks above it (`position: sticky; bottom: var(--mobile-bar-height)`, no new magic number: reuse the bar's measured offset via a CSS custom property set by `MobileLaunchBar`).
768: rail wraps to 3 columns x 2 rows; aside below the main column as today. 1280/1920: rail 6 across, aside 22rem sticky (the page max width stays `fullWidth`).

Behaviour:
- The rail is always clickable (no gating, same as legacy). Done = step index < current. Each step shows the changed count (`sectionSummary(...).changes`; step 1 counts dataset/priority/name edits via `datasetChanged`, step 4 includes sweeps axes) as an info count `Tag` and a problem count `Tag tone="danger"` when `sectionSummary().problems.length`, so errors are visible without leaving the step (improvement over legacy; fields and validation unchanged).
- `StepNav`: `Back` (hidden on step 1), `Skip to review` (steps 3-5, `variant="neutral"`), `Continue to <next label lowercased>` (`variant="accent"`; last step shows nothing here because Launch is in the review). Labels identical to legacy.
- Step 6 contents are not hidden behind a disclosure: `RawJsonSection` is rendered open as a card below the review (no collapse in the wizard).
- Inside steps the existing groups stay collapsible (`SettingsSection` groups, Release notes, `FieldNode` expanders) but animate with `Collapse` (5.3).
- Focus: after a step change focus moves to the step heading (`tabindex=-1`, `h2`), a polite `aria-live` region announces "Step 3 of 6: Models" (and "n problems"), and the page scrolls so the rail is at the top of the viewport.
- Errors: `focusIssue(item)` first computes the step of the item (`stepOfSection(sectionOfItem(item))`, name/environments/dataset -> `where`, base -> `start`), switches step, then does the existing group opening + `revealElement`, and adds a 1.2 s `outline: 2px solid var(--warning)` flash on the field (class `flash`, removed by timer; no animation).
- Launch stays in `ReviewPane` / `MobileLaunchBar` exactly as now (disabled while problems exist, HIGH confirm, 422 handling unchanged).

### 5.3 Motion (new, all tokens existing or added to `tokens.css`)

Add tokens: `--motion-step: 180ms` (same value as the Dialog `rise` and Drawer `slide`), `--ease-standard: ease` (existing components use plain `ease`); `--transition-fast` (150 ms) stays for hover/border.

| What | Properties | Duration / easing | Notes |
|---|---|---|---|
| Step panel enter (`StepPanel`, keyed by step id) | `opacity 0 -> 1`, `transform: translateY(8px) -> 0` | 180 ms `ease`, `animation-fill-mode: both` | Only the entering panel animates; the leaving panel unmounts immediately (no cross-fade, no layout double-height). Direction does not change the animation (vertical only, so it is RTL safe). |
| Rail progress bar | `background-color` of each 4 px bar plus a fill via `transform: scaleX(0 -> 1)` with `transform-origin: inline-start` (logical, flips in RTL) | 180 ms `ease` | Moving back un-fills. Implemented inside `Stepper` (the design language forbids page-level selection animations, so this belongs to the primitive). |
| Rail label | `color`, `font-weight` is NOT animated (avoids reflow); use `color` only | `--transition-fast` | Weight swap happens instantly with the aria-current change. |
| Disclosure (`Collapse`: settings groups, base notes, field expanders, any `LaunchSection` kept collapsible in the editor) | `grid-template-rows: 0fr -> 1fr` on the wrapper + inner `overflow: hidden; min-height: 0`; inner `opacity 0 -> 1` | 180 ms `ease` open, 140 ms close | Chevron rotates `transform: rotate(0 -> 90deg)` over `--transition-fast` (replaces the icon swap). Closed content gets `inert` and `visibility: hidden` after the transition (via `transitionend` / `aria-hidden`) so it is not tabbable. |
| Scroll after step change | `window.scrollTo({top: railTop - space, behavior})` | native smooth | `behavior = 'auto'` when `matchMedia('(prefers-reduced-motion: reduce)').matches`. Same rule for `revealElement` (today instant; make it smooth unless reduced). |
| Error flash | `outline` on/off | static 1.2 s via class timer | Not an animation, so it also works under reduced motion. |
| Review pane counts | none | none | `aria-live="polite"` text only. |

Reduced motion: every animation above is wrapped in `@media (prefers-reduced-motion: reduce) { animation: none; transition: none; }` locally (like `SegmentedControl.module.css` l.72) in addition to the global rule in `styles/base.css` l.92; `Collapse` falls back to an instant `display` toggle; programmatic scrolls use `behavior:'auto'`. Do not animate `height` in px, do not animate on first mount of the page.

### 5.4 State and URL

- `view` = presence of `step`: `/experiments/new` = home; `/experiments/new?step=models` = customize. Allowed values: `where|start|models|settings|evaluation|review`; unknown -> `where`.
- Existing params (`env`, `clone`, `job`, `base`, `preset`) are untouched. **Risk:** `LaunchPage` keys `LaunchProvider` on `location.search`, so adding `step` would remount and wipe the form. Change the key to the string of the entry params only (`env` repeated, `clone`, `job`, `base`, `preset`), and keep `step` out of it.
- `Customize ->` and step clicks use `navigate({search}, {replace:false})` so the browser Back button walks back through steps and finally home; `<- Start` = `navigate` without `step` (push). The unsaved-changes blocker already ignores same-path-and-search changes only; make it compare `pathname` + search without `step` so moving between steps never triggers "Leave without launching?".
- The document is never reset by view changes. Inactive steps unmount (to keep the page light) because all form state lives in `LaunchProvider`, not in the DOM. `registerField` entries disappear for hidden steps; `focusField` already retries (30 ms x 12) while the target section renders, so error focus across steps works after the step switch.
- Deep link / reload: a reload re-creates the form (as today, no draft persistence, same as legacy `No form draft is persisted`). A `?step=` link opened without an environment shows step 1.

### 5.5 Primitives

New in `frontend/src/ui/` (add to the barrel, `docs/DESIGN_LANGUAGE.md` "Tabs and switchers" paragraph as "Steppers" and to the `/__ui` gallery, with a test in `ui/__tests__`):

```ts
// ui/Stepper/Stepper.tsx
export interface StepperStep { id: string; label: string; changes?: number; problems?: number; }
export interface StepperProps {
  steps: readonly StepperStep[];
  current: string;                     // id of the active step
  onSelect: (id: string) => void;      // rail buttons are always enabled
  'aria-label': string;                // e.g. "Steps"
  compactBelow?: number;               // px; below it renders "Step n of N: label" + progress bar + dropdown (default 760)
}
// <ol> of <button aria-current="step">, 4px bar (--border-default, accent when done/current), count Tags,
// scaleX fill animation (5.3), logical properties only. data-state="done|current|upcoming".

// ui/Collapse/Collapse.tsx
export interface CollapseProps { open: boolean; id?: string; children: ReactNode; }  // grid-rows 0fr/1fr, inert when closed
```
Feature-local (not primitives): `wizard/StepPanel` (`{ stepId, title, description, children }`, keyed wrapper with the enter animation and the focus target heading), `wizard/StepNav`, `entry/HomeBar`, `entry/StartCard` (the big/compact card used by `StartFrom`).
Existing primitives reused: `Button`, `Tag`, `Badge`, `TextField`, `Select`, `Textarea`, `Checkbox`, `PageHeader`, `LinkButton`, `Callout` (feature), `Skeleton`, `KeyValueGrid`.
`LaunchSection` gets `variant?: 'collapsible' | 'static'` (default `collapsible` so the editor page is unchanged until phase 2); `static` renders the title/description/badges as a non-interactive heading and always renders the body.

### 5.6 File layout (new / changed)

```
launch/LaunchPage.tsx            changed: choose LaunchHome | LaunchWizard from ?step, provider key ignores step, blocker ignores step
launch/state/useStep.ts          new: step param <-> state, goToStep(id), next/prev, stepOfSection()
launch/home/LaunchHome.tsx       new: composes pickers, StartFrom, BaseStatus, HomeBar
launch/entry/HomeBar.tsx         new
launch/entry/StartFrom.tsx       changed: big + compact cards, StartCard
launch/entry/entry.module.css    changed: .startGrid, .startGridCompact, .where (two-card row)
launch/entry/EntryBlock.tsx      changed: split so RunSettings only renders in step 1
launch/wizard/LaunchWizard.tsx   new; wizard/StepPanel.tsx; wizard/StepNav.tsx; wizard/wizard.module.css; wizard/steps.ts (id, label, sections)
launch/components/LaunchSection.tsx  changed: variant prop; uses Collapse in collapsible variant
launch/components/Outline.tsx    kept for the editor page until phase 2, unused by the wizard
launch/state/useSections.ts      changed: focusIssue switches step; revealElement smooth unless reduced motion
launch/review/ReviewPane.tsx     changed: "Edit" links call goToStep; hideActions unchanged
launch/review/MobileLaunchBar.tsx changed: hidden on step 6 and on home; exports its height as a CSS variable
ui/Stepper, ui/Collapse          new
styles/tokens.css                add --motion-step, --ease-standard
```

## 6. Work plan

| # | Task | Est. | Files | Tests | Independent? |
|---|---|---|---|---|---|
| T1 | `Collapse` primitive + reduced motion + gallery entry | 3 h | `ui/Collapse/*`, `ui/index.ts`, `styles/tokens.css`, `docs/DESIGN_LANGUAGE.md`, `/__ui` gallery | Vitest: open/close toggles `inert`, no animation class under reduced motion | yes |
| T2 | `Stepper` primitive (rail, compact mobile form, fill animation, counts) | 5 h | `ui/Stepper/*`, `ui/index.ts`, docs, gallery | Vitest: `aria-current`, done/current/upcoming states, click selects, counts, compact mode; design-language test | yes |
| T3 | `StartFrom` rebuild (big + compact cards, copy, selected/disabled states) | 4 h | `entry/StartFrom.tsx`, `entry/StartCard.tsx`, `entry.module.css` | Update `LaunchPage.test.tsx`, `BestRunPicker.test.tsx` if selectors move; e2e `entry.spec.ts` | yes |
| T4 | `HomeBar` + `LaunchHome` (two-card row, status text, Launch as is / Customize, remove "Launch as is" from `BaseStatus`) | 6 h | `home/LaunchHome.tsx`, `entry/HomeBar.tsx`, `BaseStatus.tsx`, `EntryBlock.tsx` | Vitest: status strings for the 6 states, Launch disabled rules; e2e: tick env + name + Launch as is (3 actions) | after T3 (shares `StartFrom`) |
| T5 | `useStep`, URL param, provider key, blocker change | 3 h | `LaunchPage.tsx`, `state/useStep.ts` | Vitest: unknown step -> `where`, step change does not remount (form value survives), blocker ignores step; e2e: browser Back walks steps | yes (pure logic) |
| T6 | `LaunchWizard` shell: header, `StepPanel`, `StepNav`, step config, aside/wide review on step 6, `LaunchSection variant="static"`, step bodies, rail counts/problems | 10 h | `wizard/*`, `LaunchSection.tsx`, `ReviewPane.tsx` | Vitest per step content and nav labels ("Continue to models", "Skip to review" visibility); e2e `wizard.spec.ts` (new): home -> Customize -> through 6 steps -> Launch; counts badge after an edit | after T1, T2, T5 |
| T7 | Error routing: `focusIssue` switches step, flash, `Show` on home goes to Customize, "Edit" links use steps, smooth/reduced-motion scroll | 4 h | `useSections.ts`, `HomeBar.tsx`, `ReviewPane.tsx`, `goToSection.ts` | Vitest: `stepOfSection`; e2e: server 422 error focuses a field on step 4 after starting on step 6 (`launch.spec.ts` adjust) | after T6 |
| T8 | Motion polish + mobile (compact rail, sticky `StepNav` above `MobileLaunchBar`, bar hidden on home/review) + narrow a11y | 4 h | `wizard.module.css`, `MobileLaunchBar.tsx` | e2e `layout.spec.ts` update (390/768/1280/1920, no horizontal overflow), `ux-axe-launch-narrow.spec.ts` (contrast of problem link), emulate `reducedMotion: 'reduce'` and assert no `animationName` on the panel | after T6 |
| T9 | Adjust existing specs to the two-view structure (priority and versioning now on step 1, sections reached through steps) | 5 h | `e2e/experiments/launch/*.spec.ts`, `launchSupport.ts`, `LaunchPage.test.tsx`, `LaunchSections.test.tsx` | existing suite green | after T6 |
| T10 (phase 2) | Editor mode on the wizard (steps Dataset, Compared with, Models, Environment configurations, Evaluation configurations, Review and publish) | 6 h | `environments/DefaultPresetEditorPage.tsx`, `wizard/steps.ts` | `preset-editor.spec.ts` | after T6, optional |
| T11 | Docs: `DESIGN_LANGUAGE.md` (steppers, motion tokens), `frontend/README`, `ANALYSIS.md` note, decision log entry | 1.5 h | docs | `pytest tests/platform/test_design_language.py` | yes |

Total: about 51.5 h (45.5 h without T10 optional phase 2: 51.5 - 6). Parallel groups: {T1, T2, T3, T5, T11} then {T4, T6} then {T7, T8, T9}, T10 last.
Verification after UI changes (from AGENTS.md): `cd frontend && npm run check`, `pytest tests/platform/test_design_language.py`, `npm run e2e -- experiments/launch`.

Risks:
- Provider remount on search change (T5) is the main trap; a regression silently wipes the user's edits when pressing Customize.
- Unmounting inactive steps drops `registerField` entries; keep the retry loop in `focusField` and test error-focus across steps.
- Section bodies hold local UI state (settings search, open groups) in `useSections`; it lives above the steps so it survives step changes, but any state created inside a section component is lost on step change. Audit `SettingsSection`, `SweepsSection`, `RawJsonSection` (CodeMirror editor remount) before unmounting; fallback is keeping visited steps mounted with `hidden`.
- `Collapse` with `inert` needs a polyfill check for the supported browsers; fall back to `aria-hidden` + `visibility`.
- Design-language rules: pages must not add selection animations (animation lives in `Stepper`), only tokenised sizes/colours; the new rail copy must pass the type scale test.
- Editor page still uses the stacked layout until T10; keep `LaunchSection` default collapsible and `Outline` exported.

## 7. Open questions (recommended default is what implementation will use)

| # | Question | Default |
|---|---|---|
| Q1 | Pre-tick the environment when the project has exactly one active environment (legacy did not; it would make the home 2 actions: name + Launch as is)? | Yes, pre-tick when exactly one active environment and no `?env=` |
| Q2 | Is the "smooth transition" the owner means the step-at-a-time wizard (legacy, no animation) or an animated section reveal? | Both: wizard structure with the 180 ms panel enter and animated disclosures (5.3) |
| Q3 | Should "Launch as is" also be available without a name (auto-name like "<preset> · <env> · <date>")? Legacy required a name. | No: keep the name required, but prefill the input placeholder with the suggested name only (no auto-submit) |
| Q4 | Does the editor (default preset) get the wizard in this iteration? | No, phase 2 (T10) |
| Q5 | Keep priority and versioning details only in step 1 (off home), or show a collapsed "Options" row on home? | Only in step 1, as legacy |
| Q6 | Should the rail gate the "Review and launch" step until required fields are valid? Legacy never gated. | No gating; show problem counts on the rail |
| Q7 | Mobile rail: dropdown navigation vs plain dots? | Compact "Step n of N" header with a dropdown for jumping |
| Q8 | Should "Copy an experiment" keep remounting the form via `?clone=`? | Yes, unchanged (guard asks first) |

## Summary for the orchestrator

1. Legacy had two screens: a 3-input home (tick env, type name, "Launch as is" / "Customize ->" in a sticky bar, default preset pre-selected as "Recommended") and a six-step wizard with a segmented progress rail, Back / Continue to <step> / Skip to review, and the review panel always visible. React merged them into one long page (entry block + 5 collapsible sections + 22rem review aside).
2. Biggest gaps: no home view; priority, versioning textarea and 3 red problem cards shown before the user has done anything; no step rail or Next action; instant section toggles (conditional render); no per-step counts/errors on a nav.
3. Accuracy note: the legacy wizard had no CSS animation; "smooth" came from step-at-a-time structure. Motion is new: 180 ms enter (opacity + 8 px rise), `scaleX` rail fill, grid-rows disclosure, smooth scroll, all off under `prefers-reduced-motion`.
4. React does not use react-hook-form in the launch form (custom `LaunchDocument` + `useLaunch()`); the model layer and all section bodies are reused unchanged, so every field and validation is kept.
5. Main trap: `LaunchPage` keys the provider on `location.search`; `?step=` must be excluded or Customize wipes the form.
6. New primitives: `Stepper`, `Collapse`; feature-local `HomeBar`, `StartCard`, `StepPanel`, `StepNav`, `useStep`.
7. Estimate: about 51.5 h total (45.5 h without the optional editor-wizard phase 2).
8. Parallel groups: {Collapse, Stepper, StartFrom, useStep/URL, docs} -> {HomeBar/LaunchHome, LaunchWizard} -> {error routing, mobile/motion polish, spec updates}.
9. Defaults for open questions: pre-tick a sole environment (Q1 yes); wizard plus animated reveal (Q2); name stays required (Q3); editor wizard in phase 2 (Q4); priority/versioning only in step 1 (Q5); no step gating (Q6); compact mobile header with dropdown (Q7); Copy-an-experiment unchanged (Q8).
10. Test impact: update launch e2e specs and unit tests for the two-view structure (about 5 h), add `wizard.spec.ts` and Stepper/Collapse unit tests.

## Deferred

- T10 (phase 2): the default-preset editor on the wizard (steps Dataset, Compared with, Models, Environment configurations, Evaluation
  configurations, Review and publish). Out of scope for this pass by the orchestrator (Q4 default); the editor keeps the stacked page,
  `Outline` and the collapsible `LaunchSection`. Estimate about 6 h (`DefaultPresetEditorPage.tsx`, `wizard/steps.ts`, `preset-editor.spec.ts`).

## Decisions: versions on home

- **What "versions" is in this flow.** The launch flow has no per-model or per-slot version picker. The only Evaluation Service
  version interaction was the read-only "Current versions" block on the Models step (`useEnvVersioning`: a live call that reads
  `agent_version`, `image_version`, `kb_version` and any other `versioning_details` key from each selected environment, with Refresh). A
  run records what the service reports; a custom value is the free-form "Versioning details" textarea on Customize step 1 (stored on
  the experiment and its runs). The data model (`LaunchDocument`, `useLaunch`, the launch request) is unchanged.
- **Moved to the home view.** The block is now a `Card` (tone `meta`, "Evaluation Service versions") between the environment/dataset
  row and "Start from": one row per ticked environment, values as version Tags, a Refresh button, an "Add versioning details" link
  to Customize step 1 (the override). It appears once an environment is ticked and reads once (never on re-render), so the
  three-action launch path (tick, name, Launch as is) is unchanged: there is nothing to decide and no new required field. With several
  environments each gets its own row; an unsupported or unreachable service shows its reason and never blocks the launch.
- **Wizard.** The Models step no longer has the block (nothing else lived in it besides the model cards, so there is no read-only
  copy there). The review (step 6 and its aside) gets a read-only "Versions" row built from the same cached read, and the "← Start"
  link in the header is the way back to change or refresh them. A deep link straight to a wizard step still reads them for the review.
- **No picker.** An Evaluation Service reports the versions it runs; choosing among several would need a platform contract that does
  not exist (the launch request has no version field). Should one appear later, the card is the place for it.

## Decisions: global sweep, tables, raw JSON (round 2 notes)

- **Global sweep.** The "All roles" / "All endpoints" row has "Sweep values": chips of values written as the same `{ sweep: [...] }` to
  every target and linked (zipped) in `doc.links`, so one launch makes one run per value, not one per combination of the targets
  (`model/globalSweep.ts`, covered by Vitest). The row shows "sweeps N runs"; the review and the launch bar already count runs from
  the spec. In table cells a sweep is a read-only summary; fine editing stays in the Sweeps section.
- **Tables.** Endpoints render as a table with a global row (`collectionTableModel`); any list of scalars or of objects with a common key
  set renders as a table with an "All items" row (`listTableModel`, in `JsonFields`). The e2e schema fixture has no array leaf, so lists
  are covered by Vitest. Other shapes keep the stacked layout.
- **Raw JSON** is behind a "Show raw JSON" / "Hide raw JSON" button (Collapse) on the review step; the Raw JSON action opens it. The
  default-preset editor keeps its collapsible section heading (closed by default).
