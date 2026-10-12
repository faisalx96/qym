# UI migration: review guide

State as of 2026-10-12. The nine area branches are integrated into one tree
(`ui/integration`) and merged into `UI-redesign` with a plain merge commit.
Nothing was pushed. The `ui/*` branches and their worktrees are kept for reference.

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
