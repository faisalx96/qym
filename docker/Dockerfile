# syntax=docker/dockerfile:1.7
ARG BASE_IMAGE=python:3.11-slim
ARG FRONTEND_BASE_IMAGE=node:24-slim

# The React SPA (frontend/) is built once here and copied into the platform
# package as _static/app/ (gitignored; the wheel and the image carry the build).
FROM ${FRONTEND_BASE_IMAGE} AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY frontend/ ./
# Vitest suites compare React against the server's golden payloads; `tsc -b` in the build type-checks them too.
COPY tests/platform/fixtures/golden /build/tests/platform/fixtures/golden
# vite.config.ts writes to ../packages/platform/qym_platform/_static/app and
# vite.sdk.config.ts (the SDK's offline results viewer) to ../packages/sdk/qym/_static/ui
RUN mkdir -p /build/packages/platform/qym_platform /build/packages/sdk/qym && npm run build && npm run build:sdk


FROM ${BASE_IMAGE} AS python-base

ARG PIP_INDEX_URL
ARG PIP_TRUSTED_HOST
ARG PIP_SEARCH_INDEX
ARG PIP_SEARCH_TRUSTED_HOST

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
# Apply the Nexus PyPI mirror configuration
ENV PIP_INDEX_URL=${PIP_INDEX_URL}
ENV PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST}
ENV PIP_SEARCH_INDEX=${PIP_SEARCH_INDEX}
ENV PIP_SEARCH_TRUSTED_HOST=${PIP_SEARCH_TRUSTED_HOST}

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip


FROM python-base AS dev

# Prime dependency resolution from package metadata so source edits do not
# force a full reinstall during dev rebuilds.
COPY packages/sdk/pyproject.toml /app/packages/sdk/pyproject.toml
COPY packages/sdk/README.md /app/packages/sdk/README.md
COPY packages/sdk/qym/_version.py /app/packages/sdk/qym/_version.py
COPY packages/platform/pyproject.toml /app/packages/platform/pyproject.toml
RUN mkdir -p /app/packages/sdk/qym /app/packages/platform/qym_platform
RUN touch /app/packages/sdk/qym/__init__.py /app/packages/platform/qym_platform/__init__.py
COPY packages/sdk/qym/_version.py /app/packages/sdk/qym/_version.py
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -e /app/packages/sdk -e /app/packages/platform

COPY packages/sdk /app/packages/sdk
COPY packages/platform /app/packages/platform
COPY --from=frontend-build /build/packages/platform/qym_platform/_static/app /app/packages/platform/qym_platform/_static/app
COPY --from=frontend-build /build/packages/sdk/qym/_static/ui /app/packages/sdk/qym/_static/ui
COPY insightor_eval.py /app/insightor_eval.py
COPY tools /app/tools

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]


FROM python-base AS runtime-base

COPY packages/sdk /app/packages/sdk
COPY packages/platform /app/packages/platform
COPY --from=frontend-build /build/packages/platform/qym_platform/_static/app /app/packages/platform/qym_platform/_static/app
COPY --from=frontend-build /build/packages/sdk/qym/_static/ui /app/packages/sdk/qym/_static/ui
COPY insightor_eval.py /app/insightor_eval.py
COPY examples /app/examples
COPY tools /app/tools

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install /app/packages/sdk -e /app/packages/platform

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Run unprivileged: /app stays root-owned and read-only to the process, so
# nothing is written into the image layer. Deployments also mount the root
# filesystem read-only with a small tmpfs at /tmp (docker-compose.yml).
RUN groupadd --system --gid 10001 qym \
    && useradd --system --uid 10001 --gid qym --no-create-home --shell /usr/sbin/nologin qym
# HOME points at the tmpfs so a library cache never reaches the image layer;
# platform event streams never spill to disk (events wait in memory instead).
ENV HOME=/tmp \
    QYM_PLATFORM_EVENT_SPILL_BYTES=0
USER qym

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]


FROM runtime-base AS final
