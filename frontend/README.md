# qym frontend (React + TypeScript + Vite)

The qym platform UI. FastAPI serves the built app at the canonical URLs (`/`,
`/login`, `/projects/<slug>/...`, `/admin/...`, `/docs/...`, `/compare`,
`/run/<id>`). The same sources also build the offline SDK run viewer
(`src/sdk-viewer/`). Every visual decision follows
**`docs/DESIGN_LANGUAGE.md`** (enforced by `src/__tests__/design-language.test.ts`).

## Five-minute start

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"       # Node 24
cd frontend && npm ci                                   # exact versions (package-lock.json)

# terminal 1: the platform, SQLite, no auth
cd .. && source .venv/bin/activate && export PYTHONPATH=packages/sdk:packages/platform
python frontend/scripts/dev_db.py sqlite:///$PWD/.qym-dev.db     # schema from the ORM (alembic is Postgres-only)
QYM_AUTH_MODE=none QYM_DATABASE_URL=sqlite:///$PWD/.qym-dev.db QYM_ENVIRONMENT=development \
  QYM_BASE_URL=http://127.0.0.1:5800 uvicorn qym_platform.main:app --port 8800

# terminal 2: Vite with a same-origin proxy to that port (no CORS anywhere);
# the dev server needs no build, so it works before `npm run build`
cd frontend && QYM_PLATFORM_PORT=8800 npm run dev -- --port 5800
```

Open `http://127.0.0.1:5800/` (projects), `http://127.0.0.1:5800/__ui`
(every primitive in every state) or `/__mock/<area>/<variant>` (dev only).

Scripts (`package.json`):

| Script | What |
|---|---|
| `npm run dev` | Vite dev server at the root path (port 5800; `QYM_VITE_PORT`, `QYM_PLATFORM_PORT` override) |
| `npm run build` | `tsc -b` + Vite build → `packages/platform/qym_platform/_static/app/` (gitignored) |
| `npm run build:sdk` / `npm run dev:sdk` | Offline SDK viewer (`src/sdk-viewer/`, `vite.sdk.config.ts`) → flat `packages/sdk/qym/_static/ui/` (gitignored); dev proxies `/api` to the SDK server on 8818 |
| `npm run check` | typecheck + eslint + stylelint + vitest + design-language test — run before every commit |
| `npm test` / `npm run test:design` | Vitest (jsdom, Testing Library, axe) / only the design-language lint |
| `npm run e2e` / `npm run e2e:ui` | Playwright: boots the platform (SQLite, `QYM_AUTH_MODE=none`) on 8800 and Vite on 5800, runs `e2e/**` (headless / UI mode) |
| `npm run e2e:sdk` | Playwright against the built SDK viewer (`playwright.sdk.config.ts`, `e2e/sdk-viewer/`) |
| `npm run lint`, `npm run stylelint`, `npm run format` | ESLint (TSX design rules included), Stylelint (no px font sizes, no hex colours), Prettier |

Ports: platform 8800 / Vite 5800 by default. To run two checkouts side by side
use another pair (`QYM_PLATFORM_PORT=880N QYM_VITE_PORT=580N` for dev, e2e and
the proxy).

## Folder layout

```
frontend/
  index.html                  the single page; the platform injects <base href> + window.__QYM_APP__
  vite.config.ts              base './', proxy for /v1 /api /healthz /api-docs /ingestion /workers, chunking
  vite.sdk.config.ts          the offline SDK viewer build
  playwright.config.ts        e2e web servers (platform + Vite); baseURL is the Vite dev server at the root
  e2e/<area>/*.spec.ts        Playwright specs per area; e2e/helpers.ts seeds through the API
  src/
    main.tsx                  imports styles/tokens.css, base.css, shell.css, then <App/>
    app/                      App (providers), router.tsx (every route), routes.ts (URL contract), mocks.ts
    styles/                   tokens.css (the design tokens), base.css, shell.css
    ui/<Name>/                primitives: <Name>.tsx, <Name>.module.css (first line names its recipe), index.ts
    lib/                      runtime (root path / bootstrap), http (apiFetch, ApiError, classifyError, loginUrl),
                              metrics, text (RTL, code detection, safe markdown), url-state (replaceUrlQuery),
                              run-status (BroadcastChannel bus), storage (localStorage keys), pending (skeleton timing), …
    api/                      typed TanStack Query hooks per backend route (useMe, useProject, useMembers, …)
    features/shell/           shell, auth gate, project layout, login, projects, profile, settings (brief 01)
    features/docs/            docs pages; partials/<section>/<page>.html compiled by plugins/docs-content.ts
    features/<area>/          pages and components per area (runs-list, run-detail, compare, analyzer, datasets, experiments, admin, …); __mocks__/ while designing
    features/dev/             dev-only pages: the UI gallery (/__ui) and the mock host (/__mock/…)
    sdk-viewer/               entry for the offline SDK viewer
    __tests__/design-language.test.ts   the design-language lint (single source of truth for the rules)
  plugins/                    Vite plugins (docs-content.ts)
  scripts/dev_db.py           creates the dev SQLite schema
```

Import with the `@/` alias (`@/ui`, `@/lib/http`, `@/api`). Styles are CSS
Modules with `var(--…)` tokens only; state goes in `data-*` attributes (React
Aria exposes `data-hovered`, `data-selected`, `data-focus-visible`, …).

## Adding a route

1. Add the path to `src/app/routes.ts` (the URL contract; keep every existing
   deep link and query parameter working).
2. In `src/app/router.tsx` add the route element with your page (lazy-load
   it via `lazyPage`). Pages under `/projects/:slug/*` render inside
   `<ProjectLayout>` and read `useProjectContext()` (`project`, `readOnly`,
   `canManage`); everything else reads `useAuth()` (`me`, `isAdmin`). Server
   side nothing needs to change: `api/spa.py` already answers every non-API path
   with the app, and an unknown client route renders the app's own not-found.
3. Page container: `constrained` (1120px: settings, admin, profile, overview)
   or `fullWidth` from `@/features/shell/layout`.
4. Page chrome: `<PageHeader title description meta actions tabs/>`; set the
   topbar stats with `useTopbarStats(...)` from `@/features/shell` when the page
   has KPIs; call `useDocumentTitle('…')`.
5. Data: add hooks under `src/api/<area>.ts` with `api.get/post/…` from
   `@/lib/http` (cookies, root path, `ApiError` with `status`/`detail`/`kind`,
   401 → login redirect are handled once there). Query keys are arrays
   (`['project', id, 'members']`); mutations invalidate only the touched key.
6. States: `useDelayedPending(isPending)` → `<Skeleton/>` (never flashes under
   300 ms); `<ErrorState error onRetry/>` for failures (never an empty state);
   `<EmptyState/>` only for a successful empty result.
7. URL view state: `const { params, replaceUrlQuery } = useSearchParamsState()`.

## Report pages (run detail, compare)

Both pages are stacked reports: `ReportSection`s (`@/ui`) in page order, a sticky
section nav with scroll-spy, and `ReportLayout` + `ScopeBar` for the quick-filter
sidebar that appears only while a scope is active (`features/run-detail/hooks/useScope.ts`,
`features/compare/hooks/useScope.ts`). Old `?panel=` values and `#overview`-style
hashes scroll to the matching section. Lazy sections mount when they near the
viewport, so an e2e test jumps to a section through the nav before asserting on it.

## Adding a mock route (design step)

Design variants live in `src/features/<area>/__mocks__/<variant>/` and are
registered in `src/app/mocks.ts`:

```ts
import { lazy } from 'react';
import { registerMock } from '@/app/mocks';
registerMock({ area: 'runs', variant: 'dense', title: 'Dense table', component: lazy(() => import('@/features/runs/__mocks__/dense/Mock')) });
```

Import that registration file once from `src/app/mocks.ts` (append an `import
'@/features/<area>/__mocks__/register'` line) and open
`/__mock/<area>/<variant>` on the dev server. Mocks render inside nothing
but the providers, so wrap them in `<AppShell>` chrome yourself if the variant
needs it (compose chrome from `@/features/shell/chrome/*`). Mock routes are
only registered when `import.meta.env.DEV` and are deleted once implemented.

## Testing

- Unit and component tests: Vitest (jsdom, Testing Library, axe), `npm test`; files sit next to the code or in `__tests__/`.
- Design language: `npm run test:design` (also part of `npm run check`); `tests/platform/test_design_language.py` runs the same test from pytest.
- Browser journeys: Playwright, below. Backend serving tests: `tests/platform/test_spa_serving.py`.

## Experiment creation (`/projects/:slug/experiments/new`)

Two views of one form: the home view (environments, dataset, starting point, a name, **Launch as is** / **Customize**) and the six-step
Customize wizard at `?step=where|start|models|settings|evaluation|review`. The step is only a view: `LaunchPage` keys the
`LaunchProvider` on the form-defining params (`state/useStep.ts` `entryKey`), never on `step`, and the unsaved-changes guard ignores it.
Problem clicks, "Edit" links and the Raw JSON button reach their step through `revealStep` (`LaunchProvider` prop). e2e helpers:
`openHome`, `openLaunch(page, slug, q, step)`, `goStep`, `openSection` in `e2e/experiments/launch/launchSupport.ts`. The default-preset
editor still uses the stacked page (`Outline`, collapsible `LaunchSection`).

## Writing an e2e test

```ts
import { test, expect } from '@playwright/test';
import { createProject, uniqueSlug, gotoApp } from '../helpers';

test('settings tab deep link', async ({ page, request }) => {
  const project = await createProject(request, 'Demo', uniqueSlug('demo'));
  await gotoApp(page, `/projects/${project.slug}/settings?tab=members`);
  await expect(page.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'true');
});
```

`npm run e2e` (`npm run e2e:sdk` for the SDK viewer) starts a fresh SQLite platform (`QYM_AUTH_MODE=none`, so you are
`dev@local`, an ADMIN) and the Vite proxy; seed through the API with the
`request` fixture (`e2e/helpers.ts`), never by editing the DB. Specs live in
`e2e/<area>/`. For session-auth journeys run with `QYM_E2E_AUTH_MODE=proxy_headers`
(local password auth enabled) and create users through `/v1/admin/users`.

## Seeding data

With the platform running under `QYM_AUTH_MODE=none` every request is the
admin `dev@local`: `POST /v1/projects {name, slug}`, then push runs with the
SDK (`QYM_BASE_URL=http://127.0.0.1:8800 QYM_API_KEY=<key from
/v1/projects/{id}/api-keys>`) or the import scripts under
`packages/platform/qym_platform/tools/`.

## Build and serving

`npm run build` (`tsc -b` + Vite) writes the app to
`packages/platform/qym_platform/_static/app/` (gitignored; `npm run build:sdk`
likewise writes the SDK viewer to `packages/sdk/qym/_static/ui/`).
`qym_platform/api/spa.py` serves it from the main app (the `all` and `main`
services only; the ingestion and workers apps never serve the UI):

- every page URL gets `index.html` (history fallback), with `<base href>` and
  `window.__QYM_APP__` injected so the app works under `QYM_ROOT_PATH` /
  `QYM_MAIN_PREFIX`; the router basename is that root path;
- hashed assets come from `/assets/` (cacheable); pages are `no-store`;
- API-looking paths that match no route (`/v1`, `/api`, `/assets`, …) answer a
  JSON 404, never `index.html`;
- `/app` and `/app/...` redirect (302) to the canonical URL, keeping the query,
  so links shared before the cut-over still work;
- an unauthenticated session is sent to `/login?next=...` before the bundle loads.

The Docker image builds the bundle in a Node 24 stage. A platform wheel must be
built after `npm run build`, or it ships without the UI. Backend tests:
`tests/platform/test_spa_serving.py`.
