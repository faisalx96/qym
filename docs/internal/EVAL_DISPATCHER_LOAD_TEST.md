# Eval dispatcher: multi-pod lease test and load test (issue #40)

Plan references: §13 (dispatcher and status model), §13.1 (cancel from the queue),
§16 P6 (hardening). Run on 2026-09-30 on branch `feat/eval-issue-40-multipod-tests`.

## What was tested

Several `EvalDispatcher` instances ("pods") ran against one database. Each had its own
engine, its own sessions, its own lease owner id and its own thread. A thread-safe fake
Evaluation Service recorded every call and injected faults:

| Fault | Service behaviour | Expected dispatcher behaviour |
|---|---|---|
| `timeout` | Creates the job, then the client times out | Stays `SUBMITTING`, reconciles after at least one lease length, adopts the remote job |
| `5xx` | 503 before creating anything | Stays `SUBMITTING`, reconciles, finds nothing, resubmits once |
| `high` | 409, HIGH job active | Back to `QUEUED` with the 30s → 5m backoff |
| `crash_before_post` | Pod dies after the `SUBMITTING` marker, before the POST | Lease expires, another pod reconciles and resubmits once |
| `crash_after_accept` | Pod dies after the service created the job | Lease expires, another pod reconciles and adopts the job |
| `list_5xx` | Reconcile `GET /evals` fails | Stays `SUBMITTING`, retries later |
| `cancel_5xx` | `POST /evals/{id}/cancel` fails | Stays `CANCELLING`, retries with backoff |
| latency | 0 to 5 ms (50 ms in two runs) per POST | Widens the claim → submit → record window |

Every run checked these invariants:

- **No double submit.** Each qym job has exactly one remote job, matched by
  `qym_launch.job_id`, however many POSTs it took.
- **No double cancel.** No remote job received a cancel after it was already
  cancelled, and each remote job was cancelled successfully at most once.
- **Inflight cap never exceeded.** Checked in two places. The fake checks on every
  change: remote `PENDING`/`RUNNING` jobs plus POSTs in progress for that environment
  must stay within the cap. A sampler thread also polls the database every ~2 ms while
  the pods run: `SUBMITTING`, `SUBMITTED`, `RUNNING` and `CANCELLING` jobs per
  environment must stay within the cap.
- **Everything settles.** Every job ends in a terminal state, no job is left with a
  lease, and the experiment's aggregate status is final (`COMPLETED`, or `PARTIAL` in
  the cancel test).

Time is a shared fake clock. It is frozen while the pods run one round (each pod ticks
once, all released together by a barrier) and advances 15s between rounds. Between
rounds the fake service moves its jobs `PENDING → RUNNING → SUCCEEDED` at random.
Freezing the clock during a round means a lease never expires while its owner is
mid-call. Production has the same guarantee because `LEASE_SECONDS` (120s) is well
above the client timeout (5s connect plus 30s read). The harness does not test a POST
that runs longer than the lease; nothing prevents a double submit in that case.

The sweep is the issue's 64-job shape: one experiment, 2 environments × 32 combos,
`max_inflight_jobs = 4` per environment (8 in two runs). The rows are seeded directly
in the same form a sweep launch (#32) writes them, not through the HTTP API.

## Environment

- Intel Core i7-14700 (28 threads), Linux 6.11, Python 3.12.3, SQLAlchemy 2.x.
- SQLite: one file database; each pod has its own engine (`timeout=60`).
- PostgreSQL 16 in a throwaway `postgres:16` container (podman 4.9.3), psycopg2. Each
  pod has its own engine and pool, and each run uses its own schema.

## Results (load test script)

`python tests/platform/eval_dispatch_loadtest.py --workers K [--faults] [--cap N] [--latency-ms M] --json`,
64 jobs. Tick times are per pod tick (one claim plus every step for up to `batch`
jobs). "Rounds" × 15s is the simulated time to drain the sweep.

| Backend | Pods | Batch | Cap | Faults | Rounds | Wall | Tick p50 / p95 / max (ms) | POSTs | Remote jobs | Duplicates | Max attempts | Reconcile lists | Crashes | Max remote / DB inflight per env | Final |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SQLite | 4 | 4 | 4 | no | 96 | 4.9s | 22 / 63 / 113 | 64 | 64 | 0 | 1 | 0 | 0 | 4, 4 / 4, 4 | 64 SUCCEEDED, COMPLETED |
| SQLite | 4 | 4 | 4 | yes | 128 | 6.3s | 23 / 65 / 101 | 83 | 64 | 0 | 3 | 18 | 4 | 4, 4 / 4, 4 | 64 SUCCEEDED, COMPLETED |
| SQLite | 8 | 4 | 4 | no | 88 | 9.1s | 34 / 119 / 261 | 64 | 64 | 0 | 1 | 0 | 0 | 4, 4 / 4, 4 | 64 SUCCEEDED, COMPLETED |
| SQLite | 8 | 4 | 4 | yes | 104 | 10.6s | 35 / 117 / 200 | 82 | 64 | 0 | 3 | 14 | 2 | 4, 4 / 4, 4 | 64 SUCCEEDED, COMPLETED |
| Postgres | 4 | 4 | 4 | no | 49 | 2.5s | 46 / 75 / 89 | 64 | 64 | 0 | 1 | 0 | 0 | 4, 4 / 4, 4 | 64 SUCCEEDED, COMPLETED |
| Postgres | 4 | 4 | 4 | yes | 77 | 3.8s | 41 / 69 / 87 | 84 | 64 | 0 | 4 | 18 | 7 | 4, 4 / 4, 4 | 64 SUCCEEDED, COMPLETED |
| Postgres | 8 | 4 | 4 | no | 55 | 4.2s | 73 / 118 / 229 | 64 | 64 | 0 | 1 | 0 | 0 | 4, 4 / 4, 4 | 64 SUCCEEDED, COMPLETED |
| Postgres | 8 | 4 | 4 | yes | 65 | 5.1s | 70 / 126 / 209 | 79 | 64 | 0 | 3 | 17 | 6 | 4, 4 / 4, 4 | 64 SUCCEEDED, COMPLETED |
| Postgres | 16 | 4 | 4 | no | 43 | 5.2s | 33 / 197 / 404 | 64 | 64 | 0 | 1 | 0 | 0 | 4, 4 / 4, 4 | 64 SUCCEEDED, COMPLETED |
| Postgres | 16 | 4 | 4 | yes | 88 | 7.2s | 8 / 161 / 393 | 77 | 64 | 0 | 3 | 20 | 8 | 4, 4 / 4, 4 | 64 SUCCEEDED, COMPLETED |
| Postgres | 32 | 4 | 4 | no | 42 | 5.7s | 14 / 216 / 418 | 64 | 64 | 0 | 1 | 0 | 0 | 4, 4 / 4, 4 | 64 SUCCEEDED, COMPLETED |
| Postgres | 32 | 4 | 4 | yes | 80 | 7.9s | 12 / 160 / 400 | 86 | 64 | 0 | 5 | 16 | 7 | 4, 4 / 4, 4 | 64 SUCCEEDED, COMPLETED |
| Postgres | 16 | 4 | 8 | yes, 50 ms | 42 | 4.8s | 9 / 185 / 425 | 79 | 64 | 0 | 3 | 14 | 7 | 7, 7 / 8, 8 | 64 SUCCEEDED, COMPLETED |
| Postgres | 32 | 1 | 8 | yes, 50 ms | 69 | 6.5s | 12 / 177 / 549 | 85 | 64 | 0 | 6 | 23 | 3 | 8, 8 / 8, 8 | 64 SUCCEEDED, COMPLETED |

With faults on, the per-POST probabilities were `timeout` 8%, `5xx` 8%, `high` 8%,
`crash_before_post` 3%, `crash_after_accept` 3% and `list_5xx` 5%. In every run, the
number of POSTs above 64 is the retries after `5xx`, `high` and crashes before the POST.
No run exceeded a cap, had a pod error or created a second remote job for any qym job.
With 50 ms of POST latency, up to 8 POSTs were in flight at once across the pods, and
the caps still held.

Reading the numbers:

- Wall time is dominated by lock waits, not the fake service. On SQLite, extra pods
  only queue on the database write lock: 8 pods are slower than 4 and never faster. On
  Postgres, 4 to 32 pods drain the sweep in about the same simulated time, because
  the caps (8 slots in all) are the bottleneck, not the pods. Tick p95 rises with the
  number of pods (contention on the environment row lock during submit, and on the
  experiment row lock described below), but stays well under 1s.
- The number of reconcile lists matches the ambiguous outcomes (timeouts, 5xx and
  crashes). Every one of those went through `GET /evals?user_id=…` before any
  resubmit.

Reproduce:

```bash
python tests/platform/eval_dispatch_loadtest.py --workers 8 --faults
QYM_TEST_POSTGRES_URL=postgresql+psycopg2://postgres:pw@127.0.0.1:55440/qym \
  python tests/platform/eval_dispatch_loadtest.py --workers 16 --faults
```

The script exits 1 if any invariant fails.

## Pytest suite

`tests/platform/test_eval_dispatcher_concurrency.py` (harness:
`tests/platform/eval_dispatch_loadtest.py`). Each test runs on SQLite, and on Postgres
when `QYM_TEST_POSTGRES_URL` is set. SQLite uses 4 pods and Postgres uses 8, because
more threads on SQLite only queue on its write lock.

| Test | Scenario | Default suite |
|---|---|---|
| `test_pods_never_double_submit_and_never_exceed_the_cap` | 16 jobs, 2 envs, cap 3. Timeouts after accept, 5xx, 409 HIGH, list 5xx, latency | yes (~2s) |
| `test_crashed_pods_leave_submitting_jobs_that_reconcile_without_duplicates` | Pods crash before and after the service accepted. Restarted with new owners | yes (~2s) |
| `test_queue_cancel_racing_pods_never_double_cancels` | Bulk cancel of one environment in three rounds (the same ids each time) while pods submit and poll. Cancel 5xx | yes (~1s) |
| `test_sibling_jobs_settling_at_once_complete_the_experiment` | Regression for the bug below | yes (<1s) |
| `test_64_job_sweep_across_two_environments[clean/faults]` | The 64-job sweep with 8 pods (SQLite) or 16 pods (Postgres) | `slow`: only with `QYM_TEST_SLOW=1` (SQLite ~10-60s depending on lock contention, Postgres ~5-10s) |

Last full run (SQLite and Postgres 16, `QYM_TEST_SLOW=1`): 12 passed. Without
Postgres and the slow flag, the default suite runs the 4 SQLite tests in about 6s.
The fast tests passed 5 times in a row on both backends.

## Bug found and fixed: experiment status stuck at RUNNING (Postgres)

`recompute_experiment_status` read the experiment's jobs without locking anything. On
Postgres (READ COMMITTED), two pods settling the last two jobs of an experiment in
overlapping transactions each saw the other's job as still running. Both computed
`RUNNING`, and the experiment stayed `RUNNING` with every job `SUCCEEDED`. Nothing
recomputes it later, because no job is left to tick. SQLite was not affected, because
its write lock serializes the two transactions.

Fix (`services/eval_dispatcher.py`, `recompute_experiment_status`): on Postgres, the
dispatcher now locks the experiment row (`SELECT … FOR UPDATE`, reloaded) before it
reads the jobs. A second pod waits for the first to commit and then reads its committed
job. Lock order is always job row, then environment row (submit only), then experiment
row, so the lock adds no deadlock. The regression test reproduces the interleaving
deterministically: one transaction stays open while a second pod settles its job in
another thread. It fails without the fix (`RUNNING`) and passes with it.

The API's own recompute (`eval_experiments.recompute_experiment_status`, used by
`cancel_jobs` and the experiments endpoints) still reads without the lock. A queue
cancel racing a dispatcher that settles the last sibling job can still leave a stale
aggregate. The same lock in the shared function would close that too. It was not
changed here, to keep this fix within the dispatcher.

## Not bugs, but worth knowing

- **No double submit or cap overrun was found.** The compare-and-set lease, the
  `SUBMITTING` marker, the cap check inside the conditional `UPDATE` (under the
  environment row lock on Postgres) and reconcile-before-resubmit held in every run.
- `tests/platform/test_eval_queue.py::test_cancel_between_claim_and_submit_never_submits`
  hangs on Postgres. The test calls `cancel_jobs` from inside the dispatcher's
  `add_launch_token` hook, on the same thread, while the dispatcher's transaction holds
  `FOR UPDATE` on that job row, so the test deadlocks itself. In production the API
  request waits for the dispatcher's short transaction to end. The test only runs on
  SQLite in the default suite. It needs a second thread, or a SQLite-only mark, to run
  on Postgres.
- Safety relies on `LEASE_SECONDS` (120s) staying above the Evaluation Service client
  timeout (35s). If a longer client timeout is ever configured, raise the lease with
  it.
