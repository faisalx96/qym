# Round 10 implementation notes

Branch `ui/redesign10-impl` (from the design tip f259aa91). Stage 2 of 3. Spec: `experiments.md` (40 criteria, amendment L1). Every
number below was measured on this branch: the design's scripts (`measure/m_bar.cjs`, `m_review.cjs`, `m_versions.cjs`,
`m_gap.cjs`, run in `current` mode against the implementation with `R10_SHOTS=after`) on the Vite dev server :5970 proxying the
platform :8970 (SQLite, `seed_r10.py` with `R10_PLATFORM_PORT=8970 R10_FAKE_PORTS=9070,9071`), and the new e2e
`frontend/e2e/experiments/launch/r10.spec.ts` (Playwright's own servers and the round 9 seed, `seedR9`). Raw outputs:
`measure/after-*.txt`.

## Changes

| Point | File | Change |
|---|---|---|
| 1 | `launch/review/LaunchBar.tsx` | `StepsBar`: `.start` (Skip, Cancel), `.status`, `.end` (Back, primary). The primary is one `bar-continue` with `data-action` continue / launch / publish: "Continue" (neutral, always enabled, `aria-label` "Continue to <step>") before the last step, the `primary` prop (label, disabled, loading) on it. Skip's `aria-label` "Skip to review and launch" / "… and publish"; new `action` prop. No `bar-launch` in the steps bar. |
| 1, 4 | `launch/review/launchBar.module.css` | `.bar { margin-block: 0 calc(-1 * var(--space-xl)) }` (no auto margin); `.start` group; `.status { justify-content: center }`, start-aligned on the home bar and at <= 480 px; `.primary { min-inline-size: 7.5rem }`; 390: `.start` grows, `.end` to the end (third row). |
| 1 | `launch/wizard/LaunchWizard.tsx` | passes `action` (launch / publish); the launch primary only feeds the last step. |
| 1 | `environments/DefaultPresetEditorPage.tsx` | the editor's blocker text after "N changes vs vX" is `.long` (hidden at <= 480 px), so the status is one line at 390. |
| 2 | `launch/model/sweepColumns.ts` (new) + `sweepColumns.test.ts` | `sweepColumns(axes, labelOf)` (name = last " › " segment of `locate().label`, section only for duplicated names, linked band, mono for numbers / booleans), `sweepValue` (connection name, `temporary: <model>`, `inherit`, scalars, JSON), `sweepLines` (Summary), `sweepAxesText` (Changes). |
| 2 | `launch/review/ReviewStep.tsx`, `reviewStep.module.css` | `RunRow.sweep` from `job.params.sweep[pointer]` (never the label); one column per swept pointer (`AxisHeader`: name, `axis-section` on duplicates; `axis-cell` 12 px primary text); Environment `minWidth: 120`, flex; `RunFact` per sweep column on phones; Summary row **Swept settings** (`review-swept`, `swept-axis`); Changes "Sweeps: <names>"; the Versions row is no longer `mono`. |
| 2 | `ui/DataTable/model.ts` + `__tests__/headerMinWidth.test.ts` | `headerMinWidth` measures the drawn header string (D10-8). |
| 3 | `launch/entry/VersionsBlock.tsx`, `entry.module.css` | `VersionsGrid` (exported): keys in response order, the key as written with soft breaks, values as Tag / mono scalar / compact JSON (48 chars + "…", `title`), `data-wide` for > 16 chars or objects, "No versioning details reported" for `{}`, three placeholder cells on one row while loading (no spacer cells, L1). `EnvVersions` (label line + grid) and `VersionsSummary` (per environment, name column when >= 2) use it. `VERSION_KEYS`, `VERSION_LABELS`, the "not set" cell and `SummaryLine`'s key filter are deleted. |
| 3 | `launch/model/bestRun.ts`, `bestrun/lib.ts`, `bestrun/ScopePrompt.tsx`, `lib/format.ts`, `list/ExperimentsPage.tsx` | `versionText` / `driftLines`: keys as reported, payload order, objects as compact JSON; `keyWords` and `versioningWords` deleted, `versioningLabel` returns the key; first items "All values" / "Any value"; the scope selects keep the payload order. |
| 4 | `launch/LaunchPage.module.css`, `launch/entry/entry.module.css` | `.page` loses `min-block-size: 100%`; `.layout`, `.main`, `.home` lose `flex: 1 1 auto`. |
| docs | `docs/DESIGN_LANGUAGE.md` | the five additions of spec section 6 (3.2 bottom action bar, 3.3 service-reported key/value data, 3.4 header minimum, section 7 primary slot and facts-in-cells). |
| docs | `docs/USER_GUIDE.md`, `docs/RELEASE_NOTES.md`, `knowledge_platform.json` | the Customize bar and run table, the versions as reported; one release-note bullet per point; the feedback pack rebuilt. |
| measure | `measure/seed_r10.py`, `m_*.cjs`, `shots_after.cjs` (new) | ports from `R10_PLATFORM_PORT` / `R10_FAKE_PORTS` / `R10_FAKE`, shot prefix from `R10_SHOTS`; `shots_after.cjs` takes the after-page shots. |

## Criterion -> change -> test

Required vs measured. "e2e" = `r10.spec.ts` test title prefix; "unit" = Vitest.

### Point 1: the bar

| Id | Required | Measured | Change | Test |
|---|---|---|---|---|
| C-1-1 | 5 parts in order skip, cancel, status, back, continue on 6 launch + 5 editor steps; `bar-launch` 0; 4 buttons + link | `m_bar`: 1440 / 1024 / 390, every launch and editor step: exactly those 5 parts in that order, 4 buttons + the status link (launch: "Fix 1 problem first", the button count reads 5); `bar-launch` 0 | LaunchBar | e2e "R10 C-1-1, C-1-2, C-1-8, C-1-11" (1440, 1024), "R10 C-1-1, C-1-3 the preset editor"; unit `LaunchBar.test.tsx`; `r9-create` C-3-2 |
| C-1-2 | skip.x - bar.x = 15 +- 1; bar.right - continue.right = 15 +- 1; cancel = skip.right + 8; back.right = continue.x - 8; x constant <= 1 | 1440: skip@227+105, cancel@340, status@418+776, back@1208+54, continue@1270+120 (bar 212..1405: 15 / 15); same x on all six steps and the editor (0 px); 1024: back@792, continue@854 | LaunchBar, CSS | e2e (asserted with +-1 on each step) |
| C-1-3 | Continue neutral enabled `aria-label` "Continue to …" on steps 1..N-1; launch / publish primary on the last, disabled as before; min-inline-size 120; Back x equal | "Continue" 120 px; review "Launch 12 runs" 120 px, primary; Back 1208 on both (0 px); editor review "Publish v2" disabled with 0 changes | LaunchBar, LaunchWizard | e2e "R10 C-1-3, C-1-4, C-1-5", editor test; `r9-create` C-3-5 |
| C-1-4 | Skip enabled steps 1..N-1, disabled in place on the last (`aria-disabled`, out of Tab order); "Skip to review" / "Skip" <= 480; aria-labels | as required; x on review = x on models (0 px); 390 "Skip" (51 px) | LaunchBar | e2e C-1-3/4/5, C-1-9, C-1-7 |
| C-1-5 | Cancel ghost, Back neutral, both enabled, same actions | Back from step 1 -> start view; Cancel -> experiments list | unchanged handlers | e2e C-1-3/4/5 |
| C-1-6 | 0 buttons named Launch* / Publish* on steps where..evaluation | 0 at 1440 and 390 on the five steps; 1 on review | LaunchBar | e2e "R10 C-1-6" (1440, 390); `final-polish`, `entry`, `launch`, `evaluation`, `sweeps`, `preset-editor` |
| C-1-7 | Tab order Skip, Cancel, link, Back, primary; Enter on Continue focuses the next h2; on review Skip out of order | Tab from Skip: cancel, status link, back, continue; Enter -> "Environment configurations" h2 focused | DOM order | e2e "R10 C-1-7" |
| C-1-8 | status between groups (>= 14 px each side), centred >= 481, start <= 480 | 1440: cancel.right 404 + 14 = 418 = status.x; status.right 1194 + 14 = 1208 = back.x; `center` / `flex-start` | CSS | e2e C-1-1 block, "R10 C-1-8" |
| C-1-9 | 390: three rows, 90.8 +- 1, launch and editor; no overflow; status one line | 90.8 on all six launch steps and the editor steps (was 110.2 in the editor); skip@85 row 2, back@164 / continue@226+120 row 3 | CSS, `.long` on the editor blocker | e2e "R10 C-1-9"; `r9-create` C-3-7, `final-polish`, `wizard` |
| C-1-10 | home bar unchanged, 56 / 90.8 | 56 / 90.8; parts name, status, customize, launch | none | e2e "R10 C-1-10"; `r9-create` C-3-8 |
| C-1-11 | 56 +- 1 every step, round 9 chrome | 56.0 on every step | unchanged | e2e C-1-1 block; `r9-editor` C-8-2 |

### Point 2: swept settings as columns

| Id | Required | Measured (1440 / 1024 / 390) | Change | Test |
|---|---|---|---|---|
| C-2-1 | `# | Environment | Primary model | Milvus Search Threshold | Timeout | Priority`, no "Swept setting" | exactly that (headers `#`, `ENVIRONMENT`, `Primary model`, `Milvus Search Threshold`, `Timeout`, `PRIORITY`) | ReviewStep, sweepColumns | e2e "R10 C-2-1 … (1440px / 1024px)"; unit `ReviewStep.test.tsx`; `r9-create` C-5-4 |
| C-2-2 | last label segment, `text-transform: none`, section line on duplicates (11 px 400 muted), no clipping | "Timeout" from "Endpoints › primary › Timeout"; `none`; duplicate timeouts carry two different `axis-section` lines, 11 px / 400 | AxisHeader | e2e "R10 C-2-2"; unit `sweepColumns.test.ts` |
| C-2-3 | band "Linked: vary together" = sum of its columns +- 1 | 451.5 = 225.8 + 225.8 (1440); 243.5 (1024) | `group` | e2e C-2-1 block |
| C-2-4 | run 1 `gpt-4o prod`, `0.5`, `10`; 12 px; numbers mono; 0 tags; no overflow | as required (12 px, `0.5` / `10` mono, 0 tags, `scrollWidth <= clientWidth` on 36 cells) | sweepValue, axis-cell | e2e C-2-1 block; unit |
| C-2-5 | `#` 48 +- 1; Priority 240; >= 120; 1440 equal flex; 1024 no scroll | `#` 48 (was 102), Priority 240; 1440: 225.8 x 4; 1024: 121.8 x 4, scroll 775 / 775 | D10-8, Environment `minWidth: 120` | e2e C-2-1 block |
| C-2-6 | with Environment 6 / 3 fit, 7 / 4 scroll; without it one more fits; no column < 120, nothing truncated | e2e (dry-run answers with N linked pointers): 1440 6 fit, 7 scroll, 7 without Environment fit; 1024 3 / 4 / 4 likewise; all flex columns >= 119.5, 0 clipped | DataTable minimums | e2e "R10 C-2-6" (1440, 1024) |
| C-2-7 | one environment: no Environment column | `# | <swept> | Priority` | visibleColumns | e2e "R10 C-2-7"; unit |
| C-2-8 | Summary row between Dataset and Priority, one line per axis, texts, 70.6 +- 4, absent when nothing swept | lines `Primary model + Milvus Search Threshold: gpt-4o prod + 0.5, claude-sonnet eval + 0.7 linked` and `Timeout: 10, 30, 60`; row 70.6; absent without sweeps | SweptSettings | e2e "R10 C-2-8, C-2-9, C-2-12", "R10 C-2-8 no Swept settings row"; unit |
| C-2-9 | "Sweeps: Primary model + Milvus Search Threshold (linked), Timeout" with Edit | exactly that, Edit present | sweepAxesText | e2e; unit `sweepColumns.test.ts` |
| C-2-10 | 390: 12 cards, dt/dd per swept column in order, label 96, 160 +- 6 | 12 cards, `Run, Environment, Primary model, Milvus Search Threshold, Timeout, Priority`, 96 px, 160.0 | RunFact | e2e "R10 C-2-10" |
| C-2-11 | 12 rows of 32 +- 1, a select each, 0 disclosures | 12 x 32.0, 12 selects, 0 row disclosures | unchanged | e2e C-2-1 block |
| C-2-12 | 1440 x 1000: Summary, runs header and the first 2 rows above the bar | Summary ends 704.8, run 2 ends 898.5, bar top 944 (mock 698.8 / 893.5 / 944) | — | e2e C-2-8 block; `r9-create` C-5-9 (amended) |

### Point 3: versions as reported

| Id | Required | Measured | Change | Test |
|---|---|---|---|---|
| C-3-1 | keys exactly, response order; `{agent_version, kb_version}` 2 cells, 0 "image" / "not set"; 5-key order | two: `agent_version, kb_version`; five: `agent_version, kb_version, prompt_set, model_routing, build` | VersionsGrid | e2e "R10 C-3-1"; unit `EnvVersions.test.tsx`; `qa-b-versions` QA4-8 |
| C-3-2 | Tag for strings, mono 12 px scalars, JSON 48 + "…" with title, `data-wide` | as required; `prompt_set` and `model_routing` wide (span the grid) | VersionValue | e2e "R10 C-3-2"; unit |
| C-3-3 | label line above, 5 / 3 / 2 columns at box widths 547 / 339 / 237, no clipped key, 0 overlap | box 547 / 339 / 237 -> 5 / 3 / 2 columns; 0 clipped, 0 overlap | `.vGrid` | e2e "R10 C-3-3, C-3-4, C-3-7" (1440, 1024, 390) |
| C-3-4 | 3 placeholders on one row, no text, `aria-busy`; loading = loaded for 1-3 keys at 1440 / 1024 and 1-2 keys at 390; 0 spacers | `m_versions`: 1440 loading 124.6 = three 124.6 = two 124.6 (shift 0); 390 two 124.6 = loading (0), three 166 (+41.4, L1); e2e: one row, empty text, 0 spacer cells | VersionsGrid loading | e2e C-3-3 block; unit; `qa-b-versions` QA4-7 |
| C-3-5 | `{}`: "No versioning details reported" 11 px, 0 cells, box 107.2 +- 2 | 107.2 (1440 and 390) | VersionsGrid | e2e "R10 C-3-5, C-3-6"; unit |
| C-3-6 | unsupported / error texts unchanged under the label | unchanged, first child "Versions" | EnvVersions | e2e "R10 C-3-5, C-3-6"; `qa-b-versions` |
| C-3-7 | 124.6 +- 2 at 1440 / 1024; at 390 ~~129 +- 3 (1-2 keys)~~, 166 +- 2 (3 keys) | 124.6 at 1440 and 1024 for 1 to 3 keys; 390: 124.6 for 1-2 keys and 166 for 3 (dev seed, no preset tag), 148.6 / 190 in the e2e seed (+24, the "Default preset v1" tag row) | — | **amended** in the spec: the 390 line height 61.8 / 103.2 (+-1) and the box 124.6 / 166 (+24 with the tag row); asserted by e2e "R10 C-3-3, C-3-4, C-3-7 … at 390px" and `r9-create` C-1-7 |
| C-3-8 | the grid per environment with names; production 2 keys, staging 3; row 106.8 +- 4; 0 dropped | 106.8; production `agent_version, kb_version`, staging `agent_version, image_version, kb_version` | VersionsSummary | e2e "R10 C-3-8" |
| C-3-9 | grep of the three names outside tests / fixtures / dev = 0; constants deleted | 0 lines | deletions | unit `noFixedVersionKeys.test.ts` |
| C-3-10 | best-run header / table `key value` in payload order, JSON objects; drift `<key>: …`; list filters and scope selects keyed as reported, "All values" / "Any value" | `agent_version 1.4 / kb_version kb-7`; `release: v1 in this run, v2 now`; filter label `kb_version`, "All values"; scope "Any value" | bestRun.ts, lib, format, ScopePrompt, ExperimentsPage | unit `bestRun.test.ts`, `BestRunPicker`, `layering`, `scope`, `ExperimentsPage`; e2e `experiments/list.spec.ts` |
| C-3-11 | placeholders aria-hidden; axe 0 serious with 5 keys; key contrast >= 4.5 | axe 0 serious at 1440 and 390; key contrast on the selected box >= 4.5 (asserted) | — | e2e "R10 C-3-11"; `qa-b-versions` QA4-13 |

### Point 4: the bar follows the content

| Id | Required | Measured | Change | Test |
|---|---|---|---|---|
| C-4-1 | margin-top 0, margin-bottom -32, sticky, bottom 0; `.page` no min-block-size; no growth | `0px / -32px / sticky / 0px`; `.page` min-height 0; flex-grow 0 on main, layout, home | CSS | e2e "R10 C-4-1" |
| C-4-2 | gap 14 +- 0.5 when short (home three states, all steps at 1400; start, settings at 900) | `m_gap`: 1440x1400 home nothing 14.0, production 14.0, staging 14.0, six steps 14.0; 1440x900 where 14.0, start 14.0, settings 14.0 (was 374.3 / 216.1) | CSS | e2e "R10 C-4-2" (1400, 900); `r9-create` C-3-1 replacement |
| C-4-3 | overflowing: bottom = viewport +- 1 at top, middle, end; end gap 14 +- 1 | 1440x900 home / models / evaluation / review and 390 every view: bar bottom 900 / 844; end gap 14 | CSS | e2e "R10 C-4-3, C-4-4" (1440x900, 390x844) |
| C-4-4 | nothing below the bar adds height | at the scroll end the bar's bottom = scrollHeight (+-1); short pages: no content element under the bar | CSS | e2e C-4-2, C-4-3 blocks |
| C-4-5 | where -> start: after the hold the bar's top = content bottom + 14; parts' x unchanged | 14.0; x unchanged | — | e2e "R10 C-4-5" |
| C-4-6 | editor obeys C-4-2 | gap 14 on the short editor steps at 1400 | shared CSS | e2e "R10 C-4-6" |

## DataTable `label` audit (D10-8)

Every `DataTable` column in `frontend/src` whose `label` differs from its string `header` (scan of column object literals; the CSV
exporter in `run-detail/lib/csv.ts` is not a DataTable). The floor is `max(width ?? 120, headerMinWidth)` for fixed columns,
`max(minWidth, headerMinWidth, 64)` for flex ones.

| Column | header / label | Floor before | Floor after | Rendered |
|---|---|---|---|---|
| Review runs `#` (`launch/review/ReviewStep.tsx`) | `#` / "Run number" | 102 | 48 | 102 -> 48 (the intended change) |
| Run detail passes `median` (`run-detail/components/panels/PassTable.tsx`) | "Median" / "Median latency" | 137 | 137 (`width: 137` added) | repeat run of `seed-run-detail.ts`: 1440 215.8 -> 215.8, 1024 138.5 -> 138.5 (with the D10-8 change alone it read 193.5 / 124.2, so the column now states the width it had) |
| Run detail datasets `show` (`run-detail/components/panels/DatasetsSection.tsx`) | "" / "Show items", `hideLabel` | 88 | 88 | unchanged (`hideLabel` returns the default) |
| dev mocks `DatasetAccessMocks`, `QaDatasetsMocks` `level` | "Level" / "View", width 160 | 160 | 160 | unchanged |
| dev mock `MultiSdkMocks` `show` | "" / "Show items" | 88 | 88 | unchanged |
