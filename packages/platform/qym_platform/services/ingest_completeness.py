"""Incomplete-ingest flag: items that never arrived and events the platform refused.

A run can complete with fewer items than its client reported, or with events
the platform refused (schema errors, reused sequences, values the database
refuses). Refusals are tallied on the run as they happen, in
``run_metadata["ingest_rejected"]``, so a run completed by any SDK version is
flagged. Completion then sets ``run_metadata["ingest_incomplete"]``, which the
run page and the runs list show. A flagged run stays COMPLETED and can be
submitted for review.
"""

from __future__ import annotations

import hashlib
from typing import Any, Dict, Iterable, Optional

from qym_platform.db.models import Run
from qym_platform.services.run_lifecycle import (
    RUN_STATUS_REASON_LEASE_TIMEOUT,
    TERMINAL_RUN_STATUSES,
    is_run_force_stopped,
    is_run_in_review,
)

INGEST_INCOMPLETE_KEY = "ingest_incomplete"
INGEST_REJECTED_KEY = "ingest_rejected"
# Refused events named on the run; the count covers all of them.
MAX_NAMED_REJECTIONS = 10
# Short keys of recent refusals. A refused event is never stored, so a resend
# (a transport retry, or an SDK isolating a refused batch one event at a time)
# is refused again; remembering its key counts it once. Resends follow their
# refusal closely, so a bounded window of keys (about 10 KB) is enough.
MAX_REMEMBERED_REJECTIONS = 500
_NAMED_FIELDS = ("type", "item_id", "sequence", "event_id", "error")


def _count(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError, OverflowError):
        return 0


def _clean(value: Any) -> Any:
    # A refused event may carry the NUL the database refused (in its item id).
    return value.replace("\x00", "") if isinstance(value, str) else value


def _tally(metadata: Any) -> Dict[str, Any]:
    raw = metadata.get(INGEST_REJECTED_KEY) if isinstance(metadata, dict) else None
    return raw if isinstance(raw, dict) else {}


def rejected_event_count(metadata: Any) -> int:
    """Refused events of a run: the platform's tally, or the client's count if higher."""
    tally = _tally(metadata)
    return max(_count(tally.get("count")), _count(tally.get("reported")))


def _seen_key(row: Dict[str, Any], lines: Dict[int, str]) -> Optional[str]:
    """The event id, or for a line without one its text, as a short key."""
    identity = row.get("event_id")
    if not (isinstance(identity, str) and identity):
        text = lines.get(row.get("line"))  # type: ignore[arg-type]
        if not (isinstance(text, str) and text.strip()):
            return None
        identity = "line:" + text.strip()
    digest = hashlib.sha1(identity.encode("utf-8", "replace")).hexdigest()
    return digest[:16]


def record_rejected_events(
    run: Run,
    rows: Iterable[Dict[str, Any]],
    lines: Optional[Dict[int, str]] = None,
) -> bool:
    """Add refused events (``rejected_events`` rows) to the run's tally.

    ``lines`` maps line numbers to the text of lines refused before they had
    an event id (invalid JSON or envelope), so their resends count once too.
    Returns whether the tally changed. A reviewed run is frozen and is left
    alone; its refusals are still reported to the client.
    """
    rows = list(rows)
    if not rows or is_run_in_review(run):
        return False
    lines = lines or {}
    metadata = dict(run.run_metadata) if isinstance(run.run_metadata, dict) else {}
    tally = _tally(metadata)
    count = _count(tally.get("count"))
    named = [row for row in tally.get("events") or [] if isinstance(row, dict)]
    seen = [str(key) for key in tally.get("seen") or []]
    remembered = set(seen)
    changed = False
    for row in rows:
        key = _seen_key(row, lines)
        if key is not None:
            if key in remembered:
                continue
            remembered.add(key)
            seen.append(key)
        count += 1
        changed = True
        if len(named) < MAX_NAMED_REJECTIONS:
            named.append({key: _clean(row.get(key)) for key in _NAMED_FIELDS})
    if not changed:
        return False
    metadata[INGEST_REJECTED_KEY] = {
        **tally,
        "count": count,
        "events": named,
        "seen": seen[-MAX_REMEMBERED_REJECTIONS:],
    }
    run.run_metadata = metadata
    return True


def record_reported_rejections(run: Run, reported: Any) -> None:
    """Keep the client's own count of refused events (run_completed summary)."""
    reported = _count(reported)
    metadata = dict(run.run_metadata) if isinstance(run.run_metadata, dict) else {}
    tally = _tally(metadata)
    if reported <= _count(tally.get("reported")):
        return
    metadata[INGEST_REJECTED_KEY] = {**tally, "reported": reported}
    run.run_metadata = metadata


def public_run_metadata(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Run metadata for API responses, without the tally's remembered event ids."""
    tally = _tally(metadata)
    if "seen" not in tally:
        return metadata
    trimmed = {key: value for key, value in tally.items() if key != "seen"}
    return {**metadata, INGEST_REJECTED_KEY: trimmed}


def completed_by_client(run: Run) -> bool:
    """The client finished the run (run_completed), and it is not in review."""
    return (
        run.status in TERMINAL_RUN_STATUSES
        and run.status_reason != RUN_STATUS_REASON_LEASE_TIMEOUT
        and not is_run_force_stopped(run)
    )


def _describe_rejection(row: Dict[str, Any]) -> str:
    text = str(row.get("type") or "event")
    if row.get("item_id"):
        text += f" for item {row['item_id']}"
    elif row.get("sequence") is not None:
        text += f" #{row['sequence']}"
    return f"{text} ({row.get('error') or 'rejected'})"


def describe_ingest_flag(flag: Any) -> str:
    """One sentence per cause, naming the refused events the platform kept."""
    if not isinstance(flag, dict):
        return ""
    parts = []
    expected = _count(flag.get("expected_items"))
    received = _count(flag.get("received_items"))
    if expected and received < expected:
        parts.append(
            f"{expected - received} of {expected} items did not reach the platform."
        )
    rejected = _count(flag.get("rejected_events"))
    if rejected:
        named = [row for row in flag.get("rejected") or [] if isinstance(row, dict)]
        text = f"The platform rejected {rejected} event{'' if rejected == 1 else 's'}"
        if named:
            text += ": " + "; ".join(_describe_rejection(row) for row in named)
            if rejected > len(named):
                text += f"; and {rejected - len(named)} more"
        parts.append(text + ".")
    return " ".join(parts)


def ingest_incomplete_flag(
    metadata: Any, *, expected: Optional[int], received: int
) -> Optional[Dict[str, Any]]:
    """The ``ingest_incomplete`` value for a completed run, or None when complete."""
    rejected = rejected_event_count(metadata)
    missing = bool(expected and expected > 0 and received < expected)
    if not missing and not rejected:
        return None
    flag: Dict[str, Any] = {}
    if expected and expected > 0:
        flag["expected_items"] = int(expected)
        flag["received_items"] = int(received)
    if rejected:
        flag["rejected_events"] = rejected
        flag["rejected"] = [
            {key: row.get(key) for key in _NAMED_FIELDS}
            for row in _tally(metadata).get("events") or []
            if isinstance(row, dict)
        ][:MAX_NAMED_REJECTIONS]
        flag["reason"] = describe_ingest_flag(flag)
    return flag


def runs_list_ingest_flag(metadata: Any) -> Optional[Dict[str, Any]]:
    """Compact flag for runs list rows: counts and the reason sentence."""
    flag = metadata.get(INGEST_INCOMPLETE_KEY) if isinstance(metadata, dict) else None
    if not isinstance(flag, dict):
        return None
    expected = _count(flag.get("expected_items"))
    received = _count(flag.get("received_items"))
    missing = max(expected - received, 0) if expected else 0
    rejected = _count(flag.get("rejected_events"))
    if not missing and not rejected:
        return None
    return {
        "missing_items": missing,
        "rejected_events": rejected,
        "reason": describe_ingest_flag(flag),
    }
