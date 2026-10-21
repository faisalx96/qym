# Repository Guidelines

This guide explains how to develop, test, and contribute to `qym` (قيِّم).

## Project Structure & Module Organization

This is a monorepo with two independently-buildable packages under `packages/`:

- `packages/sdk/qym/`: SDK Python package (`pip install qym`)
  - `core/`: evaluator orchestration (`Evaluator`, datasets, results)
  - `metrics/`: built-ins and registry for custom metrics
  - `adapters/`: task adapters (functions, LangChain/OpenAI)
  - `platform/`: platform client and defaults
  - `utils/`: errors, env and text helpers
  - `server/`: local UIServer (offline viewer: live run SSE + saved .csv/.xlsx files)
  - `cli/`: agent-native CLI package (Typer-based, noun-verb subcommands)
  - `_static/ui/`: the offline local run viewer (build output of `frontend/`, gitignored)
- `packages/platform/qym_platform/`: Platform Python package (`pip install qym-platform`)
  - `api/`: FastAPI route modules (ingest, runs, org, web)
  - `db/`: SQLAlchemy models and session
  - `migrations/`: Alembic migrations
  - `tools/`: import scripts
  - `export_templates/run/`: frozen self-contained HTML templates for `/api/runs/{id}/export-html` and `/api/compare/export-html` (not the app UI)
  - `_static/app/`: the built React UI (output of `frontend/`, gitignored; served by `api/spa.py`)
- `frontend/`: the React + TypeScript + Vite app, which is THE platform UI (and the SDK-local viewer in `src/sdk-viewer/`); see `frontend/README.md`
- `docker/`: Dockerfile (platform), Dockerfile.frontend (UI assets image, `FRONTEND_IMAGE` build arg), build.sh, docker-compose, entrypoint
- `tests/`: test suites
  - `sdk/`: SDK unit tests
  - `platform/`: platform unit tests
- `docs/`: user guides (`USER_GUIDE.md`, `METRICS_GUIDE.md`)
- `examples/`: runnable examples and notebooks
- `internal/`: developer docs (error handling, requirements)

## Build, Test, and Development Commands
- Setup (editable + dev tools): `pip install -e packages/sdk[dev] -e packages/platform -r requirements-test.txt`
- Run CLI: `qym --help`
- Format: `black . && isort .`
- Type check: `mypy packages/sdk/qym`
- Tests: `pytest -q -n auto` (parallel via `pytest-xdist`; on a low-memory machine `-n 4` can be faster); set `QYM_TEST_POSTGRES_URL` to run the PostgreSQL cases, which otherwise skip
- Frontend (Node 24): `cd frontend && npm ci && npm run check && npm run build && npm run build:sdk` (`build` writes `packages/platform/qym_platform/_static/app/`, `build:sdk` writes `packages/sdk/qym/_static/ui/`; both gitignored). Dev: `npm run dev` (Vite on 5800, proxies the API to the platform on 8800; `frontend/README.md`). Browser tests: `npm run e2e` (platform UI), `npm run e2e:sdk` (SDK viewer); they boot their own servers. On a shared or small machine run full suites and builds through `scripts/heavy.sh -- <command>` (memory-gated, cgroup-isolated; `frontend/README.md`)
- Build SDK wheel: `pip wheel packages/sdk/ --no-deps -w dist/` (run `npm run build:sdk` first so the viewer is in the wheel)
- Build platform wheel: `pip wheel packages/platform/ --no-deps -w dist/` (requires the built `_static/app/`, so run `npm run build` first; the Docker image builds it in a Node stage)
- Build platform Docker: `docker/build.sh` (builds the UI assets image, then the platform image; set `FRONTEND_IMAGE` to reuse a published one), or `docker compose -f docker/docker-compose.yml build frontend` then `build`

Example local run:
```
qym --task-file examples/example.py \
  --task-function my_task --dataset my-set \
  --metrics exact_match,fuzzy_match
```

## Environment Variables
- SDK: `QYM_BASE_URL`, `QYM_API_KEY`, `QYM_PLATFORM_DEBUG`, `QYM_DATASET_READ_TOKEN` (optional, admin-issued per project; lets a service read private test sets — sent only on dataset reads, runs still use `QYM_API_KEY`), `QYM_METRIC_CONCURRENCY` (optional; how many items are scored at once by the metric queue, which runs separately from task execution; default = `max_concurrency`; `config["metric_concurrency"]` overrides it)
- Platform: `QYM_ENVIRONMENT`, `QYM_DATABASE_URL`, `QYM_AUTH_MODE`, `QYM_ADMIN_BOOTSTRAP_TOKEN`, `QYM_BASE_URL`, `QYM_ALLOW_PRIVATE_LLM_BASE_URLS`, `QYM_RUN_STALE_TIMEOUT_SECONDS` (default 180), `QYM_EVAL_JOB_TIMEOUT_SECONDS` (default 8100), `QYM_LOG_LEVEL` (default `INFO`), `QYM_LOG_FORMAT` (`text` default | `json`; see `docs/internal/OPERATIONS.md` "Logging"), `QYM_DASHBOARD_LIVE_REFRESH_SECONDS` (default 2; live dashboard rebuild interval)
- Platform logging: modules use `from qym_platform.log import get_logger` and `logger = get_logger(__name__)` (never `logging.getLogger`); log caught errors with `logger.exception(...)` (or `log_exception(logger, msg, **context)`) so the traceback is kept; never log credentials or request bodies. Entry points call `configure_logging()` (idempotent)
- Service split (platform, optional; see `docs/internal/OPERATIONS.md` "Service split deployment"): `QYM_SERVICE` (`all` default | `main` | `ingestion` | `workers`; wins over legacy `QYM_ROLE`), `QYM_MAIN_PREFIX` (default ""), `QYM_INGESTION_PREFIX` (default `/ingestion`), `QYM_WORKERS_PREFIX` (default `/workers`), `QYM_MAIN_INCLUDE_INGEST` (default true), `QYM_INGESTION_LEGACY_PATHS` (default true), `QYM_PUBLIC_UI_URL` (links; fallback `QYM_BASE_URL`), `QYM_INTERNAL_PLATFORM_URL` (workers' product-eval runner; fallback `QYM_BASE_URL`), `QYM_JOB_QUEUE_TIMEOUT_SECONDS` (default 1800), `QYM_JOB_POLL_INTERVAL_SECONDS` (default 1), `QYM_SERVICE_HEARTBEAT_SECONDS` (default 10), `QYM_PRODUCT_EVAL_MAX_QUEUED` (default 0 = max workers). SDK clients need no change: ingress rules route `/v1/runs`, `/v1/runs:upload`, `/v1/runs/{id}/events` to ingestion
- Langfuse trace links (optional, platform compare view): `LANGFUSE_HOST` (or `LANGFUSE_BASE_URL`), `LANGFUSE_PROJECT_ID`

## Coding Style & Naming Conventions
- Python 3.9+, PEP 8, 4-space indentation.
- Use type hints and concise docstrings.
- Modules/files: `snake_case.py`; classes: `PascalCase`; functions/vars: `snake_case`.
- Keep public APIs minimal; avoid editing generated folders.

## UI & Design Work (mandatory)
The UI lives in `frontend/` (React + TypeScript + Vite, CSS Modules). Any change
there must follow **`docs/DESIGN_LANGUAGE.md`** — the single source of truth for
design tokens (`frontend/src/styles/tokens.css`), the type scale and its roles,
text-color usage, mono-vs-sans policy, and the primitives in `frontend/src/ui/`.
Read it before styling anything. Rules are enforced by
`frontend/src/__tests__/design-language.test.ts` (plus ESLint and Stylelint).
After any UI change run `cd frontend && npm run check` and
`pytest tests/platform/test_design_language.py` (a thin runner of the same test).
Never hand-edit `_static/app/` or `_static/ui/`; they are build output.

UI dev loop: seed a SQLite DB with `python frontend/scripts/dev_db.py`, run the
platform with uvicorn (`QYM_AUTH_MODE=none`), then `cd frontend && npm run dev` and
open `http://127.0.0.1:5800/` (`/__ui` is the primitive gallery). Details in
`frontend/README.md`.

## Working on a shared or small machine (mandatory)
Two sessions were killed in October 2026 (kernel OOM, then `systemd-oomd` on sustained memory pressure
of the whole user slice; see `docs/internal/ui-migration/POSTMORTEM.md` section 1). Therefore:
- Every full suite, build and `pytest -n` goes through `scripts/heavy.sh [--cost GB] [--name L] -- <cmd>`.
  Never pass `--workers`; the script exports `VITEST_MAX_WORKERS` / `QYM_PW_WORKERS` from the budget.
- Cost guide: 2 = Vitest subset, tsc, builds, one Playwright spec file; 3 = `npm run check`, one Playwright
  folder, `pytest tests/sdk`; 4 = full `npm run e2e`, `pytest tests/platform` in chunks of about 48 files
  (`ls tests/platform/test_*.py | split -l 48`). Cost + reserve (max of 2 GB and 20% of RAM) must fit under
  what the desktop leaves free. The script never admits a run under a cap smaller than its cost (pass `--min-cost` to
  allow lowering) and adds 1 GB to the reserve while less than 1 GB of swap is free; a run that keeps printing `waiting`
  has the wrong cost for this machine, or the desktop holds too much (log out and in when GNOME Shell exceeds 2 GB).
- Heavy runs go to a log file; read the log for `heavy.sh [...]: waiting` before reporting progress. A run
  that prints `waiting` for more than ten minutes has the wrong cost, not a slow test.
- Light commands (one spec with `--workers 1`, one or two Vitest files, tsc, eslint) run directly.
- Stop uvicorn, Vite and stub servers the moment a check ends; find your own PIDs by port (`ss -ltnp`).
  Never `pkill -f` by pattern: it kills other agents' Playwright and servers.
- Filesystem boundary: an agent (the orchestrator and every sub-agent) may read or write only inside this
  repository and its parent directory one level up (`..`, where the `qym-wt-*` worktrees and the legacy checkout
  live), plus its own scratchpad. Nothing above that parent (home, other projects, system paths) is opened,
  listed, searched or written; the project venv and nvm are used through their documented commands only.
- Per-agent files: each agent keeps its own env file, e2e DB (`QYM_E2E_DB=<worktree>/.qym-e2e-<branch>.db`) and
  ports; never share a scratchpad file name such as `env.sh` across agents (one overwrote another's and ran
  Playwright against the other agent's database).
- Agents: at most one sub-agent each; `free -h` with at least 3 GB available before starting another agent;
  one hand-back per task (an agent that re-sends the same report is stopped, not answered).
- Environment for anything that boots the platform: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`
  (Node 24), `source .venv/bin/activate`, `export PYTHONPATH=packages/sdk:packages/platform`
  `QYM_PYTHON=$PWD/.venv/bin/python`. Playwright's webServer needs the venv active. Parallel agents use
  their own `QYM_PLATFORM_PORT` / `QYM_VITE_PORT` (eval services +100/+101, stub LLM +1000).

## UI product-feedback rounds (mandatory)
A feedback round is three stages, each by a different agent (`docs/internal/ui-migration/00-PLAYBOOK.md`):
1. **Design**: measure the current page and the legacy page at the real column widths, write a spec with
   numbered acceptance criteria (each names the DOM element, the width and the number), static mocks in the
   gallery (`/__ui`), screenshots. "Clear", "cluttered" and "refer to the old design" become numbers here.
   Every surface gets a **composed page mock first** (the whole page in the app shell, realistic data, default
   state, real size, shots at 1440 and 390), then the component state sheets as the appendix (playbook).
2. **Implement** criterion by criterion with a criterion -> change -> test table and after-screenshots;
   full gate through `heavy.sh` before the hand-back; backend touched means `tests/platform` runs.
3. **Review**: an independent agent measures every criterion in the browser and writes MEETS / MEETS WITH
   FIXES / DOES NOT MEET with the numbers. A verdict without measurements is not a verdict. A fix must change
   the measured value or the screenshot; otherwise it is a documented limitation, not a fix.
The design standards behind this (density versus hiding, hue budget, amendment rule) are in
`docs/DESIGN_LANGUAGE.md` section 6; the design choices that failed and the generic rules that replaced them
(no overlays on content, names never truncated, loading frames at the loaded height, a request returns what its
view renders, load by default, compositor-positioned sticky elements) are section 7. Read both before a spec. Merges into the integration branch are plain `--no-ff`; nothing is pushed
by agents; `ui/*` branches and worktrees are kept.

## Testing Guidelines
- Framework: `pytest` with `pytest-asyncio` for async paths.
- Place SDK tests in `tests/sdk/` and platform tests in `tests/platform/`.
- Include fast unit tests for metrics and adapters; add an integration test for CLI when practical.

## Commit & Pull Request Guidelines
- Commits: imperative mood, scoped and small; Conventional Commits welcome (e.g., `feat:`, `fix:`).
- PRs: clear description, linked issue (`#123`), before/after notes, and any docs updates.
- Include evidence of testing (command output or saved results JSON/CSV). Do not commit `.env`, `build/`, or `*.egg-info` changes.

## Security & Configuration Tips
- Credentials: set via env vars or `.env` (auto-loaded).
```
QYM_BASE_URL=https://your-qym-platform.example.com
QYM_API_KEY=...
```
- `.env` is gitignored; never commit secrets.

## CLI Commands (Agent-Native)

The `qym` CLI uses noun-verb subcommands with `--json` output for agent consumption.
All commands support `--json` (structured JSON to stdout, human text to stderr).

```bash
# Inspect runs
qym run list [--limit 50] [--task TEXT] [--model TEXT] [--status TEXT] [--origin official|local|all] [--versioning KEY=VALUE ...] --json
#   each run carries origin ("official"|"local"), experiment ({id, name, job_id, latency_sensitive} or null)
#   and versioning (the Evaluation Service's versioning_metadata, any key; {} when none)
#   and versioning_details (free-form keys from the run's creator / experiment; {} when none)
qym run get <run_id> --json   # run.versioning_details
qym run failed <run_id> --json
qym run compare <id1> <id2> --json

# Execute evaluations
qym run create --task-file FILE --task-function NAME --dataset NAME --metrics LIST \
  [--versioning-detail KEY=VALUE ...] [--versioning-details JSON]
#   stored on the run as versioning_details (EvaluatorConfig.versioning_details);
#   KEY=VALUE wins over the JSON object, which wins over --config

# Metrics
qym metric list --json

# Analysis
qym analyze run <run_id> --json
qym analyze summary <run_id> --json

# Local viewer (offline, no platform)
qym run create ... --local-ui [--ui-port N] [--no-open]   # live viewer while the run executes
qym ui [FILE.csv|FILE.xlsx] [--port N] [--results-dir DIR]  # open a saved results file

# Config
qym config show --json
qym config check --json
```

Exit codes: 0=success, 1=failure, 2=usage error, 3=not found, 4=auth denied, 5=conflict.

Legacy syntax (`qym --task-file ...`) is auto-rewritten to `qym run create --task-file ...`.

## Extending the Framework
- Metrics: add to `packages/sdk/qym/metrics/builtin.py` or register dynamically via `metrics.registry.register_metric(name, func)`.
- Adapters: add under `packages/sdk/qym/adapters/` and wire into `auto_detect_task`.
