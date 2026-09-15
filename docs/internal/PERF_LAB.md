# Performance lab

A production-shaped Postgres you can seed, benchmark and break locally. Everything
lives in `packages/platform/qym_platform/tools/perf/` and ships in the platform
image, so the same `db_stats` code runs inside a deployed pod.

## 1. Start Postgres

```bash
docker compose -f docker/docker-compose.perf.yml up -d db-perf          # tuned (2 GB shared_buffers, auto_explain)
docker compose -f docker/docker-compose.perf.yml --profile stock up -d db-perf-stock   # stock defaults, like prod today
export PGURL=postgresql+psycopg2://qym:qym@localhost:15433/qym_perf     # stock: port 15434
alembic -c packages/platform/qym_platform/migrations/alembic.ini upgrade head   # with QYM_DATABASE_URL=$PGURL
```

`docker/postgres/perf.conf` enables `pg_stat_statements` and `auto_explain`
(plans for anything over 250 ms land in `docker logs qym-db-perf`).

## 2. Seed prod-shaped data

```bash
python -m qym_platform.tools.perf.synth --url $PGURL --scale 0.25 --legacy-dup-spans --label baseline --reset
```

| flag | meaning |
|---|---|
| `--scale` | fraction of production's ~3000 runs. `0.25` ≈ 14 GB in ~20 min; `1.0` ≈ 55 GB in ~80 min |
| `--legacy-dup-spans` | also store every span as a `span_completed` row in `run_events` (what production did before the fix) |
| `--reset` | delete everything the tool created before (`perf-*` ids) |
| `--seed` | deterministic content; same seed → same bytes |

Shape defaults mirror production: 11 projects, 12 users, 50–100 items/run, 3–5 LLM-judged
metrics, 15 % repeat runs (k ∈ 3/5/8/12), agentic traces with 10–40 spans per item where
every LLM turn re-sends the whole conversation (the O(n²) growth), one judge span per metric,
90 % COMPLETED / 5 % FAILED / 5 % RUNNING, 9 months of history. One API key per project;
tokens are written to `artifacts/perf/<label>/manifest.json`.

The seeded runs have **no dashboard partition rows**, so starting the platform makes the
summary worker backfill all of them — exactly the state production was in after
migrations 0049/0050.

## 3. Where the bytes are

```bash
python -m qym_platform.tools.perf.db_stats --url $PGURL            # table/TOAST/index sizes, run_events by type, spans by scope
python -m qym_platform.tools.perf.db_stats --url $PGURL --json     # for the admin endpoint / scripts
```

## 4. Run the platform against it

```bash
QYM_DATABASE_URL=$PGURL QYM_AUTH_MODE=none QYM_ENVIRONMENT=dev QYM_REQUEST_TIMING=1 \
  uvicorn qym_platform.main:app --port 8010
```

`QYM_REQUEST_TIMING=1` adds a `Server-Timing` header (`app`, `db`, `db-count`) to
every response and logs one line per request. `QYM_ROLE=api` starts the API without
the summary worker; `QYM_ROLE=worker` runs only the worker.

The repo's own `.env` is auto-loaded by `PlatformSettings`; pass the variables above
explicitly so a local OIDC config does not leak into the lab.

## 5. Benchmark

```bash
python -m qym_platform.tools.perf.bench --base-url http://localhost:8010 --url $PGURL --label baseline
python -m qym_platform.tools.perf.bench ... --scenarios worker_drain          # resets partitions, times the refill
python -m qym_platform.tools.perf.live_stream --base-url http://localhost:8010 --api-key <token> --runs 5 --items 80
```

`bench` picks its targets from the database (the largest classic run, the repeat run
with the most passes, …) so every label measures the same shapes. Results append to
`artifacts/perf/<label>/bench.jsonl`; a Markdown table prints on stdout.

`live_stream` drives the real SDK `PlatformEventStream` (200 events / 2 MB / 0.25 s
batches, heartbeats) with the same span payloads — ingest load without any LLM.

## 6. Query budgets in tests

`qym_platform.testing.query_budget` records every statement an engine executes:

```python
with record_queries(engine) as log:
    client.get(f"/api/runs/{run_id}")
assert_no_source_scan(log)                       # no run_events/run_items/spans/...
assert_query_budget(log, max_statements=25)      # prints the offending SQL on failure
```
