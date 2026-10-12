# QA: Run detail page (feature inventory and mapping)

Branch `ui/qa`. Old UI = commit 7814183 (vanilla `run.html` + modules) on port 8822; new UI = React `frontend/src/features/run-detail` served by the platform on port 8832 (same seeded SQLite copy). Brief: `docs/internal/ui-migration/04-run-detail.md`. Decisions: `decisions/run-detail/*`. Gaps list: `CUTOVER.md`.

`RD/` below means `frontend/src/features/run-detail/`. Specs live in `frontend/e2e/run-detail/`. "ran" = driven in the running old and new UI with the same data (Playwright scripts in the QA scratchpad; screenshots kept out of the repo); "code" = read the code only; "spec" = relied on an existing spec.

## Method and data

- Seeded through the public API (`frontend/e2e/run-detail/seed.ts`, patched in scratchpad only for SQLite lock retries): classic run (240 items, 4 metrics incl. a lower-is-better one, 12 task errors, 8 scorer errors, 6 retries, 3 not received, 61 traces), repeat run (samples=3, 60 items), RUNNING run, SUBMITTED (locked) run, a **5,200-item run** (`big-5k`) for performance, a 5-of-10-items run with one rejected event and a 0 ms item, plus fresh RUNNING runs created per test for live checks. Same DB copied for both servers; `QYM_RUN_STALE_TIMEOUT_SECONDS=100000`.
- Experiment panel, git version, Langfuse host and the ingest banner with 3 rejected events were exercised by intercepting `GET /api/runs/{id}?view=compact` in both UIs and injecting fields (no official-run seeding path without an Evaluation Service).
- Counts of items, first rows and metric-card text were compared old vs new for 15 classic and 15 repeat URL combinations (show, pass, metric, threshold, sort, q, filters JSON, view): all equal except one 0.1% rounding tie.

## Summary counts

**Total 161 rows**: OK 91 · CHANGED 42 · BUGGY 11 · MISSING 17

Headline: the data layer, URL contract, filters, charts, live updates, item detail, score edit, issue flow, trace drawer and 5k-item performance are faithful (old links and `?filters=` JSON load unchanged). Real defects: the Display popover multi-selects cannot be opened, no sticky nav/filter bar, `hide_field` ignored for metadata badges, Raw trace JSON leaks internals, Approve on rejected issues, task-failed rows show metric cards, 0 ms shown as "—". Everything else is cosmetic or a logged deliberate drop.

## Inventory and mapping

| # | Area | Old behaviour | New code / spec | Status | Notes (verification) |
|---|---|---|---|---|---|
| 1 | Hero | Skeleton shaped like the page while loading (run.html:6286) | RD/RunDetailPage.tsx:14 `RunSkeleton` (delayed via useDelayedPending) | **OK** | code; spec overview.spec |
| 2 | Hero | Document title "قيِّم • {run} • Pass N" | RD/RunBody.tsx:`useDocumentTitle` | **CHANGED** | Title is now "{run} • Pass N · قيِّم" (shell-wide pattern). Acceptable. Ran: both titles read. |
| 3 | Hero | Eyebrow "Run detail", run name/id as mono h1, status badge | RD/components/RunHero.tsx:100-130 | **OK** | ran |
| 4 | Hero | Status badges RUNNING/PENDING/COMPLETED/FAILED/STOPPED/SUBMITTED/APPROVED/REJECTED; STOPPING… when stop_requested | RD/RunHero.tsx:92-95,125 | **OK** | ran: RUNNING, COMPLETED, SUBMITTED; STOPPING via cutover-live-controls.spec |
| 5 | Hero | Stop reason tooltip on badge + "Stop reason" meta cell | RD/RunHero.tsx:123,272 | **OK** | code |
| 6 | Hero | "• pass k/N" suffix while a repeat run runs | RD/RunHero.tsx:111-115 | **OK** | code only (no running repeat seeded) |
| 7 | Hero | `xN PASSES` pill; `Pass N/M` pill linking to all passes; single-pass repeat "Pass 1" link | RD/RunHero.tsx:132-152 | **OK** | ran: "x3 passes", "Pass 2/3"; repeat.spec |
| 8 | Hero | Live indicator "Live · updated Ns ago" beside status | RD/RunHero.tsx:60-68 | **CHANGED** | Ran on a live run: old resets to "updated 0-3s ago" on every 3 s probe; new counts up (0s -> 13s) until data changes, because `updatedAt` is only set on a reload (useLiveRun.ts:70). Reads as "stale" while polling is healthy. Minor. |
| 9 | Hero | Runtime ticks every second while live (server clock offset) | RD/RunHero.tsx:106-112; hooks/useLiveRun.ts | **CHANGED** | Logic is ported, but Runtime lives in the meta grid that is collapsed by default (see next row), so the ticking value is not visible until the chevron is opened. Old showed it always. |
| 10 | Hero | Meta grid always visible: Task, Dataset (identicon, version, aliases), Model (+reasoning), Owner, Project, Started, Runtime, Version, Stop reason | RD/RunHero.tsx:200-273 | **CHANGED** | Hidden behind a chevron ("Show run details", pref `localStorage qym:run-hero-expanded`, default collapsed). Items-first design (UX_DECISION C). Experiment + Versioning panels are behind the same chevron. Acceptable but discoverability cost; ran. |
| 11 | Hero | Entity links in meta grid go to Runs list facets (task/model/owner/dataset; project) | RD/lib/heroModel.ts:97-133 | **OK** | ran: hrefs identical old vs new (`?task=`, `?model=`, `?owner=<id>`, `?dataset=`) |
| 12 | Hero | Dataset links to dataset page when slug known (+version tab) | RD/lib/heroModel.ts:112-118 | **CHANGED** | Old linked only the Runs-list facet; new links to the dataset page when `dataset_slug` exists. Improvement; not exercised (seed has no slug). |
| 13 | Hero | Version cell `git_branch • git_commit` | RD/RunHero.tsx:97,272 | **OK** | ran with injected run JSON: "main • abc1234" |
| 14 | Hero | Ingest-incomplete banner (missing items, rejected events list, "and N more") | RD/RunHero.tsx:162-212 | **OK** | ran: seeded 5/10 items + 1 rejected event, text identical; cutover-ingest-banner.spec |
| 15 | Hero | Private test set banner (`items_restricted`) | RD/RunHero.tsx:213-224 | **OK** | code; cutover-report-visibility.spec. Not run (needs restricted dataset). |
| 16 | Hero | Score-locked notice (SUBMITTED/APPROVED) and archived-project read-only notice | RD/components/RunPanels.tsx:285-306 | **OK** | ran: locked run shows identical copy, no pencils; items.spec read-only |
| 17 | Hero | Export HTML button -> `GET /api/runs/{id}/export-html` (new tab) | RD/RunHero.tsx:140-150 | **OK** | ran: link returns 200 text/html (2.2 MB) |
| 18 | Hero | Offline export page: banners, edits in localStorage, "Download with Changes", IS_EXPORT branches | (none; button opens the legacy endpoint) | **MISSING** | Deliberate drop, logged in decisions/run-detail/OPEN_QUESTIONS.md (offline export stays on the legacy endpoint). Verified only that the endpoint still serves the old page. |
| 19 | Hero | Execution context grid: config + metadata key/values, JSON values open the JSON viewer, hidden-key lists | RD/lib/heroModel.ts:4-95; RunHero.tsx:275-297 | **OK** | ran (only scalar keys in seed); cutover-metadata-json.test |
| 20 | Hero | Empty-object metadata preview (`{}` value) | RD/lib/heroModel.ts:62-78 | **BUGGY** | Listed in CUTOVER.md "empty-object metadata preview". Code: `looksJson({})` true -> JsonPreview of an empty object. Not reproduced in the UI (no such key seeded); keep as unverified minor. |
| 21 | Hero | Prev/next pager "N of M", two arrows, disabled at ends, tooltip when run not in list | RD/components/RunPager.tsx | **OK** | ran ("6 of 7"; hrefs); pager.spec, cutover-pager.spec |
| 22 | Hero | Pager peek card (name, model, start, primary metric) on hover/focus | (none) | **MISSING** | Deliberate drop (OPEN_QUESTIONS.md "pager peek card"). |
| 23 | Hero | `J` / `K` open next/previous run; suppressed while typing / dialog open | RD/RunPager.tsx | **OK** | ran: j -> next run, k -> back; ignored while typing; pager.spec |
| 24 | Hero | Pager keeps `?list=` context | RD/RunPager.tsx; hooks/useRunView.ts:81 | **OK** | pager.spec "?list= carries..." |
| 25 | Hero | Error states: 404 "Run not found" (no Retry), 403, 401, 5xx/network with Retry; 200 `{error}` sniffed | RD/RunDetailPage.tsx:24-37; api/runs.ts | **CHANGED** | Ran with route stubs. 404 and 500 (+Retry) equivalent. 403 / 200-`{error:"Access denied"}` render the generic "Couldn’t load this run - HTTP 403 · Access denied" instead of old "No access to this run / Ask a project admin"; the old "← Back to Dashboard" link is gone from all error states. Minor. |
| 26 | Hero | Wrong project in URL -> redirected to run's own project; legacy `/run/{id}` | RD/RunDetailPage.tsx:38-41; router.tsx | **CHANGED** | Improvement: `/run/<id>` now redirects to `/projects/<slug>/runs/<id>` (old stayed on /run). Ran. Unknown project shows "Project not found" in both. |
| 27 | Hero | Review history timeline under hero (submit/approve/reject/unapprove/unreject, actor, on-behalf-of, comment, "reconstructed" note), hidden when never submitted | RD/panels/ReviewsTab.tsx; AnalysisPanel.tsx:62 | **CHANGED** | Moved into an analysis-panel "Reviews" tab that exists only when events exist (ran: tab "Reviews 1" with the same text). No longer visible by default on a submitted run. Not refetched after Approve (CUTOVER). Acceptable. |
| 28 | Hero | Experiment panel (official runs): fields, Service result, Open experiment / Rerun / Promote links | RD/RunPanels.tsx:139-282 | **CHANGED** | Ran with injected `run.experiment`: all fields and hrefs identical. Differences: panel is inside the collapsed hero details; disabled "Rerun with this config" button became a text "Rerun unavailable"; "Promote to default preset" (disabled button with tooltip "Only completed runs can be promoted") is now hidden when the run is not COMPLETED/SUBMITTED/APPROVED. Minor. |
| 29 | Hero | Versioning details panel (sorted key/value list) | RD/RunPanels.tsx:1-98 | **OK** | ran (model_tag/prompt/retriever_index) inside expanded hero |
| 30 | Hero | Langfuse trace links (old page rendered none; `data-trace-url` only fed CSV) | RD/ItemCard.tsx:121,184-196; traces/TraceDrawer.tsx | **CHANGED** | New "Open in Langfuse" link on item output and in the drawer header (brief §3k NICE). Ran. |
| 31 | URL | `?q=` round-trips and filters identically | RD/lib/filterRules.ts:756-812; hooks/useRunView.ts | **OK** | ran: item counts and first row identical old vs new for 15 classic and 15 repeat-run URL combos (incl. ?pass=N, threshold, sort) |
| 32 | URL | `?sort=` (score_asc/desc, latency_asc/desc) round-trips and filters identically | RD/lib/filterRules.ts:756-812; hooks/useRunView.ts | **OK** | ran: item counts and first row identical old vs new for 15 classic and 15 repeat-run URL combos (incl. ?pass=N, threshold, sort) |
| 33 | URL | `?show=` passed\|failed\|metric_errors\|errors\|edited_metrics\|retries\|trace_errors round-trips and filters identically | RD/lib/filterRules.ts:756-812; hooks/useRunView.ts | **OK** | ran: item counts and first row identical old vs new for 15 classic and 15 repeat-run URL combos (incl. ?pass=N, threshold, sort) |
| 34 | URL | `?metric=` + `?threshold=` (0-100) round-trips and filters identically | RD/lib/filterRules.ts:756-812; hooks/useRunView.ts | **OK** | ran: item counts and first row identical old vs new for 15 classic and 15 repeat-run URL combos (incl. ?pass=N, threshold, sort) |
| 35 | URL | `?page=` round-trips and filters identically | RD/lib/filterRules.ts:756-812; hooks/useRunView.ts | **OK** | ran: item counts and first row identical old vs new for 15 classic and 15 repeat-run URL combos (incl. ?pass=N, threshold, sort) |
| 36 | URL | `?filters=` JSON (rules, score, errors{kind,label}, repeat dist, latency, categories, rootCause, approval...) byte-compatible | RD/lib/filterRules.ts:626-750 | **OK** | ran: URLs captured from the old UI (bar click, error card, rule builder latency>=3000, repeat distribution) load in new with the same counts |
| 37 | URL | `?hide_field=` / `?hide_metric_field=` (repeatable) | RD/hooks/useRunView.ts; ItemCard.tsx:106-118; MetricStrip.tsx | **BUGGY** | `hide_metric_field=reason` works. `hide_field=complexity\|domain` is ignored: the metadata badges (ITEM_METADATA_BADGE_KEYS) are not filtered by `ui.hiddenFields` (ItemCard.tsx:106), only generic tags are. Old hides them. Repro: `?item=item-0003&hide_field=complexity&hide_field=domain` -> "hard"/"support" still shown. |
| 38 | URL | `?item=ID` / `?item_id=ID` opens item on right page, scrolls under header, 2.6 s highlight | RD/ItemsSection.tsx:59-92 | **CHANGED** | Ran on 5,200-item run (`item-3000` -> page 150, row at top 198px). If the item is filtered out the new page drops the filters (old left it invisible). Improvement. items.spec. |
| 39 | URL | `?pass=N` scopes whole page without reload | RD/lib/passScope.ts; RunBody.tsx:50 | **OK** | ran: pass 1-3 counts identical to old; in-app navigation (old reloaded) |
| 40 | URL | `?trace=ID` opens trace drawer on load | RD/RunBody.tsx; TraceHost.tsx | **OK** | ran. Old page did NOT open the drawer from `?trace=item-0001` in my headless run (only via button), new does. Extra param `trace_pass` added. |
| 41 | URL | `?view=heatmap` (repeat runs) | RD/ItemsSection.tsx:190 | **OK** | ran: same count as old; renders grid |
| 42 | URL | `?list=` Runs-list context | RD/hooks/useRunView.ts:81 | **OK** | pager.spec |
| 43 | URL | `?panel=<tab>` (new) | RD/RunBody.tsx:101-106 | **OK** | new URL form; ran for 8 tabs |
| 44 | URL | Section anchors `#run-section-overview\|latency\|deep\|categories\|errors\|items` | `#overview\|latency\|deep\|categories\|errors\|root-cause\|repeat\|reviews\|items` + `#section-*` (RunBody.tsx:34-46,116) | **MISSING** | Old nav hrefs were `#run-section-*`. Ran: `#run-section-errors` / `#run-section-items` / `#run-section-latency` do nothing in new (tab stays Overview, no scroll). `#errors`, `#section-errors`, `#latency` work. Add the `run-section-` prefix to the regex. |
| 45 | URL | URL writes use replaceState and never scroll | RD/hooks/useRunView.ts:77-82 | **OK** | ran; items.spec "in-page URL changes keep the scroll position" |
| 46 | URL | Back restores scroll of the run page | (shell) | **CHANGED** | Ran: neither old nor new restores the run page scroll after following a link and pressing Back (both land at top). Parity. CUTOVER lists "Back to ?item= re-scrolls": new re-runs the deep-link scroll on return (handled ref reset, ItemsSection.tsx:63); old skipped it. Minor. |
| 47 | Live | Poll `live-status` every 3 s, pause when tab hidden, backoff to 30 s, size/duration throttle | RD/hooks/useLiveRun.ts:19-21,106-150 | **OK** | ran: item count 30 -> 34 within one probe; cutover-live-controls.spec (hidden tab, revision) |
| 48 | Live | In-place patch keeps open cards, scroll, filters | RD/lib/rowSignature.ts; useLiveRun.ts | **OK** | ran (30 -> 34 items, page stayed); live.spec asserts open card + scrollTop |
| 49 | Live | stop_requested -> STOPPING… and 1.5 s probing; `qym:run-status` event triggers immediate probe | RD/useLiveRun.ts:148-158 | **OK** | cutover-live-controls.spec; not run by me |
| 50 | Live | Live ends: final reload, step-latency + review-history reload, indicator removed | RD/useLiveRun.ts:78-86 | **OK** | ran: indicator gone and status COMPLETED within 10 s of run_completed; item total 50 |
| 51 | Live | A filter typed while live survives the refresh | RD/useLiveRun.ts | **OK** | live.spec |
| 52 | Nav/filters | Sticky section nav: run name + status once stuck, section links with counts (Errors 20, Items 240), scroll-spy, back-to-top | (none; panel tabs instead) | **MISSING** | Ran: after scrolling 1500px only the analysis aside is sticky (position:sticky scan). Sections became analysis-panel tabs; the item table is the page. Header/status/Filters are not visible once scrolled. Listed in CUTOVER.md. Not in decisions OPEN_QUESTIONS as a drop (UX_DECISION chose layout C). Severity minor/major depending on review. |
| 53 | Nav/filters | Filters (N) button + Clear (N) in the sticky bar | FilterBar.tsx:130-148,236-246 (in-flow bar above table) | **CHANGED** | Same behaviour (count badge, Clear), but the bar scrolls away with the table. Ran. |
| 54 | Nav/filters | Rule builder dropdown: nested AND/OR groups; fields = each metric, Root cause, Approval, Output text, metadata keys, Has error, Edited metrics, Retries, Trace errors, Latency | RD/items/RuleBuilder.tsx; lib/filterRules.ts:241-316 | **OK** | ran: same 14 fields in same order (Root cause appears once an analysis exists: confirmed after adding an issue); rule `latency >= 3000` count 35 equals old; filters.spec |
| 55 | Nav/filters | Typed values commit after 150 ms; builder not redrawn while typing; Escape/outside-click closes | RD/RuleBuilder.tsx; FilterBar.tsx:130 | **OK** | filters.spec (Escape returns focus) |
| 56 | Nav/filters | "Set on the page" chips (filters set from charts/cards) removable individually | RD/lib/activeChips.ts; FilterBar.tsx:224-235 | **CHANGED** | Rendered as removable chips under the bar with a count ("N of M items"). Ran with latency range chip "Latency 1.0 s-1.3 s". Fine. |
| 57 | Nav/filters | Search box 250 ms debounce; server search (`items/search`) for lazy snapshots; >10k chars forces full load | RD/hooks/useItemSearch.ts; FilterBar.tsx:93 | **OK** | ran: "Question 3" 10 items, Arabic 32 items - identical to old; cutover-search-race.spec |
| 58 | Nav/filters | Segmented Show: All/Pass/Fail/Errors; other `show` values (metric_errors, edited_metrics, retries, trace_errors) via URL | RD/FilterBar.tsx:43-48,86-88 | **CHANGED** | Old exposed those via chart/card clicks only too; new adds a pill for non-standard values. Counts identical (ran). |
| 59 | Nav/filters | Analysis metric select + "Pass if score >=" slider (score metrics with direction) | RD/FilterBar.tsx:98-128 | **CHANGED** | Moved from the Display popover to the bar (pain point §7.4 fixed). Ran: threshold 90 -> 23 items, same as old. |
| 60 | Nav/filters | Sort (index, score asc/desc, latency asc/desc) | RD/FilterBar.tsx:150-163; ItemsTable.tsx:236-262 | **CHANGED** | Select plus clickable column headers with aria-sort. Ran: `?sort=latency_desc`. |
| 61 | Nav/filters | Display popover: Layout (Cards/Heatmap, repeat only), Text (Raw/Rendered), Columns multi-selects | RD/FilterBar.tsx:164-225 | **BUGGY** | Layout and Text work. Clicking "Item fields" or "Metric fields" (MultiSelect, FilterBar.tsx:201,213) closes the whole Display popover and opens nothing - tried mouse and keyboard in Chromium; a MutationObserver sees the dialog disappear and no listbox appear. Hiding columns from the UI is impossible (URL params still work). Repro: open any run, Display, click Item fields. Major. |
| 62 | Nav/filters | Text mode raw/rendered persisted (`qym.textMode`), code/SQL stays raw | RD/FilterBar.tsx; lib/text.ts:39 | **OK** | ran: same key in old and new; cutover-xss.spec |
| 63 | Nav/filters | "Clear" counted sort and search as filters (pain point) | RD/lib/filterRules.ts:600-625 | **CHANGED** | Only real filters are counted now; intended fix. |
| 64 | Nav/filters | Filter banner "Filtered to N items that fail X" + "How the reason is chosen" popover + clear | RD/ItemsSection.tsx:158-172 | **OK** | ran: text identical; popover content is inline help text; cutover-reasons.spec |
| 65 | Nav/filters | Bool segment click scrolls page to Items section | RD/ItemsSection.tsx | **CHANGED** | No scroll needed in the side-by-side layout (items already visible). Fine. |
| 66 | Nav/filters | All filters also scope Overview, Categories, Errors, Root cause | RD/RunContext.tsx; panels/* | **OK** | ran: overview means recomputed for `show=failed` and score range; identical except one tie rounding (next row). cutover-report-visibility.spec |
| 67 | Nav/filters | Mean rounding | RD/lib/overviewModel.ts | **CHANGED** | Ran: quality mean of the 158 failing items shows 42.5% in old, 42.6% in new (all other cards identical across 6 URL scopes). Most likely a half-up vs toFixed tie. Cosmetic. |
| 68 | Overview | Stat strip Items / Completed / Errors / Not received | RD/ItemsSection.tsx:121-148 | **CHANGED** | Moved into the Items header (compact variant); Not received shown only when >0. Ran. |
| 69 | Overview | Score metric card: gauge, mean, "N scored · M err", 11-bucket histogram with error sub-bars, click-to-filter | RD/panels/OverviewTab.tsx; charts/Charts.tsx:110-150 | **OK** | ran: card text identical for 6 scopes; bar click sets `filters={"score":[0.3,0.4]}` (32 items, same as old) |
| 70 | Overview | Empty bars not clickable | RD/Charts.tsx | **OK** | cutover-layout.spec |
| 71 | Overview | Boolean card: Pass/Fail split bar with error segment, legend, click-to-filter | RD/Charts.tsx:53-80 | **OK** | ran: `metric=exact_match&show=failed` (178), error segment `show=metric_errors` (12) identical |
| 72 | Overview | Numeric card Min/Avg/Max/Total | RD/OverviewTab.tsx | **OK** | ran |
| 73 | Overview | Error-accounting notes ("12 task errors · counted as 0%", "not counted in the mean") | RD/lib/overviewModel.ts; metricCardNotes.test.ts | **OK** | ran: identical text for classic, repeat, ?pass=2, locked |
| 74 | Overview | Overview gets its own always-visible section | analysis panel tab "Overview" (default) | **CHANGED** | Side panel; under 1200px a Drawer. Ran. |
| 75 | Analysis | Deep: Pearson correlation matrix + cell click plots pair | RD/panels/DeepTab.tsx | **OK** | ran: matrix values; panels.spec |
| 76 | Analysis | Deep: strongest-relationship scatter with X/Y selects | RD/DeepTab.tsx | **OK** | ran |
| 77 | Analysis | Deep: item x metric matrix | (none) | **MISSING** | Deliberate drop (OPEN_QUESTIONS.md 2026-10-12). |
| 78 | Analysis | Deep: quality-latency frontier | (none) | **MISSING** | Deliberate drop (same entry). |
| 79 | Analysis | Deep: observed performance by pass (trend) | (none) | **MISSING** | Deliberate drop (same entry); the Repeat tab has a pass@k curve and per-pass table instead. |
| 80 | Analysis | Deep: quality-stability map | (none) | **MISSING** | Deliberate drop (same entry). |
| 81 | Analysis | Categories: chips of metadata keys (auto-select first 3 with <=30 values), cards with average, item count, latency, click-to-filter | RD/panels/CategoriesTab.tsx | **OK** | ran: complexity/domain/source rows with avg, items, latency, % pass; click sets `filters={"complexity":["hard"]}` (69), second click clears |
| 82 | Analysis | Categories: Cards/Compare views, domain include/exclude/only modes | (Cards only) | **MISSING** | Deliberate drop (OPEN_QUESTIONS.md "Compare view and Sankey dropped"). Multi-value select could not be driven by my selector, but filterRules supports arrays. |
| 83 | Analysis | Errors: Task/Metric/Trace/Analysis groups, cards by message with counts, click or Enter toggles per-kind filter, long labels round-trip as prefix+hash | RD/panels/ErrorsTab.tsx; lib/rowErrors.ts | **OK** | ran: card click -> 6 items, click again clears, Enter works; URL identical to old; panels.spec |
| 84 | Analysis | Errors: "Show more" for long messages | RD/ErrorsTab.tsx | **OK** | code; not exercised (short messages) |
| 85 | Analysis | Root cause: category cards with subcause counts, click -> filter, metric select | RD/panels/RootCauseTab.tsx | **OK** | ran: after adding an issue the card "Hallucination 1 · Wrong clause (1)" appears; click sets `filters={"rootCause":["Hallucination"]}` |
| 86 | Analysis | Root cause: Sankey categories -> solutions with hover highlight | (none) | **MISSING** | Deliberate drop (OPEN_QUESTIONS.md). |
| 87 | Analysis | Root cause: "Aggregate results" (POST aggregate-analysis) with status line; "Auto-Analyze" -> analyzer page | RD/RootCauseTab.tsx | **OK** | Auto-Analyze link verified (`/runs/{id}/analyzer`); Aggregate not run (needs an LLM); code only |
| 88 | Analysis | Section hidden when no analyses / no rows | RD/RootCauseTab.tsx; cutover-report-visibility.spec | **CHANGED** | Root cause tab is always listed and shows an empty state with Auto-Analyze. Fine. |
| 89 | Repeat | Repeat run analysis only when samples>1, not in ?pass=N, not in export | RD/AnalysisPanel.tsx:62 | **OK** | ran: tab present on all-passes view, absent on `?pass=2` |
| 90 | Repeat | Metric tabs, threshold slider (debounced), Pass@k / Pass^k / Consistency / Reliability / Avg score / Avg latency / Errors tiles | RD/panels/RepeatTab.tsx:50-130 | **OK** | ran: values identical (78.3%, 55.0%, 84.4%, 85.1%, 66.7%, 2.0s, 4) |
| 91 | Repeat | Statistic tabs (Compare / Pass@k / Pass^k / Average) on the curve | (curve always draws Pass@k and Pass^k) | **MISSING** | Old `statisticOptions` (run.html:9667). New has only the Chart/Table toggle. Minor. |
| 92 | Repeat | Pass@k curve with 95% CI band; Chart/Table toggle | RD/RepeatTab.tsx:176-200; Charts.tsx:300-360 | **OK** | ran (CI band visible) |
| 93 | Repeat | Per-pass sweep table: status, metric cols, avg + median latency, errors, items, queued-pass row | RD/RepeatTab.tsx:140-170 | **CHANGED** | Ran: rows match old numerically; "Median latency" column and the queued-passes row are missing. Pass rows link to `?pass=N` (ran). Minor. |
| 94 | Repeat | Distribution "how many passes passed" bars -> repeatDistFilter | RD/Charts.tsx:392-410 | **OK** | ran: URL form identical (`filters={"repeat":...}`) counts equal for bucket 1 and 3 |
| 95 | Repeat | Repeat help texts direction-aware | RD/RepeatTab.tsx | **BUGGY** | CUTOVER finding. Panel copy is static ("Higher is better."). Code review; no lower-is-better repeat metric in my seed. Minor. |
| 96 | Repeat | All-passes item card: output columns per pass with toggles, per-pass verdict, latency, trace, copy, "N unique", per-pass metric chips with editing | RD/items/PassColumns.tsx | **OK** | ran on item #1: Pass 1-3, "3 unique", per-pass chips/edit buttons; repeat.spec |
| 97 | Repeat | Per-metric comparison panel across pass columns (`qym-metric-compare`) and hidden-output state kept across re-renders | (per-pass chips only) | **MISSING** | Not in decisions log. Minor. |
| 98 | Repeat | Heatmap item x pass (virtualized, 40 px rows) | RD/items/Heatmap.tsx | **OK** | ran: 60 rows x 3 passes, failed pass marked; cell click opens the item in Cards view (pass of the clicked cell is discarded, `void pass` in ItemsSection.tsx:204) - minor CHANGED |
| 99 | Repeat | Latency section pass dropdown (navigates ?pass=N with full reload) | RD/panels/LatencyTab.tsx | **CHANGED** | No dropdown in the Latency tab; pass is chosen via the Repeat tab links or the hero pill and the step-latency query follows `?pass`. Ran: no pass control on repeat run Latency tab. Acceptable. |
| 100 | Repeat | Root cause editing on the all-passes item card | links "Pass 1/2/3" to `?pass=N&item=ID` (RD/analysis/MetricAnalysisCards.tsx:140-152) | **CHANGED** | Decision: issues are per pass (OPEN_QUESTIONS.md). Ran. |
| 101 | Latency | Latency section only when rows have latency or spans | RD/panels/LatencyTab.tsx:405-440 | **OK** | code |
| 102 | Latency | Response time: p50/p90/p95/mean pins, histogram, brush drag -> latency filter + chip + clear | RD/LatencyTab.tsx:55-135 | **CHANGED** | Brush drag replaced by click / shift-click on bars (aria-labelled buttons) and pins that filter ">= p". Ran: bar -> `filters={"latency":[1000,1250]}` (17 items), p90 pin -> 24 items, chip removable. Shift-click range extension could not be driven in my probe (timeout) - verify by hand. traces.spec |
| 103 | Latency | Quality vs latency scatter: metric dropdown, threshold line, dot click opens item | RD/LatencyTab.tsx:140-165 | **CHANGED** | Dot click works (sets `item=`; ran). The metric dropdown inside the scatter is gone (uses the page analysis metric). Minor. |
| 104 | Latency | Time budget (task vs eval, per sub-agent, per family LLM/RETRIEVAL/TOOL/GUARD/OTHER) and kinds breakdown | RD/LatencyTab.tsx:168-240 | **OK** | ran: text equals old figures (2.1 s avg, 61 traces, 18 failed; LLM 905 ms 43%...) |
| 105 | Latency | Steps plot (p5-p95 whisker, p25-p75 box, median): By step/By kind, Linear/Log, search | RD/LatencyTab.tsx:245-400 | **OK** | ran: By kind, Log, search; cutover-step-latency.spec (8 tests) |
| 106 | Latency | CSV links summary + spans; SVG download | RD/LatencyTab.tsx:289-296 | **CHANGED** | CSV links verified (`format=csv`, `&level=spans`, current pass). SVG download dropped (brief: DROP-CANDIDATE). |
| 107 | Latency | Error "Trace timings did not load" + Retry; quiet reload when live run ends | RD/LatencyTab.tsx; useLiveRun.ts:78 | **OK** | cutover-step-latency.spec; code |
| 108 | Latency | Zero-latency items | RD/items/ItemsTable.tsx:191; ItemCard.tsx:174; PassColumns.tsx:142 | **BUGGY** | `row.latency_ms ? ... : "—"`: a legitimate 0 ms is shown as "—" in the table and omitted in cards/pass columns. Ran with an item at latency 0 (seeded). Old card also omits it, but the old latency histogram/sort keep it; the table "—" is wrong. Use `!= null`. Minor. |
| 109 | Items | Cards list with collapsed row: chevron, #index, status tag, input title (dir auto/rtl), failure reason, metric pills + "+N more" | RD/items/ItemsTable.tsx:80-210 | **CHANGED** | Now a real table with column headers and aria roles; metrics shown as columns that fit (fit computed in JS, ItemsTable.tsx:236). Reason column hidden below 760px. Ran: Arabic rows rtl; Error rows get red left border. |
| 110 | Items | Click / Enter / Space on a row toggles the card | RD/ItemsTable.tsx:121-130 | **OK** | ran (item #3); items.spec, overview.spec keyboard |
| 111 | Items | Pagination 20 per page, page in URL | RD/ItemsTable.tsx:299-312 | **CHANGED** | Page size selector 20/50/100/500 (pref `qym:run-page-size`), default 20 so old `?page=N` links land the same; ran `?page=3`, `?page=260` on 5,200 items. |
| 112 | Items | Status tags: Pass / Fail / error icon / Not received | RD/ItemsTable.tsx:140-160 | **OK** | ran |
| 113 | Items | Failure reason per row with source; server fetch only for rows the index cannot hold (`items/reasons`) | RD/hooks/useItemReasons.ts; lib/itemReasons.ts | **OK** | ran: reason + source on failing rows, explanation fetched for edited item; cutover-reasons.spec |
| 114 | Items | Count "n of m items" | RD/FilterBar.tsx:224 | **OK** | ran |
| 115 | Items | Empty / no items states | RD/ItemsTable.tsx:284; ItemsSection.tsx:218 | **OK** | code; cutover-report-visibility.spec |
| 116 | Items | Auto-analyze button in section header (only when no diagnoses exist) | RD/ItemsSection.tsx:149-157 | **CHANGED** | Always shown for non-read-only. Minor. |
| 117 | Items | Never redraw list while an input inside it has focus; open cards survive | RD/ItemsTable.tsx (memo rows) | **OK** | cutover-layout.spec "typing in the search box never empties the list" |
| 118 | Items | CSV export: ensure all filtered bodies loaded, column picker (groups, select/deselect all), BOM, `<run>_export.csv` | RD/items/CsvExport.tsx; lib/csv.ts | **CHANGED** | Ran on 138 filtered items and all 5,200 (2.3 s, 5,200 rows, 34 cols, BOM). Row counts match old. Column names/groups differ (below). |
| 119 | Items | CSV headers: `#`, `<metric>_score`, `meta:<key>`, `<metric>:<field>`, `<metric>:root_cause_issues`, `input.<k>`, `output.<k>` | RD/lib/csv.ts | **CHANGED** | New: `index`, `<metric>`, `<key>` (no `meta:` prefix, `retry_count` twice), `<metric>.<field>`, plus `error`, `input`, `output`. Anyone parsing old exports must change. Acceptable only if documented. |
| 120 | Items | CSV column `<metric>:root_cause_issues` (JSON) and `meta:trace_stats` | (none) | **MISSING** | Not logged. Minor. |
| 121 | Items | Perf: 5,200-item run first render / search / sort / last page | RD/items/ItemsTable.tsx (react-virtual) | **OK** | ran: items visible 1.5 s (old 1.3 s), search 0.3 s (old 0.6 s), sort 1.2 s, `?page=260` 2.0 s; compact payload 424 KB gz; analysis tabs mount in <3.4 s |
| 122 | Item | Lazy body load per card with "Loading item details…" and per-card Retry; one `items/details` POST | RD/ItemCard.tsx:84-110; hooks/useItemDetails.ts | **OK** | items.spec |
| 123 | Item | INPUT with Copy link + copy; EXPECTED (Show more); OUTPUT with status tag, duration, start time, Trace, copy | RD/ItemCard.tsx:120-210 | **OK** | ran; Copy link puts the full `?item=` URL on the clipboard |
| 124 | Item | Metadata badges (complexity coloured by level, domain) and `key: value` tags; structured values never `[object Object]` | RD/ItemCard.tsx:106-125; lib/rowMeta.ts | **CHANGED** | Ran: tags shown ("hard", "support", "source: human") but complexity is no longer coloured by level (plain data tag). cutover-reasons.spec covers [object Object]. |
| 125 | Item | Item analysis warnings strip (`rdi-analysis-warning`) | (none) | **MISSING** | CUTOVER finding; old run.html:14358. Not logged in OPEN_QUESTIONS. |
| 126 | Item | Trace chips (tokens, cost, LLM calls, tool calls/errors, retries) | RD/ItemCard.tsx:50-70 | **OK** | ran |
| 127 | Item | Output not received warning; task error `ERROR: …`; rows excluded from means | RD/ItemCard.tsx:97,196 | **OK** | ran: item-0240 and item-0008 text matches old |
| 128 | Item | Task-error / not-received rows show NO metric chips or root cause cards | RD/ItemCard.tsx:207; analysis/MetricAnalysisCards.tsx:165 | **BUGGY** | Ran item-0008 (task error): new renders 4 "⚠ Error" chips and four empty "Root cause · metric / + Add issue" cards for metrics that never ran; not-received row shows four "—" chips. Old shows none. (CUTOVER: "metric cards on task-failed rows".) Minor. |
| 129 | Item | Metric strip: value chip, judge-metadata disclosure, edit pencil, edited badge | RD/items/MetricStrip.tsx | **OK** | ran: details list shows judge_model/confidence/label/explanation; hide_metric_field hides keys |
| 130 | Item | Score edit: invalid input keeps editor open with message; Esc cancels; save updates chip, row, overview | RD/items/ScoreEditor.tsx | **OK** | ran: "abc" and "50" -> "Enter a value from 0 to 1, or 0% to 100%"; "50%" -> 50.0% + edited, row flips to Fail, overview mean recomputed; Esc closes. Error message does not clear on typing (old did) - trivial |
| 131 | Item | Edited badge tooltip "Edited by a reviewer on <date> · 0.647 → 0.5 · Original score", and "Reset to original (0.647)" button | RD/MetricStrip.tsx:94-100; ScoreEditor.tsx:105 | **BUGGY** | Ran: tooltip is only "Edited; scorer value 0.844" (no editor, date, new value); reset exists only inside the open editor as "Reset to scorer value" (works). CUTOVER finding. Minor. |
| 132 | Item | Reset score to original (toast "Score reset") | RD/ScoreEditor.tsx:62-70 | **CHANGED** | Works (ran), no success toast. Minor. |
| 133 | Item | 403 when scores locked / 409 pass-version conflict shown beside input | RD/ScoreEditor.tsx:30-37 | **OK** | items.spec (409); cutover-pass-revision.spec. Locked run: no pencils (ran) |
| 134 | Item | Pass-version optimistic lock `expected_pass_version` | RD/ScoreEditor.tsx:57; IssueDialog.tsx:99 | **OK** | cutover-pass-revision.spec. CUTOVER "stale passRevision in IssueDialog": not reproduced - the dialog reads `model.passRevision` at submit time. |
| 135 | Item | Per-metric root cause card: issues with category, subcategory, finding, why, solution + notes, confidence, status; + Add issue; Edit; Approve | RD/analysis/MetricAnalysisCards.tsx | **OK** | ran full cycle on item-0003/quality: add -> "Pending review", edit, approve -> "Approved", delete; root-cause tab and rule field update |
| 136 | Item | Issue cards only for failing/errored metrics or saved analysis | RD/MetricAnalysisCards.tsx:166-176 | **OK** | ran |
| 137 | Item | Approve only for pending issues; judged by `review_issue_statuses` (rejected -> no Approve, hint) | RD/MetricAnalysisCards.tsx:90 | **BUGGY** | New shows "✓ Approve" for every issue whose `review_status` != approved, including rejected ones (server answers 409 -> toast) and never reads `review_issue_statuses`. Old: run.html:11380-11410. CUTOVER finding. Not run (no rejected issue seeded); code evidence. Minor. |
| 138 | Item | Issue dialog: category list from project catalog with guidance + search, issue fields, solution preset select or new solution, Save / Save and add another / Delete | RD/analysis/IssueDialog.tsx | **CHANGED** | Ran: category select (catalog + "New category…"), subcategory, finding, why, free-text solution + notes, Save / Save and add another / Delete issue, empty-category validation. No category guidance search list when catalog has no taxonomy text, no solution presets, no approved-subcategory/solution pickers (CUTOVER; decision Q12 logged). |
| 139 | Item | Edit project category catalog from the dialog (`PUT analysis-category-catalog`) | (none) | **MISSING** | Deliberate drop (OPEN_QUESTIONS.md Q12). |
| 140 | Item | Legacy item-level diagnosis editors (category picker, detail, solution dropdowns, feedback textarea) and legacy correction approve (`/api/corrections/...`) | RD/MetricAnalysisCards.tsx:178-198 (read-only legacy block) | **MISSING** | Deliberate drop, values render read-only (OPEN_QUESTIONS.md). |
| 141 | Item | Root cause editing on a locked run | RD/MetricAnalysisCards.tsx:155 | **CHANGED** | `canEdit = !readOnly` ignores `scoresLocked`; on a SUBMITTED run Add issue / Edit stay available. Old CSS also only hid score editors, so likely parity, but confirm intent. Not run. |
| 142 | Item | Empty-state: items with no trace id | RD/ItemsTable.tsx:196; ItemCard.tsx:177 | **CHANGED** | Old shows a Trace button on every item of a traced run (opened an empty drawer for item-0003); new shows the button/icon only when `trace_id` exists. Better. |
| 143 | Trace | Drawer with backdrop, focus trap, inert when closed, `?trace=` sync, focus returns to trigger | RD/traces/TraceDrawer.tsx; TraceHost.tsx | **OK** | ran: focus inside dialog, Esc closes, URL cleared, focus back on "Open trace of item #1"; cutover-trace-drawer.spec |
| 144 | Trace | Header chips: spans, attempts · failed, duration, tokens, cost, errors, scores, copy trace id, orphan warning | RD/TraceDrawer.tsx:297-345 | **OK** | ran (8 spans, 1.6s, 800 tokens, $0.0012; "2 attempts · 1 failed", "1 errors"). Score pills/orphan warning not exercised |
| 145 | Trace | Span tree: waterfall, kind icons, model/tokens inline, error badges, expand/collapse all, search filter | RD/TraceDrawer.tsx:80-160,380-460 | **OK** | ran; traces.spec |
| 146 | Trace | Noise collapse and retry merge (`try N` chips, attempts) | RD/lib/traceTree.ts | **OK** | ran on item-0006: "All attempts / Attempt 1 · failed / Attempt 2", try 1/try 2 markers |
| 147 | Trace | Error-path default selection; error trace shows provider error | RD/TraceDrawer.tsx | **OK** | ran item-0046: error span shows "RateLimitError… (429)" |
| 148 | Trace | Keyboard: j/k/arrows move, Enter/→ expand, ← collapse, `/` focus search, Esc layers (search, then drawer) | RD/TraceDrawer.tsx:246-275,391 | **OK** | ran; traces.spec. Honouring `qym:single-key-shortcuts=off` not checked |
| 149 | Trace | Detail tabs by kind: Messages, Response, Input/Output, Tool I/O, Documents, Metrics, Scores, Raw | RD/traces/SpanDetail.tsx:105-120 | **CHANGED** | Tabs shown conditionally (Messages / Input / Output / Documents / Metrics / Scores / Raw). Ran: LLM span Messages (system/user/assistant) and Raw. Separate Response and Tool I/O tabs are folded into others. |
| 150 | Trace | Raw tab = span JSON | RD/SpanDetail.tsx:205-218 | **BUGGY** | Ran: Raw JSON includes internal view-model fields (`_i: undefined`, `_children: undefined`, `_depth`, `_orphan`, `_groupParent`, `_retry`, `_try`, `_failed`). Strip all `_*` keys before JsonTree. |
| 151 | Trace | Resizable divider between tree and detail; expand-to-modal for long content | (none) | **MISSING** | Divider was NICE in the brief; modal not logged. Minor. |
| 152 | Trace | "Spans not captured" note when an item has a trace id but no spans | RD/TraceDrawer.tsx:457 | **BUGGY** | CUTOVER finding. Ran `?trace=item-0002` (no trace): drawer opens with "0 spans … No spans match. Select a span." and no explanation. Minor. |
| 153 | Trace | Trace load failure shows error + Retry | RD/TraceDrawer.tsx | **OK** | traces.spec "failing trace request shows an error with Retry" |
| 154 | Trace | `?trace=` for a repeat pass (`trace_pass`) | RD/hooks/useRunView.ts:103 | **OK** | traces.spec (new param, additive) |
| 155 | Layout | Below 1200px analysis becomes a Drawer; `#anchor` opens it | RunBody.tsx:92-110; AnalysisPanel.tsx:108 | **OK** | ran at 1100: Esc closes, `#errors` opens drawer on Errors; panels.spec |
| 156 | Layout | Narrow screens (<=480px) | RunBody.module.css | **BUGGY** | Ran at 420px: shell content scrolls horizontally (scrollWidth 453 > 364), Items header description truncates to "E…", header buttons overflow, topbar title overlaps the run name. Minor; check against old at same width. |
| 157 | Layout | Accessibility: table roles, aria-sort, dialogs, chart bars as buttons | RD/items/ItemsTable.tsx; Charts.tsx | **OK** | a11y.spec (8 axe cases); old page had div role=button cards / hover-only Sankey. Two buttons share the accessible name "Analysis" (Items header and topbar) - minor. |
| 158 | Layout | RTL/Arabic: input titles and bodies dir=rtl/auto; search by Arabic text | RD/ItemsTable.tsx:111; lib/itemText.ts | **OK** | ran: `dir=rtl` on title and body; Arabic search 32 items = old |
| 159 | Layout | Number formats (1.4s, 925ms, 5,200) | RD/ItemsTable.tsx:191 | **CHANGED** | Counts use thousands separators in new ("5,200 of 5,200 items", old "5200"). Fine. |
| 160 | Layout | Persisted prefs | `qym:run-hero-expanded`, `qym:run-page-size`, `qym.textMode` | **CHANGED** | New keys for hero and page size; old page had none besides text mode and `qym:single-key-shortcuts` (read only). Ran. |
| 161 | Layout | Keep section still on filter (no scroll jumps) | (by design) | **OK** | items.spec / cutover-layout.spec; ran: filter, tab and item open do not move scroll |

## Fix list (BUGGY and MISSING, by user impact)

1. **[major] Display > Item fields / Metric fields multi-select closes the Display popover and never opens**  
   Where: FilterBar.tsx:201,213 (MultiSelect inside Popover; nested popover dismisses its parent)  
   Repro: Open Display, click "Item fields" (mouse or Enter): popover vanishes, no list. Hide columns only via URL.  
   Hint: Render the MultiSelect list inside the Display popover (inline checkbox list) or fix the nested-popover dismissal (isNonModal / shouldCloseOnInteractOutside for the child popover).
2. **[major] No sticky header / section nav: status, Filters and Clear scroll away; no scroll-spy or counts**  
   Where: RunBody.tsx / RunBody.module.css (no sticky element except the analysis aside)  
   Repro: Scroll the item table: hero, filter bar and Clear are off-screen.  
   Hint: Make the filter bar (and a slim run name + status) `position: sticky` under the shell header; tabs already give section access. Needs a product decision (UX_DECISION chose C).
3. **[minor] `hide_field` ignored for complexity/domain badges**  
   Where: items/ItemCard.tsx:106-118  
   Repro: `?item=item-0003&hide_field=complexity&hide_field=domain` still shows "hard"/"support".  
   Hint: Filter the badge list with `ui.hiddenFields` like the generic tags.
4. **[minor] Approve offered on rejected issues; `review_issue_statuses` ignored**  
   Where: analysis/MetricAnalysisCards.tsx:81,90  
   Repro: Rejected issue shows "✓ Approve"; click -> 409 toast.  
   Hint: Resolve status as in run.html:11380 (`pass_review_issue_statuses` / row `review_issue_statuses` by issue_id, fall back to review_status); hide Approve and show a "Rejected" tag with the Reviews hint.
5. **[minor] Raw span JSON leaks `_i/_children/_depth/_orphan/_groupParent/_retry/_try/_failed`**  
   Where: traces/SpanDetail.tsx:205-218  
   Repro: Open trace, select any span, Raw tab.  
   Hint: Build the Raw object by dropping every key starting with `_`.
6. **[minor] Task-failed and not-received rows show metric chips and empty Root-cause cards**  
   Where: items/ItemCard.tsx:207; analysis/MetricAnalysisCards.tsx:165-176; items/MetricStrip.tsx  
   Repro: Open item-0008 (task error): 4 "⚠ Error" chips and 4 "Add issue" cards.  
   Hint: Skip MetricStrip/analysis cards when `isItemTaskError(row)` or `output_received === false` (still render saved analyses).
7. **[minor] Zero latency rendered as "—" / omitted**  
   Where: items/ItemsTable.tsx:191; ItemCard.tsx:174; PassColumns.tsx:142  
   Repro: Item with latency_ms 0 shows "—" in the table.  
   Hint: Test `row.latency_ms != null`.
8. **[minor] Edited-score tooltip loses editor/date/before->after; no "Reset to original (x)" next to the badge**  
   Where: items/MetricStrip.tsx:94-100; ScoreEditor.tsx:104-110  
   Repro: Hover "edited": "Edited; scorer value 0.844".  
   Hint: Show who/when/original -> new (from metric_meta edit fields) and a reset action on the badge; toast on reset.
9. **[minor] Old section anchors `#run-section-*` do nothing**  
   Where: RunBody.tsx:34,116  
   Repro: Open `/runs/<id>#run-section-errors`.  
   Hint: Strip an optional `run-section-` prefix in the hash regex.
10. **[minor] No explanation for an item with a trace id but no spans; empty drawer**  
   Where: traces/TraceDrawer.tsx:457  
   Repro: `?trace=item-0002`.  
   Hint: When summary.span_count is 0 show "Spans were not captured for this item" (and hide the filter bar).
11. **[minor] Repeat tab lacks statistic switch (Compare/Pass@k/Pass^k/Average), median latency column and queued-passes row; help copy not direction-aware**  
   Where: panels/RepeatTab.tsx:140-200  
   Repro: Compare with old Repeat run analysis on the repeat run.  
   Hint: Port `statisticOptions`, add median latency + queued row, make copy depend on metric direction.
12. **[minor] Per-metric comparison panel across pass columns missing**  
   Where: items/PassColumns.tsx  
   Repro: Open a repeat item in all-passes view.  
   Hint: Add a metric selector that lines up one metric across passes.
13. **[minor] Item analysis warnings strip missing**  
   Where: items/ItemCard.tsx  
   Repro: Old run.html:14358 `rdi-analysis-warning`.  
   Hint: Render `row.item_metadata.analysis_warning(s)` above the output.
14. **[minor] CSV export lacks root-cause issues JSON / trace_stats columns and renamed headers (`index`, `<metric>`, no `meta:`)**  
   Where: lib/csv.ts  
   Repro: Compare old and new CSV headers (captured in scratchpad qa/old-export.csv, new-export.csv).  
   Hint: Add the root-cause JSON column per metric; document or keep legacy header names.
15. **[minor] Narrow viewport (<=480px): horizontal overflow and overlapping topbar title**  
   Where: RunBody.module.css; ItemsSection.module.css  
   Repro: Resize to 420px.  
   Hint: Wrap the Items header actions and let the description wrap; check shell topbar min-width.
16. **[minor] 403 / denied error copy and "Back to Dashboard" link gone**  
   Where: RunDetailPage.tsx:24-37  
   Repro: Stub 403 on `/api/runs/{id}`.  
   Hint: Pass tailored titles to ErrorState and add a back link.
17. **[minor] Live indicator "updated Ns ago" keeps counting between probes**  
   Where: RunHero.tsx:60; hooks/useLiveRun.ts:70  
   Repro: Open a running run for 10 s.  
   Hint: Set `updatedAt` on every successful probe (or label it "Data from Ns ago").
18. **[minor] Meta grid (incl. Runtime) hidden by default; ticking runtime not visible on live runs**  
   Where: RunHero.tsx; RunBody.tsx:60  
   Repro: Open a RUNNING run: no runtime until the chevron is used.  
   Hint: Show Runtime beside the status for live runs, or default-expand while live.
19. **[minor] Offline export, pager peek, Sankey, categories Compare, deep panels (matrix/frontier/by-pass/stability), category catalog editing, legacy diagnosis editors: deliberate drops**  
   Where: n/a  
   Repro: See decisions/run-detail/OPEN_QUESTIONS.md  
   Hint: Product call; none is a regression bug.
20. **[minor] Heatmap cell click discards the pass; Auto-analyze button always shown; empty-object metadata preview; locked-run root cause editing parity**  
   Where: ItemsSection.tsx:204; heroModel.ts:62; MetricAnalysisCards.tsx:155  
   Repro: n/a  
   Hint: Low priority; confirm intent.

## Not verified

- Aggregate results (needs an LLM), STOPPING state, hidden-tab polling, private test set banner, trace score pills/orphan warning, `qym:single-key-shortcuts` opt-out, Shift-click range on the latency histogram, rejected-issue Approve (no rejected issue seeded), lower-is-better repeat metric copy, running repeat run "pass k/N" badge: read in code or covered by specs only.
- Narrow-width comparison against the old page was not run; the 420px finding is new-UI only.
- CUTOVER items outside this area (Runs-list Back scroll, models global filter, Sweep delta tint, Langfuse CTAs on Compare) are not covered here.
