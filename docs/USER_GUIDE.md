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

The launch form has no versioning box. Under the environments, on the launch home view and on the first Customize step, a
**Evaluation Service versions** card shows each environment's current `agent`, `image` and `kb`, read from its Evaluation Service
(**Refresh** reads them again). A run records the versions its service reports; nothing typed by a user is stored on a new
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
*not sent*); no secret is ever shown. In Project settings, API keys, **Dataset read tokens** also lists experiment tokens
with an *experiment* tag and a link to the experiment; admins can revoke one by hand (a retry issues a new one).


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
