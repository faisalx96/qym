# Historical backfill throughput

After fixing startup under `/qym`, the remaining delay was completing queued historical summaries. The worker fetched large source outputs that numeric summaries do not use, scheduled empty source stages as separate ticks, and slept one second after each tick even when work remained. Publication also issued individual event updates, rewrote initial record buckets, and repeatedly rescanned bucket extrema.

The updated worker:

- Selects numeric fields and required analysis metadata without fetching item inputs, outputs, expected answers, attempt outputs/errors, raw scores, or explanations. SQL predicates preserve the difference between SQL NULL and JSON null.
- Skips empty later stages with bounded index probes before acquiring the partition lock. Concurrent inserts remain covered by the transactional outbox.
- Pauses 50 ms between successful busy ticks and keeps the normal interval when idle or after worker failures. Transactions and per-tick limits remain bounded; live-run scheduling is unchanged.
- Publishes event batches with one SQL update inside the existing savepoint. Individual retries remain available if the batch fails.
- Assigns new numeric records to the source run's time bucket immediately and computes bucket extrema with one aggregate query, without duplicate repairs during first publication.

## Deleted runs and history order

Deleted runs are excluded from new backfill discovery and progress counters. Existing queued deletions only remove a published run's contribution, if present, and park the partition; they never scan source history or apply queued item events. Source changes leave the partition parked. Restoration makes it eligible again and rebuilds current source state, retiring the old snapshots so the 30-day event horizon cannot prevent restoration. A completed run stays hidden until its rebuild publishes.

History uses the dashboard run date (`started_at`, falling back to `created_at`) in descending order within each project. Missing publications and already-started work take precedence; projects are interleaved and live updates retain reserved capacity. This prevents imports of old runs from jumping ahead based on their import date while still finishing work already underway.

## Complete-backlog measurement

The benchmark starts the actual `/qym` application lifecycle with its background worker. It rebuilds all 200 runs, containing 4,000 source items with 64 KiB outputs and numeric scores, while 20 readers request the dashboard concurrently. Both measurements use the same synthetic data and a private PostgreSQL schema. No test suite ran alongside either final measurement. The updated measurement includes the deletion, restoration, and run-date ordering changes.

| Measurement | Previous main `06d36e6` | Updated worker |
| --- | ---: | ---: |
| Entire 200-run backlog ready | 110.60 s | 34.71 s |
| First complete run visible | 5.17 s | 0.75 s |
| Worker ticks | 55 | 23 |
| Worker database execution calls observed | 32,406 | 21,971 |
| Dashboard request p95 | 269.9 ms | 344.7 ms |

Complete backfill was **3.2 times faster**. These are local PostgreSQL and in-process HTTP measurements, not a prediction of production completion time. Larger runs, more passes, database latency, and concurrent ingestion change the time required. Browser polling can add its refresh interval before newly published rows appear.

The test source and raw results are stored alongside this document. Reproduce with a disposable PostgreSQL database:

```sh
QYM_TEST_POSTGRES_URL=... PYTHONPATH=packages/sdk:packages/platform \
  python artifacts/runs-performance/backfill_throughput_benchmark.py
```

Regression coverage includes numeric parity, SQL NULL/JSON null semantics, repeat passes and retries, batched publication rollback, source writes racing with an empty-stage probe, PostgreSQL worker lifecycle, and the shipped browser's incremental-publication flow. Deletion tests cover unstarted, partial, and published history, source corrections while deleted, restoration after 45 days, restoration racing with deletion cleanup, and run-date ordering versus import-date ordering.

Validation: 1,117 platform tests passed (8 skipped). After the final restoration-progress refinement, all 133 targeted deletion, scheduling, and dashboard API checks passed (3 skipped). All 15 browser backfill checks passed; the preceding throughput change also passed 50 browser/design checks. The rebuilt platform wheel contains the current worker, outbox, and dashboard assets. Changed Python files parse with Python 3.9 grammar.

Deploy the new image normally. Existing backfill cursors continue; no migration, queue reset, or SDK update is required.

Upgrade compatibility was checked against the exact worker source from deployed commit `06d36e6`: checkpoints during item, score, and event scans resume with the new worker, and completed publications remain unchanged. All 8 checks passed across PostgreSQL and SQLite, with final summaries compared against the independent legacy calculation.

Combined release validation with the dataset initial-loading fix: 51 dataset, design, dashboard backfill, deletion/restoration, and application lifecycle checks passed (1 skipped). The rebuilt wheel contains both fixes.
