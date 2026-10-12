# QA: Overview, Runs list and Charts (area 03)

Branch `ui/qa`. Old UI = vanilla at `7814183` (`_static/dashboard/{index,charts,overview}.html`, `dashboard.js`, `kpis.js`, `runs_order.js`).
New UI = `frontend/src/features/runs-list/` (there are no separate `overview`/`charts` folders; `OverviewPage.tsx` and `ChartsPage.tsx` live in `runs-list`).
Both were run side by side on the same seeded SQLite data (old on 8821, new on 8831; `frontend/scripts/seed_runs.py`, 62 runs, 2 models, 3 tasks, 2 repeat runs, plus `live`/`live2` projects with RUNNING rows) and driven with Playwright scripts. Statuses: **OK** = same behaviour verified, **CHANGED** = different, judged acceptable or not in Notes, **BUGGY** = reproduced defect, **MISSING** = not ported (and whether it is a logged drop in `decisions/overview-runs-list/OPEN_QUESTIONS.md`, "OQ").

Spec column = Playwright spec under `frontend/e2e/runs-list/` (unit tests under `src/features/runs-list/__tests__/` are named where relevant). "-" = no spec covers the row.
File refs are `frontend/src/features/runs-list/<file>:<line>` unless a path is given.

## Summary

Total 168 rows: OK 96, CHANGED 47, BUGGY 11, MISSING 14.

Headline defects (details in the Fix list): pass delete 409s after the first delete (no `expected_pass_version`); `c` with Cohort A locked opens a plain compare; pass and whole-run picks are not exclusive and duplicate refs reach /compare; the parent checkbox of an expanded repeat run selects the run, not its passes; the passes panel lost most of its per-pass detail; Overview lists changed meaning (Items) and lost columns; Back does not restore table scroll.

## Feature table

### A. Runs list: load, states, URL

| # | Old behaviour (source) | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| A1 | `/projects/{slug}` shows runs table, 50 per page, default sort time-desc, KPI chips in topbar | `RunsPage.tsx:44`, `useRunsData.ts:10`, `kpiTopbar.ts` | list-load | OK | Same 62 rows, same first rows, same topbar chips (62 runs / 94.7% / 20 / 2 / 608). |
| A2 | Skeleton (12 rows) while loading; cached page shown instantly on return | `RunsPage.tsx:123,276` `useDelayedPending` | list-load | CHANGED | Skeleton is delayed (no flash); instant cache is React Query's `keepPreviousData`/cache. Acceptable. |
| A3 | Empty project: card "No evaluation runs found" + link to first-run guide | `RunsPage.tsx:282-299` | list-load | OK | Verified on an empty project. New also renders the table header above the empty state (cosmetic). |
| A4 | Empty filter result: "No runs match current filters" | `RunsPage.tsx:301-319` | filters-sort-search | OK | Adds a "Clear filters" button (improvement). |
| A5 | "Run history is preparing..." while `unpublished_runs > 0` | `RunsPage.tsx:285,305` | cutover-backfill | OK | Not reproduced live (needs a backfill); spec covers it. |
| A6 | First-load error: error state with Retry | `RunsPage.tsx:269` | list-load | OK | Verified with a 500 route: "Could not load runs / HTTP 500 · boom / Retry". |
| A7 | Refresh error: rows stay, dimmed, banner "Couldn't refresh runs ... Showing runs from hh:mm:ss. Your latest filter, sort or page change is not applied." + toast | `RunsPage.tsx:124,386` `StaleBanner` | list-load | CHANGED | Verified: banner, dimmed rows, "refresh failed". Copy always says "Your latest filter change is not applied yet" even for a plain poll failure (`filtersApplied={false}` hard-coded, `:386`); no toast. Minor. |
| A8 | A failed fetch after a filter/sort/page change keeps the old rows (stale banner) | `RunsPage.tsx:269` | - | CHANGED | Verified: failing request after pressing `3` replaces the table with the full "Could not load runs" error (`keepPreviousData` drops on error). Old kept rows. Minor, arguably more honest. |
| A9 | 401 shows sign-in gate; 404 project -> not-found page | shell (`features/shell`) | shell specs | OK | Shell area; not re-tested here. |
| A10 | URL is the view: `task/model/dataset/status/version/owner` repeated, `range`, `from`/`to`, `origin`, `q`, `sort` (only if not time-desc), `page` (only if >1), `replaceState` | `urlState.ts:73-138`, `useRunsView.ts:20` | filters-sort-search, `urlState.test.ts` | OK | Verified `?task=text2sql&status=COMPLETED&sort=model-asc&q=gpt` round-trips: Filters button, chips, aria-sort, sentence, request body all agree; reload keeps it. |
| A11 | Model URL value: plain name expands to both `\|\|\|plain` and `\|\|\|reasoning`; collapses back | `urlState.ts:75,92` | `urlState.test.ts` | OK | Verified `?model=gpt-4o%7C%7C%7Cplain` on charts. Reasoning variant not in seed data (not exercised live). |
| A12 | `__none__` = select nothing, `__empty__` = Empty/Missing | `urlState.ts:23-24`, `FiltersPopover.tsx:131,335` | filters-sort-search | OK | "None" gives `status=__none__`, 0 rows, sentence "0 of 62 runs". |
| A13 | If any view key is in the URL it is the whole view, else the tab's sessionStorage copy (`qym:dashboard-state:<slug>`) restores filters | `useRunsView.ts` | - | MISSING | Deliberate: OQ 2026-10-11 section 9.2 (URL is the only source of truth). Replacement is acceptable (a bare sidebar link shows the default view). |
| A14 | Versioning-metadata filters not in URL (sessionStorage only) | `urlState.ts:25,89,128` `v.<key>=` | cutover-versioning | CHANGED | OQ 9.1: now `v.<key>=value`. Improvement. Order-context `?list=` still ignores them (documented latent bug). |
| A15 | `page` clamps when total shrinks; filter change resets page to 1 and focus to -1 | `RunsPage.tsx:127-130`, `useRunsView.ts:27` | list-load | OK | `?page=99` -> `?page=2`, rows 51-62. |
| A16 | Pager: first/prev/`[page] of N`/next/last + "1-50 of 123 runs" | `StatusBar.tsx:46`, `@/ui` Pagination | list-load | OK | Buttons First/Previous/Next/Last page plus a page input present. |
| A17 | Status bar sentence "N runs" / "M of N runs - task: ..., ..." | `urlState.ts:215-241` `filterSummary` | `filterSummary.test.ts` | OK | Verified "5 of 62 runs - task: text2sql, status: Completed, search: "gpt"". |
| A18 | "Last Updated: hh:mm:ss" | `StatusBar.tsx:56` | list-load | OK | |
| A19 | Freshness copy: "12 runs preparing - totals cover ready runs", "Some summaries need attention" | `StatusBar.tsx:12-20` | `freshness.test.ts` | OK | Unit-tested; not forced live. |
| A20 | Horizontal scrollbar mirror pinned above the status bar | - | - | MISSING | OQ 2026-10-12 (NICE, about 1 h). Table has its own horizontal scroll; Run column and Actions column are sticky so scrolling works. |
| A21 | Back (`pageshow persisted`) refetches and restores the table scroll (old restored about half the scroll in the test) | `RunsTable.module.css` container scroll | cutover-navigation (flaky one) | BUGGY | CUTOVER gap verified. Repro: scroll `[data-testid=runs-table]` to 600, open run 9, press Back: scrollTop 0 (old: 273, i.e. partly restored). Sort/page/filters do restore (URL). |
| A22 | Document title / heading | `RunsPage.tsx:49,357` | - | OK | |
| A23 | Select button disabled when project has 0 runs | `RunsPage.tsx:375` | - | CHANGED | New enables Select on an empty project. Trivial. |

### B. Command bar: search, time range, origin, facets

| # | Old behaviour | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| B1 | Layout: search + Select + Columns + time segmented + origin segmented + 7 dropdowns row | `RunsToolbar.tsx`, `FiltersPopover.tsx` | UX_DECISION | CHANGED | One bar: Search, `Filters` popover (time, origin, facet disclosures), chips, Columns, Select. Accepted by decision (UX_DECISION.md). |
| B2 | Search by run name/id, debounced 200 ms, server `filters.q`, `?q=` | `useRunsView.ts:44`, `RunsToolbar.tsx:30` | filters-sort-search | OK | Verified: request carries `filters.q:"claude"`, URL `?q=claude`; id prefix `?q=7b443eba` returns 1 row. |
| B3 | `/` focuses and selects search | `useRunsKeyboard.ts` `/` -> `focusSearch` | keyboard | OK | Focus verified. |
| B4 | Esc in search clears/blurs it | SearchField | filters-sort-search | OK | Esc removed `q` from URL and emptied input. |
| B5 | Time segmented All / Today / 7d / 30d / Range | `FiltersPopover.tsx:209-225` | filters-sort-search | OK | `7d` -> `?range=week`, `since = now-7d` ISO (same rolling rule as old `timeFilterBounds`). |
| B6 | Custom range dialog with open-ended dates and validation copy | `FiltersPopover.tsx:368-446` | filters-sort-search | OK | Verified: empty -> "Choose a start date, an end date or both."; start>end -> "The start date must be on or before the end date."; apply gives `?range=custom&from=...&to=...`, local-day bounds, chip "range: 2026-10-10 -> 2026-10-12". |
| B7 | Origin segmented All / Official / Local -> `filters.origins` | `FiltersPopover.tsx:231-240` | filters-sort-search | OK | `?origin=local` request `origins:["local"]`. Official runs cannot be seeded (OQ), so only the empty result was seen. |
| B8 | Multi-select dropdowns: Tasks, Datasets, Models, Versions, Status, Users, with in-dropdown search, "Only", select-all/clear, `__none__`, "Empty / Missing" | `FiltersPopover.tsx:279-366` | filters-sort-search | CHANGED | Disclosure lists inside one popover (decision). Search field only appears when more than 8 options (`:318`). Select all / Clear / None / Only per option all work. |
| B9 | Facet values constrained by the other active filters (server `facets`) | `FiltersPopover.tsx:120` | filters-sort-search | OK | After `Only text2sql`, Datasets lists only bird-mini, spider-dev. |
| B10 | Dynamic versioning-key dropdowns (one per `facets.versioning` key) | `FiltersPopover.tsx:153-163` | cutover-versioning | OK | Code review + mocked-facet spec only: the seeded runs carry no `versioning_metadata` and the API cannot seed it, so not verified end to end. |
| B11 | Owner values are user ids labelled from `overview.owners` | `RunsPage.tsx:101-107` | - | OK | |
| B12 | Clear button with active-count badge | `RunsToolbar.tsx:59-61`, `FiltersPopover.tsx:254` | filters-sort-search | OK | Chips per filter (removable) + "Clear N". New keeps `q` out of the popover's Clear all. |
| B13 | Active-filter chips | `chips.ts` | filters-sort-search | OK (new) | Not in old. |
| B14 | Model dropdown labels "name (reasoning)" and "Empty / Missing" | `urlState.ts:171-177` | `urlState.test.ts` | OK | |
| B15 | Facet counts per value | - | - | MISSING | Not in old either (old had values only); OQ notes counts not shown. Listed for completeness, no action. |
| B16 | Dataset facet shows dataset name only | `FiltersPopover.tsx:115` `datasetLabel` | - | OK | |

### C. Table: columns, cells, sort, column visibility

| # | Old behaviour | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| C1 | Column order: Run, Status, Task, Model, Dataset, Owner, Date, Analysis, Experiment, Version, metrics, Avg/Median latency, trace metrics, Duration, Actions | `columns.ts:132-161` | cutover-columns | CHANGED | Adds a `Signals` column (decision) and orders the same. Verified header lists. |
| C2 | Metric column headers use the raw metric name (`answer_correctness`) | `columns.ts:117` | - | CHANGED | New shows "answer correctness" (underscores to spaces). Acceptable. |
| C3 | Sort: click header; first click desc for numeric/time/status/latency/duration/metric/trace, asc for text; `th[aria-sort]`; keyboard button | `RunsTable.tsx:166-190`, `urlState.ts:300-304` | filters-sort-search | OK | Verified identical row order and URL for Run, Status, Task, Model, Dataset, Owner, Date, Version, Duration, first and second click (`sort=run-desc` etc.). |
| C4 | Text sorts collated in the browser (`sort_values` -> `collation`) | `useRunsData.ts:38-42`, `lib/runs-order.ts` | `urlState.test.ts` | OK | Request carries `collation:["gpt-4o\|\|\|plain"]`. |
| C5 | Hidden metric/trace/latency sort column falls back to time-desc | `columns.ts:164`, `useRunsData.ts:36` | cutover-columns | OK | Hiding `faithfulness` while sorted by it flips aria-sort to Date. URL keeps `sort=metric-faithfulness-desc` (old rewrote). |
| C6 | Deep link `?sort=metric-x-desc` loads in that order | `useRunsData.ts:36-42` | - | BUGGY | While the overview is loading the column set is empty so the sort is treated as hidden and a `time-desc` page is requested first (requests: `time-desc`, then `metric-faithfulness-desc`). A flash of the wrong order and one wasted request. Minor. |
| C7 | Run cell: checkbox (select mode), repeat chevron, name link, `xN` count, Official badge | `cells.tsx:265-309` | cutover-run-rows | OK | |
| C8 | Run link carries `?list=` view context; sets `sessionStorage.dashboardRunFile`; in-app nav; modified click native | `cells.tsx:293-296`, `urlState.ts:140` | list-context | OK | Verified `?list=range%3Dmonth%26task%3Dtext2sql%26q%3Dgpt%26sort%3Dmodel-asc`. |
| C9 | Opening a run clears `compareRuns`/`compareCohorts` from sessionStorage | `selection.ts:134` `rememberRunFile` | - | CHANGED | New does not clear the handoff keys. Harmless (compare overwrites them). |
| C10 | Status badge, "STOPPING..." when `stop_requested`, tooltip with approval decision/comment | `cells.tsx:98-139` | live-status | OK | Same labels; badge not tooltip-only. |
| C11 | RUNNING suffix: `pass j/k`, `NN%`, `done/total` | `cells.tsx:109-138` | live-status | CHANGED | New shows pass j/k only for repeat runs, and a progress bar + done/total for single-pass runs; `%` text dropped. Acceptable. |
| C12 | Execution-error signals: task `N⚠`, metric `N⚠`, retries `N↻`, ingest "Incomplete" marker, after the run ends | `cells.tsx:141-218` | cutover-signals | CHANGED | Moved to a separate non-hideable `Signals` column (decision). Each is a focusable button with tooltip (fixes the old hover-only pain point). Ingest marker shows `◌` not the word "Incomplete". |
| C13 | Clicking a signal opens an execution-error details modal (task vs metric, per-metric counts, notes) | `RunDialogs.tsx:249-280` | cutover-signals | CHANGED | Counts shown, but the explanatory notes ("counted as 0% in the run mean", "metrics skipped after a task failure are not metric errors") are gone. OQ claims the old modal needed the items API; it did not (it was count-only). |
| C14 | Per-metric cell `⚠` button (scorer errors counted as 0, "Mean without them: x") opens the same modal | `cells.tsx:220-263` | cutover-signals | CHANGED | `⚠` is a non-interactive span with `title`; not keyboard reachable, no modal. Minor. |
| C15 | Lower-is-better metric: errors left out of mean, cell says how many were left out + modal explanation | `cells.tsx:226-228` | - | MISSING | CUTOVER gap ("lower-is-better error explanation gone"). Verified in code only (no seeded error counts): task/metric error uses the error tone but there is no left-out explanation. Numeric metrics (`latency_s`) show no error marker at all (`:229-238` returns before the error logic; old rendered it for every metric cell). |
| C16 | Metric cell: smart decimals via `metric_neighbor_values`, colour by type/direction, scored-vs-all mean in tooltip | `cells.tsx:239-262`, `model.ts:40` | - | OK | |
| C17 | High-noise "i" marker when `samples < 2*report_k` with pass@k noise copy | - | - | MISSING | Not rendered anywhere in `cells.tsx`. Minor. |
| C18 | Model cell: colour dot (20-colour palette), reasoning badge, provider stripped | `cells.tsx:22-47`, `model.ts:14` | cutover-models | CHANGED | OQ 9.7: 8 hues (not 12 as the OQ text says: `model.ts:14` uses `% 8`, `ChartsPage.tsx:817` `% 8`), wrap adds a marker shape. Dots and chart bars agree. |
| C19 | Dataset cell: name + version tag + alias tags | `cells.tsx:67-77` | - | OK | |
| C20 | Owner cell: initials avatar + name, email tooltip, "-" when none | `cells.tsx:49-65` | - | OK | |
| C21 | Date cell "Oct 12 . 17:45" with full tooltip | `cells.tsx:89-96` | - | OK | |
| C22 | Analysis cell: "N causes" chip / "Analyze" link to analyzer, "-" while live | `cells.tsx:311-326` | cutover-run-rows | OK | Link `/projects/demo/runs/<id>/analyzer` verified. |
| C23 | Experiment cell links to the experiment | `cells.tsx:328-340` | cutover-run-rows | OK | |
| C24 | Version cell `branch/commit` tag | `cells.tsx:79-87` | - | CHANGED | New also shows when only a branch exists. Fine. |
| C25 | Latency cells: `-` when 0/missing, "1.5s", over 60 s prints seconds | `lib/format.ts:3-13` | cutover-run-rows | CHANGED | New prints "1m 15s" above 60 s. Acceptable. 0 ms shows "-" as before. |
| C26 | Duration cell | `cells.tsx:408` | - | OK | |
| C27 | Trace metric columns (Avg tokens, LLM calls, Tool calls, Tool success) | `columns.ts:67-104`, `RunsTable.tsx:230-237` | cutover-columns | OK | |
| C28 | Columns menu: search box, All/None buttons, Run-name toggle, base/metric/system/trace sections, Reset to default | `ColumnsMenu.tsx:13-69` | cutover-columns | CHANGED | Sections and Reset ok. Missing: "Search columns...", All/None, and the Run name toggle (`c.id !== 'run'`, `:44`). Minor; a project with 30 metrics has no quick select-all/none. |
| C29 | Column visibility stored in `sessionStorage qym_visible_metrics` `{version:2, visible:[...]}` | `selection.ts:206-217` | cutover-columns | OK | Same key and shape; survives reload; Reset removes it. |
| C30 | Frozen identity columns section + "unfrozen to fit" note; `localStorage qym:runs-frozen-columns` | `RunsTable.module.css` sticky Run | cutover-sticky-columns | MISSING | OQ 9.4 deliberate drop. Replacement: Run column sticky (verified: left edge stays at 207 px while Status moves) and Actions sticky. Equivalent for the common case. |
| C31 | Row focus highlight, single click focuses, double click opens | `RunsTable.tsx:144-160` | keyboard | OK | Double-click on Task cell opened the run with `?list=`. |
| C32 | Row diffing by html string | - | - | MISSING | Deliberate (React reconciles). No action. |
| C33 | Toasts via custom `showToast` | `@/ui` `useToast` | - | CHANGED | OQ 9.11: shell toast. |

### D. Selection, compare, cohort, bulk actions

| # | Old behaviour | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| D1 | Select button toggles select mode (checkbox column); Done exits and clears the selection | `RunsPage.tsx:375-380` | selection-compare | CHANGED | Label "Done selecting"; exits select mode and clears. Equivalent. |
| D2 | Header checkbox selects visible page | `RunsTable.tsx:205`, `selection.ts:162` | selection-compare | OK | 50 rows -> "53 executions" (repeat runs count as k). |
| D3 | `N executions selected` + Compare / Cohort / Submit / Delete / Clear + guidance | `SelectionBar.tsx:17-57` | selection-compare | OK | Present. |
| D4 | Selection persists per project across Back/Forward/other pages (`qym:runs-selection:<slug>`) | `selection.ts:20,156` | cutover-selection | OK | Verified after Compare then Back: 2 selected, 2 ticked. |
| D5 | Selection across pages (off-page rows fetched by `ids`) | `useRunsData.ts:80-94` | selection-compare | OK | Run on page 1 + run on page 2: Delete dialog names both, Compare URL carries both ids. |
| D6 | Runs that vanish are dropped when the page answers | `selection.ts:181-197`, `RunsPage.tsx:84` | `selection-reconcile.test.ts` | OK | |
| D7 | Compare -> `sessionStorage.compareRuns`, navigate `/compare?runs=...`; repeat run expands to its passes | `RunsPage.tsx:154-159`, `selection.ts:75-87,106-111` | selection-compare | OK | Verified URL and key. Needs 2+ executions, error toast otherwise. |
| D8 | Compare refs are de-duplicated (`new Set`) | `selection.ts:75-87` | - | BUGGY | Pass 1 ticked together with its whole run gives `/compare?runs=R::pass1&runs=R::pass2&runs=R::pass3&runs=R::pass1` (duplicate). `expandComparisonRefs` never dedupes. See D12. |
| D9 | Cohort: first click locks Cohort A (toast), then pick an equal number for B, Cohort button opens `compareCohorts` + `cohortA/cohortB` URL | `RunsPage.tsx:160-183`, `selection.ts:112-136` | selection-compare | OK | Lock toast and button flip to "Cohort B ->" verified. Balance, overlap and handoff logic read and unit-tested. |
| D10 | `c` key: with Cohort A locked it opens the cohort comparison, else compares if 2+ selected | `RunsPage.tsx:233` | keyboard | BUGGY | Repro: select 2, click Cohort (A locked), tick 3 other runs, press `c`: navigates to `/compare?runs=...` (plain compare of B) and cohort A is ignored. Old called `openCohortComparison()`. Hint: `compare: () => (selection.cohortA.length ? cohort() : selection.selected.size >= 2 ? compare() : undefined)`. |
| D11 | In cohort mode: Compare hidden, Delete and Submit hidden, count text "Cohort B x/y executions", "Open Cohort" disabled until balanced and disjoint, guidance "Balanced: n vs n" / "Select k more" / "Remove k" / "cannot include runs already in Cohort A", Clear reads "Cancel Cohort" | `SelectionBar.tsx:19-26,52-66` | selection-compare | CHANGED | New keeps Compare, Submit, Delete visible and enabled while Cohort A is locked, count says "N executions selected", guidance is one static sentence, validation happens only as an error toast on click. Compare during cohort mode silently discards the cohort intent. Minor/major (with D10). |
| D12 | A pass and its whole run are exclusive in one selection; parent checkbox of an expanded run selects/clears all of its passes; parent shows checked when all passes ticked, indeterminate when some | `selection.ts:159-165`, `RunsTable.tsx:236-247` | passes | BUGGY | Verified: ticking pass 1, 2, 3 individually leaves the parent indeterminate (old: checked). Ticking the parent while expanded selects the whole run (3 executions) and leaves the pass boxes empty (old: ticks all passes). Ticking pass 1 afterwards gives selection `[R, R::pass1]`, "4 executions", duplicate refs to compare. `passes.spec.ts:94` only asserts the indeterminate case. |
| D13 | Only completed/failed passes are selectable | `PassesPanel.tsx:190-202` | passes | CHANGED | New offers a checkbox on every pass row (all passes are completed/failed for stored runs; queued/not-run rows are gone, see E8). |
| D14 | Submit button visible only when every selected run is submittable (owner-or-manager, COMPLETED/FAILED/REJECTED) and not in cohort mode | `SelectionBar.tsx:60-66` | selection-compare | CHANGED | Always visible, enabled for 1+ selected. Verified: with STOPPED + COMPLETED + APPROVED selected, Submit opens, the server answers "summarize-gpt-4o-061: Only a completed, failed or rejected run can be submitted (run is STOPPED). No runs were submitted." as an inline error. Safe but worse than hiding. Minor. |
| D15 | Delete button disabled unless all targets are deletable (own or manager; passes only if run not RUNNING/PENDING/SUBMITTED/APPROVED and not all passes of a run); hidden in cohort mode and read-only | `RunsPage.tsx:266`, `SelectionBar.tsx:67-72` | selection-compare | CHANGED | Only the ownership rule is checked. Selecting passes of a SUBMITTED run still offers Delete (server refuses). Deleting every pass of a run is possible from the bulk path. Minor. |
| D16 | Bulk submit modal: comment, "on their behalf" and "resubmitting a rejection" copy | `RunDialogs.tsx:414-449` | row-actions | CHANGED | Comment kept; the on-behalf / rejected-run explanation text is gone. Minor. |
| D17 | Bulk submit: `POST /v1/runs/submit {run_ids, comment}` (one run: `/v1/runs/{id}/submit`) | `RunDialogs.tsx:436`, `api/dashboard.ts` `useSubmitRuns` | row-actions | OK | Verified request body. |
| D18 | Bulk delete modal: "Delete selection ... N runs and M passes"; passes warning "Deleted passes cannot be restored. Deleted runs can."; success toast with restore window days; partial-failure toast | `RunDialogs.tsx:450-491` | cutover-passes | CHANGED | Single dialog text mentions restore window and that a pass delete is permanent; toast has no restore days; partial failure toast "N could not be deleted". Acceptable. After delete the whole selection and select mode are cleared (old only removed the deleted refs). Minor. |
| D19 | Delete failure used `alert()` | `RunDialogs.tsx:487` | - | OK | Toast (OQ drop of alert). |
| D20 | Pass delete sends `expected_pass_version` | `api/dashboard.ts:367-371`, `PassesPanel.tsx:258`, `RunDialogs.tsx:482` | cutover-passes (`test.fail`) | BUGGY | See E10. |
| D21 | Esc: in select mode first clears selection, second leaves select mode (old: Esc leaves select mode and clears) | `RunsPage.tsx:237-241` | keyboard | CHANGED | Two-step; acceptable. |

### E. Repeat runs: passes panel

| # | Old behaviour | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| E1 | Chevron expands inline panel under the row; panel re-fetches on every poll for live runs | `cells.tsx:279-290`, `PassesPanel.tsx:45` | passes | CHANGED | 15 s refetch while live (not on every list poll). Acceptable. |
| E2 | Data: `GET /api/runs/{id}/passes` + `group-metrics?metric=&threshold=` in parallel | `api/dashboard.ts:231`, `PassesPanel.tsx:59` | passes | OK | |
| E3 | Group strip: Pass@k, Pass^k, **Avg@k**, Consistency, Reliability, **Avg latency**, with per-stat tooltips quoting the threshold/k | `PassesPanel.tsx:109-132` | passes | CHANGED | Avg@k and Avg latency missing; tooltips are generic one-liners (no threshold or k). Values match (100.0 / 37.5 / 58.3 / 70.8). |
| E4 | Threshold slider labelled "Pass if >= / <= x", shown as `80%`, direction-aware; "No direction declared" when none | `PassesPanel.tsx:149-161` | passes | CHANGED | Slider shows `0.8`, no rule text, no direction note; always enabled. Minor. |
| E5 | Metric select (score metrics) | `PassesPanel.tsx:136-148` | passes | OK | |
| E6 | One real row per pass with the **full run row**: status badge (live `NN%`, `done/total`; stale RUNNING coerced to the run's terminal status), per-pass error counts and retry chips, date, Analysis link for that pass, version, every metric cell with "best pass" chips, latency winners, trace stats, duration | `PassesPanel.tsx:164-247` | passes | CHANGED | New has a compact sub-table: Pass #, status, metric means, Items scored/total, Avg latency, Duration. Missing: per-pass error counts and retry chips, date, per-pass Analysis link, best-pass chips, trace stats, stale-status coercion. CUTOVER lists "no per-pass error counts/chips/stale-status coercion, no repeat performance curve". Verified. Major for error/retry visibility. |
| E7 | Pass rows are openable (click opens Pass N details) | `PassesPanel.tsx:193` | cutover-passes | MISSING | CUTOVER gap verified: rows are plain `<tr>`, no link/handler. Major (no way from the list to one pass). |
| E8 | Queued passes ("Passes 2-3: 2 waiting to start" / "not run") and "No pass results are available yet" | - | - | MISSING | Not rendered; while a repeat run is live only completed passes appear. Minor. |
| E9 | Pass delete icon per row only when the run is deletable and not RUNNING/PENDING/SUBMITTED/APPROVED | `PassesPanel.tsx:88,235` | passes | OK | |
| E10 | Delete a pass: `DELETE /api/runs/{id}/passes` with `pass_numbers` + `expected_pass_version` | `api/dashboard.ts:367-371` | cutover-passes (`test.fail`) | BUGGY | Repro: expand `rag-qa-gpt-4o-017`, delete pass 1 (200, panel renumbers to #1,#2), delete again: `DELETE .../passes/1 -> 409 {"detail":"Passes changed; reload the run before editing"}`; dialog stays open with that error. Sends no `expected_pass_version`; the first delete only works because `pass_revision` is still 0. Major. Fix: send `row.pass_revision` (current row) with every delete; use the panel's `useRunPasses` data to renumber. |
| E11 | After a pass delete, stale picks of that run's passes are cleared and renumbered | `selection.ts:175` `notePassRevision` (never called) | cutover-passes (`test.fail`) | BUGGY | CUTOVER gap. `notePassRevision` has no caller; `reconcile` compares against `passRevisions` that are never written, so stale pass picks survive a delete. Minor. |
| E12 | Delete dialog wording: runs restorable, passes permanent | `RunDialogs.tsx:456`, `PassesPanel.tsx:253` | cutover-passes | OK | |

### F. Row workflow actions

| # | Old behaviour | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| F1 | Review dropdown: Approve/Reject on SUBMITTED, Unapprove on APPROVED, Unreject on REJECTED, Transfer ownership (managers) | `cells.tsx:349-402` | row-actions | OK | Menu "Approve / Reject / Transfer ownership..." verified for SUBMITTED. |
| F2 | Submit icon for owner or manager on COMPLETED/FAILED/REJECTED; title "on behalf of <owner>" | `cells.tsx:371-383` | row-actions | CHANGED | Label is `Submit <name> for review`; the on-behalf wording is gone. Trivial. |
| F3 | Delete icon for admin/manager/owner (any status, including RUNNING) | `cells.tsx:384` | row-actions | BUGGY | `!isActiveRun(row)` hides delete on RUNNING/PENDING rows. The server accepts it (`POST /api/runs/delete` on a RUNNING run: `{"ok":true,"purge_after_days":30}`), and the old row offered it; a stuck RUNNING run can no longer be removed from the list (bulk delete still works). Minor. |
| F4 | Approve/reject/unapprove/unreject modal with comment, `POST /v1/runs/{id}/<action>` | `RunDialogs.tsx:94-140` | row-actions | OK | Verified POST `{"comment":""}`; toast "<name> approved". |
| F5 | Reject comment optional | `RunDialogs.tsx:109` | row-actions | CHANGED | New requires a comment for Reject ("Comment is required."). Server accepts an empty one (verified). Stricter UX; acceptable if intended. |
| F6 | Row shows the new status at once (`applyRunWorkflowResult`) + toast; 409 refreshes the row | `api/dashboard.ts` `useRunWorkflow` patch | row-actions | OK | Submit of a COMPLETED row: status SUBMITTED within 200 ms. |
| F7 | Transfer ownership modal (members of the project) | `RunDialogs.tsx:179-210` | row-actions | OK | Members select listed; owner excluded. |
| F8 | Read-only (archived project) hides actions | `cells.tsx:358`, `SelectionBar.tsx:60` | readonly | OK | Spec only; not re-run. |
| F9 | Actions column sticky | `RunsTable.module.css` | cutover-sticky-columns | OK (new) | Old needed ~1300 px scroll to reach it. |

### G. Live cadence, polling

| # | Old behaviour | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| G1 | 60 s idle; 15 s when active runs / backfilling | `polling.ts:36-47,60` | live-status, `selection-polling.test.ts` | OK | Measured with 2 RUNNING rows: list requests at 17.2 s and 32.2 s (15 s cadence). |
| G2 | 2 s while a stop was requested for 60 s; 2->4->8->15 s back-off while updating | `polling.ts:36-47` | `selection-polling.test.ts` | OK | Unit-tested; not forced live. |
| G3 | Hidden tab never polls; becoming visible refetches once | `polling.ts:105-114` | live-status | OK | Verified with a simulated `visibilitychange` (headless cannot truly hide): 0 requests in 20 s hidden, 1 on return. |
| G4 | `qym:run-status` (BroadcastChannel) forces a refetch and 20 s fast polling | `polling.ts:78-98`, `lib/run-status.ts` | live-status | OK | Not re-driven; code and spec. |
| G5 | Unchanged poll does not touch the DOM; rows keep focus/selection | React reconciliation | - | OK | |
| G6 | Overview refetched only when catalog revision moves | `useRunsData.ts:68-78` | cutover-backfill | OK | Observed one `overview` refetch 2 s after load, then none. |
| G7 | Status of a run is authoritative on every poll | `cells.tsx:98` | live-status | OK | |

### H. Keyboard shortcuts and help

| # | Old behaviour | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| H1 | `j`/Down, `k`/Up move row focus across pages | `useRunsKeyboard.ts:110-118`, `RunsPage.tsx:200-209` | keyboard | OK | Verified j,k; 50 x `j` crosses to page 2 row 1; `k` back to page 1 last row. |
| H2 | `g` first run, `G` last run of the whole list | `RunsPage.tsx:210-221` | keyboard | OK | `G` -> `?page=2` last row. |
| H3 | `Enter` opens focused run | `RunsPage.tsx:222-226` | keyboard | OK | |
| H4 | `x` toggle select (enters select mode) | `RunsPage.tsx:227-232` | keyboard | OK | A rapid `x` right after a page-crossing `j` acts on the previous page's focused row until the new page lands (race, minor). |
| H5 | `c` compare / cohort | `RunsPage.tsx:233` | keyboard | BUGGY | See D10. |
| H6 | `1-4` set time range, `?` help, `Esc` | `useRunsKeyboard.ts` | keyboard | OK | `3` -> `?range=week`, `1` clears. |
| H7 | Never fires with modifiers, in inputs, dialogs, open dropdowns | `useRunsKeyboard.ts:73-85` | keyboard | OK | |
| H8 | Help modal with single-key opt-out (`localStorage qym:single-key-shortcuts=off`) | `ShortcutsDialog.tsx` | keyboard | OK | Switch writes `off`; after opt-out `j` does nothing, Arrow/Enter still work (old disabled those too; improvement). |
| H9 | Header "?" help button | `StatusBar.tsx:63` | keyboard | OK | |

### I. KPIs / topbar

| # | Old behaviour | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| I1 | Five KPIs in the topbar from `/api/dashboard/kpis`, scope "All runs"/"Filtered runs", exact labels and formats | `kpiTopbar.ts`, `lib/kpis.ts` | cutover-kpis | OK | Same values as old; scope flips to "Filtered runs" under a filter. |
| I2 | Topbar chips clip at 768/900 px and blank on reload | `features/shell` | - | BUGGY | CUTOVER finding (shell area). Not re-verified here. |

### J. Overview page

| # | Old behaviour | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| J1 | Title = project name, subtitle, origin segmented (not in URL) | `OverviewPage.tsx:112-130` | overview | CHANGED | Origin is now `?origin=` (decision). |
| J2 | Five KPI cards with help markers, sub-line "All runs . N approved . Updating..." | `OverviewPage.tsx:140-160` | cutover-overview | OK | Same numbers; sub-line verified. |
| J3 | Live Runs table: Run (+Official badge, task name under it), Owner, Status, **Progress**, Updated; 8 rows; polled every 10 s | `OverviewPage.tsx:164-197` | overview | CHANGED | Task name and Official badge gone; Progress merged into Status: single-pass runs show bar + n/m, but a repeat run shows only "pass 1/3" and loses "4/8" item progress (old: "pass 1/3 . 4/8"). Minor. |
| J4 | "Updating live runs..." text while `freshness.updating` | `OverviewPage.tsx:196` | - | MISSING | Always "No live runs". Trivial. |
| J5 | Recent Runs (5, non-live statuses) columns Run (+Official badge), **User**, Status, **Items = progress completed/total (pass prefix)**, Date | `OverviewPage.tsx:354-387` | cutover-overview | CHANGED | User column dropped, Official badge dropped, Items now `success_count/total_items` (old: progress). For a stopped run old showed 4/9, new 4/4; for a run with task errors new shows 10/11 where old showed 11/11. Different meaning; decide and label. Minor. |
| J6 | Approved Runs (5): Run, User, Items, Date | `OverviewPage.tsx:203` | cutover-overview | CHANGED | Same as J5, plus a redundant Status column. |
| J7 | "View all" links: Live/Recent/Approved all to the runs list | `OverviewPage.tsx:167,200,203` | overview | CHANGED | New pre-filters (`?status=RUNNING&status=PENDING`, `?status=APPROVED`). Improvement. |
| J8 | Pending Reviews (12 from `/api/corrections`), item links to `/reviews?status=pending&id=`, "Pending" badge, "+ N more", hidden for archived projects | `OverviewPage.tsx:208-245` | overview | CHANGED | Items and links ok; badge dropped; the card is not hidden for archived projects. Trivial. |
| J9 | Trend: task+dataset select (hidden when <2 pairs), range 7/30/90, default **7 days**, headline mean, delta vs previous period coloured by direction, runs count, execution success | `OverviewPage.tsx:44-47,246-338` | cutover-overview | CHANGED | Default range is now **30d** (old 7 days). Same numbers (verified 95.7% / +17.9 pts / 5 runs for 7d). Delta colour follows direction. Decide the default; note old users saw 7d. |
| J10 | Trend URL state `?range=30d\|90d&task=&dataset=` | `OverviewPage.tsx:279` | overview | OK | 7d -> `?range=7d`, 90d -> `?range=90d`. |
| J11 | SVG line + daily run bars + hover tooltip (mouse only) | `TrendChart.tsx`, Recharts | overview, a11y | OK | Tooltip on hover verified ("Sep 5 - rouge l 0 runs"); keyboard hint "Focus the chart and use arrows". The arrow-key tooltip did not show in the headless run (not verified). |
| J12 | Trend empty copy "No finished runs in the last N days ... latest finished run is from 3 days ago" | `OverviewPage.tsx:290-299` | cutover-overview | OK | |
| J13 | Origin toggle re-runs every section | `OverviewPage.tsx:48-50` | overview | CHANGED | KPIs and lists honour origin; the trend does not (endpoint has no origin filter; OQ). |
| J14 | While `freshness.updating`: whole page reloads every 2 s | `OverviewPage.tsx:74,84,88` | - | CHANGED | OQ 9.8: per-query intervals (2 s while KPIs updating, else 60 s; live 10 s). KPI query polls every 30 s regardless of updating. Acceptable. |
| J15 | Empty project overview | `OverviewPage.tsx` | overview | OK | Zeros, "No live runs", "Nothing yet". |

### K. Charts page

| # | Old behaviour | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| K1 | Command bar minus search/Select: Columns, time range, origin, 6 dropdowns | `ChartsPage.tsx:108-135` | charts | CHANGED | `Filters` popover + chips + Columns (same decision as runs list). |
| K2 | One card per task: title, "N runs . M models . K metrics", dataset tabs with run counts (`role=tablist`) | `ChartsPage.tsx:560-600` | charts | OK | "K metrics" now counts only the combo's metrics (2 vs old 6, which included latency/trace). Trivial. |
| K3 | Model legend: click toggles that model, double-click shows only this model; writes the model filter | `ChartsPage.tsx:98-116,136-160` | charts | OK | Verified `?model=gpt-4o%7C%7C%7Cplain`, `aria-pressed`, "Show all" resets. Legend adds per-model run counts (new). |
| K4 | Lazy per-card history: `POST /points` 500 per page until `has_more` false, IntersectionObserver 200 px, max 2 concurrent, skeleton at remembered height | `ChartsPage.tsx:62-80,267-310` | charts | OK | Cards load as they come into view; tab switch requests `{task:text2sql,dataset:bird-mini}`. Concurrency cap (2) not enforced (3 cards requested together at load); minor. |
| K5 | Remembered card height `qym:chart-card-h:<["task","dataset"]>` | `ChartsPage.tsx:80-86,312-317` | charts | OK | |
| K6 | Mini-bar score cells coloured per model, numeric cells as numbers, latency bars, trace bars | `ChartsPage.tsx:790-822` | charts | OK | Looks equivalent. Bars for score metrics scale to 100%, but the subtitle says "Bars are relative to the best run in the card" (only true for latency/numeric): copy mismatch, trivial. |
| K7 | Trace columns always shown (as "-") when enabled | `ChartsPage.tsx:327` | charts | CHANGED | New hides trace columns without data. Improvement. |
| K8 | Sortable column headers per card, first-click direction rule, default = first metric desc | `ChartsPage.tsx:372-405` | charts | OK | `exact match` default desc; Avg latency first click desc then asc. |
| K9 | Rows: Runs / Grouped; Group: Model / Version; Then: Model / Version; Expand all | `ChartsPage.tsx:610-690` | charts | OK | Version disabled when no version data. Verified Grouped: 2 model groups, Expand all -> 12 rows, Version grouping "main/e4f5a6b", "No version". |
| K10 | Grouped Pass@K / Consistency / Reliability via batched `models/stats`, always visible | `ChartsPage.tsx:340-372,520-545` | charts | CHANGED | OQ: stay visible while expanded (old hid them: pain point); headers are sortable. Request body verified. |
| K11 | Group stat columns toggleable from Columns (`GROUP_DISPLAY_COLUMNS`) | `ColumnsMenu.tsx`, `ChartsPage.tsx:111-120` | - | MISSING | Charts Columns menu lists metrics/system/trace only (and also lists "Duration", which has no chart column). Minor. |
| K12 | First-column drag resize 280-720 px | - | - | MISSING | OQ 2026-10-12 (NICE, about 2 h). |
| K13 | Charts refresh on the runs-list cadence (15 s with live runs, 2 s stopping) | `ChartsPage.tsx:246` | - | MISSING | OQ 2026-10-12: overview refetch is a fixed 60 s. A live run's chart lags up to a minute. |
| K14 | Chart state (sort/group/tab) in memory only; tab per task | `ChartsPage.tsx:287-295` | charts | OK | |
| K15 | "No metrics recorded" card state; empty page copy | `ChartsPage.tsx:185-200` | charts | CHANGED | Empty project: "No data available for charts / Run some evaluations first." (old: "No evaluation runs found ..."). Combo with zero metrics renders an empty table. Trivial. |
| K16 | Run link in a chart row opens the run | `ChartsPage.tsx:433-440` | charts | OK | Plain run link (old also had no `?list=` on Charts). |
| K17 | `Last Updated` footer on Charts | - | - | MISSING | Trivial. |

### L. Accessibility / i18n / formatting

| # | Old behaviour | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| L1 | RTL names via `textDirAttrs` | `cells.tsx:297` | cutover-run-rows | OK | Code only (no Arabic seed run). |
| L2 | Sort header buttons keyboard-reachable, `aria-sort` | `RunsTable.tsx:166-190` | a11y | OK | Fixes old chart headers without `aria-sort`. |
| L3 | Status badge tooltip hover-only | `cells.tsx:98` | a11y | CHANGED | Still a `title`; signals are focusable. |
| L4 | Count formats (`1.2M`), percent floor | `lib/kpis.ts` | cutover-kpis | OK | |

## Fix list

Ordered by user impact.

1. **MAJOR. Second pass delete always fails with 409.** Rows E10/D20. Repro: expand a repeat run (e.g. `rag-qa-gpt-4o-017`), delete pass 1 (works), delete another pass: `DELETE /api/runs/<id>/passes/1 -> 409 Passes changed; reload the run before editing`. Hint: `useDeletePasses` (`frontend/src/api/dashboard.ts:367-371`) must send `expected_pass_version` = the run row's current `pass_revision` (old: `dashboard.js:7396`); thread it from `PassesPanel.tsx:258` and `RunDialogs.tsx:482` (`known.get(id).pass_revision`); turn the `test.fail` in `cutover-passes.spec.ts:84` into a passing test.
2. **MAJOR. `c` with Cohort A locked runs a plain compare** (D10/H5). Repro: select 2, Cohort, tick 3 others, press `c`. Hint: `RunsPage.tsx:233` call `cohort()` when `selection.cohortA.length`; also hide Compare / Delete / Submit in cohort mode and relabel Clear "Cancel Cohort" (D11, `SelectionBar.tsx`).
3. **MAJOR. Pass/run selection model** (D8/D12). Parent checkbox of an expanded repeat run must select/clear all of its pass refs, show checked when all are ticked, and a pass and its run must be exclusive; `expandComparisonRefs` must dedupe. Hints: `selection.ts:75-87` (`return [...new Set(out)]`), `selection.ts:159-165` `toggle` (delete `passRefBase(ref)` when adding a pass ref, and the reverse), `RunsTable.tsx:236-247` (expanded parent toggles `passRef(id,1..samples)`), update `passes.spec.ts:94`.
4. **MAJOR. Passes panel lost per-pass detail** (E6/E7/E3/E4/E8). Restore at least: per-pass error counts and retry chips, date, openable pass rows (link to the run's pass view), Avg@k and Avg latency stats, threshold shown as `80%` with "Pass if >= / <=" and "No direction declared", stale-RUNNING-to-terminal coercion, queued/not-run rows. Hint: `PassesPanel.tsx:93-247`; data already in `/passes` (`error_count`, `retry_count`, `started_at`, `status`).
5. **MINOR/MAJOR. Delete missing for RUNNING/PENDING rows** (F3). `cells.tsx:384` drop `!isActiveRun(row)` (server allows it; stuck runs need removal). Align the bulk Delete rule (D15) and Submit visibility rule (D14: hide Submit unless all selected are submittable, `SelectionBar.tsx`/`RunsPage.tsx:399`).
6. **MINOR. Back does not restore table scroll** (A21). Hint: save `scrollTop` of `[data-testid=runs-table]` in `sessionStorage` (or history state) on unmount/before navigate and restore after rows render.
7. **MINOR. Execution-error explanations** (C13/C14/C15/C17). Restore the modal notes and the lower-is-better "left out of the mean" explanation, make the per-metric `⚠` a focusable button opening the dialog, add the high-noise "i" marker. Hints: `cells.tsx:220-263`, `RunDialogs.tsx:249-280`; numeric metrics (`cells.tsx:229`) should also carry the marker.
8. **MINOR. Overview lists** (J3/J5/J6/J9). Decide and fix: Items meaning (progress vs success/total, `OverviewPage.tsx:372`), restore Owner/User column, Official badge and task name on live rows, repeat-run item progress; decide the trend default (old 7 days, new 30d, `OverviewPage.tsx:45`).
9. **MINOR. Cohort guidance and validation** (D11). Dynamic guidance ("Balanced: n vs n", "Select k more", "Remove k", overlap), "Cohort B x/y executions" count, disable the cohort button until valid (`SelectionBar.tsx:19-26`, `RunsPage.tsx:160-183`).
10. **MINOR. Columns menu** (C28/K11). Add column search, All/None, Run-name toggle; add Pass@K/Consistency/Reliability toggles on Charts and drop "Duration" there (`ColumnsMenu.tsx:44`).
11. **MINOR. Charts refresh cadence** (K13). Reuse `useRunsCadence` in `useRunsDataLite` (`ChartsPage.tsx:246`); about 1 h per OQ.
12. **MINOR. Deep-linked metric sort flashes time-desc** (C6). Hold the runs query until the overview (column set) is known when the sort is `metric-`/`trace-` (`useRunsData.ts:36-42`).
13. **MINOR. Stale banner copy and failed filter change** (A7/A8). Only claim "filter change is not applied" when the key changed; keep the previous rows with the banner when a filter/sort/page request fails (`RunsPage.tsx:386`, query `placeholderData`).
14. **MINOR. Stale pass picks after a pass delete** (E11). Call `notePassRevision` when the panel loads and clear/renumber that run's pass refs after a delete (`selection.ts:175`).
15. **TRIVIAL.** Submit-on-behalf and rejected-run copy (D16/F2), "Updating live runs..." (J4), pending-reviews badge and archived hide (J8), Last Updated on Charts (K17), Reject comment required (F5, confirm intended), 8 vs 12 model hues (C18, update the OQ), chart concurrency cap (K4), `x` race after a page-crossing `j` (H4), subtitle copy "Bars are relative to the best run" (K6).

## Not verified (and why)

- Versioning-metadata filters end to end (B10/A14): `versioning_metadata` is only written by Evaluation Service jobs; the API cannot seed it, so only code and the mocked-facet spec were checked.
- Official-origin rows, Official badge, Experiment column links with data: needs an experiment launch token (OQ "seeding").
- A truly hidden tab (G3): headless Chromium cannot hide a page; simulated `visibilitychange` with overridden `document.hidden` instead.
- `freshness.updating` / backfill copy (A5, A19, G2) and a real stop-requested cadence: no backfill or stop could be forced; covered by unit tests only.
- Execution-error markers (C12-C15): the seeded runs have task errors but no metric errors or lower-is-better error cases; checked by code.
- Arabic/RTL names (L1): no Arabic run seeded; code review only.
- Read-only/archived project behaviours (F8): not re-run (spec `readonly.spec.ts`).
- Trend keyboard tooltip (J11): arrow-key focus did not surface the tooltip in headless; hover works.
- Non-admin permissions (owner vs manager vs member): the dev user is ADMIN under `QYM_AUTH_MODE=none`, so the owner-only gating of Submit/Delete was read from code only.
