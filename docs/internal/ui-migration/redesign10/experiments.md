# Round 10 design spec: Customize bar slots, swept settings in the review, environment versions, the bar follows the content

Branch `ui/redesign10-experiments` (from UI-redesign 0c7b4ed4). Stage 1 of 3 (design). Owner feedback of 2026-11-03, four points;
orchestrator decisions K1 to K5 are final. The round 9 spec (`redesign9/experiments.md`) and its fix pass still hold unless section 6 below
amends a criterion. Criterion ids here are `C-<point>-<n>` of **this** round; e2e test titles carry the prefix `R10` (`R10 C-1-3`) so they
do not collide with round 9's ids.

## The owner's words (verbatim)

> great, just a few points on the experiments design:
> 1- continue and back should be in the far right, remove the launch shortcut and end an option to skip to review in the far left.
> 2- enhance the view of the swept parameters in the review section of customization, it's very hard to read right now.
> 3- the environment always show image version even though it's deprecated, make sure to design a scalable solution that would read any versioning details and present them as is to the user.
> 4- there's a weird empty spacing in the experimentation creation home page between the boxes and footbar, this shouldn't happen.

"end an option" in point 1 reads "add an option" (Skip to review moves to the far left).

## Evidence

Measurements: `measure/*.cjs` (Playwright, Chromium, dark theme) against the Vite dev server :5998 proxying the platform :8998 on SQLite;
two fake Evaluation Services :9098 (staging) and :9099 (production) with `--datasets --tasks`. The dev server is used because only layout,
computed style and DOM are measured. Seed `measure/seed_r10.py`: the round 9 seed (project `exp-demo`, environments staging and production,
datasets, default preset v1 and a saved preset on staging, four experiments) plus a second LLM connection and the experiment
**model x threshold x timeout** on both environments: a linked axis (`/slot_bindings/endpoint:primary` = gpt-4o prod, claude-sonnet eval
zipped with `/env_overrides/MILVUS_SEARCH_THRESHOLD` = 0.5, 0.7) and a plain axis (`/env_overrides/LLM_OVERRIDES/endpoints/primary/timeout`
= 10, 30, 60): 2 x 3 x 2 = 12 runs. Production has no default preset and no saved preset (the K4 short-content home).

| Script | What it measures | Modes |
|---|---|---|
| `m_bar.cjs` | parts of `launch-bar` per step (order, x, width, label, disabled), launch and editor | `current`, `mock` |
| `m_review.cjs` | Review: run table columns and widths, cells, cards at 390, swept row, Changes, first screen; the runs sheet's frames at 1193 and 777 px | `current`, `mock` |
| `m_versions.cjs` | environment box Versions line and box height for 3, 2, 5 and 0 keys and the loading frame (the fake is driven through `/__control/versioning`) | `current`, `mock` |
| `m_gap.cjs` | the band between the last content element and the bar, at 1440x900, 1440x1400 and 390x844, also at the scroll end | `current`, `mock` |
| `shots_mock.cjs` | the mock shots | |

Shots (`shots/`): `current-*.png` (today), `mock-page-*.png` (composed mocks, whole page at 1440 and 390; the K4 pages also as the
viewport the user sees, `-1440x900`, `-1440x1400`, `-390x844`), `sheet-*.png` (appendix). Mocks: gallery `/__ui#round10`
(`frontend/src/features/dev/Round10Mocks.tsx`, `.module.css`) and one page each at `/__mock/round10/<variant>` (`round10Register.ts`):
`customize-where`, `customize-start`, `review`, `env-versions`, `env-versions-none`, `home-short`, `sheet-bar`, `sheet-versions`, `sheet-runs`.
All composed mocks are drawn in the real shell (1440: sidebar 192, column 1193; 390: rail 56, column 279). Numbers marked "mock" below are
measured on those mocks with the scripts above.

## 1. Measurements of today's pages

### 1.1 The bar (point 1, `m_bar.cjs current`, round 9 shot `after-page-review-1440.png`)

Every Customize step, launch mode, staging ticked (1 run, a "Name" problem):

| Width | Parts in DOM order, x + width (px) | Buttons |
|---|---|---|
| 1440 | `bar-back`@227+54, `bar-skip`@289+105, `bar-continue`@402+75, `bar-status`@491+693, `bar-cancel`@1198+64, `bar-launch`@1270+120 | 6 (5 + the status link) |
| 1024 | same order; status 277 wide; cancel@782, launch@854 | 6 |
| 390 | back@85, skip@147 ("Skip"), continue@206, status 261 wide on its own row, cancel@154, launch@226 (three rows, 90.8 px) | 6 |
| editor 1440 / 390 | same six parts, `bar-launch` "Publish v2"; **110.2 px at 390** (the status "0 changes vs v1 No changes from Default preset v1 yet." wraps) | 5 |

Finding: the far right holds Cancel and **Launch on every step** (disabled on steps 1 to 5 when there is a problem, enabled otherwise:
a shortcut that launches from step 1); Back and Continue sit at the far left, Skip between them. The owner wants the order the other way
round: navigation at the far right, the launch only where the review is.

### 1.2 Swept settings in the review (point 2, `m_review.cjs current`, shots `current-review-two-axis-{1440,1024,390}.png`, `-runs-*`)

Clone of the two-axis experiment, Review step, 12 runs:

| Width | Columns (header: px) | Swept cell | Row |
|---|---|---|---|
| 1440 | `#`:102, Environment:689, **Swept setting:160**, Priority:240 | one `Tag kind="data"` holding the whole label `primary=gpt-4o thr=0.5 timeout=10`, **10 px** mono (`--font-xs`), **214 px wide in a 160 px column** (it overflows the cell by 54 px into the Priority column's padding) | 32 px, 12 rows |
| 1024 | `#`:102, Environment:273, Swept setting:160, Priority:240 | same 214 px tag in 160 px | 32 |
| 390 | cards, 127.6 px high: Run / Environment / Swept setting / Priority | the same label in one 10 px tag | |

What the reader has to decode: abbreviated keys invented by the platform (`thr` for Milvus Search Threshold, `primary` for the Primary model
slot), the model's id (`gpt-4o`) instead of the connection the user picked (`gpt-4o prod`), three settings in one 10 px string, no column to
scan down. The Changes card says "Sweeps: 2 swept settings" without naming them; the Summary does not mention the sweep at all. The `#`
column is 102 px for a one- or two-digit number because DataTable sizes a header's minimum from the column `label` ("Run number", 10 chars x
8.6 + 16) instead of the drawn header `#`.

Data available without parsing the label (dry-run response, captured): `axes` =
`[{pointers: ["/slot_bindings/endpoint:primary", "/env_overrides/MILVUS_SEARCH_THRESHOLD"], linked: true, length: 2, values: [[{connection_id, name: "gpt-4o prod", model: "gpt-4o"}, 0.5], [{…, name: "claude-sonnet eval", model: "claude-sonnet"}, 0.7]]}, {pointers: ["/env_overrides/LLM_OVERRIDES/endpoints/primary/timeout"], linked: false, length: 3, values: [[10], [30], [60]]}]`,
and each job carries `params.sweep = {<pointer>: <value>}` for its combination. The settings step already names the pointers with
`locate(pointer, ctx).label`: "Primary model", "Milvus Search Threshold", "Endpoints › primary › Timeout". **No backend change is needed (K5).**

### 1.3 Versions (point 3, `m_versions.cjs current`, shots `current-env-versions-{three,two,five,none}-{1440,390}.png`)

`EnvVersions` draws `agent_version`, `image_version`, `kb_version` first under invented labels "agent", "image", "kb", then any other key
sorted alphabetically under its raw name; a missing one of the three reads "not set". `SummaryLine` (the review's Versions row) prints
**only** those three keys, joined by " · ". The loading frame shows the three fixed labels.

| Service reports | 1440: line / box (px) | 390: line / box | What is drawn |
|---|---|---|---|
| the fake's default (3 keys) | 25 / 87.8 | 49 / 111.8 | agent, image, kb |
| `{agent_version, kb_version}` | 25 / 87.8 | 49 / 111.8 | **"image not set"** although the service no longer reports it (the owner's point) |
| 5 keys incl. an object | 73 / 135.8 (+48 after load) | 166 / 228.8 (+117 after load) | "image not set", then `build`, `model_routing` (a 70-char JSON tag), `prompt_set` in alphabetical order, not the service's |
| `{}` | 25 / 87.8 | 49 / 111.8 | "agent not set", "image not set", "kb not set" |
| loading | 25 / 87.8 | 49 / 111.8 | the three fixed labels |

The review row shows `production: agent-1.4.2 · img-20261001 · kb-77`; any other key is dropped there. Other hard-coded key maps:
`launch/model/bestRun.ts` `VERSION_LABELS = {agent_version: 'agent', kb_version: 'kb'}` (best-run header "agent v1.12 / kb 381", the
best-run table's Versions column, drift lines "agent: v1 in this run, v2 now", objects dropped). Humanizers that rename any key:
`bestrun/lib.ts keyWords` ("kb_version" -> "KB version", best-run scope Selects) and `lib/format.ts versioningWords/versioningLabel` (Experiments
list filters). Already as reported (no change): run detail header chips (`heroModel.headerChips`), compare `runInfo`, `RunExperimentPanel`,
`RunPanels` (they show a stored run's keys as is).

### 1.4 The band between the content and the bar (point 4, `m_gap.cjs current`, shots `current-create-home-short-*`, `current-create-home-empty-*`, `current-step-start-*`)

Today the bar has `margin-block: auto -32px` and the page (`LaunchPage.module.css .page`) has `min-block-size: 100%`, `.layout`, `.main` and
the home's `.home` grow with `flex: 1 1 auto` (round 9 fix pass 1). So whenever the content is shorter than the viewport the auto margin
fills the difference: the measured band (`margin-block-start` of the bar) is

| View | 1440x900 | 1440x1400 | 390x844 |
|---|---|---|---|
| home, nothing ticked | 0 (overflows by 2 px) | **497.5** | 0 (overflows) |
| home, production only (1 environment, no saved preset; the owner's case) | 0 (overflows) | **374.3** | 0 |
| home, staging (saved presets) | 0 | **284.0** | 0 |
| step where | **53.7** | **553.7** | 0 |
| step start (shortest) | **216.1** | **716.1** | 0 |
| step settings | **235.3** | **735.3** | 0 |
| step models / evaluation / review | 0 / 0 / 0 | 394.7 / 360.3 / 441.8 | 0 |

The bar itself is always at the viewport bottom (bar bottom = 900 / 1400 / 844). On a desktop taller than the content the user sees a
374 to 735 px empty band between the last card and the bar (shot `current-create-home-short-1440x1400.png`).

## 2. Point 1: Back and Continue at the far right, Skip at the far left, no Launch shortcut (K1)

Design (mock `customize-where`, `customize-start`, `review`; sheet `sheet-bar`). One component, `StepsBar`, for launch and editor mode:

```
[ Skip to review ] [ Cancel ]          12 runs to launch  Ready          [ Back ] [ Continue      ]   steps 1..N-1
[ Skip to review ] [ Cancel ]          12 runs to launch  Ready          [ Back ] [ Launch 12 runs ]  review (Skip disabled in place)
[ Skip to review ] [ Cancel ]          3 changes vs v1  Ready            [ Back ] [ Publish v2     ]  editor, review and publish
```

* Far left: `bar-skip` (neutral, "Skip to review", "Skip" at <= 480 px; disabled in place on the last step), `bar-cancel` (ghost).
* Centre: `bar-status` (flex 1, its content centred at >= 481 px): the run count (or "N changes vs vX") and the first problem link or Ready.
* Far right: `bar-back` (neutral), then the **primary slot** `bar-continue`: "Continue" (neutral) on every step but the last; on the last
  step the launch ("Launch N runs", "Launch" for one run, round 9 fix pass) or the editor's "Publish vN", variant primary, disabled while the
  launch is blocked (problems, the High acknowledgement, `publishBlocker`). `data-action` = `continue` | `launch` | `publish`. Its
  `min-inline-size` is 7.5rem (120 px), so Back never moves when the label changes.
* There is no `bar-launch` in the steps bar. The home view's bar is unchanged (`bar-name`, `bar-status`, `bar-customize`, `bar-launch`
  "Launch as is").
* 390: three rows (status; Skip + Cancel at the start; Back + primary at the end), 90.8 px, as today's three-row layout. The editor's status
  keeps one line there (the explanation after "N changes vs vX" is `.long`, hidden at <= 480 px), so the editor bar is 90.8 too (today 110.2).

Mock numbers (`m_bar.cjs mock`): 1440: skip@228+105, cancel@341+64, status@419+774, back@1207+54, continue@1269+120 on where, start and
review (0 px difference); label "Continue" and "Launch 12 runs" in the same 120 px. 390: 90.8 px on all three, skip@86, cancel@145 (row 2),
back@163, continue@225+120 (row 3).

| Id | Element (`data-part`) | Width | Criterion |
|---|---|---|---|
| C-1-1 | `launch-bar` (steps) | 1440 / 1024 / 390 | on each of the six launch steps and the five editor steps: exactly five parts in this DOM order: `bar-skip`, `bar-cancel`, `bar-status`, `bar-back`, `bar-continue`; `bar-launch` count 0 (today 1); the button count in the bar is 4 plus the status link when a problem or the acknowledgement is shown (today 5 + link) |
| C-1-2 | the five parts | 1440 / 1024 | `bar-skip.x - bar.x` = 15 +- 1 (1 px border + 14 px padding) and `bar.right - bar-continue.right` = 15 +- 1; `bar-cancel.x` = `bar-skip.right + 8`; `bar-back.right` = `bar-continue.x - 8`; each part's x differs by <= 1 px across all steps of one mode (mock 1440: 228 / 341 / 1207 / 1269 on where, start, review) |
| C-1-3 | `bar-continue` | all | steps 1 to N-1: `data-action="continue"`, text "Continue", `data-variant="neutral"`, enabled whatever the problems (moving on is never blocked), `aria-label` "Continue to <next step>"; last step: `data-action="launch"` text `Launch N runs` (`Launch` for 1 run) or `data-action="publish"` text `Publish vN`, `data-variant="primary"`, disabled with the same rules as today's `bar-launch` / Publish; computed `min-inline-size` 120 px; `bar-back.x` identical (<= 1 px) between "Continue" and "Launch 12 runs" |
| C-1-4 | `bar-skip` | all | enabled on steps 1 to N-1; on the last step `disabled`, `aria-disabled="true"`, out of the Tab order, at the same x (drawn, not removed); text "Skip to review" at >= 481 px and "Skip" at <= 480 px; `aria-label` "Skip to review and launch" (editor: "Skip to review and publish") |
| C-1-5 | `bar-cancel`, `bar-back` | all | Cancel ghost, enabled on every step, the same action as today (launch: back to the experiments list; editor: the environment page, with the leave guard); Back neutral, enabled on every step, step 1 leads to the start view (launch) or the environment page (editor), unchanged |
| C-1-6 | no launch shortcut | 1440 / 390 | on steps where, start, models, settings, evaluation: 0 buttons whose accessible name starts with "Launch" or "Publish" anywhere in the page (today 1 per step); a launch is possible only from the last step (primary slot) or the home view ("Launch as is") |
| C-1-7 | keyboard | 1440 | Tab order inside the bar = visual order: Skip, Cancel, the status link (if any), Back, primary; Enter on Continue goes to the next step and focuses its `h2` (unchanged); on the review Tab from Cancel lands on the status link or Back (Skip is out of the order) |
| C-1-8 | `bar-status` | 1440 / 1024 | sits between the two groups (`bar-cancel.right + 14 <= bar-status.x` and `bar-status.right + 14 <= bar-back.x`); its content is centred (`justify-content: center`) at >= 481 px, start-aligned at <= 480 px; the problem link focuses the field and switches step (round 9 C-4-3, unchanged) |
| C-1-9 | `launch-bar` at 390 | 390 | three rows: status (row 1), Skip and Cancel at the start of row 2, Back and the primary at the end of row 3; height 90.8 +- 1 on every step in launch **and editor** mode (today editor 110.2); `scrollWidth <= clientWidth`; the status is one line in every state |
| C-1-10 | home view bar | 1440 / 390 | unchanged: parts `bar-name`, `bar-status`, `bar-customize`, `bar-launch` ("Launch as is"), 56 / 90.8 px, same chrome as the steps bar |
| C-1-11 | chrome | 1440 / 1024 | height 56 +- 1 on every step; background `--bg-elevated`, 1 px `--border-default`, radius `--radius-md`, `--shadow-popover`, buttons 24 px 11/600 (round 9 C-3-1 chrome and C-3-6, unchanged) |

## 3. Point 2: swept settings one column each (K2)

Design (mock `review`, sheet `sheet-runs`).

1. **Runs table**: `#` | Environment (when it varies) | Dataset (when it varies) | **one column per swept setting** | Task (when it varies) |
   Priority. The swept columns come from `preview.data.axes` in axis order, one per pointer (a linked axis gives one column per member, in its
   pointer order); a linked axis's columns share the DataTable header band "Linked: vary together" (`group`). Header = the setting's name:
   the last segment of `locate(pointer, ctx).label` ("Endpoints › primary › Timeout" -> "Timeout"); when two drawn swept columns have the same
   name, each header gets a second line with the rest of the label ("Endpoints › primary", "Endpoints › judge"), `--font-sm` 400
   `--text-muted`. The name is data: drawn as written (`text-transform: none`, `letter-spacing: 0`), wrapping at words, never truncated.
2. **Cells**: the value of `job.params.sweep[pointer]` (never parsed from `job.label`): a model binding shows the connection's `name`
   ("gpt-4o prod"; else its `model`, else its id), a temporary model "temporary: <model>", `null` "inherit", numbers / booleans / ids mono, text
   sans, all `--font-base` 12 px `--text-primary`; no Tag (today a 10 px tag).
3. **Widths**: `#` 48 px; Environment `minWidth` 120, flex; each swept column `minWidth` 120, flex; Dataset and Task as today; Priority 240.
   The table keeps `responsive="scroll"`: when the minimums exceed the card, it scrolls sideways (no column shrinks under 120, none truncates).
4. **Summary card**: a row **Swept settings** (`review-swept`) after Dataset / Run shape and before Priority, one line per axis (`swept-axis`):
   `<name>: v1, v2, v3` (the same name and value formatting as the columns, the name 600). A linked axis is one line: the names joined by
   " + ", then the pairs "gpt-4o prod + 0.5, claude-sonnet eval + 0.7", then a `linked` tag. Absent when nothing is swept.
5. **Changes card**: "Sweeps: Primary model + Milvus Search Threshold (linked), Timeout" (the axes by name, not a count).
6. **Phone** (`runs-cards`, <= 760 px): one `dt`/`dd` per swept column, labelled with the column's name (and its section when the header
   has one), in column order, between Environment and Priority.

Mock numbers (`m_review.cjs mock`): 1440 card 1191: `#`:48 | Environment | Primary model | Milvus Search Threshold | Timeout (flex, share the
rest) | Priority:240, band "Linked: vary together" over the two linked columns, 12 rows of 32 px, cells 12 px, 0 overflow. Sheet frames:
1193-px column with 6 swept columns + Environment: 6 x 129 px, no scroll; with 7: scrolls (1248 / 1191). 777-px column (1024): the round's
3 swept columns + Environment: 4 x 121.8, no scroll; with 4: scrolls (888 / 775). Summary rows at 1440: Swept settings 70.6 px, Versions 106.8
(section 4). 390: 12 cards of 160 px. First screen at 1440x1000: Summary ends 698.8, run 2 ends 893.5, run 4 ends 957.5, bar top 944.

| Id | Element (`data-part`) | Width | Criterion |
|---|---|---|---|
| C-2-1 | `runs-table` header | 1440 / 1024 | columns in this order: `#`, the varying ones of Environment / Dataset, one per swept pointer in `axes` order, Task if it varies, Priority; for the seed exactly `# | Environment | Primary model | Milvus Search Threshold | Timeout | Priority`; 0 headers named "Swept setting" |
| C-2-2 | `axis-header` | 1440 | text = last segment of `locate(pointer).label`; computed `text-transform: none`; when two drawn swept columns share a name both carry `axis-section` with the label's prefix (11 px, 400, `--text-muted`); `scrollWidth <= clientWidth` for every header; rendered text equals the source string |
| C-2-3 | linked band | 1440 | the members of a linked axis sit side by side under one band cell "Linked: vary together" whose width = the sum of their columns +- 1 px; plain axes have no band text |
| C-2-4 | `axis-cell` | 1440 / 1024 / 390 | value from `jobs[i].params.sweep[pointer]`; the seed's run 1 reads `gpt-4o prod`, `0.5`, `10`; model -> connection name, temporary -> `temporary: <model>`, null -> `inherit`; font 12 px (0 cells at 10 px, today 10), numbers mono; 0 `Tag` inside an axis cell; `scrollWidth <= clientWidth` for every cell (today the tag is 214 px in a 160 px cell) |
| C-2-5 | column widths | 1440 / 1024 | `#` 48 +- 1 (today 102); Priority 240; each swept column and Environment >= 120; at 1440 the seed's four flex columns share the rest equally; at 1024 (card 775) the seed draws without horizontal scroll (`scrollWidth = clientWidth`) |
| C-2-6 | scroll threshold | 1440 / 1024 | with the Environment column: up to 6 swept columns at 1440 (card 1191) and 3 at 1024 (card 775) fit without horizontal scroll; 7 and 4 scroll sideways (measured 1248 / 1191 and 888 / 775); without the Environment column one more fits (7 / 4); in every case no column is narrower than 120 px and no text is truncated |
| C-2-7 | constant columns | all | a column whose cells all hold the same text is not drawn (round 9 rule): with one environment there is no Environment column; the table is never narrower than `#`, one swept column, Priority |
| C-2-8 | `review-swept` | 1440 / 390 | in the Summary card between Dataset (or Run shape) and Priority; one `swept-axis` line per axis (2 for the seed); line text for the seed: `Primary model + Milvus Search Threshold: gpt-4o prod + 0.5, claude-sonnet eval + 0.7` + tag `linked`, and `Timeout: 10, 30, 60`; row height at 1440 70.6 +- 4; absent when nothing is swept |
| C-2-9 | `review-changes` | all | the sweeps row reads `Sweeps: Primary model + Milvus Search Threshold (linked), Timeout` (today "Sweeps: 2 swept settings") with its Edit button |
| C-2-10 | `runs-cards` | 390 | 12 cards; each has one `dt`/`dd` per swept column with the header's name (`axis-header`) and value (`axis-cell`), in column order; label column 96 px; card height 160 +- 6 for the seed (6 facts; today 127.6 with the one-tag row) |
| C-2-11 | `runs-table` rows | 1440 | one `tr` per run (12), height 32 +- 1, priority select per row (round 9 C-6, unchanged), 0 disclosures |
| C-2-12 | first screen | 1440 x 1000 | with no High run: the Summary, the runs header and the first 2 run rows are above the bar (mock: run 2 ends 893.5, bar top 944) |

## 4. Point 3: versions as the service reports them (K3)

Design (mocks `env-versions`, `env-versions-none`, `customize-where`, `review`; sheet `sheet-versions` drawn at the real box widths 547 /
339 / 237 px). One renderer, `VersionsGrid({ details, loading })`, used by the environment box (home and step 1) and by the review's
Versions row:

* The "Versions" label (11 px, 600, `--text-secondary`) on its own line, then a grid `repeat(auto-fill, minmax(5.5rem, 1fr))`, gaps 4 / 14.
  Each key is one cell: the key above (`version-key`, exactly the service's key, 11 px `--text-muted`, soft breaks after `_`, `-`, `.`, never
  truncated), the value below (`version-value`). Columns at the box widths 547 / 339 / 237: 5 / 3 / 2.
* Order: the keys in the order of the response object (`Object.keys`), nothing sorted, nothing first.
* Values: a string in a `Tag kind="version"` as written; a number or boolean as mono text (12 px); an object or array as compact JSON in mono,
  cut to 48 chars + "…" with `title` = the whole JSON. A value longer than 16 characters, or any object / array, spans the whole row
  (`data-wide`), so long values do not wrap inside a 90 px cell.
* A key the service does not report is not drawn: no "not set" (the endpoint already drops `null` values).
* `ok` with `{}`: one line "No versioning details reported" (11 px muted). `unsupported` and `error`: today's lines, under the label.
* Loading: three placeholder cells without labels (a 4rem key bar and a 3.5rem value bar) in one flex row that fits one line at every
  box width (3 x 64 px + gaps < 237 px), `aria-busy`. **Orchestrator amendment L1 (2026-11-03):** the loaded grid is NOT padded with
  empty spacer cells; it takes the height of its keys. At 1440 and 1024 one to three keys fit one row, so the loading frame and the loaded
  box have the same height; at 390 one or two keys fit one row (same height as the loading frame) and three keys add one row (37 px, a
  one-time shift on load, recorded as the price of no permanent empty band: the owner's point 4 outranks rule 7 here).
* Review row: per ticked environment, the environment name (6rem column, 12 px 600) then the same grid; one environment: no name column.

Mock numbers (`m_versions.cjs mock`, box heights): 1440 and 1024: loading 124.6, one 124.6, two 124.6, three 124.6 (0 px shift), five 248.8 /
268.8, none 107.2. 390: loading 166, one 166, two 166, three 166 (0 shift), five 288.8, none 107.2. Smallest text 10 px (the Tag), keys 11 px.

| Id | Element (`data-part`) | Width | Criterion |
|---|---|---|---|
| C-3-1 | `env-versions` (`[data-env-version]`, status ok) | all | one `version-key` per key of `versioning_details`, in response order; key text = the key exactly (`agent_version`, not "agent"); with `{agent_version, kb_version}` exactly 2 cells and 0 elements reading "image" or "not set" (today "image not set"); with the 5-key payload the keys read `agent_version, kb_version, prompt_set, model_routing, build` in that order (today alphabetical after a fixed three) |
| C-3-2 | `version-value` | all | string -> `Tag kind="version"` whose text equals the value; number / boolean -> mono 12 px text; object / array -> compact JSON mono, > 48 chars shows 48 chars + "…" and `title` = the full JSON; `data-wide` on cells whose value is > 16 chars or an object / array, spanning all columns |
| C-3-3 | grid | 1440 / 1024 / 390 | label line "Versions" above the grid; columns 5 / 3 / 2 at box widths 547 / 339 / 237; every key `scrollWidth <= clientWidth`, never ellipsis; 0 overlap between cells |
| C-3-4 | loading frame | 1440 / 1024 / 390 | 3 placeholder cells on one row, no label text, `aria-busy="true"`; the box height at the loading frame equals the loaded height for 1, 2 and 3 keys at 1440 and 1024 and for 1 and 2 keys at 390, 0 +- 1 px; 0 empty spacer cells in the loaded DOM (L1) |
| C-3-5 | empty | all | status ok with `{}`: the line "No versioning details reported" (11 px `--text-muted`), 0 cells; box 107.2 +- 2 |
| C-3-6 | unsupported, error | all | texts unchanged ("Not supported by this environment (its Evaluation Service is older than v1.2).", "Couldn’t read: <reason>"), under the "Versions" label |
| C-3-7 | `env-box` heights | 1440 / 1024 / 390 | a ticked box with 1 to 3 reported keys: 124.6 +- 2 at 1440 and 1024; at 390 ~~129 +- 3 for 1 or 2 keys and 166 +- 2 for 3 keys~~ **amended (implementation, measured):** the Versions line is 61.8 +- 1 for 1 or 2 keys (one grid row, the loading frame's height) and 103.2 +- 1 for 3 keys (two rows of the 2-column grid); the box is 124.6 for 1 or 2 keys and 166 for 3 keys when its tags fit one row (dev seed, production without a default preset), plus 24 px when the "Default preset v1" tag wraps to its own row (e2e seed: 148.6 / 190). Reason: 129 was estimated after L1 without a measurement; the measured box has no empty row (L1: no empty row under 1 or 2 keys; amends round 9 C-1-7: 87.8 / 111.8). Asserted by `r10.spec.ts` "R10 C-3-3, C-3-4, C-3-7 … at 390px" on the line height |
| C-3-8 | review `Versions` row | 1440 / 390 | the same `VersionsGrid` per environment with the environment name when >= 2 environments; production `{agent_version, kb_version}` shows exactly those 2 keys and staging the 3 of its payload; row height 106.8 +- 4 at 1440 for the seed; 0 keys dropped (today only the fixed three are printed) |
| C-3-9 | no fixed key list | n/a | `grep -rnE "agent_version|image_version|kb_version" frontend/src` outside `__tests__`, `*.test.*`, `__fixtures__` and `features/dev` returns 0 lines (today `VersionsBlock.tsx` and `model/bestRun.ts`); `VERSION_KEYS` and both `VERSION_LABELS` are deleted |
| C-3-10 | other surfaces | 1440 | best-run header and the best-run table's Versions column (`versionText`) print `key value` pairs with the key as reported, in payload order, objects as compact JSON (today "agent v1.12 / kb 381", objects dropped); drift lines read `<key>: <run value> in this run, <latest> now` with the key as reported; the Experiments list versioning filters and the best-run scope Selects are labelled with the key as reported, first item "All values" / "Any value" (today "KB version", "All KB versions") |
| C-3-11 | accessibility | 1440 / 390 | spacers and placeholders `aria-hidden`; axe 0 serious on the home view with the 5-key payload; text contrast >= 4.5:1 for keys and values on the selected box (keys `--text-muted` on the tinted fill: 4.56:1, round 9 measurement) |

## 5. Point 4: the bar follows the content (K4)

Design (mocks `home-short`, `customize-start`, `customize-where`; shots `mock-page-*-1440x900`, `-1440x1400`, `-390x844`). The bar is the
next sibling of the content: `margin-block: 0 calc(-1 * var(--space-xl))` (no `auto`: the page's 14 px flex gap is the only space above it;
the negative end margin cancels the page's bottom padding so the bar ends at the viewport bottom at the end of a long page), `position:
sticky; inset-block-end: 0` (compositor-positioned, DESIGN_LANGUAGE section 7). The page no longer stretches to the scroller:
`.page { min-block-size }`, and the `flex: 1 1 auto` growth of `.layout`, `.main` and the home's `.home` are removed. So:

* content shorter than the viewport: the bar sits 14 px under the last card; under it is the rest of the empty page, not a band between the
  content and the bar;
* content taller: the bar rides at the viewport bottom while scrolling and meets the content (14 px) at the end.

The wizard's step change keeps the previous step's height for 700 ms (`LaunchWizard` stage hold, so the scroll to the rail does not jump);
the bar moves to its new place once, after the hold. Its slots never change (C-1-1), only its top.

Mock numbers (`m_gap.cjs mock`): home-short 1440x1400: content bottom 894.3, bar top 908.3 (gap 14.0); 1440x900: overflows, bar bottom 900,
at the scroll end content bottom 829.3, bar top 843.3 (14.0), bar bottom 899.3 (the mock shell's 1 px border). customize-start: gap 14.0 at
1440x900 and 1440x1400 (today 216.1 / 716.1). 390: overflows on all three; at the scroll end gap 14.0, bar bottom at the viewport bottom.

| Id | Element (`data-part`) | Width | Criterion |
|---|---|---|---|
| C-4-1 | `launch-bar` style | all | computed `margin-block-start` 0 px (today `auto`, measured 53.7 to 735.3 px), `margin-block-end` -32 px, `position: sticky`, `bottom: 0px`; `LaunchPage.module.css .page` has no `min-block-size`; `.layout`, `.main`, `.home` do not grow (`flex-grow: 0`) |
| C-4-2 | short content | 1440 x 1400, 1440 x 900 | `bar.top - lastContent.bottom` = 14 +- 0.5 on the home view (production only, no saved presets; nothing ticked; staging with saved presets) and on every Customize step whose content is shorter than the viewport (start, settings at 900; all six at 1400); today 374.3 (home, production, 1400) and 216.1 (start, 900) |
| C-4-3 | long content | 1440 x 900, 390 x 844 | while scrolling: `bar.bottom` = viewport bottom +- 1 at the top, the middle and the end of the scroll; at the end `bar.top - lastContent.bottom` = 14 +- 1 |
| C-4-4 | no band under the bar | all | the scroller's `scrollHeight` = the bar's bottom offset (+- 1): no element or padding below the bar adds height; with short content the area below the bar is the page ground with no element in it |
| C-4-5 | step change | 1440 x 1400 | going from where to start: after the 700 ms hold the bar's top equals start's content bottom + 14 (+- 0.5); the five parts and their x are unchanged (C-1-2) |
| C-4-6 | editor and environment page | 1440 x 1400 | the preset editor (same `LaunchWizard`) obeys C-4-2; the environment page's footer (`env-footer`, round 9 C-7-6) already follows its content (no auto margin, checked: it has none) |

## 6. Amendments to round 9 criteria (section 6 amendment rule)

| Round 9 id | Was | Now | Reason (measured) |
|---|---|---|---|
| Principle 0.2 / C-3-2 | six slots Back, Skip, Continue, status, Cancel, Launch on every step; 5 buttons | five slots Skip, Cancel, status, Back, primary (C-1-1); 4 buttons; the launch is the primary slot of the last step only | owner point 1: the Launch shortcut is removed; the order moves to Skip/Cancel left, Back/Continue right |
| C-3-1 | "top edge fixed", fix pass: bar pinned to the page's bottom edge (bottom = viewport bottom on all views) | "the bar's slots and their order never change between steps; its top follows the content" (C-1-2, C-4-2, C-4-3) | owner point 4: the pinned bar left a 216 to 735 px band (section 1.4) |
| C-3-3 | x of Back@227 left, Launch at the right edge | Skip at the left edge, the primary at the right edge, x identical across steps (C-1-2) | K1 order |
| C-3-4 | Skip and Continue disabled on review | Skip disabled on review; the primary slot is the enabled (or blocked) launch there (C-1-3, C-1-4) | K1 |
| C-3-5 | `bar-launch` "Launch N runs", fixed min width | `bar-continue[data-action=launch]` "Launch N runs" on the last step, 120 px minimum shared with "Continue" (C-1-3) | K1 |
| C-3-7 | 390 two rows <= 91 | three rows, 90.8, launch and editor (C-1-9) | K1 order; editor measured 110.2 |
| C-8-2 | editor bar: six parts, Launch reads "Publish vN" | five parts; the primary is "Continue" on steps 1 to 4 and "Publish vN" on Review and publish (C-1-1, C-1-3) | K1 |
| C-1-7 | ticked box 88 +- 6 / 112 +- 8 (136 with the third tag at 390) | 124.6 +- 2 at 1440 and 1024, 166 +- 2 at 390 for 1 to 3 keys; the third "Default preset v1" tag adds its row (+24 at 390) as before (C-3-7) | K3 renderer: label line + key-over-value cells |
| C-5-3, C-5-4 | columns `#`, varying (environment, dataset, **swept setting**, task), Priority | the swept-setting column is replaced by one column per swept pointer (C-2-1); `#` 48 px (C-2-5) | owner point 2; `#` measured 102 |
| C-5-6 | 390 run card <= 110 px | 160 +- 6 for a two-axis sweep (one row per swept setting), 96 px label column (C-2-10) | today 127.6 already broke 110 with one tag row; facts in cells cost one row each |
| C-5-9 | Summary and the first 4 run rows above the bar at 1440x1000 | Summary, the runs header and the first 2 run rows (C-2-12) | the Swept settings row (70.6) and the Versions grid (106.8 vs 43.6) add 127 px to the Summary |
| Review "Versions" row (redesign2) | `production: agent-1.4.2 · img-20261001 · kb-77` | the `VersionsGrid` per environment (C-3-8) | K3 |

Design-language amendments to apply with the implementation (`docs/DESIGN_LANGUAGE.md`):

1. Section 7, "A control the user needs on every step appears on every step": add "The step bar's primary slot changes its label, never its
   position: Continue on every step, the launch or publish on the last. A launch shortcut on earlier steps is not a control the user needs
   on every step (owner 2026-11-03)."
2. Section 7, "Facts in cells, not sentences": "swept setting" -> "one column per swept setting, named as the form names it; a value is the
   value the user picked (a connection's name), never a platform abbreviation".
3. Section 3.2, sticky bars: "A bottom action bar is the next sibling of the content (the page gap above it), `position: sticky; bottom: 0`,
   never `margin-block-start: auto` and never a page stretched to the scroller to push it down; it rides at the viewport bottom only while the
   content overflows (owner 2026-11-03: a pinned bar left a 374 to 735 px band on a tall screen)."
4. Section 3.3 (labels): "Service-reported key/value data (versioning details) is drawn as reported: every key, in the payload's order, the key
   as written; a missing key is not drawn; no fixed key list in the UI."
5. Section 3.4 (DataTable): a header's minimum width is measured on the drawn header (see 7.2), not on its accessible `label`.

## 7. Implementation notes

### 7.1 Files

| Point | File | Change |
|---|---|---|
| 1 | `launch/review/LaunchBar.tsx` | `StepsBar`: groups `.start` (Skip, Cancel), `.status`, `.end` (Back, primary); the primary is one `BarButton part="bar-continue"` with `data-action`, label and variant by step; the `primary` prop is applied only on the last step; Skip `aria-label` "Skip to review and launch" / "… and publish" |
| 1 | `launch/review/launchBar.module.css` | `.start` group; `.status { justify-content: center }` (start at <= 480 px); 390: `.start { flex: 1 1 auto }`, `.end { margin-inline-start: auto }` (the third row); `.primary { min-inline-size: 7.5rem }` |
| 1 | `launch/wizard/LaunchWizard.tsx` | the launch primary feeds the last step only; Continue stays enabled with problems |
| 1 | `environments/DefaultPresetEditorPage.tsx` | the Publish primary on the last step; the status keeps one line at 390 (`.long` on the explanation) |
| 2 | `launch/model/sweepColumns.ts` (new, pure, with `sweepColumns.test.ts`) | `sweepColumns(axes, labelOf)` -> `[{ pointer, name, section?, group?, mono }]` (name = last " › " segment of `locate(...).label`; `section` only for duplicated names; `group` for linked axes); `sweepValue(value)` (connection name / temporary / inherit / scalars); `sweepLines(axes, labelOf)` for the Summary row and the Changes label |
| 2 | `launch/review/ReviewStep.tsx`, `reviewStep.module.css` | `RunRow.sweep: Record<pointer, string>` from `job.params.sweep`; the `swept` column replaced by the sweep columns (header node + `label`), `#` without the inflated minimum; `RunFact` per sweep column; `SummaryCard` row "Swept settings"; `useChangeRows` names the axes |
| 2 | `ui/DataTable/model.ts` (`headerMinWidth`) | measure the drawn header when `header` is a string (the `#` column becomes 48 px); `label` stays the accessible name; unit test in `ui/DataTable/__tests__` |
| 3 | `launch/entry/VersionsBlock.tsx`, `entry.module.css` | `VersionsGrid` (exported), `EnvVersions` and `VersionsSummary` use it; delete `VERSION_KEYS`, `VERSION_LABELS`, `SummaryLine`'s key filter; the review row's `mono` flag goes (the grid sets its own fonts) |
| 3 | `launch/model/bestRun.ts`, `bestrun/lib.ts`, `lib/format.ts`, `bestrun/ScopePrompt.tsx`, `list/ExperimentsPage.tsx` | `versionText` and `driftLines` without `VERSION_LABELS` (payload order, objects as compact JSON); `keyWords` / `versioningWords` / `versioningLabel` return the key as is; "All values" / "Any value" |
| 4 | `launch/review/launchBar.module.css` | `.bar { margin-block: 0 calc(-1 * var(--space-xl)) }` |
| 4 | `launch/LaunchPage.module.css`, `launch/entry/entry.module.css` | `.page` loses `min-block-size: 100%`; `.layout`, `.main`, `.home` lose `flex: 1 1 auto` |

The recipes to copy are the CSS blocks marked "recipe" in `frontend/src/features/dev/Round10Mocks.module.css` (`.bar`, `.barStart`, `.barEnd`,
`.barStatus`, `.primary`, `.versions`, `.vGrid`, `.vItem`, `.vItem[data-wide]`, `.vSpacer`, `.skelKey`, `.skelValue`, `.reviewEnv`, `.swept*`,
`.axisHead`, `.axisSection`) and the TSX of `StepsBar10`, `VersionsGrid`, `VersionValue`, `KeyName`, `RunsTable10`, `RunCards10`, `SweptSettings`.

### 7.2 Tests that must change (existing assertions)

e2e (`frontend/e2e/`):

| Spec : line | Asserts today | Must assert |
|---|---|---|
| `experiments/launch/r9-create.spec.ts:200` | `PARTS = [bar-back, bar-skip, bar-continue, bar-status, bar-cancel, bar-launch]` | `[bar-skip, bar-cancel, bar-status, bar-back, bar-continue]` (C-1-1) |
| `r9-create.spec.ts:209` | x of each part, `bar-launch` by its right edge | `bar-continue` by its right edge (C-1-2) |
| `r9-create.spec.ts:220` | "C-3-1, C-3-2, C-3-3, C-3-6 the same bar on all six steps" | the same with the new order and 4 buttons (R10 C-1-1, C-1-2, C-1-11) |
| `r9-create.spec.ts:244-261` | bar top equal on home and six steps, bottom = viewport bottom | R10 C-4-2 / C-4-3: 14 px gap when short (1440x1400), bottom = viewport while overflowing (1440x900, 390) |
| `r9-create.spec.ts:271-273` | Skip and Continue enabled on steps, both disabled on review | Skip disabled on review; `bar-continue` enabled with `data-action=launch` (C-1-3, C-1-4) |
| `r9-create.spec.ts:283-289` | `bar-launch` "Launch 6 runs" / "Launch", Cancel box unchanged, variant primary | `bar-continue` on review: same texts; `bar-back` box unchanged between "Continue" and "Launch 6 runs"; variant primary (C-1-3) |
| `r9-create.spec.ts:301` | 390: five parts incl. `bar-launch` visible | the five new parts, three rows, 90.8 (C-1-9) |
| `r9-create.spec.ts:312-314` | home parts | unchanged (C-1-10) |
| `r9-create.spec.ts:339` | home at 390: bottom = viewport bottom | still true while the home overflows at 390 (it does: 1593 px); keep, renamed R10 C-4-3 |
| `r9-create.spec.ts:417` | headers `['#', 'environment', 'swept', 'priority']` | the timeout seed: `['#', 'environment', 'timeout', 'priority']` (first word, lower case), plus the two-axis seed of this round (C-2-1) |
| `r9-create.spec.ts:526-530` | `bar-launch` disabled until the ack, then enabled and clicked | the review's `bar-continue[data-action=launch]` |
| `experiments/launch/r9-editor.spec.ts:53-56` | `bar-launch` "Publish v2", six parts | on Review and publish `bar-continue[data-action=publish]` "Publish v2"; five parts; "Continue" on the other editor steps |
| `experiments/launch/wizard.spec.ts:68-69, 72` | `bar-continue` disabled on review, `launchButton` clicks | `bar-continue` enabled with the launch label; Skip disabled |
| `experiments/launch/launchSupport.ts:169` | `launchButton = [data-part=bar-launch]` | `[data-part=bar-launch], [data-part=bar-continue][data-action=launch], [data-part=bar-continue][data-action=publish]` (home and last step); every caller that asserts the launch state on a non-review step must go to the review first (`toReview`), because there is no launch there: audit `entry.spec.ts:126, 131, 156` (step where), `evaluation.spec.ts:75, 87, 106, 118`, `launch.spec.ts:73-82, 152, 157` (after `goStep('evaluation')`), `sweeps.spec.ts:69, 125, 139`, `multi-review.spec.ts:131, 212`, `models.spec.ts:109` |
| `experiments/launch/multi-task.spec.ts:126` | `bar-launch` disabled (home view) | unchanged if on the home view (it is: the home bar keeps `bar-launch`) |
| `visual-language/final-polish.spec.ts:122, 191` | parts `bar-back, bar-skip, bar-continue, bar-cancel, bar-launch` | the five new parts |
| `experiments/launch/qa-b-versions.spec.ts:244-260` | `image_version: null` gives one `[data-unset]` "not set" | 0 `[data-unset]`; cells `agent_version`, `kb_version` only (C-3-1) |
| `experiments/launch/versions.spec.ts`, `qa-b-versions.spec.ts` (values) | `toContainText('agent-1.4.2')` | unchanged (values); add the 5-key payload (order, object title) and `{}` (C-3-1, C-3-2, C-3-5) |

Vitest: `launch/__tests__/EnvVersions.test.tsx` (labels `agent` / `kb` / "not set" -> the keys, no "not set"; the loading frame has 3
placeholders and no label), `launch/__tests__/BestRunPicker.test.tsx` and `model/layering.test.ts` (drift "agent: …" -> "agent_version: …",
header "agent v1.4" -> "agent_version 1.4"), `bestrun/__tests__/scope.test.tsx` (labels), `list/ExperimentsPage.test.tsx` (filter label
"KB version" -> "kb_version", "All values"), `review/__tests__` for the run table columns, `ui/DataTable/__tests__` for `headerMinWidth`.

New e2e: `experiments/launch/r10-*.spec.ts` asserting every C-1 to C-4 criterion on the numbers above, with this round's seed (a
two-axis sweep through the API as in `seed_r10.py`, the fake's `/__control/versioning` for 2, 5 and 0 keys).

## 8. Decisions taken in this stage (no open question)

| # | Decision | Why |
|---|---|---|
| D10-1 | The primary slot keeps `data-part="bar-continue"` on every step (K1 names it) and carries `data-action` continue / launch / publish; `bar-launch` survives only on the home bar | one part per slot (the part list is identical on every step); tests target the action |
| D10-2 | Continue stays enabled when the form has problems | moving to the next step never needs a valid form; the status link names the first problem; only the last step's launch is blocked |
| D10-3 | The status content is centred between the two groups | K1 says "centre"; a start-aligned status next to Cancel would read as Cancel's caption |
| D10-4 | "Swept settings" is a Summary row, not a line above the table | it is a fact of the experiment like Dataset and Priority; the table stays one fact per cell |
| D10-5 | The swept column header is the last segment of the form label, with the section only on duplicates | K2; "Endpoints › primary › Timeout" on every header would triple the header height for one setting |
| D10-6 | Versions: label line + key-over-value cells, wide values span the row; ~~at least three cells~~ (overturned by L1: no spacer cells, the grid takes the height of its keys; the 3 loading placeholders sit on one row) | keys as written need more width than "agent" did; an empty row under 1 or 2 keys is the empty band of point 4 again |
| D10-7 | The filter and scope labels show the key as written ("kb_version", "All values") | K3's "present them as is" applies to every surface that names a versioning key; the humanizer invented "KB version" |
| D10-8 | `headerMinWidth` measures the drawn header string | the 102 px `#` column takes 54 px from the swept columns; a label is the accessible name, not drawn text |

## 9. Criteria count and shots

Criteria: point 1: 11 (C-1-1..11), point 2: 12 (C-2-1..12), point 3: 11 (C-3-1..11), point 4: 6 (C-4-1..6) = **40**. Amended round 9
criteria: 12 rows in section 6.

Shots (`shots/`): today `current-create-home-short-{1440x900,1440x1400,390x844}`, `current-create-home-empty-{…}`,
`current-step-start-{…}`, `current-review-two-axis-{1440,1024,390}`, `current-review-two-axis-runs-{1440,1024,390}`,
`current-env-versions-{three,two,five,none}-{1440,390}`; composed mocks `mock-page-{customize-where,customize-start,review,env-versions,env-versions-none,home-short}-{1440,390}`
and the viewport shots `mock-page-{home-short,customize-start,customize-where}-{1440x900,1440x1400,390x844}`; appendix
`sheet-bar-{1440,390}`, `sheet-versions-{1440,390}`, `sheet-runs-1440`.

Not measured: the 1024 width of the composed mocks (the mock shell is drawn at 1440 or 390; the 1024 numbers come from the sheet frames at the
real 777 / 339 px widths and from today's page); the bar's position during a step change in the real wizard (C-4-5 needs the implementation).
