# Round 9, implementation A: experiment creation, one launch bar, review, priority per run, preset editor

Branch `ui/redesign9-create` (design tip 355b7e6e, `feat/experiment-key-scopes` merged first). Contract: `experiments.md`
(points 1-6 and 8). Migration **0093** `eval_experiment_jobs.priority` (chains on 0092 `api_key_kind`). Owner decisions
I1 / I2 and orchestrator decisions J2 (flag and block), J3 (keep "Set every run to"), J4 (High first within an experiment) are implemented.

## Backend (spec 11.1, 11.2, 11.6)

| Requirement | Change | Test |
|---|---|---|
| One task per experiment, per-environment pointer | `api/experiments.py` `_task_error(..., per_environment)`: a string task points at `/evaluator/task`, the old object form keeps `/evaluator/task/<envId>`; J2 is the existing `task_unsupported` 422 naming the environment | `tests/platform/test_experiment_datasets.py::test_task_unsupported_for_a_service_without_it` (pointer updated), `test_string_task_applies_to_every_environment` |
| `job_priorities` in the launch body, 422 `job_priority_unknown` | `JobPriority`, `_resolve_job_priorities` | `test_job_priority_unknown_key_is_a_422` |
| Cap per environment, manager rule | `_resolve_job_priorities` | `test_job_priority_is_capped_by_its_own_environment`, `test_job_priority_high_needs_a_project_manager` |
| Acknowledgement when any job is High, `preemption_warning` names High environments only | `_require_preemption_ack(high, names, ack)`, `_high_env_names` | `test_job_priorities_are_stored_per_job_and_counted` |
| Column, always set at launch | `EvalExperimentJob.priority`, migration `0093_job_priority.py` (Python backfill, both dialects) | `test_job_priority_migration_round_trips` (SQLite, PostgreSQL), `test_all_normal_launch_stores_the_resolved_priority` |
| Retry keeps the job's priority | retry path uses `eval_queue.job_priority(job, experiment)` | `test_retry_keeps_the_jobs_own_priority` |
| `priority` on job payloads, `priorities` counts | `_serialize_job`, `_serialize_experiment`, `_priority_counts` | `test_job_priorities_are_stored_per_job_and_counted` |
| J4 tie-break | `eval_dispatcher.priority_rank()` in the claim order and in `eval_queue.dispatch_order()` | `test_dispatch_order_submits_high_runs_first_within_an_experiment` |
| Docs | `USER_GUIDE.md`, `OPERATIONS.md` (queue order, migration table, head 0093), `RELEASE_NOTES.md`, change request 4.4 (informative, body unchanged) | `test_operations_docs_name_the_current_migration_head` |

No CLI job rows exist (`qym run list` carries runs), so the CLI is unchanged.
