# Round 3 run-detail: independent review

Reviewer: Claude Fable 5.1. Branch `ui/redesign3-run-detail`, tip `8b287434`, spec `run-detail.md` (P1 to P7). Measured in a real
browser against the platform on 8977 / Vite 5977 with the designer's seeds (classic, 3-pass, Arabic, many-categories, the
designer's 10-pass x 24-metric "big" run) plus the branch's own `seedWideRepeatRun`. No product code was edited.

## Verdict: MEETS WITH FIXES

The six feedback points are answered. The graphs, categories, item details, sticky header and the new box plots are clearly better
than the legacy and the round-2 pages and I would ship them. The repeat panel and run header are good at 1440 and weaker at
390. Required fixes are small and local (section 4). Four spec numbers are not met literally (P2-12, P3-8, P6-1/P6-8 at 390); none of
them is a design failure, but the user's instruction is strict adherence, so each is either fixed or knowingly waived below.

## 1. Criterion table

Legend: Y met, N not met, G measured by the Playwright gate only (spec passes; I did not re-measure by hand).
Measured in my own browser pass unless marked G. "(a)" = both widths.

### P1 graphs

| # | Measured | Met |
|---|---|---|
| P1-1 | 25 (classic) / 98 (wide) bars with a count: max count-to-bar gap 2 px, 0 bars with an empty count, both widths | Y |
| P1-2 | counts are CSS `::before` of `data-text`, visible at rest (screenshots without hover) | Y |
| P1-3 | every `section[aria-label]` card: space under lowest element at most 1 px (10 / 26 cards), both widths | Y |
| P1-4 | overview plot groups equal height per row (243 / 243 / 243 at 1440; 146 at 390); the box-plot card is taller content but the same card height (375) | Y |
| P1-5 | `exact_match pass and fail split` is 243 px (146 at 390) with 3 buttons; no 24 px split bar | Y |
| P1-6 | superseded by P7 (see deviations) | n/a |
| P1-7 | 0 of 5 charts on the classic overview lack a `section[aria-label]` ancestor | Y |
| P1-8 | 6 labels per 11-bucket histogram at 390; text measured with canvas: min gap 15 px, 0 overlaps (1440: 16.5 px) | Y |
| P1-9 | 0 cards with `scrollWidth > clientWidth` at 1440 and 390 (1024, 768 G) | Y |
| P1-10 | labelled points present; duplicate "54.6%" at k=1 (both series, deviation 3) and a "0.0%" label colliding with the "k=10" tick at the right end (see F5) | Y with defect |
| P1-11 | min card width 288 (1440), 279 (390) | Y |
| P1-12 | design-language test 49 passed | Y |
| P1-13 | reduced motion: no `bar-rise`, `count-in`, `box-grow`, `dot-fade` animation names (only the DataTable `fill-grow`, pre-existing, not a P1 mark) | Y |

### P2 repeat panel (wide run, 1440 and 390)

| # | Measured | Met |
|---|---|---|
| P2-1 | single `Select`, 280 px at 1440 (279 at 390, the column), label "Metric"; no metric radiogroup (2 radiogroups are the curve statistic and Chart/Table controls) | Y |
| P2-2 | no descendant wider than the column; page `scrollWidth <= innerWidth` | Y |
| P2-3 | pick `rubric_metric_05` writes `?metric=rubric_metric_05`; reload keeps it and the Select shows it | Y |
| P2-4 | 7 tiles, 0 `[data-group]` | Y |
| P2-5 | 1440: seven tiles 164 x 119, gaps 7 to 8 px; 390: 136 wide, gap 8 px | Y |
| P2-6 | tiles are flex-centred columns (screenshots); my numeric probe was polluted by the help-marker leaf and is not trusted | Y (visual) |
| P2-7 | every tile has a one-line meaning (30 to 55 chars) | Y |
| P2-8 | 1440 left 0 / right 1193; 390 two columns of 136 plus a full-width 279 seventh tile | Y |
| P2-9 | curve 786 x 338, distribution 393 x 338: ratio 2.0, equal heights; 390 stacked at 279 | Y |
| P2-10 | table card 1193 wide, 6 columns; Metrics multi-select lists 24 metrics (checkboxes) | Y |
| P2-11 | distribution counts on bars, zeros shown (0 0 1 3 ... 0) | Y |
| P2-12 | section height 1,191 px at 1440 (limit 1,150) for the default boolean metric; 1,651 px with a numeric metric (the P7 "by pass" card adds 446); 390: 2,023 / 2,578 px (limit 1,750; the notes say about 1,900) | **N** |
| P2-13 | no horizontal page scroll at 390 | Y |
| P2-14 | `a11y.spec.ts` (gate) | G |

### P3 categories (many-categories run)

| # | Measured | Met |
|---|---|---|
| P3-1 | switcher (5 segments) plus Order control; no "+" button (0), no "Rank by" text | Y |
| P3-2 | exactly 1 `role=group "Values of ..."` | Y |
| P3-3 | 6 rows, "Show all 24 values" present | Y |
| P3-4 | bar starts about 234 px from the value text at 1440 (screenshot) | Y |
| P3-5 | one tick x for every row (386 px at 1440, 109 px at 390) | Y |
| P3-6 | `redesign3-categories.spec.ts` (gate) | G |
| P3-7 | click "region" writes `?category=region`, group named "Values of region, worst first" | Y |
| P3-8 | section 578 px at 1440 (limit 460; mock 393); 390: 730 (limit 900) | **N** at 1440 |
| P3-9 | no overflow at 390; bar on its own line (screenshot) | Y |
| P3-10 | unit test `metricBand` (check) | G |

### P4 sticky header

| # | Measured | Met |
|---|---|---|
| P4-1 | 1440, Arabic item #2 of the wide run, scrolled in 150 px steps across the table: header bottom equals detail top at every stop, overlap 0 | Y |
| P4-2, P4-5, P4-7, P4-9 | `redesign3-items-sticky.spec.ts`, `items-virtual.spec.ts` (gate) | G |
| P4-3 | header re-appears after the detail (spec, gate) | G |
| P4-4 | one `[data-item-bar]`, 32 px high, at the sticky line (top 150 = nav bottom) at every stop | Y |
| P4-6, P4-8 | gate spec | G |

### P5 item details (wide run, item 1 English, item 2 Arabic, 1440 and 390)

| # | Measured | Met |
|---|---|---|
| P5-1 | label, Output, Metrics left edges 233 / 233 / 233 (1440), 97 / 97 / 97 (390), English and Arabic | Y |
| P5-2 | Arabic value at the right of a left label (screenshot); numeric distance G | G |
| P5-3 | 0 `dir` values other than ltr/rtl/auto; no button, row, heading carries rtl/auto | Y |
| P5-4 | 0 keys expanded on open, English and Arabic, 10-pass items | Y |
| P5-5, P5-6 | Expand all: 72 expanded, 1 collapsed; Collapse all: 0; per-key header shows Expand all / Collapse all | Y |
| P5-7 | 1 px `rgb(82,82,108)` rule, 1,151 px (full detail width), above Metrics | Y |
| P5-8 | 8 metric rows initially, 10 pass columns plus Mean at 1440 (3 at 390), matrix scrollWidth fits | Y |
| P5-9 | 0 `data-series` / `data-hue` in the detail | Y |
| P5-10 | 10 chips each with number and tick or cross | Y |
| P5-11 | 3 output columns at 1440 equal width (screenshot) | Y |
| P5-12 | metric detail panel opens from a matrix cell; Escape (partial manual); G | G |
| P5-13 | 1 ItemBar | Y |
| P5-14 | 889 px at 1440 (limit 1,400); 1,659 to 1,684 at 390 (spec limit applies to 1440) | Y |
| P5-15 | no page overflow at 390 | Y |
| P5-16 | `a11y.spec.ts` (gate) | G |

### P6 run header (classic run)

| # | Measured | Met |
|---|---|---|
| P6-1 | 1440: every listed field visible without click (task, dataset, model, owner, project, started, runtime, copy id, status, Export, pager, 4 versioning chips incl. git, 3 config chips, metadata). **390: versioning shows 4 of its 5 chips, config and metadata are behind "+ 4 more"** | Y at 1440, **N at 390** |
| P6-2 | 0 chevron controls; only disclosure is "+ 4 more" at 390 | Y |
| P6-3 | heights 188 (1440), 188 (1280), 250 (1024), 368 (768), 485 (390); ceilings 200 / 200 / 260 / 520 / 520 | Y |
| P6-4 | Overview heading top 338 px at 1440 x 900 (limit 380) | Y |
| P6-5 | 7 `dd` tops all 136 at 1440 and 1280; 2 columns at 390 | Y |
| P6-6 | VERSIONING, CONFIG, METADATA order, label shares a line with its first chip (screenshot) | Y |
| P6-7 | chips 24 px high, values truncate (G for the 20 / 30 limits) | Y |
| P6-8 | at 390: 3-line clamp (84 px) but only 5 chips visible, 4 hidden; at least 6 required | **N** at 390 |
| P6-9 | `+ N more` `aria-expanded=false` seen; persistence is G | G |
| P6-10, P6-11, P6-13 | spec file (gate) | G |
| P6-12 | header `scrollWidth <= clientWidth` for 5 widths x 3 runs | Y |

### P7 box plots

| # | Measured | Met |
|---|---|---|
| P7-1 | tokens_used: `svg[role=img]` named "tokens_used, 237 items: minimum 0 ... total 120.1K ...", plus `dl` Min / P25 / Med / Mean / P75 / Max; no Min/Avg/Max/Total cells | Y |
| P7-2 | plot sentence and `dl` agree (0 / 287 / 504 / 506.8 / 726 / 976); geometry check by unit test (check) | Y |
| P7-3, P7-4, P7-16 | Vitest in `check` (154 files, 1,356 tests) | G |
| P7-5 | Total only on tokens_used, Tokens, Cost; absent on Response time and score cards | Y |
| P7-6 | no clipped dt/dd (0 of 12); "Med" abbreviation; values wrap to two rows of three at 288 and 279 px | Y (deviation 11 accepted) |
| P7-7 | svg 245 (card 288) / 237 (card 279) wide; at 390 at least 220 | Y |
| P7-8 | hover on all 18 marks gives a tooltip with a value; focus on box shows "Middle 50%: 287 to 726 (IQR 439)"; hovering the box centre shows the mean (deviation 11) | Y |
| P7-9 | Tab order: box, low whisker, high whisker, min dot, max dot, then the help marker; Escape closes the tooltip; Enter on the box filtered 240 to 119 items with a scope chip ("Remove filter 2 rules") | Y |
| P7-10 | min and max dots present; 40-per-side cap G | G |
| P7-11 | states: "All 55 values are 300" seen on Tokens per item; others by `BoxPlot.test.tsx` | Y |
| P7-12 | Response time keeps Mean, p50 / p90 / p95 pins and histogram, adds a box strip on the histogram scale and "fastest 304 ms / slowest 4.3 s" | Y |
| P7-13 | "rubric_metric_01 by pass": 10 rows, shared 0 / 50% / 100% axis; hidden for the boolean `correct`; row click G | Y |
| P7-14 | no `.whisker` / `.box` CSS (grep in impl notes); steps specs G | G |
| P7-15 | Tokens per item and Cost per item cards appear on the classic run (55 items) | Y |
| P7-17 | design-language 49 passed | Y |
| P7-18 | no `box-grow` / `dot-fade` name under reduced motion | Y |
| P7-19 | `a11y.spec.ts` (gate) | G |
| P7-20 | box cards have 1 px under the lowest element, card height equals row neighbours (375) | Y |

## 2. The six feedback points, judged as a user

1. **Graphs (P1): fixed.** Counts sit on the bars, every card is filled to its bottom edge, the grid reads as one family and the
   boolean split is now the same chart as the rest. The box-plot cards fit the family. Remaining blemishes: histogram x labels at
   3- and 4-up are tight (15 to 17 px gaps), and the Across attempts curve labels collide at both ends (F5).
2. **Repeat analysis (P2): fixed at 1440, acceptable at 390.** Select instead of 24 chips, seven separate centred tiles with
   meanings, curve beside distribution at 2:1, a By pass table that fits. Weak points: the section is 41 px over the ceiling
   at 1440 (and the new by-pass card makes numeric metrics 1,651 px), and at 390 it is 2,023 to 2,578 px with a by-pass table that
   hides Errors off-screen. It is clear, it is just long.
3. **Categories (P3): fixed.** One key at a time, six rows, a tick for the overall average, no "+" or "Rank by". It is 120 px
   taller than the spec ceiling because rows are 40 px, not because it is cluttered.
4. **Sticky header (P4): fixed.** I swept an expanded 890 px item at 100 to 150 px steps: the column header never touches the
   detail and a 32 px ItemBar owns the sticky line, with Collapse in it.
5. **Item details (P5): fixed.** Aligned left edges in English and Arabic, nothing expanded on open, Output then divider then a
   metric matrix (889 px instead of about 3,000), pass chips without hue, Expand all / Collapse all work.
6. **Run header (P6): fixed at 1440 and 1280, not at 390.** At 1440 every field and every chip is visible with no click in 188 px,
   which is what the user asked for. At 390 the header is 485 px and config and metadata hide behind "+ 4 more", and the
   versioning values that are shown are cut ("retriever_index q...", "git main . abc..."). The user's words were "lost too many
   details": on a phone the details are still mostly lost. 35 px of the 520 px ceiling is unused.
7. **P7 box plots: delivered and good.** Right glyphs, numbers always visible, tooltips and keyboard path work, filters apply, the
   latency strip lines up with the histogram, per-pass box rows are readable.

## 3. Deviations judged

| Deviation | Verdict |
|---|---|
| P1-6 superseded by P7 | Valid: the cells were replaced by the box plot the user asked for in P7. Accepted. |
| P2-12 height 1,900 at 390 (limit 1,750 from a 350 px mock) | Reason is half valid: the 279 px column is narrower than the mock column, but the real section is 2,023 px, not 1,900, and at 1440 it is also over (1,191 vs 1,150). The impl measured "panel body" not "section". Not accepted as stated; waive only with a corrected number (F3). |
| P6 at 279 px only versioning chips visible | Not accepted. The spec asked for 6 chips and all fields visible; the ceiling has 35 px spare, one more chip row (30 px) fits. Truncated values make it worse (F2). |
| Passes have no colour (number plus verdict tone) | Accepted; it is what the spec says (P5-9) and the chips read well. |
| Gallery mocks at `/__ui#round3` static | Accepted; the e2e specs test the shipped components. They are drifting from the product (e.g. mock categories 393 px vs 579 shipped), so the gallery should carry a note saying "design contract, not live". |
| P2 decisions (analysis metric = toolbar metric, compact table) | Accepted. |
| P5-1 "key names" measured at the key row | Accepted (the chevron has to come first). |
| P7 number row wraps to 2 x 3 under about 300 px and abbreviates Median | Accepted: "$0.0012" cannot fit six 39 px cells. The 2 x 3 layout also applies at 1440 cards (288 px), which the spec did not foresee; it reads fine. |
| P4 ItemBar moved by JS translate | Accepted (table scroller is an overflow container). |
| Commit trailer Sonnet 5.5 | Harness attribution; ignore. |

## 4. Findings

### Required fixes (small)

- **F1 (medium) P6-1 / P6-8 at 390: config and metadata hidden, 5 chips visible.** `frontend/src/features/run-detail/components/RunHero.module.css`
  and `RunHero.tsx`: raise the compact clamp from 3 to 4 chip lines (485 + 30 = 515 px, under the 520 ceiling) or drop the three
  group labels to inline small caps so more chips fit; keep "+ N more". Add a 390 assertion that at least 6 chips show.
- **F2 (medium) chip and fact values truncated at 279 px** ("q...", "abc...", "Oct 1, 2026, 3:00 ..."). Let the facts value wrap to
  two lines at compact (Started) and let a versioning chip take the full row width before truncating (`max-inline-size: 100%`).
- **F3 (low) P2-12 / P3-8.** Either tighten (categories rows `--row-compact`: about -50 px; repeat tile `min-height 112`, by-pass rows
  `--row-compact`) or amend the spec to the real ceilings: repeat section 1,200 (boolean) / 1,700 (numeric, with the by-pass card)
  at 1440 and 2,100 / 2,600 at 390; categories 580 at 1440. Pick one; do not leave the spec and the product disagreeing.

### Optional

- **F4 (low)** Histogram x labels at 18 px columns have 15 to 17 px gaps and visually run together ("40%60%") in the 4-up overview;
  thin to every third label under 20 px columns, or use 4 labels (0 / 25 / 50 / 75 / 100 style).
- **F5 (low) curve labels** (`charts/Charts.tsx` Curve): at k = 1 the two coincident labels print twice; at k = N the Pass^k label
  "0.0%" sits on the "k=10" tick. Merge identical labels at k = 1 and offset the last-point label up when it is within 14 px of
  the axis.
- **F6 (low) By pass table at 390** hides Errors and Items to the right with no visible cue in the default columns; the table is 360 px
  inside a 279 px card for 3 columns. Show Pass + metric + Errors by shrinking the pass column.
- **F7 (low)** Hovering the centre of the box shows "Mean" instead of "Middle 50%"; widen the box hit area or put the mean hit area
  on the diamond only.
- **F8 (note)** Sections render lazily on scroll (`#run-section-*` only exists after scrolling); fine, but any test or deep link that
  reloads must scroll first.
- **F9 (note)** The designer's `big` seed run shows no versioning, config or metadata chips (the header is 109 px): the seed
  payload keys do not reach the header; only the classic seed exercises P6.

## 5. Gate

All through `scripts/heavy.sh` on `8b287434`.

| Step | Result |
|---|---|
| `npm run check` (`--cost 2`: tsc, eslint, stylelint, Vitest, design-language) | green: 154 test files, 1,356 tests; design-language 49 passed |
| Playwright `e2e/run-detail` + `e2e/visual-language` (`--cost 4`) | 407 passed, 0 failed, 1 skipped (408 tests, 7.9 min) |
| Reruns | none needed (no failure) |

Not run by me: `build`, `build:sdk`, `e2e:sdk`, full `e2e` (the brief's gate was check plus the two folders).

## 6. Screenshots (mine, `scratchpad/r3r/shots/`)

`classic-top-1440.png`, `classic-top-390.png`, `wide-top-1440.png`, `wide-top-390.png`, `repeat-1440.png`, `repeat-390.png`,
`repeat-1440-correct.png`, `repeat-1440-rubric_metric_01.png`, `repeat-390-correct.png`, `repeat-390-rubric_metric_01.png`,
`hero-classic-1440.png`, `hero-classic-390.png`, `hero-big-1440.png`, `hero-many-390.png`, `box-tokens_used-1440.png`,
`box-tokens_used-390.png`, `box-Tokens_per_item-1440.png`, `box-Cost_per_item-390.png`, `box-filter-1440.png`, `latency-1440.png`,
`categories-1440.png`, `categories-390.png`, `item-ar-open-1440.png`, `item-ar-scroll1-1440.png`, `item-ar-scroll2-1440.png`,
`item-ar-open-390.png`, `item-ar-scroll1-390.png`, `item-ar-scroll2-390.png`, `item-expandall-1440.png`.
