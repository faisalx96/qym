# Run detail — analysis (step 2 of the playbook)

Walked on 2026-10-11 against the vanilla page on port 8802 (`QYM_AUTH_MODE=none`,
SQLite) with data seeded through the public API only
(`frontend/e2e/run-detail/seed.ts`: classic run 240 items / 4 metrics / 12 task
errors / 8 scorer errors / 6 retries / 3 not-received / 61 traces; repeat run
`samples=3` × 60 items with failed passes; a RUNNING run; a submitted (locked)
run). Journeys J1–J9 of brief 04 §2 were exercised in Playwright; J10 (offline
export) was only read.

## Confirmed

- Shapes in §4 match the live API byte for byte: `GET /api/runs/{id}?view=compact`
  → `{run, snapshot}`, rows carry `input_preview`/`output_digest`/`__details_loaded`,
  `status ∈ completed|error|not_received`, `metric_values` parallel to
  `metric_names` (empty strings for a task error), `metric_meta`, `item_metadata`
  (incl. `trace_stats`), `trace_id`/`trace_url`. Repeat rows add `pass_scores`,
  `pass_metric_meta`, `pass_attempts`. `snapshot.stats` = `{total, completed,
failed, not_received, execution_count, …}`. `metric_specs.score_type ∈
boolean|percentage|count|number|legacy`, `direction ∈ maximize|minimize|null`.
- `/passes`, `/group-metrics`, `/items/details`, `/items/{id}/trace` (attempts
  merged, `summary.error_count`, span `attributes` with OpenInference keys),
  `/review-history`, `/live-status` (`revision` string), `POST /api/dashboard/neighbors`,
  `step-latency?rollup=site` (`groups[]`, `phases[]`, `traces`, `agents`) all answer
  as the brief says. Not-found still answers **HTTP 200 `{error: "Run not found"}`**.
- Page shape: hero (eyebrow, mono run id as title, status badge, Export HTML,
  pager "3 of 4", meta grid, execution context grid), then sticky section nav
  (Overview · Latency and traces · Deep analysis · Categories · Errors [20] ·
  Items [240] + Filters), versioning details card, Overview (stat strip + metric
  cards: boolean split bar, score histogram, numeric min/avg/max), Repeat run
  analysis (repeat only), Latency and traces (latency histogram + brush, quality
  vs latency scatter, time budget, call-site tiles, steps interval plot),
  Deep analysis (correlation matrix + relationship scatter; the matrix/frontier
  panels only appear when more data exists), Categories (chips, cards per key),
  Errors (task/metric/trace/analysis groups), Items (toolbar, 20 per page cards).
  Root-cause section only renders when analyses exist (not in the seed).
- Sections below the fold render **lazily when scrolled into view**
  (`IntersectionObserver`), which is why element screenshots of an unscrolled
  page are empty. The React page should keep that: heavy charts mount on
  visibility.
- Item card (collapsed): chevron · `#index` · Pass/Fail tag · title (`dir=rtl
lang=ar` for Arabic) · failure reason + source · metric pills that fit + "+N
  more". Expanded: INPUT (Copy link) / EXPECTED OUTPUT / metadata tags / OUTPUT
  (status, latency, started, Trace, copy) / trace chips (tokens, cost, LLM calls,
  tool calls, tool errors, retries) / metric strip with caret + pencil.
  Repeat card: per-pass output columns with pass toggles, "3 unique", per-pass
  verdict, Trace, and metric chips.
- `?item=ID` opens and scrolls the card; `?trace=ID` opens the drawer; `?pass=N`
  shows "PASS 2/3" and rescopes every number; `?view=heatmap` switches the
  repeat items list; `?list=` feeds the pager. Deep links verified.
- Locked run: `body.run-scores-locked`, notice "Scores are locked. This run is
  submitted for approval…", pencils hidden; Review history timeline shows the
  Submitted event.
- Trace drawer: header chips (8 spans · 1.6s · 800 tokens · $0.0012 · ID),
  filter box, tree with kind icons, model + token inline, waterfall bars, right
  pane tabs Input/Output · Messages · Raw; `?trace=` added, Escape removes it.
- A RUNNING run with no events for `QYM_RUN_STALE_TIMEOUT_SECONDS` (180 s) is
  lazily marked STOPPED with a stop reason; the live journey must seed and
  complete within that window (e2e does).

## What the brief got wrong or left open

- `run_metadata.run_name` is **not** the run name: `run.run_name` falls back to
  the run id (the hero title is the mono id). Only `external_run_id` names a run.
- §2 J1 says the hero shows "Version `branch • commit`": it is only shown when
  the run has `git_branch`/`git_commit` (seeded via run_metadata it did not
  surface; the fields come from the SDK's git detection).
- §3c "Deep analysis" lists six panels; with four metrics and one run only the
  correlation matrix and the relationship scatter rendered. The frontier /
  by-pass / stability panels need latency+repeat data; treat them as NICE.
- The "Root cause analysis" section and the per-metric issue cards only exist
  once an analysis has run; "Add issue" is reachable from the metric strip
  caret only when a `metric_analyses` entry exists for that metric. The React
  page must offer "Add issue" for any failing metric (brief §3j says so).
- Heatmap view (`?view=heatmap`) did not render under Playwright until the
  Items section was scrolled into view; it is lazy like the others.
- The filter builder field list for this run: each metric, Approval, Output
  text, Complexity, Domain, Source (metadata keys), Has error, Edited metrics,
  Retries, Trace errors, Latency (ms). Matches §2 J7.

## Behaviours kept (acceptance list for the React page)

Hero: status badge (+STOPPING…), live indicator + ticking runtime, pass pills,
Export HTML (legacy endpoint), pager with position + J/K, meta grid entity
links, ingest-incomplete + private-test-set + score-locked/read-only notices,
execution context with JSON preview, review history, experiment panel,
versioning details, document title. Section nav with scroll-spy + counts.
Filters: rule builder (nested AND/OR), chart-click filters, search (server
search for lazy snapshots), sort, analysis metric + threshold, hidden columns,
all round-tripping through the exact URL params. Overview stat strip + metric
cards with error-accounting notes; categories cards; errors groups; root cause
cards + aggregate + issue dialog + approve; repeat analysis (metric tabs,
stat strip, per-pass table, pass@k curve, distribution → filter); latency
histogram brush + scatter + time budget + steps plot; items list virtualized
with `page` kept, lazy bodies, reasons, metric strip with score edit (lock /
409 handling), pass columns, heatmap, CSV export with column picker; trace
drawer with tree, waterfall, retries, tabs, keyboard, `?trace=`, Langfuse link.

## Dropped (logged in OPEN_QUESTIONS.md)

Scroll-hold machinery, `fitItemRows` JS measurement, offline export mode,
legacy item-level diagnosis editors (values shown read-only), `parsePythonDict`,
SVG download of the steps plot, pager peek card, full-page reload on pass switch.
