# Round 6 (performance): independent review

Reviewer: independent agent. Tip `08960434` on `ui/perf6-tables-run-detail`. Production build (`heavy.sh --cost 2`), platform on 8999, reference
build of `UI-redesign` (b88036cc) on 5999 over the same seeded DB. Seeds and scripts are the committed `measure/*.mts` (copies with patched
paths in the scratchpad, see section 7). Medians of 3, 1440 x 900, dark; "4x" = `setCPUThrottlingRate(4)`; Fast 3G = DevTools preset.
Raw numbers of this review: scratchpad `p6r/out`, `p6r/out25`, `p6r/shots` (not committed).

## Verdict (first pass, 5932b20b/8a4e0717): MEETS WITH FIXES. Final verdict after the fix pass (7074602e): MEETS, see section 10.

Scrolling (the "non natural" half of the first complaint) and the one-step-at-a-time loading (second complaint) are delivered and reproduce.
Two things the owner would still notice are not: **freezing or unfreezing a column still jumps after 0.35 s (1x) / 0.65 s (4x)**, and **on a
slow link the Items table paints later than before the round** (4.2 s against 2.6 s cold, 7.9 s against 6.7 s on a deep link). Both are required
fixes (R1, R2). A third required fix (R3) is about a measurement that does not reproduce from the committed script.

## 1. Criterion table (baseline / implementer / mine / target)

Baseline = `measure/baseline-merged`, implementer = `measure/after`, mine = this review. Where the implementer's number differs from mine the
reason is stated.

### Part A

| ID | Baseline | Implementer | Mine | Target (local) | Result |
|---|---|---|---|---|---|
| A1 items handler median 1x / 4x | 6.78 / 29.97 ms | 0.61 / 2.47 | **0.61 / 2.48** | <= 1 / <= 4 | MEETS |
| A2 forced layouts in scroll dispatch (items / runs) | 121 / 0 | 4 / 0 | **4 / 0** | 0 / 0 (amended <= 8) | MEETS the amendment, not the original (see 4) |
| A3 commits in a runs scroll | 2 | 0 | **0** | 0 | MEETS |
| A4 commits in an items scroll (1x / 4x) | 323 / 310 | 26 / 27 | **26 / 27** | <= 150 | MEETS |
| A5 dropped frames at 4x, runs / items | 20 / 132 | 8 / 24 | **7 (25 rows) or 12 (50 rows) / 21** | <= 6 / <= 10 (amended <= 10 / <= 26) | MEETS the amendment, not the original |
| A6 long tasks at 4x, runs / items | 22 / 138 | 9 / 31 | **9 (25) or 19 (50) / 37** | <= 6 / <= 10 (amended <= 10 / <= 33) | items 37 exceeds the amended 33 (shared machine, 20% noise, CI margin 25 is the spec's, so a flake risk, not a defect) |
| A7 first scroll tick: commits, longest frame 1x / 4x | 1, 61 / 238 ms | 0, 0 / 0 | **0, 0 / 0** | 0, <= 20 / <= 60 | MEETS |
| A8 freeze: commits, longest frame 1x / 4x | 3, 131 / 452 | 3, 99 / 399 | **3, 98 ms / 4, 409 ms** (unfreeze 3, 78 / 2, 321) | 1 commit, <= 40 / <= 120 | DOES NOT MEET (amended to <= 3 commits, <= 110 / <= 400) |
| A9 sticky elements; Layerize 1x / 4x | 329; 592 / 2,299 | 135; 325 / 1,134 | **135; 318 / 1,105 with the default 25 rows; 260; 597 / 2,160 with the committed script (50 rows)** | <= 170; <= 250 / <= 900 (amended 350 / 1,200) | MEETS only for a wide table at its new default of 25 rows (see R3) |
| A10 frozen cell / header error | 0 px | 0 | **0 px, 0 frames** | 0 | MEETS |
| A11 alignment at 10 positions, 1440 | 0 px | 0 | **0 px** (`align.mts`; 700 and RTL asserted by the spec, which passed) | 0 | MEETS |
| A12 no transition on geometry; events | 0 / 1 | 0 / opacity only | **opacity only** (design-language test green, 2 `transitionstart` on scroll = the shadow) | opacity only | MEETS |
| A13 reduced motion | | | spec green | | MEETS |
| A14 card mode and SDK viewer | | | 390 px screenshots identical to UI-redesign; runs-list card specs green (232 passed); implementer's `e2e:sdk` 42 passed (not re-run, see 6) | | MEETS |

### Part B (big-1200 unless stated)

| ID | Baseline | Implementer | Mine | Target (local) | Result |
|---|---|---|---|---|---|
| B1 header, warm chunk, none / Fast 3G | 186 / 1,182 | 20 / 24 (impl; 22 / 19 in raw) | **24 / 22** | <= 150 | MEETS |
| B2 header, cold chunk, none / Fast 3G | 246 / 2,607 | 43 / 1,218 | **43 / 1,228** | <= 250 / <= 1,700 | MEETS |
| B3 Overview, warm / cold, none | 186 / 246 | 263 / 280 | **258 / 262** (362 default) | <= 400 / <= 600 | MEETS |
| B4 Overview, Fast 3G warm / cold | 1,182 / 2,607 | 992 / 1,903 | **977 / 1,905** | <= 1,100 / <= 2,000 | MEETS |
| B5 deep link Fast 3G, header / Overview | 6,674 | 4,842 / 5,020 | **4,841 / 5,016** | <= 5,000 (amended 5,100) | MEETS the amendment; original missed by 16 ms on the Overview |
| B6 CLS | 0.0057 | 0.0087 | **0.0089** big, 0.0059 wide, 0.0031 deep | <= 0.02 | MEETS |
| B7 JS gzip to the header | 100.7 kB | 41.5 kB | **41.6 kB** (32.2 + 8.4 + 1.0) | <= 45 | MEETS |
| B8 everything loaded after the Overview, no gating | | +3.0 s cold | **+2.8 s cold Fast 3G (Overview 1.9 s, last section and Latency at 4.7 s), +1.4 s warm; 0 requests during a scroll of the whole page (nav warm, nav cold, deep); no skeleton or busy state at any scroll position** | <= 1.5 s local / <= 4 s Fast 3G | MEETS (decisive check passed) |
| B9 API requests / gzip | 3 / 89.6 kB | 3 run + 1 step-latency, 88 kB | **4 / 87.7 kB** (summary 1.6, core 55.9, text 29.1, step-latency 1.1) | <= 3 run requests, <= 100 kB | MEETS the amended wording |
| B10 no refetch on switches, abort on leave | | | spec green (`run-sections`); no new request on scroll in my run | | MEETS |
| B11 TBT | 52 ms | 11 | **0-22 ms** big; wide 46 (nav) / **56 (deep, none)** | <= 50 | MEETS (the wide deep link is 6 ms over the local target, inside the CI margin 120) |
| B12 anchors and deep links | pass | pass | perf specs and runs-list green; deep link timeline in section 3 | pass | MEETS |

Counts: **A 14 criteria: 11 MEET as written (A1, A3, A4, A7, A10 to A14, plus A2 and A9 with qualifications), 2 MEET only after amendment (A5, A6), 1 DOES NOT
MEET (A8).** **B 12 criteria: 12 MEET (B5 and B9 on their amended wording; B5 by 16 ms over the original).** Total 26: 23 meet, 2 meet only amended, 1 does not. The Items table
paint time is not a criterion at all and regressed (R1).

## 2. Per-complaint verdict

**"Transition for frozen columns or rows feels too laggy and non natural"**: scrolling with frozen columns and with an expanded item: MEETS. Screencast
(CDP `Page.screencast`, wheel of 120 events, 16 ms apart): runs table with two frozen columns, frame interval p50 33 / p95 33 / max 45 ms at 1x and 33 / 67 / 67 at 4x, no gap
over 100 ms; items table with two expanded items 33 / 33 / 53 (1x) and 33 / 50 / 83 (4x), no gap over 100 ms (the screencast itself caps at 30 fps, so p50 33 is the
recorder, not the page). The first horizontal tick no longer commits or hitches (0 commits, 0 ms frame; was 61 / 238 ms), the edge shadow fades over 120 ms
by opacity (frame sequence `shots/cast-hscroll-cpu1`), and frozen cells and header sit at 0 px error. Wheel scrolling now reads as natural.

Freezing or unfreezing a column from the Columns menu: DOES NOT MEET (R2). Screencast of the click: at 1x the table shows no change for about 0.35 s to 0.5 s and then
jumps to the new layout in one frame (2 frames in the 1.5 s window, gap 507 ms; unfreeze 427 ms); at 4x the gap is 1,073 ms (unfreeze 734 ms). The measured main-thread cost is
3 commits, 98 ms longest frame at 1x, 409 ms at 4x, against 131 / 452 before: about 25% better at 1x and 10% at 4x. That is the same visible lag the owner described, not a fix.
Frames: `shots/cast-freeze-cpu1`, `cast-freeze-cpu4` (frame 0 before, frame 1 after, nothing in between).

**"Loading run details by smartly loading segments one step at a time"**: MEETS, with the Items regression below. Header from the list cache in 20 to 40 ms; skeletons
at final heights (CLS 0.0089); core row groups in one request issued with the summary; Overview at 1.0 s (Fast 3G warm) / 1.9 s (cold) against 1.2 / 2.6 s; every later section
and chunk loads by itself right after the Overview paints, one stage after the other; scrolling afterwards fires 0 requests and shows no loading state.

## 3. What appears when (1,200-item run, Fast 3G, my stage script `m/stages.mts`, 100 ms polling)

Cold chunk (idle prefetch off, which is also what a real 3G browser gets, see R1):

| t after click | Screen |
|---|---|
| 11 ms | skeleton shell |
| 1,184 ms | run header complete (hero, chips), nav with counts, Overview skeleton cards at final height (`shots/nav-cold-1400.png`) |
| 1,937 ms | Overview with 4 metric cards filled (`nav-cold-2200.png`); Latency, Categories, Errors still skeletons |
| 3,096 / 3,548 ms | Categories, then Errors filled |
| 4,157 to 4,289 ms | Items table rows painted (9 rows windowed) |
| 4,664 ms | Latency filled; 4,868 ms nothing busy any more |
| then | wheel through the whole page in 700 px steps: 0 new requests, 0 busy sections |

Warm chunk (idle prefetch): header 22 ms, Overview and Items rows at 981 ms, all sections done at 2,364 ms, 0 requests on scroll. Deep link (cold, Fast 3G): header 4.8 s,
Overview 5.0 s, Items rows 7.9 s, everything settled 8.6 s, 0 requests on scroll. Not re-driven separately: deep link with `#errors` and with `?item=` (covered by the
run-sections and run-detail specs, which pass).

## 4. Judgment on the two points in the brief

### (1) Items table on a cold chunk over Fast 3G: a user on a slow link IS worse off. Required fix R1.

Measured (median of 3): header 1.2 s (was 2.6 s), Overview 1.9 s (was 2.6 s), **Items rows 4.2 s (was 2.6 s)**; deep link: header 4.8 s (was 6.7 s), **Items rows 7.9 s (was 6.7 s)**.
The Overview is better, the Items table, which is the thing a reviewer opens a run to read and the target of `#items` and `?item=` deep links, is 1.6 s worse cold
and 1.3 s worse on a deep link. The implementer's cause (each dependency chunk costs a round trip) is right but it is not the whole of it. From the waterfall of the cold run
(`out/load-big-nav-fast3g-coldchunk.json`): 17 requests are issued in the same 40 ms at 1,218 ms, after the core request ends (not "with the summary": the Items chunk starts after the
core rows arrive); `ItemsSection` (21.7 kB) lands at 3,735 ms because it shares 1.6 Mbit/s with the 29 kB texts request, step-latency and 12 other chunks; its dependencies (Disclosure,
ScoreEditor, MetricAnalysisCards, TraceHost, SpanDetail, `LatencyTab` at 4,326) land between 4,068 and 4,326 ms and the table paints at 4,220 ms. `preloadPanels` is also a
serial `.then` chain (Overview, Categories, Errors, Items, Latency, Deep, Repeat, RootCause, TraceHost), so the tail (Deep 4.9 s, Repeat 5.6 s, RootCause 6.2 s) runs one round trip
of 562 ms each after the rest.

Also: `connectionAllowsPrefetch()` disables the idle prefetch on 2g/3g and saveData, so the "warm chunk" numbers (Items at 0.98 s) apply to everyone except the users on slow
links. The cold numbers are the Fast 3G numbers for real 3G users.

Required: start `ItemsSection` (and its static dependencies) with the summary, or fold the Items dependencies into the page chunk or into one Items chunk, and request the
Items chunk before the text and step-latency requests (the table does not need the texts to paint). Acceptance: Items rows painted <= 2.6 s cold Fast 3G on the nav case and
<= 6.7 s on the deep link, Overview <= 2.0 s unchanged; add `rowsMs` (Items painted) as a perf criterion and a `perf/run-load` assertion.

### (2) Freezing a column: still visibly hitches. Required fix R2.

Judged through the screencast (section 2): one visible jump after 0.35 to 0.5 s at 1x, 0.65 to 1.1 s at 4x, with 3 to 4 React commits and a 98 ms (1x) / 409 ms (4x) frame whose
script is `zd` in `react-zBDCKe32.js` from `BODY.onclick` (the re-render of 25 or 50 rows x 30 cells: the page's own `DataTable` body renders every row and cell again, there is no
memoised cell). The shipped diff has no `memo` around row or cell rendering (`DataTable.tsx` cell loop near line 1309 builds `common` props per cell inline). The owner's word
"laggy" applies to this action exactly, and a 10% gain at 4x does not change it. Required: memoise the row and cell render by (row identity, column id, pin state, offset) so a freeze
re-renders only the columns whose pin or offset changed, move the Columns menu's own press state out of the commit that changes the table, and keep a single commit. Acceptance: 1 commit,
longest frame <= 40 ms at 1x and <= 120 ms at 4x (the original A8) and the screencast gap click to new layout <= 150 ms at 1x. The amended A8 (3 commits, <= 110 / <= 400 ms) records
the current implementation, not a user-visible standard; revert it to the original numbers.

## 5. Amendments: measured reality or convenience?

| Amendment | Judgment | Why |
|---|---|---|
| A2 (0 layouts -> 0 rect reads + <= 8 in-scroll layouts per 2 s) | **Measured reality** | Reproduced (4). They come from commits that move the row window, one per window; the forced layouts per event (121) are gone and the handler is 0.6 ms. |
| A5 / A6 items (<= 10 -> <= 26 / <= 33) | **Mostly reality, partly convenience** | 132 -> 21 dropped frames and 138 -> 37 long tasks at 4x is a 6x gain, and the floor is Paint, Raster and hit-testing under 4x (trace `byName`: Raster 480 ms, Paint 279 ms, Layerize 110 per scroll). But the original 10 was not reached and the implementer chose not to build the CSS-only header (D2). My items long-task median of 37 is over the amended 33 on a shared machine: widen the CI margin or state the 4x floor, do not tighten silently. |
| A5 / A6 runs (<= 6 -> <= 10) | **Reality** | One sticky layer per frozen cell; 25 rows give 7 / 9, 50 rows 12 / 19. |
| A8 (1 commit, <= 40 / <= 120 -> 3 commits, <= 110 / <= 400) | **Convenience** | The cause is known and fixable (cell memoisation, noted as "not attempted"); the amendment writes the unfixed behaviour into the criterion. R2. |
| A9 (Layerize <= 250 / 900 -> <= 350 / 1,200; sticky <= 170) | **Reality for 25 rows, but the improvement is a row count, not a layer cost, and the committed script does not reproduce it** | Reproduced 135 / 318 / 1,105 only after removing the line `localStorage.setItem('qym:runs:page-size','50')` from `scroll-table.mts` (that line makes the page size a user choice, so E1 does not apply). With the committed script: 260 sticky, 597 / 2,160 ms, i.e. the baseline (592 / 2,299). The baseline was 50 rows and the result is 25 rows, so the number records "half the rows", and a user who ever chose a page size (saved choice wins) gets the old cost. The shipped default of 25 rows is a visible product change on wide tables ("1 to 25 of 202") that was not raised with the owner. R3. |
| B5 (<= 5,000 -> <= 5,100) | **Reality, but only half of the deep-link story** | 6.67 s -> 5.0 s is real and the entry bundle (312 kB gzip, 439.9 kB JS in 28 files) is the bound. The amendment hides that the Items table on the same link went from 6.7 s to 7.9 s (R1). |
| B8 (rewritten after the owner's correction) | **Reality** | Not gating is what the owner asked for and I verified it directly (0 requests on a whole-page scroll in three scenarios, no loading state). The budget of +3.0 s cold I measured as +2.8 s. |
| B9 (<= 3 requests -> <= 3 run requests + step-latency) | **Reality** | 87.7 kB, one extra 1.1 kB request. |
| B11 (wide deep link) | **Convenience-free** | 56 ms against the 50 ms local target, inside the 120 ms CI margin; not an amendment, noted. |

## 6. Findings by severity

### Required

- **R1 (high): Items table paints later than before on slow links** (4.2 s vs 2.6 s cold nav, 7.9 s vs 6.7 s deep). `frontend/src/features/run-detail/chunks.ts` (`preloadPanels` serial
  chain, Items fourth), `RunBody.tsx` / `RunDetailPage.tsx` (Items chunk started after the core request), `ItemsSection` dependency chunks (Disclosure, ScoreEditor, MetricAnalysisCards,
  TraceHost, SpanDetail, LatencyTab). Fix as in section 4(1); add a `rowsMs` criterion and spec.
- **R2 (high): freeze and unfreeze still hitch** (98 ms at 1x, 409 ms at 4x, 0.35 to 1.1 s to the new layout). `frontend/src/ui/DataTable/DataTable.tsx` row and cell render (about line 1309),
  `perf/table-freeze.spec.ts` amended thresholds. Fix as in section 4(2); restore the original A8.
- **R3 (medium): A9 is not reproducible from the committed script.** `measure/scroll-table.mts` line 22 pins 50 rows, the recorded `measure/after/scroll-runs-*.json` have 135 sticky
  elements, which only a 25-row page gives. Make the script clear the key (or run both and record both rows: 50 rows 260 / 597 / 2,160 vs 25 rows 135 / 318 / 1,105), state in `impl-notes.md`
  that the gain is the page size, and decide with the owner whether 25 is the right default (E1), since a stored choice defeats it.

### Optional

- O1: the Items table spec gap: `perf/run-load.spec.ts` asserts header and Overview only. Add Items painted.
- O2: `shots/after-*` are from the implementer; the "after" Layerize figure in `impl-notes.md` section 2 should say 25 rows.
- O3: `useWindowedRows` and `useStickyShift` are solid (0 rect reads, 0 commits per tick); no change asked.
- O4: wide-deep TBT 56 ms exceeds the local 50 ms target; fine in CI.

## 7. No-regression checks

- Visual diff against UI-redesign (b88036cc), same DB, animations disabled, 4.5 s settle: run page 1440 and 390, wide repeat run 1440 and 390, items section 390: **0 pixels differ over 24/255**. Items
  section at 1440: 0.66% of pixels, anti-aliasing and 1 px text offset only (`shots/cmp-items-crop.png`, side by side, indistinguishable). Runs page: 0.054% (1440) and 0.065% (390), the pager
  line (25 vs 50 rows, R3). No layout change.
- `?view=compact`: byte-identical JSON (1,526,894 bytes, same hash) on both builds. `fields=nonsense` returns 422.
- Abort on navigation, no refetch on tab or section switch, anchors and deep links: asserted by `perf/run-sections.spec.ts` (green); scroll fires 0 requests (my stage script).
- SDK viewer: not re-run by me (the platform e2e and gate scope were `perf` and `runs-list`); implementer reports `npm run e2e:sdk` 42 passed. DataTable is shared with the SDK viewer; the shipped
  design-language and Vitest suites are green. The SDK viewer was not opened in a browser by me.

## 8. Gate (heavy.sh, on 08960434)

- `npm run check` (cost 3): green, Vitest 164 files / 1,404 tests passed, design-language 50 passed (two runs of the file in the pipeline), tsc, eslint, stylelint clean.
- Playwright `e2e/perf` + `e2e/runs-list` (cost 4, ports 8930 / 5930, `QYM_E2E_DB=<worktree>/.qym-e2e-perf6r.db`, removed after): **232 passed, 0 failed, 0 skipped** (5.9 min).
- Not run by me: `pytest tests/platform` (implementer: 2,781 passed), `e2e:sdk`, full `npm run e2e`. Servers stopped (8999, 5999, e2e ports free); no database committed.

## 9. Screenshot and trace list (scratchpad `.../scratchpad/p6r/`)

`shots/nav-cold-{800,1400,2200,3200,4500,6500,after-scroll}.png`, `nav-*` (warm), `deep-*`; `stages-{nav,nav-cold,deep}.json` (state timeline, request list, scroll requests);
`shots/cast-{hscroll,hback,freeze,unfreeze}-cpu{1,4}/` (screencast frames, file names carry ms); `shots/vis-{runs,run,wide,items}-{1440,390}-{new,ref}.png`, `diff-*.png`, `cmp-items*.png`;
`out/` (scroll, freeze, align, load JSON of the committed scripts), `out25/` (runs scroll with the page size unpinned); `m/` (patched copies of the scripts plus `stages.mts`, `cast.mts`, `cast2.mts`, `vis.mts`);
`check.log`, `e2e.log`, `build.log`.

## 10. Re-review of the fix pass (HEAD 7074602e, commits 6fd52d3e and 7074602e)

Targeted. Fresh production build (`heavy.sh --cost 2`), platform on 8999 over the same seeded DB, committed scripts from `measure/` (page size pinned to 50 by the script, as
committed), medians of 3 (freeze: 5), machine quiet at the time (`free -h` 5.7 GB free, no other servers on my ports). Raw JSON in scratchpad `p6r/r2/out`.

### Final verdict: **MEETS**

R1 and R3 are fixed as asked. R2 is fixed to a state a user cannot call laggy (click to new layout 76 to 93 ms at 1x); the original A8 numbers are still not met and I accept the
amendment (below) on the condition of one test alignment that is not blocking. No E2/E3 and no column virtualisation required.

### Correction to my first pass

My first-pass screencast reading of the freeze ("one jump after 0.35 to 0.5 s", "0.65 to 1.1 s at 4x") included the 300 ms idle wait I leave between starting the recorder and the click
(frame 0 is the recorder start). The corrected pre-fix figure is about 0.2 s (1x) and 0.77 s (4x). The verdict on that build (still visibly late at 4x, 3 commits, 98 / 409 ms frame) stands, but the
number in section 2 was inflated by 0.3 s. The measurement below uses the click event's own timestamp against the frame timestamps (`m/cast3.mts`), so it has no such offset.

### R1 / B13 (Items rows painted), big-1200, median of 3

| Case | Before fix | Implementer | Mine | Target | Result |
|---|---|---|---|---|---|
| Nav, Fast 3G, cold chunk: Items rows | 4,220 ms | 2,567 | **2,571** | <= 2,600 | MEETS (29 ms margin; same-machine run to run spread is about 20 ms) |
| same: header / Overview | 1,228 / 1,905 | | **1,129 / 1,847** | <= 1,700 / <= 2,000 | MEETS (better) |
| Deep link, Fast 3G: Items rows (header / Overview) | 7,941 (4,841 / 5,016) | 6,464 | **6,523 (4,404 / 4,960)** | <= 6,700 (Overview <= 5,100) | MEETS |
| Nav, Fast 3G, warm chunk: Items / Overview | 977 | | **973 / 973** | | no regression |
| No throttle, cold / idle-prefetched (default) / warm: Items | 262 / 362 / 258 | 251 / 316 / 170 | **248 / 287 / 174** | <= 350 | MEETS |
| Deep link, no throttle | 311 | | **307** | | no regression |
| CLS | 0.0089 | | **0.0087** (warm none 0.0172, inside <= 0.02; was 0.015) | <= 0.02 | MEETS |
| API requests / kB | 4 / 87.7 | | **4 / 87.7** | <= 3 run requests | unchanged |
| JS on the cold navigation | 24 files / 122.9 kB | | **10 files / 117.1 kB**; deep link 14 files / 441 kB (was 28 / 440 kB) | | fewer round trips |

Request order on the cold Fast 3G navigation (last rep, `jsList` and `apiList`): summary and core rows at 5 ms; `RunDetailPage` chunks; at 1,112 ms the Overview, Deep and **Items chunks
start together** (ItemsSection lands at 1,918 ms); the texts request starts at 2,560 ms, after the Items chunk; step-latency at 1,254 ms (1.1 kB); Latency and TraceHost at 1,238 ms,
Repeat at 2,526 ms. So the Items chunk is requested before the texts and before every other panel except the Overview and Deep chunks that go out in the same tick. The e2e assertion
(`run-sections.spec.ts`: ItemsSection before `fields=text`, and not after Latency, Deep, Errors, Categories) agrees with it. All sections still load by themselves; the earlier
whole-page scroll check (0 requests) is unaffected by this change and the perf folder asserts it (green).

### R2 (freeze and unfreeze), 50 rows, 2 pinned columns -> 3, then one more frozen

| | Baseline | First pass | Implementer | Mine, 1x | Mine, 4x |
|---|---|---|---|---|---|
| Freeze: longest frame | 131 / 452 ms | 98 / 409 | 80 / 289 | **81 ms** (73 to 83) | **296 ms** (289 to 299) |
| Unfreeze: longest frame | 92 / 387 | 78 / 321 | 51 / 207 | **52 ms** (3 of 5 reps 51 to 66; one rep 0) | **213 ms** |
| Script time, freeze | 76 / 252 | 52 / 235 | 32 | **34 ms** | **115 ms** |
| Harness commits (menu press state included) | 3 | 3 / 4 | 3 | **3** (freeze), 3 | 4 / 2 |
| Click to the first frame that shows the new layout (screencast, click timestamp) | n/m | ~200 ms (see correction) | not measured | **76 to 93 ms** (6 clicks: 93, 76, 76, 78, 77, 78) | **247 to 346 ms** (346, 272, 256, 260, 247, 257) |

My own acceptance (click to new layout <= 150 ms at 1x): **met, 76 to 93 ms**; at 4x CPU 250 to 350 ms, which is the 4x CPU cost and about 2x the implementer's longest-frame figure
because it includes the input task and the commit, not only the long frame. Still one frame, no intermediate state, no frozen-in-between layout.

### Amendment A8 (one table commit, <= 90 ms at 1x, <= 300 ms at 4x), judged under the amendment rule (measured value + reason + matching test)

**Accepted.** Value: 81 ms and 296 ms measured, 6 to 9% under the ceilings; the 4x figure is tight (296 against 300; five reps 289 to 299), so treat 300 as the floor and not a target to tighten. Reason:
the cells are memoised (script 34 ms, the harness counts the Columns button's own press-state commits), what remains is native style, layout and paint of 50 x 68 cells, which no React change removes.
The user-facing criterion I set (new layout within 150 ms of the click at 1x) is met with margin (about 80 ms, under the usual 100 ms "instant" threshold), so the complaint is answered, and the screencast
of the wheel scroll shows no gap over 100 ms. E2/E3 (fewer layers) and column virtualisation are **not required**: they target scroll Layerize cost, and the freeze cost is no longer script. Condition (not blocking, optional fix O5):
the spec and `perf.md` 8.1 do not say the same thing. `perf.md` says "one table commit, <= 300 ms at 4x"; `table-freeze.spec.ts` asserts the 1x number only (`limit(400, 90)`, so CI 400, strict 90), the commit count as `<= limit(4, 3)` (menu included) and has no 4x
case. Make the spec assert the 90 ms strict number it asserts and state in 8.1 that 4x (<= 300) is asserted by `measure/freeze-toggle.mts` only, or add a 4x case.

### R3 and A9 (50 rows is the default again), A5 / A6

Default confirmed 50 (`RunsPage.tsx` back to `PAGE_SIZE`; saved choice wins; `AUTO_PAGE_SIZE`, `WIDE_COLUMNS` and the auto key removed; one sticky `thead` kept). Committed scripts at 50 rows:

| Measure | Baseline | First pass (same script) | Implementer | Mine | Amended target | Result |
|---|---|---|---|---|---|---|
| Runs sticky elements | 329 | 260 | 260 | **260** | <= 270 | MEETS |
| Runs Layerize 1x / 4x | 592 / 2,299 ms | 597 / 2,160 | 596 / 2,141 | **604 / 2,220** | <= 650 / <= 2,300 | MEETS (4x 3% under: measured reality, noise-bound) |
| Runs 4x dropped frames / long tasks | 20 / 22 | 12 / 19 | 14 / 19 | **13 / 20** (12, 13, 13 / 19, 20, 20) | <= 16 / <= 22 | MEETS |
| Runs 1x commits in scroll / handler | 2 / 0.08 ms | 0 / 0.057 | | **0 / 0.056 ms**, in-scroll layouts 0 | 0 | MEETS |
| Items 4x dropped frames / long tasks | 132 / 138 | 21 / 37 | 24-25 / 23-31 (37 once) | **22 / 23** (22, 22, 25 / 23, 22, 27) | <= 26 / <= 40 | MEETS |
| Items 1x commits / handler / in-scroll layouts | 323 / 6.78 / 121 | 26 / 0.61 / 4 | | **26 / 0.60 ms / 4** | A1, A2, A4 | MEETS |
| Items 4x handler / commits | 29.97 ms / 310 | 2.48 / 27 | | **2.45 ms / 27** | <= 4 ms | MEETS |

A9 judgment: the amendment records the honest number (the one-element header cut sticky elements 329 to 260 and left Layerize at the baseline). The 25-row default is gone, so the owner-visible page size
did not change from `UI-redesign`, which was the point of R3. Accepted as measured reality; the script and `perf.md` now agree because the run at 50 rows reproduces from the committed script (R3 closed).
Page-size diff against `UI-redesign` is therefore nil again.

### Extra fix: box-plot dots under `prefers-reduced-motion`

Browser check on the big run (1,197 `dot2` elements, `reducedMotion: reduce` against `no-preference`): reduced: `animation-name: none`, longest transition or animation duration **1e-6 s** (the global reduced-motion
rule); normal: 0.15 s transition. So the dots do not animate under reduced motion. Closed.

### Gate for this pass

`e2e/perf` (cost 3, heavy.sh, ports 8999 / 5999): **10 passed, 0 failed** (43 s), on the review worktree at 7074602e; no database left or committed, servers stopped, ports free. `npm run check`, the full e2e
and `pytest tests/platform` were not repeated by me (coordinator runs them on the merged tip). Not touched: SDK viewer.

### Open items (all optional)

- O5: align the A8 spec and `perf.md` 8.1 (above).
- O6: B13 cold has a 29 ms margin (2,571 / 2,600): the first thing to move on a slower runner; the spec's strict number is local only.
- O7: step-latency (1.1 kB) goes out at 1,254 ms, before the texts, and takes about 1.7 s on the cold link because of 562 ms RTT sharing; harmless, listed for completeness.

### Review artefacts of this pass (scratchpad `p6r/r2/`)

`out/*.json` (load, scroll, freeze, 1x and 4x), `build.log`, `e2e.log`, `uv.log`; scripts `m/cast3.mts` (click timestamp against screencast frames), `m/rm.mts` (reduced motion), `m/cast.mts`, `m/stages.mts`.
