"""Shared world for the dataset access, item state and batch tests (WP-A).

One project ``pa`` with an admin, a project manager (``mgr``), three members
(``mem``, ``mem2``, ``mem3``) and an outsider in another project (``out``). Users
are named by ``X-User-Email`` (proxy-header auth). qym_platform is imported
inside the functions, as the other platform test helpers do.
"""

from __future__ import annotations

import io
from contextlib import contextmanager
from typing import Any, Dict, Iterable, Optional


def as_user(email: str) -> Dict[str, str]:
    return {"X-User-Email": email, "Origin": "http://localhost:8000"}


ADMIN = as_user("admin@x.com")
MGR = as_user("mgr@x.com")
MEM = as_user("mem@x.com")
MEM2 = as_user("mem2@x.com")
MEM3 = as_user("mem3@x.com")
OUT = as_user("out@x.com")

USER_IDS = {
    "admin": "admin",
    "mgr": "mgr",
    "mem": "mem",
    "mem2": "mem2",
    "mem3": "mem3",
    "out": "out",
}


@contextmanager
def dataset_world(monkeypatch):
    """Yield ``(client, session_factory, engine)`` over an in-memory SQLite database."""
    from fastapi.testclient import TestClient
    from qym_platform.app import create_app
    from qym_platform.auth import clear_api_key_cache
    from qym_platform.db.base import Base
    from qym_platform.db.models import (Project, ProjectMembership,
                                        ProjectRole, User, UserRole)
    from qym_platform.deps import get_db
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    monkeypatch.setenv("QYM_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    monkeypatch.setenv("QYM_AUTH_LOCAL_ENABLED", "false")
    monkeypatch.setenv("QYM_MAINTENANCE_MODE", "false")
    clear_api_key_cache()
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as db:
        db.add_all(
            [
                User(
                    id="admin",
                    email="admin@x.com",
                    display_name="Ada Admin",
                    role=UserRole.ADMIN,
                ),
                User(
                    id="mgr",
                    email="mgr@x.com",
                    display_name="Mona Manager",
                    role=UserRole.MEMBER,
                ),
                User(
                    id="mem",
                    email="mem@x.com",
                    display_name="Sami Member",
                    role=UserRole.MEMBER,
                ),
                User(
                    id="mem2",
                    email="mem2@x.com",
                    display_name="Lina Member",
                    role=UserRole.MEMBER,
                ),
                User(
                    id="mem3",
                    email="mem3@x.com",
                    display_name="Omar Member",
                    role=UserRole.MEMBER,
                ),
                User(
                    id="out",
                    email="out@x.com",
                    display_name="Olga Outsider",
                    role=UserRole.MEMBER,
                ),
                Project(
                    id="pa",
                    name="Project A",
                    slug="pa",
                    created_by_user_id="admin",
                    is_active=True,
                ),
                Project(
                    id="pb",
                    name="Project B",
                    slug="pb",
                    created_by_user_id="admin",
                    is_active=True,
                ),
            ]
        )
        db.flush()
        db.add_all(
            [
                ProjectMembership(
                    project_id="pa", user_id="mgr", role=ProjectRole.MANAGER
                ),
                ProjectMembership(
                    project_id="pa", user_id="mem", role=ProjectRole.MEMBER
                ),
                ProjectMembership(
                    project_id="pa", user_id="mem2", role=ProjectRole.MEMBER
                ),
                ProjectMembership(
                    project_id="pa", user_id="mem3", role=ProjectRole.MEMBER
                ),
                ProjectMembership(
                    project_id="pb", user_id="out", role=ProjectRole.MEMBER
                ),
            ]
        )
        db.commit()
    app = create_app()

    def override_get_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield client, factory, engine
    finally:
        app.dependency_overrides.clear()
        clear_api_key_cache()
        engine.dispose()


def upload(client, headers, name: str, rows: Iterable[tuple], **fields: Any):
    """Upload a CSV dataset. Rows are ``(id, input, expected, topic)`` or with a fifth ``extra`` JSON cell."""
    rows = list(rows)
    wide = any(len(row) > 4 for row in rows)
    head = "id,input,expected_output,topic" + (",meta" if wide else "")
    lines = [head]
    for row in rows:
        cells = [str(cell) for cell in row]
        lines.append(",".join(_csv_cell(cell) for cell in cells))
    data = {
        "name": name,
        "project_slug": "pa",
        "id_col": "id",
        "metadata_cols": "topic" + (",meta" if wide else ""),
    }
    data.update(fields)
    return client.post(
        "/v1/datasets:upload",
        headers=headers,
        data=data,
        files={
            "file": (
                "data.csv",
                io.BytesIO(("\n".join(lines) + "\n").encode("utf-8")),
                "text/csv",
            )
        },
    )


def _csv_cell(cell: str) -> str:
    if any(ch in cell for ch in ',"\n'):
        return '"' + cell.replace('"', '""') + '"'
    return cell


def seed_items(
    factory, version_id: str, metadatas: Iterable[Optional[dict]], prefix: str = "i"
) -> None:
    """Insert items straight into a version with the given metadata objects."""
    from qym_platform.db.models import DatasetItem, DatasetVersion

    with factory() as db:
        for index, metadata in enumerate(metadatas):
            db.add(
                DatasetItem(
                    dataset_version_id=version_id,
                    item_id=f"{prefix}{index}",
                    index=index,
                    input=f"question {index}",
                    expected_output=f"answer {index}",
                    item_metadata=metadata or {},
                    labels=[],
                    fingerprint=f"fp-{prefix}{index}",
                )
            )
        version = db.get(DatasetVersion, version_id)
        db.flush()
        version.item_count = (
            db.query(DatasetItem)
            .filter(DatasetItem.dataset_version_id == version_id)
            .count()
        )
        db.commit()


def new_dataset(client, headers, name: str = "qa", **fields: Any) -> Dict[str, Any]:
    body = {"name": name, "project_slug": "pa"}
    body.update(fields)
    response = client.post("/v1/datasets", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return response.json()["dataset"]


def new_version(
    client, headers, dataset: str, version: str = "v1", **fields: Any
) -> Dict[str, Any]:
    response = client.post(
        f"/v1/datasets/{dataset}/versions",
        params={"project_slug": "pa"},
        headers=headers,
        json={"version": version, **fields},
    )
    assert response.status_code == 200, response.text
    return response.json()["version"]
