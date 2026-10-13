# Review: report-pages (run detail, compare, cohort Compare, Sweep)

Branch `ui/redesign-report-pages` at 919f8d2f. Reviewer used the running UI (platform 8858, Vite 5858, legacy 8860), Playwright
scripts at 1440 / 1920 / 1100 / 390 px in the dark theme, a 240-item run, a 5,000-item run, a live run, a repeat run, a
locked run, a 4-run compare, a 2+2 cohort and a 20-run (2 x 10) compare. Screenshots: orchestrator scratchpad `rpr/shots/`.

## Verdict

**DOES NOT MEET the standard yet, by a short polish pass (well under a day).** The feedback point itself is met: both pages
are stacked, full-width, legacy-ordered reports, and the quick-filter sidebar exists only while the item set is narrowed.
Three majors keep it from sign-off: charts that balloon to 2-3x text size at report width, compare deep links that land
about half a screen short, and a scope that is not visible while reading lower sections.

## Does the page answer the feedback?

| Point | Evidence | Result |
|---|---|---|
| Stacked report, every section a full view | run: Overview, Repeat, Latency and traces, Deep, Categories, Errors, Root cause, Items last (`rpr/shots/new-run-t-*.png`); compare: Runs, Averages, Overview, Categories, Steps, Errors, Root cause, Items (`new-cmp-t-*.png`). Same order as legacy (`leg-run-t-*`, `leg-cmp-t-*`) | Met |
| Sidebar only when items are chosen | no scope: no sidebar, no ScopeBar (all of `?sort`, `?pass`, `?metric&threshold`, `?view=heatmap`, `?item=` verified). Scope: `?q`, `?show=failed`, a score-bucket click, `filters=` open it (run); delta count button opens it (compare, `c1-scoped-top.png`); `sweepMove` opens it (Sweep, `c2-sweep-scoped.png`) | Met, matches spec 5.4 |
| Hide persists | Hide writes `qym:report-sidebar-hidden=1`, survives reload; "Show filters" in the ScopeBar restores; shared key between run and compare | Met |
| 1200 px fallback | 1100 px: no inline column, ScopeBar button "Quick filters" opens a Drawer (dialog role, Escape closes); 390 px: same, no horizontal page overflow on the run page | Met (see minor on duplicate title) |
| Old links | `?panel=overview|latency|deep|categories|errors|items|repeat`, `#overview...#items`, `#run-section-errors`, `#summary` all land with the header just under the nav (offset -40 px which is the section padding); `?item=item-0100` expands the row on its page and scrolls to it; `?trace=` opens the drawer; `?view=heatmap` renders the grid. Compare: `?panel=categories|overview|metrics` and `#items` land; **`#errors` and `?panel=errors` do not** (M2) | Mostly met |

## Evidence table (measured)

| Check | Result |
|---|---|
| 5,000-item run, Vite dev server | items table ready ~1.0 s, network idle 1.5 s, one 138 ms long task, 12 API calls; legacy (built) 1.1 s with 17k DOM nodes vs 1.2k here. Slow scroll top to bottom: p95 frame 16.7 ms, 0 frames > 50 ms, no long tasks. Opening and clearing a scope: 134 / 132 ms, no long task |
| 20-run compare (2 x 10 auto-cohort, 400 items) | item list visible 1.3 s, idle 1.5 s, two long tasks (162 ms max), scroll max frame 50 ms once, no CLS; sticky chrome 156 px |
| 4-run compare sticky chrome | 178 px of a 900 px viewport (chips + delta line + nav), see `c1-stuck.png` |
| Live running run (30 items, +15 pushed in 3 batches, then completed) | count, Overview "N items", ScopeBar "20 of 30 -> 30 of 45" all follow every push within the 10 s poll, scroll position unchanged, live indicator gone and status COMPLETED after the end event, no console errors |
| Layout shift | scrolling top to bottom: CLS 0.003 (run), 0.000 (compare). Fast jump to Deep: one 0.076 shift (Categories placeholder 280 px replaced by its real body); acceptable |
| Section jumps and scroll-spy | each nav link lands at the same offset (-40 px run, -31 px compare), and the highlighted link is the one clicked, including Errors and Items after lazy sections above mounted |
| axe serious/critical | none on run, run scoped, run 390, compare, compare scoped, compare 390 (all lazy sections mounted first) |
| Scope definition | exactly as spec 5.4; sort, page, metric, threshold, `?pass=`, heatmap, `?item=` do not open it |
| Gate | see "Gate" below |

## Compare with legacy (side by side)

Run: legacy and new have the same sections in the same order; the new page adds the sticky nav with scroll-spy and counts.
The 3-up metric cards, the 2-up latency pair, the 4-column category cards and the full-width time budget, step table and
error cards match the legacy density. Differences: charts (M1), hero is taller because it shows the meta grid plus
Versioning details before Overview starts (Overview header sits at y=660 of 900 at 1440 versus 525 in legacy), the
metric-card grid leaves the 4th card alone on its row with unequal card heights.
Compare: legacy order kept; run cards, averages table, overview strip, winner and distribution bars, category table, error
cards and the item list are all readable without clicking. The averages table is transposed relative to legacy (runs as
rows), pre-existing. Cohort Compare tab: one-line sides banner above the same report; Sweep unchanged in structure.

## Fix list

### Blockers
None.

### Major
1. **Charts scale with their container instead of re-flowing.** `Scatter` (`frontend/src/features/run-detail/components/charts/Charts.tsx:202`, viewBox 300 x 220) and `CurveChart` (same file, viewBox 320 x 180), and likely the repeat distribution, are scaled by CSS to the new half-width column, so tick labels and dots are about 2x legacy size at 1440 and about 3x at 1920 ("100%" and "latency" axis text near 20-30 px, `rpr/shots/new-run-t-1.png`, `w1-1920-latency.png`, `new-rep-t-0.png`), and the latency histogram next to the scatter is a different height. Spec section 6 (R2) and the risk list required width-responsive charts. Fix: measure the width (the ResizeObserver already used elsewhere in `Charts.tsx`) and compute W/H and font sizes from it, or cap the chart width and height and keep one aspect ratio per panel; align the pair heights.
2. **Compare deep links land about 480 px short.** `#errors` and `?panel=errors` leave `#compare-errors` 477 px below the nav (nav clicks land correctly). `useSectionAnchor` does one `scrollIntoView` after 50 ms (`frontend/src/features/compare/components/ReportSections.tsx`, `useSectionAnchor` and `scrollToSection`) and lazy sections above then grow. The run page re-aligns with a ResizeObserver (`RunBody.tsx` `scrollToSection`); reuse that. Also compare nav clicks use smooth scrolling while the run page is instant: make both the same.
3. **The scope is invisible while reading lower sections.** The ScopeBar scrolls away (it is not sticky, spec 5.8 asks for sticky under the nav below 1200 px) and the sidebar omits the "Active" chip list the spec's 5.6 puts first, so after scrolling to Categories or Items a bucket, latency or rule filter shows only as "Filters (1)" on the run nav and nothing on compare except the count. The implementer's "ScopeBar already lists them" holds only at the top of the page. Fix: add the Active group (the same chips, same remove labels, one set rendered per viewport) to the sidebar and the drawer, and make the ScopeBar sticky below 1200 px (`frontend/src/ui/ScopeBar/ScopeBar.module.css`, `frontend/src/features/*/components/QuickFilters.tsx`).

### Minor
1. Dead band between the nav and the first section: nav bottom border, 64 px of space and a second hairline (run `new-run-t-0.png` y 567-630, compare y 295-357). Drop the section's top rule for the first section or the nav border.
2. Metric cards: uneven heights in a row and an orphan 4th card (legacy equalised); `Panels.module.css` grid `align-items: stretch`.
3. At 390 px the section descriptions are cut with an ellipsis ("Score distributions per metric. Click a bar to filter the ..."); let them wrap (`SectionHeader.module.css`).
4. The Drawer shows "Quick filters" twice (drawer title and the sidebar's own heading) below 1200 px (`rpr/shots/r1-390-drawer.png`).
5. In Sweep with a scope the ScopeBar sits flush on the "Sweep" heading (no bottom margin, `c2-sweep-scoped.png`).
6. Removing a run on compare returns to the top (deferred item): keep the scroll position instead of remounting; changing the baseline already keeps it.
7. Compare sticky chrome is 178 px at 4 runs (about 22 percent of an 800 px laptop viewport); the spec asked for compact. Consider un-sticking the chips row and keeping only the nav sticky below 1000 px height.
8. Lazy sections: browser find-in-page cannot see unmounted bodies and the scrollbar thumb resizes as 280-360 px placeholders become 600-900 px sections; acceptable, mention in docs.
9. The compare run labels read "gpt-5-mini - Oct 1 03:00 PM #1" where legacy shows the run name; pre-existing, not part of this work, noted for the compare owner.

## Deferred section, reviewed critically
- Instant section jumps: acceptable and better than smooth given lazy sections mounting under the travelling scroll (the run page lands exactly, verified for all links). But compare still scrolls smoothly and misses (M2).
- No Active chip list in the sidebar: not acceptable as shipped (M3); the justification only covers the top of the page.
- Compare run removal returning to the top: minor (m6), fix by keying the remount on the run set only when the baseline changes.
- X2 manual QA was skipped by the implementer; done here (table above).

## Code
- Primitives used and added in `frontend/src/ui` (`ReportSection`, `ReportLayout`, `ScopeBar`, `QuickFilterGroup`, `useInView`), exported, gallery entries, Vitest in `ui/__tests__/report.test.tsx`. No `any`. The two scope hooks and `scope.ts` modules are duplicated between run and compare in shape but not in logic; `useSidebarHidden` and `HIDDEN_KEY` are implemented twice (`run-detail/hooks/useScope.ts`, `compare/components/CompareBody.tsx`), consolidate in `ui` or `lib/storage`.
- Three `eslint-disable react-hooks/exhaustive-deps` added in compare (`useScope.ts:13`, `ComparePage.tsx:138`, `useCompareSearch.ts:128`); the first one is new in this branch and has no reason comment, the others predate it.
- Dead code: none found in the removed panels.

## Gate (measured by the reviewer)
- `npm run check`: typecheck, eslint, stylelint clean; Vitest 120 files / 1110 tests passed; design-language test 34 passed. `pytest tests/platform/test_design_language.py`: 1 passed.
- `npm run build`: green.
- Playwright `e2e/run-detail e2e/compare e2e/shell` (381 tests, 2 workers): 373 passed, 8 skipped, 0 failed (4.2 min). The specs cover scope open/close, Hide, drawer and the nav, but none asserts where a compare `#errors` deep link lands (M2), nor chart text size (M1).
