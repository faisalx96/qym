# qym Platform User Guide

The qym platform stores evaluation runs, datasets, traces, reviews, and analysis in a shared, project-scoped workspace. This guide describes the current web application. SDK usage is covered in the in-app **Docs** portal.

## Contents

1. [Projects and navigation](#projects-and-navigation)
2. [Access and roles](#access-and-roles)
3. [Project settings](#project-settings)
4. [Dashboard and runs](#dashboard-and-runs)
5. [Repeat runs](#repeat-runs)
6. [Run detail](#run-detail)
7. [Compare, charts, and models](#compare-charts-and-models)
8. [Datasets](#datasets)
9. [Analysis, reviews, and traces](#analysis-reviews-and-traces)
10. [Run review and deletion](#run-review-and-deletion)
11. [Experiments (Evaluation Service)](#experiments-evaluation-service)
12. [Connect the SDK and CLI](#connect-the-sdk-and-cli)
13. [Administration](#administration)

## Projects and navigation

The project is the platform's main isolation boundary. Runs, datasets, API keys, LLM connections, members, and review data belong to one project.

The global navigation contains **Projects** and **Docs**. After opening a project, the project navigation contains:

- **Dashboard** — project summary and recent activity.
- **Charts** — trends across runs.
- **Runs** — searchable run table and cohort selection.
- **Models** — model-level performance summaries.
- **Experiments** — launch and follow Evaluation Service runs, with a **Queue** tab.
- **Reviews** — root-cause correction review.
- **Datasets** — versioned test data.
- **Project Settings** — members, API keys, LLM connections, and Evaluation Service environments.

Admins additionally see **Admin** and **Deleted Runs**.

The legacy Sector → Department → Team hierarchy is no longer part of the platform.

## Access and roles

### Authentication modes

Operators choose one UI authentication mode with `QYM_AUTH_MODE`:

| Mode | Behavior |
|---|---|
| `none` | Local development. qym creates/reuses `dev@local` as an admin. |
| `proxy_headers` | Trusts `X-User-Email` or `X-Email` from an authentication proxy. |
| `oidc` | Uses configured Google, GitHub, and/or self-hosted GitLab sign-in. |

Email/password sign-in can be enabled alongside any non-`none` mode. SAML and generic enterprise SSO are not implemented.

Self-hosted GitLab sign-in needs `QYM_AUTH_GITLAB_URL` (the GitLab issuer, for example `https://gitlab.example.com`), `QYM_AUTH_GITLAB_CLIENT_ID`, and `QYM_AUTH_GITLAB_CLIENT_SECRET`. Register a confidential GitLab OAuth application with the scopes `openid`, `email`, and `profile` and the redirect URI `<QYM_BASE_URL>/v1/auth/callback/gitlab`. A malformed `QYM_AUTH_GITLAB_URL` stops the platform at startup.

A first provider sign-in joins the existing account with the same verified email. For GitLab, this trusts the instance's email verification: enable GitLab sign-in only when users cannot set an unconfirmed email (email confirmation on, or emails managed by LDAP or admins). Otherwise a GitLab user could claim another person's account, including an admin's.

#### Forgotten passwords

Users cannot reset their own password. An admin opens **Admin → Users → Edit** and chooses **Reset Password**:

1. The editor shows a temporary password once. Copy it and give it to the user through a trusted channel.
2. The user signs in with the temporary password and must choose a new password before the sign-in completes.

A temporary password works once, and a later reset replaces it. For a user who only signed in through a provider, the reset also creates a password login.

Session-based deployments require `QYM_AUTH_SESSION_SECRET`. Browser writes are protected by a same-origin check; configure the externally visible `QYM_BASE_URL` correctly when the app is behind a proxy.

### Roles

There are two role layers:

| Layer | Role | Access |
|---|---|---|
| Global | `MEMBER` | Access only to projects where the user is a member. |
| Global | `ADMIN` | Manage users and projects, access every project, restore deleted runs. |
| Project | `MEMBER` | View and modify project data, run evaluations, and review corrections. |
| Project | `MANAGER` | Member access plus member management and run approval/rejection. |

The platform prevents removal or demotion of a project's last manager.

## Project settings

Open **Project Settings** to manage:

### Members

Managers and global admins can add members and change project roles. Project access, not an organization tree, determines run and dataset visibility.

### API keys

Any project member can create a project-bound API key. The raw token is displayed once; store it in a secret manager or `.env` as `QYM_API_KEY`. qym stores only a PBKDF2 hash.

Keys display scopes for compatibility, but scopes are not currently enforced. A valid, non-revoked key has access to its project. Project membership and the key's project binding still apply.

The key owner, a project manager, or a global admin can revoke a key.

### LLM connections

Any project member can add, test, choose a default, or remove an OpenAI-compatible LLM connection. These connections power platform-side AI analysis and are the **project models** offered when launching experiments. They are separate from SDK judge configuration (`QYM_JUDGE_*`).

Clear **Available for experiments** on a connection to keep it for root cause analysis only; it then no longer appears in the experiments model picker.

Each connection stores a base URL, a model, and an encrypted API key; the UI only shows a masked last-four-character hint. The first connection becomes the project default, and a different connection can be chosen for an individual analysis run. Updating a connection without entering a new key preserves the stored key.

The default deployment blocks provider URLs that resolve to private or loopback addresses. Set `QYM_ALLOW_PRIVATE_LLM_BASE_URLS=true` only when the platform intentionally uses a trusted local provider.

## Dashboard and runs

The Runs page presents each evaluation as one logical row. It does not infer groups from timestamps.

Use the page to:

- Search and filter by status, task, dataset, model, version, or run name.
- Choose visible metric columns; the preference persists locally.
- Inspect live progress, owner, branch, commit, and status.
- Open a run for item-level detail.
- Submit, approve, reject, unapprove, unreject, or delete when your role and the run status allow it.

### Selecting a comparison cohort

Click **Select** (or press `x`) to reveal the checkbox column. Select runs or repeat passes, then open the comparison. **Clear** or `Escape` exits selection mode.

The comparison's atomic unit is an execution:

- An ordinary run contributes one execution.
- A whole repeat run with `samples=k` contributes `k` executions.
- A selected pass reference contributes one execution.

Selecting a whole repeat and one of its own passes at the same time is blocked, as is placing a whole run opposite one of its own passes. Different passes from the same repeat may be compared with each other.

## Repeat runs

Set `samples=k` to evaluate every dataset item `k` times inside one run. In the CLI, use `qym run create ... --samples k`.

The Runs page shows one row with a `×k` marker. Expanding it reveals pass rows and group metrics; no timestamp-based reconstruction is involved.

Repeat analysis includes:

- **Pass@k** — estimated chance that at least one of `k` executions passes.
- **Pass^k** — estimated chance that all `k` executions pass.
- **Average@k / Max@k** — average and best observed score behavior.
- **Consistency / Reliability** — stability and all-pass behavior across executions.
- Accuracy-vs-k curves, bootstrap uncertainty, noise bands, p-values, and comparison verdicts where enough observations exist.

`report_k` controls the reported subset size independently of the captured `samples`. For example, a run may collect ten passes while reporting estimators at `k=3`. These are subset estimators over stored passes; they do not rerun the task.

Completed passes are durable while a later pass is still streaming. Each stored pass also retains its metric label, metadata, error, and judge explanation.

## Run detail

The run page leads with **Overview**, followed by repeat analysis when applicable, metadata breakdowns, and items.

### Overview and filters

- Summary cards show scores, pass rates, latency, status, and run metadata.
- All metadata-category cards remain visible so changing a filter does not hide the other available categories.
- Metric chips cycle through **any → passed → failed**. Active metric conditions are combined with AND.
- Metadata and review filters narrow the same item list.

### Items and repeated outputs

Each item starts as a compact one-line header. Expand it to inspect input, expected output, outputs, trace access, metric values, and details.

For repeat runs:

- Pass outputs appear side by side.
- Identical outputs are folded into variant columns instead of being repeated.
- Output chips toggle the visible pass/variant columns.
- Per-pass metric detail, including judge explanations and errors, appears beside the relevant pass.

Inputs, outputs, expected values, and structured metric metadata render in readable formats and provide copy affordances. The page can also export a self-contained HTML snapshot for offline review.

## Compare, charts, and models

### Compare

Compare treats the selected executions as one cohort and keeps the selected sides explicit. It provides:

- Cohort score, latency, Pass@K, Pass^K, stability, and best-score summaries.
- Side-by-side item outputs with winner and score indicators.
- Search, metadata, review, and metric-range filters.
- Category and root-cause breakdowns, with a metric selector that scopes the breakdown and the solution Sankey view to one metric or all metrics.
- CSV export using the active filters and selected columns.

Do not interpret a repeat as “Pass@k of Pass@k.” Its passes enter the cohort as individual executions.

### Charts

Charts show performance trends by task and dataset with run, version, and model views. Filters include time, task, dataset, model, and git version.

### Models

Models summarizes model performance and run coverage within the current project. Use it to find a model, then drill into the runs that produced its measurements.

## Datasets

Datasets are project-scoped and versioned. The platform assigns immutable human-friendly version identifiers (`v1`, `v2`, …); `version_name` is an optional descriptive label.

### Lifecycle

- A **draft** version can be edited.
- A **published** version is immutable.
- Aliases such as `production` point to a chosen version.
- Cloning creates a new version with lineage back to its source.

The UI supports creation, CSV or JSONL upload, JSONL download, publishing, aliases, cloning, version comparison, lineage, search/filtering, item revisions, bulk item operations, and run history for an item. Dataset metadata can be updated without rewriting a published version's items.

Reference a platform dataset from the SDK by name, version, or alias after setting `QYM_BASE_URL` and `QYM_API_KEY`.

## Analysis, reviews, and traces

### AI root-cause analysis

Configure at least one provider under **Project Settings → LLM Connections**. Any OpenAI-compatible provider can be used; test the connection before selecting it in the analyzer. Open **Auto-analysis** from the project navigation, or use the run-specific analyzer on a run page.

To run an analysis:

1. Choose a run and one or more metrics. Each item/metric pair is analyzed independently, so one item can carry different diagnoses for different metrics.
2. Filter by outcome, score threshold, complexity, domain, root-cause values, explicit item IDs, or already-analyzed targets. With multiple metrics selected, an item limit retains every matching selected metric for each chosen item.
3. Preview the prompt or test up to three items without saving results.
4. Start the analysis and follow its streamed progress.

The analyzer proposes a **root cause category**, a reusable **root cause detail**, and an evidence-based **note**. AI-suggested values show a robot indicator with confidence; human-confirmed values show a checkmark.

The analyzer playground supports system-prompt editing, nested input/output/metric mappings, custom-variable interpolation, category/detail catalogs, additional instructions, field selection, prompt previews, and unsaved test analyses.

Project context strengthens the analysis:

- **Project description** — explain the business domain and correctness expectations.
- **Analysis rules** — manage versioned title/instruction pairs through a draft → published → `production` alias lifecycle. Rules support lineage, comparisons, cloning, and append-only generation from selected documents and approved correction examples.
- **Reference documents** — upload PDF, DOCX, text, Markdown, HTML, CSV, JSON, or YAML into a shared project library, then select the documents a run uses. Each upload is limited to 10 MB. The normal prompt-safe representation is 40,000 characters; an explicit full-content choice can retain up to 200,000 characters. A prompt can include at most eight selected documents and 80,000 reference characters, within a final 320,000-character safety budget.

Rule generation processes large sources in bounded patches, using separate 256,000-character document/example patches and a 320,000-character request budget. HTML scripts and styles are ignored, scanned PDFs require OCR, and PDF/DOCX extraction rejects unsafe expansion. Hard-cap truncation is reported.

The default prompt sends the selected metric result, an organized view of native trace spans, project context, active rules, and selected documents. Trace evidence is grouped into agent and evaluation sections, repeated chat messages are deduplicated, and credential-like fields are redacted. Approved correction snapshots can support rule generation but are not added to per-item prompts as few-shot examples. Saved analysis metadata records the resolved production rule-version ID for reproducibility.

The platform analysis route is `/api/runs/{run_id}/analyze`; the `qym analyze run` CLI command uses the same route.

### Reviews

Reviews are project-scoped. Members can edit corrections and participate in review; approval permissions follow the project and run rules. The review page supports search and filters, inline editing, bulk approval/rejection/deletion, and review comments.

Corrections keep append-only numbered revisions, before/after values, actor source, linked review candidates, captured input/output/score snapshots, and review status. A candidate can be pending, approved, rejected, superseded, or withdrawn. Only one active candidate exists per item/metric scope: approving a newer correction supersedes the prior active one, while rejecting or removing a correction retains its audit history. Editing a correction also synchronizes the corresponding run-item metadata.

Approved correction examples can provide evidence for future analysis-rule generation, but they are not inserted into per-item analyzer prompts.

### Traces

Open an item's trace to inspect its span tree, timings, model messages, tool input/output, token and cost metadata, errors, and raw attributes. Trace links can be shared with the run/item context intact.

## Run review and deletion

Common run statuses are:

| Status | Meaning |
|---|---|
| `PENDING` / `RUNNING` | Created or actively receiving evaluation events. |
| `COMPLETED` | Evaluation finished. |
| `FAILED` | A run-level failure ended the evaluation. |
| `STOPPED` | Interrupted, or marked abandoned after its lease timed out. |
| `DRAFT` | Review draft. |
| `SUBMITTED` | Awaiting a manager/admin decision. |
| `APPROVED` / `REJECTED` | Review decision recorded. |

The run owner can submit eligible completed, failed, or previously rejected work. Project managers and global admins can approve or reject submitted work; unapprove/unreject returns it to `COMPLETED`.

A running evaluation with no events beyond `QYM_RUN_STALE_TIMEOUT_SECONDS` is lazily marked `STOPPED` with reason `lease_timeout` when read. A later valid event reopens it, so transient client disconnects are recoverable.

Deleting a run is a soft delete with an audit record. Owners, project managers, and global admins can delete according to permission checks; only a global admin can restore it from **Deleted Runs**.

Deleting a project archives it when it already contains runs. An empty project can be physically deleted.

## Experiments (Evaluation Service)

An experiment launches qym evaluations on one or more remote **Evaluation Service** deployments, called **environments**. The platform builds the launch form from each environment's live settings schema, fills LLM settings from your project models, sends one job per configuration, follows each job until it finishes, and links the resulting run back to the experiment.

Operators: deployment, environment variables, and troubleshooting are in the [operations runbook](../../../docs/internal/OPERATIONS.md#evaluation-service-experiments).

### Environments

Environments live under **Project Settings → Environments**. Every project member can view them. Only project managers (and global admins) can add, edit, test, refresh, or delete them.

**Add environment** opens a three-step dialog:

1. **Connect**: a name, the **Base URL**, and the service's API key. Include the service's `EVAL_SERVER_PREFIX` in the URL; qym appends `/evals` itself. **Test & connect** checks the key and fetches the settings schema before anything is saved.
2. **Review settings**: a read-only preview of the form generated from the schema.
3. **Group LLM settings**: confirm the model slots (below).

Rules that apply to every environment:

- **Ingest with this project's key.** The deployment must send its runs to qym with an API key of *this* project (`QYM_API_KEY` on the service's workers). Otherwise the runs land in another project and never count as official. The dialog links to **Create a project API key**.
- An environment URL belongs to one project. A URL already registered in another project is refused with the name of the owning project.
- The URL must use `https://` unless the operator set `QYM_ALLOW_PRIVATE_LLM_BASE_URLS=true`.
- The key is stored encrypted and shown only as `••••last4`. Leaving the key empty when editing keeps the stored key.
- Deleting an environment that experiments or presets use disables it instead, so their history stays intact.

The environment drawer shows its schema (with **Refresh schema**), its **LLM model slots**, the **Official defaults**, and **Policies**:

| Policy | Default | Meaning |
|---|---|---|
| **Default priority** | `NORMAL` | Priority used when the launch form leaves it on **Environment default**. |
| **Max priority** | `NORMAL` | Highest priority allowed on this environment. Raise it to `HIGH` to allow preempting launches. |
| **Max in-flight jobs** | `5` | Jobs qym keeps submitted or running on this environment at once. The rest wait in the queue. |
| **Allow connection keys** | off | Send model API keys to this service. Changing the URL turns it off again. |
| **Ranking metric** and k | project default | How **Best run** ranks runs on this environment. |

The health dot is **Healthy**, **Error**, or **Unknown**. **Test** checks it again. When the service rejects the key, dispatch to the environment pauses until a check passes.

### Model slots

A **model slot** groups the schema fields that describe one LLM (model name, base URL, and API key) so a launch can fill them from a project model. qym proposes slots automatically:

- Every entry of `LLM_OVERRIDES.endpoints` becomes an `endpoint:<name>` slot. `endpoint:primary` is always proposed and required.
- Top-level fields that share a prefix and end in `_MODEL`, `_BASE_URL`, `_API_KEY`, or a similar suffix become one `flat:<PREFIX>` slot. A group with only a model field is still a slot.

In **Group LLM settings** a manager can rename slots, map or unmap fields, merge slots, add an endpoint slot (for example `fast`), and remove slots (their fields become plain inputs). **Confirm grouping** saves them. Until the slots are confirmed, the launch form still works but shows LLM fields as raw inputs, with the banner "Group LLM settings to pick project models". The environments table flags such an environment with **Needs LLM grouping**.

When a schema refresh changes the fields, confirmed slots whose fields still exist carry over. Slots whose fields disappeared become stale, new candidates are proposed, and the banner returns until a manager confirms again.

### Project models and temporary models

At launch, each slot takes one binding:

| Binding | What it sends |
|---|---|
| **Project models** | The model, base URL, and key of a project LLM connection marked **Available for experiments**. The dispatcher reads the connection again each time it submits a job, so a rotated key is picked up on retry. |
| **+ Temporary model** | A label, model, base URL, and API key typed for this experiment only. |
| **Inherit** | Nothing. The worker keeps its own setting. |

Model keys are only sent to environments with **Allow connection keys** turned on. On other environments, a connection that carries a key is shown as unavailable ("Model API keys are not sent to this environment") and temporary models are not accepted. A connection without a key, or a slot without an API-key field, works on any environment.

A temporary model's key is encrypted, never shown again, and deleted once every job of the experiment has finished or is blocked. Retrying a job after that asks for the key again. Clones, presets, and best-run bases copy the label, model, and base URL, never the key. A project manager can tick **Save to project models** to turn a temporary model into a project LLM connection instead.

If a bound connection is deleted or made unavailable before its job is sent, the job becomes `BLOCKED` with a reason such as `Model "X" no longer exists`.

### Launching an experiment

Open **Experiments → New experiment**. The form has one section per step and a live **Preview** on the side:

1. **Environments**: one or more. Each selected environment gets one job per configuration. **+ New environment** opens the environment dialog.
2. **Dataset**: a **Project dataset** (optionally pinned to a version or alias) or a **Custom string** sent as `evaluator.dataset`. Runs on a custom string are never ranked as best runs.
3. **Start from**: the base configuration that your edits are layered on.

   | Base | Loads |
   |---|---|
   | **Official defaults** | The environment's published official defaults (see below). |
   | **Best run** | The configuration of a top-ranked official run on the selected dataset version. |
   | **Saved preset** | A named preset saved on the environment. |
   | **Blank** | Nothing; every setting inherits the environment's value. |
   | **Clone** | An earlier experiment, from its **Clone** action or from **Rerun with this config** on a run page. |

   A changed setting shows a dot and can be reset to the base value. The header counts the **Diff vs base**. **Reset all to base** drops every edit, and **Switch base** keeps the edits that also exist on the new base. When a base was authored on an older schema, settings that no longer exist are dropped and listed ("Some settings are no longer supported").
4. **Models**: one card per confirmed slot.
5. **Settings**: the generated form, grouped, with **Search settings** and **Changed only**. Only changed values are sent; an unset field shows "Inherited from environment".
6. **Advanced**: collapsed by default, with three tabs.
   - **Evaluation inputs**: the `evaluator.config` fields (`samples`, `report_k`, timeouts, retries, and so on) and custom **Run metadata** keys. Keys starting with `qym_` are reserved. The platform fills `run_name`, `live_mode` (always `platform`), and the model from the `primary` slot, and shows them read-only.
   - **Role overrides**: one row per role in the schema (`main`, `router`, …) with `endpoint`, `temperature`, `max_tokens`, and the other role fields. An empty cell keeps the service default.
   - **Raw JSON**: the whole configuration document, kept in sync with the form. Keys never appear here; model slots show a `connection_id` or a secret reference.
7. **Priority and name**: **Environment default**, `LOW`, `NORMAL`, or `HIGH`, and the **Experiment name**.

The **Preview** validates the configuration against every selected environment as you edit, lists the generated run names (`{experiment name} · {swept values}`, plus the environment name when you launch on several), and enables **Launch** once the configuration is valid. A setting that one of the selected environments does not have is an error for that environment; reset the field or deselect the environment.

#### Sweeps and linked groups

Any scalar setting, and any model slot, can take several values. Use **Sweep several values** on a field to turn it into a list of values; numbers also offer **Range…** (start, stop, step). Picking several project models in a slot sweeps the model.

Every swept field is an axis of a grid, so two models × two thresholds give four configurations. Under **Sweeps**, select two or more swept fields and choose **Link selected** to vary them together instead: the n-th values run together, for example model X with temperature 0.2 and model Y with 0.7. Linked fields must have the same number of values.

The job count is `configurations × environments`. It is capped at 64 by default (the operator setting `QYM_EVAL_SWEEP_MAX_JOBS`). Over the cap, the preview shows **Over the run limit** and **Launch** stays disabled.

Launches are also rate-limited per user, to 30 per hour by default. Previews are not counted.

#### HIGH priority

A `HIGH` job makes the Evaluation Service cancel every running `LOW` or `NORMAL` job on that environment, for all users. So `HIGH` needs all three of:

- the environment's **Max priority** set to `HIGH`;
- a project manager or global admin launching it;
- confirmation of **Launch at HIGH** in the warning dialog.

Retrying a `HIGH` job asks for the same confirmation.

### Experiment detail: matrix, compare, retry, cancel

The **Experiments** list shows each experiment's environments, base source, job counts, best score, and creator. Opening one shows:

- **Matrix**: one row per configuration and one column per environment. Each cell shows the job status, the headline metric, and a link to the run. Tick cells and use **Compare selected** to open their runs side by side. **Save as preset** saves a cell's configuration as a saved preset on its environment; **Promote to official** opens the official defaults editor with it.
- **Setting vs metric**: the mean metric of each finished run against one swept setting, one line per environment.
- **Job history**: every job, including earlier attempts, with **Cancel** and **Retry** per job.
- A queue strip with the experiment's unfinished jobs and **Open in queue →**.

The experiment's creator and project managers can cancel and retry. **Cancel experiment** cancels every queued or running job. **Retry failed** queues a new attempt of every failed, timed-out, cancelled, or blocked job; earlier attempts stay in the history. Each job can be retried once; after that, retry its newest attempt.

Job statuses:

| Status | Meaning |
|---|---|
| `QUEUED` | Waiting in qym, for example for a free in-flight slot. |
| `SUBMITTING` | Being sent to the service. |
| `SUBMITTED` | Accepted by the service and waiting in its queue. |
| `RUNNING` | Running on the service, or its linked run has started. |
| `SUCCEEDED` / `FAILED` | Finished. A linked run that failed or stopped early counts as failed. |
| `BLOCKED` | Cannot be sent without a change, for example a missing model or a configuration the service rejected. Fix the cause, then **Retry**. |
| `CANCELLING` | Cancel requested; the dispatcher is stopping the remote job. |
| `CANCELLED` | Cancelled. The linked run, if any, is marked `STOPPED`. |
| `TIMED_OUT` | Running, but with no progress from the service or the run for 2h15m. |

The experiment status summarizes its jobs: `QUEUED`, `RUNNING`, `COMPLETED` (all succeeded), `PARTIAL` (some succeeded), `FAILED`, or `CANCELLED`.

### Official defaults and saved presets

Each environment can have **Official defaults**: a curated, versioned configuration that is the default base of every launch on it. Open it from the environment drawer in **Project Settings → Environments**.

- Only project managers publish. **Edit and publish** opens the launch form without sweeps. Publishing requires release notes ("What changed and why") and creates the next version. Earlier versions never change and stay in the **Version history**.
- **Run official defaults**, on the environment row and in the launch form, launches a one-job experiment from the latest version.
- Official defaults cannot hold temporary models. Rebind those slots to project models before **Publish** is enabled.
- **Saved presets** are named starting points that any member can save, for example from a matrix cell. Open one with **Open in launch form**.

**Promote to official** is offered on a saved preset, on a completed official run (in the run page's Experiment panel), and on a matrix cell. It always opens the official defaults editor, prefilled with that configuration and compared with the current version. Nothing is published until a manager clicks **Publish**.

### Best run and drift warnings

**Start from → Best run** ranks the environment's official runs on the selected **dataset version**. Runs on other versions are never compared; when the version has no eligible run, the picker says so.

- A run is eligible when it is official, linked to a job on the environment, not deleted, completed (a run that moved on to submitted or approved review also counts; a rejected one does not), and has a score for the chosen metric.
- **Rank by metric** defaults to the environment's ranking metric, then to the most common metric. Runs are ordered by mean score (in the metric's direction), then pass@k, then size (larger first), then recency.
- Runs with more than 20% errored items are hidden unless you tick **Include runs with over 20% errored items**.

Choosing a run loads its configuration, re-mapped onto the current schema. Deleted or unavailable project models become unbound slots with a warning. Temporary models are left unbound ("Temporary models were left unbound"): pick a project model, or use the temporary model again and enter its key.

The header warns **Agent or KB versions changed since this run** when the service's latest reported agent or knowledge-base version differs from the run's. Launching reproduces the configuration, not the agent or knowledge base the run used, so scores may differ.

### The queue

**Experiments → Queue** lists every unfinished job of the project in the order the dispatcher picks them up. Choose one environment or **All environments**, and filter by status or **Only my jobs**. The page refreshes automatically and pauses while the tab is hidden.

- One card per environment shows **In flight** against its cap, **Queued**, **Blocked**, the health, and a banner while a `HIGH` job is active. A full environment says "At capacity: queued jobs start as running ones finish."
- **Our jobs** shows each job's experiment, environment, priority, status, `wait_reason` (why it is not moving), creator, elapsed time, and linked-run progress.
- Cancel one job, the selected jobs (**Cancel selected**), or **Cancel all queued in experiment**. The confirmation splits the selection: **Queued here (not yet sent)** jobs are removed immediately; **Submitted or running on the service** jobs are hard-stopped, and their partial results stay on the linked run; jobs you may not cancel are skipped. You can give an optional reason.
- **Remote queue** shows what each environment's service holds, from a snapshot refreshed about every 30 seconds. A remote job that matches no job of this project is an **Orphan**. A remote job whose qym job already finished (for example timed out) but that the service still runs is **Stale**; it still counts toward the environment's in-flight cap. Only project managers can cancel orphans and stale jobs; that call goes straight to the service and is audit-logged.

### Official and local runs

A run is **official** only when the platform dispatched it to a registered environment and ingest verified its one-time launch token. Everything else (a laptop, CI, or copied metadata) is **local**.

- Official runs carry an **Official run** badge. The run page adds an **Experiment** panel (environment, base source, swept params, remote job id, job status, versioning) with **Rerun with this config** and, for completed runs, **Promote to official**.
- The **Runs**, **Dashboard**, **Charts**, and **Models** pages have an origin filter: **All**, **Official**, or **Local**.
- Only official runs are ranked as best runs.

"Official defaults" (the preset) and "official run" (the origin) are separate ideas.

From the CLI:

```bash
qym run list --origin official --json
qym run list --origin local
```

`--origin` accepts `official`, `local`, or `all` (the default). Each JSON row carries `origin` and an `experiment` reference (`id`, `name`, `job_id`), or `null`. The API equivalent is `GET /api/runs?origin=official`.

## Connect the SDK and CLI

Create a project API key, then configure the process that runs qym:

```bash
export QYM_BASE_URL=https://qym.example.com
export QYM_API_KEY=<project-api-key>
```

Run an evaluation:

```bash
qym run create \
  --task-file examples/example.py \
  --task-function my_task \
  --dataset my-dataset \
  --metrics exact_match,fuzzy_match \
  --samples 3
```

Platform streaming activates when the API key is available. Without it, the evaluation can still complete locally.

Useful read commands:

```bash
qym run list --json
qym run get <run_id> --json
qym run failed <run_id> --json
qym run compare <id1> <id2> --json
qym config check --json
```

Saved run uploads accept `.csv` and `.json`:

```bash
qym submit --file results.csv --task my_task --dataset my-dataset
```

Raw upload files are parsed into database rows and are not retained as uploaded artifacts.

## Administration

Global admins can manage users and projects, inspect deleted runs, and restore runs. There are no organization-tree or platform-wide personal-key screens.

For deployment, auth bootstrap, migrations, backups, health checks, and the complete environment reference, see [`packages/platform/README.md`](../README.md). Storage maintenance, recovery, and the Evaluation Service dispatcher are covered in the [operations runbook](../../../docs/internal/OPERATIONS.md). The live OpenAPI schema is available at `/openapi.json`, interactive API docs at `/api-docs`, and health status at `/healthz`.
