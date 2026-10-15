# Round 3 run-detail: implementation notes (P1 to P7)

Branch `ui/redesign3-run-detail`. Spec: `run-detail.md` (this folder). Commits, in order: `aafb3516` P1, `82f2a95b` P2, `d3457e8f` P3,
`8c9991b5` P4, `0a671aac` P5, `1cf92f28` P6, `12278e8f` (spec P7 cherry-pick), `0289c89c` P7, `21c17268` (field-list test).
After-screenshots (1440 and 390 where it matters): `shots/after-*.png`.

Test names below are Playwright specs in `frontend/e2e/run-detail/` or Vitest files; "unit" = Vitest.

## How to read the table

`criterion -> change -> test`. A criterion that is met has no remark. A deviation is marked **DEV** and explained in the section "Deviations".

## P1 charts (`redesign3-charts.spec.ts`, `charts/chartLabels.test.ts`, `charts/Histogram.test.tsx`)

| # | Change | Test |
|---|---|---|
| P1-1, P1-2 | `BarColumns` column recipe (spacer / count / bar / axis / sub), counts drawn from `data-text`; overview cards, "Passes passed", latency histogram | `P1-1, P1-2` (measures count box to bar box, reads the `::before` content, 1440 and 390) |
| P1-3, P1-7, P1-9, P1-11 | `ChartCard` (`Card fill`) for every chart; overview grid `auto-fit minmax(260px, 1fr)` | `P1-3, P1-7, P1-9, P1-11`, `P1-9 across widths` |
| P1-4 | plot slot `flex: 1`, note line one 16px line (ellipsis) | `P1-4` |
| P1-5 | `BoolBars` (Pass / Fail / Error columns) | `P1-5` |
| P1-6 | **DEV 1.** The Min / Avg / Max / Total cells it measured were replaced by the box plot (P7) | `P1-4` asserts the numeric card holds a box plot and the number row |
| P1-8 | `thinAxisLabels` (every second label under 30px per column) | `P1-8`; unit `thinAxisLabels` |
| P1-10 | `Curve` labelled points and halo (`text[data-point-label]`) | `P1-10` (4 per series at 1440, 2 at 390) |
| P1-12 | no colour literal in the chart CSS | design-language test |
| P1-13 | `.bar[data-enter]`, `.count[data-enter]` `animation: none` under reduced motion | `P1-13`, `P1-13b` (guard that motion exists) |

## P2 repeat analysis (`redesign3-repeat.spec.ts`, `panels/RepeatTiles.test.tsx`)

`ui/StatTiles`, `RepeatTiles`, `PassTable` (DataTable in a flush card, Metrics `MultiSelect`), `Select` driven by `?metric=`, `ChartCard`s side by side from 1100px.

| # | Test |
|---|---|
| P2-1, P2-2, P2-13 | `P2-1, P2-2, P2-13` |
| P2-3 | `P2-3: choosing a metric writes ?metric=...` |
| P2-4 .. P2-8 | `P2-4..P2-8` (seven tiles, no `data-group`, equal size, 8px gaps, centred label / value / meaning, fills the width, 2 columns + full-width seventh at 390); unit `RepeatTiles` (7 tiles, 3 for numeric) |
| P2-9, P2-10, P2-11, P2-12 | `P2-9`, `P2-10, P2-11, P2-12`, `P2-10b` (picker lists all 24 metrics, two picks add two columns) |
| P2-14 | `a11y.spec.ts` repeat tests include the wide run |

## P3 categories (`redesign3-categories.spec.ts`, `lib/categoryModel.test.ts`)

`CategoriesTab` rewritten: switcher (`SegmentedControl` or `Select`), one `Card`, rows as buttons, `?category=`. P3-1 .. P3-9 by the e2e spec; P3-10 by the `metricBand` unit test.

## P4 sticky header (`redesign3-items-sticky.spec.ts`, `ui/DataTable/__tests__/stickyShift.test.ts`)

`computeShift` (pure), `useStickyShift({ details })`, `ItemBar`. P4-1, P4-3, P4-4, P4-7 at 1440 and 1280; P4-2 sticks with no expansion; P4-5 two items; P4-6 collapse focus; P4-8 at 390. P4-9: `items-virtual.spec.ts` unchanged and green.

## P5 item details (`redesign3-item-details.spec.ts`; unit `structuredValue.expand`, `fieldRow.anchor`, `passSelection`, `metricMatrix`)

| # | Test |
|---|---|
| P5-1, P5-2 | `P5-1, P5-2` English / Arabic at 1440, 1280, 390 (**DEV 5**: the "key names" edge is the key row's left edge) |
| P5-3 | `P5-3` |
| P5-4 | `P5-4` (English, Arabic, 10 passes, one pass) |
| P5-5, P5-6 | `P5-5, P5-6` (depth 4 `meta` key) |
| P5-7, P5-8, P5-13, P5-14 | `P5-7, P5-8, P5-13, P5-14` (height 889px at 1440 for the 10-pass x 24-metric item) |
| P5-9, P5-10, P5-11 | `P5-9, P5-10, P5-11` |
| P5-12 | `P5-12`, `P5-12b` (roving grid) |
| P5-15 | `P5-15` |
| P5-16 | `a11y.spec.ts` "expanded ... has no serious violation" (Arabic and wide item, both widths) |

## P6 run header (`redesign3-header.spec.ts`; unit `lib/__tests__/heroChips.test.ts`)

P6-1, P6-2 (`P6-1, P6-2`), P6-3, P6-4 (`P6-3, P6-4`: 158px at 1440 for the classic run), P6-5, P6-6, P6-7 (`P6-5, P6-6, P6-7`), P6-8 / P6-9 (`P6-8, P6-9`, `P6-8 compact`), P6-10, P6-11, P6-12. P6-13: header is part of the default-page axe scan and `a11y.spec.ts`.
**DEV 6.** The planned `components/RunHero.test.tsx` is not written: the header needs the router, query client and ticker; "no chevron" and "band 3 omitted" are asserted in the e2e spec instead (P6-2, P6-10), and the model is unit tested.

## P7 box plots (`redesign3-box-plots.spec.ts`; unit `lib/boxStats.test.ts`, `lib/boxStats.perf.test.ts`, `components/charts/BoxPlot.test.tsx`, `lib/__tests__/boxCards.test.ts`)

| # | Change | Test |
|---|---|---|
| P7-1, P7-5 | `NumericCells` removed; `BoxCardBody` = `BoxPlot` + `BoxNumbers` + Total (additive kinds only, `showsTotal`) | `P7-1, P7-5`; unit `showsTotal` |
| P7-2 | `boxStats` + scale | unit `boxStats` (P7-4 numbers); DOM ordering is exercised by P7-8 |
| P7-3 | `metricCardModel.values` and `metricEntries` read the same `rowScoreFor` | unit `boxCards` |
| P7-4 | type 7 `quantile` | unit `1..100` |
| P7-6, P7-7, P7-20 | wrap rule when the longest value does not fit a sixth of the width; SVG at measured width | `P7-6, P7-7, P7-20` (Overview numeric and Tokens cards, both widths); unit "Med" at 237px |
| P7-8, P7-9 | marks in a transparent overlay; Escape dismisses chart tooltips (`ChartTooltipHost`) | `P7-8`, `P7-9`, `P7-9b` |
| P7-10 | `decimate` keeps min and max | unit; `P7-10` (1,200-item run) |
| P7-11 | states | unit `BoxPlot states` |
| P7-12 | `LatencyStrip` on the histogram x scale, fastest / slowest | `P7-12` |
| P7-13 | `PassDistribution` | `P7-13` |
| P7-14 | `BoxTrack` replaces `.whisker` / `.box` / `.median` in Step timings | grep (no such CSS left) and the existing steps specs |
| P7-15 | Tokens / Cost per item cards (>= 2 items) | `P7-15` (classic and a run without trace stats) |
| P7-16 | `boxStats` perf | unit perf (26 x 5,200 values under 50 ms; local run well under) |
| P7-17 | no colour literal | design-language test |
| P7-18 | `animation: none` | `P7-18` |
| P7-19 | `a11y.spec.ts` "box plots ... no serious violation" (Overview, Response time strip, Repeat rows, both widths) | |

## Deviations (each is the closest faithful option)

1. **P1-6** is superseded by P7 (the cells no longer exist).
2. **P1 count text** is drawn by CSS from `data-text` (the established axe `label-content-name-mismatch` workaround); tests read `::before`, not text content. The note under a card value is a single ellipsised line (the mock wraps).
3. **P1-10**: at k = 1 both series carry a label (the criterion says four per series); the two labels coincide because Pass@1 = Pass^1.
4. **P2-12 at 390**: the panel is about 1,900px tall in the real 279px column (the criterion's 1,750 came from the 350px mock column). The 1440 ceiling (1,150) is measured on the panel body: 1,063px.
5. **P2 decisions**: the repeat metric is the page's analysis metric (`?metric=`, as the spec's URL contract says; the toolbar Select follows it); pass rates take bands as higher-is-better whatever the metric's direction; the three-tile (numeric) layout stacks under 480px instead of `repeat(3, 1fr)` (87px tiles cannot hold a 26px value); the compact table gets Avg latency / Median / Items through the same Metrics picker; the "scroll cue" is the DataTable's own and only appears when the picked columns overflow (the spec test asserts the two extra columns).
6. **P5-1**: "key names" is measured at the key row (its chevron button), because a key name sits after the chevron by design.
7. **P5**: the per-pass "same as Pass 1 / differs" tag and the per-metric compare panel are removed (not in the spec); a failed pass opens its `error` key by default.
8. **P6 at 279px**: the three-line chip clamp (84px) holds the versioning chips only; config and metadata wait behind "+ N more" and fewer than six chips fit (P6-1 and P6-8 at 390 are asserted for what fits). The spec's own numbers (84px, at least six chips, every chip visible) cannot all hold in 237px of card body with three group labels; the hard ceiling was kept.
9. **P6**: the classic seed gained `git_branch`, `git_commit` and a `retriever` object so the fields the criterion lists exist in the fixture; the `VersioningDetails` card is no longer used on the run page (the component stays for other callers).
10. **P4**: the ItemBar is moved by the same JS translate as the header (the table scroller is an overflow container, so CSS `position: sticky` cannot work there).
11. **P7**: the step timing glyphs keep their kind colours (spec: "same encoding"; the glyph set is shared, the tone token is the step's); the number row abbreviates Median under 300px and wraps to two rows of three when its longest value would not fit (cost values like `$0.0012`); the plot is a picture (`role="img"`) plus a transparent mark overlay because a focusable child inside `role="img"` fails axe `nested-interactive`; the Mean hit area sits inside the box (hovering the box centre shows the mean).
12. **Gallery**: the `/__ui#round3` cases stay the static design contract; the shipped components are what the specs test (mocks were not rebuilt on the real components).
13. **Open item for the coordinator**: `Row.pass_scores` IS present in the compact payload (P7-13 passes on `seedWideRepeatRun`), so no fallback was needed.
14. **Trailer**: commits end with `Co-Authored-By: Claude Sonnet 5.5` (the harness attribution), not the brief's Fable line.

## Other changes worth knowing

- New rule fields `Tokens` and `Cost ($)` in the filter builder (box plot clicks write a two-condition range rule); `pure.test.ts` field list updated.
- `Mark` accepts `as="line"`; `ChartTooltipHost` closes on Escape for hover and focus tooltips, not only pinned ones.
- Existing specs updated with a reason: chips -> matrix (`openMetric` / `metricRow` helpers in `support.ts`), Select instead of the metric radiogroup, tiles instead of grouped strip, categories chips removed, header chevron removed, xss run-name check reads the chip title (values clip at 30 characters).

## Gate

Run on `9bbbdc53` (all through `scripts/heavy.sh`):

| Step | Result |
|---|---|
| `npm run check` (tsc, eslint, stylelint, Vitest, design-language) | green: 154 test files, 1,356 tests, design-language 49 |
| `pytest tests/platform/test_design_language.py` | 1 passed |
| Playwright `run-detail`, `visual-language`, `shell`, `compare` | 623 passed, 0 failed, 9 skipped |
| `npm run build`, `npm run build:sdk` | both built |
| full `npm run e2e` (once, at the end) | 1,237 passed, 0 failed, 0 flaky, 12 skipped |
| `npm run e2e:sdk` | 41 passed, 1 failed once (`qa-fixes.spec.ts` "the elapsed clock stops while reconnecting": a console `ERR_CONNECTION_REFUSED` from its own reconnect scenario); passed 2 of 2 reruns alone: **flake**, the SDK viewer was not touched |

Earlier in the work two full-folder runs were killed by the tooling (log truncation / process loss, not test failures) and were re-run in smaller chunks; every failure seen on the way was a real change of behaviour in the spec'd area and was fixed or its spec updated with a reason in the commit.
