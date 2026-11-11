# qym user guide

## Platform web UI

When you stream runs to a qym platform (`QYM_BASE_URL`, `QYM_API_KEY`), the UI is
served by the platform itself at its root URL:

- `/` lists your projects; `/projects/<slug>/...` holds a project's runs, datasets,
  experiments, charts and settings.
- `/run/<run id>` opens a run; `/compare` compares runs side by side.
- `/docs/...` is the in-app documentation; `/admin/...` is for administrators.
- Run pages and comparisons can be downloaded as a single self-contained HTML file
  that opens offline (the export action on the run page and on Compare).

Views keep their filters in the URL, so any page can be shared as a link. The
offline viewer below is a separate, smaller tool that needs no platform.

## Datasets: access, disabled items and batch edits

### Who can open a dataset

Every dataset starts open to the whole project: each member can view and modify it. A project manager or admin can restrict one
in the dataset's **Access** tab (next to Lineage and Settings; its count shows how many people are listed): choose **Only people listed
below**, add project members with the level **View** or **Modify** (the add row sits above the list; each row shows who added the
person and when), and press **Save access** (one save for the whole list; the bar stays on screen while the list scrolls, and leaving the
tab with unsaved changes asks first). Managers, admins and the dataset's creator always have full access.
Switching back to **Everyone in the project** keeps the saved list, and it applies again if you restrict the dataset later.

- A restricted dataset is absent from the catalog for people without access; its page answers "You don't have access to this
  dataset". Its **runs stay listed** with scores, but item inputs, expected outputs, outputs and traces are hidden.
- Someone with **View** sees the dataset read-only (a "View only" badge, no edit buttons). **Modify** edits items and versions; slug,
  production alias, restore, delete and access settings stay with managers and admins.
- Any member can launch an experiment on any dataset of the project; the run reads the items with its own dataset read token.
- A private test set (admins only) is a separate setting and still applies on top of access.

### Disable items in a draft

In a draft, **Disable item…** (item pane footer or item page) leaves an item out of runs once the draft is published; add an optional
reason. The item stays in the draft, shows a **Disabled** badge under the **Disabled** or **All** state filter, and **Enable** brings it
back. Published versions are immutable: on one the action reads **Create a draft to disable**. A new draft copies the disabled flags
of its parent. SDK runs and downloads use the active items only (`state=active`); **Download JSONL with disabled items** writes all.

### Filter and edit by metadata

**Metadata** in the items toolbar filters on a key of the item metadata, including nested keys written as dotted paths up to three
levels (`source.region.code`). Up to five keys combine (AND) and are kept in the URL (`meta=path:value`). With a filter, search or
label active, **All matching** disables, enables or deletes every matching item of a draft. The confirm dialog shows how many items
would change and the first ids before anything is written; deleting more than 50 asks you to type the number. Selected rows offer
**Disable N…**, **Enable N** and **Delete N**. API: `POST …/items:batch` (dry run by default), `GET …/items:metadata-facets`.

**Keys that hold a list** (for example `tags: ["billing", "refund"]`) are in the key list too, marked `· list`; a key that is a list on
some items and a plain value on others is marked `· list or value`. For these keys you choose one or more values and a match mode:
**Partial** keeps the items that have at least one of the chosen values, **Full match** keeps the items that have every chosen value
(the list may hold more). With one value the mode makes no difference. A list filter shows as one chip, `tags: billing, refund (any)`
(any = Partial, all = Full match), and is kept in the URL as repeated `meta` values plus `meta_mode=tags:any` or `meta_mode=tags:all`
(without `meta_mode` several values mean all). Up to 20 values per key. In the API `meta=path:value` matches an item whose value at
`path` equals it or whose list at `path` contains it; the same shape works in the batch body, where a list filter is
`{"meta": {"tags": {"values": ["billing", "refund"], "mode": "any"}}}`. Lists of objects and empty lists are not offered as keys.

### Import a file into a draft again

**Import** on a draft adds the records of a file as items. A record whose `item_id` is already in the draft matches that item. Before
the Review step, the wizard counts these records, and Review shows the count, for example "4 of 4 records match items already in v1".
Then choose **Skip matching items** (the default: the items keep their content, edits included) or **Replace matching items** (the file
overwrites their input, expected output, metadata and labels; each item keeps the old content in its History). The toast gives each
count, for example "1 added, 3 skipped". In the API, `POST …/items:bulk` takes `"on_existing": "skip"` or `"replace"` (the default, as
before) and `"dry_run": true`, which writes nothing and returns the counts plus `matched`. The response lists skipped ids under
`skipped` and counts them in `summary.skipped`.

## Evaluating several datasets

One evaluation can run over several datasets, or several versions of one dataset, as a single run
(SDK 2.1.0). A single dataset, written the way it always was, is unchanged.

### From Python

```python
from qym import Evaluator, DatasetRef, CsvDataset

Evaluator(task, "support-tickets", ["exact_match"])                        # one dataset, as before
Evaluator(task, ["support-tickets"], ["exact_match"])                      # the same call

Evaluator(
    task,
    dataset=[
        DatasetRef("support-tickets", version="v3"),
        DatasetRef("support-tickets", version="v4"),     # another version of the same dataset
        DatasetRef("billing-faq", alias="production"),
        "refund-cases",                                    # a plain name: config.dataset_version / dataset_alias, else production
        CsvDataset("./local-cases.csv"),                   # objects mix in
    ],
    metrics=["answer_correctness"],
).run()
```

- `DatasetRef(name, version=None, alias=None)`: a version or an alias, not both; neither means the
  dataset's `production` alias. A string in a list is always a dataset name (never parsed for `@`).
- The items of the datasets are evaluated in list order as one run. Every item keeps its source:
  its id becomes `name@version/raw-id` (two versions that share ids stay apart; the raw id is kept in
  `item_metadata.qym_item_id`) and its metadata gains `qym_dataset`, `qym_dataset_version`,
  `qym_dataset_index` and `qym_dataset_version_id`.
- At most 50 datasets per run. The same dataset version listed twice is an error. A dataset or version
  that does not exist fails before the run starts.
- The run's name is its label, for example `support-tickets@v3 + support-tickets@v4 + billing-faq@production`;
  `result.run_metadata["datasets"]` lists each entry with its resolved version and item count.
- Results files (`csv`, `xlsx`) of a union run have `dataset` and `dataset_version` columns after `item_id`.
  Resuming (`resume_from`) checks that every dataset still resolves to the version the file used and stops with
  `Pin the version (name@v3) to resume` when an alias moved.

### From the command line

```bash
qym run create --task-file t.py --task-function f --metrics answer_correctness \
    --dataset support-tickets@v3 --dataset support-tickets@v4 \
    --dataset billing-faq@alias:production --dataset ./local.csv
```

`name@v3` pins a version, `name@alias:production` an alias, a bare name takes `--dataset-version` /
`--dataset-alias` (a suffix beats them for its dataset). A value that is an existing path is a local file, so
`./a@b.csv` works. `--dataset-file` cannot be combined with several `--dataset`.
`qym run list --dataset NAME` finds runs that evaluated a dataset; `qym run get --json` lists a run's `datasets`.

### On the platform

A union run is an ordinary run with extras: the header's fact strip shows **Datasets** with a count, the first
chip group lists each dataset (name, version, alias, item count; a link to that version while the dataset
exists), a **Datasets** section gives each dataset's items, errors and mean per metric next to the run's own mean,
and the items table has a Dataset column and a Dataset filter (`?dataset=name@version`). **Show N** in the section
sets the filter. The runs list shows `3 datasets` and its Dataset filter and search match any dataset of the run;
compare adds a notice when the runs evaluated different sets of dataset versions. Union runs are never ranked
against single-dataset runs (best-run index, best-run bases, a version's trend): their scores cover other items.
The local viewer (`qym ui FILE`, `--local-ui`) shows the same table, column and filter from the file's rows.

## Local results viewer (offline)

The SDK ships a small browser viewer that needs no platform account and no network.
It shows one evaluation: live progress while it runs, or a saved results file.

### Watch a run while it executes

```bash
qym run create --task-file my_task.py --task-function my_task \
  --dataset-file data.csv --metrics exact_match --local-ui
```

- The terminal prints `Local viewer: http://127.0.0.1:<port>/` and opens the browser
  (`--no-open` to skip). Use `--ui-port 8818` to pick the port (default: a free one).
- The page streams rows as they finish: a ribbon with one cell per row (green done,
  red failed, blue running, hollow pending), counts, elapsed time, latency percentiles
  and mean score per metric. Click a ribbon cell or a table row to read the full
  input, output and expected text, show a word diff, or copy a value.
- When the run ends the page keeps the final state. If you are at a terminal the viewer
  stays up until Ctrl+C; in scripts and with `--json` it stops when the run ends.
- From Python: `EvaluatorConfig(local_ui=True, ui_port=0)` (or `config={"local_ui": True}`),
  then read `evaluator.local_ui_url`. The viewer lives in your process: keep the script
  alive to keep serving it. A later run on the same port replaces the earlier viewer.
- If `--ui-port` is already taken, a warning is printed to stderr and a free port is used.
- `--no-ui` only hides the terminal table; it does not control the browser viewer.
  Platform streaming (`QYM_API_KEY`) works at the same time.

### Open a saved results file

```bash
qym ui qym_results/my_task/gpt-4o/2026-10-11/run.csv
```

Opens the file in the same viewer (`.csv` or `.xlsx`; `--port`, `--no-open`). For `.csv`
files you can correct a metric score in the row detail: type the new value, press Save.
The score is written into the file and the original is kept in an audit column.

### Search, filter, export

Search (input, output, expected), status filter, column sorting and the selected row live
in the URL (`?q=&status=&sort=&dir=&row=`), so a view can be shared. "Export CSV" downloads
the rows currently shown.

### Building the viewer from a checkout

The viewer is a build output (`packages/sdk/qym/_static/ui/`, not committed):

```bash
cd frontend && npm ci && npm run build:sdk
```

Do this before `pip wheel packages/sdk` so the wheel contains it. For development,
`npm run dev:sdk` serves it on port 5808 and proxies `/api` to a local viewer on 8818
(start one with `qym ui FILE --port 8818` or `qym run create ... --local-ui --ui-port 8818`).

## Experiments: several datasets, one task and a priority per run

### Datasets and versions

On the launch home view, the **Datasets** card starts as one list: pick a dataset (it runs on its Latest version, as before).
From then on each dataset is a box with a **Versions** menu: tick Latest version, any version (newest first, drafts are
tagged) and aliases; the chosen ones show as tags next to it. **Latest version** and an alias are resolved when you
launch: the platform looks up the newest published version (or the version the alias points at) and writes it into every
job as `dataset_version`, so an Evaluation Service cannot replace it with its own default version
(`EVAL_DATASET_VERSION`). The experiment keeps your choice, a clone resolves it again, a retry keeps the pinned version,
and the job history shows both (`latest (v7)`, `production (v2)`). A project dataset the platform cannot resolve (an
unknown alias, no published version) is sent as chosen, with a review warning; a name that is not a project dataset is
sent as chosen, silently. **Add another dataset** lists the project's other datasets. The
card counts what you chose (`4 dataset versions from 2 datasets`). An experiment may name up to 20 dataset versions
(`QYM_EVAL_MAX_DATASETS`).

From two dataset versions the card shows the **Run shape**:

- **One run each** (default): one run per dataset version and environment, grouped under the experiment.
- **Combine into one run**: one run over all dataset versions together. Every item records its dataset and version
  and scores break down per dataset. It needs an Evaluation Service on integration guide v1.4 (its schema declares
  `datasets`). An older service receives one job per dataset version instead; its environment box says
  `N runs, one per dataset version (older service)`.

An API request that names several dataset versions without `run_shape` gets `one_each`; a stored experiment always
carries the shape it was launched with.

The run count follows (`1 combination × (2 environments × 4 dataset versions) = 8 runs`, or with **Combine into one run**
`1 combination × (production: 1 combined run + staging: 4 runs) = 5 runs`) and the limit of
`QYM_EVAL_SWEEP_MAX_JOBS` applies to it. A one-dataset experiment is stored and sent exactly as before. Sweeps cannot cover the
dataset list or the shape (use **One run each** to run each one); starting points (presets) hold no dataset list.

### One task per experiment

When a ticked environment's service declares `task` and lists tasks (`GET /evals/tasks`), a **Task** card appears above
Environments and Datasets (on the launch home view and on the first Customize step). It holds one select: **Worker default**
first, then the union of the ticked environments' tasks, each with the environments that offer it. The row under it shows, per
ticked environment, whether it offers the chosen task. If one does not (or its service has no task selection at all), its box turns red,
the review lists the problem and Launch stays disabled until you change the task or untick the environment; the platform never
quietly runs the Worker default there. The task is stored once on the experiment (`evaluator.task`, a task id) and shown on the
experiment page, where the **Datasets and task** card, one matrix row per dataset version and a job history grouped by dataset
version replace the plain matrix. Experiments launched before this change keep their per-environment tasks and display unchanged;
**Duplicate** shows the common task or "Different per environment" (read-only). A preset may hold the task of its own environment.

### The Customize bar and the review's run table

Customize (and the default preset editor) has one bottom bar on every step: **Skip to review** and **Cancel** at the far left, the
run count with the first problem (a link to its field) or Ready in the centre, and **Back** and **Continue** at the far right. On the
last step Continue's place holds the launch: **Launch N runs** (**Publish vN** in the editor), disabled while a problem or the High
acknowledgement blocks it; Skip to review is then disabled in place. No earlier step launches; moving on with Continue is never
blocked. The home view's bar keeps **Customize →** and **Launch as is**. The bar sits under the last card when the page is short
and stays at the bottom of the window while the page is longer.

The Review step's **runs to launch** table has one row per run: `#`, the Environment and Dataset when they differ between runs,
**one column per swept setting** (named as the form names it, a linked pair under "Linked: vary together", the value you picked in
each cell, such as the model connection's name), the Task when it differs, and the run's Priority. When the columns do not fit the
card, the table scrolls sideways instead of narrowing a column; on a phone each run is a card with the same facts. The Summary lists
the **Swept settings** one line per sweep, and Changes names them.

### Priority per run

The experiment has one priority (**Name and priority**, default from the environments) and, on the **Review** step, every run of
a sweep has its own **Low / Normal / High** select that starts at the experiment's value. **Set every run to** changes all rows
at once. The rules are the experiment's, applied per run: **High** needs a project manager, is capped by the run's own
environment (`max_priority`), and any High run needs the preemption acknowledgement (one checkbox above the table, naming only the environments of High runs). The
platform stores the priority on each job (it is sent to the Evaluation Service per job, as before), **Retry** keeps the job's priority,
and within one experiment High runs are submitted first. The API takes `job_priorities` (`environment_id`, `combo_index`,
`dataset_index`, `priority`) next to `priority`; the experiment and each job carry `priority`, and the experiment a
`priorities` count (`{"LOW": 0, "NORMAL": 5, "HIGH": 1}`).

### Environment pages

Experiments -> Environments and Project settings -> Environments show the same table, and the whole row opens the environment (click
any cell, press Enter on a focused row, Ctrl/Cmd-click for a new tab); the name is also a normal link and a chevron closes every
row. Both entries open one page, `/projects/<project>/environments/<id>`, with Status, Schema, Tasks (what the service offers; read-only),
LLM model groups, Default preset, Saved presets, Ranking, Policies and Connection, and a bar with Delete environment and Save changes.
Opened from Project settings, its back link reads "Project settings"; otherwise "All environments".

## Experiments: latency-sensitive runs and credentials

### Latency-sensitive runs

Tick **Latency-sensitive run** inside the Environments card on the launch home view, or under the name and priority on the first
Customize step (it is one setting: ticking it on either page ticks it on both), when the run measures latency.
The Evaluation Service then starts the run only when the gateway is quiet, makes other jobs on the environment wait
while it runs, and discards and re-queues it if foreign traffic overlaps (up to its limit). Expect a later start.

- The experiment page shows a **Latency-sensitive** tag. A job that waits for a quiet gateway reads
  `deferred ×3 · vllm quiet window` in the Status column; a running job reads `admitted 12:52`; a re-queue shows
  `↻ 1` and `re-queued ×1 · contaminated`. The Experiments list and the Queue have a **Latency-sensitive only**
  filter, and the Queue says which environment is held by such a job.
- The review pane warns (without blocking) when the environment's schema declares
  `EVAL_VLLM_POST_RUN_MAX_REQUESTS` and you left it unset: without a ceiling, steady foreign load would be accepted and
  skew latency. **Set ceiling** jumps to that setting.
- Each environment has **Who can launch latency-sensitive runs** (Environment page, Policies): *Anyone in the project*
  (default) or *Project managers only*. On a managers-only environment a member cannot tick the box (the form says so),
  and the API answers 403. Project managers and admins change the setting in either direction.
- Runs that came from a latency-sensitive experiment carry a small clock tag in the first cell of the Runs page (hover for
  "Latency-sensitive experiment"); `qym run list --json` has `experiment.latency_sensitive` on each official run.
- The flag is fixed at launch; **Duplicate** and **Retry** carry it. It does not change priority or queue order.

### Evaluation Service versions (read-only)

The launch form has no versioning box. On the launch home view and on the first Customize step, each ticked environment's box has a
**Versions** line with what its Evaluation Service reports a run started now would record (**Refresh** reads it again): every key of
its `versioning_details`, in the service's order, the key exactly as the service names it (`agent_version`, `kb_version`,
`prompt_set`, …) above its value. A key the service does not report is not shown, so a version the service has dropped (such as
`image_version`) disappears by itself; a service that reports nothing reads "No versioning details reported". Long values and
objects take the whole line (objects as compact JSON, the whole text in the tooltip). The review's **Versions** row shows the same
grid per environment. The Experiments list's versioning filters and the best-run scope name each key as reported. A run records the versions its service reports; nothing typed by a user is stored on a new
experiment, Duplicate and Rerun carry none, and `POST .../experiments` answers 422 when a request still sends `versioning_details`
(`null` and `{}` are accepted). Experiments and runs created earlier keep their versioning details and still filter by them.

### Dataset read token

Every launch mints a dataset read token for the experiment. The Evaluation Service uses it to read datasets of the
project, private test sets and restricted datasets included, so any member who can launch may name any dataset of the
project; people without access to a restricted dataset still see the run's scores, not its item contents. The token is
sent only to environments whose schema declares `QYM_DATASET_READ_TOKEN`; for the others the experiment page says the
service reads with its own token. It is revoked when the experiment settles and replaced when you retry a job.
The launch also tells the service which qym instance to report to: `QYM_BASE_URL` is sent to environments whose
schema declares it, so an Evaluation Service shared by several qym instances returns the run to the one that launched
it. Both keys are set by the platform; a configuration or preset that sets them itself fails validation until edited.

The experiment page shows a **Credentials** row (API key and dataset read token: *active*, *revoked*, *not issued*,
*not sent*); no secret is ever shown. Project settings, API keys keeps the keys the platform mints for experiments out of
the way: your own keys are the table, and the keys issued at launch sit in a closed **Evaluation Service keys** group under
it (the same for **Experiment tokens** under Dataset read tokens, admins only). Each row there names its experiment and links
to it; you can revoke one by hand (a retry issues a new one).

The API key minted for an experiment is scoped: it can upload runs (`POST /v1/runs`, `/v1/runs/{id}/events`,
`/v1/runs:upload`) and read dataset items, and nothing else. Creating, changing or deleting datasets, reading runs back and
the other routes answer 403 (`X-Qym-Key-State: scope_denied`), so a leaked key is worth little. Keys you create yourself are
not scoped and keep acting with your project access.


## Live evaluation

Open **Live** in a project to follow real user turns evaluated by the evaluation worker, investigate a diagnosis, and read the evidence behind a score.

### What is a live source?

A live source is a named evaluation worker feed within a project, with a stable key, an environment and its own metric definitions. The evaluation worker observes the product and pushes evaluated turns to qym. Pick a source in the header when a project has more than one. A project without a source shows a guide link until the evaluation worker registers one.

### The three pages

- **Overview** shows the selected day's worker status, turn counts, diagnosis mix, metric means, service health and the latest canary checks. Choose a day with the arrows or date picker. The trend shows one column per day over 14, 30 or 90 days; choosing a column changes the selected day. A Days row opens that day's turns.
- **Turns** lists questions, diagnoses, scores, latency and service faults. Filter by day or date range, diagnosis, status, outcome, mode, service, metric bounds, user or conversation; search questions and answers, sort a column or export the filtered rows as CSV. The URL preserves the filters. Wide tables scroll inside their frame.
- **Turn detail** opens on Diagnosis, with the reason, judge comparisons, SQL, answer, charts and services. Its other tabs are Answer and SQL, Judges, Charts, Services and tools, Conversation and Evaluator. Evidence appears when supplied by the evaluation worker; unavailable values show a dash or an explanation. Conversation opens related turns. Previous and next follow the originating list's loaded page and filters. Product and evaluation trace links appear when supplied.

Use Tab to reach day controls, stat links, diagnosis segments, trend columns and Days rows; Enter activates them. Left and right Arrow keys select turn-detail tabs. Arabic questions and answers read right to left within the left-to-right controls.

### Read the worker status and gaps

**Running** means qym received a recent heartbeat. **Stale** means no heartbeat has arrived, or the last receipt is older than the configured threshold (300 seconds by default). The status line also shows the latest turn time and the judge models and evaluation versions when supplied. A recent heartbeat says the evaluation worker is reporting; it does not guarantee successful product responses or evaluation scores.

A hatched trend column and a **Gap** in the Days table mean the longest recorded gap between heartbeat receipts exceeded three configured poll intervals (60 seconds per interval when unspecified). A worker gap is different from a quiet day with no turns. Historical gaps stay visible after the evaluation worker resumes; the current status reports its latest heartbeat.

### Read the diagnosis mix and numbers

The diagnosis mix counts the labels on turns received by qym. Labels and their colors come from the source's metric definitions; each segment and legend entry opens the matching turns. Hover or focus a segment to read its count. The worker's **Turns** and **Evaluated** counters can be ahead of uploads: **turns not yet in qym** is the difference between turns seen and turns received, not an extra diagnosis category.

Only received, non-skipped scores contribute to Live metric means. A dash means no numeric score is available, not zero. Service health summarizes the received service scores; canaries are separate active probes whose latest result and latency help distinguish a product fault from a missing worker report.

### Where the data comes from

The evaluation worker registers the source and metric definitions, sends a heartbeat after each poll, and uploads daily counters, turns with scores and evidence, and canary results through the project API-key-authenticated ingest API. qym stores and presents these reports; it does not run the evaluation worker from this tab. Republishing the same source and turn ID replaces that turn's evidence and scores. The explicit reporting day supplied by the evaluation worker determines the day grouping; times in the UI are UTC.

For authentication, payloads, limits and reconciliation, see the [Live evaluation ingest guide v1.0](live-evaluation-ingest-v1.0.md).

By default, retention removes turns, their scores and canary results after 180 days; daily counter rows remain for 730 days. Older counters can therefore outlive the detailed evidence and score aggregates computed from retained turns.

## Feedback

Feedback turns a need into a well-formed request. Open **Feedback** in the sidebar (every signed-in person sees it, in a project or not).

### Submitting

1. **New feedback** asks what the feedback is about: **qym itself** (a need or change for the platform, SDK or CLI) or **a product you evaluate with qym** (pick one of your projects and, if you like, point at one run, experiment or dataset). Then describe the need in your own words, in English or Arabic. Do not paste secrets or customer data: every signed-in person can read a submitted request and its conversation.
2. **The assistant** answers with the questions an administrator would ask later: the business need, who is affected and how often, what you do today, what a good result looks like, any deadline and what is in or out of scope. A checklist beside the chat shows what it knows ("Known", "Partly known", "Not asked yet", "Not known"). It reads the qym documentation (or your project's setup, never its data) and searches existing requests so that duplicates and conflicts are real requests, not guesses. **Enter** sends, **Shift+Enter** starts a new line, **Stop** ends an answer.
3. **The proposal.** When it has enough, the assistant shows a **Proposed request** card: a title, a detailed description, the business need and justification, a **priority** (low, medium, high, critical) and a **complexity** (S a day or two, M about a week, L several weeks, XL a project of its own), each with its reasoning, and related requests marked **Duplicate**, **Conflict** or **Related**. You can change the title, description, priority and complexity (the card keeps showing what the assistant proposed). **Keep talking** continues the conversation; a new message replaces the proposal. Nothing is submitted until you press **Submit request** (or **Submit as a possible duplicate**).

Your submitted request keeps the conversation: open its **Conversation** tab to read it.

### Drafts

Until you submit, the conversation is a **draft** that only you can see. Drafts are listed above the Feedback list (**Resume**, **Discard**) and are deleted after the number of days an administrator set (30 by default) without activity. Closing the page mid-answer does not lose the answer.

### Triage (administrators)

A platform administrator sees a **Triage** panel on every request: set the status (New, Accepted, Planned, Done, Declined), revise priority or complexity, or mark the request as a duplicate of another. A revision, a duplicate link and a decline need a note; a decline reason is shown to everyone. Every change appears in the request's **History** and in the audit log. The list groups confirmed duplicates under their original request.

### Exporting the list (administrators)

The **Export** menu in the Feedback list's toolbar downloads the rows that match the current filters (not just the page you see) as **CSV**, **Excel (.xlsx)**, **JSON** or **JSON Lines**. Every format has the same columns: id, title, subject, project, target_kind, target_id, priority, complexity, status, submitter, created_at, confirmed_at, duplicate_of, conflicts (request ids joined by `;`), summary, description, business_need, justification, agent_priority, agent_complexity. Drafts are never exported. Each export is written to the audit log (format, filters and the row count).

### If the assistant is not set up

An administrator connects an OpenAI-compatible model once under **Admin, Feedback agent**. Until then the list is readable and **New feedback** is disabled.
