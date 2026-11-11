"""A project's direction for metrics that declare none (C129), in the existing ``platform_settings`` table.

A metric's own spec wins. When it declares no direction, the run page assumes
higher is better for 0-1 scores, and a project manager can save the other
choice here, per project and metric. One row per project, keyed
``metric_directions:<project_id>``, its value a JSON object
``{metric: "maximize" | "minimize"}``. No migration: the table exists since 0002.
"""
from __future__ import annotations

import json
from typing import Dict, Iterable, Optional

from sqlalchemy.orm import Session

from qym_platform.db.models import PlatformSetting

DIRECTIONS = ("maximize", "minimize")
KEY_PREFIX = "metric_directions:"


def _key(project_id: str) -> str:
    return KEY_PREFIX + project_id


def _parse(value: Optional[str]) -> Dict[str, str]:
    try:
        data = json.loads(value or "{}")
    except (TypeError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): v for k, v in data.items() if v in DIRECTIONS}


def metric_directions(db: Session, project_id: str) -> Dict[str, str]:
    row = db.get(PlatformSetting, _key(project_id))
    return _parse(row.value if row else None)


def metric_directions_for(db: Session, project_ids: Iterable[str]) -> Dict[str, Dict[str, str]]:
    """Every listed project's saved directions in one query ({} for a project with none)."""
    ids = list(project_ids)
    if not ids:
        return {}
    rows = db.query(PlatformSetting).filter(PlatformSetting.key.in_([_key(pid) for pid in ids])).all()
    found = {row.key[len(KEY_PREFIX):]: _parse(row.value) for row in rows}
    return {pid: found.get(pid, {}) for pid in ids}


def set_metric_direction(db: Session, project_id: str, metric: str, direction: Optional[str]) -> Dict[str, str]:
    """Save (or clear, with None) one metric's direction for the project. The caller commits."""
    if direction is not None and direction not in DIRECTIONS:
        raise ValueError("direction must be maximize, minimize or null")
    row = db.get(PlatformSetting, _key(project_id))
    current = _parse(row.value if row else None)
    if direction is None:
        current.pop(metric, None)
    else:
        current[metric] = direction
    if row is None:
        row = PlatformSetting(key=_key(project_id), value="{}")
        db.add(row)
    row.value = json.dumps(current, sort_keys=True)
    return current
