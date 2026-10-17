# Redesign round 4: per-pass rows inside the runs table (design specification)

Status: design stage. No product component was changed. The only code added is the dev gallery mock
(`frontend/src/features/dev/Round4Mocks.tsx` and its CSS module, wired into `/__ui#round4`) and the seed script
`seed-passes.mts`. The mocks are the visual contract: where this text and a mock disagree, the number in this text wins and
the mock is a bug to report.

Branch `ui/redesign4-runs-passes` (from `UI-redesign` 000d6dbd). Measured 2026-10-17 with Playwright DOM geometry; legacy on
8981, React on 8982 / Vite 5982, seed `docs/internal/ui-migration/redesign4/seed-passes.mts` (project `r4-seed`: one classic
run, one 3-pass run, one 10-pass run, 8 items each).

Screenshots (`docs/internal/ui-migration/redesign4/shots/`, each under 300 KB):

| Prefix | What |
|---|---|
| `legacy-*` | the vanilla page: `legacy-collapsed-1440`, `legacy-expanded-1440`, `legacy-expanded-scrolled-1440` |
| `current-*` | the React page today: `current-collapsed-1440`, `current-expanded-1440`, `current-expanded-scrolled-1440`, `current-reordered-1440`, `current-frozen-scrolled-1440`, `current-expanded-10-1440`, `current-collapsed-390`, `current-expanded-390` |
| `mock-*` | the new design, from `/__ui#round4`: `mock-collapsed-1440`, `mock-expanded-1440`, `mock-states-1440`, `mock-frozen-scrolled-1440`, `mock-select-1440`, `mock-cards-390`, `mock-cards-select-390` |

## 1. The feedback

> "per pass table should be part of the main table but hidden unless the user clicks the drop down button to ensure that table
> navigation will move the main and per pass results to compare their metrics against each other."

Reading: the pass rows are rows of the runs table, collapsed by default, opened by the chevron. "Table navigation" (scrolling
sideways, column order, frozen columns, widths, the keyboard) must move the run row and its pass rows together, so the user can
look straight up and down from a pass score to the run's score.

## 2. Problem (measured on the current page)

Current mechanism: `RunsTable` passes `renderExpanded` to `DataTable`; the detail row holds `PassesPanel`, which renders a second,
embedded `DataTable` (`PassesTable`) that is `position: sticky; inset-inline-start: 0` and as wide as the scroller. Seed run
`1d7bec5b` (3 passes), 1440 px viewport, scroller 1203 px wide, table scroll width 3234 px, density compact.

| # | What was measured | Run row (main table) | Pass row (embedded table) |
|---|---|---|---|
| M1 | x of the `correct` score cell, scrollLeft 0 | 1240 | 711 (529 px to the left) |
| M2 | x of the `quality` score cell, scrollLeft 0 | 2070 | 838 (1232 px to the left) |
| M3 | x of the `correct` cell after scrolling the table 400 px sideways | 840 (moved -400) | 711 (did not move) |
| M4 | column order after moving `quality` before `correct` (Alt+Shift+Left x6) | `quality, correct, ...` | `correct, quality, ...` (unchanged: the mirror follows the visible set, not the order of the columns menu) |
| M5 | `quality` frozen (Shift+F10, Freeze column) and scrolled 400 px | x 611 (stuck after Status) | x 838 (not frozen, not moved) |
| M6 | other columns of the pass table | Run 207, Status 467, Signals 611, Task 688 ... Date 1020, Analysis 1140 | `#` 223, Status 293, Analyze 437, Date 567: a different column set in a different order, with its own header row |
| M7 | height of the opened block, 3 passes | 32 px run row | panel 270 px (own header 34, strip 64, three 32 px rows, paddings): 8.4 run-row heights |
| M8 | height of the opened block, 10 passes | | panel 494 px |
| M9 | 390 px, 3 passes | card 419 px high host | panel 289 x 680 px inside the 419 px card host: pass 1 and a sliver of pass 2 are visible; the rest needs a second scroll inside the first |

Verdict: horizontal scroll, column order, freezing and widths of the main table do not apply to the pass rows (M3, M4, M5), the
pass score is never in the run score's column (M1, M2, M6), and the opened block is a page inside the table (M7 to M9). This is
the owner's complaint; the fix is structural (pass rows in the same table), not cosmetic.

Screenshots: `current-expanded-1440.png` (M1, M6, M7), `current-expanded-scrolled-1440.png` (M3), `current-reordered-1440.png`
(M4), `current-frozen-scrolled-1440.png` (M5), `current-expanded-10-1440.png` (M8), `current-expanded-390.png` (M9).

Also found: at 1440 the metric columns start at x 1240 of a 1203 px scroller, so by default no score is on screen next to a pass
without scrolling; the comparison the owner wants happens after the user scrolls or freezes a metric column, which is exactly the
case the current panel breaks.

## 3. Legacy reference (`legacy-expanded-1440.png`, `legacy-expanded-scrolled-1440.png`; `dashboard.js` 4745-5130)

Measured, 3-pass run, 1440: the chevron (`.samples-toggle`) inserts one `<tr class="pass-member">` per pass directly under the
run, then one strip row. The left edge (`left`) of **all 24 cells** of a pass row equals that of the run row (192, 592, 712, 822,
962, ... 2931), so the pass scores sit exactly under the run scores, scrolling moves both, and the user compares by looking up and
down. Pass rows are 42, 54 and 42 px (54 because pass 2 stacks error chips under the badge), the strip is 77 px (two lines).
A green left rail marks the group; Task, Model, Dataset and Owner are repeated but dimmed; the Run cell says "Pass n"; Status
carries badge, progress and error chips. The strip says `GROUP METRICS`, a Metric select, `PASS IF >= [slider] 100%`, and on a
second line `PASS@3 87.5%  PASS^3 62.5%  AVG@3 70.8%  CONSISTENCY 83.3%  RELIABILITY 81.0%  AVG LATENCY 2.1s`.

Keep: pass rows are rows of the main table with the same cells in the same columns; one strip; group rail; "Pass n" in the Run
cell. Do differently: legacy repeated Task, Model, Dataset and Owner dimmed (twelve repeats of the same tag for a 10-pass run,
noise next to the scores); the strip took two lines (77 px); the slider took 160 px of the strip; errors stacked inside the
Status cell and made one pass row 54 px (rows are one density height in the new design).

## 4. Design

### 4.1 Model: child rows are real rows of the same table

`DataTable` gains a **child rows** capability (section 6). For a run with `samples > 1` the chevron toggles its child rows. Child
rows are `<tr>` elements in the same `<tbody>` as the runs, rendered by the same column definitions (`cellFor`), so a column
that is reordered, frozen, hidden or resized in the runs table is reordered, frozen, hidden or resized for the passes at the
same time, and the x position of every cell of a pass row equals that of the run row (the legacy property, now guaranteed by
construction instead of by a mirror). `PassesTable` and the embedded table disappear; `renderExpanded` stays and is used only for
the strip.

```
1440, scroller 1203, scrollLeft 560 (see mock-expanded-1440.png; quality frozen: mock-frozen-scrolled-1440.png)
 RUN                      | STATUS      | ...ANALYSIS ... CORRECT          QUALITY          EXACT MATCH   |
|v rag-answer-v7 x3        COMPLETED       Analyze        [==] 71%         [==] 64%         [==] 46%       |  run row, 32, name 600
|  Pass 1                  COMPLETED       Analyze        [==] 63%         [==] 64%         [==] 50%       |  child 32, rail, --bg-void
|  Pass 2  (!1 in Signals) COMPLETED       Analyze        [==] 63%         [==] 62%         [==] 38%       |  child 32
|  Pass 3                  COMPLETED       Analyze        [==] 88%         [==] 73%         [==] 50%       |  child 32
| Passes 3 . 8 items [correct v] [Pass if >= 80%]  Pass@3 87.5% Pass^3 62.5% Avg@3 70.8% ... (i)          |  strip 45, sticky
```

### 4.2 The chevron and the state

- The chevron stays where it is: an `IconButton` in the Run cell, `aria-expanded`, accessible name `Expand 3 passes of {run}` /
  `Collapse 3 passes of {run}` (the names the current specs use). Only runs with `samples > 1` have one; a single run has the
  24 px spacer. Collapsed by default. Clicking the row still opens the run, never toggles (unchanged).
- **State: the existing expansion state, not the URL.** `RunsPage` already owns `expanded: Set<run_id>` (React state, reset on
  reload). It stays the source of truth and is additionally mirrored to `sessionStorage` key `qym:runs:expanded:<slug>`
  (the same pattern as `qym:runs:passes-metric:<slug>` and the selection) and read on mount, so opening a pass or the run and
  pressing Back returns to the same open groups. Why not the URL: an open group is view state of a table, not a filter or a
  sort; a URL param would carry one 36-character run id per open group, add a history entry or a replace per click, and make
  shared links open fifty rows. Ids that are not on the loaded page are ignored (not deleted) so paging does not lose them.
- Keyboard: Tab reaches the chevron; Enter and Space toggle it (`IconButton` press); `aria-expanded` mirrors the state. With a run
  row focused (row focus stop, roving `tabindex`), Arrow Right expands and Arrow Left collapses (treegrid convention); on a
  child row Arrow Left moves focus to its run row. Arrow Up/Down move over run rows, child rows and nothing else; the strip is a
  focusable row stop whose controls are Tab stops inside it. After a toggle the focus stays on the chevron.
- Screen readers: the table stays `role="treegrid"`. Run row: `aria-level="1"`, `aria-expanded` (only when it has passes). Child
  row: `aria-level="2"`, `aria-posinset="n"`, `aria-setsize="k"` (k = `samples`, queued ones count), accessible name
  `Pass 2 of 3 of run {run}` (on the row and on the `Pass 2` link). Strip row: `aria-level="2"`, name
  `Group metrics of {run}`. `aria-rowcount` and `aria-rowindex` count child rows and the strip row (the display list).

### 4.3 What a child row shows, column by column (same columns as the run row)

| Column | Child row | Reason |
|---|---|---|
| select (select mode) | checkbox `Select pass 2 of 3 of run {run}`; run row is checked when all passes are, indeterminate when some are | existing selection model (`passRef`), unchanged |
| Run | indented to the run name's x (24 px chevron slot + `--space-xs`), link `Pass n` to the pass (`?pass=n`), then, only while running or partial, muted `62% . 5/8 items` | the item count has no column of its own; it is shown only when it is not the full total |
| Status | `RunStatusBadge` of the pass (a stale `running` pass shows the run's terminal status, `passRowsView` rule) | one badge, no progress text inside the 144 px cell (the clipping seen in the mock draft) |
| Signals | the pass's issues: `!` task errors (danger), `~` metric errors (warning), retry glyph (info), count in mono, one `–` when clean (`IssuesCell`, `passIssues`) | the run's Signals cell is the sum; the pass cell says which pass |
| Task, Model, Dataset, Owner, Experiment, Version | **empty** | these are facts of the run, identical for every pass; the run row is directly above. This replaces legacy's dimmed repeats (decision D2) |
| Date | pass start time, same format as the run's Date | per pass |
| Analysis | `AnalyzeAction` for the pass (not shown for running or pending passes), cause count badge | as today |
| every `metric-*` column | the pass mean in the same `ScoreBar` recipe, direction and band as the run cell; numeric metrics via `formatNumericValue`; `metric_error_counts[m] > 0` shows the metric-error glyph | pass score in the run score's column |
| `trace-*`, Latency, Median latency, Duration | the pass values (`trace_stats`, `avg_latency_ms`, `median_latency_ms`, `duration_ms`) | all exist on `RunPass` |
| group columns (Pass@K, Consistency, Reliability) | empty | group-level, shown in the strip |
| Actions | `Delete pass n` icon button (same rules as today: `canDelete && status not in RUNNING, PENDING, SUBMITTED, APPROVED`, confirm dialog, `expectedVersion` = `pass_revision`) and, in the overflow, `Open pass n`; no submit, approve or transfer | passes have no review lifecycle |

Child values use `--text-secondary` (the body ramp); the open run row's name and values go to weight 600 so the mean reads as the
heading of its passes. Nothing is dimmed with opacity (WCAG), blank cells carry no placeholder (a dash would be 12 repeats of
nothing). Rows are one density height (`--row-compact` 32, `--row-regular` 40, `--row-comfortable` 52); issues never stack a
second line.

**Group marker without colour-as-identity.** Three signals, none of them a hue per group: (1) a 3 px (`--rail-width`)
`--accent-primary` rail on the inline start of the open run row, every child row and the strip, one continuous bar (the same
colour for every group, so it says "this is a group", not "which one"); (2) a surface step, child rows and the strip use
`--bg-void` while the table uses `--bg-base` / `--bg-surface` (no wash, no tint: section 7 allows washes only for error and
live); (3) the indent of `Pass n` under the run name and `aria-level`. Pass identity is text (`Pass 2`), never a colour (hue
budget). Zebra is suspended inside a group (children are one tone). Row `rowState` rails (error 3 px, live 3 px) stay on the
run row; a failed or running pass shows its state in the Status badge and Signals cell, so the group rail is never competing
with a state rail.

### 4.4 The group metrics strip: one row under the passes (decision D1)

Decision: **ONE full-width row directly under the last child row, in the table body, not column-aligned, sticky to the scroller
start** (the `renderExpanded` detail row with `detailFit="viewport"`, which already holds a block at `inset-inline-start: 0` and
`inline-size: var(--scroller-w)` while the columns scroll). The alternative, a header band between the run row and its first
pass, was measured against it: a band pushes the first pass 45 to 77 px away from its run, which is exactly the vertical
distance the owner wants to be short; after the strip, the run row and its passes are adjacent (the strip is read once, after
the numbers, as legacy did). The strip does not align to columns because Pass@k, Pass^k, Avg@k, Consistency and Reliability are
group statistics with no column; forcing them into columns would make them scroll away.

Content, one line at 1440 (`mock-expanded-1440.png`, 45 px):
`Passes  3 . 8 items | [Metric select 150 px] | [Pass if >= 80%] chip | Pass@3 87.5%  Pass^3 62.5%  Avg@3 70.8%  Consistency 83.3%  Reliability 81.0%  (i)`.
Label `--font-sm` muted, value `ScoreValue` mono `--font-md` 600 with its band bar (non-colour cue), definitions in the single
`HelpMarker`, `title` on each stat. The slider moves into the chip's popover (`PassThreshold`, unchanged). `Avg latency` leaves
the strip (it is the Latency column of the run row). While group metrics reload, the previous values stay at `--dim-opacity`
with `aria-busy`, no height change. "No direction declared" shows muted text instead of the chip. Select: the metric choice
is remembered per project in `sessionStorage` as today (`qym:runs:passes-metric:<slug>`).

Width behaviour (the strip is a flex-wrap row inside the sticky block): one line from 1100 px of scroller width; at 1024 (scroller
about 787 px) the stats drop to a second line (two lines, at most 92 px); at 390 it is stacked (title, select, chip, stats in two
columns), at most 190 px (`mock-cards-390.png`).

### 4.5 Sorting, selection, virtualisation, columns, density

- **Sorting.** The sort acts on runs only (the server pages runs). Child rows are emitted by the display builder directly after
  their run, in pass order 1..k, so they stay under their parent whatever the sort, filter or page. The header sort glyph never
  claims to sort passes; pass order is fixed.
- **Selection** (select mode, `selectOnRowClick`). The model is unchanged: pass refs `runId::passN`, a run and its own passes are
  exclusive, units count executions (`cohortUnitCount`). The only change is where the checkbox lives: the select pseudo-column of
  the same table, so it is frozen with Run and Status. Parent indeterminate when some but not all passes are picked; ticking the
  run while expanded ticks every pass (existing `viaPasses`); shift-click ranges over display order across run and pass rows
  (`rangeKeys` over the display list; a range never mixes a run with its own passes: `refsExclusive`). Row click in select mode
  toggles the row clicked. The strip row has no checkbox.
- **Virtualisation.** The runs table is not virtual until the display list passes 200 rows (`VIRTUAL_AFTER`), which 50 runs x 10
  passes does (550). Child rows and the strip are ordinary entries of the display list (`kind: 'child'`, `kind: 'detail'`), so
  the virtualiser (`items-virtual` pattern, `useVirtualizer` over display indexes, `measureElement` for the strip) sees them;
  child rows are fixed height (`--row-*`), only the strip is measured (45 to 92 px). Expanding or collapsing a run keeps that run
  row at the same y (the parent is scroll-anchored with `scrollToIndex(align: 'auto')` only when it would leave the view), and
  the first-render of a virtual window never shows a gap (`padTop` / `padBottom` computed from the display list).
- **Column manager.** Hiding, showing, reordering, freezing and resizing apply to run and child rows alike because they are one
  column model. The "Show all metrics (+n)" footer disappears (hidden is hidden everywhere). The Columns menu is unchanged.
- **Density.** The density menu sets the row height of run and child rows together (32 / 40 / 52).

### 4.6 States

- **Collapsed:** run rows only; nothing extra in the DOM (no hidden child `tr`s; the passes request is not made until the first
  expand, as today).
- **Loading (first expand):** `row.samples` child rows (at most 10, at least 1) at row height, each `Loading passes...` muted in
  the Status cell, `aria-busy="true"` on the run row; the strip is not drawn until the data is there. When data arrives the
  child count equals `samples`, so the table does not change height (0 px shift).
- **Error:** one child row, `Could not load passes` (`--error`) in the Status cell and a `Retry` button in the Actions cell; no
  strip. `logger`-style details stay in the tooltip text. Group-metrics error: the strip shows the muted sentence
  `Group metrics are not available: {message}` instead of the five stats; the rows stay.
- **Queued / not run:** one child row after the started passes: `Pass 3 waiting to start` (or `Passes 4-5 waiting to start`, or
  `not run` once the run ended without them) in the Run cell, a `QUEUED` (neutral) or `NOT RUN` (warning) badge in Status, all
  other cells empty (`queuedText`).
- **Running pass:** badge `RUNNING`, Run cell adds `62% . 5/8 items`; its score cells show the running mean with `live` flash as
  the run row does; Analysis and the delete icon are absent. A running run with an expanded group refetches every 15 s
  (`refetchInterval`), child rows keep their React keys (`passRef`), so expansion, focus and the scroll position survive and the
  DOM nodes are not re-created.
- **Read-only users:** no delete icon and no checkbox column outside select mode, as for run rows.

### 4.7 Card mode (under 640 px, the `DataTable` breakpoint, `max-width: 639px`; `mock-cards-390.png`, `mock-cards-select-390.png`)

The chevron stays in the run card's header line. Open, the card shows, under its facts, a `ul[role=group]` named `Passes of
{run}` with one **pass line per pass** inside the same card (not a nested card, not a separate panel): line 1 `Pass n`
link, status badge, overflow menu (`Open pass`, `Delete pass`); line 2 `{selected metric}` name, score bar and value, issue glyphs
(the selected metric is the strip's Metric select; the card shows only that metric, the pass link opens the rest). Lines are
`--bg-void` with the same 3 px accent rail on the card, at most 56 px each. The strip follows the lines, stacked. In select mode a checkbox sits before `Pass n`. The `DataTable` card layout builds
the lines from the same column model: priority-1 columns (Run, Status, Actions) of the child rows, plus the one score column
that matches the strip's selected metric; hidden columns stay hidden. The current 680 px panel inside a 419 px host (M9) becomes
about 3 x 52 + 150 + the card's own height, in the same single scroll.

## 5. Acceptance criteria

Widths: 1440 means a 1440 x 900 viewport (runs scroller 1203 px, density compact unless stated), 1024 a 1024 x 800 viewport,
390 a 390 x 844 viewport. "Run row" is `tr[data-run-id]`; "pass row" is `tr[data-pass-row]` (new attribute, value = pass
number); "strip" is `tr[data-strip-row] [role=group][aria-label="Group metrics"]`. Seed: the 3-pass run (8 items) and the
10-pass run of `seed-passes.mts`.

| # | Criterion | How to measure |
|---|---|---|
| Q1 | At 1440, 1024 and 390 on first load every run row with `samples > 1` has one chevron button named `Expand {k} passes of {run}` with `aria-expanded="false"`; the page contains 0 `tr[data-pass-row]` and 0 strips. | `getByRole('button', {name: /^Expand \d+ passes of/})` count equals runs with samples > 1; `locator('[data-pass-row]').count() === 0` |
| Q2 | At 1440 clicking the chevron of the 3-pass run adds exactly 3 `tr[data-pass-row]` directly after the run row in the same `tbody` of the same `table` (no second `table`, no `[role=region][aria-label^="Passes of"]`), names `Collapse 3 passes of {run}`, `aria-expanded="true"`; clicking again removes them. | `row.locator('xpath=following-sibling::tr[position()<=3]')` all carry `data-pass-row`; `page.locator('table').count()` unchanged |
| Q3 | At 1440 the chevron works from the keyboard: focus it, press Enter then Space; `aria-expanded` flips each time and focus stays on the chevron. With the run row focused ArrowRight expands and ArrowLeft collapses; with a pass row focused ArrowLeft focuses its run row. | `keyboard.press`, `toHaveAttribute('aria-expanded')`, `evaluate(document.activeElement)` |
| Q4 | Same-column property: at 1440 with the run expanded, for every visible column id the `getBoundingClientRect().left` and `.width` of the pass row's cell equal those of the run row's cell (difference at most 0.5 px), at scrollLeft 0. In the current page the `correct` pair differs by 529 px (M1). | `td[data-col=...]` rects for run row and each pass row, all columns |
| Q5 | After scrolling the table scroller 400 px sideways at 1440 the `correct` score cell of pass 1 and of the run row both moved by exactly 400 px (400 +- 1) and still have equal `left`. Today the pass cell moves 0 px (M3). | scroller `scrollLeft = 400`; compare rects before and after |
| Q6 | After moving the `quality` column before `correct` (Alt+Shift+Left on its header) at 1440 the column order of the pass rows equals the run row's (`td[data-col]` sequence equal) and `left` of the `quality` and `correct` cells is equal for run and pass rows. Today the pass order stays `correct, quality` (M4). | cell id sequence of `tr` equality, rect equality |
| Q7 | After freezing `quality` (Shift+F10, Freeze column) and scrolling 400 px at 1440 the `quality` cell of the run row and of every pass row have the same `left`, it did not move while the unfrozen `correct` cell moved 400 px, and the frozen pass cell has an opaque background (`background-color` alpha 1). Today the pass cell sits at 838 vs the run's 611 (M5). | rects; `getComputedStyle(td).backgroundColor` |
| Q8 | Column manager: hiding the `quality` column (Columns menu) at 1440 removes the `quality` cell from the run row and every pass row (0 `td[data-col="metric-quality"]` in the table); there is no "Show all metrics" control. Resizing the Status column by 40 px changes the Status cell width of the run and pass rows by 40 px. | `locator('td[data-col=...]').count() === 0`; `getByText(/Show all metrics/).count() === 0`; width diff |
| Q9 | Density: at 1440 each pass row height equals the run row height at compact (32), regular (40) and comfortable (52). | `boundingBox().height` of `tr[data-pass-row]` and run row per density |
| Q10 | Pass row content at 1440 (3-pass seed): Run cell text is `Pass 1`, `Pass 2`, `Pass 3` and the link is named `Pass n of 3 of run {run}` with `href` ending `?pass=n`; the Run cell's `Pass n` text starts at the same x as the run name text (difference at most 1 px); Status shows one `RunStatusBadge` with the pass status and no progress text; Date shows the pass start time; the `Signals` cell of the pass with a task error shows `!1` with the accessible text `1 task error in this pass`, clean passes show `–`. | text and rect of the cells; `getByRole('img', {name: '1 task error in this pass'})` |
| Q11 | Inherited cells: in every pass row the Task, Model, Dataset, Owner, Experiment and Version cells have empty text content (`textContent.trim() === ''`) and contain no element with text; Analysis shows an Analyze link per completed pass (named `Analyze pass n`), Latency, Duration and each metric column show the pass value. | per-column `textContent` |
| Q12 | Actions: a pass row has a `Delete pass n` button for an owner/admin/manager and none for read-only users or for a run whose status is RUNNING, PENDING, SUBMITTED or APPROVED (same matrix as today's `canDeletePass`); pressing it opens the confirm dialog titled `Delete pass n?`, confirming sends `DELETE .../passes/n` with `expectedVersion` and the other passes remain renumbered (existing `cutover-passes.spec.ts` behaviour). A pass row has no Submit and no run-level menu. | button counts per role; request capture |
| Q13 | Group marker at 1440: the open run row, each pass row and the strip each have a 3 px inline-start rail in `--accent-primary` (first `td` `box-shadow` / strip `box-shadow` contains `3px` and the accent colour); pass rows and the strip use background `--bg-void`; the run rows around them use the table's `--bg-base` / `--bg-surface`; all open groups use the same rail colour; pass rows have no `opacity` below 1. Pass identity is text: no pass row carries a `data-series` or a per-pass colour. | computed styles; no `[data-series]` descendant of pass rows |
| Q14 | Strip placement at 1440: exactly one `tr[data-strip-row]` per open group, located directly after the group's last pass row (sibling index = run index + k + 1); its single cell spans all columns (`colSpan` = column count) and `getBoundingClientRect().left` equals the scroller's left edge after scrolling 400 px (sticky), width equals the scroller's `clientWidth` (1203 +- 1). | rects at scrollLeft 0 and 400 |
| Q15 | Strip height: at 1440 the strip is at most 56 px high (measured 45), one line (all of Select, chip, five stats, help marker have the same `top` within 4 px); at 1024 at most 96 px; at 390 at most 190 px. | `boundingBox().height`; tops of the controls |
| Q16 | Strip content at 1440: title `Passes` and `3 . 8 items`; a Metric `Select`; one chip `Pass if >= 80%` that opens the threshold popover with the slider; the five stats `Pass@3`, `Pass^3`, `Avg@3`, `Consistency`, `Reliability` each with a value of the form `NN.N%`; one `HelpMarker` (not five); no `Avg latency` stat. Changing the Metric select or the threshold issues a `group-metrics` GET with the new `metric` / `threshold` query (existing behaviour). | `getByRole('group', {name: 'Group metrics'})` text; request capture |
| Q17 | The strip is not clipped and is not dragged by horizontal scroll: after `scrollLeft = 1000` its `left` equals its `left` at scrollLeft 0 and `scrollWidth <= clientWidth + 1` of the strip element. | rects |
| Q18 | Sorting: sort by `correct` descending, then ascending, then by Date: in each state every pass row is the immediate successor chain of its own run row (pass 1, 2, 3 in order, same `data-run-id` of the nearest preceding run row) and the sort glyph appears only on the column header. | DOM order walk |
| Q19 | Select mode at 1440: every pass row has a checkbox named `Select pass n of {k} of run {run}` in the pinned select column (its `left` equals the run row checkbox `left`); ticking passes 1 and 3 leaves the run checkbox `aria-checked="mixed"` and the selection bar counts 2 executions; ticking all three checks the run and counts 3; picking the run clears its passes and vice versa (the existing `passes.spec.ts` rules); shift-click from pass 1 to pass 3 selects exactly passes 1..3. | `aria-checked`, selection bar text |
| Q20 | Virtualisation: with 50 runs of which 12 have 10 passes, expanding all 12 raises `tr` count to more than 200 display rows without any run row or pass row being missing between two visible rows (each pass row's predecessor in DOM is the run or the previous pass or the strip) and without a console error; scrolling to the bottom and back keeps the open state; expanding the 10th run changes that run row's `getBoundingClientRect().top` by at most 1 px. | seed 50 runs; `data-index` continuity; rect before and after |
| Q21 | Loading: with the passes request delayed 1.5 s, expanding the 3-pass run shows 3 child rows `Loading passes...` at 32 px each, the run row has `aria-busy="true"`, and when the data arrives the table's height changes by 0 px (+- 1). | `page.route` delay; table height before and after |
| Q22 | Error: with the passes request failing, expanding shows 1 child row with `Could not load passes` and a `Retry` button; pressing it refetches and replaces the row with the passes. | `page.route` abort then continue |
| Q23 | Queued: a run with `samples` 5 of which 2 have started shows 2 pass rows and 1 row `Passes 3-5 waiting to start` with a `QUEUED` badge (a stopped run shows `not run` with a `NOT RUN` badge); the queued row has 32 px height and empty score cells. | seed running run |
| Q24 | Live: for a RUNNING repeat run, after the 15 s refetch the expanded group stays expanded, the pass row elements keep their identity (a `data-probe` attribute set on pass row 1 survives), the focus stays on the focused pass row and `scrollLeft` is unchanged. | attribute probe; `activeElement`; scrollLeft |
| Q25 | Persistence: expand the 3-pass run, open pass 2 (`?pass=2` run page), press Back: the group is open again with its 3 pass rows; reload of the page starts collapsed only when `sessionStorage` is empty (it is restored in the same tab). The URL of the runs page never contains the expanded ids. | `sessionStorage['qym:runs:expanded:<slug>']`; `page.url()` |
| Q26 | Accessibility: `table` has `role="treegrid"`; run rows `aria-level="1"`, pass rows `aria-level="2"`, `aria-posinset` n and `aria-setsize` 3; strip row `aria-level="2"` and name `Group metrics of {run}`; axe reports 0 serious and 0 critical violations at 1440 and 390 with a group open (also with the select column on). | attribute reads; `axeSeriousViolations` |
| Q27 | Heights at 1440 (density compact): run row 32, each pass row 32, strip 45 (<= 56); the 3-pass group adds 3 x 32 + 45 = 141 px (<= 150), the 10-pass group adds 10 x 32 + 45 = 365 px (<= 380). Current: 270 and 494. | `boundingBox().height` sum of the rows between the run row (exclusive) and the next run row (exclusive) |
| Q28 | Card mode at 390: the run card has the chevron `Expand 3 passes of {run}`; closed, the card has no `[role=group][aria-label^="Passes of"]`; open, the card contains one `ul[role=group]` named `Passes of {run}` with 3 `li` lines inside the same card element, each at most 56 px high and showing `Pass n`, the status badge, the selected-metric score and an overflow menu; the card has no horizontal scroll (`scrollWidth <= clientWidth`) and the page has none (`document.documentElement.scrollWidth <= 390`). | rects; scrollWidth |
| Q29 | Card mode strip at 390: the strip is stacked inside the open card after the lines, at most 190 px, with the Metric select 100% wide (within 2 px of the strip's content width) and the five stats in 2 columns; choosing another Metric changes the score shown in the three lines. | rects; text |
| Q30 | Card select mode at 390: each pass line has a checkbox named `Select pass n of {k} of run {run}`; with passes 1 and 3 ticked the card's checkbox is mixed (`aria-checked="mixed"`) and the selection bar says 2. | `aria-checked` |
| Q31 | Reduced motion: with `prefers-reduced-motion: reduce` expanding a group applies no transition (0 ms `transition-duration` on the pass rows) and rows appear in the first frame; with motion allowed the rows fade in within 150 ms and never animate `height`. | `getComputedStyle(tr).transitionDuration` |
| Q32 | Removal: the page no longer renders the embedded passes table: `[role=region][aria-label^="Passes of"]`, `table[aria-label$=" passes"]` and the `Show all metrics` button have count 0 at 1440 and 390. | locator counts |

Count: 32 criteria.

## 6. Implementation notes

### 6.1 DataTable change (`frontend/src/ui/DataTable/`)

- New props: `childRows?: (row: R) => ChildRows<R> | undefined` and `childRowKey` is not needed (children use `rowKey`).
  `type ChildRows<R> = { state: 'ready'; rows: R[] } | { state: 'loading'; count: number } | { state: 'error'; error: unknown; onRetry(): void }`.
  A row has children when the callback returns a value and its key is in `expanded` (the same `expanded` / `onExpandedChange` /
  `canExpand` props, so `RunsPage` state is reused; `renderExpanded` is still honoured and is now independent of the chevron).
  Children are rows of type `R`; `RunsTable` makes `R = RunRow | PassRow` (a discriminated union with `kind: 'run' | 'pass' |
  'queued' | 'loading' | 'error'`), so every `Column.cell(row)` stays the single renderer and `cellFor` switches on `row.kind`.
- `buildDisplayRows` (`model.ts`) gets a `children` option and emits `{ kind: 'child'; id; key; row; parent; level: 2; posinset; setsize }`
  after the parent and before the `detail` row (the strip). `display` stays one flat list, so keyboard navigation (`rowDisplayIdx`),
  `rangeKeys`, virtual indexes and `aria-rowindex` need no second code path.
- Render: `tbody` loop adds a `child` branch that renders the same `renderTd` cells (pinning, widths, reorder are the table's own),
  with `data-child`, `aria-level`, `aria-posinset`, `aria-setsize`, `rowProps(r)` for `data-pass-row`; row class `styles.childRow`
  (surface `--bg-void`, rail on the first `td`, zebra off). `rowState` and zebra index skip children.
- Selection and focus: children are selectable rows keyed by the pass ref; `isIndeterminate` already exists. Row focus and
  roving `tabindex` use the same `isFocusStop` logic. Add ArrowRight / ArrowLeft handlers for expand / collapse and
  parent-focus (currently Enter on `renderExpanded` rows toggles at lines ~796-813).
- Card mode (`CardList`, ~1700-1957): render `childRows` lines inside the card `li` below the facts (same `childRows` call, the
  `priority: 1` cells plus the `cardMetric` column id the page names); `detail` (strip) after them.
- Gallery/tests: `DataTableGallery` gets a "child rows" case; unit tests in `ui/DataTable/__tests__`.

### 6.2 Runs list migration (`frontend/src/features/runs-list/`)

- `PassesPanel.tsx` is split: `usePassChildren(row)` (data: `useRunPasses`, `passRowsView`, refetch 15 s while `isActiveRun`)
  returns the `ChildRows`; `PassGroupStrip.tsx` (header controls and `PassStats` in one flex-wrap row, `PassThreshold`,
  `HelpMarker`, group metrics query) is the `renderExpanded` content; `PassesTable.tsx` and `PassesPanel.module.css` /
  `PassesTable.module.css` are deleted; `IssuesCell` moves to `cells.tsx`; `mirroredMetrics` and the "Show all metrics" state are
  removed (a hidden column is hidden everywhere), `toPassRows` becomes `toPassRow`. `passRowsView`, `queuedText`, `passIssues`,
  `issuesSummaryText`, `readStoredMetric` / `writeStoredMetric` stay in `passes/model.ts`.
- `RunsTable.tsx`: `cellFor(col, row, p)` gets the `row.kind` switch (table in 4.3); `rowProps` adds `data-pass-row`; `rowKey` is
  `row.kind === 'run' ? run_id : passRef(...)`; `selection` keeps `passRef`, `rowChecked`, `viaPasses`, `isIndeterminate`
  unchanged (the child rows' keys are already `passRef`); `onNotePassRevision` fires from `usePassChildren`; delete confirm
  dialog moves up to `RunsTable` (one dialog, `deleting: {runId, pass}`); `canDeletePass` unchanged.
- `RunsPage.tsx`: `expanded` additionally read from / written to `sessionStorage` (`qym:runs:expanded:<slug>`, a pure helper in
  `passes/model.ts` or `selection.ts`).
- `useRunsKeyboard.ts`: row stops include pass rows (they come through the DataTable display list); `j/k` and the `x` select
  shortcut act on the focused display row.

### 6.3 Specs

Update: `e2e/runs-list/passes.spec.ts` (panel locators become `tr[data-pass-row]` and the strip group; select-mode tests keep
their assertions), `passes-panel-layout.spec.ts` (replace "horizontal scroll never drags the panel" with Q17, compact-row test
with Q27, phone test with Q28 to Q30), `cutover-passes.spec.ts` (delete and renumber flow: only the row locator changes),
`a11y.spec.ts` and `keyboard.spec.ts` (treegrid levels, Arrow keys), `selection-compare.spec.ts` and `cutover-selection.spec.ts`
(pass checkboxes), `live-status.spec.ts` (Q24), `table-redesign.spec.ts` (expanded block measurements).
New Playwright `e2e/runs-list/passes-rows.spec.ts` with tests named `Q1 collapsed by default`, `Q2 chevron adds the passes as
rows of the same table`, `Q3 keyboard`, `Q4 pass cells line up with the run cells`, `Q5 scroll moves run and passes together`,
`Q6 reorder applies to passes`, `Q7 frozen column applies to passes`, `Q8 hide and resize apply to passes`, `Q9 density`,
`Q10 to Q12 cells and actions`, `Q13 group marker`, `Q14 to Q17 strip`, `Q18 sort keeps children under the parent`,
`Q19 select mode`, `Q20 virtualised`, `Q21 to Q24 states and live`, `Q25 persistence`, `Q26 a11y`, `Q27 heights`,
`Q28 to Q30 card mode`, `Q31 reduced motion`, `Q32 removed panel`; seed via `seedWideRepeatRun`-style helpers plus the 50-run
case.
Vitest (pure logic): `ui/DataTable/__tests__/childRows.test.ts` (`buildDisplayRows` order run, children, strip; posinset and
setsize; collapsed emits none; grouped and sorted input), `features/runs-list/__tests__/passChildren.test.ts` (`ChildRows`
state mapping: loading count, error, queued row, running status override), `.../expandedStorage.test.ts` (read, write, prune,
corrupt value), `.../passCells.test.ts` (which columns are inherited-empty for a pass row, `cellFor` kind switch).
Then: `cd frontend && npm run check`, `pytest tests/platform/test_design_language.py`, the new spec and the folder
`e2e/runs-list` through `scripts/heavy.sh` (cost 3), per `AGENTS.md`.

### 6.4 Tokens and design language

No new colour token. Section 3 "Data table" gets one sentence: child rows (`childRows`) are rows of the same column model,
`--bg-void` surface, 3 px `--accent-primary` group rail, no wash, no opacity. If the reviewer finds `--bg-void` too dark on a
projector, the permitted change is the child surface only (amendment rule, section 7).

## 7. Decisions made here (no owner answer was needed)

- D1 Strip as one sticky row under the passes, not a header band (4.4; the band would put the first pass 45 to 77 px from its run).
- D2 Inherited run facts are blank in pass rows, not dimmed repeats (4.3; legacy repeats were noise, the run row is adjacent).
- D3 Expansion state stays in `RunsPage` memory, mirrored to `sessionStorage`, not in the URL (4.2).
- D4 Pass rows are one density height; item counts surface only while a pass is running or partial (Run cell) and in the strip
  title; the old `Items` column is dropped because the parent table has no Items column and the strip says `k . N items`.
- D5 Card mode shows one score (the strip's selected metric) per pass line to keep lines at most 56 px; the pass link opens
  the full pass.
- D6 `Avg latency` leaves the strip (the run row has the Latency column, the pass rows carry their own).

## 8. Out of scope

Charts page group columns, run-detail repeat analysis (round 3), the server API, and pass-level filtering of the runs list.
