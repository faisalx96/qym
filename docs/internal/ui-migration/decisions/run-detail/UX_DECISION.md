# Run detail - UX decision

Method: Playwright chromium, dark, 1400x900 and 1024x768, all three variants
(Classic and Repeat fixtures). Screenshots, scripts and raw results are in the
scratchpad `ux/rd/` (audit.mjs, results.json, `*-01-viewport|02-full|03-itemcard|
04-trace|05-*.png`). axe-core run on default view, trace drawer, and
the repeat fixture. Scores are 1 (poor) to 5 (best).

## Winner: C - items-first (with the fixes below)

## Measured facts

| Metric | A sections | B tabs | C items-first |
|---|---|---|---|
| Table first visible at 1400x900 (no scroll) | no (starts after Overview, ~Y 900+) | partly (hero is full height, 6 rows peek at the fold) | yes, ~12 rows and an open card |
| Tab presses from page top to first row | 61 (every histogram bar is a stop) | 29 | 27 |
| axe critical (default view, 1400) | 1 (`aria-sort` on `<button>`) | 2 (+ tab `aria-controls` points at unmounted panel) | 2 (same as B, panel tabs) |
| axe serious (1400 / 1024) | 1 / 0 | 3 / 0 | 4 / 0 |
| axe serious, repeat fixture | 41 (`aria-prohibited-attr` on pass dots, shared) | 43 | 52 |
| Trace drawer axe | 1 serious (danger tag contrast), 2 moderate, identical in all three (shared TraceDrawer) | same | same |
| Drawer: focus moves in / returns to trigger on Esc | yes / yes | yes / yes | yes / yes |
| Horizontal page scroll | none | none | none (table scrolls inside its box) |

## Steps to complete (clicks + scrolls, Classic fixture, from page load)

| Task | A | B | C |
|---|---|---|---|
| Find failing items for metric X | 2 (click Fail segment, then Items nav or scroll to read rows) | 2 (metric select + Fail in the bar; or 3 via Analysis chart + tab switch) | 1 (click Fail segment in the side panel, rows update beside it); +1 scroll in the panel for the 3rd+ metric |
| Open an item and its trace | 2 (Items nav, row trace icon) or 3 via card | 1 (row trace icon) or 2 via card | 1 (row trace icon) or 2 via card |
| Edit a score | 5 (Items nav, expand, pencil, type, Save) | 4 | 4 |
| Filter latency > 2 s and see the affected overview | 4-5 (Latency nav, click bin, shift-click, Overview nav / scroll back; overview and table never together) | 5 (Traces tab, bins, Analysis tab, then Items tab to read rows) | 4 (Latency tab, bin, shift-click, Overview tab), table and chart visible together |

## Scoring against J1-J9 and pain points

| Criterion | A | B | C |
|---|---|---|---|
| Task success (J3, J6, J7, J8 completable) | 4 | 4 | 5 |
| Steps-to-complete | 3 | 3 | 5 |
| Discoverability (J1 context, J4/J5, sections reachable) | 4 (everything on one page, nav with counts) | 3 (Overview and Latency hidden behind tabs; filter scope across tabs is implicit) | 3 (hero details behind a chevron; the panel tab strip clips "Latency" at 1400) |
| A11y | 3 (fewest axe errors; 26 histogram bars are tab stops) | 3 (tab aria-controls critical) | 3 (same as B; good keyboard order) |
| Density at 1400 | 3 (hero 360px, two sticky bars ~110px) | 3 (hero 360px pushes table down) | 4 (compact hero, table and charts together) |
| Density at 1024 | 3 (sticky stack eats ~190px of 768) | 4 | 2 (table loses metric columns, panel strip clips: "Mean 1.!", Reason/Input truncated to "Questi...") |
| Consistency with shell / DESIGN_LANGUAGE | 5 (SectionHeader xl, sticky nav recipe) | 4 | 4 (dense variants use smaller marks; same tokens) |
| Pain points (7.1 length, 7.3 four filter surfaces, 7.4 Display overload, 7.5 table) | 3 (7.1 only half solved) | 4 | 5 |
| Total / 40 | 28 | 28 | 31 |

## Why C wins (five lines)

1. The thing users come for (the item table plus an open card) is on screen at load; A needs a jump, B starts below a 360px hero.
2. J3 and J5 become one click with zero scroll and the chart and the rows it filters are visible together, which neither A nor B can offer.
3. It fixes pain points 7.1, 7.3, 7.4 and 7.5 at once; A leaves a long page, B hides the overview numbers from the rows they describe.
4. Fewest steps in three of four timed tasks, and ties the best in the fourth.
5. Its two real weaknesses (1024px layout, tab ARIA) are cheap, known fixes; A's weaknesses (length, 61 tab stops) are structural.

## Required fixes before building C

- Under ~1200px do not show the panel inline: default it to collapsed (it is already collapsible) and open it as an overlay or a bottom sheet, so the table keeps Status, Input, Reason and at least the analysis metric. At 1024 the table currently clips the metric columns.
- Panel tab strip clips at 300-360px: use an overflow-scroll tablist with fade, or move "Latency" and "Repeat" into a select when narrow. Latency stat strip must wrap or use p50/p90/p95 only ("Mean 1.!" is truncated).
- Mount all tab panels (or omit `aria-controls` on unmounted ones): critical `aria-valid-attr-value` in B and C.
- Put `aria-sort` on the `<th>` rather than the sort `<button>` (critical `aria-allowed-attr`, shared by all variants).
- `passDots` need a role or label (`role="img"` + text) - 40 `aria-prohibited-attr` serious hits on repeat runs.
- Contrast: status Tag danger on the open row and the split-bar count on the red segment.
- Fixture banner is mock only, but remember the filter bar wraps to two rows in C at 1400; make the slider inline (Slider compact mode gap) so it is one row.
- Heading order: item card block labels should be non-heading or h4 under an h3.

## Borrow from the others

- From A: the section deep-link map (`#section-*` to panel tabs and item anchors) so old links work; count badges on navigation (Items 60, Errors 6) on every panel tab; the expanded hero meta grid as the default for non-repeat first visits (remember the chevron state), and the "back to top / Items" shortcut for the narrow overlay.
- From B: the "See the N matching items" CTA inside the panel when the panel is an overlay (< 1200px); a Reviews destination (review history and score-lock notice) as a fifth panel tab or hero section, because C has no home for it; per-tab scroll memory idea for the panel.
- From B and A: the stat strip in the items header is fine in C, but hide it under 1100px as designed and keep it in the hero tooltip.
- Shared by all (keep as is): TraceDrawer (keyboard model, focus return OK), the single FilterBar and its chips, ItemsTable with row-level Trace button (1-click trace).
