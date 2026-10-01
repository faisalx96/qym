#!/bin/sh
set -eu

# Optional worker containers (QYM_ROLE=worker) run alongside API pods that
# already applied the schema; skip the migration step there.
if [ "${QYM_SKIP_MIGRATIONS:-0}" = "1" ]; then
  echo "Skipping migrations (QYM_SKIP_MIGRATIONS=1)"
else
  echo "Running migrations..."
  alembic -c packages/platform/qym_platform/migrations/alembic.ini upgrade head
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

if [ "${QYM_ROLE:-all}" = "worker" ]; then
  echo "Starting worker..."
  exec python -m qym_platform.worker
fi

# QYM_WEB_WORKERS>1: several uvicorn processes serve HTTP; with QYM_ROLE=all one
# extra process runs the background loops (see qym_platform/serve.py).
if [ "${QYM_WEB_WORKERS:-1}" != "1" ]; then
  echo "Starting API with ${QYM_WEB_WORKERS} web workers..."
  exec python -m qym_platform.serve
fi

echo "Starting API..."
exec uvicorn qym_platform.main:app --host 0.0.0.0 --port 8000 ${QYM_UVICORN_ARGS:-}
