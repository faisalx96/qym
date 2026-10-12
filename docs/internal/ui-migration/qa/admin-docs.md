# QA: Admin and in-app Docs (brief 09)

Compared the vanilla pages at `7814183` (legacy platform on :8827) with the React app on `ui/qa` (:8837), same seeded SQLite DB (3 projects incl. 1 archived, 3 live runs, 20 finished, 3 users) under `QYM_AUTH_MODE=none`; the admin gate, local-auth reset password and member 403s were checked on a fresh DB under `QYM_AUTH_MODE=proxy_headers` + `QYM_AUTH_LOCAL_ENABLED=true` with a real member and two admins signed in through the login form (the way `e2e/admin/proxy.spec.ts` does). Verification used ad-hoc Playwright scripts (screenshots outside the repo). Existing e2e specs were not re-run (they need their own stack). Paths are relative to `frontend/src/features/` unless a full path is given. "Code only" means read from source.

## Summary

Total rows: 133. OK 94, CHANGED 29, BUGGY 7, MISSING 3.

Highest-impact findings: (1) live runs progress shows `done/done` instead of `done/total` (4/4 instead of 4/9); (2) the maintenance workers-service liveness (alive / NOT RESPONDING, n/m processes) is gone, so a down workers service reads "unknown"; (3) Archive/Unarchive lose the "anyway" escalation label and the raw ISO start time appears in the archive preview; (4) small polish bugs (no tooltip on the self-disable button, `?page=` out of range, search popover race, phone overflow from the docs pager). Everything else in the brief ported faithfully; content parity of all 27 docs partials is exact.

Legend for the Spec column: `runs`=e2e/admin/runs.spec.ts, `projects`=e2e/admin/projects.spec.ts, `users`=e2e/admin/users.spec.ts, `maintenance`=e2e/admin/maintenance.spec.ts, `proxy`=e2e/admin/proxy.spec.ts, `docs.spec`=e2e/docs/docs.spec.ts. Status: OK / CHANGED (acceptable unless noted) / BUGGY / MISSING.

## Table


### A. Admin: gate, shell, stat strip, tabs

| # | Old behaviour | New code | Spec | Status | Verified / notes |
|---|---|---|---|---|---|
| 1 | Non-admin opening /admin gets an "Admin access required" card instead of the page | frontend/src/features/admin/AdminGuard.tsx:8-24; router.tsx:103-104 | proxy (member forbidden) | **OK** | Verified as a real MEMBER (session login): all four /admin/* URLs show the panel, no admin XHR fired, "Back to projects" goes to `/`. |
| 2 | Server enforces 403 "Admin only" on admin endpoints regardless of the UI | packages/platform api/web.py, admin.py, runs.py | - | **OK** | curl as member: `/v1/admin/users`, `/api/admin/maintenance`, `/api/runs/live?all_projects=true` all 403. |
| 3 | Admin + Deleted runs sidebar links only for ADMIN | features/shell (Platform group) | proxy | **OK** | Member sidebar has neither link. |
| 4 | Unauthenticated / expired session on /admin redirects to /login?next= | lib/http loginUrl | shell auth.spec | **OK** | Seen: header-only request under session auth lands on `/login?next=/admin/users`. |
| 5 | Stat strip: Total Users / Projects / Total Runs (sum of project.run_count, "—" when 0) | frontend/src/features/admin/AdminPage.tsx:39-53 | - | **CHANGED** | Now Users (+disabled count), Projects (+archived count), "Runs, all projects" (+ "incl. N in archived projects", help tip). Shows `0` instead of "—". Acceptable, better labelled (logged in OPEN_QUESTIONS). |
| 6 | Stat strip visible above the tabs on every tab | frontend/src/features/admin/AdminPage.tsx:39 | - | **CHANGED** | Shown on the Runs tab only (decision UX_DECISION). Users/Projects counts remain on the tab badges. Acceptable. |
| 7 | Four tabs Runs / Projects / Users / Maintenance with ARIA tablist | frontend/src/features/admin/AdminPage.tsx:54-70 | runs | **OK** | Roving ArrowLeft/Right activates and navigates. |
| 8 | Tab remembered in sessionStorage `qym:admin-tab` (no URL state) | frontend/src/features/admin/AdminPage.tsx:14-18 (`useParams`) | runs | **CHANGED** | Tab is now the path (`/admin/:tab`), `/admin` and unknown tab go to `/admin/runs`. Back button works. A bare `/admin` visit never restores the last tab (old did via sessionStorage). Acceptable, decided. |
| 9 | Tab counts / active-job badge | AdminPage.tsx:65-76 | - | **CHANGED** | New: counts on Projects/Users, active job count on Maintenance (seen "2" in mocked data). Extra. |
| 10 | Page title | AdminPage.tsx:19 | - | **OK** | "Admin · قيِّم". |
| 11 | Polling and requests stop on navigate away / pagehide | api/admin.ts:192-201 | - | **OK** | React Query unmount; `refetchIntervalInBackground:false`; interval paused when tab hidden. |

### B. Admin > Runs tab

| # | Old behaviour | New code | Spec | Status | Verified / notes |
|---|---|---|---|---|---|
| 12 | Live runs table: project, run (+task), owner, status with pulsing dot, progress, updated, Force stop | frontend/src/features/admin/runs/RunTables.tsx; RunsTab.tsx | runs | **OK** | Same data, same columns. Project name falls back to slug/id; owner falls back display_name -> email local part -> id (format.ts:41-53). |
| 13 | Live progress shows completed/progress_total (e.g. 4/9) | frontend/src/features/admin/format.ts:55-60 | - | **BUGGY** | Live API row has progress_completed 4, progress_total 9, total_items 4 (items seen so far). Old shows `4/9`, new shows `4/4` for every live run (6/12 -> 6/6). The live column is useless as a progress indicator. Fix below (B1). |
| 14 | Recent runs "Items" column = completed/total_items, "—" when unknown | frontend/src/features/admin/format.ts:55-60 | runs | **OK** | Matches old for recent rows. |
| 15 | Live subtitle "N running across all qym projects" (count from server total) | frontend/src/features/admin/RunsTab.tsx:23-30 | - | **CHANGED** | "N running across all projects". When the request fails the subtitle still says "0 running" under the error state (minor). |
| 16 | Live runs table "No live runs" empty state, "Failed to load live runs" error | RunsTab.tsx:33-42 | - | **OK** | Verified empty state and the 500 state (after the 2 react-query retries, ~3 s) with a Retry button; retry works. Old showed the error at once, no retry. |
| 17 | Live runs poll every 10 s, no overlap, only after first load | frontend/src/api/admin.ts:125,192-201 | - | **OK** | Measured 2 requests in 21 s. Pauses in background tabs. Badge "polling every 10 s" added. |
| 18 | Live list capped at limit=100, all_projects | api/admin.ts:196 | - | **OK** |  |
| 19 | Run name falls back external_run_id -> first 8 chars of run_id | frontend/src/features/admin/format.ts:41-43 | runs | **OK** | Seen "11111111" in a mocked row. |
| 20 | Run link goes to /projects/{slug}/runs/{id} (fallback /run/{id}) | frontend/src/features/admin/runs/RunTables.tsx:9-11 | runs | **OK** | Router Link, no full reload. |
| 21 | Relative time "just now / Nm / Nh / Nd ago" (floor) | frontend/src/features/admin/format.ts:4-17 | - | **CHANGED** | Rounds instead of floors (old 6d ago -> new 7d ago for 6.6 days; 1d -> 33h), switches to hours up to 48 h and to a date after 30 d. Harmless. |
| 22 | Recent runs: "Most recent eval runs", 6 per page, server offset paging, "N total" | frontend/src/features/admin/runs/RunsTab.tsx:10-13,49-70 | runs | **OK** | `1-6 of 20 runs`; page size 6 kept. |
| 23 | Recent paging state | frontend/src/features/admin/runs/RunsTab.tsx:13,69 | - | **CHANGED** | Now `?page=N` in the URL (survives reload, Back works). Acceptable. |
| 24 | Out-of-range page | frontend/src/features/admin/runs/RunsTab.tsx:13 | - | **BUGGY** | `/admin/runs?page=99` shows "No recent eval runs" with a pager reading "19-20 of 20 runs". Not reachable in the old page (no URL state). Fix B2. |
| 25 | Recent table subtitle | frontend/src/features/admin/runs/RunsTab.tsx:49 | - | **CHANGED** | "N total finished runs" (old "N total eval runs"). Total is the server `total_count` of non-live runs. |
| 26 | Force stop button only when can_force_stop and not stopped locally | frontend/src/features/admin/runs/RunTables.tsx:36-50 | runs | **CHANGED** | Also hidden for terminal statuses (STOPPED/COMPLETED/FAILED) even if the server says can_force_stop. Acceptable. |
| 27 | Force stop opens danger confirm "Force stop run" with run name and two paragraphs | frontend/src/features/admin/runs/ForceStopDialog.tsx:16-40 | runs | **CHANGED** | Copy drops "Coder" ("may keep running where it was launched"). Escape/Cancel send no request (verified). Acceptable (decided). |
| 28 | Exactly one POST /api/runs/{id}/force-stop; run leaves Live; Recent row merged as STOPPED; both lists refetched | frontend/src/api/admin.ts:221-247 | runs | **OK** | Verified: STOPPED row at top of Recent (6m ago), live count 3 -> 2. |
| 29 | Stale list responses discarded after a stop (sequence counters) | api/admin.ts:225-228 | - | **OK** | cancelQueries in onMutate. |
| 30 | Cross-tab run-status broadcast (announceRunStatus) | api/admin.ts:242 | - | **OK** | Code only (BroadcastChannel path shared with the other pages); not exercised with a second tab. |
| 31 | Status line `role=status` announces "... was force stopped. Further updates are blocked." | frontend/src/features/admin/AdminPage.tsx:36-38; RunsTab.tsx:70-86 | runs | **CHANGED** | Sr-only status line (8 s) plus a success toast; old line was visible and never cleared. |
| 32 | Force stop in flight: button shows "Stopping..." and is disabled | frontend/src/features/admin/runs/ForceStopDialog.tsx; RunTables.tsx | - | **CHANGED** | Pending state now lives in the dialog (buttons locked, confirm shows spinner). The row button never shows "Stopping" (stoppingIds is never passed). |
| 33 | Force stop failure (409): red text, button re-enabled | frontend/src/features/admin/runs/ForceStopDialog.tsx:30-39 | - | **OK** | Mocked a 409: dialog stays open with the server detail inline, status line + error toast, can retry/cancel. |
| 34 | Force stop on a run that is already stopped by someone else | frontend/src/features/admin/runs/ForceStopDialog.tsx:32-33 | - | **BUGGY** | Server answers ok with `stopped:false`; UI still says "was force stopped" (result.stopped ignored). Same wording as old, so a pre-existing gap. Minor, B8. |

### C. Admin > Projects tab

| # | Old behaviour | New code | Spec | Status | Verified / notes |
|---|---|---|---|---|---|
| 35 | Table of all projects including archived: name, slug, Active/Archived, members, actions | frontend/src/features/admin/projects/ProjectsTable.tsx | projects | **CHANGED** | Adds Runs column and Identicon; status is a badge (Archived = warning tone). |
| 36 | "+ New Project" opens the shell create dialog; after create navigates to the project and updates the switcher | frontend/src/features/admin/projects/ProjectsTab.tsx:18-29 | projects | **OK** | Dialog auto-slugs ("QA Fresh Project" -> qa-fresh-project), POST /v1/projects, lands on /projects/qa-fresh-project, new row on Projects tab. Same as old (navigate). |
| 37 | Active project: Settings link + Archive button | frontend/src/features/admin/projects/ProjectsTable.tsx:54-60 | projects | **OK** |  |
| 38 | Archive preview lists up to 5 in-progress runs with "and N more" | features/shell/dialogs/ArchiveProjectDialogs.tsx:41-55 | projects | **OK** | Verified "1 run is still running ... They will be stopped." |
| 39 | Archive preview run rows show "started <localised date>" | ArchiveProjectDialogs.tsx:47 | projects | **BUGGY** | Meta is the raw ISO string `2026-10-12T15:22:51.641256Z`. Fix B3. |
| 40 | Archive confirm turns into "Archive anyway" (danger) when runs are in progress | ArchiveProjectDialogs.tsx:67 | projects | **MISSING** | Button always reads "Archive project" (tone danger always). Old escalated the label so the loss of running results is explicit. Also copy is shorter (old described read-only rules and Trash purge pause; API-key line kept). Fix B4. |
| 41 | Confirm archive: POST archive, sidebar switcher drops the project, row becomes Archived, "Archived name" message | frontend/src/features/admin/projects/ProjectsTable.tsx:76-98 | projects | **OK** | Row flips to ARCHIVED in place (stays on /admin/projects); toast "<name> archived". |
| 42 | Archived project: Open (read-only), Settings, Unarchive | frontend/src/features/admin/projects/ProjectsTable.tsx:32,54-66 | projects | **CHANGED** | No "Open" button; the project name is a link to the project (opens read-only). Settings + Unarchive kept. Acceptable. |
| 43 | Unarchive preview lists API keys that start working again with creator; "Revoke keys first" | ArchiveProjectDialogs.tsx:98-142 | projects | **OK** | Verified key `seed-e6c329` + "Dev User"; list capped at 5 + "more" (old used the server list). "Revoke keys first" goes to /projects/old-proj/settings?tab=apikeys. |
| 44 | Unarchive confirm label "Unarchive anyway" (danger) when keys would start working | ArchiveProjectDialogs.tsx:127 | projects | **MISSING** | Label stays "Unarchive", tone accent. Same cause as the Archive row. Fix B4. Copy also lost "Deleted runs in Trash resume their purge countdown". |
| 45 | Unarchive confirm: POST, project reappears active in switcher | frontend/src/features/admin/projects/ProjectsTable.tsx:88-98 | projects | **OK** | Verified Active row, toast "Demo project is active again", /projects lists it. |
| 46 | Preview fetch failure falls back to a "could not check" warning | ArchiveProjectDialogs.tsx:50-55,120-125 | - | **OK** | Code only. |
| 47 | 403 on archive-preview toasts "Only an admin can archive" | ArchiveProjectDialogs.tsx:39 | - | **CHANGED** | Generic text "Could not check..." with the server detail; admins only reach this tab anyway. |
| 48 | Projects empty state / loading skeleton / error with retry | frontend/src/features/admin/projects/ProjectsTab.tsx:23-29 | - | **OK** | Code + other tabs seen; not forced on this tab. |
| 49 | Project deletion is not on this tab (Danger Zone in settings) | - | - | **OK** | Unchanged. |

### D. Admin > Users tab

| # | Old behaviour | New code | Spec | Status | Verified / notes |
|---|---|---|---|---|---|
| 50 | Add-bar: email, display name, role select, Create User | frontend/src/features/admin/users/CreateUserForm.tsx | users | **CHANGED** | Labelled fields, Enter submits, button disabled while email empty, email lower-cased by server and toast shows it. |
| 51 | Create validation (old: none) | frontend/src/features/admin/users/CreateUserForm.tsx:23-25 | users | **OK** | Native `type=email` message appears first ("Please include an @..."), custom "Enter a valid email address." only for odd cases. Better than old. |
| 52 | Create success: "User created", fields cleared, table reloaded | frontend/src/features/admin/users/CreateUserForm.tsx:28-37 | users | **OK** | Toast "User x created"; fields and role reset. |
| 53 | Create duplicate email (server returns existing:true) | frontend/src/features/admin/users/CreateUserForm.tsx:29-31; UsersTable.tsx:22-26 | users | **OK** | Info toast "<email> already exists", row scrolled/highlighted, field kept. Old silently said "User created". |
| 54 | Users table: user, email, role tag, Active/Disabled, Edit, Disable/Enable | frontend/src/features/admin/users/UsersTable.tsx | users | **OK** | Adds a "you" tag on your own row. Disabled shown as neutral badge (old red text). |
| 55 | Disable asks first (danger dialog with sign-out and API-key text) | frontend/src/features/admin/users/UsersTable.tsx:131-148 | users | **OK** | Copy identical to old. |
| 56 | Disable success: inline "User disabled" + 10 s toast with Undo that re-enables | frontend/src/features/admin/users/UsersTable.tsx:34-47 | users | **OK** | Undo present at 9 s, gone at 12.5 s; Undo re-enables with "Enabled X again. They need to sign in again." |
| 57 | Enable has no confirmation | frontend/src/features/admin/users/UsersTable.tsx:34-40 | users | **OK** | Toast "Enabled X". |
| 58 | Own row: Disable permanently disabled with tooltip "You cannot disable your own account" | frontend/src/features/admin/users/UsersTable.tsx:101-108 | users | **BUGGY** | Button is disabled and aria-labelled correctly, but hovering it shows no tooltip (React Aria tooltip never opens on a disabled button; old used a native `title`). Mouse users get no explanation. Fix B5. |
| 59 | Edit modal: email, display name, role, Active, password section, self note | frontend/src/features/admin/users/EditUserDialog.tsx | users | **OK** | Title now "Edit <name>"; Escape, Cancel, close and backdrop all close it (verified). |
| 60 | Editing yourself locks role + active and omits them from the PUT | frontend/src/features/admin/users/EditUserDialog.tsx:54-64 | users | **OK** | Verified role select + checkbox disabled; PUT body `{email,display_name}`. |
| 61 | Save requires email; PUT; success closes + "User updated" | frontend/src/features/admin/users/EditUserDialog.tsx:54-72 | users | **OK** | Empty email -> "Email is required."; success toast. |
| 62 | Server errors (400 Email already in use, 409 admin rules) inline in the dialog | frontend/src/features/admin/users/EditUserDialog.tsx:64-72,180-185 | users | **OK** | Verified "Email already in use" inline (red text, role=alert). |
| 63 | While saving: fields, Save, Cancel, close locked; dialog cannot close; label "Saving..." | frontend/src/features/admin/users/EditUserDialog.tsx:46,90 | users | **OK** | Delayed the PUT 1.5 s: inputs disabled, Escape and backdrop click ignored, closes after. |
| 64 | Reset password section only when local auth enabled and not self | frontend/src/features/admin/users/EditUserDialog.tsx:136 | proxy | **OK** | Hidden under QYM_AUTH_MODE=none; present for another user and absent on own row under session auth (verified). |
| 65 | Reset password: confirm dialog ("signed out of every browser"), Cancel does not reset | frontend/src/features/admin/users/EditUserDialog.tsx:188-207 | proxy | **OK** | Escape on the confirm closes only the confirm. |
| 66 | One-time password in a readonly field with copy button; "not shown again" | frontend/src/features/admin/users/EditUserDialog.tsx:141-161 | proxy | **OK** | 16-char password, copy puts exactly it on the clipboard, toast. Cleared on close/reopen (no `[data-secret]`). |
| 67 | Reset button stays so another reset is possible without reopening | frontend/src/features/admin/users/EditUserDialog.tsx:141-176 | - | **CHANGED** | Button is replaced by the secret; a second reset needs closing and reopening. Minor. |
| 68 | Reset locks the dialog while pending | frontend/src/features/admin/users/EditUserDialog.tsx:46,167-174 | proxy | **OK** | Code + spec (not re-run live). |
| 69 | Delete user (API only, never had UI) | - | - | **OK** | Decision: stays out of the UI. |
| 70 | Arabic / RTL display name | frontend/src/features/admin/users/UsersTable.tsx | - | **OK** | "مشاري الدوسري" renders in the row; no `dir=auto` but no visible issue. |
| 71 | Users empty/loading/error | frontend/src/features/admin/users/UsersTab.tsx:21-31 | - | **OK** | Error with retry (users query 500). |

### E. Admin > Maintenance tab

| # | Old behaviour | New code | Spec | Status | Verified / notes |
|---|---|---|---|---|---|
| 72 | Lazy load on first open; summary of DB size, role, maintenance mode, event log, retention, grace | frontend/src/features/admin/maintenance/MaintenanceSummary.tsx; api/admin.ts:251 | maintenance | **CHANGED** | One sentence became a key/value grid (+ partitions-ahead, + Role/service). Statistics line says "refreshed N s ago". |
| 73 | Workers line: separate-process layout shows workers service alive / NOT RESPONDING and n/m processes | frontend/src/features/admin/maintenance/MaintenanceSummary.tsx:14-30; api/admin.ts:96-101 | - | **MISSING** | `workers.workers_service` ({alive, processes[]}) is not typed or rendered. With loops="separate" and no heartbeat the old UI says "workers service NOT RESPONDING (0/2 processes)", the new one only "summary: unknown / maintenance: unknown" (mocked). Fix B6. |
| 74 | Refresh button forces ?refresh=1 | frontend/src/features/admin/maintenance/MaintenanceTab.tsx:44-52 | maintenance | **OK** | Verified GET `?refresh=1`; spinner while loading; error toast on failure. |
| 75 | Top-12 table sizes table (total/heap/TOAST/index, live/dead rows) and run_events by type | frontend/src/features/admin/maintenance/MaintenanceTab.tsx:14-27,62-66 | - | **CHANGED** | Rendering checked with a mocked Postgres payload (1.0 GB / 477 MB / 1,234,567). No client `.slice(0,12)`: relies on the server cap (api/admin.py). PostgreSQL itself not available here. |
| 76 | db_stats.error shown in the table body | frontend/src/features/admin/maintenance/MaintenanceTab.tsx:58-61 | maintenance | **OK** | First-class "Table statistics are unavailable (they need PostgreSQL)" + the error text on SQLite. |
| 77 | Job kind select sorted, "(irreversible)" suffix, description below | frontend/src/features/admin/maintenance/EnqueueJobForm.tsx:18-25,112-118 | maintenance | **OK** | Searchable select; irreversible shown as a description + red badge; help text matches. |
| 78 | Params JSON text input, validated client side ("Params must be valid JSON") | frontend/src/features/admin/maintenance/EnqueueJobForm.tsx:33-40 | maintenance | **CHANGED** | Textarea; only objects accepted (arrays rejected "Params must be a JSON object"), submit disabled while invalid. Stricter than old; fine. |
| 79 | Typed confirm field only for irreversible kinds (must equal kind) | frontend/src/features/admin/maintenance/EnqueueJobForm.tsx:41-42,76-95 | maintenance | **OK** | Verified: field appears for drop_legacy_spans, submit disabled until typed, vanishes after switching kind. |
| 80 | Queue job -> POST /api/admin/maintenance/jobs; confirm cleared; list reloaded | frontend/src/features/admin/maintenance/EnqueueJobForm.tsx:44-61 | maintenance | **OK** | Body `{kind, params}` (+confirm). Toast "Queued vacuum_analyze". Submit label for irreversible is "Queue irreversible job" (danger). |
| 81 | Server error text shown under the form | frontend/src/features/admin/maintenance/EnqueueJobForm.tsx:119-123 | maintenance | **OK** | Code + spec (direct API 400). |
| 82 | Jobs table: kind, status colour, progress message, created, finished | frontend/src/features/admin/maintenance/JobsTable.tsx | maintenance | **CHANGED** | Status as badges; Progress column prefers `error` text over the message; timestamps localised (old showed raw UTC `YYYY-MM-DD HH:MM:SS`). Acceptable. |
| 83 | Actions: Log always, Start (paused only), Cancel (queued/running/paused) | frontend/src/features/admin/maintenance/JobsTable.tsx:64-82 | maintenance | **OK** | Verified with mocked jobs: paused -> Log/Start/Cancel, running -> Log/Cancel, cancel_requested -> Cancel disabled, finished -> Log only; Start POSTs `/jobs/j1/start`. |
| 84 | Log shown in a `<pre>` under the table | frontend/src/features/admin/maintenance/JobsTable.tsx:93-130 | maintenance | **CHANGED** | Drawer with id/created/started/finished/params/progress, error and log; live-updates while polling. Better. |
| 85 | Re-poll every 3 s while any job is queued/running/cancel_requested and the tab is visible | frontend/src/api/admin.ts:251-262 | maintenance | **OK** | Spec measures ~3 s; hint "Refreshing every 3 s while jobs are active". |
| 86 | Start/Cancel failures | frontend/src/features/admin/maintenance/JobsTable.tsx:38-45 | - | **CHANGED** | Error toast (old: unhandled rejection, silent). |
| 87 | Maintenance load error | frontend/src/features/admin/maintenance/MaintenanceTab.tsx:30-31 | - | **OK** | "Couldn't load maintenance data" + HTTP detail + Retry. |

### F. Docs: structure, routing, nav

| # | Old behaviour | New code | Spec | Status | Verified / notes |
|---|---|---|---|---|---|
| 88 | 27 content pages in 4 sections (IA as data) | frontend/src/features/docs/ia.json; content.ts:45-52 | docs.spec; test_platform_docs.py | **OK** | All 31 ids and titles (27 pages + 4 sections) identical to the old SECTIONS array. |
| 89 | Every one of the 27 partials renders (h1, headings, tables, code, callouts) | frontend/src/features/docs/partials/**; plugins/docs-content.ts | docs.spec (all pages) | **OK** | Automated old-vs-new comparison for all 27: identical h1/h2/h3/pre/table/callout/card counts and identical normalised text (only difference: api-keys.html `<slug>` content fix). No console errors on either side. |
| 90 | Partial content source files | frontend/src/features/docs/partials | - | **OK** | `diff -r` against 7814183: only get-started/api-keys.html line 113 differs (escaped `<slug>`/`<run_id>`). |
| 91 | Routing by hash `#section/page[/heading]` | frontend/src/features/docs/DocsRedirect.tsx; content.ts:63-70 | docs.spec | **CHANGED** | Real paths `/docs/:section/:page#heading`. |
| 92 | /docs-guide with no hash opens the first page | frontend/src/features/docs/DocsRedirect.tsx:6-8 | docs.spec | **OK** | `/docs-guide`, `/docs`, `/docs/` -> `/docs/get-started/what-is-qym` (replace). |
| 93 | Legacy `/docs-guide#section/page[/heading]` and `#/section/page` links keep working | frontend/src/features/docs/content.ts:63-70 | docs.spec | **OK** | Verified three forms incl. 3-segment heading -> `/docs/developer/endpoints#conventions`. |
| 94 | Unknown section/page falls back to first page | frontend/src/features/docs/useDocsPage.ts:26-30 | docs.spec | **OK** | `/docs/bogus/zzz`, `/docs/developer`, `#bogus/page` all -> first page. |
| 95 | Unknown heading hash is ignored without error | frontend/src/features/docs/useDocsPage.ts:51-58 | - | **OK** | `/docs/get-started/what-is-qym#nope` stays, page at top. |
| 96 | Deep link to heading scrolls there and highlights its TOC entry | frontend/src/features/docs/useDocsPage.ts:51-58; useScrollSpy.ts | docs.spec | **OK** | `#conventions` -> scrollTop 389, TOC "Conventions" current (old landed at 434). |
| 97 | Left nav: 4 sections with icons, 27 links, active link highlighted | frontend/src/features/docs/DocsPage.tsx:66-95 | docs.spec | **OK** | `aria-current=page` on the active link. |
| 98 | Active nav item scrolled into view (old pain point: rail taller than viewport) | frontend/src/features/docs/DocsPage.tsx:64-66 | - | **OK** | Seen at 1440x900 on the last section. |
| 99 | Document title "قيِّم • <page>" | frontend/src/features/docs/useDocsPage.ts:46 | - | **CHANGED** | "Endpoint reference · Docs · قيِّم". |
| 100 | Sidebar Docs link in the shell | features/shell | shell nav | **OK** | Present for member and admin. |
| 101 | Docs available to non-admins | router.tsx:113-116 | - | **OK** | Member opens a docs page. |
| 102 | Prev/Next pager, first page has only Next, last page only Previous | frontend/src/features/docs/DocsPage.tsx:118-137 | docs.spec | **OK** | Verified both ends; scroll resets to 0 and focus moves to the article on navigation. |
| 103 | Browser Back/Forward between docs pages | frontend/src/features/docs/useDocsPage.ts | - | **OK** | Verified back -> what-is-qym, forward -> install. |
| 104 | Cross-page links inside partials swap the article without a full load | frontend/src/features/docs/DocsArticle.tsx:39-57 | docs.spec | **OK** | All 6 internal hrefs on a page are router links; every internal `#...` href in all 27 partials resolves to an existing page. |
| 105 | External links | frontend/src/features/docs/DocsArticle.tsx:55-61 | - | **CHANGED** | Open in a new tab with an external glyph (old: same tab). |

### G. Docs: article, TOC, code, tables

| # | Old behaviour | New code | Spec | Status | Verified / notes |
|---|---|---|---|---|---|
| 106 | Right TOC from h2/h3 with indent for h3 | frontend/src/features/docs/DocsPage.tsx:14-42 | docs.spec | **OK** | 15 entries on endpoints; hidden under 1100 px and replaced by an "On this page" disclosure. |
| 107 | Scroll-spy highlights the active entry | frontend/src/features/docs/useScrollSpy.ts | docs.spec | **OK** | Verified on sdk-guide/metrics at 6 scroll positions; last heading wins at the bottom. |
| 108 | TOC click smooth-scrolls and replaces the hash | frontend/src/features/docs/DocsPage.tsx:28-34 | docs.spec | **OK** | URL `/docs/developer/endpoints#items`, entry current. |
| 109 | Hover "#" anchors on every h2/h3 that copy-link the heading | frontend/src/features/docs/DocsArticle.tsx:73-93 | - | **OK** | href `/docs/sdk-guide/metrics#the-metric-contract`, aria-label "Link to ...", click updates the URL. |
| 110 | Heading ids use the old slug algorithm so old links resolve | frontend/plugins/docs-content.ts:slugify | docs.spec | **OK** | Verified through legacy deep link. |
| 111 | Code block header with language label + copy button; toast "Copied to clipboard" | frontend/src/features/docs/DocsArticle.tsx:17-37 | docs.spec | **OK** | Clipboard holds the exact source text; label shows data-lang or file name ("first_eval.py"). |
| 112 | Syntax highlighting python / bash / json (+ file-name labels) | frontend/plugins/docs-content.ts:87-128,209-212 | - | **OK** | Shiki at build time with token classes. Counts: 108/108 python, 49/49 bash (old 29/49 had spans), 19/19 json, `first_eval.py` highlighted; plain for text/csv/pipeline. Screenshot side by side matches old colours. |
| 113 | Single-line plain `<pre>` wraps instead of scrolling | plugins/docs-content.ts (data-wrap) | - | **OK** | 15 of 30 text blocks carry `data-wrap`. |
| 114 | Tables wrapped in a horizontal-scroll container | frontend/src/features/docs/DocsArticle.tsx:64-71 | - | **OK** | Region with tabindex=0 and label "Table" (keyboard scrollable, axe clean); 12 tables on the endpoints page, none overflowed at 1200 px. |
| 115 | Callouts (tip/warn/danger), cards, eyebrow, lead styles | frontend/src/features/docs/DocsArticle.module.css | - | **OK** | Visual check on endpoints and first-run; counts equal to old. |
| 116 | Missing partial renders "This page hasn't been written yet." callout | frontend/src/features/docs/DocsPage.tsx:104-110; content.ts:80-87 | - | **CHANGED** | Empty state with the same sentence (warning icon) instead of a warn callout. Code only: every partial exists so it cannot be reached in the built app. |
| 117 | Partial load failure | frontend/src/features/docs/DocsPage.tsx:104-105 | - | **CHANGED** | ErrorState with reload (old showed the "not written yet" text for any HTTP error). Code only. |
| 118 | Loading state keeps old article mounted | frontend/src/features/docs/DocsPage.tsx:98-103 | - | **OK** | Delayed skeleton only when the chunk is slow. |

### H. Docs: search

| # | Old behaviour | New code | Spec | Status | Verified / notes |
|---|---|---|---|---|---|
| 119 | Search box filters the nav in place (titles + section titles), "No matching pages" | frontend/src/features/docs/DocsSearch.tsx | docs.spec | **CHANGED** | Replaced by a results popover (combobox); the nav list itself is NOT filtered (27 links stay visible while searching). OPEN_QUESTIONS says "the nav filter still works instantly on titles", which is not true of the code. |
| 120 | Full-text search (titles, headings, body); results show "Section > Page", heading hits, excerpts | frontend/src/features/docs/content.ts:97-140; DocsSearch.tsx | docs.spec | **OK** | "metric" returns 12 ranked results (title hits first, then headings, then body excerpts). Better than old. |
| 121 | `/` focuses search unless typing in an input | frontend/src/features/docs/DocsSearch.tsx:21-31 | docs.spec | **OK** | Verified; typing `a/b` in the field keeps the slash. |
| 122 | Enter opens the first/highlighted match; Arrow keys move | frontend/src/features/docs/DocsSearch.tsx:41-48,67-90 | docs.spec | **OK** | "install"+Enter -> install; ArrowDown x2 + Enter -> third hit; mouse click on result works; search clears afterwards. |
| 123 | Escape clears, second Escape blurs | frontend/src/features/docs/DocsSearch.tsx:67-90 | docs.spec | **OK** |  |
| 124 | "No results" message; Enter with no results does nothing | frontend/src/features/docs/DocsSearch.tsx:97-100 | docs.spec | **OK** | "No results for "zzzzqq"". |
| 125 | Search popover reopens correctly after Escape + `/` pressed quickly | frontend/src/features/docs/DocsSearch.tsx:66 | - | **BUGGY** | The blur handler schedules `setOpen(false)` in 150 ms and is never cleared. Esc, Esc, `/`, type text within 150 ms leaves the input with text but no results list (reproduced). Fix B7. |
| 126 | Index loaded lazily on first keystroke (~110 KB gzip chunk) | frontend/src/features/docs/DocsSearch.tsx:33-35; content.ts:90-95 | - | **OK** | Shows "Searching..." until ready. |
| 127 | Search results listbox accessibility | frontend/src/features/docs/DocsSearch.tsx:93-130 | docs.spec | **OK** | role=combobox/listbox, aria-activedescendant. |

### I. Docs: responsive and theme

| # | Old behaviour | New code | Spec | Status | Verified / notes |
|---|---|---|---|---|---|
| 128 | <=1100 px hides TOC rail; <=780 px nav stacks above content (old) / collapses behind "Browse docs" | frontend/src/features/docs/DocsPage.module.css:204-256 | docs.spec (760px) | **OK** | Checked 1000/700/390: rail hidden, disclosure + nav toggle appear. |
| 129 | No horizontal page scroll on phones | frontend/src/features/docs/DocsPage.module.css:172-200 | - | **BUGGY** | At 390 px the Next/Previous pager buttons (long titles, no wrap) overflow: `#shell-content` scrollWidth 511 vs 334 on sdk-guide/config, 347 on developer/endpoints. Fix B9. |
| 130 | Dark theme only (as old) | styles/tokens.css | axe | **OK** | App is dark-only; code colours come from --code-* tokens. Nothing to compare for light. |
| 131 | Prose sizes via --docs-* tokens (design lint) | tokens.css; design-language.test.ts | vitest | **OK** | Not re-run. |
| 132 | axe on docs and admin tabs | e2e/docs/docs.spec.ts:186; e2e/admin/a11y.spec.ts | specs | **OK** | Spec results not re-run; no violations spotted by eye. |

### J. CUTOVER.md gaps relevant to this area

| # | Old behaviour | New code | Spec | Status | Verified / notes |
|---|---|---|---|---|---|
| 133 | ~40 gaps listed in CUTOVER.md "Findings from the port" | docs/internal/ui-migration/CUTOVER.md:206-222 | - | **OK** | None of the listed gaps touches Admin or Docs. Only the pytest rows "test_access_admin_browser 0/11/1" and "test_platform_docs 9" concern this area; both were re-verified above (disable+undo, self-locks, docs partial/IA parity). |

## Fix list

Ordered by user impact.

| ID | Severity | Row(s) | Repro | Hint |
|---|---|---|---|---|
| B1 | major | Live progress | Seed runs with `progress_total` larger than `total_items`; open `/admin/runs`: Live shows `4/4`, `6/6`, old page shows `4/9`, `6/12` (API row: progress_completed 4, progress_total 9, total_items 4). | `frontend/src/features/admin/format.ts:55` `progressLabel` prefers `total_items`; for the live variant use `progress_total ?? total_items` (old `progressLabel`), keep `total_items` for Recent. Add a unit test. |
| B6 | major | Maintenance workers line | Platform with `QYM_SERVICE=main` + separate workers (or mock `workers:{loops:"separate", workers_service:{alive:false,processes:[...]}}`): old header says "workers service NOT RESPONDING (0/2 processes)"; new shows only "Summary: unknown / Maintenance: unknown". | Add `workers_service?: {alive:boolean; processes:{alive:boolean}[]}` to `MaintenanceOverview.workers` (`frontend/src/api/admin.ts:96`) and render it in `admin/maintenance/MaintenanceSummary.tsx:14-30` (a "Workers service" badge: alive / not responding, `n/m processes`). |
| B4 | minor | Archive/Unarchive labels | Archive a project with a running run: confirm button reads "Archive project"; old read "Archive anyway" in the danger style. Unarchive a project with active keys: "Unarchive" vs old "Unarchive anyway". | `features/shell/dialogs/ArchiveProjectDialogs.tsx:67,127`: `confirmLabel={warning ? "Archive anyway" : "Archive project"}` and `keys||previewError ? "Unarchive anyway" : "Unarchive"`; tone danger only when a warning exists. Restore the longer copy (read-only rules, Trash purge pause) if wanted. |
| B3 | minor | Archive preview timestamps | Archive a project with a running run: the run line shows `2026-10-12T15:22:51.641256Z`. | `ArchiveProjectDialogs.tsx:47`: format with `new Date(r.started_at).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"})` and prefix "started ". |
| B5 | minor | Self-disable tooltip | Hover the greyed Disable on your own row in `/admin/users`: nothing appears. | `admin/users/UsersTable.tsx:101-108`: wrap the disabled button in a focusable `<span tabIndex={0}>` that is the tooltip trigger (or add `title` as a fallback). |
| B9 | minor | Docs pager overflow on phones | 390 px wide, `/docs/sdk-guide/config`: horizontal scroll (scrollWidth 511 vs 334). | `docs/DocsPage.module.css:172-200`: let `.pager a` shrink (`min-width:0; white-space:normal; overflow-wrap:anywhere`) and stack the pager under 480 px. |
| B2 | minor | Recent page out of range | Open `/admin/runs?page=99`: empty table, pager says "19-20 of 20". | `admin/runs/RunsTab.tsx:13`: clamp `page` to `ceil(total/6)` once `recent.data` arrives (replace the URL) or show page 1. |
| B7 | minor | Docs search popover race | Focus search, type, Esc, Esc, then within 150 ms `/` + text: no results list. | `docs/DocsSearch.tsx:66`: keep the blur timer in a ref and `clearTimeout` it in `onFocus`/`onChange`. |
| B8 | minor | Force stop of an already-stopped run | Stop a run elsewhere, then confirm Force stop here: still reports "was force stopped". | `admin/runs/ForceStopDialog.tsx:33` `onStopped(run, result.stopped)`: when `stopped` is false say "was already stopped". |
| B10 | minor | Live subtitle on error | Make `/api/runs/live` fail: header says "0 running across all projects" above the error. | `admin/runs/RunsTab.tsx:18` hide the count unless `live.data`. |
| B11 | minor (docs of the migration) | Docs nav filter claim | OPEN_QUESTIONS "nav filter still works instantly on titles" is not implemented; nav is not filtered while searching. | Either filter the nav list by the query (old behaviour, titles + section titles, "No matching pages") or correct `docs/internal/ui-migration/decisions/admin-docs/OPEN_QUESTIONS.md`. |


## Not verified

- Real PostgreSQL maintenance statistics (SQLite has none): the tables/bytes/rows rendering and the separate-workers payload were checked with mocked responses only; the server-side top-12 cap was not checked.
- Vite dev server on :5837 was not used; the built app served by uvicorn was tested.
- Reset-password "locks while pending" and the member-forbidden spec were exercised by hand, not by re-running `e2e/admin/proxy.spec.ts` (needs its own stack and ports); the old UI was not run under session auth, so its reset-password gating was read from code only.
- Cross-tab `announceRunStatus` after a force stop (needs two tabs on a run page) and a paused maintenance job from the real worker (none can be created on SQLite) were read from code / mocked.
- The "not written yet" docs state cannot occur in the built app (all 27 partials exist) and was read from code only.
- Axe/Vitest/design-language suites were not re-run.
