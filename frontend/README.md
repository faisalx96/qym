# qym frontend (React + TypeScript + Vite)

The React rewrite of the platform dashboard. It is served by FastAPI under
`/app/*` next to the legacy pages (which stay at their old URLs until the
cut-over). Read `docs/internal/ui-migration/00-PLAYBOOK.md` and your area
brief first; every visual decision follows **`docs/DESIGN_LANGUAGE.md`**
(enforced by `src/__tests__/design-language.test.ts`).

## Five-minute start

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"       # Node 24
cd frontend && npm ci                                   # exact versions (package-lock.json)

# terminal 1: the platform on your agent's port (playbook table), SQLite, no auth
cd .. && source .venv/bin/activate && export PYTHONPATH=packages/sdk:packages/platform
python frontend/scripts/dev_db.py sqlite:///$PWD/.qym-dev.db     # schema from the ORM (alembic is Postgres-only)
QYM_AUTH_MODE=none QYM_DATABASE_URL=sqlite:///$PWD/.qym-dev.db QYM_ENVIRONMENT=development \
  QYM_BASE_URL=http://127.0.0.1:5800 uvicorn qym_platform.main:app --port 8800

# terminal 2: Vite with a same-origin proxy to that port (no CORS anywhere)
cd frontend && QYM_PLATFORM_PORT=8800 npm run dev -- --port 5800
```

Open `http://127.0.0.1:5800/app/` (projects), `http://127.0.0.1:5800/app/__ui`
(every primitive in every state) or `/app/__mock/<area>/<variant>`.

Scripts (`package.json`):

| Script | What |
|---|---|
| `npm run dev` | Vite dev server (port 5800 by default; `QYM_VITE_PORT`, `QYM_PLATFORM_PORT` override) |
| `npm run build` | `tsc -b` + Vite build → `packages/platform/qym_platform/_static/app/` (gitignored) |
| `npm run check` | typecheck + eslint + stylelint + vitest + design-language test — run before every commit |
| `npm test` / `npm run test:design` | Vitest (jsdom, Testing Library, axe) / only the design-language lint |
| `npm run e2e` | Playwright: boots the platform (SQLite, `QYM_AUTH_MODE=none`) on 8800 and Vite on 5800, runs `e2e/**` |
| `npm run lint`, `npm run stylelint`, `npm run format` | ESLint (TSX design rules included), Stylelint (no px font sizes, no hex colours), Prettier |

Ports: foundation = platform 8800 / Vite 5800; area agents use their own pair
from the playbook (`QYM_PLATFORM_PORT=880N QYM_VITE_PORT=580N` for dev, e2e
and the proxy).

## Folder layout

```
frontend/
  index.html                  the single page; the platform injects <base href> + window.__QYM_APP__
  vite.config.ts              base './', proxy for /v1 /api /static /ui /login …, chunking
  playwright.config.ts        e2e web servers (platform + Vite)
  e2e/<area>/*.spec.ts        Playwright specs per area; e2e/helpers.ts seeds through the API
  src/
    main.tsx                  imports styles/tokens.css, base.css, shell.css, then <App/>
    app/                      App (providers), router.tsx (every route), routes.ts (URL contract), mocks.ts
    styles/                   tokens.css (verbatim :root from dashboard.css + migration tokens), base.css, shell.css
    ui/<Name>/                primitives: <Name>.tsx, <Name>.module.css (first line names its recipe), index.ts
    lib/                      runtime (root path / bootstrap), http (apiFetch, ApiError, classifyError, loginUrl),
                              metrics, text (RTL, code detection, safe markdown), url-state (replaceUrlQuery),
                              run-status (BroadcastChannel bus), storage (legacy keys), pending (skeleton timing), …
    api/                      typed TanStack Query hooks per backend route (useMe, useProject, useMembers, …)
    features/shell/           shell, auth gate, project layout, login, projects, profile, settings (brief 01)
    features/<area>/          your area: pages, components, ANALYSIS.md; __mocks__/ while designing
    features/dev/             dev-only pages: UI gallery (/app/__ui), mock host, ComingSoon placeholders
    __tests__/design-language.test.ts   the ported design-language lint
```

Import with the `@/` alias (`@/ui`, `@/lib/http`, `@/api`). Styles are CSS
Modules with `var(--…)` tokens only; state goes in `data-*` attributes (React
Aria exposes `data-hovered`, `data-selected`, `data-focus-visible`, …).

## Adding a route

1. The path already exists in `src/app/routes.ts` (every legacy URL is listed;
   keep every current deep link and query parameter working). Add new paths there.
2. In `src/app/router.tsx` replace the `<ComingSoon …/>` element for your path
   with your page. Pages under `/projects/:slug/*` render inside
   `<ProjectLayout>` and read `useProjectContext()` (`project`, `readOnly`,
   `canManage`); everything else reads `useAuth()` (`me`, `isAdmin`).
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
`/app/__mock/<area>/<variant>` on the dev server. Mocks render inside nothing
but the providers, so wrap them in `<AppShell>` chrome yourself if the variant
needs it (`import { ShellFrame } from '@/features/shell'`). Mock routes are
only registered when `import.meta.env.DEV` and are deleted once implemented.

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

`npm run e2e` starts a fresh SQLite platform (`QYM_AUTH_MODE=none`, so you are
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

## Serving in production

`npm run build` writes to `packages/platform/qym_platform/_static/app/`;
`qym_platform/api/spa.py` serves `index.html` for every `/app/*` route (login
redirect kept, `QYM_ROOT_PATH` injected as `<base href>` and
`window.__QYM_APP__`), hashed assets from `/app/assets/` (cacheable). The
Docker image builds the bundle in a Node 24 stage. Backend tests:
`tests/platform/test_spa_serving.py`.
