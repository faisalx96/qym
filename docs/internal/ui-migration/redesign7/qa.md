# Redesign round 7: QA feedback on the runs page and run detail (design specification)

Status: design stage (implemented on the same branch afterwards: see section 9, the amendments it lists are applied in place below and marked **amended**). When the spec was written no product component had been changed. The code added is the dev gallery mock
`frontend/src/features/dev/Round7Mocks.tsx` (+ `Round7Mocks.module.css`, wired into `/__ui#round7`; `Round4Mocks.tsx` only gained two `export`
keywords so the mock can reuse its runs table), the seed `seed-r7.mts`, the measurement scripts and baselines under `measure/`, the
screenshots under `shots/` and this document. The mocks are the visual contract: where this text and a mock disagree, the number in this text
wins and the mock is a bug to report. The CSS in `Round7Mocks.module.css` is the proposed recipe, ready to move into the primitives.

Branch `ui/redesign7-qa` (from `UI-redesign` bc9f1555). Investigated 2026-10-19 at 1440, 1024 and 390 px (report column 1193, 777 and 279 px)
on the production build served by the platform on 8971, Vite dev (gallery) on 5971, SQLite, Playwright 1.64 Chromium (headless shell), dark
scheme, one fresh browser context per repetition, medians of 3 unless noted. "4x" is `Emulation.setCPUThrottlingRate(4)`, "Fast 3G" the DevTools
preset applied with `Network.emulateNetworkConditions` (see the caveat in section Q2.1).

## 0. Reading guide

The owner's words (verbatim; the numbering is theirs):

> after the QA review on the user experience of the react front end those are the most important feedback points:
>
> - runs page:
>  - the line for actions is above the reliability metrics which makes it harder to read.
>  - loading the passes takes a long time
>
> - run details:
>  1- in item details the frozen input is laggy when scrolling down.
>  2- the name of keys for json values output is overlapping with the content, the name should always be fully visible.
>  3- the same comment about the actions line clouding the view, table boundaries should only by visible within the table
>     itself.
>
>  invest heavily in UI design and strict adherence to it in implementation.

| Section | Owner point | Where | Criteria |
|---|---|---|---|
| Q1 | runs page: the actions line is above the reliability metrics | `DataTable` pinned-edge cues (runs table, passes strip) | Q1-1 to Q1-9 |
| Q2 | runs page: loading the passes takes a long time | `/api/runs/{id}/group-metrics`, `/passes`, `useRunPassesMany`, the loading frame | Q2-1 to Q2-12 |
| D1 | run detail 1: the frozen input is laggy when scrolling down | `ItemBar` (the frozen input line of an open item), frozen columns of the items table | D1-1 to D1-8 |
| D2 | run detail 2: key names overlap the content and must always be fully visible | `KeyTree`, `StructuredValue` sections, metric panel facts, tags | D2-1 to D2-14 |
| D3 | run detail 3: table boundaries only inside the table | the same `DataTable` rule on the items table, its expanded item, its sticky header | D3-1 to D3-9 |

52 numbered criteria. Section 6 records two owner reversals, section 7 the decisions I took, section 8 the hand-off.

Interpretation notes (decisions R7-D2 and R7-D3, section 7). "Reliability metrics" is read as the **Reliability statistic of the passes strip**
(and its neighbours Pass@k, Pass^k, Avg@k, Consistency, which are the repeat-run reliability metrics), because that is exactly where the actions
line crosses text (measured below). "The frozen input" is read as **the frozen line that opens an expanded item** (`ItemBar`: item number, verdict
and the input preview, translated to the sticky line while the item scrolls); the frozen columns of the items table (`#` by default, Status
and Input when the reader freezes them in the Columns menu) are measured too.

### Screenshots (`docs/internal/ui-migration/redesign7/shots/`, each under 300 KB)

| File | What |
|---|---|
| `current-q1-strip-zoom-1440.png` | 2x crop of the passes strip: the actions line and shade across "Reliability" (the owner's point) |
| `current-edge-runs-group-open-1440.png`, `current-edge-runs-group-open-scrolled-1440.png`, `current-edge-runs-group-open-1024.png` | runs table with a 10-pass group open, at rest and scrolled 600 px |
| `current-edge-runs-cards-390.png` | card mode: nothing pinned |
| `current-edge-items-detail-open-1440.png`, `current-edge-items-detail-open-scrolled-1440.png` | items table, item #2 open: the start and end cues over the expanded item |
| `current-q2-loading-1440.png` | the loading frame (10 placeholder rows and the reserved strip) |
| `current-d2-output-collapsed-en-1440.png`, `current-d2-output-expanded-en-1440.png`, `current-d2-output-expanded-en-390.png`, `current-d2-output-expanded-ar-1440.png`, `current-d2-expected-en-390.png`, `current-d2-panel-en-390.png` | the key defects (truncated keys, a key that lost its whole name at 390, the Expected key under its copy button, truncated fact labels, the Arabic key cut at its start) |
| `mock-r7-edge-runs-{1440,390}.png`, `mock-r7-edge-items-{1440,390}.png`, `mock-r7-keys-long-{1440,390}.png`, `mock-r7-keys-rtl-{1440,390}.png`, `mock-r7-metric-facts-{1440,390}.png` | the specified design next to the shipped one (current / specified pairs) |

### How it was measured (`measure/`, Node 24, Playwright from `frontend/node_modules`; `lib7.mts` reuses `perf6/measure/lib.mts`)

```
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; source .venv/bin/activate; export PYTHONPATH=packages/sdk:packages/platform
python frontend/scripts/dev_db.py sqlite:////abs/path/.qym-e2e-r7d.db          # schema
QYM_AUTH_MODE=none QYM_DATABASE_URL=sqlite:////abs/path/.qym-e2e-r7d.db QYM_ENVIRONMENT=test QYM_ADMIN_BOOTSTRAP_TOKEN=x \
  QYM_BASE_URL=http://127.0.0.1:8971 QYM_SERVICE=all python -m uvicorn qym_platform.main:app --port 8971 &
node docs/internal/ui-migration/redesign7/seed-r7.mts http://127.0.0.1:8971 r7-seed /tmp/r7-seed.json   # about 2.5 minutes
export PERF_BASE=http://127.0.0.1:8971 R7_SEED=/tmp/r7-seed.json PERF_SEED=/tmp/r7-seed.json PERF_OUT=docs/internal/ui-migration/redesign7/measure/baseline
node docs/internal/ui-migration/redesign7/measure/<script>.mts
```

| Script | What it measures |
|---|---|
| `seed-r7.mts` (in `redesign7/`) | one project, 50 runs on the first page: 12 repeat runs of 10 passes x 300 items, one of 10 x 1,200 (`passes1200`), four of 3 x 100, `big1200` (classic, 1,200 items, 5 traced), `jsonKeys` (12 items: JSON outputs / expected / metadata with keys of exactly 10, 40 and 80 characters in snake_case and camelCase, depth-4 nesting, Arabic keys and values, the key `reasoning`, a metric whose details hold the same keys), 31 classic runs |
| `q2-passes-load.mts` | click on a repeat run's chevron to its pass rows and strip statistics painted (in-page `performance.now`, rAF), requests (url, start, end, bytes, TTFB), table height at the placeholder frame and at the rows; `NET`, `SETTLE`, `OPEN` (1 or 5 groups in a row), `RUN`, `WIDTH`, `FIRST` |
| `passes_profile.py` | `/api/runs/{id}/passes` in process: wall time, handler time, SQL statements and their time, cProfile |
| `q2-shot.mts` | the loading frame |
| `edge-cues.mts` + `edge-probe.mts` | every cue of the shared DataTable (the two `.edge` elements, the two 24 px `[data-cues]` fades, the `data-pin-edge` lines): rects, opacity, extent against the rows, toolbar, footer and detail rows, and every text node of the scroller tested against every cue (px under the cue, stacked alpha, WCAG contrast under the shade); states rest / group or item open / scrolled / scrolled to the end |
| `edge-mock.mts` | the same probe on the gallery mocks (current and specified frames) |
| `d1-scroll.mts` | a 2 s scroll of the page scroller through the open item (`TARGET=detail`) or the 1,200-item table (`TARGET=table`, `PINS=0\|2` extra frozen columns), wheel or scrollbar drag, 1x / 4x: rAF frames, dropped frames (> 25 ms), long tasks, React commits (devtools hook), CDP counters, a timeline trace (style recalcs and elements styled, layout, paint, layerize), compositor layers, sticky elements; `EXPERIMENT=` injects measurement-only CSS to size a candidate fix |
| `d1-bar-jank.mts` | the item bar and a CSS-sticky control painted magenta / cyan, decoded per presented (composited) frame under touch, wheel or synthesized scrolling with `JANK` ms of main-thread block every 120 ms |
| `d1-scroll-thread.mts` | does the page scroller scroll while the main thread is blocked (marker position per presented frame) |
| `d2-keys.mts` + `d2-probe.mts` | key box against value box, copy / bulk buttons and its own box for every key / value pair of the open item at 1440 / 1024 / 390, LTR and Arabic fixtures |
| `d2-mock.mts` | the same probe on the specified mocks |
| `d3-header.mts` | the sticky header, its line and the item bar against the table card |

Baselines are in `measure/baseline/*.json` (raw numbers; the tables below quote them). The machine was shared; absolute times vary by about
20% between runs, counts and ratios are stable.

## 1. Summary

| Point | Root cause (measured) | Fix |
|---|---|---|
| Q1 actions line over the reliability metrics | Two overlays in `.bodyHost` sit above the cells at the pinned boundary: the end `.edge` (11 px gradient to `--bg-void` at opacity .85 plus a 1 px `--border-strong` line, z-index 3) and the 24 px `[data-cues]` fade (opacity .7, z-index 1). The passes strip is one full-width cell whose last statistic lands exactly on the boundary: 25 px of "Reliability" sit under both cues, contrast 6.9 -> 1.1. At 1440 20 to 21 text nodes (79.5 to 104.5 px of glyphs) are under a cue at rest, 389 px when scrolled to the end | Delete both overlays. The boundary is a 1 px `--border-strong` line drawn by the pinned cells themselves (inside their own box), so no glyph is covered (0 px), the line has exactly the rows' extent and stops over a strip or an expanded item |
| Q2 loading the passes takes long | The strip's `group-metrics` request runs a pure-Python bootstrap on its first call per (run, metric, threshold): **2,630 ms for 10 passes x 300 items, 10,900 ms for 10 x 1,200**, for statistics (band, distribution, uncertainty) the strip never shows (the five numbers it shows take 0.4 ms). While it runs it starves the `/passes` request of the same click (TTFB 2,749 ms against 76 ms alone), so the pass rows paint at **2,805 to 2,903 ms (300 items) and 11,225 ms (1,200 items)**; warm they paint at 130 to 180 ms (Fast 3G floor 631 ms). Opening five groups in a row costs 10 requests and, cold, 14 s | `view=group` for the strip (prototype 3.3 / 12.7 ms), background prefetch of the page's repeat runs (click to rows 132 -> <= 80 ms, 0 requests), loading frame with a measured height |
| D1 frozen input laggy | Not a positional lag: pinned cells 0 px off in every frame (1x and 4x, wheel and drag), the item bar within 1 px of the line in all 52 presented frames even with 50 ms of main-thread block every 120 ms. What costs: `--head-shift` is written on the item `<article>` and inherited by its 594 descendants, so every scroll event restyles the open item (91 recalcs, 25,616 elements, **78 ms at 1x, 300 ms at 4x**, 30% of main-thread time); the 1,200-item table drops **44 to 47 frames of about 280 at 4x** (0 at 1x), 52% of its main-thread time is Paint; two more frozen columns add 3 dropped frames, 72 layers and 36% more paints | Write the shift on the bar (1 element: 25,616 -> 1,376 elements styled, 78 -> 15.6 ms, measured with an injected prototype), keep `position: sticky` for pinned cells (static pins save 2 to 5 frames, so they are not the cause), keep the perf6 ceilings and add per-scroll-event style and paint counts |
| D2 key names overlap and are cut | `.key` is `max-inline-size: 28ch` with an ellipsis (4 to 13 truncated key rows per item; the 40- and 80-character keys both read `customer_eligibility_assess...`); at 390 the open nested row squeezes its key to a **0 px wide box** (9 of 22 rows) while the wrapped `array . 2 items` text paints 27 to 29 px over `Expand all`; the Expected sections key is `flex: none` and runs 24 px under its copy button (416 px past the row at 390); fact labels and prose labels are nowrap with an ellipsis (worst 288 px clipped); an Arabic key is cut at its start | Keys wrap (`overflow-wrap: anywhere`), never clip; the preview follows the key's last line (8 px) or starts a new line; bulk and copy actions wrap under the name; fact keys wrap in a column of `fit-content(40%)`; tags isolate key and value |
| D3 boundaries only in the table | The same overlays: in the items table they are as tall as the 500-row body (26,058 px), cross the expanded item (575 px: 2 text nodes at rest, 33 nodes / 698 px scrolled, "Collapse" under the end cue) and the nested matrices carry their own cues | The Q1 rule in the shared primitive, asserted on every table that pins columns |

## Q1. Runs page: the actions line over the reliability metrics

### Q1.1 Problem (measured; `current-q1-strip-zoom-1440.png`, `current-edge-runs-group-open-*.png`, `measure/baseline/edge-runs-{1440,1024,390}.json`)

Seed page: 50 runs, default column set (Run and Status frozen at 1440, Run only below; Actions pinned at the end), a 10-pass group open.

What the owner sees. The strip row of an open group is one full-width cell (`tr[data-strip-row]`, 1203 px at 1440, sticky at the scroller start). Its
last statistic, **Reliability 87.5%**, sits where the pinned Actions column ends, and the end-edge cue is painted **above** it: a vertical dark line
and a shaded band cut through the word "Reliability" (see the zoom). It is not one element but three layers, all drawn above the cells:

| Layer (selector, `DataTable.module.css`) | Box at 1440 (runs, pins 404 / 104 px) | Opacity, z-index | What it draws |
|---|---|---|---|
| `.edge[data-edge='end']` | 11 px wide, `inset-inline-end: calc(var(--pin-end) - 1px)`: x 1296 to 1307, 698 px tall (the scroller's visible height) | .85 while columns remain to the right (always at rest), z 3 | `linear-gradient(to left, var(--bg-void), transparent)` plus `border-inline-end: 1px solid var(--border-strong)` |
| `.bodyHost[data-cues]::after` | 24 px wide, `inset-inline-end: var(--pin-end)`: x 1282 to 1306, same height | .7, z 1 | `linear-gradient(to left, var(--bg-void), transparent)` |
| `.td[data-pin-edge]` / `.th[data-pin-edge]` | the pinned cell's own inset line | none | `inset 1px 0 0 var(--border-subtle)` (cells) / `--border-default` (headers): the quiet line that is **already correct** |

The start side has the same pair (`.edge[data-edge=start]`, `::before`) and shows when the table is scrolled sideways. The strip, the pass rows and every
unpinned cell are under these overlays; the pinned cells are not (the end edge reaches 1 px into the pinned cell, the pinned cells are opaque).

Glyphs under a cue (every text node of the scroller against every cue box; alpha of both gradients stacked at each 0.5 px; WCAG contrast of the text colour
against its background after the shade; `edge-cues.mts`):

| State | 1440: text nodes under a cue / px of glyphs / worst single run | 1024: same | Worst contrast after the shade (was 5.7 to 12.4) |
|---|---|---|---|
| rest (scrollLeft 0, nothing open) | 20 / 79.5 px / 22.5 px ("correct" header label); the 19 metric values lose 3 px each ("70.0%") | 0 / 0 / 0 (the boundary falls in a gap between columns) | **1.2** |
| group open, rest | 21 / 104.5 px / **25 px ("Reliability", strip)** | 1 / 25 px / 25 px (the strip) | **1.1** (6.9 before) |
| group open, scrolled 600 px | 21 / 75.5 px / 25 px (strip), and the start cue over "Analyze" (2.5 px) and the strip's "%" | 47 / 599.5 px / 25 px | 1.1 |
| scrolled to the end | 21 / 389 px / 25 px (header label "Median latency"; 19 px of every latency value) | 23 / 228 px / 25 px | 1.1 |
| 390 (cards) | 0 / 0 / 0: nothing is pinned, the cue elements are not rendered | | n/a |

Vertical extent (the brief's question): the cues start at the first header row's top (0 px above) and end at the `.bodyHost` bottom. `.bodyHost` clips
them (`overflow: hidden`) and holds only the scroller, so they never reach the toolbar (0 px), the footer / pagination (0 px) or the page. The
`.bodyHost` is as tall as the visible rows (698 px at 1440 with 50 rows, 90 px with 1 row: 0 px below the last row), so there is no empty band in the
runs table. What they do cover is every full-width row inside the body: the **strip (45 px at 1440, 56 px at 1024, where the strip wraps)**. In the items table (section D3) the cue is 26,058 px tall (500 windowed rows) and crosses the expanded item.

**Root cause.** The edge is an overlay (an absolutely positioned element plus a pseudo-element fade) instead of a property of the pinned cells.
An overlay cannot know which rows have a pinned cell, so it paints over rows that are not laid out in the columns (the strip, an expanded item) and over
every glyph that happens to sit at the boundary. Perf round 6 introduced it to avoid repainting the pinned cells on the first scroll tick
(`perf6/perf.md` D5); the price was this defect.

### Q1.2 Does any shade survive?

**No.** Both gradients are removed. Reasons, with the numbers above: the shade is the part that "clouds" (contrast 1.1:1 on the text under it, against the
6.3:1 minimum of `--text-muted`); any shade that falls on a neighbour's content must overlap that neighbour's glyphs because the boundary is where a cell's
text can sit (up to 25 px of a 100 px stat); a shade drawn inside the pinned cell would not tell "content continues under me". What the shade told the
reader is still told, by things that overlap nothing: (1) a crisp 1 px line at the boundary and the opaque pinned cells, so content visibly disappears
at a line; (2) the mirrored horizontal scroll rail (`[data-testid=table-scroll-rail]`, 12 px, always present while the table overflows; unchanged).
Experiment (measurement-only CSS injected into the shipped build, `d1-scroll.mts EXPERIMENT=no-edge-cues`): scrolling cost with both cues removed is
41 dropped frames at 4x against 44 with them (noise), so nothing performance-related is given up.

### Q1.3 Design

One rule for every table that pins columns (`DataTable.module.css`, `DataTable.tsx`):

1. **Delete** the two `<span class="edge">` elements, the `.edge` rules (including `will-change: opacity` and the 120 ms opacity transition) and the
   `.bodyHost[data-cues]::before` / `::after` fades. `scrollCues` keeps driving the rail. `data-scroll-start`, `data-scroll-end`, `data-scrolled-x` and
   `data-scrolled-end` stay (other code and specs read them) but nothing styles a pinned cell from them.
2. **The boundary is the pinned cells' own line.** Every `th` and `td` that carries `data-pin-edge` draws `box-shadow: inset -1px 0 0 var(--border-strong)`
   (`start`) or `inset 1px 0 0 var(--border-strong)` (`end`): 1 px, `--border-strong` (2.3:1 on `--bg-surface`), inside the pinned cell's own box, never scroll-dependent
   (no repaint on the first scroll tick, no transition). Under `dir="rtl"` the sides swap (`:dir(rtl)`). The combined rules for child rows and open
   parents (accent rail plus line, `.childRow > td[data-pin-edge='start']:first-child`) change the line colour to `--border-strong` the same way; the focused-row
   ring stays on top.
3. **The band row carries it too.** `renderBands` gives the pinned band cell next to the boundary `data-pin-edge` (the group band above the header, 24 px), so the line starts at the
   top of the first header row (today it starts 24 px lower in the quiet line, 0 px above in the overlay).
4. **No pinned cell, no line.** A row that is not laid out in the columns (`tr[data-detail-row]`: the passes strip, an expanded item) has no pinned cell, so the line stops
   above it and resumes below it with no extra code. Pass rows and run rows have pinned cells and keep the line.

Per width. **1440** (runs: Run + Status frozen, Actions pinned; items: `#` + chevron frozen, Trace pinned): two lines per row at x = 611 and 1306 (runs),
no shade, strip untouched. **1024**: the same (Run frozen, Actions pinned; strip 56 px). **390**: card mode, no pinned cell, no line, no rail (Q1-6).
Mock: `r7-edge-runs` and `r7-edge-items` (specified frame under the current one). Measured on the specified mock (`edge-mock.mts`): 0 live cue elements,
0 text nodes under a cue, line top = first header row's second row top (the mock's band row has no edge attribute; criterion Q1-4 asks for it), line bottom = last body row bottom (0 px),
gap = the strip (45 px at 1440, 56 px at 1024) or the open item (224 px in the mock).

### Q1.4 Acceptance criteria

All thresholds: production build, the seeded page, 1440 / 1024 / 390, `edge-cues.mts` (the probe reads `[data-edge]`, `[data-cues]` pseudo-elements and `data-pin-edge`).

| ID | Element and width | Criterion | Baseline | Measured by |
|---|---|---|---|---|
| Q1-1 | `[data-testid=runs-table] [data-testid=data-table]` at 1440, 1024, 390 | no `[data-edge]` element; `.bodyHost` has no `::before` / `::after` shade (computed `content: none` or `display: none`) | 2 edge elements + 2 fades live at 1440 and 1024; 390: none rendered | DOM, computed style |
| Q1-2 | same, states rest, group open, scrolled 600 px, scrolled to the end, 1440 and 1024 | **0 px** of any text node's client rect under a shade (an element with a gradient background or opacity < 1 painted over cells); the probe's `overlapSummary.totalPx == 0` and `textNodesOverCue == 0` | 1440: 79.5 / 104.5 / 75.5 / 389 px; 1024: 0 / 25 / 599.5 / 228 px | `edge-cues.mts` |
| Q1-3 | the strip statistic labels and values, run-row metric values, header labels, 1440 and 1024 | every glyph keeps its unshaded contrast: strip stat label >= 6.9:1 (`--text-muted` on the strip surface), metric values >= 11.2:1, header labels >= 5.7:1 | minimum 1.1:1 | probe `minContrastShaded` is null (no cue) and a direct contrast computation of the three groups |
| Q1-4 | every `th[data-pin-edge]` and `td[data-pin-edge]` incl. the pinned band cell, 1440 and 1024 | computed `box-shadow` is exactly one inset 1 px line in `--border-strong` (`rgb(82, 82, 108)`) on the pinned cell's inner side (start: right side in LTR; end: left side); count = header rows + body rows (pass rows included); the band cell next to the boundary has the attribute | cells `rgb(43, 43, 64)` (`--border-subtle`), headers `rgb(59, 59, 84)`; band cell: none | computed style, count |
| Q1-5 | the union of the pinned-edge cells of one side | top = first header row's top (**0 px above**), bottom = last body row's bottom (**0 px below**); the only gaps are rows without a pinned cell: the strip row (45 +- 1 px at 1440, 56 +- 1 at 1024); **0 px** over the toolbar, the footer and, with 1 row, below the row | overlay: 0 above, 0 below, but over the strip (45 / 56 px) | `lines.*.gaps`, `boxes` |
| Q1-6 | runs table at 390 (cards) | `[data-pin]` count 0, cue elements 0, no pinned line, `document.documentElement.scrollWidth == innerWidth` | 0 cue elements rendered, 0 overlap | DOM |
| Q1-7 | runs table, a 2 s horizontal scroll at 1440 | the computed box-shadow of the pinned-edge cells is the same at scrollLeft 0, 600 and the end; **0** `transitionstart` events on the table (baseline: the `.edge` opacity transition) | 1 to 2 transitions | `table-scroll.spec.ts` (updated), computed style |
| Q1-8 | `[data-testid=table-scroll-rail]` at 1440 and 1024 | still present while `scrollWidth > clientWidth`, 12 px tall (the overflow affordance that replaces the fades) | 12 px | box |
| Q1-9 | a table under `dir="rtl"` (DataTable gallery RTL case) | the line is on the physical side that faces the scrolling columns (start pins: left side), 0 px glyph overlap | not covered | computed style, probe |

### Q1.5 Tests to write

- Vitest `ui/DataTable/__tests__/pinEdge.test.tsx`: no element with `data-edge` for pinned start and end tables; the pinned band cell next to the boundary has `data-pin-edge`; a `detailRow` has no `data-pin`; card mode renders no `data-pin`.
- Playwright `e2e/runs-list/redesign7-edges.spec.ts` (new): Q1-1 to Q1-8 on the seeded page (`seedR7` in `e2e/runs-list/seed.ts`, a 10-pass run, the group open, strip painted), 1440 / 1024 / 390; the contrast check uses the same formula as the probe.
- Update `e2e/perf/table-scroll.spec.ts` ("the edge shadow is one element that fades": becomes "no overlay element, no transition, pinned cells' shadow unchanged by scrolling") and `e2e/perf/table-freeze.spec.ts` line 60 (`[data-edge="start"]` locator), `src/ui/DataTable/__tests__/scrollPath.test.tsx` (`data-scroll-start` stays), `e2e/trash/cutover-trash-layout.spec.ts` (`[data-scroll-end]` stays).
- DESIGN_LANGUAGE: "Data table" ("pinned columns (start/end) are opaque, with an edge shadow while content scrolls under them" -> "opaque, with a 1px `--border-strong` line on their inner edge drawn by the pinned cells; nothing is painted over scrolling content"), rule 16 ("the one permitted fade is `opacity` (the frozen-edge shadow and the scroll cues)" -> the rail only), and `design-language.test.ts` gets a case: `DataTable.module.css` has no `.edge` selector and no `linear-gradient` over `.td` / `.bodyHost`.

### Q1.6 Implementation notes

`ui/DataTable/DataTable.module.css` (`.edge`, `.bodyHost[data-cues]::before/::after`, `.td[data-pin-edge]`, `.th[data-pin-edge]`, `.childRow`, reduced-motion block), `DataTable.tsx` (the two `<span className={styles.edge}>`, `renderBands` pinned band cell edge attribute, `data-cues` stays for the rail), the specs above, `docs/DESIGN_LANGUAGE.md`. No change to `RunsTable.tsx`. Perf: removes two `will-change: opacity` layers; criteria A3, A5 to A9 of perf round 6 are unaffected (experiment above).

## Q2. Runs page: loading the passes takes a long time

### Q2.1 Problem (measured; `measure/baseline/q2-*.json`, `passes-profile.json`, `q2-server.json`; `current-q2-loading-1440.png`)

Page of 50 runs: 12 repeat runs of 10 passes x 300 items, one of 10 x 1,200, four of 3 x 100. "Click to rows" = from the chevron's click event to the frame in which
all pass rows and the strip statistics are painted (in-page `performance.now` and rAF; `q2-passes-load.mts`).

| Case (10 passes) | Click to placeholder frame | Click to rows and strip painted | Requests, bytes | Notes |
|---|---|---|---|---|
| 300 items, local, settled (2.5 s after the list), **warm** server cache | 42 ms | **132 ms** (135 / 132 / 130) | 2 (`/passes` 1.26 kB, `/group-metrics` 1.1 kB, gzip) | `/passes` TTFB 74 to 192 ms, `/group-metrics` 14 to 18 ms |
| same, clicked right after the list painted | 51 ms | 182 ms (264 / 158 / 182) | 2 | the list's own 3 requests had finished (290 ms to first rows) |
| same, Fast 3G | 41 ms | **632 ms** | 2 | floor: CDP latency 562.5 ms (below) |
| 1,200 items, local, warm | 41 ms | **439 ms** (434 to 439) | 2 | `/passes` TTFB 370 ms |
| 1,200 items, Fast 3G, warm | 41 ms | 630 ms | 2 | |
| 300 items, local, **cold** (first open of that metric / threshold; three different runs) | 40 to 52 ms | **2,903 / 2,805 / 2,828 ms** | 2 | `/passes` TTFB 2,749 / 2,749 / 2,769 ms, `/group-metrics` TTFB 2,683 / 2,690 / 2,713 ms |
| 1,200 items, local, cold | 41 ms | **11,225 ms** | 2 | both requests TTFB about 11 s |
| 300 items, Fast 3G, cold | 41 ms | 2,812 / 2,823 ms | 2 | CDP latency is a floor, not additive: real = this + about 0.56 s |
| five groups opened one after the other, warm, local | 43 ms each | 139, 158, 246, 148, 177 ms (median of the first: 134) | **10 requests, 11.6 kB** | five `/passes` (6.2 kB) and five `/group-metrics` |
| five groups, cold, local | | 139, **2,814, 2,805, 2,910, 2,807 ms** | 10 | 11.5 s in total: each open waits behind its own bootstrap |
| 1024: strip frame | | 130 ms | | placeholder strip 45 px, loaded strip **56.4 px**: the group grows **11.4 px** when the data arrives; at 1440 45 px and 45 px |

Caveat on "Fast 3G": `Network.emulateNetworkConditions` applies its latency as a minimum time to first byte, not an addition to the server's time. A response the server
needs 300 ms for therefore reads 630 ms (floor) while one it needs 2.7 s for reads 2.8 s; both would be 0.56 s longer on a real link. Ceilings below are written for the floor case and the
server-bound case separately.

**Root causes** (in order of cost):

1. **`/group-metrics` runs a bootstrap nobody reads.** `run_group_metrics` calls `cached_repeat_analysis`, which on the first request for a (run, metric, threshold) runs
   `build_repeat_analysis`: an item bootstrap in pure Python (2,000 iterations x 30 confidence intervals, `qym.core.reducers.mean_ci`, 18,000,000 `random.choice` calls: 15.5 s under cProfile,
   **2,630 ms real** for 10 x 300; **10,900 ms** for 10 x 1,200), then stores the curve in `run_metric_analyses`. The run page's repeat section uses that curve; the **runs-table strip does not**: it shows `group`
   (Pass@k, Pass^k, Avg@k, Consistency, Reliability), computed by `group_stats` in **0.4 ms**. Prototype of the part the strip needs (one column query plus `group_stats`): **3.3 ms (10 x 300), 12.7 ms (10 x 1,200)**.
   Every change of the strip's Metric select or threshold chip is a new key and pays the bootstrap again (measured 2,624 and 2,627 ms for another metric and another threshold).
2. **It starves the rows too.** The bootstrap holds the GIL in the same worker: the `/passes` request of the same click, 76 ms alone, answers after 2,749 ms, so the **rows** (which need only `/passes`) paint at 2.8 s.
3. **Nothing is fetched until the click.** The runs table starts a passes query per *open* run (`useRunPassesMany`, started on expand). Even warm, every open pays a network round trip (632 ms at the Fast 3G floor) with the placeholders on screen.
4. **`/passes` itself is linear in item x pass** (22 to 25 us of Python per item-pass): 65.7 ms for 3,000 item-passes, 321.9 ms for 12,000 (SQL 8 and 36 ms; **28 statements at both sizes, no N+1**). 175 ms of the 300 are
   the per-attempt `RunTraceAggregate` rows (12,005 ORM entities: `InstanceState.__init__` 64 ms, 12,004 JSON decodes of `raw_bucket` 49 ms, `_build_run_trace_stats` 62 ms), 48 ms `_repeat_pass_event_state`, 22 ms `pass_metric_totals`.
   Prototype: loading those aggregates with a Core column select instead of the ORM saves 23 ms of 170 (14%); the merge (about 100 ms) is the rest. A cold ceiling much below today's needs precomputed per-pass aggregates (section Q2.7).
5. **The loading frame moves at 1024** (strip 45 -> 56.4 px) and for a run with more than 10 passes (`loadingCount` caps the placeholders at 10: a 19-pass run adds 9 x 32 = 288 px; computed from the code, not seeded).

### Q2.2 Ceilings chosen and why

| Ceiling | Value | Why this number |
|---|---|---|
| Strip request `view=group`, cold, 10 x 1,200 / 10 x 300 | <= 60 ms / <= 25 ms (baseline 10,900 / 2,630 ms) | the prototype does 12.7 / 3.3 ms of work; the rest is the request (about 20 ms) and CI margin x1.5. This is the one change that turns the owner's complaint from seconds into a few frames |
| `/passes`, 10 x 1,200 / 10 x 300, median of 9 loopback requests | <= 300 ms / <= 80 ms (baseline 322 / 66 ms), 28 statements at both sizes | the per-item-pass Python cost is the floor of this design (Core selects would give 14%); the number is "do not regress and do not add statements" and is asserted so the prefetch cannot make it worse; the real reduction is the follow-up in Q2.7 |
| Click to rows, **prefetched** (the default path), local and Fast 3G | <= 80 ms, 0 requests after the click | the floor is the render of the expand itself (40 to 52 ms for 10 placeholder rows and the strip); the rows arrive in the same commit, so one or two frames (<= 80 ms) is the achievable number. No network on the click means the same value on Fast 3G (baseline 132 / 632 ms warm) |
| Click to rows, **not prefetched**, cold server cache, local | <= 500 ms (10 x 1,200; **amended** from 450: measured 460 ms, the up to four prefetch requests already in flight at the click still hold the server) and <= 250 ms (10 x 300; measured 201 ms) (baseline 11,225 / 2,805 ms) | 300 ms of `/passes` plus about 50 ms of render and margin; 80 ms plus 50 ms for 300 items |
| Same, Fast 3G | <= 1,000 ms for both sizes (baseline 631 floor warm; 2.8 s + 0.56 s cold) | latency floor 562.5 ms plus the server time (<= 300 ms) plus paint |
| Prefetch of the whole page (17 repeat runs on the seeded page) | settled <= 2.5 s local, <= 8 s Fast 3G; <= 34 requests, <= 30 kB gzip | 1.2 s of handler CPU on this seed (12 x 58 ms + 322 ms + 4 x 8 ms, plus 17 x 3 to 13 ms for the strips); on Fast 3G 34 requests at 4 in flight are 8.5 waves x 0.63 s |
| Layout shift of an open group | 0 px at 1440, 1024 and for runs of up to 20 passes | the frame has the loaded height (Q2-9) |

### Q2.3 Design

**Server (two small changes, tests in `tests/platform`).**

- `GET /api/runs/{run_id}/group-metrics?metric=&threshold=&view=group` returns `{run_id, metric, direction, threshold, samples, report_k, group}`: no `band`, `distribution`, `uncertainty`, and it **does not call
  `cached_repeat_analysis`** (a GET that writes nothing: 0 rows added to `run_metric_analyses`). Without `view` the response is byte-identical to today's (the run page keeps it). Everything else
  in the handler (permissions, metric and threshold defaults, `errors_left_out`, `report_k`) is shared, so the two views cannot disagree on `group`.
- `/passes`: no new behaviour; the statement count (28) and the payload shape are pinned by tests so that later work cannot add per-pass queries.

**Client.**

- The strip requests `view=group` (`useGroupMetrics(runId, metric, threshold, { view: 'group' })`; the query key includes the view so the run page's full curve stays a separate entry).
- **Prefetch (decision R7-D4).** `RunsTable` runs a small scheduler after the list paints: it waits until the table has rows and the page's own requests (runs, overview, active-runs) have settled (`useIsFetching` is 0), then a
  `requestIdleCallback` (timeout 500 ms, `setTimeout` fallback) starts the queue. Queue = the rows of the current page with `samples > 1` and a **terminal** status (RUNNING and PENDING runs poll and are fetched on open, as today), in row order, at most **20**
  runs, at most **4 requests in flight**. Per run two `queryClient.prefetchQuery` calls with the **same keys and functions** as `useRunPasses` and the strip's `useGroupMetrics`, for the metric and threshold the strip would pick on first open
  (`resolveMetric(remembered, scoreMetrics, defaultMetricName)`, `groupStatRule` / `defaultPassThreshold`): one helper `groupQueryFor(row, remembered)` is used by both so they cannot drift. A click on a run whose prefetch has not started starts its
  own request at once (the same query key: if it is in flight the click attaches to it, one request per key). When the page's rows change (page, filter, sort, time range) queued prefetches are dropped and in-flight ones of runs no longer on the page are cancelled. `navigator.connection.saveData`
  turns it off. `staleTime` stays the app's 30 s: opening within 30 s issues 0 requests, later the cached rows show and one background refetch runs (existing behaviour). Score edits and pass deletion keep invalidating the same keys.
- **No batch route (decision R7-D5).** One request for the page's repeat runs would save round trips (Fast 3G: 1 x 0.63 s plus 12 x 58 ms, about 1.3 s, against about 2.5 s for 12 runs at 4 in flight) but costs the same server CPU (28 statements per run either way, SQL is 8 to 36 ms of 66 to 322), makes a click on a not-yet-loaded run wait for the batch instead of fetching itself (0.63 s), loses the per-run error, retry and 15 s live refetch semantics of the existing keys, and adds an API surface to test. Per-run requests behind a small queue give the same bytes (about 1.7 kB gzip per run after `view=group`) and progressive filling. If the owner's links are slower than Fast 3G a batch is the next step.
- **Loading frame (keep round 4's, fix its height).** Placeholder child rows: `min(samples, 20)` (was 10), each `--row-compact`, `Loading passes...` as today; the strip frame renders the strip's own layout with skeleton values (same DOM, `aria-busy="true"`), so its height at 1024 is the loaded 56 px and at 1440 45 px. Prefetch makes this frame rare; it still has to be shift-free for the click-before-prefetch and Retry paths.

### Q2.4 Acceptance criteria

`q2-passes-load.mts` (client numbers; counts exact, times with the CI margin of section 7 of `perf6/perf.md`: strict local target under `QYM_PERF_STRICT=1`), `tests/platform` for the server rows.

| ID | Element and width | Criterion | Baseline | Measured by |
|---|---|---|---|---|
| Q2-1 | `GET /api/runs/{id}/group-metrics?view=group`, first request for a (metric, threshold), seeded 10 x 1,200 and 10 x 300 | <= 60 ms and <= 25 ms (median of 5 distinct thresholds, loopback); response keys exactly `run_id, metric, direction, threshold, samples, report_k, group`; <= 700 B; **0** rows added to `run_metric_analyses`; `group` equals the default view's `group` for the same arguments | 10,900 / 2,630 ms; 3,626 B (default view) | `tests/platform/test_run_group_metrics_view.py` |
| Q2-2 | the same endpoint without `view` | response unchanged byte for byte (all keys, `band` as before); cached after the first call (second request <= 15 ms) | 9.6 ms warm | same file |
| Q2-3 | `GET /api/runs/{id}/passes`, seeded 10 x 1,200 and 10 x 300 | <= 340 ms (**amended** from 300: measured 316.3 ms; this round does not touch `/passes`, so its 322 ms baseline cannot drop below the first draft's 300) and <= 80 ms (measured 67.1) (median of 9 loopback requests); SQL statements **equal at both sizes and <= 28** (28 and 28 measured) | 322 / 66 ms, 28 and 28 | `tests/platform/test_run_passes_statements.py` (count via an engine event), `measure/passes_profile.py` |
| Q2-4 | `tr[data-run-id]` chevron click at 1440, passes prefetched (list painted, 3 s idle) | rows (10 `tr[data-pass-row]`) and strip statistics painted <= **80 ms** after the click, local and Fast 3G; **0** requests after the click | 132 ms local / 632 ms Fast 3G (warm, not prefetched), 10 requests for 5 groups | `e2e/perf/runs-passes-load.spec.ts`, `q2-passes-load.mts` |
| Q2-5 | the same click on a run whose prefetch has not started (the spec clicks within 100 ms of the list paint, or holds the prefetch queue with a test flag) and that nobody opened before (no cached analysis row), 10 x 1,200 and 10 x 300 | rows <= 500 ms / <= 250 ms local (**amended** from 450 / 250, see Q2.2), <= 1,000 ms Fast 3G; exactly 2 requests (passes, `group-metrics?...&view=group`) caused by the click (the spec runs with `saveData`, i.e. the prefetch off, to isolate them) | 11,225 / 2,805 ms local | same |
| Q2-6 | five groups opened one after the other after prefetch | **0** requests after the first click, every group <= 80 ms; total requests since page load: 3 (list) + <= 2 per repeat run (cap 20) | 10 requests, 11.6 kB after the clicks | same |
| Q2-7 | prefetch scheduling on the seeded page (17 repeat runs) | first prefetch request starts after the list rows are painted and the list's 3 requests are done, within 600 ms of that moment; <= 4 requests in flight at any time; row order; <= 20 runs; all settled <= 2.5 s local, <= 8 s Fast 3G; <= 34 requests, <= 30 kB gzip; the list's own request count is unchanged (3) | none | spec with a request log |
| Q2-8 | prefetch exclusions | no request for a RUNNING / PENDING run before it is opened; none for runs not on the page after a filter or page change (cancelled or never started); none when `saveData` is set; opening a prefetched group within 30 s issues 0 requests, a group already in flight issues no second request | not applicable | Vitest on the scheduler (fake timers, fake query client) and the spec |
| Q2-9 | open group while loading, `tr[data-loading-row]` x N plus the strip frame, 1440 and 1024, N = 10 and N = 19 | placeholder rows = `min(samples, 20)`; the table's height at the placeholder frame equals the height at the loaded frame (**0 +- 1 px**); strip frame 45 px at 1440 and 56 +- 1 px at 1024 | 0 px at 1440, **11.4 px at 1024**, 288 px for 19 passes (computed) | `q2-passes-load.mts` heights (`heightPlaceholders`, `heightAfterRows`, `stripPlaceholderPx`, `stripLoadedPx`), spec with a 19-pass fixture |
| Q2-10 | `PassGroupStrip`, Metric select or threshold change on an open group | the new statistics arrive <= 100 ms after the change locally (request `view=group`); the previous values stay dimmed meanwhile (unchanged) | 2,624 / 2,627 ms | spec |
| Q2-11 | error paths | a failed prefetch shows nothing until the group is opened; opening shows `Could not load passes` and Retry as round 4 (Q22); a failed `view=group` shows the existing `Group metrics are not available` sentence | as before | `e2e/runs-list/passes-rows.spec.ts` (Q21 and Q22 updated) |
| Q2-12 | run detail repeat section | still uses the default view (`band`, `distribution`, `uncertainty` present); its numbers equal the strip's `group` for the same metric and threshold | unchanged | `e2e/run-detail/redesign3-repeat.spec.ts` (unchanged) plus an equality assertion |

### Q2.5 Tests to write

pytest `tests/platform/test_run_group_metrics_view.py` (Q2-1, Q2-2: a seeded 10-pass run built through the ingest API as `test_repeat_runs_platform.py` does; DB rows counted before and after) and `test_run_passes_statements.py` (Q2-3, statements at 20 and 80 items);
Vitest `features/runs-list/passes/prefetch.test.ts` (order, cap 20, concurrency 4, terminal statuses only, abort on rows change, saveData, `groupQueryFor` equals the strip's key) and `PassGroupStrip.test.tsx` (view param, skeleton frame);
Playwright `e2e/perf/runs-passes-load.spec.ts` (Q2-4 to Q2-9, request log through `page.on('request')`), updates to `e2e/runs-list/passes-rows.spec.ts` (Q21 frame, Q22).

### Q2.6 Implementation notes

`packages/platform/qym_platform/api/runs.py` (`run_group_metrics`: `view` query parameter, early return before `cached_repeat_analysis`), `tests/platform/*`, `frontend/src/api/dashboard.ts` (`useGroupMetrics` view option and key, `groupQueryFor`, `prefetchRunGroup`), `frontend/src/api/dashboardTypes.ts` (`GroupMetrics` with optional `band`, `distribution`, `uncertainty`), `features/runs-list/RunsTable.tsx` and a new `passes/usePassesPrefetch.ts`, `passes/PassGroupStrip.tsx` (skeleton frame, `view: 'group'`), `passes/rows.ts` (`loadingCount` = min(samples, 20)). No new visible default: prefetching and the frame height are not visible choices (decision R7-D6).

### Q2.7 Not done in this round (and when it becomes necessary)

The prefetch spends server CPU on every list view: about 1.2 s on the seed (17 runs, at most 12,000 item-passes each). With runs 4x larger the cap-20 prefetch is about 5 s of CPU per list view, and a cold `/passes` of a 5,000-item x 10-pass run is about 1.2 s (25 us x 50,000). The structural answer is to precompute per-pass aggregates (means, counts, latency, trace stats) when
the run summary ledger refreshes (`dashboard_summaries`, `ingest.py` "refresh affected contributions") so `/passes` is a lookup of a few ms and the prefetch is free. That is a migration and a backfill, so it is recorded as a follow-up with its break-even rather than designed here; the criteria above (statement count, ceilings) are what the follow-up must keep.
An `ETag` on `/passes` keyed on `pass_revision` was considered and rejected: `pass_revision` changes only on pass deletion, not on score edits or analysis writes, so a revalidation token built from it would serve stale numbers.

## D1. Run detail: the frozen input is laggy when scrolling down

### D1.1 Problem (measured; `measure/baseline/d1-*.json`)

Two things are frozen while the reader scrolls down in the items section: the **item bar** (`[data-item-bar]`: `#2`, the verdict, the input preview, Copy link, Collapse; translated to the sticky line by `useStickyShift`, `ItemCard.tsx`) and, in the table, the **pinned columns**
(`#` and the chevron at the start, Trace at the end; Status and Input when the reader freezes them). Fixtures: `jsonKeys` item j-01 with every output key open (an open item 1,979 px tall with 594 elements, the bar stuck for about 1,900 px) and the
`big1200` table (1,200 items, 500 per page, windowed: 20 rows mounted); 120 wheel notches of 40 px in about 4.4 s (262 to 279 moving frames), or the scrollbar thumb dragged; 1440 and 1024.

**Is there a positional lag? No, not in anything headless Chromium can show.**

| Measure | Result |
|---|---|
| pinned `td` y against its row's first unpinned `td`, rows 3 to 8, per rAF frame, 1x and 4x, wheel and drag, default pins and +Status +Input | **0 px, 0 frames over 1 px** (262 to 279 frames per run) |
| item bar against the sticky line, DOM, per frame | <= 0.22 px (1024) and 3.55 px (1440) in the 2 frames where it reaches or leaves the line, 0 otherwise |
| item bar against a CSS-sticky control on the same line, **composited frames** (CDP screencast; touch drag in 8 gestures of 600 px; 50 ms of main-thread block every 120 ms; 1x and 4x) | **1 px in all 47 to 55 stuck frames**, 29 to 30 px in the last 4 (the bar leaves with the item: legitimate) |
| does the page scroller scroll while the main thread is blocked? (marker position per presented frame, 60 ms block per 120 ms) | yes, on the compositor thread (`ScrollTree::ScrollBy @ Compositor` in the trace); the marker travels 300 px in 29 / 56 frames for the app / a plain scroller; each wheel notch needs one main-thread hit test (`FindScrollTargetOnMainThread`), which is why a synthetic wheel never desynchronises |

So the "frozen cell drawn off its target" does not reproduce (same finding as perf round 6). The structural risk stays: the bar's position is written by JS on the main thread after the scroll event, while a trackpad fling scrolls on the compositor thread; the headless
input path resynchronises at every notch, so it cannot show the frame in which a real fling has moved and the bar has not. That risk is recorded (decision R7-D3, open question O1), not claimed as the cause.

**What does cost, with numbers.**

| Measure (median of 3) | Item detail, 1440 | | Table, default pins | Table, +Status +Input frozen |
|---|---|---|---|---|
| | 1x | 4x | 4x | 4x |
| dropped frames (> 25 ms) | 0 | 2 | **44 to 47** (1x: 0) | **46 to 47** (1x: 0) |
| long tasks (> 50 ms) | 0 | 1 | 15 | 15 |
| React commits | 7 | 7 | 13 | 13 |
| style recalcs / **elements styled** / max in one recalc | 91 / **25,616** / 523 | same | 223 / 25,803 / 346 | same |
| style recalc time | **78 ms** | **301 to 313 ms** (30% of 1,011 ms of main-thread task time) | 389 ms | 410 ms |
| Paint events / Paint time | 136 / 80 ms | 134 / 309 ms | 2,163 / 737 ms (1x), **2,755 ms (4x)** | 2,951 / 654 ms (1x), 2,518 ms (4x) |
| Layerize | 28 ms | 115 ms | 520 ms | 552 ms |
| compositor layers / sticky elements | 48 / 27 | | 122 / 66 | **194 / 110** |

Scrollbar drag, 4x: detail 3 to 4 dropped frames; table with +2 frozen 11 to 12 dropped frames, 6 long tasks. perf round 6's own scenario (`perf6/measure/scroll-table.mts TABLE=items CPU=4`, 17 rows mounted, 60 px per notch) on this tip: **20 dropped frames, 22 to 25 long tasks, 27 commits**,
inside its amended ceilings (<= 26, <= 40). The round-7 scenario is harsher (20 rows mounted, 4.4 s); the same code gives 44.

**Root causes.**

1. **Style fan-out on every scroll event of an open item.** `ItemCard` calls `useStickyShift` without `shiftTarget`, so `--head-shift` is a custom property written on the `<article>`. A custom property is inherited: the card's 594 descendants
   (key rows, matrix, panel) are restyled by the writes: 91 recalcs of up to 523 elements in one scroll, 25,616 elements styled, 78 ms at 1x, **301 ms at 4x**. Measured effect of the fix with an injected prototype (the write redirected to the bar element):
   **1,376 elements, 15.5 ms at 1x, 54.1 ms at 4x** (-95% elements, -80% time); dropped frames and paint are unchanged (the detail scroll does not drop frames even at 4x, so this is headroom and the feel of the bar, not a missed-frame fix).
2. **Table scrolling is Paint-bound at 4x**: 2,755 of 4,266 ms of main-thread task time are Paint (2,163 events in 4.4 s), 520 ms Layerize, 389 ms style recalc over the same 25.8k elements; 155 rows enter the window in 60 notches and each creates three tiny sticky layers
   (32 x 52, 64 x 52, 48 x 52 clips, 155 paints each) once. Candidates that were **measured not to be the driver** (4x, no trace, 3 reps; baseline 44): start pins made static 42 (sticky 66 -> 22); all pins static 39 (sticky 0, layers 16); both `.edge` cues removed 41; the header's JS shift removed 42; the sticky header removed 45;
   `contain: layout paint style` on rows 43. The frozen Input costs **+3 dropped frames, +72 layers, +36% paints**: the clamped input text (`-webkit-line-clamp: 2`) is not the lag.
3. **Structural**: the item bar and the table header are JS-translated (risk above).

### D1.2 Design

- **F1 (the measured fix).** `ItemCard` passes `shiftTarget: (c) => c.querySelector('[data-item-bar]')` to `useStickyShift`, so the shift is written on the bar only (the hook already supports it; the table header already uses it on `thead`). `ItemBar.module.css` keeps `transform: translateY(var(--head-shift, 0px))`;
  `will-change: transform` only while `[data-stuck]`. A scroll event then restyles the bar and its few children.
- **F2 (decision).** Pinned cells keep `position: sticky`. Making start pins static or removing every sticky element moves 4x dropped frames by 2 to 5 (noise-level) and would break horizontal pinning; perf6's option E3 (one sticky cell per row) is not built (it changes keyboard and resize semantics and the experiment above shows no payoff).
- **F3 (decision).** The table's 4x frame cost is not reduced in this round beyond what Q1 removes (two layers); the criteria hold the line (D1-6, D1-7) and the first task of the implementer is to attribute the Paint time to the windowed cells with the existing `Paint` clips (the numbers above are the baseline), not to guess.
- **F4 (open).** If the reviewer or the owner still sees the bar trail on a real trackpad after F1, the bar is moved to a compositor-driven technique (CSS scroll-driven animation on the page scroller, `@supports (animation-timeline: scroll())`, with F1 as the fallback). That cannot be validated in headless Chromium, so it is a recorded option (open question O1), not part of the criteria.

### D1.3 Acceptance criteria

`d1-scroll.mts` (`TARGET=detail|table`, `PINS`, `CPU`, `MODE`), `d1-bar-jank.mts`, perf6's `scroll-table.mts` for D1-7; 1440 and 1024; median of 3.

| ID | Element and width | Criterion | Baseline | Measured by |
|---|---|---|---|---|
| D1-1 | pinned `td[data-pin]` of rows 3 to 8 of `[role=treegrid][aria-label=Items]`, 1440 and 1024, wheel and drag, 1x and 4x, default pins and +Status +Input | y differs from the row's first unpinned cell by **0 px in every frame** (frames over 1 px: 0) | 0 px, 0 frames | `d1-scroll.mts` `pinnedMaxYErrPx`, `pinnedFramesOver1px` |
| D1-2 | `[data-item-bar]`, open item j-01, 1440 and 1024, 1x and 4x, DOM | after the first frame in which the bar reaches the sticky line, <= 1 px from it in every frame until the item ends; <= 4 px in the entry and exit frames | 3.55 px (entry, 1440), 0.22 (1024) | `barMaxErrPx` |
| D1-3 | `[data-item-bar]` against a CSS-sticky control on the line, composited frames, touch drag, 50 ms block every 120 ms, 1x and 4x | |bar - control| <= 1 px in every presented frame before the item ends (the control is the compositor's truth) | 1 px in 47 to 55 frames | `d1-bar-jank.mts TOUCH=1` (**a script-measured guard, not a Playwright assertion**: it needs composited screencast frames under a touch drag; `item-scroll.spec.ts` asserts D1-2 on the DOM instead) |
| D1-3b | `[data-item-bar]` against the same control, composited frames, **a synchronous 400 ms main-thread block started with `page.evaluate` (not awaited) and one compositor scroll gesture (`Input.synthesizeScrollGesture`) while a screencast and a trace record**; the bar starts stuck (`PRESTUCK=1`) | in every presented frame in which the page moved (a plain marker changes y), |bar - control| <= 1 px; the notes state whether headless scrolled on the compositor during the block (`ScrollTree::ScrollBy` off the main thread inside the block's window) | none (added in round 7) | `d1-bar-jank.mts BLOCK=400 PRESTUCK=1` (**a script-measured regression guard, not a Playwright assertion**: the headless input path cannot scroll on the compositor during a main-thread block, so the harness cannot fail today) |
| D1-4 | scroll events while the bar is stuck, 1440, wheel | elements styled <= **20 per recalc on average and <= 150 in any one**; **<= 2,000 in the whole 2 s scroll** | 25,616 total, 281 average, 523 max | trace `UpdateLayoutTree.elementCount` |
| D1-5 | same | style recalc time <= **20 ms at 1x and <= 70 ms at 4x** over the scroll | 78 ms / 301 to 313 ms (prototype 15.5 / 54.1) | CDP `RecalcStyleDuration` delta |
| D1-6 | items table, 1440, wheel and drag, 4x | dropped frames: table <= 47, table +2 frozen <= 50, detail <= 2, drag (table +2 frozen) <= 12; long tasks <= 16 (table), <= 1 (detail), <= 6 (drag); at 1x 0 dropped frames, <= 1 long task | 44 to 47 / 46 to 47 / 2 / 11 to 12; 15 / 1 / 6 | `d1-scroll.mts` |
| D1-7 | perf6 `scroll-table.mts TABLE=items WIDTH=1440 CPU=4 NOTRACE=1` on the round-7 tip | A5 and A6 of perf round 6 hold: <= 26 dropped frames, <= 40 long tasks; A4 commits <= 220; A2 <= 8 layouts in scroll dispatch | 20 / 22 to 25 / 27 commits | perf6 script, `e2e/perf/table-scroll.spec.ts` |
| D1-8 | pinned cells and layers, items table, +2 frozen | sticky elements = pinned cells in the DOM (1:1: 66 and 110); compositor layers <= 200; pinned-cell paints <= 1 per cell per row that enters the window and **0 in frames where the window did not change** | 66 / 110 sticky, 122 / 194 layers; 155 paints per pinned column for 155 rows entered (met) | CDP `LayerTree`, trace `Paint` clips |

### D1.4 Tests to write

Vitest `ui/DataTable/__tests__/stickyShiftTarget.test.tsx` (the hook writes `--head-shift` on the element `shiftTarget` returns and nowhere else) and `features/run-detail/components/items/ItemCard.test.tsx` (the shift lands on `[data-item-bar]`, not on the article);
Playwright `e2e/perf/item-scroll.spec.ts` (new: D1-1 to D1-5 and D1-8 with a CDP session and the jsonKeys fixture from `seed-r7.mts` moved into `e2e/run-detail/seed.ts` as `seedR7JsonKeys`; counts asserted exactly, times with the CI margin; D1-3 under `QYM_PERF_STRICT=1`); `e2e/perf/table-scroll.spec.ts` keeps D1-6 and D1-7.

### D1.5 Implementation notes

`features/run-detail/components/items/ItemCard.tsx` (`shiftTarget`), `ItemBar.module.css` (`will-change` while stuck), `ui/DataTable/useStickyShift.ts` (no change needed; its doc comment names the rule: the shift goes on the nearest moving element), `docs/internal/ui-migration/perf6/perf.md` D1 cross-reference.

## D2. Run detail: the name of a JSON key must always be fully visible

### D2.1 Problem (measured; `d2-keys.mts`, `measure/baseline/d2-keys-baseline.json`, `current-d2-*.png`)

Fixture: `jsonKeys` items j-01 (English) and j-03 (Arabic), 1440 / 1024 / 390. Keys of exactly 10 (`confidence`), 40 and 80 characters in snake_case and camelCase, depth-4 nesting, Arabic keys, the key `reasoning`; the same keys in the Expected value,
the item metadata (Tags) and the metric details of `schema_judge`. For every key / value pair the probe compares the key's text box with the value's (preview or type), the copy and Expand all / Collapse all buttons and its own box.

| Region | State | Width | Rows | Key cut (ellipsis) | Key box 0 px | Value over buttons | Key under copy | Worst |
|---|---|---|---|---|---|---|---|---|
| Output tree, English | collapsed | 1440 / 1024 | 9 | **4** | 0 | 0 | 0 | 364 px cut |
| | collapsed | 390 | 9 | **6** | 0 | 0 | 0 | 464 px |
| | all open | 1440 / 1024 | 22 | **7** | 0 | 0 | 0 | 364 px |
| | all open | 390 | 22 | **13** | **9** | **9 (27 to 29 px)** | 0 | 560 px cut, 29 px over |
| Output tree, Arabic | collapsed / open | 1440 | 7 / 10 | 2 / 3 | 0 | 0 | 0 | 198 px |
| | collapsed / open | 390 | 7 / 10 | 5 / 6 | 0 / **3** | 0 / **3** | 0 | 219 px, 29 px over |
| Expected (sections) | default | 1440 | 4 | 0 | 0 | 0 | 0 | none (the 80-character key fits) |
| | default | 1024 | 4 | 0 | 0 | 0 | **1 (24 px)** | key 76 px past its row |
| | default | 390 | 4 | 0 | 0 | 0 | **2 (24 px)** | keys **416 px and 114 px past their row** |
| Metric panel facts | open | 1440 | 6 | **4** | 0 | 0 | 0 | 288 px cut |
| | open | 390 | 6 | **3** | 0 | 0 | 0 | 201 px cut |

The gap between a key and its preview is **6 px** in every tree row (9 of 9 collapsed rows, 9 of 22 open ones; the recipe wants 8). No key overlaps its preview in the tree at 1440 (a 28ch cap prevents it, round 5 decision 10); the overlap the owner sees is the three failures above.

**Root causes.**

1. **The 28ch cap.** `.key { max-inline-size: 28ch; text-overflow: ellipsis; white-space: nowrap }` cuts every key over 28 characters, so the 40- and the 80-character key of the seed both read `customer_eligibility_assess...` (and two camelCase keys `retrievedPolicyDocumentIden...`): two different keys look identical, which breaks "the name should always be fully visible" even without an overlap.
2. **The open nested row squeezes its key to nothing at 390.** `.head` is `[toggle: chevron, key, type] [Expand all] [Collapse all] [Copy]` on one flex line in 233 px. The key is the only shrinkable item (`min-width: 0`), the `type` text (`object . 1 key`) wraps (no `nowrap`, no `flex: none`), the buttons do not shrink: the key's box goes to **0 px** (`plan`, `steps`, `step_one` are invisible) and the wrapped `array . 2 items` prints 27 to 29 px over `Expand all` (`current-d2-output-expanded-en-390.png`).
3. **The sections key never shrinks.** `StructuredValue.module.css` `.key { flex: none }` with an uppercase tracked 80-character name is 619 px wide: at 1024 and 390 it runs under the copy button (24 px) and past its row (76 / 416 px).
4. **Fact keys and prose labels are nowrap + ellipsis** (round 5 R3): `.fact dt`, `.eyebrow`. Fixed-column truncation hides the key (288 px cut at 1440).
5. **RTL.** The key carries `dir="ltr"`; the ellipsis then cuts the *start* of an Arabic key (the visible text is `..._والاستثناءات_المطبقة_على_الشريحة`, the beginning `تحليل_أهلية_العميل...` is gone: 198 px). A Tag prints `{key}: {value}` as one text run, so with an Arabic key and an Arabic value the bidi algorithm reverses the pair: the value starts left of the key (**key x 1116, value x 1083** at 1440; 138 / 105 at 390).

### D2.2 Design (`mock-r7-keys-long-*.png`, `mock-r7-keys-rtl-*.png`, `mock-r7-metric-facts-*.png`; CSS in `Round7Mocks.module.css`)

The rule (owner decision, section 6): **a key is never truncated and never clipped.** Its text box equals its scroll box, it wraps (`overflow-wrap: anywhere`, `white-space: normal`), and whatever follows it starts after its last line.
Typography is unchanged (decision R7-D8); **case is exact (orchestrator decision 2, reversing R7-D1; amended)**: a data key renders as written, with no uppercase transform and no tracking: tree keys mono 12 px 600, section keys sans 11 px 650, fact keys sans 11 px 650 and **the judge key as written** (`self_consistency_check_result`, not the humanized "Self consistency check result"). The uppercase tracked eyebrow stays for fixed UI labels (Input, Expected, Output, the prose label of the panel).

**Key tree row** (`KeyTree.tsx` / `.module.css`):

```
row     head (flex, wrap, align-items: flex-start, min-block-size --row-compact)
          toggle (grid: 14px | minmax(0,1fr); flex: 1 1 12rem; padding-block 7px)       actions (flex: none; margin-inline-start: auto)
            chevron                                                                         Expand all  Collapse all  Copy
            line (flex, wrap, baseline, column-gap --space-sm = 8px)
              key    [data-part=key]   flex: 0 1 auto; max-inline-size: 100%; overflow-wrap: anywhere; mono 12/600; line-height 1.5
              value  [data-part=value|type]  flex: 1 1 12ch; max-inline-size: max-content; nowrap, ellipsis (a preview may be cut, a key never)
```

- **One line when it fits**: the preview takes the rest of the key's last line when at least 12ch (about 86 px) remain after an 8 px gap; otherwise it starts the next line, indented under the key. `max-inline-size: max-content` keeps an Arabic preview next to its key (the value's box is as wide as its text, never stretched to the row's far end).
- **The type text** (`object . 2 keys`) is `flex: 0 0 auto` and `nowrap`, so it can never wrap into the buttons.
- **Actions wrap under the name**: the toggle's basis is `12rem` (192 px) and the actions group is `flex: none`, so when the head is narrower than both they wrap to a second line, right-aligned (open nested rows at 390: 32 + 32 = 64 px). The key never gives up width for them.
- `dir`: the key text element carries `textDirAttrs(key)` (`dir="rtl" lang="ar"` for mostly Arabic, else `dir="auto"`) with `unicode-bidi: isolate`; the row stays `direction: ltr`, so the key box stays at the inline start (left) whatever its script and an Arabic key is read from its beginning.
- Depth guides unchanged (`.body` margin 7 px, padding-inline-start 14 px, 1 px border): at depth 4 a 57-character key still wraps to 3 lines at 390 (measured).

**Sections variant** (Input / Expected): same toggle / line structure; the key is `flex: 0 1 auto; max-inline-size: 100%; overflow-wrap: anywhere`, the summary the same preview rule, the copy button in the same actions slot.

**Facts** (`.fact`): `grid-template-columns: fit-content(40%) minmax(0, 1fr)`; `dt { min-inline-size: var(--field-label-width); overflow-wrap: anywhere; no nowrap, no ellipsis }`, the `dir` on an inner `<span>` so the label stays left-anchored; stacked under 420 px of container width as today (key above value, 2 px). **Prose labels** (`.eyebrow`) wrap too. **Tags**: the key and the value are two `dir="auto"` + `unicode-bidi: isolate` spans so the key always precedes the value.

Per width (mock, container 1,153 px at 1440, 737 at 1024, 239 at 390; keys of 10, 40, 80 characters):

| Width | Tree key 10 / 40 / 80 characters | Preview | Open nested row | Facts (key column) | Sections key (uppercase) |
|---|---|---|---|---|---|
| 1440 | 1 / 1 / 1 line | same line, gap 8 px | 32 px, actions on the same line | 40% of a 360 px fact: 1 / 2 / 4 lines (value beside it, `dd.left >= dt.right + 12`) | 1 / 1 / 1 |
| 1024 | 1 / 1 / 1 | same line (80 characters: 576 + 20 + 8 + 86 = 690 <= 737) | 32 px | 1 / 2 / 4 lines | 1 / 1 / 1 |
| 390 | 1 / 2 / 3 lines (depth 3, 57 characters: 3) | keys over about 15 characters: preview or type starts below the key (4 of 7 collapsed rows) | 64 px: name 32, actions 32 | stacked: key above value, 1 / 1 / 2 lines | 1 / 2 / 4 |

Row heights: a row whose key and preview share a line stays `--row-compact` 32 px (0 px change for every key that fits); a wrapped key row is `lines x 18 + 14` px, +18 px when the preview stacks (mock: 68 px for a 40-character key with a preview at 390, 86 px for 80 characters).

### D2.3 Acceptance criteria

`d2-keys.mts` on the shipped UI (fixtures above), `d2-mock.mts` on the mocks (baseline of the specified values in `baseline/d2-mock-specified.json`: every count below is 0 on the mock). Hooks: the implementation adds `data-part="key"`, `"value"`, `"type"`, `"actions"` to the tree and sections rows, `"key"` and `"value"` to the fact `dt` / `dd` and the Tag spans, `"eyebrow"` and `"prose-text"` to the prose block; the probe prefers them.

| ID | Element and width | Criterion | Baseline | Measured by |
|---|---|---|---|---|
| D2-1 | every `[data-part=key]` (tree, sections, facts `dt`, eyebrow, Tag key), 1440 / 1024 / 390, j-01 and j-03, all states | `scrollWidth <= clientWidth` and `scrollHeight <= clientHeight`; computed `text-overflow` is not `ellipsis`; **0 rows with an ellipsis, 0 with `keyClipPx > 0`** | 4 to 13 truncated rows per case (above), up to 560 px cut | probe `ellipsis`, `keyClipPx` |
| D2-2 | the key's box | its width equals its text width on a single line (or the box fills the line when wrapped): **0 rows with a key box 0 px wide** | 9 of 22 (English) and 3 of 10 (Arabic) open rows at 390 | probe `keyBoxW`, `keyTextW` |
| D2-3 | key vs value, key vs actions, value vs actions, every row, every width | **0 px** horizontal overlap of painted text on a shared line | value over `Expand all` 27 to 29 px (12 rows at 390); key under Copy 24 px (1 row at 1024, 2 at 390) | probe `overlapPx`, `overlapActPx`, `valueOverActPx` |
| D2-4 | key and value on the same line, LTR | `value.left - key.right >= 8 px`; an Arabic preview's text starts within 14 px of the key's inline end (next to the key, never at the row's far end) | 6 px (every row) | probe `gapPx` |
| D2-5 | a row whose key plus 8 px plus 12ch does not fit the line (390, keys over about 15 characters) | the preview or type starts below the key's last line (`valueBelowKey`, `top >= key.bottom - 1`), indented under the key, 0 px overlap | squeezed beside the key | probe `valueBelowKey` |
| D2-6 | keys of 10, 40 and 80 characters | wrap, never more than 4 lines at any width: tree 1 / 1 / 1 lines at 1440 and 1024, 1 / 2 / 4 at 390 (**amended** from 1 / 2 / 3 by the word-boundary breaks, section 9.1; depth 3, 45 to 60 characters: 4); sections key at 390: 1 / 2 / 3 (**amended** from 1 / 2 / 4: the exact-case name is narrower than the uppercase tracked one); facts key column at 1440 and 1024: 1 / 2 / 4, stacked at 390: 1 / 2 / 3 (**amended** from 1 / 1 / 2: the raw key has no spaces to break at); a 60-character key at depth 3 and 390 takes 4 lines (**amended**: the nested rows start 63 px in) | not wrapped | probe `keyLines` |
| D2-7 | row height | a row with a one-line key and a one-line preview is 32 +- 1 px (unchanged density; **amended**: an Arabic row is 34 +- 1, as in the mock, from the font's line box); wrapped rows `lines x 18 + 14` +- 2 px (+18 +- 2 when the preview stacks) | 32 px | probe `rowH` |
| D2-8 | the actions group of an open nested row | `flex: none`, right-aligned (`margin-inline-start: auto`); wraps under the name when the toggle (`flex: 1 1 auto`, **amended** from a 12rem basis: it keeps the width its content wants) and the actions do not fit on one line: at 1440 every open row is 32 px on one line (0 rows with the actions below); at 1024 only the two longest names (57 and 80 characters) push them down (64 px); at 390 a row whose key plus type or value is wider than about 150 px does (64 px), short keys such as `source` or `page` stay on one 32 px line | one squeezed line | probe `rowH`, box |
| D2-9 | Expected / Input sections key, 1024 and 390 | **0** keys past their row (`keyBeyondRowPx`), 0 px over the copy button | 76 px (1024); 416, 114 and 104 px (390) | probe |
| D2-10 | metric panel facts `dl.facts > div`, 1440 / 1024 / 390 | key column `fit-content(40%)`, at least `--field-label-width` (120 px), **the key as written** (amended, decision 2); side by side when the container is >= 420 px with `dd.left >= dt.right + 12`; stacked below with `dd.top >= dt.bottom + 2`; 0 ellipsis; `dt` box = scroll box | 4 of 6 cut at 1440 (288 px), 3 of 6 at 390 (201 px) | probe `facts` |
| D2-11 | prose label `[data-part=eyebrow]` | wraps, 0 ellipsis, at least 2 px above the text (`eyebrow.bottom <= text.top - 2`) | nowrap + ellipsis | probe |
| D2-12 | Arabic keys (j-03), tree, sections, facts, 1440 and 390 | the whole key is visible (0 clipped, 0 ellipsis, the beginning of the key is never cut); the key box is at the inline start of its row (`key.left` within 8 px of the chevron's right + 6 px; fact `dt` text left-anchored); `dir` on the key text element, not on the row | key cut at its start, 198 px | probe |
| D2-13 | Tag `key: value` with an Arabic key and value (the `تصنيف_...` tag), 1440 and 390 | the key's left edge is left of the value's (LTR container); the tag stays inside its row (`tag.right <= row.right`) | reversed: key x 1116 / value x 1083 (1440), 138 / 105 (390) | script in `d2-keys.mts` extension (`r7d-tags` probe) |
| D2-14 | CSS and docs | no `text-overflow: ellipsis` and no `white-space: nowrap` on `.key`, `.sectionKey`, `.fact dt`, `.eyebrow` rules; `design-language.test.ts` pins it; `DESIGN_LANGUAGE.md` "Item details" (the sentence "`FieldRow` labels and `KeyTree` keys are cut at their column (ellipsis, title)") and `redesign5/run-detail.md` R3-3 / R3-7 / R3-21 carry the reversal | present | design test, review |
| D2-15 | every `[data-part=key]` of the item card (tree, sections, facts `dt`, Tag key), j-01 and j-03, 1440 and 390, every output key open and the schema_judge panel open | the rendered text (`innerText`, which applies `text-transform`) equals the source key string (`textContent`) exactly: **0 mismatches**; no key has a `text-transform` other than none; the prose eyebrow (`[data-part=eyebrow]`) is the one uppercase label | uppercase section keys, humanized fact keys | `e2e/run-detail/redesign7-keys.spec.ts`, `measure/d2-exact.mts` (added in round 7) |

### D2.4 Tests to write

Vitest `ui/StructuredValue/__tests__/keyTree.parts.test.tsx` (every key row exposes `data-part` key / value / type / actions, the key text element has `dir` from `textDirAttrs`, no `title`-only keys) and `features/run-detail/components/items/MetricStrip.facts.test.tsx` (`dt` has no truncation class);
Playwright `e2e/run-detail/redesign7-keys.spec.ts` (new, the `jsonKeys` fixture moved into `e2e/run-detail/seed.ts` as `seedR7JsonKeys`): D2-1 to D2-13 at 1440 / 1024 / 390, the probe code of `d2-probe.mts` inlined (a spec cannot import a script in `docs/`). Update `redesign3-item-details.spec.ts` and `redesign5-metric-panel.spec.ts` (R3-3, R3-7, R3-21 now assert full visibility, not ellipsis plus title).

### D2.5 Implementation notes

`ui/StructuredValue/KeyTree.tsx` + `KeyTree.module.css` (the structure above; keep `data-depth`, `aria-expanded`, `aria-controls`), `StructuredValue.tsx` + `.module.css` (sections head), `features/run-detail/components/items/MetricStrip.tsx` + `.module.css` (`.fact`, `.eyebrow`, prose label), `ItemCard.tsx` (Tags as two isolated spans), `ui/FieldRow` (its label rule changes the same way for data keys: wrap, no ellipsis), `lib/text.ts` (no change: `textDirAttrs`). The mock CSS is the recipe; copy it, rename classes.

## D3. Run detail: table boundaries only inside the table

### D3.1 Problem (measured; `edge-items-{1440,1024,390}.json`, `d3-header-{1440,1024}.json`, `current-edge-items-detail-open-*.png`)

The owner's "same comment" is the same defect in the items table: the shared `DataTable` overlays (Q1) are drawn in the items table too, and here the table sits in the page scroller, so the overlay is as tall as the whole body.
Fixture: `big1200`, 500 rows per page, 5 traced items (so the Trace column is pinned at the end: pins 96 px start / 48 px end), item #2 open (575 px detail).

| State, 1440 | Cue boxes | Text under a cue (nodes / px / worst) | What is under it |
|---|---|---|---|
| rest | start (hidden) and end: **26,058 px tall** (the 500-row body), end at opacity .85 | 0 | nothing: the boundary falls between columns |
| item #2 open, rest | end cue + fade cross the detail (575 px) | 2 / 44.5 px / 25 px | the **Collapse** button of the item bar and **Collapse all** of the Output header (contrast 1.1 to 1.9) |
| item open, scrolled 253 px | start cue + fade cross the detail and 26 rows | 33 / 698.5 px / 25 px | the Input and Expected text of the detail (`Clause 1 requires written ap...`, 1.1:1), 26 row inputs |
| scrolled to the end | same | 33 / 698.5 px / 25 px | same |
| 1024: rest / item open / scrolled / end | 26,058 / 26,633 px tall | 4 / 88 px; 5 / 113.5 px; 23 / 499 px; 16 / 332.5 px | header labels, the item bar, detail text |

Further findings: the nested embedded tables inside an open item (the metric matrix, a `DetailTable`) render their own `.edge` pair (a 162 px tall cue appears inside the detail; the matrix has a pinned metric column); at 390 the table is cards and nothing is drawn.
The other boundaries the owner may mean are already inside the table's box and are kept as guards: the sticky header (translated by `useStickyShift`) is exactly at the sticky line (0 px above), its cells reach 0 px past the card on the left and are clipped by the scroller on the right (`overflow: auto`),
it never overlaps the toolbar or the footer (0 px), and the item bar is 0 px past the card on both sides (`d3-header.mts`: header-stuck and item-bar-stuck states, 1440 and 1024).
The cause is the one of Q1: an overlay as tall as `.bodyHost`, not a property of the pinned cells, so it crosses the expanded item (laid out outside the columns).

### D3.2 Design

The **same rule in the shared primitive** (Q1.3): no overlay, the boundary is the pinned cells' own `--border-strong` 1 px line, so in the items table it exists exactly on the rows that have pinned cells, stops at the top of an expanded item (the detail row has no pinned cell) and resumes below it
(`mock-r7-edge-items-1440.png`: gap 224 px = the open item), never touches the toolbar, the pagination, the page background or the detail's text. Nested embedded tables follow the rule because they are `DataTable`s. The sticky header and the item bar need no change (guards D3-5, D3-6).

Places the reviewer checks (every table that pins a column; each at rest and scrolled, 1440 and 1024): runs (`features/runs-list/RunsTable.tsx`: Run, Status start; Actions end), items and its open item (`run-detail/components/items/ItemsTable.tsx`: `#` start, Trace end), the item's metric matrix (`MetricMatrix.tsx`, nested) and the run's `PassTable.tsx`,
compare `AveragesMatrix.tsx`, experiments (`list/ExperimentsPage.tsx`, `queue/QueuePage.tsx`, `queue/RemoteQueueSection.tsx`, `detail/JobHistoryCard.tsx`), datasets (`detail/ItemsTab.tsx`, `detail/RunsTab.tsx`, `item/ItemRunsTab.tsx`, `catalog/DeletedDatasetsPage.tsx`), admin (`runs/RunTables.tsx`, `users/UsersTable.tsx`, `projects/ProjectsTable.tsx`, `maintenance/JobsTable.tsx`), settings (`MembersTab.tsx`, `ApiKeysTab.tsx` x2, `LlmConnectionsTab.tsx`), environments (`EnvironmentsList.tsx`, `PresetsSection.tsx`), profile (`ProfilePage.tsx`).

### D3.3 Acceptance criteria

`edge-cues.mts TABLE=items`, `d3-header.mts`, a generic table probe for the places list (the same `edge-probe.mts` against each route); 1440 and 1024 (390 is cards).

| ID | Element and width | Criterion | Baseline | Measured by |
|---|---|---|---|---|
| D3-1 | `#run-items [data-testid=data-table]`, states rest, item #2 open, scrolled 260 px, scrolled to the end | Q1-1 to Q1-5 and Q1-7 hold: 0 cue elements, **0 px** of text under any shade, the pinned line `--border-strong` 1 px on every pinned-edge cell, no transition on scroll | 4 live cues; overlap 0 / 44.5 / 698.5 / 698.5 px (1440), 88 / 113.5 / 499 / 332.5 px (1024) | `edge-cues.mts` |
| D3-2 | the pinned-edge cells of the items table, one side | extent = first header row top to last mounted row bottom; the only gap is the open item's detail row, equal to its height +- 1 px (575 px for item #2 at 1440 on `big1200`); **no element taller than the rows' box** | cue 26,058 px tall, across the detail | `lines.*.gaps`, boxes |
| D3-3 | inside the open item (`tr[data-detail-row]`: item bar, Input / Expected, Output header and keys, matrix, panel), 1440 and 1024, at rest and scrolled | `document.elementsFromPoint` at the pinned boundary's x for 5 y samples inside the detail returns no pinned-edge cell, no cue and no element with a gradient; every glyph keeps its unshaded contrast (the **Collapse** and **Collapse all** buttons >= 10.7:1 and 5.7:1) | 2 to 9 nodes shaded, "Collapse" 19.5 px under both cues | probe, `elementsFromPoint` |
| D3-4 | `#run-items [data-edge]` including nested embedded tables (metric matrix, passes, `DetailTable`) with an item open | **0** elements | 2 nested edge elements (162 px and 0 px tall; the matrix is a `DataTable` with a pinned metric column) | DOM |
| D3-5 | sticky header `thead` of the items table with the header stuck (page scrolled 1,000 px) and held above an open item, 1440 and 1024 | top = sticky line (**0 px above**), 0 px over the toolbar and the footer, cells 0 px past the card on the left; the pinned-edge line is the header cells' own (no extra element); the bottom hairline is the cells' border | 0 / 0 / 0 (guard) | `d3-header.mts` |
| D3-6 | `[data-item-bar]` stuck, 1440 and 1024 | bar `left >= card.left` and `right <= card.right` (**0 px past the card**), top = sticky line | 0 / 0 (guard) | `d3-header.mts` |
| D3-7 | the card's outside (1 px beyond its left, right and bottom edge at 20 y samples) | `elementsFromPoint` contains no pinned-edge cell, cue or table overlay; the toolbar, the footer and the page background carry no vertical line of the table | none (guard) | DOM |
| D3-8 | the places listed above (every table that pins a column), at rest and scrolled, 1440 and 1024 | 0 `[data-edge]`, 0 px of glyph under any shade, the line `--border-strong`; reviewer records the route and the numbers per table | overlay present in all | edge probe per route |
| D3-9 | docs and tests | `DESIGN_LANGUAGE.md` carries the rule ("a table's boundary is drawn by its own cells; nothing is painted over scrolling content or over a row that is not in the columns"); the `design-language.test.ts` case of Q1; `e2e/run-detail/redesign7-edges.spec.ts` asserts D3-1 to D3-7 | absent | design test, spec |

### D3.4 Tests to write

Playwright `e2e/run-detail/redesign7-edges.spec.ts` (D3-1 to D3-7 on `big1200`-like fixture from `seed.ts` with traces: `seedClassicRun({ items: 600, traced: 5 })`, item open, scrolled; the probe inlined) and a table-sweep spec `e2e/visual-language/table-edges.spec.ts` for D3-8 over the routes above using the existing seeds; Vitest `pinEdge.test.tsx` of Q1.

### D3.5 Implementation notes

Nothing beyond Q1 (`DataTable.module.css`, `DataTable.tsx`): the items table, its nested tables and every other `DataTable` consumer inherit the rule. `useStickyShift.ts`, `ItemBar.tsx` unchanged for D3 (D1 changes the shift target of the bar only).

## 6. Departures from earlier decisions and owner reversals

| Earlier decision | Now | Why |
|---|---|---|
| **Owner reversal R7-O1.** Round 5 R3 (`redesign5/run-detail.md` R3.4 item 3, R3-3, R3-7, R3-21, decision 10): long keys truncate with an ellipsis and a `title`; the 28ch cap on tree keys is "a guard, not a reproduced bug" | A key is **never truncated and never clipped**: it wraps; whatever follows starts after its last line; this holds for tree keys, section keys, fact keys, prose labels and Tag keys. A note is added to `redesign5/run-detail.md` | owner, 2026-10-19: "the name should always be fully visible". The cap is what hid the keys (4 to 13 truncated rows per item, a 40- and an 80-character key reading the same), and the squeeze that follows from `min-width: 0` on the key is what overlapped the content at 390 |
| **Owner rule R7-O2 (new).** Perf round 6 D5 and `DESIGN_LANGUAGE.md` "Data table" / rule 16: pinned columns carry "an edge shadow while content scrolls under them", faded by opacity; the scroll cues are a permitted fade | **Table boundaries are drawn by the table's own cells and nothing is painted over scrolling content or over a row that is not in the columns.** No gradient, no overlay element; a 1 px `--border-strong` line on the pinned cells' inner edge; the mirrored rail stays | owner, twice: "the line for actions is above the reliability metrics which makes it harder to read", "table boundaries should only be visible within the table itself". Measured: up to 25 px of a stat under both cues at 1.1:1 contrast |
| Round 4 section 4.6 loading frame: `loadingCount` caps placeholder rows at 10, the strip frame is a fixed 45 px | `min(samples, 20)` placeholder rows; the strip frame is the strip's own layout with skeleton values | measured 11.4 px shift at 1024 and 288 px for 19 passes (computed): the "0 px" guarantee of Q21 only held at 1440 |
| Perf round 6 section 4 / `perf6/perf.md` idle prefetch: skipped on `saveData`, `2g` and `3g`; "viewport gating is out" | The runs page prefetches the passes of its repeat runs by default; only `saveData` turns it off | the payload is about 1.7 kB gzip per run (not a chunk); the owner's reading of round 6 ("load by default, never gated on interaction when it can be prefetched") applies |
| `/api/runs/{id}/group-metrics` always returns the bootstrap curve (round 4: the strip shows its five statistics from it) | `view=group` returns only `group`; the default view is unchanged | measured 2.6 s and 10.9 s of bootstrap for numbers the strip does not show |
| Perf round 6 D5 argument that a state-driven cue must not repaint pinned cells on the first scroll tick | satisfied differently: the line is static (no state), so no cell repaints on scroll at all | Q1-7 |

## 7. Decisions I made (open questions; reverse any of them)

- **R7-D1 (reversed at implementation).** The design stage left key case unchanged (sections keys uppercase tracked). The orchestrator decided before implementation that data keys render in their exact case (a JSON key is part of the name the owner wants fully visible; `RETRIEVEDPOLICYDOCUMENTIDENTIFIERSUSEDTO` hides the word boundaries of `retrievedPolicyDocumentIdentifiersUsedTo`): section keys, tree keys, fact keys and Tag keys use `text-transform: none`; fixed UI labels keep the eyebrow style; criterion D2-15 pins it.
- **R7-D2** "Reliability metrics" = the five repeat-run statistics of the passes strip, because that is where the line crosses glyphs (25 px of "Reliability" at 1.1:1). The metric columns of the table are covered by the same fix (3 px of every value in the last column at rest).
- **R7-D3** "The frozen input" = the item bar (number, verdict, input preview), measured first; the frozen columns of the items table (and the Input column when frozen) are measured second. Neither shows a positional lag; the spec fixes what costs (D1-4, D1-5) and holds the line on the rest. If the owner meant another surface, say so (open question O1).
- **R7-D4** Prefetch: per run, after the list paints and settles, terminal runs only, cap 20, 4 requests in flight, `saveData` off, same query keys as the strip, so a click joins an in-flight request. The cap and the concurrency are numbers to tune against the owner's real data, not product constants.
- **R7-D5** No batch route and no `ETag` on `/passes` (reasons in Q2.3 and Q2.7). A batch is the next step on a link slower than Fast 3G; precomputed per-pass aggregates are the next step when runs outgrow 1,200 items x 10 passes.
- **R7-D6** The only visible changes: the pinned boundary line is `--border-strong` at rest on the start side too (it was `--border-subtle` until the table scrolled), long keys wrap, the loading frame has its real height. No default column, row height, density or information is removed (the fades and the shade carried no information the rail and the line do not).
- **R7-D7** The pinned `box-shadow` line stays physical (`inset -1px`/`1px`) with `:dir(rtl)` overrides, as the existing cells do, instead of switching to logical properties (`box-shadow` has none).
- **R7-D8** The group band cell next to the boundary gets `data-pin-edge` so the line covers the whole header (today the quiet line starts 24 px lower).
- **R7-D9** Pinned cells keep `position: sticky` (D1.2 F2); perf6's E3 is not built.
- **R7-D10** The mocks apply the specified recipe as CSS overrides on the shipped `DataTable` (the `.specified` class) and as a small parallel key-row markup; they are the contract, not code to ship. `Round4Mocks.tsx` exports `TableMock` and `Strip` for reuse (two keywords).
- **O1 (open, to ask once).** On which device and browser does the owner feel the frozen input lag (trackpad momentum scrolling on a high-DPI laptop is the case headless Chromium cannot reproduce)? Until answered F4 (a compositor-driven bar) stays an option.
- **O2 (answered).** Section keys show the exact JSON case (R7-D1 reversed, decision 2).
- **O3 (open).** Is a cap of 20 prefetched runs per page acceptable on the production database, or should the platform get the precomputed per-pass aggregates first (Q2.7)?

## 8. Hand-off for the implementer

Order (each step keeps `cd frontend && npm run check` and `pytest tests/platform/test_design_language.py` green and ends with its criteria; heavy runs through `scripts/heavy.sh` per AGENTS.md):

1. **Q1 + D3** (one change, the shared primitive): `DataTable.module.css` / `DataTable.tsx`, the pin-edge Vitest, the updated perf specs, `redesign7-edges` specs, `DESIGN_LANGUAGE.md` and the design test in the same commit. Criteria Q1-1 to Q1-9, D3-1 to D3-9.
2. **D2**: `KeyTree`, `StructuredValue` sections, facts, eyebrow, Tags, `data-part` hooks, `redesign7-keys` spec, the round-3 and round-5 specs that asserted ellipsis plus title, `DESIGN_LANGUAGE.md` "Item details" and the round-5 note. Criteria D2-1 to D2-14.
3. **Q2**: backend first (`view=group`, `tests/platform`, run `pytest tests/platform` in chunks of about 48 files because the backend is touched), then the client (`groupQueryFor`, prefetch, strip skeleton, `loadingCount`). Criteria Q2-1 to Q2-12.
4. **D1**: `ItemCard` `shiftTarget`, `item-scroll.spec.ts`. Criteria D1-1 to D1-8.

Amendment rule (`DESIGN_LANGUAGE.md` section 7): a number in this document changes only with its measured value and a one-line reason here, and the spec asserts the amended number on the same element. The mocks stay in the gallery as cases until the real components exist; the reviewer measures every criterion with the scripts in `measure/` (seed `seed-r7.mts`) and writes MEETS / MEETS WITH FIXES / DOES NOT MEET with the numbers, against the mocks and the screenshots above, not against "better than before".

## 9. Implementation record (round 7 implementation stage)

The numbers measured on the production build, the criterion -> change -> test table and the gate are in `impl-notes.md`. What changed in this document:

| Where | Amendment | Reason (one line) |
|---|---|---|
| D2 decision R7-D1, O2, D2.2, D2-10, D2-15 (new) | data keys render in their exact case; fact keys show the judge key as written; D2-15 pins it (0 mismatches of 54 keys) | orchestrator decision 2, before implementation |
| D2-6 | sections key at 390 1 / 2 / 3 (was 1 / 2 / 4); facts stacked at 390 1 / 2 / 3 (was 1 / 1 / 2); depth-3 60-character key 4 lines | exact case is narrower than uppercase tracked; a raw key has no spaces to break at |
| D2-7, D2-8 | Arabic one-line row 34 +- 1; the row head's toggle is `flex: 1 1 auto` (was a 12rem basis), so actions wrap only when the whole name does not fit beside them | the 12rem basis made a long open key give up width (2 lines at 1024) instead of the actions wrapping |
| Q2-3 | `/passes` ceiling 340 ms (was 300) | the endpoint is untouched in this round: 316.3 ms measured against a 322 ms baseline |
| Q2-5 | cold 10 x 1,200 click <= 500 ms (was 450) | the up to four prefetch requests in flight at the click still hold the server (460 ms measured; the queue yields to the click, which took it from 1.8 s) |
| D1 outcome | **native `position: sticky` for the item bar is impossible** (measured below); the bar keeps the JS shift (F1: the write moves from the article to the bar). D1-3b added | the nearest scroll containers of the bar are `.scroller` (`overflow: auto`) and `.bodyHost` (`overflow: hidden`): with a CSS-sticky bar the error against the line is 1,700 px at most (median 940); forcing both `overflow: visible` is not an option either: it breaks the table's sideways scroll (the first draft's "56 px left" was not reproduced by the review, which measured 0 px) |
| D1-3, D1-3b | 0 px in the 47 to 50 stuck frames (was 1 px), 4 px in the last 4 (the bar leaves with the item). Both are **script-measured guards** (`measure/d1-bar-jank.mts`), not Playwright assertions: D1-3 needs composited screencast frames, and the headless input path cannot scroll on the compositor during a block, so D1-3b cannot fail today | `will-change: transform` only while stuck |
| D3-2 probe | the line of the items table is measured over the cells outside `tr[data-detail-row]` | tables nested in an open item (the metric matrix) draw their own line |
| round 5 R3-14 at 390 | 1,540 px (was 1,530) | long fact keys wrap instead of ending in an ellipsis (measured 1,539) |

Not implemented, recorded: **F4** (a compositor-driven bar through a CSS scroll-driven animation on the page scroller, F1 as the fallback). D1-3b shows what it would have to beat: in headless Chromium no scroll happens on the compositor while the main thread is blocked 400 ms (the first page move is 455 to 492 ms after the block started, for a mouse gesture and for raw touch events alike), so the harness cannot tell F1 from F4 and stays as the regression guard; open question O1 (which device shows the lag) is still the owner's to answer.

### 9.1 Review fix pass (after `review-qa.md`, verdict MEETS WITH FIXES)

| Where | Change | Reason |
|---|---|---|
| Q1-8 | the rail is `flex: none`: **12 px at every row count** (asserted at 12 +- 0.5 px on a 50-row page at 1440 and 1024, `redesign7-edges.spec.ts`) | it was a shrinkable flex item of the height-capped card: 5.6 px (1440) and 5.3 px (1024) with 50 rows, identical to the baseline |
| Q2-3 | asserted in `tests/platform/test_run_passes_statements.py` on 10 x 300 and 10 x 1,200 fixtures (median of 9; 340 / 80 ms strict under `QYM_PERF_STRICT=1`, 4x CI margin otherwise) | an amended number needs a test on the same element |
| Q2-5 | the 10 x 1,200 case added to `e2e/perf/runs-passes-load.spec.ts` (`limit(3000, 500)`) | same |
| D2-6 | keys break at word boundaries (`<wbr>` after `_ - .` and before a camelCase capital; `lib/keyBreaks.tsx` in the tree key, the sections key, the fact `dt` and the Tag key; `anywhere` stays the fallback): **tree 80-character keys at 390 take 4 lines (was 3), and the depth-3 45 / 57 / 60-character keys 4 (were 3, 3, 4)**; every other D2-6 line count is unchanged (201 rows, 0 violations of D2-1 to D2-13, 0 mismatches of D2-15) | a key that has to wrap breaks at its words (`self_consistency_` / `check_result`), not mid-word; an Arabic key keeps `text-align: left` so its lines stay flush with the row's left edge |
