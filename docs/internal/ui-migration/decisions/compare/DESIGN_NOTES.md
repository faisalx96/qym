# Compare page: three layout proposals

Mocks: `/app/__mock/compare/{baseline,matrix,itemfirst}`. All three use the static fixture
`fixtures/compare-4runs.json` (20-run state adds 16 deterministic synthetic columns; cohort state
builds A from perturbed baseline passes and B from the repeat run). The state switch at the top
(2 runs / 4 runs / 20 runs / Cohort A/B, plus a "Show notices" toggle) is mock-only chrome.
Shared pieces live in `shared/` (data, `useCompare` state, `parts.tsx`); each variant owns only
its information architecture and layout CSS.

Common to all: run chips (remove x, click to set baseline, baseline marker), baseline Select, Run
average | Each pass toggle for repeat runs, cohort banner with inline-editable A/B labels,
Compare | Sweep switch (Sweep disabled with a reason outside cohorts), metric delta table (value,
signed pts with triangle glyph + word for screen readers, 95% band, forest mark, improved/regressed
count chips that filter items), metric tabs + threshold slider, category breakdown, error summary,
item list (8 per page, collapsed per-run pills, one expanded item with per-run output cards),
filter bar (search, Filters+badge, Display, CSV, active-filter chips), pagination, notices.
More than 6 runs switch item pills to a letter-keyed heat strip (A..T) so 20 columns still fit.

## A. baseline (baseline-vs-candidate focus)

Rationale: the dominant question is "is candidate X better than baseline?". The baseline is a card
pinned in a sticky header next to a strip of candidate cards ranked by delta (metric selectable);
everything below is a difference from it. Sections are a tab strip: Metrics | Categories | Errors |
Items (counts on tabs). A count button in the strip jumps to Items with the filter applied; filters
set elsewhere show as a bar in the sticky header with a "Show n items" button.

- IA: sticky [chips, baseline card, ranked delta strip] over tabbed sections. Sweep replaces the
  tabs with the sweep view; the cohort banner replaces chips/strip.
- Best for: 2 runs (the strip is one card, the whole page is "B vs A"), and 20 runs (ranking the
  strip answers "which candidates beat baseline" at a glance, horizontal scroll for the rest).
- Costs: sticky header is ~170px tall at 1440x900 (shrinks usable height on Items); one section at a
  time, so cross-reading categories and items needs tab switches; strip shows one metric at a time.
- Primitives: Tabs, Chip, Tag, Select, SegmentedControl, StatStrip, Slider, Pagination, Popover,
  Drawer, DataTable-style plain tables. New: `DeltaCard` (value + verdict + band + forest + counts),
  `StickyBar` container, `ForestMark` (CSS forest-plot mark).

## B. matrix (matrix-first)

Rationale: compare is a grid problem (metrics x runs); the page should be that grid. One matrix is
the spine; a pivot control swaps its rows between Metrics, By domain, By complexity and Errors
(same columns, same baseline), so categories, errors and metrics are three views of one object.
Overview stats sit under it; the item list follows with a sticky header that repeats each run
column with its letter and the selected metric's delta, and item pills use the matrix column widths.

- IA: [chips + tools] -> Matrix (pivot) -> Overview -> Items with sticky column header.
- Best for: 4 to 20 runs, where the reader scans across columns and compares several metrics and
  categories; the sticky header keeps column identity while paging items. Weakest at 2 runs (a wide
  matrix with two columns feels sparse) and the long vertical scroll remains (milder than legacy).
- Costs: the page is still one long scroll (matrix, overview, items); the aligned-column trick needs
  fixed column widths so run labels truncate; pivots hide the metric rows while viewing categories.
- Primitives: SegmentedControl (pivot), SectionHeader, StatStrip, Tabs(dense), Chip, tables. New:
  `MatrixTable` (frozen first column, grouped pass headers, sticky head, `row/col` scope, column
  resize), `StickyColumnHeader` shared by matrix and item grid.

## C. itemfirst (item-first)

Rationale: users end up in items anyway. The item diff list is the page body; a single sticky delta
line (one chip per candidate: verdict, band, improved/regressed buttons) acts as header and filter
control. Analytics (Metrics as runs-x-metrics, Overview, Categories, Errors) live in a collapsible
right panel that recomputes over the filtered items and shows baseline + the three biggest movers
so it stays narrow.

- IA: sticky [chips + delta line + panel toggle] -> main: toolbar + items | aside: tabbed analytics.
  Below 1100px the panel stacks under the items.
- Best for: "which items regressed and why" (J3/J6) at any run count, and cohorts triage when
  paired with Sweep; analytics answer "what does this filter look like" directly.
- Costs: metrics are less prominent (one tab in a narrow panel; wide tables scroll horizontally);
  the panel competes with output cards for width; showing only the top movers hides other runs
  (explicit note in the panel); 20 runs overflow the delta line (scrolls).
- Primitives: Tabs(dense), Popover, Chip, Button, Select, StatStrip, Drawer. New: `SidePanel`
  (collapsible, sticky, responsive stack) and `DeltaChipRow`.

## Open items regardless of winner

- Real stats module (paired band, p-values) replaces the throwaway helpers in `shared/data.ts`.
- Item list needs virtualization/lazy bodies; output text is synthesized in this mock.
- Run identity colour: first five runs get `--chart-1..5` dots, the rest are neutral; letters (A..T)
  are the identity key everywhere so colour is never the only signal.
- Needs a `ScrollRegion` primitive (focusable scroll container with label) instead of repeating
  the eslint-disabled `tabIndex` wrapper.
