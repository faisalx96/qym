# App shell, authentication, navigation, projects, profile, project settings — migration brief

Written by an analysis agent for the React/TypeScript/Vite migration. Audience: the
FOUNDATION agent (router, API client, auth guard, shell) and the component agents that
rebuild Projects, Profile and Project Settings in `frontend/`. Every path below is
relative to `packages/platform/qym_platform/` unless it starts with `docs/`, `tests/`
or `/`. Line numbers are from branch `UI-redesign` at commit `f3fab1a`.

Scope note: this brief owns the **shell** (sidebar, topbar, breadcrumbs, project
switcher, user menu, toasts, dialogs, drawer, skeletons, in-app navigation, auth
redirect), the **login page**, the **projects landing**, the **profile page** and the
**project settings page**. The Runs list that `index.html` + `dashboard.js` render
belongs to another brief; only the shell-integration parts of `dashboard.js` are
covered here. The Environments tab of Project Settings is mounted from
`eval_environments.js` (experiments area) and is only inventoried here.

---

## 1. Surface inventory

| Page / route | HTML file (`_static/dashboard/`) | JS / CSS it loads (in order) | Entry function(s) | approx LOC |
|---|---|---|---|---|
| `GET /login` (`api/auth.py:160-184`) | `login.html` (837) | `dashboard.css`, inline `<style>` (login-only, ~435 lines), `ui_components.css`, `qym_safe.js`, `ui_components.js` (defer). **Does not load `shell.js`/`auth.js`** (no shell on the login page). | inline IIFE `bootstrap()` → `render()` (`login.html:485-834`); server substitutes `__QYM_LOGIN_BOOTSTRAP_JSON__`, `__QYM_ROOT_PATH_JSON__`, `__QYM_PREFIX__`, `<!--__QYM_LOCAL_AUTH_MARKER__-->` | ~350 JS |
| `GET /` (projects landing, `api/runs.py:2220-2228`) | `projects.html` (184) | `dashboard.css`, `shell.css`, `qym_safe.js`, `auth.js`, `shell.js`, inline `<style>` (card grid), `ui_components.css`, `ui_components.js` | inline IIFE `load()` → `renderProjects()` (`projects.html:72-181`) | ~110 JS |
| `GET /projects/{slug}` (runs list, `api/runs.py:2231-2241`) | `index.html` (282) | shell trio + `kpis.js`, `ui_components.*`, `runs_order.js`, `metrics.js`, `qym_table.js`, `dashboard.js` | `dashboard.js` IIFE → `checkAuthAndInit()` (`dashboard.js:9916-9951`) | 10 006 (`dashboard.js`) — only shell hooks covered here |
| `GET /profile` (`api/runs.py:2244-2252`) | `profile.html` (335) | shell trio + inline `<style>`, `ui_components.*` | inline IIFE `loadProfile()` (`profile.html:196-333`) | ~130 JS |
| `GET /projects/{slug}/settings` (`api/runs.py:2411-2421`) | `project_settings.html` (1993) | shell trio + inline `<style>` (~200 lines), `eval_environments.css`, `eval_official_defaults.css`, `ui_components.*`, `eval_environments.js`, `eval_temporary_model.js`, `experiment_launch_advanced.js`, `experiment_launch_json.js`, `experiment_launch.js`, `eval_official_defaults.js` | inline IIFE `load()` → `render()` (`project_settings.html:505-1909`) | ~1 400 JS |
| Shell (every dashboard page) | — (DOM built at runtime) | `shell.js` (2 950), `shell.css` (1 028), `auth.js` (159), `qym_safe.js` (265), `qym_live.js` (89, only on pages that poll) | `shell.js` `init()` (`shell.js:2346-2459`) on `DOMContentLoaded`; `auth.js` `injectLogoutMenuItem()` on `DOMContentLoaded` | 4 491 |
| 404 project page (`api/runs.py:1393-1422`) | inline HTML string in Python | `dashboard.css`, `shell.css`, `qym_safe.js`, `auth.js`, `shell.js` | shell `renderProjectNotFound()` replaces the body once `/v1/me` answers (`shell.js:421-440`) | — |

Other HTML routes that use the same shell but belong to other briefs (listed so the
router mirrors them): `/projects/{slug}/overview|charts|models|experiments|experiments/queue|datasets|datasets/{ref:path}|analysis|reviews|runs/{run_id:path}|runs/{run_id:path}/analyzer`, `/run/{run_id:path}`, `/run/{run_id:path}/analyzer`, `/compare`, `/reviews`, `/trash`, `/admin`, `/docs-guide` (all in `api/runs.py:2220-2498`).

---

## 2. User journeys (as-is)

### J1. Sign in (session auth: `QYM_AUTH_MODE=oidc` or `QYM_AUTH_LOCAL_ENABLED=true`)
1. User opens any dashboard URL. `api/runs.py:_maybe_redirect_to_login` (1371-1390) sees no valid session cookie → `303` to `{root}/login?next=<path+query, url-encoded>`. `sanitize_next` (`auth_oidc.py:115-132`) only accepts same-site absolute paths (rejects `//`, `\`, control chars, schemes).
2. `GET /login` (`api/auth.py:160-184`): if already signed in → `303` to `next`. Otherwise serves `login.html` with the bootstrap payload inlined as `window.__QYM_LOGIN_BOOTSTRAP__` = `{auth_mode, providers:[{id,label,enabled,kind,coming_soon?}], local_auth:{enabled, signup_enabled}}` and `window.__QYM_ROOT_PATH__`. The same payload is available as `GET /v1/auth/providers` (`auth.py:187-190`).
3. First inline script clears `sessionStorage` (`login.html:476-483`) so the previous user's per-tab state (runs selection, filters, compare hand-off) is gone.
4. `render()` shows, in order: the email/password form (if `local_auth.enabled`), a "New to qym? Create an account" toggle (only if `signup_enabled`), an "Or continue with" divider, then one `<a>` per enabled provider pointing at `{root}/v1/auth/login/{provider}?next=<next>` (Google, GitHub, GitLab; "SSO" is `enabled:false, coming_soon:true` and never rendered as enabled). If nothing is enabled: "No login methods are configured for this deployment."
5. Password sign-in: `POST /v1/auth/login/password?next=…` body `{email,password}` (`auth.py:214-237`).
   - `200 {ok:true, next}` → `window.location.href = sameOriginTarget(next)`.
   - `403 {detail, code:"password_change_required"}` → form switches to **change-password mode** (`login.html:556-575`): new password + confirm; submits `POST /v1/auth/password/change` body `{email, current_password:<temporary>, new_password}` (`auth.py:240-287`). Client-side checks: match, ≥8 chars, must differ from temporary. `401` here means the temporary password was consumed/reset → back to sign-in with a message.
   - `401 {detail:"Invalid email or password"}`, `429` (login throttle, `login_throttle.py`) → error shown in `.auth-status[role=status]`, password field cleared and focused.
6. Sign-up (`POST /v1/auth/signup/password`, body `{email,password,display_name}`, `auth.py:290-357`): `201 {ok,next}`, `403` when sign-up is off (only open while no active admin exists), `409` email taken, `400` weak password.
7. OIDC: `GET /v1/auth/login/{provider}?next=` stores `next` in the session and redirects to the IdP (`auth.py:193-201`); `GET /v1/auth/callback/{provider}` provisions/links the user and `303`s to `next` (`auth.py:204-215`). GitLab is self-hosted OIDC via `QYM_AUTH_GITLAB_URL` discovery (`auth_oidc.py:351-360`, `settings.py:54-56`).
8. Success state: full page navigation to `next`. Keyboard: native form; `Enter` submits. No deep-link state other than `?next=`.

### J2. Shell boot on any dashboard page (full load)
1. `shell.js` runs in `<head>`: adds `html.qym-shell-pending` (+ `-collapsed` if `localStorage['qym:sidebar-collapsed']==='1'` or viewport ≤760px) so `shell.css:41-66` paints a placeholder frame and hides the bare body for up to 4 s.
2. On `DOMContentLoaded` `init()` (`shell.js:2346`): parses the route (`parseRoute`, 142-204), reads the cached `/v1/me` snapshot from `localStorage['qym:me']` (53-81), builds `#qym-app > aside#qym-sidebar + div.main-area > (header.topbar + div#shell-archived-notice + main#shell-content)`, **moves every existing body child into `#shell-content`**, appends `#shell-toast-container`, restores collapse state, sets active nav, paints the cached user and project name, renders breadcrumbs and remembered topbar stats, expands `[data-qym-skeleton]` markers, removes the pending class, binds events, installs link interception + `popstate`, then calls `fetchUserAndProjects()`.
3. `GET /v1/me` (`api/web.py:40-80`). `401` → `forgetCachedMe()` + `QymAuth.redirectToLogin()`. Otherwise `_user`/`_projects` are set, `localStorage['qym:me']` is refreshed with `{role, display_name, email, projects:[{slug,name}]}`, `window.__QYM_USER__` is exposed, user menu/admin nav are populated, and if the URL names a project not in `me.projects` the shell tries `GET /v1/projects/by-slug/{slug}` — if that returns `is_active:false` it becomes a read-only "archived" context (`loadArchivedProject`, 344-356), else `renderProjectNotFound()` replaces the content. Finally `document.dispatchEvent('qym:shell-ready')`.
4. Pages wait for `qym:shell-ready` if `window.__QYM_USER__` is not yet set (`projects.html:75-77`, `dashboard.js:9924-9926`).

### J3. In-app navigation (click a link / switch project / Back)
1. A click on any `#qym-app a[href]` that is same-origin, unmodified, not `download`/`_blank`, matches `isNavigableAppPath` (`shell.js:240-259`) and differs from the current URL is intercepted (`interceptNavClicks`, 2197-2217) → `navigateTo(url)`.
2. `navigateTo` (1878-1921): saves scroll offsets into `history.state.qymScroll`, dispatches `qym:before-navigate` (pollers and page teardown hooks listen), aborts the page's `AbortController` (`pageSignal`), closes popovers, sets `.is-navigating` on `#shell-content` (progress bar in `shell.css:480-499`), prefetches `GET /api/runs/{id}?view=compact` when the target is a run page, then `fetchAndSwap`.
3. `swapPage` (1939-2082): fetches the target HTML with `credentials:'same-origin'`, parses it with `DOMParser`, resolves relative asset URLs against the target URL, sets `document.title`, strips `shell.js`/`auth.js` script tags, collects every other `<script>` from head+body, pre-loads them with `<link rel=preload>`, **adopts the fetched page's `<link rel=stylesheet>`s that the document lacks** (by file name; inserted before `ui_components.css` if the fetched page had them before it; waits ≤4 s for load; one retry; this is commit `3b3d703`), replaces `style[data-shell-page]` with the fetched `<head><style>` blocks, `replaceChildren` on `#shell-content`, `history.pushState({qym:true}, '', url)` (unless `historyMode:'none'`), re-parses the route, re-renders breadcrumbs/active nav/archived notice, resets `scrollTop`, sets `window.__QYM_USER__`, **executes the page scripts sequentially** (so every page IIFE re-runs on every visit), then dispatches `qym:shell-ready`. A failed fetch falls back to `window.location.href = url`.
4. `popstate` → `qym:popstate` (cancelable; pages may handle it) → `navigateTo(location, {historyMode:'none'})` and `restoreScrollPositions()` replays saved offsets for up to 6 s until they hold.
5. Project switch: breadcrumb trigger opens the popover (`renderProjectList`, 755-787) with a search box (focused on open) and a "Create Project" footer; selecting an item calls `switchProject(slug)` (1590-1595) → `localStorage['qym:last-project-slug']=slug` (not for archived) + `navigateTo(/projects/{slug})`.
6. Persisted: `qym:sidebar-collapsed` (localStorage), `qym:last-project-slug` (localStorage), `qym:me` (localStorage), `qym:topbar-stats:<path|family>` (sessionStorage), `history.state.qymScroll`. Keyboard: `Escape` closes project/user popovers (`bindEvents`, 1547-1555).

### J4. Projects landing (`/`)
1. Waits for shell user. Renders `user.projects` as a card grid (identicon, name, slug, role tag, member/run counts, created/updated).
2. Search box filters client-side by name/slug on `input`.
3. "New Project" button is shown when `role==='ADMIN'` or any project has `role==='MANAGER'`; opens the shell's Create Project dialog (`openCreateProjectDialog`, `shell.js:870-962`): name + slug (slug auto-derived from name until edited), `Enter` submits, `POST /v1/projects` `{name,slug}` → on success `upsertProject(data)` + `navigateTo(/projects/{slug})`; error text inline (`detail`).
4. Empty: "No projects yet". Error: `err.message` in the grid. No URL state. Cards are `<a>` → intercepted navigation.

### J5. Profile (`/profile`)
1. `GET /v1/me` directly (not the shell cache). Renders Account grid (Display Name, Email, Global Role, Default Project), the Projects list (name, slug, role pill, Open, Settings links) and the **Grant Admin Access** panel when `me.can_bootstrap_admin && me.role!=='ADMIN'`.
2. Bootstrap: `POST /v1/auth/bootstrap-admin` `{bootstrap_token}` (`auth.py:371-395`) → `200` → "Admin access granted. Refreshing…" + `window.location.reload()`; `403` invalid token; `409` admin already exists. `Enter` in the token field submits.
3. No edit of display name/title exists in the UI (there is no `PATCH /v1/me`).

### J6. Project Settings (`/projects/{slug}/settings[?tab=…]`)
1. Loads in parallel `GET /v1/me` and `GET /v1/projects/by-slug/{slug}`, then members, API keys, (admins) dataset read tokens, (managers) analysis prompts, LLM connections; mounts the Environments panel (`QymEvalEnvironments.mountEnvironmentsPanel`); then reveals the page in one fade (`QymShell.reveal`).
2. Tabs (`role=tablist`, click only, no arrow keys): General, Members, API Keys, LLM Connections, Environments, AI Prompts (hidden unless manager/admin), Danger Zone (hidden unless admin). `?tab=<id>` selects a tab once (`openFromUrl`, 617-641; also `project_settings.html:1878-1882`). `?tab=environments&env=<id>&promote=saved|run|job&id=<src>` opens the default-preset editor prefilled and is removed from the URL with `history.replaceState`.
3. General: rename (admin only, `PATCH /v1/admin/projects/{id}` `{name}`), `Enter` saves, `QymShell.upsertProject(updated)` keeps breadcrumb/switcher in sync, toast. Correction review rules (manager/admin): `PATCH /v1/projects/{id}/review-rules`. Overview card: slug, role, member count, status.
4. Members: combobox search (`GET /v1/projects/{id}/member-candidates?limit=20&q=`, debounced 200 ms, arrow keys/Enter/Escape, `aria-activedescendant`), role select, Add (`POST …/members`), per-row role select + Save (`PATCH …/members/{uid}`), Remove → page-local shell-recipe dialog that first fetches `GET …/members/{uid}/removal-preview` and offers to transfer owned runs (`DELETE …/members/{uid}?transfer_runs_to=`); destructive dialog opens focused on Cancel.
5. API Keys: name + Create (`POST …/api-keys` → `{id,prefix,token}`) → **key modal** shows the token once with Copy (clipboard + toast) ; Revoke → confirm dialog → `DELETE …/api-keys/{key_id}`. Dataset read tokens (admin): same pattern against `…/dataset-read-tokens` (revoke uses `window.confirm`).
6. LLM Connections: table (name, default tag, "Analysis only" tag, model, endpoint, key hint), Set default / Test / Edit / Delete; inline add/edit form at the bottom (`POST`/`PUT …/llm-connections[/id]`, key sentinel `"__KEEP__"` on edit); Test shows a spinner and toasts `“name” connected · model` or the `detail`.
7. AI Prompts: vertical tablist (arrow keys/Home/End handled), textarea editor, Custom/Default badges, "View diff" vs shipped default (LCS diff client-side, capped at 24 000 cells), Restore default (confirm), Save (`PATCH …/analysis-prompts/{key}` `{value}`), "● Unsaved changes" indicator, character count + relative "edited" time refreshed every 60 s.
8. Danger Zone (admin): Archive (`QymShell.confirmArchiveProject` → `GET /v1/admin/projects/{id}/archive-preview` lists running runs → `POST …/archive` → `removeProject` + toast + `navigateTo('/')`), Unarchive (`confirmUnarchiveProject` → `…/unarchive-preview` lists active keys, "Revoke keys first" alt action jumps to the API Keys tab → `POST …/unarchive`), Delete (`GET …/deletion` preview → if blocked offers "Archive instead" or "Open Deleted Runs"; else type-the-name confirm → `DELETE /v1/admin/projects/{id}?confirm=<name>`).
9. Archived project: every mutation control is hidden/disabled; the shell shows the read-only banner; allowed actions are revoke keys, remove members, unarchive/delete (admin). Server answers `409` to writes (`permissions.py:32`).

---

## 3. Functional inventory

### 3.1 Shell chrome
| Feature | Where | Verdict |
|---|---|---|
| Sidebar: logo link to `/`, global items (Projects, Docs), project items (Dashboard=overview, Charts, Runs, Models, Experiments, Auto-analysis, Reviews, Datasets, Project Settings), "Platform" section (Admin with "Admin" badge, Deleted Runs) shown only when `sidebar[data-user-role=ADMIN]` (`shell.css:282-298`, `populateUser` 806-809) | `buildSidebarHTML` 538-612 | MUST-KEEP — primary navigation |
| `.no-project` state hides project items and the breadcrumb switcher (`shell.css:537-541`); `.project-archived` hides Auto-analysis and Reviews (`shell.css:547-548`) | 301-333 | MUST-KEEP |
| Collapse toggle (topbar button), persisted in `qym:sidebar-collapsed`, auto-collapsed ≤760px, tooltips via `data-tooltip` when collapsed | 1562-1584 | MUST-KEEP |
| Active nav item from route with parent mapping (`run-detail`→runs, `compare`→runs, `experiments-queue`→experiments, `analyzer`→analysis) | 731-749 | MUST-KEEP |
| Topbar: breadcrumbs (`project switcher / page` or `Runs / <run id>` or `Experiments / Queue` or `<run id> / Auto-analysis`) | 652-724 | MUST-KEEP (simplify: React Router gives the hierarchy) |
| Project switcher popover in breadcrumb: search, identicon, archived tag, check mark, "Create Project" footer; opens via click, closes on outside click/Escape | 755-855 | MUST-KEEP |
| Topbar stats (`QymShell.setTopbarStats(stats,{scope})`), remembered per URL family in sessionStorage, 5 s grace while the page reloads | 2223-2292 | NICE — pages' KPIs in the header; keep API, drop sessionStorage replay if React Query cache gives the same effect |
| User footer: avatar initials, name, email; popover with role, Profile link, Sign Out | 582-611, 1513-1531 | MUST-KEEP |
| `auth.js` injects a "Logout" button into `.menu-nav` (legacy; no page has `.menu-nav` any more) | `auth.js:107-130` | DROP-CANDIDATE — dead code |
| Archived read-only banner between topbar and content | 365-374, `shell.css:550-561` | MUST-KEEP |
| Project Not Found panel (client) + server 404 page | 421-440, `api/runs.py:1393` | MUST-KEEP (one React component) |
| Pending-frame placeholder before init (`html.qym-shell-pending`) | 24-36, `shell.css:35-66` | DROP — a React shell renders synchronously; keep only a `visibility` guard until the auth query settles |
| Cached `/v1/me` snapshot (`qym:me`) for first paint of name/role/project names | 53-91 | NICE — can be replaced by React Query `persistQueryClient` or dropped; **must** be cleared on logout if kept (`auth.js:70`) |

### 3.2 Navigation engine
| Feature | Where | Verdict |
|---|---|---|
| Link interception limited to the allow-list of app paths | 240-281 | MUST-KEEP semantics (React Router `<Link>`); external/download/`_blank`/modified clicks untouched |
| Fetch-parse-swap of full HTML; re-execution of page scripts; stylesheet adoption | 1939-2174 | DROP — replaced by SPA routing. Keep the *behaviours*: title per route, scroll reset on push, scroll restore on pop, in-flight indicator, "latest click wins" |
| Prefetch of run detail JSON on click | 1853-1876 | NICE — React Query `prefetchQuery` on link hover/click |
| Scroll offsets per history entry (nested scroll containers, up to depth 4) | 1677-1795 | NICE — implement for `#shell-content` + table scrollers with a `useScrollRestoration` keyed by `location.key` |
| `qym:before-navigate`, `pageSignal()` AbortController, `onPageUnmount` | 1604-1631 | DROP — React effects/cleanup replace this |
| `qym:run-status` document event + `BroadcastChannel('qym-run-status')` cross-tab | 1637-1664 | MUST-KEEP — admin force-stop / cancelled job must reach every open runs page; port as a tiny event bus + `BroadcastChannel`, consumers invalidate queries |
| `replaceUrlQuery(updates)` (view state lives in the query string) | 1800-1815 | MUST-KEEP as a `useSearchParamsState` helper |
| `copyText` with `execCommand` fallback | 1818-1838 | MUST-KEEP (shared util) |
| Progress bar while navigating (`.is-navigating`) | `shell.css:480-499` | NICE — tie to `useNavigation().state` or pending queries |
| Root-path prefix handling (`window.__QYM_ROOT_PATH__`, `getAppRootPath` regex fallback, `apiUrl`) | 97-140, `auth.js:13-45`, `dashboard.js:26-56` | MUST-KEEP — platform can be mounted under `QYM_ROOT_PATH` (`main.py:12-50`); Vite `base` + Router `basename` must come from the injected value |

### 3.3 Auth plumbing
| Feature | Where | Verdict |
|---|---|---|
| `QymAuth.redirectToLogin(next)` → `{root}/login?next=<current path+query>` | `auth.js:49-56` | MUST-KEEP |
| `QymAuth.handle401(res)` used by pages after each fetch | `auth.js:76-82`, e.g. `profile.html:201`, `project_settings.html:561` | MUST-KEEP — central in the API client |
| `QymAuth.logout()` → `POST /v1/auth/logout` (`auth.py:360-364`) then clear `qym:me` then redirect to `/login?next=/` | `auth.js:58-69` | MUST-KEEP |
| `renderAuthGate(el,{title,message})` inline "Sign in" panel (dashboard.js fallback when no shell) | `auth.js:84-105`, `dashboard.js:8722-8734` | DROP-CANDIDATE — in the SPA a 401 always redirects |
| Every fetch is same-origin cookie auth; no bearer token in the UI; `credentials:'same-origin'` passed explicitly in some places, defaulted elsewhere | everywhere | MUST-KEEP — one client sets it once |
| Admin bootstrap token entry on Profile | `profile.html:232-291` | MUST-KEEP |

### 3.4 Dialog / toast primitives (shell-provided, used by every area)
| Primitive | Where | Verdict |
|---|---|---|
| `QymShell.toast(message, type?, {action:{label,onClick}, duration})` — `role=alert` for `error`, else `status`; 4 s default, min 1 s; optional one-shot action button (Undo) | 2300-2340 | MUST-KEEP (one `<Toaster>`; API parity) |
| `openConfirmDialog({title, description: string|string[], warning:{lead,text,items:[{title,meta}],more,itemsLabel}, note, requireText, inputLabel, inputPlaceholder, mismatchMessage, cancelLabel, altLabel, confirmLabel, confirmClass, danger, mount})` → `Promise<{confirmed, value, alternative?}>`; destructive dialogs focus Cancel | 964-1103 | MUST-KEEP |
| `confirmArchiveProject(project)` / `confirmUnarchiveProject(project)` — preview-fetching confirm flows shared by Project Settings and Admin › Projects | 1118-1224 | MUST-KEEP (shared hook `useArchiveProjectDialog`) |
| `openFormDialog({title, description, details:[{icon,title,body}], fields:[{name,label,type:text|textarea|select|checkbox,value,options,placeholder,help,required,validate,rows}], width, confirmLabel, cancelLabel, confirmClass, submittingLabel, onSubmit(values)})` → `Promise<{confirmed, values}>`; Enter submits from single-line inputs; async `onSubmit` keeps the dialog open on error | 1230-1395 | MUST-KEEP (generic `<FormDialog>`) |
| `openDrawer({title, subtitle, width, headerActions:[{icon,label,tooltip,onClick}], render(api), onClose, onKey, dismissOnBackdrop})` → `{setTitle,setSubtitle,setBody,setFooter,setActions,close,el,body,footer}`; dispatches `qym:drawer-open/close` | 1401-1501 | MUST-KEEP (right-side `<Drawer>`) |
| `openCreateProjectDialog()` | 870-962 | MUST-KEEP |
| Focus contract via `QymUIComponents.openDialog/releaseDialog` (`ui_components.js:1059-1120`): role/aria-modal/labelledby auto, focus moved in, Tab trapped, Escape, focus returned to trigger, dialog stack | — | MUST-KEEP — use Radix Dialog / React Aria which give the same guarantees |

### 3.5 Loading / arrival system
`skeletonHTML(kind: table|cards|list|lines|chart|value, opts)`, `[data-qym-skeleton]` markers expanded before first paint, `liftSkeleton`, `arrive`, `arriveWith`, `reveal`, `watchArrivals` (`MutationObserver`), `pendingArrival`, 300 ms delay / 400 ms minimum / 200 ms fade timing constants (`shell.js:2591-2893`, `shell.css:913-1028`). Verdict: **NICE** — keep the timing rules (no flash under 300 ms, min 400 ms once shown, fade only where a seen skeleton leaves) as a `<Skeleton>` + `useDelayedPending` hook; drop the DOM-observer machinery.

### 3.6 Misc shell exports used by other areas
`identiconHTML(seed,{cell,gap,showEmpty,chip,className})` / `identicon()` (FNV-1a hue + symmetric 5×5, `shell.js:2509-2557`) — MUST-KEEP as `<Identicon>`; `datasetVersionInline`, `datasetAliasTags` (2561-2577) — belong to the datasets brief; `getUser`, `getProject`, `getRememberedProject`, `getPageContext`, `setPageProject(project)` (run pages reached via legacy `/run/{id}` tell the shell their project, 390-419), `upsertProject`, `removeProject`, `projectExists`, `isProjectArchived`, `setBreadcrumbs`, `apiUrl`, `navigateTo`, `switchProject`, `toggleSidebar`.

### 3.7 Hidden behaviours
- **Polling, not SSE.** There is no `EventSource` anywhere in the dashboard. Live data is `QymLive.poll(loader,{intervalMs≥250, maxIntervalMs, immediate, onError})` (`qym_live.js`): visibility-aware, exponential back-off on error, stops on `qym:before-navigate`; and `dashboard.js` has its own `setInterval` cadence (2 s live / idle / 15 s back-off, `dashboard.js:9962-9998`). The SDK's `/ui` app and `/v1/runs/{id}/events` are the SDK ingest path, not browser SSE.
- `login.html` clears `sessionStorage` on load.
- `history.scrollRestoration='manual'` is set globally (`shell.js:2442`).
- `NoStoreMiddleware` (`middleware/cache_control.py`) sets `Cache-Control: no-store` on every non-`/static`, non-`/ui` response, so Back after sign-out never shows cached pages.
- Same-origin write guard (`app.py:200-215`): under session auth every `POST/PUT/PATCH/DELETE` without a Bearer header must carry an `Origin` matching `QYM_BASE_URL` (or a matching `Referer`); otherwise `403 {"detail":"Cross-origin request blocked"|"Missing same-origin headers"}`. **This is what breaks a Vite dev server on another origin** (see §8).
- Session cookie `qym_session` (Starlette `SessionMiddleware`, `same_site=lax`, `https_only` outside dev/test/local, `max_age` 14 days, re-signed on each response; server-side `UserSession` row is checked on every request and touched every 10 min, `auth_oidc.py:21-33, 158-247`).

---

## 4. Data & API contract

Auth for every route below: session cookie (`require_ui_principal`, `auth.py:235-291`) — or, depending on `QYM_AUTH_MODE`, `X-User-Email`/`X-Email` proxy headers, or `none` (auto "dev@local" ADMIN). Error envelope is FastAPI's `{"detail": string}`; `422` from `validation_errors.py` never echoes submitted keys. Timestamps are ISO-8601 strings (`to_api_timestamp`). No pagination on any route in this area except `member-candidates` (`limit`, `has_more`).

| Method | Path | Query / body | Response shape | Used by | Route |
|---|---|---|---|---|---|
| GET | `/v1/me` | — | `{id, email, display_name, title, role:"ADMIN"|"MEMBER", auth_type:"api_key"|"proxy_headers"|"oidc"|"local_password"|"none", auth_provider, needs_admin_bootstrap:bool, can_bootstrap_admin:bool, projects: Project[] (active only, admins: all active), default_project: Project|null}` | shell, profile, settings, dashboard.js (23 call sites) | `api/web.py:40-80` |
| GET | `/v1/auth/providers` | — | `{auth_mode, providers:[{id,label,enabled,kind,coming_soon?}], local_auth:{enabled,signup_enabled}}` | login (inlined today) | `api/auth.py:187` |
| GET | `/v1/auth/login/{provider}` | `?next=` | 302 to IdP | login | `auth.py:193` |
| GET | `/v1/auth/callback/{provider}` | IdP params | 303 → next | browser | `auth.py:204` |
| POST | `/v1/auth/login/password` | `?next=`; `{email,password}` | `200 {ok,next}` / `403 {detail,code:"password_change_required"}` / `401` / `429` / `400` | login | `auth.py:214` |
| POST | `/v1/auth/password/change` | `?next=`; `{email,current_password,new_password}` | `200 {ok,next}` / `401` / `400` | login | `auth.py:240` |
| POST | `/v1/auth/signup/password` | `?next=`; `{email,password,display_name}` | `201 {ok,next}` / `403` / `409` / `400` | login | `auth.py:290` |
| POST | `/v1/auth/logout` | — | `{ok:true}` | auth.js | `auth.py:360` |
| POST | `/v1/auth/bootstrap-admin` | `{bootstrap_token}` | `{ok,user_id,role}` / `403` / `409` | profile | `auth.py:371` |
| GET | `/v1/projects` | — | `{projects: Project[]}` (admins: incl. archived) | (not used by this area's pages; admin) | `projects.py:824` |
| POST | `/v1/projects` | `{name, slug?}` | `Project` / `403` / `400 slug exists` | shell create dialog | `projects.py:842` |
| GET | `/v1/projects/by-slug/{slug}` | — | `Project` / `403` / `404` | shell (archived lookup), settings | `projects.py:888` |
| GET | `/v1/projects/{id}` | — | `Project` | — | `projects.py:900` |
| GET | `/v1/projects/{id}/members` | — | `{members: Member[]}` | settings | `projects.py:910` |
| GET | `/v1/projects/{id}/member-candidates` | `?q=&limit=20` | `{users:[{id,email,display_name}], has_more}` / `403 Manager only` | settings | `projects.py:932` |
| POST | `/v1/projects/{id}/members` | `{user_id, role:"MEMBER"|"MANAGER"}` | `Member` / `400 already` / `409 archived` | settings | `projects.py:971` |
| PATCH | `/v1/projects/{id}/members/{uid}` | `{role}` | `Member` / `409 last manager` | settings | `projects.py:1061` |
| GET | `/v1/projects/{id}/members/{uid}/removal-preview` | — | `{project_id,user_id,owned_runs,owned_deleted_runs}` | settings | `projects.py:1103` |
| DELETE | `/v1/projects/{id}/members/{uid}` | `?transfer_runs_to=<uid>` | `{ok,project_id,user_id,revoked_api_keys,transferred_runs,runs_transferred_to}` | settings | `projects.py:1179` |
| PATCH | `/v1/projects/{id}/review-rules` | `{correction_approvers:"members"|"managers", correction_require_different_reviewer:bool}` | `{project_id, correction_approvers, correction_require_different_reviewer}` | settings | `projects.py:1016` |
| GET | `/v1/projects/{id}/api-keys` | — | `{api_keys:[{id,name,prefix,project_id,creator:{id,email,display_name},scopes,created_at,revoked_at}]}` | settings | `projects.py:1247` |
| POST | `/v1/projects/{id}/api-keys` | `{name?}` | `{id,prefix,token}` (token shown once) | settings | `projects.py:1282` |
| DELETE | `/v1/projects/{id}/api-keys/{key_id}` | — | `{ok,id}` / `400 already revoked` | settings | `projects.py:1308` |
| GET/POST/DELETE | `/v1/projects/{id}/dataset-read-tokens[/{token_id}]` | POST `{name?}` | `{tokens:[Token]}` / `{...Token, token}` / `{ok,id}`; admin only | settings | `projects.py:1358-1414` |
| GET | `/v1/projects/{id}/llm-connections` | — | `{connections: Connection[]}` | settings | `projects.py:557` |
| POST / PUT | `/v1/projects/{id}/llm-connections[/{cid}]` | `{name, llm_base_url, llm_model, llm_api_key:""|"__KEEP__"|key, available_for_experiments?}` | `Connection` | settings | `projects.py:571-627` |
| DELETE | `…/llm-connections/{cid}` | — | `{ok}` | settings | `projects.py:629` |
| POST | `…/llm-connections/{cid}/set-default` | — | `Connection` | settings | `projects.py:657` |
| POST | `…/llm-connections/{cid}/test` | — | `{ok,model,response}` / `400 {detail}` | settings | `projects.py:677` |
| GET | `/v1/projects/{id}/analysis-prompts` | — | `{prompts:{llm_analyzer,aggregator,rules_writer}, defaults:{…}, updated_at, …}` (manager+) | settings | `projects.py:735` |
| PATCH | `…/analysis-prompts/{key}` | `{value}` | same as GET | settings | `projects.py:784` |
| PATCH | `/v1/admin/projects/{id}` | `{name?,slug?,is_active?}` | `Project` (admin) | settings rename | `projects.py:1459` |
| GET | `/v1/admin/projects/{id}/archive-preview` | — | `{running_count, running_runs:[{run_id,run_name,started_at}]}` | shell confirm | `projects.py:1866` |
| POST | `/v1/admin/projects/{id}/archive` | — | `{ok,project_id,archived:true}` | settings | `projects.py:1726` |
| GET | `/v1/admin/projects/{id}/unarchive-preview` | — | `{active_api_key_count, active_api_keys:[{name,creator}]}` | shell confirm | `projects.py:1801` |
| POST | `/v1/admin/projects/{id}/unarchive` | — | `Project` | settings | `projects.py:1780` |
| GET | `/v1/admin/projects/{id}/deletion` | — | `{project_id,name,slug,archived,counts:{datasets,api_keys,members,llm_connections,rule_versions,analyzer_documents,…},can_delete,blocked_reason}` | settings | `projects.py:1917` |
| DELETE | `/v1/admin/projects/{id}` | `?confirm=<name|slug>` | `{ok,…}` / `400` / `409 has runs` | settings | `projects.py:1939` |
| GET … | `/v1/projects/{id}/eval-environments…` | see `api/eval_environments.py:685-1198`, `eval_presets.py:101-296` | — | settings Environments tab (experiments brief) | — |
| GET | `/healthz` | — | `{ok,service,env}` | — | `app.py:218` |

Types used above (from `projects.py:258-297, 352-362, 471-487`):
```ts
type Project = { id:string; name:string; slug:string; is_active:boolean; member_count:number; run_count:number;
  role:""|"MEMBER"|"MANAGER"; created_at:string; updated_at:string;
  correction_approvers:"members"|"managers"; correction_require_different_reviewer:boolean };
type Member = { user_id:string; email:string; display_name:string; role:"MEMBER"|"MANAGER"; is_active:boolean; created_at:string; updated_at:string };
type Connection = { id; project_id; name; llm_base_url; llm_model; llm_api_key_set:boolean; llm_api_key_hint:string; is_default:boolean; available_for_experiments:boolean; created_at; updated_at };
```
Client-side reshaping today: `/v1/me.projects` is the project list everywhere (no separate `/v1/projects` call for non-admins); `role` for admins is always `"MANAGER"` in payloads (`serialize_project_payloads`, 313-314) while `me.role==="ADMIN"` is the global flag; "can create project" is derived client-side (`projects.html:85`) from `role==='ADMIN' || projects.some(p=>p.role==='MANAGER')`, mirroring `_can_create_project` (`projects.py:338-350`).

HTML page routes and guards (`api/runs.py`): non-project pages call `_maybe_redirect_to_login` (1371); project pages call `_guard_project_page` (1425-1446) which resolves the slug through `project_for_read_by_slug` (`permissions.py:51-67`): unknown slug → 404 page; archived & no access → 404; active & no access → **403 raised as HTTPException** (JSON, not a page); `allow_archived=False` for `/analysis` and `/reviews` (archived → 404). `_dashboard_html_response` (1267-1283) rewrites `="/static/` → `="{root}/static/` and injects `<script>window.__QYM_ROOT_PATH__ = "<root>";</script>` into `<head>`.

---

## 5. Shared dependencies

| Primitive | Used here for | Defined by this area? |
|---|---|---|
| `qym_safe.js` `QymSafe.escapeHtml/html/raw/safeUrl/textDirAttrs` | every template string in shell, projects, profile, settings | No (shared); React escapes by default, keep `safeUrl`, `isRTL/textDirAttrs`, `looksLikeCode`, `renderMarkdown` as utils for the run/datasets areas |
| `ui_components.js` `openDialog/releaseDialog` | all shell dialogs, key modal, remove-member dialog | No; `renderErrorState` recipe (DESIGN_LANGUAGE §3 "Failed requests") is expected by every area |
| `ui_components.css` `.qym-control/.qym-search/.qym-tabs/.qym-tag/.qym-badge/.qym-inline-action/.qym-icon-action` | projects search, settings tabs/tags, login (`ui_components.css` is loaded but login uses its own classes) | No |
| `shell.js` (`QymShell.*`, §3.6) | **everything** | **Yes — exported to every other area** |
| `auth.js` (`QymAuth.*`) | 401 handling, logout, login URL | **Yes — exported** |
| `qym_live.js` (`QymLive.poll`) | not used by this area's pages; used by run/queue/experiments pages | shell-adjacent; port as `useVisibilityPolling` |
| `dashboard.js` | runs page; reads `QymShell.getProject/isProjectArchived/navigateTo/replaceUrlQuery/pageSignal/announceRunStatus`, `__QYM_USER__`, `qym:shell-ready`, `qym:before-navigate`, `qym:run-status` (`dashboard.js:13-16, 108-153, 8195-8210, 8622-8632, 9604-9605, 9878, 9924-9930, 10003-10009`) | consumer |
| `eval_environments.js` / `eval_official_defaults.js` / `experiment_launch*.js` | Environments tab in settings (mount API `mountEnvironmentsPanel({projectId, projectSlug, canManage, tbody, addButton, note, onGotoApiKeys, onEditOfficial, openEnv})`, `QymOfficialDefaults.openEditor({host, hide, project, me, env, fromVersion, promote, onPublished})`) | consumer (experiments brief owns them) |
| `kpis.js` | loaded by `index.html` for topbar stats | runs brief |

---

## 6. Design-token usage

Tokens (from `dashboard.css:8-60`, `docs/DESIGN_LANGUAGE.md` §1): surfaces `--bg-void/base/surface/elevated/hover/active`, borders `--border-subtle/default/strong`, text ramp `--text-primary/secondary/muted/dim`, `--accent-primary` (#00d4aa), `--success/--warning/--error/--info`, spacing `--space-xs..xl`, type `--font-xs..title`, `--font-sans/--font-mono`, `--control-radius`, `--radius-md`. `:root{color-scheme:dark}` — the dashboard is **dark only** (hard rule 9); there is no theme toggle and nothing reads `prefers-color-scheme` (only `prefers-reduced-motion` in `shell.css:500, 944, 1023`).

Shell-specific tokens in `shell.css:7-22`: `--sidebar-w:192px`, `--sidebar-collapsed-w:56px`, `--topbar-h:50px`, `--shell-font-xs..lg` (12/13/14/15/17 px — chrome runs 2 px larger than page type; "never redefine `--font-*` in a scope"). Constrained pages render in a 1120 px container (`shell.css:510`, DESIGN_LANGUAGE §4: settings, admin, profile, projects, overview); data-dense pages go full width. `html,body{overflow:hidden}` — `#shell-content` is the only page scroller (`shell.css:24-34, 468-479`). Breakpoints: ≤760px auto-collapse, ≤800px shell layout tweak (`shell.css:898`), ≤1199px topbar stats shrink (`shell.css:459`).

Area-specific CSS that should become component styles:
- Project card (`projects.html:14-47`) — mirrors the datasets `.dsx-card`; make one `<EntityCard>`.
- Settings `.card/.card-header/.card-body/.card-footer`, `.data-table`, `.add-bar`, `.form-grid/.form-group/.form-label/.form-input/.form-select` (`project_settings.html:26-103`) — generic Card, DataTable, FormField; the same patterns exist in admin.html.
- `.role-badge` (`project_settings.html:77-80`, `profile.html:88-98`) duplicates `.qym-tag--role` — keep only the shared tag.
- Key modal (`project_settings.html:84-93`) → `<SecretRevealDialog>`.
- Login card, provider buttons, shimmer (`login.html:10-446`) — self-contained login theme (gradients, grid overlay animation); keep as the login route's CSS module.
- Shell modal/drawer/toast recipes (`shell.css:583-900`) → Dialog/Drawer/Toast components.

Sanctioned exceptions relevant here: none for the shell; `_static/ui/` (SDK run UI) has its own light theme and must not share tokens (DESIGN_LANGUAGE §5). Rules are enforced by `tests/platform/test_design_language.py` — the React build output under `_static/` will be scanned, so the Vite build must emit token-based CSS (no hardcoded px font sizes outside the glyph allowlist, no `#fff` surfaces, mono only for data).

---

## 7. UX pain points observed

1. **Every page script re-runs on every in-app navigation** and must defend itself with `pageSignal`, global interval refs (`window.__QYM_DASHBOARD_INTERVAL__`), and `qym:before-navigate` teardown; leaks were the source of several fixes (`tests/platform/test_shell_reexecuted_scripts.py`). The stylesheet-carry bug fixed in `3b3d703` is a symptom of the same design.
2. Three copies of root-path/`apiUrl` logic (`shell.js:97-140`, `auth.js:13-45`, `dashboard.js:26-61`, plus inline copies in `projects.html`, `profile.html`, `project_settings.html`) with slightly different regex allow-lists; a route missing from one list (e.g. `/projects/x/experiments/queue` in `dashboard.js`) silently computes a wrong base.
3. `project_settings.html:1655` calls `QymShell.navigateTo('/')` with a non-prefixed path — wrong under `QYM_ROOT_PATH`.
4. Settings tabs are click-only (no Left/Right arrow handling on the main tablist, only on the prompt sub-tablist); tab state is not in the URL except as a one-shot `?tab=`.
5. `window.confirm` is still used for dataset-read-token revoke (`project_settings.html:1070`) while everything else uses the shell dialog.
6. Full `load()` re-fetch (5–6 requests) after every small mutation (role save, key revoke, member add).
7. Settings page uses `querySelectorAll('[data-member-save]').forEach(addEventListener)` on every render — handlers accumulate on re-render (`project_settings.html:1004-1014`).
8. Profile: "Default Project" is just `projects[0]` alphabetically (`web.py:62`); title and display name are not editable; the hero still says "API keys live inside each project's settings page" (migration copy).
9. Login: no "remember me", no forgot-password (by design: admin reset), error messages come from `detail` strings; the `.auth-status` live region is re-rendered wholesale on every keystroke after an error (fine) but the whole form is re-rendered via `innerHTML` on mode change, losing scroll/IME state.
10. a11y: sidebar nav items rely on `data-tooltip` when collapsed (no `aria-label`); `.topbar-toggle` has `title` only; project popover search has no label (`placeholder` only); breadcrumb current item is a `<span>` without `aria-current`; the user popover is toggled by a `<button>` without `aria-expanded/aria-controls`; popovers close on outside click/Escape but have no focus trap (acceptable for menus, but focus does not return to the trigger).
11. The 4 s `qym-shell-pending` guard and the `qym:me` localStorage snapshot exist to hide layout shift that a client-rendered shell would not have.
12. Project Not Found exists in two forms (server HTML 404 vs. client replacement) with different copy.
13. Archived read-only logic is spread across the shell banner, per-page `isReadOnly()` checks, and server 409s; pages hide controls ad hoc.

---

## 8. Migration notes

### 8.1 Proposed React component tree and routes

```
<App basename={__QYM_ROOT_PATH__}>
  <QueryClientProvider> <AuthProvider (useMe)> <ToastProvider> <DialogHost>
    Routes:
      /login                                   → <LoginPage>            (public; no shell)
      <RequireAuth>                            (everything below)
        <AppShell>                             (sidebar, topbar, breadcrumbs, archived banner, <Outlet/>)
          /                                    → <ProjectsPage>
          /profile                             → <ProfilePage>
          /admin                               → <AdminPage>            (admin brief; role guard)
          /trash                               → <TrashPage>            (admin brief)
          /reviews                             → <ReviewsPage>          (global; project from last-slug)
          /compare                             → <ComparePage>
          /docs-guide                          → <DocsPage>
          /run/:runId/*                        → <LegacyRunRedirect>    (resolve project, redirect to /projects/:slug/runs/:runId; keep query)
          /run/:runId/analyzer                 → <LegacyAnalyzerRedirect>
          /projects/:slug                      → <ProjectLayout> (resolves project from me.projects or by-slug; archived context; 404 panel)
              index                            → <RunsPage>
              overview | charts | models | experiments | experiments/queue | datasets | datasets/* | analysis | reviews
              runs/:runId  (splat: run ids contain slashes today — `{run_id:path}`)
              runs/:runId/analyzer
              settings?tab=general|members|apikeys|llm|environments|prompts|danger
          *                                    → <NotFound>
```
Shell components: `AppShell`, `Sidebar` (`NavItem`, `AdminSection`), `Topbar` (`Breadcrumbs`, `ProjectSwitcher` with `ProjectPopover`, `TopbarStats`), `UserMenu`, `ArchivedBanner`, `ProjectNotFound`, `Identicon`, `Toaster`, `ConfirmDialog`, `FormDialog`, `Drawer`, `CreateProjectDialog`, `ArchiveProjectDialog`, `UnarchiveProjectDialog`, `Skeleton`. Pages: `LoginPage` (`PasswordForm`, `ChangePasswordForm`, `SignupForm`, `ProviderButtons`), `ProjectsPage` (`ProjectCard`, `ProjectSearch`), `ProfilePage` (`AccountPanel`, `BootstrapAdminPanel`, `ProjectsPanel`), `ProjectSettingsPage` (`SettingsTabs`, `GeneralTab`, `ReviewRulesCard`, `MembersTab` (`MemberPicker`, `RemoveMemberDialog`), `ApiKeysTab` (`SecretRevealDialog`, `ReadTokensCard`), `LlmConnectionsTab`, `EnvironmentsTab` (experiments brief), `PromptsTab` (`PromptDiff`), `DangerZoneTab`).

### 8.2 State placement
- **URL**: project slug, page, run id, `?tab=` on settings (make it persistent, not one-shot), `?env/promote/id` deep link (consume once then strip), `?next=` on login, every page's filters/sort (`replaceUrlQuery` convention).
- **Local (localStorage)**: `qym:sidebar-collapsed`, `qym:last-project-slug` (used by `/reviews`, `/compare`, legacy `/run/*` to pick a project context), `qym.textMode`, `qym:single-key-shortcuts` (runs). Drop `qym:me` or replace with query persistence; whichever is chosen, clear on logout.
- **Server cache (TanStack Query keys)**: `['me']` (staleTime ~30 s, refetch on window focus; 401 anywhere → `queryClient.clear()` + redirect), `['project', slug]` (by-slug; seeded from `me.projects`), `['project', id, 'members']`, `['project', id, 'member-candidates', q]`, `['project', id, 'api-keys']`, `['project', id, 'dataset-read-tokens']`, `['project', id, 'llm-connections']`, `['project', id, 'analysis-prompts']`, `['admin','project',id,'archive-preview'|'unarchive-preview'|'deletion']`, `['auth','providers']`. Mutations invalidate only the touched key (fixes pain point 6) and `['me']` for create/rename/archive/unarchive/delete (so the switcher updates).
- **Ephemeral**: dialog state, toasts, topbar stats (context set by the page via `useTopbarStats(stats)`), run-status event bus + `BroadcastChannel`.

### 8.3 API client design
- Single `apiFetch(path, init)` that: prefixes `__QYM_ROOT_PATH__`, sets `credentials:'same-origin'`, sets `Content-Type: application/json` for bodies, parses `{detail}` into an `ApiError {status, detail, code?, headers}`, and on `401` calls `auth.redirectToLogin(currentPath)` (never for `/v1/auth/*` calls). Treat `403 code==="password_change_required"` as data on the login page. Treat `409` with "archived" as a read-only signal (show toast + refresh project).
- Expose typed hooks per route (`useMe`, `useProject(slug)`, `useProjectMembers(id)`, …) in `frontend/src/api/`.
- Do not add bearer tokens: the write guard (`app.py:200-215`) skips origin checks when `Authorization: Bearer` is present, so sending one would widen CSRF exposure.

### 8.4 Auth guard behaviour
- `RequireAuth` renders nothing (or the skeleton frame) until `['me']` resolves; on `401` → `window.location.assign(root + '/login?next=' + encodeURIComponent(path+search))` (full navigation, so the server-rendered `/login` keeps working and the session cookie is re-issued). Also keep the server-side redirect for direct hits (it already exists) — the SPA fallback route must keep calling `_maybe_redirect_to_login` so deep links to private pages still bounce unauthenticated users before the bundle loads.
- Role gates: `me.role==='ADMIN'` for Admin/Trash nav, danger zone, read tokens, rename; `project.role==='MANAGER'||ADMIN` for members/prompts/review rules/LLM edit.
- Archived: `project.is_active===false` → `ProjectLayout` provides `readOnly`; hide Auto-analysis/Reviews nav; banner on runs/overview/charts/models/datasets/settings/run-detail/experiments/queue (`ARCHIVED_NOTICE_PAGES`, `shell.js:360-363`).
- Logout: `POST /v1/auth/logout` → clear query cache and any local snapshot → `location.assign(root + '/login?next=' + root + '/')`.
- Auth mode `none` / `proxy_headers`: no login page is needed; `/login` still exists (serves the page; nothing is enabled). The SPA must not assume `/login` is reachable: if `/v1/me` returns 401 under `proxy_headers` there is nothing the user can do — show a "Missing user identity headers" panel instead of looping (today: redirect to `/login` which shows "No login methods are configured").

### 8.5 Serving the Vite SPA from FastAPI
- Build to `packages/platform/qym_platform/_static/app/` (keep `_static/dashboard/` until the cut-over; `pyproject.toml:52` package-data must add `_static/app/**/*`). Mount with `PrecompressedStaticFiles` at `/app-static` (or `/static/app`) so `NoStoreMiddleware`'s static prefixes (`cache_control.py:19`) stay cacheable; hashed Vite assets can carry `Cache-Control: immutable` — add that prefix to `STATIC_PREFIXES`.
- **Vite `base` must be runtime-relative.** The platform can be mounted under `QYM_ROOT_PATH`/`QYM_MAIN_PREFIX` (`main.py:12-50`); build with `base: './'` or inject `<base href="{root}/">` plus `window.__QYM_ROOT_PATH__` in the served `index.html` exactly as `_dashboard_html_response` does today, and give the Router `basename`.
- Routes that must **fall back to the SPA `index.html`** (replace the per-page handlers in `api/runs.py:2220-2498` with one handler per pattern that keeps its guard): `/`, `/profile`, `/admin`, `/trash`, `/compare`, `/reviews`, `/docs-guide`, `/run/{run_id:path}`, `/run/{run_id:path}/analyzer`, `/projects/{slug}`, `/projects/{slug}/{rest:path}`. Keep `_maybe_redirect_to_login` on all of them and `_guard_project_page` (404 page / 403) on the project ones, or move project resolution entirely client-side and have the fallback only check the session (simpler; the 404 panel is already a client component). Keep the `_canonical_*_redirect` helpers for `/run/{id}/analyzer` and `/projects/{slug}/analysis` (`api/runs.py:2424-2475`) because they rewrite legacy query shapes server-side.
- Routes that must **not** fall back: `/login` (server-templated; or serve the SPA and have `LoginPage` call `GET /v1/auth/providers` — recommended, then `/login` becomes an SPA route whose handler only does the "already signed in → 303 next" check), `/v1/*`, `/api/*`, `/static/*`, `/ui/*` (SDK run UI), `/healthz`, `/api-docs`, `/openapi.json`, `/ingestion/*`, `/workers/*`, and anything with a file extension. Return JSON 404 for unknown `/v1|/api` paths, never `index.html`.
- `GET /api/runs/{run_id}/export-html` (`api/runs.py:4460-4650`) inlines `run.html` and sets `window.__QYM_EXPORT__` so `shell.js` bails (`shell.js:14`). The export must keep working after the cut-over — either keep the legacy run page assets for export only, or make the run-detail React route render in a shell-less "export" mode (run brief decides; flagging here because it depends on the shell skip).
- **Dev server**: the same-origin write guard rejects `POST`s from `http://localhost:5173` (`Origin` ≠ `QYM_BASE_URL`). Use Vite's `server.proxy` for `/v1`, `/api`, `/static`, `/ui`, `/login` to the FastAPI port so the browser origin stays the platform's; do **not** add `CORSMiddleware` (there is none today, `app.py`) — cookies + CORS would weaken CSRF posture. In dev set `QYM_BASE_URL=http://localhost:5173` if the proxy approach is not used.
- `NoStoreMiddleware` must keep `no-store` on the SPA `index.html` response (it will, since it is not under a static prefix).

### 8.6 Risks / gotchas
- Run ids contain `/` (`{run_id:path}`); React Router splat routes and `encodeURIComponent` round-trips must be tested (`shell.js:174-190` decodes once).
- `me.projects` omits archived projects; `ProjectLayout` must fall back to `GET /v1/projects/by-slug` and treat `is_active:false` as read-only, `403` as "no access" (active project), `404` as not found.
- Legacy `/run/{id}` and `/compare`/`/reviews` use `qym:last-project-slug` as a *guess*; the run page corrects it via `setPageProject` once the run JSON says which project it belongs to (`shell.js:385-419`). The React equivalent: `LegacyRunRedirect` fetches `GET /api/runs/{id}?view=compact` and redirects to the project URL.
- `BroadcastChannel('qym-run-status')` message shape `{runIds:string[], status:'STOPPED'|'STOPPING'}` is consumed by pages in other tabs that may still be the legacy dashboard during a staged rollout — keep the channel name and shape.
- Login throttling returns `429` with `detail`; show it, do not retry automatically.
- The admin password reset returns a temporary password in JSON (`web.py:303-343`, `Cache-Control: no-store`); the admin area displays it once — same `SecretRevealDialog` as API keys.
- `test_design_language.py` scans `_static/` — emitted CSS from Vite must respect tokens; configure CSS modules/vanilla-extract to use `var(--…)` and add the build directory to the test's allow-list only for the glyph exemptions.
- Session cookie is `SameSite=Lax` and `https_only` outside dev; the Vite dev proxy must forward `Set-Cookie` unchanged (same host, different port is fine).
- `history.scrollRestoration='manual'` + nested scroller: React Router's `<ScrollRestoration>` only handles `window`; `#shell-content` needs its own.
- Shell dialogs mount to `document.body` and survive navigation; the remove-member dialog explicitly closes on page unmount (`project_settings.html:1179`) — model: dialogs owned by a page unmount with it; shell-level toasts persist.

### 8.7 Suggested Playwright scenarios
1. Unauthenticated deep link `/projects/p1/settings?tab=members` → redirected to `/login?next=%2Fprojects%2Fp1%2Fsettings%3Ftab%3Dmembers`; after password sign-in lands on that URL with the Members tab active.
2. Temporary-password flow: sign in with a reset password → change-password form → mismatch error → success → redirected.
3. Sign-up toggle visible only when `signup_enabled`; `403` when sign-up is off shows the server message.
4. Shell: sidebar collapse persists across reload and in-app navigation; ≤760px auto-collapses; `Escape` closes the project popover and focus returns to the trigger.
5. Project switcher: search filters, selecting navigates without a full reload (assert no `load` event), breadcrumb and active nav update, `localStorage['qym:last-project-slug']` set.
6. Create project from the popover: duplicate slug shows `detail` inline; success navigates to the new project and it appears in the switcher without reload.
7. Archived project URL for a member: read-only banner shown, Auto-analysis/Reviews hidden from nav, settings shows "Unarchive" copy for admins, member add bar hidden; `/projects/{slug}/analysis` → 404 panel.
8. Project settings Members: combobox keyboard flow (type, ArrowDown, Enter, Add), remove dialog opens on Cancel, transfer select appears only when the member owns runs.
9. API key create → token dialog, Copy writes clipboard and toasts; Revoke confirm; key disappears without full reload (`network` shows only the keys request).
10. Logout from the user menu → `POST /v1/auth/logout`, Back button does not show the previous page (no-store), `localStorage` has no `qym:me`.
11. Cross-tab: `BroadcastChannel` message with `{runIds,status:'STOPPED'}` in tab B triggers a runs refetch in tab A.
12. Mounted under `QYM_ROOT_PATH=/qym`: all links, API calls and the login redirect carry the prefix.

---

## 9. Open questions

1. **Login page ownership**: keep `/login` server-templated (bootstrap JSON inlined, no JS bundle dependency) or move it into the SPA using `GET /v1/auth/providers`? Recommendation: SPA route + keep the server "already signed in → 303 next" check; the component agent must log the choice because `tests/platform/test_login_form_browser.py` depends on the current markup.
2. **Project resolution server- or client-side** for `/projects/{slug}/*` fallbacks (403 JSON vs. SPA 404 panel). Current server returns a JSON 403 for an active project the user cannot access — the SPA should render an "Access denied" panel; decide whether the fallback handler keeps `_guard_project_page`.
3. **Legacy `/run/{id}` routes**: keep as first-class SPA routes with the "guessed project" behaviour, or redirect to the canonical project URL once the run is known? Recommendation: redirect; log it.
4. **`qym:me` snapshot**: drop (React Query persistence instead) or keep for first-paint names? Either way the logout path must clear it.
5. **Topbar stats** API: keep the imperative `setTopbarStats` shape (`[{value,label,color,title,secondary}]`, `{scope,scopeTitle}`) as a context hook, or let pages render into a portal slot?
6. **Settings `?tab=`**: make it persistent (recommended) — today it is read once then ignored.
7. **Profile editing**: no endpoint exists for a user to change their own display name/title; keep the page read-only or add `PATCH /v1/me` (backend change).
8. **Auth mode `proxy_headers`/`none`**: what should the SPA show on a 401 (there is no login)? Propose a static "identity headers missing" panel.
9. **Export mode** (`__QYM_EXPORT__`): which agent owns the shell-less run export page.
10. **Where the Vite build lands** (`_static/app/` vs replacing `_static/dashboard/`) and whether the design-language test should scan the compiled bundle or the `frontend/src` sources.
