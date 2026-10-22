# Feature round: multi-dataset / multi-version evaluations and task selection

Status: DESIGN started 2026-10-22 from `UI-redesign` 77a8828c (platform 2.0.0 / SDK 2.0.0, migration head `0088`).

## 1. Owner request (verbatim, 2026-10-22)

> I need you to enhance the experimentation creation logic by implementing the below:
>
> - allow qym sdk to accept multiple dataset and multiple versions for each dataset, change the creation logic to allow
>   multi value selection of both (and prepare a request of integration change from the evaluation service team) -note:
>   the sdk should maintain the same current support for a single dataset and version and expand above it-
> - change the creation logic to allow selecting a task to run the evaluation on (and prepare a request of integration
>   change from the evaluation service team).

## 2. Owner decisions (asked 2026-10-22; final, never re-asked)

| Id | Question | Decision |
|---|---|---|
| F1 | What is one run when several datasets and versions are picked? | **Both, chosen at launch.** "Combine into one run": one run over the union of the selected dataset versions, every item records its source dataset and version, scores can be broken down per dataset. "One run each": one job per selected dataset-version pair, grouped under the experiment. |
| F2 | Where does the list of selectable tasks come from? | **The Evaluation Service lists them.** New service endpoint `GET /evals/tasks` per environment (id, name, description); the job sends `evaluator.task`. The wizard reads the list live per chosen environment, like the versions. |
| F3 | Environments whose service has not adopted the new contract? | **Fan out to one job per pair.** Detected from the environment's evaluator schema (no `datasets` field): the launch creates one job per dataset-version pair instead of one combined run, with a review-pane note. Nothing is blocked. |
| F4 | How are the integration-change requests delivered? | **One change-request document** `docs/evaluation-service-change-request-v1.4.md`: the new fields, JSON examples, validation rules, versioning and backward compatibility for both features, plus a draft of the guide's v1.4 sections. |

## 3. What exists today (survey 2026-10-22)

- SDK: `Evaluator(task, dataset: str | object, ...)`, `EvaluatorConfig.dataset_version` / `dataset_alias` scalars
  (`packages/sdk/qym/core/config.py:107`), `resolve_dataset(name, version=, alias=)` (`core/dataset.py:523`),
  `QymDataset.get_items` reads `GET /v1/datasets/{ref}/versions/{version|alias}/items`. `create_run` sends single
  `dataset`, `dataset_id`, `dataset_version_id`, `dataset_alias` (`platform/client.py:1130`). CLI: one `--dataset`,
  `--dataset-version`, `--dataset-alias` (`cli/run.py:81`). `RunSpec` (one dataset each) for multi runs.
- Platform: `Run.dataset` (str), `dataset_id`, `dataset_version_id` (`db/models.py:1243`); `CreateRunRequest` the same
  (`api/ingest.py:626`). Experiments: the dataset lives only in the spec JSON (`evaluator.dataset`, `evaluator.dataset_version`,
  `evaluator.config.dataset_alias`; `services/eval_config.py` `EvaluatorInputs`, `extra="forbid"`). Sweeps may already
  sweep any scalar under `evaluator` (one job per value). `GET .../launch-datasets` lists datasets (no versions); the
  wizard reads versions from `/v1/datasets/{name}/versions`. The dispatcher passes `evaluator.*` through unchanged.
- Evaluation Service guide v1.3 (`docs/evaluation-service-api-integration-v1.3.md`): `evaluator.dataset: str`
  required, `dataset_version: str | null`, `config.dataset_alias`, `config.task_name: str | null` (a label only).
  Unknown `EvaluatorInputs` fields are ignored; unknown `config` keys answer 422. No task catalogue, no multi-dataset.
- Frontend: `launch/entry/DatasetPicker.tsx` (single Dataset select + single Dataset version select,
  pointers `/evaluator/dataset`, `/evaluator/dataset_version`), `LaunchDocument.dataset: DatasetChoice` (single),
  `model/spec.ts` `buildSpec`, `review/ReviewPane.tsx` Dataset row (no version).
- "Task" today: `Run.task` free text (`config.task_name`); the runs list has a Task column and filter.

## 4. Work packages

| WP | Owner branch / worktree | Scope | Migration |
|---|---|---|---|
| **WP-C "SDK and run model"** | `feat/multi-dataset-sdk`, worktree `../qym-wt-multi-sdk` | SDK: several datasets and several versions per dataset in one evaluation (single still works, same API); CLI; run upload carries the list; items carry their source. Platform ingest stores the list (`run_datasets`); run detail, compare and the runs list show the datasets of a run; per-dataset score breakdown on the run page (union runs). Docs: USER_GUIDE, SDK docs, RELEASE_NOTES. | `0089` (`run_datasets` association + whatever the design needs), `down_revision = "0088"` |
| **WP-D "Launch and service contract"** | `feat/multi-dataset-launch`, worktree `../qym-wt-multi-launch` | Wizard: multi-select datasets and, per dataset, versions; run-shape choice (F1); task selection read live per environment (F2); review pane, problems, raw JSON; experiments API validation and storage of `evaluator.datasets`, `evaluator.run_shape`, `evaluator.task`; fan-out for old services (F3); platform proxy route for the service's task list; dispatcher pass-through; presets / best-run base / clone / rerun keep working. The change-request document (F4). | `0090`, `down_revision = "0089"` (only if the design needs columns; the spec JSON may be enough) |

The two packages meet at the **run upload** (WP-C defines what a union run sends; WP-D's service contract mirrors it,
section 5) and at the **experiment detail** (WP-D shows the shape and the task; WP-C shows the datasets on the run).

## 5. Contract proposal for the Evaluation Service (v1.4, to be finalised by the WP-D design)

Guide v1.3 stays valid; every addition is optional and ignored by an older service.

```jsonc
// POST /evals  (EvalJobCreate.evaluator)
{
  "dataset": "support-tickets",          // unchanged, required: the FIRST entry of `datasets` (compatibility)
  "dataset_version": "v3",               // unchanged: the first entry's version
  "datasets": [                           // NEW, optional. Present and non-empty: wins over dataset/dataset_version
    { "dataset": "support-tickets", "version": "v3", "alias": null },
    { "dataset": "support-tickets", "version": "v4", "alias": null },
    { "dataset": "billing-faq", "version": null, "alias": "production" }
  ],
  "task": "answer-ticket",               // NEW, optional: an id from GET /evals/tasks; null = the worker's default
  "model": "gpt-4o",
  "config": { "run_name": "…", "task_name": null, "..." : "..." }
}
```

- A `datasets` entry is `{dataset: str, version: str | null, alias: str | null}` (at most one of version / alias;
  neither = the dataset's `production` alias, exactly like today's single case). The same dataset may appear several
  times with different versions. Order is the evaluation order.
- **Union run**: the worker runs ONE evaluation over the concatenation; the qym SDK (WP-C) tags every item with its
  source (`item_metadata.qym_dataset`, `qym_dataset_version`) and uploads `datasets: [...]` on the run.
  "One run each" never reaches the service as a list: the platform expands it into one job per pair (today's shape).
- `GET /evals/tasks` (NEW): `{"tasks": [{"id": "answer-ticket", "name": "Answer a ticket", "description": "…", "default": true}]}`;
  `404` = unsupported (like `versioning-details/current`). `evaluator.task` must be one of the ids, else `422`
  `{"detail": "unknown task: …"}`. The run's `task` label (`config.task_name` fallback) becomes the task's `name` when
  `task` is set and `task_name` is null.
- `GET /evals/{id}` and `GET /evals` echo `eval_input.datasets` and `eval_input.task` as submitted; `result.datasets`
  lists what was evaluated; `result.dataset` stays the first entry.
- Schema (`GET /evals/schema`): `EvaluatorInputs.properties.datasets` and `.task` declared; qym detects support by
  `datasets` being declared (F3) and by `GET /evals/tasks` not answering 404 (F2).

## 6. Technical notes for the designers

- SDK API shape (WP-C decides the details, the owner's constraint is "same current support for a single dataset and
  version and expand above it"): `dataset` keeps accepting a name / path / object; it also accepts a list whose entries
  are names, `DatasetRef(name, version=None, alias=None)` or dataset objects. A plain name in the list uses
  `config.dataset_version` / `dataset_alias` as today. CLI: `--dataset` repeatable, `name@version` suffix for a version
  (`name@alias:production` or a separate flag for an alias; the design decides and records it). `qym run create` with one
  `--dataset` is byte-for-byte today's behaviour.
- Union run item identity: `RunItem.item_id` is unique per run today; items of two datasets may share ids. The design
  decides (and records) how a union run keeps them apart (for example `"{dataset}/{item_id}"` when more than one
  dataset is evaluated, with the raw id kept in `item_metadata`), and how results files, checkpoints, resume, compare
  and the best-run index treat a union run (`dataset_id` / `dataset_version_id` on `Run` = the first entry; the list in
  `run_datasets`).
- Per-dataset breakdown: the run page's metric cards and the items table already filter by item metadata; the design
  states what is new (a "Datasets" row on the run header, a breakdown table, chips) with numbered criteria and mocks.
- Launch: the home view keeps its three-action path (environments, dataset, name, Launch as is); multi-select must not
  make the single case slower (one dataset + "Latest version" stays two clicks). Versions are chosen per dataset.
  The run-shape control appears only when more than one pair is selected. The task control appears per environment
  under its box (next to the versions line) only when the environment's service lists tasks; "Worker default" is the
  first option. Mixed environments (some list tasks, some not; some accept `datasets`, some not) are allowed: the
  review pane says per environment what will be sent (combined / fanned out, task / default).
- Old-service fan-out (F3): expanded jobs are ordinary jobs of the experiment (one per pair × environment); the sweep
  cap `QYM_EVAL_SWEEP_MAX_JOBS` applies; the experiment detail groups them by dataset version.
- Secrets and tokens unchanged; the dataset read token covers every dataset of the project.
- Compatibility: SDK 2.0.0 clients and v1.3 services keep working; the platform accepts runs without `datasets`.

## 7. Process (AGENTS.md "UI product-feedback rounds", playbook)

1. **Design** (now): one designer per WP. Measure the current launch pages (WP-D) and the run page (WP-C) at 1440 /
   1024 / 390; write `spec-c.md` / `spec-d.md` with numbered acceptance criteria (DOM element, width, number), decisions
   log (`QC1…`, `QD1…`), test plan; **composed page mocks first** (every surface as a whole page in the app shell with
   realistic data, real size, shots at 1440 and 390) in the gallery (`/__ui#multi-sdk`, `/__ui#multi-launch`), state
   sheets as the appendix. WP-D also drafts `docs/evaluation-service-change-request-v1.4.md` (F4). WP-C also writes the
   SDK API design (signatures, examples, CLI) in `spec-c.md`.
2. **Implement** criterion by criterion (criterion -> change -> test table, after-screenshots); full gate through
   `scripts/heavy.sh` including `tests/platform` against Postgres (Podman container, AGENTS.md) and `tests/sdk`.
3. **Review** by an independent agent with measurements; fix pass; `--no-ff` merge into `UI-redesign`; integration gate.

Ports (eval services +100/+101, stub LLM +1000; platform ports of parallel agents at least 2 apart):
WP-C design 8994/5994, implement 8998/5998, review 9002/6002; WP-D design 8996/5996, implement 9000/6000, review 9004/6004.
Each agent: own `QYM_E2E_DB`, own scratchpad file names, `pytest -n 4` at most, never `pkill -f`.
