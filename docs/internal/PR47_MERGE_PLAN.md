# PR 47 integration and validation plan

## Inputs and isolation

- PR 47: `perf/storage-worker-overhaul` at `90070ec37a8f2d3b7e15788bdee8a132722176ea`.
- Local changes: snapshot of the original main checkout at `eb975b2d4c6d6b518283834fb94a41fbef26689e`.
- Integration branch: `codex/merge-pr47-local-fixes` in `/Users/faisalbh/qym-pr47-integration`.
- Local integration commit: `ec7718b`. Fixes and regression tests: `bded819`.
- Keep the original checkout and its databases intact. Use disposable databases for every migration and destructive-operation test.

## Merge order

1. Start from the reviewed PR commit and apply the local force-stop and pass-review changes.
2. Move the local pass-review migration after the PR migrations, from 0051 to 0057 with parent 0056. Preserve approval recovery and category publication.
3. Preserve the local serialized browser polling and cancellation behavior with the PR's two-second polling interval.
4. Fix storage and read regressions before merging the integration branch into main.
5. Recheck the exact PR and main commits before a real merge. If either changed, integrate and repeat the affected checks.

## Required fixes and acceptance criteria

| Area | Required result |
| --- | --- |
| Restore and retention purge | Restore-first preserves the run and children. Purge-first returns a clean not-found response. Recheck retention eligibility under a row lock before cleanup. |
| Legacy span removal | Verify each eligible source key has a destination key. Unrelated destination rows cannot authorize removal. Copy includes restorable deleted runs. Verification and removal cannot race writes. |
| Legacy SDK output | Separate completion and attempt-finished requests preserve every pass's output in structural mode. An omitted output cannot erase an already stored value. |
| Retry display | A non-final failed attempt followed by a running retry appears active, with correct running/completed counts. |
| Cancellation | Pass detail retains the cancellation reason even without an attempt-finished event. |
| Dashboard cache | Pending run membership invalidates catalog, page and overview caches across processes. Public reads remain consistent before publication finishes and after deletion. |
| Bucket extrema | Soft-deleted runs contribute neither minimum nor maximum; restoring them restores the correct values. |
| Pass deletion and reviews | Deleted reviews retain historical evidence and cannot modify a surviving pass. Renumber surviving review history together with pass data. Version checks reject stale browser edits, deletions and late analysis saves. A former repeat run reduced to one pass remains reviewable, including existing data upgraded through 0057. |
| Concurrent analysis approval | Reload locked pass metadata after an LLM call, so an approval committed during that call remains protected. |
| Numeric edits and review approval | Serialize pass-score edits with correction-ID review actions and reload stored metadata. An edit cannot revert an approval that another session committed. |
| Dashboard publication and restore | Acquire the run, partition and projection locks in a consistent order. Public restore must complete while the worker processes deletion. |
| Dashboard pass selection | Preserve the selected pass's revision through confirmation. Polling cannot silently retarget a pending deletion after another user removes a pass. |
| Worker startup and cleanup | Configure all ORM mappings before worker threads start. Prune published dashboard events by `source_version`, removing their cause rows atomically. |

## Verification

1. Add regressions that exercise the observed failure, including public HTTP responses where practical.
2. Run PostgreSQL concurrency tests with separate transactions and deterministic barriers, covering both lock orders.
3. Run migration tests from an empty database and populated 0050 data through 0057, then repeat the upgrade. Verify pass approvals, snapshots, foreign keys and one migration head.
4. Run SDK and platform suites, browser tests, design-language checks and automation tests. Enable PostgreSQL and Chromium rather than accepting missing-dependency skips.
5. Check supported Python 3.9, 3.11 and 3.12 environments. Build both distributions and inspect their packaged assets. Exercise the Docker image and split process roles when Docker is available.
6. Check dashboard query budgets and the affected performance paths after restoring correctness.
7. Review the final diff independently. Record exact commands, results and any remaining limits beside this plan.

## Release sequence

1. Review the final integration diff and its validation report. Recheck both remote commit IDs against the inputs above.
2. Fast-forward PR 47's branch to the tested integration branch with a normal push, without force. This puts the local changes and fixes into the same PR. A remote divergence must be integrated and tested first.
3. Require fresh GitHub checks for Python 3.9, 3.11 and 3.12 and a successful smoke test of the final Docker image before merging PR 47. OrbStack recovery is still needed for the Docker check. The old PR's checks do not validate these local commits. The updated workflow installs Node browser tools so the admin browser contract runs in CI.
4. Preserve the original checkout's 28-file snapshot on a separate local branch before updating its main checkout. Compare it against the integrated files, then switch back to main and fast-forward to the merged remote main. Do not discard the uncommitted snapshot or reapply it wholesale over the integrated fixes.
5. Deploy separately using the updated operations runbook: rehearse a full backup restore, enable maintenance on both roles, migrate to 0057, start the worker, copy legacy spans, verify exact keys and remove legacy storage, then reopen writes.

A rollback after destructive removal requires restoring the backup or a compatible forward fix; an old image alone is insufficient. This task prepares and validates the branch. Publishing, merging and production deployment remain separate actions.
