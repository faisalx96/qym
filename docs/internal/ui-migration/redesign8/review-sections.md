# Round 8b review: framed sections (recipe A, owner decision H6)

Reviewer: independent review agent. Branch `ui/redesign8b-review` at implementation tip `ebd9fa7b`, parent `3dd214c3`.
Method: Chromium, dark theme, production build served by the platform (8983; parent build on 9084 over a copy of the same
database), seeds `seedCompareScenario` (4 runs) and `seedAll` repeat run (`rd-seed`). Reviewer scripts (not committed) read computed
styles and boxes at 1440x900, 1024 and 390; the design's `sections/measure/boundaries()` was re-used for the "gap" definition
(previous last painted pixel to next title top). Reviews, Datasets and Root cause sections do not exist in either seed: they use
the same primitive and are not measured (stated, not assumed).

## Verdict: MEETS WITH FIXES

C-sec criteria: 12. MET 11, MET WITH FIXES 1 (C-sec-5), NOT MET 0. Two real 390 px defects (a control and the run Overview chart
cards leave the panel's padding), plus documentation fixes. Nothing blocks the merge of the panel recipe itself.

## 1. Criteria (measured, each value identical on the listed pages)

"cmp" = compare (6 sections), "run" = run detail Repeat seed (7 sections). 1440 / 1024 / 390 give the same number unless stated.

| Id | Required | Measured | Verdict |
|---|---|---|---|
| C-sec-1 | every top-level section is `section[data-report-section]` through `ReportSection`, `data-part` section (compare `section-<key>`), head `section-head` first child, h2 title | cmp 6/6 and run 7/7 (incl. `run-items`) at all widths: tag SECTION, h2, head first child, parts `section-runs..section-items` / `section` | MET |
| C-sec-2 | title 18/650; description muted, <= 2 lines at >= 1024 (1 at 1440), wraps at 390, no ellipsis | title `18px/650` on 13/13 sections at 3 widths; description P, `text-overflow: clip`; lines at 1440 = 1 everywhere; at 1024 max 2 (compare averages, overview); at 390 max 3 (wraps). Description size 11 px (`--font-sm`), the amendment (section 3) | MET (amendment accepted) |
| C-sec-3 | same numbers at all widths, tolerance 1, no lead-in on the first | first section margin 0 px on both pages; edge gap 20.00 and gap 50 at every boundary (cmp 5, run 6) at 1440, 1024, 390 | MET |
| C-sec-4 | C-page-1 unamended; C-nav-2 and scroll-spy | cards one row, bottom 510.75 (<= 530); Averages table bottom 899.83 (<= 900); nav jump: section top 9.6 to 10.1 under the nav (12 +-4), title 24.6 to 25.1; `aria-current` follows every link; r8-page C-page-1, C-nav-2, scroll-spy pass in the browser gate | MET |
| C-sec-5 | no horizontal scroll at 390, no nested card | shell `scrollWidth == clientWidth` (319) and document 390 == 390 on both pages at all widths; nested-card scan (surface fill + visible outline inside a body): `[]` on all 6 page/width pairs. BUT at 390 two things leave the panel's padding (section 2.1) | MET WITH FIXES |
| C-sec-6 | hue budget unchanged, neutral tokens only | panel fill = `--bg-surface` (channel spread 14), border = `--border-subtle` (21), inset = `--bg-elevated` (16): all neutral; no new hue; computed colours equal the token values | MET |
| C-sec-A1 | fill `--bg-surface`, 1px `--border-subtle`, radius 8, padding 14x4, width = column | 13/13 panels at 3 widths: fill true, `1px` x4, subtle true, `8px`, `14px` x4, width == column (+-1) | MET |
| C-sec-A2 | edge gap 20 +-1; gap 50 +-2 | 20.00 / 50 at every boundary of both pages and widths | MET |
| C-sec-A3 | head first child, no border, 14 to body, no `section-rule` | head border `0px`, head-to-body 14, `section-rule` count 0, head first on 13/13 | MET |
| C-sec-A4 | cards inside a body are `--bg-elevated` with transparent border; none surface-with-visible-border | nested scan empty; inset-fill elements per section 0 to 32 (errors at 390 on run has no card: 0); r8b e2e `fillAndEdge` on run card, averages, item row | MET |
| C-sec-A5 | four run cards in one row at 1440 (bottom <= 530); reflow at 1024 and 390 | 1 row, bottom 510.75; at 1024 and 390 the run cards stay inside the 14 px padding (e2e) | MET |
| C-sec-A6 | Averages table bottom <= 900 at 1440x900 | 899.83 (0.17 px slack, same as the implementer) | MET |

### 1.1 Page-level numbers (gap / edge gap / head height), for the record

| Page | width | gap | edge gap | head heights (px) |
|---|---|---|---|---|
| compare | 1440 | 50 | 20 | 42 each |
| compare | 1024 | 50 | 20 | 42, 57, 57, 76, 42, 42 |
| compare | 390 | 50 | 20 | 65, 105, 137, 157, 57, 65 |
| run | 1440 | 50 | 20 | 42 each |
| run | 1024 | 50 | 20 | 86 (overview), then 42 |
| run | 390 | 50 | 20 | 136, 42, 57, 42, 57, 57, 89 |

Page heights (shell scrollHeight): compare 3983 / 4567 / 8632, run 5469 / 6361 / 10756 at 1440 / 1024 / 390.

### 2.1 Defects found (C-sec-5, required fixes)

1. **Compare, Averages head, 390**: the Baseline `Select` (`_inlineLabel` + `_field` + trigger) ends at x = 367 while the panel's right edge
   is x = 355: the control pokes 12 px out of the frame (26 px past the content box). Shot: `sections/shots/review-sections-defect-compare-averages-390.png`.
   The shell does not scroll, so no e2e sees it. The spec's own rule (A1: content inside a 14 px padding) is broken.
2. **Run detail, Overview, 390**: the four chart cards (`section._card._chartCard`) are 260 px wide in a 249 px content box:
   left 15 px from the panel edge, right 4 px (asymmetric, 11 px into the right padding). Shot: `review-sections-defect-run-overview-390.png`.
   A third, smaller case: the Latency step name column puts a span 9 px from the panel's right edge at 390 and 1440 (`SPAN` at R9).
   The existing `r8b-sections` run spec checks `noSideways` and nested cards only, never that content stays inside the padding.

## 2. Round-8 re-measurements

| Criterion | Required | Measured | |
|---|---|---|---|
| C-page-1 | cards bottom <= 530, table bottom <= 900 (1440x900) | 510.75 / 899.83 (parent tip: 509.75 / 876.83) | MEETS |
| C-nav-2 + scroll-spy | section top 12 +-4 under the nav | 9.6 to 10.1 for Runs, Averages, Overview, Categories, Errors (parent 9.6 to 10.1); `aria-current` correct; browser gate `r8-page` green | MEETS |
| C-page-3 | no horizontal scroll at 390, both pages | shell and document equal widths (section 1, C-sec-5) | MEETS |
| C-page-4 | no ellipsis | compare: none at 1440 and 390; run: `Kind` and `Trace` table header labels truncate at 1440, identical on the parent tip (pre-existing, not a round-8 compare criterion) | MEETS |
| C-state-1 | loading frames at the loaded height | `r8-states.spec.ts` passes in the gate (run placeholder 254 at 390 after the amendment); not re-measured by hand | MEETS |

## 3. Amendment check (round-8 criteria changed by the panel)

The implementer's table (`sections-impl-notes.md`) gives old, new, a one-line reason ("owner decision H6, the panel takes 30 px of width and
16 px of height") and the spec file for 15 rows. Each changed e2e number carries an inline comment. Judged against "the panel's cost and nothing looser":

- Within the cost (30 px narrower, +16 px per section): C-page-5 runs/averages/overview/items/categories at 1440 and 1024 (+13 to +17), C-avg-2/3 (254, 127, 150), C-cat-2, C-err-1 width, C-exp-3, C-ov-2, C-run-1, C-row-1/2, C-state-1. Accepted.
- Wrap consequences of the 30 px (accepted as the panel's cost, but they are large): errors 440 to 490 at 1440 (+50; the comment says "440 + 16 + 18" which is 474, so the arithmetic in the test and the notes disagree by 16), 620 to 708 with 8 runs (+88, "16 + 72" adds up), C-page-5 390 items ceiling 2200 to 2600 (+400, measured 2571), C-row-3 one line / 88 to two lines / 112, C-avg-3 head 62 to 80 and table 320 to 340, C-err-1 card 149 to 167 high.
- Looser than the cost: the C-avg-2 metric column keeps the value 144 and widens the tolerance from 2 to 5 while the notes say it is 140; the assertion hides the change instead of asserting 140 +-2. C-ov-6 (+10, measured 406) is within the cost.
- Documentation gap: `redesign8/compare.md` still carries the old numbers (C-run-1 287/380/277, C-avg-2 261/157, C-ov-6 <= 400, C-err-1 287 and 149, C-row-1 1194, C-row-3 one line / 76). Old and new numbers live only in `sections-impl-notes.md` and in the spec comments; the round-8 spec contradicts its own tests.

**C-sec-2 amendment (description `--font-sm`)**: the trade is right. The Averages table bottom is the first-screen promise (C-page-1, owner-visible) and
`--font-base` was measured at 905.05; the compare page already used 11 px; the run page loses 1 px of description size only. The design-language text
("one muted `--font-sm` description line") and `sections.md` C-sec-2 are consistent with the code. One inconsistency: `DESIGN_LANGUAGE.md` states
"48px from the last pixel of a body to the next title" while the spec says 50 +-2, the browser gives 50 (last painted pixel) and the e2e checks 49 +-3.

## 4. Pages outside the two report pages

Same database, 1440x900 and 390x900 dark, animations off, parent build vs round tip. Identical (same bytes): `/`, `/projects/cmp-r8/experiments`,
`/admin`, `/__ui` (the primitive gallery, which carries Card, StatStrip, DataTable, Select), `/profile` at both widths; `/feedback` at 1440; `/projects/cmp-r8/datasets` at 1440.
Differing pixels: runs list `/projects/cmp-r8` 78 px (1440) / 54 px (390), `/projects/rd-seed` 158 / 112, datasets at 390 5 px (max channel delta 1),
feedback at 390 19 px (delta 8). Every difference lies in a 7 to 359 px wide box, the bounding boxes of time-dependent cells (the runs list "x ago"
column at x 914 to 1273 and a 28 x 9 px cell), not at card edges: no card, table or control moved or changed fill. Result: pixel-unchanged apart from
relative-time text. `grep` of every CSS file under `src` for `--bg-*` / `--border-*` custom-property definitions outside `tokens.css`: none; components define only `--panel-bg`, `--card-bg`, `--card-edge`.

## 5. Pre-existing failures

- `redesign2-items.spec.ts:101` (JSON Raw view): on the parent tip `3dd214c3`, `--workers 1 --repeat-each 8`: 1 failed, 7 passed (the click on the `Sections` radio fails). Pre-existing flake, confirmed.
- `frozen-static.spec.ts:222` (every table of the `/__ui` gallery, 480 s budget): parent tip `3dd214c3` PASSED twice (7.8 min and 8.1 min wall, `--workers 1`); the round tip FAILED once (Test timeout of 480000 ms exceeded, 8.1 min) and a second round-tip run was killed (exit 143, SIGTERM under desktop memory pressure) so it gave no result. The implementer wrote "fails identically on 3dd214c3"; I could not reproduce that: on this machine the parent passed just under the cap. The test runs at 97 to 101 % of its budget, so a 4 % slowdown decides pass or fail; the round touches `DataTable` / `Card` CSS that the gallery renders, so a small real slowdown cannot be ruled out. Status: UNRESOLVED, treated as required fix 8 (the brief calls a failure only on the round tip a blocker; the evidence is 1 fail vs 2 passes, not conclusive).

## 6. The owner's reading: can a reader tell where one section ends and the next begins?

Yes, at every width, on both pages. Each section is a framed panel with a 20 px gap and the title inside; the previous section visibly closes, the next opens with its title.

| Page | 1440 | 1024 | 390 |
|---|---|---|---|
| compare | yes: panel edge, 20 px gutter, 50 px body-to-title (`review-sections-boundary-compare-1440.png`, `review-sections-compare-1440.png`) | yes (`review-sections-compare-1024.png`) | yes, but the Averages Baseline select breaks out of the frame (`review-sections-defect-compare-averages-390.png`) |
| run detail | yes (`review-sections-boundary-run-1440.png`, `review-sections-run-1440.png`) | yes (`review-sections-run-1024.png`) | yes, but the Overview chart cards sit 4 px from the right edge (`review-sections-defect-run-overview-390.png`) |

The frame is subtle (1.33:1 edge, 1.06:1 fill, as the spec records), the 20 px gutter and inner `--bg-elevated` cards carry the separation; it is clearly stronger than the old 28 px / hairline (compare) and 69 px / 1.37:1 rule (run).
First screen: `review-sections-first-screen-1440.png`.

## 7. Gate run by the reviewer

| Command | Result |
|---|---|
| `npm run build` (NODE_OPTIONS 3072, gate, cost 2) | exit 0 |
| `npx playwright test e2e/compare/r8b-sections.spec.ts e2e/compare/r8-page.spec.ts e2e/compare/r8-states.spec.ts e2e/run-detail/r8b-sections.spec.ts` (gate, cost 3) | 37 passed, 0 failed |
| `redesign2-items.spec.ts:101 --workers 1 --repeat-each 8` on `3dd214c3` | 7 passed, 1 failed |
| `frozen-static.spec.ts:222 --workers 1` | parent: pass, pass (7.8 / 8.1 min); round tip: fail (timeout 8.1 min), second run killed (143) |

The implementer's other counts (check, build:sdk, 228 compare, 462 run-detail, 28 and 81 visual-language) were not re-run.
Servers started by the reviewer (platform 8983, base platform 9084, Playwright webServers) are stopped; the throwaway worktree `../qym-wt-redesign8b-base` is removed.

## 8. Required fixes (before the merge)

1. Compare Averages head at 390: make the Baseline select fit the panel's content box (no part of it past x = panel right - 14).
2. Run Overview chart cards at 390: fit the 249 px content box (they are 260); also the Latency step span at R9.
3. Add an e2e on both pages that every non-scrolled descendant stays inside the panel padding at 390 (the current `noSideways` cannot see these).
4. C-avg-2 metric column: assert 140 +-2 (not 144 +-5).
5. C-page-5 errors at 1440: reconcile "440 + 16 + 18" with the asserted 490.
6. Carry the new numbers into `redesign8/compare.md` (or mark its numbers superseded by `sections-impl-notes.md`).
7. `DESIGN_LANGUAGE.md` "48px" to 50 (last painted pixel) or match the e2e (49).
8. `frozen-static.spec.ts:222`: it passed on the parent twice and timed out on the round tip once; split the gallery tables or raise its budget, then re-run it on the round tip to confirm it is not a slowdown (possible blocker if it still fails there).
