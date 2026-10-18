# Redesign round 4, implementation notes: per-pass rows inside the runs table

Branch `ui/redesign4-runs-passes`. Spec: `runs-passes.md` (Q1..Q32, amendments in section 9). Tests: Playwright
`frontend/e2e/runs-list/passes-rows.spec.ts` (one test per criterion group, named Q1..Q32), Vitest
`ui/DataTable/__tests__/childRows.test.ts`, `features/runs-list/__tests__/passChildren.test.ts`, `expandedStorage.test.ts`.
Measured 2026-10-17 on the r4-seed project (1440 x 900, compact) and by the specs.

## What changed

- `frontend/src/ui/DataTable/`: new `childRows` prop (+ `childLabel`, `detailLabel`, `childGroupLabel`, `cardChildColumns`).
  `buildDisplayRows` emits `child` entries after their parent and the `detail` entry (the strip) after the last child; child
  rows are `<tr>` of the same `tbody` rendered by the same `renderTd` (so order, freeze, hide, resize and widths are shared
  by construction), `aria-level` 2 / `aria-posinset` / `aria-setsize`, keyboard (Arrow Left to the parent), selection and
  focus keyed by the child's own key, card mode lines inside the parent's card. `renderExpanded` is untouched for other callers.
- `frontend/src/features/runs-list/`: `RunsTable` rows are `TableRow` (run, pass, queued, loading, error); `passes/rows.ts`
  maps the passes query to child rows; `passes/PassCells.tsx` are the pass cells; `passes/PassGroupStrip.tsx` is the strip;
  `passes/expandedStorage.ts` keeps the open groups in `sessionStorage`. Removed: `PassesPanel`, `PassesTable` and their CSS,
  `mirroredMetrics`, the "Show all metrics" state, `RunsCtx.visibleMetrics`.

## Criterion -> change -> test

| Q | Change | Test (passes-rows.spec.ts unless noted) |
|---|---|---|
| Q1 | collapsed: no child entries, no passes request until the first expand | `Q1 collapsed by default` |
| Q2 | `childRows` entries in the same tbody; chevron unchanged (`RunNameCell`) | `Q2 chevron adds the passes as rows of the same table` |
| Q3 | chevron IconButton keeps focus; row ArrowRight/Left; child ArrowLeft -> parent (`onBodyKeyDown`) | `Q3 keyboard` |
| Q4 | one `renderTd` for run and child rows | `Q4 pass cells line up with the run cells` (all columns, left and width within 0.5 px) |
| Q5 | same scroller | `Q5 scroll moves run and passes together` |
| Q6 | same `renderCols` | `Q6 reorder applies to the passes` |
| Q7 | same pins and offsets; child cells use the opaque `--row-base` | `Q7 a frozen column applies to the passes` |
| Q8 | hidden columns and widths come from the one model; footer removed | `Q8 hide and resize apply to the passes` |
| Q9 | child rows use `--row-h` | `Q9 density` (32 / 40 / 52) |
| Q10-Q12 | `passes/PassCells.tsx`, `childCell()` in `RunsTable.tsx`, one delete dialog in `RunsTable` | `Q10 to Q12 cells and actions`; `cutover-passes.spec.ts`, `readonly.spec.ts`, `passes.spec.ts` (delete, renumber, permissions) |
| Q13 | `.childRow` (`--bg-void`, 3 px `--rail-width` rail, no opacity), strip `box-shadow` rail | `Q13 group marker` |
| Q14-Q17 | `PassGroupStrip` in the `detail` row (`detailFit="viewport"` hold); one flex-wrap row | `Q14 to Q17 the strip`; `Q15 at 1024` |
| Q18 | children are emitted by the display builder after each run | `Q18 sort keeps the passes under their run` |
| Q19 | `applySelection` in `RunsTable` maps the table's key diff to run toggles and pass picks; same `passRef` model | `Q19 select mode`; `passes.spec.ts` (executions count, exclusivity, compare) |
| Q20 | children and strip are display entries of the virtualiser | `Q20 many open groups stay continuous` (50 runs, 12 x 10 passes: rowcount, data-index continuity, scroll, no console error, parent y within 1 px) |
| Q21, Q22 | `childRowsOf` loading/error rows, `aria-busy` on the run row | `Q21 to Q22 loading and error states` |
| Q23 | `passRowsView` queued row | `Q23 queued passes` |
| Q24 | `useRunPassesMany` refetch 15 s; keys are pass refs | `Q24 live refetch keeps the rows and the focus` |
| Q25 | `qym:runs:expanded:<slug>` mirrored by `RunsPage` | `Q25 persistence`; `expandedStorage.test.ts` |
| Q26 | treegrid, aria-level / posinset / setsize, row labels | `Q26 accessibility` (axe serious/critical: 0, also with the select column) |
| Q27 | 32 px rows, 44 + 1 px strip | `Q27 heights` |
| Q28-Q30 | `CardList` renders `kids` + strip inside the card; checkbox indeterminate on the card | `Q28 to Q30`, `Q30 card select mode` |
| Q31 | `.childRow` fade (120 ms opacity), none under reduced motion | `Q31 motion` |
| Q32 | components deleted | `Q32 the embedded panel is gone`, `Q32 no embedded panel at 390` |

## Measured (r4-seed, 1440 x 900, compact)

| What | Spec | Measured |
|---|---|---|
| run row / pass row height | 32 / 32 | 32 / 32 |
| strip height at 1440 / 1024 / 390 | <= 56 / <= 96 / <= 190 | 44 (+1 border row 45) / 55.4 / 166.6 |
| 3-pass group added height | 141 (<= 150) | 141 |
| 10-pass group added height | 365 (<= 380) | 365 |
| `Pass n` x vs run name x | <= 1 px | 0 (243 / 243) |
| pass cell left vs run cell left (all columns) | <= 0.5 px | 0 |
| card pass line height at 390 | <= 56 | 50.6 |
| today's panel (for comparison) | 270 / 494 | removed |

## Deviations (each with its reason; all are also written into the spec, section 9)

1. `ChildRows<R>` is `{ rows, detail? }`, not the three-state union: loading, error and queued are rows of the page's `TableRow`
   union, so the primitive stays free of data states.
2. Q21: the strip frame (`Loading group metrics...`, 45 px) is drawn while the passes load; otherwise the strip's 45 px arrive
   as a shift and the 0 px criterion cannot hold.
3. Q19 / Q30: the native checkbox `indeterminate` property is asserted, not `aria-checked="mixed"` (React Aria does not emit it).
4. Q28: the pass lines are a `div[role=group]` wrapping a `ul` (axe: `li` must sit in a list, not in `role=group`).
5. Q31: reduced motion gives `transition-duration` 0.001 ms (the global rule in `base.css`), not 0; the row animation is `none`.
6. Q15: the controls share a vertical centre within 2 px (measured 1); their tops differ by up to 6 px (different heights).
7. Q23: en dash in `Passes 3–5 waiting to start` (the existing `queuedText`); the e2e seed cannot start two passes of a running
   run, so the test rewrites the passes response (samples 5, two passes).
8. Q3: the strip is not an Arrow Up/Down stop (its controls are Tab stops).
9. j/k on the page still step between runs (the page owns that cursor); arrow keys inside the table walk run and pass rows.
10. `IssuesCell` moved to `passes/PassCells.tsx`; pass rows carry `data-parent-run` (`data-run-id` stays the run-row marker).
11. Specs: `passes-panel-layout.spec.ts` is deleted (its five tests are replaced by Q13, Q14 to Q17, Q27, Q31, Q28 to Q30 in
    `passes-rows.spec.ts`: the panel no longer exists); the other passes specs only changed locators (panel region -> the
    runs table, `Select pass n of 3 of run NAME`, `Delete pass n` is a button, no menu step) and keep every assertion
    (threshold, metric select, Analyze, delete, selection, readonly, live refetch).

## Gate (through `scripts/heavy.sh`, worktree root, ports 8983 / 5983)

| Step | Result |
|---|---|
| `npm run check` (cost 3): tsc, eslint, stylelint, Vitest, design test | green: 157 Vitest files / 1373 tests, design test 49 |
| Playwright `runs-list` + `shell` + `visual-language` (cost 4) | 385 passed, 9 skipped, 3 failed; the 3 (a11y spec still asked for `grid`, renumber spec read the old `#n` cell, round-4 gallery card mock had invalid list markup) were fixed with reasons in the commit and passed on rerun (19 passed) |
| `npm run build` and `npm run build:sdk` (cost 2) | both built |
| `pytest tests/platform/test_design_language.py` | 1 passed |
| full `npm run e2e` (cost 4), once | 1253 passed, 12 skipped, 2 failed; `Q1` raced the table render (count before the chevron existed; now `toHaveCount`), `run-detail/redesign2-items` "JSON output ... Raw" is outside this area (viewport click); both passed on two reruns alone |
| backend | not touched, `tests/platform` not run |

## Review fixes (review-runs-passes.md, MEETS WITH FIXES)

- F1 (required): `Q20` now seeds 20 ten-pass runs among 50 (30 + 20 x 12 = 270 display rows), asserts `aria-rowcount` > 200,
  DOM `tr[data-index]` count below half of it, `data-index` continuous, the opened run row keeps its y (<= 1 px) and 0 console
  errors. The criterion's arithmetic is corrected: 12 groups give 182 rows (under the 200 threshold), 18 or more are needed.
  The stronger test found a real bug the old one could not reach: when the list passes 200 rows mid-session, turning
  virtualisation on reset the scroller to the top (scrollTop 5433 -> 0 at the 14th expansion). Fix: `initialOffset` of the
  virtualizer reads the scroller's current `scrollTop`; row estimates now follow the density (32 / 40 / 52, 45 for a full-width
  block) instead of a flat 40. Measured after the fix: scrollTop 5802..7627 kept over expansions 14..19, DOM 36 to 37 rows for
  249 to 260 display rows.
- F3: `aria-setsize` of a pass row is the run's sample count (`ChildRows.setsize`; 5 with two started passes), tested in `Q23`
  and `passChildren.test.ts`.
- F5: the open run's name link is weight 600 like its cells (`.tr[data-group-open] > td a`).
- F2 (`group-metrics` requested twice on first expand): not changed, optional; the second request is the same cached query.
