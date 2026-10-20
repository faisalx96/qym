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

