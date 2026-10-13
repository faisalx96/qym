#!/usr/bin/env bash
# Build the platform image. The UI comes from an assets image
# (docker/Dockerfile.frontend): when FRONTEND_IMAGE names one, it is pulled
# and reused; when it is empty, the assets image is built here first.
#
#   docker/build.sh [-t TAG] [extra args for the platform build...]
#
# Environment:
#   FRONTEND_IMAGE       prebuilt assets image to reuse (default: build it)
#   FRONTEND_IMAGE_TAG   tag for a locally built assets image (default qym-frontend:local)
#   CONTAINER_CLI        podman (default when installed) or docker
#   BASE_IMAGE, FRONTEND_BASE_IMAGE, PIP_INDEX_URL, PIP_TRUSTED_HOST,
#   PIP_SEARCH_INDEX, PIP_SEARCH_TRUSTED_HOST  forwarded as --build-arg when set
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="${CONTAINER_CLI:-}"
if [ -z "$cli" ]; then
    if command -v podman >/dev/null 2>&1; then cli=podman; else cli=docker; fi
fi

frontend_image="${FRONTEND_IMAGE:-}"
if [ -z "$frontend_image" ]; then
    frontend_image="${FRONTEND_IMAGE_TAG:-qym-frontend:local}"
    echo "FRONTEND_IMAGE not set: building $frontend_image from docker/Dockerfile.frontend" >&2
    args=()
    [ -n "${FRONTEND_BASE_IMAGE:-}" ] && args+=(--build-arg "FRONTEND_BASE_IMAGE=$FRONTEND_BASE_IMAGE")
    "$cli" build "${args[@]}" -t "$frontend_image" -f "$repo/docker/Dockerfile.frontend" "$repo"
else
    echo "Reusing the frontend assets image $frontend_image" >&2
fi

args=(--build-arg "FRONTEND_IMAGE=$frontend_image")
for var in BASE_IMAGE PIP_INDEX_URL PIP_TRUSTED_HOST PIP_SEARCH_INDEX PIP_SEARCH_TRUSTED_HOST; do
    [ -n "${!var:-}" ] && args+=(--build-arg "$var=${!var}")
done
exec "$cli" build "${args[@]}" "$@" -f "$repo/docker/Dockerfile" "$repo"
