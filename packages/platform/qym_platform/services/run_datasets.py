"""Union runs: the dataset versions one run evaluated (migration 0089).

A run that evaluated two or more dataset versions has one ``run_datasets`` row per
entry, ``runs.dataset_count = n`` and a ``run_items.dataset_position`` per item. A
single-dataset run has no rows (``dataset_count = 1``); readers synthesise its one
entry from ``Run.dataset``, ``dataset_id`` and ``dataset_version_id``.

This module owns the entry validation (limits, duplicates), the id resolution of an
upload, the rows' creation, the batched read payloads and the SQL clauses other
modules use to find the runs that touch a dataset version.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Sequence

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import exists, or_
from sqlalchemy.orm import Session

from qym_platform.db.models import (
    Dataset,
    DatasetAlias,
    DatasetVersion,
    Run,
    RunDataset,
)

MAX_RUN_DATASETS = 50
MAX_DATASET_ROW_COUNT = 100_000_000
_DEFAULT_ALIAS = "production"


class RunDatasetEntry(BaseModel):
    """One dataset version of a union run, as the SDK uploads it."""

    dataset: str = Field(min_length=1, max_length=200)
    dataset_id: Optional[str] = Field(default=None, max_length=36)
    dataset_version_id: Optional[str] = Field(default=None, max_length=36)
    version: Optional[str] = Field(default=None, max_length=100)
    alias: Optional[str] = Field(default=None, max_length=100)
    items: Optional[int] = Field(default=None, ge=0, le=MAX_DATASET_ROW_COUNT)
    disabled_items: Optional[int] = Field(default=None, ge=0, le=MAX_DATASET_ROW_COUNT)


def validate_entries(
    entries: Optional[Sequence[RunDatasetEntry]],
) -> List[RunDatasetEntry]:
    """The entries of a request, or ``[]`` when it carries none; 422 on a bad list."""
    if not entries:
        return []
    if len(entries) > MAX_RUN_DATASETS:
        raise HTTPException(
            status_code=422, detail=f"at most {MAX_RUN_DATASETS} datasets per run"
        )
    seen: set = set()
    for entry in entries:
        key = (
            ("id", entry.dataset_version_id)
            if entry.dataset_version_id
            else ("name", entry.dataset, entry.version or entry.alias)
        )
        if key in seen:
            label = (
                entry.version
                or entry.alias
                or entry.dataset_version_id
                or _DEFAULT_ALIAS
            )
            raise HTTPException(
                status_code=422,
                detail=f"dataset {entry.dataset} {label} is listed twice",
            )
        seen.add(key)
    return list(entries)


def _project_dataset(
    db: Session, project_id: str, entry: RunDatasetEntry
) -> Optional[Dataset]:
    query = db.query(Dataset).filter(
        Dataset.project_id == project_id, Dataset.deleted_at.is_(None)
    )
    if entry.dataset_id:
        found = query.filter(Dataset.id == entry.dataset_id).first()
        if found is not None:
            return found
    return query.filter(
        (Dataset.slug == entry.dataset) | (Dataset.name == entry.dataset)
    ).first()


def resolve_entry_ids(
    db: Session, project_id: str, entries: Sequence[RunDatasetEntry]
) -> List[Dict[str, Optional[str]]]:
    """``{dataset_id, dataset_version_id}`` per entry, as the project knows them.

    Ids the project does not know become ``None`` (the name stays in the row, like a
    label-only dataset today); an entry without ids is looked up by name and version
    label or alias (``production`` when neither is given).
    """
    version_ids = {e.dataset_version_id for e in entries if e.dataset_version_id}
    known_versions: Dict[str, str] = {}
    if version_ids:
        for vid, did in (
            db.query(DatasetVersion.id, DatasetVersion.dataset_id)
            .join(Dataset, Dataset.id == DatasetVersion.dataset_id)
            .filter(DatasetVersion.id.in_(version_ids), Dataset.project_id == project_id)
        ):
            known_versions[vid] = did
    dataset_ids = {e.dataset_id for e in entries if e.dataset_id}
    known_datasets: set = set()
    if dataset_ids:
        known_datasets = {
            row[0]
            for row in db.query(Dataset.id).filter(
                Dataset.id.in_(dataset_ids), Dataset.project_id == project_id
            )
        }
    out: List[Dict[str, Optional[str]]] = []
    for entry in entries:
        dataset_id = entry.dataset_id if entry.dataset_id in known_datasets else None
        version_id = None
        if entry.dataset_version_id in known_versions:
            version_id = entry.dataset_version_id
            dataset_id = dataset_id or known_versions[version_id]
        elif not entry.dataset_version_id:
            dataset = _project_dataset(db, project_id, entry)
            if dataset is not None:
                if entry.version:
                    row = (
                        db.query(DatasetVersion.id)
                        .filter(
                            DatasetVersion.dataset_id == dataset.id,
                            DatasetVersion.version == entry.version,
                        )
                        .first()
                    )
                else:
                    row = (
                        db.query(DatasetAlias.dataset_version_id)
                        .filter(
                            DatasetAlias.dataset_id == dataset.id,
                            DatasetAlias.alias == (entry.alias or _DEFAULT_ALIAS),
                        )
                        .first()
                    )
                if row is not None:
                    dataset_id, version_id = dataset.id, row[0]
        out.append({"dataset_id": dataset_id, "dataset_version_id": version_id})
    return out


def store_run_datasets(
    db: Session,
    run: Run,
    entries: Sequence[RunDatasetEntry],
    resolved: Optional[Sequence[Dict[str, Optional[str]]]] = None,
) -> List[RunDataset]:
    """Set ``run.dataset_count`` and add one row per entry (two or more only).

    Idempotent: a run that already has ``dataset_count > 1`` is left alone, so a
    replayed ``run_started`` never duplicates rows.
    """
    entries = list(entries)
    if len(entries) < 2 or int(run.dataset_count or 1) > 1:
        return []
    ids = resolved if resolved is not None else resolve_entry_ids(db, run.project_id, entries)
    rows = []
    for position, (entry, resolved) in enumerate(zip(entries, ids)):
        row = RunDataset(
            run_id=run.id,
            position=position,
            dataset=entry.dataset,
            dataset_id=resolved["dataset_id"],
            dataset_version_id=resolved["dataset_version_id"],
            version=entry.version,
            alias=entry.alias,
            item_count=entry.items,
            disabled_count=entry.disabled_items,
        )
        db.add(row)
        rows.append(row)
    run.dataset_count = len(entries)
    if rows and rows[0].dataset_id and not run.dataset_id:
        run.dataset_id = rows[0].dataset_id
    if rows and rows[0].dataset_version_id and not run.dataset_version_id:
        run.dataset_version_id = rows[0].dataset_version_id
    return rows


def position_of(item_metadata: Any, dataset_count: int) -> Optional[int]:
    """The entry an item came from, read from its ``qym_dataset_index`` tag."""
    if dataset_count <= 1 or not isinstance(item_metadata, dict):
        return None
    value = item_metadata.get("qym_dataset_index")
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if 0 <= value < dataset_count else None


def run_has_version(version_id: Any):
    """SQL clause: the run evaluated ``version_id`` (as its first dataset or any entry)."""
    return or_(
        Run.dataset_version_id == version_id,
        exists().where(
            RunDataset.run_id == Run.id, RunDataset.dataset_version_id == version_id
        ),
    )


def runs_of_dataset(dataset_id: Any):
    """SQL clause: the run evaluated a version of ``dataset_id``."""
    return or_(
        Run.dataset_id == dataset_id,
        exists().where(RunDataset.run_id == Run.id, RunDataset.dataset_id == dataset_id),
    )


def entries_by_run(db: Session, run_ids: Iterable[str]) -> Dict[str, List[RunDataset]]:
    """The ``run_datasets`` rows of the given runs, in position order (one query)."""
    ids = list({rid for rid in run_ids})
    grouped: Dict[str, List[RunDataset]] = defaultdict(list)
    if not ids:
        return grouped
    for start in range(0, len(ids), 500):
        chunk = ids[start : start + 500]
        for row in (
            db.query(RunDataset)
            .filter(RunDataset.run_id.in_(chunk))
            .order_by(RunDataset.run_id, RunDataset.position)
        ):
            grouped[row.run_id].append(row)
    return grouped


def dataset_version_info(db: Session, version_ids: Iterable[str]) -> Dict[str, Dict[str, Any]]:
    """Version label, current aliases and live dataset slug per dataset version id.

    ``dataset_slug`` is set while the managed dataset exists (not soft-deleted), so a
    page can link to it. Aliases reflect what points at the version now.
    """
    ids = {vid for vid in version_ids if vid}
    if not ids:
        return {}
    versions = {
        v.id: v for v in db.query(DatasetVersion).filter(DatasetVersion.id.in_(ids)).all()
    }
    dataset_ids = {v.dataset_id for v in versions.values() if v.dataset_id}
    slugs = (
        {
            dataset_id: slug
            for dataset_id, slug in db.query(Dataset.id, Dataset.slug)
            .filter(Dataset.id.in_(dataset_ids), Dataset.deleted_at.is_(None))
            .all()
        }
        if dataset_ids
        else {}
    )
    aliases: Dict[str, List[str]] = defaultdict(list)
    for alias in (
        db.query(DatasetAlias).filter(DatasetAlias.dataset_version_id.in_(ids)).all()
    ):
        aliases[alias.dataset_version_id].append(alias.alias)
    info: Dict[str, Dict[str, Any]] = {}
    for vid in ids:
        v = versions.get(vid)
        info[vid] = {
            "dataset_version": v.version if v else None,
            "dataset_aliases": sorted(aliases.get(vid, [])),
            "dataset_slug": slugs.get(v.dataset_id) if v else None,
        }
    return info


def _live_dataset_slugs(db: Session, dataset_ids: Iterable[Optional[str]]) -> Dict[str, str]:
    ids = {d for d in dataset_ids if d}
    if not ids:
        return {}
    return {
        did: slug
        for did, slug in db.query(Dataset.id, Dataset.slug).filter(
            Dataset.id.in_(ids), Dataset.deleted_at.is_(None)
        )
    }


def datasets_for_runs(
    db: Session, runs: Sequence[Run], info: Dict[str, Dict[str, Any]]
) -> Dict[str, List[Dict[str, Any]]]:
    """The ``datasets`` list of each run's payload (QC-63).

    Always present: a single-dataset run returns one synthesised entry. ``info`` is
    ``api.runs._dataset_version_info_map`` for the runs' own version ids; the union
    members' versions are added here. Statements: a constant number whatever the
    number of runs (none extra when no run is a union run).
    """
    union = [r for r in runs if int(r.dataset_count or 1) > 1]
    rows = entries_by_run(db, [r.id for r in union]) if union else {}
    missing = {
        row.dataset_version_id
        for rs in rows.values()
        for row in rs
        if row.dataset_version_id and row.dataset_version_id not in info
    }
    if missing:
        info = {**info, **dataset_version_info(db, missing)}
    slugs = _live_dataset_slugs(
        db,
        [row.dataset_id for rs in rows.values() for row in rs]
        + [r.dataset_id for r in runs if int(r.dataset_count or 1) <= 1],
    )
    out: Dict[str, List[Dict[str, Any]]] = {}
    for run in runs:
        if int(run.dataset_count or 1) > 1 and rows.get(run.id):
            entries = []
            for row in rows[run.id]:
                version_info = info.get(row.dataset_version_id or "") or {}
                slug = slugs.get(row.dataset_id or "") or version_info.get("dataset_slug")
                # A dataset deleted after the run: its ids were set to NULL (or it
                # is in the Trash). A local file never had ids and no version.
                deleted = bool(
                    (row.dataset_id is None and row.version is not None)
                    or (row.dataset_id is not None and not slugs.get(row.dataset_id))
                )
                entries.append(
                    {
                        "position": row.position,
                        "dataset": row.dataset,
                        "dataset_id": row.dataset_id,
                        "dataset_slug": None if deleted else slug,
                        "dataset_version_id": row.dataset_version_id,
                        "version": row.version,
                        "aliases": list(version_info.get("dataset_aliases") or []),
                        "alias": row.alias,
                        "items": row.item_count,
                        "disabled_items": row.disabled_count,
                        "deleted": deleted,
                    }
                )
            out[run.id] = entries
            continue
        version_info = info.get(run.dataset_version_id or "") or {}
        deleted = bool(
            run.dataset_id is not None and not slugs.get(run.dataset_id)
        )
        out[run.id] = [
            {
                "position": 0,
                "dataset": run.dataset,
                "dataset_id": run.dataset_id,
                "dataset_slug": None if deleted else version_info.get("dataset_slug"),
                "dataset_version_id": run.dataset_version_id,
                "version": version_info.get("dataset_version"),
                "aliases": list(version_info.get("dataset_aliases") or []),
                "alias": None,
                "items": None,
                "disabled_items": None,
                "deleted": deleted,
            }
        ]
    return out
