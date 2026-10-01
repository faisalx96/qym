"""Lineage counts of dataset versions (added / modified / deleted / unchanged).

A version's counts compare its items with its parent's. Once both versions are
published their items never change, so the counts are computed once and stored
on ``dataset_versions.change_counts``; the Lineage tab then reads one column per
version instead of loading and diffing every item of every version per request.
Drafts (and a published version whose parent is still a draft) are computed on
read, and editing a draft clears the stored counts of its published children.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, Optional

from sqlalchemy.orm import Session

from qym_platform.db.models import DatasetItem, DatasetVersion, DatasetVersionStatus


def _is_published(version: Optional[DatasetVersion]) -> bool:
    if version is None:
        return False
    status = version.status.value if hasattr(version.status, "value") else str(version.status)
    return status == DatasetVersionStatus.PUBLISHED.value


def _item_rows(db: Session, version_id: str) -> Dict[str, tuple]:
    rows = db.query(
        DatasetItem.item_id,
        DatasetItem.fingerprint,
        DatasetItem.labels,
        DatasetItem.input,
        DatasetItem.expected_output,
        DatasetItem.item_metadata,
    ).filter(DatasetItem.dataset_version_id == version_id)
    return {row[0]: tuple(row[1:]) for row in rows}


def _changed(a: tuple, b: tuple) -> bool:
    fingerprint_a, labels_a, input_a, expected_a, metadata_a = a
    fingerprint_b, labels_b, input_b, expected_b, metadata_b = b
    return (
        fingerprint_a != fingerprint_b
        or (labels_a or []) != (labels_b or [])
        or input_a != input_b
        or expected_a != expected_b
        or (metadata_a or {}) != (metadata_b or {})
    )


def compute_change_counts(db: Session, version: DatasetVersion) -> Dict[str, int]:
    """Diff a version's items against its parent's (light columns only)."""
    if not version.parent_version_id:
        count = db.query(DatasetItem.id).filter(DatasetItem.dataset_version_id == version.id).count()
        return {"added": int(count), "modified": 0, "deleted": 0, "unchanged": 0}
    current = _item_rows(db, version.id)
    parent = _item_rows(db, version.parent_version_id)
    shared = current.keys() & parent.keys()
    modified = sum(1 for item_id in shared if _changed(parent[item_id], current[item_id]))
    return {
        "added": len(current.keys() - parent.keys()),
        "modified": modified,
        "deleted": len(parent.keys() - current.keys()),
        "unchanged": len(shared) - modified,
    }


def counts_are_final(version: DatasetVersion, parent: Optional[DatasetVersion]) -> bool:
    """Stored counts stay true only while neither side can change."""
    return _is_published(version) and (version.parent_version_id is None or _is_published(parent))


def store_change_counts(db: Session, version: DatasetVersion, parent: Optional[DatasetVersion] = None) -> Optional[Dict[str, int]]:
    """Compute and store the counts when they are final (call after publishing)."""
    if parent is None and version.parent_version_id:
        parent = db.get(DatasetVersion, version.parent_version_id)
    if not counts_are_final(version, parent):
        version.change_counts = None
        return None
    counts = compute_change_counts(db, version)
    version.change_counts = counts
    return counts


def change_counts_for(db: Session, versions: Iterable[DatasetVersion]) -> Dict[str, Dict[str, Any]]:
    """Counts per version id: stored when final, otherwise computed now."""
    versions = list(versions)
    by_id = {version.id: version for version in versions}
    result: Dict[str, Dict[str, Any]] = {}
    for version in versions:
        parent_id = version.parent_version_id
        parent = by_id.get(parent_id) if parent_id else None
        if parent_id and parent is None:
            parent = db.get(DatasetVersion, parent_id)
        stored = version.change_counts
        if isinstance(stored, dict) and counts_are_final(version, parent):
            result[version.id] = dict(stored)
        else:
            result[version.id] = compute_change_counts(db, version)
    return result


def invalidate_child_counts(db: Session, version: DatasetVersion) -> None:
    """A draft's items changed: counts of versions forked from it are stale."""
    db.query(DatasetVersion).filter(
        DatasetVersion.parent_version_id == version.id,
        DatasetVersion.change_counts.isnot(None),
    ).update({DatasetVersion.change_counts: None}, synchronize_session=False)
