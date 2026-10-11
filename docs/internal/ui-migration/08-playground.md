# Playground (AI Evaluator / Auto-analysis workspace) — migration brief

Written by an analysis agent for the React/TypeScript/Vite migration. Audience: the
component agent that will rebuild this area from scratch in `frontend/`. Be concrete:
file paths with line numbers, API routes with methods and response shapes, exact
behaviors. No marketing language.

**What "Playground" actually is.** `playground.js` is not a free-form prompt
playground. `window.QymPlayground` is the **LLM root-cause analyzer workspace**: it
lets a project manager / run owner configure the analyzer prompt (project rules,
reference documents, category catalog, additional instructions with `{variables}`,
field/JSON-path mapping), preview the exact messages, test one item, and run a
background analysis job over the failed items of a run. It persists nothing in the
browser; all state is server-side (rules versions, documents, catalog) or ephemeral
per page load. There is no streaming on the UI side: jobs are polled.

All paths below are relative to `packages/platform/qym_platform/` unless absolute.

## 1. Surface inventory

| page/route | HTML file | JS/CSS files it loads | entry function(s) | approx LOC |
|---|---|---|---|---|
| `/projects/{slug}/analysis` (project scope, no run) and `/projects/{slug}/analysis?run={id}[&pass=N][&metric=M][&scope=run\|categories\|rules\|documents]` — served by `api/runs.py:2438` `project_analysis_ui` | `_static/dashboard/analyzer.html` (6170 lines: ~3550 lines inline `<style>`, ~2500 lines inline script) | `dashboard.css`, `shell.css`, `ui_components.css`, `qym_safe.js`, `auth.js`, `shell.js`, `metrics.js`, `qym_table.js`, `playground.js`, `ui_components.js` (defer) | `analyzer.html:5915` `initializePlayground(projectScoped)` → `QymPlayground.init({...})` + `open()`; `analyzer.html:5208` `composeAnalyzerWorkspace(parts)` re-parents the playground DOM into tabs | analyzer.html 6170 + playground.js 6321 |
| `/projects/{slug}/runs/{run_id}/analyzer` (run scope) — `api/runs.py:2457`; canonicalised to the `?run=` form by `_canonical_project_run_analyzer_redirect` (`api/runs.py:1582`) | same | same | same | — |
| `/run/{run_id}/analyzer` (legacy) — `api/runs.py:2424`, redirects to project URL via `_canonical_legacy_analyzer_redirect` (`api/runs.py:1516`) | same | same | same | — |
| Compare page modal ("Auto-Analyze" button `#compare-auto-analyze-btn`, `compare.html:5559`, hidden by `renderRootCauseSection` at `compare.html:11748`; effectively a fallback path) | `_static/dashboard/compare.html` | `playground.js` (`compare.html:17`) | `compare.html:16403` `QymPlayground.init({apiUrl, getRunId, getRows, getMetric, getThreshold, onAnalysisComplete, showToast, escapeHtml})`; `openComparePlayground()` at `compare.html:8141` | modal path only (`playground-overlay` / `playground-modal` CSS at `dashboard.css:5605-5660`) |
| Run page entry link | `run.html:6544` `analyzerUrl()` → navigates to the project analyzer URL | — | — | — |

Shell integration: `shell.js:106-118, 174-188, 248-250, 636, 660-674, 733` recognise the
three URL shapes, label the nav item "Auto-analysis" (`page: 'analysis'`), and derive the
project slug for the legacy `/run/{id}/analyzer` form.

The analyzer page also contains a disabled "Dashboard" tab (`AUTO_ANALYSIS_DASHBOARD_ENABLED = false`,
`analyzer.html:3691`; `?scope=dashboard` is rewritten to `scope=run` at `:3700`). The
dashboard code (`analyzer.html:4088-4990`) is out of scope for this brief and is DROP-CANDIDATE
(dead behind a kill switch, covered by `tests/platform/test_auto_analysis_release_gate_browser.py:729`).

## 2. User journeys (as-is)

### J1. Open auto-analysis for a run and analyze its failed items
1. From a run page the user clicks the analyzer link (`run.html:6544`) → `/projects/{slug}/analysis?run={id}`.
2. Page shows a skeleton (`#analysis-loading`, `data-qym-skeleton="cards"`), fetches
   `GET api/runs/{id}?view=summary` (`analyzer.html:6010`), then for repeat runs
   `GET api/runs/{id}/passes`. If the run has >1 samples and no valid `?pass=`, the
   **sample picker** (`showPassPicker`, `:5957`) is shown instead of the workspace; choosing a
   sample calls `history.replaceState` with `?pass=N&scope=run` (`rememberPassInUrl`, `:6102`).
3. Compact rows load: `GET api/runs/{id}?view=compact[&pass_number=N]`, then
   `POST api/runs/{id}/items/details {item_ids:[first 20]}` to get bodies for JSON-path
   discovery (`fetchAnalyzerRows`, `:6058-6092`).
4. `QymPlayground.open()` loads in parallel `GET …/analysis-config` (required),
   `GET …/analysis-documents` and `GET …/analysis-rule-versions?include_deleted=true`
   (optional; failures become a warning banner `#pg-load-problems`, `playground.js:629-701`).
   Then `_createModal()` builds the entire DOM as one HTML string (`_buildScrollContent`,
   `playground.js:3222-3403`) and `composeAnalyzerWorkspace` (`analyzer.html:5208-5827`)
   tears it apart into 4 tab panels: **Analyze run**, **Diagnosis** (categories), **Rules**, **Documents**.
   Active tab is `?scope=` (`run|categories|rules|documents`; `diagnosis`→`categories`,
   `project`→`rules`; `analyzer.html:3697-3708`), updated with `history.replaceState` on tab click (`:3951`).
5. On the **Analyze run** tab the user sees: run card (name, task, model, dataset, sample
   `<select>` for repeat runs, "View run" link), metric chips (checkbox list, Select all / Clear),
   "Additional instructions" textarea, **Targets** card (Max Score slider, "Skip analyzed",
   "Re-analyze human labels", Timeout (s), Analyze limit with steppers, item cards list paginated
   10/page, "Input mapping" button → modal with Variable Mapping, "Max issues per item" number),
   **Prompt preview** card (auto-updating, Settings popover with "Production rules / Project
   documents / Trace evidence" toggles), and a sticky footer: LLM connection `<select>`,
   "Test Selected", "Analyze N items", hidden "Cancel analysis".
6. Clicking a metric-target row in an item card selects it (`aria-pressed`), re-renders the
   preview (`POST …/analyze-preview`, debounced 500 ms).
7. "Test Selected" → `POST …/analyze-test` (synchronous LLM call, nothing saved) → result
   card(s) under "Test Results" with issues, confidence, error/retry notes, "Fields:" badges
   derived by regex from the system prompt, collapsible "Item Context".
8. "Analyze N items" → if "Re-analyze human labels" is on and human diagnoses are in scope, a
   confirm dialog (`_confirmHumanOverwrite`, `playground.js:6259`) → `POST …/analysis-jobs`
   (202) → poll `GET …/analysis-jobs/{job_id}` every 600 ms (`_pollAnalysisJob`, `:397-448`),
   progress bar + phase text (`analyzing`, `retrying`, `aggregating`, `completed`), "Cancel analysis"
   button → `POST …/analysis-jobs/{id}/cancel`.
9. Completion: `_finishRunAll` (`:261-368`) renders a done card (success / partial / failed,
   error-code summary, "View run" link to the run page), a toast, and calls
   `onAnalysisComplete` → `applyAnalysisResults` (`analyzer.html:5829`) which patches the
   in-memory rows so "Skip analyzed" now excludes them. Progress bar hides after 3 s.
   Reload / return later: `GET …/analysis-jobs/active[?pass_number=N]` resumes polling (`:454-474`).
- Error states: config 403 → toast "You do not have access…" and page error panel with Retry
  (`showAnalyzerLoadError`, `analyzer.html:5900`); no LLM connection → warning banner
  (`playground.js:2054`) and Test/Analyze disabled; zero targets → footer hidden and an empty
  message with "Include analyzed targets" and "Open Reviews" (`:3525-3534`).
- Keyboard: Escape closes the modal only in compare mode (`_onKeyDown`, `:2148-2162`);
  Enter/Space on item target rows; Escape closes Input mapping (`analyzer.html:5166`) and the
  preview Settings popover (`:5779`).
- Persisted state: none in browser. URL carries `run`, `pass`, `metric`, `scope`.
  Busy guard: switching sample while a job/test runs is refused (`switchToPass`, `analyzer.html:6122`).

### J2. Project-scope workspace (no run): manage rules, documents, categories
1. Nav "Auto-analysis" → `/projects/{slug}/analysis`. `initializePlayground(true)`:
   `getRows → []`, `getRunId → ''`, `dedicatedPage: true`. Analyze-run tab shows the landing
   "Select a run from Runs" (link to `/projects/{slug}?qym_analysis_run_picker=1`).
2. **Rules tab**: rule list (10/page, search, select-all/delete-selected, expand to edit title +
   instruction, metadata "Inferred from / Why this rule helps"), toolbar badge "Editable draft"
   / "Read-only", "Version history" button → shell drawer with version list and an SVG lineage
   graph (`renderRuleGraph`, `analyzer.html:5064-5143`), per-version overflow menu (Download JSON,
   Compare with…, Merge with…, Delete version), Publish / Promote action, footer with
   "Add documents" checkbox + count, "Add examples" button + count, "Create draft", "Generate rules".
3. Editing a draft auto-saves 700 ms after input (`_scheduleAnalysisRuleAutoSave`,
   `playground.js:4804`) via `PATCH …/analysis-context`. Non-draft versions are read-only.
4. "Generate rules" → `POST …/analysis-rule-jobs` → poll `GET …/analysis-rule-jobs/{id}` (600 ms);
   the run-progress bar is physically moved into a "Rule generation progress" card
   (`_moveAnalysisProgressToRules`, `:4885`), phases `queued|preparing|generating|persisting|completed`.
5. "Add examples" opens the **approved-example picker** dialog (`_openApprovedExamplePicker`,
   `:2980-3220`): search (250 ms debounce), facet selects (task, dataset, model, run, user),
   source segmented control, confidence range, "Choose prompt fields" checkbox panel, table
   with per-row checkbox, select-all-filtered, "View selected", character-budget progress bar,
   "Use N selected examples [in patches]". Data via `POST …/analysis-examples`.
6. **Documents tab**: dropzone/file input (multi, drag-drop, Enter/Space), sequential uploads
   `POST …/analysis-documents` (multipart). A 409 `DOCUMENT_CONTENT_CONFIRMATION` opens a confirm
   dialog and re-uploads with `large_document_action=full`. Library list with Included/Excluded
   toggle (`PATCH`) and delete (confirm + `DELETE`).
7. **Diagnosis tab**: category sidebar (search, status dot validated/needs examples), editor with
   tabs Guidance (Description / Use when, both required), Subcategories (search, Approved only /
   All filter, add/remove, per-subcategory Description / Use when), Examples (approved
   corrections, `<details>` per example). "Add category", "Save changes" →
   `PUT api/projects/{slug}/analysis-category-catalog` with `base_revision` (optimistic lock).
   Background refresh of approvals on focus/visibilitychange/pageshow (`refreshProjectApprovals`,
   `analyzer.html:3860-3909`) swaps in new examples unless there are unsaved edits.
- Read-only members: banners (`playground.js:2062-2074`), inputs readonly/disabled, upload card hidden.

### J3. Compare page modal (fallback)
`compare.html:16396-16516`: the modal variant (`playground-overlay` fixed, 90vw×90vh,
header "LLM Analyzer" with ×). Same sections rendered as `<details class="pg-section">`
accordions, no tabs. `onAnalysisComplete` patches compare rows. The button is hidden by
`renderRootCauseSection` whenever the comparison renders, so this path is rarely reachable.

## 3. Functional inventory

### Bootstrap / scope
- Scope resolution run vs project: `_analysisContextPath` (`playground.js:711`) → `api/runs/{run_id}/…` or `api/projects/{slug}/…`. MUST-KEEP.
- Config load with optional panels + problem banner (`:629-701`). MUST-KEEP.
- Permission flags → read-only workspace (`can_operate_analyzer`, `can_manage_analysis_rules`, `can_manage_category_catalog`, versions `can_delete/can_activate/can_restore`). MUST-KEEP.
- Resume active analysis job and active rule-inference job on open (`:454`, `:5114`). MUST-KEEP.
- Sample (pass) picker and in-place sample switching with URL update (`analyzer.html:5957, 6102-6160`). MUST-KEEP.
- First-20-rows body fetch for JSON path discovery (`analyzer.html:6058-6092`). MUST-KEEP (could become lazy on opening Input mapping).

### Analyze-run tab
- Metric chips with Select all / Clear; selection feeds `getMetrics` and target filtering (`analyzer.html:4062-4086`). MUST-KEEP.
- Client-side target filter `_getMatchedItems` (`playground.js:1912-1995`): item_filter fixed to `failed`; per-metric threshold + direction (minimize/maximize); skip execution errors (`QymMetrics.isMetricErrorMeta`); "Skip analyzed"; "Re-analyze human labels"; max-score cap only for maximize metrics. MUST-KEEP — but the server re-applies the same filter (`_filter_analysis_targets`, `api/analysis.py:3981`); the client copy exists only for the count/preview. Consider a server "count targets" dry-run instead (see §8).
- Analyze limit (text input, digits only, max 4 chars, ± steppers) + footer label "Analyze N items" (`:5732-5756`, `:5917-5950`). MUST-KEEP.
- Timeout seconds input, clamped to `analysis_defaults` (`:5907`). MUST-KEEP.
- Item cards (10/page, `QymUIComponents.renderPagination`), each metric target a toggle button; root-cause chips with colour map `_RC_COLORS` (`:1499`), confidence dot. MUST-KEEP (virtualise not needed at 10/page).
- Additional instructions textarea; `{var}` detection (`_detectCustomVars`, `:1872`, reserved `categories`) → custom-variable mapping rows appear live. MUST-KEEP.
- Variable Mapping (in "Input mapping" modal): INPUT/EXPECTED/ACTUAL → source select (`input|output|expected|error|metric_metadata`); JSON path picker tree with "Use full value", tri-state parents, `[*]` arrays, prune to shortest covering paths (`:1574-1870`); "Include in prompt" toggles Error / Scores / Metric Metadata; metric-metadata picker grouped by metric, all-selected by default. MUST-KEEP.
- "Max issues per item" (1–10, default from config) moved into the Targets toolbar. MUST-KEEP.
- Prompt preview: debounced 500 ms (0 ms on structural changes, 900 ms on path picker) `POST analyze-preview`; role-labelled messages; regex syntax highlighting (`_highlightPreview`, `:1516-1568`); expand/collapse; copy to clipboard with 1.5 s check icon; "Final prompt: N characters" line. MUST-KEEP; highlighting NICE.
- Preview "Settings" popover: Production rules / Project documents / Trace evidence toggles (`pg-use-project-rules|documents|trace`), with arrow links to the Rules/Documents tabs. MUST-KEEP.
- Test Selected (1 item, sync) + result cards (`_renderTestResults`, `:6157-6255`): issues list, legacy single-layout, error/retry, "Fields:" badges derived by regexing the prompt, Item Context `<pre>`. MUST-KEEP; regex-derived badges DROP-CANDIDATE (fragile; ask backend to return `fields_used`).
- Run all: confirm human overwrite; job POST; polling; progress phases incl. retry detail; cancel; completion card with error-code groups; toast; "View run" link; `onAnalysisComplete` row patch. MUST-KEEP.
- Results card auto-hides via MutationObserver (`analyzer.html:5796-5813`). DROP-CANDIDATE (React state replaces it).
- Footer hidden when 0 targets or not on run tab (`:5935-5943`, `analyzer.html:3939`). MUST-KEEP.

### Rules tab
- Version list (desc by version), state badge Live/Draft/Published, relative dates, overflow menu, keyboard Enter/Space to open, click-outside closes menus (`:2544-2579`, `:5331-5430`). MUST-KEEP.
- Lineage SVG graph in the history drawer (`analyzer.html:5064-5143`, uses `parent_version_id`, `merge_parent_ids`). NICE.
- Open version (read-only unless draft); Create draft (`POST analysis-rule-versions {from_version}`); Publish form dialog with "Set as production" (`:4673-4720`); Promote (`/activate`); Delete version (confirm, `DELETE`); Download JSON blob (`:4651`); Compare (`:compare?base=`) rendered as changed/added/removed `<details>`; Merge preview + conflict resolution (target/source/custom) then apply (`:4419-4612`). MUST-KEEP (Download: NICE).
- Rule editor: search, pagination 10/page, expand-to-edit, select/delete-selected, Add rule, validation (title+instruction required, focus first invalid), 700 ms auto-save to draft, busy-state disabling (`:2329-2506`, `:3947-4020`, `:4804-4867`). MUST-KEEP.
- Rule count line "N rules · ~T prompt tokens · no rule count limit" (`:2319`). NICE.
- Generate rules: sources = documents checkbox + selected approved examples; availability messages (`_inferenceSourceState`, `:2272-2317`); job polling with phase mapping; result status text with `changes.added`, `inference_stats.writer_calls`. MUST-KEEP.
- Approved-example picker dialog (full feature list in J2.5), Escape layering (dropdown → table menu → filter panel → fields panel → dialog), focus return to opener. MUST-KEEP.

### Documents tab
- Upload (sequential), large-doc confirm (409 code), per-file error toast, status line; include/exclude toggle (optimistic disable + revert on error); delete with confirm; badge "N of M enabled"; "Selected document content: N characters across M documents" line. MUST-KEEP.

### Diagnosis tab
- Category sidebar nav + search; only categories with approved examples are listed ("approved" = `category_example_counts > 0`), others stay in DOM for full-snapshot saves (`_approvedCategoryGroups`, `:1081`). MUST-KEEP (but see §9 Q3).
- Category tabs Guidance / Subcategories / Examples with ARIA tablist + arrow-key nav (`:5619-5629`). MUST-KEEP.
- Subcategory list: search, approved-only filter, 10/page, add (reveals draft even if filtered), remove, per-subcategory taxonomy; example-only labels are read-only and excluded from saves (`data-example-only`). MUST-KEEP.
- Add category (input reveals on first click), remove category (confirm). MUST-KEEP.
- Save catalog: client validation of required taxonomy for all categories and touched/new subcategories, `PUT …/analysis-category-catalog`, revision tracking, "Saved / Unsaved changes / Saving… / Taxonomy required / Save failed" badge (`analyzer.html:5511-5657`). MUST-KEEP.
- Approval signature polling (focus/visibility/pageshow, ≥1 s apart) and deferred refresh when dirty (`analyzer.html:3805-3909`). MUST-KEEP (could become TanStack `refetchOnWindowFocus`).
- Summary line "N categories · M approved examples" via MutationObserver. DROP-CANDIDATE (derive from state).

### Hidden behaviours
- Polling: analysis job 600 ms, rule job 600 ms, 1 s reconnect backoff with generation counters to drop stale responses (`_analysisPollGeneration`, `_ruleInferencePollGeneration`).
- Debounces: preview 500/900/0 ms; rule auto-save 700 ms; example search 250 ms.
- Toasts via host `showToast` (`showStatus` on analyzer page writes `#analysis-status`, compare uses its toast).
- Confirm dialogs via `QymShell.openConfirmDialog`; form dialog via `openFormDialog`; drawer via `openDrawer`.
- Clipboard: copy prompt. Download: rule version JSON blob.
- No SSE/WebSocket used. `POST …/analyze-stream` exists server-side (`api/analysis.py:5006`, NDJSON events `started|progress|aggregating|error|done`) but the UI does not use it.
- Optimistic updates: document include toggle only. Everything else re-fetches.

## 4. Data & API contract

Auth: all routes `Depends(require_ui_principal)` (session cookie; same-origin `fetch`, no
custom headers). Error envelope: FastAPI `{"detail": string | {code, message, …}}`;
the UI reads `detail.message || detail` (`_responseErrorMessage`, `playground.js:4796`).
No pagination except the examples picker (body `page/page_size`) and client-side lists.
`{scope}` below = `api/runs/{run_id:path}` or `api/projects/{project_slug}` — every
project-scoped twin at `api/analysis.py:7808-8440` delegates to the run-scoped handler with
a synthetic scope id (`_resolve_analysis_scope`, `api/analysis.py:225-258`).

| method | path | query/body | response shape | used by |
|---|---|---|---|---|
| GET | `{scope}/analysis-config` (`api/analysis.py:7600`, project `:7808`) | — | `{llm_configured: bool, model, llm_connections: [{id, name, llm_model, is_default, llm_api_key_set}], default_connection_id, analysis_rules: Rule[], analysis_rule_version: Version\|null, can_manage_analysis_rules, can_operate_analyzer, can_manage_category_catalog, can_restore_analysis_rules, total_items, items_with_root_cause, items_ai_assigned, items_without_root_cause, correction_bank_size, approved_example_count, enabled_document_count, analysis_limits: {document_upload_bytes, rule_writer_document_characters, rule_writer_example_characters, rule_writer_prompt_characters, …nulls}, analysis_defaults: {request_timeout_seconds, max_timeout_seconds, max_timeout_retries}, default_system_prompt, default_categories: string[], max_root_cause_categories, default_solution_categories, category_details_map: {cat: string[]}, category_taxonomy: {cat: {description, when_to_use}}, subcategory_taxonomy: {cat: {sub: {description, when_to_use}}}, category_example_counts: {cat: n}, category_examples: {cat: Example[]}, existing_details, category_catalog_version, category_catalog_version_id, category_catalog}` where `Example = {id, item_id, metric_name, pass_number, run_name, dataset, model, root_cause_issues, detail, note, solution, solution_note, input, expected, output, created_at}` | `_fetchConfigAndOpen`, `refreshProjectApprovals` |
| GET | `{scope}/analysis-documents` (`:5371`) | — | `{documents: Doc[]}`, `Doc = {id, name, content, characters, source_characters, truncated, selected, content_over_limit, content_was_cut, created_at, …}` (`:5341`) | open |
| POST | `{scope}/analysis-documents` (`:5397`) | multipart `file`, `large_document_action: ask\|full` (`truncate` → 400) | `{document: Doc, content_decision: "full", warning: null}`; 409 `{detail:{code:"DOCUMENT_CONTENT_CONFIRMATION", filename, source_characters, review_threshold, actions}}`; 413 >10 MB; 415 unsupported | upload |
| PATCH | `{scope}/analysis-documents/{id}` (`:5486`) | `{selected: bool}` | `{document: Doc}` | include toggle |
| DELETE | `{scope}/analysis-documents/{id}` (`:5513`) | — | `{ok: true, document_id}` (403 unless uploader or manager) | delete |
| GET | `{scope}/analysis-rule-versions?include_deleted=true` (`:6632`) | — | `{versions: Version[], can_delete, can_activate, can_restore, production_version_id}`; `Version = {id, version:int, name, description, status: draft\|published\|archived, rules: [{id, title, instruction, inferred_from?, explanation?}], rule_count, source, parent_version_id, base_version_id, merge_parent_ids[], merge_base_version_ids[], content_hash, aliases[], is_active, is_deleted, created_by: {id, display_name}\|null, created_at, updated_at, published_at, activated_at, deleted_at, restored_at, …_user_id}` (`:635-706`) | open, every rule mutation |
| POST | `{scope}/analysis-rule-versions` (`:6683`) | `{from_version: id, description?}` | `{version: Version}` | Create draft |
| PATCH | `{scope}/analysis-context` (`:6121`) | `{analysis_rules: [{id?, title, instruction}], create_new_version: bool, rule_version_id, from_version?}` | `{analysis_rules: Rule[], rule_version: Version}` | auto-save, rule delete |
| POST | `{scope}/analysis-rule-versions/{version_number}:publish` (`:6729`) | `{set_alias: "production"\|null}` | `{version: Version}` (409 if not draft, 400 if empty) | Publish |
| POST | `{scope}/analysis-rule-versions/{id}/activate` (`:6978`) | — | `{active_version: Version}` | Promote |
| DELETE | `{scope}/analysis-rule-versions/{id}` (`:7025`) | — | `{deleted_version_id, active_version}` (409 if referenced) | Delete version |
| POST / DELETE | `…/{id}/restore`, `…/{id}/permanent` (`:7126`, `:7166`) | — | similar | wired in `_changeRuleVersion` (`playground.js:4246`) but no UI button |
| GET | `{scope}/analysis-rule-versions/{version_number}:compare?base={version_number}` (`:6828`) | — | `{base: Version, target: Version, summary: {added, removed, changed, unchanged}, added_rules: Rule[], removed_rules: Rule[], changed_rules: [{id, before: Rule, after: Rule}]}` | Compare |
| POST | `{scope}/analysis-rule-versions/{target_id}:merge` (`:6885`) | `{source_version, apply: bool, resolutions: {key: "target"\|"source"\|{title, instruction}}}` | `{version: Version, merge: {created_new_draft, …}}`; preview mode returns `preview: {summary:{changed, added, removed, conflicts}, conflicts: [{key, target: Rule, source: Rule}]}`; error detail may carry `preview` | Merge |
| POST | `{scope}/analysis-rule-jobs` (`:6579`, impl `:6533`) | `{include_documents, include_examples, approved_example_ids: int[], include_fields: {input, expected, output, previous_ai_root_cause(s), approved_root_cause(s), approved_detail, reviewer_reasoning: bool}, mode: "generate", rule_version_id, connection_id}` | 202/200 Job (below) with `created: bool`; 422 `NO_INFERENCE_SOURCES_SELECTED` | Generate rules |
| GET | `{scope}/analysis-rule-jobs/active`, `…/{job_id}`; POST `…/{job_id}/cancel` (`:6590-6630`) | — | `{job: Job\|null}` / Job. Job result (`:6440`): `{analysis_rules, rule_version: Version, mode, created_new_version, generated_rule_count, inference_stats: {writer_calls, patching_used, total_patches}, changes: {added, removed, changed, unchanged}, documents_used, examples_used, sources_used}` | polling |
| POST | `{scope}/analysis-examples` (`:6093`, impl `:5899`) | `{page, page_size(≤100), task[], dataset[], model[], run_name[], user_id[], source: ai_only\|human_only\|corrected\|null, conf_min, conf_max, search, selected_ids: int[], selected_only}` (manager only) | `{examples: [{id, item_id, root_causes[], detail, task, dataset, model, run_name, pass_number, corrected_by/reviewed_by: {id, display_name, email}, confidence, source: AI\|Human\|Corrected\|Unknown, source_characters, …}], total, page, page_size, page_count, matching_ids: int[], matching_characters, selected_ids, selected_count, selected_characters, facets: {tasks[], datasets[], models[], run_names[], users: [{id, display_name, email}]}, limits}` | example picker |
| POST | `api/runs/{run_id}/analyze-preview` (`:7250`) | `PreviewRequest {item_id, metric, config: PlaygroundConfig, connection_id, pass_number?, expected_pass_version?}` | `{messages: [{role, content}], metric_name, prompt_characters, prompt_limit: null, prompt_at_limit, prompt_truncated}` (no LLM call) | preview |
| POST | `api/runs/{run_id}/analyze-test` (`:7335`) | `TestRequest {item_ids: [1..3], metric, config, connection_id, timeout_seconds, pass_number?, expected_pass_version?}` | `{results: [{item_id, metric_name, root_cause, root_causes[], root_cause_issues: [{category, subcategory, finding, category_reason?, confidence?}], category_taxonomy, root_cause_detail, root_cause_reason, root_cause_note, warning, confidence, solution, solution_note, error, error_code, retry_count, retry_reason, request_timeout_seconds, messages}], categories, aggregation_error, retries}` (sync; can take > timeout seconds) | Test Selected |
| POST | `api/runs/{run_id}/analysis-jobs` (`:4723`) | `AnalyzeRequest {metric: null, metrics: string[], item_filter: "failed", max_score: 0..1, only_unanalyzed, allow_human_overwrite, threshold, config, connection_id, timeout_seconds, limit?, pass_number?, expected_pass_version?}` | 202 (new) / 200 (existing) `Job = {job_id, run_id, pass_number, status: queued\|running\|cancelling\|completed\|cancelled\|failed, progress: {phase: queued\|analyzing\|retrying\|aggregating\|completed\|failed, completed, total, errors, retries, item_id?, metric_name?, retry_reason?, retry_attempt?, retry_max_attempts?, retry_timeout_seconds?}, result, error, cancel_requested, created_at, updated_at, completed_at, created}` (`services/analysis_jobs.py:86-142`) | Analyze |
| GET | `api/runs/{run_id}/analysis-jobs/active?pass_number=N` (`:4775`); GET `…/{job_id}` (`:4798`); POST `…/{job_id}/cancel` (`:4818`) | — | `{job: Job\|null}` / Job. Completed `result = {total_analyzed, results: ResultPayload[], categories: {cat: n}, aggregated, aggregation_error, errors, retries, total_attempted, total_analysis_failed, …persistence totals}` (`:4521-4536`, `_analysis_result_payload :2412`) | polling |
| PUT | `api/projects/{slug}/analysis-category-catalog` (`:7913`) | `{categories[], category_details_map, category_taxonomy, subcategory_taxonomy, max_root_cause_categories, base_revision}` | `{catalog: {version, …}, created: bool}`; 409 on revision conflict | Save categories |
| GET | `api/runs/{id}?view=summary`, `?view=compact&pass_number=N`, `GET api/runs/{id}/passes`, `POST api/runs/{id}/items/details {item_ids}` (`api/runs.py`) | — | run header / compact rows (`snapshot.rows[]` with `metric_meta`, `pass_scores`, `pass_metric_meta`, `pass_metric_analyses`, `pass_attempts`, `item_metadata.metric_analyses`) / `{passes: [{pass_number, status, items_scored, items_total}]}` / `{rows}` | analyzer page bootstrap (owned by the Run Detail brief) |

`PlaygroundConfig` (`api/analysis.py:913-950`) fields the UI sends (`_buildConfigPayload`,
`playground.js:3628-3727`): `include_project_rules`, `include_project_documents`,
`additional_instructions` (≤20 000 chars), `max_root_cause_categories` (1–10),
`include_fields: {input, expected, output, error, scores, metadata, trace}`,
`metadata_fields: string[]` (only when a custom subset is chosen; values like
`metric_metadata:<urlencoded metric>.path`), `field_mapping: {input|expected|output: string | string[]}`,
`custom_variable_mapping: {var: string | string[]}`. In modal (compare) mode it also sends
`analysis_rules`, `reference_documents`, `root_cause_categories`, `category_details_map`,
`category_taxonomy`, `subcategory_taxonomy`; in dedicated-page mode those come from the
server's project context instead (`_analysis_config_with_project_context`, `:4539`).

Client-side reshaping worth knowing: rows are normalised by `analyzerRows()`
(`analyzer.html:3968-4046`) into `{item_id, index, input, input_full, output, expected,
error, item_metadata, metric_metadata, metric_metadata_by_metric, scores, metric_scores,
metric_thresholds, metric_directions, metric_score}` with per-pass selection; the
playground then recomputes "failed" per metric. Root-cause values arrive in three legacy
shapes and are normalised by `_rootCauseCategories` / `_rootCauseIssues` (`playground.js:787-860`).

LLM connections are managed elsewhere (`GET/POST/PUT/DELETE /v1/projects/{id}/llm-connections`,
`api/projects.py:557-700`); base URLs must be HTTPS unless `QYM_ALLOW_PRIVATE_LLM_BASE_URLS`
(`api/projects.py:212`, `api/eval_environments.py:180-195`). The playground only reads
`llm_connections` from config and sends `connection_id`.

## 5. Shared dependencies

- `qym_safe.js`: `QymSafe.escapeHtml` (all markup), `QymSafe.textDirAttrs` for RTL/Arabic on example/prompt blocks (`playground.js:863`).
- `ui_components.js`: `renderPagination(host, {total, pageSize, page, onPageChange})` (items, rules, categories, examples), `enhanceSelect(select, {className, label, placement, search, highlightSelection})` and `enhanceSelects(root, selector, fn)` (connection picker, mapping selects, example filters, merge resolution), `refresh(root)`.
- `shell.js`: `QymShell.openConfirmDialog({mount, title, description[], note, cancelLabel, confirmLabel, confirmClass})` → `{confirmed}`; `openFormDialog({fields:[{name, type:'checkbox', checkboxLabel, help}], onSubmit})` → `{confirmed, values}`; `openDrawer({title, subtitle, width, onClose}).setBody(el)`; `pageSignal()` AbortSignal for document listeners; `liftSkeleton`, `arrive` for the loading transition.
- `metrics.js`: `QymMetrics.isMetricErrorMeta`, `getRowScore`, `parseScoreValue`, `metricDirection` (row normalisation and target filter).
- `dashboard.css`: `.playground-*`, `.pg-*` (≈785 selectors, lines 5605–6995 and 8678–8700), `.custom-checkbox/.checkmark`, `.qym-tag`, `.qym-badge`, `.qym-chip`, `.qym-inline-action`, `.qym-icon-action`, `.qym-control/.qym-select/.qym-input`, `.qym-segmented`, `.qym-pagination`, `.qym-help-marker`.
- `analyzer.html` inline `<style>`: `.analysis-*` page layout (~300 `.pg-` overrides) — page-local.
- Exports consumed by others: `window.QymPlayground` is used by `analyzer.html` (`init/open/getConfig/refreshRuleView/filterCategories/refreshCategoryCatalog/refreshFilters/isBusy/clearResults`) and `compare.html` (`init/open`). The custom event `qym:rule-version-history-rendered` (`playground.js:4210`) drives the lineage graph. Nothing else imports playground.js.
- Run page (`run.html:6727, 6809`) and reviews reuse `analysis-category-catalog` endpoints — the category catalog model must be a shared TS type.

## 6. Design-token usage

- Tokens used heavily: `--space-xs/sm/md/lg/xl`, `--font-sm/base/md/lg/xl/title`, `--text-primary/secondary/muted`, `--bg-void/base/surface/elevated/hover/active`, `--border-subtle/default/strong`, `--accent-primary/secondary/tertiary/tertiary-soft`, `--success/--warning/--error/--info`, `--chart-1..5` and `--score-1..3` (root-cause colour map `_RC_COLORS`, `playground.js:1499-1505`; preview highlight classes `dashboard.css:8693-8699`), `--control-height`, `--control-radius`, `--radius-md`, `--radius-pill`, `--font-mono` (IDs, prompt text, JSON paths), `--font-sans`.
- Roles: section headers `--font-lg` + muted `--font-sm` description (analysis cards follow the DESIGN_LANGUAGE "major analytical section" rule); eyebrow `.pg-eyebrow`; badges `qym-badge--success|warning|neutral|danger|info`; counts `qym-tag--count`.
- Area-specific CSS that should become component styles: progress bar (`.pg-runall-progress`, `.pg-progress-fill`), result cards (`.pg-test-result-card`, `.pg-result-issue` with `--pg-root-cause-color` custom property), item target card (`.pg-item-card`, `.pg-item-target-row[aria-pressed]`), path-picker tree (`.pg-path-tree`, `--pg-path-level` indent), rule item / version row / overflow menu, example picker table (CSS grid "table" with `role=row/cell`), document dropzone, category workspace (sidebar + editor + tabs), preview message block with role pills.
- Deviations to fix during migration (not sanctioned exceptions): `.playground-modal` uses hardcoded `rgba(255,255,255,0.1)` borders, `border-radius: 16px`, gradient background; `.playground-footer` uses `rgba(20,20,30,0.8)` + `backdrop-filter`; `.pg-footer-btn` uses `padding: 12px 28px`, `border-radius: 8px`, `letter-spacing: 0.3px` (`dashboard.css:5638-5660, 6907-6935`); ~135 raw `px` values across the block. Emoji glyphs (✨ ⚠️ ✕ 🤖 ⏳) are used as icons (`playground.js:3393, 285, 6123`) — replace with the SVG icon set (`_icon`, `:1379-1403`) which is already token-friendly.
- Sanctioned exceptions: none apply (this is dashboard scope).

## 7. UX pain points observed

- One 6.3k-line IIFE renders everything as string-built HTML, then `analyzer.html` physically re-parents nodes into tabs (`composeAnalyzerWorkspace`). IDs like `pg-rule-editor-title` are created by the host, not the component. Fragile and hard to reason about.
- The "Input mapping" and "Max issues per item" controls live in a modal/toolbar far from the preview they affect; Variable Mapping content is still a `<details>` inside the modal.
- The progress bar DOM node is shared between "run analysis" and "generate rules" and is moved between cards (`_moveAnalysisProgressToRules`); if both finish close together the bar can show the wrong text.
- Polling at 600 ms per job with no backoff; two jobs → ~3 req/s per open tab.
- Test Selected is a synchronous request that can take up to `timeout_seconds × retries`; the button just says "⏳ Testing…" with no cancel.
- Target filtering is duplicated client-side (`_getMatchedItems`) and server-side; the footer count can disagree with what the server analyzes (server applies `limit` to "most severe" targets; client shows `min(limit, count)`).
- "Fields:" badges in test results are derived by regex over the prompt text — breaks when prompt wording changes.
- The compare-page modal variant is almost unreachable (button hidden by `renderRootCauseSection`) and duplicates the whole config payload (`analysis_rules`, `reference_documents`) in the request.
- Accessibility: item target rows are `<button aria-pressed>` (good) but the item card itself has `role=listitem` with nested interactive groups; category tabs implement roving tabindex correctly, but the version overflow menu (`role=menu`) has no arrow-key navigation; the example picker "table" is a CSS grid with `role=table/row/cell` but no `columnheader` scope on the checkbox column; the preview `Settings` popover has `role=dialog` but is not modal and no focus trap; colour alone distinguishes root-cause categories (`_RC_COLORS`) and the confidence dot (`title` only); many `aria-live="polite"` regions update simultaneously (summary line, counts, status, feedback) causing announcement spam; `pg-read-only-banner` uses inline `style.cssText`.
- The sample-switch guard shows a warning but silently resets the `<select>`; no explicit "cancel then switch" affordance.
- Save-state badge for the catalog relies on reading the badge's text (`categoryEditorHasUnsavedChanges`, `analyzer.html:3853`) — state stored in the DOM.
- RTL: body text blocks get `dir="auto"` but the overall workspace is LTR-only; test `test_mobile_rtl_no_body_overflow_and_discoverable_controls` only checks overflow.

## 8. Migration notes

**Proposed route(s)**: `/projects/:slug/analysis` with search params `run`, `pass`, `metric`,
`scope` (keep exact names; backend redirects depend on them, `api/runs.py:1516-1610`). Keep
`/projects/:slug/runs/:runId/analyzer` and `/run/:runId/analyzer` as client redirects to the
canonical form. Drop the compare-page modal; if compare needs "Auto-analyze", link to the
analysis route with `?run=`.

**Component tree**
- `AnalysisPage` (reads URL params; loads run summary/passes; owns `scope` tab)
  - `AnalysisHeader` (title, project meta, `AnalysisTabs`)
  - `SamplePicker` (repeat runs without `pass`)
  - `AnalyzeRunTab`
    - `RunCard` (`RunContextList`, `SampleSelect`, `MetricChips`)
    - `AdditionalInstructions` (textarea → `useCustomVars`)
    - `TargetsCard`
      - `TargetFilters` (`MaxScoreSlider`, `SkipAnalyzedToggle`, `HumanOverwriteToggle`, `TimeoutInput`, `AnalyzeLimitInput`, `MaxIssuesInput`)
      - `InputMappingDialog` (`FieldMappingRow` ×3, `CustomVarMappingRow`[], `JsonPathPicker`, `MetricMetadataPicker`, `IncludeFieldToggles`)
      - `TargetList` (`TargetItemCard` → `MetricTargetButton`[], `RootCauseChips`) + `Pagination`
    - `PromptPreviewCard` (`ContextSettingsPopover`, `PromptMessage`[] with `PromptHighlighter`, copy/expand)
    - `TestResults` (`TestResultCard` → `IssueList`, `ItemContextDisclosure`)
    - `AnalysisJobProgress` (phase/progress/retry; cancel) + `AnalysisCompletionCard`
    - `AnalysisFooter` (`ConnectionSelect`, Test / Analyze / Cancel)
  - `RulesTab`
    - `RulesToolbar` (title, count, version meta, state badge, Publish/Promote, Add rule)
    - `RuleFilters` (search, select-all, delete-selected)
    - `RuleList` (`RuleItem` editable/readonly) + `Pagination`
    - `RuleSourcesFooter` (`DocumentsSourceToggle`, `ApprovedExamplesButton`, Create draft, Generate rules, status/feedback)
    - `RuleInferenceProgressCard`
    - `VersionHistoryDrawer` (`VersionGraph`, `VersionRow` + `VersionMenu`)
    - `VersionCompareDialog`, `VersionMergeDialog` (`MergeConflict`[]), `PublishDialog`
    - `ApprovedExamplePicker` (`ExampleFilters`, `ExampleFieldSelector`, `ExampleTable`, `ExampleBudgetBar`, `Pagination`)
  - `DocumentsTab` (`DocumentDropzone`, `LargeDocumentConfirm`, `DocumentLibrary` → `DocumentRow`)
  - `DiagnosisTab` (`CategorySidebar`, `CategoryEditor` → `CategoryTabs`: `GuidanceForm`, `SubcategoryList`(+`SubcategoryItem`, add row, filter, search, pagination), `ApprovedExampleList`; `AddCategoryForm`, `SaveCatalogButton` + `SaveStateBadge`)
  - Shared: `ReadOnlyBanner`, `LoadProblemsBanner`, `NoLlmBanner`, `ConfirmDialog`, `Toast`.

**State placement**
- URL: `run`, `pass`, `metric` (initial metric preselection), `scope`.
- Server cache (TanStack Query keys, all under `['analysis', scopeKey]` where `scopeKey = {run: id} | {project: slug}`):
  `['analysis','config',scope]`, `['analysis','documents',scope]`, `['analysis','rule-versions',scope,{includeDeleted:true}]`,
  `['analysis','examples',scope,queryBody]`, `['analysis','job',runId,jobId]` (`refetchInterval` 600→1000 ms, stop when terminal),
  `['analysis','active-job',runId,pass]`, `['analysis','rule-job',scope,jobId]`, `['analysis','active-rule-job',scope]`,
  `['analysis','preview',runId,{itemId, metric, configHash, connectionId, pass}]` (debounced input, `keepPreviousData`),
  `['run','summary',runId]`, `['run','compact',runId,pass]`, `['run','passes',runId]`, `['run','item-details',runId,ids]`,
  `['project','category-catalog',slug]`. Use `refetchOnWindowFocus` for config/catalog instead of the hand-written approval-signature poller.
- Local component state: draft rule edits (with a 700 ms debounced mutation), selected target, filter controls, mapping selections, custom vars, selected approved example ids + fields, example picker filters/page, category editor drafts + dirty flag, expanded preview, open menus/dialogs.
- Derived (memo): matched targets, footer count, inference-source availability, rule token estimate.

**Backend changes likely needed**
- SPA fallback for `/projects/{slug}/analysis` and the two analyzer URL forms (they currently return `analyzer.html` through `_dashboard_html_response`; redirects to login and project guards must survive).
- CORS / cookie `SameSite` for the Vite dev server, or a Vite proxy for `/api` and `/v1`.
- Nice-to-have endpoints: a "count targets" dry run (or return the server target count in the 202 job response — `start_analysis_job` already computes `len(setup.analysis_targets)`; it is in `progress.total`) so the footer count comes from the server; `fields_used` on test results; a cancellable/async "test" (reuse `analysis-jobs` with `item_ids` and a `dry_run` flag); include `can_restore`/restore UI or remove the restore route from the UI contract.
- Consider replacing polling with the existing NDJSON stream (`POST analyze-stream`) or an SSE job-status endpoint; current server has no SSE.
- `include_deleted=true` only has effect for admins (`api/analysis.py:6643`); UI should not depend on it.

**Risks / gotchas**
- Payload size: `analysis-config` embeds every approved example's input/expected/output per category (`category_examples`) and `analysis-documents` returns full document `content` (up to hundreds of KB each). Fetch documents lazily and ask backend for a `?fields=summary` variant; virtualise example lists.
- Compact rows for large runs (thousands of items) are loaded wholesale for the client-side target filter; the first 20 rows' bodies are fetched for JSON-path discovery. Keep that lazy (only when Input mapping opens).
- Generation counters: two concurrent pollers plus late responses after a sample switch; with TanStack Query, key the job query by `pass` and cancel on key change.
- Pass-version guard: send `pass_number` + `expected_pass_version` (`run.metadata.pass_revision`) on preview/test/analyze; a 409 means the sample was re-run.
- Category catalog save uses optimistic locking (`base_revision`); a 409 must surface conflicts rather than overwrite.
- Human-overwrite confirmation must list affected metrics (computed client-side from `item_metadata.metric_analyses[*].source === 'human'`).
- The project scope key is a synthetic id (`_PROJECT_ANALYSIS_SCOPE_PREFIX`); do not try to call run-only endpoints (`analyze-preview`, `analyze-test`, `analysis-jobs`) in project scope.
- RTL: all user/model text blocks need `textDirAttrs` equivalents; prompt preview must keep whitespace (`white-space: pre-wrap`) and `dir="auto"` per message.

**Suggested Playwright scenarios**
1. Open `/projects/{slug}/analysis?run={id}` for a single-sample run → tabs visible, footer reads "Analyze N items", `?scope=run` is set.
2. Repeat run without `pass` → sample picker; choose a sample → URL gains `pass=N`, workspace loads.
3. Toggle a metric chip off → target count and footer update; clear all → footer hidden / "Select at least one metric" summary.
4. Select a target row → preview request fires once after debounce; copy button writes clipboard text equal to the preview text.
5. Type `{rubric}` in instructions → a custom-variable row appears; choose `input` source → JSON path picker renders tree from the first rows.
6. Analyze with a mocked job: 202 → progress 0/3 → retrying message → completed with 1 error → completion card shows "2 of 3 metric analyses succeeded", error-code group, "View run" link; "Skip analyzed" removes the analysed items.
7. Cancel mid-job → button shows "Cancelling…", job snapshot `cancelled` → warning toast; switching sample while running is refused.
8. Rules tab as manager: Create draft → edit title/instruction → auto-save PATCH after 700 ms → Publish with "Set as production" → version badge "Live".
9. Generate rules with no sources → inline message and disabled button; select documents → job runs → "Added N new rules" status.
10. Documents: drop a >40k-char text file → confirm dialog → second upload with `large_document_action=full`; toggle Excluded → PATCH; delete → confirm → DELETE.
11. Diagnosis: add category without taxonomy → Save blocked with "Taxonomy required"; fill both fields → PUT with `base_revision`; simulated 409 → conflict message retains edits.
12. Member (non-manager) → read-only banner, no upload card, inputs readonly, Test/Analyze disabled; axe scan has no serious violations.

## 9. Open questions

1. **Keep the compare-page modal?** It is effectively unreachable today (`renderRootCauseSection` hides the button). Proposal: drop it and link compare → analysis route. Log the decision.
2. **Where should Variable Mapping live?** Today: hidden behind an "Input mapping" dialog in the Targets card while its effect shows in the Prompt preview. Decide between inline collapsible under the preview vs. dialog.
3. **Diagnosis sidebar shows only categories with approved examples**, but unapproved categories are silently kept in the DOM and still saved. Decide whether to show all catalog categories with a "needs examples" state (recommended) or keep the current hidden-but-saved behaviour.
4. **Server-side target count vs client filter.** Either accept a client-side replica of `_filter_analysis_targets` (must match `api/analysis.py:3981-4140` exactly, including minimize-direction and execution-error rules) or add a dry-run endpoint. Recommend the endpoint; until then port the filter verbatim with unit tests mirroring `tests/platform/test_root_cause_issue_javascript.py:60-243`.
5. **Polling vs streaming.** `analyze-stream` exists but is unused; the job model is the source of truth. Decide whether to keep 600 ms polling (simple, works with the workers split) or add SSE on the job endpoint.
6. **Test results "Fields:" badges** are regex-derived. Keep (port regexes) or ask backend for `fields_used` and drop until then?
7. **Restore / permanent-delete** routes are wired in JS (`_changeRuleVersion`) but have no buttons; `can_restore` is admin-only. Expose in the new UI or drop?
8. **Rule token estimate** (`chars/4`) and "no rule count limit" copy: keep as informational or remove?
9. **Dashboard tab**: it is kill-switched; confirm it is out of scope for the first React release (tests expect `?scope=dashboard` → `run`).
10. **Modal/page CSS**: the overlay/footer use untokenised rgba/backdrop-filter. Decide the footer treatment (sticky translucent vs. plain surface) with the design agent.
