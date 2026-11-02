# Round 7 review: QA feedback (runs page edges and passes speed, run detail frozen bar, JSON keys, boundaries)

Reviewer: independent review agent, branch `ui/redesign7-review` from `ui/redesign7-qa` tip `edd8ddf8`. Contract: `qa.md` (52 criteria + D1-3b + D2-15), `impl-notes.md` (claims, verified here, not trusted).
Method: production build (`npm run build`), platform on SQLite 8973 seeded with `seed-r7.mts`, Playwright 1.64 Chromium headless shell, dark scheme, medians of 3 (5 for timings), the designer's scripts in `measure/` plus my own probes in `measure/review/` (`r7r-*.mts`). Raw outputs: `measure/review/*.json`. Machine: 15 GB shared, load average under 1 at measurement time, swap 3.4 of 4 GB used throughout (noted; timings were taken before the gate started).

## Verdict: MEETS WITH FIXES

Every numeric criterion is met on the production build except one (Q1-8, a spec number that was never true on the owner's page). Two things need fixing before merge (section 5, Required): amended numbers that no test asserts, and the Q1-8 rail number. One orchestrator decision was not delivered, with a reason I confirmed (D1: native `position: sticky`); the owner's first run-detail complaint is therefore "cost removed, structural cause remains, not proven fixed" (section 2, point 3).

| Section | Criteria | Met | Not met | Amended (accepted) | Notes |
|---|---|---|---|---|---|
| Q1 | 9 | 8 | 1 (Q1-8) | 0 | Q1-6, Q1-7, Q1-9 partly by green spec, see table |
| Q2 | 12 | 12 | 0 | 2 (Q2-3, Q2-5) | Q2-8, Q2-11, Q2-12 by Vitest/spec only |
| D1 | 8 + D1-3b | 9 | 0 | 1 (D1-3) | decision "native sticky" not delivered; D1-3b cannot discriminate |
| D2 | 15 | 15 | 0 | 4 (D2-6, D2-7, D2-8, D2-10) | D2-15 new |
| D3 | 9 | 9 | 0 | 1 (D3-2 probe) | |

## 1. The five owner points

### 1. Runs page: the actions line above the reliability metrics: MET
`review-runs-group-open-1440.png`, `review-runs-group-open-scrolled-1440.png`, `review-runs-group-open-1024.png`.
- No overlay exists: `[data-edge]` 0, `::before`/`::after` of `[data-cues]` computed `content: none`, 0 non-transparent gradient elements in the runs table (`r7r-cover-runs-*.json`).
- The strip statistics (5 labels + 5 values) are the topmost element at their own centre at rest, scrolled 600 px and scrolled to the end (script `r7r-strip.mts`: 10 of 10; the other 10 `dd` are visually hidden description text).
- The boundary is the pinned cells' own `rgb(82, 82, 108)` 1 px inset line on 52 (rest) to 62 (group open) cells per side; top = first header row top (0 px above), bottom = last row bottom (0 px, -0.4 px at 1024), only gap = the strip: **45 px at 1440, 56 px at 1024** (`edge-runs-*.json`). Contrast: strip labels 6.9, neutral metric values 11.2, header labels 5.7 (`q1-contrast.json`), against a baseline minimum of 1.1.
- In the screenshot nothing crosses "Reliability 87.5%" or the Pass@k values.

### 2. Runs page: loading the passes takes long: MET
`review-q2-loading-fast3g-1440.png`, `review-q2-loaded-fast3g-1440.png` (frame and result are the same height).
- Prefetched (list settled): click to rows and strip painted **57 / 59 ms** local (5 reps: 56 to 61), **57 ms** on Fast 3G, **0 requests** after the click (baseline 132 / 632 ms warm, 2.8 s cold).
- Not prefetched (click right after the list paints, server cold): **174 ms** (10 x 300), **469 ms** (10 x 1,200), Fast 3G 646 / 644 ms (baseline 2,805 / 11,225 ms local).
- Five groups in a row, prefetched: 55 to 71 ms each, 0 requests (baseline 10 requests, 11.5 s cold). Strip metric change: 37 ms median.
- Cost of this: 34 requests / 28.7 kB gzip per list view (17 repeat runs), at most 4 in flight, settled 2.30 to 2.46 s after the list locally (ceiling 2.5: tight), 5.16 s on Fast 3G (`q2-prefetch-*.json`). Changing the strip metric re-plans the queue and issues 17 `view=group` requests (see Optional O4).
- Server: `view=group` 10.2 ms (10 x 300) and 23.0 ms (10 x 1,200) first request (baseline 2,621 / 10,558 ms measured here), 0 rows added to `run_metric_analyses`, `group` equal in both views, default view **byte-identical** to `bc9f1555` (compared with `cmp` against the base package, both runs).

### 3. Run detail 1: the frozen input is laggy when scrolling down: COST REMOVED, STRUCTURAL CAUSE REMAINS, NOT PROVEN FIXED
`review-d1-item-bar-stuck-1440.png` (bar at y 149.997 on a 150 px line, shift written on the bar, `will-change: transform` while stuck, none on the article).
- Measured and fixed: elements styled in a 2 s scroll **25,616 -> 1,417** (average 15.6, max 117 per recalc), recalc time **78 -> 15.4 to 18.2 ms (1x), 301 -> 54 to 62.8 ms (4x)** (`d1-scroll-detail-*.json`).
- Not a positional lag in any frame headless can present: pinned cells 0 px, 0 frames over 1 px; bar 0 px in every stuck presented frame under touch drag with 50 ms of main-thread jank (1x and 4x), 3.55 px only in the entry frame and 4 to 30 px in the exit frames (the bar leaves with the item).
- Native `position: sticky` is impossible here, **confirmed**: the bar's ancestors are `div.scroller` (`overflow: auto/auto`, scrolls sideways only) and `div.bodyHost` (`overflow: hidden`), both between the bar and `#shell-content`. Making the bar sticky gives a median **1,020 px** (max 1,700 px) error against a CSS-sticky control (`r7r-d1-sticky-1440.json`, variant v1; implementer: 940 / 1,700). One implementer claim is not reproduced: forcing both ancestors `overflow: visible` gives **0 px**, not 56 px (v2, v3), but it breaks the table's own sideways scroll (`scrollWidth` 1,246 > `clientWidth` 1,191 stays scrollable only through those containers), so the conclusion stands and the "56 px" in `qa.md` section 9 should be dropped.
- D1-3b (400 ms block + one gesture): the bar is 0 px from the control in all 11 (mouse) and 21 (raw touch) presented frames in which the page moved, **but headless did not scroll on the compositor during the block**: 1 frame presented inside the window, first page move **462 to 495 ms** after the block started, 0 `ScrollTree::ScrollBy` off the main thread inside it. I also tried new headless (`PW_CHANNEL=chromium`), a scrollbar-thumb drag and a programmatic smooth scroll: same result in each (CDP input and the smooth-scroll ticks are gated on the main thread). The harness therefore cannot tell F1 from a compositor-driven bar and the owner's real-trackpad lag cannot be reproduced or refuted here.
- F4 is feasible: `ScrollTimeline` exists in this Chromium; a measurement-only prototype (Web Animations `ScrollTimeline` on `#shell-content`, translateY over the same cached range `[articleTop - line, + articleH - barH]`) tracks the CSS-sticky control with median 0 px (`r7r-d1-f4-1440.json`; the 9.55 px frames occur in both variants and are the setup jump). That it runs on the compositor could not be verified (no `Animation` trace entry for the transform). It needs `@supports (animation-timeline: scroll())` and keeps F1 as the fallback (Firefox). I judge it the only change that can address a scroll-linked lag; it is not required to meet the written criteria (Optional O1).

### 4. Run detail 2: key names overlap the content and must always be fully visible: MET
`review-d2-output-expanded-en-1440.png`, `review-d2-output-expanded-en-390.png`, `review-d2-output-expanded-ar-1440.png`, `review-d2-output-collapsed-en-1440.png`, `review-d2-panel-en-1440.png`, `review-d2-panel-en-390.png`, `review-d2-expected-en-390.png`.
- 201 key rows (3 widths x j-01 / j-03 x collapsed, open, Expected, facts, panel tree): ellipsis 0, clipped 0, key over value 0, key over actions 0, value over actions 0, key box 0 px 0, gap under 8 px 0, key past its row 0 (`d2-keys-baseline.json`; was 4 to 13 truncated rows per case, 9 zero-width keys, 27 to 29 px overlaps, 416 px past the row).
- 10 / 40 / 80 character keys: tree 1 / 1 / 1 lines at 1440 and 1024, 1 / 2 / 3 at 390; sections 1 / 1 / 1 and 1 / 2 / 3; facts 1 / 2 / 4 at 1440 and 1024, stacked 1 / 2 / 3 at 390; the 60-character depth-3 key takes 4 lines at 390 (118 px). Open rows: 22 x 32 px at 1440, 20 x 32 + 2 x 64 at 1024.
- Arabic keys are whole and read from their beginning at the left; every key's rendered text equals its source (D2-15: 0 mismatches in 35 + 19 + 35 + 19 keys at 1440 and 390).
- Judgment of the amendment that facts show the key as written: it answers the owner's "the name should always be fully visible" and matches the tree beside it, so I accept it, but it reads rougher than round 5's panel: `self_consistency_check_result_across_rescored_samples` wraps mid-word in a 40% column (`review-d2-panel-en-1440.png`: "self_consistency_check_res / ult_across_rescored_sampl / es"). A key is never cut, but breaking inside a word costs scanning. Optional O2: allow breaks after `_` and before a capital (`<wbr>`), which changes nothing the criteria measure.

### 5. Run detail 3: table boundaries only inside the table: MET
`review-items-detail-open-1440.png`, `review-items-detail-open-scrolled-1440.png`, `review-items-detail-open-1024.png`.
- Items table, item #2 open, at rest, scrolled sideways 260 px, to the end, and with the page scrolled: 0 cue elements, 0 `[data-edge]` (nested matrix included), the pinned line stops at the item (gap **576 px** = the detail row, spec 575 +- 1) and resumes below; line top = first header row (0.1 px), bottom = last row (0.2 px) (`edge-items-*.json`).
- `elementsFromPoint` at the pinned boundary x, 5 y samples x 2 x inside the open item: 0 pinned-edge cells, 0 non-transparent gradients; 1.5 px outside the card at 20 y samples on both sides: 0 table elements (`r7r-cover-items-*.json`). Toolbar and footer overlap 0 px. Sticky header and item bar guards (`d3-header-*.json`) are identical to the baseline.
- My independent glyph probe (every text node, `elementFromPoint`) finds only legitimate stackings: opaque pinned cells, the sticky header, the item bar, the page chrome, the mirrored rail, and a visually hidden label; no table line or shade over any glyph.

## 2. Criterion tables

"Claimed" is the implementer's number (`impl-notes.md`); "mine" is measured here unless marked.

### Q1
| ID | Spec | Claimed | Mine | Verdict |
|---|---|---|---|---|
| Q1-1 | no `[data-edge]`, no cue pseudo | 0 | 0 at 1440, 1024; 390 renders none; pseudo `content: none` | MEETS |
| Q1-2 | 0 px under a shade | 0 | 0 (designer probe) and 0 table overlays (independent probe, rest / group open / 600 / end, 1440 and 1024); strip stats own at 3 scroll states | MEETS |
| Q1-3 | 6.9 / 11.2 / 5.7 | same | 6.9 / 11.2 / 5.7 | MEETS |
| Q1-4 | one `--border-strong` line per pinned-edge cell | `rgb(82,82,108)` | `rgb(82, 82, 108)` on 52 to 62 cells per side; the group-band cell also keeps its underline, rail rows compose rail + line | MEETS |
| Q1-5 | 0 above, 0 below, gaps 45 / 56 | same | 0 / 0 (-0.4 at 1024) / 45 / 56, toolbar and footer 0 | MEETS |
| Q1-6 | 390: no pin, no cue, no sideways scroll | 0 | `lines` null, 0 cues; `scrollWidth == innerWidth` by green spec only | MEETS |
| Q1-7 | same shadow at any scrollLeft, 0 transitions | 0 | same computed shadow at 0 / 600 / end (probe); `transitionstart` count by green perf and runs-list specs only | MEETS |
| Q1-8 | rail 12 px while overflowing | 11.4 to 12 | **5.6 px (1440) and 5.3 px (1024)** computed height on the 50-row runs page, identical to the baseline; 12 only with few rows (`measure/review/r7r-rail.json`) | DOES NOT MEET as written |
| Q1-9 | RTL line on the physical left | spec | `redesign7-edges` RTL case green; not measured by me | MEETS (spec) |

### Q2
| ID | Spec | Claimed | Mine | Verdict |
|---|---|---|---|---|
| Q2-1 | <= 60 / 25 ms, 7 keys, <= 700 B, 0 rows, equal `group` | 22.0 / 8.7 ms, 384 / 381 B | 23.0 / 10.2 ms, 384 / 381 B, 0 rows, equal | MEETS |
| Q2-2 | default view unchanged, cached <= 15 ms | unchanged; 12.3 (300) / 27.5 (1,200) | byte-identical to `bc9f1555`; repeat 11.2 ms (300), 32.1 ms (1,200: pre-existing path, the ceiling was written for 300) | MEETS |
| Q2-3 | <= 340 / 80 ms, statements equal and <= 28 (amended) | 316.3 / 67.1, 28 / 28 | 329.3 / 71.0, 28 / 28 | MEETS (margin 11 ms) |
| Q2-4 | <= 80 ms, 0 requests, local and Fast 3G | 57 / 63 ms | 57 to 59 ms local, 57 ms Fast 3G, 0 requests | MEETS |
| Q2-5 | <= 500 (amended) / 250 ms local, <= 1,000 Fast 3G, 2 requests | 460 / 201; 646 / 659 | 469 / 174 ms; 644 / 646 ms; the 2-request assertion by green spec | MEETS |
| Q2-6 | 0 requests after the first click, each <= 80 ms | <= 65 ms | 55 to 71 ms, 0 requests | MEETS |
| Q2-7 | first request <= 600 ms after the list, <= 4 in flight, <= 34 requests, <= 30 kB, settled <= 2.5 s / 8 s | 181 ms; 34; 28.7 kB; 2.24 / 5.16 s | 93 to 117 ms; 4; 34; 28.7 kB; 2.30 to 2.46 s local (3 runs), 5.16 s Fast 3G; list requests 3 | MEETS (local settle is within 40 ms of its ceiling) |
| Q2-8 | exclusions | Vitest | `prefetch.test.ts` and specs green; not measured by me | MEETS (spec) |
| Q2-9 | placeholders = `min(samples, 20)`, 0 +- 1 px shift, strip 45 / 56 px | 0 px | 2023 = 2023 (1440), 2034.39 = 2034.39 (1024); strip 45 / 56.39 loaded = skeleton; 19 passes by spec only | MEETS |
| Q2-10 | <= 100 ms after a metric change | request 4 to 17 ms | 37 ms median (31 to 42) | MEETS |
| Q2-11 | error paths as before | green | `passes-rows` Q21 / Q22 green | MEETS (spec) |
| Q2-12 | run page keeps the default view | green | `redesign3-repeat` green, `group` equal | MEETS |

### D1
| ID | Spec | Claimed | Mine | Verdict |
|---|---|---|---|---|
| D1-1 | pinned cells 0 px, 0 frames | 0 | 0 px, 0 frames over 1 px (1x and 4x, wheel and drag, +2 frozen) | MEETS |
| D1-2 | bar <= 1 px; <= 4 px entry / exit | 3.55 / 0.22 | 3.55 px (1440), 0.22 px (1024), 2 frames over 1 px | MEETS |
| D1-3 | bar = control <= 1 px, touch, 50 ms block, 1x / 4x (amended: 0) | 0 px in 47 to 50 frames | median 0, p95 4; 3 to 5 exit frames over 1 px (4 px, and one 29 to 30 px frame as the bar leaves) in 12 reps | MEETS |
| D1-3b | bar = control in every moved frame; state whether the compositor scrolled | 0 px; did not scroll | 0 px in 10 to 21 moved frames; compositor did not scroll in the block (see owner point 3); harness cannot discriminate F1 from F4 | MEETS (non-discriminating) |
| D1-4 | <= 20 avg, <= 150 max, <= 2,000 total | 1,417 / 15.6 / 117 | 1,417 / 15.6 / 117 (1024: 1,422) | MEETS |
| D1-5 | <= 20 ms 1x, <= 70 ms 4x | 16.7 / 62.7 | 15.4 to 18.2 / 54 to 62.8 | MEETS |
| D1-6 | table 4x <= 47, +2 <= 50, detail <= 2, drag <= 12; long <= 16 / 1 / 6; 1x 0 / <= 1 | 42 / 43 / 2 / 12; 15 / 0 / 6 | 39 / 45 / 2 / 12; 15 / 0 to 1 / 6; 1x 0 dropped, 1 long task (trace on: 49 for +2) | MEETS (drag at the ceiling) |
| D1-7 | perf6 A-criteria | spec green | `e2e/perf` 25 passed | MEETS |
| D1-8 | sticky = pinned cells, layers <= 200 | 66 = 66, 110 = 110; 122 / 194 | 66 = 66, 110 = 110; 122 / 194; Paint events 2,163 / 2,951 identical to baseline; "0 paints in unchanged frames" clause not measured | MEETS |

### D2
| ID | Spec | Claimed | Mine | Verdict |
|---|---|---|---|---|
| D2-1 | 0 ellipsis / clipped | 0 | 0 over 201 rows | MEETS |
| D2-2 | 0 key boxes of 0 px | 0 | 0 | MEETS |
| D2-3 | 0 px overlap | 0 | 0 | MEETS |
| D2-4 | gap >= 8 px; Arabic within 14 px | 8 px | every same-line tree row 8 to 18 px; facts rows 78 / 114 px are the fixed 120 px key column, not a gap defect | MEETS |
| D2-5 | preview below a long key at 390 | yes | `valueBelowKey` true for keys of 30+ characters at 390 (screenshot) | MEETS |
| D2-6 | line counts (amended) | 1 / 1 / 1; 1 / 2 / 3; facts 1 / 2 / 4 and 1 / 2 / 3; 60-char depth-3: 4 | identical (section 1, point 4) | MEETS |
| D2-7 | 32 +- 1 px (Arabic 34, amended); wrapped `lines x 18 + 14` | 32 px | 22 x 32 px at 1440; Arabic 34 and wrapped rows by green `redesign7-keys` spec | MEETS |
| D2-8 | actions wrap only when needed (amended) | as amended | 1440: 0 rows with actions below; 1024: 2 rows of 64 px (57 and 80 characters); 390: 6 rows of 64 px | MEETS |
| D2-9 | 0 keys past their row | 0 | 0 | MEETS |
| D2-10 | `fit-content(40%)`, key as written, side by side >= 420 px | as amended | holds; dd left >= dt right + 12 by spec; 0 ellipsis | MEETS |
| D2-11 | eyebrow wraps, 2 px above text | green | `redesign7-keys` green; eyebrow shows `REASONING` | MEETS (spec) |
| D2-12 | Arabic keys whole, at the inline start | green | screenshot and 0 clipped | MEETS |
| D2-13 | Tag key before value, inside its row | green | `redesign7-keys` (3 widths) green | MEETS (spec) |
| D2-14 | no ellipsis / nowrap on key rules, docs | design test | `test_design_language.py` 1 passed | MEETS |
| D2-15 | 0 mismatches rendered vs source | 0 of 54 | 0 of 35 + 19 + 35 + 19; `text-transform` none on all | MEETS |

### D3
| ID | Spec | Claimed | Mine | Verdict |
|---|---|---|---|---|
| D3-1 | Q1 rules on the items table in 4 states, 1440 / 1024 | 0 | 0 cues, 0 overlays, line `rgb(82, 82, 108)` | MEETS |
| D3-2 | gap = open item 575 +- 1, nothing taller than rows | 576 | 576 px (1440 and 1024), `[data-edge]` 0 | MEETS |
| D3-3 | no cell / gradient on the boundary inside the item | 0 | 0 / 0 (10 samples per state) | MEETS |
| D3-4 | 0 `[data-edge]`, nested included | 0 | 0 | MEETS |
| D3-5 | sticky header 0 above the line, 0 past the card | = baseline | identical JSON to the baseline (header right of the scroller 204.5 / 620.5 px is clipped by the scroller, as the spec says) | MEETS |
| D3-6 | bar 0 px past the card | 0 | 0 / 0, top = line | MEETS |
| D3-7 | nothing of the table outside the card | 0 | 0 of 40 samples (20 y x 2 sides) | MEETS |
| D3-8 | every table that pins a column, rest and end, 1440 / 1024 | 18 routes green | 21 routes x 2 widths green (list below) | MEETS |
| D3-9 | docs and tests | present | design test and `redesign7-edges` green | MEETS |

D3-8 route sweep (`e2e/visual-language/table-edges.spec.ts`, tables found / with a pinned boundary, identical at 1440 and 1024): runs list 1/1, charts 3/0, run detail classic 3/1, run detail repeat (passes) 3/2, compare 2/2, experiments 1/1, queue 1/1, experiment detail 1/1, environments 1/1, **datasets 0/0**, dataset 1/1, settings members 1/1, API keys 2/2, LLM connections 1/1, settings environments 1/1, admin runs 2/2, admin projects 1/1, admin users 1/1, admin maintenance 1/1, profile 1/1, trash 1/1. The pin sweep also found, earlier, error-row rails replacing the line on the first pinned cell, fixed with `--pin-line` (verified: group-open and rail rows in `edge-runs-1024.json` carry rail + line).

## 3. Amendments (DESIGN_LANGUAGE section 6: measured value, reason in the spec, a test asserting the same number)

| Amendment | Measured here | Decision |
|---|---|---|
| Q2-3: `/passes` <= 340 ms (was 300) | 329.3 ms, 71.0 ms, endpoint untouched (the original 300 was below the 322 ms baseline) | **Accepted**, but no test asserts 340 / 80 on `/passes` (the test asserts statements and a per-1,000-item-passes time): Required R1 |
| Q2-5: cold 10 x 1,200 <= 500 ms (was 450) | 469 ms | **Accepted**; no test has a 1,200 case: Required R1 |
| D2-6 line counts | match exactly | **Accepted** (spec asserts them) |
| D2-7 Arabic 34 +- 1 | spec-asserted | **Accepted** |
| D2-8 toggle `flex: 1 1 auto` | 1440 0 rows below, 1024 2, 390 6 | **Accepted** |
| D2-10 facts show the key as written | rendered key = source | **Accepted** (section 1, point 4; Optional O2) |
| D1-3: 0 px / 4 px at exit | 0 px; exit frames 4 and 29 to 30 px | **Accepted**; script-only, no Playwright assertion: Required R1 |
| D3-2 probe excludes tables nested in the open item | independent probe agrees (nested lines are the nested tables' own) | **Accepted** |
| Round 5 R3-14 at 390: 1,540 px | spec asserts `<= 1540`; not measured by me | **Accepted** |

## 4. No-regression

| Area | Check | Result |
|---|---|---|
| Round 6 table scroll A1-A7, freeze A8, run load B1-B13 | `e2e/perf` | 25 passed; D1-6 / D1-7 numbers above |
| Round 4 passes rows (Q1-Q24: selection via passes, live refetch, delete) | `e2e/runs-list` | 226 passed |
| Round 3 P4 (sticky header and item bar), round 5 R3 (metric panel), key tree keyboard | `e2e/run-detail` | 397 passed, 2 failed under load, both pass alone (23 passed): `redesign2-items.spec.ts:101` ("Element is outside of the viewport" on a forced radio click) and `redesign3-header.spec.ts:196` (`apiResponse.json: Response has been disposed`, a route-fetch race; also reported by the implementer) |
| Visual language, DESIGN_LANGUAGE rules, contrast, final polish | `e2e/visual-language` | 71 passed, 1 skipped |
| SDK viewer (no pins, cards) | `npm run e2e:sdk` | 41 passed, 1 failed ("console errors or warnings" in `qa-fixes.spec.ts:140`), passes alone (9 passed) |
| Backend | `test_run_group_metrics_view`, `test_run_passes_statements`, six `test_repeat_*` files | 60 passed, 36 skipped (PostgreSQL) |
| Design test | `pytest tests/platform/test_design_language.py` | 1 passed |
| RTL, reduced motion | Arabic fixture screenshots; `redesign7-edges` RTL case; reduced-motion block of `DataTable.module.css` only lost removed rules | green specs; not measured separately |
| Card mode at 390 | `edge-runs-390.json`, `edge-items-390.json` | no pins, no cues |
| Table card chrome | toolbar / footer overlap | 0 px |

## 5. Findings

### Required
- **R1. Amended numbers without a test on the same number** (`qa.md` section 9 vs DESIGN_LANGUAGE section 6). Q2-3 (340 / 80 ms for 10 x 1,200 / 10 x 300) is not asserted by `tests/platform/test_run_passes_statements.py` (statements and a per-1,000-item-passes time only); Q2-5 (500 ms at 10 x 1,200) is not asserted by `e2e/perf/runs-passes-load.spec.ts` (300-item case only, `limit(2500, 250)`); D1-3 (0 px) is script-only. Fix: add the 1,200-item case at 500 ms (CI margin, strict under `QYM_PERF_STRICT=1`) and a 10 x 300 / 10 x 1,200 timing at 340 / 80 ms to the statements test, and either assert D1-3 from `item-scroll.spec.ts` or state in `qa.md` that D1-3 and D1-3b are script-measured guards.
- **R2. Q1-8 says 12 px, the page has 5.6 px.** `[data-testid=table-scroll-rail]` on the seeded 50-row runs page: computed height 5.625 px at 1440 and 5.25 px at 1024 (identical to the baseline; 12 px only when the table has few rows). The rail is the only overflow cue left after the cues were deleted, so spec and product must agree: amend Q1-8 with the measured number and reason and assert it on the 50-row page, or make the rail 12 px as the spec argued. Also drop the unreproduced "56 px" from the D1 amendment row.

### Optional
- **O1. F4 (compositor-driven bar).** Feasible (prototype above, 0 px median); the structural cause of any trackpad lag stays until it is built, with F1 as fallback; needs the owner's device (open question O1 in `qa.md`) because headless cannot validate it.
- **O2. Wrap long keys at name boundaries.** Facts column at 1440 (`review-d2-panel-en-1440.png`): `self_consistency_check_res / ult_...`; insert `<wbr>` after `_` and before a capital in tree, section and fact keys.
- **O3. The prose eyebrow humanises and uppercases a key** (`reasoning` -> `REASONING`, `self_check_reasoning` -> `SELF CHECK REASONING`) while every other key is exact; D2-15 carves it out. Decide whether a data key in an eyebrow should also be exact.
- **O4. A strip metric change re-plans the prefetch**: 17 `view=group` requests (about 10 to 23 ms of server time each) for one select change. Acceptable, but say so in the performance notes.
- **O5. Q2-7 local settle** is 2.30 to 2.46 s against 2.5 s: expect CI noise to cross it; consider the CI margin the spec uses elsewhere.
- **O6. Sweep coverage**: the datasets route finds 0 tables and charts 0 pinned; `ItemRunsTab`, `DeletedDatasetsPage` and `PresetsSection` named in the D3 places list are not visibly reached.
- **O7. Items table at 4x CPU still drops 39 to 45 frames of about 265** (baseline 44 to 47): F3 (attribute the Paint time to the windowed cells) was not delivered. Not a criterion failure.
- **O8. Two flaky specs under load** (`redesign2-items.spec.ts:101`, `qa-fixes.spec.ts:140`) are new to this tip's gate output or unreported by the implementer; each passes alone.

## 6. Gate on the tip (all through `scripts/heavy.sh`; the first visual-language run was killed by systemd-oomd after the old script lowered its cost, and was re-run with the fixed script at `--cost 3`)
| Check | Result |
|---|---|
| `e2e/perf` | 25 passed |
| `e2e/runs-list` | 226 passed |
| `e2e/run-detail` (all but `redesign5-shots` and `redesign5-spacing-trace`) | 397 passed, 2 failed under load; both files re-run alone: 23 passed |
| `e2e/visual-language` | 71 passed, 1 skipped |
| `npm run e2e:sdk` | 41 passed, 1 failed under load; `qa-fixes` alone 9 passed |
| backend subset | 60 passed, 36 skipped |
| `test_design_language.py` | 1 passed |
| Not run by me | `npm run check`, Vitest, `pytest tests/sdk`, `pytest tests/platform` in full, full `npm run e2e` (the orchestrator's gate on the merged tip) |

Slip to disclose: one `pkill -f` with a pattern unique to my own wait loop was issued once (it matched only my own shell); no other process was signalled, and servers were stopped by PID afterwards.

## 7. Files
Measurement outputs: `measure/review/*.json`; my probes: `measure/review/r7r-cover.mts` (independent glyph / stack probe), `r7r-d1-sticky.mts` (native sticky feasibility), `r7r-d1-f4.mts` (scroll-timeline prototype), `r7r-d1-smooth.mts` and `r7r-smooth-probe.mts` (compositor-scroll attempts), `r7r-shots.mts`, `r7r-q2-select.mts`, `r7r-rail.mts`, `r7r-strip.mts`, `r7r-grad.mts`. Screenshots: `shots/review-*.png` (17, each under 300 KB).

## 11. Re-review of the fix pass (tip `fbe7fe83`: commits `3b8612e1` rail, `4dc80983` tests, `2f247ea8` key word breaks, `fbe7fe83` notes; cherry-picked here)

Production build rebuilt through `heavy.sh --cost 2`, seeded DB restored, only the three items below measured. Raw output: `measure/review/r7r-rail.mts` re-run, `r7r-keyflush.mts`, `d2-keys` / `d2-exact` re-run (stdout), screenshots `shots/review2-d2-panel-en-1440.png`, `review2-d2-panel-en-390.png`, `review2-d2-output-ar-390.png`.

### R2 / Q1-8 (rail): RESOLVED
- `[data-testid=table-scroll-rail]` on the seeded 50-row runs page: computed and rect height **12 px at 1440 and 12 px at 1024** (was 5.6 / 5.3), `position: sticky`, offset height 12.
- `redesign7-edges.spec.ts`: the new `Q1-8 on the 50-row page` cases seed 50 rows (`seedProjectWithRuns({ count: 50 })`), expect `tbody tr[data-run-id]` count 50, `scrollOverflow` true and `abs(railHeight - 12) <= 0.5` at 1440 and 1024, and the in-state check was tightened from 1 to 0.5. The assertion is on the 50-row page.

### R1 (amended numbers asserted): PARTLY RESOLVED
- Q2-5 at 10 x 1,200: `runs-passes-load.spec.ts` has the new case (exactly `/passes` and `group-metrics ... view=group`, `limit(3000, 500)`). The file ran alone with `--workers 1`: **12 passed**; the new case also passes with `QYM_PERF_STRICT=1` (500 ms on the dev server). Asserted on the same element: yes.
- D1-3 / D1-3b: `qa.md` section 9 and the criteria table now say "script-measured guard, not a Playwright assertion", and the "56 px" claim is replaced by "not reproduced by the review (0 px)". Accepted. One stale sentence remains in section D1.4 ("D1-3 under `QYM_PERF_STRICT=1`"), cosmetic.
- Q2-3 (`/passes` 340 / 80 ms): `test_run_passes_statements.py` now has `test_passes_ceiling_at_the_seeded_sizes` (300 and 1,200 items, median of 9, statements equal and <= 28). Directly run: **4 passed** in default mode, where the ceilings are 4x (320 / 1,360 ms), so the amended 340 / 80 is **not** what is asserted by default. Under `QYM_PERF_STRICT=1` (340 / 80) it **fails here**: 209.4 ms (300) and 865.7 ms (1,200), because the in-memory ingest-built fixture is about 3x slower than the production seed, which on the same machine just now measured 67.6 / 324.5 ms (`passes_profile.py`, meets 80 / 340). So the number is asserted only in a mode that cannot pass on the test's own fixture. Remaining fix (small): calibrate the strict numbers to the fixture (for example about 250 / 950) and state that 340 / 80 is measured by `passes_profile.py` on the seed, or build the test on a fixture that matches the seed.

### O2 (keys break at their words): RESOLVED
- D2 re-run on the production build: 201 key rows, ellipsis 0, clipped 0, key over value 0, key over actions 0, value over actions 0, key box 0 px 0, gap under 8 px 0, key past row 0 (D2-1 to D2-13 unchanged at 0). D2-15: **0 mismatches** over 35 + 19 + 35 + 19 keys.
- Line counts: tree at 1440 / 1024 1 line for 10 / 40 / 80 and for the 45 / 57 / 60-character depth-3 keys; tree at 390: 10-char 1, 40-char 2, **80-char 4, depth-3 45 / 57 / 60-char 4** (matches the amended D2-6); sections at 390 40 / 80 chars 2 / 3; facts 1 / 2 / 4 at 1440 and 1024, 1 / 2 / 3 stacked at 390.
- Flush left (D2-12): every multi-line key, fact label and the wrapped Arabic keys (`تحليل_أهلية_...`, `استدعاء_الأداة_...`) have a line-left spread of 0 px and start 0 px from the box's left edge, in the tree, the facts and at 390.
- `self_consistency_check_result` (and the longer `..._across_rescored_samples`) now breaks at words: 1440 `self_consistency_check_ / result_across_rescored_ / samples` (3 lines), 390 `self_consistency_check_result_across_ / rescored_samples` (2 lines); `customer_eligibility_ / assessment_result_a`; `retrievedPolicyDocument / IdentifiersUsedTo` (`review2-d2-panel-en-1440.png`, `-390.png`). The mid-word breaks I reported are gone.

### Final verdict: MEETS WITH FIXES (one small item left)
R2 and O2 are resolved, Q2-5 and D1-3 are resolved; the only open item is the Q2-3 strict calibration above (a test-number fix, no product change). With it done this is MEETS.
