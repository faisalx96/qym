# Overview, charts, KPIs, insights and the runs list (home page) — migration brief

Written by an analysis agent for the React/TypeScript/Vite migration. Audience: the
component agent that will rebuild this area from scratch in `frontend/`. Be concrete:
file paths with line numbers, API routes with methods and response shapes, exact
behaviors. No marketing language.

All paths below are relative to `packages/platform/qym_platform/` unless they start
with `docs/` or `tests/`. `dashboard.js` means `_static/dashboard/dashboard.js`
(10 021 lines; it is one IIFE shared by the Runs, Charts and Models pages).

## 1. Surface inventory

| Page / route | HTML file | JS / CSS it loads | Entry function(s) | approx LOC |
|---|---|---|---|---|
| Runs list (project home) `GET /projects/{slug}` (served by `api/runs.py:2231`; `GET /` serves `projects.html` instead, `api/runs.py:2220`) | `_static/dashboard/index.html` (282 lines) | `dashboard.css`, `shell.css`, `ui_components.css`; `qym_safe.js`, `auth.js`, `shell.js`, `kpis.js`, `ui_components.js` (defer), `runs_order.js`, `metrics.js`, `qym_table.js` (loaded, unused here), `dashboard.js`; sets `window.__QYM_INITIAL_VIEW__ = 'table'` | `dashboard.js` `checkAuthAndInit()` (line 9927) → `fetchRuns({refreshAllPages:true})` (8602) → `fetchDashboardPage()` (8470) → `_applyRunsData()` (7884) → `render()` (5709) → `renderTableView()` (4359) | dashboard.js table-specific regions ≈ 3 000 lines (4135–5410 rows/samples, 5525–5710 status bar/compare panel, 7005–7770 selection/actions, 8223–8720 fetch, 9069–9560 events/keys, 9560–10021 URL/state) |
| Charts `GET /projects/{slug}/charts` (`api/runs.py:2320`) | `_static/dashboard/charts.html` (119 lines) | same bundle minus `qym_table.js`; `__QYM_INITIAL_VIEW__ = 'charts'` | `fetchRuns` → `fetchDashboardChartOverview()` (8270) → `drainChartHistory()` (8374) → `applyChartHistory()` (8335) → `renderChartsView()` (2409) | `renderChartsView` alone is lines 2409–3556 (≈1 150); helpers 1928–2410 |
| Overview `GET /projects/{slug}/overview` (`api/runs.py:2398`) | `_static/dashboard/overview.html` (832 lines; inline `<style>` 14–106, inline script 237–831) | `dashboard.css`, `shell.css`, `ui_components.css`; `qym_safe.js`, `auth.js`, `shell.js`, `kpis.js`, `ui_components.js`, `metrics.js` (for `metricDeltaVerdict`) | inline `load()` (overview.html:680) → `loadKpis`, `loadTrend`, `loadLiveRuns`, `loadRunLists`, `loadPendingReviews` | ≈ 600 lines JS |
| Topbar KPI chips (on Runs/Charts/Models) | rendered into `#shell-topbar-stats` by `shell.js` | `kpis.js` (95 lines) `QymKpis.renderTopbar` ← `dashboard.js renderStatsBar()` (2260) | — | 95 |
| Insights (orphaned) | **no HTML on this branch loads `insights.js`** (`grep insights.js *.html` → nothing; `analyzer.html` only has `.insights-*` CSS). Backend `GET /api/projects/{slug}/insights` (`api/insights.py:102`) still exists. | `_static/dashboard/insights.js` (952 lines, hand-rolled SVG line chart `chartPanel()` 367–487) | `init()` 918 | 952 |
| Runs-order helper (shared with run page) | — | `_static/dashboard/runs_order.js` (200 lines) `window.QymRunsOrder` | — | 200 |

Charting library: **none**. Every "chart" is hand-written: the Charts page is a CSS
grid of horizontal "mini bars" (`renderMiniBarCell`, dashboard.js:2293, `width:%` on a
`div`), the Overview trend is string-built inline SVG (`renderTrendChart`,
overview.html:380–470, line + dots + run bars + hover hit-rects + absolutely
positioned tooltip), insights.js builds SVG strings too. No `<canvas>`, no d3, no
Chart.js anywhere in the bundle.

## 2. User journeys (as-is)

### J1. Open the project home and scan the runs list
1. Entry: sidebar "Runs" → `/projects/{slug}` (or `/projects/{slug}?…` deep link). `shell.js`
   mounts, fetches `/v1/me`, dispatches `qym:shell-ready`; `dashboard.js` waits for it
   (9933).
2. Skeleton: `#loading[data-qym-skeleton="table"]` (12 rows). If a page for the same
   request key was seen < 5 min ago in this tab, it is shown instantly from
   `window.__QYM_RUNS_PAGE_CACHE__` (9663–9690) with `aria-busy=true`, then revalidated.
3. `POST /api/dashboard/runs` (page 1, 50 rows, `include_overview:true`). Table renders;
   topbar KPI chips render from `overview.kpis`; status bar shows "N runs" / "M of N
   runs — task: …, …"; "Last Updated: hh:mm:ss".
4. Empty project: `#empty` card "No evaluation runs found" + link to
   `/docs-guide#get-started/first-run`. Empty filter result: single `<td>` "No runs match
   current filters" (4425), or "Run history is preparing. Available runs will appear
   automatically." while `freshness.unpublished_runs > 0`.
5. Error on first load: `QymUIComponents.renderErrorState` in `#loading` with Retry
   (7934–7960). Error on a later refresh: rows stay, dimmed (`.qym-is-stale`), banner
   `#runs-stale-banner` "Couldn't refresh runs. … Showing runs from hh:mm:ss. Your latest
   filter, sort or page change is not applied." + toast (7960–7983).
6. 401 anywhere: `showAuthError()` + `teardownDashboard()`; 404 on project →
   `showProjectNotFound()`.

### J2. Filter / search / sort / page, then open a run and come back
1. Command bar: search box (`/` focuses), Select toggle, Columns menu, time range
   segmented (All/Today/7d/30d/Range→date dialog), Origin segmented (All/Official/Local),
   then a wrapping row of multi-select dropdowns: Tasks, Datasets, Models, Versions,
   `[dynamic Evaluation-Service versioning keys]`, Status, Users, and a Clear button with
   a count badge.
2. Every change calls `render()` → `syncDashboardUrl()` (`history.replaceState`) →
   `fetchRuns()`; the filter key change resets `tablePage` to 1 and `focusedIndex` to -1.
3. **URL encoding** (`dashboardUrlParams`, 9578; `applyDashboardUrlState`, 9606):
   - repeated keys for multi-selects: `?task=a&task=b&model=gpt-4o&dataset=…&status=…&version=…&owner=<user_id>`
     (`DASHBOARD_URL_FILTERS` 9560: `task→filterTasks, model→filterModels, dataset→filterDatasets, status→filterStatuses, version→filterVersions, owner→filterUsers`)
   - `range=today|week|month|custom`, with `from=YYYY-MM-DD&to=YYYY-MM-DD` (local dates, either may be absent) only when `range=custom`
   - `origin=official|local` (absent = all)
   - `q=<search>` (trimmed, ≤200 chars; written separately in `setSearchQuery` 5896)
   - `sort=<field>-<asc|desc>` only on the table view and only when ≠ `time-desc`
   - `page=N` only when N > 1
   - **Not in the URL**: versioning-metadata filters (`filterVersioning` Map) — they live only in sessionStorage; column visibility; frozen columns.
   - Model values: a plain model name in the URL expands to both `name|||plain` and
     `name|||reasoning` variant keys; `modelUrlValues()` (9569) collapses back to the
     plain name when both are selected. `__none__` is a legal value meaning "select nothing".
   - Rule: if **any** view key is present the URL is the whole view; otherwise the tab's
     sessionStorage copy (`qym:dashboard-state:<slug>`, `saveDashboardState` 9772) restores
     filters. `sort` and `page` are read from the URL regardless.
4. Sorting: click a `th.sortable` (or Tab to its injected `button.th-sort-button`, Enter/Space;
   `enhanceSortableHeader` 3637). First click: desc for numeric/time/status/latency/duration/metric/trace,
   asc for text (`handleColumnSort` 3649). `th[aria-sort]` is maintained (3670). Sort keys:
   `run, status, task, model, dataset, owner, time, version, latency, median-latency, duration, metric-<name>, trace-<key>`.
   A text sort (task/model/dataset/version/owner) is **collated in the browser**:
   the client fetches the overview's `sort_values` and sends the sorted array back as
   `collation` so the server orders by that order (`dashboardCollation` 8447,
   `runs_order.js collation()`, server `_sort` in `api/dashboard.py:428`). If a hidden
   metric/trace/latency column is the sort key, sort falls back to `time-desc` (4373–4396).
5. Pagination: `QymUIComponents.renderPagination` in the status-bar centre (first/prev/
   `[page] of N`/next/last + "1–50 of 123 runs"), page size fixed at 50
   (`TABLE_PAGE_SIZE`). `page` is clamped when the total shrinks (8528).
6. Open a run: run-name link `<a class="run-id" href=…>` (plain click → in-app
   `navigateTo`; modified/middle click native). The href carries the list view as one
   `?list=<urlencoded view params minus page>` parameter (`runFromListUrl` 7096,
   `QymRunsOrder.runHref`) so the run page can step prev/next in the same order via
   `POST /api/dashboard/neighbors`. Also sets `sessionStorage.dashboardRunFile`.
7. Back: `pageshow` with `persisted` triggers a full refetch (9887); the cached page shows
   first (J1.2); the ticked selection is restored from `sessionStorage qym:runs-selection:<slug>`.

### J3. Live status while runs execute
1. Polling cadence (`updateRunsRefreshCadence` 9972): 60 s idle; 15 s when
   `overview.has_active_runs` or any row is RUNNING/PENDING, or while the projection is
   backfilling; 2 s for 60 s after a stop was requested; exponential back-off 2→4→8→15 s
   while `freshness.updating`. Hidden tab never polls; on `visibilitychange` back it
   refetches once (9873). `qym:run-status` (from `QymShell.announceRunStatus`, cross-tab
   via BroadcastChannel) forces an immediate refetch and 20 s fast polling (10002).
2. A poll whose signature equals the shown page does not touch the DOM (8524–8540); otherwise
   rows are keyed by `file_path` and only rows whose HTML changed are rebuilt (4675–4720),
   keeping focus/selection.
3. Status cell: badge `status-<STATUS>` with `pass j/k`, `NN%`, `done/total` suffixes while
   RUNNING; "STOPPING…" when `stop_requested`; ⚠ task/metric error counts, `N↻` retries,
   ingest-incomplete marker after the run ends.
4. Commit `f3c70f1` ("show a run's current status in the runs list at once") is purely
   backend: `services/dashboard_outbox.py publish_run_status()` mirrors `Run.status`,
   `status_reason` and `stop_requested` into the dimension row in the **same transaction**
   that changes the run, so the list, overview and run page never disagree while the summary
   worker lags. **Implication for React:** the list's `status` field is authoritative and
   fresh on every poll; do not try to "correct" it from the run page or from an event stream.
   Numbers (progress, means) may still lag until `freshness.updating` clears.

### J4. Select, compare, cohort, bulk submit, bulk delete
1. "Select" button or `x` on a focused row enters select mode (checkbox column visible,
   `.table-container.select-mode`). Header checkbox selects the visible page.
2. Status bar left shows `N executions selected` + Compare / Cohort / Submit / Delete /
   Clear + live guidance text (`renderComparePanel` 5590). Repeat runs expanded show per-pass
   checkboxes; a pass ref is `<file_path>#pass<k>`.
3. Compare → `sessionStorage.compareRuns = [file_paths]` then navigate to `/compare`
   (`openComparison` 7123). Cohort: first click locks Cohort A (`cohortAnchorRuns`), then the
   user picks an equal number of executions for B → `sessionStorage.compareCohorts`.
4. Submit → confirmation modal with optional comment → `POST /v1/runs/submit {run_ids, comment}`
   (one run: `POST /v1/runs/{id}/submit`). Delete → modal → `POST /api/runs/delete {file_path}`
   per run (loop), passes via `DELETE /api/runs/{id}/passes`.
5. Selection persists per project in this tab across Back/Forward and other pages
   (`saveRunsSelection` 9719); runs that vanish are dropped when the page answers.

### J5. Row actions (owner / manager / admin)
Actions column: a "review" dropdown (Approve/Reject on SUBMITTED; Unapprove on APPROVED;
Unreject on REJECTED; Transfer ownership for managers), a Submit icon (owner or manager, on
COMPLETED/FAILED/REJECTED), a Delete icon. Each opens a small modal (`#workflow-modal`,
`#transfer-modal`, `#delete-modal`) and posts to `/v1/runs/{id}/{approve|reject|unapprove|unreject}`,
`/v1/runs/{id}/owner {user_id}`, `/api/runs/delete`. After success the row shows the new status
at once (`applyRunWorkflowResult` 4249) and a toast appears. Analysis column links to the
analyzer (`/projects/{slug}/runs/{id}/analyzer`); Experiment column links to the experiment.

### J6. Expand a repeat run (samples > 1)
Chevron in the Run cell (`samples-toggle`) opens an inline panel under the row
(`insertSamplesDetail` 5132): group-metrics strip (Pass@K, consistency, reliability with a
metric select and threshold slider) + one real `<tr>` per pass. Data: `GET /api/runs/{id}/passes`
and `GET /api/runs/{id}/group-metrics?metric=&threshold=` in parallel (5325). Live runs
re-fetch the panel on every poll.

### J7. Charts page
1. Entry: sidebar "Charts" → `/projects/{slug}/charts`. Same command bar minus search/Select.
2. `POST /api/dashboard/overview` → `chart_data` (per task → datasets → models aggregates)
   renders one card per task with dataset tabs (`role=tablist`), a legend of all models (click =
   toggle model filter, dblclick = only this model), and a resizable first column.
3. Each visible card lazily loads its full run history via `POST /api/dashboard/points`
   (500 per page, paginated until `has_more` is false, max 2 concurrent,
   IntersectionObserver with 200 px margin; 8355–8411). Until then a skeleton of the card's
   remembered height (`sessionStorage qym:chart-card-h:<key>`) shows.
4. Card body is a CSS-grid "table": rows = runs (or groups), columns = score metrics as mini
   bars, numeric metrics as numbers, ⚡ latency columns, ⚡ trace metrics; sortable column headers;
   "Rows: Runs | Grouped" + "Group: Model | Version" + "Then: Model | Version" segmented
   controls; grouped mode shows Pass@K/Consistency/Reliability per group via
   `POST /api/dashboard/models/stats` (batched, 6356). Group expand/collapse, Expand all.
5. Charts state is **not** in the URL: per-card sort (`chartSortState`), group mode, expansion
   and the active dataset tab (`chartDatasetTab`) are in-memory only; first-column width is
   in sessionStorage.

### J8. Overview page
1. Entry: sidebar "Overview" → `/projects/{slug}/overview`. Title = project name.
2. Origin segmented (All/Official/Local) at the top, re-runs every section with
   `filters.origins`.
3. Five KPI cards (`QymKpis.entries`): Runs, Execution success, Runs with errors, Models,
   Items, each with an "i" help marker; sub-line "All runs · 12 approved · Updating…".
   Source `POST /api/dashboard/kpis`.
4. Live Runs table (RUNNING/PENDING, 8 rows, sorted `activity-desc`, polled every 10 s while
   visible), Recent Runs (5, non-live statuses), Approved Runs (5), Pending Reviews (12 from
   `GET /api/corrections?status=pending&limit=12&project_slug=`), each with "View all →".
5. Trend card: task+dataset `<select>` (hidden when < 2 pairs), 7/30/90-day segmented; headline
   metric value, delta vs previous period (coloured by declared direction), runs count,
   execution success; SVG line of daily means with run-count bars underneath; hover tooltip.
   **URL state:** `?range=30d|90d&task=…&dataset=…` via `QymShell.replaceUrlQuery`
   (overview.html:321–348); segmented choice also remembered by `data-qym-segmented-key`.
6. While `freshness.updating`, lists show "Updating…" and the whole page reloads every 2 s
   (overview.html:759).

### Keyboard (Runs table only; `document keydown` 9349)
`j/↓ k/↑` move row focus (across pages: `moveFocus` → `setTablePage`), `g`/`G` first/last run
of the whole list, `Enter` open, `x` toggle select, `c` compare (or open cohort), `/` search,
`?` help modal, `1–4` time range, `Esc` leave select mode / clear selection / blur input.
Single-key shortcuts can be disabled in the help modal (`localStorage qym:single-key-shortcuts=off`).
Never fire with modifiers, inside inputs, dialogs, open dropdowns.

### Persisted state summary
| Key | Store | Scope | Content |
|---|---|---|---|
| `qym:dashboard-state:<slug>` (`getDashboardStateKey` 7800) | sessionStorage | per project | filters, quickFilter, customRange, origin, versioning filters, models-view state, chart first-col width |
| `qym:runs-selection:<slug>` | sessionStorage | per project | `{selected[], cohortA[], passRevisions{}}` |
| `qym:runs-cache:<slug>` | sessionStorage | per project | last runs payload (15 min) |
| `window.__QYM_RUNS_PAGE_CACHE__` | window (survives in-app nav) | per request key | last 4 pages (5 min) |
| `qym_visible_metrics` | sessionStorage | global | `{version:2, visible:[metric names + __runs_col_<col>__ keys]}` |
| `qym:runs-frozen-columns` | localStorage | global | frozen identity column keys |
| `qym:single-key-shortcuts` | localStorage | global | `'off'` |
| `qym:last-project-slug` | localStorage | global | last project |
| `qym:chart-card-h:<["task","dataset"]>` | sessionStorage | per card | px height |
| `qym:topbar-stats` (shell) | sessionStorage | — | last KPI chips |
| `data-qym-segmented-key` (`run-origin`, `overview-run-origin`, `overview-trend-range`, `chart-row-<card>`…) | handled by `ui_components.js` | — | last segmented choice |
| `compareRuns`, `compareCohorts`, `dashboardRunFile` | sessionStorage | handoff to /compare and run page |

## 3. Functional inventory

### Command bar (index.html 19–83, charts.html 19–70)
| Feature | Keep? | Note |
|---|---|---|
| Search runs by name/id, debounced 200 ms, server-side `filters.q`, `/` shortcut, Esc clears | MUST-KEEP | `?q=` in URL |
| Time range segmented All/Today/7d/30d + custom Range dialog (from/to, open-ended allowed, validation copy at 9159–9170) | MUST-KEEP | local-day bounds → ISO `since/until` (`timeFilterBounds` 713) |
| Origin segmented All/Official/Local | MUST-KEEP | `filters.origins:[x]` |
| Multi-select dropdowns with search, "Only" per option, select-all/clear, `__none__` state, "Empty / Missing" option (`__empty__`), facet values constrained by the other active filters (server `facets`) | MUST-KEEP | `buildMultiSelect` 981–1128; owner values are user ids labelled via `overview.owners` |
| Dynamic versioning-metadata dropdowns, one per key in `facets.versioning` | MUST-KEEP | not URL-encoded today (open question) |
| Clear-all button with active count badge | MUST-KEEP | `countActiveFilters` 5849 |
| Columns menu: show/hide metric columns, base columns, trace metrics, latency columns; Frozen columns section (Runs only) with "unfrozen to fit" note | MUST-KEEP (columns) / NICE (frozen columns) | sticky-column sizing code 3819–4130 is ~300 lines of measurement; a CSS `position: sticky` table in React may suffice |
| Select mode toggle | MUST-KEEP | |
| Status bar: filter summary sentence, "ready runs only", Last Updated, freshness messages ("12 runs preparing · totals cover ready runs", "Some summaries need attention") | MUST-KEEP | `renderStatusBar` 5525, `renderDashboardFreshness` 8453 |
| Keyboard shortcuts + help modal + opt-out | MUST-KEEP | WCAG 2.1.4 opt-out is required |

### Runs table
| Feature | Keep? |
|---|---|
| Columns: Run (checkbox, repeat chevron, name link, `xN` pass count, Official badge), Status, Task, Model (colour dot + reasoning badge), Dataset (version + alias tags), Owner (avatar initials), Date, Analysis, Experiment, Version (`branch/commit`), `[metric columns]`, ⚡ Avg/Median latency, `[⚡ trace metrics]`, Duration, Actions | MUST-KEEP |
| Metric cell: smart decimals using `metric_neighbor_values`, colour class by metric type/direction, ⚠ error details popover, high-noise "i" marker when `samples < 2*report_k`, scored-vs-all mean | MUST-KEEP (logic lives in `metrics.js`, port as-is) |
| Row rebuild diffing by html string | DROP (React reconciles) |
| Horizontal scrollbar mirror pinned above the status bar (`.qym-scroll-mirror`) | NICE |
| Frozen identity columns with fit-to-width fallback | NICE |
| Repeat-run inline passes panel with group metrics, threshold slider, per-pass select/delete | MUST-KEEP |
| Row dblclick opens run; single click focuses (or toggles passes) | NICE |
| Execution-error details modal (`showExecutionErrorDetails` 1779) | MUST-KEEP |
| Delete / submit / approve / reject / unapprove / unreject / transfer modals + toasts | MUST-KEEP |
| `alert()` on delete failure (7340, 7343) | DROP (use toast/error state) |
| Grid view / Timeline view (`renderGridView` 5414, `renderTimelineView` 5463) | DROP-CANDIDATE: no page has those containers any more |
| Legacy `GET /api/runs` paged full-fetch path (`_fetchRemainingPages` 7991) | DROP: only used when no dashboard overview; all three pages use `/api/dashboard/*` |

### Charts
| Feature | Keep? |
|---|---|
| One card per task, dataset tabs with run counts | MUST-KEEP |
| Model legend toggle / solo | MUST-KEEP |
| Mini-bar score cells, numeric cells, latency bars, trace-metric cells, per-model colour index | MUST-KEEP (re-do with the chosen chart lib or plain divs — see §8) |
| Sortable column headers per card, first-click direction rule | MUST-KEEP |
| Rows / Grouped (model, version, version→model, model→version) with aggregate header rows, collapse, expand-all | MUST-KEEP |
| Group Pass@K / Consistency / Reliability columns (server stats, batched) | MUST-KEEP |
| First-column drag resize (280–720 px) | NICE |
| In-place DOM morphing (`morphChartNode` 2390) and bar "arrive" animations | DROP (React) |
| Lazy per-card history with budgeted eviction (5 000 rows) | MUST-KEEP (as TanStack Query per `[task,dataset]`) |

### KPIs / topbar
| Feature | Keep? |
|---|---|
| Five KPIs with exact labels, tooltips, formats (`formatCount` → `1.2M`, `formatPercent` floor to 0.1, `<0.1%`) and scope label "All runs"/"Filtered runs" | MUST-KEEP — `tests/platform/test_runs_kpis_browser.py` asserts topbar and overview agree |
| Secondary chips (Models, Items) yield space on narrow windows | NICE |

### Overview
| Feature | Keep? |
|---|---|
| KPI cards, Live/Recent/Approved tables, Pending reviews list, Trend card | MUST-KEEP |
| 10 s live polling, 2 s reload while updating | MUST-KEEP (as query refetch intervals) |
| Trend SVG with hover tooltip, delta colouring by direction, empty states ("No finished runs in the last 30 days … latest finished run is from 3 days ago") | MUST-KEEP |
| Origin toggle | MUST-KEEP |

### Insights
`insights.js` — DROP-CANDIDATE: not loaded by any page; the Overview trend superseded it. Keep
the backend route decision for later.

## 4. Data & API contract

All calls: same-origin cookie session (no auth header); `Content-Type: application/json`; the
UI treats 401 as "sign in again", 404 on a project as "not found", other non-2xx as
`HTTP <status>`. Error body is FastAPI `{detail: string}` (legacy run endpoints may return
`{error: string}` with HTTP 200 — `/api/runs/{id}/passes`, `group-metrics`). Root path:
pages are served with `window.__QYM_ROOT_PATH__` injected (`api/runs.py:1267`) and all URLs
must be prefixed with it.

Filters object (shared by every `/api/dashboard/*` call, parsed in `api/dashboard.py:64`):
```ts
type DashboardFilters = {
  tasks?: string[]; models?: string[]; datasets?: string[]; statuses?: string[];
  versions?: string[]; users?: string[];           // owner user ids
  origins?: ('official'|'local'|'__none__')[];
  versioning?: Record<string, string[]>;           // any versioning_metadata key; '__empty__' = runs without the key
  since?: string; until?: string;                  // ISO; local-day bounds computed client-side
  q?: string;                                      // ≤200 chars, server lower-cases
}
// each list ≤1000 values; '__none__' in a list = match nothing; '__empty__' = empty/missing value
```
Model keys carry a variant suffix: `"<provider/name>|||plain"` or `"…|||reasoning"`; `nomodel` is the empty model.

Row shape (`_row`, `api/dashboard.py:460` = descriptor ∪ summary.data; descriptor built at
`services/dashboard_summaries.py:1012`, summary at `:1583`):
```ts
type RunRow = {
  // descriptor
  run_id: string; file_path: string /* == run_id */; run_name: string; external_run_id: string;
  task_name: string; model_name: string /* raw, provider kept */; dataset_name: string;
  dataset_version: string|null; dataset_aliases: string[]; dataset_slug: string|null;
  timestamp: string; started_at: string|null; last_event_at: string;
  metrics: string[]; metric_specs: Record<string, MetricSpec>;
  samples: number; report_k: number|null; last_completed_pass: number|null; pass_revision: number;
  git_branch: string|null; git_commit: string|null;
  owner: {id: string; email: string; display_name: string}|null;
  approval: {decision: string; decision_by: {display_name,email}|null; comment: string|null}|null;
  status: 'DRAFT'|'PENDING'|'RUNNING'|'COMPLETED'|'FAILED'|'STOPPED'|'SUBMITTED'|'APPROVED'|'REJECTED';
  status_reason: string|null; stop_requested: boolean;
  trace_stats: {avg_tokens?, avg_llm_calls?, avg_tool_calls?, tool_success_rate?, has_reasoning?, …}|null;
  ingest_incomplete: boolean; origin: 'official'|'local'; experiment: {id,name,job_id}|null;
  versioning: Record<string,string>; versioning_details: Record<string,unknown>;
  langfuse_url?: string|null; product_eval?: unknown;
  // summary (absent/partial while summary_state === 'pending')
  summary_state: 'published'|'pending'; _revision: number; model_key: string;
  metric_averages: Record<string, number>; metric_scored_averages?: Record<string, number>;
  total_items: number; progress_completed: number; progress_total: number|null; progress_pct: number|null;
  success_count: number; error_count: number; not_received_count: number;
  execution_count: number; execution_success_count: number; execution_error_count: number;
  task_error_count?: number; metric_error_count?: number; metric_error_counts?: Record<string, number>;
  total_retries: number; success_rate: number; avg_latency_ms: number|null; median_latency_ms: number|null;
  duration_ms: number|null; analysis_cause_count: number;
  pass_summaries: {pass_number, status, primary_metric, primary_score, error_count, task_error_count, metric_error_count, metric_error_counts, retry_count, analysis_cause_count}[];
  metric_neighbor_values?: Record<string, [number|null, number|null]>;   // added by /runs only
}
type Freshness = { revision: number; catalog_revision: string;
  freshness: { updating: boolean; pending_partitions: number; backfilling: boolean;
               unpublished_runs: number; failed_partitions: number; oldest_pending_at: string|null } }
```

| Method | Path | Query / body | Response | Used by |
|---|---|---|---|---|
| POST | `/api/dashboard/runs` (`api/dashboard.py:1350`; GET twin at 1050) | `{project_slug, filters, sort?: 'time-desc', limit≤500 (UI 50), offset, ids?: string[]≤100 (pinned rows), include_overview?: bool, include_config_groups?: bool, collation?: string[]}` | `{tasks: {[task]: {[model]: RunRow[]}}, rows: RunRow[] (page order), pinned_rows: RunRow[], total_runs (filtered), total_count (project), has_more, offset, limit, project, overview?: Overview, …Freshness}` | `fetchDashboardPage` 8470; Overview page lists (`summaryRuns` overview.html:608); model run picker 6768 |
| POST | `/api/dashboard/overview` (1386) | `{project_slug, filters, sort?, collation?}` | `Overview` (below) | charts page 8272; collation bootstrap 8494 |
| POST | `/api/dashboard/kpis` (1414) | `{project_slug, filters}` | `{kpis: {scope:'project'|'filtered', runs, models, items, execution_success: number|null, runs_with_errors}, project, …Freshness}` | overview.html `loadKpis` 641 |
| POST | `/api/dashboard/points` (1426) | `{project_slug, filters, task, dataset, limit≤500, offset, sort, collation?}` | same as `/runs` without `pinned_rows`/neighbors | chart history 8391 |
| POST | `/api/dashboard/models/stats` (`api/dashboard_stats.py:133`) | `{metric, threshold, is_boolean, direction: 'maximize'|'minimize'|null, groups: [{key, runs: string[]}]}` (≤100 groups, ≤2000 runs) | `{groups: {[key]: {passAtK, consistency, reliability, …}}, missing: string[]}` | chart grouped columns 6356 |
| POST | `/api/dashboard/trend` (`dashboard_stats.py:409`) | `{project_slug, days: 7|30|90, task?, dataset?, tz_offset_minutes}` | `{days, since, until, tasks: [{task, dataset, runs}], task, dataset, metric, direction, latest_run_at, points: [{date:'YYYY-MM-DD', runs, metric_runs, metric_mean: number|null, execution_success: number|null}], summary: {runs, metric_mean, previous_runs, previous_metric_mean, delta, execution_success}|null}` | overview trend |
| POST | `/api/dashboard/neighbors` (`dashboard_stats.py:659`) | `{project_slug, run_id, filters, sort, collation?}` | `{run_id, context:'list'|'default'|null, position, total, previous: {run_id, run_name, model, started_at, primary:{metric,value,spec}|null}|null, next: …}` or `{collation_needed:true, sort, sort_values[]}` | run page (consumer of the `?list=` context produced here) |
| GET | `/api/corrections?status=pending&limit=12&project_slug=` (`api/analysis.py:9346`) | — | `{corrections|items: [{id, ai_root_cause, human_root_cause, …}], total, next_cursor, …}` | overview pending reviews |
| GET | `/v1/me` (`api/web.py:40`) | — | `{id, email, display_name, role:'ADMIN'|…, projects:[{slug,name,role,is_active,id,…}], default_project, …}` | shell (`window.__QYM_USER__`) |
| GET | `/api/runs/{id}/passes` (`api/runs.py:4813`) | — | `{passes:[{pass_number,status,metric_means,…}], metrics, latency:{avg,median,p95}, …}` or `{error}` | samples panel |
| GET | `/api/runs/{id}/group-metrics?metric=&threshold=` (5203) | — | group stats + accuracy-vs-k band, or `{error}` | samples panel |
| POST | `/api/runs/delete` (6972) | `{file_path}` | `{ok, purge_after_days}` / 403 / 404 | delete modal |
| DELETE | `/api/runs/{id}/passes/{n}` (5107), `/api/runs/{id}/passes` (5136) | — | — | pass delete |
| POST | `/v1/runs/{id}/submit` (7190), `/v1/runs/submit` (7208) | `{comment}` / `{run_ids, comment}` | `{ok, status}` | submit |
| POST | `/v1/runs/{id}/approve|reject|unapprove|unreject` (7412–7442) | `{comment}` | `{ok, status}` | review actions |
| POST | `/v1/runs/{id}/owner` (7273) | `{user_id}` | `{owner:{display_name,email}}` | transfer |
| GET | `/v1/projects/by-slug/{slug}` (`api/projects.py:888`), `/v1/projects/{id}/members` (910) | — | `{id,…}`, `{members:[{user_id,email,display_name,is_active}]}` | transfer modal |

`Overview` (`services/dashboard_views.py:273`, `api/dashboard.py:741`):
```ts
type Overview = Freshness & {
  project; total_count: number; total_runs: number;               // project / filtered
  aggregations: {totalRuns,totalTasks,totalModels,totalItems,avgSuccess,byModel,byTask,byDay};
  all_models: string[]; all_metrics: string[]; metrics: string[];  // metrics = in filtered set
  metric_types: Record<string,'score'|'numeric'|'boolean'|…>; metric_specs: Record<string,MetricSpec>;
  has_trace_stats: boolean; has_active_runs?: boolean;
  facets: {tasks: string[]; models: string[]; datasets: string[]; statuses: string[]; versions: string[]; users: string[]; origins: string[]; versioning: Record<string,string[]>};
  owners: Record<userId, {id,email,display_name}>;
  sort_values: {tasks: string[]; models: string[]; dataset_names: string[]; git_commits: string[]; owner_names: string[]};
  kpis: Kpis; filtered_revision: string;
  chart_data: {
    combos: Combo[]; tasks: {task: string; datasets: Combo[]}[]; models: string[] /* by frequency */;
    metrics: string[]; modelIndex: Record<string,number>; model_frequency: Record<string,number>;
  }
}
type Combo = { task; dataset; totalRuns; revision: string; metrics: string[];
  models: Record<modelKey, {runs; runsList: RunRow-lite[] /* empty in the overview; filled client-side from /points */;
    totalItems; latestTimestamp; metricSums; metricCounts; metricAverages: Record<string,number>;
    avgLatencyMs; medianLatencyMs; latencySum; latencyCount}> }
```
Client reshaping worth knowing: `flattenRuns` (1807) adds `_date`, `completion_rate`,
`success_on_completed_rate`, `model_key`, `display_model`; `buildDashboardChartData` (8250)
replaces a combo with one recomputed from the loaded `/points` rows (`computeChartData` 1928)
and sorts `models` by frequency; model display strips the provider prefix
(`stripModelProvider` 783). Metric type detection and formatting are in
`metrics.js` (`QymMetrics.formatMetricValueSmart`, `getMetricColorClass`, `metricDeltaVerdict`,
`defaultMetricName`, `calculateMedian`) — port that module to TS first; many pages depend on it.

## 5. Shared dependencies

| Primitive | From | Used here for |
|---|---|---|
| `QymShell.pageSignal()`, `qym:before-navigate`, `qym:shell-ready` | shell.js 1612, 1894, 2080 | abort listeners/requests on in-app navigation; wait for user |
| `QymShell.getPageContext()` → `{projectSlug, page, subId}` (shell.js 160–203), `getProject()` | shell.js | slug resolution |
| `QymShell.replaceUrlQuery(updates)` (1800) | shell.js | URL state writes |
| `QymShell.setTopbarStats(stats, {scope, scopeTitle})` (2264) | shell.js | KPI chips in `#shell-topbar-stats` |
| `QymShell.announceRunStatus`, `qym:run-status` (1655) | shell.js | cross-page/tab stop notifications |
| `QymShell.skeletonHTML(kind)`, `liftSkeleton`, `arrive`, `noteSkeletons`, `retireRemovedSkeletons`, `data-qym-skeleton`, `data-qym-arrive` (2609–2891) | shell.js | loading → content crossfades |
| `QymShell.datasetVersionInline`, `datasetAliasTags` (2566) | shell.js | dataset cell tags |
| `QymShell.navigateTo` | shell.js | in-app links |
| `QymUIComponents.renderPagination(host, {page,pageCount,pageSize,total,start,end,noun,onPageChange})` (ui_components.js:71) | ui_components.js | status-bar pager |
| `QymUIComponents.classifyError`, `renderErrorState(host,{title,error,onRetry})` (1403, 1457) | ui_components.js | first-load error |
| `QymUIComponents.openDialog/releaseDialog`, help markers (`.qym-help-marker`), segmented memory (`data-qym-segmented-key`), `enhanceSelect` | ui_components.js | modals, KPI tooltips, segmented controls |
| `QymSafe.escapeHtml`, `textDirAttrs` | qym_safe.js | escaping; RTL for Arabic names |
| `QymAuth.renderAuthGate`, `loginUrl` | auth.js | 401 handling |
| `QymMetrics.*` | metrics.js | all metric formatting/semantics (see §4) |
| `QymKpis.entries/scope/renderTopbar/formatCount/formatPercent` | kpis.js | KPI definitions — **defined by this area**, consumed by Overview, Runs, Charts, Models |
| `QymRunsOrder.*` | runs_order.js | **defined by this area**, consumed by the run page (`run.html:9232`) for prev/next; tested by `tests/platform/test_runs_order_js.py` |
| `qym_table.js` | — | loaded by index.html but not used by dashboard.js (used by datasets/experiments/trash) |
| `QymLive.poll` | qym_live.js | not used here (dashboard.js has its own cadence logic); good candidate to replace both pollers |

## 6. Design-token usage

From `docs/DESIGN_LANGUAGE.md`: text ramp `--text-primary/secondary/muted/dim` (never dim for
readable content); type roles `--font-title` (overview h1), `--font-stat` (KPI values, mono,
tabular-nums), `--font-xl` (trend headline value), `--font-md` (card titles), `--font-base`
(cells), `--font-sm` (table headers, meta, axis labels), `--font-xs` (badges only); spacing
`--space-xs..xl`; surfaces `--bg-void/base/surface/elevated/hover/active`; borders
`--border-subtle/default/strong`; semantic `--success/--warning/--error/--metric-error/--info`;
score scale `--score-1..5`; chart colours `--chart-1..5`; accents
`--accent-primary/secondary/tertiary(-soft)`; `--font-mono` only for ids, values, timestamps,
version strings.

Area-specific CSS that should become component styles (all in `dashboard.css`, 11 998 lines):
command bar 791–1340 (`.command-bar`, `.quick-filters`, `.time-range-*`, `.filter-btn`,
`.multi-select-*`, `.versioning-filters`, `.clear-filters-btn`, `.filter-count-badge`),
selection actions 1339–1430, runs page/table 1494–1580 and 2815–3520 (`.runs-table`,
frozen/hidden column attribute selectors 3424–3506, `.select-mode`), owner/model/metric cells
3593–3814, actions dropdown 3915–4004, status bar 4173–4202, toasts 4653–4743, status badges
4759–4781, charts 1605–2800 (`.charts-*`, `.chart-card`, `.chart-dataset-tab(s)`,
`.chart-table-*`, `.chart-mini-bar-*`, `.chart-col-*`, `.chart-group-*`, `.chart-segment-*`,
`.chart-bar-fill[data-model-idx="0..19"]` colour mapping 2740–2759), Columns menu `.mv-*`
10636–10681, samples panel 10708–11196. Overview styles are inline in overview.html 14–106
(`.stat-card`, `.overview-card`, `.recent-table`, `.ovt-*` trend classes, `.live-status-dot`).

Sanctioned exceptions / violations to watch: `CHART_COLORS` is a **hardcoded 20-hex palette
in JS** (dashboard.js 265–271) used for model dots, legend and bar fills — the design language
only defines `--chart-1..5`; insights.js already uses a token palette. The trend tooltip uses
`rgba(0,0,0,0.35)` shadow and `.review-badge` uses `rgba(245,158,11,0.12)` inline. Overview
inline `style="font-size:var(--font-sm)"` on table cells. Status badge colours per status
(4774–4781) are a recipe to keep. `tests/platform/test_design_language.py` enforces the
rules on `_static/`; the React app will need an equivalent lint (stylelint/eslint rule on
hardcoded px/hex).

## 7. UX pain points observed

- The command bar carries 7+ dropdowns plus three segmented groups; on narrow widths it wraps
  into three rows (`test_command_bar_wraps_instead_of_widening_the_page`), pushing the table
  down. Versioning-metadata dropdowns appear/disappear as facets change, shifting layout.
- Filters are URL-encoded but versioning filters, column visibility and chart state are not:
  a shared link loses part of the view; Back after a versioning filter change may differ.
- URL vs sessionStorage precedence rule ("any view key makes the URL the whole view") is
  subtle; a bare sidebar link silently re-applies the tab's old filters.
- Text sorts need a two-step collation round trip (overview → runs), and the sort keys
  `metric-<name>-desc` break if a metric name contains `-` (parsed by split, 2235–2250).
- Status column overloads one badge with status, pass cursor, percent, counts, error
  glyphs, retry glyph and ingest marker; tooltips are the only explanation (hover-only, not
  reachable by keyboard for `.status-badge`).
- Actions column mixes a dropdown trigger and two icon links with `href="#"`; icons rely on
  `title`. The review dropdown opens on click but has no arrow-key navigation.
- Delete failures use `window.alert`. Toasts are custom (`showToast` 9476) and differ from the
  shell's `QymShell.toast`.
- Frozen columns: the table measures widths on every render (`scheduleRunsStickyColumnSizing`),
  can "unfreeze to fit" and shows an explanatory note; feels fragile and jumps on resize.
- Horizontal scrolling of a 15+ column table with a detached scrollbar mirror is confusing;
  no column resizing on the Runs table (only on charts' first column).
- Charts page: no actual axes or scales; every bar is relative to the max within the card
  and bars for `numeric` metrics of different magnitudes sit side by side. Grouped mode
  hides the Pass@K columns the moment any group is expanded. The cards reflow when
  history arrives unless the remembered height matches.
- Overview reloads the whole page every 2 s while summaries are updating; Live Runs polls
  every 10 s regardless of whether there are live runs. The trend tooltip is mouse-only
  (`mouseenter` on hit rects, no focus/keyboard).
- a11y: `role="button"` spans with `tabindex=0` for chart headers (keyboard handled, but
  no `aria-sort`); legend items are buttons with `aria-pressed` (good); multi-select
  options are checkboxes inside a `div.open` without `role="listbox"`/`aria-expanded` on
  the trigger; the search box relies on a visible `/` glyph; KPI help tooltips are
  `role=tooltip` toggled by a button (ok). Dark-only palette; contrast of `--text-dim`
  glyphs is below AA by design.
- Performance: `render()` re-populates all six dropdowns on every poll; `renderTableView`
  stringifies every row to diff; `JSON.stringify` of the whole page as a change signature.

## 8. Migration notes

### Proposed component tree and routes
Routes (React Router, nested under `/projects/:slug`): `/` (RunsPage), `/charts` (ChartsPage),
`/overview` (OverviewPage). Keep `/run/:id` redirect handling in the shell brief.
- `ProjectShell` (sidebar/topbar; from the shell brief)
  - `TopbarKpis` (uses `useKpis(slug, filters)`; `kpis.ts` port of kpis.js)
  - `RunsPage`
    - `RunsCommandBar`
      - `RunSearchBox` (debounced, `/` hotkey)
      - `SelectModeToggle`
      - `ColumnsMenu` (metric/base/trace/latency columns; `FrozenColumnsSection` optional)
      - `TimeRangeControl` (`QuickRangeSegmented`, `CustomRangeDialog`)
      - `OriginSegmented`
      - `FacetDropdown` ×6 + `VersioningFacetDropdowns` (one shared `MultiSelectFacet` with search, Only, select-all, `__none__`, `__empty__`)
      - `ClearFiltersButton`
    - `RunsTable` (TanStack Table; column defs from `allMetrics`/visible set)
      - `RunNameCell`, `StatusCell` (+`ExecutionErrorsPopover`, `StoppingBadge`), `ModelCell`, `DatasetCell`, `OwnerCell`, `DateCell`, `AnalysisCell`, `ExperimentCell`, `VersionCell`, `MetricCell`, `LatencyCell`, `TraceMetricCell`, `DurationCell`, `RowActionsCell` (`ReviewActionsMenu`, `SubmitButton`, `DeleteButton`)
      - `RepeatRunPassesPanel` (expanded row; `GroupMetricsStrip`, `PassRow`)
      - `RunsEmptyState`, `RunsErrorState`, `RunsStaleBanner`
    - `RunsStatusBar` (`FilterSummary`, `SelectionActions` [`CompareButton`, `CohortButton`, `SubmitSelectedButton`, `DeleteSelectedButton`, `ClearButton`, guidance live region], `Pagination`, `LastUpdated`/`FreshnessNote`, `ShortcutsHelpButton`)
    - Modals: `DeleteRunDialog`, `WorkflowDecisionDialog`, `SubmitRunsDialog`, `TransferOwnershipDialog`, `ShortcutsHelpDialog`
    - `useRunsKeyboard()` hook (j/k/g/G/Enter/x/c/Esc/1-4, opt-out setting)
  - `ChartsPage`
    - `RunsCommandBar` (variant without search/select)
    - `ChartsHeader` (`ModelLegend`)
    - `TaskChartCard` ×N
      - `DatasetTabs`
      - `ChartToolbar` (`RowModeSegmented`, `GroupAxisSegmented`, `ThenAxisSegmented`, `ExpandAllButton`)
      - `ChartTable` (`ChartHeaderRow` with sortable headers + `FirstColumnResizer`, `ChartRunRow`, `ChartGroupHeaderRow` with `GroupStatCells`, `MetricBarCell`, `NumericCell`, `LatencyBarCell`, `TraceCell`)
      - `ChartHistorySkeleton` / `ChartHistoryError`
  - `OverviewPage`
    - `OverviewHeader` (project name, `OriginSegmented`)
    - `KpiCards` (`KpiCard` ×5 with `HelpMarker`)
    - `LiveRunsCard`, `RecentRunsCard`, `ApprovedRunsCard`, `PendingReviewsCard` (shared `OverviewCard` + `MiniRunsTable`)
    - `TrendCard` (`TrendControls` [task/dataset select, range segmented], `TrendSummary`, `TrendChart`, `TrendEmptyState`)

### State placement
- **URL (search params, replace not push):** `task[]`, `model[]`, `dataset[]`, `status[]`,
  `version[]`, `owner[]`, `range`, `from`, `to`, `origin`, `q`, `sort`, `page`; add
  `v.<key>[]` for versioning filters (new, see §9). Overview: `range`, `task`, `dataset`.
  Keep `runs_order.ts` producing the same `?list=` context string so the run page keeps
  working during the migration (the format is tested in `test_runs_order_js.py`).
- **sessionStorage (per project):** last filters for bare navigation (if the precedence rule
  is kept), selection + cohort A, visible columns, chart card heights. **localStorage:**
  frozen columns, single-key shortcuts opt-out, last project slug.
- **Local component state:** select mode, focused row, open dropdown, chart sort/group/
  expansion per card, active dataset tab, first-column width, modal open state.
- **Server cache (TanStack Query) keys:**
  - `['me']`
  - `['dashboard','runs', slug, filters, sort, collation, page, pinnedIds]` → `/runs`
    (`placeholderData: keepPreviousData`, `refetchInterval` computed from
    `has_active_runs`/`freshness.updating`/stop-requested, `refetchIntervalInBackground: false`)
  - `['dashboard','overview', slug, filters, sort, collation]` → `/overview` (staleTime 60 s unless `freshness.updating`)
  - `['dashboard','kpis', slug, filters]`
  - `['dashboard','points', slug, filters, sort, collation, task, dataset]` → `useInfiniteQuery` until `has_more=false`
  - `['dashboard','models-stats', rule, groupKeys]` (batch with a 0 ms debounce as today)
  - `['dashboard','trend', slug, days, task, dataset, tzOffset]`
  - `['corrections','pending', slug]`
  - `['run','passes', id]`, `['run','group-metrics', id, metric, threshold]`
  - `['project','members', projectId]`
  - Mutations (submit/approve/reject/unapprove/unreject/owner/delete): on success patch the
    row's `status` in the `runs` cache immediately (today's `applyRunWorkflowResult`) and
    invalidate `runs`, `overview`, `kpis`.

### Backend changes likely needed
- SPA fallback for `/projects/{slug}`, `/projects/{slug}/charts|overview|…` and asset
  serving for the Vite build (today each page is its own HTML with `__QYM_ROOT_PATH__`
  rewriting, `api/runs.py:1267`). Dev: Vite proxy for `/api`, `/v1`, `/static` with cookies
  (same-origin cookie auth; no CORS needed if proxied, else `allow_credentials`).
- Expose `tz_offset_minutes` and local-day range computation as-is; no change.
- Optional: have `/overview` accept `collation` omitted and return `sort_values` always (it
  does) — the two-step collation can be kept client-side.
- Optional (recommended): let `/api/dashboard/runs` accept a plain model name and expand
  variants server-side, so the URL/plain-name expansion logic (`pruneUrlModelVariants` 9651)
  disappears.
- `GET /api/runs/{id}/passes` and `group-metrics` return `{error}` with 200; switch to proper
  4xx or handle in the client.
- Replace `window.alert` paths; nothing server-side.

### Risks / gotchas
- Status freshness: after `f3c70f1` status is exact on every poll, but **numbers lag**; show
  `freshness.updating` honestly and never derive KPIs from loaded rows (kpis.js header
  comment; `test_runs_topbar_and_overview_show_the_same_kpis`).
- Request races: today every fetch is keyed by `dashboardPageRequestKey()` and stale answers
  are discarded (8519); with TanStack Query use the query key for this, plus `AbortSignal`.
- Pinned rows: selected runs that are off-page are fetched via `ids` (≤100 per call, batched)
  so Compare/Delete have their data; keep this or store the needed fields with the selection.
- Chart history payload: up to 5 000 rows kept in memory, 500 per request; render only the
  open dataset per task; virtualize rows when a combo has > ~300 runs.
- Collation must use `localeCompare` with the exact rules in `runs_order.js` (`compareModelKeys`
  strips provider, plain before reasoning; ties broken by code-point order) so list and run
  page agree.
- `metric-<name>` sort keys and metric names containing `-`: define sort as a structured
  object client-side and only serialize to the server string.
- `__none__`/`__empty__` sentinel values and model `|||plain/|||reasoning` suffixes leak
  into URLs; keep them (other pages and tests depend on them) but isolate in one codec module.
- Polling in hidden tabs must stop (`document.hidden`); `BroadcastChannel` run-status events
  must trigger a refetch.
- Repeat-run selection uses `#pass<k>` refs and `pass_revision` to drop stale picks
  (`reconcilePassVersions` 7862).
- Charts "arrive" animations and DOM morphing are tied to `QymShell`; drop them, but keep
  remembered card heights to avoid layout jumps.
- Keyboard shortcuts must not fire inside inputs, dialogs or open menus, and must be
  disable-able (WCAG 2.1.4).

### Charting library recommendation
Use **Recharts** (one library for the whole app). Reasons: React-native declarative API that
fits TanStack Query data without imperative refs; SVG output so `--chart-*`, `--text-muted`
and `--border-subtle` CSS variables apply directly to `stroke`/`fill` (dark/light parity
for free); composed charts cover the Overview trend (LineChart + Bar for runs/day with two
Y axes and a custom Tooltip), the Charts page bars (horizontal `BarChart` per metric column
or a single `ComposedChart` per card), sparklines in KPI cards if the design agent wants
them, and the Insights timeline if it is revived; keyboard/ARIA hooks via `accessibilityLayer`
(Recharts ≥ 2.12) address the mouse-only tooltip problem; bundle cost (~45 kB gz) is small
compared with d3-by-hand and much smaller than ECharts/Plotly; no canvas, so Playwright can
assert on DOM. Rejected: Chart.js (canvas, imperative, no CSS-variable theming), ECharts
(heavy, canvas), visx/d3 (more control but far more code for a team migrating 10k lines of
vanilla JS), Nivo (heavier, opinionated themes). The mini-bar cells in the charts table can
stay plain `div`s with `width:%` if the design agent prefers; use Recharts only where axes,
tooltips or multiple series are needed. **The design agent will apply the `dataviz` skill**
(palette, form heuristic, mark specs, tooltip/legend rules) before any chart component is
written; this brief does not pick colours.

### Suggested Playwright scenarios
1. Load `/projects/{slug}?task=a&status=COMPLETED&sort=model-asc&page=2`: dropdown buttons show the selections, header `aria-sort`, pager on page 2, URL unchanged after render.
2. Type in search, wait 200 ms: request body has `filters.q`, URL has `q=`, `/` focuses the box, Esc clears it.
3. Start a run in the fixture, poll: status badge goes RUNNING → COMPLETED in the list without reload, and the run page agrees (mirrors `test_run_status_list_detail_agree.py`).
4. Hidden tab does not poll; visible again refetches once (network count).
5. Select two runs with `x`, press `c`: navigates to `/compare` with `sessionStorage.compareRuns` set; Back restores the ticks.
6. Approve from the row menu as manager: row shows APPROVED immediately, toast appears, KPI "Runs with errors" unchanged, overview Approved Runs list gains the run.
7. Expand a repeat run: passes panel loads, per-pass checkbox makes parent indeterminate, threshold slider refetches group metrics.
8. Charts: switch dataset tab → history request with `task/dataset`, card keeps height; click a metric header twice → asc; Grouped by version shows Pass@K column; legend dblclick isolates a model and `?model=` updates.
9. Overview: change trend range to 30 days → URL `range=30d`, SVG re-renders with 30 x-labels budget; hover a day → tooltip text; keyboard focus reaches the tooltip trigger.
10. Open a run from a sorted/filtered list, then use the run page's next/prev: order matches the list (uses the `?list=` context and `/neighbors`).

## 9. Open questions

1. Should versioning-metadata filters, column visibility and chart sort/group state move
   into the URL (`v.<key>=`, `cols=`, per-card `chart=`)? Today they are sessionStorage/
   memory only; the component agent must decide and keep `runs_order.ts` context keys in sync
   (the run page's neighbor order currently ignores versioning filters — a latent bug).
2. Keep the "bare URL restores the tab's last filters" precedence rule, or make the URL the
   only source of truth (simpler, but changes sidebar-link behaviour users may rely on)?
3. Keep server-ordered text sorts with client collation, or move collation server-side
   (`ICU`/`LOWER` ordering) and drop `sort_values` + `collation`? Affects `/neighbors` too.
4. Frozen columns: implement with CSS `position: sticky` only (no fit-to-width fallback), or
   drop the feature? Current code is ~300 lines of measurement.
5. Grid/Timeline views and the legacy `/api/runs` full-fetch path: confirm removal.
6. `insights.js` and `GET /api/projects/{slug}/insights`: delete, or re-home as a chart on
   the Overview (the trend covers one task; insights covered many metrics over time)?
7. `CHART_COLORS` 20-colour palette vs the design language's five `--chart-*` tokens: the
   design agent must supply ≥ 20 distinguishable model colours (or switch to hashed hues) and
   the model-colour index must stay stable across Runs, Charts, Models and Compare.
8. Overview's 2 s whole-page reload while updating and Live Runs' unconditional 10 s poll:
   replace with one query refetch interval derived from `has_active_runs`/`freshness`?
9. Pinned (off-page) selected rows: keep the `ids` round trip, or snapshot the row fields
   needed by Compare/Delete into the persisted selection?
10. `__none__` / `__empty__` / `|||plain` sentinels in public URLs: keep for compatibility with
    bookmarks and the run page, or introduce a clean codec and a redirect for old links?
11. Which toast system: port `showToast` (dashboard.js 9476) or use the shell's toast for all
    three pages?
