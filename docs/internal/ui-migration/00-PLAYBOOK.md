# UI migration playbook (React + TypeScript + Vite)

Authoritative process for rebuilding the qym frontends from scratch. Every
component agent reads this file first, then its area brief (`NN-<area>.md`),
then `02-shared-primitives-design-system.md`.

## Decisions already made (do not re-open)

| Topic | Decision |
|---|---|
| Stack | React 18+, TypeScript strict, Vite, React Router, TanStack Query. Styling per `02-shared-primitives-design-system.md` §6 recommendation (tokens carried over verbatim). |
| Location | Top-level `frontend/` package (own `package.json`). Not under `packages/`. |
| Old React build | `packages/platform/qym_platform/_static/app/` is an orphaned build with no source. Delete it in the foundation branch; never reference it. |
| Build output | `npm run build` writes to `packages/platform/qym_platform/_static/app/` (gitignored) and, for the SDK entry, `packages/sdk/qym/_static/ui/` (see brief 10). Docker and wheel builds run the Vite build. |
| Serving during migration | FastAPI serves the SPA under `/app/*` with history-API fallback to `index.html`. Old pages keep working at their current URLs until a final cutover (not part of any component branch). |
| Design rules | Keep every token in `dashboard.css` `:root` and the type-scale roles from `docs/DESIGN_LANGUAGE.md`. Layout, navigation and interaction may change freely. The design-language test is ported to lint `frontend/`. |
| Granularity | One agent per feature area (briefs 03..10). Foundation (briefs 01+02) lands first; area branches fork from `ui/foundation`. |
| Branching | `ui/foundation` from `UI-redesign`; `ui/<area>` from `ui/foundation`. Branches are **left unmerged** for human review. Never merge, rebase onto, or push anything. |
| Concurrency | At most 4 area agents at once, each in its own git worktree with its own ports. |
| Backend changes | Allowed when a page needs them (SPA fallback, missing endpoint, CORS for the dev server). Must come with pytest coverage in `tests/platform/`. |
| Testing | Playwright (`@playwright/test`) against the real FastAPI platform on SQLite with `QYM_AUTH_MODE=none`, plus Vitest for pure logic. |
| Review | Commits on the branch; no PRs opened by agents. |

## Environment

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"      # Node 24 LTS (run in every shell)
source /home/meshari-aldossari/Documents/qym/qym/.venv/bin/activate
export PYTHONPATH=packages/sdk:packages/platform      # required inside worktrees
```

Playwright browsers are already in `~/.cache/ms-playwright`; run
`npx playwright install chromium` only if the version check fails.

Port allocation (so parallel agents never collide):

| Agent | Platform port | Vite port |
|---|---|---|
| foundation | 8800 | 5800 |
| overview-runs-list | 8801 | 5801 |
| run-detail | 8802 | 5802 |
| compare-analyzer | 8803 | 5803 |
| experiments-queue | 8804 | 5804 |
| datasets-reviews | 8805 | 5805 |
| playground | 8806 | 5806 |
| admin-docs | 8807 | 5807 |
| standalone-uis | 8808 | 5808 |

Start the platform (from the worktree root):

```bash
QYM_AUTH_MODE=none QYM_DATABASE_URL=sqlite:///$PWD/.qym-dev.db QYM_ENVIRONMENT=development \
  uvicorn qym_platform.main:app --port <PORT>
```

Seed data through the API or `packages/platform/qym_platform/tools/` import scripts;
never hand-edit the DB.

## Worktree setup (component agents)

```bash
cd /home/meshari-aldossari/Documents/qym/qym
git worktree add ../qym-wt-<area> -b ui/<area> ui/foundation
cd ../qym-wt-<area>
```

All work, including `npm install`, happens inside the worktree. `node_modules`
is gitignored. Do not touch the main checkout.

## The flow (mandatory, in order)

1. **Branch**: create the worktree/branch above.
2. **Analyze**: read the playbook, your brief, brief 02, `docs/DESIGN_LANGUAGE.md`,
   and the foundation's `frontend/README.md`. Open the current vanilla page in
   Playwright against your platform port and walk every journey in brief §2.
   Write `frontend/src/features/<area>/ANALYSIS.md` (max 2 pages): what you
   confirmed, what the brief got wrong, the list of behaviors you will keep.
3. **Design** (spawn a *design sub-agent*): it produces 2-3 alternative mocks as
   real TSX prototypes under `frontend/src/features/<area>/__mocks__/<variant>/`,
   wired to the foundation primitives and mock data (MSW or static fixtures), each
   reachable at `/app/__mock/<area>/<variant>` via the dev server. The design
   agent loads the `dataviz` skill before any chart. It writes
   `__mocks__/DESIGN_NOTES.md` explaining each variant's rationale. **At the end
   it must spawn a *UX sub-agent*** that opens every variant in Playwright,
   screenshots them, scores them against brief §2 journeys and §7 pain points
   (task success, steps-to-complete, discoverability, a11y, density, consistency
   with the rest of the app), and writes the verdict and reasons to
   `__mocks__/UX_DECISION.md`. The design agent reports the decision back to you.
4. **Implement** the chosen mock for real under `frontend/src/features/<area>/`
   (routes registered in the app router, real API hooks, loading/empty/error
   states, keyboard support). Delete `__mocks__/` once implemented; keep
   `ANALYSIS.md`, and move `DESIGN_NOTES.md` + `UX_DECISION.md` to
   `docs/internal/ui-migration/decisions/<area>/`.
5. **Test** (spawn a *UX-test sub-agent*): it writes Playwright specs under
   `frontend/e2e/<area>/` covering every journey in brief §2 and §8 scenarios,
   runs them against the real platform (seeded), runs Vitest, `tsc --noEmit`,
   `npm run lint`, the ported design-language test, and the platform pytest
   suite if backend files changed. It reports a pass/fail list with repro steps.
6. **Fix** every reported failure; re-run the tester until green.
7. **Commit** on the branch (Conventional Commits, one or a few commits, each
   ending with the attribution line in the system reminder). Never merge.
8. **Report** back: branch name, commits, what was kept/changed/dropped, test
   results (paste the Playwright summary), open questions logged in
   `docs/internal/ui-migration/decisions/<area>/OPEN_QUESTIONS.md`.

## Rules

- Start from scratch: no copying of vanilla JS into TSX. Re-implement.
- Every decision you make alone gets a dated line in your `OPEN_QUESTIONS.md`.
- URL compatibility: every current deep link and query parameter keeps working
  (route list in brief 01 §8).
- No hardcoded colors/sizes; tokens only. `--text-dim` never for readable text.
- Accessibility: every interactive element keyboard-reachable with a visible
  focus ring; forms labelled; dialogs trap focus; tables have headers.
- Never log or display credentials. Never commit `.env`, DBs, screenshots, or
  `node_modules`.
- If blocked by a foundation gap, add the primitive in `frontend/src/ui/` on
  your branch and note it in your report (the reviewer will dedupe).

## Foundation facts (ui/foundation, read `frontend/README.md` there first)

- Router basename is `{root}/app`; routes live in `frontend/src/app/routes.ts` and
  `router.tsx`; replace the `ComingSoon` placeholder for your area's routes.
- Primitives: `frontend/src/ui` (46 components, gallery at `/app/__ui` in dev).
  Lib: `frontend/src/lib` (apiFetch/ApiError, metrics, text/RTL,
  useSearchParamsState, run-status bus, polling, useDelayedPending).
  API hooks go in `frontend/src/api/<area>.ts`.
- Dev DB: `frontend/scripts/dev_db.py` (ORM create_all; alembic cannot build SQLite).
- Playwright config already starts platform + Vite; override ports with the env
  vars documented in the README so parallel agents do not collide.
- Shell layout decision: persistent sidebar (variant A) + Ctrl/Cmd+K palette.
  Do not re-open it; design your area's content region within it.
