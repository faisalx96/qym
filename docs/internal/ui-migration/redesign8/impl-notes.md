# Round 8 implementation notes: the compare page

Branch `ui/redesign8-compare`, spec `compare.md` (82 criteria + the 5 sidebar criteria of owner decision H2), owner decisions H1 to H5.
All measurements: Chromium, dark theme, the seed of `frontend/scripts/seed-compare.ts` plus four extra runs. After-shots:
`shots/after-*.png` (script `measure/a1-after-shots.mts`), next to the design's `legacy-*`, `current-*`, `mock-*`.

## Owner decisions applied

- H1 letters stay: `RunTag` (exported as `RunName`) is swatch + 16x16 mono letter badge + name; the Baseline tag replaces the star; item-row chips carry the swatch AND the letter.
- H2 sidebar stays: opened from the "Quick filters" toolbar button, closed by default, beside the list only (`ReportLayout` inside `ItemsSection`), a drawer below 1200 px. The Scope bar and the "Changes vs baseline" strip are gone.
- H3, H4, H5 as specified (item cards, INPUT above EXPECTED, 36 px links-only nav).

## Criterion -> change -> test

Tests are Playwright specs under `frontend/e2e/compare/` (`r8-*.spec.ts` are new; the older specs were updated, see below).

| Criterion | Result | Change | Test |
|---|---|---|---|
| C-page-1 | met | `CompareSection`, `RunCards`, `AveragesMatrix` recipes (frontend/src/features/compare/components/CompareSection.tsx) | r8-page: C-page-1 |
| C-page-2 | met | `CompareBar` is the one sticky element (frontend/src/features/compare/components/CompareBar.tsx) | r8-page: C-page-2/3 |
| C-page-3 | met | averages `.scroll` is `position: relative` so hidden text cannot leak; output grid likewise | r8-page: C-page-2/3, C-page-3 x2 |
| C-page-4 | met | `RunTag` wraps (`overflow-wrap: anywhere`), no ellipsis anywhere | r8-page: C-page-4 x3; r8-identity |
| C-page-5 | amended (runs 312, overview 1024 480, items 390 <= 2200) | section recipes; see compare.md amendments table | r8-page: C-page-5 x3 |
| C-page-6 | amended (runs 568, averages 385) | same recipe at 8 runs | r8-page: C-page-6 |
| C-page-7 | met | `ReportSections.tsx` order, one description per `CompareSection` | r8-page: C-page-7 |
| C-nav-1 | met (token `--bar-link-h`) | `CompareBar.tsx` links only, 36 px | r8-page: C-nav-1 |
| C-nav-2 | met | `sectionIds.ts` scroll margin 48; scroll-spy kept | r8-page: C-nav-2 |
| C-nav-3 | met | nav scrolls inside itself | r8-page: C-nav-3 |
| C-title-1 | met | title block in `ComparePage.tsx` | r8-runs: C-title-1 x2 |
| C-title-2 | met | mode tabs in the title row (cohort only) | cohort.spec: View switch |
| C-cohort-1 | met | `CohortBanner` in `SelectionBar.tsx` | r8-runs: C-cohort-1 |
| C-notice-1 | met (unchanged) | `Notices.tsx` sits between header and nav | notices.spec, multi-dataset-notice.spec |
| C-run-1 | amended (242 / grid 500) | `RunCards.tsx` auto-fill 17.5 rem | r8-runs: C-run-1 x2 |
| C-run-2 | met with H1 (letter badge) | `RunTag.tsx` = `RunName`; no star | r8-runs: C-run-2/3/4; r8-identity |
| C-run-3 | met | stat strip 3 x 36 | r8-runs: C-run-2/3/4 |
| C-run-4 | met | six meta rows (+ Samples for a repeat run) | r8-runs: C-run-2/3/4, repeat run |
| C-run-5 | met | 3 px rail in the run colour; one colour per run everywhere | r8-runs: C-run-5; r8-identity: C-run-5 |
| C-run-6 | met | remove X, focus to the next X (sessionStorage hand-off across the remount) | r8-runs: C-run-6 |
| C-avg-1 | met | `BaselineSelect` + `PassToggle` in the Averages head | r8-averages: C-avg-1 x2 |
| C-avg-2 | met (8 runs table 315) | `AveragesMatrix.tsx` real table, pinned metric column | r8-averages: C-avg-2/3, 1024 |
| C-avg-3 | amended (8 runs head 60) | colhead = RunName + Baseline tag | r8-averages: C-avg-2/3, 8 runs |
| C-avg-4 | met | cell 76 / 51 / 44 | r8-averages: C-avg-4/5/6/8 |
| C-avg-5 | met | `.valueBox` outline only beyond noise | r8-averages: C-avg-4/5/6/8 |
| C-avg-6 | met | `DeltaLine2` in `common.tsx` | r8-averages: C-avg-4/5/6/8 |
| C-avg-7 | met | `CountButtons`; `scrollToSection('items')`; `ItemsBanner` | r8-averages: C-avg-7 x2 |
| C-avg-8 | met | latency percent line, errors `N task · M scorer` / none | r8-averages: C-avg-4/5/6/8 |
| C-avg-9 | met | 390 blocks | r8-averages: C-avg-9 |
| C-ov-1 | amended (slider block 43) | `OverviewControls`, `MetricTabs` | r8-overview: C-ov-1 |
| C-ov-2 | met | `Overview.module.css` stat grid with container queries | r8-overview: C-ov-2/3 |
| C-ov-3 | met | band-coloured mono values, Errors red | r8-overview: C-ov-2/3 |
| C-ov-4 | met | winner bar flex-grow = wins, legend with RunName | r8-overview: C-ov-4 x2 |
| C-ov-5 | met | one 32 px stacked distribution bar | r8-overview: C-ov-5 |
| C-ov-6 | met (392) |  | r8-overview: C-ov-6 |
| C-cat-1 | met (URL `catKeys` added) | `CategoriesSection` chip bar in the head | r8-categories-errors: C-cat-1 |
| C-cat-2 | amended (185) | `CategoryCards.tsx` 3-up | r8-categories-errors: C-cat-2/3/4 |
| C-cat-3 | met | value rails, header row hidden at 390 | r8-categories-errors: C-cat-2/3/4, C-cat-3 |
| C-cat-4 | met | run-colour bar, 1 px tick 4 px taller | r8-categories-errors: C-cat-2/3/4 |
| C-cat-5 | amended (scrolls like every number) | card is a button | r8-categories-errors: C-cat-5 |
| C-step-1 | met | `StepsTab.tsx` in the averages recipe | r8-steps-rc: C-step-1 |
| C-rc-1 | met | `RootCauseTab.tsx` cards in the error-card recipe | r8-steps-rc: C-rc-1; items.spec root-cause flow |
| C-err-1 | met | `ErrorsTab.tsx`, `Errors.module.css` | r8-categories-errors: C-err-1/2, C-err-1 8 runs |
| C-err-2 | met | every run listed, zeros included | r8-categories-errors: C-err-1/2 |
| C-err-3 | met | card is a button, Enter / Space | r8-categories-errors: C-err-3 |
| C-items-1 | met | `ItemsHeadAside` (Auto-analyze only with an analysis) | r8-items: C-items-1; items.spec root-cause flow |
| C-items-2 | met | `ItemsBanner.tsx` | r8-items: C-items-2 |
| C-items-3 | met | `ItemsToolbar.tsx` one row, not sticky | r8-items: C-items-3 |
| C-items-4 | met | count status mono 11 | r8-items: C-items-4 |
| C-items-5 | met (active filters listed in the panel head) | `FilterBuilder.tsx` head, Escape returns focus | r8-items: C-items-5/6 |
| C-items-6 | met (run names in field labels) | `lib/filters.ts` uses `runShortName` | r8-items: C-items-5/6, C-items-6 Winner |
| C-items-7 | met | Display popover 300 wide with the metric select | r8-items: C-items-7 |
| C-items-8 | met | CSV accent | r8-items: C-items-8 |
| C-row-1 | met | `ItemList.tsx` cards | r8-items: C-row-1/2 |
| C-row-2 | met | chevron 26, #n mono 13/600, 2-line title | r8-items: C-row-1/2 |
| C-row-3 | amended (chip 78x22, 12 % tint, 390 swatch hidden) | `ScoreChip` with swatch + letter + value | r8-items: C-row-3 x2 |
| C-row-4 | met | error chip with x and "task error" | r8-items: C-row-4; matrix.spec |
| C-row-5 | met | `RunKey` in `ItemsSection.tsx` | r8-items: C-row-5 |
| C-row-6 | met | head is role=button, one tab stop | r8-items: C-row-6; a11y.spec |
| C-row-7 | met | `Pagination` 20 per page | r8-items: C-row-7 |
| C-exp-1 | met | `ItemDetail.tsx` stacked blocks | r8-expanded: C-exp-1 |
| C-exp-2 | met | `output-toggle` buttons, at least one stays on | r8-expanded: C-exp-2 |
| C-exp-3 | met | `minmax(17.5rem, 1fr)` single row | r8-expanded: C-exp-3 |
| C-exp-4 | amended (226) | CSS subgrid, five rows | r8-expanded: C-exp-4/5 |
| C-exp-5 | met | `OutputCard.tsx` rail and head | r8-expanded: C-exp-4/5 |
| C-exp-6 | met | metric row opens details under every run | r8-expanded: C-exp-6; redesign.spec |
| C-exp-7 | met | Trace drawer and issue dialog unchanged | r8-expanded: C-exp-7; items.spec |
| C-exp-8 | met | `SweepView` modal renders `ItemDetail` | r8-sweep: C-sw-7/C-exp-8 |
| C-sw-1 | met | `SweepView.tsx`; sidebar and scope bar removed from the Sweep | r8-sweep: C-sw-1 |
| C-sw-2 | amended (<= 80) | `.verdict` with a 3 px edge | r8-sweep: C-sw-2 |
| C-sw-3 | met | one row of five fields | r8-sweep: C-sw-3 |
| C-sw-4 | met | one frame, five cells, edge by verdict | r8-sweep: C-sw-4 |
| C-sw-5 | met | 31 px rows | r8-sweep: C-sw-5/6 |
| C-sw-6 | amended (62) | seven coloured cards | r8-sweep: C-sw-5/6; cohort.spec outcome cards |
| C-sw-7 | met | dots + k/n, move pill, row opens the modal | r8-sweep: C-sw-7 |
| C-sw-8 | met | 2 per row at 390 | r8-sweep: C-sw-8 |
| C-state-1 | met (measured placeholders) | `CompareSkeleton.tsx` | r8-states: C-state-1 x3 |
| C-state-2 | met | unchanged `EmptyState` | r8-states: C-state-2 |
| C-state-3 | met | `ComparePage.tsx` message lists 5 ids then + N more | r8-states: C-state-3 |
| C-kbd-1 | met | tab order test | r8-a11y: C-kbd-1 |
| C-kbd-2 | met | Enter / Space on count, segments, cards | r8-averages, r8-overview, r8-categories-errors |
| C-kbd-3 | met | axe 1440 and 390 | r8-a11y: C-kbd-3 x3 |
| C-side-1..5 (H2) | met | `ItemsSection.tsx` + `ReportLayout` | scope-sidebar.spec: H2 x3 |

Counts: 87 rows above (82 + the five sidebar criteria as one row). Met as written: 66; met with an owner decision or a small addition: 6; amended with the measured number in `compare.md`: 14 (C-page-5, C-page-6, C-run-1, C-avg-3, C-ov-1, C-cat-2, C-cat-5, C-row-3, C-exp-4, C-sw-2, C-sw-6, plus the 390 limits of C-page-5 / C-row-3); not met: 0.

## Deviations (measured reasons)

- The "What differs between the runs" disclosure moved from under the cards into a popover in the Runs head (`RunsDiff`), so the cards keep their height and the first screen holds the whole Averages table (C-page-1).
- The Analyze popover left the toolbar; Auto-analyze sits in the Items head only when an analysis exists (C-items-1).
- Item-row chips: swatch + letter + value is 78 px wide, so four chips fit one line at 1440 and 1024 but 8 runs at 1024 drop under the title; at 390 the swatch steps aside (59 px chips, four on one 247 px line).
- Text labels (filter fields, banner, sidebar) use run names without the swatch; the letter badge appears in every visual place.
- Categories keep a Cards | Table switch (React-only, section 4); the per-run noise pill of category rows is only in the change cell's tooltip (it does not fit the 5.5 rem change column).
- Placeholders of the loading frame are the measured loaded heights of the four-run page; a wrapping run name moves them by a line.
- New raw `<table>` markup (Averages, Error cards, What differs) and `.card` classes are allow-listed in `design-language.test.ts` with the round 8 reason; `--bar-link-h` (36 px) is a new token documented in `docs/DESIGN_LANGUAGE.md`.

## Existing specs changed (never deleted)

`a11y` (Quick filters tab stop, remove-only buttons, item head), `cohort` (verdict word moved to Sweep only, run counts, dialog title), `deeplink`, `filters` (banner replaces the chips row and delta line), `fixes` (running badge, diff popover, Auto-analyze), `items` (head selector, Auto-analyze popover geometry), `layout` (chips and run key replace the heat-strip header), `matrix` (rewritten for cards), `multi-dataset-notice` (diff popover), `redesign` (36 px nav, 4-up cards at 8 runs, details at the same top, 390 nav), `scope-sidebar` (H2), `selection` (changes read from the averages), `ux-layout` (36 px nav, blocks at 390), `visual-language/sticky-bars` (`--bar-link-h`). Each assertion changed only where the design changed what it measured.

## Mock bugs found

- `Round8Mocks.tsx` passed an icon `size={10}` that the Icon type does not allow (fixed to 12).
- The mock's 8-run numbers (runs 551, averages 366) were measured without letters; see the amendments table.
