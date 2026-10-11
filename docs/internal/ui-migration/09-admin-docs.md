# Admin and in-app Docs — migration brief

Written by an analysis agent for the React/TypeScript/Vite migration. Audience: the
component agent that will rebuild this area from scratch in `frontend/`. Be concrete:
file paths with line numbers, API routes with methods and response shapes, exact
behaviors. No marketing language.

All paths below are relative to `packages/platform/qym_platform/` unless they start
with `docs/`, `tests/` or `packages/`. "dashboard/" means `_static/dashboard/`.

Scope note: the prompt mentioned `api/org.py`; it does not exist. User/admin
endpoints live in `api/web.py`, maintenance in `api/admin.py`, project archive /
API key / dataset-read-token endpoints in `api/projects.py`, the admin-only run
lists and force-stop in `api/runs.py`, and auth/bootstrap in `api/auth.py`. There is
no `/v1/admin/org/*` or `/v1/admin/settings` endpoint (a docs test,
`tests/platform/test_platform_docs.py:67-68`, asserts they are *not* documented).
GitLab login is configured only through env vars (`settings.py:52-75`,
`QYM_AUTH_GITLAB_URL/CLIENT_ID/CLIENT_SECRET`); there is no admin UI for it.

## 1. Surface inventory

| page/route | HTML file | JS/CSS files it loads | entry function(s) | approx LOC |
|---|---|---|---|---|
| `GET /admin` (`api/runs.py:2255-2263`, served through `_dashboard_html_response` at `api/runs.py:1267-1283`, which injects `window.__QYM_ROOT_PATH__` and rewrites `/static/` for sub-path mounts) | `dashboard/admin.html` | `dashboard.css`, `shell.css`, `ui_components.css`; `qym_safe.js`, `auth.js`, `shell.js`, `ui_components.js` (defer). All page logic is an inline IIFE, `admin.html:376-1030`; page CSS is an inline `<style>`, `admin.html:14-142` | `load()` (`admin.html:415-437`), `setAdminTab()` (`:457-472`), `loadLiveRuns()`/`loadRecentRuns()` (`:494-543`), `renderProjects()` (`:555-630`), `renderUsers()` (`:632-732`), `openEditUserModal()` (`:748-770`), `resetUserPassword()` (`:780-806`), `saveEditUser()` (`:822-862`), `loadMaintenance()`/`renderMaintenance()` (`:872-962`), `pollLiveRuns()` (`:1013-1018`) | 1,032 (HTML+CSS+JS) |
| `GET /docs-guide` (`api/runs.py:2277-2285`) | `dashboard/docs.html` (26 lines) | `dashboard.css`, `shell.css`, `docs.css` (274), `ui_components.css`; `qym_safe.js`, `ui_components.js`, `auth.js`, `shell.js`, `docs-hljs.min.js` (highlight.js v11.11.1 custom build, 127 KB, languages: bash, javascript, json, python, yaml; identified from the banner and `registerLanguage` calls), `docs.js` (414) | `start()` (`docs.js:419-433`), `buildNav()` (`:143-181`), `route()` (`:403-417`), `loadPage()` (`:349-401`), `enhanceCode()` (`:225-271`), `buildTOC()` (`:284-324`), `buildPager()` (`:327-346`) | ~720 + 27 content partials |
| Docs content partials (`GET /static/docs/<section>/<page>.html`) | `dashboard/docs/{get-started,platform-guide,sdk-guide,developer}/*.html` — 27 files, 573 KB total, hand-written HTML fragments (NOT markdown). Classes used: `docs-eyebrow`, `docs-lead`, `docs-callout{.tip,.warn,.danger}`, `docs-callout-icon`, `docs-callout-title`, `docs-cards`/`docs-card`; `<pre data-lang="python|bash|json|text|csv|<filename>">`; plain `<table>`. | none (fetched by `docs.js` and injected with `innerHTML`) | — | 573 KB |
| Related but owned elsewhere: `GET /profile` bootstrap-admin panel (`dashboard/profile.html:192-200, 271-333`), Project Settings API keys and dataset read tokens tab (`dashboard/project_settings.html:598-600, 1038, 1070, 1452, 1460`), `GET /login` (`api/auth.py:161-184`). Routes for these are documented in section 4 because the prompt asked for them. | | | | |

Shell: sidebar links `Docs` (global, `shell.js:573`) and `Admin` + `Deleted Runs`
under a "Platform" label shown only to `role === 'ADMIN'` (`shell.js:576-578`,
`:812-815`). Route detection: `shell.js:193` (`/admin` -> page `admin`), `:196`
(`/docs-guide` -> page `docs`). Both are "global pages, no project".

## 2. User journeys (as-is)

### Journey A — Admin: watch and force-stop live runs
1. Entry: sidebar "Admin" (admins only) or `/admin`. `load()` fires four requests in
   parallel: `v1/me`, `v1/admin/users`, `v1/projects`, `v1/auth/providers`
   (`admin.html:416-421`). If `me.role !== 'ADMIN'` the whole `<main>` is replaced by
   an error card "Admin access required" (`:1007-1009`). 401 anywhere redirects to
   `/login?next=...` via `QymAuth.handle401` (`auth.js:70-76`).
2. Three stat cards (Total Users, Projects, Total Runs = sum of `project.run_count`;
   shows "—" when 0) render with skeletons until data arrives (`:424-428`).
3. Tabs: Runs | Projects | Users | Maintenance. Last tab is remembered in
   `sessionStorage['qym:admin-tab']` (`:471`, read at `:981`). No URL state.
4. Runs tab (default): "Live Runs" table (project, run, owner, status with pulsing
   dot, progress `completed/total`, relative "updated", Force stop button) and
   "Most Recent Eval Runs" table (6 per page, server-paginated via
   `QymUIComponents.renderPagination`, `:532-542`). Live runs poll every 10 s
   (`:1013-1018`), only after the first load; no overlapping requests
   (`liveRequest` sequence counter). Polling stops on `qym:before-navigate` /
   `pagehide` (`:1025-1026`).
5. Force stop: button only if `run.can_force_stop` and not already stopped locally.
   Opens `QymShell.openConfirmDialog` (title "Force stop run", danger button); on
   confirm POSTs `api/runs/{id}/force-stop`, bumps request sequences to discard
   in-flight list responses, calls `QymShell.announceRunStatus({runIds, status:
   'STOPPED'})` so other pages/tabs refresh, removes the run from Live, merges the
   response into Recent, writes "… was force stopped. Further updates are blocked."
   into `#run-message` (`role=status aria-live=polite`), then reloads both lists
   (`:385-432`). Error path writes red text in the same message area. The
   Playwright contract `tests/platform/fixtures/admin_force_stop_contract.cjs`
   asserts: exactly one POST, the button disappears, "No live runs", the message
   text, polling never overlaps, and a 409/failed stop re-enables the button.
6. Empty states: "No live runs" / "No recent eval runs"; error states: "Failed to
   load live runs" in red inside the table.
7. Run links go to `/projects/{slug}/runs/{run_id}` (fallback `/run/{id}`), through
   the shell's in-app navigation.

### Journey B — Admin: projects
1. Projects tab: table of all projects (admins get *all*, including archived,
   from `GET /v1/projects`), columns name, slug, Active/Archived, member count,
   actions.
2. "+ New Project" calls `QymShell.openCreateProjectDialog()` (shell-owned form
   dialog; it posts `/v1/projects` and updates the sidebar switcher).
3. Active project: `Settings` link (`/projects/{slug}/settings`) and `Archive`.
   Archive opens `QymShell.confirmArchiveProject` (`shell.js:1118-1166`): fetches
   `GET /v1/admin/projects/{id}/archive-preview`, lists up to 5 in-progress runs and
   "and N more", button becomes "Archive anyway" (danger) when any; on confirm POST
   `/v1/admin/projects/{id}/archive`, `QymShell.removeProject({id})` (sidebar),
   message "Archived "name"", full `load()`.
4. Archived project: `Open` (read-only), `Settings` (revoke keys / remove members /
   delete), `Unarchive`. Unarchive opens `QymShell.confirmUnarchiveProject`
   (`shell.js:1173-1228`): fetches `unarchive-preview`, lists up to 10 API keys that
   would start working again, offers an alternate button "Revoke keys first" which
   navigates to `/projects/{slug}/settings?tab=apikeys` (`admin.html:593-596`); on
   confirm POSTs `unarchive`, `QymShell.upsertProject(result)`.
5. Deletion is *not* here; it lives in Project Settings > Danger Zone
   (`DELETE /v1/admin/projects/{id}?confirm=<name|slug>`).

### Journey C — Admin: users
1. Users tab: add-bar (email, display name, role select MEMBER/ADMIN, "Create User")
   above a table (user, email, role badge, Active/Disabled, Edit + Disable/Enable).
   Create has no client validation; the server lower-cases and returns
   `{existing: true}` for duplicates, which the UI ignores (message still says "User
   created", `:990-1003`).
2. Disable: confirm dialog "Disable user" (danger). On success: inline message
   "User disabled" and a 10 s toast with an **Undo** action that re-enables
   (`:656-683`). Your own row's Disable button is permanently disabled with a tooltip
   (`:641-645`). Enable has no confirmation. Browser test:
   `tests/platform/test_access_admin_browser.py:190` ("asks first and can be undone").
3. Edit: modal `#edit-user-modal` (email, display name, role, Active checkbox,
   optional Password section, self-edit note). Opened through
   `QymUIComponents.openDialog` (focus trap, initial focus on name, focus restore).
   Closes on Cancel, ×, backdrop click, or Escape (unless a shell confirm dialog is
   open, `:984-988`). Editing yourself locks role + active (`:755-762`) and omits
   them from the PUT body (`:838-842`).
4. Reset password (shown only when `v1/auth/providers.local_auth.enabled` and not
   self): confirm dialog "Reset password" (text includes "They are signed out of
   every browser."), POST `.../reset-password`, shows the one-time password in a
   readonly mono input with a copy button; "It is not shown again." While a save or
   reset is pending all fields and buttons are locked and the modal cannot close
   (`:736-746`); closing clears the temp value. Contract:
   `tests/platform/fixtures/admin_password_reset_contract.cjs` (locks, stays open,
   cancel-does-not-reset, temp value shown, cleared on close, "Saving..." label).
5. Save: requires email; PUT; on success closes modal, "User updated", reload.
   Server errors (`400 Email already in use`, `409 You cannot remove your own admin
   role`, `409 At least one active admin must remain`) appear in
   `#edit-user-error` inside the modal.
6. Delete user exists in the API (`DELETE /v1/admin/users/{id}`) but has **no UI**.

### Journey D — Admin: maintenance
1. Maintenance tab (lazy: loads on first click, `:974-977`): header line summarising
   DB size, role, maintenance mode, event-log mode, retention, worker liveness,
   "refreshed N s ago"; "Refresh" forces `?refresh=1` (server caches stats 60 s,
   `api/admin.py:24, 78`).
2. Two tables: top-12 table sizes (total/heap/TOAST/index bytes, live/dead rows) and
   `run_events` rows by type. SQLite or a failing collector yields
   `{error}` and the table shows the error text.
3. "Maintenance jobs" form: kind select (from `job_kinds`, "(irreversible)" suffix),
   Params JSON text input (client-side `JSON.parse` validation), a confirm field
   that appears only for irreversible kinds (must equal the kind name), "Queue
   job". Help text under the form shows the kind's description.
4. Jobs table: kind, status (coloured class), progress message, created, finished,
   actions Log / Start (paused only) / Cancel (queued|running|paused). "Log" fills a
   `<pre>` with `kind status`, error, progress JSON, log text. While any job is
   queued/running/cancel_requested and the tab is visible, the page re-polls every
   3 s (`:946-950`).

### Journey E — Docs reader
1. Entry: sidebar "Docs" -> `/docs-guide`. `docs.js` builds the left nav from the
   hard-coded `SECTIONS` array (`docs.js:9-69`: 4 sections, 27 pages, inline SVG
   icons) and routes by **hash**: `#<section>/<page>[/<heading-id>]`. No hash ->
   `history.replaceState` to `#get-started/what-is-qym` (`:404-409`). Unknown
   section/page falls back to the first page.
2. Page load: `fetch('/static/docs/<section>/<page>.html')`, cached in memory per
   key, injected via `innerHTML` (`:349-401`). Then `enhanceCode()` wraps every
   `<pre>` with a header (language label + copy button, toast "Copied to
   clipboard"), highlights `python|bash|json` via `hljs.highlight(text, {language,
   ignoreIllegals})` (`:68-74`, `:231-234`); single-line plain blocks get
   `pre-wrap`; tables are wrapped in a horizontal-scroll container. Missing partial
   (HTTP error) renders an in-page warn callout "This page hasn't been written
   yet." (`:392-400`).
3. Right TOC: built from `h2, h3`; ids slugified if absent; hover "#" anchors
   appended to headings (`href="#section/page/heading"`); `IntersectionObserver`
   (root = `#shell-content`, `rootMargin 0 0 -75% 0`) highlights the active entry
   (`:309-323`). Clicking a TOC entry smooth-scrolls and `replaceState`s the hash.
4. Prev/Next pager appended to the article from the flattened page list.
5. Search box in the left nav filters page **titles and section titles only**
   (substring, client-side); Enter opens the first visible match; Escape clears;
   `/` focuses the search from anywhere unless an input is focused (`:160-180`).
   There is no full-text search.
6. Cross-page links inside partials (`<a href="#section/page">`) are intercepted so
   the article is swapped before scrolling (`:200-222`); the shell's
   `qym:popstate` is also handled so back/forward within docs does not refetch the
   outer page (`:427-432`).
7. Deep links: `/docs-guide#developer/endpoints/some-heading` scrolls to that
   heading after render (`:364-370`). `document.title` becomes "قيِّم • <page>".
8. Responsive: <=1100 px hides the TOC; <=780 px stacks nav above content
   (`docs.css:255-273`).
9. Persisted state: none (no localStorage). Keyboard: `/`, Enter, Escape.

## 3. Functional inventory

### Admin — shared
- Admin gate (`v1/me.role === 'ADMIN'`, else error card) — MUST-KEEP; server also
  enforces 403 on every endpoint.
- Stat strip (users / projects / total runs) — NICE; cheap, computed client-side.
- Tabs with `sessionStorage` memory — MUST-KEEP behaviour (remember tab), but move
  it to the URL (`/admin/users`) instead.
- Polling live runs every 10 s with sequence guards; stop on unmount — MUST-KEEP.
- `qym:before-navigate` / `pagehide` cleanup — MUST-KEEP (becomes React effect
  cleanup / query `enabled` flag).

### Runs tab
- Live runs table (all projects, limit 100) — MUST-KEEP.
- Recent runs table, page size 6, server offset pagination — MUST-KEEP (page size
  choice is arbitrary; 6 was chosen to fit a skeleton height of 355 px).
- Force stop with confirm, optimistic removal, cross-tab announce, re-fetch —
  MUST-KEEP; contract test exists.
- `forceStoppedRuns` local map that keeps a stopped run out of Live even if a
  stale poll returns it — MUST-KEEP semantics (do with query invalidation +
  `select`).
- Owner label fallback (display_name -> email local part -> id) — NICE.
- Relative time ("3m ago") — NICE; use a shared util.

### Projects tab
- List all projects incl. archived, with member counts — MUST-KEEP.
- New Project (shell dialog) — MUST-KEEP (shared dialog component).
- Archive with in-progress-run preview, Unarchive with API-key preview and
  "Revoke keys first" branch — MUST-KEEP; both dialogs are shared with Project
  Settings, so build once.
- Sidebar project switcher sync after archive/unarchive — MUST-KEEP (invalidate
  the `me`/projects query).

### Users tab
- Create user inline — MUST-KEEP; add validation and show the `existing` case.
- Disable with confirm + 10 s Undo toast — MUST-KEEP (tested).
- Enable without confirm — MUST-KEEP.
- Edit modal (email, name, role, active, self-lock, busy-lock) — MUST-KEEP (tested).
- Reset password -> one-time password with copy — MUST-KEEP (tested); gated on
  local auth enabled.
- Delete user — DROP-CANDIDATE for the UI (never had one; the API exists). Decide in
  section 9.

### Maintenance tab
- DB stats header + tables — MUST-KEEP (operator tooling), but it is Postgres-only.
- Enqueue job with JSON params and typed confirmation for irreversible kinds —
  MUST-KEEP.
- Jobs table with Log / Start / Cancel and 3 s polling while active — MUST-KEEP.
- Raw `<pre>` log viewer — NICE; could become a drawer.

### Docs
- Hard-coded IA (`SECTIONS`) — MUST-KEEP as data; `tests/platform/test_platform_docs.py:16-35`
  parses `docs.js` for the `(section, page)` pairs and checks each partial exists.
  The migration must keep an equivalent machine-readable source and update that test.
- Hash routing with heading deep links — MUST-KEEP semantics; the React version
  should use real paths (`/docs/:section/:page#heading`) and keep a redirect for
  old `#section/page` hashes.
- Lazy partial fetch + cache — MUST-KEEP (or bundle the content; see section 8).
- Code block header + copy + highlight — MUST-KEEP.
- TOC with scroll-spy and hover anchors — MUST-KEEP.
- Prev/Next pager — MUST-KEEP.
- Title-only search with `/` shortcut — NICE; consider real full-text search.
- "Page not written yet" callout — NICE.
- Single-line `<pre>` wrap heuristic — NICE.
- Table scroll wrapper — MUST-KEEP (wide endpoint tables).

## 4. Data & API contract

All calls are same-origin with the session cookie (`credentials: 'same-origin'`;
`require_ui_principal`). Error envelope is FastAPI's `{"detail": string}`; the UI
shows `detail` verbatim. 401 -> redirect to `/login?next=`. 403 `{"detail": "Admin
only"}` on every admin route. Pagination: only `api/runs/recent` paginates, with
`global_limit`/`global_offset` + `total_count`. All URLs are built with
`window.__QYM_ROOT_PATH__` as prefix (`admin.html:385-388`).

| method | path | query/body | response shape | used by |
|---|---|---|---|---|
| GET | `/v1/me` (`api/web.py:40-80`) | — | `{id, email, display_name, title, role: "ADMIN"\|"MEMBER", auth_type: "oidc"\|"local_password"\|"proxy_headers"\|"none", auth_provider, needs_admin_bootstrap: bool, can_bootstrap_admin: bool, projects: Project[] (active only), default_project: Project\|null}` | admin gate, self-detection, profile bootstrap panel |
| GET | `/v1/admin/users` (`web.py:118-135`) | — | `Array<{id, email, display_name, title, role, is_active: bool}>` (all users, ordered by email) | Users tab, stat |
| POST | `/v1/admin/users` (`web.py:138-160`) | body `{email, display_name?, role?: "MEMBER"\|"ADMIN", is_active?: bool}` | `{id, email}` or `{id, email, existing: true}` (no error on duplicate) | Create user |
| PUT | `/v1/admin/users/{id}` (`web.py:182-244`) | body `{email?, display_name?, role?, is_active?}` (all optional) | `{id, email, ok: true}`; errors 404, 400 "Email already in use", 400 "You cannot disable your own account", 409 "You cannot remove your own admin role", 409 "At least one active admin must remain". Disabling ends all sessions. | Edit modal, Disable/Enable, Undo |
| POST | `/v1/admin/users/{id}/reset-password` (`web.py:288-322`) | — | `{ok: true, user_id, temporary_password: string}` with `Cache-Control: no-store`; 400 "Email/password auth is not enabled", 404 | Reset password |
| DELETE | `/v1/admin/users/{id}` (`web.py:325-348`) | — | `{ok: true, deleted_id}`; 400 "Cannot delete yourself", 409 last admin | no UI today |
| GET | `/v1/users` (`web.py:83-101`) | — | active users without `is_active` (admin only) | not used by admin page (member pickers use `/member-candidates`) |
| GET | `/v1/auth/providers` (`api/auth.py:187-190`, payload `:72-81`) | — | `{auth_mode: "none"\|"proxy_headers"\|"oidc", providers: Array<{id: "google"\|"github"\|"gitlab"\|"sso", label, enabled: bool, kind: "social"\|"enterprise", coming_soon?: true}>, local_auth: {enabled: bool, signup_enabled: bool}}` (`auth_oidc.py:69-98`). Unauthenticated. | gates the Reset Password section; login page |
| POST | `/v1/auth/bootstrap-admin` (`auth.py:386-412`) | body `{bootstrap_token}` | `{ok: true, user_id, role: "ADMIN"}`; 403 "Invalid bootstrap token", 409 "Admin already exists" | Profile page panel (`profile.html:291-325`), shown only when `me.can_bootstrap_admin` |
| GET | `/v1/projects` (`api/projects.py:824-839`) | — | `{projects: Array<{id, name, slug, is_active, member_count, run_count, role: "MANAGER"\|"MEMBER"\|"", created_at, updated_at, ...correction_rules}>}` (`_project_payload`, `projects.py:258-295`); admins get archived projects too | Projects tab, stats |
| POST | `/v1/projects` (`projects.py:842-885`) | `{name, slug?}` | project payload; 400 "Project slug already exists" | shell create dialog |
| POST | `/v1/admin/projects` (`projects.py:1417-1456`) | same | same (admin-only twin) | not used by UI |
| PATCH | `/v1/admin/projects/{id}` (`projects.py:1459`) | `{name?, slug?, is_active?}` | project payload | Project Settings rename |
| POST | `/v1/admin/projects/{id}/archive` (`projects.py:1726-1742`) | — | `{ok: true, project_id, archived: true}` (also stops product evals and analysis jobs) | Archive |
| POST | `/v1/admin/projects/{id}/unarchive` (`projects.py:1780-1793`) | — | full project payload | Unarchive -> `upsertProject` |
| GET | `/v1/admin/projects/{id}/archive-preview` (`projects.py:1866-1914`) | — | `{project_id, name, running_count, running_runs: Array<{run_id, run_name, started_at}>}` (max 5) | shell archive dialog |
| GET | `/v1/admin/projects/{id}/unarchive-preview` (`projects.py:1801-1863`) | — | `{project_id, name, slug, archived, active_api_key_count, active_api_keys: Array<{id, name, prefix, creator: {id, email, display_name}, created_at}>}` (max 10) | shell unarchive dialog |
| GET | `/v1/admin/projects/{id}/deletion` (`projects.py:1917-1936`) | — | `{project_id, name, slug, archived, counts, can_delete, blocked_reason}` | Project Settings danger zone |
| DELETE | `/v1/admin/projects/{id}` (`projects.py:1939`) | `?confirm=<name or slug>` | `{ok,...}`; 400 confirm mismatch, 409 has runs | Project Settings |
| GET | `/v1/projects/{id}/api-keys` (`projects.py:1247-1279`) | — | `{api_keys: Array<{id, name, prefix, project_id, creator: {id, email, display_name}, scopes: string[], created_at, revoked_at\|null}>}` | Project Settings |
| POST | `/v1/projects/{id}/api-keys` (`projects.py:1282-1305`) | `{name?: "default", scopes?}` | `{id, prefix, token}` — token shown once | Project Settings |
| DELETE | `/v1/projects/{id}/api-keys/{key_id}` (`projects.py:1308-1332`) | — | `{ok: true, id}`; 400 already revoked; owner/manager/admin only | Project Settings |
| GET | `/v1/projects/{id}/dataset-read-tokens` (`projects.py:1358-1372`) | — | `{tokens: Array<{id, name, prefix, project_id, creator\|null, created_at, revoked_at}>}`; **admin only** (403 "Only admins can manage dataset read tokens") | Project Settings (admins) |
| POST | `/v1/projects/{id}/dataset-read-tokens` (`projects.py:1375-1392`) | `{name?: "Evaluation Service"}` (1-200 chars) | token payload + `token` (once) | Project Settings |
| DELETE | `/v1/projects/{id}/dataset-read-tokens/{token_id}` (`projects.py:1395-1414`) | — | `{ok: true, id}` | Project Settings |
| GET | `/api/runs/live` (`api/runs.py:3196-3283`) | `all_projects=true&limit=100` (admin only when `all_projects`) | `{runs: AdminRunSummary[], total_count, last_updated, project: null}` | Live Runs |
| GET | `/api/runs/recent` (`runs.py:3286-3359`) | `all_projects=true&include_projects=false&global_limit=6&global_offset=N` (`all_projects` is mandatory; admin only) | `{runs: AdminRunSummary[], projects: [], total_count, global_limit, global_offset, last_updated}` | Recent Runs |
| POST | `/api/runs/{id}/force-stop` (`runs.py:6911-6970`) | — | `{ok: true, run_id, stopped: bool, status: "STOPPED", status_reason, ended_at, can_force_stop: false}`; 404; 409 "Run has already finished"; writable-project check | Force stop |
| GET | `/api/admin/maintenance` (`api/admin.py:68-104`) | `?refresh=1` | `{settings: {role, service, maintenance_mode, event_log_mode, span_retention_days, deleted_run_grace_days, span_partition_days_ahead}, workers: {loops: "local"\|"separate", summary_worker_alive: bool\|null, maintenance_worker_alive: bool\|null, maintenance_current_job, workers_service?: {alive, processes: Array<{alive, loops,...}>}}, pool: string\|null, db_stats: {database: {size_bytes,...}, tables: Array<{table, total_bytes, heap_bytes, toast_bytes, index_bytes, live_rows, dead_rows}>, run_events_by_type?: Array<{type, rows, payload_bytes}>} \| {error}, db_stats_age_seconds, job_kinds: Record<kind, {irreversible: bool, description}>, jobs: Job[]}` | Maintenance |
| POST | `/api/admin/maintenance/jobs` (`admin.py:118-140`) | `{kind, params: object, confirm?: kind}` | `Job`; 400 unknown kind / bad params / missing confirm; 409 (already queued) | Queue job |
| POST | `/api/admin/maintenance/jobs/{id}/start` / `/cancel` (`admin.py:143-162`) | — | `Job` | Start / Cancel |
| GET | `/api/admin/maintenance/jobs/{id}` (`admin.py:107-115`) | — | `Job` | unused |
| GET | `/static/docs/{section}/{page}.html` (StaticFiles mount `app.py:235`, pre-gzipped) | — | HTML fragment | docs.js |

`AdminRunSummary` (`runs.py:2068-2140`, built in `_summarize_runs_for_admin`
`:2143-2216`): `{run_id, run_name, external_run_id, task_name, dataset_name,
dataset_version, dataset_aliases: string[], model_name, status: "RUNNING"|"PENDING"|
"COMPLETED"|"FAILED"|"STOPPED"|..., status_reason, stop_requested: bool,
can_force_stop: bool, ended_at, timestamp, started_at, last_event_at,
progress_completed, progress_total, progress_pct, total_items, error_count,
execution_error_count, samples, last_completed_pass, owner: {id, email,
display_name}|null, project: {id, slug, name}|null}`.

`Job` (`db/maintenance_models.py:45-60`): `{id, kind, status:
"queued"|"running"|"paused"|"cancel_requested"|"cancelled"|"succeeded"|"failed",
params, progress: {message?,...}, log: string, error, requested_by_user_id,
lease_owner, created_at, started_at, finished_at, updated_at}` (ISO strings without
timezone suffix; the UI slices `YYYY-MM-DD HH:MM:SS`).

Client-side reshaping: total runs stat is a client sum; `liveRunsTotal` subtracts
locally force-stopped rows; recent rows are merged with the force-stop response;
owner/project labels have fallbacks; relative times computed client-side.

Docs content origin: **not markdown and not served by a backend renderer**. The
27 partials are hand-authored HTML in `dashboard/docs/**`. `packages/platform/
docs/USER_GUIDE.md` and `packages/sdk/docs/USER_GUIDE.md` are separate, parallel
documents; `tests/platform/test_platform_docs.py` only asserts that certain phrases
appear in both the markdown and the HTML partials (consistency checks), it does not
convert one into the other. There is no `/docs/*.md` endpoint.

## 5. Shared dependencies

- `shell.js` (`window.QymShell`, exports at `shell.js:2895-2942`): `pageSignal()`
  (AbortSignal for document listeners), `openConfirmDialog`, `confirmArchiveProject`,
  `confirmUnarchiveProject`, `openCreateProjectDialog`, `navigateTo`,
  `upsertProject`, `removeProject`, `announceRunStatus`, `toast(msg, kind,
  {duration, action: {label, onClick}})`. Shell also owns sidebar role gating, the
  `#shell-content` scroll container (the docs scroll-spy uses it as the observer
  root), in-app page swapping (`navigateTo`/`swapPage`, `shell.js:1878-2060`) which
  adopts page `<link>` stylesheets such as `docs.css` and re-runs page scripts, and
  the `qym:before-navigate` / `qym:popstate` events the two pages listen to.
- `ui_components.js` (`window.QymUIComponents`): `renderPagination(host, {page,
  pageCount, pageSize, total, start, end, noun, onPageChange})` (`ui_components.js:
  71-140`), `openDialog(node, {initialFocus})` / `releaseDialog(node)` (focus trap,
  `:1059-1125`), skeleton markers `data-qym-arrive` / `data-qym-skeleton` expanded
  by the shell.
- `auth.js` (`window.QymAuth`): `handle401`, `rootPath`, `logout`. `maybePromptBootstrapAdmin`
  is a no-op (`auth.js:118-121`).
- `qym_safe.js`: `QymSafe.escapeHtml` for every interpolated string.
- `docs-hljs.min.js`: global `hljs` (docs only).
- CSS: `dashboard.css` tokens, `shell.css`, `ui_components.css` (`.qym-tabs`,
  `.qym-stat-strip`, `.qym-badge`, `.qym-tag--role`, `.qym-icon-action`,
  `.qym-inline-action--danger`, `.qym-pagination`, `.qym-control.qym-search`,
  `.modal*`, `.btn*`).
- `dashboard.js` is **not** loaded by either page. It only references admin for
  role checks and for the `header-admin-link` toggle (`dashboard.js:8795-8803`) on the
  runs page.
- Nothing defined in admin.html/docs.js is imported elsewhere. The archive/unarchive
  dialogs are shared with `project_settings.html` but are defined in `shell.js`.

## 6. Design-token usage

- Admin uses tokens throughout its inline style (`admin.html:14-142`):
  `--font-title/stat/md/base/sm/xs`, `--space-*`, `--bg-surface/elevated/hover/
  active/base`, `--border-default/subtle`, `--text-primary/secondary/muted`,
  `--accent-primary/secondary`, `--success/--warning/--error`, `--font-mono/sans`.
  Hard-coded colour-alpha values that should become tokens or component styles:
  `rgba(0,212,170,0.12)` (admin role badge), `rgba(0,168,255,0.12/0.35)` (live dot,
  RUNNING pill), `rgba(16,185,129,0.35)`, `rgba(239,68,68,0.35)` (status pills), and
  the inline SVG chevron for `.form-select` with a hard-coded `#9898a8` fill.
- Admin-local classes that should be components: `.stat-card` (already doubled
  with `.qym-stat-strip__item`), `.admin-tab-btn` (doubled with `.qym-tabs__tab`),
  `.card/.card-header/.card-title/.card-subtitle`, `.data-table`, `.add-bar`,
  `.role-badge`, `.status-pill.status-*`, `.live-status(-dot)`, `.row-actions`,
  `.edit-user-*` form group recipe, `.maint-*`, `.self-warning`. Many buttons carry
  inline `style="padding:4px 10px;font-size:var(--font-sm)"` — that is a "small
  button" variant that should exist once.
- Docs is the **sanctioned exception** (`docs/DESIGN_LANGUAGE.md:413-417`,
  "Sanctioned exceptions"): prose pages keep an independent heading/body scale
  (h1 28 / h2 20 / lead 16 / body 15 / h3 16 / small 13 / labels 11-12 px) and a
  brighter body colour `--docs-body: #d3d3df` (`docs.css:102`) because
  `--text-secondary` is too dim for long-form reading. They still use the shared
  colour ramp for labels (`--docs-label: var(--text-muted)`, `docs.css:14`) and
  tokenised syntax colours `--code-comment/keyword/string/number/builtin/class`
  (`docs.css:16-21`, defined on `.docs-page`, mapped to `hljs-*` classes at
  `docs.css:169-177`). `tests/platform/test_design_language.py:66` freezes the exact
  list of pixel font sizes allowed in `docs.css`; `:363-367` requires the docs search
  input to use `class="qym-control qym-search"`. Any React port must either keep a
  `docs.css`-equivalent that the test can inspect or update the test allow-list
  deliberately.
- Docs inline code uses the `.kbd` chip recipe (`--bg-elevated` + `--border-default`),
  callouts use left-border semantics (`tip` accent, `warn` warning, `danger` error).

## 7. UX pain points observed

- Admin tab state lives in `sessionStorage`, not the URL: no deep link to
  `/admin#users`, back button does nothing between tabs, and a fresh tab starts on
  Runs.
- Every mutation calls `load()` which refetches `me`, users, projects, providers,
  live and recent runs (`admin.html:415-437`); the tables flash and the recent-runs
  page resets to the current page but the stat strip re-renders with skeletons gone.
- Create User: no email validation, no feedback for a duplicate (`existing: true`
  is ignored), no Enter-to-submit, errors throw to the console with no message
  (the click handler has no try/catch, `:990-1003`).
- Messages (`#run-message`, `#project-message`, `#user-message`) are inline text that
  never clears; `#project-message` and `#user-message` lack `role=status` (only
  `#run-message` has it), so screen readers miss "User updated".
- Status pills, role badges and Active/Archived text use colour alone to convey
  state (plus text, so acceptable), but the live-status dot is purely decorative
  and the "Disabled" text is `--error`, which reads like a failure.
- Edit modal: no `aria-describedby` linking the error line; the modal container is a
  `display:flex` toggle rather than `<dialog>`; Escape handling is page-level and
  checks for `#shell-confirm-dialog` by id (coupling).
- Maintenance Params is a one-line text input for JSON; the Log viewer is an
  unbounded `<pre>` under the table; the header line is a single long sentence
  that is hard to scan; byte formatting and `toLocaleString` are ad hoc.
- Force stop confirmation text mentions "Coder" (deployment-specific wording in
  `admin.html:399`).
- Docs: title-only search (users expect full-text); the `/` shortcut is
  undiscoverable; nav active state scrolls out of view in the sticky rail on long
  sections; TOC hidden under 1100 px with no substitute; headings get a trailing
  "#" anchor appended to the heading text (read aloud by screen readers as "#");
  `innerHTML` injection of partials means in-content `<a>` with external hrefs open
  in the same tab; no "last updated"; no feedback while a partial is loading except
  `aria-busy`.
- Docs content is 573 KB of HTML that is hand-maintained in parallel with two
  markdown user guides, with consistency enforced only by phrase-assert tests.

## 8. Migration notes

### Component tree and routes
- Routes: `/admin` (redirect to `/admin/runs`), `/admin/runs`, `/admin/projects`,
  `/admin/users`, `/admin/maintenance`; `/docs` (redirect to first page),
  `/docs/:section/:page` with `#heading`. Keep a redirect from `/docs-guide#a/b/c`
  to `/docs/a/b#c` and from `/admin` with `sessionStorage` tab (one-time) if desired.
- `AdminLayout` (route guard: `useMe()` -> role check -> `<Forbidden/>`)
  - `AdminStatStrip`
  - `AdminTabs` (NavLink-based, `role=tablist`)
  - `AdminRunsPage`
    - `LiveRunsTable` -> `RunStatusPill`, `ProgressCell`, `ForceStopButton`
    - `RecentRunsTable` -> shared `DataTable`, `Pagination`
  - `AdminProjectsPage`
    - `ProjectsTable` -> `ProjectStatusCell`, `ArchiveProjectDialog`,
      `UnarchiveProjectDialog` (shared with Project Settings; these fetch their
      previews)
    - `CreateProjectDialog` (shared with shell)
  - `AdminUsersPage`
    - `CreateUserForm`
    - `UsersTable` -> `RoleBadge`, `UserStatusCell`, `DisableUserButton` (confirm +
      undo toast)
    - `EditUserDialog` -> `ResetPasswordSection` -> `OneTimeSecret` (readonly +
      copy; reuse for API key / dataset token reveal in Project Settings)
  - `AdminMaintenancePage`
    - `MaintenanceSummary`, `TableSizesTable`, `EventTypesTable`
    - `EnqueueJobForm` (kind select, JSON editor, typed-confirm field)
    - `JobsTable` -> `JobLogDrawer`
- `DocsLayout` (three-column grid, sticky rails)
  - `DocsNav` (sections -> pages, `DocsSearch` with `/` hotkey)
  - `DocsArticle` (renders content; `CodeBlock` with header/copy/highlight,
    `Callout`, `DocsTable` scroll wrapper, `HeadingAnchor`)
  - `DocsToc` (scroll-spy using the app scroll container as root)
  - `DocsPager`

### State placement
- URL: admin tab (path), recent-runs page (`?page=`), docs section/page/heading.
- Server cache (TanStack Query keys): `['me']`, `['admin','users']`,
  `['projects']` (shared with the shell switcher), `['auth','providers']`,
  `['admin','runs','live']` (`refetchInterval: 10_000`, `enabled` only while the Runs
  tab is mounted), `['admin','runs','recent', page]` (keepPreviousData),
  `['admin','maintenance']` (`refetchInterval: 3000` when any job active, else
  off), `['admin','project', id, 'archive-preview' | 'unarchive-preview']`,
  `['docs', section, page]` (`staleTime: Infinity`).
- Mutations: `forceStop` (on success: `setQueryData` to drop from live, invalidate
  both run lists, broadcast via the shared run-status channel), `updateUser`,
  `createUser`, `resetPassword` (never cache the response), `archive/unarchive`
  (invalidate `['projects']` and `['me']`), `enqueueJob/startJob/cancelJob`.
- Local: edit-dialog form state and busy lock; one-time password (cleared on
  close); JSON params text; docs search query.

### Backend changes likely needed
- SPA fallback for `/admin/*` and `/docs/*` (today `GET /admin` and `/docs-guide`
  are explicit routes returning static HTML, `api/runs.py:2255, 2277`); keep the
  login-redirect behaviour of `_maybe_redirect_to_login`.
- Vite dev: proxy `/v1`, `/api`, `/static/docs`, `/login` to the FastAPI server
  (cookies are same-site, so proxying avoids CORS entirely).
- Consider a `GET /api/docs/index` or shipping the docs IA as JSON so
  `test_platform_docs.py` can read it from one place; otherwise point the test at
  the new TS/JSON source.
- Optional: `GET /v1/admin/users` could accept `?q=` and pagination before user
  counts grow; `POST /v1/admin/users` could return 409 on duplicates instead of
  `existing: true`.
- `run_events` / `db_stats` are Postgres-only; the UI should treat `db_stats.error`
  as a first-class state.

### Markdown renderer + highlighter recommendation
The docs content is already HTML, so the first decision is whether to keep HTML
or convert to Markdown/MDX. Recommendation: convert the 27 partials to **MDX**
(one file per page, frontmatter `title`, `section`, `order`), bundled at build time
with `@mdx-js/rollup` in Vite so the IA, prev/next and search index are generated
from the files and `test_platform_docs.py` can read frontmatter instead of
parsing JS. Custom components map 1:1 to today's markup: `Callout`, `Cards/Card`,
`CodeBlock`. If content must stay fetched at runtime instead, use
**`react-markdown` + `remark-gfm` + `rehype-slug` + `rehype-autolink-headings`**
(tables, heading ids and anchors for free) and keep `rehype-raw` off unless the
HTML callouts are not converted.

Highlighter: **Shiki** (`shiki` with `@shikijs/rehype`, or `rehype-pretty-code`
on top of it) at build time for MDX. It produces inline-styled or CSS-variable
themed tokens, needs no runtime 127 KB bundle, supports python/bash/json/yaml/
javascript (today's set) and can be themed with the existing `--code-*` tokens via
a custom `css-variables` theme, which satisfies the design-language rule that the
syntax palette stays tokenised. For runtime rendering fall back to
`react-syntax-highlighter` with the light `prism-async-light` build registering
only python, bash, json, yaml — avoid shipping all of highlight.js. Keep the
copy-button header as a wrapper component in either case.

### Risks / gotchas
- Live poll races: a 10 s poll started before a force stop may return the run as
  still live; today's sequence counters handle it. With TanStack Query, cancel
  in-flight queries (`queryClient.cancelQueries`) in the mutation's `onMutate`.
- The force-stop endpoint also returns `stopped: false` when the run was already
  stopped; show the message anyway.
- The reset-password response must never be cached, logged, or persisted;
  clear it on dialog close (tested).
- `PUT` for a self-edit must not send `role`/`is_active` (server 400/409s).
- Archive dialog needs the in-progress preview before showing the confirm label;
  handle 403 for non-admins (shared with Project Settings) and network failure
  ("could not be checked" warning).
- Docs partials rely on `document.getElementById('shell-content')` as the
  IntersectionObserver root; in React, pass the layout scroll container ref.
- `scrollbar-gutter: stable` on the scroll container prevents layout shift between
  short and long articles (`docs.css:10-11`); keep it.
- The design-language test freezes the pixel sizes in `docs.css` and the
  `docs-hljs.min.js` exemption (`test_design_language.py:22, 66`); CSS modules or
  Tailwind output will need the test updated or a dedicated `docs.css`.
- `recent` runs total is for non-live runs only; live and recent are disjoint sets.
- Maintenance `job_kinds` is a dict keyed by kind; sort keys client-side.

### Suggested Playwright scenarios
1. Member visits `/admin` -> sees forbidden state, sidebar has no Admin link.
2. Admin force-stops a live run: confirm dialog, one POST, row leaves Live, Recent
   row shows STOPPED, message announced, poll does not overlap.
3. Disable a user -> confirm -> toast with Undo -> Undo re-enables.
4. Edit self: role and active controls disabled; save sends no role.
5. Reset password: lock while pending, temp password shown, cleared on close.
6. Archive a project with an in-progress run: preview lists it; after confirm
   the sidebar switcher no longer lists the project.
7. Unarchive: "Revoke keys first" navigates to settings `?tab=apikeys`.
8. Queue an irreversible maintenance job without confirm -> error; with confirm ->
   row appears, polling runs every 3 s until finished.
9. Docs deep link `/docs/developer/endpoints#heading` lands on the heading, TOC
   highlights it, prev/next correct, copy button copies code.
10. Docs search: type, Enter opens first match, `/` focuses, Escape clears; a
    missing page shows the "not written yet" callout.

## 9. Open questions

1. Keep HTML partials fetched at runtime or convert to MDX bundled at build? (Affects
   `test_platform_docs.py` and the size of the main bundle: 573 KB of content should
   be code-split per page either way.)
2. Expose user delete in the UI (API exists, never surfaced) or leave it out?
3. Should Create User surface the `existing: true` case as an error or as "already
   exists, opened for editing"?
4. Recent-runs page size: keep 6 or adopt the shared table default with a size
   selector?
5. Should the Maintenance tab be hidden entirely when `db_stats.error` indicates a
   non-Postgres database, or shown with the jobs form only?
6. Move the stat strip's "Total Runs" to a server count (`/v1/projects` run counts
   exclude deleted runs and archived projects are included today)?
7. Keep the docs hash scheme `#section/page/heading` for backward compatibility
   (links in emails, READMEs) in addition to the new path scheme?
8. Should docs search become full-text (index generated at build) now, or stay
   title-only for parity?
9. Where does the GitLab/OIDC provider configuration surface, if at all? Today it is
   env-only; the admin page has no settings tab and `/v1/admin/settings` does not
   exist.
10. Force-stop confirmation copy mentions "Coder"; keep deployment-specific wording
    or make it configurable?
