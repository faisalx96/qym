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

## Experiments: latency-sensitive runs and credentials

### Latency-sensitive runs

Tick **Latency-sensitive run** under the name and priority on the first launch step when the run measures latency.
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
- The flag is fixed at launch; **Duplicate** and **Retry** carry it. It does not change priority or queue order.

### Dataset read token

Every launch mints a dataset read token for the experiment. The Evaluation Service uses it to read datasets of the
project, private test sets and restricted datasets included, so any member who can launch may name any dataset of the
project; people without access to a restricted dataset still see the run's scores, not its item contents. The token is
sent only to environments whose schema declares `QYM_DATASET_READ_TOKEN`; for the others the experiment page says the
service reads with its own token. It is revoked when the experiment settles and replaced when you retry a job.

The experiment page shows a **Credentials** row (API key and dataset read token: *active*, *revoked*, *not issued*,
*not sent*); no secret is ever shown. In Project settings, API keys, **Dataset read tokens** also lists experiment tokens
with an *experiment* tag and a link to the experiment; admins can revoke one by hand (a retry issues a new one).

