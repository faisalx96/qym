# Final fix pass (round 2 consolidated review)

Branch `ui/final-review`, on top of `cbfe4207`. One finding group per commit. Screenshots (not committed) are in the
orchestrator scratchpad `ff/shots/final-*.png` at 1440 and 390.

| Finding | What changed | Test | Evidence |
|---|---|---|---|
| F1a | `POST /api/analysis-jobs/active-runs` listed in `ALLOWED` of the archived-project test as a read | `tests/platform/test_archived_project_read_only.py` | passes |
| F1b | Not reproduced: design-language ran green in every `npm run check` of this pass (48 tests) | `design-language.test.ts` | no change needed |
| F2 | Pass@k dots `role="img"`; pass-count buttons name starts with their visible text (and the visible text now has spaces) | `a11y.spec.ts`: repeat run and Arabic multi-pass run, 1440 and 390, zero serious | `final-repeat-panel-*` |
| F3 | Fixed-width fields cap at 100% (TextField, Select, NumberField, SearchField, `.field`), header actions wrap on a phone, stat strip last tile fills the row | `shell/phone-layout.spec.ts` (fails before, passes after) | `final-admin-users-390`, `final-project-settings-390`, `final-projects-390`, `final-overview-390` |
| F4 | Run header: one primary strip (name, status, actions, task / dataset / model tags, start, runtime); owner, project, version, execution context and versioning details behind the chevron, collapsed by default, remembered. 95 px at 1440 (was 420), ~290 px at 390 | `run-detail/overview.spec.ts` (height at most 200, first section on the first screen at 390) | `final-run-header-*` |
| F5 | The section of an RTL value is no longer mirrored: key header left-anchored, only the value text runs RTL in its column | `redesign2-items.spec.ts` (two tests) | `final-arabic-item-1440` |
| F6 | Heatmap: item column capped at 280 px, block as wide as its columns, row hover guide, 30 rows then "Show 30 more" | `repeat.spec.ts` | `final-heatmap-*` |
| F7 | Hover for sweep outcome tiles (now Card), queue "Remote queue" toggle, analysis disclosures, docs toggles, review problem link; hover audit now covers sweep, docs, queue, wizard settings and clickable rows (experiments, dataset items) | `visual-language/hover-audit.spec.ts` | experiments list rows and dataset item rows already reacted (the probe was coarse); explicit row tests added |
| F8 | `--bar-nav-h` 44 px (run section nav, compare bar) and `--bar-action-h` 56 px (home bar, analysis rail, items toolbar); documented | `design-language.test.ts`, `visual-language/sticky-bars.spec.ts` | |
| F9 | Settings step takes the full width; the Review rail becomes the launch bar there; blocks that hold a table are borderless (two nesting levels fewer); `useScrollCue` edge fade on overflowing tables | `experiments/launch/tables.spec.ts` (two tests) | `final-wizard-step4-1440` |
| F10 | `RunName` (sans, mono only for ids), `TaskTag` / `DatasetTag` / `ModelTag` on runs list, overview, admin, run header, analysis header, run name in compare; `promptPreview` for dataset items and analysis targets | unit tests (`entity-tag`, `structured-value`), `datasets/items-table.spec.ts` | |
| F11 | Relationship scatter coloured pass / fail by the analysis metric | `run-detail/charts.spec.ts` | |
| F12 | `--chart-6..8` orange-red, indigo, lime, defined once (the runs-list `palette.css` that re-declared them is removed); error cards `auto-fit`; compare tabs edge cue | `compare/final-fixes.spec.ts` | `final-compare-8-1440` |
| F13 | Scale 22/650, 18/650, 15/600, 13/600 uppercase: `SectionHeader` defaults to 18, panels 15, run-detail group titles 15, hidden h1 of Runs and Charts 22 | `visual-language/heading-scale.spec.ts` (8 pages) | |
| F14 | `--page-max-w` 1233 for the constrained container, `narrow` (`--page-narrow-w`) for profile; repeat visuals use the token | `visual-language/page-width.spec.ts` | |
| F15 | `Card rail="left"|"bottom"|"none"`; sweep tiles and verdict, queue environment cards, root-cause cards on `Card`; home start cards on the Card recipe (1px outline, card padding, rail when chosen; they stay `role=radio`, so still allow-listed) | `ui/__tests__/visual-language.test.tsx` | `final-sweep-tiles-hover-1440` |
| F16 | "Published by", "Back to runs", "From scratch" unchecked and disabled before an environment, steps count `61 · 18 err` on one line, runs-list row focus is a 2 px accent band, a 1,000+ item run opens at 100 rows | `entry.spec.ts`, `table-redesign.spec.ts`, `qa-fixes.spec.ts`, `itemsPaging.test.ts` | |
| F17 | Docs URL expectation fixed; 48 px margin on the Date edge; sweep trigger scrolled above the sticky bar before clicking | the three specs | |

## Gate

- `npm run check`: typecheck, eslint, stylelint, Vitest 140 files / 1,263 tests, design-language 48. Pass.
- `npm run build`, `npm run build:sdk`: pass.
- pytest: 3,264 passed, 0 failed (tests/sdk, the archived-project and design-language tests, then tests/platform in four chunks because one single `-n 2` run is killed by the memory cap).
- `npm run e2e` full: 1,126 passed, 12 skipped, 4 failed. All four were real consequences of F9 or F7 and are fixed: three experiments specs looked for Launch in the Review rail (the `launchButton` helper now also finds the compact bar) and the wizard-settings hover audit found the launch bar's problem link (hover added). Reruns: `launch.spec.ts` 8/8, `sweeps.spec.ts` 3/3, hover audit wizard-settings pass. Then `e2e/experiments` + `e2e/visual-language`: 190 passed, 1 failed (`experiments/a11y.spec.ts` "every page"), a flake (passes alone, twice).
- `npm run e2e:sdk`: 42 passed.

## Skipped or partial

- F4: no score in the strip. The report has no single run score (each metric has its own); the strip carries what the legacy header did.
- F10: the Overview still has no model tag (it never showed one).

## Design-language and tokens

`docs/DESIGN_LANGUAGE.md` changed (heading scale, page widths, sticky bars, Card rail, run name and entities, scroll cue,
series hues). `tokens.css` changed: added `--bar-nav-h`, `--bar-action-h`, `--page-max-w`, `--page-narrow-w`; removed
`--page-constrained-width` and `--action-rail-height`; `--chart-6..8` values changed. New primitives: `RunName`,
`promptPreview`, `useScrollCue` / `scrollCue`. The design pass should expect to merge over these.
