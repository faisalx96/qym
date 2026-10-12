# Shell / auth / projects / profile / settings — analysis (foundation)

Walked on 2026-10-11 against the vanilla pages on port 8800 (`QYM_AUTH_MODE=none`,
SQLite, two seeded projects, one archived) and by reading `shell.js`, `auth.js`,
`login.html`, `projects.html`, `profile.html`, `project_settings.html`.

## Confirmed

- Shell boot: `shell.js` builds sidebar + topbar at runtime, moves the body into
  `#shell-content` (the only scroller), caches `/v1/me` in `localStorage['qym:me']`,
  and re-executes every page script on in-app navigation (fetch-parse-swap). The
  4 s `qym-shell-pending` guard exists only to hide layout shift.
- `/v1/me` is the project list for everyone; archived projects are absent and
  resolved through `GET /v1/projects/by-slug` (`is_active:false` → read-only context;
  403 → access denied JSON today; 404 → not found).
- Login (`login.html`): server inlines `__QYM_LOGIN_BOOTSTRAP__`; password login,
  change-password (403 `password_change_required`), sign-up (only while no admin
  exists), provider buttons, 401/429 messages, `sessionStorage.clear()` on load.
- Same-origin write guard rejects `POST`s from a foreign origin (`Origin` ≠
  `QYM_BASE_URL`); there is no CORS middleware. The Vite proxy keeps the browser on
  one origin, so no backend change is needed for dev.
- `NoStoreMiddleware` keeps pages and JSON `no-store`; `/static`, `/ui` cacheable.
- Project switcher (breadcrumb popover): search, identicon, archived tag, "Create
  Project" footer; `qym:last-project-slug` remembered for `/reviews`, `/compare`,
  `/run/*`.
- Sidebar: Projects/Docs globals; project items Dashboard(overview), Charts, Runs,
  Models, Experiments, Auto-analysis, Reviews, Datasets, Settings; Platform section
  (Admin, Deleted Runs) only for ADMIN; `.project-archived` hides Auto-analysis and
  Reviews; collapse persisted in `qym:sidebar-collapsed`, auto-collapse ≤ 760px.
- Dialog/toast/drawer/skeleton contracts and timing (300 ms wait / 400 ms min /
  200 ms fade) as described in brief 01 §3.4–3.5.
- `BroadcastChannel('qym-run-status')` message `{runIds, status}`.

## What the brief got wrong or left open

- Brief 01 §1 says `login.html` "does not load shell.js" — true, but it does load
  `ui_components.js`, which registers a document-wide MutationObserver; in the SPA
  the login route stays shell-less and needs no observer.
- §8.5 lists `/docs-guide` as SPA fallback; the vanilla docs page keeps its own
  hash-router (`#section/page`). The SPA registers `/docs-guide` and `/docs/*` as
  placeholders; the admin-docs area decides the final shape.
- "Default Project is `projects[0]`" — confirmed; the profile page shows it as
  informational only.
- The brief's suggestion to make `/login` an SPA route is adopted: `/app/login`
  (SPA, reads `GET /v1/auth/providers`) while the vanilla `/login` stays for the
  legacy pages (its browser test keeps passing). `/app/*` redirects to `/app/login`.

## Behaviours kept (implemented in the foundation)

Topbar + sidebar + breadcrumbs + project switcher (search, create, archived tag);
collapse persistence and ≤ 760px auto-collapse; user menu (Profile, Sign out);
archived read-only banner + hidden Auto-analysis/Reviews; Project Not Found /
Access Denied panels; login journeys J1 (password, change-password, sign-up,
providers, "no login methods"), 401 → login redirect with `next`, proxy_headers/
none 401 panel; logout clears caches + `qym:me`; `qym:last-project-slug`;
`replaceUrlQuery` as `useSearchParamsState`; run-status bus with the same channel
name and shape; toasts (one system, top-right), confirm/form dialogs, drawer,
skeleton timing; legacy `/run/:id` → canonical project URL redirect; every
current URL registered (placeholders for other areas).

## Dropped

Fetch-parse-swap navigation, page-script re-execution, stylesheet adoption,
`qym:me` first-paint snapshot (React Query cache + skeleton instead; still
cleared on logout), `qym-shell-pending` guard, `renderAuthGate`, dead
`injectLogoutMenuItem`, `window.confirm` for read tokens, topbar stats
sessionStorage replay (context only).
