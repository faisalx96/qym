# Round 7 (QA feedback): implementation notes

Branch `ui/redesign7-qa`, spec `qa.md` (52 criteria: Q1 1-9, Q2 1-12, D1 1-8, D2 1-14, D3 1-9, plus **D1-3b** and **D2-15** added here). Fixtures: `seedR7` (`frontend/e2e/runs-list/seed.ts`,
a scaled copy of `seed-r7.mts`) and `seedR7JsonKeys` (`frontend/e2e/run-detail/seed.ts`, now also what `seed-r7.mts` calls). Measurements: the designer's scripts in `measure/`
against the **production build** served by the platform (SQLite, `seed-r7.mts`, Playwright 1.64 Chromium headless shell, dark scheme, medians of 3), raw JSON in `measure/after/`,
screenshots `shots/after-*.png` (same states as the `current-*` shots, each under 300 KB). Machine shared; absolute times vary by about 20%, counts do not.

## 1. Commits (one per step, plus fixes)

| Step | Commit | What |
|---|---|---|
| Q1 + D3 | `5fb22b2e` | shared `DataTable`: no overlay, the pinned cells draw the boundary |
| D2 | `2ac45a3d` | keys wrap and render as written (tree, sections, facts, tags) |
| Q2 backend | `3309b059` | `group-metrics?view=group` |
| Q2 client | `366fdfb6` | prefetch, strip on `view=group`, shift-free loading frame |
| Q2 fix | `3293154b` | the prefetch queue yields to a click |
| D1 | `39627155` | the item bar's shift is written on the bar |
| docs | the commit that carries this file | impl notes, spec amendments (`qa.md` section 9), `after/` JSON and screenshots, `DESIGN_LANGUAGE.md` |

## 2. The orchestrator's decisions, as implemented

1. **D1, compositor-driven bar: native `position: sticky` is impossible here; the fallback F1 shipped.** Measured with the production DOM (`r7i` probe on the dev server, same DOM): between the bar and the page scroller
   (`#shell-content`) sit `article` (`container-type`), `.detailHold` (`position: sticky; contain: layout`), `td.detailCell` (`overflow: clip`), **`div.scroller` (`overflow: auto`)** and **`div.bodyHost` (`overflow: hidden`)**.
   The nearest scroll container of the bar is the table's own scroller, which never scrolls vertically, so a CSS-sticky bar never engages: **1,700 px off the sticky line at most (median 940 px)** over a 40-notch scroll
   (the shipped JS translate: 0.003 px). Forcing both ancestors `overflow: visible` still leaves 56 px (the sticky `detailHold`) and would break the table's sideways scroll. So `ItemCard` passes `shiftTarget` (F1): `--head-shift` is
   written on `[data-item-bar]`, not on the `<article>` where its inheritance restyled 594 descendants per scroll event; the bar is `will-change: transform` only while the article carries `[data-stuck]`. The table header keeps its JS shift.
   F4 (a CSS scroll-driven animation) is recorded as the next step (see limitations).
2. **D2, data keys in exact case**: `text-transform: none` and no tracking on section keys, tree keys, fact keys and Tag keys; fixed labels (Input, Expected, Output, the prose eyebrow) keep the uppercase tracked style. One consequence to know:
   a **fact key shows the judge key as written** (`self_consistency_check_result`), where round 5 humanized it ("Self consistency check result"), because criterion D2-15 asks `rendered text == source key` for every `[data-part=key]` and the fact `dt` is one.
   Reversing that for facts is one line (`humanizeKey(...)` in `MetricStrip.tsx`) plus the D2-15 scope. The prose eyebrow still humanizes its key and keeps the raw key in its `title`.
3. **Q2 as specified**: `view=group`, per-run prefetch, cap 20, 4 in flight, terminal runs only, `saveData` off, no batch route, loading frame `min(samples, 20)` with the strip's own skeleton layout. The cap and concurrency are
   constants at the top of `passes/usePassesPrefetch.ts` (`PREFETCH_MAX_RUNS`, `PREFETCH_CONCURRENCY`, comment pointing at Q2.3). One addition found by measuring: the queue **yields to a click** (see Q2 below).
4. **Q1 and D3 as specified**: both overlays deleted (the two `.edge` spans, `.edge` rules, the `[data-cues]::before/::after` fades, the dead `--pin-start/--pin-end` and `data-pin-start/end`); the boundary is the pinned cells' 1 px `--border-strong` line,
   the band cell next to it carries `data-pin-edge`; DESIGN_LANGUAGE "Data table", rule 16 and the design test changed in the same commit. Row rails (state, selection, open group, focus ring) keep the line through a `--pin-line` custom property
   (found by the sweep: an error row's 3 px rail on a pinned first cell used to replace the line).
5. **No other visible change.** Density, row heights, columns, typography outside decision 2 are untouched; the numbers that changed are amended in `qa.md` section 9 with their measured value.

## 3. Criterion -> change -> test (measured on the production build next to the spec number)

### Q1 (runs page: the actions line) and D3 (the same rule everywhere)

| ID | Change | Test | Spec -> measured |
|---|---|---|---|
| Q1-1 | `.edge` spans, `.edge` rules, `[data-cues]` pseudo fades deleted | `pinEdge.test.tsx`, `redesign7-edges.spec.ts` (runs-list), design test | 2 edge elements + 2 fades -> **0 live cue elements** at 1440, 1024; 390 renders none (`edge-*.json` `cueElementsLive`) |
| Q1-2 | nothing is painted over cells | `redesign7-edges` (`coveredText`: the element stacked on every visible glyph is its own cell) | 79.5 / 104.5 / 75.5 / 389 px (1440) and 0 / 25 / 599.5 / 228 px (1024) -> **0 px, 0 text nodes** in rest, group open, scrolled 600, scrolled to the end |
| Q1-3 | no shade | `redesign7-edges` (floor 6.3 on this fixture, see below), `measure/q1-contrast.mts` | min contrast 1.1 -> strip labels **6.9**, neutral metric values **11.2** (114 of 184; tone-coloured ones >= 5.8), header labels **5.7** (the spec's unshaded numbers) |
| Q1-4 | `.th/.td/.bandCell[data-pin-edge]` `--pin-line` = `inset ∓1px 0 0 var(--border-strong)`; `renderBands` gives the band cell `data-pin-edge` | `redesign7-edges` (every pinned-edge cell, count = body rows), `pinEdge.test.tsx` | `--border-subtle`/`-default` -> `rgb(82, 82, 108)` on every pinned-edge cell (header, band cell with its underline kept, body); rail rows compose rail + line |
| Q1-5 | the line stops where a row has no pinned cell | `redesign7-edges` (gaps = strip height), `edge-cues.mts` | top 124 = first header row top (0 px above); bottom = last body row bottom (0 px); only gap = the strip **45 px (1440), 56 px (1024)**; 0 over toolbar/footer |
| Q1-6 | card mode unchanged | `redesign7-edges` (390), `pinEdge.test.tsx` | `[data-pin]` 0, no cue, no sideways scroll |
| Q1-7 | the line is static (no state, no transition) | `redesign7-edges`, `table-scroll.spec.ts`, `table-freeze.spec.ts` | 1-2 transitions -> **0 `transitionstart`**; same computed shadow at scrollLeft 0, 600, end |
| Q1-8 | `scrollCues` still drives the rail | `redesign7-edges` | rail 12 px (11.4 to 12 in the specs) |
| Q1-9 | `:dir(rtl)` mirrors the pairs | `redesign7-edges` (rtl) | start line on the physical left under `dir=rtl` |
| D3-1, D3-2 | same rule in the items table | `e2e/run-detail/redesign7-edges.spec.ts` (1440, 1024) | 26,058 px tall cue, 33 nodes / 698.5 px covered -> **no cue, 0 px covered**; the only gap in the line is the open item (576 px = its detail row, 0 px difference) |
| D3-3, D3-4 | `elementsFromPoint` at the boundary inside the detail; nested tables follow the rule | same | no outer pinned-edge cell, no `[data-edge]`, no directional gradient; nested matrix cells draw their own line |
| D3-5, D3-6, D3-7 | guards (unchanged code) | same, `d3-header.mts` | header 0 px above the line, 0 px past the card, bar 0 / 0 px past the card, bar top = line, nothing of the table outside the card (`after/d3-header-*.json` equal to the baseline) |
| D3-8 | one rule in the shared primitive | `e2e/visual-language/table-edges.spec.ts` (1440, 1024) | 18 routes (runs, charts, run detail, passes, compare, experiments, queue, experiment, environments, datasets, dataset, 4 settings tabs, 4 admin tabs, profile, trash): every table that pins a column, at rest and scrolled to the end: 0 overlays, line `--border-strong`, 0 covered glyphs |
| D3-9 | docs + test | `design-language.test.ts` ("draws a table's boundary with its own cells") | rule written, test added |

### Q2 (loading the passes)

| ID | Change | Test | Spec -> measured |
|---|---|---|---|
| Q2-1 | `run_group_metrics(view="group")` returns before `cached_repeat_analysis` | `tests/platform/test_run_group_metrics_view.py`, `measure/q2_group_view.py` | 10,900 / 2,630 ms -> **22.0 / 8.7 ms** (HTTP median of 5 first requests; handler 17.1 / 4.1 ms); keys exactly `run_id, metric, direction, threshold, samples, report_k, group`; 384 / 381 B (241 / 239 gzip); `run_metric_analyses` rows 0 added; `group` equal in both views |
| Q2-2 | default view untouched | same | keys unchanged; cached repeat 12.3 ms (10 x 300; the 10 x 1,200 repeat is 27.5 ms: it still reads 12,000 scores to check the cache signature) |
| Q2-3 | none (pinned by tests) | `tests/platform/test_run_passes_statements.py`, `measure/passes_profile.py` | 28 statements at both sizes (16 on the test's ingest-built fixture, equal at 20 and 80 items); **316.3 / 67.1 ms** against 322 / 66 baseline (ceiling amended to 340 / 80) |
| Q2-4 | prefetch (`usePassesPrefetch`), `runPassesQuery` / `groupMetricsQuery` shared by the strip and the prefetch | `prefetch.test.ts`, `e2e/perf/runs-passes-load.spec.ts` | click to rows + strip painted **57 ms** local (10 x 300; was 132), **63 ms** on Fast 3G (was 632), 0 requests after the click |
| Q2-5 | a click starts its own request at once; the queue yields to it | same, `q2-passes-load.mts` | 11,225 / 2,805 ms -> **460 ms** (10 x 1,200, median of 6) / **201 ms** (10 x 300) local; Fast 3G **646 / 659 ms**; 2 requests (passes, `group-metrics&view=group`) in the spec with `saveData`; ceiling amended to 500 ms for 10 x 1,200 |
| Q2-6 | same cache entries | same | five groups opened in a row: 10 requests -> **0** after the first click, every group <= 65 ms |
| Q2-7 | `PREFETCH_*` constants, idle start | same | `q2-prefetch.mts` (`after/q2-prefetch-*.json`), 17 repeat runs on the page: the first prefetch request starts **181 ms** after the list's 3 requests ended (<= 600), **34 requests** for the 17 runs (<= 34) of **28.7 kB gzip** (<= 30), **4 in flight at most**, row order, settled **2,239 ms** after the list (<= 2,500) locally; on Fast 3G first request 48 ms after, 4 in flight, settled **5,158 ms** after the list (<= 8,000); the list's own requests stay 3. (A click that arrives while the 13th run, the 1,200-item one, is still loading attaches to its request: 174 ms instead of 57 ms in one of two `settled` measurements.) |
| Q2-8 | `planPrefetch` (terminal only, `samples > 1`), `saveDataOn`, `PrefetchQueue.cancel(keep)` | `prefetch.test.ts` | RUNNING/PENDING skipped, nothing under `saveData`, page change drops the queue and aborts the requests of runs that left, a click attaches to the in-flight request (one request per key) |
| Q2-9 | `loadingCount` = `min(samples, 20)`; `PassGroupStrip` renders its own layout with `Skeleton` values (`aria-busy`) | `passChildren.test.ts`, `PassGroupStrip.test.tsx`, `runs-passes-load.spec.ts` (10 and 19 passes, 1440 and 1024) | strip frame 45 -> **56.39 px at 1024 with the placeholder frame already 56.39 (shift 11.4 px -> 0)**; table height placeholders = rows (2,034.39 = 2,034.39 at 1024, 2,023 = 2,023 at 1440); 19 passes 0 +- 1 px |
| Q2-10 | `view=group` key per (metric, threshold), `keepPreviousData` kept | `runs-passes-load.spec.ts` | select change -> one `view=group` request, statistics back within the spec's CI margin on the dev server (1.5 s asserted, 100 ms strict; the request itself is 4 to 17 ms) |
| Q2-11 | a failed prefetch is swallowed (`PrefetchQueue`); the open path is unchanged | `prefetch.test.ts` (a rejected unit frees its slot), `passes-rows.spec.ts` Q21/Q22 (run with the prefetch off) | as before |
| Q2-12 | `dashboardTypes.GroupMetrics` has optional `band`, `distribution`, `uncertainty` | `runs-passes-load.spec.ts` (API equality), `redesign3-repeat.spec.ts` unchanged | the run page reads the default view; its `group` equals the strip's |

### D1 (the frozen input)

| ID | Change | Test | Spec -> measured (production build, 1440 unless noted) |
|---|---|---|---|
| D1-1 | none (guard) | `item-scroll.spec.ts`, `d1-scroll.mts` | pinned cells **0 px, 0 frames over 1 px**, 1x/4x, wheel and drag, +2 frozen (`pinnedMaxYErrPx` 0) |
| D1-2 | the bar's shift is applied from cached geometry as before | `item-scroll.spec.ts` | 3.55 px in the entry frame (1440), 0.22 (1024), 2 frames over 1 px (entry/exit), 0 otherwise: unchanged |
| D1-3 | `will-change: transform` only while stuck | `measure/d1-bar-jank.mts TOUCH=1` | 1 px in 47 to 55 stuck frames -> **0 px in 47 to 50**, 4 px in the last 4 (the bar leaves with the item; was 30); 50 ms of block every 120 ms at 1x and 4x: the same, one 29 px frame at the exit |
| **D1-3b** | harness added to `d1-bar-jank.mts` (`BLOCK=400 PRESTUCK=1 GESTURE=mouse|touchevents`) | the script | **0 px in every presented frame in which the page moved (11 frames for the mouse gesture, 21 for raw touch events)**. **Headless did not scroll on the compositor during the block**: 1 frame was presented inside the 400 ms window, the first page move is 455 ms (mouse) / 492 ms (touch events) after the block started, and the trace has 0 `ScrollTree::ScrollBy` events off the main thread inside it; `Input.synthesizeScrollGesture` with `touch` does not scroll at all in this shell. The harness stays as the regression guard; it cannot separate F1 from F4 here |
| D1-4 | `shiftTarget` on the bar | `item-scroll.spec.ts` (counts exact), `d1-scroll.mts` | elements styled **25,616 -> 1,417** in the 2 s scroll (average 281 -> **15.6** per recalc, max 523 -> **117**); 1024: 1,422 |
| D1-5 | same | same | style recalc **78 -> 16.7 ms (1x)**, **305 -> 62.7 ms (4x)**; 1024: 15.9 / 62.3 ms |
| D1-6 | none | `d1-scroll.mts`, `table-scroll.spec.ts` | detail 4x: 2 dropped frames, 0 long tasks (was 2, 1); table 4x (no trace) **42** (was 44) / +2 frozen **43** (was 47); drag +2 frozen 4x **12** dropped, 6 long tasks (same); 1x: 0 dropped, 1 long task. With the trace on (it costs frames) 49 / 59 against 45 / 46 before |
| D1-7 | none | `table-scroll.spec.ts` (A5, A6, A4, A2 kept) | perf6 A-criteria hold (spec green) |
| D1-8 | none | `item-scroll.spec.ts`, `d1-scroll.mts` | sticky elements = pinned cells **66 = 66** and **110 = 110**; compositor layers **122 / 194** (<= 200) |

### D2 (the name of a key is always whole)

All D2 counts measured by `d2-keys.mts` on the production build: **201 key rows in 30 cases, every count 0**: ellipsis, clipped text, key over value, key under actions, value over actions, key box 0 px, gap under 8 px, key past its row
(`after/d2-keys-baseline.json`; was 4 to 13 truncated rows per case, 9 zero-width keys, 27 to 29 px overlaps, 416 px past the row).

| ID | Change | Test | Notes |
|---|---|---|---|
| D2-1, D2-2, D2-3, D2-9 | `KeyTree` / `StructuredValue` sections: `.key` wraps (`overflow-wrap: anywhere`, `white-space: normal`), no 28ch cap, no ellipsis; head = [toggle \| actions] flex line | `redesign7-keys.spec.ts` (6 cases x 3 widths x every key row), `keyTree.parts.test.tsx`, design test ("never truncates ... a data key") | 0 / 0 / 0 / 0 |
| D2-4, D2-5 | `.line` flex-wrap: the preview follows the key's last line (8 px gap) or starts the next | same | gap 8 px in every same-line row (was 6); at 390 a key of 30+ characters puts its preview below |
| D2-6, D2-7, D2-8 | toggle `flex: 1 1 auto`, actions `flex: none; margin-inline-start: auto` | same | 1 / 1 / 1 lines at 1440 and 1024 for 10 / 40 / 80 characters; 1 / 2 / 3 at 390; rows 32 px; actions below the name only when the name needs the whole line (amended in `qa.md`) |
| D2-10, D2-11 | `.fact` `fit-content(40%) / minmax(0, 1fr)`, `dt` wraps; eyebrow wraps | same, `MetricStrip.facts.test.tsx` | facts key column 1 / 2 / 4 lines at 1440 and 1024, stacked at 390 (1 / 2 / 3); eyebrow above its text, 0 ellipsis |
| D2-12 | `textDirAttrs(key)` on the key element (`dir=rtl lang=ar` for Arabic), row stays `direction: ltr`, `unicode-bidi: isolate` | same | Arabic keys whole, at the inline start (<= 14 px from the chevron) |
| D2-13 | a Tag is `[data-part=key]: [data-part=value]` as two isolated spans in one wrapping run | `redesign7-keys.spec.ts` (3 widths) | key before value, inside its row (was reversed: x 1116 / 1083) |
| D2-14 | `.fact dt`, `.eyebrow`, `.key`, `FieldRow .label` rules | `design-language.test.ts` | pinned; DESIGN_LANGUAGE "Item details" and the round 5 note carry the reversal |
| **D2-15** | `text-transform: none` on data keys; fact keys raw | `redesign7-keys.spec.ts`, `measure/d2-exact.mts` | **0 mismatches** in 35 + 19 keys (j-01, j-03) at 1440 and 390 (`after/d2-exact.json`) |

## 4. Amendments, limitations, follow-ups

Amendments (each with its reason, applied in `qa.md` and asserted on the same number): Q2-3 (340 ms), Q2-5 (500 ms), D2-6, D2-7, D2-8, D2-10 (decision 2), D1-3, D3-2 probe, round 5 R3-14 (1,540 px), and the Q1-3 e2e floor.
The Q1-3 e2e asserts a floor of 6.3 (the `--text-muted` minimum) for metric values because the e2e fixture's values are tone-coloured; the spec's 11.2 is the neutral band, measured on the designer's page: 11.2.

Limitations:
1. **The lag the owner feels is not reproduced and not proven fixed.** What shipped removes the measured cost (25,616 -> 1,417 elements styled per 2 s scroll, 78 -> 16.7 ms) and the 1 px offset of the bar in composited frames; the structural cause (a JS-written bar behind a compositor scroll) remains, because native sticky is impossible here. F4 (`animation-timeline: scroll()` on `#shell-content`, range computed on layout change, F1 as fallback) is the next step and cannot be validated in headless Chromium (D1-3b above). Open question O1 stands: which device and browser.
2. D1-3 and D1-3b are measured by the script (`measure/d1-bar-jank.mts`), not asserted by Playwright; `item-scroll.spec.ts` asserts D1-1, D1-2, D1-4, D1-5, D1-8 on the DOM and the trace.
3. `ItemCard.test.tsx` (spec D1.4) is replaced by `stickyShiftTarget.test.tsx` (the hook writes the shift on the target only) plus the e2e assertion that the article has no `--head-shift` and the bar has one: rendering `ItemCard` needs the whole run context.
4. The prefetch costs server CPU on every list view: 17 repeat runs on the seeded page are about 1.2 s of handler CPU. A click waits for the prefetch requests already in flight (up to four), hence 460 ms and not 439 ms for the cold 10 x 1,200 run. The per-pass precomputation of Q2.7 remains the follow-up.
5. `redesign5-shots.spec.ts` and `redesign5-spacing-trace.spec.ts` ran only inside the full run (see the gate); `redesign5/shots` was restored if rewritten.
6. Pass rows with an accent rail (`.childRow`, open group) keep the rail on the physical left under `dir=rtl` (it always did); only the line is mirrored.

## 5. Gate

Everything heavy ran through `scripts/heavy.sh` (logs in the agent's scratchpad; none printed `waiting` for more than a minute). Servers were stopped after every check (`ss -ltnp` on 8972 / 5972 / 9072 / 9073 / 9972 empty at the end).

| Check | Command | Result |
|---|---|---|
| frontend check | `npm run check` (`--cost 3`): `tsc -b`, ESLint (`--max-warnings 0` over `src` and `e2e`), Stylelint, Vitest, design test | clean; **170 files / 1,437 tests passed**; design-language test **52 passed** |
| builds | `npm run build`, `npm run build:sdk` (`--cost 2`) | both built (7.2 s, 0.5 s) |
| design runner | `pytest tests/platform/test_design_language.py` | 1 passed |
| platform | `pytest tests/platform` in 4 chunks of 46 to 48 files (`--cost 4`, `-n 2`) | **2,788 passed**, 745 skipped (the PostgreSQL parametrisations); one failure under load, `test_force_stop_maintenance.py::test_maintenance_and_terminal_closure_coexist[True]` (a stream thread still alive at its assertion; the file is untouched by this round): re-run alone, **2 passed** |
| sdk | `pytest tests/sdk` (`--cost 3`) | 496 passed, 4 skipped |
| Playwright `e2e/perf` | `--cost 3` | **25 passed** |
| Playwright `e2e/runs-list` | `--cost 3` | **226 passed** (also green before the queue fix: 226) |
| Playwright `e2e/run-detail` | `--cost 3` | 408 passed, 9 skipped, 1 failed: `redesign3-header.spec.ts` P6-8/P6-9 (`apiResponse.json: Response has been disposed`, a route-fetch race in the spec); re-run alone with the two specs below: passed |
| Playwright `e2e/visual-language` | `--cost 3` | 69 passed, 1 skipped, 2 failed under load: `contrast.spec.ts` gallery axe at 390 (30 s timeout) and `final-polish.spec.ts` "one card recipe" (latency tile not found in 8 s); re-run alone: **26 passed** with the previous spec |
| full e2e | `npm run e2e` (`--cost 4`, once) | **1,355 passed**, 21 skipped, 1 failed: `frozen-static.spec.ts` "every table of the /__ui gallery" hit its 120 s timeout under the full run's load (it probes every pinned gallery table with about 100 wheel events each, the gallery carries the round 7 mocks); alone it passes in **1.7 min** |
| sdk viewer | `npm run e2e:sdk` (`--cost 3`) | **42 passed** |

The two folder runs and the full run also executed `redesign5-shots.spec.ts` / `redesign5-spacing-trace.spec.ts` (the `e2e/run-detail` folder run included them), which rewrote five curated PNGs of `redesign5/shots`; they were restored with `git checkout -- docs/internal/ui-migration/redesign5/shots` and nothing of them is committed.
The three load failures above are timeouts or a harness race, each green on a re-run alone; none touches code changed by this round.


## 8. Review fix pass (`review-qa.md`: MEETS WITH FIXES)

| Finding | Outcome | Numbers |
|---|---|---|
| R2, Q1-8 rail | Cause: `.rail` was a shrinkable flex item of the height-capped card, so with 50 rows it was squeezed. `flex: none`. Asserted on a 50-row page at 1440 and 1024 (fails without the fix: 7.4 px on the dev fixture) | 5.6 / 5.3 px -> **12 px** (+- 0.5) at every row count; commit `3b8612e1` |
| R1, Q2-3 | `test_run_passes_statements.py` asserts the median of 9 at 10x300 and 10x1,200 (80 / 340 ms strict under `QYM_PERF_STRICT=1`, 4x CI margin otherwise: this in-memory ingest-built fixture measured 200 / 850 ms on the loaded machine against 67 / 316 ms on the production seed), statements equal and <= 28 kept (16 on the fixture) | 4 tests pass; commit `4dc80983` |
| R1, Q2-5 | 10x1,200 case in `runs-passes-load.spec.ts`: `limit(3000, 500)`, exactly 2 requests, `view=group` | passes (48 s incl. the 60k-event seed); commit `4dc80983` |
| R1, D1-3 / D1-3b | `qa.md` section 9 and the criterion rows say they are script-measured guards (`d1-bar-jank.mts`), with the reason; the "56 px with overflow: visible" is dropped from the D1 amendment row | docs, commit `2f247ea8` |
| O2, word breaks | `lib/keyBreaks.tsx` (`<wbr>` after `_ - .`, before a camelCase capital) in the tree key, sections key, fact `dt`, Tag key; `anywhere` stays the fallback; Arabic keys `text-align: left`. Vitest `keyBreaks.test.tsx` (textContent unchanged) | production `d2-keys.mts`: **201 rows, 0 violations** of D2-1 to D2-13; `d2-exact.mts` **0 mismatches** in 35 + 19 + 35 + 19 keys. Line counts: tree 80-character keys at 390 **4 lines (was 3)**, depth-3 45 / 57 / 60-character keys 4 (were 3, 3, 4); everything else unchanged. `qa.md` D2-6 amended |

Gate for this pass (`/home/meshari-aldossari/Documents/qym/qym/scripts/heavy.sh`, never printed `waiting`): `npm run check` clean, **171 files / 1,439 Vitest tests**, design test 52; both pytest files **10 passed**, 5 skipped; `e2e/perf` 25 passed + 1 failed (`run-sections.spec.ts`, a `view=summary` request count of 3 against <= 2 in a dev-server run; green on re-run alone, 3 passed); `e2e/runs-list` **228 passed**; `e2e/run-detail` **409 passed**, 9 skipped; `npm run build` ok. `redesign5/shots` was rewritten by the run-detail folder run and restored (nothing committed). No servers left (`ss -ltnp` empty on 8972, 5972, 9072, 9073, 9972).
