# Run detail — design notes (step 3 of the playbook)

Three TSX prototypes of the page's information architecture, all wired to the
foundation primitives and to trimmed real API payloads
(`__mocks__/fixtures/*.json`: classic run 60 of 240 rows, repeat run 24 of 60
rows × 3 passes, `/passes`, `/group-metrics`, `/items/{id}/trace`,
`step-latency`, `/items/details`). Open them on the dev server:

- `/app/__mock/run-detail/sections` — **A · sections**
- `/app/__mock/run-detail/tabs` — **B · tabs**
- `/app/__mock/run-detail/items-first` — **C · items-first**

Every variant has a dev-only "Fixture" switch (Classic run / Repeat run) at the
top so the same page can be judged with per-pass columns, the repeat analysis
and the `×3 passes` pill. The dataviz skill was loaded before the charts were
written; every mark uses `--score-*`, `--chart-*` or `--success/--error/
--warning/--metric-error` tokens, carries a 2px surface gap, is a real
`<button>` with an accessible name, and keeps text in text tokens.

## What the three variants share (`__mocks__/shared/`)

| Module | Content |
|---|---|
| `data.ts` | typed fixtures; `metricsOf`, `rowMetric` (error-accounting: task errors count as 0 for maximize, are left out for minimize; scorer errors left out), `metricCard` (split / 11 buckets / min-avg-max), `latencyBins`, `categories`, `errorGroups`; **one filter model** `Filters {metric, threshold, show, scoreRange, latencyRange, q, rules[], sort}` + `applyFilters` + `activeChips` |
| `charts.tsx` | `Gauge`, `SplitBar`, `Histogram`, `LatencyHistogram` (click = bin, shift-click extends), `TimeBudget` (fixed kind order LLM→RETRIEVER→TOOL→GUARD→OTHER), `WaterfallBar`, `PassCountBars` |
| `RunHero.tsx` | eyebrow · mono id · pass pill · status · live badge placeholder · Export HTML · pager "3 of 4" with J/K labels · meta grid with entity links + dataset identicon · execution context (config + metadata, JSON preview) · versioning details; `compact` mode collapses the grids behind a chevron |
| `OverviewCards.tsx` | stat strip + metric cards (gauge, mean, error note, scored/err tag, split bar or histogram or numeric stats). Clicking a segment/bar writes into `Filters` |
| `FilterBar.tsx` | the single filter surface: search · analysis metric · pass threshold slider · All/Pass/Fail/Errors · "+ Rule" popover (field/op/value) · sort · "N of M" live count · active-filter chips (chart clicks included) · Clear N |
| `ItemsTable.tsx` | a real `<table>`: expand · # (sortable) · Status tag · Input (dir=auto) · Reason for the analysis metric · one column per metric (selected metric highlighted + sortable; repeat runs add per-pass dots) · Latency (sortable, retry glyph) · Trace. Expanded row = `ItemCard` (Input/Expected/metadata tags/Output with status, latency, started, Trace, Langfuse, copy; trace chips; metric strip with caret → judge JSON and pencil → inline Save/Cancel editor + "edited" tag) or `RepeatItemCard` (pass toggles, "N unique", compare-metric chips, one column per pass with verdict, latency, Trace, body, metric chips with pencils). 20 per page with the Pagination primitive |
| `TraceDrawer.tsx` | Drawer 1040px: header tags (spans · duration · tokens · cost · attempts · errors · Open in Langfuse), filter box (`/`), expand/collapse all, attempt chips, span tree (`role=tree`, buttons as treeitems, kind glyph, model, tokens, duration, waterfall), j/k/↑/↓/→/←, right pane with span head + Tabs (Input/Output · Attributes · Raw) |
| `AnalysisPanels.tsx` | `LatencyPanel` (mean/p50/p90/p95 strip, latency histogram → `latencyRange`, time budget, call-site table), `ErrorsPanel` (cards → `show=errors` / `metric_errors`), `CategoriesPanel` (pass-rate bars per metadata value → `rules`), `RepeatPanel` (metric segmented, Pass@k/Pass^k/consistency/reliability strip, per-pass table with `?pass=N` links, "passes passed" distribution → rule) |
| `MockShell.tsx` | static stand-in for `AppShell` (mock routes render outside `RequireAuth`), reusing `AppShell.module.css` so chrome is identical |
| `useRunPage.tsx` | fixture switch, filters per fixture, expanded item (item 6 / sql-001 by default), trace target, `useDocumentTitle` |

## Variant A — `sections`

**IA.** Hero → sticky stack [section nav + filter bar] → Overview → **Items** →
Repeat analysis (repeat runs) → Latency and traces → Errors → Categories.
Jump links scroll-spy (`IntersectionObserver`, `aria-current`), counts on
Items/Errors, an "Items" shortcut button and back-to-top at the end of the nav.

**Rationale.** The least disruptive port: it keeps the page the brief documents
(sticky nav recipe from DESIGN_LANGUAGE, `SectionHeader level="xl"` headers,
anchors `#section-*` map 1:1 to today's `data-run-section` keys so deep links
and the browser tests' mental model survive) and fixes the two structural
complaints by moving Items up to second place and by making the filter bar
part of the sticky stack, so a chart click anywhere shows its chip without
scrolling.

**Pain points.** §7.1 partly: Items is one scroll away instead of six, but the
page is still long (analysis sections below Items). §7.3 solved: the four
surfaces become one bar; chart clicks produce chips in it. §7.4 solved: analysis
metric + threshold move out of "Display" into the bar, beside the Pass/Fail
switch they govern. §7.5 solved by the shared table. §7.6 unchanged (20/page,
virtualize later).

**Journeys.** J1 unchanged. J3 shorter (click bar → chip appears in the sticky
bar → Items is directly below Overview). J6/J8 shorter (table + inline card).
J5 longer (Latency moved below Items). J7 shorter (one bar).

**Risks.** Two sticky rows eat ~110px of a 768px viewport; the repeat section
sits under Items so `?pass=N` cues stay far from the pass table. Scroll
stability on filter is easier than today (sections keep their heights) but
Overview re-render above the table can still shift the reader; keep card
heights fixed.

## Variant B — `tabs`

**IA.** Hero → sticky [Tabs: Items · Analysis · Traces · Reviews] + filter bar
→ one tab body. Items (default) = stat strip + table. Analysis = Overview
cards, repeat analysis, Errors, Categories, with a "See the N matching items"
button once a filter is set. Traces = latency panel + a traced-items table
whose Trace buttons open the drawer. Reviews = review history + score-lock
notice. The tab id is the URL hash (`#analysis`), compatible with the old
`#section-*` anchors through a redirect map.

**Rationale.** Treats the four reader intents as four pages sharing one hero
and one filter state. The page is never long; the landing view is the table.

**Pain points.** §7.1 solved (nothing stacks). §7.3/§7.4 solved (same bar).
§7.5 solved. §7.6 unchanged. New: §7.1's "filters scope every section"
becomes invisible across tabs unless the chip row is sticky (it is).

**Journeys.** J1 same. J3 **longer by one click** (chart in Analysis → switch
to Items), mitigated by the CTA button. J5 shorter (Traces tab is one click).
J4 longer (repeat analysis in Analysis tab while per-pass cards are in Items).
J8 reviews neutral.

**Risks.** Overview numbers and the rows they describe are never on screen
together, which is the core of J3; users must trust the chips. Tab content
unmounts, so the scroll position of the Items tab is lost when returning
(needs per-tab scroll memory). Errors count on the Analysis tab is a weak cue.

## Variant C — `items-first`

**IA.** Compact hero (one row; grids behind a chevron) → two columns: left
[Items header + stat strip + filter bar + table], right sticky **Analysis**
panel (≈30%, collapsible) with Tabs Overview · Errors · Categories · Latency ·
Repeat, each a filter source in dense mode (cards single-column, smaller
histogram, compact stat strips). Under 1100px the panel narrows to 300px and
the stat strip hides; the table scrolls horizontally with a 760px minimum.

**Rationale.** The thing most users came for fills the viewport on load; the
analysis is a side instrument that filters it. Click a histogram bar and the
matching rows appear beside it with no scroll, which is the J3 journey in its
shortest form.

**Pain points.** §7.1 solved (no stack). §7.3/§7.4 solved. §7.5 solved.
§7.6 unchanged.

**Journeys.** J3 shortest (one click, zero scroll). J5 one click (Latency
tab). J4 one click (Repeat tab) while per-pass columns are in the table. J6/J8
same as A. J1: execution context and versioning details are hidden behind the
hero chevron (one extra click to read them).

**Risks.** 30% of the width goes to charts, so the table loses the Reason
column on laptops; the dense cards are small (histogram 56px). The drawer and
the panel compete for the right edge (drawer overlays it, fine). Charts in a
300px column cannot host the deep-analysis matrix/scatter; those would open in
a full-width "Deep analysis" dialog or a dedicated Analysis route.

## Foundation primitive gaps

No new primitive was added under `frontend/src/ui/`. Gaps worked around inside
the mocks, to be considered by the component agent:

1. **No expandable-row table.** `DataTable` has no row expansion or custom
   row rendering; the mock draws its own `<table>` with the `.qdt-table`
   recipe. Either add `renderExpanded(row)` to `DataTable` or keep a local
   table for items.
2. **`Tabs` only accepts `TabPanel` children.** Variants B and C render their
   own tab bodies (`role="tabpanel"` divs) so that heavy content can be
   unmounted; a `TabPanel`-less mode or `Tabs` without panels is wanted.
3. **No chart primitives.** `shared/charts.tsx` (gauge, split bar, histogram,
   latency histogram, time budget, waterfall) could move to `src/ui/charts/`
   since compare/analyzer need the same marks.
4. **Shell chrome for mocks.** `AppShell` needs `useAuth`; `MockShell` copies
   its CSS module. A `ShellFrame` that takes `me` as a prop would let mocks
   use the real chrome.
5. **`Drawer` width** is fine but a `size="wide"` with a two-pane body slot
   would avoid the per-feature grid in `TraceDrawer`.
6. **Slider** has no compact/inline label mode; in the filter bar the label
   stacks above the track.

## Open items for the implementation

- URL state: `#section-*` (A), `#items|analysis|traces|reviews` (B) or
  `?panel=overview` (C) must coexist with the legacy params (`show`, `metric`,
  `threshold`, `filters`, `q`, `sort`, `page`, `item`, `trace`, `pass`).
- Drag-brush on the latency histogram was replaced by click/shift-click bins;
  the real page should offer both.
- The repeat "passes passed" filter is modelled as a rule
  `passes_passed:<metric> is N` so it shows as a chip like any other filter.
