# Review: redesign2 runs-polish (ui/redesign2-runs-polish, tip a9d04d9c)

400 seeded runs, ports 8925/5925, legacy on 8927. Real wheel scrolling with 25-40 px deltas, screenshots at 1440 and 390.

## Verdict: NOT YET. One regression of a round-1 item (Date off screen at 1440) and the pass-level Analyze button is hidden at 1440; the rest holds.

## Owner asks

1. Frozen column names static when the table moves: HOLDS. Runs table at 1440 with 40 px wheel steps and a long scroll: RUN and STATUS headers and the
   `Overview` band stay put; the `Context`/`Scores` bands scroll as sticky labels. Probe on the experiments table (scroll 0 to 375) and on the admin
   users, projects, runs and maintenance tables at 760 px (all pinned header and label x identical across 15 wheel steps): static. Datasets had no
   table in my seed (covered by `frozen-static.spec.ts`, which passes). Caveat: the repo probe is a rAF rect probe and cannot see compositor-level
   sticky lag; by eye there was none.
2. Analyze as a button with state: HOLDS on the runs list. Idle `Analyze` (filled purple button with sparkle), `N causes` (outlined, filled sparkle,
   singular/plural right), `Analyzing` (dot, blue). Live runs show a dash. Checked by mocking the list payload and the active-runs route.
   - The `Analyzing` state is dim (blue text on a near-flat chip, small dot); acceptable, could be stronger.
   - Passes panel: the pass-level Analyze column exists but sits at x 1387-1461 at 1440, behind the panel edge; the user must scroll the embedded table
     sideways to find it (visible after a 300 px scroll). The owner asked for a clear button, so on the passes panel it is not clear at 1440. See fix 2.
   - At 390 the card shows Model but Analyze and Task/Dataset sit behind `More` (legacy phone showed the run name only, so not a regression).
3. Richer dataset, model and task tags: HOLDS. Task keeps the mono purple tag; Model is a pill with a coloured dot (teal gpt-4o, blue claude); Dataset is a
   chip with a database glyph. Clearly richer than legacy's flat text/dot, and consistent in the card view at 390.

## Defects
1. **Date is not on screen at 1440 (round-1 item regressed; claim "Date on screen at 1440" is false).** Column order is Run 260, Status 150, Signals, Task,
   Model, Dataset, Analysis, Answer correctness, Date at x=1315 (the Actions column starts at 1306). Date is also the default sort column, so the sort
   arrow is invisible. Legacy shows Owner and Date before Analysis. Move Date (and ideally Owner) ahead of Analysis or the first metric, or
   trim Signals/Task/Model widths.
2. **Pass Analyze button hidden at 1440** (see above): put Analyze before Duration/Issues or drop a low-value column so it is visible at 1440.
3. Duration value and the retry glyph in the Issues cell still touch ("43s", then the icon).
4. Minor: `Analyzing` state contrast.

## Route coverage
`POST /api/analysis-jobs/active-runs` worked live (empty list, unknown ids, 422 over 200 ids) but only the manager had a test. I added
`test_active_analysis_runs_hides_private_runs_from_members` to `tests/platform/test_private_test_sets.py` (admin sees both runs, member does not see the
private one, unknown id dropped, empty body, 201 ids rejected): passes. (Uncommitted in this worktree.)

## Gates
- `npm run check`: 134 files / 1234 Vitest tests, design-language 47: green; build OK.
- Playwright (runs-list, datasets, admin, run-detail, compare, shell, visual-language): 793 passed, 12 skipped, 1 failed
  (`row-actions.spec.ts:126`, menu item wait timeout under load); re-run 3x = 18/18 passed. Treat as a flake.
- pytest `tests/platform/test_analysis_jobs.py` + `test_private_test_sets.py`: 19 passed.
- No regressions seen on the passes panel (no shadow bands, pinned `#`/Status) or run-detail expanded items (specs pass).

## Fix list
1. Date (and Owner) visible at 1440, before Analysis/metrics.
2. Pass-level Analyze visible at 1440.
3. Duration/retry-icon spacing; stronger `Analyzing` styling (optional).
4. Commit the added route test.
