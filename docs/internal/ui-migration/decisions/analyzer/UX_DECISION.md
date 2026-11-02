# Analyzer workspace: UX evaluation of the three variants

Evaluator: scripted Playwright runs (Chromium, dark scheme, fresh context per scenario) against
`/app/__mock/analyzer/{tabs,rail,flow}` at 1440x900 and 800x900 (800 px leaves a 608 px main region).
Only observed behaviour is reported. Action counts = clicks + key presses + one count per text entry
(a typed string = 2: focus click + typing); scrolling is listed separately.
Screenshots and scripts: `/tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/61846e82-dc0e-402d-b3ec-d3565a3b1b04/scratchpad/ux/`
(`suite-<variant>-<width>-NN-*.png`, `s1..s10*.mjs`, `axe.mjs`).

## Winner: C "flow"

Pick **flow**, with two changes taken from the others (sticky job bar from rail; sticky Test/Analyze footer behaviour from tabs).
It is a close call: the weighted totals of flow and rail are equal (59), rail wins the unweighted sum (37 vs 35).
The tie is broken by the three criteria that matter most (J1 task success, Fields discoverability, job visibility),
where flow scores 36 and rail 33 (weight 3 each: flow 4/5/3, rail 3/3/5, tabs 3/2/3).

Why flow:
1. **Fields discoverability is decisively better.** From the first screen, flow needs 1 click ("Next: Preview" or the Preview step) and 0 scrolling to
   have Fields and the prompt preview side by side at 1440 (Fields at y=471..., preview at the same row). It has its own step title, "Fields: What each variable
   reads from the item" and the sentence "Edit the fields on the left; the prompt on the right updates immediately." Tabs needs ~1630 px of scrolling
   (Fields bar at y=1632 of the main region, preview at 1794) plus 1 click to expand. Rail shows Fields expanded, but its rows are under the pinned footer on first paint, and the
   preview is at y=1141 (not on screen) at 1440x900, so the "Fields next to preview, both on screen at 1440" claim in DESIGN_NOTES is not true on load.
2. **J1 is the clearest path.** Every step fits on screen with no scrolling: after "Test selected" the result card is visible immediately (top 518 of 900), whereas in
   tabs it lands ~2360 px down and in rail ~1620 px down with no auto-scroll and no cue near the button. The Review step gives the completion card
   (error-code groups, View run, Dismiss) a home that is visible without scrolling.
3. **Narrow width is fine.** At 800 each step is a short stack; no horizontal overflow (document scrollWidth 800 = clientWidth). Rail at 800 degenerates into a ~2000 px stack
   (preview at y=2025) and its action footer is no longer pinned (Analyze at y=1040 on first paint).
4. Its two weaknesses are one-component fixes, not structural: the job bar is not sticky and is absent in the Project guidance area (see must-fix 2),
   and the Test targets are chosen on a different step than the Test button (must-fix 3). Rail's weaknesses (preview below the fold at 1440, ~2000 px stack at 800, clipped pinned footer,
   biggest departure from other pages) are layout-level.

Costs accepted: flow needs the most actions for the happy path (30 vs 25-26 over the five measured scenarios, see below) and is the least similar to the rest of the app (stepper plus a second
"Analyze run / Project guidance" switch). Runner-up: rail (best job visibility, best density). If the team cannot afford the new stepper component, rail is the fallback; tabs is the lowest-risk but is the weakest on the priority criteria.

## Scores (1-5, 5 best)

| Criterion | A tabs | B rail | C flow | Raw numbers behind the score |
|---|---|---|---|---|
| J1 task success (open, configure, preview, test, analyze, review) | 3 | 3 | 4 | Test result needs scrolling in tabs (top 2362 px) and rail (top 1619 px); visible in flow (top 518). Rail pinned footer clipped on first paint. Flow: targets chosen on Configure, Test on Run. |
| J2 task success (rules / documents / diagnosis) | 5 | 5 | 4 | Identical Guidance components. Flow adds 1 click (area switch) and a two-level nav; S5 7/7/8, S6 6/6/7, S7 4/4/5 actions. All completed with no dead end. |
| Steps-to-complete (S1+S3+S4+S5+S6 actions) | 3 | 4 | 3 | tabs 26, rail 25, flow 30 actions; tabs also needs ~6 scrolls of 1.5k px, rail 2-3, flow 0. |
| Fields discoverability (S8) | 2 | 3 | 5 | tabs: 1 click + 1630 px scroll, collapsed 40 px bar. rail: 0 clicks, rows hidden under footer at 1440x900, preview 1141 px down. flow: 1 click, 0 scroll, both on screen. |
| Job visibility / resilience (S4) | 3 | 5 | 3 | rail: sticky bar on every tab, also while scrolled, Cancel from any tab. tabs: sticky only on Analyze tab (+ "3/25" tab badge); 0 progress bars visible on Diagnosis/Rules/Documents. flow: bar on all 4 steps but not sticky (0 visible after scrolling Configure) and 0 visible in Project guidance. All three resume after reload. |
| A11y (S9) | 3 | 4 | 4 | Tab stops from first main control: tabs Fields 48 / Test 58; rail Fields 13 / Test 25; flow a few per step (Test 3 after the step buttons). Focus rings visible on every stop (outline 2px or shadow). Shared axe and focus-loss issues, see below. Tabs adds names like "Analyze run 3/25". |
| Density at 1440x900 | 2 | 4 | 3 | tabs above the fold: Run + Instructions + top of Targets (no targets list, preview or Fields). rail: Run, Instructions, Fields header, 10 target rows. flow: header+area switch+stepper use ~270 of 850 px; Configure shows Run + Instructions. |
| Consistency with the rest of the app | 5 | 3 | 2 | tabs = cards in a 1120 px column and the same Tabs primitive as other areas. rail = new two-scroll-region layout. flow = new stepper plus segmented area switch plus nested tabs. |
| Narrow width (800 px) | 4 | 2 | 4 | No horizontal page scroll in any variant (doc 800/800, main 608/608). tabs: sticky footer wraps to 2 rows, Fields/preview stack (preview 190 px below Fields). rail: stacked rail, preview at y=2025, actions footer not pinned, Analyze at y=1040. flow: header description ellipsized; Review step label wraps. |
| RTL | 4 | 4 | 3 | `dir=rtl`: layouts mirror in all (rail moves right, stepper reverses, sidebar right). Arabic item right-aligned in targets and test result (computed `dir=rtl`, `text-align:start`). Shared bugs below. Flow Back/Next chevrons not mirrored. |
| **Weighted total** (J1, Fields, Job x3) | 50 | 59 | 59 | |
| **Plain sum** | 34 | 37 | 35 | |

## Step counts per scenario

Actions (scroll excluded), measured on 1440x900. "visible" = result on screen without scrolling.

| Scenario | A tabs | B rail | C flow |
|---|---|---|---|
| S1 map ACTUAL OUTPUT to `summary` + `citations[*].quote` (open Fields, "Full value", untick "Use full value", untick `key_points`, untick `id`) | 5; Fields needs ~1630 px scroll first; preview text change not on screen (see note) | 4 (Fields already open); ~300 px page scroll to see preview | 5 (Preview step click + 4); no scroll |
| S1 effect visible without scrolling? | Partly: "UPDATED" badge, "1,378 chars", "2 fields" chip yes; changed text no | Yes: Updated, chars and the "Sent:" chips (`actual output: summary, citations[*].quote`) after a page scroll | Updated badge and chars yes; "Sent:" chips and the user message below the fold of the preview |
| S2 `{rubric}`: click textarea, type, open source select, pick option | 4; row appears inline in Instructions card, visible | 4; row appears in the rail card, visible, "1 VAR" badge | 4; row appears in Configure, visible |
| S3 Test 1 item | 1 | 1 | 2 (Run step + Test) |
| S3 result visible? | No: card top 2362 px, no auto-scroll | No: card top 1619 px | Yes (top 518) |
| S3 check 3 items (4th blocked) | 3 checks (+1 Test = 4). 4th box disabled, no reason shown | 3 (+1) | 3 on Configure + 1 step to Run + 1 Test = 5. 4th disabled, no reason |
| S4 Analyze, watch retrying, Cancel, Analyze again, reload | 4 (1+1+1+1 reload) | 4 | 5 (adds Run step click) |
| S4 retry line | "Item 4: LLM_TIMEOUT, retry 1 of 2 in 2s" in footer bar and job card | same, in sticky bar | same, in bar and job card |
| S4 reload resumes? | Yes, "resumed after reload" tag, progress 3/25 | Yes | Yes |
| S4 time to completion | ~34 s after reload; completion in footer bar + card ~2360 px down | same; sticky bar + card at bottom | same; Review step shows bar + card on screen |
| S5 Rules: tab, edit rule (2), Publish, confirm, select v3, Promote | 7 | 7 | 8 (area switch) |
| S5 Generate rules (from draft v5) | 2 | 2 | 3 |
| S6 Diagnosis: tab, Hallucination, fill Use when (2), Save, resolve 409 (Overwrite) | 6 | 6 | 7 |
| S6 with "Reload latest" instead | 9 (edits lost, refill + save again) | same | same + 1 |
| S7 Documents: tab, toggle, upload (setInputFiles = 1; real = 2 + OS dialog), delete | 4 (5 real) | 4 | 5 |
| Total of S1, S3 (3-item), S4, S5, S6 | 26 | 25 | 30 |
| Scrolling needed | S1 ~1630 px, S3 ~2360 px | S1 ~300 px, S3 ~1620 px | none (steps fit) |
| Dead ends / confusion | Test result invisible after click; Fields far away | footer buttons clipped on first paint; preview below fold | targets for Test chosen on another step than the Test button |

Observed behaviours worth knowing (identical in all variants unless noted):
- S1 picker: unticking "Use full value" ticks every path; picking only two paths took 2 further unticks. Preview text really changed
  (`ACTUAL OUTPUT` became `summary: ...` and `citations[*].quote: fares will fall`, 1,496 to 1,378 chars).
- The preview shows the system message first; the user message (where the mapping effect is) is below it inside a scrolling box in every variant.
- S3 result card shows issues with category, subcategory, finding, confidence %, duration, and "Fields sent:" chips. Cancel test button appears during the 1.4 s test.
- S5: after typing the cue goes "Saving draft..." then "Draft saved" within ~1.3 s. Publish dialog has "Set as production" already ON (no extra action needed). After publish the version is read-only,
  "Generate rules" becomes disabled (a hint "Create a draft from this version to edit" appears); Promote v3 happens immediately (no confirm, no toast). Generate rules: Queued 0%, Generating 36%, 72%, Completed 100% (~5 s), a 4th rule appended.
- S6: two "Needs examples" badges (Hallucination, Formatting) and "Incomplete" on Hallucination; Save disabled until edit; first Save shows a role=alert banner (revision 8 by Sara N.). "Overwrite with my edits" gave SAVED (revision 9); "Reload latest" drops the edit and the Taxonomy-required state returns.
- S7: toggle updates the summary line ("3 of 3 enabled, 8,440 characters"); upload appears at once (no progress state in the mock); delete removes the row immediately with no confirmation or undo.
- Cancel of the analysis shows no intermediate "Cancelling" state: status stays "3 / 25 items" for ~1.4 s, then "Stopped at 3 / 25; analyzed items were kept." (may be mock timing.)
- After completion "Analyze N items" becomes "Analyze 0 items" because Skip analyzed excludes done targets.

## Must-fix before implementing flow

1. **Hidden checkbox/switch input scrolls the whole document and blanks the page.** The visually hidden `<span>` around the input is `position:absolute` but its `LABEL` is `position:static`, so the
   input sits at layout coordinates and focusing it scrolls `document.scrollingElement`. Repro (flow, 1440x900): Preview step, "Full value" on ACTUAL OUTPUT, click the label "Use full value":
   `scrollY` goes 0 to 1161 and the viewport shows only the dark canvas until scrolled back. Also: Configure step, click the box "Select item 1 for test" (`scrollY` 532 to 663 for items 1-3), and with the keyboard (focus a target checkbox).
   Seen in tabs (513-709 px) and, once, in rail (217 px). Fix in the Checkbox/Switch primitive: `position:relative` on the label (or `inset:0` clip on the span).
2. **Job bar: make it sticky and show it everywhere.** In flow the bar sits under the stepper and scrolls away (scrolled Configure: 0 progress bars in view) and in "Project guidance" there are 0 progress bars
   in view (only a small count on the segmented option). Make it `position:sticky` below the stepper/area switch and render it above the guidance tabs (steal from rail). Also de-duplicate: Run step and Review step currently
   render two progressbars named "Analysis progress" and two `role=status` regions (bar + job card), and on Review the completion appears twice (bar and card). Keep one progressbar, one status.
3. **Test targets are chosen on Configure but Test lives on Run.** Repro: Run step, `Test selected (1)`; to test items 1-3 you go back to Configure, tick 3 boxes, return. Show the chosen target list (e.g. "Testing #1, #3, #7 - change") on the Run step, or put a compact checkable target list there. The 4th checkbox is `disabled` with no `title`/text; add "Up to 3 items per test".
4. **Step notes lie.** At load the Preview step shows a check mark before it was visited (`data-done`). After a job completes, Configure says "0 targets" (Skip analyzed hides them) while Run says "Not run" and Review "Complete". Do not mark steps done by default; use job state for Run; do not auto-advance, but add a "Review results" button on the completed job bar.
5. **Focus management after job actions.** After Enter on "Analyze N items" and after Enter on Cancel, `document.activeElement` is `body` (button disabled/unmounted) in all variants. Move focus to the job bar (or its Cancel button) and to the status after cancel.
6. **Make a mapping edit visible in the preview.** The changed section is in the user message, below the system message inside a scroll box. Scroll the preview to the user message after an edit (or show the user message first / highlight the changed block) and keep the "Sent:" chips above the fold. Currently only the "UPDATED" badge and char count are on screen.
7. **Run Test result must be pointed at.** If the Test button stays on a long page, scroll to or focus the result card when it completes (in flow it is already on screen).
8. **800 px fixes (shared Guidance).** Diagnosis inner tablist clips the third tab ("Exa" visible at 800; tab element right edge 830 > 800): allow horizontal scroll with fade or wrap. Flow page description is ellipsized ("...keep project guidanc..."); the stepper's Review label wraps to 2 lines making cards unequal heights.
9. **Copy:** flow Instructions card says "Detected {variables} are mapped in the next step" but the mapping row appears immediately under the textarea in Configure. The Project scope landing says "Diagnosis, Rules and Documents below" but in flow they are behind the "Project guidance" switch (extra click), so the landing should offer them.
10. **RTL:** the segmented controls (Scope, Workspace area) place their selected-pill with a physical left offset (`--qym-segment-x`): under `dir=rtl` the highlight sits on the wrong option and the text is unreadable. Pagination first/last glyphs and the flow Back/Next chevrons do not mirror. Item text `1-10 of 14 items` renders as `of 14 items 10-1` (expected for English strings; localise).
11. **axe (serious):** (a) picker tree `<li>` elements whose parent is not a list (x7) in all variants; (b) `label-content-name-mismatch` on target metric chips (x12 in tabs, x15 in rail): visible "faithfulness 0.42", accessible name "Preview faithfulness for item 1, score 0.42": start the aria-label with the visible text. Moderate everywhere: `heading-order` (h3 after the page h1).
12. Duplicate/polluted names: in tabs the tab is named "Analyze run 3/25" and its tabpanel too; keep the progress badge `aria-hidden` or outside the name. (Not applicable if flow is chosen except for the segmented controls.)
13. Product decisions the mock skipped (flag, not bugs): Promote has no confirm and no toast; document delete has no confirm/undo; no upload progress or large-file confirmation; Cancel has no "Cancelling" state.

## Ideas worth stealing from the losers

From **rail (B)**:
- The persistent sticky job status bar under the tabs (phase badge, "3 / 25 items", retry line, progress, Cancel, then View run / Dismiss); it was the only one visible on Diagnosis/Rules/Documents and while scrolled.
- "Target filters" collapsed with a one-line summary: `25 targets · max 0.8 · skip analyzed · 3 issues`.
- An "N VAR" badge on the Instructions section when `{variables}` are detected.
- Pinned run actions beside the config (use the same idea as the flow footer, but fix the 17 px clipping at 1440x900 first).
- A two-column Preview step (Fields rail on the left, preview right) is already what flow does; keep the narrow, scrolling rail look for Fields rows.

From **tabs (A)**:
- Live "3/25" badge in the tab label of the area that owns the job (use it on the "Analyze run" area/step label so the job is visible even if the bar is dismissed).
- Select disabled with the reason: "Cancel the running job to switch samples." next to the Sample select.
- Collapsed Fields summary text ("input · expected · output") - reuse it as the step note under "Preview" instead of the char count.
- The sticky footer with the run bar (connection, Test selected, Analyze N): flow's Run step could keep Test/Analyze in a sticky footer so they stay reachable while the target list is scrolled.
- Cards in a 1120 px column and the existing Tabs primitive for the Project guidance area.

## Mock bugs and artefacts (not design issues; the implementer should ignore)

- `No HydrateFallback element provided to render during initial hydration` warning on every load (expected).
- Mock timers: 1.4 s test, 1.4 s per item, retry at item 4 (shows "Item 4: LLM_TIMEOUT, retry 1 of 2 in 2s" while 3/25 done), a fixed 23 analyzed / 2 failed outcome, the "resumed after reload" tag, Cancel settling after ~1.4 s.
- Fake 409 on the first Diagnosis save; fixed Rules (v5 draft, v4 live, v3, v2), fixed test result texts, instant upload and delete, one generated rule "Cite only retrieved passages".
- The mock's mono font renders the Arabic JSON in the preview with slightly stretched glyphs but readable; real Arabic font handling needs checking in the real page.
- Authors' own note (not re-verified): the `Tabs` vertical orientation leaks styles into nested horizontal Tabs.
- The variant links in the mock topbar and the static sidebar are chrome, not the page.

## Console and page errors

Only the expected `HydrateFallback` warning. No console errors, no page errors in any run (all scenarios, three variants, 1440 and 800).

## What I could not verify or did not do

- The helper button "Add a {rubric} variable" was not clicked (S2 was done by typing); not checked: Cancel test, Escape closing dialogs, Shift+Tab traversal, screen reader announcements (only roles/names via ariaSnapshot and axe).
- axe `label-content-name-mismatch` appeared only after the first interaction (not on the very first scan of tabs/rail initial) and was not reported on flow's scans (its target list is not mounted on the Preview/Run steps at those moments).
- RTL chevron direction in flow is judged from a screenshot, not from DOM inspection. The scope-pill misplacement was seen in rail 1440 and flow 800 screenshots and is assumed shared.
- Density, consistency, and the 1-5 scores are judgements; the numbers beside them are measured.
- Rules deletion, "Create draft", version compare, example picker and Documents drag-drop were not in scope and were not exercised.
