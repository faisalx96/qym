"""A metric's declared direction, read from its run spec (C008).

Same rule as ``metrics.js`` ``metricDirection``: ``"maximize"``,
``"minimize"``, or ``None`` when the metric declares no direction (views then
show it neutrally). Schema 1 specs (SDKs before 2026-09) sent ``"maximize"``
as a default for plain callables (``score_type == "legacy"``); that default is
not a declaration. Schema 2 specs send no direction unless one is declared.
"""

from __future__ import annotations

from typing import Any, Optional


def _schema_version(value: Any) -> int:
    try:
        return int(value or 1)
    except (TypeError, ValueError):
        return 1


def declared_direction(spec: Any) -> Optional[str]:
    """Return the direction a ``RunMetricSpec`` (or spec dict) declares."""
    if spec is None:
        return None
    get = spec.get if isinstance(spec, dict) else lambda key: getattr(spec, key, None)
    direction = str(get("direction") or "").strip().lower()
    if direction == "minimize":
        return "minimize"
    if direction != "maximize":
        return None
    if get("score_type") == "legacy" and _schema_version(get("schema_version")) < 2:
        return None
    return "maximize"


def primary_metric(metrics: Any, specs: Any) -> Optional[str]:
    """The metric a run's views lead with (C008).

    The metric whose spec is declared primary, else the first metric in
    ``run.metrics`` (spec position) order. Same rule as ``metrics.js``
    ``defaultMetricName``. ``specs`` maps metric names to ``RunMetricSpec``
    rows or to spec payloads (``"primary"``).
    """
    names = [name for name in (metrics or []) if name]
    for name in names:
        spec = (specs or {}).get(name)
        if isinstance(spec, dict):
            declared = spec.get("primary", spec.get("is_primary"))
        else:
            declared = getattr(spec, "is_primary", None)
        if declared is True:
            return name
    return names[0] if names else None
