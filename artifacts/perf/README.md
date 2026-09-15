# Performance lab results (3000 synthetic runs, prod shape, local Postgres 16 / 2 GB shared_buffers)

Same seeded database before and after; see `docs/internal/PERF_LAB.md` for how to reproduce.

## Storage

| | before | after | notes |
|---|---|---|---|
| database | 58.0 GB | **26.1 GB** | −55 % |
| `run_events` | 29.2 GB | **4.3 GB** | span duplicates removed (8.6 M rows), jsonb, bigint |
| `spans` | 23.1 GB | 12.0 GB (3 monthly partitions) | 60-day retention window kept; older months dropped by partition |
| redundant indexes | 3 | 0 | |

## Request latency (p50 ms, `bench.py`, old code vs new code on the same host)

| scenario | before (published) | after | |
|---|---|---|---|
| runs list (dashboard, incl. overview, 5 concurrent) | 356 | 264 | |
| overview | 96 | 70 | |
| legacy `/api/runs` page | 288 (16,639 cold, unpublished) | 101 | |
| run open — classic (100 items) | 62 | 54 | |
| run open — 12-repeat (100 items) | 1,141 (9,921 cold) | **502** | attempts-based pass state |
| items details batch (100 items, 12 passes) | 1,167 (398 ms DB) | **628** (64 ms DB) | |
| passes panel | 615 | **95** | |
| group metrics (warm) | 15 | 13 | |
| delete run | 21 | 17 | idle worker; prod contention not reproduced locally |

`spans` / `step_latency` after-numbers are not comparable: the classic target run is older than 60 days, so its raw spans were dropped by retention (derived stats remain). Repeat-run trace loads (`item_trace`) are unchanged at ~54 ms.

## Worker

Full backfill of 3000 runs (old code): 62 min, 48 runs/min, steady. Migrations 0051–0055 on the 58 GB database: 35 s; deferred jobs: index build ~4 min, reclaim ~25 min, type rewrite 2.2 min, span copy ~15 min, legacy drop instant (24.8 GB freed).
