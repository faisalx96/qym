# QA: Auto-analysis workspace (areas 05 analyzer half + 08)

Branch `ui/qa`. Old UI = vanilla at `7814183` (`_static/dashboard/analyzer.html`, `playground.js`; `insights.js` is the Models page and `item_reasons.js` is the run page, neither belongs to this workspace). New UI = `frontend/src/features/analyzer/` (paths below are relative to it unless they start with another folder).

Both UIs ran side by side on seeded SQLite copies with the same schema and the same stub LLM (`frontend/scripts/stub_llm.py` on 9834: `stub-model` succeeds, `slow-model` sleeps 5 s, `bad-model` answers HTTP 500), `QYM_LLM_CONFIG_ENCRYPTION_KEY` identical, `QYM_ALLOW_PRIVATE_LLM_BASE_URLS=true`. OLD platform 8824, NEW platform 8834 (served build for the double-request check) and Vite 5834 proxying to 8834 (live sources). Fixtures were pushed through the public API with the project's own e2e helpers (`e2e/analyzer/helpers.ts`): single-sample run with 4 failing items, a 2-sample run, an Arabic run, a 25-item run, a Python-literal-input run, a project without any connection, an archived project, projects with three connections (stub / slow / bad). Approved examples were created through `POST /api/corrections/approve-metric-analysis`. Driven with ~45 Playwright scripts (Chromium 1440x900, screenshots kept out of the repo). Request bodies, URLs, texts and states quoted below were read from those runs.

Status key: **OK** same behaviour verified; **CHANGED** different, judged in Notes; **BUGGY** defect reproduced; **MISSING** not ported (OQ = logged in `decisions/analyzer/OPEN_QUESTIONS.md`). Spec = Playwright spec in `frontend/e2e/analyzer/` (`workspace`, `run`, `guidance`, `a11y`, `cutover-*`), "-" = none.

## Summary

Total 165 rows (original audit: OK 101, CHANGED 44, BUGGY 9, MISSING 11). Current state: every BUGGY row is closed (FIXED marks in the Fix list; rows A17, A21, B2, J1 also marked in the table), of the 11 MISSING rows the run-picker mode is a logged decision and the lineage graph, placeholder highlighting and per-target root-cause detail are Deferred; the rest were closed by the fix pass.

Headline defects (details in the Fix list): a job in which every analysis failed is reported as "6 of 6 succeeded" (bar, Review card and toast); a rule typed and then left within 700 ms is silently lost; Diagnosis search leaves the editor on a different category than the list; empty/0 Timeout becomes 1 second; "View run" drops the selected sample; a run opened under another project's slug is not redirected; Publish defaults to "Set as production". The core journey (open, pick sample, metrics, instructions with `{var}` mapping, targets, preview, Test, Analyze, cancel, resume, reload, project guidance CRUD, 409, documents, rule versions) works and matches the old behaviour or improves on it.

Of the CUTOVER.md gaps only "Analyzer under a wrong project slug is not redirected" is in this area; it reproduces (section A).

## Feature table

### A. Routes, URL state, entry points, page states

| # | Old behaviour (source) | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| A1 | `/projects/:slug/analysis?run=ID` opens the run workspace (analyzer.html:3676 route regexes) | AnalyzerPage.tsx:20, useAnalyzerRoute.ts:24 | workspace.spec (open) | **OK** | Loads on both; no console or page errors in any flow. |
| A2 | Canonical URL is `/projects/:slug/runs/ID/analyzer` (server 307 from `?run=`) | RunAnalyzerRedirect.tsx:16 | workspace.spec (legacy URLs) | **CHANGED** | Direction reversed: `?run=` is now canonical and the `/analyzer` form redirects to it. Acceptable (same two URLs work). |
| A3 | `/projects/:slug/runs/ID/analyzer?metric=..&scope=..` keeps its query | RunAnalyzerRedirect.tsx:20-22 | cutover-routes / workspace.spec | **OK** | Verified: lands on `analysis?metric=exact_match&scope=rules&run=ID`. The old server redirect dropped `run` when a query was present (old bug, fixed). |
| A4 | `/run/ID/analyzer` (no project in URL) resolves the project and opens the analyzer | shell LegacyRunRedirect (router.tsx) | cutover-routes | **OK** | Verified: ends on `/projects/<slug>/analysis?run=ID`. |
| A5 | `?metric=` preselects exactly one metric chip; unknown metric ignored | model/settings.ts:43 | workspace.spec (metric chips) | **OK** | Verified `1 of 2 metrics selected`. |
| A6 | `?pass=N` (valid) opens that sample; missing/invalid on a repeat run shows the sample picker | workspace/useRunData.ts:52-55 | workspace.spec (sample picker) | **OK** | Verified `pass=9` on a 2-sample run shows the picker. |
| A7 | Choosing a sample writes `pass` to the URL (keeps run and metric) | useAnalyzerRoute.ts:31 | workspace.spec (sample picker) | **OK** | Verified `run=..&pass=2`. |
| A8 | `?pass=` on a single-sample run is ignored | workspace/useRunData.ts:54 | - | **OK** | Verified: workspace opens; the param stays in the URL (harmless). |
| A9 | `?scope=categories\|rules\|documents` selects the project tab; `run` is the default | useAnalyzerRoute.ts:8-13, GuidanceArea.tsx | guidance.spec (project scope) | **OK** | Verified for all three plus unknown value (falls back to run/landing). |
| A10 | Aliases `diagnosis`, `project`, `dashboard` are rewritten in the URL (`history.replaceState`) | useAnalyzerRoute.ts:8-13 | cutover-routes.test.ts | **CHANGED** | Aliases are understood but the URL is not rewritten (stays `scope=diagnosis`). Harmless. |
| A11 | Root-cause dashboard tab kill switch (`AUTO_ANALYSIS_DASHBOARD_ENABLED=false`): no view or request may activate it | (none) | - | **OK** | Nothing user-visible existed. `scope=dashboard` shows the run area in both, no dashboard request. Logged drop (OQ Q9). |
| A12 | No `run`: landing "Select a run to start analysis" + link "Select a run from Runs" | ProjectLanding.tsx:8 | guidance.spec (project scope) | **CHANGED** | Copy differs; two buttons (Open Runs, Open project guidance). Verified. |
| A13 | Landing link adds `?qym_analysis_run_picker=1`: the runs list then makes run-name links open the analyzer (dashboard.js:179-187) | (none) | - | **MISSING** | Param is ignored (verified: run names still open run detail). Per-row "Analyze" chips cover the journey but the mode is gone. Not logged in decisions/analyzer/OPEN_QUESTIONS.md. |
| A14 | Runs list "Analyze" chip opens the analyzer (dashboard.js:134) | runs-list/cells.tsx:314, PassesPanel.tsx:365 | - | **OK** | Verified href `/projects/<s>/runs/<id>/analyzer` (then redirected). |
| A15 | Run page links to the analyzer | run-detail/components/panels/RootCauseTab.tsx:75 | - | **OK** | Verified "Auto-analyze" link. |
| A16 | Compare: Auto-Analyze opens the playground overlay on run 0 | compare/components/panel/RootCauseTab.tsx:24 | - | **CHANGED** | Per-run links to `analysis?run=ID[&pass=N]`. Logged drop (Q1). Equivalent journey; link target read in code only. |
| A17 | Unknown run id: "Unable to load auto-analysis / Run not found" with Retry and Open Runs (analyzer.html:5890) | RunShell.tsx:87 (ErrorState) | cutover-routes | **FIXED** (e6b07313) | Title says "Couldn't load the analyzer configuration" (the run-scoped config call fails first) and there is no Open Runs link. Retry exists. Message `HTTP 404 · Run not found` is right. |
| A18 | Load failure shows Retry that reloads | RunShell.tsx:87, RunAnalyze.tsx:51 | cutover-routes | **OK** | Spec covers HTTP status variants and Retry recovery. |
| A19 | Unknown project slug | shell ProjectNotFound | - | **OK** | Verified "Project not found" in both. |
| A20 | Archived project blocks the page | shell archived gate | - | **OK** | Verified new shows "Not available for an archived project" with a link to runs; old stays on "Loading project…" forever. |
| A21 | Run opened under another project's slug is redirected (server) to its own project | (none) | - | **FIXED** (e6b07313) | Verified: `/projects/<other-slug>/analysis?run=<run of project A>` renders the run under the wrong slug/header. Listed in CUTOVER.md. Guidance edits still go to the run's real project (run-scoped endpoints). |
| A22 | Document title `قيِّم • Auto-analysis • <run name>` (`Choose sample` on the picker) | AnalyzerPage.tsx:14 | - | **CHANGED** | Static `Auto-analysis · قيِّم`. Minor (tab titles no longer name the run). |
| A23 | Breadcrumb project / Auto-analysis | shell/chrome/Breadcrumbs.tsx:23 | - | **OK** | Verified. |
| A24 | Header: title, description, `Project <slug>` and `Workspace metric failure diagnosis` meta | AnalyzerPage.tsx:25-29 | - | **CHANGED** | Title and project meta kept; description rewritten; workspace meta dropped. Fine. |
| A25 | Tab bar: Analyze run \| Diagnosis categories \| Production rules \| Documents (`role=tablist`) | RunShell.tsx:58, GuidanceArea.tsx:19 | a11y.spec | **CHANGED** | Segmented "Analyze run / Project guidance" plus three tabs inside guidance (UX_DECISION winner C). Acceptable. |
| A26 | Loading skeleton while the run loads | RunAnalyze.tsx:52 | - | **OK** | Delayed skeleton, no flash. |
| A27 | (new) `?step=configure\|preview\|run\|review` in the URL | RunShell.tsx:35 | workspace.spec | **OK** | Extra param, logged. Reload keeps the step. |

### B. Run header and sample selection

| # | Old behaviour (source) | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| B1 | Run name, Task / Model / Dataset values (`dir=auto`) | blocks/RunHeader.tsx:26-46 | workspace.spec | **OK** | Verified; adds the run id tag. |
| B2 | "View run" link keeps `?pass=N` of the selected sample (`selectedRunUrl`) | blocks/RunHeader.tsx:65 | - | **FIXED** (e6b07313) | Verified href is `/projects/<s>/runs/<id>` with no `pass` on a repeat run (header, job bar and Review card). Lands on the whole run instead of the analysed sample. |
| B3 | Sample `<select>` for repeat runs: "Sample N · status · scored/total items scored" | blocks/RunHeader.tsx:51-62 | workspace.spec (sample picker) | **CHANGED** | Label is "Sample N (scored/total)", status dropped. Acceptable. |
| B4 | Sample switch is blocked while a job runs (warning "Analysis running…") | blocks/RunHeader.tsx:59-61 (isDisabled + help) | run.spec (cancel, resume, sample guard) | **OK** | Verified: select disabled with help "Wait for the running job, or cancel it, to switch samples." |
| B5 | Sample switch loads only that sample's rows, no reload, results cleared | RunAnalyze.tsx:55 (key), workspace/useRunData.ts | workspace.spec | **OK** | Verified requests: compact `pass_number`, `analysis-jobs/active?pass_number=`. |
| B6 | Sample picker interstitial: select + Continue | blocks/SamplePicker.tsx:11 | workspace.spec (sample picker) | **CHANGED** | List with one button per sample (status, scored/total). Better. |
| B7 | `/passes` only for repeat runs | workspace/useRunData.ts:51 | cutover-passes-request | **OK** | Spec guards it. |
| B8 | `pass_number` and `expected_pass_version` sent on preview, test and analyze | model/settings.ts:134-143 | workspace.spec | **CHANGED** | `pass_number` verified on all three. `expected_pass_version` is only sent when `run.metadata.pass_revision` exists (old always sent a number, default 0). Server check still protects runs that have a revision. |

### C. Metric chips

| # | Old behaviour (source) | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| C1 | Metric checkbox chips, all selected by default | blocks/MetricChips.tsx | workspace.spec (metric chips) | **OK** | Verified. |
| C2 | Select all / Clear | blocks/MetricChips.tsx:27 | workspace.spec | **OK** | Verified; Clear gives step note "Pick a metric". |
| C3 | Summary "N of M metrics selected" / "Select at least one metric to analyze." | blocks/MetricChips.tsx:35 | workspace.spec | **OK** | Verified. |
| C4 | Changing metrics refreshes targets, count and preview | workspace/useRunWorkspace.ts (matched / targetCount) | workspace.spec | **OK** | Verified count 4 -> "Pick a metric". |
| C5 | No metric selected disables Analyze/Test and explains why | blocks/Targets.tsx:81, blocks/RunBar.tsx:31 | workspace.spec | **OK** | "Select at least one metric" empty state. |

### D. Additional instructions and `{var}` mapping

| # | Old behaviour (source) | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| D1 | Textarea; `{var}` tokens detected; `{categories}` reserved | blocks/Instructions.tsx, model/vars.ts | workspace.spec (variable mapping) | **OK** | Verified `{rubric} {notes}` listed, `{categories}` ignored. |
| D2 | Each detected variable gets a mapping row: source select (input/output/expected/error/metric_metadata) + JSON path picker | blocks/FieldsMapping.tsx:59-117 | workspace.spec | **OK** | Verified rows with "— select source —"; `custom_variable_mapping` unit-tested. |
| D3 | Variable Mapping is a separate collapsed section | blocks/Instructions.tsx:25-31 | - | **CHANGED** | Variable rows render right under the textarea; INPUT/EXPECTED/OUTPUT rows moved to the Preview step. Fine. |
| D4 | No length limit on instructions | blocks/Instructions.tsx:6 | - | **CHANGED** | maxLength 20 000. Acceptable. |

### E. Target filter and run options

| # | Old behaviour (source) | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| E1 | Max score slider 0-100 step 5, default 80%, "applies only to higher-is-better metrics" | blocks/Targets.tsx:16-26 | workspace.spec | **OK** | Verified keyboard steps. `max_score` is sent even at 0 % (old sent undefined at 0 %); edge only. |
| E2 | Skip analyzed (default on) | blocks/Targets.tsx:27 | run.spec (stub job) | **OK** | Verified: after a job, targets are hidden and the zero-target state shows. |
| E3 | Re-analyze human labels + confirm dialog "Overwrite human diagnoses?" | RunAnalyze.tsx:215, workspace/useRunWorkspace.ts:139-148 | run.spec (re-analyze human labels) | **OK** | Spec covers Keep/confirm. I could not create a human-source label through the API (approval keeps source `ai`), so not re-driven by hand. |
| E4 | Timeout (seconds): default from `analysis_defaults`, blank/<1 falls back to the default, max clamp | blocks/Targets.tsx:35-42, model/settings.ts:171-186 | - | **BUGGY** | Verified: empty or 0 becomes 1 second and is sent as `timeout_seconds:1` (old reset to 120). Max clamps to 3 600 correctly. |
| E5 | Timeout help marker: first attempt uses this timeout, retries double it | (none) | - | **MISSING** | No explanation of retries/doubling anywhere. Not logged. |
| E6 | Analyze limit: digits only (max 4), blank = All, +/- steppers | blocks/Targets.tsx:43-52 | workspace.spec | **CHANGED** | NumberField with steppers; letters rejected, 12345 clamps to 9,999 (shown with a thousands separator), 0 becomes 1 (old: blank = All). Acceptable. |
| E7 | Max issues per item (1-10, project default, `max_root_cause_categories`) | blocks/Targets.tsx:52-60 | - | **CHANGED** | Clamps 99->10, 0->1; empty becomes 1 (old: back to the project default). Part of fix B4. No help marker (old had one). |
| E8 | Matched targets list: item `#index`, "N metric targets" count, per-metric button with score and failed/error badge | blocks/Targets.tsx:110-160 | workspace.spec | **CHANGED** | Shows `item-id`, one chip per metric with score; no index, count or status badge. Acceptable. |
| E9 | Root-cause detail, confidence dot and category chips on already analysed targets | blocks/Targets.tsx:143-153 | - | **CHANGED** | Only an `analyzed`/`human` tag and the first two category names (verified). Detail text and confidence dot are gone (minor). |
| E10 | Target list pagination 10 per page | blocks/Targets.tsx:9,163 | workspace.spec | **OK** | Verified "1-10 of 25 items", page 2 starts at item-11. |
| E11 | Select a target row to preview/test it (`aria-pressed`) | blocks/Targets.tsx:130-141 | workspace.spec (prompt preview) | **OK** | Chip per metric selects the preview target; checkbox selects up to 3 for Test. |
| E12 | Zero targets with Skip analyzed: "All matching targets already have analysis" + Include analyzed targets + Open Reviews link | blocks/Targets.tsx:86-99 | run.spec | **CHANGED** | Message and Include button kept (verified); the Open Reviews link is gone though the text still tells users to open Reviews (`reviewsUrl` not ported). Minor. |
| E13 | Zero targets otherwise: "No targets match the current scope" | blocks/Targets.tsx:87 | - | **OK** | "No failed targets" copy. |
| E14 | Target matching: per-metric threshold and direction, task/metric errors excluded, human labels, skip analyzed, max score | model/targets.ts:158-193 | targets.test.ts (9 cases) | **OK** | Same algorithm as `_getMatchedItems`; counts equal the server filter in every run I used. |
| E15 | Arabic/RTL input text in targets (`dir=auto`) | blocks/Targets.tsx:118 | a11y.spec (Arabic) | **OK** | Verified `dir=rtl` on both Arabic rows. |
| E16 | Footer count "Analyze N items" (limit-aware), hidden when 0 | blocks/RunBar.tsx:42 | workspace.spec | **CHANGED** | Button lives on the Run step, disabled at 0 ("Analyze 0 items") instead of a hidden sticky footer. Server total replaces the estimate while running (Q4). |
| E17 | (new) Check up to 3 targets for Test Selected | blocks/Targets.tsx:130-137 | run.spec (3 targets) | **OK** | 4th checkbox disabled once 3 are checked (verified). |

### F. Prompt preview

| # | Old behaviour (source) | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| F1 | `POST analyze-preview` debounced ~500 ms, fires on load and on any config/target change | workspace/useRunWorkspace.ts:124 | workspace.spec (prompt preview) | **OK** | One request per change on the built app. The Vite dev server doubles the first request (StrictMode), not a product bug. |
| F2 | System / User messages with role labels | blocks/PromptPreview.tsx:52-66 | workspace.spec | **OK** | Verified; each message has its own Copy button. |
| F3 | "Final prompt: N characters" | blocks/PromptPreview.tsx:27-30 | workspace.spec | **OK** | Tag `8,763 chars`. |
| F4 | Indicator "auto-updates / updating…" and loading text | blocks/PromptPreview.tsx:32-34 | - | **CHANGED** | "Updating…" status only. |
| F5 | Error "Error (HTTP n): detail" | blocks/PromptPreview.tsx:48-50 | - | **CHANGED** | ErrorState with Retry, verified `HTTP 500 · Preview exploded`. |
| F6 | No target: "No items match current filters." | blocks/PromptPreview.tsx:46-47 | - | **CHANGED** | "Nothing to preview" empty state, verified. |
| F7 | Copy prompt | blocks/PromptPreview.tsx:84 | workspace.spec | **OK** | Verified clipboard gets `[system]..[user]..` (8 781 chars). |
| F8 | Expand / collapse the preview | blocks/PromptPreview.tsx:79-83 | - | **OK** | Button present (Expand/Collapse); not measured. |
| F9 | `{placeholder}` / section highlighting in the preview text (`_highlightPreview`) | (none) | - | **MISSING** | Plain `<pre>` text. Cosmetic. |
| F10 | Context settings popover: Production rules, Project documents, Trace evidence, with links to the Rules/Documents tabs | blocks/PromptPreview.tsx:35-45 | workspace.spec | **CHANGED** | Three inline switches beside the preview; the tab links are gone. Toggles verified (`include_project_rules:false`). |
| F11 | Fields shown as regex-guessed "Fields:" badges on test results | blocks/PromptPreview.tsx:70-76, TestResults.tsx:63 | run.spec | **CHANGED** | "Sent:" / "Fields sent" derived from the request (exact). Logged (Q6). |
| F12 | (new) Previewed-target picker | RunAnalyze.tsx:247 | workspace.spec | **OK** | Verified changing it re-previews that item/metric. |

### G. Input mapping

| # | Old behaviour (source) | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| G1 | Input mapping dialog: INPUT / EXPECTED OUTPUT / ACTUAL OUTPUT source selects | RunAnalyze.tsx:259-262, blocks/FieldsMapping.tsx | workspace.spec | **CHANGED** | Inline on the Preview step next to the prompt (UX_DECISION). Verified `field_mapping:{output:'expected'}` goes out. |
| G2 | JSON path picker with "Use full value" and nested key checkboxes | blocks/PathTree.tsx, FieldsMapping.tsx:119-145 | workspace.spec (variable mapping) | **OK** | Verified tree for nested `db.name`, `hints.tags`, `question`. |
| G3 | Path picker for values stored as Python dict/list literal strings (`_tryParsePythonLiteralValue`) | model/mapping.ts:21 (JSON only) | - | **MISSING** | Verified with an input `"{'question': 'x', 'tables': [..]}"`: old lists `opts / question / tables`; new says "not JSON in the first items, so the full value is sent". |
| G4 | Include in prompt: Error / Scores / Metric Metadata | blocks/FieldsMapping.tsx:156-168 | workspace.spec | **OK** | Verified `include_fields.error/scores:false`. |
| G5 | Metric metadata path picker grouped by metric | blocks/FieldsMapping.tsx:188-214 | - | **OK** | "Choose metadata (all)" button; not re-driven. |
| G6 | Item bodies needed only when a picker opens | workspace/useRunData.ts:58-64 | workspace.spec | **OK** | Lazy `items/details` for the first 20 rows (verified request on Preview). |

### H. Test Selected

| # | Old behaviour (source) | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| H1 | Test one selected target (`POST analyze-test`, 1 item) | workspace/useRunWorkspace.ts (runTest), blocks/RunBar.tsx:31-33 | run.spec (Test Selected) | **CHANGED** | Up to 3 targets (verified 3 results via two calls grouped by metric). Improvement. |
| H2 | Result card: issue number, category, subcategory, finding, confidence | blocks/TestResults.tsx:7-62 | run.spec | **OK** | Verified `82% confidence · Retrieval · Missing context`. |
| H3 | "Why this category" reason (`category_reason`, `root_cause_reason`) as collapsible text | blocks/TestResults.tsx | - | **MISSING** | Not rendered anywhere in the new result card. Minor. |
| H4 | Failed test: error code and message in the card | blocks/TestResults.tsx:18-24,32-37 | run.spec | **OK** | Verified `ERROR · Error code: 500 - {...}`. |
| H5 | Timeout retry note on a result | blocks/TestResults.tsx:27-30 | - | **OK** | Code read only. |
| H6 | Item context details with the prompt data | blocks/TestResults.tsx:69-76 | - | **CHANGED** | Shows input/expected/output JSON instead of the extracted prompt block. |
| H7 | Test button disabled without connection, targets, or while busy | blocks/RunBar.tsx:31 | run.spec | **OK** | Verified no-connection state. |
| H8 | (new) Cancel test (AbortController), focus moves to results | workspace/useRunWorkspace.ts (cancelTest), RunAnalyze.tsx:271-280 | run.spec (cancel test) | **OK** | Verified focus lands on the results region. |
| H9 | A test saves nothing | workspace/useRunWorkspace.ts | run.spec | **OK** | Spec asserts targets unchanged. |

### I. Analyze job lifecycle

| # | Old behaviour (source) | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| I1 | `POST analysis-jobs` body: metrics[], item_filter failed, max_score, only_unanalyzed, allow_human_overwrite, threshold, config, connection_id, timeout_seconds, limit, pass context | model/settings.ts:171-186 | run.spec | **OK** | Verified body. `threshold` is a fixed 0.8 fallback (server uses each metric's own threshold first). |
| I2 | Poll `GET analysis-jobs/{id}` every 600 ms until terminal; pauses when hidden | useAnalysisRunner.ts:65, api/analysis.ts (useAnalysisJob) | run.spec | **CHANGED** | 1 s interval (Q5). Verified 2 polls for a 6-target stub job. |
| I3 | Progress text "Analyzing metric failures: x/y (pct)" + last item + errors/retries line | blocks/JobStatus.tsx:82-99 | run.spec | **CHANGED** | Bar: `ANALYZING · x / y targets` and a progressbar; last item and running error count are gone. |
| I4 | Phases: retrying (item, attempt n of m, timeout) and aggregating | blocks/JobStatus.tsx:8-31 | run.spec (mocked job) | **OK** | Verified "AGGREGATING CATEGORIES 6 / 6"; retry note covered by spec. |
| I5 | Cancel analysis -> "Cancelling…" -> cancelled message | useAnalysisRunner.ts:99, blocks/JobStatus.tsx:99-101 | run.spec (cancel) | **OK** | Verified; the stub cancelled instantly so the transient state was not visible. |
| I6 | Job failure message and "Analysis Failed" toast | blocks/JobStatus.tsx:167-171, RunShell.tsx:41 | run.spec | **OK** | Verified with a mocked `failed` job: bar, Review card and toast show the backend text. |
| I7 | Start failure (HTTP 4xx/5xx detail shown) | useAnalysisRunner.ts:84-95 | - | **OK** | Verified 400 detail shown; 409 shows a clear "sample changed" message. |
| I8 | "Reconnecting to background analysis…" when polling drops | useAnalysisRunner.ts:110, blocks/JobStatus.tsx:76 | run.spec (mocked) | **CHANGED** | Appears after about 4 s (React Query retries first); old showed it at the first failed poll. Recovers by itself (verified). |
| I9 | Resume a running job on page open via `analysis-jobs/active` (per sample) | useAnalysisRunner.ts:59-63 | run.spec (reload resumes) | **OK** | Verified reload mid-job shows the bar and a disabled "Analysis running" button. |
| I10 | Completion: "Analyzed N metric failures successfully · Created N categories · Timeout retries N" | blocks/JobStatus.tsx:33-43,145-166 | run.spec | **CHANGED** | Shows "x of y metric analyses succeeded" and error groups. "Created N categories" and the timeout-retry total are gone (verified against old text). |
| I11 | Failed and partial results: "x of y succeeded", n failed, error-code groups, "Analysis failed" when all failed | blocks/JobStatus.tsx:33-43, RunShell.tsx:39 | run.spec (mocked job) | **BUGGY** | With the stub's `bad-model` all 6 analyses failed; new bar says "6 of 6 metric analyses succeeded, 6 failed", Review card "Completed with errors · 6 of 6 succeeded", toast tone info. Old: "Analysis failed · 0 of 6 succeeded". `analyzed` uses `result.total_analyzed` (includes failures). Error code shows `error` where old showed `analysis_error`. |
| I12 | Aggregation error warning ("Analysis saved; aggregation failed") | blocks/JobStatus.tsx:162 | - | **CHANGED** | Rendered on the Review card only. |
| I13 | "View run" link in the result | blocks/JobStatus.tsx:109,174 | run.spec | **OK** | Present (but see the missing `pass`, row B2). |
| I14 | Results are merged so the target list changes (Skip analyzed hides them) | useAnalysisRunner.ts:71 | run.spec | **OK** | Verified: all 4 items became "All matching targets already have analysis". |
| I15 | Analyze, Test and connection select disabled while a job or test runs | blocks/RunBar.tsx:20,31,39 | run.spec | **OK** | Verified. |
| I16 | (new) Sticky job bar on every area, "Analysis x/y" badge in Project guidance, Review step | RunShell.tsx:66-76, RunAnalyze.tsx:96-100 | run.spec | **OK** | Verified bar stays while switching to guidance. |
| I17 | Review card after a reload of a finished job | RunAnalyze.tsx:185 | - | **CHANGED** | "Nothing to review yet" (old also lost the result on reload; nothing persisted either way). |
| I18 | Analysis results visible in run detail | (run-detail) | - | **OK** | API round-trip verified (`metric_analyses` saved with root_cause_issues); run-detail rendering belongs to that area's QA. |

### J. LLM connection, no-connection and read-only states

| # | Old behaviour (source) | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| J1 | Connection select "name · model"; connections without a key are disabled and labelled "key missing" | blocks/RunBar.tsx:15-24 | - | **FIXED** (ee52c2f9) | Select passes `disabledKeys` to the react-aria Select; `llmReady` is false for a key-less connection. |
| J2 | Default connection = `default_connection_id` | workspace/useRunWorkspace.ts:67 | run.spec | **OK** | Verified default selected, switching sent `connection_id`. |
| J3 | No connection: banner + Test/Analyze disabled, Preview still works | RunAnalyze.tsx:111-117 | guidance.spec (no LLM) | **CHANGED** | Banner text kept in spirit; select is shown disabled (placeholder "No connection", from code) instead of hidden; banner and disabled buttons verified. |
| J4 | Read-only banner ("Only project managers and the run's owner can…") | RunAnalyze.tsx:118-124 | guidance.spec (read-only) | **BUGGY** | New copy says running needs "project member access"; the real rule (`can_operate_analyzer`) is manager or run owner, so ordinary members are told the wrong thing. Buttons are correctly disabled. |
| J5 | Section load problems named in a banner ("Project documents could not be loaded (…)") | guidance/RulesPanel.tsx:52-56, DocumentsPanel.tsx | - | **CHANGED** | Each panel shows its own error state with Retry instead of one banner. |
| J6 | Config 403/other failure message | RunShell.tsx:87 | cutover-routes | **OK** | Spec covers statuses. |

### K. Diagnosis categories

| # | Old behaviour (source) | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| K1 | Catalog lists only categories with approved examples | guidance/DiagnosisPanel.tsx:352 | guidance.spec (diagnosis) | **CHANGED** | Lists every catalog category, those without examples get a "Needs examples" badge. Logged (Q3). Verified old: 1 category, new: 10. |
| K2 | Summary line "N categories · M approved examples" | guidance/DiagnosisPanel.tsx:237 | guidance.spec | **OK** | Verified. |
| K3 | Search categories (filters the nav, selects the first match) | guidance/DiagnosisPanel.tsx:122-123 | - | **BUGGY** | Verified: searching `lat` leaves the editor on the first category overall (Hallucination: its Guidance/Remove category) while the list shows only Latency; searching `zzz` shows an empty list, no "no match" text and the same stale editor. |
| K4 | Add category (inline name + Add) | guidance/DiagnosisPanel.tsx:184-202 | guidance.spec | **OK** | Verified; duplicates rejected with a toast. |
| K5 | Taxonomy validation: Description and Use when required for every category and touched subcategory | guidance/DiagnosisPanel.tsx:141-147,289 | guidance.spec | **OK** | Verified messages `Add both Description and Use when for: Latency.` / `Latency / Timeout.` and the "Taxonomy required" badge. |
| K6 | Subcategories: add, remove, taxonomy fields, example-only labels read-only | guidance/DiagnosisPanel.tsx:204-221,435-490 | guidance.spec | **OK** | Verified add/save; example-only label shows the read-only note. |
| K7 | Save: `PUT analysis-category-catalog` with `base_revision` | guidance/DiagnosisPanel.tsx:141-163 | guidance.spec | **OK** | Verified payload and persistence after reload. |
| K8 | 409 stale revision: error text | guidance/DiagnosisPanel.tsx:157-159,262-280 | guidance.spec (409) | **CHANGED** | Old: error text only. New: banner keeping edits with "Reload latest" / "Overwrite with my edits". Verified. Better. |
| K9 | Save state badge: Saved / Unsaved changes / Saving… / Taxonomy required / Save failed | guidance/DiagnosisPanel.tsx:172-182 | guidance.spec | **OK** | Verified all but Save failed. |
| K10 | Approvals made elsewhere refresh on focus/visibility; "New approvals available" while dirty | guidance/DiagnosisPanel.tsx:297-304 | cutover-catalog-refresh | **OK** | Spec covers keeping edits and the revision. |
| K11 | Approved examples per category (input/expected/output/note) | guidance/DiagnosisPanel.tsx:492-526 | guidance.spec | **OK** | Verified with an approved example (finding, item, metric). |
| K12 | Remove category with confirm | guidance/DiagnosisPanel.tsx:541-553 | - | **CHANGED** | Confirm kept; wording says it leaves the catalog on save (old: removed from this analysis). Fine. |
| K13 | Subcategory filter All / Approved only; per-tab pagination of details/examples | guidance/DiagnosisPanel.tsx:411-418 | - | **CHANGED** | Filter kept; no pagination (long lists scroll). |
| K14 | Read-only: banner, readonly fields, no add/remove, Save disabled | guidance/DiagnosisPanel.tsx:254-261 | guidance.spec (read-only) | **OK** | Verified. |

### L. Production rules and versions

| # | Old behaviour (source) | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| L1 | Version list: state badge (Live/Draft/Published), rule count, author, relative age | guidance/RulesPanel.tsx:174-203 | guidance.spec (rules) | **OK** | Verified. |
| L2 | Open a version (editable draft vs read-only), "Create a draft before editing" | guidance/RulesPanel.tsx:339-397 | guidance.spec | **OK** | Verified; "Create draft to edit" button on read-only versions. |
| L3 | Create draft from the selected version | guidance/RulesPanel.tsx:131-139 | guidance.spec | **OK** | Verified `POST analysis-rule-versions {from_version}`. |
| L4 | Add rule, edit, 700 ms autosave to the open draft, "complete every rule" validation | useDraftRules.ts, guidance/RuleEditor.tsx | guidance.spec | **OK** | Verified invalid state, `PATCH analysis-context` and "Draft saved". |
| L5 | Pending edit is saved when you leave | useDraftRules.ts:68-76 | - | **BUGGY** | Verified: typing a valid rule and switching to the Documents tab within 700 ms clears the timer on unmount and the rule is never saved (server still has 3 rules). |
| L6 | Rule search, select-all-filtered, bulk delete, per-rule delete | guidance/RuleEditor.tsx:35-90 | guidance.spec | **OK** | Present. |
| L7 | Deleting one rule / selected rules asks "Delete this rule?" / "Delete N rules?" first | guidance/RuleEditor.tsx:63-69,126-133 | - | **MISSING** | Verified: no dialog, the rule vanishes and autosaves (no undo). |
| L8 | Publish dialog with "Set as production" (default off) | guidance/VersionDialogs.tsx:36 | guidance.spec | **CHANGED** | Switch defaults ON, so Publish silently changes the live production version. Not logged. See fix list. |
| L9 | Promote a published version to production | guidance/RulesPanel.tsx:379-383 | guidance.spec | **OK** | Spec covers it; not re-driven (publish already made the version live). |
| L10 | Compare two versions (added / removed / changed / unchanged) | guidance/VersionDialogs.tsx:110-190 | guidance.spec | **OK** | Verified `1 added · 0 removed · 0 changed · 1 unchanged`. |
| L11 | Merge with conflict resolution (keep current / use incoming / custom) | guidance/VersionDialogs.tsx:200-336 | guidance.spec | **OK** | Spec covers merge; dialog verified. |
| L12 | Download version JSON (`analysis-rules-vN.json`: name, version, status, created_at, rules) | guidance/RulesPanel.tsx:144-151 | - | **CHANGED** | Verified `rules-v2.json`; `created_at` dropped. |
| L13 | Delete version with confirm; only when >1 live version and `can_delete` | guidance/RulesPanel.tsx:197-199,314-332 | guidance.spec | **OK** | Delete hidden for the production version. |
| L14 | Version history drawer with SVG lineage graph (parents + merge parents) | (none) | - | **MISSING** | Logged as NICE, not built (DESIGN_NOTES, OPEN_QUESTIONS 2026-10-12). List shows no parent info. |
| L15 | Selected-version metadata "Created at / Updated at / By" | guidance/RulesPanel.tsx:184 | - | **MISSING** | List shows author and relative time only; full timestamps gone. |
| L16 | Restore / permanent delete of deleted versions | (none) | - | **MISSING** | Logged (Q7); old had no visible UI either. |
| L17 | Rule sources: Add documents checkbox with count, Add examples picker (filters, char budget), Generate rules | guidance/RulesPanel.tsx:226-268, guidance/ExamplePicker.tsx | guidance.spec (generate rules) | **OK** | Verified picker with filters, "0 selected · 0 characters of 256,000", selection. |
| L18 | No usable source: exact reasons next to Generate rules | guidance/RulesPanel.tsx:121-129 | guidance.spec | **OK** | Same four messages. |
| L19 | Rule generation job: progress (LLM patches x/y), resume, failure text, summary "Used N documents and M examples" | useRuleGenerator.ts, guidance/RulesPanel.tsx:269-300 | guidance.spec | **CHANGED** | Phase badge + bar + Cancel/Dismiss and a toast; no patch counter and no used-sources summary. Verified a stub run produced draft v3 with one added rule. |
| L20 | Rule token estimate "N rules · ~T prompt tokens · no rule count limit" | guidance/RuleEditor.tsx:35-37 | guidance.spec | **OK** | Verified. |
| L21 | Generate/Analyze are blocked while the other LLM operation runs | (none) | - | **CHANGED** | Rules tab does not know about a running analysis job; both can run. Low risk. |
| L22 | Read-only rules: readonly fields, disabled create/generate, explanatory text | guidance/RulesPanel.tsx:57,376-389 | guidance.spec (read-only) | **OK** | Verified. |

### M. Documents

| # | Old behaviour (source) | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| M1 | Dropzone: choose or drop files, type/size hint | guidance/DocumentsPanel.tsx:122-147 | guidance.spec (documents) | **OK** | Verified hint text. |
| M2 | Accepted types include .text, .log, .rst | guidance/DocumentsPanel.tsx:34 | - | **MISSING** | `accept` omits those three; the OS picker greys them out. Minor. |
| M3 | Sequential multi-upload with status "Extracting N documents… / N project documents saved" | guidance/DocumentsPanel.tsx:100-112 | guidance.spec | **OK** | Verified `Added 1 of 1 document.` |
| M4 | Large document (>40 000 chars) confirm, then upload in full | guidance/DocumentsPanel.tsx:65-80,254-275 | guidance.spec | **OK** | Verified dialog and re-upload. |
| M5 | Unsupported file: error toast naming the file | guidance/DocumentsPanel.tsx:81-93 | - | **OK** | Verified `bad.exe: unsupported file type`. |
| M6 | Include/Exclude toggle per document (PATCH, revert on failure) | guidance/DocumentsPanel.tsx:192-205 | guidance.spec | **OK** | Verified `1 of 2 enabled`. |
| M7 | Delete document with confirm | guidance/DocumentsPanel.tsx:246 | guidance.spec | **OK** | Verified dialog "Delete document?". |
| M8 | Library meta: characters + "sent to analyzer in full" / "capped at storage limit" / "shortened when uploaded" | guidance/DocumentsPanel.tsx:185-190 | - | **CHANGED** | Characters plus "over the provider limit" only. |
| M9 | Budget line (selected characters) | guidance/DocumentsPanel.tsx:214 | - | **OK** | Verified. |
| M10 | Read-only members see the library only with an explanation | guidance/DocumentsPanel.tsx:158-162 | guidance.spec (read-only) | **OK** | Verified. |

### N. Cross-cutting

| # | Old behaviour (source) | New code | Spec | Status | Notes / evidence |
|---|---|---|---|---|---|
| N1 | Persisted preferences (localStorage/sessionStorage) | (none) | - | **OK** | Neither version stores any; verified by grep. |
| N2 | Console/page errors on the happy paths | - | a11y.spec (no console errors) | **OK** | None in any of my ~40 scripted flows. |
| N3 | Keyboard, focus rings, axe | - | a11y.spec | **OK** | Spec covers steps, tabs, dialogs, Escape. |
| N4 | Narrow layout, no horizontal scroll at 800 px | - | a11y.spec | **OK** | Spec; not re-measured. |
| N5 | Analyze and Test live on the Run step (old: sticky footer on the single page) | RunAnalyze.tsx:271-323 | run.spec | **CHANGED** | Guided flow by design (UX_DECISION). Users must leave Configure to run. |
| N6 | Last step shows a permanently disabled "Done" button | RunAnalyze.tsx:211 | - | **BUGGY** | On Review the footer primary button reads "Done" and is disabled. |
| N7 | `insights.js` / `item_reasons.js` | - | - | **OK** | Not part of this workspace (Models page and run-detail reasons); covered by their areas. |

## Fix list (ordered by user impact)

1. **major - All-failed job reported as success.** Repro: connection `bad-model`, Run step, Analyze. Expected (old): "Analysis failed - 0 of 6 metric analyses succeeded, 6 analyses failed", error toast. Actual: bar "6 of 6 metric analyses succeeded, 6 failed", Review card "Completed with errors · 6 of 6 metric analyses succeeded", toast "Analysis finished: 6 of 6 …" (info tone). Hint: `blocks/JobStatus.tsx:33-43` computes `analyzed` from `result.total_analyzed`, which counts failures; use `attempted - failed` (old `_analysisCompletionState`: failed = max(result.errors, total_analysis_failed, results with error)), add an "Analysis failed" title/danger tone when all failed, and use the same function for the toast in `RunShell.tsx:39`. Also default the error-code group to `analysis_error` instead of `error`. **FIXED (e6b07313)**
2. **minor - Pending rule edit is dropped when leaving the tab.** Repro: Rules tab, Add rule, type a title and instruction, click Documents within 700 ms, come back: the rule is gone (server never received it). Hint: `useDraftRules.ts:68-76` clears the autosave timer on unmount; flush (`flush(rulesRef.current)` when valid) in the cleanup and on `beforeunload`. **FIXED (65e04884)**
3. **minor - Diagnosis search desynchronises list and editor.** Repro: Diagnosis categories, search `lat`: list shows only Latency, editor still shows Hallucination (with its Remove category button); search `zzz`: empty list, no "no match" text, same stale editor. Hint: `guidance/DiagnosisPanel.tsx:122-123`: derive `active` from `visible` (fall back to `visible[0]`, render an empty state when `visible` is empty). **FIXED (65e04884)**
4. **minor - Timeout / Max issues fall to 1 when emptied.** Repro: clear "Timeout (s)" or type 0, blur, Test Selected: request carries `timeout_seconds:1` (old restored the default, 120 s, and project default 3 for max issues). Hint: `blocks/Targets.tsx:35-60` + `model/settings.ts`: on blur/empty restore `analysis_defaults.request_timeout_seconds` and `config.max_root_cause_categories`; guard in `analyzeRequest`/`testRequest`. **FIXED (60158858)**
5. **minor - Publish defaults to "Set as production".** Old default was off; one click now changes the live production rules for every future analysis. Hint: `guidance/VersionDialogs.tsx:36` `useState(false)` (or log the change as a decision if intended). **FIXED (65e04884)**
6. **minor - "View run" loses the sample.** Repro: repeat run, `?pass=2`, click View run (header, job bar, Review card): href has no `pass`. Hint: `blocks/RunHeader.tsx:65` and `blocks/JobStatus.tsx:109,174`: append `?pass=N` like old `selectedRunUrl`. **FIXED (e6b07313)**
7. **minor - Run opened under another project's slug is not redirected** (CUTOVER). Repro: `/projects/<project B>/analysis?run=<run of A>` renders A's run under B's header. Hint: compare `run.project_slug` (summary) with the route slug in `RunShell.tsx`/`AnalyzerPage.tsx` and `Navigate` to the right project. **FIXED (e6b07313)**
8. **minor - Unknown run error is mislabelled.** `/analysis?run=nope`: "Couldn't load the analyzer configuration" (the run-scoped config call fails first), no Open Runs link. Hint: `RunShell.tsx:87`: title "Unable to load auto-analysis" (or render the run query's error first) and add an Open Runs action. **FIXED (e6b07313)**
9. **minor - Delete rule has no confirmation** (single and bulk; old asked "Delete this rule?" / "Delete N rules?" and saved at once). Hint: `guidance/RuleEditor.tsx:63-69,126-133` wrap `remove()` in `ConfirmDialog`. **FIXED (65e04884)**
10. **minor - Read-only banner is wrong.** "running analyses needs project member access"; the rule is manager or the run's owner (`can_operate_analyzer`). Hint: `RunAnalyze.tsx:122`, reuse the old wording. **FIXED (60158858)**
11. **minor - Connections without a key are selectable. REOPENED (re-review).** Old disabled them and appended "· key missing". Hint: `blocks/RunBar.tsx:15-24`: map `llm_api_key_set` to `isDisabled` items and the suffix (not verified in the UI, code read only). **Label fixed (60158858), disabling NOT effective: see Re-review.**
12. **minor - Completion summary lost "Created N categories" and "Timeout retries: N".** Hint: `blocks/JobStatus.tsx:145-166` using `job.result.categories` and `job.result.retries`. **FIXED (e6b07313)**
13. **minor - Python-literal values cannot be path-mapped.** Input `"{'question': 'x', 'tables': ['a']}"` (a stringified dict, what `str(dict)` produces) shows no JSON tree. Hint: port `_tryParsePythonLiteralValue` (playground.js:1421-1486) into `model/mapping.ts:21` `tryParseJson`. **FIXED (60158858)**
14. **minor - Test result lost "Why this category".** `category_reason` / `root_cause_reason` are never shown. Hint: `blocks/TestResults.tsx` add a `<details>` per issue. **FIXED (60158858)**
15. **minor - Zero-target state lost the Open Reviews link** while the text still says to open Reviews. Hint: `blocks/Targets.tsx:86-99` add a `LinkButton` to `projectPath(slug, 'reviews')`. **FIXED (60158858)**
16. **minor - Timeout and Max-issues help is gone** (retries double the timeout, server cap). Hint: `help` text on the two NumberFields. **FIXED (60158858)**
17. **minor - Run-picker mode `?qym_analysis_run_picker=1` is gone.** Hint: either drop the landing's wording about it (already dropped) and log it in OPEN_QUESTIONS, or have the runs list honour the param. **DECIDED, not restored** (logged in decisions/analyzer/OPEN_QUESTIONS.md; no entry point left)
18. **minor - Rule version metadata and lineage.** "Created at / Updated at / By" and the lineage graph are gone (graph logged). Hint: show the three fields under "Rules in vN" (`guidance/RulesPanel.tsx:339-397`); parent ids are in `RuleVersion`. **FIXED (65e04884)**
19. **minor - Rule generation feedback.** No "x / y LLM patches" counter and no "Used N documents and M approved examples" summary. Hint: `guidance/RulesPanel.tsx:269-300` and the `onFinished` toast (`:97-105`). **FIXED (65e04884)**
20. **minor - Document upload `accept` omits `.text`, `.log`, `.rst`.** Hint: `guidance/DocumentsPanel.tsx:34`. **FIXED (65e04884)**
21. **minor - Disabled "Done" on the Review step.** Hint: hide the primary button on the last step or make it return to Configure (`RunAnalyze.tsx:211`). **FIXED (60158858)**
22. **minor - Cosmetic gaps.** Placeholder highlighting in the preview, per-target root-cause detail/confidence dot, document meta wording ("sent to analyzer in full"), window title without the run name, `scope` aliases not rewritten in the URL, `expected_pass_version` not sent when the run has no `pass_revision`. None needs more than a line each. **PARTLY FIXED** (window title with the run name: e6b07313; rest left, see Deferred)

## Re-review

Clean detached worktree of ui/qa f401fb88 (the working tree had other agents' uncommitted edits), `npm run build` ok, served on 8834 with the stub LLM on 9834, fresh seeded DB. Every FIXED row was exercised in the browser; 20 further OK rows were spot-checked in one script (legacy URL, picker and pass in URL, sample switch, `?metric=`, `{var}` rows with `{categories}` reserved, one preview request per edit, Test, Why this category with a mocked `category_reason`, cancel, reload-resume, no-connection, documents toggle/delete/large-file confirm, Diagnosis 409 banner, Include analyzed targets, 3-target limit, Arabic `dir=rtl`, scope alias, landing): all pass, no console errors beyond the intentional 409s.

Confirmed FIXED: all-failed job (bar "ANALYSIS FAILED · 0 of 6 metric analyses succeeded, 6 failed", Review card "Analysis failed", error code `analysis_error`, toast "Analysis failed: 0 of 6 …"); partial job ("COMPLETED WITH ERRORS · 4 of 6 … 2 failed", card with "Created 2 categories", "Timeout retries: 3", error-code group; mocked result); success card "Created 1 category"; Timeout/Max issues 0 or empty restore 120 / 3, 999999 clamps to 3,600, request carries `t=120 mi=3`; timeout help text present; rule typed then tab switch or sidebar navigation within 700 ms is saved on the server; Diagnosis search (`hall`, `know` show the matching category in the editor, `zzz` shows "No matching categories"); delete rule and bulk delete confirm ("Delete this rule?" / "Delete 2 rules?", Keep leaves it); Publish switch off by default; version metadata line "Created … · Updated … · By …"; generation shows "Used 3 documents and 0 approved examples. 1 writer call."; upload `accept` has `.text,.log,.rst`; Review step footer "Back to Configure" (no disabled Done); View run keeps `?pass=2`; wrong-project slug redirects to the run's project (query kept); unknown run "Unable to load auto-analysis … Open Runs"; Open Reviews link on the zero-target state; Python-literal input shows `opts / k / question / tables`; read-only banner uses the manager/run-owner wording; window title includes the run name.

### Still BUGGY

- **minor - Key-less connection is still selectable (fix list 11, row J1).** Repro: patch/obtain a connection with `llm_api_key_set:false`; Run step, open "LLM connection": the option reads "stub-slow-model · slow-model · key missing" but a normal click selects it and Test Selected / Analyze stay enabled. Cause: `blocks/RunBar.tsx:15-24` sets `disabled` on the items, but `ui/Select/Select.tsx:71-76` hands `disabledKeys` to the inner `ListBox`; inside a react-aria `Select` it must go on `AriaSelect` (`disabledKeys`), so the option has no `aria-disabled`. Also make `llmReady` (`workspace/useRunWorkspace.ts:131`) false when the selected connection has no key.

Not re-driven: re-analysing human labels, merge conflicts, Promote, real timeout-retry phase (unchanged from the first pass; specs cover them).

## Deferred

- Item 18, rule-version lineage graph (parent / merge-parent DAG): about 2 days (layout, merge parents, RTL, keyboard); logged as a drop. Created / updated / by are shown.
- Item 22, remaining cosmetics: placeholder highlighting in the preview (0.5 day), per-target root-cause detail and confidence dot in the target list (0.5 day), document meta wording ("sent to analyzer in full"), `scope` aliases not rewritten in the URL (kept: harmless), `expected_pass_version` sent only when the run has a `pass_revision` (kept: the server check covers runs that have one; logged).
- Item 17 / A13 `?qym_analysis_run_picker=1`: decided not to restore (no entry point in the new UI; the runs list has per-row Analyze chips). Logged.

## Could not verify, and why

- Re-analysing **human** labels by hand: the API cannot produce a human-source diagnosis (approving an AI diagnosis keeps `source: ai`), so I relied on `run.spec` "re-analyze human labels (9)" and `targets.test.ts`.
- **Merge with conflicts** and **Promote** were not re-driven by hand (merge dialog and compare were; publish made v2 live directly). `guidance.spec` covers both.
- A connection **without an API key** could not be created through the API, so the "key missing" row is from code only.
- Timeout-retry phase of a real job (the stub never times out) and the transient "Cancelling…" state (the stub cancels instantly): covered by the mocked specs only.
- Analysis results inside run detail and compare were checked at API level only; rendering belongs to those areas' QA.
- Compare's per-run Auto-Analyze links were read in code, not clicked.
- RTL for the whole workspace and the 800 px layout: relied on `a11y.spec` (only the Arabic targets were re-checked, `dir=rtl`).
