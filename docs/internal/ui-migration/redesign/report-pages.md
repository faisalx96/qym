# Redesign brief: report-style Run detail, Compare and Cohort pages

Area: `report-pages`. Investigated 2026-10-13 against the legacy UI (worktree `qym-wt-legacy`, port 8823) and the React app (main checkout, platform 8824, Vite 5824), same seeded data (`frontend/scripts/seed-run-detail.ts`, `seed-compare.ts`), Playwright at 1440 px. Screenshots are in the orchestrator scratchpad `rp/` (`leg-run-*`, `rea-run-*`, `leg-cmp-*`, `rea-cmp-*`, `leg-coh-*`, `rea-coh-*`, `leg-sweep-*`, `rea-sweep-*`). No product code was changed.

Paths: `dash/` = `packages/platform/qym_platform/_static/dashboard/` in the legacy worktree; `RD/` = `frontend/src/features/run-detail/`; `CMP/` = `frontend/src/features/compare/`.

## 1. Feedback point and reading

> run details, compare, and cohort pages became too simple; they previously were more in a report style, which is the intended user experience. When items are chosen, keep the sidebar for quick filters, but otherwise they should be in report style where each section has a full view in the page.

Reading, grounded in the legacy pages: the legacy run page and compare page are one long scrolling document. Every analytic topic (Overview, Latency and traces, Deep analysis, Categories, Errors, Root cause, Items on the run page; Per-Run Averages, Comparison Overview, Performance by Category, Error Distribution, Root Cause, Item-by-Item on compare) is a full-width block with its own `h2/h3` title, one description line and full-size charts and cards (3-up metric cards, 2-up latency panels, 4-column category cards). A reader scrolls the whole analysis top to bottom and never has to pick a tab. The legacy run page has no sidebar of its own: the only filter surface is a sticky nav with a Filters dropdown that scopes every section.

The React pages (UX_DECISION "variant C, items-first") invert that: the item table is the page and every analytic topic is a tab inside a 380 px (run) or 24-34 rem (compare) side panel, so each chart is squeezed into a narrow column and only one topic is visible at a time. That is what the reviewer calls "too simple". The target is therefore: report body with every section stacked at full width; a quick-filter sidebar that exists only while a subset of items has been chosen (a filter scope is active), and disappears otherwise.

### What "cohort" refers to (conclusion)

Grep of `dash/` for "cohort": `index.html:155` (`#cohort-view` button on the Runs list selection bar: "Cohort" then "Open Cohort"/"Cancel Cohort", `dashboard.js:5593-5700`, Cohort A is locked, Cohort B must hold the same number of executions) and `compare.html` (`cohortA`/`cohortB` URL params, `#compare-cohort-banner`, `#compare-mode-tabs` Compare | Sweep, `#compare-sweep-panel`, `calculateGroupedCohortComparison` in `metrics.js:728`). There is no separate cohort page. **"Cohort page" = the Compare page opened in cohort mode** (`/compare?cohortA=..&cohortB=..`), which adds the "Compare sides" banner and the Sweep view (verdict, 5 cohort metric cards with noise, cohort metrics by metadata key, outcome summary, item table). React counterpart: `CMP/ComparePage.tsx` (SegmentedControl Compare | Sweep, `SelectionBar.tsx` for the sides) and `CMP/components/sweep/SweepView.tsx`. Verified by screenshots: the Sweep view is already a stacked report in both apps (React `rea-sweep-0.png` matches `leg-sweep-0.png` section for section), so for cohorts the gap is the **Compare tab in cohort mode** (same item-first + side-panel layout as plain compare, plus the cohort banner shrunk to a single line) and the missing quick-filter sidebar for the sweep filters. Treat "cohort" as covered by the Compare work plus Task C5.

## 2. Legacy page anatomy

### 2.1 Run detail (`dash/run.html`, markup 6282-6481, CSS 25-6275, JS 6482-17257)

Page: `.run-container` (27) is the scroller, `padding: var(--space-lg)`, full width of the shell content (no max-width). Everything is one column.

| # | Section (id) | Layout | Content | Heading |
|---|---|---|---|---|
| 0 | Hero `#run-summary` | full-width card with a gradient top rule | eyebrow "RUN DETAIL", mono run id h1, status badge, Export HTML, pager "3 of 4"; **meta grid always visible** (Task, Dataset, Model, Owner, Project, Started, Runtime); execution-context grid (config/metadata key values) | n/a |
| 1 | Review history `#review-history-section` | full-width timeline under the hero, only if the run was submitted | submit/approve/reject events | own |
| 2 | Sticky section nav `#run-section-nav` (5872, `position: sticky`, blurred background) | one bar | jump links Overview, Latency and traces, Deep analysis, Categories, Errors [20], Items [240]; right side "Filters (N)" + "Clear (N)" + back to top; name + status badge appear once stuck | n/a |
| 3 | Experiment panel / Versioning details | full-width cards | official-run provenance; key/value `dl` | card titles |
| 4 | **Overview** `#overview-primary-section` | `.run-section-head` (6034: flex, `margin: 1.5*xl 0 md`, `padding-top: lg`, 1px top hairline, `--font-xl` title + muted description + StatStrip aside) then a 3-up grid of metric cards (gauge, mean, error note, histogram / split bar / min-avg-max-total). Each card ~400 x 295 px at 1440 | Items / Completed / Errors / Not received strip in the aside | "Overview" |
| 4b | **Repeat run analysis** `#samples-analysis-section` (repeat runs only) | full-width block | metric tabs, threshold slider, pass@k curve, per-pass table, distribution | own |
| 5 | **Latency and traces** `#latency-traces-panel` (moved by `renderOverview`) | two sub-heads with a green bar: "Response time" (2 columns: latency histogram with p50/p90/p95 pins and drag brush; quality vs latency scatter), "Inside the traces" (full-width time budget bar, 4 tiles LLM/Tools/Retrieval/Eval, steps interval plot) | | "Latency and traces" + counts aside ("237 items - 61 traces") |
| 6 | **Deep analysis** `#overview-deep-section` | 2 columns: correlation matrix, relationship scatter with X/Y selects | | "Deep analysis" |
| 7 | **Categories** `#metadata-breakdown` | full-width panel, chip bar of metadata keys, Cards/Compare toggle, a row of cards per key (average, items, latency, baseline track) | | "Performance by category" |
| 8 | **Errors** `#error-distribution-section` | full-width panel; Task / Metric / Trace / Analysis groups of cards grouped by message with counts | | "Errors" |
| 9 | **Root cause** `#root-cause-section` | only when analyses exist; category cards, Sankey, aggregate button | | "Root cause analysis" |
| 10 | **Items** `#run-section-items` (6392) | section head with Auto-Analyze aside; one bordered panel: toolbar (search, "240 of 240 items", Display popover, CSV), filter banner, 20 item cards per page, pagination | | "Items" |

Drill-down and filters (JS refs from brief 04 J3/J6/J7, confirmed in the page):
- Charts are filter sources: histogram bar -> `scoreDistFilter`; Pass/Fail segment -> `itemFilter`, the page scrolls to Items and a banner says "Filtered to N items that fail X" with a "How the reason is chosen" popover (`renderItemFilterBanner`, 8623); category/error/root-cause cards toggle filters; latency histogram drag brush -> `latencyDistFilter`.
- Every filter scopes **all** sections (`getFilteredItems()`, 13107): the metric cards, categories, errors and root cause re-render for the filtered set. The Filters dropdown in the sticky nav (`#item-filter-builder`, nested AND/OR rule builder + a "set by clicking charts and cards, removable here" chip list `#filter-builder-page`) is the single filter surface; Clear shows a count.
- Items open **inline** (card expands in place, `?item=ID`), Trace opens a drawer (`?trace=ID`). No sidebar is used to inspect items.
- Lazy rendering: sections below the fold render on `IntersectionObserver` (analysis.md).
- Density: section heads 18 px/650 (`--font-xl`), body 13-14 px, collapsed item row ~62 px, cards 1px `--border-subtle` with `--radius-md`, ~48 px between sections.

### 2.2 Compare (`dash/compare.html`, markup 5484-5715)

Scroller `.compare-container` (21), padding `--space-lg`. Order (verified with `leg-cmp-*.png`, 4 aligned runs):
1. Header bar: "Compare Runs", subtitle, Export HTML (5485-5498). In cohort mode: Compare | Sweep segmented control (5499) and the "COMPARE SIDES" banner (5501): two full-width bars "A / LEFT baseline-gpt-mini - 2 runs", "B / RIGHT cand-b-small - 2 runs".
2. **Run cards**: one card per run (3 per row at 1440, 4th wraps): colored dot, title, status, remove X, Items/Completed/Errors strip, Task/Dataset/Model/Owner/Started/Runtime grid. About 240 px tall each, always visible.
3. **Per-Run Averages** (5509): heading + description + Baseline select; full-width table, one row per metric and Avg Latency, one column per run, baseline column shows the value, others "+17.5 pts +-15.5" with a boxed verdict beyond noise and "up 9 / down 2" count buttons that filter items.
4. **Comparison Overview** (5527): heading, metric tabs (segmented) and Pass-if slider in the aside; 8-cell stats strip (Pass@4, Pass^4, Max@4, Consistency, Reliability, Avg Score, Avg Latency, Errors); Winner breakdown bar; Correct distribution bar.
5. **Performance by Category**: chip bar of keys, cards per value, each listing every run with average, latency, change vs baseline and a bar with baseline tick.
6. **Step latency** (`#step-latency-panel`, when traces exist), **Error Distribution** (`#error-distribution-section`, per message card with a per-run count table and deltas), **Root Cause Analysis** (`#root-cause-section`).
7. **Item-by-Item Comparison** (5554): head with Auto-Analyze; one panel with search, Filters dropdown, "40 of 40 items", Display, CSV; rows with one score pill per run; expands inline to input, expected output, one output card per run, trace, score edit, issues.
8. Sweep panel (`#compare-sweep-panel`, 5715): see 2.3.

There is no sticky bar and no sidebar on legacy compare. Filters live in the Item-by-Item toolbar (Filters dropdown: rules, page filters as chips) and the delta count buttons / category clicks / error cards; all of them rescope the analytics sections ("over filtered items").

### 2.3 Cohort mode (Compare + Sweep)

Compare tab = section 2.2 with the sides banner above the run cards. Sweep tab (`leg-sweep-0.png`): "Sweep" h2 + Reverse; verdict card (REGRESSED, Avg@2 -9.1% beyond noise); filter row (Move, Outcome, Search, Metadata, Values, Exclusive only); "COHORT METRICS" 5-cell strip with noise; "COHORT METRICS BY DOMAIN" table; "OUTCOME SUMMARY" 7 stat cells; item table. A full-width stacked report already, with its filters in an inline row (not in the URL in legacy).

## 3. React page anatomy

### 3.1 Run detail (`RD/RunBody.tsx`)

Component tree: `RunDetailPage` > `RunBody` > `RunContext.Provider` > `RunHero` (`components/RunHero.tsx`; meta grid hidden behind a chevron, pref `qym:run-hero-expanded`, default collapsed), optional `VersioningDetails` + `ExperimentPanel` (only when the hero is expanded), `RunNotices`, `SectionNav` (sticky; links: Summary, Items, then each panel tab Overview, Errors, Categories, Latency, Deep, Root cause, Repeat, Reviews; scroll-spy only distinguishes Summary vs Items), then `div.split` (`RunBody.module.css`: grid `minmax(0,1fr) 380px`):
- left `ItemsSection` (`components/ItemsSection.tsx`): SectionHeader "Items", StatStrip, Auto-analyze, CSV, `FilterBar`, banner, `ItemsTable` (dense table, 20 per page, inline expansion) or `Heatmap`;
- right `AnalysisPanel` (`components/AnalysisPanel.tsx`): `aside` sticky (`top: nav height + md`, `max-height` viewport, own scrollbar, 380 px) with a Tabs strip (`PANEL_TABS`: overview, errors, categories, latency, deep, root-cause, repeat, reviews); only the selected tab renders (`panels/OverviewTab.tsx`, `ErrorsTab`, `CategoriesTab`, `LatencyTab`, `DeepTab`, `RootCauseTab`, `RepeatTab`, `ReviewsTab`). `?panel=` selects the tab. Under 1200 px (`WIDE_QUERY`) the panel is a `Drawer` opened from an "Analysis" button.

Screenshot `rea-run-0.png`: after a short hero the Items table fills the first screen and the Overview cards are a narrow vertical stack on the right; Latency, Deep, Categories, Errors, Root cause are one click each. Filters (rule builder, chips, metric, threshold, pass pills, sort) sit in the Items `FilterBar`, sticky.

### 3.2 Compare (`CMP/ComparePage.tsx`)

Tree: `ComparePage` > `CompareLoaded` > `PageHeader` (+ Compare|Sweep, Export HTML) > `Notices` > `div.sticky` (`SelectionBar` run chips with baseline; `DeltaLine` per-run paired delta with count buttons and an Analytics toggle) > `RunCards` (collapsed under "Run details") > `ItemsUiHost` > either `SweepView` or `div.body` = `ItemsSection` (search, Filters, Display, CSV, Analyze, aligned list `components/items/ItemList.tsx` with inline expansion, `ItemDetail`, `OutputCard`, `TraceDrawer`) + `AnalyticsPanel` (`components/panel/AnalyticsPanel.tsx`, 24-34 rem aside, tabs Metrics, Overview, Categories, Errors, Root cause, Steps (only with traces); `?panel=`). Below 1100 px the panel stacks under the list.

Cohort mode adds `SelectionBar` side labels with inline rename and "k = 2 executions each", an "Open Sweep" button in the delta area and the SegmentedControl. `SweepView.tsx` is the stacked report.

Screenshots `rea-cmp-0.png` / `rea-coh-0.png`: first screen is the sticky chips, delta line, then the item list at ~640 px wide with the Metrics table in a 465 px panel to its right.

## 4. Gap analysis

| # | legacy | react | why it matters | proposed change |
|---|---|---|---|---|
| G1 | Run: analysis topics are full-width sections stacked in a fixed order (Overview, Repeat, Latency, Deep, Categories, Errors, Root cause, Items) | Topics are tabs in a 380 px side panel, one visible at a time | Core of the feedback; the reader can no longer read the run top to bottom; charts are cramped | Render each tab body as a `ReportSection` in the page (R1) |
| G2 | Items is the last section, after the analysis | Items first, analysis in the panel | Report order is overview first | Items last; Summary and Overview open the page |
| G3 | Section head: `--font-xl` title, description, aside, hairline, ~48 px spacing (DESIGN_LANGUAGE "Run section header"); the language already requires this | Panel tabs have h3 group titles at panel scale | The design language describes the report; the implementation does not follow it | Use `SectionHeader level="xl"` per section |
| G4 | Metric cards 3-up, latency 2-up, categories 4-column, errors in a full panel | All in one column (`Panels.module.css .stack`) | Information density and comparison across metrics | Container-query grids in each tab component (R2) |
| G5 | Meta grid always visible in the hero | Collapsed by default behind a chevron (`qym:run-hero-expanded`); Versioning and Experiment panels only when expanded | Context (model, dataset, runtime) is the first thing a report shows | Default expanded; keep the chevron as a user preference |
| G6 | Review history under the hero | Tab "Reviews" in the panel, only if events exist | Report page has everything visible | Section after the hero, hidden when no events |
| G7 | Sticky nav jump links with scroll-spy on every section; Filters + Clear in the nav | Nav links open panel tabs; scroll-spy only Summary/Items | Navigation model for a long page | Scroll-spy over all sections; Filters/Clear stay in the nav |
| G8 | Filters scope all sections (single filter model); Pass/Fail click scrolls to Items with a banner | Same model, but results are visible only if the panel tab is open | With stacked sections the scope effect is visible everywhere | Keep model; add `ScopeBar` + sidebar (R3) |
| G9 | Legacy has no sidebar | Sidebar always on (it holds the analytics) | Feedback: sidebar only for quick filters, only when items are chosen | Sidebar appears iff a scope is active (section 5.4) |
| G10 | Compare: Per-Run Averages, Overview, Category, Step latency, Error distribution, Root cause are full-width sections | Same content in `AnalyticsPanel` tabs (Metrics/Overview/Categories/Steps/Errors/Root cause) | Same as G1; the delta table with 4+ runs needs width | Stack as sections in the order of 2.2 |
| G11 | Compare: item-by-item last | Item list first | | Items last |
| G12 | Compare: run cards always visible | Collapsed under "Run details" | Run configuration is part of the report | Visible `RunCards` section (collapsed only above 4 runs) |
| G13 | Compare: no sticky chrome | Sticky chips + delta line (kept: it is the baseline switcher and count filters) | Not a regression; useful | Keep, but make it compact so it does not eat the report |
| G14 | Cohort: sides banner is two full bars; Compare tab is the report | One-line banner, item-first Compare tab, Sweep OK | Cohort Compare tab inherits G10-G12 | Same fix; keep Sweep as is; add sidebar for sweep filters |
| G15 | Lazy sections via `IntersectionObserver` | Only the visible tab mounts (accidental laziness) | Stacking eagerly would mount Latency/Deep/Root cause fetches | `ReportSection lazy` mounts on visibility (R1) |
| G16 | Legacy `#overview`-style anchors | `HASH_TAB` maps hash to panel tab; `?panel=` | Old links must still land | Hash and `?panel=` scroll to the section instead |

## 5. Redesign spec

### 5.1 Principles
1. The page is the report: sections stacked, each full width with a `SectionHeader level="xl"` (DESIGN_LANGUAGE "Run section header": hairline above, about 48 px from the previous section, header owns spacing).
2. The URL stays the whole state. No new URL params are required; the sidebar visibility is derived from the filter scope.
3. Nothing from the current React pages is removed (section 5.7).

### 5.2 Run detail structure (desktop >= 1280, state A: no scope)

```
+------------------------------------------------------------------------------------------+
| HERO  RUN DETAIL / <run id>                        [COMPLETED] [Export HTML] [< 3 of 4 >] |
|  Task  Dataset  Model  Owner  Project  Started  Runtime   (meta grid expanded)  [v]       |
|  execution context ...                                                                    |
+------------------------------------------------------------------------------------------+
| notices (ingest, private set, locked)    Review history (if submitted)                    |
| Versioning details        Experiment panel (official runs)                                |
+==========================================================================================+
| STICKY NAV  Overview  Repeat  Latency  Deep  Categories  Errors[20]  Root cause  Items[240]|
|             ........................................  [Filters (0) v]  [Clear]  [top]    |
+==========================================================================================+
| Overview                                          [Items 240][Completed 237][Errors 20]   |
| Score distributions per metric. Click a bar to filter the items.                          |
| +--------------+ +--------------+ +--------------+                                        |
| | exact_match  | | quality      | | hallucination|   metric cards, 3 per row             |
| +--------------+ +--------------+ +--------------+                                        |
|------------------------------------------------------------------------------------------|
| Repeat run analysis (repeat runs)   metric tabs, threshold, pass@k, per-pass, distribution|
|------------------------------------------------------------------------------------------|
| Latency and traces                                       237 items - 61 traces            |
|  | Response time:  [latency histogram + brush]   [quality vs latency scatter]  |          |
|  | Inside the traces: [time budget bar] [LLM][Tools][Retrieval][Eval] [steps plot] |      |
|------------------------------------------------------------------------------------------|
| Deep analysis        [correlation matrix]  [relationship scatter]                         |
|------------------------------------------------------------------------------------------|
| Categories           [key chips]  cards per value ...                                     |
|------------------------------------------------------------------------------------------|
| Errors               Task / Metric / Trace / Analysis cards                               |
|------------------------------------------------------------------------------------------|
| Root cause analysis  (when analyses exist)                                                |
|------------------------------------------------------------------------------------------|
| Items                                                [Auto-analyze] [CSV]                 |
|  filter bar (search, metric, threshold, pills, Filters, Display, sort) - sticky           |
|  table, 20 / page, inline expansion, pager                                                |
+------------------------------------------------------------------------------------------+
```

State B (scope active; sidebar appears, report column narrows, sections recompute):

```
+--------------------------------------------------------------+---------------------------+
| (hero, notices, as above)                                    |                           |
+==============================================================+                           |
| STICKY NAV ...  [Filters (2) v] [Clear (2)]                  | QUICK FILTERS      [x]    |
+==============================================================+ 112 of 240 items          |
| Scope: 112 of 240 items  [Failing - quality x] [domain: fin x]| [Clear all]              |
|--------------------------------------------------------------| Active                    |
| Overview  (over 112 items)                                   |  (chips, removable)       |
| +----------+ +----------+                                    | Status  (All Pass Fail    |
| | card     | | card     |   2 per row at this width         |   Errors)                 |
| +----------+ +----------+                                    | Metric [quality v]        |
|--------------------------------------------------------------|  Pass if >= [----o-] 70%  |
| Latency and traces (over 112 items)                          | Categories                |
|  ...                                                         |  complexity: easy 54 ...  |
|--------------------------------------------------------------|  domain: finance 48 ...   |
| ...                                                          | Errors                    |
| Items (112)                                                  |  Task 12  Metric 8        |
+--------------------------------------------------------------+ Latency range [chip]      |
                                                               | Sort [Index v]            |
                                                               | [View 112 items]          |
                                                               +---------------------------+
```
The sidebar column is `--report-sidebar-width: 300px` (page-local custom property, same pattern as the current `--run-panel-width`), sticky below the nav, own scroll, `--bg-surface`, 1px `--border-subtle`, `--radius-md`.

### 5.3 Compare structure

State A (no scope), order from 2.2:
```
+------------------------------------------------------------------------------------------+
| Compare runs  4 columns - cmp-qa-v1 - 40 aligned items      [Compare|Sweep]* [Export HTML]|
| (cohort mode) COMPARE SIDES  A baseline-gpt-mini 2 runs (rename)  vs  B cand-b-small 2 runs|
+==========================================================================================+
| STICKY  (A) base* (B) (C) (D) [x]      metric [quality v]   B +15.3 [up 30][dn 9] C ... [Reset]|
|         nav: Runs Averages Overview Categories Steps Errors Root cause Items  [Filters][Clear]|
+==========================================================================================+
| Runs          run cards grid, 3 per row (collapsed to chips above 4 runs)                 |
|------------------------------------------------------------------------------------------|
| Per-run averages      Baseline [v]   full-width metric x run table with deltas, noise band |
|------------------------------------------------------------------------------------------|
| Comparison overview   [correct|quality] Pass if >= [--o--]  stats strip, winner bar, dist |
|------------------------------------------------------------------------------------------|
| Performance by category    key chips + cards per value, one row per run                   |
|------------------------------------------------------------------------------------------|
| Step latency (traced runs)  |  Error distribution  |  Root cause                          |
|------------------------------------------------------------------------------------------|
| Item-by-item comparison     [Search] [Filters] [Display] [CSV] [Analyze]   aligned rows   |
+------------------------------------------------------------------------------------------+
```
State B: same sidebar slot; contents differ (5.5). Sweep (cohort) view: unchanged stacked report; its Move/Outcome/Search/Metadata/Values filters (already in the URL: `sweepMove`, `sweepOutcome`, `sweepQ`, `sweepKey`, `sweepValues`, `sweepReverse`) become the scope; when any is non-default the sidebar shows them plus "Exclusive only".

### 5.4 What "items chosen" means (precise definition)

There is no checkbox selection of items on these pages, so "chosen" = **the visible item set was narrowed by the user**, i.e. a *scope* is active.

Run detail: `scopeActive = activeChips(view, defs, metric).length > 0 || view.q !== ''`. That covers chart-mark clicks (score bucket, Pass/Fail/Error segment, latency brush, repeat distribution), category card clicks, error card clicks, root-cause category clicks, rule-builder rules, approval, search text and `?pass=` is not a scope (it is a view). Sort, page, selected metric, threshold, hidden columns and the Cards/Heatmap switch do not count. A `?item=ID` deep link alone does not count (the report opens, the item is highlighted); if the link lands with filters in the URL, the scope is active.

Compare: `scopeActive = activeChips(view, model, columnLabel).length > 0 || view.q !== '' || rule count > 0`. That covers the delta "improved/regressed" count buttons, winner/show chips, category and error clicks, cohort bucket chips, search and the rule builder. Baseline change, metric tab, threshold slider and column layout do not count.

Sweep: any `sweepMove/Outcome/Q/Key/Values` non-default.

A manual "Quick filters" button is not offered; the ScopeBar has a "Hide" toggle for the sidebar while the scope stays (stored as `localStorage qym:report-sidebar-hidden`, default shown).

### 5.5 State machine

```
              chart mark / card click / search / rule / URL with filters
   +----------+ --------------------------------------------------------> +-----------------+
   |  REPORT  |                                                          |  SCOPED         |
   | (no side |                                                          |  sidebar shown  |
   |  bar)    | <-------------------------------------------------------- |  (open)         |
   +----------+   Clear / last chip removed / "Clear all" / nav Clear     +-----------------+
        ^                                                                   |        ^
        | scope becomes empty                                  [Hide]       v        | [Show] (ScopeBar)
        |                                                          +-----------------+
        +----------------------------------------------------------|  SCOPED         |
                                                                   |  sidebar hidden |
                                                                   +-----------------+
 Narrow viewport (<1200 px): SCOPED renders ScopeBar + "Quick filters" button; the sidebar is a Drawer.
 Item expand/collapse, trace drawer, pagination and sort never change the state.
```
Effects of a transition REPORT -> SCOPED: sidebar slides in (150 ms `--transition-fast`, none under `prefers-reduced-motion`), the report column keeps its scroll position (no scroll jump), every section header aside shows "over N of M items", `ScopeBar` appears above Overview. The legacy behaviour of scrolling to Items after a Pass/Fail click is replaced by a "View N items" button in the ScopeBar and the sidebar (open question Q3).

### 5.6 Sidebar content (quick filters)

Run detail (each control writes the existing filter model; no new filter fields):
1. Header: "Quick filters", "112 of 240 items", Hide, Clear all.
2. Active chips (`activeChips` output, removable), plus "N rules" chip that opens the rule builder (builder stays in the nav Filters dropdown and the Items `FilterBar`).
3. Status: All / Pass / Fail / Errors for the analysis metric (the existing FilterBar pills), Metric select, "Pass if >=" slider (direction-aware metrics only).
4. Categories: for each of the first 3 metadata keys, value chips with counts (same data as `CategoriesTab`), include / exclude as today.
5. Errors: Task / Metric / Trace buckets with counts toggling the error filters.
6. Latency range chip, repeat distribution chip when set.
7. Sort select. "View N items" jumps to `#run-items`.
Compare: Active chips; Show (Different outputs, With errors, All runs correct, No run correct, Partially correct, Rarely solved, Uniquely solved: the existing `show` values); Winner (any, per-run won, only-run solved, ties); per-run Improved / Regressed count buttons (same as DeltaLine, vs the baseline); category chips with counts; error kinds; search field; Sort; "View N items".

### 5.7 Everything currently in React that must remain

Run detail: hero (status, STOPPING, live indicator + ticking runtime, pass pills, Export HTML, pager with J/K and peek card, entity links, ingest/private/locked notices, execution context, JSON preview), versioning and experiment panels, review history, sticky nav with counts, Filters rule builder + Clear, chart-click filters, search (server search for lazy snapshots), sort, analysis metric + threshold, hidden columns, CSV with column picker, Overview cards and error-accounting notes, Repeat (metric tabs, threshold, pass@k, per-pass table, distribution), Latency (histogram brush, scatter, time budget, steps plot, CSV links), Deep (correlation, scatter), Categories, Errors, Root cause (cards, aggregate, issue dialog, approve), Items table/heatmap, inline expansion, score edit, pass columns, trace drawer, `?item=`, `?trace=`, `?pass=`, `?view=heatmap`, `?list=`. Compare: selection chips, baseline, delta line and count filters, run cards, notices, Per-run averages (Metrics tab), Overview, Categories, Errors, Root cause, Steps, item list with rule builder/filters/Display/CSV/Analyze, expansion, output cards, trace drawer, score edit, issue editor, Sweep with noise bands, URL contract incl. both sessionStorage handoffs, 20-run cap. All of these move, none are dropped.

### 5.8 Responsive rules
- >= 1920: content max stays full width; metric cards 4 per row (State A) / 3 (State B); sidebar 320 px.
- 1280-1919: State A 3 cards per row; State B sidebar 300 px, 2 per row.
- 768-1279: no inline sidebar. ScopeBar sticks under the nav with "N of M items", chips (wrap, max 2 lines then "+N"), Clear and a "Quick filters" button opening the existing `Drawer` (width 360). Cards 2 per row, latency panels stack.
- < 768 / 390: one column, nav becomes a horizontally scrolling link row (no wrap), sticky nav only (ScopeBar is static), Drawer is full width; compare sticky chips become static (existing `max-width: 640px` rule); tables keep the mirrored horizontal scrollbar.
- Layout uses container queries on the section body (`container-type: inline-size`) so cards respond to the actual column width in both states.

### 5.9 Motion
Sidebar and ScopeBar use `--transition-fast` on `transform/opacity`; section content never animates in; `prefers-reduced-motion: reduce` removes the transition and the highlight ring animation stays as it is. Scroll to a section uses `scroll-behavior: smooth` only when motion is allowed.

### 5.10 Primitives
Reused: `SectionHeader level="xl"`, `StatStrip`, `Chip`, `Tabs`/`SegmentedControl` (inside sections), `Drawer`, `Slider`, `Select`, `Pagination`, `Tag`, existing tab body components (`OverviewTab`, `LatencyTab`, `DeepTab`, `CategoriesTab`, `ErrorsTab`, `RootCauseTab`, `RepeatTab`, `ReviewsTab`; compare `MetricsTab`, `OverviewTab`, `CategoriesTab`, `ErrorsTab`, `RootCauseTab`, `StepsTab`), `FilterBar`, `activeChips`.

New (in `frontend/src/ui/`, exported from `index.ts`, with a gallery entry in `/__ui`):
- `ReportSection`: `{ id: string; title: ReactNode; description?: ReactNode; aside?: ReactNode; scopeNote?: string; lazy?: boolean; minHeight?: number; hidden?: boolean; children }`. Renders `<section id aria-labelledby>` with `SectionHeader level="xl"`, mounts children when `lazy` and in view (`useInView`, rootMargin 600 px), reserves `minHeight` to avoid layout shift, never unmounts after first mount.
- `ReportLayout`: `{ sidebar?: ReactNode; sidebarOpen: boolean; wide: boolean; children }`: the grid (`minmax(0,1fr) var(--report-sidebar-width)`), sticky aside slot, Drawer fallback when `!wide`.
- `ScopeBar`: `{ shown: number; total: number; chips: {key,label,onClear}[]; onClearAll; onJumpToItems; sidebarOpen; onToggleSidebar }`.
- `QuickFilterGroup`: `{ label: string; mode: 'single'|'multi'; options: {id,label,count?,tone?}[]; selected: string[]; onToggle(id); onOnly?(id) }` built on `Chip`.
- hook `useInView(ref, opts)` in `frontend/src/lib/`.
Feature-level: `RD/hooks/useScope.ts`, `CMP/hooks/useScope.ts` (derive `scopeActive`, `chips`, `shown`, `total`); `RD/components/QuickFilters.tsx`, `CMP/components/QuickFilters.tsx` (the sidebar bodies).
No new tokens: spacing, borders, radii and fonts from `tokens.css`; DESIGN_LANGUAGE needs a short "Report page and scope sidebar" paragraph (Task X1).

### 5.11 URL and state
- No new filter params. `?panel=` and `#overview|latency|deep|categories|errors|root-cause|repeat|reviews|items` (and `#run-section-*`) scroll to the matching section; `?panel=` is no longer written. Compare `?panel=` (metrics, overview, categories, errors, root-cause, steps) maps likewise.
- Sidebar visibility: derived (scope) plus `localStorage qym:report-sidebar-hidden`.
- Hero expanded pref `qym:run-hero-expanded` default flips to true (existing stored values are kept).

## 6. Work plan

Estimates in hours. "Ind." = can run in parallel with others once the shared primitives (P1) land.

| ID | Task | Files | Tests | Est | Ind. |
|---|---|---|---|---|---|
| P1 | Primitives: `ReportSection`, `ReportLayout`, `ScopeBar`, `QuickFilterGroup`, `useInView`, gallery entries | `frontend/src/ui/*`, `src/lib/useInView.ts`, `features/dev` gallery | Vitest per primitive (lazy mount once, reduced motion, drawer fallback), `design-language.test.ts` | 8 | first |
| R1 | Run: stack sections (convert the panel tabs into sections, order of 2.1, lazy), remove `AnalysisPanel` split | `RD/RunBody.tsx`, `RunBody.module.css`, new `RD/components/ReportSections.tsx`, delete/trim `AnalysisPanel.tsx` | update `panels.spec.ts`, `a11y.spec.ts`, `cutover-layout.spec.ts` | 8 | after P1 |
| R2 | Run: width-adaptive tab bodies (container-query grids: 3-up cards, 2-up latency, category columns), repeat section | `RD/components/panels/*.tsx`, `Panels.module.css`, `Latency.module.css`, `charts/Charts.module.css` | screenshots at 390/768/1280/1920 in `e2e/run-detail/report-layout.spec.ts` (new) | 8 | after P1 (parallel to R1) |
| R3 | Run: `useScope`, `QuickFilters` sidebar, `ScopeBar`, scope notes in section asides | `RD/hooks/useScope.ts`, `RD/components/QuickFilters.tsx` | Vitest `useScope` (what counts as scope), e2e `scope-sidebar.spec.ts` (appears on chart click, disappears on Clear, hide pref, drawer at 1024) | 8 | after R1 |
| R4 | Run: nav scroll-spy over all sections, hash and `?panel=` compat, Filters/Clear stay | `RD/components/SectionNav.tsx`, `RunBody.tsx` | update `qa-fixes.spec.ts`, `items.spec.ts`, `repeat.spec.ts`, `cutover-repeat-metric.spec.ts`, `cutover-step-latency.spec.ts` (they open the panel tab) | 5 | after R1 |
| R5 | Run: hero meta grid default expanded, versioning/experiment visible, review history section, Items section drops panel props | `RunHero.tsx`, `RunBody.tsx`, `ItemsSection.tsx`, `RunPanels.tsx` | Vitest for pref default; update `ReviewHistory.test.tsx`; `cutover-run-page.spec.ts` | 4 | after R1 |
| C1 | Compare: stack sections (Averages, Overview, Categories, Steps, Errors, Root cause, Items), remove side `AnalyticsPanel`, lazy Steps | `CMP/ComparePage.tsx`, `ComparePage.module.css`, new `CMP/components/ReportSections.tsx`, `panel/*.tsx` | update `compare/a11y.spec.ts`, `layout.spec.ts`, `ux-layout.spec.ts`, `cutover-compare.spec.ts` | 8 | after P1 |
| C2 | Compare: run cards section visible (collapse > 4), compact sticky chips + delta line, nav jump bar | `RunCards.tsx`, `SelectionBar.tsx`, `DeltaLine.tsx` | `selection.spec.ts`, `notices.spec.ts` | 5 | after C1 |
| C3 | Compare: `useScope` + quick-filter sidebar (show, winner, improved/regressed, categories, errors) + ScopeBar | `CMP/hooks/useScope.ts`, `CMP/components/QuickFilters.tsx`, `lib/activeChips.ts` | Vitest scope rules; e2e `scope-sidebar.spec.ts`; `filters.spec.ts` | 7 | after C1 |
| C4 | Cohort: Compare-tab banner as full sides bar (labels, rename, k), sweep scope sidebar for `sweep*` params | `SelectionBar.tsx`, `sweep/SweepView.tsx` | `cohort.spec.ts` | 5 | after C3 |
| X1 | Docs: DESIGN_LANGUAGE paragraph, `frontend/README.md`, update `qa/run-detail.md` / `qa/compare.md` mapping tables (keep the Deferred lists separate and untouched) | `docs/DESIGN_LANGUAGE.md`, README | `pytest tests/platform/test_design_language.py` | 2 | last |
| X2 | QA pass: keyboard, a11y (axe), 5k-item performance, live runs, 20-run compare perf | e2e | existing perf tests (`lib/__tests__/perf.test.ts`) | 6 | last |

Total: 74 h (about 9-10 working days for one agent; about 5 days with three agents: A = P1, then R1-R5; B = C1-C4; C = R2 and X1/X2 after P1).

Deferred items: the Deferred lists in `qa/run-detail.md` (offline export, Categories Compare view, Sankey, Deep matrix/frontier/by-pass/stability, catalog editing, legacy diagnosis editors, resizable trace divider, CSV trace_stats, item-20 leftovers) and `qa/compare.md` (Auto-Analyze overlay, Sankey) stay deferred and are not part of this plan. The stacked layout makes the four missing Deep charts and the Sankey straightforward to add later (each is just another block inside an existing section), which is a reason not to fold them in now.

Risks:
- Mounting all sections raises first-render cost and fires step-latency, group-metrics and passes requests: mitigated by `lazy` sections; verify with the 5k-item run (`perf.test.ts`, run-detail e2e).
- Many e2e specs open panel tabs (`panels.spec.ts`, `cutover-step-latency.spec.ts`, `cutover-repeat-metric.spec.ts`, `compare/a11y.spec.ts`, `layout.spec.ts`, `ux-layout.spec.ts`): rewrite their navigation helpers to scroll to a section; budget included above.
- Sticky stacking on compare (chips + delta line + nav) can exceed 120 px at 1280: use one sticky container with the nav inside and a measured `--run-nav-h`.
- Scope appearing changes column width, which re-lays out charts (histogram, scatter): charts must be width-responsive (ResizeObserver already used in `Charts.tsx`; check Latency SVGs).
- The "Items" table design feedback (point 1) touches `ItemsTable`/`ItemList`; coordinate so that work and this layout do not collide (this plan only changes the section wrapper and removes the panel props).

## 7. Open questions (recommended default is what implementation will use)

1. Does "items chosen" mean a filter scope (chart click, chip, search, rule)? Default yes (5.4). There is no checkbox selection of items on these pages.
2. Sidebar on the right (as now) or left? Default right.
3. Keep the legacy auto-scroll to Items after a Pass/Fail bar click? Default no auto-scroll; ScopeBar and sidebar show "View N items".
4. May the user open the sidebar without a scope? Default no; only hide/show while a scope is active.
5. Hero meta grid always expanded as in legacy? Default yes, collapsible by preference.
6. Are sections collapsible? Default no; every section is a full view, navigation by jump links.
7. "Cohort pages" = Compare in cohort mode plus Sweep (the Runs-list Cohort selection bar is out of scope)? Default yes.
8. Compare run cards visible by default? Default yes for up to 4 runs, collapsed to chips above that.
9. Items stays the last section (legacy order) even though the earlier UX decision made it first? Default last.
10. Root cause and Reviews sections hidden when empty (as legacy), no empty placeholders? Default hidden.

## Summary for the orchestrator
- Cohort has no page of its own: it is Compare opened with `cohortA`/`cohortB` plus the Sweep view; Sweep is already a stacked report in React, the gap is the Compare tab.
- Biggest gaps: (1) analysis topics are tabs in a 380 px (run) / 24-34 rem (compare) side panel instead of full-width sections; (2) Items first instead of last; (3) hero meta grid, versioning, experiment and review history hidden or tabbed; (4) nav scroll-spy only knows Summary/Items; (5) compare run cards collapsed.
- Design: stacked `ReportSection`s with `SectionHeader xl`, sticky nav kept, `ScopeBar` plus a 300 px quick-filter sidebar that exists only while a scope is active (any filter chip, rule or search), Drawer under 1200 px.
- No URL contract changes; `?panel=` and old hashes scroll to sections; nothing in React is dropped; Deferred lists untouched.
- Total estimate: 74 h (P1 8, run 33, compare 25, cohort in C4, docs/QA 8); about 5 days with three agents.
- Defaults: scope = narrowed item set; sidebar right; no auto-scroll to Items; no manual sidebar without scope; hero expanded; sections not collapsible; run cards visible up to 4 runs; Items last; empty Root cause/Reviews hidden.

## Deferred

- X2 manual QA (5k-item run, live run, 20-run compare timing): only the existing automated perf tests and the full Playwright suite were run; a hand timing pass is about 2 h.
- Deviations from the brief, by decision: the sidebar omits the "Active" chip list because the ScopeBar directly above the report already lists the same removable chips (one set of "Remove ... from scope" buttons avoids duplicate controls); section jumps scroll instantly (re-aligning while lazy sections above settle) instead of smoothly; `?panel=` is read for old links but never written; compare no longer remounts to a stored tab, so removing a run returns the compare view to the top.
