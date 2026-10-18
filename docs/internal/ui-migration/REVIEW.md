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

## Redesign cycle (2026-10-13/14, `ui/redesign-*`)

Product QA on the React app returned four points: tables too simplistic; run detail, compare and cohort
pages should be report-style with a quick-filter sidebar only when items are chosen; the experiments
creation flow lost its simple home page and the per-section wizard; the analysis page felt cluttered
and not smooth. Each point got an investigation brief grounded in the legacy pages
(`redesign/<area>.md`), an implementation branch, an independent review (`redesign/review-<area>.md`)
with a MEETS / DOES NOT MEET verdict, and fix passes until it met the standard.

| Area | Branch and merge | Review rounds | Outcome |
|---|---|---|---|
| Analysis workspace | `ui/redesign-analysis`, acedfcdc | review + 2 polish passes | single page, sticky action rail, Disclosure primitive, stable layout (layout shift 0.0034 over Test + Analyze) |
| Report pages | `ui/redesign-report-pages`, 48e20ba1 | review + 1 fix pass | stacked legacy-ordered sections, ScopeBar + quick-filter sidebar on scope, width-sized charts, ReportSection/ReportLayout primitives |
| Experiments creation | `ui/redesign-experiments-create`, 858db445 | review + 1 polish pass | three-action home page, six-step wizard with Stepper and Collapse, 180 ms step transitions, off under reduced motion |
| Tables | `ui/redesign-tables`, 1692c526 | review (DOES NOT MEET) + re-implementation + re-review | DataTable v2 (own markup, density, zebra, bands, pinning, column menu, roving header focus, expansion, grouping, Toolbar/Footer, cell kit, card mode) adopted on every table incl. Charts |
| Tables pass 2 | `ui/redesign-tables-pass2`, 3fcad9b8 | review + fix pass + re-check | run-detail items (virtualized, page-scroller sticky header) and compare matrix on DataTable v2 |

Deferred from the redesign (each listed in the area's brief under "## Deferred" / "## Pass 2"): default-preset
editor wizard (~6 h), `?` shortcut sheet and Ctrl+A in DataTable, dataset item preview, experiments search, the
queue filters stacking at 390 px, the sticky home bar covering part of the Start-from cards at 390 px.

Process note: the first implementation round OOM-killed the Claude session (four agents running full Vitest and
Playwright at once on a 15 GB machine). Vitest is now capped at 4 workers (`VITEST_MAX_WORKERS`) and heavy test
runs are serialized through a lock when several agents share the machine.

### Final gate on `UI-redesign` 3fcad9b8

| Suite | Result |
|---|---|
| `npm run check` | clean; Vitest 1148 tests, design-language 36 |
| `npm run build`, `npm run build:sdk` | ok |
| Full Playwright `--workers 2` | 959 passed, 11 skipped, 1 failed (`runs-list/cutover-columns.spec.ts:124`, load flake: 18/18 when run alone 3 times) |
| `npm run e2e:sdk` | 42 passed |
| `pytest -q -n 4 tests/platform tests/sdk tests/test_restructure.py` | 3338 passed, 744 skipped, 0 failed |

## Redesign round 2 (2026-10-14/15, `ui/redesign2-*`, `ui/final-*`, `ui/design-pass`)

Second product QA round: runs page (filters inline, column order and freezing, passes analysis), run detail
(grey boxes, repeat analysis, collapsed trace steps, one visual per row in deep analysis, categories, item
expansion with RTL input, JSON output split per key, metric panel like the old design), traces viewer, compare
page, and "interactive instead of static single colours". Follow-ups asked for during the round: static frozen
column names, an explicit Analyze button, old-design task/dataset/model tags, versions on the experiments home,
global override sweeps, every schema list as an override table, raw JSON hidden on review, then a colour review
and a typeface study with the winner implemented. Same cycle as round 1: briefs `redesign2/<area>.md`, one
branch per area, independent review `redesign2/review-<area>.md`, fix passes, `--no-ff` merge.

| Area | Branch and merge | Review rounds | Outcome |
|---|---|---|---|
| Visual-language foundation | `ui/redesign2-visual-language`, 9abcdecf; polish f4bb9bcd | review + polish | tone/band/series tint recipe in `tones.css`, hover and focus rules, chart highlight, hover audit spec |
| Runs page | `ui/redesign2-runs-page`, 8a74b7aa | review (2 CSS blockers) + fix | inline facets, column manager with frozen and scrolling groups, drag and keyboard reorder, passes panel |
| Run detail and traces | `ui/redesign2-run-detail`, 84436948 | review + fix | flat item sections, repeat panel, collapsed trace rows, one visual per row, category keys, JSON sections, metric reason panel, trace drawer |
| Runs polish | `ui/redesign2-runs-polish`, a96959fb | review + fix | frozen band cells cut at the freeze line, `AnalyzeAction` with states (`POST /api/analysis-jobs/active-runs`), `ui/EntityTag` |
| Experiments creation | `ui/redesign2-experiments-versions`, 8dab3e1b | review + polish | versions card on home, global sweeps (one run per value, zipped in `doc.links`), `listTableModel` override tables for every schema list, raw JSON behind a button |
| Compare | `ui/redesign2-compare`, b4c21515 | review + fix + re-review | RunTag identity, 44 px sticky bar, metric-rows x run-columns averages, category/error cards, aligned items, run-focus dimming |
| Final consolidated review | `ui/final-review`, f86ce560 | review (16/18 met, 2 partly) + fix pass (17 findings) + re-review (Pass) | run header 95 px, RTL key headers left-anchored, heatmap capped, a11y on the repeat panel, 390 px overflows, bar/page-width tokens, `RunName`, `promptPreview`, `useScrollCue`, `Card rail` |
| Design pass | `ui/design-pass`, 7e2e6242 | review (MEETS WITH FIXES) + fix + re-review (MEETS) | self-hosted IBM Plex Sans / Plex Sans Arabic / Plex Mono (7 subset woff2, 138 KB, OFL), metric-matched fallbacks, tabular numerals in tables, CVD-checked series palette and score ramp, stronger hairlines, `typeface-study.md` and `colour-review.md` |
| Final polish | `ui/final-polish`, 3cd22bb8 | implementation + targeted gate | analysis hover, 56 px action bars, entity tags on Overview/Admin, analysis headings, `Card` everywhere, compact error cards, single `WizardBar`, sweep headings |

Typeface decision: IBM Plex, because its Arabic and Latin were designed together (optical-size ratio 0.95 versus
0.78 to 1.04 for the other pairings), one family covers UI, Arabic and data with real tabular figures, and the
self-hosted subset costs 138 KB with no layout shift on swap. Export templates keep the system stack on purpose;
the SDK viewer inlines the fonts (about 384 KB). Known cosmetic issue: some bold Plex pairs in tracked uppercase
labels ("DAT E") rasterise unevenly in headless Chromium on Linux; `text-rendering: geometricPrecision` is a
mitigation only.

Deferred from round 2: compare of 2 runs has no baseline select (product decision); runs-list phone drawer is a
side panel rather than a bottom sheet; the home sticky bar covers lower cards at 390; experiments object-list
columns are covered by Vitest only; the run items toolbar wraps to two rows between 761 and 1439 px; bespoke card
frames remain in analyzer guidance, datasets and reviews; `e2e:sdk` `qa-fixes.spec.ts:140` (elapsed clock) is a
timing flake under parallel load. Backend: `POST /api/analysis-jobs/active-runs` is classified as a read.

Process note: a second session kill (systemd-oomd on sustained user-slice memory pressure, no true OOM) led to
`scripts/heavy.sh`: memory admission, machine-sized slots, worker caps from available memory, and a transient
cgroup with `MemoryHigh` so a test run dies instead of the session. Every full suite and build in this round ran
through it. Docker: the UI build moved to `docker/Dockerfile.frontend` with `FRONTEND_IMAGE` / `CUSTOM_FRONTEND_IMAGE`
(commit 21890fda).

### Final gate on `UI-redesign` 3cd22bb8

| Suite | Result |
|---|---|
| `npm run check` | clean; Vitest 1265 tests, design-language 49 |
| `npm run build`, `npm run build:sdk` | ok |
| Full Playwright (`heavy.sh`, workers from memory) | 1142 passed, 12 skipped, 0 failed (23.8 min) |
| `npm run e2e:sdk` | 42 passed |
| `pytest -q -n 2 tests/sdk`, `tests/platform` (platform in 4 chunks; one `-n 2` run was killed by the heavy.sh memory cap) | 3263 passed, 744 skipped, 0 failed |

## Redesign round 3 (2026-10-15/17, `ui/redesign3-run-detail`)

Third product QA round, all on run detail: graphs (counts above bars, charts centred in their own boxes), repeat
analysis (metric from a dropdown, full-width rows, separate centred statistic boxes, no grouping), categories
(like the old design), the items column header hovering over an expanded item, item details (input and output
anchored on the same side, output separated from metrics, output keys collapsed with Expand all, pass colours),
the run header that had lost too many details (added mid-round), and box plots for metrics that used to show
min / avg / max / total (added mid-round). The user's standing instruction for the round: "invest heavily in UI
design and strict adherence to it in implementation", so the cycle gained a design stage: a designer measured the
current and legacy pages, wrote the spec `redesign3/run-detail.md` with numbered acceptance criteria (P1 to P7,
about 100), per-width layouts and static mocks in the gallery (`/__ui#round3`, shots `redesign3/shots/mock-*`);
the implementer worked criterion by criterion (`redesign3/impl-notes.md`, shots `after-*`); an independent
reviewer measured every criterion in the browser (`redesign3/review-run-detail.md`).

| Point | Change | Review |
|---|---|---|
| P1 graphs | `ChartCard` (`Card fill`) for every chart, column recipe with the count above each bar, boolean split as the same chart, labelled curve points, reduced-motion guards | met |
| P2 repeat | one metric `Select` bound to `?metric=`, seven separate centred `StatTiles` (no groups), curve and distribution side by side from 1100 px, `PassTable` on DataTable with a metrics picker | met; section ceiling amended at 390 (1,950) and for numeric metrics (by-pass box card) |
| P3 categories | one key at a time (`SegmentedControl` / `Select`), six rows plus "Show all", overall-average tick, `?category=` | met; ceiling amended 460 to 540 (the old number compared a section to a body-only mock) |
| P4 sticky header | items column header held above an expanded item, 32 px `ItemBar` owns the sticky line with Collapse (`stickyShift`) | met (0 px overlap in a scroll sweep) |
| P5 item details | single left anchor (dir only on value text), output keys collapsed with recursive Expand all / Collapse all (`KeyTree`), divider and Metrics heading, metric x pass `MetricMatrix`, up to 3 pass columns, passes shown by number and verdict tone instead of hue | met |
| P6 run header | chevron removed; three always-visible bands (identity and actions; seven facts; versioning / config / metadata chips with a clamp and "+ N more") | met at 1440 (188 px, every field); at 390 the clamp went to five lines and the ceiling to 570 after the first review (554 px, 7 of 8 chips, no truncation) |
| P7 box plots | `BoxPlot` (p25 to p75 box, median line, hollow mean diamond, p5 to p95 whiskers, outliers capped at 40 a side) replaces Min / Avg / Max / Total on numeric metric cards, with the six numbers always visible; new Tokens per item and Cost per item cards; latency strip under the histogram; per-pass box rows in Repeat; step timings on the same mark; bar and box clicks write filter rules | met (20 of 20) |

Review: first pass MEETS WITH FIXES (4 criteria not met: P2-12, P3-8, P6-1 and P6-8 at 390), fix commit 0be574e4,
re-review MEETS. Spec amendments made during the fixes (P1-10, P2-12, P3-8, P6-3, P6-8) are each recorded with the
measured number and a reason in `run-detail.md`, and the reviewer judged each as measured reality rather than
convenience. Design decisions worth knowing: passes carry no colour (ten distinguishable hues cannot reach the
palette's perceptual-distance rule, so passes are a number plus a pass / fail tone); the gallery mocks stay static
design contracts rather than being rebuilt on the shipped components; `Row.pass_scores` is present in the compact
run payload, so no new endpoint was needed for the per-pass box rows.

Deferred from round 3: the by-pass table at 390 cuts the Errors header when the picked metric name is long
(e.g. `rubric_metric_01`); histogram x labels in the 4-up overview are tight (15 to 17 px gaps, no overlap);
the runs-list Passes panel still cycles three series colours; `e2e:sdk` `qa-fixes.spec.ts` "elapsed clock stops while
reconnecting" flaked once under load and passed on rerun. Commits `aafb3516` to `9bbbdc53` on the branch carry the
"Claude Sonnet 5.5" attribution trailer.

### Final gate on `UI-redesign` 741ec52e

| Suite | Result |
|---|---|
| `npm run check` | clean; Vitest 1356 tests (154 files), design-language 49 |
| `npm run build`, `npm run build:sdk` | ok |
| `pytest tests/platform/test_design_language.py` | 1 passed |
| Full Playwright (`heavy.sh --cost 4`) | 1238 passed, 12 skipped, 0 failed (25.6 min) |
| `npm run e2e:sdk` | 41 passed, 1 failed (`qa-fixes.spec.ts:140` elapsed clock, the known timing flake); rerun alone twice: 18 passed |
| `pytest -q -n 2 tests/sdk` | 496 passed, 4 skipped |
| `pytest -q -n 2 tests/platform` (4 chunks, `heavy.sh --cost 4`; `--cost 5` never admits while the desktop leaves under 8 GB free) | 2767 passed, 740 skipped, 0 failed |

## Redesign round 4 (2026-10-17/18, `ui/redesign4-runs-passes`)

One runs-page point: "per pass table should be part of the main table but hidden unless the user clicks the drop down
button to ensure that table navigation will move the main and per pass results to compare their metrics against each
other." First round run under the design, implement, measured-review cycle from the post-mortem.

- Design (`redesign4/runs-passes.md`, 32 criteria, mocks at `/__ui#round4`): measured the defect (a pass score cell stayed
  at x 711 while the run's moved from 1240 to 840 on a 400 px scroll; reorder not mirrored; a frozen column put the pass
  value 227 px from the run's) and the legacy page, which inserted pass rows into the same table body.
- Implementation: `DataTable` gains `childRows`; passes are `<tr>` of the same tbody rendered by the same cell renderer, so
  reorder, freeze, hide, resize, scroll, density, selection, keyboard and virtualisation apply with no mirror. The group
  metrics strip (metric, threshold, five stats) is one full-width row under the passes. The embedded `PassesTable` and the
  mirrored column model are deleted. Open groups persist per session. Run-level cells are blank in pass rows.
- Review (`redesign4/review-runs-passes.md`): 32 of 32 met in the product, measured after 400 and 1000 px scrolls, a
  six-place reorder, freeze, hide, resize, every density and a sort: pass cells equal the run cells to 0.0 px in all 24
  columns. MEETS WITH FIXES for one test that never virtualised; the stronger test then exposed and fixed a real bug (the
  scroller reset to the top when the row count first crossed the 200-row virtualisation threshold). Merged df9d0a1a.
- Deferred: `group-metrics` is requested twice on first expand (served from cache); open pass lines inside the phone cards
  host; j/k on the runs page still step between runs only.

### Gate on `UI-redesign` df9d0a1a

| Suite | Result |
|---|---|
| `npm run check` | clean; Vitest 1374 tests (157 files), design-language 49 |
| `npm run build`, `npm run build:sdk` | ok |
| `pytest tests/platform/test_design_language.py` | 1 passed |
| Full Playwright (`heavy.sh --cost 4`) | 1232 passed, 12 skipped, 2 failed (`experiments/launch/evaluation.spec.ts:89`, `runs-list/cutover-overview.spec.ts:53`); both rerun alone twice: 18 passed, load flakes |
| `npm run e2e:sdk` | 42 passed |
| `tests/platform` | not run (backend untouched) |

## Post-mortem

The failures of the whole migration (two session kills, repeated feedback rounds, a finding fixed by hiding
information, spec numbers from the wrong geometry, hue as identity, non-fixes accepted) and the rules they
produced are in `POSTMORTEM.md`; the rules themselves live in `AGENTS.md`, `docs/DESIGN_LANGUAGE.md` section 7
and `00-PLAYBOOK.md`.

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
