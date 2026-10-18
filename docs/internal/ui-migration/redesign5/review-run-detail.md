# Round 5 review: run detail (independent reviewer)

Branch `ui/redesign5-run-detail` at `decf1a57`. Reviewed 2026-10-18 in a browser (own servers 8995 / 5995, own DB
`.qym-e2e-r5r.db`, seed `seed-r5.mts`), 1440 and 390 (R4 also 1024). Measurements are my own DOM scripts, not the
implementer's specs. Screenshots: scratchpad `r5r/shots/` (listed at the end).

## Verdict: MEETS WITH FIXES

Gate green. R1 (bars) and R2 (box plots) are fixed and measured. R3 fixes the label overlap and the panel structure, but
the embedded tables in the metric panel have **zero cell padding from 640 px up**, so numbers touch the next column's text
("12Approvals above...", "1Clause 4.2 quoted", "120true") and the first column sits flush with the panel edge while the header
is indented 8 px. The owner asked for tables presented clearly; at 1440 they are not. R4-2 does not hold at 1024 (Display wraps).

## Feedback-point verdict

| Owner point | Verdict |
|---|---|
| 1a bars drop below the x axis (10 values) | MET: every bar bottom = axis line (0 px) in 11- and 20-column plots at 1440 and 390; feet equal |
| 1b box plots coloured, no numbers below | MET: sky or band tone, no number row; min / median / max on the plot, six values in tooltip and aria-label |
| 5a metric panel design | MOSTLY MET: calm matrix, stacked prose, facts; tables defect below |
| 5b clicked score shows tables clearly (legacy parity) | NOT MET at >= 640 px (cell padding 0); structure (headers, sort, scroll at 390, 12 rows + more) is right |
| 5c text overlaps its label (reasoning key) | MET: fact value starts 14 px after its key (LTR and RTL), prose stacked under its label, Arabic reason offset 0 (was 544) |
| R4-1 correlation width | MET |
| R4-2 toolbar alignment | MET at 1440 (spread 0); at 1024 one control (Display) wraps to its own line |
| R4-3 traces open on content | MET on every entry point |

## Criterion table (measured)

### R1 (12 of 13)

| # | Measured | Met |
|---|---|---|
| R1-1 | 11-col plots (details 1440 / 390; classic): bar bottom minus well bottom + 1 = 0 (min -0.02, max 0); spread 0 (was 14) | yes |
| R1-2 | passes19 20 cols (`?panel=repeat`): 0 px at 1440 (col 17.8) and 390 (col 12.0) | yes |
| R1-3 | gallery sweep N=1..20 at 1440 and 390: 0 bad bars, foot 18 or 32 | yes |
| R1-4 | foot height one value per plot (18 / 32 / 4 for the latency strip owner) | yes |
| R1-5 | count to bar gap 2 px everywhere; 20 px only on raised tier (sweep 390, N=18..20) | yes |
| R1-6 | tallest count top = plot top (0, 2.7 for N=19); card scrollHeight = clientHeight (336/336, 287/287); plot 146 | yes |
| R1-7 | shown labels every 2nd (11 cols: 6 labels, 20 cols: 10); text gap >= 21 px | yes |
| R1-8 | sweep: no count overlaps, tier gaps 2 / 20; passes19 one-digit not dense (accepted deviation) | yes |
| R1-9 | well border 1 px `rgb(59,59,84)` present; union spans 1031..1386 against plot 1033..1384 (**2 px overshoot each side**, spec +-1) | no (cosmetic) |
| R1-10 | bars <= 44 px; zero bars height 0; "0" printed for passes passed | yes |
| R1-11 | lowest element to card bottom 1 px | yes |
| R1-12 | reduced motion: 0 animated marks | yes |
| R1-13 | design-language 49 passed | yes |

### R2 (15 of 15)

| # | Measured | Met |
|---|---|---|
| R2-1 | `dl[Distribution values]` 0, visible MIN/P25/... cells 0 (only the latency "Mean" KPI, which is kept) | yes |
| R2-2 | per-pass rows: band of own median (bands 2..5, borders `--score-2/3/4/5`); 19 rows | yes |
| R2-3 | glyph all `rgb(56,189,248)` = `--chart-1`; latency tail dots `rgb(249,115,22)` = `--score-2` | yes |
| R2-4 | stroke vs surface 4.57 / 6.13 / 11.22 / 9.86 / 6.77 / 8.02; vs 20% fill 3.67 / 4.55 / 6.95 / 6.36 / 4.87 / 5.45 (min 3.67) | yes |
| R2-5 | median text above box top (y 977 < 993), min / max under baseline (1039); no other text | yes |
| R2-6 | hover and focus tooltip: Middle 50%, IQR, Min, P25, Median, Mean, P75, Max | yes |
| R2-7 | aria-label names six numbers and total | yes |
| R2-8 | "Total 64.0K" in `.headRight` for tokens; absent for latency | yes |
| R2-9 | tokens card 196.2 (details) / 212.2 (classic) at 1440; 214.4 / 230.4 at 390; under lowest element 1 px | yes (amended number is real: classic card has the 16 px "12 task errors" note, header wraps at 390) |
| R2-10 | rows 32, tag 72, median col 52, tag colour `rgb(237,237,240)` (none) | yes |
| R2-11 | strip stays, series 1, Mean KPI kept (e2e green; not re-measured by x) | yes (gate) |
| R2-12 | `HelpMarker` present, legend `ul` 0, one key line on rows cards | yes |
| R2-13 | median printed, band in aria-label | yes |
| R2-14 | tokens only; design test green | yes |
| R2-15 | 0 animated marks under reduced motion | yes |

### R3 (22 of 23)

| # | Measured | Met |
|---|---|---|
| R3-1 | header 33 px at 1440, 58 px at 390; score, "Edit score" text button | yes |
| R3-2 | fact dd.left - dt.right = 14 px at 1440; stacked at 390 (dd below dt) | yes |
| R3-3 | keys ellipsised with raw key in `title`, no clip; gap 14 | yes |
| R3-4 | Arabic: eyebrow left = text left (248 = 248), eyebrow above text (879.9 < 883.9) | yes |
| R3-5 | 13 px, line-height 1.6 (1.7 Arabic), max 592.8 px (76ch), text left = panel + 15 | yes |
| R3-6 | order Reasoning, Trace, Check; Reason `rgb(237,237,240)`, rest `rgb(168,168,186)` | yes |
| R3-7 | tree key gap 6 px | yes |
| R3-8 | criteria, evidence, score_table, log_table render as grids | yes |
| R3-9 | header 34, rows 32, numbers mono end-aligned, `aria-sort` present | yes (but see padding finding) |
| R3-10 | 390: scroller 576 / 555 / 352 wide in 207, `overflow-x:auto`; panel 235/235, page 390/390 | yes |
| R3-11 | wrapping not separately measured (fixture text is one line) | yes (gate) |
| R3-12 | log_table 12 rows + "Show N more rows" | yes (gate) |
| R3-13 | label roles: 3 distinct (11/650/upper, 11/650, 12/600 mono) | yes |
| R3-14 | 1,029.3 / 1,523.4 with `log_table` hidden (the spec fixture); with the full seed 1,508.7 / 2,014.8 | yes (amended, see judgement) |
| R3-15 | Edit toggles editor, Close returns focus to the matrix cell | yes |
| R3-16 | Arabic reason offset 0 px at 1440 (8 px at 390) | yes |
| R3-17 | rows 32, header 34, mono 400 secondary name, 600 value; **11 px at 390, spec 12 px** | no (minor) |
| R3-18 | selected row `rgba(0,212,170,.08)` + 2 px accent inset bar, outline none | yes |
| R3-19 | 6 rows, summary line, arrow keys move cells, Enter opens | yes |
| R3-20 | 390: no sideways scroll, facts stacked | yes |
| R3-21 | FieldRow truncation (unit test, gate) | yes |
| R3-22 | axe serious/critical: 0 for the panel EN and AR at 1440 and 390, overview, repeat, latency | yes |
| R3-23 | design test 49 passed | yes |

### R4 (2 of 3)

| # | Measured | Met |
|---|---|---|
| R4-1 | grid = box: 1151 / 735 / 237 px (1440 / 1024 / 390), last cell right = grid right, cells 255.8 / 151.8 / 27.3 px | yes |
| R4-2 | 1440: search, metric, Filters, Sort, Display centre 2679.2, slider 2681.2, segmented controls aligned (screenshot); 1024: first line aligned, **Display on a second line**, count on a third | 1440 yes, 1024 no |
| R4-3 | content tab on every step: row button 6/6, expanded 7/7 (1440 and 390), deep link 7/7 (1440 and 390); a Metrics pick is not remembered (next step opens on Messages) | yes |

Totals: R1 12/13, R2 15/15, R3 22/23, R4 2/3 (counting R4-3 once): 51 of 54.

## Findings

### Required

1. **Metric panel tables have no cell padding from 640 px up.** `[role=gridcell]` `padding-left` 0 px at 1440, 1280, 1024, 768, 640;
   8 px at 500 and below; header cells 8 px at every width. Result at 1440 (`shots/table-Evidence-1440.png`): Page "12" abuts the
   quote text, Criteria "1" abuts "Clause 4.2 quoted", log "120" abuts "true", the first column is flush with the panel edge and
   offset 8 px from its header, the last column is flush with the right edge. This is the owner's "present tables clearly" point.
   Files: `frontend/src/features/run-detail/components/items/MetricStrip.tsx` (`DetailTable`, `DataTable variant="embedded"`)
   with `frontend/src/ui/DataTable/DataTable.module.css` (`.td` / `.cell`, embedded variant). Fix must change the measured
   padding: cell inline padding equal to the header's, gap between adjacent cell texts >= 12 px, first cell text left = header
   text left. Add that assertion to `redesign5-metric-panel.spec.ts` (R3-9 passes today because it only checks heights).
2. **R4-2 at 1024.** The Display button wraps below the row and "86 of 86 items" takes a third line. Let the search field shrink
   or move the count so the seven controls fit one row at 1024 (content width 777), or document the wrap as accepted. Fix must
   change the measured line count (3 lines now).

### Optional

3. R1-9: the drawn axis overshoots the plot by 2 px each side (wells use `margin-inline: -2px`); clip it or set the spec to +-2.
4. R3-17: matrix name and value are 11 px at 390 (spec 12 px).
5. Observation (not this round's code): single-value box cards ("Tokens per item", "Cost per item", "All 55 values are 300")
   are tall with a lone bar at the far right and a lot of empty space (`shots/box-tokens-390.png`).
6. Observation, still open: trace tree rows overlap the retry label and error tag at 390 (implementer note 7).
7. The full seed's panel is 1,509 px (1440) and 2,015 px (390) because `log_table` shows 12 rows; fine, but it is the real size.

## Judgement of deviations and amendments

| Item | Judgement |
|---|---|
| R1-8 asserted on the sweep | Measured reality: passes19 counts are one digit (pitch 12 >= 9). The sweep shows dense mode works (tiers 2 / 20 px, no overlaps). Accept. |
| R2-2 per-pass row is the directed-score box | Measured reality: score metrics are histograms on the Overview. Per-pass rows coloured by own median band, verified. Accept. |
| R2-9 <= 232 px at 390 | Measured reality: the 16 px error note is in the classic fixture only (details tokens card is 214.4). Accept. |
| R3-14 <= 1,040 / 1,530 | Reproduced (1,029 / 1,523) but only with `log_table` hidden, as the e2e does. The reason is honest (three tables now expanded, old panel hid them) and the spec fixture excludes `log_table`. Accept; the criterion is not a size gate any more. |
| Edit button without aria-label | Correct fix for axe `label-content-name-mismatch`; accessible name is now "Edit score". Accept. |

## Gate

- `npm run check` via heavy.sh cost 3: tsc, eslint, stylelint, Vitest 159 files / 1,378 tests, design-language 49 tests, all passed.
- Playwright `e2e/run-detail` via heavy.sh cost 3 (own ports 8995 / 5995, own DB): 394 passed, 9 skipped (the shots spec and the
  390 row-button case), 0 failed.
- Keyboard and screen reader: box marks are buttons with tabindex 0 and labels; Arrow keys move matrix cells, Enter opens the
  panel (`section`, name "arabic_judge details"), Escape and Close return focus to the cell. Reduced motion: 0 animated marks.

## Screenshots (`r5r/shots/` in the scratchpad)

`bars-11-1440/390.png`, `bars-20-1440/390.png`, `sweep-1440/390.png`, `box-tokens-1440/390.png`, `box-latency-1440/390.png`,
`perpass-1440/390.png`, `panel-rubric_judge-1440/390.png`, `panel-arabic_judge-1440/390.png`, `vp-arabic_judge-1440/390.png`,
`vp-rubric_judge-390.png`, `table-Criteria-*.png`, `table-Evidence-1440/390.png`, `corr-1440/1024/390.png`,
`toolbar-1440/1024/390.png`, `trace-deeplink-1440/390.png`. (Element screenshots of the tall panel show sticky-header
artefacts; the `vp-*` viewport shots are the reliable ones.)
