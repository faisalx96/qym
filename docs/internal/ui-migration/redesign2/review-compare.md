# Review: redesign2 compare (ui/redesign2-compare)

Reviewer pass on the running UI (platform 8905, Vite 5905, legacy 8907), seeded with 9 aligned runs (4 + 3 extra single runs + a repeat run). Captured 2, 4 and 8 runs and cohort at 1440 and 390, expanded items with and without an opened metric, `catView=table`, hover focus. Legacy compared side by side.

## Verdict: PASS with a short fix list (no blocker)

The page now reads like the legacy document with better structure: every run is swatch + letter + name in the cards, averages header, winner legend, category cards, error cards, items header and output cards; the sticky bar is one 44 px row; averages are metric rows by run columns; category cards carry a baseline tick; error cards list every run; expanded items put runs on one row with run-colour rails and a "Best" tag; a metric click opens aligned details under every run; hovering a run dims the others (measured opacity 0.45 on the three other cards); `catView=table` works; the "Biggest change vs baseline" sort exists in Display. Legacy had no item column headers or counts per cell, so the new matrix is an improvement there.

## Checks run
- `npm run check`: tsc, eslint, stylelint pass; Vitest 1187/1188. The one failure (experiments settings "All roles", 5 s timeout under load) passes alone (21/21): a load flake unrelated to compare.
- `npm run build`: OK.
- Playwright `e2e/compare e2e/shell e2e/visual-language e2e/run-detail` via heavy.sh: 427 passed, 8 skipped (session-auth specs that need `proxy_headers` mode), 0 failed (6.5 min).
- Hover audit: `PENDING` is an empty set and the audit passes strict for runs list, run detail and compare.
- Nothing from round 1 / qa/compare.md regressed on the evidence of the specs (scope-sidebar, deeplink, filters, cohort/Sweep, export all green); Sweep tab and Compare/Sweep switch visible for cohorts and for 2 runs.

## Fix list (for the implementer, none blocking)
1. Run card header wraps unpredictably (RunCards.module.css `.cardHead` flex-wrap). At 1440 with 4 runs cards A and B push the star and X to a second, empty row while C and D keep one row; at 390 all four cards wrap. Make the head `flex-wrap: nowrap`, let the name truncate, keep actions on the line.
2. Expanded item at 4 runs on 1440: cards are `minmax(20rem,1fr)`, so only 3 fit and the 4th is cut off with no visible cue in the screenshot. Either lower the min to about 16rem when n <= 4 or show the edge cue/scroll hint.
3. Categories: the key chips ("complexity 3", "domain 4") render below all cards, away from the heading; move them above the cards (or into the section header). In Table view each key is its own table, so run columns do not line up between "complexity" and "domain" (about 20 px jitter); share one column template.
4. Averages Errors row at 8 runs is clipped ("1 task . 1 score"); use the short form or wrap at narrow columns.
5. Run colours 6 to 8 reuse hues close to 1 to 3 (A teal vs H green, C purple vs G indigo, B blue vs G). Letters and names disambiguate, as the spec accepted; consider a second hue family later.
6. Cohort mode: run cards show letters A to D beside the "A / B" sides banner and do not say which side a run belongs to; add a side tag on the card.
7. 390: the sticky bar is cramped (nav clipped at "Errors", selects wrap onto two lines with a stray "Baseline" label); the View popover is only used between 641 and 1199 px. Consider the popover at phone width too.
8. 2 runs open in the sides layout (Compare/Sweep, no Baseline select, no remove) so the baseline cannot be swapped; confirm this is intended (it matches round 1).
9. Small: in the averages matrix the noise glyph floats far right of the delta tag; baseline column cells use a different alignment from run columns (T3 in the implementer's Deferred list: no baseline column fill).

## Deferred list check
T3 (baseline column fill) and T7 (cell tooltip text) are honestly listed; both low value.

## Counts
Screenshots captured and viewed: 36 (react 2/4/8/cohort at 1440 and 390 tiled, legacy 4/8/cohort, expanded 4/8 at both widths with and without a metric, category table, hover). Findings: 0 blocker, 4 medium (1, 2, 3, 7), 5 low (4, 5, 6, 8, 9).
