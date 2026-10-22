"""Shared helpers for the pytest suites that replaced the vanilla run/compare page tests.

``share_with_react`` pins a server payload as a golden JSON file under
``tests/platform/fixtures/golden``. The pytest side proves the server still
produces that payload (up to float rounding); the Vitest side
(``frontend/src/**/__tests__/cutover-*.test.ts``) feeds the same rows to the
React libraries and asserts the numbers the server computed. Regenerate with
``QYM_UPDATE_GOLDEN=1 pytest <file>``.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

GOLDEN_DIR = Path(__file__).parent / "fixtures" / "golden"

# The row keys the React libraries read (everything else is not part of the contract).
ROW_KEYS = (
    "item_id",
    "index",
    "status",
    "error",
    "metric_values",
    "metric_meta",
    "pass_scores",
    "pass_metric_meta",
    "pass_attempts",
    "retry_count",
    "latency_ms",
    "item_metadata",
    "output_received",
)


def _scrub(value: Any) -> Any:
    """Timestamps differ on every run: pin them."""
    if isinstance(value, dict):
        return {
            key: (
                "<timestamp>"
                if (key == "at" or key.endswith("_at")) and isinstance(item, str)
                else _scrub(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_scrub(item) for item in value]
    return value


def trim_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [_scrub({key: row[key] for key in ROW_KEYS if key in row}) for row in rows]


def share_with_react(name: str, payload: dict[str, Any]) -> None:
    """Assert ``payload`` equals the golden file the Vitest suites read (or rewrite it)."""
    text = json.dumps(payload, indent=1, sort_keys=True, default=str) + "\n"
    path = GOLDEN_DIR / f"{name}.json"
    if os.environ.get("QYM_UPDATE_GOLDEN") == "1":
        GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return
    assert path.exists(), f"{path} is missing: run with QYM_UPDATE_GOLDEN=1"
    stored = path.read_text(encoding="utf-8")
    assert stored == text or _same_up_to_float_noise(
        json.loads(stored), json.loads(text)
    ), (
        f"{path.name} no longer matches the server payload: "
        "regenerate it with QYM_UPDATE_GOLDEN=1 and re-run the Vitest suites"
    )


def _same_up_to_float_noise(stored: Any, live: Any) -> bool:
    """Equal except for float rounding: Postgres sums a mean in row order, Python in
    its own, so the same payload reads 0.325 on one and 0.32499999999999996 on the
    other. The Vitest side compares with ``toBeCloseTo(…, 9)`` for the same reason."""
    if isinstance(stored, float) or isinstance(live, float):
        return (
            isinstance(stored, (int, float))
            and isinstance(live, (int, float))
            and math.isclose(stored, live, rel_tol=1e-9, abs_tol=1e-9)
        )
    if isinstance(stored, dict) and isinstance(live, dict):
        return stored.keys() == live.keys() and all(
            _same_up_to_float_noise(stored[k], live[k]) for k in stored
        )
    if isinstance(stored, list) and isinstance(live, list):
        return len(stored) == len(live) and all(
            _same_up_to_float_noise(a, b) for a, b in zip(stored, live)
        )
    return stored == live


def share_run_page(
    name: str,
    snapshot: dict[str, Any],
    expected: dict[str, Any],
    *,
    samples: int = 1,
) -> None:
    """Pin the rows the run page receives plus what the React run page must derive from them.

    ``expected`` keys (all optional), read by
    ``frontend/src/features/run-detail/lib/__tests__/cutover-server-payloads.test.ts``:

    - ``means``: metric -> run mean (``getRowScore`` with the declared direction)
    - ``card_means``: metric -> mean on the metric card (``metricCardModel``)
    - ``status_counts``: metric -> {pass, fail, error} item verdicts (``rowStatus``)
    - ``error_counts``: metric -> [task, scorer] pass/item errors (``rowMetricErrorCounts``)
    - ``error_rows``: item ids ``isErrorRow`` flags
    - ``clean_means``: metric -> {score, errors} (``scoreWithoutMetricErrors``)
    """
    share_with_react(
        f"payload_{name}",
        {
            "kind": "run_page",
            "samples": samples,
            "snapshot": {
                "metric_names": snapshot["metric_names"],
                "metric_specs": snapshot.get("metric_specs") or {},
                "rows": trim_rows(snapshot["rows"]),
            },
            "expected": expected,
        },
    )


from contextlib import contextmanager  # noqa: E402


@contextmanager
def runs_api_client(seed):
    """The real runs API over the source rows ``seed(db)`` adds (project slug ``demo``)."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from sqlalchemy.pool import StaticPool

    from qym_platform.api.runs import router
    from qym_platform.auth import Principal, require_ui_principal
    from qym_platform.db.models import Base, Project, User, UserRole
    from qym_platform.deps import get_db

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        user = User(
            id="u",
            email="owner@example.test",
            display_name="Owner",
            role=UserRole.ADMIN,
        )
        db.add(user)
        db.flush()
        db.add(Project(id="p", name="Project", slug="demo", created_by_user_id="u"))
        db.commit()
        seed(db)
        db.expunge(user)
    app = FastAPI()
    app.include_router(router)

    def session():
        with Session(engine, autoflush=False) as db:
            yield db

    app.dependency_overrides[get_db] = session
    app.dependency_overrides[require_ui_principal] = lambda: Principal(
        user=user, auth_type="local_password"
    )
    try:
        with TestClient(app) as client:
            yield client
    finally:
        engine.dispose()


def listed_means(client):
    """run id -> the runs list's metric averages."""
    listed = client.get("/api/runs", params={"project_slug": "demo"}).json()
    return {
        row["run_id"]: row["metric_averages"]
        for models in listed["tasks"].values()
        for rows in models.values()
        for row in rows
    }
