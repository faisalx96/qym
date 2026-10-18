# Round 5 implementation notes (run detail)

Branch `ui/redesign5-run-detail`. Spec: `run-detail.md` (51 criteria R1-1 .. R3-23 plus the owner's mid-round R4). Fixture: `seedR5`
(`frontend/e2e/run-detail/seed.ts`, from `seed-r5.mts`). After-shots: `shots/after-r5-*.png`, `shots/after-r4-*.png` (before: `before-r4-*`).

## Criterion -> change -> test

| Criteria | Change | Test |
|---|---|---|
| R1-1 .. R1-12 | `BarColumns` well + foot grid, drawn axis line, `axisLabelShown` / `labelEvery` pitch rule, `isDenseCounts` two-tier counts (`Charts.tsx`, `Charts.module.css`, `chartLabels.ts`); `thin` removed | `redesign5-bars.spec.ts`, `chartLabels.test.ts`, `Histogram.test.tsx`, `redesign3-charts.spec.ts` (P1-1, P1-8 adapted) |
| R1-13, R2-14, R3-23 | tokens only | `design-language.test.ts` (49 passed), `pytest tests/platform/test_design_language.py` |
| R2-1 .. R2-15 | `BoxPlot` tone (`lib/boxTone.ts`), axis line + min / max labels, `BoxTip`, `BoxTrack` tone, `BoxNumbers` / `BoxLegend` removed, `BoxTotal` in headers, `HelpMarker`, `BoxKey`; box cards in their own grid rows (`slot="box"`) | `redesign5-box.spec.ts`, `BoxPlot.test.tsx`, `boxTone.test.ts`, `redesign3-box-plots.spec.ts` (P7-1 / 5 / 6 / 20 adapted) |
| R3-1, R3-15, R3-20 | panel header (`ScoreValue`, "Edit score" text button), `container-type` | `redesign5-metric-panel.spec.ts` |
| R3-2 .. R3-6, R3-13 | `MetricDetailBody`: stacked prose, `dl` facts, three label roles, `humanizeKey` | same, `humanizeKey.test.ts` |
| R3-3, R3-7, R3-21 | `FieldRow` / `KeyTree` truncation (ellipsis + title) | same, `fieldRow.truncate.test.tsx` |
| R3-8 .. R3-12 | `detectTable` + `DetailTable` (embedded `DataTable`, sort, 12 rows then more) | same, `metricTables.test.ts` |
| R3-14 | measured, amended (see below) | same |
| R3-16 .. R3-18 | matrix reason anchor, row selection tint + bar, weights | same |
| R3-19 | unchanged semantics | `redesign3-item-details.spec.ts` (P5-12 follows the new button name) |
| R3-22 | axe on the open panel (found a real `label-content-name-mismatch`: the Edit button's aria-label omitted its visible words; label removed) | `redesign5-metric-panel.spec.ts` |
| R4-1 | `CorrelationMatrix` fills its box | `redesign5-spacing-trace.spec.ts` |
| R4-2 | toolbar row `align-items: flex-end` | same |
| R4-3 | `SpanDetail` content-first default, empty-content tab, session-only content pick | same, `SpanDetail.test.tsx` |

## Measured numbers

R1 (all asserted at 0): bar bottom minus axis line 0 px on 11 and 20 columns at 1440 and 390, feet equal (18 px; 32 px with a sub line).
R2: `tokens_used` card 212.2 px at 1440 (was 359), 230.4 px at 390; space under lowest element 1 px. R3: header 40 px at 1440 (<= 40),
58 px at 390; table header 34, rows 32; matrix rows 32, header 34, Arabic reason offset 0 px at 1440 (was 544); label roles 3.
R4-1: grid 1151 / 735 / 237 px = box (was 304); R4-2 spread 0 (was 9.7); R4-3 content on 7 of 7 steps.

## Deviations (each with its reason)

1. R1-8: asserted on the gallery sweep (counts to 120); `passes19` has 6 items per pass so its counts are one digit and it is correctly not dense.
2. R2-2: the directed-score box is the per-pass row (`BoxTrack`), because score metrics are histograms on the Overview.
3. R2-9: <= 232 px at 390 (230.4 measured; the error-note line of the fixture). Box cards moved to their own grid rows so a short plot is never stretched.
4. R3-14: <= 1,040 / 1,530 px (measured 1,029 / 1,523): three tables are now expanded by default; the old panel hid them.
5. The Edit button has no aria-label (axe). Specs that named it `Edit quality score` now use `Edit score` (items, qa-fixes, cutover-pass-revision, redesign3-item-details, ux-score-editor).
6. R4-3: the seeded traces already opened on content; the fix covers contentless steps and makes the content default structural.
7. Observation, not fixed: at 390 the trace tree rows overlap the retry label and error tag.
8. `stepTone` in `latencyModel.ts` is no longer used (step rows are series 1); left in place.

## Review fixes (after `review-run-detail.md`)

F1 table cell padding (`.detailRow > td`), R4-2 one row at 1024 ("Show" Select 641 to 1099 px, clamp widths), axis overshoot (grid
`minmax(0, 1fr)` + plot padding), matrix 12 px at 390, flat distributions as one line, 390 trace rows; dense count tiers by `countTiers`.
Tests: `R3-9b` (metric panel), `R4-2` (one row), `R4-3e`, `R1-9` tolerance 1, Vitest `countTiers`. See the review fixes table in `run-detail.md`.

## Gate

- `npm run check` (heavy.sh cost 3): tsc, eslint, stylelint, Vitest 159 files / 1,378 tests, design-language 49 tests, all green.
- Playwright `run-detail` + `visual-language` (cost 4): 462 passed after fixing R3-22 (axe: Edit button name); the six specs touched by the button rename rerun: 83 passed.
- `npm run build` and `build:sdk` (cost 2): green. `pytest tests/platform/test_design_language.py`: 1 passed.
- Full `npm run e2e` (cost 4, once): 1,289 passed, 4 failed (environments.spec:220, queue.spec:256, filters.spec:221, hover-audit wizard-models); rerun alone: all pass (load flakes under a shared machine, none in code this round changed).
