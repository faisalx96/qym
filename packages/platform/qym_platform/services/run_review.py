"""Run review workflow: locking, execution outcomes and transition history.

``runs.status`` shows the review state (SUBMITTED/APPROVED/REJECTED) while a
run is in review. The execution outcome it had when it was submitted is kept
on its approval row so withdrawing a decision restores it. Every transition is
appended to ``run_workflow_events`` and written to ``audit_logs``; nothing in
the review record is ever blanked. Reviews-page decisions on individual
diagnoses (review corrections) are audited here too.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from qym_platform.datetime_utils import to_api_timestamp, utc_now_naive
from qym_platform.db.models import (
    Approval,
    AuditLog,
    ReviewCorrection,
    Run,
    RunEvent,
    RunWorkflowEvent,
    RunWorkflowStatus,
    User,
)

# Statuses a run can be submitted from, and the execution outcomes a review
# can restore. REJECTED runs are resubmitted without re-running.
EXECUTION_OUTCOMES = frozenset({RunWorkflowStatus.COMPLETED, RunWorkflowStatus.FAILED})
SUBMITTABLE_STATUSES = EXECUTION_OUTCOMES | {RunWorkflowStatus.REJECTED}

# action -> audit_logs action name
AUDIT_ACTIONS = {
    "submit": "run.submitted",
    "approve": "run.approved",
    "reject": "run.rejected",
    "unapprove": "run.unapproved",
    "unreject": "run.unrejected",
}

_FINAL_STATUS = {
    "COMPLETED": RunWorkflowStatus.COMPLETED,
    "FAILED": RunWorkflowStatus.FAILED,
    "STOPPED": RunWorkflowStatus.STOPPED,
}


def lock_review_run(db: Session, run_id: str) -> Run:
    """Load an active run under a row lock; every transition checks state inside it.

    Ingest takes the same lock, so a transition and a runner batch for the run
    are serialized, and two reviewers cannot both act on the state they read.
    """
    run = (
        Run.active(db)
        .filter(Run.id == run_id)
        .with_for_update()
        .populate_existing()
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


def lock_approval(db: Session, run: Run) -> Optional[Approval]:
    return (
        db.query(Approval)
        .filter(Approval.run_id == run.id)
        .with_for_update()
        .populate_existing()
        .first()
    )


def state_conflict(run: Run, message: str) -> HTTPException:
    """409 carrying the run's current status for the caller to refresh."""
    status = run.status.value if run.status else ""
    return HTTPException(
        status_code=409,
        detail=f"{message} (run is {status})",
        headers={"X-Qym-Run-Status": status},
    )


def _as_status(value: Any) -> Optional[RunWorkflowStatus]:
    try:
        return RunWorkflowStatus(value) if value else None
    except ValueError:
        return None


def resolve_execution_outcome(
    db: Session, run: Run, approval: Optional[Approval]
) -> RunWorkflowStatus:
    """The execution outcome a review keeps and restores when it is withdrawn.

    Outside review runs.status is the execution outcome, and it can change
    between review rounds; inside review it is kept on the approval row.
    """
    if run.status in EXECUTION_OUTCOMES:
        return run.status
    stored = _as_status(approval.execution_status if approval else None)
    if stored is not None:
        return stored
    # Reviews started before outcomes were recorded: the runner's own
    # completion event is authoritative (same mapping as ingest).
    payload = (
        db.query(RunEvent.payload)
        .filter(RunEvent.run_id == run.id, RunEvent.type == "run_completed")
        .order_by(RunEvent.sequence.desc())
        .limit(1)
        .scalar()
    )
    if isinstance(payload, dict) and payload.get("final_status") is not None:
        return _FINAL_STATUS.get(str(payload["final_status"]), RunWorkflowStatus.FAILED)
    # Uploaded and imported runs have no event stream; they only exist complete.
    return RunWorkflowStatus.COMPLETED


def record_transition(
    db: Session,
    *,
    run: Run,
    action: str,
    from_status: RunWorkflowStatus,
    actor_user_id: Optional[str],
    comment: str = "",
    approval: Optional[Approval] = None,
    at: Optional[datetime] = None,
) -> RunWorkflowEvent:
    """Append one transition to the run's history and to the audit log."""
    at = at or utc_now_naive()
    to_status = run.status
    event = RunWorkflowEvent(
        run_id=run.id,
        action=action,
        from_status=from_status.value,
        to_status=to_status.value,
        actor_user_id=actor_user_id,
        comment=comment or "",
        created_at=at,
    )
    db.add(event)
    after: Dict[str, Any] = {"status": to_status.value, "comment": comment or ""}
    if approval is not None:
        after["decision"] = approval.decision.value if approval.decision else None
        after["decision_by_user_id"] = approval.decision_by_user_id
        after["execution_status"] = approval.execution_status
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action=AUDIT_ACTIONS[action],
            entity_type="run",
            entity_id=run.id,
            before={"status": from_status.value},
            after=after,
            created_at=at,
        )
    )
    return event


def keep_legacy_review(db: Session, run: Run, approval: Optional[Approval]) -> None:
    """Copy a pre-history review into the history before a transition rewrites it.

    Reviews started before ``run_workflow_events`` existed live only on the
    approval row, which the first recorded transition overwrites (a resubmit
    replaces the submission, a decision replaces the decision). Call this under
    the run lock, before changing the row, so that review stays on record.
    """
    if approval is None:
        return
    if (
        db.query(RunWorkflowEvent.id)
        .filter(RunWorkflowEvent.run_id == run.id)
        .limit(1)
        .scalar()
        is not None
    ):
        return
    for entry in _reconstructed_entries(approval, before=None):
        db.add(
            RunWorkflowEvent(
                run_id=run.id,
                action=entry["action"],
                from_status=entry["from_status"] or "",
                to_status=entry["to_status"],
                actor_user_id=entry["actor_user_id"],
                comment=entry["comment"],
                created_at=entry["at"] or utc_now_naive(),
                reconstructed=True,
            )
        )


def correction_review_state(correction: ReviewCorrection) -> Dict[str, Any]:
    """The reviewable fields of a review correction, for audit snapshots."""
    status = correction.status
    return {
        "status": getattr(status, "value", status),
        "is_active": bool(correction.is_active),
        "reviewed_by_user_id": correction.reviewed_by_user_id,
        "reviewed_at": to_api_timestamp(correction.reviewed_at),
        "review_comment": correction.review_comment or "",
        "run_id": correction.run_id,
        "item_id": correction.item_id,
        "metric_name": correction.metric_name,
        "pass_number": correction.pass_number,
    }


def audit_correction_review(
    db: Session,
    *,
    correction: ReviewCorrection,
    action: str,
    actor_user_id: Optional[str],
    before: Dict[str, Any],
) -> None:
    """Audit a Reviews-page decision (approve/reject/reset/delete)."""
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action="correction." + action,
            entity_type="review_correction",
            entity_id=str(correction.id),
            before=before,
            after=correction_review_state(correction),
            created_at=utc_now_naive(),
        )
    )


def _user_payload(user: Optional[User]) -> Optional[Dict[str, Any]]:
    if user is None:
        return None
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name or user.email.split("@")[0],
    }


def _reconstructed_entries(
    approval: Optional[Approval], *, before: Optional[datetime]
) -> List[Dict[str, Any]]:
    if approval is None:
        return []
    if before is not None and (
        approval.submitted_at is None or approval.submitted_at >= before
    ):
        return []
    entries: List[Dict[str, Any]] = [
        {
            "action": "submit",
            "from_status": None,
            "to_status": RunWorkflowStatus.SUBMITTED.value,
            "actor_user_id": approval.submitted_by_user_id,
            "comment": "",
            "at": approval.submitted_at,
            "recorded": False,
        }
    ]
    decided_before = before is None or (
        approval.decision_at is not None and approval.decision_at < before
    )
    if approval.decision is not None and decided_before:
        decision = approval.decision.value
        entries.append(
            {
                "action": "approve" if decision == "APPROVED" else "reject",
                "from_status": RunWorkflowStatus.SUBMITTED.value,
                "to_status": decision,
                "actor_user_id": approval.decision_by_user_id,
                "comment": approval.comment or "",
                "at": approval.decision_at,
                "recorded": False,
            }
        )
    return entries


def review_history(db: Session, run: Run) -> List[Dict[str, Any]]:
    """Oldest-first review timeline for one run."""
    events = (
        db.query(RunWorkflowEvent)
        .filter(RunWorkflowEvent.run_id == run.id)
        .order_by(RunWorkflowEvent.id.asc())
        .all()
    )
    entries: List[Dict[str, Any]] = [
        {
            "action": e.action,
            "from_status": e.from_status or None,
            "to_status": e.to_status,
            "actor_user_id": e.actor_user_id,
            "comment": e.comment or "",
            "at": e.created_at,
            "recorded": not e.reconstructed,
        }
        for e in events
    ]
    if not entries or entries[0]["action"] != "submit":
        # The review started before the history table existed and no
        # transition has copied it in yet (keep_legacy_review): prepend what
        # the approval row still knows, marked as reconstructed. A decision
        # recorded since then rewrote the row, so keep only an older one.
        first_at = entries[0]["at"] if entries else None
        approval = db.query(Approval).filter(Approval.run_id == run.id).first()
        entries = _reconstructed_entries(approval, before=first_at) + entries
    user_ids = {e["actor_user_id"] for e in entries if e["actor_user_id"]}
    users = (
        {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}
        if user_ids
        else {}
    )
    return [
        {
            "action": e["action"],
            "from_status": e["from_status"],
            "to_status": e["to_status"],
            "actor": _user_payload(users.get(e["actor_user_id"])),
            "comment": e["comment"],
            "at": to_api_timestamp(e["at"]) if e["at"] else None,
            "recorded": e["recorded"],
        }
        for e in entries
    ]
