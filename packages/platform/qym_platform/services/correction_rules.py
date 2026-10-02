"""Who may decide a diagnosis correction (C074).

A project chooses who may approve, reject or reset its corrections
(``Project.correction_approvers``): every member (the default) or project
managers and platform admins only. It can also require a different reviewer
(``Project.correction_require_different_reviewer``, off by default): the
person who wrote a correction then cannot decide it.

Every route that approves, rejects or resets a correction calls
``require_correction_decision`` (single, bulk, the run page's metric-analysis
and issue approvals), so the rules hold for the API as well as the UI. The
Reviews page reads the same verdict through ``correction_decision_block`` to
disable the buttons with the rule as the tooltip.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from qym_platform.auth import Principal
from qym_platform.db.models import CorrectionStatus, Project, ReviewCorrection
from qym_platform.permissions import is_project_manager
from qym_platform.services.root_cause_categories import normalize_root_cause_issues

CORRECTION_APPROVERS = ("members", "managers")
DEFAULT_CORRECTION_APPROVERS = "members"

MANAGERS_ONLY_DETAIL = (
    "Only project managers and admins can approve, reject or reset corrections "
    "in this project"
)
DIFFERENT_REVIEWER_DETAIL = (
    "This project requires a different reviewer: you cannot approve, reject or "
    "reset a correction you wrote"
)
DELETE_DETAIL = (
    "Only project managers and admins can delete corrections written by someone "
    "else in this project"
)

_ISSUE_FIELDS = ("category", "subcategory", "finding", "solution", "solution_note")


def correction_rules(project: Optional[Project]) -> Dict[str, Any]:
    """The project's review rules, as the API reports them."""
    approvers = getattr(project, "correction_approvers", None)
    return {
        "correction_approvers": (
            approvers if approvers in CORRECTION_APPROVERS else DEFAULT_CORRECTION_APPROVERS
        ),
        "correction_require_different_reviewer": bool(
            getattr(project, "correction_require_different_reviewer", False)
        ),
    }


def _issue_signature(issues: Any, root_causes: Any, detail: Any, note: Any) -> list:
    normalized = normalize_root_cause_issues(
        issues, legacy_root_causes=root_causes, legacy_detail=detail, legacy_finding=note
    )
    return [
        tuple(str(issue.get(key) or "").strip() for key in _ISSUE_FIELDS)
        for issue in normalized
    ]


def correction_author_id(correction: ReviewCorrection) -> Optional[str]:
    """The person who wrote the correction's labels, or None.

    An AI diagnosis taken as it is has no human author: ``corrected_by`` then
    names whoever started the analysis, and approving it is a review of the
    AI's text. Approval copies the AI labels into the human ones, so a
    correction is a person's own work only while its labels differ from the
    AI's.
    """
    if not correction.corrected_by_user_id:
        return None
    human = _issue_signature(
        correction.human_root_cause_issues,
        correction.human_root_causes or correction.human_root_cause,
        correction.human_root_cause_detail,
        correction.human_root_cause_note,
    )
    human_solution = str(correction.human_solution or "").strip()
    if not human and not human_solution:
        return None
    ai = _issue_signature(
        correction.ai_root_cause_issues,
        correction.ai_root_causes or correction.ai_root_cause,
        correction.ai_root_cause_detail,
        correction.ai_root_cause_note,
    )
    if human == ai and human_solution in ("", str(correction.ai_solution or "").strip()):
        return None
    return correction.corrected_by_user_id


def is_self_reviewed(correction: ReviewCorrection) -> bool:
    """A decided correction whose author made the decision ('Self-approved')."""
    author = correction_author_id(correction)
    return bool(author and author == correction.reviewed_by_user_id)


def _project(db: Session, project_or_id: Any) -> Optional[Project]:
    if isinstance(project_or_id, Project):
        return project_or_id
    return db.get(Project, project_or_id) if project_or_id else None


def correction_decision_block(
    db: Session,
    principal: Principal,
    project_or_id: Any,
    correction: Optional[ReviewCorrection] = None,
) -> Optional[str]:
    """Why ``principal`` may not approve, reject or reset; None when allowed.

    Project access is checked by the caller. Without ``correction`` only the
    role rule applies (a candidate that does not exist yet has no author
    other than the AI).
    """
    if principal.auth_type == "none":
        return None
    project = _project(db, project_or_id)
    if project is None:
        return None
    rules = correction_rules(project)
    if rules["correction_approvers"] == "managers" and not is_project_manager(
        db, principal, project.id
    ):
        return MANAGERS_ONLY_DETAIL
    if correction is not None:
        return self_review_block(principal, project, correction)
    return None


def self_review_block(
    principal: Principal, project: Optional[Project], correction: ReviewCorrection
) -> Optional[str]:
    """The 'Require a different reviewer' half of ``correction_decision_block``."""
    if principal.auth_type == "none":
        return None
    if not correction_rules(project)["correction_require_different_reviewer"]:
        return None
    author = correction_author_id(correction)
    if author and author == principal.user.id:
        return DIFFERENT_REVIEWER_DETAIL
    return None


def require_correction_decision(
    db: Session,
    principal: Principal,
    project_or_id: Any,
    correction: Optional[ReviewCorrection] = None,
) -> None:
    """Refuse (403) an approve/reject/reset the project's rules do not allow."""
    reason = correction_decision_block(db, principal, project_or_id, correction)
    if reason:
        raise HTTPException(status_code=403, detail=reason)


def require_correction_delete(
    db: Session, principal: Principal, project_or_id: Any, correction: ReviewCorrection
) -> None:
    """Deleting marks a correction rejected.

    Its author may withdraw their own while it is still PENDING. Once a
    reviewer has approved or rejected it, deleting undoes that decision, so it
    needs the same right as Reset, author or not.
    """
    if principal.auth_type == "none":
        return
    is_author = bool(
        correction.corrected_by_user_id
        and correction.corrected_by_user_id == principal.user.id
    )
    if correction.status == CorrectionStatus.PENDING:
        if is_author:
            return
        if correction_decision_block(db, principal, project_or_id) is not None:
            raise HTTPException(status_code=403, detail=DELETE_DETAIL)
        return
    reason = correction_decision_block(db, principal, project_or_id, correction)
    if reason is not None:
        raise HTTPException(
            status_code=403, detail=reason if is_author else DELETE_DETAIL
        )
