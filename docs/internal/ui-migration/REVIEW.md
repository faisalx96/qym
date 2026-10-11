# UI migration: review guide

State as of 2026-10-12. Every branch below is committed and unmerged, per the
decision to leave them for human review. Nothing was pushed.

## Branches

| Branch | Base | Commits | Worktree | Area brief |
|---|---|---|---|---|
| `ui/foundation` | `UI-redesign` | 11 | `../qym-wt-foundation` | 01, 02 |
| `ui/overview-runs-list` | `ui/foundation` | 6 | `../qym-wt-runs-list` | 03 |
| `ui/run-detail` | `ui/foundation` | 15 | `../qym-wt-run-detail` | 04 |
| `ui/compare` | `ui/foundation` | 7 | `../qym-wt-compare` | 05 (compare half) |
| `ui/analyzer` | `ui/foundation` | 8 | `../qym-wt-analyzer` | 05 (analyzer half), 08 |
| `ui/experiments-eval-queue` | `ui/foundation` | 30 | `../qym-wt-experiments` | 06 |
| `ui/datasets-reviews-trash` | `ui/foundation` | 7 | `../qym-wt-datasets` | 07 |
| `ui/admin-docs` | `ui/foundation` | 5 | `../qym-wt-admin-docs` | 09 |
| `ui/standalone-uis` | `ui/foundation` | 5 | `../qym-wt-standalone` | 10 |

Each area branch carries `frontend/src/features/<area>/ANALYSIS.md` and
`docs/internal/ui-migration/decisions/<area>/{DESIGN_NOTES,UX_DECISION,OPEN_QUESTIONS}.md`.
Read `OPEN_QUESTIONS.md` first: it lists every decision the agent made alone
and everything it left unfinished.

## Test evidence (final runs reported by each agent)

| Branch | Playwright | Vitest | Design lint | pytest |
|---|---|---|---|---|
| foundation | 43 passed, 6 skipped (+6 passed under proxy_headers) | 61 | 35 | 3737 passed, 1 pre-existing failure (`test_spa_navigation_leaves_no_listeners_or_stale_handlers`, fails on `UI-redesign` too) |
| overview-runs-list | 121 passed (whole suite) | 92 | 35 | not run, no backend change |
| run-detail | 150 passed, 6 skipped (`--workers 2`) | 82 | 35 | not run, no backend change |
| compare | 54 passed, 2 axe contrast (fixed on foundation, see below) | 99 | 35 | not run |
| analyzer | 35 + 43 shell passed | 82 | 35 | not run |
| experiments-eval-queue | 54 + 37 passed | 500 | 35 | not run |
| datasets-reviews-trash | 75 passed | 97 | 35 | not run |
| admin-docs | 35 passed, 3 skipped (+2 under proxy_headers) | 65 | 35 | `test_platform_docs.py` 10 passed |
| standalone-uis | 33 passed (SDK server) | 90 | 35 | 576 passed on sdk + restructure + spa suites |

## Suggested merge order into `ui/foundation` (or into `UI-redesign` after it)

1. `ui/foundation` (contains three fixes made after the areas forked: tracked
   `frontend/src/lib`, danger Tag contrast, legacy-redirect slug lookup).
2. `ui/admin-docs`, `ui/datasets-reviews-trash`, `ui/standalone-uis` (few shared-file edits).
3. `ui/overview-runs-list`, then `ui/run-detail`.
4. `ui/compare` (copies ~20 files verbatim from `ui/run-detail@771663e`; manifest in
   `decisions/compare/COPIED_FROM_RUN_DETAIL.md`; identical content should merge as add/add).
5. `ui/analyzer`, then `ui/experiments-eval-queue`.

## Expected conflicts and dedupe list

- `frontend/src/app/router.tsx` and `routes.ts`: every branch replaces its own
  `ComingSoon` entries. Keep all.
- `frontend/e2e/shell/navigation.spec.ts` deep-link expectations: each branch
  updated the rows for its own routes. Keep all.
- `frontend/playwright.config.ts`: runs-list and analyzer removed `QYM_ROLE=api`
  and added a `QYM_PYTHON` fallback; experiments added fake services and
  `QYM_E2E_DB`; standalone added `e2e:sdk`. Union them.
- `.gitignore`: several branches added `!frontend/**/lib/` or `!frontend/src/lib/`;
  foundation now has `!frontend/src/**/lib/`. Keep one.
- `frontend/src/lib/metrics.ts`: run-detail and compare replaced it with the full
  `metrics.js` port (foundation test updated). Take theirs.
- Foundation primitives patched on more than one branch, same intent:
  DataTable selection column (datasets, experiments), Textarea `errorMessage`
  (admin-docs, datasets), Tabs `forceMount` and ScoreValue `text` (run-detail,
  compare), Tag/Button/Select contrast (experiments; Tag also on foundation).
- `frontend/src/features/shell/LegacyRunRedirect.tsx`: analyzer adds the
  `/analyzer` → `/analysis?run=` branch; foundation has the slug fix only.
- `package.json` / lock: new pinned deps are recharts (runs-list),
  @tanstack/react-virtual (run-detail, compare), react-hook-form + zod +
  @hookform/resolvers + CodeMirror packages (experiments), shiki + hast
  packages (admin-docs).

## Known gaps to decide on

- Bundle: the main chunk grew past Vite's 500 kB warning on the experiments
  branch (172 kB gzip); analyzer and run-detail are eagerly imported. Lazy-load
  the heavy pages at integration time.
- Not rebuilt: self-contained HTML export (run page, compare), Sankey, categories
  compare view, item x metric matrix, rule-version lineage graph, root-cause
  dashboard (kill-switched), compare-page analyzer modal.
- Backend untouched except SPA serving and the `/ui` removal; follow-ups logged:
  facet counts, trend origin filter, pass-aware `/api/compare`, server-side CSV,
  proper 404/403 instead of `200 {error}`, Postgres-only `btrim` in
  `/api/corrections?source=`, preset publish without expected-version.
- Experiments: settings widgets use native inputs instead of the shared
  wrappers for performance; environments forms are not on RHF; `ReadOnlyJson`
  built but not wired.
- RTL: SegmentedControl pill offset and Pagination glyphs do not mirror.
- SDK wheel: CI must run `npm run build:sdk` (Node 24) before `pip wheel`, or
  the wheel ships no viewer.
- Cutover (not started): the vanilla `_static/dashboard` pages still serve at
  their old URLs; the React app lives under `/app/*`.
- Some commits after a usage-limit resume carry a "Claude Sonnet 5.5"
  attribution trailer instead of "Claude Fable 5.1".
