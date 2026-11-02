# WP-C: SDK and run model for multi-dataset / multi-version evaluations (design specification)

Status: design stage. Branch `feat/multi-dataset-sdk` (from `UI-redesign` 0d725715). No product component, route, model or SDK module is changed by
this stage. The code added is the gallery mock `frontend/src/features/dev/MultiSdkMocks.tsx` (+ `.module.css`, wired into `/__ui#multi-sdk` through
`UiGalleryPage.tsx`), the seed, measurement and screenshot scripts under `measure/`, the screenshots under `shots/` and this document. The mocks are
the visual contract: where this text and a mock disagree, the number in this text wins and the mock is a bug. The CSS in `MultiSdkMocks.module.css`
(`.dsChip`, `.dsName`, `.dsVersion`, `.dsCount`, `.dsAlias`, `.dsDeleted`, `.countLink`, `.delta`, `.showLink`, `.datasetFilter`) is the proposed recipe.
Owner decisions F1 to F4 (`BRIEF.md` section 2) are final and are not re-opened here. WP-D (launch and service contract) is designed in parallel;
everything this package needs from it, and everything it asks of the shared contract (`BRIEF.md` section 5), is in section 7.

Measured 2026-10-22 at 1440, 1024 and 390 px on the Vite dev server (5994) over the platform on 8994 (SQLite, `QYM_AUTH_MODE=none`), Playwright
Chromium headless, dark scheme. Column widths of the real report pages: **1193 px at 1440, 777 at 1024, 279 at 390**; the mock shell reproduces them
(measured `content` 1193 / 777 / 279). Every number that says "today" was measured on the product (`current-*` shots, `measure/out/current-c.json`),
every number that says "mock" in the gallery (`measure/out/mock-c.json`). The seed (`measure/seed-c.mts`) is project `multi-demo` with three
single-dataset runs (60 and 30 items, three metrics).

## 0. Reading guide

The owner's request, first bullet, in the owner's words (`BRIEF.md` section 1):

> allow qym sdk to accept multiple dataset and multiple versions for each dataset, change the creation logic to allow multi value selection of both
> (and prepare a request of integration change from the evaluation service team) -note: the sdk should maintain the same current support for a single
> dataset and version and expand above it-

This package is the SDK half and the run model half. The launch wizard, the Evaluation Service contract and the fan-out for old services are WP-D.
Decision **F1** binds this work: "combine into one run" is a union run, "one run each" is N ordinary runs (nothing new here). **F3** means an old
service never reaches the union path.

### Composed page mocks (look at these first)

Whole pages as the user sees them (app shell: sidebar 192 px, topbar, the real run hero classes from `RunHero.module.css`, the real section nav
classes from `SectionNav.module.css`), realistic data, default state, drawn at the real size and collapsed to the 56 px rail at 390. Gallery
`/__ui#multi-sdk`, first cases of the anchor; the state sheets follow as the appendix.

| Case id | Surface | Shots (`shots/`) | Criteria |
|---|---|---|---|
| `multi-page-run` | run detail of a union run: 3 datasets (`support-tickets` v3 and v4, `billing-faq` production = v7), hero with the Datasets group, section nav, Overview, the new Datasets section, Items with the Dataset column | `mock-c-page-run-{1440,1024,390}.png` | QC-U1 to QC-U30 |
| `multi-page-run-filtered` | the same page after "Show 438" on `support-tickets` v4 | `mock-c-page-run-filtered-*.png` | QC-U22 to QC-U26 |
| `multi-page-runs` | runs list, two union runs among single-dataset runs | `mock-c-page-runs-*.png` | QC-U31 to QC-U36 |
| `multi-page-compare` | compare cards of a union run against a single-dataset run, with the dataset notice | `mock-c-page-compare-*.png` | QC-U37 to QC-U40 |
| `multi-state-single` | a single-dataset run: exactly today's page | `mock-c-state-single-*.png` | QC-U41 |
| `multi-state-loading` | the Datasets section while the breakdown loads | `mock-c-state-loading-*.png` | QC-U42 |
| `multi-state-deleted` | `billing-faq` deleted after the run | `mock-c-state-deleted-*.png` | QC-U43 |
| `multi-state-many` | 12 datasets: the Datasets group clamps | `mock-c-state-many-*.png` | QC-U44 |

Baselines of today's pages: `current-run-*`, `current-runs-*`, `current-compare-*` (1440, 1024, 390), one run of `support-tickets`.
Scripts: `measure/seed-c.mts` (seed), `current-c.mts` (baselines), `shots-pages-c.mts` (mock shots and measurements), `lib-c.mts`.

```
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd <worktree>; source <main checkout>/.venv/bin/activate
export PYTHONPATH=packages/sdk:packages/platform QYM_PYTHON=<main checkout>/.venv/bin/python
export QYM_DATABASE_URL=sqlite:///$PWD/.qym-e2e-multi-sdk.db; python frontend/scripts/dev_db.py $QYM_DATABASE_URL
QYM_AUTH_MODE=none QYM_ENVIRONMENT=development python -m uvicorn qym_platform.main:app --port 8994 &
(cd frontend && QYM_PLATFORM_PORT=8994 npm run dev -- --port 5994) &
node docs/internal/feature-rounds/2026-10-multi-dataset-task/measure/seed-c.mts http://127.0.0.1:8994
node .../measure/current-c.mts ; node .../measure/shots-pages-c.mts
```

Numbering: **QC-1 to QC-48** SDK, CLI and file behaviour (section 2); **QC-49 to QC-90** platform data model and API (section 3); **QC-U1 to QC-U46**
the UI (section 4); **QC-D1 ...** the decisions log (section 6). Count: 48 + 42 + 46 = **136 numbered criteria**.

## 1. Summary of what changes where

| Surface | Today | Specified |
|---|---|---|
| `Evaluator(task, dataset, ...)` | `dataset`: name, path or object; `config.dataset_version` / `dataset_alias` scalars | also a list of names, `DatasetRef`s and objects; a single value behaves byte-for-byte as today |
| CLI | one `--dataset`, `--dataset-version`, `--dataset-alias` | `--dataset` repeatable with `name@v3` / `name@alias:production`; the two flags stay as defaults for plain names |
| Union run (new) | n/a | one run over the concatenation; item ids `"{name}@{version}/{id}"`; every item tagged `qym_dataset`, `qym_dataset_version`, `qym_dataset_index`, `qym_item_id`; run label `a@v3 + a@v4 + b` |
| Upload | `dataset`, `dataset_id`, `dataset_version_id`, `dataset_alias` | the same four (first entry; `dataset` = the label) plus `datasets: [{dataset, dataset_id, dataset_version_id, version, alias, items, disabled_items}]` when more than one |
| Platform storage | `Run.dataset*` | + table `run_datasets`, `runs.dataset_count`, `run_items.dataset_position` (migration 0089) |
| Run page hero | Dataset fact = `DatasetTag` | union: fact **Datasets** = count tag (92 x 20), a **Datasets** group first in the context band, one chip per entry |
| Run page body | Overview, Latency, ..., Items | + section **Datasets** (breakdown table) after Overview, nav entry with count, Items gets a Dataset column and filter |
| Runs list, compare | Dataset tag per run | union: count tag `3 datasets`; filters match any entry; compare shows a notice when dataset sets differ |
| Best-run index, dashboards, insights | by `dataset_id` / `Run.dataset` | union runs are never ranked against single-dataset runs; they form their own dashboard combo (the label) |

---

## 2. SDK, CLI and files

### 2.1 Python API

```python
# qym/core/dataset.py (new names exported from qym: DatasetRef, UnionDataset)
@dataclass(frozen=True)
class DatasetRef:
    name: str                       # platform dataset name, or a local .csv / .jsonl path
    version: Optional[str] = None   # "v3"; at most one of version / alias
    alias: Optional[str] = None     # "production", "staging"
    @classmethod
    def parse(cls, text: str) -> "DatasetRef": ...      # CLI grammar, section 2.5; never called on Python strings
    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "DatasetRef": ...   # {"dataset": n, "version": v, "alias": a}: the service's entry

DatasetLike = Union[str, DatasetRef, Any]                # Any = CsvDataset, JsonlDataset, QymDataset, InMemoryDataset, ...

class Evaluator:
    def __init__(self, task, dataset: Union[DatasetLike, Sequence[DatasetLike]], metrics, config=None, ...): ...

def resolve_dataset(dataset: Union[str, DatasetRef], *, version=None, alias=None, platform_url=None, api_key=None) -> Any   # unchanged; accepts a DatasetRef
def resolve_datasets(datasets: Sequence[DatasetLike], *, version=None, alias=None, platform_url=None, api_key=None) -> Any
#   -> the object itself for one entry, a UnionDataset for two or more
class UnionDataset:
    name: str                       # the run label, section 2.3
    entries: List[UnionEntry]       # (position, ref, dataset object); after get_items(): resolved version, ids, counts
    id, dataset_version_id, version, alias    # the FIRST entry's (the compatibility fields)
    input_cols: List[str]           # the common list when every entry has the same, else []
    disabled_count: int             # sum
    def get_items(self) -> List[CsvDatasetItem]
    def describe(self) -> List[Dict[str, Any]]   # the upload's `datasets` list
```

Single case (must stay byte-for-byte today's behaviour):

```python
Evaluator(task, "support-tickets", ["exact_match"], config={"dataset_version": "v3"})          # unchanged
Evaluator(task, "./cases.csv", ["exact_match"])                                                  # unchanged
Evaluator(task, CsvDataset("./cases.csv"), ["exact_match"])                                      # unchanged
Evaluator(task, ["support-tickets"], ["exact_match"])                                            # a one-entry list is the same as the string
Evaluator(task, DatasetRef("support-tickets", version="v3"), ["exact_match"])                    # a DatasetRef is the same as name + config.dataset_version
```

Multi case:

```python
from qym import Evaluator, DatasetRef

ev = Evaluator(
    task,
    dataset=[
        DatasetRef("support-tickets", version="v3"),
        DatasetRef("support-tickets", version="v4"),      # the same dataset again, another version
        DatasetRef("billing-faq", alias="production"),
        "refund-cases",                                    # plain name: uses config.dataset_version / dataset_alias, else production
        CsvDataset("./local-cases.csv"),                   # objects mix in
    ],
    metrics=["answer_correctness", "faithfulness"],
)
result = ev.run()
result.run_metadata["datasets"]   # [{"dataset": "support-tickets", "version": "v3", "dataset_id": "...", ...}, ...]
```

| Id | Criterion |
|---|---|
| QC-1 | `Evaluator.dataset` accepts: a `str` (name or path), a `DatasetRef`, a dataset object (anything with `get_items()`), or a `list` / `tuple` of those, in any mix. Anything else raises `TypeError("dataset must be a name, a DatasetRef, a dataset object or a list of them")`. An empty list raises `ValueError("dataset list is empty")` |
| QC-2 | A one-entry list, a `DatasetRef` with `version=None, alias=None`, and the plain string are the same call: same object (`QymDataset` / `CsvDataset` / `JsonlDataset`), same item ids, same `dataset_name`, same upload payload (no `datasets` key), same results file name. `tests/sdk` asserts the equality of the create-run payload, the results file name and the item ids between the three spellings |
| QC-3 | `DatasetRef(name, version, alias)` is a frozen dataclass; both `version` and `alias` set raises `ValueError("a dataset takes a version or an alias, not both")`; an empty name raises `ValueError`; `DatasetRef.from_dict` reads the service's keys (`dataset`, `version`, `alias`) and ignores unknown keys |
| QC-4 | A plain string in a list is a name, never parsed for `@` (a Python string is data; only the CLI parses its grammar, QC-31). It takes `config.dataset_version` / `config.dataset_alias` when set, else the dataset's `production` alias, exactly as today's single case. A `DatasetRef` carries its own version or alias and ignores both config fields, even when it sets neither (then the dataset's `production` alias) |
| QC-5 | A string that is an existing path (`Path(text).expanduser().exists()`) resolves to `CsvDataset` / `JsonlDataset` (as `resolve_dataset` today); `DatasetRef` of a path with a version or alias raises `ValueError("a local file has no version")` |
| QC-6 | `resolve_dataset(DatasetRef(...))` is accepted (its version / alias win over the keyword arguments); `resolve_datasets([x])` returns the same object as `resolve_dataset(x)`; for two or more it returns a `UnionDataset` |
| QC-7 | Validation is eager and cheap: a malformed list raises at `Evaluator(...)` (before any network), a missing dataset or version raises `DatasetNotFoundError` when the items load, which is before `create_run`, so a failing entry never leaves a half-created platform run |
| QC-8 | More than 50 entries raises `ValueError("at most 50 datasets per run")` (the platform limit, QC-52); two entries that resolve to the same dataset and version (`a` production = `a@v3`) raise `ValueError("dataset a v3 is listed twice")` at load; the same local file twice likewise |
| QC-9 | `MultiModelRunner` and `RunSpec.dataset` accept the same forms; the pre-load cache applies to plain-name specs only, a list is resolved inside its `Evaluator`. A `RunSpec` list runs as one union run per spec |

### 2.2 The union run: loading, order, identity

| Id | Criterion |
|---|---|
| QC-10 | `UnionDataset.get_items()` loads the entries **sequentially in list order** (each entry's own page order), concatenates, and caches. The item list order is the evaluation order; `RunItem.index` is the position in the concatenation (0-based) |
| QC-11 | **Item identity.** With two or more entries every item id becomes `"{label}/{raw_id}"`, `label` = `name@version` with the **resolved** version label (`support-tickets@v3`; the alias is resolved before the label is built) and `name` alone for a local file (its file name). With one entry nothing changes (the raw id). The raw id is kept as `item_metadata.qym_item_id`. Two datasets that share ids (`t-0007` in v3 and v4) therefore give two items |
| QC-12 | An id that would pass 200 characters (`run_items.item_id` is `VARCHAR(200)`) is shortened: the label part becomes `ds-{sha1(label)[:8]}` and, if it still does not fit, the raw part is cut and ends in `~{sha1(raw)[:8]}`; the full raw id stays in `qym_item_id` (itself capped at 1000 characters). Deterministic: the same inputs give the same id on every run |
| QC-13 | **Item tags.** In a union run every item's `metadata` gains (existing keys with the same name are overwritten and one warning is logged): `qym_dataset` (name), `qym_dataset_version` (resolved label, `null` for a local file), `qym_dataset_index` (0-based position in the list), `qym_item_id` (raw id), `qym_dataset_version_id` (platform version id or `null`). They flow into `item_metadata` of the events and every results file unchanged; a single-dataset run gets none of them |
| QC-14 | `dataset_item_pk` (the platform's item key) is kept on the wrapped item, so the platform links a run item to its source item without parsing the id (QC-64) |
| QC-15 | **Label.** `UnionDataset.name` (= `Evaluator.dataset_name`) is `"a@v3 + a@v4 + b@production + c"`: entries joined by ` + `, each as requested (`name`, `name@version`, `name@alias` is written `name@production` for an alias; a plain name stays `name`); more than 120 characters cut at an entry boundary and ended with ` + N more`. It is deterministic from the request, never from the resolution (resume, file names). The platform `Run.dataset` is this label |
| QC-16 | `describe()` returns one dict per entry, in order: `{"dataset": name, "dataset_id": id|null, "dataset_version_id": id|null, "version": resolved label|null, "alias": effective alias|null, "items": active count, "disabled_items": n}`. `alias` is the alias used to resolve (a plain name with no version reports `production`; an explicit version reports `null`) |
| QC-17 | Disabled items stay out as today (`state=active`); `run_metadata.dataset_active_items` / `dataset_disabled_items` are the sums; the console line `N disabled items skipped` is unchanged (a sum); `run_metadata.datasets` carries the per-entry counts |
| QC-18 | An entry with zero active items logs `dataset X vN has no active items` and is kept in `datasets` with `items: 0`; all entries empty keeps today's `Dataset is empty` early return |
| QC-19 | `input_cols`: the common list when every entry declares the same columns, otherwise `[]` and one warning (`datasets have different input columns; input_mapping is not applied by column name`); `input_mapping` and `_single_dataset_input_name` behave as for a dataset that declares no columns |
| QC-20 | Concurrency, retries, repeat passes (`samples`), `should_stop` and metrics are untouched: the union is just a longer list. `total_items` is the concatenated count |

### 2.3 Run, results files, checkpoints, resume, local viewer

| Id | Criterion |
|---|---|
| QC-21 | `EvaluationResult.dataset_name` = the label (QC-15); the results file name uses the sanitised label capped at 80 characters with `-{sha1[:6]}` when cut; `run_metadata["datasets"]` = `describe()` (union only) and `run_metadata["dataset_id"]` / `["dataset_version_id"]` are the first entry's |
| QC-22 | Results exports (csv, xlsx, json) of a union run carry two extra columns `dataset` and `dataset_version` right after `item_id` (the tags of QC-13); a single-dataset export has none. The checkpoint reader ignores columns it does not know (`DictReader` plus `extrasaction="ignore"`, already the case at `checkpoint.py:257`); `tests/sdk` loads a union file written by the new code with `load_checkpoint_state` |
| QC-23 | **Resume.** The checkpoint file is the results file, so `item_id` carries the namespace. Resume compares `dataset_name` (today's check, now the label) and, for every completed row, its `qym_dataset_version` against the version the same entry resolves to now; a difference raises `ValueError("Resume dataset version mismatch: support-tickets was v3 in the checkpoint and resolves to v4 now. Pin the version (support-tickets@v3) to resume.")` |
| QC-24 | A union run resumed from a checkpoint skips exactly the completed `(item_id, pass)` pairs (the namespaced ids), re-runs the rest, and ends with the same per-dataset counts as an uninterrupted run (`tests/sdk` interrupts after item 5 of 3 datasets and resumes) |
| QC-25 | `qym ui FILE.csv` / `--local-ui` on a union run shows the same Datasets row, Dataset column and filter as the platform page (section 4), computed from the rows in the file (`item_metadata.qym_*`), and the breakdown section computed client-side from the complete rows. A file without `qym_*` tags (every file written before this round) opens unchanged |
| QC-26 | The offline export (`/api/runs/{id}/export-html`, frozen template) shows the `datasets` list in its header as plain text (`support-tickets v3 · 412 items`, one per line, no link) and nothing else changes; the frozen template does not import app code (DESIGN_LANGUAGE section 5) |

### 2.4 Upload

```jsonc
// POST /v1/runs   (PlatformClient.create_run), union run
{
  "external_run_id": "release-gate-nightly", "task": "answer-ticket", "model": "gpt-4o", "metrics": ["answer_correctness", "faithfulness", "tone"],
  "dataset": "support-tickets@v3 + support-tickets@v4 + billing-faq@production",   // the label, QC-15
  "dataset_id": "…first…", "dataset_version_id": "…first…", "dataset_alias": null,  // the FIRST entry (compatibility)
  "datasets": [                                                                     // NEW; only when two or more
    {"dataset": "support-tickets", "dataset_id": "…", "dataset_version_id": "…", "version": "v3", "alias": null,         "items": 412, "disabled_items": 0},
    {"dataset": "support-tickets", "dataset_id": "…", "dataset_version_id": "…", "version": "v4", "alias": null,         "items": 438, "disabled_items": 2},
    {"dataset": "billing-faq",     "dataset_id": "…", "dataset_version_id": "…", "version": "v7", "alias": "production", "items": 96,  "disabled_items": 0}
  ],
  "run_metadata": {"datasets": [ …same list… ], "total_items": 946, "...": "..."}, "run_config": {"...": "..."}
}
```

| Id | Criterion |
|---|---|
| QC-27 | `PlatformClient.create_run(..., datasets: Optional[List[Dict]] = None)`: the key `datasets` is sent only when the list has two or more entries; a single-dataset run sends the byte-identical payload of 2.0.0 (asserted by comparing the JSON bodies) |
| QC-28 | The `run_started` event payload carries `datasets` under the same rule (a client that only streams events, or a retried create, still gets the table filled, QC-55); `item_started.item_metadata` carries the tags of QC-13 |
| QC-29 | An old platform (2.0.0) accepts the union upload: `datasets` is an unknown key and ignored (Pydantic `extra` default), the run lands as a single run of the first entry's ids with `dataset` = the label. No SDK-side version negotiation |
| QC-30 | `qym run create --json` prints `datasets` (the list of QC-16) next to today's `dataset` for a union run; one dataset prints exactly today's fields |

### 2.5 CLI

```
# single: exactly today
qym run create --task-file t.py --task-function f --dataset support-tickets --dataset-version v3 --metrics exact_match
# union
qym run create --task-file t.py --task-function f --metrics answer_correctness \
    --dataset support-tickets@v3 --dataset support-tickets@v4 --dataset billing-faq@alias:production --dataset ./local.csv
```

| Id | Criterion |
|---|---|
| QC-31 | `--dataset` is repeatable. Grammar of one value (`DatasetRef.parse`): if the whole text is an existing path it is a local file (no suffix parsing, so `C:\x@1.csv` and `./a@b.csv` work); else split at the **last** `@`: `name@v3` is a version, `name@alias:production` an alias, `name` neither; an empty right side (`name@`) or an empty alias (`name@alias:`) is a usage error (exit 2) naming the value. A dataset whose own name contains `@` and has no suffix cannot be written on the command line (use the Python API); a suffix always makes the right-most `@` the separator |
| QC-32 | `--dataset-version` / `--dataset-alias` remain; they are the defaults of entries **without** a suffix and apply to nothing else. With one `--dataset` and no suffix the command is byte-for-byte today's (same config keys, same Evaluator call, same output). A suffix beats the flag for its entry, silently (documented in `--help`) |
| QC-33 | `--dataset-file` / `--dataset-csv` stay mutually exclusive with `--dataset` (today: "exactly one of"); the new error for `--dataset a --dataset b --dataset-file f` reads `Provide either --dataset (repeatable) or --dataset-file, not both.` (exit 2). A local file in a union is written `--dataset ./f.csv` |
| QC-34 | `--dataset-version` or `--dataset-alias` given with only suffixed datasets is accepted and unused; given together on the same command, version wins as today. Any list longer than 50 or with a repeated resolved pair exits 2 with the messages of QC-8 |
| QC-35 | Console: one line per entry before the run (`Dataset support-tickets@v3: 412 items`), then `Setting up evaluation for dataset 'a@v3 + a@v4 + b'` (the label); a single dataset prints today's line |
| QC-36 | `qym run list --json` and `qym run get --json` add `datasets` (list of `{dataset, version, aliases, items, deleted}`, `[]` when the run has none) and `dataset_count`; `qym run list --dataset NAME` (existing `--task` style filter) matches a run when any entry has that name |
| QC-37 | Exit codes unchanged (2 usage, 3 not found when an entry's dataset or version does not exist, 4 auth); the not-found message names the entry (`Dataset 'billing-faq' version 'v9' not found`) |

### 2.6 Error and compatibility table

| Id | Case | Behaviour |
|---|---|---|
| QC-38 | `datasets` entry for a dataset the key cannot read | `DatasetNotFoundError` naming the entry; before `create_run` |
| QC-39 | entry order | never re-sorted; duplicates in name (different versions) are legal |
| QC-40 | SDK 2.0.0 reading a union results file | opens it: the extra columns are ignored, `item_id` is an ordinary string |
| QC-41 | platform 2.0.0 and a union run | QC-29 |
| QC-42 | the Evaluation Service passes `evaluator.dataset` + `dataset_version` only | single run, nothing changes (v1.3 services) |
| QC-43 | service passes `evaluator.datasets` | the worker builds `[DatasetRef.from_dict(e) for e in datasets]` and calls `Evaluator(dataset=...)`; the SDK enforces QC-8 as a backstop |
| QC-44 | `qym` import cost | `DatasetRef`, `UnionDataset` live in `core/dataset.py`; no new dependency |
| QC-45 | type hints / mypy | `DatasetLike` alias exported; `mypy packages/sdk/qym` stays clean |
| QC-46 | docs | USER_GUIDE gets "Evaluating several datasets" (single, multi, CLI, item ids, resume); `docs/sdk`-style API page lists `DatasetRef`; RELEASE_NOTES entry; `--help` strings |
| QC-47 | version | SDK 2.1.0 (a minor: new API, old API intact); the platform 2.1.0 ships with migration 0089 |
| QC-48 | the first entry as "the dataset" | every API that today asks for one dataset (`Evaluator.dataset_name` in logs of the old kind, `run_info["dataset_name"]`) receives the label; none receives only the first name |

---

## 3. Platform: data model, ingest, reads

### 3.1 Migration 0089 (`packages/platform/qym_platform/migrations/versions/0089_run_datasets.py`)

```
revision = "0089"; down_revision = "0088"
run_datasets                                   -- one row per entry of a union run (runs with two or more datasets only)
  id                  VARCHAR(36)  PK (uuid4 string, as every table)
  run_id              VARCHAR(36)  NOT NULL  FK runs.id ON DELETE CASCADE      INDEX ix_run_datasets_run_id
  position            INTEGER      NOT NULL  0-based, the order of the request
  dataset             VARCHAR(200) NOT NULL  the name as evaluated (kept when the dataset is deleted)
  dataset_id          VARCHAR(36)  NULL      FK datasets.id ON DELETE SET NULL   INDEX ix_run_datasets_dataset_id
  dataset_version_id  VARCHAR(36)  NULL      FK dataset_versions.id ON DELETE SET NULL   INDEX ix_run_datasets_version_id
  version             VARCHAR(100) NULL      the resolved version label at run time ("v3")
  alias               VARCHAR(100) NULL      the alias used to resolve ("production") or NULL
  item_count          INTEGER      NULL      active items the run evaluated for this entry
  disabled_count      INTEGER      NULL
  created_at          DATETIME     NOT NULL
  UNIQUE (run_id, position)   uq_run_datasets_run_position
runs.dataset_count      INTEGER NOT NULL DEFAULT 1 (server_default "1")   -- 1 for every run created before and for single-dataset runs
run_items.dataset_position  SMALLINT NULL                                  -- NULL on single-dataset runs
```

| Id | Criterion |
|---|---|
| QC-49 | Migration `0089` has `revision = "0089"`, `down_revision = "0088"`; `alembic heads` shows one head; `upgrade` then `downgrade` then `upgrade` is clean on SQLite (ADD COLUMN with inline default, as 0077 / 0088; table drop) and on PostgreSQL. Only nullable columns and a constant default are added to the big tables (`runs`, `run_items`), so it is quick DDL; no backfill and no index on `run_items.dataset_position` (queries filter by `run_id` first) |
| QC-50 | `RunDataset` ORM model in `db/models.py`; `Run.dataset_count: Mapped[int]` (default 1), `RunItem.dataset_position: Mapped[Optional[int]]`; `Base.metadata.create_all` (the dev DB script) produces the same schema as the migration (the existing schema-parity test covers 0089) |
| QC-51 | A run with `dataset_count = 1` has **no** `run_datasets` rows (single runs, every old run, one-entry uploads); readers synthesise the one entry from `Run.dataset`, `dataset_id`, `dataset_version_id` (QC-63). Reason in QC-D3 |
| QC-52 | Limits: 1 to 50 entries; `dataset` 1 to 200 characters; `version` and `alias` at most 100; `items` and `disabled_items` integers 0 to 100,000,000; two entries with the same non-null `dataset_version_id`, or the same `(dataset, version)` when ids are null, are refused with **422** `{"detail": "dataset support-tickets v3 is listed twice"}`; more than 50: **422** `{"detail": "at most 50 datasets per run"}` |

### 3.2 Ingest

| Id | Criterion |
|---|---|
| QC-53 | `CreateRunRequest.datasets: Optional[List[RunDatasetEntry]] = None`; `RunDatasetEntry{dataset: str, dataset_id: Optional[str], dataset_version_id: Optional[str], version: Optional[str], alias: Optional[str], items: Optional[int], disabled_items: Optional[int]}`. A request without `datasets` is processed by today's code path, byte for byte (same rows, same response) |
| QC-54 | Two or more entries: `Run.dataset_count = n`, one `run_datasets` row per entry (positions 0 to n-1 in request order), `Run.dataset = req.dataset` (the label, cut to 200), `Run.dataset_id` / `Run.dataset_version_id` = the first entry's (validated against the project like today's single fields; an id the project does not know stores `NULL` in the FK column and keeps the name in `dataset`). The response is unchanged (`run_id`, `live_url`) |
| QC-55 | `run_started` may carry `datasets`; if the run has `dataset_count = 1` and the event carries two or more entries the rows are created then (a create that timed out and a client that only streams events still fill the table); if rows exist, the event never changes them (idempotent, no duplicates on replay; test: the same `run_started` twice leaves n rows) |
| QC-56 | A request with exactly one entry stores no rows; if its top-level `dataset_id` / `dataset_version_id` / `dataset_alias` are absent they are taken from the entry |
| QC-57 | An entry with a name and an alias but no ids is resolved like today's first-entry lookup (project dataset by slug or name, alias row), per entry; an entry that cannot be resolved keeps `NULL` ids (a label-only dataset, as today's custom datasets) |
| QC-58 | `item_started`: when `run.dataset_count > 1` and `item_metadata.qym_dataset_index` is an integer in `[0, n)`, `run_items.dataset_position` is set to it; otherwise `NULL`. The run's `run_datasets` rows are loaded once per ingest batch (no query per item), and the source-item link is `payload.dataset_item_pk` when known, else the `(run_datasets[position].dataset_version_id, item_metadata.qym_item_id)` lookup (today's `(run.dataset_version_id, item_id)` lookup would never match a namespaced id) |
| QC-59 | `item_metadata` is stored as sent; the `qym_*` tags are ordinary metadata (they appear in the item detail JSON, in the metadata filter of the run page and in exports) |
| QC-60 | `POST /v1/runs:upload` accepts an optional form field `datasets` (a JSON array, same validation); rows of the file get `dataset_position` from their `item_metadata`; a file without tags uploads as today |
| QC-61 | Official runs: the launch token, `origin`, `experiment_job_id` linking and `run_versioning` are untouched; a union run launched by an experiment job is an ordinary official run with `dataset_count > 1` |
| QC-62 | **Access.** A run is `items_restricted` (existing banner and rules) when **any** of its datasets is a restricted dataset the reader cannot open or a private test set the reader may not see; scores, latencies and the breakdown stay visible, item inputs and outputs are hidden for the whole run, as for a single restricted dataset. The per-dataset breakdown shows names and numbers only |

### 3.3 Reads

| Id | Criterion |
|---|---|
| QC-63 | The run detail payload (`GET /api/runs/{id}` `run`) gains `dataset_count: int` and `datasets: [{position, dataset, dataset_id, dataset_slug, dataset_version_id, version, aliases, alias, items, disabled_items, deleted}]`. Always present: a single-dataset run returns one synthesised entry (`items: null`); `dataset_name` stays `Run.dataset` (the label for a union run) and `dataset_version` / `dataset_aliases` stay the first entry's. `aliases` = aliases that point at the version **now** (as today), `alias` = the alias used at run time. Existing consumers keep working |
| QC-64 | `deleted: true` when the dataset is soft-deleted or no longer exists (FK set to null); then `dataset_slug` is null (no link), `dataset` and `version` are the stored text, and every number of the run is unchanged. A deleted **version** of a live dataset keeps the dataset link (`dataset_slug`) and reports `deleted: false`, `version` as stored |
| QC-65 | The runs list payload (`GET /api/runs` rows) gains `dataset_count` and, for union runs only, `datasets: [{dataset, version}]` (names and versions, no counts); built with the existing batch map (`_dataset_version_info_map`) extended by one query over `run_datasets WHERE run_id IN (...)`: the statement count for a page of 1 run and of 200 runs is equal |
| QC-66 | The runs list filter `dataset` (and the facet that fills the Dataset filter) matches a run when `Run.dataset` equals the value **or** any `run_datasets.dataset` equals it; the facet lists real dataset names (single runs' `Run.dataset` where `dataset_count = 1`, union members' names), never a label. Text search (`q`) matches an entry name |
| QC-67 | The compare payload's `run` object carries the same `dataset_count` and `datasets` as QC-63. `compare_item_id` stays the stored `item_id` (namespaced for a union run), so two union runs over the same entries align item by item and a union run shares no items with a single-dataset run (QC-D8) |
| QC-68 | **Breakdown route** `GET /api/runs/{run_id}/datasets?pass=` (new; read-only) returns `{"dataset_count": 3, "breakdown": true, "datasets": [{"position": 0, "dataset": "support-tickets", "dataset_slug": "support-tickets", "version": "v3", "alias": null, "items": 412, "completed": 409, "errors": 3, "deleted": false, "metrics": {"answer_correctness": {"mean": 0.661, "count": 409}, ...}}], "run": {"items": 946, "completed": 938, "errors": 8, "metrics": {"answer_correctness": {"mean": 0.689, "count": 938}, ...}}}`. `items` = rows of the run for that position, `errors` = items with a task error, `mean` and `count` as the run page's Overview computes them (error items excluded, direction-aware errors as in `run_means`), `null` mean when `count` is 0 |
| QC-69 | The route reads what it returns and nothing else: one grouped query over `run_items` joined to the aggregate scores by `(run_id, item_id)` grouped by `dataset_position`, one over `run_datasets`, one over versions and aliases; **at most 4 statements and 0 writes** whatever the item count or the number of datasets; on the largest realistic run (10,000 items, 6 metrics, 12 datasets) under 300 ms on SQLite (`tests/platform` asserts the statement count at 100 and at 5,000 items equal) |
| QC-70 | `run.metrics[m].mean` of the route equals the Overview card mean of the same run to the displayed precision, and the item-weighted mean of the datasets' means equals it exactly (floating tolerance 1e-9); with `pass=N` (repeat runs) both are scoped to that pass like the rest of the run payload; without `pass` repeat runs use the pass-mean convention of `repeat_passes` |
| QC-71 | A run with `dataset_count = 1` answers 200 with `{"dataset_count": 1, "breakdown": false, "datasets": [one entry without metrics]}` so a client can call it blindly; an unknown run 404; a run the caller cannot read 403/404 as the run route does; the route requires the same permission as the run page |
| QC-72 | Rows of a union run whose `dataset_position` is `NULL` (a client that sent no tags, a file upload) are counted in no dataset; the route reports them as `"unassigned": {"items": n}` only when n > 0, and the UI shows a muted row `Not tagged` (QC-U17) |
| QC-73 | Server-side item exports (`/api/runs/{id}/export*`, the items CSV) of a union run gain `dataset` and `dataset_version` columns after the item id (same rule as QC-22) |

### 3.4 Everything else that reads `Run.dataset_id`

| Id | Criterion |
|---|---|
| QC-74 | One helper `services/run_datasets.py: run_has_version(version_id)` / `runs_of_dataset(dataset_id)` (SQL clauses: `Run.dataset_version_id == v OR EXISTS(SELECT 1 FROM run_datasets rd WHERE rd.run_id = runs.id AND rd.dataset_version_id = v)`) is used by the dataset page's **Runs** tab (`api/datasets.py` run list by dataset / version), the per-version and per-dataset run counts (catalog cards, version list) and the lineage tab, so a union run appears under **every** dataset it evaluated, once, with the same row |
| QC-75 | The item-level run history of a dataset item (`api/datasets.py`, the `(Run.dataset_version_id == version.id) & (RunItem.item_id == item.item_id)` join) also matches union items through `RunItem.dataset_item_pk == item.id`; no raw-id match is made across datasets |
| QC-76 | **Best-run index and base** (`services/eval_best_run.py`, `eval_best_run_base.py`): eligible runs add `Run.dataset_count == 1`; a union run is never ranked against single-dataset runs (their scores are over different item sets), whatever scope is chosen. `eval_run_scores` keeps writing the first entry's ids; the guard makes the union rows unreachable. The best-run response carries a `reason` `"union_run"` for a run chosen explicitly as base that is a union run |
| QC-77 | Insights and per-version trend joins (`api/insights.py`, `dashboard_outbox.py` version filters) exclude union runs from a dataset version's trend (`dataset_count = 1`); the dashboard's task and dataset combos use `Run.dataset` (the label), so a union run is its own combo `a@v3 + a@v4 + b` and never mixes into `support-tickets` |
| QC-78 | Retention: hard delete of a run removes its `run_datasets` rows (FK `ON DELETE CASCADE` and the ORM cascade used by `services/retention.py`); soft delete (Trash) keeps them; restore needs nothing |
| QC-79 | Deleting a dataset or version sets the FK columns of `run_datasets` to NULL (`ON DELETE SET NULL`); the stored `dataset` and `version` remain (QC-64). The delete flows that list "runs that use this version" count union runs (QC-74) |
| QC-80 | Ingest cost: a union run of 10,000 items ingests within 5% of the same single-dataset run (events per second); the position parse is a dict lookup, no statement is added per item or per event |
| QC-81 | PostgreSQL: the migration and QC-54 to QC-58, QC-65 to QC-69 run in `tests/platform` against `QYM_TEST_POSTGRES_URL` (skipped without it, as the other PG cases); `dataset_position` is `SMALLINT`; the grouped query uses no SQLite-only function |
| QC-82 | The OpenAPI schema lists `RunDatasetEntry`, `dataset_count`, `datasets` and the new route; `docs/` API reference gets one table; `tests/platform` asserts the schema keys |
| QC-83 | No new API-key scope, no new role, no audit entry (nothing is administered here) |
| QC-84 | The experiments side: `GET /api/runs/{id}` is what WP-D's experiment detail reads for a job's run (`dataset_count`, `datasets[].version`); WP-C adds no experiment field |
| QC-85 | A run page of a union run opened by a client of the previous UI build (cached SPA) keeps working: every added key is additive |
| QC-86 | Replaying the same create with the same `external_run_id` is not deduplicated today and stays so |
| QC-87 | `run_config` is unchanged; `run_metadata.datasets` (written by the SDK, QC-21) is stored as sent and is **not** the source of truth: the table is |
| QC-88 | Rows written by a union run before the platform was upgraded to 0089 do not exist (the migration ships with the platform that understands them); an SDK 2.1.0 union run on a platform 2.0.0 lands as QC-29 |
| QC-89 | `dataset_count` is maintained only at creation; nothing edits a run's datasets afterwards |
| QC-90 | Load test fixture `tests/platform/fixtures/union_run.py` builds a union run through the events API (the public path) for every test above |

---

## 4. UI: the run page, the runs list, compare

Numbers below are the gallery's (`measure/out/mock-c.json`, three widths); "today" is the product baseline (`measure/out/current-c.json`). The mock hero is
the real `RunHero` bands without the pager and the status extras, so absolute hero heights differ from the product by the same amount for a single run
(today 109.2 / 151.4 / 305.8; mock single 109.2 / 151.4 / 275.8); the criteria therefore state **deltas over the same run with one dataset**, which are
what the change adds. Files to change: `run-detail/components/RunHero.tsx` (+ `lib/heroModel.ts` `headerChips`), `ReportSections.tsx`
(`SectionKey`, `useSectionEntries`), a new `panels/DatasetsSection.tsx`, `items/ItemsTable.tsx`, `items/FilterBar.tsx`, `lib/rowMeta.ts`,
`runs-list/cells.tsx`, `runs-list/FiltersPopover.tsx`, `compare/components/RunCards.tsx`, `compare/components/Notices.tsx`, `api/runs.ts`, `types.ts`,
`ui/EntityTag` (a `wrap` option for `DatasetTag` is not needed: the chip is its own recipe).

### 4.1 S1 The run hero (`multi-page-run`, `multi-state-many`)

| Id | Element | Width | Criterion |
|---|---|---|---|
| QC-U1 | `run-hero` | 1440 / 1024 / 390 | a union run's hero is the single-dataset hero plus the Datasets group: **+41.5 / +71 / +193 px** over the same run with one dataset (mock 150.7 / 222.4 / 468.8 against 109.2 / 151.4 / 275.8); the width of the card does not change (1193 / 777 / 279) |
| QC-U2 | `run-hero-strip` | all | still seven facts in the same grid (7 columns at 1440, 4 at 1024, 2 at 390); heights unchanged from today: **39.2 / 81.4 / 185.8**. The second fact reads **Datasets** (plural, same `--font-sm` 600 uppercase label as the others) for a union run and **Dataset** otherwise |
| QC-U3 | `hero-datasets-fact` | all | a link (`data-link="block"`, no underline) around `Tag kind="count"`: database glyph 12, then `3 datasets` (`{n} datasets`, `1 dataset` never occurs); **92 x 20** for 3, **98 x 20** for 12; it jumps to `#run-section-datasets`; `title` lists `name version` of every entry, comma separated. A single-dataset run keeps `DatasetTag` and its `MetaLink` to the dataset |
| QC-U4 | `hero-context` | all | the Datasets group is the **first** group of the existing context band (same hairline, same `flow`, same exact "+ N more"); its label is **Datasets** in the `groupLabel` style (`--font-sm`, 600, uppercase, `--text-muted`). The band's height: **33.5** (1440, one line: Datasets, Versioning and Config share the line), **63** (1024, two lines), **185** (390, flow clamped at 144 + the more button) |
| QC-U5 | `hero-dataset-chip` | all | one chip per entry, in list order: min height 24 (24.5 measured), padding 3 x `--space-sm`, `--bg-elevated`, `--control-radius`, content in order: 12 px database glyph (muted), name (`--font-base`, primary, sans), version (mono `--font-sm`, `--accent-primary`, `v3`), alias when the run resolved one (mono `--font-sm`, secondary, `production`), item count (mono `--font-sm`, muted, `412 items`). Measured at 1440: **209.2 x 24.5**, 209.2 x 24.5, 248.6 x 24.5 (the third has an alias) |
| QC-U6 | chip text | 390 | a name is never cut (DESIGN_LANGUAGE section 7): `overflow-wrap: anywhere`, the chip may take the whole line (max `100%` = 235 px) and wrap its name; the version and count never wrap internally. Measured at 390: first chip **169.3 x 45** (two lines, the label shares the line), second 209.2 x 24.5, third 235 x 45; `scrollWidth <= clientWidth`, computed `text-overflow` is not `ellipsis` |
| QC-U7 | chip target | all | a live dataset's chip is a link (`data-link="block"`) to that version's page (`/projects/{slug}/datasets/{dataset_slug}?v={version}`; hover = border `--border-strong` and primary text, no underline, no transform); a deleted dataset's chip is a `span`, not focusable (QC-U43) |
| QC-U8 | clamp | all | the group obeys the band's clamp: two lines (54 px flow) from 560 px of container, five lines (144) below; the chips that start below the limit are counted and the button reads `+ N more` with N exact: with 12 datasets (+ Versioning + Config) N = **6 at 1440, 10 at 1024, 10 at 390**; pressing it shows every chip (the existing toggle and `qym:run-hero-more` storage) |
| QC-U9 | group presence | all | the group exists only when `run.dataset_count > 1`; a run with `datasets` of length 1 shows today's header; the group is never hidden behind a tab or a hover |
| QC-U10 | semantics | all | the group is `role="list" aria-label="Datasets"` with `role="listitem"` chips (the band's pattern); axe: 0 violations at the three widths |
| QC-U11 | section nav | all | a **Datasets** entry with a count (`3`) follows Overview, only for a union run; count = `dataset_count`; the nav stays **44 px** high; `#run-section-datasets` and `?panel=datasets` (`SectionKey 'datasets'`, `SECTION_KEYS` after `overview`) open the section; an old link without it is unaffected |

### 4.2 S2 The Datasets section (`multi-page-run`, `multi-state-loading`)

| Id | Element | Width | Criterion |
|---|---|---|---|
| QC-U12 | `run-section-datasets` | all | a `ReportSection` between Overview and Latency; title **Datasets**; description (verbatim) **Scores per source dataset. The run's own mean is the summary row; the grey figure is each dataset's distance from it.**; aside `Tag kind="count"` `3 datasets`. Section height with 3 rows: **339.5 / 351.5 / 682.4** at 1440 / 1024 / 390 (12 rows: 699.5 / 711.5 / 2149.1) |
| QC-U13 | breakdown table | 1440 / 1024 | a `DataTable` (`aria-label="Scores per dataset"`), width = the column minus its 2 px frame: **1191 / 775**, **no horizontal scroll at 777** (the mock's widths: Dataset flex min 150, Items 60, Errors 60, each metric 104, action 88). Rows: group band 24 ("Mean score"), header 34, body rows **40**, summary row 32; total **210** for three datasets |
| QC-U14 | columns | all | Dataset (`DatasetTag`: name, `v3`, alias tag), Items (mono, right), Errors (mono, right), one column per run metric under the group **Mean score**, an action column. Metrics follow the run's metric order (the Overview order); no sorting (the order is the run's list order); a column header is the metric name as written (never uppercased in the data, the table header style applies) |
| QC-U15 | score cell | all | `ScoreValue` (digits 1, direction from the metric spec, band colour **plus** the 2 px bar) then the delta: mono `--font-sm`, `--text-muted`, text `+1.9` / `−2.8` / `0.0` (U+2212 minus; `0.0` when the distance is under 0.05); the delta is dataset mean minus run mean in percentage points for percent metrics and the raw difference for others; colour never carries the sign |
| QC-U16 | summary row | all | label **All datasets** (`--font-base`, 650), total items and errors, and the run's own mean per metric: equal to the Overview cards at the displayed precision (**68.9% / 85.5% / 78.1%** in the mock) and to the item-weighted mean of the rows (QC-70) |
| QC-U17 | untagged items | all | when the route reports `unassigned` (QC-72) a muted last body row **Not tagged** with its item count; otherwise no such row |
| QC-U18 | action | all | **Show 412** (`--font-base`, `--accent-primary`, `data-link="block"`, chevron 12) sets the Items section's Dataset filter to that entry and scrolls to `#run-items`; client-side, 0 requests; keyboard: a link, Enter activates; label is `Show {items}` with the row's own count |
| QC-U19 | 390 | 390 | card mode (`DataTable` cards): title = the Dataset cell, body grid = Items, Errors, the three metrics with their labels (priority 2), the action; three rows measure **488.9** px (about 155 per card); no card is wider than 277 |
| QC-U20 | loading | all | `multi-state-loading`: the same DOM with `Skeleton kind="value"` in every number cell and the real Dataset cells (the run payload already knows the names); the section is **339.5 / 351.5 / 682.4**, identical to the loaded section (**0 px** difference, measured); the number of skeleton rows = `dataset_count` |
| QC-U21 | request | all | the table is fed by `GET /api/runs/{id}/datasets` (QC-68), requested with the page's core queries when `dataset_count > 1` (load by default; never on a click), **0 requests** for a single-dataset run; an error shows the section's `ErrorState` with Retry and leaves the rest of the page intact |

### 4.3 S3 Items: the Dataset column and filter (`multi-page-run`, `multi-page-run-filtered`)

| Id | Element | Width | Criterion |
|---|---|---|---|
| QC-U22 | `dataset-filter` | all | in the Items bar: a `Select` "Dataset" (label `--font-sm` 650 muted, value `--font-base` primary): **149.4 x 24** with the value **All datasets**, **184.4 x 24** with `support-tickets v4`; options: All datasets, then each entry `name vN` with its item count (`support-tickets v3  412`); present only for a union run; URL `?dataset=support-tickets@v4` (the label of QC-11 without the index; two entries with the same label cannot exist, QC-8) |
| QC-U23 | active chip and count | all | an active choice adds `Chip` **Dataset: support-tickets v4** (removable, label `Remove filter Dataset: support-tickets v4`) and the count line reads **438 items** (it reads `946 items` otherwise); removing the chip returns to all |
| QC-U24 | Dataset column | 1440 / 1024 | `Dataset` column (224 px, priority 1) with `DatasetTag` (name and version), shown only for a union run; the **Item** column shows the raw id from `qym_item_id` (96 px, mono) and the full namespaced id is in the item detail and the CSV export; `#` stays the run index |
| QC-U25 | identity | all | two items that share a raw id in different datasets (`t-0007` in v3 and in v4) are two rows with distinct keys (the namespaced id); selecting, expanding, review and the pager address them by the namespaced id |
| QC-U26 | scope | all | the page-wide scope (metric cards, charts, counts) follows the Dataset filter through the existing scope mechanism and prints the scope note **over 438 of 946 items**; the Datasets section is **not** filtered by it (it is the breakdown of the whole run) |
| QC-U27 | metadata | all | the existing metadata filter lists the `qym_*` keys like any metadata; the Dataset filter is the product's way to the same rows |
| QC-U28 | export | all | the items CSV of the page (and `qym` results CSV, QC-22) has `dataset` and `dataset_version` columns for a union run |
| QC-U29 | accessibility | all | axe 0 violations on the union page at 1440 and 390; Tab order hero -> Datasets fact -> chips -> nav -> table links -> filter; every interactive element has a visible 2 px `--accent-primary` focus outline |
| QC-U30 | restricted | all | a union run with a restricted or private entry shows the existing banner (`restricted-dataset-banner` / `private-test-set`); the hero chips, the Datasets section and every score stay visible, the Items rows are hidden as today; the Dataset filter is hidden with the rows |

### 4.4 S4 The runs list (`multi-page-runs`)

| Id | Element | Width | Criterion |
|---|---|---|---|
| QC-U31 | Dataset cell, union | all | `Tag kind="count"` with the database glyph and **3 datasets** (`dataset-count-tag`, **92 x 20**; `12 datasets` 98 x 20), `title` = `name vN` of every entry joined by ` · `; it is text in the cell (not a link: the row's link is the run); never an ellipsis |
| QC-U32 | Dataset cell, single | all | exactly today's `DatasetTag` (name, version, alias tags) |
| QC-U33 | column width | 1440 / 1024 | the Dataset column's default width is **120 px** (today about 110, which already ellipsises `support-tic…` and loses the name beside an alias tag); users' saved widths win; the union tag fits (92 + 2 x 8 padding = 108 <= 120, 114 <= 120 for 12) |
| QC-U34 | filter | all | the Dataset filter popover lists real dataset names (QC-66); choosing `support-tickets` shows its single-dataset runs **and** the union runs that include it; the chip reads `Dataset: support-tickets`; the URL parameter is unchanged (`dataset=`) |
| QC-U35 | search and sort | all | the run search matches an entry name; sorting by the Dataset column sorts by `Run.dataset` (the label; union runs sort by their first entry's name, as the label starts with it) |
| QC-U36 | table at 777 | 1024 | the reduced table of the mock (Run, Status, Model, Dataset, Date, answer_correctness) is **775** wide and does not scroll; the real table keeps its own columns and scroll |

### 4.5 S5 Compare (`multi-page-compare`)

| Id | Element | Width | Criterion |
|---|---|---|---|
| QC-U37 | run cards | all | the card's Dataset fact reads **Datasets** + the count tag for a union run (same 92 x 20) and today's `DatasetTag` otherwise; card height unchanged: **142.6** (mock, 4 facts), widths **589.5 / 381.5 / 279** |
| QC-U38 | notice | all | `compare-datasets-notice` (`role="status"`, info tone, the existing Notices recipe) appears when the runs do not evaluate the same set of dataset versions; title **The runs evaluated different datasets**; body **Run A evaluated 3 datasets and run B evaluated 1. Items are matched by dataset and item id, so the two runs share 0 items; the metric averages below are still comparable as run means.** (numbers filled in; names the runs by their letters); heights **57 / 73.8 / 124.2** at 1193 / 777 / 279; absent when every run has the same dataset set |
| QC-U39 | alignment | all | two union runs over the same entries align item by item (QC-67) and show no notice; a union run and a single run: 0 shared items, the existing "no common items" states appear below the notice, the metric averages stay |
| QC-U40 | "What differs" | all | the disclosure (`differingContext`) lists `datasets` among the differing settings when the sets differ, as `3 datasets` / `support-tickets v3` |

### 4.6 State sheets

| Id | Case | Criterion |
|---|---|---|
| QC-U41 | `multi-state-single` | a single-dataset run: hero **109.2 / 151.4 / 275.8** (mock) = today; fact label **Dataset** with `DatasetTag`; no `hero-context` Datasets group, no Datasets nav entry, no Datasets section, no Dataset column or filter, no `/datasets` breakdown request; the page is today's page (the e2e compares the DOM of the sections to the baseline) |
| QC-U42 | `multi-state-loading` | QC-U20: section height at the loading frame equals the loaded one, 0 +- 1 px, at the three widths and at 12 rows (2149.1 at 390) |
| QC-U43 | `multi-state-deleted` | `billing-faq` deleted after the run: its chip and its table cell stay (name, `v7`, `production`, `96 items`) with a muted tag **deleted** (`--font-sm`, `--bg-active`); the chip is a `span` (no link, not focusable), the table's Show link still works (items are the run's own); the hero grows by one line at 1440 (**180.2** against 150.7: the Config chip wraps) and not otherwise; every number is unchanged |
| QC-U44 | `multi-state-many` | 12 datasets: the Datasets group clamps (QC-U8: "+ 6 more" at 1440), the hero is **180.2 / 222.4 / 468.8**; the table has 12 rows (12 x 40 + 24 + 34 + 32 = 570 at 1440 and 1024); section **699.5 / 711.5 / 2149.1**; at 50 datasets the table is a normal long table (no virtualisation needed below 100 rows) |
| QC-U45 | SDK viewer | the local viewer (`frontend/src/sdk-viewer/`, `qym ui` and `--local-ui`) shows the same hero group, Datasets section (computed client-side from the complete rows, no request), Dataset column and filter for a union file; the rows come from `item_metadata.qym_*`; a file without the tags renders as today |
| QC-U46 | copy | all copy is verbatim as in this section; no exclamation marks; numbers in the sentence; typographic apostrophes |

### Screenshots index

| File pattern | What |
|---|---|
| `current-run-*`, `current-runs-*`, `current-compare-*` | today's run page (hero, Overview start), runs list and compare of `support-tickets` runs at 1440 / 1024 / 390 |
| `mock-c-page-run-*` | the union run page as specified (full shell, hero to the Items table) |
| `mock-c-page-run-filtered-*` | after Show 438: Dataset filter and chip, count 438 |
| `mock-c-page-runs-*`, `mock-c-page-compare-*` | runs list and compare as specified |
| `mock-c-state-{single,loading,deleted,many}-*` | state sheets |

---

## 5. Voice and copy checklist (all verbatim)

**Datasets**, **Dataset**, **All datasets**, **Not tagged**, **{n} datasets**, **{n} items**, **Show {n}**, **Mean score**, **deleted**, **Dataset: {name} {version}**,
**Remove filter Dataset: {name} {version}**, **over {n} of {total} items**, the description of QC-U12, the notice of QC-U38, `+ N more`.
SDK messages: **dataset list is empty**, **a dataset takes a version or an alias, not both**, **a local file has no version**, **at most 50 datasets per run**,
**dataset {name} {version} is listed twice**, **Resume dataset version mismatch: {name} was {a} in the checkpoint and resolves to {b} now. Pin the version ({name}@{a}) to resume.**,
**Provide either --dataset (repeatable) or --dataset-file, not both.**, **dataset {name} {version} has no active items**.

## 6. Decisions (what the brief left open; reverse by editing the named place)

| Id | Decision | Reason | How to reverse |
|---|---|---|---|
| QC-D1 | Python strings in a list are names and are never parsed for `@`; only the CLI parses `name@v3` | a Python string is data (a dataset may be called `a@b`); the single-string call stays byte-for-byte | add `DatasetRef.parse` to `Evaluator` for strings (rejected: changes today's meaning of a name with `@`) |
| QC-D2 | Union item id is `"{name}@{resolved version}/{raw id}"`, the raw id is kept in `qym_item_id` | unique even when the same dataset appears twice; readable in the UI and CSV; stable when the list is reordered (an index prefix `0/` is not); the resolved version (not the alias) makes two runs over the same versions align (compare) | `UnionDataset._item_id` |
| QC-D3 | Single-dataset runs have no `run_datasets` rows and no backfill; readers synthesise one entry | a backfill of every run is a long migration on the biggest table for no behaviour; one place (`run_datasets` helper) hides the difference | add rows lazily or by a maintenance job |
| QC-D4 | `Run.dataset` for a union run is the label (`a@v3 + a@v4 + b`), not the first name; the id fields are the first entry's | dashboards, charts, run filters, results file names and the resume check group by this string; the first name alone would put a union run into `support-tickets`' combos. The brief's "single fields hold the first entry" is kept for the id fields and the contract's `datasets[0]` | send the first name (and add the `dataset_count` guard to every grouping) |
| QC-D5 | `runs.dataset_count` and `run_items.dataset_position` are columns | a count the lists and the best-run guard read without a join; a position the breakdown groups by without JSON extraction on a big JSON column (dialect-specific, slow) | derive from `run_datasets` / `item_metadata` |
| QC-D6 | `datasets` is uploaded only for two or more entries | a single run's payload stays byte-identical (QC-27); the platform treats a one-entry list as no list anyway | always send it |
| QC-D7 | Entries load sequentially, in list order | deterministic order and error attribution; dataset reads are paged and fast; parallel loading is an optimisation, not a contract | thread pool in `get_items` |
| QC-D8 | Compare aligns by the stored item id; a union run shares no items with a single-dataset run and the page says so | alignment is computed per run, before any pair is known; making a union item answer to its raw id when the other run is a single dataset needs a pairwise step | a pairwise `compare_item_id` normaliser using `qym_item_id` when the other side has exactly one dataset (an open improvement, recorded, not built) |
| QC-D9 | Union runs are excluded from the best-run index, best-run base and per-version trends | scores over different item sets are not comparable with a single-dataset run; ranking one against the others is wrong, hiding them is safe | rank them in their own scope keyed by the sorted version ids |
| QC-D10 | The breakdown is its own route (`/api/runs/{id}/datasets`), not part of the run payload | DESIGN_LANGUAGE section 7: a request returns what its view renders; the run payload is already large; the route is 4 statements | add `datasets[].metrics` to the payload |
| QC-D11 | The Datasets group lives inside the hero's context band (first group), the fact strip only carries the count | the band already clamps, counts hidden chips exactly and has the labelled-group pattern; a new band would need a second clamp; cost +41.5 px at 1440 | a dedicated band under the strip (rejected: +66 px and a second clamp) |
| QC-D12 | The hero chip is its own recipe (name wraps); the table and the runs list keep `DatasetTag` | the rule "a name is never truncated" cannot be met by `DatasetTag` (ellipsis by design, 3 call sites); the section table has a flex column wide enough (566 px at 1440) | give `DatasetTag` a `wrap` prop and use it in the chip |
| QC-D13 | The same resolved dataset version twice is an error | silently dropping it changes the item count the user asked for; keeping both double-weights it | de-duplicate with a warning |
| QC-D14 | Resume checks resolved versions per entry and fails with a message that names the pinned spelling | an alias that moved between sessions would give new item ids and re-run everything while appending to the same file | resume by label only (today's check) |
| QC-D15 | CLI: `name@v3`, `name@alias:production`; a local path wins over suffix parsing; a suffix beats `--dataset-version` for its entry | the brief's proposal; one flag per value keeps shell history readable; Windows paths and `./a@b.csv` work | `--dataset-ref name,version=v3` |
| QC-D16 | At most 50 datasets per run | a table, a chip group and an id label stay readable; the SDK, the platform and the service share one number | a larger constant in three places |
| QC-D17 | SDK and platform go to 2.1.0 | additive API, additive schema | none |
| QC-D18 | The local viewer computes the breakdown client-side | the file holds every row; there is no server | none |
| QC-D19 | Items with no tag in a union run are reported as `unassigned` | a client that did not tag (older SDK, an upload) must not break the table's totals | drop untagged items from the totals |
| QC-D20 | **Show N** is a client-side filter, not a navigation | the rows are loaded with the page; no request, URL-backed | link to a server-filtered list |
| QC-D21 | No `EvaluatorConfig.datasets` field | two ways to say the same thing; `--config file.json` users pass datasets on the command line | add `config["datasets"]` read by the CLI |
| QC-D22 | Different input columns across entries give `input_cols = []` and a warning | the evaluator maps single-column datasets by name; a wrong common column would silently feed the wrong field | refuse datasets with different columns |
| QC-D23 | The runs-list Dataset cell is a count tag, not "first name + 2" | the column is 120 px; a name would ellipsise (today it already does) and the count is what matters; the full list is the tag's title and the run page's group | first dataset plus a `+2` tag, column 170 |
| QC-D24 | The runs-list Dataset column default width 120 | fits the count tag and is 10 px more than today for names | leave 110 |
| QC-D25 | The offline export shows the entries as plain text only | the frozen template must not grow app logic | no change to the export |

## 7. Contract notes for WP-D (changes or precisions to `BRIEF.md` section 5; the brief is not edited)

1. **How the worker uses it.** `evaluator.datasets[i]` maps 1:1 onto `DatasetRef`: `DatasetRef.from_dict({"dataset": ..., "version": ..., "alias": ...})`; the worker passes a list to `Evaluator(dataset=[...])`. SDK >= 2.1.0 is required for `datasets`; a worker with an older SDK must not declare `datasets` in its schema (that is how F3 detects it).
2. **The upload's `dataset` string is the label, not the first name** (`"a@v3 + a@v4 + b@production"`). The brief says the single fields hold the first entry: that stays true for `dataset_id`, `dataset_version_id` and `dataset_alias`, and for `datasets[0]`; the name string is the label because every grouping on the platform keys on it (QC-D4). The service's own `evaluator.dataset` / `dataset_version` (first entry, compatibility) is unaffected.
3. **Entry fields.** The upload entry is `{dataset, dataset_id, dataset_version_id, version, alias, items, disabled_items}`. `version` is the **resolved** label even when the request named an alias; `alias` is the alias used (`production` for a plain entry). `GET /evals/{id}` `result.datasets` should echo `describe()` of the worker's `UnionDataset` (same keys); `eval_input.datasets` stays as submitted (`version` / `alias` null as sent).
4. **Validation to mirror (422).** 1 to 50 entries; `dataset {name} {version} is listed twice` for a repeated pair (an alias and a version that resolve alike are caught by the SDK at load); a `datasets` entry with both `version` and `alias`: `a dataset takes a version or an alias, not both`.
5. **Item identity for any consumer of events.** Item ids of a union run are `"{name}@{version}/{raw}"` and `item_metadata` carries `qym_dataset`, `qym_dataset_version`, `qym_dataset_index`, `qym_item_id`, `qym_dataset_version_id` (QC-11, QC-13). A service that post-processes items must not assume `item_id` is a dataset item id.
6. **Best-run base.** A combined job's run cannot serve as a best-run base or be ranked (QC-76, QC-D9); WP-D's presets and "best run" base selection must show it as not rankable (`reason: "union_run"`).
7. **Experiment detail.** The run link of a combined job goes to the run page of this package; WP-D shows `run.dataset_count` and `run.datasets[].version` from `GET /api/runs/{id}` (QC-63, QC-84) if it wants a per-job dataset summary.
8. **Task selection** (the second feature) needs nothing from the SDK in this package: `evaluator.task` is read by the worker; the run's `task` label is set by the existing `task_name`.

## 8. Test plan

| File | Covers |
|---|---|
| `tests/sdk/test_dataset_ref.py` (new) | QC-1 to QC-6, QC-8 (type errors, empty list, `DatasetRef` rules, `from_dict`, parse grammar of QC-31, local path precedence) |
| `tests/sdk/test_union_dataset.py` (new, fake `QymDataset` pages through a stub HTTP server as `test_dataset*.py`) | QC-7, QC-10 to QC-20 (order, namespaced ids, collisions, 200-char shortening, tags, label, `describe`, disabled sums, empty entry, input columns), QC-2 (single spellings equal) |
| `tests/sdk/test_evaluator_union.py` (new) | QC-20, QC-21 to QC-24 (run end to end on `InMemoryDataset`s, results file name and columns, checkpoint reads the file, interrupt and resume, version-mismatch error), QC-9 (`RunSpec` list) |
| `tests/sdk/test_platform_client_datasets.py` (new) | QC-27 to QC-29 (payload with and without `datasets`; JSON body of a single run byte-identical to 2.0.0 golden) |
| `tests/sdk/test_cli_multi_dataset.py` (new, Typer runner) | QC-30 to QC-37 (repeatable flag, suffix grammar, defaults, mutual exclusion, exit codes, `--json`, console lines) |
| `tests/platform/test_run_datasets_migration.py` (new) | QC-49, QC-50 (heads, up / down / up on SQLite, parity with `create_all`; PG when `QYM_TEST_POSTGRES_URL`) |
| `tests/platform/test_run_datasets_ingest.py` (new) | QC-51 to QC-62, QC-80, QC-81 (create with 1 / 3 entries, 422 texts, unknown ids, idempotent `run_started`, `dataset_position`, item link by version + `qym_item_id`, `:upload` field, access, ingest statement count equal to a single run) |
| `tests/platform/test_run_datasets_reads.py` (new) | QC-63 to QC-73, QC-82 (run payload, deleted dataset, list statement count equal at 1 and 200 runs, filter and facet, compare payload, breakdown route numbers against the Python oracle, statement count at 100 and 5,000 items, repeat pass, unassigned, single-run answer) |
| `tests/platform/test_run_datasets_consumers.py` (new) | QC-74 to QC-79, QC-83 to QC-89 (dataset Runs tab and counts include union runs once, item history, best-run exclusion and `union_run` reason, insights, dashboard combo, hard delete cascade, dataset delete sets NULL) |
| `tests/platform/test_sdk_union_roundtrip.py` (new) | QC-90: the real SDK `Evaluator` with two platform datasets against the test client, then every read above |
| `frontend/src/features/run-detail/lib/__tests__/heroModel.datasets.test.ts` (new) | QC-U3, QC-U4, QC-U9 (group model, count tag text, single run unchanged) |
| `frontend/src/features/run-detail/components/panels/__tests__/DatasetsSection.test.tsx` (new) | QC-U12 to QC-U21 (columns, deltas and the minus sign, summary row equals Overview, untagged row, loading frame rows, error state, Show link) |
| `frontend/src/features/run-detail/components/items/__tests__/datasetFilter.test.tsx` (new) | QC-U22 to QC-U28 (filter, URL, chip, count, column, raw id, scope note, CSV columns) |
| `frontend/src/features/runs-list/__tests__/datasetCell.test.tsx` (new) | QC-U31 to QC-U35 |
| `frontend/src/features/compare/components/Notices.test.tsx` (extend) | QC-U37 to QC-U40 |
| `frontend/src/__tests__/design-language.test.ts`, `tests/platform/test_design_language.py` | the new CSS (no hex, no px font sizes, `data-link="block"` on the new links) |
| `frontend/e2e/run-detail/multi-dataset.spec.ts` (new; seeds through the events API as `measure/seed-c.mts` does, with tagged items) | QC-U1 to QC-U30 measured at 1440, 1024 and 390: hero deltas (+41.5 / +71 / +193), fact 92 x 20, chips 209.2 x 24.5, clamp counts 6 / 10 / 10, section heights 339.5 / 351.5 / 682.4, table 210, loading frame 0 px difference, filter 149.4 x 24, axe, keyboard path |
| `frontend/e2e/run-detail/multi-dataset-states.spec.ts` (new) | QC-U41 to QC-U44 (single run DOM equals baseline, deleted dataset, 12 datasets) |
| `frontend/e2e/runs-list/multi-dataset-cell.spec.ts` (new) | QC-U31 to QC-U36 |
| `frontend/e2e/compare/multi-dataset-notice.spec.ts` (new) | QC-U37 to QC-U40 |
| `frontend/e2e/sdk/multi-dataset-viewer.spec.ts` (new; `npm run e2e:sdk`) | QC-U45, QC-25 (a union results file opened in the local viewer) |

Gate: `scripts/heavy.sh --cost 3 -- bash -c 'cd frontend && npm run check'`; `pytest tests/sdk` (cost 3); `tests/platform` in chunks of about 48 files (cost 4) plus the
Postgres run; `scripts/heavy.sh --cost 4 --name e2e -- bash -c 'cd frontend && npm run e2e'` and `e2e:sdk`.

## 9. Hand-off (build order for the implementer; ports 8998 / 5998)

1. **Model and migration** (`db/models.py`: `RunDataset`, `Run.dataset_count`, `RunItem.dataset_position`; `migrations/versions/0089_run_datasets.py`; parity test). QC-49 to QC-52.
2. **Platform helper** `services/run_datasets.py`: `RunDatasetEntry` validation (QC-52), `store_run_datasets(db, run, entries)`, `run_datasets_payload(db, runs)` (batched), `run_has_version` clauses (QC-74).
3. **Ingest** (`api/ingest.py`: `CreateRunRequest.datasets`, create path QC-53 to QC-57, `RunStartedPayload.datasets`, `item_started` position and link QC-58, `:upload` field QC-60). Run `tests/platform -k ingest` after.
4. **Reads** (`api/runs.py`: `_dataset_version_info_map` extension, run payload, list payload and filter, compare payload; the breakdown route in a new `api/run_datasets.py` or beside the run routes; access QC-62). QC-63 to QC-73.
5. **Consumers** (`api/datasets.py` Runs tab, counts, lineage and item history; `eval_best_run*.py`; `insights.py`; `dashboard_outbox.py`). QC-74 to QC-79.
6. **SDK core** (`core/dataset.py`: `DatasetRef`, `UnionDataset`, `resolve_datasets`; `Evaluator.__init__` accepts a list, `_build_run_info`; `core/config.py` unchanged; exports in `qym/__init__.py`; `RunSpec`). QC-1 to QC-20.
7. **SDK run and files** (`evaluator.py`: `describe()` into `run_metadata`, create-run and `run_started` payloads; `results.py` columns QC-22; `checkpoint.py` resume check QC-23; file name QC-21). QC-21 to QC-29.
8. **CLI** (`cli/run.py` repeatable `--dataset`, `DatasetRef.parse`, messages; `cli/_platform_api.py` and `qym run list/get` fields). QC-30 to QC-37.
9. **Frontend types and API** (`api/runs.ts`, `features/run-detail/types.ts`: `dataset_count`, `datasets`, the breakdown query with the page's staged loading).
10. **Hero** (`RunHero.tsx`, `lib/heroModel.ts` `headerChips` Datasets group first, the Datasets fact; CSS from `MultiSdkMocks.module.css` `.ds*`, `.countLink`). QC-U1 to QC-U10.
11. **Section and nav** (`panels/DatasetsSection.tsx`, `ReportSections.tsx` `SectionKey`, `useSectionEntries`, `SectionNav`). QC-U11 to QC-U21.
12. **Items** (`ItemsTable.tsx` column, `FilterBar.tsx` Dataset select, `rowMeta.ts`, scope note, CSV). QC-U22 to QC-U30.
13. **Runs list and compare** (`runs-list/cells.tsx`, `columns.ts` width, `FiltersPopover.tsx`; `compare/RunCards.tsx`, `Notices.tsx`, `runInfo.ts`). QC-U31 to QC-U40.
14. **SDK viewer** (`frontend/src/sdk-viewer/`: the same hero group, section and filter from rows). QC-U45.
15. **Docs** (USER_GUIDE "Evaluating several datasets", the SDK reference, RELEASE_NOTES 2.1.0, `--help`), version bump (QC-47).
16. **Tests and gate** as section 8; after-screenshots `after-*` of the three composed pages and the four states at the three widths; criterion -> change -> test table in `impl-notes-c.md`.

Gallery recipe to move: `.dsChip`, `.dsName`, `.dsVersion`, `.dsAlias`, `.dsCount`, `.dsDeleted`, `.countLink`, `.delta`, `.showLink`, `.datasetFilter`, `.filterLabel`, `.filterValue`. Delete `MultiSdkMocks.tsx` only after the review stage.

## 10. What could not be measured, and why

* **The real `RunHero`.** The mock draws the hero from the real `RunHero.module.css` classes without the pager, live indicator and status extras, so absolute hero heights differ from the product by the same amount for one dataset (today 305.8 against 275.8 at 390); the deltas are what is specified (QC-U1). The reviewer measures the deltas in the product.
* **The open Dataset select** (QC-U22 options): the `Select` popup is not drawn statically; the closed control is measured, the options are specified as text.
* **The runs list is a reduced table.** The product table has 24 columns in four groups and its own scroll; only the Dataset column's cell and width (QC-U31 to QC-U33) and the filter are the contract. The product's Dataset column at 1440 measures about 110 px today (header 918 to 1020 in `current-runs-1440.png`).
* **The compare page body.** The mock draws the cards and the notice; the body below them (matrix, tables) is unchanged and shows its existing empty states for a pair with no shared items.
* **PostgreSQL.** Not started here (no `QYM_TEST_POSTGRES_URL` for this session); the migration and the grouped query are specified from the 0077 / 0088 patterns and are run by the implementer's gate.
* **A real union run.** No SDK code exists yet, so the numbers of the Datasets section come from the mock's data (`ENTRIES` in `MultiSdkMocks.tsx`: 412 + 438 + 96 = 946 items, 8 errors, means 68.9 / 85.5 / 78.1 %), computed to agree with their weighted means; the implementer's e2e seed must reproduce them (the seed in `measure/seed-c.mts` builds the single-dataset baselines only).
* **Item pager and review of a namespaced id.** QC-U25 is specified from the code paths (`item_id` is an opaque string in `items/details`); the implementer verifies the pager and review flows with a `/` in the id.
* **Keyboard focus order** (QC-U29) is specified, not run: the mock's links are real anchors, the order is DOM order.
