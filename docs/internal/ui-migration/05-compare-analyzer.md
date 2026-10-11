# Compare view and Analyzer — migration brief

Written by an analysis agent for the React/TypeScript/Vite migration. Audience: the
component agent that will rebuild this area from scratch in `frontend/`. Be concrete:
file paths with line numbers, API routes with methods and response shapes, exact
behaviors. No marketing language.

All paths below are relative to the repo root unless they start with `/`. `D` =
`packages/platform/qym_platform/_static/dashboard`, `API` =
`packages/platform/qym_platform/api`. Line numbers are from branch `UI-redesign`
at commit `f3fab1a`.

## 1. Surface inventory

| page/route | HTML file | JS/CSS files it loads | entry function(s) | approx LOC |
|---|---|---|---|---|
| `/compare?runs=…` (also `/projects/{slug}/compare`, see `D/shell.js:164,199`) | `D/compare.html` (16 585 lines: inline `<style>` 18–5450, body 5454–5720, inline `<script>` 5721–16583) | `dashboard.css`, `shell.css`, `ui_components.css`; `qym_safe.js`, `auth.js`, `shell.js`, `metrics.js`, `run_details.js`, `trace_viewer.js`, `step_latency.js`, `playground.js`, `ui_components.js` (deferred) | IIFE at 5722; `loadHeaderUser()` + `loadComparisonData()` at 16580–16581; `render()` at 9598 | ~10 900 JS, ~5 400 CSS |
| `/run/{run_id}/analyzer` (legacy), `/projects/{slug}/analysis[?run=…&pass=N&metric=…&scope=…]`, `/projects/{slug}/runs/{run_id}/analyzer` | `D/analyzer.html` (6 170 lines: `<style>` 16–3573, body 3577–3665, `<script>` 3665–6168) | `dashboard.css`, `shell.css`, `ui_components.css`; `qym_safe.js`, `auth.js`, `shell.js`, `metrics.js`, `qym_table.js`, `playground.js`, `ui_components.js` | IIFE at 3666; `loadRun()` at 6166; `composeAnalyzerWorkspace()` at 5208 (rearranges the DOM that `playground.js` builds) | ~2 500 JS, ~3 550 CSS |
| (shared) AI analyzer workspace, also opened as an overlay from compare ("Auto-Analyze") and from the run page | `D/playground.js` | — | `window.QymPlayground.{init, open, close, getConfig, refreshRuleView, filterCategories, refreshCategoryCatalog, refreshFilters, isBusy, clearResults}` (6287–6312) | 6 321 JS |
| `compare_export.html` (downloaded self-contained copy of the compare page) | generated client-side from `compare.html` (16527–16577) | inlines `dashboard.css`, `shell.css`, `ui_components.css`, `qym_safe.js`, `metrics.js`, `trace_viewer.js`, `ui_components.js`; strips `auth/shell/playground/run_details/step_latency` | `window.__QYM_COMPARE_EXPORT__ = true` + `window.__QYM_COMPARE_DATA__ = {runs}` (16554) → `loadComparisonData()` export branch (8565–8578) | same as compare |

Server routes that serve these pages: `API/runs.py:2266` (`/compare`),
`API/runs.py:2424` (`/run/{run_id:path}/analyzer`), `:2438`
(`/projects/{project_slug}/analysis`), `:2457`
(`/projects/{project_slug}/runs/{run_id:path}/analyzer`). The analyzer routes
canonicalise with 307 redirects (`API/runs.py:1516–1620`): `?run=X` on the project
analysis page redirects to `/projects/{slug}/runs/X/analyzer` (query minus `run` and
`scope`); `scope=diagnosis|project|dashboard` rewrite to
`categories|rules|run`.

Entry points that *navigate to* compare (not part of this area, but the component
agent must keep their contracts):

- Runs list "Compare" button: `D/dashboard.js:7124–7133` (`openComparison`) → `sessionStorage.compareRuns` + `compare?runs=a&runs=b…`; refs may be pass refs `"<run_id>::pass<N>"` (`expandComparisonRefs`).
- Runs list "Cohort" button: `D/dashboard.js:7213–7254` (`openCohortComparison`) → `sessionStorage.compareCohorts` (`{left,right,leftLabel,rightLabel}`) + `compare?cohortA=…&cohortB=…&cohortALabel=…&cohortBLabel=…`.
- Models view "compare" link: `D/dashboard.js:6653–6665`.
- Experiment matrix: `D/experiment_matrix.js:265–271` (`compare?runs=…`).
- Runs list "Analyze" chip: `D/dashboard.js:134–144` (`analyzerUrlForRun`) → `projects/{slug}/analysis?run={id}[&pass=N]` or legacy `run/{id}/analyzer`.
- The analyzer's "Select a run from Runs" landing link adds `?qym_analysis_run_picker=1` to the runs list; the runs list consumes it once and makes run-name links open the analyzer (`D/dashboard.js:179–187, 7104–7112`).

## 2. User journeys (as-is)

### J1. Compare 2–20 runs selected on the Runs page

1. On Runs, tick ≥2 runs (or individual passes of a repeat run), click **Compare**. The list writes `sessionStorage.compareRuns` and navigates to `compare?runs=<id>&runs=<id>…` (`D/dashboard.js:7124`).
2. `compare.html` shows a skeleton (`#loading`, 5456) for ≥0.35 s; `loadComparisonData()` (8563) reads params in this precedence: `cohortA/cohortB` → `runs` (≥2) → `sessionStorage.compareCohorts` → `sessionStorage.compareRuns` → empty state ("No runs to compare", 5476).
3. It de-duplicates pass refs to base run ids (`passRefBase`, 12757), calls `GET api/compare?files=…&view=compact` (8658), then re-expands pass refs client-side (`expandPassRefs` 12873; a whole repeat run with `samples>1` becomes one entry per pass; `sliceRunToPass` 12780 fabricates a per-pass run from `pass_scores`/`pass_attempts`/`pass_metric_meta`/`pass_metric_analyses`).
4. `processRuns()` (8771) computes alignment, metric list/types/directions/thresholds, comparison stats for every metric, metadata/category inventories; `render()` (9598) paints every section. The URL is rewritten with `history.replaceState` to carry the run list and view state (`_updateCompareUrl` 8308, `syncCompareViewUrl` 10527).
5. Success: header "Compare Runs" + subtitle, run summary cards, Per-Run Averages table, Comparison Overview stats, Performance by Category, Step latency panel, Error Distribution, Root Cause Analysis, Item-by-Item list (20 per page).
6. Error states: non-2xx → `QymUIComponents.renderErrorState` with **Retry** (8729); some runs missing but ≥2 returned → warning toast (8677); <2 returned → "Runs in this comparison were not found" panel with "Back to Dashboard" (8742); runs that cannot be aligned by item id (`compare_alignment_status !== 'aligned'`) → item-level sections replaced by an alignment warning listing per-run issues (8201, 13776).
7. Keyboard: none page-specific here; focus goes nowhere in particular after load.
8. URL/query state (all restored on load, `COMPARE_VIEW_PARAMS` 8334): `runs[]`, `cohortA[]`, `cohortB[]`, `cohortALabel`, `cohortBLabel`, `baseline` (column key), `columns=passes`, `metric`, `filter`, `winner`, `q`, `sort`, `page`, `tab=sweep`, `item` (expanded item id, scrolled into view once), `filters` (JSON blob of rule tree + page filters + error filters with hashed long labels, 8377–8468), `trace` (consumed by `QymTraceViewer.restoreFromUrl`, 9617).
9. Persisted: `sessionStorage.compareRuns`, `sessionStorage.compareCohorts` (removed/rewritten by both compare and the runs list), `sessionStorage.dashboardRunFile` (set by runs list when opening a run). No localStorage.

### J2. Cohort comparison (A vs B, k executions each) and the Sweep tab

1. On Runs, select runs/passes, click **Cohort** → locks "Cohort A"; select the same number of executions, click **Open Cohort** (`D/dashboard.js:7213`). Navigates with `cohortA/cohortB/cohortALabel/cohortBLabel`.
2. Compare shows a cohort banner "Compare Sides · A / Left · B / Right" (`renderCompareCohortBanner` 6466); double-click a pill → `window.prompt` rename (6499), persisted to sessionStorage and URL.
3. Cohorts are also *inferred* without URL params when exactly two models are present with equal run counts (`inferGroupedOutcomeGroups` 6202).
4. A **Sweep** tab appears (segmented control, 6334) when cohorts exist, items align and the overview metric is not numeric. `renderSweepView` (7347) shows: verdict banner (improved / regressed / within noise), five stat cards (Pass@k, Avg@k, Consistency, Reliability, Pass^k, each "from → to" with delta and ±noise band + p-value), per-metadata breakdown table (sortable, click-to-filter, "exclusive only" for list-valued metadata), outcome summary cards (Total/Improved/Regressed/Unchanged/Decisively fixed/Decisively broken/Avg Δ attempts), and an item table (pass-dot tracks per side, "Move") whose rows open the item modal (`openItemComparisonModal` 13719).
5. Filters inside Sweep: Move, Outcome, Search, Metadata key, Values multiselect (include/exclude/"Only"), "Exclusive only", Reverse sides, sortable headers. None of these are in the URL.
6. Empty states: metric without declared direction ("declares no direction…", 7356), no aligned items (7367), no items match filters (7594).
7. The item filter "Show" select also gains four cohort buckets (`A sweeps B`, `B sweeps A`, `Both pass`, `Both fail`; 7876).

### J3. Reading the Per-Run Averages table and filtering by change

1. Table (`renderMetricsTable` 10763): one column per run (or per pass when "Each pass" is chosen for repeat runs, 10777), a **Baseline** select (10788), the baseline column tagged "Baseline". Rows: each metric, Avg Latency, then trace rows (tokens, LLM calls/latency, tool calls/latency/success, retriever, trace latency, one row per agent span name, evaluator latency; 11009–11028) only when any run has `trace_stats.has_spans`.
2. Each non-baseline metric cell shows the value, "best" highlight, error-count badge for lower-is-better metrics (10932), the paired delta vs baseline with ±95 % band and verdict colour (`compareWithBaseline` 10639), and two count buttons ↑n / ↓n (items improved/regressed). Clicking a count sets `state.baselineDeltaFilter`, switches the item metric, filters the item list, renders a banner (10722) and scrolls to Item-by-Item.
3. Column labels are derived (`compareRunLabels` 10499): model · date, or the non-shared suffix of run names when all runs share a model; full name in the tooltip (tests: `tests/platform/test_compare_baseline_browser.py:49,64`).
4. `baseline` and `columns=passes` go to the URL (`syncCompareUrlState` 10711). The table is hidden when there is a single metric (9051).

### J4. Comparison Overview and category breakdown

1. Metric tabs (`#overview-metric-tabs`, 8958) select `state.selectedOverviewMetric`; a threshold slider ("Pass if ≥/≤ N %", 5–100 step 5) shows only for continuous metrics with a declared direction (9055) and re-runs stats on `change`.
2. Stats strip (`renderComparisonStats` 10044): for pass-type metrics Pass@K, Pass^K, Max@K (or Min@K), Consistency, Reliability, Avg Score, Avg Latency, Errors; for numeric/undirected metrics Min, Avg, Max, Total, Avg Latency, Errors. Each has an "i" help marker. Then "Winner Breakdown" (segmented bar per run + ties; click a segment → winner filter) and "Correct Distribution" (0..K runs correct; click → pass-rate `= n` filter). Both recompute over the **filtered** items (10055).
3. "Performance by Category" (`renderMetadataBreakdown` 9843): chips for every metadata key with 1–30 distinct values (auto-selects first 3), one card per value with per-column average, latency, change vs baseline and a score track with a baseline tick; clicking a card filters the items (domain supports AND + "exclusive" semantics, 9984–10009).

### J5. Error Distribution and Root Cause Analysis

1. `renderErrorDistributionSection` (11580) buckets Task / Metric / Trace / Analysis errors per column over the filtered items (`collectRowErrors` 11550; metric errors bucket by metric name regardless of message), with per-column counts and delta vs baseline; "Show more" on long messages; click a card → one active filter per kind (`taskErrorFilter`, `metricErrorFilter`, `traceErrorFilter`, `analysisErrorFilter`), and clicking a metric-error card switches the item metric to that metric (11709).
2. `renderRootCauseSection` (11745): metric selector (All / per metric), category cards with sub-cause lists (click → root-cause filter), and a **Failure to Fix Flow** Sankey (root cause → solution incl. "No solution assigned") drawn as absolutely positioned nodes + SVG paths (`renderSankeyDiagram` 11252, `drawSankeyPaths` 11334; redraws on `ResizeObserver`), hover highlighting. An **Auto-Analyze** button opens `QymPlayground` (overlay) for the first run (11897, `openComparePlayground` 8141). When there are no analyses the button moves to the Item-by-Item header (11794).

### J6. Item-by-Item comparison

1. Toolbar (5603–5661): search (debounced 250 ms, searches id/input/expected/outputs; server-side via `items/search` when details are lazy), **Filters** button with count badge that opens a composable rule builder (`renderFilterBuilder` 12396: AND/OR groups, fields = Outcome, Winner, Passing runs, per-run score (as %), Root cause, every metadata key (enum ≤40 values, else number or text), Approval, Has error, Edited metrics, Output text, Max latency), "Set on the page" chips listing filters created by clicking charts/cards (`comparePageFilterEntries` 12266), **Clear** with total count, "n of N items", **Display** popover (analysis metric select, sort, Raw/Rendered text mode via `QymSafe.bindTextModeToggle`, item metadata field visibility, metric metadata field visibility), **CSV** export.
2. Hidden legacy controls (still bound, 5739–5801, `hidden`): Show select, Winner select, Pass-rate op/value, Complexity/Domain/Root cause multiselects, Approval select. They are driven programmatically by chart clicks and URL restore.
3. Each item is a collapsed row (`renderItemComparisonCard` 13234): `#index`, one-line input preview, one score pill per run (or error icon). Click/Enter/Space expands (delegated handler 15013): INPUT (copy), EXPECTED OUTPUT (collapsed >300 px, "Show more"), metadata badges (complexity/domain) + generic tags, then an **Output group** (`renderCompareOutputGroup` 12977): per-run toggle buttons, one card per run/pass (pass cards grouped in a run block with a header linking to the run page `projects/{slug}/runs/{id}?pass=N&item=…`), each card: identity link, Pass/Fail or error tag, latency, **Trace** button (`data-trace-endpoint`, consumed by `trace_viewer.js`), copy, output text (JSON/Python-dict pretty printer `formatObjectAsHtml` 15290, tables, RTL), metric chips (score, edit pencil → inline input with Enter/Escape, "Edited" badge with tooltip), expanding a chip shows that metric's judge metadata side-by-side for all runs, and a **ROOT-CAUSE ISSUES** block (issues list with category/subcategory/finding/"Why this category", **Edit issues** → modal editor 14452).
4. Expanded items load their bodies lazily (`QymRunDetails`, 8007–8138: `POST api/runs/{id}/items/details` in batches, retained ≤200 rows, released when collapsed; errors show per-item "Retry").
5. Pagination (`QymUIComponents.renderPagination`, 13836; 20 per page); page change scrolls to the section top. Opening an item keeps scroll anchored (13759–13760).
6. Item modal (from Sweep rows): same card, `forceExpanded`, focus trapped with `QymUIComponents.openDialog`, Escape closes (13657–13751).
7. Writes: score edit → `POST api/runs/update_metric` (14122; 422 keeps the editor open with the message; 403 when scores locked SUBMITTED/APPROVED; 409 archived project); root-cause issues → `POST api/runs/update_root_cause` (14387); legacy category/detail/solution dropdowns (14580–15009) also post to `update_root_cause`. All update local rows and re-render (optimistic-after-response, not before).
8. Toasts: custom `showToast` (13992) bottom container, auto-dismiss 4 s.

### J7. Export

1. **CSV** (16367): ensures all filtered rows are loaded (`ensureComparisonRows … retainAll`), discovers columns (shared fields, parsed JSON keys of input/expected/output, item metadata, per-run output/status/root cause/issues JSON/scores/metric meta/latency/trace URL; 16113), shows a column-picker modal (16206) with group collapse/check-all, then builds `compare_export.csv` with BOM (16346).
2. **Export HTML** (16527): loads every row, serialises `{runs:[{run, snapshot}]}`, re-fetches the page HTML, inlines CSS/JS, injects the data script, downloads `compare_export.html`. The export opens with `IS_COMPARE_EXPORT` which hides the header user menu, export button, trace buttons, edit controls and the analyzer.

### J8. Auto-analysis of one run (analyzer page)

1. From Runs, click **Analyze** (`run-analysis-start`/`run-analysis-chip`) → `projects/{slug}/analysis?run=X[&pass=N]` → 307 → `projects/{slug}/runs/X/analyzer`.
2. `loadRun()` (5986): skeleton (`data-qym-skeleton="cards"`) → `GET api/runs/{id}?view=summary` (header only) → for repeat runs `GET api/runs/{id}/passes`; without a valid `?pass=N` a **sample picker** (`showPassPicker` 5957) is shown and the choice is written to the URL (`rememberPassInUrl` 6103) → `GET api/runs/{id}?view=compact[&pass_number=N]` + `POST api/runs/{id}/items/details` for the first 20 rows (field pickers need bodies; 6067) → `QymPlayground.init({… dedicatedPage:true, composePage: composeAnalyzerWorkspace …})` (5915) → `open()` fetches `analysis-config` (required), `analysis-documents`, `analysis-rule-versions?include_deleted=true` (`playground.js:609–690`) → `composeAnalyzerWorkspace` rebuilds the playground DOM into the page layout.
3. Tabs (`role=tablist`, 3593): **Analyze run** (hidden landing when no run), **Diagnosis categories**, **Production rules**, **Documents**; `?scope=` persists the tab (3951). The **Dashboard** tab exists in markup but `AUTO_ANALYSIS_DASHBOARD_ENABLED = false` (3691) hides it; `scope=dashboard` is rewritten to `run`.
4. Analyze run view: run card (name, task/model/dataset, sample `<select>` for repeat runs that switches in place without reload (`switchToPass` 6112), "View run" link), metrics checkbox chips (Select all / Clear; `?metric=` preselects one), **Additional instructions** card, **Targets** card (max score %, skip analyzed, allow human overwrite, target limit, "Input mapping" dialog, matched-items list with pagination), **Prompt preview** card (auto-refreshed via `POST analyze-preview`, settings popover with Production rules / Project documents / Trace evidence toggles), **Results** card (test results / progress / run-all results; shown only when it has content, via `MutationObserver` 5805), sticky footer with **Test** (`POST analyze-test`, 1–3 items, not saved) and **Analyze** (`POST analysis-jobs` → poll `GET analysis-jobs/{id}` every 600 ms → `applyAnalysisResults` 5829; **Cancel** → `POST …/cancel`). An active job is resumed on page open (`_resumeActiveAnalysis`, `playground.js:454`).
5. Diagnosis categories: category catalog editor (categories, subcategories, taxonomy description/when-to-use, approved examples count), search box, **Save changes** → `PUT api/projects/{slug}/analysis-category-catalog` with `base_revision`; validation requires description + when-to-use for every category and touched subcategory (5610–5632); 409 on stale revision. Approvals made elsewhere are detected by polling `GET analysis-config` on `focus`/`visibilitychange`/`pageshow` and diffing `category_examples` (`refreshProjectApprovals` 3860) with a "New approvals available" status when the editor is dirty.
6. Production rules: rule list with search/pagination/select/delete, version metadata badge, **Version history** opens a `QymShell.openDrawer` with an SVG lineage graph (`renderRuleGraph` 5064), Create draft / Publish / Promote actions, "Generate rules" inference (`analysis-rule-jobs` polling), auto-save of the open draft (`_saveAnalysisContext`, `playground.js:4817` → `PATCH analysis-context`).
7. Documents: upload dropzone + document library with enable toggles (`analysis-documents` GET/POST/PATCH/DELETE); read-only members see the library only.
8. Error states: `#analysis-error` with **Retry** and "Open Runs" (5900); status line `#analysis-status` (`role=status`, `aria-live=polite`) for success/warning/error messages.
9. Keyboard: tabs use roving `tabindex` but no arrow-key handling; Escape closes the input-mapping dialog and preview settings; dialogs return focus to the opener.
10. URL state: `run`, `pass`, `metric`, `scope`. Persisted: nothing in this file (`playground.js` keeps everything in memory).

### J9. Auto-Analyze from the compare page

1. Click **Auto-Analyze** in Root Cause Analysis (or in the Item-by-Item header). `openComparePlayground` (8141) loads bodies for the first 20 rows of run 0, then `QymPlayground.open()` shows the overlay (non-dedicated mode) scoped to `state.runs[0]` only (16403–16494).
2. On completion the results are merged into run 0's rows' `item_metadata.metric_analyses` and the page re-renders.

## 3. Functional inventory

### Page load / selection
- Run selection from URL `runs[]`, cohorts from `cohortA/B(+Label)`, fallback to sessionStorage, empty state — **MUST-KEEP** (every entry point depends on it).
- Pass refs `"<run_id>::pass<N>"` and client-side slicing of a repeat run into per-pass pseudo-runs (12753–12885) — **MUST-KEEP** (runs list and cohort flows emit them); candidate for a server-side `pass_number` expansion instead.
- Whole repeat run auto-expanded into its k passes (`expandPassRefIds` 12850) — **MUST-KEEP**.
- `MAX_COMPARE_RUNS = 20` server limit → 422 — **MUST-KEEP**.
- Missing/invisible runs handling (`missing_runs`) — **MUST-KEEP**.
- Alignment status (`compare_alignment_status`) disables item-level sections — **MUST-KEEP**.
- Remove a run from the comparison (card ×, min 2 remain; 9464) — **MUST-KEEP**.
- Read-only notice for archived projects (6398) and locked scores for SUBMITTED/APPROVED runs (6374) — **MUST-KEEP** (server enforces 409/403).
- "Different data" notice for different datasets/versions (6425) — **MUST-KEEP**.
- Entrance animation + skeleton crossfade (9560–9596) — **NICE**.
- Header user dropdown code (7913–7976) — **DROP-CANDIDATE** (dead: the shell owns the header now; elements don't exist).

### Run summary cards (`renderSummaries` 10325)
- Name, status badge, "Official run" tag, Items/Completed/Errors strip, Task/Dataset (identicon + version + aliases)/Model (reasoning badge)/Owner/Started/Runtime/Version/Experiment link — **MUST-KEEP**.
- Differing config/metadata "context" cells with allow-list (9620) — **NICE** (useful but heuristics are brittle).

### Per-Run Averages
- Columns per run or per pass, baseline select, URL `baseline`/`columns` — **MUST-KEEP**.
- Run-average column = mean of item means (10875; matches `services/run_means.py`) — **MUST-KEEP** (numbers must match the runs list).
- Paired delta vs baseline with 95 % band, p-value, verdict (`metricDeltaVerdict`), improved/regressed count buttons as filters — **MUST-KEEP**.
- Error-count badge on lower-is-better metrics — **MUST-KEEP**.
- Trace stat rows — **MUST-KEEP**.
- Horizontal scroll with the metric column pinned (test `:91`) — **MUST-KEEP**.

### Comparison Overview
- Metric tabs, threshold slider (per-metric, default from `metric_specs.pass_threshold`), stats strip, winner bar, correct distribution, click-to-filter — **MUST-KEEP**.
- Stats recomputed over the filtered item set — **MUST-KEEP**.
- Neutral-direction note (10150) — **MUST-KEEP**.

### Performance by Category
- Chips (auto-select 3, ≤30 values), value cards with per-column averages/latency/delta/track, click-to-filter, domain AND/exclusive logic — **NICE** (keep the feature; simplify domain semantics, see §9).

### Step latency panel
- `QymStepLatency.mount(panel, runIds, {pooled, collapsible, runLabels, cohorts})` (9524) — **MUST-KEEP** (shared module; see brief 04 for its own rewrite).

### Error Distribution / Root Cause
- Error buckets per kind/column with delta, click-to-filter, "Show more" — **MUST-KEEP**.
- Root-cause categories + sub-causes + metric selector + click-to-filter — **MUST-KEEP**.
- Sankey root cause → solution — **NICE** (solutions are rarely populated; the Sankey is hand-rolled DOM+SVG; consider a simple matrix/stacked bar).
- Auto-Analyze button → playground overlay on run 0 only — **NICE**; **DROP-CANDIDATE** in favour of a link to the analyzer page per run (open question Q4).

### Item-by-Item
- Search (debounced, server-side when lazy) — **MUST-KEEP**.
- Rule builder with field groups, percent scores, URL round-trip (`filters` JSON) — **MUST-KEEP** (tests `test_compare_filter_fields_javascript.py`).
- "Set on the page" chips with remove — **MUST-KEEP**.
- Legacy hidden selects (Show/Winner/Pass rate/Complexity/Domain/Root cause/Approval) — **DROP-CANDIDATE** as DOM; keep the *state* (they are URL params `filter`, `winner`, and `filters.*`).
- Display popover: items metric, sort (index/score/latency), Raw/Rendered, metadata field visibility, metric meta field visibility — **MUST-KEEP** (field visibility is **NICE**).
- Collapsed row with per-run score pills aligned in columns (`alignMetricColumns`) — **MUST-KEEP**.
- Lazy row hydration (`detail_mode: 'lazy'`, batches, release on collapse, retry) — **MUST-KEEP** (compare payloads for 20 runs × thousands of items are only viable compact).
- Output group: per-run visibility toggles, pass run-blocks, pass/fail/error tags, latency, trace drawer, copy, pretty printers, metric chips and per-metric side-by-side judge metadata — **MUST-KEEP**.
- Inline score edit with validation (`parseMetricScoreInput`), "Edited" badge, error placeholder — **MUST-KEEP**.
- Root-cause issues editor (multi-issue, category datalist, subcategory, finding) — **MUST-KEEP**.
- Legacy single root-cause dropdown, detail dropdown (with "delete from all items" `confirm`), solution dropdown, feedback textarea (14580–15009, 14353) — **DROP-CANDIDATE** (no longer rendered by `renderCompareOutputGroup`; only reachable via the dead `outputCells` branch at 13258 which is `false ?`).
- Item modal from Sweep — **MUST-KEEP** (or deep-link to the item row instead).
- Pagination, "n of N items", scroll anchoring — **MUST-KEEP**.
- `?item=` deep link scroll-once, Back/Forward scroll restore interplay (`RESTORING_COMPARE_VIEW` 5735) — **MUST-KEEP**.
- Keyboard: Enter/Space expand, Escape closes popovers/panel/modal/editor — **MUST-KEEP**.
- Clipboard copy with check icon feedback — **MUST-KEEP**.

### Sweep tab
- Everything in J2 — **MUST-KEEP** for cohort users; the statistics (`computeSweepNoise` 6644) are the point of the feature.
- Double-click-to-rename cohort via `window.prompt` — **NICE** (replace with an inline editable label).

### Export
- CSV with column picker — **MUST-KEEP** (move column discovery/CSV build to a worker or the server; §8).
- Export HTML self-contained — **NICE**; **DROP-CANDIDATE** for the SPA (a Vite bundle cannot be inlined the same way). The run page has a server-side `GET /api/runs/{id}/export-html` (`API/runs.py:4460`); a server-side compare export would be the analogue.

### Analyzer (analyzer.html + playground.js)
- Run header load via `view=summary`, pass picker, in-place pass switch, compact rows + first-20 details — **MUST-KEEP**.
- Tabs with `scope` param, landing when no run — **MUST-KEEP**.
- Metric chips, instructions, targets (max score/skip analyzed/human overwrite/limit), matched list + pagination, input mapping dialog — **MUST-KEEP**.
- Prompt preview (debounced `analyze-preview`) with context toggles — **MUST-KEEP**.
- Test (`analyze-test`) — **MUST-KEEP**.
- Analyze via background job + polling + resume + cancel — **MUST-KEEP** (the synchronous `/analyze` and `/analyze-stream` endpoints are for the CLI/legacy; the UI uses jobs).
- Category catalog editor + Save with revision conflict + approvals refresh — **MUST-KEEP**.
- Production rules: versions, lineage graph, draft autosave, inference jobs, compare versions dialog — **MUST-KEEP** (graph is **NICE**).
- Documents upload/library — **MUST-KEEP**.
- Root-cause dashboard (`analysis-dashboard-*`, 3618–3660, 4088–4991) — **DROP-CANDIDATE**: kill-switched off, tests assert it never loads (`test_auto_analysis_release_gate_browser.py:729`).
- `window.prompt`/`confirm` usages — **DROP-CANDIDATE** (replace with dialogs).

### Hidden behaviours
- Polling: analyzer job status every 600 ms while running (`playground.js:430`); rule-inference job polling (`:5058`); approvals refresh on focus/visibility (max once per second).
- Debounces: compare search 250 ms (15627), rule-builder inputs 150 ms (12429), preview auto-refresh 500 ms (`playground.js:6007`).
- No SSE/WebSocket on these pages (`analyze-stream` exists server-side but is unused by the UI).
- Confirmation dialogs: `confirm()` for deleting a root-cause detail (14806); playground confirms human-label overwrite (`_confirmHumanOverwrite`).
- Downloads: CSV blob, HTML blob; step-latency CSV links (`step_latency.js:871`).
- Clipboard: copy input/expected/output/metric values.
- Optimistic updates: none; rows update after the server answers (`result.row`).

## 4. Data & API contract

Auth: all calls are same-origin cookie/session requests (no explicit headers); `auth.js` `QymAuth.handle401` redirects to login; `require_ui_principal` on the server. Error envelope: FastAPI `{"detail": string}` (sometimes `{"detail": {"message": …}}` for 409 catalog conflicts); legacy endpoints return 200 with `{"error": "…"}` (`legacy_run_data`, `/passes`). Pagination: none on compare (whole compact snapshot); analyzer dashboard used `limit/offset`.

| method | path | query/body | response shape | used by |
|---|---|---|---|---|
| GET | `/api/compare` (`API/runs.py:3643`) | `files=<run_id>` repeated (≤20 distinct, pass refs must be stripped client-side), `view=compact` | `{runs: RunData[], langfuse_host: str, langfuse_project_id: str, compare_alignment_status: "aligned"\|"unalignable", unalignable_runs: [{run_name, issues: str[]}], missing_runs: [{run_id}]}`; 400 no files; 422 >20 | `loadComparisonData` 8658 |
| GET | `/api/runs/{run_id}` (`:5668`, `legacy_run_data`) | `view=full\|compact\|summary`, `pass_number` (compact only) | `RunData` (below), or `{error}` 200 | analyzer `loadRun` 6003 (`summary`), `fetchAnalyzerRows` 6069 (`compact&pass_number`) |
| GET | `/api/runs/{run_id}/passes` (`:4813`) | — | `{passes: [{pass_number, status, items_scored, items_total, …}], …}` or `{error}` | analyzer 6017 |
| POST | `/api/runs/{run_id}/items/details` (`:5381`) | `{item_ids: string[]}` | `{rows: Row[] (full, `__details_loaded: true`, no compare_item_id), missing_item_ids: string[]}` | `run_details.js:116`, analyzer 6079 |
| POST | `/api/runs/{run_id}/items/search` (`:5520`) | `{conditions: [{id, field: "content"\|"output", operator: "contains", value}], pass_number?}` | `{matches: {[id]: item_id[]}}` (per pass: `matches_by_pass`) | `run_details.js:251` |
| GET | `/api/runs/{run_id}/items/{item_id}/trace` (`:7557`) | `pass_number?` | `{item: {run_id, item_id, trace_id, trace_url, retry_count}, summary, spans: Span[], attempts: [{pass_number, attempt_number, status, latency_ms, task_started_at_ms, trace_id, trace_url, error, is_last_attempt, summary, spans}]}` | trace button `data-trace-endpoint` (13195) → `trace_viewer.js:2451` |
| POST | `/api/runs/update_metric` (`:5961`) | `{file_path: run_id, row_index: int, metric_name, new_score: number\|null, pass_number?, expected_pass_version?, reset?: bool}` | `{ok: true, row: Row}`; 400/403/404/409 (locked, not edited, archived)/422 (bad value, unknown metric) | 14122 |
| POST | `/api/runs/update_root_cause` (`:6653`) | `{item_id, run_id, metric_name?, pass_number?, expected_pass_version?, root_cause?, root_causes?, root_cause_issues?, category_taxonomy?, root_cause_detail?, root_cause_note?, solution?, solution_note?}` — only keys present are patched | `{ok: true, row: Row}`; 400 (repeat run without pass/metric), 403, 404 | 14397, 14556, 14711, 14812, 14880, 14988 |
| GET | `/v1/me` (`API/web.py:40`) | — | `{id, email, display_name, role, …}` | dead header code 7966 |
| GET | `/api/runs/step-latency` | `run_ids=a,b,c`, `pass_number?`, `rollup`, `group_by=ref`, `format=csv` | see brief 04 (`step_latency.js:266–300`) | `QymStepLatency.mount` |
| GET | `/api/runs/{run_id}/analysis-config` (`API/analysis.py:7600`) and `/api/projects/{slug}/analysis-config` (`:7808`) | — | `{llm_configured, model, llm_connections: [{id, name, llm_model, is_default, llm_api_key_set}], default_connection_id, analysis_rules, analysis_rule_version, can_manage_analysis_rules, can_operate_analyzer, can_manage_category_catalog, can_restore_analysis_rules, total_items, items_with_root_cause, items_ai_assigned, items_without_root_cause, correction_bank_size, approved_example_count, enabled_document_count, analysis_limits, analysis_defaults, default_system_prompt, default_categories, max_root_cause_categories, default_solution_categories, category_details_map, category_taxonomy, subcategory_taxonomy, category_example_counts, category_examples, existing_details, category_catalog_version, category_catalog_version_id, category_catalog}` | `playground.js:650`, analyzer 3869 |
| GET | `…/analysis-documents` (`:5371`, project `:8058`) | — | `{documents: [...]}` | `playground.js:3754` |
| POST/PATCH/DELETE | `…/analysis-documents[/{id}]` | multipart upload / `{enabled,…}` | document payloads | playground |
| GET | `…/analysis-rule-versions?include_deleted=true` (`:6632`) | — | `{versions: [{id, rules, status, parent_id, merge_parent_ids, …}], production_version_id, can_delete, can_activate}` | `playground.js:4217` |
| POST | `…/analysis-rule-versions`, `…/analysis-rule-aliases/{alias}` | version/alias bodies | version payload | playground |
| PATCH | `…/analysis-context` (`:6121`, project `:8174`) | `{analysis_rules, …}` (draft autosave) | context payload | `playground.js:4833` |
| POST | `…/analysis-rules/infer`, `…/analysis-rule-jobs`, GET `…/analysis-rule-jobs/active`, GET `…/analysis-rule-jobs/{id}`, POST `…/cancel` | infer request | job payload | playground rule inference |
| POST | `/api/runs/{run_id}/analyze-preview` (`:7250`) | `PreviewRequest {item_id, metric?, config?, category_catalog_version_id?, pass_number?, expected_pass_version?, connection_id?}` | `{messages: [...], …}` | `playground.js:6038` |
| POST | `/api/runs/{run_id}/analyze-test` (`:7335`) | `TestRequest {item_ids (1–3), metric?, config?, connection_id?, timeout_seconds, pass_number?, expected_pass_version?}` | `{results: [...]}` (not persisted) | `playground.js:6130` |
| POST | `/api/runs/{run_id}/analysis-jobs` (`:4723`) | `AnalyzeRequest {metric?, metrics?, max_score?, item_filter: all\|failed\|passed\|errors, threshold, only_unanalyzed, allow_human_overwrite, complexity?, domain?, root_cause?, item_ids?, limit?, concurrency? (1–20), timeout_seconds, config?, category_catalog_version_id?, pass_number?, expected_pass_version?, connection_id?}` | 202/200 `{job_id, run_id, status: queued\|running\|cancelling\|completed\|cancelled\|failed, progress: {phase, completed, total, errors, retries}, result?: AnalyzeResult, error?, cancel_requested, created, created_at, updated_at, completed_at}` | `playground.js:563` |
| GET | `/api/runs/{run_id}/analysis-jobs/active?pass_number=` (`:4775`) | — | `{job: JobPayload\|null}` | `playground.js:462` |
| GET | `/api/runs/{run_id}/analysis-jobs/{job_id}` (`:4798`) / POST `…/cancel` (`:4818`) | — | `JobPayload` | `playground.js:430, 480` |
| POST | `/api/runs/{run_id}/analyze` (`:4839`) | `AnalyzeRequest` | `AnalyzeResult {total_analyzed, results: [{item_id, metric_name, root_cause, root_causes, root_cause_issues: [{category, subcategory, finding, category_reason?, confidence?, solution?, …}], root_cause_detail, root_cause_reason, root_cause_note, confidence, solution, solution_note, warning, error, error_code, retry_count, …}], categories: {[category]: count}, aggregated, errors, retries, aggregation_error?}` | SDK CLI `qym analyze run` (`packages/sdk/qym/cli/_platform_api.py:238`); the same shape is `job.result` |
| POST | `/api/runs/{run_id}/analyze-stream` (`:5006`) | `AnalyzeRequest` | SSE-style stream of progress events | unused by UI |
| POST | `/api/runs/{run_id}/aggregate-analysis` (`:4622`) | `AggregateAnalysisRequest` | aggregation result | run page (brief 04) |
| GET | `/api/projects/{slug}/analysis-category-catalog` (`:7842`), `…/versions`, `…/history` | — | `{…payload, catalog: {version, id, categories, …}}` | playground |
| PUT | `/api/projects/{slug}/analysis-category-catalog` (`:7913`) | `{categories: string[], category_details_map, category_taxonomy, subcategory_taxonomy, max_root_cause_categories (1–10), base_revision}` | `{catalog: {version, …}, created: bool}`; 409 `{detail: {message, …}}` on stale `base_revision` | analyzer 5634 |
| GET | `/api/projects/{slug}/root-cause-dashboard[/occurrences\|/compare]` (`API/root_cause_dashboard.py:113,162,213`) | facet filters, `from_date`, `score_metric`, `run_id[]`, `baseline_run_id`, `limit/offset` | dashboard payload (`summary`, `facets`, `groups.by_category/by_run/by_metric`, `scores.runs`, `trends`); occurrences page; compare matrix | analyzer dashboard (disabled) |

`qym analyze summary <run_id>` (`packages/sdk/qym/cli/analyze.py:55`) does **not** call an analysis endpoint: it fetches `GET /api/runs/{run_id}` and aggregates `item_metadata.metric_analyses[*].root_cause_issues[*].category` (falling back to `root_causes`/`root_cause`, then the legacy item-level keys) into `{run_id, total_items, total_item_metrics_analyzed, total_analyzed, categories}`. That is the same aggregation `renderRootCauseSection` does client-side (11762–11787) and the same precedence as `getRowRootCauseAnalyses` (11177). The React page should get this from a server endpoint (see §8).

### `RunData` (`_build_run_data`, `API/runs.py:3730–4458`; `finalize_compare_alignment` adds `compare_alignment_status/issues`)

```
{
  run: {
    run_id, file_path (== run_id), task_name, dataset_name, dataset_version, dataset_aliases, dataset_slug,
    model_name, run_name, external_run_id, metric_names: string[],
    metric_specs: {[metric]: {score_type, direction?: "maximize"|"minimize", pass_threshold?, primary?, precision?, unit?, …}},
    config: {...run_config incl. run_name, model, git_branch, git_commit, report_k?, …},
    metadata: {...public run metadata incl. pass_revision, has_repeat_pass_context, last_completed_pass, trace_stats},
    status: "PENDING"|"RUNNING"|"COMPLETED"|"FAILED"|"STOPPED"|"SUBMITTED"|"APPROVED"|"REJECTED",
    status_reason, status_reason_label, stop_requested, owner: {id,email,display_name}|null, team_name,
    project: {id, slug, name, archived}|null, started_at, ended_at, created_at (ISO), duration_ms|null,
    git_branch, git_commit, langfuse_host, langfuse_project_id,
    trace_stats: {has_spans, avg_tokens, avg_llm_calls, avg_llm_ms, avg_tool_calls, avg_tool_ms, tool_success_rate,
                  avg_retriever_ms, avg_top_level_chain_ms, avg_evaluator_ms, outer_scope_parent_spans: [{name, avg_ms}],
                  has_reasoning, …}|null,
    samples: int, error_count, execution_error_count, execution_count, execution_success_count, last_completed_pass,
    origin: "official"|"local", experiment: {id, name, job_id, …, can_promote}|null, versioning_details: {},
    compare_alignment_status: "aligned"|"unalignable", compare_alignment_issues: string[],
    live_revision?, items_restricted?: true
  },
  snapshot: {
    rows: Row[], stats: {total, completed, in_progress, pending, failed, not_received, execution_count, …},
    metric_names, metric_specs,
    // compact only:
    detail_mode: "lazy", detail_page_size: 100,
    metric_meta_keys: {[metric]: string[]}, pass_metric_meta_keys: {[metric]: string[]}, pass_metric_meta_keys_by_pass: {[pass]: string[]},
    pass_number?: int   // when ?pass_number= was given
  }
}
```

### `Row` (full form, `API/runs.py:4208–4305`)

```
{ index, item_id, compare_item_id, compare_alignment_source: "item_id"|"fingerprint", status: "completed"|"error"|"not_received",
  error, execution_error_count, input, input_full, output, output_full, output_received?: false, expected, expected_full,
  time, latency_ms, retry_count, trace_id, trace_url, task_started_at_ms,
  metric_values: (number|string|"")[]  // positional by snapshot.metric_names
  metric_meta: {[metric]: {label?, explanation?, status?, error?, modified?: "true", original_score?, last_edit?: {by, at, from, to}, …}},
  item_metadata: {complexity?, domain? (string|list|"['a','b']"), root_cause*, solution*, metric_analyses?: {[metric]: Analysis}, analysis_error?, trace_stats?, task_started_at_ms?, …},
  review_correction_id, review_correction_status, review_corrections: {[metric]: {id, status}}, review_issue_statuses,
  trace_stats: {tokens, cost, llm_calls, tool_calls, tool_errors|malformed_tool_calls, provider_errors, noisy_reasoning, …}|null,
  // repeat runs only (else null):
  pass_scores: {[metric]: (number|null)[]}, pass_metric_meta: {[metric]: (object|null)[]}, pass_metric_analyses: {[metric]: (Analysis|null)[]},
  pass_review_issue_statuses, pass_attempts: ({pass_number, status, output, error, latency_ms, task_started_at_ms, trace_id, trace_url, retry_count, trace_stats}|null)[]
}
```

Compact form (`services/run_payloads.py:95–140`): drops `input/input_full/expected/expected_full/output/output_full`, adds `__has_output`, `__execution_error` (the output text when status is error), `output_digest` (sha256; the empty-string digest `e3b0c4…` means "no output", compare.html 8033), `input_preview` (one line), `__details_loaded: false`; `metric_meta` keeps only error/status/short scalars (explanations dropped); `pass_attempts` are compacted the same way (`compact_attempt`). The UI reshapes heavily: pass slicing, `metric_values[idx]` → score via `QymMetrics.getRowScore` (error rule: errors count 0, or are left out when lower is better), root-cause normalisation (`rootCauseIssues` 11099 handles three generations of fields), domain list parsing (`parseMetaList` 13927 parses Python-repr lists).

### Langfuse
`GET /api/compare` returns `langfuse_host` (env `LANGFUSE_HOST` or `LANGFUSE_BASE_URL`) and `langfuse_project_id` (`LANGFUSE_PROJECT_ID`), falling back to the first run's `run.langfuse_host/langfuse_project_id` (parsed from the run's `langfuse_url` metadata, `API/runs.py:4353`). The UI builds `${host}/project/${projectId}/traces/${traceId}` (`buildLangfuseTraceUrl` 8277, per-run fallback 8284) only to fill `data-trace-url` on the Trace button (13189); `row.trace_url` wins when present. `trace_viewer.js:2669` reads it and renders the external link in the drawer header. The comment at 5834 says external Langfuse actions are otherwise no longer rendered; `docs/internal/DATASETS_AND_LANGFUSE_REMOVAL_PROPOSAL.md` proposes dropping Langfuse entirely (open question Q6).

## 5. Shared dependencies

| primitive | file | used for |
|---|---|---|
| `QymSafe.escapeHtml/textDirAttrs/isRTL/textBlock/bindTextModeToggle` | `D/qym_safe.js` | every string, RTL detection, Raw/Rendered switch (15602) |
| `QymAuth.handle401/maybePromptBootstrapAdmin` | `D/auth.js` | dead header code only |
| `QymShell.pageSignal/replaceUrlQuery/navigateTo/openDrawer/liftSkeleton/arrive/identiconHTML/datasetVersionInline/datasetAliasTags/openConfirmDialog/isProjectArchived` | `D/shell.js:2895–2941` | listener cleanup on SPA unmount, URL view state, skeleton crossfade, dataset identicon, version-history drawer (analyzer 5352), route parsing (`/compare` under a project slug, `shell.js:164,199`) |
| `QymMetrics.*` (`D/metrics.js:1387–1441`) | `getRowScore`, `rowMetricPasses`, `metricPasses`, `errorsLeftOut`, `isErrorRow/hasTaskError/hasMetricError/isMetricErrorMeta`, `isInternalMetaKey`, `metricMetaDisplayKey`, `parseScoreValue`, `parseMetricScoreInput`, `indexRowsById`, `detectMetricType`, `metricTypeFromSpec`, `metricDirection`, `metricDirectionLabel`, `defaultMetricName`, `mergeMetricNames`, `bestMetricIndexes`, `defaultPassThreshold`, `metricDeltaVerdict`, `formatPercent/formatLatency/formatMetricValue/formatMetricObservation/formatMetricValueSmart/formatNumericValue`, `getMetricColorClass`, `rowMetricErrorCounts`, `calculateGroupedCohortComparison` (items with `leftPasses/rightPasses/leftScores/rightScores/leftAttempts/rightAttempts/move`, `k`, `leftRunCount`) | all scoring semantics (C008 direction rules). compare.html *adds* `QymMetrics.calculateGroupedOutcomeBuckets` when missing (6085) — a shim other pages may rely on. Port `metrics.js` to a typed `frontend/src/lib/metrics.ts` first (brief 02/04). |
| `QymRunDetails.create({runId, apiUrl, passNumber, transformRow})` → `{ensureRows, ensureSearch, matches, releaseExcept, adoptRow, stop}` | `D/run_details.js:46–315` | lazy hydration/search of compact rows; shares in-flight requests across loaders |
| `QymTraceViewer.init({exportMode})/restoreFromUrl` + delegated click on `.trace-drawer-btn[data-trace-endpoint][data-trace-url][data-trace-id][data-trace-item-label]` | `D/trace_viewer.js:2607–2707` | trace drawer (brief 04 owns the rewrite) |
| `QymStepLatency.mount(el, runIds, opts)` | `D/step_latency.js:1488` | pooled step-latency card with cohort lanes |
| `QymPlayground` | `D/playground.js` | the analyzer workspace (overlay on compare, page on analyzer) |
| `QymUIComponents.renderErrorState/renderPagination/openDialog/releaseDialog/alignMetricColumns/enhanceSelect` | `D/ui_components.js:1494–1506` | error panels, pager, focus-trapped dialogs, score-pill column alignment, custom selects |
| `qym_table.js` | loaded by analyzer.html | not referenced by analyzer.html's own script (playground may use it for rule tables) |
| CSS: `dashboard.css` tokens, `shell.css`, `ui_components.css` (`.qym-segmented`, `.qym-chip`, `.qym-badge`, `.qym-tag`, `.qym-stat-strip`, `.qym-control/.qym-select/.qym-search`, `.qym-dropdown`, `.qym-inline-action`, `.qym-icon-action`, `.qym-help-marker/.qym-help-tooltip`, `.qdt-table`, `.qym-pagination`, `.qym-output-card/.qym-output-grid/.qym-metric-compare`, `.qym-item-*`) | | |

Defined here and consumed elsewhere: `window.sortMetaTable` (15051, used by inline `onclick` in meta tables), the `QymMetrics.calculateGroupedOutcomeBuckets` shim, and the `.sweep-*` / `.pg-*` class prefixes named in `docs/DESIGN_LANGUAGE.md` §4. Nothing else exports.

## 6. Design-token usage

- Tokens used (compare.html `<style>`, counts): `--text-muted` 100, `--space-sm` 96, `--font-xs` 82 (badges/pills, many legitimately), `--font-sm` 73, `--border-default` 59, `--text-primary` 58, `--space-md` 57, `--font-mono` 52, `--accent-primary` 48, `--bg-surface` 43, `--text-secondary` 40, `--border-subtle` 34, `--bg-elevated` 31, `--font-base` 21, `--error` 18, `--success` 13, `--font-md` 12, `--warning` 9, `--text-dim` 8, `--score-1..5`, `--font-title/xl/lg`, `--control-radius/--control-height`, `--badge-height`, `--radius-md`, `--enter-ease`. analyzer.html: `--space-*` dominant, `--font-sm` 82, `--text-muted` 73, `--chart-1..5` (dashboard charts), `--page-constrained-width`, `--radius-pill`, `--transition-fast`.
- Type roles: section titles `.section-title` → `--font-lg` + `--font-sm` description (matches §1 "Major analytical sections"); stat values use `.qym-stat-strip__value`; badges `--font-xs`.
- Hardcoded colours that must become tokens or component styles: compare.html CSS has 25 hex literals (`#f87171`×9, `#60a5fa`×6, `#e07a5f`×5, `#c084fc`, `#34d399`, `#fbbf24`, `#00e6b8`, …, dark greys `#222a36/#1f2430`); JS defines run palette `COLORS` (5760: `#00d4aa #00a8ff #a855f7 #f472b6 #fbbf24 #60a5fa #34d399 #fb923c`), `ROOT_CAUSE_COLORS` (5785), `SOLUTION_COLORS` (5810) and concatenates alpha suffixes (`color + '40'`, allowed by rule 8 only with a comment). The run palette should become `--chart-1..8` (or a new `--run-1..8` token set) and root-cause/solution colours a deterministic hash → chart token mapping. analyzer.html has no hex literals.
- Area-specific CSS that should become component styles: `.compare-run-card`, `.metrics-table` (sticky first column, grouped pass header row `--metrics-head-row`), `.stats-row/.stat-box` (duplicate of `qym-stat-strip`), `.win-loss-bar`, `.distribution-bar`, `.breakdown-card/.cmp-run-lines/.category-pass-track`, `.error-card`, `.rc-category-pill`, `.sankey-*`, `.item-comparison-row/.item-header/.item-agg-pill`, `.qym-output-*` overrides, `.metric-compare-row/.metric-edit-controls`, `.compare-issue*`, `.compare-issues-editor`, `.root-cause-dropdown`, `.sweep-*` (verdict, stat cards, pass dots, tables), `.toast*` (should use the shared toast), `.export-modal`, `.item-comparison-modal`, `.compare-skeleton`, `.compare-cohort-*`, `.filter-panel/.fb-*` (rule builder, shared with run detail — port once), `.analysis-*` (hero, tabs, run card, target/preview/results cards, mapping dialog, version column/graph, diagnosis workspace, pass picker) and `.pg-*` (playground sections).
- Breakpoints present: compare 900/760/640 px; analyzer 900/720 px; `prefers-reduced-motion` handled for the entrance animation (3339).
- Sanctioned exceptions: none apply (compare and analyzer are dashboard pages). The glyph allowlist in `tests/platform/test_design_language.py` covers the `∅` 48 px empty icon (5477), `!` 32 px alignment icon (8207) and `×` buttons; any new pixel glyph needs the allowlist updated.

## 7. UX pain points observed

1. **Everything is recomputed on every interaction.** `renderItems()` re-runs `getFilteredItems()` (full scan of every item × run × filter), then `renderMetadataBreakdown`, `renderErrorDistributionSection`, `renderRootCauseSection`, `renderComparisonStats` (which re-runs `calculateComparisonStatsForMetric`) and re-renders the whole page of cards with `innerHTML` (13753–13868). With 20 runs × 2 000 items this is hundreds of ms per keystroke (search is debounced, rule inputs 150 ms).
2. **Duplicate filter UIs.** The rule builder, the "page filters" chips, and the hidden legacy selects express the same state three ways; `countActiveFilters` vs `countExpandedItemFilters` differ only by search/sort (15450–15488). Users cannot tell whether a chart click added a rule or a page filter.
3. **Domain filter semantics are opaque**: include = AND across selected values, click again = "exclusive" (sole value), checkbox dropdown flips into exclude mode when starting from "all" (15750–15772). Different from every other category.
4. **Sweep filters are invisible to the URL** and reset on reload; cohort rename uses `window.prompt`.
5. **Item cards are heavy**: expanded output grids with 6+ runs/passes become 1-column-per-pass grids that do not fit; `alignOutputHeights` forces equal `min-height` by measuring `scrollHeight` (14032) causing layout thrash.
6. **Scroll host** is `.compare-container` (12726), not the window: deep links, modals and `scrollIntoView` juggle `getItemsGridTop/restoreItemsGridTop`; the Back/Forward restore flag (`RESTORING_COMPARE_VIEW`) is fragile.
7. **Accessibility**: collapsed rows are `div[role=button]` with the whole row clickable (fine) but inner buttons stop propagation inconsistently; category chips/cards are `button`/`role=button` with `aria-pressed` (good); the Sankey has no keyboard interaction (hover only); custom dropdowns (`.multi-select-dropdown`) are divs with checkboxes and close on outside click, no arrow keys; tooltips are `.qym-help-marker` buttons with `aria-expanded` but the tooltip text is injected HTML; toasts use `role=status` on the container only; colour is the only signal for improved/regressed in many places (delta pills have a sign, cards do not); the threshold slider has `aria-label` but the output isn't announced on change; several `title`-only labels (remove-run ×, copy buttons have `title` but no `aria-label`).
8. **Analyzer tabs** manage `tabindex` but have no Arrow/Home/End handling; `aria-controls` points at panels that `composeAnalyzerWorkspace` renames at runtime, and the dashboard tab stays in the DOM `hidden`.
9. **Analyzer composition is DOM surgery**: analyzer.html moves nodes that `playground.js` created (by id) into new cards (5208–5827). Any change in playground markup silently breaks the page; features like the results card rely on `MutationObserver`s to decide visibility.
10. **Two copies of the analysis-result merge** (compare 16452 and analyzer 5829) with different field sets; three copies of root-cause normalisation (compare, run page, CLI).
11. **Sample picker friction** for repeat runs: a run with `samples>1` cannot be analysed as a whole; the picker is a full-page interstitial.
12. **Export HTML** re-fetches the page and regex-rewrites `<script src>` tags (16508) — slow for big comparisons and impossible to reproduce with hashed Vite bundles.
13. **Legacy dead code**: `outputCells = false ? …` (13258–13459), header user menu, root-cause/solution/feedback dropdowns, hidden selects — about 1 500 lines that still run event wiring.
14. **Errors are console-only** in several save paths (`saveRootCause`, `saveSolution`, `saveFeedback` log and return without a toast).
15. `window.prompt`/`confirm` dialogs; `alert()` in the models-view compare link.

## 8. Migration notes

### Proposed React component tree and routes

Routes (React Router, under `/app`; keep old query params):

- `/app/compare` and `/app/projects/:slug/compare` — `ComparePage`
- `/app/projects/:slug/analysis` — `AnalyzerPage` (project scope: landing + Categories/Rules/Documents)
- `/app/projects/:slug/runs/:runId/analyzer` — `AnalyzerPage` (run scope)
- `/app/run/:runId/analyzer` — redirect to the project route after resolving the run

```
ComparePage
  useCompareSelection()            // URL params ↔ runs/cohorts/baseline/columns (replaces sessionStorage fallback with a redirect from the runs list)
  useCompareData(runIds)           // TanStack: GET /api/compare, expands pass refs
  CompareStateProvider             // filters, metric selections, thresholds, page, expanded ids (URL-synced)
  CompareHeader                    // title, subtitle, Export menu (CSV, HTML?)
  CompareNotices                   // read-only, different-data, missing-runs toast, alignment warning
  CompareModeTabs                  // Compare | Sweep
  CohortBanner                     // editable labels (inline input, no prompt)
  RunSummaryCards
    RunSummaryCard                 // status, origin, stats strip, meta grid, context cells, remove
  PerRunAveragesTable
    BaselineSelect, PassColumnsToggle
    MetricRow → MetricCell (value, best, errors, DeltaBadge, DeltaCountButtons)
    LatencyRow, TraceStatRows
  ComparisonOverview
    MetricTabs, ThresholdSlider
    StatStrip (StatTile with HelpMarker)
    WinnerBar, CorrectDistributionBar
  CategoryBreakdown
    CategoryChipBar
    CategoryValueCard → RunLines (ScoreTrack)
  StepLatencyPanel                 // wraps the shared step-latency feature (brief 04)
  ErrorDistribution
    ErrorGroup → ErrorCard
  RootCauseSection
    MetricScopeSelect
    RootCauseCategoryCard
    FailureToFixFlow (Sankey, optional)
  ItemComparison
    ItemToolbar (SearchInput, FiltersButton+Badge, ClearButton, ItemCount, DisplayMenu, CsvExportButton)
    FilterBuilder (shared with run detail: RuleGroup, RuleCondition, PageFilterChips)
    ItemList (virtualised)
      ItemRow (collapsed: index, preview, ScorePillGrid)
      ItemDetail (lazy)
        InputBlock, ExpectedBlock, MetadataBadges
        OutputGroup
          RunToggleBar
          RunBlock → OutputCard (identity link, VerdictTag, latency, TraceButton, CopyButton, PrettyText, MetricChips → ScoreEditor, RootCauseIssues → IssuesEditorDialog)
          MetricDetailPanel (side-by-side judge metadata)
    Pagination
    BaselineDeltaBanner
  SweepView
    SweepVerdict, SweepStatCards, SweepFilters, SweepBreakdownTable, SweepOutcomeCards, SweepItemTable
  ItemComparisonDialog
  CsvExportDialog

AnalyzerPage
  useAnalyzerRoute()               // slug, runId, pass, metric, scope
  useRunSummary(runId), usePasses(runId), useCompactRows(runId, pass)
  useAnalysisConfig(scope), useAnalysisDocuments, useRuleVersions
  AnalyzerHero (title, project meta, Tabs with arrow keys)
  RunLanding | PassPicker
  AnalyzeRunView
    RunCard (SampleSelect, metrics chips)
    InstructionsCard
    TargetsCard (MaxScore, SkipAnalyzed, HumanOverwrite, Limit, InputMappingDialog, MatchedTargetsList)
    PromptPreviewCard (ContextSettingsPopover)
    ResultsCard (TestResults, JobProgress, RunAllResults)
    AnalyzeFooter (Test, Analyze, Cancel)
  DiagnosisCategoriesView (CatalogEditor, Search, SaveBar with revision/conflict)
  ProductionRulesView (RuleToolbar, RuleList, VersionHistoryDrawer → RuleLineageGraph, InferenceProgressCard, ContextFooter)
  DocumentsView (UploadCard, DocumentLibrary)
```

`AnalyzerPage` should be built *with* the playground owner (brief 08) — the run page also opens the playground as an overlay — as a shared `features/analysis/` package: `AnalysisWorkspace` component + hooks, with `AnalyzerPage` and `AnalysisOverlay` as two shells.

### State placement

- **URL**: compare — `runs[]`, `cohortA[]`, `cohortB[]`, `cohortALabel`, `cohortBLabel`, `baseline`, `columns`, `metric`, `filter`, `winner`, `q`, `sort`, `page`, `tab`, `item`, `filters` (keep the JSON format; `tests/platform/test_compare_filter_fields_javascript.py:152` asserts the round-trip), `trace`; add the Sweep filters (`sweepMove`, `sweepOutcome`, `sweepQ`, `sweepKey`, `sweepValues`, `sweepReverse`) and the overview metric if it differs from the item metric. Analyzer — `run`, `pass`, `metric`, `scope`.
- **Local (component/zustand)**: expanded item ids, hidden run toggles per item, compared metric per item, filter-builder open, display popover open, metadata/metric field visibility (could go to `localStorage` per project), threshold overrides (per metric; consider URL `thr=metric:0.7`), cohort label overrides when inferred.
- **Server cache (TanStack Query keys)**: `['compare', sortedRunIds, 'compact']`; `['run', runId, 'details', itemIdsHash]` (row hydration, keep an LRU like `run_details.js`); `['run', runId, 'search', field, value]`; `['run', runId, 'trace', itemId, pass]`; `['run', runId, 'summary']`, `['run', runId, 'passes']`, `['run', runId, 'compact', pass]`; `['analysis', scope, 'config']`, `['analysis', scope, 'documents']`, `['analysis', scope, 'rule-versions']`, `['analysis', runId, 'job', jobId]` (refetchInterval 600 ms while running), `['analysis', runId, 'active-job', pass]`, `['project', slug, 'category-catalog']`. Mutations: `updateMetric`, `updateRootCause` (invalidate the compare query *rows* by patching the cache with `result.row` rather than refetching 20 runs), `saveCategoryCatalog` (409 → show conflict, refetch), `startAnalysisJob`, `cancelAnalysisJob`.
- **sessionStorage** `compareRuns/compareCohorts`: keep *reading* them for one release (the runs list and experiment matrix still write them) but treat the URL as the source of truth; never write them from the new page.

### Heavy computations → web worker or server

Measured hot spots are all in `compare.html`; all are pure functions over `state.runs`:

| computation | lines | move to |
|---|---|---|
| `calculateComparisonStatsForMetric` (wins/ties/pass@K/pass^K/max@K/consistency/reliability/agreement/distribution/biggestWins) per metric and per filtered set | 9180–9429 | **worker** (input: compact rows + metric specs + thresholds + item-id subset) |
| `getFilteredItems` (search, category, rules, winner, pass-rate, baseline-delta, error filters, sorting) | 12486–12724 | **worker** (return item ids + per-item context); keep a main-thread fast path for <500 items |
| `compareColumnItemScores` + `compareWithBaseline` (paired mean, SE, z-band, p-value) and the run-average column | 10598–10665, 10846–10882 | **server** (`GET /api/compare/metrics?files=…&baseline=…&columns=run|passes[&item_ids…]` returning averages, paired deltas, bands, counts) — these must equal `services/run_means.py` and `qym.core.reducers.noise_report`; computing them server-side removes a correctness-drift risk |
| Sweep: `calculateGroupedCohortComparison`, `summarizeSweepItems`, `computeSweepNoise` (binomial LUTs, A–S erf) | `metrics.js:725+`, 6575–6720, 7075–7200 | **server** ideally (the SDK already has `noise_report`), otherwise **worker** |
| Error bucketing, root-cause aggregation, category groups | 11550–11616, 11762–11787, 9783–9819 | worker (or server for root causes: expose the `qym analyze summary` aggregation as `GET /api/runs/{id}/root-cause-summary`, and a multi-run variant for compare) |
| CSV column discovery + row serialisation | 16113–16365 | **server** `GET /api/compare/export.csv?files=…&columns=…&filters=…` (streams, no need to hydrate 2 000 × 20 rows in the browser) |
| Export HTML | 16527 | server endpoint analogous to `/api/runs/{id}/export-html`, or drop (Q7) |
| `detectMetricTypes` | 9126 | cheap, but should come from `metric_specs` server-side for all runs; keep the inference only for `score_type: legacy` |
| Pretty printers (`formatObjectAsHtml`, `parsePythonDict`) | 15096–15447 | main thread but memoised per row; prefer a `JsonViewer` primitive (brief 02) and ask the server for JSON-parsed bodies |

### Backend changes this area will likely need

1. SPA fallback for `/app/compare`, `/app/projects/{slug}/compare`, `/app/projects/{slug}/analysis`, `/app/projects/{slug}/runs/{id}/analyzer` (+ `/app/run/{id}/analyzer` redirect) — foundation (brief 01) provides the generic fallback; the analyzer canonical 307 redirects (`API/runs.py:1516–1620`) need `/app`-aware equivalents or move client-side.
2. `GET /api/compare` should accept pass refs (`files=<id>::pass3`) and return already-sliced per-pass runs (`scope_row_to_pass` + `pass_number` exist for `legacy_run_data`), removing `sliceRunToPass`/`expandPassRefs` from the client; and should include `compare_item_id` for subsets (today `items/details` strips it, 5395).
3. New aggregate endpoints listed above (compare metrics/deltas, root-cause summary, CSV export). Add pytest in `tests/platform/`.
4. CORS for the Vite dev server (foundation).
5. `update_metric`/`update_root_cause` already return the updated `row`; keep. Consider a `GET /api/compare/row?files=…&item_id=` to refresh one aligned item across runs after an edit.
6. The `/v1/me` call is not needed (shell provides the user).

### Risks / gotchas

- Payload size: compact snapshot for 20 runs × N items, each row ~1–2 KB → tens of MB; cap or paginate items server-side, keep rows in a worker, and virtualise the list (today 20/page but every row is still in memory).
- `compare_item_id` alignment uses fingerprints when item ids are missing (`compare_alignment_source`); duplicates get occurrence suffixes computed over the *complete* index — never recompute from a subset.
- Pass refs and pass columns: `columns=passes`, baseline keys like `<id>::pass2`, `expected_pass_version` (`run.metadata.pass_revision`) must be sent on every pass-scoped write or the server answers 409.
- Score edit validation differs for reduced (repeat-run aggregate) vs pass scores (`parseMetricScoreInput(…, {reduced})`, 14297).
- Lower-is-better metrics: errors are *left out* of means and never pass; UI must reuse `QymMetrics` semantics or numbers diverge from the runs list (tests `test_compare_error_counts.py`).
- Race conditions: `comparisonRenderVersion` guards lazy loads vs re-renders; analysis job polling uses a generation counter and must stop on unmount; approvals refresh must not clobber a dirty catalog editor; pass switch is blocked while a job runs.
- Scroll restoration on Back/Forward (shell saves offsets) vs `?item=` auto-scroll; the new app must not scroll when `history.state.qymScroll` exists.
- `?filters=` JSON may reference metadata keys of runs no longer in the comparison; validate as 8405–8468 does and drop silently.
- Private test sets: `items_restricted` runs return redacted bodies; the Trace and details endpoints redact too; the UI must not show "undefined".
- Export mode flag (`__QYM_COMPARE_EXPORT__`) disabled writes/analyzer/trace; if HTML export is kept, the SPA needs a "static data" boot path.
- `QymStepLatency` and `QymTraceViewer` are being rewritten by brief 04 — coordinate on the component API.

### Suggested Playwright scenarios

1. Select 3 runs on Runs → Compare: URL has 3 `runs=`, 3 summary cards, Per-Run Averages has 3 columns and the first is tagged Baseline; change baseline → `?baseline=` updates and deltas re-sign.
2. Open `compare?runs=a&runs=b&metric=m2&filter=errors&q=foo&sort=score_desc&page=2&item=X&filters={…}`: every control reflects the params; `item=X` is expanded and scrolled into view once; reload keeps it.
3. Click ↑n on a delta cell → banner appears, item list filtered to n items, URL `filters` contains `baseline`; Clear removes it and the table button is unpressed.
4. Threshold slider from 80 to 60 on a continuous metric → Pass@K changes; click "Correct Distribution" segment 1 → pass-rate chip "Passing runs = 1 of K" appears in the Filters panel.
5. Expand an item in a comparison with lazy details → bodies load (details POST), Trace button opens the drawer, copy button copies, edit a score (Enter) → PATCH `update_metric` and the pill updates; a 422 keeps the editor open with the message.
6. Edit root-cause issues: add two issues, save without a category → validation message; save valid → `update_root_cause` called with `root_cause_issues` and the card shows "Issue 1/2".
7. Cohort flow: lock Cohort A (2 runs), pick Cohort B (2 runs) → compare opens with `cohortA/cohortB`, Sweep tab visible; verdict banner and 5 stat cards render; click "Decisively Fixed" → outcome filter; click a sweep row → item dialog with focus trap and Escape.
8. Remove a run from a 3-run comparison → 2 cards remain, URL and sessionStorage updated; remove is hidden at 2 runs.
9. CSV export with a filter active → column dialog, uncheck a group, Export → downloaded file has the expected header and row count.
10. Analyzer: open `projects/p/analysis?run=R` → 307 to `/runs/R/analyzer`; for a repeat run the sample picker shows, choosing sample 2 sets `?pass=2`, Analyze button posts `analysis-jobs` with `pass_number: 2` and the progress bar reaches completed; reloading mid-job resumes via `analysis-jobs/active`.
11. Analyzer catalog: edit a category description, Save → PUT with `base_revision`; simulate a stale revision → 409 conflict surfaced; approvals change in another tab → "New approvals available" status while dirty.
12. Keyboard-only: Tab through compare toolbar, open Filters with Enter, Escape closes and returns focus to the Filters button; analyzer tabs reachable and switchable.

## 9. Open questions

- **Q1 – Pass refs in the URL.** Keep `"<run_id>::pass<N>"` as the public ref format (the runs list, experiment matrix and shared links emit it) or introduce `pass=` structured params? Recommendation: keep the string format, parse it in one helper, and ask the server to slice.
- **Q2 – Baseline semantics for cohorts.** Today the baseline defaults to the first column (cohort A's first pass). Should the baseline be the whole cohort A run-average when `columns=run`? The code makes "run" the default and pass refs collapse into one column (10560); confirm with Sweep's A→B direction (B − A).
- **Q3 – Domain filter semantics.** AND + "exclusive" + exclude mode are unique to `domain`/`patterns` (list-valued keys). Simplify to the generic enum "is any of / is none of" rule plus an explicit "only this value" toggle, or keep?
- **Q4 – Auto-Analyze on compare.** It analyses run 0 only, in an overlay, with a different result merge than the analyzer page. Replace with per-run links to the analyzer (`projects/{slug}/runs/{id}/analyzer?metric=…`)? Recommended: drop the overlay from compare.
- **Q5 – Hidden legacy filter controls and dropdown editors.** Root-cause category/detail/solution dropdowns and the feedback textarea are unreachable in the current DOM (dead branch at 13258). Drop them (and the `solution`/`solution_note` write paths) or keep solution assignment somewhere? If dropped, the Sankey loses its right column.
- **Q6 – Langfuse links.** `DATASETS_AND_LANGFUSE_REMOVAL_PROPOSAL.md` proposes removing Langfuse; `trace_url`/`langfuse_host` plumbing is tiny. Keep the external link in the trace drawer header only (via `row.trace_url`), or drop entirely?
- **Q7 – Export HTML.** The self-contained export cannot be reproduced by regex-inlining a Vite bundle. Options: server-side export using the built bundle, a "print to PDF"-friendly view, or drop. The run page's server-side exporter is the precedent.
- **Q8 – Sweep tab visibility rule.** It needs (a) cohorts, (b) aligned items, (c) non-numeric overview metric with a declared direction. Should numeric metrics get an Avg@k-only Sweep (the noise code already handles `avgAtK`)?
- **Q9 – Threshold persistence.** Per-metric thresholds live in memory only; the overview and the item list share them. Put them in the URL (shareable) or `localStorage` per project?
- **Q10 – Analyzer dashboard.** ~900 lines + 3 endpoints behind `AUTO_ANALYSIS_DASHBOARD_ENABLED=false`, with tests asserting it never loads. Delete in the migration and keep the endpoints for a future feature, or port now behind a flag?
- **Q11 – Repeat-run analysis granularity.** Analysis is per sample (pass picker mandatory). Is a "whole run" (aggregate) analysis target wanted, or is the aggregate produced only by `aggregate-analysis` on the run page?
- **Q12 – Field visibility settings** (item/metric metadata fields) — per session, per project (localStorage) or dropped in favour of a single "Show all metadata" toggle?
- **Q13 – Shared filter builder.** Compare's rule builder duplicates run detail's (`compareFilterFieldDefs` vs run.html). Which brief owns the shared `FilterBuilder` primitive (02 vs 04)? Compare adds the Comparison/Scores groups and the "any run matches" semantics for metadata numbers (12160).
