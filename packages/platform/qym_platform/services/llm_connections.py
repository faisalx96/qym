"""Queries over a project's LLM connections."""

from __future__ import annotations

from typing import List, Optional

from qym_platform.db.models import ProjectLlmConnection
from sqlalchemy.orm import Query, Session


def project_connections_query(
    db: Session,
    project_id: str,
    *,
    available_for_experiments: Optional[bool] = None,
) -> Query:
    """Return a project's connections, default first, then oldest first.

    ``available_for_experiments`` filters on the flag when it is not ``None``.
    """
    query = db.query(ProjectLlmConnection).filter(
        ProjectLlmConnection.project_id == project_id
    )
    if available_for_experiments is not None:
        query = query.filter(
            ProjectLlmConnection.available_for_experiments
            == bool(available_for_experiments)
        )
    return query.order_by(
        ProjectLlmConnection.is_default.desc(),
        ProjectLlmConnection.created_at,
        ProjectLlmConnection.id,
    )


def list_experiment_connections(
    db: Session, project_id: str
) -> List[ProjectLlmConnection]:
    """Connections the experiments model picker may offer for this project."""
    return project_connections_query(
        db, project_id, available_for_experiments=True
    ).all()
