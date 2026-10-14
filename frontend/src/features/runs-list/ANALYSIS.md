# Runs list / Overview / Charts — analysis (area 03)

Walked on 2026-10-11 against the vanilla pages on port 8801 (`QYM_AUTH_MODE=none`,
SQLite, project `demo` seeded through the ingest API by
`frontend/scripts/seed_runs.py`: 43 runs, 3 tasks, 5 datasets, 2 models, statuses
COMPLETED/FAILED/STOPPED/SUBMITTED/APPROVED/REJECTED/RUNNING, two repeat runs
with `samples=3`, three git versions + one empty version). Screens captured for
`/projects/demo`, `?task=rag-qa&status=COMPLETED&sort=model-asc`, select mode,
the `?` help modal, `/charts` and `/overview`; every XHR was recorded.

## Confirmed (matches the brief)

- Requests: Runs page = one `POST /api/dashboard/runs` (`limit 50, offset,
  ids:[], include_overview:true`, `sort:'time-desc'`); a filter change
  re-sends it with `include_overview:true`; a **text sort** first fetches
  `POST /api/dashboard/overview` for `sort_values`, then `/runs` with
  `collation:[…]`. Charts = `/overview` + one `/points` per visible card.
  Overview = `/kpis`, `/trend` (`tz_offset_minutes`), three `/runs` list calls
  (`statuses:[RUNNING,PENDING] sort:activity-desc limit 8`; the seven non-live
  statuses `sort:created-desc limit 5`; `statuses:[APPROVED] limit 5`) and
  `GET /api/corrections?limit=12&status=pending&project_slug=`.
- URL codec exactly as §2.J2.3: `?sort=model-asc` written after a header
  click, `?q=…` after typing, repeated keys for multi-selects, `range/from/to`,
  `origin`, `page` only when > 1, sort only when ≠ `time-desc`.
- Columns (26 headers): Run name, Status, Task, Model, Dataset, Owner, Date,
  Analysis, Experiment, Version, one column per metric (7), ⚡ Avg/Median
  latency, four ⚡ trace columns, Duration, Actions. The Columns menu groups
  them as Run columns / Metrics / ⚡ System / ⚡ Trace Stats / Frozen columns.
- Status cell overload confirmed: `RUNNING • 50% • 5/10`, `3⚠` (`--error`),
  `1↻` (`--info`), `x3` pass count beside the name, chevron on repeat runs.
- Status bar: `43 runs · 0 selected  Compare Cohort Submit Delete Clear`,
  `1–43 of 43 runs [1] of 1`, `Last Updated: hh:mm:ss PM · ? Shortcuts`; with
  filters: `8 of 43 runs — task: rag-qa, status: Completed`.
- Topbar KPIs: `All runs · 43 runs · 95.4% execution success · 13 runs with
  errors · 2 models · 422 items`; the Overview cards show the same numbers
  (`test_runs_kpis_browser.py` contract); on Charts with filters the scope
  flips to `Filtered runs`.
- Overview: title = project name, Origin segmented top-right, 5 KPI cards
  with "i" markers and sub-line `All runs · 3 approved`, Live / Recent /
  Approved / Pending Reviews cards, Trend card (task·dataset select with run
  counts, 7/30/90 segmented, headline `94.7% +16.8 pts vs previous 7 days`,
  `4 finished runs · execution success 100.0%`, line + run bars).
- Charts: one card per task, dataset tabs with count tiles, legend of models
  (click toggle / dblclick solo), `Rows: Runs | Grouped`, metric mini bars
  relative to the card max, latency bars, trace columns `—` when absent.
- `runs_order.js` is the `?list=` codec the run page consumes; its tests
  (`tests/platform/test_runs_order_js.py`) pin the canonical key order
  `range,from,to,task,model,dataset,status,version,owner,origin,q,sort`.
- Keyboard: `/` focused the search; `?` opened the help modal; shortcuts are
  document-level and skip inputs/dialogs.

## What the brief got wrong or left open

- `model_name` in rows is **already provider-stripped** by the descriptor
  (`claude-sonnet-4`, `model_key = claude-sonnet-4|||plain`); the URL still
  accepts a plain name and expands to both variants.
- The Overview "Pending Reviews" list reads `corrections[]`; the payload also
  has `stats`, facets and `has_more` (not `items`).
- `has_active_runs` is `null` in the overview payload on this build even with a
  RUNNING row; the cadence must also look at the rows' statuses (the brief
  says "or any row is RUNNING/PENDING", so it already covers this).
- The `?` help modal in the vanilla build opens the **Columns** panel markup
  (help and columns share one dialog host); the shortcut list is in
  `dashboard.js` only. We ship a dedicated shortcuts dialog.
- The Playwright config from the foundation starts the platform with
  `QYM_ROLE=api`, which disables the dashboard summary worker, so `/api/
  dashboard/runs` stays empty forever in e2e. Removed for this area's runs
  (foundation change, reported).
- `frontend/src/lib/` was never committed on `ui/foundation`: the repo
  `.gitignore` has a Python `lib/` pattern. Copied from the foundation worktree
  and un-ignored on this branch (`!frontend/src/lib/`).

## Behaviours kept

Runs: search (200 ms debounce, `/`, Esc), time range + custom range dialog,
origin segmented, six facet multi-selects with Only/All/None/search, dynamic
versioning facets, Clear with count, Columns menu (per column, grouped),
select mode + header checkbox + status-bar actions (Compare → `sessionStorage.
compareRuns`, Cohort → `compareCohorts`, Submit, Delete, Clear), pager in the
status bar (50/page, clamped), Last Updated + freshness copy, stale banner on
refresh failure, first-load error state, empty project vs empty filter copy,
row cells as listed, metric cells with smart decimals and ⚠/↻ glyphs, repeat
run inline passes panel (group metrics + threshold slider + per-pass rows),
row actions (review menu, submit, delete, transfer), toasts, all keyboard
shortcuts with the opt-out, polling cadence (60/15/2 s, back-off, hidden tab
pause, visibility refetch, run-status bus), `?list=` context on run links,
selection persisted per project in sessionStorage, URL contract unchanged.
Charts: cards per task, dataset tabs, legend toggle/solo, mini bars, numeric,
latency and trace columns, sortable headers, Rows/Grouped with group stats,
lazy per-card history, remembered card height. Overview: everything above.

## Dropped / changed (logged in docs/internal/ui-migration/decisions/overview-runs-list/OPEN_QUESTIONS.md)

Grid/Timeline views, legacy `/api/runs` path, DOM morphing/diffing, scroll
mirror, frozen-column measurement (first column is CSS-sticky instead),
`window.alert`, page-level toast system, the "bare URL restores the tab's last
filters" rule (URL is the whole view; sessionStorage keeps only selection and
column visibility), versioning filters now URL-encoded as `v.<key>=`.
