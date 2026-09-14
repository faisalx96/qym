# Prefix-mounted startup failure

The production requests use `/qym`. With `QYM_ROOT_PATH=/qym`, `qym_platform.main.build_app()` mounted the platform inside an outer FastAPI application without forwarding its lifespan. The API served requests, but its startup handler never ran, so the summary worker never started. Queue revisions stayed at zero without worker exceptions.

Reproduction through the actual `build_app()` entry point, before the fix:

| Prefix | Health response | Worker start calls | Worker stop calls |
| --- | --- | --- | --- |
| Empty | 200 | 1 | 1 |
| `/qym` | 200 | 0 | 0 |

The previous load tests started the worker explicitly, and the previous application lifecycle test called `create_app()` directly. Both bypassed this production wrapper. FastAPI documents that mounted subapplications do not automatically receive lifecycle events: https://fastapi.tiangolo.com/advanced/events/#sub-applications

The outer application now enters the inner application's lifespan. This runs startup and shutdown exactly once, forwards lifespan state, and propagates startup errors. Worker startup and shutdown also emit explicit Uvicorn log messages.

New regression tests fail against the previous code for `/qym`, `/qym/`, lifespan state, and startup error propagation. PostgreSQL tests use `build_app()` with and without the prefix, then verify automatic historical publication and updates across worker restarts. A subprocess test launches the actual `uvicorn qym_platform.main:app` command and waits for a completed historical row from `/qym/api/dashboard/runs`, without manually starting or ticking the worker.

Validation passed: 1,102 backend tests, six skipped, plus the separately executed Uvicorn subprocess test. All 11 focused lifecycle and migration cases passed. The platform wheel built successfully and contains the corrected entry point and lifecycle logs.

Deploy the new image with the existing configuration. The startup log must include `Dashboard summary worker started` before `Application startup complete`. Existing queued history then rebuilds automatically. No migration, SDK update, or queue reset is required.
