# Standalone UIs (platform `/ui` viewer + SDK local UI) — migration brief

Written by an analysis agent for the React/TypeScript/Vite migration. Audience: the
component agent that will rebuild this area from scratch in `frontend/`. Be concrete:
file paths with line numbers, API routes with methods and response shapes, exact
behaviors. No marketing language.

**Headline finding (read first).** Both "standalone UIs" are the same ~1,150-line
vanilla app ("Evaluation Results" viewer) in two diverged copies, and **neither copy
is reachable from any shipped user flow today**:

- Platform copy `packages/platform/qym_platform/_static/ui/` is mounted as plain static
  files at `/ui` (`packages/platform/qym_platform/app.py:239`). No route serves its
  `index.html` as a page: `/run/{run_id}` (`api/runs.py:2478`) serves
  `_static/dashboard/run.html`, and `_platform_static_ui_index()` (`api/runs.py:1286`)
  is defined but never called. Opening `/ui/index.html` directly bootstraps in "live"
  mode and fetches `/ui/api/run`, which the static mount answers with 404. The
  dashboard bundle references nothing under `/ui/` (grep of `_static/dashboard/**`
  for `/ui/` and `../ui/` is empty).
- SDK copy `packages/sdk/qym/_static/ui/` is served by `qym.server.UIServer`
  (`packages/sdk/qym/server/app.py`) and `qym.server.DashboardServer`
  (`packages/sdk/qym/server/dashboard_server.py`). Neither class is instantiated
  anywhere: `core/evaluator.py:80-81` has the `UIServer` import commented out with
  "UIServer has been removed - platform streaming is now required", and
  `evaluator.py:1213-1222` emits a `DeprecationWarning` for `live_mode='local'`.
  `qym dashboard` (`cli/app.py:54-73`) opens the *platform* URL in a browser;
  `qym run create --no-ui` (`cli/run.py:84,311`) only toggles the Rich TUI table
  (`show_table`). `--ui-port` (`cli/run.py:85`) is parsed and never used. The only
  browser-open path in `run create` (`cli/run.py:353-356`) opens
  `result.html_url`, which is the platform's `live_url` (`evaluator.py:1307-1309`).
  `docs/RELEASE_NOTES.md:430`: "The local dashboard has been retired".

So this area's main job is a *decision* (section 8/9), not a port. The rest of
this brief documents the as-is app faithfully so the decision is informed and so a
local SDK viewer can be rebuilt if the team wants one.

## 1. Surface inventory

| page/route | HTML file | JS/CSS files it loads | entry function(s) | approx LOC |
|---|---|---|---|---|
| Platform: `GET /ui/index.html` (static mount, no page route; effectively dead) | `packages/platform/qym_platform/_static/ui/index.html` (148 lines) | `../ui/app.css?v=p1-20261001`, `../ui/app.js`, `../ui/qym_icon.png` (favicon, **927 KB**), `../ui/qym_text.png` (header logo, **613 KB**) | IIFE in `app.js:1`; `bootstrapLive()` `app.js:810` or `bootstrapDashboard(filePath)` `app.js:859`, chosen at `app.js:972` by whether the pathname contains `/run/` | app.js 1,145 / app.css 378 / index.html 148 |
| SDK live mode: `GET /` or `/index.html` on `UIServer` (any unknown path also falls back to `index.html`, `server/app.py:193-194`) | `packages/sdk/qym/_static/ui/index.html` (167 lines) | `ui/app.css`, `ui/app.js`, `ui/qym_icon.png`, `ui/qym_text.png` (resolved against an injected `<base>` tag, `index.html:7-27`) | `bootstrapLive()` `app.js:~929` + `EventSource('api/rows/stream')` `app.js:~1104` | app.js 1,240 / app.css 416 / index.html 167 |
| SDK historical mode: `GET /run/<url-encoded file path>` on `DashboardServer` (`dashboard_server.py:177-183`) | same SDK `index.html` | same; `<base href>` = everything before `/run/` + `/` | `bootstrapDashboard(filePath)` with `filePath` decoded from the URL (multi-pass `decodeURIComponent`, `app.js:35-48`) or `sessionStorage.dashboardRunFile` | same |
| SDK `DashboardServer` home `/`, `/compare`, `/static/*` | expects `packages/sdk/qym/_static/dashboard/{index,compare}.html` — **directory does not exist** (`tests/test_restructure.py:633-635` asserts it must not) → 404 `{"error": "Dashboard not found"}` | — | `dashboard_server.py:186-191, 249-254` | dead |

Servers (Python, part of this area's "backend"):

| module | class | transport | threads | LOC |
|---|---|---|---|---|
| `packages/sdk/qym/server/app.py` | `UIServer(host="127.0.0.1", port=0)` | `http.server.ThreadingHTTPServer`, SSE via raw `wfile` writes, 15 s `:keep-alive` comments (`app.py:139-147`) | daemon thread `qym-ui` | 257 |
| `packages/sdk/qym/server/dashboard_server.py` | `DashboardServer(host, port=8080, results_dir="qym_results", inactivity_timeout=300)`; `run_dashboard()` blocking helper | same stdlib server; polls `RunDiscovery` on disk; auto-stops after 300 s without a request (`dashboard_server.py:86-95`); `auto_open=True` calls `webbrowser.open` | daemon threads `qym-dashboard`, `qym-dashboard-monitor` | 474 |
| `packages/sdk/qym/core/run_discovery.py` | `RunDiscovery` (scan `qym_results/`, CSV/XLSX → UI snapshot, in-place metric edit) | — | — | 1,076 |
| `packages/sdk/qym/utils/` | `env.py` (`load_cwd_dotenv`, `get_platform_url_env`), `errors.py`, `text.py` | no HTML/HTTP helpers exist here despite AGENTS.md's description; the static-file serving and content-type sniffing are inlined in each server (`app.py:154-216`, `dashboard_server.py:113-145`) | — | 30 / 61 / 23 |

Static-dir resolution order (`server/app.py:78-96`): `$QYM_STATIC_DIR` env → `<pkg>/_static/ui` on disk → `importlib.resources.files('qym')/_static/ui` (py3.9+ API, with a bare-`except` fallback that sets `pkg_files=None`).

Packaging: `packages/sdk/pyproject.toml` `[tool.setuptools.package-data] qym = ["_static/ui/*"]` (one level, **no `**` glob**); `packages/sdk/qym.egg-info/SOURCES.txt:11-15` confirms the five files ship. `tests/test_restructure.py:543` asserts the `"_static/ui/*"` string literally; `:636-637` asserts `_static/ui/index.html` exists in the SDK; `:640-644` asserts the platform copy's `index.html` exists. Platform `pyproject.toml` package-data also lists `"_static/ui/*"`. No `MANIFEST.in`/`setup.cfg` in either package.

## 2. User journeys (as-is)

All journeys below are what the code *would* do; none is reachable from a shipped command (see headline). The SDK journeys assume a developer imports the server classes manually.

1. **Watch a live local run (SDK `UIServer`)**
   - Entry: Python code creates `UIServer().start()` → `(host, port)`; caller pushes `run_state.set_run_info(run_block)` and `set_snapshot(tracker.get_snapshot())` + `broadcast_snapshot()` per update; browser opens `http://127.0.0.1:<port>/`.
   - Steps: page loads with empty header chips (`—`), five stat cards, Latency/Errors/Metrics panels, an empty table ("No results match your filters." hidden until first render). `bootstrapLive` fetches `api/run` then `api/snapshot`, sets `document.title = "قيِّم – <dataset> / <run>"`, starts a 1 s elapsed timer from `run.started_at` (`app.js:817-822, 1043-1055`). An `EventSource('api/rows/stream')` receives full `snapshot` events and re-renders *everything* (`renderAll`, `app.js:509-518`) per event. On server `stop()` a `done` event triggers one final `api/snapshot` fetch and stops the timer; `es.onerror` does the same once.
   - Success: all rows `completed`, timer frozen, "Completion" bar 100 %. Error state: none rendered — all fetch failures are swallowed (`.catch(()=>{})`), the page just stays empty. Empty state: table shows the "No results…" div.
   - Keyboard: none ("No global keyboard shortcuts", `app.js:807`). No URL/query state. No persisted state.

2. **Open a historical result file (SDK `DashboardServer`)**
   - Entry: `http://127.0.0.1:8080/run/<encoded path to qym_results/.../run.csv|.xlsx>`; fallback `sessionStorage.dashboardRunFile` (set by the missing dashboard index page; nothing sets it today).
   - Steps: `bootstrapDashboard` → `GET api/runs/<encoded path>` → `{run, snapshot}`; title gets " (Historical)"; if `run.status` is `RUNNING` (SDK copy) / `RUNNING|PENDING` (platform copy) it polls the same endpoint (SDK: `setInterval` 500 ms, `app.js:~1036`; platform: serialized `setTimeout` 2 s with `AbortController`, stops on 401/403/404/410, `app.js:913-949`). `RunDiscovery.get_run_data` never emits `run.status`, so polling never starts in practice.
   - Drawer "Edit score" (SDK copy only, `app.js:~682-765`): when `state.isDashboardMode && (run.file_path || dashboardRunFile)`, each metric in the row drawer gets an Edit/Save control; Save → `POST api/runs/update_metric` → row replaced in memory, charts/quickbar/table re-rendered, drawer re-opened after 200 ms with the returned row; status text "Saving..." → "Saved" (1.5 s) or "Error".
   - Error: `data.error` is only `console.error`'d; the page stays blank. Server's 404/500 bodies are JSON `{"error": ...}` but the fetch path ignores HTTP status.
   - Deep link: the whole file path is the URL. No other query params.

3. **Filter / sort / page the results table** (both modes)
   - Search box `#q` filters on `input_full|output_full|expected_full` substring, case-insensitive, no debounce, re-renders the whole page on every keystroke (`app.js:522`).
   - Status filter: custom dropdown (`#status-menu`, radio inputs) mirrored into a hidden native `<select id="status">` (`index.html:57-67`). Values `all|completed|in_progress|error|pending`.
   - Rows-per-page: same pattern, `25|50|100|200`, default 50. Pager "Prev/Next" + "Page X of Y | a-b of N".
   - Sorting: click any `<th>`; default `index asc`; status sorts by rank `{completed:3,in_progress:2,pending:1,error:0}`; metric columns sort numerically when both sides parse as numbers, else as strings (`app.js:148-174`).
   - Columns menu: checkbox per column (index fixed), plus dynamically discovered `metric:<name>:<field>` sub-columns from `metric_meta` (`app.js:290-330`). Drag the `⋮⋮` handle to reorder (HTML5 DnD, mouse only); drag the right edge (`.col-resizer`) to resize (min 48 px). Nothing persists across reload.

4. **Inspect one row** — click anywhere on a `<tr>` (delegated listener `app.js:495-506`) → overlay drawer `role="dialog" aria-modal="true"` with Input/Output/Expected `<pre>`s, "Show Diff" checkbox (word-level, splits on whitespace, pairs tokens positionally and wraps mismatches in `<del>/<ins>`, `app.js:592-605`), copy buttons (Clipboard API with `execCommand` fallback; button text flips to `✓`/`!` for 900 ms), Trace (`trace_id` text or "Trace available" or "N/A"), Time (`latency_ms` humanised or raw `time`), Metrics list (`<name>_score` + each `metric_meta` field; SDK copy shows an "Edited" badge and "Modified · original: X" note from `metric_meta.modified/original_score`). Close via ✕ button or clicking the overlay backdrop. No Escape key, no focus trap, no focus restore. `body.no-scroll` while open.

5. **Export CSV** — header button → builds CSV of the *filtered* rows and *visible* columns client-side (`app.js:765-805`), downloads as `qym_<dataset>_<run>.csv` via a Blob URL. Values are the `*_full` fields.

## 3. Functional inventory

**Header / run meta** (`renderMeta`, `app.js:176-219`)
- Chips: Dataset, Run, Concurrency (`config.max_concurrency`), Timeout (`config.timeout` + "s"), Elapsed (live timer). MUST-KEEP (run identity + settings), but Elapsed timer is NICE (only meaningful live).
- Stat cards: Completed / In Progress / Failed / Pending counts + Completion % progress bar from `stats.success_rate` (0–100 scale). MUST-KEEP.
- Export CSV. MUST-KEEP for a local viewer (it is the only way out of the page); DROP-CANDIDATE on the platform where runs are already downloadable.
- Logo `qym_text.png` wrapped in `<a href="/">` (platform copy only). DROP-CANDIDATE: 613 KB PNG; use the shared SVG/brand from the foundation.

**Quick bar** (`renderQuickBar`, `app.js:221-270`) — Latency Min/P50/P90/P99/Max over completed rows (linear interpolation percentile) + error badges Timeout/Runtime/Unknown/Metric. **Duplicates the Overview panels exactly** (`renderPanels`, `app.js:403-434`, same math). DROP-CANDIDATE: keep one of the two.

**Overview panels** — Latency percentiles; Errors classified by *substring of output text* (`'timeout'` → timeout, `'error:'` → runtime, else unknown; `app.js:241-246`) and "Metric" errors = rows where any metric value is `error`/`n/a`. MUST-KEEP the percentiles; the heuristic classification is a DROP-CANDIDATE unless the SDK emits a structured error kind.

**Metrics panel** (`renderMetricCharts`/`sparklineSVG`, `app.js:1104-1144`) — one sparkline per metric of the *running mean across all rows, sampled once per snapshot* (`updateMetricSeriesFromSnapshot`, capped at 120 points, draws last 60). In historical mode the series has one point so it draws a flat line. Value label formats 0..1 as a percentage. NICE at best; misleading (x-axis is "snapshot count", not items). DROP-CANDIDATE; replace with a per-metric mean + distribution if a chart is wanted (load `dataviz` skill).

**Toolbar** — search (MUST-KEEP), status filter (MUST-KEEP), column show/hide (NICE), rows-per-page (NICE; virtualise instead), hidden native selects kept "for compatibility" (DROP).

**Table** — sortable headers (MUST-KEEP), DnD reorder (NICE), resize (NICE), sticky header (MUST-KEEP), metric cell colouring: `metric-yes` for `✓|true|yes|1|1.0` or numeric ≈1, `metric-no` for `✗|false|no|0|0.0` or ≈0, `metric-na` for `n/a|pending|error|computing...` (`app.js:448-470`) (MUST-KEEP semantics), `ellipsis` cells with full text in `title` (MUST-KEEP truncation, drop `title` as the full-text channel), status badge (MUST-KEEP).

**Drawer** — raw/diff toggle (MUST-KEEP diff, it is the one feature with no equivalent elsewhere... though the platform run page may have its own), copy buttons (MUST-KEEP), trace id (MUST-KEEP), metrics with meta (MUST-KEEP), **inline metric score editing against the CSV** (SDK copy; `POST api/runs/update_metric`) — DROP-CANDIDATE for the SDK viewer unless the team wants local review; the platform has its own review flows.

**Hidden behaviours**
- Live: SSE `snapshot` events carry the *entire* row set every time; `renderAll` rebuilds all DOM via `innerHTML`. If the first snapshot arrives before `api/run` resolves it is parked in `state._pendingSnapshot` (`app.js:848-852, 992-994`).
- Historical polling (see journey 2); `pagehide` and a custom `qym:before-navigate` document event stop polling (platform copy only, `app.js:964-969`; the event is dispatched by the dashboard's `shell.js` SPA navigation, which never loads this page).
- Timer auto-stops when `stats.pending===0 && stats.in_progress===0` (`app.js:1046-1054`).
- Metric names discovered from `snapshot.metric_names`, else from the first row's `metric_meta` keys, else synthesised `metric_1..n` (`app.js:71-93`).
- No toasts, no confirmations, no localStorage. `sessionStorage.dashboardRunFile` read-only fallback.
- `document.body.setAttribute('data-header-style','b')` is set but no CSS keys off it.
- `data-theme="light"` CSS exists (`app.css:21-35` and ~15 overrides) but nothing ever sets it → light mode is dead.

**Security note for the rebuild**: the platform copy interpolates `toStr(r.input_full)` etc. straight into `innerHTML`/`title` (`app.js:474-476, 181-185`) — stored XSS from a model output containing `<img onerror>`. The SDK copy only added `escapeAttr` for the metric-edit controls. React fixes this by default; keep it that way (no `dangerouslySetInnerHTML` for user text, including the diff renderer).

## 4. Data & API contract

Relative URLs are resolved against `BASE_URL` (`app.js:4-23`): origin + path prefix before `/run/` (or the current directory), so a reverse-proxy sub-path works without config.

| method | path | query/body | response shape | used by |
|---|---|---|---|---|
| GET | `api/run` (UIServer only; `server/app.py:115-119`) | — | `run_block` from `Evaluator._build_run_info` (`core/evaluator.py:831-890`): `{dataset_name: str, run_name: str, config: {max_concurrency: int, max_metric_concurrency: int, metric_concurrency: int, timeout: float, input_mapping: {}, run_metadata: {}}, model: str, version: str|null, git_sha, git_branch, cli_invocation, metric_names: string[], metric_specs: [...], trace: {destinations: {phoenix: bool, platform: bool}, instrumentors: string[]}, started_at?: ISO, ended_at?: ISO, total_items?: int, qym_url?/html_url?/platform_run_id?: str}`. Served `{}` until `set_run_info` is called. | `bootstrapLive` |
| GET | `api/snapshot` (`server/app.py:120-124`) | — | `ProgressTracker.get_snapshot()` (`core/progress.py:164-190`): `{rows: Row[], stats: {total, completed, in_progress, failed, pending: int, success_rate: number 0-100}, last_updated: "YYYY-MM-DD HH:MM:SS", metric_names: string[]}` | live bootstrap, `done`/`onerror` refetch |
| GET (SSE) | `api/rows/stream` (`server/app.py:125-152`) | — | `text/event-stream`; events `snapshot` (same shape as `api/snapshot`, sent on connect if non-empty and on every `broadcast_snapshot()`), `done` (`{"ok": true}` on `stop()`), comment `:keep-alive` every 15 s | live mode only |
| GET | `api/runs` (`dashboard_server.py:153-160`) | — | `RunIndex.to_dict()`: `{tasks: {[task]: {[model]: RunInfo[]}}, last_updated: ISO}`; `RunInfo` = `{run_id, task_name, model_name, dataset_name, timestamp: ISO, file_path, metrics: string[], metric_averages: {[m]: number}, total_items, success_count, error_count, success_rate: 0-1, avg_latency_ms, langfuse_url, langfuse_dataset_id, langfuse_run_id}` (`run_discovery.py:195-253`) | nobody today (the index page that would list runs does not exist in the SDK) |
| GET | `api/runs/<encoded file path>` (`dashboard_server.py:163-174`; path unquoted repeatedly) | — | `RunDiscovery.get_run_data` (`run_discovery.py:589-790`, xlsx: `792-970`): `{run: {dataset_name, run_name, file_path: abs str, metric_names: string[], config: {}, metadata: {}, langfuse_host: "", langfuse_project_id: "", compare_alignment_status, compare_alignment_issues}, snapshot: {rows: Row[], stats: {total, completed, in_progress: 0, pending: 0, failed, success_rate}, metric_names}}` **or** `{error: str}` with HTTP 200 | `bootstrapDashboard` + polling |
| GET | `api/compare?files=a,b&files=c` (`dashboard_server.py:194-228`) | `files` repeated/comma-separated | `{runs: RunData[], compare_alignment_status: "aligned"|"unalignable", unalignable_runs: [{run_name, issues: []}]}` | the missing `compare.html` |
| POST | `api/heartbeat` (`dashboard_server.py:269-272`) | — | `{"ok": true}`; only touches the inactivity timer | nothing in this UI |
| POST | `api/runs/delete` (`dashboard_server.py:275-328`) | `{file_path}` | 200 `{"ok": true}` / 400 / 403 `{"error":"Access denied"}` (path outside results dir) / 404 | the missing dashboard index |
| POST | `api/runs/update_metric` (`dashboard_server.py:331-402`) | `{file_path, metric_name, row_index: int, new_score: any}` | 200 `{ok: true, row: Row, run: {...}}`; 400 `{error}` (missing fields, unknown metric, xlsx read-only, out of range); 500 `{error}` | drawer metric editor (SDK copy) |
| GET | `/ui/*`, `/static/*`, `/run/*`, `/`, fallback | — | static files; content type by extension; unknown → `index.html` (UIServer) or 404 `{}` (DashboardServer) | asset loading |

`Row` (both producers agree on the core; `progress.py:197-235`, `run_discovery.py:749-767`): `{index: int (0-based; UI shows +1), status: "pending"|"in_progress"|"completed"|"error", input, input_full, output, output_full, expected, expected_full: str, metric_values: (string|number)[] aligned to metric_names, metric_meta: {[metric]: {[field]: str}}, time: str, latency_ms: int|null, trace_id: str|null, trace_url: str|null}`. Historical rows add `item_id, compare_item_id, compare_alignment_source, task_started_at_ms, item_metadata`. Live rows may still contain Rich markup remnants (`[dim]pending[/dim]`); the UI strips `[dim]`, `[red]`, `[yellow]` tags client-side (`stripMarkup`, `app.js:578-582`).

Auth: none (loopback only). Pagination: none; everything is in one payload. Error envelope: `{"error": "..."}` with inconsistent status codes (200 for `get_run_data` errors). Client-side reshaping: latency percentiles, error classification, metric-value → boolean/number coercion (`toNumber`, `app.js:1060-1073`), metric sub-column discovery, running-mean series. No CORS headers are sent by either server (`_set_headers`, `server/app.py:105-109`), so a Vite dev server on another port cannot call them without a proxy.

## 5. Shared dependencies

None. Both copies are self-contained IIFEs with no imports; they use none of `ui_components.js`, `qym_table.js`, `json_viewer.js`, `shell.js`, `dashboard.js`, `qym_safe.js`, `qym_live.js`. Consequences worth noting for the rebuild: no `QymSafe.textDirAttrs` (Arabic text renders LTR), no shared table, no shared JSON viewer, no shared dialog/focus contract, hand-rolled sparkline, hand-rolled dropdowns.

Nothing here is imported by other areas. The only cross-references are infrastructure: `app.py:239` mount, `middleware/cache_control.py:20` (`/ui/` treated as cacheable static), `api/runs.py:1276-1277` (`_dashboard_html_response` rewrites `="/ui/` for sub-path deployments — no dashboard HTML contains such a reference), `tests/platform/fixtures/admin_force_stop_contract.cjs:122-132` (Playwright route stub for `/qym/ui/*`), `tests/test_restructure.py:543,636-644`.

## 6. Design-token usage

The platform copy's `app.css:1-36` declares its own `--bg/--panel/--panel-2/--border/--soft/--text/--muted/--brand/--ok/--warn/--err/--info` with hardcoded hex values that *visually* match `dashboard.css` (`--brand: #00d4aa`, `--bg: #0d0d14`, text 12 px, uppercase 10 px mono labels, Menlo in the mono stack per `docs/DESIGN_LANGUAGE.md:78-82`). It does not import `dashboard.css` and uses none of its token names (`--text-muted` etc.), so it drifts the moment the dashboard changes. The SDK copy is the **older purple theme** (`--brand: #7c3aed`, `--bg: #0b0e13`, 1.6 rem h1, gradients, box-shadows, `0.95rem` table text) — i.e. the pre-July-2026 look that the dashboard has since abandoned. Both have an unused light theme block.

Area-specific CSS that should become component styles in the foundation: status badge (`.badge.{completed,error,in_progress,pending}`), metric value colouring (`.metric-yes/.metric-no/.metric-na`), stat card with icon tile, chip with uppercase label, drawer/overlay, column drag/resize handles, word-diff `<del>/<ins>` colours, sparkline. Most of these already exist in brief 02's primitives (badge, stat tile, drawer, table) — reuse, do not re-create.

Sanctioned exception `docs/DESIGN_LANGUAGE.md:417-419` ("`_static/ui/` … separate mini-app with its own theme, including a light mode. Do not import dashboard tokens there or vice versa"): see section 8 — recommend retiring it.

## 7. UX pain points observed

- The page is unreachable from any product surface; a developer who finds `UIServer` gets no CLI to start it, and `DashboardServer` 404s on its own home page because `_static/dashboard` was moved out of the SDK.
- Every snapshot/keystroke rebuilds the entire DOM (`renderAll` → 7 `innerHTML` renders); with 200 rows × many metric sub-columns and 500 ms polling (SDK copy) the page stutters and loses text selection/scroll in the table.
- Two identical latency/error summaries (quick bar + Overview panels) on the same screen.
- Sparkline "metric charts" plot the running mean per snapshot, not per item — unreadable in historical mode (flat line) and misleading live.
- Error classification by substring ("timeout", "error:") of the output text.
- Error states are invisible: failed fetches, `{"error": ...}` payloads and missing files leave a blank page with `—` placeholders; only `console.error`.
- Custom dropdowns use `role="menu"` on a list of `<label><input type=radio>` (wrong ARIA pattern), with duplicate hidden native `<select>`s (`aria-hidden`, `tabindex=-1`) so screen readers still see two controls for one filter.
- Rows open the drawer on click only — not focusable, no Enter/Space; column reorder/resize is mouse-only; no keyboard shortcuts at all.
- Drawer: `aria-modal` with no focus trap, no Escape, no focus return; `✕` close button has an `aria-label` but the copy buttons are `⧉` glyphs with only `title`.
- Full input/output text lives in `title` tooltips (not accessible, truncated by browsers, and an XSS vector in the platform copy).
- Stat icons are glyph characters (`✓ ⟳ ✗ ◯ %`) styled as icons; the "In Progress" ⟳ never animates.
- Arabic/RTL text: no `dir`/`lang` handling; mixed-script outputs render as left-aligned LTR blocks (violates DESIGN_LANGUAGE "Text direction").
- 1.5 MB of PNG logos on a page whose entire JS+CSS is 75 KB.
- No persistence of column choices, page size, or sort; no shareable URL for a filtered view.
- "Elapsed" chip is destroyed and recreated each render; the timer keeps running after the run ends if `stats.total` is missing.
- Light theme exists in CSS but has no toggle; `color-scheme: dark` forces dark form controls.

## 8. Migration notes

### What to build (recommendation)

1. **Platform `/ui` viewer: do not port; delete.** It has no entry route, no consumers in the dashboard bundle, and its historical-run functionality is the run-detail area (brief 04). Cleanup list for the cutover (small backend PR with pytest): remove `app.mount("/ui", …)` (`app.py:238-239`), `_platform_static_ui_index` (`api/runs.py:1286-1287`), the `/ui/` rewrite lines (`api/runs.py:1276-1277`), `"/ui/"` from `middleware/cache_control.py:20`, `"_static/ui/*"` from platform `pyproject.toml` package-data, the directory itself, `tests/test_restructure.py::TestStaticAssets::test_platform_ui_has_index` (`:640-644`), and the `/qym/ui/` stub in `tests/platform/fixtures/admin_force_stop_contract.cjs:122-132`.
2. **SDK local UI: keep one small Vite entry (`results-viewer`) only if the team confirms they want a local, offline results viewer** (open question 1). If yes, build it as a single React page that supports the three data sources below; if no, delete `packages/sdk/qym/server/` and `_static/ui/`, drop `--ui-port`, update `tests/test_restructure.py:84-87, 543, 636-637`, and remove the design-language exception.

### One Vite build, three entry points — yes, with caveats

Vite supports multiple HTML entries via `build.rollupOptions.input`, but the SDK entry has different requirements from the dashboard SPA, so use **two Vite configs (or one config switched by `--mode`)** rather than one `input` map:

- `frontend/vite.config.ts` (default): the platform SPA → `packages/platform/qym_platform/_static/app/` with `base: '/app/'`, code-splitting, React Router, TanStack Query (per playbook).
- `frontend/vite.sdk.config.ts` (`npm run build:sdk`): entry `frontend/src/entries/sdk-viewer/index.html` → `packages/sdk/qym/_static/ui/`, with `base: './'` (the page is served at `/`, `/index.html`, and `/run/<anything>`; relative asset URLs + a `<base href>` computed at runtime like `index.html:7-27` today, or simply serve assets from `/ui/*` as both servers already do and hardcode `base: '/ui/'`), `build.rollupOptions.output.{entryFileNames:'app.js', assetFileNames:'[name][extname]'}` so the output stays **flat** (`index.html`, `app.js`, `app.css`, no `assets/` subfolder) — otherwise `package-data = ["_static/ui/*"]` silently drops the nested files from the wheel; alternatively change package-data to `["_static/ui/**/*"]` and the `tests/test_restructure.py:543` assertion. Inline small assets (`build.assetsInlineLimit`), no `modulepreload` polyfill needed (`build.modulePreload: false`), `build.target: 'es2019'` is fine. Mark the output as a build artifact: gitignore `packages/sdk/qym/_static/ui/*` except a `.gitkeep`, and make the SDK wheel build run `npm run build:sdk` first (a `scripts/build_sdk_wheel.sh` or a setuptools `build_py` hook); CI must fail if the folder is empty. Share code with the SPA by importing from `frontend/src/ui/*` and `frontend/src/features/run-detail/*` components (the results table, drawer, badges) — not by duplicating.
- The platform `/ui` viewer gets **no** entry (see 1).

### SDK constraints (hard)

- Offline, no platform, no CDN: everything inlined into the three files; no Google Fonts (DESIGN_LANGUAGE bans webfonts anyway); no runtime `import()` of remote chunks.
- Python 3.9+: serving stays stdlib `http.server` (`importlib.resources.files` is 3.9+; keep the fallback). No FastAPI in the SDK (`pyproject.toml` deps: pydantic, rich, typer, dotenv…; no web framework).
- Size: the SDK wheel is installed in users' projects; budget the whole `_static/ui` at **≤ 300 KB uncompressed** (React+ReactDOM ≈ 140 KB min; avoid React Router and TanStack Query here — a `useEffect`+`EventSource` is enough; or use Preact via `@preact/compat` alias in the SDK config only). Replace the 1.5 MB PNGs with the foundation SVG logo (brief 02).
- Loopback only, no auth; keep path-traversal guards (`server/app.py:188-192`).
- Dev loop: UIServer sends no CORS headers; add a `server.proxy` in `vite.sdk.config.ts` for `/api` → `http://127.0.0.1:<port>` (or add `Access-Control-Allow-Origin: http://localhost:5808` when `QYM_STATIC_DIR` is set). `QYM_STATIC_DIR` already lets the server serve a Vite `dist/` directly.

### Proposed React component tree (SDK viewer only) and routes

- `SdkViewerApp` (mode detection: `/run/<path>` → historical, else live)
  - `RunHeader` — `RunChips` (dataset/run/model/concurrency/timeout), `ElapsedTimer`, `ExportCsvButton`
  - `RunStats` — four `StatTile`s + `CompletionBar`
  - `LatencyPanel` (P50/P90/P99/min/max), `ErrorsPanel`, `MetricsPanel` (mean + pass-rate per metric; no sparkline)
  - `ResultsToolbar` — `SearchInput`, `StatusSelect`, `ColumnPicker`
  - `ResultsTable` (foundation table primitive; virtualised rows; sortable; keyboard row activation)
  - `RowDrawer` — `TextBlock×3` (with `textDirAttrs`), `DiffToggle`/`WordDiff`, `CopyButton`, `TraceInfo`, `MetricList`
  - `LoadError` / `EmptyState`
- Routes: none (no router). URL state: `/run/<encoded path>` as today; add `?q=&status=&sort=&dir=&page=` for shareable filters. Local state: column visibility/order/widths (persist to `localStorage['qym.sdkViewer.columns']` keyed by metric-name list). Server state: `run` (`['sdk','run']`), `snapshot` (`['sdk','snapshot']`) — if TanStack Query is avoided, a small `useSnapshot()` hook that owns fetch + SSE + poll with `AbortController` (port the platform copy's serialized-poll logic at `app.js:910-949`, which fixed the SDK copy's overlapping `setInterval` race).

### Backend changes likely needed

- `UIServer`: `GET /api/run` should include `status` (`RUNNING|COMPLETED|FAILED`) and `started_at/ended_at` so the client stops its timer deterministically; add CORS for dev; optionally serve `index.html` for `/run/*` so one server covers both modes.
- `DashboardServer`: either delete (it depends on a dashboard bundle the SDK no longer ships) or reduce to `/api/runs`, `/api/runs/<path>`, `/run/*`, `/ui/*`; make `get_run_data` errors return 404/400 instead of 200 `{error}`; emit `run.status` (never `RUNNING` for a file).
- A CLI entry (`qym results view <file>` / `qym results serve --dir qym_results`) if the viewer is kept — nothing launches these servers today.
- Wheel build step running Vite (see above), plus `tests/sdk/test_sdk_static_bundle.py` asserting `index.html`, `app.js`, `app.css` exist and are < 300 KB.

### Risks / gotchas

- Full-snapshot SSE with all rows per event: for 1k+ items × multi-KB outputs this is MBs per tick; the server broadcasts under a lock with blocking `wfile.write` per client (`server/app.py:244-256`) so one slow browser stalls the evaluator thread that calls `broadcast_snapshot()`. Either diff snapshots server-side or throttle (≥ 500 ms) and virtualise the table.
- `latency_ms` is `null` for in-progress rows (live) and `0` for unparsable `time` (historical); treat both as "unknown".
- Metric values are strings in both producers (`"0.83"`, `"✓"`, `"n/a"`, `"computing..."`); keep the coercion table from `app.js:448-470, 1060-1073` as a pure, unit-tested function.
- `metric_meta` field names are open-ended (LLM-judge reasons etc.) and can be long; sub-columns explode table width — default them hidden.
- File paths in URLs: the SDK copy's multi-pass decode exists because paths were double-encoded by the missing dashboard page; one `decodeURIComponent` + `encodeURIComponent` on the way out is enough if the new code owns both ends.
- Rich markup leakage (`[dim]`, `[yellow]`) in live rows — strip server-side (`progress.py:_strip_tags` already does for most fields) rather than in React.
- `tests/test_restructure.py` hard-codes the `"_static/ui/*"` literal and file existence; update it together with any output-layout change.

### Suggested Playwright scenarios (against `UIServer` on port 8808 with a fixture that pushes snapshots)

1. Live: page loads with empty state, first `snapshot` event renders N rows, stat tiles equal `stats`.
2. Live: `done` event freezes the Elapsed timer and the final snapshot replaces an `in_progress` row with `completed`.
3. Historical: `/run/<encoded csv path>` renders rows and the title contains "(Historical)"; a missing file shows a visible error with the path.
4. Search "foo" narrows rows and the pager text updates; clearing restores all rows.
5. Status filter `error` shows only rows with the red badge; combined with sort by Time desc keeps the filter.
6. Click a metric header → numeric sort ascending, click again → descending; indicator visible.
7. Keyboard: Tab to a row, Enter opens the drawer, focus lands inside, Escape closes and returns focus to the row.
8. Drawer: toggle "Show Diff" marks differing words; copy Output puts the full text on the clipboard.
9. Export CSV downloads a file whose header equals the visible columns and whose row count equals the filtered count.
10. Arabic output row renders with `dir="rtl" lang="ar"` on the text block.
11. Bundle check: `packages/sdk/qym/_static/ui/` contains exactly `index.html`, `app.js`, `app.css` (+svg) and totals < 300 KB; `pip wheel packages/sdk` includes them.

### Does the DESIGN_LANGUAGE `/ui app` exception still make sense?

No. It existed because the SDK copy was an older, separately themed app (purple brand, gradients) frozen in July 2026 while the platform copy was re-skinned to the dashboard palette in Oct 2026 by hand-copying hex values. Once the SDK viewer is a Vite entry built from the same `frontend/src/ui` tokens and components, it uses the dashboard tokens by construction, and the ported design-language lint should cover `frontend/src/entries/sdk-viewer/**` like any other feature. Replace the exception with one sentence: "The SDK-local viewer is built from `frontend/` with the same tokens; its only allowed deviation is `color-scheme`/no-webfont constraints for offline use." The dead light theme should not be carried over (the dashboard has no light mode either).

## 9. Open questions

1. **Keep a local SDK results viewer at all?** Release notes (`docs/RELEASE_NOTES.md:430`) say the local dashboard was retired; the code is dead; `qym run create` prints a Rich summary and opens the platform `live_url`. If the answer is no, this area collapses to a deletion PR (both servers, both static copies, `--ui-port`, the design-language exception, four test assertions). If yes, decide the CLI surface (`qym results view <file>`? auto-open after `run create` when `QYM_API_KEY` is unset?).
2. If kept: which of the two servers survives? Proposal: one `UIServer` that serves both live (`/`) and file mode (`/run/<path>`), and `DashboardServer`'s listing/compare/delete/update endpoints are dropped unless the team wants local review editing of CSVs (`update_metric` writes `__meta__modified/original_score` columns — an audit feature someone built on purpose).
3. React vs Preact (via alias) for the SDK entry to meet the size budget — and whether sharing components with the SPA is worth the bundle cost versus a leaner duplicate.
4. Flat output (`app.js/app.css/index.html`) with Rollup naming vs. changing `package-data` to `**/*` — both require touching `tests/test_restructure.py:543`.
5. Should `run.status` / structured error kinds (`timeout|runtime|metric`) be added to the SDK snapshot so the UI stops classifying by output substring? Requires a small `progress.py`/`run_discovery.py` change.
6. Delete the platform `_static/ui` copy in the foundation branch now (it is dead) or at the final cutover? It is harmless but 1.6 MB in every platform wheel/Docker image.
