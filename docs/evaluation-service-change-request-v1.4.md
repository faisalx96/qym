# Evaluation Service change request: guide v1.4 (several datasets per job, task selection)

Status: request to the Evaluation Service team, drafted 2026-10-22 by the qym platform team (feature round "multi-dataset /
multi-version evaluations and task selection", owner decisions F1 to F4). Companion of
`docs/evaluation-service-api-integration-v1.3.md`: **v1.3 stays valid; every addition below is optional, additive and
ignored by a client that does not send it.** The qym platform adopts the new fields only for an environment whose service
declares them (section 8), so the two sides can ship in any order.

What we ask for, in one paragraph. Two optional fields on `EvaluatorInputs` (`datasets`, `task`), one new read-only endpoint
(`GET /evals/tasks`), the matching additions to `GET /evals/evaluator/schema`, two new keys in the job's echo and result
(`eval_input.datasets` / `eval_input.task`, `result.datasets` / `result.task`), and the validation rules of section 5.
No change to `config`, `env_overrides`, priorities, latency gating, the job lifecycle or any existing status code.

## 1. Motivation

1. **Several datasets and several versions in one evaluation.** Teams evaluate an agent on more than one test set at once
   (for example `support-tickets` and `billing-faq`) and on more than one version of the same set (`v3` against `v4`, to see
   what a dataset change did to the score). Today one job evaluates exactly one `dataset` at one `dataset_version`; the platform
   can only create one job per pair and the results cannot be read as one run with a per-dataset breakdown.
2. **Choosing the task to evaluate.** An Evaluation Service deployment knows more than one agent entry point (a task:
   "answer a ticket", "summarise a thread", ...). Today the worker's configuration picks one and `config.task_name` is only a label
   on the run, so a user who wants the other task needs another deployment or another environment.

Owner decisions that shape this request (final): **F1** the user chooses at launch between "Combine into one run" (one run over
the union of the selected dataset versions, every item recording its source dataset and version) and "One run each" (one
job per pair); **F2** the service lists the selectable tasks (`GET /evals/tasks`) and the job names one (`evaluator.task`);
**F3** an environment whose service has not adopted this contract keeps working: the platform sends one job per pair and never a
list; **F4** this document.

## 2. What changes at a glance

| Where | Change | Required |
|---|---|---|
| `POST /evals` body, `evaluator.datasets` | new optional list of `{dataset, version, alias}` | no |
| `POST /evals` body, `evaluator.task` | new optional string, an id from `GET /evals/tasks` | no |
| `GET /evals/tasks` | new endpoint, `{"tasks": [...]}` | no (a service without it simply has no task selection) |
| `GET /evals/evaluator/schema` | `properties.datasets`, `properties.task`, `$defs.DatasetRef` | yes, if the fields are implemented (this is how clients detect support) |
| `GET /evals`, `GET /evals/{id}` | `eval_input.datasets` and `eval_input.task` echoed as submitted | yes, if the fields are implemented |
| `result` of a succeeded job | `result.datasets` (what was evaluated), `result.task` (what ran) | yes, if the fields are implemented |
| Guide | v1.4 sections, text in the appendix | merge |

## 3. `evaluator.datasets` (new, optional)

### 3.1 Shape

```jsonc
// POST /evals  -> EvalJobCreate.evaluator
{
  "dataset": "support-tickets",            // unchanged and still required: the FIRST entry of `datasets`
  "dataset_version": "v3",                 // unchanged: the first entry's version (null when it has none)
  "datasets": [                            // NEW. null or absent = v1.3 behaviour
    { "dataset": "support-tickets", "version": "v3", "alias": null },
    { "dataset": "support-tickets", "version": "v4", "alias": null },
    { "dataset": "billing-faq",     "version": null, "alias": "production" }
  ],
  "task": "answer-ticket",                 // NEW, optional, section 4
  "model": "gpt-4o",
  "config": { "run_name": "nightly", "task_name": null, "samples": 1 }
}
```

`DatasetRef` (new model, `extra="forbid"`):

| Field | Type | Notes |
|---|---|---|
| `dataset` | `str`, 1 to 200 chars | a dataset name or id, exactly what `evaluator.dataset` takes today |
| `version` | `str \| null` | a published dataset version. `null` = not given |
| `alias` | `str \| null` | a dataset alias (`production`, ...). `null` = not given |

- At most one of `version` / `alias` is set. Neither set means the dataset's `production` alias, exactly like the v1.3 single
  case (`dataset_version` and `config.dataset_alias` both unset).
- The same `dataset` may appear several times with different versions. **Order is the evaluation order** and the order of the
  items in the union.
- At most **50** entries (the qym platform never sends more than 20; the SDK accepts up to 50).
- `datasets` wins. When it is present, the worker ignores `dataset_version`, `config.dataset_version` and `config.dataset_alias`
  for resolution. They stay in the echo as submitted. The platform still sends `dataset` (= first entry) and `dataset_version`
  (= first entry's version) so that a reader of the echo that only knows v1.3 sees the first pair.

### 3.2 Semantics: one union run

The worker runs **one** evaluation over the concatenation of the resolved datasets and produces **one** run, one `result`, one
report. `samples`, `report_k`, `max_concurrency` and every other `config` field apply to the whole union.

What a union run must record is defined by the qym SDK (2.1.0), so the service gets it by passing the list through to the SDK's
`Evaluator` (`docs/internal/feature-rounds/2026-10-multi-dataset-task/spec-c.md`, section 7 is the contract for this document):

- `evaluator.datasets[i]` maps 1:1 onto the SDK's `DatasetRef`: `DatasetRef.from_dict({"dataset": ..., "version": ..., "alias": ...})`;
  the worker passes the list to `Evaluator(dataset=[...])`. **SDK >= 2.1.0 is required for `datasets`: a worker with an older SDK
  must not declare `datasets` in its evaluator schema**, which is how the qym platform detects it (F3).
- every item records its source: `item_metadata.qym_dataset`, `qym_dataset_version` (the resolved version, never the alias),
  `qym_dataset_index`, `qym_item_id` and `qym_dataset_version_id`. Item ids of a union run are `"{name}@{version}/{raw}"`: a
  service that post-processes items must not assume an `item_id` is a dataset item id. Items of different datasets may share a
  raw id; the SDK keeps them apart in the run, the service does not have to;
- the run upload (`POST /v1/runs`, built by the SDK) carries `datasets: [{dataset, dataset_id, dataset_version_id, version,
  alias, items, disabled_items}]` when there are two or more entries. `version` is the **resolved** label even when the request
  named an alias; `alias` is the alias used (`production` for an entry that named neither). The run's own `dataset` is the
  **label** (`"a@v3 + a@v4 + b@production"`, what every grouping on the platform keys on); `dataset_id`, `dataset_version_id`
  and `dataset_alias` stay the first entry's, so an older platform reads a union run as a run on its first dataset. A
  single-dataset job uploads the byte-identical payload of 2.0.0;
- `GET /evals/{id}` `result.datasets` echoes `describe()` of the worker's union dataset (the same keys as the upload entry);
  `eval_input.datasets` stays as submitted (`version` / `alias` null as sent).
- A combined job's run cannot be ranked or used as a best-run base by the qym platform (`reason: "union_run"`).

**Caps.** The service accepts at most 50 entries and the SDK 50. The qym platform's launch accepts at most 20 dataset versions per
experiment (`QYM_EVAL_MAX_DATASETS`). Both the service and the SDK answer `422` for a repeated pair: the service for two equal
entries (`datasets[<j>] repeats datasets[<i>]`), the SDK additionally after resolving aliases
(`dataset {name} {version} is listed twice`).

Failure: a dataset or version that cannot be resolved fails the job as today (`status: FAILED`, `error` names the entry:
`dataset not found: billing-faq` or `dataset version not found: support-tickets@v9`), after the structural validation of
section 5 has accepted the request. Nothing is partially evaluated: the worker resolves every entry before the first item runs.

"One run each" is **not** a service feature. The platform expands it into one job per pair, each with a single dataset and no
`datasets` field, which is the v1.3 shape.

## 4. `evaluator.task` (new, optional) and `GET /evals/tasks`

### 4.1 The field

`evaluator.task`: `str | null`, 1 to 100 chars, `^[A-Za-z0-9_.:-]+$`. `null` or absent = the worker's default task, exactly
v1.3 behaviour. A non-null value must be one of the `id`s of `GET /evals/tasks`; otherwise `422` (section 5). It selects which
registered task (agent entry point) the evaluation runs. It is independent of `datasets`.

`config.task_name` stays a free label. The run's task label becomes: `config.task_name` when set, else the selected task's `name`,
else what the worker uses today.

### 4.2 `GET /evals/tasks`

```bash
curl -sS "$BASE_URL/evals/tasks" -H "Authorization: Bearer $EVAL_API_KEY"
```

Response `200`:

```json
{
  "tasks": [
    { "id": "answer-ticket", "name": "Answer a ticket", "description": "Reply to a support ticket using the KB.", "default": true },
    { "id": "summarise-thread", "name": "Summarise a thread", "description": null, "default": false }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | `str` | unique, stable, the value of `evaluator.task`; same pattern as 4.1 |
| `name` | `str`, 1 to 120 chars | what the platform shows |
| `description` | `str \| null`, up to 500 chars | one or two sentences |
| `default` | `bool` | exactly one entry has `true` when the list is not empty: the task that runs when `task` is `null` |

- At most 200 entries, in presentation order (the platform shows them in this order, after its own "Worker default" option).
- An empty list is valid ("this deployment has nothing to choose"). The platform then hides the control.
- `503 {"detail": "could not list tasks: <reason>"}` when the registry cannot be read (same convention as
  `versioning-details/current`). The platform shows the reason and keeps launching without a task.
- Registered **before** `GET /evals/{job_id}`. A service that registers it after answers `422` (the path parameter is a UUID),
  and the platform then treats the endpoint as absent; see section 8.
- The list is read by the API server and must match what the workers can run; a worker that no longer knows a task id fails the job
  with `unknown task: <id>` (and the API's validation of section 5 should use the same registry).

## 5. Validation rules and error texts

Structural validation happens in `POST /evals`, before the job row is written, and answers `422`. Two shapes appear:

- Pydantic field errors (the default FastAPI shape, as everywhere in v1.3): `{"detail": [ {"type": "...", "loc": ["body", "evaluator", ...], "msg": "...", "input": ...} ]}`
- Cross-field and registry rules (`HTTPException(422)` with a string): `{"detail": "<text>"}`

| Rule | Status and body |
|---|---|
| `datasets` is `[]` | `422`, field error on `evaluator.datasets`, `msg`: `datasets must not be empty; omit it or give at least one entry` |
| more than 50 entries | `422`, field error, `msg`: `datasets takes at most 50 entries` |
| an entry is not an object, has a blank `dataset`, or has an unknown key | `422`, field error on `evaluator.datasets.<i>` (`extra="forbid"` on `DatasetRef`) |
| an entry sets both `version` and `alias` | `422`, field error on `evaluator.datasets.<i>`, `msg`: `datasets[<i>]: give a version or an alias, not both` |
| two entries are equal (`dataset`, `version`, `alias`) | `422`, `{"detail": "datasets[<j>] repeats datasets[<i>]"}` |
| `dataset` differs from `datasets[0].dataset` | `422`, `{"detail": "evaluator.dataset must equal datasets[0].dataset when both are given"}` |
| `task` is `""` or does not match the pattern | `422`, field error on `evaluator.task` |
| `task` is not an id of the task list | `422`, `{"detail": "unknown task: <id>"}` |
| `task` is set and the service has no task list | `422`, `{"detail": "tasks are not available on this service"}` (a service that implements the field always has the list; this only guards a half deployment) |
| `report_k > samples` and the existing v1.3 rules | unchanged |

Not validated at submit (they are run failures, section 3.2): that a dataset exists, that a version or alias resolves, that the
caller may read it.

Unknown keys: `evaluator` keeps ignoring unknown top-level keys (v1.3), `DatasetRef` rejects them, `config` rejects them as
before. **Nothing new is added to `config`**: a v1.3 service answers `422` to an unknown `config` key, so new options live on
`evaluator`.

## 6. What `GET /evals` and `GET /evals/{id}` return

`eval_input` echoes the validated input as stored, so it gains the two keys as submitted (`null` when not sent):

```json
{
  "id": "5b1e...uuid...",
  "status": "SUCCEEDED",
  "eval_input": {
    "dataset": "support-tickets",
    "dataset_version": "v3",
    "datasets": [
      { "dataset": "support-tickets", "version": "v3", "alias": null },
      { "dataset": "support-tickets", "version": "v4", "alias": null },
      { "dataset": "billing-faq", "version": null, "alias": "production" }
    ],
    "task": "answer-ticket",
    "config": { "...": "full merged EvaluatorRequestConfig" },
    "model": "gpt-4o",
    "report_k": null
  },
  "result": {
    "run_name": "nightly",
    "dataset": "support-tickets",
    "datasets": [
      { "dataset": "support-tickets", "dataset_id": "…", "dataset_version_id": "…", "version": "v3", "alias": null, "items": 120, "disabled_items": 0 },
      { "dataset": "support-tickets", "dataset_id": "…", "dataset_version_id": "…", "version": "v4", "alias": null, "items": 132, "disabled_items": 2 },
      { "dataset": "billing-faq", "dataset_id": "…", "dataset_version_id": "…", "version": "v2", "alias": "production", "items": 48, "disabled_items": 0 }
    ],
    "task": "answer-ticket",
    "versioning_metadata": { "agent_version": "v2.4.0", "kb_version": "4b0535c" },
    "analysis_metric": "accuracy"
  }
}
```

- `result.datasets`: what was evaluated, in evaluation order (`describe()` of the worker's union dataset, the keys of the SDK's
  upload entry). `version` is the **resolved** version (the alias target when an alias or nothing was given), `alias` the alias
  used (`production` when none was given), `items` the number of items it contributed and `disabled_items` those left out. Present for every succeeded job
  of a service that implements the field; a single-dataset job lists one entry.
- `result.dataset` stays the first entry's name (v1.3).
- `result.task`: the id that ran. When the request sent `task: null`, the id of the default task, so the result is always explicit.
  `null` only if the worker has no task registry.
- A job submitted without the new fields has `eval_input.datasets: null`, `eval_input.task: null` and the same `result.*` additions.

## 7. Backward compatibility

| Client | Service | Result |
|---|---|---|
| v1.3 (no new fields) | v1.4 | identical to v1.3. `datasets` and `task` echo as `null`. |
| v1.4 (qym) | v1.3 | **the danger: v1.3 silently drops unknown `evaluator` keys** (guide section 4.1 note). A list sent to a v1.3 service would evaluate only `dataset`, and a `task` would be ignored, with a `202` and no hint. The platform therefore never sends either field to a service whose schema does not declare it (section 8); it sends one job per pair instead and offers no task control. |
| v1.4 (qym) | v1.4 | the fields are sent when the user chose them. |

- No existing field changes type, meaning, default or status code.
- A v1.4 service must keep accepting every v1.3 request byte for byte.
- `GET /evals/tasks` on a v1.3 service answers `422` (the `{job_id}` UUID rule) or `404`; the platform accepts `404`, `405` and `422`
  as "not supported".

## 8. How qym detects support

The platform stores each environment's `GET /evals/evaluator/schema` (guide v1.1, section 3.4) and refreshes it once per launch visit.

| Capability | Detected by | Effect in qym |
|---|---|---|
| several datasets per job | `properties.datasets` declared in the evaluator schema | "Combine into one run" sends `datasets` to this environment. Otherwise the launch creates one job per pair (F3) and says so. |
| task selection | `properties.task` declared **and** `GET /evals/tasks` answers `200` with at least one task | the environment's box shows the task control, "Worker default" first. A `404`, `405` or `422` hides it; a `503` shows the reason. |

An environment with no stored evaluator schema (a service older than v1.1) supports neither. The `datasets` and `task` entries in the
schema must therefore appear **only** in a build whose `POST /evals` really honours them.

Schema additions (exact), in `EvaluatorInputs.model_json_schema()`:

```json
{
  "$defs": {
    "DatasetRef": {
      "additionalProperties": false,
      "properties": {
        "dataset": { "minLength": 1, "maxLength": 200, "title": "Dataset", "type": "string" },
        "version": { "anyOf": [ { "type": "string" }, { "type": "null" } ], "default": null, "title": "Version" },
        "alias":   { "anyOf": [ { "type": "string" }, { "type": "null" } ], "default": null, "title": "Alias" }
      },
      "required": ["dataset"],
      "title": "DatasetRef",
      "type": "object"
    }
  },
  "properties": {
    "datasets": {
      "anyOf": [
        { "items": { "$ref": "#/$defs/DatasetRef" }, "maxItems": 50, "minItems": 1, "type": "array" },
        { "type": "null" }
      ],
      "default": null,
      "title": "Datasets"
    },
    "task": {
      "anyOf": [ { "maxLength": 100, "minLength": 1, "pattern": "^[A-Za-z0-9_.:-]+$", "type": "string" }, { "type": "null" } ],
      "default": null,
      "title": "Task"
    }
  },
  "required": ["dataset"]
}
```

(`required` stays `["dataset"]`; the abbreviation shows only the additions to the v1.3 schema.)

## 9. Versioning

This is **guide v1.4**: `docs/evaluation-service-api-integration-v1.4.md`, v1.3's text plus the appendix sections, with a
changelog line. No new URL prefix, no header, no version negotiation: capability is the schema. A service on v1.4 must not
declare `datasets` before it honours a list, and must not declare `task` before `GET /evals/tasks` answers.

## 10. Examples

### 10.1 curl

```bash
# What can this deployment run?
curl -sS "$BASE_URL/evals/tasks" -H "Authorization: Bearer $EVAL_API_KEY"

# One union run over three dataset versions, a chosen task
curl -sS -X POST "$BASE_URL/evals" \
  -H "Authorization: Bearer $EVAL_API_KEY" -H "Content-Type: application/json" \
  -d '{
        "user_id": "user-123",
        "evaluator": {
          "dataset": "support-tickets",
          "dataset_version": "v3",
          "datasets": [
            {"dataset": "support-tickets", "version": "v3"},
            {"dataset": "support-tickets", "version": "v4"},
            {"dataset": "billing-faq", "alias": "production"}
          ],
          "task": "answer-ticket",
          "model": "gpt-4o",
          "config": {"run_name": "nightly", "samples": 1}
        }
      }'

# Rejected: an entry with a version and an alias
curl -sS -X POST "$BASE_URL/evals" -H "Authorization: Bearer $EVAL_API_KEY" -H "Content-Type: application/json" \
  -d '{"user_id":"u","evaluator":{"dataset":"a","datasets":[{"dataset":"a","version":"v1","alias":"production"}]}}'
# 422 {"detail":[{"type":"value_error","loc":["body","evaluator","datasets",0],"msg":"Value error, datasets[0]: give a version or an alias, not both", ...}]}

# Rejected: an unknown task
curl -sS -X POST "$BASE_URL/evals" -H "Authorization: Bearer $EVAL_API_KEY" -H "Content-Type: application/json" \
  -d '{"user_id":"u","evaluator":{"dataset":"a","task":"nope"}}'
# 422 {"detail":"unknown task: nope"}
```

### 10.2 Python

```python
import httpx

BASE, KEY = "https://eval.example.com", "..."
H = {"Authorization": f"Bearer {KEY}"}

with httpx.Client(base_url=BASE, headers=H, timeout=30) as c:
    r = c.get("/evals/tasks")
    tasks = r.json()["tasks"] if r.status_code == 200 else []
    task = next((t["id"] for t in tasks if t["default"]), None)

    pairs = [
        {"dataset": "support-tickets", "version": "v3"},
        {"dataset": "support-tickets", "version": "v4"},
        {"dataset": "billing-faq", "alias": "production"},
    ]
    body = {
        "user_id": "user-123",
        "evaluator": {
            "dataset": pairs[0]["dataset"],
            "dataset_version": pairs[0].get("version"),
            "datasets": pairs,
            "task": task,
            "model": "gpt-4o",
            "config": {"run_name": "nightly"},
        },
    }
    job = c.post("/evals", json=body)
    job.raise_for_status()
    job_id = job.json()["id"]
    # ... poll GET /evals/{job_id} until SUCCEEDED, then:
    result = c.get(f"/evals/{job_id}").json()["result"]
    for entry in result["datasets"]:
        print(entry["dataset"], entry["version"], entry["items"])
```

## 11. Checklist for the Evaluation Service team

- [ ] `DatasetRef` model; `EvaluatorInputs.datasets: Optional[List[DatasetRef]]` (1 to 50), `EvaluatorInputs.task: Optional[str]`.
- [ ] Validators of section 5 with the exact texts (qym shows the `detail` string to the launcher unchanged).
- [ ] `GET /evals/tasks`, registered before `/{job_id}`, `200` / `503`, exactly one `default` when non-empty.
- [ ] Task registry used by both the API validation and the workers.
- [ ] Worker: resolve every `datasets` entry first, then run **one** evaluation over the concatenation (pass the list to the qym SDK
      `Evaluator`, SDK >= 2.1.0), run the selected task, apply `task_name` fallback to the task's `name`.
- [ ] `eval_input.datasets`, `eval_input.task` stored and echoed; `result.datasets` (the SDK's `describe()` entries: resolved `version`, `alias`, `items`, `disabled_items`) and `result.task`.
- [ ] `GET /evals/evaluator/schema` declares `datasets`, `task` and `$defs.DatasetRef` **only when the above is deployed**.
- [ ] v1.3 requests unchanged (run the existing contract tests untouched).
- [ ] Tests: a union of two datasets, the same dataset at two versions, an alias entry, an empty list, both version and alias,
      a duplicate entry, `dataset` mismatch, `task` unknown, `task` null, a v1.3 body.
- [ ] Guide v1.4: merge the appendix; changelog line.
- [ ] Tell the qym team the build that declares the fields reached a test environment; qym then needs no change.

## 12. Changes from the brief

`docs/internal/feature-rounds/2026-10-multi-dataset-task/BRIEF.md` section 5 was the proposal. What the design changed:

| # | Brief said | This request says | Why |
|---|---|---|---|
| 1 | schema endpoint `GET /evals/schema` | `GET /evals/evaluator/schema` | that is the real path (guide section 3.4); `/evals/schema` does not exist |
| 2 | `GET /evals/tasks`, `404` = unsupported | `404`, `405` **and `422`** = unsupported; register it before `/{job_id}` | a v1.3 service parses `tasks` as the `{job_id}` UUID and answers `422`, not `404` |
| 3 | an empty `datasets` is "absent" | an empty list is `422` | an empty list is always a client bug; silently running the single `dataset` hides it |
| 4 | `datasets` wins over `dataset` / `dataset_version` | same, plus `dataset` must equal `datasets[0].dataset` (`422` otherwise) and the version fields are ignored, not compared | catches a client that edits one and not the other, without a cross-check of aliases |
| 5 | `result.datasets` "lists what was evaluated" | each entry is the SDK's `describe()` (`dataset`, `dataset_id`, `dataset_version_id`, resolved `version`, `alias`, `items`, `disabled_items`); `result.task` added | the platform shows what an alias resolved to and the per-dataset item counts without re-reading the datasets, with the same keys as the run upload |
| 6 | the task label becomes the task's `name` when `task_name` is null | same, and the registry's `default` flag is added to `GET /evals/tasks` | the platform needs to show which task "Worker default" means |
| 7 | no limits | at most 50 `datasets` entries, 200 tasks, id pattern | bounded payloads; the platform itself caps lower |
| 8 | task support = `/evals/tasks` not 404 | schema declares `task` **and** the list answers `200` with at least one task | one signal for "the field is honoured", one for "there is something to choose" |
| 9 | upload details | fixed by the SDK package (section 3.2 and `spec-c.md` section 7): the run's `dataset` is the label, the single fields stay the first entry's, `datasets` entries carry resolved `version` and `alias` | the brief said "the single fields hold the first entry"; that stays true for the ids, while the name string is the label every platform grouping keys on |

## Appendix: draft v1.4 guide sections (text to merge)

The edits below are against `evaluation-service-api-integration-v1.3.md`. Section numbers follow the v1.3 file.

### A. Changelog (top of the guide, after the title block)

```markdown
**v1.4** adds, all optional: `evaluator.datasets` (several datasets and versions in one job, one run over their union),
`evaluator.task` and `GET /evals/tasks` (choose which registered task to evaluate), the matching schema entries, and
`datasets` / `task` in `eval_input` and `result`. A request that does not use them behaves exactly as in v1.3.
```

### B. New section 3.8 (added after 3.7; no renumbering)

```markdown
### 3.8 `GET /evals/tasks` — tasks a job can evaluate

Returns the tasks registered on this deployment. Use it to offer a choice and to validate `evaluator.task` (§4.1).

| Field | Type | Notes |
|---|---|---|
| `tasks[].id` | `str` | unique and stable; the value of `evaluator.task` |
| `tasks[].name` | `str` | display name |
| `tasks[].description` | `str \| null` | one or two sentences |
| `tasks[].default` | `bool` | the task that runs when `evaluator.task` is `null`; exactly one `true` when the list is not empty |

    curl -sS "$BASE_URL/evals/tasks" -H "Authorization: Bearer $EVAL_API_KEY"

    {"tasks": [{"id": "answer-ticket", "name": "Answer a ticket", "description": "…", "default": true}]}

- At most 200 entries; an empty list is valid.
- Returns **503** `{"detail": "could not list tasks: <error>"}` if the registry cannot be read.
- Registered before `GET /evals/{job_id}`; a service that has not implemented v1.4 answers `404` or `422` here.
```

### C. Section 3.4 (evaluator schema): replace the last bullet list's `evaluator` sentence

```markdown
- `config` has `additionalProperties: false` (unknown keys are a **422**), but the top-level `evaluator` object doesn't. Unknown
  top-level keys are silently dropped (see the `metrics` note in §4.1). **v1.4:** `properties.datasets`, `properties.task` and
  `$defs.DatasetRef` are declared only by a service that honours them, so a client can detect support from the schema.
```

### D. Section 4.1: two table rows and one sub-section

```markdown
| `datasets` | `List[DatasetRef] \| null` | no | v1.4. One job over several dataset versions: **one run over their concatenation**. Wins over `dataset_version`, `config.dataset_version` and `config.dataset_alias`. 1 to 50 entries |
| `task` | `str \| null` | no | v1.4. An `id` from `GET /evals/tasks` (§3.8); `null` = the worker's default task |

#### 4.1.1 `datasets` entries (`DatasetRef`)

| Field | Type | Notes |
|---|---|---|
| `dataset` | `str` | required, 1 to 200 chars |
| `version` | `str \| null` | a published version |
| `alias` | `str \| null` | an alias such as `production` |

At most one of `version` / `alias`; neither means the dataset's `production` alias. The same dataset may appear several times with
different versions. Order is the evaluation order. `evaluator.dataset` stays required and must equal `datasets[0].dataset`.
Duplicates and an empty list are **422**. Each item records its source (`item_metadata.qym_dataset`, `qym_dataset_version`).
```

### E. Section 5 (response): replace the `result` example's first lines and add rows

```markdown
  "run_name": "...",
  "dataset": "...",                 // the first entry's name
  "datasets": [ { "dataset": "...", "dataset_id": "...", "dataset_version_id": "...", "version": "v3", "alias": null, "items": 120, "disabled_items": 0 } ],   // v1.4
  "task": "answer-ticket",          // v1.4: the id that ran (the default's id when none was sent)
```

```markdown
| `eval_input.datasets` / `eval_input.task` | v1.4. As submitted (`null` when not sent) |
| `result.datasets[]` | v1.4. The SDK's `describe()` entries: `dataset`, `dataset_id`, `dataset_version_id`, resolved `version`, `alias`, `items`, `disabled_items` |
```

### F. Section 6 (errors): two rows for `422`

```markdown
| `422` | v1.4: `datasets` empty, more than 50 entries, an entry with both `version` and `alias`, a repeated entry, `dataset` different from `datasets[0].dataset`; `task` not in `GET /evals/tasks` → `{"detail": "unknown task: <id>"}` |
```

### G. Section 8 (quick reference): one row

```markdown
| `GET` | `/evals/tasks` | Tasks a job can evaluate (v1.4) | `200` / `503` if the registry can't be read |
```
