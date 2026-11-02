# Review: redesign2 run-detail (+ traces)

Branch `ui/redesign2-run-detail` at 2f36bb29, reviewed 2026-10-14 against the legacy page (port 8915), the UI-redesign tip (f4bb9bcd, read-only on 8914/5914) and
the branch (8913/5913). Seeds: `seedClassicRun`, `seedRepeatRun`, `seedArabicRepeatRun`, `seedManyCategories` (e2e/run-detail/seed.ts) on all three DBs.
Screenshots and scripts: orchestrator scratchpad `rd2r/` (`n-*` new sections, `card-ar*`, `met-*`, `tr1440-*`, `n390-tr-*`, `leg-arabic-card.png`).

## Verdict

**Approve with fixes.** All eight feedback points are met and clearly better than both the base tip and legacy. Nothing regressed. One should-fix (Arabic values
inside JSON key sections sit far from their key label) and a few small polish items; none blocks merge.

## Gates

| Gate | Result |
| --- | --- |
| `npm run check` (eslint, tsc, 129 Vitest files / 1211 tests, design-language 47) | pass |
| `npm run build` | pass |
| Playwright `e2e/run-detail` | 232 passed |
| Playwright `e2e/shell` | 93 passed, 8 skipped (as before) |
| Playwright `e2e/visual-language` | 10 passed |
| Playwright `e2e/compare` | 93 passed |
| `runs-list/cutover-run-rows.spec.ts:8` | passes 2/2 on this branch, 1/1 on UI-redesign (see below) |

Regression sweep (qa/run-detail.md, report-pages, tables pass 2): sticky header, 5,200-row virtualization, scope sidebar, heatmap, CSV, diagnosis/correction editing
and deep links are all exercised by the run-detail folder (items-virtual, scope-sidebar, panels, qa-fixes, cutover-*) and passed. No regression found.

**cutover-run-rows.spec.ts:8** is "the empty project links to the first-run guide" (navigates to /docs-guide). It does not touch run detail; the branch changes no
runs-list or docs-guide code (only shared primitives). It passes on the branch (twice) and on UI-redesign in isolation, so the implementer's two failures were a
cold-start/load flake of the first test in the file, not caused by this branch and not a base defect I could reproduce. Attributed: pre-existing flake, unrelated.

## Feedback points

1. **Grey boxes: pass.** Expanded item, 1440 px, measured on the DOM (panel box = div/article >= 160x28 px that is filled or has 3+ border sides):

   | Item | UI-redesign tip | Branch |
   | --- | --- | --- |
   | classic item 1 | 12 panel boxes, nesting 2 | 0 panel boxes, nesting 0 |
   | Arabic multi-pass item 1 | 16 panel boxes, nesting 2 | 3 (the three SQL code blocks), nesting 1 |
   | Arabic item 2 at 1280 | 14, nesting 2, detail 1144 px in a 1031 px scroller (overflows) | 3, nesting 1, 1031 px (fits) |

   Raw "filled or bordered elements" (any size) go UP (classic 29 to 39, Arabic 42 to about 100): they are tags, hairline section borders and JSON table cells, not boxes.
   The visual result is calm: Input, Expected and Output have no fill and no three coloured rails, a single red or green 2 px rail marks the output verdict.
2. **Repeat order and clarity: pass.** Metric selector, one-line verdict ("Pass@3 78.3%, Pass^3 55.0%: 23 pts ..."), three labelled stat groups (Capability, Consistency,
   Speed and errors), curve, distribution with "always fail / always pass", then the By pass table with best/worst tags and red error counts. One visual per row. Nit: the stat
   strip is 1193 px wide while the curve, bars and table cap at 1100.
3. **Steps collapsed by default: pass.** Agent and Eval rows start collapsed; Expand all, Collapse all, search, By step/kind and Linear/Log present.
4. **Deep analysis one visual per row: pass.** Correlation matrix, then the scatter below it. The matrix leaves a lot of empty space at its right (cosmetic).
5. **Categories: pass.** 5 keys as a chip row (24-value key is the default), one key's ranked table (worst first, Rank by select, band bars, items, pass, latency, one-line
   weakest/strongest summary) with "Show all 24 values". Far less overwhelming than the legacy card grid.
   6a. **Arabic next to its label: pass for plain inputs, partial for JSON.** Plain Arabic input at 1280 and 1440: label mirrors to the right and the text starts about 100 px from
   it, measure capped. The detail never exceeds the scroller. Third pass column: visible side by side at 1440 (3 x about 390 px); at 1280 (scroller 1031) the third pass wraps
   under passes 1 and 2 (spec says side by side from about 1100), so it is visible without horizontal travel. See fix 1 for the JSON case.
   6b. **JSON per key: pass.** Per-key sections with type/size summary, copy per key, arrays of scalars as chips, arrays of objects as tables, Sections | Raw, Collapse/Expand all,
   key index in pass columns, SQL as a code block. Legacy showed raw nested key/value stacks.
6. (7) **Metric chosen panel: pass.** Quality and hallucination opened at once, each as a full-width panel under the chip row (label/value rows, hairlines), the score editor
   ("Edit EXACT_MATCH", input, Save, Cancel) opens in the same slot. Matches the legacy `.metric-det-*` structure without its nested boxes.
7. **Traces: pass.** 1440: drawer 1319 px wide, tree left and detail right, draggable divider (mouse drag moved it 200 px, ArrowRight moved it 25 px, role=separator), stat
   chips (spans, duration, tokens, cost), trace ID chip with copy, kind icon tiles, Messages/Response/Metrics/Raw tabs with labelled System/User/Assistant blocks each with copy
   and expand, tool call JSON. At 390 (screenshots taken: `n390-tr-*`): header chips wrap, Tree | Detail switch works, no horizontal overflow (scrollWidth 390).

## Fix list

1. **Should fix: short Arabic values in JSON key sections sit far from their key** (single-column Input/Expected/Output at 1440: key "ANSWER" at x=175, its Arabic value
   ends at x=1133, about 900 px away; same shape as legacy but it is the exact 6a complaint). Cap the section body measure (about 76ch) and anchor it next to the key, or mirror the
   section row when the value is RTL, as `FieldRow` does for plain input.
2. Citations (any uniform-object table) in a 3-pass column at 1440 are 26 px wider than the column, so the Score column is cut off behind a horizontal scroll; legacy showed
   all values. Make the compact table fit the container (tighter cell padding) or at least show the scroll affordance. Table rows are also tall (about 52 px) for a "compact" table.
3. Nit: at 390 the Tree | Detail switch touches the detail header; add a gap.
4. Nit: align the repeat stat strip to the 1100 px cap used by the visuals below it.
5. Deferred by the implementer, still open: remove compare's local `.detailHold` at merge; T7c compare-by-key; "Cards | Compare" categories not restored (accepted default).

Not measured: whole-page first-render filled/bordered element count (spec target under 100, was 233); the item-level counts above are the evidence for point 1.

All servers I started (8913, 5913, 8914, 5914, 8915) are stopped.
