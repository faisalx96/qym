# Backend stall during final reruns

Timestamp: 2026-09-15T11:19:31.855599+00:00

Docker context: OrbStack. The daemon's Unix socket `/_ping`, disposable PostgreSQL port 15448, and smoke API port 18081 stopped responding. `orb status` continued to report Running; `docker version`, `docker info`, and `docker ps` timed out. Diagnostic port results are in `docker-backend-timeout.json`.

At the root agent's request, blocked PostgreSQL reruns (Python 3.9/3.11/3.12), the Docker rebuild, and the stale `docker ps` probe were terminated. Their logs are retained. No Docker/OrbStack restart and no original-container changes were made.

The exact worker cold-start regression passed with isolated SQLite databases on all three interpreters. Current wheels were rebuilt and verified byte-for-byte against all required Python, served-asset, and migration files. Final PostgreSQL and Docker checks remain pending backend recovery.

Earlier image builds, HTTP asset checks, and a foreign-key validation job had
succeeded before the latest worker fixes. Those logs do not validate the final
source image. `docker-worker-final.log` contains the later startup failure, and
`docker-build-worker-final.log` is the interrupted final rebuild. See
`storage-release-smoke.md` for the exact evidence boundaries.

## Native fallback completed

The latest source wheels subsequently passed a separate native PostgreSQL 16.15
(LZ4-enabled) API/worker smoke. This includes migration0057, served asset hashes,
maintenance HTTP behavior, and three successful fresh worker starts/jobs. Native
PostgreSQL storage regressions also passed. See `native-wheel-runtime.json` and
`postgres-lz4-312.log`. The final Docker image check remains blocked; these native
results do not claim recovery or validation of the stalled Docker runtime.

## Task-owned Docker resources to remove after recovery

- Compose project: `qym-pr47-smoke` (its own network and service resources).
- API container: `qym-pr47-smoke-api-1`.
- Worker container: `qym-pr47-smoke-worker-1`.
- Disposable test PostgreSQL container: `qym-pr47-integration-postgres`
  (host port 15448; shared only by this PR validation task).
- Built smoke image tag: `qym-pr47-integration:smoke`.

Their last observed states predate the backend stall. No cleanup probe or
removal was attempted while the Docker daemon remained unresponsive. Original
application resources such as `docker-api-1` and `docker-db-1` are outside this
cleanup list. The separate native PostgreSQL cluster is still reserved for the
root agent's version matrix; only the native smoke API/worker processes have
been stopped.
