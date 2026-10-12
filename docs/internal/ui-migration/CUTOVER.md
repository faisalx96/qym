# Cutover: the React app is the UI

Branch `ui/cutover`, from `UI-redesign` at `a928df10`. Phase 1 only (no feature review).

## What changed

- **Serving.** `qym_platform/api/spa.py` answers every page URL with the built `index.html`
  (history fallback), registered LAST in `create_app` so every API route wins. `<base href>` and
  `window.__QYM_APP__` carry `QYM_ROOT_PATH`/`QYM_MAIN_PREFIX`; unauthenticated session users are
  bounced to `/login?next=...`; `/login` forwards a signed-in user to `next`. Hashed assets are mounted at
  `/assets` (cacheable; pages stay `no-store`). Unmatched `/v1`, `/api`, `/assets`, `/static`, `/ui`,
  `/ingestion`, `/workers` (and the configured prefixes) and any path with a file extension give a JSON 404, never
  `index.html`. The ingestion and workers apps do not include the UI. The same-origin write guard and OIDC/session
  auth are untouched. A missing project is rendered by the SPA (no server-side 404 page any more).
- **Router basename** is the root path (was `{root}/app`): `lib/runtime.ts`, `vite.config.ts` (dev bootstrap plugin
  now `apply: 'serve'` and injects `<base href="/">`; the dev proxy no longer forwards `/static`, `/ui`, `/login`),
  Playwright config and all specs (`APP` is `''`). `index.html` carries the bootstrap marker right after the charset
  meta so `<base>` precedes every URL. The skip link no longer navigates to the base URL.
- **Removed:** `_static/dashboard/` (all vanilla pages/JS/CSS), the `/static` mount, the vanilla page routes in
  `api/runs.py` (+ their guards, project-not-found page, canonical analyzer redirects: the SPA does those redirects),
  `GET /login` in `api/auth.py`, `test_dashboard_static.py` and ~60 vanilla-driving test files (table below).
- **Moved:** docs HTML partials -> `frontend/src/features/docs/partials/` (`plugins/docs-content.ts` reads them there);
  the frozen run export template + its CSS/JS -> `packages/platform/qym_platform/export_templates/run/`.
- **Exports (server features):** `GET /api/runs/{id}/export-html` (unchanged output, now `services/html_export.py`) and the new
  `GET /api/compare/export-html?files=a&files=b` (2..8 runs: summary table + one tab per run holding that run's own offline
  export). The compare page's "Legacy page" link became an "Export HTML" button. Tests: `test_private_test_sets.py`
  (visibility, validation), `test_run_view_api.py`, `test_export_template_static.py`, `test_xss_rendering_browser.py`.
- **Build/ship:** Dockerfile already builds `npm ci && npm run build && npm run build:sdk`; `pyproject.toml` package-data now
  `_static/app/**/*` + `export_templates/run/*`; `scripts/check_wheels.py` fails a platform wheel without the built app,
  with a stale dashboard, or with modified export templates; `.github/workflows/tests.yml` builds the bundles before pytest
  and has a new `frontend` job (`npm run check`, build, Playwright chromium `--workers 2`, `e2e:sdk`).
- **Docs:** README, USER_GUIDE, OPERATIONS ("Serving the UI"), AGENTS, DESIGN_LANGUAGE, frontend/README describe the React app as the UI.
- **Lint:** `tests/platform/test_design_language.py` now just runs `frontend/src/__tests__/design-language.test.ts` (one source of truth).
- Small product fixes found while porting tests: member-removal transfer picker excludes disabled members; dataset metric
  with no direction is not coloured higher-is-better; draft JSON import `{"id":0}`; trash Restore column sticky;
  `run_versioning.py` NOT EXISTS correlation (500 on the "Empty / Missing" versioning facet).

## URL map (old -> new)

| old | new |
|---|---|
| `/`, `/login`, `/profile`, `/admin[/tab]`, `/trash`, `/compare`, `/reviews`, `/docs-guide`, `/run/{id}[/analyzer]`, `/projects/{slug}[/overview\|charts\|models\|experiments[/queue]\|datasets[/..]\|analysis\|reviews\|settings\|runs/{id}[/analyzer]]` | same URLs, now served by the React app |
| `/app` and `/app/<anything>?query` | 302 to `/<anything>?query` (fragment kept by the browser) |
| `/static/*` (dashboard assets) | removed (404); app assets are `/assets/<hash>` |
| `/login` server-rendered page | SPA login; providers from `GET /v1/auth/providers` |
| `/docs-guide` | `/docs/...` (client redirect) |
| `/run/{id}/analyzer`, `/projects/{slug}/runs/{id}/analyzer`, `?scope=diagnosis\|project\|dashboard` | client redirects/alias parsing (`RunAnalyzerRedirect`, `useAnalyzerRoute`) |
| compare "Legacy page (HTML export)" | `GET /api/compare/export-html` |
| `GET /api/runs/{id}/export-html` | unchanged |

## pytest migration

Counts are test functions; "covered" means an equivalent Playwright/Vitest assertion exists (existing, or added as `cutover-*`).
Full per-function notes are in the group reports below (condensed).

### Group 1: run page, analysis, compare logic (golden payloads)
Server payloads that vanilla JS used to be run against in Node are now frozen as `tests/platform/fixtures/golden/*.json`
(`_support_a1.py`; regenerate with `QYM_UPDATE_GOLDEN=1`), asserted by pytest on the server side and by Vitest
(`cutover-server-payloads.test.ts` etc.) on the React side.

| file | converted / covered / deleted |
|---|---|
| test_run_page_render_browser | 0 / 10 / 12 |
| test_run_page_nav_browser | 0 / 14 / 1 |
| test_run_page_structure_browser | 0 / 6 / 6 |
| test_report_section_visibility_browser | 0 / 5 / 2 |
| test_pass_revision_browser | 0 / 3 / 0 |
| test_auto_analysis_release_gate_browser | 0 / 13 / 0 |
| test_run_metadata_json_browser | 1 / 2 / 0 |
| test_score_edit_browser | 0 / 2 / 0 |
| test_item_reasons | 0 / 2 / 0 (JS tests removed) |
| test_review_rules_browser / test_review_rules | 0/2/1 ; 1/4/0 |
| test_lost_outcomes_browser / test_lost_outcome_events | 2/0/0 ; 5/0/0 |
| test_root_cause_issue_javascript | 0 / 20 / 5 |
| test_issue_solution_flow | 0 / 3 / 2 (Sankey dropped, decisions/run-detail) |
| test_error_distribution_visibility | 0 / 1 / 0 |
| test_compare_filter_fields_javascript / test_run_filter_fields_javascript | 0/4/0 ; 0/3/0 |
| test_p1b_correction_status | 0 / 1 / 2 |
| test_minimize_errors / _browser | 7/3/1 ; 1/6/2 |
| test_metric_semantics / _browser | 2/4/2 ; 0/9/0 |
| test_run_means, test_model_stats | 3/0/0 ; 3/1/0 |
| test_compare_error_counts | 0 / 8 / 4 |
| test_repeat_task_errors_per_pass, test_repeat_review_semantics | 3/0/0 ; 4/1/0 |
| test_run_versioning_filter, test_run_origin_filter | 0/1/0 each |
| test_run_issue_review_status_browser | 0 / 0 / 1 (finding below) |
| test_xss_rendering_browser (trimmed: export checks kept) | 6 / 4 / 0 |
| test_safe_html | 11 / 0 / 1 (guards retargeted at `export_templates/run`) |
| test_frontend_row_indexes | 0 / 0 / 1 (vanilla loader optimisations; error contract covered by `cutover-metric-rules.test.ts`) |
| test_runs_order_js | 0 / 6 / 1 |
| test_run_review_workflow, test_score_edit_validation | 0/2/0 ; 2/0/0 |
| test_analysis_routes | 0 / 6 / 2 |
| test_run_versioning_details, test_run_experiment_panel, test_run_stop_reflection | 3/1/0 ; 1/2/1 ; 0/3/0 |
| test_compare_baseline_browser | 0 / 8 / 1 |

### Group 2: runs list, dashboard, overview, models, steps
| file | converted / covered / deleted |
|---|---|
| test_dashboard_views | 1 / 1 / 0 (golden JSON replaces the Node oracle) |
| test_p1_a11y_visual | 0 / 5 / 3 |
| test_runs_kpis_browser (renamed test_runs_kpis) | 2 / 1 / 0 |
| test_step_latency_browser | 0 / 10 / 21 |
| test_runs_frozen_columns_browser | 0 / 3 / 14 (frozen-column choice dropped, decision section 9.4) |
| test_runs_column_visibility_browser | 0 / 8 / 0 |
| test_runs_list_p1_browser | 0 / 9 / 3 |
| test_versioning_filter_browser | 1 / 2 / 0 |
| test_dashboard_paging_browser | 4 / 5 / 2 |
| test_dashboard_backfill_browser | 1 / 4 / 3 |
| test_runs_compare_selection_browser | 0 / 11 / 0 |
| test_p1_navigation_browser | 0 / 15 / 6 |
| test_archived_project_browser | 0 / 19 / 0 |
| test_performance_views_browser | 6 / 8 / 3 |
| test_overview_performance_browser | 1 / 5 / 3 |
| test_models_paging_browser | 2 / 6 / 0 |
| test_dashboard_pass_deletion_browser | 1 / 5 / 1 |
| test_dashboard_error_types_browser | 0 / 2 / 1 |
| test_ingest_incomplete_browser | 0 / 4 / 0 |
| test_dashboard_orchestration_browser | 0 / 2 / 0 |
| test_scroll_hold_browser | 0 / 0 / 3 (scroll hold not ported: decisions/foundation Q) |
| test_best_run_scope_browser | 0 / 2 / 0 |
| test_p0_final_review_browser | 0 / 6 / 2 |
| test_shared_components_browser | 0 / 7 / 2 |

New API-level files: `test_run_view_api.py`, `test_dashboard_models_api.py`, `test_dashboard_backfill_api.py`,
`test_dashboard_versioning_empty_facets.py`; shared helpers in `_support_a2.py`.

### Group 3: experiments / environments
| file | converted / covered / deleted |
|---|---|
| test_experiments_ui | 0 / 6 / 6 |
| test_eval_queue_ui | 0 / 6 / 6 |
| test_eval_environments_ui | 1 / 4 / 6 |
| test_official_defaults_editor | 0 / 5 / 1 |
| test_promote_to_official | 0 / 4 / 0 |
| test_experiment_matrix | 0 / 3 / 1 |
| test_experiment_global_model_api | 0 / 1 / 0 |
| test_experiment_launch_ui | 0 / 11 / 3 |
| test_experiment_launch_sweeps | 0 / 6 / 4 |
| test_experiment_launch_advanced | 0 / 5 / 3 |
| test_experiment_launch_base | 0 / 4 / 1 |
| test_experiment_launch_best_run | 0 / 2 / 1 |
| test_eval_multi_env | 0 / 1 / 0 |
| test_experiment_launch_{any_values,browser,evaluator_schema,versioning,global_model,presets,json}_browser, test_experiments_versioning_browser | 0 / 5, 11, 3, 3, 12, 6, 9, 1 / 0, 3, 0, 0, 0, 0, 0, 0 (files removed) |
| tests/test_restructure.py (2 failing tests) | 2 / 0 / 0 |

### Group 4: datasets, vanilla asset tests, shell, access
| file | converted / covered / deleted |
|---|---|
| test_dataset_editing_browser | 0 / 30 / 0 (+ `test_dataset_parity_fixtures.py` keeps slug/encoding parity) |
| test_dataset_search_browser | 0 / 5 / 0 |
| test_dataset_import_browser | 0 / 1 / 0 |
| test_dashboard_static (109) | 20 / 22 / 67 (15 export-template guards -> `test_export_template_static.py`; backend asserts -> `test_analysis_backend_contract.py`) |
| test_dataset_metric_colours_browser | 0 / 3 / 0 |
| test_access_admin_browser | 0 / 11 / 1 |
| test_reviews_queue_browser | 0 / 10 / 0 |
| test_platform_docs | 9 (repointed to the partials) / 0 / 1 |
| test_archived_project_read_only | 1 / 6 / 5 page tests removed |
| test_p1_final_fixes / _browser | 2/3/2 ; 0/1/2 |
| test_review_workflow_browser | 0 / 5 / 0 |
| test_shell_reexecuted_scripts, test_shell_page_stylesheets_browser, test_shell_navigation_browser | 0/0/2 ; 0/0/2 ; 0/0/1 |
| test_session_revocation, test_response_compression | 2/0/0 ; 2/0/0 |
| test_project_archive_delete | 1 / 1 / 0 |
| test_p1b_reviews_bulk_browser, test_p1b_member_removal_browser, test_login_form_browser | 0/2/0 each |
| test_process_layout, test_access_admin_p1 | 1/0/0 ; 1/0/0 |
| test_local_auth | 0 / 1 / 1 |

Totals are in the lead report. Reasons for deletions are always one of: the test asserts the deleted vanilla markup/CSS/asset
versioning/script order; the vanilla runtime (shell.js navigation, DOM patching, hand-rolled request orchestration) no
longer exists (React + React Query); the feature was dropped in the React rewrite and is recorded in `decisions/*`; or a
named duplicate.

## Findings from the port (product gaps, NOT fixed here; for the QA cycle)
Run page: no item-level analysis warnings; Approve offered from `issue.review_status` (ignores `review_issue_statuses`);
metric cards on task-failed rows; stale `passRevision` in IssueDialog; no approved-subcategory/solution pickers; "edited" tooltip
loses editor/date; zero-latency items hidden; no sticky section nav; Repeat help texts not direction-aware; no "spans not captured" note;
empty-object metadata preview. Runs list: passes panel rows not openable, no per-pass error counts/chips/stale-status coercion, no
repeat performance curve; lower-is-better error explanation gone; `useDeletePasses` sends no `expected_pass_version` (second pass delete
409s: `test.fail` in cutover-passes); pass picks not renumbered after delete; Back does not restore the table's scroll; Back to `?item=` re-scrolls.
Compare: Errors tab grouping, Sweep delta tint ignores direction, analytics tab resets when a run is removed, missing run ids unnamed.
Shell/other: topbar KPI chips clip at 768/900px and blank on reload; select column not pinned; Langfuse CTAs still shown (decisions/compare Q6);
Models page ignores global runs filter (Q7); review history not refetched after approve; ReviewsPage All-tab focus/advance and "Approve 0"
dialog; EvaluationSection lacks the evaluator-schema source note; no test that environment write controls are hidden from non-managers;
JsonFields typing `[1, 2]` char-by-char stores a string; Analyzer under a wrong project slug is not redirected;
login form: error not cleared on keystroke, confirm field not refocused; global-setup warm-up 401s under `QYM_E2E_AUTH_MODE=proxy_headers`.
Server: `export-html` templates still contain a lazy `/static/codemirror-bundle.js` path (unreachable offline). No server 404 for unknown projects.

## Final test evidence
See the end of this file (filled in at merge time).

### Evidence (worktree `qym-wt-cutover`, 2026-10-12)

| check | command | result |
|---|---|---|
| Frontend check | `cd frontend && npm run check` (tsc -b, eslint, stylelint, vitest, design test) | clean; Vitest 107 files / 1038 tests (incl. design-language 34) |
| Build | `npm run build` / `npm run build:sdk` | ok; entry chunk `index-*.js` 302 kB (98 kB gzip), CodeMirror chunk 432 kB, Trend chart 386 kB |
| Playwright (app) | `npx playwright test --workers 2` | 727 passed, 11 skipped, 1 timing flake (`runs-list/cutover-navigation.spec.ts` "Back restores sort, page, scroll position", passes 2/2 alone); 4 `test.fail` FINDING guards count as passed |
| Playwright (SDK) | `npm run e2e:sdk` | 33 passed |
| pytest | `pytest -q -n 4 tests/platform tests/sdk tests/test_restructure.py` | 3321 passed, 743 skipped (PostgreSQL cases), 1 timing flake (`test_force_stop_maintenance::test_maintenance_and_terminal_closure_coexist[True]`, passes alone) |
| Wheels | `pip wheel packages/{sdk,platform} --no-deps` then `scripts/check_wheels.py` | ok; platform wheel lists `qym_platform/_static/app/index.html`, `assets/index-*.js`, `export_templates/run/run.html`, no `_static/dashboard` |
| Docker | `docker build -f docker/Dockerfile --target final .` (podman) | ok; image has `_static/app/{index.html,assets}` and `export_templates/run/` |
| Served build | uvicorn with `QYM_ROOT_PATH=/qym`, chromium: `/`, `/projects/x`, settings tab deep link, docs page, `/admin/users`, `/app/projects/x` redirect, reload | all render, no console/network errors |
