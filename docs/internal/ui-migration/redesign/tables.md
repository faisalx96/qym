# Redesign brief: tables

Area `tables`. Ports used for the investigation: legacy 8821, React platform 8822, Vite 5822 (all stopped).
Screenshots (1440 px unless noted) are in
`/tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/61846e82-dc0e-402d-b3ec-d3565a3b1b04/scratchpad/tables/`
(`l-*.png` legacy, `r-*.png` React): `l-runs`/`r-runs`, `l-overview`/`r-overview`, `l-charts`/`r-charts`,
`l-items`/`r-run`, `l-compare-items`/`r-compare`, `l-ds-detail`/`r-ds-detail`, `l-admin`/`r-admin_runs`,
`r-admin_users`, `r-projects_demo_experiments_queue`, `r-runs-390`, `r-runs-cols`.

## 1. Feedback point

> table design is too simplistic and is not user friendly.

**Reading.** The data tables are the product's working surface (runs, items, compare, datasets, queue, admin). The
React migration ported the *look* of the legacy `.qdt-table` (header recipe, resize, sort) faithfully but stopped
there: `DataTable` is a flat grid with a 32 px row, one header line, no row hierarchy and no table chrome
(toolbar, footer, column menu, density, scroll cues, row actions, expansion, grouping, mobile mode). Everything
richer lives in page-private hand-rolled tables (`RunsTable`, the run-detail `ItemsTable` grid, compare `ItemList`,
`ChartsPage`, `PassesPanel`), so the app has one weak shared table and five bespoke ones with different behaviour.
"Intended UX" here means: the legacy pages gave each table a distinct, scannable structure (taller zebra rows with
chips, a score bar per metric, grouped header/rows, an in-table "Display / Columns" control, pinned footer with
count and pager, row disclosure with detail cards) and the user never had to leave the table to understand a row.
Note one fact that shapes the fix: legacy's *shared* `QymDataTable` (`qym_table.js`, 237 lines) was just as plain as
the React `DataTable`; the richness was per page (`.runs-table`, `.chart-table`, `.items-grid` in
`dashboard.css`). So the fix is not "restore the legacy CSS" but "promote what the legacy pages did bespoke into
one richer primitive", which the React app can then adopt everywhere.

## 2. Legacy page anatomy (tables only)

All legacy files under `/home/meshari-aldossari/Documents/qym/qym-wt-legacy/packages/platform/qym_platform/_static/dashboard/`.

**Shared `QymDataTable`** (`qym_table.js`, CSS `dashboard.css:212-320`): `table-layout: fixed`, sticky header
(`th` 6x10 px padding, `--font-sm`, uppercase, 650, `border-bottom: --border-default`), cells 5x9 px
(`--font-base`, line-height 1.35, nowrap + ellipsis), `tr` cursor pointer with 0.1 s hover, header-wide click sort with
a text arrow, drag column resize with a 5 px accent bar on header hover, widths persisted per `storageKey`.
Rows are built by a page-supplied `renderRow`, which is how pages added richness (sub-lines under a link,
badges, progress). Used by experiments (`experiments.js:971`), eval queue (`eval_queue.js:934,1046`), datasets
(`datasets.html:1845,3501,4099,4657`) and trash (`trash.html:407`).

**Runs list** (`index.html`, `dashboard.js` `renderTableView` 4359; screenshot `l-runs.png`). Toolbar is two always-visible
rows: search, Select, DISPLAY dropdown (Columns), time segments, origin segments; then six `All X` selects (Task,
Dataset, Model, Version, Status, User). Table `.runs-table` (`dashboard.css:2831-2990`): `width: max-content;
min-width: 100%`, cells `8px 12px` which renders ~42 px rows, header `--font-xs` uppercase on `--bg-surface` with
`--border-strong`, **zebra** (`nth-child(odd)` surface, `.run-row-even/odd` so inserted detail rows do not flip the
stripe), hover, selected row `--bg-active` plus a 2 px accent inset on the first cell, focused row outlined by inset
box-shadows. Identity cells are **chips** (task tag, model tag with colour dot, dataset tag), status is a badge with
live "50% - 5/10", an "Analyze" button column, date as `Oct 13 · 16:26`. **Frozen columns**: any of Run, Status, Task,
Model, Dataset, Owner, Time can be frozen (`data-frozen-columns`, `dashboard.css:3417-3490`), widths measured in JS
(`runsFrozenColumns`, `runsUnfrozenToFit`). **Column visibility**: Display menu lists metrics, trace stats and group
stats (`dashboard.js:1277-1410`), hidden via `data-hidden-columns` (`3494-3510`). Repeat runs have a row disclosure
that inserts a detail row. Horizontal scrollbar is pinned to the bottom of the viewport; a footer row shows
`43 runs`, `1-43 of 43 runs`, first/prev/page/next/last and `Last Updated`; keyboard row focus (`focusedIndex`,
j/k, Enter). Selection mode adds a checkbox column and a compare panel.

**Charts tables** (`dashboard.css:1828-2660`; `l-charts.png`): runs as rows, metrics as columns, each score a
**horizontal bar** filled to the value with the value printed on the bar (colour = model), latency bars relative to
the card max, sortable header labels, a "Runs / Grouped" switch, and **collapsible group header rows**
(`.chart-table-group-header`, nested version/model groups) carrying aggregates (avg per metric, pass@k,
consistency, reliability) in the same columns.

**Run-detail and compare items** (`.items-grid`, `run.html:6475`, `compare.html:5709`; `l-items.png`,
`l-compare-items.png`): not tables. Each item is a rounded 54-62 px card row: chevron, `#n`, Pass/Fail badge, input
preview, optional reason (2 lines: text + source), then **metric chips** (`exact_match True`, `execution_accuracy
54.0%` coloured). Failed items have a red outline. Click expands the item card in place. Compare shows one chip per
run, coloured square = run colour, missing runs simply absent. Toolbar above: search, `n of N items`, Display menu
(analysis metric), CSV. Pager at the bottom of the card.

**Datasets items** (`l-ds-detail.png`): `QymDataTable` with `#`, ID (2-line cell, mono), Input, Expected, Metadata,
Runs, Latency...; ~40 px rows; pager pinned to the bottom with a page-size select (`50/page`).

**Admin** (`l-admin.png`): tables live inside titled cards (title + subtitle in the card header), rows ~64 px for the
two-line Run cell (name over task), Actions column with a red "Force stop" button.

## 3. React table anatomy

Component tree and primitives (all under `/home/meshari-aldossari/Documents/qym/qym/frontend/src/`):

- `ui/DataTable/DataTable.tsx` (240 lines) + `DataTable.module.css` (195 lines): React Aria `Table` +
  `ResizableTableContainer`. Props: `columns` (`id,label,sortKey,width,minWidth,flex,align,mono,cell,resizable,hideLabel`),
  `rows,rowKey,storageKey,sort,onSortChange,onRowAction,stickyHeader,minWidth,hiddenColumns,emptyState,rowHref,selection,dimmed`.
  Look: 30 px header, 32 px rows (`height: 32px`, hard-coded), uppercase `--font-sm` header, a permanent 1 px divider
  between headers (resizer `::after`), `↕` glyph on every sortable header, hover tint, selected row
  `rgba(0,212,170,0.08)` (a literal, not a token), no zebra, `table-layout: fixed`, single-line nowrap cells. Empty =
  a centred line of text. No loading, error, footer, toolbar, column menu, density, pinned column, expansion, grouping,
  row actions, scroll cue, mobile mode or overflow tooltip. `dimmed` only fades the body to 0.55.
- Users of `DataTable` (23 files): Overview lists, datasets Items / Runs / item runs / deleted, experiments list,
  queue + remote queue, job history, environments, presets, best-run picker, admin runs/projects/users/maintenance,
  settings (API keys, LLM connections, members), profile, trash.
- Hand-rolled tables that bypass it: `features/runs-list/RunsTable.tsx` (320 lines, own CSS copy of the `.qdt`
  recipe; sticky first + last column, roving row focus, passes panel row; comment in the file and
  `decisions/overview-runs-list/DESIGN_NOTES.md:174` say DataTable cannot do this), `features/run-detail/components/items/ItemsTable.tsx`
  (CSS grid + virtualizer + one button per row), `features/compare/components/items/ItemList.tsx` (card list with
  pills), `ChartsPage.tsx`, `PassesPanel.tsx`, `MatrixCard`, `RepeatTab`, compare Metrics/Steps/Categories/RootCause
  tabs. 19 files contain a raw `<table`.
- Pagination is the separate `ui/Pagination` placed by each page; the runs list pins it in its own `StatusBar`.

Observed in the running app (probes with Playwright, 1440 px):
- Runs list (`r-runs.png`): clean and denser than legacy (32 px, sticky Run + Actions, `Columns` menu with groups,
  `Filters` popover with chips). First screen shows identity + status + signals but **no score at all**; metric columns
  start beyond Date, off-screen, with no scroll cue. At 390 px (`r-runs-390.png`) only Run and Actions are visible; nothing
  says more columns exist and there is no card mode.
- Run detail items (`r-run.png`): a real column grid, good, but 3 more column-width schemes (`FIXED` in `ItemsTable.tsx`),
  header labels truncate (`EXACT_MA...`, `EXECUTION_...`), no column menu, metric cells are plain `ScoreValue`.
- Compare items (`r-compare.png`): card rows with a pass/fail glyph per run; no numeric score, no delta, header is a
  small `A`/`B` label pair; labelled "Item-by-item" nowhere visible.
- Datasets items (`r-ds-detail.png`): checkbox + 9 sortable columns + hover actions; input/expected truncated at
  roughly 35 characters while the column has room for more because widths are fixed pixels; no row preview, no wrap.
- Admin (`r-admin_runs.png`): two-line Run cell inside a 35 px row (probe: row height 35.2 px) so name and task nearly
  touch; actions sit in an unlabeled trailing column; trailing empty header cell shows a stray divider.
- Queue (`r-projects_demo_experiments_queue.png`): 11 columns, empty state fine; the bulk buttons sit above the table in a
  free-floating row, disconnected from the selection checkboxes.
- `docs/DESIGN_LANGUAGE.md` §3 promises "Wide tables expose only the persistent mirrored horizontal scrollbar";
  `grep -ri mirror frontend/src` finds no implementation.

## 4. Gap analysis

| # | legacy | react | why it matters | proposed change |
|---|---|---|---|---|
| G1 | Runs rows ~42 px (8x12 px padding), chips for task/model/dataset | All tables 32 px (hard-coded), plain text for task/dataset | Scanning speed and "feels like a real data grid"; two-line cells (admin Run, queue Experiment) are cramped at 32-35 px | Density modes `compact 32 / regular 40 / comfortable 52` as tokens, user toggle, per-table default; `secondary` (second line) is a column feature that forces min row height |
| G2 | Zebra on runs (`dashboard.css:2943`) | No zebra anywhere | Eye tracking across 12 columns | `zebra` prop (default `auto`: on when density != comfortable and rows > 8), `--bg-base`/`--bg-surface` alternation, stable under expansion |
| G3 | Column group stripes: charts group headers, "Display" menu groups | Single header line, no column groups | Compare (per-run score+delta), run items (per-pass columns), runs (metrics vs system vs trace) need a band | Column `group` renders a second header row with a bottom rule; groups collapsible when `groupCollapsible` |
| G4 | Score bars in charts table, chips in item rows | `ScoreValue` is text + 2 px bar only; bar logic duplicated in `ChartsPage` | Numbers alone do not show magnitude; all score columns look identical | `ScoreBar` cell (track + fill + value, direction aware, relative scale for non-%), reused by Charts, Runs, Items, Datasets |
| G5 | Compare chips carry the value; table shows per-run averages with baseline delta | Compare items show glyph only (Pass/Fail), no score or delta | The compare question is "what changed"; the table drops the number | `DeltaCell` (signed, arrow, band colour), baseline column marker, winner highlight; compare items become a DataTable matrix |
| G6 | Row disclosure inserts detail row (runs passes, item cards) | DataTable cannot; three bespoke implementations | Expansion is the main "report-like" interaction for items | `renderExpanded` + `expanded/onExpandedChange`; one detail-row implementation with `aria-expanded`, keyboard Right/Left, lazy mount, zebra-safe |
| G7 | Collapsible group rows with aggregates (charts, nested version/model) | None | Grouping by model/version/dataset is core to the product | `groupBy` with collapsible group header rows, per-column `summary` aggregates, group state persisted |
| G8 | Freeze any identity column | Runs: CSS-sticky first and last column only in the hand-rolled table; DataTable has none | Wide tables lose their key | `pin: 'start' | 'end'` per column (cumulative offsets measured once with ResizeObserver, CSS sticky), edge shadow when scrolled |
| G9 | Display menu hides/shows columns on runs only | `ColumnsMenu` only on runs; `hiddenColumns` prop on DataTable has no UI | Every wide table (items, queue, admin runs) needs it | Column menu part of the primitive: header kebab + toolbar `Columns` popover with search, groups, All/None, Reset, persisted |
| G10 | Header sort is the whole cell; text arrow only when sorted | Same plus a `↕` on every sortable header and a divider after every header | Visual noise at rest, and no way to unsort or tell asc from desc at a glance | Sort glyph only on hover/active; three-state cycle (asc, desc, none) where backend allows; sorted column body gets a subtle tint |
| G11 | Pinned footer: `n runs`, range, pager, `Last Updated` | Footer only on Runs; every other table puts `Pagination` somewhere ad hoc (or has none) | Users cannot see "how many" or page consistently | `DataTable.Footer` inside the card: count/range, selection count, page size, `Pagination`, last-updated slot |
| G12 | Bottom-pinned horizontal scrollbar on runs | None (DESIGN_LANGUAGE claims it) | Wide tables hide columns silently, worst at 390/768 | Scroll shadows (CSS-only) plus a sticky mirrored scrollbar rail; implement what the design doc already promises |
| G13 | Two-row toolbar with all filters always visible (heavy but visible) | Runs: popover + chips (good); other tables: filters float above the card with no relationship to the table | Filters and table feel unrelated; active filters hidden | `DataTable.Toolbar` slot order: search, Filters, chips strip, count, Columns, Density, Export; header cell shows a dot for a filtered column; filtered-empty state offers "Clear filters" |
| G14 | Selected row = `--bg-active` + 2 px accent bar; focused row outlined | Selected = hard-coded rgba tint; no bar | Selection state should read at a glance and be tokenised | `--bg-selected` token, 2 px accent inset on first cell, keep inset focus ring |
| G15 | Row-level buttons ("Analyze", "Force stop") visible | Actions are loose buttons in an unlabeled last column; runs has sticky icon strip | Inconsistent, wide, and not reachable on touch | `rowActions` (1-2 primary icon buttons + overflow `DropdownMenu`), revealed on hover/focus on pointer devices, always visible on touch; pinned end |
| G16 | Loading = page skeleton | `Skeleton kind=table` is a different shape from any real table; `dimmed` fade on refetch | Layout shift, no refresh cue | `loading` renders skeleton rows with the real column template; `refreshing` shows a 2 px progress line under the header, rows stay at full opacity |
| G17 | Empty row text "No runs match current filters" | Centred text; Runs has `EmptyState` | Three empty cases are indistinguishable | `empty`, `filteredEmpty`, `error` states with title, body, action; keeps header visible |
| G18 | Cells clip with ellipsis, `title` on some | Same, no `title`, no way to see the full value | Truncated ids/inputs are unreadable (`q-0...`, `{"category":"shipping...`) | Auto tooltip on overflow, `truncate: 'middle'` for ids, `wrap: n` line clamp for text columns, copy-on-hover for `id` type |
| G19 | n/a | Numbers: per-column `mono` flag only, formatting ad hoc per page | Misaligned decimals, mixed units | `type: 'number' \| 'score' \| 'duration' \| 'date'` sets alignment, mono, tabular-nums, formatter, right-aligned header |
| G20 | n/a (legacy had j/k on runs only) | Runs j/k + Enter; DataTable uses React Aria grid nav; run items one button per row; compare cards | Three keyboard models | One model (section 5.7), `?` shortcut list for any table with focus |
| G21 | Mobile: horizontal scroll | 390 px: only Run + Actions visible, no cue; datasets same | Mobile and narrow windows lose the table's meaning | `responsive: 'cards'` below 640 px using column `priority`; stacked card per row with primary line, 2-3 key values, expand for the rest |
| G22 | Resize handle appears on header hover (5 px accent bar) | Always-visible grey divider; no auto-fit; no reset | Dividers are noise at rest, no double-click fit | Divider on hover/focus only; double-click autosizes; `Reset widths` in column menu |
| G23 | Runs rows are `tr` with whole-row open | `rowHref` only on DataTable; runs uses dblclick; items use a button | Clicking a row should mean the same everywhere | `rowHref`/`onRowOpen`: click opens (unless on interactive child), `Enter` opens, `Space`/`x` selects, chevron expands |
| G24 | n/a | `selection` has no bulk-action surface, no shift-range, no select-all-matching | Queue and datasets use free buttons; users cannot bulk act predictably | `bulkActions` slot rendering a selection bar that replaces the toolbar; shift-click range; `selectAllMatching` hook for server-paged data |

## 5. Redesign spec: one `DataTable` (v2) for the whole app

### 5.1 Principles
1. One primitive, one markup (`<table>`), one keyboard model, one set of tokens. `RunsTable`, run-detail `ItemsTable`,
   compare `ItemList` and the Charts/Passes tables are migrated onto it; no page owns table CSS afterwards
   (`design-language.test.ts` gets a rule: raw `<table` only in `ui/DataTable` and docs prose).
2. Rich by composition, plain by default: a three-column admin list stays three plain columns; every feature below is
   a prop that defaults off or auto.
3. Everything inside existing tokens. Allowed additions: row-height tokens, `--bg-selected`, `--table-header-height`.
4. Keep the locked header/cell recipe asserted by `design-language.test.ts:254` (`.thead th` and `.tbody td` rules).

### 5.2 Architecture decision (needs a 4 h spike first)
React Aria `Table` is used today. It gives selection/checkbox semantics and `ColumnResizer`, but its `TableBody` accepts
only `Row` children, so interleaving a detail row, group header rows and a sticky first column needs workarounds
(this is exactly why `RunsTable` was hand-rolled). **Default: replace RAC `Table` with our own `<table>` markup driven by
a headless hook `useDataTableModel`** (sort, selection, expansion, grouping, pinning, widths, hidden columns,
focused row), keeping RAC only for `Checkbox`, `Button`, `Menu`/`Popover`, `useFocusRing`. The roving-row-focus pattern
is already proven in `RunsTable` + `useRunsKeyboard`; resizing is a ~60-line pointer/keyboard handler (the legacy
`startResize` is the reference). Fallback if the spike shows RAC can host synthetic detail rows via `colSpan` Cells and
`disabledKeys`: keep RAC and add only the new parts. Either way the public API below is the contract.

### 5.3 Public API

```ts
type Density = 'compact' | 'regular' | 'comfortable';          // 32 / 40 / 52 px
type CellType = 'text' | 'id' | 'number' | 'score' | 'delta' | 'date' | 'duration' | 'status' | 'tags' | 'actions';

interface Column<R> {
  id: string;
  header: ReactNode;                 // replaces `label`
  hint?: ReactNode;                  // HelpMarker in the header
  group?: string;                    // header band, e.g. 'Metrics', 'Run A'
  type?: CellType;                   // alignment, mono, tabular-nums, default formatter, header alignment
  accessor?: (r: R) => unknown;      // default cell value + client sort + CSV export
  cell?: (r: R, ctx: CellCtx) => ReactNode;
  secondary?: (r: R) => ReactNode;   // muted second line (--font-sm, --text-muted)
  sort?: string | { key: string; first?: 'asc' | 'desc'; compare?: (a: R, b: R) => number };
  width?: number; minWidth?: number; maxWidth?: number; flex?: boolean;
  pin?: 'start' | 'end';
  resizable?: boolean;               // default true
  hideable?: boolean;                // default true; false = always shown (e.g. first column)
  defaultHidden?: boolean;
  priority?: 1 | 2 | 3;              // 1 = shown in card mode headline, 2 = card body, 3 = card detail only
  truncate?: 'end' | 'middle';       // default 'end'; auto tooltip when clipped
  wrap?: number;                     // clamp to n lines (forces min row height)
  summary?: ReactNode | ((rows: R[]) => ReactNode);  // footer/group aggregate cell
  filtered?: boolean;                // dot in header when a filter targets this column
}

interface DataTableProps<R> {
  'aria-label': string;              // required
  columns: Column<R>[]; rows: R[]; rowKey: (r: R) => Key;
  storageKey?: string;               // persists widths, hidden, pins, density, group collapse: qym:data-table:v2:<key>
  // look
  density?: Density;                 // default per table; user override persisted
  zebra?: boolean | 'auto';          // default 'auto'
  variant?: 'card' | 'embedded';     // embedded: no outer border/radius, for use inside Card/StatStrip sections
  stickyHeader?: boolean;            // default true; sticks under the shell header offset
  scrollCues?: boolean;              // default true: edge shadows + mirrored scrollbar rail
  // data states
  loading?: boolean; refreshing?: boolean; error?: unknown; onRetry?: () => void;
  empty?: ReactNode; filteredEmpty?: ReactNode;   // EmptyState nodes; `filteredEmpty` shown when `isFiltered`
  isFiltered?: boolean;
  // sort
  sort?: SortState | null; onSortChange?: (s: SortState | null) => void;   // null = unsorted
  // rows
  rowHref?: (r: R) => string | undefined; onRowOpen?: (r: R) => void;
  rowState?: (r: R) => 'error' | 'warn' | 'live' | 'new' | undefined;     // 3 px left rail (--error/--warning/--info/--accent-primary)
  rowActions?: (r: R) => RowAction[];   // {id,label,icon,primary?,danger?,onPress,disabled?,hint?}
  // selection
  selection?: { selected: Set<Key>; onChange(keys: Set<Key>): void; mode?: 'multiple' | 'single';
                isDisabled?: (r: R) => boolean; selectAllMatching?: { total: number; onSelectAll(): void } };
  bulkActions?: ReactNode;           // rendered in the selection bar that replaces the toolbar while selected.size > 0
  // expansion
  renderExpanded?: (r: R) => ReactNode;
  expanded?: Set<Key>; onExpandedChange?: (keys: Set<Key>) => void;      // uncontrolled when omitted
  expandOnRowClick?: boolean;        // default false (click opens when rowHref/onRowOpen is set)
  // grouping
  groupBy?: { key: (r: R) => string; label: (key: string, rows: R[]) => ReactNode; collapsible?: boolean; defaultCollapsed?: boolean };
  // responsive
  responsive?: 'scroll' | 'cards';   // default 'cards' below 640 px when any column has priority
  // virtualization
  virtualize?: boolean | { estimateRowHeight: number };    // default: on when rows.length > 200
  children?: ReactNode;              // <DataTable.Toolbar/> and <DataTable.Footer/> slots
}
```

Parts (compound components, rendered inside the table card so chrome and body share one border):
- `DataTable.Toolbar`: `search`, `filters` (Filters popover trigger), `chips` (the existing filter chip strip,
  generalised from `runs-list/chips.ts` into `ui/FilterChips`), `count`, `trailing`. Built-ins appended on the right:
  Columns menu (only when any column is hideable), Density toggle (only when `density` is not locked), `Export` slot.
- `DataTable.Footer`: `summary` (e.g. `1-50 of 423 runs`), `selectedCount`, `pagination` (props of `ui/Pagination`
  incl. page-size options), `trailing` (e.g. "Last updated hh:mm:ss"). Sticky to the bottom of the table card when the
  card is taller than the viewport.
- `DataTable.ColumnsMenu` (also used standalone by Charts): groups from `Column.group`, search, All/None, Reset.
- Cell kit in `ui/DataTable/cells`: `ScoreBar`, `DeltaCell`, `TwoLine`, `IdCell` (mono, middle-truncate, copy on
  hover via `CopyButton`), `RelativeTime` (relative text, absolute in tooltip), `TagsCell` (first 2 + `+n` popover),
  `UserCell` (`Identicon` + name), `ProgressCell` (thin bar + `5/10`), `StatusCell` (wraps `RunStatusBadge` /
  `Badge`), `NumberCell` (right aligned, `formatNumericValue`).

### 5.4 Visual spec (all tokens exist unless marked NEW)
- Header: height 34 px (NEW `--table-header-height`, was 30), `--bg-elevated`, uppercase `--font-sm` 650 muted
  (recipe unchanged), bottom border `--border-default`. Group band row above it: 24 px, `--bg-surface`, group name
  `--font-sm` muted (not uppercase), a 1 px `--border-default` rule under the group's span.
- Sort: glyph hidden at rest, `↑/↓` in `--accent-primary` when active, faint `↕` on header hover or keyboard focus. Active
  column body cells get `background: var(--bg-surface)` (subtle column tint). Header click cycles asc, desc, none.
- Rows: heights via NEW `--row-compact: 32px; --row-regular: 40px; --row-comfortable: 52px`; cell padding stays
  `0 var(--space-sm)` and first/last cell `var(--space-md)`. Two-line (`secondary`/`wrap`) raises the minimum to the
  next density step so text never touches the border. Borders `--border-subtle`. Zebra alternates `--bg-base` and
  `--bg-surface` by logical row index (detail rows do not shift it).
- Hover: `--bg-hover`; row actions fade in (opacity .0 to 1, `--transition-fast`) on `:hover`/`:focus-within`; on
  `(hover: none)` they are always visible.
- Selected: NEW `--bg-selected` (the current literal `rgba(0, 212, 170, 0.08)` moved into a token) + 2 px
  `--accent-primary` inset on the first cell. Focus: 1 px inset `--accent-primary` ring (existing).
- Row state rail (`rowState`): 3 px inset on the first cell: error `--error`, warn `--warning`, live `--info`,
  new `--accent-primary`. Replaces the three ad hoc implementations (`data-live`, `data-failed`, red outline).
- Numbers: right aligned with a right-aligned header, `--font-mono`, `tabular-nums`; score via `ScoreBar` (6 px track
  `--bg-elevated`, fill `--score-1..5` from `metricBand`, direction aware, neutral accent-free grey for no direction;
  value text `--text-primary` 650 to the right of the track; error cell shows the existing warning glyph, never a bar).
- Dividers between headers only on hover (resize affordance) and on pinned-column edges.
- Pinned columns: CSS `position: sticky` with offsets computed once per width change; 1 px divider plus a 12 px
  gradient shadow appears only when the scroll container is scrolled away from that edge.
- Scroll cues: left/right edge shadows (CSS `background-attachment: local` technique, no JS) plus the mirrored
  horizontal scrollbar rail sticky at the bottom of the viewport (this is the behaviour DESIGN_LANGUAGE §3 already
  promises). Only one scrollbar is visible: the table container hides its native one.
- Card variant: `--bg-base`, `--radius-md`, `--border-subtle`; toolbar and footer sit inside on `--bg-surface` with
  1 px separators. `embedded` variant: no outer chrome, header not sticky, `compact` density, used in Overview lists,
  Passes panel, settings mini tables.
- Motion: row-action fade, sort-tint, expanded-row height transition `--transition-fast`/150 ms; all disabled under
  `prefers-reduced-motion: reduce` (expanded rows then appear instantly).
- Empty/loading/error: the header always stays; body shows `Skeleton` rows built from the real column template
  (`loading`), an `EmptyState compact` (`empty`), an `EmptyState` with a "Clear filters" action (`filteredEmpty`) or
  `ErrorState` with Retry (`error`). `refreshing` draws a 2 px `--accent-primary` indeterminate line under the header;
  rows are not dimmed.

### 5.5 Header column menu
Hover/focus a header reveals a kebab (`IconButton`, 20 px) at the cell end opening a `DropdownMenu`: Sort ascending,
Sort descending, Clear sort, separator, Pin left, Pin right (or Unpin), Hide column, Autosize column, Reset all columns.
Double-click on the resize edge autosizes (measures `scrollWidth` of rendered cells, capped by `maxWidth`). Right-click
on a header opens the same menu. All actions persist under `storageKey`.

### 5.6 Selection, expansion, grouping, bulk actions
- Selection checkbox column is pinned start, 36 px, header checkbox with indeterminate; shift-click selects a range;
  `selectAllMatching` shows a one-line banner under the toolbar ("50 selected. Select all 423 runs") for server-paged
  tables (Runs, Datasets items).
- While `selected.size > 0` the toolbar is replaced by a selection bar (`n selected`, `bulkActions`, Clear). It occupies
  the same 40 px so the table does not jump. The runs list's current `SelectionBar` and the queue's loose buttons become
  `bulkActions` content.
- Expansion: leading chevron cell when `renderExpanded` is given; detail row is a `<tr>` with one `colSpan` cell,
  `aria-expanded` on the main row, content mounted lazily; Right/Left arrows expand/collapse the focused row. Expanded
  row background `--bg-base`, inset 2 px rail in the row's colour.
- Grouping: `groupBy` inserts a group header row (chevron, label, count, per-column `summary` aggregates in the column
  cells, so averages line up under their columns exactly like the legacy charts table). Groups are sortable by an
  aggregate via `sort.compare`. Collapse state is persisted per group key.

### 5.7 Keyboard (one model)
`Tab` enters the table once (roving row focus; interactive cells inside a row are reached with `Tab` after the row,
and `Escape` returns to the row). `ArrowUp/Down` moves rows, `Home/End` first/last, `PageUp/PageDown` +10 rows,
`Enter` opens (rowHref/onRowOpen), `Space` or `x` toggles selection, `ArrowRight/Left` expands/collapses (or scrolls
horizontally when the row is not expandable), `j/k` alias for Down/Up on tables with `rowHref` (keeps the runs list
muscle memory), `/` focuses toolbar search, `?` opens a shortcut sheet scoped to the table. Header: `Enter/Space`
sorts, `Shift+F10` or `ContextMenu` opens the column menu, `Alt+Arrow` resizes by 16 px (existing `ColumnResizer`
behaviour kept). Virtualized rows keep `aria-rowindex`/`aria-rowcount`.

### 5.8 Responsive
| width | behaviour |
|---|---|
| 1920 / 1280 | table fills the card; flex columns absorb space; Input/Expected columns get `wrap: 2` at regular density |
| 768 | rail collapsed by shell; same table, pinned first column, edge shadows and the mirrored rail visible; toolbar wraps to two rows (search + Filters, then Columns/Density) |
| 390 | `responsive: 'cards'`: each row becomes a card: line 1 = pinned/first column + row actions menu, line 2-3 = columns with `priority: 1`, `priority: 2` as a 2-column key/value grid, expander shows `priority: 3`; header becomes a sort `Select`; footer pager compact; selection checkbox leads the card |

Tables with no `priority` metadata keep horizontal scroll with cues (never a silent crop).

### 5.9 Wireframes

Desktop (1440, runs list after migration; `^` = pinned, `~` = zebra row):
```
 [ Search runs  /]  [Filters · 2 v]  (status: Completed x)(task: text2sql x)  Clear      43 runs   [Columns v][Density v][Select]
 +--------------------------------------------------------------------------------------------------------------------------+
 |                RUN ^                | RUN ───────────────────────────────  | SCORES ─────────────────────── | SYSTEM ─── |
 | [ ] > Run            ⋮ | Status     | Task      | Model        | Date      | exact_match   | exec_accuracy  | Latency |  ⋮  |
 +--------------------------------------------------------------------------------------------------------------------------+
 |▌[ ] > text2sql-gpt-4o-000   [COMPLETED] text2sql  ● gpt-4o       Oct 13     ██████░░ 62% | █████████ 94% | 1.6 s | ✓ 🗑 ⋯ |
 |  ~  [ ] > summarize-gpt-4…  [COMPLETED] summarize ● gpt-4o       Oct 12     ███████░ 80% | ████████░ 86% | 1.3 s |      ⋯ |
 |     [ ] v rag-qa-gpt-4o-005 [COMPLETED] rag-qa    ● gpt-4o  x3   Oct 6      ██████░░ 55% | █████░░░░ 61% | 1.5 s |      ⋯ |
 |        +- Passes: #1 ... #2 ... #3 ...  (nested embedded DataTable)                                                       |
 +--------------------------------------------------------------------------------------------------------------------------+
 | 3 selected · Select all 43 runs      1–43 of 43 runs     « ‹ [1] of 1 › »      [50/page v]       Last updated 16:30:12   |
 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ mirrored horizontal scrollbar rail (sticky) ▁▁▁▁▁▁▁▁▁▁▁▁▁▁
```
Compare item-by-item as a matrix:
```
 [Search…] [Filters v] [Display v] (only changed x)           9 of 9 items                       [CSV]
 +-------------------------------------------------------------------------------------------------+
 |        |                          | ● A  claude-sonnet-4 (baseline)  | ● B  gpt-4o                   |
 | #      | Input                    | exact_match | accuracy           | exact_match | accuracy | Δ      |
 |   1    | { "q": "question 1" }    | ✗ Fail  ▓▓░  | 12% ▓░░            | ✓ Pass      | 94% ▓▓▓  | ▲ +82  |
 |   3  ▌ | { "q": "question 3" }    | ✓ Pass       | 100%               | ⚠ Error     | —        | ▼ n/a  |
 +-------------------------------------------------------------------------------------------------+
```
Mobile (390) card mode:
```
 [Search] [Filters]            [Columns]
 ┌──────────────────────────────────┐
 │ [ ] text2sql-gpt-4o-000      ⋯   │
 │ [COMPLETED]  ● gpt-4o  Oct 13    │
 │ exact_match ██████░░ 62%         │
 │ accuracy    █████████ 94%        │
 │                         v More   │
 └──────────────────────────────────┘
 1–43 of 43   ‹ 1 of 1 ›
```

### 5.10 Per-table adoption notes

| table | file(s) | adoption |
|---|---|---|
| Runs list | `features/runs-list/RunsTable.tsx`, `columns.ts`, `cells.tsx`, `ColumnsMenu.tsx`, `StatusBar.tsx` | Delete the hand-rolled table. Columns map 1:1 (`ColumnDef` to `Column`: `group` = existing `ColumnGroup`, `pin: 'start'` on Run and `'end'` on Actions, `sort` = `sortKey`). Passes panel via `renderExpanded` (nested `variant="embedded"` table), select mode via `selection` + `bulkActions` (replaces `SelectionBar`), live rail via `rowState`, status bar content moves into `DataTable.Footer`. Default order change: put the first two metric columns directly after Status so a score is visible on first paint (see Open Q3). Task/dataset become `Tag`-style chips (legacy parity). Keep `useRunsKeyboard` only for the app-level shortcuts that are not table navigation (`g`, `?`). `density="compact"` default here (the page is dense by purpose). |
| Run detail items | `run-detail/components/items/ItemsTable.tsx`, `ItemCard.tsx`, `PassColumns.tsx`, `Heatmap.tsx` | Rebuild on DataTable: `#`, status badge, Input (`wrap: 2`), Reason (`secondary` = source), one `score` column per selected metric (`ScoreBar`) grouped as "Metrics", Latency (`duration`), trace icon in actions. `renderExpanded` = existing `ItemCard`; `rowState` = error rail (replaces `data-failed` outline); `virtualize` (the shell-scroller virtualizer logic moves into the primitive's `scrollParent` option); pass columns become a `group` per pass. Fixes the truncated `EXACT_MA...` headers (column `minWidth` from header text length, header tooltip). |
| Compare item-by-item | `compare/components/items/ItemList.tsx`, `ItemsSection.tsx`, `OutputCard.tsx` | Turn into the matrix above: `group` per run (`●` colour dot, baseline badge), per-run score column(s) from the chosen analysis metric, `DeltaCell` vs baseline, "winner" cell emphasis, `rowState` for regressions (`warn`) and errors, `renderExpanded` = `OutputCard` grid. Sticky header carries the run legend (replaces `.head` sticky). Server paging stays; footer pagination. |
| Dataset items | `datasets/detail/ItemsTab.tsx` | Adds: pinned `#`, `wrap: 2` for Input/Expected with auto tooltip, `TagsCell` for metadata/labels, `renderExpanded` = read-only item preview (edit stays in the drawer), `selectAllMatching` for bulk delete/label, density toggle, column hide for rarely used `Edits`. Server sort/paging unchanged (`sort` controlled). |
| Dataset runs / item runs / deleted datasets | `datasets/detail/RunsTab.tsx`, `datasets/item/ItemRunsTab.tsx`, `catalog/DeletedDatasetsPage.tsx` | Use `ScoreBar`/`StatusCell`/`RelativeTime`, `rowHref`, `Footer` with counts; regular density. |
| Experiments list | `experiments/list/ExperimentsPage.tsx` | `ProgressCell` for runs done/total, `StatusCell`, `RelativeTime`, `rowActions` (Open, Duplicate, Cancel), group by status optional; toolbar with search + status filter chips. |
| Queue + remote queue + job history | `experiments/queue/QueuePage.tsx`, `RemoteQueueSection.tsx`, `experiments/detail/JobHistoryCard.tsx` | Selection with `isDisabled` (already), `bulkActions` = "Cancel selected" (the loose buttons above the table go away), `TwoLine` experiment cell (name + params summary, as legacy `exq-sub`), `ProgressCell`, `refreshing` while polling, `rowState` for failed/waiting, filters in toolbar chips (Environment/Status/Experiment/Only mine), `Footer` with `n jobs` and "refreshes automatically". |
| Admin runs / projects / users / maintenance | `admin/runs/RunTables.tsx`, `projects/ProjectsTable.tsx`, `users/UsersTable.tsx`, `maintenance/JobsTable.tsx` | `TwoLine` Run cell with `comfortable`-min row; `rowActions` replaces the trailing unlabeled button column (Edit/Disable, Force stop as `danger`); built-in toolbar search always available (replaces the "filter appears above 8 rows" special case from QA A7); `Footer` with totals. |
| Settings / profile / environments / presets / trash | `shell/settings/*`, `shell/profile/ProfilePage.tsx`, `environments/*`, `trash/TrashPage.tsx` | `regular` density, no toolbar, `rowActions` overflow menu, `empty` EmptyState with the add action. |
| Overview mini tables | `runs-list/OverviewPage.tsx` | `variant="embedded"`, `compact`, no sticky header, no footer; "View all" stays in the card header. |
| Charts tables | `runs-list/ChartsPage.tsx` | Replace raw table with DataTable using `ScoreBar` columns, relative-scale bars for latency/tokens, `groupBy` (model, version, version then model) with `summary` aggregates; "Runs / Grouped" stays as a toolbar segmented control. |
| Other raw tables | `PassesPanel`, `RepeatTab`, `MatrixCard`, compare Metrics/Steps/Categories/RootCause tabs, `RunCards`, `SweepView`, `UploadWizard`, `ExamplePicker`, `RoleTable` | Migrate opportunistically as `embedded` DataTables; matrix/heatmap cells (`MatrixCard`, `Heatmap`) stay specialised. Docs prose tables and the shortcuts dialog stay untouched. |

## 6. Work plan

Hours are implementation + tests for one agent. "Indep" = can run in parallel once its dependency is merged.

| # | task | hours | files | tests | depends | notes |
|---|---|---|---|---|---|---|
| T0 | Spike: RAC vs own table for detail rows/pinning (decide 5.2) | 4 | scratch only | n/a | none | gate for T2 |
| T1 | Tokens (`--row-*`, `--bg-selected`, `--table-header-height`), DESIGN_LANGUAGE §3 rewrite, design-language test rules (raw `<table` ban outside primitive, token use) | 3 | `styles/tokens.css`, `docs/DESIGN_LANGUAGE.md`, `__tests__/design-language.test.ts` | design-language test | none | indep of T0 |
| T2 | DataTable v2 core: model hook, columns/types, density, zebra, sticky header, group band, pin start/end, widths/hidden/density persistence, sort cycle, states (loading/refreshing/empty/error), footer + toolbar parts | 16 | `ui/DataTable/*` (split into `DataTable.tsx`, `useDataTableModel.ts`, `Toolbar.tsx`, `Footer.tsx`, `DataTable.module.css`) | Vitest: sort cycle, widths persistence, pin offsets, states; keep old export as `DataTableLegacy` alias for one release to allow staged adoption | T0, T1 | back-compat shim maps old `label`/`sortKey` props so the 23 existing callers keep working |
| T3 | Selection (range, select-all-matching, bulk bar), expansion, grouping with summaries, keyboard model + shortcut sheet | 12 | `ui/DataTable/*` | Vitest + axe (roles, aria-expanded/selected/rowindex), keyboard table tests | T2 | |
| T4 | Column menu (header kebab + toolbar Columns), autosize, reset, density toggle | 7 | `ui/DataTable/ColumnsMenu.tsx`, `HeaderMenu.tsx` | Vitest, a11y | T2 | indep of T3 |
| T5 | Cell kit (`ScoreBar`, `DeltaCell`, `TwoLine`, `IdCell`, `RelativeTime`, `TagsCell`, `UserCell`, `ProgressCell`, `StatusCell`, `NumberCell`) incl. overflow tooltip | 8 | `ui/DataTable/cells/*`, extend `ScoreValue` with `bar` | Vitest for formatting/direction/error cases | T1 | indep of T2/T3/T4 |
| T6 | Scroll cues + mirrored scrollbar rail, responsive card mode | 8 | `ui/DataTable/ScrollRail.tsx`, `CardRows.tsx`, CSS | Vitest + Playwright 390/768 | T2 | indep of T3/T4 |
| T7 | Virtualization (`@tanstack/react-virtual`, spacer rows, scroll parent option) | 4 | `ui/DataTable/virtual.ts` | Vitest with large row sets | T2 | |
| T8 | Gallery (`features/dev/UiGalleryPage.tsx`) with every feature, a11y pass | 4 | gallery | `ui-gallery` e2e axe | T3-T7 | |
| A1 | Adopt: runs list (delete `RunsTable.tsx`, port passes/select/footer) | 12 | `features/runs-list/*` | update `e2e/runs-list/*` specs, `__tests__` for columns/selection | T2-T4, T5 | biggest regression risk |
| A2 | Adopt: run-detail items table | 10 | `features/run-detail/components/items/*` | `e2e/run-detail/*`, virtualization smoke | T2, T3, T5, T7 | indep of A1 |
| A3 | Adopt: compare item matrix | 12 | `features/compare/components/items/*` | `e2e/compare/*` | T2, T3, T5 | indep of A1/A2; coordinate with the report-style compare redesign (other brief) |
| A4 | Adopt: datasets items/runs/deleted | 5 | `features/datasets/*` | `e2e/datasets/*` | T2, T3, T5 | indep |
| A5 | Adopt: experiments list, queue, remote queue, job history | 6 | `features/experiments/*` | `e2e/experiments/*` | T2, T3, T5 | indep |
| A6 | Adopt: admin, settings, profile, environments, trash, overview | 7 | `features/admin|shell|environments|trash|runs-list/OverviewPage` | `e2e/admin/*`, `e2e/shell/*`, `e2e/trash/*` | T2, T5 | indep |
| A7 | Adopt: charts tables (`groupBy`, bars) + remaining raw tables | 6 | `features/runs-list/ChartsPage.tsx`, panels | e2e charts | T2, T3, T5 | indep |
| T9 | Cleanup: remove legacy alias, delete dead CSS, update `frontend/README.md` and AGENTS-linked design docs, run `npm run check` + `pytest tests/platform/test_design_language.py` | 3 | various | full e2e | all | |

Core (T0-T8): about 62 h. Adoption (A1-A7): about 58 h. Cleanup: 3 h. **Total about 123 h.** Suggested split for agents: Agent 1 T0-T3, Agent 2 T4 + T6, Agent 3 T5 + T8 after T2 lands; then A1..A7 across up to four agents.

Risks:
1. Replacing React Aria `Table` changes keyboard/AT behaviour for 23 callers; mitigate with the shim, axe tests and the T0 spike.
2. Runs-list e2e specs encode the hand-rolled DOM (`data-testid="runs-table"`, row/button selectors); keep those test ids on the new markup and update only the selectors that change.
3. Sticky pinned columns plus zebra plus hover need opaque backgrounds on pinned cells; every state combination needs a CSS test (selected+hover+pinned).
4. Virtualization with real `<table>` and sticky header requires spacer rows; the run-detail items scroller (shell scroll container, `useScrollMargin`) must be passed through `scrollParent`.
5. Compare matrix depends on the compare/report redesign (separate brief); do A3 after that page structure is fixed, or keep the item list as a thin adapter.
6. Design-language test locks the header/cell recipe; do not move `font-size/color/background/text-transform` out of `.thead th` / `.tbody td`.

## 7. Open questions (recommended default is what implementation will use)

1. Default density. Default: `regular` (40 px) for every table except runs list and dataset items (`compact`, 32 px); user toggle persists per table.
2. Zebra. Default: on (`auto`) for list tables with more than 8 rows, off for embedded/small tables.
3. Should a score be visible on the first screen of the runs list? Default: yes, move the first two metric columns directly after Status and let Signals/Task/Dataset follow (column order remains user-controlled via the menu; no reorder drag in v1).
4. Column drag-reorder and saved views. Default: not in this scope; pin/hide/resize/density only.
5. Mobile card mode for every table or only those with `priority`. Default: only tables that declare `priority` (runs, items, compare, datasets items, queue, experiments); the rest scroll with cues.
6. Compare item-by-item as a table matrix vs the legacy card rows. Default: matrix (it is the only way to show score + delta per run on one line); expansion shows the legacy output cards.
7. Replace React Aria `Table` internally. Default: yes, own `<table>` markup (5.2), unless the T0 spike proves a RAC route in 4 h.
8. Server-wide "select all N matching" for the runs list and dataset items. Default: yes, with an explicit confirmation count in the bulk bar.
9. Row click behaviour. Default: click opens when `rowHref`/`onRowOpen` exists (single click, not double click as the runs list does today); selection only via checkbox/`x`/Space; select mode on the runs list keeps row-click-toggles-selection.
10. Inline cell editing (dataset items). Default: out of scope; keep the edit drawer.

## Summary for the orchestrator

1. Finding: legacy's shared `QymDataTable` was as plain as React `DataTable`; legacy richness (42 px zebra rows with chips, score bars, grouped rows, frozen/hidden columns, pinned footer, disclosure rows) was per-page, and React kept only the runs list and run-detail grid at that level, hand-rolled; the other 22 tables get a flat 32 px grid.
2. Biggest gaps: no row hierarchy (zebra, density, two-line cells), no score bars/deltas in tables (compare shows only Pass/Fail glyphs), no expansion/grouping in the primitive, no column menu or pinning, no footer/toolbar/filter relationship, no scroll cue (the doc promises a mirrored scrollbar that does not exist), no mobile mode (390 px runs list shows only Run + Actions), five bespoke tables with five behaviours.
3. Spec: one `DataTable` v2 (own `<table>`, headless model hook) with typed columns, density, zebra, column groups, pin start/end, header menu, `renderExpanded`, `groupBy` with aggregates, selection + bulk bar, toolbar/footer parts, loading/empty/filtered-empty/error states, scroll cues + mirrored scrollbar, card mode, virtualization, plus a cell kit (`ScoreBar`, `DeltaCell`, `TwoLine`, `IdCell`, `RelativeTime`, `TagsCell`, `ProgressCell`...).
4. Tokens to add: `--row-compact/regular/comfortable`, `--bg-selected`, `--table-header-height`; header/cell recipe locked by the design test stays intact.
5. Work: core primitive about 62 h, adoption about 58 h, cleanup 3 h; total about 123 h. T4/T5/T6 and A2-A7 parallelise after T2; runs-list (A1) is the riskiest.
6. Defaults: density regular (runs/dataset items compact); zebra auto; score visible first on runs list; no drag-reorder or saved views; card mode only for tables with `priority`.
7. Defaults (cont.): compare items become a matrix with expansion to the legacy output cards; replace React Aria Table internally unless a 4 h spike proves otherwise.
8. Defaults (cont.): "select all matching" for server-paged tables; single-click row open; inline cell editing out of scope.
9. Dependencies: compare adoption (A3) should follow the report-style compare redesign; run-detail items (A2) should follow the run-detail report restructure.
10. Evidence and screenshots: scratchpad `tables/` folder; servers on 8821/8822/5822 stopped.

## Decisions

### T0 spike: React Aria `Table` replaced by our own `<table>` (decided, implemented)
Spike (scratch Vitest, RAC 1.22.1, deleted afterwards): a RAC `Table` can host a synthetic detail row as a `Row` with a
`colSpan` `Cell` plus `disabledKeys`, and ArrowDown skips it. It still loses on four points that matter to this redesign:
(1) the detail row (and every group header row) is announced as `aria-disabled="true"` with `aria-selected="false"`,
so a content row reads as a disabled, unselected data row, and its interactive content (the passes panel) sits inside a
disabled row; (2) arrow keys cannot land in or expand it, and RAC offers no `aria-expanded` row or tree-grid semantics, so
Right/Left expansion needs a parallel key model anyway; (3) a second header band row (column groups) is not expressible
in `TableHeader`, and sticky pinned columns, zebra by logical index, and row state rails all need cell/row level control
that RAC's collection renderer owns; (4) the runs list was already hand-rolled for exactly these reasons. Decision: own
markup (`role="grid"`, `role="treegrid"` when rows expand so `aria-expanded` is valid), headless state in
`useDataTableModel`/`model.ts`, RAC kept for `Checkbox`, `Button`, `Menu`/`Popover`. Roles stay `grid`/`row`/`gridcell`/
`columnheader`/`rowheader`, so the existing specs that query those roles keep working.

### Implementation notes
- Back-compat shim: v1 column props (`label`, `sortKey`, `align`, `mono`), `emptyState`, `dimmed` (now the 2 px refresh
  line, rows are no longer faded), `onRowAction` keep working until the last adoption lands.
- Persistence: one key `qym:data-table:v2:<storageKey>` (widths, hidden, pins, density, collapsed groups); the v1
  `qym:data-table:widths:<key>` widths are still read as a fallback.
- Row click opens when `rowHref`/`onRowOpen` is set (single click, brief Q9); the runs list in select mode keeps
  click-toggles-selection (`selectOnRowClick`).
- Runs list: its filter toolbar, Columns menu (legacy `qym_visible_metrics` keys) and pinned status bar stay page-level
  (they carry runs-specific rules); the table, header bands, pins, cards, expansion and selection are the shared primitive.
  The header kebab omits "Hide column" there (columns are hidden from the page Columns menu so the two cannot disagree).

## Deferred

Delivered in this pass: T0 spike, T1 tokens and design doc, T2 core, T3 selection/expansion/grouping/keyboard, T4 column
menu/autosize/density, T5 cell kit, T6 scroll cues/rail/card mode, T8 gallery, A1 runs list, A4 datasets, A5 experiments,
A6 admin/settings/profile/environments/trash/overview, T9 legacy shim removed. Not done:

- **A2 run-detail items table and A3 compare matrix**: assigned to the second pass (other agent restructures those pages).
- **T7 virtualization** (`virtualize`, spacer rows, `scrollParent`): only the run-detail items table needs it, so it ships
  with A2. Estimate 4 h.
- **A7 `runs-list/ChartsPage.tsx`** (grouped table with `groupBy` + `summary` + relative-scale `ScoreBar`; the primitive
  already supports all three, see the gallery): not migrated, 914-line hand-built table with its own e2e (`charts.spec.ts`,
  `ux-charts.spec.ts`). Estimate 6 h. Other raw tables (PassesPanel, RepeatTab, MatrixCard, RoleTable, ...) stay as they are.
- **`?` shortcut sheet** scoped to a table and `Ctrl+A` select-all in the primitive: not built (the runs list keeps its own
  shortcuts dialog; trash has a local Ctrl+A handler). Estimate 2 h.
- **Runs list toolbar and status bar into `DataTable.Toolbar/Footer`**: they stay page-level (selection bar content, freshness
  note, cohort rules). The search field disappears while rows are selected on tables that use `bulkActions`. Estimate 4 h.
- **Dataset items read-only row preview** (`renderExpanded`), experiments-list Cancel row action (needs the detail page's
  cancel flow), search on the experiments list (no API param), `RowAction.hint` rendering. Estimate 3 h together.
- The `test.fail` spec in `e2e/runs-list/cutover-navigation.spec.ts` ("Back to a run restores its scroll...") belongs to
  run-detail and was left as it was.
