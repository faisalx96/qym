# Review: analysis redesign (ui/redesign-analysis)

Reviewer evidence: running UI at 1280/1440/1920/390 px, dark theme, seeded 25-item run, 3,000-item run, stub LLM. Screenshots in the review scratchpad (`rv/idle-*.png`, `scroll-*.png`, `test-done.png`, `job-*.png`, `drawer.png`, `open-disc.png`, `tab-*.png`).

## Verdict
MEETS THE STANDARD, with a short polish pass (under 1 day). The stepper, second switcher, sticky job bar and Back/Next footer are gone. The page is one workspace (Setup, Targets, Results) with one tab row and one action rail. A job or test no longer moves anything above the Results slot. The raw fold counts did not fall (see below), so the improvement is structural rather than numeric.

## Evidence

| Question | Result | Evidence |
|---|---|---|
| Answers "cluttered" | Yes. One tab row, one primary accent button per phase, preview in a Drawer, advanced fields in closed Disclosures. | `idle-1440.png`, `drawer.png` |
| Answers "not smooth" | Yes. Rail height constant (56 px), primary button width constant (168 px), no push-down at job start, list frozen on completion. Result card mounts in the reserved slot. | probe in `job-*.png`; header/tabs/setup tops unchanged through test and job |
| Counts, 1280x900, hit-tested (hidden/clipped DOM excluded) | controls 27, bordered boxes 9, chips/tags 5; first control (tab row) y~147-160 | `rv/m4.mjs` |
| Counts, brief's raw method (counts clipped Disclosure content) | controls 51, boxes 15, chips 7 | `an/lib2.mjs` |
| Brief's "before" | Configure 20 / 7 / 3; Preview 29 / 12 / 8; legacy 13 / 9 / 2; first control y 270 | spec section 3.2 |
| Layout shift, test then 34-target job | CLS 0.0226 (budget in spec and in `smoothness.spec.ts:88` is 0.01). Cause: the "analyzed" tag is inserted into each row and pushes the row text right. | `rv/m6.mjs` |
| Rail height / primary width | 56 px / 168 px all phases except "Analyze again" 115 px next to View run | probe |
| Disclosure content focusable while closed | No (Tab skips it) | `rv/m3.mjs` |
| axe serious/critical | 0 on idle, disclosures open, drawer, 3 guidance tabs (1440) | `rv/m7.mjs` |
| Drawer | `?preview=1`, focus moves in, Escape returns focus to the rail button | `rv/m7.mjs` |
| 3,000-item run (2,750 targets) | ready 1.0 s; open More options 59 ms, next page 300 ms, slider key 62 ms, toggle 100 ms | `rv/m9.mjs` |
| Gate | `npm run check` exit 0 (eslint max-warnings 0, tsc, Vitest 118 files / 1099 tests, design-language 34 tests); `npm run build` exit 0; `e2e/analyzer` 67 passed; `e2e/shell` + `analyzer/clutter` 96 passed, 8 skipped | `rv/gate.log`, `rv/gate2.log` |

Note: the implementer's own full Playwright run (`an-full.log`) never ran: it died on "port 8937 already used" (leftover servers from an earlier run, now killed). The gate above replaces it.

Reading the counts honestly: the old Configure step showed 20 controls because the rest of the flow was on other steps. The new fold shows Setup and the first Targets rows together, so a first-screen count of 27 is higher, not lower. What dropped is the number of concerns competing at any moment (no stepper tiles, no area switch, no job bar, no footer pair) and the total across a whole analysis (stepper flow summed 63 controls over three steps). A product owner will see a page with an obvious order and one green button. The Setup card is still tall (textarea, metrics, mapping row) before Targets starts.

## Spec deviations and defects

### Blocker
None.

### Major
1. 390 px target rows are four stacked lines (checkbox+id, chip, Preview button, input text), `scroll-390-1200.png`. Spec 5.3 says two-line rows. A 22-target list becomes very long on a phone. Fix in `blocks/Targets.tsx` + `blocks.module.css` (row grid at narrow width: line 1 id + chip + Preview, line 2 clipped input text).
2. CLS 0.0226 during a job, above the 0.01 budget the spec sets. Reserve the "analyzed" tag slot in every row (or render it with `visibility` and fixed width) in `blocks/Targets.tsx`. Also check why `smoothness.spec.ts:88` passes (it measures only the job, not Test then job; add the Test step or measure the whole flow).
3. `clutter.spec.ts` budget (<= 4 bordered, <= 2 chips) passes only because it counts four-sided borders and `[class*=badge]` chips. With the brief's measurement the fold has 9 boxes and 5 chips. Either tighten the measurement to the brief's definition or state the new budget in the spec doc; as written it overstates the result.

### Minor (8)
1. Dead file `frontend/src/features/analyzer/blocks/RunBar.tsx` (no importers). Delete.
2. Four new `eslint-disable-next-line react-hooks/exhaustive-deps` in `workspace/useRunWorkspace.ts` (lines ~134, 140, 207, 256) carry no reason text.
3. Input mapping inside the Setup card shows three bordered field rows (`open-disc.png`): card-in-card, against spec 5.1 principle 3. Use hairlines.
4. "More options" grid: Timeout and "Analyze limit" are misaligned vertically and the disabled limit input sits far from its label (`open-disc.png`).
5. Rail connection select is 24 px high next to 32 px buttons (`idle-1440.png`); align heights.
6. The accent "View run" in the rail after completion is rendered underlined like a text link (`job-done.png`); it should read as a button.
7. Targets subtitle after a job reads "22 items with failed metric targets . 34 analyzed this session": two different units next to each other. Say "34 targets analyzed this session" and keep the 22 as the live-match count with its own label.
8. The PageHeader description "Diagnose the failed metric targets of one run." is still shown on the Production rules and Documents tabs, where it is wrong.

## Must remain (spec 3.4 / QA inventory)
Walked in the running page or covered by the 67 analyzer specs: run header with View run, sample select, metric chips with All/None and `?metric=`, instructions with variable mapping, Input mapping with Full value pickers and include toggles, max score, Skip analyzed, Re-analyze human labels, timeout / limit / max issues, target list with up to 3 checks and pagination, per-row Preview, prompt Drawer with target select, context switches, char count, copy, connection select, Test selected, Analyze, cancel, job completion with "analyzed" tags, Refresh targets, View run, `?step=` legacy redirect, `?preview=1`, guidance tabs (categories, rules, documents) with live-job dot. Nothing found missing.

## Code
- `ui/Disclosure` added with a gallery entry, primitive tests and design-language doc; `Skeleton` gets `rows`; additive.
- No `any`, no `@ts-` suppressions added. `phase.test.ts` covers the phase machine; `smoothness.spec.ts`, `clutter.spec.ts` cover motion and budget.
- Page-local re-implementations: none found beyond the dead `RunBar`.
