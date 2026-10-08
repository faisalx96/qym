# Repository Guidelines

This guide explains how to develop, test, and contribute to `qym` (قيِّم).

## Project Structure & Module Organization

This is a monorepo with two independently-buildable packages under `packages/`:

- `packages/sdk/qym/`: SDK Python package (`pip install qym`)
  - `core/`: evaluator orchestration (`Evaluator`, datasets, results)
  - `metrics/`: built-ins and registry for custom metrics
  - `adapters/`: task adapters (functions, LangChain/OpenAI)
  - `platform/`: platform client and defaults
  - `utils/`: errors and HTML/HTTP frontend helpers
  - `server/`: local UIServer + DashboardServer
  - `cli/`: agent-native CLI package (Typer-based, noun-verb subcommands)
  - `_static/`: UI and dashboard assets
- `packages/platform/qym_platform/`: Platform Python package (`pip install qym-platform`)
  - `api/`: FastAPI route modules (ingest, runs, org, web)
  - `db/`: SQLAlchemy models and session
  - `migrations/`: Alembic migrations
  - `tools/`: import scripts
  - `_static/`: platform-specific UI assets
- `docker/`: Dockerfile, docker-compose, entrypoint
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
- Build SDK wheel: `pip wheel packages/sdk/ --no-deps -w dist/`
- Build platform Docker: `docker compose -f docker/docker-compose.yml build`

Example local run:
```
qym --task-file examples/example.py \
  --task-function my_task --dataset my-set \
  --metrics exact_match,fuzzy_match
```

## Environment Variables
- SDK: `QYM_BASE_URL`, `QYM_API_KEY`, `QYM_PLATFORM_DEBUG`, `QYM_DATASET_READ_TOKEN` (optional, admin-issued per project; lets a service read private test sets — sent only on dataset reads, runs still use `QYM_API_KEY`), `QYM_METRIC_CONCURRENCY` (optional; how many items are scored at once by the metric queue, which runs separately from task execution; default = `max_concurrency`; `config["metric_concurrency"]` overrides it)
- Platform: `QYM_ENVIRONMENT`, `QYM_DATABASE_URL`, `QYM_AUTH_MODE`, `QYM_ADMIN_BOOTSTRAP_TOKEN`, `QYM_BASE_URL`, `QYM_ALLOW_PRIVATE_LLM_BASE_URLS`, `QYM_RUN_STALE_TIMEOUT_SECONDS` (default 180), `QYM_EVAL_JOB_TIMEOUT_SECONDS` (default 8100), `QYM_LOG_LEVEL` (default `INFO`), `QYM_LOG_FORMAT` (`text` default | `json`; see `docs/internal/OPERATIONS.md` "Logging")
- Platform logging: modules use `from qym_platform.log import get_logger` and `logger = get_logger(__name__)` (never `logging.getLogger`); log caught errors with `logger.exception(...)` (or `log_exception(logger, msg, **context)`) so the traceback is kept; never log credentials or request bodies. Entry points call `configure_logging()` (idempotent)
- Service split (platform, optional; see `docs/internal/OPERATIONS.md` "Service split deployment"): `QYM_SERVICE` (`all` default | `main` | `ingestion` | `workers`; wins over legacy `QYM_ROLE`), `QYM_MAIN_PREFIX` (default ""), `QYM_INGESTION_PREFIX` (default `/ingestion`), `QYM_WORKERS_PREFIX` (default `/workers`), `QYM_MAIN_INCLUDE_INGEST` (default true), `QYM_INGESTION_LEGACY_PATHS` (default true), `QYM_PUBLIC_UI_URL` (links; fallback `QYM_BASE_URL`), `QYM_INTERNAL_PLATFORM_URL` (workers' product-eval runner; fallback `QYM_BASE_URL`), `QYM_JOB_QUEUE_TIMEOUT_SECONDS` (default 1800), `QYM_JOB_POLL_INTERVAL_SECONDS` (default 1), `QYM_SERVICE_HEARTBEAT_SECONDS` (default 10), `QYM_PRODUCT_EVAL_MAX_QUEUED` (default 0 = max workers). SDK clients need no change: ingress rules route `/v1/runs`, `/v1/runs:upload`, `/v1/runs/{id}/events` to ingestion
- Langfuse trace links (optional, platform compare view): `LANGFUSE_HOST` (or `LANGFUSE_BASE_URL`), `LANGFUSE_PROJECT_ID`

## Coding Style & Naming Conventions
- Python 3.9+, PEP 8, 4-space indentation.
- Use type hints and concise docstrings.
- Modules/files: `snake_case.py`; classes: `PascalCase`; functions/vars: `snake_case`.
- Keep public APIs minimal; avoid editing generated folders.

## UI & Design Work (mandatory)
Any change to `packages/platform/qym_platform/_static/` must follow
**`docs/DESIGN_LANGUAGE.md`** — the single source of truth for design tokens,
the type scale and its roles, text-color usage, mono-vs-sans policy, and
component recipes. Read it before styling anything. Rules are enforced by
`tests/platform/test_design_language.py`; run it after any UI change.

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
#   each run carries origin ("official"|"local"), experiment ({id, name, job_id} or null)
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

# Config
qym config show --json
qym config check --json
```

Exit codes: 0=success, 1=failure, 2=usage error, 3=not found, 4=auth denied, 5=conflict.

Legacy syntax (`qym --task-file ...`) is auto-rewritten to `qym run create --task-file ...`.

## Extending the Framework
- Metrics: add to `packages/sdk/qym/metrics/builtin.py` or register dynamically via `metrics.registry.register_metric(name, func)`.
- Adapters: add under `packages/sdk/qym/adapters/` and wire into `auto_detect_task`.
