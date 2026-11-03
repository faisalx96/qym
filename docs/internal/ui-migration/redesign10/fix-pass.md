# Round 10 fix pass (after `review.md`, verdict MEETS WITH FIXES)

Done by the orchestrator on `ui/redesign10-review` on 2026-11-03, after the independent review 49f8b4d6.

| Finding | Change | Evidence |
|---|---|---|
| R1 (C-3-9, spec wording): the grep as written returns the API reference `features/docs/partials/developer/endpoints.html:282`, which documents real request fields of `POST /v1/product-evals` | C-3-9 amended to the `*.ts` / `*.tsx` / `*.css` scope that `noFixedVersionKeys.test.ts` asserts; the HTML reference named as out of scope | `experiments.md` C-3-9, marked **amended (review R1)** |
| R2 (gate): `e2e/visual-language/final-polish.spec.ts` "sticky elements in the bottom 140px" expected 1 and got 0 because the round 10 bar follows the content (C-4-2) instead of being pinned | the assertion now checks the round 10 contract: the bar is `position: sticky`, sits 13 to 15 px under the step (`previousElementSibling`), and no other sticky element is in the lower half of the viewport | `final-polish.spec.ts` alone, `--workers 1`: 8 passed (39.3 s) |
| O1 (optional): the editor's first step labels Back "Back to the start" though it returns to the environment page | `StepsBar` labels it "Back to the environment" when `action === 'publish'` | `LaunchBar.test.tsx` new case "editor: Back from the first step names the environment page": 16 passed; eslint and `tsc -p tsconfig.app.json` clean |
| O2, O3, O4 | not changed (O2 predates the round and 1024 is outside C-1-10; O3 is what the spec asks; O4 the reviewer's `r_bar.cjs` already covers all five editor steps) | review.md |

Gate on the implementation tip c130897d (orchestrator, `scratchpad/r10/ig`): `npm run build` rc 0; design test 1 passed; `e2e/experiments --workers 1`
332 passed 1 skipped; `e2e/shell --workers 1` 99 passed 8 skipped; `e2e/visual-language` twice killed by the kernel OOM killer below its 4 GB
cap (machine-wide shortage while another project's session ran heavy work), file by file by the reviewer: 79 passed, 1 failed (R2, fixed
above), 2 skipped. The full gate on the merged `UI-redesign` tip is recorded in `docs/internal/ui-migration/REVIEW.md`.
