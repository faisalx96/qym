# QA: shell, auth, projects, profile, project settings

Area: briefs 01 (shell/auth/projects) and 02 (shared primitives, only where this area uses them).
Compared the vanilla UI at `7814183` (platform on :8820) with the React app on `ui/qa` (:8830), same seeded
SQLite file (3 projects + 1 archived, 3 users, API key, read token, LLM connection, 7 runs), under
`QYM_AUTH_MODE=none`, `proxy_headers` (X-User-Email as admin / manager / member / outsider), `oidc` + local
password (fresh DB: sign-up, bootstrap token, temporary password, throttle) and `QYM_ROOT_PATH=/qym`.
Verification was done with ad-hoc Playwright scripts (screenshots kept outside the repo). Existing e2e specs were
not re-run (they need their own 8800/5800 stack). Paths are relative to `frontend/src/features/shell/` unless a
full `frontend/...` path is given. Status: OK / CHANGED (acceptable unless noted) / BUGGY / MISSING.
"code" in the Verified column means read from source only.

## Summary

Total rows: 153. OK 82, CHANGED 49, BUGGY 15, MISSING 7. (Deliberate drops that were replaced by something equivalent are CHANGED; deliberate drops with no equivalent are MISSING.)

Highest-impact findings: (1) Profile bootstrap-admin cannot be retried after one wrong token; (2) editing LLM
connection A then clicking Edit on B leaves A's values in the form under B's title; (3) members are offered
Revoke on other people's API keys and get "Access denied"; (4) provider buttons read "Continue with Continue with
Google" and lost their brand icons; (5) `/compare` and `/reviews` lose the project context in the sidebar and
breadcrumb; (6) "Back to projects" / "All projects" buttons are `<button><a>` and do nothing from the keyboard.

## Table

Legend for the Spec column: `nav`=e2e/shell/navigation.spec.ts, `proj`=projects.spec.ts, `set`=settings.spec.ts,
`auth`=auth.spec.ts, `prof`=profile.spec.ts, `a11y`=a11y.spec.ts, `arch`=cutover-archive.spec.ts,
`acc`=cutover-access.spec.ts, `rem`=cutover-member-removal.spec.ts, `rr`=cutover-review-rules.spec.ts,
`boot`=cutover-bootstrap-admin.spec.ts, `lf`=cutover-login-form.spec.ts, `fs`=cutover-failure-states.spec.ts.

### A. Shell chrome and navigation

| # | Old behaviour (vanilla) | New code | Spec | Status | Notes |
|---|---|---|---|---|---|
| A1 | Sidebar global items: Projects (`/`), Docs (`/docs-guide`) | AppShell.tsx:137, chrome/nav.ts:24 | nav | OK | Verified; Docs goes to `/docs/get-started/what-is-qym` (docs area). |
| A2 | Nine project items (Dashboard, Charts, Runs, Models, Experiments, Auto-analysis, Reviews, Datasets, Project Settings) | chrome/nav.ts:35-52 | nav, proj | CHANGED | Same set and order. Labels re-cased: "Project settings", "Deleted runs". Fine. |
| A3 | "Platform" section (Admin with "Admin" badge, Deleted Runs) only for ADMIN | AppShell.tsx:97,153; nav.ts:55 | nav | OK | Verified: MEMBER sees only Projects + Docs. |
| A4 | `.no-project` hides project items and switcher outside a project | AppShell.tsx:144 (`project ?`) | nav | OK | |
| A5 | Archived project hides Auto-analysis and Reviews | AppShell.tsx:95; ProjectLayout.tsx:17 | nav | OK | Verified; direct URL shows "Not available for an archived project" panel (old: server 404). |
| A6 | Collapse toggle, persisted in `qym:sidebar-collapsed` | hooks.ts `useSidebarCollapsed`, AppShell.tsx:45 | nav | OK | Same localStorage key; verified across reload. |
| A7 | Auto-collapse at <=760px | hooks.ts:`COLLAPSE_BREAKPOINT`, AppShell.tsx:59 | nav | CHANGED | Now an overlay: opens over content, closes on Escape / outside click / item click (verified). Improvement. |
| A8 | Collapsed items show tooltip via `data-tooltip` only | AppShell.tsx:236-245 | a11y | OK | Adds `aria-label` when collapsed (pain point 10 fixed). |
| A9 | Active nav from route with parent mapping (run-detail, compare -> Runs; queue -> Experiments; analyzer -> Auto-analysis) | nav.ts:`activeFor`, parseRoute | nav | OK | Verified for project routes. Global `/compare` see A45. |
| A10 | Logo link to `/`: Arabic wordmark + icon images | AppShell.tsx:129 | - | CHANGED | Text mark "ق qym" in a teal box replaces the brand images (sidebar and login). Product call; flag for design review. |
| A11 | Breadcrumbs: `switcher / Page`, `Runs / <id>`, `Experiments / Queue`, `<id> / Auto-analysis`, `Runs / Compare` | chrome/Breadcrumbs.tsx | nav | CHANGED | Same shapes except Compare (A45). Page label "Settings" (old "Project Settings"). Separator is a chevron. |
| A12 | Current breadcrumb had no `aria-current` | Breadcrumbs.tsx:62 | nav | OK | Fixed. |
| A13 | Project switcher popover: search focused on open, identicon, archived tag, check mark, "Create Project" footer | chrome/ProjectSwitcher.tsx | proj, nav | OK | Verified. Also shows the slug under each name. |
| A14 | Switcher closes on outside click / Escape | ProjectSwitcher.tsx (React Aria Popover + SearchField) | nav | CHANGED | With text typed, the first Escape clears the search and the second closes (spec only covers the empty-search case). Minor. |
| A15 | Choosing a project navigates to its runs page and stores `qym:last-project-slug` (not for archived) | ProjectSwitcher.tsx:40-44 | proj, nav | OK | Verified. New code also stores the slug on any project visit (ProjectLayout.tsx:32). |
| A16 | "Create Project" footer always shown | ProjectSwitcher.tsx (`canCreateProject`) | proj | CHANGED | Only when the user can create (admin or manager of any project). Improvement. |
| A17 | Archived current project listed in switcher with tag | ProjectSwitcher.tsx:29-33 | nav | OK | |
| A18 | User footer: avatar initials, name, email; popover with role, Profile, Sign Out | chrome/UserMenu.tsx | nav | CHANGED | Menu header shows name/email/role. "Sign out" only when `sessionAuth` (A19). Initials rule differs for users without a display name (email `dev@local` gives "DL", old "DE"). Trivial. |
| A19 | Sign Out: `POST /v1/auth/logout`, clear `qym:me`, go to `/login?next=/` | api/me.ts:`useLogout` | auth | OK | Verified (also clears sessionStorage and the query cache; Back lands on `/login`). Under `none`/`proxy_headers` without local auth the item is hidden (old showed it and it did nothing useful). |
| A20 | Topbar KPI stats (`setTopbarStats`), remembered per URL family in sessionStorage | TopbarStats.tsx, chrome/TopbarStatsBar.tsx | - | CHANGED | Context hook `useTopbarStats`; sessionStorage replay dropped (decision). Not blank on reload in my run (CUTOVER "blank on reload" not reproduced). |
| A21 | Topbar stats shrink below 1199px | chrome/TopbarStatsBar.module.css, AppShell.module.css | - | FIXED (5894a544) | At 900px and 768px the project name/"Runs" crumb collides with the stats ("Beta Proje" overlapping "ct", "R..."), and chips are clipped ("2 runs with erro"). Repro: open `/projects/beta` at 768 or 900 px wide. Confirms the CUTOVER gap. |
| A22 | Archived read-only banner between topbar and content | ArchivedBanner.tsx, ProjectLayout.tsx:14,57 | nav, a11y | CHANGED | Copy shorter; admins get an "Unarchive it" link to `settings?tab=danger`. Topbar additionally shows an "ARCHIVED" badge and a "Read-only" tag (redundant). Banner is `role=status`, so it shows up in every status-region query. |
| A23 | Archived banner pages: runs, overview, charts, models, datasets, settings, run-detail, experiments, queue | ProjectLayout.tsx:14 | nav | OK | Banner also shows on analyzer-under-runs and environments (harmless). |
| A24 | Project Not Found client panel with slug line and "Back to Projects" | ProjectNotFound.tsx | nav | CHANGED | Same copy minus the "Slug:" box; button text "All projects". See A25 for the bug. |
| A25 | (new) "Back to projects" / "All projects" button | NotFound.tsx:14, ProjectNotFound.tsx:47 | - | FIXED (e3bed7d2) | Rendered as `<button><span><a href="/">`. Clicking the button's padding does nothing and Enter on the focused button does nothing; only the text link works; invalid nesting. Repro: `/projects/nope` or `/nonexistent`, Tab to the button, press Enter. Use `LinkButton` (as the archived variant at ProjectNotFound.tsx:36 already does). |
| A26 | Active project without access: JSON 403 | ProjectLayout.tsx (`isNoAccess`) | nav | CHANGED | "Access denied" panel. Improvement. Verified as outsider. |
| A27 | Unknown project: server HTTP 404 page | api/spa.py | nav | CHANGED | Server answers 200 with the SPA, which renders the panel (deliberate, CUTOVER.md:14; "no server 404 for unknown projects"). Acceptable; only matters to crawlers/monitors. |
| A28 | Unknown path: JSON 404 | NotFound.tsx | nav | CHANGED | In-app "Page not found" panel. Improvement. |
| A29 | `/analyzer` | - | - | OK | 404 in both. |
| A30 | `qym:me` snapshot for first paint | - | - | CHANGED | Dropped on purpose (foundation OPEN_QUESTIONS). Skeleton shows after 300 ms instead. Cleared on logout anyway. |
| A31 | `qym-shell-pending` guard | RequireAuth.tsx | - | OK | Replaced; no flash seen. |
| A32 | In-app link interception, fetch-swap navigation | React Router `Link` | nav | OK | No full page loads (spec `trackPageLoads`). |
| A33 | Document title per page | hooks.ts `useDocumentTitle` | - | CHANGED | `<page> · قيِّم` (old was page-specific, sometimes "قيِّم • <run>"). Fine. |
| A34 | Scroll reset on push, restore on Back for `#shell-content` | hooks.ts:`useContentScrollRestoration` | nav | OK | Table scrollers inside pages: runs-list gap (not this area). |
| A35 | Progress bar while navigating (`.is-navigating`) | - | - | MISSING | Brief verdict NICE. No pending indicator between route change and lazy chunk / data. Not logged as a deliberate drop. |
| A36 | Prefetch run detail JSON on click | - | - | MISSING | Brief verdict NICE; not ported, not logged. |
| A37 | `qym:run-status` + BroadcastChannel `qym-run-status` | lib/run-status.ts, App.tsx | nav | OK | Spec covers the cross-tab message. |
| A38 | `replaceUrlQuery` helper | lib/url-state.ts | - | OK | |
| A39 | `copyText` with execCommand fallback | lib/copy.ts | - | OK | code |
| A40 | Root-path prefix (`QYM_ROOT_PATH`) | lib/runtime.ts, router basename | - | OK | Verified under `/qym`: cards, settings tab URL, reload, legacy run redirect, archive redirect to `/qym`. |
| A41 | Escape closes popovers, focus returns | React Aria | nav | OK | |
| A42 | (new) Ctrl/Cmd+K palette: projects, pages, actions | chrome/CommandPalette.tsx | nav | OK | Verified: filter, arrows, Enter, "Manage members" and "API keys" actions. No old counterpart. |
| A43 | (new) Skip link + focus to `main#shell-content` on route change | AppShell.tsx:107,54 | nav | OK | |
| A44 | Toasts: `QymShell.toast`, 4 s default, min 1 s, error `role=alert`, optional action | ui/Toast/Toast.tsx | - | OK | Top-right only (runs-page top-center toast dropped, decision). Errors last 6 s; max 5 stacked; pause on hover/focus. |
| A45 | `/compare` and `/reviews` (no project in URL) keep the last project as context: project nav, switcher, `Beta / Runs / Compare` | AppShell.tsx:36 uses only `route.projectSlug` | - | FIXED (5894a544) | Repro: visit `/projects/beta`, then `/compare` or `/reviews`. New sidebar has only Projects/Docs/Platform, breadcrumb is `Projects / Compare`; the Runs nav item is not highlighted. Old showed the full project nav from `qym:last-project-slug`. Compare is linked at `/compare?runs=` from the runs list and matrix. Fix: use the remembered slug (ComparePage already does at compare/ComparePage.tsx:48) as the shell project when the route has none. |
| A46 | Legacy `/run/<id>` -> run page in its project | LegacyRunRedirect.tsx | nav | OK | Verified: project taken from the run JSON; query and hash kept; unknown id falls back to remembered/first project and shows "Run not found". |
| A47 | Legacy `/run/<id>/analyzer` -> `/projects/<slug>/runs/<id>/analyzer` | LegacyRunRedirect.tsx:61 | nav | CHANGED | Lands on `/projects/<slug>/analysis?run=<id>` (analyzer area's canonical URL). Fine. |
| A48 | `/app/...`, `/index.html`, trailing slash | api/spa.py, router.tsx | - | OK | `/app/projects/beta` -> `/projects/beta`; `/index.html` -> `/`; `/projects/beta/settings/` works. |
| A49 | Unauthenticated deep link -> `/login?next=` (server) | api/spa.py | auth | OK | Verified for `/projects/x`. |
| A50 | 401 mid-session -> redirect to login | lib/http.ts:157, RequireAuth.tsx:22 | auth | OK | code |
| A51 | `proxy_headers` without identity: JSON 401 | RequireAuth.tsx:36 | - | CHANGED | "No user identity" panel with Retry. Improvement. Verified. |
| A52 | Back after sign-out must not show private pages | NoStoreMiddleware + SPA | - | OK | Verified: Back lands on `/login`. |
| A53 | Skeleton timing (300 ms wait, 400 ms min, 200 ms fade) | lib/pending.ts, ui/Skeleton | - | OK | code |
| A54 | `Identicon` (FNV hue, 5x5 symmetric) | ui/Identicon | - | OK | Rendered in chips; different empty-cell treatment, same hue. |
| A55 | Dialog / FormDialog / Drawer primitives (`openConfirmDialog` etc.) | ui/ConfirmDialog, ui/FormDialog, ui/Drawer | fs, a11y | OK | Used throughout this area; destructive dialogs open on Cancel (verified for revoke and remove). `mismatchMessage` replaced by a disabled confirm button. |

### B. Login (`/login`)

| # | Old behaviour | New code | Spec | Status | Notes |
|---|---|---|---|---|---|
| B1 | Public page, no shell | login/LoginPage.tsx | a11y | OK | |
| B2 | Clears `sessionStorage` on load | LoginPage.tsx:30 | auth | OK | |
| B3 | Methods from inlined bootstrap | `useAuthProviders` (api/me.ts:19) | auth | OK | Reads `/v1/auth/providers`. |
| B4 | Email + password form with placeholders (`name@company.com`, "Enter your password") | LoginPage.tsx:206-235 | lf | CHANGED | No placeholders. Minor. |
| B5 | Hint "Forgot your password? Ask an admin to reset it." | - | - | FIXED (e41a9264) | Dropped, not logged. Minor, but it is the only recovery guidance. |
| B6 | Sign-in success -> `next` | LoginPage.tsx:184 | auth | OK | |
| B7 | `next` sanitised (`//evil`, `\`, schemes) | lib/http.ts:`sameOriginTarget` | auth | OK | Verified `?next=//evil.com/x` lands on `/`. |
| B8 | Already signed in -> redirect to `next` | api/spa.py | auth | OK | Verified. |
| B9 | 401 message, password cleared + focused | LoginPage.tsx:192-199 | lf | OK | Verified. |
| B10 | 429 throttle message | LoginPage.tsx:194 | - | OK | Verified: after 5 attempts "Too many sign-in attempts. Try again in 5 minutes." (server detail). |
| B11 | Error text cleared as soon as the user types | LoginPage.tsx:154 `StatusLine` | - | FIXED (e41a9264) | Error stays until the next submit (CUTOVER gap, verified on sign-in and change-password). Minor. |
| B12 | `403 password_change_required` -> change-password mode | LoginPage.tsx:186, 238 | auth | OK | Verified end to end: temporary password, mismatch, same-as-temp, short, success -> redirect. |
| B13 | Change form copy "An admin reset the password for <email>..."; Cancel | LoginPage.tsx:244-246, 312 | auth | CHANGED | New copy "Your password was reset. Choose a new one to continue."; button "Back to sign in". Fine. |
| B14 | Mismatch error refocuses the confirm field | LoginPage.tsx:251 | - | FIXED (e41a9264) | Focus stays on the submit button (CUTOVER gap, verified). Minor. |
| B15 | Temporary password kept in memory only | LoginPage.tsx:187-188, 240 | - | FIXED (e41a9264) | The temporary password is written to `sessionStorage['qym:login-temp']` (plus the email) and stays there after "Back to sign in" until the page reloads. Keep it in React state lifted to `LoginBody` instead. Minor (security hygiene). |
| B16 | Change-password 401 -> back to sign-in with message | LoginPage.tsx:265 | auth | CHANGED | Message "...Sign in again." (old: "Ask an admin for a new one."). Minor. |
| B17 | Sign-up toggle only when `signup_enabled` | LoginPage.tsx:115 | auth | OK | |
| B18 | Sign-up form: display name, email, password, >=8 chars, server errors | LoginPage.tsx:319 | auth | OK | Verified short password and success. Typed email is lost when toggling sign-in <-> sign-up (old kept values); code, minor. |
| B19 | Provider buttons per enabled provider: brand icon, label, description, arrow, `?next=` | LoginPage.tsx:137-147 | - | FIXED (e41a9264) | Text renders "Continue with Continue with Google" because the API label already is "Continue with Google". Brand icons (Google/GitHub/GitLab), descriptions ("Use your Google identity to continue") and arrows are gone (generic external-link icon). Repro: oidc mode with Google configured. Fix: render `p.label` as is and restore the icon/description theme map. |
| B20 | "Or continue with" divider only when local auth and providers both exist | LoginPage.tsx:130 | - | OK | |
| B21 | "SSO" coming soon never rendered | LoginPage.tsx:79 | - | OK | |
| B22 | "No login methods are configured for this deployment." | LoginPage.tsx:81-102 | auth | CHANGED | Longer copy plus "Open qym" under `none`. Improvement. |
| B23 | Success status line "Signed in. Redirecting..." / "Account created..." | LoginPage.tsx:231 | - | CHANGED | Button spinner only. Fine. |
| B24 | Login visual identity (logo images, gradient glow, provider cards) | LoginPage.module.css | a11y | CHANGED | Simpler card with grid backdrop and a text logo. Judge as design change, not a regression. |
| B25 | Enter submits | native form | - | OK | |

### C. Projects landing (`/`)

| # | Old behaviour | New code | Spec | Status | Notes |
|---|---|---|---|---|---|
| C1 | Card grid from `/v1/me.projects` | projects/ProjectsPage.tsx:83 | proj | OK | |
| C2 | Card: identicon, role tag, name, slug, members and runs, "created <date>", "updated <relative>" | ProjectsPage.tsx:96-120 | proj | CHANGED | "created" date dropped; relative time coarser ("today", "N days ago" vs "2m ago", "3h ago"). Minor. |
| C3 | Singular/plural ("1 member", "1 run") | ProjectsPage.tsx:113-116 | - | FIXED (1906f7a0) | Always plural: "1 runs", "1 members" (verified). Same in settings header? No, header handles it. |
| C4 | Search by name or slug, client side | ProjectsPage.tsx:28 | proj | OK | "No matching projects" panel added. |
| C5 | "New Project" shown for ADMIN or any MANAGER | ProjectsPage.tsx:34,50 | proj, acc | OK | Verified for admin, manager, member. |
| C6 | Create dialog: name, slug auto-derived until edited, Enter submits, inline error, navigates | dialogs/CreateProjectDialog.tsx | proj, fs | OK | Verified duplicate slug shows "Project slug already exists" and keeps the dialog. |
| C7 | Slug required client side | CreateProjectDialog.tsx:36 | - | CHANGED | Slug optional; server derives one. An Arabic name auto-fills an Arabic slug that the server silently turns into `project`. Minor; either restrict `slugify` to `[a-z0-9-]` (old) or show the server's slug. |
| C8 | Empty state "No projects yet" | ProjectsPage.tsx:63 | proj | OK | Copy depends on whether the user can create. |
| C9 | Subtitle "Select a project to view its evaluations, or create a new one." | ProjectsPage.tsx:40 | - | CHANGED | "N projects you belong to". Fine. |
| C10 | Card is an `<a>`, in-app navigation | ProjectsPage.tsx:98 | proj | OK | |

### D. Profile (`/profile`)

| # | Old behaviour | New code | Spec | Status | Notes |
|---|---|---|---|---|---|
| D1 | Account grid: Display Name, Email, Global Role, Default Project | profile/ProfilePage.tsx:68-90 | prof | OK | Adds "Sign-in method"; default project is a link. |
| D2 | Projects list with role pill, Open, Settings | ProfilePage.tsx:27-59 | prof | OK | Now a table with a Runs column. |
| D3 | Empty projects text | ProfilePage.tsx:105 | - | CHANGED | "You are not a member of any project yet." |
| D4 | Hero line "Your access is now project-scoped..." | ProfilePage.tsx:61 | - | OK | Dropped on purpose (pain point 8). |
| D5 | Bootstrap panel only when `can_bootstrap_admin && role != ADMIN` | ProfilePage.tsx:96 | boot | OK | Verified. |
| D6 | Token input is `type=password`, `autocomplete=one-time-code` | ProfilePage.tsx:142-150 | boot | FIXED (9b31cc5c) | Plain visible text field (mono). A secret shown on screen; restore password type. Minor. |
| D7 | Wrong token shows an error and the field stays usable | ProfilePage.tsx:108-160 | boot | FIXED (9b31cc5c) | After one `403 Invalid bootstrap token`, retyping the right token and pressing Enter or clicking "Grant admin" sends NO request (the field is in an invalid state from `errorMessage`, native validation blocks submit); the user must reload. Repro: fresh DB, session auth, sign up, Profile, enter `wrong` then `boot`; only one POST appears in the network log. Also shows the error twice (field and `role=alert`). Fix: clear `error` on change and use `validationBehavior="aria"`, or do not pass `errorMessage`. Major. |
| D8 | Success -> "Admin access granted. Refreshing..." then reload | ProfilePage.tsx:117-121 | boot | OK | Verified: panel gone, role ADMIN, Platform nav visible. |
| D9 | Copy "only available before the first active admin exists" | ProfilePage.tsx:122 | - | CHANGED | Replaced with a QYM_ADMIN_BOOTSTRAP_TOKEN hint. Fine. |
| D10 | Empty token -> "Token is required." | ProfilePage.tsx:154 | - | CHANGED | Button disabled instead. |
| D11 | Display name / title not editable | - | - | OK | Same (decision). |

### E. Project settings (`/projects/<slug>/settings`)

| # | Old behaviour | New code | Spec | Status | Notes |
|---|---|---|---|---|---|
| E1 | Tabs: General, Members, API Keys, LLM Connections, Environments, AI Prompts (manager/admin), Danger Zone (admin) | settings/ProjectSettingsPage.tsx:30-45 | set, acc | OK | Verified for admin, manager, member. Labels re-cased ("API keys", "AI prompts", "Danger zone"). Members tab shows a count badge. |
| E2 | `?tab=<id>` selects once (ids general, members, apikeys, llm, environments, prompts, danger) | ProjectSettingsPage.tsx:46-48 | set | CHANGED | Same ids; tab is persistent URL state and every tab click rewrites the URL. A tab the user may not see (e.g. `prompts` for a member) silently falls back to General and the param is stripped. Improvement. |
| E3 | Tabs are click only | ui/Tabs | set | CHANGED | Arrow keys / Home / End now work. Improvement. |
| E4 | Header: name, subtitle, slug, role, member count, status | ProjectSettingsPage.tsx:53-75 | set | OK | |
| E5 | Archived-note under the header explaining what still works per role | ProjectSettingsPage.tsx | arch | FIXED (1906f7a0) | Old text: "Settings are read-only while the project is archived. You can still revoke API keys and remove members, and unarchive or delete..." The shell banner only says "archived and read-only". Minor. |
| E6 | General overview: slug, role, members, status | settings/GeneralTab.tsx:19-40 | set | OK | Adds Runs and Created. |
| E7 | Rename (admin): Enter saves, toast, sidebar/breadcrumb sync | GeneralTab.tsx:58-82, api/projects.ts:`useRenameProject` | set | OK | Verified, breadcrumb and sidebar title update. |
| E8 | Non-admin sees the name field disabled with "Only admins can rename a project." and a read-only slug field | GeneralTab.tsx:58 | acc | CHANGED | Whole Name card hidden for non-admins (access spec asserts this). Acceptable. |
| E9 | Correction review rules visible to every member, editable by managers/admins; footer note "Only project managers and admins can change these rules" | GeneralTab.tsx:92 (`canManage ?`) | rr, acc | CHANGED | Hidden entirely for plain members (old showed the rules read-only), so members cannot see who may approve their corrections. Explanatory copy ("Applies to approving, rejecting and resetting corrections... AI diagnoses taken as they are have no human author") also dropped. Minor. |
| E10 | Save rules -> toast, persists | GeneralTab.tsx:111-127 | rr | OK | Verified including reload. |
| E11 | Members columns: member, email, role, "Added" date, actions | settings/MembersTab.tsx:49-128 | set | CHANGED | "Added" column dropped. Minor. |
| E12 | Add member combobox: 200 ms debounce, arrows (wrapping), Enter, Esc, `aria-activedescendant`, role select, Add | MembersTab.tsx:200-317 | set, acc | OK | Verified. Arrows clamp instead of wrapping (trivial). |
| E13 | Combobox messages: "Everyone is already a member.", "No one outside the project matches ...", "Keep typing to narrow the list.", "Could not search people: ..." | MembersTab.tsx:285 | - | FIXED (1906f7a0) | With no match or a failed search the list simply does not open; the user gets no feedback. Verified with a nonsense query. Minor. |
| E14 | Per-row role select + Save | MembersTab.tsx:56-90 | set | OK | Save appears only after a change; toast "Role saved". |
| E15 | Remove allowed for any row (including yourself) | MembersTab.tsx:103 | acc | CHANGED | Hidden for your own row. Acceptable (server refuses last manager anyway). |
| E16 | Remove dialog: focus on Cancel, preview, transfer-runs select, `?transfer_runs_to` | MembersTab.tsx:157-193 | rem, set | OK | Verified focus on Cancel. |
| E17 | Remove dialog counts `owned_runs + owned_deleted_runs`, names the member's active API keys that will be revoked, hides transfer in an archived project, button "Transfer N runs and remove", success toast mentions the new owner | MembersTab.tsx:162-182 | rem | FIXED (1906f7a0) | Only `owned_runs` is read: a member who owns only deleted runs shows "They own no runs" and no transfer select; the keys to be revoked are not listed (generic sentence); transfer select is offered even when the project is archived (server then refuses); button label never changes. code (could not seed a member owning only deleted runs). Fix: use `owned_runs + owned_deleted_runs`, list keys from the api-keys query, hide transfer when `readOnly`. |
| E18 | API keys: create (name, default "default"), key modal with Copy and toast | settings/ApiKeysTab.tsx:34-190, dialogs/SecretRevealDialog.tsx | set | OK | Verified; blank name creates "default". |
| E19 | Key modal: initial focus on Copy; warning "Store it in a secret manager or `.env` as QYM_API_KEY" (read token: "Set it on the Evaluation Service as QYM_DATASET_READ_TOKEN...") | SecretRevealDialog.tsx | set | CHANGED | Focus lands on the dialog itself; warning text replaced by a generic "shown once" line (the card description still names QYM_API_KEY). Minor. |
| E20 | Key table columns name, prefix, created by, status | ApiKeysTab.tsx:50-80 | set | CHANGED | Adds "Created"; revoked keys stay listed with a badge. Fine. |
| E21 | Revoke button only where `canRevokeKey` (admin, manager, or the key's creator) | ApiKeysTab.tsx:78 | acc | FIXED (1906f7a0) | Every active key shows "Revoke" to everyone. A plain member (u1) can open the dialog for the admin's `ci-key`, confirm, and gets an "Access denied" toast. Repro: proxy_headers as MEMBER, Settings > API keys. Fix: gate on `canManage` or `key.creator?.id === me.id`. |
| E22 | Revoke confirm dialog, toast, allowed while archived | ApiKeysTab.tsx:151-168 | set, arch | OK | Verified on active and archived projects. |
| E23 | Create key hidden while archived | ApiKeysTab.tsx:92 (`!readOnly`) | arch | OK | |
| E24 | Dataset read tokens (admin only): create (default name "Evaluation Service"), modal, revoke | ApiKeysTab.tsx:173-290 | set | OK | Revoke now uses the shell dialog instead of `window.confirm` (improvement). |
| E25 | Read token table: name, prefix, creator, status | ApiKeysTab.tsx:196-215 | set | CHANGED | Shows name, created, status; prefix and creator dropped. Minor. |
| E26 | LLM table: name + Default/"Analysis only" tags, model, endpoint, key hint ("Not set" in warning colour), actions | settings/LlmConnectionsTab.tsx:58-123 | set | CHANGED | Same columns; missing key shows "—" instead of "Not set". Tags are lower-case. |
| E27 | Set default / Test / Edit / Delete visible to everyone not archived | LlmConnectionsTab.tsx:85-120 | set | CHANGED | Edit actions gated on `canManage && !readOnly` (improvement); Test stays for all. |
| E28 | Test: spinner in the button, toast `"name" connected . model` or `"name" failed: detail` | LlmConnectionsTab.tsx:43-56 | set | CHANGED | Loading button; failure toast text is just the server detail ("LLM connection failed: ..."), 8 s. Fine. |
| E29 | Set default has no feedback on failure | LlmConnectionsTab.tsx:95-101 | - | FIXED (1906f7a0) | `mutateAsync(...).then(toast)` has no `catch`: a 4xx gives no toast and an unhandled rejection. Minor. |
| E30 | Inline add/edit form always visible, blank URL/model get defaults (`https://api.openai.com/v1`, `gpt-4o-mini`), key `__KEEP__` on edit, scroll into view | LlmConnectionsTab.tsx:148-178, 201-276 | set | CHANGED | Form opens on demand; URL/model/name required (no defaults); `__KEEP__` handled; placeholder "Keep current (••••7890)". |
| E31 | Editing connection A then pressing Edit on connection B | LlmConnectionsTab.tsx:162, 212-216 | - | FIXED (1906f7a0) | `ConnectionForm` has no `key`, so its `useState` initial values are not re-read: the header says `Edit "second"` while the fields still hold "main" (verified). Saving would PUT main's name/URL/model to B. Fix: `key={editing?.id ?? 'new'}`. Major (silent data corruption). |
| E32 | "Test" inside the edit form | LlmConnectionsTab.tsx:261-273 | - | MISSING | Only the row Test exists; fine once saved. Minor. |
| E33 | "Available for experiments" help ("needs an https:// base URL...") | LlmConnectionsTab.tsx:257 | - | CHANGED | Short label only. Minor. |
| E34 | Delete connection confirm | LlmConnectionsTab.tsx:179-196 | set | OK | |
| E35 | Environments tab mounts the panel; `?env=&promote=&id=` deep link | settings/EnvironmentsTab.tsx, features/environments/EnvironmentsPanel.tsx:40-54 | set | OK | code; owned by the experiments QA. `onGotoApiKeys` goes to `?tab=apikeys`. |
| E36 | Prompts: vertical tablist (arrows/Home/End), editor, Custom/Default badge, char count, "edited <relative>" refreshed every 60 s, unsaved indicator | settings/PromptsTab.tsx | set | OK | Verified. "edited never" instead of "not yet". |
| E37 | Prompts "View diff": inline line-by-line LCS panel (cap 24 000 cells) | PromptsTab.tsx:48-78, 193-215 | set | CHANGED | Now a dialog with a word-level diff; same cap. Button disabled when the draft equals the default. Fine. |
| E38 | "Restore default" loads the default into the editor; Save applies it | PromptsTab.tsx:108, 221 | set | CHANGED | Restore saves immediately after confirmation (no draft step, so it cannot be reviewed before it takes effect). Adds a "Discard" button. Acceptable but worth a decision. |
| E39 | Empty prompt -> "<label> prompt must contain text." | PromptsTab.tsx:108-118 | - | FIXED (1b950e5f) | Server 422 is shown raw: `[{"type":"string_too_short","loc":["body","value"],...}]` as a toast. See F1. Also add a client check. |
| E40 | Save message "...saved. New requests will use it immediately." | PromptsTab.tsx:114 | set | CHANGED | Toast "Prompt saved". |
| E41 | Archived: editor read-only, Save/Restore hidden | PromptsTab.tsx:151,164 | arch | OK | code. |
| E42 | Prompt tablist horizontal below 900 px | settings.module.css | - | OK | not verified at runtime. |
| E43 | Danger zone: Archive (preview of running runs, `archive`, toast, navigate `/`) | settings/DangerZoneTab.tsx, dialogs/ArchiveProjectDialogs.tsx:25-80 | set, arch | OK | Verified: toast, project leaves Projects, lands on `/`. |
| E44 | Archive copy: hidden from list, keys stop, members keep read access, deleted runs stay in Trash with purge paused, running runs listed with start time, "Archive anyway" in danger style | ArchiveProjectDialogs.tsx:56-67 | arch | CHANGED | Shorter copy ("They will be stopped"), no Trash/purge-pause sentence, started-at shown as raw ISO, button stays "Archive project". Minor. |
| E45 | Unarchive: preview of active keys, "Revoke keys first" jumps to API keys tab, `POST unarchive`, stays on page with toast | ArchiveProjectDialogs.tsx:82-142 | set | OK | Verified, tab switches and dialog closes. Missing the "Deleted runs resume their purge countdown" and "no active API keys" lines; button not "Unarchive anyway". Minor. |
| E46 | Delete: preview; blocked -> "Archive instead" (non-archived) or "Open Deleted Runs" (archived); else type-the-name confirm; `DELETE ?confirm=` | ArchiveProjectDialogs.tsx:144-219 | set, arch | OK | Verified: beta (7 runs) blocked; alpha shows typed confirm and a disabled button on mismatch. Archived-blocked links to `/trash?project=<slug>` (old: `/trash`). Counts are listed with raw keys ("rule versions 1", "api keys 2") instead of the old sentence. |
| E47 | Archived project: all mutation controls hidden, allowed: revoke keys, remove members, unarchive/delete (admin) | settings/* (`readOnly`) | arch | OK | Verified on an archived project: no create-key form, no add-member bar, no role selects, no LLM add/edit; Test and revoke stay. |
| E48 | `GET by-slug` + members + keys + tokens + connections + prompts all loaded up front, one reveal | per-tab `useQuery` | - | CHANGED | Each tab loads its own data; per-tab skeleton and Retry (improvement; fixes pain points 6 and 7). |
| E49 | Dates as "Oct 12, 2026" (en-US) | GeneralTab.tsx:38, ApiKeysTab.tsx:10 | - | CHANGED | `toLocaleDateString()` / `toLocaleString()` in the browser locale. Trivial. |

### F. Cross-cutting

| # | Old behaviour | New code | Spec | Status | Notes |
|---|---|---|---|---|---|
| F1 | Server validation errors shown as readable text | lib/http.ts:145 | - | FIXED (1b950e5f) | A FastAPI 422 body (`detail` is an array) is `JSON.stringify`-ed into the toast/inline error. Every form that can hit a 422 shows raw JSON. Fix: map `[{loc,msg}]` to `field: msg` lines. Minor/major depending on form. |
| F2 | axe-clean pages | e2e/shell/a11y.spec.ts | a11y | OK | Not re-run here. Found by hand: A25 (`button > a`). |
| F3 | Same-origin write guard, no CORS | - | - | OK | Verified through the served build (POSTs from the same origin). |

## Fix list

Ordered by user impact.

1. **major** D7 Profile bootstrap-admin cannot be retried after a wrong token. Repro: session auth, fresh DB, sign up, Profile, submit a wrong token, then the right one: no request is sent. Hint: `profile/ProfilePage.tsx:142-160`, stop passing `errorMessage` (or clear it in `onChange` and use `validationBehavior="aria"` on `TextField`); render the error once.
2. **major** E31 Editing LLM connection B after A shows A's values under B's title. Hint: `settings/LlmConnectionsTab.tsx:162`, add `key={editing?.id ?? 'new'}` to `<ConnectionForm>`.
3. **major** E21 Plain members see "Revoke" on other people's API keys and get "Access denied". Hint: `settings/ApiKeysTab.tsx:78`, show only when `canManage || k.creator?.id === me.id` (old `canRevokeKey`).
4. **major** B19 Provider buttons read "Continue with Continue with Google" and lost brand icons and descriptions. Hint: `login/LoginPage.tsx:137-147`, use `p.label` verbatim; add a small icon map for google/github/gitlab and the description line.
5. **major** A45 `/compare` and `/reviews` lose the project context (no project nav, breadcrumb `Projects / Compare`, Runs not highlighted). Hint: in `AppShell.tsx:36` fall back to `readLocal(KEYS.lastProjectSlug)` when the route has no slug and the page is `compare`/`reviews`/legacy run.
6. **major** A25 "Back to projects" / "All projects" is `<button><a>`; Enter/padding clicks do nothing. Hint: `NotFound.tsx:14`, `ProjectNotFound.tsx:47`, use `<LinkButton to="/" variant="accent">`.
7. **major** F1 Raw JSON in error toasts for 422 (empty prompt save, others). Hint: `lib/http.ts:145`.
8. **major** E17 Remove-member dialog ignores `owned_deleted_runs`, does not list the keys that will be revoked, offers transfer on an archived project. Hint: `settings/MembersTab.tsx:162-182`.
9. **minor** A21 Topbar breadcrumb and KPI chips collide at 768-900 px. Hint: give `.stats` `flex: 0 1 auto; min-width: 0` and let the breadcrumb keep a min width, or drop chips below 1000 px (`chrome/TopbarStatsBar.module.css`, `AppShell.module.css`).
10. **minor** C3 "1 runs / 1 members" on project cards. Hint: `projects/ProjectsPage.tsx:113-116`.
11. **minor** D6 Bootstrap token shown in clear text; make the field `type="password"` (`ProfilePage.tsx:142`).
12. **minor** B15 Temporary password stored in `sessionStorage`; keep it in component state (`LoginPage.tsx:187-188, 240`).
13. **minor** B11 / B14 Login errors not cleared on typing; confirm field not refocused after a mismatch (`LoginPage.tsx:154, 251`).
14. **minor** B5 Restore "Forgot your password? Ask an admin to reset it." and the field placeholders on the sign-in form (`LoginPage.tsx:206-235`).
15. **minor** E13 Combobox empty/error/has-more messages ("Everyone is already a member", "No one outside the project matches ...", "Keep typing to narrow the list", search failure) (`MembersTab.tsx:285`, use `candidates.data.has_more` and `candidates.isError`).
16. **minor** E9 Show the correction review rules read-only to plain members, with the explanatory copy (`GeneralTab.tsx:92`).
17. **minor** E5 Restore the archived-settings note describing what still works per role (`ProjectSettingsPage.tsx`).
18. **minor** E29 Handle failure of "Set default" (`LlmConnectionsTab.tsx:95-101`, add `.catch` toast).
19. **minor** E11 / E25 Restore the members "Added" column and the read-token prefix/creator columns.
20. **minor** E32 / E33 / E19 Restore secondary copy: LLM "Test" while editing, "https:// base URL" help, key-modal env-var warnings, Copy as the initial focus in the secret dialog.
21. **minor** E44 / E45 / E46 Restore the Archive/Unarchive/Delete copy details (Trash purge pause, started-at formatting, "Archive anyway"/"Unarchive anyway", readable delete counts).
22. **minor** C7 Arabic project name produces an Arabic slug that the server rewrites to `project` (`dialogs/CreateProjectDialog.tsx:10-16`).
23. **minor** A10 / B24 Brand: logo images replaced by a text mark ("ق qym"); confirm with design.
24. **minor** A35 / A36 Optional: navigation progress indicator and run-detail prefetch (brief verdict NICE, not ported and not logged as dropped).
25. **minor** A14 Escape in the project switcher with text typed needs two presses (SearchField clears first).
26. **minor** A22 Archived project shows three read-only signals in the topbar/banner (badge, "Read-only" tag, banner); pick one or two.

## Deferred

- A35 navigation progress bar: not applicable as such. The old bar covered a full-page MPA navigation; in the SPA every route is a `lazyPage` Suspense boundary or a query with a skeleton (shown after the 300 ms wait), and the data router has no loaders, so `useNavigation()` never leaves idle. Re-open only if a route gains a loader. Estimate if wanted anyway: 0.5 day (Suspense-aware indicator).
- A36 run-detail prefetch on click: lives in the runs list / run-detail files (other agents' area). Estimate 0.25 day (`queryClient.prefetchQuery` on row `pointerdown`).
- E32 "Test" inside the LLM edit form: needs a test-with-unsaved-values endpoint decision (the server only tests saved connections). 0.5 day.
- E19 Copy as initial focus in the secret dialog: needs an `initialFocus` prop on the shared `Dialog` primitive. 0.25 day. (The env-var warnings were restored.)
- E44 / E45 / E46 Archive / Unarchive / Delete copy details (Trash purge pause, started-at formatting, "Archive anyway" labels, delete counts): copy-only, left for a design pass. 0.5 day.
- E17 transfer-in-archived and `owned_deleted_runs` are covered by a mocked-preview e2e only (no seed path for a member who owns only deleted runs).

## Not verified

- The existing Playwright suite was not re-run (it boots its own platform on 8800/5800 and eval stubs on 8900+, outside the ports allowed for this QA run).
- E17 transfer-in-archived and `owned_deleted_runs` behaviour: read from code; I could not seed a member who owns only deleted runs.
- E42 prompt tablist orientation below 900 px, GitLab/SSO provider rows, the OIDC callback round trip, and axe on every settings tab were not exercised.
- Topbar stats "blank on reload" (CUTOVER) did not reproduce in three reloads at 768/900/1280 px.
