# Runs list / Charts / Overview — UX decision (area 03, step 3)

Method: Playwright (Chromium, dark, 1440x900 and 1024x768) against
`/app/__mock/runs-list/{dense,inline,rail}`; every screen and demo state
screenshotted and looked at; journeys J1-J8 driven by mouse and keyboard with a
step counter; axe-core per variant/screen. Scratch output lives outside the repo.
A "step" = one click, one key press or one typed string.

## Verdict

**Pick A (dense table), after fixing its blocking defect, and rebuild the inside
of its Filters popover from C's faceted lists.** A has the best density (32 px
rows, 10 columns at 1440, 20 rows on the first screen), the cheapest keyboard
path to the table (4 Tab stops vs 11 for B and 55 for C), and the Status/Signals
split is the only treatment that fixes the overloaded status badge. As built it
cannot filter by any facet (see defect 1); B is the only variant that is both
complete and working today, so it is the fallback if A's popover cannot be fixed
cheaply. C is rejected as the primary: it wins on steps and discoverability but
costs 240 px (4 columns at 1024, Charts cramped) and 55-80 Tab stops.

## Scores (1-5, as built)

| Criterion | A dense | B inline | C rail |
|---|---|---|---|
| Task success | 2 (facets unusable) | 4 | 4 |
| Steps | 3 (est. 9 for J2 once fixed) | 3 (8) | 5 (4) |
| Discoverability | 3 (filters behind a popover; chips help) | 5 | 5 (all values + counts) |
| a11y | 4 | 3 | 2 |
| Density / scanability | 5 | 3 | 3 |
| Consistency with shell | 4 | 5 (today's IA, dropdown pattern) | 3 (second nav column inside content) |
| **Total (/30)** | **21** | **23** | **22** |

Note the as-built total favours B; the recommendation is A because its defect
is a single nested-popover bug whose fix (inline checkbox groups) is exactly
what C already built, while B's costs (40 px rows, 2-line bar, 12 rows/screen
at 1024) are structural. If the team prefers zero risk, ship B.

## Density (collapsed passes panel, no horizontal scroll)

| | Row height | Columns fully visible @1440 | @1024 | Rows on first screen @1440 / @1024 |
|---|---|---|---|---|
| A | 32 | 10 (Run..Experiment; Version cut) | 6 (Run, Status, Signals, Task, Model, Dataset) | 20 / 16 |
| B | 40 | 9 (Run..Experiment) | 6 (Run..Owner; Date cut) | 15 / 12 |
| C (rail open) | 32 | 8 (Run..Analysis) | 4 (Run, Status, Task, Model) | 20 / 16 |

All variants: table is ~2600-2700 px wide, so Actions is ~1300 px off-screen
(not sticky) in every variant.

## Journey step counts

| Journey | A dense | B inline | C rail |
|---|---|---|---|
| J1 scan (steps to see run list) | 0 | 0 | 0 |
| J2 model=gpt-4o + status=Completed, sort Date, open run: mouse | BLOCKED (est. 9: Filters, Models, gpt-4o, close, Status, Completed, Done, Date, run) | 8 measured (Models, gpt-4o, Status x2 because the first click only dismisses the open popover, Completed, Esc, Date, run) | 4 measured (2 checkboxes, Date, run) |
| J2 keyboard: Tab stops from `/` search to first sort header / first run link | 4 / 23 | 11 / 30 | 55 / 74 (every "Only" button is its own stop) |
| J3 read live status of a running run | 0 (badge + progress glanceable) | 0 | 0 |
| J3 learn what a signal means (hover or focus) | tooltip never appears (defect 2) | same | same |
| J4 select 2 + Compare: mouse | 4 | 4 | 4 |
| J4 select 2 + Compare: keyboard | 5 (j x j x c) | 5 | 5 |
| J5 open row More-actions menu | 3 (scroll right ~1300 px, click, pick) | 3 | 3 |
| J6 expand/collapse repeat run | 1 click / Enter on chevron | 1 | 1 |
| J7 Charts: filter to one model | BLOCKED (same popover; est. 7) | 3 (Models, gpt-4o, Esc) | 1 |
| J7 Charts: Grouped / legend toggle | 1 / 1 | 1 / 1 | 1 / 1 |
| J8 Overview: Origin Local | 1 | 1 | 1 |

J8: the mock's Origin switch does not change the displayed numbers (scope
label stays "All runs"); this is a mock data gap, not a variant difference.
Opening a run does not navigate in the mock, so "come back" (J2.7) was not
testable.

## axe-core (serious/critical, dark, 1440 and 1024)

| Rule | Where | Verdict |
|---|---|---|
| aria-valid-attr-value (critical) | Runs/Charts/Overview tabs: `aria-controls` points at a tab panel that does not exist | Shared mock chrome (Tabs with no panels); all 3 variants. Real shell must render a tabpanel or drop aria-controls. |
| label-content-name-mismatch (serious, x2) | Charts legend ToggleButtons, `aria-label="gpt-4o, 22 runs"` vs visible "gpt-4o 22" | Shared ChartsScreen; make accessible name start with the visible text. |
| color-contrast (serious, 4.47 vs 4.5) | C selection sheet "Delete" label, #ef6666 on #3b2634 | C only (bottom sheet); lighten danger text on tinted bg. A/B select state is clean. |
| none | A Filters popover open, B Models multiselect open, Overview, 1024 runs | clean |

Moderate/minor (all variants): `region` (no landmarks in mock), `page-has-heading-one`,
`empty-table-header` in select mode (checkbox column header needs a hidden label).

## Blocking defects in the mocks

1. **A: every facet is unusable.** Opening Models/Datasets/Status/etc. inside the
   Filters popover closes the whole popover, by mouse and by Enter on the
   keyboard (`MultiSelect` popover is portalled, so React Aria treats the click as
   an outside press on the parent). Charts uses the same popover, so it is blocked
   too. Fix: replace the nested MultiSelects with inline checkbox groups (C's
   facet list), or use a Dialog-based panel instead of a Popover.
2. **All: signal tooltips never show** on hover or keyboard focus. `Tooltip`
   expects a React Aria trigger; `Signals` passes a native `<button>`. Use `Button`
   from react-aria-components (or IconButton). The aria-label still works for
   screen readers, which is why axe is clean.
3. **C: rail is not keyboard-viable.** 55 Tab stops to reach the table header
   (74 to the first run), because every facet checkbox plus its "Only" button is a
   stop. Needs a skip-to-table link and "Only" as a context action, not a stop.

Other defects (non-blocking): B multiselect shows counts glued to labels
("claude-sonnet-421"); A/B selection bar wraps to two lines and says "2 selected"
and "2 executions selected" at once; C selection sheet covers the last rows;
A toolbar wraps Columns/Select to a second row at 1024 with active chips; A's
status bar is not pinned (floats under a short table at 1024); Actions column is
not sticky in any variant and the passes panel leaves a blank gap when the table
is scrolled right; demo state auto-expands a repeat run, pushing rows off screen.

## Borrow list

From **C** (into A's Filters popover): checkbox facet lists with live counts
(counts reflect other active filters); "Only" shortcut as hover/focus action but
not an extra Tab stop; "Filters . n" count in the trigger and Clear all.
From **B**: pinned status bar (sentence + pager + Last updated never scroll away);
Time-range and Origin segmented controls inline in the bar at >= 1440 (they are
used every session and are one click there); the "Clear (n)" affordance beside
the bar; the `Versioning: none` hint text; the Models-style searchable
Select all / None multiselect if a popover facet list grows past ~12 values.
From **A** (keep): Status vs Signals columns, chips in URL order, sticky Run
column, 32 px rows.
Fix everywhere: single-line selection bar (dedupe the count text), sticky Actions
column or a row-level actions key, tooltip trigger, tab-panel/aria-controls,
legend accessible names.
