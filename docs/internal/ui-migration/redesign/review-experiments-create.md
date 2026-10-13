# Review: experiments-create (home + customize wizard)

Branch `ui/redesign-experiments-create` at 0b530a31. Reviewer shots and scripts: `/tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/61846e82-dc0e-402d-b3ec-d3565a3b1b04/scratchpad/rv/` (home-*, wiz-*, editor-d.png), seed: project exp-demo with the experiments seed plus a `golden` dataset.

## Verdict
MEETS THE STANDARD, with a short polish pass (well under a day). Both feedback points are answered: the home is a three-decision page and the wizard moves one section at a time with a measured 180 ms enter, reduced-motion respected, focus moved to the step heading. No blocker, no major. Seven minors.

## Evidence
| Question | Result | Evidence |
|---|---|---|
| Home simple for a non-technical user | Yes. Tick one environment, type a name, press Launch as is (3 actions; dataset, preset and priority are inherited). Hidden: priority, versioning, models, 100+ settings, evaluation, raw JSON, review pane. Empty state is neutral ("Pick an environment."), no red problems, Launch as is disabled, Customize enabled. Copy matches legacy. | rv/home-empty-d.png, home-ready-d.png, home-ready-m.png; HomeBar.tsx |
| Customize one section at a time | Yes. Six-step rail with done/current/upcoming, Back / Continue to <next> / Skip to review, review aside on steps 1-5, review in the main column on 6. | rv/wiz1-d.png, wiz-start-d.png, wiz-models-d.png, wiz-review-d.png |
| Transition smoothness | Enter: opacity 0 to 1 and 8 px rise over about 180 ms, 12 frames, no height jump (panel height constant across frames). Reduced motion: transform none, no animation, instant. Focus lands on the step H2 (also after keyboard Enter on a rail button). Live region announces "Step n of 6: label". | sampler output in review; wizard.module.css:11-47 |
| Form-wipe trap | Not present. Name and versioning typed on step 1 survive Customize, step changes, browser Back x2 to home, Forward, and the Start button. `?step=bogus` falls back to step 1; `?step=models` with no environment shows the "pick an environment" hint plus the problem count. | useStep.ts:7-14 (key ignores step); rv3/rv4 runs |
| Default-preset editor | Works, unchanged (stacked page, Outline, review and publish pane); deferred to phase 2 by the spec. Console clean. | rv/editor-d.png |
| Gate | `npm run check`: 119 files, 1101 tests passed, design-language 34 passed. Playwright `e2e/experiments e2e/shell`: 212 passed, 8 skipped, 0 failed (8.0 min). `runs-list/cutover-navigation.spec.ts`: 8 passed in isolation, including line 114. | logs in scratchpad |
| cutover-navigation:114 | It is still a `test.fail` (expected failure); in isolation it reports passed, meaning it still fails as expected. This branch does not touch runs-list. The implementer's "fails in isolation" is the expected-failure semantics or a timing flake, not a regression from this branch. | cutover-navigation.spec.ts:114 |
| Code | Stepper and Collapse are primitives in `ui/` with tests; wizard files are feature-local as specified; no `any`; the only eslint-disable lines added are the two existing `react-hooks/exhaustive-deps` ones. | git diff |

## Fix list (all minor)
1. Flash of an empty panel on deep link or reload. With `?env=...&step=models` the panel shows only the heading (about 25 px high, about 70 ms here, longer on a slow API) and then 800 px of content pops in after the enter animation has already played. `LaunchWizard.tsx` renders `loading ? null` for steps 3-5. Render a Skeleton in the panel while `flags.envsLoading`, or delay the enter until content is ready.
2. Scroll jump when the next step is shorter than the current one. From the bottom of a tall step (scrollTop 542) Continue clamps instantly to 0 (the old panel unmounts) and then smooth-scrolls back down to the rail (95). Trace: 542, 0, 3, 21, 57 ... 95. Scroll to the rail before unmounting, or set `scroll-behavior: auto` for the first jump (`LaunchWizard.tsx` step effect, line about 56).
3. Mobile (390): two sticky layers at the bottom (StepNav stacked as three full-width rows, plus the MobileLaunchBar) cover about 190 px of 844 and sit over the content (rv/wiz1-m.png, wiz-models-m.png). Put Back / Skip / Continue on one row (Back left, Continue right) or fold StepNav into the launch bar.
4. Rail labels for the long steps wrap with the number alone on the first line ("4 / Environment / configurations") at 1440 with the aside, and the rail keeps a reserved count row, leaving a gap of about 60 px between the rail and the step heading (rv/wiz1-d.png). Shorten the labels in the rail only (title attribute carries the full label) or keep the number inline.
5. On the Models step the "no changes" tag sits on its own line under the title instead of beside it (rv/wiz-models-d.png), unlike the editor page. The static section heading should keep the tag inline.
6. Home: "SAVED PRESETS" labels a row that also holds "From scratch"; the spec's own fallback label is "Other" when it mixes. Also the primary decision for a non-technical user is the neutral "Launch as is" next to an accent "Customize", the reverse of visual weight you would expect (the spec and legacy do the same; consider accent for Launch as is when ready).
7. Home at 390: the page header action "All experiments" wraps to its own line with a large blank gap above the Environments card (rv/home-ready-m.png); the fixed HomeBar covers the first Start-from card at the fold. Tighten the header and add bottom padding so the last card clears the bar.

## Spec deviations
None found other than the deferred editor wizard (T10, documented under "Deferred"). Everything in the spec's home and wizard sections is present: URL `?step=`, provider key, unsaved-changes guard ignoring step, Stepper, Collapse, tokens, reduced motion.

## Not run
Full 888-spec Playwright suite and the build (queued behind another agent's lock at report time). Areas outside experiments, shell and runs-list/cutover-navigation were not re-run.

## Re-review (commits 79e2f19d, 7a1521d7, c9d95778)

Verdict: MEETS THE STANDARD. Six of seven minors verified closed; one remains partly open (home bar at 390 px). Nothing new blocking.

| Point | Result |
|---|---|
| 1 Skeleton on deep link | Closed. Deep link to `?step=models` shows a Skeleton panel (135 px) until content, no bare heading; content then replaces it (801 px). |
| 2 Scroll jump | Closed. Trace from the bottom of a tall step: 491, 489, 479, 457 ... 95, one monotonic glide to the rail, no clamp to 0. Reduced motion: 491 then 95 instantly. |
| 3 390 px bars | Closed. Wizard step nav 34 px (one row: Back / Skip / Continue), launch bar 46 px (was about 190 px combined, now 80). Fresh shots: rv/r-wiz-models-m.png. Small nit: a sliver of the next card shows between the nav and the bar. |
| 4 Rail labels | Closed (numbers inline). |
| 5 "no changes" tag | Closed. Badge sits on the H2 row, right of the title (rv/r-wiz-models-m.png). |
| 6 Launch as is accent | Closed (accent when ready, Customize neutral; rv/r-home-d.png, r-home-m.png). "Other" label now separates From scratch from Saved presets. |
| 7 Home 390 px | Partly open, accepted as minor: the sticky bar (102 px) still covers the lower part of the Start-from cards at the fold, but when scrolled to the end the last content clears the bar (rv/r-home-m-bottom.png), so nothing is unreachable. |

Gate: `npm run check` 119 files, 1101 tests passed, design-language 34 passed. Playwright `e2e/experiments e2e/shell`: 218 passed, 8 skipped, 0 failed (7.8 min); this includes `experiments/a11y.spec` (no failure, no beforeAll timeout at 1 worker) and the fixed scroll e2e. Full 888-spec suite and `npm run build` not run by me.
