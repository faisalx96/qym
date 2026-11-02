# Review: redesign2 runs-page (ui/redesign2-runs-page)

Reviewer run on 400 seeded runs (401 incl. one running), ports 8909/5909, legacy on 8911. Viewports 1440, 1280, 900, 390.

## Verdict: NOT YET. Close, two real defects to fix, then ship.

Filters and the Columns menu clearly meet the feedback. The passes panel is much calmer. Two defects block sign-off: the frozen
header cells vanish on horizontal scroll (the very feature asked for), and the passes panel has shadow bands painted over it plus a
cramped last column.

## Measurements

| Task | Before (React Filters popover) | Legacy | Now |
|---|---|---|---|
| Narrow by one model | 4 actions (Filters, Models, Only/tick, Done) | 3 (open, None, value) | 2 (open facet, click value); popover can stay open |
| Second facet | 2-3 more | 2-3 | 2 |

- Facet trigger shows its value ("Model . gpt-4o", "Status . Failed"), accent when active; chip line and `Clear n` appear.
- 1440 and 1280: all six facets inline. 900: Task, Model, Status inline plus `More filters` (Datasets, Versions, Users); `More filters . n` counts hidden actives.
- 390: `Filters` button opens a right-side 360 px Drawer with Time/Origin and disclosure rows. Acceptable (no legacy-style loss of filters); a bottom sheet would be nicer for thumbs but the Drawer is usable. Not a blocker.
- Empty selection renders every checkbox unticked while meaning "All"; legacy showed all ticked. Minor, consistent with trigger label.

## Columns, order, freeze

Works: drag handles with Space/Arrows/Space keyboard reorder and an aria-live announcement ("Model moved to position 4 of 25"), pin
toggle per row, `Frozen (n)` section with `Scrolling columns` below, `Reset layout`, header menu `Freeze column / Move left / Move right /
Move to start`, `Alt+Shift+Arrow`, one header tab stop. Layout persists across reload (localStorage, keyed by user id; not
server-side, logged as deferred). Reset restores the default order.

Defects:
1. **Frozen header cells disappear when the table scrolls horizontally (blocker).** Scrolled at 1440 or 1280 the body keeps Run/Status
   pinned but the RUN and STATUS headers are covered by the scrolled headers (CONTEXT RECALL, DATE, TASK paint over them). Computed
   styles: every `th` has `z-index: 3`; `.table[data-sticky] .thead th` (specificity beats `.th[data-pin]`) overrides the pin's
   `z-index: 4`; only the `data-shift` variant re-raises pinned headers. Same for the band row. Fix: add
   `.table[data-sticky] .thead th[data-pin] { z-index: 4 }` (and for pinned band cells). Check the baseline too, but with Freeze
   now a headline feature it must be right.
2. **50% cap bites too early.** At 1440 freezing Model alone (Run 260 + Status 200 + Model ~160 = ~620 of 1203) gives "Not frozen at
   this width: Model", and the header says `Frozen (3)` while only two are frozen. At 1280 even less fits. Suggest cap 60% or
   narrower default Run/Status widths, and count only effective frozen in the heading ("Frozen (2 of 3)").
3. At 1440 the default view does not show Model, Dataset or Owner (legacy did). They are one scroll away; Date is visible at 1440 and
   its header at 1280 (value cut to "Oct 14"). Acceptable, but with the mid-scroll header bug above it reads worse.

## Passes panel

Good: single header line (`Passes . 3 passes . 8 items`, metric select, `Pass if >= 80%` chip, info icon), threshold popover with
slider, numeric input and 50/70/80/90 presets, five-tile stat band with coloured bars, embedded table on the parent's metric
columns, no horizontal drift (panel x stays 207 while the table scrolls), full width at 1440 and 1280 (right edge not cut, the
earlier cut is fixed), 390 shows a tidy card stack (stat grid, pass cards). Expanded height 261 px for 3 passes (was 236 + extras).

Defects:
4. **Scroll shadows paint over the panel**: a dark vertical band runs through the panel at the frozen-edge x (1440: through the
   threshold chip, Reliability tile, Duration/Issues columns; 1280 scrolled: two bands). The sticky panel needs a higher stacking
   level than the edge shadows or the shadow must be clipped to the table rows.
5. **Embedded table cramped at 1440**: `Duration` and `Issues` collide ("43s". "1") and the Issues header truncates to "ISSU".
6. **Embedded table scrolls under the fixed panel**: after a 400 px parent scroll the pass cells show "0:22" cut mid-text and the Pass #
   and Status columns are gone; make the `#` column sticky in the embedded table.
7. Threshold popover: the helper text sits flush against the top edge (no padding) and the `0.8` readout is clipped.

## Regression checks (round-1 tables review, A1 visual language)

- Score bars with value, Date column present, text in header row sortable, single header tab stop: OK.
- Task tag (mono purple), status tones (RUNNING blue, COMPLETED green, STOPPED amber, FAILED red, APPROVED check, SUBMITTED neutral), failed row red wash with left rail, running row left accent, owner avatar hue (DU): OK.
- Text selection: not hand-verified (double-click selected nothing on a cell in my scripted check); the Playwright suite covers it and passes.

## Gates

- `npm run check`: 129 files, 1199 Vitest tests passed; design-language 44 passed; lint/stylelint/tsc clean; build OK.
- Playwright (runs-list, shell, visual-language, datasets, admin): 431 passed, 11 skipped, 1 failed
  (`cutover-passes.spec.ts:56`, a 30 s timeout waiting for the Expand button, load flake). Re-run: `cutover-passes` and
  `cutover-models` (incl. `:30`) 4x each = 40/40 passed. Treat as a load flake.

## Fix list for the implementer
1. Pinned header z-index above scrolled headers under `[data-sticky]` (blocker).
2. Panel stacking vs frozen-edge shadows (blocker for the passes "calm" goal).
3. Freeze cap: raise or narrow defaults; heading count should reflect effective frozen.
4. Embedded passes table: Duration/Issues spacing, sticky `#` column.
5. Threshold popover padding and readout clip.
6. Optional: bottom sheet at 390, unticked-means-all hint in facet popovers.

## Re-review (commit a0273a62)

Fresh screenshots at 1440 and 1280 (table scrolled sideways, passes panel scrolled, Columns menu with a suspended frozen column).

| # | Item | Status |
|---|---|---|
| 1 | Frozen headers vanish on horizontal scroll | FIXED. RUN, STATUS and MODEL headers stay put over the scrolled headers at both widths. |
| 2 | Scroll shadows painted over the passes panel | FIXED. No dark bands through the panel, scrolled or not. |
| 3 | Freeze cap and count | FIXED. Cap 60%; menu shows "Frozen (3 of 4)" with "Not frozen at this width: Date" at 1440. At 1280 Run+Model+Date fit and read "Frozen (3)". (Note: at 1280 Status is not frozen by default, only at 1440; harmless.) |
| 4 | Passes table Duration/Issues and sticky `#` | FIXED. Issues header intact, `#` and Status pinned while metrics scroll. Cosmetic leftover: the retry icon touches the Duration value ("43s↻"). |
| 5 | Threshold popover padding and readout | FIXED. Padded, `0.8` readout no longer clipped. |
| 6 | Facet empty-selection hint | DONE. Popover now says "Nothing ticked: every value is included." |

Gates: prettier --check on the 10 changed files clean; `npm run check` green (129 files / 1199 tests, design-language 44); Playwright runs-list + datasets + admin 332 passed, 3 skipped, 0 failed. All servers stopped.

Verdict: APPROVED. Remaining (non-blocking): bottom sheet at 390, retry icon spacing in the passes table.
