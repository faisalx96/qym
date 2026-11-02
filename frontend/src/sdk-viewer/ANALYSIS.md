# SDK local viewer: analysis

Method: ran a real evaluation (`qym run create --task-file task.py --dataset-file ds.csv --metrics exact_match`, 6 rows incl. Arabic rows and a task that always raises) against the SDK server on 8818, polled the live API while it ran, then served the saved CSV through `api/runs/<path>`. The vanilla viewer is dead, so there was no UI to walk; the brief's journeys were checked against the data contract and the code.

## Confirmed
- **Nothing started the server.** `UIServer` and `DashboardServer` were never instantiated, `--ui-port` was parsed and dropped, and `qym run create` crashed before running anything (`Evaluator.run() got an unexpected keyword argument 'show_progress'`; the signature is `show_tui`). Fixed as part of the wiring.
- Live API shapes match the brief: `api/run` is `{}` until registered, then the run block (no `status`, `started_at` only after finish); `api/snapshot` = `{rows, stats, last_updated, metric_names}`; SSE sends full snapshots.
- Live rows: `metric_values` are strings (`"1"`, `"pending"`), `latency_ms` is `null` while `in_progress`, `time` is `"running..."`/`"0s"`. A failing task is retried 3x then ends as `status: error`.
- Historical file mode (`RunDiscovery`): rows add `item_id`, `compare_*`, `task_started_at_ms`; `latency_ms` is a float (`344.15`), `trace_url` is `""`, `time` is the raw seconds string, `metric_meta` is `{}`, `run` has no `status`/`started_at`. Row order follows the file (failures last), not dataset order. Stats `in_progress`/`pending` are always 0.
- `POST api/runs/update_metric` still works end to end (writes `<metric>__meta__modified` / `__original_score` columns, returns the refreshed row); unknown metric -> 400 `{error}`.
- Missing file: HTTP 200 `{error}` before this branch (now 404/400).

## Brief corrections
- `output_full` still carried Rich markup for pending rows (`[dim]pending[/dim]`); stripped server-side now.
- Rows from a live run are sent whole on every snapshot; at 6 rows this is 3 KB, but a snapshot with long outputs scales linearly. Publishing is throttled to 300 ms with a trailing publish.
- The brief's "viewer reuses foundation primitives" costs: 23 of ~50 primitives import react-aria-components. The viewer uses only the dependency-free ones (Text, Badge, StatStrip, TextBlock, ScoreValue, ErrorState-style markup) plus a native table, so RAC stays out of the bundle.
- No foundation SVG logo exists (the brand is the text "قيِّم" and `favicon.png`, 54 KB). The viewer ships a small `favicon.svg` and the wordmark as text.

## Behaviors kept
1. Live progress: counts (completed / in progress / failed / pending), completion bar, elapsed timer that stops on `done` or `status != RUNNING`.
2. Rows table: index, status badge, input, output, expected, one column per metric (coloured pass/fail/na semantics), latency; sticky header; sortable columns; search over input/output/expected; status filter; sorting and filters in the URL (`?q=&status=&sort=&dir=`).
3. Row detail with full Input/Output/Expected (RTL via `dir`/`lang`), word diff toggle, copy buttons, trace id, metric meta, error text.
4. Latency percentiles (P50/P90/P99, min/max) computed once, not twice.
5. Export CSV of the filtered rows.
6. Inline metric score edit in file mode only (needs `run.file_path`).
7. Visible error states: unreachable server, 404/400 with the server's message and path, SSE drop with a reconnect hint; empty state before the first row.

## Dropped
Sparkline "metric charts" (misleading), error classification by substring, column drag/resize/reorder (mouse only), rows-per-page selector (the list is windowed instead), hidden native selects, light theme, DashboardServer listing/compare/delete/heartbeat.
