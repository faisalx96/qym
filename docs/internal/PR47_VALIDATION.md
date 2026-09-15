# PR 47 integration validation

## Scope

The integration branch combines PR 47 at `90070ec37a8f2d3b7e15788bdee8a132722176ea`
with the original checkout's force-stop and pass-review changes. The original
checkout's 28 changed files still match their captured SHA-256 hashes.

The [merge plan](PR47_MERGE_PLAN.md) describes publication, CI and deployment.
The branch has not been pushed, merged or deployed to production.

## Result

Implementation and local test coverage are complete at commit `bded819`.
Merge still requires fresh GitHub checks and the final Docker smoke, which is
blocked by unresponsive OrbStack.

| Python | Passed | Skipped | Failed | Missing cases |
| --- | ---: | ---: | ---: | ---: |
| 3.9 | 1,748 | 14 | 0 | 0 |
| 3.11 | 1,748 | 14 | 0 | 0 |
| 3.12 | 1,748 | 14 | 0 | 0 |

The 15 Node automation tests also passed. Packaging, browser workflows, design
checks and the native packaged-runtime smoke passed.

## Confirmed fixes

- Retention rechecks deletion eligibility under a run lock. Restore-first keeps
  the run and children; purge-first returns 404 without a false restore audit.
- Public delete/restore and the dashboard worker acquire projection locks in a
  consistent order. A PostgreSQL regression reproduced the previous deadlock.
- Legacy span removal requires matching source/destination keys under locks.
  Unrelated rows, incorrect partition timestamps and `force=true` cannot bypass
  missing data. Copy retains restorable deleted runs and a fixed retention cutoff.
- Structural storage preserves SDK 1.5.2 pass outputs across separate completion
  and attempt-finished requests. Retry and cancellation details match their actual
  execution state.
- Dashboard cache identity includes pending run membership. The original public
  reproduction returns 200 during bounded publication of a 600-item run. Hour and
  day extrema exclude deleted runs and recover correctly after restore.
- Pass deletion preserves retired review evidence, renumbers surviving history,
  and rejects stale pass-number mutations and late analysis saves. Existing and
  newly collapsed one-pass runs remain reviewable.
- Dashboard deletion dialogs retain the selected pass's version. Polling clears
  outdated selections and discards delayed pass details. Run-page issue drafts
  also expire when the pass mapping changes during an analysis refresh.
- Analysis aggregation reloads locked metadata after an LLM call, preserving an
  approval committed while the call was running.
- Numeric pass-score edits also lock the item and pass before reading metadata.
  Two PostgreSQL regressions reproduced and prevent an edit reverting a
  concurrently committed approval to pending in the displayed pass data.
- Compose forwards maintenance and retention settings to both roles. Its health
  check honors the configured URL prefix.
- Standalone worker startup registers and configures all ORM models before its
  threads start. A cold-process regression covers the import race found during
  the final Docker restart.
- Dashboard event cleanup uses the actual `source_version` key and removes
  associated cause rows in the same transaction.

## Regression coverage

Targeted checks include real PostgreSQL transactions, actual API endpoints and
Chromium interactions. They cover both race orderings, migration recovery from
populated 0050 data, repeat upgrades, deleted review history, stale requests and
the full three-to-two-to-one pass workflow.

The SDK concurrency gate now checks that every metric starts before any can
finish. A forced serial implementation fails this check. Timing measurements
remain in JUnit as diagnostics. The existing sibling-project SDK test now patches
the function's defining module when imported through a compatibility wrapper.

Final matrix counts and artifact hashes are recorded in
[`results.json`](../../artifacts/pr47-validation/results.json).

Counts combine completed phases after the backend interruption. The coverage
check matches each result to the complete collected test list and rejects
missing or unexpected cases. Later fixes reran their affected cases. Earlier
phase failures remain visible in each coverage report.

The expected 14 skips are 12 SQLite concurrency cases with passing PostgreSQL
counterparts and two optional SDK tests requiring `traceloop-sdk`.

## Packaging and deployment checks

Both distributions build. Wheel contents are compared with the frozen checkout.
All 280 package Python files, served assets and migrations match. The smoke test
installed both wheels in an isolated directory using existing Python 3.11.14
dependencies. With PostgreSQL 16.15 and LZ4, it passed migration to 0057,
separate API/worker operation, prefixed HTTP checks, maintenance
rejection, and three cold worker starts with completed cleanup jobs. All smoke
processes shut down. See the
[packaged runtime report](../../artifacts/pr47-validation/native-wheel-runtime.json).

An earlier disposable Docker deployment exercised separate API and worker roles,
migration head 0057, prefixed health and asset URLs, the Admin Maintenance API,
maintenance HTTP 503 with `Retry-After`, and a completed worker job. A subsequent
cold start exposed the mapper race described above. OrbStack then stopped
responding during the final rebuild. The final image has not passed its smoke
test, and earlier Docker results do not certify the final source.

## Limits

- These checks use disposable databases and controlled fixtures. Production data
  size, migration duration and a live rollout still need the operations runbook's
  backup and restore rehearsal.
- SDK mypy reports 111 existing errors in 20 files on the base, PR head and
  integration branch. Normalized diagnostics are identical, with no new errors.
- Synthetic latency measurements taken while other tests run are not a reliable
  before/after performance comparison. Query budgets and bounded reads are tested;
  the benchmark artifacts state their dataset and backend.
- Remote checks still belong to the original PR head. Fresh GitHub checks are
  required after publishing the tested integration commits.
