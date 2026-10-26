# Round 8 review: the compare page

Independent review of `ui/redesign8-compare` (tip `0a709a6f`) against `compare.md` (82 criteria + C-side-1..5) and the owner decisions H1 to H5.
Measured 2026-10-26 by the review agent, Chromium, **production build** (`npm run build`) served by the platform on 8983 (no Vite), SQLite seed of
`frontend/scripts/seed-compare.ts` plus the four extra runs of `measure/seed-extra.mts` (8-run pages). The legacy page (`qym-wt-legacy` 78141838) ran on 8980
with the same seed (database kept in the review scratchpad, the legacy tree untouched). Widths 1440x900, 1024, 390. The app is dark only
(DESIGN_LANGUAGE section 2), so there is no light pass. Shots: `shots/review-*.png`. My scripts were throwaway (scratchpad); the numbers below are theirs.

## 1. Overall verdict: MEETS WITH FIXES

Counts (87 criteria rows = 82 + C-side-1..5 as five): **81 MEETS, 6 MEETS WITH FIXES, 0 DOES NOT MEET.** No blocker. Two required fixes (small), four optional.
Every one of the 14 amendments carries the number, a reason and an e2e assertion (section 4); four of them are looser than the cost of H1/H2 requires (optional fixes).

## 2. Criterion table (required vs measured)

"e2e" = not re-measured by me (data the seed lacks, or an interaction I did not drive); it is covered by the implementer's spec that passed in my gate run (section 7).

| ID | Required | Measured (review) | Verdict |
|---|---|---|---|
| C-page-1 | 1440x900 run-card bottom <= 530, averages-table bottom <= 900 | 509.8 / 876.8 | MEETS |
| C-page-2 | one sticky element outside table pins, 36 | `section-nav` 36; other sticky nodes are the Averages `th` pins | MEETS |
| C-page-3 | no horizontal doc scroll (1440/1024/390) | shell scrollWidth = clientWidth at 1233 / 817 / 319, 4 and 8 runs; only averages (8 runs 1024: 1104 vs 775) and output grid (5+ runs) scroll | MEETS |
| C-page-4 | 0 ellipsis, 0 clipped in run-name, colhead, category row, toggle | 0 / 0 at 1440, 1024, 390, 4 and 8 runs | MEETS |
| C-page-5 | 4 runs 1440: runs 311, averages 355, overview 393, errors 440, items 1375 (+-6); categories 285 one key. 1024: 539 / 376 / 468. 390: averages <= 1200, items <= 1820 | 312 / 353 / 392 / 437 / 1372; one key not re-measured (two keys 707); 1024: 536 / 377 / 480.5 (amended 480); 390: 1136 / 2180 (amended <= 2200) | MEETS (amended, see 4) |
| C-page-6 | 8 runs: runs 551, averages 366, overview 393, categories 409, errors 620, items 1375; no compact variant | 568.5 (amended 568) / 384.8 (amended 385) / 391.6 / 1093.7 (two keys) / 617.8 / 1372.5; two card rows, no "Run details" | MEETS (amended) |
| C-page-7 | order Runs, Averages, Overview, Categories, Errors, Items; one description per head | exactly that order, one `h2` + one `p` per head | MEETS |
| C-nav-1 | 36, sticky top 0, links only | 36; `position: sticky; top: 0`; 6 links, 0 select/input/slider/button; pinned at the scroller top (y 50) after scrolling | MEETS |
| C-nav-2 | section top at nav bottom + 12 (+-4); aria-current follows; Enter works | +9.8 (Averages), +9.9 (Items), +9.8 by keyboard Enter; `aria-current=location` moves | MEETS |
| C-nav-3 | 390: scrolls inside itself, 36, no wrap | inner `nav` overflow-x auto, scrollWidth 383 > 271, nowrap, bar 36 | MEETS |
| C-title-1 | 70 +-4, title 22/650, meta 11 muted, Export on the title row (dy <= 4); 390 <= 140 | 69.6; 22px/650; 9 nodes at 11px; dy 3.4; 390: 123 | MEETS |
| C-title-2 | mode tabs only with cohort params, 24 high | 24 high in the cohort page, absent otherwise | MEETS |
| C-cohort-1 | banner "Compare sides", two tiles, <= 95 at 1440; 1 column at 390 | 83 (1440), 133 (390, stacked), text A / LEFT, B / RIGHT, run counts | MEETS |
| C-notice-1 | one line, between header and nav | e2e (`notices`, `multi-dataset-notice`) | MEETS (e2e) |
| C-run-1 | 1440 4-up 287 +-3; 1024 2-up 380; 390 277; card 239 +-4; 8 runs grid 478 +-8 | 287.8 x 242.3; 381.5 x 226; 279; 8 runs grid 498.6 (amended 500) | MEETS (amended; at 4 runs 242 is inside the ORIGINAL 239 +-4) |
| C-run-2 | swatch 8x8 run colour, letter badge 16x16 mono `--font-xs`, name 13/650 wraps, Baseline tag, status 20, X 24x24, no star | swatch 8x8 = run colour; letter 16x16 Qym Mono 10px; name 13px/600 (spec 650: the weight is 600 in the bundle); status 20; X 24x24; Baseline tag on A only; no star | MEETS |
| C-run-3 | stat strip 3 x 36, mono 13/650, Errors > 0 `--error-text` | 36 high, 3 cells, 13px/650 mono, Errors red when 3, normal when 0 | MEETS |
| C-run-4 | 6 rows of 20 = 120 | 120 on all cards (8 runs too); no wrapped value clipped; repeat run card 140 (7 rows, Samples) | MEETS |
| C-run-5 | 3 px left border in the run colour; same colour in every component | article border-inline-start 3px = swatch colour for A..D; across every `run-name` on the page each letter has exactly one colour | MEETS |
| C-run-6 | X removes, URL loses the run, focus to the next X, accessible name | 4 -> 3 runs, URL has 3 `runs`, focus on "Remove cand-b-small from the comparison", Enter works, names "Remove <name> from the comparison" | MEETS |
| C-avg-1 | Baseline select (14 rem x 24) in the Averages head; pass toggle with a repeat run; sticky bar has neither | select 224x24 in the head; nav has 0 selects; repeat page shows "Run average / Each pass" | MEETS |
| C-avg-2 | table: metric col 144, run cols 261 +-2; 8 runs 130 +-2, table <= 296; 1024 4 runs 157, 8 runs scroll min 1104 pinned | 144 / 262; 8 runs 131, table 314.9 (amended <= 320); 1024 4 runs 158; 1024 8 runs 120 per column, scrollWidth 1104, `th`/metric column sticky | MEETS (amended) |
| C-avg-3 | colhead RunName + Baseline tag, 4 runs 34, 8 runs <= 54, no text-transform | 34 (4 runs), 60 (8 runs; amended <= 62), 43 at 1024 4 runs, text-transform none | MEETS (amended, H1) |
| C-avg-4 | cells 76 +-2, latency 51, errors 44 (<= 60 at 8 runs), table 283 +-6 | 76 / 51 / 44 at 4 runs; 76 / 51 / 50 at 8 runs; table 283.2 | MEETS |
| C-avg-5 | value 20 high mono 12/600, band colour, outline only beyond the noise band | 20, 12px/600 mono, band colours; 1 px border green/red on 3 of 7 non-baseline cells (beyond noise), transparent otherwise (no size change) | MEETS |
| C-avg-6 | delta 15 high mono 11, glyph + signed pts + band | 15, 11px mono, "▲ +17.5 pts ±16.0", "≈" within noise muted; success / error colour beyond noise | MEETS |
| C-avg-7 | count click: filter, scroll to items + 12 (+-6), banner, badge 1, no width change, no sidebar | up30: items top at nav bottom +10; banner 42 `role=status`; "Filters 1"; 13 section/part widths identical before and after; sidebar closed; hit area 24x20; label "N items improved vs baseline on <metric>; filter items". Small lists cannot scroll that far (2 items: +433, as legacy 501) | MEETS |
| C-avg-8 | latency percent line; errors "N task . M scorer" / none | "▼ -3%", "≈ -2%"; "2 task · 1 scorer", "none" | MEETS |
| C-avg-9 | 390: one block per metric, cell >= 44, table <= 1200, no scroll | cells 44 / 72, table 1003 (section 1136), no scroll | MEETS |
| C-ov-1 | Slider (8 rem) then metric tabs, both 24, one centre line; wraps at 390 | tabs 24 (110 wide); slider block 43 (amended), centre lines 926.5 / 926.5; at 390 the tabs sit 18 px under the description | MEETS WITH FIXES (optional, see F5) |
| C-ov-2 | 1440 one row of 8 (76, box 148x74); 1024 two rows (151); 390 four rows (301); 1 px gaps | 76 / 148x74, gap 1px, 8 columns; 1024: 151 (4 + 4); 390: 301 (2 x 4) | MEETS |
| C-ov-3 | label 11/600 muted, value `--font-xl` mono 650 band colour, Errors red, latency primary | 11px/600 muted; 18px/650 mono; Errors red, latency primary, no per-box border | MEETS |
| C-ov-4 | winner bar 28, flex-grow = wins, aria "<name> won N items", legend 18 / <= 42 | 28; grow 1/3/2/34; aria "cand-a-sonnet won 3 items; filter"; legend 18 (4 runs), 36 (8 runs 1024); click filters ("1 of 40 items") | MEETS |
| C-ov-5 | distribution bar 32, segments by k, click filters | 32, 4 segments widths 607/174/202/174, aria "6 items with 1 of 4 runs correct; filter"; click -> "6 of 40 items" | MEETS |
| C-ov-6 | section <= 400 | 392 | MEETS |
| C-cat-1 | chip bar in the head, 26 high, URL-backed | chips "complexity 3", "domain 4" 26 high, toggle (e2e reads `catKeys`) | MEETS |
| C-cat-2 | 3-up 388x179 (302 at 8 runs); 1024 2-up 380; 390 1-up 277 | 388.3 x 184.5 (amended 185); 8 runs 313.3 (spec 302); 1024 381.5; 390 279 x 197 | MEETS WITH FIXES (optional, F6) |
| C-cat-3 | title + count, header row RUN/AVERAGE/LATENCY/CHANGE, 3 px left border by band | all present; borders easy rgb(74,222,128), medium yellow, hard red, metadata keys `--info` | MEETS |
| C-cat-4 | row 27, bar 8, run-colour fill, 1 px tick 4 px taller | row 28.2, bar 8, fill = run colour (rgb(244,114,182) for B), tick 1 x 12 | MEETS |
| C-cat-5 | click filters, banner/badge, scrolls like every number, no sidebar, no width change | 14 items, "Filters 1", banner present, items top +10, widths identical, sidebar 0; Enter works | MEETS (amended, justified) |
| C-step-1 | steps table in the averages recipe | seed has no spans: e2e only | MEETS (e2e) |
| C-rc-1 | root-cause cards | seed has no analyses: e2e only | MEETS (e2e) |
| C-err-1 | groups, cards 287 wide, 4 runs 149, 8 runs <= 232, 3 px border task/metric | 287.8 x 148.6 (4 runs); 8 runs 238.9; borders 3px red / 3px amber; groups "TASK ERRORS 6", "METRIC ERRORS 3" | MEETS WITH FIXES (optional, F7: 8-run card 239 > 232) |
| C-err-2 | every run listed, zeros included, delta vs baseline | 4 of 4 and 8 of 8 rows; "Baseline", "-1", "+1", "-2" coloured | MEETS |
| C-err-3 | card is a button, Enter/Space, no layout change | `role=button tabindex=0 aria-pressed`, Space -> "4 of 40 items", widths identical, sidebar 0 | MEETS |
| C-items-1 | head: title + description + Auto-analyze only with an analysis | no Analyze control in the toolbar or head with no analysis (legacy L33 "when an analysis exists" matches) | MEETS |
| C-items-2 | banner one line <= 42 above the toolbar, bold names | 42, `role=status`, 3 bold names, "Clear" button (clears to 40 of 40) | MEETS |
| C-items-3 | not sticky; 1440 one row 24; 1024 <= 56; 390 <= 90; controls 24 | static; 24 / 24 / 88; all buttons 24, same centre line | MEETS |
| C-items-4 | count `role=status`, mono 11 muted | role=status, Qym Mono 11px, muted | MEETS |
| C-items-5 | badge; inline panel >= 100 high; nothing painted over content; Escape closes and returns focus | badge "Filters 0"; panel 109 high, static, list below it; Escape with focus inside the panel closes and returns focus to Filters. **Escape with focus still on the Filters button (the state after Enter/click) does nothing** | MEETS WITH FIXES (required, F1) |
| C-items-6 | fields: Outcome, Winner, Change vs baseline (per run and metric), Passing runs, metadata keys, Approval, Has error, Output text, Max latency; run names | all present with run names ("cand-a-sonnet won", "Scores · cand-a-sonnet · quality") **except "Change vs baseline"**, which is only reachable from the count buttons and the Quick-filters sidebar | MEETS WITH FIXES (required, F2) |
| C-items-7 | Display popover 300, metric select, sort, Raw/Rendered, columns; Escape returns focus; label "Display . <metric>" | 300 wide; contents as listed (+ "Biggest change vs baseline" sort); button "Display · quality"; Escape closes, focus on the button | MEETS |
| C-items-8 | CSV accent 24 high | 67x24, colour rgb(0,212,170) | MEETS |
| C-row-1 | border 1, radius 8, 54, pitch 60, 20 per page, list 1194 +-4 | 1px, 8px, 54, 60, 20 rows, list 1193 | MEETS |
| C-row-2 | chevron 26, #n mono 13/600, title 13/600 clamped to 2 lines | 26 (`aria-expanded`), 13px/600 mono, 13px/600, line-clamp 2 | MEETS |
| C-row-3 | chip 68x22 (amended 78x22, 12 %), 4 to 8 on one line at 1440 and 1024; 390 under the title, row <= 76 (amended 84, items <= 2200) | 78x22 mono 12/600 with swatch + letter; 4 and 8 chips on one y at 1440; 1024: 4 runs one line (row 54), 8 runs under the title (row 58); 390: chip 59x22, four on one line, row 84.4 | MEETS (amended, H1) |
| C-row-4 | task error: red outlined chip with x, row border 1 px `--error` | `data-state=error` chip with x, `title` "<run>: Task error"; row border 1px rgb(239,68,68); no left rail | MEETS |
| C-row-5 | run key above the list, 18.6 (<= 2 lines at 8) | 18.6 (4 runs), 19 (8 runs), a `run-name` per run | MEETS |
| C-row-6 | head is role=button, one tab stop, several rows open | role=button tabindex 0; Tab order stops once per row | MEETS |
| C-row-7 | "1-20 of 40 items", pager 24, 20 per page | "1–20 of 40 items", page 1 of 2, 24 high | MEETS |
| C-exp-1 | INPUT (3 px `--info`) above EXPECTED (3 px `--success`, tint), tags, OUTPUT head, grid | exactly that order (y 529, 599, tags 657, toggles 685, grid 717); borders rgb(59,130,246) / rgb(16,185,129) 3px; labels 11px/650 uppercase | MEETS |
| C-exp-2 | one 24 toggle per run, aria-pressed, run-colour outline, at least one stays on; All / Only differing | 24 each (8 runs too), border in the run colour; turning off down to one leaves 1 card | MEETS |
| C-exp-3 | minmax(17.5rem, 1fr): 4 x 284 no scroll; 5+ scroll with snap; 1024 scroll; 390 stacked | 4 x 285, scrollWidth = clientWidth; 8 runs 8 x 280, scrollWidth 2296 / 1163, snap x; 1024 1144 / 747; 390 one column of 249, no scroll | MEETS |
| C-exp-4 | top of text, metric rows and details equal; card 268 (amended 226 +-6) | text top 779 x4, metric rows 805 / 841 x4, details top 881 x4; card 226 x4 (8 runs 226 x8) | MEETS (amended, smaller not looser) |
| C-exp-5 | 3 px left border run colour, border 1 subtle, equal header | 3px run colour, 1px rgb(43,43,64), head 45 in all | MEETS |
| C-exp-6 | metric row 32; one click opens that metric under every card at one top; again closes | 32 (x8); aria-expanded true on quality in 4 cards, details y 881 x4, h 56; second click closes (e2e asserts 0 cells) | MEETS |
| C-exp-7 | Trace drawer, issues dialog, focus returns | e2e (`items`) | MEETS (e2e) |
| C-exp-8 | Sweep modal renders the same component, "Item comparison . <id>", Escape | dialog "Item comparison · cmp-010" with `item-detail` and 4 `output-card`; row click and Enter on the id button open it; Escape closes | MEETS |
| C-sw-1 | Compare / Sweep + Export, banner, h2 + line + Reverse | all present; no nav, no scope bar, no sidebar; mode tabs 24; h2 "Sweep" | MEETS |
| C-sw-2 | verdict <= 70 (amended <= 80), 3 px edge in verdict colour, title 13/650, sub 11 | 67 (meets the original 70), edge 3px rgb(16,185,129) | MEETS (amendment not needed, F8) |
| C-sw-3 | one row of 5 fields <= 90 | 73 high, 10 controls (5 fields) | MEETS |
| C-sw-4 | 5 equal cells in one frame, 3 px bottom edge by outcome | 5 x 238x92; edges green / neutral as in `review-sweep-1440.png` | MEETS |
| C-sw-5 | metadata table rows 31 +-2, sortable | 31 ; sortable headers | MEETS |
| C-sw-6 | 7 cards 56 (amended 62 +-8), value `--font-xl` mono | 7 x 164x64; one label ("AVG Δ ATTEMPTS / ITEM") wraps to 3 lines and sets the row height | MEETS WITH FIXES (optional, F9) |
| C-sw-7 | row 34, dots 13, k/n, Move pill, click or Enter opens | 34 high, dots 13x13, "0/2" / "2/2", "+2" pill; click and Enter open the modal | MEETS |
| C-sw-8 | 390: 2 stat cards per row; tables scroll in own wrapper | 139 wide x 2 per row; document 390 = 390; table wrapper `role=region` scrolls | MEETS |
| C-state-1 | loading frame = loaded +-1 (Runs, Averages), CLS 0 | skeleton heights 312 / 353 (1440) and 1055 / 1136 (390) = loaded exactly; placeholder count and CLS: e2e | MEETS |
| C-state-2 | empty: EmptyState, Back to runs, fits 390 | text + "← Back to runs"; shell scrollHeight 850 = clientHeight, no sideways scroll at 390 | MEETS |
| C-state-3 | ErrorState: count, up to 5 ids then "+ N more", HTTP 404, Back, no scroll at 390 | all-missing (2 ids) at 390: "2 of the runs ... Missing: ids, HTTP 404 · Not found, Back to runs", scroll 319/319; 7-id case e2e. Mixed present + missing ids drops the missing ones silently, as legacy does | MEETS |
| C-kbd-1 | Tab order = visual order, 2 px focus ring | 76 stops, 0 upward jumps (nav, X, baseline, counts, slider/tabs, stat help, winner, distribution, chips, category cards, error cards, search, Filters, Quick filters, Display, CSV, row heads, pager); buttons and links show `solid 2px`; the three fields (Baseline select, search, page input) show the field focus (accent border + 2 px halo) instead of the outline | MEETS |
| C-kbd-2 | Enter and Space on counts, segments, cards | Enter on count, Space on winner segment and error card, Enter on category card all filter and announce through the count | MEETS |
| C-kbd-3 | axe 0 serious/critical at 1440 and 390 with an expanded item and details open | 0 violations (wcag2a/aa, 21a/aa, best-practice) at 1440 and 390, mouse parked off the page. With the pointer resting on a run the series highlight dims the others and axe then reports contrast on the dimmed nodes (48 / 19 serious): by design (hover dim), not a defect | MEETS |
| C-side-1 | Quick filters button 24, `aria-expanded=false`, after Filters; search/count/segment/cards never open it | 110x24, false, between Filters and Display; search, count button, winner, distribution, category and error card all leave it closed (sidebar count 0) | MEETS |
| C-side-2 | 300 wide beside the list only; other sections keep their widths; list narrows 300 + 24 (+-12) | `aside` 300 at x 1105, inside `section-items`, under the toolbar, sticky; run-grid / averages / stat-grid / toolbar 1193 unchanged; item-list 1193 -> 879 (-314) | MEETS |
| C-side-3 | content groups, run names, Clear all keeps the sidebar | count, Clear all, View N items, Active, search, Show, Winner ("cand-a-sonnet won"), Change vs baseline, ... ; a facet gives "21 of 40", Clear all -> "40 of 40" with the sidebar still open | MEETS |
| C-side-4 | below 1200 a drawer; Escape closes, focus returns | 1024 and 390: page widths unchanged when opened, Escape closes, focus on `items-facets-btn` (shots `review-sidebar-drawer-*.png`) | MEETS |
| C-side-5 | tab stop between Filters and Display; facets are `aria-pressed` buttons; Hide closes | Enter opens; 31 `aria-pressed` buttons; Hide closes and widths return to the closed values | MEETS |

## 3. Findings

**Blocker:** none.

**Required**
- F1. `C-items-5`: Escape does not close the Filters panel while focus is on the Filters button (the state after clicking or pressing Enter on it). Measured: panel count 1 after Escape; it closes only when focus is inside the panel. Fix: handle Escape on the button as well, or move focus into the panel on open.
- F2. `C-items-6`: "+ Condition" has no "Change vs baseline (per run and metric)" field (measured field list: Outcome, Winner, Passing runs, Scores x4, Complexity, Domain, Approval, Has error, Edited metrics, Output text, Max latency). The facet exists in the sidebar and as the count buttons, so nothing is lost, but the spec line is not met. Add the field or amend the line.

**Optional**
- F3. Fields (Baseline select, search, page input) take the field focus style (accent border + 2 px 15 % halo) instead of the 2 px outline; the halo is faint on dark. Acceptable under the design language; stated so nobody reads "every stop has the ring" literally.
- F4. After closing the Sweep item modal focus lands on the table scroll region, not on the row that opened it.
- F5. `C-ov-1` amendment (slider block 43) is not a cost of H1/H2: the Slider primitive stacks its label over the track. Centres coincide, so the reading is the same as legacy (inline slider in the head), but it is a looser recipe.
- F6. `C-cat-2` amendment (185 / 313) is a line-height choice, not H1/H2. Row 28.2 vs 27; section 2 px per row heavier at 8 runs (313 vs 302).
- F7. `C-err-1`: the 8-run error card is 238.9 vs "<= 232" and the spec never amended it; the section (617.8) still meets the page-level 620, so the two spec numbers disagree. Amend or trim the row height (23 -> 20).
- F8. `C-sw-2` amendment (<= 80) is not needed: measured 67, inside the original 70. Revert the number to keep the bar.
- F9. `C-sw-6` amendment (62 +-8): the only wrapping label is "AVG Δ ATTEMPTS / ITEM"; shortening it returns the row to 56.
- F10. `C-run-1` amendment is unnecessary for 4 runs (242 is inside 239 +-4); only the 8-run grid needs it (498.6 = 2 x 242.3 + 14 gap; the old 478 ignored the gap).
- F11. Note for the owner: categories default to all keys (707 px at 4 runs); the spec's 285 is the one-key state (chip bar). Same as legacy, which also shows all keys.

## 4. The 14 amendments (spec carries number + reason + e2e?)

| Amendment | Number in spec | Reason in spec | e2e asserts | Really H1/H2 cost? |
|---|---|---|---|---|
| C-page-5 (runs 312, overview 1024 480, 390 items <= 2200) | yes | yes | r8-page | yes: letter badge wraps the baseline name, legend wraps (480 measured); 390 items 2180 is 20 over the old ceiling because chips (swatch + letter) wrap under the title |
| C-page-6 (568 / 385) | yes | yes | r8-page | yes (measured 568.5 / 384.8) |
| C-run-1 (242 / 500) | yes | yes | r8-runs | partly (F10) |
| C-avg-3 / C-avg-2 (head <= 62, table <= 320) | yes | yes | r8-averages | yes: 131 px column holds swatch + badge + name over 3 lines (60) |
| C-ov-1 (slider 43) | yes | yes | r8-overview | no (F5) |
| C-cat-2 (185 / 313) | yes | yes | r8-categories-errors | no (F6) |
| C-cat-5 (scrolls) | yes | yes (principle 3, H2) | r8-categories-errors | yes, and the better reading: measured +10 |
| C-row-3 chip 78x22, tint 12 % | yes | yes (H1, axe contrast) | r8-items | yes |
| C-row-3 / C-page-5 at 390 (row 84, items 2200) | yes | yes | r8-items, r8-page | yes (chip line under the title) |
| C-exp-4 (226) | yes | yes | r8-expanded | not an H1/H2 matter, and the card is smaller, not looser; alignment 0 px |
| C-sw-2 (<= 80) | yes | yes | r8-sweep | no (F8) |
| C-sw-6 (62) | yes | yes | r8-sweep | no (F9) |
| C-state-1 (242 / 232) | yes | yes | r8-states (CLS < 0.05) | measured loaded heights (identical to 312 / 1055) |
| C-nav-1 (`--bar-link-h` 36) | yes | yes | r8-page, design-language test | token documented |

None is DOES NOT MEET; F5, F6, F8, F9 are looser than needed.

## 5. Deviations judged (density versus hiding, DESIGN_LANGUAGE 6)

- "What differs between the runs" in a popover in the Runs head: legacy shows it as a disclosure under the cards, closed by default, so the reading is the same; the popover keeps the cards at 242 and the whole Averages table on the first screen (876.8 <= 900). Keeps the reading (e2e `fixes`, `multi-dataset-notice` pass).
- Toolbar Analyze removed, Auto-analyze only with an analysis: legacy L33 is the same ("when an analysis exists"). Keeps the reading.
- Sweep without scope bar and sidebar: the legacy Sweep page has neither (measured: nav 0, sidebar 0, scope bar 0). Keeps the reading.
- `--bar-link-h`: a documented token, nav 36 measured. Neutral.
- Raw tables, `.card` classes, `--font-xs` letter badge in the design-language allow-list: each carries a round-8 reason; the badge is the one place where the page is denser than legacy (the owner's H1). No hiding.

## 6. Component reading (legacy vs React, shot pairs `legacy-*` vs `after-*`; full pages `review-legacy-page-1440.png` vs `review-page-1440.png`)

| Legacy component | Same reading? | Evidence |
|---|---|---|
| L01-L04 header, mode, cohort, notices | yes: title block 70, Export on the title row, mode tabs 24, banner two tiles | `legacy-title-block` / `after-title-1440` |
| L05-L11 run cards | yes: left rail + swatch + name + status + X, stat strip, six meta rows; plus the letter (H1); 4-up at 1440 like legacy (legacy 3 + 1) | `legacy-run-card` / `after-runs-1440` |
| L10-L18 averages | yes: table, boxed beyond noise, delta + band, up/down counts, Baseline select in the head; rows 76 vs legacy 70, still one screen | `legacy-averages-table` / `after-averages-1440`, `review-first-screen-1440.png` |
| L19-L25 overview | yes: pass slider and metric tabs in the head, 8 stat boxes, winner bar + legend, distribution bar | `legacy-overview-head`, `legacy-stats-grid` / `after-overview-1440` |
| L26-L28 categories | yes: chip bar, key groups, 3-up cards, bars with the baseline tick | `legacy-category-card` / `after-categories-1440` |
| L29, L32 steps, root cause | not comparable (seed); e2e | |
| L30-L31 errors | yes: Task / Metric groups, cards with per-run counts and delta | `legacy-error-card` / `after-errors-1440` |
| L33-L40 items head, toolbar, filters | yes: one toolbar row, inline filters, banner for count-driven filters; Quick filters button is the H2 addition (closed) | `legacy-items-toolbar` / `after-items-1440`, `review-count-click-1440.png`, `review-filters-open-1440.png` |
| L41-L44 item rows | yes: cards with one coloured chip per run, red error row; chips carry swatch + letter | `legacy-item-row` / `after-items-1440` |
| L45-L52 expanded item | yes: INPUT above EXPECTED, toggles, equal-top columns, metric details under all cards | `legacy-item-expanded` / `review-expanded-details-1440.png` |
| L54-L59 sweep | yes: verdict, filters row, stat cards, metadata table, outcome cards, item rows with pass dots, modal | `legacy-sweep-page-1440` / `review-sweep-1440.png`, `review-sweep-modal-1440.png` |
| L60-L62 states | yes: skeleton at the loaded height, empty, error | `review-state-*.png` |
| Quick-filters sidebar (H2) | closed by default; opened it narrows only the list | `review-sidebar-open-1440.png` |

Compared with legacy at 390 the React page has no sideways scroll (legacy main 401 > 334); legacy page height at 1440 is 4419, React 4112 (shell scroll height).

## 7. Gate run by the review

| Command | Result |
|---|---|
| `npm ci` + `npm run build` (gate wrapper, cost 2 then cost 3 with `NODE_OPTIONS=--max-old-space-size=3072`; the first build ran out of Node heap at the default) | exit 0 |
| `npx playwright test e2e/compare` (gate wrapper, cost 3, 2 workers) | **218 passed** (3.0 min) |
| Own browser measurements (scratchpad scripts, not committed) | the numbers in section 2 |
| `npm run check`, pytest | not re-run by the review (implementer: Vitest 207 files / 1688 tests, design test 1 passed; backend untouched) |

Servers: platform 8983 and legacy 8980 started and stopped by PID (8983 twice: the e2e run boots its own); Vite 5983 and the eval/stub servers belong to the Playwright run and exited with it. Review database files removed.
