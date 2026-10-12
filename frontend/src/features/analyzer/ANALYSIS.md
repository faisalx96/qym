# Analyzer (auto-analysis workspace) — analysis

Walked on 2026-10-11 against the vanilla page on port 8806 (`QYM_AUTH_MODE=none`, SQLite,
project `demo`, 8 seeded runs via `frontend/scripts/seed_runs.py`, one project LLM
connection pointing at the local stub `frontend/scripts/stub_llm.py`, so Test and
Analyze really run end to end with no LLM key). Brief 08 and the Analyzer half of
brief 05 were read in full; `playground.js` target filter and `analyzer.html` row
normalisation were read for the logic to re-implement.

## Confirmed

- Canonical flow works: `/projects/demo/analysis?run=ID` 307s to `/projects/demo/runs/ID/analyzer`
  (the SPA must keep both forms and canonicalise to `?run=`). Boot calls, in order:
  `GET api/runs/ID?view=summary`, `?view=compact`, `POST items/details`, `GET analysis-config`
  (documents + rule-versions load only on first use of those tabs).
- Preview request: `POST api/runs/ID/analyze-preview {item_id, metric, config:{include_project_rules,
  include_project_documents, max_root_cause_categories, include_fields:{trace:true,...}}, connection_id}`;
  it fires on load and again whenever the selected target or any mapping changes.
- Test: `POST analyze-test {item_ids[], metric, config, connection_id, timeout_seconds}` returns
  `results[]` with `root_cause_issues`, `confidence`, `messages` (the full prompt). The stub produced
  "Retrieval · Missing context · 82%" and a "Created 1 category" completion.
- Analyze: `POST analysis-jobs` body carries `metrics[]`, `item_filter:"failed"`, `max_score`,
  `only_unanalyzed`, `allow_human_overwrite`, `threshold`, `config`, `connection_id`,
  `timeout_seconds`; answer is 202 `{job_id, status:"queued", progress:{phase,completed,total,...}}`.
  After the job, "Skip analyzed" removes the analysed items ("All matching targets already have
  analysis" empty state with "Include analyzed targets" / "Open Reviews").
- Input mapping dialog: INPUT / EXPECTED OUTPUT / ACTUAL OUTPUT source selects, a JSON-fields panel
  ("Use full value" + per-key checkboxes), "Include in prompt: Error / Scores / Metric Metadata",
  and a metric-metadata picker grouped by metric. The prompt preview is far from it.
- Tabs set `?scope=categories|rules|documents`. Project scope (no `run`) shows the same four tabs;
  Analyze-run is a landing. Diagnosis tab lists only categories with approved examples ("No approved
  categories yet" on a fresh project) although the catalog keeps the others.
- Rules tab on a new project: "Rules in v1 · 0 rules · Editable draft · Publish · Add rule", footer
  with "Add documents 0", "Add examples 0", "Create draft", "Generate rules" and the inline reason
  generation is unavailable. Documents tab: dropzone, size/type hint, content-character line, library.
- The aggregation pass needs a structured `json_schema` completion (`category_clusters`,
  `detail_clusters`); with an LLM that ignores it the job still saves per-item results but the run
  metadata records `analysis_aggregation`. The stub answers it with no merges.

## What the brief got wrong or left open

- Brief says the first-20 body fetch is needed at boot; compact rows already carry `input_preview`
  and `metric_meta`, so bodies are only needed when the mapping dialog/picker opens: lazy.
- "Fields:" badges are regex guesses on the prompt. The React page shows the fields it actually
  *sent* (from the request config), which is exact and needs no backend change.
- Documents and rule versions are not fetched until their tab (or the rules footer) needs them; the
  config endpoint is the only blocking call.
- `?scope=` is also read for `dashboard` in the vanilla page (kill-switched) and rewritten to `run`.
- The legacy `/run/:id/analyzer` redirect in the foundation goes to `/projects/:slug/runs/:id/analyzer`,
  which is the run-detail area's splat; this branch intercepts the `/analyzer` suffix there.

## Behaviours kept

Run header + sample picker (repeat runs) and in-place sample switching with a busy guard; metric chips;
`?metric=` preselect; additional instructions with `{var}` detection (reserved `categories`);
variable mapping with JSON-path picker and metric-metadata picker plus include toggles; target filter
(failed per metric, threshold and direction, execution errors excluded, skip-analyzed, human-label
overwrite with confirm, max score for maximize metrics, limit); max issues per item; timeout;
debounced preview (no LLM call) with copy and character count; context toggles (rules / documents /
trace); Test Selected (<= 3); Analyze N with job polling, phases (queued, analyzing, retrying,
aggregating, completed), cancel, resume through `/active`, completion summary with error-code groups
and "View run"; connection select and no-connection/read-only states; Diagnosis catalog with
required taxonomy validation, subcategories, examples and `base_revision` 409 handling; Rules versions
(draft, 700 ms autosave, publish with "set as production", promote, delete, compare, merge with
conflict resolution, download JSON), rule-generation job with progress, approved-example picker with
facets and character budget; Documents upload with the large-document 409 confirm, include toggle,
delete.

## Dropped (logged in decisions/analyzer/OPEN_QUESTIONS.md)

The compare-page modal mount (compare links to `?run=` instead), the kill-switched root-cause
dashboard, regex "Fields:" badges, the results-card MutationObservers, restore/permanent delete of
rule versions (no UI today), `window.prompt/confirm`.
