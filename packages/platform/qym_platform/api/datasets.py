from __future__ import annotations

import codecs
import csv
import io
import json
import re
import unicodedata
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, Iterable, Optional
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from qym_platform.auth import Principal, require_api_key_scope, require_ui_principal, resolve_api_key_principal
from qym_platform.datetime_utils import to_api_timestamp, utc_now_naive
from qym_platform.db.models import (
    AuditLog,
    Dataset,
    DatasetAlias,
    DatasetItem,
    DatasetItemRevision,
    DatasetVersion,
    DatasetVersionChange,
    DatasetVersionStatus,
    Project,
    Run,
    RunItem,
    RunItemScore,
    User,
)
from qym_platform.deps import get_db
from qym_platform.item_identity import build_identity_fingerprint
from qym_platform.permissions import (
    has_project_access,
    is_project_manager,
    project_for_read_by_slug,
    require_project_writable,
)
from qym_platform.services.dataset_search import filter_dataset_item_search
from qym_platform.services.dataset_versions import (
    change_counts_for,
    store_change_counts,
)


router = APIRouter()


_MAX_SLUG_LENGTH = 120


def _slugify(value: str) -> str:
    """Build a URL slug that keeps letters and digits from every script.

    Arabic (or any non-Latin) names keep their letters, so different names get
    different slugs. A name with no letters or digits gets a unique fallback
    instead of a shared constant, so it can never collide with another dataset.
    """
    text = unicodedata.normalize("NFKC", value or "").strip().lower()
    chars: list[str] = []
    for ch in text:
        category = unicodedata.category(ch)
        if category[0] in ("L", "N"):
            chars.append(ch)
        elif category[0] == "M" and chars and chars[-1] != "-":
            # Combining marks (Arabic harakat, Indic vowel signs) stay with their letter.
            chars.append(ch)
        elif chars and chars[-1] != "-":
            chars.append("-")
    slug = "".join(chars)[:_MAX_SLUG_LENGTH].strip("-")
    return slug or f"dataset-{uuid4().hex[:8]}"


def _labels(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    if isinstance(value, list):
        return [str(part).strip() for part in value if str(part).strip()]
    return []


def _json_safe(value: Any) -> Any:
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return None
        return value
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    return value


def _same_json(a: Any, b: Any) -> bool:
    """Type-strict JSON equality (``1``, ``1.0``, ``True`` and ``"1"`` all differ)."""
    return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


def _principal_from_bearer(db: Session, authorization: Optional[str]) -> Optional[Principal]:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    if not token:
        return None
    # Same checks as every other key-authenticated route: revocation, active
    # owner, the owner's current membership and an active project.
    return resolve_api_key_principal(db, token)


def dataset_principal(
    request: Request,
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_user_email: Optional[str] = Header(default=None, alias="X-User-Email"),
    x_email: Optional[str] = Header(default=None, alias="X-Email"),
    x_admin_bootstrap: Optional[str] = Header(default=None, alias="X-Admin-Bootstrap"),
) -> Principal:
    api_principal = _principal_from_bearer(db, authorization)
    if api_principal:
        return api_principal
    return require_ui_principal(
        request=request,
        db=db,
        x_user_email=x_user_email,
        x_email=x_email,
        x_admin_bootstrap=x_admin_bootstrap,
    )


def _require_scope(principal: Principal, scope: str) -> None:
    if principal.auth_type == "api_key":
        require_api_key_scope(principal, scope)


def _project_for_request(
    db: Session, principal: Principal, project_slug: Optional[str], *, write: bool = False
) -> Project:
    """The project a dataset request acts on.

    API keys of an archived project are refused before this (409). A UI user
    who names an archived project by slug reads its datasets like on the run
    routes (members and admins only); every write (``write=True``) answers
    409 "Project is archived" until an admin unarchives the project.
    """
    active = db.query(Project).filter(Project.is_active.is_(True))
    if principal.project_id:
        project = active.filter(Project.id == principal.project_id).first()
        if not project:
            raise HTTPException(status_code=403, detail="API key project not found")
        return project
    if project_slug:
        project = project_for_read_by_slug(db, principal, project_slug)
        if write:
            require_project_writable(db, project.id)
        return project
    project = active.order_by(Project.name).first()
    if not project:
        raise HTTPException(status_code=404, detail="No project found")
    if not has_project_access(db, principal, project.id):
        raise HTTPException(status_code=403, detail="Access denied")
    return project


def _get_dataset(db: Session, project: Project, ref: str) -> Dataset:
    dataset = (
        db.query(Dataset)
        .filter(
            Dataset.project_id == project.id,
            Dataset.deleted_at.is_(None),
            (Dataset.id == ref) | (Dataset.slug == ref) | (Dataset.name == ref),
        )
        .first()
    )
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


def _free_slug_from_deleted(db: Session, project: Project, slug: str) -> None:
    """Release a slug held by soft-deleted datasets so it can be reused.

    Deleting a dataset is a soft delete (``deleted_at`` is set, the row stays), but the
    ``uq_dataset_project_slug`` unique index covers deleted rows too. Without this, once a
    dataset is deleted its name can never be reused. We rename any soft-deleted collider's
    slug to a tombstone, freeing the original slug while preserving the old row's data.
    """
    stale = (
        db.query(Dataset)
        .filter(
            Dataset.project_id == project.id,
            Dataset.slug == slug,
            Dataset.deleted_at.isnot(None),
        )
        .all()
    )
    for ds in stale:
        ds.slug = f"{slug}__deleted_{uuid4().hex[:8]}"
    if stale:
        db.flush()


def _live_dataset_with_slug(db: Session, project: Project, slug: str) -> Optional[Dataset]:
    return (
        db.query(Dataset)
        .filter(Dataset.project_id == project.id, Dataset.slug == slug, Dataset.deleted_at.is_(None))
        .first()
    )


def _slug_conflict_detail(db: Session, project: Project, slug: str) -> str:
    existing = _live_dataset_with_slug(db, project, slug)
    owner = f" by dataset '{existing.name}'" if existing else ""
    return f"Dataset slug already exists in this project: '{slug}' is used{owner}. Choose another name or slug."


def _same_dataset_name(a: str, b: str) -> bool:
    return (a or "").strip().casefold() == (b or "").strip().casefold()


def _live_dataset_with_name(db: Session, project: Project, name: str) -> Optional[Dataset]:
    """Oldest live dataset with this display name: an exact match, else ignoring case."""
    live = (Dataset.project_id == project.id, Dataset.deleted_at.is_(None))
    exact = db.query(Dataset).filter(*live, Dataset.name == name).order_by(Dataset.created_at).first()
    if exact:
        return exact
    # Case-insensitive in Python: SQLite's lower() only folds ASCII. A project holds few
    # datasets, and only ids and names are loaded.
    rows = db.query(Dataset.id, Dataset.name).filter(*live).order_by(Dataset.created_at).all()
    match = next((row.id for row in rows if _same_dataset_name(row.name, name)), None)
    return db.get(Dataset, match) if match else None


def _dataset_for_upload(db: Session, project: Project, name: str, slug: str) -> Optional[Dataset]:
    """Find the dataset an upload by ``name`` appends to (SDK/CI re-uploads).

    Only the same display name (ignoring case), or the dataset's exact slug, counts as
    the same dataset. A different name that merely produces the same slug is a conflict:
    uploads never merge into an unrelated dataset.
    """
    clean = (name or "").strip()
    by_slug = _live_dataset_with_slug(db, project, slug)
    if by_slug and (_same_dataset_name(by_slug.name, clean) or clean == by_slug.slug):
        return by_slug
    by_name = _live_dataset_with_name(db, project, clean)
    if by_name:
        # e.g. an older dataset whose slug was derived with earlier slug rules.
        return by_name
    if by_slug:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Dataset slug '{slug}' is already used by dataset '{by_slug.name}'. "
                "Use a different name, or upload to that dataset explicitly as a new version."
            ),
        )
    return None


def _resolve_version(db: Session, dataset: Dataset, ref: Optional[str]) -> DatasetVersion:
    clean = (ref or "production").strip() or "production"
    version = (
        db.query(DatasetVersion)
        .filter(DatasetVersion.dataset_id == dataset.id, DatasetVersion.version == clean)
        .first()
    )
    if version:
        return version
    alias = (
        db.query(DatasetAlias)
        .filter(DatasetAlias.dataset_id == dataset.id, DatasetAlias.alias == clean)
        .first()
    )
    if alias:
        version = db.query(DatasetVersion).filter(DatasetVersion.id == alias.dataset_version_id).first()
        if version:
            return version
    if clean == "production":
        version = (
            db.query(DatasetVersion)
            .filter(DatasetVersion.dataset_id == dataset.id, DatasetVersion.status == DatasetVersionStatus.PUBLISHED)
            .order_by(DatasetVersion.published_at.desc().nullslast(), DatasetVersion.created_at.desc())
            .first()
        )
        if version:
            return version
    raise HTTPException(status_code=404, detail=f"Dataset version or alias not found: {clean}")


def _require_draft(version: DatasetVersion) -> None:
    status = version.status.value if hasattr(version.status, "value") else str(version.status)
    if status != DatasetVersionStatus.DRAFT.value:
        raise HTTPException(status_code=409, detail="Only draft dataset versions can be edited")


def _user_payload(user: Optional[User]) -> Optional[Dict[str, Any]]:
    if not user:
        return None
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name or user.email.split("@")[0],
    }


def _user_map(db: Session, user_ids: Iterable[Optional[str]]) -> Dict[str, User]:
    ids = {str(user_id) for user_id in user_ids if user_id}
    if not ids:
        return {}
    return {user.id: user for user in db.query(User).filter(User.id.in_(ids)).all()}


def _item_payload(
    item: DatasetItem,
    *,
    run_count: Optional[int] = None,
    result_summary: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload = {
        "id": item.id,
        "item_id": item.item_id,
        "index": item.index,
        "input": item.input,
        "expected_output": item.expected_output,
        "metadata": item.item_metadata or {},
        "labels": item.labels or [],
        "fingerprint": item.fingerprint,
        "created_at": to_api_timestamp(item.created_at),
        "updated_at": to_api_timestamp(item.updated_at),
    }
    if run_count is not None:
        payload["run_count"] = int(run_count)
    if result_summary is not None:
        payload["result_summary"] = result_summary
    return payload


def _version_payloads(
    db: Session, versions: Iterable[DatasetVersion], *, include_aliases: bool = True
) -> Dict[str, Dict[str, Any]]:
    """Payloads for many versions with a fixed number of queries (no per-version N+1)."""
    versions = [version for version in versions if version is not None]
    ids = [version.id for version in versions]
    if not ids:
        return {}
    aliases: Dict[str, list[str]] = defaultdict(list)
    if include_aliases:
        for version_id, alias in (
            db.query(DatasetAlias.dataset_version_id, DatasetAlias.alias)
            .filter(DatasetAlias.dataset_version_id.in_(ids))
            .order_by(DatasetAlias.alias)
        ):
            aliases[version_id].append(alias)
    run_counts = dict(
        db.query(Run.dataset_version_id, func.count(Run.id))
        .filter(Run.dataset_version_id.in_(ids), Run.deleted_at.is_(None))
        .group_by(Run.dataset_version_id)
        .all()
    )
    users = _user_map(
        db, [v.created_by_user_id for v in versions] + [v.published_by_user_id for v in versions]
    )
    return {
        version.id: {
            "id": version.id,
            "dataset_id": version.dataset_id,
            "version": version.version,
            "name": version.name or "",
            "description": version.description,
            "status": version.status.value if hasattr(version.status, "value") else str(version.status),
            "source_type": version.source_type,
            "source_uri": version.source_uri,
            "parent_version_id": version.parent_version_id,
            "base_version_id": version.base_version_id,
            "schema": version.schema or {},
            "labels": version.labels or [],
            "item_count": version.item_count,
            "run_count": int(run_counts.get(version.id) or 0),
            "content_hash": version.content_hash,
            "created_by_user_id": version.created_by_user_id,
            "published_by_user_id": version.published_by_user_id,
            "created_by": _user_payload(users.get(version.created_by_user_id)),
            "published_by": _user_payload(users.get(version.published_by_user_id)),
            "created_at": to_api_timestamp(version.created_at),
            "updated_at": to_api_timestamp(version.updated_at),
            "published_at": to_api_timestamp(version.published_at),
            "is_default": bool(version.is_default),
            "aliases": list(aliases.get(version.id, [])),
        }
        for version in versions
    }


def _version_payload(db: Session, version: DatasetVersion, *, include_aliases: bool = True) -> Dict[str, Any]:
    return _version_payloads(db, [version], include_aliases=include_aliases)[version.id]


def _can_manage_datasets(db: Session, principal: Principal, project_id: str) -> bool:
    """Project managers and admins delete, rename, restore and move production."""
    return is_project_manager(db, principal, project_id)


def _dataset_permissions(db: Session, principal: Optional[Principal], dataset: Dataset, manager: Optional[bool] = None) -> Dict[str, Any]:
    if principal is None:
        return {}
    if manager is None:
        manager = _can_manage_datasets(db, principal, dataset.project_id)
    creator = bool(principal.user and dataset.created_by_user_id == principal.user.id)
    return {
        "can_manage": bool(manager),
        "is_creator": creator,
        "can_rename_slug": bool(manager),
        "can_move_production": bool(manager),
        "can_delete": bool(manager or creator),
        "can_restore": bool(manager),
    }


def _dataset_payloads(
    db: Session, datasets: Iterable[Dataset], principal: Optional[Principal] = None
) -> list[Dict[str, Any]]:
    """Catalog payloads with a fixed number of queries, whatever the dataset count."""
    datasets = list(datasets)
    if not datasets:
        return []
    ids = [dataset.id for dataset in datasets]
    production_ids = {
        dataset_id: version_id
        for dataset_id, version_id in db.query(DatasetAlias.dataset_id, DatasetAlias.dataset_version_id).filter(
            DatasetAlias.dataset_id.in_(ids), DatasetAlias.alias == "production"
        )
    }
    # Only the newest version per dataset (and the production one) is shown:
    # pick their ids in SQL instead of loading every version row.
    newest_rank = (
        func.row_number()
        .over(
            partition_by=DatasetVersion.dataset_id,
            order_by=(DatasetVersion.created_at.desc(), DatasetVersion.id.desc()),
        )
        .label("rank")
    )
    ranked = (
        db.query(DatasetVersion.id.label("id"), DatasetVersion.dataset_id.label("dataset_id"), newest_rank)
        .filter(DatasetVersion.dataset_id.in_(ids))
        .subquery()
    )
    latest_ids = {
        dataset_id: version_id
        for version_id, dataset_id in db.query(ranked.c.id, ranked.c.dataset_id).filter(ranked.c.rank == 1)
    }
    load_ids = set(latest_ids.values()) | {version_id for version_id in production_ids.values() if version_id}
    versions = (
        db.query(DatasetVersion)
        .filter(DatasetVersion.dataset_id.in_(ids), DatasetVersion.id.in_(sorted(load_ids)))
        .all()
        if load_ids
        else []
    )
    by_id = {version.id: version for version in versions}
    latest: Dict[str, DatasetVersion] = {
        dataset_id: by_id[version_id] for dataset_id, version_id in latest_ids.items() if version_id in by_id
    }
    wanted = {version_id for version_id in production_ids.values() if version_id in by_id}
    wanted.update(version.id for version in latest.values())
    version_payloads = _version_payloads(db, [by_id[version_id] for version_id in wanted], include_aliases=False)
    run_counts = dict(
        db.query(Run.dataset_id, func.count(Run.id))
        .filter(Run.dataset_id.in_(ids), Run.deleted_at.is_(None))
        .group_by(Run.dataset_id)
        .all()
    )
    users = _user_map(db, [dataset.created_by_user_id for dataset in datasets] + [dataset.deleted_by_user_id for dataset in datasets])
    manager = _can_manage_datasets(db, principal, datasets[0].project_id) if principal is not None else None
    payloads = []
    for dataset in datasets:
        production = version_payloads.get(production_ids.get(dataset.id) or "")
        newest = latest.get(dataset.id)
        payload = {
            "id": dataset.id,
            "project_id": dataset.project_id,
            "name": dataset.name,
            "slug": dataset.slug,
            "description": dataset.description,
            "tags": dataset.tags or [],
            "created_by_user_id": dataset.created_by_user_id,
            "created_by": _user_payload(users.get(dataset.created_by_user_id)),
            "created_at": to_api_timestamp(dataset.created_at),
            "updated_at": to_api_timestamp(dataset.updated_at),
            "production_version": production,
            "latest_version": version_payloads.get(newest.id) if newest else None,
            "run_count": int(run_counts.get(dataset.id) or 0),
        }
        if dataset.deleted_at is not None:
            payload["deleted_at"] = to_api_timestamp(dataset.deleted_at)
            payload["deleted_by"] = _user_payload(users.get(dataset.deleted_by_user_id))
            payload["original_slug"] = _original_slug(dataset.slug)
        if principal is not None:
            permissions = _dataset_permissions(db, principal, dataset, manager)
            # Mirrors _require_alias_permission: the creator sets the first production.
            permissions["can_set_production"] = bool(
                permissions["can_move_production"] or (permissions["is_creator"] and dataset.id not in production_ids)
            )
            payload["permissions"] = permissions
        payloads.append(payload)
    return payloads


def _dataset_payload(db: Session, dataset: Dataset, principal: Optional[Principal] = None) -> Dict[str, Any]:
    return _dataset_payloads(db, [dataset], principal)[0]


_DELETED_SLUG_MARK = "__deleted_"


def _original_slug(slug: str) -> str:
    """The slug a deleted dataset had before its slug was released for reuse."""
    text = slug or ""
    return text.split(_DELETED_SLUG_MARK, 1)[0] if _DELETED_SLUG_MARK in text else text


def _audit(
    db: Session,
    principal: Principal,
    action: str,
    dataset: Dataset,
    *,
    before: Optional[Dict[str, Any]] = None,
    after: Optional[Dict[str, Any]] = None,
) -> None:
    """Who changed what on a dataset: deletes, restores, slug renames, publishes, alias moves."""
    db.add(
        AuditLog(
            actor_user_id=principal.user.id if principal.user else None,
            action=action,
            entity_type="dataset",
            entity_id=dataset.id,
            before=dict(before or {}, project_id=dataset.project_id, dataset_slug=dataset.slug),
            after=dict(after or {}),
            created_at=utc_now_naive(),
        )
    )


def _record_change(
    db: Session, version: DatasetVersion, summary: Dict[str, Any], *, actor_user_id: Optional[str] = None
) -> None:
    if actor_user_id:
        summary = dict(summary, actor_user_id=actor_user_id)
    db.add(
        DatasetVersionChange(
            dataset_version_id=version.id,
            parent_version_id=version.parent_version_id,
            change_summary=summary,
            created_at=utc_now_naive(),
        )
    )


def _score_numeric_value(score: RunItemScore) -> Optional[float]:
    return _numeric_score(score.score_numeric, score.score_raw)


def _numeric_score(score_numeric: Optional[float], raw: Any) -> Optional[float]:
    if score_numeric is not None:
        return float(score_numeric)
    if isinstance(raw, (int, float, bool)):
        return float(raw)
    if isinstance(raw, str):
        try:
            return float(raw)
        except ValueError:
            return None
    if isinstance(raw, dict):
        for key in ("score", "value"):
            value = raw.get(key)
            if isinstance(value, (int, float, bool)):
                return float(value)
            if isinstance(value, str):
                try:
                    return float(value)
                except ValueError:
                    continue
    return None


def _is_generated_item_id(value: Any) -> bool:
    text = str(value or "").strip()
    if not text:
        return True
    if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", text, flags=re.I):
        return True
    if re.fullmatch(r"item-\d+", text, flags=re.I):
        return True
    if re.fullmatch(r"ds_[0-9a-f]{64}__\d{4}", text, flags=re.I):
        return True
    return False


def _item_result_summaries(
    db: Session,
    version: DatasetVersion,
    items: list[Any],
) -> Dict[int, Dict[str, Any]]:
    """Run results per dataset item (``items`` need ``id`` and ``item_id`` only).

    Reads only the columns it aggregates (no run or item bodies), so a computed
    sort over a whole version stays light.
    """
    if not items:
        return {}
    by_pk = {item.id: item for item in items}
    by_item_id = {item.item_id: item for item in items}
    rows = (
        db.query(
            RunItem.run_id,
            RunItem.dataset_item_pk,
            RunItem.item_id,
            RunItem.error,
            RunItem.latency_ms,
        )
        .join(Run, RunItem.run_id == Run.id)
        .filter(
            Run.deleted_at.is_(None),
            Run.dataset_version_id == version.id,
            (
                RunItem.dataset_item_pk.in_(list(by_pk))
                | RunItem.item_id.in_(list(by_item_id))
            ),
        )
        .all()
    )
    summaries: Dict[int, Dict[str, Any]] = {
        item.id: {
            "run_count": 0,
            "success_count": 0,
            "error_count": 0,
            "avg_latency_ms": None,
            "avg_score": None,
            "metrics": {},
        }
        for item in items
    }
    run_item_keys_by_pk: Dict[int, set[tuple[str, str]]] = {item.id: set() for item in items}
    latencies_by_pk: Dict[int, list[float]] = {item.id: [] for item in items}
    for run_id, dataset_item_pk, run_item_id, error, latency_ms in rows:
        item = by_pk.get(dataset_item_pk) if dataset_item_pk is not None else None
        if item is None:
            item = by_item_id.get(run_item_id)
        if item is None:
            continue
        summary = summaries[item.id]
        summary["run_count"] += 1
        if error:
            summary["error_count"] += 1
        else:
            summary["success_count"] += 1
        if latency_ms is not None:
            latencies_by_pk[item.id].append(float(latency_ms))
        run_item_keys_by_pk[item.id].add((run_id, run_item_id))

    all_run_ids = {run_id for keys in run_item_keys_by_pk.values() for run_id, _ in keys}
    all_item_ids = {item_id for keys in run_item_keys_by_pk.values() for _, item_id in keys}
    scores_by_key: Dict[tuple[str, str], list[tuple[str, Optional[float]]]] = defaultdict(list)
    if all_run_ids and all_item_ids:
        for run_id, score_item_id, metric_name, score_numeric, score_raw in (
            db.query(
                RunItemScore.run_id,
                RunItemScore.item_id,
                RunItemScore.metric_name,
                RunItemScore.score_numeric,
                RunItemScore.score_raw,
            )
            .filter(RunItemScore.run_id.in_(all_run_ids), RunItemScore.item_id.in_(all_item_ids))
        ):
            scores_by_key[(run_id, score_item_id)].append(
                (metric_name, _numeric_score(score_numeric, score_raw))
            )

    for item in items:
        numeric_scores: list[float] = []
        metrics: Dict[str, Dict[str, Any]] = {}
        for key in run_item_keys_by_pk[item.id]:
            for metric_name, value in scores_by_key.get(key, []):
                if value is None:
                    continue
                numeric_scores.append(value)
                metric = metrics.setdefault(
                    metric_name,
                    {"count": 0, "avg": None, "min": None, "max": None, "_sum": 0.0},
                )
                metric["count"] += 1
                metric["_sum"] += value
                metric["min"] = value if metric["min"] is None else min(float(metric["min"]), value)
                metric["max"] = value if metric["max"] is None else max(float(metric["max"]), value)
        for metric in metrics.values():
            metric["avg"] = round(float(metric["_sum"]) / int(metric["count"]), 4) if metric["count"] else None
            metric.pop("_sum", None)
        latencies = latencies_by_pk[item.id]
        summary = summaries[item.id]
        summary["avg_latency_ms"] = round(sum(latencies) / len(latencies), 2) if latencies else None
        summary["avg_score"] = round(sum(numeric_scores) / len(numeric_scores), 4) if numeric_scores else None
        summary["metrics"] = metrics
    return summaries


def _version_metric_names(db: Session, version: DatasetVersion) -> list[str]:
    names: set[str] = set()
    score_rows = (
        db.query(RunItemScore.metric_name)
        .join(Run, Run.id == RunItemScore.run_id)
        .filter(
            Run.deleted_at.is_(None),
            Run.dataset_version_id == version.id,
        )
        .distinct()
        .order_by(RunItemScore.metric_name)
        .all()
    )
    names.update(str(metric_name) for (metric_name,) in score_rows if metric_name)
    run_rows = (
        db.query(Run.metrics)
        .filter(Run.deleted_at.is_(None), Run.dataset_version_id == version.id)
        .all()
    )
    for (metrics,) in run_rows:
        if isinstance(metrics, list):
            names.update(str(metric) for metric in metrics if metric)
    return sorted(names)


def _item_edit_counts(db: Session, version: DatasetVersion, items: list[DatasetItem]) -> Dict[int, int]:
    if not items:
        return {}
    versions_by_id = {
        row.id: row
        for row in db.query(DatasetVersion).filter(DatasetVersion.dataset_id == version.dataset_id).all()
    }
    chain_ids: list[str] = []
    seen: set[str] = set()
    cursor: Optional[DatasetVersion] = version
    while cursor and cursor.id not in seen:
        seen.add(cursor.id)
        chain_ids.append(cursor.id)
        cursor = versions_by_id.get(cursor.parent_version_id) if cursor.parent_version_id else None

    # Each revision counts for the first item (in ``items`` order) it matches by
    # row id, by item ID, or by index for generated IDs; lookups are by key so a
    # whole-version sort is linear in revisions, not revisions x items.
    counts = {item.id: 0 for item in items}
    position = {item.id: n for n, item in enumerate(items)}
    by_item_id: Dict[str, int] = {}
    by_index: Dict[Any, int] = {}
    for item in items:
        by_item_id.setdefault(item.item_id, item.id)
        if _is_generated_item_id(item.item_id):
            by_index.setdefault(item.index, item.id)
    revisions = (
        db.query(
            DatasetItemRevision.dataset_item_id,
            DatasetItemRevision.before,
            DatasetItemRevision.after,
        )
        .filter(
            DatasetItemRevision.dataset_version_id.in_(chain_ids),
            DatasetItemRevision.change_type == "updated",
        )
        .all()
    )
    for dataset_item_id, before, after in revisions:
        before = before or {}
        after = after or {}
        candidates = [
            dataset_item_id if dataset_item_id in counts else None,
            by_item_id.get(str(before.get("item_id") or "")),
            by_item_id.get(str(after.get("item_id") or "")),
            by_index.get(before.get("index")) if before.get("index") is not None else None,
            by_index.get(after.get("index")) if after.get("index") is not None else None,
        ]
        matched = [pk for pk in candidates if pk is not None]
        if matched:
            counts[min(matched, key=position.__getitem__)] += 1
    return counts


def _record_item_revision(
    db: Session,
    version: DatasetVersion,
    item: Optional[DatasetItem],
    *,
    change_type: str,
    before: Optional[Dict[str, Any]],
    after: Optional[Dict[str, Any]],
    actor_user_id: str,
) -> None:
    count = (
        db.query(func.count(DatasetItemRevision.id))
        .filter(DatasetItemRevision.dataset_version_id == version.id)
        .scalar()
        or 0
    )
    db.add(
        DatasetItemRevision(
            dataset_item_id=item.id if item else None,
            dataset_version_id=version.id,
            revision_number=int(count) + 1,
            change_type=change_type,
            before=before or {},
            after=after or {},
            actor_user_id=actor_user_id,
            created_at=utc_now_naive(),
        )
    )


def _detach_item_revisions(db: Session, item: DatasetItem) -> None:
    db.query(DatasetItemRevision).filter(DatasetItemRevision.dataset_item_id == item.id).update(
        {DatasetItemRevision.dataset_item_id: None},
        synchronize_session=False,
    )


def _detach_item_run_results(db: Session, item: DatasetItem) -> None:
    db.query(RunItem).filter(RunItem.dataset_item_pk == item.id).update(
        {RunItem.dataset_item_pk: None},
        synchronize_session=False,
    )


def _content_hash(items: Iterable[DatasetItem]) -> str:
    import hashlib

    payload = [
        {
            "item_id": item.item_id,
            "input": item.input,
            "expected_output": item.expected_output,
            "metadata": item.item_metadata or {},
            "labels": item.labels or [],
            "fingerprint": item.fingerprint,
        }
        for item in sorted(items, key=lambda row: (row.index, row.item_id))
    ]
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _parse_cell(raw: Any) -> Any:
    if raw is None:
        return ""
    text = str(raw)
    stripped = text.lstrip()
    if stripped[:1] in {"{", "["}:
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            return text
    return text


def _combine_columns(row: Dict[str, Any], cols: list[str]) -> Any:
    """One column -> the raw (parsed) cell value; multiple columns -> a JSON object
    keyed by column name. Returns None when no columns are given."""
    if not cols:
        return None
    if len(cols) == 1:
        return _parse_cell(row.get(cols[0], ""))
    return {col: _parse_cell(row.get(col, "")) for col in cols}


# Encodings a caller may choose explicitly (labels match the browser's TextDecoder names).
_CSV_ENCODINGS = {
    "utf-8": "utf-8-sig",
    "utf-16": "utf-16",
    "utf-16le": "utf-16-le",
    "utf-16be": "utf-16-be",
    "utf-32": "utf-32",
    "windows-1256": "cp1256",
    "windows-1252": "cp1252",
    "iso-8859-6": "iso8859_6",
}
# Legacy single-byte encodings tried when a file is not UTF-8. The order breaks ties,
# so Latin text that decodes identically in both keeps the historic Windows-1252.
_LEGACY_CSV_ENCODINGS = ("windows-1252", "windows-1256", "iso-8859-6")
_ENCODING_SAMPLE_CHARS = 262144
_CSV_ENCODING_HELP = "Save the file as 'CSV UTF-8' (Excel: File > Save As > CSV UTF-8) and upload it again."
# Non-letter characters that are normal in real text in any of the legacy encodings.
_NEUTRAL_TEXT_CHARS = frozenset(
    "\u00a0\u00ab\u00bb\u201c\u201d\u2018\u2019\u201e\u2013\u2014\u2026\u2022\u20ac\u00a3\u00a5"
    "\u00b0\u00a9\u00ae\u2122\u00a7\u00b7\u00bf\u00a1\u060c\u061b\u061f\u066a\u066b\u066c"
)


def _is_arabic_char(ch: str) -> bool:
    cp = ord(ch)
    return 0x0600 <= cp <= 0x06FF or 0x0750 <= cp <= 0x077F or 0x08A0 <= cp <= 0x08FF or 0xFB50 <= cp <= 0xFDFF or 0xFE70 <= cp <= 0xFEFF


def _legacy_text_score(text: str) -> int:
    """Score how much a legacy-decoded text looks like real words.

    Mis-decoded Arabic (Windows-1256 read as Windows-1252) turns every word into a
    run of accented Latin letters, and Latin text read as Windows-1256 mixes Arabic
    letters into Latin words. Real text has words in one script, with accented
    letters in the minority for Latin words.
    """
    total = 0
    word: list[str] = []

    def flush() -> None:
        nonlocal total
        non_ascii = [ch for ch in word if ord(ch) > 0x7F]
        if non_ascii:
            arabic = any(_is_arabic_char(ch) for ch in word)
            latin = any(ord(ch) < 0x0250 for ch in word)
            other = any(ord(ch) >= 0x0250 and not _is_arabic_char(ch) for ch in word)
            if other or (arabic and latin):
                total -= 2 * len(non_ascii)
            elif arabic:
                total += len(word)
            elif 2 * len(non_ascii) <= len(word):
                total += len(non_ascii)
            else:
                total -= len(non_ascii)
        word.clear()

    for ch in text:
        category = unicodedata.category(ch)
        if category[0] in ("L", "M"):
            word.append(ch)
            continue
        flush()
        if ord(ch) > 0x7F and category[0] not in ("N", "Z") and ch not in _NEUTRAL_TEXT_CHARS:
            total -= 1
    flush()
    return total


def _decode_csv(raw: bytes, encoding: Optional[str] = None) -> tuple[str, str]:
    """Decode an uploaded CSV. Returns the text and the encoding label that was used.

    An explicit ``encoding`` (from the upload wizard's Encoding choice) is honored or
    rejected; otherwise BOMs and strict UTF-8 win, and a non-UTF-8 file is decoded with
    the legacy encoding whose result looks most like real text (Windows-1256 Arabic
    exports from Excel no longer turn into Windows-1252 mojibake).
    """
    if not raw:
        raise HTTPException(status_code=400, detail="CSV file is empty")
    requested = (encoding or "").strip().lower()
    if requested:
        codec = _CSV_ENCODINGS.get(requested)
        if not codec:
            raise HTTPException(status_code=400, detail=f"Unsupported CSV encoding: {encoding}")
        if codec.startswith("utf-16") and raw.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
            codec = "utf-16"
        try:
            return raw.decode(codec).lstrip("\uFEFF"), requested
        except UnicodeDecodeError as exc:
            label = requested.upper() if requested.startswith("utf") else requested
            raise HTTPException(
                status_code=400,
                detail=f"The file is not valid {label}. Choose the file's real encoding. {_CSV_ENCODING_HELP}",
            ) from exc
    if raw.startswith((codecs.BOM_UTF32_LE, codecs.BOM_UTF32_BE)):
        try:
            return raw.decode("utf-32"), "utf-32"
        except UnicodeDecodeError:
            pass
    elif raw.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        try:
            return raw.decode("utf-16"), "utf-16"
        except UnicodeDecodeError:
            pass
    else:
        try:
            return raw.decode("utf-8-sig"), "utf-8"
        except UnicodeDecodeError:
            pass
        best: Optional[tuple[int, str, str]] = None
        for label in _LEGACY_CSV_ENCODINGS:
            try:
                text = raw.decode(_CSV_ENCODINGS[label])
            except UnicodeDecodeError:
                continue
            score = _legacy_text_score(text[:_ENCODING_SAMPLE_CHARS])
            if best is None or score > best[0]:
                best = (score, label, text)
        if best is not None:
            return best[2], best[1]
    raise HTTPException(
        status_code=400,
        detail=f"Could not detect the CSV encoding. {_CSV_ENCODING_HELP}",
    )


def _csv_reader(raw: bytes, encoding: Optional[str] = None) -> tuple[csv.DictReader, str]:
    text, used_encoding = _decode_csv(raw, encoding)
    try:
        dialect = csv.Sniffer().sniff(text[:65536], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    return csv.DictReader(io.StringIO(text, newline=""), dialect=dialect), used_encoding


def _items_from_csv(
    raw: bytes,
    *,
    input_cols: list[str],
    expected_cols: list[str],
    id_col: Optional[str],
    metadata_cols: list[str],
    label_cols: list[str],
    encoding: Optional[str] = None,
) -> tuple[list[Dict[str, Any]], str]:
    """Parse CSV rows into items. Returns the items and the encoding that was used."""
    reader, used_encoding = _csv_reader(raw, encoding)
    raw_fields = list(reader.fieldnames or [])
    fields = [field.strip() if field is not None else "" for field in raw_fields]
    if not fields:
        raise HTTPException(status_code=400, detail="CSV has no header row")
    if any(not field for field in fields):
        raise HTTPException(status_code=400, detail="CSV contains an empty column header")
    duplicate_fields = sorted({field for field in fields if fields.count(field) > 1})
    if duplicate_fields:
        raise HTTPException(
            status_code=400,
            detail=f"CSV contains duplicate column headers: {', '.join(duplicate_fields)}",
        )
    reader.fieldnames = fields
    if not input_cols:
        raise HTTPException(status_code=400, detail="At least one input column is required")
    selected_cols = input_cols + expected_cols + metadata_cols + label_cols
    if id_col:
        selected_cols.append(id_col)
    for col in [c for c in selected_cols if c and c not in fields]:
        raise HTTPException(status_code=400, detail=f"Missing column: {col}")
    items: list[Dict[str, Any]] = []
    for row_number, row in enumerate(reader, start=2):
        extra_values = row.pop(None, None)
        if extra_values and any(str(value or "").strip() for value in extra_values):
            raise HTTPException(
                status_code=400,
                detail=f"CSV row {row_number} has more values than the header",
            )
        if not any(str(value or "").strip() for value in row.values()):
            continue
        metadata = {col: _parse_cell(row.get(col, "")) for col in metadata_cols}
        labels: list[str] = []
        for col in label_cols:
            labels.extend(_labels(row.get(col, "")))
        items.append(
            {
                "item_id": str(row.get(id_col, "")).strip() if id_col else "",
                "input": _combine_columns(row, input_cols),
                "expected_output": _combine_columns(row, expected_cols) if expected_cols else None,
                "metadata": metadata,
                "labels": sorted(set(labels)),
            }
        )
    return items, used_encoding


_MAX_REPORTED_LINE_ERRORS = 5


def _decode_json_text(raw: bytes, kind: str) -> str:
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"{kind} files must be UTF-8 encoded") from exc


def _json_record_problem(obj: Any) -> Optional[str]:
    if not isinstance(obj, dict):
        return "must be a JSON object"
    metadata = obj.get("metadata")
    if metadata is not None and not isinstance(metadata, dict):
        return "metadata must be a JSON object"
    return None


def _json_record_item(obj: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "item_id": str(obj.get("item_id") or obj.get("id") or "").strip(),
        "input": obj.get("input"),
        "expected_output": obj.get("expected_output", obj.get("expected")),
        "metadata": obj.get("metadata") or {},
        "labels": _labels(obj.get("labels")),
    }


def _items_from_jsonl(raw: bytes) -> list[Dict[str, Any]]:
    """Parse JSONL strictly: every non-blank line must be a JSON object.

    All invalid lines are reported together (line numbers and a count) so nothing
    is dropped silently and the user can fix the file in one pass.
    """
    items: list[Dict[str, Any]] = []
    problems: list[str] = []
    record_count = 0
    # Split on newlines only (like the browser import), so U+2028 inside a string is not a line break.
    for line_no, line in enumerate(_decode_json_text(raw, "JSONL").split("\n"), start=1):
        text = line.strip()
        if not text:
            continue
        record_count += 1
        try:
            obj = json.loads(text)
        except json.JSONDecodeError as exc:
            problems.append(f"line {line_no} is not valid JSON ({exc.msg})")
            continue
        problem = _json_record_problem(obj)
        if problem:
            problems.append(f"line {line_no} {problem}")
            continue
        items.append(_json_record_item(obj))
    if problems:
        shown = "; ".join(problems[:_MAX_REPORTED_LINE_ERRORS])
        more = len(problems) - _MAX_REPORTED_LINE_ERRORS
        suffix = f"; and {more} more" if more > 0 else ""
        raise HTTPException(
            status_code=400,
            detail=f"Invalid JSONL: {len(problems)} of {record_count} lines cannot be imported: {shown}{suffix}",
        )
    return items


def _items_from_json(raw: bytes) -> list[Dict[str, Any]]:
    """Parse a JSON document holding an array of item objects."""
    try:
        doc = json.loads(_decode_json_text(raw, "JSON"))
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}",
        ) from exc
    if not isinstance(doc, list):
        raise HTTPException(status_code=400, detail="A JSON file must contain an array of item objects")
    problems = []
    for index, obj in enumerate(doc, start=1):
        problem = _json_record_problem(obj)
        if problem:
            problems.append(f"item {index} {problem}")
    if problems:
        shown = "; ".join(problems[:_MAX_REPORTED_LINE_ERRORS])
        more = len(problems) - _MAX_REPORTED_LINE_ERRORS
        suffix = f"; and {more} more" if more > 0 else ""
        raise HTTPException(
            status_code=400,
            detail=f"Invalid JSON: {len(problems)} of {len(doc)} items cannot be imported: {shown}{suffix}",
        )
    return [_json_record_item(obj) for obj in doc]


def _upload_format(requested: str, filename: str, raw: bytes) -> str:
    """Pick the parser: an explicit ``format`` wins, then the file name.

    A ``.json`` file holding an array is JSON; one object per line is JSONL.
    """
    clean = (requested or "").strip().lower()
    if clean:
        if clean not in {"csv", "jsonl", "json"}:
            raise HTTPException(status_code=400, detail=f"Unsupported format: {requested} (use csv, jsonl, or json)")
        return clean
    lower = (filename or "").lower()
    if lower.endswith(".jsonl") or lower.endswith(".ndjson"):
        return "jsonl"
    if lower.endswith(".json"):
        head = raw.lstrip(b"\xef\xbb\xbf \t\r\n")[:1]
        return "json" if head == b"[" else "jsonl"
    return "csv"


def _insert_items(db: Session, version: DatasetVersion, items: list[Dict[str, Any]]) -> None:
    duplicate_counts: dict[str, int] = defaultdict(int)
    seen_ids: set[str] = set()
    for index, source in enumerate(items):
        input_value = _json_safe(source.get("input"))
        expected = _json_safe(source.get("expected_output"))
        metadata = _json_safe(source.get("metadata") or {})
        labels = _labels(source.get("labels"))
        fingerprint = build_identity_fingerprint(input_value=input_value, expected_value=expected, metadata=metadata)
        item_id = str(source.get("item_id") or "").strip()
        if not item_id:
            duplicate_counts[fingerprint] += 1
            item_id = f"ds_{fingerprint}__{duplicate_counts[fingerprint]:04d}"
        if item_id in seen_ids:
            raise HTTPException(status_code=409, detail=f"Duplicate item_id: {item_id}")
        seen_ids.add(item_id)
        db.add(
            DatasetItem(
                dataset_version_id=version.id,
                item_id=item_id,
                index=index,
                input=input_value,
                expected_output=expected,
                item_metadata=metadata,
                labels=labels,
                fingerprint=fingerprint,
                created_at=utc_now_naive(),
                updated_at=utc_now_naive(),
            )
        )
    version.item_count = len(items)


class CreateDatasetRequest(BaseModel):
    name: str
    slug: Optional[str] = None
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    project_slug: Optional[str] = None


class UpdateDatasetRequest(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None


class CreateVersionRequest(BaseModel):
    version: Optional[str] = None
    name: str = ""
    description: str = ""
    labels: list[str] = Field(default_factory=list)
    from_version: Optional[str] = None
    from_alias: Optional[str] = None


class UpdateVersionRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class PublishVersionRequest(BaseModel):
    set_alias: Optional[str] = None


class SetAliasRequest(BaseModel):
    version: str


class UpsertItemRequest(BaseModel):
    item_id: Optional[str] = None
    input: Any
    expected_output: Any = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    labels: list[str] = Field(default_factory=list)


class PatchItemRequest(BaseModel):
    """Partial item update: only the fields present in the body are changed."""

    item_id: Optional[str] = None
    input: Any = None
    expected_output: Any = None
    metadata: Optional[Dict[str, Any]] = None
    labels: Optional[list[str]] = None


class BulkUpsertEntry(BaseModel):
    item_id: Optional[str] = None
    op: Optional[str] = None
    input: Any = None
    expected_output: Any = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    labels: list[str] = Field(default_factory=list)


class BulkItemsRequest(BaseModel):
    upserts: list[BulkUpsertEntry] = Field(default_factory=list)
    deletes: list[str] = Field(default_factory=list)


@router.get("/v1/datasets")
def list_datasets(
    project_slug: Optional[str] = Query(default=None),
    deleted: bool = Query(default=False, description="List deleted datasets (newest deletion first) instead of live ones."),
    limit: Optional[int] = Query(default=None, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:read")
    project = _project_for_request(db, principal, project_slug)
    query = db.query(Dataset).filter(Dataset.project_id == project.id)
    if deleted:
        query = query.filter(Dataset.deleted_at.isnot(None)).order_by(Dataset.deleted_at.desc(), Dataset.id)
    else:
        query = query.filter(Dataset.deleted_at.is_(None)).order_by(Dataset.name, Dataset.id)
    total = query.count()
    if offset:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
    datasets = query.all()
    return {
        "project": {"id": project.id, "slug": project.slug, "name": project.name},
        "datasets": _dataset_payloads(db, datasets, principal),
        "total": total,
        "permissions": {"can_manage": _can_manage_datasets(db, principal, project.id)},
    }


@router.post("/v1/datasets")
def create_dataset(
    req: CreateDatasetRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:write")
    project = _project_for_request(db, principal, req.project_slug, write=True)
    slug = _slugify(req.slug or req.name)
    _free_slug_from_deleted(db, project, slug)
    dataset = Dataset(
        id=str(uuid4()),
        project_id=project.id,
        name=req.name.strip(),
        slug=slug,
        description=req.description,
        tags=_labels(req.tags),
        created_by_user_id=principal.user.id,
        created_at=utc_now_naive(),
        updated_at=utc_now_naive(),
    )
    db.add(dataset)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=_slug_conflict_detail(db, project, slug)) from exc
    return {"dataset": _dataset_payload(db, dataset, principal)}


@router.get("/v1/datasets/{dataset_ref}")
def get_dataset(
    dataset_ref: str,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:read")
    project = _project_for_request(db, principal, project_slug)
    dataset = _get_dataset(db, project, dataset_ref)
    return {"dataset": _dataset_payload(db, dataset, principal)}


MANAGER_ONLY_SLUG = "Only project managers can change a dataset's slug: SDK and CI references use it."
MANAGER_ONLY_PRODUCTION = "Only project managers can move a dataset's production alias."
DELETE_RULE = "Only the dataset's creator or a project manager can delete a dataset."
MANAGER_ONLY_RESTORE = "Only project managers can restore a deleted dataset."


@router.patch("/v1/datasets/{dataset_ref}")
def update_dataset(
    dataset_ref: str,
    req: UpdateDatasetRequest,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:write")
    project = _project_for_request(db, principal, project_slug, write=True)
    dataset = _get_dataset(db, project, dataset_ref)
    if req.name is not None:
        dataset.name = req.name.strip()
    next_slug = None
    previous_slug = dataset.slug
    if req.slug is not None:
        next_slug = _slugify(req.slug)
        if next_slug != dataset.slug:
            # Renaming the slug breaks every SDK/CI reference to the old one.
            if not _can_manage_datasets(db, principal, project.id):
                raise HTTPException(status_code=403, detail=MANAGER_ONLY_SLUG)
            _free_slug_from_deleted(db, project, next_slug)
            _audit(db, principal, "dataset.slug_renamed", dataset, before={"slug": previous_slug}, after={"slug": next_slug})
        dataset.slug = next_slug
    if req.description is not None:
        dataset.description = req.description
    if req.tags is not None:
        dataset.tags = _labels(req.tags)
    dataset.updated_at = utc_now_naive()
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=_slug_conflict_detail(db, project, next_slug or "")) from exc
    return {"dataset": _dataset_payload(db, dataset, principal)}


@router.delete("/v1/datasets/{dataset_ref}")
def delete_dataset(
    dataset_ref: str,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    """Soft-delete a dataset: it moves to Deleted datasets, where a manager can restore it."""
    _require_scope(principal, "datasets:delete")
    project = _project_for_request(db, principal, project_slug, write=True)
    dataset = _get_dataset(db, project, dataset_ref)
    if not _dataset_permissions(db, principal, dataset).get("can_delete"):
        raise HTTPException(status_code=403, detail=DELETE_RULE)
    dataset.deleted_at = utc_now_naive()
    dataset.deleted_by_user_id = principal.user.id if principal.user else None
    _audit(
        db,
        principal,
        "dataset.deleted",
        dataset,
        before={"name": dataset.name, "slug": dataset.slug},
        after={"deleted_at": to_api_timestamp(dataset.deleted_at)},
    )
    db.commit()
    return {"ok": True, "restorable": True}


@router.post("/v1/datasets/{dataset_id}:restore")
def restore_dataset(
    dataset_id: str,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    """Bring a deleted dataset back with its versions, items and history.

    Its original slug is restored; if a live dataset took that slug (or name)
    meanwhile, the restore is refused with 409 so nothing is merged or renamed
    silently.
    """
    _require_scope(principal, "datasets:delete")
    project = _project_for_request(db, principal, project_slug, write=True)
    if not _can_manage_datasets(db, principal, project.id):
        raise HTTPException(status_code=403, detail=MANAGER_ONLY_RESTORE)
    dataset = (
        db.query(Dataset)
        .filter(Dataset.project_id == project.id, Dataset.id == dataset_id, Dataset.deleted_at.isnot(None))
        .first()
    )
    if not dataset:
        raise HTTPException(status_code=404, detail="Deleted dataset not found")
    slug = _original_slug(dataset.slug)
    taken = _live_dataset_with_slug(db, project, slug)
    if taken:
        raise HTTPException(
            status_code=409,
            detail=f"Dataset '{taken.name}' now uses the slug '{slug}'. Rename or delete it, then restore this dataset.",
        )
    same_name = _live_dataset_with_name(db, project, dataset.name)
    if same_name:
        raise HTTPException(
            status_code=409,
            detail=f"A dataset named '{same_name.name}' exists. Rename it, then restore this dataset.",
        )
    deleted_at = dataset.deleted_at
    if dataset.slug != slug:
        # Another deleted dataset may still hold the slug; tombstone it instead.
        _free_slug_from_deleted(db, project, slug)
    dataset.slug = slug
    dataset.deleted_at = None
    dataset.deleted_by_user_id = None
    dataset.updated_at = utc_now_naive()
    _audit(
        db,
        principal,
        "dataset.restored",
        dataset,
        before={"deleted_at": to_api_timestamp(deleted_at)},
        after={"slug": slug},
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=_slug_conflict_detail(db, project, slug)) from exc
    return {"dataset": _dataset_payload(db, dataset, principal)}


@router.get("/v1/datasets/{dataset_ref}/versions")
def list_versions(
    dataset_ref: str,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:read")
    project = _project_for_request(db, principal, project_slug)
    dataset = _get_dataset(db, project, dataset_ref)
    versions = (
        db.query(DatasetVersion)
        .filter(DatasetVersion.dataset_id == dataset.id)
        .order_by(DatasetVersion.created_at.desc())
        .all()
    )
    payloads = _version_payloads(db, versions)
    return {"dataset": _dataset_payload(db, dataset, principal), "versions": [payloads[version.id] for version in versions]}


@router.get("/v1/datasets/{dataset_ref}/runs")
def list_dataset_runs(
    dataset_ref: str,
    project_slug: Optional[str] = Query(default=None),
    version: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:read")
    project = _project_for_request(db, principal, project_slug)
    dataset = _get_dataset(db, project, dataset_ref)

    query = db.query(Run).filter(Run.deleted_at.is_(None), Run.dataset_id == dataset.id)
    if version:
        target = _resolve_version(db, dataset, version)
        query = query.filter(Run.dataset_version_id == target.id)

    total = query.count()
    runs = (
        query.order_by(Run.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )

    # Map version ids -> labels for the runs on this page.
    version_labels = {
        v.id: v.version
        for v in db.query(DatasetVersion).filter(DatasetVersion.dataset_id == dataset.id).all()
    }
    run_ids = [run.id for run in runs]
    items_counts: Dict[str, int] = {}
    avg_latencies: Dict[str, float] = {}
    metric_values_by_run: Dict[str, Dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    eval_values_by_run: Dict[str, list[float]] = defaultdict(list)
    if run_ids:
        items_counts = dict(
            db.query(RunItem.run_id, func.count(RunItem.id))
            .filter(RunItem.run_id.in_(run_ids))
            .group_by(RunItem.run_id)
            .all()
        )
        avg_latencies = {
            run_id: round(float(avg_latency), 2)
            for run_id, avg_latency in (
                db.query(RunItem.run_id, func.avg(RunItem.latency_ms))
                .filter(RunItem.run_id.in_(run_ids), RunItem.latency_ms.isnot(None))
                .group_by(RunItem.run_id)
                .all()
            )
            if avg_latency is not None
        }
        score_rows = (
            db.query(RunItemScore)
            .filter(RunItemScore.run_id.in_(run_ids))
            .all()
        )
        for score in score_rows:
            value = _score_numeric_value(score)
            if value is None:
                continue
            metric_values_by_run[score.run_id][score.metric_name].append(value)
            eval_values_by_run[score.run_id].append(value)

    metric_names = sorted({metric for metrics in metric_values_by_run.values() for metric in metrics})

    def run_metric_averages(run_id: str) -> Dict[str, Optional[float]]:
        metrics = metric_values_by_run.get(run_id, {})
        return {
            metric: round(sum(values) / len(values), 4) if values else None
            for metric, values in sorted(metrics.items())
        }

    def run_eval_score(run_id: str) -> Optional[float]:
        values = eval_values_by_run.get(run_id) or []
        return round(sum(values) / len(values), 4) if values else None

    return {
        "runs": [
            {
                "id": run.id,
                "run_name": (
                    str((run.run_config or {}).get("run_name") or "")
                    if isinstance(run.run_config, dict)
                    else ""
                )
                or run.external_run_id
                or run.id,
                "external_run_id": run.external_run_id,
                "status": run.status.value if hasattr(run.status, "value") else str(run.status),
                "task": run.task,
                "model": run.model,
                "started_at": to_api_timestamp(run.started_at),
                "completed_at": to_api_timestamp(run.ended_at),
                "avg_latency_ms": avg_latencies.get(run.id),
                "eval_score": run_eval_score(run.id),
                "metric_averages": run_metric_averages(run.id),
                "version_label": version_labels.get(run.dataset_version_id),
                "items_count": int(items_counts.get(run.id, 0)),
            }
            for run in runs
        ],
        "total": total,
        "metric_names": metric_names,
    }


@router.post("/v1/datasets/{dataset_ref}/versions")
def create_version(
    dataset_ref: str,
    req: CreateVersionRequest,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:write")
    project = _project_for_request(db, principal, project_slug, write=True)
    dataset = _get_dataset(db, project, dataset_ref)
    source_ref = req.from_version or req.from_alias
    parent = _resolve_version(db, dataset, source_ref) if source_ref else None
    version_name, display_name = _version_identity(db, dataset, req.version, req.name)
    version = DatasetVersion(
        id=str(uuid4()),
        dataset_id=dataset.id,
        version=version_name,
        name=display_name,
        description=req.description,
        status=DatasetVersionStatus.DRAFT,
        source_type="derived" if parent else "api",
        parent_version_id=parent.id if parent else None,
        base_version_id=parent.base_version_id or parent.id if parent else None,
        labels=_labels(req.labels),
        created_by_user_id=principal.user.id,
        created_at=utc_now_naive(),
        updated_at=utc_now_naive(),
    )
    db.add(version)
    db.flush()
    if parent:
        for item in db.query(DatasetItem).filter(DatasetItem.dataset_version_id == parent.id).order_by(DatasetItem.index).all():
            db.add(
                DatasetItem(
                    dataset_version_id=version.id,
                    item_id=item.item_id,
                    index=item.index,
                    input=item.input,
                    expected_output=item.expected_output,
                    item_metadata=dict(item.item_metadata or {}),
                    labels=list(item.labels or []),
                    fingerprint=item.fingerprint,
                    created_at=utc_now_naive(),
                    updated_at=utc_now_naive(),
                )
            )
        version.item_count = parent.item_count
    _record_change(
        db, version, {"type": "created", "from_version_id": parent.id if parent else None}, actor_user_id=principal.user.id
    )
    db.commit()
    return {"version": _version_payload(db, version)}


@router.post("/v1/datasets/{dataset_ref}/versions/{version_ref}:publish")
def publish_version(
    dataset_ref: str,
    version_ref: str,
    req: PublishVersionRequest = Body(default_factory=PublishVersionRequest),
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:write")
    project = _project_for_request(db, principal, project_slug, write=True)
    dataset = _get_dataset(db, project, dataset_ref)
    version = _resolve_version(db, dataset, version_ref)
    if req.set_alias:
        _require_alias_permission(db, principal, dataset, req.set_alias)
    items = db.query(DatasetItem).filter(DatasetItem.dataset_version_id == version.id).order_by(DatasetItem.index).all()
    if not items:
        raise HTTPException(status_code=400, detail="Cannot publish an empty dataset version")
    seen = set()
    for item in items:
        if item.item_id in seen:
            raise HTTPException(status_code=409, detail=f"Duplicate item_id: {item.item_id}")
        seen.add(item.item_id)
    version.status = DatasetVersionStatus.PUBLISHED
    version.item_count = len(items)
    version.content_hash = _content_hash(items)
    version.published_by_user_id = principal.user.id
    version.published_at = utc_now_naive()
    version.updated_at = utc_now_naive()
    _record_change(db, version, {"type": "published", "item_count": len(items)}, actor_user_id=principal.user.id)
    _audit(db, principal, "dataset.version_published", dataset, after={"version": version.version, "item_count": len(items)})
    _store_published_counts(db, version)
    if req.set_alias:
        _set_alias(db, dataset, req.set_alias, version, principal)
    db.commit()
    return {"version": _version_payload(db, version)}


def _store_published_counts(db: Session, version: DatasetVersion) -> None:
    """Persist lineage counts that just became final: this version's, and its published children's."""
    db.flush()
    store_change_counts(db, version)
    for child in (
        db.query(DatasetVersion)
        .filter(DatasetVersion.parent_version_id == version.id, DatasetVersion.status == DatasetVersionStatus.PUBLISHED)
        .all()
    ):
        store_change_counts(db, child, version)


@router.patch("/v1/datasets/{dataset_ref}/versions/{version_ref}")
def update_version(
    dataset_ref: str,
    version_ref: str,
    req: UpdateVersionRequest,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    """Edit version metadata. The vN identifier itself is immutable."""
    _require_scope(principal, "datasets:write")
    project = _project_for_request(db, principal, project_slug, write=True)
    dataset = _get_dataset(db, project, dataset_ref)
    version = _resolve_version(db, dataset, version_ref)
    if req.name is not None:
        version.name = req.name.strip()
    if req.description is not None:
        version.description = req.description
    version.updated_at = utc_now_naive()
    db.commit()
    return {"version": _version_payload(db, version)}


def _require_alias_permission(db: Session, principal: Principal, dataset: Dataset, alias_name: str) -> None:
    """Moving "production" changes what every evaluation of the dataset runs on.

    Project managers move it. The dataset's creator may also set it while the
    dataset has no production alias yet (its first publish), so creating and
    publishing a new dataset keeps working for members.
    """
    if alias_name != "production" or _can_manage_datasets(db, principal, dataset.project_id):
        return
    existing = (
        db.query(DatasetAlias.id)
        .filter(DatasetAlias.dataset_id == dataset.id, DatasetAlias.alias == alias_name)
        .first()
    )
    if existing is None and principal.user and dataset.created_by_user_id == principal.user.id:
        return
    raise HTTPException(status_code=403, detail=MANAGER_ONLY_PRODUCTION)


def _set_alias(db: Session, dataset: Dataset, alias_name: str, version: DatasetVersion, principal: Principal) -> DatasetAlias:
    status = version.status.value if hasattr(version.status, "value") else str(version.status)
    if status != DatasetVersionStatus.PUBLISHED.value:
        raise HTTPException(status_code=409, detail="Aliases can only point to published versions")
    _require_alias_permission(db, principal, dataset, alias_name)
    user_id = principal.user.id
    alias = (
        db.query(DatasetAlias)
        .filter(DatasetAlias.dataset_id == dataset.id, DatasetAlias.alias == alias_name)
        .first()
    )
    previous_version_id = alias.dataset_version_id if alias else None
    if not alias:
        alias = DatasetAlias(dataset_id=dataset.id, alias=alias_name, updated_by_user_id=user_id, updated_at=utc_now_naive(), dataset_version_id=version.id)
        db.add(alias)
    else:
        alias.dataset_version_id = version.id
        alias.updated_by_user_id = user_id
        alias.updated_at = utc_now_naive()
    if previous_version_id != version.id:
        previous = db.get(DatasetVersion, previous_version_id) if previous_version_id else None
        _record_change(
            db,
            version,
            {"type": "alias_set", "alias": alias_name, "from_version_id": previous_version_id},
            actor_user_id=user_id,
        )
        _audit(
            db,
            principal,
            "dataset.alias_moved",
            dataset,
            before={"alias": alias_name, "version": previous.version if previous else None, "version_id": previous_version_id},
            after={"alias": alias_name, "version": version.version, "version_id": version.id},
        )
    return alias


def _next_version_name(db: Session, dataset: Dataset) -> str:
    highest = 0
    rows = db.query(DatasetVersion.version).filter(DatasetVersion.dataset_id == dataset.id).all()
    for (version_name,) in rows:
        match = re.fullmatch(r"v(\d+)", str(version_name or ""))
        if match:
            highest = max(highest, int(match.group(1)))
    return f"v{highest + 1}"


def _version_identity(db: Session, dataset: Dataset, requested_version: Optional[str], requested_name: str = "") -> tuple[str, str]:
    """Version identifiers are always sequential ``vN``; free text becomes the name.

    An explicitly requested ``vN`` that is still free is honored. Anything else
    (custom labels from older callers, or a collision) falls through to
    auto-numbering, preserving the free text as the display name.
    """
    requested = (requested_version or "").strip()
    name = (requested_name or "").strip()
    if re.fullmatch(r"v\d+", requested):
        taken = (
            db.query(DatasetVersion.id)
            .filter(DatasetVersion.dataset_id == dataset.id, DatasetVersion.version == requested)
            .first()
        )
        if not taken:
            return requested, name
    elif requested and not name:
        name = requested
    return _next_version_name(db, dataset), name


@router.post("/v1/datasets/{dataset_ref}/aliases/{alias_name}")
def set_alias(
    dataset_ref: str,
    alias_name: str,
    req: SetAliasRequest,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:write")
    project = _project_for_request(db, principal, project_slug, write=True)
    dataset = _get_dataset(db, project, dataset_ref)
    version = _resolve_version(db, dataset, req.version)
    alias = _set_alias(db, dataset, alias_name, version, principal)
    db.commit()
    return {"alias": {"dataset_id": dataset.id, "alias": alias.alias, "dataset_version_id": alias.dataset_version_id}}


@router.get("/v1/datasets/{dataset_ref}/lineage")
def get_lineage(
    dataset_ref: str,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    """Versions with their change counts, and every recorded change, oldest first.

    Counts of published versions are stored (one column read); only drafts are
    diffed against their parent per request.
    """
    _require_scope(principal, "datasets:read")
    project = _project_for_request(db, principal, project_slug)
    dataset = _get_dataset(db, project, dataset_ref)
    versions = (
        db.query(DatasetVersion)
        .filter(DatasetVersion.dataset_id == dataset.id)
        .order_by(DatasetVersion.created_at, DatasetVersion.id)
        .all()
    )
    changes = (
        db.query(DatasetVersionChange)
        .join(DatasetVersion, DatasetVersion.id == DatasetVersionChange.dataset_version_id)
        .filter(DatasetVersion.dataset_id == dataset.id)
        .order_by(DatasetVersionChange.created_at, DatasetVersionChange.id)
        .all()
    )
    payloads = _version_payloads(db, versions)
    counts = change_counts_for(db, versions)
    version_payloads = []
    for version in versions:
        payload = payloads[version.id]
        payload["change_counts"] = counts[version.id]
        version_payloads.append(payload)
    actor_ids = [
        str((change.change_summary or {}).get("actor_user_id") or "")
        for change in changes
    ]
    actors = _user_map(db, actor_ids)
    return {
        "dataset": _dataset_payload(db, dataset, principal),
        "versions": version_payloads,
        "changes": [
            {
                "id": change.id,
                "dataset_version_id": change.dataset_version_id,
                "parent_version_id": change.parent_version_id,
                "change_summary": change.change_summary or {},
                "actor": _user_payload(actors.get(actor_id)),
                "created_at": to_api_timestamp(change.created_at),
            }
            for change, actor_id in zip(changes, actor_ids)
        ],
    }


_COMPUTED_SORT_PREFIXES = ("runs_", "edits_", "latency_", "metric:")


def _plain_item_order(sort_key: str) -> list[Any]:
    """ORDER BY for the stored-column sorts (shared by the items list and Prev/Next)."""
    if sort_key == "index_desc":
        return [DatasetItem.index.desc(), DatasetItem.item_id]
    if sort_key == "updated_desc":
        return [DatasetItem.updated_at.desc(), DatasetItem.item_id]
    if sort_key in ("item_id", "item_id_asc"):
        return [DatasetItem.item_id]
    if sort_key == "item_id_desc":
        return [DatasetItem.item_id.desc()]
    if sort_key == "input_asc":
        return [cast(DatasetItem.input, String), DatasetItem.index]
    if sort_key == "input_desc":
        return [cast(DatasetItem.input, String).desc(), DatasetItem.index]
    if sort_key == "expected_asc":
        return [cast(DatasetItem.expected_output, String), DatasetItem.index]
    if sort_key == "expected_desc":
        return [cast(DatasetItem.expected_output, String).desc(), DatasetItem.index]
    if sort_key == "metadata_asc":
        return [cast(DatasetItem.item_metadata, String), DatasetItem.index]
    if sort_key == "metadata_desc":
        return [cast(DatasetItem.item_metadata, String).desc(), DatasetItem.index]
    return [DatasetItem.index, DatasetItem.item_id]


def _filtered_items_query(db: Session, version: DatasetVersion, search: Optional[str], label: Optional[str]):
    query = db.query(DatasetItem).filter(DatasetItem.dataset_version_id == version.id)
    query = filter_dataset_item_search(db, query, search, version_id=version.id)
    if label:
        query = query.filter(cast(DatasetItem.labels, String).like(f"%{label}%"))
    return query


def _computed_sort_ids(db: Session, version: DatasetVersion, query, sort_raw: str) -> list[int]:
    """Item ids in computed-sort order, from light rows (no item bodies)."""
    sort_key = sort_raw.lower()
    light = [
        row
        for row in query.with_entities(DatasetItem.id, DatasetItem.item_id, DatasetItem.index)
        .order_by(DatasetItem.index, DatasetItem.item_id)
        .all()
    ]
    direction = "desc" if sort_key.endswith("_desc") or sort_key.endswith(":desc") else "asc"
    if sort_key.startswith("edits_"):
        edit_counts = _item_edit_counts(db, version, light)

        def computed_value(row: Any) -> Any:
            return edit_counts.get(row.id, 0)
    else:
        summaries = _item_result_summaries(db, version, light)
        metric_name = sort_raw.split(":")[1] if sort_key.startswith("metric:") and len(sort_raw.split(":")) >= 2 else ""

        def computed_value(row: Any) -> Any:
            summary = summaries.get(row.id, {}) or {}
            if sort_key.startswith("runs_"):
                return summary.get("run_count") or 0
            if sort_key.startswith("latency_"):
                value = summary.get("avg_latency_ms")
                return float(value) if value is not None else None
            value = ((summary.get("metrics") or {}).get(metric_name) or {}).get("avg")
            return float(value) if value is not None else None

    def sort_tuple(row: Any) -> tuple[int, Any, int, str]:
        value = computed_value(row)
        missing = 1 if value is None else 0
        if isinstance(value, (int, float)) and direction == "desc":
            value = -value
        return (missing, value if value is not None else 0, row.index, row.item_id)

    light.sort(key=sort_tuple)
    return [row.id for row in light]


@router.get("/v1/datasets/{dataset_ref}/versions/{version_ref}/items")
def list_items(
    dataset_ref: str,
    version_ref: str,
    project_slug: Optional[str] = Query(default=None),
    limit: int = Query(default=100, le=1000),
    offset: int = Query(default=0, ge=0),
    search: Optional[str] = Query(default=None),
    sort: str = Query(default="index_asc"),
    label: Optional[str] = Query(default=None),
    include_context: bool = Query(
        default=True,
        description="Include the dataset and version payloads. The dashboard passes false: it already has them.",
    ),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:read")
    project = _project_for_request(db, principal, project_slug)
    dataset = _get_dataset(db, project, dataset_ref)
    version = _resolve_version(db, dataset, version_ref)
    query = _filtered_items_query(db, version, search, label)

    sort_raw = sort or "index_asc"
    sort_key = sort_raw.lower()
    if sort_key.startswith(_COMPUTED_SORT_PREFIXES):
        ordered_ids = _computed_sort_ids(db, version, query, sort_raw)
        total = len(ordered_ids)
        page_ids = ordered_ids[offset : offset + limit]
        rows = {item.id: item for item in db.query(DatasetItem).filter(DatasetItem.id.in_(page_ids)).all()} if page_ids else {}
        items = [rows[item_id] for item_id in page_ids if item_id in rows]
    else:
        # The page's ids and the total in one statement, so the search
        # predicate runs once. The window runs over narrow (id) rows: over
        # full item rows it spilled every matching body to a tuplestore.
        page = (
            query.with_entities(DatasetItem.id, func.count(DatasetItem.id).over().label("total"))
            .order_by(*_plain_item_order(sort_key))
            .offset(offset)
            .limit(limit)
            .all()
        )
        page_ids = [row[0] for row in page]
        rows = {item.id: item for item in db.query(DatasetItem).filter(DatasetItem.id.in_(page_ids)).all()} if page_ids else {}
        items = [rows[item_id] for item_id in page_ids if item_id in rows]
        if page:
            total = int(page[0][1])
        else:
            total = (query.with_entities(func.count(DatasetItem.id)).order_by(None).scalar() or 0) if offset else 0
    result_summaries = _item_result_summaries(db, version, items)
    edit_counts = _item_edit_counts(db, version, items)
    metric_names = _version_metric_names(db, version)
    response: Dict[str, Any] = {
        "items": [
            _item_payload(
                item,
                run_count=(result_summaries.get(item.id, {}) or {}).get("run_count", 0),
                result_summary=result_summaries.get(item.id),
            )
            | {"edit_count": edit_counts.get(item.id, 0)}
            for item in items
        ],
        "metric_names": metric_names,
        "total": int(total),
        "next_offset": offset + limit if offset + limit < int(total) else None,
    }
    if include_context:
        response["dataset"] = _dataset_payload(db, dataset, principal)
        response["version"] = _version_payload(db, version)
    return response


@router.post("/v1/datasets/{dataset_ref}/versions/{version_ref}/items")
def create_item(
    dataset_ref: str,
    version_ref: str,
    req: UpsertItemRequest,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:write")
    project = _project_for_request(db, principal, project_slug, write=True)
    dataset = _get_dataset(db, project, dataset_ref)
    version = _resolve_version(db, dataset, version_ref)
    _require_draft(version)
    input_value = _json_safe(req.input)
    expected = _json_safe(req.expected_output)
    metadata = _json_safe(req.metadata or {})
    max_index = (
        db.query(func.max(DatasetItem.index))
        .filter(DatasetItem.dataset_version_id == version.id)
        .scalar()
    )
    next_index = int(max_index) + 1 if max_index is not None else 0
    item_id = (req.item_id or "").strip() or f"item-{next_index + 1}"
    item = DatasetItem(
        dataset_version_id=version.id,
        item_id=item_id,
        index=next_index,
        input=input_value,
        expected_output=expected,
        item_metadata=metadata,
        labels=_labels(req.labels),
        fingerprint=build_identity_fingerprint(input_value=input_value, expected_value=expected, metadata=metadata),
        created_at=utc_now_naive(),
        updated_at=utc_now_naive(),
    )
    db.add(item)
    version.item_count = int(version.item_count or 0) + 1
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Dataset item ID already exists in this version") from exc
    _record_item_revision(
        db,
        version,
        item,
        change_type="created",
        before={},
        after=_item_payload(item),
        actor_user_id=principal.user.id,
    )
    db.commit()
    return {"item": _item_payload(item)}


@router.get("/v1/datasets/{dataset_ref}/versions/{version_ref}/items/{item_id}")
def get_item(
    dataset_ref: str,
    version_ref: str,
    item_id: str,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:read")
    project = _project_for_request(db, principal, project_slug)
    dataset = _get_dataset(db, project, dataset_ref)
    version = _resolve_version(db, dataset, version_ref)
    item = (
        db.query(DatasetItem)
        .filter(DatasetItem.dataset_version_id == version.id, DatasetItem.item_id == item_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    run_count = db.query(RunItem.id).filter(RunItem.dataset_item_pk == item.id).count()
    return {"item": _item_payload(item, run_count=run_count)}


@router.patch("/v1/datasets/{dataset_ref}/versions/{version_ref}/items/{item_id}")
def update_item(
    dataset_ref: str,
    version_ref: str,
    item_id: str,
    req: PatchItemRequest,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    """Partially update an item: fields left out of the body keep their values.

    A full body (every field) still replaces the whole item, as the History revert does.
    """
    _require_scope(principal, "datasets:write")
    project = _project_for_request(db, principal, project_slug, write=True)
    dataset = _get_dataset(db, project, dataset_ref)
    version = _resolve_version(db, dataset, version_ref)
    _require_draft(version)
    item = (
        db.query(DatasetItem)
        .filter(DatasetItem.dataset_version_id == version.id, DatasetItem.item_id == item_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Dataset item not found")
    before = _item_payload(item)
    changes = req.model_dump(exclude_unset=True)
    next_item_id = (changes.get("item_id") or "").strip() or item.item_id
    input_value = _json_safe(changes["input"]) if "input" in changes else item.input
    expected = _json_safe(changes["expected_output"]) if "expected_output" in changes else item.expected_output
    metadata = _json_safe(changes["metadata"] or {}) if "metadata" in changes else (item.item_metadata or {})
    labels = _labels(changes["labels"]) if "labels" in changes else list(item.labels or [])
    unchanged = (
        next_item_id == item.item_id
        and _same_json(input_value, item.input)
        and _same_json(expected, item.expected_output)
        and _same_json(metadata, item.item_metadata or {})
        and labels == list(item.labels or [])
    )
    if unchanged:
        # Nothing to write: no revision, no updated_at bump.
        return {"item": before}
    item.item_id = next_item_id
    item.input = input_value
    item.expected_output = expected
    item.item_metadata = metadata
    item.labels = labels
    # SQLAlchemy compares JSON values with ==, so 1 -> true or 1 -> 1.0 would not be written.
    for attr in ("input", "expected_output", "item_metadata"):
        flag_modified(item, attr)
    item.fingerprint = build_identity_fingerprint(input_value=input_value, expected_value=expected, metadata=metadata)
    item.updated_at = utc_now_naive()
    _record_item_revision(db, version, item, change_type="updated", before=before, after=_item_payload(item), actor_user_id=principal.user.id)
    db.commit()
    return {"item": _item_payload(item)}


@router.delete("/v1/datasets/{dataset_ref}/versions/{version_ref}/items/{item_id}")
def delete_item(
    dataset_ref: str,
    version_ref: str,
    item_id: str,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:write")
    project = _project_for_request(db, principal, project_slug, write=True)
    dataset = _get_dataset(db, project, dataset_ref)
    version = _resolve_version(db, dataset, version_ref)
    _require_draft(version)
    item = (
        db.query(DatasetItem)
        .filter(DatasetItem.dataset_version_id == version.id, DatasetItem.item_id == item_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Dataset item not found")
    before = _item_payload(item)
    _record_item_revision(db, version, None, change_type="deleted", before=before, after={}, actor_user_id=principal.user.id)
    _detach_item_revisions(db, item)
    _detach_item_run_results(db, item)
    db.delete(item)
    version.item_count = max(0, int(version.item_count or 0) - 1)
    db.commit()
    return {"ok": True}


@router.post("/v1/datasets/{dataset_ref}/versions/{version_ref}/items:bulk")
def bulk_items(
    dataset_ref: str,
    version_ref: str,
    req: BulkItemsRequest,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:write")
    project = _project_for_request(db, principal, project_slug, write=True)
    dataset = _get_dataset(db, project, dataset_ref)
    version = _resolve_version(db, dataset, version_ref)
    _require_draft(version)

    created: list[Dict[str, Any]] = []
    updated: list[Dict[str, Any]] = []
    deleted: list[str] = []

    for raw_id in req.deletes or []:
        target_id = (raw_id or "").strip()
        if not target_id:
            continue
        item = (
            db.query(DatasetItem)
            .filter(DatasetItem.dataset_version_id == version.id, DatasetItem.item_id == target_id)
            .first()
        )
        if not item:
            continue
        before = _item_payload(item)
        _record_item_revision(
            db, version, None, change_type="deleted", before=before, after={}, actor_user_id=principal.user.id,
        )
        _detach_item_revisions(db, item)
        _detach_item_run_results(db, item)
        db.delete(item)
        version.item_count = max(0, int(version.item_count or 0) - 1)
        deleted.append(target_id)

    db.flush()

    max_index = (
        db.query(func.max(DatasetItem.index))
        .filter(DatasetItem.dataset_version_id == version.id)
        .scalar()
    )
    next_index = int(max_index) + 1 if max_index is not None else 0

    for entry in req.upserts or []:
        input_value = _json_safe(entry.input)
        expected = _json_safe(entry.expected_output)
        metadata = _json_safe(entry.metadata or {})
        labels = _labels(entry.labels)
        fingerprint = build_identity_fingerprint(input_value=input_value, expected_value=expected, metadata=metadata)
        existing = None
        if entry.item_id:
            existing = (
                db.query(DatasetItem)
                .filter(DatasetItem.dataset_version_id == version.id, DatasetItem.item_id == entry.item_id.strip())
                .first()
            )
        op = (entry.op or "").lower()
        if existing and op != "create":
            before = _item_payload(existing)
            existing.input = input_value
            existing.expected_output = expected
            existing.item_metadata = metadata
            existing.labels = labels
            existing.fingerprint = fingerprint
            existing.updated_at = utc_now_naive()
            _record_item_revision(
                db, version, existing, change_type="updated", before=before, after=_item_payload(existing), actor_user_id=principal.user.id,
            )
            updated.append(_item_payload(existing))
        else:
            item_id = (entry.item_id or "").strip() or f"item-{next_index + 1}"
            new_item = DatasetItem(
                dataset_version_id=version.id,
                item_id=item_id,
                index=next_index,
                input=input_value,
                expected_output=expected,
                item_metadata=metadata,
                labels=labels,
                fingerprint=fingerprint,
                created_at=utc_now_naive(),
                updated_at=utc_now_naive(),
            )
            db.add(new_item)
            version.item_count = int(version.item_count or 0) + 1
            try:
                db.flush()
            except IntegrityError as exc:
                db.rollback()
                raise HTTPException(status_code=409, detail=f"Dataset item ID already exists: {item_id}") from exc
            _record_item_revision(
                db, version, new_item, change_type="created", before={}, after=_item_payload(new_item), actor_user_id=principal.user.id,
            )
            created.append(_item_payload(new_item))
            next_index += 1

    db.commit()
    return {
        "summary": {"created": len(created), "updated": len(updated), "deleted": len(deleted)},
        "created": created,
        "updated": updated,
        "deleted": deleted,
    }


@router.get("/v1/datasets/{dataset_ref}/versions/{version_ref}/items/{item_id}/runs")
def item_runs(
    dataset_ref: str,
    version_ref: str,
    item_id: str,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:read")
    project = _project_for_request(db, principal, project_slug)
    dataset = _get_dataset(db, project, dataset_ref)
    version = _resolve_version(db, dataset, version_ref)
    item = (
        db.query(DatasetItem)
        .filter(DatasetItem.dataset_version_id == version.id, DatasetItem.item_id == item_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Dataset item not found")
    rows = (
        db.query(Run, RunItem)
        .join(RunItem, RunItem.run_id == Run.id)
        .filter(
            Run.deleted_at.is_(None),
            Run.project_id == project.id,
            (
                (RunItem.dataset_item_pk == item.id)
                | ((Run.dataset_version_id == version.id) & (RunItem.item_id == item.item_id))
            ),
        )
        .order_by(Run.created_at.desc())
        .all()
    )
    run_ids = [run.id for run, _ in rows]
    run_item_keys = {(run.id, run_item.item_id) for run, run_item in rows}
    score_rows: list[RunItemScore] = []
    if run_ids:
        # Only this item's scores (uq_run_item_metric serves run_id + item_id), not
        # every score of every run that contains it.
        score_rows = (
            db.query(RunItemScore)
            .filter(
                RunItemScore.run_id.in_(run_ids),
                RunItemScore.item_id.in_({item_id for _, item_id in run_item_keys}),
            )
            .all()
        )
    scores_by_key: Dict[tuple[str, str], list[RunItemScore]] = defaultdict(list)
    for score in score_rows:
        key = (score.run_id, score.item_id)
        if key in run_item_keys:
            scores_by_key[key].append(score)
    users = _user_map(db, [run.owner_user_id for run, _ in rows])
    numeric_scores_by_metric: Dict[str, list[float]] = defaultdict(list)
    all_numeric_scores: list[float] = []
    latencies: list[float] = []
    error_count = 0
    for run, run_item in rows:
        if run_item.error:
            error_count += 1
        if run_item.latency_ms is not None:
            latencies.append(float(run_item.latency_ms))
        for score in scores_by_key.get((run.id, run_item.item_id), []):
            value = _score_numeric_value(score)
            if value is None:
                continue
            all_numeric_scores.append(value)
            numeric_scores_by_metric[score.metric_name].append(value)
    metric_aggregates = {
        metric: {
            "count": len(values),
            "avg": round(sum(values) / len(values), 4) if values else None,
            "min": min(values) if values else None,
            "max": max(values) if values else None,
        }
        for metric, values in sorted(numeric_scores_by_metric.items())
    }
    return {
        "item": _item_payload(item),
        "aggregates": {
            "run_count": len(rows),
            "success_count": len(rows) - error_count,
            "error_count": error_count,
            "avg_latency_ms": round(sum(latencies) / len(latencies), 2) if latencies else None,
            "avg_score": round(sum(all_numeric_scores) / len(all_numeric_scores), 4) if all_numeric_scores else None,
            "metrics": metric_aggregates,
        },
        "runs": [
            {
                "run_id": run.id,
                "run_name": (
                    str((run.run_config or {}).get("run_name") or "")
                    if isinstance(run.run_config, dict)
                    else ""
                )
                or run.external_run_id
                or run.id,
                "external_run_id": run.external_run_id,
                "task": run.task,
                "dataset": run.dataset,
                "model": run.model,
                "status": run.status.value if hasattr(run.status, "value") else str(run.status),
                "created_at": to_api_timestamp(run.created_at),
                "started_at": to_api_timestamp(run.started_at),
                "completed_at": to_api_timestamp(run.ended_at),
                "owner": _user_payload(users.get(run.owner_user_id)),
                "item_id": run_item.item_id,
                "output": run_item.output,
                "trace_id": run_item.trace_id,
                "trace_url": run_item.trace_url,
                "error": run_item.error,
                "latency_ms": run_item.latency_ms,
                "retry_count": run_item.retry_count,
                "scores": [
                    {
                        "metric_name": score.metric_name,
                        "score_numeric": score.score_numeric,
                        "score_raw": score.score_raw,
                        "label": score.label,
                        "explanation": score.explanation,
                    }
                    for score in scores_by_key.get((run.id, run_item.item_id), [])
                ],
            }
            for run, run_item in rows
        ],
    }


@router.get("/v1/datasets/{dataset_ref}/versions/{version_ref}/items/{item_id}/neighbors")
def item_neighbors(
    dataset_ref: str,
    version_ref: str,
    item_id: str,
    project_slug: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    sort: str = Query(default="index_asc"),
    label: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:read")
    project = _project_for_request(db, principal, project_slug)
    dataset = _get_dataset(db, project, dataset_ref)
    version = _resolve_version(db, dataset, version_ref)
    query = _filtered_items_query(db, version, search, label)
    sort_key = (sort or "index_asc").lower()
    if sort_key.startswith(_COMPUTED_SORT_PREFIXES):
        ordered_ids = _computed_sort_ids(db, version, query, sort or "index_asc")
        target = db.query(DatasetItem.id).filter(DatasetItem.dataset_version_id == version.id, DatasetItem.item_id == item_id).scalar()
        idx = ordered_ids.index(target) if target in ordered_ids else -1
        total = len(ordered_ids)
        neighbor_ids = {
            "previous": ordered_ids[idx - 1] if idx > 0 else None,
            "next": ordered_ids[idx + 1] if 0 <= idx < total - 1 else None,
        }
    else:
        # Position by row_number() over the list's own ORDER BY: only the two
        # neighbours are loaded, not every matching item.
        numbered = query.with_entities(
            DatasetItem.id.label("pk"),
            DatasetItem.item_id.label("item_id"),
            func.row_number().over(order_by=_plain_item_order(sort_key)).label("position"),
            func.count(DatasetItem.id).over().label("total"),
        ).subquery()
        hit = db.query(numbered.c.position, numbered.c.total).filter(numbered.c.item_id == item_id).first()
        idx = int(hit.position) - 1 if hit else -1
        total = int(hit.total) if hit else 0
        neighbor_ids = {"previous": None, "next": None}
        if hit:
            for pk, position in db.query(numbered.c.pk, numbered.c.position).filter(
                numbered.c.position.in_([hit.position - 1, hit.position + 1])
            ):
                neighbor_ids["previous" if position < hit.position else "next"] = pk
    if idx < 0:
        raise HTTPException(status_code=404, detail="Dataset item not found in current item set")
    wanted = [pk for pk in neighbor_ids.values() if pk is not None]
    rows = {row.id: row for row in db.query(DatasetItem).filter(DatasetItem.id.in_(wanted)).all()} if wanted else {}
    previous_item = rows.get(neighbor_ids["previous"])
    next_item = rows.get(neighbor_ids["next"])
    return {
        "item_id": item_id,
        "index": idx,
        "total": total,
        "previous": _item_payload(previous_item) if previous_item else None,
        "next": _item_payload(next_item) if next_item else None,
    }


@router.get("/v1/datasets/{dataset_ref}/versions/{version_ref}/items/{item_id}/lineage")
def item_lineage(
    dataset_ref: str,
    version_ref: str,
    item_id: str,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:read")
    project = _project_for_request(db, principal, project_slug)
    dataset = _get_dataset(db, project, dataset_ref)
    version = _resolve_version(db, dataset, version_ref)
    versions_by_id = {
        row.id: row
        for row in db.query(DatasetVersion).filter(DatasetVersion.dataset_id == dataset.id).all()
    }
    chain: list[DatasetVersion] = []
    seen: set[str] = set()
    cursor: Optional[DatasetVersion] = version
    while cursor and cursor.id not in seen:
        seen.add(cursor.id)
        chain.append(cursor)
        cursor = versions_by_id.get(cursor.parent_version_id) if cursor.parent_version_id else None
    chain.reverse()

    items_by_version = {
        row.dataset_version_id: row
        for row in db.query(DatasetItem)
        .filter(DatasetItem.dataset_version_id.in_([v.id for v in chain]), DatasetItem.item_id == item_id)
        .all()
    }
    revision_rows = (
        db.query(DatasetItemRevision)
        .filter(DatasetItemRevision.dataset_version_id.in_([v.id for v in chain]))
        .order_by(DatasetItemRevision.created_at, DatasetItemRevision.revision_number)
        .all()
    )
    relevant_revisions: list[DatasetItemRevision] = []
    for revision in revision_rows:
        before_id = (revision.before or {}).get("item_id")
        after_id = (revision.after or {}).get("item_id")
        if before_id == item_id or after_id == item_id:
            relevant_revisions.append(revision)
            continue
        item = items_by_version.get(revision.dataset_version_id)
        if item and revision.dataset_item_id == item.id:
            relevant_revisions.append(revision)
    users = _user_map(
        db,
        [r.actor_user_id for r in relevant_revisions]
        + [v.created_by_user_id for v in chain]
        + [v.published_by_user_id for v in chain],
    )
    revisions_by_version: Dict[str, list[DatasetItemRevision]] = defaultdict(list)
    for revision in relevant_revisions:
        revisions_by_version[revision.dataset_version_id].append(revision)
    return {
        "item_id": item_id,
        "lineage": [
            {
                "version": _version_payload(db, v),
                "item": _item_payload(items_by_version[v.id]) if v.id in items_by_version else None,
                "revisions": [
                    {
                        "id": row.id,
                        "revision_number": row.revision_number,
                        "change_type": row.change_type,
                        "before": row.before,
                        "after": row.after,
                        "actor_user_id": row.actor_user_id,
                        "actor": _user_payload(users.get(row.actor_user_id)),
                        "actor_email": (users.get(row.actor_user_id).email if users.get(row.actor_user_id) else None),
                        "actor_name": (users.get(row.actor_user_id).display_name if users.get(row.actor_user_id) else None),
                        "created_at": to_api_timestamp(row.created_at),
                    }
                    for row in revisions_by_version.get(v.id, [])
                ],
            }
            for v in chain
        ],
    }


_COMPARE_KINDS = ("changed", "added", "removed", "unchanged")


def _compare_revision_version_ids(
    db: Session, dataset: Dataset, target: DatasetVersion, base_version: DatasetVersion
) -> list[str]:
    """Versions whose item revisions explain a base..head diff.

    The head and each ancestor up to (not including) the base or the nearest
    version the base also descends from, so an edit made in an intermediate
    version (v2 of a v1..v3 compare) keeps its own time instead of the head's.
    """
    parents = dict(
        db.query(DatasetVersion.id, DatasetVersion.parent_version_id).filter(DatasetVersion.dataset_id == dataset.id)
    )
    base_line: set[str] = set()
    cursor: Optional[str] = base_version.id
    while cursor and cursor not in base_line:
        base_line.add(cursor)
        cursor = parents.get(cursor)
    path = [target.id]
    cursor = parents.get(target.id)
    while cursor and cursor not in base_line and cursor not in path:
        path.append(cursor)
        cursor = parents.get(cursor)
    return path


def _compare_rows(db: Session, version_id: str) -> Dict[str, Any]:
    """Light rows for a compare: identity and content hash, no item bodies."""
    return {
        row.item_id: row
        for row in db.query(
            DatasetItem.id,
            DatasetItem.item_id,
            DatasetItem.index,
            DatasetItem.fingerprint,
            DatasetItem.labels,
        ).filter(DatasetItem.dataset_version_id == version_id)
    }


@router.get("/v1/datasets/{dataset_ref}/versions/{version_ref}:compare")
def compare_versions(
    dataset_ref: str,
    version_ref: str,
    base: str = Query(...),
    project_slug: Optional[str] = Query(default=None),
    include_diffs: int = Query(default=0),
    kind: Optional[str] = Query(default=None, description="With limit: which list to page (changed, added, removed, unchanged)."),
    limit: Optional[int] = Query(default=None, ge=1, le=500, description="Page the item bodies of one list; omit for every list in full."),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    """Diff two versions. Every list is ordered by when the change happened.

    ``changed_at`` is the time of the item's latest revision in the head or
    an ancestor after the base, or the head version's creation when the change
    has no revision
    (an uploaded file, a version created before revisions were kept);
    ``changed_at_source`` says which. With ``limit``, item bodies are loaded
    only for one page of one list, so a version that edits thousands of items
    opens without loading them all.
    """
    _require_scope(principal, "datasets:read")
    project = _project_for_request(db, principal, project_slug)
    dataset = _get_dataset(db, project, dataset_ref)
    target = _resolve_version(db, dataset, version_ref)
    base_version = _resolve_version(db, dataset, base)
    page_kind = (kind or "changed").strip().lower()
    if page_kind not in _COMPARE_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of: {', '.join(_COMPARE_KINDS)}")
    base_rows = _compare_rows(db, base_version.id)
    target_rows = _compare_rows(db, target.id)

    # Latest revision per item ID in the versions between base and head (item
    # IDs read from the stored JSON, not the bodies). Ties keep the highest
    # revision number.
    revision_rows = (
        db.query(
            DatasetItemRevision.before["item_id"].as_string(),
            DatasetItemRevision.after["item_id"].as_string(),
            DatasetItemRevision.actor_user_id,
            DatasetItemRevision.created_at,
        )
        .filter(DatasetItemRevision.dataset_version_id.in_(_compare_revision_version_ids(db, dataset, target, base_version)))
        .order_by(DatasetItemRevision.created_at.desc(), DatasetItemRevision.revision_number.desc())
        .all()
    )
    latest_revision_by_item_id: Dict[str, tuple] = {}
    for before_id, after_id, actor_user_id, created_at in revision_rows:
        for candidate_id in (after_id, before_id):
            if candidate_id and str(candidate_id) not in latest_revision_by_item_id:
                latest_revision_by_item_id[str(candidate_id)] = (actor_user_id, created_at)
    actor_users = _user_map(
        db,
        [actor_user_id for _, _, actor_user_id, _ in revision_rows]
        + [target.created_by_user_id, target.published_by_user_id],
    )
    fallback_at = target.created_at

    def _changed_at(item_id_value: str) -> tuple[Optional[datetime], str]:
        revision = latest_revision_by_item_id.get(item_id_value)
        if revision and revision[1] is not None:
            return revision[1], "revision"
        return fallback_at, "version"

    def _revision_actor_payload(item_id_value: str) -> Optional[Dict[str, Any]]:
        revision = latest_revision_by_item_id.get(item_id_value)
        if revision:
            return _user_payload(actor_users.get(revision[0]))
        # Imported versions and legacy data may not have per-item revision rows.
        # In that case, the head version creator is the narrowest attribution we have.
        return _user_payload(actor_users.get(target.created_by_user_id or target.published_by_user_id))

    def _time_order(rows: Dict[str, Any], ids: Iterable[str]) -> list[str]:
        def key(item_id_value: str) -> tuple:
            when, _ = _changed_at(item_id_value)
            return (when or datetime.min, rows[item_id_value].index, item_id_value)

        return sorted(ids, key=key)

    added = _time_order(target_rows, set(target_rows) - set(base_rows))
    removed = _time_order(base_rows, set(base_rows) - set(target_rows))
    shared = set(base_rows) & set(target_rows)
    changed_ids = [
        item_id_key
        for item_id_key in shared
        if not (
            base_rows[item_id_key].fingerprint == target_rows[item_id_key].fingerprint
            and (base_rows[item_id_key].labels or []) == (target_rows[item_id_key].labels or [])
        )
    ]
    changed_ids = _time_order(target_rows, changed_ids)
    unchanged = sorted(shared - set(changed_ids), key=lambda item_id_value: (target_rows[item_id_value].index, item_id_value))

    def _timing(item_id_value: str) -> Dict[str, Any]:
        when, source = _changed_at(item_id_value)
        return {"changed_at": to_api_timestamp(when), "changed_at_source": source}

    want_diffs = bool(include_diffs)
    paged = want_diffs and limit is not None
    lists = {"changed": changed_ids, "added": added, "removed": removed, "unchanged": unchanged}

    def _window(kind_name: str) -> list[str]:
        ids = lists[kind_name]
        if not want_diffs or (paged and kind_name != page_kind):
            return []
        return ids[offset : offset + limit] if paged else ids

    # Full rows only for the item IDs whose bodies are returned. Without paging
    # every changed item lists its changed fields, as callers always had.
    changed_bodies = set(_window("changed")) if paged else set(changed_ids)
    need_base = changed_bodies | set(_window("removed"))
    # Unchanged bodies are returned only as a page (``unchanged_items``).
    need_target = changed_bodies | set(_window("added")) | (set(_window("unchanged")) if paged else set())

    def _full(version_id: str, wanted: set[str]) -> Dict[str, DatasetItem]:
        if not wanted:
            return {}
        return {
            item.item_id: item
            for item in db.query(DatasetItem).filter(
                DatasetItem.dataset_version_id == version_id, DatasetItem.item_id.in_(wanted)
            )
        }

    base_full = _full(base_version.id, need_base)
    target_full = _full(target.id, need_target)

    changed = []
    field_diffs: list[Dict[str, Any]] = []
    changed_window = set(_window("changed"))
    # A paged response carries only its page: changed entries are built for
    # the changed window alone, so its size follows ``limit``, not the diff.
    for item_id_key in (_window("changed") if paged else changed_ids):
        b_row = base_rows[item_id_key]
        t_row = target_rows[item_id_key]
        entry: Dict[str, Any] = {
            "item_id": item_id_key,
            "base_index": b_row.index,
            "target_index": t_row.index,
            "edited_by": _revision_actor_payload(item_id_key),
            **_timing(item_id_key),
        }
        b = base_full.get(item_id_key)
        t = target_full.get(item_id_key)
        if b is None or t is None:
            # Outside the returned page: the changed fields need the bodies, so
            # a paged compare lists them only for the diffs it returns.
            changed.append(entry)
            continue
        fields = []
        # Type-strict, so "51" -> 51 (or 1 -> true) is reported as a change.
        if not _same_json(b.input, t.input):
            fields.append("input")
        if not _same_json(b.expected_output, t.expected_output):
            fields.append("expected_output")
        if not _same_json(b.item_metadata or {}, t.item_metadata or {}):
            fields.append("metadata")
        if (b.labels or []) != (t.labels or []):
            fields.append("labels")
        entry["fields"] = fields
        changed.append(entry)
        if want_diffs and item_id_key in changed_window:
            field_diffs.append(
                dict(
                    entry,
                    before={
                        "input": b.input,
                        "expected_output": b.expected_output,
                        "metadata": b.item_metadata or {},
                        "labels": b.labels or [],
                    },
                    after={
                        "input": t.input,
                        "expected_output": t.expected_output,
                        "metadata": t.item_metadata or {},
                        "labels": t.labels or [],
                    },
                )
            )
    response: Dict[str, Any] = {
        "base": _version_payload(db, base_version),
        "target": _version_payload(db, target),
        "summary": {"added": len(added), "removed": len(removed), "changed": len(changed_ids), "unchanged": len(unchanged)},
    }
    if not paged:
        response.update(
            added=added,
            removed=removed,
            changed=changed,
            unchanged=unchanged,
            timestamps={
                item_id_key: _timing(item_id_key)
                for item_id_key in list(added) + list(removed)
            },
        )
    if want_diffs:
        response["added_items"] = [
            _item_payload(target_full[i]) | _timing(i) for i in _window("added") if i in target_full
        ]
        response["removed_items"] = [
            _item_payload(base_full[i]) | _timing(i) for i in _window("removed") if i in base_full
        ]
        response["field_diffs"] = field_diffs
        if paged:
            response["unchanged_items"] = [_item_payload(target_full[i]) for i in _window("unchanged") if i in target_full]
            total = len(lists[page_kind])
            response["page"] = {
                "kind": page_kind,
                "offset": offset,
                "limit": limit,
                "total": total,
                "next_offset": offset + limit if offset + limit < total else None,
            }
    return response


@router.post("/v1/datasets:upload")
async def upload_dataset(
    name: str = Form(...),
    project_slug: Optional[str] = Form(default=None),
    version: str = Form(default=""),
    version_name: str = Form(default=""),
    description: str = Form(default=""),
    tags: str = Form(default=""),
    labels: str = Form(default=""),
    publish: bool = Form(default=False),
    set_alias: Optional[str] = Form(default=None),
    input_col: str = Form(default="input"),
    expected_col: str = Form(default="expected_output"),
    input_cols: str = Form(default=""),
    expected_cols: str = Form(default=""),
    id_col: Optional[str] = Form(default=None),
    metadata_cols: str = Form(default=""),
    label_cols: str = Form(default=""),
    upload_format: str = Form(default="", alias="format"),
    encoding: str = Form(default=""),
    create_only: bool = Form(default=False),
    dataset_ref: Optional[str] = Form(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    """Upload a file as a new dataset, or as a new version of an existing one.

    - ``dataset_ref``: add the file as a new version of exactly that dataset.
    - ``create_only``: always create a new dataset; 409 if the name or slug is taken.
    - neither (SDK/CI default): append to the dataset with the same name or slug,
      otherwise create it. A different name that only shares the slug is a 409.
    """
    _require_scope(principal, "datasets:write")
    project = _project_for_request(db, principal, project_slug, write=True)
    clean_name = (name or "").strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Dataset name is required")
    slug = _slugify(clean_name)
    if dataset_ref:
        dataset: Optional[Dataset] = _get_dataset(db, project, dataset_ref)
    else:
        dataset = _dataset_for_upload(db, project, clean_name, slug)
        if dataset and create_only:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"A dataset named '{dataset.name}' already exists (slug '{dataset.slug}'). "
                    "Choose another name, or upload the file as a new version of that dataset."
                ),
            )
    if dataset and publish and set_alias:
        # Refuse before anything is written: an upload must not move production for a member.
        _require_alias_permission(db, principal, dataset, set_alias)
    if not dataset:
        _free_slug_from_deleted(db, project, slug)
        dataset = Dataset(id=str(uuid4()), project_id=project.id, name=clean_name, slug=slug, description=description, tags=_labels(tags), created_by_user_id=principal.user.id, created_at=utc_now_naive(), updated_at=utc_now_naive())
        db.add(dataset)
        db.flush()
    # New-style callers (the dashboard) send the multi-column params input_cols/expected_cols,
    # where an empty expected_cols genuinely means "no expected output". Legacy callers (the SDK)
    # send the single-column input_col/expected_col, which carry the historical defaults.
    if input_cols:
        input_columns = _labels(input_cols)
        expected_columns = _labels(expected_cols)
    else:
        input_columns = [input_col] if input_col else []
        expected_columns = [expected_col] if expected_col else []
    raw = await file.read()
    filename = file.filename or ""
    source_type = _upload_format(upload_format, filename, raw)
    used_encoding: Optional[str] = None
    if source_type == "jsonl":
        items = _items_from_jsonl(raw)
    elif source_type == "json":
        items = _items_from_json(raw)
    else:
        items, used_encoding = _items_from_csv(
            raw,
            input_cols=input_columns,
            expected_cols=expected_columns,
            id_col=id_col,
            metadata_cols=_labels(metadata_cols),
            label_cols=_labels(label_cols),
            encoding=encoding or None,
        )
    version_label, display_name = _version_identity(db, dataset, version, version_name)
    schema = {"input_cols": input_columns, "expected_cols": expected_columns, "id_col": id_col, "metadata_cols": _labels(metadata_cols), "label_cols": _labels(label_cols)}
    if used_encoding:
        schema["encoding"] = used_encoding
    version_row = DatasetVersion(
        id=str(uuid4()),
        dataset_id=dataset.id,
        version=version_label,
        name=display_name,
        description=description,
        status=DatasetVersionStatus.DRAFT,
        source_type=source_type,
        source_uri=filename,
        labels=_labels(labels),
        schema=schema,
        created_by_user_id=principal.user.id,
        created_at=utc_now_naive(),
        updated_at=utc_now_naive(),
    )
    db.add(version_row)
    db.flush()
    _insert_items(db, version_row, items)
    _record_change(
        db, version_row, {"type": "uploaded", "source_type": source_type, "item_count": len(items)}, actor_user_id=principal.user.id
    )
    if publish:
        inserted = db.query(DatasetItem).filter(DatasetItem.dataset_version_id == version_row.id).all()
        version_row.status = DatasetVersionStatus.PUBLISHED
        version_row.published_by_user_id = principal.user.id
        version_row.published_at = utc_now_naive()
        version_row.content_hash = _content_hash(inserted)
        _audit(db, principal, "dataset.version_published", dataset, after={"version": version_row.version, "item_count": len(inserted)})
        _store_published_counts(db, version_row)
        if set_alias:
            _set_alias(db, dataset, set_alias, version_row, principal)
    db.commit()
    return {"dataset": _dataset_payload(db, dataset, principal), "version": _version_payload(db, version_row)}


@router.get("/v1/datasets/{dataset_ref}/versions/{version_ref}:download")
def download_version(
    dataset_ref: str,
    version_ref: str,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Response:
    _require_scope(principal, "datasets:read")
    project = _project_for_request(db, principal, project_slug)
    dataset = _get_dataset(db, project, dataset_ref)
    version = _resolve_version(db, dataset, version_ref)
    items = db.query(DatasetItem).filter(DatasetItem.dataset_version_id == version.id).order_by(DatasetItem.index).all()
    lines = [
        json.dumps(
            {
                "item_id": item.item_id,
                "input": item.input,
                "expected_output": item.expected_output,
                "metadata": item.item_metadata or {},
                "labels": item.labels or [],
            },
            ensure_ascii=False,
        )
        for item in items
    ]
    filename = f"{dataset.slug}-{version.version}.jsonl"
    return Response(
        "\n".join(lines) + ("\n" if lines else ""),
        media_type="application/x-ndjson",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/v1/datasets/{dataset_ref}/versions/{version_ref}")
def get_version(
    dataset_ref: str,
    version_ref: str,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:read")
    project = _project_for_request(db, principal, project_slug)
    dataset = _get_dataset(db, project, dataset_ref)
    version = _resolve_version(db, dataset, version_ref)
    return {"dataset": _dataset_payload(db, dataset), "version": _version_payload(db, version)}


@router.get("/api/datasets/{dataset_ref}/versions/{version_ref}/items/{item_id}/revisions")
def item_revisions(
    dataset_ref: str,
    version_ref: str,
    item_id: str,
    project_slug: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(dataset_principal),
) -> Dict[str, Any]:
    _require_scope(principal, "datasets:read")
    project = _project_for_request(db, principal, project_slug)
    dataset = _get_dataset(db, project, dataset_ref)
    version = _resolve_version(db, dataset, version_ref)
    item = db.query(DatasetItem).filter(DatasetItem.dataset_version_id == version.id, DatasetItem.item_id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Dataset item not found")
    rows = (
        db.query(DatasetItemRevision)
        .filter(DatasetItemRevision.dataset_version_id == version.id, DatasetItemRevision.dataset_item_id == item.id)
        .order_by(DatasetItemRevision.revision_number.desc())
        .all()
    )
    actor_ids = {row.actor_user_id for row in rows if row.actor_user_id}
    actors: Dict[str, Dict[str, Any]] = {}
    if actor_ids:
        for user in db.query(User.id, User.email, User.display_name).filter(User.id.in_(actor_ids)).all():
            actors[user.id] = {"email": user.email, "name": user.display_name}
    return {
        "revisions": [
            {
                "id": row.id,
                "revision_number": row.revision_number,
                "change_type": row.change_type,
                "before": row.before,
                "after": row.after,
                "actor_user_id": row.actor_user_id,
                "actor_email": actors.get(row.actor_user_id, {}).get("email"),
                "actor_name": actors.get(row.actor_user_id, {}).get("name"),
                "created_at": to_api_timestamp(row.created_at),
            }
            for row in rows
        ]
    }
