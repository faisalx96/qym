# Review: experiments versions, global sweep, tables, raw JSON (round 2)

Branch `ui/redesign2-experiments-versions` at f067007c. Shots and probe scripts: `/tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/61846e82-dc0e-402d-b3ec-d3565a3b1b04/scratchpad/v2/`. Seed: exp-demo with the experiments seed plus a `golden` dataset; the production fake service served a patched schema with three array leaves (STOP_WORDS string list, ALLOWED_REGIONS integer list, TOOL_LIMITS object list) for the list check.

## Verdict
MEETS THE STANDARD for all four asks, with a short polish pass (a few hours): one major (adding an item to a list floods the problem list) and six minors.

## The four asks against the owner's words
| Ask | Result | Evidence |
|---|---|---|
| 1 Versions from the model cards to home | Met. "Evaluation Service versions" Card sits on home between Environment/Dataset and "Start from" once an environment is ticked: one row per environment (agent / image / kb tags), Refresh, "Add versioning details" link to step 1. Read once (1 request on tick, none on name typing or re-render). Models step no longer has it; review shows a read-only "Versions" row (also on a deep link). Refresh picks up a changed service value (agent-2.0.0 appeared after the control call). Unreachable service: row says "Couldn't read: service unavailable" and launching is not blocked. | rv v2/home1-d.png, home1-m.png, home-two-d.png, home-down-d.png, models-d.png |
| Is "getting the versions" satisfied by the read-only block? | Yes. A run records what the service reports; the only thing a user can add is a free-form override, which is one link away. A picker would need a launch-request field that does not exist (documented in "Decisions: versions on home"). Nothing more is needed unless the owner meant choosing a version to run, which is a platform contract question, not UI. | decisions doc |
| Three-action path | Still three: tick one environment, type a name, Launch as is. Verified end to end: one experiment, one job on the fake service. | probe l.mjs |
| 2 Global sweep from "All roles" | Met. Inspected the payloads the fake service received. Endpoints timeout sweep [30, 60] on All endpoints with endpoints primary and fast: 2 jobs, each with both endpoints at the same value (30/30, 60/60), not 4. Plus All roles temperature [0, 0.5]: 4 jobs (2 x 2), every job has all 24 roles set, temps 0 or 0.5, timeouts 30 or 60. Review says "2 x 2 = 4 combinations x 1 environment = 4 runs", button "Launch 4 runs", row says "sweeps 2 runs". | probes f.mjs |
| 3 Endpoints as a table with a global row | Met when there is more than one endpoint: table (Endpoint, model, base_url, api_key, timeout ...), "All endpoints" row with the same control and "Sweep values" per column, per-endpoint rows, "+ Add endpoint". With exactly one endpoint the global row is not shown (RoleTable.tsx hasAll), unlike "All roles", which shows with one role; see minor 1. | v2/llm-d.png, both-sweep.png |
| 3 "Every list in the schema" | Met for scalar and object lists. A scalar list (string or integer) renders as a table with #, Value, an "All items" row, one row per item and Remove; an object list renders columns per key (name, limit) with "Mixed" in the All row. See major 1 and minor 2 for the add-item behaviour and width. | v2/arr3-stop.png, arr4-tools.png |
| 4 Raw JSON hidden unless clicked | Met. Review step shows no editor ("Show raw JSON" button, CodeMirror count 0); Show opens it (aria-expanded true), Hide closes it; the review pane's "Raw JSON" action opens it. At 1440 and 390. Default-preset editor keeps its collapsible heading. See minor 5 for the duplicate affordance. | v2/review-hidden-d.png, review-hidden-m.png, review-shown-*.png |

## Gate
- `npm run check`: 134 files, 1239 tests passed; design-language 47 passed.
- `npm run build`: OK.
- Playwright `e2e/experiments e2e/shell e2e/visual-language`: 265 passed, 8 skipped, 0 failed (9.3 min), including `experiments/a11y.spec` and the new versions, tables and sweeps specs.
- axe (wcag2a, wcag2aa, serious and critical) on home, step 1, review hidden and review shown at 1440 and 390: no violations.

## Fix list
### Major
1. Adding an item to a list creates `null`, which fails validation immediately: three "+ Add item" on a string list gave four problems ("Every item must be string" plus one "None is not of type 'string'" per item), and an object list shows items as null so its columns do not appear until the user pastes JSON. The review pane lists all of them in red. New items should start as an empty string, 0 or {} (the schema type default), and the per-item errors should collapse into one. Files: `settings/JsonFields.tsx` add-item handler, `model/listTable.ts`.

### Minor
1. One endpoint shows no "All endpoints" row (RoleTable.tsx hasAll via the model allRow); "All roles" shows with one role. Show it for consistency, or hide both with one row.
2. List tables sit in a narrow block (about 390 px at 1440): the object table's second column ("limit") is clipped (v2/arr4-tools.png). Let the list block use the full row width.
3. The sweep editor opens inside the All row cell and makes that row about 170 px tall, with the other cells floating at the top; per-row swept cells are truncated to "Sweep: 30, 6" (v2/both-sweep.png, ep-m.png). Show the full summary (title or wrap) and consider a popover for the chip editor.
4. At 390 px the endpoint and role tables scroll horizontally inside their wrapper and the first column (row name) scrolls away; make the first column sticky (v2/ep-m.png). Also `main` reports a scroll width 1182 px larger than its client width in that view (document itself does not scroll); worth checking nothing is overflowing visibly.
5. The review step keeps a "Raw JSON" heading, "in sync" tag and description above the Show button, and the pane has its own "Raw JSON" action: two affordances for one thing. Collapse the heading to just the button.
6. Mobile polish on the home versions card: the "Add versioning details" and "Refresh" links are centred on their own row under the description (v2/home1-m.png); align them to the card edge.
Pre-existing, not from this branch: "Edit as fields" on an empty list writes `[]`, which marks the setting changed and sends an empty override. Worth a follow-up.

## Spec deviations
None beyond the above; Decisions sections in redesign/experiments-create.md match what ships.
