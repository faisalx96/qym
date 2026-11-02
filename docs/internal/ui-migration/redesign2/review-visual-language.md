# Review: visual-language (branch ui/redesign2-visual-language, 22 commits on cc4b38fe)

Reviewer evidence: before/after screenshots at 1440 and 390 of 22 pages each (scratchpad `vlr/before`, `vlr/after`, base built from
`git archive cc4b38fe`), a 300-item run plus 14 extra runs, the Playwright folders and the SDK viewer suite.

## Verdict
MEETS THE STANDARD for the foundation scope (tokens, tones, Card, chart kit, motion, ratchets, sweep S1 to S5). It does not by
itself change the look of the runs list, run-detail hero/overview or compare: those depend on A1, A2 and A3 applying the
palette (Task tag `kind="task"`, `Card band`, `KeyValueGrid tiles`, `Card series`), which is by design in the spec but means the owner will
see little until they land. Fix list is a polish pass (< 0.5 day).

## What the owner will see now (after vs before)
| Area | Result | Evidence |
|---|---|---|
| Teal no longer reads as data | Yes: Categories bars are band-coloured (green, orange, red) instead of all teal; latency scatter is pass/fail/task-error with quadrant washes; latency histogram bulk is neutral with p90/p95 tail in tone | after/rd-categories-1440, rd-latency-1440 vs before |
| Interaction | LinkButton (Export HTML) hover/press/focus fixed; hover audit green for runs, run detail; chart marks dim siblings and show ChartTooltip | hover-audit.spec, motion.spec |
| Runs list | Visually unchanged (A1) | runs-1440 |
| Run detail overview/hero | Unchanged apart from card padding and ScoreBar/ring (A2) | rd-overview-1440 |
| Compare | Unchanged (A3) | compare-1440 |
| Login | Radius 12 to 8 and lighter shadow; card 6px shorter. Acceptable, consistent with Card; was a deliberate larger radius, no regression of function | login-1440 |
| Launch Global model card | Now a plain Card without the highlight; only visible once an environment is chosen. Acceptable (spec Q9 rail only) but the "global" card no longer stands out from slot cards: consider `Card tone="info"` rail | GlobalModelCard.tsx |
| Dataset/project danger card | Rail danger, no wash: reads correctly | DangerZoneTab.tsx:14, datasets SettingsTab.tsx:166 |
| SDK viewer | Builds, e2e:sdk 42/42 at 1 worker | gate |

## Gate (measured on this branch)
- `npm run check`: vitest 126 files / 1180 tests pass, design-language 44 pass, typecheck, eslint, stylelint pass.
- build and build:sdk succeed.
- Playwright: shell 93 passed + 8 skipped; runs-list 169; run-detail 213; compare 93; experiments 127 passed, 1 failed
  (`experiments/environments.spec.ts:220`, timing flake: the whole file re-run alone passes 14/14 on the branch and on the base, 4x repeat of that test passes);
  visual-language 10; e2e:sdk 42 (1 worker).
- Implementer's flakes: `launch/evaluation.spec.ts:89` passed 4/4 on branch and 4/4 on base (not reproduced). e2e:sdk at `--workers 2` fails
  (2 to 6 of 42, varying) on BOTH the branch and the base: pre-existing shared-server parallelism, not caused by this branch.

## Hover audit and PENDING
Compare `_seg`, `_distBar`, `_rowButton`, `_errorCard` are deferred to A3. Acceptable provided the PENDING set is emptied in that merge (the spec says it may only
shrink). The audit samples only runs list, run detail and compare: experiments, launch, datasets, admin, analysis, reviews, settings are not audited (see minor 3).

## Fix list
Blockers: none. Majors: none.

Minor (6):
1. Scatter quadrant labels ("Fast and passing", "Slow and failing") overlap data dots, and at 390 px "Slow and failing" is clipped to "low and failing" and collides with the x tick (`run-detail/components/charts/Charts.tsx`, quadrant label). Move into the plot corner with a background chip or hide below 480px.
2. No page uses `Tag kind="task"` or `kind="config"` yet (runs list task is `kind="data"`, RunsTable.tsx:96; hero shows task as plain text), so the purple metadata encoding is declared but inert; make sure A1/A2 adopt it and add a ratchet.
3. Extend `hover-audit.spec.ts` to experiments list/launch, datasets, admin, analysis, reviews (the brief's feedback is app-wide).
4. `contrast.spec.ts` checks only the gallery in dark theme; add a real-page sample (run detail categories, errors) and light theme.
5. Global model card lost its highlight (see above); give it an info rail so it still reads as the master control.
6. Light "Launch as is" disabled button and hist bulk grey (`--bg-active`) are low contrast against the ground in dark theme (pre-existing for the button; the bulk bars are intentionally subdued but nearly vanish at 390).

## Code
Primitives used (Card, ui/Chart); no `any` or new eslint-disable in the diff; Card is `div role="button"` when interactive with a documented
no-nested-interactive contract; `useEntrance` gates motion once and reduced motion zeroes delays; tokens added verbatim and raw `rgba(` ratchet at 0.
