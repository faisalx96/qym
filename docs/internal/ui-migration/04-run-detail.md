# Run detail page — migration brief

Written by an analysis agent for the React/TypeScript/Vite migration. Audience: the
component agent that will rebuild this area from scratch in `frontend/`. Be concrete:
file paths with line numbers, API routes with methods and response shapes, exact
behaviors. No marketing language.

All paths below are relative to `packages/platform/qym_platform/` unless they start
with `docs/` or `tests/`. `run.html` means `_static/dashboard/run.html`; line numbers
are from branch `UI-redesign` at the time of writing.

Layout of `run.html` (17,259 lines): lines 25–6275 are a page-local `<style>` block
(~6,250 lines of CSS), 6282–6481 the static body markup (200 lines), 6482–17257 one
IIFE of inline JS (~10,800 lines). Everything else the page needs is in the sibling
modules listed in §1.

## 1. Surface inventory

| Page / route | HTML file | JS / CSS it loads (in `<head>` order) | Entry function(s) | Approx LOC |
|---|---|---|---|---|
| `/projects/{slug}/runs/{run_id}` (canonical) and legacy `/run/{run_id}` — both served by `api/runs.py:2478-2497` (`run_ui`, `project_run_ui`) | `run.html` | CSS: `dashboard.css`, `shell.css`, `ui_components.css`, `latency_traces.css`, `json_viewer.css`, `run_versioning_details.css`. JS: `qym_safe.js`, `auth.js`, `shell.js`, `metrics.js`, `runs_order.js`, `run_details.js`, `run_experiment_panel.js`, `run_versioning_details.js`, `qym_live.js`, `trace_viewer.js`, `latency_traces.js`, `review_history.js`, `item_reasons.js`, `run_section_nav.js`, `json_viewer.js`, `ui_components.js` (deferred) | `loadRunData()` (run.html:7574) → `processRun()` (8045) → `applyRunViewUrlState()` (13642) → `initializeRunDetails()` (8228) → `render()` (8823) → `startLiveRefresh()` (7742) | run.html 17,259 |
| Query-param views of the same route: `?pass=N` (one pass of a repeat run), `?item=ID` / `?item_id=ID` (deep link to one item), `?trace=ID` (auto-open trace drawer), `?list=…` (Runs-list order for prev/next), plus the view params in §2 J1 | same | same | `VIEW_PASS`, `TARGET_ITEM_ID` (run.html:6514-6527), `QymTraceViewer.restoreFromUrl()` (trace_viewer.js:2674), `RUNS_LIST_CONTEXT` (run.html:9236) | — |
| Exported standalone HTML (`GET /api/runs/{id}/export-html`, `api/runs.py:4460`) — the same `run.html` with CSS/JS inlined and `window.__QYM_EXPORT_DATA__` baked in; `IS_EXPORT` branches in the page | same file, offline | inlined copies | `loadRunData()` export branch (7590-7609), `applyExportMode()` (17195), `downloadExportHtml()` (17233) | — |
| Sub-modules | | | | |
| Lazy row loader | — | `run_details.js` | `QymRunDetails.create({runId, apiUrl, passNumber, transformRow})` | 316 |
| Sticky section nav + scroll-spy + "keep section still" | — | `run_section_nav.js` | `QymRunSectionNav.create({scrollHost, content, nav, signal})` | 377 |
| Versioning details panel | — | `run_versioning_details.js` + `.css` | `QymRunVersioningDetails.render(container, run)` | 62 + 47 |
| Experiment panel (official runs) | — | `run_experiment_panel.js` | `QymRunExperimentPanel.render(container, run, {projectSlug, isExport})` | 236 |
| Failure reason picker | — | `item_reasons.js` | `QymItemReasons.pick / needsServerReason / ORDER` | 106 |
| Review history timeline | — | `review_history.js` (injects its own `<style>`) | `QymReviewHistory.load(container, url, key)` | 194 |
| Trace viewer drawer | — | `trace_viewer.js` (styles live in `dashboard.css` `.tv-*`) | `QymTraceViewer.init/open/openFromButton/close/restoreFromUrl` | 2,708 |
| Latency and traces section | — | `latency_traces.js` + `latency_traces.css` | `QymLatencyTraces.mount/update/reload` | 1,164 + 334 |
| Step latency interval plot | — | `step_latency.js` | `QymStepLatency.mount(panel, runIds, opts)` — **not loaded by run.html any more**; only `compare.html:9549` uses it. `latency_traces.js` replaced it on the run page. | 1,585 |
| Live poller | — | `qym_live.js` | `QymLive.poll(loader, {intervalMs, maxIntervalMs})` → `{stop, now}` | ~90 |
| Runs-list order context | — | `runs_order.js` | `QymRunsOrder.normalizeContext/query/collation/runHref/PARAM` | 200 |

`dashboard.js` (the Runs list page) contains **no run-detail code**; its only
run-page touchpoint is the prefetch it triggers through `shell.js:1854`
(`prefetchPageData` fetches `api/runs/{id}?view=compact` at click time and the run
page takes it with `takePrefetch`, run.html:7617).

## 2. User journeys (as-is)

Keyboard shortcuts that apply page-wide: `J` / `K` open the next / previous run in
list order (run.html:9375-9396; suppressed while typing, with modifiers, or when a
dialog is open). Inside the trace drawer: `j`/`k`/`↑`/`↓` move the selection,
`Enter`/`→` expand, `←` collapse, `/` focuses span search, `Esc` closes the expand
modal, then clears search, then closes the drawer (trace_viewer.js:2631-2662).
Single-letter shortcuts honour `localStorage["qym:single-key-shortcuts"] === "off"`.

### J1. Open a run and read its summary
1. Entry: click a row in the Runs list (`/projects/{slug}` → `/projects/{slug}/runs/{id}?list=…`), or a direct link.
2. While loading: a skeleton with the page's shape (`#loading`, run.html:6286-6305).
3. Loaded: hero card (`renderSummary`, 9049-9241): eyebrow "Run Detail", run name, pass pill (`?pass=N`), `xN PASSES` pill, status badge (`RUNNING`/`PENDING`/`COMPLETED`/`FAILED`/`STOPPED`/`SUBMITTED`/`APPROVED`/`REJECTED`; `STOPPING…` when `stop_requested`), actions (Export HTML; Download with Changes in export mode), prev/next pager, optional "Incomplete data" and "Private test set" banners, meta grid (Task, Dataset with identicon + version + alias tags, Model with reasoning badge, Owner, Project, Started, Runtime, Version `branch • commit`, Stop reason), then the Execution context grid (config + metadata key/values; JSON values open the JSON viewer).
4. Entity links in the meta grid go to the Runs list filtered by task/model/owner/dataset (`runEntityLinks`, 9000-9029).
5. Error states: 404 → "Run not found" (no Retry); 403 → "No access to this run"; 401 → "Signed out"; 5xx/network → "Server error"/"Network error" **with Retry** (`showLoadError`, 7671-7711). API answers a hidden run with HTTP 200 `{error: "..."}` (api/runs.py:5676-5679) — the page sniffs the string for "not found"/"denied".
6. URL state (all via `history.replaceState`, `syncRunViewUrl` 13572): `q`, `sort`, `view=heatmap`, `metric`, `threshold` (0-100), `show` (one of `passed|failed|metric_errors|errors|edited_metrics|retries|trace_errors`), `filters` (JSON, see §4 note), `page`, repeated `hide_field`, repeated `hide_metric_field`, `item`, `pass`, `trace`, `list`.
7. Persisted state: `localStorage["qym:single-key-shortcuts"]` (read only), `localStorage["qym-text-mode"]`-style key via `QymSafe.bindTextModeToggle` (raw vs rendered markdown), export mode only: `localStorage["qym_export_" + run.file_path]` holds edited run+snapshot JSON.

### J2. Follow a running run (live)
1. Entry: open a run whose status is `RUNNING` or `PENDING`.
2. Page shows "Live · updated Ns ago" beside the status (`updateLiveIndicator`, 7801) and the Runtime counts up every second (`tickLiveClock`, 7821, uses server clock offset).
3. Every 3 s (hidden tab: paused; errors: exponential backoff to 30 s) the page probes `GET /api/runs/{id}/live-status`; when `revision` changed and the size-based throttle allows (3 s / 10 s / 30 s for <500 / <5000 / more rows×passes, and never sooner than 10× the last reload duration, max 120 s), it refetches `?view=compact` (+`/passes` when `?pass=N`) and patches in place: unchanged rows keep their object identity (FNV-1a row signatures, 7719), so open cards, loaded bodies and the overview memo survive; the page, filters, scroll and focus stay.
4. If `stop_requested` flips, the status becomes "STOPPING…" immediately and probing speeds up to 1.5 s.
5. When `live` turns false: one final reload, step-latency reloads quietly, review history reloads, the indicator is removed.
6. A stop issued elsewhere (`document` event `qym:run-status` from `QymShell.announceRunStatus`) triggers an immediate probe.

### J3. Scan the Overview and filter from the charts
1. Section "Overview" (`renderOverview`, 10726): stat strip (Items / Completed / Errors / Not received) and one card per metric: gauge ring + mean + histogram (score metrics, 11 buckets), True/False or Pass/Fail split bar (boolean), Min/Avg/Max/Total (numeric). Error notes explain how scorer/task errors were counted (as 0, or left out for lower-is-better).
2. Click a histogram bar → `scoreDistFilter={min,max}` and the metric becomes the selected metric. Click a boolean segment → `itemFilter=passed|failed|metric_errors`, page scrolls to the Items section and a banner says "Filtered to N items that fail X" with a "How the reason is chosen" popover (`renderItemFilterBanner`, 8623). Empty bars are not clickable.
3. "Deep analysis" (`buildDeepAnalysisCharts`, 10634; `buildRunIntelligenceCharts`, 10375): item × metric matrix, Pearson correlation matrix, strongest-relationship scatter with X/Y selects, quality–latency frontier, observed performance by pass, quality–stability map (repeat runs).
4. Success state: charts re-render for the filtered item set (`renderOverview(items)`), keeping the section the reader is in still (`keepSectionInPlace`, 13362; `run_section_nav.js` MutationObserver pin).

### J4. Repeat-run analysis (samples > 1)
1. Section "Repeat Run Analysis" (`renderSamplesAnalysis`, 9428) appears only when `run.samples > 1`, not in export, not in a `?pass=N` view.
2. Fetches `GET /api/runs/{id}/group-metrics?metric=&threshold=` and `GET /api/runs/{id}/passes` in parallel (abortable; stale responses dropped).
3. Metric tabs (segmented), threshold slider, statistic tabs (Pass@k / Pass^k comparison, mean, consistency…), a pass@k curve (SVG) with 95% CI band or a table, a per-pass sweep table (status, queued passes), and a distribution of "how many passes passed" whose bars set `repeatDistFilter={metric,bucket,samples,threshold}`.
4. Pass rows link to `?pass=N`. The "Latency and traces" aside has a pass dropdown that navigates with `window.location.assign` (full reload).
5. Item cards in the all-passes view show every pass's output side by side (`renderAnswerColumns`, 13816) with pass toggles, per-pass verdict tags, per-pass trace buttons, per-pass metric chips with inline score editing, and a per-metric comparison panel. Display → Layout "Heatmap" switches the item list to a virtualized item × pass heatmap (`renderItemsHeatmap`, 13725; 40 px rows, 14 drawn at a time).

### J5. Latency and traces
1. Section appears when any row has latency or `run.trace_stats.has_spans` (10982-10992). `QymLatencyTraces.mount` fetches `GET /api/runs/step-latency?run_ids={id}&rollup=site[&pass_number=N]` once per page load.
2. "Response time": p50/p90/p95 pins, a histogram with a drag brush that sets `latencyDistFilter={min,max}` (chip shows the range; clear button), and a quality-vs-latency scatter (metric dropdown; pass threshold line; clicking a dot opens that item in the list, `openItemFromChart`, 8969).
3. "Inside the traces": time budget bar (task vs eval phase, per sub-agent, per step family LLM/RETRIEVAL/TOOL/GUARD/OTHER), kinds breakdown, steps interval plot (p5–p95 whisker, p25–p75 box, median tick) with By step / By kind and Linear / Log toggles, search, CSV links (`?format=csv`, `&level=spans`) and an SVG download.
4. Empty: section hidden via `onVisibility(false)`. Error: "Trace timings did not load" + Retry.

### J6. Open an item, inspect it, open its trace
1. Items section (`renderItems`, 14138): toolbar (search box, N of M count, Display popover, CSV button), paginated cards (20 per page, `QymUIComponents.renderPagination`). Collapsed row = chevron | `#index` | status tag (Pass / Fail / error icon / Not received) | input title (one line, `dir` auto/rtl) | failure reason (for the displayed metric, from `item_reasons.js`) | metric pills (as many as fit, then "+N more", `fitItemRows` 8669).
2. Click / Enter / Space on a row → `toggleItemCard` (14560): the card is redrawn alone; the lazy loader fetches its bodies (`POST /api/runs/{id}/items/details`) and shows "Loading item details…" then the body; the URL gets `?item=ID`.
3. Expanded body: INPUT (Copy link, copy), EXPECTED OUTPUT (collapsed with Show more), metadata badges (complexity, domain) + generic `key: value` tags, analysis warnings, OUTPUT block with status tag, duration, task start time, Trace button, copy; trace chips (tokens, cost, LLM calls, retries); metric strip (one chip per metric: value, caret to open judge metadata rendered by `formatObjectAsHtml`, edit pencil, "edited" badge); per-metric root cause analysis cards.
4. "Trace" opens the drawer (`QymTraceViewer.open`, trace_viewer.js:2477): fetches `GET /api/runs/{run}/items/{item}/trace[?pass_number=N]`, caches per endpoint, sets `?trace=ID`. Left pane: span tree with waterfall bars, kind icons, model/tokens inline, error badges, search filter, expand/collapse all, resizable divider. Right pane: per-span tabs (Messages, Response, Input/Output, Documents, Metrics, Scores, Raw) with copy/expand actions and a modal for expanded content. Retried items show every attempt merged into one tree with `try N` chips.
5. Failure: "Item details could not be loaded. Retry" inside the card; toast. Trace: "Failed to load" + message in the list pane.
6. Deep link: `?item=ID` opens that item on the right page and scrolls it under the sticky nav with a 2.6 s highlight ring (`scrollToTargetItem`, 13406; skipped when the shell is restoring scroll on Back).

### J7. Filter, search, sort and export the items
1. Sticky nav holds "Filters (N)" and "Clear (N)". Filters opens a rule builder dropdown (`renderFilterBuilder`, 13018): nested AND/OR groups of conditions over fields from `itemFilterFieldDefs` (12671): each metric (is passed/failed, >, <, =, between…; percent inputs for score metrics), Root cause, Approval, Output text, every item-metadata key (enum ≤40 values, number, or text), Has error, Edited metrics, Retries, Trace errors, Latency. Typed values filter after a 150 ms debounce; the builder is not redrawn while typing. "Set on the page" chips list filters that came from chart/card clicks and remove them individually.
2. Search box: 250 ms debounce; with a lazy snapshot it calls `POST /api/runs/{id}/items/search` (contains, over all text fields; one request answers up to 32 conditions) and otherwise searches the loaded strings client-side. Queries longer than 10,000 chars force a full-row load (`runNeedsFullText`, 8262).
3. Display popover: Layout (Cards / Heatmap, repeat runs only), Text (Raw / Rendered markdown), Sort (index, score ↑↓, latency ↑↓), Analysis metric select + Pass-if-score-≥ slider (score metrics with a declared direction), Columns: item fields and metric fields multi-selects (hidden fields become `hide_field` / `hide_metric_field` URL params).
4. Every filter also scopes the Overview, Categories, Errors and Root cause sections (same `getFilteredItems()`, 13107).
5. CSV: `#export-filtered-btn` → ensures search ran, loads **every filtered row's body** (`ensureRows(..., {retainAll:true})`), discovers columns (core, input/expected/output JSON sub-keys, item metadata, per-metric score + root-cause issues JSON + metadata keys, latency/trace id/trace url), opens a column-picker modal (groups collapsible, select/deselect all) and downloads `<run_name>_export.csv` with a BOM (`performExport`, 17110). Export HTML: opens `GET /api/runs/{id}/export-html` in a new tab.

### J8. Review items: edit scores, diagnose root causes, approve
1. Score edit (`wireMetricEditHandlers`, 14788): pencil on a metric chip (or per-pass chip) → inline input with Save / Cancel / status; `POST /api/runs/update_metric` with `{file_path, row_index, metric_name, new_score[, pass_number, expected_pass_version]}`; `reset: true` resets to the original. Errors stay beside the input (403 when scores are locked, 409 on pass-version conflict, 400 on a non-numeric score). Locked states: body class `run-scores-locked` (SUBMITTED/APPROVED, notice text in `SCORE_LOCK_COPY`, 17152) and `run-read-only` (archived project, 17181) hide the editors via CSS.
2. Per-metric root cause card (`renderMetricAnalysisCard`, 11354): shown for failing/errored metrics or when a saved analysis exists; lists issues (category with color, subcategory, finding, "Why this category", solution + notes, confidence, review status pill). Actions: "+ Add issue", "Edit" (opens the `<dialog>` `showMetricIssueDialog`, 15509: category search list from the project catalog with guidance, issue fields, solution preset select or new solution, Save / Save and add another / Delete issue), "✓ Approve" (`saveMetricIssueAction` with `action: approve` → `POST /api/runs/update_root_cause_issue`).
3. Legacy item-level diagnosis (rows without `metric_analyses`): category picker dialog (`showRootCauseCategoryPicker`, 15696; multi-select, saves on each click, can add a new project category with description + "use when" → `PUT /api/projects/{slug}/analysis-category-catalog`), detail dropdown (`showRcDetailDropdown`, 15897), solution dropdown (`showSolutionDropdown`, 16120; presets + custom), feedback textarea (Enter saves, Esc cancels; `saveFeedback`, 15078). All write `POST /api/runs/update_root_cause` and apply the returned `row`.
4. Legacy correction approval (`.rc-approve-btn`, 14932): `POST /api/corrections/{id}/approve` or `POST /api/corrections/approve-metric-analysis`.
5. Section "Root cause analysis" (`renderRootCauseSection`, 12441): category cards with subcause counts (click → root-cause filter; hover highlights a Sankey of categories → solutions, `renderSankeyDiagram` 11632), a metric select, "Aggregate results" button (`POST /api/runs/{id}/aggregate-analysis`, 11582) with status line, and "Auto-Analyze" which navigates to the analyzer page (`openAnalyzerPage`, 6557 → `/projects/{slug}/runs/{id}/analyzer`).
6. Review history (`review_history.js`): a timeline under the hero of submit/approve/reject/unapprove/unreject events with actor, "on behalf of", time, comment and a "reconstructed" note; hidden when the run was never submitted. Note: the run page has **no** Submit/Approve buttons for the run itself — those live on the Runs list and Reviews page.

### J9. Step between runs
1. Hero pager (`runPagerHtml`, 9250): "N of M" position and two arrow links; `POST /api/dashboard/neighbors` with the list's filters/sort from `?list=` (two-step when a text sort needs browser collation). Hover/focus shows a peek card (name, model, start, primary metric). `J`/`K` click the links. Disabled at the ends; tooltip explains when the run is not in its list.

### J10. Exported HTML file (offline)
1. Open the downloaded file: banners "The original file is not modified…" and "Exported view — edits are saved in your browser". Score edits, feedback, root causes and solutions mutate `state` and save to `localStorage`; "Download with Changes" re-serializes `document.documentElement.outerHTML` with the new `__QYM_EXPORT_DATA__`. No live refresh, no trace drawer, no lazy loading, no review history, no pager, no CSV column loading from the server.

## 3. Functional inventory

Legend: **MUST-KEEP** / **NICE** / **DROP-CANDIDATE**, one line of justification each.

### 3a. Header / summary (hero)
| Feature | Where | Verdict |
|---|---|---|
| Skeleton loader shaped like the page, "Loading run data…" | run.html:6286-6305, `retireSkeleton` 8790 | NICE — foundation skeleton primitive can cover it. |
| Error states with classified titles and Retry only for retryable kinds | 7671-7711 | MUST-KEEP — users hit 403/404 from shared links. |
| Status badge incl. STOPPING… (stop requested) and "• pass k/N" while a repeat run runs | 9054-9060, 9208-9211 | MUST-KEEP. |
| Live indicator "Live · updated Ns ago" + ticking Runtime | 7801-7838 | MUST-KEEP — only visible signal that the page follows the run. |
| Meta grid with entity links (task, dataset, model, owner, project) | 9000-9029, 9161-9172 | MUST-KEEP — cross-navigation to the Runs list facets. |
| Dataset identicon, version inline, alias tags | 9163 via `QymShell` | NICE — comes free from the shared primitive. |
| Ingest-incomplete banner (missing items, rejected events list, "and N more") | 9087-9142 | MUST-KEEP — data-integrity warning. |
| Private test set banner (`run.items_restricted`) | 9143-9155 | MUST-KEEP. |
| `xN PASSES` pill, `Pass N/M` pill linking back to all passes, single-pass repeat `Pass 1` link | 9157-9160, 9179-9184 | MUST-KEEP (repeat semantics). |
| Export HTML / Download with Changes buttons | 9073-9085, `wireTopActions` 10109 | MUST-KEEP (export HTML); the offline export page itself is a DROP-CANDIDATE for v1 (see §9). |
| Execution context grid (config/metadata key-values with JSON preview opening the JSON viewer; hidden-key lists) | `buildExecutionContextSectionHtml` 10132-10191 | MUST-KEEP. |
| Prev / next pager with position, peek card, J/K | 9243-9420 | NICE — keep the links and position; the peek tooltip is optional. |
| Document title "قيِّم • {run_name} • Pass N" | 8223 | MUST-KEEP (tab identification). |
| Review history timeline | review_history.js | MUST-KEEP. |
| Experiment panel (official runs: environment, base source, sweep combo, remote job status, schema hash, result, Rerun / Promote links) | run_experiment_panel.js | MUST-KEEP — official-run provenance. Render only when `run.experiment` is non-null. |
| Versioning details panel (sorted key/value `<dl>`, objects as compact JSON) | run_versioning_details.js | MUST-KEEP (trivial). |
| Score-locked / read-only notices | 17147-17193 | MUST-KEEP. |

### 3b. Sticky section nav and filters bar
| Feature | Where | Verdict |
|---|---|---|
| Sticky bar with run name + status once stuck, section links (Overview, Latency and traces, Deep analysis, Categories, Errors [count], Items [count]), ink underline, scroll-spy (`aria-current="location"`), back-to-top | run_section_nav.js | MUST-KEEP — the page is 6+ screens tall. Links to hidden sections are hidden. |
| "Keep the section being read still while sections above re-render" (MutationObserver pin, `hold(node)`, `yieldToScroll`) | run_section_nav.js:90-175, run.html `keepSectionInPlace` 13362, `restoreItemsGridTop` 13311, `reserveScrollRoom` 13335 | DROP-CANDIDATE as a mechanism — React should avoid the layout jumps that made it necessary (stable section heights, memoized sections, `scroll-margin-top`). Keep the *behavior* (no scroll jumps on filter) as an acceptance criterion. |
| Filters button with count badge, Clear button with count, filter-builder dropdown under the bar, Escape/outside-click closes | 16700-16800 | MUST-KEEP. |
| Section nav counts (Errors in danger tone, Items as "n / total") | `setSectionNavCount` 8414 | NICE. |

### 3c. Overview (metric cards)
| Feature | Where | Verdict |
|---|---|---|
| Stat strip Items / Completed / Errors / Not received | 10739-10768 | MUST-KEEP. |
| Score metric card: gauge ring (direction-aware color), mean, "N scored · M err" badge, 11-bucket histogram with error sub-bars, click-to-filter | 10920-10985 | MUST-KEEP. Hex colors `#10b981…#ef4444` in `gaugeColorHex` (10776) must become `--score-*` tokens. |
| Boolean card: Pass/Fail (or True/False without direction) split bar with error segment, legend, click-to-filter | 10846-10918 | MUST-KEEP. |
| Numeric card: Min/Avg/Max/Total | 10822-10844 | MUST-KEEP. |
| Error-accounting notes ("3 scorer errors · counted as 0", "not counted in the mean" for lower-is-better) | 10794-10821 | MUST-KEEP — explains why means differ from the Runs list. |
| Metric cards grid memoized by `overviewSignature` (filtered row identity + settings) | 14115-14136 | Mechanism DROP; `useMemo` on the filtered array covers it. |
| Deep analysis panels (matrix, correlation, strongest relationship, frontier, by-pass trend, stability map) with X/Y axis selects | 10375-10724 | NICE — keep correlation + frontier; matrix/stability can follow. All SVG hand-built; use the dataviz skill. |

### 3d. Repeat-run analysis (samples > 1)
| Feature | Where | Verdict |
|---|---|---|
| Metric tabs, threshold slider (debounced), statistic switch, pass@k curve with CI band / table toggle, per-pass sweep table (status, queued), distribution bars → `repeatDistFilter` | 9428-10107 | MUST-KEEP for repeat runs; the aborted-request discipline (seq counter + AbortController) maps to TanStack Query keys. |
| Per-pass delete (`DELETE /api/runs/{id}/passes/{n}`) | Not on this page (dashboard.js:5232) | n/a |

### 3e. Latency and traces
| Feature | Where | Verdict |
|---|---|---|
| Response-time pins (p50/p90/p95/mean), histogram with drag brush → latency filter, filter chip with clear | latency_traces.js:285-470 | MUST-KEEP. |
| Quality vs latency scatter, metric dropdown, threshold line, dot click opens item | 472-570 | NICE. |
| Inside the traces: time budget, kinds, steps interval plot (By step / By kind, Linear / Log, search), CSV summary / spans links, SVG download | 603-1080 | MUST-KEEP (budget + steps); SVG download is DROP-CANDIDATE. |
| Pass dropdown in the section aside (navigates `?pass=N`) | 661-695 | NICE — becomes a Link. |
| Mounted once and moved between DOM slots (`latency-traces-home`) | run.html:8878, 10998-11005 | Mechanism DROP — React keeps the subtree keyed. |
| Quiet reload when a live run ends | `reload({quiet:true})` | MUST-KEEP — invalidate the query. |

### 3f. Categories ("Performance by category")
| Feature | Where | Verdict |
|---|---|---|
| Chip bar of metadata keys (auto-selects first 3 keys with ≤30 distinct values, `processRun` 8166-8183), Cards / Compare views, per-group average with baseline track, item count, latency, click-to-filter (domain has include/exclude/"only" modes) | 11996-12201 | MUST-KEEP (cards). Compare view NICE. Domain "exclusive" tri-state (12157-12170) DROP-CANDIDATE — undiscoverable. |

### 3g. Errors section
| Feature | Where | Verdict |
|---|---|---|
| Task / Metric / Trace / Analysis error groups, cards grouped by message with counts and item counts, "Show more" for long messages, click/Enter toggles a per-kind error filter; long labels round-trip through the URL as prefix+hash | 12336-12440, 13477-13505 | MUST-KEEP. |

### 3h. Root cause analysis section
| Feature | Where | Verdict |
|---|---|---|
| Category cards + subcause lists, color per preset category (`ROOT_CAUSE_COLORS`, 6581) | 12441-12606 | MUST-KEEP; colors must move to tokens. |
| Sankey categories → solutions with hover highlight | 11632-11880 | NICE. |
| Metric select (`rootCauseMetric`), Aggregate results button + status, Auto-Analyze link | 11492-11631 | MUST-KEEP (links/buttons), Aggregate status polling is simple. |

### 3i. Items table
| Feature | Where | Verdict |
|---|---|---|
| Toolbar: search (250 ms debounce, server search for lazy snapshots), count "n of m items", Display popover, CSV | 6395-6460, 16846-16856 | MUST-KEEP. |
| Pagination, 20 per page, page in URL | 14467-14480 | MUST-KEEP — see §8 on virtualization. |
| Collapsed row columns and "metrics that fit + N more" (`fitItemRows`, 8669-8790, ResizeObserver) | | MUST-KEEP visually; implement with CSS grid + container queries, not JS measurement. |
| Failure reason cell + source, server fetch of reason fields for rows whose index form lacks them (`POST items/reasons`) | 8440-8622, item_reasons.js | MUST-KEEP. |
| Filter banner after a Pass/Fail bar click with "How the reason is chosen" popover | 8623-8663 | NICE. |
| Live refresh keeps cards whose rows did not change, and never redraws while an input inside the list has focus | 14438-14450 | MUST-KEEP (as acceptance criterion). |
| Heatmap layout (virtualized item × pass) | 13725-13781 | MUST-KEEP for repeat runs. |
| Display → Columns: hide item fields / metric fields (`hide_field`, `hide_metric_field`) | 16615-16700 | NICE. |
| Text mode raw / rendered (`QymSafe.renderMarkdown`, code/SQL stay raw) | 6418-6424 | MUST-KEEP. |
| Items auto-analyze button in the section header (shown when no diagnoses exist) | 6364 | NICE. |

### 3j. Item detail (expanded card)
| Feature | Where | Verdict |
|---|---|---|
| Lazy body load per opened card with per-card loading/error/retry | 8311-8380 | MUST-KEEP. |
| Input / expected (Show more) / output blocks, copy buttons, "Copy link" to `?item=ID` | 14400-14420 | MUST-KEEP. |
| Metadata badges (complexity colored by level, domain) and generic tags; structured values never render `[object Object]` | 14320-14350 | MUST-KEEP. |
| Trace chips (tokens, cost, LLM calls, retries) from `row.trace_stats` | `_renderTraceChips` 7324 | NICE. |
| Metric strip: value chip, judge metadata disclosure (`formatObjectAsHtml` tables, python-dict parsing `parsePythonDict` 7361), inline score edit, edited badge with tooltip (who/when/original) | 14023-14113, 7071-7103 | MUST-KEEP. `parsePythonDict` is a DROP-CANDIDATE (legacy artifacts only). |
| Repeat items: answer columns per pass with toggles, verdicts, per-pass trace/copy, per-pass metric chips + edit, per-metric compare panel, "N unique outputs" summary | 13816-13983 | MUST-KEEP. |
| Per-metric root cause cards (issues, approve, edit, add) | 11354-11418 | MUST-KEEP. |
| Legacy item-level root cause / detail / solution / feedback widgets (`data-rc-item`, `data-rcdetail-item`, `data-sol-item`, `data-feedback-item`) | 14888-14980, 15696-16248 | DROP-CANDIDATE — superseded by per-metric analyses; keep read-only display of legacy values. Confirm in §9. |
| Issue dialog (`<dialog>`, category guide search, solution presets, save-and-add-another, delete staging, pass-version guard) | 15509-15690 | MUST-KEEP. |
| Category catalog load/add (`GET/PUT /api/projects/{slug}/analysis-category-catalog`) | 6723-6850 | MUST-KEEP (needed by the dialog). |
| Output group toggles (`itemHiddenOutputs`, `itemComparedMetric`) kept in state across re-renders | 14648-14706 | NICE. |
| Expected-output collapse with inline `onclick` | 14407 | MUST-KEEP (as a component). |

### 3k. Traces (drawer)
| Feature | Where | Verdict |
|---|---|---|
| Drawer with backdrop, focus trap (`QymUIComponents.openDialog`), `inert` when closed, `?trace=ID` sync, close returns focus to the trigger even after re-render | trace_viewer.js:2273-2475 | MUST-KEEP. |
| Span tree: `buildTree` (sort by start time, depth), noise collapse (`_collapseNoise`: pass-through CHAIN spans, provider duplicate LLM spans, sibling dedupe), retry merge (`buildRetriedTree`, `detectRetries`), error-path default selection (`failingSpan`) | 322-600, 1150-1186 | MUST-KEEP tree + retry merge; the dedupe heuristics (`_llmLooksDuplicate`, 463) are NICE and should be ported as pure functions with unit tests. |
| Row: kind icon + color, name, `try N`, model + reasoning badge, token count, duration, waterfall bar (left/width % of trace bounds), error badge, expand toggle | 1353-1458 | MUST-KEEP. |
| Header chips: spans, attempts · failed, duration, tokens, cost, errors, score pills from root span events, copy trace id, orphan warning | 1260-1304 | MUST-KEEP. |
| Detail tabs by kind: Messages (chat bubbles, tool-call cards, reasoning blocks), Response, Input/Output, Tool I/O, Documents (retriever docs with score chips), Metrics, Scores, Raw (CodeMirror JSON, lazily loaded) | 1461-2270 | MUST-KEEP Messages / I-O / Raw; Documents / Metrics NICE. |
| Search/filter spans, expand/collapse all, keyboard nav, resizable divider, expand-to-modal for long content, nested scroll activation hacks | 1245-1259, 1936-2048 | MUST-KEEP search + keyboard; divider NICE; scroll hacks DROP. |
| Langfuse link: `buildLangfuseTraceUrl(traceId)` (run.html:7282) = `${langfuseHost}/project/${langfuseProjectId}/traces/${traceId}` using `run.langfuse_host` / `run.langfuse_project_id` (server derives them from `run_metadata.langfuse_url` via `_extract_langfuse_ids`, api/runs.py:1237). The URL is stored on the trace button as `data-trace-url` and used in CSV export, but **no external link is rendered** on the page today (state comment at 6926: "external Langfuse actions are not rendered"). `LANGFUSE_HOST` / `LANGFUSE_PROJECT_ID` env vars are read only by the compare view (AGENTS.md). | | NICE — render an "Open in Langfuse" link when `trace_url` or host+project are present. |

### 3l. Reviews / annotation
| Feature | Where | Verdict |
|---|---|---|
| Score edit/reset with pass-version optimistic lock (`expected_pass_version` = `run.metadata.pass_revision`, `currentPassVersion` 11425) | 14708-14886 | MUST-KEEP. |
| `applyUpdatedRow` merges the server row and re-scopes to the viewed pass | 14769 | MUST-KEEP (as query-cache update). |
| Issue approve / add / edit / delete with `expected_issue` conflict check | 15369-15451 | MUST-KEEP. |
| Review history timeline | review_history.js | MUST-KEEP. |
| Toasts for every save failure (`showToast`, 7546) | | MUST-KEEP via foundation toast. |

### 3m. Versioning details
| Feature | Where | Verdict |
|---|---|---|
| `run.versioning_details` key/value list; the Runs-list `versioning` (Evaluation Service `versioning_metadata`) is **not** shown here, only `git_branch • git_commit` in the hero | run_versioning_details.js | MUST-KEEP. |

### 3n. Failed items
| Feature | Where | Verdict |
|---|---|---|
| Task-error rows: red left border (`item-execution-error`), failure icon tag, output text `ERROR: …` (server stringifies, api/runs.py:4207), `show=errors` filter, Errors section cards | throughout | MUST-KEEP. |
| Metric-error indicator on pills (`renderMetricErrorIndicator`, 6851; ⚠ with `--metric-error`) | | MUST-KEEP. |
| Not-received rows (`output_received: false`) shown with a warning tag and excluded from means | 14265-14300 | MUST-KEEP. |
| Repeat items: failed-pass count in the status title, per-pass error verdicts | 14255-14262 | MUST-KEEP. |

### 3o. Export
| Feature | Where | Verdict |
|---|---|---|
| CSV with column picker (loads all filtered bodies first) | 16870-17145 | MUST-KEEP; consider a server-side CSV endpoint instead (§8). |
| Export HTML (server renders the page with inlined assets) | api/runs.py:4460-4650 | MUST-KEEP the button; the exported artifact must keep working with the **old** page until the migration replaces it — see §8 backend. |
| Offline annotation mode + Download with Changes | 17195-17255 | DROP-CANDIDATE for the React page (see §9). |

## 4. Data & API contract

Auth: all `api/*` routes use the session cookie (`require_ui_principal`); `fetch`
with default credentials. No custom headers. JSON bodies with `Content-Type:
application/json`. Error envelope: FastAPI `{detail: string}` with 4xx/5xx, **except**
`GET /api/runs/{id}`, `/passes`, `/group-metrics` which answer 200 `{error: string}`
for not-found / denied (api/runs.py:5676-5679, 4820-4823, 5219-5222). Mutations
answer `{ok: true, row: <ui row>}`; the page merges `row` into the snapshot.

| Method | Path | Query / body | Response shape | Used by |
|---|---|---|---|---|
| GET | `/api/runs/{run_id}?view=compact[&pass_number=N]` (api/runs.py:5668) | `view` ∈ `full\|compact\|summary`; `pass_number` only with compact (the page does **not** pass it; it scopes rows client-side with `scopeRowToPass`, run.html:7981) | `{run: Run, snapshot: Snapshot}`. **Run** (4390-4437): `run_id, file_path (=run_id), task_name, dataset_name, dataset_version, dataset_aliases[], dataset_slug, model_name, run_name, metric_names[], metric_specs{name→{score_type, direction, pass_threshold, primary…}}, config{}, metadata{} (public keys only; includes ingest_incomplete{expected_items, received_items, rejected_events, rejected[]}, analysis_aggregation, pass_revision, last_completed_pass), status, status_reason_label, stop_requested, owner{id,email,display_name}, project{id,slug,name,archived}, started_at, ended_at, created_at (ISO), duration_ms, git_branch, git_commit, langfuse_host, langfuse_project_id, trace_stats{has_spans, has_reasoning, avg_tokens…}, samples, last_completed_pass, experiment (null or {id,name,job_id,panel{…}}), versioning_details{}, live_revision (live runs only), items_restricted (private test set)`. **Snapshot** (4439-4457): `rows[], stats, metric_names[], metric_specs, detail_mode: "lazy", detail_page_size: 100, metric_meta_keys{metric→[key]}, pass_metric_meta_keys{…}, pass_metric_meta_keys_by_pass{"1"→[key]}`. **Row** (4215-4330; compact form per `services/run_payloads.py:95`): `index, item_id, compare_item_id, compare_alignment_source, status (completed\|error\|running\|pending), error, execution_error_count, [input,input_full,expected,expected_full,output,output_full — stripped in compact; replaced by input_preview (300 chars), output_digest, __has_output, __execution_error, __details_loaded:false], output_received?:false, time, latency_ms, retry_count, trace_id, trace_url, task_started_at_ms, metric_values[] (parallel to metric_names), metric_meta{metric→{…}} (compact: strings ≤200 chars, no explanation), item_metadata{} (complexity, domain, root_cause*, solution*, metric_analyses{metric→{root_cause_issues[], source, confidence, review_status, error, warning…}}, analysis_error/warning, trace_stats, task_started_at_ms…), review_correction_id, review_correction_status, review_corrections{metric→{id,status}}, review_issue_statuses{metric→[{issue_id,status}]}, trace_stats, pass_scores{metric→[per pass]}, pass_metric_meta{metric→[per pass]}, pass_metric_analyses, pass_review_issue_statuses, pass_attempts[{pass_number, attempt_number, status, latency_ms, trace_id, trace_url, task_started_at_ms, error, output (compact: output_digest/__has_output/__execution_error)}]` | `loadRunData`, `refreshRunData`, shell prefetch |
| GET | `/api/runs/{run_id}/live-status` (5741) | — | `{run_id, status, status_reason, live: bool, stop_requested, started_at, ended_at, last_event_at, revision: "status\|last_event\|updated\|max_seq", server_time}` | live poller |
| GET | `/api/runs/{run_id}/passes` (4813) | — | `{run_id, samples, passes: [{pass_number, status, items_total, items_started, completed_count, error_count, running_count, started_at, ended_at, duration_ms, trace_stats, metrics{…}}], …}` (also `{error}` 200) | pass view summary, repeat analysis |
| GET | `/api/runs/{run_id}/group-metrics?metric=&threshold=` (5203) | | `{run_id, metric, direction, threshold, samples, report_k, group{total_items, pass_at_k, pass_hat_k, consistency, …}, band{k→{pass_at_k, pass_hat_k, mean…, uncertainty{key→{low,high}}}}, distribution[], uncertainty{…}}` or `{error:"Run has no metrics"}` | repeat analysis |
| POST | `/api/runs/{run_id}/items/details` (5381) | `{item_ids: string[]}` (≤100, `MAX_DETAIL_ITEMS`) | `{rows: [full Row with __details_loaded:true], missing_item_ids[]}`; private test set → bodies redacted | `run_details.js` ensureRows (batches of 100, ≤3 in flight) |
| POST | `/api/runs/{run_id}/items/search` (5520) | `{conditions: [{id, field: "all"\|"output", operator: "contains", value}], pass_number?: N}` or `pass_numbers: [N…]` (≤32 conditions) | `{matches: {id→[item_id]}}` or `{matches_by_pass: {"N"→{id→[item_id]}}}` | search / Output-text filter |
| POST | `/api/runs/{run_id}/items/reasons` (5410) | `{item_ids[], metric, pass_number?}` | `{metric, pass_number, reasons: {item_id→{reason?, error?, status?, explanation?, label?}}}` (each ≤2000 chars) | failure-reason cells |
| GET | `/api/runs/{run_id}/items/{item_id}/trace?pass_number=N` (7557) | | `{item: {run_id, item_id, trace_id, trace_url, retry_count}, summary: {span_count, root_count, error_count, duration_ms, started_at_ns, ended_at_ns, has_orphans, orphan_count}, spans: Span[], attempts: [{pass_number, attempt_number, status, latency_ms, task_started_at_ms, trace_id, trace_url, error, is_last_attempt, summary, spans}]}`. **Span** (1721): `{trace_id, span_id, parent_span_id, name, kind, start_time_ns, end_time_ns, duration_ms, status, attributes{} (OpenInference keys: openinference.span.kind, llm.model_name, llm.token_count.*, llm.input_messages.N.message.role/content, input.value, output.value, …), events[] ({name:"exception", attributes}), links[]}` | trace drawer |
| GET | `/api/runs/step-latency?run_ids={id}&rollup=site[&pass_number=N][&format=csv][&level=spans]` (api/step_latency.py:729) | | `{run_ids, rollup, pass_number, passes[], trace_count, groups: [{phase: task\|eval, kind, name, model, agent, n, error_count, mean_ms, median_ms, p5_ms, p25_ms, p75_ms, p95_ms, min_ms, max_ms}], phases[], traces{…}, agents[]}` | latency_traces.js |
| GET | `/api/runs/{run_id}/review-history` (7452) | | `{run_id, status, events: [{action: submit\|approve\|reject\|unapprove\|unreject, from_status, to_status, actor{id,email,display_name}\|null, on_behalf_of\|null, comment, at, recorded: bool}]}` | review_history.js |
| GET | `/api/runs/{run_id}/export-html` (4460) | | `text/html` self-contained page | Export HTML button |
| POST | `/api/dashboard/neighbors` (api/dashboard_stats.py:658) | `{project_slug, run_id, filters{}, sort, collation?[]}` | `{run_id, context: "list"\|"default"\|null, position, total, previous: {run_id, run_name, model, started_at, primary{metric, value, spec}}\|null, next: …}` or `{collation_needed: true, sort, sort_values[]}` | run pager |
| POST | `/api/runs/update_metric` (5961) | `{file_path, row_index, metric_name, new_score}` or `{…, reset: true}`; repeat: `pass_number, expected_pass_version` | `{ok, row}`; 403 locked (SUBMITTED/APPROVED), 409 pass version / archived project | score edit |
| POST | `/api/runs/update_root_cause` (6653) | `{run_id, item_id, metric_name?, pass_number?, expected_pass_version?, + any of root_cause, root_causes[], root_cause_issues[], category_taxonomy, root_cause_detail, root_cause_note, solution, solution_note}` (only present keys are written) | `{ok, row}` | feedback, legacy diagnosis, metric analysis patch |
| POST | `/api/runs/update_root_cause_issue` (6567) | `{run_id, item_id, metric_name, action: add\|edit\|delete\|approve, issue{category, subcategory, finding, category_reason, solution, solution_note}, issue_id?, issue_index?, expected_issue?, client_issue_id?, pass_number?, expected_pass_version?}` | `{ok, row}`; 409 on `expected_issue` mismatch | issue dialog / approve |
| POST | `/api/runs/{run_id}/aggregate-analysis` (api/analysis.py:4622) | `{metric?}` | job status | Aggregate results |
| GET / PUT | `/api/projects/{slug}/analysis-category-catalog` (api/analysis.py:7842/7913) | PUT `{categories[], category_taxonomy{cat→{description, when_to_use}}, version…}` | `{categories[], category_entries[], category_details_map, approved_category_details, category_taxonomy, subcategory_taxonomy, max_root_cause_categories, version, can_manage}` | category picker / issue dialog |
| POST | `/api/corrections/{id}/approve`, `/api/corrections/approve-metric-analysis` (api/analysis.py:9834/9911) | `{comment}` / `{run_id, item_id, metric_name, comment, pass_number?, expected_pass_version?}` | `{id, status, …}` | legacy approve button |
| GET | `/v1/me` | | current user | header avatar (`loadHeaderUser`, 6992) — foundation shell owns this |

Client-side reshaping worth knowing:
- `processRun` (8045-8226) derives `metricTypes` (boolean/score/numeric via `QymMetrics.metricTypeFromSpec` or inference from values), `metricDirections`, default thresholds, `allMetadataKeys`, auto-selected category chips, `allMetricMetaKeys` (from `metric_meta_keys` schema + rows), and for `?pass=N` rewrites every row through `scopeRowToPass` (7981) so downstream code sees one pass's `metric_values`, `output`, `latency_ms`, `status`, `trace_id`.
- `rowScoreFor` / `rowPassesFor` / `errorsLeftOutFor` (7131-7210) wrap `metrics.js` to apply the "lower-is-better leaves errors out of the mean" rule everywhere. Port `metrics.js` as a TS module first; the run page calls 50+ of its functions (counts at the end of §5).
- `filters` URL param is a JSON object: `{rules: FilterNode, approval, complexity[], domain[], domainMode, domainOnly[], rootCause[], rootCauseMetric, errors{task|metric|trace|analysis → {kind,label} | {kind,prefix,hash}}, score:[min,max], repeat:{metric,bucket,samples,threshold}, latency:[min,max|null], categories{key→[values]}}` validated by `_validFilterRule` (13580; depth ≤6, ≤50 children, lists ≤500).

## 5. Shared dependencies

| Module | Used here for |
|---|---|
| `qym_safe.js` (`QymSafe`) | `escapeHtml/escapeAttr`, `textDirAttrs` (rtl/auto on every user-text block), `renderMarkdown`/`textBlock` (raw vs rendered output), `bindTextModeToggle`, `isRTL`. |
| `metrics.js` (`QymMetrics`) | the entire metric semantics layer: `parseScoreValue`, `getRowScore`, `rowMetricErrorCounts`, `isErrorRow`/`isTaskErrorRow`/`isItemTaskError`/`isNotReceivedRow`/`hasTaskError`/`hasMetricError`/`isMetricErrorMeta`, `errorsLeftOut`, `repeatPassOutcomes`, `isTaskErrorPass`, `metricTypeFromSpec`/`detectMetricType`, `metricDirection`/`metricDirectionLabel`, `defaultMetricName`, `defaultPassThreshold`, `metricPasses`, `passThresholdLabel`, `formatMetricValue`/`formatMetricObservation`/`formatPercent`/`formatNumericValue`/`formatLatency`, `getMetricColorClass`, `isInternalMetaKey`, `metricMetaDisplayKey`, `getMetricTooltips`, `isItemEdit`, `bestMetricIndexes`. **Port to `frontend/src/lib/metrics.ts` with Vitest before anything else; the compare and runs-list areas need the same module.** |
| `shell.js` (`QymShell`) | `pageSignal()` (AbortSignal for listeners/fetches on in-app navigation), `takePrefetch`, `replaceUrlQuery`, `copyText`, `setPageProject`, `announceRunStatus` + `qym:run-status` event, `identiconHTML`, `datasetVersionInline`, `datasetAliasTags`, `isProjectArchived`, `openConfirmDialog`, `liftSkeleton`, `pendingArrival`. In React: router + a `ProjectContext` + a `useCopy` hook replace these. |
| `ui_components.js` (`QymUIComponents`) | `openDialog/releaseDialog` (focus trap contract used by the trace drawer, export modal, issue dialog), `renderPagination`, `alignMetricColumns` (aligns metric pill columns across cards), `classifyError`, `enhanceSelect`. |
| `json_viewer.js` (`QymJsonViewer.previewHtml`) | JSON previews in the execution-context grid. |
| `qym_live.js` | the polling loop (visibility-aware, backoff). → `useLiveRun` hook. |
| `runs_order.js` | `?list=` context parsing/serialization and text-sort collation for the pager (shared with the Runs list area, brief 03). |
| `dashboard.css` | all tokens (`:root`), `.qym-*` recipes (badge, tag, chip, segmented, control, select, inline-action, icon-action, stat-strip, pagination, dropdown, item-* toolbar classes), `.tv-*` trace viewer styles, `.model-label`. |
| `ui_components.css` | dialogs, pagination, selects. |

Defined here and imported elsewhere:
- `step_latency.js` is **only** used by `compare.html` now; `latency_traces.js` is run-page only.
- `run_details.js` is shared with `compare.html` (pass columns share detail/search requests, see its `sharedDetails` / `passSearches` maps).
- `trace_viewer.js`, `item_reasons.js`, `review_history.js`, `runs_order.js` are also loaded by `compare.html` / `dashboard.js` / `reviews.html` — put their TS ports under `frontend/src/features/shared/` or `frontend/src/lib/`.

## 6. Design-token usage

Tokens relied on (from `docs/DESIGN_LANGUAGE.md` §1): the full text ramp
(`--text-primary/secondary/muted/dim`), `--font-title/stat/xl/lg/md/base/sm/xs`,
`--font-sans/mono`, `--space-xs..xl`, `--bg-void/base/surface/elevated/hover/active`,
`--border-subtle/default/strong`, `--radius-md`, semantic `--success/--warning/--error/
--metric-error/--info`, `--score-1..5`, `--chart-1..5`, `--accent-primary/secondary/
tertiary/tertiary-soft`.

Recipes used: run section header (`.run-section-head`, `--font-xl`/650 title, muted
`--font-base` description, aside controls, hairline above, ~48 px spacing — this is
the **sanctioned exception** that lets run-page sections use `--font-xl` instead of
`--font-lg`, DESIGN_LANGUAGE.md:57 and 200-207); sticky section nav (frosted
`--bg-void`, shadow only while stuck, dropdowns hang under it, DESIGN_LANGUAGE.md:
195-199); `.qym-segmented` (24 px, sliding indicator, reduced-motion aware);
`.qym-badge` status pill; `.qym-tag` (+`--success/--danger/--warning/--count/--data/
--info/--accent`); `.qym-chip` (+`__count`, `__remove`); `.qym-control`, `.qym-select`,
`.qym-search`; `.qym-inline-action` (+`--accent/--neutral/--danger`); `.qym-icon-action`;
`.qym-stat-strip`; `.qym-pagination`; `.qym-dropdown`; `.qym-item-*` toolbar family.

Area-specific CSS that should become component styles (all inside run.html's
`<style>`): `.run-skeleton*`, `.run-summary-card`/`.hero-*` (incl. `.hero-pager*`
with a `position: fixed` peek), `.ingest-warning-*`, `.context-*`, `.run-section-nav*`,
`.metric-card*`, `.dist-chart*`, `.gauge-*`, `.metric-bool-*`, `.ri-panel*` (deep
analysis), `.samples-*`/`.sw-*` (repeat analysis), `.breakdown-*`/`.category-*`
(categories, errors, root cause), `.sankey-*`, `.items-comparison`/`.item-card*`/
`.item-header*`/`.rdi-*` (rows, reasons, banner), `.metric-det*`/`.det-toggle`
(metric strip), `.qym-output-*`/`.qym-metric-compare*` (pass columns),
`.metric-analysis-*`/`.metric-issue-dialog*`/`.rdi-category-picker*`/
`.root-cause-dropdown` (fixed-position popovers), `.export-modal*`, `.item-heatmap-*`,
`.run-read-only-notice`, `.run-live-indicator`. Trace viewer styles (`.tv-*`) live in
`dashboard.css` and `latency_traces.css` holds `.lt-*`.

Hardcoded colors to tokenize when porting (rule 8 allows hex only with alpha
concatenation): `gaugeColorHex` (run.html:10776-10782), `ROOT_CAUSE_COLORS`
(6581-6587) and the `#e07a5f` fallback, `SOLUTION_COLORS` (6834), trace viewer
`KIND_COLORS` (trace_viewer.js:47-50) and the `#ef4444` error guide (1399),
`step_latency.js` `PHASE_COLORS`/`RUN_COLORS` (179-187). `latency_traces.js` already
reads tokens via `getComputedStyle` for its SVG export — keep that approach for
SVG `fill`.

Responsive breakpoints in run.html CSS: 1350 / 1279 / 1000 (`rdi-items` container
query) / 900 / 760 / 700 / 640 / 600 / 520 px. Heatmap min-width = 364 + 72×passes.

## 7. UX pain points observed

1. **Length and navigation.** The page stacks nine sections (hero, review history, experiment, versioning, overview, repeat analysis, deep analysis, latency, categories, errors, root cause, items). The sticky nav helps, but the Overview section mixes score cards with Deep analysis panels and the Items section is the thing most users came for; it is always last.
2. **Scroll-stability machinery.** ~600 lines (`run_section_nav.js` pin logic, `keepSectionInPlace`, `reserveScrollRoom`, `restoreItemsGridTop`, `fitItemRows`) exist only because every filter re-renders sections above the reader via `innerHTML`. Browser tests (`tests/platform/test_run_page_render_browser.py`) lock this in. A React page must achieve the same stability by design (stable heights, `scroll-margin-top`, no unmount of sections on filter).
3. **Filtering is split across four places**: bar clicks in charts, the rule builder in the sticky nav, the Display popover (metric, threshold, sort, layout, columns), and the search box in the Items toolbar. "Clear" counts sort and search as filters (`countActiveFilters`, 16700), which surprises users.
4. **Display popover overload**: layout, text mode, sort, analysis metric, threshold and two column multi-selects in one popover (`#item-display-pop`). The analysis metric changes what every section means but sits behind "Display".
5. **Item cards**: collapsed rows measure metric pills with JS (`fitItemRows`, ResizeObserver) and show "+N more" — the Items grid is not a real table; no column headers, no sortable headers, no row selection.
6. **Pagination** (20 per page) with a 10,000-row run means 500 pages; the only alternative is the heatmap (repeat runs only). The URL `page` param is the only position memory.
7. **Diagnosis UI duplication**: item-level legacy widgets (category picker with inline project-catalog editing, detail dropdown, solution dropdown, feedback) coexist with per-metric issue cards and the issue dialog. Users see two vocabularies ("root cause" vs "issue") for the same thing.
8. **Fixed-position popovers** (`.root-cause-dropdown`, `.rdi-category-picker`, `.hero-pager__peek`) are appended to `<body>` and positioned manually; they close on any scroll (16181-16190) and are not keyboard-navigable (`.rc-option` are `div`s without roles).
9. **Trace drawer** is a `<div role="dialog">` with manual focus trap; the span tree rows are `<button>`s (good), but tabs re-render the whole detail pane on each click and CodeMirror is loaded lazily per panel. The resizable divider is mouse-only. No "Open in Langfuse" even when `trace_url` exists.
10. **Inline `onclick`** on the expected-output toggle (14407) and `btoa(itemId)` for element ids (14225) — fragile for non-ASCII ids.
11. **Accessibility**: `#items-grid` cards use `role="button"` on a `div` with nested buttons (copy, pencil) inside the button-role element; error cards are `div role="button"`; the Display popover is a `div` toggled with `.show` without `role="menu"`/arrow keys; chart bars (`.dist-chart-col`) are `div`s with click handlers only (no keyboard); the Sankey has hover-only interaction; the live indicator intentionally isn't a live region but status changes (COMPLETED) are also not announced; dialogs vary between `<dialog>` (issue) and custom overlays (export, category picker, trace).
12. **Pass navigation reloads the page** (`window.location.assign` in the latency aside and `<a href="?pass=N">` pills) instead of in-app navigation.
13. **Repeat view confusion**: `?pass=N` silently rewrites every number on the page; the only cue is the "Pass N/M" pill. Numbers in the overview differ from the Runs list because of error-counting rules; the notes explain but are small.
14. **Export mode** mutates the same page code with `IS_EXPORT` branches in ~40 places and relies on `localStorage` keyed by run id.
15. **Error labels in the URL** (prefix+hash) and a 500-entry limit make filter links long and opaque.

## 8. Migration notes

### Proposed React component tree and routes

Routes (React Router, under `/app`): `/app/projects/:slug/runs/:runId` and legacy
`/app/run/:runId` (redirect to the canonical one once `run.project.slug` is known).
Same query params as today (§2 J1). `?pass=N` is a route *search* param that
scopes a `usePassScope()` context, not a reload.

```
RunDetailPage                       (route element; loads run, owns URL view state)
├─ RunHero                          (status, pills, actions, pager, banners)
│  ├─ RunStatusBadge / LiveIndicator (useLiveRun)
│  ├─ RunMetaGrid                   (entity links)
│  ├─ IngestWarning / PrivateTestSetNotice / ScoreLockNotice
│  ├─ RunPager                      (useRunNeighbors; J/K hotkeys)
│  └─ ExecutionContextGrid          (JsonPreview from foundation)
├─ ReviewHistory                    (useReviewHistory)
├─ ExperimentPanel · VersioningDetails
├─ RunSectionNav                    (IntersectionObserver scroll-spy; FiltersButton, ClearButton, FilterBuilderPopover)
├─ RunFiltersProvider               (filter state ↔ URL; exposes filteredItems via useFilteredItems)
├─ OverviewSection
│  ├─ RunStatStrip
│  ├─ MetricCard (ScoreHistogram | BooleanSplitBar | NumericStats)
│  └─ DeepAnalysisPanels (CorrelationMatrix, RelationshipScatter, QualityLatencyFrontier, …)
├─ RepeatAnalysisSection            (useGroupMetrics, usePasses)
├─ LatencyTracesSection             (useStepLatency; LatencyHistogramBrush, QualityLatencyScatter, TimeBudget, StepsIntervalPlot)
├─ CategoriesSection                (chips, cards/compare)
├─ ErrorsSection
├─ RootCauseSection                 (cards, Sankey, aggregate button)
├─ ItemsSection
│  ├─ ItemsToolbar                  (SearchBox, DisplayMenu, ExportCsvButton)
│  ├─ ItemFilterBanner
│  ├─ ItemList (virtualized) | ItemHeatmap (virtualized)
│  │  └─ ItemRow (collapsed) → ItemCard (expanded; useItemDetails)
│  │     ├─ ItemBodies (Input / Expected / Output, TextModeToggle)
│  │     ├─ MetricStrip → MetricChip (ScoreEditor, JudgeMetaDisclosure)
│  │     ├─ PassOutputColumns (repeat) → PassOutputCard, MetricComparePanel
│  │     ├─ TraceButton (opens TraceDrawer) · LangfuseLink
│  │     └─ MetricAnalysisCard → IssueList → IssueDialog
│  └─ ItemsPagination
└─ TraceDrawer                      (portal; useItemTrace; SpanTree, SpanRow, WaterfallBar, SpanDetail tabs, ExpandModal)
```

### State placement
- **URL** (search params; source of truth, `replace` not `push`): `q, sort, view, metric, threshold, show, filters, page, hide_field[], hide_metric_field[], item, pass, trace, list`. Keep the exact names and encodings (`filters` JSON, error prefix+hash) so old links work.
- **Local (component/context)**: expanded item ids, hidden pass outputs and compared metric per item, filter-builder open, Display menu open, category chips selected (`selectedCategories`), breakdown view/sort/compare key, relationship X/Y, samples statistic/curve view, trace drawer selection/expanded/search/tab, reason popover.
- **Server cache (TanStack Query keys)**:
  - `['run', runId, 'compact']` → run + snapshot; `refetchInterval` driven by `['run', runId, 'live-status']` (3 s while `live`, paused when `document.hidden`, interval from the size/last-duration rule). Use `structuralSharing` plus a custom `select` that re-uses previous row objects by `item_id` + FNV signature so memoized rows survive; **do not** reset expanded state on refetch.
  - `['run', runId, 'passes']`, `['run', runId, 'group-metrics', metric, threshold]`, `['run', runId, 'step-latency', pass]`, `['run', runId, 'review-history', status]`, `['run', runId, 'neighbors', listContext]`, `['run', runId, 'item-details', [ids]]` (batched; a small `useItemDetails(ids)` that coalesces per tick and caps 3 in flight, mirroring `run_details.js`), `['run', runId, 'item-search', field, value, pass]`, `['run', runId, 'item-reasons', metric, pass, [ids]]`, `['run', runId, 'item-trace', itemId, pass]`, `['project', slug, 'category-catalog']`.
  - Mutations (`update_metric`, `update_root_cause`, `update_root_cause_issue`, approve) → `setQueryData` on `['run', runId, 'compact']` merging `row` by `item_id` (and re-scoping to `pass` as `applyUpdatedRow` does); invalidate `review-history` and `category-catalog` after issue changes.

### Backend changes this area will likely need
1. SPA fallback for `/app/*` (foundation) and CORS for the Vite dev server (port 5802).
2. `GET /api/runs/{id}` returns 200 `{error}` for not-found/denied — add a flag or new endpoint that returns proper 404/403 (keep the old behavior for the legacy page), with pytest coverage.
3. Server-side CSV export (`GET /api/runs/{id}/items.csv?…` or POST with column list) so the React page need not load every body client-side (today ≤100 ids per `items/details` call ⇒ 100 requests for a 10k-row CSV).
4. Optional: `GET /api/runs/{id}?view=compact&pass_number=N` already scopes rows server-side; prefer it over client-side `scopeRowToPass` (one less code path). Verify `passes` summary covers what `processRun` infers (8070-8092).
5. `export-html` must keep inlining the **old** `run.html` until a React export story exists; do not point it at the SPA.
6. An "Open in Langfuse" link needs nothing new: `run.langfuse_host`/`langfuse_project_id` and `row.trace_url` are already served.
7. Consider exposing `rejected` ingest rows and `status_reason_label` unchanged; nothing else is UI-reshaped on the server.

### Risks / gotchas
- **Payload size**: compact snapshot for a 10k-item × 5-pass run is tens of MB (every row carries `pass_scores`, `pass_metric_meta`, `pass_attempts`, `item_metadata`). Parse once, keep it in the query cache, derive everything with `useMemo`; never clone rows per render. Prefer server pagination later (not available today).
- **Virtualization is required** for: the item list (today 20/page; a React list should virtualize with `@tanstack/react-virtual` and can raise the page size or go page-less while keeping `page` in the URL for compatibility), the heatmap (already virtualized by hand), the trace span tree (traces with 5k+ spans exist: `/spans` paging max is 5000), the deep-analysis item×metric matrix (SVG width grows 18 px per item; cap or virtualize/aggregate), the error cards (bounded), and the filter builder enum lists (≤40 values, fine).
- **Live refresh races**: the compact refetch can land while a score edit is in flight; apply mutation results after refetch by `item_id`, and keep `expected_pass_version` from the latest run metadata (`pass_revision`). Stop polling on unmount (`pageSignal` today).
- **Pass scoping**: every metric/score/latency/status reader must go through one `usePassScopedRow(row)` or a selector so `?pass=N` cannot be half-applied (the old page rewrote rows once in `processRun`; a React port that forgets a reader will show mixed numbers).
- **Error-accounting rules** (`errorsLeftOut`, task vs scorer errors, not-received rows, reduced boolean display) are the most bug-prone logic. Port `metrics.js` verbatim as TS with the existing semantics and unit-test against fixtures from `tests/platform/test_run_detail_payload.py` and `test_item_reasons.py`.
- **Focus management**: drawer/dialog close must return focus to a trigger that may have re-rendered (trace_viewer.js:2420-2427) — use stable `data-item-id`-based refs.
- **Long text**: outputs can be hundreds of KB; render collapsed with "Show more", keep `dir` attributes (`QymSafe.textDirAttrs`) and the raw/rendered toggle; markdown rendering must stay sanitized (`QymSafe.renderMarkdown`).
- **URL compatibility**: `filters` JSON validation rules and error-label hashing must match byte-for-byte or old shared links silently drop filters.
- **Timing**: search debounce 250 ms, filter-builder input 150 ms, live probe 3 s, reload throttle per size, pager peek 120 ms, target-item highlight 2.6 s, "Live · updated" tick 1 s.

### Suggested split into sub-components (build sequentially, one agent)
Build in this order so each step is testable and no file exceeds a few hundred lines:
1. **`run-shell`** — route, `useRunQuery`, `useLiveRun`, URL view-state hook (`useRunViewParams` with the exact param encodings), `metrics.ts` port, `RunHero` (status, meta, banners, pager, execution context), `ReviewHistory`, `ExperimentPanel`, `VersioningDetails`, `RunSectionNav` skeleton (links + scroll-spy, no filters yet). Playwright: load, error states, live indicator, pager.
2. **`run-items`** — `RunFiltersProvider` + `useFilteredItems` (all filter kinds, search via server, sort), `ItemsSection` with virtualized `ItemList`/`ItemRow`/`ItemCard`, lazy `useItemDetails`, reasons, metric strip with score editing, pass output columns, heatmap, CSV export, `FilterBuilderPopover` + Display menu wired into the nav. Playwright: filter/sort/search/page round-trips through the URL, open item, edit score, deep link `?item=`.
3. **`run-analysis`** — `OverviewSection` (metric cards + click-to-filter), `CategoriesSection`, `ErrorsSection`, `RootCauseSection` (+ issue dialog, category catalog, approve), `RepeatAnalysisSection`, `DeepAnalysisPanels`. Playwright: bar click filters land on the banner, error card filter, add/approve issue.
4. **`run-traces`** — `LatencyTracesSection` (histogram brush, scatter, budget, steps plot) and the `TraceDrawer` (span tree, waterfall, detail tabs, keyboard, `?trace=`, retries, Langfuse link). Playwright: open trace, navigate spans, brush latency filter.

Shared pure modules extracted along the way (with Vitest): `metrics.ts`,
`itemReasons.ts`, `filterRules.ts` (eval + URL codec), `traceTree.ts` (build,
dedupe, retries, bounds), `runsOrder.ts`.

### Suggested Playwright scenarios
1. Open `/app/projects/{slug}/runs/{id}` → hero shows name, status, metrics cards, items count; `document.title` contains the run name.
2. Open a `RUNNING` run; ingest two more items via `/v1/runs/{id}/events`; within 10 s the item count and cards update without the expanded card closing or the scroll moving; complete the run → indicator disappears.
3. Click the "Fail" segment of a boolean card → items filtered, banner text "Filtered to N items that fail X", `?show=failed&metric=X` in the URL, Overview counts reflect the filter; "Clear filter" restores.
4. Type in search, wait, assert `?q=` and row count; reload the page and assert the same rows and the input value.
5. Build a rule (metric is failed AND latency > 1000) in the filter builder → URL `filters` JSON round-trips after reload; "Set on the page" chip removal works via keyboard.
6. Open an item → bodies load (one `items/details` request), `?item=` set; reload → same item open and scrolled under the nav; "Copy link" copies that URL.
7. Edit a metric score to `0.5`, Save → chip shows the new value and "edited" badge; on a SUBMITTED run the pencil is absent and the lock notice is shown; a 409 keeps the editor open with the message.
8. Open the Trace drawer → spans listed, `j`/`k` move selection, `Enter` expands, `/` focuses search, `Esc` closes and focus returns to the Trace button; `?trace=` added then removed.
9. Add an issue via the dialog (category from the list, solution preset) → card shows the issue with "Pending review"; Approve → "Approved".
10. Repeat run (`samples=3`): switch Layout to Heatmap (`?view=heatmap`), open `?pass=2` → every metric chip shows pass-2 values and the pill reads "Pass 2/3"; latency brush on the histogram sets a latency filter chip.
11. Press `J` → navigates to the next run in `?list=` order; `K` returns; Back restores the previous view (filters and page).
12. Items with `output_received: false` show "Not received" and are excluded from the Completed count.

## 9. Open questions

1. **Offline export mode**: keep the standalone HTML export as the *old* page only (served by `export-html` as today), or rebuild annotation-in-a-file in React? Recommendation: keep the button, serve the legacy export for now, log it.
2. **Legacy item-level diagnosis widgets** (category picker, detail dropdown, solution dropdown, item feedback) vs per-metric issues: drop the legacy editors and show legacy values read-only, or keep both? The server still accepts both shapes. Recommendation: read-only legacy, editors only per metric.
3. **Pagination vs infinite virtualized list**: the URL `page` param must keep working for old links; decide whether `page` maps to a scroll offset (virtualized list, page size 20 kept as a "page" unit) or stays a real pager.
4. **Deep analysis panels**: which of matrix / correlation / relationship scatter / frontier / by-pass trend / stability map survive, and whether they move into a tab rather than the Overview flow.
5. **Section order**: should Items move above the analysis sections (or into a tab set: Items · Analysis · Traces)? The brief's §7 argues yes; the sticky nav exists because they are far apart.
6. **"Open in Langfuse" link**: add it (data exists) even though the current page intentionally hides external actions (comment at run.html:6926)?
7. **Pass switching**: in-app search-param change vs the current full reload; and whether to request `pass_number` server-side (`?view=compact&pass_number=N`) instead of client-side `scopeRowToPass`.
8. **Scroll stability contract**: which of the browser tests in `tests/platform/test_run_page_render_browser.py` / `test_run_page_structure_browser.py` are requirements for the React page (e.g. "a chart filter keeps its section in place", "closing an item at the page end keeps it in place") versus implementation details of the old DOM approach.
9. **Error-label URL encoding**: keep prefix+hash for long labels (compatibility) or move error filters to ids once the API can return stable bucket ids.
10. **Not-found/denied as 200 `{error}`**: change the endpoint (and the legacy page) or sniff the message as today.
11. **Column alignment of metric pills across cards** (`alignMetricColumns`): is a fixed-column table layout acceptable instead (would change the look but removes JS measurement)?
12. **Category catalog editing from inside the picker** (adds project-wide categories with required description/use-when): keep in the run page or move to project settings only?
