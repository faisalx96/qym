# QA: experiments, launch form, eval queue, environments, models

Area: brief 06. Compared the vanilla UI at `7814183` (platform :8825) with the React app on `ui/qa` (Vite :5835 over
platform :8835, run from a clean detached worktree of `5adb72c7` because the shared cutover worktree was being edited
by other agents), same seeded SQLite file (project `exp-demo`: 21 runs, 2 environments `staging`/`production` on the
fake Evaluation Services 8935/8936, default preset, saved presets, 4 experiments, later extra experiments, 2 datasets),
`QYM_AUTH_MODE=none` (so every check ran as ADMIN/manager). Both platforms shared the same fake services, so remote-queue
"orphans" on one platform include the other platform's jobs; that is a harness effect, not a bug.
Verification: ad-hoc Playwright scripts on both UIs (screenshots kept outside the repo), diffing the real
`POST /experiments` bodies for the same inputs (identical except where noted), plus source reading. Existing e2e specs were
not re-run (they need their own 8800/5800 stack). "code" in the Verified column means read from source only.
Paths are relative to `frontend/src/features/` unless noted. Status: OK / CHANGED / BUGGY / MISSING.

## Summary

Total rows: 132. OK 89, CHANGED 34, BUGGY 4, MISSING 5.

Highest-impact findings: (1) Models page lost the Models/Versions/Status/Users/versioning filters, the custom date range,
Clear and the topbar run KPIs (decision Q7 logged, no equivalent); (2) Models cards lost the trace tiles (avg tokens, LLM
calls, tool calls, tool success rate); (3) breadcrumbs on experiment detail, launch, environments never show the parent
or item crumb; (4) remote-queue table offers a checkbox on every row although only orphan/stale rows can be cancelled;
(5) settings tree no longer shows the raw setting key, group counts, or matches pointers in search. The launch form
produced byte-identical request bodies to the old form for default preset + edits, clone (sweeps, links, priority,
versioning) and best run, which is the strongest evidence of parity in the model layer.

## Table

Spec legend: e2e/experiments/{list,detail,queue,environments,models,run-panel,a11y,cutover-*}.spec.ts and launch/*.spec.ts.

### A. Experiments list

| # | Old behaviour | New code | Status | Verified / notes |
|---|---|---|---|---|
| A1 | Header "Experiments", description, "N experiments", "+ New experiment" | experiments/list/ExperimentsPage.tsx:192-200 | CHANGED | Copy changed; button hidden when project archived (readOnly). Fine. Live. |
| A2 | Tabs Experiments / Queue / Environments | ExperimentsTabs.tsx | OK | Live. |
| A3 | Status select (6 values) in URL `?status=` | ExperimentsPage.tsx:202-218 | CHANGED | Option labels lower-case ("queued"). Cosmetic. Live. |
| A4 | "Created by me" `?mine=1` | :229-240 | OK | Live (list.spec). |
| A5 | One select per versioning key, `?versioning=k=v` repeatable, label humanised ("KB version", "All kb versions"), tooltip | :219-228 | FIXED (f401fb88) | Label is the raw key, "Any kb_version", no tooltip. No facet data in seed: code only. list.spec covers facets. |
| A6 | Table columns Name/Status/Environments/Base source/Jobs/Best score/Creator/Age, widths persisted `experiments.list.v1` | :95-133 | CHANGED | "Best score" dropped (API never sent it; decisions Q2). Creator cell lost its title tooltip. Persisted widths kept. Live. |
| A7 | Environment names resolved client side | :259-272 | CHANGED | Adds "(disabled)" suffix. Improvement. |
| A8 | Job tags ✓/✗/●/⊘ with titles | :274-296 | OK | Live. |
| A9 | Row click opens detail (not on links) | rowHref | OK | Row is a link, Enter works (a11y.spec). |
| A10 | Pagination 50, page not in URL | :246-254 | CHANGED | `page` now in URL. >50 rows not tested (code only). |
| A11 | Empty states "No experiments yet" / "No matching experiments" | :151-176 | CHANGED | New copy, adds Clear filters action; empty-project action is "New experiment" (old pointed at Environments). |
| A12 | Poll note "Auto-refreshing while experiments run" only while a live experiment exists | :241-243 | FIXED (f401fb88) | Note is always shown, even with nothing live. Minor. |
| A13 | Poll 5 s x1.5 to 60 s, paused when hidden, re-render on fingerprint change | api/experiments.ts:282-296 | OK | code + queue.spec polling test; list cadence not timed. |
| A14 | Load error state with retry | :143-150 | OK | code |

### B. Experiment detail

| # | Old behaviour | New code | Status | Verified / notes |
|---|---|---|---|---|
| B1 | Breadcrumb project / Experiments / <name>; "← All experiments" | shell/chrome/Breadcrumbs.tsx:25-31, detail/ExperimentDetailPage.tsx:30 | FIXED (fd6fd6bb) | Crumb shows only "Experiments" (not a link, no name). Back link present. Live. |
| B2 | Header: name, description fallback text, meta (creator, age with abs title, priority, base, env names with "(disabled)"), status badge | ExperimentDetailPage.tsx:119-146 | OK | Live. |
| B3 | "Retry failed (n)" always shown, disabled at 0 | :148-157 | CHANGED | Hidden when 0. Fine. |
| B4 | "Cancel experiment" disabled w/o live jobs or permission, tooltip reason | :158-173 | CHANGED | Tooltip replaced by an inline note for non-controllers ("Only the experiment's creator or a project manager..."). Permission gating itself not exercised (needs non-manager login): code. |
| B5 | Stat strip Jobs/Succeeded/Failed/In progress/Cancelled (current attempts) | :174-198, lib/matrix.ts:93 | OK | Live, numbers match. |
| B6 | Queue strip per environment, "position P", "Open in queue →", hidden without live jobs | detail/QueueStrip.tsx | CHANGED | Now a card, zero counts shown ("0 queued · 1 running · 0 blocked"). Live. |
| B7 | Matrix: combo label + #index, env columns, "(disabled)" | MatrixCard.tsx:69-119 | OK | Live. |
| B8 | Cell: select checkbox (only usable runs), status badge, "↻ N earlier", headline metric (+lower-is-better title), run link, "Run deleted", error / wait_reason | MatrixCard.tsx:140-206 | OK | Live; deleted run / wait reason: code. |
| B9 | Cell actions Cancel / Retry / Save as preset / Promote (managers) | :207-250 | FIXED (4b3ce9ae) | Save as preset is also disabled for non-creator members (`!canControl`); old enabled it for everyone with a config. Server rule not checked. |
| B10 | Select all / Clear / Compare selected (n>=2) writes `sessionStorage.compareRuns`, goes to `/compare?runs=` | ExperimentDetailPage.tsx:86-95 | OK | Live: URL and sessionStorage identical to old. |
| B11 | Selection survives polls | :62-66 | OK | code |
| B12 | "↻ N earlier" opens history with superseded shown and scrolls to row | :97-117 | OK | Live (button and history toggle seen). |
| B13 | Setting-vs-metric chart: x-axis select, metric select, legend, empty text | detail/ChartCard.tsx | CHANGED | Same chart plus "View as table". Select options live; multi-env colours code only. |
| B14 | Job history table, `experiments.jobs.v1` widths, superseded toggle, Params column | JobHistoryCard.tsx | CHANGED | Params now only the swept values (old printed slot_bindings JSON too); Attempt column now shows 2 after a retry (old showed 1 for every attempt). Improvements. Live. |
| B15 | Cancel job dialog text, "Keep running" | useExperimentFlows.tsx:146-179 | OK | Live, text identical. Esc closes. |
| B16 | Cancel experiment: pending vs running-only variants, toast "N cancelled; M running left untouched" | lib/cancel.ts:55-96 | OK | Live both variants identical text/toast. |
| B17 | Retry single / retry failed (one confirm, HIGH ack once) | :181-280 | OK | Live retry failed: dialog, toast, new attempt. HIGH path covered by detail.spec; not run by me. |
| B18 | Temporary key re-entry on retry | components/TemporaryKeysDialog.tsx | OK (new) | Replaces old toast-only. detail.spec covers; not run by me. |
| B19 | Save as preset form (name default "exp · combo", notes), warnings toast | useExperimentFlows.tsx:301-346 | OK | Live, preset created. |
| B20 | Promote to default preset (managers) | ExperimentDetailPage.tsx:213 | CHANGED | Goes to `/environments/:id/default-preset/edit?promote=job&id=` (decision Q9) instead of the settings page. Live, editor opens with draft. |
| B21 | 403 sets denied state | flows.denied | OK | code + detail.spec. |
| B22 | `announceRunStatus` after cancels | cancel.ts:111 | OK | code |
| B23 | Not-found state | :39-45 | OK | e2e. |
| B24 | Polling 5 s backoff while jobs live | api/experiments.ts:300-317 | OK | code |

### C. Queue

| # | Old behaviour | New code | Status | Verified / notes |
|---|---|---|---|---|
| C1 | Header, "N jobs · refreshed Xs ago", tabs | queue/QueuePage.tsx:338-350 | OK | Live. |
| C2 | Filters environment/status/experiment/mine in URL | :351-381 | OK | Live; status shows title-case. |
| C3 | Experiment select from names seen + URL value kept | :133-140 | CHANGED | Built from project's experiments too (Q6). |
| C4 | Environment cards: health, in flight/queued/blocked, paused note, stale note, HIGH box | EnvCard :500-531 | OK | Live HIGH box and counts. |
| C5 | Jobs table columns # / Experiment+params / Environment / Priority / Status / Created by / Age / Elapsed / Run progress / actions | :199-329 | FIXED (5e2b4d31) | Priority column dropped: only HIGH is tagged, LOW/NORMAL invisible. Status shown upper-case. Progress empty shows "Not started". Params summary no longer prints slot_bindings. |
| C6 | Select all I can cancel, Cancel selected (n) | :401-436 | OK | Live ("(4)"). |
| C7 | Cancel split dialog (Queued here / On the service / Not allowed, reason, Keep jobs) | CancelSplitDialog.tsx | OK | e2e; row-cancel flow opens it (code). Not rendered by me. |
| C8 | Cancel all queued in experiment (re-fetches exact set) | :166-185 | OK | code + queue.spec. |
| C9 | "Showing the first N of M" | :470-474 | OK | code. Old limit 500: new limit not checked. |
| C10 | Remote queue collapsed, lazy load, orphan/stale tags | RemoteQueueSection.tsx | OK | Live: loads on open, 3 orphans tag. |
| C11 | Remote selection only on orphan/stale rows; cancel button only when some exist | :157-170 | FIXED (5e2b4d31) | Live: 9 checkboxes (every row + header) vs 1; cancel button always shown for managers. Selecting a matched row silently counts 0. |
| C12 | Remote cancel dialog wording "orphan job" vs "remote job", audit note | :182-206 | FIXED (5e2b4d31) | Always "remote job". |
| C13 | Stale badge + tooltip, "Local status X" | :126-132 | FIXED (5e2b4d31) | Tooltip dropped. Stale rows not produced in test: code. |
| C14 | Last refresh failed, fetched ago | :152-156 | OK | code |
| C15 | Manager-only note | :173-177 | OK | code |
| C16 | Polling always, paused when hidden | :98-107 | OK | queue.spec. |
| C17 | Column widths `eval-queue.jobs.v1` / `.remote.v1` | DataTable storageKey | OK | code |
| C18 | Topbar chip "N jobs" | useTopbarStats | OK (new) | Live. |

### D. Launch form: entry

| # | Old behaviour | New code | Status | Verified / notes |
|---|---|---|---|---|
| D1 | `?new=1[&env=][&clone=&job=][&base=saved&preset=]` | launch/LaunchPage.tsx:7-9, routes `/experiments/new` | CHANGED | New path `/experiments/new`; `?new=1` redirect covered by list.spec "legacy query-string links". |
| D2 | Environment checkbox list with health, "Needs LLM grouping", priority cap, default preset, Details link, New environment | entry/EnvironmentPicker.tsx | OK | Live. |
| D3 | Dataset select + version/alias select | entry/DatasetPicker.tsx | OK | Live; payload identical. |
| D4 | Custom dataset callout with Remove | DatasetPicker/BaseStatus | OK | Seen in default-preset promote editor; code. |
| D5 | Start cards (default preset, best run, copy, saved presets, scratch), "Presets of env" select when >1 env | entry/StartFrom.tsx | CHANGED | Saved presets collapsed into one card + select (no "v1 · by user" subline). Multi-env preset select live. |
| D6 | Base status: changes on top, Undo all, hints, release notes, drift tag | entry/BaseStatus.tsx | OK | Live; release notes collapsible. |
| D7 | Name (max 200), priority gating, versioning textarea validation | entry/RunSettings.tsx, model/spec.ts | OK | Live: maxlength 200, invalid lines "Line 1: write key=value", >100 char key. Non-manager HIGH gating: code. |
| D8 | HIGH warning callout; HIGH above env cap marked | model/validation.ts:375 | OK | Live ("Launching at HIGH cancels..."; "(above the environment maximum)"). |
| D9 | "Launch as is" / "Customize" two-step | single page + Launch | CHANGED | Wizard replaced by one page with sticky review (logged L1). |
| D10 | Unsaved-changes guard | LaunchPage.tsx:47-62 | OK (new) | launch.spec covers. Old had none. |
| D11 | Group LLM settings banner for unconfirmed env | sections/ModelsSection | OK | Live. |
| D12 | "New environment" from launch form (managers) | EnvironmentPicker | OK | Live button. |
| D13 | Clone `?clone=` prefill name "(copy)", versioning, priority, env, links, notes | LaunchProvider | OK | Live: request body identical to old; new additionally sends the source `description`. |
| D14 | Saved preset base `?base=saved&preset=` | StartFrom | OK | Live card + select. |
| D15 | Best-run picker, scope prompt, table, pick | launch/bestrun/*, sections/BestRunPicker | CHANGED | Live: works; first result is auto-selected as base before the user picks (old waited for a click). |
| D16 | Base change confirm, replay edits | chooseBase | OK | launch spec. |

### E. Launch form: models

| # | Old behaviour | New code | Status | Verified / notes |
|---|---|---|---|---|
| E1 | Current versions block with Refresh per env | launch/models/VersionsBlock.tsx | OK | Live values match. |
| E2 | Global model select, + Temporary model, + models, Apply/Clear, status line | models/GlobalModelCard.tsx | OK | Live. |
| E3 | Per-slot card: Inherit/project/Temporary/From base, tags | models/SlotCard.tsx | CHANGED | Follow global / Custom / Temporary segmented control (design decision). |
| E4 | Temporary model form (label, model, URL, key), Save to project models (slot only, managers) | environments/TemporaryModelForm.tsx | OK | Live fields identical, "save" logic ported (code). |
| E5 | Key kept in memory only, `{$secret}` in spec | model/secrets.ts | OK | e2e secret scan; not re-run. |
| E6 | Extra endpoints: + Add LLM endpoint, Remove, Edit LLM groups | models/EndpointControls.tsx | OK | Live controls present. |
| E7 | Model sweep "+ models" | models/SweepChips.tsx | OK | code + sweeps.spec. |
| E8 | Re-enter key row after clone | models/ReenterKeyRow.tsx | OK | models.spec. |
| E9 | "Change the saved LLM model groups" tooltip on Edit LLM groups | useGroupsDialog | CHANGED | Tooltip text dropped. |

### F. Launch form: settings, sweeps, evaluation, raw JSON, review

| # | Old behaviour | New code | Status | Verified / notes |
|---|---|---|---|---|
| F1 | Groups closed by default, count badge per group, "Other values" | sections/SettingsSection.tsx | CHANGED | Closed by default, matches-count while searching, but no static per-group count badge. |
| F2 | Field shows label + raw setting key (ENABLE_RESPONSE_DRAFTING) | settings/FieldNode.tsx | FIXED (481b0d6a) | Raw key no longer displayed anywhere (live HTML has no key). Hurts mapping to Raw JSON. |
| F3 | Search matches label, key, pointer, description | settings view | FIXED (481b0d6a) | Live: label and key match; `/env_overrides/REQUEST` (pointer) matches nothing. |
| F4 | Changed only, "N changed", Reset all, per-field Reset, changed dot | SettingsSection / LeafField | OK | Live. |
| F5 | Validation per field ("Enter a number", range) | model/descriptor.ts | OK | Live: "Enter a number", "Must be at most 3600". |
| F6 | Widgets for every type (boolean, enum, number, endpoint-ref, array/object JSON, collections, role table with All roles row) | settings/LeafField, JsonFields, RoleTable, AllItemsControl | OK | Fixture test allTypes; live boolean/enum/number/role table seen. Structured JSON editing quirk logged in CUTOVER ("[1, 2]" char-by-char). |
| F7 | Role overrides card inside the settings step with search/Overridden only/Reset roles | RoleTable.tsx | CHANGED | Embedded under LLM routing; "Edit role overrides" jump gone. |
| F8 | Sweep values per field: chips, range, boolean, link/unlink, run-count math | settings/SweepChips.tsx, sections/SweepsSection.tsx | OK | Live: 2 axes (2x3) over 2 envs = "12 runs", "Link selected", names list. |
| F9 | Over run cap blocks Launch | review/ReviewPane.tsx:130 | OK | sweeps.spec. |
| F10 | Evaluation inputs, Other values, run metadata rows, reserved keys, Also sent, Platform-owned | launch/evaluation/* | OK | evaluation.spec; evaluator-schema source note is a CUTOVER gap. |
| F11 | Raw JSON two-way sync, Revert, Apply, errors | sections/RawJsonSection.tsx | OK | evaluation.spec; live "in sync" status. |
| F12 | Review: environments, dataset, start from, priority, run count, math, name list, preemption warning, validation list clickable | review/ReviewPane.tsx | OK | Live. "Changes by step" with Edit links is new. |
| F13 | Launch: local errors focus, HIGH confirm, 422 ack resend, 422 errors, toast + navigate | LaunchProvider launch() | OK | Live launch navigates and toasts "Launched ..."; request body identical to old for default preset + 4 edits + versioning. |
| F14 | Debounced dry run | useDryRun.ts | OK | launch.spec. |
| F15 | Sticky bar / narrow layout | review/MobileLaunchBar.tsx | OK (new) | layout.spec. |
| F16 | Schema auto-refresh toast, remap callouts | useEnvData.ts | OK | code only (needs a drifted schema). |

### G. Default preset editor and presets

| # | Old behaviour | New code | Status | Verified / notes |
|---|---|---|---|---|
| G1 | Edit and publish: Publish disabled until change + notes, confirm dialog, toast | environments/DefaultPresetEditorPage.tsx, editor/PublishPane.tsx | OK | Live publish v2 on both; same gating and dialog text. |
| G2 | Editor copy | LaunchContext editor mode | FIXED (481b0d6a) | Settings card still says "applied to every run of this experiment" in the editor. |
| G3 | Dataset optional in editor | EditorEntry.tsx | OK | Live. |
| G4 | 409 stale publish | PublishPane | OK | preset-editor.spec. |
| G5 | Leave with unpublished changes asks | DefaultPresetEditorPage | OK (new) | preset-editor.spec. |
| G6 | Promote saved preset / run / job | PresetsSection.tsx, ExperimentDetail | CHANGED | Route-based (Q9). |
| G7 | Version history with read-only view, "Edit from vN" | PresetsSection.tsx | OK | Live history list. |
| G8 | Saved presets table: Open in launch form, Promote | PresetsSection.tsx | OK | Live. |

### H. Environments

| # | Old behaviour | New code | Status | Verified / notes |
|---|---|---|---|---|
| H1 | List columns, Run default preset, Manage, Test, + Add | environments/EnvironmentsList.tsx | OK | Live, identical content. |
| H2 | Environment page sections (Status, Schema, LLM groups, Presets, Ranking, Policies, Connection, Delete) | EnvironmentSections.tsx | OK | Live text identical. |
| H3 | Add dialog step 1 (key hint, create key link) | AddEnvironmentDialog.tsx | OK | Live. |
| H4 | Step 2 read-only generated form preview, first group open, per-field type/tags | FormPreview.tsx | FIXED (f401fb88) | All groups collapsed. |
| H5 | Step 3 group LLM settings (cards, key sets, transport chips, merge, add group) | SlotEditor.tsx | OK | Live content identical; slot-editor spec. |
| H6 | Test connection, Refresh schema diff, edit policies, moved-URL rule, delete/disable, re-enable | EnvironmentSections.tsx | OK | environments.spec; not exercised by me. |
| H7 | Manager gating of write controls | environments/* | OK | code; no test (CUTOVER gap), not exercised. |
| H8 | Run default preset one click + blockers | runDefaultPreset.tsx | OK | e2e. |
| H9 | Breadcrumb Experiments / Environments / <env> | Breadcrumbs.tsx | FIXED (fd6fd6bb) | Only "Environments" (page label); no env name crumb. Live. |
| H10 | Old URLs `?view=environments`, `?environment=` | routes | OK | list.spec legacy redirects. |

### I. Models page

| # | Old behaviour | New code | Status | Verified / notes |
|---|---|---|---|---|
| I1 | Command bar: time range Today/7d/30d/Range popover; origin segmented | models/ModelsPage.tsx:176-188 | FIXED (c3bf0922) | Today/7d/30d/All only; custom range popover missing (see I2). |
| I2 | Multi-select filters Tasks/Datasets/Models/Versions/versioning/Status/Users + Clear | :189-205 | FIXED (c3bf0922) | Only single Task and Dataset selects. Logged as decision Q7 (own Task/Dataset selects); no replacement for the rest. |
| I3 | "All runs"/"Filtered runs" global filter shared with runs page | ModelsPage | FIXED (c3bf0922) | CUTOVER gap verified: filters set on Runs are not applied. |
| I4 | Topbar KPI chips and bottom status bar "4 of 24 runs — task, dataset" | n/a | FIXED (c3bf0922) | Not shown on Models. |
| I5 | `?task=&dataset=` deep link | :84-102 | OK | Live: same URL works in both and gives the same cards. |
| I6 | Require one task+dataset, infer when one exists, empty state | :216-227 | OK | Live. |
| I7 | Metric select, K (1-100), Pass slider, Shown metrics | :232-271 | OK | Live; numbers match old exactly (90, 50, 90, 50, 75, 72.2, errors 1/7, retries 2, latency 1.4s). |
| I8 | Percent tiles with 1 decimal ("63.6%") | ModelCard | FIXED (c3bf0922) | Rounded to whole percent ("64%"). |
| I9 | Trace tiles (avg tokens, LLM calls, tool calls, tool success rate) | none | FIXED (c3bf0922) | grep finds no handling of `avg_tokens` etc. Old showed "—" for this data but values with traces. |
| I10 | Correct distribution bar, legend, items count, compare link (>=2 runs) | ModelCard.tsx | OK | Live; compare URL identical. |
| I11 | Ranking with medals | :325-353 | FIXED (c3bf0922) | "#1" text instead of medals. |
| I12 | Edit run selection modal, paged, cap K, config groups | RunSelectionDialog.tsx | CHANGED | Live: works, no config-group headings (none in data). |
| I13 | Last updated | :273 | OK | |

### J. Cross-cutting

| # | Behaviour | Status | Notes |
|---|---|---|---|
| J1 | Toasts duplicate in old (two toasts) | OK | New shows one. |
| J2 | Run page experiment panel | OK | run-panel.spec; not re-verified here. |
| J3 | RTL / Arabic text in names | OK (unverified) | not tested. |
| J4 | Persisted prefs | OK | same DataTable keys (`experiments.list.v1`, `experiments.jobs.v1`, `eval-queue.jobs.v1`, `eval-queue.remote.v1`); `compareRuns` sessionStorage verified. |

## Fix list

Ordered by impact.

1. **major** Models page filters (I2, I3, I4). Repro: open Runs, filter by model/status/user, go to Models: no filter is applied and none is available. Hint: add MultiSelect filters for models/versions/status/users plus versioning keys and a range popover in `models/ModelsPage.tsx` (the `DashboardFilters` type already carries them), or share the runs command-bar state.
2. **major** Models trace tiles (I9). Hint: add `avg_tokens`, `avg_llm_calls`, `avg_tool_calls`, `tool_success_rate` to `statTiles` in `models/modelsLogic.ts` and the stats mapping in `api/dashboardModels.ts`.
3. **minor** Remote queue selection (C11). Repro: queue, expand Remote queue: every row has a checkbox. Hint: pass `selection` only for rows with `orphan || stale` (or a row `isSelectable`), hide the cancel button when `orphan_count + stale_count === 0`, restore "orphan job" wording (C12).
4. **minor** Breadcrumbs (B1, H9). Repro: open an experiment: crumb is "Experiments" only. Hint: extend `RouteContext`/`Breadcrumbs.tsx` with experiment name, "New experiment", environment name (the page can pass a label through a context like `useDocumentTitle`).
5. **minor** Setting key and search (F2, F3). Hint: render `node.name` mono next to the label in `settings/FieldNode.tsx` and add the pointer and description to the search haystack in `model/settingsTree.ts`.
6. **minor** Save as preset gating (B9). Hint: drop `!canControl` from `MatrixCell` (`detail/MatrixCard.tsx:233`) after confirming the preset API allows members.
7. **minor** Queue priority visibility (C5): show a Priority tag for LOW too, or a column.
8. **minor** Models precision and medals (I8, I11): keep one decimal (`formatPercent(x, 1)`).
9. **minor** Editor copy (G2): the settings description should not say "experiment" when `mode === 'editor'`.
10. **minor** Poll note always visible (A12): show only while an experiment is queued/running.
11. **minor** Versioning facet labels (A5): humanise keys and add the "Evaluation Service versioning: key" title.
12. **minor** Add dialog preview collapsed (H4): open the first group by default.

## Deferred

- I3 as a literal "All runs / Filtered runs" switch: not added. The Models page now shares the Runs page's filters
  (adopted when Models opens without filters of its own, cleared with Clear), which covers the use; a separate
  switch needs a product decision (about 0.5 day).
- I4 bottom status bar on Models: replaced by a one-line sentence under the filter row ("4 of 24 runs - task, dataset"); the topbar chips are the shared Runs ones.
- C5 status in title case on the queue (still upper-case) and C14-style param summary: left as is (cosmetic).

## Not verified

- Non-manager and non-creator gating (no multi-user auth stack run): B4, B9, D7 priority gating, H7, C15 are code reads.
- More than 50 experiments (pagination), versioning facets, deleted runs in the matrix, stale remote rows, schema drift/remap, drift tag.
- Environment write actions (Test, Refresh schema diff, policies, delete/disable) were not clicked; only the add dialog and page content were compared.
- Temporary-model launch with a key, key re-entry after retry, HIGH acknowledgement on retry/launch: left to the existing specs.
- Polling cadence (timing) and hidden-tab pause, RTL, mobile widths other than what layout.spec covers.
- Models: multi-config-group run selection, boolean/numeric metrics (only exact_match and execution_accuracy checked).

## Re-review

Built `ui/qa` at ea9153d1 from a clean detached worktree (`npm run build`), served by the platform on :8835 with fresh seed
data and fake services on 8935/8936; every row below was exercised in the browser (Playwright) unless noted.
Result: all 25 FIXED rows hold; no row is BUGGY after the re-review.

FIXED rows verified:

- I1, I2, I3, I4: the Models page has the Runs Filters popover (time incl. "Range…" custom date popover, origin, tasks,
  datasets, models, versions, status, users), chips, "Clear N", topbar KPIs ("All runs"/"Filtered runs") and the sentence
  "4 of 24 runs — task: text2sql, dataset: spider-dev". Set Tasks "Only text2sql" on Runs, open Models: URL becomes
  `?task=text2sql`, chip and "Filtered runs 7 runs" adopted. Models filter, origin=local round-trip in the URL and survive
  reload; Clear returns to a bare URL.
- I8, I11: tiles show one decimal (90.0%, 63.6%, 36.4%), ranking shows medals; numbers equal the old page.
- I9: with the `/api/dashboard/models` response intercepted to add `trace_stats`, the four tiles render (Avg tokens 1.2K,
  Avg LLM calls 3.5, Avg tool calls 2.0, Tool success rate 87.5%).
- C5: queue table has a Priority column (Normal/High).
- C11, C12, C13: remote table has checkboxes only on orphan rows (3 incl. header vs 9 before); a manager button appears
  only for environments that have orphans or stale jobs; dialog title "Cancel 1 orphan job on production?", button
  "Cancel 1 orphan"; a stale row (local FAILED, service RUNNING) shows a "Stale" badge with a tooltip and "Cancel selected
  remote jobs".
- B1, H9: breadcrumbs are Demo project > Experiments > <experiment name>, ... > New experiment, ... > Queue,
  Experiments > Environments > <env>, and ... > <env> > Default preset on the editor, each parent a link.
- B9: Save as preset enabled for a member who cannot cancel/retry (unit test MatrixCard.test.tsx; the server only requires
  project access for saved presets, `eval_presets.py:130-135`). Not exercised as a non-manager (auth none).
- A5, A12: facet selects read "All KB versions" with title "Evaluation Service versioning: kb_version" (response
  intercepted to add facets); the "Refreshes automatically" note shows while an experiment is live and is gone for
  status PARTIAL / FAILED.
- F2, F3, G2: each setting shows its raw key (ENABLE_RESPONSE_DRAFTING, REQUEST_TIMEOUT); searching `/env_overrides/REQUEST`,
  `REQUEST_TIMEOUT` and `Request` all find Request Timeout; the editor's settings card no longer says "experiment".
- H4: the Add environment preview opens the first group by default.

Spot-checked OK rows (still OK): A2, A4, B2, B5, B10 (compare handoff: URL and `compareRuns` sessionStorage), B15-B17 (cancel
job / cancel experiment copy and toast, retry failed), B19 (save as preset), B20 (promote opens the editor), D3, D13 (clone body
identical to the old form except ids and the source `description`), F8 (two swept axes over two environments = 12 runs,
"Link selected"), F13 (launch body equal to the old form for default preset + four edits + versioning), G1 (publish v2
gating, confirm, toast), H1-H2, H3/H5 (add environment connect, group, confirm; test connection, refresh schema, save, delete
all work), C1, C2, C4, C10.

Remaining notes (not regressions): the Environments list page crumb is just "Environments" (old: Experiments / Environments);
C5 status casing and the literal All/Filtered switch are Deferred by the implementer and acceptable; my
non-manager/permission, >50 pagination and schema-drift items from "Not verified" are still unverified.
