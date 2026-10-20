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

## Fix pass (review-a.md, F1 to F7)

| # | Change | Test | Measured after |
|---|---|---|---|
| F1 A1-33/36 | `permissions.redact_item_content(payload, reason)` picks the placeholder: `DATASET_ACCESS_PLACEHOLDER` for `dataset_access`, the private-test-set text otherwise; `api/runs.py` passes `items_restricted_reason` for rows, details, reasons, spans and traces | `test_dataset_access.py` (details and run rows hold the sentence, no "private test set"); `access-identities.spec.ts` (real user with no access, run page and `POST /items/details`) | table and details read "Hidden: you don’t have access to this dataset’s items."; 0 occurrences of "private test set" on the page |
| F2 A1-33 | `ItemCard` fetches the (redacted) details for a restricted row like any other row, so the card renders | `access-identities.spec.ts` expands item #1 at 1440 and 390 | `run-item-redacted` count 1 per open item, text exact, one line (under 40 px), no "Loading item details…" |
| F3 A1-34 | same backend change; compare `OutputCard` already chose the text by reason | `access-identities.spec.ts` compare (`cohortA`/`cohortB`, `tab=items`) | the sentence is visible in the output cards, no private-test-set text |
| F4 A1-30 | amended: 244.4 at 390 (the text wraps one more line in the 279 px column) | `access.spec.ts` 403 test, tolerance 1 px at every width (189 / 189 / 244.4) | 188.98 / 188.98 / 244.4 |
| F5 A1-1 | catalog "View only" badge carries the `eye` glyph | `access.spec.ts` (card, rewritten answer) and `access-identities.spec.ts` (real view grant) | 91.5 x 20 |
| F6 A3-27 | amended: 348 px at 390 (279 was the gallery frame) | `item-state-batch.spec.ts` | 348 |
| F7 | `redesign5-bars.spec.ts:286` fails 4 of 4 on the branch, passes 4 of 4 on 38d710c5: caused by this branch (the RadioGroup gallery Case sat above the `#round5` anchor and moved it by a fractional offset). Fixed by moving that Case into its own section after the round mocks; 3 of 3 pass. `redesign3-header.spec.ts:196` ("Response has been disposed" inside the spec's own `route.fetch().json()`) is a flake that also fails on the base commit: 2 of 12 there, 3 of 12 on the branch. Left as is. | `redesign5-bars.spec.ts -g R1-3 --repeat-each 3` | pass |

The identity spec needs header auth: `QYM_E2E_AUTH_MODE=proxy_headers QYM_ADMIN_BOOTSTRAP_TOKEN=e2e-bootstrap npx playwright test e2e/datasets/access-identities.spec.ts` (it skips otherwise). Gate logs: `gate2-*.log` in the scratchpad.

Fix-pass gate (heavy.sh cost 3 each, Python 3.11.17): `npm run check` pass; `e2e/datasets` 178 passed; `e2e/compare` pass; `e2e/run-detail` 408 passed, 1 failed: `redesign2-items.spec.ts:101` (Raw radio click), a flake that also fails on 38d710c5 (2 of 20 there, 2 of 10 on the branch); the identity spec 3 passed in header-auth mode; pytest of the three WP-A files, `test_run_views`, `test_private_test_sets`, `test_design_language` pass, `test_run_page_payloads` keeps its one pre-existing failure (a float in a golden, fails on the base commit).
