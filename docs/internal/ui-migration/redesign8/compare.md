# Round 8: the compare page, component by component against the legacy page

Design stage of the round-8 feedback cycle (`00-PLAYBOOK.md`, "Feedback rounds after the first build"). Measured 2026-10-26 on
the seed `frontend/scripts/seed-compare.ts` (4 aligned runs x 40 items with task and scorer errors, a 3-pass repeat run, a
10-item run; plus four extra aligned runs `e1..e4` from `redesign8/measure/seed-extra.mts` for the 8-run page) run against
**both** servers: legacy `qym-wt-legacy` (78141838) on 8980 and the React app (`UI-redesign` 445987a3, Vite dev server) on
5981. Chromium through Playwright at 1440x900, 1024 and 390, dark theme. All scripts are in `redesign8/measure/`, the
numbers they produced in `redesign8/measure/baseline/` (`legacy-<w>.json`, `current-<w>.json`, `mock-<w>.json`), the
screenshots in `redesign8/shots/` (`legacy-*`, `current-*`, `mock-*`). The composed mocks are at `/__ui#round8`
(`frontend/src/features/dev/Round8Mocks.tsx` + `.module.css`).

## 0. Reading guide, the owner's words, the fidelity assumption

> the runs compare page is not user friendly at all refer to the old design for better UX (make sure to analyze each
> component and it's design decisions and reflect them in the react app). (owner, 2026-10-26, the second time)

How to read: section 1 is the legacy page **component by component** (62 components, page order, measured at 1440 / 1024 /
390, with the design decision behind each); section 2 is the React equivalent of each with a verdict; section 3 is the
design (targets per width, primitives, numbered acceptance criteria `C-<component>-<n>` that name an element by its
`data-part` and give the width and the number); section 4 is what React keeps that legacy did not have; section 5 the tests;
section 6 the decisions taken alone and the questions for the owner; section 7 the hand-off. The composed page mocks are the
judging surface (`mock-page-compare-1440.png`, `-390`, `-8runs-1440`, `-expanded-1440`, `mock-page-sweep-1440`); where a
mock and a number in the text disagree, the number wins.

**Fidelity assumption (confirmed with the owner at the mock hand-back).** The legacy page is the reference UX and is
reproduced component by component: its layout, its density and its interactions, within the design language (tokens,
primitives, accessibility, names never truncated, no overlays on content). A React-only element survives only when it does not
change what the reader sees (section 4) or when a measurement shows the legacy choice fails at a real width. Round 2 kept
several React inventions over the legacy behaviour (the sticky block with selects, letter identities, the scope sidebar, a
histogram, a table-shaped item list); this round assumes the owner wants the legacy behaviour in each of those places and
changes them, with the measurement for each in section 2.

**What the measurements say about "not user friendly".** The React page already has every legacy section, so the problem is in
the details that decide whether the page reads. Measured on the current page (4 runs, 1440x900):

1. **A click moves the whole page.** Pressing a count button (`up 9`, `down 2`), a category card or an error card opens a
   330 px Quick-filters sidebar that squeezes every section from 1193 to 873 px, adds a "Scope: 26 of 40" bar and a gap above
   the Runs section, and leaves the reader at the top of the page, nowhere near the items it just filtered
   (`current-after-down-click-viewport.png`). Legacy applies the filter, scrolls the item list under the section head
   (`itemsTop` 501 px) and shows a one-line banner (`legacy-after-down-click.png`).
2. **Controls are away from what they control.** The metric select and the Baseline select live in a 44 px sticky bar at the top
   (`quality`, `Baseline A baseline-gpt-mini`, "40 of 40"); the data they change is screens below. Legacy puts the Baseline
   select in the Averages head and the metric tabs in the Overview head.
3. **Letters, and names that are cut.** Runs are `A`..`H`; table and item-list headers show `A BASELINE-GPT-...`,
   `D CAND-D-MINI-...` (uppercased and ellipsised, 8 runs); the legacy page names runs by swatch + name everywhere.
4. **The page is taller where it should be denser.** At 1440x900 the first screen ends inside the first Averages row
   (row 2 bottom at 910 px; the whole table is not visible); Averages rows are 101 px (legacy 70): a glyph strip and 36 px
   count pills were added. The item list has a "Changes vs baseline" strip (two wrapped rows of pills, about 85 px), a second chip row for active filters and a
   legend clipped at the right edge (`current-items-viewport-1440x900.png`).
5. **Flat item rows.** Legacy rows are cards with one coloured chip per run (swatch + coloured value) that read as a
   heat strip; React rows are a table with 300 px of empty space between the input and the first bar, bars that need their
   header to be decoded and a header that is clipped at 8 runs.
6. **The expanded item loses its alignment.** Cards are 214 / 238 / 214 / 214 px high (the card with a "Best" tag wraps its
   header), metric rows and detail rows start at different heights, and the header packs letter + name + tag + latency.

Everything below is built to remove these six, using the legacy page's own answers.

## 1. Legacy component inventory

Legacy numbers are `baseline/legacy-{1440,1024,390}.json` (`l1-legacy-inventory.mts`) and `l2`/`l3` scripts. Widths are the
legacy content column: 1208 at 1440, 792 at 1024, 306 at 390 (the legacy sidebar collapses to a rail at 390). Colours: the
legacy palette `COLORS` (8 run colours) maps onto `--chart-1..8`; good/bad is the 5-step score ramp. "Decision" is the design
decision behind the component, inferred from the CSS and the behaviour (the legacy source has no rationale text).

### 1.1 Header and mode

| ID | Component | Shows | Size / density | Colour logic | Interaction | Design decision |
|---|---|---|---|---|---|---|
| L01 | Title block `.compare-header-bar` (`legacy-title-block.png`, `-390`) | h1 "Compare Runs", one subtitle, Export HTML (accent button, right) | 1208x47 at 1440, 792x47 at 1024, 306x100 at 390 (the button drops under); h1 22/650 | Export is the only accent | Export downloads the standalone HTML | The page is a document: a title, one sentence, one action, nothing sticky |
| L02 | Mode tabs `#compare-mode-tabs` (`legacy-mode-tabs.png`) | Compare / Sweep segmented control, only when the URL has `cohortA`/`cohortB` | 121x24 | Active = accent fill | Switches the panel; URL-backed | The cohort mode is the same page with another body, not another page |
| L03 | Cohort banner `#compare-cohort-banner` (`legacy-cohort-banner.png`) | "COMPARE SIDES": two tiles "A / LEFT baseline-gpt-mini 2 runs", "B / RIGHT cand-b-small 2 runs" | 1208x~70, tiles 2 columns | Neutral | None (labels fixed) | Says which runs are the left and the right side before any number |
| L04 | Notices (`#alignment-warning`, read-only / dataset-version notices) | One-line explanatory banners | full width, ~38 | warning border | None | Caveats sit above the data they qualify, once |

### 1.2 Runs

| ID | Component | Shows | Size / density | Colour logic | Interaction | Design decision |
|---|---|---|---|---|---|---|
| L05 | Run grid `.compare-summary` (`legacy-page-1440.png`) | One card per run, always visible | 3 per row at 1440 (card 393x241), 2 per row at 1024 (389), 1 at 390 (306x345); 4 runs = 496 px, 8 runs = 3 rows | Left/top border in the run colour | None | A comparison starts by saying what is compared; every run is shown in full, never behind a button |
| L06 | Run card `.compare-run-card` (`legacy-run-card.png`, `-390`) | swatch + run name (mono bold) + status badge + remove X; stat strip; meta grid | 393x241, padding 14/16, radius 10, 1 px border | Border = run colour; status badge green | none on the card itself | One box per run: identity, health, configuration, in that order |
| L07 | Stat strip `.compare-run-summary-strip` (`legacy-run-stat-strip.png`) | Items 40, Completed 40, Errors 3, each with an icon | 359x34, 3 pills 76x34 / 73x34 | Errors pill red when > 0 | none | Health of the run in one line, before its config |
| L08 | Meta grid `.compare-run-meta-grid` | TASK, DATASET (identicon + name), MODEL (label with reasoning marker), OWNER, STARTED, RUNTIME | 359x126, 2 columns x 3 rows of 36 px items; label 10/600 uppercase, value 12 | neutral | none | Configuration as a label/value grid so two cards align row by row |
| L09 | Remove X `.compare-run-remove` | 24x24 icon button, top right | 24x24 at every width | red on hover | Removes the run from the URL; hidden at 2 runs | Narrowing the comparison is one click in place |
| L10 | Baseline select `.metrics-baseline-control` (`legacy-baseline-select.png`) | "Baseline" label + select of the runs by long label | 242x24 in the Averages head, right | none | Changes the baseline for every delta, count, category tick | The baseline is chosen where its effect (the deltas) is first seen |
| L11 | Pass toggle `.metrics-table-controls` (repeat runs, `legacy-averages-repeat.png`) | "Run average | Each pass" segmented | 24 high, next to the baseline select | none | Switches the Averages columns between the run mean and its passes | A repeat run is one column or N columns, chosen at the table |

### 1.3 Per-run averages

| ID | Component | Shows | Size / density | Colour logic | Interaction | Design decision |
|---|---|---|---|---|---|---|
| L12 | Averages table `.metrics-table` (`legacy-averages-table.png`, `-390`) | Rows = metrics (correct, quality, Avg Latency), columns = runs | 1208x211 at 4 runs (header 38, rows 70, 70, 40); 4 columns of 310; at 1024 columns 220 and the table scrolls sideways; at 390 only the first column is visible | Panel border + radius 8 | horizontal scroll | One metric is one horizontal scan: the eye compares runs along a row, which is the comparison |
| L13 | Column head `.metric-run-heading` | swatch + long label ("gpt-5-mini · Oct 1 03:00 PM #1") + a "Baseline" tag on the baseline column | 310x20, 10/600 | swatch = run colour | none | The column names its run by colour and label; the baseline is marked where it is read |
| L14 | Baseline cell | the value only, score-coloured, centred | 330x70 | score ramp text | none | The baseline has nothing to be compared with: just the number |
| L15 | Value box `.metric-val` (`legacy-averages-value.png`) | `37.5%` mono 12/600 | 52x20, radius 5; **1 px outline (green up, red down) only when the change is beyond the 95 % noise band** | text = score band; outline = verdict | none | A boxed value says "this difference is real"; an unboxed one is noise: the verdict is the shape, not an extra word |
| L16 | Delta line `.metric-delta-line` | `+17.5 pts +-15.5` | 184x15, mono 11 | green / red text beyond noise, muted within | none | The size of the change and its uncertainty, in the unit of the metric |
| L17 | Count buttons `.metric-delta-counts` | `up 9  down 2` | two buttons 21x20, row 20 high | up green, down red on hover | Click filters the items to "improved/regressed vs baseline on this metric", **scrolls the item list under the section head (itemsTop 501 px)** and shows the banner L34 | Averages say "better on average"; the count buttons answer "which items" in one click |
| L18 | Latency / trace rows | `Avg Latency 1.3s` boxed when beyond noise; trace metric rows | row 40 | boxed = verdict | none | Non-score metrics follow the same cell grammar |

### 1.4 Overview

| ID | Component | Shows | Size / density | Colour logic | Interaction | Design decision |
|---|---|---|---|---|---|---|
| L19 | Overview head `.comparison-overview-heading` | h3 + one line left; **controls right: Pass-if slider + metric tabs** | 1208x40; at 390 the controls drop under (129) | none | none | The two inputs that change the numbers below sit in the section head, small |
| L20 | Metric tabs `#overview-metric-tabs` (`legacy-metric-tabs.png`) | correct / quality segmented | 121x24, options 57x18 | active accent | Sets the analysis metric (overview, categories) | One metric at a time, chosen by name, not from a dropdown of everything |
| L21 | Pass slider `.threshold-control` (`legacy-pass-slider.png`) | "Pass if >= [----o--] 80%" | 234x15, track 128x4 | accent thumb | Changes the pass threshold of the selected metric | A threshold is a small control, not a row |
| L22 | Stat boxes `.stat-box` (`legacy-stats-grid.png`) | Pass@4, Pass^4, Max@4, Consistency, Reliability, Avg Score, Avg Latency, Errors, each with a help marker | one row at 1440: 1166x75, boxes 145x73, padding 14/16; 2 rows at 1024 (149), 4 rows at 390 (297); value mono 15 bold | **value coloured by the score ramp** (red, orange, yellow), Errors red | help marker tooltip | Eight facts side by side in one frame; colour ranks them at a glance |
| L23 | Winner bar `.win-loss-bar` (`legacy-winner-bar.png`) | One segment per run, width = wins, run colour, count inside; Ties grey | 1138x28, radius 4 | run colour | Click a segment filters items to "won by this run" | Who wins how often as one proportional bar, in the colours the page already uses for runs |
| L24 | Winner legend `.win-loss-legend` (`legacy-winner-legend.png`) | swatch + run name + count for every run + Ties | 1138x18 (4 runs), 236x70 at 390 | swatch = run colour | none | The bar is decoded by names, not by letters |
| L25 | Correct distribution `.distribution-bar` (`legacy-distribution-bar.png`) | One segmented bar: items where 0, 1, 2, 3 of 4 runs were correct, count + k in each segment | 1138x32 | score-ramp red to green by k | Click filters items by pass rate | A distribution of "how many runs solved it" is a 100 % bar: no axis, no height |

### 1.5 Categories, steps, errors, root cause

| ID | Component | Shows | Size / density | Colour logic | Interaction | Design decision |
|---|---|---|---|---|---|---|
| L26 | Category chip bar `.category-chip-bar` (`legacy-category-chip-bar.png`) | "CATEGORIES" + one chip per metadata key with its value count (complexity 3, domain 4) | 1208x26, chips 89x26 | selected = accent | Toggles the key's cards on/off | Which breakdowns to show is chosen by key |
| L27 | Category card `.breakdown-card` (`legacy-category-card.png`) | value title (easy) + a header row RUN / AVERAGE / LATENCY / CHANGE + one row per run | 412x219 at 4 runs, **3 cards per row at 1440**, 2 at 1024, 1 at 390 (264x219); padding 10/12, radius 10 | left border 3 px = value colour (easy green, medium yellow, hard red) | Click filters items to the value | One card is one slice; the card is the unit of comparison |
| L28 | Category run row `.cmp-run-lines` + `.cmp-run-track` (`legacy-category-run-line.png`) | swatch + run name, average (score-coloured), latency, change vs baseline; **a bar under it with a baseline tick** | row 17 + bar 8 = 29 px, bar 384 wide | bar fill = score band, tick = baseline value | none | Bar plus tick shows who beat the baseline without reading numbers |
| L29 | Step latency panel `#step-latency-panel` | pooled step latency per run (traced runs only) | table | run colours | none | Only for traced runs; same grammar as the averages table. Not reproducible with the seed (no spans); recorded from source |
| L30 | Error group `.task-error-group` (`legacy-error-group` removed, see `legacy-page-1440.png`) | "Task Errors 6" and "Metric Errors 3" groups with an icon | 1166x181 | red / purple icon | none | Two kinds of failure, never mixed |
| L31 | Error card `.error-card` (`legacy-error-card.png`) | message title (TimeoutError), "6 ERRORS", detail line, **a per-run table: swatch, name, count, delta vs baseline (Baseline, -1, +1)**, zeros included | 300x154 (4 runs), 3 per row | left border 3 px red (task) / metric colour | Click filters items to this error | Same message, every run, side by side: the run with no errors is shown too |
| L32 | Root cause cards `#root-cause-section` | one card per root-cause category with count and sub-causes | cards | category colour | click filters; "Edit issues" per output | Only present when the analyzer produced issues. Not reproducible with the seed; recorded from source |

### 1.6 Items

| ID | Component | Shows | Size / density | Colour logic | Interaction | Design decision |
|---|---|---|---|---|---|---|
| L33 | Items head `.qym-item-section-head` | h3 + one line; Auto-Analyze button (when an analysis exists) | 1178x40 | purple button | opens the analyzer | The list is introduced like every section |
| L34 | Baseline-delta banner `#baseline-delta-banner` (`legacy-after-down-click.png`) | "Showing items where **claude-sonnet-4 . Oct 1** regressed on **correct** against the baseline **gpt-5-mini**." + Clear | 1178x42, left accent bar | accent | Clear removes the filter | A filter that came from a click upstream explains itself where its result is |
| L35 | Items toolbar `.qym-item-toolbar` (`legacy-items-toolbar.png`, `-390`) | **one row**: search (grows), Filters, Clear (when active), "40 of 40 items", Display, CSV | 1178x24 at 1440; 762x24 at 1024; 276x84 at 390 (wraps to 3 rows) | CSV accent | see below | Everything about the list in one 24 px strip; not sticky |
| L36 | Search `.qym-search` | placeholder "Search inputs / outputs / expected..." | 742x24 at 1440, 326 at 1024, 173 at 390; 11/400 | none | filters as you type | The widest control is the most used |
| L37 | Filters button + builder `#btn-item-filters`, `#item-filter-builder` (`legacy-items-filters-open.png`) | Button with a count badge; opens **an inline panel** (1178x128, pushes the list down) "FILTERS no rules yet - AND/OR - every rule below must match - + Condition + Group" | button 99x24, panel 128 | badge accent | Rules by field: Show (outcome), Winner, Pass rate, categories, Approval | Filtering is rules, in one place; the panel is part of the page, not over it |
| L38 | Clear + count `#clear-all-btn`, `.qym-item-count` | red "Clear 1" appears only when filters are active; "2 of 40 items" mono 11 | 100x24 | red / muted | Clear removes everything | The state of the list is always readable and always resettable |
| L39 | Display popover `#btn-item-display` (`legacy-items-display-popover.png`) | "Display . Correct" opens 300x300: Analysis metric select; View: Sort (Index, Score up/down, Latency up/down), Text Raw/Rendered; Columns: item fields, metric fields | button 152x24; popover 300 | none | Escape closes | Rare view settings live behind one button; the current metric stays in its label |
| L40 | CSV `#export-filtered-btn` | accent text button | 69x24 | accent | Downloads the filtered items | The filtered view is exportable where it is |
| L41 | Item row `.item-comparison-row` (`legacy-item-row.png`, `-390`) | A rounded card: chevron, `#1`, question, chips right-aligned | **1178x54 at 1440, pitch about 62 (gap 8), 20 per page; 762x54 at 1024; 276x63 at 390 (chips on a second line)**; padding 13/16, radius 8, 1 px border | border red when any run errored | click or Enter toggles; hover = row bg | The list is a stack of cards because each item is also an expandable document; the right edge is a heat strip of the runs |
| L42 | Chevron / index / title | chevron 26x26, `#1` mono 13/600 muted, title 12/600 secondary, one line | title 802x17 at 1440 | none | the whole header toggles | Identity of the item first, then the verdict |
| L43 | Score chip `.item-agg-pill` (`legacy-item-score-chip.png`) | **swatch (8) inside the chip + value**, e.g. `[o] 50.1%`; `True/False` for booleans | **63x19, padding 2/8, radius 5**, mono 12/600; 4 chips = 276 wide | value coloured by the score ramp; chip tint = ramp at low alpha | `title` = run + value | The swatch inside the chip makes every chip self-describing: no column header is needed |
| L44 | Error chip / row `.item-execution-error` | red outlined chip with an x-circle for a task error; the row border turns red | chip 28x20 | red | `title` explains | A failed run is a different shape, not a number that is missing |
| L45 | Expanded item (`legacy-item-expanded.png`, `-details`) | header "#1 ... 4 runs"; **INPUT block (accent left bar, label, copy), EXPECTED OUTPUT block (green), metadata tags**; then OUTPUT | block widths 1148 (full), INPUT 66, EXPECTED 65, tags 32 | blue / green bars | copy buttons | The question and the reference answer are read before the outputs, at full width |
| L46 | Output toggles `.qym-output-toggles` | "OUTPUT" + one toggle per run (swatch + long label), `aria-pressed` | 24 high, 124 to 186 wide | swatch + outline = run colour | Hides / shows that run's column | Focus on the runs that matter without leaving the item |
| L47 | Output grid + card `.qym-output-grid`, `.item-run-output` | One card per visible run in **one row**: `repeat(n, minmax(320px, 1fr))`, horizontal scroll beyond the width | card 320x278, **4 cards = 1320 px in a 1148 px grid: the 4th is cut off at 1440** (`legacy-item-expanded.png`); at 390 the same 320 px cards scroll sideways | **3 px left border = run colour** (red only for a task error) | scroll | The side-by-side comparison is the product: the runs stay in one row, so a difference is a vertical line |
| L48 | Card header (name, Pass/Fail tag, latency, Trace, copy) | swatch + short name (**cut with an ellipsis: `baseline-g...`**), link icon, `Pass`/`Fail` tag, clock + `1.4s`, Trace button 75x24, copy 24x24 | header 41 | tag green/red | Trace opens the drawer | The state of the run on this item in one line |
| L49 | Metric details row `.metric-det-zone` | Each metric as a collapsed row (caret, name, value, edit pencil), 301x34; **clicking one metric opens that metric's REASON block under every run at once** (`legacy-item-expanded-details.png`) | 317x89 zone, REASON block 56 | value ramp | caret toggles all runs | The reasons are compared across runs, not read one run at a time |
| L50 | Root-cause issues row + Issues editor (`.rc-sol-row`, `.compare-issues-editor`) | "ROOT-CAUSE ISSUES . QUALITY - No root-cause issues assigned - Edit issues"; the editor is a dialog (header, one row per issue with category, sub-category, confidence, finding, footer Save) | 317x104 | none | Edit issues opens the dialog | Review happens where the output is |
| L51 | Pagination `.qym-pagination` (`legacy-pagination.png`) | "1-20 of 40 items", first/prev, page input, "of 2", next/last | 1178x24, buttons 24x24 | none | | 20 per page keeps the page finite; no virtualization needed |
| L52 | Item comparison modal `#item-comparison-modal-overlay` | "Item Comparison . cmp-007": the expanded item recipe in a dialog; opened from the Sweep item table | dialog | as L45-L50 | focus trap, Escape | One item component, two places |
| L53 | Export columns modal `renderExportModal` | choose the columns for the HTML export | dialog | none | | Export is configured, not guessed |

### 1.7 Sweep (cohort) panel (`legacy-sweep-page-1440.png`, crops `legacy-sweep-*.png`)

| ID | Component | Shows | Size / density | Colour logic | Interaction | Design decision |
|---|---|---|---|---|---|---|
| L54 | Verdict `.sweep-verdict` (`legacy-sweep-verdict.png`) | badge REGRESSED, "Avg@2 -9.1% - beyond noise", sub line "quality . noise +-6.8% at 95% . p = 0.009 . 40 paired items ..." | 1208x67, **3 px bottom edge in the verdict colour** | red / green / neutral | none | The answer first, in words, with its evidence |
| L55 | Filter bar `.sweep-filter-bar` (`legacy-sweep-filters.png`) | MOVE, OUTCOME, SEARCH, METADATA, VALUES selects + "Exclusive only" | 1208x80, fields 128x24 | none | filters every table below | One filter bar for the page |
| L56 | Stat cards `.sweep-stat-card` (`legacy-sweep-stat-cards.png`) | Pass@2, Avg@2, Consistency, Reliability, Pass^2: `42.5% -> 35.0%`, delta pill `-7.5%`, `noise +-12.3` with a help marker | 5 cells of 240x105 in one frame, **3 px bottom edge: orange when beyond noise** | pill red/green/neutral | help tooltip | Before -> after, change and noise in one cell |
| L57 | Metadata breakdown `.sweep-metadata-table` (`legacy-sweep-metadata-table.png`) | "Cohort metrics by domain": rows commerce, finance...; columns N, Pass@2, Avg@2, ... each `40% -> 30%` + delta pill; sortable headers | 1206x149, rows 31 | pill colours | sort | The same stats sliced by metadata |
| L58 | Outcome cards `.sweep-outcome-card` (`legacy-sweep-outcome-cards.png`) | 40 Total, 3 Improved, 10 Regressed, 27 Unchanged, 0 Decisively fixed, 1 Decisively broken, 0.00 Avg delta attempts / item | 7 cards 164x68, value 18 mono bold | green / red / neutral values | click filters the table | The distribution of moves as counters |
| L59 | Sweep item table `.sweep-table` (`legacy-sweep-item-row.png`) | item id (mono), metadata badges (domain blue, complexity coloured), **pass dots per cohort (13 px circles filled green/outlined red) + `1/2`**, MOVE pill (+1, 0, -1) | rows 34 | green / red | click row opens L52 | Every attempt is a dot: k of n at a glance |

### 1.8 States

| ID | Component | Shows | Design decision |
|---|---|---|---|
| L60 | Loading | A centred spinner and "Loading comparison..." until every run snapshot arrived | One wait, one message |
| L61 | Empty (fewer than 2 runs) | "Select at least 2 runs from the dashboard to compare." + Back to Dashboard (`legacy-state-single-run.png`) | Says what to do |
| L62 | Error (runs deleted or not visible) | "2 runs in this link were deleted or are not visible to you. A comparison needs at least 2 runs. Missing: <ids>" + Back (`legacy-state-error.png`) | Names the cause and the missing ids |

Legacy reading summary: 62 components; one document, no sticky element, one baseline select, one metric tab pair, every run named
by swatch + name, every number on a heat-ramp, every click on a number filters the list and tells you so.

## 2. The React equivalent of each component (current page, `UI-redesign` 445987a3)

Numbers are `baseline/current-{1440,1024,390}.json` (`r1-react-inventory.mts`), content column 1193 / 777 / 279. Verdict:
**same**, **degraded** (how, by which number), **missing**, **React-only**. Screenshots `current-*.png`.

| ID | React equivalent | Measured | Verdict |
|---|---|---|---|
| L01 | `PageHeader` "Compare runs" + subtitle + a third line "4 columns . cmp-qa-v1 . 40 aligned items" + Export HTML | header block 3 lines; Export at the top right | same, plus a meta line (kept, section 4) |
| L02 | Segmented control inside the header actions (cohort only) | right of the title | same |
| L03 | `CohortBanner` in the sticky block: "Compare sides  A baseline-gpt-mini [pencil] 2 executions  vs  B cand-b-small ... k = 2 executions each" (`current-cohort-page-1440.png`) | one line 52 high; inline label edit | same + React-only rename (kept) |
| L04 | `Notices` | one line | same |
| L05 | `RunCards` in `[data-testid=run-details]`: 4-up at 1440 for 4 runs, **a "Run details" button hides the cards above 4 runs** at the time of round 2; today 8 runs show **compact 65 px cards without the stat strip** (`current-page-8runs-1440.png`) | 1193x248 at 4 runs; 3 compact rows at 8 runs | **degraded**: 8 runs lose the strip and the meta |
| L06 | `RunCard`: title "A baseline-gpt-mini *" (letter, name, **baseline star**), status badge on its own line, star and X top right | card 292x248 | **degraded**: letter + star are new identity chrome; status on its own line costs 30 px |
| L07 | Strip of three tiles Items / Completed / Errors | tiles 80x41; **Completed 38 where legacy shows 40** (React = items with an output; legacy = processed items) | same layout; semantics differ (decision D6) |
| L08 | Key/value list Task, Model, Owner, Dataset, Runtime | 5 rows x 24; **no Started** | **degraded**: Started missing |
| L09 | X icon | 24x24 | same |
| L10 | Baseline select in the **sticky bar**, 190 px, next to the metric select | in the 44 px bar, far from the table | **degraded**: control away from its data |
| L11 | `PassToggle` in the sticky bar | in the bar | **degraded** (same reason) |
| L12 | `AveragesMatrix` (DataTable, metrics as rows) | table 1193x342 (legacy 211), rows **101** (legacy 70) | **degraded**: +44 % row height |
| L13 | Column head "A BASELINE-GPT-MINI *" **uppercased, letter, star; ellipsis at 8 runs** (`D CAND-D-MINI-...`) | 250 wide | **degraded**: names cut (rule 7), letters |
| L14 | Baseline cell: value + the word "baseline" | 84 high | same + 1 line |
| L15 | Value as a tinted pill (red/orange fill), **no verdict outline**; the verdict is a separate green/red tag below | 76x22 pill | **degraded**: two shapes for one fact |
| L16 | Tag `up +17.5 pts` + `+-16.0` + **a dot-plot glyph** (12 px) | 3 elements, 36 + 12 px | **degraded**: the glyph restates the tag |
| L17 | Two count **pills** `up 9`, `down 2` | 36x28 pills, row of 28 | **degraded** (+8 px per row); click opens the sidebar (below) |
| L18 | Latency and Errors rows | 2 rows of 60 | same |
| L19 | `ReportSection` aside: Pass-if slider only; the metric select is in the sticky bar | slider 8 rem right | **degraded**: metric control away |
| L20 | **none** (select in the sticky bar, 190x24) | | **missing** |
| L21 | `Slider` 8 rem with label "Pass if >=" and 70% | 8 rem x 24 | same |
| L22 | `StatTiles`: 8 tiles, value 26 px colour-ramped | grid 1193x76; boxes 145x74 | same |
| L23 | Winner bar with **letters inside** ("B 24") | 28 high | **degraded**: letters, no run colour fill text |
| L24 | Legend "A baseline-gpt-mini 5 B cand-a-sonnet 24 ..." small | 18 | same (letters) |
| L25 | **A 9-bucket histogram of columns (about 70 px)** with counts under (`current-overview.png`) | ~95 high | **degraded**: legacy is one 32 px bar (D4) |
| L26 | Chip row "complexity 3, domain 4" | 26 | same |
| L27 | `CategoryCards`, **2 per row** at 1193 (592x201); no column header | `current-categories.png` | **degraded**: 2-up (legacy 3-up), no column header |
| L28 | Row = name + bar + tick + number + pill `+18.1 pts +-20.2` | row 30.8 | same + noise pill (kept) |
| L29, L32 | `StepsTab`, `RootCauseTab` | not in the seed | not compared in the browser (no spans, no analyses in the seed); structure read from source: same grammar. Criteria C-step-1, C-rc-1 need a traced / analysed seed in the implementation tests |
| L30 | "Task errors 6" "Metric errors 3" headings | | same |
| L31 | Error card with per-run table and mini bars; **runs with no errors collapsed into "4 runs with none" at 8 runs** | 416x152 | **degraded**: hides zeros the reader wants (D7) |
| L33 | Items head | | same; Auto-Analyze moved into an "Analyze" popover in the toolbar |
| L34 | none; **a "Changes vs baseline" strip (about 85 px, pills with `up/down` counts) is always on** and **a chips row** appears when filters are active (`current-items-viewport-1440x900.png`) | | **React-only + degraded**: duplicates L17, about 85 px |
| L35 | Toolbar 28 high, **sticky** (`data-compare-toolbar`), plus a legend "a run regressed vs baseline / error" **clipped at the right** | 1193x28 | **degraded** |
| L36-L40 | Search, Filters (badge), Display, CSV, Analyze buttons; Display has Sort, Text mode, field switches; **no metric select in Display** | | same except missing metric (it is in the sticky bar) |
| L37 | Filter builder opens inline (1193x109) **and** a Quick-filters sidebar exists (330 px) with the same facets | | **React-only**: two places for one job |
| L41 | `ItemList`: DataTable rows 52, no gap, 3 px left rail (yellow regressed / red error), columns # , Input (flex), one column per run | row 1191x52; 20 rows 1116 | **degraded**: table, rail without legend meaning, 300 px dead space |
| L42 | `#` and two-line clamped input | | same text, different geometry |
| L43 | Cell = ScoreBar (60 px) + number + glyph (up/down/star) | no swatch in the cell | **degraded**: needs the header (which is clipped at 8 runs) |
| L44 | Error chip | red chip in the cell; rail red | same intent, no row outline |
| L45 | Input and Expected **side by side** (582 each), tags | `current-item-expanded.png` | **degraded**: changes the reading order |
| L46 | Chips "A baseline-gpt-mini" + All + Only differing | | same + All/Only differing (kept) |
| L47 | grid `repeat(auto-fill, minmax(280px,1fr))`, 4 cards of 280, **cards 214 / 238 / 214 / 214 high, tops 644 each** | no horizontal scroll at 4 runs; wraps at 5+ | **degraded**: unequal heights, wraps to a second row (breaks "a difference is a vertical line") |
| L48 | Header: swatch, "A baseline-gpt-mini", FAIL tag, latency, copy; "Best" tag wraps the header of one card | header 41 or 65 | **degraded**: header height varies |
| L49 | Click on a metric chip opens details for that metric under every card (round 2) | `current-item-expanded-details.png` | same (check aligned: C-exp-4) |
| L50 | Root-cause row "Add issue" + `IssueDialog` | | same |
| L51 | `Pagination` + virtualization | | same |
| L52, L53 | Sweep modal and CSV dialog exist | | same |
| L54-L59 | `SweepView`: verdict, filters, cohort metrics, domain table, outcome cards, item table (`current-sweep-page-1440.png`) | | **degraded**: pass cells are check / cross glyphs without `k/n`; stat cards without the 3 px verdict edge; metadata badges neutral; outcome cards lack colour |
| L60-L62 | Skeleton page; `EmptyState` "No runs to compare"; `ErrorState` "Runs in this comparison were not found" with HTTP 404 | | same (better wording) |

Totals (approximate, sub-components counted with their parent): of 62 components about 20 are **same**, about 28 **degraded**, 1 **missing** (metric tabs), 3 **React-only**, 2 not compared in the browser (the rest are
sub-components counted with their parent). The sticky 44 px block (L10, L11, L19, L20 plus the nav) is the single biggest
cause of "controls far from data".

## 3. Design

### 3.1 Principles (all from the legacy page)

1. A run is its **swatch, a letter badge and its name**, everywhere (cards, columns, legend, rows, cards). **Owner decision H1 (amended):** the letters A to H stay; the letter badge is 16x16, mono `--font-xs`, in the run colour's text on a faint tint of it, and it never replaces the name (the name is always visible and never truncated). The Baseline tag stays; the star goes.
2. **A control sits in the head of the section it changes** (baseline: Averages; metric and pass threshold: Overview).
3. **A click on a number filters the list and says so**: scroll to the list head, banner, Filters count. Nothing moves
   sideways. **Owner decision H2 (amended):** the Quick-filters sidebar is NOT removed: it is a facet list opened from a "Quick filters" button in the items toolbar, closed by default, never opened by a click or a search, and it sits beside the items list only (the sections above keep their full width; the item cards narrow). Below 1200 px it is a drawer. The "Changes vs baseline" strip and the Scope bar still go.
4. **One component, one shape** for one fact (verdict = the box outline; improved/regressed = a count button).
5. **Rows are cards with self-describing chips**; the expanded item keeps the runs in one aligned row.
6. Fix, not copy, the legacy faults: names wrap (never an ellipsis); no sideways scroll at 390; the 4th output card is not cut off.

### 3.2 Page structure (default state, 4 runs, 1440; `mock-page-compare-1440.png`)

Header (70) - **section nav (36, sticky, links only)** - Runs (cards, 239) - Per-run averages (head with Baseline select,
table 283) - Comparison overview (head with slider + metric tabs; 8 stat boxes 76; winner bar + legend; distribution bar) -
Performance by category (chip bar in the head; 3-up cards) - Error distribution (cards with per-run tables) - Item-by-item
(head, toolbar 24, run key, 20 cards, pagination). Cohort mode adds the mode tabs and the Compare-sides banner under the
header; its body is the Sweep page (`mock-page-sweep-1440.png`).

At 1440x900 the first screen (shell top = window top, `m3-first-screen.mts`) shows: header, nav (bottom 191), **all four run
cards (bottom 522) and the whole Averages table (bottom 897)**. Current page: row 2 of Averages ends at 910 and the table at 1015.

### 3.3 Per width

| | 1440 (column 1193) | 1024 (777) | 390 (279) |
|---|---|---|---|
| Run cards | 4-up, 287x239 | 2-up, 380x226 | 1-up, 277x244 |
| Averages | metrics = rows, runs = columns, 261 per column (4 runs); 8 runs 130 and no scroll | 4 runs fit (157 per column); 8 runs scroll with the metric column pinned | one block per metric, one line per run (cell 44 high), no sideways scroll |
| Stat boxes | one row of 8 (76) | 2 rows of 4 (151) | 4 rows of 2 (301) |
| Categories | 3-up cards 388x179 | 2-up 380x179 | 1-up, name on its own line |
| Errors | cards 287 wide, 4-up | 2-up | 1-up |
| Items | one 24 px toolbar row; row 54, pitch 60; chips on the right | toolbar 2 rows (<= 56); chips on the right | toolbar <= 90; row <= 76 with chips under the title |
| Expanded grid | 4 columns of 284, no scroll; 5+ scroll with snap | 2.6 columns visible, scroll | 1 column stacked, no scroll |

### 3.4 Primitives and tokens

Existing primitives (`frontend/src/ui`): `SectionHeader`/`ReportSection` (head + aside), `SegmentedControl` (metric tabs, pass
toggle, mode tabs, Match AND/OR), `Select` (baseline, metric when more than 4), `Slider`, `SearchField`, `Button`, `Popover`
(Display), `Pagination`, `Tag`, `Badge`, `StatTiles`, `Dialog`/`FormDialog` (issues editor, CSV), `Drawer` (trace),
`EmptyState`/`ErrorState`/`Skeleton`. **New primitive: `RunName`** (swatch 8x8 in `--chart-n`, name that wraps, optional
Baseline tag; `data-part=run-name`), because the same atom is needed in 12 places and `RunTag` (letter + star) is the thing being
removed. No other new primitive: the rest is recipes in `Round8Mocks.module.css`:
`.runCard`, `.avg` (table + 390 block layout), `.valueBox`, `.delta`, `.counts`, `.statGrid`, `.winBar`, `.distBar`,
`.catCard`/`.catRow`/`.track`/`.tick`, `.errCard`, `.itemRow`/`.scoreChip`/`.runKey`, `.outGrid` (grid with `subgrid`
rows), `.metricRow`, `.reason`, `.verdict`, `.sweepStat`, `.passDot`. Tokens only: run colour `--chart-1..8` by run index (the 8
colours are the hue budget; more than 8 runs reuse by index and the name is always beside the swatch), good/bad `--score-1..5`,
`--success`, `--error-text`, `--info`, spacing `--space-*`, radii `--control-radius` (5) / 8 (card row, `--radius-md` for
panels). Type roles: section title `--font-xl`, card title `--font-md`, cell text `--font-base`, labels `--font-sm`, badges `--font-xs`; mono only for
values (scores, counts, ids, latency), sans for names and prose.

### 3.5 Acceptance criteria

Element = `data-part` (the implementer adds the attribute to the real component; the mock already has them). Numbers from
`baseline/mock-{1440,1024,390}.json`; tolerance +-2 px unless stated. "Current" is the measured value of today's page.

**Page**

| ID | Criterion |
|---|---|
| C-page-1 | 1440x900, scroll 0: `[data-part=run-card]` bottom <= 530 and `[data-part=averages-table]` bottom <= 900 (mock 522 / 897; current 545 / 1015). |
| C-page-2 | Exactly 1 sticky element outside table pins (`[data-part=section-nav]`); its height 36 (current sticky block 44 and 72 at 390). |
| C-page-3 | No horizontal document scroll at 1440, 1024, 390 (`scrollWidth <= clientWidth`), except inside `[data-part=averages-table]` (8 runs at 1024) and `[data-part=output-grid]` (5+ runs). |
| C-page-4 | 0 elements with `text-overflow: ellipsis` among `[data-part=run-name]`, `averages-colhead`, `category-run-row`, `output-toggle`; `scrollWidth <= clientWidth` for each. |
| C-page-5 | Section heights, 4 runs, 1440: runs 311, averages 355, overview 393, categories 285 (one key), errors 440, items 1375 (+-6). 1024: runs 539, averages 376, overview 468. 390: averages <= 1200, items <= 1820. |
| C-page-6 | 8 runs at 1440: runs 551 (2 rows), averages 366 with `scrollWidth <= clientWidth`, overview 393, categories 409, errors 620, items 1375; every component keeps its 4-run recipe (no compact variant, no "Run details" button). |
| C-page-7 | Section order: Runs, Averages, Overview, Categories, [Steps], Errors, [Root cause], Items; one description line per section head (no duplicate subtitles). |

**Nav** `[data-part=section-nav]`

| ID | Criterion |
|---|---|
| C-nav-1 | 36 high, `position: sticky; top: 0`, links Runs, Averages, Overview, Categories, [Steps], Errors, [Root cause], Items + count; contains 0 selects, sliders or buttons other than links. |
| C-nav-2 | Click scrolls so the section top is at nav bottom + 12 (+-4); the active link follows the scroll (`aria-current`). Keyboard: Tab, Enter. |
| C-nav-3 | At 390 it scrolls sideways inside itself, height 36, no wrap. |

**Title, mode, cohort, notices** (L01-L04)

| ID | Criterion |
|---|---|
| C-title-1 | `[data-part=title-block]` 1440: height 70 +-4, title 22/650, subtitle and meta lines 11 muted; Export HTML on the title row (`|dy| <= 4`). 390: block <= 140, button wraps under. |
| C-title-2 | Mode tabs (Compare | Sweep) only with cohort params, `SegmentedControl` 24 high right of the Export button; switching keeps the URL params. |
| C-cohort-1 | `[data-part=cohort-banner]`: label "Compare sides" + two tiles (tag `A / left`, name, `N runs`, rename pencil); 2 columns at >= 1024 (tile >= 256), 1 column at 390; banner height at 1440 <= 95. |
| C-notice-1 | Dataset-version / alignment / read-only notices: one line each (<= 40 high) between the header and the nav, never inside a section. |

**Runs** (L05-L11)

| ID | Criterion |
|---|---|
| C-run-1 | `[data-part=run-grid]` columns: 1440 4-up (card 287 +-3), 1024 2-up (380 +-3), 390 1-up (277 +-2). Card height 1440 = 239 +-4 for **any** run count (8 runs: 2 rows, grid 478 +-8). |
| C-run-2 | Card head: `RunName` (swatch 8x8 = run colour, **letter badge 16x16 mono `--font-xs` in the run colour's text (owner decision H1)**, name 13/650 wraps, 0 px clipped), `Baseline` tag on the baseline run, status badge (`--font-xs`, 20 high), remove X 24x24; X absent at 2 runs; no star. |
| C-run-3 | `[data-part=run-stat-strip]` 3 cells x 36 high (Items, Completed, Errors, value mono 13/650); Errors > 0 uses `--error-text`. |
| C-run-4 | `[data-part=run-meta]` 6 rows of 20 (Task, Model, Owner, Dataset, Started, Runtime; repeat runs: Samples) = 120 +-2; long values wrap. |
| C-run-5 | Left border 3 px in the run colour; the colour equals the swatch in every other component (computed colour of `RunName` swatch of the same run, all sections). |
| C-run-6 | X removes the run: URL `runs` loses it, the page recomputes, focus moves to the next card's X; Enter/Space work; accessible name "Remove <name> from the comparison". |

**Averages** (L10-L18)

| ID | Criterion |
|---|---|
| C-avg-1 | Section head: title + one description line; aside = Baseline select (`Select`, label "Baseline", 14 rem x 24) and, with a repeat run selected, `SegmentedControl` "Run average | Each pass"; the sticky bar has neither. |
| C-avg-2 | `[data-part=averages-table]`: rows = metrics, columns = runs. 1440, 4 runs: metric column 144, run columns 261 +-2, `scrollWidth <= clientWidth`; 8 runs: column 130 +-2 (minimum 120), no scroll, table <= 296. 1024: 4 runs no scroll (157), 8 runs scroll (min 1104) with the metric column pinned. |
| C-avg-3 | `[data-part=averages-colhead]`: `RunName` + Baseline tag; wraps to <= 2 lines (4 runs: 34 high, 8 runs <= 54); sentence case, no `text-transform`. |
| C-avg-4 | Row heights: `[data-part=averages-cell]` 76 +-2 (correct, quality) at 4 and 8 runs (the delta line never wraps), latency row 51 +-2, errors row 44 +-2 (wraps to <= 60 at 8 runs); table 4 runs 283 +-6 (current 342; legacy 211 with 3 rows). |
| C-avg-5 | `[data-part=averages-value]` 20 high, mono 12/600, text colour = score band; outline 1 px `--success` / `--error` **only** when the change is beyond the 95 % noise band (the exact t band, kept), otherwise a transparent 1 px (no geometry change). The baseline cell has the value only. |
| C-avg-6 | `[data-part=averages-delta]` 15 high, mono 11: glyph (`▲` `▼` `≈`) + signed `pts` + `±` band; colour success/error-text beyond noise, muted within. No glyph strip / dot-plot. |
| C-avg-7 | `[data-part=averages-counts]` 20 high, two buttons `↑N` `↓M` (hit area >= 24 wide), `aria-label` "N items improved / regressed". Click: filter applied (URL), the page scrolls so `[data-part=section-items]` top is at nav bottom + 12 +-6, `[data-part=baseline-delta-banner]` visible, Filters badge = 1, **0 px change of the width of any section** (no sidebar). |
| C-avg-8 | Latency row: value mono 12/600 + percent line; boxed when beyond noise; errors row "N task . M scorer" (`--error-text` when > 0, "none"). |
| C-avg-9 | 390: one block per metric, one line per run (`[data-part=averages-cell]` >= 44 high, run name on the left, value/delta/counts right), table <= 1200, 0 sideways scroll. |

**Overview** (L19-L25)

| ID | Criterion |
|---|---|
| C-ov-2 | `[data-part=stat-grid]`: 1440 one row of 8 (grid 76, box 148 x 74); 1024 two rows of 4 (151); 390 four rows of 2 (301). 1 px gaps drawn by the grid, no per-cell borders. |
| C-ov-3 | `[data-part=stat-box]`: label 11/600 muted with help marker, value `--font-xl` mono 650 coloured by the score band (Errors `--error-text`, latency primary). |
| C-ov-4 | `[data-part=winner-bar]` 28 high, one button per run with wins, flex-grow = wins, run colour, count label (mono 11/650) centred; Ties neutral; aria-label "<name> won N items"; click filters by winner. `[data-part=winner-legend]` rows 18: swatch + name + count + Ties; 4 runs one line, 8 runs <= 2 lines (<= 42); 0 px clipped. |
| C-ov-5 | `[data-part=distribution-bar]` 32 high, one segment per k (runs correct) in score-ramp colour by k/N, width proportional to items, label "k" + count; click filters by pass count; replaces the histogram (current ~95 high). |
| C-ov-6 | Overview section height 4 runs 1440 <= 400 (mock 393; current 423). |

**Categories** (L26-L28)

| ID | Criterion |
|---|---|
| C-cat-1 | Chip bar `[data-part=category-chip-bar]` in the section head aside: label "Categories" + chips 26 high with `key N`; toggles URL-backed; wraps under the title at 390. |
| C-cat-3 | Card: title 13/650 + count, header row RUN / AVERAGE / LATENCY / CHANGE (11/650 uppercase labels, hidden at 390), left border 3 px (`--score-4` easy, `--score-3` medium, `--score-1` hard; other keys `--info`). |
| C-cat-4 | `[data-part=category-run-row]` 27 high: `RunName` (wraps), average mono 12 in score band, latency mono 11, change `Baseline` / `+18.1 pts`; **bar 8 high** (`[data-part=category-track]`) with the fill in the **run colour** and a 1 px tick at the baseline value that is 4 px taller than the bar. |
| C-cat-5 | Click on a card filters the items to that value (URL), shows the banner/Filters badge and **scrolls to the list head like every number (principle 3, owner decision H2; amended: the text said "does not move the page")**; it does not open the sidebar and changes no section width. |

**Steps, root cause** (L29, L32; need a traced / analysed seed)

| ID | Criterion |
|---|---|
| C-step-1 | With spans: one table in the averages recipe (rows = steps, columns = runs, `RunName` heads, cell 44), present only when a run has spans. |
| C-rc-1 | With analyses: one card per category in the error-card recipe (count, sub-cause rows, per-run counts); click filters; section absent otherwise. |

**Errors** (L30-L31)

| ID | Criterion |
|---|---|
| C-err-1 | Groups "Task errors N" and "Metric errors N" (`--font-sm` 650 uppercase + icon + count tag). Cards `[data-part=error-card]` 287 wide at 1440 (4 runs: 149 high; 8 runs <= 232), left border 3 px `--error` (task) / `--metric-error`. |
| C-err-2 | Per-run table: **every run listed, zeros included** (`[data-part=error-run]` count = runs); columns `RunName`, count (mono), delta vs baseline (`Baseline`, `+n` in `--error-text`, `-n` in `--success`, `=`). |
| C-err-3 | The card is a button (role, Enter/Space): click filters the items to that message, no layout change. |

**Items head, toolbar, filters** (L33-L40)

| ID | Criterion |
|---|---|
| C-items-1 | Head: title + description + "Auto-analyze" button only when an analysis exists. |
| C-items-2 | `[data-part=baseline-delta-banner]` (role=status): one line <= 42 high directly above the toolbar: "Showing items where **<run>** regressed on **<metric>** against the baseline **<run>**." + Clear; shown for filters that came from a count button / card / error; names in bold, not cut. |
| C-items-3 | `[data-part=items-toolbar]` is **not sticky**; 1440: one row 24 high (search flex, min 240; Filters 117; Clear only when active; count; Display 150; CSV); 1024: <= 56; 390: <= 90; every control 24 high, centre-line spread 0. |
| C-items-4 | Count text `[data-part=items-count]` `role=status`, mono 11 muted, "N of M items", updates before the list repaints. |
| C-items-5 | Filters button: badge = number of rules (muted when 0); opens an **inline** panel under the toolbar `[data-part=filter-builder]` (>= 100 high empty: head "FILTERS no rules yet", Match AND/OR, + Condition, + Group); nothing painted over content; Escape closes and returns focus. The separate active-chips row is removed: the active filters are listed in the panel head and counted in the badge. The Quick-filters sidebar stays (**owner decision H2**, criteria C-side-1..5 below). |
| C-items-6 | "+ Condition" fields include Outcome (Different outputs, With errors, All runs correct, No run correct, Partially correct, Rarely solved, Uniquely solved), Winner ("<run name> won", "Only <run name> solved", Tie), Change vs baseline (per run and metric), Passing runs, each metadata key, Approval, Has error, Output text, Max latency: run names, not letters. |
| C-items-7 | Display popover 300 wide (Popover, opens under the button, Escape closes, focus returns): Analysis metric `Select`, Sort `Select` (Index, Score up/down, Latency up/down), Text `SegmentedControl` Raw/Rendered, Columns (item / metric fields, shown only when present); button label "Display . <metric>". |
| C-items-8 | CSV opens the existing CSV dialog (kept); button 24 high accent. |

**Item rows** (L41-L44, L51)

| ID | Criterion |
|---|---|
| C-row-1 | `[data-part=item-row]`: border 1 `--border-subtle`, radius 8, 54 high with a one-line title, pitch 60 (6 gap), 20 per page; list `[data-part=item-list]` 1194 +-4. |
| C-row-2 | Row content: chevron 26x26 (`aria-expanded`), `#n` mono 13/600 muted, title 13/600 (clamped to 2 lines; row <= 72), chips right. |
| C-row-3 | `[data-part=item-score-chip]` 68x22, mono 12/600, **swatch 8 inside**, text colour = score band, tint = band 14 %; 4 to 8 chips on **one** line at 1440 and 1024 (`chipsInOneRow`); at 390 chips under the title, row <= 76 with 4 runs. Value shown = the selected metric. |
| C-row-4 | Task error: the chip is a red outlined chip with an `x` and the text "task error" for screen readers (`title` = run + reason); the row border is 1 px `--error`. 0 left rails. |
| C-row-5 | `[data-part=run-key]` above the list: `RunName` for every run (+ Baseline tag), 18.6 high at 4 runs, <= 2 lines at 8; not sticky. |
| C-row-6 | Row head is one tab stop (role=button, Enter/Space toggles), hover = `--bg-hover`; several rows can be open. |
| C-row-7 | Pagination: "1-20 of 40 items", first/prev/page input/next/last 24 high, 20 per page; virtualization stays only above 200 rows per page (section 4). |

**Expanded item** (L45-L50, L52)

| ID | Criterion |
|---|---|
| C-exp-1 | `[data-part=item-detail]`: stacked full-width blocks: INPUT (3 px `--info` bar, label 11/650 uppercase, copy 24x24), EXPECTED OUTPUT (3 px `--success` bar, success 14 % tint), tags row, OUTPUT head, grid. |
| C-exp-2 | `[data-part=output-toggles]`: one 24-high toggle per run (`RunName`, `aria-pressed`, outline in the run colour), at least one stays on; right side "All" and "Only differing". |
| C-exp-3 | `[data-part=output-grid]`: one row, columns `minmax(17.5rem, 1fr)`: 1440 4 runs = 4 columns of 284 (`scrollWidth <= clientWidth`); 5+ scroll with snap; 1024 scroll; 390 one stacked column, no scroll. |
| C-exp-4 | Alignment: across the cards of one item, the top of the text, of the metric rows and of `[data-part=metric-details]` differ by 0 px (CSS subgrid); card height 268 +-4 at 4 runs with 2 metrics; heights equal across cards. |
| C-exp-5 | `[data-part=output-card]`: 3 px left border in the run colour (never red/green), border 1 `--border-subtle`; head = `RunName` (wraps, never cut) then a second line: Pass/Fail tag, Best tag (unique best only), latency mono, Trace 24, copy 24. Header height identical in all cards. |
| C-exp-6 | Metric rows 32 high (caret, name, value mono 600 in band, pencil). Click on one metric row sets `aria-expanded` on that metric in **every** card and shows `[data-part=metric-details]` (Reason block or "No details available.") under all cards at the same top; click again closes all. |
| C-exp-7 | Trace opens the existing drawer; Edit/Add issues opens the existing issues dialog (focus returns to the opener). |
| C-exp-8 | The modal opened from the Sweep table (C-sw-7) renders this same component (`Dialog`, title "Item comparison . <id>", focus trap, Escape). |

**Sweep** (L54-L59; `mock-page-sweep-1440.png`)

| ID | Criterion |
|---|---|
| C-sw-1 | Header actions: Compare | Sweep and Export HTML; Compare-sides banner (C-cohort-1); "Sweep" h2 + one line "A vs B across N runs per cohort . metric: quality . 40/40 items shown" + Reverse button right. |
| C-sw-2 | `[data-part=sweep-verdict]`: badge (Regressed / Improved / Within noise), title 13/650 "Avg@2 -9.1% - beyond noise", sub line 11 muted (noise, p, pairs, declared primary metric), 3 px bottom edge in the verdict colour; height <= 70 at 1440. |
| C-sw-3 | `[data-part=sweep-filters]` one row of 5 fields at 1440 (<= 90 high), labels 11/650 uppercase muted, controls 24. |
| C-sw-4 | `[data-part=sweep-stat-cards]` 5 equal cells in one frame at >= 1100 (min 11 rem), each: label + help marker, `from -> to` (to `--font-xl` mono 650), delta pill, `noise +-x` or `no band`; 3 px bottom edge: `--warning` when beyond noise and worse, `--success` when better, neutral otherwise. |
| C-sw-5 | Metadata table (one per key): columns key, N, one per stat with `a -> b` + delta pill; sortable headers; rows 31 +-2. |
| C-sw-6 | `[data-part=sweep-outcome-cards]` 7 cards, 56 high, value `--font-xl` mono (success for improved/fixed, `--error-text` for regressed/broken) + label 11/650 uppercase. |
| C-sw-7 | `[data-part=sweep-item-row]` 34 high: item id mono 600, metadata badges (domain `--info`, complexity band colours), **pass dots 13 px (filled `--success` / outlined `--error`) + `k/n`** per cohort, Move pill (+n success, -n error, 0 neutral); click or Enter opens the item modal. |
| C-sw-8 | 390: stat cards 2 per row, tables scroll inside their own wrapper (only place with sideways scroll). |

**States** (L60-L62)

| ID | Criterion |
|---|---|
| C-state-1 | Loading: the same frame as the loaded page: run-card placeholders = number of runs in the URL, 239 high; averages placeholder 283; overview 393; items 20 rows x 60. Container height placeholder = loaded +-1 for Runs and Averages (4 runs, 1440 and 390); 0 layout shift when data arrives (CLS 0). |
| C-state-2 | Empty (< 2 runs): `EmptyState` "No runs to compare", one sentence, "Back to runs" button; fits 390 without scroll. |
| C-state-3 | Error (runs missing or hidden): `ErrorState` naming the count, listing up to 5 missing ids then "+ N more", "HTTP 404", Back button; 0 sideways scroll at 390. |

**Keyboard and accessibility**

| ID | Criterion |
|---|---|
| C-kbd-1 | Tab order = visual order: nav links, run X buttons, baseline select, pass toggle, count buttons (row by row), slider, metric tabs, winner segments, distribution segments, chips, cards, search, Filters, Display, CSV, row heads, pagination. Every stop has the 2 px focus ring. |
| C-kbd-2 | Count buttons, winner/distribution segments, category cards, error cards activate on Enter and Space and announce the result through the count (`role=status`). |
| C-kbd-3 | axe: 0 serious or critical violations at 1440 and 390 with 4 runs and one expanded item with its details open. Colour never alone: verdict = outline + glyph, error chip = x + text. |

Fix pass (review F1..F10): C-ov-1, C-cat-2, C-sw-2 and C-sw-6 are back at their original numbers (inline slider, 27 px category rows, verdict <= 70, outcome cards 56 with the label "Avg Δ attempts"); C-items-5 closes on Escape from the Filters button; C-items-6 has the "Change vs baseline" field; the run name weight is 650.

Criteria written: **page 7, nav 3, title/mode/cohort/notices 4, runs 6, averages 9, overview 6, categories 5, steps/root cause 2,
errors 3, items 8, rows 7, expanded 8, sweep 8, states 3, keyboard 3 = 82**, plus 5 sidebar criteria (C-side-1..5, owner decision H2).

**Quick-filters sidebar (owner decision H2; written at the implementation stage, asserted in `scope-sidebar.spec.ts`)**

| ID | Criterion |
|---|---|
| C-side-1 | **owner decision H2.** `[data-part=items-facets-btn]` ("Quick filters", 24 high) sits in the items toolbar after Filters; `aria-expanded=false` by default; a search, a count button, a winner / distribution segment, a category or an error card never opens the sidebar. |
| C-side-2 | **owner decision H2.** Open at 1440 (viewport >= 1200): `complementary` "Quick filters", 300 wide, beside the item list only (inside the Items section, under the toolbar). `[data-part=run-grid]`, `averages-table`, `stat-grid` and `items-toolbar` keep their exact widths; `[data-part=item-list]` narrows by 300 + 24 gap (+-12). It is sticky inside its own column and animates in (measure after it settles). |
| C-side-3 | **owner decision H2.** Content: result count, Clear all, View N items, the Active group, text search, Show, Winner, Change vs baseline, one group per metadata key, Errors, Order by; labels use run names ("cand-a-sonnet won"). Clear all clears the filters and leaves the sidebar as the reader had it. |
| C-side-4 | **owner decision H2.** Below 1200 px it is a drawer opened by the same button (no change to the page widths); Escape closes it and focus returns to the button. At 390 the drawer is the same component. |
| C-side-5 | **owner decision H2.** Keyboard: the button is a tab stop between Filters and Display (Enter / Space toggle); inside, every facet is a button with `aria-pressed`; the Hide button closes it. |

**Amendments made at the implementation stage (measured; each has an assertion with the same number)**

| Criterion | Was | Now (measured) | Reason |
|---|---|---|---|
| C-run-1 8-run grid | 478 +-8 | 500 +-8 (2 x 242 + 16 gap; the 4-run card, 242, is inside the original 239 +-4) | the letter badge (H1) wraps the baseline name; 478 ignored the gap |
| C-page-5 / C-page-6 sections | runs 311, 8 runs runs 551 | runs 312 (4 runs), 568 (8 runs); averages 8 runs 385 (was 366); overview 1024: 480 (was 468) | same cause; the winner legend wraps to two lines at 777 px with letter badges |
| C-avg-3 / C-avg-2 (8 runs) | head <= 54, table <= 296 | head <= 62 (3 lines), table <= 320 (measured 315) | letter badge + name in a 131 px column |
| C-err-1 8-run card | <= 232 | <= 240 (measured 238.9: 8 rows of 22.6 + head; the section, 618, keeps the page-level 620) | every run is listed, zeros included (D7); the 4-run recipe (row 22.6, card 149) is unchanged |
| C-cat-5 | does not move the page | scrolls to the list head like every number | principle 3 and H2 |
| C-row-3 chip | 68x22, tint 14 % | 78x22 (swatch 8 + letter 14 + value), tint 12 %; at 390 the swatch steps aside and the chip is 59x22 so four fit one 247 px line | H1: swatch AND letter; 14 % tint fails axe contrast for the red band |
| C-row-3 / C-page-5 at 390 | row <= 76, items <= 1820 | row 84, items section <= 2200 | the chip line sits under the title |
| C-exp-4 card height | 268 +-4 | 226 +-6 (4 runs, 2 metrics, one-line outputs) | measured; heights are equal across cards (0 px) |
| C-cat-1 URL-backed | (not implemented before) | `catKeys` (`-` for none) | implemented |
| C-state-1 | placeholders 239 | 242 (1440) / 232 (390): the measured loaded card heights | CLS < 0.05 asserted |
| C-nav-1 | `--bar-nav-h` family | new token `--bar-link-h` 36 px | `docs/DESIGN_LANGUAGE.md` and `design-language.test.ts` amended |
| D2 / names | name + start time | name + start time, then ` #n` when two runs also share the start minute | the seed's runs share one start time |
| Filter labels | names | names in `FieldDef` labels, chips and the sidebar (text cannot hold the swatch); the letter badge is in every visual place | H1 |


### 3.6 Hierarchy and legacy parity per component (what is kept, what is fixed)

Kept from legacy: every section, its order, one control per section head, the heat-strip rows with swatch-inside chips, the
verdict box, the winner/distribution bars, 3-up category cards with the baseline tick, per-run error tables with zeros, the
single-row output grid with the run-colour border, the metric details opened under every run at once, the Pass/Fail tag and the
Sweep page structure. Fixed (legacy faults): ellipsised output-card names (wrap), the 4th output card cut off at 1440 (4 x
284 fit), sideways scrolling averages / cards at 390 (block layout / stacked), two names for one run (card title vs table
label: one name), the "Completed" count that includes errored items (kept as React's, D6), a toolbar that wraps to 3 rows at
390 (2 rows), an Auto-Analyze button that appears in two places.

## 4. What React keeps that legacy did not have (and why the legacy reading is unchanged)

| Kept | Why it does not change what the reader sees |
|---|---|
| Deep links and URL params (`runs`, `baseline`, `metric`, `threshold`, `columns`, `filter` ...), `?panel=` aliases | invisible; legacy links keep working |
| Section nav, 36 px (legacy has none) | one 36 px strip of links; replaces the 44-72 px block; it adds a way to reach Items from the top, removes nothing (question Q1) |
| Exact t-distribution 95 % noise band behind the verdict box and `±` | the number legacy also shows, computed exactly; the outline rule is the legacy one |
| Virtualization above 200 rows per page and `Pagination` | page size 20 means it never engages in the default view |
| Editable cohort side labels | a pencil beside the name; the banner reads the same |
| "All" / "Only differing" in the output toggles, the CSV column dialog, `IssueDialog`, `TraceDrawer` | extra controls on rows the legacy page already has |
| Baseline word in the baseline cell removed; `Baseline` tag in column heads | same as legacy |
| Meta line "4 columns . cmp-qa-v1 . 40 aligned items" under the title | one muted line |
| Per-run noise pill in category rows `±20.2` | numeric noise legacy shows only in Averages; muted, same row height (27) |
| Completed = items with an output (38) rather than processed items (40) (D6) | the strip reads "Completed 38, Errors 3"; legacy's "Completed 40, Errors 3" contradicts itself |

Removed from React (replaced by the legacy behaviour): the letters, the baseline star, the sticky selects, the Quick-filters
sidebar and the Scope bar, the "Changes vs baseline" strip, the active-chips row, the dot-plot glyph, the histogram, the table
rows with rails, the "Run details" collapse and compact 8-run cards, the hidden zero-error runs.

## 5. Tests the implementer must write

Playwright, folder `frontend/e2e/compare/` (seed: `frontend/e2e/compare/seed.ts` `seedCompareScenario`, plus 4 extra aligned runs from
`redesign8/measure/seed-extra.mts`, a traced run (`seedTracedRun`) for C-step-1, and analyses for C-rc-1; the repeat run for
C-avg-1). Each spec also runs at 390 where the criterion has a 390 number.

| Spec | Measures |
|---|---|
| `r8-page.spec.ts` | C-page-1..7, C-nav-1..3: first-screen positions at 1440x900, sticky count, no horizontal scroll, section heights (4 and 8 runs), 0 ellipsis, section order |
| `r8-identity.spec.ts` | C-run-5, C-page-4: the colour of every `RunName` swatch of one run is identical in all sections; no element text matches `^[A-H] ` for run labels |
| `r8-runs.spec.ts` | C-run-1..6 (columns, heights, removal, URL, focus), C-title-1, C-cohort-1 |
| `r8-averages.spec.ts` | C-avg-1..9 incl. the count-button journey (filter, scroll position, banner, Filters badge, 0 width change), repeat-run toggle, 390 block layout |
| `r8-overview.spec.ts` | C-ov-1..6 incl. metric tabs and slider changing the stat values and the URL; winner segment and distribution segment filters |
| `r8-categories-errors.spec.ts` | C-cat-1..5, C-err-1..3 (zeros listed, filters) |
| `r8-items.spec.ts` | C-items-1..8, C-row-1..7 (heights, pitch, one-line chips at 8 runs, error row, keyboard toggle, pagination) |
| `r8-expanded.spec.ts` | C-exp-1..8: grid columns and scroll at 1440/1024/390, alignment 0 px, metric details under all cards, card header height equality, toggles |
| `r8-sweep.spec.ts` | C-sw-1..8 (verdict edge colour, dots + k/n, modal from a row) |
| `r8-states.spec.ts` | C-state-1..3 (placeholder height = loaded height 4 runs, CLS 0, empty, error with 7 ids) |
| `r8-a11y.spec.ts` | C-kbd-1..3 with axe |

Vitest: `lib/` stays; add a test for the run-label disambiguation rule (D2). `npm run check` and
`pytest tests/platform/test_design_language.py` after the UI change; the measurement scripts of this folder are the reviewer's
tools (`l1`/`r1`/`m2` produce the tables above).

## 6. Decisions taken alone and questions for the owner

Decisions (2026-10-26):

- **D1** The metric select, baseline select and pass toggle leave the sticky bar for the heads of their sections (legacy). The sticky element is a links-only 36 px nav.
- **D2** Run identity is swatch + letter badge + run name (**owner decision H1**: the letters stay). Two selected runs with the same run name get `. <started time>` appended in every `RunName` (legacy disambiguated with model + date + #n); filter labels use names ("cand-a-sonnet won").
- **D3** The Scope bar and the "Changes vs baseline" strip are removed (**owner decision H2**: the Quick-filters sidebar stays, opened from the toolbar, beside the list only); their jobs are done by the count buttons + banner + the Filters panel (all facets stay as "+ Condition" fields, C-items-6).
- **D4** The correct-distribution histogram becomes the legacy single 32 px stacked bar.
- **D5** Item rows are legacy cards (54 high, pitch 60), not a table; the run key above the list replaces column headers; the left rails and the `Changes` legend go.
- **D6** "Completed" keeps React's meaning (items that produced an output).
- **D7** Error cards list every run including zeros.
- **D8** Averages at 8 runs fit one screen row (column >= 120), at 1024 they scroll with the metric column pinned.
- **D9** Output toggles and cards use the run name only (the legacy "model . date . #n" long label is the disambiguation of D2, not the default).
- **D10** The mock gallery section is wired in `UiGalleryPage.tsx` after `Round7Mocks` (the way every round mock is), not through `MockHost.tsx` (that file only hosts `/__mock/<area>/<variant>` routes).
- **D11** Sweep: legacy structure and colour logic (edges, dots with `k/n`, coloured outcome cards) are reproduced; React's editable side labels and table sorting stay.

Questions for the owner (short; the orchestrator asks them with the mocks):

1. **Q1** The legacy page had no navigation; React has a jump nav. Keep it as a 36 px sticky strip of links (recommended: the page is 3500 px tall), or remove it for a pure legacy page?
2. **Q2** Letters (A to H) are removed everywhere, as in legacy. With 8 runs the item rows identify runs by colour only (plus the name in the key above the list and in each chip's tooltip). OK, or add the run's first letters to the chip?
3. **Q3** The Quick-filters sidebar goes (a click on a number filters and scrolls to the list; every facet is a "+ Condition" rule). OK to lose the always-open facet list?
4. **Q4** Item rows become the legacy cards: 20 rows = 1194 px instead of 1040 px (a table). OK?
5. **Q5** Expanded item: INPUT above EXPECTED, stacked and full width (legacy), instead of side by side (React). OK?

## 7. Hand-off

Files (branch `ui/redesign8-compare`, worktree `qym-wt-redesign8-compare`):

- `docs/internal/ui-migration/redesign8/compare.md` (this spec)
- `frontend/src/features/dev/Round8Mocks.tsx` + `Round8Mocks.module.css` (the mocks and the proposed recipe), wired in `frontend/src/features/dev/UiGalleryPage.tsx`
- `docs/internal/ui-migration/redesign8/measure/`: `lib8.mts`, `seed-extra.mts`, `seed-ids.json`, `p0-pages.mts`, `l1-legacy-inventory.mts`, `l2-legacy-states.mts`, `l3-legacy-repeat-sweep.mts`, `r1-react-inventory.mts`, `r2-react-states.mts`, `r3-states-sweep.mts`, `m1-mock-shots.mts`, `m2-mock-measure.mts`, `m3-first-screen.mts`, `baseline/*.json`
- `docs/internal/ui-migration/redesign8/shots/`: `legacy-*`, `current-*`, `mock-*` (composed: `mock-page-compare-1440.png`, `mock-page-compare-390.png`, `mock-page-compare-8runs-1440.png`, `mock-page-compare-expanded-1440.png`, `mock-page-sweep-1440.png`, `mock-sheets-1440.png`)

How to run the gallery: seed a SQLite DB (`python frontend/scripts/dev_db.py sqlite:////abs/.qym-dev.db-r8`), start the platform
(`QYM_AUTH_MODE=none uvicorn qym_platform.main:app --port 8981`), `cd frontend && npx vite --port 5981 --strictPort` (with
`QYM_PLATFORM_PORT=8981`), open `http://127.0.0.1:5981/__ui#round8`. Widths: 1440 (shell 1440), a 1024 window (shell 1024), a
390 window (shell 390 with the 56 px rail). Re-run the numbers: `node docs/internal/ui-migration/redesign8/measure/m2-mock-measure.mts`.

Not covered (and why): Step latency (L29) and Root cause (L32, and the issues editor L50 in its populated state) have no data in the seed (no
spans, no analyses): they are specified from source and legacy CSS and need a traced / analysed seed in the implementation tests.
The legacy HTML export modal (L53) was inspected in source only.

## Round 8b amendments (owner decision H6: framed sections)

The section panel (14 px padding and a 1 px border on every side, 20 px between panels) changes the numbers of this
document that depend on the content width or on a section's height. C-page-1 is unamended (cards bottom 510.75 <= 530, Averages
table bottom 899.83 <= 900). The amended criteria, with the old and new numbers and the asserting spec, are listed in
`sections-impl-notes.md` ("Round-8 criteria amended by the panel"): C-page-5, C-page-6, C-avg-2/3, C-cat-2, C-err-1, C-exp-3,
C-ov-2, C-ov-6, C-run-1, C-row-1/2, C-row-3 (390), C-state-1 (390). `CompareSection` is retired; every section of this page renders
through `ReportSection` and keeps its `data-part=section-<key>`, `section-head`, id and scroll margin.
