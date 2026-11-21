"""Data factory routes: connect a dataset, its rule categories, rules, access and jobs.

``POST /api/projects/{project_slug}/factories`` connects a dataset the caller
may modify (one factory per dataset). A factory has its own access
(``services.data_factory.factory_access_levels``): ``view`` reads rules and
jobs, ``modify`` configures the factory, writes categories and rules and
starts jobs, ``approve`` makes rules official, ``manage`` (project managers
and admins) sets the access. Every write goes through
``require_project_writable`` first, so a Viewer (403, C033) and an archived
project (409) are refused; a non-member gets 404 "Project not found" like the
run routes. Jobs are queued here and run by the factory worker
(``services.data_factory.FactoryWorker``).
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Tuple
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from qym_platform.auth import Principal, require_ui_principal
from qym_platform.datetime_utils import to_api_timestamp, utc_now_naive
from qym_platform.db.models import (FACTORY_GRANT_LEVELS, DataFactory, Dataset,
                                    DatasetVersion, FactoryGrant, FactoryJob,
                                    FactoryJobKind, FactoryRule,
                                    FactoryRuleCategory, FactoryRuleLink,
                                    Project, ProjectLlmConnection,
                                    ProjectMembership, ProjectRole, User,
                                    UserRole)
from qym_platform.deps import get_db
from qym_platform.log import get_logger
from qym_platform.permissions import (can_view_dataset_items,
                                      dataset_access_level,
                                      dataset_level_at_least,
                                      has_project_access,
                                      project_for_read_by_slug,
                                      require_project_writable)
from qym_platform.services import data_factory as svc
from sqlalchemy import func, or_
from sqlalchemy import select as db_select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

logger = get_logger(__name__)

router = APIRouter()

FACTORY_ACCESS_DENIED_DETAIL = "You don't have access to this factory"
FACTORY_VIEW_ONLY_DETAIL = "You can view this factory but not change it"
FACTORY_APPROVE_DETAIL = "Only people with the approve level can make a rule official"
FACTORY_ACCESS_MANAGE_DETAIL = (
    "Only project managers and admins can change factory access"
)
FACTORY_DELETE_DETAIL = (
    "Only the person who connected the dataset or a project manager can disconnect it"
)
RULES_PAGE_MAX = 500
JOBS_PAGE_MAX = 100


# ── Request bodies ───────────────────────────────────────────────────────────


class CreateFactoryRequest(BaseModel):
    dataset_ref: str = Field(..., min_length=1, max_length=400)
    group_metadata_key: Optional[str] = Field(default=None, max_length=200)
    llm_connection_id: Optional[str] = Field(default=None, max_length=36)


class UpdateFactoryRequest(BaseModel):
    """Fields to change; an omitted field keeps its value, ``null`` clears the key or connection."""

    group_metadata_key: Optional[str] = Field(default=None, max_length=200)
    llm_connection_id: Optional[str] = Field(default=None, max_length=36)
    analysis_instructions: Optional[str] = Field(default=None, max_length=20_000)
    generation_instructions: Optional[str] = Field(default=None, max_length=20_000)


class CategoryWrite(BaseModel):
    key: Optional[str] = Field(default=None, max_length=100)
    name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=20_000)
    json_schema: Optional[Dict[str, Any]] = None


class CategoryPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=20_000)
    json_schema: Optional[Dict[str, Any]] = None
    position: Optional[int] = Field(default=None, ge=0, le=10_000)


class RuleWrite(BaseModel):
    """``category_id`` is the primary category (its schema binds the body); ``category_ids`` the further ones."""

    category_id: str = Field(..., min_length=1, max_length=36)
    category_ids: List[str] = Field(default_factory=list, max_length=50)
    kind: Literal["rule", "bridge"] = "rule"
    bridge_to_category_ids: List[str] = Field(default_factory=list, max_length=50)
    group_value: str = Field(default="", max_length=500)
    title: str = Field(..., min_length=1, max_length=300)
    description: str = Field(default="", max_length=20_000)
    body: Optional[Dict[str, Any]] = None


class RulePatch(BaseModel):
    category_id: Optional[str] = Field(default=None, min_length=1, max_length=36)
    category_ids: Optional[List[str]] = Field(default=None, max_length=50)
    kind: Optional[Literal["rule", "bridge"]] = None
    bridge_to_category_ids: Optional[List[str]] = Field(default=None, max_length=50)
    group_value: Optional[str] = Field(default=None, max_length=500)
    title: Optional[str] = Field(default=None, min_length=1, max_length=300)
    description: Optional[str] = Field(default=None, max_length=20_000)
    body: Optional[Dict[str, Any]] = None


class JobCreate(BaseModel):
    kind: Literal["analysis", "generation"]
    params: Dict[str, Any] = Field(default_factory=dict)


class GrantEntry(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=36)
    level: str = Field(..., min_length=1, max_length=16)


class AccessRequest(BaseModel):
    access_mode: str = Field(..., min_length=1, max_length=16)
    grants: List[GrantEntry] = Field(default_factory=list)


# ── Lookups and payloads ─────────────────────────────────────────────────────


def _factory_for_caller(
    db: Session,
    principal: Principal,
    factory_id: str,
    need: str = "view",
    *,
    write: bool = False,
) -> tuple[DataFactory, str]:
    """The factory and the caller's level; 404 to non-members, 403 below ``need``.

    ``write`` refuses a Viewer (403, C033) and an archived project (409) first,
    so those answers come before the factory's own level texts.
    """
    factory = db.get(DataFactory, factory_id)
    if factory is None:
        raise HTTPException(status_code=404, detail="Factory not found")
    if not has_project_access(db, principal, factory.project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    if write:
        require_project_writable(db, factory.project_id)
    level = svc.factory_access_level(db, principal, factory)
    if level == "none":
        raise HTTPException(status_code=403, detail=FACTORY_ACCESS_DENIED_DETAIL)
    if not svc.factory_level_at_least(level, need):
        detail = {
            "modify": FACTORY_VIEW_ONLY_DETAIL,
            "approve": FACTORY_APPROVE_DETAIL,
            "manage": FACTORY_ACCESS_MANAGE_DETAIL,
        }.get(need, FACTORY_VIEW_ONLY_DETAIL)
        raise HTTPException(status_code=403, detail=detail)
    return factory, level


def _user_brief(
    user: Optional[User], user_id: Optional[str]
) -> Optional[Dict[str, Any]]:
    if user is None:
        return {"id": user_id, "display_name": "", "email": ""} if user_id else None
    return {"id": user.id, "display_name": user.display_name or "", "email": user.email}


def _users_by_id(db: Session, user_ids: set) -> Dict[str, User]:
    ids = {u for u in user_ids if u}
    if not ids:
        return {}
    return {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()}


def _dataset_brief(dataset: Optional[Dataset]) -> Optional[Dict[str, Any]]:
    if dataset is None:
        return None
    return {
        "id": dataset.id,
        "name": dataset.name,
        "slug": dataset.slug,
        "deleted": dataset.deleted_at is not None,
    }


def _version_brief(version: Optional[DatasetVersion]) -> Optional[Dict[str, Any]]:
    if version is None:
        return None
    return {
        "id": version.id,
        "version": version.version,
        "name": version.name or "",
        "item_count": int(version.item_count or 0),
        "status": version.status.value if version.status else None,
        "published_at": to_api_timestamp(version.published_at),
    }


def _permissions(level: str, *, creator: bool) -> Dict[str, Any]:
    return {
        "access_level": level,
        "can_modify": svc.factory_level_at_least(level, "modify"),
        "can_approve": svc.factory_level_at_least(level, "approve"),
        "can_manage_access": level == "manage",
        "can_disconnect": level == "manage" or creator,
        "is_creator": creator,
    }


def _counts(db: Session, factory_ids: List[str]) -> Dict[str, Dict[str, int]]:
    out: Dict[str, Dict[str, int]] = {
        fid: {
            "categories": 0,
            "rules": 0,
            "official_rules": 0,
            "jobs": 0,
            "active_jobs": 0,
        }
        for fid in factory_ids
    }
    if not factory_ids:
        return out
    for fid, n in (
        db.query(FactoryRuleCategory.factory_id, func.count(FactoryRuleCategory.id))
        .filter(FactoryRuleCategory.factory_id.in_(factory_ids))
        .group_by(FactoryRuleCategory.factory_id)
    ):
        out[fid]["categories"] = int(n)
    for fid, official, n in (
        db.query(
            FactoryRule.factory_id, FactoryRule.official, func.count(FactoryRule.id)
        )
        .filter(FactoryRule.factory_id.in_(factory_ids))
        .group_by(FactoryRule.factory_id, FactoryRule.official)
    ):
        out[fid]["rules"] += int(n)
        if official:
            out[fid]["official_rules"] += int(n)
    for fid, status, n in (
        db.query(FactoryJob.factory_id, FactoryJob.status, func.count(FactoryJob.id))
        .filter(FactoryJob.factory_id.in_(factory_ids))
        .group_by(FactoryJob.factory_id, FactoryJob.status)
    ):
        out[fid]["jobs"] += int(n)
        if status in svc.FACTORY_ACTIVE_JOB_STATUSES:
            out[fid]["active_jobs"] += int(n)
    return out


def _factory_payload(
    db: Session,
    factory: DataFactory,
    *,
    level: str,
    principal: Principal,
    project: Project,
    dataset: Optional[Dataset],
    counts: Dict[str, int],
    users: Dict[str, User],
    connection: Optional[ProjectLlmConnection],
) -> Dict[str, Any]:
    creator = factory.created_by_user_id == principal.user.id
    return {
        "id": factory.id,
        "project_id": factory.project_id,
        "project_slug": project.slug,
        "dataset": _dataset_brief(dataset),
        "group_metadata_key": factory.group_metadata_key,
        "llm_connection": (
            {
                "id": connection.id,
                "name": connection.name,
                "model": connection.llm_model,
            }
            if connection
            else None
        ),
        "access_mode": factory.access_mode or "project",
        "analysis_instructions": factory.analysis_instructions or "",
        "generation_instructions": factory.generation_instructions or "",
        "created_by": _user_brief(
            users.get(factory.created_by_user_id), factory.created_by_user_id
        ),
        "last_analyzed_at": to_api_timestamp(factory.last_analyzed_at),
        "created_at": to_api_timestamp(factory.created_at),
        "updated_at": to_api_timestamp(factory.updated_at),
        "counts": counts,
        "permissions": _permissions(level, creator=creator),
    }


def _category_payload(
    category: FactoryRuleCategory, rule_count: int = 0
) -> Dict[str, Any]:
    return {
        "id": category.id,
        "factory_id": category.factory_id,
        "key": category.key,
        "name": category.name,
        "description": category.description or "",
        "json_schema": category.json_schema,
        "position": int(category.position or 0),
        "rule_count": rule_count,
        "created_at": to_api_timestamp(category.created_at),
        "updated_at": to_api_timestamp(category.updated_at),
    }


def _category_ref(
    category_id: str, categories: Dict[str, FactoryRuleCategory]
) -> Optional[Dict[str, Any]]:
    category = categories.get(category_id)
    return (
        {"id": category.id, "key": category.key, "name": category.name}
        if category
        else None
    )


def _rule_payload(
    rule: FactoryRule,
    *,
    categories: Dict[str, FactoryRuleCategory],
    users: Dict[str, User],
    extra: Optional[Dict[str, List[str]]] = None,
    bridges: Optional[Dict[str, List[str]]] = None,
) -> Dict[str, Any]:
    category = categories.get(rule.category_id)
    category_ids = [rule.category_id] + [
        c for c in (extra or {}).get(rule.id, []) if c != rule.category_id
    ]
    return {
        "id": rule.id,
        "factory_id": rule.factory_id,
        "category_id": rule.category_id,
        "category_key": category.key if category else None,
        "category_name": category.name if category else None,
        "categories": [
            ref for ref in (_category_ref(c, categories) for c in category_ids) if ref
        ],
        "kind": rule.kind or "rule",
        "bridge_to": (
            [
                ref
                for ref in (
                    _category_ref(c, categories)
                    for c in (bridges or {}).get(rule.id, [])
                )
                if ref
            ]
            if rule.kind == "bridge"
            else []
        ),
        "group_value": rule.group_value or "",
        "title": rule.title,
        "description": rule.description or "",
        "body": rule.body,
        "official": bool(rule.official),
        "source": rule.source or "agent",
        "evidence": list(rule.evidence or []),
        "job_id": rule.job_id,
        "created_by": _user_brief(
            users.get(rule.created_by_user_id), rule.created_by_user_id
        ),
        "approved_by": _user_brief(
            users.get(rule.approved_by_user_id), rule.approved_by_user_id
        ),
        "approved_at": to_api_timestamp(rule.approved_at),
        "created_at": to_api_timestamp(rule.created_at),
        "updated_at": to_api_timestamp(rule.updated_at),
    }


def _job_payload(
    job: FactoryJob,
    *,
    users: Dict[str, User],
    datasets: Dict[str, Dataset],
    include_log: bool = False,
) -> Dict[str, Any]:
    output = datasets.get(job.output_dataset_id or "")
    payload = {
        "id": job.id,
        "factory_id": job.factory_id,
        "kind": job.kind,
        "status": job.status,
        "params": dict(job.params or {}),
        "progress": dict(job.progress or {}),
        "error": job.error,
        "output_dataset": _dataset_brief(output),
        "requested_by": _user_brief(
            users.get(job.requested_by_user_id), job.requested_by_user_id
        ),
        "created_at": to_api_timestamp(job.created_at),
        "started_at": to_api_timestamp(job.started_at),
        "finished_at": to_api_timestamp(job.finished_at),
        "updated_at": to_api_timestamp(job.updated_at),
    }
    if include_log:
        payload["log"] = job.log or ""
    return payload


def _jobs_payload(
    db: Session, jobs: List[FactoryJob], include_log: bool = False
) -> List[Dict[str, Any]]:
    users = _users_by_id(db, {j.requested_by_user_id for j in jobs})
    ids = {j.output_dataset_id for j in jobs if j.output_dataset_id}
    datasets = (
        {d.id: d for d in db.query(Dataset).filter(Dataset.id.in_(ids)).all()}
        if ids
        else {}
    )
    return [
        _job_payload(j, users=users, datasets=datasets, include_log=include_log)
        for j in jobs
    ]


def _connection_options(db: Session, project_id: str) -> List[Dict[str, Any]]:
    rows = (
        db.query(ProjectLlmConnection)
        .filter(ProjectLlmConnection.project_id == project_id)
        .order_by(ProjectLlmConnection.is_default.desc(), ProjectLlmConnection.name)
        .all()
    )
    return [
        {
            "id": c.id,
            "name": c.name,
            "model": c.llm_model,
            "is_default": bool(c.is_default),
            "has_api_key": bool(c.llm_api_key_encrypted),
        }
        for c in rows
    ]


def _dataset_of(db: Session, factory: DataFactory) -> Optional[Dataset]:
    return db.get(Dataset, factory.dataset_id)


def _factory_categories(db: Session, factory_id: str) -> Dict[str, FactoryRuleCategory]:
    return {
        c.id: c
        for c in db.query(FactoryRuleCategory).filter(
            FactoryRuleCategory.factory_id == factory_id
        )
    }


def _one_rule_payload(db: Session, rule: FactoryRule) -> Dict[str, Any]:
    extra, bridges = svc.rule_category_map(db, [rule.id])
    users = _users_by_id(db, {rule.created_by_user_id, rule.approved_by_user_id})
    return _rule_payload(
        rule,
        categories=_factory_categories(db, rule.factory_id),
        users=users,
        extra=extra,
        bridges=bridges,
    )


def _rule_counts(db: Session, factory_id: str) -> Dict[str, int]:
    """Rules per category id, counting a rule in its primary and its further categories."""
    members: Dict[str, set[str]] = {}
    for rule_id, category_id in db.query(
        FactoryRule.id, FactoryRule.category_id
    ).filter(FactoryRule.factory_id == factory_id):
        members.setdefault(category_id, set()).add(rule_id)
    for rule_id, category_id in (
        db.query(FactoryRuleLink.rule_id, FactoryRuleLink.category_id)
        .join(FactoryRule, FactoryRule.id == FactoryRuleLink.rule_id)
        .filter(
            FactoryRule.factory_id == factory_id, FactoryRuleLink.role == "category"
        )
    ):
        members.setdefault(category_id, set()).add(rule_id)
    return {cid: len(ids) for cid, ids in members.items()}


def _links_or_422(
    db: Session,
    factory: DataFactory,
    *,
    primary: FactoryRuleCategory,
    category_ids: List[str],
    kind: str,
    bridge_ids: List[str],
) -> Tuple[List[str], List[str]]:
    """The further category ids and the bridge target ids of a rule, checked against the factory."""
    known = _factory_categories(db, factory.id)
    extra: List[str] = []
    for cid in category_ids:
        if cid not in known:
            raise HTTPException(status_code=422, detail="Unknown rule category")
        if cid != primary.id and cid not in extra:
            extra.append(cid)
    if kind != "bridge":
        return extra, []
    own = {primary.id, *extra}
    bridges: List[str] = []
    for cid in bridge_ids:
        if cid not in known:
            raise HTTPException(status_code=422, detail="Unknown rule category")
        if cid not in own and cid not in bridges:
            bridges.append(cid)
    if not bridges:
        raise HTTPException(
            status_code=422,
            detail="A bridge rule names at least one category it is not in",
        )
    return extra, bridges


def _set_links(
    db: Session, rule: FactoryRule, extra: List[str], bridges: List[str]
) -> None:
    db.query(FactoryRuleLink).filter(FactoryRuleLink.rule_id == rule.id).delete(
        synchronize_session=False
    )
    for cid in extra:
        db.add(
            FactoryRuleLink(
                id=str(uuid4()), rule_id=rule.id, category_id=cid, role="category"
            )
        )
    for cid in bridges:
        db.add(
            FactoryRuleLink(
                id=str(uuid4()), rule_id=rule.id, category_id=cid, role="bridge"
            )
        )


def _category_or_404(
    db: Session, factory: DataFactory, category_id: str
) -> FactoryRuleCategory:
    category = (
        db.query(FactoryRuleCategory)
        .filter(
            FactoryRuleCategory.id == category_id,
            FactoryRuleCategory.factory_id == factory.id,
        )
        .first()
    )
    if category is None:
        raise HTTPException(status_code=404, detail="Rule category not found")
    return category


def _rule_or_404(db: Session, factory: DataFactory, rule_id: str) -> FactoryRule:
    rule = (
        db.query(FactoryRule)
        .filter(FactoryRule.id == rule_id, FactoryRule.factory_id == factory.id)
        .first()
    )
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rule


def _job_or_404(db: Session, factory: DataFactory, job_id: str) -> FactoryJob:
    job = (
        db.query(FactoryJob)
        .filter(FactoryJob.id == job_id, FactoryJob.factory_id == factory.id)
        .first()
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _check_connection(
    db: Session, project_id: str, connection_id: Optional[str]
) -> Optional[str]:
    if not connection_id:
        return None
    conn = (
        db.query(ProjectLlmConnection)
        .filter(
            ProjectLlmConnection.id == connection_id,
            ProjectLlmConnection.project_id == project_id,
        )
        .first()
    )
    if conn is None:
        raise HTTPException(status_code=404, detail="LLM connection not found")
    return conn.id


def _clean_key(value: Optional[str]) -> Optional[str]:
    key = (value or "").strip()
    return key or None


# ── Factories ────────────────────────────────────────────────────────────────


@router.get("/api/projects/{project_slug}/factories")
def list_factories(
    project_slug: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """The project's connected datasets the caller may open, newest first."""
    project = project_for_read_by_slug(db, principal, project_slug)
    factories = (
        db.query(DataFactory)
        .filter(DataFactory.project_id == project.id)
        .order_by(DataFactory.created_at.desc(), DataFactory.id)
        .all()
    )
    levels = svc.factory_access_levels(db, principal, factories)
    visible = [f for f in factories if levels.get(f.id, "none") != "none"]
    counts = _counts(db, [f.id for f in visible])
    users = _users_by_id(db, {f.created_by_user_id for f in visible})
    dataset_ids = {f.dataset_id for f in visible}
    datasets = (
        {d.id: d for d in db.query(Dataset).filter(Dataset.id.in_(dataset_ids)).all()}
        if dataset_ids
        else {}
    )
    conn_ids = {f.llm_connection_id for f in visible if f.llm_connection_id}
    connections = (
        {
            c.id: c
            for c in db.query(ProjectLlmConnection)
            .filter(ProjectLlmConnection.id.in_(conn_ids))
            .all()
        }
        if conn_ids
        else {}
    )
    return {
        "project_id": project.id,
        "project_slug": project.slug,
        "connected_dataset_ids": sorted(f.dataset_id for f in factories),
        "factories": [
            _factory_payload(
                db,
                f,
                level=levels[f.id],
                principal=principal,
                project=project,
                dataset=datasets.get(f.dataset_id),
                counts=counts[f.id],
                users=users,
                connection=connections.get(f.llm_connection_id or ""),
            )
            for f in visible
        ],
    }


@router.post("/api/projects/{project_slug}/factories", status_code=201)
def connect_dataset(
    project_slug: str,
    req: CreateFactoryRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Connect a dataset the caller may modify; seeds the General rule category."""
    project = project_for_read_by_slug(db, principal, project_slug)
    require_project_writable(db, project.id)
    ref = req.dataset_ref.strip()
    dataset = (
        db.query(Dataset)
        .filter(
            Dataset.project_id == project.id,
            Dataset.deleted_at.is_(None),
            or_(Dataset.id == ref, Dataset.slug == ref, Dataset.name == ref),
        )
        .first()
    )
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    level = dataset_access_level(db, principal, dataset)
    if not dataset_level_at_least(level, "modify"):
        raise HTTPException(
            status_code=403,
            detail="You need the modify level on the dataset to connect it",
        )
    if dataset.private_test_set or not can_view_dataset_items(principal, dataset):
        raise HTTPException(
            status_code=422,
            detail="A private test set cannot be connected: its items would be sent to the model",
        )
    existing = (
        db.query(DataFactory).filter(DataFactory.dataset_id == dataset.id).first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=409, detail="This dataset is already connected to the factory"
        )
    now = utc_now_naive()
    factory = DataFactory(
        id=str(uuid4()),
        project_id=project.id,
        dataset_id=dataset.id,
        group_metadata_key=_clean_key(req.group_metadata_key),
        llm_connection_id=_check_connection(db, project.id, req.llm_connection_id),
        access_mode="project",
        created_by_user_id=principal.user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(factory)
    db.add(
        FactoryRuleCategory(
            id=str(uuid4()),
            factory_id=factory.id,
            key=svc.DEFAULT_CATEGORY_KEY,
            name=svc.DEFAULT_CATEGORY_NAME,
            description=svc.DEFAULT_CATEGORY_DESCRIPTION,
            json_schema=None,
            position=0,
            created_at=now,
            updated_at=now,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="This dataset is already connected to the factory"
        )
    logger.info(
        "Dataset %s connected to the factory %s by user %s",
        dataset.id,
        factory.id,
        principal.user.id,
    )
    return get_factory(factory.id, db=db, principal=principal)


@router.get("/api/factories/{factory_id}")
def get_factory(
    factory_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """One factory with its categories, the source version, the metadata keys and the connection choices."""
    factory, level = _factory_for_caller(db, principal, factory_id)
    project = db.get(Project, factory.project_id)
    dataset = _dataset_of(db, factory)
    counts = _counts(db, [factory.id])[factory.id]
    users = _users_by_id(db, {factory.created_by_user_id})
    connection = (
        db.get(ProjectLlmConnection, factory.llm_connection_id)
        if factory.llm_connection_id
        else None
    )
    categories = (
        db.query(FactoryRuleCategory)
        .filter(FactoryRuleCategory.factory_id == factory.id)
        .order_by(FactoryRuleCategory.position, FactoryRuleCategory.created_at)
        .all()
    )
    rule_counts = _rule_counts(db, factory.id)
    version = (
        svc.resolve_source_version(db, dataset)
        if dataset and dataset.deleted_at is None
        else None
    )
    keys = svc.metadata_key_choices(db, version.id) if version else []
    active = svc.active_job(db, factory.id)
    payload = _factory_payload(
        db,
        factory,
        level=level,
        principal=principal,
        project=project,
        dataset=dataset,
        counts=counts,
        users=users,
        connection=connection,
    )
    payload.update(
        {
            "categories": [
                _category_payload(c, rule_counts.get(c.id, 0)) for c in categories
            ],
            "source_version": _version_brief(version),
            "metadata_keys": keys,
            "llm_connections": (
                _connection_options(db, factory.project_id)
                if svc.factory_level_at_least(level, "modify")
                else []
            ),
            "active_job": _jobs_payload(db, [active])[0] if active else None,
            "generation_limits": {
                "max_layers": svc.MAX_LAYERS,
                "max_branching": svc.MAX_BRANCHING,
                "max_items": svc.MAX_ITEMS_PER_JOB,
                "defaults": dict(svc.GENERATION_DEFAULTS),
            },
        }
    )
    return payload


@router.patch("/api/factories/{factory_id}")
def update_factory(
    factory_id: str,
    req: UpdateFactoryRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Change the grouping key, the LLM connection or the agent instructions (modify level)."""
    factory, _level = _factory_for_caller(
        db, principal, factory_id, need="modify", write=True
    )
    sent = req.model_fields_set
    if "group_metadata_key" in sent:
        factory.group_metadata_key = _clean_key(req.group_metadata_key)
    if "llm_connection_id" in sent:
        factory.llm_connection_id = _check_connection(
            db, factory.project_id, req.llm_connection_id
        )
    if req.analysis_instructions is not None:
        factory.analysis_instructions = req.analysis_instructions.strip()
    if req.generation_instructions is not None:
        factory.generation_instructions = req.generation_instructions.strip()
    factory.updated_at = utc_now_naive()
    db.commit()
    return get_factory(factory.id, db=db, principal=principal)


@router.delete("/api/factories/{factory_id}")
def disconnect_dataset(
    factory_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Disconnect the dataset: its rules, categories and jobs go; generated datasets stay."""
    factory, level = _factory_for_caller(db, principal, factory_id, write=True)
    if level != "manage" and factory.created_by_user_id != principal.user.id:
        raise HTTPException(status_code=403, detail=FACTORY_DELETE_DETAIL)
    active = svc.active_job(db, factory.id)
    if active is not None:
        raise HTTPException(
            status_code=409, detail="A job is still running; cancel it first"
        )
    rule_ids = db_select(FactoryRule.id).where(FactoryRule.factory_id == factory.id)
    db.query(FactoryRuleLink).filter(
        FactoryRuleLink.rule_id.in_(rule_ids.scalar_subquery())
    ).delete(synchronize_session=False)
    for model in (FactoryRule, FactoryJob, FactoryRuleCategory, FactoryGrant):
        db.query(model).filter(model.factory_id == factory.id).delete(
            synchronize_session=False
        )
    db.delete(factory)
    db.commit()
    logger.info("Factory %s disconnected by user %s", factory_id, principal.user.id)
    return {"ok": True}


# ── Access ───────────────────────────────────────────────────────────────────


def _person(user: Optional[User]) -> Optional[Dict[str, Any]]:
    if not user:
        return None
    return {
        "id": user.id,
        "name": user.display_name or user.email.split("@")[0],
        "email": user.email,
    }


def _access_payload(db: Session, factory: DataFactory, level: str) -> Dict[str, Any]:
    members = {
        row.user_id: row.role
        for row in db.query(ProjectMembership.user_id, ProjectMembership.role)
        .join(User, User.id == ProjectMembership.user_id)
        .filter(
            ProjectMembership.project_id == factory.project_id, User.is_active.is_(True)
        )
    }
    grants = [
        g
        for g in db.query(FactoryGrant)
        .filter(FactoryGrant.factory_id == factory.id)
        .order_by(FactoryGrant.created_at, FactoryGrant.id)
        .all()
        if g.user_id in members
    ]
    users = _users_by_id(
        db, {g.user_id for g in grants} | {g.granted_by_user_id for g in grants}
    )
    rows = [
        {
            "user": _person(users.get(g.user_id)),
            "level": g.level,
            "granted_by": _person(users.get(g.granted_by_user_id)),
            "created_at": to_api_timestamp(g.created_at),
        }
        for g in grants
        if g.user_id in users
    ]
    can_manage = level == "manage"
    candidates: List[Dict[str, Any]] = []
    if can_manage:
        taken = {g.user_id for g in grants}
        pool = [
            uid
            for uid, role in members.items()
            if role != ProjectRole.MANAGER and uid not in taken
        ]
        for user in _users_by_id(db, set(pool)).values():
            if user.role != UserRole.ADMIN:
                candidates.append(_person(user))
        candidates.sort(key=lambda row: (row["name"].lower(), row["email"]))
    return {
        "access_mode": factory.access_mode or "project",
        "grants": rows,
        "can_manage_access": can_manage,
        "candidates": candidates,
        "your_level": level,
        "levels": list(FACTORY_GRANT_LEVELS),
    }


@router.get("/api/factories/{factory_id}/access")
def get_factory_access(
    factory_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Who can open, change and approve in this factory."""
    factory, level = _factory_for_caller(db, principal, factory_id)
    return _access_payload(db, factory, level)


@router.put("/api/factories/{factory_id}/access")
def update_factory_access(
    factory_id: str,
    req: AccessRequest,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Replace the access mode and the grant list (project managers and admins).

    ``approve`` grants count in both modes; ``view`` and ``modify`` grants
    matter in ``restricted`` mode and are kept while the mode is ``project``.
    """
    factory, level = _factory_for_caller(db, principal, factory_id, write=True)
    if level != "manage":
        raise HTTPException(status_code=403, detail=FACTORY_ACCESS_MANAGE_DETAIL)
    if req.access_mode not in ("project", "restricted"):
        raise HTTPException(
            status_code=422, detail="access_mode must be project or restricted"
        )
    seen: set[str] = set()
    for entry in req.grants:
        if entry.level not in ("view", "modify", "approve"):
            raise HTTPException(
                status_code=422, detail="level must be view, modify or approve"
            )
        if entry.user_id in seen:
            raise HTTPException(
                status_code=422, detail=f"Duplicate grant for user {entry.user_id}"
            )
        seen.add(entry.user_id)
    member_ids = {
        row[0]
        for row in db.query(ProjectMembership.user_id)
        .join(User, User.id == ProjectMembership.user_id)
        .filter(
            ProjectMembership.project_id == factory.project_id,
            ProjectMembership.user_id.in_(seen or [""]),
            User.is_active.is_(True),
        )
    }
    for entry in req.grants:
        if entry.user_id not in member_ids:
            raise HTTPException(
                status_code=422,
                detail=f"User {entry.user_id} is not an active member of this project",
            )
    existing = {
        g.user_id: g
        for g in db.query(FactoryGrant)
        .filter(FactoryGrant.factory_id == factory.id)
        .all()
    }
    wanted = {entry.user_id: entry.level for entry in req.grants}
    now = utc_now_naive()
    for user_id, grant in existing.items():
        if user_id not in wanted:
            db.delete(grant)
        elif grant.level != wanted[user_id]:
            grant.level = wanted[user_id]
            grant.updated_at = now
    for user_id, grant_level in wanted.items():
        if user_id not in existing:
            db.add(
                FactoryGrant(
                    factory_id=factory.id,
                    user_id=user_id,
                    level=grant_level,
                    granted_by_user_id=principal.user.id,
                    created_at=now,
                    updated_at=now,
                )
            )
    factory.access_mode = req.access_mode
    factory.updated_at = now
    db.commit()
    logger.info(
        "Factory %s access set to %s with %d grants by user %s",
        factory.id,
        req.access_mode,
        len(wanted),
        principal.user.id,
    )
    return _access_payload(db, factory, level)


# ── Categories ───────────────────────────────────────────────────────────────


def _schema_or_422(schema: Any) -> Optional[Dict[str, Any]]:
    problem = svc.check_json_schema(schema)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    return schema


@router.post("/api/factories/{factory_id}/categories", status_code=201)
def create_category(
    factory_id: str,
    req: CategoryWrite,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Add a rule category: a name, a description for the agent and an optional strict JSON schema."""
    factory, _level = _factory_for_caller(
        db, principal, factory_id, need="modify", write=True
    )
    key = svc.slugify_key(req.key or req.name)
    if (
        db.query(FactoryRuleCategory)
        .filter(
            FactoryRuleCategory.factory_id == factory.id, FactoryRuleCategory.key == key
        )
        .first()
    ):
        raise HTTPException(
            status_code=409, detail=f"A category with the key '{key}' already exists"
        )
    position = (
        db.query(func.coalesce(func.max(FactoryRuleCategory.position), -1))
        .filter(FactoryRuleCategory.factory_id == factory.id)
        .scalar()
    )
    now = utc_now_naive()
    category = FactoryRuleCategory(
        id=str(uuid4()),
        factory_id=factory.id,
        key=key,
        name=req.name.strip(),
        description=req.description.strip(),
        json_schema=_schema_or_422(req.json_schema),
        position=int(position) + 1,
        created_at=now,
        updated_at=now,
    )
    db.add(category)
    factory.updated_at = now
    db.commit()
    return _category_payload(category, 0)


@router.patch("/api/factories/{factory_id}/categories/{category_id}")
def update_category(
    factory_id: str,
    category_id: str,
    req: CategoryPatch,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Change a category's name, description, schema or position; existing rules keep their bodies."""
    factory, _level = _factory_for_caller(
        db, principal, factory_id, need="modify", write=True
    )
    category = _category_or_404(db, factory, category_id)
    if req.name is not None:
        category.name = req.name.strip()
    if req.description is not None:
        category.description = req.description.strip()
    if "json_schema" in req.model_fields_set:
        category.json_schema = _schema_or_422(req.json_schema)
    if req.position is not None:
        category.position = req.position
    category.updated_at = utc_now_naive()
    factory.updated_at = category.updated_at
    db.commit()
    return _category_payload(category, _rule_counts(db, factory.id).get(category.id, 0))


@router.delete("/api/factories/{factory_id}/categories/{category_id}")
def delete_category(
    factory_id: str,
    category_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Remove a category and its rules; the last category cannot go."""
    factory, _level = _factory_for_caller(
        db, principal, factory_id, need="modify", write=True
    )
    category = _category_or_404(db, factory, category_id)
    total = (
        db.query(func.count(FactoryRuleCategory.id))
        .filter(FactoryRuleCategory.factory_id == factory.id)
        .scalar()
    )
    if int(total or 0) <= 1:
        raise HTTPException(
            status_code=409, detail="A factory keeps at least one rule category"
        )
    gone = [
        rid
        for (rid,) in db.query(FactoryRule.id).filter(
            FactoryRule.category_id == category.id
        )
    ]
    if gone:
        db.query(FactoryRuleLink).filter(FactoryRuleLink.rule_id.in_(gone)).delete(
            synchronize_session=False
        )
    # Rules linked to it as a further category or a bridge target lose that link; a bridge
    # left without a target becomes a plain rule.
    db.query(FactoryRuleLink).filter(FactoryRuleLink.category_id == category.id).delete(
        synchronize_session=False
    )
    removed = (
        db.query(FactoryRule)
        .filter(FactoryRule.category_id == category.id)
        .delete(synchronize_session=False)
    )
    still_bridged = {
        rid
        for (rid,) in db.query(FactoryRuleLink.rule_id).filter(
            FactoryRuleLink.role == "bridge"
        )
    }
    for rule in db.query(FactoryRule).filter(
        FactoryRule.factory_id == factory.id, FactoryRule.kind == "bridge"
    ):
        if rule.id not in still_bridged:
            rule.kind = "rule"
    db.delete(category)
    factory.updated_at = utc_now_naive()
    db.commit()
    return {"ok": True, "rules_removed": int(removed)}


# ── Rules ────────────────────────────────────────────────────────────────────


def _rule_filters(
    query: Any,
    *,
    group: Optional[str],
    category_id: Optional[str],
    kind: Optional[str],
    status: str,
    q: str,
) -> Any:
    if group is not None:
        query = query.filter(FactoryRule.group_value == group)
    if category_id:
        linked = (
            db_select(FactoryRuleLink.rule_id)
            .where(
                FactoryRuleLink.category_id == category_id,
                FactoryRuleLink.role == "category",
            )
            .scalar_subquery()
        )
        query = query.filter(
            or_(FactoryRule.category_id == category_id, FactoryRule.id.in_(linked))
        )
    if kind:
        query = query.filter(FactoryRule.kind == kind)
    if status == "official":
        query = query.filter(FactoryRule.official.is_(True))
    elif status == "proposed":
        query = query.filter(FactoryRule.official.is_(False))
    term = (q or "").strip().lower()
    if term:
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.filter(
            or_(
                func.lower(FactoryRule.title).like(pattern, escape="\\"),
                func.lower(FactoryRule.description).like(pattern, escape="\\"),
            )
        )
    return query


@router.get("/api/factories/{factory_id}/rules")
def list_rules(
    factory_id: str,
    response: Response,
    group: Optional[str] = Query(default=None, max_length=500),
    category_id: Optional[str] = Query(default=None, max_length=36),
    kind: Optional[Literal["rule", "bridge"]] = Query(default=None),
    status: Literal["all", "official", "proposed"] = Query(default="all"),
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=RULES_PAGE_MAX, ge=1, le=RULES_PAGE_MAX),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """The factory's rules, official first then newest, with the group and category totals of the whole factory."""
    factory, _level = _factory_for_caller(db, principal, factory_id)
    query = _rule_filters(
        db.query(FactoryRule).filter(FactoryRule.factory_id == factory.id),
        group=group,
        category_id=category_id,
        kind=kind,
        status=status,
        q=q,
    )
    total = query.order_by(None).count()
    response.headers["X-Qym-Total-Count"] = str(total)
    rules = (
        query.order_by(
            FactoryRule.official.desc(), FactoryRule.created_at.desc(), FactoryRule.id
        )
        .offset(offset)
        .limit(limit)
        .all()
    )
    categories = {
        c.id: c
        for c in db.query(FactoryRuleCategory).filter(
            FactoryRuleCategory.factory_id == factory.id
        )
    }
    users = _users_by_id(
        db,
        {r.created_by_user_id for r in rules} | {r.approved_by_user_id for r in rules},
    )
    extra, bridges = svc.rule_category_map(db, [r.id for r in rules])
    groups: Dict[str, Dict[str, int]] = {}
    for value, official, n in (
        db.query(
            FactoryRule.group_value, FactoryRule.official, func.count(FactoryRule.id)
        )
        .filter(FactoryRule.factory_id == factory.id)
        .group_by(FactoryRule.group_value, FactoryRule.official)
    ):
        row = groups.setdefault(value or "", {"count": 0, "official": 0})
        row["count"] += int(n)
        if official:
            row["official"] += int(n)
    return {
        "factory_id": factory.id,
        "total": total,
        "rules": [
            _rule_payload(
                r, categories=categories, users=users, extra=extra, bridges=bridges
            )
            for r in rules
        ],
        "groups": [
            {"value": value, **counts}
            for value, counts in sorted(
                groups.items(), key=lambda e: (e[0] == "", e[0])
            )
        ],
    }


def _rule_body_or_422(
    body: Any, category: FactoryRuleCategory
) -> Optional[Dict[str, Any]]:
    problem = svc.body_problem(body, category.json_schema)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    return body


@router.post("/api/factories/{factory_id}/rules", status_code=201)
def create_rule(
    factory_id: str,
    req: RuleWrite,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Write a rule by hand (non-official until approved)."""
    factory, _level = _factory_for_caller(
        db, principal, factory_id, need="modify", write=True
    )
    category = _category_or_404(db, factory, req.category_id)
    extra, bridges = _links_or_422(
        db,
        factory,
        primary=category,
        category_ids=req.category_ids,
        kind=req.kind,
        bridge_ids=req.bridge_to_category_ids,
    )
    now = utc_now_naive()
    rule = FactoryRule(
        id=str(uuid4()),
        factory_id=factory.id,
        category_id=category.id,
        group_value=req.group_value.strip()[:500],
        title=req.title.strip(),
        description=req.description.strip(),
        body=_rule_body_or_422(req.body, category),
        official=False,
        kind=req.kind,
        source="manual",
        evidence=[],
        created_by_user_id=principal.user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(rule)
    _set_links(db, rule, extra, bridges)
    factory.updated_at = now
    db.commit()
    return _one_rule_payload(db, rule)


@router.patch("/api/factories/{factory_id}/rules/{rule_id}")
def update_rule(
    factory_id: str,
    rule_id: str,
    req: RulePatch,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Edit a rule. An official rule edited by someone without the approve level goes back to non-official."""
    factory, level = _factory_for_caller(
        db, principal, factory_id, need="modify", write=True
    )
    rule = _rule_or_404(db, factory, rule_id)
    category = _category_or_404(db, factory, req.category_id or rule.category_id)
    current_extra, current_bridges = svc.rule_category_map(db, [rule.id])
    kind = req.kind or rule.kind or "rule"
    extra, bridges = _links_or_422(
        db,
        factory,
        primary=category,
        category_ids=(
            req.category_ids
            if req.category_ids is not None
            else current_extra.get(rule.id, [])
        ),
        kind=kind,
        bridge_ids=(
            req.bridge_to_category_ids
            if req.bridge_to_category_ids is not None
            else current_bridges.get(rule.id, [])
        ),
    )
    rule.kind = kind
    _set_links(db, rule, extra, bridges)
    if req.category_id is not None:
        rule.category_id = category.id
    if req.group_value is not None:
        rule.group_value = req.group_value.strip()[:500]
    if req.title is not None:
        rule.title = req.title.strip()
    if req.description is not None:
        rule.description = req.description.strip()
    if "body" in req.model_fields_set:
        rule.body = _rule_body_or_422(req.body, category)
    elif req.category_id is not None:
        _rule_body_or_422(rule.body, category)
    now = utc_now_naive()
    if rule.official and not svc.factory_level_at_least(level, "approve"):
        rule.official = False
        rule.approved_by_user_id = None
        rule.approved_at = None
    rule.updated_at = now
    factory.updated_at = now
    db.commit()
    return _one_rule_payload(db, rule)


def _set_official(
    db: Session, principal: Principal, factory_id: str, rule_id: str, official: bool
) -> Dict[str, Any]:
    factory, _level = _factory_for_caller(
        db, principal, factory_id, need="approve", write=True
    )
    rule = _rule_or_404(db, factory, rule_id)
    now = utc_now_naive()
    if official and not rule.official:
        rule.official = True
        rule.approved_by_user_id = principal.user.id
        rule.approved_at = now
    elif not official and rule.official:
        rule.official = False
        rule.approved_by_user_id = None
        rule.approved_at = None
    rule.updated_at = now
    factory.updated_at = now
    db.commit()
    return _one_rule_payload(db, rule)


@router.post("/api/factories/{factory_id}/rules/{rule_id}:approve")
def approve_rule(
    factory_id: str,
    rule_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Make a rule official (approve level)."""
    return _set_official(db, principal, factory_id, rule_id, True)


@router.post("/api/factories/{factory_id}/rules/{rule_id}:revoke")
def revoke_rule(
    factory_id: str,
    rule_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Take a rule's official status back (approve level)."""
    return _set_official(db, principal, factory_id, rule_id, False)


@router.delete("/api/factories/{factory_id}/rules/{rule_id}")
def delete_rule(
    factory_id: str,
    rule_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Remove a rule; an official rule needs the approve level."""
    factory, level = _factory_for_caller(
        db, principal, factory_id, need="modify", write=True
    )
    rule = _rule_or_404(db, factory, rule_id)
    if rule.official and not svc.factory_level_at_least(level, "approve"):
        raise HTTPException(status_code=403, detail=FACTORY_APPROVE_DETAIL)
    db.query(FactoryRuleLink).filter(FactoryRuleLink.rule_id == rule.id).delete(
        synchronize_session=False
    )
    db.delete(rule)
    factory.updated_at = utc_now_naive()
    db.commit()
    return {"ok": True}


# ── Jobs ─────────────────────────────────────────────────────────────────────


@router.get("/api/factories/{factory_id}/jobs")
def list_jobs(
    factory_id: str,
    limit: int = Query(default=20, ge=1, le=JOBS_PAGE_MAX),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """The factory's jobs, newest first."""
    factory, _level = _factory_for_caller(db, principal, factory_id)
    jobs = (
        db.query(FactoryJob)
        .filter(FactoryJob.factory_id == factory.id)
        .order_by(FactoryJob.created_at.desc(), FactoryJob.id)
        .limit(limit)
        .all()
    )
    return {"factory_id": factory.id, "jobs": _jobs_payload(db, jobs)}


@router.post("/api/factories/{factory_id}/jobs", status_code=202)
def start_job(
    factory_id: str,
    req: JobCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Queue a rule analysis or a data generation for the factory worker (one active job per factory)."""
    factory, _level = _factory_for_caller(
        db, principal, factory_id, need="modify", write=True
    )
    try:
        params = svc.validate_params(req.kind, req.params)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    dataset = _dataset_of(db, factory)
    if dataset is None or dataset.deleted_at is not None:
        raise HTTPException(status_code=409, detail="The connected dataset was deleted")
    if svc.resolve_source_version(db, dataset) is None:
        raise HTTPException(
            status_code=409,
            detail="The connected dataset has no published version to read",
        )
    try:
        svc.llm_connection_for(db, factory)
    except svc.FactoryConfigError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if req.kind == FactoryJobKind.GENERATION.value:
        rules = db.query(FactoryRule).filter(FactoryRule.factory_id == factory.id)
        if params.get("official_only"):
            rules = rules.filter(FactoryRule.official.is_(True))
        if rules.first() is None:
            raise HTTPException(
                status_code=409,
                detail=(
                    "No official rule to apply. Approve rules first, or allow non-official rules."
                    if params.get("official_only")
                    else "The factory has no rule to apply. Run the analysis first."
                ),
            )
    if svc.active_job(db, factory.id) is not None:
        raise HTTPException(
            status_code=409, detail="A job of this factory is already queued or running"
        )
    job = svc.queue_job(db, factory, req.kind, params, user_id=principal.user.id)
    db.commit()
    logger.info(
        "Factory %s: %s job %s queued by user %s",
        factory.id,
        req.kind,
        job.id,
        principal.user.id,
    )
    return _jobs_payload(db, [job], include_log=True)[0]


@router.get("/api/factories/{factory_id}/jobs/{job_id}")
def get_job(
    factory_id: str,
    job_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """One job with its log."""
    factory, _level = _factory_for_caller(db, principal, factory_id)
    job = _job_or_404(db, factory, job_id)
    return _jobs_payload(db, [job], include_log=True)[0]


@router.post("/api/factories/{factory_id}/jobs/{job_id}:cancel")
def cancel_job(
    factory_id: str,
    job_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Stop a queued or running job at its next batch; items already written stay."""
    factory, _level = _factory_for_caller(
        db, principal, factory_id, need="modify", write=True
    )
    job = _job_or_404(db, factory, job_id)
    if not svc.request_cancel(job):
        raise HTTPException(status_code=409, detail="The job has already finished")
    job.updated_at = utc_now_naive()
    db.commit()
    return _jobs_payload(db, [job], include_log=True)[0]
