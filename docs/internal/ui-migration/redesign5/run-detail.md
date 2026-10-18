# Redesign round 5: run detail (design specification)

Status: design stage. No product component was changed. The code added is the dev gallery mock
`frontend/src/features/dev/Round5Mocks.tsx` (+ `Round5Mocks.module.css`, wired into `/__ui#round5`), the seed
`seed-r5.mts` and this document. The mocks are the visual contract: where this text and a mock disagree, the number in
this text wins and the mock is a bug to report.

Branch `ui/redesign5-run-detail` (from `UI-redesign` 40cfd971). Investigated 2026-10-17 at 1440 and 390 px (report
column 1193 and 279 px, see round 3 section 0), legacy (`7814183`) on 8991, React on 8992 / Vite 5992.

## 0. Reading guide

The owner's words (verbatim; the numbering is theirs, R1 to R3 here map to their 1 and 5):

> - run details:
>  1- enhance the graphs when there's a bar of multiple values (10) some of the columns drops below the x axis, also for
>     box plots add colors to it and remove the numbers below them.
>  5- in item details the design for metrics is so ugly and non user friendly refer the old design for better UX also make
>     sure to double check how metrics is viewed once a score is clicked refer to the old design on how it have a support
>     for presenting tables clearly and also make sure that text doesn't overlap with it's label this happens in reasoning
>     key where text start in the middle of the label.
>
>  invest heavily in UI design and strict adherence to it in implementation.

| Section | Owner point | What |
|---|---|---|
| R1 | 1, first half | bars dropping below the x axis |
| R2 | 1, second half | colour on box plots, no number row |
| R3 | 5 | the item metric matrix, the panel a clicked score opens, tables, label / text overlap |

Screenshots (`docs/internal/ui-migration/redesign5/shots/`, each under 300 KB):

| File | What |
|---|---|
| `legacy-overview-bars-1440.png` | legacy overview cards (3-up, every bar on the baseline, 11 labels) |
| `legacy-metric-table-1440.png`, `legacy-metric-reasoning-1440.png` | legacy `.metric-det-*` body: a `{columns, rows}` value as a sortable table; a reasoning row (label above text) |
| `current-bars-overview-1440.png`, `current-bars-overview-390.png` | the defect: bars below the axis in 11-bucket histograms |
| `current-passes-passed-1440.png`, `current-passes-passed-390.png` | 20 columns (19 passes): label and count collisions |
| `current-box-tokens-*`, `current-box-latency-*`, `current-box-perpass-*` | the grey box plots with the number row, at 1440 and 390 |
| `current-metric-matrix-1440.png` | the item metrics matrix, a clicked score and the panel start |
| `current-metric-panel-1440.png`, `current-metric-panel-390.png` | the panel (865 px and 1,391 px high) with the label overlap |
| `mock-r5-bars-10-*`, `mock-r5-bars-20-*` | R1 design at 1440 and 390 |
| `mock-r5-box-coloured-*` | R2 design |
| `mock-r5-metric-panel-en-*`, `-ar-*`, `-table-*` | R3 design |

Seed: `seed-r5.mts` (`node seed-r5.mts <platform url> [small]`, env `SLUG`): run `details` (86 items, one pass, `quality`
with all 11 score buckets filled, `rubric_judge` with long reasoning, long snake_case keys, a `{columns, rows}` table, a
list of objects, nested objects; `arabic_judge` with Arabic reason / reasoning / explanation / checks; 12 latency bins),
run `passes19` (19 passes x 6 items, 20 columns in "Passes passed"), plus the classic and wide-repeat runs of the e2e seed.
Widths: the report column is 1193 px at 1440 and 279 px at 390; mocks render inside `.frame` of exactly those widths.

## R1. Bars below the x axis

### R1.1 Problem (measured; `current-bars-overview-1440.png`)

Run `details`, the four 11-bucket cards at 1440 (card 288 px, column 18.5 px) and at 390 (card 279 px, column 17.7 px):

| Plot | Columns | Column width | Distinct bar bottoms | Spread | Axis top of labelled columns / of thinned columns |
|---|---|---|---|---|---|
| quality, 1440 | 11 | 18.5 px | 2 (546.9 and 560.9) | **14 px** | 550.9 / 564.9 |
| arabic_judge, 1440 | 11 | 18.5 px | 2 (920 and 934) | **14 px** | 924 / 938 |
| quality, 390 | 11 | 17.7 px | 2 (887.4 and 901.4) | **14 px** | 891.4 / 905.4 |
| correct (2 columns), 1440 and 390 | 2 | 120 px | 1 | 0 | no thinning, no defect |

Five of the eleven columns (the odd indexes, 10%, 30% ... 90%) end 14 px below the other six: their bars hang under the line
the labelled columns stand on, beside labels that read "20% 40%". The bug appears exactly when the thinning rule hides labels, so
it affects every 11-bucket histogram in a card narrower than 11 x 30 + 40 = 370 px: all of them at 4-up, 3-up and compact.

**Root cause.** `BarColumns` hides a thinned axis label by writing an empty `data-text`; the label is drawn by
`.axis::before { content: attr(data-text) }`. A block whose only child is an empty inline pseudo-element has no line box, so the
`.axis` span collapses from 14 px to 0 height while its 4 px `margin-top` stays. Column height is fixed by the plot, so a column
without a label gives that 14 px to the flexible part (spacer + bar): its bar bottom moves 14 px down, past the axis line of
its neighbours. The same mechanism moves bars when only some columns carry an `axisNote` or `sub` line. `thin={false}`
("Passes passed") skips the thinning and then prints 2-digit labels and counts in 8 to 14 px columns on top of each other
(measured: 20 columns, 13.8 px at 1440 beside the curve, 8.0 px at 390; labels "10" to "19" are 14 px wide).

Other measured facts that stay: counts sit 2 px above the bar top (`.count`, margin 2 px), the card has 15 px under the plot,
the plot slot is at least 146 px. The legacy overview (`legacy-overview-bars-1440.png`) never had the defect: cards were 3-up
(about 66 px per column), every label shown, every bar on one baseline.

### R1.2 Design (`mock-r5-bars-10-*.png`, `mock-r5-bars-20-*.png`)

**Column recipe v2: well and foot.** A column is a two-row grid: `grid-template-rows: minmax(0, 1fr) var(--foot)`.

```
 +- col (grid) ------------+
 | well  flex column        |   spacer (flex 1 - p) / count (16 px line, 2 px margin) / bar (flex p), p = count / max
 | border-bottom: 1px ...   |   the well's bottom border IS the x axis (--border-default, neighbours' borders touch)
 +--------------------------+
 | foot  height var(--foot) |   axis label (14 px line) and optional sub label (14 px), 4 px padding above
 +--------------------------+
```

- `--foot` is set once per plot: `4px + 14px x rows`, rows = 1, or 2 when any column has a sub label (percentage, note). It is the
  same for every column, so a thinned label is a blank line, never a missing one: **no column can end higher or lower than its
  neighbour**. Labels are drawn into the reserved row (an empty label renders a non-breaking space, not nothing).
- The x axis is drawn: each well has `border-block-end: 1px solid var(--border-default)`; wells use `margin-inline: -2px;
  padding-inline: 2px` so the 4 px gaps are bridged and the line is continuous. Every bar bottom edge equals the top of that line.
- Bars stay at most 44 px wide, `min-height: 3px` when count > 0 and 0 when count is 0 (zero rule unchanged: score
  histograms print nothing for an empty bucket, pass/fail and passes-passed print `0` in `--text-muted`).
- **Axis label thinning** (generalised, applies to every plot including `thin={false}` ones): `pitch = column width + 4`,
  `labelWidth = longest label characters x 7 + 6`, show the label of every `k`-th column, `k = ceil(labelWidth / pitch)`
  (11 labels of 4 characters in 22 px pitch: k = 2; 20 labels of 2 characters in 12 px pitch: k = 2). The full list stays in the
  `aria-label` and in tooltips. Column 0 is always labelled.
- **Dense counts.** When `pitch < countDigits x 7 + 2` (two-digit counts in a column under 16 px) the plot is `data-dense`:
  it reserves 18 px above the wells and every second column's count is raised by 18 px with `position: relative;
  inset-block-start: -18px` (no layout change, so bar heights do not change). Each count is still above its own bar and no two
  counts overlap (neighbours sit on different tiers, same-tier counts are two pitches apart: 24 px at 12 px pitch).
- **Plot slot never clips.** The plot slot stays `min-height: 146px` and grows with a stretched grid row; the well is
  `overflow: visible`; the bar is the only `overflow: hidden` element (error hatch). The tallest bar's count top is at or below
  the plot top, and (dense) 18 px of padding make room for the raised tier.
- Colour is unchanged (band by `bucketTone`, series, `--metric-error`); bars without a band or series (passes-passed counts in the middle, latency bulk) use a neutral mark fill
  (the mock uses `var(--tone, var(--text-dim))` for the bar background; a mark, not readable text).
- Entrance (M2), hover, selected, focus, empty and loading states are unchanged from round 3 P1; the foot is not animated.

Per width: at 1440 the 4-up cards keep 18 to 22 px columns (labels every second, 6 shown); at 390 the same; 20 columns at 1440
in a 589 px card are 13 px columns, not dense (pitch 17 >= 16), labels every second; at 390 they are 8 px columns, dense,
counts on two tiers, labels every second.

### R1.3 Acceptance criteria

| # | Element and width | Criterion | Measure |
|---|---|---|---|
| R1-1 | `[role=group][aria-label$="score distribution"]` of each metric card in run `details` (11 columns), 1440 and 390 | every bar's bottom edge minus the top of its well's axis line (well bottom minus 1 px) is **0 px** (+-0.5); the spread of bar bottoms inside one plot is 0 (current: 14) | `getBoundingClientRect` of `[data-part=bar]` and `[data-part=well]` |
| R1-2 | `[role=group][aria-label^="Items by number of passes"]` in run `passes19` (20 columns), 1440 and 390 | same as R1-1: 0 px difference | as above |
| R1-3 | a gallery case `r5-bars-sweep` (to add, bucket counts 1 to 20, counts 0 to 120) at 1440 and 390 | for every N in 1..20 every bar bottom equals the axis line (0 px) and all `foot` heights are equal (18 px, or 32 px with a sub line) | Playwright loop over N |
| R1-4 | every bar plot on the page (overview cards, response-time histogram, passes passed), 1440 and 390 | all columns of one plot have the same foot height; a column whose label is thinned has the same height as a labelled one | box heights |
| R1-5 | `[data-part=count]` and its `[data-part=bar]`, bars with count > 0 | bar top minus count bottom is 2 px (<= 4) in a normal plot and 20 px (<= 20) for raised-tier counts in a `data-dense` plot; the count is never below its bar | boxes |
| R1-6 | the tallest bar's count in any plot | count top >= plot top (nothing clipped) and `card.scrollHeight <= card.clientHeight`; the plot slot is >= 146 px | boxes |
| R1-7 | axis labels shown (`[data-part=axis]` with text), 11 and 20 columns, 1440 and 390 | the gap between any two shown labels' text boxes is >= 4 px (current at 390 with 20 columns: -2 px); label k follows `ceil(labelWidth / pitch)`; column 0 is labelled | pairwise boxes of text ranges |
| R1-8 | counts, 20 columns at 390 (dense; **amended**: asserted on the gallery sweep, whose counts reach 120; the `passes19` fixture has 6 items per pass, one-digit counts, pitch 12 >= 9, so it is correctly not dense) | no two count boxes intersect; counts alternate tier 1 / tier 2 by column index parity; every count is within 20 px above its own bar | pairwise boxes |
| R1-9 | the plot's x axis | exists as a 1 px `--border-default` line under every well, continuous across the 4 px gaps (the union of well borders spans plot left to plot right within 1 px) | computed border and boxes |
| R1-10 | bar widths and zero rule | bars <= 44 px wide; count 0 draws no bar (height 0) and prints `0` only for pass/fail and passes-passed | boxes and text |
| R1-11 | chart cards | `card.bottom - lowest plot element bottom <= 16` (round 3 P1-3 stays) | boxes |
| R1-12 | `prefers-reduced-motion` | no bar or count animates (`animation-name: none`) | emulate |
| R1-13 | chart CSS | no hex, `rgb(`, `rgba(`; design-language test green | existing test |

### R1.4 Tests to write

- Vitest `charts/chartLabels.test.ts`: `labelEvery(pitch, labelWidth)`, `isDenseCounts(pitch, digits)` (11 columns at 22 px: every 2, not dense; 20 columns at 12 px: every 2, dense).
- Playwright `e2e/run-detail/redesign5-bars.spec.ts`: R1-1 to R1-11 on `seedR5` run `details` and `passes19` at 1440 and 390; the gallery case for R1-3 (`/__ui#round5`, add `r5-bars-sweep`).
- Update `redesign3-charts.spec.ts` P1-8 (label overlap now also for `thin={false}`).

### R1.5 Implementation notes

`charts/Charts.tsx` (`BarColumns`: the column becomes `well` + `foot`, label span always rendered, `thin` removed in favour of the pitch rule, `data-dense`), `charts/Charts.module.css` (`.col` grid, `.well`, `.foot`, `.count[tier]`), `charts/chartLabels.ts` (`labelEvery`, `isDenseCounts`; keep `abbreviateCount`), `OverviewTab`, `RepeatTab` (`PassCountBars` loses `thin={false}`), `LatencyTab` (`axis={false}`: the latency plot owns its tick row, the foot is then a 4 px spacer so its bars still stand on the baseline). Docs: DESIGN_LANGUAGE "Chart card and bar recipe" (replace "`[spacer][count][bar][axis][sub]`" with the well / foot recipe and the axis line).

## R2. Box plots with colour and no number row

### R2.1 Problem and the owner decision (`current-box-tokens-*.png`, `current-box-latency-*.png`, `current-box-perpass-*.png`)

Measured: the tokens_used card is **359 px** high at 1440 and at 390 (plot 84 px, the six-cell number row 84 px, Total row, a five-item legend, intro and header); the glyph is grey (`--text-secondary` stroke, `--text-primary` median and mean), so the plot reads as neutral wireframe while histograms beside it are coloured. The per-pass rows (19 passes: 734 px at 1440, 770 px at 390; rows 32 px) are all grey.

**Owner decision, recorded (reverses round 3 P7-5 and P7-6 and the DESIGN_LANGUAGE "grey only / six-cell number row" lines):**
the owner asked for colour on box plots and no numbers under them. From this round the box plot is coloured and has no number row. The six numbers
are not lost: median above the line, minimum and maximum at the axis ends (visible at rest), all six in the hover and focus
tooltip, all six in the `aria-label` sentence. (Interpretation: "the numbers below them" is the number row, the largest block
under the plot. The axis end labels stay because without them the plot has no scale; if the owner meant those too, deleting them is a one-line change, `endLabel`.)

### R2.2 Legacy reference

Legacy Step timings and the latency cards drew a p5 to p95 whisker with a coloured middle box and printed the numbers beside it; there was no number row under a plot (the legacy overview card printed Min / Avg / Max / Total as its own tile row, which round 3 replaced). Keep: coloured box, median tick, mean diamond, whiskers. Different: one tone per plot from the same `data-band` / `data-series` maps every other mark uses.

### R2.3 Design (`mock-r5-box-coloured-*.png`)

**Tone rule (one colour, one meaning).**

| Plot | Tone | Why |
|---|---|---|
| a score metric with a direction (the quality box, repeat per-pass rows of a score metric) | `data-band` = band of the **median** (`--score-1..5`) | colour is a state; the same band the metric's ScoreValue uses; per-pass rows each take the band of their own median, so a failing pass is red without identifying passes by hue (round 3 "a pass has no colour" stays: the colour is the verdict) |
| latency (response time strip and card), tokens, cost, an undirected numeric, step timing rows | `data-series="1"` (`--chart-1`, sky) | a single-series plot; series 1 is the baseline run colour on this page, never good or bad; the slow tail dots above p95 keep `--score-2` as in the histogram |
| anything else with no direction | `data-series="1"` | same |

Hue budget: at most two hues per card (tone and, for latency, the `--score-2` tail). No identity colour is introduced; steps and passes are text-labelled.

**Glyph** (same shapes as round 3; only the colours change): box p25 to p75 (24 px, radius 3, stroke 1.5 px `--tone`, fill `--tone` at `--tint-strong` over `--bg-surface` through `color-mix`), median 2.5 px `--tone`, whiskers p5 to p95 with 14 px caps 1.5 px `--tone`, mean a hollow diamond (10 px, 1.5 px `--tone` stroke, `--bg-surface` fill), dots 2.5 px `--tone` at 75% (min and max 3 px; latency tail dots `--score-2`). `--tone` and `--tone-text` come from `tones.css`; no new token.

**Contrast** (computed against `--bg-surface` #1a1a28 and the 20% box fill): stroke on surface red 4.57, orange 6.13, yellow 11.22, light green 9.86, green 6.77, sky 8.02; stroke on the box fill red 3.67 (the minimum), orange 4.53, yellow 6.92, light green 6.37, green 4.86, sky 5.42. Every pair is at least 3:1. Colour is never the only cue: the median value is printed, the band is in the `aria-label` ("band 3 of 5") and in the card's rail and ScoreValue.

**Numbers (what moved where).**

- No `dl` number row, no Total row, no five-entry legend under the plot.
- Median value: printed above the median line (mono `--font-sm`, `--text-primary`, as before).
- Minimum and maximum: printed under the baseline at the ends of the data (mono `--font-sm` `--text-muted`, anchored at the min and max dots; when the two labels would collide, one merged label "min to max" is centred). The baseline is a 1 px `--border-default` line with a 6 px tick at each end of the domain; the domain is `[min, max]` for numeric quantities (so the dots are at the ends), `[0, 100%]` for scores. Gridlines and the middle tick labels are removed.
- All six values (and IQR) in the tooltip on the box (`Mark tip`): "Middle 50%: 52% to 84% (IQR 32%)" and a three-column grid Min, P25, Median, Mean, P75, Max; hover or keyboard focus; pinned by a tap on touch. The other marks keep their tooltips.
- The `aria-label` sentence keeps all six plus total: `boxSentence` unchanged, plus ", band n of 5" for a band tone.
- The legend moves into a `HelpMarker` in the card header ("How to read the box plot", the existing sentence plus "Hover or focus the box for all six numbers"). Cards that stack rows (per pass, step timings) keep one muted `--font-sm` key line under the rows.
- **Total (decision): move to the card header**, as plain text "Total **64.0K**" (`--font-sm` muted label, mono `--font-base` 600 value) before the count tag, with the existing title "Sum of all values across all items". Keep it because it is the only fact the plot cannot show and the owner's earlier round wanted it; move it because a lone row under a plot with no number row looks like a leftover, and the header already carries counts. Same visibility rule as round 3: additive quantities only (numeric metrics, tokens, cost; never latency, scores, percentages, or when a value is negative).
- Heights: a plot card is plot 80 px + header + intro (measured in the mock: 196 px at 1440 and 390, 214 px for tokens at 390 where the header wraps), against 359 now.
- The response-time strip (40 px) and per-pass / step rows (32 px, track 20 px) take the same tones; the per-pass median value column (52 px mono muted) stays; it is a row value, not a number row.

Per width: 1440 four cards per row at 280 px, rows cards two per row from 900 px; 390 one column, the card 279 px, SVG 235 px wide; min / max labels merge below about 90 px between dots.

### R2.4 Acceptance criteria

| # | Element and width | Criterion | Measure |
|---|---|---|---|
| R2-1 | every box plot card (Overview numeric, Latency, Repeat per-pass, step timings), 1440 and 390 | no `dl[aria-label="Distribution values"]` and no visible text cells "MIN", "P25", "MEDIAN", "MEAN", "P75", "MAX" outside the tooltip | DOM query |
| R2-2 | glyph of a score box (**amended**: a score metric is a histogram on the Overview, so the directed-score box is the per-pass row (`BoxTrack`) of `quality` in `passes19`; the SVG glyph takes the same `data-band` and is covered by Vitest) | box stroke, box fill base, whiskers, caps, median and mean stroke all resolve to the colour of `--score-N` for N = band of the median; the per-pass row of a pass whose median is 45% is band 2 | computed `stroke` / `fill` |
| R2-3 | glyph of latency, tokens and step rows | stroke = `--chart-1`; latency dots above p95 = `--score-2`; nothing else coloured | computed |
| R2-4 | stroke vs `--bg-surface` and vs the 20% fill | contrast >= 3:1 for all five bands and series 1 (measured 3.67 to 11.22) | computed from tokens |
| R2-5 | `svg[role=img]` text | the median label is above the median line (text y < box top) and equals the median value; min and max labels are under the baseline at the min and max dots (or one merged "a to b" label when their boxes would be < 8 px apart); no other text in the SVG | `text` nodes and boxes |
| R2-6 | tooltip of the box (hover and `focus()` on the `data-mark-kind="box"` mark) | contains Min, P25, Median, Mean, P75, Max and IQR values | Playwright |
| R2-7 | `svg[role=img]` `aria-label` | still names the six numbers (and total when additive) and ends with the band for score tones | attribute |
| R2-8 | `tokens_used` card | "Total" appears in the header (`.headRight`), not under the plot; absent for latency, scores, percentages and runs with a negative value | DOM query |
| R2-9 | plot card heights | `tokens_used` <= 220 px at 1440 (measured 212.2) and <= 232 px at 390 (measured 230.4; **amended**: the 390 header wraps and the card carries the 18 px error-note line of the fixture, which the mock lacks) (current 359); every box plot card has at most 16 px under its lowest element (measured 1); box plot cards sit in their own grid rows under the histograms so a short plot is not stretched beside a tall one | boxes |
| R2-10 | per-pass rows card, 1440 and 390 | row height 32 px (+-1); tag 72 px; median column 52 px; rows coloured by the row's own median band; a pass tag carries no colour | boxes and computed |
| R2-11 | response-time card | the strip keeps its x scale equal to the histogram's (round 3 P7-12: strip p25 x equals the histogram's p25 x, +-1 px), takes series 1, the Mean KPI and p50 / p90 / p95 pins stay | boxes |
| R2-12 | card header | a `HelpMarker` named "How to read the box plot" is present; no five-entry legend list (`ul[aria-label="How to read the box plot"]`) remains in a single-glyph card; rows cards keep one key line | DOM query |
| R2-13 | colour cue | no card relies on colour alone: median text present, band named in the `aria-label`, rail / ScoreValue carry the band | DOM query |
| R2-14 | CSS | no hex, `rgb(`, `rgba(`; no colour literal; design-language test green; at most two hues in one card (tone and `--score-2`) | existing test + computed |
| R2-15 | `prefers-reduced-motion` | no animation on box marks | emulate |

Round-3 criteria superseded: P7-1 (the `dl` with six values is removed; the box plot and the tooltip replace it), P7-5 (Total is a header value), P7-6 (median, min and max visible; the other three in the tooltip), P7-17 (colour is now allowed from the tone maps), P7-20 (heights re-measured by R2-9). P7-2 to P7-4, P7-7 to P7-16, P7-18, P7-19 stand.

### R2.5 Tests to write

- Vitest `charts/BoxPlot.test.tsx`: no number row, median / min / max labels, merged label, `aria-label` keeps six values and band; tone by median (`bandOfMedian`) in `lib/boxTone.ts` (new, pure: direction-aware via `metricBand`, fall back to series 1).
- Playwright `e2e/run-detail/redesign5-box.spec.ts`: R2-1 to R2-15 on `classic` (tokens_used, response time), `details` (quality) and `passes19` (per pass); computed colours; tooltip text; heights. Update `redesign3-box-plots.spec.ts` (P7-1, P7-5, P7-6, P7-20 now assert the amended numbers).

### R2.6 Implementation notes

`charts/BoxPlot.tsx` (`BoxPlot` gets `tone` and drops ticks and gridlines; add axis line and end labels; delete `BoxNumbers` and the full `BoxLegend`; `BoxTrack` takes `tone` via `data-band` / `data-series` on its span), `BoxPlot.module.css` (replace grey stroke tokens with `var(--tone, ...)`, add `.axisLine`, `.endLabel`; delete `.nums*`, `.total*`, `.legend*`), `BoxCard.tsx` (no `BoxNumbers` / `BoxLegend`; returns the total to the caller for the header), `OverviewTab.tsx` (Total in the card header), `LatencyTab.tsx`, `PassDistribution.tsx`, `lib/boxTone.ts`, `lib/boxAxis.ts` (domain `[min, max]` for numeric kinds). Docs: DESIGN_LANGUAGE "Box plot" (coloured, no number row, Total in the header) and section 7 "Distributions" ("the six numbers visible" becomes "median, min and max visible, six in the tooltip"). `ui/` gets nothing new.

## R3. Item metric details

### R3.1 Problem (measured; `current-metric-matrix-1440.png`, `current-metric-panel-1440.png`, `current-metric-panel-390.png`)

Item `r5-005` (6 metrics, rubric_judge details open), 1440 and 390:

1. **Text overlaps its label.** `MetaList` renders long text as `FieldRow labelAnchor="start"`: a grid `[7.5rem label][value]`. The label is uppercase, tracked, nowrap by nature (snake_case has no break point) and has no `min-width: 0`, `overflow` or wrap rule. Measured label text extent against the value block at 1440 (panel 1151 px, label column 120 px, value starts at x = 382):

   | Key | Label text width | Overlap into the value |
   |---|---|---|
   | `reasoning` (and `reason`, `explanation`) | 47 to 82 px | none (fits 120) |
   | `detailed_reasoning_trace` | 176 px | **42 px** (text of the value starts inside the label) |
   | `self_consistency_check_result` | 207 px | **73 px** |
   | `step_by_step_reasoning_notes` (Arabic panel) | 202 px | **68 px** |

   At 390 the row stacks (label above value), so the label can only run off the right edge (207 px in a 193 px column). **Root cause:** a fixed-width grid column holding unbreakable uppercase text with `overflow: visible`: the text paints past its column into the next one. The owner saw it on a `reasoning`-named key such as a long `*_reasoning_*` field. (An output key row cannot overlap: its preview is a flex sibling with a 6 px gap; its key is `flex: none`, so a very long key pushes the preview out instead. Guarded in R3-7.)
2. **A list of objects is not a table.** `criteria` (4 objects), `evidence` (3) and a `{columns, rows}` value render as `[0] object, 4 keys` collapsed rows, each needing a click; a table-shaped value is two collapsed rows named COLUMNS and ROWS. The legacy panel renders the `{columns, rows}` shape as a bordered, header-sorted table (`legacy-metric-table-1440.png`).
3. **Three label recipes in one panel.** Uppercase tracked labels for prose (`REASONING`), another for the scalar grid (`JUDGE_MODEL`, 3 columns), and uppercase mono for tree keys (`RETRIEVAL`, `GENERATION`), so the eye cannot tell which is a label.
4. **Height.** The rubric_judge panel is **865 px** at 1440 and **1,391 px** at 390 (it opens below the matrix and pushes the item below the fold), with prose, scalars, three collapsed lists and two object rows in different densities.
5. **Matrix (the "ugly" part, measured).** Single pass: Metric (200) | Score (110) | Reason. (a) The Reason column is empty ("-") for the 2 rows without a reason and an Arabic reason is placed at the **far end** of the column: text left edge x = 1087 against the column start x = 543 (**544 px** away from its header), because `dir="auto"` on a full-width cell right-aligns RTL text. (b) Everything is mono 12 px: metric names, scores, "False", with saturated red values in the cell next to an empty column. (c) The selected cell is a square 2 px white outline on a 44 px button inside a 110 px column. (d) Rows are 32 px with hairlines only, header 34 px uppercase. None of these is wrong alone; together the matrix reads as a spreadsheet dump, not a list of judgments.
6. The panel's actions are a lone pencil icon and a close icon (no word "Edit").

### R3.2 Legacy reference (`legacy-metric-table-1440.png`, `legacy-metric-reasoning-1440.png`, `legacy-overview-bars-1440.png`)

Legacy: metric chips (name, band-coloured value, pencil) in a 4-up wrapping grid under the output; clicking one opens a detail body (`.metric-det-zone > .metric-det > .det-body`) at full width. The body is `formatObjectAsHtml`: one block per key with the **label above the value** (gap 4 px, so no overlap is possible; measured label bottom 648, text top 652), humanized labels ("Score Table"), a copy button per key, and a table for `{columns, rows}` and array-of-array values (`.meta-table`: bordered, header row `--bg-elevated`, every header a sort button with an arrow, cells wrap at 420 px, horizontal scroll in `.meta-table-wrapper`, first 200 rows). Legacy faults: a list of objects is NOT a table (a 4-object `criteria` list expanded to 2,847 px of nested label stacks at 1440), values are mono 11 px everywhere, labels are blue uppercase mono.

Keep: label above prose (no overlap by construction), humanized labels, a real sortable bordered table with a header row, wrap instead of clip, copy per value, scroll inside the block. Do differently: uniform lists of objects also become tables; one calm label system; the matrix across passes stays; band colour only on the score.

### R3.3 The matrix itself: keep or go back to the chip list?

Decision: **keep the metric x pass matrix** (round 3 P5). The legacy chip list repeats once per pass (10 passes x 24 metrics = 240 chips, round 3 measured) and cannot compare a metric across passes; for one pass it is as good as the matrix and shows fewer rows per screen (4 chips per 38 px row against 1 row per 32 px with the reason visible). What makes the matrix ugly is typography and surface, not structure, so the fix is:

- Metric name: mono `--font-base` 400 `--text-secondary` (an identifier), truncated with a title; **not** bold.
- Value: mono `--font-base` 600, band text colour only; "True / False" and "Error" as today; a number is right-aligned in a 64 px pass column (kept) or left aligned in the 110 px Score column with 12 px start padding.
- Reason column (single pass): sans `--font-base` `--text-secondary`, one line, ellipsis, with `title`, in a block `inline-size: fit-content; max-inline-size: 100%; text-align: start; justify-self: start` so an Arabic reason **starts at the column's inline-start edge** (distance 12 px or less, was 544 px); the cell's `dir` stays on the text.
- Selected state: the whole row takes `--bg-selected` and a 2 px `--accent-primary` inline-start bar; the cell outline is removed (colour, border only; no outline box around a number). Hover: `--bg-hover` on the row. Focus-visible keeps the 2 px accent outline on the cell.
- Rows stay `--row-compact` 32 px and header `--table-header-height` 34 px (`--font-sm` 650 uppercase tracked muted); hairlines `--border-subtle`; no zebra, no tint.
- The summary line under the "Metrics" title stays ("6 shown of 6 - 5 below threshold").

### R3.4 Design of the panel (`mock-r5-metric-panel-en-*`, `-ar-*`, `-table-*`)

The panel is the single detail surface under the matrix (`--bg-elevated`, 1 px `--border-default`, `--radius-md`, padding `--space-md`, `direction: ltr; text-align: start`, `container-type: inline-size`). Nothing nests a card inside it.

```
+--------------------------------------------------------------------------------------------+
| rubric_judge | 20.7%  [Pass 3] [edited]                              [Edit score]  [x]      |  header, <= 40 px, hairline under
|                                                                                            |
| REASON                                                                                     |  eyebrow (stacked above the text)
| The answer identifies the correct policy (clause 4.2) and quotes the approval threshold,  |  prose: --font-md 13 px, line 1.6,
| but it never mentions the exception for existing customers ...                             |  <= 76ch, --text-primary
| DETAILED REASONING TRACE                                                                   |  more prose keys, --text-secondary
| Step 1 matched the question ...                                                            |
|                                                                                            |
| Judge model   gpt-5          | Confidence  0.74        | Latency ms  2140                  |  facts: key | value rows, 3 columns
| Temperature   0.2            | Self consistency chec... Three of three re-scored ...       |  key column 7.5rem, ellipsis + title
|                                                                                            |
| SCORE TABLE  4 rows                                                                        |  tables: eyebrow + DataTable embedded
| Criterion          | Weight | Score | Note                                                 |  sortable headers, scroll inside
| Cites the governing policy ...                                                              |
|  > breakdown  object . 2 keys                                                              |  nested objects: collapsed key rows
+--------------------------------------------------------------------------------------------+
```

1. **Header** (one row, wraps at 390): metric name (mono `--font-md` 600 `--text-primary`; metric names are identifiers), the score as `ScoreValue` (`--font-lg` mono 700, band colour, 2 px band bar, title `Band n of 5`), `Tag kind="count"` "Pass n" for a repeat item, `Tag tone="warning"` "edited" with the edit tooltip, then at the end the text button **"Edit score"** (`Button size="sm"` neutral, pencil glyph and the word) and the close `IconButton`. A hairline (`--border-subtle`) separates the header from the body. Edit opens `ScoreEditor` in the panel and the title reads "Edit {metric}" as today.
2. **Prose first, labels stacked.** Keys `reason`, `reasoning`, `explanation`, `label` in that order, then any other string over 60 characters, are **prose blocks**: an eyebrow label (`--font-sm` 650 uppercase tracked muted, humanized: "Detailed reasoning trace", ellipsis with a title for long keys) **above** the text, 4 px gap. The text is `--font-md` 13 px, line-height 1.6 (Arabic 1.7), `inline-size: fit-content; max-inline-size: min(100%, 76ch)`, `text-align: start`, `overflow-wrap: anywhere`, `dir` on the text element only (`textDirAttrs`; mostly Arabic gets `dir="rtl" lang="ar"`). The first block (Reason) is `--text-primary`, the following ones `--text-secondary`. A short Arabic reason sits at the left edge like an English one (round 3 anchor rule); long Arabic lines are right-aligned inside the 76ch block. Stacking removes the overlap defect for prose by construction (no side-by-side columns), which is also how legacy did it.
3. **Facts as `FieldRow` key / value rows.** Every remaining scalar (strings up to 60 characters, numbers, booleans) is a row in `dl.facts` (auto-fit grid `minmax(min(100%, 320px), 1fr)`, column gap `--space-lg`: three columns at a 1100 px panel, two at 700, one below 640). Row: `grid-template-columns: var(--field-label-width) minmax(0, 1fr); column-gap: --space-md; padding-block: --space-xs; hairline --border-subtle`. Key (`dt`): **humanized** (underscores to spaces, first letter capital: "Self consistency check result"), `--font-sm` 650 `--text-muted`, **not uppercase**, `text-align: left`, `min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`, `title` = the raw key. Value (`dd`): `--font-base`, sans for words, mono for numbers, booleans and ids, `justify-self: start; overflow-wrap: anywhere`, `dir` on the value (an Arabic explanation starts next to its key, never at the far end of the row). When the panel container is under 420 px the row stacks (key above value, 2 px gap) with the same truncation. `FieldRow` gets this recipe (its label gets the three truncation properties and an optional `humanize`), so every other FieldRow user is fixed too.
4. **Tables.** A value is a table when it is: `{columns: [...], rows: [...]}` (rows as arrays or objects), an array of arrays, or **an array of at least 2 plain objects with scalar values whose key sets overlap by 80% or more** (`criteria`, `evidence`, `checks`). The block is an eyebrow (humanized key, muted "4 rows" count) over `DataTable variant="embedded" density="compact"`: header `--table-header-height` 34 px (`--font-sm` 650 uppercase muted), rows `--row-compact` 32 px growing for wrapped text (`wrap: 3`, ellipsis only beyond three lines), numbers mono and end-aligned, text sans, **every header sortable** (`aria-sort`, arrow glyph), no zebra, hairlines. Horizontal scroll lives **inside** the table scroller (`responsive="scroll"` with the scroll cue fading the edge that still has content); the panel never scrolls sideways and a table never clips a column. More than 12 rows show 12 and "Show N more rows" (up to 200, then "Showing the first 200 of N rows", legacy rule). Column order is the order of `columns` or of first appearance of the keys.
5. **Nested objects and other arrays** (an object value, an array of mixed values or of non-uniform objects): collapsed key rows (the same `KeyTree`: chevron, mono key, muted type summary, `Expand all` / `Collapse all` for that key). A single tree key is `--font-base` 600 mono, not uppercase.
6. **One separator device**: a 1 px `--border-subtle` hairline under the header, between fact rows and under tree rows; groups are 14 px (`--space-md`) apart. No nested cards, no per-field background.
7. **Labels: two roles only.** The eyebrow (section label: prose and table titles; uppercase, tracked) and the fact key (sentence case). Tree keys are mono identifiers. So a reader sees three kinds of text, not five.
8. **Empty details**: "No details were recorded for this metric." (muted `--font-sm`), the header and Edit still present.
9. **Keyboard and screen reader**: unchanged from round 3 P5-12 (matrix grid roving, Enter opens, Escape closes and returns focus to the cell); Tab order inside the panel is Edit, Close, table headers, rows' tree buttons; the panel is `section[aria-label="{metric} details"]`; tables are `role="grid"` with names equal to their eyebrow; facts are a real `dl`.

Per width. 1440: panel 1151 px, facts 3 columns, tables full width, prose block 76ch (about 550 px). 390: panel 237 to 279 px, header wraps to two rows (name, score, tag on the first, Edit and Close on the second or the same), facts one column with the key above the value, tables scroll inside, prose full width. Heights in the mocks: en 610 / 1,005 px, Arabic 426 / 700 px, table 699 / 1,178 px at 1440 / 390.

### R3.5 Acceptance criteria

Fixtures: run `details` item `r5-005` (English rubric_judge, Arabic `arabic_judge`), widths 1440 and 390, panel open. "Label" = `dt` or eyebrow; "value" = its `dd` or prose text element.

| # | Element and width | Criterion | Measure |
|---|---|---|---|
| R3-1 | panel header (`[data-testid=metric-detail] > header`), 1440 | one row, <= 40 px high; contains the metric name, the score with band colour (`data-band`), "Pass n" for a repeat item, the text button "Edit score" (24 px high, visible without hover) and Close; at 390 it wraps to at most two rows (<= 80 px) | boxes, text |
| R3-2 | fact rows (`dl.facts > div`), 1440 and 390, LTR fixture | side by side (container >= 420 px): **dd.left >= dt.right + 12 px** for every row; stacked below 420 px: dd.top >= dt.bottom + 2 px | boxes |
| R3-3 | same, keys `detailed_reasoning_trace`, `self_consistency_check_result`, `step_by_step_reasoning_notes` (current overlap 42, 73, 68 px) | the key text box never extends past its column: `dt.scrollWidth <= dt.clientWidth` or `text-overflow: ellipsis` is computed and `title` equals the raw key; **the value's inline-start edge is >= the key's inline-end edge + 12 px in every case, LTR and RTL, 1440 and 390** | boxes, computed style |
| R3-4 | RTL fixture (`arabic_judge`: Arabic reason, reasoning, explanation, notes), 1440 and 390 | for prose blocks: eyebrow bottom <= text top - 2 px (stacked) and eyebrow left = text block left (+-1 px); for the fact `explanation`: dd.left >= dt.right + 12 px and **dd.left - dt.right <= 14 px** (the Arabic value sits next to its key, not at the row's far end) | boxes |
| R3-5 | prose block text (`.proseText`), both fixtures | `font-size` 13 px (`--font-md`), `line-height` >= 1.6 (>= 1.7 when `lang="ar"`), `max-inline-size` computed = 76ch, text left = panel left + 14 px (+-1) in LTR and RTL fixtures, `dir` set on the text element only | computed style |
| R3-6 | prose order | Reason, Reasoning, Explanation, Label first, then other long strings; Reason is `--text-primary`, the rest `--text-secondary` | DOM order, computed color |
| R3-7 | output key rows (`[data-keytree] [class*=key]`), key longer than 28 characters | the key is truncated at 28ch with ellipsis and a title; preview.left >= key.right + 6 px | boxes |
| R3-8 | table detection, `rubric_judge` fixture | `score_table` (`{columns, rows}`), `criteria` and `evidence` (arrays of uniform objects) render as `table`s (`role=grid` with the humanized name); **no `[aria-expanded]` row named `[0]`, `[1]` ... remains for them**; `breakdown` (object) and `flags` (array of strings) stay collapsed key rows | DOM query |
| R3-9 | each embedded table | header row 34 px (+-1), body rows 32 px for unwrapped text, headers have `aria-sort` and clicking one sorts (the first cell of row 1 changes for a text column); numbers are `font-family` mono and end-aligned | boxes, click |
| R3-10 | tables at 390 | the table scroller has `scrollWidth > clientWidth` and `overflow-x: auto`; the panel itself has `scrollWidth == clientWidth` (no page or panel sideways scroll); no cell text is cut by the scroller edge without the scroll cue | boxes |
| R3-11 | wrapped table text | a cell with text longer than its column wraps up to 3 lines; `text-overflow: ellipsis` only beyond that; no clipped glyphs (cell `scrollHeight <= clientHeight` for <= 3 lines) | boxes |
| R3-12 | tables with more than 12 rows (`log_table` of the seed, 14 rows) | 12 rows and a "Show N more rows" button; clicking shows all | count |
| R3-13 | label roles | the distinct (font-size, font-weight, text-transform) triples among labels in the panel are at most 3: eyebrow (11 px, 650, uppercase), fact key (11 px, 650, none), tree key (12 px, 600, none, mono) | computed |
| R3-14 | panel heights, fixture `rubric_judge` (`score_table`, `criteria`, `evidence`, `breakdown`, `flags`, 6 scalars, 2 prose) | <= 1,040 px at 1440 (measured 1,029) and <= 1,530 px at 390 (measured 1,523) (current 865 and 1,391). **Amended**: the old panel hid `criteria`, `evidence` and `score_table` behind collapsed rows; the new one shows three tables expanded by default (information is not hidden to meet a size) and the seed's 5-line reasoning at 76ch; the mocks (two tables, shorter text) measure 699 / 1,178 | height |
| R3-15 | header buttons | "Edit score" is a text button; Edit toggles `ScoreEditor` inside the panel (title "Edit {metric}"); Close and Escape return focus to the matrix cell | e2e |
| R3-16 | matrix Reason column (`#items` single pass, `arabic_judge` row), 1440 | the Arabic reason text box left - the cell left <= 12 px (current 544 px); the column cell has `justify-self: start` or equivalent | boxes |
| R3-17 | matrix rows | row height 32 (+-1), header 34 (+-1); metric name mono 12 px 400 `--text-secondary`; value mono 12 px weight 600 with band colour only | computed |
| R3-18 | selected matrix row | row background `--bg-selected`, 2 px `--accent-primary` inline-start bar, no 2 px outline on the cell (current: 2 px `--text-primary` outline); hover row `--bg-hover`; cell `:focus-visible` outline 2 px accent | computed |
| R3-19 | matrix semantics unchanged | metric x pass grid, 8 rows then "Show N more metrics", Mean column, keyboard roving (round 3 P5-8, P5-12) | existing specs |
| R3-20 | panel at 390 | no horizontal page scroll; panel `scrollWidth <= clientWidth`; facts one column, key above value | assertion |
| R3-21 | `FieldRow` everywhere else (Input, Expected, Tags rows) | label cannot overflow its column: `label.scrollWidth <= label.clientWidth` or ellipsis + title; Arabic input row keeps the label at the left (round 3 P5-2) | boxes |
| R3-22 | axe, item with the panel open (English and Arabic), 1440 and 390 | zero serious or critical violations | `a11y.spec.ts` |
| R3-23 | CSS | tokens only, no hex, `rgba(`, px font sizes; design-language test green | existing test |

### R3.6 Tests to write

- Vitest: `lib/metricTables.test.ts` (new, pure `detectTable(value)`: `{columns, rows}` with array rows and object rows, array of arrays, array of uniform objects >= 2, 80% key overlap, scalars only, mixed arrays stay trees, max 200 rows), `lib/humanizeKey.test.ts` (`detailed_reasoning_trace` to "Detailed reasoning trace", camelCase, numbers, Arabic untouched), `ui/FieldRow/fieldRow.truncate.test.tsx` (long label has ellipsis class and title), `items/MetricMatrix.test.tsx` (reason column anchor).
- Playwright `e2e/run-detail/redesign5-metric-panel.spec.ts`: R3-1 to R3-21 on `seedR5` run `details` (LTR and RTL fixtures, 1440 and 390); extend `a11y.spec.ts` for R3-22; update `redesign3-item-details.spec.ts` P5-12 for the new header.

### R3.7 Implementation notes

`items/MetricMatrix.tsx` + `.module.css` (panel header, row selection, reason cell anchor), `items/MetricStrip.tsx` (`MetaList` becomes `MetricDetailBody`: prose, facts, tables, trees), new `lib/metricTables.ts` (`detectTable`, row cap) and `lib/humanizeKey.ts`, `ui/FieldRow` (`FieldRow.module.css` `.label` gets `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`, optional `title`; `.row[data-anchor=start] .label` sentence-case variant `labelCase="sentence"`), `ui/KeyValueGrid` is no longer used by the panel, `ui/StructuredValue/KeyTree.module.css` (`.key` max 28ch with ellipsis, title), reuse `ui/DataTable` `variant="embedded"` (sort, `wrap`, scroll cue), `ScoreEditor.tsx` (no change, mounted under the header). Docs: DESIGN_LANGUAGE "Item details" (panel recipe, facts, tables, label roles), `docs/USER_GUIDE.md` item section only if it mentions the old panel.

## 4. Departures from earlier decisions

| Earlier decision | Now | Why |
|---|---|---|
| round 3 P7-5 / P7-6: Total row and six-number row under every box plot | no number row; median, min, max visible; six in the tooltip and `aria-label`; Total in the card header | owner (2026-10-17): "add colors to it and remove the numbers below them" |
| DESIGN_LANGUAGE Box plot: "Grey only; no new colour" | tone from band (state) or series 1 | owner; contrast >= 3:1 measured |
| round 3 P1 bar recipe `[spacer][count][bar][axis][sub]` | well + foot grid with a drawn axis line | R1 root cause |
| round 3 P5 detail panel: `FieldRow` prose + `KeyValueGrid` scalars + collapsed objects | prose stacked above its label, facts rows, tables, one tree | R3 |
| round 3 P5 matrix selected cell: 2 px outline | row tint + accent bar | R3 calm surface |

## 5. Decisions I made (open questions)

1. "Numbers below them" is the six-number row (and the Total row). Axis end labels (min, max) and the median label stay; flagged in R2.1 so the owner can say otherwise.
2. Tone by the **median's band** for directed score plots (including each per-pass row), series 1 for everything without a direction; passes and steps stay uncoloured by identity.
3. Total moves to the card header, additive quantities only.
4. Domain `[min, max]` for numeric quantities (so min and max labels are at the ends), `[0, 100%]` for scores.
5. The axis is a drawn line and the fix is structural (well + foot grid), not a patch (`min-height` on the label), because the same mechanism misplaces bars when only some columns carry a note or sub line.
6. Dense counts use two tiers rather than hiding counts: counts stay visible at rest (round 3 P1-2).
7. Labels in the panel: prose labels are stacked (legacy), fact keys are humanized and ellipsised with the raw key in `title`; this fixes the overlap for every key length and keeps `FieldRow` for key / value rows as the brief asks.
8. Table detection includes arrays of uniform plain objects (legacy only detected `{columns, rows}` and arrays of arrays); threshold 2 rows, 80% key overlap, scalar values.
9. Keep the metric x pass matrix; fix its typography, selection and Reason anchoring instead of returning to chips.
10. Output key rows could not be made to overlap (flex sibling); the 28ch cap is a guard, not a reproduced bug.

## 6. Hand-off for the implementer

Order (each step keeps `npm run check` green and ends with the matching criteria): (1) R1 (`BarColumns`, labels, dense, axis line) with R1-1 to R1-13; (2) R2 (`BoxPlot` tone, axis labels, tooltip, header Total, delete `BoxNumbers`) with R2-1 to R2-15; (3) R3 in this order: `FieldRow` truncation (R3-3, R3-21), `humanizeKey` + `detectTable`, panel body (prose, facts, tables, trees), header with Edit text button, matrix typography and selection (R3-16 to R3-18). Update the round-3 specs named above in the same commits; update DESIGN_LANGUAGE in the commit that changes the recipe. The gallery mocks stay as cases until the real components exist; add `r5-bars-sweep` for R1-3.
