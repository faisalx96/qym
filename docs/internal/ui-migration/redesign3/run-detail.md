# Redesign round 3: run detail (design specification)

Status: design stage. No product component was changed; the only code added is the dev gallery mock
(`frontend/src/features/dev/Round3Mocks.tsx` and its CSS module, wired into `/__ui#round3`). The mocks are the visual
contract: where this text and a mock disagree, the number in this text wins and the mock is a bug to report.

Branch `ui/redesign3-run-detail` (tip of `UI-redesign` 7f266587 plus this work). Investigated 2026-10-15 at 1440, 1280, 1024,
768 and 390 px, legacy on 8973, React on 8971 / Vite 5971.

Screenshots (`docs/internal/ui-migration/redesign3/shots/`, at most 300 KB each):

| Prefix | What |
|---|---|
| `legacy-*` | the vanilla page (header, repeat analysis, categories, an expanded 10-pass item) |
| `current-*` | the React page today (what is wrong) |
| `mock-r3-*` | the new design, from `/__ui#round3`, at 1440 and 390 (the visual contract) |

Seed data: `docs/internal/ui-migration/redesign3/seed-wide-repeat.mts` (run `node seed-wide-repeat.mts <platform url>`). It posts
the classic, 3-pass repeat, Arabic multi-pass, many-categories runs from `frontend/e2e/run-detail/seed.ts` plus a **wide repeat run**:
10 passes, 24 metrics, 24 items, Arabic and English items, JSON outputs with nested objects and lists, run metadata and versioning.
The Playwright specs below call the same function (`seedWideRepeatRun`, to be added to `seed.ts`).

## 0. Reading guide

- Every point (P1 to P6) has: Problem (measured), Legacy reference, Design (layout per width, tokens, states, copy,
  keyboard and screen reader), Acceptance criteria (numbered, each measurable), Tests to add.
- Widths. The report column (`ReportSection` body) is the width the cards see. Measured: viewport 1440 gives 1193 px, 1280 gives
  1033, 1024 gives 777, 768 gives 521, 390 gives **279** (the 56 px icon rail plus 20 px gutters take 111 px). All responsive rules
  below are **container queries on the report column** with these four steps, named once and used everywhere:

  | Step | Column width | Viewports |
  |---|---|---|
  | `wide` | 1100 px and up | 1440 (1193) |
  | `mid` | 900 to 1099 | 1280 (1033) |
  | `narrow` | 560 to 899 | 1024 (777) |
  | `compact` | up to 559 | 768 (521) and 390 (279) |

- "Tokens only": every colour, size and spacing below is an existing token. **No new colour token is introduced.** Two new size
  tokens are proposed in section 7 (none needed for colour). Raw numbers (px) in this document are layout measures that the CSS
  Modules already use as literals (heights of marks, widths of tiles); font sizes are always `--font-*` roles.
- Departures from earlier decisions are listed in section 8 so a reviewer can tell deliberate change from drift.

## 1. P1: the graphs

> "enhance the graphs (counts should be above each bar instead of hovering, all graphs should be centralized in their own boxes
> instead of floating with a lot of space below it)"

### 1.1 Problem (measured; `current-overview-1440.png`, `current-repeat-1440.png`)

1. **Counts float at the top of the plot, not on the bars.** `Histogram` and `PassCountBars` render the count in a fixed
   14 px row at the top of the column and the bar bottom-aligned below it. A bucket holding 7 of a maximum 38 items has its count about
   65 px above its 15 px bar; a bucket with 0 shows a "0" with nothing under it. The reader reads the number as a column heading
   and then has to hunt for the bar, which is why it feels like a hover value.
2. **Dead space under the plot.** Measured with the classic run at 1440: the pass/fail `SplitBar` card is 206 px high and the
   plot ends **101 px** above the card bottom (58 px at 390); the `tokens_used` stat card has about 100 px of empty card under its
   four stat cells. The histogram cards end 15 px under the plot, so the same card row has three different fills.
3. **Four different plot recipes.** Split bar (24 px high horizontal bar), histogram (110 px), numeric stats (a tile row),
   pass-count bars (110 px) each size themselves, so cards in one grid row stretch to the tallest and the shorter ones are left
   half empty.
4. Charts outside the overview (relationship scatter, correlation matrix, Across attempts curve, Passes passed) sit in the
   section background without a title row; at 1440 the 4-point curve is 1193 px wide and 260 high, its legend is under the plot,
   and nothing says where one chart ends.

### 1.2 Legacy reference (legacy overview: scratchpad `r3/legacy/big-overview-1440.png`; the repeat distribution is in `legacy-repeat-1440.png`)

The legacy overview card is a bordered box with the gauge and value at the top and a fixed-height bar chart under it; the **count
sits directly on top of every bar** (mono, `--font-sm`), the bucket label under it. Keep: count on the bar, one box per chart, a fixed
plot height so cards in a row match (the legacy pass-count distribution also prints every count, zeros included, directly above its bar). Do differently: legacy drew the Pass/Fail split as a
thin horizontal bar floating in the middle of a tall card with the counts inside the segments (a 12-item segment clipped its label); we make the boolean split the same
vertical bar chart as the others, counts on top.

### 1.3 Design

**ChartCard (one recipe for every chart on the page).** A `Card` (`--bg-surface`, 1 px `--border-subtle`, `--radius-md`) with
a `header` slot and the plot as its body. New `Card` prop `fill` (section 7): the card is a flex column whose body takes the
remaining height, so a card that a grid row stretches gives the extra height to the plot, never to empty space below it.

```
+--[3px band/series rail optional]----------------------------------------------+
| quality                                   [217 scored · 20 err]                |  header: --card-padding, hairline below
+--------------------------------------------------------------------------------+
|  49%   (ScoreValue, --font-xl mono 700)                                        |  body, --card-padding (14px 20px)
|  8 scorer errors and 12 task errors, counted as 0%    (--font-sm muted)        |
|                                                                                |
|   31        38      33  29                                                     |  counts: --font-sm mono, --text-secondary,
|  [##]      [##]    [##][##]                      14  10                        |  2px above the bar top
|  [##] 10 10[##] 24 [##][##] 7  [##][##]                                        |  bars: max 44px wide, 4px gap, 4px top radius
|  0%  10% 20% 30% 40% 50% 60% 70% 80% 90% 100%                                  |  axis: --font-sm muted
+--------------------------------------------------------------------------------+
```

- Header row: title `--font-md` 600 primary on the left; on the right the meta `Tag kind="count"` (items / scored / errors), or the
  legend and the card's own controls (`SegmentedControl` 24 px). Under 480 px of card width the right group wraps under the title.
  Minimum header height `--control-height` (24 px) plus card padding.
- **Plot slot.** `min-height: 146px` for every bar plot; the slot is a flex column with `justify-content: center`, the plot has
  `flex: 1`. Bars use the column recipe below, so a taller slot (grid-stretched card) makes the bars taller, never leaves space
  below.
- **Bar column recipe** (the point of P1). Each bucket is one `button` (the existing `Mark`) laid out as a column flex box
  `[spacer][count][bar][axis label][sub label]`:
  - spacer `flex: calc(1 - p)`, bar `flex: p` with `p` = count / max count (0..1) set as `--p` **on the column**; the spacer and bar
    split the free height, so the count (flex none, 16 px line, 2 px bottom margin) always sits on the top edge of its bar;
  - bar: `min-height: 3px` when count > 0, `width: min(100%, 44px)`, `border-radius: 4px 4px 0 0`, fill from the band or tone
    (`bucketTone`, unchanged), the error hatch segment unchanged; gap between columns 4 px (was 2);
  - count: `--font-sm`, `--font-mono`, `--text-secondary`, `font-variant-numeric: tabular-nums`; visible at rest, never a hover-only
    value; the Mark tooltip still opens with the longer sentence ("31 items (13%)") but is additive;
  - zero counts: a score histogram (11 buckets) draws **no** count and no bar for an empty bucket (the axis label stays); the
    pass/fail bars and the "Passes passed" distribution draw `0` in `--text-muted` because "nobody always fails" is information;
  - counts of 1000 or more abbreviate (`1.2k`) when the text would be wider than the column;
  - axis label: `--font-sm`, `--text-muted`, 4 px under the baseline; **thinning rule**: when the measured column is narrower than
    30 px, show the label of every second bucket (0%, 20%, ... 100%); the full list stays in the `aria-label`;
  - boolean metrics use the same plot with three columns (Pass, Fail, Error) coloured band 5, band 1, `--metric-error`, the
    sub label under the axis label shows the percentage (`--font-sm` mono muted). Plot height is unchanged, so the boolean card
    is as tall as the histogram cards beside it (this replaces the 24 px horizontal split bar);
  - numeric metrics without a score range (`tokens_used`) show the Min / Avg / Max / Total cells **centred in the slot**,
    vertically and horizontally, separated by 1 px `--border-subtle` dividers, labels `--font-sm` 600 muted uppercase,
    values `--font-xl` mono 700.
- **Curve ("Across attempts")**: a `ChartCard`, legend (Pass@k solid, Pass^k dashed, swatches from `data-series` 1 and 5) and the
  Chart | Table `SegmentedControl` in the header (right); the plot draws at the measured card width with text at its normal size
  (the existing `useMeasuredWidth`); height 240 at 500 px and wider, 220 below. Point labels: Pass@k above the point, Pass^k below,
  `--font-sm` mono `--text-secondary`, a 3 px `--bg-surface` stroke halo behind the text; labelled points at 500 px and wider are
  k = 1, 3, 5 and the last; under 500 px only the first and the last. X ticks `k=1..N` (every third and the last under 500 px).
  Labels and markers keep the existing tooltips.
- **Other charts** use the same card: Quality vs latency and Relationship scatter (plot height `clamp(220px, width / 1.78, 320px)`,
  legend in the header), response-time histogram (bar recipe), correlation matrix (cell side `clamp(20px, column / (n + 1), 44px)`,
  numbers inside a cell only when the cell is 32 px or wider, row labels truncated at 120 px, column labels rotated
  -60 degrees; scrolls inside its card above 12 metrics, never wider than the card).
- **Grid**: overview cards flow in a container-query grid, `repeat(auto-fit, minmax(260px, 1fr))`, gap `--space-md`; one card is
  never narrower than 260 px, so 2 / 3 / 4 per row at the four steps (1: compact 279, 2: narrow, 3: mid, 4: wide) as today.
- **States.** Hover (a bar): `filter: brightness(var(--hover-brightness))`, siblings to `--dim-opacity`; focus-visible: 2 px
  `--accent-primary` outline with 1 px offset; selected (a filter active): 2 px `--text-primary` outline; pressed `--bg-active` on the
  column behind it; no transform on hover. Empty: the slot shows centred `--text-muted` copy "No scored items" at the same 146 px.
  Loading: `Skeleton` of the slot. Error: `ErrorState` compact in the slot. Entrance: bars rise with `scaleY` from the baseline
  (transform-origin bottom) and the count fades in with the same duration and stagger (so a count never hangs over empty space);
  nothing animates under `prefers-reduced-motion`.
- **Keyboard and screen reader.** Unchanged marks: each column is a `button` named by its `aria-label` ("31 items in 0%, filter the
  table"), the visible count is `aria-hidden`; Tab order left to right; Enter/Space filters. Each plot is a `role="group"` with
  the chart name; each card is a `section` with `aria-label` = title.

### 1.4 Acceptance criteria (P1)

| # | Criterion | How to measure |
|---|---|---|
| P1-1 | Every bar with count > 0 has its count label directly above it: label bottom to bar top is 4 px or less, at 1440 and 390, in the overview cards, the response-time histogram and "Passes passed". | `getBoundingClientRect` of each `.count` vs `.bar` |
| P1-2 | No count is hover-only: every count is visible with the pointer outside the card. | screenshot diff with and without hover; test reads text content |
| P1-3 | No chart card has more than 16 px between the bottom of its lowest plot element (axis label, sub label, legend or stat cell) and the card's bottom border, at 1440 and 390. | `card.bottom - plot.bottom <= 16` for every `section[aria-label]` card |
| P1-4 | In one overview grid row all cards have the same plot height; heights differ only by the note line (at most one extra 16 px line). | max - min of `[role=group]` heights per row <= 16 |
| P1-5 | Boolean metrics render as a bar chart in the same slot (3 columns, counts above, percentage under the label), no horizontal split bar remains. | no `[aria-label$="pass and fail split"]` with height 24; three `button` columns |
| P1-6 | `tokens_used`-style numeric cards centre their stat cells in the slot: top and bottom space around the cells differ by at most 4 px. | compare `cells.top - slot.top` and `slot.bottom - cells.bottom` |
| P1-7 | Every chart (overview, latency, deep, repeat) lives in a `Card` with a title in a header slot; there is no chart title or legend outside a card. | every `svg[role=img]` and `[role=group][aria-label*=distribution]` has a `section` ancestor with a header |
| P1-8 | At 390 the 11-bucket histograms show 6 axis labels (every second bucket) and no two labels overlap (boxes disjoint); counts up to 3 digits do not overlap their neighbours. | pairwise box intersection over `.axis` and `.count` |
| P1-9 | A card never overflows its column: `scrollWidth <= clientWidth` at 1440, 1024, 768, 390. | assertion |
| P1-10 | The curve labels Pass@k above and Pass^k below each labelled point; at 390 only the first and last points are labelled; every label has a halo (`stroke` present). | DOM query of `text.pointLabel` count (4 at 1440, 2 at 390 per series) |
| P1-11 | Grid cards are at least 260 px wide at every viewport. | min of card widths |
| P1-12 | No colour is introduced: the CSS of the chart module contains no hex, `rgb(`, `rgba(`. Design-language test green. | existing test |
| P1-13 | Under `prefers-reduced-motion` no bar or count animates (computed `animation-name: none`). | emulate reduced motion |

### 1.5 Tests (P1)

- Vitest: `charts/chartLabels.test.ts` (`thinAxisLabels(n, columnWidth)`, `abbreviateCount`, zero-count rules), `charts/Histogram.test.tsx`
  (renders a count node per non-empty bucket, DOM order count then bar).
- Playwright `e2e/run-detail/redesign3-charts.spec.ts`: P1-1 to P1-4, P1-6, P1-8 to P1-11 at 1440 and 390 on the classic and wide-repeat runs.
- `e2e/run-detail/a11y.spec.ts`: add the wide repeat run (zero serious violations at both widths).

## 2. P2: repeat run analysis

> "repeat run analysis doesn't seem clear or organized, refer to the old design (metric should chosen from a dropdown instead of
> showing 20 metrics that span beyond the page boundary, the elements below metrics are not utilizing the full page width, boxes
> for statistics are not clearly separated and non centered - also remove grouping of statistics -)"

### 2.1 Problem (measured on the wide repeat run: 10 passes, 24 metrics; `current-repeat-1440.png`)

1. The metric control is a `SegmentedControl` row of 24 options: **2455 px wide in a 1193 px column** (2.06x; also 2455 inside 279 px at 390),
   scrolling sideways inside the section. (Legacy also scrolls its chip row; it is the thing to fix, not to copy.)
2. The By-pass table has 29 columns and is **3167 px wide** (2.65x the column); the Pass, metric and latency columns the reader
   wants are off screen after the first screen of metrics.
3. The statistics are one `StatStrip` with three labelled groups (Capability, Consistency, Speed and errors): 1193 x 99 px, cells
   left aligned, separated only by hairlines inside one outer border, so they read as one slab; the user wants separate centred
   tiles and no grouping.
4. Width is used unevenly. Redesign2 capped the curve, distribution and table at 1100 px and left aligned them while the strip is the full column (1193 px at 1440); the curve and
   distribution are stacked one per row, each as wide as the column, so the section is about 1,440 px tall for what is one reading
   unit, and the per-pass table (3167 px) overflows instead of filling the row. This is what "the elements below metrics are not utilizing the full page width" describes: wide, sparse, stacked blocks and an
   overflowing table, not a layout that fills the row.

### 2.2 Legacy reference (`legacy-repeat-1440.png`)

Legacy: a metric toggle (`correct | rubric_metric_01 | ...`, overflowing too), **one connected 7-cell strip** with centred label,
info marker and big value (Pass@10, Pass^10, Consistency, Reliability, Avg Score, Avg Latency, Errors), a per-pass table with one column per
metric and the best pass of each column tinted, then "Repeat Performance": the curve panel (about 2/3 width) beside the
distribution panel (about 1/3). Keep: the seven statistics in the legacy order, **centred** label-over-value cells, the curve beside
the distribution (this is what uses the width), the per-pass table. Do differently: a dropdown instead of the chip row, **separate
tiles with gaps** instead of one slab (the user's explicit complaint), a one-line plain-language meaning in every tile, the
per-pass table shows one metric by default with a column picker (24 columns by default is the other overflow), no tinted table
cells (calm surface rule: one tint fill per row region).

### 2.3 Design (`mock-r3-repeat-panel-1440.png`, `mock-r3-repeat-panel-390.png`)

Everything inside the existing `ReportSection id=run-section-repeat`, full column width, no max-width cap (the 1100 px cap is removed; section 8).

```
wide / mid (>= 900)
Repeat run analysis                                     Every item was evaluated 10x. Higher is better.
-------------------------------------------------------------------------------------------------------
Metric
[ correct                      v ]  One metric drives the tiles, the curve and the distribution. ...
Pass@10 100.0%, Pass^10 4.2%: 96 pts of items pass at least once but not every time.
+--------+ +--------+ +--------+ +--------+ +--------+ +--------+ +--------+     7 equal tiles,
|PASS@10 | |PASS^10 | |CONSIST.| |RELIAB. | |AVG SCORE |AVG LAT.| | ERRORS |     gap --space-sm (8px)
| 100.0% | |  4.2%  | | 33.3%  | | 56.7%  | | 56.7%  | |  1.8s  | |   0    |     value --font-stat 26 mono centred
| one line| one line| ...                                                       |     meaning --font-sm muted, max 3 lines
+--------+ +--------+ ...                                                        |     band rail under the tile (rail="bottom")
+--- Across attempts ---------------------------------+ +--- Passes passed ----------+   wide (>= 1100): 2fr | 1fr, equal height
| legend  [Chart|Table]                                | | Items by passes passed     |   narrow and below: stacked, each full width
|  curve, labels above/below points                    | |  bars with counts on top   |
+------------------------------------------------------+ +----------------------------+
+--- By pass ------------------------------------ Metrics shown: correct (1 of 24) [Metrics v] -+   full width
| PASS   CORRECT    AVG LATENCY   MEDIAN   ERRORS   ITEMS                                       |
```

1. **Metric selector.** One `Select` (`ui/Select`, 24 px, label "Metric", **width 280 px**; `searchable="auto"` so it searches above 8
   metrics, as the primitive already does) followed by one muted `--font-sm` sentence (copy below). Value state stays in the URL as
   `?metric=<name>` (the existing contract of `cutover-repeat-metric.spec.ts`); the **default** is the run's primary metric
   (`primary: true`), else the analysis metric, else the first metric. Items show the metric name; boolean metrics add the description
   "True / False" (in the item `description`). Nothing else in the section scrolls horizontally because of the metric count.
   The control row is `display: flex; flex-wrap: wrap; align-items: flex-end; gap: --space-sm --space-md`.
   Copy: "One metric drives the tiles, the curve and the distribution. The table below shows every pass." Direction sentence
   ("Higher is better") stays in the section description line.
2. **Verdict line** unchanged (`verdictLine`), `--font-base` primary, directly under the control row, 14 px gap.
3. **Tiles (no groups).** Exactly 7 tiles in this fixed order: Pass@k, Pass^k, Consistency, Reliability, Avg score, Avg latency,
   Errors (the legacy order; `Median latency` stays a column of the table). The group labels (Capability, Consistency, Speed and
   errors) and `StatStripItem.group` are not used here. A tile is a `Card compact` with `rail="bottom"`:
   - container: centred column (`align-items: center; justify-content: center; text-align: center`), `min-height: 112px`,
     padding `--card-padding-compact`, gap `--space-xs`; all tiles of a row are the same height (grid stretch);
   - label: `--font-sm` 600 uppercase `letter-spacing: 0.05em` muted, with the existing `HelpMarker` (long copy from `repeatCopy`) inline after the text;
   - value: `--font-stat` 700 mono tabular-nums; colour = band tone text (`data-band`) for Pass@k, Pass^k, Consistency, Reliability, Avg
     score (direction-aware, `lib/metrics.ts`), neutral `--text-primary` for Avg latency and Errors (Errors > 0 uses `--error-text`);
   - meaning: one line (it may wrap to at most 3 centred lines, `max-inline-size: 22ch`), `--font-sm` muted. Copy (k is the pass count):
     Pass@k "Items that passed in at least 1 of {k} passes"; Pass^k "Items that passed in all {k} passes"; Consistency "Items whose {k} passes all agree";
     Reliability "Chance an item passes, over items solved at least once" (the existing long help says it precisely); Avg score "Mean of
     {metric} over all passes"; Avg latency "Mean time per item and pass"; Errors "Item runs that failed to produce a result";
   - rail: 3 px `rail="bottom"` in the value's band (`Card band`); latency and errors have no rail. No hover (passive card);
   - grid: **wide and mid** (>= 900): `repeat(7, minmax(0, 1fr))`, gap `--space-sm`; **narrow** (560 to 899): a 12-column grid, tiles 1 to 4
     span 3, tiles 5 to 7 span 4 (so both rows fill the width, each row's tiles are equal); **compact** under 480: 12-column,
     tiles 1 to 6 span 6 (3 rows of 2) and tile 7 spans 12. Row gap = column gap = `--space-sm`.
4. **Across attempts and Passes passed** are two `ChartCard`s: at wide (>= 1100) side by side, columns `minmax(0, 2fr) minmax(0, 1fr)`,
   gap `--space-md`, **equal height** (the shorter plot grows: `Card fill`); at mid and below they stack, each the full column.
   The distribution (11 bars for k = 10: 0..10) uses the P1 bar recipe, bars coloured band 1 (0 passed), band 5 (all passed) and band 3 for
   the rest, x labels `0..k`, a caption under the plot "Passes passed, out of {k} (0 = always fail, {k} = always pass)",
   click or Enter filters the items table (existing `repeat` filter). Counts on top of the bars, zeros shown.
5. **By pass table** (a `DataTable` in a `Card flush` with a header; the design-language test forbids raw `<table>` markup outside `ui/DataTable`, and `RepeatTab.tsx` leaves
   its allow-list entry with this change): full column width, never wider than the column unless the reader
   picks more metric columns. Columns: Pass (a `Tag kind="count"` "Pass n", links to `?pass=n` as today), the **selected metric**
   (emphasised: `--text-primary`; `ScoreValue`; best and worst get a `Tag tone="success|danger"` "best" / "worst" as today), Avg latency,
   Median, Errors (> 0 in `--error-text`), Items. Queued passes keep their muted row. The header right side shows
   "Metrics shown: {metric} (1 of 24)" and a `MultiSelect` "Metrics" (search, All, None) to add more metric columns; adding columns
   keeps the first column pinned and the table scrolls inside the card with the shared scroll cue (`useScrollCue`). Default row
   height `--row-regular`. Compact (< 640 container): only Pass, the selected metric (best / worst tag on a second line) and Errors remain (the DataTable column `priority`
   feature; Avg latency, Median and Items are reachable through the Metrics / Columns menu), and the Pass tag does not wrap (`white-space: nowrap`).
6. **Vertical rhythm**: 14 px (`--space-md`) between control row, verdict, tiles, the chart row and the table card; the section
   header owns the 48 px lead-in. Total height at 1440 for the wide-repeat run is at most 1,150 px (mock 1,083 px).
7. **States.** Loading: tiles and cards as `Skeleton` (same boxes, no layout shift). Metric without direction or numeric: the tiles Pass@k,
   Pass^k, Consistency, Reliability are replaced by the single tile "Avg score" plus Avg latency and Errors (3 tiles, row fills the width via
   `repeat(3, 1fr)`) and the curve offers only the Average statistic (existing behaviour of `statisticOptions`). Empty (no completed pass): `EmptyState`.
   Error: `ErrorState`. A pass still queued: row muted, tile values computed over completed passes with the existing "k of N passes" note in the verdict.
8. **Keyboard and screen reader.** The Select is the React Aria listbox (type-ahead, Arrow, Enter, Escape). Tiles are a `role="list"`
   named "Repeat run statistics" with `listitem` children; each value is read as "Pass@10, 100.0%, items that passed in at least 1 of 10
   passes". The curve keeps its `role="img"` label and tooltips on markers; the distribution columns are buttons.

### 2.4 Acceptance criteria (P2)

| # | Criterion | Measure |
|---|---|---|
| P2-1 | The metric control is a single `Select` (`button[aria-haspopup=listbox]` with label "Metric"), 280 px wide, default = primary metric else first; the section has no `radiogroup` of metrics. | DOM query |
| P2-2 | With 24 metrics no element inside `#run-section-repeat` is wider than the column except the opt-in "more metric columns" table scroller: `scrollWidth <= clientWidth` at 1440 and 390 with the default columns. | script over descendants |
| P2-3 | Choosing a metric writes `?metric=` and reload restores it; the verdict, tiles, curve and distribution change; the table keeps all passes. | e2e |
| P2-4 | Exactly 7 tiles (3 for a numeric metric), no group labels, no element with `data-group` inside the tile list. | count |
| P2-5 | Tiles are separate: each tile is its own bordered `Card`; gap between neighbours is 8 px (+-1) horizontally and vertically; at 1440 all seven tiles have equal width (+-1 px) and height (+-1). | bounding boxes |
| P2-6 | Tile content is centred: for each tile the label, value and meaning line centres are within 2 px of the tile's centre line (x). | boxes |
| P2-7 | Every tile has a one-line meaning (text length 1..80 chars) under its value. | text assertion |
| P2-8 | The tile grid fills the width at every step: left of tile 1 = column left, right of the last tile of each row = column right (+-1 px); at 390 two columns and a full-width seventh tile. | boxes |
| P2-9 | At wide the curve card and the distribution card are side by side (curve about 2/3, distribution about 1/3: widths ratio 1.9 to 2.1) with equal heights (+-1 px); below 1100 they are stacked and each as wide as the column. | boxes |
| P2-10 | The By-pass table card is as wide as the column; with default columns its table has at most 7 columns; `Metrics` multi-select lists all 24 metrics; selecting two more adds two columns and a scroll cue. | assertions |
| P2-11 | Count labels on top of the distribution bars, zeros shown, no count more than 4 px from its bar (P1-1). | as P1 |
| P2-12 | The section is at most 1,150 px high at 1440 for the wide-repeat run and at most 1,750 px at 390. | height |
| P2-13 | No horizontal page scroll at 390 (document scrollWidth <= innerWidth). | assertion |
| P2-14 | Axe: zero serious or critical issues on the repeat section at both widths. | `a11y.spec.ts` |

### 2.5 Tests (P2)

- Vitest: `lib/repeatCopy.test.ts` extended (`tileMeaning(k, metric)`), `panels/RepeatTiles.test.tsx` (7 tiles, 3 for numeric, grid classes per step via a
  `data-step` attribute set by the container query hook).
- Playwright `e2e/run-detail/redesign3-repeat.spec.ts`: P2-1 to P2-13 on `seedWideRepeatRun`; `cutover-repeat-metric.spec.ts` updated to drive the Select.

## 3. P3: categories

> "categories feels overwhelming and not clear, refer to the old design"

### 3.1 Problem (`current-categories-1440.png`)

Measured on the many-categories run (5 keys with 24 / 14 / 9 / 6 / 4 values): the section shows 5 key chips **with "+" add-key
buttons between them** (9 chips and buttons on the first line), a "Rank by" select, a key title with a muted metric line, a
generated sentence ("Weakest: topic-b 46% (13 items, 18 pts below overall). Strongest: topic-x 86%."), a 5-column table, and a
"Show all 24 values" button. That is five controls and two text blocks before the first number. The bars live in a column that
starts at x = 913 of 1193, 700 px away from the value name, so row and bar are hard to associate. Section height 623 px; at 390,
1351 px (the chips and select stack). The `+` chips (multi-key compare) are the main source of "what do I press".

### 3.2 Legacy reference (`legacy-categories-1440.png`)

Legacy: a "CATEGORIES" chip bar (one chip per key, with the value count), a Cards | Compare toggle, an "Overall metric average
score 57%" badge, then per key a coloured header and **small cards per value**: name, then AVERAGE / ITEMS / LATENCY as a labelled triple with the
average in its score colour, and a bar **with a tick at the overall average**. Keep: key chips with counts, the three numbers per value
(average, items, latency), the colour-coded average, the **baseline tick**, "overall" shown once. Do differently: **one key at a time**
(legacy printed every key, which with 5 keys is the wall of cards), rows rather than 5-per-row cards (cards of 120 px width with three tiny
numbers do not scale to 24 values), no Cards | Compare toggle (React has no Compare view; open question decided in section 9).

### 3.3 Design (`mock-r3-categories-1440.png`, `mock-r3-categories-390.png`)

```
Categories                                    Performance by item metadata. Click a value to filter the items.
------------------------------------------------------------------------------------------------------------
[ complexity · 4 | domain · 5 | source · 2 | region · 9 ]                      Metric: quality · overall 49%
+- complexity  4 values -------------------------------  | Overall average   [ Worst first | Best first ] -+
| Weakest: expert 25% (24 pts below overall). Strongest: easy 80%.                                          |
| VALUE        AVERAGE                                      ITEMS   PASS   LATENCY                        |
| expert       [=====|-----------------------]  25%          66      0%     3.1s                           |
| hard         [==========|-----------------]  48%          69     19%     1.4s     (| = overall average) |
| ... first 6 rows, then  [ Show all 24 values ]                                                           |
+-----------------------------------------------------------------------------------------------------------+
```

1. **Key switcher.** A `SegmentedControl` (label "Category", options `key · valueCount`) when there are **up to 5 keys and the
   labels fit** the column; otherwise a `Select` (label "Category", width 240 px, searchable) with the same items. Exactly one key is selected at a time; the default is the key
   with the largest best-to-worst spread (as redesign2 decided, computed once), falling back to the first key. The "+" add-key chips and the multi-key behaviour are
   **removed**. The selected key is stored in `?category=` (new, replaces local state; deep links keep working; the legacy `categories[key]` filters are unchanged).
   Right side of the row: one muted sentence `--font-sm` "Metric: {metric} · overall {n}%" (the analysis metric; the metric is changed in
   the Items toolbar, not here).
2. **One card** (`Card`, header + body, no rail) per selected key:
   - header: key name `--font-md` 600 and the value count `--font-sm` muted on the left; right: a legend entry "| Overall average"
     (the tick glyph, 2 px x 12 px `--text-primary`, then muted text) and a 24 px `SegmentedControl` "Order": Worst first (default) | Best first. The
     old "Rank by" select and the Index / name sorts are removed (alphabetical order is available by the table of values in Items).
   - an insight line, one sentence, `--font-sm` muted, only when the key has two or more values: "Weakest: {value} {n}% ({d} pts below overall).
     Strongest: {value} {n}%." (existing computation).
   - rows: grid `minmax(120px, 220px) minmax(0, 1fr) 64px 64px 72px` (value, average bar + percentage, items, pass, latency),
     gap `--space-md`, row height `--row-regular` (40 px), hairline between rows (`--border-subtle`), header row `--table-header-height`
     (34 px) in the data-table header style (`--font-sm` 650 uppercase muted, `letter-spacing: 0.05em`); numeric columns right aligned mono,
     tabular-nums, `--font-base`. The **bar sits directly after the value name** (the value column is at most 220 px wide), so name and bar are
     one glance apart. Bar: track `--bg-elevated`, height 12 px, radius `--control-radius`, fill in the band of the average
     (`data-band`, direction-aware), a 2 px x 18 px `--text-primary` tick at the overall average (the legacy baseline marker), then the percentage
     (mono, 650, `--tone-text`, 40 px wide, right aligned).
   - **default shown values: 6.** More: a `Button variant="neutral"` "Show all {n} values" under the list (local state; once open "Show fewer"). Limit applies to
     every key, so a 24-value key paints 6 rows first.
   - row = one `button` (the whole row), `aria-pressed` while its filter is active; click toggles the existing filter (`complexity`,
     `domain` or `categories[key]`). Hover `--bg-hover`; selected `--bg-selected` with the 2 px accent bar at the inline start; focus-visible
     2 px accent outline inset by 2 px.
3. **Compact (< 640 container).** The header row of the table is hidden. Each value is a two-line row: line 1 value name (truncating) then items
   and pass% (mono), line 2 the full-width bar with its percentage; latency is dropped (it stays in the tooltip, `title`). Row height auto, 8 px vertical padding.
   The switcher is the `Select` below 4 keys' worth of width (labels would not fit 279 px).
4. **No band fill on selection**: selected rows use only the accent bar and `--bg-selected`; the bar colour always means the average band.
5. **States**: one key only: no switcher (just the card). A key with one value: no insight line. No categories: the section stays hidden (as today). Loading: `Skeleton` rows (6).
   Metric without direction: bars neutral (`--text-muted` fill), percentage neutral.
6. **Keyboard and screen reader**: SegmentedControl is a radiogroup (Arrow keys); rows are buttons in a `role="group"` named "Values of {key}, {order}"; the
   bar has `role="img"` with `aria-label` "average 25%, overall average 49%".

### 3.4 Acceptance criteria (P3)

| # | Criterion | Measure |
|---|---|---|
| P3-1 | The section's controls before the first value row are at most 2 interactive elements wide of the content (the key switcher, the Order control): no "+" button, no "Rank by" select exists. | count `button, [role=combobox]` above first row = switcher options + 2 |
| P3-2 | Exactly one key's values are listed at a time. | assert only one `role=group[aria-label^="Values of"]` |
| P3-3 | At most 6 value rows render by default; "Show all N values" appears only when N > 6 and reveals the rest. | row count |
| P3-4 | The bar starts at most 240 px (+ column padding) from the value text start at 1440 (value column <= 220 px + gap). | box distance |
| P3-5 | A tick marks the overall average on every bar, at the same x for every row of the card (+-1 px). | tick `left` equality |
| P3-6 | Row click toggles the existing item filter and sets `aria-pressed`; a second click clears; a scope chip appears in the ScopeBar. | e2e |
| P3-7 | `?category=<key>` selects the key on load; the default is the key with the largest spread. | e2e on `seedManyCategories` |
| P3-8 | Section height with the 24-value key at 1440 is at most 460 px (was 623), at 390 at most 900 px (was 1351). | height |
| P3-9 | No horizontal scroll at 390; at 390 each row has the bar full width on its own line. | boxes |
| P3-10 | Average colours follow `metricBand`; a metric without direction renders neutral bars. | unit test |

### 3.5 Tests (P3)

- Vitest: `lib/categoryModel.test.ts` (`defaultKey`, `orderValues`, `insightLine`, `visibleValues(rows, 6, expanded)`), `panels/CategoriesTab.test.tsx`.
- Playwright `e2e/run-detail/redesign3-categories.spec.ts`: P3-1 to P3-9; update the existing categories specs for the removed chips.

## 4. P4: the items header must not hover over an expanded item

> "in items when an item is clicked the column names hover when the user scroll down"

### 4.1 Problem (`current-item-sticky-header-1440.png`)

The items table header (`.thead th`, `position: sticky` through the page-scroller shift `--head-shift`, `ui/DataTable/useStickyShift.ts`) stays at
the sticky line (section nav 44 px + items toolbar 56 px = 100 px below the top of the scroller) for the whole table height. An expanded item
renders inside a `tr` of the same table, so while the reader scrolls through a tall detail (10 passes x 24 metrics is about 3,000 px) the
column names STATUS / INPUT / REASON / CORRECT / RUBRIC_METRIC_01 ... stay glued **over the item content**. Measured: the header (34 px column row plus the 24 px group band) is 58 px high and
overlaps the first 58 px of the expanded content at every scroll offset inside the detail; the columns are meaningless there because the detail is not laid out in those columns.

### 4.2 Legacy reference

Legacy items are not a table: each item is a card with its own header; nothing sticky belonged to the list. Keep that idea inside the expanded
region: the expanded item owns its own header (`ItemBar`), the table header does not.

### 4.3 Design

**Rule.** The column header is sticky **only while the sticky line is over collapsed rows**. For every expanded item *E* the header is suspended on
the interval from "E's detail top reaches the header bottom" to "E's detail bottom crosses the sticky line":

```
scroll ->          table top
                   +---------------------+  header sticky (shift grows) while the line is over rows 1..k
  sticky line  ->  | HEADER (34 + band)  |
                   | row 1 ... row k     |  row k+1 is expanded
                   | row k+1 (expanded)  |
                   +- detail top --------+  header bottom touches detail top: header STOPS and scrolls away with the content
                   | ItemBar (sticky, 32)|  from here the ItemBar owns the sticky line
                   |  input / output ... |
                   +- detail bottom -----+  line crosses the bottom: ItemBar leaves, the header re-appears at the line
                   | row k+2 ...         |
```

Precisely (`useStickyShift` gains `suspend`):

- Let `line` = the existing sticky line (viewport y of the scroller top + `--run-nav-h` + the toolbar height when it is sticky), `headH` = header
  height (`--table-header-height`, plus `--table-group-height` when a band row exists), `tableTop` = table top.
- `shift = clamp(line - tableTop, 0, tableH - headH)` as today, **then**
  `shift = min(shift, detailTop(E) - tableTop - headH)` for the first expanded detail whose `detailTop - tableTop - headH >= 0`, evaluated for **every** *E*,
  and `shift = clamp(...)` unrestricted once `line >= detailBottom(E)` (the interval ended).
  Between the two the header is therefore at a fixed offset above the detail and scrolls away with the page; it never overlaps a detail.
- When the line passes *E*'s bottom the header returns to the line **immediately** (no animation; no fade under reduced motion; 150 ms opacity fade otherwise). It is
  allowed to jump because the content it returns over is rows again.
- Several expanded items: apply the rule to each; the header is suspended inside each detail span and sticky between them.
- Table with no expanded row: unchanged. Pinned header cells (pinned columns) follow the same shift.
- **ItemBar.** Each expanded detail starts with a sticky bar: `position: sticky; top: var(--sticky-line)` (the same line, so when the table header
  is suspended the bar takes its place), height `--row-compact` (32 px), `--bg-surface` opaque, a 1 px `--border-subtle` bottom hairline, z-index below the section nav
  and the items toolbar. Content, left to right: `#n` (mono 650 primary), verdict `Tag` ("Fail" / "7 of 10 passed"), the input preview (one line, `--font-base`
  secondary, ellipsis, `dir="auto"`, flex `0 1 auto`, hidden under 640 px), then actions at the end: "Copy link" `CopyButton`, "Collapse" `Button` (24 px, `chevron-up`). Focus: the bar is not a tab stop; its buttons are.
  `aria-label="Item #n"` on the detail `article`. Collapse restores focus to the item's row.
- **Phone (cards, below 640 px)**: there is no `thead`; the ItemBar is the same, sticky at `--run-nav-h` (44 px) since the toolbar is not sticky below 761 px.
- **Items toolbar** (56 px, `--bar-action-h`) is not part of this change: it stays sticky across the section (it is a toolbar, not a column header).
- Reduced motion: no change (nothing here animates besides the 150 ms optional fade).

### 4.4 Acceptance criteria (P4)

| # | Criterion | Measure |
|---|---|---|
| P4-1 | For every scroll position (sampled every 100 px) while an item is expanded, the bounding box of the table header (`thead`) does not intersect the bounding box of any expanded detail (overlap area 0, 1 px tolerance). | boxes at 100 px steps from the table top to its bottom, at 1440 and 1280 |
| P4-2 | With no item expanded the header sticks at the sticky line (within 1 px) while any part of the table body is below it, as today. | existing sticky specs stay green |
| P4-3 | With an item expanded, the header sticks again below the detail: with the line over rows after the detail, `thead.top == line` (+-1 px). | boxes |
| P4-4 | While the line is inside a detail, the ItemBar is at the line (`top == line` +-1 px), 32 px high, and shows the item number; there is one ItemBar per expanded item. | boxes |
| P4-5 | Two items expanded: P4-1 holds for both; the header is visible between them when the line is over collapsed rows. | e2e |
| P4-6 | Collapse in the ItemBar closes the item and returns focus to the item's row (`document.activeElement` is that row). | e2e |
| P4-7 | Pinned columns and band header cells follow the same shift (no pinned header cell visible over the detail). | boxes of `th[data-pin]` |
| P4-8 | At 390 (cards) the ItemBar sticks at 44 px below the top and nothing else sticks over the card. | boxes |
| P4-9 | No regression in virtualised runs: the 5,200-row run (`items-virtual.spec.ts`) keeps header stickiness with no expanded row. | existing spec |

### 4.5 Tests (P4)

- Vitest: `ui/DataTable/stickyShift.test.ts` (pure `computeShift({line, tableTop, tableH, headH, details: [{top, bottom}]})`: before, between, inside, after, two details, no details, detail above the line).
- Playwright `e2e/run-detail/redesign3-items-sticky.spec.ts`: P4-1 to P4-8 on the classic run (a 3,000 px detail: expand the 10-pass item of `seedWideRepeatRun`).

## 5. P5: item details

> "in item details the design is so ugly and non user friendly (the input is from the right while the output is from the left, there's no clear
> separation of output from metric, output keys should be hidden by default, when a user shows an output key and it's a json or a list allow him to
> expand all keys if needed, colors for passes are ugly and only 4 colors when there's 10 passes)"

### 5.1 Problem (`current-item-arabic-1440.png`, `current-item-sticky-header-1440.png`)

1. **Two anchors.** An Arabic input is a row that mirrors with `dir` from the content: the label `INPUT` sits at the far right (x = 1347 of 1405)
   and the Arabic text ends at the right edge, while Output below it is left to right with labels at the left (x = 233). One card
   has a right anchor for Input and Expected and a left anchor for Output and Metrics.
2. **No separation of Output and Metrics.** The Output block ends with the metrics as a 23-row list of chips directly under the
   last output key (`confidence 0.7`, then `correct False`, `rubric_metric_01 ...`) with the same indent and no divider or heading; with 10
   passes the same list repeats inside every pass column, so one expanded item holds 10 x 24 = 240 metric chips.
3. **Output keys are all expanded.** Every key of every pass opens with its full value (JSON tables, arrays) so a 5-key output over 3 columns
   is roughly 700 px tall before the metrics start; a nested `meta` object prints as raw braces with its own disclosure but no way to open everything.
4. **Pass colours.** The pass rails and dots use `--chart-1..3` repeating (`data-hue` 1..4): 10 passes have **4 distinct colours** (sky, pink,
   orange, amber) so pass 1, 5 and 9 share a colour. The pink and orange rails also read as status colours in a table whose verdicts are red and green.

### 5.2 Legacy reference (`legacy-item-1440.png`)

Legacy: header row (chevron, `#1`, `10 passes`), INPUT (blue left rule, copy right), EXPECTED OUTPUT (green panel), metadata badges, then OUTPUT with
`[Pass 1] ... [Pass 10]` toggles and **one column per pass with a coloured rail** (colours cycle through 4 hues in legacy too),
each with `Pass n` / `Pass|Fail` / latency / Trace / copy, output keys as expanded rows, then each pass's metric list (a row per metric with a caret and a pencil) and a final
"Per-metric root cause analysis". Keep: INPUT, EXPECTED, tags, OUTPUT in that order from top to bottom; the pass chips with a verdict in each pass
header; Trace and copy per pass; a per-metric row with its value and an edit action; the metric detail opening under its row. Do differently: all
regions left-anchored with the same width; keys collapsed; no per-pass hue; one **metrics matrix** (metric rows x pass columns) instead of a chip list per pass; a divider and its own heading
between Output and Metrics.

### 5.3 Design

#### 5.3.1 Region model (top to bottom; `mock-r3-item-details-en-1440.png`, `mock-r3-item-details-ar10-1440.png`, the 390 pair)

```
+--- expanded detail: padding --space-md --space-lg, direction: ltr, text-align: start -------------------+
| #1  [7 of 10 passed]  Input preview ...                                         [link] [Collapse ^]   |  ItemBar (sticky, P4)
|---------------------------------------------------------------------------------------------------   |
| INPUT      ما هي شروط الحصول على تمويل عقاري ...                                          [copy]         |  region: label 7.5rem + body + actions
|---------------------------------------------------------------------------------------------------   |
| EXPECTED   الرياض                                                                         [copy]         |
|---------------------------------------------------------------------------------------------------   |
| TAGS       [complexity: easy] [domain: finance] [lang: ar]                                            |
|---------------------------------------------------------------------------------------------------   |
| Output   3 of 10 passes shown                       [Sections|Raw]  Expand all  Collapse all           |  region head (--font-md 600)
| [1 ✕] [2 ✓] [3 ✓] [4 ✕] [5 ✓] [6 ✓] [7 ✓] [8 ✕] [9 ✓] [10 ✓]   Select up to 3 passes to read side by side |  pass rail
| [Pass 1][Fail] 1.3s [Trace] | [Pass 2][Pass] 1.5s [Trace] | [Pass 3][Pass] 1.6s [Trace]                  |  pass columns (<=3), 1px hairline between
| > answer     الإجابة رقم 1: ...        | > answer ...                | > answer ...                       |  keys collapsed, one line each
| > reasoning  ...                       | ...                         | ...                                |
| > citations  array · 2 items           |                             |                                    |
|======================================================================================================  |  divider: 1px --border-strong, 20px above
| Metrics   13 shown of 24 · 1 metric differs across passes                                             |
| METRIC           1     2     3 ... 10    MEAN                                                          |  matrix: rows x passes
| correct        False True  True ... True   70%                                                         |
| rubric_metric_01 30%  43%  [56%] ...      58%                                                          |
|   Show 5 more metrics                                                                                  |
| +- rubric_metric_01 · Pass 3 ------------------------------------------------------ [edit] [x] -+    |  detail of the picked cell
| | REASON   يغطي معظم النقاط المطلوبة                                                               |    |
+---------------------------------------------------------------------------------------------------   +
```

**Anchors.** The whole detail is `direction: ltr` and `text-align: start`. Region labels (INPUT, EXPECTED, TAGS), keys, actions and the
matrix are always at the left edge: **a label never moves right because its text is Arabic.** Only the *value text elements* carry
`dir="auto"` (or `dir="rtl" lang="ar"` through `textDirAttrs` when the text is mostly Arabic). Value text blocks are
`inline-size: fit-content; max-inline-size: min(100%, 76ch)` (`--field-measure`) and `justify-self: start`, so a short Arabic value sits **next to its
label** and a long one fills a 76ch block whose lines are right aligned inside that block. Arabic leading 1.7 comes from `tokens.css`. Same left edge, same
width for Input, Expected, Tags, Output, Metrics: they share the padding box of the detail; the detail is the width of the visible scroller (`detailFit="viewport"`).

**Region rows (Input, Expected, Tags).** A grid `[label var(--field-label-width) = 7.5rem] [body minmax(0, 1fr)] [actions auto]`, gap
`--space-sm --space-md`, `padding-block: --space-sm`, hairline `--border-subtle` between rows. Label: `--font-sm` 600 uppercase `letter-spacing: 0.05em` muted, `text-align: left`, top
padding 3 px to align with the first text line. Actions: `CopyButton`s (and the link). Under 640 px of detail width the label sits above the body (one
column) and actions on the second row, end. `FieldRow` keeps its API but gains `labelAnchor="start"` (always left; default stays `auto` for other pages) and its `dir` is no
longer applied to the row, only to the value (section 7).

**Output region.** Heading `Output` (`--font-md` 600 primary) with the meta (`1.9s · 4 keys` for one pass, `3 of 10 passes shown` for many) in `--font-sm` muted, and on the right
`Sections | Raw` `SegmentedControl` (persisted `qym:json-view`), then `Expand all` and `Collapse all` ghost buttons (24 px).
`Expand all` opens **every key of every shown pass and every nested key recursively**; `Collapse all` closes all of them.

- **Pass rail** (only when the item has more than one pass): one `Chip` per pass in a wrapping row, gap 6 px. Chip content: pass number (mono) and a glyph
  (`✓` passed, `✕` failed; the glyph is the non-colour cue). Selected chips take the verdict tone (`tone="success"` / `"danger"`, the Chip recipe: selected fill in the tone),
  unselected chips are neutral outline with the glyph, so the whole 10-pass outcome pattern is readable at a glance. `aria-label` "Pass 3, passed". Behaviour: toggle;
  at least one stays selected; **at most 3 selected** on narrow and wider (selecting a 4th replaces the oldest selection); below `compact`, columns stack so up to 3 may stay selected.
  Default selection: passes 1, 2, 3 (or all when fewer). Help text (muted, `--font-sm`): "Select up to 3 passes to read side by side."
- **Pass columns**: `repeat(n, minmax(0, 1fr))` with n = shown passes (1 to 3), gap `--space-md`; columns separated by a 1 px `--border-subtle` inline-start border and
  `--space-md` padding (no coloured rails). Below 900 px of detail width the columns stack, separated by a hairline. A column header: `Tag kind="count"` "Pass n" (neutral,
  mono), `Tag` verdict (success "Pass" / danger "Fail"), latency (mono muted) and at the end a `Button` "Trace". A single-pass item has no header and keeps the existing 2 px verdict rail
  (`--success` or `--error`) at the inline start of the output.
- **Key rows (the disclosure).** One row per top-level key, `min-height: --row-compact` (32 px), hairline `--border-subtle` between keys. Row = a button: chevron (`chevron-right` /
  `chevron-down`, 14 px), the key (mono `--font-base` 600 primary), then, **while collapsed**, a one-line preview: scalar text (sans `--font-base` muted, ellipsis, `dir="auto"`, `text-align: start`) or
  a type summary (`object · 2 keys`, `array · 2 items`, `--font-sm` muted). **All keys are collapsed by default** (including the first). Open: the preview is replaced by the value body and the row gains
  Copy (`CopyButton`, label "Copy {key}"). The body is indented by 7 px under the chevron with a 1 px `--border-subtle` guide line at its inline start and `--space-md` padding.
  Scalar body: text block (`dir="auto"`, fit-content, max 76ch, `white-space: pre-wrap`), SQL in a code block (`--bg-elevated`, mono, the single allowed second fill level).
- **Nested JSON and lists.** An object or array body renders the same key rows recursively (array elements are `[0]`, `[1]`, collapsed, with `object · 3 keys` previews), each level one chevron,
  depth guide lines at each level, indent 7 px + 14 px. When a key that holds an object or array is open, its header row shows `Expand all` and `Collapse all` ghost buttons
  (right of the type summary) acting **recursively on that key only**; the Output region's `Expand all` / `Collapse all` act on everything. Arrays of 20 or more elements show the first 20 and "Show N more".
  A key whose value is a long string (over 400 characters) opens to 12 lines with "Show full value".
- **Raw view** (`Sections | Raw`): the pass column shows the JSON pretty-printed in a code block (`--bg-elevated`, mono, `unicode-based plaintext`), scrolling inside; Expand/Collapse are disabled.
- **Pass colour (the decision).** **A pass has no colour.** Pass identity is the number ("Pass 3" tag, the number in the chip and the matrix header), always text; colour on
  anything pass-related means only the verdict (success or danger, with the glyph and the word). The per-pass rails, `data-hue`, dots and the `chart-1..3` cycle are removed from item details.
  Justification: (a) `--chart-1..8` was designed for at most 8 series with pairwise minimum dE of 22 (normal), 10 (protan), 8 (deutan) (`colour-review.md`); ten categorical
  colours cannot reach the brief's dE >= 20 pairwise whatever the hues, and every extra hue lowers the minimum; (b) a sequential ramp of one hue encodes order and magnitude,
  and a pass number is neither, so a ramp would imply a trend that does not exist; (c) the user's two complaints, "ugly" and "only 4 colours for 10 passes", are both removed when
  nothing needs to be told apart by hue; (d) it follows the colour-as-information rule ("one colour, one meaning per page"): series colours are run, model and category identities; verdict
  tones are pass and fail. The Runs list Passes panel still cycles `--chart-1..3`; that is outside this stage and is listed as a follow-up (section 9).

**Metrics region.** Separated from Output by a full-width divider: `hr`, 1 px `--border-strong`, `margin-block-start: --space-lg` (20 px) above, and the region's own
heading `Metrics` (`--font-md` 600) with a muted summary ("13 shown of 24 · 3 below threshold" for one pass, "... · 1 metric differs across passes"), 8 px (`--space-sm`) between divider and heading.

- **Matrix** (a `DataTable`, `density="compact"`, `role="grid"`; cells are custom `render`s; no raw `<table>`): columns `Metric` (200 px, sticky inline-start, `--bg-surface`) then one column per pass (min 48 px; 10 passes fit a 1,100 px detail
  without scrolling: 200 + 10 x 64 + 72 = 912 px) and `Mean` (72 px) for multi-pass items; single-pass items have `Metric` (200), `Score` (96, centred) and `Reason` (the remaining width, one line,
  ellipsis, secondary, `dir="auto"`). Header row `--table-header-height`, `--font-sm` 650 uppercase muted; rows `--row-compact` (32 px) with `--border-subtle` hairlines, no zebra.
  Metric names mono `--font-base` secondary; values mono `--font-base`, colour = band tone text (`data-band`) or `--text-primary` for undirected metrics; booleans show True / False in
  band 5 / band 1 text; **no tinted cell fills** (calm-surface rule: one tint per row region); errored values show "Error" in `--metric-error`. The Mean column is `--text-primary` 650.
  The analysis metric row is first, the rest in run order. **Default 8 rows**, then a ghost button "Show N more metrics" (and "Show fewer metrics"); `Collapse` animation.
  Below 640 px of detail width only the shown passes (1 to 3) and Mean render; the metric column is 40% wide; the table never scrolls sideways (hidden passes are re-selected from the pass rail).
- **Detail of a cell.** Clicking a value (or Enter) selects that metric x pass cell (2 px `--text-primary` outline) and opens **one** detail panel below the matrix (`--bg-elevated`, 1 px
  `--border-default`, `--radius-md`, padding `--space-sm --space-md`): header `metric name` (mono) + `Tag` "Pass n" + edit (`IconButton edit`) + close; body: a definition grid
  (`7.5rem | 1fr`) with `Reason`, `Explanation`, `Label` first as full-width rows (value text `dir="auto"`, fit-content, max 76ch, left anchored), then the remaining scalars (mono),
  then object values through `StructuredValue` (collapsed). The score editor (`ScoreEditor`) opens in the same panel (title "Edit {metric}"). A metric without recorded details opens the panel with "No details were recorded for this metric." and the edit action.
- **Keyboard and screen reader.** The matrix is a `grid` with roving tabindex: Arrow keys move between cells, Home/End to row ends, Enter/Space opens the detail, Escape closes it. Each cell's name is
  "{metric}, pass {n}: {value}". Key rows are buttons with `aria-expanded` and `aria-controls`; Expand all and Collapse all have `aria-label` "Expand all output keys" / "Collapse all output keys".
  The pass rail is a `group` named "Passes shown". Focus rings are the shared 2 px accent outline.
- **Motion.** Key bodies and the matrix extra rows animate with `Collapse` (180 ms, none under reduced motion). Nothing else moves.
- **Empty and error states.** No output: the Output region shows "No output was recorded." in `--text-muted`; failed item: the verdict tag is danger and the error message is
  the first key row ("error", opened by default as the only exception to collapsed-by-default). No metrics (restricted run): the Metrics region reads "Scores are visible to admins only" (existing private-test-set copy).
  Loading: three `Skeleton` rows per region.

### 5.4 Acceptance criteria (P5)

| # | Criterion | Measure |
|---|---|---|
| P5-1 | In an expanded item the left edge of the label text (INPUT, EXPECTED, TAGS), the `Output` heading, the key names and the `Metrics` heading are equal (+-1 px) for an English and an Arabic item, at 1440, 1280 and 390. | `x` of each element, both fixtures |
| P5-2 | For an Arabic input, the label is at the left (x of label < x of value text) and the distance from the label's right edge to the first glyph's block start is at most 7.5rem + 14 px + 1 px; the value block's right edge is at most 76ch from its left edge. | boxes |
| P5-3 | `dir` is set only on value text elements (`[dir=rtl]`, `[dir=auto]`); no region row, label, button or matrix header has `dir` other than `ltr`/unset. | DOM query |
| P5-4 | On opening an item no output key is expanded (`[aria-expanded=true]` count 0 inside the Output region), for English and Arabic fixtures, single and 10-pass items. | assertion |
| P5-5 | Opening a key with a nested object shows its first-level keys collapsed with a type summary; a key header shows "Expand all" / "Collapse all"; "Expand all" opens every nested level (no `[aria-expanded=false]` remains inside that key); "Collapse all" closes them. | e2e on `meta` of the wide run (depth 4) |
| P5-6 | The Output region's "Expand all" opens all keys of all shown passes recursively; "Collapse all" restores the default. | e2e |
| P5-7 | A visible divider separates Output from Metrics: an `hr` (or border) 1 px `--border-strong`, at least 20 px above the `Metrics` heading region and full detail width; no metric appears above it. | computed style and order |
| P5-8 | The Metrics region is a matrix with one row per metric; a 10-pass item with 24 metrics renders at most 8 rows initially, at most 10 pass columns plus Mean, and no horizontal scroll at 1440 (matrix `scrollWidth <= clientWidth`). | assertion |
| P5-9 | Pass identity carries no colour: no element in the item detail has `data-series`, `data-hue`, a `--chart-*` colour, or a coloured rail identifying a pass; every pass column, chip and matrix header contains the pass number as text. | DOM and computed style |
| P5-10 | A 10-pass item shows 10 chips, each with its number and a ✓ or ✕, selected chips toned success or danger; the number of distinct pass labels equals 10. | assertion |
| P5-11 | At most 3 pass columns render; selecting a fourth deselects the oldest; at 1440 the columns are equal width (+-1 px). | boxes |
| P5-12 | Clicking a matrix value opens exactly one metric detail panel under the matrix with the reason; clicking another closes the first; edit opens `ScoreEditor` in the panel; Escape closes it. | e2e |
| P5-13 | The ItemBar (P4) is present once. | count |
| P5-14 | A 10-pass item with 24 metrics is at most 1,400 px high at 1440 with default state (was about 3,000 px). | height |
| P5-15 | No horizontal page scroll at 390 and the detail is never wider than the visible scroller. | assertion |
| P5-16 | Axe: zero serious or critical on the expanded Arabic and wide-repeat items at 1440 and 390. | `a11y.spec.ts` |

### 5.5 Tests (P5)

- Vitest: `ui/StructuredValue/structuredValue.expand.test.tsx` (default collapsed, recursive expand all / collapse all on a depth-4 value, previews), `run-detail/lib/passSelection.test.ts`
  (default 3, replace oldest, never empty), `run-detail/lib/metricMatrix.test.ts` (row order, 8-row limit, mean, "differs" summary), `ui/FieldRow/fieldRow.anchor.test.tsx`
  (label left for RTL text).
- Playwright `e2e/run-detail/redesign3-item-details.spec.ts`: P5-1 to P5-15; update `redesign2-items.spec.ts` (collapsed default, no rails, no `data-hue`).

## 6. P6: the run header

> "run details headline have lost and removed too many details fix it."

### 6.1 Problem and inventory

Round 2 fix F4 collapsed the header from about 420 px to a **97 px strip** (measured at 1440; 302 px at 390). It now shows only: name, status,
Export HTML, pager, the chevron, Task / Dataset / Model tags and Started and Runtime. Owner, Project, Version, Stop reason, the **execution
context** (every config and run-metadata key) and the **versioning details** (an entire block) are behind the chevron, collapsed by default and
remembered. Expanded it is 379 px at 1440 (822 px at 390): too tall to leave open, so nobody sees them. Data inventory:

| Field | Legacy header | React before F4 (`21f39dfb^`) | React now (collapsed) |
|---|---|---|---|
| Run name / id | yes (title) | yes + eyebrow "Run detail" | yes |
| Status badge, live indicator | yes | yes | yes |
| Export HTML, pager (n of N) | yes | yes | yes |
| Passes (x10 PASSES / pass n/N) | yes (tag) | yes | yes |
| Task, Dataset (+version, aliases), Model (+reasoning badge) | yes | yes | yes (tags) |
| Owner, Project | yes | yes | **hidden** |
| Started, Runtime | yes | yes | yes |
| Version (git branch and commit) | no | yes | **hidden** |
| Stop reason | no | yes (not in a pass view) | **hidden** |
| Execution context: config keys ("Temperature . CONFIG") and run metadata keys ("Run name . METADATA") | yes (grid row under the facts) | yes (3-col grid) | **hidden** |
| Versioning details (keys of the creator or experiment) | yes (a separate card at the top of Overview) | yes (merged into the hero) | **hidden** |
| Ingest warning, private test set banners | n/a | yes | yes |

Legacy at 1440 was about 160 px tall (title row, 7 labelled facts in one row, a one-row config strip) plus a 195 px "Versioning details" card; at 390 about 570 px. The pre-F4 React
header at 1440 was about 420 px because the facts, the context grid (3 columns of tiles with labels) and a versioning table all printed at full size.

### 6.2 Design (`mock-r3-run-header-1440.png`, `mock-r3-run-header-390.png`; the 1440 mock is 180 px, the 390 mock 479 px)

**Principle.** Everything a reader wants to know about *what was run* is visible without a click, in three compact bands, with chips instead of tiles
and a hard clamp so the header can never grow past its ceiling. A disclosure remains only for data that is genuinely secondary: chips beyond the clamp, the run id when the title is a name, and the stop reason detail.

```
wide / mid (column >= 900), 1193 px:                                                          target 180 px, ceiling 200 px
+3px status rail--------------------------------------------------------------------------------------------+
| 426fd13d-390a-4f31-9edc-ac2b0c79c9d1 [x10 passes]  [copy id]        (COMPLETED) [Export HTML] [< 5 of 5 >] |  band 1: 32 px
| TASK        DATASET          MODEL        OWNER       PROJECT     STARTED                   RUNTIME        |  band 2: facts, 7 columns
| [rag_answer][qa-arabic-v3 v4][gpt-5-mini] Dev User    R3 seed     Oct 1, 2026, 3:00 PM      6m 3s          |          label 11 + value 24
|----------------------------------------------------------------------------------------------------------   |  hairline --border-subtle
| VERSIONING [model_tag 2026-09] [prompt v7] [retriever_index qa-v3] [git main . a1b2c3d] CONFIG [temperature 0.2] [max_tokens 512] METADATA [run_name ...] |  band 3: chips, <= 2 lines
| [judge gpt-5] [seed 1234] [sampler { 3 keys }] [region eu-west-1] ...                              [+ 6 more v] |
+------------------------------------------------------------------------------------------------------------+
```

1. **Band 1 (identity and actions), 32 px.** `h1` (`--font-xl` 650, mono when the title is a bare id, sans for a run name; wraps with `overflow-wrap: anywhere`) then the passes
   tag (`Tag kind="count"` "x10 passes"; or the `Pass n/N` link in a pass view) then `CopyButton` "Copy run id" (always visible, 24 px; the id itself is also in the "+ N more" panel
   when the title is a name); at the end (`margin-inline-start: auto`): `RunStatusBadge`, the live indicator ("Live · updated 3s ago"; and "Runtime 6m 3s" while live), the accent `Export HTML` `LinkButton` (24 px) and the pager. The old
   chevron is **removed** (nothing left to hide behind it). Stop reason (when the run was stopped or failed with a reason, and not in a pass view) is shown as one muted `--font-sm` line directly under band 1 ("Stopped: {reason}"), full width, danger text tone for failed runs.
2. **Band 2 (facts), 7 labelled fields in one row.** `<dl>` grid `repeat(7, minmax(0, 1fr))`, gap `--space-sm --space-md`. Order: Task, Dataset, Model, Owner, Project, Started, Runtime
   (the legacy order). Label: `--font-sm` 600 uppercase `letter-spacing: 0.05em` muted; value: `--font-base` primary, single line, ellipsis with `title`. Task, Dataset and Model values are the existing entity
   tags (`TaskTag`, `DatasetTag` with version and aliases, `ModelTag` with the reasoning badge) and keep their links; Owner and Project are links as today; Started `formatIsoDateTime`; Runtime mono
   (`data-testid="hero-runtime"`). Values never wrap to a second line at wide and mid. Fields with no value are omitted and the grid re-flows (no empty cells).
3. **Band 3 (versioning, configuration and metadata), chips.** A hairline above (1 px `--border-subtle`), `--space-sm` padding above and below. One wrapping flow of three **labelled groups in this
   priority order**: `VERSIONING` (the run's `versioning_details` keys sorted by key, then the `git` chip "branch . commit" when present), `CONFIG` (`config` entries), `METADATA` (run metadata entries). Each
   group is a small caps label (`--font-sm` 600 uppercase muted) followed by its chips, and **the label stays on the same line as the group's first chip** (they wrap together). A chip is a **`KeyValueTag`**
   (new passive primitive in the Tag family): height `--control-height` (24 px), padding `0 --space-sm`, radius `--control-radius`, fill `--bg-elevated`, key `--font-sm` muted (max 20 characters) then value in
   mono `--font-base` `--text-primary` (max 30 characters; both ellipsised, the full `key: value` in `title`). Object and array values show a one-token summary (`{ 3 keys }`, `[ 4 items ]`) with the compact JSON in `title`; the
   expanded view (below) shows it through the existing `JsonPreview`. Gap between chips 8 px horizontally and 6 px vertically. No chip is clickable (passive: no hover).
4. **Clamp and "+ N more".** The chip flow is clamped to **2 lines** (`max-height: calc(2 * var(--control-height) + 6px)` = 54 px, `overflow: hidden`) at wide, mid and narrow, and **3 lines** (84 px) at compact. If chips are hidden by the clamp
   a ghost `Button` "+ N more" (N = the exact number of hidden chips, measured with a layout effect and `ResizeObserver`) sits at the end of the flow's last line (compact: under the flow, left aligned) with `aria-expanded` and `aria-controls`.
   Opening it (`Collapse`, 180 ms, none under reduced motion) removes the clamp, adds the "Run ID" and "Stop reason" definitions on one more row, shows every chip and any JSON value through `JsonPreview`, and the button reads "Show less". Open state is remembered per viewer
   (`localStorage qym:run-hero-more`, replacing `qym:run-hero-expanded` in `RunBody.tsx`). **At least the first 6 chips are always visible** whatever their length (a long chip truncates instead of dropping off the clamp).
5. **Responsive.**
   - mid (900 to 1099): same as wide (7 facts in one row of columns each at least 120 px).
   - narrow (560 to 899; 1024 viewport = 777 px): band 1 as wide; facts `repeat(4, 1fr)` (4 + 3 over two rows), chip clamp 2 lines. Target 230 px, ceiling 260.
   - compact (up to 559; 768 viewport = 521 px and 390 viewport = 279 px): band 1 wraps: line 1 the name (2 lines at most), line 2 the passes tag and the copy button, line 3 status badge, Export and pager (wrapping to a second row at 279 px);
     facts `repeat(2, 1fr)` (4 rows; the 7th, Runtime, is alone in its row); chip flow clamped to 3 lines with "+ N more" under it. Target 480 px (mock 479 at a 320 px column), ceiling 520 (279 px column).
6. **Tones.** The 3 px inline-start rail carries the status tone (`Card tone`, unchanged); the card is otherwise one fill (`--bg-surface`) plus the chip fill `--bg-elevated` (the one allowed extra level). No wash.
7. **Live and banners.** Live run: the live indicator and a live "Runtime" in band 1; facts' Runtime shows the same ticking value. The ingest warning and private-test-set banners sit **under band 1** (above the facts) as today; the ceilings below exclude banners.
8. **States.** Loading: skeleton for the three bands at their heights (32 / 40 / 54 px). Missing owner or project: the field is omitted. A run with no config, metadata or versioning: band 3 is omitted entirely (height drops by about 65 px). Hover: the entity links use the `Tag` link hover (colour only); `KeyValueTag` passive.
   Focus: 2 px accent outline on links, buttons, pager.
9. **Keyboard and screen reader.** Reading order is band 1, 2, 3. The facts are a `dl` named "Run facts"; band 3 is a `role="group"` named "Versioning, config and metadata" containing three `role="list"` groups named by their label, each chip a `listitem` whose text reads "key value" ("temperature 0.2"). The h1 stays the page's single
   H1 (already the case); the CopyButton announces "Copied". "+ N more" is a disclosure button.

### 6.3 Fields visible without any interaction (P6-1 list; test reads each)

At 1440 and 390, in a completed run with the seeded metadata: run name or id; status badge; passes tag (when passes > 1); Export HTML; pager; Task; Dataset (with version and aliases); Model; Owner; Project;
Started; Runtime; Copy run id; every `versioning_details` key and value (the seed has `model_tag`, `prompt`, `retriever_index`); the git version chip; every config entry (`temperature`, `max_tokens`); the first run-metadata entries (`run_name`
and the rest up to the clamp); for a stopped or failed run the stop reason line; for a live run the live indicator. Hidden by design (behind "+ N more"): chips beyond the clamp, Run ID row when the title is a name.

### 6.4 Acceptance criteria (P6)

| # | Criterion | Measure |
|---|---|---|
| P6-1 | Every field in the list of 6.3 is visible (`toBeVisible()`) right after load, with no click, at 1440 and 390, for the classic run. | Playwright |
| P6-2 | There is no chevron or "Show run details" control; the only disclosure in the header is "+ N more" and appears only when chips are hidden. | assertion |
| P6-3 | Height ceilings of `[data-testid=run-hero]` (banners excluded): at 1440 (column 1193) **at most 200 px** (target 180); at 1280 at most 200; at 1024 (777) at most 260; at 768 (521) at most 520; at 390 (279) at most 520. With 20 chips the ceiling still holds (clamp). | boxes |
| P6-4 | The Overview section heading's top is at most 380 px from the viewport top at 1440 x 900 (was 247 px with 97 px header; it is about 330 now). | box |
| P6-5 | Band 2 shows 7 labelled facts in one row at 1440 and 1280 (all `dd` tops within 2 px of each other) and in 2 columns at 390. | boxes |
| P6-6 | Band 3 order is Versioning, Config, Metadata; a group label never ends a line (label and its first chip share a line). | boxes |
| P6-7 | Chips are 24 px high; key text max 20 and value max 30 characters; the full value is in `title`; object values show `{ n keys }`. | assertions |
| P6-8 | The clamp: with 20 chips band 3 is at most 54 px high (wide, mid, narrow) and 84 px (compact), "+ N more" reads the exact hidden count, and at least 6 chips are visible. | count `chips.offsetTop` |
| P6-9 | "+ N more" opens the rest: all chips visible, Run ID row visible, `aria-expanded=true`, state remembered after reload (`qym:run-hero-more`). | e2e |
| P6-10 | A run with no config, metadata or versioning has no band 3 and is at most 125 px at 1440. | box |
| P6-11 | The stop reason appears as one muted line under band 1 for a stopped run, not in a pass view. | e2e (existing stop-reason fixture) |
| P6-12 | No horizontal overflow of the header at any viewport; long names and values truncate with a tooltip. | scrollWidth |
| P6-13 | Axe: zero serious or critical on the header at both widths; the h1 count on the page stays 1. | `a11y.spec.ts` |

### 6.5 Tests (P6)

- Vitest: `lib/heroModel.test.ts` extended (`headerChips(run)` order, caps, JSON summaries, `{ n keys }`, key/value truncation helpers, the 6-chip floor), `components/RunHero.test.tsx` (no chevron; band 3 omitted when empty).
- Playwright `e2e/run-detail/redesign3-header.spec.ts`: P6-1 to P6-12; update `overview.spec.ts` (the "height at most 200" and "first section on the first screen at 390" assertions: ceilings above; the existing test for hidden-by-default details is removed).

## 7. Primitives and tokens

| Item | Kind | Change |
|---|---|---|
| `Card` | extend | prop `fill`: flex column, body `flex: 1; display: flex; flex-direction: column; min-height: 0`; the mock emulates it with `.fillCard`. Documented in DESIGN_LANGUAGE "Card". |
| `ChartCard` | new (run-detail) | `Card fill` with header slot (title, meta/legend/controls), plot slot `min-height: 146px`; used by every chart. |
| Bar plot (`Histogram`, `PassCountBars`, boolean split) | rewrite | one column recipe (spacer, count, bar, axis, sub); replaces `.hist`, `.passBars`, `.split`. |
| `StatTiles` | new (`ui/StatTiles`) | seven or fewer equal separated centred tiles with the 12-column fallback; each tile `Card compact rail="bottom"`; documented as "Stat tiles" next to "Connected statistics (StatStrip)", which stays for summary bands. |
| `StatStripItem.group` | unchanged | no longer used on run detail (the Runs-list Passes panel may keep it). |
| `Select` | reuse | repeat metric selector (width 280). |
| `StructuredValue` | extend | `defaultExpanded` (false for output), per-key `preview`, recursive `Expand all` / `Collapse all` per key and global, depth guides, `Show N more` for long arrays. |
| `FieldRow` | extend | `labelAnchor="start"` keeps the label at the left for RTL text; `dir` applies to the value only. |
| `KeyValueTag` | new (Tag family) | passive 24 px key/value chip. |
| `MetricMatrix`, `PassRail`, `ItemBar` | new (run-detail) | the metrics grid, the pass chip row, the sticky item bar. |
| `useStickyShift` | extend | `suspend` ranges (section 4). |
| Tokens | none new for colour | New sizes are not needed: 146 px, 44 px, 32 px, 280 px are component-local measures (`--row-compact` 32, `--control-height` 24, `--table-header-height` 34 are reused). **Optional**: `--plot-min-height: 146px` in `tokens.css` if the reviewer wants the plot height pinned by the design test. |

Tokens used (checked against `tokens.css`): `--bg-surface/elevated/hover/selected/base`, `--border-subtle/default/strong`, `--text-primary/secondary/muted` (never `--text-dim` for content),
`--score-1..5` through `data-band`, `--success/--error/--metric-error/--error-text`, `--chart-1/5` (curve series only), `--font-sm/base/md/xl/stat`, `--space-xs/sm/md/lg/xl`, `--control-height/radius`,
`--row-compact/regular`, `--table-header-height`, `--field-label-width`, `--field-measure`, `--radius-md`, `--hover-brightness`, `--dim-opacity`, `--motion-*`. No new hex or rgba.

## 8. Departures from earlier decisions

| Earlier decision | Now | Why |
|---|---|---|
| redesign2 5.2: one visual per row, visuals capped at 1100 px and left aligned | Across attempts and Passes passed side by side at 1100 px and wider; no cap | The user says the elements below metrics do not use the full page width; legacy was 2-up; a 4-point curve at 1193 px was the only reason for the cap, and it now draws at the measured width with labelled points. |
| redesign2: stats in three labelled groups, StatStrip | seven separate centred tiles, no groups | Explicit user request. |
| redesign2 5.4: multi-key categories with "+" chips, "Rank by" select | one key at a time, two order options | "overwhelming"; the added controls were the cause. |
| redesign2: sticky table header across the table | header suspended around expanded items; ItemBar | P4. |
| redesign2 5.3: pass columns with `--chart-1..3` rails (final-fix F-series) | no pass colour; verdict chips with number and glyph | P5; justification in 5.3. |
| redesign2 5.6: metric chips per pass | metrics matrix + one detail panel | 10 passes x 24 metrics. |
| Final fix F4: collapsed 97 px strip, chevron | three bands visible, clamp, "+ N more" | P6. |
| redesign2 StatStrip for the overview split bar | boolean metrics use the bar plot | P1 uniformity. |

## 9. Decisions I made (open questions)

1. **Pass colour**: none (numbers and verdict glyphs), not an extended palette or ramp. Justified in 5.3. The Runs-list Passes panel (`features/runs-list/passes`) still cycles three series colours; changing it is a follow-up, not part of this stage.
2. **Categories "Compare" view**: not restored (React has no compare view). Revisit only on request.
3. **Pass columns limit**: three side by side at most (a 4th replaces the oldest). More columns than three make an Arabic paragraph under 280 px wide; 10-pass comparison lives in the matrix.
4. **Metric matrix for single-pass items** as well, so there is one metrics recipe; a single-pass item with 24 metrics shows 8 rows and "Show 16 more metrics".
5. **Default selected passes** are 1 to 3, not "the most different"; smarter defaults are possible later without a design change.
6. **Header chevron removed**, replaced by "+ N more"; the clamp is 2 lines (3 on compact), chosen so 14 chips fit at 1440 and the height stays at 180 px.
7. **`--plot-min-height` token**: left optional (component-local 146 px) to avoid touching `tokens.css` in the design stage.
8. **Mock width**: the gallery case body is 1163 px at 1440 (the real column is 1193); the mocks are within 3% of final widths. Heights quoted in the criteria are for the real column.
9. **Seed**: the wide-repeat seed lives next to this document; the implementer copies it into `e2e/run-detail/seed.ts` as `seedWideRepeatRun` (10 passes x 24 items x 24 metrics, about 6,500 events).

## 10. Hand-off for the implementer

Order (each step compiles and keeps `npm run check` green): (1) `Card fill`, `ChartCard`, bar plot, curve labels (P1); (2) `StatTiles`, repeat panel, `Select` metric, By-pass table with column picker (P2); (3) categories (P3); (4) `useStickyShift suspend`,
`ItemBar` (P4); (5) `StructuredValue` collapsed and recursive, `FieldRow` anchor, `PassRail`, `MetricMatrix`, regions and divider (P5); (6) header bands, `KeyValueTag` (P6). Docs to update with the code: `docs/DESIGN_LANGUAGE.md` (Card `fill`, stat tiles, chart card, bar recipe, item regions, header bands, pass colour rule), the redesign2 notes that this supersedes (a pointer, not a rewrite).
Files that will change: `frontend/src/features/run-detail/components/charts/*`, `panels/RepeatTab.tsx`, `panels/CategoriesTab.tsx`, `items/ItemCard.tsx`, `items/PassColumns.tsx`, `items/MetricStrip.tsx`, `items/ItemsTable.tsx`, `RunHero.tsx` (+ CSS modules), `ui/Card`, `ui/StructuredValue`, `ui/FieldRow`, `ui/DataTable/useStickyShift.ts`, `ui/Tag`, new `ui/StatTiles`.
Mock-to-product map: `RunHeaderMock` to `RunHero`; `ChartCardsMock` to overview cards; `RepeatPanelMock` to `RepeatTab`; `CategoriesMock` to `CategoriesTab`; `ItemDetailsMock` to `ItemCard`; delete the mocks (or keep as gallery cases) once the real components exist.
