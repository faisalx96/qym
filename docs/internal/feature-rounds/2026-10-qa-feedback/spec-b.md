# QA-B: experiments (versioning read-only, latency flag on more surfaces, service versions on Customize step 1)

Status: design stage. No product component, route or model has been changed. Added: the gallery mock
`frontend/src/features/dev/QaExperimentsMocks.tsx` (+ `.module.css`, wired into `/__ui#qa-experiments` in `UiGalleryPage.tsx`), the measure scripts under
`measure/`, the screenshots under `shots/` and this document. The mocks are the visual contract: where this text and a mock disagree, the number in
this text wins and the mock is a bug. The CSS in `QaExperimentsMocks.module.css` marked "recipe" is what the implementer moves into the components.

Branch `feat/qa-experiments` (from `379e6d5e`). Owner brief: `BRIEF.md` (feedback verbatim, decisions E1-E4, final). Previous round: `../2026-10-dataset-access/spec-b.md`
and `docs/internal/DATASET_ACCESS_AND_EVAL_FLAGS_DESIGN.md` (D1-D7 stay in force). Service contract: `docs/evaluation-service-api-integration-v1.3.md` section 2.2,
section 3.5 (`GET /evals/versioning-details/current`), section 4.2 (`config.versioning_details`).
Measured 2026-10-21 at 1440, 1024 and 390 px (launch column 821 / 777 / 279; home column 1193 / 777 / 279), Playwright Chromium (headless shell), dark scheme,
SQLite, platform on 8982, Vite on 5982, two fake Evaluation Services (`frontend/scripts/fake_eval_service.py --flags`) on 9082 and 9083.

## 0. Reading guide

The owner's points in their words (BRIEF.md section 1):

> 2- in experimentation creation the user shouldn't be able to change versioning details.
> 3- in experimentation creation, the latency sensitive flag should also show in the homepage.
> 4- in experimentation creation, the evaluation service versions should also show in the customization first page below the environment.

Decisions E2 and E3 (final): E2 remove the free-form box, show the service's `agent`, `image`, `kb` read-only, record only what the service reports, Rerun carries
nothing user-typed. E3 the flag shows on three places: the first Customize page, the Runs page, the Experiments list.

| Point | Feature | Surface (file today) | Criteria |
|---|---|---|---|
| 2 | Versioning details not user-editable | API: `api/experiments.py` create, dry run, clone prefill | QA2-1 to QA2-8 |
| 2 | | Launch form: Run settings card (`launch/entry/RunSettings.tsx`), home block button, review, validation | QA2-9 to QA2-17 |
| 2 | | Experiment detail, default preset editor, existing data | QA2-18 to QA2-21 |
| 3 | Latency flag on more surfaces | API: runs list `experiment.latency_sensitive`, CLI, experiments list payload, gate | QA3-1 to QA3-9 |
| 3 | | Launch home view (`launch/home/LaunchHome.tsx`, new `LatencyControl`) | QA3-10 to QA3-21 |
| 3 | | Customize step 1 (`launch/entry/RunSettings.tsx`, kept) | QA3-22 to QA3-24 |
| 3 | | Runs page (`features/runs-list/cells.tsx`) | QA3-25 to QA3-33 |
| 3 | | Experiments list (`features/experiments/list/ExperimentsPage.tsx`, kept) | QA3-34 to QA3-38 |
| 4 | Service versions on Customize step 1 | `launch/entry/EntryBlock.tsx`, `launch/entry/VersionsBlock.tsx` | QA4-1 to QA4-16 |

75 numbered criteria (21 for QA2, 38 for QA3, 16 for QA4). Decisions: section 6. Test plan: 8. Hand-off: 9. Limits: 10.

### What the measurements changed about the brief (read this first)

1. **The first Customize page already has the latency checkbox.** Customize step 1 "Where it runs" renders `RunSettings` (name, priority, Latency-sensitive run). The page
   that lacks it is the **launch home view** ("New experiment": Environments, Dataset, Evaluation Service versions, Start from, name, "Launch as is" / "Customize"). The owner
   wrote "homepage" and "customization first page" in two separate points, and the pair fits the home view exactly: it has the versions block and not the flag, step 1 has
   the flag and not the versions block. E3 is kept as written (step 1 keeps the control, criteria QA3-22 to QA3-24) and the home view gets it too (decision D-QB1, flagged as
   an open question for the owner; it costs one extracted component).
2. **The Experiments list already tags latency-sensitive experiments** (previous round, B5-59 on): 98.4 x 20 px `Latency-sensitive` tag in the Name cell, plus the
   "Latency-sensitive only" filter. QA3-34 to QA3-38 pin it with numbers; no change is specified.
3. **The Models step does not show the versions block.** Measured: 0 `Current versions` sections on `?step=models` at all three widths. The block exists on the home view only
   (with an "Add versioning details" button that jumps to the textarea) and, as a summary row, in the review pane. Point 4 therefore adds it to step 1.
4. The detail page, the preset editor and the environment page show no versioning-details field today (0 matches in `features/experiments/detail` and
   `features/environments`); their criteria say "stays so".

### Screenshots (`docs/internal/feature-rounds/2026-10-qa-feedback/shots/`, dark, each under 300 KB)

| File | What |
|---|---|
| `current-launch-home-{1440,1024,390}.png` | launch home view with both environments ticked (versions block, no latency control) |
| `current-launch-step1-{1440,1024,390}.png` | Customize step 1 with the Versioning details box, review pane |
| `current-runs-{1440,1024,390}.png`, `current-dashboard-*`, `current-experiments-*` | Runs page (table, card layout), Dashboard run lists, Experiments list |
| `mock-qb-home-*`, `mock-qb-versions-*`, `mock-qb-step1-*`, `mock-qb-runs-*`, `mock-qb-list-*` (each at 1440, 1024, 390) | the specified design, every state, in the real column widths |

### How it was measured (`measure/`, Node 24, Playwright from `frontend/node_modules`)

```
cd <worktree>; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; source <main checkout>/.venv/bin/activate
export PYTHONPATH=packages/sdk:packages/platform QYM_PYTHON=<main checkout>/.venv/bin/python
python frontend/scripts/dev_db.py sqlite:///$PWD/.qym-design-b.db
python frontend/scripts/fake_eval_service.py 9082 --flags &     python frontend/scripts/fake_eval_service.py 9083 --flags &
QYM_AUTH_MODE=none QYM_DATABASE_URL=sqlite:///$PWD/.qym-design-b.db QYM_ENVIRONMENT=test QYM_ALLOW_PRIVATE_LLM_BASE_URLS=true \
  QYM_LLM_CONFIG_ENCRYPTION_KEY=<fernet key> QYM_BASE_URL=http://127.0.0.1:5982 QYM_EVAL_EXPERIMENT_CREATE_RATE_LIMIT=0 QYM_ROLE=all \
  python -m uvicorn qym_platform.main:app --port 8982 &
(cd frontend && QYM_PLATFORM_PORT=8982 QYM_VITE_PORT=5982 npm run dev -- --port 5982 --strictPort --host 127.0.0.1) &
node measure/seed-qab.mts          # project design-qab -> seed-qab.json (not committed)
node measure/current-launch.mts    # home, step 1, models step, review -> baseline/current-launch-<w>.json + current-* shots
node measure/current-lists.mts     # Runs page, Dashboard, Experiments list -> baseline/current-lists-<w>.json + shots
node measure/mock-measure.mts      # gallery mocks -> baseline/mock-<w>.json
node measure/mock-shots.mts        # mock-* shots;  python3 measure/shrink-shots.py keeps each PNG under 300 KB
```

Seed (public API only): project `design-qab`, dataset `golden`, environments `staging` (open) and `production` (`latency_sensitive_min_role: manager`), experiments
`nightly baseline` (created with old-style `versioning_details {agent_version: manual-1.0, owner: qa}`), `latency check` (flag), `prompt sweep` (2 combinations),
`staging vs prod` (flag, 2 environments); every job has a linked official run; two local runs. Gallery frames sit in a case with 15 px side padding: a 1193 px app
column is 1163 px in the gallery; the numbers below quote the app width where the app was measured and say "gallery frame" where only the mock was. Heights that
depend on a text wrap are quoted for the gallery frame and the reviewer measures them in the app within 2 px.

## 1. Summary

| Point | Today | Design |
|---|---|---|
| 2 | A "Versioning details" textarea (one `key=value` per line, 72 px, 236.4 px card) on step 1; stored on the experiment, copied into its runs, kept by Rerun. | Gone. The API refuses a non-empty `versioning_details` (422), new experiments store none and send none; the service fills the runs' versions itself. Existing experiments and runs keep what they have. |
| 3 | Flag on step 1 (checkbox), Experiments list (tag), detail header, queue. Not on the home view, not on the Runs page. | Same control on the home view (one `doc.latencySensitive`), a 20 x 20 info tag in the leading slot of the Run cell of runs from flagged experiments, `experiment.latency_sensitive` on the runs payload and in `qym run list --json`. |
| 4 | Versions block on the home view only. | The same block (same component, same query cache) under the environment and dataset cards of step 1. |

## 2. Backend contract (curl and sqlite3 on a platform with `QYM_ROLE=all`, fake service on 9082)

| ID | Criterion (endpoint, field, number or exact text) |
|---|---|
| QA2-1 | `POST /v1/projects/{pid}/experiments` with `"versioning_details": {"agent_version": "x"}` (any non-empty object) answers `422` and `detail` equal to `Versioning details are set by the Evaluation Service and cannot be sent with an experiment.` Nothing is persisted (0 new `eval_experiments` rows, 0 audit rows). |
| QA2-2 | The same request with `dry_run: true` answers the same `422` and text (the check runs before environments are loaded, as `normalize_versioning_details` does today). |
| QA2-3 | A value that is not an object (`"x"`, `["a"]`, `3`, `true`) answers the same `422` and text. `null`, `{}` and an absent field are accepted exactly as today (`201` / dry run `200`). |
| QA2-4 | An accepted launch stores `eval_experiments.versioning_details = NULL` and `GET .../experiments/{id}` answers `versioning_details: {}`. The job request the fake service receives (`GET :9082/__control/jobs`, `eval_input.config`) has no `versioning_details` key; the dry-run `request_body` has none either. The service fills `agent_version` / `image_version` / `kb_version` itself (guide section 4.2), and `run.versioning` / `job.remote_versioning` carry what it reports. |
| QA2-5 | `POST .../experiments/{id}/clone` (with and without `job_id`) answers a prefill with no `versioning_details` key, also for an experiment whose stored `versioning_details` is not empty. Rerun therefore carries nothing user-typed. |
| QA2-6 | Existing data stays readable: for an experiment created before this change with `versioning_details {agent_version: manual-1.0, owner: qa}`, `GET .../experiments/{id}` and the list item still answer that object; its linked run still answers `versioning_details` with the merged keys (`eval_run_linking.py` unchanged); `GET /api/runs?...&versioning=agent_version=manual-1.0` still filters; `qym run get <id> --json` shows `run.versioning_details` and `qym run list --versioning agent_version=manual-1.0 --json` still lists it. Retrying one of its jobs resends the job's stored body (no new versioning key). Migration: none. |
| QA2-7 | Local runs are untouched: `POST /v1/runs` with `versioning_details {"owner": "qa"}` still answers `201` and stores it; `qym run create ... --versioning-detail owner=qa` and `EvaluatorConfig.versioning_details` still work (they describe the user's own run, not an Evaluation Service launch). |
| QA2-8 | A document that contains `evaluator.config.versioning_details` (raw JSON) is still refused as platform-owned (unchanged error `{"code": "platform_owned", "pointer": "/evaluator/config/versioning_details"}`); the field stays in `PLATFORM_OWNED_CONFIG_FIELDS`. |
| QA3-1 | `GET /api/runs?project_id=...` (every row under `tasks.<task>.<model>.<dataset>[]`), the single run `experiment` panel (`GET /api/runs/{id}` family built by `run_experiment_panel`) and every other payload that carries `run_origin_fields` answer `experiment: {"id", "name", "job_id", "latency_sensitive"}` with `latency_sensitive` a JSON boolean (`true` for runs of a flagged experiment, `false` otherwise) for each official run; `experiment: null` for local runs. Source: `services/run_origin.py` (`experiment_refs_for_jobs`, `experiment_refs_and_versioning` select `EvalExperiment.latency_sensitive` in the same query: 0 extra queries). |
| QA3-2 | `qym run list --json` passes the row through, so `runs[].experiment.latency_sensitive` is present with the same values (no CLI code is needed for the JSON). The human table writes the origin cell as `Official run · <experiment name> · latency-sensitive` for a flagged experiment and unchanged otherwise. `qym run get <id> --json` has `run.experiment.latency_sensitive`. |
| QA3-3 | Runs published before this change have no `latency_sensitive` in their stored descriptor. `_descriptor_origin_stale` and the `stale_origin` clause of `reconcile_summary_shapes` also report a run with `experiment_job_id` whose `descriptor.experiment.latency_sensitive` is missing; one reconcile pass (limit 100) republishes them. Until then the field is absent and the UI treats absent as `false` (no tag, no error). Test: a run with the field removed from its descriptor is requeued and answers `true` afterwards. |
| QA3-4 | `GET /v1/projects/{pid}/experiments` items and `GET .../experiments/{id}` already answer `latency_sensitive` (bool); `?latency_sensitive=true` returns only flagged experiments, `false` only the others. Confirmed, unchanged. |
| QA3-5 | The gate is the launch gate, whichever page sent the request: a member who sends `latency_sensitive: true` for a managers-only environment (home "Launch as is" or step 6) gets `403` and `detail` equal to `Latency-sensitive runs on production need a project manager` (several names joined by `, `). The dry run answers `200` with the error item `{"section": "document", "pointer": "/latency_sensitive", "rule": "latency_sensitive_role"}` and the same message. Unchanged text (`latencyGateMessage`). |
| QA3-6 | Without the flag the same member launches on the same environment without a gate message (`201`). A project manager launches with the flag (`201`, `latency_sensitive: true` on the detail). |
| QA3-7 | The flag stays immutable after launch: there is no route that changes `eval_experiments.latency_sensitive`; the clone prefill answers `latency_sensitive` for the form (unchanged). |
| QA3-8 | The Runs page needs no new route and no new query parameter: the field rides on the rows `GET /api/runs` already returns; request count of the page load is unchanged. |
| QA3-9 | The payload of a run of an unflagged experiment is byte-identical to today's except for `experiment.latency_sensitive: false`. |

## 3. Point 2: versioning details are not user-editable

Surfaces: `launch/entry/RunSettings.tsx`, `launch/model` (`PSEUDO.versioning`, `versioningText`, `parseVersioning`, `localErrors`, `dryRunKey`, `buildSpec`),
`launch/LaunchProvider.tsx` (the "changed" tally), `launch/wizard/LaunchWizard.tsx` (same tally), `launch/entry/VersionsBlock.tsx` (the "Add versioning details" button),
`api/experiments.ts` (`ExperimentCreateRequest.versioning_details`).

Current state (`current-launch-step1-*.png`, `baseline/current-launch-*.json`): the Run settings card on step 1 is 821 x 236.4 px at 1440, 777 x 251.8 at 1024, 279 x 376.7 at 390.
It holds name (24 px field), priority, the latency block (checkbox 16.8 px, helper 15.4 / 30.8 / 61.6 px) and, below them, the Versioning details field: label,
72 px mono textarea (`rows=2`, 779 / 735 / 237 px wide) and a 15.4 px helper `One key=value per line (for example agent_version=1.4). Stored on the experiment and its runs.`
The home block has two header buttons, `Add versioning details` (147 x 24 at 1440) and `Refresh` (70 x 24).

Design: the box is deleted, nothing replaces it inside the card (the read-only versions live under the environments, section 5, which is where the owner asked
for them; one block per page, never two). The card ends after the latency block (gallery frame, latency off): **117.6 px at 1440, 133 px at 1024, 227.1 px at 390**
(gain 118.8 / 118.8 / 149.6 px). The home block loses `Add versioning details`; its help line reads (verbatim, sentence, no exclamation mark):
`Read from each environment. Runs record what its Evaluation Service reports.`

| ID | Criterion |
|---|---|
| QA2-9 | At 1440, 1024 and 390, `/projects/{slug}/experiments/new?step=where` contains 0 `textarea` elements in `[data-testid="launch-entry"]` and the text `Versioning details` appears 0 times anywhere in the launch page (home view, steps 1 to 6, review pane, problem list). `getByLabel('Versioning details')` resolves to 0 elements. |
| QA2-10 | The Run settings card (`section[aria-label="Name and priority"]`) is 117.6 / 133 / 227.1 px high with the latency box off and no callout (tolerance 2 px), widths 821 / 777 / 279. Its children are the name and priority row and the `launch-latency` block only. |
| QA2-11 | The home block (`section[aria-label="Current versions"]` on `/experiments/new`) has exactly one header button, named `Refresh`; `Add versioning details` appears 0 times. Help text, verbatim: `Read from each environment. Runs record what its Evaluation Service reports.` (replaces `What a run started now records as its versioning details.`). Title unchanged: `Evaluation Service versions`. |
| QA2-12 | `PSEUDO.versioning`, the `#versioning-details` locate rule, `versioningText` in the document and `parseVersioning` are removed; the validation can no longer produce an item whose pointer is `#versioning-details`; `VERSIONING_MAX_KEYS` and `VERSIONING_KEY_MAX` have 0 references in `launch/`. `dryRunKey` and `buildSpec` no longer contain a versioning term, so a dry run request body has no `versioning_details` key (network assertion at 1440). |
| QA2-13 | The "changed" tally in `LaunchProvider.tsx` and `LaunchWizard.tsx` (the lines that add `doc.versioningText.trim() ? 1 : 0`) no longer count versioning; a form with only a name typed counts the same as before. |
| QA2-14 | Rerun and Clone in the SPA (`POST .../clone` prefill, section QA2-5) open a form with no versioning input; submitting it sends a body whose keys do not include `versioning_details` (network assertion). |
| QA2-15 | The review pane keeps the `Versions` row (`KeyValueGrid` row `versions`, `VersionsSummary`): unchanged from today (measured with 2 environments: 71.8 px at 1440, 55 px at 1024, 88.6 px at 390), text `staging: agent-1.4.2 · img-20261001 · kb-77`. It reads the service value and offers no input. There is no `Versioning details` row. |
| QA2-16 | A client that still sends the field (a tab opened before the deploy) sees the launch error `Versioning details are set by the Evaluation Service and cannot be sent with an experiment.` in the launch error region (the existing server-error path of `useLaunch`), `role="alert"`, 0 other changes to the form; reloading the page removes the cause. |
| QA2-17 | `ExperimentCreateRequest` (TS) has no `versioning_details` property; `Experiment.versioning_details` (read side) stays typed `Record<string, unknown>`. |
| QA2-18 | Experiment detail (`/experiments/{id}`) at 1440, 1024, 390 has 0 inputs or textareas for versioning and 0 occurrences of `Versioning details`; unchanged from today. Versions of a finished experiment are read from its runs (run page, runs list `Version` column), not from the experiment. |
| QA2-19 | The default preset editor (environment page, presets, `SettingsForm`) has 0 fields named versioning; a preset's `config` never contains `evaluator.config.versioning_details` (platform-owned, QA2-8). Unchanged from today; the reviewer checks 0 matches. |
| QA2-20 | Existing experiments and runs: QA2-6 holds in the UI too: the runs list `Version` filter and the run page `versioning_details` chips show `manual-1.0` for the seeded legacy run. |
| QA2-21 | Copy audit: the strings `Versioning details`, `key=value` and `Stored on the experiment and its runs` are absent from `frontend/src` except in run pages, filters and tests that describe existing runs. |

## 4. Point 3: the latency-sensitive flag

One source of truth: `doc.latencySensitive` in the launch provider (today set by the Run settings checkbox). Every surface below reads or sets that one value; there is no second
store, no new request field, no new API.

### 4.1 Launch home view (`launch/home/LaunchHome.tsx`)

Current (`current-launch-home-*.png`): the Environments card is 1193 x 224.4 px at 1440 (777 x 239.8 at 1024, 279 x 402.5 at 390 with the Dataset card stacked), content 547.5 / 339.5 / 237 px wide.
It has no latency control. The versions card below is 131 px high (2 environments) at 1440 and 1024, 316.9 px at 390.

Design (`mock-qb-home-*`): extract `LatencyControl` (checkbox, helper, gate reason, warning callout; the markup of `RunSettings` lines 66 to 91 and the box-clearing effect) and render it
in `LaunchHome` inside the Environments card, after the "New environment" button, separated by a 1 px `--border-subtle` rule with `--space-md` (14 px) padding above. `RunSettings` renders the same
component. Same copy as today:

- label `Latency-sensitive run`
- helper `Starts only when the gateway is quiet, makes other jobs wait while it runs, and is discarded and re-queued if foreign traffic overlaps. Expect a later start.`
- reason (disabled) `Only project managers can launch latency-sensitive runs on production.`
- callout title `Other jobs wait while this run executes`; partial body `Only a project manager can launch it on production. Clear the box or ask a project manager.`

Gallery frame numbers (home column 1163 px at 1440; the app's is 1193 px and does not change the line counts):

| State | `[data-testid="home-latency"]` block 1440 / 1024 / 390 | Environments card 1440 / 1024 / 390 |
|---|---|---|
| off | 66.6 / 82 / 97.4 | 304.2 / 334.9 / 374.3 |
| on | 105.4 / 120.8 / 153 | 343 / 373.7 / 429.9 |
| on, partial gate | 143 / 158.4 / 207.3 | 380.5 / 411.3 / 484.3 |
| disabled (every environment managers-only) | 86 / 116.8 / 132.1 | 323.5 / 369.7 / 409.1 |
| read only | 66.6 / 82 / 97.4 | 304.2 / 334.9 / 374.3 |

| ID | Criterion |
|---|---|
| QA3-10 | On `/experiments/new` at 1440, 1024 and 390, `[data-testid="launch-latency"]` exists once inside the Environments card (`fieldset`'s card), after the `New environment` button (its top is at least 14 px below the button's bottom), and is absent when there is no environment (0 environments in the project) and in the other cards. When no environment is selected the control is still shown (the flag does not depend on a selection) and enabled. |
| QA3-11 | The rule above the block is 1 px, `--border-subtle`, 14 px padding between rule and checkbox (`.latencyBlock` in the mock). Block widths 532.5 / 339.5 / 237 px in the gallery frame; `scrollWidth <= clientWidth` for the block, helper, reason and callout (0 px overflow). |
| QA3-12 | Checkbox row 16.8 px high; helper 11 px / 400, `--text-muted`, 30.8 / 46.2 / 61.6 px high (2, 3, 4 lines); indent `calc(--space-lg + --space-xs)` = 24 px for helper, reason and callout (as step 1). |
| QA3-13 | Off: block 66.6 / 82 / 97.4 px; Environments card 304.2 / 334.9 / 374.3 px (gain over today: 79.8 / 95.1 / 140.5 px). The Dataset card keeps stretching to the same height (`align-items: stretch`: heights equal at 1440 and 1024; at 390 the cards are stacked and the Dataset card keeps 130.8 px). |
| QA3-14 | On: callout `role="note"`, 34.8 / 34.8 / 51.6 px high, tone warning, title `Other jobs wait while this run executes`; partial gate adds the body text: callout 72.4 / 72.4 / 106 px. Environments card 343 / 373.7 / 429.9 px (on) and 380.5 / 411.3 / 484.3 px (partial). |
| QA3-15 | Disabled (a member, every selected environment has `latencyMinRole: manager`): the checkbox is disabled (`aria-disabled`), the reason is shown (15.4 px high at 1440, 30.8 at 1024 and 390), no callout, and if it was checked it is cleared at that moment (B5-28; the effect moves out of `RunSettings` into `LatencyControl` or the provider, because `RunSettings` is not mounted on the home view). |
| QA3-16 | Read only (archived project): the checkbox is disabled, no reason, no callout; helper stays. |
| QA3-17 | One value: ticking the box on the home view and pressing `Customize →` shows the box ticked on step 1; unticking it on step 1 and pressing `← Start` shows it unticked; `Launch as is` sends `latency_sensitive: true` exactly when the box is ticked (network assertion on `POST .../experiments`). The review pane row `Latency-sensitive: yes` appears while it is ticked. |
| QA3-18 | Gate problems are held on the home view: `heldOnHome` returns true for the pointer `#latency`; with a blocking gate item the home bar's `Show` focuses the checkbox on the home view and does not navigate. `registerField(pointerToFieldName(PSEUDO.latency), ...)` is called by the mounted control (home or step 1, never both). |
| QA3-19 | Accessibility: the checkbox's accessible name is `Latency-sensitive run`; `aria-describedby` lists the helper id and, when shown, the reason id; ids are unique on the page (only one of home and step 1 is mounted); axe reports 0 serious or critical violations at 1440 and 390 in the off, on and disabled states. |
| QA3-20 | The home bar (`region[aria-label="Launch"]`) is unchanged: height 56 px at 1440, no latency tag in it (decision D-QB10). |
| QA3-21 | Request load: the home view issues 0 additional requests because of the control (the dry run already includes `latency_sensitive`, `dryRunKey` has it). |

### 4.2 Customize step 1 (`launch/entry/RunSettings.tsx`, kept)

| ID | Criterion |
|---|---|
| QA3-22 | Step 1 keeps the latency control directly under the name and priority row, same copy and states as QA3-12 to QA3-16 (card 117.6 px off, 156.4 on, 137 disabled with reason, at 1440; 133 / 171.8 / 152.4 at 1024; 227.1 / 282.7 / 261.9 at 390; gallery frame = app column 821 / 777 / 279). |
| QA3-23 | The control on step 1 and on the home view is the same component (`LatencyControl`): the same `data-testid="launch-latency"`, the same DOM, 0 differences in the text of the five states. |
| QA3-24 | Multiple environments: with `production` (managers-only) and `staging` (open) selected, a member gets the partial state (box enabled, callout body with `production`); selecting `production` alone gives the disabled state; a manager never sees a reason. Same rule as the dry-run gate (QA3-5). |

### 4.3 Runs page (`features/runs-list`)

Current (`current-runs-*.png`, `baseline/current-lists-*.json`): the Runs table at 1440 is 1205 px wide (scroll width 2634), rows 32 px, Run column 260 px (cell content 244 px) frozen,
Status 144 px frozen at 1440 and above, Signals 77, Task 90, Model 132, Dataset 110, Date 120, Analysis 100, Experiment 110 (beyond the first screen). The Run cell is
`[chevron spacer 24 px] [name] [x N tag] [Official tag 49.7 x 20]`; the name of `prompt sweep · timeout=10` is 154.8 px wide and the free space after it is 7.5 px, so any
text tag (the list's is 98.4 px) would force an ellipsis on names that fit today (measured in the first mock: 136.3 px of 154.8, 3 to 4 characters cut). At 390 the
card layout's head is 273 px wide (name 154.8 + Official 49.7 + spacer 24 leave 36 px).

Design (`mock-qb-runs-*`): a **20 x 20 px info-tone tag with the clock glyph (12 px)** takes the 24 px leading slot that a run without passes leaves empty (where the chevron button
sits for a repeat run). It adds 0 px to the name's width. A repeat run (`samples > 1`) keeps its chevron and gets the tag after `Official`.
Recipe: `.runLatencyTag { flex: none; inline-size: var(--badge-height); padding: 0; justify-content: center }`, slot `.leadSlot { inline-size: var(--control-height) }`, every
non-name child of `.runName` `flex: none`. The tag is `<Tag tone="info" role="img" aria-label="Latency-sensitive experiment" title="Latency-sensitive experiment" data-testid="run-latency-tag">`
(the same pattern as the `Official` tag's `title`). Shown when `row.experiment?.latency_sensitive === true`.

| ID | Criterion |
|---|---|
| QA3-25 | At 1440 and 1024, in `[data-testid="runs-table"]`, the row of a run of a flagged experiment (seed: `latency check`, `staging vs prod · production`, `staging vs prod · staging`) has exactly one `[data-testid="run-latency-tag"]` in its Run cell; rows of unflagged official runs (`prompt sweep · …`, `nightly baseline`) and local runs have 0. Count in the seeded project: 3 of 8 rows. |
| QA3-26 | The tag is 20 x 20 px, 12 px glyph, tone info (`data-tone="info"`), starts at the cell's left padding + 2 px (the 24 px slot, centred) and ends before the name; it does not move the name: the name's x is the same as in the same run without the tag (243 px for the first column at 1440, the spacer's 24 px + 4 px gap) and its width is the same 154.8 px for `prompt sweep · timeout=10` (delta 0, `scrollWidth <= clientWidth`, no ellipsis). |
| QA3-27 | Geometry that must not move (measured today, tolerance 0): Run column 260 px, Status 144 px, Signals 77 px, row height 32 px, table scroll width 2634 px at 1440, page overflow 0 px at 1440, 1024 and 390. Header `Overview` band 404 px at 1440. |
| QA3-28 | A repeat run of a flagged experiment (`samples > 1`): the chevron button keeps the slot (24 px); the tag follows `×N` and `Official` (gallery frame: cell 214.1 px, name 76.5 px for `latency check`, tag 20 x 20); the name is not truncated for names of up to 24 characters at 1440. |
| QA3-29 | Accessible: the tag has `role="img"`, accessible name `Latency-sensitive experiment`, `title` of the same text; it is not focusable (passive, no hover state); axe 0 serious violations; the row's accessible text gains only that name. |
| QA3-30 | Card layout (390, under 640 px): the tag sits in the card head's leading slot, head height unchanged (23 px), name 154.8 px and `Official` 49.7 px, no wrap (gallery frame 273 px: cell 236.4 px). Card heights are unchanged (161.2 / 162.8 px measured today). |
| QA3-31 | A run whose stored descriptor has no `experiment.latency_sensitive` (not republished yet, QA3-3) shows no tag and no error, and the console has 0 errors. |
| QA3-32 | The Dashboard (Overview) run lists keep today's markup (Official tag only): decision D-QB9. The Runs page has no new filter, column or sort (decision D-QB9); the existing `Experiment` column (110 px) is unchanged. |
| QA3-33 | Live update: when a flagged experiment's run appears through the list's polling, the tag renders on the first paint of the row (it is part of the row payload), 0 layout shift of other rows (row height 32 px). |

### 4.4 Experiments list (`features/experiments/list/ExperimentsPage.tsx`, kept)

Measured today (`current-experiments-*.png`): Name column 220 px (flex, min 220), rows 40 px at 1440 and 1024, header 34 px; the tag is 98.4 x 20 px, `--font-xs` 10 px / 650, sans, info tone, placed after the name with 8 px gap
(`.nameLine`, `flex-wrap`); the filter `Latency-sensitive only` checkbox is 141.9 x 16.8 px at x 499 (1440), after `Created by me` (100.1 px). At 390 the list is a card layout: tag after the name, same 98.4 x 20.

| ID | Criterion |
|---|---|
| QA3-34 | At 1440, 1024 and 390 the list shows exactly one `[data-testid="latency-tag"]` per flagged experiment (seed: 2 of 4: `staging vs prod`, `latency check`) with text `Latency-sensitive`, 98.4 x 20 px, 10 px / 650, sans, `data-tone="info"`. |
| QA3-35 | The tag sits in the Name cell after the name (x gap 8 px), and wraps under a long name instead of being clipped: gallery frame cell 220 px with `nightly regression of the support agent on staging`: cell 73.9 px high, name block 265.3 px of content wrapping to 2 lines, tag 98.4 px, `scrollWidth <= clientWidth` for the cell; with a short name the cell is 54.3 px (same cell without tag: 49.9 px). |
| QA3-36 | Table rows are 40 px at 1440 and 1024 with and without the tag (optional content never changes geometry: delta 0). |
| QA3-37 | The filter `Latency-sensitive only` (`data-testid="filter-latency"`, URL `?latency=1`) keeps 141.9 x 16.8 px, returns only flagged experiments (the API filter, QA3-4) and persists across reload. |
| QA3-38 | The detail header tag and the queue tag are unchanged (previous round B5-49 to B5-70); nothing else in this list is touched by QA-B. |

## 5. Point 4: service versions on Customize step 1

Surface: `launch/entry/EntryBlock.tsx` (renders `<VersionsBlock />` after the `.where` row), `launch/entry/VersionsBlock.tsx` (`VersionsBlock` and its `VersionRow`, unchanged
structure), `entry.module.css`. Current: step 1 has no versions (measured 0). The home view shows the block at 1193 / 777 / 279 px.

Design (`mock-qb-versions-*`, `mock-qb-step1-*`): `EntryBlock` renders `VersionsBlock` as the last child of `.entry`, directly under the Environments and Dataset cards (the `.where` row), full column
width: **821 / 777 / 279 px** at 1440 / 1024 / 390. Same component as the home view (`LaunchHome` keeps its own instance), so the same DOM and the same query: `useEnvVersioning(projectId, env.id, true)`
(`launchKeys.versioning`, `staleTime: Infinity`) is the one shared fetch; `Refresh` calls `refetch` on every visible row. Home to Customize therefore re-reads nothing.

Numbers (gallery frame = app column for step 1): card 131 px for 2 loaded environments, 103 px for 1, 159 px for 3 mixed states; header 24 px at 1440 and 1024, 80.3 px at 390 (help text and button wrap);
row 20 px at 1440 and 1024; at 390 a loaded row is 84.8 px (name, then agent, image, kb wrapping onto 3 lines), an unsupported or error row 61.6 px. Value tags are mono 10 px / 650, 20 px high
(`agent-1.4.2` 82 px, `img-20261001` 88 px, `kb-77` 46 px). Whole step 1 (gallery frame, 1440): 338.5 px with no environment (no block), 522.3 px with 2 environments loaded and the box on, 483.5 px loading, 530.9 px mixed with latency disabled.

Copy (verbatim): title `Evaluation Service versions`; help `Read from each environment. Runs record what its Evaluation Service reports.`; button `Refresh`; loading (screen reader, visually hidden, `role="status"`) `Reading…`;
unsupported `Not supported by this environment (its Evaluation Service is older than v1.2).`; error `Couldn’t read: <reason>` with `<reason>` the service's text or `unknown error`; an unset key `not set`; labels `agent`, `image`, `kb` (extra keys the service reports follow, sorted).

Loading follows rule 7 ("a loading frame is the loaded layout"): the loading row renders the loaded DOM with a 64 x 20 px placeholder per value (`.skelValue`), so 2 loading rows are 131 px (1440, 1024) and 316.9 px (390), equal to loaded; today's `Reading…` text row is 3 px shorter than the loaded row at 1440 (it is also an amendment of the home block: the same component).

| ID | Criterion |
|---|---|
| QA4-1 | At 1440, 1024 and 390, `/experiments/new?step=where` with at least one environment selected contains exactly one `section[aria-label="Current versions"]` (`role="group"`), a direct child of `[data-testid="launch-entry"]` after the `.where` row; with 0 environments selected it contains 0. |
| QA4-2 | Widths 821 / 777 / 279 px (the step column). Heights: 131 px (2 loaded) / 103 px (1) / 159 px (3 mixed) at 1440 and 1024; 316.9 / 224.1 / 363.3 px at 390. Header 24 px at 1440 and 1024, 80.3 px at 390; header gap to the first row equals the home view's (rule below the header, `Card` header recipe). |
| QA4-3 | Rows: 20 px at 1440 and 1024 for loaded, loading, unsupported and error rows; at 390 loaded 84.8 px, loading 84.8 px, unsupported and error 61.6 px. `scrollWidth <= clientWidth` on the block and every row (0 px overflow); value tags and names are never truncated (`text-overflow` not `ellipsis`), they wrap. |
| QA4-4 | Copy: the strings above appear verbatim; the buttons in the block are exactly `Refresh` (1). No `Add versioning details`, no input, no `contenteditable`, 0 form controls except the button. |
| QA4-5 | Same component as the home view: for the same selection the block's text content and DOM structure on step 1 equal the home view's (0 differences). |
| QA4-6 | One fetch: after ticking environments on the home view and waiting for the block, pressing `Customize →` to step 1 issues 0 `GET .../eval-environments/{id}/versioning-details` requests (cache hit); ticking a third environment on step 1 issues exactly 1 (for that environment); unticking issues 0; `Refresh` issues exactly 1 per selected environment; a hard reload issues exactly 1 per selected environment. |
| QA4-7 | Loading: while a request is in flight each row shows the name and three placeholders (loaded DOM), `aria-busy="true"` on the value list, the text `Reading…` is visually hidden with `role="status"`; block height at the loading frame equals the loaded height (delta 0 +- 1 px at 1440, 1024, 390; test: slow the fake with a 1 s delay). |
| QA4-8 | Unsupported (fake service without the endpoint or older than v1.2): the row shows the unsupported copy; error (`503` from the service / `status: "error"`): the error copy in `--error` colour with the service's reason; neither blocks launching. Each row has its own state (mixed state mock). |
| QA4-9 | Unset key (`image: null` from the service): the row shows `image` and `not set` in muted text; no tag. |
| QA4-10 | Archived (read-only) project: the block is shown and `Refresh` works (reading is not a write); nothing else on step 1 changes. |
| QA4-11 | `Refresh` while loading is harmless: pressing it twice issues requests only for rows not already in flight (react-query dedup), the block never shrinks, focus stays on the button. |
| QA4-12 | The Models step (`?step=models`) and steps 3 to 5 contain 0 `Current versions` sections (the block is on the home view and step 1 only); the review pane keeps its `Versions` row (QA2-15). |
| QA4-13 | The block sits below the environments in reading and tab order: tab order on step 1 is name, priority, latency checkbox, environments, `Details`, `New environment` (manager), dataset selects, `Refresh`, then the footer navigation. `Refresh` has the accessible name `Refresh`. Axe 0 serious violations at 1440 and 390 in the loaded, loading and mixed states. |
| QA4-14 | The block's accent rail (`Card tone="meta"`, purple) and the value tags (`Tag kind="version"`, mono) are the existing recipes; 0 new tokens, 0 new colours; `npm run check` design-language test passes. |
| QA4-15 | API behaviour relied on (unchanged, curl): `GET /v1/projects/{pid}/eval-environments/{eid}/versioning-details` answers `200` with `{"environment_id", "status": "ok" \| "unsupported" \| "error", "versioning_details": {...}, "error": null \| string, "fetched_at"}`; for the fake: `agent_version`, `image_version`, `kb_version`. The block labels them `agent`, `image`, `kb` and shows other keys under their own names. |
| QA4-16 | Step 1 page layout: with 2 environments loaded and the box off, the step column is 483.5 px (1440) / 498.9 px (1024) / 947.8 px (390) high in the gallery frame (name card + environments/dataset row + block); the sticky step navigation and the review pane (352 px, right column at 1440) are unchanged, page overflow 0 px at the three widths. |

## 6. Decisions

| Id | Decision | Reason | How to reverse |
|---|---|---|---|
| D-QB1 | The launch home view gets the latency control (new `LatencyControl`, extracted from `RunSettings`), in addition to step 1 which already has it. E3 stays as written. Open question for the owner: "homepage" may also mean the Runs page; both are done. | The measurements show step 1 already has the checkbox and the home view does not; "homepage" in the brief's point 3 and "customization first page" in point 4 are two different pages, and the home/Customize pair is the only one where flag and versions are swapped. Costs one component and 0 requests. | Remove the block from `LaunchHome`; `LatencyControl` stays used by step 1. |
| D-QB2 | A non-empty `versioning_details` (or any non-object value) is refused with `422` and a fixed text; `null`, `{}`, absent are accepted. | E2 says nothing user-typed is kept. Silent ignoring would let a script believe its keys were recorded, and the loss would show up months later in a versioning filter. A visible error costs a one-line client fix and cannot hide data loss. The SPA never sends it (QA2-12). | Return `201` and drop the field, add `warnings: [{code: "versioning_details_ignored"}]`; one branch in `create_experiment`. |
| D-QB3 | One versions block per page. On step 1 it sits under the environments (point 4) and replaces the textarea's job; the Run settings card gets no "Versioning" block of its own. | The brief offered both "in place of the textarea" (point 2) and "below the environment" (point 4); two identical blocks on one step would show the same rows twice and double the height (131 px). | Render `VersionsBlock` inside the Run settings card instead; the component is position-independent. |
| D-QB4 | The Runs page tag is a 20 x 20 icon tag in the leading slot of the Run cell; the text tag appears on the Experiments list, detail and queue where there is room. | The Run column is 260 px with 7.5 px free after a typical name; a 98.4 px text tag would ellipsize names that fit (3 to 4 characters cut in the first mock). The empty 24 px chevron slot costs 0 px. Meaning is carried by `aria-label` and `title`, the same pattern as `Official`. | Widen the default Run column to 360 px (moves every column; changes the frozen width) and use `LatencyTag`; or add the flag to the Experiment column text. |
| D-QB5 | The experiment detail page shows nothing about versioning details. | It never showed them; versions of an experiment are the versions of its runs (run page, `Version` column), and E2 says experiments record only what the service reports. | Add a read-only `Versions` row to the header from the first run's `versioning`. |
| D-QB6 | `latency_sensitive` rides in the `experiment` ref of the run payload (`{id, name, job_id, latency_sensitive}`), stored in the run descriptor; stale descriptors are republished by the reconcile pass. | The flag is immutable after launch (QA3-7), so a stored copy cannot go stale; the ref is built in one place (`services/run_origin.py`) and reaches the list, the run panel and the CLI. | Read the flag with a join at query time and drop it from the descriptor (extra join on every list). |
| D-QB7 | The block's loading state renders the loaded DOM with placeholders (rule 7). | The previous `Reading…` row was 3 px shorter than a loaded row at 1440 and 64 px shorter at 390. | Keep the text row and accept the shift. |
| D-QB8 | Stored `eval_experiments.versioning_details` and the link-time merge (`eval_run_linking.py`) stay for existing experiments; new experiments store `NULL`. No migration, no backfill. | E2 is about the form; the data is history, and runs filters and `qym run get` must keep working (QA2-6). | n/a |
| D-QB9 | No tag on the Dashboard (Overview) run lists, no Runs page filter or column for the flag. | E3 names the Runs page; the Dashboard run lines are 240 px wide with the same constraint, and a filter was not asked for. | Add the tag in `OverviewPage.tsx` `RunLink` (same icon tag, same `title`); add `latency_sensitive` to the runs filter query. |
| D-QB10 | The home bar shows no latency tag. | The checkbox is on the same screen, and the bar is a single 56 px row with no room (`homeRuns` hides at 760 px). | n/a |
| D-QB11 | Retry of a job of a legacy experiment resends the stored body; nothing is re-derived from `eval_experiments.versioning_details`. | That is how retry works today (QA2-6). | n/a |

Amendments to the previous round (this spec wins): previous `spec-b.md` criteria that quote the Run settings card height (236.4 / 251.8 / 376.7 px) or the Versioning details box; the home block's
`Add versioning details` button and its help text; the `Reading…` text row. Criteria B5-23 to B5-34 (the checkbox, helper, reason, callout) hold unchanged on both pages.

## 7. Test plan

| File | Covers |
|---|---|
| `tests/platform/test_experiment_versioning_details.py` (rewrite) | QA2-1 to QA2-6, QA2-8: 422 text, dry run, non-object, `null`/`{}`, stored NULL, no key in the service request, clone prefill, legacy experiment readable and merged, legacy retry. |
| `tests/platform/test_run_versioning_details.py` (keep, extend) | QA2-7: local runs still store and filter `versioning_details`. |
| `tests/platform/test_run_origin_filter.py` (extend) | QA3-1, QA3-9: `experiment.latency_sensitive` on `GET /api/runs`, run panel, recent runs; local run `experiment: null`. |
| `tests/platform/test_dashboard_summaries_*.py` (new `test_run_experiment_latency_descriptor.py`) | QA3-3: descriptor without the field is stale and requeued; republished value. |
| `tests/platform/test_experiment_latency_sensitive.py` (extend) | QA3-4 to QA3-7: list filter, gate text from the home path, immutability. |
| `tests/sdk/test_cli_run_list.py` (extend) | QA3-2: `--json` passes `experiment.latency_sensitive`, table origin text. |
| `frontend/src/features/experiments/launch/__tests__/LatencyControl.test.tsx` (new) | QA3-10 to QA3-16, QA3-23: five states on home and step 1, box clearing, shared doc value. |
| `frontend/src/features/experiments/launch/__tests__/VersionsBlock.test.tsx` (extend) | QA2-11, QA4-3 to QA4-9, QA4-11: states, copy, no add button, loading DOM, one query. |
| `frontend/src/features/experiments/launch/model/{spec,layering,validation}.test.ts` (edit) | QA2-12, QA2-13: versioning removed from build, dry-run key, validation, layering of the clone prefill. |
| `frontend/src/features/runs-list/__tests__/cells.test.tsx` (extend) | QA3-25 to QA3-31: tag count, slot, repeat run, absent field. |
| `frontend/src/features/experiments/list/ExperimentsPage.test.tsx` (extend) | QA3-34 to QA3-37. |
| `frontend/src/__tests__/design-language.test.ts` + `pytest tests/platform/test_design_language.py` | QA4-14, no new tokens. |
| `frontend/e2e/experiments/launch/qa-b-home.spec.ts` (new) | QA3-10 to QA3-19 at 1440 and 390 with axe; QA3-17 round trip with the network assertion; QA3-18 Show focus. |
| `frontend/e2e/experiments/launch/qa-b-versions.spec.ts` (new) | QA2-9, QA2-10, QA2-14, QA2-16, QA4-1 to QA4-13, QA4-16 at three widths, request counts (QA4-6), slow fake for QA4-7. |
| `frontend/e2e/runs/qa-b-runs-tag.spec.ts` (new) | QA3-25 to QA3-33 with a seeded flagged experiment (`launchExperiment` + `linkRunToJob`), geometry assertions QA3-27. |
| `frontend/e2e/experiments/lists-latency.spec.ts` (extend) | QA3-34 to QA3-38. |

## 8. Hand-off (build order)

1. Backend: `api/experiments.py`: keep `versioning_details: Any = None`; `create_experiment` returns the `422` text for any non-null, non-empty-object value; store `None`; stop passing details to `_request_body`, `_preview_body`, `_service_versioning_details`
   (new experiments only: they are `None`); remove `versioning_details` from the clone prefill (`:1956`). Keep `normalize_versioning_details` for the ingest route. No migration.
2. Backend: `services/run_origin.py`: select `EvalExperiment.latency_sensitive` in both ref builders and put it in the ref; `services/dashboard_summaries.py` `_descriptor_origin_stale` and `reconcile_summary_shapes` stale clause for the missing nested key (use `Dimension.descriptor["experiment"]["latency_sensitive"]` JSON path; SQLite and Postgres). `packages/sdk/qym/cli/run.py`: origin cell suffix; types in `frontend/src/api/dashboardTypes.ts` (`experiment: {id, name, job_id, latency_sensitive?: boolean} | null`).
3. Frontend model: delete `PSEUDO.versioning`, `parseVersioning`, `versioningText`, `versioningText` in `LaunchDocument` / `document.ts` / `layering.ts`, the `#versioning-details` rules in `validation.ts`, `editor.ts` skip entry, tallies in `LaunchProvider.tsx` and `LaunchWizard.tsx`, `ExperimentCreateRequest.versioning_details`; update the tests listed above.
4. Frontend launch: new `launch/entry/LatencyControl.tsx` (+ the box-clearing effect and the `registerField` call); `RunSettings.tsx` uses it and loses the textarea; `LaunchHome.tsx` renders it in the Environments card (`.latencyBlock` from the mock); `heldOnHome` accepts `#latency`; `VersionsBlock.tsx`: drop the `onCustomize` prop and button, new help text, loading DOM with `.skelValue`, `.versionRow { min-height: var(--badge-height) }`; `EntryBlock.tsx` renders `<VersionsBlock />`.
5. Frontend runs list: `cells.tsx` `RunNameCell` (leading slot / after Official), `RunLatencyTag`, `cells.module.css` (`.leadSlot`, `.runLatencyTag`, `flex: none` rule); `RunRow` type.
6. Tests and e2e (section 7); `cd frontend && npm run check` through `scripts/heavy.sh --cost 3`; `pytest tests/platform` in chunks; update `docs/USER_GUIDE.md` (launch form: no versioning box; versions shown read-only) and `docs/internal/OPERATIONS.md` if it mentions the field.

## 8b. Amendments made while implementing (implementation stage)

| Id | Was | Is (measured in the app) | Why |
|---|---|---|---|
| QA3-13, QA3-14 (amended) | Environments card 304.2 / 334.9 / 374.3 px off, 343 / 373.7 / 429.9 on (gallery frame, 2 environments with 3 tags each) | The card's absolute height depends on the environments' tag rows (seed: Alpha with a default preset, Bare). The control's contribution is what is pinned: on minus off = 38.8 px at 1440 (callout 34.8 px), as in the gallery (343 - 304.2). App value with the e2e seed at 1440: 275 off, 313.8 on. | The gallery frame shows two environments with the preset tag; the number depends on the seed, the delta does not. The e2e asserts the delta and the callout height. |
| QA3-30 (amended) | Card head 23 px | The Run cell (`[data-testid="run-cell"]`) in the card head is 20 px with and without the tag; the card is 162.8 px with and without it (delta 0). The 23 px of the baseline measurement was the line box of the title; it is unchanged by construction (the tag lives inside the spacer's box). | The first implementation put the tag in an inline-flex slot: it changed the head's baseline and the card became 1.8 px shorter (161 px). The slot is now the chevron spacer's own box (`position: relative`, the tag absolutely centred), so the geometry is identical. |
| QA3-37 (clarified) | `filter-latency` test id | Added `data-testid="filter-latency"` to the list's checkbox (it had none). | Needed by the spec's own assertion. |
| QA2-1 (clarified) | any non-empty object | `{"": "x"}` and other non-empty objects, and every non-object (`"x"`, `["a"]`, `3`, `true`, `false`) answer the 422; only `null`, `{}` and an absent field pass. | D-QB2 |
| QA4-6 (clarified) | `Refresh` calls `refetch` | `refetch({ cancelRefetch: false })`: a request already in flight is kept, so a double press reads once more per row, never cancels. | QA4-11 |
| QA3-1 (clarified) | "the single run experiment panel" | `run_origin_fields` (runs list, run detail origin fields, dashboard descriptor) carries `latency_sensitive`; the separate `run_experiment_panel` payload (`experiment_name`, `job_status`, ...) is unchanged. | The ref is built in one place; the panel is a different shape. |

## 9. Limits of this design stage

- The gallery mocks are static: states that need the API (the request counts of QA4-6, the 422 text in the launch error region QA2-16, the polling of QA3-33, the descriptor republish QA3-3) are specified from the code and have no mock; the reviewer verifies them in the running app.
- The member-gated states (QA3-15, QA3-24) were not run against a live non-manager: the dev platform runs with `QYM_AUTH_MODE=none` (the user is a project manager), so those states are measured on the mock only.
- Heights that depend on text wrap (helper lines, 390 px rows) are gallery-frame numbers (home column 1163 px at 1440); the app's column is 1193 px and the line counts at 1440 are the same (2 helper lines); the reviewer measures the app within 2 px.
- The first mock of the Runs tag (text-width tag after `Official`) was measured and rejected: it cut 3 to 4 characters of names that fit today; the numbers are in D-QB4.
- The Dashboard (Overview) run-line layout was measured (240 px) but is not specified (D-QB9).
