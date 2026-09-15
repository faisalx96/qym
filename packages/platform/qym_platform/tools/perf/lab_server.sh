#!/usr/bin/env bash
# Start the platform against the perf-lab database with timing enabled.
#
#   tools/perf/lab_server.sh            # API + worker (prod-like single process)
#   QYM_ROLE=api tools/perf/lab_server.sh
#   QYM_ROLE=worker tools/perf/lab_server.sh
#
# Variables are passed explicitly so the repo's .env (which may configure OIDC)
# never leaks into the lab.
set -euo pipefail
export QYM_DATABASE_URL="${QYM_DATABASE_URL:-postgresql+psycopg2://qym:qym@localhost:15433/qym_perf}"
export QYM_AUTH_MODE=none
export QYM_ENVIRONMENT=dev
export QYM_REQUEST_TIMING="${QYM_REQUEST_TIMING:-1}"
export QYM_ROLE="${QYM_ROLE:-all}"
export QYM_BASE_URL="http://localhost:${PORT:-8010}"
exec python3 -m uvicorn qym_platform.main:app --host 127.0.0.1 --port "${PORT:-8010}" --log-level "${LOG_LEVEL:-warning}"
