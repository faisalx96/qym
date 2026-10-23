# WP-C implementation notes: SDK and run model (multi-dataset evaluations)

Branch `feat/multi-dataset-sdk` (from `UI-redesign` 0d725715). Spec: `spec-c.md` (136 criteria QC-1..QC-90, QC-U1..QC-U46). Ports 8998 / 5998. Migration `0089` is the first commit of the branch (`0e31388b`), alone with its model changes, so WP-D can cherry-pick it.

## 1. What was built, in build order

1. Migration `0089` + `RunDataset`, `Run.dataset_count`, `RunItem.dataset_position` (commit `0e31388b`).
2. `services/run_datasets.py` (validation, id resolution, rows, batched read payloads, SQL clauses); ingest (`CreateRunRequest.datasets`, `run_started`, `item_started` position and source link, `:upload` field).
3. Reads: run payload (`dataset_count`, `datasets`), breakdown route `GET /api/runs/{id}/datasets` (`api/run_datasets.py`), runs-list descriptor, filter, facet and search (SQLite and the PostgreSQL overview path), access across entries, dataset pages (Runs tab, counts, item history), best-run guard, insights, export header.
4. SDK: `DatasetRef`, `UnionDataset`, `resolve_datasets`, `Evaluator` (list), upload, results files, checkpoint and resume, CLI (`--dataset` repeatable, `qym run list --dataset`, `qym submit` of union files), local viewer rows.
5. UI: hero Datasets group, Datasets section, nav entry, items Dataset column and filter, runs list, compare, SDK viewer.
6. Docs: USER_GUIDE "Evaluating several datasets", RELEASE_NOTES "Platform 2.1.0 / SDK 2.1.0" (`Migrations `0089` (head `0089`)`; the integration step raises it to 0090), AGENTS.md CLI section, OPERATIONS migration row.
7. Tests (section 5) and the gate (section 6).

## 2. Criterion -> change -> test

| Id | Change | Test |
|---|---|---|
| QC-1 | `Evaluator.__init__` accepts str / `DatasetRef` / object / list; type and empty-list errors (`core/dataset.py` `_normalize_entries`) | `tests/sdk/test_dataset_ref.py` |
| QC-2 | one-entry list, `DatasetRef` and string resolve to the same object (`resolve_datasets`) | `tests/sdk/test_dataset_ref.py` `test_single_spellings_are_the_same_call`, `tests/sdk/test_platform_client_datasets.py` |
| QC-3 | frozen `DatasetRef`, `from_dict`, `parse` | `tests/sdk/test_dataset_ref.py` |
| QC-4 | strings in a list take `config.dataset_version/alias`; a ref ignores them | `tests/sdk/test_dataset_ref.py` |
| QC-5 | local path resolves to Csv/Jsonl; ref of a path with a version raises | `tests/sdk/test_dataset_ref.py` |
| QC-6 | `resolve_dataset` accepts a ref; `resolve_datasets` returns the object or a `UnionDataset` | `tests/sdk/test_dataset_ref.py` |
| QC-7 | validation at `Evaluator(...)`, loading errors before `create_run` | `tests/sdk/test_dataset_ref.py`, `tests/sdk/test_union_dataset.py` |
| QC-8 | 50-entry cap, duplicate resolved version raises at load | `tests/sdk/test_dataset_ref.py`, `tests/sdk/test_union_dataset.py`, `tests/sdk/test_cli_multi_dataset.py` |
| QC-9 | `RunSpec.dataset` takes the same forms (`multi_runner` label helper) | `tests/sdk/test_evaluator_union.py` `test_run_spec_with_a_list_runs_as_one_union_run` |
| QC-10 | `UnionDataset.get_items` loads sequentially and caches | `tests/sdk/test_union_dataset.py` |
| QC-11 | ids `name@version/raw`, raw id in `qym_item_id` | `tests/sdk/test_union_dataset.py`, `tests/sdk/test_evaluator_union.py` |
| QC-12 | `union_item_id` shortening with sha1 parts | `tests/sdk/test_union_dataset.py` `test_long_ids_are_shortened_deterministically` |
| QC-13 | `qym_*` tags on every item, overwrite warning once | `tests/sdk/test_union_dataset.py` |
| QC-14 | `dataset_item_pk` kept on the wrapped item | `tests/sdk/test_union_dataset.py`, `tests/platform/test_sdk_union_roundtrip.py` |
| QC-15 | deterministic label (`_join_label`, 120 chars, ` + N more`) | `tests/sdk/test_union_dataset.py` |
| QC-16 | `describe()` per entry | `tests/sdk/test_union_dataset.py` |
| QC-17 | disabled sums, console line unchanged | `tests/sdk/test_union_dataset.py` |
| QC-18 | empty entry kept with `items: 0` and a warning | `tests/sdk/test_union_dataset.py` |
| QC-19 | common `input_cols` or `[]` + warning | `tests/sdk/test_union_dataset.py` |
| QC-20 | union is a longer item list; concurrency, retries, passes untouched | `tests/sdk/test_evaluator_union.py` |
| QC-21 | label as `dataset_name`; file name capped for unions; `run_metadata["datasets"]` | `tests/sdk/test_evaluator_union.py` |
| QC-22 | `dataset`/`dataset_version` columns after `item_id` (csv, xlsx, checkpoint); reader ignores them | `tests/sdk/test_evaluator_union.py` `test_csv_export_has_dataset_columns_right_after_item_id`, `test_checkpoint_carries_columns_and_is_readable` |
| QC-23 | `Evaluator._verify_union_resume` | `tests/sdk/test_evaluator_union.py` `test_resume_refuses_when_a_version_moved` |
| QC-24 | resume skips completed namespaced pairs | `tests/sdk/test_evaluator_union.py` `test_resume_skips_completed_pairs_and_ends_with_the_same_counts` |
| QC-25 | live rows carry the tags (`core/progress.py`), file rows carry `item_metadata`; viewer computes from rows | `e2e/sdk-viewer/multi-dataset-viewer.spec.ts`, `src/sdk-viewer/lib/__tests__` |
| QC-26 | export template header lists the datasets as plain text | `tests/platform/test_export_template_static.py` (unchanged contract), screenshot check |
| QC-27 | `PlatformClient.create_run(datasets=)` sent only for two or more | `tests/sdk/test_platform_client_datasets.py` |
| QC-28 | `run_started` carries `datasets`; item events carry the tags | `tests/sdk/test_evaluator_union.py` `test_create_run_and_events_carry_the_datasets` |
| QC-29 | old platform ignores the unknown key (Pydantic default) | `tests/sdk/test_platform_client_datasets.py`; platform contract in `tests/platform/test_run_datasets_ingest.py` |
| QC-30 | `EvaluationResult.to_dict()` adds `datasets` for unions | `tests/sdk/test_cli_multi_dataset.py` `test_union_run_prints_datasets_in_json_and_console_lines` |
| QC-31 | `--dataset` repeatable, `DatasetRef.parse` grammar, usage errors | `tests/sdk/test_dataset_ref.py`, `tests/sdk/test_cli_multi_dataset.py` |
| QC-32 | flags are defaults for suffix-less values; single call unchanged | `tests/sdk/test_cli_multi_dataset.py` |
| QC-33 | `--dataset-file` exclusivity messages | `tests/sdk/test_cli_multi_dataset.py` |
| QC-34 | flags accepted and unused with suffixes; 50 / duplicates exit 2 | `tests/sdk/test_cli_multi_dataset.py` |
| QC-35 | one console line per entry, label line | `tests/sdk/test_cli_multi_dataset.py` |
| QC-36 | `qym run list --dataset`, `dataset_count`/`datasets` on list and get | legacy list payload in `api/runs.py`; `tests/platform/test_run_datasets_reads.py` |
| QC-37 | exit 3 / 4 for union entries, entry named in the message | `tests/sdk/test_cli_multi_dataset.py` `test_missing_entry_exits_with_not_found` |
| QC-38 | `DatasetNotFoundError` names the entry before `create_run` | `tests/sdk/test_union_dataset.py` |
| QC-39 | entry order never re-sorted | `tests/sdk/test_union_dataset.py` |
| QC-40 | SDK 2.0.0 reads the extra columns (reader ignores unknown columns) | `tests/sdk/test_evaluator_union.py` (checkpoint reader) |
| QC-41 | same as QC-29 | `tests/sdk/test_platform_client_datasets.py` |
| QC-42 | v1.3 services send `dataset` + `dataset_version`: single path untouched | `tests/sdk/test_dataset_ref.py` |
| QC-43 | `DatasetRef.from_dict` for the worker | `tests/sdk/test_dataset_ref.py` |
| QC-44 | `DatasetRef`/`UnionDataset` in `core/dataset.py`, no new dependency | import check |
| QC-45 | `DatasetLike` exported | mypy: no new errors in the new code (113 pre-existing) |
| QC-46 | USER_GUIDE section, RELEASE_NOTES, `--help` strings, AGENTS.md CLI notes | docs diff |
| QC-47 | SDK and platform versions 2.1.0 | `tests/sdk` and `tests/platform` pass |
| QC-48 | label is `dataset_name` everywhere | `tests/sdk/test_evaluator_union.py` |
| QC-49 | `0089_run_datasets.py` (SQLite inline defaults, PG DDL) | `tests/platform/test_run_datasets_migration.py` |
| QC-50 | `RunDataset`, `Run.dataset_count`, `RunItem.dataset_position` in `db/models.py` | `tests/platform/test_run_datasets_migration.py` |
| QC-51 | no rows for a single run; readers synthesise | `tests/platform/test_run_datasets_ingest.py`, `tests/platform/test_run_datasets_reads.py` |
| QC-52 | `services/run_datasets.py` `validate_entries` (422 texts, limits) | `tests/platform/test_run_datasets_ingest.py` `test_limits_and_duplicates_are_422` |
| QC-53 | `CreateRunRequest.datasets` | `tests/platform/test_run_datasets_ingest.py`, `tests/platform/test_run_datasets_consumers.py` (OpenAPI) |
| QC-54 | `create_run` stores rows, label, first-entry ids | `tests/platform/test_run_datasets_ingest.py` `test_union_run_stores_rows_ids_and_positions` |
| QC-55 | `run_started` fills the table once | `tests/platform/test_run_datasets_ingest.py` `test_run_started_fills_table_when_create_had_no_datasets_and_is_idempotent` |
| QC-56 | single entry stores no rows, takes ids | `tests/platform/test_run_datasets_ingest.py` `test_single_entry_list_stores_no_rows_and_takes_ids` |
| QC-57 | per-entry id resolution | `tests/platform/test_run_datasets_ingest.py` `test_entry_without_ids_is_resolved_by_name_and_alias`, `test_unknown_ids_store_null_and_keep_name` |
| QC-58 | `dataset_position` and the `(version, qym_item_id)` link, rows loaded once per batch | `tests/platform/test_run_datasets_ingest.py` (positions, link, constant statements) |
| QC-59 | `item_metadata` stored as sent | `tests/platform/test_run_datasets_ingest.py`, `tests/platform/test_sdk_union_roundtrip.py` |
| QC-60 | `:upload` `datasets` form field | `tests/platform/test_run_datasets_ingest.py` `test_upload_field_datasets_sets_rows_and_positions` |
| QC-61 | official-run linking untouched | no change (existing tests) |
| QC-62 | `_runs_on_datasets` checks every entry | `tests/platform/test_run_datasets_consumers.py` `test_a_union_run_is_restricted_when_any_dataset_is` |
| QC-63 | `_build_run_data` run: `dataset_count`, `datasets` | `tests/platform/test_run_datasets_reads.py` `test_run_payload_lists_datasets` |
| QC-64 | `deleted` rule in `datasets_for_runs` | `tests/platform/test_run_datasets_reads.py` `test_deleted_dataset_keeps_entry_text`, `e2e/run-detail/multi-dataset-states.spec.ts` |
| QC-65 | dashboard descriptor `dataset_count`/`datasets`; legacy list rows | `tests/platform/test_run_datasets_reads.py` `test_runs_list_rows_filter_and_facets` |
| QC-66 | dataset filter / facet / search over members (SQLite and PG paths) | `tests/platform/test_run_datasets_reads.py` `test_runs_list_rows_filter_and_facets`, `e2e/runs-list/multi-dataset-cell.spec.ts` |
| QC-67 | compare uses the same run object; item ids stay as stored | `e2e/compare/multi-dataset-notice.spec.ts` |
| QC-68 | `api/run_datasets.py` breakdown route | `tests/platform/test_run_datasets_reads.py` `test_breakdown_matches_oracle_and_weighted_mean` |
| QC-69 | four data statements, grouped queries | `tests/platform/test_run_datasets_reads.py` `test_breakdown_statement_count_does_not_grow` |
| QC-70 | same `run_means` rule; item-weighted equality | `tests/platform/test_run_datasets_reads.py`, `tests/platform/test_sdk_union_roundtrip.py` |
| QC-71 | single run answers `breakdown: false`; 404 | `tests/platform/test_run_datasets_reads.py` |
| QC-72 | `unassigned` rows | `tests/platform/test_run_datasets_reads.py` `test_unassigned_items_are_reported` |
| QC-73 | no server-side items CSV exists; the page's CSV export carries the columns (QC-U28) | see deviations |
| QC-74 | `run_has_version` / `runs_of_dataset` in the dataset Runs tab and counts | `tests/platform/test_run_datasets_consumers.py` |
| QC-75 | item history follows `dataset_item_pk`; raw-id match only for single runs | `tests/platform/test_run_datasets_consumers.py` `test_item_history_follows_the_source_item_not_the_raw_id` |
| QC-76 | `Run.dataset_count == 1` in the eligibility join; `reason: union_run` on the base | `tests/platform/test_run_datasets_consumers.py` `test_best_run_index_never_ranks_union_runs` |
| QC-77 | insights version filter/facet, dashboard combo by label | `tests/platform/test_run_datasets_consumers.py` `test_union_runs_stay_out_of_version_insights` |
| QC-78 | FK `ON DELETE CASCADE` | `tests/platform/test_run_datasets_consumers.py` (PostgreSQL), `tests/platform/test_run_datasets_migration.py` |
| QC-79 | FK `ON DELETE SET NULL`, stored text kept | `tests/platform/test_run_datasets_consumers.py` (PostgreSQL) |
| QC-80 | dict lookup per item, no statement per item | `tests/platform/test_run_datasets_ingest.py` `test_union_ingest_adds_a_constant_number_of_statements` |
| QC-81 | all of the above on PostgreSQL 16 | every new platform test with `QYM_TEST_POSTGRES_URL` |
| QC-82 | OpenAPI lists the model, the field and the route | `tests/platform/test_run_datasets_consumers.py` `test_openapi_lists_the_union_schema` |
| QC-83 | no scope, role or audit entry | no change |
| QC-84 | `GET /api/runs/{id}` is what WP-D reads | `tests/platform/test_sdk_union_roundtrip.py` |
| QC-85 | additive keys only | `tests/platform/test_run_datasets_reads.py` |
| QC-86 | no dedup of `external_run_id` | no change |
| QC-87 | table is the source of truth, `run_metadata.datasets` stored as sent | `tests/platform/test_run_datasets_ingest.py` |
| QC-88 | migration ships with the platform that reads it | docs |
| QC-89 | `dataset_count` set at creation only | `tests/platform/test_run_datasets_ingest.py` |
| QC-90 | `tests/platform/_union_run.py` builds a union run through the events API (the fixtures folder holds data files only) | used by every test above |
| QC-U1 | `RunHero` Datasets group in the context band | `e2e/run-detail/multi-dataset.spec.ts` hero test |
| QC-U2 | fact label Datasets, strip unchanged | `e2e/run-detail/multi-dataset.spec.ts` |
| QC-U3 | `DatasetCountTag` link to `#run-section-datasets` | `e2e/run-detail/multi-dataset.spec.ts` |
| QC-U4 | group first in the band, `headerChips` | `e2e/run-detail/multi-dataset.spec.ts` |
| QC-U5 | `DatasetChip` recipe | `e2e/run-detail/multi-dataset.spec.ts` |
| QC-U6 | name wraps, never cut | `e2e/run-detail/multi-dataset.spec.ts` |
| QC-U7 | chip link to the version page; deleted = span | `e2e/run-detail/multi-dataset.spec.ts`, `e2e/run-detail/multi-dataset-states.spec.ts` |
| QC-U8 | exact `+ N more` by the existing clamp | `e2e/run-detail/multi-dataset.spec.ts` clamp test |
| QC-U9 | group only for `dataset_count > 1` | `e2e/run-detail/multi-dataset-states.spec.ts` |
| QC-U10 | list / listitem semantics, axe | `e2e/run-detail/multi-dataset.spec.ts` |
| QC-U11 | `SectionKey 'datasets'`, nav entry with count | `e2e/run-detail/multi-dataset.spec.ts` |
| QC-U12 | `DatasetsSection` between Overview and Latency | `e2e/run-detail/multi-dataset.spec.ts` |
| QC-U13 | `DataTable` of the breakdown | `e2e/run-detail/multi-dataset.spec.ts` |
| QC-U14 | columns in the run's metric order | `e2e/run-detail/multi-dataset.spec.ts` |
| QC-U15 | `ScoreValue` + delta (U+2212) | `e2e/run-detail/multi-dataset.spec.ts` scores test |
| QC-U16 | summary row from the route's run totals | `e2e/run-detail/multi-dataset.spec.ts` |
| QC-U17 | `Not tagged` row | `DatasetsSection` (platform `unassigned`, covered by `test_unassigned_items_are_reported`) |
| QC-U18 | Show N sets the dataset filter and scrolls | `e2e/run-detail/multi-dataset.spec.ts` |
| QC-U19 | card mode of the `DataTable` | screenshots 390 |
| QC-U20 | skeleton cells, real dataset cells | `e2e/run-detail/multi-dataset.spec.ts` loading test |
| QC-U21 | `useDatasetBreakdownQuery`, `ErrorState` with Retry | `e2e/run-detail/multi-dataset.spec.ts` error test, `e2e/run-detail/multi-dataset-states.spec.ts` |
| QC-U22 | `Select` Dataset in `FilterBar` (+ `renderValue`) | `e2e/run-detail/multi-dataset.spec.ts` |
| QC-U23 | `activeChips` Dataset chip, count line | `e2e/run-detail/multi-dataset.spec.ts` |
| QC-U24 | Dataset and Item columns in `ItemsTable` | `e2e/run-detail/multi-dataset.spec.ts` items test |
| QC-U25 | namespaced ids are the row keys | `e2e/run-detail/multi-dataset.spec.ts` items test |
| QC-U26 | scope follows `view.dataset` | `e2e/run-detail/multi-dataset.spec.ts` Show test |
| QC-U27 | `qym_*` keys are ordinary metadata | no change |
| QC-U28 | CSV export columns (`lib/csv.ts`) | `src/features/run-detail/lib/__tests__` |
| QC-U29 | focus rings and Tab order | `e2e/run-detail/multi-dataset.spec.ts` keyboard and axe tests |
| QC-U30 | restricted banner path unchanged; filter hidden with the rows | `tests/platform/test_run_datasets_consumers.py` (access); banner code untouched |
| QC-U31 | `DatasetCell` count tag | `e2e/runs-list/multi-dataset-cell.spec.ts` |
| QC-U32 | single runs keep `DatasetTag` | `e2e/runs-list/multi-dataset-cell.spec.ts` |
| QC-U33 | column width 120 | `e2e/runs-list/multi-dataset-cell.spec.ts` |
| QC-U34 | facet lists real names, filter matches members | `e2e/runs-list/multi-dataset-cell.spec.ts`, `tests/platform/test_run_datasets_reads.py` |
| QC-U35 | search over entry names | `e2e/runs-list/multi-dataset-cell.spec.ts`, `tests/platform/test_run_datasets_reads.py` |
| QC-U36 | table keeps its own columns | screenshots |
| QC-U37 | `RunCards` Datasets fact | `e2e/compare/multi-dataset-notice.spec.ts` |
| QC-U38 | `compare-datasets-notice` | `e2e/compare/multi-dataset-notice.spec.ts` |
| QC-U39 | same set shows no notice | `e2e/compare/multi-dataset-notice.spec.ts` |
| QC-U40 | What differs lists datasets | `e2e/compare/multi-dataset-notice.spec.ts` |
| QC-U41 | single run: no group, section, column or request | `e2e/run-detail/multi-dataset-states.spec.ts` |
| QC-U42 | loading frame equals loaded | `e2e/run-detail/multi-dataset.spec.ts` |
| QC-U43 | deleted dataset keeps chip and row | `e2e/run-detail/multi-dataset-states.spec.ts` |
| QC-U44 | 12 datasets: clamp, table | `e2e/run-detail/multi-dataset-states.spec.ts`, `e2e/run-detail/multi-dataset.spec.ts` |
| QC-U45 | `sdk-viewer` Datasets table, Dataset column and filter | `e2e/sdk-viewer/multi-dataset-viewer.spec.ts` |
| QC-U46 | copy as in the spec | review |

## Gate (resumed run, 2026-10-23, partial)

Platform chunks of 24 files, `pytest -q -n 2` through `gated-heavy.sh --cost 3` on tip 1d372cab (no fix commits were needed):

| Chunk | SQLite | PostgreSQL |
|---|---|---|
| c_aa | 517 passed, 101 skipped | not re-run |
| c_ab | 387 passed, 116 skipped | not re-run |
| c_ac | 569 passed, 156 skipped | not re-run |
| c_ad | 293 passed, 90 skipped | not re-run |
| c_ae | 295 passed, 92 skipped | not re-run |
| c_af | 227 passed, 63 skipped | not re-run |
| c_ag | 370 passed, 80 skipped | not re-run |
| c_ah | 329 passed, 91 skipped | 419 passed, 1 skipped (the search-index job test passes) |
| c_ai | 74 passed, 23 skipped | not re-run |

`tsc --noEmit` in frontend/: clean. The after-screenshots are present in `shots/`.

Not run on the final code in this pass (swap stayed at 0 free, held by desktop apps, for over 30 minutes, so the memory rule blocked every further heavy run): PostgreSQL chunks c_aa..c_ag and c_ai (they passed on the earlier tip before 1d372cab, which only touches the dataset-name search), `pytest tests/sdk`, `test_design_language.py`, `npm run check`, `npm run build`, `npm run build:sdk` and the Playwright specs.
