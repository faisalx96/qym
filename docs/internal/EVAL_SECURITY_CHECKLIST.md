# Evaluation Service integration: security checklist verification

Issue #42. This file walks the security checklist in §15 of
`EVAL_SERVICE_INTEGRATION_PLAN.md`, plus D1 and D9 from §3. For each item it names the
code that enforces it and the tests that prove it. Paths are relative to
`packages/platform/qym_platform/` (code) and `tests/platform/` (tests).

`test_eval_security_checklist.py` is the end-to-end suite for this issue. It drives the
public API, the real `EvalDispatcher`, the real `RemoteQueueSnapshotter`, and the real
`EvalServiceClient`, running against an `httpx.MockTransport` service that echoes back
every key and token it receives (D1). The per-feature tests listed below cover each
rule in isolation.

Status: **Verified** means enforced and tested. **Fixed** means a gap found by this
review and closed in #42. **Open** means documented and not fixed.

## Checklist

| # | §15 item | Enforced by | Tests | Status |
|---|---|---|---|---|
| 1a | Env keys and temporary-model keys are Fernet-encrypted at rest | `secrets.py:encrypt_llm_api_key`; `api/eval_environments.py:create_environment`, `update_environment` (`api_key_encrypted`, `api_key_last4`); `services/eval_temporary_models.py:encrypt_secrets` (→ `eval_experiments.secrets_encrypted`); `api/experiments.py:_encrypted_secrets` | `test_eval_security_checklist.py::test_keys_and_tokens_never_leak_across_launch_dispatch_ingest_cancel`; `test_eval_temporary_models.py::test_key_is_encrypted_at_launch_and_never_returned_or_stored`; `test_eval_environments_api.py::test_key_never_returned`; `test_secret_storage.py::test_connection_key_is_encrypted_and_masked` | Verified |
| 1b | Keys are never returned by the API | Environment payloads expose only `api_key_set` and `api_key_hint` (`••••last4`). Experiment, clone and queue payloads hold secret refs only (`services/eval_experiments.py:redact_secret_refs`, `api/experiments.py:strip_secret_refs`). **422 validation errors mask credential inputs** (`validation_errors.py:safe_validation_errors`, registered in `app.py:create_app`) | `test_eval_security_checklist.py::test_keys_and_tokens_never_leak_across_launch_dispatch_ingest_cancel` (every GET/POST response in the flow); `::test_validation_errors_never_echo_submitted_keys`; `test_eval_environments_api.py::test_key_never_returned`, `::test_short_key_gets_no_hint`; `test_eval_temporary_models.py::test_dry_run_validates_without_storing_or_echoing_the_key`, `::test_clone_and_presets_never_copy_the_key`; `test_experiments_api.py::test_clone_prefills_form_without_secrets` | **Fixed** (422 echo, see below) |
| 1c | Keys are never logged | `services/eval_service_client.py:redact_text` and `redact_headers` (the client logs a redacted `Authorization`, and errors are scrubbed); the dispatcher decrypts keys in memory only (`services/eval_bindings.py:resolve_slot_bindings`, `prepare_dispatch`); `EvalServiceClient.__repr__` leaves out the key | `test_eval_security_checklist.py::test_keys_and_tokens_never_leak_across_launch_dispatch_ingest_cancel` (caplog at DEBUG, all loggers); `test_eval_dispatcher.py::test_resolved_keys_and_launch_token_never_persisted_or_logged`; `test_eval_bindings.py::test_keys_never_logged_persisted_or_repr`, `::test_undecryptable_key_blocks_without_leaking`; `test_eval_service_client.py::test_error_detail_with_secret_is_scrubbed` | Verified |
| 1d | Keys never appear in `spec`, `params`, `qym_config` or copies of remote responses | `api/experiments.py:_stored_bindings`, `_named_spec_bindings`, `_qym_config`; `services/eval_experiments.py:build_qym_config`, `redact_secret_refs`; `services/eval_config.py:validate_config_document` (rejects secret literals in `env_overrides`); `services/eval_remote_queue.py:snapshot_item` (allow-list) | `test_eval_security_checklist.py::test_keys_and_tokens_never_leak_across_launch_dispatch_ingest_cancel` (dump of every row in every table); `test_eval_sweeps.py` (secrets kept out of `params`/`qym_config`); `test_experiment_launch_advanced.py::test_temporary_keys_only_appear_as_refs`; `test_eval_config.py::test_secret_literals_in_env_overrides_are_rejected`; `test_eval_queue_snapshots.py::test_snapshot_item_keeps_only_allowed_fields` | Verified |
| 2 | Environment creation is refused without `QYM_LLM_CONFIG_ENCRYPTION_KEY` (same rule as LLM connections) | `api/eval_environments.py:create_environment` and `_stored_key` (`secrets.py:encryption_available`); `services/eval_temporary_models.py:temporary_binding_errors`; `services/eval_experiments.py:_token_subkey` (`LaunchTokenUnavailable`) | `test_eval_environments_api.py::test_create_refused_without_encryption_key`; `test_eval_temporary_models.py::test_keys_need_encryption_configured`; `test_secret_storage.py::test_create_reports_missing_encryption_key`; `test_experiments_api.py::test_launch_token_changes_with_key_and_needs_one`; `test_eval_dispatcher.py::test_missing_launch_token_key_waits_instead_of_submitting` | Verified |
| 2b | The encryption key can be rotated without losing stored keys or official links (not in §15; added with the rotation support) | `secrets.py:decrypt_llm_api_key` (`MultiFernet` over `QYM_LLM_CONFIG_ENCRYPTION_KEY` then `QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS`; `encrypt_llm_api_key` uses the current key only; a malformed key is reported by setting name, never echoed); `services/eval_experiments.py:launch_token_for_job` (`expected_hash`: re-derives with each previous key and compares in constant time), passed the stored `launch_token_hash` by `services/eval_dispatcher.py:default_add_launch_token`; ingest is unchanged (`services/eval_run_linking.py` hashes the presented token); `tools/reencrypt_llm_keys.py` (idempotent, commits per batch, prints counts and row ids only) | `test_encryption_key_rotation.py` (previous-key decryption, current-key encryption, token key selection, tool dry run, idempotence, unreadable values, no secrets in output); `test_eval_dispatcher.py::test_launch_before_rotation_sends_token_matching_stored_hash`, `::test_launch_hash_matching_no_key_sends_current_token_and_logs`; `test_eval_run_linking.py::test_launch_before_key_rotation_links_official_after_it` | Verified |
| 3a | Environment URLs are HTTPS-only unless `QYM_ALLOW_PRIVATE_LLM_BASE_URLS` is set | `api/eval_environments.py:normalize_environment_url` (scheme, credentials, private literal IPs); `EvalServiceClient.__init__` re-validates | `test_eval_security_checklist.py::test_base_url_policy_for_environments_connections_and_temporary_models`; `test_eval_environments_api.py::test_https_required_unless_private_allowed`, `::test_invalid_urls_refused`, `::test_private_address_refused_by_default`; `test_eval_service_client.py::test_private_base_url_rejected_unless_allowed` | Verified |
| 3b | SSRF-safe transport (DNS pinned, no redirects) for every service call | `llm_endpoint_security.py:create_llm_http_client` (`PinnedAsyncTransport`, `follow_redirects=False`), used by `EvalServiceClient` (default factory in `services/eval_dispatcher.py:default_client_factory` and `api/eval_environments.py:get_eval_client_factory`) | `test_eval_service_client.py::test_default_client_uses_ssrf_safe_transport_and_timeouts`, `::test_allow_private_defaults_to_platform_setting`; `test_secret_storage.py::test_llm_endpoint_validation_rechecks_current_dns`, `::test_llm_transport_connects_to_the_validated_address` | Verified |
| 3c | Connection and temporary-model base URLs pass the same check (§7.5) | `api/projects.py:_validate_llm_base_url`; `services/eval_temporary_models.py:temporary_binding_errors`, `save_as_connection` | `test_eval_security_checklist.py::test_base_url_policy_for_environments_connections_and_temporary_models`; `test_secret_storage.py::test_private_llm_base_url_is_blocked_by_default`; `test_eval_temporary_models.py::test_launch_requires_the_key_and_a_safe_base_url`, `::test_private_base_url_allowed_when_opted_in` | Verified (plus HTTPS for experiments, O1) |
| 4a | Connection keys go only to environments with `allow_connection_keys` | `services/eval_bindings.py:resolve_slot_bindings` (`keys_not_allowed`), `connection_options`; `services/eval_temporary_models.py:temporary_binding_errors`; the launch refuses such a binding (422) and the dispatcher blocks one | `test_eval_security_checklist.py::test_connection_key_opt_in_is_manager_only_and_keys_follow_it`; `test_eval_bindings.py::test_keys_never_sent_without_opt_in`, `::test_model_only_slot_works_without_opt_in`, `::test_keyless_connection_works_without_opt_in`; `test_eval_temporary_models.py::test_keys_only_sent_to_environments_that_opt_in` | Verified |
| 4b | Only a manager can enable `allow_connection_keys`, and changing the URL resets it | Every environment write goes through `_require_project_manager` (`api/eval_environments.py:create_environment`, `update_environment`); `update_environment` resets the flag when `base_url` changes | `test_eval_security_checklist.py::test_connection_key_opt_in_is_manager_only_and_keys_follow_it`; `test_eval_environments_api.py::test_connection_key_opt_in_is_manager_only`, `::test_member_reads_manager_writes`, `::test_url_change_resets_connection_key_opt_in` | Verified |
| 5 | D1: `LLM_OVERRIDES.endpoints.*.api_key` is redacted in every remote response before it is stored or returned | `services/eval_service_client.py:redact_payload` (nested, plus JSON-in-string), applied in `submit`, `get`, `cancel` and `list`; `_redact_schema` for `env_overrides_schema`; `_validation_errors` drops the echoed `input`; `services/eval_remote_queue.py:snapshot_item` keeps allow-listed columns only | `test_eval_security_checklist.py::test_keys_and_tokens_never_leak_across_launch_dispatch_ingest_cancel` (the service echoes flattened `LLM_OVERRIDES`), `::test_orphan_cancel_is_manager_only_and_audited`; `test_eval_service_client.py::test_submit_202_sends_bearer_and_redacts_echoed_provider_keys`, `::test_get_redacts_structured_overrides_and_quotes_job_id`, `::test_list_passes_filters_and_redacts_every_item`, `::test_env_overrides_schema_keeps_shape_but_masks_secret_defaults`, `::test_422_preserves_loc_and_drops_echoed_input`; `test_eval_queue_snapshots.py::test_real_client_list_response_is_allow_listed`, `::test_refresh_stores_redacted_snapshot_and_queries_pending_running`; `test_eval_queue.py::test_remote_orphan_cancel_errors_are_redacted` | Verified |
| 6a | The launch token is one-time and never persisted | `services/eval_experiments.py:launch_token_for_job` (HMAC-derived, only `launch_token_hash` stored), `body_with_launch_token` (added in memory at submit); `services/eval_run_linking.py:link_official_run` (guarded claim `run_id IS NULL AND run_linked_at IS NULL`) | `test_eval_security_checklist.py::test_keys_and_tokens_never_leak_across_launch_dispatch_ingest_cancel`; `test_experiments_api.py::test_launch_token_is_derived_per_job_and_only_hash_is_comparable`, `::test_create_persists_queued_job_with_hashed_token_and_named_bindings`; `test_eval_dispatcher.py::test_submitted_body_is_stored_body_plus_launch_token`; `test_eval_run_linking.py::test_replayed_token_is_local_and_keeps_first_link`, `::test_concurrent_claim_links_exactly_one_run`, `::test_deleted_linked_run_does_not_reopen_the_job`; `test_eval_service_client.py::test_launch_token_echoed_in_eval_input_is_redacted_but_job_id_kept` | Verified |
| 6b | The token is stripped from everything ingest stores, and later merges can't add it back | `services/eval_run_linking.py:strip_launch_token`, `merge_run_metadata`; `api/ingest.py` (`create_run`, event-log payloads, `run_started`, `metadata_update`, `run_completed`) | `test_eval_run_linking.py::test_summary_merge_never_readds_token_or_changes_origin`, `::test_strip_launch_token_is_deep_and_non_mutating`, `::test_malformed_event_log_omits_input`; `test_eval_security_checklist.py::test_keys_and_tokens_never_leak_across_launch_dispatch_ingest_cancel` | Verified |
| 6c | `qym_*` run_metadata keys are reserved, and user input can't write `{{qym:` placeholders | `services/eval_config.py:validate_config_document` (`reserved_key`, `_user_placeholder_errors` → `reserved_placeholder`), used by launch, dry run and presets; `merge_run_metadata` protects the stored `qym_*` keys | `test_eval_security_checklist.py::test_user_placeholders_and_reserved_keys_are_refused_on_launch_and_presets`; `test_eval_config.py::test_qym_run_metadata_keys_are_rejected`, `::test_user_written_placeholders_are_rejected`, `::test_placeholder_in_temporary_model_and_keys_are_rejected`; `test_experiment_launch_advanced.py::test_reserved_metadata_keys_are_rejected`, `::test_api_rejects_platform_owned_and_reserved_keys`; `test_eval_run_linking.py::test_merge_run_metadata_protects_reserved_keys` | Verified |
| 7 | D9: `HIGH` is gated by the environment cap, the manager role and an explicit acknowledgement, on launch and on retry | `api/experiments.py:_resolve_priority` (the `max_priority` cap gives 422; a non-manager gets 403), `_require_preemption_ack` (422 `preemption_acknowledgement_required`), both called from `create_experiment` and `retry_experiment_job`; `api/eval_environments.py:_check_priorities` (default ≤ max; raising `max_priority` goes through the manager-only `update_environment`); `services/eval_priority.py` (warning text) | `test_eval_security_checklist.py::test_high_priority_needs_manager_cap_and_acknowledgement`; `test_experiments_api.py::test_priority_caps_and_high_gating`, `::test_high_priority_requires_preemption_acknowledgement`, `::test_high_retry_rechecks_manager_cap_and_acknowledgement`, `::test_high_retry_by_non_manager_creator_is_refused`; `test_eval_environments_api.py::test_raising_priorities_to_high_is_manager_only`, `::test_default_priority_cannot_exceed_max`; `test_eval_dispatcher.py::test_high_priority_conflict_backs_off_30s_to_5m` | Verified |
| 8a | An environment URL is bound to one project | Unique index `ux_eval_environments_active_base_url` (`db/models.py`, migration `0072_eval_environments.py`) on the normalized URL; `api/eval_environments.py:_ensure_url_available` (409 naming the owning project) | `test_eval_security_checklist.py::test_env_url_bound_to_one_project_and_foreign_ingest_stays_local`; `test_eval_environments_api.py::test_duplicate_base_url_in_other_project_names_owner`, `::test_duplicate_base_url_in_same_project_refused`, `::test_put_base_url_to_taken_url_refused` | Verified |
| 8b | Ingest never makes a run official when it arrives in another project, even with a valid token, and the environment is flagged | `services/eval_run_linking.py:link_official_run` (project check sets `health_error = "runs arriving in project X"`; the run stays `local` and the job stays unlinked) | `test_eval_security_checklist.py::test_env_url_bound_to_one_project_and_foreign_ingest_stays_local`; `test_eval_run_linking.py::test_wrong_project_is_local_and_flags_environment`, `::test_mismatch_stays_local` | Verified |
| 9 | Cancelling orphan remote jobs is manager-only and audit-logged | `api/eval_queue.py:cancel_orphan_remote_jobs` (`_require_project_manager`); `services/eval_queue.py:cancel_remote_orphans` (refuses ids that match a local job, one `AuditLog` `eval_remote_job.cancel` per id sent); local cancels are audited too (`services/eval_experiments.py:cancel_jobs` → `eval_job.cancel`) | `test_eval_security_checklist.py::test_orphan_cancel_is_manager_only_and_audited`, `::test_keys_and_tokens_never_leak_across_launch_dispatch_ingest_cancel` (two `eval_job.cancel` audit rows); `test_eval_queue.py::test_remote_orphan_cancel_is_manager_only`, `::test_remote_orphan_cancel_errors_are_redacted`, `::test_queue_permissions` | Verified |

## Gap fixed in #42

**Request validation errors echoed submitted keys.** FastAPI's default 422 handler
returns each Pydantic error's `input`. For a missing field, that input is the whole
request body. So `POST /v1/projects/{pid}/eval-environments` without a `name` sent the
plaintext `api_key` back in the response. The same thing happened with `llm_api_key`
on LLM connections, the temporary-model `secrets` on experiment launch,
`temporary_keys` on retry, and a launch token in an ingest body. Any caller who
triggers a 422 would then see the key, and so would anything that records response
bodies.

Fix: `qym_platform/validation_errors.py` registers an app-wide
`RequestValidationError` handler that keeps FastAPI's response shape
(`{"detail": [{type, loc, msg, input, ...}]}`) and masks credentials in two ways:

- when an error's `loc` names a credential field, its `input` becomes `"[REDACTED]"`;
- structured inputs go through `redact_payload`, extended with the `secrets` and
  `temporary_keys` containers.

Regression test: `test_eval_security_checklist.py::test_validation_errors_never_echo_submitted_keys`.

## Open items

- **O1 (fixed): connection and temporary-model base URLs could use plain `http://`.**
  `validate_llm_base_url` accepts public `http://` hosts, so with
  `allow_connection_keys` on, a worker could have sent a provider key to such an
  endpoint in cleartext. Models used in experiments now need `https://` unless
  `QYM_ALLOW_PRIVATE_LLM_BASE_URLS` is set (local development); root-cause-analyzer
  connections still accept public `http://`. The rule is
  `llm_endpoint_security.py:experiment_base_url_needs_https` (code `https_required`),
  applied in:
  - `services/eval_temporary_models.py:temporary_binding_errors` (launch, once per
    slot) and `save_as_connection` ("Save to project models");
  - `services/eval_bindings.py:resolve_slot_bindings`: a bound `http://` connection is a
    per-slot launch error and blocks a queued job at dispatch; a temporary model is
    re-checked at dispatch for jobs queued before the rule. A slot that maps no
    `base_url` field (model-only) never sends the URL, so it is not affected;
  - `services/eval_bindings.py:connection_options`: the model picker lists an `http://`
    connection disabled, with `reason_code: https_required`;
  - `api/projects.py:_apply_connection_key`: turning on **Available for experiments**
    for an `http://` connection answers 400; a new `http://` connection created without
    the flag is analysis-only.

  Tests: `test_eval_temporary_models.py::test_temporary_model_needs_https`,
  `::test_public_http_temporary_model_allowed_when_opted_in`,
  `::test_save_as_connection_refuses_http`,
  `::test_launch_refuses_http_project_connection_per_slot`;
  `test_eval_bindings.py::test_http_connection_is_refused_per_slot`,
  `::test_connection_without_base_url_is_not_an_https_problem`,
  `::test_http_connection_allowed_with_private_urls_opt_in`,
  `::test_http_connection_listed_disabled_in_picker`,
  `::test_http_connection_on_model_only_slot_is_allowed`,
  `::test_http_temporary_model_blocks_at_dispatch`;
  `test_secret_storage.py::test_http_connection_cannot_be_available_for_experiments`.
- **O2 (fixed): the dispatcher trusted the client to redact.** The dispatcher now runs
  `redact_payload` again on everything it stores from the service (accepted or
  reconciled remote job, polled `remote_result`, `remote_versioning`) and redacts every
  job `error`/`wait_reason`, the environment `health_error` and its poll-failure log
  line (`services/eval_dispatcher.py:_redacted_text`, `_set_status`, `_defer`). Test:
  `test_eval_dispatcher.py::test_unredacted_service_answers_are_redacted_before_storing`.
  Remaining limit: redaction is by key name and JSON-in-string, so a secret in free
  text inside a result field (e.g. a "Bearer ..." in a notes string) is not scrubbed.
