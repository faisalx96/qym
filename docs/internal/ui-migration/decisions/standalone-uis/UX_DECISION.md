# SDK viewer: UX decision

Method: Playwright against the Vite dev server, 1440x900 and 1024x700, states default/error/empty/file, keyboard walk (Tab, ArrowDown, Enter, Escape), RTL, long row 6, error row 8, horizontal scroll, console. Screenshots were kept outside the repo.

## Scores (1-5, higher is better)

| Criterion | stats-table | split | timeline |
|---|---|---|---|
| J1 watch live run: task success / discoverability | 4 | 3 | 5 (ribbon shows progress front and failures with no scroll) |
| J2 open saved file + edit score: steps | 4 (open overlay, edit; hides table) | 5 (arrow, edit; no open step) | 5 (same, plus ribbon jump) |
| Find and inspect failures (steps) | 3 (filter or scroll) | 3 | 5 (click red cell: 1 step) |
| Compare answers while scanning | 5 (output+expected inline) | 4 | 2 (answers only in detail) |
| A11y (focus, keys, ARIA, RTL) | 4 | 4 | 4 (ribbon is an extra tab stop, labelled "Row N: Done") |
| Density at 1440 | 4 | 5 | 4 |
| Density / robustness at 1024 | 2 (stats stack, ~270px before table) | 2 (table cramped, text truncated to 2 chars) | 4 |
| DESIGN_LANGUAGE / platform look | 4 | 4 | 4 |
| **Total** | 30 | 30 | 33 |

Common to all three (verified): no horizontal page scroll in any state or viewport; Arabic cells and detail blocks render RTL; error row 8 shows its message (red in list, callout in detail); Escape closes detail and focus returns to the row; 2px accent focus ring on every control; disconnected banner and waiting state render. Common defect: console warning "Each child in a list should have a unique key prop" in all live/file states.

## Winner: timeline

Reasons
1. It is the only layout that answers "is it done, did anything fail, where" in a single glance and one click (red cell opens the failure), which is the core of journeys 1 and 4 and fixes the legacy pain "errors invisible".
2. The persistent detail pane makes file score editing a 2-step flow (select, type), with no overlay hiding the table (stats-table) and without the cramped table of split.
3. It holds up best at 1024: compact list needs no truncated multi-column text; the ribbon wraps cleanly to two lines.
4. Cost accepted: Output/Expected are not in the list. Mitigation below.

## Must-fix for timeline (priority order)

1. Row 8 (error) in file state: edit inputs show 0 / 0.40 / 0.60 while the displayed scores read n/a. Inputs must be empty (placeholder "n/a") for missing scores, or the row must not be editable. Risk: silent data corruption on save.
2. Score edit has no explicit Save/Cancel, dirty marker or confirmation; the inputs are tiny (about 50px) and unlabelled for sight users ("Edits are written back..." is the only hint). Add a labelled input, a dirty state, and a Saved/Error status text (aria-live).
3. Empty state (?state=empty): the pane still says "Pick a cell in the ribbon... Red cells are failures: start there." and the ribbon is empty, plus "0 / 0 finished". Show a neutral hint, or hide the pane and ribbon until rows exist. Export CSV is shown (dimmed) with nothing to export.
4. Metric header labels are cut off in the list ("EXACT_M", "FUZZY_M", "LLM_JUD"); add title/tooltip and a wider column or abbreviation. The list shows only 3 metrics columns before clipping at 1440; more metrics will clip the table.
5. Long output (row 6): detail output box is height-clipped mid-line with no visible scrollbar or "show more"; add a visible scrollbar/fade and an expand control. Same for the Output cell in list (Output not shown at all). Consider a one-line output preview column.
6. Score colours: 0.00 and 0.40 render red/orange identically for "exact_match 0"; the red-to-green ramp on every score cell is loud and competes with the failure red of the ribbon. Use neutral text with a small tone chip, reserve red for failures.
7. Header chip with the file name is truncated ("...gpt-4o-m") at both viewports; give it a title and an ellipsis in the middle, or move to a second line.
8. At 1024 the ribbon wraps to two lines and the stats row is 120px tall; make cells 12px or cap ribbon height with a scroll for runs of 300 or more rows.
9. Tab order: 10 Tab presses (ribbon, search, status, Export, 6 sortable headers) before the first row. Add a skip link or make Export come after the table; ensure Tab from the last detail input moves to the next logical element (currently reaches the browser UI/BODY).
10. Fix the React "unique key" warning (all states) before it ships.
11. Add a sticky table header and keep the ribbon visible while scrolling the list (verify at 300 or more rows).
