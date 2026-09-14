# Runs performance fix after PR #44

Based on merged `main` at `4f11b1f`. Production logs showed the Runs page requesting the dashboard endpoint, then `/api/runs` offsets 0 through 600. PR #44's migration started a historical refresh, which triggered a browser fallback that downloaded every run before rendering. Each source page also reconstructed error/retry counts from event JSON containing task outputs and score metadata. Request cost therefore grew with evaluation history and output size.

The isolated source-path reproduction in `source-regression.txt` used 10 runs, 200 items per run, three passes and 18,000 events. With 16 KiB task outputs, the changed handler read 187.5 MiB of output data to build a 13.7 KiB response: 383 ms versus 32 ms before PR #44. These isolate the regression; the supplied production logs have no request durations.

The fix serves the last complete published summary while historical refreshes proceed. The browser requests a bounded page and never switches to downloading all source history. New imports show available rows and explicitly label incomplete totals. Filters, selections, comparison, charts, model views, roles and the new error/retry/pass displays continue using the same published data.

Legacy `/api/runs` clients also reuse published summaries. Only unpublished runs use source aggregation, and event reads select counters rather than outputs. Error/retry evidence from older SDK events is captured transactionally and replayed in bounded background batches using the existing `(run_id, sequence)` index. Counts deduplicate each item/pass across events, attempts and scores; task success rates remain separate from execution errors. Normal successful events add no new outbox record.

Dashboard pages, overview calculations and the shared run catalog reuse work within a publication revision. Concurrent identical requests share one computation. Keys include database, project, hidden-task policy, revision, filters, sorting and pagination. Authorization runs on every request, and request-specific project permissions and freshness are attached after cache lookup. Each process has 24 MiB of total serialized cache budgets (Python object overhead is additional), entry limits and a 15-second TTL; failed calculations are never cached. Worker scheduling reserves capacity for live runs while historical refreshes retain a quota.

## Measured results

PostgreSQL, 5,000 published runs, 20 simultaneous users, real FastAPI request handling and JSON serialization. Every run includes three pass summaries and two metrics. All scenarios report **zero queries to item/event/score/attempt/trace history**.

| Scenario | Result |
| --- | ---: |
| Warm Runs page, serial median | 36.7 ms |
| Warm Runs page, 60 concurrent requests, p95 | 364.7 ms |
| First cold Runs page | 1,440.4 ms |
| 20 simultaneous cold requests, same query, p95 | 1,083.9 ms |
| 20 simultaneous cold requests, distinct filters, p95 | 1,738.7 ms |
| 200 reads while a summary revision publishes every second, p95 | 1,417.9 ms |
| Legacy list, 60 concurrent requests, p95 | 249.8 ms |

During investigation, the uncached projection path still reached 9,572.5 ms p95 with this workload (`pre-cache-results.jsonl`), even after removing source-history reads. Final measurements are in `postgres-results.jsonl`.

This is a local synthetic read-load test, not a production latency guarantee or an ingestion/backfill throughput benchmark. It seeds published summaries and pending refresh state; the live scenario commits revision changes during reads. It excludes production network/proxy latency and browser rendering. Correctness and real source backfills are covered separately on PostgreSQL and SQLite.

Reproduce against a disposable PostgreSQL database, with the repository packages and test dependencies installed:

```sh
export QYM_TEST_POSTGRES_URL='postgresql+psycopg2://USER:PASSWORD@HOST/TEST_DATABASE'
PYTHONPATH=packages/sdk:packages/platform python artifacts/runs-performance/benchmark.py
```

The script creates and drops only its own uniquely named schema. It never prints credentials.

## Validation and rollout

Validation covers publication/source parity; task versus metric errors; retries across passes and legacy events; deletion; bounded, idempotent replay; migration upgrade/downgrade; cache expiry, concurrency and publication invalidation; project permissions; browser pagination, filtering, retained selections, refresh failures and cancelled obsolete requests. See `validation.txt` for final suite results.

Migration **0050** retains published summaries and resumes existing 0049 cursors. Completed runs replay only the new numeric event stage. Failed partitions retain their failure state and are disclosed in the UI. No source data is deleted and no table/index rebuild is required. Downgrade removes only derived legacy evidence and schedules the older source replay.

Deploy the migration and API/summary worker build together. Replace the old API process before starting the migrated build; the existing Docker entrypoint runs Alembic before Uvicorn. Do not overlap old and new summary workers during this rollout: 0050 introduces a new backfill stage. Existing publications remain readable throughout the subsequent background refresh. A new import with no prior publication displays a preparing state until its first complete summary is ready. Monitor `/api/dashboard/overview` freshness (`pending_partitions`, `unpublished_runs`, `failed_partitions`, `oldest_pending_at`) for progress.

This branch has not been deployed to production.
