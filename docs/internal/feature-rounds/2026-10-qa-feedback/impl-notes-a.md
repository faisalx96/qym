# WP QA-A implementation notes (datasets: list filter, Settings, Access tab, block links)

Branch `feat/qa-datasets` (worktree `qym-wt-dataset-access`), commits `861ff6ef` to the hand-back tip on top of the design commit `76c98146`.
Spec: `spec-a.md` (156 criteria; amendments in its section 11). Platform port 8983, Vite 5983, e2e DB `.qym-e2e-qa.db`.
Measurements are Playwright Chromium, dark scheme, on the real pages (platform on SQLite, `QYM_AUTH_MODE=none`), widths 1440 / 1024 / 390;
the content column is 1193 / 777 / 279 px. Raw numbers: `measure/out/impl-*.json` (scripts `measure/impl-*.mts`).

## Result

| | Count | Ids |
|---|---|---|
| Met as specified | 150 | everything not listed below |
| Met with an amended number or text (spec section 11, e2e asserts the amended value) | 6 | QA1-4, QA1-20, QA5-44, QA5-62, QG1-7, QG1-9 |
| Not met | 0 | |

Amended: **QA1-4** (the popover is 320 x 519.7 / 359.7 / 318.9 on the bordered Popover surface; a viewport-clamped popover, 448 high at 390 x 900, scrolls
inside), **QA1-20** (long chip 261 x 38.6 at 390, the row is 261 wide), **QA5-44** (bar flush with the host until the content ends, 31.9 px above the
host's bottom padding at the very end), **QA5-62** (dialog 438 wide), **QG1-9** (`a:hover:where(:not([data-link='block']))`), **QG1-7** (breadcrumbs never underline).

## Criterion -> change -> test

| Criteria | Change | Test |
|---|---|---|
| QA1-31 to QA1-40 facets with `kind` (scalar / list / mixed), list elements as values, counts in items, `FACET_SCHEMA = 2` in the cache key | `services/dataset_meta.py` `_walk` (per item: scalar text and a set of the first 200 scalar list elements), `metadata_facets` (kind, omits object / empty-list paths) | `tests/platform/test_dataset_meta_lists.py` (kind, seed counts, counted once per item, objects / nulls / nested lists, 200-element and 200-value caps, cache schema) |
| QA1-41 to QA1-49 `meta=path:value` matches a scalar equal or a list containing it; `meta_mode=path:any|all`; limits and 422 texts | `MetaFilter`, `parse_meta_params(meta, meta_mode)`, `_value_clause`, `apply_meta_filters` (one statement, `OR` / `AND` of `EXISTS`); `meta_mode` query parameter on list, download, neighbors | same file: oracle numbers 46 / 6, 49 / 1, 87 / 22, 65 / 13, 130 / 0, every 422 text, statement count equal for 1 and 20 values, 5,000 items under 1 s; `test_dataset_items_batch.py` (A3-43 superseded case updated) |
| QA1-50, QA1-51 SQLite and PostgreSQL | `json_each` guarded by `json_type = 'array'`; `jsonb_array_elements` inside a `CASE` | SQL cases parametrised on both dialects (PostgreSQL skips without `QYM_TEST_POSTGRES_URL`; the statement is compiled for PostgreSQL in `test_postgresql_clause_renders_the_documented_functions`) |
| QA1-54 to QA1-57 batch `meta` shape | `meta_pairs_from_mapping` accepts scalar or `{values, mode}`, texts of QA1-55, audit stores `filter.meta` as sent | `test_dataset_meta_lists.py` batch cases (dry run 46 / 6, apply, audit, every error) |
| QA1-1 to QA1-18 popover | `detail/MetadataFilter.tsx` + CSS: key descriptions, listbox `aria-multiselectable`, tick, `Value` head with count, `meta-match` (Partial / Full match, help always 2 lines), 20-value limit line, truncated key adds the typed value, scalar key unchanged; `Popover` gets `testId` on the surface and `overflow-y: auto` | `detail/__tests__/MetadataFilter.test.tsx` (10), `e2e/datasets/meta-list-filter.spec.ts` (keys, flow, geometry at 3 widths) |
| QA1-19 to QA1-30 chips, URL, All matching | `lib/metaFilter.ts` (`MetaFilter {path, values, mode}`, canonical order, bad-mode and 20-value rules, chip text, batch object), `route.ts` `metaMode`, `ItemsTab.tsx` (URL read / write, focus on the new chip or the Metadata button), `ItemPage.tsx` neighbors, `ui/Chip` wrap rule, `batchCopy` sentence | `lib/__tests__/metaFilter.test.ts`, `batchCopy.test.ts`, e2e: chip text and sizes 178 x 26 / 198 x 26 / 403 x 26, rows 26 / 56 / 86 / 158.6, reload, remove, All matching dialog and `{values, mode}` body |
| QA5-1 to QA5-16 Settings | `detail/SettingsTab.tsx` (+ CSS): container-query grid (form + 360 px side column from 900), `Card` header slot (`CardHead`), `FieldRow` rows, footer with status; `AccessSection` mount removed | `detail/__tests__/SettingsTab.test.tsx` (9, incl. axe), `e2e/datasets/settings-layout.spec.ts` (boxes 819 / 354.9, 777 / 654.6, 279 / 805.1, titles 15 px from the top, no `/access` request) |
| QA5-17 to QA5-23 tab strip | `route.ts` (`'access'`), `DatasetDetailPage.tsx` (tab with `grant_count` for restricted datasets, `TabPanel`, idle prefetch on the items tab only, `prefetchDatasetAccess`), `ui/Tabs` keeps the selected tab in view | `lib/__tests__/route.test.ts`, `e2e/datasets/access-tab.spec.ts` (order, counts 92 x 34 / 66.8 x 34, URL, prefetch: one GET, 390 scroll) |
| QA5-24 to QA5-52 Access tab (manager) | `detail/AccessTab.tsx` (+ CSS from the mock): Access mode card with side-by-side options from 700 px, People card with the add row on top, `Added` column, Unknown user / You / Not saved, sticky save bar with 4 states, dirty signature, remove-focus | `detail/__tests__/AccessTab.test.tsx` (20), e2e: twelve people 914.8 / 930.1 / 2068.7, none 191.4, one 209.9, columns 160 / 180 / 130 / 48, rows 40, saved-grants help, one PUT, failed save keeps edits |
| QA5-53 to QA5-61 read only, archived, loading, error, 279 px | same file: summary + badge, no Remove / add / save bar, skeleton frame (180.9 / 196.3 / 319.4), `ErrorState` in the card, card list at 390 (124.8 per grant) | e2e: summary 41.6 / 58.4, archived project, loading frame within 1 px, error card, 390 table 1497.4 |
| QA5-62, QA5-63 leave guard | `DatasetDetailPage.tsx` `ConfirmDialog` (Keep editing focused, Discard changes danger), only on the tab strip | e2e leave dialog (click, Escape, Discard, arrow key) |
| QA5-64 to QA5-72 RTL, axe, overflow, long names, heights | same components; no horizontal overflow asserted on every card | e2e Arabic and 60-character names, axe (restricted, project-wide, read only, error at 1440 and 390), `datasets/a11y.spec.ts` covers `tab=access` |
| QA5-73 to QA5-78 API | no change (payload already carried `granted_by`, `created_at`, `grant_count`) | `tests/platform/test_dataset_access.py` (4 new: stable date and granter across a level change, null granter and `ON DELETE SET NULL`, mode and count in catalog and detail, 403 text), e2e one GET per visit |
| QG1-1 to QG1-16 block links | `styles/base.css` `a:hover:where(:not([data-link='block']))`; `data-link="block"` in `ui/Card` (anchors), `StartCard` link, docs pager, `MetaLink`; docs `.article a:hover` carries the same guard | `ui/__tests__/Card.test.tsx`, `design-language.test.ts` (selector, no other underline rule, specificity guard), `e2e/visual-language/link-cards.spec.ts` (cards, pager, run dataset link, start card, plain links keep it, experiments rows, anchor inventory) |
| General: docs | `docs/USER_GUIDE.md` (Access tab, list keys and the two modes) | n/a |

Superseded earlier tests were updated, not weakened: `test_dataset_items_batch.py` (`tags` is now a facet and `tags:x` matches a list; replaced by a miss value),
`e2e/datasets/access.spec.ts` (the Settings -> Access describe moved to `access-tab.spec.ts`; shared helpers moved to `access-support.ts`),
`e2e/datasets/tabs.spec.ts` (the Tags chip group is `role=group`: a `role=list` holding buttons failed axe `aria-required-children`),
`e2e/datasets/a11y.spec.ts` (+ the access tab).

## After-screenshots (`shots/`, each under 300 KB)

Composed surfaces as real pages (compare with `mock-page-*`): `after-page-{access,settings,filter-popover,filter-chips,catalog}-{1440,390}.png`.
State shots: `after-qa-filter-popover-*`, `after-qa-filter-scalar-*`, `after-qa-filter-chips-*`, `after-qa-filter-fivechips-*`, `after-qa-settings-*`,
`after-qa-access-{project,twelve,one,none}-*` (1440, 1024, 390), `after-qa-hover-{project-card,dataset-card,docs-pager,plain-docs-link}-1440.png`.

## Measured numbers (impl vs spec)

| Criterion | Spec | Measured (1440 / 1024 / 390) |
|---|---|---|
| QA1-4 popover, list key 8 values | 519.7 | 519.7 / 519.7 / 519.7 (1500 px viewport); 448 at 390 x 900 (clamped, scrolls) |
| mixed key, scalar key | 359.7, 318.9 | 359.7, 318.9 at all widths; `facet-values` 290 x 266 / 106 / 138; `meta-match` 290 x 58.8, help 30.8 |
| QA1-19 chips | 178 x 26, 198 x 26, 136 x 26 | identical at all widths; five chips: row 26 / 56 / 158.6; long chip 403 x 26 / 403 x 26 / 261 x 38.6 |
| QA5-9 Settings height | 354.9 / 654.6 / 805.1 | 354.9 / 654.6 / 805.1; General 819 x 354.9, Visibility 360 x 165.3, Danger 360 x 152.7 at 1440 |
| QA5-33 whole Access tab, twelve people | 914.8 / 930.1 / 2068.7 | 914.8 / 930.1 / 2068.7; People card 649.9 / 649.9 / 1665.3; table 514 / 514 / 1497.4 |
| QA5-25 to QA5-27 mode card (no saved grants) | 180.9 / 196.3 / 319.4 | 180.9 / 196.3 / 319.4; with the saved note 196.3 / 211.6 / 350.2 |
| QA5-18 tab | 92 x 34 / 66.8 x 34 | 92 x 34, 66.8 x 34, `Access0` / `Access1` 85.5 x 34 |
| QA5-44 sticky bar | 56 high, flush | 56, 0 px at scroll 0 / 100 / 200, 31.9 px at the end (`measure/out/impl-sticky.json`) |
| QG1-1, QG1-2, QG1-4 | `none` on hover, boxes as today | project card 287.8 x 127.4, dataset card 388.3 x 226.4, pager 321.1 x 32 / 179.6 x 32; `textDecorationLine` `none` on the anchor and every text inside; plain docs link `underline` |

## Gate (all through `scripts/heavy.sh`, logs in the orchestrator scratchpad `qa/a-impl/`)

Logs in `/tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/51864cf7-e4e4-455d-967b-8153416bc257/scratchpad/qa/a-impl/`.

| Command (all via `scripts/heavy.sh`) | Result | Log |
|---|---|---|
| `npm run check` (cost 3: tsc, eslint, stylelint, Vitest 184 files / 1553 tests, design test) | pass | `gate-check.log` |
| `npm run build` (cost 2) | pass | `gate-build.log` |
| Playwright `e2e/datasets e2e/visual-language e2e/docs` (cost 3) | 305 passed, 5 failed; the 5 were fixed or re-run: strip scroll (fixed in `Tabs`), docs cross-link and contrast gallery (load flakes, pass on re-run), link-cards runs-list case (replaced), `frozen-static` | `gate-pw1.log`, `gate-pw2.log` |
| Playwright `link-cards` + `access-tab` re-run (cost 3) | 44 passed | `gate-pw3.log` |
| Playwright `frozen-static.spec.ts` (cost 4) | fails with a 120 s `mouse.wheel` timeout; **fails identically on the base commit 76c98146** (temporary worktree), not caused by this round | `gate-pw4.log`, `gate-pw4-base.log` |
| `pytest tests/platform` in 5 chunks of 48 files, `-n 2` (cost 4 each) | 193 files pass; one failure in chunk ac: `test_migrations.py::test_operations_docs_name_the_current_migration_head` (`docs/RELEASE_NOTES.md` names `0086`; file not touched by this WP) | `gate-py-{aa,ab,ac,ad,ae}.log` |
| `pytest tests/platform/test_design_language.py`; Vitest `design-language.test.ts` | pass | in check log |
| `black --check`: fails on untouched `api/datasets.py` too (isort's wrapping style, the repo's); `isort --check` on touched Python files passes | n/a | |
| SDK untouched: `pytest tests/sdk`, `mypy` not run | n/a | |

## Open points for the reviewer

* PostgreSQL was not available: the SQL of QA1-51 is compiled for the dialect in a test and was not executed; run the dual-dialect cases with `QYM_TEST_POSTGRES_URL`.
* `data-testid="meta-popover"` moved from the inner panel to the Popover surface (the bordered box) so the 320 px of the spec is what is measured; the other round's
  `item-state-batch.spec.ts` still passes on it.
* The `Tabs` and `Chip` primitives changed (selected-tab scroll, chip wrap rule); the visual-language folder was re-run.
* The first full run of the sidebar-nav inventory found the specificity bug of the literal `:not()` selector (QG1-9 amendment); the inventory anchor test now
  guards it.

## Fix pass (review-a.md, verdict MEETS WITH FIXES)

| Fix | Criterion | Change | Measured after |
|---|---|---|---|
| F1 | QA1-8, QA1-15, QA1-22 | `MetadataFilter.tsx`: Enter on a typed value already in `chosen` is ignored | `1 selected`, URL `meta=els:k299`, no `meta_mode` (Vitest case + e2e `typed values of a truncated list key`) |
| F2 | QA5-45 | `AccessTab.module.css`: dirty status uses `--text-primary` | computed colour `rgb(237, 237, 240)` (was `rgb(168, 168, 186)`), asserted in `access-tab.spec.ts` |
| F3 | QA5-54 | recorded as data dependent in spec section 11: the e2e seed measures People card 438.45 / table about 360, the reviewer's seed 435.3 / 356.8 (a card whose email fits one line is 1.1 px shorter); no code change | e2e asserts 438.5 / 360 within 4 px |
| F4 | QA5-62 | amended in section 11: dialog 438 x 165 | e2e asserts 438 x 165 within 1 px |
| F5 | QG1-11 | `run-detail/components/SectionNav.tsx` links carry `data-link="block"` | `textDecorationLine` none on hover for every Run sections link (new case in `link-cards.spec.ts`) |

Gate: `npm run check` pass (`fix-check.log`), Playwright (workers 1) meta-list-filter + access-tab + link-cards pass (`fix-pw.log`, the F3 case re-run in `fix-pw2.log`), Vitest `src/features/datasets/detail` 40 pass, `test_design_language.py` pass.
