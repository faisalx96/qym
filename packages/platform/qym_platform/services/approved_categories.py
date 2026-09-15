"""Publish newly approved labels without changing historical catalog versions."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from typing import Any, Iterable
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import func
from sqlalchemy.orm import Session

from qym_platform.datetime_utils import utc_now_naive
from qym_platform.db.models import (
    CorrectionStatus,
    Project,
    ProjectAnalysisCategoryCatalogVersion,
    ReviewCorrection,
)
from qym_platform.services.root_cause_categories import (
    DEFAULT_MAX_ROOT_CAUSE_CATEGORIES,
    DEFAULT_ROOT_CAUSE_TAXONOMY,
    normalize_category_taxonomy,
    normalize_root_cause_issues,
)


def category_catalog_hash(
    *,
    categories: list[str],
    category_entries: list[dict[str, str]],
    category_details_map: dict[str, list[str]],
    category_taxonomy: dict[str, dict[str, str]],
    max_root_cause_categories: int,
    subcategory_taxonomy: dict[str, dict[str, dict[str, str]]] | None = None,
) -> str:
    payload = dict(
        categories=categories,
        category_entries=category_entries,
        category_details_map=category_details_map,
        category_taxonomy=category_taxonomy,
        max_root_cause_categories=max_root_cause_categories,
    )
    if subcategory_taxonomy:
        payload["subcategory_taxonomy"] = subcategory_taxonomy
    return hashlib.sha256(
        json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")
    ).hexdigest()


def approved_catalog_values(
    project_id: str,
    prior: dict[str, Any] | None,
    evidence: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    """Append approved categories/details; retain manager edits and archived labels."""
    values = (
        deepcopy(prior)
        if prior is not None
        else {
            "categories": list(DEFAULT_ROOT_CAUSE_TAXONOMY),
            "category_entries": [],
            "category_details_map": {},
            "category_taxonomy": deepcopy(DEFAULT_ROOT_CAUSE_TAXONOMY),
            "subcategory_taxonomy": {},
            "max_root_cause_categories": DEFAULT_MAX_ROOT_CAUSE_CATEGORIES,
        }
    )
    categories = values["categories"]
    entries = values["category_entries"]
    by_fold = {label.casefold(): label for label in categories}
    archived = {
        entry["label"].casefold()
        for entry in entries
        if entry.get("status") == "archived"
    }
    details = values["category_details_map"]
    taxonomy = values["category_taxonomy"]
    for row in evidence:
        if row.get("status") != "approved" or not row.get("is_active"):
            continue
        issues = []
        for prefix in ("human", "ai"):
            issues = normalize_root_cause_issues(
                row.get(prefix + "_root_cause_issues"),
                legacy_root_causes=row.get(prefix + "_root_causes")
                or row.get(prefix + "_root_cause"),
                legacy_detail=row.get(prefix + "_root_cause_detail"),
                legacy_finding=row.get(prefix + "_root_cause_note"),
            )
            if issues:
                break
        learned = normalize_category_taxonomy(row.get("ai_category_taxonomy"))
        learned.update(normalize_category_taxonomy(row.get("human_category_taxonomy")))
        learned = {
            label.casefold(): definition for label, definition in learned.items()
        }
        for issue in issues:
            label = " ".join(issue["category"].split())[:200]
            key = label.casefold()
            if not label or key in archived:
                continue
            canonical = by_fold.get(key)
            if canonical is None:
                canonical = label
                categories.append(canonical)
                by_fold[key] = canonical
            definition = learned.get(key)
            if definition:
                existing = taxonomy.setdefault(canonical, {})
                for field, value in definition.items():
                    if not existing.get(field):
                        existing[field] = value
            detail = " ".join(str(issue.get("subcategory") or "").split())[:200]
            if detail:
                known = details.setdefault(canonical, [])
                if detail.casefold() not in {value.casefold() for value in known}:
                    known.append(detail)
    known_entries = {entry["label"].casefold(): entry for entry in entries}
    values["category_entries"] = [
        {
            "id": known_entries.get(label.casefold(), {}).get("id")
            or str(
                uuid5(NAMESPACE_URL, f"qym-category:{project_id}:{label.casefold()}")
            ),
            "label": label,
            "status": "active",
        }
        for label in categories
    ] + [entry for entry in entries if entry["label"].casefold() in archived]
    return values


CATALOG_FIELDS = (
    "categories",
    "category_entries",
    "category_details_map",
    "category_taxonomy",
    "subcategory_taxonomy",
    "max_root_cause_categories",
)
EVIDENCE_FIELDS = tuple(
    prefix + "_" + field
    for prefix in ("human", "ai")
    for field in (
        "root_cause_issues",
        "root_causes",
        "root_cause",
        "root_cause_detail",
        "root_cause_note",
        "category_taxonomy",
    )
)


def publish_approved_categories(
    db: Session,
    project_id: str,
    corrections: Iterable[ReviewCorrection],
    actor_user_id: str | None,
) -> None:
    evidence = [
        {
            **{field: getattr(row, field) for field in EVIDENCE_FIELDS},
            "status": "approved",
            "is_active": True,
        }
        for row in corrections
        if row.status == CorrectionStatus.APPROVED and row.is_active
    ]
    if not evidence:
        return
    # Serialize both approval publication and manual catalog saves by project.
    # Flush first because production sessions disable autoflush.
    db.flush()
    db.query(Project.id).filter(Project.id == project_id).with_for_update().one()
    current = (
        db.query(ProjectAnalysisCategoryCatalogVersion)
        .filter(
            ProjectAnalysisCategoryCatalogVersion.project_id == project_id,
            ProjectAnalysisCategoryCatalogVersion.is_active.is_(True),
        )
        .populate_existing()
        .order_by(ProjectAnalysisCategoryCatalogVersion.version.desc())
        .first()
    )
    prior = (
        {field: getattr(current, field) for field in CATALOG_FIELDS}
        if current
        else None
    )
    values = approved_catalog_values(project_id, prior, evidence)
    baseline = (
        prior if prior is not None else approved_catalog_values(project_id, None, [])
    )
    if values == baseline:
        return
    latest = (
        db.query(func.max(ProjectAnalysisCategoryCatalogVersion.version))
        .filter(
            ProjectAnalysisCategoryCatalogVersion.project_id == project_id,
        )
        .scalar()
        or 0
    )
    if current:
        current.is_active = False
    db.add(
        ProjectAnalysisCategoryCatalogVersion(
            project_id=project_id,
            version=latest + 1,
            **values,
            content_hash=category_catalog_hash(**values),
            source="approval",
            parent_version_id=current.id if current else None,
            is_active=True,
            created_by_user_id=actor_user_id,
            created_at=utc_now_naive(),
        )
    )
    db.flush()
