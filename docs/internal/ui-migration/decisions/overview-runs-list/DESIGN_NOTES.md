# Runs list / Charts / Overview — design notes (area 03, step 3)

Three TSX prototypes under `__mocks__/`, reachable on the dev server at
`/app/__mock/runs-list/dense`, `/app/__mock/runs-list/inline` and
`/app/__mock/runs-list/rail`. They share one data layer (`shared/data.ts`,
real fixtures captured from the API, no network), one filter/sort/selection
state machine (`shared/useMockRuns.ts`), one hand-rolled table
(`shared/RunsTable.tsx`), the Charts and Overview screens, the keyboard hook,
the shortcuts dialog and the status bar. **Only the navigation model, the table
layout and the selection surface differ between variants** — that is the thing
being decided. Each mock has a "states" bar at the top (first-load skeleton,
empty filter result, active filters, select 2 rows, stale refresh) and a
Runs / Charts / Overview switcher standing in for the sidebar.

Everything below the mock bar is composed from `@/ui` primitives: Button,
IconButton, Badge/RunStatusBadge, Tag, Chip, ScoreValue, SearchField,
MultiSelect, Select, SegmentedControl, Tabs (underline + dense), Checkbox,
Slider, Popover, DropdownMenu, Dialog, Tooltip, HelpMarker, StatStrip,
Pagination, Skeleton, EmptyState, StaleBanner, DataTable (Overview lists),
Kbd, Switch, Text. Styles are CSS Modules with tokens only (stylelint and the
design-language test pass).

## Variant A — "dense table" (`dense/`)

**Rationale.** The runs list is scanned far more often than it is filtered.
Give the table every pixel: one 24 px command row, filters behind a single
`Filters · n` popover, the active filters materialised as removable chips, and
the status split into a *Status* column (badge + live progress) and a
*Signals* column (⚠ task errors, ⚠ metric errors, ↻ retries, ◌ ingest) so
the eye can scan each signal in its own column instead of parsing a composite
badge. 32 px rows, sticky Run column, ScoreValue cells with the 2 px band bar.

**IA.** `[search] [Filters · n ▾] [chip] [chip] … Clear n … [Columns ▾] [Select]`
→ table → status bar (`n of N runs — task: …` · pager · Last updated · `?`).
The popover holds Time, Origin, the six facets (two-column grid) and the
versioning facets; "Done" closes it, "Clear all" resets. Charts reuses the
same bar without search/Select; Overview is the constrained page.

**Why it is different.** Filters are a *mode you enter* (popover) rather than a
permanent band; the current filter state is readable at a glance as chips in
URL order, which is the same order `runs_order.ts` serialises.

## Variant B — "inline filters" (`inline/`)

**Rationale.** Today's information architecture, rebuilt on the primitives
with no re-learning: row 1 `search · Select · Display: Columns · time range ·
origin`, row 2 the six facet multi-selects, the dynamic versioning facets and
`Clear (n)`; the table below at 40 px rows with the combined status cell
(badge + signals inline, as the vanilla page); the status bar **pinned** to
the bottom of the viewport so the pager and Last updated never scroll away.

**IA.** Exactly the vanilla one. At 1024 px the two rows still fit (12
controls); the status bar collapses to two lines (sentence + pager / Last
updated + shortcuts). The Filters popover and chips of A are absent; the
seven dropdowns are always on screen.

## Variant C — "split rail" (`rail/`)

**Rationale.** A faceted-search model: a 240 px rail on the left shows *every*
facet value with its count (constrained by the other active filters, as the
server `facets` do), the time-range and origin controls and the search box.
Filtering is one click per value, "Only" appears on hover/focus, and the
whole filter state is visible without opening anything. The rail collapses to
a 44 px strip (chevron / list icon, `aria-expanded`). Selection actions float
as a **bottom sheet** over the table while select mode is on, so the status
bar keeps its sentence and pager. Charts keeps the rail (same filter model);
Overview hides it (it has only the Origin control).

**IA.** `rail(search · Time · Origin · Tasks · Datasets · Models · Versions ·
Status · Users · Clear all)` | `tools(n runs · Columns · Select)` → table →
sheet (when selecting) → status bar. Compact rows + sticky Run column like A,
combined status cell like B.

## Pain point (brief §7) → treatment

| Pain point | A dense | B inline | C rail |
|---|---|---|---|
| 7+ dropdowns wrap into 3 rows on narrow widths | One row + chips; popover never reflows the page | Two rows, verified to fit at 1024 (12 controls); still the widest bar | Rail is vertical: width is constant, count lists scroll |
| Versioning facets appear/disappear and shift layout | They appear inside the popover; the bar is stable | Rendered as extra selects at the end of row 2 (shifts the Clear button) | Extra facet sections at the bottom of the rail; no table shift |
| Filters not all URL-encoded / shared link loses view | Chips are rendered from the URL-order list (`activeChips`); every chip = one URL key | Status-bar sentence lists them in URL order | Rail checkboxes mirror the URL; counts show the effect |
| Bare-URL vs sessionStorage precedence | Dropped in all three (decision §9.2): URL is the view | same | same |
| Two-step text collation, `metric-<name>` sort keys | All three: structured `Sort {key, direction}` (`metric:<name>`), serialised once | same | same |
| Status badge overloaded; tooltips hover-only | **Split** Status / Signals columns; each signal is a focusable button with a Tooltip (hover + focus) | Combined cell but signals are the same focusable buttons | Combined, same buttons |
| Actions column: `href="#"` icons, no arrow keys in the review menu | IconButtons with labels; review menu is `DropdownMenu` (React Aria Menu: arrows, typeahead, Esc) | same | same |
| `window.alert`, two toast systems | Shell `useToast()` only (all three) | same | same |
| Frozen columns measured on every render | CSS `position: sticky` Run column, no measurement | No sticky column (today's layout) | CSS sticky Run column |
| 15+ column horizontal scroll with a mirror bar | Container scrolls natively; sticky Run keeps identity | native scroll | native scroll; the rail steals 240 px, so scroll starts earlier |
| Charts: no axes, bars relative to card max, mixed magnitudes | Shared Charts screen: bars are explicitly "relative to the best run in the card" (caption), value label in text ink next to each bar, numeric metrics are plain right-aligned numbers (never bars), latency bars separated by the ⚡ prefix | same | same |
| Grouped mode hides Pass@K when a group is expanded | Group header rows keep Pass@k / Consistency / Reliability while members are expanded; "Computing…" / "Needs k ≥ 2" are honest states | same | same |
| Overview reloads every 2 s; trend tooltip mouse-only | Shared Overview: one refetch interval (meta line says so); Recharts `accessibilityLayer` → Tab to the chart, ←/→ moves the readout; a caption says so | same | same |
| a11y: chart headers `role=button` without `aria-sort`; multi-select without listbox semantics; `--text-dim` glyph contrast | `th[aria-sort]` with a real button inside; MultiSelect = React Aria Dialog with checkboxes, arrow keys, "Only"; dim only on the ↕ hint glyph | same | same |
| Performance: everything re-rendered per poll | React reconciliation; row key = `run_id`; the Columns menu is a Popover rendered on demand | same | same |

## Charts and palette (dataviz skill)

- **Form.** Runs table cells: `ScoreValue` (number + band bar), not a chart.
  Charts page: horizontal mini bars per metric column — the job is *compare
  magnitude across runs*, colour encodes *model identity* (categorical) because
  the legend is the model list; value labels sit beside the bar in
  `--text-secondary` mono (text never wears the series colour). Numeric metrics
  (`latency_s`) are plain numbers, right-aligned. Overview trend: the metric
  daily mean is a **single-series line** in `--chart-1`; runs per day is a
  **separate bar panel** in de-emphasis grey (`--border-strong`) sharing the X
  axis via `syncId` — no dual axis (dataviz non-negotiable; the brief's "two
  Y axes" was rejected). KPIs: `StatStrip` band (stat tiles), no chart.
- **Marks.** Bars 10 px tall on a `--bg-active` track, 4 px rounded data end,
  2 px surface gap; line 2 px with 3.5 px dots ringed in the surface colour;
  grid horizontal only, `--border-subtle`; axis ink `--text-muted` mono.
- **Interaction.** Line + bar panels share one tooltip (date, value, runs,
  execution success); `accessibilityLayer` on both charts; legend items are
  `ToggleButton`s with `aria-pressed` (click toggles, double-click solos,
  "Show all" resets); bars carry a `title` and the table view *is* the chart.
- **Palette (validated).** `node scripts/validate_palette.js
  "#00d4aa,#00a8ff,#a855f7,#f472b6,#fbbf24,#ea580c,#6366f1,#0d9488" --mode dark
  --surface "#1a1a28"` → CVD separation PASS (worst adjacent ΔE 8.4, deutan),
  normal-vision floor PASS (19.4), chroma PASS, contrast PASS (all ≥ 3:1).
  Slots:

  | Slot | Token | Value | Note |
  |---|---|---|---|
  | 1 | `--chart-1` | `#00d4aa` | existing (pinned) |
  | 2 | `--chart-2` | `#00a8ff` | existing |
  | 3 | `--chart-3` | `#a855f7` | existing |
  | 4 | `--chart-4` | `#f472b6` | existing |
  | 5 | `--chart-5` | `#fbbf24` | existing |
  | 6 | `--chart-6` | `#ea580c` | **new**, `__mocks__/palette.css` |
  | 7 | `--chart-7` | `#6366f1` | new |
  | 8 | `--chart-8` | `#0d9488` | new |

  The slot order is the CVD mechanism; `modelSlot()` indexes
  `chart_data.modelIndex` (server frequency order) so Runs, Charts and later
  Models/Compare agree (decision §9.7). **Eight, not twelve:** the dataviz
  skill caps categorical hues at 8; a 9th model wraps the hue and the marker
  changes shape (circle → square → diamond, `ModelMark data-shape`), which the
  decision already allowed. Lightness-band check: the five legacy tokens sit
  above the dark band (OKLCH L 0.70–0.84 vs 0.48–0.67 target) — they are
  pinned to `dashboard.css` by the design test, so this is reported as a
  foundation recommendation (re-step 1–5 darker in both files), not changed here.
- Status colours stay reserved: `--success/--info/--error/--warning/
  --metric-error` only on badges, signals and KPI tones, never as a series.

## Density

| | Row height | Visible columns at 1440 (no h-scroll) | at 1024 |
|---|---|---|---|
| A dense | 32 px | 9 (Run, Status, Signals, Task, Model, Dataset, Owner, Date, Analysis; Experiment partially) | 6 (… Dataset) |
| B inline | 40 px | 9 (Run … Analysis, Experiment partially) | 6 |
| C rail open | 32 px | 7 (Run … Date; Analysis partially) | 4 (Run, Status, Task, Model) |
| C rail closed | 32 px | 9 | 6 |

Column widths: Run 300, Status 190, Signals 96, Task 100, Model 150, Dataset
120, Owner 120, Date 120, Analysis 90, Experiment 110, Version 150, metrics
110 each (7), latency 100/110, Duration 90, Actions 96. Default visibility =
today's (all metrics on, trace off), so every variant scrolls horizontally
once metrics start; the Columns menu is the lever. Charts cards: 30 px
(compact, A/C) or 34 px rows; the card table sets its own min-width
(320 + 124 × columns) and scrolls inside the card at 1024.

## Keyboard model (all variants)

Document-level, skipped in inputs / dialogs / open menus: `j ↓` `k ↑` move
the roving row focus (the row is `tabIndex=0`, visible ring via
`:focus-visible` + a 2 px accent bar on the Run cell), `g/G` first/last,
`Enter` opens, `x` toggles selection (enters select mode), `c` compare, `/`
search, `1–4` time range, `Esc` clears selection → leaves select mode →
blurs, `?` opens the shortcuts dialog (with the single-key opt-out Switch).
Everything else is native: sortable headers are React Aria buttons inside
`th[aria-sort]`, signals are buttons with tooltips on focus, chips/legend are
ToggleButtons, the rail facets are checkboxes with an "Only" button that
appears on focus, the Recharts container is focusable with ←/→. Row focus and
keyboard selection are shared between variants (same hook).

## Trade-offs and known gaps

- **Hand-rolled table.** `DataTable` (React Aria `Table`) cannot interleave an
  expanded passes `<tr>` with a nested table and per-pass checkboxes, nor
  render a sticky first column, so `RunsTable` keeps the `.qdt` recipe by hand
  (header/cell rules copied, `th[aria-sort]`, roving row focus). The Overview
  lists use the real `DataTable`. If the chosen variant lands, the passes panel
  stays a plain table row; column resizing (the only DataTable feature lost)
  is not in the brief for Runs.
- A: the popover hides which facets are active until you look at the chips;
  chips can wrap into a second row with many filters (by design, it replaces
  the dropdown rows).
- B: at 1440 the bar is still 2 rows; the pinned status bar costs 38 px of
  table height permanently.
- C: the rail costs 240 px (4 columns at 1024 with it open); the bottom sheet
  overlaps the last visible rows while selecting; facet lists get long with
  many versions/users (they scroll inside the rail; a per-facet search would
  be needed past ~30 values).
- The select-mode checkbox column is not sticky (only the Run column is).
- `models-stats.json` holds one group (gpt-4o), so the claude group shows
  "Computing…" in grouped mode — this is the real API's `missing` state, not a
  design choice.
- The vanilla `?` help opened the Columns panel; all three ship a dedicated
  dialog.

## Foundation primitives missing or worked around

- No expandable-row / tree-row support in `DataTable` (above).
- `StatStrip variant="compact-header"` cannot hold five items at 1120 px
  (labels wrap); tried for C's Overview and reverted to `band`.
- No `Toolbar` primitive (used `role="toolbar"` divs).
- `Tag` has no `title`-safe truncation; the charts first column shows the
  commit only with the branch in `title`.
- `SearchField` has no `autoFocus` prop; `/` focuses it through a ref instead.
- `ToggleButton` (legend) is used straight from `react-aria-components`; a
  `ToggleChip` primitive would make the legend a one-liner.
- New tokens `--chart-6..8` live in `__mocks__/palette.css`; they should move
  to `styles/tokens.css` (and `dashboard.css :root`, because the design test
  diffs the two) when the variant is implemented.
