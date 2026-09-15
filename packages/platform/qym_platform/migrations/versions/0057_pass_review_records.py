"""Recover pass approvals as review records and publish their approved categories.

Revision ID: 0057
Revises: 0056
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from uuid import NAMESPACE_URL, uuid4, uuid5

from alembic import op
import sqlalchemy as sa

revision = "0057"
down_revision = "0056"
branch_labels = None
depends_on = None


# Keep JSON transformation separate from the schema operation so recovery can
# be exercised twice in migration tests without adding a column twice.
def _backfill(bind: sa.Connection) -> None:
    from qym_platform.services.approved_categories import (
        CATALOG_FIELDS,
        approved_catalog_values,
        category_catalog_hash,
    )
    from qym_platform.services.root_cause_categories import (
        analysis_root_cause_issues,
        normalize_category_taxonomy,
        project_root_cause_issues,
    )

    metadata = sa.MetaData()

    def table(name):
        return sa.Table(name, metadata, autoload_with=bind)

    reviews = table("review_corrections")
    runs = table("runs")
    items = table("run_items")
    scores = table("run_item_pass_scores")
    attempts = table("run_item_attempts")
    catalogs = table("project_analysis_category_catalog_versions")
    users = set(bind.execute(sa.select(table("users").c.id)).scalars())
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # Earlier pass deletion already retained pass-score rows when only one
    # sample remained, but did not mark the run as having pass-scoped data.
    # Classic single-sample ingestion never creates these rows. Recover their
    # scope before recovering approvals, including runs with no approvals yet.
    cursor = None
    while True:
        retained = sa.select(runs.c.id, runs.c.run_metadata).where(
            sa.func.coalesce(runs.c.samples, 1) <= 1,
            sa.exists(
                sa.select(scores.c.id).where(
                    scores.c.run_id == runs.c.id, scores.c.pass_number == 1
                )
            ),
        )
        if cursor is not None:
            retained = retained.where(runs.c.id > cursor)
        rows = bind.execute(retained.order_by(runs.c.id).limit(200)).mappings().all()
        if not rows:
            break
        for row in rows:
            cursor = row["id"]
            metadata = (
                deepcopy(row["run_metadata"])
                if isinstance(row["run_metadata"], dict)
                else {}
            )
            if metadata.get("has_repeat_pass_context") is True:
                continue
            metadata["has_repeat_pass_context"] = True
            prior_revision = metadata.get("pass_revision")
            metadata["pass_revision"] = (
                max(1, prior_revision) if type(prior_revision) is int else 1
            )
            bind.execute(
                runs.update()
                .where(runs.c.id == row["id"])
                .values(run_metadata=metadata)
            )

    def timestamp(value):
        if not value:
            return None
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt
        except (TypeError, ValueError):
            return None

    last_id = 0
    while True:
        batch = (
            bind.execute(
                sa.select(scores)
                .where(
                    scores.c.id > last_id,
                    sa.cast(scores.c.meta, sa.Text).like('%"approved"%'),
                )
                .order_by(scores.c.id)
                .limit(200)
            )
            .mappings()
            .all()
        )
        if not batch:
            break
        for score in batch:
            last_id = score["id"]
            meta = deepcopy(score["meta"] or {})
            analysis = meta.get("root_cause_analysis")
            if not isinstance(analysis, dict):
                continue
            issues = analysis_root_cause_issues(analysis)
            if not any(
                issue.get("review_status", analysis.get("review_status")) == "approved"
                for issue in issues
            ):
                continue
            run = (
                bind.execute(sa.select(runs).where(runs.c.id == score["run_id"]))
                .mappings()
                .one()
            )
            if (run["samples"] or 1) <= 1 and not (
                isinstance(run["run_metadata"], dict)
                and run["run_metadata"].get("has_repeat_pass_context")
            ):
                continue
            scope = (
                reviews.c.run_id == score["run_id"],
                reviews.c.item_id == score["item_id"],
                reviews.c.metric_name == score["metric_name"],
                reviews.c.pass_number == score["pass_number"],
            )
            if bind.execute(sa.select(reviews.c.id).where(*scope).limit(1)).first():
                continue
            item = (
                bind.execute(
                    sa.select(items).where(
                        items.c.run_id == score["run_id"],
                        items.c.item_id == score["item_id"],
                    )
                )
                .mappings()
                .first()
            )
            if item is None:
                continue
            attempt = bind.execute(
                sa.select(attempts.c.output)
                .where(
                    attempts.c.run_id == score["run_id"],
                    attempts.c.item_id == score["item_id"],
                    attempts.c.pass_number == score["pass_number"],
                    attempts.c.is_last_attempt.is_(True),
                )
                .order_by(attempts.c.attempt_number.desc())
                .limit(1)
            ).first()
            pass_scores = (
                bind.execute(
                    sa.select(scores).where(
                        scores.c.run_id == score["run_id"],
                        scores.c.item_id == score["item_id"],
                        scores.c.pass_number == score["pass_number"],
                    )
                )
                .mappings()
                .all()
            )
            snapshots = {
                row["metric_name"]: (
                    row["score_numeric"]
                    if row["score_numeric"] is not None
                    else row["score_raw"]
                )
                for row in pass_scores
            }
            seen_ids = set()
            for index, issue in enumerate(issues):
                issue_id = issue.get("issue_id")
                if not issue_id or issue_id in seen_ids:
                    issue_id = str(
                        uuid5(NAMESPACE_URL, f'qym-pass-review:{score["id"]}:{index}')
                    )
                seen_ids.add(issue_id)
                issue["issue_id"] = issue_id
                status = issue.get(
                    "review_status", analysis.get("review_status", "pending")
                )
                if status not in {"approved", "pending", "rejected"}:
                    status = "pending"
                issue["review_status"] = status
                reviewed_at = timestamp(
                    issue.get("reviewed_at") or analysis.get("reviewed_at")
                )
                reviewer = issue.get("reviewed_by_user_id") or analysis.get(
                    "reviewed_by_user_id"
                )
                reviewer = reviewer if reviewer in users else None
                if status != "pending":
                    if reviewed_at:
                        issue["reviewed_at"] = (
                            reviewed_at.replace(tzinfo=timezone.utc)
                            .isoformat()
                            .replace("+00:00", "Z")
                        )
                    if reviewer:
                        issue["reviewed_by_user_id"] = reviewer
                snapshot = {
                    key: value
                    for key, value in issue.items()
                    if key
                    not in {"review_status", "reviewed_at", "reviewed_by_user_id"}
                }
                if index == 0:
                    for field in ("solution", "solution_note"):
                        if field not in snapshot and analysis.get(field):
                            snapshot[field] = analysis[field]
                            issue[field] = analysis[field]
                projection = project_root_cause_issues([snapshot])
                is_ai = (issue.get("source") or analysis.get("source") or "ai") == "ai"
                values = dict(
                    run_id=run["id"],
                    item_id=item["item_id"],
                    metric_name=score["metric_name"],
                    pass_number=score["pass_number"],
                    task=run["task"],
                    input_snapshot=item["input"],
                    expected_snapshot=item["expected"],
                    output_snapshot=attempt[0] if attempt else None,
                    scores_snapshot=snapshots,
                    status=status,
                    is_active=True,
                    reviewed_at=reviewed_at,
                    reviewed_by_user_id=reviewer,
                    created_at=reviewed_at or now,
                    review_comment="",
                    ai_confidence=issue.get("confidence", analysis.get("confidence")),
                )
                for prefix, include in (
                    ("ai", is_ai),
                    ("human", not is_ai or status == "approved"),
                ):
                    for field in (
                        "root_cause",
                        "root_causes",
                        "root_cause_detail",
                        "root_cause_note",
                    ):
                        values[prefix + "_" + field] = (
                            projection[field]
                            if include
                            else ([] if field == "root_causes" else "")
                        )
                    values[prefix + "_root_cause_issues"] = (
                        [snapshot] if include else []
                    )
                    values[prefix + "_category_taxonomy"] = (
                        normalize_category_taxonomy(analysis.get("category_taxonomy"))
                        if include
                        else {}
                    )
                    values[prefix + "_solution"] = (
                        str(snapshot.get("solution") or "")[:200] if include else ""
                    )
                    values[prefix + "_solution_note"] = (
                        str(snapshot.get("solution_note") or "") if include else ""
                    )
                bind.execute(reviews.insert().values(**values))
            analysis["root_cause_issues"] = issues
            analysis["review_status"] = (
                "approved"
                if all(issue["review_status"] == "approved" for issue in issues)
                else "pending"
            )
            bind.execute(
                scores.update().where(scores.c.id == score["id"]).values(meta=meta)
            )

    # Also repair catalogs for approvals saved before pass reviews existed,
    # including classic-run approvals omitted by the old catalog write path.
    project_ids = (
        bind.execute(
            sa.select(runs.c.project_id)
            .join(
                reviews,
                reviews.c.run_id == runs.c.id,
            )
            .where(
                runs.c.deleted_at.is_(None),
                reviews.c.status == "approved",
                reviews.c.is_active.is_(True),
            )
            .distinct()
        )
        .scalars()
        .all()
    )
    for project_id in project_ids:
        prior = (
            bind.execute(
                sa.select(catalogs)
                .where(
                    catalogs.c.project_id == project_id,
                    catalogs.c.is_active.is_(True),
                )
                .order_by(catalogs.c.version.desc())
            )
            .mappings()
            .first()
        )
        evidence = bind.execute(
            sa.select(reviews)
            .join(runs, runs.c.id == reviews.c.run_id)
            .where(
                runs.c.project_id == project_id,
                runs.c.deleted_at.is_(None),
                reviews.c.status == "approved",
                reviews.c.is_active.is_(True),
            )
            .order_by(reviews.c.created_at, reviews.c.id)
        ).mappings()
        baseline = {field: prior[field] for field in CATALOG_FIELDS} if prior else None
        values = approved_catalog_values(project_id, baseline, evidence)
        if values == (
            baseline
            if baseline is not None
            else approved_catalog_values(project_id, None, [])
        ):
            continue
        latest = (
            bind.execute(
                sa.select(sa.func.max(catalogs.c.version)).where(
                    catalogs.c.project_id == project_id
                )
            ).scalar()
            or 0
        )
        if prior:
            bind.execute(
                catalogs.update()
                .where(catalogs.c.id == prior["id"])
                .values(is_active=False)
            )
        bind.execute(
            catalogs.insert().values(
                id=str(uuid4()),
                project_id=project_id,
                version=latest + 1,
                **values,
                content_hash=category_catalog_hash(**values),
                source="approval_backfill",
                parent_version_id=prior["id"] if prior else None,
                is_active=True,
                created_at=now,
            )
        )


def upgrade() -> None:
    op.add_column(
        "review_corrections", sa.Column("pass_number", sa.Integer(), nullable=True)
    )
    op.add_column(
        "review_corrections", sa.Column("pass_deleted_at", sa.DateTime(), nullable=True)
    )
    op.create_index(
        "ix_review_corrections_pass_scope",
        "review_corrections",
        ["run_id", "item_id", "metric_name", "pass_number", "is_active"],
    )
    _backfill(op.get_bind())


def downgrade() -> None:
    # The original pass metadata retains the approvals on downgrade.
    op.execute("DELETE FROM review_corrections WHERE pass_number IS NOT NULL")
    op.drop_index("ix_review_corrections_pass_scope", table_name="review_corrections")
    op.drop_column("review_corrections", "pass_number")
    op.drop_column("review_corrections", "pass_deleted_at")
