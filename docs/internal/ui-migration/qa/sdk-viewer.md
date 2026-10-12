# QA: SDK local results viewer (brief 10)

Area: brief 10 (standalone UIs), SDK half only. There is no platform here. OLD = the vanilla viewer at `7814183`
(`packages/sdk/qym/_static/ui/*`, served by the old `UIServer` for live data and by the old `DashboardServer` for
saved files, run from `qym-wt-legacy` on :8828; nothing in the old SDK instantiated either server, so the old
live run was driven by feeding snapshots into the old `UIServer`). NEW = `frontend/src/sdk-viewer` built with
`npm run build:sdk` (rebuilt for this QA: app.js 171,018 B, app.css 18,245 B), served by `qym ui FILE` and by a real
`Evaluator` with `local_ui=True`, from the cutover worktree on :8838. Data: a real evaluation run with the SDK from
the repo venv, built on `examples/csv_dataset_eval.py` (its `my_task` and `exact_match`) plus a `length_ok` metric with
metadata and the built-in `fuzzy_match`: 30 items, 28 done and 2 failed (a timeout and a runtime error), Arabic
rows, a 1.8 KB output, `<b>`/`=SUM()` strings, latency 0.2 to 2.4 s, concurrency 4. The same CSV was converted to
`.xlsx` and replicated to 2,100 rows for windowing. Server code is identical in both trees for reading
(`run_discovery.py` unchanged), so a difference in what a file shows is a viewer difference.
Verification: ad-hoc Playwright scripts (axe-core injected), `curl`, the `qym` CLI with a pty. Screenshots stayed
outside the repo. The repo's own `e2e:sdk` suite (33 specs, needs ports 8818-8820) was not re-run.
Paths are relative to `frontend/src/sdk-viewer/` unless a full path is given. Status: OK / CHANGED (acceptable unless
noted) / BUGGY / MISSING. "code" in Verified means read from source only.

Note on the task wording: there is no `ui=True` or `ui_port` on `Evaluator(...)` itself and `--no-ui` no longer
controls any viewer. The shipped switches are `EvaluatorConfig(local_ui=True, ui_port=N, local_ui_open=...)`,
`qym run create --local-ui [--ui-port N] [--no-open]`, `qym ui [FILE] [--port N] [--results-dir D] [--no-open]`;
`--no-ui` only hides the terminal table. `python -m qym` does not exist (no `__main__`), so the server was started
through the `qym` entry point.

## Summary

Total rows: 118. OK 69, CHANGED 26, BUGGY 15, MISSING 8.
(Deliberate drops that were replaced by something equivalent are CHANGED; deliberate drops with no equivalent are
MISSING. The standalone-uis OPEN_QUESTIONS.md logs the layout/column decision but not the individual drops below, so
"logged" is stated per row.)

The viewer works end to end: live run (counts, ribbon, elapsed, percentiles), saved csv, search/filter/sort with URL
state, detail with an LCS diff, copy, CSV edit, export, reconnect banner, 171 KB offline bundle with no external
URL, and no axe violations above "moderate". The real defects are around it: silent failure of `--local-ui` when the
port is taken, a traceback from `qym ui` on a busy port, edit controls that cannot save (file outside the results
dir, any xlsx), the in-app docs that still describe `--no-ui` as the web UI, and the dropped Min latency, error
classes, metric-meta columns, edited badge and column controls.

## Table

### A. Live run (SSE, `Evaluator(local_ui=True)` / `--local-ui`)

| # | Old behaviour | New code | Status | Verified |
|---|---|---|---|---|
| A1 | Page loads at `/`, fetches `api/run` + `api/snapshot`, opens `EventSource('api/rows/stream')` | `lib/use-viewer-data.ts:449-487`, `lib/source.ts:573-574` | OK | Live: 30 rows from first paint, no console output |
| A2 | Stat cards Completed / In Progress / Failed / Pending | `components/Summary.tsx:79-86` ("N / total finished" + legend dots with the four counts) | CHANGED: same four counts, as a legend instead of cards; acceptable | Live samples: 8/30, 14/30, 19/30, 25/30, 30/30 with 4 running while queued |
| A3 | Completion % progress bar (`success_rate`) | `Summary.tsx:110-128` ribbon, one cell per row (colour = status), arrow keys, Enter opens | CHANGED: bar of percent replaced by a per-row ribbon; failures visible at once; acceptable and better | Live + file; 2,100 cells in the big file stay responsive |
| A4 | Elapsed chip, 1 s timer from `run.started_at`, stops when pending=in_progress=0 | `Summary.tsx:9-20`, `components/format.ts:48-52`, freeze via `finished` + `ended_at` | OK; fixes an old bug: the old viewer showed "Elapsed 3h 0m 5s" at second 5 on a UTC+3 machine (naive UTC string parsed as local) | Live: 0:02, 0:05, 0:08, 0:11, frozen at 0:13 after done; old: 3h 0m 5s |
| A5 | Dataset / Run / Concurrency / Timeout chips | `App.tsx:57-105` Dataset, Run, Model, saved file name; no Concurrency or Timeout | MISSING (config chips); not logged; low value | Header text on live and file |
| A6 | Header status | `App.tsx:60-75` badge Waiting / Live / Reconnecting / Completed / Stopped / Saved file / Unavailable (old had none) | OK (new) | Live: LIVE then COMPLETED |
| A7 | `done` event: one final `api/snapshot`, stop timer, close stream | `use-viewer-data.ts:439-447, 481` (`finish()` refetches run and snapshot) | OK | Live: COMPLETED + frozen timer; stays correct after the evaluator process exits |
| A8 | `es.onerror`: refetch once and stop; nothing visible | `use-viewer-data.ts:482-486`, `App.tsx:229-238`: "Reconnecting" badge, warning banner with Reload, error banner if closed | OK (new) | `kill -9` of the evaluator mid-run: banner "Lost the connection..." within 2.5 s, stays with Reload |
| A9 | Elapsed after the evaluator died | Timer keeps ticking while "Reconnecting" (`Summary.tsx:13-16` only stops on `finished`) | BUGGY (minor): elapsed counts on for a run that is gone | Observed while the banner was shown |
| A10 | First snapshot before `api/run` resolves is parked | `use-viewer-data.ts:468-476` refetches `api/run` if the dataset name was empty | OK | code |
| A11 | Fetch failures swallowed, page stays empty | `App.tsx:128-141` full error "Cannot load this evaluation" with Try again; `source.ts:552-571` maps network and HTTP errors | OK (new) | code + e2e spec in repo (`live.spec.ts:100`) |
| A12 | Empty state (no rows yet) | `App.tsx:143-160` "Connecting..." / "Waiting for the first row" (live) / "This results file has no rows" | OK | `qym ui` with no file shows the waiting text |
| A13 | Row update per snapshot, whole DOM rebuilt | Full snapshot per event, React diff; server throttles to one publish per 0.3 s (`server/live.py:20-45`) | OK (new) | Live run, no flicker, selected row kept |
| A14 | Rich markup remnants (`[dim]pending[/dim]`) stripped client side | Not stripped client side; `core/progress.py:224` strips tags from `output_full` server side | CHANGED: input/expected with literal `[red]` tags would show raw (correct for real text) | code |
| A15 | In-progress / pending rows | `components/RowList.tsx:116-118` blank output, metric cells "N/A", badge | OK | Row rendering in mid-run screenshot data (4 running) |
| A16 | Live run shows no score edit | `App.tsx:172` `canEdit` only for `mode==='file'` | OK | Live detail: 0 score inputs |
| A17 | Trace id in the live drawer | `Detail.tsx:255-271` | OK | Live and file rows show the trace id with Copy |
| A18 | Old viewer had no "Stopped" or interrupted state | `run.status` STOPPED -> badge "Stopped" (`App.tsx:63-68`) | OK (new) | code; interrupt path not exercised |
| A19 | `Evaluator.run()` ends the server | Python API: server is never stopped by the evaluator (`core/evaluator.py:2014-2025` only calls `finish()`); the viewer dies with the process. CLI path stops it via `_hold_local_viewer` | BUGGY (minor): see fix list F5 | Two sequential `Evaluator(local_ui=True, ui_port=8838)` runs in one process: run 1 holds the port forever |

### B. Saved file mode (`qym ui FILE`, `/run/<encoded path>`)

| # | Old behaviour | New code | Status | Verified |
|---|---|---|---|---|
| B1 | `/run/<url-encoded path>` of `.csv`/`.xlsx`, multi-pass decode | `lib/source.ts:7-17` single decode; CLI builds `run/<quote(path, safe='')>` (`cli/app.py:115`) | OK | csv and xlsx both load, 30 rows |
| B2 | Title "قيِّم - dataset / run (Historical)" | `App.tsx:174-179` "(Saved)" | CHANGED (word); fine | Title read in browser |
| B3 | Error: page blank, `console.error` only; server answered 200 `{error}` | `App.tsx:128-141` + server 404/400 with message and the path | OK (new) | Missing file: old = empty tables, console error; new: "Results file not found" (e2e) |
| B4 | Non-results path | Server only serves `.csv`/`.xlsx` (`server/app.py:174-183`), 400 with a message | OK (new) | `qym ui a.txt` exit 2 |
| B5 | Historical polling when `run.status==RUNNING` (never fired) | None; file is read once | CHANGED: acceptable (old path was dead) | code |
| B6 | Run header for a file | Dataset, run, file name (title attr = full path), "Saved file" badge | OK | Header text |
| B7 | xlsx loads | Loads | OK | `e_new.xlsx` 30 rows |
| B8 | A file outside the results dir | Reading works; editing fails (see D6) | BUGGY | see D6 |

### C. Table: search, filter, sort, columns, paging, URL state

| # | Old behaviour | New code | Status | Verified |
|---|---|---|---|---|
| C1 | Search box over input/output/expected substring, case-insensitive | `App.tsx:257-264`, `lib/table-model.ts:20-31` | OK | "Paris" 4 rows; Arabic expected "الرياض" 4 rows; `<b>` text matched, no bold element rendered |
| C2 | Search debounced? no | Live URL update per keystroke through `replaceState` | OK | Same |
| C3 | Status filter all/completed/in_progress/error/pending (custom dropdown + hidden select) | `App.tsx:265-276` native select; labels All statuses / Done / Running / Error / Pending | OK | Error filter: 2 of 30 rows, both failures |
| C4 | Row count text "Page X of Y, a-b of N" | `App.tsx:277-279` "N of M rows" | OK | `30 of 30 rows` -> `4 of 30 rows` |
| C5 | Rows per page 25/50/100/200 + Prev/Next | `RowList.tsx:11,23-30,141-150` windowed 200 at a time with "Show N more" | CHANGED: logged in OPEN_QUESTIONS (windowing); acceptable. Selected row beyond the window auto-expands it | 2,100 rows: 200 in DOM, +200 on click, `?row=1500` opens "Row 1501", load 441 ms, sort 304 ms |
| C6 | Sort by clicking any header, default index asc; status rank; metric numeric | `RowList.tsx:68-83`, `table-model.ts:33-53`; aria-sort | CHANGED: sortable columns are #, Status, metrics, Time; Input/Output/Expected not sortable; null last in both directions; default latency desc | fuzzy_match asc: 0,0,0,0.007...; Time desc: 2.39 s, 2.36 s... |
| C7 | Sort state | `sort`/`dir` in URL | OK (new) | `?sort=metric%3A2&dir=asc` |
| C8 | Columns menu (show/hide each column incl. metric sub-columns) | None | MISSING: not logged; layout decision made columns fixed | `RowList.tsx:92-99` fixed header |
| C9 | Drag to reorder columns | None | MISSING (nice to have, not logged) | code |
| C10 | Drag to resize columns (min 48 px) | None; headers truncate: "STAT...", "EXACT...", "LENGT...", "FUZZY..." at 1440 px | MISSING + BUGGY (minor): metric names unreadable in the header; `title` carries the full name but a sighted user sees only "FUZZY..." | Screenshot at 1440 |
| C11 | Expected column in the table | Not in the list; only in the detail pane | CHANGED: logged in UX_DECISION ("answers only in detail"); acceptable | Screenshot |
| C12 | `metric_meta` sub-columns (e.g. `length_ok_reason`) | Only in the detail | MISSING: not logged | Old table had `length_ok_reason`; new list has none |
| C13 | Output column shows the text; `title` holds the full text | Clamped text, no `title` | CHANGED: full text only via detail | code |
| C14 | Sticky header | `RowList.module.css` sticky | OK | Scrolling list |
| C15 | Metric cell colouring yes/no/na | `lib/metric-cell.ts`, `RowList.tsx:23-33`: neutral text + a dot (green 1, amber 0, none for scores) | CHANGED: logged (neutral colours); acceptable. Note an exact `0` for a score the user cares about (exact_match) is amber, not red | Screenshot |
| C16 | Metric values formatted raw (`0.06521739130434782`) | Rounded to 3 decimals in list (`formatScore`), full value in detail | CHANGED (better) | List 0.065; detail 0.06521739130434782 |
| C17 | Status badge | `StatusBadge.tsx` DONE / ERROR / RUNNING / PENDING | OK | Screenshot |
| C18 | Time column raw seconds (`0.2657231210032478`) | "266 ms", "1.22 s", "2m 3s"; 0/null -> an em dash | OK (better) | Time column |
| C19 | No URL state | `?q=&status=&sort=&dir=&row=`, invalid values fall back to defaults; `replaceState` so Back leaves the viewer rather than undoing a filter | CHANGED (new); Back-button granularity is a minor trade-off | `?sort=bogus&status=zzz&row=abc&dir=up` loads 30 of 30; after navigating, `goBack` returned to the previous page |
| C20 | "Reset view" | `App.tsx:280-284`, "No rows match" + Clear filters (`313-318`) | OK (new) | Seen |
| C21 | No persisted preferences (no localStorage) | Same | OK | grep: no storage use |
| C22 | RTL / Arabic in cells | `textDirAttrs` per cell and block | OK | Arabic input right-aligned in list and detail; mixed Arabic/English output renders with the bidi quirk typical for auto direction |
| C23 | Number/date formatting | `format.ts`, `stats.ts` | OK | see C18, A4 |

### D. Row detail

| # | Old behaviour | New code | Status | Verified |
|---|---|---|---|---|
| D1 | Click row opens an overlay drawer (`role=dialog`, no Escape, no focus trap) | `App.tsx:300-340` persistent right pane `<article>`; row selection in `?row=`; Escape closes and returns focus to the row; Close button | CHANGED (better) | Mouse-open then Escape: focus on `TR:2`; keyboard: Tab, Enter, Escape |
| D2 | Input / Output / Expected `<pre>` with copy buttons (flip to check mark 900 ms) | `Detail.tsx:13-58` Copy -> "Copied" 1.5 s, "Copy failed"; clipboard fallback `format.ts:11-31`; collapse/expand over 700 chars | OK | Clipboard equals full input text |
| D3 | Show Diff: positional word pairing, `<del>` in output / `<ins>` in expected | `lib/diff.ts` LCS word diff, expected shows deletions, output shows insertions, capped at 1,500 tokens; disabled for error rows or empty expected | CHANGED (better, direction swapped) | Row with differing text: 2 `ins`, 0 `del` |
| D4 | Diff when the same text | n/a | OK | code |
| D5 | Trace: id or "Trace available" or N/A; copy trace | `Detail.tsx:255-271`; id + Copy; "Trace available" if only a URL; em dash | OK (parity). Neither version links `trace_url`; the link is the obvious improvement | Trace id + Copy shown; `trace_url` is empty in saved csv so the URL case is code-only |
| D6 | Latency "0s" for a 266 ms item | `Detail.tsx:243-247` "266 ms" | OK (old bug fixed) | Old drawer showed `Time 0s` |
| D7 | Metrics: `<name>_score` + each meta field as `<name>_<field>` rows | `Detail.tsx:197-232` `<name>` + meta rows `key value` (e.g. `reason too long: ...`) | OK | length_ok reason shown |
| D8 | Failed row: shows error text in output | `Detail.tsx:175-181`: red callout with the message; Output block hidden; metrics read N/A | OK (better) | Row 22: callout "Error. ERROR: TaskExecutionTimeoutError..." |
| D9 | Item id | Shown (`Detail.tsx:272-279`) | OK (new) | Seen |
| D10 | Latency in the detail for rows with `latency_ms` 0 | em dash | OK | code |
| D11 | `body.no-scroll` while open | Not needed, pane | OK | n/a |
| D12 | Close by backdrop click | No backdrop | CHANGED | n/a |
| D13 | Detail for rows beyond the window | `RowList.tsx:24-27` expands the window | OK | `?row=1500` |
| D14 | Selected row filtered out | Detail stays; ribbon cell dims (`data-dim`) | OK | code |

### E. Score editing (file mode)

| # | Old behaviour | New code | Status | Verified |
|---|---|---|---|---|
| E1 | Edit toggle per metric, text input, Save -> `POST api/runs/update_metric`, "Saving..." / "Saved" / "Error" | `Detail.tsx:60-134` labelled input, dirty-aware Save, Cancel, aria-live status "Saved to the results file" or the server message | OK (better) | csv: 0.0 -> 1 then 1.5; row cell and the summary mean update (0.143 -> 0.179) |
| E2 | Validation: none (any text) | Non-numeric disabled with "Enter a number"; empty = n/a | OK | `abc` -> "Enter a number", Save disabled |
| E3 | Out-of-range score (1.5) | Accepted and written | CHANGED: no 0..1 check in either version; note only | `1.5` saved |
| E4 | "Edited" badge next to the metric and "Modified - original: X" note | Not present. After an edit the detail shows two raw meta rows `modified true` and `original_score 0.0`; the list shows nothing | MISSING (badge, readable original note); data is shown raw; not logged | After saving: `exact_match 1.5`, `modified true`, `original_score 0.0` |
| E5 | Edit offered when `file_path` known | Offered for every file row that did not fail, including xlsx | BUGGY: see E6 | |
| E6 | xlsx edit | Controls shown, Save returns "XLSX runs are read-only" (old: "Error") | BUGGY (minor): controls should be hidden or disabled for `.xlsx` | Observed on `e_new.xlsx` |
| E7 | File outside the server's `--results-dir` (default `qym_results` under the cwd) | Reading works, editing returns "Access denied" for a file the user just opened with `qym ui FILE` | BUGGY (minor): `qym ui` should derive the results dir from FILE or hide edits | `qym ui <path outside cwd>/x.csv`, edit -> "Access denied" (seen with a file in `edit/`) |
| E8 | Audit columns written to the csv | `<metric>__meta__modified`, `<metric>__meta__original_score` | OK (server unchanged) | csv header checked |
| E9 | Error rows editable (old inputs prefilled with 0) | No inputs for failed rows; empty input placeholder "n/a" for missing scores | OK (UX_DECISION must-fix) | Row 22 no inputs |
| E10 | Reload after edit | Value persists; `?row=0` restores the open row | OK | Reload |

### F. Export

| # | Old behaviour | New code | Status | Verified |
|---|---|---|---|---|
| F1 | Export CSV of filtered rows and visible columns, `qym_<dataset>_<run>.csv`, `*_full` values | `App.tsx:286-298`, `table-model.ts:77-98`; same filename pattern, filtered rows, UTF-8 BOM, CRLF | OK | `qym_qa.csv_qa-sdkviewer-demo-model-261012-1830.csv`; filtered export of "SUM" = 2 rows |
| F2 | Columns exported | `index,status,input,output,expected,<metrics>,latency_ms`; old also exported metric meta columns (`length_ok_reason`, `exact_match_modified`, `exact_match_original_score`) and Time in seconds | CHANGED + MISSING: judge reasons and edited-score audit data are not in the export; trace id and item id absent in both | Old export header vs new header |
| F3 | Formula injection | New prefixes `'` to leading `= + @` (`table-model.ts:84-88`); old did not | OK (better). Note a leading `-` (negative numbers, "-5") is not escaped; fine for numbers | `'=SUM(A1:A2)` in export |
| F4 | Export with zero rows | Button disabled | OK | code + e2e |
| F5 | Metric header names in export | `exact_match` (old `exact_match_score`) | CHANGED: a script reading the old export by `_score` header breaks | |

### G. Summary, latency, errors, metrics panels

| # | Old behaviour | New code | Status | Verified |
|---|---|---|---|---|
| G1 | Latency Min / P50 / P90 / P99 / Max over completed rows | `Summary.tsx:97-109` P50 / P90 / P99 / Max, 2 decimals ("1.36 s") | CHANGED: Min dropped (not logged), precision better (old rounded to whole seconds: "P50 1s") | New: P50 1.36 s, P90 2.08 s, P99 2.38 s, Max 2.39 s; old: Min 213ms, P50 1s... |
| G2 | Percentile maths | `lib/stats.ts:15-25` same linear interpolation; rows with 0/null latency excluded | OK | Values match old after rounding |
| G3 | Error counters Timeout / Runtime / Unknown / Metric (substring heuristics on output) | None; failures are red ribbon cells, the Failed legend count and the Error filter | MISSING (counters), CHANGED in spirit: the heuristic was weak (old showed "Metric 2" for two failed rows) | Old quickbar: Timeout 1, Runtime 1, Unknown 0, Metric 2 |
| G4 | Metrics panel: sparkline of running mean per snapshot (flat line in files) | Mean per metric as numbers (`Summary.tsx:87-96`), 3 decimals | CHANGED (better, honest); old showed 14% / 51% / 22% | New: 0.143 / 0.507 / 0.217 (matches) |
| G5 | Quick bar duplicated the overview panel | One set | OK | |
| G6 | Mean excludes N/A and failed rows | `metricMeans` only numeric cells | OK | |

### H. Page, bundle, offline, a11y

| # | Old behaviour | New code | Status | Verified |
|---|---|---|---|---|
| H1 | Assets: app.js 53 KB + app.css 26 KB + index.html 8 KB + two PNGs (927 KB, 613 KB) = 1.6 MB | `_static/ui/` index.html 0.56 KB, app.js 171,018 B (gzip 56 KB), app.css 18,245 B (gzip 4 KB), favicon.svg 240 B, about 189 KB | OK (better) | `ls -la` after `npm run build:sdk`; `bundle.spec.ts` enforces < 300 KB |
| H2 | No external URLs | Only the React error-decoder string and XML namespaces inside the bundle; no webfonts, no CDN; a full session only requested 127.0.0.1:8838 | OK | Request log of a file session, grep of app.js |
| H3 | Keyboard: none | Skip link, ribbon (one tab stop, arrows/Home/End), table (roving tabindex, arrows, PageUp/Down, Home/End, Enter/Space), Escape closes | OK (better) | Tab order: skip > ribbon > search > status > export > 6 headers > first row |
| H4 | axe | Zero serious/critical in list, detail (done row), detail (error row), detail with diff, empty state. Moderate: `landmark-one-main`, `region` (content outside landmarks), `page-has-heading-one` (file/live pages have only "Row N" h2, the `h1` exists only in the empty/error states), and `skip-link` in the empty state (target `#rows` absent) | BUGGY (minor): add a `<main>` and an h1 (visually hidden is fine); the repo spec only fails on serious | axe-core 4.x injected |
| H5 | Light theme (dead CSS) | Dark only | OK | code |
| H6 | Responsive | No horizontal page scroll at 1440, 1024 and 390 px. At 390 px the Input and Output columns are cut and the list scrolls inside; chips truncate | CHANGED: desktop tool, acceptable | `scrollWidth == innerWidth` at 1024 and 390 |
| H7 | XSS: old interpolated row text into `innerHTML` | React text nodes; diff renders `<ins>/<del>` elements, not HTML; `<b>HTML</b>` input shows literally | OK (better) | `<b>` rows: 0 bold elements in the table |
| H8 | Server serves the page for `/`, `/index.html`, `/run/*`; unknown static 404 JSON | `server/app.py:150-165` | OK | `curl` / and /run/... 200 |
| H9 | Static dir resolution `$QYM_STATIC_DIR`, packaged dir | `server/app.py:104-123`; `has_viewer()` | OK | code |
| H10 | A wheel built by CI has no viewer (no `npm run build:sdk` step, Node 22 vs 24) | `qym ui` then prints "The local viewer is not built in this install" (exit 1) | CHANGED: logged in OPEN_QUESTIONS as unresolved pipeline gap; `qym run create --local-ui` has no such guard (code only: `Evaluator` starts the server regardless of `has_viewer()`) | code |

### I. CLI and Evaluator entry points

| # | Old behaviour | New code | Status | Verified |
|---|---|---|---|---|
| I1 | `qym ui FILE` did not exist (`qym dashboard` opened the platform) | `cli/app.py:76-120` | OK (new) | Opens, prints URL, exits 0 on Ctrl+C |
| I2 | Missing file | `output_error("not_found")`, exit 3 | OK | exit=3 |
| I3 | Not csv/xlsx | exit 2 with a message | OK | exit=2 |
| I4 | `--json` | prints `{"viewer_url": ...}`, then serves until killed (an agent must not wait for it) | CHANGED: acceptable but undocumented | `timeout 3` exit 124 |
| I5 | Busy `--port` | Raw Python traceback ending `OSError: [Errno 98] Address already in use`, exit 1 | BUGGY (minor): catch `OSError` and use `output_error` | Reproduced with `http.server` on 8838 |
| I6 | URL printing | Rich wraps the long `/run/<encoded path>` URL at the terminal width when output is not a tty (broken across lines), so it cannot be copied from a log | BUGGY (minor): print with `soft_wrap=True`/`markup=False` | Seen in the first run (80 columns) |
| I7 | `qym ui` with no file | Serves an empty live viewer: "Waiting for the first row ... updates by itself" and a LIVE badge though no run can ever arrive | BUGGY (minor): say "No evaluation is running. Open a results file with `qym ui FILE`" | Seen |
| I8 | `--results-dir` | Honoured for edits (see E7) | CHANGED | |
| I9 | `qym run create --local-ui [--ui-port N]` | `cli/run.py:99-100,258-264`; prints `Local viewer: URL`, opens the browser unless `--no-open`/`--quiet`/`--json`; in a pty holds the viewer open ("Viewer still running ... Ctrl+C"), without a tty it stops right after the run | OK | pty: viewer answered 200 and run.status COMPLETED while held; non-tty stops |
| I10 | `--ui-port` alone (old: parsed and dropped) | Still silently ignored without `--local-ui` | CHANGED: unchanged old behaviour; help says "Port for --local-ui" | |
| I11 | Busy `--ui-port` with `--local-ui` | The run proceeds and the viewer is silently disabled: the warning goes only to `_notify_observer("on_warning")` (`core/evaluator.py:1219-1223`), the CLI prints nothing | BUGGY (major for the flag's purpose): the user asked for a viewer and gets no viewer and no message | Busy port, normal and `--quiet`: no output about the viewer |
| I12 | `EvaluatorConfig(local_ui=True, ui_port=N)` / `evaluator.local_ui_url` | `core/config.py:112-114`, `evaluator.py:1200-1225` | OK | `local_ui_url` set |
| I13 | Two evaluators in one process with a fixed `ui_port` | First never releases the port, second silently has no viewer (`local_ui_url=None`, no message) | BUGGY (minor): see I11 and A19; multi-model runs hit this | `two_runs.py`: RUN 1 local_ui_url=None |
| I14 | `live_mode='local'` | Deprecated no-op with a warning mentioning `local_ui` | OK | code |
| I15 | `--no-ui` | Hides the terminal table only (help: "Hide the live terminal table") | OK | `--no-ui --quiet` run |
| I16 | `python -m qym` | Not available | CHANGED: no `__main__`; only the `qym` entry point | `No module named qym.__main__` |
| I17 | `qym run create` crashed (`show_progress` kwarg) at the foundation commit | Fixed (logged) | OK | Run completed from the CLI |

### J. Docs that describe these paths

| # | Old behaviour | New code | Status | Verified |
|---|---|---|---|---|
| J1 | `docs/USER_GUIDE.md` | New "Local results viewer (offline)" section is accurate for `--local-ui`, `--ui-port`, `--no-open`, `qym ui`, edit, URL params, build and dev (`dev:sdk` 5808 -> 8818) | OK | Compared with behaviour above; the claim that the viewer "stays up until Ctrl+C" holds only with a tty (stated) |
| J2 | In-app docs `frontend/src/features/docs/partials/sdk-guide/config.html:298-299` | Still: `--no-ui` "Disables the local web UI" | BUGGY (minor): stale, contradicts the CLI help; logged as left for the admin-docs branch | grep |
| J3 | `partials/developer/cli.html:102-104` | `--no-ui` "Disable the local results table / web UI output", `--ui-port` "Port for the local web UI", no `--local-ui`, no `qym ui` | BUGGY (minor): stale and incomplete | grep |
| J4 | `partials/sdk-guide/multi-model.html:110` | Example uses `--no-ui` | OK-ish (flag still valid) | grep |
| J5 | `AGENTS.md:15` | Says `server/` holds "local UIServer + DashboardServer" (removed) and `utils/` "HTML/HTTP frontend helpers" (none exist); the CLI list has no `qym ui` and no `--local-ui` | BUGGY (minor): update | `AGENTS.md` |
| J6 | `EvaluatorConfig` fields in the SDK config reference (`sdk-guide/config.html`) | `local_ui`, `local_ui_open`, `ui_port` not documented | MISSING (minor) | grep for `local_ui` in `frontend/src/features/docs` returns nothing |

## Fix list

Ordered by user impact.

1. **I11 (major) `--local-ui` silently disabled when the port is taken.** Repro: occupy 8838 (`python -m http.server 8838 --bind 127.0.0.1`), run `qym run create ... --local-ui --ui-port 8838 --no-open`: the run finishes, no viewer, no message (also with `--quiet`). Hint: in `core/evaluator.py:1219-1223` print a `console` warning (and fall back to port 0 when a fixed port is busy, or raise a usage error from the CLI before the run starts). Add a CLI test next to `tests/sdk/test_local_viewer.py`.
2. **I13 / A19 (minor-major) The evaluator never releases the viewer.** Two `Evaluator(local_ui=True, ui_port=N)` runs in one process: the second has no viewer, `local_ui_url` None, no message. Hint: stop (or `close()`) the previous `UIServer` when a new run starts, or keep one server per process; at least warn. Document that a Python script must stay alive to keep the viewer (J1 only says so for the CLI).
3. **E6 / E7 (minor) Score editing offered where it cannot work.** `.xlsx` ("XLSX runs are read-only") and files outside the server's `--results-dir` ("Access denied", cryptic) show Save and fail. Hint: have `/api/runs/<path>` return `editable: bool` in `run` (`server/app.py:_run_file`, checks mirror `update_metric`), and `Detail.tsx:172` use it; or default `--results-dir` to the parent tree of FILE in `cli/app.py:76`.
4. **E4 (minor) Edited scores are not marked.** After an edit the pane shows raw `modified true` / `original_score 0.0` rows and the list shows nothing. Hint: in `Detail.tsx:197-232` hide those two meta keys and render an "Edited" badge plus "Original: X"; add a marker dot in `RowList.tsx` Cell.
5. **F2 / C12 (minor) Export drops judge reasons and audit columns.** Hint: `rowsToCsv` (`lib/table-model.ts:77`) append `<metric>_<key>` columns from `metric_meta`, and `trace_id`, `item_id`.
6. **C10 (minor) Metric headers unreadable ("EXACT...", "LENGT...", "FUZZY...", "STAT...").** Hint: `RowList.module.css` give metric columns a min width of the name or let the header wrap/ellipsis in the middle; truncated names are a legibility regression versus the old resizable columns.
7. **I5 (minor) `qym ui` on a busy port prints a traceback.** Hint: wrap `server.start()` in `cli/app.py:96` with `except OSError` -> `output_error("failure", ...)`, exit 1.
8. **I6 (minor) The viewer URL wraps in non-tty output.** Hint: `err_console.print(..., soft_wrap=True)` in `cli/app.py:112` and `core/evaluator.py:1214`.
9. **H4 (minor) Landmarks and heading.** Add `<main>` around the body, an `h1` (visually hidden: the run name) on loaded states, and make the skip link target exist when empty or hide it (`App.tsx:218-227`).
10. **I7 (minor) `qym ui` with no file waits forever.** Show "No evaluation is running here. Open a results file: `qym ui FILE`" when the live run block stays `{}` (needs the server to say it has no live run, for example `api/run` -> `{"live": false}` when `run_info` empty and the evaluation never registered).
11. **J2 / J3 / J5 / J6 (minor) Stale docs.** Update `sdk-guide/config.html:298-299`, `developer/cli.html:102-104` (add `--local-ui`, `qym ui`, fix `--no-ui`), `AGENTS.md:15` and its CLI section, and document `local_ui`/`local_ui_open`/`ui_port` in the config reference.
12. **G1 (minor) Min latency dropped.** Re-add "Min" to the latency list (`Summary.tsx:98-105`; `latencySummary` already returns it).
13. **A9 (minor) Elapsed keeps ticking while "Reconnecting".** Hint: pass `finished || connection==='reconnecting'` to `useElapsed` (`Summary.tsx:26`).
14. **A5 / G3 (low) Config chips and error-class counters.** Optional: Concurrency/Timeout chips in the header; a small "Timeout N, Runtime N" breakdown only if the SDK ever emits a structured error kind (the substring heuristic is not worth reviving).
15. **C8 / C9 (low) No column show/hide/reorder.** Logged by the layout decision as dropped; only worth restoring if the metric list grows (many metrics clip the list, see C10).
16. **D5 (low) `trace_url` is never a link.** Render an anchor when `trace_url` is non-empty (`Detail.tsx:262-270`); live Langfuse runs carry it.

## Not verified

- The repo's own `npm run e2e:sdk` suite was not re-run (ports 8818-8820 belong to its fixture); the 33 specs are claimed green in CUTOVER.md.
- The interrupted/"Stopped" run path and a live run with `trace_url` populated (needs Langfuse); both are code-read only.
- Exit code of the `--local-ui` hold after Ctrl+C in a pty: the viewer stayed up and answered until SIGINT, the final exit status was not captured.
- Old live viewer: reproduced by feeding the old `UIServer` synthetic snapshots (the old SDK never started it), so timing and event cadence are approximate; the old file viewer ran against the real `DashboardServer`.
- Platform pages are out of scope here (no platform was started).
