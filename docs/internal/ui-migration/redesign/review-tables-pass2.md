# Review: tables pass 2 (branch ui/redesign-tables-pass2 at aa95b121)

Scope: run-detail items table and compare item matrix on DataTable v2 (windowed above 200 rows, `scrollParent` = shell scroller),
ScoreBar colour/width, controlled group collapse, Charts cards at 390, trash cue. Reviewed on platform 8866 / Vite 5866 with a
240-item run, a 5,200-item run (98 error rows, 20 traced), a repeat run and the compare scenario (3 runs x 40 items, cohort URL).
Screenshots: `scratchpad/tables-p2/shots/`.

## Verdict: MEETS THE STANDARD WITH TWO MAJOR FOLLOW-UPS

The items table and the compare matrix are a clear step up and nothing was lost; performance is as claimed. But the two
deferrals are not acceptable as deferrals: with no sticky header, a reader who scrolls the run page or the compare page sees columns
of bars with no names (which metric is the third bar? which run is the second column?), and on a phone the compare matrix shows
only `#` and the question text, the scores are off screen with no cue. Both are small fixes (about 4 h together); fix before
this ships to the product owner.

## Evidence

| Check | Result |
|---|---|
| `npm run check` | PASS, 1148 Vitest, design-language 36 |
| `e2e/run-detail`, `e2e/compare`, `e2e/runs-list`, `e2e/shell` | 565 passed, 8 skipped, 0 failed (14.4 min); includes the formerly `test.fail` Back-scroll spec, now a normal passing test with an honest comment (`cutover-navigation.spec.ts:114`) |
| 5,200-item run, 500 rows per page | first item row 1.03 s after navigation, 9 rows mounted at first paint, 34 mounted while scrolling 18,000 px, total height 26,058 px; 300-frame scroll p50 16.7 ms, p95 19.7 ms, max 29 ms |
| `?item=item-0450` into the windowed page | card expanded and in the viewport at 1.7 s (`shots/deeplink.png`) |
| Keyboard walk (run items, 240 rows) | ArrowDown, End (item-0020), Home, PageDown (+10) move row focus; ArrowRight expands, ArrowLeft collapses; click on a row expands; Edit quality score opens the inline editor (`shots/edit.png`) |
| Sidebar open and closed at 1440 | table fills the width both ways, columns reflow, no horizontal overflow (`run-items-1440.png`, `side-closed.png`) |
| 390 run items | cards with status, input, quality bar, latency, More (`run-items-390.png`) |
| Heatmap view, CSV button, trace drawer | heatmap unchanged and rendering; CSV dialog and trace drawer open (the suites above cover their behaviour) |
| Compare matrix 1440 | run columns with baseline star, ScoreBar plus delta glyphs, ERROR chips, warn/error rails, expand shows input, expected, a card per run with score editors and root-cause issues (`cmp-items-1440.png`, `cmp-expand.png`); baseline controls and per-metric improved/regressed filter chips present; cohort URL renders four run columns (`cmp-cohort.png`) |
| Compare 390 | matrix scrolls sideways, see M2 |

## Fix list

### Major
- **M1 No sticky column header on run items and compare (deferral rejected).** After the page scrolls, the table header is off screen
  (measured on the 5,200 run after scrolling: `th` top -17950 px). Run items then show `74.1% | False | 33.3% | 356` with no
  metric names; compare shows three or four identical bar columns with no run legend. The legacy run page had a sticky items header
  and the compare list had a sticky run legend (`.head`); the brief promised sticky headers. Cause: `position: sticky` on `th`
  (`DataTable.module.css:134`) sticks inside the table's own scroller (it has `overflow-x: auto`, hence a vertical scroll container
  too), not the shell scroller. Fix options: (a) when `scrollParent` is set make the table scroller `overflow-x: clip`-style
  (no vertical container) and pin the thead with a measured `top` (sticky bar heights are already known, they feed
  `scrollPaddingStart`), keeping the mirrored horizontal rail; or (b) render a lightweight fixed clone of the header cells
  synced with horizontal scroll. Estimate 3 h; add a spec asserting `th` stays under the sticky bars after scrolling 2,000 px on
  both pages.
- **M2 Compare matrix has no card mode at 390.** Only `#` and Input are visible; every run's score is off screen to the right and
  there is no scroll cue (`cmp-items-390.png`). Cards fall back to column ids for ReactNode headers. Fix: add `Column.label` (text for
  card keys, tooltips and the column menu), give the run columns `priority: 1`, and in cards show "A gpt-5-mini  86.0%  bar"
  rows. Estimate 1 h. Until then at least the edge cue must show that more columns exist.

### Minor (5)
1. Teal fragments at the left edge of the root-cause cards in an expanded run item (`deeplink.png`, around x=213, y=487-650): the
   row rail inset leaks beside the nested cards.
2. Heatmap view rows have no pass headers visible after scrolling (same sticky issue, not a DataTable).
3. At 390 the run page tab strip cuts off after "Summary" with no overflow cue (pre-existing, `run-top-390.png`).
4. Items table: the pinned trace column is an almost invisible strip when a row has no trace; show the icon disabled or hide the column
   when no row has traces.
5. SQLite "database is locked" during bulk ingest of the 5,200 run on a dev stack (platform background workers); not a UI issue, noted for
   the seeding script.

### Accepted deferrals
`?` shortcut sheet, Ctrl+A, dataset preview, experiments search remain deferred as agreed.

## Code notes
- Windowing lives in the primitive (`DataTable.tsx:143-151, 371-378, 565-577`) and is on by default above 200 rows; a 500-row page is never fully
  mounted, `aria-rowcount`/`aria-rowindex` kept.
- `test.fail` removal is justified by the new deep-link landing; the new spec asserts the restored scroll position.

## Re-review (branch at b21e04fd)

Measured on a fresh stack (8866/5866) with the 5,200-item run, the repeat run and the compare scenario.
Screenshots: `shots/r2-deep-open.png`, `r2-deep-closed.png`, `r2-sort.png`, `r2-heatmap.png`, `r2-cmp-1440x1100.png`,
`r2-cmp-1440x640.png`, `r2-cmp-390x844.png`.

| Item | Status | Evidence |
|---|---|---|
| M1 sticky header, run items | FIXED with one residual (see R1) | Scrolled 9,000 px deep, header band and column row pinned under the sticky bars with the sidebar open and closed (`top` 155/179 px); each header cell has the same left and width as its body cell (e.g. 213:32, 245:64, 309:110, 419:220, 639:260, 899:150 ... identical in header and row; shifted by 136 px with the sidebar closed). Still aligned after resizing a column (the horizontal scroll moves header and body together) and after sorting by Latency (`r2-sort.png`). |
| M1 sticky header, compare | FIXED | Tall viewport: the run legend and the matrix header (A star / B / C) are both pinned; short viewport (640 px): the big legend scrolls away and the matrix header with A/B/C stays, so the columns are always named (`r2-cmp-1440x1100.png`, `r2-cmp-1440x640.png`). |
| Heatmap pass headers | FIXED | "ITEM | PASS 1 | PASS 2 | PASS 3" pinned while scrolled to row 41 (`r2-heatmap.png`). |
| M2 compare cards at 390 | FIXED | Each row is a card: question as title, `#`, "A (baseline)", "B", "C" as labelled key/value rows with bars, deltas and ERROR chips (`r2-cmp-390x844.png`). |
| Minor 1 rail fragments, minor 4 trace placeholder | FIXED | No teal fragments in the expanded item; trace column shows a faint dash (`r2-deep-open.png`). |

### New finding
- **R1 (minor, fix before a demo) Header trails the scroll by one frame.** The shift is applied in a `requestAnimationFrame` after the scroll
  event (`useStickyShift.ts:36-40`), so while the page scrolls the header sits one scroll step away from its pinned spot: sampling its
  top every frame during wheel scrolling alternates between the pinned position and pinned minus that frame's scroll delta (179/159 px at
  20 px per frame, 179/79 px at 100 px per frame). At rest it is exactly still (179 px for 60 frames). On a flick it will visibly bob.
  Cheapest fix: apply the transform synchronously in the scroll listener (drop the rAF throttle; it only writes one CSS variable), or
  avoid JS entirely by letting the table scroller not be a vertical scroll container (`overflow-x: clip` plus sticky). Not blocking.

### Gate
- `npm run check`: PASS, 1148 Vitest, design-language 36.
- `e2e/run-detail` + `e2e/compare`: 306 passed, 0 failed (6.7 min).
- `environments.spec` and `cutover-passes.spec`: run 3 times together, 19 passed each time (43 s), 0 failures, so the implementer's single
  failure in the full run is load flake, not a race.
- Servers stopped, ports clear.

### Verdict: MEETS THE STANDARD
Both pass-2 majors are fixed and verified; only the one-frame header lag (R1) remains, a short polish item.
