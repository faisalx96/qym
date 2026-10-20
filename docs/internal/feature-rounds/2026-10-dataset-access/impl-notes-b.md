# WP-B implementation notes: experiment dataset read token and latency-sensitive runs

Branch `feat/eval-dataset-token-latency`. Spec: `spec-b.md` (130 criteria). Python of the gate: 3.11.17 (the backend code was first
written on 3.14, every Python run listed below was re-run on 3.11.17). Ports used: platform 8984, Vite 5984, fake services 9084/9085.
After-screenshots: `shots/after-{launch,detail,tokens,env}-{1440,1024,390}.png` (dark scheme, real seeded data).

## Criterion -> change -> test

| Criteria | Change | Test |
|---|---|---|
| B4-1, B4-2, B5-1, B-S14 | `migrations/versions/0088_*` (`down_revision = "0087"`), models in `db/models.py`, `docs/internal/DB_SCHEMA.md` | `tests/platform/test_migrations_0088.py` (SQLite round trip, Postgres when `QYM_TEST_POSTGRES_URL`) |
| B4-3, B4-4, B4-5 | `services/eval_dataset_tokens.py` (mint at launch, never on a dry run), hook in `api/experiments.py` | `test_eval_dataset_tokens.py::test_launch_mints_one_token_per_experiment_whatever_the_job_count`, `::test_dry_run_mints_nothing`, `::test_the_token_is_in_no_response_and_no_stored_column` |
| B4-6 | `EvalDispatcher._dataset_token_for_job` / `_submit_body` (only when the job's schema declares the key) | `::test_dispatch_injects_the_token_only_when_the_schema_declares_it`, `::test_dispatch_omits_the_token_for_a_schema_that_does_not_declare_it`; e2e `credentials.spec.ts` |
| B4-7 | `PLATFORM_OWNED_ENV_OVERRIDES`, `platform_owned_env_pointers`, descriptor `read_only`, evaluator panel `platform_owned.env_overrides`; form hides the field (`withoutPlatformOwned`) | `::test_config_cannot_set_the_token_pointer*` |
| B4-8 | `qym_dr_` pattern in `_TEXT_SECRET_PATTERNS`, `redact_payload` masks prefixed tokens in every string, `_scrub_outcome(*secrets)` | `::test_echoed_token_is_scrubbed_before_anything_is_stored`, `::test_a_polled_echo_of_the_token_is_not_stored` |
| B4-9 | `revoke_dataset_token_when_settled` in `recompute_experiment_status`; the settle sweep selects either blob | `::test_token_is_revoked_with_the_api_key_after_the_grace`, `::test_settle_sweep_selects_experiments_holding_only_a_token` |
| B4-10, B4-11 | unchanged `token_grants_project`; experiment token rows are ordinary rows | `::test_token_scope_and_revocation_against_item_reads`, `::test_a_token_reads_no_dataset_of_another_project` |
| B4-12 | `ensure_dataset_token_for_retry` next to `ensure_key_for_retry` (also mints for pre-feature experiments, D-B9) | `::test_retry_keeps_a_live_token_and_remints_after_settle`, `::test_retry_of_an_experiment_launched_before_the_feature_mints_a_token`, `::test_a_guarded_retry_that_lost_a_race_keeps_the_winners_token` |
| B4-13, B4-14 | `DatasetTokenUnavailable` blocks only a job whose schema declares the key; manual revoke idempotent for experiment tokens | `::test_unusable_token_blocks_only_when_the_schema_declares_it`, `::test_an_experiment_without_a_token_is_never_checked` |
| B4-15, B4-45, B4-46 | token list `kind`, `experiment`, newest 200 | `::test_token_scope_and_revocation_against_item_reads`, `::test_the_token_list_is_capped_at_the_newest_200` |
| B4-16, B4-17 | `credentials` and per-job `dataset_token` in the detail payload | `::test_detail_carries_credential_states_and_per_job_token_flags` |
| B4-18 | audit `eval.dataset_token_issued` / `_revoked` (settled, manual) | `::test_token_is_revoked_with_the_api_key_after_the_grace`, `::test_token_scope_and_revocation_against_item_reads` |
| B4-19, B4-20 | no launch gate; dry-run `warnings[dataset_token_not_declared]` (`services/eval_launch_flags.py`) | `::test_no_launch_gate_for_private_datasets`, `::test_dry_run_warns_when_a_private_dataset_meets_an_undeclaring_schema` |
| B4-21..B4-27 | `GET .../experiments/launch-datasets`, `DatasetPicker` badges and help (D-B17 override below) | `DatasetPicker.chips.test.tsx`, `::test_launch_datasets_lists_every_dataset_of_the_project`, e2e `latency-sensitive.spec.ts` "Dataset picker" |
| B4-28..B4-38 | `detail/Credentials.tsx` (row, one notice, the warning wins), `detail/copy.ts` | `Credentials.test.tsx`, e2e `credentials.spec.ts` |
| B4-39..B4-44 | `ApiKeysTab.tsx` Name cell (tag, link, `Experiment deleted`), revoke text | e2e `shell/dataset-read-tokens.spec.ts` |
| B5-2..B5-6, B5-14..B5-18, B5-22 | `latency_sensitive` request field, payloads, filters, gate and retry gate, clone, audit | `test_experiment_latency_sensitive.py` |
| B5-7, B5-8 | body field only when true; `latency_sensitive` in `PLATFORM_OWNED_BODY_FIELDS` | `::test_dispatcher_sends_the_field_only_when_true`, `::test_a_document_cannot_set_the_field` |
| B5-9, B5-10 | dry-run `warnings` array | `::test_ceiling_warning_*`, `::test_warnings_array_exists_in_every_dry_run` |
| B5-11, B5-12, B5-13 | `EvalDispatcher._store_admission`; payload fields | `::test_poll_stores_the_admission_state_and_noops_when_unchanged`, `::test_deferral_reason_is_redacted_and_cut`, `::test_a_contaminated_requeue_keeps_the_reason_until_the_next_attempt` |
| B5-15, B5-19 | `latency_active`; no N+1 | `::test_queue_environment_summary_reports_latency_active`, `::test_filter_statement_count_does_not_depend_on_the_flagged_rows` |
| B5-3, B5-20, B5-43..B5-48 | environment `latency_sensitive_min_role` (API + form + `copy.ts`) | `::test_environment_payload_and_role_edit`, `SettingsForm` via e2e `environments/latency-role.spec.ts`, `fieldErrors.test.ts` |
| B5-23..B5-34 | `RunSettings.tsx` block, `model/latencyGate.ts`, `launch/copy.ts` | `RunSettings.latency.test.tsx`, `latencyGate.test.ts`, e2e `latency-sensitive.spec.ts` (3 widths) |
| B5-35..B5-42 | `ReviewPane` row, blocking item (`#latency`), `LaunchWarnings` | `latencyGate.test.ts` (request, blocking item, server twin), e2e |
| B5-49..B5-58 | detail tag, `lib/admission.ts`, Status column 240 px, `↻ n` tag | `admission.test.ts`, e2e `credentials.spec.ts` |
| B5-59..B5-70 | list tag/filter, queue tag/filter/note | e2e `lists-latency.spec.ts` |
| B-S1..B-S3 | tokens only; strings in `launch/copy.ts`, `detail/copy.ts`, `environments/copy.ts` | `npm run check`, `test_design_language.py` |

## Measured numbers (Playwright, dark scheme, asserted in the specs)

- Helper under the checkbox: padding-inline-start 24 px; 1 / 2 / 4 lines at 1440 / 1024 / 390 (B5-24).
- Warning callout: 34.8 px high at 1440 and 1024, 51.6 px at 390 (B5-26). 0 px horizontal overflow at the three widths (B5-34).
- Latency-sensitive tag in the list: 98.4 x 20 px (B5-59, B5-68). Queue note: 25.4 px at 1440 (B5-65). Status column 240 px (B5-50).
- Role select 24 px high (B5-43).

Numbers of the spec that no spec asserts (card heights B5-25/B5-27/B5-28, review pane heights B5-36/B5-41, token table row heights
B4-39, Credentials section heights B4-29/B4-32, notice heights B4-34) are implemented from the mock's CSS and left to the review stage.

## Decisions and deviations

- **D-B17 override (owner decision D3)**: the launch picker lists every non-deleted dataset of the project with its badge, through
  `GET /v1/projects/{pid}/experiments/launch-datasets` (plain query, `access_mode` read with `getattr(..., "project")` until 0087).
  Recorded in `spec-b.md` section 9 (marked amended) and B4-27.
- B5-13: the service's `error` of a contaminated re-queue is kept in `job.error` while the job is not terminal and cleared on the next
  poll without it (so the status cell shows it in red, B5-52 (1)). Also in `EVAL_OPEN_QUESTIONS.md` B25.
- Errors of a dry run and of a 422 carry both `rule` (existing) and `code` (spec wording) unless they already had a `code`.
- `latency_sensitive` on the review pane's `Raw JSON` is not shown: it is not part of the editable document (B5-31).
- The launch draft is in memory (a reload resets every field, as before); B5-31's "restored from the URL reload" holds as far as the
  draft persists for every other field, i.e. it does not.
- The environment audit entry is named `eval.environment_updated` (it did not exist before); the launch entry keeps the existing name
  `eval_experiment.created` and records `latency_sensitive`.
- `test_migrations.py` still expects head `0086` and the docs name the head: 0087 belongs to WP-A, the orchestrator updates both at
  integration (the chain 0086 -> 0087 -> 0088 cannot be run on this branch alone; 0088 is tested on its own and with a throwaway copy
  pointing at 0086, which cannot run on SQLite either: the older revisions use ALTER CONSTRAINT).
- The fake Evaluation Service gained `--flags` / `POST /__control/flags` (declares both keys) and job control fields `deferrals`,
  `deferral_reason`, `admitted_at`, `contaminated_attempts`.

## Gate

All on Python 3.11.17; logs under the orchestrator scratchpad `b-logs/` (`/tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/51864cf7-e4e4-455d-967b-8153416bc257/scratchpad/b-logs/`).

| Command | Result | Log |
|---|---|---|
| `npm run check` (heavy.sh, cost 3) | pass: tsc, eslint, stylelint, 176 Vitest files / 1468 tests, design test 52 | `check3.log` |
| `npm run build` | pass | `build.log` |
| `pytest tests/platform/test_design_language.py` | 1 passed | |
| `pytest tests/platform` in 4 chunks of 48 files (cost 4) | 908 + 755 + 503 + 693 passed; failures below | `pytest-aa..ad.log` |
| `playwright test e2e/experiments e2e/environments` | 159 passed | `pw-exp.log` |
| `playwright test e2e/shell` | 98 passed, 8 skipped | `pw-shell.log` |
| `pytest tests/sdk`, `mypy packages/sdk/qym` | not run: the SDK is untouched | |
| `black --check` / `isort --profile black --check` | new files and the three formatted older files clean; other touched older files were not black-clean at HEAD and were left alone | |

Failures not caused by this branch:
- `test_migrations.py::test_alembic_revision_ids_fit_default_version_column`, `::test_alembic_has_one_upgrade_head`,
  `::test_operations_docs_name_the_current_migration_head`, `::test_migrations_name_their_own_revision_in_job_logs`: the chain
  has no revision `0087` here (WP-A), so Alembic cannot build it. They pass at integration once 0087 exists; the head tests also
  need their expected head moved to `0088` (`heads == ["0086"]`, the docs naming the head).
- `test_run_page_payloads.py::test_error_labeled_passes_read_the_same_in_full_and_compact_rows`: fails identically at the design
  commit `d136411d` (golden JSON `payload_minimize_labeled_run_full.json` out of date).
