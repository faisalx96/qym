"""Issue-owned solutions and reviews, using the existing JSON/correction storage.

The RunItem row is the lock boundary. A correction with one ``issue_id`` is a
review of only that issue, never a review of all issues under its metric.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Iterable
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import tuple_
from sqlalchemy.orm import Session

from qym_platform.datetime_utils import to_api_timestamp, utc_now_naive
from qym_platform.db.models import (
    AuditLog, CorrectionStatus, ReviewCorrection, Run, RunItem, RunItemScore,
    RunItemAttempt, RunItemPassScore,
)
from qym_platform.services.approved_categories import publish_approved_categories
from qym_platform.services.root_cause_changes import PASS_ANALYSIS_META_KEY
from qym_platform.services.root_cause_categories import (
    analysis_root_cause_issues, normalize_category_taxonomy,
    normalize_root_cause_issues, project_root_cause_issues,
)

ISSUE_FIELDS = ("category", "subcategory", "finding", "solution", "solution_note")
REVIEW_FIELDS = ("review_status", "reviewed_at", "reviewed_by_user_id")


def issue_content(issue: dict[str, Any]) -> dict[str, str]:
    """Only user-editable content; never accept approval metadata from a form."""
    return {key: str(issue.get(key) or "").strip() for key in ISSUE_FIELDS}


def issue_snapshot(issue: dict[str, Any]) -> dict[str, Any]:
    """Content/provenance snapshot; the correction's status column owns review."""
    return {key: deepcopy(value) for key, value in issue.items() if key not in REVIEW_FIELDS}


def lock_issue_correction(db: Session, correction: ReviewCorrection) -> None:
    """Use the same lock order as issue edits, then recheck active state."""
    if not correction_issue_id(correction):
        return
    db.query(RunItem).filter(
        RunItem.run_id == correction.run_id, RunItem.item_id == correction.item_id,
    ).populate_existing().with_for_update().one_or_none()
    db.refresh(correction)
    if not correction.is_active:
        raise HTTPException(409, "This issue was edited. Reload before reviewing it.")


def correction_issues(correction: ReviewCorrection) -> list[dict[str, Any]]:
    human = normalize_root_cause_issues(
        correction.human_root_cause_issues,
        legacy_root_causes=correction.human_root_causes or correction.human_root_cause,
        legacy_detail=correction.human_root_cause_detail,
        legacy_finding=correction.human_root_cause_note,
    )
    return human or normalize_root_cause_issues(
        correction.ai_root_cause_issues,
        legacy_root_causes=correction.ai_root_causes or correction.ai_root_cause,
        legacy_detail=correction.ai_root_cause_detail,
        legacy_finding=correction.ai_root_cause_note,
    )


def correction_issue_id(correction: ReviewCorrection) -> str:
    issues = correction_issues(correction)
    return str(issues[0].get("issue_id") or "") if len(issues) == 1 else ""


def filter_explicitly_approved_issue_corrections(
    db: Session,
    corrections: Iterable[ReviewCorrection],
) -> list[ReviewCorrection]:
    """Keep corrections whose matching saved issue is explicitly approved.

    ``ReviewCorrection.status`` is not enough on its own. Older imports and
    demo data can contain an approved correction row while the issue shown on
    the run still says ``pending``. Suggestions, approved examples, and
    analyzer prompts must follow the issue review state that the user sees.
    """
    candidates = list(corrections)
    if not candidates:
        return []

    item_scopes = {
        (str(correction.run_id), str(correction.item_id))
        for correction in candidates
        if correction.pass_number is None
    }
    items = (
        db.query(RunItem)
        .filter(tuple_(RunItem.run_id, RunItem.item_id).in_(item_scopes))
        .all()
        if item_scopes
        else []
    )
    items_by_scope = {(item.run_id, item.item_id): item for item in items}
    pass_scopes = {
        (
            str(correction.run_id),
            str(correction.item_id),
            str(correction.metric_name or ""),
            int(correction.pass_number),
        )
        for correction in candidates
        if correction.pass_number is not None
    }
    pass_scores_by_scope: dict[
        tuple[str, str, str, int], RunItemPassScore
    ] = {}
    if pass_scopes:
        pass_scores = (
            db.query(RunItemPassScore)
            .filter(
                tuple_(
                    RunItemPassScore.run_id,
                    RunItemPassScore.item_id,
                    RunItemPassScore.metric_name,
                    RunItemPassScore.pass_number,
                ).in_(pass_scopes)
            )
            .all()
        )
        pass_scores_by_scope = {
            (
                str(score.run_id),
                str(score.item_id),
                str(score.metric_name or ""),
                int(score.pass_number),
            ): score
            for score in pass_scores
            if (
                str(score.run_id),
                str(score.item_id),
                str(score.metric_name or ""),
                int(score.pass_number),
            )
            in pass_scopes
        }

    approved: list[ReviewCorrection] = []
    for correction in candidates:
        issue_id = correction_issue_id(correction)
        if not issue_id:
            # Legacy grouped corrections predate issue-level IDs, so their
            # active approved correction row is the only approval marker.
            approved.append(correction)
            continue
        metric_name = str(correction.metric_name or "").strip()
        if correction.pass_number is not None:
            pass_score = pass_scores_by_scope.get(
                (
                    str(correction.run_id),
                    str(correction.item_id),
                    metric_name,
                    int(correction.pass_number),
                )
            )
            pass_metadata = (
                pass_score.meta
                if pass_score is not None and isinstance(pass_score.meta, dict)
                else {}
            )
            analysis = pass_metadata.get(PASS_ANALYSIS_META_KEY)
        else:
            item = items_by_scope.get((correction.run_id, correction.item_id))
            if item is None:
                continue
            metadata = (
                item.item_metadata if isinstance(item.item_metadata, dict) else {}
            )
            if metric_name:
                metric_analyses = metadata.get("metric_analyses")
                analysis = (
                    metric_analyses.get(metric_name)
                    if isinstance(metric_analyses, dict)
                    else None
                )
            else:
                analysis = metadata
        if not isinstance(analysis, dict):
            continue

        issues = analysis_root_cause_issues(analysis)
        matching_issue = next(
            (issue for issue in issues if str(issue.get("issue_id") or "") == issue_id),
            None,
        )
        if (
            matching_issue is not None
            and str(matching_issue.get("review_status") or "").strip().lower()
            == "approved"
        ):
            approved.append(correction)
    return approved


def apply_issue_review(issue: dict[str, Any], correction: ReviewCorrection) -> None:
    issue["review_status"] = correction.status.value
    for key in REVIEW_FIELDS[1:]:
        issue.pop(key, None)
    if correction.reviewed_at:
        issue["reviewed_at"] = to_api_timestamp(correction.reviewed_at)
    if correction.reviewed_by_user_id:
        issue["reviewed_by_user_id"] = correction.reviewed_by_user_id


def refresh_issue_summary(analysis: dict[str, Any]) -> None:
    """Keep legacy labels and overall state useful without approving siblings."""
    issues = analysis_root_cause_issues(analysis)
    analysis.update(project_root_cause_issues(issues))
    analysis["root_cause_issues"] = issues
    statuses = [str(issue.get("review_status") or "pending") for issue in issues]
    analysis["review_status"] = (
        "approved" if statuses and all(value == "approved" for value in statuses)
        else "pending"
    )
    analysis.pop("reviewed_at", None)


def reconcile_issue_edits(
    before: dict[str, Any], after: dict[str, Any], *, source: str = "human"
) -> dict[str, Any]:
    """Preserve unchanged sibling state, even for a legacy whole-list writer."""
    previous = analysis_root_cause_issues(before)
    requested = analysis_root_cause_issues(after)
    identified = {issue.get("issue_id"): issue for issue in previous if issue.get("issue_id")}
    used: set[str] = set()
    result = []
    for index, raw in enumerate(requested):
        old = identified.get(raw.get("issue_id"))
        if old is None:
            old = next((issue for issue in previous
                        if issue.get("issue_id") not in used
                        and all(issue_content(issue)[key] == issue_content(raw)[key]
                                for key in ISSUE_FIELDS if key in raw)), None)
        if old is None and len(previous) == len(requested):
            old = previous[index]
        old_id = str((old or {}).get("issue_id") or "")
        if old_id in used:
            old = None
            old_id = ""
        # Older editors send only category/subcategory/finding. Omitted
        # solution fields are not requests to clear an issue's saved solution.
        content = issue_content({**(old or {}), **raw})
        issue = {**deepcopy(old or {}), **content}
        issue["issue_id"] = old_id or str(uuid4())
        used.add(issue["issue_id"])
        if old is None or issue_content(old) != content:
            for field in REVIEW_FIELDS:
                issue.pop(field, None)
            issue["review_status"] = "pending"
            issue["source"] = source
        else:
            issue.setdefault("review_status", before.get("review_status") or "pending")
        result.append(issue)
    after["root_cause_issues"] = result
    refresh_issue_summary(after)
    return after


def sync_issue_candidates(
    db: Session, *, run: Run, item: RunItem, metric_name: str,
    analysis: dict[str, Any], actor_user_id: str | None, actor_source: str,
    active_candidates: list[ReviewCorrection] | None = None,
    pass_number: int | None = None,
) -> list[ReviewCorrection]:
    """Reconcile one candidate per issue; unchanged approvals remain active.

    Call only while holding the item's lock. Legacy grouped reviews are split
    lazily. Their approved status transfers only to unchanged original issues.
    """
    active = active_candidates if active_candidates is not None else (
        db.query(ReviewCorrection).filter(
            ReviewCorrection.run_id == run.id,
            ReviewCorrection.item_id == item.item_id,
            ReviewCorrection.metric_name == metric_name,
            ReviewCorrection.pass_number == pass_number,
            ReviewCorrection.is_active.is_(True),
        ).order_by(ReviewCorrection.created_at.desc(), ReviewCorrection.id.desc()).all()
    )
    scoped = {correction_issue_id(c): c for c in active if correction_issue_id(c)}
    legacy = next((c for c in active if not correction_issue_id(c)), None)
    legacy_issues = correction_issues(legacy) if legacy else []
    issues = analysis_root_cause_issues(analysis)
    if issues:
        if issues[0].get("confidence") is None and isinstance(analysis.get("confidence"), (int, float)):
            issues[0]["confidence"] = analysis["confidence"]
        if not issues[0].get("category_reason") and analysis.get("root_cause_reason"):
            issues[0]["category_reason"] = analysis["root_cause_reason"]
    score_model = RunItemScore if pass_number is None else RunItemPassScore
    score_query = db.query(score_model).filter(
        score_model.run_id == run.id, score_model.item_id == item.item_id)
    if pass_number is not None:
        score_query = score_query.filter(RunItemPassScore.pass_number == pass_number)
    scores = {score.metric_name: score.score_numeric if score.score_numeric is not None else score.score_raw
              for score in score_query.all()}
    output = item.output
    if pass_number is not None:
        attempt = db.query(RunItemAttempt).filter(
            RunItemAttempt.run_id == run.id, RunItemAttempt.item_id == item.item_id,
            RunItemAttempt.pass_number == pass_number,
            RunItemAttempt.is_last_attempt.is_(True),
        ).order_by(RunItemAttempt.attempt_number.desc()).first()
        # Never use another pass's reduced output as this pass's evidence.
        output = attempt.output if attempt is not None else None
    candidates = []
    retained = set()
    ids = set()
    for index, issue in enumerate(issues):
        issue_id = str(issue.get("issue_id") or uuid4())
        if issue_id in ids:
            issue_id = str(uuid4())
        ids.add(issue_id)
        issue["issue_id"] = issue_id
        candidate = scoped.get(issue_id)
        if candidate and issue_content(correction_issues(candidate)[0]) == issue_content(issue):
            retained.add(candidate.id)
        else:
            baseline = candidate
            unchanged_legacy = bool(
                legacy and index < len(legacy_issues)
                and issue_content(legacy_issues[index]) == issue_content(issue)
            )
            projection = project_root_cause_issues([issue])
            is_ai = (issue.get("source") or actor_source) == "ai"
            ai_issues = normalize_root_cause_issues(baseline.ai_root_cause_issues) if baseline else []
            if not ai_issues and legacy and index < len(legacy_issues):
                raw_ai = normalize_root_cause_issues(legacy.ai_root_cause_issues)
                if index < len(raw_ai):
                    ai_issues = [{**raw_ai[index], "issue_id": issue_id}]
            if is_ai:
                ai_issues = [issue_snapshot(issue)]
            ai_projection = project_root_cause_issues(ai_issues)
            status = legacy.status if unchanged_legacy else CorrectionStatus.PENDING
            candidate = ReviewCorrection(
                run_id=run.id, item_id=item.item_id, metric_name=metric_name, task=run.task,
                pass_number=pass_number,
                input_snapshot=item.input, expected_snapshot=item.expected,
                output_snapshot=output, scores_snapshot=scores,
                ai_root_cause=ai_projection["root_cause"], ai_root_causes=ai_projection["root_causes"],
                ai_root_cause_issues=ai_issues, ai_root_cause_detail=ai_projection["root_cause_detail"],
                ai_root_cause_note=ai_projection["root_cause_note"],
                ai_confidence=(ai_issues[0].get("confidence") if ai_issues else None),
                ai_category_taxonomy=normalize_category_taxonomy(analysis.get("category_taxonomy")),
                ai_solution=str(ai_issues[0].get("solution") or "")[:200] if ai_issues else "",
                ai_solution_note=str(ai_issues[0].get("solution_note") or "") if ai_issues else "",
                human_root_cause="" if is_ai else projection["root_cause"],
                human_root_causes=[] if is_ai else projection["root_causes"],
                human_root_cause_issues=[] if is_ai else [issue_snapshot(issue)],
                human_root_cause_detail="" if is_ai else projection["root_cause_detail"],
                human_root_cause_note="" if is_ai else projection["root_cause_note"],
                human_category_taxonomy=normalize_category_taxonomy(analysis.get("category_taxonomy")),
                # The JSON issue retains the full solution; this legacy column is a short label.
                human_solution="" if is_ai else str(issue.get("solution") or "")[:200],
                human_solution_note="" if is_ai else str(issue.get("solution_note") or ""),
                status=status, is_active=True, corrected_by_user_id=actor_user_id,
                reviewed_by_user_id=legacy.reviewed_by_user_id if unchanged_legacy else None,
                reviewed_at=legacy.reviewed_at if unchanged_legacy else None,
                review_comment=legacy.review_comment if unchanged_legacy else "",
                created_at=utc_now_naive(),
            )
            db.add(candidate)
        apply_issue_review(issue, candidate)
        candidates.append(candidate)
    for candidate in active:
        if candidate.id not in retained:
            candidate.is_active = False
            candidate.status = CorrectionStatus.SUPERSEDED if issues else CorrectionStatus.WITHDRAWN
    analysis["root_cause_issues"] = issues
    refresh_issue_summary(analysis)
    return candidates


def change_metric_issue(
    db: Session, *, run: Run, item: RunItem, metric_name: str,
    analysis: dict[str, Any], request: dict[str, Any], actor_user_id: str | None,
    pass_number: int | None = None,
) -> dict[str, Any]:
    """Apply one add/edit/approve/delete under the caller's item/pass lock."""
    action = request.get("action")
    if action not in {"add", "edit", "approve", "delete"}:
        raise HTTPException(400, "Invalid issue action")
    before = deepcopy(analysis)
    issues = analysis_root_cause_issues(analysis)
    new_issue_id = None
    if action == "add" and request.get("client_issue_id"):
        try:
            new_issue_id = str(UUID(str(request["client_issue_id"])))
        except (ValueError, TypeError) as exc:
            raise HTTPException(400, "Invalid client_issue_id") from exc
        saved = next((issue for issue in issues if issue.get("issue_id") == new_issue_id), None)
        if saved is not None:
            if issue_content(saved) != issue_content(request.get("issue") or {}):
                raise HTTPException(409, "This new issue was already saved with different content. Reopen it to edit.")
            return deepcopy(analysis)
    index = None
    if action != "add":
        target_id = request.get("issue_id")
        if target_id:
            index = next((i for i, issue in enumerate(issues) if issue.get("issue_id") == target_id), None)
        else:
            raw_index = request.get("issue_index")
            if type(raw_index) is int and 0 <= raw_index < len(issues):
                index = raw_index
        if index is None:
            raise HTTPException(409, "This issue changed or was removed. Reload before trying again.")
        expected = request.get("expected_issue")
        if not isinstance(expected, dict) or issue_content(expected) != issue_content(issues[index]):
            raise HTTPException(409, "This issue was edited elsewhere. Reload before trying again.")
    for issue in issues:
        issue.setdefault("issue_id", str(uuid4()))
        issue.setdefault("review_status", analysis.get("review_status") or "pending")
    analysis = deepcopy(analysis)
    analysis["root_cause_issues"] = issues
    # Split any legacy grouped review before changing content. This transfers
    # legitimate old approvals to the original siblings, never to a new issue.
    sync_issue_candidates(db, run=run, item=item, metric_name=metric_name,
                          analysis=analysis, actor_user_id=actor_user_id,
                          actor_source=str(analysis.get("source") or "ai"),
                          pass_number=pass_number)
    db.flush()
    issues = analysis["root_cause_issues"]
    if action in {"add", "edit"}:
        raw_issue = request.get("issue")
        if not isinstance(raw_issue, dict):
            raise HTTPException(400, "issue is required")
        content = issue_content(raw_issue)
        if not content["category"]:
            raise HTTPException(400, "Every issue needs a category")
        if len(content["category"]) > 200 or len(content["finding"]) > 10000:
            raise HTTPException(400, "Category is limited to 200 characters and finding to 10000")
        if action == "add":
            issues.append({**content, "issue_id": new_issue_id or str(uuid4()), "source": "human", "review_status": "pending"})
        elif issue_content(issues[index]) != content:
            issues[index].update(content)
            for key in REVIEW_FIELDS:
                issues[index].pop(key, None)
            issues[index].update(source="human", review_status="pending")
        analysis["source"] = "human"
        analysis.pop("error", None)
    elif action == "delete":
        issues.pop(index)
        analysis["source"] = "human"
    candidates = sync_issue_candidates(
        db, run=run, item=item, metric_name=metric_name, analysis=analysis,
        actor_user_id=actor_user_id, actor_source="human", pass_number=pass_number,
    )
    if action == "approve":
        candidate = candidates[index]
        if not candidate.human_root_cause_issues and candidate.ai_root_cause_issues:
            candidate.human_root_cause_issues = deepcopy(candidate.ai_root_cause_issues)
            for suffix in ("root_cause", "root_causes", "root_cause_detail", "root_cause_note", "category_taxonomy", "solution", "solution_note"):
                setattr(candidate, "human_" + suffix, deepcopy(getattr(candidate, "ai_" + suffix)))
        candidate.status = CorrectionStatus.APPROVED
        candidate.reviewed_by_user_id = actor_user_id
        candidate.reviewed_at = utc_now_naive()
        apply_issue_review(analysis["root_cause_issues"][index], candidate)
        publish_approved_categories(db, run.project_id, [candidate], actor_user_id)
    refresh_issue_summary(analysis)
    if before != analysis:
        db.add(AuditLog(
            actor_user_id=actor_user_id, action="metric_issue:" + action,
            entity_type="run_item_pass_metric_issue" if pass_number else "run_item_metric_issue",
            entity_id=f"{run.id}:{item.item_id}:{pass_number or 0}:{metric_name}",
            before=before, after=deepcopy(analysis), created_at=utc_now_naive(),
        ))
    return analysis


def sync_correction_issue_metadata(db: Session, correction: ReviewCorrection, *, remove: bool = False) -> None:
    """Keep run cards in sync with actions taken from the Reviews page."""
    issue_id = correction_issue_id(correction)
    if not issue_id:
        return
    item = db.query(RunItem).filter(
        RunItem.run_id == correction.run_id, RunItem.item_id == correction.item_id,
    ).populate_existing().with_for_update().one_or_none()
    if item is None:
        return
    pass_score = None
    if correction.pass_number is not None:
        pass_score = lock_correction_pass(db, correction)
        meta = deepcopy(pass_score.meta or {})
        analysis = meta.get(PASS_ANALYSIS_META_KEY, {})
    else:
        meta = deepcopy(item.item_metadata or {})
        analysis = meta.get("metric_analyses", {}).get(correction.metric_name, {})
    issues = analysis_root_cause_issues(analysis)
    if remove:
        issues = [issue for issue in issues if issue.get("issue_id") != issue_id]
    else:
        for issue in issues:
            if issue.get("issue_id") == issue_id:
                apply_issue_review(issue, correction)
    analysis["root_cause_issues"] = issues
    refresh_issue_summary(analysis)
    if pass_score is not None:
        meta[PASS_ANALYSIS_META_KEY] = analysis
        pass_score.meta = meta
    else:
        item.item_metadata = meta


def lock_correction_pass(db: Session, correction: ReviewCorrection) -> RunItemPassScore:
    """Lock the pass after the caller has locked its parent item."""
    score = db.query(RunItemPassScore).filter(
        RunItemPassScore.run_id == correction.run_id,
        RunItemPassScore.item_id == correction.item_id,
        RunItemPassScore.metric_name == correction.metric_name,
        RunItemPassScore.pass_number == correction.pass_number,
    ).populate_existing().with_for_update().one_or_none()
    if score is None:
        raise HTTPException(404, "Pass score not found")
    return score
