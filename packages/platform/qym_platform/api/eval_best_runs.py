"""Best-run candidates of an environment (plan §5.1, §10.2; issue #37).

``GET /v1/projects/{project_id}/eval-environments/{env_id}/best-runs`` ranks the
environment's official runs on one dataset version. Project members may read it. The
ranking rules and the response shape are documented in ``services/eval_best_run.py``.

``GET …/eval-environments/{env_id}/best-runs/{run_id}/base`` (#38, plan §10.3) turns
one official run of the environment into a launch-form base: its stored config
re-mapped onto the current schema, temporary models and unusable connections unbound
(with prompts/warnings), and the agent/KB versioning drift against the environment's
latest job. See ``services/eval_best_run_base.py``. Nothing is persisted.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from qym_platform.api.eval_environments import _get_environment
from qym_platform.api.projects import _require_project_access
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.deps import get_db
from qym_platform.services.eval_best_run import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    BestRunError,
    rank_best_runs,
)
from qym_platform.services.eval_best_run_base import run_base

router = APIRouter()


@router.get("/v1/projects/{project_id}/eval-environments/{env_id}/best-runs")
def list_best_runs(
    project_id: str,
    env_id: str,
    dataset_id: Optional[str] = Query(default=None, max_length=200),
    dataset_version_id: Optional[str] = Query(default=None, max_length=36),
    dataset_version: Optional[str] = Query(default=None, max_length=100),
    metric: Optional[str] = Query(default=None, max_length=200),
    k: Optional[int] = Query(default=None, ge=1, le=1000),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    exclude_errored: bool = Query(default=True),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Top ``limit`` eligible runs on the dataset version, best first."""
    _require_project_access(db, principal, project_id)
    env = _get_environment(db, project_id, env_id)
    try:
        return rank_best_runs(
            db,
            env,
            dataset_id=dataset_id,
            dataset_version_id=dataset_version_id,
            dataset_version=dataset_version,
            metric=metric,
            k=k,
            limit=limit,
            exclude_errored=exclude_errored,
        )
    except BestRunError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get(
    "/v1/projects/{project_id}/eval-environments/{env_id}/best-runs/{run_id}/base"
)
def get_best_run_base(
    project_id: str,
    env_id: str,
    run_id: str,
    metric: Optional[str] = Query(default=None, max_length=200),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """A launch-ready base config from one official run of the environment."""
    _require_project_access(db, principal, project_id)
    env = _get_environment(db, project_id, env_id)
    try:
        return run_base(db, env, run_id, metric=metric)
    except BestRunError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
