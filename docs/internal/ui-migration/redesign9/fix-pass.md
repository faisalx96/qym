# Round 9 fix pass

Branch `ui/redesign9-review`. Starting point: the review verdict MEETS WITH FIXES (`review-experiments.md`: 64 MEETS, 6 MEETS WITH FIXES,
2 DOES NOT MEET). First step: `UI-redesign` (df59af58, experiment key scopes) merged into the branch (`bb966dc4`; conflicts in
`docs/RELEASE_NOTES.md` and the generated `knowledge_platform.json`, resolved keeping both sides and regenerating the pack with
`python -m qym_platform.tools.build_feedback_pack`).

Measured in Chromium against Vite on the seed of the review (project `exp-demo`, production + staging, 6-run timeout sweep), dark theme.
Where a number is "after" it comes from the same script as the review's "before". Shots: `shots/after-fix-<surface>-<width>.png`.

## Required

| # | Finding | Change (file) | Before | After | Test |
|---|---|---|---|---|---|
| 1 | C-3-1 bar top edge moves between steps | The page fills the scroller (`LaunchPage.module.css` `.page { min-block-size: 100% }`, `.layout`, `.main` and the home's `.home` grow with `flex: 1 1 auto`) and the bar is pinned to the page's bottom edge (`launchBar.module.css` `margin-block: auto calc(-1 * var(--space-xl))` cancels the page's bottom padding; still `position: sticky; bottom: 0`, so the compositor keeps it on a long step). The Customize grid became a flex column (single child). | bar top y: 819.3 (where), 745.1 (start), 844 (others) at 1440x900; 844 / 792.9 / 844 at 1024x768 | 844 on the home view and on all six steps at 1440x900 (bar bottom = 900); 712 on all at 1024x768 (bottom = 768); 390: bottom = 844 on all (e2e) | `r9-create.spec.ts` `C-3-1 the bar's top edge ...` at 1440, 1024 and 390: bottom = viewport height and top equal on 7 views, within 0.5 px |
| 2 | C-3-8 home bar height at 390 (90.8 / 110.2 / 127 / 130.6) | `HomeBar.tsx`: at 390 the status keeps one line: "Ready" (the destination after it is a `.long` span, hidden at <= 480 px: the environment cards and Start-from above carry it), the problem text and the run count of a blocked form are `.long` too ("1 problem to fix  Show"). Ready keeps "2 runs to launch". The status text in the DOM is unchanged (`homeStatus`). Spec C-3-8 **amended**. | 90.8 no environment, 110.2 name missing, 127 Ready, 130.6 flagged task | 90.8 in every state: name missing, Ready, task not offered by staging (flagged); the 112 limit is gone | `r9-create.spec.ts` `C-3-8 at 390 the home bar keeps one height (90.8 px)` (three states, within 1 px, bottom = viewport bottom); the old home check asserts 90.8 +- 1 |
| 3 | C-5-7 review columns not asserted | e2e only | passed with "same row, gap 14" | 589.5 +- 0.5 for both columns at 1440; at 390 Checks is under Changes, one column, gap 14 | `r9-create.spec.ts` (the 1440 review test, the 390 review test) |
| 4 | C-8-4 / C-8-6 undocumented differences | Spec C-8-4 and C-8-6 **amended** (single `DatasetPicker`, Models step without the per-launch controls) | spec said 0 control differences, `DatasetsCard` | Models: editor = Customize minus `+ Add LLM endpoint`, `+ Temporary model`, `+ models`, `Edit LLM groups`, `New LLM endpoint name`; settings and evaluation: 0 control differences; 0 `data-part` differences on all three; step 1: 0 `datasets-fieldset`, 0 Add dataset | `r9-editor.spec.ts` `C-8-4 (amended) ...` (exact list) and `C-8-6` (picker) |
| 5 | C-3-7 / C-1-7 numbers the e2e carried | Spec C-1-7 **amended** (135.8 px with the third "Default preset v1" tag at 390, 136 +- 8); spec C-3-7 **amended** (the wrapped 110 px case is gone: the status is one line in every state, so the bar is <= 91 and the e2e's 112 became 91) | e2e 112 / 136 +- 8 with no spec line | spec lines carry the numbers; wizard bar at 390 <= 91 (status one line: "Fix 1 problem first" with the field name `.long` in `LaunchWizard.tsx` and `DefaultPresetEditorPage.tsx`) | `r9-create.spec.ts` C-3-7 (<= 91), C-1-7 (136 +- 8) |
| 6 | `review-d.spec.ts:337` expected the combined-run help under One run each | the scenario picks "Combine into one run" before it reads the help (the second read, after "One run each", is unchanged) | failed at the combined tip | passes | `review-d.spec.ts` `QD-5, QD-6, QD-12, QD-13, QD-16` |
| 7 | `r9-create` C-4-3 flaky | The test opens a Customize step in a fresh worker where Vite compiles the lazy step chunks; the status wait and the two heading waits had the 8 s default. They now wait 25 s (as `openLaunch` does) and the animations settle before the link is clicked. Also `C-1-3` raced a running colour transition on the Start-from card: it polls until the border settles. | 1 failure in the full folder (heading not visible within 8 s) | passed in the full run of both specs (38 passed) and in the folder gate (section Gate) | `r9-create.spec.ts` |

## Optional

| Finding | Done | Change | Before | After |
|---|---|---|---|---|
| C-2-6 task named by id | yes | `validation.ts` `taskErrors` names the task by its listed name (the lists' `names` map, `useEnvData.ts`, `types.ts`), by the id when no ticked environment lists it; unit test `QR9-C-2-6` in `datasets.test.ts`; `multi-task.spec.ts` expects "Route a ticket" | `staging does not offer the task "summarize"` | `... "Summarize thread"` (shot `after-fix-create-home-flagged-390.png`) |
| C-2-6 clearing time 780 ms | amended | spec C-2-6 now says within 1000 ms (the 600 ms debounce plus the request, 780 ms measured by the review at all widths); no code change, so not re-measured separately; the e2e waits 1000 ms | 780 ms against 600 | spec 1000 ms |
| C-6-9 priority column | yes | `ReviewStep.tsx` column `width`/`minWidth` 240, `.prioCell` lost its 240 px minimum (the 120 px select, the 8 px gap and "changed" fit: cell scrollWidth = clientWidth) | 280 | 240 (cells 102 / 689 / 160 / 240 at 1440, row 32) |
| Launch label "Launch 1 run" | no | not changed: with one run the label stays "Launch" (spec C-3-5 reads "Launch N runs" for N >= 2; "Launch" is the name many e2e selectors use (`name: "Launch", exact`), and "Launch 1 run" adds nothing the status does not already say: "1 run to launch") | "Launch" | "Launch" |
| Queue priority as a Tag | yes | `RemoteQueueSection.tsx` priority column renders the same `Tag` as the experiment detail (danger for HIGH, neutral otherwise, `data-job-priority`) | plain text | Tag |
| Empty band above the Queue and Matrix card titles (detail page) | no | predates round 9 (review finding 10); left as is | n/a | n/a |

## Gate

| Run | Result |
|---|---|
| `npm run check` (typecheck, ESLint, Stylelint, Vitest, design test) | Vitest 210 files / 1719 tests passed (the `QR9-C-2-6` unit test was added in the same commit, inside this count), design-language 54 passed |
| `npm run build` | built |
| `npx playwright test e2e/experiments` | first run 295 passed, 1 skipped, 2 failed (two older specs that read the old status wording and the task id: fixed); after the fix 297 passed, 1 skipped, 0 failed |
| `npx playwright test e2e/shell` | 99 passed, 8 skipped, 0 failed |
| `pytest tests/platform` chunks of 48, SQLite | 887 / 888 / 458 / 650 / 325 passed (6 errors in the last chunk: `test_xss_rendering_browser.py`, python-playwright wants chromium build 1243) |
| `pytest tests/platform`, PostgreSQL (`qym-test-pg-r9-fix`, port 55440) | 1086 / 1111 / 642 / 792 / 419 passed (the same 6 xss errors) |
| `pytest tests/platform/test_design_language.py` | 1 passed |

Not changed on purpose: the empty band above the Queue and Matrix card titles on the experiment detail page (predates round 9).
