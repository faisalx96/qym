"""Performance: runners, targets and their tokens, runs, questions, log lines, reports, events.

Eight new empty tables (quick DDL, no backfill): ``performance_runners`` (the
runner process of a project and the API key chosen for it),
``performance_targets`` (the systems under test; among the targets that are not
archived a name and an address are unique per project),
``performance_target_tokens`` (saved sign-in tokens, encrypted, with a hint and
a version), ``performance_runs`` (one load test: frozen settings, progress,
headline numbers, summary; at most one active run per runner and one per
target), ``performance_questions`` and ``performance_log_lines`` (what a run
asked and wrote, one row each), ``performance_reports`` (the report file,
compressed) and ``performance_events`` (the runner's timeline). Questions, log
lines and the report go with their run, tokens with their target and events
with their runner (``ON DELETE CASCADE``).

Revision ID: 0108
Revises: 0107
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0108"
down_revision = "0107"
branch_labels = None
depends_on = None

_ACTIVE_RUN = "status IN ('queued','starting','running','stopping')"
_TARGET_LISTED = "archived_at IS NULL"


def _json() -> sa.types.TypeEngine:
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def _big_id() -> sa.types.TypeEngine:
    return sa.Integer().with_variant(sa.BigInteger(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "performance_runners",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False
        ),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("info", _json(), nullable=False),
        sa.Column("instance_id", sa.String(64), nullable=True),
        sa.Column("registered_at", sa.DateTime(), nullable=True),
        sa.Column(
            "registered_key_id",
            sa.String(36),
            sa.ForeignKey("api_keys.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reported_state", sa.String(20), nullable=True),
        sa.Column("current_run_id", sa.String(36), nullable=True),
        sa.Column("last_heartbeat_at", sa.DateTime(), nullable=True),
        sa.Column(
            "runner_key_id",
            sa.String(36),
            sa.ForeignKey("api_keys.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("runner_key_changed_at", sa.DateTime(), nullable=True),
        sa.Column(
            "runner_key_changed_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("project_id", "key", name="uq_performance_runner_key"),
    )

    op.create_table(
        "performance_targets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False, server_default="chat"),
        sa.Column("base_url", sa.String(500), nullable=False),
        sa.Column("chat_path", sa.String(500), nullable=False),
        sa.Column("auth_path", sa.String(500), nullable=False),
        sa.Column(
            "is_production", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("max_users", sa.Integer(), nullable=True),
        sa.Column("max_duration_s", sa.Integer(), nullable=True),
        sa.Column("settings", _json(), nullable=False),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "uq_performance_target_name",
        "performance_targets",
        ["project_id", "name"],
        unique=True,
        postgresql_where=sa.text(_TARGET_LISTED),
        sqlite_where=sa.text(_TARGET_LISTED),
    )
    op.create_index(
        "uq_performance_target_base_url",
        "performance_targets",
        ["project_id", "kind", "base_url"],
        unique=True,
        postgresql_where=sa.text(_TARGET_LISTED),
        sqlite_where=sa.text(_TARGET_LISTED),
    )

    op.create_table(
        "performance_target_tokens",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "target_id",
            sa.String(36),
            sa.ForeignKey("performance_targets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("token_encrypted", sa.Text(), nullable=False),
        sa.Column("token_hint", sa.String(200), nullable=False),
        sa.Column("history_encrypted", sa.Text(), nullable=True),
        sa.Column("generation", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column(
            "updated_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("target_id", "name", name="uq_performance_target_token"),
    )

    op.create_table(
        "performance_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False
        ),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column(
            "runner_id",
            sa.String(36),
            sa.ForeignKey("performance_runners.id"),
            nullable=False,
        ),
        sa.Column(
            "target_id",
            sa.String(36),
            sa.ForeignKey("performance_targets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("target_kind", sa.String(30), nullable=False, server_default="chat"),
        sa.Column("credential_generation", sa.Integer(), nullable=True),
        sa.Column("dataset_id", sa.String(36), nullable=True),
        sa.Column(
            "dataset_version_id",
            sa.String(36),
            sa.ForeignKey("dataset_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("test_type", sa.String(30), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("verdict", sa.String(30), nullable=True),
        sa.Column("config", _json(), nullable=False),
        sa.Column("progress", sa.JSON(), nullable=False),
        sa.Column("progress_seq", sa.Integer(), nullable=False),
        sa.Column(
            "requested_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("requested_at", sa.DateTime(), nullable=False),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("claim_instance_id", sa.String(64), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("last_report_at", sa.DateTime(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(), nullable=True),
        sa.Column("stop_requested_at", sa.DateTime(), nullable=True),
        sa.Column(
            "stop_requested_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("stop_reason", sa.String(500), nullable=True),
        sa.Column("status_reason", sa.String(40), nullable=True),
        sa.Column("token_needed", sa.String(100), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("exit_code", sa.Integer(), nullable=True),
        sa.Column("safe_load_users", sa.Integer(), nullable=True),
        sa.Column("breaking_level_users", sa.Integer(), nullable=True),
        sa.Column("breaking_reason", sa.String(20), nullable=True),
        sa.Column("recommended_max_users", sa.Integer(), nullable=True),
        sa.Column("p95_at_safe_load_ms", sa.Float(), nullable=True),
        sa.Column("answers_measured", sa.Integer(), nullable=True),
        sa.Column("answers_total", sa.Integer(), nullable=True),
        sa.Column("errors_total", sa.Integer(), nullable=True),
        sa.Column("error_rate_pct", sa.Float(), nullable=True),
        sa.Column("p95_ms", sa.Float(), nullable=True),
        sa.Column("ttfb_p95_ms", sa.Float(), nullable=True),
        sa.Column("max_users", sa.Integer(), nullable=True),
        sa.Column("duration_s", sa.Float(), nullable=True),
        sa.Column("quality_mean", sa.Float(), nullable=True),
        sa.Column("discovery", _json(), nullable=True),
        sa.Column("steps_received", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("steps_dropped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("p95_at_break_ms", sa.Float(), nullable=True),
        sa.Column("open_p95_ms", sa.Float(), nullable=True),
        sa.Column("filter_p95_ms", sa.Float(), nullable=True),
        sa.Column("highest_tested_users", sa.Integer(), nullable=True),
        sa.Column("opens_measured", sa.Integer(), nullable=True),
        sa.Column("opens_total", sa.Integer(), nullable=True),
        sa.Column("filters_total", sa.Integer(), nullable=True),
        sa.Column("charts_drawn", sa.Integer(), nullable=True),
        sa.Column("charts_failed", sa.Integer(), nullable=True),
        sa.Column("questions_received", sa.Integer(), nullable=False),
        sa.Column("questions_dropped", sa.Integer(), nullable=False),
        sa.Column("log_lines_received", sa.Integer(), nullable=False),
        sa.Column("log_lines_dropped", sa.Integer(), nullable=False),
        sa.Column("summary", _json(), nullable=True),
        sa.Column("report_received_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("project_id", "number", name="uq_performance_run_number"),
    )
    op.create_index(
        "ix_performance_runs_project_requested",
        "performance_runs",
        ["project_id", "requested_at"],
    )
    op.create_index(
        "ix_performance_runs_target", "performance_runs", ["target_id", "requested_at"]
    )
    op.create_index(
        "uq_performance_runs_active_runner",
        "performance_runs",
        ["runner_id"],
        unique=True,
        postgresql_where=sa.text(_ACTIVE_RUN),
        sqlite_where=sa.text(_ACTIVE_RUN),
    )
    op.create_index(
        "uq_performance_runs_active_target",
        "performance_runs",
        ["target_id"],
        unique=True,
        postgresql_where=sa.text(_ACTIVE_RUN),
        sqlite_where=sa.text(_ACTIVE_RUN),
    )

    op.create_table(
        "performance_questions",
        sa.Column("id", _big_id(), primary_key=True, autoincrement=True),
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("performance_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("asked_at", sa.DateTime(), nullable=False),
        sa.Column("elapsed_s", sa.Float(), nullable=False),
        sa.Column("stage", sa.String(20), nullable=False),
        sa.Column("level", sa.Integer(), nullable=True),
        sa.Column("user_number", sa.Integer(), nullable=False),
        sa.Column("tier", sa.String(50), nullable=False),
        sa.Column("question_id", sa.String(200), nullable=False),
        sa.Column("is_followup", sa.Boolean(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("http_status", sa.Integer(), nullable=False),
        sa.Column("error_kind", sa.String(60), nullable=True),
        sa.Column("duration_ms", sa.Float(), nullable=False),
        sa.Column("ttfb_ms", sa.Float(), nullable=True),
        sa.Column("quality", sa.Float(), nullable=True),
        sa.Column("no_data", sa.Boolean(), nullable=False),
        sa.Column("warmup", sa.Boolean(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("answer_truncated", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("run_id", "seq", name="uq_performance_question"),
    )
    op.create_index(
        "ix_performance_questions_run_status",
        "performance_questions",
        ["run_id", "status"],
    )
    op.create_index(
        "ix_performance_questions_run_level",
        "performance_questions",
        ["run_id", "level"],
    )
    op.create_index(
        "ix_performance_questions_run_tier",
        "performance_questions",
        ["run_id", "tier"],
    )

    op.create_table(
        "performance_dashboard_steps",
        sa.Column("id", _big_id(), primary_key=True, autoincrement=True),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("performance_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("at", sa.DateTime(), nullable=False),
        sa.Column("elapsed_s", sa.Float(), nullable=False),
        sa.Column("stage", sa.String(20), nullable=False),
        sa.Column("level", sa.Integer(), nullable=True),
        sa.Column("user_number", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(10), nullable=False),
        sa.Column("dashboard_id", sa.JSON(), nullable=False),
        sa.Column("dashboard_key", sa.String(1024), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("insight_id", sa.JSON(), nullable=True),
        sa.Column("control", sa.JSON(), nullable=True),
        sa.Column("step", sa.String(30), nullable=True),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("error_class", sa.String(30), nullable=True),
        sa.Column("duration_ms", sa.Float(), nullable=True),
        sa.Column("charts", sa.Integer(), nullable=True),
        sa.Column("charts_ok", sa.Integer(), nullable=True),
        sa.Column("errors", sa.JSON(), nullable=False),
        sa.UniqueConstraint("run_id", "seq", name="uq_performance_dashboard_step"),
    )
    op.create_index("ix_performance_steps_run_type", "performance_dashboard_steps", ["run_id", "type"])
    op.create_index("ix_performance_steps_run_dashboard", "performance_dashboard_steps", ["run_id", "dashboard_key"])
    op.create_index("ix_performance_steps_run_level", "performance_dashboard_steps", ["run_id", "level"])

    op.create_table(
        "performance_log_lines",
        sa.Column("id", _big_id(), primary_key=True, autoincrement=True),
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("performance_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("at", sa.DateTime(), nullable=False),
        sa.Column("level", sa.String(10), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.UniqueConstraint("run_id", "seq", name="uq_performance_log_line"),
    )

    op.create_table(
        "performance_reports",
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("performance_runs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("content_type", sa.String(64), nullable=False),
        sa.Column("html", sa.LargeBinary(), nullable=False),
        sa.Column("html_size", sa.Integer(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("received_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "performance_events",
        sa.Column("id", _big_id(), primary_key=True, autoincrement=True),
        sa.Column(
            "runner_id",
            sa.String(36),
            sa.ForeignKey("performance_runners.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("run_id", sa.String(36), nullable=True),
        sa.Column("at", sa.DateTime(), nullable=False),
        sa.Column("level", sa.String(10), nullable=False),
        sa.Column("code", sa.String(60), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("source", sa.String(10), nullable=False),
    )
    op.create_index(
        "ix_performance_events_runner_at", "performance_events", ["runner_id", "at"]
    )
    op.create_index("ix_performance_events_run", "performance_events", ["run_id", "id"])


def downgrade() -> None:
    op.drop_index("ix_performance_events_run", table_name="performance_events")
    op.drop_index("ix_performance_events_runner_at", table_name="performance_events")
    op.drop_table("performance_events")
    op.drop_table("performance_reports")
    op.drop_table("performance_log_lines")
    op.drop_table("performance_dashboard_steps")
    op.drop_index(
        "ix_performance_questions_run_tier", table_name="performance_questions"
    )
    op.drop_index(
        "ix_performance_questions_run_level", table_name="performance_questions"
    )
    op.drop_index(
        "ix_performance_questions_run_status", table_name="performance_questions"
    )
    op.drop_table("performance_questions")
    op.drop_index("uq_performance_runs_active_target", table_name="performance_runs")
    op.drop_index("uq_performance_runs_active_runner", table_name="performance_runs")
    op.drop_index("ix_performance_runs_target", table_name="performance_runs")
    op.drop_index(
        "ix_performance_runs_project_requested", table_name="performance_runs"
    )
    op.drop_table("performance_runs")
    op.drop_table("performance_target_tokens")
    op.drop_index("uq_performance_target_base_url", table_name="performance_targets")
    op.drop_index("uq_performance_target_name", table_name="performance_targets")
    op.drop_table("performance_targets")
    op.drop_table("performance_runners")
