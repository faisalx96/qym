# Redesign brief 2: Run detail (surfaces, repeat analysis, steps, deep analysis, categories, item expansion, JSON output, metric view, traces)

Area: `run-detail`. Investigated 2026-10-14 against the legacy UI (worktree `qym-wt-legacy`, port 8873) and the React app (main
checkout `UI-redesign` tip, platform 8874, Vite 5874), Playwright at 1440 px (plus 1280 and 390 for the Arabic case). No product
code was changed. Screenshots: orchestrator scratchpad `rd2/` (`leg-*`, `rea-*`; named below). Seeds: the classic (240 items) and
repeat (60 items x 3 passes) runs of `frontend/e2e/run-detail/seed.ts`, plus two runs I added for this investigation
(`rd2/seed2.ts`: **Arabic multi-pass JSON run**, 12 items x 3 passes, Arabic prose and JSON inputs every third item, JSON outputs
with `answer / reasoning / citations / confidence / sql / followups`, a trace per pass; `rd2/seed3.ts`: **many categories**, 300
items, keys `topic` 24 values, `team` 14, `region` 9, `customer_tier` 6, `complexity` 4). Task T15 ports `seed2.ts` into
`e2e/run-detail/seed.ts` as `seedArabicRepeatRun`.

Paths: `L/` = `packages/platform/qym_platform/_static/dashboard/` (legacy worktree); `RD/` = `frontend/src/features/run-detail/`;
`UI/` = `frontend/src/ui/`.

## 1. Feedback points and reading

> run details: (1) enhance the UI for grey boxes, it doesn't feel user friendly. (2) repeat run analysis doesn't seem clear or
> organized. (3) trace steps should be hidden by default unless clicked. (4) for deep analysis don't combine two visuals in one
> row, each row should have only a single visual. (5) categories feels overwhelming and not clear. (6a) in items, when an item is
> clicked, if the input is Arabic and there were multiple passes the text ends up too far to the right, making it hard to find.
> (6b) when an item is clicked and the output is JSON, split each key into a separate section that can be easily viewed. (7) when
> an item is clicked and a metric is chosen, its UI is highly non user friendly; refer to the old design for the ideal user
> experience.
> traces: viewing traces for items is highly non user friendly; refer to the old design for the ideal user experience.

Reading, grounded in the two pages:

- The legacy item card is **one bordered container whose parts are separated by labelled blocks with a coloured label** (INPUT blue,
  EXPECTED green, OUTPUT green, metric chips, a full-width detail panel under the chip row that opens per metric and renders each
  meta key as its own labelled row). JSON input/output is never shown as a text blob: `formatObjectAsHtml` (`L/run.html:7427`) gives
  every key its own labelled row with a copy button, arrays as indexed rows, tables as tables. Pass outputs are colour-coded columns
  (green, blue, purple rails), each with its own Trace button. The legacy trace drawer is a wide (1320 px), resizable two-pane
  viewer with kind icons, a heavy scrim, a header carrying the trace statistics, and a detail pane whose Input and Output are boxed,
  copyable and expandable. "Intended UX" for 7 and traces means: **a wide, structured, labelled reading surface where an opened
  metric reads at the full card width and each part has an obvious name**, not the current stack of equal grey tiles.
- Points 1, 2, 5 and 6 are not legacy behaviours (legacy is also boxy and had the same two-up Deep row). They are new requirements
  that the legacy cannot answer, so they are specified from the current React defects measured below.
- Point 3 **is** legacy behaviour: the legacy Step timings table opens with every group collapsed (`L/latency_traces.js:97`
  `open: new Set()`); React opens both phases (`RD/components/panels/LatencyTab.tsx:242` `new Set(['p:task','p:eval'])`).

### What "grey boxes" refers to (conclusion)

The React run page is already flat at section level (Overview, Latency, Deep, Categories, Errors sections are borderless
`ReportSection` bodies; screenshots `rea-sec-*.png`). The grey boxes are **filled `--bg-elevated` / `--bg-surface` tiles stacked inside
other filled surfaces**, concentrated in four places. I measured fill/border nesting with a DOM script (`rd2/depth.mjs`: counts
elements >= 24x14 px that have a background or border and the number of such ancestors):

| Place | Evidence | Filled layers (counting the page card) |
|---|---|---|
| Expanded item, classic (`rea-item-classic2.png`) | table card > detail cell > `.block` (`--bg-elevated` + 3 px coloured rail) for Input, Expected, Output > tags/chips; metric chips are `--bg-elevated` tiles; each "Root cause - metric" card is another tile | **4** (15 filled elements inside the detail cell) |
| Expanded item, Arabic multi-pass (`rea-item-arabic1.png`, `-arabic3.png`) | table card > detail cell > pass column (`--bg-elevated` + 1 px border) > per-pass metric tile (`--bg-surface`) > tag; the same blocks above | **4-5** (31 filled elements, 12 at depth 3) |
| Hero (`rea-classic-top.png`) | page > hero card > Execution context grid > one tile per key; Versioning details is a second card | **4** (233 filled/bordered elements on the first render of the whole page, 29 at depth 4) |
| Repeat analysis (`rea-repeat-repeat.png`) | seven `--bg-elevated` stat tiles, then a `--bg-elevated` table header strip | 2, but visually heavy: tiles do not group |

The same grey is used for unlike things (input text, a score chip, a stat, a pass column), so the eye cannot rank them. The spec
(section 5.1) caps filled layers at 2 inside any container and replaces inner tiles with hairlines, whitespace and typography.

## 2. Legacy page anatomy (only what these points touch)

### 2.1 Item card (`L/run.html`, CSS 2579-2625, 2710-2840, 2887-2950; JS 14440-14510)

- Page: one column, `.run-container` padding `--space-lg`; Items is the last section, 20 cards per page. Collapsed card ~62 px: chevron,
  `#n`, status tag, input title, reason, metric pills, "+N more".
- Expanded (`leg-item-classic-1.png`, `leg-card-json.png`, `leg-card-ar3.png`): header row (chevron `#n`, `3 passes` note on the right)
  then, in order: **INPUT** block (3 px blue left rule, label in `--font-xs` blue, "Copy link" and copy icons right), **EXPECTED
  OUTPUT** (green tinted panel), metadata badges (complexity and domain as coloured badges + `source: synthetic` tags), **OUTPUT**
  block (green rule; `Pass` tag, latency, timestamp; `Trace` text button and copy right), the metric chip row, optional analysis
  warning, then "Per-metric root cause analysis" as one bordered panel with one row per metric (name, `0 issues` tag, "+ Add issue").
- Metric chips (`.metric-det-chips`, 2720; `leg-metric-open2.png`): a wrapping flex row of bordered chips (`.det-toggle`: caret, name,
  value coloured by score, edit pencil; 1 px `--border-subtle`, `--bg-surface`, radius 5 px, padding 4x10). A chip with metadata opens
  a **detail panel that takes the full width below the chip row** (`.det-body`, 2828: 1 px `--border-default`, `--bg-surface`, padding
  `--space-sm --space-md`) holding the meta through `formatObjectAsHtml`: `REASON` first on a highlighted row, then a separate block
  with `JUDGE_MODEL`, `CONFIDENCE` (amber number), `LABEL`, `EXPLANATION`. Several metrics can be open at once; the open chip gets the
  `--bg-elevated` fill and a stronger border. A chip without metadata has no caret (`det-caret-none`). The edit pencil swaps the chip
  value for an inline editor.
- JSON values (`formatObjectAsHtml`, 7427; CSS 4390-4445; `leg-card-json.png`): object -> a `.formatted-object` of `.formatted-row`s, each
  row = blue uppercase key (`--font-xs`, 0.5 px tracking), the value below it (`white-space: pre-wrap`, strings in the text ramp,
  numbers amber, booleans purple), a 2 px left hairline that turns accent on hover, and a copy button that appears on hover. Arrays of
  scalars render inline, arrays of objects as `[0] [1]` indexed rows, array-of-arrays or `{columns, rows}` as a table
  (`normalizeMetaTableValue`). Arabic strings are `dir=rtl` per value (`textDirAttrs`), keys stay LTR.
- Repeat items (`leg-card-ar3.png`): "OUTPUT [Pass 1][Pass 2][Pass 3] 3 unique" toggles, then **one column per pass** in a 3-up flex
  row, each with a coloured left rail (green, blue, purple), header (`Pass n`, `Pass/Fail`, latency, **Trace** button, copy),
  the output as per-key rows, then its own metric chips. Each column's Arabic text is right aligned inside its own ~370 px column, so
  the text is always next to the label and the pass header.
- Width: the card is the container width (no horizontal scroller around it), so nothing is wider than the viewport.

### 2.2 Trace viewer (`L/trace_viewer.js` 2270-2330, `L/dashboard.css` 9531-9720, 10139-10150; `leg-trace-1.png`, `leg-trace-llm-msg.png`)

- Shell `position: fixed; inset: 0; z-index: 50000`; scrim `rgba(4,8,18,.65)`; drawer `width: min(1320px, 97vw)`, slides in 220 ms
  (`transform`), `--bg-base`, 1 px left border, large shadow; 100 vw under the mobile breakpoint (10688).
- Header (`--bg-surface`): eyebrow `TRACE`, mono title `<run id> - <item id>`, a chip row **in the header**: `8 spans`, `1.6s`,
  `800 tokens` (blue tinted), `$0.0012`, an `ID` chip (copies the trace id); close on the right.
- Body: **list pane | draggable divider | detail pane** (`.tv-divider`, `trace_viewer.js:2352`, pointer drag, min widths). Default about
  55 / 45 (725 px list, 590 px detail at 1440). The list toolbar is a search ("Filter spans...") and one icon button (expand / collapse
  all). Rows (`.tv-row`, ~33 px): kind **icon tile** (agent person, retriever database, LLM chat bubble, tool wrench, guardrail dot),
  name, model chip, token count with icon, a right-aligned duration and a 110 px waterfall bar coloured by kind, error badge. Tree
  guides are drawn with 1 px connector lines. Selected row `--bg-elevated`.
- Detail pane: header (kind icon, name, `model - 782ms - 300 tokens - $0.0012`, `OK` pill), tabs by kind (LLM: **Messages | Response |
  Raw**; agent/chain/tool: **Input / Output | Messages | Raw**), then content in labelled boxes: `INPUT` (blue label) and `OUTPUT` (green
  label), each a bordered box with copy and **expand-to-modal** icons in the label row. Messages are role cards (`SYSTEM` muted, `USER`
  blue, `ASSISTANT` green label on a tinted card, copy and expand per message) and a tool call card (`lookup` purple + `CALL` tag, JSON
  in a CodeMirror box with line numbers and fold carets). `tv-modal` shows any block full screen.
- Keyboard: `j/k`, arrows, Enter, `/` (unchanged in React, QA row 40).

### 2.3 Repeat run analysis (`L/run.html` `#samples-analysis-section`, `leg-repeat-repeat.png`)

Head ("Repeat run analysis", "Every item was evaluated 3x ..."), a **metric toggle** (`correct | quality`), **one connected 7-cell stat
strip** (Pass@3, Pass^3, Consistency, Reliability, Avg Score, Avg Latency, Errors, each with an info marker), a **per-pass table**
(Pass, one column per metric, avg and median latency, errors, items; best pass of each column tinted), a hairline, then a sub-head
**"Repeat Performance"** (green bar + one line) with two bordered panels: "Performance Across Attempts" (Compare | Pass@k | Pass^k |
Average, Chart | Table, 95 % CI band) and "Correct Distribution" (items by number of passes that passed, bars labelled 0/3 .. 3/3).

### 2.4 Steps and categories and deep analysis

- Step timings (`L/latency_traces.js`, `leg-sec-overview-deep-section.png`): rows are only the two phases (Agent 5, Eval 1) with a
  chevron; a step opens when its row is clicked (`ui.open` starts empty, line 97; search opens matching groups, 927; the toolbar has
  By step / By kind, Linear / Log, search, Export).
- Categories (`L/run.html` `#metadata-breakdown`, `leg-sec-metadata-breakdown.png`): chip bar "CATEGORIES" (keys with value counts),
  **Cards | Compare** toggle, one bordered panel with an "Overall metric average score 49 %" badge, per key a coloured header (icon +
  key + metric tag) and cards with a **coloured left rail per value**, `AVERAGE / ITEMS / LATENCY` as a labelled triple (value in score
  colour) and a bar **with a baseline tick** at the overall average. Cards are 5 per row at 1440.
- Deep analysis (`leg-sec-overview-deep-section.png` lower half): correlation matrix and relationship scatter are **side by side in two
  bordered panels** in legacy too. One visual per row is therefore a new requirement.

## 3. React page anatomy (only what these points touch)

Tree: `RunDetailPage > RunBody` (`RD/RunBody.tsx`) > `RunHero` > `SectionNav` > `ReportLayout` (scope sidebar) > `ReportSections`
(`RD/components/ReportSections.tsx`: `ReportSection`s for Overview, Repeat, Latency, Deep, Categories, Errors, Root cause; Items is
`ItemsSection`).

- **Hero** `RD/components/RunHero.tsx`: one card; `Execution context` is a grid of tiles (one `--bg-elevated` tile per key, `rea-classic-top.png`);
  `Versioning details` is a separate bordered card under the hero.
- **Items**: `components/items/ItemsTable.tsx` on `DataTable` (`expandOnRowClick`, virtualized); expansion renders `ItemCard.tsx`
  into the table's detail row (`UI/DataTable` `.detailRow > .detailCell`, `position: relative` with a 2 px accent rail via `::before`,
  padding 0, `overflow: hidden`). `ItemCard` = `.block` per Input / Expected / Output (`ItemCard.module.css`: `--bg-elevated`, 3 px
  coloured `border-inline-start`, padding `--space-sm --space-md`), a `Tag` row, `TraceChips`, `MetricStrip`, `MetricAnalysisCards`.
  Text goes through `TextBlock` (`UI/TextBlock`: `unicode-bidi: plaintext`, `text-align: start`, `dir` from the first strong character);
  objects are stringified by `bodyText` (`lib/itemText.ts`) and shown as **one pretty-printed monospace block** (`looksLikeCode`), so a
  JSON output is a text blob (`rea-item-arabic1.png`: Arabic string values and punctuation reorder, `"answer": "..."` lines wrap
  mid-key).
- **Metric strip** `items/MetricStrip.tsx`: `grid repeat(auto-fill, minmax(260px,1fr))` of `--bg-elevated` chips; the caret opens
  `MetaList` (a `dl`, `minmax(80px,120px) 1fr`) **inside the same 260 px chip**, so a long reason or JSON wraps in a narrow tile
  (`rea-item-classic2.png`); the editor opens inside the chip too. Selected analysis metric: inset 1 px strong border.
- **Pass columns** `items/PassColumns.tsx` (repeat aggregate view): header chips per pass, `PassMetricCompare` (select + inline values),
  `grid repeat(auto-fit, minmax(240px,1fr))` of `.col` (`--bg-elevated`, 1 px border), each with an output `TextBlock` clamped to 14 em
  with an inner scroller, then `PassMetrics` (`--bg-surface` tile per metric, caret opens `MetaList` inside the tile). All columns share
  one grey; the pass number is the only differentiator; a pass has an icon-only trace button.
- **Repeat** `panels/RepeatTab.tsx`: metric `SegmentedControl`, 7 `stat2` tiles (`dl`), pass table, then `div.twoUp` (curve | pass-count
  bars) at >= 760 px container width (`Panels.module.css:279`). No sub-headings; the strip is for the selected metric while the table
  below lists every metric.
- **Latency** `panels/LatencyTab.tsx`: Response time `twoUp` pair, trace budget, `Steps` (`useState(new Set(['p:task','p:eval']))`, line 242).
- **Deep** `panels/DeepTab.tsx:36` `div.twoUp`: matrix | relationship scatter.
- **Categories** `panels/CategoriesTab.tsx`: chip per key (multi-toggle, `autoCategories` = first 3 keys alphabetically,
  `lib/runModel.ts:101`), then for every selected key a `cardsDense` grid (4 per row >= 1100 px) of card buttons: value, average, bar,
  `n items - latency - pass %`. Values are in alphabetical order, the bar is always the same green, there is no baseline tick.
- **Trace** `components/traces/TraceDrawer.tsx` in the shared `Drawer` (`width: min(1040, innerWidth)`, line 345; scrim `rgba(10,10,16,.5)`):
  title "Trace", chips row in the body, `.split` = `grid minmax(280px,1fr) minmax(280px,1fr)` (fixed 50/50), tree with letter badges
  (A, R, L, T, G), `SpanDetail.tsx` tabs `Input / Output | Metrics | Raw` or `Messages | Metrics | Raw`, content as unboxed text with the
  copy button on its own line under the label (`rea-trace-1.png`, `rea-trace-llm-msg.png`). No divider drag, no expand-to-modal, no kind
  icons, no copy of the trace id. Keyboard model and `?trace=` / `trace_pass` are fine.

## 4. Gap analysis

| # | legacy | react | why it matters | proposed change |
|---|---|---|---|---|
| G1 | Boxed but ranked: coloured label rules, tinted OUTPUT, per-pass coloured rails | Same grey tile for input, expected, output, chip, stat, pass column; 4-5 nested filled layers (section 1) | Nothing reads as primary; heavy | 5.1: <= 2 filled layers, hairline separated labelled rows, colour only for status and pass identity |
| G2 | Hero context is one band with divided cells | Tile per key + a second card for Versioning | Same grey tiles in the hero | `KeyValueGrid` rows inside one hero card (6.4) |
| G3 | Repeat: stat strip, per-pass table, "Repeat Performance" sub-head, two panels | Same pieces, no sub-heads, tiles instead of strip, table lists all metrics under a one-metric strip, curve and distribution squeezed in `twoUp` | Reader cannot tell what the selected metric governs or what order to read | 5.2: verdict line, grouped StatStrip, three titled sub-sections, full-width visuals, table last with best/worst marks |
| G4 | Step timings open with phases collapsed | Phases open: every step row visible | Feedback 3; 7+ rows before the reader chose anything | `new Set()` default, expand-all / collapse-all buttons, search still opens matches |
| G5 | Deep: two panels side by side | `twoUp` | Feedback 4 (new) | Single column: matrix, then scatter |
| G6 | Categories: Cards with per-value colour, baseline tick, Cards/Compare | All keys x all values as equal green-bar cards, A-Z order, up to 3 keys open, no baseline, no ranking | 19 equal cards for 3 small keys (`rea-many-cat.png`); a 24-value key is 6 rows of cards | 5.4: one key at a time, ranked rows with tone and baseline, top 8 then Show all, insight line |
| G7 | Input and output are `dir=rtl` per value, each pass column is ~370 px so text sits by its label | Detail cell is as wide as the whole scrolling table (1144 px in a 1031 px scroller at 1280), so right aligned Arabic text and the third pass column fall **113 px outside the visible area** (`rea-ar-w1280-3.png`); at 1440 the text sits 1,000 px from its label (`rea-item-arabic3.png`) | Feedback 6a | 5.3: `detailFit` (sticky, visible width), label and text adjacent via `FieldRow`, 76ch measure, RTL-aware blocks |
| G8 | JSON -> labelled rows, copy per key | JSON -> one monospace blob, bidi scrambled | Feedback 6b | `StructuredValue` (5.5): per-key sections, collapsible, copyable, tables, key index |
| G9 | Metric detail opens full width under the chip row, key rows, several open at once | Opens inside a 260 px chip; `MetaList` in a tile; editor in the chip | Feedback 7 | 5.6: chip row + full-width detail panel(s) |
| G10 | Pass columns coloured per pass, text Trace button, per-key output | One grey, icon trace button, 14 em clamp + inner scroller | Feedback 6, 7 | 5.3: pass accent (`--chart-1..3`), labelled Trace button, no inner scroller, key-aligned compare |
| G11 | Trace drawer 1320 px, resizable divider, header chips and ID chip, kind icons, boxed copyable/expandable Input and Output, role cards, folding code | 1040 px fixed 50/50, letter badges, unboxed text with the copy icon one row below its label, no expand, no resize | Traces feedback | 5.7 |
| G12 | Item expansion width is the container width | Same as G7 for compare (already fixed locally in `ItemList.module.css` `.detailHold`) | One fix, two pages | Move the fix into `DataTable` (T2) |
| G13 | Root cause panel per item: one bordered list | One tile per metric, even when empty ("No issues recorded for this metric", `rea-item-classic2.png`) | 2-4 empty tiles per expansion | One closed `Disclosure` "Root cause" with a count tag; empty -> one line |

## 5. Redesign spec

### 5.1 Calm surfaces (point 1; applies to everything below)

Rules (new "Calm surface" paragraph in `docs/DESIGN_LANGUAGE.md` section 3, enforced by one new design test):
1. A container (card, drawer, detail cell) is the only filled layer. **Inside a container at most one more fill level**, reserved for
   code and JSON viewers, inputs and the selected/open state. No tile inside a tile; no tile for plain text.
2. Parts of a container are separated by a `--border-subtle` hairline and `--space-md` rhythm, never by fills. Labels use the existing
   label recipe (`--font-sm`, 650, `--text-muted`, uppercase, 0.05em).
3. Colour carries meaning only: status (success/danger/warning), pass identity (`--chart-1..3`), a selected/open state
   (`--bg-selected` or `--bg-hover`). Section identity (Input/Expected/Output) is a label, plus **one** 2 px `border-inline-start` on the
   Output of a verdict (success / danger), not on every block.
4. Stats in a group are a `StatStrip`, not tiles; key/value groups are `KeyValueGrid` rows (label above value, hairline between
   rows), not tiles.

Concrete changes: Input / Expected / Output lose `.block` fill and the three rails (5.3); metric chips become outlined (1 px
`--border-subtle`, transparent) with `--bg-hover` while open (5.6); pass columns lose the fill and nested metric tiles (5.3); hero
context becomes `KeyValueGrid columns={3}` inside the hero card and Versioning joins it under a hairline (6.4); repeat stat tiles
become `StatStrip` (5.2); root cause becomes a `Disclosure` (5.3). Target: filled layers inside the item detail <= 2 (table card +
detail cell, plus JSON/code boxes), hero <= 2, whole page first render well under 100 filled/bordered elements (today 233).

### 5.2 Repeat run analysis (point 2)

Structure (all inside the existing `ReportSection id=run-section-repeat`, full width, one visual per row):

```
Repeat run analysis                                   Every item was evaluated 3x. Higher is better.
------------------------------------------------------------------------------------------------
Metric  [ correct | quality ]      One metric drives the summary, the curve and the distribution below.
 "Pass@3 78.3%, Pass^3 55.0%: 23 pts of items pass at least once but not every time."   <- verdict, one line
+--------------------+---------------------------+-------------------------------+--------------+
| CAPABILITY         | CONSISTENCY               | SPEED AND ERRORS              |              |
| Pass@3 78.3%  (i)  | Pass^3 55.0% Consistency  | Avg latency 2.0s   Errors 4   |              |
| Avg score 66.7% (i)|        84.4% Reliab. 85.1%|                               |              |
+--------------------+---------------------------+-------------------------------+--------------+
Across attempts                                  [Compare|Pass@k|Pass^k|Average] [Chart|Table]
  curve, full width, 280 px high, CI band, end labels
------------------------------------------------------------------------------------------------
Passes passed                         Items by number of passes that passed. Click a bar to filter.
  bars full width: "0 of 3 (13 items) always fail" ... "3 of 3 (33 items) always pass"
------------------------------------------------------------------------------------------------
By pass                                                     metric columns, selected one emphasised
 Pass  | correct  quality | Avg latency | Median | Errors | Items     best/worst tagged on the selected column
```

- Order = the reading order: which metric, how good, how consistent, how it changes with attempts, how many items flip, per pass detail.
- The metric control becomes a labelled `SegmentedControl` ("Metric") with the one-line scope explanation; `?metric=` is unchanged.
- Stats use `StatStrip` (`variant: band`) with **three labelled groups** (new prop `StatStripItem.group?: string`; the primitive draws a
  hairline between groups and a `--font-xs` group label above the cells). Help markers stay (`copy.*` from `lib/repeatCopy.ts`).
- Verdict sentence is computed in `lib/repeatCopy.ts` (`verdictLine(stats, metricDirection, k)`), no new data.
- The per-pass table moves last, uses the compact `DataTable` (sortable off), the selected metric column in `--text-primary` and a
  `Tag tone` "best" / "worst" on that column; error counts > 0 get the danger text tone; the pass link (`?pass=n`) stays. Queued
  passes row stays.
- Curve and distribution each get their own `h3` (xl is for sections; these use `Text variant="lg"`), `.twoUp` removed in RepeatTab.
  Distribution bars get plain-language labels ("always fail", "always pass") instead of only `0/3`.
- Wide screens: the visuals cap at `max-inline-size: 1100px` and are left aligned, so a 1920 px screen does not stretch a 4-point curve.

### 5.3 Item expansion layout, RTL and multi-pass (6a), JSON (6b), per-pass columns

**Container.** `DataTable` gets `detailFit?: 'viewport' | 'table'` (default `'viewport'`). It wraps `renderExpanded` output in the
sticky container the compare matrix already uses (`ItemList.module.css .detailHold`: `position: sticky; inset-inline-start: 0;
inline-size: var(--scroller-w); max-inline-size: 100%`), with the width measured by a `ResizeObserver` on the table scroller inside the
primitive. Compare drops its local copy. Result: an expanded item is never wider than what the reader can see, in LTR and RTL, at any
metric-column count. (Measured cause: detail cell 1144 px in a 1031 px scroller at 1280.)

**Field rows (new `FieldRow`).** Input and Expected render as definition rows: label cell + body cell adjacent, **at the inline start**:

```
LTR (English input)
| INPUT         Question 2: what does clause 1 of the finance policy require?            [link][copy] |
| EXPECTED      Clause 1 requires written approval.                                        [copy]    |

RTL (Arabic input; the row mirrors: the label sits at the right, the body next to it)
| [copy][link]      ما هي شروط الحصول على تمويل عقاري وفق الضوابط الحالية؟ اذكر ...          INPUT |
```

- `grid-template-columns: [label] 7.5rem [body] minmax(0, 76ch) [actions] 1fr`; `dir` is set on the **row** from the content
  (`useTextDirection`) so label, body and action cluster all mirror; actions are `margin-inline-start: auto` at the row's end. The
  body's measure is capped at 76ch (about 700 px) so the eye never travels across a 1,100 px block, whatever the direction.
- Under 640 px container width the label sits above the body (one column).
- Output: header row (`Output` label, verdict `Tag`, latency, timestamp, then actions: `Trace` button with label, `Open in Langfuse`,
  copy) and the body under it. A verdict rail (2 px, success or danger) on the Output row only.
- Metadata tags row keeps (`Tag kind=data`), but the complexity/domain badges get a leading dot in a fixed hue per key
  (`--chart-1..5` by hash) so they scan like legacy's coloured badges without filled tiles. Analysis warning stays a single line.
- Root cause: `MetricAnalysisCards` is wrapped in a closed `Disclosure` titled "Root cause" with summary "2 issues across 4 metrics"
  (or the line "No root-cause issues assigned" without a trigger when empty). Metric rows inside are hairline rows, "+ Add issue" stays a
  small accent button.

**Pass columns (6a and 7).** `PassColumns` keeps all current capabilities (pass chips to hide a pass, `PassMetricCompare`, per-pass
trace and copy, per-pass edit) with these changes:

```
OUTPUT  (Pass 1) (Pass 2) (Pass 3)   3 unique        compare metric [correct v]  P1 False  P2 True  P3 True
+-- Pass 1 ----------------+ +-- Pass 2 ----------------+ +-- Pass 3 ----------------+
| * Pass 1  [Fail] 3.2s    | | * Pass 2  [Pass] 3.0s    | | * Pass 3  [Pass] 1.7s    |
|   [Trace] [copy]         | |   [Trace] [copy]         | |   [Trace] [copy]         |
| ANSWER                   | | ANSWER                   | | ANSWER                   |
|  ...                     | |  ...                     | |  ...                     |
| REASONING ...            | | ...                      | | ...                      |
| CITATIONS (2) v          | |                          | |                          |
| correct False   [edit]   | | correct True    [edit]   | | correct True    [edit]   |
| quality 41.0%   [edit]   | |                          | |                          |
+--------------------------+ +--------------------------+ +--------------------------+
```

- Columns: hairline `border-inline-start` of 2 px in the pass accent (`--chart-1`, `--chart-2`, `--chart-3`, cycling) like legacy's coloured
  rails; no fill, no border box; gap `--space-lg`. `grid-template-columns: repeat(auto-fit, minmax(min(22rem,100%),1fr))`, so 3 passes are
  side by side from about 1100 px and 2 or 1 per row below; more than 3 passes wrap (4 -> 2x2).
- No inner scroller and no 14 em clamp: output is `StructuredValue` (below) or `TextBlock` with the usual "Show more" clamp (12 lines).
- Metric rows inside a column are the compact outlined chips of 5.6 (name, value, pencil) with the detail opening under the row,
  full column width. Same component as the single-pass strip, parameterised by `passNumber`.
- `Trace` is a labelled `Button size=sm` (icon + "Trace") instead of an icon-only button, as in legacy.
- New (optional, T5b): a "differs from Pass 1" `Tag` on columns whose output text differs, and "same as Pass n" otherwise (cheap string
  compare already done for the `n unique` count).
- RTL columns mirror text alignment by content; the column header and actions stay in the page direction (they are chrome).

**JSON in Input, Expected and Output (6b): new `StructuredValue` primitive** (`UI/StructuredValue`, reused by compare `OutputCard`, trace
span I/O and hero context later):

```ts
interface StructuredValueProps {
  value: unknown;                 // object | array | JSON string | plain string
  label?: string;                 // names the region for assistive tech ("Output, pass 2")
  textMode?: 'raw' | 'rendered';  // for string leaves (markdown subset)
  defaultOpen?: 'auto' | 'all' | 'none';   // auto = first 6 keys and string leaves <= 600 chars open
  view?: 'sections' | 'raw';      // controlled; default from localStorage qym:json-view
  onViewChange?: (v: 'sections' | 'raw') => void;
}
```

```
OUTPUT   [Pass]  925ms  2026-10-01 15:00:01                  View [Sections|Raw]  [Expand all] [copy JSON]
 answer   ·  reasoning   ·  citations (2)   ·  confidence   ·  sql   ·  followups (2)      <- key index, anchors, only if > 4 keys
 -------------------------------------------------------------------------------------------------------
 v ANSWER                                                                                          [copy]
   عاصمة المملكة العربية السعودية هي الرياض.                          (string: TextBlock, dir auto, markdown mode)
 -------------------------------------------------------------------------------------------------------
 v REASONING                                                                                       [copy]
 -------------------------------------------------------------------------------------------------------
 v CITATIONS  array of 2 objects                                                                   [copy]
   doc            page   score                                               (uniform objects: compact table)
   policy-2026       3    0.91
   products-guide    4    0.62
 -------------------------------------------------------------------------------------------------------
 > META  object, 3 keys                                                                            [copy]   (collapsed)
```

- A value is "structured" when it is an object or array, or a string that `parseJson` (already in `UI/JsonViewer`) turns into one. A
  top-level array is shown as indexed sections `[0] [1]`. Scalars and plain strings keep today's `TextBlock`.
- Each **top-level key = one section**: a `Disclosure`-style row (chevron, key in `--font-sm` 650, a muted summary: type and size), a
  per-section `CopyButton` (copies the value, JSON for objects), body by type: string -> `TextBlock` (long ones clamp at 12 lines with
  Show more); number / boolean / null -> inline mono value with the legacy colouring (number `--warning`, boolean `--chart-3`, null
  `--text-muted`); array of scalars -> inline chips; array of uniform objects -> compact `DataTable` (<= 50 rows, rest behind "Show all
  N"); nested object -> `JsonViewer` collapsed to depth 1 (existing primitive, `expandDepth`).
- Sections are separated by hairlines, no boxes. Keys render `dir="ltr"` and string values `dir="auto"` so Arabic values and Latin keys no
  longer scramble.
- Header controls: `SegmentedControl` Sections | Raw (Raw = today's pretty-printed block, so nothing is lost), Expand all / Collapse all
  buttons, `CopyButton` for the whole JSON. The key index (anchor chips that scroll the section into view and open it) shows when there
  are more than 4 keys.
- State is local per expanded item (open keys), view preference in `localStorage qym:json-view` (convenience only). No URL.
- Large payloads: sections render lazily when opened (Collapse `keepMounted=false`); the text clamp avoids layout cost of 3,000-line
  strings (the seed's item 4).
- CSV and `?item=` deep link are unchanged (they read the row data, not the DOM).
- Optional phase 2 (T5c): in pass columns whose passes share top-level keys, "Compare by key" lines the same key up across passes.

### 5.4 Categories (point 5)

Goal: answer "where is the model weak?" in one glance, then let the reader drill; no wall of equal cards.

```
Categories                                  Performance by item metadata. Click a value to filter the items.
------------------------------------------------------------------------------------------------
Key  [complexity 4] [domain 5] [source 2]  [+ topic 24] [+ team 14]       Metric: quality  overall 49%
Weakest: expert 25% (66 items, 24 pts below overall).  Strongest: easy 80%.
 VALUE        AVERAGE                       ITEMS   PASS   LATENCY                  Sort [Worst first v]
 expert       [#####-------|----------]  25%   66     0%    3.1s
 hard         [##########--|----------]  48%   69    19%    1.4s      | = overall average tick
 medium       [##########--|----------]  49%   51    10%    1.4s
 easy         [################|------]  80%   54    77%    1.5s
 (8 rows, then "Show all 24 values")
```

- One **key at a time** by default: the key chip row becomes single-select-first (`Chip` group, the first chip preselected = the key with the
  largest best-to-worst spread, computed once from `categoryBreakdown`; falls back to the first key). Other keys sit behind the same
  chips; **Shift/Cmd-click or the "+" chips add a key** (so the multi-key capability of today's multi-toggle chips stays), each added
  key gets its own table below, collapsed to 8 rows.
- Rows are a compact `DataTable` (existing primitive, `density compact`, sortable): columns Value, Average (`ScoreBar`), Items, Pass,
  Latency. New `ScoreBar` prop `marker?: number | null` draws the baseline tick (overall average, like legacy). Bar tone follows the
  score (`ScoreBar color` exists: danger below the pass threshold or 50 %, warning, success), fixing "all green".
- Default sort: worst first (ascending average); other sorts: best first, items, name. Row click toggles the same filters as today
  (`complexity`, `domain`, `categories[key]`), `aria-pressed` kept as `aria-selected` on rows; selected rows use `--bg-selected`.
- Insight line is computed from the breakdown (no new data); hidden when a key has one value.
- Progressive disclosure: > 8 values shows "Show all N values" (a `Button variant=neutral` in the table footer, local state), keys beyond
  the first three stay behind "+ more keys" (Disclosure) so a 40-key dataset does not paint 40 chips.
- Legacy "Cards | Compare" toggle: React has no Compare view; not restored (open question Q7).
- Responsive: the table is 5 columns at >= 760 px; below that Items and Latency fold into the value cell (`DataTable` card mode).

### 5.5 Errors (supporting calm surfaces)

Errors cards (`panels/ErrorsTab.tsx`) become rows in the same compact table pattern: severity dot (task = danger, metric = warning), message
(first line, rest in a `Tooltip`), error type, items, count; group headings keep (Task / Metric / Trace / Analysis) with the existing count tag.
Click filters as today. This removes 3-6 more tiles; if the owner prefers cards they stay valid under 5.1 as one fill level.

### 5.6 Item metric detail (point 7), modelled on legacy `.metric-det-*`

```
OUTPUT block ...
METRICS
 [> exact_match False  (edit)] [v quality 74.1%  (edit)] [> hallucination 33.3% (edit)] [  tokens_used 356 (edit)]
 ------------------------------------------------------------------------------------------------------
 QUALITY  judge_model gpt-5 - confidence 0.68 - label pass                        (scalars: one KeyValueGrid line)
 REASON       Expected answer not found verbatim                                         (long text, full width)
 EXPLANATION  The answer cites the right clause and is concise.
 ------------------------------------------------------------------------------------------------------
```

- Chips are a wrapping row (`display: flex; flex-wrap: wrap; gap: --space-sm`), **not** an auto-fill grid; each is outlined, caret + name + `ScoreValue` + pencil, `--bg-hover` while open, `aria-expanded`, the
  whole chip toggles (not only the caret). Metrics without metadata render no caret (legacy `det-caret-none`). The analysis metric keeps its
  inset border (`data-selected`).
- The detail **spans the full row under the chip row** (one `Collapse` panel per open metric, several can be open, in chip order). Content
  order: `reason`, `explanation`, `label` first as full-width rows, then the remaining scalars as a 3-column `KeyValueGrid`, then object
  values through `StructuredValue` (collapsed). Internal keys hidden as today (`isInternalMetaKey`, `hiddenMetricFields`).
- The editor (`ScoreEditor`) opens in the same panel slot (title "Edit quality"), Save / Cancel there; edited badge and Reset stay on the chip.
- Pass columns reuse it per pass (5.3). Keyboard: Enter/Space toggles, Tab moves chip to chip; focus does not jump into the panel.
- Motion: `Collapse` (180 ms, none under `prefers-reduced-motion`).

### 5.7 Trace viewer (traces feedback), modelled on the legacy drawer

```
+--------------------------------------------------------------------------------------------------------+
| TRACE                                                                                       [Langfuse][x]|
| <run id> . item-0001                                                                                    |
| [8 spans] [1.6s] [800 tokens] [$0.0012] [ID copy]       Attempt/Pass chips (repeat items)               |
+---------------------------------------------------------+-----+----------------------------------------+
| [ Filter spans... (/) ]            [expand/collapse all] | ||  | (icon) ChatOpenAI            [OK]      |
| (A) answer_question        1.4s ==========               | ||  | gpt-5 . 782ms . 300 tokens . $0.0012   |
|   (R) retrieve_docs        284ms ==                      | ||  | Messages | Response | Metrics | Raw     |
|   (L) ChatOpenAI gpt-5 300 782ms ======                  | ||  | SYSTEM  [copy][expand]                 |
|   (T) lookup               142ms =                       | ||  |  You are a careful assistant ...       |
| (L) judge_quality gpt-5 500 160ms =                      | ||  | USER ... ASSISTANT ... CALL lookup {} |
+---------------------------------------------------------+-----+----------------------------------------+
```

- Drawer: `width: min(1320px, 97vw)` (the primitive keeps `width` as a px number; the trace passes `Math.min(1320, innerWidth * 0.97)`), scrim
  `rgba(4,8,18,.65)` via a new `Drawer` prop `scrim?: 'default' | 'heavy'`. Under 900 px: 100 vw, the split becomes `SegmentedControl
  Tree | Detail` (detail opens on row select, back returns to the tree).
- Header: new `Drawer` slots `eyebrow` ("TRACE") and `meta` (chips row: spans, duration, tokens in `kind=data tone=info`, cost, `ID`
  chip with `CopyButton` of the trace id) so the stats are in the header like legacy; the body starts with the toolbar.
- **`SplitPane`** (new primitive): `{ start, end, defaultPct = 55, minPx = 280, storageKey?: string, label }`, a `role="separator"
  aria-orientation="vertical" tabindex=0` handle, pointer drag, Left/Right adjust by 2 %, Home/End to min/max, double click resets, persisted in
  `localStorage qym:trace-split` (per-viewer convenience), logical in RTL.
- Tree rows: kind **icons** instead of letters (`Icon` gains `agent`, `retriever`, `llm`, `tool`, `chain`, `guardrail`, `embedding`; colour by kind as
  today via `spanKinds.ts`), model and token count inline, duration right aligned in mono, waterfall 110 px, error badge. Row height 32 px (`--row-compact`). Tree
  guides stay.
- Detail pane: header (icon, name, meta line, status `Badge`), tabs by kind as legacy (LLM: `Messages | Response | Metrics | Raw`; others `Input / Output |
  Messages | Metrics | Raw`, Metrics is kept because React has it), content as **labelled sections with the label row carrying its actions**
  (`INPUT` info tone, `OUTPUT` success tone, `CopyButton`, new `Expand` icon button that opens the block in a `Dialog` at full size, like
  `tv-modal`). I/O bodies go through `StructuredValue` (JSON gets per-key sections, text keeps `TextBlock`), code (tool call arguments) in
  the existing `JsonViewer`. Role cards: `SYSTEM` muted, `USER` info, `ASSISTANT` success label, tool call as `lookup` + `CALL` tag + code.
  Sections are hairline separated; only code boxes are filled (rule 5.1).
- Unchanged: `?trace=`, `trace_pass`, `j/k`, `/`, Enter, Esc and focus return, attempts chips, Langfuse link, Raw tab cleaned of internal fields, expand/collapse all.
- Multi-pass: the row's `Trace` button in the pass column opens that pass (`ui.openTrace(item, pass)`), the header shows "Pass 2 . attempt 1" chips as today.

### 5.8 Steps (point 3)

`Steps` in `LatencyTab.tsx`: initial `open` = empty set, so only the phase rows ("Agent 61 calls", "Eval") show. Add `Expand all` / `Collapse all` text buttons
beside the search (legacy has search auto-open only; the explicit buttons are cheap and expected). Search keeps opening matching groups (already
`forcedOpen`). Row toggle remains the chevron button with `aria-expanded`. The trace-tree inside the drawer is **not** changed by this point (legacy also shows
it expanded); see Q3.

### 5.9 Deep analysis (point 4)

`DeepTab`: remove `twoUp`; stack `Metric correlation` then `Metric relationship`, each full width with its own `h3` and description. Matrix cells get
`max-inline-size: 9rem` and the grid `justify-content: start` for few metrics (4 metrics would otherwise stretch to 1190 px); with > 8 metrics the grid
uses the full width. The scatter gets `aspect-ratio: 3 / 1` (min 280, max 420 px). X / Y selects sit in the section header aside. Clicking a matrix cell scrolls the scatter
into view when it is below the fold (`scrollIntoView({block:'nearest'})`, instant under reduced motion). The same "one visual per row" applies to `RepeatTab` (5.2).
`LatencyTab`'s histogram + scatter pair stays two-up (Q4).

### 5.10 Responsive and motion summary

| Width | Item detail | Pass columns | Categories | Repeat | Trace drawer |
|---|---|---|---|---|---|
| 390 | `FieldRow` stacked, JSON sections full width, metric chips wrap, detail panel full width | 1 per row | table in card mode | strip wraps to 2 cells per row, visuals full width | 100 vw, Tree / Detail switch |
| 768 | as 390 but `FieldRow` inline from 640 | 1-2 per row | table 5 columns | strip 3 per row | 100 vw, switch |
| 1280 | visible-width detail (`detailFit`), 76ch body | 3 per row (22rem min) | table | strip groups inline | 97 vw split 55/45, resizable |
| 1920 | same, body measure capped (no stretching) | 3 per row (4+ wrap 2x2) | table, `max 1100px` | visuals `max 1100px` left aligned | 1320 px |

All collapses use `Collapse` (180 ms, `--ease-standard`); `SplitPane` and drawer slide are off under `prefers-reduced-motion` (the `Drawer` already respects it). No new
colours: only `--chart-1..5`, `--info`, `--success`, `--warning`, `--error`, `--bg-hover`, `--bg-selected`, `--border-subtle`.

### 5.11 Primitives: reuse, extend, create

| Primitive | Change | API |
|---|---|---|
| `DataTable` | extend | `detailFit?: 'viewport' \| 'table'` (default viewport), exposes `--scroller-w` |
| `StatStrip` | extend | `StatStripItem.group?: string` (group label + divider) |
| `ScoreBar` | extend | `marker?: number \| null` (baseline tick) |
| `Drawer` | extend | `eyebrow?: ReactNode`, `meta?: ReactNode`, `scrim?: 'default' \| 'heavy'` |
| `Icon` | extend | glyphs `agent retriever llm tool chain guardrail embedding expand` |
| `FieldRow` | new | `{ label: ReactNode; actions?: ReactNode; dir?: 'ltr' \| 'rtl' \| 'auto'; measure?: 'prose' \| 'full'; children }` |
| `StructuredValue` | new | see 5.3 |
| `SplitPane` | new | see 5.7 |
| `Disclosure`, `Collapse`, `KeyValueGrid`, `Tabs`, `SegmentedControl`, `Chip`, `CopyButton`, `JsonViewer`, `DataTable`, `Dialog` | reuse | |

Every new primitive gets a CSS Module whose first line names its recipe, gallery entries in `/__ui`, and an entry in `docs/DESIGN_LANGUAGE.md` section 3 and the design-language
test pins (heights, tokens only).

## 6. Work plan

Estimates are implementation hours including unit tests; tasks marked (I) are independent and can start at once.

| # | Task | Files | Tests | h |
|---|---|---|---|---|
| T1 (I) | Calm-surface recipe in the design language + design test (max nesting rule is documented, lint on `.block`-like fills left to review) | `docs/DESIGN_LANGUAGE.md`, `src/__tests__/design-language.test.ts` | design test | 2 |
| T2 (I) | `DataTable detailFit`, remove compare's local `.detailHold`, set `--scroller-w` | `UI/DataTable/*`, `features/compare/components/items/ItemList.*` | Vitest (detail width <= scroller width), e2e `compare/matrix.spec.ts` stays | 3 |
| T3 (I) | `FieldRow` primitive, gallery, RTL test | `UI/FieldRow/*`, `features/dev` gallery | Vitest (dir mirrors, label adjacent) | 3 |
| T4 (I) | `StructuredValue` primitive (sections, raw, index, tables, copy) + `lib/structured.ts` (classification) | `UI/StructuredValue/*`, `UI/JsonViewer` reuse | Vitest (object, array, JSON string, Arabic, large, uniform-array table), axe | 8 |
| T5 | Item detail rewrite: `FieldRow` rows, no blocks, root cause Disclosure, tag dots | `RD/components/items/ItemCard.*`, `analysis/MetricAnalysisCards.*` | update `MetricAnalysisCards.test.tsx`; e2e `items.spec.ts`, `a11y.spec.ts`, `qa-fixes.spec.ts` | 5 (needs T2, T3, T4) |
| T6 | Metric detail: chip row + full-width detail panel, editor in panel, `StructuredValue` for object meta | `items/MetricStrip.*`, `ScoreEditor.tsx` | e2e `ux-score-editor.spec.ts`, new `redesign2-metric-detail.spec.ts` | 5 (needs T4) |
| T7 | Pass columns: accent rail, no fills/nesting, labelled Trace, `StructuredValue`, differs/same tags (T7b), compare by key (T7c optional, +4) | `items/PassColumns.*` | e2e `repeat.spec.ts`, `ux-trace-passes.spec.ts`, `cutover-pass-revision.spec.ts`; new Arabic multi-pass spec at 1280 and 1440 (detail box inside scroller, text within 76ch of its label) | 5 (needs T2-T4, T6) |
| T8 (I) | Hero: `KeyValueGrid` context, Versioning merged | `RD/components/RunHero.*`, `heroModel.ts` | `cutover-metadata-json.test.tsx`, `cutover-run-page.spec.ts` | 2.5 |
| T9 (I) | Repeat reorganization + `StatStrip group` + verdict line | `panels/RepeatTab.tsx`, `lib/repeatCopy.ts`, `UI/StatStrip/*` | `repeat.spec.ts`, `cutover-repeat-metric.spec.ts`, Vitest `repeatCopy` verdict | 5 |
| T10 (I) | Deep single column | `panels/DeepTab.tsx`, `Panels.module.css` | `charts.spec.ts` (expect stacked), `overview.spec.ts` | 1.5 |
| T11 (I) | Categories ranked table, `ScoreBar marker`, spread-based default key | `panels/CategoriesTab.tsx`, `lib/overviewModel.ts` (`categorySpread`), `UI/ScoreBar` | Vitest `categorySpread`, e2e `panels.spec.ts`, `cutover-report-visibility.spec.ts` | 6 |
| T12 (I) | Errors as rows | `panels/ErrorsTab.tsx` | e2e `panels.spec.ts` error filter | 2 |
| T13 (I) | Steps collapsed default + expand/collapse all | `panels/LatencyTab.tsx` | `cutover-step-latency.spec.ts`, `traces.spec.ts` | 1 |
| T14 | Trace drawer: `SplitPane`, `Drawer` slots, icons, boxed I/O, expand dialog, header chips, `StructuredValue` I/O | `UI/SplitPane/*`, `UI/Drawer/*`, `UI/Icon`, `traces/TraceDrawer.*`, `SpanDetail.tsx`, `spanKinds.ts` | `traces.spec.ts`, `cutover-trace-drawer.spec.ts`, `ux-shortcuts.spec.ts`, a11y, new resize spec | 10 (SplitPane first, independent) |
| T15 | Seeds and QA: port `seedArabicRepeatRun`, `seedManyCategories`; screenshot pass 390/768/1280/1920 | `e2e/run-detail/seed.ts`, `scripts/seed-run-detail.ts` | all of the above | 3 |
| T16 | Docs: DESIGN_LANGUAGE primitives, `04-run-detail.md` pointer, QA notes | docs | design test | 1.5 |

Total about 63 h (T7c adds 4 optional). Critical path: T2 / T3 / T4 -> T5 / T6 -> T7 (about 18 h serial); T14, T9, T11, T8 run in parallel. Suggested split: agent A
T2 T3 T4 T5 T6 T7; agent B T14 (+ T4 reuse); agent C T9 T10 T11 T12 T13 T8; T1, T15, T16 last.

Risks: (1) `detailFit` sticky layout inside the virtualizer: expanded rows are measured items (tables pass 2), a width change must not trigger remeasure loops; guard with
`ResizeObserver` on the scroller only and `contain: layout` on the detail. (2) `StructuredValue` on 3,000-line strings and big JSON: lazy mount and clamp are mandatory. (3) Bidi:
setting `dir` on rows can reorder punctuation in mixed strings; keep `unicode-bidi: plaintext` on leaf values only. (4) Many existing specs query the old DOM (`pass-metric-compare`, `data-kind`, category rows):
keep `data-testid` and `data-kind` attributes on the new nodes to avoid churn. (5) `SplitPane` + the shared `Drawer` focus trap: the separator must be tabbable inside the dialog.

## 7. Open questions (recommended default is what implementation uses)

| # | Question | Default |
|---|---|---|
| Q1 | "Grey boxes" means the nested filled tiles (item detail, hero, repeat tiles, root cause) rather than, say, the table card itself. | Yes: spec 5.1 as written; the table card and section bodies stay. |
| Q2 | Is Input / Expected allowed to be capped at 76ch and left empty at the inline end (instead of full width)? | Yes (reading measure); `FieldRow measure="full"` exists for code. |
| Q3 | Point 3 "trace steps hidden by default": only the Steps table, or also the span tree in the trace drawer? | Steps table only; the drawer tree stays expanded (legacy parity), with Collapse all. |
| Q4 | Apply "one visual per row" to Latency (histogram + scatter) and the Repeat pair as well, or Deep only? | Deep and Repeat single; Latency keeps its pair (legacy layout, not named). |
| Q5 | Categories: one key open by default (the widest spread), others behind "+" chips? | Yes; multi-key remains through Shift/Cmd-click and "+" chips. |
| Q6 | Per-pass accent colours (`--chart-1..3`) on pass columns, as legacy. | Yes. |
| Q7 | Restore legacy Categories "Compare" view? | No, not restored (absent in React since the cutover; ranking + filters cover the need). |
| Q8 | Errors as rows instead of cards (5.5). | Rows; cards remain acceptable if flat. |
| Q9 | Should JSON key sections collapse beyond the first 6 keys or strings over 600 chars? | Yes (`defaultOpen='auto'`). |
| Q10 | Keep Metrics tab in the trace detail (legacy has none; React has it)? | Keep. |
| Q11 | "Compare by key" across passes and "differs from Pass 1" tags: ship now or later? | "Differs" tags now (T7b); compare-by-key later (T7c). |

## Summary for the orchestrator

1. Grey boxes = filled `--bg-elevated` tiles nested 4-5 layers deep in the expanded item (Input/Expected/Output blocks, metric chips, pass columns, root cause cards), the hero context tiles and the repeat stat tiles (233 filled elements on first render); spec caps fills at 2 per container with hairlines instead.
2. Biggest real defect (6a): the item detail is as wide as the whole scrolling table (1144 px in a 1031 px scroller at 1280), so right aligned Arabic text and the 3rd pass column sit outside the visible area; compare already has a local fix, move it into `DataTable detailFit`; plus label-adjacent `FieldRow` with a 76ch measure.
3. JSON output (6b) is one pretty-printed monospace blob with scrambled bidi; legacy gives each key a labelled, copyable row. New `StructuredValue` primitive: per-key collapsible, copyable sections, tables for uniform arrays, key index, Sections | Raw.
4. Metric detail (7): legacy opens a full-width detail panel under a wrapping chip row; React opens it inside a 260 px chip. Rebuild MetricStrip/PassColumns that way (several open at once, editor in the panel slot).
5. Traces: React drawer is 1040 px, fixed 50/50, letter badges, copy icon a row below its label, no expand and no resize; legacy is 1320 px, draggable divider, kind icons, header stat chips, boxed copyable and expandable I/O. New `SplitPane`, `Drawer` slots, icons, expand dialog.
6. Steps (3) is a one-line legacy regression (`new Set(['p:task','p:eval'])` vs legacy empty set); Deep (4) is `twoUp` in `DeepTab`; legacy had two-up too so this is a new requirement.
7. Repeat (2): reorder to metric, grouped StatStrip with a verdict line, curve, distribution, per-pass table last, each full width; Categories (5): ranked compact table, one key by default, baseline tick, worst first, Show all.
8. New primitives: `FieldRow`, `StructuredValue`, `SplitPane`; extended: `DataTable detailFit`, `StatStrip group`, `ScoreBar marker`, `Drawer eyebrow/meta/scrim`, `Icon` span glyphs.
9. Estimate about 63 h (4 h optional); 3 parallel tracks (items track about 29 h, trace drawer 10 h, sections 20 h); seeds for an Arabic multi-pass JSON run and a many-categories run are in the scratchpad (`rd2/seed2.ts`, `seed3.ts`) and must be ported.
10. Defaults for open questions: Q1 yes, Q2 yes 76ch, Q3 Steps table only, Q4 Deep and Repeat single (Latency keeps pair), Q5 one key by default with "+", Q6 yes pass accents, Q7 no Compare view, Q8 rows, Q9 yes auto-collapse, Q10 keep Metrics tab, Q11 differs tags now and compare-by-key later.
