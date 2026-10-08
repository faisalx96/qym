from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from html import escape
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qsl, quote, urlencode

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from sqlalchemy import Text, case, cast, func, null, or_, type_coerce
from sqlalchemy.orm import Session, load_only

from qym_platform.auth import Principal, require_ui_principal
from qym_platform.auth_oidc import (
    get_session_user_and_provider,
    request_root_path,
    sanitize_next,
    session_auth_enabled,
    with_root_path,
)
from qym_platform.datetime_utils import to_api_timestamp, utc_now_naive
from qym_platform.db.models import (
    Approval,
    ApprovalDecision,
    AuditLog,
    Dataset,
    DatasetAlias,
    DatasetVersion,
    Project,
    ProjectMembership,
    ReviewCorrection,
    RootCauseRevision,
    Run,
    RunEvent,
    RunItem,
    RunItemAttempt,
    RunItemPassScore,
    RunItemScore,
    RunMetricSpec,
    RunTraceAggregate,
    RunWorkflowStatus,
    Span,
    User,
    UserRole,
)
from qym_platform.deps import get_db
from qym_platform.item_identity import (
    build_compare_identity,
    finalize_compare_alignment,
)
from qym_platform.permissions import (
    ARCHIVED_PROJECT_DETAIL,
    PROJECT_STATE_HEADER,
    can_approve_run as permission_can_approve_run,
    can_delete_run,
    can_modify_run,
    can_review_run,
    can_view_run,
    can_view_run_items,
    has_project_access,
    is_project_manager,
    project_for_read_by_slug,
    redact_item_content,
    require_project_writable,
)
from qym_platform.services.eval_run_scores import sync_run_scores
from qym_platform.services.correction_rules import (
    DELETE_DETAIL,
    correction_decision_block,
    require_correction_decision,
    require_correction_delete,
)
from qym_platform.services.issue_reviews import (
    ISSUE_REVIEW_COLUMNS,
    change_metric_issue,
    correction_issue_id,
    issue_json_says_decided,
    issue_review_statuses,
    reconcile_issue_edits,
)
from qym_platform.services.run_lifecycle import (
    RUN_STATUS_REASON_ADMIN_FORCE_STOP,
    RUN_STATUS_REASON_LEASE_TIMEOUT,
    RUN_STATUS_REASON_UPLOAD_INCOMPLETE,
    RUN_STATUS_REASONS_CANCELLED,
    can_force_stop_run,
    is_run_force_stopped,
    is_run_stop_requested,
    is_stale_running_run,
    reconcile_stale_running_run,
    stop_requested_job_ids,
)
from qym_platform.services.eval_run_linking import strip_launch_token
from qym_platform.services.run_experiment_panel import run_experiment_panel
from qym_platform.services.run_origin import (
    experiment_refs_and_versioning,
    experiment_refs_for_jobs,
    parse_origin_filter,
    run_origin_fields,
)
from qym_platform.services.run_versioning import (
    parse_versioning_params,
    versioning_conditions,
)
from qym_platform.services.run_payloads import (
    compact_attempt,
    compact_row,
    detail_item_ids,
    meta_key_schema,
    new_meta_key_index,
    reason_fields,
    reason_request,
    scope_row_to_pass,
    search_conditions,
)
from qym_platform.services.run_review import (
    SUBMITTABLE_STATUSES,
    keep_legacy_review,
    lock_approval,
    lock_review_run,
    record_transition,
    resolve_execution_outcome,
    review_history,
    state_conflict,
)
from qym_platform.services.execution_errors import (
    execution_success_fields,
    repeat_execution_counts,
)
from qym_platform.services.ingest_completeness import (
    public_run_metadata,
    runs_list_ingest_flag,
)
from qym_platform.services.metric_semantics import declared_direction, primary_metric
from qym_platform.services.score_edits import (
    EDIT_RECORD_KEY,
    ORIGINAL_NUMERIC_KEY,
    SCORE_EDIT_META_KEYS,
    ScoreEditError,
    ScoreResetError,
    edit_record,
    is_edited,
    parse_score_edit,
    reduced_score_type,
    restore_original_score,
)
from qym_platform.services.run_means import (
    ITEM_EDIT_KEY,
    METRIC_ERROR_STATUSES,
    TASK_ERROR_PASS_LABEL,
    TASK_ERROR_PASS_MARKER,
    completed_review_runs,
    errored_pass_items,
    errors_left_out,
    execution_outcomes,
    is_metric_error,
    is_task_error_pass,
    item_not_received,
    mean_task_errors,
    metric_directions,
    metric_error_candidates,
    metric_mean_fields,
    not_received_clause,
    not_received_items,
    pass_metric_totals,
    raw_metric_totals,
    reduce_pass_scores,
    run_metric_mean,
    supersede_metric_error,
)
from qym_platform.services.retention import purge_due_at
from qym_platform.services.repeat_passes import (
    RepeatPassDeletionError,
    delete_repeat_pass,
    has_repeat_pass_context,
    lock_repeat_run,
    pass_revision_matches,
)
from qym_platform.services.root_cause_changes import (
    PASS_ANALYSIS_META_KEY,
    apply_human_patch,
    apply_root_cause_change,
    extract_analysis_state,
    lock_run_item,
    replace_metric_review_candidate,
)
from qym_platform.services.root_cause_categories import (
    analysis_root_cause_issues,
    analysis_root_causes,
    normalize_category_taxonomy,
    normalize_root_cause_issues,
    normalize_root_causes,
    patch_issue_categories,
)
from qym_platform.settings import PlatformSettings


router = APIRouter()

_LANGFUSE_URL_RE = re.compile(r"(https?://[^/]+)/project/([^/]+)")
# Attempt outputs read per query when a run page is built.
_ATTEMPT_OUTPUT_BATCH = 200
# Distinct runs one /api/compare request may build (cohort comparisons send
# both cohorts' runs in one request, so this is above two small cohorts).
MAX_COMPARE_RUNS = 20


def _metric_spec_payload(spec: RunMetricSpec) -> Dict[str, Any]:
    return {
        "schema_version": spec.schema_version,
        "score_type": spec.score_type,
        # None: no declared direction. metrics.js metricDirection() also
        # treats the default "maximize" schema 1 SDKs sent for plain
        # callables (score_type "legacy") as undeclared.
        "direction": spec.direction,
        "pass_threshold": spec.pass_threshold,
        "sample_reducer": spec.sample_reducer,
        "run_reducer": spec.run_reducer,
        "unit": spec.unit,
        "precision": spec.precision,
        "primary": bool(spec.is_primary),
    }


def _metric_specs_for_runs(
    db: Session, run_ids: List[str]
) -> Dict[str, Dict[str, Dict[str, Any]]]:
    if not run_ids:
        return {}
    result: Dict[str, Dict[str, Dict[str, Any]]] = {}
    rows = (
        db.query(RunMetricSpec)
        .filter(RunMetricSpec.run_id.in_(run_ids))
        .order_by(RunMetricSpec.position.asc())
        .all()
    )
    for row in rows:
        result.setdefault(row.run_id, {})[row.metric_name] = _metric_spec_payload(row)
    return result


_EXECUTION_ERROR_STATUSES = set(METRIC_ERROR_STATUSES)
_is_metric_execution_error = is_metric_error


def _set_task_error_flag(
    payload_meta: Dict[str, Any], label: Any, meta: Any, explanation: Any
) -> None:
    """Send an "error"-labeled pass's classification as ``task_error``.

    The index drops the explanation and long metadata that show a scorer's
    own "error" verdict, so the page reads this flag (metrics.js
    isTaskErrorPass) instead of re-deriving it from what is left. A label
    only in the metadata (an imported run) gets the flag too, as the means
    count it. Other passes carry no flag.
    """
    payload_meta.pop(TASK_ERROR_PASS_MARKER, None)
    shown_label = label or payload_meta.get("label")
    if str(shown_label or "").strip().lower() == TASK_ERROR_PASS_LABEL:
        payload_meta[TASK_ERROR_PASS_MARKER] = is_task_error_pass(label, meta, explanation)


def _execution_error_pairs_for_runs(
    db: Session,
    run_ids: List[str],
    *,
    samples_by_run: Optional[Dict[str, int]] = None,
    item_ids: Optional[List[str]] = None,
    breakdowns: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, set[tuple[str, int]]]:
    """Return unique ``(item_id, pass_number)`` executions with an exception.

    ``RunItem`` and ``RunItemScore`` are reduced to one row for repeat runs, so
    repeat errors must come from their pass-aware attempt, event, and score
    records.  A set prevents a task error and its zero-filled metric score from
    counting the same failed execution twice.
    """
    if not run_ids:
        return {}

    sample_counts = dict(samples_by_run or {})
    missing_run_ids = [run_id for run_id in run_ids if run_id not in sample_counts]
    if missing_run_ids:
        sample_counts.update(
            {
                run_id: max(1, int(samples or 1))
                for run_id, samples in db.query(Run.id, Run.samples)
                .filter(Run.id.in_(missing_run_ids))
                .all()
            }
        )

    error_pairs: Dict[str, set[tuple[str, int]]] = defaultdict(set)

    # Classic runs keep their task outcome directly on RunItem. Repeat runs
    # overwrite that representative row each pass, so their pass-aware sources
    # below are authoritative.
    for run_id, item_id in (
        db.query(RunItem.run_id, RunItem.item_id)
        .filter(RunItem.run_id.in_(run_ids), RunItem.error.isnot(None))
        .filter(RunItem.item_id.in_(item_ids) if item_ids is not None else True)
        .all()
    ):
        if sample_counts.get(run_id, 1) <= 1:
            error_pairs[run_id].add((str(item_id), 1))

    for run_id, item_id, pass_number in (
        db.query(
            RunItemAttempt.run_id,
            RunItemAttempt.item_id,
            RunItemAttempt.pass_number,
        )
        .filter(
            RunItemAttempt.run_id.in_(run_ids),
            RunItemAttempt.is_last_attempt.is_(True),
            func.lower(RunItemAttempt.status).in_(tuple(_EXECUTION_ERROR_STATUSES)),
        )
        .filter(
            RunItemAttempt.item_id.in_(item_ids) if item_ids is not None else True
        )
        .all()
    ):
        error_pairs[run_id].add((str(item_id), max(1, int(pass_number or 1))))

    # Legacy SDKs can emit item_failed without a final-attempt row.
    for run_id, event_item_id, event_pass in (
        db.query(
            RunEvent.run_id,
            RunEvent.payload["item_id"].as_string(),
            RunEvent.payload["pass_number"].as_string(),
        )
        .filter(RunEvent.run_id.in_(run_ids), RunEvent.type == "item_failed")
        .filter(
            RunEvent.payload["item_id"].as_string().in_(item_ids)
            if item_ids is not None
            else True
        )
        .yield_per(1000)
    ):
        payload = {"item_id": event_item_id, "pass_number": event_pass}
        item_id = str(payload.get("item_id") or "")
        if not item_id:
            continue
        try:
            pass_number = max(1, int(payload.get("pass_number") or 1))
        except (TypeError, ValueError):
            pass_number = 1
        error_pairs[run_id].add((item_id, pass_number))

    task_pairs = {rid: set(pairs) for rid, pairs in error_pairs.items()}
    metric_checks: Dict[str, set] = defaultdict(set)

    classic_run_ids = [rid for rid in run_ids if sample_counts.get(rid, 1) <= 1]
    aggregate_score_candidates = (
        db.query(
            RunItemScore.run_id,
            RunItemScore.item_id,
            RunItemScore.metric_name,
            RunItemScore.meta["status"].as_string(),
        )
        .filter(
            RunItemScore.run_id.in_(classic_run_ids),
            metric_error_candidates(RunItemScore),
        )
        .filter(RunItemScore.item_id.in_(item_ids) if item_ids is not None else True)
        .yield_per(1000)
    )
    for run_id, item_id, metric, status in aggregate_score_candidates:
        if _is_metric_execution_error({"status": status}):
            error_pairs[run_id].add((str(item_id), 1))
            if (str(item_id), 1) not in task_pairs.get(run_id, set()):
                metric_checks[run_id].add((str(item_id), 1, metric))

    pass_score_candidates = (
        db.query(
            RunItemPassScore.run_id,
            RunItemPassScore.item_id,
            RunItemPassScore.pass_number,
            RunItemPassScore.metric_name,
            RunItemPassScore.meta["status"].as_string(),
        )
        .filter(
            RunItemPassScore.run_id.in_(run_ids),
            metric_error_candidates(RunItemPassScore),
        )
        .filter(
            RunItemPassScore.item_id.in_(item_ids) if item_ids is not None else True
        )
        .yield_per(1000)
    )
    for run_id, item_id, pass_number, metric, status in pass_score_candidates:
        if _is_metric_execution_error({"status": status}):
            pair = (str(item_id), max(1, int(pass_number or 1)))
            error_pairs[run_id].add(pair)
            if pair not in task_pairs.get(run_id, set()):
                metric_checks[run_id].add((*pair, metric))

    if breakdowns is not None:
        from collections import Counter
        from qym_platform.services.execution_errors import error_breakdown

        for rid in run_ids:
            tasks = Counter(p for _, p in task_pairs.get(rid, set()))
            metrics: Dict[int, Counter] = defaultdict(Counter)
            for _, number, metric in metric_checks.get(rid, set()):
                metrics[number][metric] += 1
            breakdowns[rid] = error_breakdown(tasks, metrics)

    return dict(error_pairs)


def _refresh_metric_analysis_error(meta: Dict[str, Any]) -> None:
    """Keep the item-level analysis error summary aligned with metric edits."""
    metric_analyses = meta.get("metric_analyses")
    errors = []
    if isinstance(metric_analyses, dict):
        for metric_name, analysis in metric_analyses.items():
            if not isinstance(analysis, dict):
                continue
            error = str(analysis.get("error") or "").strip()
            if error:
                errors.append(f"{metric_name}: {error}")
    if errors:
        meta["analysis_error"] = "; ".join(errors)
    else:
        meta.pop("analysis_error", None)


def _apply_metric_analysis_patch(
    before_analysis: Dict[str, Any] | None,
    patch: Dict[str, Any],
) -> Dict[str, Any]:
    """Apply the editable diagnosis fields without touching other metadata."""
    analysis = dict(before_analysis or {})

    if "root_cause_issues" in patch:
        issues = normalize_root_cause_issues(patch.get("root_cause_issues"))
        analysis["root_cause_issues"] = issues
    elif "root_causes" in patch:
        root_causes = normalize_root_causes(patch.get("root_causes"))
        if root_causes:
            existing = analysis_root_cause_issues(analysis)
            analysis["root_cause_issues"] = patch_issue_categories(
                existing, root_causes
            )
        else:
            analysis["root_cause_issues"] = []
    elif "root_cause" in patch:
        root_cause = str(patch.get("root_cause") or "").strip()
        if root_cause:
            existing = analysis_root_cause_issues(analysis)
            primary = dict(existing[0]) if existing else {}
            primary["category"] = root_cause
            analysis["root_cause_issues"] = [primary, *existing[1:]]
        else:
            analysis["root_cause_issues"] = []
    if "root_cause_detail" in patch:
        issues = analysis_root_cause_issues(analysis)
        if issues:
            issues[0]["subcategory"] = str(
                patch.get("root_cause_detail") or ""
            ).strip()
            analysis["root_cause_issues"] = issues
        else:
            detail = str(patch.get("root_cause_detail") or "").strip()
            if detail:
                analysis["root_cause_detail"] = detail
            else:
                analysis.pop("root_cause_detail", None)
    if "root_cause_note" in patch:
        issues = analysis_root_cause_issues(analysis)
        if issues:
            issues[0]["finding"] = str(
                patch.get("root_cause_note") or ""
            ).strip()
            analysis["root_cause_issues"] = issues
        else:
            note = str(patch.get("root_cause_note") or "").strip()
            if note:
                analysis["root_cause_note"] = note
            else:
                analysis.pop("root_cause_note", None)

    category_was_patched = any(
        field in patch for field in ("root_cause_issues", "root_causes", "root_cause")
    )
    if category_was_patched or any(
        field in patch
        for field in ("root_cause_detail", "root_cause_note")
    ):
        issues = normalize_root_cause_issues(
            analysis.get("root_cause_issues"),
            legacy_root_causes=(
                analysis.get("root_causes") or analysis.get("root_cause")
            ),
            legacy_detail=analysis.get("root_cause_detail"),
            legacy_finding=analysis.get("root_cause_note"),
        )
        if issues:
            categories = normalize_root_causes(
                issue.get("category") for issue in issues
            )
            primary = issues[0]
            analysis["root_cause_issues"] = issues
            analysis["root_causes"] = categories
            analysis["root_cause"] = categories[0]
            if primary.get("subcategory"):
                analysis["root_cause_detail"] = primary["subcategory"]
            else:
                analysis.pop("root_cause_detail", None)
            if primary.get("finding"):
                analysis["root_cause_note"] = primary["finding"]
            else:
                analysis.pop("root_cause_note", None)
        else:
            for field in (
                "root_cause_issues",
                "root_causes",
                "root_cause",
                "root_cause_reason",
                "confidence",
            ):
                analysis.pop(field, None)
            if category_was_patched:
                analysis.pop("root_cause_detail", None)
                analysis.pop("root_cause_note", None)
    if "category_taxonomy" in patch:
        taxonomy = normalize_category_taxonomy(patch.get("category_taxonomy"))
        if taxonomy:
            analysis["category_taxonomy"] = taxonomy
        else:
            analysis.pop("category_taxonomy", None)
    if "solution" in patch:
        solution = str(patch.get("solution") or "").strip()
        if solution:
            analysis["solution"] = solution
        else:
            analysis.pop("solution", None)
            analysis.pop("solution_note", None)
    if "solution_note" in patch:
        solution_note = str(patch.get("solution_note") or "").strip()
        if solution_note:
            analysis["solution_note"] = solution_note
        else:
            analysis.pop("solution_note", None)

    if patch:
        if normalize_root_causes(
            analysis.get("root_causes") or analysis.get("root_cause")
        ):
            analysis.pop("error", None)
        analysis.pop("confidence", None)
        # A new human edit reopens review for this pass.  Keep the review
        # state next to the pass diagnosis so an approved sample does not
        # remain approved after its category or notes change.
        analysis.pop("review_status", None)
        analysis.pop("reviewed_at", None)
        analysis["source"] = "human"

    if any(issue.get("issue_id") for issue in analysis_root_cause_issues(before_analysis)):
        analysis = reconcile_issue_edits(before_analysis or {}, analysis)
    elif "root_cause_issues" in patch:
        # The old endpoint must not allow a form to invent approval markers.
        for issue in analysis.get("root_cause_issues", []):
            for key in ("review_status", "reviewed_at", "reviewed_by_user_id", "issue_id"):
                issue.pop(key, None)

    meaningful = {
        key: value
        for key, value in analysis.items()
        if key != "source" and value not in (None, "", [])
    }
    return analysis if meaningful else {}


def _median(values: List[Optional[float]]) -> float:
    numeric = sorted(float(v) for v in values if v is not None)
    if not numeric:
        return 0.0
    mid = len(numeric) // 2
    if len(numeric) % 2 == 0:
        return (numeric[mid - 1] + numeric[mid]) / 2.0
    return numeric[mid]


def _repeat_pass_status(
    *, pass_number: int, last_completed: int, has_data: bool, run_status: str
) -> str:
    """Derive a pass status without contradicting its parent run."""
    if pass_number <= last_completed:
        return "completed"

    normalized_run_status = str(run_status or "").upper()
    if has_data:
        terminal_status = {
            "COMPLETED": "completed",
            "FAILED": "failed",
            "STOPPED": "stopped",
        }.get(normalized_run_status)
        return terminal_status or "running"

    if normalized_run_status == "RUNNING" and pass_number == last_completed + 1:
        return "running"
    return "pending"


def _repeat_attempt_summaries(
    db: Session, run_ids: List[str]
) -> Dict[str, Dict[str, Any]]:
    """Aggregate latency, runtime, and retries across retained repeat passes."""
    if not run_ids:
        return {}

    rows = (
        db.query(
            RunItemAttempt.run_id,
            RunItemAttempt.item_id,
            RunItemAttempt.pass_number,
            RunItemAttempt.attempt_number,
            RunItemAttempt.latency_ms,
            RunItemAttempt.task_started_at_ms,
        )
        .filter(
            RunItemAttempt.run_id.in_(run_ids),
            RunItemAttempt.is_last_attempt.is_(True),
        )
        .all()
    )
    latencies_by_run: Dict[str, List[float]] = defaultdict(list)
    bounds_by_run_pass: Dict[str, Dict[int, List[float]]] = defaultdict(dict)
    retries_by_execution: Dict[str, Dict[tuple[str, int], int]] = defaultdict(dict)
    for (
        run_id,
        item_id,
        pass_number,
        attempt_number,
        latency_ms,
        task_started_at_ms,
    ) in rows:
        execution_key = (str(item_id), max(1, int(pass_number or 1)))
        retries_by_execution[run_id][execution_key] = max(
            retries_by_execution[run_id].get(execution_key, 0),
            max(0, int(attempt_number or 1) - 1),
        )
        if latency_ms is not None:
            latencies_by_run[run_id].append(float(latency_ms))
        if task_started_at_ms is None or latency_ms is None:
            continue
        start = float(task_started_at_ms)
        end = start + float(latency_ms)
        bounds = bounds_by_run_pass[run_id].setdefault(int(pass_number), [start, end])
        bounds[0] = min(bounds[0], start)
        bounds[1] = max(bounds[1], end)

    # Legacy SDK events can carry retry_count without a retained final-attempt
    # row. Merge by item/pass and take the maximum so an event and its matching
    # attempt row never double-count the same retries.
    retry_event_types = {
        "item_attempt_started",
        "item_attempt_finished",
        "item_completed",
        "item_failed",
    }
    for run_id, event_item_id, event_pass, event_retries, event_attempt in (
        db.query(
            RunEvent.run_id,
            RunEvent.payload["item_id"].as_string(),
            RunEvent.payload["pass_number"].as_string(),
            RunEvent.payload["retry_count"].as_string(),
            RunEvent.payload["attempt_number"].as_string(),
        )
        .filter(
            RunEvent.run_id.in_(run_ids),
            RunEvent.type.in_(retry_event_types),
        )
        .yield_per(1000)
    ):
        payload = {
            "item_id": event_item_id,
            "pass_number": event_pass,
            "retry_count": event_retries,
            "attempt_number": event_attempt,
        }
        item_id = str(payload.get("item_id") or "")
        if not item_id:
            continue
        try:
            pass_number = max(1, int(payload.get("pass_number") or 1))
        except (TypeError, ValueError):
            pass_number = 1
        try:
            retry_count = max(0, int(payload.get("retry_count") or 0))
        except (TypeError, ValueError):
            retry_count = 0
        try:
            retry_count = max(
                retry_count, max(0, int(payload.get("attempt_number") or 1) - 1)
            )
        except (TypeError, ValueError):
            pass
        execution_key = (item_id, pass_number)
        retries_by_execution[run_id][execution_key] = max(
            retries_by_execution[run_id].get(execution_key, 0), retry_count
        )

    summaries: Dict[str, Dict[str, Any]] = {}
    all_run_ids = (
        set(latencies_by_run) | set(bounds_by_run_pass) | set(retries_by_execution)
    )
    for run_id in all_run_ids:
        latencies = latencies_by_run.get(run_id, [])
        summary: Dict[str, Any] = {}
        if latencies:
            summary["avg_latency_ms"] = sum(latencies) / len(latencies)
            summary["median_latency_ms"] = _median(latencies)
        pass_bounds = bounds_by_run_pass.get(run_id, {})
        if pass_bounds:
            summary["duration_ms"] = sum(
                max(0.0, end - start) for start, end in pass_bounds.values()
            )
        retry_counts_by_pass: Dict[int, int] = defaultdict(int)
        for (_item_id, pass_number), retry_count in retries_by_execution.get(
            run_id, {}
        ).items():
            retry_counts_by_pass[pass_number] += retry_count
        summary["retry_counts_by_pass"] = dict(retry_counts_by_pass)
        summary["total_retries"] = sum(retry_counts_by_pass.values())
        summaries[run_id] = summary
    return summaries


def _apply_execution_stats(
    stats: Dict[str, Any], repeat: Optional[Dict[str, int]] = None
) -> None:
    """Snapshot stats: execution success counts and success_rate in percent.

    Items never received are neither executions nor successes.
    """
    fields = execution_success_fields(
        stats["total"] - int(stats.get("not_received") or 0), stats["completed"], repeat
    )
    stats.update(fields, success_rate=fields["success_rate"] * 100.0)


def _stringify(val: Any) -> str:
    """Convert a value to a display string; dicts/lists become pretty JSON."""
    if val is None:
        return ""
    if isinstance(val, str):
        return val
    if isinstance(val, (dict, list)):
        return json.dumps(val, indent=2, ensure_ascii=False)
    return str(val)


def _repeat_aggregate_metric_meta(
    pass_values: Dict[int, Optional[float]],
    stored_meta: Optional[Dict[str, Any]] = None,
    observed: Optional[int] = None,
) -> Dict[str, Any]:
    """Describe a repeat reduction without presenting one pass as the mean.

    ``observed`` is how many passes the reduction counted (see
    ``reduce_pass_scores``); by default, the passes with a score.
    """
    if observed is None:
        observed = sum(value is not None for value in pass_values.values())
    meta: Dict[str, Any] = {
        "sample_reducer": "mean",
        "samples_observed": int(observed),
    }
    for key, value in (stored_meta or {}).items():
        if key in SCORE_EDIT_META_KEYS or key == ITEM_EDIT_KEY or key.startswith("pass_"):
            meta[key] = value
    return meta


def _completed_pass_outputs(
    db: Session,
    run_id: str,
    wanted: set[tuple[str, int]],
) -> Dict[tuple[str, int], Any]:
    """Recover outputs for attempts written by pre-fix SDK event ordering."""
    if not wanted:
        return {}
    recovered: Dict[tuple[str, int], Any] = {}
    rows = (
        db.query(RunEvent.payload)
        .filter(RunEvent.run_id == run_id, RunEvent.type == "item_completed")
        .filter(
            RunEvent.payload["item_id"]
            .as_string()
            .in_({item_id for item_id, _ in wanted})
        )
        .order_by(RunEvent.sequence.asc())
        .all()
    )
    for (payload,) in rows:
        if not isinstance(payload, dict):
            continue
        item_id = str(payload.get("item_id") or "")
        try:
            pass_number = max(1, int(payload.get("pass_number") or 1))
        except (TypeError, ValueError):
            pass_number = 1
        key = (item_id, pass_number)
        if key in wanted and "output" in payload:
            recovered[key] = payload.get("output")
    return recovered


def _bump_published_summary(db: Session, run_id: str) -> None:
    """Move a published summary's revision so cached list pages miss.

    A pending summary (revision 0) keeps revision 0: bumping it would list the
    run as published with no numbers and hide it from the unpublished count.
    The catalog revision hashes the dimension's status and visibility, so
    cached pages still miss for a pending run.
    """
    from qym_platform.db.dashboard_models import DashboardRunSummary

    summary = db.get(DashboardRunSummary, run_id, populate_existing=True, with_for_update=True)
    if summary is not None and int(summary.projection_revision or 0) > 0:
        summary.projection_revision = int(summary.projection_revision) + 1


def _set_dashboard_visibility(db: Session, run_id: str, visible: bool) -> None:
    """Hide/show the run in projection-backed lists immediately.

    ``present`` stays owned by the summary worker (it drives the numeric bucket
    moves); ``hidden_at`` is the operator-facing flag lists filter on.
    """
    from qym_platform.db.dashboard_models import (
        DashboardPartitionState, DashboardRunDimension,
    )

    # Source writes already hold the Run lock. Match the worker's partition
    # then projection lock order before changing any cached projection rows.
    with db.no_autoflush:
        db.get(DashboardPartitionState, run_id, populate_existing=True, with_for_update=True)
        dimension = db.get(DashboardRunDimension, run_id, populate_existing=True, with_for_update=True)
        if dimension is None or (dimension.hidden_at is None) == visible:
            return
        dimension.hidden_at = None if visible else utc_now_naive()
        _bump_published_summary(db, run_id)


def _publish_dashboard_review_state(db: Session, run: Run, approval: Any) -> None:
    """Show a review decision in projection-backed lists immediately.

    The summary worker republishes the same values later; the new status (and
    a published summary's bumped revision) moves the catalog revision, so no
    cached list page keeps the old status or keeps offering the old action.
    """
    from qym_platform.db.dashboard_models import (
        DashboardPartitionState, DashboardRunDimension,
    )
    from qym_platform.services.dashboard_summaries import dashboard_approval_info

    # Same lock order as _set_dashboard_visibility: Run (held), partition, projection.
    with db.no_autoflush:
        db.get(DashboardPartitionState, run.id, populate_existing=True, with_for_update=True)
        dimension = db.get(DashboardRunDimension, run.id, populate_existing=True, with_for_update=True)
        if dimension is None:
            return
        status = str(getattr(run.status, "value", run.status))
        dimension.status = status
        dimension.descriptor = {
            **(dimension.descriptor or {}),
            "status": status,
            "approval": dashboard_approval_info(db, approval),
        }
        _bump_published_summary(db, run.id)


def _lock_pass_mutation_run(db: Session, run_id: str, expected_version: Any) -> Run:
    """Reject a stale pass number before acquiring any item or score locks."""
    try:
        run = lock_repeat_run(db, run_id)
    except RepeatPassDeletionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    if not pass_revision_matches(run, expected_version):
        raise HTTPException(
            status_code=409,
            detail="Passes changed; reload the run before editing",
        )
    return run


def _repeat_pass_event_state(
    db: Session,
    run_id: str,
    *,
    item_ids: Optional[List[str]] = None,
    output_pass: Optional[int] = None,
    include_outputs: bool = True,
    with_attempt_rows: bool = False,
) -> Dict[str, Any]:
    """Per-pass lifecycle state from ``run_item_attempts`` (no event replay).

    Every finished attempt is a row; since ingest also records a RUNNING row at
    attempt start, in-flight work is visible without reading ``run_events``.
    Runs ingested before attempt rows existed fall back to the event log.
    ``output_pass`` loads attempt outputs of that pass only (a one-sample view
    drops the others); every pass's state is still read.
    ``include_outputs=False`` reads no attempt output at all: outcomes taken
    from attempt rows then carry an empty output (for callers that need only
    status, latency or traces, or that read final outputs themselves).
    ``with_attempt_rows`` also returns the scalar attempt rows read (with no
    output column) as ``attempt_rows``, so a caller need not query them again.
    """
    output_column: Any = RunItemAttempt.output
    if not include_outputs:
        output_column = type_coerce(null(), RunItemAttempt.output.type)
    elif output_pass is not None:
        output_column = type_coerce(
            case((RunItemAttempt.pass_number == int(output_pass), RunItemAttempt.output), else_=null()),
            RunItemAttempt.output.type,
        )
    query = db.query(
        RunItemAttempt.item_id,
        RunItemAttempt.pass_number,
        RunItemAttempt.attempt_number,
        RunItemAttempt.status,
        RunItemAttempt.latency_ms,
        RunItemAttempt.task_started_at_ms,
        RunItemAttempt.trace_id,
        RunItemAttempt.trace_url,
        RunItemAttempt.error,
        RunItemAttempt.is_last_attempt,
        RunItemAttempt.id,
        output_column,
    ).filter(RunItemAttempt.run_id == run_id)
    if item_ids is not None:
        query = query.filter(RunItemAttempt.item_id.in_(list(item_ids)))
    rows = query.order_by(RunItemAttempt.pass_number, RunItemAttempt.item_id, RunItemAttempt.attempt_number).all()
    if not rows:
        has_events = db.query(RunEvent.id).filter(RunEvent.run_id == run_id).first() is not None
        if has_events:
            state = _repeat_pass_event_state_from_events(db, run_id, item_ids=item_ids)
        else:
            state = {"outcomes": {}, "active_attempts": {}, "starts_by_pass": defaultdict(list), "completed_passes": set()}
        if with_attempt_rows:
            state["attempt_rows"] = []
        return state

    outcomes: Dict[tuple[str, int], Dict[str, Any]] = {}
    active_attempts: Dict[tuple[str, int], Dict[str, Any]] = {}
    starts_by_pass: Dict[int, List[int]] = defaultdict(list)
    for row in rows:
        item_id, pass_number, attempt_number, status, latency_ms, start_ms, trace_id, trace_url, error, is_last, _attempt_id, output = row
        pass_number = max(1, int(pass_number or 1))
        key = (item_id, pass_number)
        if start_ms is not None:
            starts_by_pass[pass_number].append(int(start_ms))
            if latency_ms is not None:
                starts_by_pass[pass_number].append(int(start_ms + latency_ms))
        status_l = str(status or "").upper()
        if status_l == "RUNNING" or not is_last:
            # A non-final failure is still active during retry backoff. It
            # must not win over the next RUNNING attempt as a pass outcome.
            active_attempts[key] = {
                "pass_number": pass_number,
                "status": "running",
                "output": None,
                "error": "",
                "latency_ms": None,
                "task_started_at_ms": int(start_ms) if start_ms is not None else None,
                "trace_id": trace_id or "",
                "trace_url": trace_url or "",
                "retry_count": max(0, int(attempt_number or 1) - 1),
            }
            continue
        failed = status_l == "FAILED"
        err = str(error or "")
        outcomes[key] = {
            "pass_number": pass_number,
            "status": "error" if failed else "completed",
            "output": f"ERROR: {err}" if failed and err else _stringify(output),
            "error": err,
            "latency_ms": float(latency_ms) if latency_ms is not None else None,
            "task_started_at_ms": int(start_ms) if start_ms is not None else None,
            "trace_id": trace_id or "",
            "trace_url": trace_url or "",
            "retry_count": max(0, int(attempt_number or 1) - 1),
        }
        active_attempts.pop(key, None)

    run = db.get(Run, run_id)
    metadata = run.run_metadata if run is not None and isinstance(run.run_metadata, dict) else {}
    try:
        last_completed = int(metadata.get("last_completed_pass") or 0)
    except (TypeError, ValueError):
        last_completed = 0
    completed_passes = set(range(1, last_completed + 1))

    # Legacy gaps: passes with no attempt rows at all (old SDKs emitted only an
    # item outcome), or a live run ingested before RUNNING attempt rows existed.
    samples = int(getattr(run, "samples", 1) or 1) if run is not None else 1
    passes_seen = {key[1] for key in outcomes} | {key[1] for key in active_attempts}
    status = str(getattr(getattr(run, "status", None), "value", getattr(run, "status", "")) or "").upper()
    live = status in {"RUNNING", "PENDING"}
    had_active_attempts = bool(active_attempts)
    if active_attempts:
        # Older ingests left cancellation as an unfinished attempt plus an
        # item_failed event. Read only failures for these items, not the full
        # event history, and reconcile the matching unfinished pass.
        active_item_ids = sorted({key[0] for key in active_attempts})
        for offset in range(0, len(active_item_ids), 400):
            failures = (
                db.query(RunEvent.payload)
                .filter(
                    RunEvent.run_id == run_id,
                    RunEvent.type == "item_failed",
                    RunEvent.payload["item_id"].as_string().in_(
                        active_item_ids[offset : offset + 400]
                    ),
                )
                .order_by(RunEvent.sequence)
            )
            for (payload,) in failures:
                if not isinstance(payload, dict):
                    continue
                try:
                    pass_number = max(1, int(payload.get("pass_number") or 1))
                except (TypeError, ValueError):
                    pass_number = 1
                key = (str(payload.get("item_id") or ""), pass_number)
                active = active_attempts.get(key)
                if active is None:
                    continue
                error = str(payload.get("error") or "")
                outcomes[key] = {
                    **active,
                    "status": "error",
                    "error": error,
                    "output": f"ERROR: {error}" if error else "",
                    **{
                        name: payload[name]
                        for name in (
                            "latency_ms", "task_started_at_ms", "trace_id", "trace_url"
                        )
                        if payload.get(name) is not None
                    },
                }
        for key in outcomes:
            active_attempts.pop(key, None)
    missing_passes = [p for p in range(1, samples + 1) if p not in passes_seen]
    if missing_passes or (live and not active_attempts and not had_active_attempts):
        legacy = _repeat_pass_event_state_from_events(db, run_id, item_ids=item_ids)
        for key, value in legacy["outcomes"].items():
            outcomes.setdefault(key, value)
        for key, value in legacy["active_attempts"].items():
            if key not in outcomes:
                active_attempts.setdefault(key, value)
        for pass_number, values in legacy["starts_by_pass"].items():
            if pass_number in missing_passes or not starts_by_pass.get(pass_number):
                starts_by_pass[pass_number].extend(values)
        completed_passes |= set(legacy["completed_passes"])
    state = {
        "outcomes": outcomes,
        "active_attempts": active_attempts,
        "starts_by_pass": starts_by_pass,
        "completed_passes": completed_passes,
    }
    if with_attempt_rows:
        state["attempt_rows"] = rows
    return state


def _repeat_pass_event_state_from_events(
    db: Session, run_id: str, *, item_ids: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Recover per-pass lifecycle state that is not represented by final attempts.

    New evaluations emit attempt-start events before an attempt finishes, while
    older evaluations can emit an item outcome without a matching final-attempt
    row.  Keeping both here prevents live or legacy pass pages from falling back
    to the run-level item's latest state.
    """

    event_types = {
        "item_started",
        "item_attempt_started",
        "item_attempt_finished",
        "metric_scored",
        "item_completed",
        "item_failed",
        "pass_completed",
    }
    rows = (
        db.query(RunEvent)
        .filter(RunEvent.run_id == run_id, RunEvent.type.in_(event_types))
        .filter(
            RunEvent.payload["item_id"].as_string().in_(item_ids)
            if item_ids is not None
            else True
        )
        .order_by(RunEvent.sequence.asc())
        .all()
    )
    outcomes: Dict[tuple[str, int], Dict[str, Any]] = {}
    active_attempts: Dict[tuple[str, int], Dict[str, Any]] = {}
    starts_by_pass: Dict[int, List[int]] = defaultdict(list)
    completed_passes: set[int] = set()

    def _pass_number(payload: Dict[str, Any]) -> int:
        try:
            return max(1, int(payload.get("pass_number") or 1))
        except (TypeError, ValueError):
            return 1

    def _event_ms(event: RunEvent) -> Optional[int]:
        sent_at = getattr(event, "sent_at", None)
        if sent_at is None:
            return None
        if sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=timezone.utc)
        return int(sent_at.timestamp() * 1000)

    for event in rows:
        payload = event.payload if isinstance(event.payload, dict) else {}
        pass_number = _pass_number(payload)
        event_ms = _event_ms(event)
        start_ms = payload.get("task_started_at_ms")
        try:
            start_ms = int(start_ms) if start_ms is not None else None
        except (TypeError, ValueError):
            start_ms = None

        latency_ms = payload.get("latency_ms")
        try:
            latency_ms = float(latency_ms) if latency_ms is not None else None
        except (TypeError, ValueError):
            latency_ms = None

        if start_ms is None and latency_ms is not None and event_ms is not None:
            start_ms = int(event_ms - latency_ms)
        lifecycle_ms = start_ms if start_ms is not None else event_ms
        if lifecycle_ms is not None:
            starts_by_pass[pass_number].append(lifecycle_ms)

        if event.type == "pass_completed":
            completed_passes.add(pass_number)
            continue

        item_id = str(payload.get("item_id") or "")
        if not item_id:
            continue
        key = (item_id, pass_number)

        if event.type == "item_attempt_started":
            try:
                attempt_number = max(1, int(payload.get("attempt_number") or 1))
            except (TypeError, ValueError):
                attempt_number = 1
            active_attempts[key] = {
                "pass_number": pass_number,
                "status": "running",
                "output": None,
                "error": "",
                "latency_ms": None,
                "task_started_at_ms": lifecycle_ms,
                "trace_id": payload.get("trace_id") or "",
                "trace_url": payload.get("trace_url") or "",
                "retry_count": max(0, attempt_number - 1),
            }
            continue

        is_outcome = event.type in {"item_completed", "item_failed"}
        if event.type == "item_attempt_finished":
            is_outcome = bool(payload.get("is_last_attempt"))
        if not is_outcome:
            continue

        failed = (
            event.type == "item_failed"
            or str(payload.get("status") or "").lower() == "failed"
        )
        try:
            retry_count = max(0, int(payload.get("retry_count") or 0))
        except (TypeError, ValueError):
            retry_count = 0
        if event.type == "item_attempt_finished":
            try:
                retry_count = max(
                    retry_count, int(payload.get("attempt_number") or 1) - 1
                )
            except (TypeError, ValueError):
                pass
        error = str(payload.get("error") or "")
        output = payload.get("output")
        previous = outcomes.get(key) or {}
        if output is None and previous.get("output") not in (None, ""):
            output = previous["output"]
        if start_ms is None:
            start_ms = previous.get("task_started_at_ms")
        if latency_ms is None:
            latency_ms = previous.get("latency_ms")
        outcomes[key] = {
            "pass_number": pass_number,
            "status": "error" if failed else "completed",
            "output": f"ERROR: {error}" if failed and error else _stringify(output),
            "error": error,
            "latency_ms": latency_ms,
            "task_started_at_ms": start_ms,
            "trace_id": payload.get("trace_id") or "",
            "trace_url": payload.get("trace_url") or "",
            "retry_count": retry_count,
        }
        active_attempts.pop(key, None)

    return {
        "outcomes": outcomes,
        "active_attempts": active_attempts,
        "starts_by_pass": starts_by_pass,
        "completed_passes": completed_passes,
    }


def _strip_model_provider(model_name: str) -> str:
    """Normalize 'provider/model' -> 'model' for consistent display."""
    if not model_name:
        return model_name
    idx = model_name.find("/")
    return model_name[idx + 1 :] if idx > 0 else model_name


def _extract_langfuse_ids(run_metadata: dict) -> tuple[str, str]:
    """Extract (host, project_id) from langfuse_url stored in run metadata.

    The SDK sends langfuse_url like ``https://cloud.langfuse.com/project/<id>/datasets/...``
    but does NOT explicitly send ``langfuse_host`` or ``langfuse_project_id``.
    """
    langfuse_url = (
        run_metadata.get("langfuse_url", "") if isinstance(run_metadata, dict) else ""
    )
    host = (
        run_metadata.get("langfuse_host", "") if isinstance(run_metadata, dict) else ""
    )
    project_id = (
        run_metadata.get("langfuse_project_id", "")
        if isinstance(run_metadata, dict)
        else ""
    )
    if langfuse_url and (not host or not project_id):
        m = _LANGFUSE_URL_RE.match(langfuse_url)
        if m:
            host = host or m.group(1)
            project_id = project_id or m.group(2)
    return host, project_id


def _platform_static_dir() -> Path:
    """Return the platform static directory."""
    return Path(__file__).resolve().parent.parent / "_static"


def _dashboard_html_response(idx: Path, request: Request) -> HTMLResponse:
    """Serve a dashboard HTML page, rewriting absolute asset paths and
    injecting ``window.__QYM_ROOT_PATH__`` so client-side JS can build
    correct URLs when the platform is mounted under a sub-path (e.g. ``/qym``)."""
    html = idx.read_text(encoding="utf-8")
    root = request_root_path(request)
    if root:
        html = html.replace('="/static/', f'="{root}/static/')
        html = html.replace("='/static/", f"='{root}/static/")
        html = html.replace('="/ui/', f'="{root}/ui/')
        html = html.replace("='/ui/", f"='{root}/ui/")
    injection = f"<script>window.__QYM_ROOT_PATH__ = {json.dumps(root)};</script>"
    if "<head>" in html:
        html = html.replace("<head>", "<head>\n  " + injection, 1)
    else:
        html = injection + html
    return HTMLResponse(html, media_type="text/html; charset=utf-8")


def _platform_static_ui_index() -> Path:
    return _platform_static_dir() / "ui" / "index.html"


def _platform_static_dashboard_index() -> Path:
    return _platform_static_dir() / "dashboard" / "index.html"


def _platform_static_dashboard_compare() -> Path:
    return _platform_static_dir() / "dashboard" / "compare.html"


def _platform_static_profile_index() -> Path:
    return _platform_static_dir() / "dashboard" / "profile.html"


def _platform_static_admin_index() -> Path:
    return _platform_static_dir() / "dashboard" / "admin.html"


def _platform_static_dashboard_run() -> Path:
    return _platform_static_dir() / "dashboard" / "run.html"


def _platform_static_dashboard_analyzer() -> Path:
    return _platform_static_dir() / "dashboard" / "analyzer.html"


def _platform_static_project_settings() -> Path:
    return _platform_static_dir() / "dashboard" / "project_settings.html"


def _platform_static_overview() -> Path:
    return _platform_static_dir() / "dashboard" / "overview.html"


def _platform_static_projects() -> Path:
    return _platform_static_dir() / "dashboard" / "projects.html"


def _platform_static_charts() -> Path:
    return _platform_static_dir() / "dashboard" / "charts.html"


def _platform_static_models() -> Path:
    return _platform_static_dir() / "dashboard" / "models.html"


def _platform_static_experiments() -> Path:
    return _platform_static_dir() / "dashboard" / "experiments.html"


def _platform_static_eval_queue() -> Path:
    return _platform_static_dir() / "dashboard" / "eval_queue.html"


def _platform_static_datasets() -> Path:
    return _platform_static_dir() / "dashboard" / "datasets.html"


def _platform_static_docs_guide() -> Path:
    return _platform_static_dir() / "dashboard" / "docs.html"


def _project_path_prefix(request: Request, project_slug: str) -> str:
    path = request.url.path
    marker = f"/projects/{project_slug}"
    idx = path.find(marker)
    if idx < 0:
        return ""
    return path[:idx]


def _resolve_project_by_slug_for_ui(
    db: Session,
    principal: Principal,
    project_slug: str,
    *,
    allow_archived: bool = True,
) -> Project:
    # An archived project's pages open read-only for its members and admins.
    # Auto-analysis and Reviews stay hidden: they exist to change things.
    project = project_for_read_by_slug(db, principal, project_slug)
    if not allow_archived and not project.is_active:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _maybe_redirect_to_login(
    request: Request, db: Session
) -> Optional[RedirectResponse]:
    settings = PlatformSettings()
    if not session_auth_enabled(settings):
        return None
    if get_session_user_and_provider(db, request):
        return None
    root = request_root_path(request)
    # ``request.url.path`` already includes ``root_path`` under a Starlette mount,
    # so do NOT prepend it again here. Only the redirect target needs the prefix.
    full_path = request.url.path + (
        f"?{request.url.query}" if request.url.query else ""
    )
    next_value = sanitize_next(full_path, default=(root + "/") if root else "/")
    # Encoded whole: a share link carries several query parameters (pass, item).
    return RedirectResponse(url=f"{root}/login?next={quote(next_value, safe='/')}", status_code=303)


def _project_not_found_page(request: Request, project_slug: str) -> HTMLResponse:
    prefix = _project_path_prefix(request, project_slug).rstrip("/")
    static_root = f"{prefix}/static" if prefix else "/static"
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>قيِّم • Project Not Found</title>
  <link rel="icon" type="image/png" href="{static_root}/qym_icon.png">
  <link rel="stylesheet" href="{static_root}/dashboard.css?v=p1-20261006-1">
  <link rel="stylesheet" href="{static_root}/shell.css?v=p1-20261005-6">
  <script src="{static_root}/qym_safe.js?v=p1-20261001"></script>
  <script src="{static_root}/auth.js?v=p1-20261005"></script>
  <script src="{static_root}/shell.js?v=p1-20261006-1"></script>
</head>
<body>
  <main style="min-height:50vh;display:flex;align-items:center;justify-content:center;padding:32px;color:var(--text-muted);">
    <div>Loading project…</div>
    <noscript>
      <section style="width:min(640px,100%);background:var(--bg-surface);border:1px solid var(--border-default);border-radius:12px;padding:32px 28px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--error);margin-bottom:12px;">Missing Project</div>
        <h1 style="margin:0 0 10px 0;font-size:30px;line-height:1.15;color:var(--text-primary);">Project not found</h1>
        <p style="margin:0;color:var(--text-secondary);font-size:14px;line-height:1.65;">The requested project "{escape(project_slug)}" does not exist, is archived, or you no longer have access to it.</p>
      </section>
    </noscript>
  </main>
</body>
</html>"""
    return HTMLResponse(content=html, status_code=404)


def _guard_project_page(
    request: Request, db: Session, project_slug: str, *, allow_archived: bool = True
) -> Optional[Any]:
    redirect = _maybe_redirect_to_login(request, db)
    if redirect:
        return redirect
    try:
        principal = require_ui_principal(
            request=request,
            db=db,
            x_user_email=request.headers.get("X-User-Email"),
            x_email=request.headers.get("X-Email"),
            x_admin_bootstrap=request.headers.get("X-Admin-Bootstrap"),
        )
        _resolve_project_by_slug_for_ui(
            db, principal, project_slug, allow_archived=allow_archived
        )
    except HTTPException as exc:
        if exc.status_code == 404:
            return _project_not_found_page(request, project_slug)
        raise
    return None


def _analysis_query(
    request: Request,
    *,
    remove: set[str] | None = None,
    scope: str | None = None,
) -> str:
    """Preserve harmless analyzer query state while canonicalizing routes."""
    remove = remove or set()
    pairs = parse_qsl(request.url.query, keep_blank_values=True)
    result: list[tuple[str, str]] = []
    scope_written = False
    for key, value in pairs:
        if key in remove:
            continue
        if key == "scope" and scope is not None:
            if not scope_written:
                result.append(("scope", scope))
                scope_written = True
            continue
        result.append((key, value))
    if scope is not None and not scope_written:
        result.append(("scope", scope))
    return urlencode(result, doseq=True)


def _analysis_project_base(request: Request) -> str:
    path = request.url.path
    marker = "/projects/"
    return path.split(marker, 1)[0] if marker in path else ""


def _analysis_project_url(
    request: Request,
    project_slug: str,
    suffix: str = "analysis",
    query: str = "",
) -> str:
    path = (
        _analysis_project_base(request).rstrip("/")
        + "/projects/"
        + quote(str(project_slug), safe="")
        + ("/" + suffix.lstrip("/") if suffix else "")
    )
    return path + ("?" + query if query else "")


def _visible_run_for_redirect(
    db: Session,
    request: Request,
    run_id: str,
) -> Run | None:
    run = Run.active(db).filter(Run.id == run_id).first()
    if run is None:
        return None
    try:
        principal = require_ui_principal(
            request=request,
            db=db,
            x_user_email=request.headers.get("X-User-Email"),
            x_email=request.headers.get("X-Email"),
            x_admin_bootstrap=request.headers.get("X-Admin-Bootstrap"),
        )
    except HTTPException:
        return None
    return run if can_view_run(db, principal, run) else None


def _canonical_legacy_analyzer_redirect(
    run_id: str,
    request: Request,
    db: Session,
) -> RedirectResponse | None:
    run = _visible_run_for_redirect(db, request, run_id)
    if run is None:
        return None
    project = db.get(Project, run.project_id)
    if project is None:
        return None
    requested_scope = dict(parse_qsl(request.url.query, keep_blank_values=True)).get(
        "scope"
    )
    query = _analysis_query(
        request,
        scope="run" if requested_scope == "dashboard" else None,
    )
    return RedirectResponse(
        url=_analysis_project_url(
            request,
            project.slug,
            "runs/" + quote(run.id, safe="") + "/analyzer",
            query,
        ),
        status_code=307,
    )


def _canonical_project_analysis_redirect(
    project_slug: str,
    request: Request,
    db: Session,
) -> RedirectResponse | None:
    params = dict(parse_qsl(request.url.query, keep_blank_values=True))
    requested_run_id = params.get("run", "").strip()
    if requested_run_id:
        run = _visible_run_for_redirect(db, request, requested_run_id)
        if run is None:
            return None
        project = db.get(Project, run.project_id)
        if project is None:
            return None
        query = _analysis_query(request, remove={"run", "scope"})
        return RedirectResponse(
            url=_analysis_project_url(
                request,
                project.slug,
                "runs/" + quote(run.id, safe="") + "/analyzer",
                query,
            ),
            status_code=307,
        )

    aliases = {"diagnosis": "categories", "project": "rules", "dashboard": "run"}
    requested_scope = params.get("scope")
    canonical_scope = aliases.get(requested_scope or "")
    if canonical_scope is not None:
        query = _analysis_query(request, scope=canonical_scope)
        return RedirectResponse(
            url=_analysis_project_url(request, project_slug, "analysis", query),
            status_code=307,
        )
    return None


def _canonical_project_run_analyzer_redirect(
    project_slug: str,
    run_id: str,
    request: Request,
    db: Session,
) -> RedirectResponse | None:
    run = _visible_run_for_redirect(db, request, run_id)
    if run is not None:
        project = db.get(Project, run.project_id)
        if project is not None and project.slug != project_slug:
            return RedirectResponse(
                url=_analysis_project_url(
                    request,
                    project.slug,
                    "runs/" + quote(run.id, safe="") + "/analyzer",
                    _analysis_query(request),
                ),
                status_code=307,
            )
    requested_scope = dict(parse_qsl(request.url.query, keep_blank_values=True)).get(
        "scope"
    )
    if requested_scope == "dashboard":
        return RedirectResponse(
            url=_analysis_project_url(
                request,
                project_slug,
                "runs/" + quote(run_id, safe="") + "/analyzer",
                _analysis_query(request, remove={"scope"}, scope="run"),
            ),
            status_code=307,
        )
    aliases = {"diagnosis": "categories", "project": "rules"}
    canonical_scope = aliases.get(requested_scope or "")
    if canonical_scope is not None:
        return RedirectResponse(
            url=_analysis_project_url(
                request,
                project_slug,
                "analysis",
                _analysis_query(request, remove={"scope"}, scope=canonical_scope),
            ),
            status_code=307,
        )
    if requested_scope in {"categories", "rules", "documents"}:
        return RedirectResponse(
            url=_analysis_project_url(
                request,
                project_slug,
                "analysis",
                _analysis_query(
                    request, remove={"scope"}, scope=str(requested_scope)
                ),
            ),
            status_code=307,
        )
    return None


def _iso(dt: Optional[datetime]) -> str:
    return to_api_timestamp(dt or utc_now_naive()) or ""


def _status_reason_label(db: Session, run: Run) -> Optional[str]:
    """Why a run is ``STOPPED``, in words for the run page (``None`` otherwise)."""
    reason = run.status_reason
    if not reason or run.status != RunWorkflowStatus.STOPPED:
        return None
    if reason == RUN_STATUS_REASON_LEASE_TIMEOUT:
        seconds = PlatformSettings().run_stale_timeout_seconds
        return (
            f"No events received for {seconds}s; the run resumes if it sends more"
        )
    if reason == RUN_STATUS_REASON_ADMIN_FORCE_STOP:
        return "Force stopped by an administrator"
    if reason == RUN_STATUS_REASON_UPLOAD_INCOMPLETE:
        return (
            "The Evaluation Service finished the job, but some of this run's "
            "events never arrived"
        )
    if reason in RUN_STATUS_REASONS_CANCELLED:
        from qym_platform.db.models import EvalExperimentJob

        job = db.get(EvalExperimentJob, run.experiment_job_id) if run.experiment_job_id else None
        user = db.get(User, job.cancelled_by_user_id) if job and job.cancelled_by_user_id else None
        who = (user.display_name or user.email) if user else None
        label = f"Cancelled by {who}" if who else "Cancelled by a user"
        if job and job.cancel_reason:
            label += f": {job.cancel_reason}"
        return label
    return None


def _reconcile_run_liveness(db: Session, runs: List[Run]) -> None:
    if not runs:
        return
    timeout_seconds = PlatformSettings().run_stale_timeout_seconds
    running_ids = [
        run.id
        for run in runs
        if is_stale_running_run(run, timeout_seconds=timeout_seconds)
    ]
    if not running_ids:
        return
    # A GET may have loaded RUNNING before an admin stop or a fresh heartbeat.
    # Refresh under the same lock as ingestion before inferring a timeout.
    # SKIP LOCKED: a run ingestion holds is live by definition, and a read
    # must not queue behind it (like reconcile_expired_dashboard_runs). Only
    # non-key columns change, so child-row inserts (FOR KEY SHARE) go on.
    locked_runs = (
        db.query(Run)
        .filter(Run.id.in_(running_ids))
        .order_by(Run.id)
        .with_for_update(key_share=True, skip_locked=True)
        .populate_existing()
        .all()
    )
    changed = False
    for run in locked_runs:
        if reconcile_stale_running_run(run, timeout_seconds=timeout_seconds):
            changed = True
    if changed:
        db.commit()
        for run in runs:
            db.refresh(run)
    else:
        # Release liveness locks before building potentially large run payloads.
        db.commit()


def _serialize_span(span: Span) -> Dict[str, Any]:
    return {
        "trace_id": span.trace_id,
        "span_id": span.span_id,
        "parent_span_id": span.parent_span_id,
        "name": span.name,
        "kind": span.kind,
        "start_time_ns": span.start_time_ns,
        "end_time_ns": span.end_time_ns,
        "duration_ms": span.duration_ms,
        "status": span.status,
        "attributes": span.attributes,
        "events": span.events,
        "links": span.links or [],
    }


def _trace_time_bounds(spans: List[Span]) -> tuple[Optional[int], Optional[int]]:
    starts: list[int] = []
    ends: list[int] = []
    for span in spans:
        if span.start_time_ns is not None:
            starts.append(int(span.start_time_ns))
        if span.end_time_ns is not None:
            ends.append(int(span.end_time_ns))
        elif span.start_time_ns is not None and span.duration_ms is not None:
            ends.append(
                int(span.start_time_ns + (float(span.duration_ms) * 1_000_000.0))
            )
    if not starts or not ends:
        return None, None
    return min(starts), max(ends)


def _build_trace_summary(spans: List[Span]) -> Dict[str, Any]:
    span_ids = {s.span_id for s in spans}
    root_count = 0
    orphan_count = 0
    error_count = 0
    for span in spans:
        status = str(span.status or "").upper()
        if status == "ERROR":
            error_count += 1
        parent_id = span.parent_span_id
        if not parent_id:
            root_count += 1
        elif parent_id not in span_ids:
            root_count += 1
            orphan_count += 1

    started_at_ns, ended_at_ns = _trace_time_bounds(spans)
    duration_ms: Optional[float] = None
    if (
        started_at_ns is not None
        and ended_at_ns is not None
        and ended_at_ns >= started_at_ns
    ):
        duration_ms = (ended_at_ns - started_at_ns) / 1_000_000.0

    return {
        "span_count": len(spans),
        "root_count": root_count,
        "error_count": error_count,
        "duration_ms": duration_ms,
        "started_at_ns": started_at_ns,
        "ended_at_ns": ended_at_ns,
        "has_orphans": orphan_count > 0,
        "orphan_count": orphan_count,
    }


def _serialize_attempt_trace_payload(
    attempt: Dict[str, Any], spans: List[Span]
) -> Dict[str, Any]:
    return {
        "pass_number": attempt.get("pass_number"),
        "attempt_number": attempt.get("attempt_number"),
        "status": attempt.get("status") or "failed",
        "latency_ms": attempt.get("latency_ms"),
        "task_started_at_ms": attempt.get("task_started_at_ms"),
        "trace_id": attempt.get("trace_id") or "",
        "trace_url": attempt.get("trace_url") or "",
        "error": attempt.get("error"),
        "is_last_attempt": bool(attempt.get("is_last_attempt", False)),
        "summary": _build_trace_summary(spans),
        "spans": [_serialize_span(span) for span in spans],
    }


def _build_item_trace_payload(
    item: RunItem,
    attempts: List[Dict[str, Any]],
    *,
    retry_count_override: Optional[int] = None,
    fallback_to_item_trace: bool = True,
) -> Dict[str, Any]:
    retry_count = (
        int(retry_count_override)
        if retry_count_override is not None
        else int(
            getattr(item, "retry_count", 0)
            or (
                (item.item_metadata or {}).get("retry_count")
                if isinstance(item.item_metadata, dict)
                else 0
            )
            or 0
        )
    )
    last_attempt = attempts[-1] if attempts else None
    last_summary = (
        (last_attempt or {}).get("summary") if isinstance(last_attempt, dict) else None
    )
    last_spans = (
        (last_attempt or {}).get("spans") if isinstance(last_attempt, dict) else None
    )
    return {
        "item": {
            "run_id": item.run_id,
            "item_id": item.item_id,
            "trace_id": (last_attempt or {}).get("trace_id")
            or (item.trace_id if fallback_to_item_trace else "")
            or "",
            "trace_url": (last_attempt or {}).get("trace_url")
            or (item.trace_url if fallback_to_item_trace else "")
            or "",
            "retry_count": retry_count,
        },
        "summary": last_summary or _build_trace_summary([]),
        "spans": last_spans or [],
        "attempts": attempts,
    }


def _dataset_version_info_map(
    db: Session, runs: List[Run]
) -> Dict[str, Dict[str, Any]]:
    """Resolve the dataset version label and aliases for a batch of runs.

    Keyed by ``dataset_version_id``; returns ``{"dataset_version": "v4",
    "dataset_aliases": ["production"], "dataset_slug": "ragbench"}``. Aliases reflect
    what currently points at that version, so a run shows ``production`` when its
    version is the live production one. ``dataset_slug`` is set while the managed
    dataset exists, so the run page can link to it. Runs with no
    ``dataset_version_id`` simply aren't in the map.
    """
    version_ids = {run.dataset_version_id for run in runs if run.dataset_version_id}
    if not version_ids:
        return {}
    versions = {
        v.id: v
        for v in db.query(DatasetVersion)
        .filter(DatasetVersion.id.in_(version_ids))
        .all()
    }
    dataset_ids = {v.dataset_id for v in versions.values() if v.dataset_id}
    dataset_slugs = (
        {
            dataset_id: slug
            for dataset_id, slug in db.query(Dataset.id, Dataset.slug)
            .filter(Dataset.id.in_(dataset_ids), Dataset.deleted_at.is_(None))
            .all()
        }
        if dataset_ids
        else {}
    )
    aliases_by_version: Dict[str, List[str]] = defaultdict(list)
    for alias in (
        db.query(DatasetAlias)
        .filter(DatasetAlias.dataset_version_id.in_(version_ids))
        .all()
    ):
        aliases_by_version[alias.dataset_version_id].append(alias.alias)
    info: Dict[str, Dict[str, Any]] = {}
    for vid in version_ids:
        v = versions.get(vid)
        info[vid] = {
            "dataset_version": v.version if v else None,
            "dataset_aliases": sorted(aliases_by_version.get(vid, [])),
            "dataset_slug": dataset_slugs.get(v.dataset_id) if v else None,
        }
    return info


def _dataset_version_fields(
    run: Run, info_map: Dict[str, Dict[str, Any]]
) -> Dict[str, Any]:
    """Per-run dataset version/alias fields for inclusion in a run payload."""
    entry = info_map.get(run.dataset_version_id) if run.dataset_version_id else None
    return {
        "dataset_version": entry["dataset_version"] if entry else None,
        "dataset_aliases": entry["dataset_aliases"] if entry else [],
        "dataset_slug": entry.get("dataset_slug") if entry else None,
    }


def _compute_run_summary(db: Session, run: Run) -> Dict[str, Any]:
    items: List[RunItem] = (
        db.query(RunItem)
        .filter(RunItem.run_id == run.id)
        .order_by(RunItem.index.asc())
        .all()
    )
    total_items = len(items)
    error_items = {it.item_id for it in items if it.error}
    error_count = len(error_items)
    error_details: Dict[str, Dict[str, Any]] = {}
    execution_error_count = len(
        _execution_error_pairs_for_runs(
            db,
            [run.id],
            samples_by_run={run.id: int(getattr(run, "samples", 1) or 1)},
            breakdowns=error_details,
        ).get(run.id, set())
    )
    total_retries = sum(int(it.retry_count or 0) for it in items)
    repeat_executions = None
    if int(getattr(run, "samples", 1) or 1) > 1:
        repeat_summary = _repeat_attempt_summaries(db, [run.id]).get(run.id, {})
        if "total_retries" in repeat_summary:
            total_retries = int(repeat_summary["total_retries"] or 0)
        repeat_executions = repeat_execution_counts(db, [run.id]).get(run.id)
    # Items whose outcome never arrived are neither successes nor executions.
    outcome = execution_outcomes(db, [run])[run.id]
    not_received_count = sum(
        item_not_received(outcome, run.samples, it.error, it.output, it.latency_ms)
        for it in items
    )
    success_count = total_items - error_count - not_received_count
    completed_count = len(
        [it for it in items if (it.output is not None) or (it.error is not None)]
    )

    expected_total = None
    if isinstance(run.run_metadata, dict):
        try:
            if run.run_metadata.get("total_items") is not None:
                expected_total = int(run.run_metadata["total_items"])
        except Exception:
            expected_total = None

    # Avg latency across all items that have latency
    latencies = [it.latency_ms for it in items if it.latency_ms is not None]
    avg_latency_ms = float(sum(latencies) / len(latencies)) if latencies else 0.0
    median_latency_ms = _median(latencies)

    metrics = list(run.metrics or [])
    metric_means = metric_mean_fields(
        metrics,
        raw_metric_totals(db, [run.id]).get(run.id, {}) if total_items else {},
        mean_task_errors(run.samples, error_count),
        metric_directions(db, [run.id]).get(run.id, {}),
    )

    # Get owner user info
    owner = db.query(User).filter(User.id == run.owner_user_id).first()
    owner_info = None
    if owner:
        owner_info = {
            "id": owner.id,
            "email": owner.email,
            "display_name": owner.display_name or owner.email.split("@")[0],
        }

    project = db.query(Project).filter(Project.id == run.project_id).first()
    project_info = None
    if project:
        project_info = {"id": project.id, "slug": project.slug, "name": project.name}

    # Get approval info if exists
    approval_info = None
    approval = db.query(Approval).filter(Approval.run_id == run.id).first()
    if approval:
        decision_by = None
        if approval.decision_by_user_id:
            decision_user = (
                db.query(User).filter(User.id == approval.decision_by_user_id).first()
            )
            if decision_user:
                decision_by = {
                    "id": decision_user.id,
                    "email": decision_user.email,
                    "display_name": decision_user.display_name
                    or decision_user.email.split("@")[0],
                }
        approval_info = {
            "decision": approval.decision.value if approval.decision else None,
            "decision_at": _iso(approval.decision_at) if approval.decision_at else None,
            "decision_by": decision_by,
            "comment": approval.comment or "",
        }

    # Derive run_name: prefer run_config.run_name, then external_run_id, then run.id
    run_name = ""
    if isinstance(run.run_config, dict):
        run_name = run.run_config.get("run_name", "")
    if not run_name:
        run_name = run.external_run_id or ""

    return {
        "run_id": run.id,
        "run_name": run_name,
        "external_run_id": run.external_run_id or "",
        "task_name": run.task,
        "model_name": _strip_model_provider(run.model or ""),
        "dataset_name": run.dataset,
        "timestamp": _iso(run.started_at or run.created_at),
        "file_path": run.id,  # legacy UI uses file_path as opaque identifier
        "metrics": metrics,
        **metric_means,
        "total_items": total_items,
        # Progress signals for list view (esp. RUNNING).
        "progress_completed": completed_count,
        "progress_total": expected_total,
        "progress_pct": (completed_count / expected_total) if expected_total else None,
        "success_count": success_count,
        "error_count": error_count,
        "not_received_count": not_received_count,
        "execution_error_count": execution_error_count,
        **{k: v for k, v in error_details[run.id].items() if k != "pass_error_counts"},
        "total_retries": total_retries,
        **execution_success_fields(
            total_items - not_received_count, success_count, repeat_executions
        ),
        "avg_latency_ms": avg_latency_ms,
        "median_latency_ms": median_latency_ms,
        "langfuse_url": run.run_metadata.get("langfuse_url")
        if isinstance(run.run_metadata, dict)
        else None,
        "langfuse_dataset_id": run.run_metadata.get("langfuse_dataset_id")
        if isinstance(run.run_metadata, dict)
        else None,
        "langfuse_run_id": run.run_metadata.get("langfuse_run_id")
        if isinstance(run.run_metadata, dict)
        else None,
        "status": run.status,
        "run_config": run.run_config if isinstance(run.run_config, dict) else {},
        "owner": owner_info,
        "project": project_info,
        "approval": approval_info,
    }


_LIVE_RUN_STATUSES = {RunWorkflowStatus.RUNNING, RunWorkflowStatus.PENDING}


def _live_run_summary(
    run: Run,
    *,
    project: Optional[Project],
    owner: Optional[User],
    item_agg: Dict[str, Any],
    dataset_fields: Optional[Dict[str, Any]] = None,
    stop_requested: bool = False,
) -> Dict[str, Any]:
    expected_total = None
    if isinstance(run.run_metadata, dict):
        try:
            if run.run_metadata.get("total_items") is not None:
                expected_total = int(run.run_metadata["total_items"])
        except Exception:
            expected_total = None

    completed_count = int(item_agg.get("completed") or 0)
    run_name = ""
    if isinstance(run.run_config, dict):
        run_name = str(run.run_config.get("run_name") or "")
    if not run_name:
        run_name = run.external_run_id or ""

    owner_info = None
    if owner:
        owner_info = {
            "id": owner.id,
            "email": owner.email,
            "display_name": owner.display_name or owner.email.split("@")[0],
        }

    project_info = None
    if project:
        project_info = {"id": project.id, "slug": project.slug, "name": project.name}

    return {
        "run_id": run.id,
        "run_name": run_name,
        "external_run_id": run.external_run_id or "",
        "task_name": run.task,
        "dataset_name": run.dataset,
        "dataset_version": (dataset_fields or {}).get("dataset_version"),
        "dataset_aliases": (dataset_fields or {}).get("dataset_aliases", []),
        "model_name": _strip_model_provider(run.model or ""),
        "status": run.status.value
        if hasattr(run.status, "value")
        else str(run.status or ""),
        "status_reason": run.status_reason,
        "stop_requested": stop_requested,
        "can_force_stop": can_force_stop_run(run),
        "ended_at": _iso(run.ended_at) if run.ended_at else None,
        "timestamp": _iso(run.started_at or run.created_at),
        "started_at": _iso(run.started_at) if run.started_at else None,
        "last_event_at": _iso(run.last_event_at or run.updated_at or run.created_at),
        "progress_completed": completed_count,
        "progress_total": expected_total,
        "progress_pct": (completed_count / expected_total) if expected_total else None,
        "total_items": int(item_agg.get("total") or 0),
        "error_count": int(item_agg.get("error_count") or 0),
        "execution_error_count": int(
            item_agg.get("execution_error_count", item_agg.get("error_count")) or 0
        ),
        "samples": int(getattr(run, "samples", 1) or 1),
        "last_completed_pass": (
            run.run_metadata.get("last_completed_pass")
            if isinstance(run.run_metadata, dict)
            else None
        ),
        "owner": owner_info,
        "project": project_info,
    }


def _summarize_runs_for_admin(db: Session, runs: List[Run]) -> List[Dict[str, Any]]:
    if not runs:
        return []

    run_ids = [run.id for run in runs]
    item_agg_rows = (
        db.query(
            RunItem.run_id,
            func.count().label("total"),
            func.count(case((RunItem.error.isnot(None), 1))).label("error_count"),
            func.count(
                case(((RunItem.output.isnot(None)) | (RunItem.error.isnot(None)), 1))
            ).label("completed"),
        )
        .filter(RunItem.run_id.in_(run_ids))
        .group_by(RunItem.run_id)
        .all()
    )
    item_agg = {
        row.run_id: {
            "total": row.total,
            "error_count": row.error_count,
            "completed": row.completed,
        }
        for row in item_agg_rows
    }
    published = _published_run_rows(db, run_ids)
    execution_error_pairs = _execution_error_pairs_for_runs(
        db,
        [rid for rid in run_ids if rid not in published],
        samples_by_run={run.id: int(getattr(run, "samples", 1) or 1) for run in runs},
    )
    for run_id in run_ids:
        item_agg.setdefault(
            run_id,
            {"total": 0, "error_count": 0, "completed": 0},
        )["execution_error_count"] = (
            int(
                published[run_id].get(
                    "execution_error_count", published[run_id].get("error_count", 0)
                )
            )
            if run_id in published
            else len(execution_error_pairs.get(run_id, set()))
        )
    project_ids = {run.project_id for run in runs}
    owner_ids = {run.owner_user_id for run in runs}
    projects = (
        db.query(Project).filter(Project.id.in_(project_ids)).all()
        if project_ids
        else []
    )
    owners = db.query(User).filter(User.id.in_(owner_ids)).all() if owner_ids else []
    project_map = {project.id: project for project in projects}
    owner_map = {owner.id: owner for owner in owners}
    dataset_info = _dataset_version_info_map(db, runs)
    stopping_jobs = stop_requested_job_ids(
        db,
        [run.experiment_job_id for run in runs if run.status in _LIVE_RUN_STATUSES],
    )

    return [
        _live_run_summary(
            run,
            project=project_map.get(run.project_id),
            owner=owner_map.get(run.owner_user_id),
            item_agg=item_agg.get(run.id, {}),
            dataset_fields=_dataset_version_fields(run, dataset_info),
            stop_requested=bool(
                run.status in _LIVE_RUN_STATUSES
                and run.experiment_job_id in stopping_jobs
            ),
        )
        for run in runs
    ]


@router.get("/", response_model=None)
def dashboard_index(request: Request, db: Session = Depends(get_db)) -> Any:
    redirect = _maybe_redirect_to_login(request, db)
    if redirect:
        return redirect
    idx = _platform_static_projects()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Projects UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/projects/{project_slug}", response_model=None)
def dashboard_project_index(
    project_slug: str, request: Request, db: Session = Depends(get_db)
) -> Any:
    guarded = _guard_project_page(request, db, project_slug)
    if guarded:
        return guarded
    idx = _platform_static_dashboard_index()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Dashboard UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/profile", response_model=None)
def profile_index(request: Request, db: Session = Depends(get_db)) -> Any:
    redirect = _maybe_redirect_to_login(request, db)
    if redirect:
        return redirect
    idx = _platform_static_profile_index()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Profile UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/admin", response_model=None)
def admin_index(request: Request, db: Session = Depends(get_db)) -> Any:
    redirect = _maybe_redirect_to_login(request, db)
    if redirect:
        return redirect
    idx = _platform_static_admin_index()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Admin UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/compare", response_model=None)
def compare_index(request: Request, db: Session = Depends(get_db)) -> Any:
    redirect = _maybe_redirect_to_login(request, db)
    if redirect:
        return redirect
    idx = _platform_static_dashboard_compare()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Compare UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/docs-guide", response_model=None)
def docs_guide_index(request: Request, db: Session = Depends(get_db)) -> Any:
    redirect = _maybe_redirect_to_login(request, db)
    if redirect:
        return redirect
    idx = _platform_static_docs_guide()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Docs UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/trash", response_model=None)
def trash_index(request: Request, db: Session = Depends(get_db)) -> Any:
    redirect = _maybe_redirect_to_login(request, db)
    if redirect:
        return redirect
    idx = _platform_static_dir() / "dashboard" / "trash.html"
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Trash UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/reviews", response_model=None)
def reviews_index(request: Request, db: Session = Depends(get_db)) -> Any:
    redirect = _maybe_redirect_to_login(request, db)
    if redirect:
        return redirect
    idx = _platform_static_dir() / "dashboard" / "reviews.html"
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Reviews UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/projects/{project_slug}/reviews", response_model=None)
def project_reviews_index(
    project_slug: str, request: Request, db: Session = Depends(get_db)
) -> Any:
    guarded = _guard_project_page(request, db, project_slug, allow_archived=False)
    if guarded:
        return guarded
    return reviews_index(request=request, db=db)


@router.get("/projects/{project_slug}/charts", response_model=None)
def project_charts(
    project_slug: str, request: Request, db: Session = Depends(get_db)
) -> Any:
    guarded = _guard_project_page(request, db, project_slug)
    if guarded:
        return guarded
    idx = _platform_static_charts()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Charts UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/projects/{project_slug}/models", response_model=None)
def project_models(
    project_slug: str, request: Request, db: Session = Depends(get_db)
) -> Any:
    guarded = _guard_project_page(request, db, project_slug)
    if guarded:
        return guarded
    idx = _platform_static_models()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Models UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/projects/{project_slug}/experiments", response_model=None)
def project_experiments(
    project_slug: str, request: Request, db: Session = Depends(get_db)
) -> Any:
    guarded = _guard_project_page(request, db, project_slug)
    if guarded:
        return guarded
    idx = _platform_static_experiments()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Experiments UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/projects/{project_slug}/experiments/queue", response_model=None)
def project_experiments_queue(
    project_slug: str, request: Request, db: Session = Depends(get_db)
) -> Any:
    guarded = _guard_project_page(request, db, project_slug)
    if guarded:
        return guarded
    idx = _platform_static_eval_queue()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Queue UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/projects/{project_slug}/datasets", response_model=None)
def project_datasets(
    project_slug: str, request: Request, db: Session = Depends(get_db)
) -> Any:
    guarded = _guard_project_page(request, db, project_slug)
    if guarded:
        return guarded
    idx = _platform_static_datasets()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Datasets UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/projects/{project_slug}/datasets/{dataset_ref:path}", response_model=None)
def project_dataset_detail(
    project_slug: str, dataset_ref: str, request: Request, db: Session = Depends(get_db)
) -> Any:
    guarded = _guard_project_page(request, db, project_slug)
    if guarded:
        return guarded
    idx = _platform_static_datasets()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Datasets UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/projects/{project_slug}/overview", response_model=None)
def project_overview(
    project_slug: str, request: Request, db: Session = Depends(get_db)
) -> Any:
    guarded = _guard_project_page(request, db, project_slug)
    if guarded:
        return guarded
    idx = _platform_static_overview()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Overview UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/projects/{project_slug}/settings", response_model=None)
def project_settings_index(
    project_slug: str, request: Request, db: Session = Depends(get_db)
) -> Any:
    guarded = _guard_project_page(request, db, project_slug)
    if guarded:
        return guarded
    idx = _platform_static_project_settings()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Project settings UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/run/{run_id:path}/analyzer", response_model=None)
def analyzer_ui(run_id: str, request: Request, db: Session = Depends(get_db)) -> Any:
    redirect = _maybe_redirect_to_login(request, db)
    if redirect:
        return redirect
    canonical = _canonical_legacy_analyzer_redirect(run_id, request, db)
    if canonical:
        return canonical
    idx = _platform_static_dashboard_analyzer()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="LLM Analyzer UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/projects/{project_slug}/analysis", response_model=None)
def project_analysis_ui(
    project_slug: str,
    request: Request,
    db: Session = Depends(get_db),
) -> Any:
    """Serve the project's first-class auto-analysis workspace."""
    guarded = _guard_project_page(request, db, project_slug, allow_archived=False)
    if guarded:
        return guarded
    canonical = _canonical_project_analysis_redirect(project_slug, request, db)
    if canonical:
        return canonical
    idx = _platform_static_dashboard_analyzer()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Auto-analysis UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/projects/{project_slug}/runs/{run_id:path}/analyzer", response_model=None)
def project_analyzer_ui(
    project_slug: str,
    run_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> Any:
    guarded = _guard_project_page(request, db, project_slug, allow_archived=False)
    if guarded:
        return guarded
    canonical = _canonical_project_run_analyzer_redirect(
        project_slug, run_id, request, db
    )
    if canonical:
        return canonical
    idx = _platform_static_dashboard_analyzer()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="LLM Analyzer UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/run/{run_id:path}", response_model=None)
def run_ui(run_id: str, request: Request, db: Session = Depends(get_db)) -> Any:
    redirect = _maybe_redirect_to_login(request, db)
    if redirect:
        return redirect
    idx = _platform_static_dashboard_run()
    if not idx.exists():
        raise HTTPException(status_code=404, detail="Run UI not found")
    return _dashboard_html_response(idx, request)


@router.get("/projects/{project_slug}/runs/{run_id:path}", response_model=None)
def project_run_ui(
    project_slug: str, run_id: str, request: Request, db: Session = Depends(get_db)
) -> Any:
    guarded = _guard_project_page(request, db, project_slug)
    if guarded:
        return guarded
    return run_ui(run_id=run_id, request=request, db=db)


def _published_run_rows(db: Session, run_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """Reuse the last complete publication during background summary refreshes."""
    from qym_platform.db.dashboard_models import (
        DashboardRunDimension,
        DashboardRunSummary,
    )

    return {
        dimension.run_key: {**(dimension.descriptor or {}), **(summary.data or {})}
        for dimension, summary in db.query(DashboardRunDimension, DashboardRunSummary)
        .join(
            DashboardRunSummary,
            DashboardRunSummary.run_key == DashboardRunDimension.run_key,
        )
        .filter(
            DashboardRunDimension.run_key.in_(run_ids),
            DashboardRunDimension.present.is_(True),
            DashboardRunSummary.projection_revision > 0,
        )
        .all()
    }


@router.get("/api/runs")
def legacy_list_runs(
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    project_slug: Optional[str] = Query(default=None),
    status: Optional[str] = Query(
        default=None,
        description="Filter by run workflow status; comma-separated values allowed",
    ),
    exclude_live: bool = Query(
        default=False, description="Exclude live run statuses from the result set"
    ),
    include_total: bool = Query(
        default=True,
        description=(
            "Compute total_count. Defaults to true so existing clients are "
            "unaffected; pagers that already know the total can pass false to "
            "skip a full count on every page."
        ),
    ),
    user: Optional[str] = Query(
        default=None, description="Filter by run owner user id, email, or display name"
    ),
    user_id: Optional[str] = Query(
        default=None, description="Filter by run owner user id"
    ),
    owner_user_id: Optional[str] = Query(
        default=None, description="Filter by run owner user id"
    ),
    origin: Optional[str] = Query(
        default=None,
        description=(
            "Filter by run origin: 'official' (dispatched by the platform and "
            "verified at ingest), 'local', or 'all' (default)"
        ),
    ),
    versioning: Optional[List[str]] = Query(
        default=None,
        description=(
            "Filter by the Evaluation Service's versioning_metadata as key=value "
            "(any key, e.g. agent_version=v1.12). Repeat a key to match any of its "
            "values; different keys must all match. key=__empty__ matches runs "
            "without the key."
        ),
    ),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    try:
        origin_filter = parse_origin_filter(origin)
        versioning_filter = parse_versioning_params(versioning)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    # A unique tie-breaker keeps offset pages disjoint when runs share a timestamp.
    q = Run.active(db).order_by(Run.created_at.desc(), Run.id.asc())

    selected_project = None
    if project_slug:
        # An archived project's runs list stays readable to its members.
        selected_project = project_for_read_by_slug(db, principal, project_slug)
    else:
        if principal.auth_type == "none" or principal.user.role == UserRole.ADMIN:
            selected_project = (
                db.query(Project)
                .filter(Project.is_active.is_(True))
                .order_by(Project.name)
                .first()
            )
        else:
            selected_project = (
                db.query(Project)
                .join(ProjectMembership, ProjectMembership.project_id == Project.id)
                .filter(
                    ProjectMembership.user_id == principal.user.id,
                    Project.is_active.is_(True),
                )
                .order_by(Project.name)
                .first()
            )

    if selected_project:
        q = q.filter(Run.project_id == selected_project.id)
    else:
        return {
            "tasks": {},
            "last_updated": to_api_timestamp(utc_now_naive()),
            "total_count": 0,
            "project": None,
        }

    # Filter out hidden tasks
    from qym_platform.settings import PlatformSettings

    settings = PlatformSettings()
    hidden = {t.strip().lower() for t in settings.hidden_tasks.split(",") if t.strip()}
    if hidden:
        q = q.filter(~func.lower(Run.task).in_(hidden))

    if status:
        statuses: list[RunWorkflowStatus] = []
        for raw_status in status.split(","):
            normalized = raw_status.strip().upper()
            if not normalized:
                continue
            try:
                statuses.append(RunWorkflowStatus(normalized))
            except ValueError:
                raise HTTPException(
                    status_code=400, detail=f"Invalid run status: {raw_status}"
                ) from None
        if statuses:
            q = q.filter(Run.status.in_(statuses))
    if exclude_live:
        q = q.filter(~Run.status.in_(_LIVE_RUN_STATUSES))
    if origin_filter is not None:
        q = q.filter(Run.origin == origin_filter)
    if versioning_filter:
        q = q.filter(*versioning_conditions(Run.id, versioning_filter))

    user_filter = (owner_user_id or user_id or user or "").strip()
    if user_filter:
        lowered_user_filter = user_filter.lower()
        q = q.join(User, User.id == Run.owner_user_id).filter(
            or_(
                Run.owner_user_id == user_filter,
                func.lower(User.email) == lowered_user_filter,
                func.lower(User.display_name).like(f"%{lowered_user_filter}%"),
            )
        )

    # Total count before pagination.  The count scans the whole project, so a
    # pager walking N pages paid for it N times; callers that already have it
    # can opt out.
    total_count = q.count() if include_total else None

    # Apply pagination
    runs: List[Run] = (
        q.options(
            load_only(
                Run.id,
                Run.project_id,
                Run.status,
                Run.last_event_at,
                Run.started_at,
                Run.created_at,
                Run.updated_at,
            )
        )
        .offset(offset)
        .limit(limit)
        .all()
    )
    _reconcile_run_liveness(db, runs)

    if not runs:
        return {
            "tasks": {},
            "last_updated": to_api_timestamp(utc_now_naive()),
            "total_count": total_count,
            "project": {
                "id": selected_project.id,
                "slug": selected_project.slug,
                "name": selected_project.name,
            },
        }

    from qym_platform.api.dashboard import _tasks as projected_tasks
    from qym_platform.services.dashboard_summaries import dashboard_freshness

    page_runs = runs
    cached = _published_run_rows(db, [r.id for r in page_runs])
    runs = [r for r in page_runs if r.id not in cached]
    if not runs:
        return {
            "tasks": projected_tasks([cached[r.id] for r in page_runs]),
            "last_updated": to_api_timestamp(utc_now_naive()),
            "total_count": total_count,
            "project": {
                "id": selected_project.id,
                "slug": selected_project.slug,
                "name": selected_project.name,
            },
            **dashboard_freshness(db, [selected_project.id]),
        }

    # Load source configuration/metadata only for unpublished runs, in one
    # query. Published history must not deserialize large saved configurations.
    db.query(Run).filter(Run.id.in_([r.id for r in runs])).all()
    run_ids = [r.id for r in runs]
    metric_specs_by_run = _metric_specs_for_runs(db, run_ids)
    samples_by_run = {
        run.id: int(getattr(run, "samples", 1) or 1) for run in runs
    }
    error_details: Dict[str, Dict[str, Any]] = {}
    execution_error_pairs = _execution_error_pairs_for_runs(
        db, run_ids, samples_by_run=samples_by_run, breakdowns=error_details
    )

    # --- Batch query: item aggregates per run ---
    item_agg_rows = (
        db.query(
            RunItem.run_id,
            func.count().label("total"),
            func.count(case((RunItem.error.isnot(None), 1))).label("error_count"),
            func.count(
                case(((RunItem.output.isnot(None)) | (RunItem.error.isnot(None)), 1))
            ).label("completed"),
            func.coalesce(func.sum(RunItem.retry_count), 0).label("total_retries"),
            func.avg(RunItem.latency_ms).label("avg_latency"),
            func.count(
                case(
                    (
                        not_received_clause(
                            RunItem, Run, completed_review_runs(db, run_ids)
                        ),
                        1,
                    )
                )
            ).label("not_received"),
        )
        .join(Run, Run.id == RunItem.run_id)
        .filter(RunItem.run_id.in_(run_ids))
        .group_by(RunItem.run_id)
        .all()
    )
    item_agg = {
        row.run_id: {
            "total": row.total,
            "error_count": row.error_count,
            "not_received": int(row.not_received or 0),
            "execution_error_count": len(
                execution_error_pairs.get(row.run_id, set())
            ),
            "completed": row.completed,
            "total_retries": int(row.total_retries or 0),
            "avg_latency": float(row.avg_latency)
            if row.avg_latency is not None
            else 0.0,
        }
        for row in item_agg_rows
    }

    latency_rows = (
        db.query(RunItem.run_id, RunItem.latency_ms)
        .filter(RunItem.run_id.in_(run_ids), RunItem.latency_ms.isnot(None))
        .all()
    )
    latency_values_by_run: Dict[str, List[float]] = {}
    for row in latency_rows:
        latency_values_by_run.setdefault(row.run_id, []).append(float(row.latency_ms))
    for run_id, values in latency_values_by_run.items():
        item_agg.setdefault(
            run_id,
            {
                "total": 0,
                "error_count": 0,
                "execution_error_count": len(
                    execution_error_pairs.get(run_id, set())
                ),
                "completed": 0,
                "total_retries": 0,
                "avg_latency": 0.0,
            },
        )["median_latency"] = _median(values)

    # --- Batch query: score totals per run+metric (errors count as 0) ---
    score_totals = raw_metric_totals(db, run_ids)

    # Repeat-run summaries power the pass-dot strip on the runs list. Detailed
    # uncertainty belongs on the run page, where its meaning can be explained;
    # the scan-oriented list intentionally exposes only point estimates.
    sampled_run_ids = [r.id for r in runs if int(getattr(r, "samples", 1) or 1) > 1]
    repeat_attempt_summaries = _repeat_attempt_summaries(db, sampled_run_ids)
    repeat_executions = repeat_execution_counts(db, sampled_run_ids)
    for run_id, attempt_summary in repeat_attempt_summaries.items():
        agg = item_agg.setdefault(
            run_id,
            {
                "total": 0,
                "error_count": 0,
                "execution_error_count": len(
                    execution_error_pairs.get(run_id, set())
                ),
                "completed": 0,
                "total_retries": 0,
                "avg_latency": 0.0,
            },
        )
        if "avg_latency_ms" in attempt_summary:
            agg["avg_latency"] = attempt_summary["avg_latency_ms"]
            agg["median_latency"] = attempt_summary["median_latency_ms"]
        if "total_retries" in attempt_summary:
            agg["total_retries"] = int(attempt_summary["total_retries"] or 0)
    pass_summary_map: Dict[str, List[Dict[str, Any]]] = {}
    pass_analysis_cause_totals: Dict[str, int] = {}
    if sampled_run_ids:
        from qym_platform.db.models import RunItemAttempt, RunItemPassScore

        # Same rule as run means (services/run_means.py): a pass whose scorer
        # or task failed counts as 0, or is left out when lower is better.
        pass_means: Dict[str, Dict[str, Dict[int, Optional[float]]]] = {}
        for rid, by_pass in pass_metric_totals(db, sampled_run_ids).items():
            for (pass_number, metric_name), totals in by_pass.items():
                pass_means.setdefault(rid, {}).setdefault(metric_name, {})[
                    pass_number
                ] = run_metric_mean(totals, 0)

        dot_attempt_rows = (
            db.query(
                RunItemAttempt.run_id,
                RunItemAttempt.pass_number,
                func.count(RunItemAttempt.id).label("n"),
            )
            .filter(
                RunItemAttempt.run_id.in_(sampled_run_ids),
                RunItemAttempt.is_last_attempt.is_(True),
            )
            .group_by(RunItemAttempt.run_id, RunItemAttempt.pass_number)
            .all()
        )
        pass_attempts: Dict[str, Dict[int, int]] = {}
        pass_errors: Dict[str, Dict[int, int]] = {}
        for rid, pass_number, n_attempts in dot_attempt_rows:
            pass_attempts.setdefault(rid, {})[int(pass_number)] = int(n_attempts or 0)
        for rid in sampled_run_ids:
            for _item_id, pass_number in execution_error_pairs.get(rid, set()):
                errors_for_run = pass_errors.setdefault(rid, {})
                errors_for_run[pass_number] = errors_for_run.get(pass_number, 0) + 1

        # A repeat-run diagnosis is stored on the pass score, not on the
        # reduced RunItem.  Keep the runs-list chip scoped to that pass so a
        # diagnosis on one sample cannot appear on every sample row.
        # Only pass scores that carry an analysis payload can contribute a
        # cause; the loop below discards the rest.  Applying that predicate in
        # SQL and streaming the result keeps this independent of pass volume.
        pass_analysis_rows = (
            db.query(
                RunItemPassScore.run_id,
                RunItemPassScore.pass_number,
                RunItemPassScore.meta,
            )
            .filter(
                RunItemPassScore.run_id.in_(sampled_run_ids),
                cast(RunItemPassScore.meta, Text).like(
                    f'%"{PASS_ANALYSIS_META_KEY}"%'
                ),
            )
            .yield_per(1000)
        )
        pass_analysis_causes: Dict[str, Dict[int, set[str]]] = {}
        for rid, pass_number, meta in pass_analysis_rows:
            analysis = (
                meta.get(PASS_ANALYSIS_META_KEY)
                if isinstance(meta, dict)
                else None
            )
            if not isinstance(analysis, dict):
                continue
            pass_analysis_causes.setdefault(rid, {}).setdefault(
                int(pass_number), set()
            ).update(analysis_root_causes(analysis))

        for r in runs:
            k = int(getattr(r, "samples", 1) or 1)
            if k <= 1:
                continue
            primary = primary_metric(r.metrics, metric_specs_by_run.get(r.id) or {})
            means = (pass_means.get(r.id) or {}).get(primary, {}) if primary else {}
            attempts = pass_attempts.get(r.id, {})
            errors = pass_errors.get(r.id, {})
            retries = (repeat_attempt_summaries.get(r.id) or {}).get(
                "retry_counts_by_pass", {}
            )
            last_completed = 0
            if isinstance(r.run_metadata, dict):
                try:
                    last_completed = int(r.run_metadata.get("last_completed_pass") or 0)
                except (TypeError, ValueError):
                    last_completed = 0
            run_status = str(getattr(r.status, "value", r.status) or "").upper()
            summaries: List[Dict[str, Any]] = []
            for p in range(1, k + 1):
                has_data = p in means or p in attempts
                p_status = _repeat_pass_status(
                    pass_number=p,
                    last_completed=last_completed,
                    has_data=has_data,
                    run_status=run_status,
                )
                summaries.append(
                    {
                        "pass_number": p,
                        "status": p_status,
                        "primary_metric": primary,
                        "primary_score": means.get(p),
                        "error_count": errors.get(p, 0),
                        **error_details[r.id]["pass_error_counts"].get(
                            p,
                            {
                                "task_error_count": 0,
                                "metric_error_count": 0,
                                "metric_error_counts": {},
                            },
                        ),
                        "retry_count": int(retries.get(p, 0) or 0),
                        "analysis_cause_count": len(
                            (pass_analysis_causes.get(r.id) or {}).get(p, set())
                        ),
                    }
                )
            pass_summary_map[r.id] = summaries
            # The aggregate row represents the whole repeat run.  Its chip
            # therefore totals each sample's diagnosis count, including the
            # same category when it appears on multiple samples.
            pass_analysis_cause_totals[r.id] = sum(
                len((pass_analysis_causes.get(r.id) or {}).get(p, set()))
                for p in range(1, k + 1)
            )

    # --- Batch query: approvals ---
    approvals = db.query(Approval).filter(Approval.run_id.in_(run_ids)).all()
    approval_map = {a.run_id: a for a in approvals}

    # --- Batch query: distinct root-cause counts per run ---
    # Powers the runs-table ANALYSIS column. The LIKE prefilter keeps the scan
    # to items that carry any analysis data; cause extraction is done in Python
    # so the JSON handling is identical on PostgreSQL and SQLite.
    analysis_rows = (
        db.query(RunItem.run_id, RunItem.item_metadata)
        .filter(
            RunItem.run_id.in_(run_ids),
            cast(RunItem.item_metadata, Text).like('%"root_cause"%'),
        )
        .yield_per(1000)
    )
    analysis_causes: Dict[str, set] = {}
    for row in analysis_rows:
        md = row.item_metadata if isinstance(row.item_metadata, dict) else {}
        causes = analysis_causes.setdefault(row.run_id, set())
        legacy = str(md.get("root_cause") or "").strip()
        if legacy:
            causes.add(legacy)
        metric_analyses = md.get("metric_analyses")
        if isinstance(metric_analyses, dict):
            for entry in metric_analyses.values():
                if isinstance(entry, dict):
                    cause = str(entry.get("root_cause") or "").strip()
                    if cause:
                        causes.add(cause)

    # --- Batch query: all referenced users ---
    user_ids = {r.owner_user_id for r in runs}
    user_ids |= {a.decision_by_user_id for a in approvals if a.decision_by_user_id}
    users = db.query(User).filter(User.id.in_(user_ids)).all()
    user_map = {u.id: u for u in users}

    # --- Build summaries from pre-fetched data ---
    dataset_info = _dataset_version_info_map(db, runs)
    experiment_refs, job_versioning = experiment_refs_and_versioning(
        db, (r.experiment_job_id for r in runs)
    )
    tasks: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
    for r in runs:
        agg = item_agg.get(
            r.id,
            {
                "total": 0,
                "error_count": 0,
                "execution_error_count": len(
                    execution_error_pairs.get(r.id, set())
                ),
                "completed": 0,
                "total_retries": 0,
                "avg_latency": 0.0,
                "median_latency": 0.0,
            },
        )
        total_items = agg["total"]
        error_count = agg["error_count"]
        execution_error_count = int(
            agg.get("execution_error_count", error_count) or 0
        )
        total_retries = int(agg.get("total_retries") or 0)
        not_received_count = int(agg.get("not_received") or 0)
        success_count = total_items - error_count - not_received_count
        completed_count = agg["completed"]
        started_at = r.started_at or r.created_at
        ended_at = r.ended_at
        duration_ms = None
        if started_at and ended_at and ended_at >= started_at:
            duration_ms = (ended_at - started_at).total_seconds() * 1000.0
        repeat_duration = repeat_attempt_summaries.get(r.id, {}).get("duration_ms")
        if repeat_duration is not None:
            duration_ms = repeat_duration

        expected_total = None
        if isinstance(r.run_metadata, dict):
            try:
                if r.run_metadata.get("total_items") is not None:
                    expected_total = int(r.run_metadata["total_items"])
            except Exception:
                expected_total = None

        metrics = list(r.metrics or [])
        metric_means = metric_mean_fields(
            metrics,
            score_totals.get(r.id, {}),
            mean_task_errors(r.samples, error_count),
            {
                name: declared_direction(spec)
                for name, spec in (metric_specs_by_run.get(r.id) or {}).items()
            },
        )

        # Owner info
        owner = user_map.get(r.owner_user_id)
        owner_info = None
        if owner:
            owner_info = {
                "id": owner.id,
                "email": owner.email,
                "display_name": owner.display_name or owner.email.split("@")[0],
            }

        # Approval info
        approval_info = None
        approval = approval_map.get(r.id)
        if approval:
            decision_by = None
            if approval.decision_by_user_id:
                decision_user = user_map.get(approval.decision_by_user_id)
                if decision_user:
                    decision_by = {
                        "id": decision_user.id,
                        "email": decision_user.email,
                        "display_name": decision_user.display_name
                        or decision_user.email.split("@")[0],
                    }
            approval_info = {
                "decision": approval.decision.value if approval.decision else None,
                "decision_at": _iso(approval.decision_at)
                if approval.decision_at
                else None,
                "decision_by": decision_by,
                "comment": approval.comment or "",
            }

        # Derive run_name from run_config without including full config in response
        run_name = ""
        if isinstance(r.run_config, dict):
            run_name = r.run_config.get("run_name", "")
        if not run_name:
            run_name = r.external_run_id or ""

        summary = {
            "run_id": r.id,
            "run_name": run_name,
            "external_run_id": r.external_run_id or "",
            "task_name": r.task,
            "model_name": _strip_model_provider(r.model or ""),
            "dataset_name": r.dataset,
            "dataset_version": _dataset_version_fields(r, dataset_info)[
                "dataset_version"
            ],
            "dataset_aliases": _dataset_version_fields(r, dataset_info)[
                "dataset_aliases"
            ],
            "timestamp": _iso(started_at),
            "file_path": r.id,
            "metrics": metrics,
            "metric_specs": metric_specs_by_run.get(r.id, {}),
            **metric_means,
            "total_items": total_items,
            "progress_completed": completed_count,
            "progress_total": expected_total,
            "progress_pct": (completed_count / expected_total)
            if expected_total
            else None,
            "success_count": success_count,
            "error_count": error_count,
            "not_received_count": not_received_count,
            "execution_error_count": execution_error_count,
            **{
                k: v for k, v in error_details[r.id].items() if k != "pass_error_counts"
            },
            "total_retries": total_retries,
            **execution_success_fields(
                total_items - not_received_count,
                success_count,
                repeat_executions.get(r.id),
            ),
            "avg_latency_ms": agg["avg_latency"],
            "median_latency_ms": agg.get("median_latency", 0.0),
            "duration_ms": duration_ms,
            "langfuse_url": r.run_metadata.get("langfuse_url")
            if isinstance(r.run_metadata, dict)
            else None,
            "langfuse_dataset_id": r.run_metadata.get("langfuse_dataset_id")
            if isinstance(r.run_metadata, dict)
            else None,
            "langfuse_run_id": r.run_metadata.get("langfuse_run_id")
            if isinstance(r.run_metadata, dict)
            else None,
            "status": r.status,
            "run_config": {},  # Omit full config from list view for payload size
            "samples": int(getattr(r, "samples", 1) or 1),
            "report_k": (
                r.run_config.get("report_k") if isinstance(r.run_config, dict) else None
            ),
            "pass_summaries": pass_summary_map.get(r.id) or None,
            "last_completed_pass": (
                r.run_metadata.get("last_completed_pass")
                if isinstance(r.run_metadata, dict)
                else None
            ),
            "git_branch": r.run_config.get("git_branch")
            if isinstance(r.run_config, dict)
            else None,
            "git_commit": r.run_config.get("git_commit")
            if isinstance(r.run_config, dict)
            else None,
            "owner": owner_info,
            "approval": approval_info,
            "analysis_cause_count": (
                pass_analysis_cause_totals[r.id]
                if int(getattr(r, "samples", 1) or 1) > 1
                and pass_analysis_cause_totals.get(r.id, 0) > 0
                else len(analysis_causes.get(r.id, ()))
            ),
            "trace_stats": r.run_metadata.get("trace_stats")
            if isinstance(r.run_metadata, dict)
            else None,
            "product_eval": r.run_metadata.get("product_eval")
            if isinstance(r.run_metadata, dict)
            else None,
            **run_origin_fields(r, experiment_refs),
            "versioning": job_versioning.get(r.experiment_job_id or "", {}),
            "ingest_incomplete": runs_list_ingest_flag(r.run_metadata),
        }

        task = summary["task_name"]
        model = summary["model_name"] or "nomodel"
        tasks.setdefault(task, {}).setdefault(model, []).append(summary)

    if cached:
        source_rows = {
            row["run_id"]: row
            for models in tasks.values()
            for rows in models.values()
            for row in rows
        }
        tasks = projected_tasks(
            [cached.get(r.id) or source_rows[r.id] for r in page_runs]
        )

    return {
        "tasks": tasks,
        "last_updated": to_api_timestamp(utc_now_naive()),
        "total_count": total_count,
        "project": {
            "id": selected_project.id,
            "slug": selected_project.slug,
            "name": selected_project.name,
        },
    }


@router.get("/api/runs/live")
def list_live_runs(
    limit: int = Query(default=25, ge=1, le=100),
    project_slug: Optional[str] = Query(default=None),
    all_projects: bool = Query(default=False),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    q = (
        Run.active(db)
        .filter(Run.status.in_(_LIVE_RUN_STATUSES))
        .order_by(Run.last_event_at.desc(), Run.created_at.desc())
    )
    selected_project = None

    if all_projects:
        if principal.auth_type != "none" and principal.user.role != UserRole.ADMIN:
            raise HTTPException(status_code=403, detail="Admin only")
        q = q.join(Project, Project.id == Run.project_id).filter(
            Project.is_active.is_(True)
        )
    elif project_slug:
        selected_project = project_for_read_by_slug(db, principal, project_slug)
        q = q.filter(Run.project_id == selected_project.id)
    else:
        if principal.auth_type == "none" or principal.user.role == UserRole.ADMIN:
            selected_project = (
                db.query(Project)
                .filter(Project.is_active.is_(True))
                .order_by(Project.name)
                .first()
            )
        else:
            selected_project = (
                db.query(Project)
                .join(ProjectMembership, ProjectMembership.project_id == Project.id)
                .filter(
                    ProjectMembership.user_id == principal.user.id,
                    Project.is_active.is_(True),
                )
                .order_by(Project.name)
                .first()
            )
        if selected_project:
            q = q.filter(Run.project_id == selected_project.id)
        else:
            return {
                "runs": [],
                "total_count": 0,
                "last_updated": to_api_timestamp(utc_now_naive()),
                "project": None,
            }

    candidates: List[Run] = q.limit(500).all()
    _reconcile_run_liveness(db, candidates)

    total_count = q.count()
    runs: List[Run] = q.limit(limit).all()
    if not runs:
        return {
            "runs": [],
            "total_count": total_count,
            "last_updated": to_api_timestamp(utc_now_naive()),
            "project": (
                {
                    "id": selected_project.id,
                    "slug": selected_project.slug,
                    "name": selected_project.name,
                }
                if selected_project
                else None
            ),
        }

    return {
        "runs": _summarize_runs_for_admin(db, runs),
        "total_count": total_count,
        "last_updated": to_api_timestamp(utc_now_naive()),
        "project": (
            {
                "id": selected_project.id,
                "slug": selected_project.slug,
                "name": selected_project.name,
            }
            if selected_project
            else None
        ),
    }


@router.get("/api/runs/recent")
def list_recent_runs(
    global_limit: int = Query(default=20, ge=1, le=100),
    global_offset: int = Query(default=0, ge=0),
    per_project_limit: int = Query(default=5, ge=1, le=25),
    include_projects: bool = Query(default=True),
    all_projects: bool = Query(default=False),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    if not all_projects:
        raise HTTPException(status_code=400, detail="all_projects=true is required")
    if principal.auth_type != "none" and principal.user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")

    base_q = (
        Run.active(db)
        .join(Project, Project.id == Run.project_id)
        .filter(Project.is_active.is_(True), ~Run.status.in_(_LIVE_RUN_STATUSES))
    )
    total_count = base_q.count()
    global_runs = (
        base_q.order_by(Run.created_at.desc())
        .offset(global_offset)
        .limit(global_limit)
        .all()
    )

    project_sections: List[Dict[str, Any]] = []
    if include_projects:
        projects = (
            db.query(Project)
            .filter(Project.is_active.is_(True))
            .order_by(Project.name.asc())
            .all()
        )
        for project in projects:
            project_runs = (
                Run.active(db)
                .filter(
                    Run.project_id == project.id, ~Run.status.in_(_LIVE_RUN_STATUSES)
                )
                .order_by(Run.created_at.desc())
                .limit(per_project_limit)
                .all()
            )
            if not project_runs:
                continue
            project_sections.append(
                {
                    "project": {
                        "id": project.id,
                        "slug": project.slug,
                        "name": project.name,
                    },
                    "runs": _summarize_runs_for_admin(db, project_runs),
                }
            )

    return {
        "runs": _summarize_runs_for_admin(db, global_runs),
        "projects": project_sections,
        "total_count": total_count,
        "global_limit": global_limit,
        "global_offset": global_offset,
        "last_updated": to_api_timestamp(utc_now_naive()),
    }


def _parse_requested_run_ids(files: List[str]) -> list[str]:
    run_ids: list[str] = []
    for f in files:
        for part in str(f).split(","):
            p = part.strip()
            if p:
                run_ids.append(p)
    return run_ids


def _run_display_name(run: Run) -> str:
    run_config = run.run_config if isinstance(run.run_config, dict) else {}
    run_name = ""
    if isinstance(run_config, dict):
        run_name = run_config.get("run_name", "")
    return run_name or run.external_run_id or run.id


def _models_errored_passes(
    db: Session, samples_by_run: Dict[str, int], metrics: Optional[List[str]] = None
) -> Dict[tuple[str, str], Dict[str, Dict[str, list]]]:
    """Pass scores of repeat items with a scorer- or task-error pass.

    ``(run_id, item_id) -> {"scores": {metric: [score per pass]}, "meta":
    {metric: [meta per pass]}}``, in the row shape of the run payload
    (``pass_scores``/``pass_metric_meta``) with only the error markers
    (``status``, or the "error" label of a failed task) in the meta.
    """
    from qym_platform.db.models import RunItemPassScore

    if not samples_by_run:
        return {}
    affected = errored_pass_items(db, list(samples_by_run), metrics)
    result: Dict[tuple[str, str], Dict[str, Dict[str, list]]] = {}
    items = sorted({(run_id, item_id) for run_id, item_id, _ in affected})
    for start in range(0, len(items), 400):
        chunk = items[start : start + 400]
        for run_id, item_id, metric_name, number, score, meta, label, explanation in (
            db.query(
                RunItemPassScore.run_id,
                RunItemPassScore.item_id,
                RunItemPassScore.metric_name,
                RunItemPassScore.pass_number,
                RunItemPassScore.score_numeric,
                RunItemPassScore.meta,
                RunItemPassScore.label,
                RunItemPassScore.explanation,
            )
            .filter(
                RunItemPassScore.run_id.in_({run_id for run_id, _ in chunk}),
                RunItemPassScore.item_id.in_({item_id for _, item_id in chunk}),
            )
            .all()
        ):
            if (run_id, item_id, metric_name) not in affected:
                continue
            samples = samples_by_run[run_id]
            index = int(number) - 1
            if not 0 <= index < samples:
                continue
            entry = result.setdefault((run_id, item_id), {"scores": {}, "meta": {}})
            scores = entry["scores"].setdefault(metric_name, [None] * samples)
            metas = entry["meta"].setdefault(metric_name, [None] * samples)
            scores[index] = score
            if is_metric_error(meta):
                metas[index] = {"status": meta.get("status")}
            elif is_task_error_pass(label, meta, explanation):
                metas[index] = {"label": "error", TASK_ERROR_PASS_MARKER: True}
    return result


def _build_models_runs_data(
    db: Session, runs: list[Run], metric: Optional[str] = None
) -> list[dict[str, Any]]:
    """Item-level rows of the Models view; ``metric`` reads that metric's
    scores only (server-side K-run statistics, services/model_stats.py)."""
    if not runs:
        return []

    run_ids = [run.id for run in runs]
    metric_specs_by_run = _metric_specs_for_runs(db, run_ids)
    metrics_by_run = {run.id: list(run.metrics or []) for run in runs}
    dataset_info = _dataset_version_info_map(db, runs)
    runs_data: dict[str, dict[str, Any]] = {}
    stats_by_run: dict[str, dict[str, Any]] = {}

    for run in runs:
        metrics = metrics_by_run[run.id]
        stats = {
            "total": 0,
            "completed": 0,
            "in_progress": 0,
            "pending": 0,
            "failed": 0,
            "not_received": 0,
        }
        stats_by_run[run.id] = stats
        _dsv = _dataset_version_fields(run, dataset_info)
        runs_data[run.id] = {
            "run": {
                "run_id": run.id,
                "file_path": run.id,
                "run_name": _run_display_name(run),
                "metric_names": metrics,
                "metric_specs": metric_specs_by_run.get(run.id, {}),
                "task_name": run.task,
                "dataset_name": run.dataset,
                "dataset_version": _dsv["dataset_version"],
                "dataset_aliases": _dsv["dataset_aliases"],
                "model_name": _strip_model_provider(run.model or ""),
                "samples": int(getattr(run, "samples", 1) or 1),
            },
            "snapshot": {
                "rows": [],
                "stats": stats,
                "metric_names": metrics,
                "metric_specs": metric_specs_by_run.get(run.id, {}),
            },
        }

    # Errors follow the run-mean rule here too (metrics.js getRowScore): a
    # scorer error carries its status (read with the scores, in one scan),
    # and a repeat item with an errored pass carries that metric's passes
    # (the only pass data in this payload), so a lower-is-better metric is
    # judged without them.
    score_rows = (
        db.query(
            RunItemScore.run_id,
            RunItemScore.item_id,
            RunItemScore.metric_name,
            RunItemScore.score_numeric,
            RunItemScore.score_raw,
            RunItemScore.meta["status"].as_string(),
        )
        .filter(
            RunItemScore.run_id.in_(run_ids),
            *([RunItemScore.metric_name == metric] if metric is not None else []),
        )
        .all()
    )
    score_by_run_item: dict[tuple[str, str], dict[str, Any]] = {}
    error_meta: dict[tuple[str, str], dict[str, Any]] = {}
    for run_id, item_id, metric_name, score_numeric, score_raw, status in score_rows:
        value = score_numeric if score_numeric is not None else score_raw
        score_by_run_item.setdefault((run_id, item_id), {})[metric_name] = value
        if status is not None and is_metric_error({"status": status}):
            error_meta.setdefault((run_id, item_id), {})[metric_name] = {
                "status": status
            }
    errored_passes = _models_errored_passes(
        db,
        {
            run.id: int(getattr(run, "samples", 1) or 1)
            for run in runs
            if int(getattr(run, "samples", 1) or 1) > 1
        },
        [metric] if metric is not None else None,
    )

    item_rows = (
        db.query(
            RunItem.run_id,
            RunItem.item_id,
            RunItem.index,
            RunItem.error,
            RunItem.latency_ms,
        )
        .filter(RunItem.run_id.in_(run_ids))
        .order_by(RunItem.run_id.asc(), RunItem.index.asc())
        .all()
    )
    # Outputs stay unread here: the few items never received come from SQL,
    # and only for the runs with a candidate (no error and no latency).
    outcomes = execution_outcomes(db, runs)
    candidate_runs = {
        run.id
        for run in runs
        if item_not_received(outcomes[run.id], run.samples, None, None, None)
    }
    not_received = not_received_items(
        db,
        sorted(
            {
                item.run_id
                for item in item_rows
                if item.run_id in candidate_runs
                and item.error is None
                and item.latency_ms is None
            }
        ),
    )
    samples_by_run = {run.id: int(getattr(run, "samples", 1) or 1) for run in runs}

    for item in item_rows:
        run_data = runs_data.get(item.run_id)
        if not run_data:
            continue
        metrics = metrics_by_run.get(item.run_id, [])
        item_scores = score_by_run_item.get((item.run_id, item.item_id), {})
        status = (
            "error"
            if item.error
            else "not_received"
            if item.item_id in not_received.get(item.run_id, ())
            else "completed"
        )
        stats = stats_by_run[item.run_id]
        stats["total"] += 1
        if status == "error":
            stats["failed"] += 1
        elif status == "not_received":
            stats["not_received"] += 1
        else:
            stats["completed"] += 1

        row = {
            "index": item.index,
            "item_id": item.item_id,
            "status": status,
            "latency_ms": item.latency_ms or 0,
            "metric_values": [
                item_scores.get(metric_name, "") for metric_name in metrics
            ],
        }
        if (item.run_id, item.item_id) in error_meta:
            row["metric_meta"] = error_meta[(item.run_id, item.item_id)]
        passes = errored_passes.get((item.run_id, item.item_id))
        if passes:
            row["pass_scores"] = passes["scores"]
            row["pass_metric_meta"] = passes["meta"]
        elif item.error and samples_by_run.get(item.run_id, 1) > 1:
            # A repeat item's error is only its last pass's. With no errored
            # pass to ship (a reviewer scored it as a whole), the row still
            # reads as a repeat row, judged per pass (metrics.js
            # isRepeatAggregateRow), never as an item-level task error.
            row["pass_scores"] = {}
        run_data["snapshot"]["rows"].append(row)
    for run_id in {run_id for run_id, _ in errored_passes}:
        if run_id in runs_data:
            # Only errored items carry passes: not a per-pass snapshot.
            runs_data[run_id]["snapshot"]["pass_scores_scope"] = "errored"

    repeat_executions = repeat_execution_counts(
        db,
        [run.id for run in runs if int(getattr(run, "samples", 1) or 1) > 1],
        prefer_published=True,
    )
    for run_id, stats in stats_by_run.items():
        _apply_execution_stats(stats, repeat_executions.get(run_id))
        runs_data[run_id]["snapshot"]["stats"] = stats

    return [runs_data[run.id] for run in runs if run.id in runs_data]


@router.get("/api/models/runs")
def models_runs_data(
    files: List[str] = Query(default=[]),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Return lightweight per-run snapshots for the Models view."""
    if not files:
        raise HTTPException(status_code=400, detail="No files specified")

    requested_run_ids = _parse_requested_run_ids(files)

    unique_run_ids: list[str] = []
    seen_run_ids: set[str] = set()
    for run_id in requested_run_ids:
        if run_id in seen_run_ids:
            continue
        seen_run_ids.add(run_id)
        unique_run_ids.append(run_id)

    runs = Run.active(db).filter(Run.id.in_(unique_run_ids)).all()
    runs_by_id = {run.id: run for run in runs}
    accessible_runs: list[Run] = []
    for run_id in unique_run_ids:
        run = runs_by_id.get(run_id)
        if not run:
            continue
        if can_view_run(db, principal, run):
            accessible_runs.append(run)

    runs_data = _build_models_runs_data(db, accessible_runs)
    return {"runs": runs_data}


@router.get("/api/compare")
def legacy_compare(
    files: List[str] = Query(default=[]),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
    view: Optional[str] = None,
) -> Dict[str, Any]:
    """Return multiple run snapshots for comparison.

    The static dashboard expects query param(s) named `files` containing opaque run identifiers.
    In the platform, `file_path` is the run_id, so we accept run IDs here.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files specified")
    # Each run is built once however often it is requested.
    run_ids = list(dict.fromkeys(_parse_requested_run_ids(files)))
    if len(run_ids) > MAX_COMPARE_RUNS:
        # Every run is built in full into one response: bound the request.
        raise HTTPException(
            status_code=422,
            detail=f"Compare at most {MAX_COMPARE_RUNS} runs at once "
            f"({len(run_ids)} requested)",
        )

    runs_data: list[dict[str, Any]] = []
    # Requested runs the caller cannot get (deleted, never existed, or not
    # visible): listed so the page can say so instead of "select 2 runs".
    missing_runs: list[dict[str, str]] = []
    for run_id in run_ids:
        data = legacy_run_data(run_id=run_id, db=db, principal=principal, view=view)
        if not data.get("error"):
            runs_data.append(data)
        else:
            missing_runs.append({"run_id": str(run_id)})

    # Top-level Langfuse config from env vars
    lf_host = os.getenv("LANGFUSE_HOST") or os.getenv("LANGFUSE_BASE_URL", "")
    lf_project_id = os.getenv("LANGFUSE_PROJECT_ID", "")
    # Fallback: extract from the first run's langfuse_url if env vars are incomplete
    if (not lf_host or not lf_project_id) and runs_data:
        first_run = runs_data[0].get("run", {})
        lf_host = lf_host or first_run.get("langfuse_host", "")
        lf_project_id = lf_project_id or first_run.get("langfuse_project_id", "")

    unalignable_runs = [
        {
            "run_name": str(data.get("run", {}).get("run_name") or ""),
            "issues": list(data.get("run", {}).get("compare_alignment_issues") or []),
        }
        for data in runs_data
        if str(data.get("run", {}).get("compare_alignment_status") or "") != "aligned"
    ]
    compare_alignment_status = "unalignable" if unalignable_runs else "aligned"

    return {
        "runs": runs_data,
        "langfuse_host": lf_host,
        "langfuse_project_id": lf_project_id,
        "compare_alignment_status": compare_alignment_status,
        "unalignable_runs": unalignable_runs,
        "missing_runs": missing_runs,
    }


def _can_approve_run(db: Session, principal: Principal, run: Run) -> bool:
    """Check if the principal can approve or reject this run."""
    return permission_can_approve_run(db, principal, run)


def _run_origin_and_panel(
    db: Session, run: Run, principal: Optional[Principal] = None
) -> Dict[str, Any]:
    fields = run_origin_fields(
        run, experiment_refs_for_jobs(db, [run.experiment_job_id])
    )
    panel = run_experiment_panel(db, run)
    if panel is not None and fields["experiment"]:
        panel = {**fields["experiment"], **panel}
    if panel is not None:
        # "Promote to official" (#39) opens the official-defaults editor: managers.
        panel["can_promote"] = bool(
            principal is not None
            and is_project_manager(db, principal, run.project_id)
        )
    return {"origin": fields["origin"], "experiment": panel}


def _build_run_data(
    db: Session,
    run: Run,
    *,
    item_ids: Optional[List[str]] = None,
    compact: bool = False,
    principal: Optional[Principal] = None,
    pass_number: Optional[int] = None,
) -> Dict[str, Any]:
    """Build the run + snapshot data dict used by the UI.

    ``pass_number`` (a one-sample view of a repeat run) loads the attempts,
    outputs and trace aggregates of that pass only; the caller still scopes
    the rows with ``scope_row_to_pass``. Per-pass scores and judge metadata
    of every pass are kept: the row's aggregate metadata is computed from
    them, and whether a metric has per-pass metadata at all decides which
    metadata a pass shows.
    """
    item_query = db.query(RunItem).filter(RunItem.run_id == run.id)
    if item_ids is not None:
        item_query = item_query.filter(RunItem.item_id.in_(item_ids))
    item_query = item_query.order_by(RunItem.index.asc())
    item_count = item_query.count() if compact else None
    items = item_query.yield_per(200) if compact else item_query.all()
    metrics = list(run.metrics or [])
    metric_specs = _metric_specs_for_runs(db, [run.id]).get(run.id, {})
    # Only the columns the rows and issue_review_statuses read: a correction
    # row also carries the item's input/expected/output snapshots.
    corrections = (
        db.query(
            ReviewCorrection.id,
            ReviewCorrection.item_id,
            ReviewCorrection.metric_name,
            ReviewCorrection.pass_number,
            ReviewCorrection.status,
            ReviewCorrection.created_at,
            *ISSUE_REVIEW_COLUMNS,
        )
        .filter(ReviewCorrection.run_id == run.id, ReviewCorrection.is_active.is_(True),
                ReviewCorrection.pass_number.is_(None))
        .filter(
            ReviewCorrection.item_id.in_(item_ids) if item_ids is not None else True
        )
        .order_by(ReviewCorrection.created_at.desc())
        .all()
    )
    correction_by_item: Dict[str, Any] = {}
    corrections_by_item_metric: Dict[str, Dict[str, Any]] = {}
    # Every active correction of an (item, metric, pass) scope: an issue's
    # review status is its correction's, not the issue JSON's (older data
    # can say pending there while the correction is decided).
    issue_reviews: Dict[Any, List[Any]] = {}
    for corr in corrections:
        if corr.metric_name:
            corrections_by_item_metric.setdefault(corr.item_id, {}).setdefault(
                corr.metric_name, corr
            )
            issue_reviews.setdefault((corr.item_id, corr.metric_name, None), []).append(corr)
        else:
            correction_by_item.setdefault(corr.item_id, corr)

    # Read pre-computed trace stats from stored metadata
    run_trace_stats = (
        run.run_metadata.get("trace_stats")
        if isinstance(run.run_metadata, dict)
        else None
    )
    run_config = run.run_config if isinstance(run.run_config, dict) else {}
    run_metadata = public_run_metadata(
        run.run_metadata if isinstance(run.run_metadata, dict) else {}
    )

    # Build per-item score/meta for UI
    # Plain column rows, not ORM objects. The index drops explanations, so
    # compact builds read only whether there is one (its first character).
    scores = (
        db.query(
            RunItemScore.item_id,
            RunItemScore.metric_name,
            RunItemScore.score_raw,
            RunItemScore.score_numeric,
            RunItemScore.meta,
            RunItemScore.label,
            (
                func.substr(RunItemScore.explanation, 1, 1)
                if compact
                else RunItemScore.explanation
            ).label("explanation"),
        )
        .filter(RunItemScore.run_id == run.id)
        .filter(RunItemScore.item_id.in_(item_ids) if item_ids is not None else True)
        .all()
    )
    by_item: Dict[str, Dict[str, Any]] = {}
    for s in scores:
        by_item.setdefault(s.item_id, {})[s.metric_name] = s

    # Repeat runs: per-pass scores power the dot strips in the items table.
    run_samples = int(getattr(run, "samples", 1) or 1)
    repeat_context = has_repeat_pass_context(run)
    execution_error_pairs = _execution_error_pairs_for_runs(
        db,
        [run.id],
        samples_by_run={run.id: run_samples},
        item_ids=item_ids,
    ).get(run.id, set())
    execution_errors_by_item: Dict[str, int] = defaultdict(int)
    for error_item_id, _pass_number in execution_error_pairs:
        execution_errors_by_item[str(error_item_id)] += 1
    pass_scores_by_item: Dict[str, Dict[str, Dict[int, Optional[float]]]] = {}
    pass_meta_by_item: Dict[str, Dict[str, Dict[int, Dict[str, Any]]]] = {}
    pass_analysis_by_item: Dict[str, Dict[str, Dict[int, Dict[str, Any]]]] = {}
    pass_attempts_by_item: Dict[str, Dict[int, Dict[str, Any]]] = {}
    if repeat_context:
        # Plain column rows: a repeat run has items x metrics x passes of
        # these, and ORM identity tracking dominated their load time.
        for ps in (
            db.query(
                RunItemPassScore.item_id,
                RunItemPassScore.metric_name,
                RunItemPassScore.pass_number,
                RunItemPassScore.score_numeric,
                RunItemPassScore.meta,
                RunItemPassScore.label,
                RunItemPassScore.explanation,
            )
            .filter(RunItemPassScore.run_id == run.id)
            .filter(
                RunItemPassScore.item_id.in_(item_ids) if item_ids is not None else True
            )
            .all()
        ):
            pass_scores_by_item.setdefault(ps.item_id, {}).setdefault(
                ps.metric_name, {}
            )[int(ps.pass_number)] = ps.score_numeric
            # Per-pass judge output, same shape as row-level metric_meta.
            ps_meta: dict[str, Any] = dict(ps.meta) if ps.meta else {}
            _set_task_error_flag(ps_meta, ps.label, ps.meta, ps.explanation)
            pass_analysis = ps_meta.pop(PASS_ANALYSIS_META_KEY, None)
            if isinstance(pass_analysis, dict):
                pass_analysis_by_item.setdefault(ps.item_id, {}).setdefault(
                    ps.metric_name, {}
                )[int(ps.pass_number)] = pass_analysis
            if ps.label:
                ps_meta.setdefault("label", ps.label)
            if ps.explanation:
                ps_meta.setdefault("explanation", ps.explanation)
            if ps_meta:
                pass_meta_by_item.setdefault(ps.item_id, {}).setdefault(
                    ps.metric_name, {}
                )[int(ps.pass_number)] = ps_meta
        if pass_analysis_by_item:
            # Only the columns issue_review_statuses reads, as plain rows: a
            # reviewed repeat run has thousands of these, each carrying the
            # item's snapshots, and the page only reads their statuses.
            for corr in (
                db.query(
                    ReviewCorrection.id,
                    ReviewCorrection.item_id,
                    ReviewCorrection.metric_name,
                    ReviewCorrection.pass_number,
                    ReviewCorrection.status,
                    ReviewCorrection.created_at,
                    *ISSUE_REVIEW_COLUMNS,
                )
                .filter(
                    ReviewCorrection.run_id == run.id,
                    ReviewCorrection.is_active.is_(True),
                    ReviewCorrection.pass_number.isnot(None),
                )
                .filter(
                    ReviewCorrection.item_id.in_(item_ids)
                    if item_ids is not None
                    else True
                )
                .all()
            ):
                if corr.metric_name:
                    issue_reviews.setdefault(
                        (corr.item_id, corr.metric_name, int(corr.pass_number)), []
                    ).append(corr)

        # Every pass's final attempt — output, latency, trace — so the UI can
        # show each attempt, not just the item's last one.  Event state fills
        # the two gaps in this table: an attempt that is currently running and
        # legacy item outcomes that arrived without a final-attempt event.
        #
        # One scalar read of the attempts (no outputs) serves both the event
        # state and the final attempts below. Outcomes the event state takes
        # from attempt rows are final attempts, which win over event state, so
        # it needs no outputs.
        pass_event_state = _repeat_pass_event_state(
            db,
            run.id,
            item_ids=item_ids,
            include_outputs=False,
            with_attempt_rows=True,
        )
        all_attempts = [
            attempt
            for attempt in pass_event_state["attempt_rows"]
            if pass_number is None or int(attempt.pass_number) == pass_number
        ]
        final_attempts = [
            attempt for attempt in all_attempts if attempt.is_last_attempt
        ]
        max_attempt_by_pair: Dict[tuple[str, int], int] = {}
        for attempt in all_attempts:
            key = (attempt.item_id, int(attempt.pass_number))
            max_attempt_by_pair[key] = max(
                max_attempt_by_pair.get(key, 0), int(attempt.attempt_number or 1)
            )
        retry_counts = {
            key: max(0, max_attempt - 1)
            for key, max_attempt in max_attempt_by_pair.items()
        }
        run_status = str(getattr(run.status, "value", run.status) or "").upper()
        terminal_active_status = {
            "COMPLETED": "completed",
            "FAILED": "failed",
            "STOPPED": "stopped",
        }.get(run_status)
        active_event_attempts = pass_event_state["active_attempts"]
        if terminal_active_status:
            active_event_attempts = {
                key: {**payload, "status": terminal_active_status}
                for key, payload in active_event_attempts.items()
            }
        event_attempts = {
            **active_event_attempts,
            **pass_event_state["outcomes"],
        }
        if pass_number is not None:
            # The other passes' attempts are dropped by the caller's scoping:
            # do not load their trace aggregates.
            event_attempts = {
                key: value for key, value in event_attempts.items() if key[1] == pass_number
            }
        trace_ids = {
            str(trace_id)
            for trace_id in [
                *(attempt.trace_id for attempt in final_attempts),
                *(payload.get("trace_id") for payload in event_attempts.values()),
            ]
            if trace_id
        }
        trace_aggregate_map = {
            aggregate.trace_id: aggregate
            for aggregate in (
                db.query(RunTraceAggregate)
                .filter(
                    RunTraceAggregate.run_id == run.id,
                    RunTraceAggregate.trace_id.in_(trace_ids),
                )
                .all()
                if trace_ids
                else []
            )
        }
        if trace_aggregate_map:
            from qym_platform.api.ingest import _trace_bucket_from_aggregate

            trace_stats_by_id = {
                trace_id: _trace_bucket_from_aggregate(aggregate)
                for trace_id, aggregate in trace_aggregate_map.items()
            }
        else:
            trace_stats_by_id = {}

        # Payloads of final attempts whose output is still to be read, by
        # attempt id. A failed attempt with an error shows the error instead.
        awaiting_output: Dict[int, Dict[str, Any]] = {}
        for att in final_attempts:
            att_error = att.error or ""
            is_failed = str(att.status or "").lower() == "failed"
            payload = {
                "pass_number": int(att.pass_number),
                "status": "error" if is_failed else "completed",
                "output": f"ERROR: {att_error}" if is_failed and att_error else "",
                "error": att_error,
                "latency_ms": att.latency_ms,
                "task_started_at_ms": att.task_started_at_ms,
                "trace_id": att.trace_id or "",
                "trace_url": att.trace_url or "",
                "retry_count": retry_counts.get((att.item_id, int(att.pass_number)), 0),
                "trace_stats": trace_stats_by_id.get(att.trace_id),
            }
            if not (is_failed and att_error):
                awaiting_output[att.id] = payload
            elif compact:
                payload = compact_attempt(payload)
            pass_attempts_by_item.setdefault(att.item_id, {})[
                int(att.pass_number)
            ] = payload

        def _settle_output(attempt_id: int, output: Any) -> None:
            payload = awaiting_output.pop(attempt_id)
            payload["output"] = _stringify(output)
            if compact:
                # The index keeps only the output's digest: drop the text now
                # rather than hold every pass's output until the row is built.
                compacted = compact_attempt(payload)
                payload.clear()
                payload.update(compacted)

        if awaiting_output:
            # Final outputs in bounded batches, never every pass's at once.
            wanted_ids = sorted(awaiting_output)
            for offset in range(0, len(wanted_ids), _ATTEMPT_OUTPUT_BATCH):
                batch_ids = wanted_ids[offset : offset + _ATTEMPT_OUTPUT_BATCH]
                output_query = db.query(
                    RunItemAttempt.id, RunItemAttempt.output
                ).filter(
                    RunItemAttempt.run_id == run.id,
                    RunItemAttempt.id.in_(batch_ids),
                )
                if pass_number is not None:
                    output_query = output_query.filter(
                        RunItemAttempt.pass_number == pass_number
                    )
                for attempt_id, output in output_query:
                    if output is not None and attempt_id in awaiting_output:
                        _settle_output(attempt_id, output)
            # Attempts written by pre-fix SDK event ordering: the output is
            # only on the item_completed event.
            missing = {
                attempt_id: (att.item_id, int(att.pass_number))
                for att in final_attempts
                for attempt_id in (att.id,)
                if attempt_id in awaiting_output
            }
            recovered_outputs = _completed_pass_outputs(
                db, run.id, set(missing.values())
            )
            for attempt_id, pair in missing.items():
                _settle_output(attempt_id, recovered_outputs.get(pair))

        for (item_id, pass_number), event_attempt in event_attempts.items():
            if pass_number in pass_attempts_by_item.get(item_id, {}):
                continue
            payload = dict(event_attempt)
            payload["trace_stats"] = trace_stats_by_id.get(payload.get("trace_id"))
            pass_attempts_by_item.setdefault(item_id, {})[pass_number] = payload

    # Fallback timestamps: for items missing task_started_at_ms in item_metadata,
    # look up the item_started event's sent_at timestamp as an approximation.
    _item_start_ts: Dict[str, int] = {}
    need_ts = any(
        not (
            isinstance(it.item_metadata, dict)
            and it.item_metadata.get("task_started_at_ms")
        )
        for it in (
            item_query.with_entities(RunItem.item_metadata).yield_per(200)
            if compact
            else items
        )
    )
    if need_ts:
        started_events: List[RunEvent] = (
            db.query(RunEvent)
            .filter(RunEvent.run_id == run.id, RunEvent.type == "item_started")
            .filter(
                RunEvent.payload["item_id"].as_string().in_(item_ids)
                if item_ids is not None
                else True
            )
            .all()
        )
        for ev in started_events:
            payload = ev.payload or {}
            iid = payload.get("item_id")
            if iid and ev.sent_at:
                _item_start_ts[iid] = int(ev.sent_at.timestamp() * 1000)

    # Newest first, in the order the issue routes read them.
    for scope_reviews in issue_reviews.values():
        scope_reviews.sort(
            key=lambda corr: (corr.created_at or datetime.min, corr.id or 0),
            reverse=True,
        )

    def issue_statuses_by_metric(
        analyses: Any, item_id: str, number: Optional[int] = None
    ) -> Dict[str, Any]:
        if not isinstance(analyses, dict):
            return {}
        result = {}
        for metric_name, analysis in analyses.items():
            active = issue_reviews.get((item_id, metric_name, number), ())
            # Without a review row every issue is pending to the Approve
            # route; the page reads that from the JSON already unless the
            # JSON says decided. Most analysed items have no review row.
            if not active and not issue_json_says_decided(analysis):
                continue
            statuses = issue_review_statuses(analysis, active)
            if statuses:
                result[metric_name] = statuses
        return result

    ui_rows = []
    meta_keys = new_meta_key_index() if compact else None
    stats = {
        "total": item_count if compact else len(items),
        "completed": 0,
        "in_progress": 0,
        "pending": 0,
        "failed": 0,
        "not_received": 0,
    }
    duplicate_counts: Dict[str, int] = {}
    outcome = execution_outcomes(db, [run])[run.id]
    for it in items:
        is_error = bool(it.error)
        # A completed run's item whose outcome never arrived: neither a
        # success nor an error, and left out of the means (run_means).
        not_received = not is_error and item_not_received(
            outcome, run_samples, it.error, it.output, it.latency_ms
        )
        status = (
            "error" if is_error else "not_received" if not_received else "completed"
        )
        if is_error:
            stats["failed"] += 1
        elif not_received:
            stats["not_received"] += 1
        else:
            stats["completed"] += 1

        metric_values: list[Any] = []
        metric_meta: dict[str, Any] = {}
        for m in metrics:
            sc = (by_item.get(it.item_id, {}) or {}).get(m)
            if not sc:
                metric_values.append("")
                continue
            val = sc.score_raw
            if sc.score_numeric is not None:
                val = sc.score_numeric
            metric_values.append(val)
            pass_values = (pass_scores_by_item.get(it.item_id) or {}).get(m)
            if repeat_context and pass_values:
                metric_meta[m] = _repeat_aggregate_metric_meta(
                    pass_values,
                    dict(sc.meta) if isinstance(sc.meta, dict) else None,
                )
            elif sc.meta:
                metric_meta[m] = dict(sc.meta)
            if not repeat_context and (sc.label or sc.explanation):
                if m not in metric_meta:
                    metric_meta[m] = {}
                if sc.label:
                    metric_meta[m]["label"] = sc.label
                if sc.explanation:
                    metric_meta[m]["explanation"] = sc.explanation

        # Resolve task_started_at_ms: prefer item_metadata, then fallback to event timestamp
        ts_ms = (
            it.item_metadata.get("task_started_at_ms")
            if isinstance(it.item_metadata, dict)
            else None
        )
        if not ts_ms:
            ts_ms = _item_start_ts.get(it.item_id)
        corr = correction_by_item.get(it.item_id)
        metric_corrections = corrections_by_item_metric.get(it.item_id, {})
        item_metadata = it.item_metadata if isinstance(it.item_metadata, dict) else {}
        retry_count = int(it.retry_count or item_metadata.get("retry_count") or 0)
        identity = build_compare_identity(
            item_id=it.item_id,
            input_value=it.input,
            expected_value=it.expected,
            metadata=item_metadata,
            duplicate_counts=duplicate_counts,
        )
        input_text = _stringify(it.input)
        output_text = _stringify(it.output) if not is_error else f"ERROR: {it.error}"
        expected_text = _stringify(it.expected)
        # item_completed always carries latency_ms: an item without output
        # or latency never had its completion stored (still running, or the
        # platform rejected the event; the page tells which by the run's
        # ingest_incomplete flag), not an empty answer.
        output_received = is_error or it.output is not None or it.latency_ms is not None

        ui_rows.append(
            {
                "index": it.index,
                "item_id": it.item_id,
                "compare_item_id": identity["compare_item_id"],
                "compare_alignment_source": identity["compare_alignment_source"],
                "status": status,
                "error": it.error or "",
                # Repeat runs retain one logical RunItem while each pass is a
                # separate execution. This count lets filtered detail views
                # total every errored task/metric execution for this item.
                "execution_error_count": execution_errors_by_item.get(
                    str(it.item_id), 0
                ),
                "input": input_text,
                "input_full": input_text,
                "output": output_text,
                "output_full": output_text,
                **({} if output_received else {"output_received": False}),
                "expected": expected_text,
                "expected_full": expected_text,
                "time": (
                    ""
                    if it.latency_ms is None
                    else f"{(it.latency_ms or 0)/1000.0:.3f}"
                ),
                "latency_ms": it.latency_ms or 0,
                "retry_count": retry_count,
                "trace_id": it.trace_id or "",
                "trace_url": it.trace_url or "",
                "task_started_at_ms": ts_ms,
                "metric_values": metric_values,
                "metric_meta": metric_meta,
                "item_metadata": item_metadata,
                "review_correction_id": corr.id if corr else None,
                "review_correction_status": (
                    corr.status.value
                    if corr and hasattr(corr.status, "value")
                    else (corr.status if corr else "")
                ),
                "review_corrections": {
                    metric_name: {
                        "id": metric_correction.id,
                        "status": (
                            metric_correction.status.value
                            if hasattr(metric_correction.status, "value")
                            else metric_correction.status
                        ),
                    }
                    for metric_name, metric_correction in metric_corrections.items()
                },
                # metric -> [{issue_id, status}] per root-cause issue: what
                # the issue's Approve is judged by (issue_review_statuses).
                "review_issue_statuses": issue_statuses_by_metric(
                    item_metadata.get("metric_analyses"), it.item_id
                ),
                "trace_stats": (
                    item_metadata.get("trace_stats")
                    if isinstance(item_metadata, dict)
                    else None
                ),
                # Repeat runs: metric -> [score per pass, index 0 = pass 1]
                "pass_scores": (
                    {
                        m: [by_pass.get(p) for p in range(1, run_samples + 1)]
                        for m, by_pass in (
                            pass_scores_by_item.get(it.item_id) or {}
                        ).items()
                    }
                    if repeat_context
                    else None
                ),
                # Repeat runs: metric -> [meta per pass, index 0 = pass 1] —
                # each pass's judge output (explanation, label, …).
                "pass_metric_meta": (
                    {
                        m: [by_pass.get(p) for p in range(1, run_samples + 1)]
                        for m, by_pass in (
                            pass_meta_by_item.get(it.item_id) or {}
                        ).items()
                    }
                    if repeat_context and pass_meta_by_item.get(it.item_id)
                    else None
                ),
                # Repeat runs: metric -> [root-cause analysis per pass].  This
                # is deliberately separate from item_metadata so the aggregate
                # view can read it without presenting an editable item card.
                "pass_metric_analyses": (
                    {
                        m: [by_pass.get(p) for p in range(1, run_samples + 1)]
                        for m, by_pass in (
                            pass_analysis_by_item.get(it.item_id) or {}
                        ).items()
                    }
                    if repeat_context and pass_analysis_by_item.get(it.item_id)
                    else None
                ),
                # Repeat runs: metric -> [review_issue_statuses entry per
                # pass], from each pass's own corrections.
                "pass_review_issue_statuses": (
                    {
                        m: [
                            issue_statuses_by_metric({m: by_pass.get(p)}, it.item_id, p).get(m)
                            for p in range(1, run_samples + 1)
                        ]
                        for m, by_pass in (
                            pass_analysis_by_item.get(it.item_id) or {}
                        ).items()
                    }
                    if repeat_context and pass_analysis_by_item.get(it.item_id)
                    else None
                ),
                # Repeat runs: [attempt per pass, index 0 = pass 1] — each
                # pass's final output/latency/trace (null where not run yet).
                "pass_attempts": (
                    [
                        (pass_attempts_by_item.get(it.item_id) or {}).get(p)
                        for p in range(1, run_samples + 1)
                    ]
                    if repeat_context
                    else None
                ),
            }
        )
        if compact:
            ui_rows[-1] = compact_row(ui_rows[-1], meta_keys)

    # Whole-run builds count repeat-run item passes, from the current
    # publication when there is one (a source scan adds a third to the build).
    # Item batches (details, search) use only their rows.
    _apply_execution_stats(
        stats,
        (
            repeat_execution_counts(db, [run.id], prefer_published=True).get(run.id)
            if run_samples > 1 and item_ids is None
            else None
        ),
    )

    # Extract Langfuse host/project_id from run metadata (langfuse_url fallback)
    lf_host, lf_project_id = _extract_langfuse_ids(run.run_metadata or {})
    owner = db.query(User).filter(User.id == run.owner_user_id).first()
    project = db.query(Project).filter(Project.id == run.project_id).first()
    owner_info = None
    if owner:
        owner_info = {
            "id": owner.id,
            "email": owner.email,
            "display_name": owner.display_name or owner.email.split("@")[0],
        }
    project_info = None
    if project:
        project_info = {
            "id": project.id,
            "slug": project.slug,
            "name": project.name,
            # Archived projects are read-only: the page hides its edit controls.
            "archived": not project.is_active,
        }

    started_at = run.started_at or run.created_at
    ended_at = run.ended_at
    duration_ms = None
    if started_at and ended_at and ended_at >= started_at:
        duration_ms = (ended_at - started_at).total_seconds() * 1000.0

    run_name = ""
    if isinstance(run_config, dict):
        run_name = run_config.get("run_name", "")
    if not run_name:
        run_name = run.external_run_id or run.id

    _dsv = _dataset_version_fields(run, _dataset_version_info_map(db, [run]))

    return finalize_compare_alignment(
        {
            "run": {
                "run_id": run.id,
                "file_path": run.id,
                "task_name": run.task,
                "dataset_name": run.dataset,
                "dataset_version": _dsv["dataset_version"],
                "dataset_aliases": _dsv["dataset_aliases"],
                # Managed dataset behind the run (None for a label-only run).
                "dataset_slug": _dsv["dataset_slug"],
                "model_name": _strip_model_provider(run.model or ""),
                "run_name": run_name,
                "external_run_id": run.external_run_id or "",
                "metric_names": metrics,
                "metric_specs": metric_specs,
                "config": run_config,
                "metadata": strip_launch_token(run_metadata),
                "status": run.status,
                "status_reason": run.status_reason,
                "status_reason_label": _status_reason_label(db, run),
                "stop_requested": is_run_stop_requested(db, run),
                "owner": owner_info,
                "team_name": project.name if project else None,
                "project": project_info,
                "started_at": _iso(started_at) if started_at else "",
                "ended_at": _iso(ended_at) if ended_at else "",
                "created_at": _iso(run.created_at) if run.created_at else "",
                "duration_ms": duration_ms,
                "git_branch": run_config.get("git_branch"),
                "git_commit": run_config.get("git_commit"),
                "langfuse_host": lf_host,
                "langfuse_project_id": lf_project_id,
                "trace_stats": run_trace_stats,
                "samples": run_samples,
                "error_count": stats["failed"],
                "execution_error_count": len(execution_error_pairs),
                "execution_count": stats["execution_count"],
                "execution_success_count": stats["execution_success_count"],
                "last_completed_pass": (
                    run_metadata.get("last_completed_pass")
                    if isinstance(run_metadata, dict)
                    else None
                ),
                # origin (#18) plus the Experiment panel (#26, official runs only;
                # None for local runs). The panel also carries #18's {id, name,
                # job_id} experiment ref, which compare.html links with.
                **_run_origin_and_panel(db, run, principal),
            },
            "snapshot": {
                "rows": ui_rows,
                "stats": stats,
                "metric_names": metrics,
                "metric_specs": metric_specs,
                **(
                    {
                        "detail_mode": "lazy",
                        "detail_page_size": 100,
                        # Index rows carry only short metadata values; these
                        # list every key for the metric-field chooser.
                        **meta_key_schema(meta_keys),
                    }
                    if meta_keys is not None
                    else {}
                ),
            },
        }
    )


@router.get("/api/runs/{run_id}/export-html")
def export_run_html(
    run_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> HTMLResponse:
    """Export a run page as a self-contained HTML file with all assets inlined."""
    run = Run.active(db).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if not can_view_run(db, principal, run):
        raise HTTPException(status_code=403, detail="Access denied")

    data = _with_item_visibility(db, principal, run, _build_run_data(db, run))
    dashboard_dir = _platform_static_dir() / "dashboard"

    # Read source files
    run_html = (dashboard_dir / "run.html").read_text(encoding="utf-8")
    css_content = (dashboard_dir / "dashboard.css").read_text(encoding="utf-8")
    shell_css_content = (dashboard_dir / "shell.css").read_text(encoding="utf-8")
    ui_components_css_content = (dashboard_dir / "ui_components.css").read_text(
        encoding="utf-8"
    )
    latency_traces_css = (dashboard_dir / "latency_traces.css").read_text(encoding="utf-8")
    ui_components_js = (dashboard_dir / "ui_components.js").read_text(encoding="utf-8")
    metrics_js = (dashboard_dir / "metrics.js").read_text(encoding="utf-8")
    safe_js = (dashboard_dir / "qym_safe.js").read_text(encoding="utf-8")

    # Inline dashboard.css
    run_html = re.sub(
        r'\s*<link\s+rel="stylesheet"\s+href="/static/dashboard\.css(?:\?[^"]*)?">\s*',
        lambda _match: f"<style>\n{css_content}\n</style>",
        run_html,
        count=1,
    )
    run_html = re.sub(
        r'\s*<link\s+rel="stylesheet"\s+href="/static/shell\.css(?:\?[^"]*)?">\s*',
        lambda _match: f"<style>\n{shell_css_content}\n</style>",
        run_html,
        count=1,
    )
    run_html = re.sub(
        r'\s*<link\s+rel="stylesheet"\s+href="/static/ui_components\.css(?:\?[^"]*)?">\s*',
        lambda _match: f"<style>\n{ui_components_css_content}\n</style>",
        run_html,
        count=1,
    )
    run_html = re.sub(
        r'\s*<link\s+rel="stylesheet"\s+href="/static/latency_traces\.css(?:\?[^"]*)?">\s*',
        lambda _match: f"<style>\n{latency_traces_css}\n</style>",
        run_html,
        count=1,
    )
    json_viewer_css = (dashboard_dir / "json_viewer.css").read_text(encoding="utf-8")
    run_html = re.sub(
        r'\s*<link\s+rel="stylesheet"\s+href="/static/json_viewer\.css(?:\?[^"]*)?">\s*',
        lambda _match: f"<style>\n{json_viewer_css}\n</style>",
        run_html,
        count=1,
    )

    # Inline the shared escaping/text layer first: every other script uses it.
    run_html = re.sub(
        r'\s*<script\s+src="/static/qym_safe\.js(?:\?[^"]*)?"></script>\s*',
        lambda _match: f"<script>\n{safe_js}\n</script>",
        run_html,
        count=1,
    )

    # Inline metrics.js
    run_html = re.sub(
        r'\s*<script\s+src="/static/metrics\.js(?:\?[^"]*)?"></script>\s*',
        lambda _match: f"<script>\n{metrics_js}\n</script>",
        run_html,
        count=1,
    )
    run_html = re.sub(
        r'\s*<script\s+defer\s+src="/static/ui_components\.js(?:\?[^"]*)?"></script>\s*',
        lambda _match: f"<script>\n{ui_components_js}\n</script>",
        run_html,
        count=1,
    )

    trace_viewer_path = dashboard_dir / "trace_viewer.js"
    if trace_viewer_path.exists():
        trace_viewer_js = trace_viewer_path.read_text(encoding="utf-8")
        run_html = re.sub(
            r'\s*<script\s+src="/static/trace_viewer\.js(?:\?[^"]*)?"></script>\s*',
            lambda _match: f"<script>\n{trace_viewer_js}\n</script>",
            run_html,
            count=1,
        )

    # The run page's own helpers (failure reasons, sticky section nav, the
    # Response time charts of Latency and traces) work offline, so the export
    # keeps them.
    for page_script in (
        "item_reasons.js",
        "run_section_nav.js",
        "latency_traces.js",
        "json_viewer.js",
    ):
        page_script_js = (dashboard_dir / page_script).read_text(encoding="utf-8")
        run_html = re.sub(
            r'\s*<script\s+src="/static/'
            + re.escape(page_script)
            + r'(?:\?[^"]*)?"></script>\s*',
            lambda _match, source=page_script_js: f"<script>\n{source}\n</script>",
            run_html,
            count=1,
        )

    # Remove browser/session-only scripts that are not needed in standalone export.
    run_html = re.sub(
        r'\s*<script\s+src="/static/auth\.js(?:\?[^"]*)?"></script>\s*', "\n", run_html
    )
    run_html = re.sub(
        r'\s*<script\s+src="/static/shell\.js(?:\?[^"]*)?"></script>\s*', "\n", run_html
    )
    run_html = re.sub(
        r'\s*<script\s+src="/static/playground\.js(?:\?[^"]*)?"></script>\s*',
        "\n",
        run_html,
    )

    # Export embeds full rows and needs no network hydration helper.
    run_html = re.sub(
        r'\s*<script\s+(?:defer\s+)?src="/static/run_details\.js(?:\?[^"]*)?"></script>\s*',
        "\n", run_html,
    )
    # The Experiment panel (#26) links into the platform; exports leave it out.
    # Review history and step latency load from the API, which an offline file
    # cannot reach; run.html skips both sections in exports (IS_EXPORT). Any
    # other script still pointing at /static/ would only fail to load offline.
    run_html = re.sub(
        r'\s*<script\s+(?:defer\s+)?src="/static/[^"]+"></script>\s*',
        "\n",
        run_html,
    )

    # Remove favicon (would be a broken link)
    run_html = re.sub(
        r'\s*<link\s+rel="icon"\s+type="image/png"\s+href="/static/qym_icon\.png(?:\?[^"]*)?">\s*',
        "\n",
        run_html,
        count=1,
    )

    # Serialize data. Escape every "<" (JSON has none outside strings) so stored
    # text can neither close this script ("</script>") nor switch the parser
    # into a comment state that swallows it ("<!--<script>").
    data_json = json.dumps(data, ensure_ascii=False, default=str)
    data_json = data_json.replace("<", "\\u003c")

    # Inject export flag + data before the main inline <script> block
    export_script = (
        "<script>\n"
        "window.__QYM_EXPORT__ = true;\n"
        f"window.__QYM_EXPORT_DATA__ = {data_json};\n"
        "</script>\n"
    )
    # Insert just before the main <script> that starts the app
    run_html = run_html.replace(
        "  <script>\n    (() => {",
        f"{export_script}  <script>\n    (() => {{",
        1,
    )

    run_name = data["run"].get("run_name", run_id)
    # Sanitize filename
    safe_name = re.sub(r"[^\w\-.]", "_", str(run_name))[:80]
    filename = f"qym-run-{safe_name}.html"

    return HTMLResponse(
        content=run_html,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


TRASH_PAGE_MAX = 200


def _trash_like(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _deleted_runs_query(db: Session, project_id: Optional[str], search: str):
    query = db.query(Run).filter(Run.deleted_at.isnot(None))
    if project_id:
        query = query.filter(Run.project_id == project_id)
    term = (search or "").strip().lower()
    if term:
        pattern = _trash_like(term)
        run_name = func.coalesce(Run.run_config["run_name"].as_string(), "")
        query = query.filter(
            or_(
                func.lower(run_name).like(pattern, escape="\\"),
                func.lower(func.coalesce(Run.external_run_id, "")).like(pattern, escape="\\"),
                func.lower(Run.id).like(pattern, escape="\\"),
            )
        )
    return query


@router.get("/api/runs/trash")
def list_deleted_runs(
    response: Response,
    limit: int = Query(default=TRASH_PAGE_MAX, ge=1, le=TRASH_PAGE_MAX),
    offset: int = Query(default=0, ge=0),
    project_id: Optional[str] = Query(default=None),
    q: str = Query(default="", max_length=200),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> List[Dict[str, Any]]:
    """List soft-deleted runs (admin only) with the date retention purges each.

    Pages through every deleted run: ``limit``/``offset`` select the page and
    ``X-Qym-Total-Count`` carries how many match, so none is ever out of reach.
    ``project_id`` and ``q`` (run name or id) narrow the list. Purging pauses
    while a run's project is archived: such a row has no ``purge_at`` and
    ``purge_paused`` is true.
    """
    if principal.user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")
    # The maintenance worker hard-deletes runs this long after deletion; 0 = never.
    grace_days = PlatformSettings().deleted_run_grace_days
    response.headers["X-Qym-Deleted-Run-Grace-Days"] = str(grace_days)

    query = _deleted_runs_query(db, project_id, q)
    total = query.order_by(None).count()
    response.headers["X-Qym-Total-Count"] = str(total)
    # With purge on, the runs closest to their purge date (earliest purge
    # clocks) come first, and paused runs of archived projects after them;
    # otherwise the newest deletions. The id keeps pages stable when several
    # runs share a timestamp.
    order_by = (
        [
            case((Project.is_active.is_(False), 1), else_=0),
            func.coalesce(Run.purge_clock_started_at, Run.deleted_at).asc(),
        ]
        if grace_days > 0
        else [Run.deleted_at.desc()]
    )
    deleted_runs = (
        query.outerjoin(Project, Project.id == Run.project_id)
        .order_by(*order_by, Run.id.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    # Gather deleter display names
    deleter_ids = {r.deleted_by_user_id for r in deleted_runs if r.deleted_by_user_id}
    deleters = {}
    if deleter_ids:
        for u in db.query(User).filter(User.id.in_(deleter_ids)).all():
            deleters[u.id] = u.display_name or u.email

    # Runs of archived projects cannot be restored until the project is.
    project_ids = {r.project_id for r in deleted_runs}
    projects = (
        {
            row.id: row
            for row in db.query(Project.id, Project.name, Project.slug, Project.is_active).filter(
                Project.id.in_(project_ids)
            )
        }
        if project_ids
        else {}
    )
    archived_projects = {pid for pid, row in projects.items() if not row.is_active}

    dataset_info = _dataset_version_info_map(db, deleted_runs)
    result = []
    for r in deleted_runs:
        run_name = ""
        if isinstance(r.run_config, dict):
            run_name = r.run_config.get("run_name", "")
        if not run_name:
            run_name = r.external_run_id or ""
        _dsv = _dataset_version_fields(r, dataset_info)
        result.append(
            {
                "id": r.id,
                "run_name": run_name,
                "task": r.task,
                "dataset": r.dataset,
                "dataset_version": _dsv["dataset_version"],
                "dataset_aliases": _dsv["dataset_aliases"],
                "model": r.model,
                "trace_stats": r.run_metadata.get("trace_stats")
                if isinstance(r.run_metadata, dict)
                else None,
                "status": r.status.value if r.status else None,
                "owner_user_id": r.owner_user_id,
                "deleted_at": to_api_timestamp(r.deleted_at),
                "deleted_by_user_id": r.deleted_by_user_id,
                "deleted_by_name": deleters.get(r.deleted_by_user_id, ""),
                "created_at": to_api_timestamp(r.created_at),
                "purge_at": None
                if r.project_id in archived_projects
                else to_api_timestamp(
                    purge_due_at(r.deleted_at, grace_days, r.purge_clock_started_at)
                ),
                "purge_paused": grace_days > 0 and r.project_id in archived_projects,
                "project_archived": r.project_id in archived_projects,
                "project_id": r.project_id,
                "project_name": projects[r.project_id].name if r.project_id in projects else "",
                "project_slug": projects[r.project_id].slug if r.project_id in projects else "",
            }
        )
    return result


@router.get("/api/runs/trash/projects")
def list_deleted_run_projects(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> List[Dict[str, Any]]:
    """Projects that have deleted runs, with how many each (admin only)."""
    if principal.user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")
    rows = (
        db.query(Project.id, Project.name, Project.slug, Project.is_active, func.count(Run.id))
        .join(Run, Run.project_id == Project.id)
        .filter(Run.deleted_at.isnot(None))
        .group_by(Project.id, Project.name, Project.slug, Project.is_active)
        .order_by(Project.name.asc())
        .all()
    )
    return [
        {
            "id": pid,
            "name": name,
            "slug": slug,
            "archived": not is_active,
            "deleted_runs": int(count or 0),
        }
        for pid, name, slug, is_active, count in rows
    ]


@router.get("/api/runs/{run_id}/passes")
def run_passes(
    run_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Repeat runs: per-pass slice aggregates (lazy-loaded on runs-list expand)."""
    run = Run.active(db).filter(Run.id == run_id).first()
    if not run:
        return {"error": "Run not found"}
    if not can_view_run(db, principal, run):
        return {"error": "Access denied"}

    from qym_platform.db.models import RunItemAttempt, RunItemPassScore

    samples = int(getattr(run, "samples", 1) or 1)
    metrics = list(run.metrics or [])
    error_details: Dict[str, Dict[str, Any]] = {}
    execution_error_pairs = _execution_error_pairs_for_runs(
        db,
        [run.id],
        samples_by_run={run.id: samples},
        breakdowns=error_details,
    ).get(run.id, set())

    # Per-pass mean per metric, by the run-mean rule (services/run_means.py):
    # a pass whose scorer or task failed counts as 0, or is left out when
    # lower is better.
    pass_totals = pass_metric_totals(db, [run.id]).get(run.id, {})
    metric_means: Dict[int, Dict[str, Optional[float]]] = {}
    counts: Dict[int, int] = {}
    for (pass_number, metric_name), totals in pass_totals.items():
        metric_means.setdefault(pass_number, {})[metric_name] = run_metric_mean(
            totals, 0
        )
        counts[pass_number] = max(
            counts.get(pass_number, 0), totals.score_count + totals.unscored_errors
        )

    pass_analysis_rows = (
        db.query(RunItemPassScore.pass_number, RunItemPassScore.meta)
        .filter(
            RunItemPassScore.run_id == run.id,
            cast(RunItemPassScore.meta, Text).like(f'%"{PASS_ANALYSIS_META_KEY}"%'),
        )
        .yield_per(1000)
    )
    pass_analysis_causes: Dict[int, set[str]] = {}
    for pass_number, meta in pass_analysis_rows:
        analysis = (
            meta.get(PASS_ANALYSIS_META_KEY) if isinstance(meta, dict) else None
        )
        if not isinstance(analysis, dict):
            continue
        pass_analysis_causes.setdefault(int(pass_number), set()).update(
            analysis_root_causes(analysis)
        )

    # Per-pass item state.  Final attempts are canonical; lifecycle events
    # cover the currently-running item and legacy outcomes that have no final
    # attempt row.
    # Status, latency and trace columns only: outputs and errors are not
    # shown here, and the event state's scan supplies the attempt rows.
    event_state = _repeat_pass_event_state(
        db, run.id, include_outputs=False, with_attempt_rows=True
    )
    attempt_rows = event_state["attempt_rows"]
    attempts_by_item_pass: Dict[tuple[str, int], Dict[str, Any]] = {}
    max_attempt_by_pair: Dict[tuple[str, int], int] = {}
    for attempt in attempt_rows:
        key = (attempt.item_id, int(attempt.pass_number))
        max_attempt_by_pair[key] = max(
            max_attempt_by_pair.get(key, 0), int(attempt.attempt_number or 1)
        )
        if not attempt.is_last_attempt:
            continue
        attempts_by_item_pass[key] = {
            "status": (
                "error"
                if str(attempt.status or "").lower() == "failed"
                else "completed"
            ),
            "latency_ms": attempt.latency_ms,
            "task_started_at_ms": attempt.task_started_at_ms,
            "trace_id": attempt.trace_id or "",
        }
    for key, payload in event_state["outcomes"].items():
        attempts_by_item_pass.setdefault(key, payload)
    for key, payload in event_state["active_attempts"].items():
        attempts_by_item_pass.setdefault(key, payload)

    latencies_by_pass: Dict[int, List[float]] = {}
    error_items_by_pass: Dict[int, set[str]] = defaultdict(set)
    for item_id, pass_number in execution_error_pairs:
        error_items_by_pass[int(pass_number)].add(item_id)
    errors_by_pass = {
        pass_number: len(item_ids)
        for pass_number, item_ids in error_items_by_pass.items()
    }
    completed_by_pass: Dict[int, int] = {}
    running_by_pass: Dict[int, int] = {}
    started_items_by_pass: Dict[int, int] = {}
    retries_by_pass: Dict[int, int] = {}
    starts_by_pass: Dict[int, List[int]] = {}
    ends_by_pass: Dict[int, List[float]] = {}
    trace_ids_by_pass: Dict[int, List[str]] = {}
    for (item_id, pass_number), attempt in attempts_by_item_pass.items():
        p = int(pass_number)
        status = str(attempt.get("status") or "").lower()
        latency_ms = attempt.get("latency_ms")
        task_started_at_ms = attempt.get("task_started_at_ms")
        trace_id = attempt.get("trace_id")
        started_items_by_pass[p] = started_items_by_pass.get(p, 0) + 1
        if status == "running":
            running_by_pass[p] = running_by_pass.get(p, 0) + 1
        else:
            completed_by_pass[p] = completed_by_pass.get(p, 0) + 1
        if latency_ms is not None:
            latencies_by_pass.setdefault(p, []).append(float(latency_ms))
        if task_started_at_ms is not None:
            started = int(task_started_at_ms)
            starts_by_pass.setdefault(p, []).append(started)
            if latency_ms is not None:
                ends_by_pass.setdefault(p, []).append(started + float(latency_ms))
        if trace_id and status != "error":
            trace_ids_by_pass.setdefault(p, []).append(str(trace_id))
        retries_by_pass[p] = retries_by_pass.get(p, 0) + max(
            int(attempt.get("retry_count") or 0),
            max(0, max_attempt_by_pair.get((item_id, p), 1) - 1),
        )

    for p, starts in event_state["starts_by_pass"].items():
        starts_by_pass.setdefault(int(p), []).extend(int(value) for value in starts)

    trace_ids = {
        trace_id for values in trace_ids_by_pass.values() for trace_id in values
    }
    trace_aggregates = (
        db.query(RunTraceAggregate)
        .filter(
            RunTraceAggregate.run_id == run.id,
            RunTraceAggregate.trace_id.in_(trace_ids),
        )
        .all()
        if trace_ids
        else []
    )
    trace_aggregate_map = {
        aggregate.trace_id: aggregate for aggregate in trace_aggregates
    }
    if trace_aggregate_map:
        from qym_platform.api.ingest import (
            _build_run_trace_stats,
            _trace_bucket_from_aggregate,
        )

        trace_stats_by_pass = {
            p: _build_run_trace_stats(
                [
                    _trace_bucket_from_aggregate(trace_aggregate_map[trace_id])
                    for trace_id in pass_trace_ids
                    if trace_id in trace_aggregate_map
                ]
            )
            for p, pass_trace_ids in trace_ids_by_pass.items()
            if any(trace_id in trace_aggregate_map for trace_id in pass_trace_ids)
        }
    else:
        trace_stats_by_pass = {}

    def _lat_stats(values: Optional[List[float]]) -> Dict[str, Optional[float]]:
        if not values:
            return {"avg": None, "median": None, "p95": None}
        ordered = sorted(values)
        n = len(ordered)
        median = (
            ordered[n // 2] if n % 2 else (ordered[n // 2 - 1] + ordered[n // 2]) / 2.0
        )
        p95 = ordered[min(n - 1, max(0, int(round(0.95 * n)) - 1))]
        return {"avg": sum(ordered) / n, "median": median, "p95": p95}

    last_completed = 0
    if isinstance(run.run_metadata, dict):
        try:
            last_completed = int(run.run_metadata.get("last_completed_pass") or 0)
        except (TypeError, ValueError):
            last_completed = 0
    if event_state["completed_passes"]:
        last_completed = max(last_completed, max(event_state["completed_passes"]))

    run_status = str(getattr(run.status, "value", run.status) or "").upper()
    expected_items = (
        db.query(func.count(RunItem.id)).filter(RunItem.run_id == run.id).scalar() or 0
    )
    if isinstance(run.run_metadata, dict):
        try:
            expected_items = int(run.run_metadata.get("total_items") or expected_items)
        except (TypeError, ValueError):
            pass

    passes = []
    for p in range(1, samples + 1):
        has_data = (
            p in metric_means
            or p in started_items_by_pass
            or p in event_state["starts_by_pass"]
        )
        status = _repeat_pass_status(
            pass_number=p,
            last_completed=last_completed,
            has_data=has_data,
            run_status=run_status,
        )
        lat = _lat_stats(latencies_by_pass.get(p))
        pass_starts = starts_by_pass.get(p) or []
        pass_ends = ends_by_pass.get(p) or []
        started_at_ms = min(pass_starts) if pass_starts else None
        duration_ms = (
            max(pass_ends) - started_at_ms
            if started_at_ms is not None and pass_ends
            else None
        )
        ended_at_ms = max(pass_ends) if status == "completed" and pass_ends else None
        passes.append(
            {
                "pass_number": p,
                "status": status,
                "metric_means": metric_means.get(p, {}),
                "items_scored": counts.get(p, 0),
                "items_total": int(expected_items),
                "items_started": started_items_by_pass.get(p, 0),
                "completed_count": completed_by_pass.get(p, 0),
                "error_count": errors_by_pass.get(p, 0),
                **error_details[run.id]["pass_error_counts"].get(
                    p,
                    {
                        "task_error_count": 0,
                        "metric_error_count": 0,
                        "metric_error_counts": {},
                    },
                ),
                "analysis_cause_count": len(pass_analysis_causes.get(p, set())),
                "running_count": (
                    running_by_pass.get(p, 0) if status == "running" else 0
                ),
                "retry_count": retries_by_pass.get(p, 0),
                "avg_latency_ms": lat["avg"],
                "median_latency_ms": lat["median"],
                "p95_latency_ms": lat["p95"],
                "started_at": (
                    to_api_timestamp(
                        datetime.fromtimestamp(started_at_ms / 1000.0, timezone.utc)
                    )
                    if started_at_ms is not None
                    else None
                ),
                "ended_at": (
                    to_api_timestamp(
                        datetime.fromtimestamp(ended_at_ms / 1000.0, timezone.utc)
                    )
                    if ended_at_ms is not None
                    else None
                ),
                "duration_ms": duration_ms,
                "trace_stats": trace_stats_by_pass.get(p),
            }
        )
    return {"run_id": run.id, "samples": samples, "metrics": metrics, "passes": passes}


# Deleting passes changes every number of the run, so it follows the run
# deletion rule (owner, project manager or admin) and stays closed while the
# run is in review or signed off (C041).
PASS_DELETE_LOCK_DETAILS = {
    RunWorkflowStatus.SUBMITTED: (
        "Passes cannot be deleted while the run is submitted for approval. "
        "A project manager can reject it first."
    ),
    RunWorkflowStatus.APPROVED: "Unapprove the run before deleting passes.",
}


def _require_pass_deletion_allowed(db: Session, principal: Principal, run: Run) -> None:
    if not can_delete_run(db, principal, run):
        raise HTTPException(
            status_code=403,
            detail="Only the run owner, a project manager or an admin can delete passes",
        )
    require_project_writable(db, run.project_id)
    detail = PASS_DELETE_LOCK_DETAILS.get(run.status)
    if detail:
        raise state_conflict(run, detail.rstrip("."))


@router.delete("/api/runs/{run_id}/passes/{pass_number}")
def delete_run_pass(
    run_id: str,
    pass_number: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
    expected_pass_version: Optional[int] = None,
) -> Dict[str, Any]:
    """Delete one full pass from a completed repeat run."""
    run = _lock_pass_mutation_run(db, run_id, expected_pass_version)
    _require_pass_deletion_allowed(db, principal, run)

    try:
        result = delete_repeat_pass(
            db,
            run,
            pass_number,
            actor_user_id=(
                principal.user.id if principal.auth_type != "none" else None
            ),
        )
    except RepeatPassDeletionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    sync_run_scores(db, run)  # re-score: refresh the best-run index
    db.commit()
    return result


@router.delete("/api/runs/{run_id}/passes")
def delete_run_passes(
    run_id: str,
    payload: Dict[str, Any],
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Delete several passes atomically, using their original pass numbers."""
    run = _lock_pass_mutation_run(db, run_id, payload.get("expected_pass_version"))
    _require_pass_deletion_allowed(db, principal, run)

    raw_pass_numbers = payload.get("pass_numbers")
    if not isinstance(raw_pass_numbers, list) or not raw_pass_numbers:
        raise HTTPException(
            status_code=400, detail="pass_numbers must be a non-empty list"
        )
    if any(isinstance(value, bool) for value in raw_pass_numbers):
        raise HTTPException(
            status_code=400, detail="pass_numbers must contain integers"
        )
    try:
        pass_numbers = sorted({int(value) for value in raw_pass_numbers}, reverse=True)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400, detail="pass_numbers must contain integers"
        ) from exc
    if any(value != int(value) for value in raw_pass_numbers):
        raise HTTPException(
            status_code=400, detail="pass_numbers must contain integers"
        )

    samples = int(run.samples or 1)
    if any(pass_number < 1 or pass_number > samples for pass_number in pass_numbers):
        raise HTTPException(
            status_code=400, detail="pass_number out of range for this run"
        )
    if len(pass_numbers) >= samples:
        raise HTTPException(
            status_code=400, detail="A run must retain at least one pass"
        )

    try:
        for pass_number in pass_numbers:
            delete_repeat_pass(
                db,
                run,
                pass_number,
                actor_user_id=(
                    principal.user.id if principal.auth_type != "none" else None
                ),
            )
    except RepeatPassDeletionError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    sync_run_scores(db, run)  # re-score: refresh the best-run index
    db.commit()
    return {
        "ok": True,
        "run_id": run.id,
        "deleted_passes": sorted(pass_numbers),
        "samples": int(run.samples or 1),
    }


@router.get("/api/runs/{run_id}/group-metrics")
def run_group_metrics(
    run_id: str,
    metric: Optional[str] = Query(None),
    threshold: Optional[float] = Query(None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Repeat runs: the group set (k = samples) plus the full accuracy-vs-k band.

    All passes are stored, so any pass@k / pass^k for k <= samples is computed
    on demand — reduction is a display concern, never a data commitment.
    """
    run = Run.active(db).filter(Run.id == run_id).first()
    if not run:
        return {"error": "Run not found"}
    if not can_view_run(db, principal, run):
        return {"error": "Access denied"}

    from qym.core.reducers import group_stats

    from qym_platform.db.models import RunItemPassScore
    from qym_platform.services.repeat_analysis import cached_repeat_analysis

    samples = int(getattr(run, "samples", 1) or 1)
    # Default to the declared primary metric, else the first (C008).
    specs = {
        spec.metric_name: spec
        for spec in db.query(RunMetricSpec).filter(RunMetricSpec.run_id == run.id)
    }
    metric_name = metric or primary_metric(run.metrics, specs)
    if not metric_name:
        return {"error": "Run has no metrics"}
    # Passes follow the metric's declared direction. Without one the page
    # shows only averages; the pass math keeps the historical default.
    spec = specs.get(metric_name)
    direction = declared_direction(spec)
    if threshold is None:
        threshold = (
            spec.pass_threshold
            if spec is not None and spec.pass_threshold is not None
            else (0.2 if direction == "minimize" else 0.8)
        )

    items_scores: Dict[str, list] = {}
    # A pass whose scorer or task failed scores 0. A lower-is-better metric
    # would read that 0 as its best value, so there an errored pass is None:
    # never a pass, and left out of averages and the best score
    # (services/run_means.py). At a threshold of 0 or below the 0 of a
    # failed pass would pass: ``eligible`` keeps it a failed pass. Only in
    # those two cases are the pass metadata read; elsewhere a failed pass's
    # 0 is below the threshold.
    left_out = errors_left_out(direction)
    read_meta = left_out or threshold <= 0
    columns = [
        RunItemPassScore.item_id,
        RunItemPassScore.pass_number,
        RunItemPassScore.score_numeric,
    ]
    if read_meta:
        columns += [
            RunItemPassScore.meta,
            RunItemPassScore.label,
            RunItemPassScore.explanation,
        ]
    rows = (
        db.query(*columns)
        .filter(
            RunItemPassScore.run_id == run.id,
            RunItemPassScore.metric_name == metric_name,
        )
        .order_by(RunItemPassScore.item_id, RunItemPassScore.pass_number)
        .all()
    )
    eligible: Dict[str, list] = {}
    score_rows = []
    for row in rows:
        item_id, pass_number, score_numeric = row[:3]
        errored = False
        if read_meta:
            meta, label, explanation = row[3:]
            errored = is_metric_error(meta) or is_task_error_pass(
                label, meta, explanation
            )
            if errored:
                numeric = (
                    None
                    if left_out
                    else float(score_numeric) if score_numeric is not None else 0.0
                )
            elif score_numeric is None:
                continue
            else:
                numeric = float(score_numeric)
        else:
            numeric = float(score_numeric) if score_numeric is not None else 0.0
        items_scores.setdefault(item_id, []).append(numeric)
        eligible.setdefault(item_id, []).append(not errored)
        score_rows.append((str(item_id), int(pass_number), numeric, errored))

    run_config = run.run_config if isinstance(run.run_config, dict) else {}
    raw_report_k = run_config.get("report_k")
    report_k = (
        int(raw_report_k)
        if isinstance(raw_report_k, (int, float)) and 1 <= int(raw_report_k) <= samples
        else None
    )
    stats = group_stats(
        items_scores,
        threshold=threshold,
        k=samples,
        report_k=report_k,
        direction=direction or "maximize",
        eligible=eligible,
    )
    if left_out and all(row[2] is None for row in score_rows):
        # Every pass errored: no average or best score, as the run mean (0
        # would read as this lower-is-better metric's best value).
        stats["avg_at_k"] = stats["max_at_k"] = None
    analysis = cached_repeat_analysis(
        db,
        run_id=run.id,
        metric_name=metric_name,
        threshold=threshold,
        samples=samples,
        rows=score_rows,
        items_scores=items_scores,
        eligible=eligible,
        direction=direction or "maximize",
    )
    return {
        "run_id": run.id,
        "metric": metric_name,
        "direction": direction,
        "threshold": threshold,
        "samples": samples,
        "report_k": report_k,
        "group": stats,
        "band": analysis.get("band", {}),
        "distribution": analysis.get("distribution", []),
        "uncertainty": {
            "confidence": analysis.get("confidence"),
            "bootstrap_iterations": analysis.get("bootstrap_iterations"),
            "minimum_items": analysis.get("minimum_uncertainty_items"),
            "method": analysis.get("method"),
            "method_version": analysis.get("method_version"),
        },
    }


def _with_item_visibility(
    db: Session, principal: Principal, run: Run, data: Dict[str, Any]
) -> Dict[str, Any]:
    """Redact item contents of a run evaluated on a private test set unless
    ``principal`` is an admin. Handles run payloads and single-row payloads."""
    if can_view_run_items(db, principal, run):
        return data
    snapshot = data.get("snapshot")
    if isinstance(snapshot, dict):
        redact_item_content(snapshot.get("rows") or [])
    if isinstance(data.get("rows"), list):
        redact_item_content(data["rows"])
    if isinstance(data.get("row"), dict):
        redact_item_content(data["row"])
    if isinstance(data.get("run"), dict):
        data["run"]["items_restricted"] = True
    return data


def _detail_run(db: Session, principal: Principal, run_id: str) -> Run:
    run = Run.active(db).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run not found")
    if not can_view_run(db, principal, run):
        raise HTTPException(403, "Access denied")
    return run


@router.post("/api/runs/{run_id}/items/details")
def run_item_details(
    run_id: str,
    request: Dict[str, Any],
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    run = _detail_run(db, principal, run_id)
    ids = detail_item_ids(request)
    data = _build_run_data(db, run, item_ids=ids)
    rows = data["snapshot"]["rows"]
    for row in rows:
        # Occurrence-based comparison identity comes from the complete compact
        # index; hydrating a subset must never reset duplicate occurrence IDs.
        row.pop("compare_item_id", None)
        row.pop("compare_alignment_source", None)
        row["__details_loaded"] = True
    present = {row["item_id"] for row in rows}
    return _with_item_visibility(
        db,
        principal,
        run,
        {
            "rows": rows,
            "missing_item_ids": [iid for iid in ids if iid not in present],
        },
    )


@router.post("/api/runs/{run_id}/items/reasons")
def run_item_reasons(
    run_id: str,
    request: Dict[str, Any],
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Why each listed item failed one metric (C065): only the reason fields
    of that metric's metadata (reason, error, status, explanation, label),
    for the run or for one pass of a repeat run."""
    run = _detail_run(db, principal, run_id)
    ids, metric, pass_number = reason_request(request)
    metas = _item_reason_metas(db, run, ids, metric, pass_number)
    reasons = {item_id: reason_fields(meta) for item_id, meta in metas.items()}
    if not can_view_run_items(db, principal, run):
        # Private test set: reasons and explanations quote item content.
        redact_item_content(list(reasons.values()))
    return {"metric": metric, "pass_number": pass_number, "reasons": reasons}


def _item_reason_metas(
    db: Session, run: Run, ids: List[str], metric: str, pass_number: Optional[int]
) -> Dict[str, Optional[Dict[str, Any]]]:
    """One metric's metadata per item, as ``_build_run_data`` shows it.

    Reads only the score metadata of that metric (and of that pass), not the
    items' bodies, attempts or traces. ``metric_meta`` and, with a pass,
    ``pass_metric_meta`` follow the same rules as the run page's rows.
    """
    present = [
        item_id
        for (item_id,) in db.query(RunItem.item_id)
        .filter(RunItem.run_id == run.id, RunItem.item_id.in_(ids))
        .order_by(RunItem.index.asc())
    ]
    if not present:
        return {}
    run_scores = {
        row.item_id: row
        for row in db.query(
            RunItemScore.item_id,
            RunItemScore.meta,
            RunItemScore.label,
            RunItemScore.explanation,
        ).filter(
            RunItemScore.run_id == run.id,
            RunItemScore.metric_name == metric,
            RunItemScore.item_id.in_(present),
        )
    }
    run_metrics = {str(name) for name in (run.metrics or [])}
    run_samples = int(getattr(run, "samples", 1) or 1)
    repeat_context = has_repeat_pass_context(run)
    pass_values: Dict[str, Dict[int, Optional[float]]] = {}
    pass_metas: Dict[str, Dict[int, Dict[str, Any]]] = {}
    if repeat_context:
        for ps in db.query(
            RunItemPassScore.item_id,
            RunItemPassScore.pass_number,
            RunItemPassScore.score_numeric,
            RunItemPassScore.meta,
            RunItemPassScore.label,
            RunItemPassScore.explanation,
        ).filter(
            RunItemPassScore.run_id == run.id,
            RunItemPassScore.metric_name == metric,
            RunItemPassScore.item_id.in_(present),
        ):
            pass_values.setdefault(ps.item_id, {})[int(ps.pass_number)] = ps.score_numeric
            if pass_number is None:
                continue
            ps_meta: Dict[str, Any] = dict(ps.meta) if ps.meta else {}
            ps_meta.pop(TASK_ERROR_PASS_MARKER, None)
            ps_meta.pop(PASS_ANALYSIS_META_KEY, None)
            if ps.label:
                ps_meta.setdefault("label", ps.label)
            if ps.explanation:
                ps_meta.setdefault("explanation", ps.explanation)
            if ps_meta:
                pass_metas.setdefault(ps.item_id, {})[int(ps.pass_number)] = ps_meta
    result: Dict[str, Optional[Dict[str, Any]]] = {}
    for item_id in present:
        if pass_number is not None and item_id in pass_metas:
            # As the page scopes a row to one pass; legacy repeat artifacts
            # without pass metadata keep the run-level metadata.
            result[item_id] = (
                pass_metas[item_id].get(pass_number) if pass_number <= run_samples else None
            )
            continue
        # Run-level metadata exists only for the run's own metrics.
        score = run_scores.get(item_id) if metric in run_metrics else None
        meta: Optional[Dict[str, Any]] = None
        if score is not None:
            values = pass_values.get(item_id)
            if repeat_context and values:
                meta = _repeat_aggregate_metric_meta(
                    values, dict(score.meta) if isinstance(score.meta, dict) else None
                )
            elif score.meta:
                meta = dict(score.meta)
            if not repeat_context and (score.label or score.explanation):
                meta = meta if meta is not None else {}
                if score.label:
                    meta["label"] = score.label
                if score.explanation:
                    meta["explanation"] = score.explanation
        result[item_id] = meta
    return result


@router.post("/api/runs/{run_id}/items/search")
def search_run_items(
    run_id: str,
    request: Dict[str, Any],
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    run = _detail_run(db, principal, run_id)
    conditions = search_conditions(request)
    samples = int(run.samples or 1)

    def is_pass(value: Any) -> bool:
        return (
            not isinstance(value, bool)
            and isinstance(value, int)
            and 1 <= value <= samples
        )

    pass_number = request.get("pass_number")
    if pass_number is not None and not is_pass(pass_number):
        raise HTTPException(422, "pass_number must identify an existing pass")
    # Compare shows one column per pass of a run; it searches all of them in
    # one request so the run's rows are read once, not once per column.
    pass_numbers = request.get("pass_numbers")
    if pass_numbers is not None:
        if (
            pass_number is not None
            or not isinstance(pass_numbers, list)
            or not 1 <= len(pass_numbers) <= samples
            or not all(is_pass(value) for value in pass_numbers)
        ):
            raise HTTPException(422, "pass_numbers must list existing passes")
        scopes: List[Optional[int]] = list(dict.fromkeys(pass_numbers))
    else:
        scopes = [pass_number]

    matches_by_scope: Dict[Optional[int], Dict[str, List[str]]] = {
        scope: {condition["id"]: [] for condition in conditions} for scope in scopes
    }
    if not can_view_run_items(db, principal, run):
        # Private test set: only item ids are searchable.
        for (item_id,) in (
            db.query(RunItem.item_id).filter(RunItem.run_id == run.id).yield_per(1000)
        ):
            lowered_id = str(item_id or "").lower()
            for condition in conditions:
                if condition["field"] == "all" and condition["value"] in lowered_id:
                    for scope_matches in matches_by_scope.values():
                        scope_matches[condition["id"]].append(item_id)
        if pass_numbers is not None:
            return {
                "matches_by_pass": {
                    str(scope): matches for scope, matches in matches_by_scope.items()
                }
            }
        return {"matches": matches_by_scope[pass_number]}
    # Search is deliberately explicit: the initial index never transfers large
    # bodies. Streaming selected columns bounds aggregate-mode server memory.
    if scopes == [None]:
        rows = (
            db.query(
                RunItem.item_id,
                RunItem.index,
                RunItem.input,
                RunItem.expected,
                RunItem.output,
                RunItem.error,
            )
            .filter(RunItem.run_id == run.id)
            .order_by(RunItem.index.asc())
            .yield_per(200)
        )
        texts = (
            (
                row.item_id,
                [
                    str(row.item_id or row.index or ""),
                    _stringify(row.input),
                    _stringify(row.expected),
                ],
                {
                    None: (
                        f"ERROR: {row.error}" if row.error else _stringify(row.output)
                    )
                },
            )
            for row in rows
        )
    else:
        # Reuse established legacy pass recovery so pre-attempt SDK runs and
        # missing/final attempts have exactly the same search semantics as UI.
        # Scope each recovery batch so repeated searches cannot load every
        # input/output/explanation into memory at once.
        def pass_texts():
            from itertools import islice

            item_ids = iter(
                db.query(RunItem.item_id)
                .filter(RunItem.run_id == run.id)
                .order_by(RunItem.index.asc())
                .yield_per(100)
            )
            while True:
                batch = [item_id for (item_id,) in islice(item_ids, 100)]
                if not batch:
                    break
                data = _build_run_data(db, run, item_ids=batch)
                for row in data["snapshot"]["rows"]:
                    attempts = row.get("pass_attempts") or []
                    content = [
                        str(row["item_id"] or row["index"] or ""),
                        row["input"],
                        row["expected"],
                    ]
                    outputs = {
                        number: (
                            str((attempts[number - 1] or {}).get("output") or "")
                            if len(attempts) >= number
                            else ""
                        )
                        for number in scopes
                    }
                    yield row["item_id"], content, outputs
                del data

        texts = pass_texts()
    for item_id, content, outputs in texts:
        content_lowered = [value.lower() for value in content]
        for scope, output in outputs.items():
            lowered = content_lowered + [output.lower()]
            for condition in conditions:
                candidates = (
                    lowered if condition["field"] == "all"
                    else lowered[1:] if condition["field"] == "content"
                    else lowered[-1:]
                )
                if any(condition["value"] in candidate for candidate in candidates):
                    matches_by_scope[scope][condition["id"]].append(item_id)
    if pass_numbers is not None:
        return {
            "matches_by_pass": {
                str(scope): matches for scope, matches in matches_by_scope.items()
            }
        }
    return {"matches": matches_by_scope[pass_number]}



@router.get("/api/runs/{run_id}")
def legacy_run_data(
    run_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
    view: Optional[str] = None,
    pass_number: Optional[int] = None,
) -> Dict[str, Any]:
    run = Run.active(db).filter(Run.id == run_id).first()
    if not run:
        return {"error": "Run not found"}
    if not can_view_run(db, principal, run):
        return {"error": "Access denied"}
    _reconcile_run_liveness(db, [run])

    if view not in (None, "full", "compact", "summary"):
        raise HTTPException(422, "view must be full, compact or summary")
    if pass_number is not None and (view != "compact" or pass_number < 1):
        raise HTTPException(422, "pass_number (1 or more) needs view=compact")
    if view == "summary":
        # The run header (names, metrics, samples) without any item rows:
        # what a page needs before it chooses the rows it loads (C027).
        return _with_item_visibility(
            db,
            principal,
            run,
            _build_run_data(db, run, item_ids=[], compact=True, principal=principal),
        )
    # Read before the rows are built: a page that follows a live run starts
    # from this revision (at worst one reload too many, never one missed).
    live_revision = (
        _live_revision(db, run) if run.status in _LIVE_RUN_STATUSES else None
    )
    data = _build_run_data(
        db,
        run,
        compact=view == "compact",
        pass_number=pass_number,
        principal=principal,
    )
    if live_revision is not None and isinstance(data.get("run"), dict):
        data["run"]["live_revision"] = live_revision
    if pass_number is not None:
        # One sample of a repeat run: the other passes' series are dropped.
        data["snapshot"]["rows"] = [
            scope_row_to_pass(row, pass_number) for row in data["snapshot"]["rows"]
        ]
        data["snapshot"]["pass_number"] = pass_number
    return _with_item_visibility(db, principal, run, data)


def _live_revision(db: Session, run: Run) -> str:
    """What a page following a live run compares to know it has news (C039).

    The highest event sequence moves with every stored event, also one that
    arrives late and so leaves ``last_event_at`` alone; it is read from the
    unique (run_id, sequence) index. Status and ``updated_at`` cover state
    changes; ``last_event_at`` covers heartbeats.
    """
    status = run.status.value if hasattr(run.status, "value") else str(run.status or "")
    sequence = (
        db.query(func.max(RunEvent.sequence)).filter(RunEvent.run_id == run.id).scalar()
    )
    return "|".join(
        [
            status,
            _iso(run.last_event_at) if run.last_event_at else "",
            _iso(run.updated_at) if run.updated_at else "",
            str(sequence if sequence is not None else ""),
        ]
    )


@router.get("/api/runs/{run_id}/live-status")
def run_live_status(
    run_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """A small status probe for pages that follow a run while it runs (C039).

    ``revision`` changes whenever the run records an event or changes state,
    so a page reloads the run's rows only when there is something new.
    """
    run = Run.active(db).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run not found")
    if not can_view_run(db, principal, run):
        raise HTTPException(403, "Access denied")
    _reconcile_run_liveness(db, [run])
    status = run.status.value if hasattr(run.status, "value") else str(run.status or "")
    last_event_at = _iso(run.last_event_at) if run.last_event_at else None
    return {
        "run_id": run.id,
        "status": status,
        "status_reason": run.status_reason,
        "live": run.status in _LIVE_RUN_STATUSES,
        # Its evaluation job is being cancelled: the page shows "Stopping…"
        # and keeps following it until the run reports STOPPED.
        "stop_requested": is_run_stop_requested(db, run),
        "started_at": (
            _iso(run.started_at or run.created_at)
            if (run.started_at or run.created_at)
            else None
        ),
        "ended_at": _iso(run.ended_at) if run.ended_at else None,
        "last_event_at": last_event_at,
        "revision": _live_revision(db, run),
        "server_time": to_api_timestamp(utc_now_naive()),
    }


# Review states in which a run's scores are locked (C041): the numbers a
# reviewer is deciding on, or signed off, cannot change underneath them.
SCORE_LOCK_DETAILS = {
    RunWorkflowStatus.SUBMITTED: (
        "Scores are locked while the run is submitted for approval. "
        "A project manager can reject it to reopen score edits."
    ),
    RunWorkflowStatus.APPROVED: (
        "Scores are locked on an approved run. "
        "A project manager can unapprove it to reopen score edits."
    ),
}


def require_scores_unlocked(run: Run) -> None:
    """Refuse (403) a score edit or reset on a submitted or approved run."""
    detail = SCORE_LOCK_DETAILS.get(run.status)
    if detail:
        raise HTTPException(
            status_code=403,
            detail=detail,
            headers={"X-Qym-Run-Status": run.status.value},
        )


def _principal_name(principal: Principal) -> str:
    if principal.auth_type == "none":
        return ""
    user = principal.user
    return user.display_name or (user.email or "").split("@")[0]


def _edit_audit_value(
    db: Session,
    run: Run,
    item: RunItem,
    metric_name: str,
    pass_number: Optional[int],
    score_record: RunItemScore,
) -> Any:
    """The value an edit or reset changes: the pass score, or the item's."""
    if pass_number is None:
        return (
            score_record.score_numeric
            if score_record.score_numeric is not None
            else score_record.score_raw
        )
    return (
        db.query(RunItemPassScore.score_numeric)
        .filter(
            RunItemPassScore.run_id == run.id,
            RunItemPassScore.item_id == item.item_id,
            RunItemPassScore.metric_name == metric_name,
            RunItemPassScore.pass_number == pass_number,
        )
        .scalar()
    )


def _record_score_edit(
    db: Session,
    principal: Principal,
    *,
    run: Run,
    item: RunItem,
    metric_name: str,
    pass_number: Optional[int],
    action: str,
    previous: Any,
    new: Any,
) -> None:
    """Audit every score edit and reset: who, when, which score, from, to."""
    db.add(
        AuditLog(
            actor_user_id=principal.user.id if principal.auth_type != "none" else None,
            action="run.score_" + ("reset" if action == "reset" else "edited"),
            entity_type="run",
            entity_id=run.id,
            before={
                "item_id": item.item_id,
                "metric_name": metric_name,
                "pass_number": pass_number,
                "score": previous,
            },
            after={
                "item_id": item.item_id,
                "metric_name": metric_name,
                "pass_number": pass_number,
                "score": new,
            },
        )
    )


def _restore_pass(pass_record: RunItemPassScore) -> None:
    _original, numeric, restored = restore_original_score(
        pass_record.meta, pass_record.score_numeric
    )
    pass_record.score_numeric = numeric
    pass_record.meta = restored


def _reset_score_edit(
    db: Session,
    *,
    run: Run,
    item: RunItem,
    metric_name: str,
    pass_number: Optional[int],
    score_record: RunItemScore,
    spec: Optional[RunMetricSpec],
) -> None:
    """Give an item's score (or one pass of it) back its scorer's value.

    Classic runs restore the stored ``original_score`` and any scorer failure
    the edit replaced. On a repeat run, resetting the item restores every
    edited pass and drops a value given to the item as a whole; resetting one
    pass restores that pass. The item is then the mean over its passes again,
    and stops showing as edited once nothing in it is.
    """
    meta = dict(score_record.meta or {})
    if not has_repeat_pass_context(run):
        if not is_edited(meta):
            raise HTTPException(status_code=409, detail="This score has not been edited")
        original, numeric, restored = restore_original_score(meta, score_record.score_raw)
        score_record.score_raw = original
        score_record.score_numeric = numeric
        score_record.meta = restored
        # The pass-1 copy an import keeps follows its classic score's error state.
        for pass_copy in db.query(RunItemPassScore).filter(
            RunItemPassScore.run_id == run.id,
            RunItemPassScore.item_id == item.item_id,
            RunItemPassScore.metric_name == metric_name,
        ):
            copy_meta = pass_copy.meta if isinstance(pass_copy.meta, dict) else {}
            if any(f"original_{key}" in copy_meta for key in ("status", "error", "traceback")):
                pass_copy.meta = restore_original_score(copy_meta, pass_copy.score_numeric)[2]
        return

    passes = {
        int(p.pass_number): p
        for p in db.query(RunItemPassScore)
        .filter(
            RunItemPassScore.run_id == run.id,
            RunItemPassScore.item_id == item.item_id,
            RunItemPassScore.metric_name == metric_name,
        )
        .populate_existing()
        .with_for_update()
    }
    if pass_number is not None:
        target = passes.get(pass_number)
        if target is None or not is_edited(target.meta):
            raise HTTPException(status_code=409, detail="This pass score has not been edited")
        _restore_pass(target)
        meta.pop(f"pass_{pass_number}_original", None)
    else:
        if not is_edited(meta) and not any(is_edited(p.meta) for p in passes.values()):
            raise HTTPException(status_code=409, detail="This score has not been edited")
        for number, pass_record in passes.items():
            if is_edited(pass_record.meta):
                _restore_pass(pass_record)
            meta.pop(f"pass_{number}_original", None)
    # The item is the mean over its passes again (the edit path's rule).
    meta.pop(ITEM_EDIT_KEY, None)
    reduced, observed = reduce_pass_scores(passes.values(), declared_direction(spec))
    reduced = round(reduced, 6) if reduced is not None else None
    score_record.score_numeric = reduced
    score_record.score_raw = reduced
    if any(is_edited(p.meta) for p in passes.values()):
        meta.pop(EDIT_RECORD_KEY, None)
    else:
        for key in SCORE_EDIT_META_KEYS:
            meta.pop(key, None)
    score_record.meta = _repeat_aggregate_metric_meta(
        {number: p.score_numeric for number, p in passes.items()},
        meta,
        observed=observed,
    )


@router.post("/api/runs/update_metric")
def update_metric(
    request: Dict[str, Any],
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Update a single metric score for a run item.

    With ``pass_number`` (repeat runs), the edit targets that pass's score and
    the run-level score is re-reduced as the mean over passes.
    """
    file_path = request.get("file_path")
    row_index = request.get("row_index")
    metric_name = request.get("metric_name")
    new_score = request.get("new_score")
    pass_number = request.get("pass_number")
    reset = request.get("reset") is True

    if not file_path or metric_name is None or row_index is None:
        raise HTTPException(
            status_code=400, detail="file_path, row_index, and metric_name required"
        )

    # Both paths hold the run row lock that submit takes, so an edit cannot
    # land on scores a reviewer has just been sent (C041).
    run = (
        _lock_pass_mutation_run(db, file_path, request.get("expected_pass_version"))
        if pass_number is not None
        else lock_review_run(db, file_path)
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if not can_modify_run(db, principal, run):
        raise HTTPException(status_code=403, detail="Access denied")
    require_project_writable(db, run.project_id)
    require_scores_unlocked(run)

    run_samples = int(run.samples or 1)
    repeat_context = has_repeat_pass_context(run)
    if pass_number is not None:
        try:
            pass_number = int(pass_number)
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=400, detail="pass_number must be an integer"
            )
        if not repeat_context or pass_number < 1 or pass_number > run_samples:
            raise HTTPException(
                status_code=400, detail="pass_number out of range for this run"
            )

    # Find the item by index
    item = (
        db.query(RunItem)
        .filter(RunItem.run_id == run.id, RunItem.index == int(row_index))
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if pass_number is not None:
        # Correction-ID review actions use Item -> Pass locks without taking
        # the Run lock. Serialize with them before reading shared score meta.
        item = lock_run_item(db, run=run, item=item)

    # Find or create the score record
    score_record = (
        db.query(RunItemScore)
        .filter(
            RunItemScore.run_id == run.id,
            RunItemScore.item_id == item.item_id,
            RunItemScore.metric_name == metric_name,
        )
        .populate_existing()
        .first()
    )

    # Validate before anything is written: the metric must belong to the run
    # and the score must be a number its type accepts (C009).
    if not score_record and metric_name not in (run.metrics or []):
        raise HTTPException(
            status_code=422, detail=f"Unknown metric for this run: {metric_name}"
        )
    spec = (
        db.query(RunMetricSpec)
        .filter(
            RunMetricSpec.run_id == run.id, RunMetricSpec.metric_name == metric_name
        )
        .first()
    )
    if reset:
        # "Reset to original" (C041): give back the scorer's value.
        if score_record is None:
            raise HTTPException(status_code=409, detail="This score has not been edited")
        previous_value = _edit_audit_value(
            db, run, item, metric_name, pass_number, score_record
        )
        try:
            _reset_score_edit(
                db,
                run=run,
                item=item,
                metric_name=metric_name,
                pass_number=pass_number,
                score_record=score_record,
                spec=spec,
            )
        except ScoreResetError as exc:
            # Nothing is committed: the edit and its record stay as they are.
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        db.flush()
        _record_score_edit(
            db,
            principal,
            run=run,
            item=item,
            metric_name=metric_name,
            pass_number=pass_number,
            action="reset",
            previous=previous_value,
            new=_edit_audit_value(db, run, item, metric_name, pass_number, score_record),
        )
        sync_run_scores(db, run)  # re-score: refresh the best-run index
        db.commit()
        return _with_item_visibility(
        db,
        principal,
        run,
        _updated_metric_row(db, run, item, run_samples, repeat_context),
    )

    score_type = spec.score_type if spec else None
    if pass_number is None and run_samples > 1:
        # A repeat run's item value is the mean over its passes.
        score_type = reduced_score_type(score_type)
    try:
        numeric_val = parse_score_edit(new_score, score_type)
    except ScoreEditError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    if not score_record:
        score_record = RunItemScore(
            run_id=run.id,
            item_id=item.item_id,
            metric_name=metric_name,
            meta={},
        )
        db.add(score_record)
    previous_value = _edit_audit_value(
        db, run, item, metric_name, pass_number, score_record
    )
    edited_at = utc_now_naive()
    record = edit_record(
        user_id=principal.user.id if principal.auth_type != "none" else None,
        user_name=_principal_name(principal),
        at=to_api_timestamp(edited_at),
        previous=previous_value,
        new=numeric_val,
    )
    if pass_number is not None:
        record["pass_number"] = pass_number

    # Store original score in meta if not already stored
    meta = dict(score_record.meta or {})
    if "original_score" not in meta:
        meta["original_score"] = (
            score_record.score_raw
            if score_record.score_raw is not None
            else score_record.score_numeric
        )
        if (
            score_record.score_raw is not None
            and score_record.score_raw != score_record.score_numeric
        ):
            # A raw value that is not the number (a label, a boolean...):
            # keep the number too (None included) so a reset restores both.
            meta[ORIGINAL_NUMERIC_KEY] = score_record.score_numeric
    meta["modified"] = "true"
    meta[EDIT_RECORD_KEY] = record

    if pass_number is not None:
        # RunItemPassScore comes from the module import: a local import here
        # made it unbound for repeat-run item edits without a pass (C009).
        pass_record = (
            db.query(RunItemPassScore)
            .filter(
                RunItemPassScore.run_id == run.id,
                RunItemPassScore.item_id == item.item_id,
                RunItemPassScore.metric_name == metric_name,
                RunItemPassScore.pass_number == pass_number,
            )
            .populate_existing()
            .with_for_update()
            .first()
        )
        if not pass_record:
            pass_record = RunItemPassScore(
                run_id=run.id,
                item_id=item.item_id,
                metric_name=metric_name,
                pass_number=pass_number,
            )
            db.add(pass_record)
        meta.setdefault(f"pass_{pass_number}_original", pass_record.score_numeric)
        # The item is the mean over its passes again, replacing any value a
        # reviewer gave the item as a whole.
        meta.pop(ITEM_EDIT_KEY, None)
        pass_meta = dict(pass_record.meta or {})
        pass_meta.setdefault("original_score", pass_record.score_numeric)
        pass_meta["modified"] = "true"
        pass_meta[EDIT_RECORD_KEY] = record
        # The edited pass holds a reviewer's score, not a scorer failure.
        pass_record.meta = supersede_metric_error(pass_meta)
        pass_record.score_numeric = numeric_val

        # Re-reduce with the ingest rule: the item value is the mean over its
        # passes, a failed pass without a score counting as 0 (C015), or left
        # out when lower is better (services/run_means.py).
        siblings = {
            int(p.pass_number): p
            for p in db.query(RunItemPassScore).filter(
                RunItemPassScore.run_id == run.id,
                RunItemPassScore.item_id == item.item_id,
                RunItemPassScore.metric_name == metric_name,
            )
        }
        # autoflush is off: a pass row created above is not in the query yet.
        siblings[pass_number] = pass_record
        reduced, observed = reduce_pass_scores(
            siblings.values(), declared_direction(spec)
        )
        reduced = round(reduced, 6) if reduced is not None else None
        score_record.score_numeric = reduced
        score_record.score_raw = reduced
        meta = _repeat_aggregate_metric_meta(
            {number: p.score_numeric for number, p in siblings.items()},
            meta,
            observed=observed,
        )
    else:
        score_record.score_numeric = numeric_val
        score_record.score_raw = numeric_val
        # A reviewer's score replaces a failed scorer's: the row stops
        # counting as a scorer error; the failure is kept as original_*.
        meta = supersede_metric_error(meta)
        if run_samples > 1:
            # A repeat item scored as a whole keeps this value in every mean,
            # errored passes or not, until one of its passes changes.
            meta[ITEM_EDIT_KEY] = "true"
        if run_samples <= 1:
            # Imports can keep a pass-1 copy of a classic score, which the
            # error counts also read.
            for pass_copy in db.query(RunItemPassScore).filter(
                RunItemPassScore.run_id == run.id,
                RunItemPassScore.item_id == item.item_id,
                RunItemPassScore.metric_name == metric_name,
            ):
                if is_metric_error(pass_copy.meta):
                    pass_copy.meta = supersede_metric_error(dict(pass_copy.meta))

    score_record.meta = meta
    db.flush()
    _record_score_edit(
        db,
        principal,
        run=run,
        item=item,
        metric_name=metric_name,
        pass_number=pass_number,
        action="edit",
        previous=previous_value,
        new=numeric_val,
    )
    sync_run_scores(db, run)  # re-score: refresh the best-run index
    db.commit()
    return _with_item_visibility(
        db,
        principal,
        run,
        _updated_metric_row(db, run, item, run_samples, repeat_context),
    )


def _updated_metric_row(
    db: Session, run: Run, item: RunItem, run_samples: int, repeat_context: bool
) -> Dict[str, Any]:
    """The edited item's row, in the compare API format."""
    # Build the updated row response matching the compare API format
    metrics = list(run.metrics or [])
    all_scores = (
        db.query(RunItemScore)
        .filter(RunItemScore.run_id == run.id, RunItemScore.item_id == item.item_id)
        .all()
    )
    score_map = {s.metric_name: s for s in all_scores}

    metric_values: list[Any] = []
    metric_meta: dict[str, Any] = {}
    for m in metrics:
        sc = score_map.get(m)
        if not sc:
            metric_values.append("")
            continue
        val = sc.score_raw
        if sc.score_numeric is not None:
            val = sc.score_numeric
        metric_values.append(val)
        if sc.meta:
            metric_meta[m] = sc.meta

    # Repeat runs: ship pass_scores/pass_attempts so the client row keeps its
    # per-pass detail (and pass-scoped pages can re-apply their lens).
    pass_scores: Optional[Dict[str, list]] = None
    pass_metric_meta: Optional[Dict[str, list]] = None
    pass_metric_analyses: Optional[Dict[str, list]] = None
    pass_attempts: Optional[list] = None
    if repeat_context:
        by_metric: Dict[str, Dict[int, Optional[float]]] = {}
        by_metric_meta: Dict[str, Dict[int, Dict[str, Any]]] = {}
        by_metric_analysis: Dict[str, Dict[int, Dict[str, Any]]] = {}
        pass_score_rows = (
            db.query(RunItemPassScore)
            .filter(
                RunItemPassScore.run_id == run.id,
                RunItemPassScore.item_id == item.item_id,
            )
            .all()
        )
        for ps in pass_score_rows:
            by_metric.setdefault(ps.metric_name, {})[
                int(ps.pass_number)
            ] = ps.score_numeric
            ps_meta = dict(ps.meta) if ps.meta else {}
            _set_task_error_flag(ps_meta, ps.label, ps.meta, ps.explanation)
            pass_analysis = ps_meta.pop(PASS_ANALYSIS_META_KEY, None)
            if isinstance(pass_analysis, dict):
                by_metric_analysis.setdefault(ps.metric_name, {})[
                    int(ps.pass_number)
                ] = pass_analysis
            if ps.label:
                ps_meta.setdefault("label", ps.label)
            if ps.explanation:
                ps_meta.setdefault("explanation", ps.explanation)
            if ps_meta:
                by_metric_meta.setdefault(ps.metric_name, {})[
                    int(ps.pass_number)
                ] = ps_meta
        pass_scores = {
            m: [by_pass.get(p) for p in range(1, run_samples + 1)]
            for m, by_pass in by_metric.items()
        }
        pass_metric_meta = (
            {
                m: [by_pass.get(p) for p in range(1, run_samples + 1)]
                for m, by_pass in by_metric_meta.items()
            }
            if by_metric_meta
            else None
        )
        pass_metric_analyses = (
            {
                m: [by_pass.get(p) for p in range(1, run_samples + 1)]
                for m, by_pass in by_metric_analysis.items()
            }
            if by_metric_analysis
            else None
        )
        attempts_by_pass: Dict[int, Dict[str, Any]] = {}
        final_attempts = (
            db.query(RunItemAttempt)
            .filter(
                RunItemAttempt.run_id == run.id,
                RunItemAttempt.item_id == item.item_id,
                RunItemAttempt.is_last_attempt.is_(True),
            )
            .all()
        )
        missing_output_pairs = {
            (att.item_id, int(att.pass_number))
            for att in final_attempts
            if att.output is None
        }
        recovered_outputs = _completed_pass_outputs(db, run.id, missing_output_pairs)
        for att in final_attempts:
            att_error = att.error or ""
            is_failed = str(att.status or "").lower() == "failed"
            attempt_output = att.output
            if attempt_output is None:
                attempt_output = recovered_outputs.get(
                    (att.item_id, int(att.pass_number))
                )
            attempts_by_pass[int(att.pass_number)] = {
                "pass_number": int(att.pass_number),
                "status": "error" if is_failed else "completed",
                "output": (
                    f"ERROR: {att_error}"
                    if is_failed and att_error
                    else _stringify(attempt_output)
                ),
                "error": att_error,
                "latency_ms": att.latency_ms,
                "trace_id": att.trace_id or "",
                "trace_url": att.trace_url or "",
            }
        pass_attempts = [attempts_by_pass.get(p) for p in range(1, run_samples + 1)]

    is_error = bool(item.error)
    status = (
        "error"
        if is_error
        else "not_received"
        if item_not_received(
            execution_outcomes(db, [run])[run.id],
            run_samples,
            item.error,
            item.output,
            item.latency_ms,
        )
        else "completed"
    )
    duplicate_counts: Dict[str, int] = {}
    ordered_items = (
        db.query(RunItem)
        .filter(RunItem.run_id == run.id)
        .order_by(RunItem.index.asc())
        .all()
    )
    identity = {"compare_item_id": item.item_id, "compare_alignment_source": "item_id"}
    for ordered_item in ordered_items:
        ordered_metadata = (
            ordered_item.item_metadata
            if isinstance(ordered_item.item_metadata, dict)
            else {}
        )
        ordered_identity = build_compare_identity(
            item_id=ordered_item.item_id,
            input_value=ordered_item.input,
            expected_value=ordered_item.expected,
            metadata=ordered_metadata,
            duplicate_counts=duplicate_counts,
        )
        if ordered_item.id == item.id:
            identity = ordered_identity
            break

    row = {
        "index": item.index,
        "item_id": item.item_id,
        "compare_item_id": identity["compare_item_id"],
        "compare_alignment_source": identity["compare_alignment_source"],
        "status": status,
        "error": item.error or "",
        "input": item.input,
        "input_full": item.input,
        "output": item.output if not is_error else f"ERROR: {item.error}",
        "output_full": item.output if not is_error else f"ERROR: {item.error}",
        "expected": item.expected,
        "expected_full": item.expected,
        "time": ""
        if item.latency_ms is None
        else f"{(item.latency_ms or 0)/1000.0:.3f}",
        "latency_ms": item.latency_ms or 0,
        "retry_count": int(
            item.retry_count
            or (
                item.item_metadata.get("retry_count")
                if isinstance(item.item_metadata, dict)
                else 0
            )
            or 0
        ),
        "trace_id": item.trace_id or "",
        "trace_url": item.trace_url or "",
        "task_started_at_ms": item.item_metadata.get("task_started_at_ms")
        if isinstance(item.item_metadata, dict)
        else None,
        "metric_values": metric_values,
        "metric_meta": metric_meta,
        "item_metadata": item.item_metadata
        if isinstance(item.item_metadata, dict)
        else {},
        "pass_scores": pass_scores,
        "pass_metric_meta": pass_metric_meta,
        "pass_metric_analyses": pass_metric_analyses,
        "pass_attempts": pass_attempts,
    }

    return {"ok": True, "row": row}


def _require_issue_decision(
    db: Session,
    principal: Principal,
    run: Run,
    item_id: str,
    metric_name: str,
    pass_number: Optional[int],
    issue_id: Any,
    issue_index: Any = None,
    analysis: Optional[Dict[str, Any]] = None,
) -> None:
    """Approving an issue from the run page follows the project's review rules (C074).

    The issue is resolved the way ``change_metric_issue`` resolves it: by
    ``issue_id``, else by ``issue_index`` into the analysis, so a request that
    names the issue only by position is judged against the same correction.
    """
    if not issue_id and analysis is not None and type(issue_index) is int:
        issues = analysis_root_cause_issues(analysis)
        if 0 <= issue_index < len(issues):
            issue_id = issues[issue_index].get("issue_id")
    rows = _active_issue_rows(db, run, item_id, metric_name, pass_number)
    candidate = next(
        (row for row in rows if issue_id and correction_issue_id(row) == str(issue_id)),
        None,
    )
    if candidate is None:
        # An issue of a legacy grouped review (no per-issue row yet) is
        # judged on the grouped review, as it is before the approval splits it.
        candidate = next((row for row in rows if not correction_issue_id(row)), None)
    require_correction_decision(db, principal, run.project_id, candidate)


def _active_issue_rows(
    db: Session,
    run: Run,
    item_id: str,
    metric_name: Optional[str],
    pass_number: Optional[int],
) -> List[ReviewCorrection]:
    """Active corrections of one item scope (item-level when ``metric_name`` is None)."""
    return db.query(ReviewCorrection).filter(
        ReviewCorrection.run_id == run.id,
        ReviewCorrection.item_id == item_id,
        (
            ReviewCorrection.metric_name.is_(None)
            if metric_name is None
            else ReviewCorrection.metric_name == metric_name
        ),
        ReviewCorrection.is_active.is_(True),
        (
            ReviewCorrection.pass_number.is_(None)
            if pass_number is None
            else ReviewCorrection.pass_number == pass_number
        ),
    ).all()


def _removed_issue_ids(before: Any, after: Any) -> List[Optional[str]]:
    """Issues of ``before`` that ``after`` no longer has.

    ID-less (legacy) issues have no identity, so a shorter list removes from
    the grouped review that holds them (reported as ``None``).
    """
    previous = analysis_root_cause_issues(before)
    kept = analysis_root_cause_issues(after)
    if any(issue.get("issue_id") for issue in previous):
        kept_ids = {issue.get("issue_id") for issue in kept}
        return [
            issue["issue_id"]
            for issue in previous
            if issue.get("issue_id") and issue["issue_id"] not in kept_ids
        ]
    return [None] * max(0, len(previous) - len(kept))


def _require_issue_removal(
    db: Session,
    principal: Principal,
    run: Run,
    rows: List[ReviewCorrection],
    removed_ids: List[Optional[str]],
) -> None:
    """Removing an issue follows the rule for deleting its correction (C074).

    Call before any change: a legacy split must not make the remover the
    author. An issue is judged on its own row, else on the grouped review
    that holds it; an issue with no row (a fresh AI diagnosis) on the role
    rule alone.
    """
    by_id = {correction_issue_id(row): row for row in rows if correction_issue_id(row)}
    grouped = [row for row in rows if not correction_issue_id(row)]
    for issue_id in removed_ids:
        own = by_id.get(str(issue_id)) if issue_id else None
        targets = [own] if own is not None else grouped
        for row in targets:
            require_correction_delete(db, principal, run.project_id, row)
        if not targets and correction_decision_block(db, principal, run.project_id):
            raise HTTPException(status_code=403, detail=DELETE_DETAIL)


def _updated_item_row(db: Session, run: Run, item_id: str) -> Optional[Dict[str, Any]]:
    """The edited item's UI row, built from that item alone.

    A fingerprint-based comparison ID numbers duplicate items across the
    whole run, so a one-item build cannot know it: such a row leaves the
    comparison identity out and the page keeps its own (as items/details).
    """
    rows = _build_run_data(db, run, item_ids=[item_id]).get("snapshot", {}).get("rows", [])
    row = next((row for row in rows if row.get("item_id") == item_id), None)
    if row is not None and row.get("compare_alignment_source") == "fingerprint":
        row.pop("compare_item_id", None)
        row.pop("compare_alignment_source", None)
    return row


@router.post("/api/runs/update_root_cause_issue")
def update_root_cause_issue(
    request: Dict[str, Any],
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Save or approve exactly one issue, with explicit run/metric/pass scope."""
    run_id = str(request.get("run_id") or "")
    item_id = str(request.get("item_id") or "")
    metric_name = str(request.get("metric_name") or "").strip()
    if not run_id or not item_id or not metric_name:
        raise HTTPException(400, "run_id, item_id, and metric_name required")
    run = (
        _lock_pass_mutation_run(db, run_id, request.get("expected_pass_version"))
        if request.get("pass_number") is not None
        else Run.active(db).filter(Run.id == run_id).first()
    )
    if run is None:
        raise HTTPException(404, "Run not found")
    permission = can_review_run if request.get("action") == "approve" else can_modify_run
    if not permission(db, principal, run):
        raise HTTPException(403, "Access denied")
    require_project_writable(db, run.project_id)
    item = db.query(RunItem).filter(RunItem.run_id == run.id, RunItem.item_id == item_id).first()
    if item is None:
        raise HTTPException(404, "Item not found")
    item = lock_run_item(db, run=run, item=item)
    meta = dict(item.item_metadata or {})
    metric_analyses = dict(meta.get("metric_analyses") or {})
    if metric_name not in {str(name) for name in (run.metrics or [])} | set(metric_analyses):
        raise HTTPException(400, "Unknown metric_name")
    pass_number = request.get("pass_number")
    samples = int(run.samples or 1)
    repeat_context = has_repeat_pass_context(run)
    if repeat_context and pass_number is None:
        raise HTTPException(400, "pass_number is required for a repeat-run diagnosis")
    if pass_number is not None and (type(pass_number) is not int or not repeat_context or not 1 <= pass_number <= samples):
        raise HTTPException(400, "pass_number is outside this run")
    pass_score = None
    if pass_number is not None:
        pass_score = db.query(RunItemPassScore).filter(
            RunItemPassScore.run_id == run.id, RunItemPassScore.item_id == item_id,
            RunItemPassScore.metric_name == metric_name, RunItemPassScore.pass_number == pass_number,
        ).with_for_update().one_or_none()
        if pass_score is None:
            raise HTTPException(404, "Pass score not found")
        analysis = (pass_score.meta or {}).get(PASS_ANALYSIS_META_KEY) or {}
    else:
        analysis = metric_analyses.get(metric_name) or {}
    if request.get("action") == "approve":
        _require_issue_decision(
            db, principal, run, item_id, metric_name, pass_number, request.get("issue_id"),
            issue_index=request.get("issue_index"), analysis=analysis,
        )
    elif request.get("action") == "delete":
        # Resolve the target as change_metric_issue does; a stale one is its 409.
        issues = analysis_root_cause_issues(analysis)
        target_id, index = request.get("issue_id"), request.get("issue_index")
        if target_id:
            target = next((issue for issue in issues if issue.get("issue_id") == target_id), None)
        else:
            target = issues[index] if type(index) is int and 0 <= index < len(issues) else None
        if target is not None:
            _require_issue_removal(
                db, principal, run,
                _active_issue_rows(db, run, item_id, metric_name, pass_number),
                [target.get("issue_id")],
            )
    analysis = change_metric_issue(
        db, run=run, item=item, metric_name=metric_name, analysis=analysis,
        request=request, actor_user_id=principal.user.id if principal.auth_type != "none" else None,
        pass_number=pass_number,
    )
    if pass_score is not None:
        pass_score.meta = {**(pass_score.meta or {}), PASS_ANALYSIS_META_KEY: analysis}
    else:
        metric_analyses[metric_name] = analysis
        meta["metric_analyses"] = metric_analyses
        _refresh_metric_analysis_error(meta)
        item.item_metadata = meta
    db.commit()
    return _with_item_visibility(
        db, principal, run, {"ok": True, "row": _updated_item_row(db, run, item_id)}
    )


@router.post("/api/runs/update_root_cause")
def update_root_cause(
    request: Dict[str, Any],
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Update item-level or metric-level root-cause analysis for one run item.

    Each field is only modified when its key is explicitly present in the request.
    This prevents partial saves (e.g. saving only root_cause_note) from erasing
    unrelated fields like root_cause or root_cause_detail.

    Supplying ``metric_name`` scopes the patch to the corresponding entry in
    ``item_metadata.metric_analyses`` and leaves the legacy item-level summary
    untouched.
    """
    item_id = request.get("item_id")
    run_id = request.get("run_id")

    if not item_id or not run_id:
        raise HTTPException(status_code=400, detail="item_id and run_id required")

    run = (
        _lock_pass_mutation_run(db, run_id, request.get("expected_pass_version"))
        if request.get("pass_number") is not None
        else Run.active(db).filter(Run.id == run_id).first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if not can_modify_run(db, principal, run):
        raise HTTPException(status_code=403, detail="Access denied")
    require_project_writable(db, run.project_id)

    item = (
        db.query(RunItem)
        .filter(RunItem.run_id == run.id, RunItem.item_id == item_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item = lock_run_item(db, run=run, item=item)

    editable_fields = (
        "root_cause",
        "root_causes",
        "root_cause_issues",
        "category_taxonomy",
        "root_cause_detail",
        "root_cause_note",
        "solution",
        "solution_note",
    )
    patch = {}
    for field in editable_fields:
        if field in request or (
            field == "root_cause_note" and request.get(field) is not None
        ):
            patch[field] = request.get(field)

    raw_pass_number = request.get("pass_number")
    pass_number: Optional[int] = None
    if raw_pass_number is not None:
        try:
            pass_number = int(raw_pass_number)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Invalid pass_number") from exc
        if pass_number < 1:
            raise HTTPException(status_code=400, detail="pass_number must be positive")
    run_samples = int(getattr(run, "samples", 1) or 1)
    repeat_context = has_repeat_pass_context(run)
    if repeat_context and pass_number is None:
        raise HTTPException(
            status_code=400,
            detail="pass_number is required when editing a repeat-run diagnosis",
        )
    if pass_number is not None and (
        not repeat_context or pass_number > run_samples
    ):
        raise HTTPException(status_code=400, detail="pass_number is outside this run")

    if pass_number is not None:
        raw_metric_name = request.get("metric_name")
        metric_name = str(raw_metric_name or "").strip()
        if not metric_name:
            raise HTTPException(
                status_code=400,
                detail="metric_name is required for a repeat-run diagnosis",
            )
        known_metrics = {str(name) for name in (run.metrics or [])}
        if metric_name not in known_metrics:
            raise HTTPException(status_code=400, detail="Unknown metric_name")
        pass_score = (
            db.query(RunItemPassScore)
            .filter(
                RunItemPassScore.run_id == run.id,
                RunItemPassScore.item_id == item.item_id,
                RunItemPassScore.metric_name == metric_name,
                RunItemPassScore.pass_number == pass_number,
            )
            .with_for_update()
            .one_or_none()
        )
        if pass_score is None:
            raise HTTPException(status_code=404, detail="Pass score not found")

        pass_meta = dict(pass_score.meta) if isinstance(pass_score.meta, dict) else {}
        before_analysis = (
            dict(pass_meta.get(PASS_ANALYSIS_META_KEY))
            if isinstance(pass_meta.get(PASS_ANALYSIS_META_KEY), dict)
            else {}
        )
        after_analysis = _apply_metric_analysis_patch(before_analysis, patch)
        from qym_platform.services.issue_reviews import sync_issue_candidates

        existing_reviews = db.query(ReviewCorrection).filter(
            ReviewCorrection.run_id == run.id, ReviewCorrection.item_id == item.item_id,
            ReviewCorrection.metric_name == metric_name, ReviewCorrection.pass_number == pass_number,
            ReviewCorrection.is_active.is_(True),
        ).all()
        _require_issue_removal(
            db, principal, run, existing_reviews,
            _removed_issue_ids(before_analysis, after_analysis),
        )
        if existing_reviews:
            sync_issue_candidates(
                db, run=run, item=item, metric_name=metric_name,
                analysis=after_analysis, actor_user_id=(
                    principal.user.id if principal.auth_type != "none" else None
                ), actor_source="human", pass_number=pass_number, active_candidates=existing_reviews,
            )
        elif after_analysis:
            after_analysis["review_status"] = "pending"
        if after_analysis:
            pass_meta[PASS_ANALYSIS_META_KEY] = after_analysis
        else:
            pass_meta.pop(PASS_ANALYSIS_META_KEY, None)
        pass_score.meta = pass_meta

        if before_analysis != after_analysis:
            db.add(
                AuditLog(
                    actor_user_id=(
                        principal.user.id if principal.auth_type != "none" else None
                    ),
                    action="metric_root_cause_change:human",
                    entity_type="run_item_pass_metric_analysis",
                    entity_id=(
                        f"{run.id}:{item.item_id}:{pass_number}:{metric_name}"
                    ),
                    before=before_analysis,
                    after=after_analysis,
                    created_at=utc_now_naive(),
                )
            )
        db.commit()
        updated_row = _updated_item_row(db, run, item.item_id)
        return _with_item_visibility(db, principal, run, {"ok": True, "row": updated_row})

    raw_metric_name = request.get("metric_name")
    if raw_metric_name is not None:
        metric_name = str(raw_metric_name).strip()
        if not metric_name:
            raise HTTPException(status_code=400, detail="metric_name must not be empty")

        meta = dict(item.item_metadata) if isinstance(item.item_metadata, dict) else {}
        metric_analyses = (
            dict(meta.get("metric_analyses"))
            if isinstance(meta.get("metric_analyses"), dict)
            else {}
        )
        known_metrics = {str(name) for name in (run.metrics or [])}
        known_metrics.update(str(name) for name in metric_analyses)
        if metric_name not in known_metrics:
            raise HTTPException(status_code=400, detail="Unknown metric_name")

        before_analysis = (
            dict(metric_analyses.get(metric_name))
            if isinstance(metric_analyses.get(metric_name), dict)
            else {}
        )
        analysis = _apply_metric_analysis_patch(before_analysis, patch)
        _require_issue_removal(
            db, principal, run,
            _active_issue_rows(db, run, item.item_id, metric_name, None),
            _removed_issue_ids(before_analysis, analysis),
        )

        meaningful_analysis = {
            key: value
            for key, value in analysis.items()
            if key != "source" and value not in (None, "", [])
        }
        if meaningful_analysis:
            metric_analyses[metric_name] = analysis
        else:
            metric_analyses.pop(metric_name, None)

        if metric_analyses:
            meta["metric_analyses"] = metric_analyses
        else:
            meta.pop("metric_analyses", None)
        _refresh_metric_analysis_error(meta)
        item.item_metadata = meta

        after_analysis = dict(metric_analyses.get(metric_name) or {})
        if before_analysis != after_analysis:
            replace_metric_review_candidate(
                db,
                run=run,
                item=item,
                metric_name=metric_name,
                analysis=after_analysis,
                actor_user_id=(
                    principal.user.id if principal.auth_type != "none" else None
                ),
                actor_source="human",
                item_locked=True,
            )
            db.add(
                AuditLog(
                    actor_user_id=(
                        principal.user.id if principal.auth_type != "none" else None
                    ),
                    action="metric_root_cause_change:human",
                    entity_type="run_item_metric_analysis",
                    entity_id=f"{run.id}:{item.item_id}:{metric_name}",
                    before=before_analysis,
                    after=after_analysis,
                    created_at=utc_now_naive(),
                )
            )
        db.commit()
        updated_row = _updated_item_row(db, run, item.item_id)
        return _with_item_visibility(db, principal, run, {"ok": True, "row": updated_row})

    item_state = extract_analysis_state(
        item.item_metadata if isinstance(item.item_metadata, dict) else {}
    )
    if item_state.get("root_cause") and not apply_human_patch(item_state, patch).get("root_cause"):
        # Clearing the item diagnosis withdraws its grouped correction.
        _require_issue_removal(
            db, principal, run, _active_issue_rows(db, run, item.item_id, None, None), [None]
        )
    apply_root_cause_change(
        db,
        run=run,
        item=item,
        actor_user_id=principal.user.id if principal.auth_type != "none" else None,
        actor_source="human",
        human_patch=patch,
        item_locked=True,
    )

    db.commit()
    updated_row = _updated_item_row(db, run, item.item_id)
    return _with_item_visibility(db, principal, run, {"ok": True, "row": updated_row})


@router.post("/api/runs/{run_id}/force-stop")
def force_stop_run(
    run_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Permanently close an SDK run to ingestion, without deleting its results."""
    if principal.user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")
    # Ingestion holds this row lock for its entire transaction. Once this stop
    # commits, no later batch can change the run or any of its event data.
    run = (
        db.query(Run)
        .filter(Run.id == run_id)
        .with_for_update()
        .populate_existing()
        .first()
    )
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    require_project_writable(db, run.project_id)
    stopped = False
    if not is_run_force_stopped(run):
        if not can_force_stop_run(run):
            raise HTTPException(status_code=409, detail="Run has already finished")
        before = run.audit_snapshot()
        before["status_reason"] = run.status_reason
        run.status = RunWorkflowStatus.STOPPED
        run.status_reason = RUN_STATUS_REASON_ADMIN_FORCE_STOP
        run.ended_at = utc_now_naive()
        # Preserve last_event_at: stopping is an admin action, not runner activity.
        db.add(
            AuditLog(
                actor_user_id=principal.user.id,
                action="run.force_stopped",
                entity_type="run",
                entity_id=run.id,
                before=before,
                after={
                    "status": run.status.value,
                    "status_reason": run.status_reason,
                    "ended_at": to_api_timestamp(run.ended_at),
                },
            )
        )
        stopped = True
    result = {
        "ok": True,
        "run_id": run.id,
        "stopped": stopped,
        "status": run.status.value,
        "status_reason": run.status_reason,
        "ended_at": to_api_timestamp(run.ended_at),
        "can_force_stop": False,
    }
    db.commit()
    return result


@router.post("/api/runs/delete")
def delete_run(
    request: Dict[str, Any],
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Delete a run and all associated data."""
    file_path = request.get("file_path")
    if not file_path:
        raise HTTPException(status_code=400, detail="file_path required")

    # FOR NO KEY UPDATE: deletion sets only non-key columns, so it need not
    # wait for (or block) inserts of the run's child rows (FOR KEY SHARE).
    run = (
        Run.active(db).filter(Run.id == file_path)
        .populate_existing().with_for_update(key_share=True).first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if not can_delete_run(db, principal, run):
        raise HTTPException(status_code=403, detail="Permission denied")
    require_project_writable(db, run.project_id)

    # Soft-delete only. All evaluation, analysis, and review history remains
    # available if an administrator restores the run before retention purges
    # it (deleted_run_grace_days after deletion).
    snapshot = run.audit_snapshot()
    run.deleted_at = utc_now_naive()
    run.deleted_by_user_id = principal.user.id
    # The Trash grace period counts from this deletion.
    run.purge_clock_started_at = None
    _set_dashboard_visibility(db, run.id, False)

    audit = AuditLog(
        actor_user_id=principal.user.id,
        action="run.deleted",
        entity_type="run",
        entity_id=run.id,
        before=snapshot,
        after={
            "deleted_at": run.deleted_at.isoformat(),
        },
    )
    db.add(audit)
    db.commit()

    return {
        "ok": True,
        "purge_after_days": PlatformSettings().deleted_run_grace_days,
    }


@router.post("/api/runs/restore")
def restore_run(
    request: Dict[str, Any],
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Restore a soft-deleted run (admin only).

    ``{"run_id": ...}`` restores one run and fails as before. ``{"run_ids":
    [...]}`` restores up to 200 runs in one transaction; runs that are no
    longer in Trash or belong to an archived project are skipped and listed in
    ``skipped`` with the reason, so one stale row does not block the rest.
    """
    if principal.user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")

    run_ids = request.get("run_ids")
    if run_ids is not None:
        if (
            not isinstance(run_ids, list)
            or not run_ids
            or not all(isinstance(value, str) and value for value in run_ids)
        ):
            raise HTTPException(status_code=400, detail="run_ids must be a non-empty list of run ids")
        if len(run_ids) > TRASH_PAGE_MAX:
            raise HTTPException(
                status_code=400, detail=f"Restore at most {TRASH_PAGE_MAX} runs at a time"
            )
        wanted = list(dict.fromkeys(run_ids))
        runs = {
            run.id: run
            for run in db.query(Run)
            .filter(Run.id.in_(wanted), Run.deleted_at.isnot(None))
            .order_by(Run.id)
            .with_for_update(key_share=True)
            .populate_existing()
            .all()
        }
        archived = {
            row[0]
            for row in db.query(Project.id).filter(
                Project.id.in_({run.project_id for run in runs.values()}),
                Project.is_active.is_(False),
            )
        } if runs else set()
        restored: List[str] = []
        skipped: List[Dict[str, str]] = []
        # One lock order (by id) for the Run rows and their projection rows.
        for run_id in sorted(wanted):
            run = runs.get(run_id)
            if run is None:
                skipped.append({"run_id": run_id, "reason": "Deleted run not found"})
            elif run.project_id in archived:
                skipped.append({"run_id": run_id, "reason": ARCHIVED_PROJECT_DETAIL})
            else:
                _restore_deleted_run(db, run, principal)
                restored.append(run_id)
        db.commit()
        return {"ok": True, "restored": restored, "skipped": skipped}

    run_id = request.get("run_id")
    if not run_id:
        raise HTTPException(status_code=400, detail="run_id required")

    run = (
        db.query(Run)
        .filter(Run.id == run_id, Run.deleted_at.isnot(None))
        .with_for_update(key_share=True)
        .populate_existing()
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Deleted run not found")
    require_project_writable(db, run.project_id)

    _restore_deleted_run(db, run, principal)
    db.commit()

    return {"ok": True}


def _restore_deleted_run(db: Session, run: Run, principal: Principal) -> None:
    run.deleted_at = None
    _set_dashboard_visibility(db, run.id, True)
    run.deleted_by_user_id = None
    run.purge_clock_started_at = None
    db.add(
        AuditLog(
            actor_user_id=principal.user.id,
            action="run.restored",
            entity_type="run",
            entity_id=run.id,
            before={"deleted_at": True},
            after={},
        )
    )


def _submit_locked(
    db: Session, principal: Principal, run: Run, comment: str = ""
) -> None:
    """Submit one run, already locked, for approval.

    The owner submits their run; a project manager or admin may submit any
    run of the project for its owner (C072), recorded as on behalf of them.
    """
    # A removed member keeps run ownership on record but loses the rights it gave.
    if not has_project_access(db, principal, run.project_id):
        raise HTTPException(status_code=403, detail="Access denied")
    is_owner = run.owner_user_id == principal.user.id
    if not is_owner and not _can_approve_run(db, principal, run):
        raise HTTPException(
            status_code=403,
            detail="Only the run owner, a project manager or an admin can submit",
        )
    require_project_writable(db, run.project_id)
    # Allow completed/failed runs and rejected runs that need another review pass.
    if run.status not in SUBMITTABLE_STATUSES:
        raise state_conflict(
            run, "Only a completed, failed or rejected run can be submitted"
        )
    from_status = run.status
    now = utc_now_naive()
    approval = lock_approval(db, run)
    keep_legacy_review(db, run, approval)
    # A resubmitted rejection keeps the outcome recorded when it first entered review.
    outcome = resolve_execution_outcome(db, run, approval)
    if not approval:
        approval = Approval(run_id=run.id, submitted_by_user_id=principal.user.id)
        db.add(approval)
    approval.submitted_by_user_id = principal.user.id
    approval.submitted_at = now
    approval.execution_status = outcome.value
    # The previous decision stays on the approval row; the history keeps every round.
    run.status = RunWorkflowStatus.SUBMITTED
    record_transition(
        db,
        run=run,
        action="submit",
        from_status=from_status,
        actor_user_id=principal.user.id,
        comment=comment,
        approval=approval,
        at=now,
        on_behalf_of_user_id=(
            run.owner_user_id
            if not is_owner and principal.auth_type != "none"
            else None
        ),
    )
    # The list shows the new status before the worker republishes (C040).
    _publish_dashboard_review_state(db, run, approval)


def _submit_comment(body: Optional[Dict[str, Any]]) -> str:
    return str((body or {}).get("comment") or "").strip()


@router.post("/v1/runs/{run_id}/submit")
def submit_run(
    run_id: str,
    body: Optional[Dict[str, Any]] = Body(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    run = lock_review_run(db, run_id)
    _submit_locked(db, principal, run, _submit_comment(body))
    db.commit()
    return {"ok": True, "status": run.status}


# One bulk submission is one transaction; keep it a size a person selects.
MAX_BULK_SUBMIT = 500


@router.post("/v1/runs/submit")
def submit_runs(
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Submit several runs for approval in one transaction (C061).

    Every run is checked under its lock before any is submitted: one run the
    caller may not submit, or that is not in a submittable state, refuses
    the whole request and names that run, and nothing changes.
    """
    raw_ids = body.get("run_ids")
    if (
        not isinstance(raw_ids, list)
        or not raw_ids
        or not all(isinstance(value, str) and value for value in raw_ids)
    ):
        raise HTTPException(status_code=400, detail="run_ids must be a non-empty list of run ids")
    run_ids = sorted(set(raw_ids))
    if len(run_ids) > MAX_BULK_SUBMIT:
        raise HTTPException(
            status_code=400,
            detail=f"Submit at most {MAX_BULK_SUBMIT} runs at once",
        )
    comment = _submit_comment(body)
    # Lock in a stable order so two bulk submissions cannot deadlock.
    runs = []
    for run_id in run_ids:
        try:
            runs.append(lock_review_run(db, run_id))
        except HTTPException as exc:
            db.rollback()
            raise HTTPException(
                status_code=exc.status_code, detail=f"Run {run_id}: {exc.detail}"
            ) from exc
    for run in runs:
        try:
            _submit_locked(db, principal, run, comment)
        except HTTPException as exc:
            db.rollback()
            if PROJECT_STATE_HEADER in (exc.headers or {}):
                # The archived-project refusal reads the same for every write.
                raise
            # Name the run only to someone who may see it; anyone else learns
            # nothing beyond the id they sent.
            label = (
                _run_display_name(run)
                if has_project_access(db, principal, run.project_id)
                else f"Run {run.id}"
            )
            raise HTTPException(
                status_code=exc.status_code,
                detail=f"{label}: {exc.detail}. No runs were submitted.",
                headers=exc.headers,
            ) from exc
    db.commit()
    return {
        "ok": True,
        "submitted": [run.id for run in runs],
        "status": RunWorkflowStatus.SUBMITTED.value,
    }


@router.post("/v1/runs/{run_id}/owner")
def transfer_run_ownership(
    run_id: str,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Give a run to another project member (project managers and admins, C072).

    The new owner submits it and may delete it; the run's history and review
    record are unchanged. Audited as ``run.owner_transferred``.
    """
    run = lock_review_run(db, run_id)
    if not _can_approve_run(db, principal, run):
        raise HTTPException(
            status_code=403,
            detail="Only a project manager or admin can transfer a run",
        )
    require_project_writable(db, run.project_id)
    user_id = str((body or {}).get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id required")
    new_owner = db.get(User, user_id)
    if new_owner is None or not new_owner.is_active or not (
        db.query(ProjectMembership.id)
        .filter(
            ProjectMembership.project_id == run.project_id,
            ProjectMembership.user_id == user_id,
        )
        .first()
    ):
        raise HTTPException(
            status_code=400, detail="The new owner must be an active member of the project"
        )
    previous = run.owner_user_id
    if previous != user_id:
        run.owner_user_id = user_id
        db.add(
            AuditLog(
                actor_user_id=principal.user.id if principal.auth_type != "none" else None,
                action="run.owner_transferred",
                entity_type="run",
                entity_id=run.id,
                before={"owner_user_id": previous},
                after={"owner_user_id": user_id},
            )
        )
    db.commit()
    return {
        "ok": True,
        "run_id": run.id,
        "owner": {
            "id": new_owner.id,
            "email": new_owner.email,
            "display_name": new_owner.display_name or new_owner.email.split("@")[0],
        },
    }


_DECISION_PAST = {
    "approve": "approved",
    "reject": "rejected",
    "unapprove": "unapproved",
    "unreject": "unrejected",
}


def _decide_run(
    db: Session,
    principal: Principal,
    run_id: str,
    body: Optional[Dict[str, Any]],
    *,
    action: str,
) -> Dict[str, Any]:
    """Approve/reject a submitted run, or withdraw an approval/rejection."""
    expected = {
        "approve": RunWorkflowStatus.SUBMITTED,
        "reject": RunWorkflowStatus.SUBMITTED,
        "unapprove": RunWorkflowStatus.APPROVED,
        "unreject": RunWorkflowStatus.REJECTED,
    }[action]
    run = lock_review_run(db, run_id)
    # Permission first: the conflict below reports the run's current status.
    if not _can_approve_run(db, principal, run):
        raise HTTPException(
            status_code=403, detail=f"Only a project manager or admin can {action}"
        )
    require_project_writable(db, run.project_id)
    if run.status != expected:
        raise state_conflict(
            run, f"Only {expected.value} runs can be {_DECISION_PAST[action]}"
        )
    approval = lock_approval(db, run)
    if not approval:
        raise HTTPException(status_code=400, detail="Missing approval record")
    keep_legacy_review(db, run, approval)
    comment = str((body or {}).get("comment") or "")
    now = utc_now_naive()
    if action in ("approve", "reject"):
        approval.decision = (
            ApprovalDecision.APPROVED if action == "approve" else ApprovalDecision.REJECTED
        )
        approval.decision_by_user_id = principal.user.id
        approval.decision_at = now
        approval.comment = comment
        run.status = (
            RunWorkflowStatus.APPROVED if action == "approve" else RunWorkflowStatus.REJECTED
        )
    else:
        # Withdrawing keeps the decision on record and returns the run to its
        # real execution outcome: a failed run stays failed.
        outcome = resolve_execution_outcome(db, run, approval)
        approval.execution_status = outcome.value
        run.status = outcome
    record_transition(
        db,
        run=run,
        action=action,
        from_status=expected,
        actor_user_id=principal.user.id,
        comment=comment,
        approval=approval,
        at=now,
    )
    _publish_dashboard_review_state(db, run, approval)
    db.commit()
    return {"ok": True, "status": run.status}


@router.post("/v1/runs/{run_id}/approve")
def approve_run(
    run_id: str,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    return _decide_run(db, principal, run_id, body, action="approve")


@router.post("/v1/runs/{run_id}/reject")
def reject_run(
    run_id: str,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    return _decide_run(db, principal, run_id, body, action="reject")


@router.post("/v1/runs/{run_id}/unapprove")
def unapprove_run(
    run_id: str,
    body: Optional[Dict[str, Any]] = Body(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    return _decide_run(db, principal, run_id, body, action="unapprove")


@router.post("/v1/runs/{run_id}/unreject")
def unreject_run(
    run_id: str,
    body: Optional[Dict[str, Any]] = Body(default=None),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    return _decide_run(db, principal, run_id, body, action="unreject")


@router.get("/api/runs/{run_id}/review-history")
def get_run_review_history(
    run_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
) -> Dict[str, Any]:
    """Append-only review timeline (submit/approve/reject/withdrawals)."""
    run = Run.active(db).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if not can_view_run(db, principal, run):
        raise HTTPException(status_code=403, detail="Access denied")
    return {
        "run_id": run.id,
        "status": run.status.value if run.status else None,
        "events": review_history(db, run),
    }


# ---------------------------------------------------------------------------
# Spans (OTEL trace data)
# ---------------------------------------------------------------------------


SPANS_PAGE_DEFAULT = 1000
SPANS_PAGE_MAX = 5000


@router.get("/api/runs/{run_id}/spans")
def get_run_spans(
    run_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
    limit: int = Query(default=SPANS_PAGE_DEFAULT, ge=1, le=SPANS_PAGE_MAX),
    offset: int = Query(default=0, ge=0),
    trace_id: Optional[str] = Query(default=None, max_length=200),
):
    """Return a page of a run's OTEL spans, ordered by start time.

    At most ``limit`` spans (default 1000, max 5000) from ``offset``,
    optionally of one ``trace_id``. ``next_offset`` is the offset of the next
    page, or null after the last one.
    """
    run = Run.active(db).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if not can_view_run(db, principal, run):
        raise HTTPException(status_code=403, detail="Access denied")

    query = db.query(Span).filter(Span.run_id == run_id)
    if trace_id:
        query = query.filter(Span.trace_id == trace_id)
    # One extra row tells whether another page follows.
    spans = (
        query.order_by(Span.start_time_ns.asc().nullslast(), Span.id.asc())
        .offset(offset)
        .limit(limit + 1)
        .all()
    )
    has_more = len(spans) > limit
    spans = spans[:limit]
    payload = {
        "spans": [_serialize_span(s) for s in spans],
        "limit": limit,
        "offset": offset,
        "next_offset": offset + limit if has_more else None,
    }
    if not can_view_run_items(db, principal, run):
        redact_item_content(payload["spans"])
    return payload


@router.get("/api/runs/{run_id}/items/{item_id}/spans")
def get_item_spans(
    run_id: str,
    item_id: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    """Return OTEL spans for a specific run item, looked up via trace_id."""
    run = Run.active(db).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if not can_view_run(db, principal, run):
        raise HTTPException(status_code=403, detail="Access denied")

    item = (
        db.query(RunItem)
        .filter(RunItem.run_id == run_id, RunItem.item_id == item_id)
        .first()
    )
    if not item or not item.trace_id:
        return {"spans": []}
    spans = (
        db.query(Span)
        .filter(Span.run_id == run_id, Span.trace_id == item.trace_id)
        .order_by(Span.start_time_ns.asc().nullslast())
        .all()
    )
    payload = {"spans": [_serialize_span(s) for s in spans]}
    if not can_view_run_items(db, principal, run):
        redact_item_content(payload["spans"])
    return payload


@router.get("/api/runs/{run_id}/items/{item_id}/trace")
def get_item_trace(
    run_id: str,
    item_id: str,
    pass_number: Optional[int] = Query(default=None, ge=1),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_ui_principal),
):
    """Return trace metadata + spans for an individual run item."""
    run = Run.active(db).filter(Run.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if not can_view_run(db, principal, run):
        raise HTTPException(status_code=403, detail="Access denied")

    item = (
        db.query(RunItem)
        .filter(RunItem.run_id == run_id, RunItem.item_id == item_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    attempts_query = db.query(RunItemAttempt).filter(
        RunItemAttempt.run_id == run_id, RunItemAttempt.item_id == item_id
    )
    if pass_number is not None:
        attempts_query = attempts_query.filter(
            RunItemAttempt.pass_number == pass_number
        )
    attempts_rows = attempts_query.order_by(
        RunItemAttempt.attempt_number.asc(), RunItemAttempt.id.asc()
    ).all()

    attempt_dicts: List[Dict[str, Any]] = []
    if attempts_rows:
        trace_ids = [row.trace_id for row in attempts_rows if row.trace_id]
        spans_by_trace: Dict[str, List[Span]] = {}
        if trace_ids:
            span_rows = (
                db.query(Span)
                .filter(Span.run_id == run_id, Span.trace_id.in_(trace_ids))
                .order_by(Span.start_time_ns.asc().nullslast(), Span.id.asc())
                .all()
            )
            for span in span_rows:
                spans_by_trace.setdefault(span.trace_id, []).append(span)
        for row in attempts_rows:
            attempt_dicts.append(
                _serialize_attempt_trace_payload(
                    {
                        "pass_number": row.pass_number,
                        "attempt_number": row.attempt_number,
                        "status": str(row.status or "").lower() or "failed",
                        "latency_ms": row.latency_ms,
                        "task_started_at_ms": row.task_started_at_ms,
                        "trace_id": row.trace_id,
                        "trace_url": row.trace_url,
                        "error": row.error,
                        "is_last_attempt": row.is_last_attempt,
                    },
                    spans_by_trace.get(row.trace_id or "", []),
                )
            )
    elif pass_number is not None:
        event_state = _repeat_pass_event_state(
            db, run_id, item_ids=[item_id], include_outputs=False
        )
        event_attempt = event_state["outcomes"].get(
            (item_id, pass_number)
        ) or event_state["active_attempts"].get((item_id, pass_number))
        if event_attempt and event_attempt.get("trace_id"):
            trace_id = str(event_attempt["trace_id"])
            spans = (
                db.query(Span)
                .filter(Span.run_id == run_id, Span.trace_id == trace_id)
                .order_by(Span.start_time_ns.asc().nullslast(), Span.id.asc())
                .all()
            )
            attempt_dicts.append(
                _serialize_attempt_trace_payload(
                    {
                        **event_attempt,
                        "pass_number": pass_number,
                        "attempt_number": int(event_attempt.get("retry_count") or 0)
                        + 1,
                        "is_last_attempt": event_attempt.get("status") != "running",
                    },
                    spans,
                )
            )
    elif item.trace_id:
        spans = (
            db.query(Span)
            .filter(Span.run_id == run_id, Span.trace_id == item.trace_id)
            .order_by(Span.start_time_ns.asc().nullslast(), Span.id.asc())
            .all()
        )
        attempt_dicts.append(
            _serialize_attempt_trace_payload(
                {
                    "pass_number": 1,
                    "attempt_number": 1,
                    "status": "failed" if item.error else "completed",
                    "latency_ms": item.latency_ms,
                    "task_started_at_ms": item.item_metadata.get("task_started_at_ms")
                    if isinstance(item.item_metadata, dict)
                    else None,
                    "trace_id": item.trace_id,
                    "trace_url": item.trace_url,
                    "error": item.error,
                    "is_last_attempt": True,
                },
                spans,
            )
        )

    pass_retry_count = None
    if pass_number is not None:
        pass_retry_count = (
            max((int(row.attempt_number or 1) for row in attempts_rows), default=1) - 1
        )
        if not attempts_rows and attempt_dicts:
            pass_retry_count = max(
                0, int(attempt_dicts[-1].get("attempt_number") or 1) - 1
            )
    payload = _build_item_trace_payload(
        item,
        attempt_dicts,
        retry_count_override=pass_retry_count,
        fallback_to_item_trace=pass_number is None,
    )
    if not can_view_run_items(db, principal, run):
        redact_item_content(payload)
    return payload
