# Round 10 review: Customize bar, swept-setting columns, versions as reported, bar follows the content

Branch `ui/redesign10-review` (from the implementation tip c130897d). Stage 3 of 3, independent of the design and the implementation
agents. Spec: `experiments.md` (40 criteria, section 6 amendments, decisions D10-1..8, orchestrator amendment L1). Implementation notes:
`impl-notes.md`.

**Overall verdict: MEETS WITH FIXES** (39 MEETS, 1 MEETS WITH FIXES, 0 DOES NOT MEET; L1 and D10-8 MEET). Two required fixes, neither
in the product: C-3-9's grep scope (spec wording) and one stale assertion in `e2e/visual-language/final-polish.spec.ts:109` that fails
against the round 10 bar (the implementer changed that spec and never ran it). Gate: e2e/experiments 332 passed / 1 skipped, e2e/shell 99 /
8 skipped, e2e/visual-language 79 passed / 1 failed (R2) / 2 skipped, build and the design test green.

## How it was measured

- **Production build served by the platform** (no Vite): the `_static/app/` of c130897d (the orchestrator's `npm run build`, rc 0, copied
  from the implementation worktree, same commit) served by uvicorn on :8972, SQLite created by `frontend/scripts/dev_db.py`, two fake
  Evaluation Services :9072 (staging) and :9073 (production) with `--datasets --tasks`, seed `measure/seed_r10.py`
  (`R10_PLATFORM_PORT=8972 R10_FAKE_PORTS=9072,9073`). Chromium through Playwright, dark theme (the app has no light theme: no
  `prefers-color-scheme` or `data-theme` rule in `frontend/src`; a `colorScheme: 'light'` pass drew the same colours).
- The design's scripts re-run against the build (`R10_BASE=http://127.0.0.1:8972`): `m_bar`, `m_review`, `m_versions`, `m_gap`; raw outputs
  `measure/review-m_*.txt`. What they lack is in new scripts (same folder, same helpers, raw outputs `measure/review-r_*.txt`):
  - `r_bar.cjs`: every attribute of the five slots on the 6 launch steps and the **5** editor steps (m_bar has 2) at 1440 / 1024 / 390,
    chrome against the tokens resolved in the page, every button / link / menu item named Launch* or Publish* in the whole page, a Tab sweep,
    the home bar, the over-the-limit state (dry run answered with `max_jobs: 4`).
  - `r_end.cjs`: the bar at the top, the middle and the end of the scroll with the **lowest painted box** (not only the bar's sibling), launch
    and editor, 1440x900 / 1440x1400 / 390x844.
  - `r_versions.cjs`: the Versions grid with 2, 3, 5 (object and number), unusual keys (`alpha.version`, a 48-char key, a boolean), `{}`,
    `image_version: null`, unsupported, error, the loading frame, contrast; the Experiments list filters and the best-run picker with injected
    answers.
  - `r_misc.cjs`: axe (axe-core 4, serious + critical), the review's Summary rows and first screen, cards at 390, duplicate names, the scroll
    threshold and one environment (dry runs rewritten as in the e2e), C-4-1 computed styles, the step change sampled every 100 ms, Back /
    Cancel / Skip targets, the Tab order.
  - `r_median.cjs`: D10-8, the run detail pass table on the repeat run of `seed-run-detail.ts`, **before** (the 0c7b4ed4 `frontend/`
    extracted with `git archive` into the scratchpad and served by Vite against the same platform) and **after** (the build).

## Criterion table

### Point 1: the bar (K1)

| Id | Required | Measured | Verdict |
|---|---|---|---|
| C-1-1 | 5 parts `skip, cancel, status, back, continue` on 6 launch + 5 editor steps; `bar-launch` 0; 4 buttons + the status link | exactly those 5 parts in that order on all 6 launch and all 5 editor steps (where, models, settings, evaluation, review) at 1440, 1024 and 390; `bar-launch` 0 on every step; buttons 5 with the "Fix 1 problem first" link, 4 in the Ready state and in the editor (no link) | MEETS |
| C-1-2 | skip.x - bar.x = 15 +- 1; bar.right - continue.right = 15 +- 1; cancel = skip.right + 8; back.right = continue.x - 8; x constant <= 1 | 1440: bar 212..1405, skip 227 (15), continue ..1390 (15), cancel 340 = 332 + 8, back ..1262 = 1270 - 8; 1024: bar 212..989, continue 854..974 (15), back 792; every part's x identical (0 px) across the 6 launch steps, the 5 editor steps and the Ready clone | MEETS |
| C-1-3 | Continue neutral, enabled with problems, `aria-label` "Continue to <next>"; last step launch / publish primary, disabled as before; min 120 px; Back x equal | steps 1-5: `data-action=continue`, "Continue", `data-variant=neutral`, enabled with "Fix 1 problem first", aria-labels "Continue to starting point" ... "Continue to review and launch" ("... review and publish" in the editor); review: `launch`, "Launch 12 runs" (Ready, enabled), "Launch 2 runs" (Name problem, disabled), "Launch" (1 run, disabled); editor review: `publish`, "Publish v2", disabled with 0 changes; primary on the last step; `min-inline-size` 120px; Back 1208 with "Continue" and with "Launch 12 runs" (0 px) | MEETS |
| C-1-4 | Skip enabled 1..N-1; last step disabled, `aria-disabled`, out of Tab, same x; "Skip to review" / "Skip" <= 480; aria-labels | enabled on 5 steps; review: `disabled`, `aria-disabled="true"`, x 227 = 227; Shift+Tab from Cancel on the review lands on "Show raw JSON" (Skip skipped); "Skip to review" at 1440 / 1024, "Skip" (51 px) at 390; "Skip to review and launch" / "Skip to review and publish" | MEETS |
| C-1-5 | Cancel ghost, Back neutral, both enabled; same targets | Cancel `ghost`, Back `neutral`, enabled on every step; launch: Back on step 1 -> the home view (`launch-home` present, URL `/experiments/new?env=...`), Cancel -> `/projects/exp-demo/experiments`; editor: Back on step 1 and Cancel -> the environment page `/environments/<id>`; Skip -> `&step=review` | MEETS (optional O1: the editor's step-1 Back is labelled "Back to the start") |
| C-1-6 | 0 controls named Launch* / Publish* on where..evaluation | 0 buttons, links or menu items whose accessible name starts with Launch / Publish on the 5 launch steps and the 4 non-last editor steps at 1440, 1024 and 390 (DOM-wide, hidden included); Tab sweep from the top of each page at 1440: 0 such stops; no keyboard shortcut handler in `launch/` or the editor; review: 1 (`bar-continue`) | MEETS |
| C-1-7 | Tab = Skip, Cancel, link, Back, primary; Enter on Continue focuses the next h2; review Skip out of order | models (Name problem): bar-skip -> bar-cancel -> status link "Fix 2 problems first" -> bar-back -> bar-continue -> leaves the bar; Enter on Continue: focused `H2 Environment configurations`; review (Ready): Cancel -> Back -> primary; Shift+Tab from Cancel -> "Show raw JSON" | MEETS |
| C-1-8 | status between the groups (>= 14 px each side); centred >= 481, start <= 480; link behaviour unchanged | 1440: cancel.right 404 + 14 = 418 = status.x; status.right 1194 + 14 = 1208 = back.x; 1024: 778 + 14 = 792 = back.x; `justify-content: center` at 1440 / 1024, `flex-start` at 390; the link's focus-and-switch is round 9 C-4-3 (`r9-create.spec.ts`, in the gate) | MEETS |
| C-1-9 | 390: 3 rows, 90.8 +- 1 launch and editor, no overflow, status one line | 90.8 on all 6 launch steps, all 5 editor steps (was 110.2), the Ready clone and the over-the-limit state; rows: status y 762.2, Skip / Cancel y 783, Back / primary y 811; `scrollWidth` 277 = `clientWidth` 277; status 16.8 px high (one line) in the "N problems", Ready, "Over the run limit" and "0 changes vs v1" states | MEETS |
| C-1-10 | home bar unchanged: name, status, customize, launch "Launch as is"; 56 / 90.8 | parts `bar-name, bar-status, bar-customize, bar-launch` "Launch as is"; 56 at 1440, 90.8 at 390; status `flex-start` | MEETS (optional O2: 74.6 at 1024 with a problem, unchanged from 0c7b4ed4) |
| C-1-11 | 56 +- 1 every step; `--bg-elevated`, 1 px `--border-default`, `--radius-md`, `--shadow-popover`, buttons 24 px 11/600 | 56.0 on every launch and editor step at 1440 and 1024; background rgb(34,34,50), border 1px rgb(59,59,84), radius 8px, shadow `rgba(0,0,0,0.38) 0 12px 28px`: each equal to the token resolved in the page; every button 24 px, 11px / 600 | MEETS |

### Point 2: swept settings (K2)

| Id | Required | Measured | Verdict |
|---|---|---|---|
| C-2-1 | `# \| Environment \| Primary model \| Milvus Search Threshold \| Timeout \| Priority`, no "Swept setting" | `#`, `ENVIRONMENT`, `Primary model`, `Milvus Search Threshold`, `Timeout`, `PRIORITY` at 1440 and 1024; 0 "Swept setting" (before: `#, ENVIRONMENT, SWEPT SETTING, PRIORITY`) | MEETS |
| C-2-2 | last label segment, `text-transform: none`, section on duplicates 11 px 400 muted, no clipping | "Timeout" from "Endpoints › primary › Timeout"; `none`, letter-spacing `normal`; two timeouts: "Timeout / Endpoints › primary" and "Timeout / Endpoints › judge", sections 11px / 400 rgb(154,154,178) (`--text-muted`); 0 clipped (shot `review-runs-duplicate-names-1440.png`) | MEETS |
| C-2-3 | band "Linked: vary together" = sum of its columns +- 1 | 1440: 451.5 = 225.8 + 225.8; 1024: 243.5 = 121.8 + 121.8; plain axis: empty band cell; duplicates (linked): 602 = 301 + 301 | MEETS |
| C-2-4 | run 1 `gpt-4o prod`, `0.5`, `10`; 12 px; numbers mono; 0 tags; no overflow | run 1 `gpt-4o prod \| 0.5 \| 10` (from `params.sweep`, the label is `primary=gpt-4o thr=0.5 timeout=10`); 36 cells, 0 at 10 px, 0 Tags, 0 with `scrollWidth > clientWidth`; `0.5` / `10` 12 px mono (shot). `temporary: <model>` and `inherit` were not in the seed: unit `sweepColumns.test.ts` only | MEETS |
| C-2-5 | `#` 48 +- 1; Priority 240; >= 120; 1440 equal flex; 1024 no scroll | `#` 48 (before 102); Priority 240; 1440: 4 x 225.8; 1024: 4 x 121.8, scroll 775 / 775 | MEETS |
| C-2-6 | with Environment 6 / 3 fit, 7 / 4 scroll; without it one more fits; >= 120, nothing truncated | 1440: 6 swept 1191/1191 (7 x 129), 7 swept 1248/1191 (all 120), 7 without Environment 1191/1191 (129); 1024: 3 swept 775/775 (121.8), 4 swept 888/775 (120), 4 without Environment 775/775 (121.8); 0 clipped in every case | MEETS |
| C-2-7 | one environment: no Environment column; never narrower than `#`, one swept, Priority | 2 swept, 1 env: `# \| S1 \| S2 \| PRIORITY`; 1 swept, 1 env: `# 48 \| S1 903 \| PRIORITY 240` | MEETS |
| C-2-8 | row between Dataset and Priority; lines; 70.6 +- 4; absent without a sweep | rows `name, base, task, env, ds, swept, prio, versions`; lines `Primary model + Milvus Search Threshold: gpt-4o prod + 0.5, claude-sonnet eval + 0.7` + `linked` and `Timeout: 10, 30, 60`; 70.6 px at 1440 (114.8 at 390); absence without a sweep: e2e "R10 C-2-8 no Swept settings row" (gate) | MEETS |
| C-2-9 | "Sweeps: Primary model + Milvus Search Threshold (linked), Timeout" + Edit | exactly that text, Edit present, at 1440 / 1024 / 390 | MEETS |
| C-2-10 | 12 cards; one dt/dd per swept column in order; label 96; 160 +- 6 | 12 cards, all 160.0; dt `Run, Environment, Primary model, Milvus Search Threshold, Timeout, Priority`; dt 96 px; cells `gpt-4o prod, 0.5, 10`; no page overflow | MEETS |
| C-2-11 | 12 rows, 32 +- 1, a select each, 0 disclosures | 12 rows of 32; 12 priority triggers (`button[aria-haspopup=listbox]`, the only `aria-expanded` nodes); 0 `details` | MEETS |
| C-2-12 | 1440x1000: Summary, runs header, first 2 rows above the bar | Summary ends 704.8, runs header 834.5, run 2 ends 898.5, bar top 944 | MEETS |

### Point 3: versions as reported (K3)

| Id | Required | Measured | Verdict |
|---|---|---|---|
| C-3-1 | keys exactly, response order; 2-key payload: 2 cells, 0 "image" / "not set"; 5-key order | `{agent_version, kb_version}`: 2 cells `agent_version, kb_version`, 0 `[data-unset]`, no "image", no "not set" (1440 / 1024 / 390); `image_version: null`: the same 2 cells; 5 keys: `agent_version, kb_version, prompt_set, model_routing, build`; unusual keys in payload order: `zeta_build, alpha.version, enabled, a_very_long_versioning_key_name_from_the_service` (not sorted) | MEETS |
| C-3-2 | string Tag; number / boolean mono 12; object compact JSON 48 + "…", `title`; `data-wide` > 16 chars or object | strings in the version Tag (10 px mono, text = value); `4127` and `true` mono 12 px text; `model_routing` = `{"primary":"gpt-4o","fallback":"claude-sonnet","…` (48 + …), `title` 69 chars = the whole JSON; `data-wide` on `prompt_set` (18 chars) and `model_routing`, each as wide as the grid (515.5 / 307.5 / 205) | MEETS |
| C-3-3 | label line above; columns 5 / 3 / 2 at 547 / 339 / 237; no clipped key; 0 overlap | "Versions" 11px / 600 on its own line; box 547.5 -> 5 columns, 339.5 -> 3, 237 -> 2; 0 clipped keys (the 48-char key wraps at `_`); 0 overlapping cells, every payload and width | MEETS |
| C-3-4 | 3 placeholders on one row, no label text, `aria-busy`; loading = loaded for 1-3 keys at 1440 / 1024 and 1-2 at 390; 0 spacers | 3 placeholders, 1 row, all `aria-hidden`, busy frame text empty (one sr-only "Reading…", 1 px); box loading 124.6 = loaded 124.6 for 2 and 3 keys at 1440 and 1024, 2 keys at 390; 3 keys at 390: 166 (+41.4, the L1 shift); 0 spacer cells in the loaded DOM; one key: e2e "R10 C-3-3, C-3-4, C-3-7" (gate) | MEETS |
| C-3-5 | `{}`: "No versioning details reported" 11 px muted, 0 cells, 107.2 +- 2 | that line, 0 cells, box 107.2 at 1440, 1024 and 390 (shot `review-versions-empty-1440.png`) | MEETS |
| C-3-6 | unsupported / error texts unchanged under "Versions" | "Versions" then "Not supported by this environment (its Evaluation Service is older than v1.2)." / "Couldn’t read: kb offline" at 1440, 1024, 390 | MEETS |
| C-3-7 (**amended**) | 124.6 +- 2 at 1440 / 1024; 390: line 61.8 +- 1 (1-2 keys) / 103.2 +- 1 (3 keys), box 124.6 / 166 (+24 with the preset tag row) | 1440 / 1024: 124.6 (2 and 3 keys), line 61.8; 390: 2 keys line 61.8 box 124.6, 3 keys line 103.2 box 166. The spec carries the numbers, the reason and the word **amended**; `r10.spec.ts` "R10 C-3-3, C-3-4, C-3-7 … at 390px" asserts 61.8 / 103.2 +- 1 on the line (read in the spec source) | MEETS |
| C-3-8 | the grid per environment with names; production 2 keys, staging 3; 106.8 +- 4; 0 dropped | `staging: agent_version, image_version, kb_version`, `production: agent_version, kb_version`, names in a column; row 106.8 | MEETS |
| C-3-9 | the grep of the three names outside tests / fixtures / dev = 0 lines; constants deleted | `VERSION_KEYS`, `VERSION_LABELS`, `keyWords`, `versioningWords` absent; the grep as written returns **1 line**: `features/docs/partials/developer/endpoints.html:282`, the API reference of `POST /v1/product-evals` naming its request fields (present at 0c7b4ed4, not a UI key list); in `*.ts, *.tsx, *.css` 0 lines (also asserted by `noFixedVersionKeys.test.ts`) | MEETS WITH FIXES (R1) |
| C-3-10 | best-run header / table `key value` in payload order, JSON objects; drift `<key>: …`; list filters and scope selects keyed as reported, "All values" / "Any value" | best-run table Versions column: `kb_version kb-7 / agent_version 1.4 / model_routing {"primary":"gpt-4o",...}` (payload order, object as JSON); scope selects labelled `kb_version`, `agent_version`, `prompt_set` (payload order), first item "Any value"; list filters labelled `agent_version`, `image_version`, `kb_version`, `prompt_set`, first item "All values", title "Evaluation Service versioning: <key>" (shots `review-bestrun-1440.png`, `review-list-filters-1440.png`; answers injected). The drift line and the best-run header need a loaded best-run base and were not drawn in the browser: `driftLines` prints the server's `change.key` unchanged (read in `model/bestRun.ts`), unit `layering.test.ts`, `BestRunPicker.test.tsx` | MEETS |
| C-3-11 | placeholders `aria-hidden`; axe 0 serious with 5 keys; key contrast >= 4.5 | placeholders `aria-hidden`; axe serious + critical: 0 on the home view with 5 keys at 1440 and 390, 0 on the review at 1440 and 390; key rgb(154,154,178) on the selected box's resolved fill rgb(30,55,64): 4.56:1; mono value 10.73:1 | MEETS |

### Point 4: the bar follows the content (K4)

| Id | Required | Measured | Verdict |
|---|---|---|---|
| C-4-1 | margin-top 0, margin-bottom -32, sticky, bottom 0; `.page` no min-block-size; no growth | `0px / -32px / sticky / 0px` on the home view and on start; `.page` min-height 0px, flex-grow 0; `.home`, `.layout`, `.main` flex-grow 0 | MEETS |
| C-4-2 | 14 +- 0.5 when short: home (production, nothing, staging) and every step at 1400; start, settings at 900 | 1440x1400: home nothing / production / staging 14.0, the 6 steps 14.0 (before 497.5 / 374.3 / 284.0 and 553.7 ... 735.3); 1440x900: where 14.0, start 14.0 (before 216.1), settings 14.0 (before 235.3) | MEETS |
| C-4-3 | overflowing: bar bottom = viewport +- 1 at top, middle, end; end gap 14 +- 1 | 1440x900 home x3, models, evaluation, review, editor review and 390x844 every view (home x3, 6 steps, 5 editor steps): bottom 900 / 844 at the top and the middle, 899.6..900 / 843.6..844 at the end; end gap to the lowest painted box 13.5..14.0 | MEETS |
| C-4-4 | nothing below the bar adds height | every overflowing view: the bar's bottom in scroller coordinates = `scrollHeight` (852 / 852, 1012 / 1012, 1102.8 / 1103, 1323.8 / 1324, 2112.7 / 2113 ...); short views: `scrollHeight` = `clientHeight`, the area under the bar is empty ground (shot `review-home-short-1440x1400.png`) | MEETS |
| C-4-5 | where -> start: after the hold the bar's top = content bottom + 14; x unchanged | bar top 827.1 -> 826.8 held until 711 ms, 627.9 from 813 ms; start's content ends 613.9 (+14.0); h2 "Starting point" focused; parts' x identical before and after | MEETS |
| C-4-6 | the editor obeys C-4-2; env footer has no auto margin | editor where / start / models / settings / review at 1440x1400: gap 14.0; at 1440x900 the four short ones 14.0, review overflows (ends 14.0); `env-footer` margin-top 0px, sticky | MEETS |

### Amendment L1 and decision D10-8

| Id | Required | Measured | Verdict |
|---|---|---|---|
| L1 | no spacer cells; the grid takes the height of its keys; at 390 three keys add one row (37 px) once | 0 spacer cells; 1440 / 1024: loading = loaded (124.6); 390: two keys 124.6 = loading, three keys 166 (+41.4: one 37 px grid row plus its 4 px gap) | MEETS |
| D10-8 | `headerMinWidth` measures the drawn header; audit: review `#` 102 -> 48; run detail Median kept | review `#`: 102 before (0c7b4ed4), 48 after; run detail pass table on the repeat run: Median 215.8 at 1440 and 138.5 at 1024 **before and after** (other columns 189 / 121.3, unchanged); the implementer's audit table matches | MEETS |

## Findings

### Blocker

None.

### Required

- **R1 (C-3-9, spec wording only).** The grep as written returns 1 line: `frontend/src/features/docs/partials/developer/endpoints.html:282`,
  the developer API reference of `POST /v1/product-evals`, whose request body really has fields named `agent_version`, `image_version`,
  `kb_version` (present at 0c7b4ed4; not a key list the UI draws). Amend C-3-9 to the UI code it targets: "`grep -rnE … --include='*.ts'
  --include='*.tsx' --include='*.css' frontend/src` outside tests, fixtures and `features/dev` returns 0 lines" (measured: 0, and the scope
  `noFixedVersionKeys.test.ts` already uses), marked **amended** with that reason. No code change.

- **R2 (gate, test only).** `frontend/e2e/visual-language/final-polish.spec.ts:109` "wizard settings step: one bottom bar … five round 10
  slots" fails in every run (orchestrator run 1 and 2, mine): `sticky elements in the bottom 140px` expected 1, received 0. Its last
  assertion assumes the bar is pinned to the viewport bottom; since C-4-2 the bar sits 14 px under the short settings content (measured:
  bar 608.7..664.7 in a 900 px viewport, so above `innerHeight - 140` = 760). The product is right (C-4-2 MEETS); the assertion is stale.
  Fix: assert instead that the bar is the only sticky element whose box touches the bar's band (or measure at a viewport shorter than the
  content), and add the C-4-2 gap (14 +- 0.5) there. Re-run the spec file.

### Optional

- **O1 (C-1-5).** In the preset editor the step-1 Back reads `aria-label="Back to the start"` but goes to the environment page
  (`/environments/<id>`). Pass the editor's label ("Back to the environment") through `StepsBar` (`onBack` already differs per mode).
- **O2 (home bar at 1024).** With both environments ticked and a problem shown the home bar is 74.6 px at 1024 (status wraps to two lines);
  identical at 0c7b4ed4 (74.6), and 1024 is not one of C-1-10's widths. Not a regression; noted for a later round.
- **O3 (header casing).** The runs table mixes `ENVIRONMENT` / `PRIORITY` (DataTable caps) with swept names drawn as written
  (`Milvus Search Threshold`), as the spec asks (C-2-2: the name is data). Reads as intended in `review-page-review-1440.png`; no change unless
  the owner remarks on it.
- **O4 (scripts).** `m_bar.cjs` covers two editor steps; `r_bar.cjs` covers all five. `m_gap.cjs` takes the bar's previous sibling as the
  content; `r_end.cjs` checks the lowest painted box at the scroll end (same result).

## The owner's reading

| Point | Shots (mock vs after) | Reading |
|---|---|---|
| 1 Continue and Back far right, no Launch shortcut, Skip far left | `mock-page-customize-where-1440x900.png` vs `review-customize-where-1440x900.png`; `mock-page-review-1440.png` vs `review-page-review-1440.png`; `review-editor-review-1440x900.png`; 390: `mock-page-customize-where-390x844.png` vs `review-customize-where-390x844.png` | Yes. [Skip to review][Cancel] … status … [Back][Continue] on every step, [Back][Launch 12 runs] / [Back][Publish v2] only on the review, in launch and editor mode; 0 Launch / Publish controls before the review (mouse, DOM, Tab). |
| 2 swept parameters hard to read | `mock-page-review-1440.png` vs `review-page-review-1440.png`; `review-runs-duplicate-names-1440.png` | Yes. A cold reader sees one column per setting named as the form names it (Primary model, Milvus Search Threshold, Timeout), the linked pair under "Linked: vary together", values the user picked (`gpt-4o prod`, `0.5`, `10`) at 12 px; no `key=value` string anywhere; the Summary names each axis and its values. |
| 3 versions as reported | `mock-page-env-versions-1440.png` vs `review-versions-two-1440.png`; `review-versions-five-390.png`; `review-versions-empty-1440.png`; `review-list-filters-1440.png`; `review-bestrun-1440.png` | Yes. Without `image_version` there is no image line; an object prints as compact JSON with the whole in its title; `{}` reads "No versioning details reported"; no invented key name on the launch page, the review, the best-run picker (scope selects, Versions column) or the Experiments list filters. |
| 4 empty band above the bar | `mock-page-home-short-1440x1400.png` vs `review-home-short-1440x1400.png`; `review-step-start-1440x1400.png`; `review-home-short-end-1440x900.png` | Yes. 14.0 px between the last card and the bar on the home view (3 states) and every step at 1440x900 and 1440x1400 (before up to 735 px); while the content overflows the bar sticks to the viewport bottom (900 / 844 at the top, middle and end). |

Also asked: `bar-continue[data-action]` per step: launch `continue` on where, start, models, settings, evaluation and `launch` on review;
editor `continue` on where, models, settings, evaluation and `publish` on review. The 390 bar is 90.8 px in every status state measured
(N problems, Ready, Over the run limit, "0 changes vs v1").

## Gate

Commit c130897d (my branch adds only this document, the review scripts and their outputs). The orchestrator's gate on the implementation
worktree (`scratchpad/r10/ig/status`, `status2`) and mine on this worktree (ports 8972 / 5972 / 9072 / 9073 / 9972, `--workers 1`):

| Command | Who | Result |
|---|---|---|
| `npm run build` (cost 3) | orchestrator | rc 0 (the build measured here) |
| `pytest tests/platform/test_design_language.py` | orchestrator | 1 passed |
| `npx playwright test e2e/experiments --workers 1` | orchestrator, run 2 | **332 passed, 1 skipped** (16.9 min); includes `r10.spec.ts` (34), `r9-create`, `r9-editor`, `wizard`, `qa-b-versions`, `list` |
| `npx playwright test e2e/shell --workers 1` | orchestrator, run 2 | **99 passed, 8 skipped** |
| `npx playwright test e2e/visual-language` | orchestrator, runs 1 and 2 | both stopped (rc 143) after `frozen-static`; in both, `final-polish.spec.ts:109` failed (R2), all other tests reached passed |
| `e2e/visual-language`, file by file, `--workers 1` | review | final-polish 7 passed / **1 failed (R2)**; contrast 6; frozen-static 5 passed, 2 skipped, 1 "Target crashed" (the `/__ui` gallery test at 3.4 GB available), re-run alone: **1 passed** (9.8 min); heading-scale 9; hover-audit 31; link-cards 11; motion 3; page-width 2; sticky-bars 4; table-edges 2. Total **79 passed, 1 failed, 2 skipped** |
| measurement scripts (`m_*`, `r_*`) | review | outputs `measure/review-*.txt` |

I did not run `e2e/experiments` and `e2e/shell` again: the orchestrator's second run on the same commit completed them while my run waited
for the gate lock (brief: run only what it did not). No e2e spec was added by the review.
