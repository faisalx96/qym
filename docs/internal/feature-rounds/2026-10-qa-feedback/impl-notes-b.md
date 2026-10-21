# QA-B (experiments): implementation notes

Branch `feat/qa-experiments` (design commit `cfa83880`). Spec `spec-b.md` (75 criteria, decisions D-QB1..11, amendments in its section 8b). Owner decisions E1-E4 and D1-D7 unchanged.
Machine: shared; platform 8984, Vite 5984, fake Evaluation Services 9084/9085, stub LLM 9984, `QYM_E2E_DB=.qym-e2e-qb.db`. Measurements: Playwright Chromium, dark scheme, the app (not the gallery frame),
numbers printed by the specs (`console.log` lines in the gate logs). After-screenshots: `shots/after-qb-{home,versions,runs,list}-{1440,1024,390}.png` (seeded project with a flagged and a plain official run,
one local run, two environments; the home shot has the latency box ticked).

## 1. Commits

| Commit | What |
|---|---|
| `aea5830a` | backend: 422 for `versioning_details`, `experiment.latency_sensitive` on the run origin ref, stale-descriptor requeue, CLI origin suffix, docs |
| `0a6b76b6` | frontend: versioning box removed, `LatencyControl`, home view control, versions block on step 1, Runs page tag |
| next commits | e2e specs, amendments, notes, screenshots, gate fixes (see `git log feat/qa-experiments`) |

## 2. Criterion -> change -> test

| Criteria | Change | Test |
|---|---|---|
| QA2-1 to QA2-3 | `api/experiments.py::_refuse_versioning_details` (before environments are loaded): 422 with the fixed text for every value but `null` / `{}` / absent, on create and dry run | `tests/platform/test_experiment_versioning_details.py` (parametrized: 6 bad values x dry run / real, 0 rows persisted) |
| QA2-4 | `versioning_details=None` stored; `_request_body`, `_preview_body` and `_service_versioning_details` lost the versioning term | same file: no key in the dry-run body, no key in the stored job body, also on an environment whose schema declares it |
| QA2-5 | clone prefill has no `versioning_details` | `test_clone_prefill_has_no_versioning_details` (legacy experiment with stored keys) |
| QA2-6, QA2-20, D-QB11 | no change (history stays): detail / list still answer the stored object, retry resends the stored body | `test_legacy_experiment_stays_readable_and_retry_resends_the_stored_body`; `test_run_versioning_details.py`, `test_run_versioning_filter.py` unchanged and green |
| QA2-7, QA2-8 | no change | `tests/platform/test_run_versioning_details.py`, `tests/sdk/test_versioning_details.py`; `test_evaluator_config_is_validated_per_environment_schema` (platform_owned pointer) |
| QA2-9, QA2-10 | textarea removed from `RunSettings`; card 117.6 / 133 / 227.1 px (821 / 777 / 279 wide), children = name row + `launch-latency` | `e2e/experiments/launch/qa-b-home.spec.ts` ("no Versioning details box ...", 3 widths) |
| QA2-11 | `VersionsBlock` loses `onCustomize` and the button; new help text | `VersionsBlock.test.tsx`, `qa-b-versions.spec.ts` (buttons == `['Refresh']`) |
| QA2-12, QA2-13, QA2-17 | `PSEUDO.versioning`, `parseVersioning`, `versioningText`, `VERSIONING_*`, the validation rule, the editor skip entry, the two "changed" tallies, `LaunchRequest.versioning_details` and the clone response field deleted | `spec.test.ts` (no key in request or `dryRunKey`), `layering.test.ts`, `validation.test.ts`; `qa-b-versions.spec.ts` (network: no key in dry runs) |
| QA2-14 | follows from QA2-5 + QA2-12 | `qa-b-versions.spec.ts` "Rerun opens a form with no versioning input" |
| QA2-15, QA2-18, QA2-19 | unchanged (review `Versions` row, detail page, preset editor) | existing `versions.spec.ts` ("the review recaps them"), `detail.spec.ts`, `preset-editor.spec.ts` |
| QA2-16 | server text rides the existing launch-error path | `qa-b-versions.spec.ts` "a stale client that still sends the field" (route injects the key, the 422 text is shown, the name field is unchanged) |
| QA2-21 | the old textarea also left the previous round's gallery mock (`EvalFlagsMocks.tsx`) | grep: `Versioning details`, `key=value` (outside filters / URL params) and `Stored on the experiment` have 0 matches in `frontend/src` besides tests and the QA-B notes |
| QA3-1, QA3-9 | `services/run_origin.py` selects `EvalExperiment.latency_sensitive` in the same query (0 extra queries) and `_ref` builds `{id, name, job_id, latency_sensitive}` | `test_run_origin_filter.py` (`latency_sensitive` true / false, published and unpublished, local `null`; the one-join test still says 1 statement); e2e API test in `qa-b-runs-tag.spec.ts` |
| QA3-2 | `qym run list` origin cell gets ` · latency-sensitive`; JSON passes through | `tests/sdk/test_cli_run_list_origin.py` (2 tests) |
| QA3-3 | `_descriptor_origin_stale` and the `reconcile_summary_shapes` clause: a descriptor with an experiment ref but no `latency_sensitive` is requeued (SQLite / Postgres JSON path); a descriptor with no experiment ref is not (no endless requeue) | `test_descriptor_without_latency_sensitive_is_requeued_and_republished` (requeued once, republished `true`, second pass 0) |
| QA3-4 to QA3-7 | no change (list filter, gate text, immutability, clone) | existing `test_experiment_latency_sensitive.py` (all green) |
| QA3-8 | no new route or query | `qa-b-runs-tag.spec.ts` (page uses the existing rows) |
| QA3-10 to QA3-14, QA3-16, QA3-20 | `LatencyControl` extracted from `RunSettings`; `LaunchHome` renders it in the Environments card (`.latencyBlock`, 1 px rule, 14 px) | `LatencyControl.test.tsx` (5 states); `qa-b-home.spec.ts` (placement, rule, helper 11 px / 24 px indent, line counts 2 / 3 / 4, callout 34.8 px, +38.8 px card, bar 56 px with no tag, archived project) |
| QA3-15, QA3-24 | box clearing effect and `registerField` moved into `LatencyControl` | `LatencyControl.test.tsx` (disabled clears, partial names `production`); gate states for a non-manager are unit-only (the dev platform runs as a manager) |
| QA3-17, QA3-18 | one `doc.latencySensitive`; `heldOnHome` accepts `#latency` | `qa-b-home.spec.ts` round trip + `Launch as is` body; `wizardLogic.test.ts` |
| QA3-19, QA3-21 | ids unique (one control mounted), `aria-describedby` lists reason only when shown | `qa-b-home.spec.ts` axe 1440 / 390 off and on; dry run key unchanged |
| QA3-22, QA3-23 | `RunSettings` renders `LatencyControl` | `qa-b-home.spec.ts` ("same control as on the home view": identical outerHTML); `LatencyControl.test.tsx` |
| QA3-25 to QA3-27, QA3-29 | `RunLatencyTag` (`Tag tone="info"`, 12 px clock, `role="img"`, `aria-label` / `title`), in `.leadSlot` (the chevron spacer's own box) for a run without passes, after `Official` for a repeat run; `.runName > span { flex: none }` | `cells.test.tsx` (5 tests); `qa-b-runs-tag.spec.ts` at 1440 / 1024: 20 x 20, name x 243 / width 154.8 equal to the untagged name, Run column 260, row 32, scroll 2634, page overflow 0, axe |
| QA3-28 | repeat run: chevron keeps its slot, the tag follows `Official` | `cells.test.tsx` ("a repeat run keeps its chevron"); no e2e (needs a multi-pass seed): documented gap |
| QA3-30 | card layout: same cell | `qa-b-runs-tag.spec.ts` card test: tag 20 x 20 left of the name, card 162.8 px with and without the tag (amended, spec 8b) |
| QA3-31, QA3-33 | absent field reads as false; the field is part of the row payload | `cells.test.tsx`, `qa-b-runs-tag.spec.ts` (route strips the field: 0 tags, 0 console errors) |
| QA3-32 | nothing added to the Dashboard or the filters | `qa-b-runs-tag.spec.ts` (no filter / column) |
| QA3-34 to QA3-38 | kept; `data-testid="filter-latency"` added | `lists-latency.spec.ts` new test (tag 98.4 x 20, 10 px / 650, rows 40 / 40, filter 141.9 x 16.8, 3 widths) |
| QA4-1 to QA4-5 | `EntryBlock` renders `<VersionsBlock />` as its last child | `qa-b-versions.spec.ts` (placement, 131 / 131 / 316.9 px, rows 20 / 20 / 84.8 px, copy, one button, no input, home DOM equals step 1 DOM) |
| QA4-6, QA4-11 | one react-query entry (`launchKeys.versioning`, `staleTime: Infinity`); `refetch({ cancelRefetch: false })` | `qa-b-versions.spec.ts` request counts (0 on Customize, 1 for a new environment, 0 on untick, 1 per row on Refresh, 1 per row on reload, double press <= 2); `VersionsBlock.test.tsx` |
| QA4-7 | loading row = loaded DOM + `.skelValue` placeholders, `aria-busy`, hidden `role="status"` outside the `<dl>` (axe) | `qa-b-versions.spec.ts` (held request: 103 = 103, 224.1 = 224.1 px at 1440 / 1024 / 390); `VersionsBlock.test.tsx` |
| QA4-8, QA4-9 | states unchanged, now per row at the loaded height | `qa-b-versions.spec.ts` (unsupported, error, `not set` via route) |
| QA4-10 | block shown and Refresh enabled when archived | `qa-b-versions.spec.ts` |
| QA4-12, QA4-13 | block on home and step 1 only; tab order | `qa-b-versions.spec.ts` (Models / settings / evaluation steps: 0 blocks; Tab order name, priority, latency, environments, Details, New environment, dataset, Refresh; axe loaded / loading at 1440 / 390) |
| QA4-14 | tokens only (`--badge-height`, `--control-radius`, `--bg-elevated`) | `design-language.test.ts`, `pytest tests/platform/test_design_language.py` |
| QA4-15 | unchanged API | existing environment tests |
| QA4-16 | step 1 layout | page overflow 0 at the three widths (`qa-b-versions.spec.ts`) |

## 3. Measured numbers next to the spec

| Criterion | Spec | App |
|---|---|---|
| QA2-10 Run settings card 1440 / 1024 / 390 | 117.6 / 133 / 227.1 | 117.6 / 133 / 227.1 (widths 821 / 777 / 279) |
| QA4-2 block, 2 loaded environments | 131 / 131 / 316.9 | 131 / 131 / 316.9 |
| QA4-3 rows | 20 / 20 / 84.8 | 20 / 20 / 84.8 |
| QA4-7 loading = loaded (1 env) | delta 0 +- 1 | 103 = 103, 103 = 103, 224.1 = 224.1 |
| QA3-14 callout | 34.8 | 34.8; card on - off = 38.8 (card 275 off with the e2e seed, see amendment) |
| QA3-26 name x / width | 243 / 154.8 | 243 / 154.8 with and without the tag |
| QA3-27 | Run 260, row 32, scroll 2634, overflow 0 | 260, 32, 2634, 0 |
| QA3-30 card height | 162.8 | 162.8 with and without the tag |
