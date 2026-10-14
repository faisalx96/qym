# Redesign brief 2: runs page (filters, column order and freeze, passes panel)

Area `runs-page`. Ports used: legacy 8871, React platform 8872, Vite 5872 (all stopped at the end).
Screenshots (1440 px unless noted, seeded demo project with 152 runs) are in
`/tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/61846e82-dc0e-402d-b3ec-d3565a3b1b04/scratchpad/runs-page/`:
`l-runs-1440|1280|768` (legacy), `r-runs-1440|1280|768|390` (React), `l-filter-model-open`, `l-columns-open`,
`l-passes` (legacy), `r-filters-open`, `r-columns-open`, `r-header-menu`, `r-passes`, `r-passes-2`, `r-passes-390`.
Builds on `redesign/tables.md` (DataTable v2) and `redesign/review-tables.md`; it extends v2, it does not replace it.

## 1. Feedback point

> runs page: (1) filters should be presented directly instead of hidden behind a filters button to allow fast
> filtration. (2) the user should be able to change columns ordering and which columns should be frozen. (3) enhance
> the UI shown for run passes analysis, it feels too cluttering and not user friendly.

**Reading.** The legacy runs page showed its filters at all times: a second toolbar row of six dropdown buttons
(Tasks, Datasets, Models, Versions, Status, Users; plus one per Evaluation-Service versioning key) next to the time and
origin segmented controls. Narrowing 400 runs was "click a dropdown, click a value" with the current choice written on the
button itself ("claude-sonnet-4", "3 selected") and tinted. The React migration chose a single `Filters` popover with
disclosure lists (UX_DECISION variant A: "filters are a mode you enter"); it is tidy but every filter now costs
open popover, open disclosure, tick, and the state is invisible until chips appear. "Intended UX" is therefore: the
common filters are always on screen, one click away from their values, and readable at a glance. For columns, legacy let
users choose which identity columns are frozen (a Frozen columns section of the Columns menu, default all seven frozen,
`qym:runs-frozen-columns`); the React migration dropped that (decision 9.4, "Frozen columns: no measurement code")
and the DataTable v2 has no reorder at all (tables.md Open Q4 deferred it). Legacy never had column reordering; this is a
new capability the owner now asks for. For passes, legacy rendered each pass as a real row inside the same table
(aligned under the parent's columns, context cells dimmed) with a single group-metrics strip underneath; React replaced it
with a card holding a stat strip, a controls row and a separate 11-column nested table.

## 2. Legacy page anatomy

Files: `qym-wt-legacy/.../_static/dashboard/index.html`, `dashboard.js`, `dashboard.css`.

### 2.1 Command bar (index.html:20-95, dashboard.css:791, 1025-1060, 1089-1120, 1272)
- One `.command-bar` (flex, wrap, gap 8/14 px, padding 8/20, `--bg-base`, bottom hairline). Not sticky itself; the page
  main below it scrolls with its own table container.
- Row 1 at 1440 (measured in the browser): search 240x24 (`#runs-search`, `/` focuses), Select 60x24, DISPLAY label +
  Columns dropdown 120x24, time segmented 225x24 (All, Today, 7d, 30d, Range -> inline date dropdown), origin segmented
  150x24 (All, Official, Local).
- Row 2 `.command-bar-filter-row` (1208 px wide, y=90): six `multi-select-btn` of **100x24 each** (min 100, max 160,
  `font-sm` 11 px, ellipsised), gap 8, then `Clear` + count badge (78x24, only when something is active). Versioning keys
  (`#versioning-filters`) are extra buttons of the same size in the same row, hidden when the project has none.
- Always visible: search, time, origin and all six facets. Nothing collapses at 1280 or 1440. At 768 the bar wraps to
  five stacked rows (`l-runs-768.png`). At <= 600 px `.filter-dropdowns{display:none}` and `.quick-filters{display:none}`
  (dashboard.css 4552ff): **the filters are not reachable at all on a phone** (a legacy gap; React must not copy it).
- How they combine: all dropdowns AND together; values inside one dropdown OR. Empty set = "All" (button text `All Tasks`);
  `__none__` = nothing; one value = that value as the button label; 2+ = `N selected`; active buttons get
  `.has-selection` (accent tint, `rgba(0,212,170,.08)` background). Each dropdown has search, `Select All` / `None`
  and 32 px checkbox rows (no "Only"); a change calls `render()` and refetches at once (URL: repeated keys,
  `replaceState`). No chips exist; the state is read from the button labels and the status-bar sentence
  ("5 of 152 runs - task: ...").
- Narrowing speed: facet in view -> 1 click to open, 1 click per value (the list starts all-checked, so to pick one value
  the user clicks `None` then the value = 3 clicks, or unticks the others), no popover to close (a click elsewhere closes).
  Two facets: about 6 clicks, zero navigation inside a popover.

### 2.2 Table, columns, frozen columns (index.html:98-130, dashboard.js:3760-3990)
- `<table data-frozen-columns="run status task model dataset owner time" data-frozen-edges="time">`. Seven identity columns
  (Run name, Status, Task, Model, Dataset, Owner, Date) are frozen by default (`RUNS_IDENTITY_COLUMNS`).
- Choice: Columns dropdown > scrolled to a **Frozen columns** section with one checkbox per identity column and a
  `Reset to default` link (`renderRunsFrozenColumnsSection`, dashboard.js:3853). Stored in `localStorage
  qym:runs-frozen-columns` (per browser, not per user).
- Guard: if the frozen block exceeds 55% of the visible table width (`RUNS_FROZEN_MAX_SHARE`) trailing frozen columns scroll
  until it fits, and the menu says "Unfrozen to fit this width: Date, Owner" (`runsFrozenFitNote`, :3925-3945). Offsets are
  measured per render (`applyRunsFrozenColumns`), edge column casts a separator shadow.
- **No column reordering exists** in legacy (grep for draggable/reorder in `dashboard.js` and `qym_table.js` is empty). Column
  order is fixed: identity columns, metrics, latency, trace, duration, actions. Visibility: Columns menu (Run columns,
  Metrics, System, Trace) kept in `sessionStorage qym_visible_metrics` (per tab).
- Density: header 10 px/34 px, rows 41 px (measured), cells 12 px, zebra none, row hover tint.
- A mirrored horizontal scrollbar is pinned at the bottom (`.qym-scroll-mirror`).

### 2.3 Passes panel (dashboard.js:4745-5130, screenshot `l-passes.png`)
- Chevron in the Run cell (`.samples-toggle`) inserts rows directly in the table body: one `<tr class="pass-member">` per
  pass (measured 42 px each, 3 passes) and, below them, one strip row (77 px) spanning all columns.
- Pass rows reuse the parent's columns, so a pass's scores sit exactly under the run's metric columns (the user compares a pass
  with its run by looking straight up/down). Task, Model, Dataset, Owner cells are repeated but dimmed; the Run cell shows
  "Pass 1 / 2 / 3" and the Status cell carries status, progress, error and retry chips; Date, Analyze link and delete icon
  are in their own columns; a green left rail marks the group (`pass-member-last` closes it).
- Strip (`samples-detail-header`, accent left rail): title `GROUP METRICS`, a Metric select, "PASS IF >= [slider] 80%", then
  one line of stats: `PASS@3 100.0%  PASS^3 37.5%  AVG@3 82.8%  CONSISTENCY 58.3%  RELIABILITY 70.8%  AVG LATENCY 1.6s`
  with title tooltips (no help icons).
- So legacy passes were: zero new column layout to learn, one strip, everything aligned; clutter came only from the strip's
  two lines. Limits seen: the metric columns scrolled off to the right at 1440 (`l-passes.png`), and pass detail columns
  (items, latency) existed only if those columns were visible.

## 3. React page anatomy

Component tree (`frontend/src/features/runs-list/`):
`RunsPage.tsx` -> `RunsTable.tsx` -> `DataTable` (`ui/DataTable/DataTable.tsx`) with
`DataTable.Toolbar` (search from `RunsToolbar.useRunsToolbarParts`, `filters` = `FiltersPopover.tsx`, `chips` = `chips.ts`
`activeChips`, `trailing` = `ColumnsMenu.tsx` + Select button; density menu from the primitive) and `DataTable.Footer`;
expanded row -> `PassesPanel.tsx`; selection chrome -> `SelectionBar.tsx`; columns catalogue `columns.ts`
(`buildColumns`), URL state `urlState.ts` + `useRunsView.ts`; data `useRunsData.ts`.

### 3.1 Filters (screenshot `r-filters-open.png`)
- Toolbar row: `Search runs` (260 px) + `Filters · n` button (data-testid `filters-trigger`, accent when active) + chips
  + (right) Columns, Select, Density. At 768 the right cluster wraps under the search (`r-runs-768.png`).
- Filters popover (460x304 px): `TIME` and `ORIGIN` segmented rows, then six one-line disclosures
  (`Tasks All >`, `Datasets`, `Models`, `Versions`, `Status`, `Users`; plus one per versioning key); only one is open at a time;
  an opened one shows search (only when more than 8 options), `Select all / Clear / None` and checkbox rows with `Only`;
  footer `Clear all` / `Done`. Custom range opens a `Dialog` and closes the popover first (a RAC popover paints above modals).
- Chips (`chips.ts`): one per active value (`task: text2sql x`), range, origin, search; `Clear n` button. Chips appear only
  when something is active, so an idle bar shows no filter state at all.
- Cost to filter by one model: click `Filters`, click `Models`, click `Only gpt-4o` (or tick), close with Done/Esc = 4 actions,
  and a second facet needs 2-3 more; the legacy equivalent is 2-3 and 2-3 with no popover. Keyboard `1-4` time shortcuts and `/`
  search exist (`useRunsKeyboard.ts`) and must stay.
- Facet data: `Facets` (`api/dashboardTypes.ts:158`) is lists of strings, no counts; values are already constrained by the other
  active filters server side (qa B9).
- `FiltersPopover` and `RunsToolbar` are also used by `ChartsPage.tsx` (and `ModelsPage` via `useRunsView`); the Reviews page
  has its own `features/reviews/FiltersPopover.tsx` (out of scope).

### 3.2 Columns, order, freezing (screenshots `r-columns-open`, `r-header-menu`)
- `ColumnsMenu.tsx` is page-level: a popover with search, All/None and two-column checkbox groups (Run columns, Metrics,
  System, Trace stats). Run is always shown and not listed. State is `visibleKeys` (`sessionStorage qym_visible_metrics`, per tab,
  legacy key) passed to `buildColumns`, which also decides the sort fallback (`sortColumnVisible`). All DataTable columns are
  declared `hideable: false`, so the primitive's own column menu is off.
- Order is fixed in code (`buildColumns`: Run, Status, Signals, first two metrics, Date, Task/Model/Dataset/Owner/Analysis/
  Experiment/Version, other metrics, latency, trace, Duration, Actions). No reorder UI.
- Freezing: DataTable v2 already supports `pin: 'start' | 'end'`, persisted per table in
  `localStorage qym:data-table:v2:runs.v2` (`useDataTableModel.setPin`), and the header kebab menu has `Pin left / Pin right /
  Unpin` (`DataTable.tsx:910-940`, `r-header-menu.png`: Sort asc/desc, Pin left, Pin right, Autosize, Reset all columns).
  RunsTable pins Run (start) and Actions (end) by default. Problems: undiscoverable (kebab appears on header hover only), pinning
  **moves** the column to the front block (`orderColumns` in `ui/DataTable/model.ts` partitions start/none/end), there is no
  "which columns are frozen" overview, no guard against a frozen block wider than the screen, and storage is per browser, not
  per user. At 768 the table shows only Run + Status before the pinned Actions (`r-runs-768.png`).
- E2E `cutover-sticky-columns.spec.ts` documents "the choosable Frozen columns section was dropped" (decision 9.4).

### 3.3 Passes panel (screenshots `r-passes-2.png`, `r-passes-390.png`)
`PassesPanel.tsx` (487 lines), rendered by `DataTable renderExpanded` in a detail row spanning the scroller:
1. A summary block: `Group metrics` + `k = 3 . 8 items`, then a six-item `dl` (Pass@3, Pass^3, Avg@3, Consistency, Reliability,
   Avg latency), five of them with a `HelpMarker` (i) icon, values as `ScoreValue` with a coloured left bar.
2. A controls row, right-aligned and detached from the stats: `Metric` select (180 px), `Pass if >= 80%` text, a 200 px slider
   with its own label `Pass threshold` and a bare `0.8` readout (so the threshold is stated three times: "Pass if >= 80%",
   "Pass threshold", "0.8").
3. A **nested table** with its own header (11 columns at 1440: Pass, Status, Date, Analysis, one per metric, Items, Avg latency,
   Duration, delete) that does not line up with the parent's columns above it. Status cell packs a badge, progress, and up
   to three chips (task error, metric error, retries); Analysis is a text link ("Analyze" / "N causes"); metric headers are
   uppercase and unformatted (`latency s`).
- Measured in the 1440 screenshot: panel 1160 x 236 px for 3 passes (about 5.6 row-heights), three nested tones (outer table,
  panel card with accent rail, inner table with a second header) and three type roles in the stats block.
- At 390 the table is cards and the passes panel is not visible in the card at all without scrolling into a detail
  (`r-passes-390.png` shows the drawer open; panel layout at phone width is unverified by this brief, flagged as a risk).
- Other places pass analysis appears from the runs page: the Charts page group stats columns (Pass@K, Consistency, Reliability
  toggled from its Columns menu, `columns.ts GROUP_DISPLAY_COLUMNS`) and the Analysis column link to the analyzer. Run-detail
  repeat-run analysis belongs to the run-detail brief, but the stat vocabulary below must match it.

## 4. Gap analysis

| # | legacy | react | why it matters | proposed change |
|---|---|---|---|---|
| F1 | 6 facet buttons + versioning keys always visible, 100x24 each, current value on the button, tint when active | One `Filters` button, popover, disclosure per facet, state invisible until chips appear | Slower to narrow, state not readable; the explicit feedback | Always-visible `FilterBar` row: facet triggers inline, value summary on the trigger, chips below when active |
| F2 | Time and origin segmented controls always visible | Inside popover | Time range is the most used filter | Time and origin segmented stay inline in row 1 |
| F3 | Facet dropdown is 1 click to open, list closes on outside click | Popover + disclosure + Done | 4 actions per facet | Each facet is its own `MultiSelect` popover (already a primitive), `Only` per option, no Done button |
| F4 | `Clear` + count badge at end of facet row | `Clear n` inside chip strip, `Clear all` inside popover | Parity | One `Clear n` at the end of the bar, visible only when active |
| F5 | Filters vanish at <= 600 px (gap) | Reachable but only via popover | Feedback applies on mobile too | Below 600 px: search + one `Filters n` button opening the same facet list in a bottom sheet (`Drawer`) |
| F6 | No chips | Chips only when active | Chips are a React improvement and tell exactly which values are active | Keep chips, place them in a dedicated line under the bar; trigger shows only the count |
| F7 | Versioning-key facets in the row | Disclosures in popover | Many keys explode the row | Collapse versioning keys and overflow facets under `More filters` |
| C1 | Frozen columns section with 7 checkboxes, default all frozen, reset, 55% cap + note, per browser | Per-column pin only from header kebab, defaults Run only, no overview, per browser | Feedback (2); regression vs legacy (decision 9.4) | Reinstate as first-class: freeze toggle per row in the Columns menu, "Frozen" section, cap with note, reset |
| C2 | No reorder | No reorder | New request, not a regression | Drag (and keyboard) reorder in the Columns menu, header menu Move left/right, optional header drag |
| C3 | Order fixed; visibility per tab | Same; pin moves a column to the front | Pinning a middle column must not change the order the user chose | Order is data (`order: string[]`); pinned-start columns form the leading prefix in the saved order; menu shows where the freeze line is |
| C4 | Settings in localStorage (frozen) and sessionStorage (visibility) | `runs.v2` localStorage (pins/widths) + sessionStorage (visibility) | "Persisted per user": nothing is per user, visibility is lost with the tab | One layout object per user and table (`qym:data-table:v2:runs.v2:<userId>`), including visibility; open question on server sync |
| C5 | Frozen block capped at 55% | No cap: many pins can leave no scroll room | Pin 6 columns at 768 and the table is unusable | Cap (default 50%) with an explicit note in the menu |
| P1 | Pass rows are table rows aligned to the parent columns | Nested table with its own 11 columns, misaligned with the parent | Alignment is what made legacy readable | Pass table uses the parent's visible metric columns in the same order and the same score cell (ScoreBar), fewer extra columns |
| P2 | One strip of 5-6 stats, tooltips, no icons | 6 stats, 5 help icons, separate controls row with a repeated threshold | Clutter and duplicated labels | One header line: title + metric + threshold chip; one stat band; help in tooltips, one `(i)` for the whole band |
| P3 | Status cell chips | Three chip kinds in the Status cell | Visual noise per row | One issues indicator per pass (glyph + count, tooltip lists task/metric errors and retries); keep all data |
| P4 | Analyze icon column | Text link column "Analyze / N causes" | Wide, repeated text | Row action icon with cause-count badge, text only on hover/focus |
| P5 | n/a | Panel may scroll horizontally with the table | The panel should not be dragged sideways | Detail cell sticky at the scroller start with the scroller's width |
| P6 | Threshold slider always shown | Slider always shown, 3 labels | Most users never change the threshold | Threshold chip `Pass if >= 80%` opens a small popover (slider + number + presets) |

## 5. Redesign spec

### 5.1 Filter bar (always visible)

Primitive: new `features/runs-list/FilterBar.tsx` (page level, it carries runs rules), reusing `ui/MultiSelect`, `SegmentedControl`,
`SearchField`, `Chip`, `Popover`/`Drawer`. `FiltersPopover.tsx` stays as the narrow-width and "More" body (its `FacetSection`
list) and `buildFacetDefs` stays the single source of facet definitions; `chips.ts` is unchanged. `RunsToolbar`/`ChartsPage`
adopt `FilterBar` too (same props: `view, facets, owners, onChange`).

Rows (container width of the table card; breakpoints are container queries, not viewport):

Desktop >= 1100 (1280/1440/1920):
```
+--------------------------------------------------------------------------------------------------------------+
| [Search runs               /]  Time [All|Today|7d|30d|Range]  Origin [All|Official|Local]   [Columns v][Select][Density] |
| [Task v] [Dataset v] [Model v] [Version v] [Status v] [User v] [More filters 2 v]               Clear 3      |
| task: text2sql x   model: gpt-4o x   status: Completed x   range: 7 days x                                  |
+--------------------------------------------------------------------------------------------------------------+
| Overview | Scores ...                       (table header band)                                              |
```
- Row 1 (32 px control height `--control-height` 24 + 4 padding): search 240-260 px, time segmented (225), origin segmented (150),
  right cluster Columns / Select / Density as today.
- Row 2: facet triggers, **each 24 px high, min 96 / max 168 px**, label is the facet name; with a selection the trigger becomes
  accent-tinted (existing `Button variant="accent"` look) and reads `Model · 2`, with one value `Model · gpt-4o` (ellipsised).
  Order by use: Status, Model, Task, Dataset, User, Version. (Legacy order Task, Dataset, Model, Version, Status, Users is also
  acceptable; recommended default: keep legacy order so muscle memory carries over, Open Q1.) `More filters` holds
  versioning-key facets and any facet that no longer fits; its badge shows how many active filters live inside it.
- Row 3 (chips): only rendered when `activeChips(view)` is non-empty; one wrapping line of `Chip isSelected onRemove`, the
  existing chip labels; `Clear n` ghost button right-aligned on row 2 (not in the chip strip). Chips collapse to a single
  "+N more" popover beyond two lines.
- Facet popover content = existing `MultiSelect` (search when > 8 options, Select all / None, `Only`, "Empty / Missing"); a
  click on a row applies at once (URL `replace`, request, page reset to 1 as today); Esc closes; no Done button. `Enter` on a
  trigger opens, `ArrowDown` moves through options (primitive behaviour).
- Time `Range` still opens `CustomRangeDialog`; origin and time shortcuts `1-4`, `/` unchanged.
- URL state **unchanged**: same keys (`task`, `model`, `dataset`, `status`, `version`, `owner`, `v.<key>`, `range`, `from`, `to`,
  `origin`, `q`, `sort`, `page`), same `__none__` / `__empty__` values, same `viewToParams`/`parseView`; no new params. The
  list-context `?list=` hand-off to the run page stays.

Tablet 600-1099 (768):
```
| [Search runs            /] [Columns v][Select][Density]                    |
| Time [All|Today|7d|30d|Range]   Origin [All|Official|Local]                |
| [Status v] [Model v] [Task v] [More filters 3 v]            Clear 3        |
| chips...                                                                   |
```
Overflow rule, deterministic and testable: inline facets by priority (Status, Model, Task, Dataset, User, Version); the ones that
do not fit in the row (measured with `ResizeObserver` on the row, fallback container-query thresholds 900 -> hide Version +
User, 760 -> hide Dataset) move to `More filters`, which opens the `FiltersPopover` body restricted to those facets with
`MultiSelect inline`.

Phone < 600 (390):
```
| [Search runs        /] [Filters 3]  |
| chips (horizontal scroll)           |
| [Columns][Select][Density]          |
```
`Filters n` opens a bottom `Drawer` containing Time, Origin and every facet as inline disclosures (today's popover body), with
`Clear all` and `Show N runs` footer. This fixes the legacy gap (filters hidden <= 600).

Sticky/scroll: the toolbar stays inside the table card above the scroller (as now); rows 1-3 together must be at most 104 px at
1440 (today 50 px; legacy 2 rows = 66 px). The table header remains sticky below it.

Motion: trigger tint 120 ms `--transition-fast`; chip enter/exit 120 ms opacity+height; none under `prefers-reduced-motion`.

Sizing/tokens: only `--control-height`, `--space-sm`, `--font-sm` (trigger labels), `--font-base` (value), `--radius`
tokens from `tokens.css`; no new colours.

Behaviour that must remain: debounced search (200 ms), `Esc` clears search, `filterSummary` sentence in the footer, `Clear filters`
button in the empty state, `data-testid="filters-trigger"` kept on the `More filters`/phone `Filters` button so existing specs
only need re-targeting, a11y: bar is `role="toolbar"` labelled "Runs filters", each facet trigger `aria-haspopup="listbox"`
with `aria-label="Model filter, 2 selected"`, chip strip `role="group"` "Active filters".

### 5.2 Column order and freeze

**Model (extend `ui/DataTable`, used by every table):**
- `PersistedState` gains `order: string[] | null` (ids in display order; `null` = declared order). New: `useDataTableModel.setOrder(ids)`,
  `moveColumn(id, toIndex)`, `resetOrder()`. `resetColumns` also clears `order`.
- `orderColumns(cols, pins, order)`: 1) sort by `order` index (ids not in `order` keep their declared relative position, inserted
  after the nearest preceding declared column that is in `order`; unknown ids in `order` are dropped, so new or removed metrics
  never break a saved layout); 2) then partition: pinned-start first, unpinned, pinned-end last, **stable** (pinning no longer
  re-sorts the user's order inside each partition). Pure function, unit-tested.
- Selection/expand pseudo columns and `Actions` (`pin: 'end'`, `hideLabel`) are locked: not reorderable, not unpinnable.
- `Column.lockOrder?: boolean` (new), default false; set true for the Actions column and for `__select`.
- Pin semantics stay per column (`pin: 'start' | 'end' | null`) so API and storage keep working; "frozen" in UI copy = `pin: 'start'`.
- Freeze cap: new prop `maxPinShare?: number` (default 0.5). When the measured pinned-start width exceeds `share * scrollerWidth`,
  trailing pinned-start columns (never the first, and never a column the user focused) are rendered unpinned ("suspended") without
  changing saved state; `model.suspendedPins: string[]` exposes them so the menu can say "Not frozen at this width: Date, Owner"
  (legacy copy). Implementation: extend the existing `ResizeObserver` measurement (`DataTable.tsx:452-492`).
- Storage: `storageKey` may be scoped by a new prop `storageScope?: string` (the page passes the user id): key
  `qym:data-table:v2:<storageKey>:<scope>`; if absent, read the unscoped key once and migrate (copy then keep). `KEYS.dataTableState`
  gets an optional scope argument. Visibility for the runs table moves from `sessionStorage qym_visible_metrics` into the same
  object (`hidden`), with a one-time read of the legacy key (the legacy name stays readable, writes go to the new store).
  Runs keeps `visibleKeys` as the derived input to `useRunsData` (the server and `sortColumnVisible` need it).

**UI:**
1. **Columns menu** (replace page `ColumnsMenu.tsx`; reuse and extend `ui/DataTable/ColumnsMenu.tsx`, then delete the page-level
   copy). One popover, 320-360 px wide, scrollable list, search, `All` / `None` / `Reset layout`:
```
+------------------------------------------+
| Columns            [Search columns...]   |
| All  None                  Reset layout  |
|------------------------------------------|
| FROZEN (3)         Not frozen at this width: Date |
| ::  [x] Run                     [pin on ] |
| ::  [x] Status                  [pin on ] |
| ::  [x] Signals                 [pin on ] |
|---- scrolling columns --------------------|
| ::  [x] Answer correctness      [pin off] |
| ::  [x] Context recall          [pin off] |
| ::  [x] Date                    [pin off] |
| ::  [ ] Experiment                         |
| ...  (groups remain as sticky sub-headers: Run columns, Metrics, System, Trace) |
+------------------------------------------+
```
   Each row: drag handle (`::`), checkbox (visibility), label, pin toggle (icon button, `aria-pressed`, label "Freeze Status").
   Drag within a section reorders; dragging across the divider freezes/unfreezes (drop above the line = pin start). Keyboard:
   focus the handle, `Space` to lift, `ArrowUp/Down` to move, `Space` to drop, `Esc` cancels (React Aria `useDragAndDrop` with
   `onReorder` and keyboard support on `ListBox`/`GridList`; announce "Status moved to position 3 of 14, frozen"). Hidden columns
   are listed dimmed in their position and can be re-ordered too. Group headings stay as labels only while the search is active;
   in the default view the list is flat in display order (grouping would contradict reordering) with a muted group tag per row.
2. **Header menu** (existing kebab / `Shift+F10`): rename `Pin left`/`Pin right` to `Freeze column` / `Unfreeze`, add `Move left`,
   `Move right`, `Move to start`, `Hide column`; `Pin right` stays only for the Actions-style end columns (hidden for runs).
   Keyboard on a focused header: `Alt+Shift+ArrowLeft/Right` moves the column (extends the existing `Alt+Arrow` resize pattern),
   announced via the live region.
3. **Optional header drag** (phase 2): pointer drag on the header label with an insertion marker; same `moveColumn`. Not required
   for acceptance; the menu drag and header-menu moves cover mouse, touch and keyboard.
4. **Discoverability**: the `Columns` button shows a dot when the layout differs from default and a tooltip "Reorder, hide and
   freeze columns"; the frozen block gets the existing edge shadow and a 1 px divider (already in v2 CSS).
5. **Defaults**: frozen = Run only at <= 1280, Run + Status at >= 1440 (legacy froze seven; the cap makes seven unsafe).
   Default order = today's `buildColumns` order. `Reset layout` returns order, pins, widths, visibility to these defaults.
6. **Mobile** (< 640, card mode): reorder/freeze do not apply to cards; the Columns menu still controls visibility and, for cards,
   the `priority` stays code-defined. The menu hides the pin toggles and drag handles under 640 px.

Per-user persistence: layout key includes the user id (`me.id`), so two people sharing a browser keep separate layouts; the layout
follows the browser profile, not the account (no server preference API exists: `grep preferences|user_prefs` over
`packages/platform/qym_platform/api` is empty). Server sync is Open Q3.

### 5.3 Passes panel (calmer)

Keep the expanded-row mechanism (`renderExpanded`) and every capability; change the layout. New file layout under
`features/runs-list/passes/`: `PassesPanel.tsx` (shell, data), `PassStats.tsx` (the band), `PassThreshold.tsx` (chip + popover),
`PassesTable.tsx` (embedded DataTable). `passRowsView` stays exported.

```
Desktop (1440), inside the detail row; sticky to the scroller start, width = scroller width
+--------------------------------------------------------------------------------------------------------+
| |  Passes   3 passes . 8 items      Metric [answer correctness v]   Pass if >= 80% [edit]   (i) what is this? |
| |  +----------+----------+----------+----------+----------+                                                   |
| |  | Pass@3   | Pass^3   | Avg@3    | Consist. | Reliab.  |   one StatStrip, 5 tiles, each: value + thin bar  |
| |  | 100.0%   | 37.5%    | 82.8%    | 58.3%    | 70.8%    |                                                   |
| |  +----------+----------+----------+----------+----------+                                                   |
| |  #   Status          Date          Answer corr.   Context recall   Items   Latency   Duration  Issues  ... |
| |  1   COMPLETED       Oct 7 16:15   [==] 85.3%     [==] 77.8%       8/8     1.6s      43s       --      A v |
| |  2   COMPLETED       Oct 7 16:16   [==] 68.9%     [==] 94.6%       8/8     1.5s      47s       --      A v |
| |  3   COMPLETED       Oct 7 16:17   [==] 94.4%     [==] 94.8%       8/8     1.6s      44s       1 !     A v |
+--------------------------------------------------------------------------------------------------------+
  (A = Analyze icon with cause count badge, v = delete icon in the row overflow)
```
- Container: one surface level only (`--bg-inset`-style token already used by the detail row, 2 px accent rail kept as the group
  marker; no inner card, no second header band). Padding `--space-md`, gap `--space-sm`. The panel is `position: sticky;
  inset-inline-start: 0; width: var(--dt-scroller-width)` so horizontal scroll never drags it (P5).
- Header line (32 px): left `Passes` (`--font-md` 600) + muted `3 passes . 8 items` (`--font-sm`); right: Metric `Select` (compact,
  160 px), threshold chip `Pass if >= 80%` (a `Button` variant neutral, opens `PassThreshold` popover with the `Slider`, a
  `NumberField` in %, and 50/70/80/90 presets, "Reset to the metric's default"), and a single `HelpMarker` whose popover defines
  the five stats once (replaces five inline markers). "No direction declared" shows muted text and hides the chip.
- Stat band: existing `StatStrip` (`ui/StatStrip`) with five items, label `--font-sm` muted, value `ScoreValue` (keeps direction
  colour) plus a 2 px bar under the value reusing the score-bar recipe; Avg latency leaves the band (it lives in the pass table and
  in the parent's Latency column). Labels use tooltips (`title` plus the shared help popover) with the current wording.
- Pass table: `DataTable variant="embedded"` (`columnMenu={false}`, `density="compact"`), columns in this order: select (select
  mode only), `#` (link, opens the pass), Status (badge plus progress text only while running), Date, **the same visible metric
  columns as the parent in the same order and widths** using the parent's score cell, Items, Latency, Duration, Issues, Actions.
  Numeric metrics keep `formatNumericValue`. Header labels via the same `headerText` (underscores to spaces, fixes `latency s`).
  Columns the user hid in the parent are hidden here (a pass table never shows a metric the parent hides); a muted footer link
  `Show all metrics (+2)` toggles the rest for this panel.
- Issues cell: one muted glyph plus count (`!` task errors in danger tone, `~` metric errors in warn tone, `retry` count in info
  tone), shown only when non-zero; tooltip text identical to today's chips; empty cell is a thin dash. Replaces three chip styles.
- Row actions (`rowActions`): primary icon button `Analyze` (shows `N` cause badge; hidden for running/pending passes as today),
  overflow `DropdownMenu` with `Open pass`, `Delete pass` (same permission and status rules: `canDeletePass`, confirm dialog,
  `expectedVersion`). Row click still opens the pass; text selection guard (M1) reused.
- Queued/not-run passes: one muted line `Passes 4-5 waiting to start` (or `not run`) with the existing badge, no empty cells.
- Select mode: per-pass checkboxes as today (parent becomes indeterminate), unchanged selection model (`passRef`).
- States: loading skeleton 3 lines; error `ErrorState compact`; live runs refetch every 15 s (unchanged); `aria-busy` on the band while
  group metrics reload; the band keeps its previous values dimmed while the threshold changes (no layout jump: fixed tile height).
- Motion: expand/collapse uses `Collapse` (120-180 ms height/opacity); none under `prefers-reduced-motion`; threshold change
  cross-fades values 120 ms.
- Persisted: last chosen metric per project in `sessionStorage qym:runs:passes-metric:<slug>` so a second repeat run opens on the same
  metric; threshold stays per run per metric (the server `rule` default applies first).

Tablet 768: header line wraps (title row, then metric + threshold row); stat band 3 + 2 tiles; table scrolls inside the panel
(embedded table scroller) with `#` and Status frozen.

Phone 390 (the parent is in card mode; the panel is the card's expanded section):
```
+------------------------------+
| Passes   3 passes . 8 items  |
| [Metric: answer corr. v]     |
| [Pass if >= 80%]        (i)  |
| Pass@3  100.0%  Pass^3 37.5% |
| Avg@3    82.8%  Consist 58.3%|
| Reliability 70.8%            |
|------------------------------|
| #1  COMPLETED     85.3%   >  |
|     Oct 7 16:15 . 1 retry    |
| #2  COMPLETED     68.9%   >  |
| #3  COMPLETED  ! 94.4%    >  |
+------------------------------+
```
Pass rows become compact cards (`DataTable` card mode, priority 1 = `#`, status, selected metric score; the chevron opens the pass).

Charts page group columns (Pass@K, Consistency, Reliability) keep their names and formats; tile labels in the panel use the same
strings so the vocabulary is one set. Run-detail repeat-run analysis is specified by its own brief.

### 5.4 Primitive changes summary

| Primitive | Change |
|---|---|
| `ui/DataTable` | `order` state + `moveColumn`, stable `orderColumns`, `Column.lockOrder`, `maxPinShare` + `suspendedPins`, `storageScope`, Columns menu v2 (drag handles, pin toggle, Frozen section, Reset layout), header menu items (Freeze/Move/Hide), `Alt+Shift+Arrow` move, `--dt-scroller-width` CSS var for sticky details |
| `ui/MultiSelect` | `triggerVariant?: 'field' \| 'bar'` (24 px bar button, count on trigger), `summary?: (selected) => string` so the trigger text is `Model . 2`; Esc/arrow behaviour unchanged |
| `ui/Drawer` | reused as the phone filter sheet (no change expected) |
| `ui/StatStrip` | optional per-item `bar?: number` (0-1) for the thin score bar, `variant="compact"` height |
| new `features/runs-list/FilterBar.tsx`, `passes/*` | as above |

## 6. Work plan

Independent unless a dependency is named. Hours are for one agent including tests.

| # | Task | h | Files | Tests | Deps / risks |
|---|---|---|---|---|---|
| W1 | `FilterBar` (rows 1-3, facet triggers via `MultiSelect`, chips line, `Clear n`, overflow into `More filters`, phone `Filters` drawer), adopt in `RunsPage` and `ChartsPage`, keep `FiltersPopover` body for More/phone, retarget `filters-trigger` testid | 10 | `features/runs-list/FilterBar.tsx`, `FilterBar.module.css`, `RunsToolbar.tsx`, `RunsPage.tsx`, `ChartsPage.tsx`, `FiltersPopover.tsx`, `ui/MultiSelect/*` | Vitest: overflow priority/threshold function, trigger summary text, URL round-trip unchanged (`urlState.test.ts` untouched); Playwright new `e2e/runs-list/filter-bar.spec.ts` (inline facets visible at 1440/1280/768/390, one-click facet filter with `Only`, chips match, Clear n, More at 768, phone drawer); update `filters-sort-search`, `cutover-runs-list`, `keyboard`, `ux-layout`, `a11y`, `cutover-versioning`, `charts`, `support.ts` | MultiSelect popover inside a toolbar with many triggers must not steal focus order; a11y toolbar roving. Independent of W2/W3 |
| W2 | DataTable model: `order`, stable `orderColumns`, `moveColumn`, `lockOrder`, `storageScope` + migration, visibility into the persisted object with legacy-key read | 6 | `ui/DataTable/model.ts`, `useDataTableModel.ts`, `types.ts`, `lib/storage.ts` | Vitest: order merge with new/removed ids, pin stability, lock, migration of unscoped key, reset; no UI yet | none; touches all tables (23 callers): back-compat default `order=null` |
| W3 | Columns menu v2 (drag handles, keyboard reorder, pin toggle, Frozen divider, Reset layout, announcements), header menu items, `Alt+Shift+Arrow`, `maxPinShare` + suspended note; remove page `ColumnsMenu.tsx`, wire runs visibility to `model.hidden` while still feeding `useRunsData` | 12 | `ui/DataTable/ColumnsMenu.tsx`, `DataTable.tsx`, `DataTable.module.css`, `features/runs-list/RunsTable.tsx`, `RunsPage.tsx`, `columns.ts`, `selection.ts` (legacy key read) | Vitest: ColumnsMenu drag/keyboard reorder via `@testing-library` + pointer simulation, cap logic; Playwright `e2e/runs-list/columns-layout.spec.ts` (reorder by keyboard, freeze Status, reload persists, other user id shows default, cap note at 768, Reset layout); adjust `cutover-columns`, `cutover-sticky-columns`, `table-redesign` | W2. Risk: React Aria DnD inside a Popover (portal) and touch; cap measurement jitter |
| W4 | Passes panel rebuild (`PassesPanel` shell, `PassStats` on `StatStrip`, `PassThreshold` popover, embedded `PassesTable` with the parent's columns, Issues cell, row actions, queued line, sticky detail width, phone cards) | 12 | `features/runs-list/passes/*`, `PassesPanel.tsx` (re-export), `PassesPanel.module.css` (delete), `RunsTable.tsx`, `ui/StatStrip/*`, `ui/DataTable` (`--dt-scroller-width`) | Vitest: `passRowsView`, issues summary text, metric/threshold persistence; Playwright update `passes.spec.ts` and `cutover-passes.spec.ts` selectors (rows `data-pass-row`, delete flow unchanged), add `passes-panel-layout.spec.ts` (panel height <= 3.5 rows at 1440, band single row, no horizontal drag with scroll, 390 cards, reduced motion) | independent of W1-W3; reads parent's visible columns, so lightly coupled to W3's ordering (use `columnSet.visible` order) |
| W5 | Polish and docs: README of storage keys, `docs/DESIGN_LANGUAGE.md` additions (filter bar recipe, column menu recipe, passes panel recipe), gallery entries in `/__ui`, design-language test run | 3 | `docs/DESIGN_LANGUAGE.md`, `frontend/src/dev/*`, `frontend/README.md` | `npm run check`, `pytest tests/platform/test_design_language.py` | after W1-W4 |
| W6 (optional) | Header pointer drag-reorder with insertion marker | 6 | `ui/DataTable/DataTable.tsx` | Playwright drag spec | after W3 |

Total: W1 10 + W2 6 + W3 12 + W4 12 + W5 3 = **43 h** (+6 h optional W6). Parallel plan: W1, W2+W3 (one agent, W3 after W2), W4 can run
concurrently; W5 last.

Cross-cutting risks: (a) all existing specs that click `Filters` need re-targeting (10 references); (b) `FilterBar` height budget on
1280 x 720 (verify rows visible: table keeps at least 8 rows); (c) DataTable `order` touches every table, so ship behind `order=null`
default and run the whole `npm run check` plus `npm run e2e`; (d) per-user key uses `me.id`, in `QYM_AUTH_MODE=none` use the stable dev id.

## 7. Open questions (recommended default is what implementation will use)

1. Facet order in the bar: legacy (Task, Dataset, Model, Version, Status, User) or by use (Status, Model, Task, ...)? Default: legacy order, overflow priority by use.
2. Should chips stay once facet triggers show their count? Default: yes, one chip line under the bar (kept from React, an improvement over legacy).
3. Is "per user" satisfied by `localStorage` keyed by user id (per browser profile), or must layouts follow the account across devices (needs a platform
   preferences endpoint that does not exist)? Default: localStorage keyed by user id now; server sync is a later task.
4. Default frozen set: Run only, or Run + Status at wide screens (legacy froze seven, capped at 55%)? Default: Run (<= 1280) / Run + Status (>= 1440), cap 50%.
5. Should the legacy `qym:runs-frozen-columns` value be migrated (it held identity-column keys)? Default: no (it was dropped by decision 9.4); read nothing.
6. Reorder scope: only the runs table, or every DataTable (the model change is shared)? Default: capability in DataTable for all, the Columns menu drag UI enabled for the
   runs table and Items table first via a `reorderable` prop (default false elsewhere).
7. Passes panel: keep a nested embedded table (spec) or insert pass rows into the parent table like legacy (aligned automatically, needs child-row support in DataTable)?
   Default: embedded table with the parent's columns and widths; revisit child rows only if alignment feedback persists.
8. Threshold control: popover chip (spec) or always-visible slider? Default: popover chip with presets.
9. Remember the selected group metric across runs? Default: yes, per project and tab.

## Summary for the orchestrator

1. Legacy kept six facet dropdowns (100x24 each), time and origin always visible, state written on the buttons; React hid all of it behind `Filters` (4 actions per facet, state invisible until chips). Legacy hid filters at <= 600 px, React must not copy that.
2. Legacy had choosable frozen columns (seven, default all, 55% cap, per browser) and no reorder; React dropped freezing (decision 9.4), has pin only in a hover kebab, and pinning reorders columns.
3. Passes: legacy rows aligned under the parent columns plus one strip; React has a stat block, a separate controls row with the threshold stated three times, and an unaligned 11-column nested table (236 px for 3 passes).
4. Spec: always-visible `FilterBar` (rows: search/time/origin; six facet triggers + More; chip line; Clear n), phone drawer, URL state unchanged.
5. Spec: DataTable gains `order`, stable ordering, drag/keyboard reorder and a pin toggle with a Frozen divider in the Columns menu, header menu Move/Freeze, a 50% freeze cap with a note, per-user storage scope.
6. Spec: calmer passes panel: one header line (metric, threshold chip), one StatStrip, embedded table sharing the parent's visible metric columns, Issues glyph, row actions, sticky width, phone cards.
7. Estimate: 43 h (W1 filters 10, W2 model 6, W3 columns UI 12, W4 passes 12, W5 docs 3), +6 h optional header drag; W1, W2->W3 and W4 are parallel.
8. Defaults: legacy facet order; keep chips; layouts in localStorage keyed by user id (no server sync); frozen Run (+ Status >= 1440), cap 50%; reorder capability for all tables, UI on runs and items; embedded passes table; threshold in a popover chip; remember metric per project.
9. Risks: 10 e2e references to the Filters button, React Aria drag inside a portal popover, shared DataTable `order` change, toolbar height budget at 1280x720.
10. Evidence is in the scratchpad `runs-page/` screenshots; servers on 8871/8872/5872 stopped.
