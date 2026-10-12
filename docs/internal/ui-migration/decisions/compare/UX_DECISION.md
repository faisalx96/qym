# Compare page: UX decision (A baseline / B matrix / C itemfirst)

Method: Playwright against the three mock routes, 1440x900 and 1024x768, states 2/4/20/cohort/cohort-Sweep
(screenshots: `/tmp/claude-1000/ux-compare/*.png`), tasks performed live, axe-core 4.x run on the 4-run state,
console errors checked (0 console/page errors in all variants and viewports).

## Scores (1-5, higher is better)

| Criterion | A baseline | B matrix | C itemfirst |
|---|---|---|---|
| Task success | 4 | 4 | 5 |
| Steps-to-complete | 4 | 3 | 5 |
| Discoverability | 4 | 4 | 4 |
| A11y | 3 | 3 | 3 |
| Density (first 900px) | 3 | 3 | 4 |
| Consistency with app | 4 | 4 | 3 |
| Fit: 2 runs | 5 | 3 | 4 |
| Fit: 20 runs | 3 | 3 | 4 |
| Fit: cohort | 3 | 3 | 4 |
| **Total (of 45)** | **33** | **30** | **36** |

## Steps-to-complete (clicks + scrolls actually performed, 1440x900, 4-run state unless noted)

| Task | A baseline | B matrix | C itemfirst |
|---|---|---|---|
| T1 read C's `quality` baseline delta (-11.5 pts) | 0 (Metrics tab default; 2 clicks to retarget the strip Select) | 0 (matrix) | 0 (panel table, partly clipped at right; 2 clicks to retarget the delta line) |
| T2 items regressed for C | 1 click (auto-switches to Items tab; 7 rows + "regressed in cand-b-small" chip all inside 900px) | 1 click + ~1 long scroll (filter applies but list is ~1800px below; page only shows "7 items" in the subtitle) | 1 click (list already on screen, panel recomputes: baseline 100%) |
| T3 cohort verdict | 1 click (Sweep; "WITHIN NOISE" banner). Compare view shows only the glyph "≈ +5.3 pts ±12.2" | 1 click (same Sweep view) | 1 click (same; delta line shows glyph chip only) |
| T4 open one item's outputs, all runs | 1 (Items tab); item 3 is pre-expanded with all 4 cards; expand another = 1 click | 0 clicks, ~1 long scroll (item 3 pre-expanded below overview); another = 1 click | 0 (item 3 pre-expanded in first viewport, 3 of 4 cards, D wraps); another = 1 click |

Keyboard: Tab presses from page top to first item row button (mock bar adds 3): A never reaches items by Tab
(81+ presses, wraps; Items is a different tab, needs Arrow + Enter on tab strip), B 37 (34), C 25 (22).
Sweep view is identical in all three (shared), so it does not differentiate.

## A11y findings

- axe (4 runs): A `aria-valid-attr-value`(1), `color-contrast`(5), `landmark-one-main`, `region`(9); B `aria-valid-attr-value`(1),
  `color-contrast`(4), `heading-order`(1), `landmark-one-main`, `region`(6); C `color-contrast`(11), `region`(4). landmark/region
  are mostly mock-harness. C has the most contrast failures (small mono labels in the side panel).
- **All three: item row buttons have no visible focus ring** (computed `outline: none`, no box-shadow, on `_item_*`; other
  controls have a 2px solid outline). WCAG 2.4.7 failure on the primary interaction.
- Matrix and C: real `<table>` with `th scope=col/row` and `<caption>`. **A's metric table has no table semantics** (0 `<table>`, 0 `th`, 0 role=table/row): screen readers get no row/column headers. Biggest A-specific gap.
- Roving controls work: A tabs respond to Arrow + Enter, B pivot is a radio group (Arrow moves and selects, visible ring), chips and count buttons are native buttons with descriptive labels ("7 items regressed vs baseline of ...").
- Colour not the only signal: delta shows sign + triangle glyph + sr-only word; item pills show Pass/Fail/Error text with arrow glyphs; 20-run heat strip uses check/x glyphs. Cohort verdict has glyph + words, but the word "within noise" is visible only in Sweep (Compare view: glyph only).
- Value cells are coloured red/orange by threshold (e.g. 38.5% red next to a green +16.2 delta); the two colour channels conflict in all three.
- Focus order: A logical but the 6 strip counts and the 12 table counts duplicate each other (18 tab stops before the tabs content); C is shortest to the list.

## Density

- Sticky header consumed: A 197px (22% of 900) and it duplicates the table; C 87px (delta line + chips) with the item column header NOT sticky (A..T letters scroll away, only the panel header is); B none sticky except the item column header deep in the page (repeats letter + delta, good).
- First viewport answer: A = baseline + 3 ranked delta cards (metric table starts at y~430); B = full metrics x runs matrix (y 300-650) without scrolling at 4 runs; C = delta line + first 8 item rows + panel.
- 1024x768: A strip needs horizontal scroll at 20 runs (6 of 19 cards at 1440, 3.5 at 1024); C panel stacks under items below 1100px (item list first, good); B matrix gets tight but fits; first viewport at 1024 is mostly chrome in A and B (page header + mock bar + chips + select).
- 20 runs: all three show only 6 of 20 columns in the metrics table (horizontal scroll). C item rows show all 20 as an A..T glyph strip (best). Item expansion shows only 8 run cards ("+12 more runs not shown") in A/B/C: user cannot read output of runs 9-20.

## Winner: C itemfirst

Reasons: fastest to the key answer of the dominant journeys (T2: 1 click, list on screen, panel recomputes over the filter; T4: 0 clicks); fewest tab stops to the list; sticky header is 87px vs 197px; the only variant that shows all 20 runs on item rows; best at 20 runs and cohort triage. Weaknesses are fixable by adopting pieces of A and B (below). B is the best analytics surface but loses on steps (long scroll between filter and list); A is the best 2-run view but its sticky header is expensive and Items sits behind a tab.

## Improvements C must adopt (ranked)

1. Fix the row focus ring (all variants share the bug): visible `:focus-visible` outline on item rows. (a11y, blocker)
2. From B: pivotable matrix as the analytics panel's Metrics view (By domain / By complexity / Errors radio pivot, row/col scope, caption). Replace the narrow, clipped runs-x-metrics table; let the panel be resizable or open wide (drawer) on demand.
3. From B: sticky column header on the item list (letters A..T + selected metric delta); C currently loses column identity when scrolling.
4. From A: ranked order and baseline marker; sort the delta line by selected-metric delta, pin baseline first, and add a "best/worst" jump so 20 candidates are triaged without horizontal scrolling. Keep a single filter-chip bar with Clear (A's `regressed in cand-b-small (correct)` chip) in the sticky area.
5. From A: show the cohort verdict word ("within noise / improved / regressed") in the Compare view banner, not only Sweep; sign + glyph + word.
6. Remove duplicate controls: Baseline select and Run average/Each pass sit in a second row at 1024/20 runs; merge into the toolbar so the sticky stack stays <= 90px.
7. Expanded item at >8 runs: add "show all runs" / virtual list of output cards (currently "+12 more runs not shown").
8. Baseline label wraps ("Baseli / ne") in the panel; widen the first column or use the star glyph.
9. Do not colour raw metric values by threshold in the same red/green as deltas; use neutral text for values, colour only deltas.

## Bugs and visual defects

- **All variants, 20 runs: page-level horizontal scroll** (window scrolls to scrollX=600; documentElement.scrollWidth 4202 / 4088 / 5100). Strip, delta line or table wrapper lacks `min-width: 0` / `overflow-x: auto` containment. At 1024 as well.
- A: sticky header 197px; metric table is divs (no semantics); strip hides 13 of 19 cards at 1440; chips area duplicates strip counts (two sets of the same count buttons).
- B: at 20 runs the chip row wraps to two lines (+70px) and Baseline select drops below; item list is ~1800px below the matrix so filter results are off-screen (no scroll-to-list or in-place confirmation); table column header "BASELINE" tag truncates the run name ("baseline-gpt-...").
- C: panel table clipped at right edge (quality column "±" cut off, count buttons cut at 1440); "Baseline" tag wraps into "Baseli/ne"; delta line overflows at 20 runs and shows a dangling neutral dot on the last chip; panel shows baseline + 3 movers only; analytic panel and 4th output card (D) wrap under the 3-up grid at 1440.
- Cohort Compare view: heading "Baseline against candidates. Everything below..." (A) and "One matrix..."(B) subtitles do not fit cohorts; delta word missing (see a11y).
- No console errors in any variant (0 across 3 variants x 2 viewports x all states).
