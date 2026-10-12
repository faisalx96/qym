# UI migration: review guide

State as of 2026-10-12 (end of day). The nine area branches were integrated into one tree
(`ui/integration`) and merged into `UI-redesign`; the React app then became the official UI
(`ui/cutover`, see `CUTOVER.md`); a per-component QA cycle and a UX review followed on `ui/qa`
(see `qa/`). Nothing was pushed. The `ui/*` branches and their worktrees are kept for reference.

## QA cycle and UX review (`ui/qa`)

Each component got a QA agent (inventory of the vanilla behaviour, mapping to the React code,
rows classified OK / CHANGED / BUGGY / MISSING), an implementation agent for the fix list, and a
re-review. Files: `qa/<area>.md`, each with "## Fix list", "## Deferred" and "## Re-review".

| Area | Rows | BUGGY | MISSING | Deferred (estimate) |
|---|---|---|---|---|
| shell | 153 | 15 | 7 | 6 small items, mostly copy and prefetch (about 2 days total) |
| runs-list | 168 | 11 | 14 | Run-name column toggle, Charts load cap, best-pass chips (about 5 h) |
| run-detail | 161 | 11 | 17 | offline export 4-5 d, categories compare 2-3 d, Sankey 2 d, deep tabs 5-6 d, catalog editing 1.5 d, legacy editors 2 d |
| compare | 116 | 12 | 6 | Auto-Analyze overlay 2 d, Sankey 1.5 d (both replaced by lighter equivalents) |
| analyzer | 165 | all closed | | lineage graph 2 d, cosmetics 1 d |
| experiments | 132 | 4 | 5 | All/Filtered switch on Models (0.5 d) |
| datasets | 170 | 8 | 6 | version links, item history order, cosmetics (about 4 h) |
| admin-docs | 133 | 10 (incl. MISSING) | | none |
| sdk-viewer | 118 | 15 | 8 | column controls 1 d, error-class counters 1 d |

Every BUGGY or MISSING row is either FIXED (commit hash in the file) and re-verified, or in the
Deferred list with an estimate. Backend fixes made on the way: `func.trim` instead of `btrim`
in `/api/corrections`, `pass_revision` on `/api/runs/{id}/passes`, the "Empty / Missing" facet 500
in `run_versioning.py`, the dev-user `IntegrityError` race in `auth.py`, SDK viewer busy-port handling.

The UX review (`qa/UX_REVIEW.md`) ran four reviewers over every page by mouse, keyboard, viewport,
theme, hostile input and injected errors: 0 blockers, 19 majors (all fixed), 26 minors (18 fixed),
17 nits (1 fixed); about 40 regression specs (`e2e/**/ux-*.spec.ts`). Open items that need a
product call: runs table at 390 px has no scroll cue, item/trace/filter changes replace history,
issue dialog text lost on backdrop click, `--score-1` contrast on elevated surfaces, keyboard-delete
focus return on the runs list, project-name max length differs between create and rename.

Final test counts at the `ui/qa` tip (`e282d65a`):

| Suite | Result |
|---|---|
| `npm run check` | clean; Vitest 1091 tests (117 files), design-language 34, prettier clean |
| Full Playwright `--workers 2` (platform 8812, Vite 5812) | 874 passed, 11 skipped (proxy_headers specs), 0 failed, 16 min |
| `npm run e2e:sdk` | 42 passed |
| `pytest -q -n 4 tests/platform tests/sdk tests/test_restructure.py` | 3336 passed, 744 skipped, 0 failed |

## Integration state

| Item | Value |
|---|---|
| Merge into `UI-redesign` | `89025c2` (`merge: integrate the React frontend (ui/integration)`) |
| `ui/integration` tip | `16289eb` |
| Base | `ui/foundation` (`a3b3446`), then eight `--no-ff` merges |
| Merge order | admin-docs, datasets-reviews-trash, standalone-uis, overview-runs-list, run-detail, compare, analyzer, experiments-eval-queue |

Hand-merged files (the places where two branches changed the same behaviour):

- `frontend/src/features/shell/hooks.ts` `useContentScrollRestoration`: foundation's scroll-listener
  recording plus run-detail's "same-path REPLACE keeps the scroll". A same-path REPLACE carries the
  entry's offset to its new key and does not cancel an in-flight Back restore.
- `frontend/src/features/shell/LegacyRunRedirect.tsx`: foundation slug lookup, run-detail's
  `run.project_slug`, analyzer's `/run/:id/analyzer` to `/analysis?run=`.
- `frontend/src/app/router.tsx`: every real route, no `ComingSoon` left in the route table.
  Overview, Charts, run detail, compare, analyzer, datasets, reviews, trash, admin, docs and the
  experiments area go through `app/lazyPage.tsx`. `runs/*/analyzer` is wrapped by `RunAnalyzerRedirect`.
- `frontend/playwright.config.ts`: union (`QYM_PYTHON` fallback, `globalSetup`, `QYM_E2E_DB`, fake
  Evaluation Services, stub LLM, `QYM_ALLOW_PRIVATE_LLM_BASE_URLS`, `QYM_ROLE=all`).
- `packages/platform/qym_platform/auth.py`: one dev-user `IntegrityError` fix.
- `.gitignore`: one `!frontend/src/**/lib/` rule; `frontend/tsconfig.node.tsbuildinfo` untracked
  (ignored by `frontend/.gitignore`).
- `frontend/src/lib/{metrics,url-state}.ts` and `__tests__/lib.test.ts`: run-detail's versions.
- `frontend/e2e/shell/navigation.spec.ts`: deep-link table is the union of all areas.

Two spec fixes the merge exposed (not product changes): the admin maintenance polling spec now pins the
job to `running` in the list response (the e2e platform runs its workers, which finish a queued job in
seconds), and the experiments a11y spec seeds its world under the fake-services lock.

## Test evidence (on `ui/integration` 16289eb)

| Suite | Result |
|---|---|
| `npm run check` (tsc, eslint, stylelint, vitest, design-language) | clean; Vitest 702 passed (68 files), design-language 35 |
| `npm run build` | entry chunk `index-*.js` 302 kB (97.7 kB gzip), largest lazy chunks 432 kB (CodeMirror), 407 kB (docs search), 386 kB (TrendChart); no chunk over 500 kB |
| `npm run build:sdk` | `app.js` 171 kB (56 kB gzip) |
| Playwright `--workers 2` (platform 8809, Vite 5809) | 531 passed, 9 skipped (proxy_headers specs), 0 failed |
| `npm run e2e:sdk` | 33 passed (single worker; it shares one fixture server) |
| `pytest -q -n 4 tests/platform tests/sdk tests/test_restructure.py` | 4229 passed, 742 skipped, 2 failed: `test_spa_navigation_leaves_no_listeners_or_stale_handlers` (pre-existing, fails on `UI-redesign`) and `test_source_api_preserves_repeated_offpage_details_search_edit_and_csv[run]` (timing flake under `-n 4`, passes alone) |

## Known gaps to decide on

Collected from every area's `decisions/<area>/OPEN_QUESTIONS.md`; read those for the full lists.

- Not rebuilt: self-contained HTML export (run page, compare), Sankey, categories "Compare" view,
  item x metric matrix, quality-latency frontier, by-pass trend, stability map, rule-version lineage
  graph, root-cause dashboard (kill-switched), legacy item-level diagnosis editors,
  category-catalog editing in the issue dialog, Charts first-column resize and scroll mirror,
  admin provider configuration UI.
- Backend follow-ups: facet counts, trend origin filter, pass-aware `/api/compare` and
  `pass_number` scoping, server-side CSV / `export-html` for compare, proper 404/403 instead of
  `200 {error}`, Postgres-only `btrim` in `/api/corrections?source=corrected` (500 on SQLite),
  preset publish without expected-version.
- Experiments: environment forms are not on react-hook-form; array and free-object leaves edit as
  JSON text; not verified against a live Evaluation Service with every type.
- Docs: the full-text search index chunk is ~400 kB raw (cap per page or move server side);
  `tests/platform/test_design_language.py` still freezes `docs.css` sizes until the vanilla page goes.
- Runs list: Charts refreshes every 60 s (vanilla was 15 s with live runs); the run-detail page
  still carries two unreachable `ComingSoon` fallbacks in `RunDetailPage.tsx`.
- Compare: Auto-Analyze modal dropped (links to the analyzer workspace instead); domain filter
  "is any of" semantics differ from the old AND.
- Standalone SDK viewer: rows windowed 200 at a time; CI (`.github/workflows/tests.yml`) builds the
  wheel without `npm run build:sdk` and pins Node 22 while `frontend/` needs 24, so a CI-built wheel
  has no viewer; `--no-ui` semantics changed.
- Under `QYM_AUTH_MODE=proxy_headers` the SPA 401 panel can only say "identity missing".
- RTL: SegmentedControl pill offset and Pagination glyphs do not mirror.
- SDK wheel: CI must run `npm run build:sdk` (Node 24) before `pip wheel`.
- Cutover (not started): the vanilla `_static/dashboard` pages still serve at their old URLs; the
  React app lives under `/app/*`.
- Some commits after a usage-limit resume carry a "Claude Sonnet 5.5" attribution trailer instead
  of "Claude Fable 5.1".
