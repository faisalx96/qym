# First-publication scheduling follow-up

Production reported revision 0, 1,894 unpublished runs, and zero failed partitions after migration 0050. The supplied logs confirm successful 0048 → 0049 → 0050 upgrades and successful dashboard requests, but provide no worker progress timings. They do not establish whether an individual worker transaction is blocked.

PR #45's read benchmark seeded already-published summaries. It did not measure how soon an initially empty projection publishes its first run. The worker ordered all historical partitions by last update time, moving a run to the end of the queue after every processed chunk. With a large backlog, every run could remain incomplete while the worker traversed the entire history repeatedly.

The revised scheduler finishes one historical run per project before expanding to normal backfill capacity. It then finishes small groups, prioritizing missing publications, existing checkpoints, and recent runs. It interleaves projects and preserves the existing quota for live runs. A live publication does not expand a project's initial historical batch. Publication still waits for complete, deduplicated summaries.

The worker also discovers a bounded number of runs imported without ORM outbox hooks, resumes their stored checkpoints, clears empty completed queue entries, and republishes a completed scan if its initial publication is missing. Recovery uses the existing transactional outbox and respects repair-required partitions.

The deterministic reproduction uses 100 completed runs, six items per run, four worker slots and two records per batch. The real worker publishes its first complete run at tick **8**, compared with tick **80** previously. After another eight ticks, four more runs publish. PostgreSQL and SQLite regression tests verify project interleaving, checkpoint resumption, missing-publication priority, queue recovery, and live-run priority. Tick counts exclude the normal sleep interval and database processing time; they are not a production latency estimate.

The PostgreSQL cold-start benchmark begins at revision zero with 1,894 runs and 28,760 source items. Each item has a 16 KiB output. The newest 20 runs have 501 items and three passes, with aggregate scores, per-pass scores, attempts, and legacy retry/error events. Twenty readers send concurrent dashboard requests while the real worker rebuilds summaries. After tick two, the benchmark recreates the worker and inserts a live run through the ORM outbox.

Local results, recorded in `cold-start-results.jsonl`:

| Measurement | Result |
| --- | ---: |
| Concurrent dashboard requests | 540 |
| Request median | 124.7 ms |
| Request 95th percentile | 274.7 ms |
| First complete historical run visible through API | 18.3 s |
| New live run publication latency | 1.5 s |
| Unpublished history remaining at first publication | 1,893 |
| Source-history queries from dashboard requests | 0 |

The benchmark verifies complete item, error, retry, and pass counts after the worker restart. It measures initial availability, not completion time for all 1,894 runs. It uses a local PostgreSQL database and in-process HTTP client, so these are not production network timings. Browser polling can add up to its normal refresh interval before a newly published row appears. Browser regression tests exercise the shipped page against the real API, checking both the first visible row during backfill and the complete history afterward.

Validation passed on the final worker implementation:

- Full platform suite excluding browser tests: 1,094 passed, six skipped, 74 browser cases deselected. Both SQLite and PostgreSQL fixtures were enabled.
- Backfill, paging, models, dashboard orchestration, and design checks: 50 passed, including Chromium against the real API during incremental publication.
- Platform wheel built successfully; the archive contains the current worker source and dashboard asset.
- Changed Python files parse with the Python 3.9 grammar; `git diff --check` passes.

Reproduce with the repository test dependencies and optional isolated PostgreSQL test URL:

```sh
pytest tests/platform/test_runs_list_performance.py -q
# Requires QYM_TEST_POSTGRES_URL pointing to a disposable PostgreSQL database.
PYTHONPATH=packages/sdk:packages/platform python artifacts/runs-performance/cold_start_benchmark.py
```

Deploy this code on top of PR #45. There is **no new migration, queue reset, or SDK update**. Existing backfill cursors resume on the next worker tick. The dashboard refreshes automatically after a first publication; its `revision` increases and `unpublished_runs` decreases. Tabs opened before PR #45 should be refreshed to load the new dashboard script instead of continuing the old full-history fallback.
