# Round 4 review: per-pass rows inside the runs table

Reviewer: independent agent (Claude Fable 5.1). Branch `ui/redesign4-runs-passes` at 3a72d2e3. Measured 2026-10-18 in Chromium
(Playwright, own scripts, not the implementer's spec) against the platform on 8985 and Vite on 5985, seeds `r4-seed`
(classic, 3-pass, 10-pass, 8 items) plus `r4-big2` (20 ten-pass runs and 30 classic runs, 50 runs per page). Screenshots:
scratchpad `r4r/shots/` (listed at the end). No product code was edited.

## Verdict: MEETS WITH FIXES

The owner's point is met in the product: the passes are rows of the one runs table, hidden until the chevron, and every table
navigation I tried moved the run and its passes together. One required fix is a test, not product: Q20's e2e never reaches the
virtualised path it claims to cover. Everything else is optional.

## Feedback point, judged as the owner would

"per pass table should be part of the main table but hidden unless the user clicks the drop down button ... table navigation
will move the main and per pass results to compare their metrics against each other."

With the 3-pass and 10-pass runs both open (13 pass rows, 2 strips), after each of: scrolling the scroller 400 and 1000 px,
moving `quality` six places left, then scrolling, freezing `quality` and scrolling, hiding `quality`, resizing Status by 40 px,
three densities, sort by `correct` desc / asc / back to Date, the left and width of every `td[data-col]` of every pass row
equalled the run row's (max difference 0.0 px, all 24 columns, same column sequence), and the children stayed directly under
their parent (`data-parent-run` equal for all, order 1..k, strip last). The pass score sits straight under the run score
(`metric-correct` x 1240 / 1240 at rest, 840 / 840 after 400 px, 53 / 53 after the reorder, 990 / 990 reordered and scrolled).
I can compare a pass with its run by looking up and down after any navigation. Verdict on the feedback point: MET.

## Criteria (32): 32 met in the product, 1 with a test gap

| Q | Measured | Met |
|---|---|---|
| Q1 | 1440: 2 chevrons `Expand 10/3 passes of` (2 runs with samples>1), aria-expanded false, 0 pass rows, 0 strips; same at 1024 and 390 (390: 0 `Passes of` groups, 3 cards) | met |
| Q2 | 3 following `tr[data-pass-row]` siblings in the same tbody; 1 `table`; 0 `[role=region]`; name `Collapse 3 passes of 42d80351`, expanded true; collapse removes them | met |
| Q3 | chevron: Enter then Space then Enter gives expanded true/false/true, focus stays on the chevron; run row ArrowLeft 3 -> 0 rows, ArrowRight 0 -> 3; ArrowDown goes run -> Pass 1 -> 2 -> 3 -> next run (strip skipped); ArrowLeft on a pass row focuses its run | met |
| Q4 | all 24 columns, left and width difference 0 (limit 0.5), identical column sequence | met |
| Q5 | `correct` 1240 -> 840 for run and pass 1 (moved 400), `quality` 2070 -> 1670, equal `left` | met |
| Q6 | order `quality, correct` for run and all passes; `quality` left -97 / -97, `correct` 53 / 53 at scrollLeft 0 | met |
| Q7 | frozen `quality` left 611 for run and pass rows after 400 px, `correct` moved to 990 on both; pass cell bg `rgb(16, 16, 24)` (opaque) | met |
| Q8 | hide: 0 `td[data-col=metric-quality]`, 0 "Show all metrics"; resize Status 144 -> 184 for run and pass (+40 both) | met |
| Q9 | compact 32/32, regular 40/40, comfortable 52/52 | met |
| Q10 | `Pass 1..3`; link `Pass n of 3 of run 42d80351`, href `...?pass=n`; name x 243 / 243; one status badge; Date 14:59 per pass; task-error pass `!1` with `1 task error in this pass`, clean `–` | met |
| Q11 | Task, Model, Dataset, Owner, Experiment, Version text `''` in pass rows; `Analyze pass n` x3; latency 1.6s, duration 49s, metrics 62.5/62.5/87.5 | met |
| Q12 | per pass: `Delete pass n` button plus `More actions for pass n`; run row has Submit, Delete, More; no Submit on passes. Role matrix and DELETE flow: `readonly`, `passes`, `cutover-passes` specs pass in the gate (not re-measured by hand) | met |
| Q13 | run row, pass row and strip first-cell/strip `box-shadow` `rgb(0, 212, 170) 3px 0 0 0 inset` (accent); pass and strip bg `rgb(16, 16, 24)` (= `--bg-void`), neighbouring run `rgb(20, 20, 30)`; opacity 1; 0 `[data-series]` | met |
| Q14 | one strip row after the last pass; colSpan 24 = cell count; left 207 = scroller left, width 1203 = clientWidth, at scrollLeft 0 and 400 | met |
| Q15 | 1440: 45 px, control centres all 363.5 (tops 352/352/358); 1024: 56.4 px (scroller 787); 390: 166.6 px | met |
| Q16 | title `Passes`, `3 · 8 items`, Select, chip `Pass if ≥ 80%` opening a slider, 5 stats, 1 help marker (`Explain group metric`), no Avg latency; `group-metrics?metric=quality&threshold=0.8` on select, `threshold=0.85` and `0.9` on slider keys | met |
| Q17 | strip left 207 at scrollLeft 0 and 1000; scrollWidth 1203 = clientWidth | met |
| Q18 | sort `correct` desc, asc, then Date: every pass row follows its run in order 1..k, strip last, glyph only on the header | met |
| Q19 | pinned select column left 207 / 207; passes 1+3: bar `2 executions selected`, run `indeterminate` true; all three: 3, run checked; click run: 0 and passes cleared; shift 1..3: 3 and all checked | met |
| Q20 | product: 20 open ten-pass groups, aria-rowcount 205 (over the 200 threshold), DOM 26 to 36 rows, `data-index` continuous over 16 scroll steps, 0 console errors/warnings, the 4 expansions I timed kept the run row at y 408 / 408 (0 px), groups stay open after scrolling. The e2e does not reach this path (finding F1) | met (test gap) |
| Q21 | delayed 1.5 s: 3 loading rows at 32 px, run `aria-busy=true`, strip frame `Loading group metrics…`; table height 295 loading, 295 loaded (0 px shift, +141 over collapsed 154) | met |
| Q22 | request aborted: 1 row `Could not load passes`, `Retry` present, 0 strips; retry restores 3 passes | met |
| Q23 | samples 5 with 2 passes: 2 pass rows plus `Passes 3–5 waiting to start` row, `QUEUED`, 32 px | met |
| Q24 | not re-measured by hand (needs a running run that refetches every 15 s); the spec test passed in the gate. A forced refetch of a completed run did not fire (staleTime), so I record it as spec-verified only | met (spec only) |
| Q25 | `sessionStorage['qym:runs:expanded:r4-seed']` holds the run id; URL never carries it; open pass 2 (`?pass=2`), Back: 3 pass rows and 1 strip; reload in same tab: 3 | met |
| Q26 | treegrid; run level 1, expanded; passes level 2, posinset 1..3, setsize 3, names `Pass n of 3 of run ...`; strip level 2 `Group metrics of 42d80351`; aria-rowcount 8 = 7 body + header; axe serious/critical 0 at 1440 (group open and select on) and 390 (open and select on) | met |
| Q27 | 3-pass group adds 32+32+32+45 = 141 (limit 150); run 32 | met |
| Q28 | 390: chevron present, closed card has no group; open: one `[role=group]` `Passes of 42d80351` in the card with `ul` of 3 `li` at 50.6 px (limit 56) showing Pass n, badge, score, issues, 2 buttons; card scrollWidth 289 = clientWidth; page scrollWidth 390 | met |
| Q29 | strip after the lines, 166.6 px (limit 190), width 289, Select trigger 258 px = strip content width (the 59 px element is the hidden native select), stats grid `122px 122px`; choosing `quality` changes the three lines to 64.3/61.7/73.0% | met |
| Q30 | each pass line has `Select pass n of 3 of run ...`; 1+3 ticked: card checkbox indeterminate true, bar `2 executions selected` (lines must be scrolled into view first: the card list sits in a 419 px host) | met |
| Q31 | reduced motion: animation `none`, durations 1e-6 s (0.001 ms), no running animations; normal: `child-in` 120 ms opacity only, no height animation | met |
| Q32 | 0 `[role=region][aria-label^="Passes of"]`, 0 `table[aria-label$=" passes"]`, 0 "Show all metrics" at 1440 and 390 | met |

Count: 32 of 32 met on the product (Q24 by the spec only, Q20 with a test gap).

Keyboard and screen reader: chevron focus order, Enter/Space, Arrow keys and `aria-expanded` verified above; focus ring on a pass row is visible
(`m-focus-pass-1440.png`). Live refetch keeping expansion: spec only (Q24).

## Deviations (12 in impl-notes, judged)

1. `ChildRows<R>` is `{ rows, detail? }`: convenience, but sound (primitive stays free of data states); the page's `TableRow` union is the right place. Accepted.
2. Strip frame while loading (Q21): measured reality, I measured 295 / 295 px. Accepted.
3. Native `indeterminate` instead of `aria-checked=mixed`: measured (React Aria); the property is true in both table and card mode. Accepted.
4. `div[role=group]` around the `ul`: measured (axe), axe 0 at 390. Accepted.
5. 0.001 ms under reduced motion: measured (1e-6 s) and animation is `none`. Accepted.
6. Q15 centres: measured, centres are identical (363.5); tops differ 6 px by control height. Accepted.
7. En dash and rewritten response in Q23: reality of the seed; accepted. Related nit F3.
8. Strip not an Arrow stop: reasonable (no cells to read); its controls are Tab stops. Accepted; optional note below.
9. j/k still step between runs: acceptable; the arrow keys walk pass rows. Accepted.
10. `IssuesCell` location, `data-parent-run`: convenience, harmless and documented. Accepted.
11. `passes-panel-layout.spec.ts` deleted: replaced by Q13, Q14 to Q17, Q27, Q31, Q28 to Q30; the diff of the other specs changes locators only (one assertion text changed to the new strip title `3 · 8 items`). Accepted.
12. Spec amendments in section 9: each has a measured number on the same element and a test that asserts it. Accepted.

## Findings

Required:
- F1 (test, `frontend/e2e/runs-list/passes-rows.spec.ts` Q20, about lines 743-780): the seed makes 12 ten-pass groups among 50 runs, so the display list is 38 + 12 x 12 = 182 rows, under `VIRTUAL_AFTER` 200; the table never virtualises, and the assertion `rowcount > n*11 + 30` does not check it. The criterion says "more than 200". My measurement with 20 groups (205 rows) shows the product holds, so the fix is the test: seed at least 18 ten-pass runs (or fewer classic runs plus more groups), assert `aria-rowcount > 200` and that the DOM `tr` count is below it. Also correct the criterion's arithmetic in the spec (12 groups give 182, not over 200).

Optional:
- F2 (`frontend/src/features/runs-list/passes/PassGroupStrip.tsx` or its query): `group-metrics` is requested twice with the same query on first expand (two identical GETs). Likely a duplicate observer; one request would do.
- F3 (`frontend/src/features/runs-list/passes/rows.ts`, `DataTable` child labels): with samples 5 and 2 started passes, `aria-setsize` is 3 (rows) not 5 (samples), and the queued row counts as one; spec 4.2 says k = samples.
- F4 (card mode, `DataTable` `CardList`): the open pass lines sit in the 419 px cards host, so on a phone the user scrolls inside the host to reach them (this existed before; unchanged).
- F5: the run name link is weight 500 while the open run row's cells are 600; spec 4.3 says the name goes to 600. Visible difference is small.

## Gate (through `scripts/heavy.sh`, ports 8985 / 5985)

| Step | Result |
|---|---|
| `npm run check` (cost 3) | green: tsc, eslint, stylelint, Vitest 157 files / 1373 tests, design test 49 |
| Playwright `e2e/runs-list` (cost 3, 2 workers) | 222 passed, 0 failed, 0 skipped (5.6 min) |
| `pytest tests/platform/test_design_language.py`, builds, full e2e | not re-run by the reviewer (implementer reports them) |

Servers stopped (8985, 5985 free).

## Screenshots (scratchpad `r4r/shots/`)

`a-collapsed-1440`, `b-expanded-1440`, `b-scrolled400-1440`, `c-reordered-scrolled-1440`, `c-frozen-scrolled-1440`, `c-hidden-1440`,
`e-select-1440`, `g-expanded-1024`, `g-collapsed-390`, `g-expanded-390`, `g-select-390`, `h-expanded-390-scrolled`,
`h-select-card-390`, `i-queued-1440`, `j-virtual-1440`, `m-focus-pass-1440`.
