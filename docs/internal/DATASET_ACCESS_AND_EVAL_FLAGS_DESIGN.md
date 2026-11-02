# Dataset access, item deactivation, batch edits, per-experiment dataset token, latency-sensitive runs

Status: DELIVERED 2026-10-20 (owner decisions in section 8; specs, reviews and the integration gate under `docs/internal/feature-rounds/2026-10-dataset-access/`). Base: `UI-redesign` at `00a01df4`.
Integration guide: `docs/evaluation-service-api-integration-v1.3.md` (§2.2 latency-sensitive, §4.3 `QYM_DATASET_READ_TOKEN`, §4.4 `qym_api_key`).

Five features, two work packages:

| WP | Feature | Backend | UI |
|---|---|---|---|
| A | 1. Per-dataset permissions (view / modify) | `dataset_grants` table, `datasets.access_mode`, permission helpers, access routes | Dataset Settings "Access" section, catalog chips, per-dataset read-only plumbing |
| A | 2. Deactivate items temporarily | `dataset_items.disabled_*`, `state` filter on item reads, enable/disable routes, revisions | Items tab state filter + chips, item pane / item page actions and banner |
| A | 3. Batch edit by metadata | metadata filter on item list, `items:batch` action route, metadata facets route | Metadata filter in the items toolbar, "Apply to all N matching" bulk menu with dry-run confirm |
| B | 4. Per-experiment dataset read token | `eval_dataset_tokens` service (mirror of `eval_submitter_keys`), 2 columns on `eval_experiments`, dispatcher injection, revoke on settle | Experiment detail "Credentials" row, token list shows experiment tokens |
| B | 5. Latency-sensitive runs | `eval_experiments.latency_sensitive`, request field, dispatcher body field, env cap, review warnings | Launch "Run settings" switch, review pane row, detail / list / queue tags, job deferral status |

Migrations: `0087_dataset_access_and_item_state` (WP-A), `0088_eval_experiment_dataset_token_latency` (WP-B). Head today is `0086`.

---

## 1. Per-dataset permissions (view, modify)

### 1.1 Today
- Every active project member can read and write every dataset of the project (`datasets:read` / `datasets:write` scopes on API keys, `has_project_access` for UI users).
- Project **managers** and platform **admins** additionally rename slugs, move `production`, restore and delete (`_can_manage_datasets`).
- `private_test_set` (migration 0079) hides **item contents** from non-admins; the dataset, its versions and run scores stay visible. An admin-issued **dataset read token** (0082) lifts that block on item reads for a service.

### 1.2 Model
```
datasets.access_mode   VARCHAR(16) NOT NULL DEFAULT 'project'   -- 'project' | 'restricted'

dataset_grants
  id                  INTEGER PK
  dataset_id          FK datasets.id ON DELETE CASCADE, indexed
  user_id             FK users.id ON DELETE CASCADE, indexed
  level               VARCHAR(16) NOT NULL   -- 'view' | 'modify'
  granted_by_user_id  FK users.id ON DELETE SET NULL
  created_at, updated_at
  UNIQUE (dataset_id, user_id)
```
Grants are per **user** (project members only). No role-level grants in v1. `access_mode = 'project'` is the **public** mode the owner asked for: every member of the project has full view and modify (the default, and what every existing dataset gets). Nothing crosses project boundaries.

### 1.3 Semantics (`permissions.py`)
`dataset_access_level(db, principal, dataset) -> 'none' | 'view' | 'modify' | 'manage'`:

| Principal | `access_mode = project` | `access_mode = restricted` |
|---|---|---|
| Platform admin, project manager | manage | manage |
| Dataset creator | modify (+ delete, as today) | modify (+ delete) |
| Project member with a grant | — | the grant's level |
| Project member without a grant | modify | **none** |
| API key | the key owner's level (scopes still apply) | the key owner's level |
| Dataset read token (item reads only) | — | lifts `none` to `view` for item reads of its project |

What each level allows:
- **none**: the dataset is absent from the catalog, `GET /v1/datasets/{ref}` and every sub-route answer **403** `"You don't have access to this dataset"` (403 not 404: the UI shows a clear message; slugs are not secret inside a project).
- **view**: catalog, detail, versions, items (subject to `private_test_set`), runs tab, compare, lineage, download. No writes.
- **modify**: everything `view` plus items, versions, aliases (except `production`), name, description, tags.
- **manage**: everything plus slug, `production`, restore, delete, **access settings**.

`private_test_set` stays orthogonal: a viewer of a private test set still sees no item contents (admins only), exactly as today.

Runs evaluated on a restricted dataset: the run stays listed and its scores visible (as with private test sets); **item contents are redacted** for users with level `none`, reusing `redact_item_content` / `hidden_item_run_ids` (extend `private_test_set_run_ids` to a per-principal `hidden_dataset_run_ids`). Owner question Q1 below offers the alternative (hide the run entirely).

### 1.4 API
```
GET  /v1/datasets/{ref}/access                     -> {access_mode, grants:[{user:{id,name,email}, level, granted_by, created_at}], can_manage_access, candidates:[project members not granted]}
PUT  /v1/datasets/{ref}/access                     body {access_mode, grants:[{user_id, level}]}   (full replace, manage only, audited "dataset.access_changed")
```
`_dataset_payload.permissions` gains `access_level`, `can_view_items`, `can_modify`, `can_manage_access`; the catalog payload gains `access_mode` and `grant_count`. `_dataset_payloads` resolves levels for a page of datasets with one grants query.

Enforcement: a single `_require_dataset_access(db, principal, dataset, level)` replaces the current implicit "member = writer" on every dataset route (`write=True` routes need `modify`, slug/production/restore/delete need `manage`). `_get_dataset` returns 403 for `none`. The catalog query joins grants for non-manager principals.

### 1.5 UX
- **Dataset → Settings → "Access"** (new section between Visibility and Danger zone; managers only, others see a read-only summary):
  - Radio: "Everyone in the project can view and modify" / "Only people listed below".
  - When restricted: a compact table "Person · Level (View | Modify) · Added by · Remove", a member picker (`candidates`) with a level select, and a note "Project managers, admins and the creator always have full access."
  - Save applies the full list (one PUT); toast; audit entry visible in the existing dataset history.
- **Catalog**: a `Chip` "Restricted" after the name for `access_mode = restricted`; rows the user cannot view are not returned at all.
- **Detail page**: `readOnly` becomes per dataset (`dataset.permissions.can_modify`), so viewers get the same read-only experience that archived projects give today (edit affordances hidden, not disabled).
- **Run pages**: redacted item contents reuse the private-test-set placeholder ("Hidden: you don't have access to this dataset's items").

---

## 2. Deactivate items temporarily

### 2.1 Model
```
dataset_items.disabled_at          DATETIME NULL
dataset_items.disabled_by_user_id  VARCHAR(36) NULL
dataset_items.disabled_reason      VARCHAR(500) NOT NULL DEFAULT ''
index (dataset_version_id, disabled_at)
```
- **Draft versions only** (owner decision D2): toggling goes through `_require_draft` like every other item edit, and takes effect when the draft is published. Published versions stay fully immutable, flag included. The flag is excluded from `fingerprint` and `search_text`; `content_hash` **includes** it (two published versions that differ only in disabled items are different versions); compare shows it as a separate "state" column and the lineage change counts gain `disabled`/`enabled`.
- `_copy_items` (new draft from a parent) **copies the flag**, so a disabled item stays disabled in later versions until someone enables it in a draft.
- Each toggle writes a `DatasetItemRevision` with `change_type = "disabled" | "enabled"` (`before/after = {disabled, reason}`), so the item history and the audit show who and why.
- `dataset_versions.item_count` stays the total; version payloads gain `disabled_count`.

### 2.2 Reads
- `GET …/items` gains `state=active|disabled|all` (**default `active`**). The SDK (`core/dataset.py`, `platform/client.py`) sends nothing and so excludes disabled items with no SDK change; a new SDK build passes `state=active` explicitly and the local viewer labels "n disabled items skipped".
- `GET …/items/{id}` always returns the item, with `disabled: {at, by, reason} | null`.
- Download (`:download`) excludes disabled unless `include_disabled=true`.
- `:compare`, lineage, neighbors and item runs are unchanged except for the state field.

### 2.3 Writes
```
POST …/items/{item_id}:disable   body {reason?: str}      (modify; draft version only, else 409 "Create a draft to change item state")
POST …/items/{item_id}:enable                             (modify; draft only)
```
Batch versions through §3.

### 2.4 UX
- **Items tab toolbar**: a state segmented control "Active · Disabled · All" (default **Active**; URL param `state`). The count line reads "118 active · 6 disabled".
- **Rows**: disabled rows (visible under Disabled / All) use `--text-muted` text and a `Chip tone="neutral"` "Disabled" in the item-id cell; never hidden by opacity alone (DESIGN_LANGUAGE §6: density, not hiding).
- **Item pane / item page**: action "Disable item…" (drafts only; on a published version the action reads "Create a draft to disable" and opens the existing new-draft flow) opens a small dialog (optional reason, 500 chars); disabled items show a `Callout tone="warning"` "Disabled by {user} on {date}: {reason}" with an "Enable" button (drafts) or without it (published). Item history lists the toggles.
- **Version header**: "124 items (6 disabled)".
- **Run creation / experiments**: nothing to show; the SDK simply receives the active set. The run page's dataset line keeps the version's active count at run time (`run_metadata.dataset_active_items`, written by the SDK when available).

---

## 3. Batch edit by metadata

### 3.1 API
- `GET …/items` and `:download` gain `meta=path:value` (repeatable; AND across paths; exact match on scalar values). `path` is a **dotted path** into the metadata object, `domain` or `source.region.code`, at most 3 levels (owner decision D8). Values compare as strings on both dialects (`json_extract` on SQLite, `#>>` on Postgres); numbers and booleans are matched by their JSON text.
- `GET …/items:metadata-facets` → `{paths:[{path, values:[{value, count}], truncated}]}`: every scalar leaf path up to 3 levels deep (at most 100 paths × 200 values, nested objects walked in Python over a streamed `metadata` column scan, cached per version for 60 s and invalidated on item writes).
- `POST …/items:batch` body:
  ```json
  {"filter": {"search": "…", "label": "…", "meta": {"domain": "finance"}, "state": "active"},
   "action": "disable" | "enable" | "delete", "reason": "…", "dry_run": true}
  ```
  Response `{matched, affected, sample_item_ids[:20], version_status}`. Every action needs a **draft** version (published → 409 with "Create a draft to edit items"). Set-based `UPDATE`/`DELETE`, one revision row per item (bulk insert), one version-row write, one audit entry `dataset.items_batch` with the filter and counts. A batch whose filter matches **nothing** is a 422 (guard against an empty filter wiping a version: a filter with no criteria is refused).

### 3.2 UX
- **Items toolbar**: "Metadata" filter button → popover with key select (from facets) and value select; applied filters render as removable chips next to the label chip ("domain: finance ×"). The list and counts follow the filter.
- **Bulk menu** (the existing selection bar, plus a new "All matching" entry when a filter is active): "Disable all 42 matching…", "Enable all…", "Delete all 42 matching…". On a published version the menu is replaced by one entry, "Create a draft to edit items", which opens the existing new-draft flow.
- **Confirm dialog**: shows the dry-run numbers ("42 of 124 items match domain: finance"), the first item ids, a reason field (disable only), and a typed confirmation for delete above 50 items. After apply: toast with counts, list and counts refetch.

---

## 4. Per-experiment dataset read token (feature 4)

### 4.1 Today
- At launch the platform mints a per-experiment **API key** (`services/eval_submitter_keys.py`, migration 0077), sends it as `qym_api_key`, revokes it once every job is terminal and `KEY_REVOKE_GRACE` (10 min) has passed.
- Private test sets are readable by the worker only through the deployment-wide `QYM_DATASET_READ_TOKEN` (admin-issued in Project Settings → API keys). The dispatcher does not send one.

### 4.2 Design
Mirror the submitter-key lifecycle for a **dataset read token**:
```
eval_experiments.dataset_read_token_id         FK dataset_read_tokens.id ON DELETE SET NULL, indexed
eval_experiments.dataset_read_token_encrypted  TEXT (Fernet, cleared on revoke)
```
- **Mint** at launch (never on dry run): `DatasetReadToken` for the experiment's project, named `Evaluation Service · <experiment>`, `kind = 'experiment'` (new column on `dataset_read_tokens`, default `'admin'`, so the admin list can tell them apart), `created_by_user_id = creator`.
- **Scope**: full read of **any dataset of that project** on item reads: it lifts both the `private_test_set` block and a `restricted` access mode (§1.3). It identifies no user and allows no write (unchanged contract of `token_grants_project`).
- **Use**: `_submit_body` sets `body["env_overrides"]["QYM_DATASET_READ_TOKEN"] = token` **only when the environment's env-overrides schema declares that key** (older services answer 422 on unknown keys). Otherwise the job runs with the worker's own token and the job detail shows "Dataset read token not sent: the environment's schema does not declare QYM_DATASET_READ_TOKEN". The pointer `/env_overrides/QYM_DATASET_READ_TOKEN` joins the platform-owned set (a user document that sets it is rejected as `platform_owned`, like `qym_api_key`). The value is scrubbed from every stored outcome (`_scrub_outcome`) and never in `request_body`.
- **Revoke** in `revoke_key_when_settled` (same guard, grace and retry rules; `ensure_key_for_retry` re-encrypts or re-mints both credentials). The settle sweep's `WHERE qym_api_key_encrypted IS NOT NULL` becomes "either blob not null".
- **Launch permission** (owner decision D3): **no dataset gate**. Any member who can launch may name any dataset of the project, restricted or private; the token does the reading. Grants control browsing only. The launch form's dataset picker therefore lists every dataset of the project (with its "Restricted" chip) and the run's item contents are redacted afterwards for users without access (§1.3).

### 4.3 UX
- **Experiment detail → header details**: "Credentials: API key + dataset read token · active" / "revoked 12:41". Job detail shows the schema notice above when the token was not sent.
- **Project Settings → API keys → Dataset read tokens**: experiment tokens appear with a `Chip` "experiment" and the experiment link; admins can still revoke them by hand (the dispatcher then re-mints on retry).

---

## 5. Latency-sensitive runs (feature 5)

### 5.1 Design
- `eval_experiments.latency_sensitive BOOLEAN NOT NULL DEFAULT false`; `eval_environments.latency_sensitive_min_role VARCHAR(10) NOT NULL DEFAULT 'member'` (`'member'` | `'manager'`, check constraint), exposed on the environment payload as `latency_sensitive_min_role` and on the launch context as `latencySensitiveMinRole`.
- `ExperimentCreateRequest.latency_sensitive: bool = False`; `_submit_body` sets `body["latency_sensitive"]` from the experiment (platform-owned body field, so a raw-JSON document cannot set it).
- Gate (owner decision D4): each environment has `latency_sensitive_min_role` = `'member'` (default: anyone in the project) | `'manager'`. Only project managers and admins change it, in either direction (environment editing is already theirs). A launch with the flag on checks every selected environment: `'manager'` on any of them and a non-manager launcher → 403 "Latency-sensitive runs on <env> need a project manager" (dry run: a blocking review item). No acknowledgement field; the UI shows a warning callout instead.
- Review warnings (dry run): when on and the env schema declares `EVAL_VLLM_POST_RUN_MAX_REQUESTS` but the document leaves it unset → warning "No post-run request ceiling: steady foreign load would be accepted and skew latency (guide §2.2)". Warning, not a blocker.
- Poll: `EvalJobRead` carries `admitted_at`, `deferrals`, `deferral_reason`, `contaminated_attempts`; store them in `remote_result` and show them.
- List filter `latency_sensitive` on `GET /v1/experiments` and the queue.

### 5.2 UX
- **Launch → step 1 "Run settings"** (next to Priority): a `Checkbox` "Latency-sensitive run" with the helper "Starts only when the gateway is quiet, makes other jobs wait while it runs, and is discarded and re-queued if foreign traffic overlaps. Expect a later start." When checked, a `Callout tone="warning"` reads "Other jobs wait while this run executes" and names the environments that need a manager (if any; the checkbox is disabled with that reason for non-managers when every selected environment needs one).
- **Review pane**: row "Latency-sensitive: yes".
- **Experiment detail header**: `Tag` "Latency-sensitive"; jobs table: status cell adds "deferred ×3 · vllm quiet window" / "re-queued ×1 · contaminated" from the stored fields.
- **Experiments list / eval queue**: a `Tag` in the name cell and a filter chip.
- **Environments page** (edit form, managers): "Who can launch latency-sensitive runs" select: "Anyone in the project" (default) / "Project managers only".

---

## 6. Cross-cutting

- **Audit**: `dataset.access_changed`, `dataset.item_disabled/enabled`, `dataset.items_batch`, `eval.dataset_token_issued/revoked`.
- **Security checklist** (`docs/internal/EVAL_SECURITY_CHECKLIST.md`): add the token's lifecycle and the platform-owned pointers.
- **Docs**: `docs/USER_GUIDE.md` (datasets: access, disabled items, batch edits; experiments: latency-sensitive), `docs/internal/DB_SCHEMA.md`, the SDK `README` note on `state=active`.
- **Tests**: `tests/platform/test_dataset_access.py`, `test_dataset_item_state.py`, `test_dataset_items_batch.py`, `test_eval_dataset_tokens.py`, `test_experiment_latency_sensitive.py`; Vitest for the new pure logic; Playwright specs `datasets/access.spec.ts`, `datasets/item-state-batch.spec.ts`, `experiments/launch/latency-sensitive.spec.ts`.

## 7. Cycle and orchestration (proposal, Q5)

Per AGENTS.md "UI product-feedback rounds": design → implement → review. Owner decisions D5-D7: WP-A and WP-B run **in parallel** (two designers, then two implementers, reviews one at a time when memory is short; `free -h` ≥ 3 GB before each start), full design round (numbered criteria + gallery mocks + screenshots), every full suite through `scripts/heavy.sh`.

1. **Design stage** (one agent per WP, in parallel): this document plus `docs/internal/feature-rounds/2026-10-dataset-access/spec-a.md` / `spec-b.md` with numbered acceptance criteria per feature (element, width, number), static mocks at `/__ui#dataset-access` and `/__ui#eval-flags`, screenshots of the current pages at 1440, 1024 and 390 px.
2. **Implement WP-A** on `feat/dataset-access` (worktree `../qym-wt-dataset-access`, ports 8981/5981), migration 0087, criterion → change → test table, after-screenshots, full gate.
3. **Implement WP-B** on `feat/eval-dataset-token-latency` (worktree `../qym-wt-eval-flags`, ports 8982/5982), migration **0088 with `down_revision = "0087"`** written against the agreed 0087 revision id, so the chain stays linear although both land at once (WP-A owns 0087; WP-B's migration is applied after WP-A's merge and verified at integration).
4. **Review** each WP (independent agent, measured verdict), fix pass, re-review.
5. Merge `--no-ff` into `UI-redesign` (WP-A first, then WP-B, then an integration gate: both migrations on a fresh SQLite and, when `QYM_TEST_POSTGRES_URL` is set, Postgres); nothing pushed.

Rough size: WP-A ≈ 2 migrations' worth of model work, ~12 routes touched, 4 UI surfaces; WP-B ≈ 1 service module, dispatcher, 3 request/response changes, 5 UI surfaces.

## 8. Owner decisions (2026-10-20)

| # | Question | Decision |
|---|---|---|
| D1 | Users with no access to a restricted dataset and runs on it | **Listed, item contents redacted** (as private test sets). Datasets are public to the whole project by default (`access_mode = 'project'`); restriction is opt-in per dataset. "Everyone" = every member of the project, never cross-project. |
| D2 | Scope of the disabled flag | **Draft versions only**: a per-row flag edited in drafts, effective on publish, copied into later drafts. Published versions stay immutable. |
| D3 | Launch gate on restricted datasets | **None**: any member can launch on any dataset of the project; the per-experiment token reads it. |
| D4 | Latency-sensitive gate | **Per-environment minimum role** `latency_sensitive_min_role`, default `member` (anyone); managers and admins change it in either direction. |
| D5 | Parallelism | **Two implementers in parallel** (and two designers), memory permitting. |
| D6 | Design depth | **Full round**: numbered criteria, gallery mocks, screenshots, measured review. |
| D7 | Batch metadata keys | **Dotted nested paths** (up to 3 levels), not only top-level keys. |
