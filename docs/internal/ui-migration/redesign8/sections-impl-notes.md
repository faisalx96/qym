# Round 8b implementation notes: framed sections (recipe A, owner decision H6)

Branch `ui/redesign8-sections`, spec `sections.md` (recipe B and its criteria deleted; owner decision H6, 2026-10-27, final).
Measurements: Chromium, dark theme, the seeds of `frontend/scripts/seed-compare.ts`-style `seedR8` (4 and 8 runs) and the
run-detail Repeat seed. After-shots in `sections/shots/` (script `sections/measure/sec-after.mts`):
`after-sections-{compare,run}-{1440,390}.png`, `after-sections-boundary-{compare,run}-1440.png` (the same crops as the
mocks: compare Averages to Overview, run Repeat to Latency) and `after-sections-first-screen-1440.png`.

## What changed

- `ReportSection` (`frontend/src/ui/ReportSection/`) is the one primitive. It renders `section[data-report-section]`
  with `data-part` = `section` (or the `part` prop: compare keeps `section-<key>`), the head
  `div[data-part=section-head]` as the first child (h2 `--font-xl` / 650 + one muted description + the aside) and a
  container-query body. The panel is `--bg-surface`, 1px `--border-subtle`, `--radius-md`, 14 px padding;
  `.section ~ .section` is the only margin (`--space-lg`, 20 px); the first section has none.
- `CompareSection` (tsx + css) is deleted. `CompareBody` / `CompareSkeleton` wrap the sections in `div[data-part=report]`
  (a plain block, so the page's 14 px flex gap stays between title, notices, nav and the first panel and is not between panels).
  The run page's Items section and its loading frame (`ItemsSection.tsx`, `StageSkeletons.tsx`) render through
  `ReportSection id="run-items"`; its `.head`, container query and own `scroll-margin` are gone.
- Inset cards, one mechanism: the grouping surfaces paint `var(--card-bg)` and `var(--card-edge)` (new tokens in
  `tokens.css`, defaults `--bg-surface` / `--border-subtle`, so every other page is unchanged). The body of a
  `ReportSection` redefines them as `--bg-elevated` / `transparent`. The `design-language.test.ts` rule that no component
  redefines a `--bg-*` token is why the indirection exists. Files that now read `--card-bg` / `--card-edge`: `Card`,
  `StatStrip`, `DataTable`, `Select`, `MultiSelect`, `TextField`, `RadioGroup`, `ReportLayout` and the compare and run-detail
  recipes (run cards, averages, stat boxes, category / error cards, item rows, filter builder, banner, heatmap, rule builder, skeleton blocks).
  Tints that must not lighten with the panel (the expected block and the open chip head, contrast) use `--panel-bg` (the
  panel's own fill, defined on the section); the sticky filter bar of the Items section paints `--panel-bg` too.
  The tables keep their header band and row hairlines (`--border-subtle`); the 3 px rails stay; error item rows keep their red border.
- Source changes the 30 px of horizontal space forced (all measured at 390 or 1024): `Latency.module.css` step rows give the
  name and interval columns `minmax(0, ...)` under a 320 px container (they widened the page by 38 px); `SegmentedControl`
  options give up half their padding under a 300 px container (the four-option Repeat control was 234 px in a 207 px card);
  `PassTable` compact columns 84/110/62 to 76/102/56 (Errors column outside the card by 13 px); `DatasetsSection` metric
  columns 104 to 88 (the table scrolled 16 px at 1024); `ItemDetail` output columns `minmax(17.5rem)` to `minmax(17rem)`
  (four columns did not fit the 1133 px detail at 1440 and scrolled).

## First screen (C-sec-A5, A6, C-sec-4), 1440x900, 4 runs

| | measured | ceiling |
|---|---|---|
| run cards in one row | 1 row of 4 | 1 row |
| run cards bottom | 510.75 | 530 |
| Averages table bottom | 899.83 | 900 (0.17 px slack) |
| nav bottom / Runs panel top | 183.58 / 197.58 | n/a (14 px page gap) |
| Averages title top | 560.75 | n/a |

The design measured 511 / 900. C-page-1 is unamended. The Averages head is untouched (no pixels were taken from rows or type).

## Criterion -> change -> test

Tests: `frontend/e2e/compare/r8b-sections.spec.ts` (1440, 1024, 390) and `frontend/e2e/run-detail/r8b-sections.spec.ts`
(Repeat seed, 1440, 1024, 390); both use `frontend/e2e/shared/sections.ts`.

| Criterion | Result | Change | Test |
|---|---|---|---|
| C-sec-1 one primitive | met | `ReportSection`; `CompareSection` deleted; run Items through it | both specs: `assertOnePrimitive` (compare 6 ids, run 7 ids incl. `run-items`, all `SECTION`, h2 title, head first child) |
| C-sec-2 title 18/650, description muted | met with one deviation | head markup in `ReportSection.tsx` | `assertHeads`: 18 / 650, `P` description, no ellipsis, at most 2 lines at >= 1024. Deviation: the description stays `--font-sm` (the round-8 compare recipe) instead of `--font-base`; see below |
| C-sec-3 same numbers at all widths | met | `.section ~ .section { margin-block-start: var(--space-lg) }` | `assertRhythm` at 1440 / 1024 / 390: first section margin 0, edge gap 20 +-1, body end to next title 50 +-1 |
| C-sec-4 C-page-1, C-nav-2, scroll-spy | met | scroll margin `var(--report-nav-h, var(--bar-link-h)) + 10px` | `r8-page` C-page-1 / C-nav-2 unchanged; r8b first-screen test; run deep link under the nav |
| C-sec-5 no sideways scroll, no nested card | met (after fixes above) | source changes listed above | `noSideways` x3 widths on both pages; `nestedCards` returns [] |
| C-sec-6 hue budget | met | tokens only (`--bg-surface`, `--border-subtle`, `--bg-elevated`) | `assertPanels` compares the computed colours with the token values |
| C-sec-A1 panel | met | `ReportSection.module.css .section` | `assertPanels`: fill, 1px x4, colour, radius 8, padding 14 x4, width = column |
| C-sec-A2 20 px between, 50 to title | met (edge 20, body end to title 50 = 14 + 1 + 20 + 1 + 14) | as C-sec-3 | `assertRhythm` |
| C-sec-A3 head inside, no rule | met | head is the first child, `margin-block-end: var(--space-md)` | `assertHeads`: head border 0, head to body 14 +-1, no `[data-part=section-rule]` |
| C-sec-A4 inset cards | met | `--card-bg` / `--card-edge` redefined by the body | `fillAndEdge`: run card, averages table (blocks at 390), item row, run Latency card are `rgb(34,34,50)` with transparent outline; `nestedCards` |
| C-sec-A5 four cards in one row | met | panel padding 14 | compare spec first-screen test (1 row, bottom 510.75) and the reflow test at 1024 / 390 (cards inside the 14 px padding) |
| C-sec-A6 table bottom <= 900 | met (899.83) | none needed | compare spec first-screen test |

### Deviation: the description size (C-sec-2)

`sections.md` C-sec-2 asks for `--font-base` descriptions. The implemented head keeps `--font-sm` (11 px), the size round 8
measured on the compare page (head 42 px at 1440): the run page's heads lose one pixel of text size (12 to 11) and gain the
single recipe. A6 has 0.17 px of slack; measured with `--font-base` descriptions (12 px) the Averages table bottom is 905.05 at
1440x900 (5 px over the ceiling, three heads above it grow by a line box each), so the 11 px description stays. Amendment of
C-sec-2, owner decision H6 consequence (A6 outranks the type size); `DESIGN_LANGUAGE.md` "Report section" states the muted
description without a size, as the e2e asserts.

## Round-8 criteria amended by the panel (reason on every row: owner decision H6, the panel takes 30 px of width and 16 px of height)

The panel is 14 + 1 px on each side: content width 30 px narrower, and each section grew by 16 px (30 px of frame minus the
14 px top padding the compare section had). Old numbers are those of `impl-notes.md`.

| Criterion | Old | New | Test changed |
|---|---|---|---|
| C-page-5 (1440, 4 runs) | runs 311, averages 355, overview 393, errors 440, items 1375, categories (one key) 285 | 328, 371, 409, 490 (440 + 16 panel + 34: the 280 px error cards wrap their messages), 1391, 301 | `r8-page` |
| C-page-5 (1024) | runs 539, averages 376, overview 480 | 552, 392, 496 | `r8-page` |
| C-page-5 (390) | items <= 2200 | <= 2600 (measured 2571: chips wrap to two lines) | `r8-page` |
| C-page-6 (8 runs, 1440) | runs 568, averages 385, overview 393, errors 620, items 1375 | 584, 418, 409, 708, 1391 | `r8-page` |
| C-avg-2/3 | run column 261, metric column 144; 8 runs 131; 1024 157 | 254, 144 (unchanged; an earlier draft of this table said 140); 127; 150 | `r8-averages` |
| C-avg-3 (8 runs) | head <= 62, table <= 320 | head <= 80 (measured 76.7), table <= 340 (332) | `r8-averages` |
| C-cat-2 | card 388 at 1440, 380 at 1024, 277 at 390 | 378, 366, 247 | `r8-categories-errors` |
| C-err-1 | card 287 wide, 149 high; 8 runs <= 240 | 280, 167; <= 280 (276) | `r8-categories-errors` |
| C-exp-3 | four 284 px columns without scroll | four 277 px columns; grid minimum 17.5 rem to 17 rem | `r8-expanded` |
| C-ov-2 | stat box 148 wide | 144 | `r8-overview` |
| C-ov-6 | overview <= 400 | <= 410 (measured 406) | `r8-overview` |
| C-run-1 | card 287 / 380 / 277 | 280 / 365 / 247 | `r8-runs` |
| C-row-1/2 | item list 1194 wide | 1163 | `r8-items` |
| C-row-3 (390) | four chips on one line, row <= 88 | at most two lines, row <= 112 | `r8-items` |
| C-state-1 (390) | run placeholder 232, averages placeholder 1035.2 | 254.4, 1068.4 (the loading frame keeps the loaded height) | `CompareSkeleton.module.css`, `r8-states` |

Not criteria of round 8 but asserted by existing specs, updated (never deleted): `redesign` (axe at 390: the pointer is
moved off the list, an error row under it dims its siblings to `--dim-opacity`), `multi-dataset` (section heights 297.9 /
297.9 / 635.6, table 1161 / 753), `multi-dataset-states` (657.9), `redesign3-box-plots` (svg >= 215 at 390),
`redesign3-categories` (bar track > 140), `redesign3-charts` (card >= 248), `redesign3-item-details` (the `Metrics` region
is matched exactly because the by-pass scroller is named "Metrics by pass (scrollable)" at 390; the matrix may scroll 26 px
inside its own scroller, the page never does), `redesign3-repeat` (tile centring <= 7 at 390), `redesign5-metric-panel`
(R3-14 at 390 <= 1680, measured 1660), `redesign7-edges` (a gap under 8 px is the virtualizer's end spacer, not a missing
line), `redesign7-keys` (80-character keys take 5 / 4 lines at 390; key before value uses `<=` on equal left edges).
Three run-detail specs opened a compare item by `Expand item N`, a name round 8 had removed (a round-8 leftover, not caused
by the panel): `cutover-pass-revision`, `cutover-reasons`, `cutover-xss` now click `item-row` / `item-head`.

## Design language

`docs/DESIGN_LANGUAGE.md`: "Run section header" is replaced by "Report section" (owner decision H6, with the measured
reason); the Card entry and the Calm-surface entry name the inset card. `design-language.test.ts` expects `--card-bg` in
the Card recipe. `sections.md`: recipe B, C-sec-B1..B5 and the recommendation are deleted (its measurements stay in 2.4 and 4).

## Gate (final, through the session gate wrapper)

| Command | Result |
|---|---|
| `npm run check` (tsc, eslint, stylelint, Vitest, design test) | exit 0; Vitest 207 files, 1688 tests; design-language test 54 |
| `npm run build`, `npm run build:sdk` (`NODE_OPTIONS=--max-old-space-size=3072`) | exit 0 each |
| `pytest tests/platform/test_design_language.py` | 1 passed |
| `npx playwright test e2e/compare` | 228 passed (includes the 8 new `r8b-sections` tests) |
| `npx playwright test e2e/run-detail` (three chunks, cost 4) | 462 passed, 9 skipped, 1 flaky failure: `redesign2-items.spec.ts:101` (JSON Raw view) fails 1 run in 4 here and 1 in 8 on the round-8 tip `3dd214c3`, so it is not caused by the panel (7 new `r8b-sections` tests pass) |
| `e2e/datasets/ux-compare-missing`, `e2e/runs-list/selection-compare`, `e2e/visual-language/{final-polish,contrast,sticky-bars}` | 28 passed |
| `npx playwright test e2e/visual-language` (whole folder) | 81 passed, 2 skipped, 1 failed: `frozen-static.spec.ts:222` ("every table of the /__ui gallery") times out at its 480 s budget; it fails identically on `3dd214c3` (measured 8.0 min), so it predates this round |
| `e2e:sdk` | not run: `src/sdk-viewer` renders neither `ReportSection` nor `Card` (`build:sdk` passes) |
| `tests/platform` SQLite / PostgreSQL | not run: the backend is untouched |

Two earlier gate attempts were killed by `systemd-oomd` (scopes `qym-r8b-g-vl-*`, `qym-f-run-*`, `qym-f-misc-*`) with the desktop under pressure; they were re-run at cost 4 in chunks and the counts above are from the completed runs.

## Fix pass (review `review-sections.md`: MEETS WITH FIXES)

| # | Finding | Change | Test |
|---|---|---|---|
| 1 | Compare Averages head at 390: Baseline select ended at x=367, panel content box ends at 340 (the review read 355 as the panel's right edge; content box = edge - 15) | `SelectionBar.module.css .inlineLabel`: `max-inline-size: 100%; min-inline-size: 0` so the 14 rem select shrinks inside the head instead of widening it | `compare/r8b-sections` "C-sec-5 (fix pass)": every descendant of every panel inside its content box at 390 (4 and 8 runs); failed with the select, its label, trigger and chevron before |
| 2 | Run Overview chart cards 260 px in a 249 px box; Latency axis tick label 6 px outside (also at 1440) | `Panels.module.css .chartGrid`: `minmax(min(260px, 100%), 1fr)`; `Latency.module.css .axisRow span:last-child`: `translateX(-100%)` (the last tick label ends at the track end) | `run-detail/r8b-sections` "C-sec-5 (fix pass)" at 390; failed with the four chart cards (header and body) and the `4s` label before |
| 3 | No e2e saw content leaving the padding | `e2e/shared/sections.ts outsideContentBox` (skips clipped or scrolled content, 1 px visually hidden hosts, opacity 0, `clip`); one test per page at 390 | both r8b specs; verified red before 1 and 2, green after |
| 4 | C-avg-2 metric column asserted 144 +-5 | measured 144 (the panel does not change it; the notes' "140" was wrong): asserted 144 +-2, notes corrected | `r8-averages` C-avg-2/3 |
| 5 | C-page-5 errors comment "440 + 16 + 18" vs 490 | measured 490 +-0.5: 440 + 16 (panel) + 34 (the 280 px error cards wrap their messages); comment and notes say 34 | `r8-page` C-page-5 |
| 6 | `compare.md` kept the round-8 numbers | every changed criterion line carries "Superseded by round 8b" with the new number; a "Round 8b amendments table" lists old and new with the asserting spec | doc |
| 7 | DESIGN_LANGUAGE "48px" | "50px ... (14 padding + 1 border + 20 gap + 1 border + 14 padding)"; the e2e now asserts 50 +-1 (was 49 +-3) | `assertRhythm` |
| 8 | `frozen-static.spec.ts:222` | not a panel cost; budget 480 s to 900 s with a comment (below) | the spec itself |

### Frozen-static timing (finding 8)

Whole-test wall time, `--workers 1`, same machine, other agents running (it was never idle):

| Tree | Runs |
|---|---|
| parent `3dd214c3` (throwaway worktree) | 7.8 min pass (budget raised), 7.6 min pass, 8.0 min timeout at the old 480 s budget |
| round tip | 9.2 min pass (budget 900 s); three further runs ended without a result (one `systemd-oomd` kill, two that ended silently while 2 to 3 other agents' suites held the memory) |

The tip looked 15 to 20 % slower on wall time, which would be a panel cost, so I measured the page directly instead of the whole test:
`/__ui` at 660 px, the same wheel probes on 8 frozen overflowing tables (CDP `Performance.getMetrics`, 2 runs per tree):

| | DOM nodes | layouts | style recalcs | LayoutDuration | RecalcStyleDuration | TaskDuration | wall |
|---|---|---|---|---|---|---|---|
| round tip | 39709 | 1117 / 1142 | 1140 / 1164 | 445 / 484 ms | 698 / 744 ms | 8.0 / 8.7 s | 16.9 / 17.3 s |
| parent | 39701 | 1091 / 1131 | 1118 / 1156 | 443 / 453 ms | 692 / 708 ms | 7.9 / 8.1 s | 16.8 / 17.3 s |

Same DOM (+8 nodes), the same counts and durations inside the run-to-run spread (at most 3 %): the panel and the card tokens do not slow this
page. The spec simply runs at 97 to 115 % of its old 480 s budget on either tree (one wheel probe of about 12 s per table, 23 tables), so it
passed or timed out with the machine's load. The budget is now 900 s (comment in the spec).
