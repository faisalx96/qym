# Platform Database Schema

The canonical models are in `packages/platform/qym_platform/db/models.py`; Alembic migrations are in `packages/platform/qym_platform/migrations/versions/`. PostgreSQL is required.

## Identity and projects

- `users`: global identity, active flag, and `MEMBER` / `ADMIN` role.
- `user_identities`: provider/subject mappings for OIDC and local identities.
- `local_auth_credentials`: password hashes, local-login timestamps, and the `must_change_password` flag set by an admin reset.
- `projects`: project access boundary and active/archive state.
- `project_memberships`: one `MEMBER` / `MANAGER` role per user and project.
- `api_keys`: project-bound key prefix, PBKDF2 hash, creator, recorded scopes, and revocation time. Scopes are stored but are not currently enforced.
- `project_llm_connections`: encrypted OpenAI-compatible connection settings, the project default, and `available_for_experiments` (whether the experiment model picker offers it).
- `platform_settings`: retained settings storage; current operator configuration primarily comes from environment variables.

## Evaluation Service environments and experiments

- `eval_environments`: remote Evaluation Service deployments per project (unique name per project), with a normalized `base_url`, encrypted API key + `last4`, default/max priority (`LOW` / `NORMAL` / `HIGH`), the `allow_connection_keys` opt-in, best-run ranking defaults, health fields, and `is_active` soft-disable. A partial unique index keeps an active `base_url` in exactly one project across the platform.
- `eval_environment_schemas`: immutable `env-overrides` JSON Schema history, unique per `(environment, schema_hash)`, with the cached form descriptor. `eval_environments.current_schema_id` points at the current row.
- `eval_model_slots`: proposed / confirmed / stale LLM field groupings (`endpoint` or `flat`) per schema, unique per `(schema, slot_key)`, with JSON-pointer `field_map` and `transport_fields`.
- `eval_experiments`: one launch (a sweep over one or more environments) with `environment_ids`, `base_source`, the config `spec` (secrets only as refs), Fernet-encrypted temporary-model secrets, priority (`LOW` / `NORMAL` / `HIGH`) and preemption acknowledgement, aggregate status (`QUEUED` / `RUNNING` / `COMPLETED` / `PARTIAL` / `FAILED` / `CANCELLED`), `job_count`, and cancellation fields. Deleting the project cascades.
- `eval_experiment_jobs`: one combination x one environment, unique per `(experiment, environment, combo_index)`, pinned to the schema it was validated against. Holds the redacted `params` and `request_body`, the launch-token hash, remote job id/status/result/versioning, the platform status (`QUEUED` / `SUBMITTING` / `SUBMITTED` / `RUNNING` / `SUCCEEDED` / `FAILED` / `BLOCKED` / `CANCELLING` / `CANCELLED` / `TIMED_OUT`), dispatcher lease and backoff (`lease_owner`, `lease_until`, `submit_attempts`, `next_attempt_at`), `wait_reason`, and the cancel request. Indexed on `(status, next_attempt_at)` for the dispatcher and `(environment, status)` for the queue view. `run_id` (unique, `ON DELETE SET NULL`) is set when ingest links the run. Jobs cascade with their experiment, environment and schema; the API soft-disables referenced environments instead of deleting them.
- `eval_remote_queue_snapshots`: latest redacted view of each environment's remote `PENDING` / `RUNNING` queue (one row per environment), with `fetched_at` and `fetch_error`.
- `eval_config_presets`: named config presets per environment, `kind` `official` (manager-published defaults) or `saved`, with `current_version_id` (`ON DELETE SET NULL`) and creator. A partial unique index allows at most one `official` preset per environment. Presets cascade with their environment; the API soft-disables an environment that has presets instead of deleting it.
- `eval_config_preset_versions`: immutable preset versions, unique per `(preset, version)` with `version >= 1`, holding the `schema_id` the config was authored against, the `config` document (no sweeps, secret-free `env_overrides`, `slot_bindings`), release `notes`, and `published_by_user_id` / `published_at`. Versions cascade with their preset and schema, so a project hard-delete removes them.

## Runs and repeat executions

- `runs`: project, owner, task/dataset/model, workflow state, metadata/config, progress, soft deletion, `samples` (default `1`), `origin` (`local` / `official`, default `local`, indexed; `official` only for runs linked to an experiment job at ingest), and `experiment_job_id` (`ON DELETE SET NULL`).
- `run_items`: one representative row per `(run, item)` with input, expected, latest output/error, metadata, latency, and trace links.
- `run_metric_specs`: immutable score semantics and display order per run/metric.
- `run_item_scores`: one reduced row per `(run, item, metric)`. For repeat runs, the numeric value is the mean across stored passes.
- `run_item_attempts`: retry attempts keyed by `(run, item, pass, attempt)`; the final attempt in each pass stores that pass's output and trace data.
- `run_item_pass_scores`: lossless score per `(run, item, metric, pass)`. Migration `0027_pass_score_meta` adds the per-pass `label`, `meta`, and `explanation` used for judge and metric detail.
- `run_metric_analyses`: cached repeat-analysis payloads keyed by run, metric, threshold, and method version. Score edits invalidate affected cache entries.
- `run_events`: idempotent `RunEventV1` log, unique by both `(run, event_id)` and `(run, sequence)`.
- `approvals` and `audit_logs`: run workflow decisions and mutation audit history.

## Datasets

- `datasets`: project-scoped dataset identity, description/tags, and soft deletion.
- `dataset_versions`: immutable `vN` identifier, optional display name, draft/published state, parent version, item count, and content hash.
- `dataset_aliases`: project-dataset aliases such as `production`, restricted to published versions.
- `dataset_items`: items keyed by `(version, item_id)` with input, expected output, metadata, labels, and fingerprint.
- `dataset_item_revisions`: append-only before/after item edits.
- `dataset_version_changes`: version creation, publishing, upload, clone, and alias history.

## Traces and review

- `spans`: normalized OpenTelemetry spans, unique per `(run, span_id)`.
- `run_trace_aggregates`: cached per-trace timing, token, cost, type, and error summaries.
- `root_cause_revisions`: append-only item-level root-cause/solution revisions.
- `review_corrections`: active review candidates, snapshots, confidence, source, review status/comment, and supersession links.

Published dataset versions and historical review revisions are immutable. Runs, datasets, projects, and API keys use archive, soft-delete, or revocation fields where recovery/auditability matters.
