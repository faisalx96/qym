# Experiments, launch form, eval queue, environments, models — analysis

Walked 2026-10-11 against the vanilla pages on port 8804 (SQLite, `QYM_AUTH_MODE=none`,
`QYM_ROLE=all` so the dispatcher runs) with a stand-in Evaluation Service
(`frontend/scripts/fake_eval_service.py`, two instances for two environments) and the
seed `frontend/scripts/seed_experiments.py`: 2 environments (slots confirmed, official
default preset v1 + saved preset), 4 experiments (single, two-env, 3-way sweep, HIGH).
Read the backend routes, `experiments.js`, `eval_queue.js`, `eval_environments.js` and
the launch-form family alongside.

## Confirmed

- Experiments list/detail/queue/environments/environment page/launch entry render as the
  brief says (screens: list, detail with stat strip + queue strip + matrix, queue env cards
  - job table, entry screen with Environment/Dataset cards + Start-from cards).
- Dispatcher moves QUEUED jobs to SUBMITTED within seconds (the fake service answers
  RUNNING on first read), so seeded jobs are in flight, not QUEUED. Queued/blocked states are
  produced by a HIGH job on the same environment (fake enforces the 409) and by stopping
  the fake service (`/__control/health`).
- Experiment detail payload carries `jobs[]` with `run`, `qym_config`, `remote_result`
  inline; the queue strip uses a second call (`/eval-queue?experiment_id=&limit=1000`).
- Error envelopes are `{detail: {message, code, ...}}`; `apiFetch` stringifies that into
  `ApiError.detail` and keeps the parsed object in `ApiError.body`, but `ApiError.code`
  only reads a top-level `code`, so `detail.code` has to be read from `body.detail`
  (helper `errorCode()` in `api/experiments.ts`).
- The environment page and the settings drawer are the same component with the same
  sections. Delete / Save sit in a sticky footer.
- Models page is empty without exactly one task + dataset and relies on the runs
  command bar for both.

## The brief was wrong or incomplete

- "Best score" column: confirmed absent from the payload (always an em dash). Dropped.
- Queue strip "N running" counts SUBMITTED + RUNNING together; the new strip keeps the
  four honest states (queued, submitted, running, blocked).
- `temporary_key_required` is not handled by the vanilla page (retry just toasts the
  message). New UI handles it (key re-entry dialog, then resend with `temporary_keys`).
- The brief's route list for the launch form (`experiments/new`) did not include the
  editor route for official defaults used by the settings page. Both are registered:
  `/environments/:envId/default-preset/edit`, plus the settings Environments tab.
- The Models page needs the shared command bar owned by the runs-list agent, which is not
  on this branch. This area ships a self-contained Models filter row (time range, origin,
  task, dataset) so it works independently; see OPEN_QUESTIONS.

## Behaviours to keep

Everything under "MUST-KEEP" in brief §3, with these notes: polling (decision logged),
cancel semantics (queued+blocked first, running only when nothing else pending),
preemption acknowledgement re-ask, matrix compare handoff via `sessionStorage.compareRuns`,
`announceRunStatus` after cancels, split cancel dialog with reason (`/eval-queue/cancel`),
remote queue lazy load, base-kind layering (baseline vs edits, changed dots, replay on base
switch), secrets only in memory (never DOM/URL/storage), schema auto-refresh once per
visit, dry-run preview debounced and generation-guarded, URL compatibility
(`?new=1`, `?environment=`, `?view=environments`, `?experiment=` all redirect).

## Dropped

`Function('import')` CodeMirror loader, non-summary models code path, "Best score"
column, hand-rolled column-width persistence (shared `DataTable` is used instead).
