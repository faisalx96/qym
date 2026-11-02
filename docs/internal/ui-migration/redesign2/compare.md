# Redesign 2 brief: Compare page

Area: `compare`. Investigated 2026-10-14 against the legacy UI (worktree `qym-wt-legacy`, port 8875) and the React app at the `UI-redesign` tip (platform 8876, Vite 5876), same seeded data (`frontend/scripts/seed-compare.ts`: 4 aligned runs of 40 items, a 3-pass repeat run, a 10-item run), Playwright at 1440 px (also 1280 x 720 / 1440 x 900 measurements and a 390 px shot). Screenshots are in the orchestrator scratchpad `cmp2/shots/` (`leg4-full`, `rea4-full`, `leg8-*`, `rea8-*`, `legc-*`, `reac-*`, `leg-exp`, `rea-exp`, `rea-exp-2`, `rea390-*`, crops `l-*` / `r-*`). No product code was changed.

Paths: `dash/` = `packages/platform/qym_platform/_static/dashboard/` in the legacy worktree (`compare.html` is one 16,585-line file; `ui_components.css` holds the shared output-card CSS); `CMP/` = `frontend/src/features/compare/`.

## 1. Feedback point

> compare page: its UI is highly non user friendly; refer to the old design for the ideal user experience.
> (general note) it should feel user friendly and interactive instead of static single colours of information.

Reading. Round 1 gave compare the legacy section order (stacked, full width) plus a sticky nav, a scope sidebar and a DataTable matrix. The reviewer still calls it non user friendly, so the problem is not structure, it is what each section lets a reader do at a glance. The legacy page was a document in which every run had a **name and a colour that never left it** (colour swatch plus run name in cards, legends, chips, error tables, category cards), every topic had a **visual** (baseline-tick bars in category cards, a winner bar with a named legend, per-run error tables), the item list was a column of **colour-coded score chips** that you scanned down, and an expanded item put **every run's output side by side in one row, with a metric click revealing that metric's details under every run at once**. The React page replaced identity by letters (A-H) that must be decoded against a scrolling chip bar, replaced visuals by text tables, stacked three bars of sticky chrome over the report, and breaks the side-by-side comparison in expanded items. "Intended UX" therefore means: restore run identity, restore the visuals, restore the aligned item comparison, and remove the chrome and duplication that make the page heavier than the legacy one, all inside the current report structure.

## 2. Legacy page anatomy (`dash/compare.html`, markup 5484-5715)

Scroller `.compare-container` (padding `--space-lg`), one long document, **no sticky bar, no sidebar**. The shell header only. Verified with `leg4-full.png`, `leg8-*.png`, `legc-*.png`.

| # | Section | Layout and content | Density / interaction |
|---|---|---|---|
| 0 | Header | "Compare Runs" h1, subtitle "across N runs", Export HTML. Cohort mode adds a Compare / Sweep segmented control and the "COMPARE SIDES" banner: two bars "A / LEFT baseline-gpt-mini 2 runs", "B / RIGHT cand-b-small 2 runs" (`legc-a.png`) | |
| 1 | Run cards | One card per run, 3 per row at 1440 (4th wraps), always visible, also at 8 runs (3 rows, `leg8-a.png`). Card: left/top border in the run colour, swatch, **run name** (mono, bold), status badge, remove X (min 2 runs), "Items / Completed / Errors" strip with icons, Task / Dataset / Model / Owner / Started / Runtime grid, and "Samples . Config" for repeat runs | about 240 px per card, border 1 px, radius md. Remove is one click. No other interaction |
| 2 | Per-Run Averages (5509) | h2 + one description line + Baseline select (right) + Run average / Each pass toggle (repeat runs). **Table: rows = metrics (correct, quality, Avg Latency), columns = runs** with the colour swatch and label in the header. Baseline column shows the plain value (score-coloured text). Other columns: value in a **boxed verdict** (green outline when beyond the noise band), `+17.5 pts +-15.5` below, `up 9 / down 2` count buttons that filter the items | 3 rows, about 170 px for 4 runs; 8 runs scroll horizontally. Everything for a metric is one horizontal scan |
| 3 | Comparison Overview (5527) | h2 + description; **compact** right-aligned controls in the section head: correct / quality segmented, Pass-if slider (about 100 px). Panel with 8 stat cells (Pass@4, Pass^4, Max@4, Consistency, Reliability, Avg Score, Avg Latency, Errors), then "WINNER BREAKDOWN" bar with a **legend naming every run with its count and swatch** (`baseline-gpt-mini: 5`, ..., `Ties: 0`), then "CORRECT DISTRIBUTION" segmented bar | stat values are score-coloured (orange/red/green), which gives the page its colour signal |
| 4 | Performance by Category | chip bar of metadata keys (complexity 3, domain 4), then **one card per value** (easy / medium / hard): every run is one row with swatch, name, AVERAGE, LATENCY, CHANGE vs baseline and a **bar with a baseline tick**; cards 2-up, left border in the key's colour | the bar plus tick shows who beat the baseline without reading numbers; cards are about 220 px for 4 runs |
| 5 | Step latency | only with traces | |
| 6 | Error Distribution | "Task Errors 6" / "Metric Errors 3" groups; one **card per message** (`TimeoutError`, 6 ERRORS) with a per-run table: swatch, run name, count, delta vs baseline (`Baseline`, `-1`, `+1`). Clicking a card filters the items | named rows, no letters |
| 7 | Root Cause | cards per category | |
| 8 | Item-by-Item Comparison (5554) | head (title, description, Auto-Analyze). One panel. Toolbar: search (grows), Filters dropdown, "40 of 40 items", Display, CSV. **Row = a rounded card, 54 px high: chevron, `#1`, question (13 px bold) and, right-aligned, one score chip per run: 22 px high, swatch + value, value coloured red/orange/yellow/green by score (`50.1%`), a red circled-x chip for task errors; the whole row gets a red border when any run errored** (`l-items.png`). 20 per page | zebra-ish alternating fills; scanning is vertical down a chip column and horizontal across 4-8 chips |
| 9 | Expanded item (`renderItemComparisonCard`, 13234; `renderCompareOutputGroup`, 12977; CSS `dash/ui_components.css` 2455-2560) | Card body: INPUT (accent left bar), EXPECTED OUTPUT (green block), metadata tags (`easy`, `commerce`). Then "OUTPUT" with **toggle chips, one per run** (swatch + name, `aria-pressed`) that hide or show a run's column. Then a **single grid, one column per visible run** (`visible-1`: 1 col; `visible-2/3`: `repeat(n, minmax(320px, 1fr))`; more: `grid-auto-flow: column`, horizontal scroll). Each output card: **3 px left border in the run colour (red only for a task error)**, run name as a link to the run, Pass/Fail tag (from the selected metric), latency, Trace button, copy, output text, then **metric strip: one row per metric (name, coloured value, edit pencil)**. Clicking a metric row opens a **metric-details panel under all runs at once** (`.qym-metric-compare`, one cell per run, same column grid, same left-border colours), so one metric's reasoning is compared across runs. Root-cause issues per run, a "Winner" badge on the best run (`isWinner`) | the comparison is horizontal: you read left to right across runs, never down |

Interaction summary of legacy: remove-run X, baseline select, count buttons, category chips, error-card click, Filters dropdown (rules), per-item run toggles, per-item metric open, Escape closes dropdowns; transitions are 0.16 s colour fades only. Hover: row background change. No keyboard walk of rows. Colour palette: 8 distinct run colours (`COLORS`, `dash/compare.html:5760`), never reused.

Regression scanning in legacy, how a user did it: (1) the Averages table gave a boxed verdict and a `down N` button per run: click `down 2` and the list shows only those items; (2) category cards with the baseline tick showed where a run fell behind; (3) in the list, a red chip next to a green chip across a row was the signal; red-bordered rows were errors; (4) Filters > Outcome (Different outputs, With errors, All runs correct, No run correct, Partially correct, Rarely solved, Uniquely solved) and Winner (tie, X won, only X solved). There was no sort by regression. Legacy had no text diff highlighting of outputs (grep of `diff`/`highlight` in `compare.html` only finds the metrics table and the Sankey).

## 3. React page anatomy (after round 1)

Tree: `CMP/ComparePage.tsx` > `CompareLoaded` > `PageHeader` (Compare | Sweep, Export HTML) > `Notices` > `div.sticky[data-compare-sticky]` (`SelectionBar`: run chips with letter, label, baseline star, X, "Reset baseline", pass toggle; `DeltaLine`: metric select + one pill per candidate run (`B +15.3 pts +-8.8 [up 30] [down 9]`); `ReportNav`: Runs, Averages, Overview, Categories, Steps, Errors, Root cause, Items with count) > `CompareBody` > `ReportLayout` with `ScopeBar` + `QuickFilters` sidebar only while a scope is active > `CompareReport` (`components/ReportSections.tsx`) with lazy `ReportSection`s: `RunCards`, `panel/MetricsTab` (Per-run averages), `panel/OverviewTab`, `panel/CategoriesTab`, `panel/StepsTab`, `panel/ErrorsTab`, `panel/RootCauseTab`, `items/ItemsSection` > `ItemsToolbar` + `items/ItemList` (DataTable, one column per run) + `ItemDetail` + `OutputCard` + `rd/TraceDrawer`. Sweep: `sweep/SweepView.tsx` (unchanged by this brief).

What the reader sees at 1440 (`rea4-full.png`, `rea8-a.png`, `rea-exp.png`):
- Header 3 lines, then the sticky block: chips row (wraps to 3 lines at 8 runs), a delta row (a pill per candidate; at 8 runs it overflows to the right edge and is cut: `H +3.4 pts ... up 4` clipped in `rea8-a.png`), the nav row. Measured sticky height: 128 px at 4 runs, 200 px at 8 runs (measured via `getBoundingClientRect` at 1280 x 720 and 1440 x 900); short viewports (< 1000 px high) scroll the chips away and keep only the nav (`ComparePage.module.css:23`), tall ones keep all of it.
- Runs: cards are 4-up small key/value lists (Items, Model, Owner, Dataset, Runtime); **hidden behind a "Run details" button above 4 runs** (`RunCards.tsx:13`).
- Per-run averages (`MetricsTab.tsx`): table with **runs as rows and one column per metric**; each run cell stacks value, delta tag with band, a dot-plot glyph and two count buttons, so a row is about 105 px: 420 px for 4 runs, about 800 px for 8 (`rea8-a.png`). Two description lines under the title ("Average per run with the paired change ..." and "Average per run over 40 filtered items; ...").
- Overview: slider spans the whole width, winner bar labelled with letters only (`B 24`), no named legend, "Runs correct per item" histogram.
- Categories (`CategoriesTab.tsx`): a text table, value x run, each cell `65%`, latency, and a `= +18.1 pts +-20.2` tag; **no bars, no baseline tick**; at 8 runs six narrow text columns.
- Errors: one line per message of letter chips (`A 2 | B 1 down -1 | C 3 up +1 ...`).
- Items (`ItemList.tsx`, DataTable): `#`, Input (flex), one 148 px column per run (76 px `dense` above 6 runs) with header `dot + letter + star`, cells are a ScoreBar + number + a baseline delta glyph, error chips, a 3 px left rail (warn when any run regressed vs the baseline, red when a run errored). Rows are 52 px; the header is pinned under the sticky chrome; `Input` leaves a 300 px gap before the first score (`rea4-full.png`).
- Expanded (`ItemDetail.tsx`): Input and Expected side by side, tags, run toggle chips with the **long label** (`A gpt-5-mini - Oct 1 03:00 PM #1`), then `grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr))`: at 1193 px content width that is 3 columns, so **the 4th run wraps onto a second row** and the 5th to 8th stack (`rea-exp.png`). Card border colour is the verdict (red / green), run identity is a 6 px dot. A metric click (`OutputCard.tsx` `MetricChips`) expands that one card only.

## 4. Gap analysis

| # | legacy | react | why it matters | proposed change |
|---|---|---|---|---|
| G1 | Run identity = swatch + run name in cards, banner, winner legend, error tables, category cards, output cards | Letters A-H everywhere below the chips (matrix header, winner bar, errors, categories, toggles carry the long auto label); the 6th to 8th run reuse the first three colours (`runColor` is `chart-(i%5)+1`); letter decoding needs the chip bar, which scrolls away on short screens | The reader's first question on a comparison is "which run is this". A letter forces a lookup in every section; 8 runs makes it impossible | `RunTag` (swatch + letter + short name) used in every section; 8 distinct colours (tokens `--chart-6..8`); name is `run_name` where legacy used it |
| G2 | No sticky chrome; the page is the report | Sticky block 128 px (4 runs) to 200 px (8 runs) of chips, deltas and nav, delta pills clipped at 8 runs; the delta pills duplicate the count buttons in Averages | Chrome eats 14 to 25 percent of a laptop screen and still hides information | One 44 px sticky bar (nav + metric + baseline + scope count); chips and delta pills move into the sections that use them |
| G3 | Averages: metrics are rows, runs are columns, 3 rows, about 170 px | Runs are rows, 105 px each, 420 to 800 px; two description lines | Comparing runs on one metric needs a horizontal scan; vertical stacks make the reader scroll past the data. 8 runs = a screen of whitespace | Legacy orientation, 2 line cells (value + verdict box, delta/band + counts) about 64 px per metric row |
| G4 | Category cards: per run bar + baseline tick + change | Text table, neutral grey tags, no bars | The most visual part of the legacy page is now numbers in grey pills: nothing "pops" | Cards view by default (legacy), table kept as an option; `ScoreBar` gets a `marker` (baseline tick) |
| G5 | Error cards with named per-run table and delta | One line of letter chips | Unreadable beyond 3 runs; can't tell which run is which | Cards with a per-run table (swatch + name + count + delta); zeros collapsed above 6 runs |
| G6 | Overview controls compact in the section head; winner legend names runs with counts | Full-width slider; letters only | The slider is a wide row of nothing; winner bar can't be decoded | Compact controls in the SectionHeader aside; named legend |
| G7 | Run cards always visible, with Items/Completed/Errors strip | Collapsed above 4 runs; no stat strip (a strip was added in review, but the card is text rows) | Run configuration is part of the report | Always visible; compact variant above 4 runs (3-up, 2 lines), not collapsed |
| G8 | Item row = colour-coded chips, **swatch inside every chip**, red outline on errors | Bars and numbers; run is a column header letter only; no swatch in cells; 300 px dead gap between input and scores; rails (yellow/red) have no legend | Cells need to say which run they belong to when the header scrolls away or has 8 columns; the yellow rail is unexplained | Swatch in cells at 5+ runs, input column capped, a one-line rail legend in the toolbar, header = `RunTag` with name |
| G9 | Expanded item: all runs in one row (`minmax(320px)`, horizontal scroll beyond 3), left border = run colour, Pass/Fail tag | 3-up grid that wraps; border = verdict colour (red/green), run only a dot | The side-by-side comparison is the product; wrapping breaks it and colour no longer says which run. Red borders on every failed run look like errors | One row grid with horizontal scroll and snap; left border run colour; verdict is the tag only |
| G10 | Click a metric on any run: details of that metric under every run, aligned | Click expands a single card | Cross-run reasoning comparison is lost | Shared per-item `openMetric`, aligned metric-details row under the cards |
| G11 | Run toggles chips with swatch and short name | Chips with long label, no All/None | Toggling the compared set is the main way to focus 8 runs | `RunTag` chips, plus "All", "Only differing" |
| G12 | Winner badge on the best output card | None anywhere in items | "Who won this item" is only inferable by reading bars | Subtle best-score emphasis in row and card badge when there is a unique winner |
| G13 | Section dividers are panels; one description per section | Dead bands (about 50 px) and duplicated subtitles ("Average per run ..." twice, Categories twice) | Looks static and unfinished | One description; the "over N filtered items" note goes in the header `note` slot (exists on `SectionHeader`/`ReportSection`) |
| G14 | n/a (no interaction) | Hover, focus and expand exist on rows (DataTable) but nothing links a run across sections | The general note asks for an interactive feel | `RunTag` hover / focus dims other runs everywhere (P2) |

What stays better in React (do not regress): sticky matrix header with run columns, rails for regressed/error rows, ScoreBar with delta glyph, scope sidebar, deep links, virtualization, 390 px cards, the 95% noise band numbers (exact t distribution), pass/each-pass toggle, Sweep.

## 5. Redesign spec

### 5.1 Principles
1. A run is always swatch + name (letter is a short suffix, the name truncates with a tooltip).
2. Every analytic section has one visual, not just a table.
3. The item comparison is horizontal: runs side by side, aligned metric details.
4. Chrome stays small; controls live where they act.
5. Colour is never alone: keep glyphs/words (existing rule in `common.tsx`), but colour carries identity (run) separately from verdict (tag / delta).

### 5.2 Page structure (unchanged order, new chrome)
Header, Notices, **Sticky bar (44 px)**, Runs, Averages, Overview, Categories, Steps, Errors, Root cause, Items. ScopeBar and the sidebar keep their current behaviour.

Sticky bar contents, left to right: nav links (Runs ... Items 40, active link underlined), flex space, `quality v` metric select, `Baseline: A claude... v` select, scope summary ("40 of 40") or "Filters (2)". Below 1200 px the nav scrolls horizontally and the selects collapse into a "View" popover. The run chips row and delta pills leave the sticky block: chips become the Runs section (cards carry the X and the star), delta pills become the "Changes vs baseline" strip at the top of the Items section (non-sticky), where filtering happens.

### 5.3 Wireframes (1440, 4 runs; content width about 1190)

```
Compare runs                                                        [Compare|Sweep] [Export HTML]
4 columns . cmp-qa-v1 . 40 aligned items                      (cohort: COMPARE SIDES  A baseline-gpt-mini x2  vs  B cand-b-small x2)
+==========================================================================================+
| Runs  Averages  Overview  Categories  Errors  Items 40        [quality v] [Baseline A v]  |  sticky 44 px
+==========================================================================================+
 Runs                                                              (one description line)
 +-----------------+-----------------+-----------------+-----------------+  4-up (3 at 8 runs, compact)
 |#A baseline-gpt-m|#B cand-a-sonnet |#C cand-b-small  |#D cand-c-same   |  top border = run colour
 |* COMPLETED    [x]|  COMPLETED   [x]|  COMPLETED   [x]|  COMPLETED   [x]|
 | 40 items 40 ok 3err|  ...           |                 |                 |  Items / Completed / Errors strip
 | gpt-5-mini  Dev User  30m  cmp-qa-v1                                    |  Model, Owner, Runtime, Dataset
 +-----------------+-----------------+-----------------+-----------------+
 Per-run averages                                       [Run average|Each pass]  over 40 items
 +-----------+--------------+--------------+--------------+--------------+
 | METRIC    | #A base *    | #B cand-a..  | #C cand-b..  | #D cand-c..  |
 | correct   | 20.0%        | [37.5%]      | 5.0%         | 32.5%        |   [..] = boxed when beyond noise
 |           | baseline     | +17.5 +-16 ->| -15.0 +-13.6 | +12.5 +-16.5 |
 |           |              | [^9] [v2]    | [^1] [v7]    | [^8] [v3]    |
 | quality   | 47.0%        | [62.3%] ...                                |
 | Latency   | 1.3s         | 1.3s  -3%    | ...                         |
 +-----------+--------------+--------------+--------------+--------------+
 Comparison overview                 [correct|quality]  Pass if >= [--o--] 70%
 [Pass@4 47.5%][Pass^4 0.0%][Max@4 71.5%][Consistency][Reliability][Avg score][Latency][Errors 9]
 WINNER  [A 5 |      B 24                          | D 11 ]
          # A baseline-gpt-mini 5   # B cand-a-sonnet 24   # C cand-b-small 0   # D cand-c-same 11   Ties 0
 CORRECT DISTRIBUTION  [ 0: 21 ][ 1: 8 ][ 2: 7 ][ 3: 8 ][ 4: 0 ]
 Performance by category   [complexity 3] [domain 4]                      [Cards|Table]
 +-- easy (14) ----------------------+ +-- medium (13) ---------------------+   2-up cards
 | #A base      65%  1.3s  Baseline  | | ...                                 |
 |   [=========|=========         ]  | |                                     |   bar + tick = baseline
 | #B cand-a    83%  1.4s  +18.1  ^  | |                                     |
 |   [==================|===      ]  | |                                     |
 | ...                               | |                                     |
 Error distribution
 +- TimeoutError  6 errors  task exceeded 30s -----+ +- JudgeError 3 ... ------+
 | #A base      2   Baseline                       | | ...                      |
 | #B cand-a    1   -1  | #C cand-b 3 +1 | #D 0 -2 |
 Item-by-item comparison                                       40 of 40 items
 Changes vs baseline:  B +15.3 [^30][v9]   D +8.0 [^25][v15]   C -10.8 [^13][v26]     (the old DeltaLine)
 [Search..] [Filters] [Display] [CSV] [Analyze]     |warn= regressed vs baseline  |red= error
 +---+--------------------------------+---------+---------+---------+---------+
 | # | INPUT                          | #A base*| #B cand-| #C cand-| #D cand-|  sticky header, names truncated
 |>1 | Question 1: what does clause 0 | 50.1%   |81.2% ^  |36.9% v  |67.7% ^  |
 |   |   (best cell gets a subtle fill and a small star when unique)          |
 +---+--------------------------------+---------+---------+---------+---------+
 (expanded #1)
 | INPUT ...                         | EXPECTED OUTPUT ...                      |
 | [easy] [commerce]                                                              |
 | OUTPUT  [All] [Only differing]  (# A base) (# B cand-a) (# C cand-b) (# D cand-c) |  toggles
 | +--------------+--------------+--------------+--------------+  one row, scrolls sideways if > 3 at < 1400
 | |#A baseline.. |#B cand-a..   |#C cand-b..   |#D cand-c..   |  3 px left border = run colour
 | | Fail 1.4s [T]| Pass 1.6s [T]| Fail ...     | Fail ...     |
 | | output text  | output text  | output text  | output text  |
 | | correct False| correct True | ...                          |
 | | > quality 50%| v quality 81%| > quality 36%| > quality 67%|  click ANY quality row ...
 | +--------------+--------------+--------------+--------------+
 | QUALITY DETAILS   (one cell per run, same columns)                              |  ... opens aligned details
 | | reasoning ... | reasoning ... | reasoning ... | reasoning ... |
 | ROOT-CAUSE ISSUES per run (same columns)                                         |
```

Mobile (390): sticky bar becomes static; nav scrolls horizontally; Runs = single column compact cards; Averages = one card per run (`#B cand-a  correct 37.5% +17.5 [^9][v2]` / `quality 62.3% ...`), baseline first; Overview stat strip 2-up; Categories 1-up cards; Errors cards 1-up; Items = existing DataTable cards ("A name 50.1% bar" rows); expanded: output cards 1 column stacked with run toggles; metric details open under the tapped card.

```
+------------------------------+
| Runs Averages Overview Cat.. |  scrolls, static
| [quality v] [Baseline A v]   |
| Per-run averages             |
| +--------------------------+ |
| | #A baseline-gpt-mini *   | |
| | correct 20.0%  baseline  | |
| | quality 47.0%  baseline  | |
| +--------------------------+ |
| | #B cand-a-sonnet         | |
| | correct 37.5% +17.5 ^9 v2| |
```

### 5.4 Per-section spec

**Run identity (new `RunTag`, `CMP/components/RunTag.tsx`).** Props: `index: number; name?: string; showLetter?: boolean; baseline?: boolean; compact?: boolean; asButton?; onFocusRun?`. Renders swatch (10 px, `--radius-sm`), optional letter in mono, name truncated at 18 ch (`max-width: 14rem`) with `title` = full auto label (the existing disambiguated `run.label`, unchanged elsewhere), star for the baseline. `runShortName(run)` = `run.run.run_name` when present and not equal to the auto label, else `run.label`; this is exactly what legacy cards, legend and banner showed. Used by: Runs cards, Averages header, Overview legend, Categories cards and table header, Errors tables, items header, toggles, output card header, delta strip. 8 colours: add `--chart-6: #60a5fa; --chart-7: #34d399; --chart-8: #fb923c;` (the legacy `COLORS` 6-8) to `tokens.css`; `runColor(i)` becomes `var(--chart-${(i % 8) + 1})`; letter still the unique key for 9+ runs and for colour-blind users. Check contrast of 6-8 on `--bg-surface` in the design-language test (swatches are decorative; text is never run-coloured).

**Sticky bar.** Replace `div.sticky` content by `CompareBar`: `ReportNav` + `MetricSelect` + `BaselineSelect` (the existing baseline control from `SelectionBar`'s chips moves to a Select; the star on a Run card also sets the baseline) + scope count. Height 44 px (`--control-height` + padding), `top: 0`, `--compare-chrome-h` becomes 44 px so deep links (`alignToElement`) land under it. Remove the `max-height: 999px` special case (nothing left to scroll away). The run X buttons live on the Run cards (legacy), the pass toggle (Run average / Each pass) moves to the Averages header (legacy), "Reset baseline" is an action in the baseline select.

**Runs.** `RunCards` always visible. 1-4 runs: current 4-up with a top border in the run colour, `RunTag`, status, X, **a stat strip** (Items, Completed, Errors) and a 2-column key/value grid (Model, Owner, Dataset, Runtime, Started). 5-8 runs: compact variant, 3-up (2-up at 1100), two lines: `RunTag` + status + X, then `model . owner . N ok . E err`. 9-20 runs: auto-fill 200 px columns, one line; the "what differs" table stays in a `Disclosure`. No collapse behind "Run details" except the what-differs table.

**Per-run averages.** `MetricsTab` is rebuilt as `AveragesMatrix` on `DataTable` (or the existing ScrollRegion table if DataTable's column-per-run header is heavier than needed): rows = `correct`, `quality`, other metrics, `Latency`, `Errors`; first column pinned (metric name, direction hint, muted); one column per run (header `RunTag` with baseline star), min 132 px, flex to fill; baseline column highlighted with `--bg-hover`. Cell = three rows: line 1 value (`--font-md`, score colour via `ScoreValue`), line 2 delta tag (existing `DeltaTag`: glyph + signed pts + band, boxed when beyond noise, `data-verdict`), line 3 `CountButtons` (up N / down N, existing, same filter behaviour) with the noise dot-plot glyph at the end of line 2. Cell height about 76 px; 4 runs x 4 rows about 340 px (legacy 170 px had no counts per cell wrapped; this is the same information). The header row holds the pass toggle and, at the far right, "over 40 filtered items" as the section `note`. One description sentence. Below 768 px: cards per run as in the mobile wireframe.

**Overview.** `OverviewTab` keeps the stat strip, winner bar and histogram. Changes: the Pass-if slider and metric segmented control go to the section header aside (`SectionHeader` actions slot, slider `width: 8rem`); the winner bar gets a **named legend** (`RunTag` + count, `Ties`), identical to legacy; bar segments labelled with letter and count; the "Runs correct per item" histogram stays, its bars coloured by count with the same tint as legacy. Remove "Higher is better" and "A run passes when..." as separate lines: merge into one description.

**Categories.** Default view `Cards` (legacy) with a `SegmentedControl` Cards | Table in the section header (URL `catView=table`, default cards). Key chips stay. Card per value (2-up at >= 1280, 1-up below), header "easy 14"; body one block per run: `RunTag`, average (mono, score colour), latency, change (`DeltaTag` compact), and a 6 px `ScoreBar` with `marker={baselineAverage}` (baseline tick). Clicking a card row filters items exactly as the current table row click. 8 runs: 8 blocks x 34 px about 290 px per card. The current table is kept as the Table view with `RunTag` headers.

**Steps, Root cause.** Unchanged except that run identifiers become `RunTag`.

**Errors.** `ErrorsTab` renders one `Card` per message (title, count, short description) with a table `RunTag | count | delta vs baseline` (existing `DeltaTag`); card click filters (existing). Above 6 runs, rows with 0 errors in all but the baseline are folded into "N runs with none" in the card footer. Groups "Task errors N" and "Metric errors N" keep their heading; cards 2-up.

**Items.**
- Delta strip: the old `DeltaLine` (per candidate pill with verdict, band, up/down count buttons) is rendered here, non-sticky, wrapping, with `RunTag`; metric select stays in the sticky bar. The cohort verdict ("Open Sweep") sits at its right.
- Toolbar legend: after the count `40 of 40 items` a muted legend "warn rail = a run regressed vs baseline, red rail = error".
- Columns: `#`, `Input` capped (`flex`, `maxWidth: 36rem`) so scores sit within 40 percent of the row; run columns `flex` min 148, max 220 so the matrix fills 1190 to 1700 px; header `RunTag` (letter, name truncated, star). Above 6 runs `dense` (76 px) keeps swatch+letter only and a tooltip with the full name (`hint`, already supported).
- Cell (`RunCell`): at <= 4 runs unchanged (bar + value + glyph); at >= 5 a 6 px swatch is prepended so a cell stays attributable when the header scrolls; the unique best score of the row gets `font-weight 650` and a trailing small star with `aria-label="best"`. Ties and rows with an error: none.
- New sort option "Biggest change vs baseline" (sum of absolute paired delta, worst regressions first) in `Display`; legacy had only score/latency sorts. Optional (O2).
- Hover: row `--bg-hover` (exists), hovered cell tooltip: `claude-sonnet-4 . 81.2% (+31.1 vs baseline)`. Keyboard: arrows, Home/End, PageUp/Down, Enter/Space (DataTable, exists), plus `m` toggles all metric panels? Not added, keep DataTable semantics.

**Expanded item (`ItemDetail`).**
- Input and Expected unchanged (side by side), tags unchanged.
- Run toggles: `Chip`s with `RunTag`, plus two ghost buttons `All` and `Only differing outputs` (hides runs whose output text equals the baseline's; same predicate as the `different` filter). State stays in component (as now).
- Output grid (`ItemDetail.module.css` `.grid`): `display: grid; grid-auto-flow: column; grid-auto-columns: minmax(20rem, 1fr); overflow-x: auto; scroll-snap-type: x proximity; padding-bottom: var(--space-xs)`. Visible 1 run: one column; 2 and 3: `repeat(n, minmax(20rem, 1fr))` (legacy). Above 3 the row scrolls sideways with snap and a gradient edge cue on the cut side (reuse the table edge cue of `DataTable`). The "Show all N runs" button and `INITIAL_CARDS = 8` limit stay for 9+ runs.
- `OutputCard`: `border-inline-start: 3px solid var(--run-color)` (run identity), neutral other borders; verdict stays as the `Tag` (Pass green / Fail red / ERROR) already in the header; task-error cards use `--error` for the whole left border (legacy). Header: `RunTag` + link to the run (`Open in run`, as legacy), status tag, latency, trace, copy.
- **Aligned metric details**: `ItemDetail` owns `openMetric: string | null`; `OutputCard`'s `MetricChips` becomes controlled (`openMetric`, `onOpenMetric`) and shows only the value row (name, value, edit pencil, chevron). When `openMetric` is set, `MetricPanel` renders directly below the card row in the **same scroller** (the card row and the panel row share one `grid-template-columns` via CSS `subgrid`, fallback: same min widths), one cell per visible run with the run-colour left border, containing `MetaList` for that metric (existing, honours `hiddenFields`). Closing: click the chevron again or Escape. Edit pencil and root-cause issues keep their position.
- Winner: when the item has a unique best score, the card header shows a `Tag tone="success"` "Best" (legacy "Winner" badge).
- Motion: card row and panel open with `grid-template-rows: 0fr -> 1fr` over `--duration-fast`; `@media (prefers-reduced-motion: reduce)` none.

**Run focus (P2).** `RunFocusContext` holds `focused: number | null`. `RunTag` `onPointerEnter/Leave` and `onFocus/Blur` set it; elements that carry `data-run="i"` (RunTag, matrix header, run cells, output cards, category blocks, error rows) get `opacity: .45` when `focused !== null && focused !== i` through one CSS rule on `[data-run-focus]` at the page root. No layout effect, purely visual, reduced-motion safe (no transition under reduce).

### 5.5 State and URL
No new required params. `catView=cards|table` (default cards, omitted when default). `?panel=`/`#section` aliases stay. Baseline, metric, columns, filters, `item`, `trace`, sweep params unchanged. localStorage: none new.

### 5.6 Responsive rules
- 1920: run columns flex to max 220, Input cap 36 rem, Runs 4-up, category cards 3-up (>= 1700), content not centred.
- 1280: sticky bar nav + selects fit; category cards 2-up; averages min 132 per run (4 runs fit, 8 runs scroll with the pinned metric column).
- 768: sticky bar nav scrolls horizontally, selects in a "View" Popover; Runs 2-up; categories 1-up; items table keeps pinned `#`, horizontal scroll with edge cue.
- 390: see wireframe; sticky bar static; all section grids single column; items DataTable cards; output cards stacked.
- Motion: only the expand / metric panel transitions and the run focus dimming; all disabled under `prefers-reduced-motion`.

### 5.7 Primitives
Reused: `ReportSection`, `SectionHeader` (`note`, actions), `StatStrip`, `DataTable`, `ScoreBar`, `ScoreValue`, `Tag`, `Chip`, `SegmentedControl`, `Select`, `Slider`, `Disclosure`, `Popover`, `Tooltip`, `Kbd`.
New or extended:
- `ScoreBar`: add `marker?: number` (0-1 tick, `aria-hidden`, `--text-primary` 2 px) and `height?: 'sm' | 'md'`. Design-language test: tokens only.
- tokens: `--chart-6..8`.
- `CMP/components/RunTag.tsx` (feature-local; promote to `ui` only if run-detail needs it).
- `CMP/components/CompareBar.tsx` (replaces the sticky block), `AveragesMatrix.tsx`, `CategoryCards.tsx`, `ErrorCards.tsx`, `MetricPanel.tsx`, `RunFocusContext.tsx`.
- `DataTable` `Column.minWidth/maxWidth` for flex run columns if not already present (`flex: true` + `minWidth` exist; `maxWidth` is new, 0.5 h).

## 6. Work plan

| Task | What | Files | Tests | h | Depends |
|---|---|---|---|---|---|
| T1 | Identity foundation: tokens `--chart-6..8`, `runColor` 8-wide, `RunTag`, `runShortName`, apply to Runs chips/labels | `styles/tokens.css`, `CompareContext.tsx`, new `RunTag.tsx`, `common.tsx` | Vitest: `runColor`, `runShortName`; design-language test | 4 | none (do first) |
| T2 | Compact sticky `CompareBar`; baseline Select; move pass toggle to Averages; delta pills to the Items section; update `--compare-chrome-h` and deep-link offsets | `ComparePage.tsx`, `ComparePage.module.css`, `SelectionBar.tsx`, `DeltaLine.tsx`, new `CompareBar.tsx` | e2e `selection.spec`, `layout.spec`, `ux-layout.spec`, `deeplink.spec` (offset), `a11y.spec`; new check "sticky bar <= 48 px at 8 runs" | 6 | T1 |
| T3 | `AveragesMatrix` (legacy orientation) + mobile cards | `panel/MetricsTab.tsx` -> `AveragesMatrix.tsx` | Vitest cell content; e2e `matrix.spec`, `selection.spec` (counts filter), 8-run no-overflow | 6 | T1 |
| T4 | Category cards view + `catView`; `ScoreBar marker` | `panel/CategoriesTab.tsx`, `CategoryCards.tsx`, `ui/ScoreBar` (cells), `useCompareController` (URL) | Vitest `ScoreBar marker`; e2e row click filters; design test | 6 | T1 |
| T5 | Error cards with per-run table, zero folding | `panel/ErrorsTab.tsx`, `ErrorCards.tsx` | e2e error card filter; `cutover-errors.test.ts` unchanged semantics | 3 | T1 |
| T6 | Overview polish (compact controls, named legend), runs cards always visible + compact variant, remove duplicate descriptions and dead bands | `panel/OverviewTab.tsx`, `RunCards.tsx`, `ReportSections.tsx`, css | e2e `layout.spec` section heights, cards at 8 runs | 5 | T1 |
| T7 | Items collapsed row: `RunTag` header, cell swatch, Input cap, rail legend, best-cell emphasis, optional sort | `items/ItemList.tsx`, `ItemsToolbar.tsx`, `ItemList.module.css`, `lib/filters.ts` (sort), `ui/DataTable` `maxWidth` | e2e `items.spec`, `matrix.spec` (header names, no dead gap), Vitest sort | 5 | T1 |
| T8 | Expanded item: one-row grid, run-colour border, toggles (All / Only differing), aligned `MetricPanel`, Best tag, open animation | `items/ItemDetail.tsx`, `ItemDetail.module.css`, `OutputCard.tsx`, `OutputCard.module.css`, new `MetricPanel.tsx` | e2e new `expanded.spec.ts`: 4 runs on one row at 1440, metric click shows 4 cells aligned, toggle hides a column; Vitest `onlyDiffering` predicate; reduced-motion | 9 | T1 |
| T9 | Run focus linking (P2) | new `RunFocusContext.tsx`, `data-run` attributes across T3-T8 | e2e hover dims other runs; reduced-motion | 4 | T3-T8 |
| T10 | Docs and QA: DESIGN_LANGUAGE paragraph (run identity, 8 colours), update `qa/compare.md` mapping, a11y (axe) at 4 and 8 runs and cohort, perf (20 runs) | `docs/DESIGN_LANGUAGE.md`, `qa/compare.md`, e2e | `npm run check`, `pytest tests/platform/test_design_language.py`, `e2e/compare` full | 6 | last |

Total: 54 h (T1 4, T2 6, T3 6, T4 6, T5 3, T6 5, T7 5, T8 9, T9 4, T10 6). About 3 agents in parallel: after T1, {T2, T3, T4+T5} are independent (they touch different files); {T6, T7, T8} are independent of each other except for shared CSS in `ReportSections.module.css` (T6) and `ItemList`/`ItemDetail` (T7/T8 separate files); T9 and T10 last.

Risks:
- Many e2e specs assert sticky/chip/delta locations (`layout.spec`, `ux-layout.spec`, `selection.spec`, `scope-sidebar.spec`, `deeplink.spec`): T2 must rewrite helpers first; budget is in T2.
- `subgrid` for the aligned metric panel is supported in current Chromium, Firefox, Safari 16+; keep a same-min-width fallback.
- Run colours 6-8 reuse hues close to 1-3 (legacy did the same); the letter and name remain the unique key (a11y rule: colour never alone).
- `runShortName`: the seeded `run_name` equals a user-set name; in production many runs have auto names. Falls back to `label`, so no worse than today.
- The per-cell stack in `AveragesMatrix` is 76 px; at 20 runs the table is horizontal scroll only (pinned metric column).
- Cohort mode: the Compare tab keeps the one-line sides banner; the baseline Select must keep working in cohort (baseline is the cohort A side) - reuse `info.baseline` logic from `SelectionBar`.

## 7. Open questions (recommended default is implemented)

1. Run display name: legacy cards show `run_name`, matrices show the disambiguated label. Default: `RunTag` shows `run_name` (fallback `label`); tooltips and exports show the full label.
2. Winner emphasis in item rows (best score star) and the "Best" tag: not in legacy collapsed rows. Default: add it, unique best only.
3. "Biggest change vs baseline" sort: new. Default: add as a Display sort option (O2, can be dropped).
4. Categories default view: Cards (legacy) or Table (round 1). Default: Cards, Table via `catView=table`.
5. Move the delta pills out of the sticky bar into the Items section: they also act as the baseline switcher today. Default: yes, the baseline switcher is the sticky Select.
6. Run focus dimming across sections (P2). Default: implement, behind no flag.
7. More than 8 runs: colours repeat after 8. Default: yes, letter + name disambiguate.

## Summary for the orchestrator (10 lines)
1. Biggest gaps: run identity (letters instead of swatch + name, 5 colours cycling), expanded outputs that wrap instead of side by side with verdict-coloured borders, no aligned metric details across runs.
2. Visuals lost: category cards with baseline-tick bars, named winner legend, per-run error tables are now grey text tables and letter chips.
3. Chrome: 128 px (4 runs) to 200 px (8 runs) sticky block with clipped delta pills, versus legacy none; Averages is transposed and 420-800 px tall.
4. Plan: 10 tasks, 54 h total (T1 4, T2 6, T3 6, T4 6, T5 3, T6 5, T7 5, T8 9, T9 4, T10 6); after T1, T2/T3/T4+T5 are independent, then T6/T7/T8; T9, T10 last.
5. Keeps every capability and the round 1 structure (stacked report, nav, scope sidebar, DataTable matrix, Sweep).
6. Defaults: name = `run_name` with label fallback; best-score emphasis on; vs-baseline sort optional; Categories default Cards (`catView=table`); delta pills move to Items section with baseline Select in sticky bar.
7. Run focus dimming is implemented as P2 (T9) and can be cut without affecting the rest.
8. New tokens only `--chart-6..8`; new `ScoreBar marker`; no other primitive changes besides `DataTable` column `maxWidth`.
9. Biggest risk: e2e specs coupled to sticky chrome layout (rewrite in T2).
10. Evidence: screenshots in scratchpad `cmp2/shots/`; servers on 8875, 8876, 5876 stopped.

## Decisions

- Two runs of different models open in the sides layout (Compare/Sweep, no Baseline select, no remove): intended, it matches round 1 and the legacy auto-cohort. Run cards carry a "Side A/B" tag there.
- Run colours 6 to 8 keep the legacy hues (close to 1 to 3); letter and name disambiguate.

## Deferred

| Item | What is left | Why / estimate |
|---|---|---|
| T3 | The baseline column of the averages matrix has no `--bg-hover` fill (DataTable cells cannot be styled per column); the baseline is marked by the star in the header and the word "baseline" in each cell | Needs a per-column cell class in `DataTable`; 0.5 h |
| T7 | Hovered item cell tooltip keeps the existing `Run label: spoken value` title rather than `name . value (+delta vs baseline)` | Low value; 0.5 h |
