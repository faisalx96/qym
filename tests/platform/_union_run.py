"""Builds a union run through the public events API (QC-90).

``seed_datasets`` adds datasets with published versions and items, ``post_union_run``
creates the run with ``POST /v1/runs`` and streams the tagged events the SDK sends, so
every read test starts from the rows the real ingest path writes.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Sequence
from uuid import uuid4

TOKEN = "union-token"


def auth(token: str = TOKEN) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def seed_api_key(session, *, user_id: str = "u", project_id: str = "p") -> str:
    from qym_platform.db.models import ApiKey
    from qym_platform.security import api_key_prefix, hash_api_key

    session.add(
        ApiKey(
            id="union-key",
            user_id=user_id,
            project_id=project_id,
            name="union",
            prefix=api_key_prefix(TOKEN),
            key_hash=hash_api_key(TOKEN),
            scopes=[],
        )
    )
    session.commit()
    return TOKEN


def seed_dataset(
    session,
    name: str,
    versions: Dict[str, Sequence[str]],
    *,
    aliases: Optional[Dict[str, str]] = None,
    project_id: str = "p",
    user_id: str = "u",
) -> Dict[str, Any]:
    """A dataset with published versions ``{label: [item ids]}`` and ``{alias: label}``."""
    from qym_platform.db.models import (
        Dataset,
        DatasetAlias,
        DatasetItem,
        DatasetVersion,
        DatasetVersionStatus,
    )

    dataset = Dataset(
        project_id=project_id, name=name, slug=name, created_by_user_id=user_id
    )
    session.add(dataset)
    session.flush()
    out: Dict[str, Any] = {"id": dataset.id, "name": name, "versions": {}, "items": {}}
    for label, item_ids in versions.items():
        version = DatasetVersion(
            dataset_id=dataset.id,
            version=label,
            status=DatasetVersionStatus.PUBLISHED,
            item_count=len(item_ids),
            created_by_user_id=user_id,
        )
        session.add(version)
        session.flush()
        out["versions"][label] = version.id
        out["items"][label] = {}
        for index, item_id in enumerate(item_ids):
            item = DatasetItem(
                dataset_version_id=version.id,
                item_id=item_id,
                index=index,
                input={"q": item_id},
                expected_output="a",
                item_metadata={},
                labels=[],
                fingerprint=uuid4().hex,
            )
            session.add(item)
            session.flush()
            out["items"][label][item_id] = item.id
    for alias, label in (aliases or {}).items():
        session.add(
            DatasetAlias(
                dataset_id=dataset.id,
                alias=alias,
                dataset_version_id=out["versions"][label],
                updated_by_user_id=user_id,
            )
        )
    session.commit()
    return out


def entry(
    seeded: Dict[str, Any], label: str, *, alias: Optional[str] = None
) -> Dict[str, Any]:
    ids = seeded["items"][label]
    return {
        "dataset": seeded["name"],
        "dataset_id": seeded["id"],
        "dataset_version_id": seeded["versions"][label],
        "version": label,
        "alias": alias,
        "items": len(ids),
        "disabled_items": 0,
    }


def namespaced(name: str, version: str, raw_id: str) -> str:
    return f"{name}@{version}/{raw_id}"


def post_union_run(
    client,
    seeded_entries: Sequence[Dict[str, Any]],
    *,
    token: str = TOKEN,
    metrics: Sequence[str] = ("exact_match",),
    score_for: Any = None,
    error_ids: Sequence[str] = (),
    tag: bool = True,
    send_datasets_on_create: bool = True,
    label: Optional[str] = None,
    external_run_id: Optional[str] = None,
) -> str:
    """Create a union run and stream every item with its tags; returns the run id.

    ``seeded_entries`` are ``(seeded dataset dict, version label)`` pairs wrapped by
    ``entry``; the items are those of ``seeded["items"][label]`` (needs the dict under
    the key ``"_seeded"``).
    """
    entries = [dict(e) for e in seeded_entries]
    clean = [{k: v for k, v in e.items() if not k.startswith("_")} for e in entries]
    run_label = label or " + ".join(f"{e['dataset']}@{e['version']}" for e in entries)
    body: Dict[str, Any] = {
        "external_run_id": external_run_id,
        "task": "answer-ticket",
        "model": "gpt-4o",
        "metrics": list(metrics),
        "dataset": run_label,
        "dataset_id": entries[0]["dataset_id"],
        "dataset_version_id": entries[0]["dataset_version_id"],
        "run_metadata": {"datasets": clean, "total_items": 0},
        "run_config": {},
    }
    if send_datasets_on_create and len(entries) >= 2:
        body["datasets"] = clean
    created = client.post("/v1/runs", headers=auth(token), json=body)
    assert created.status_code == 200, created.text
    run_id = created.json()["run_id"]
    lines: List[str] = []
    sequence = 0
    index = 0

    def event(kind: str, payload: Dict[str, Any]) -> None:
        nonlocal sequence
        sequence += 1
        lines.append(
            json.dumps(
                {
                    "schema_version": 1,
                    "event_id": str(uuid4()),
                    "sequence": sequence,
                    "sent_at": "2026-10-22T00:00:00Z",
                    "type": kind,
                    "run_id": run_id,
                    "payload": payload,
                }
            )
        )

    event(
        "run_started",
        {
            "task": "answer-ticket",
            "dataset": run_label,
            "model": "gpt-4o",
            "metrics": list(metrics),
            "started_at": "2026-10-22T00:00:00Z",
            **(
                {"datasets": clean}
                if len(entries) >= 2
                else {}
            ),
        },
    )
    for position, e in enumerate(entries):
        raw_ids = list(e["_items"])
        for raw in raw_ids:
            item_id = (
                namespaced(e["dataset"], e["version"], raw) if len(entries) >= 2 else raw
            )
            metadata = (
                {
                    "qym_dataset": e["dataset"],
                    "qym_dataset_version": e["version"],
                    "qym_dataset_index": position,
                    "qym_item_id": raw,
                    "qym_dataset_version_id": e["dataset_version_id"],
                }
                if tag and len(entries) >= 2
                else {}
            )
            event(
                "item_started",
                {
                    "item_id": item_id,
                    "index": index,
                    "input": {"q": raw},
                    "expected": "a",
                    "item_metadata": metadata,
                },
            )
            if raw in error_ids:
                event(
                    "item_failed",
                    {"item_id": item_id, "index": index, "error": "boom", "latency_ms": 5.0},
                )
            else:
                event(
                    "item_completed",
                    {
                        "item_id": item_id,
                        "index": index,
                        "output": "a",
                        "latency_ms": 10.0,
                    },
                )
                for metric in metrics:
                    value = score_for(position, raw, metric) if score_for else 1.0
                    event(
                        "metric_scored",
                        {
                            "item_id": item_id,
                            "metric_name": metric,
                            "score_numeric": value,
                            "score_raw": value,
                        },
                    )
            index += 1
    event("run_completed", {"ended_at": "2026-10-22T00:01:00Z", "summary": {}})
    response = client.post(
        f"/v1/runs/{run_id}/events",
        headers={**auth(token), "Content-Type": "application/x-ndjson"},
        content="\n".join(lines) + "\n",
    )
    assert response.status_code == 200, response.text
    assert response.json()["rejected"] == 0, response.json()
    return run_id


def with_items(seeded: Dict[str, Any], label: str, **kwargs: Any) -> Dict[str, Any]:
    """``entry`` plus the raw item ids ``post_union_run`` streams."""
    out = entry(seeded, label, **kwargs)
    out["_items"] = list(seeded["items"][label])
    return out
