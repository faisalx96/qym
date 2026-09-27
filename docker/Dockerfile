# syntax=docker/dockerfile:1.7
ARG BASE_IMAGE=python:3.11-slim

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
COPY insightor_eval.py /app/insightor_eval.py
COPY tools /app/tools

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]


FROM python-base AS runtime-base

COPY packages/sdk /app/packages/sdk
COPY packages/platform /app/packages/platform
COPY insightor_eval.py /app/insightor_eval.py
COPY examples /app/examples
COPY tools /app/tools

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install /app/packages/sdk -e /app/packages/platform

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]


FROM runtime-base AS final
