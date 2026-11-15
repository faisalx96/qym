"""Pin the dataset version a launch means to the version it names.

A launch entry names a dataset with a version, an alias or nothing ("Latest version").
Until now only the version reached the Evaluation Service: an alias went as
``config.dataset_alias`` and "latest" as nothing at all, and the integration guide (v1.3
§4.2) lets a worker fill an unset ``dataset_version`` from its own ``EVAL_DATASET_VERSION``,
which then wins over the alias inside the SDK. On a service configured that way every
"latest" and every alias launch ran on the worker's default version.

So the platform resolves the entry when the experiment is launched and writes the version
into every job body (``evaluator.dataset_version`` / the ``datasets`` entries), the way a
user who picked that version explicitly would have:

- a version: kept as given;
- an alias: the version the alias points at now;
- nothing: the newest **published** version (``published_at``, then ``created_at``).

The experiment's stored spec keeps the entry as chosen (a clone resolves again), the job's
``params`` carry the chosen entry plus ``resolved_version``, and a retry reuses the pinned
body. An entry of a project dataset the platform cannot resolve (an unknown alias, no published
version) is sent untouched, as before, with a ``dataset_version_unresolved`` launch warning; a
name that is not a project dataset (a custom name the service knows) is sent untouched silently.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

from qym_platform.db.models import (
    Dataset,
    DatasetAlias,
    DatasetVersion,
    DatasetVersionStatus,
)
from qym_platform.log import get_logger
from sqlalchemy.orm import Session

logger = get_logger(__name__)

WARNING_UNRESOLVED = "dataset_version_unresolved"

PinKey = Tuple[str, Optional[str], Optional[str]]


@dataclass(frozen=True)
class Pin:
    """What one launch entry resolved to."""

    dataset: str
    version: Optional[str]
    alias: Optional[str]
    resolved_version: Optional[str]
    problem: Optional[str] = None  # why it stayed unresolved (user-facing)


def pin_key(entry: Mapping[str, Any]) -> PinKey:
    return (
        str(entry.get("dataset") or ""),
        entry.get("version") or None,
        entry.get("alias") or None,
    )


def scalar_entry(evaluator: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    """The single-dataset form of an evaluator as one entry (``None`` without a dataset)."""
    name = evaluator.get("dataset") if isinstance(evaluator, Mapping) else None
    if not isinstance(name, str) or not name:
        return None
    config = evaluator.get("config")
    alias = config.get("dataset_alias") if isinstance(config, Mapping) else None
    version = evaluator.get("dataset_version")
    return {
        "dataset": name,
        "version": version if isinstance(version, str) and version else None,
        "alias": alias if isinstance(alias, str) and alias else None,
    }


def _dataset_row(db: Session, project_id: str, name: str) -> Optional[Dataset]:
    query = db.query(Dataset).filter(
        Dataset.project_id == project_id, Dataset.deleted_at.is_(None)
    )
    row = query.filter(Dataset.name == name).first()
    if row is None:
        row = query.filter(Dataset.slug == name).first()
    return row


def _resolve(db: Session, project_id: str, entry: Mapping[str, Any]) -> Pin:
    name, version, alias = pin_key(entry)
    if version:
        return Pin(name, version, alias, version)
    dataset = _dataset_row(db, project_id, name)
    if dataset is None:
        # Not a project dataset (a custom name the service knows, a path): nothing to pin
        # and nothing to warn about; the entry goes as chosen, as it always did.
        return Pin(name, version, alias, None)
    if alias:
        row = (
            db.query(DatasetAlias)
            .filter(DatasetAlias.dataset_id == dataset.id, DatasetAlias.alias == alias)
            .first()
        )
        target = db.get(DatasetVersion, row.dataset_version_id) if row else None
        if target is None:
            return Pin(
                name,
                version,
                alias,
                None,
                f"“{name}” has no alias “{alias}”; the Evaluation Service resolves it.",
            )
        return Pin(name, version, alias, target.version)
    latest = (
        db.query(DatasetVersion)
        .filter(
            DatasetVersion.dataset_id == dataset.id,
            DatasetVersion.status == DatasetVersionStatus.PUBLISHED,
        )
        .order_by(
            DatasetVersion.published_at.desc().nullslast(),
            DatasetVersion.created_at.desc(),
        )
        .first()
    )
    if latest is None:
        return Pin(
            name,
            version,
            alias,
            None,
            f"“{name}” has no published version; the Evaluation Service resolves it.",
        )
    return Pin(name, version, alias, latest.version)


def pin_entries(
    db: Session, project_id: str, entries: Iterable[Mapping[str, Any]]
) -> Dict[PinKey, Pin]:
    """Resolve every distinct launch entry once. Never raises for an entry; see ``Pin.problem``."""
    out: Dict[PinKey, Pin] = {}
    for entry in entries:
        key = pin_key(entry)
        if not key[0] or key in out:
            continue
        try:
            out[key] = _resolve(db, project_id, entry)
        except Exception:  # noqa: BLE001 - a lookup failure must not block the launch
            logger.exception("dataset version pin failed for %s", key[0])
            out[key] = Pin(
                key[0],
                key[1],
                key[2],
                None,
                f"The version of “{key[0]}” could not be looked up; the Evaluation Service resolves it.",
            )
    return out


def pinned_entry(
    entry: Mapping[str, Any], pins: Mapping[PinKey, Pin]
) -> Dict[str, Any]:
    """The entry as the service receives it: the resolved version, no alias (they are exclusive)."""
    pin = pins.get(pin_key(entry))
    if pin is None or pin.resolved_version is None:
        return dict(entry)
    return {"dataset": pin.dataset, "version": pin.resolved_version}


def resolved_version_of(
    entry: Mapping[str, Any], pins: Mapping[PinKey, Pin]
) -> Optional[str]:
    pin = pins.get(pin_key(entry))
    return pin.resolved_version if pin else None


def unresolved_warnings(pins: Mapping[PinKey, Pin]) -> List[Dict[str, Any]]:
    """One ``dataset_version_unresolved`` launch warning per entry that stayed unresolved."""
    return [
        {"code": WARNING_UNRESOLVED, "dataset": pin.dataset, "message": pin.problem}
        for pin in pins.values()
        if pin.resolved_version is None and pin.problem
    ]


__all__ = (
    "Pin",
    "PinKey",
    "WARNING_UNRESOLVED",
    "pin_entries",
    "pin_key",
    "pinned_entry",
    "resolved_version_of",
    "scalar_entry",
    "unresolved_warnings",
)
