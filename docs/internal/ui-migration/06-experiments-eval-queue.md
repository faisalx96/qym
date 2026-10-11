# Experiments, launch form, eval queue, environments, presets, models — migration brief

Written by an analysis agent for the React/TypeScript/Vite migration. Audience: the
component agent that will rebuild this area from scratch in `frontend/`. Be concrete:
file paths with line numbers, API routes with methods and response shapes, exact
behaviors. No marketing language.

All paths below are relative to `packages/platform/qym_platform/` unless they start
with `docs/` or `tests/`. "D" = `_static/dashboard/`. Product intent for the whole area
is logged in `docs/internal/EVAL_OPEN_QUESTIONS.md` (decisions B14–B24 are the ones
that shaped today's UI) and `docs/internal/EVAL_SERVICE_INTEGRATION_PLAN.md` §5–§14.

## 1. Surface inventory

| Page / route | HTML file | JS / CSS it loads | Entry function(s) | approx LOC |
|---|---|---|---|---|
| `/projects/{slug}/experiments` (list, `?experiment=<id>` detail, `?new=1` launch form, `?view=environments` env list, `?environment=<id>` env page) — served by `api/runs.py:2346` | `D/experiments.html` (138; inline `.exp-*` styles) | `experiments.js` (1193), `experiment_matrix.js` (546), `experiment_launch.js` (4375) + `experiment_launch.css` (201), `experiment_launch_advanced.js` (1500) + `.css` (38), `experiment_launch_json.js` (403) + `.css` (21), `experiment_launch_sweeps.js` (768) + `.css` (39), `experiment_launch_best_run.js` (480) + `.css` (27), `eval_environments.js` (1852) + `.css` (221), `eval_official_defaults.js` (572) + `.css` (59), `eval_temporary_model.js` (124) + `.css` (33), `codemirror-bundle.js` (lazy, 14 lines minified ESM), plus shared `qym_safe.js`, `auth.js`, `shell.js`, `qym_table.js`, `ui_components.js/.css` | `experiments.js` IIFE `start()` (l.1174) → `loadContext()` → one of `mountLaunchForm()` / `renderEnvironmentPage()` / `renderEnvironments()` / `refresh()`; `window.QymExperimentLaunch.mount()` / `.mountEditor()` (`experiment_launch.js:365`, `:4369`) | ~10,500 |
| `/projects/{slug}/experiments/queue` (`?environment=&experiment=&status=&mine=1`) — `api/runs.py:2359` | `D/eval_queue.html` (119; inline `.exq-*` styles) | `eval_queue.js` (1131) + shared shell/table/ui_components | IIFE `start()` (l.1114) → `loadContext()` → `mountSkeleton()` → `refresh()` | ~1,250 |
| `/projects/{slug}/models` — `api/runs.py:2333` | `D/models.html` (155) | `dashboard.js` (10,021 shared; models view ≈ l.5947–6900), `metrics.js`, `runs_order.js`, `kpis.js` | `window.__QYM_INITIAL_VIEW__='models'` → `renderModelsView()` (`dashboard.js:5947`) | ~900 (models-specific) |
| Run page "Experiment" panel (embedded in run detail, not a route here) | — | `run_experiment_panel.js` (236) | `window.QymRunExperimentPanel.render(container, run, opts)` | 236 |
| Project settings → Environments tab (owned by the settings brief; the same `eval_environments.js` / `eval_official_defaults.js` modules are mounted there with `openEnvironmentDrawer`, and the official-defaults editor is opened from `?tab=environments&env=&promote=run|job&id=`) | `project_settings.html` | same modules | `QymEvalEnvironments.mountEnvironmentsPanel`, `QymOfficialDefaults.openEditor` | — |

`codemirror-bundle.js`: an esbuild-minified ESM bundle of CodeMirror 6
(`@codemirror/state`, `view`, `language`, `lang-json`, `commands`, `@lezer/highlight`);
`export{commands, highlight, langJson, language, state, view}`. Loaded lazily with a
`new Function('u','return import(u)')` trick by `experiment_launch_advanced.js:85` (Raw
JSON card) and `trace_viewer.js:1894` (falls back to esm.sh then to a `<textarea>`).

## 2. User journeys (as-is)

1. **Browse experiments.** Sidebar "Experiments" → list. Header: title, description,
   "N experiments", "+ New experiment". Tabs (links, `role=tablist`): Experiments |
   Queue | Environments (`experiments.js:498`). Toolbar: Status `<select>` (QUEUED,
   RUNNING, COMPLETED, PARTIAL, FAILED, CANCELLED), "Created by me" checkbox, one
   `<select>` per `versioning_metadata` key the project's runs report (facets from
   `include_versioning_facets=true`, l.706), "Auto-refreshing while experiments run"
   note. Table (`QymDataTable`, storageKey `experiments.list.v1`, columns l.646): Name
   (+description sub-line), Status badge, Environments (names resolved client-side from
   `/eval-environments`), Base source label, Jobs (✓ ok / ✗ failed / ● live / ⊘
   cancelled tags), Best score (`best_score` — the API does not send it today, always
   "—"), Creator email, Age (rel. time, abs. title). Row click → detail. Pagination
   (`QymUIComponents.renderPagination`, page size 50) only when total > 50. URL state:
   `?status=&mine=1&versioning=key=value` (repeatable) via `history.replaceState`
   (l.734); `page` is **not** in the URL. Empty states: "No experiments yet" vs "No
   matching experiments". Polling: 5 s → ×1.5 → max 60 s while any experiment is
   QUEUED/RUNNING, paused on `document.hidden`, re-render only when the JSON
   fingerprint changes (l.300–326).
2. **Experiment detail** (`?experiment=<id>`). Breadcrumbs project › Experiments ›
   name. Header: "← All experiments", name, description, meta (creator, age, "Priority
   Normal", "Base: …", env names with "(disabled)"), status badge, "Retry failed (n)"
   and "Cancel experiment" buttons (enabled only for creator/manager/admin, l.270).
   Stat strip: Jobs / Succeeded / Failed / In progress / Cancelled (current attempts
   only). Queue strip (hidden when no live job): per environment "N queued · N running
   · N blocked · position P" + "Open in queue →" (data from `GET /eval-queue?
   experiment_id=&limit=1000`, l.413). **Matrix** card (`experiment_matrix.js:206`): rows
   = combinations (`combo_label` + `#index`), columns = environments; each cell =
   latest attempt: checkbox "select run for comparison" (only when run exists and not
   deleted), status badge, "↻ N earlier" button (opens job history with superseded
   shown and scrolls to the row), headline metric value + name, run link, error /
   wait_reason, actions: Cancel / Retry (from page) + "Save as preset" + "Promote to
   default preset" (managers). Toolbar: "Select all runs", "Clear", "Compare selected
   (n)" (≥2 → writes `sessionStorage.compareRuns`, navigates to
   `/compare?runs=a&runs=b`). **Setting vs metric** card (only when `sweep_keys` non
   empty): X-axis `<select>` of swept pointers, Metric `<select>` (names ordered by
   how many runs have it as headline), inline SVG line chart one series per env
   (`--chart-1..5`, 6th+ → `--text-muted`), legend; "Nothing to plot yet" empty.
   **Job history** card: "Show earlier attempts (n)" checkbox; table (storageKey
   `experiments.jobs.v1`, l.889): Combo, Environment, Params (`k=v, …`), Status
   (+error/wait_reason sub-line), Attempt (+"retried"), Run (link + "Run <status>" or
   "Deleted"), Updated, actions. Polling as list while any job non-terminal. Matrix
   view state (selected runs, chart param/metric, saving) is kept in a module-level
   `memory[experimentId]` map so it survives polls.
3. **Cancel / retry from detail.** Cancel experiment opens `QymShell.openConfirmDialog`
   whose title/description depend on whether only running jobs remain (l.1021–1055):
   queued+blocked jobs are cancelled by default; running jobs are only stopped when
   nothing else is pending (`include_running: true`). Cancel job (row) → confirm →
   `POST …/jobs/{jid}/cancel`. Retry job → `POST …/jobs/{jid}/retry`; a 422 with
   `detail.code === 'preemption_acknowledgement_required'` re-asks with a HIGH
   warning and resends `{acknowledge_preemption: true}`. "Retry failed (n)" loops
   serially over retryable jobs, asks the HIGH acknowledgement once. Toasts summarise
   outcomes (`cancelled`, `cancelling` → "stopping on the service",
   `already_terminal`, `forbidden`). After cancel, `QymShell.announceRunStatus({runIds,
   status:'STOPPING'})` so open run pages re-read. 403 flips `state.denied` and
   disables controls.
4. **Launch an experiment — entry screen** (`?new=1`, optionally `&env=<id>`,
   `&clone=<xid>[&job=<jid>]`, `&base=saved&preset=<id>`). `experiment_launch.js:3715`.
   Layout: "← Experiments", title "New experiment", two side-by-side cards
   **Environment** (checkbox list; each option shows health tag, "No schema", "Needs
   LLM grouping", "Priority up to …", "Default preset vN", "Checking schema…",
   "Details" link opening the env page in a new tab; "+ New environment" for managers
   opens the add dialog) and **Dataset** (project dataset `<select>` + version/alias
   `<select>`; a custom dataset string carried by a base is shown in a callout with
   "Remove"). **Start from** card grid: "Default preset vN" (Recommended), "Top-scoring
   run", "Copy an experiment" (most recent experiment, or the clone source), then
   compact cards: each saved preset, "From scratch"; "Presets of <env>" select when
   >1 env. Below: base status (label, "N changes on top", "Undo all changes", hints,
   release notes, remap dropped/errors callouts, warnings, best-run scope picker when
   that base is chosen). Entry bar: name input (kept stable so focus is not lost on
   re-render, l.3867), status text ("Pick an environment." / "Checking…" / "N problems
   to fix" + "Show" / "Over the run limit" / "Ready: <base> on <envs>"), buttons
   "Launch as is" and "Customize →".
5. **Launch — Customize wizard** (six steps, `WIZARD_STEPS` l.3907; B24). Step nav
   `<ol>` with per-step buttons, current/done styling, count badges on steps 4 and 5;
   Back / "Continue to <next>" / "Skip to review" (from step 3). Side column holds the
   sticky **Review** panel except on step 6 where it moves into the main column.
   1 *Where it runs*: Name (maxlength 200), Priority select (Environment default /
   LOW / NORMAL / HIGH — HIGH "(managers only)", options above the env cap "(above the
   environment maximum)"), Versioning details textarea (`key=value` lines; ≤50 keys,
   key ≤100 chars), HIGH warning callout; Environments; Dataset.
   2 *Starting point*: segmented control (Default preset / Best past run / Saved
   preset / From scratch / Copy of experiment when cloning), "Presets from"/"Runs
   from" env select when >1 env, saved-preset select, best-run picker, base status.
   3 *Models*: "Group LLM settings" banner (+button for managers) when a selected env
   has unconfirmed slots; **Current versions** block (per env: agent/image/kb from
   `GET …/versioning-details`, "Refresh"); **Global model** control (B22): select
   (None / project models usable on every endpoint / "Temporary: …"), "+ Temporary
   model", "+ models" (sweep), status line "Follows the global model: … Custom: …",
   "Apply to all endpoints", "Clear"; one **model card** per confirmed slot
   (union across envs): changed dot, label, `slot_key` tag, required/this
   experiment/follows global/custom/"not in <env>" tags, Remove (extra endpoints),
   Reset; select Inherit / project models (disabled with reason) / Temporary / "From
   the base"; temporary chip + "will be saved to project models" + "no API key" +
   re-enter-key row; "+ Temporary model" inline form (`eval_temporary_model.js`), "+
   models"; "+ Add LLM endpoint" input+button (+ "Edit LLM groups" for managers).
   4 *Environment configurations*: **Environment overrides** card generated from the
   descriptor union: toolbar (search, "Changed only", "N changed", "Reset all"), one
   `<details>` per descriptor group (closed by default; `st.groupOpen` remembers), an
   "Other values" group (open by default) for pointers no schema describes; **Role
   overrides** card (Advanced panel slot `roles`): search, "Overridden only", "Reset
   roles", one table per role_table with an "All roles" row; **Sweeps** card (only
   when something is swept): axes list with "× n" tags, link checkboxes, "Link
   selected", "Unlink", run-count math and over-cap callout.
   5 *Evaluation configurations*: **Evaluation inputs** card: evaluator.config fields
   from `GET …/experiments/evaluator-config`, "Other values", **Run metadata**
   key/value rows (+ "Add key", reserved `qym_*` keys shown read-only), "Also sent"
   callout (report_k / dataset_version from base or Raw JSON) and **Set by the
   platform** read-only list.
   6 *Review and launch*: Review panel (summary `<dl>`: Environments, Dataset, Start
   from, Models, Settings, Priority; "N runs to launch" with `combos × envs = N (limit
   M)`, sweep axes, first 12 run names; preemption warning; over-cap callout; status;
   Validation list of clickable errors each focusing its field; Cancel / "Launch [N
   runs]") then the **Raw JSON** card (CodeMirror editor; status "In sync with the
   form" / "Unapplied edits…" / error list; "Revert to form", "Apply").
   Launch: local errors → focus first; HIGH → confirm; `POST /experiments` (no
   dry_run); 422 `preemption_acknowledgement_required` → confirm and resend; 422 with
   `detail.errors` → shown in the panel, first focused; success → toast, navigate to
   detail. On teardown secrets and bindings are wiped (l.4317).
6. **Default preset editor** (same form via `mountEditor`, opened by
   `QymOfficialDefaults.openEditor` from the environment page/drawer or by
   `?promote=`). Steps relabelled: 1 Dataset, 2 Compared with, 3 Models, 4/5 as
   above (no sweeps, no "+ Temporary model"), 6 Review and publish. Side panel:
   summary, Release notes textarea (required, ≤5000), status, validation, Cancel /
   "Publish vN" (disabled until notes present, something changed vs current version
   when one exists, and every `rebind` slot has a project model). Publish → confirm
   dialog → `POST …/presets` (v1, `kind: official`) or `POST …/presets/{id}/versions`;
   409 → "changed meanwhile, reopen".
7. **Queue page.** Header "Queue", description, meta "N jobs · refreshed Xs ago".
   Tabs. Toolbar: Environment select (all + disabled suffix), Status select (QUEUED,
   SUBMITTING, SUBMITTED, RUNNING, BLOCKED, CANCELLING), Experiment select (built from
   names seen in responses), "Only my jobs", note "Refreshes automatically; paused
   while this tab is hidden". Environment cards grid: name, Disabled tag, health
   badge, In flight / Queued / Blocked stat values, "Dispatch is paused until the
   health check passes: …" error note, "N stale jobs still running on the service…"
   note, HIGH-active status box. **Our jobs** card: bulk bar ("Select all I can
   cancel", "Cancel selected (n)", "Cancel all queued in experiment" when filtered
   by experiment); table (storageKey `eval-queue.jobs.v1`, l.749): select, #
   (queue_position), Experiment link "+ #combo" with params sub-line, Environment,
   Priority tag (HIGH = warning), Status badge (+"attempt n" tag, wait_reason/error
   sub-line), Created by, Age, Elapsed (since run.started_at or submitted_at; "—"
   while QUEUED/BLOCKED), Run progress (progress bar `items_done/items_total`,
   indeterminate when total unknown, run link; "Run deleted"), Cancel button /
   "Stopping…". Footer note when `total > jobs.length` ("Showing the first N of M").
   **Remote queue** collapsible card (chevron toggle; loads `/eval-queue/remote` only
   when open): orphan/stale count tags; per environment: meta ("fetched Xs ago ·
   refreshing · N orphans · N stale jobs", "Last refresh failed: …"), "Cancel selected
   orphans/remote jobs (n)" for managers, table (storageKey `eval-queue.remote.v1`):
   select, Remote job (+run_name), Status, Priority, Matches (experiment link +
   "Local status …" + Stale badge, or "Orphan" tag), Service user, Age; "Only a project
   manager can cancel orphan and stale jobs" note. URL state synced with
   `replaceState`. Polling 5 s → ×1.5 → 60 s always (not only while live), paused when
   hidden; silent refreshes only re-render when fingerprint changed (else `renderMeta`
   only).
8. **Cancel from the queue.** Every cancel opens a custom split dialog
   (`eval_queue.js:237`, built on `.shell-modal-*`, not `openConfirmDialog` because it
   needs a reason field): sections "Queued here (not yet sent)" / "Submitted or
   running on the service" / "Not allowed (skipped)" each with count, explanation and
   up to 5 job labels ("… and N more"), "Reason (optional)" textarea (≤1000), Keep
   jobs / Cancel N jobs (disabled when nothing actionable); Esc / backdrop / × close;
   focus goes to Keep. "Cancel all queued in experiment" first re-fetches the exact
   set (`status=QUEUED&status=BLOCKED&limit=1000`) then sends `{experiment_id,
   statuses:['QUEUED','BLOCKED']}`. Remote cancel splits orphans vs stale.
9. **Environments list** (`?view=environments`) and **environment page**
   (`?environment=<id>`). List: table (Environment, URL, Health, Schema hash +
   "fetched …", LLM groups (⚠ Needs grouping / ✓ Grouped), Default preset vN,
   Priority cap, actions "Run default preset" (one-click launch, l.1694), Manage/View,
   Test); "+ Add environment" (managers). Page (`mountEnvironmentPage` l.1172, same
   sections as the settings drawer): Status (state, health, API key hint, default
   preset, created; Re-enable / Test connection), Schema (hash, fetched, settings
   count, Refresh schema → diff block added/removed/changed types), LLM model groups
   (read-only slot cards; "Group LLM settings"/"Edit groups" opens the grouping
   dialog), Presets (`QymOfficialDefaults.renderDrawerSection`: Default preset current
   version + "Edit and publish"/"Publish v1", version history `<details>` each lazily
   rendering a read-only `versionView` + "Edit from vN"; Saved presets table with
   "Open in launch form" and "Promote to default preset"), Ranking (metric, k),
   Policies (max/default priority, "Allow connection keys" with the moved-URL rule
   l.1595), Connection (name, URL, API key; managers), footer Delete / Save changes.
   **Add environment dialog** (3 steps: Connect form name/base_url/api_key → "Test &
   connect" (`POST /eval-environments`) → Review settings (read-only generated form
   preview with groups/tags/defaults) → Group LLM settings (slot editor) → Confirm /
   Skip). **LLM groups dialog** (`openGroupingDialog`): slot editor = cards with
   label input, key sets (model/base URL/API key selects of candidate pointers),
   "+ Add another set of keys", transport chips with unmap, merge select "Move keys
   into group…", Remove/Restore, "Add a group" (endpoint name → `?propose_endpoint=`,
   or flat model field), Save → `PUT …/model-slots` (422 per-slot errors, 409 schema
   changed → "Reload slots").
10. **Models page.** Command bar (shared with runs/charts): time range segmented +
    custom range popover, Origin segmented (All/Official/Local, persisted by
    `data-qym-segmented-key`), multi-select filters Tasks/Datasets/Models/Versions/
    versioning keys/Status/Users, Clear. Requires exactly one task and one dataset
    (explicit filter or inferred when the filtered set has one), else the "Select a
    Task and Dataset" empty state. Controls: Metric select (spec order, defaults to
    newest run's primary metric), "Runs per model" K (1–100, default 5), "Pass ≥/≤"
    slider (0–100 step 5, hidden for boolean/numeric/undirected metrics; per-metric
    default from `QymMetrics.defaultPassThreshold`), "Shown Metrics" multi-select.
    Cards per model (sorted best average first): color dot, label (+reasoning badge),
    "n/K runs" + ⚠ when fewer available, "Edit" → run-selection modal (paged list of
    that model's runs grouped by config group, checkbox cap K, "Apply Selection"),
    stat tiles (Pass@K, Pass^K, Max@K, Consistency, Reliability, Avg, Errors,
    Retries, latencies, trace metrics; different sets for score/numeric/neutral
    metrics l.6561–6594), Correct Distribution bar, footer "N items" + "See
    item-by-item comparison →" (≥2 runs → `/compare?runs=…`). Ranking block with
    🥇🥈🥉. Status bar "Last Updated".
11. **Run page experiment panel** (`run_experiment_panel.js`): for official runs
    only: Experiment link, Environment, Combination "#n · retry m", Base source +
    short id, Remote job id, Job status badge, Schema hash, Versioning tags, Swept
    params tags, Models tags, Job error, "launch job no longer available" note,
    Service result `<details><pre>`; actions "Open experiment", "Rerun with this
    config" (→ `?new=1&clone=&job=`), "Promote to default preset" (→ settings
    `?tab=environments&env=&promote=run&id=`; disabled unless run COMPLETED/
    SUBMITTED/APPROVED).

Keyboard: Esc closes every dialog; Enter adds in the small "add key/endpoint/value"
inputs and applies "All …" controls; no other shortcuts. Persisted state:
`localStorage` column widths via `QymDataTable` keys listed above, origin segmented
key `run-origin`; `sessionStorage.compareRuns`/`compareCohorts` for Compare handoff.
No form draft is persisted — a reload loses the launch form.

## 3. Functional inventory

**Experiments list** — MUST-KEEP: list + status/mine filters, versioning facet
selects (B14), pagination, live polling with backoff + visibility pause, "+ New
experiment", tabs. NICE: fingerprint-diff re-render (React handles this). DROP-
CANDIDATE: "Best score" column (API never sends `best_score`; always "—").

**Experiment detail** — MUST-KEEP: header meta, stat strip, queue strip, matrix with
compare selection, job history with superseded toggle, cancel experiment (queued vs
running semantics), cancel job, retry job with HIGH re-ack, retry all, Save as preset
(`QymShell.openFormDialog` name+notes → `POST …/presets`), Promote (managers),
`announceRunStatus` after cancels, 403 → denied state. NICE: setting-vs-metric SVG
chart (keep but can be a small Recharts/own SVG component), smooth scroll to attempt
row. DROP-CANDIDATE: none.

**Launch form** — MUST-KEEP (all of these are tested in `tests/platform/
test_experiment_launch_*`): entry screen with start cards; six-step wizard; per-env
data loading (`form`, `model-slots`, `model-options`, extra endpoint proposals) with
in-flight dedupe (`loadEnvData` l.495, B19 bug fix); schema auto-refresh once per
visit per selected env (B18) with "Schema updated" toast and base reload; union of
descriptors across envs with "not in <env>" tags and `not_in_environment` local
errors; base layering (baseline vs edits, changed dots, Reset per field/slot/all,
diff count, "Change the starting point?" confirm that replays edits that still fit,
l.1588); clone prefill (`POST …/clone`, temp models lose keys → re-enter); saved
preset base (`?base=saved&preset=`); best-run picker with scope prompt (B15); global
model (B22); extra endpoints; temporary models with in-memory secrets only
(`st.secrets`, never DOM/URL/storage); generated widgets (`leafControl` l.2751:
boolean select, enum select, endpoint-ref select, json/array/object textarea,
numeric/text input, secret placeholder, JSON fallback for values that don't fit
(B20), structured JSON editor (`experiment_launch_json.js`), swept chip editor);
collections (add/remove keys, required keys, "All <entries>" block), role tables
("All roles" row), extra keys of open objects, "Other values"; search + changed-only
filtering that auto-opens matching groups; Advanced panel (evaluation inputs with
base overlay semantics, run_metadata rows with reserved-prefix/duplicate/placeholder
validation, platform-owned read-only list, Raw JSON two-way sync with full
client-side document validation l.1210–1252); sweeps (chips, numeric range expansion
≤100 values, boolean [true,false], enum/endpoint multi-choice, model multi-select,
link/unlink zipped axes, job estimate vs cap, Launch disabled over cap); debounced
dry-run preview (600 ms, generation-guarded, `specChanged:false` for name/priority);
error → field focus (opens step, group, details, clears filters, flash); HIGH
priority gating + preemption acknowledgement; versioning details (B21); editor mode
(preset publish, `requireChange`, `rebind`). NICE: "Current versions" block on the
Models step (live service call per env), run-name preview list, "Copy an
experiment" card from the 3 most recent. DROP-CANDIDATE: the `sweeps: false` /
textarea fallback paths when CodeMirror fails to load (keep a plain textarea
fallback but no need for the `Function('import')` trick in Vite).

**Queue** — MUST-KEEP: filters in URL, env summary cards, dispatch-order job table
with progress, per-job `can_cancel`, bulk select + split confirmation with reason,
cancel-all-queued-in-experiment, remote queue (lazy, orphans/stale, manager cancel),
polling with backoff. NICE: "refreshed Xs ago" meta without table re-render.

**Environments** — MUST-KEEP: list, add dialog (3 steps), environment page/drawer
sections, test/refresh/delete/re-enable/save, slot editor + grouping dialog, run
default preset one-click with its blockers (l.1667), presets section + version
history, promote flows, allow-connection-keys moved-URL rule. NICE: generated form
preview in the add dialog step 2.

**Models** — MUST-KEEP: task+dataset requirement, metric/K/threshold/visible stats,
candidates + stats fetch with batching (≤100 groups / ≤2000 runs per request),
cards, ranking, run-selection modal (paged), compare handoff. NICE: skeleton
crossfade (`QymShell.skeletonHTML/liftSkeleton/arrive`). DROP-CANDIDATE: legacy
non-summary code path (`usesDashboardSummary()` false branch, `openRunSelectionModal`
l.6833) — only the dashboard-summary path should be rebuilt.

Hidden behaviours worth listing: toasts everywhere via `QymShell.toast`; stylesheets
injected at runtime by `ensureStylesheets()` (l.169) because the shell's SPA nav
drops `<link>`s (C3) — irrelevant in Vite; `document.currentScript` lookup for the
CodeMirror URL; `qym:shell-ready` / `qym:before-navigate` lifecycle events; the
launch form rebuilds its whole layout when switching entry ⇄ customize and re-mounts
the Advanced panel, stashing its state in `st.advancedSaved` (l.210, 1479).

## 4. Data & API contract

Auth: every call is same-origin `fetch` with the session cookie (`credentials:
'same-origin'`); a 401 is intercepted by `QymAuth.handle401`. Project id comes from
`GET /v1/projects/by-slug/{slug}` (`{id, slug, name, role}`); the current user from
`window.__QYM_USER__` or `GET /v1/me` (`{id, role}`; `role === 'ADMIN'` is global).
Error envelope: `{detail: string | {message, code?, errors?: [...], ...} |
[{loc, msg}]}`; all modules share an `errorMessage()` reducer. Pagination is
`limit/offset` with `total`. Timestamps are ISO UTC strings.

| Method | Path | Query / body | Response (key fields) | Used by |
|---|---|---|---|---|
| GET | `/v1/projects/{pid}/experiments` (`api/experiments.py:1403`) | `status`, `mine`, `created_by`, `environment_id`, `versioning=key=value`*, `include_versioning_facets`, `limit≤200`, `offset` | `{experiments:[Experiment], total, limit, offset, versioning_facets?: {key:[values]}}`; Experiment = `{id, project_id, name, description, environment_ids[], base_source{kind, preset_version_id?|experiment_id?|job_id?|run_id?}, spec, versioning_details{}, priority, preemption_acknowledged_at, status, job_count, job_counts{STATUS:n}, created_by_user_id, created_by_email, created_at, updated_at, cancelled_at, cancelled_by_user_id, temporary_keys_stored}` (l.995) | list, entry "Copy an experiment" (`limit=3`) |
| GET | `…/experiments/{xid}` (l.1488) | — | Experiment + `environments:[{id,name,is_active}]`, `ranking_metrics{env_id:metric}`, `sweep_keys{pointer:label}`, `jobs:[Job]`; Job = `{id, experiment_id, environment_id, environment_name, combo_index, combo_label, attempt, retry_of_job_id, superseded, run_name, params{slot_bindings, sweep?}, schema_id, status, remote_job_id, remote_status, remote_result, remote_versioning, error, wait_reason, submit_attempts, next_attempt_at, submitted_at, finished_at, cancel_requested_at, cancelled_by_user_id, cancel_reason, created_at, updated_at, run_id, run: null|{id, status, deleted, metric_means{}, headline_metric{name, mean, direction}, …}, qym_config{schema_hash, evaluator, slot_bindings, env_overrides}}` (l.942) | detail, matrix, queue experiment-name lookup, clone fallback |
| POST | `…/experiments` (l.1128) | body `{name, environment_ids[], spec{evaluator{dataset, dataset_version?, config?, report_k?}, slot_bindings{slot_key: {connection_id}|{temporary{label,model,base_url,api_key:{$secret:ref}}}|{sweep:[…]}|null}, env_overrides{}, links?[[ptr,…]]}, base_source, dry_run, secrets{ref:key}, save_to_project_models[slot_key], priority?, versioning_details?, acknowledge_preemption?, description?}` | dry run: `{dry_run:true, ok, axes:[{pointers, linked, length, values}], combo_count, job_count, max_jobs, priority, preemption_warning, errors:[{pointer, rule, message, environment_id, environment_name?, combo_index}], jobs:[{environment_id, environment_name, combo_index, label, run_name, params, errors, warnings, request_body}]}`; real: the detail payload. 422 `{detail:{message, errors, jobs?}}` or `{detail:{code:'preemption_acknowledgement_required', message}}`; sweep cap 422 includes `axes/combo_count/job_count/max_jobs` | preview (debounced), launch, "Run default preset" |
| POST | `…/experiments/{xid}/cancel` (l.1516) | `{include_running?, reason?}` | `{outcomes{job_id: cancelled|cancelling|already_terminal|forbidden}, skipped_running[], experiment}` | detail |
| POST | `…/experiments/{xid}/jobs/{jid}/cancel` (l.1565) | `{reason?}` | `{outcome, experiment}` | detail, matrix |
| POST | `…/experiments/{xid}/jobs/{jid}/retry` (l.1588) | `{acknowledge_preemption?, temporary_keys?{slot:key}}` | `{job_id, experiment}`; 409 (already retried / not retryable / env disabled / creator left); 422 `code: temporary_key_required` with `slots[]` (**the UI does not handle this code today**) | detail |
| POST | `…/experiments/{xid}/clone?job_id=` (l.1734) | — | `{name, description, environment_ids[], unavailable_environment_ids[], base_source{kind:'clone', experiment_id, job_id?}, cloned_base_source, priority, spec, versioning_details, combo?{job_id, combo_index, environment_id, schema_hash, sweep, from_snapshot}}` | launch clone prefill |
| GET | `…/experiments/evaluator-config?environment_id=…`* (l.1354) | repeatable | `{descriptor{fields{'/name': entry}, root…}, fields[name], missing{name:[env_id]}, platform_owned{config[], evaluator[]}, platform_owned_present[], reserved_metadata_prefix, platform_metadata_keys[], source:'static'|'environment'|'mixed', environments:[{environment_id, name, source, schema_hash}]}` (`services/eval_config.py:289`) | Advanced panel |
| GET | `/v1/projects/{pid}/eval-queue` (`api/eval_queue.py:237`) | `environment_id`, `status`* (non-terminal only, else 422), `mine`, `experiment_id`, `limit` (500, ≤1000) | `{jobs:[QueueJob], total, limit, environments:[{id, name, is_active, health_status, health_error, inflight, queued, blocked, stale_remote, counts{}, high_active}]}`; QueueJob fields in the module docstring l.13–31 (`queue_position`, `can_cancel`, `run{id,status,status_reason,started_at,last_event_at,items_done,items_total,deleted}`) | queue page, detail queue strip |
| GET | `…/eval-queue/remote?environment_id=` (l.333) | — | `{environments:[{environment_id, environment_name, is_active, health_status, fetched_at, fetch_error, stale, orphan_count, stale_count, items:[{remote_job_id, status, priority, user_id, created_at, run_name, orphan, stale, match:null|{job_id, experiment_id, experiment_name, status}}]}], can_cancel_orphans}`; schedules a background snapshot refresh when stale (>30 s) | remote queue |
| POST | `…/eval-queue/cancel` (l.364) | `{job_ids[≤200], reason?}` xor `{experiment_id, statuses?[], reason?}` | `{outcomes{job_id: outcome}, counts{outcome:n}}` (+`not_found`) | queue cancels |
| POST | `…/eval-queue/remote/cancel` (l.405, manager) | `{environment_id, remote_job_ids[≤200], reason?}` | `{environment_id, outcomes, errors{id:msg}, counts}` (outcomes add `refused_local_job`, `not_in_snapshot`, `error`) | remote cancel |
| GET | `/v1/projects/{pid}/eval-environments?active=true` (`api/eval_environments.py:685`) | — | `{environments:[Env]}`; Env = `{id, project_id, name, description, base_url, api_key_set, api_key_hint, default_priority, max_priority, allow_connection_keys, ranking_metric, ranking_k, current_schema_id, schema_hash, schema_fetched_at, evaluator_schema_status, current_evaluator_schema_id, evaluator_schema_hash, evaluator_schema_fetched_at, health_status, health_checked_at, health_error, is_active, model_slots{needs_confirmation, counts{confirmed,proposed,stale}}, official_preset_id, official_preset_version_id, official_preset_version, created_by_user_id, created_at, updated_at}` (l.609) | everywhere |
| GET/PUT/DELETE | `…/eval-environments/{eid}` (l.750/835/917) | PUT `{name?, base_url?, api_key?, ranking_metric?, ranking_k?, max_priority?, default_priority?, allow_connection_keys?, is_active?}` | Env; DELETE `{deleted: bool}` (disabled instead when in use) | env page |
| POST | `…/eval-environments` (l.761, manager) | `{name, base_url, api_key}` | `{environment: Env, slots[]}` | add dialog |
| POST | `…/{eid}/test` (l.952) | — | `{ok, error?, schema_changed?}` | env page/list |
| POST | `…/{eid}/schema/refresh` (l.1002, any member) | — | `{changed, env_overrides_changed, added[], removed[], changed_types[{pointer,from,to}], evaluator{changed, added, removed, …}, schema_id, schema_hash, previous_schema_id, slots[], needs_confirmation}` | launch auto-refresh, env page |
| GET | `…/{eid}/form` (l.1068) | — | `{environment_id, schema_id, schema_hash, descriptor, evaluator{status, schema_id, schema_hash}}`; descriptor shape documented in `services/eval_schema_form.py:1–75` (entries: `pointer, name, label, kind field|object|collection|role_table, type, widget, group, required, has_default, default, sweepable, secret, enum, bounds, accepts, item_type, additional_pointer, children, key_param, item_pointer, required_keys, key_pattern, row_param, rows[{key,pointer,label,description}], columns, ref_collection, hints`; `groups[{id,label,pointers}]`, `warnings`) | launch, env preview, slot editor |
| GET | `…/{eid}/model-slots?propose_endpoint=name` (l.1144) | — | `{environment_id, schema_id, slots:[{id, environment_id, schema_id, slot_key, kind endpoint|flat, label, field_map{model,base_url,api_key}, transport_fields{}, extra_field_maps[], required, status confirmed|proposed|stale, confirmed_by_user_id, confirmed_at}], needs_confirmation, proposal?: slot|null}` | launch, slot editor |
| PUT | `…/{eid}/model-slots` (l.1198, manager) | `{slots:[{slot_key, kind, label, field_map, transport_fields, extra_field_maps}], schema_id}` | same as GET; 422 `{detail:{errors:[{slot_key?, message}]}}`; 409 schema changed | slot editor |
| GET | `…/{eid}/model-options` (l.1169) | — | `{schema_id, environment_id, allow_connection_keys, temporary_keys_allowed, temporary_keys_reason, connections:[{connection_id, name, model, base_url, api_key_set, api_key_hint, is_default, available, reason_code, reason, slots{slot_key:{available, reason_code, reason}}}]}` | model cards, preset view |
| GET | `…/{eid}/versioning-details` (l.1094) | — | always 200 `{environment_id, status ok|unsupported|error, versioning_details{}, error, fetched_at}` (live service call) | Models step |
| GET | `…/{eid}/presets` (`api/eval_presets.py:101`) | — | `{environment_id, can_publish_official, presets:[{id, environment_id, name, kind official|saved, current_version_id, current_version: null|{id, preset_id, version, schema_id, schema_hash, schema_current, config, notes, warnings[{rule,message}], published_by{name}, published_at}, can_publish, created_by_user_id, created_by{name}, created_at, updated_at}]}` | launch bases, presets section |
| POST | `…/{eid}/presets` | `{kind, name?, config, notes?}` | `{preset, warnings[]}` | Save as preset, publish v1 |
| GET | `…/presets/{id}/versions` | — | `{preset_id, current_version_id, versions:[Version]}` | history |
| GET | `…/presets/{id}/versions/{n}?remap=current` (l.213) | — | `{version, remap?:{from_schema_hash, to_schema_hash, config, dropped[{pointer,label,message}], errors[], summary, ok}}` | base load, run default preset, editor |
| POST | `…/presets/{id}/versions` (l.244) | `{config, notes?}` | `{preset, version, warnings}`; 403; 409 | publish |
| GET | `…/{eid}/promote-prefill?kind=saved|run|job&id=` (l.296, manager) | — | `{config, remap, warnings[], unbound[{slot_key,label,model}], source{label,…}}` | promote |
| GET | `…/{eid}/best-runs/scope` (`api/eval_best_runs.py:88`) | — | `{datasets:[{id,name,run_count,versions:[{id,version,run_count}]}], versioning{key:[{value,run_count}]}, total_runs}` | best-run picker |
| GET | `…/{eid}/best-runs` (l.43) | `dataset_id, dataset_version_id, versioning=k=v*, metric, k, limit, exclude_errored` | shape in `services/eval_best_run.py:51–100` (`runs[{rank, run_id, score, pass_at_k_value, item_count, error_item_count, dataset, dataset_version, remote_versioning, params{sweep…}, age_seconds}]`, `metric`, `metrics[{name,run_count}]`, `k`, `scope{dataset, dataset_version, versioning, global}`, `reason`, `excluded_errored_count`, `latest_version_with_runs`) | picker |
| GET | `…/{eid}/best-runs/{run_id}/base?metric=` (l.101) | — | `{run{id,…}, base_source, config, score, remap, warnings[], prompts[{slot_key,label,model,base_url,reason}], versioning, latest_versioning, drift{status same|changed|unknown, changes[{key,run,latest}]}}` (`services/eval_best_run_base.py:36–55`) | best-run base |
| GET | `/v1/datasets?project_slug=` / `/v1/datasets/{name}/versions?project_slug=` | — | `{datasets:[{name,…}]}` / `{versions:[{version, status, aliases[]}]}` | dataset picker |
| POST | `/api/dashboard/models` (`api/dashboard.py:1296`) | `{project_slug, filters, k, selected{model:[ids]}}` | `{models:[{model_key, model_name, total_runs, rows:[run rows]}], scope{tasks[], datasets[]}, metrics[], metric_summary{m:{is_boolean,is_numeric}}, filtered_revision, selected_revision, project}` | models view |
| POST | `/api/dashboard/models/stats` (`api/dashboard_stats.py:132`) | `{metric, threshold, is_boolean, direction, groups:[{key, runs[]}]}` (≤100 groups, ≤2000 runs) | `{groups{key:{passAtK, passHatK, maxAtK, consistency, reliability, avgScore, minScore, stddevScore, totalScoreSum, avgLatency, medianLatency, totalItems, failedCount, K, correctDistribution[], runNames[]}}, missing[]}` | models view |
| POST | `/api/dashboard/runs` | `{project_slug, filters, sort, limit, offset, include_config_groups}` | `{tasks{}, total_runs, config_groups[]}` | run-selection modal |

Client-side reshaping to be aware of: experiments list resolves environment names
from a separate env fetch; the queue page builds the Experiment filter options from
names seen in responses; the launch form flattens `env_overrides` into
`{pointer: value}` (`flattenOverrides` l.318) and rebuilds nested objects on send
(`buildOverrides` l.267); `/slot_bindings/<key>` pointers are used as error targets;
dataset ref is encoded `'' | 'v:<version>' | 'a:<alias>'` and emitted as
`evaluator.dataset_version` or `evaluator.config.dataset_alias`.

## 5. Shared dependencies

- `shell.js` (`window.QymShell`, `shell.js:2895`): `getPageContext()`,
  `getProject()`, `setBreadcrumbs([...])`, `toast(msg, type)`, `navigateTo(url)`,
  `announceRunStatus({runIds, status})`, `openConfirmDialog({title, description[],
  confirmLabel, cancelLabel, confirmClass})`, `openFormDialog({fields})` (Save as
  preset), `openDrawer({title, subtitle, width})` (env drawer on settings),
  `skeletonHTML/liftSkeleton/arrive` (models view). Events `qym:shell-ready`,
  `qym:before-navigate`. Shell modal CSS classes (`.shell-modal-*`, `.shell-btn-*`,
  `.shell-form-*`) are reused by the queue cancel dialog, env dialogs, temp-model
  form.
- `qym_table.js` (`window.QymDataTable.render({host, columns, rows, storageKey,
  minWidth, renderRow})`): resizable columns persisted in localStorage; used by the
  experiments list, job history, queue jobs, remote items.
- `ui_components.js/.css`: `renderPagination`, `.qym-badge--tone`, `.qym-tag--
  success|danger|warning|info|accent|count|data|role|version`, `.qym-tabs`,
  `.qym-segmented`, `.qym-control/.qym-select/.qym-input/.qym-search`,
  `.qym-inline-action--accent|neutral|danger`, `.qym-icon-action`, `.qym-chip`,
  `.qym-stat-strip`, `.qym-help-marker`.
- `qym_safe.js` (`QymSafe.escapeHtml`) in the innerHTML-based modules
  (`eval_environments.js`, `eval_temporary_model.js`, `run_experiment_panel.js`);
  the launch-form family uses DOM `el()`/`textContent` only.
- `auth.js` (`QymAuth.handle401`).
- `dashboard.js` + `metrics.js` (`QymMetrics.defaultPassThreshold`, `getMetricColorClass`,
  `formatMetricValue`, `mergeMetricNames`, `defaultMetricName`), `runs_order.js`,
  `kpis.js` for the models page; `dashboardQuery()`, filter state and command bar
  are shared with runs/charts (see that brief).
- Defined here and imported elsewhere: `window.QymEvalEnvironments` (settings page
  uses `mountEnvironmentsPanel`, `openEnvironmentDrawer`, `openAddDialog`,
  `highPriorityWarning`), `window.QymOfficialDefaults` (settings page), `window.
  QymTemporaryModel`, `window.QymExperimentLaunch` (settings page via `openEditor`),
  `window.QymRunExperimentPanel` (run detail page), `window.QymLaunchJson/Sweeps/
  BestRun/Advanced` (launch-form internal), `codemirror-bundle.js` (also
  `trace_viewer.js`).

## 6. Design-token usage

Area CSS uses tokens only (no hardcoded hex found in `experiment_launch*.css`,
`eval_*.css`): `--space-xs/sm/md/lg/xl`, `--font-sm/base/md/lg/title`,
`--font-mono/sans`, `--text-primary/secondary/muted/dim` (dim only on separators and
the queue chevron), `--bg-void/base/surface/elevated/active`, `--border-subtle/
default/strong`, `--accent-primary/secondary/tertiary-soft`, `--error/--warning/
--success/--info`, `--chart-1..5`, `--control-radius`. The CodeMirror theme
(`experiment_launch_advanced.js:944–961`) maps editor colours to the same tokens —
reuse that mapping for the React editor theme. Recipes relied on: page hero (title
22px/650 + muted description + meta line), tabs, stat strip, data table, badges/tags,
inline actions, modal, empty state, callouts (`.xl-callout--warning|error`,
`.env-callout`). Candidate component styles to extract: `.xl-card`/`.xl-card-header`
(section card with step number), `.xl-field` + `.xl-dot` (changed indicator) +
`.xl-field--error`, `.xl-steps`/`.xl-step-btn` (wizard nav), `.xl-start-card`,
`.xl-model-card`, `.xs-chips`/`.qym-chip`, `.xl-role-table`, `.xlj-table`,
`.exq-progress-track/-fill`, `.exq-env` summary card, `.env-slot` card,
`.odx-version` history row. Sanctioned exceptions: none specific; glyph sizes (×, ▶,
↻, ⊘) follow the frozen allowlist in `tests/platform/test_design_language.py`.

## 7. UX pain points observed

- The launch form is ~7,000 lines of imperative DOM; every edit re-renders whole
  sections (`renderSettings` rebuilds all groups), which drops focus unless special-
  cased (entry bar name input, Advanced panel `focusInside` checks). Typing in a
  settings field triggers `renderPreviewSoon` + a dry-run POST every 600 ms.
- Six steps plus an entry screen, with "Skip to review" — users lost the Evaluation
  config tab before (B24), so step discoverability is still a concern; count badges
  only on steps 4/5.
- Validation errors are reported with JSON pointers (`/env_overrides/LLM_OVERRIDES/
  endpoints/primary/model`) and combination labels; the mapping to a visible field
  relies on `data-xl-pointer` prefix matching and can land on a container.
- Model slots: three different concepts (global model, per-slot binding, sweep) in
  one card stack; "custom" vs "follows global" tags and the "a later global change
  overwrites custom endpoints" rule are documented in hints only.
- Temporary-model API keys: re-enter rows appear in several places (slot card,
  global control, best-run prompts); the retry 422 `temporary_key_required` is not
  handled in the UI at all (retry just fails with a toast).
- Queue: a `<select>` of experiments is populated from whatever jobs were returned,
  so an experiment with no live job is not selectable; "Elapsed" is computed at
  render time and only refreshes on poll.
- Experiments list "Best score" column is always empty.
- Environment page/drawer is innerHTML strings with manual re-render per section;
  unsaved settings inputs survive only because of that per-section trick.
- a11y: tabs are links with `role=tab` but no arrow-key handling; the matrix table
  cells pack checkbox + badge + buttons without a row label; the custom queue dialog
  does not trap focus; chips use `aria-pressed` but value chips (`role=listitem`)
  have remove buttons only; the models page ranking uses emoji medals; many
  controls are `aria-label` only (no visible label), e.g. priority/dataset selects
  on the entry screen; colour-only "changed" dot (title tooltip only).
- The models page needs exactly one task+dataset but the only way to pick them is
  the global command-bar filters, with an empty state that says so.
- Mobile: none of these pages adapt below ~1000px (tables set `minWidth`, wizard is
  a two-column grid).

## 8. Migration notes

**Routes** (React Router): `/projects/:slug/experiments` (list),
`/projects/:slug/experiments/new` (replace `?new=1`; keep `?env=`, `?clone=&job=`,
`?base=saved&preset=`), `/projects/:slug/experiments/:id`,
`/projects/:slug/experiments/queue`, `/projects/:slug/environments` and
`/projects/:slug/environments/:envId` (replace `?view=environments` /
`?environment=`), `/projects/:slug/environments/:envId/default-preset/edit`
(`?from=vN` | `?promote=saved|run|job&id=`), `/projects/:slug/models`. Keep the old
query forms as redirects since `run_experiment_panel.js`, emails and tests link to
them.

**Component tree**
- `ExperimentsPage` → `ExperimentsTabs`, `ExperimentFilters` (status, mine,
  `VersioningFacetSelects`), `ExperimentsTable`, `Pagination`
- `ExperimentDetailPage` → `ExperimentHeader` (`ControlActions`: CancelExperiment,
  RetryFailed), `ExperimentStatStrip`, `QueueStrip`, `ExperimentMatrix`
  (`MatrixCell` → `JobStatusBadge`, `HeadlineMetric`, `JobActions`, `SavePresetButton`,
  `PromoteButton`; `CompareToolbar`), `SettingVsMetricChart`, `JobHistoryTable`
- `LaunchExperimentPage` → `LaunchFormProvider` (state machine, see below) →
  `EntryScreen` (`EnvironmentPicker`, `DatasetPicker`, `StartFromCards`,
  `BaseStatus`, `EntryBar`) | `CustomizeWizard` (`StepNav`, steps:
  `RunSettingsStep` (Name, PrioritySelect, VersioningDetailsField),
  `StartingPointStep` (`BaseSegmented`, `SavedPresetSelect`, `BestRunPicker` →
  `ScopePrompt`, `BestRunTable`), `ModelsStep` (`EnvVersionsBlock`,
  `GlobalModelControl`, `ModelSlotCard` → `ConnectionSelect`, `TemporaryModelForm`,
  `TemporaryModelChip`, `ReenterKeyRow`, `ModelSweepChips`; `AddEndpointControls`),
  `EnvironmentConfigStep` (`SettingsToolbar`, `SettingsGroup` → `FieldNode` →
  `LeafField` (`BooleanSelect`, `EnumSelect`, `EndpointRefSelect`, `NumberInput`,
  `TextInput`, `JsonTextarea`, `StructuredJsonEditor`, `SweepChipEditor`),
  `CollectionNode`, `ExtraKeysNode`, `RoleTableSummary`; `RoleOverridesCard` →
  `RoleTable` + `AllRolesRow`; `SweepsCard` → `AxisRow`), `EvaluationConfigStep`
  (`EvaluatorConfigFields`, `OtherValues`, `RunMetadataEditor`, `PlatformOwnedList`),
  `ReviewStep` (`ReviewPanel` → `Summary`, `RunPreview`, `ValidationList`,
  `LaunchButton`; `RawJsonCard` → `JsonConfigEditor`)). Editor mode: same tree under
  `DefaultPresetEditorPage` with `EditorSidePanel` (notes, publish).
- `QueuePage` → `QueueFilters`, `EnvironmentSummaryCards`, `QueueJobsTable`
  (`BulkBar`, `JobRow` → `RunProgress`), `RemoteQueueSection` (`RemoteEnvBlock`),
  `CancelSplitDialog`
- `EnvironmentsPage` → `EnvironmentsTable`, `AddEnvironmentDialog` (3 steps,
  `FormPreview`, `SlotEditor`); `EnvironmentPage` → `StatusSection`,
  `SchemaSection` (`SchemaDiff`), `SlotGroupsSection` (`SlotEditor` read-only,
  `GroupingDialog`), `PresetsSection` (`DefaultPresetBlock`, `VersionHistory`,
  `SavedPresetsTable`), `RankingSection`, `PoliciesSection`, `ConnectionSection`
- `ModelsPage` → shared `CommandBar`, `ModelsControls`, `ModelCard` (`StatTile`,
  `DistributionBar`), `ModelsRanking`, `RunSelectionDialog`
- `RunExperimentPanel` (used by the run page brief).

**State placement**
- URL: list filters (`status`, `mine`, `versioning`), queue filters, env id,
  experiment id, launch entry params (`env`, `clone`, `job`, `base`, `preset`),
  models page command-bar filters (owned by the runs brief).
- Server cache (TanStack Query keys): `['project', slug]`, `['me']`,
  `['experiments', pid, {status, mine, versioning, page}]` (refetchInterval derived
  from data: 5 s with backoff → implement a custom interval hook or use
  `refetchInterval: (q) => …`), `['experiment', pid, xid]` (same), `['eval-queue',
  pid, filters]`, `['eval-queue-strip', pid, xid]`, `['eval-queue-remote', pid,
  envId]` (enabled only when the section is open), `['eval-environments', pid,
  {active}]`, `['eval-environment', pid, eid]`, `['env-form', pid, eid]`,
  `['env-slots', pid, eid]`, `['env-model-options', pid, eid]`, `['env-extra-slot',
  pid, eid, name]`, `['env-versioning', pid, eid]` (manual refetch only),
  `['env-presets', pid, eid]`, `['preset-versions', pid, eid, presetId]`,
  `['preset-version', pid, eid, presetId, n, 'remap']`, `['best-run-scope', pid,
  eid]`, `['best-runs', pid, eid, scope, metric, includeErrored]`, `['best-run-base',
  pid, eid, runId, metric]`, `['datasets', slug]`, `['dataset-versions', slug,
  name]`, `['evaluator-config', pid, envIds+schemaHashes]`, `['experiment-clone',
  pid, xid, jobId]`, `['dashboard-models', slug, filters, k, selected]`,
  `['dashboard-model-stats', slug, revision, payload]`. Mutations: create (dry-run
  as a `useQuery` keyed on the serialized body with 600 ms debounce, or a mutation
  triggered by a debounced effect), cancel/retry/clone/presets/slots/env CRUD —
  invalidate the keys above.
- Local (component/form) state: the whole launch document (values, invalid, bindings,
  secrets, addedKeys, rawJson, extraEndpoints, links, groupOpen, search, changedOnly,
  step, view, base info, advanced edits, meta rows); matrix selection; queue
  selection sets; dialog state; models view selections (`modelRunSelections`,
  `visibleStatKeys`, `thresholdByMetric`). Keep secrets in a `useRef`/closure, never
  in a store that devtools serialize, and clear on unmount.

**Form library recommendation: React Hook Form + Zod** (`react-hook-form` with
`zodResolver`, `useFieldArray`). Reasons specific to this form: (1) the field set is
*dynamic and schema-driven* — pointers are only known after `/form` loads and differ
per environment union; RHF registers fields lazily by name (use the JSON pointer as
the field name with `.`-escaping, or a `Map`-backed custom `Controller` layer) and
keeps uncontrolled inputs so the 600 ms preview loop does not re-render every field;
(2) `dirtyFields`/`defaultValues` map 1:1 onto today's `baseline` vs `values` diff
semantics (reset-to-base = `resetField`, "Undo all" = `reset(baseline)`,
"changed dot" = `formState.dirtyFields[pointer]`); (3) `setError(pointer, …)` with
server pointers and `setFocus` replace `focusError()`; (4) `useFieldArray` covers
run_metadata rows, collection keys, extra keys, sweep value lists; (5) Zod schemas
can be generated from the descriptor entry (`type`, `bounds`, `enum`, `pattern`,
`accepts`) and from `experiment_launch_sweeps.js:checkValues` /
`experiment_launch_advanced.js:typeProblem` so client and Raw JSON validation share
one source. Formik/Final Form re-render per keystroke across the form and would make
a 300-field schema sluggish; TanStack Form is viable but its dynamic-name ergonomics
and ecosystem are thinner. Keep the server dry run as the authority: client Zod only
mirrors the cheap checks.

**JSON config editor recommendation: `@uiw/react-codemirror` (CodeMirror 6)** with
`@codemirror/lang-json` and `@codemirror/lint` (`jsonParseLinter`). It is the same
engine already vendored (`codemirror-bundle.js`), is small enough to code-split with
`React.lazy` for the Raw JSON card only, supports a custom theme built from the CSS
tokens (`EditorView.theme` as in `experiment_launch_advanced.js:944`), per-line bidi
(`EditorView.perLineTextDirection`, required by `docs/DESIGN_LANGUAGE.md` "Text
direction"), and the two-way sync pattern (`value` prop + `onChange`, apply on blur /
"Apply", `onBlur` from `EditorView.domEventHandlers`). Monaco is ~3 MB and overkill;
a plain textarea loses lint and bracket matching that B24 relies on. Reuse the same
component read-only for the preset version "Config document" view and the run
panel's "Service result". For the *structured* JSON editor (`experiment_launch_json.js`)
build a small recursive component with RHF field arrays rather than a generic
JSON-schema form library: the descriptor gives no item schema, so the current
value-inferred rules (uniform-key tables, "All items") must be reproduced.

**Backend changes likely needed**: SPA fallback for the new routes in `api/runs.py`
(it serves per-page HTML files today); CORS for the Vite dev server or a Vite proxy
to `/v1`, `/api`, `/static`; `best_score` on the list payload or drop the column;
`GET /eval-queue` option to list experiment names for the filter (or a lightweight
`GET /experiments?fields=id,name&status=live`); the retry endpoint's
`temporary_key_required` 422 needs a UI path (re-enter key dialog → resend with
`temporary_keys`); consider a `GET /experiments/{id}?include=jobs` split so list
polling does not pull `remote_result` blobs; `/v1/datasets` is slug-scoped while
everything else is id-scoped (keep both or add `project_id`).

**Risks / gotchas**: dry-run preview races (guard with request generation /
`AbortController`; the old code bumps `generation` and ignores stale responses);
`loadEnvData` dedupe (never apply a base onto a half-loaded union); schema refresh
mid-edit re-fetches the base with `remap=current` and must replay edits;
experiment detail payloads can be large (`remote_result`, `qym_config` per job) —
poll with `select` and structural sharing; queue `limit=500` tables and remote
snapshots need virtualization only beyond a few hundred rows (`QymDataTable` today
is not virtualized); secrets handling (keys only in `secrets` body field, never in
spec, never logged, cleared on unmount; Raw JSON must refuse literal keys as
`readBinding` does l.1125); `announceRunStatus` cross-tab channel must keep working
for the run page; polling must pause on hidden tabs; HIGH priority confirmation
must happen before and (on 422) after the request; `history.replaceState` filter
sync must not create history entries; CodeMirror theme must honour
`color-scheme: dark`; the models view requires the shared command bar and
`dashboardQuery` batching (≤100 groups/≤2000 runs); sessionStorage handoff to
Compare (`compareRuns`) is consumed by another area.

**Playwright scenarios**
1. List: filter by status + "Created by me", reload, filters persist in URL; a
   RUNNING experiment makes the page poll and the "Auto-refreshing" note appear.
2. Detail: cancel experiment with pending jobs → confirm text mentions queued jobs;
   with only running jobs → "Stop N running jobs"; toasts summarise outcomes.
3. Detail: retry a FAILED job on a HIGH experiment → ack dialog → new attempt row,
   "Show earlier attempts" reveals the superseded one; matrix cell shows "↻ 1 earlier".
4. Launch entry: pick env with default preset → card "Default preset vN" selected
   automatically, "Launch as is" enabled once the dry run returns "Ready".
5. Launch wizard: change a setting on step 4 → changed dot + badge "1" on the step
   + "1 change on top" in the base status; Reset returns it; switch base → confirm
   dialog, edit survives when the setting exists on the new base.
6. Models step: add a temporary model with key → launch body carries
   `secrets[ref]` and `slot_bindings` holds `{$secret}` only; the key never appears
   in the DOM or URL; Raw JSON shows `{"$secret": …}`.
7. Sweeps: "+ values" on a number field, add range 0.1–0.5 step 0.1 → 5 chips,
   "5 runs to launch"; link two axes of different lengths → error; exceed cap →
   Launch disabled with the over-cap callout.
8. Raw JSON: edit the document with an unknown key → error list, Launch blocked;
   fix and Apply → fields update; "Revert to form" restores.
9. Queue: select two jobs, bulk cancel → split dialog lists them under the right
   section, reason sent; "Cancel all queued in experiment" only after filtering by
   experiment; remote section loads only when expanded and shows orphan tags.
10. Environments: add dialog step 1 fails with a bad URL and shows the server error;
    success → step 2 preview → step 3 slot editor → confirm; "Run default preset" on
    an env whose preset uses a temporary model redirects to the launch form with a
    toast.

## 9. Open questions

1. Whether to keep the entry screen + six-step wizard split or collapse to a single
   scrolling page with a sticky review panel (B24 was the latest reversal; the
   component agent must pick and log it).
2. `best_score` column: add it server-side (from `eval_run_scores`) or drop it.
3. Whether the Raw JSON editor stays on the review step only, or is available as a
   side drawer from every step (B24 trade-off noted "Raw JSON is no longer next to
   the fields it edits").
4. Handling of retry `temporary_key_required` (no UI today): inline key dialog vs
   redirect to clone.
5. Keep the per-slot "Reset" + global "Undo all changes" + "Reset all" trio, or
   unify into one reset affordance per step.
6. The queue Experiment filter source (current responses vs a dedicated lookup).
7. Whether the models page keeps relying on the global command bar for task/dataset
   selection or gets its own two selects (the empty state suggests users struggle).
8. Table column-width persistence: keep `QymDataTable`'s localStorage keys
   (`experiments.list.v1`, `experiments.jobs.v1`, `eval-queue.jobs.v1`,
   `eval-queue.remote.v1`) or migrate to a shared table component without resizing.
9. Whether "Promote to default preset" should navigate to the settings page (as now)
   or open the editor in place under the environment page (the page already supports
   `onEditOfficial`).
10. Polling cadence: the docs say 10 s → 30 s → 60 s (B13) while the code uses 5 s ×1.5
    → 60 s; pick one and log it. Consider SSE for queue/detail live updates instead.
