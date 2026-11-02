# Admin + Docs — UX decision (area 09)

Method: Playwright/chromium, dark, 1280x800, 1000x700, 760x900; every variant screenshotted and read; journeys scripted with click counts; axe-core run at 1280 (serious/critical only); console errors captured. Scores 1-5 (5 best). Click counts are real counts from the scripts (Escape/typing not counted unless noted).

## Admin

| Criterion | tabs | rail | sections |
|---|---|---|---|
| Task success | 5 | 4 | 4 |
| Steps to complete | 5 | 3 | 4 |
| Discoverability | 5 | 3 | 3 |
| A11y | 4 | 4 | 4 |
| Density | 3 | 3 | 2 |
| Consistency with ProjectSettings/Profile | 5 | 3 | 3 |
| **Total /30** | **27** | **20** | **20** |

Measured clicks (open page -> done):
- Force stop a live run: tabs 2, sections 2, rail 3 (menu).
- Disable + Undo from Users: tabs 4, sections 4, rail 5.
- Edit user -> Reset password -> one-time password shown: tabs 3, sections 3, rail 4 (from Users).
- Irreversible job: tabs 3 clicks + type + queue (inline field, button disabled until exact match, "Does not match the job name"); sections 3 clicks + dialog typed confirm (7 steps incl. typing); rail same as tabs. Job log drawer: tabs 1, sections 1, rail 2.
- Axe (serious/critical): none on all three. Console errors: none.

Observations: all three share the same panels, so dialogs, toasts, one-time password, drawer and typed confirm behave identically and well. Differences are navigation and danger styling. At 760px the tables scroll horizontally and the action column (Force stop / "...") is off-screen in all three. Toasts stack over the topbar "Go to" button. Tabs puts the 3-cell StatStrip above the tabs (72px+ on every tab); at 760 it wraps to 2+1 with an empty fourth cell. Sections: sticky jump bar sits above the stats, ~60px dead gap under it, ~300px of stats/heading before the first table, quiet ghost actions are easy to miss. Rail: loses 220px, tables clip (progress "212/500.."), HelpMarker lost, actions hidden behind "..." (poor for the watch-and-stop journey).

**Winner (admin): `tabs`** (27 vs 20/20). Same composition as ProjectSettingsPage, fewest clicks, every action one click away, URL-addressable. Its only weakness (loud red buttons, stat strip height) is cheap to fix.

### Adjustments to apply to `tabs`
1. Replace the red `Button variant="danger"` in rows with a quieter treatment: neutral/secondary Button with danger text only on hover/focus (keep red for the terminal ConfirmDialog and the irreversible "Queue job" button). Keeps one-click speed, removes the red column.
2. Move the StatStrip below the tabs only for Runs, or make it `compact-header` (single 40px line "5 users · 3 projects · 12 runs" with the HelpMarker kept on runs); do not repeat 72px+ above Projects/Users/Maintenance.
3. Keep the action column visible at <=900px: make the actions column sticky-right (or collapse to an IconButton menu below 900px only), so Force stop / Edit / Disable never need horizontal scroll.
4. 760px stat strip: use a 3-column auto-fit or stack as 1 column; remove the empty fourth cell.
5. Position toasts bottom-right (or offset below the topbar) so they never cover the "Go to Ctrl K" button.
6. Maintenance tab: make the page less long: collapse the Database KeyValueGrid into a 2-row header and move "Demo: Postgres" behind a dev-only flag; keep the SQLite notice.
7. Irreversible job: keep the inline typed field (button disabled until exact match, helpful mismatch text); additionally associate the error with `aria-describedby`.
8. Add `?tab=` to the real route as `/admin/<tab>`; keep counts on tabs (Runs live count is useful).
9. Live runs: announce polling only via the existing status line (no per-poll toasts); keep the "polling" badge.

## Docs

| Criterion | three-column | two-column | hybrid |
|---|---|---|---|
| Task success | 4 | 4 | 5 |
| Steps to complete | 4 | 3 | 4 |
| Discoverability | 3 | 4 | 5 |
| A11y | 3 | 4 | 3 |
| Density | 5 | 3 | 4 |
| Consistency | 4 | 3 | 4 |
| **Total /30** | **23** | **21** | **25** |

Measured: `/` focuses search from the content area in all three; typing then Enter opens the first match (3 actions). TOC highlight follows scroll in all (e.g. "Create a project API key" -> "Dataset read tokens" at 1100px in the 3-col layouts); in two-column the inline TOC card scrolls away so the highlight is invisible after the first screen. Copy button copies the exact code to clipboard in all (label "Copy code"); no toast text was observed in a status/alert region. Prev/next render and the "Next" label sits misaligned over the chevron. Narrow (760): three-column and hybrid show the "On this page" `<details>` disclosure with the current heading in the summary; two-column keeps its inline card (no substitute needed). At 760 the nav rail in all three is clipped to ~6 rows in a short scroller (three-column stacks it above the article; two/hybrid layouts overlap awkwardly with the results popover). Console errors: none. Mock pages are a single page, so cross-page navigation/scroll reset was not testable.
- Axe at 1280: three-column and hybrid: `scrollable-region-focusable` (serious) on the code `<pre>`; two-column clean at 1280 but the same `<pre>` overflows at narrower widths so the same defect applies.

**Winner (docs): `hybrid`** (25). Nav stays intact (orientation preserved), popover results show "Section > Page / heading" crumbs with Enter hint, sticky TOC always shows position, `<details>` substitute at narrow widths.

### Adjustments to apply to `hybrid`
1. Give every code `<pre>` `tabindex="0"` plus `role="region"` and `aria-label="<language> code"` (fixes the axe serious finding).
2. Wire the results popover as a proper combobox: `role=combobox` on the input, `aria-expanded`, `aria-controls`, `aria-activedescendant`, ArrowUp/Down to move, Enter opens active, Escape closes then clears; first result pre-selected.
3. Narrow layout (<=900px): collapse the nav into a "Docs menu" disclosure/Drawer (current page in summary) instead of a 6-row clipped scroller; keep search above the article; popover must not overlap nav items.
4. Fix prev/next: align the "Previous"/"Next" label stack to the chevron (label above title, both left/right aligned consistently), make the whole control the link target, add `rel=prev/next`.
5. Copy button: show a visible "Copied" state (icon swap for 1.5s) and announce via the shared status region; keep aria-label "Copy code".
6. On page change and on Next/Prev, scroll `#shell-content` to top (or to the heading anchor) and move focus to the h1 (tabindex -1) so keyboard/screen-reader users land on the new page.
7. Search: also match page descriptions, cap heading hits to ~6 per page with "+N more", and show "No results" with the query.
8. Keep the `#` anchor invisible until hover/focus but ensure it has a visible focus ring and the heading id deep link scrolls under the sticky topbar offset (scroll-margin-top).
9. Keep prose on `--docs-*` tokens; wrap tables in a focusable scroll region (same `tabindex=0` rule) for narrow widths.
