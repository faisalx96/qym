# WP-A implementation notes (datasets: access, disabled items, batch edits)

Branch `feat/dataset-access`, base design commit 60700f4a. Python for every pytest run below: 3.11.17 (the project venv after the switch).

## Decisions beyond the spec
- Access level resolves in `permissions.dataset_access_levels` (one grants query per page). `_get_dataset(db, project, ref, principal, need, read_token=)` enforces it on every dataset route; a dataset read token lifts `none` to `view` there (item reads only), `_require_items_visible` keeps the private-test-set rule.
- `hidden_dataset_run_ids` / `run_item_hidden_reasons` generalise the private-test-set redaction; `can_view_run_items` and `hidden_item_run_ids` keep their names, so every existing redaction site inherits the rule. The run payload gains `items_restricted_reason`.
- `GET /v1/datasets?include_inaccessible=true` lists restricted datasets the caller cannot open (WP-B's launch picker, owner decision D3).
- `content_hash` adds `"disabled": true` per disabled item only, so versions without disabled items keep their digest.
- Revisions of `disabled` / `enabled` carry `item_id` next to `disabled` and `reason` (compare and lineage match by item id).
- Batch on selected rows (`Disable N…`, `Enable N`) sends `item_ids` with `state: "all"`: the answer's `affected` says how many changed.
- Facets cache key is (item count, newest item write) per version: any item write invalidates it, in every process.
- Viewer states in the browser cannot be produced under `QYM_AUTH_MODE=none` (everyone is the dev admin): `access.spec.ts` rewrites the platform's answer to a viewer's (permissions, access payload, 403, run restriction flag). The real rules are pytest-pinned in `test_dataset_access.py` with proxy-header users.

## Criterion -> change -> test
| Criteria | Change | Test |
|---|---|---|
| A1-37 to A1-60 | `permissions.py`, `api/datasets.py` (`/access` routes, `_get_dataset`, payload `permissions`, catalog clause), `api/runs.py`, migration 0087 | `tests/platform/test_dataset_access.py` (29 cases) |
| A1-1 to A1-4 | `catalog/CatalogPage.tsx` badge cluster, wrapped name | `e2e/datasets/access.spec.ts` (catalog) |
| A1-5 to A1-24 | `ui/RadioGroup`, `detail/AccessSection.tsx`, `SettingsTab.tsx` | `AccessSection.test.tsx` (10), `access.spec.ts` (Settings, 15 cases) |
| A1-25 to A1-31 | `DatasetDetailPage.tsx` per-dataset read-only, View only badge, 403 page | `access.spec.ts` (viewer) |
| A1-32 to A1-36 | `RunHero.tsx`, `ItemCard.tsx`, `OutputCard.tsx`, `permissions.py` | `access.spec.ts` (run), `test_dataset_access.py` |
| A2-1 to A2-12 | `ItemsTab.tsx` state control, counts, rows, empty states | `item-state-batch.spec.ts`, `itemState.test.ts` |
| A2-13 to A2-35 | `ItemPane.tsx`, `ItemPage.tsx`, `ItemStateUi.tsx`, `dialogs.tsx` (`DisableItemDialog`) | `item-state-batch.spec.ts` (pane, page, dialog) |
| A2-36 to A2-48 | `DatasetDetailPage.tsx`, `VersionSwitcher.tsx`, `PublishDialog`, `ItemHistoryTab.tsx`, `DatasetComparePage.tsx`, `LineageTab.tsx` | `item-state-batch.spec.ts` (version, history, compare) |
| A2-49 to A2-66 | `api/datasets.py` state routes and reads, `dataset_versions.py`, migration | `tests/platform/test_dataset_item_state.py` (22), SDK `test_native_datasets_sdk.py` |
| A3-1 to A3-14 | `MetadataFilter.tsx`, `lib/metaFilter.ts` | `item-state-batch.spec.ts`, `metaFilter.test.ts` |
| A3-15 to A3-26 | `ItemsTab.tsx` All matching, `ItemsWorkspace.tsx` selection actions | `item-state-batch.spec.ts` |
| A3-27 to A3-42 | `BatchDialog.tsx`, `lib/batchCopy.ts` | `item-state-batch.spec.ts` (batch), `batchCopy.test.ts` |
| A3-43 to A3-64 | `services/dataset_meta.py`, `items:batch`, `items:metadata-facets` | `tests/platform/test_dataset_items_batch.py` (incl. Postgres cases behind `QYM_TEST_POSTGRES_URL`) |

Measured numbers that match the spec: access section 618.8 / 995.7, mode row 53.6 / 69, add row 43.4 / 75.4, state control 202.9 x 24, toolbar 40 / 65 / 161, Metadata 98 x 24, All matching 108 x 24, published entry 179 x 24, card head 96. Amendments are in `spec-a.md` section 11.

After-screenshots: `shots/after-*.png` (catalog, access, toolbar, batch dialog, item pane and page, metadata popover).

## Gate
All runs through `scripts/heavy.sh` on Python 3.11.17 (logs under the scratchpad `/tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/51864cf7-e4e4-455d-967b-8153416bc257/scratchpad`):
- `npm run check` (cost 3): pass (`gate-check.log`); `npm run build` (cost 2): pass (`gate-build.log`).
- `pytest tests/platform` in four 48-file chunks (cost 4, `gate-pytest-aa..ad.log`): all pass except `test_run_page_payloads.py::test_error_labeled_passes_read_the_same_in_full_and_compact_rows` (float noise 0.39999999999999997 vs 0.4000000000000001 in a golden), which fails identically on the base commit 38d710c5.
- `pytest tests/sdk` (cost 3): 498 passed. `mypy packages/sdk/qym`: the same 192 lines before and after (no new errors).
- Playwright `e2e/datasets` (all 177 specs, cost 3, `gate-e2e-folder.log`): pass, including `access.spec.ts` and `item-state-batch.spec.ts`. The Evaluation Service stand-ins were left out of the run (their ports clash with the other worktree's).
- `black` and `isort` disagree on the repo's existing files; the new files are isort-clean.
