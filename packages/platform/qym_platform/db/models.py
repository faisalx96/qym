from __future__ import annotations

import enum
from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    event,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, Session, mapped_column, object_session, relationship

from qym_platform.db.base import Base

# PostgreSQL stores large JSON as jsonb (binary, compressible, indexable);
# SQLite keeps the generic JSON type. Big ids use bigint on PostgreSQL.
BIG_JSON = JSON().with_variant(JSONB(), "postgresql")
BIG_ID = Integer().with_variant(BigInteger(), "postgresql")


class UserRole(str, enum.Enum):
    MEMBER = "MEMBER"
    ADMIN = "ADMIN"


class ProjectRole(str, enum.Enum):
    MEMBER = "MEMBER"
    MANAGER = "MANAGER"


class RunWorkflowStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    STOPPED = "STOPPED"
    PENDING = "PENDING"


class DatasetVersionStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class AnalysisRuleVersionStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class ApprovalDecision(str, enum.Enum):
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class EvalPriority(str, enum.Enum):
    """Evaluation Service job priority (``HIGH`` preempts lower jobs remotely)."""

    LOW = "LOW"
    NORMAL = "NORMAL"
    HIGH = "HIGH"


class EvalModelSlotKind(str, enum.Enum):
    ENDPOINT = "endpoint"
    FLAT = "flat"


class EvalModelSlotStatus(str, enum.Enum):
    PROPOSED = "proposed"
    CONFIRMED = "confirmed"
    STALE = "stale"


class EvalExperimentStatus(str, enum.Enum):
    """Aggregate status of an experiment across its jobs."""

    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class EvalJobStatus(str, enum.Enum):
    """Platform-side status of one experiment job (dispatcher state machine)."""

    QUEUED = "QUEUED"
    SUBMITTING = "SUBMITTING"
    SUBMITTED = "SUBMITTED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    BLOCKED = "BLOCKED"
    CANCELLING = "CANCELLING"
    CANCELLED = "CANCELLED"
    TIMED_OUT = "TIMED_OUT"


class RunOrigin(str, enum.Enum):
    """``official`` only when ingest verified a platform launch token."""

    LOCAL = "local"
    OFFICIAL = "official"


class EvalConfigPresetKind(str, enum.Enum):
    """``official``: the environment's manager-published defaults (at most one)."""

    OFFICIAL = "official"
    SAVED = "saved"


def _string_enum(enum_cls: type[enum.Enum], length: int) -> Enum:
    """VARCHAR-backed enum storing member values; no native PostgreSQL type."""
    return Enum(
        enum_cls,
        native_enum=False,
        length=length,
        values_callable=lambda members: [member.value for member in members],
        validate_strings=True,
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(200), default="")
    title: Mapped[str] = mapped_column(String(200), default="")
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.MEMBER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    api_keys: Mapped[list["ApiKey"]] = relationship(back_populates="user")


class UserIdentity(Base):
    __tablename__ = "user_identities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    provider: Mapped[str] = mapped_column(String(50))
    subject: Mapped[str] = mapped_column(String(512))
    email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    raw_claims: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    __table_args__ = (UniqueConstraint("provider", "subject", name="uq_identity_provider_subject"),)


class LocalAuthCredential(Base):
    __tablename__ = "local_auth_credentials"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    password_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # Set when an admin issues a temporary password; the next sign-in must
    # choose a new password before a session is created.
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), nullable=False, unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ProjectAnalysisCategoryCatalogVersion(Base):
    """Immutable project-scoped diagnosis category catalog snapshot."""

    __tablename__ = "project_analysis_category_catalog_versions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    categories: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    category_entries: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, default=list, nullable=False
    )
    category_details_map: Mapped[dict[str, list[str]]] = mapped_column(
        JSON, default=dict, nullable=False
    )
    category_taxonomy: Mapped[dict[str, dict[str, str]]] = mapped_column(
        JSON, default=dict, nullable=False
    )
    subcategory_taxonomy: Mapped[dict[str, dict[str, dict[str, str]]]] = (
        mapped_column(JSON, default=dict, nullable=False)
    )
    max_root_cause_categories: Mapped[int] = mapped_column(
        Integer, default=3, server_default="3", nullable=False
    )
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    source: Mapped[str] = mapped_column(
        String(30), default="manual", server_default="manual", nullable=False
    )
    restored_from_version_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("project_analysis_category_catalog_versions.id"), nullable=True
    )
    parent_version_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("project_analysis_category_catalog_versions.id"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="1", nullable=False
    )
    created_by_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "version",
            name="uq_project_analysis_category_catalog_version",
        ),
        Index(
            "ix_project_analysis_category_catalog_versions_active",
            "project_id",
            "is_active",
        ),
        Index(
            "ix_project_analysis_category_catalog_versions_project_version",
            "project_id",
            "version",
        ),
    )


class ProjectAnalysisRuleVersion(Base):
    """Project-scoped analyzer rules draft or immutable published snapshot."""

    __tablename__ = "project_analysis_rule_versions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[AnalysisRuleVersionStatus] = mapped_column(
        Enum(
            AnalysisRuleVersionStatus,
            values_callable=lambda e: [x.value for x in e],
        ),
        default=AnalysisRuleVersionStatus.DRAFT,
    )
    rules: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    source: Mapped[str] = mapped_column(String(30), default="manual")
    parent_version_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("project_analysis_rule_versions.id"), nullable=True
    )
    base_version_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("project_analysis_rule_versions.id"), nullable=True
    )
    content_hash: Mapped[str] = mapped_column(String(64), default="")
    created_by_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    published_by_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    activated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    activated_by_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    deleted_by_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    restored_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    restored_by_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )

    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "version",
            name="uq_project_analysis_rule_version",
        ),
        Index(
            "ix_project_analysis_rule_versions_status",
            "project_id",
            "status",
        ),
        Index(
            "ix_project_analysis_rule_versions_parent",
            "parent_version_id",
        ),
        Index(
            "ix_project_analysis_rule_versions_base",
            "base_version_id",
        ),
    )


class ProjectAnalysisRuleAlias(Base):
    """Mutable project-scoped pointer to a published analyzer rule version."""

    __tablename__ = "project_analysis_rule_aliases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    alias: Mapped[str] = mapped_column(String(100), nullable=False)
    rule_version_id: Mapped[str] = mapped_column(
        ForeignKey("project_analysis_rule_versions.id"), index=True
    )
    updated_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint(
            "project_id", "alias", name="uq_project_analysis_rule_alias"
        ),
    )


class ProjectAnalysisRuleMergeParent(Base):
    """Additional parent edge recorded when two rule branches are merged."""

    __tablename__ = "project_analysis_rule_merge_parents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version_id: Mapped[str] = mapped_column(
        ForeignKey("project_analysis_rule_versions.id", ondelete="CASCADE"),
        index=True,
    )
    parent_version_id: Mapped[str] = mapped_column(
        ForeignKey("project_analysis_rule_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    merge_base_version_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("project_analysis_rule_versions.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "version_id",
            "parent_version_id",
            name="uq_project_analysis_rule_merge_parent",
        ),
        CheckConstraint(
            "version_id <> parent_version_id",
            name="ck_project_analysis_rule_merge_parent_distinct",
        ),
    )


class ProjectMembership(Base):
    __tablename__ = "project_memberships"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[ProjectRole] = mapped_column(Enum(ProjectRole), default=ProjectRole.MEMBER, index=True)
    added_by_user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_project_membership_project_user"),
        Index("ix_project_memberships_project_role", "project_id", "role"),
    )


class PlatformSetting(Base):
    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    prefix: Mapped[str] = mapped_column(String(16), index=True)
    key_hash: Mapped[bytes] = mapped_column(LargeBinary)
    scopes: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="api_keys")

    __table_args__ = (Index("ix_api_key_prefix_active", "prefix", "revoked_at"),)


class ProjectLlmConnection(Base):
    """A named LLM provider configuration owned by a project.

    Powers the AI-assisted root-cause analysis: a project can have several named
    connections and the analysis request picks which one to use (else the default).
    """

    __tablename__ = "project_llm_connections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    llm_base_url: Mapped[str] = mapped_column(String(500), default="")
    llm_model: Mapped[str] = mapped_column(String(200), default="")
    llm_api_key_encrypted: Mapped[str] = mapped_column(Text, default="")
    llm_api_key_last4: Mapped[str] = mapped_column(String(8), default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    # Lets a project keep analyzer-only connections out of the experiment model picker.
    available_for_experiments: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="1", nullable=False
    )
    created_by_user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_project_llm_connection_name"),
        Index("ix_project_llm_connections_project_default", "project_id", "is_default"),
    )


class ProjectAnalysisPromptSettings(Base):
    """Project-scoped system prompts used by the analysis pipeline."""

    __tablename__ = "project_analysis_prompt_settings"

    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    llm_analyzer_system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    aggregator_system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    rules_writer_system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class EvalEnvironment(Base):
    """A remote Evaluation Service deployment registered in one project.

    ``base_url`` is the normalized service prefix (no trailing ``/``, without
    ``/evals``). An active URL belongs to exactly one project, because the
    deployment ingests runs with that project's qym API key. The service key is
    stored Fernet-encrypted via ``qym_platform.secrets`` and never returned.
    """

    __tablename__ = "eval_environments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(
        Text, default="", server_default="", nullable=False
    )
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)
    api_key_encrypted: Mapped[str] = mapped_column(
        Text, default="", server_default="", nullable=False
    )
    api_key_last4: Mapped[str] = mapped_column(
        String(8), default="", server_default="", nullable=False
    )
    default_priority: Mapped[EvalPriority] = mapped_column(
        _string_enum(EvalPriority, 10),
        default=EvalPriority.NORMAL,
        server_default=EvalPriority.NORMAL.value,
        nullable=False,
    )
    max_priority: Mapped[EvalPriority] = mapped_column(
        _string_enum(EvalPriority, 10),
        default=EvalPriority.NORMAL,
        server_default=EvalPriority.NORMAL.value,
        nullable=False,
    )
    max_inflight_jobs: Mapped[int] = mapped_column(
        Integer, default=5, server_default="5", nullable=False
    )
    # Opt-in to send decrypted ProjectLlmConnection keys to this environment.
    allow_connection_keys: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    current_schema_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey(
            "eval_environment_schemas.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_eval_environments_current_schema",
        ),
        nullable=True,
    )
    # Best-run ranking defaults; NULL falls back to the project default.
    ranking_metric: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    ranking_k: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    health_status: Mapped[str] = mapped_column(
        String(20), default="unknown", server_default="unknown", nullable=False
    )
    health_checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    health_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="1", nullable=False
    )
    created_by_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_eval_environment_project_name"),
        # Platform-wide: an active environment URL can't be registered twice.
        Index(
            "ux_eval_environments_active_base_url",
            "base_url",
            unique=True,
            postgresql_where=text("is_active"),
            sqlite_where=text("is_active"),
        ),
        CheckConstraint(
            "max_inflight_jobs >= 1", name="ck_eval_environments_max_inflight_jobs"
        ),
        CheckConstraint(
            "default_priority IN ('LOW', 'NORMAL', 'HIGH')",
            name="ck_eval_environments_default_priority",
        ),
        CheckConstraint(
            "max_priority IN ('LOW', 'NORMAL', 'HIGH')",
            name="ck_eval_environments_max_priority",
        ),
    )


class EvalEnvironmentSchema(Base):
    """Immutable history of an environment's ``env-overrides`` JSON Schema.

    A refresh that yields a new ``schema_hash`` (sha256 of canonical JSON)
    inserts a row; existing rows are never rewritten apart from ``fetched_at``.
    """

    __tablename__ = "eval_environment_schemas"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    environment_id: Mapped[str] = mapped_column(
        ForeignKey("eval_environments.id", ondelete="CASCADE"), index=True
    )
    schema_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    schema_json: Mapped[dict[str, Any]] = mapped_column(BIG_JSON, nullable=False)
    form_descriptor: Mapped[Optional[dict[str, Any]]] = mapped_column(
        BIG_JSON, nullable=True
    )
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "environment_id", "schema_hash", name="uq_eval_environment_schema_hash"
        ),
    )


class EvalModelSlot(Base):
    """A proposed or confirmed grouping of LLM fields in an environment schema."""

    __tablename__ = "eval_model_slots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    environment_id: Mapped[str] = mapped_column(
        ForeignKey("eval_environments.id", ondelete="CASCADE"), index=True
    )
    schema_id: Mapped[str] = mapped_column(
        ForeignKey("eval_environment_schemas.id", ondelete="CASCADE"), index=True
    )
    slot_key: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[EvalModelSlotKind] = mapped_column(
        _string_enum(EvalModelSlotKind, 10), nullable=False
    )
    label: Mapped[str] = mapped_column(
        String(200), default="", server_default="", nullable=False
    )
    # {"model": "<json-pointer>", "base_url": "<ptr>|null", "api_key": "<ptr>|null"}
    field_map: Mapped[dict[str, Any]] = mapped_column(
        BIG_JSON, default=dict, nullable=False
    )
    # {"timeout": "<ptr>", "max_attempts": "<ptr>", ...} left editable per slot.
    transport_fields: Mapped[dict[str, Any]] = mapped_column(
        BIG_JSON, default=dict, nullable=False
    )
    required: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    status: Mapped[EvalModelSlotStatus] = mapped_column(
        _string_enum(EvalModelSlotStatus, 10),
        default=EvalModelSlotStatus.PROPOSED,
        server_default=EvalModelSlotStatus.PROPOSED.value,
        nullable=False,
    )
    confirmed_by_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint("schema_id", "slot_key", name="uq_eval_model_slot_schema_key"),
        CheckConstraint("kind IN ('endpoint', 'flat')", name="ck_eval_model_slots_kind"),
        CheckConstraint(
            "status IN ('proposed', 'confirmed', 'stale')",
            name="ck_eval_model_slots_status",
        ),
    )


class EvalExperiment(Base):
    """One launch: a sweep of config combinations over one or more environments.

    ``spec`` is the config document with sweeps; secrets appear in it only as
    refs, and ``secrets_encrypted`` holds the Fernet blob ``{ref_id: value}``
    for temporary-model keys until every job is terminal.
    """

    __tablename__ = "eval_experiments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    created_by_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(
        Text, default="", server_default="", nullable=False
    )
    environment_ids: Mapped[list[str]] = mapped_column(
        BIG_JSON, default=list, nullable=False
    )
    # {"kind": "official" | "saved" | "best_run" | "blank" | "clone", ...}
    base_source: Mapped[dict[str, Any]] = mapped_column(
        BIG_JSON, default=dict, nullable=False
    )
    spec: Mapped[dict[str, Any]] = mapped_column(BIG_JSON, default=dict, nullable=False)
    secrets_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    priority: Mapped[EvalPriority] = mapped_column(
        _string_enum(EvalPriority, 10),
        default=EvalPriority.NORMAL,
        server_default=EvalPriority.NORMAL.value,
        nullable=False,
    )
    preemption_acknowledged_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True
    )
    status: Mapped[EvalExperimentStatus] = mapped_column(
        _string_enum(EvalExperimentStatus, 10),
        default=EvalExperimentStatus.QUEUED,
        server_default=EvalExperimentStatus.QUEUED.value,
        nullable=False,
    )
    job_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    cancelled_by_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("ix_eval_experiments_project_created", "project_id", "created_at"),
        CheckConstraint(
            "priority IN ('LOW', 'NORMAL', 'HIGH')", name="ck_eval_experiments_priority"
        ),
        CheckConstraint(
            "status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED')",
            name="ck_eval_experiments_status",
        ),
        CheckConstraint("job_count >= 0", name="ck_eval_experiments_job_count"),
    )


class EvalExperimentJob(Base):
    """One sweep combination submitted to one environment.

    The dispatcher claims rows by ``(status, next_attempt_at)`` under a lease
    (``lease_owner`` / ``lease_until``). ``run_id`` is set once ingest verifies
    the launch token whose sha256 is ``launch_token_hash``.
    """

    __tablename__ = "eval_experiment_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    experiment_id: Mapped[str] = mapped_column(
        ForeignKey("eval_experiments.id", ondelete="CASCADE"), nullable=False
    )
    # Cascades so a project hard-delete succeeds; the API soft-disables an
    # environment that jobs reference instead of deleting it.
    environment_id: Mapped[str] = mapped_column(
        ForeignKey("eval_environments.id", ondelete="CASCADE"), nullable=False
    )
    combo_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # Swept values for this combo (redacted; model slots as connection names).
    params: Mapped[dict[str, Any]] = mapped_column(BIG_JSON, default=dict, nullable=False)
    # Materialized EvalJobCreate body with secret refs, never secret values.
    request_body: Mapped[dict[str, Any]] = mapped_column(
        BIG_JSON, default=dict, nullable=False
    )
    schema_id: Mapped[str] = mapped_column(
        ForeignKey("eval_environment_schemas.id", ondelete="CASCADE"), nullable=False
    )
    launch_token_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    remote_job_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    remote_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    remote_result: Mapped[Optional[dict[str, Any]]] = mapped_column(BIG_JSON, nullable=True)
    remote_versioning: Mapped[Optional[dict[str, Any]]] = mapped_column(
        BIG_JSON, nullable=True
    )
    status: Mapped[EvalJobStatus] = mapped_column(
        _string_enum(EvalJobStatus, 20),
        default=EvalJobStatus.QUEUED,
        server_default=EvalJobStatus.QUEUED.value,
        nullable=False,
    )
    run_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("runs.id", ondelete="SET NULL"), nullable=True
    )
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    submit_attempts: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    next_attempt_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    lease_owner: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    lease_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_polled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # Why a non-terminal job isn't progressing, e.g. "inflight cap 5/5".
    wait_reason: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    cancel_requested_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    cancelled_by_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    cancel_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint(
            "experiment_id",
            "environment_id",
            "combo_index",
            name="uq_eval_experiment_job_combo",
        ),
        Index("ix_eval_experiment_jobs_status_next_attempt", "status", "next_attempt_at"),
        Index("ix_eval_experiment_jobs_environment_status", "environment_id", "status"),
        # A run links to at most one job (the launch token is single-use).
        Index("ix_eval_experiment_jobs_run_id", "run_id", unique=True),
        CheckConstraint("combo_index >= 0", name="ck_eval_experiment_jobs_combo_index"),
        CheckConstraint(
            "submit_attempts >= 0", name="ck_eval_experiment_jobs_submit_attempts"
        ),
        CheckConstraint(
            "status IN ('QUEUED', 'SUBMITTING', 'SUBMITTED', 'RUNNING', 'SUCCEEDED', "
            "'FAILED', 'BLOCKED', 'CANCELLING', 'CANCELLED', 'TIMED_OUT')",
            name="ck_eval_experiment_jobs_status",
        ),
    )


class EvalRemoteQueueSnapshot(Base):
    """Latest redacted view of an environment's remote queue.

    ``items`` keeps only ``{remote_job_id, status, priority, user_id,
    created_at, run_name}`` per PENDING/RUNNING job; ``env_overrides`` and
    ``eval_input`` are never stored.
    """

    __tablename__ = "eval_remote_queue_snapshots"

    environment_id: Mapped[str] = mapped_column(
        ForeignKey("eval_environments.id", ondelete="CASCADE"), primary_key=True
    )
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    fetch_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    items: Mapped[list[dict[str, Any]]] = mapped_column(BIG_JSON, default=list, nullable=False)


class EvalConfigPreset(Base):
    """A named config starting point for one environment.

    Each environment has at most one ``official`` preset (the published
    defaults); members may keep any number of ``saved`` ones. Content lives in
    immutable ``EvalConfigPresetVersion`` rows; ``current_version_id`` points
    at the latest published one.
    """

    __tablename__ = "eval_config_presets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    # Cascades so a project hard-delete succeeds; the API soft-disables an
    # environment that has presets instead of deleting it.
    environment_id: Mapped[str] = mapped_column(
        ForeignKey("eval_environments.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[EvalConfigPresetKind] = mapped_column(
        _string_enum(EvalConfigPresetKind, 10), nullable=False
    )
    current_version_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey(
            "eval_config_preset_versions.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_eval_config_presets_current_version",
        ),
        nullable=True,
    )
    created_by_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        # At most one official preset per environment.
        Index(
            "ux_eval_config_presets_official_env",
            "environment_id",
            unique=True,
            postgresql_where=text("kind = 'official'"),
            sqlite_where=text("kind = 'official'"),
        ),
        CheckConstraint(
            "kind IN ('official', 'saved')", name="ck_eval_config_presets_kind"
        ),
    )


class EvalConfigPresetVersion(Base):
    """Immutable published content of a preset.

    ``config`` is a config document without sweeps (``evaluator``,
    secret-free ``env_overrides``, ``slot_bindings``) authored against
    ``schema_id``. Publishing adds ``version = n + 1``; rows are never updated.
    """

    __tablename__ = "eval_config_preset_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    preset_id: Mapped[str] = mapped_column(
        ForeignKey("eval_config_presets.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    schema_id: Mapped[str] = mapped_column(
        ForeignKey("eval_environment_schemas.id", ondelete="CASCADE"), index=True
    )
    config: Mapped[dict[str, Any]] = mapped_column(BIG_JSON, default=dict, nullable=False)
    notes: Mapped[str] = mapped_column(
        Text, default="", server_default="", nullable=False
    )
    published_by_user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    published_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint("preset_id", "version", name="uq_eval_config_preset_version"),
        CheckConstraint("version >= 1", name="ck_eval_config_preset_versions_version"),
    )


@event.listens_for(EvalConfigPresetVersion, "before_update")
def _refuse_preset_version_update(mapper, connection, target) -> None:
    """Published preset versions are immutable; publish ``version + 1`` instead."""
    raise ValueError(
        "Preset versions are immutable; publish a new version instead"
    )


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    external_run_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)
    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)

    task: Mapped[str] = mapped_column(String(200), index=True)
    dataset: Mapped[str] = mapped_column(String(200), index=True)
    dataset_id: Mapped[Optional[str]] = mapped_column(ForeignKey("datasets.id"), nullable=True, index=True)
    dataset_version_id: Mapped[Optional[str]] = mapped_column(ForeignKey("dataset_versions.id"), nullable=True, index=True)
    model: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)
    metrics: Mapped[list[str]] = mapped_column(JSON, default=list)
    run_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    run_config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    # Repeat runs: how many passes evaluate each item (1 = classic run).
    samples: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    # "official" only when ingest verified an Evaluation Service launch token.
    origin: Mapped[RunOrigin] = mapped_column(
        _string_enum(RunOrigin, 10),
        default=RunOrigin.LOCAL,
        server_default=RunOrigin.LOCAL.value,
        nullable=False,
        index=True,
    )
    experiment_job_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey(
            "eval_experiment_jobs.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_runs_experiment_job_id",
        ),
        nullable=True,
        index=True,
    )

    status: Mapped[RunWorkflowStatus] = mapped_column(Enum(RunWorkflowStatus), default=RunWorkflowStatus.DRAFT, index=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_event_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    status_reason: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, default=None, index=True)
    deleted_by_user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True)

    items: Mapped[list["RunItem"]] = relationship("RunItem", lazy="noload", foreign_keys="RunItem.run_id")
    scores: Mapped[list["RunItemScore"]] = relationship("RunItemScore", lazy="noload", foreign_keys="RunItemScore.run_id")
    approval_rel: Mapped[Optional["Approval"]] = relationship("Approval", uselist=False, lazy="noload", foreign_keys="Approval.run_id")
    owner_user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[owner_user_id], lazy="noload")

    __table_args__ = (
        CheckConstraint("origin IN ('local', 'official')", name="ck_runs_origin"),
    )

    @classmethod
    def active(cls, db: Session):
        return db.query(cls).filter(cls.deleted_at.is_(None))

    def audit_snapshot(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "project_id": self.project_id,
            "task": self.task,
            "dataset": self.dataset,
            "model": self.model,
            "status": self.status.value if self.status else None,
            "owner_user_id": self.owner_user_id,
            "created_by_user_id": self.created_by_user_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "external_run_id": self.external_run_id,
        }


class AnalyzerDocument(Base):
    """A reference document shared by every member of a project."""

    __tablename__ = "analyzer_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    uploaded_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    characters: Mapped[int] = mapped_column(Integer, nullable=False)
    truncated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_analyzer_documents_project_created", "project_id", "created_at"),
    )


class AnalyzerRunDocument(Base):
    """A run's shared selection of documents from its project library."""

    __tablename__ = "analyzer_run_documents"

    run_id: Mapped[str] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True
    )
    document_id: Mapped[str] = mapped_column(
        ForeignKey("analyzer_documents.id", ondelete="CASCADE"), primary_key=True
    )
    selected: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class RunItem(Base):
    __tablename__ = "run_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    dataset_item_pk: Mapped[Optional[int]] = mapped_column(ForeignKey("dataset_items.id"), nullable=True, index=True)
    item_id: Mapped[str] = mapped_column(String(200))
    index: Mapped[int] = mapped_column(Integer, default=0)

    input: Mapped[Any] = mapped_column(BIG_JSON)
    expected: Mapped[Any] = mapped_column(BIG_JSON, nullable=True)
    output: Mapped[Any] = mapped_column(BIG_JSON, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    item_metadata: Mapped[dict[str, Any]] = mapped_column(BIG_JSON, default=dict)

    latency_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    trace_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    trace_url: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)

    @property
    def trace_content(self) -> list[dict[str, Any]]:
        """Return the native OpenTelemetry spans associated with this item."""
        session = object_session(self)
        if session is None or not self.trace_id:
            return []
        spans = (
            session.query(Span)
            .filter(Span.run_id == self.run_id, Span.trace_id == self.trace_id)
            .order_by(Span.start_time_ns.asc(), Span.id.asc())
            .all()
        )
        return [
            {
                "span_id": span.span_id,
                "parent_span_id": span.parent_span_id,
                "name": span.name,
                "kind": span.kind,
                "start_time_ns": span.start_time_ns,
                "end_time_ns": span.end_time_ns,
                "duration_ms": span.duration_ms,
                "status": span.status,
                "attributes": span.attributes or {},
                "events": span.events or [],
                "links": span.links or [],
            }
            for span in spans
        ]

    __table_args__ = (
        UniqueConstraint("run_id", "item_id", name="uq_run_item"),
        Index("ix_run_item_run_index", "run_id", "index"),
        Index("ix_run_item_run_trace", "run_id", "trace_id"),
    )


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, default=None, index=True)

    versions: Mapped[list["DatasetVersion"]] = relationship("DatasetVersion", lazy="noload")
    aliases: Mapped[list["DatasetAlias"]] = relationship("DatasetAlias", lazy="noload")

    __table_args__ = (
        UniqueConstraint("project_id", "slug", name="uq_dataset_project_slug"),
        Index("ix_datasets_project_deleted", "project_id", "deleted_at"),
    )


class DatasetVersion(Base):
    __tablename__ = "dataset_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"), index=True)
    version: Mapped[str] = mapped_column(String(100), nullable=False)
    # Optional human-friendly label shown alongside the immutable vN identifier.
    name: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[DatasetVersionStatus] = mapped_column(
        Enum(DatasetVersionStatus, values_callable=lambda e: [x.value for x in e]),
        default=DatasetVersionStatus.DRAFT,
        index=True,
    )
    source_type: Mapped[str] = mapped_column(String(50), default="api")
    source_uri: Mapped[str] = mapped_column(Text, default="")
    parent_version_id: Mapped[Optional[str]] = mapped_column(ForeignKey("dataset_versions.id"), nullable=True, index=True)
    base_version_id: Mapped[Optional[str]] = mapped_column(ForeignKey("dataset_versions.id"), nullable=True, index=True)
    schema: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    labels: Mapped[list[str]] = mapped_column(JSON, default=list)
    item_count: Mapped[int] = mapped_column(Integer, default=0)
    content_hash: Mapped[str] = mapped_column(String(64), default="")
    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    published_by_user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    items: Mapped[list["DatasetItem"]] = relationship("DatasetItem", lazy="noload")

    __table_args__ = (
        UniqueConstraint("dataset_id", "version", name="uq_dataset_version"),
        Index("ix_dataset_versions_dataset_status", "dataset_id", "status"),
    )


class DatasetAlias(Base):
    __tablename__ = "dataset_aliases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"), index=True)
    alias: Mapped[str] = mapped_column(String(100), nullable=False)
    dataset_version_id: Mapped[str] = mapped_column(ForeignKey("dataset_versions.id"), index=True)
    updated_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("dataset_id", "alias", name="uq_dataset_alias"),)


class DatasetItem(Base):
    __tablename__ = "dataset_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_version_id: Mapped[str] = mapped_column(ForeignKey("dataset_versions.id"), index=True)
    item_id: Mapped[str] = mapped_column(String(200), nullable=False)
    index: Mapped[int] = mapped_column(Integer, default=0)
    input: Mapped[Any] = mapped_column(JSON)
    expected_output: Mapped[Any] = mapped_column(JSON, nullable=True)
    item_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)
    labels: Mapped[list[str]] = mapped_column(JSON, default=list)
    fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("dataset_version_id", "item_id", name="uq_dataset_item_id"),
        Index("ix_dataset_item_version_fingerprint", "dataset_version_id", "fingerprint"),
    )


class DatasetItemRevision(Base):
    __tablename__ = "dataset_item_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_item_id: Mapped[Optional[int]] = mapped_column(ForeignKey("dataset_items.id"), nullable=True, index=True)
    dataset_version_id: Mapped[str] = mapped_column(ForeignKey("dataset_versions.id"), index=True)
    revision_number: Mapped[int] = mapped_column(Integer)
    change_type: Mapped[str] = mapped_column(String(30))
    before: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    after: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    actor_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_dataset_item_revisions_version_item", "dataset_version_id", "dataset_item_id"),
    )


class DatasetVersionChange(Base):
    __tablename__ = "dataset_version_changes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_version_id: Mapped[str] = mapped_column(ForeignKey("dataset_versions.id"), index=True)
    parent_version_id: Mapped[Optional[str]] = mapped_column(ForeignKey("dataset_versions.id"), nullable=True, index=True)
    change_summary: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RunItemAttempt(Base):
    __tablename__ = "run_item_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    item_id: Mapped[str] = mapped_column(String(200), index=True)
    # Repeat runs: which pass this attempt belongs to (1 = classic run).
    pass_number: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    attempt_number: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="FAILED")
    latency_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    task_started_at_ms: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    trace_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    trace_url: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_last_attempt: Mapped[bool] = mapped_column(Boolean, default=False)
    # The pass's output — populated on the final attempt of each pass so the
    # UI can show per-pass outputs without bloating every retry row.
    output: Mapped[Any] = mapped_column(BIG_JSON, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "run_id",
            "item_id",
            "pass_number",
            "attempt_number",
            name="uq_run_item_pass_attempt",
        ),
        Index("ix_run_item_attempt_run_item", "run_id", "item_id"),
    )


class RunItemScore(Base):
    __tablename__ = "run_item_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    item_id: Mapped[str] = mapped_column(String(200), index=True)
    metric_name: Mapped[str] = mapped_column(String(200), index=True)
    score_numeric: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    score_raw: Mapped[Any] = mapped_column(BIG_JSON, nullable=True)
    meta: Mapped[dict[str, Any]] = mapped_column(BIG_JSON, default=dict)
    label: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    explanation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (UniqueConstraint("run_id", "item_id", "metric_name", name="uq_run_item_metric"),)


class RunMetricSpec(Base):
    """Immutable metric semantics captured when a run is created."""

    __tablename__ = "run_metric_specs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    metric_name: Mapped[str] = mapped_column(String(200))
    position: Mapped[int] = mapped_column(Integer, default=0)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    score_type: Mapped[str] = mapped_column(String(30))
    direction: Mapped[str] = mapped_column(String(20), default="maximize")
    pass_threshold: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sample_reducer: Mapped[str] = mapped_column(String(20), default="mean")
    run_reducer: Mapped[str] = mapped_column(String(20), default="mean")
    unit: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    precision: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        UniqueConstraint("run_id", "metric_name", name="uq_run_metric_spec"),
        Index("ix_run_metric_specs_run_position", "run_id", "position"),
    )


class RunItemPassScore(Base):
    """One numeric score per (run, item, metric, pass) for repeat runs.

    ``RunItemScore`` keeps its one-row-per-(run, item, metric) contract and
    holds the REDUCED mean over passes — this narrow table carries the
    per-pass detail (accuracy-vs-k, attempt pooling) without JSON parsing.
    """

    __tablename__ = "run_item_pass_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    item_id: Mapped[str] = mapped_column(String(200))
    metric_name: Mapped[str] = mapped_column(String(200))
    pass_number: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    score_numeric: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    label: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    # Per-pass judge output (explanation, criteria, judge model, …) — the
    # same shape RunItemScore.meta holds for the reduced score.
    meta: Mapped[Optional[dict[str, Any]]] = mapped_column(BIG_JSON, nullable=True)
    explanation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "run_id",
            "item_id",
            "metric_name",
            "pass_number",
            name="uq_run_item_metric_pass",
        ),
        Index("ix_run_item_pass_scores_run_metric", "run_id", "metric_name"),
    )


class RunMetricAnalysis(Base):
    """Cached repeat-analysis curves for one run metric and pass threshold."""

    __tablename__ = "run_metric_analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    metric_name: Mapped[str] = mapped_column(String(200))
    # Integer micros avoid floating-point equality in the cache key.
    threshold_micros: Mapped[int] = mapped_column(Integer)
    method_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    source_signature: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "run_id", "metric_name", "threshold_micros", "method_version",
            name="uq_run_metric_analysis_cache",
        ),
        Index(
            "ix_run_metric_analyses_lookup", "run_id", "metric_name", "threshold_micros"
        ),
    )


class Approval(Base):
    __tablename__ = "approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), unique=True, index=True)
    submitted_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    decision_by_user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True)
    decision_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    decision: Mapped[Optional[ApprovalDecision]] = mapped_column(Enum(ApprovalDecision), nullable=True)
    comment: Mapped[str] = mapped_column(Text, default="")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(200), index=True)
    entity_type: Mapped[str] = mapped_column(String(200), index=True)
    entity_id: Mapped[str] = mapped_column(String(200), index=True)
    before: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    after: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RunEvent(Base):
    """Structural run history. Bodies live in run_items/attempts/scores; spans in ``spans``."""

    __tablename__ = "run_events"

    id: Mapped[int] = mapped_column(BIG_ID, primary_key=True, autoincrement=True)
    # (run_id, event_id) and (run_id, sequence) unique constraints already
    # serve run_id lookups; no separate single-column indexes.
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"))
    event_id: Mapped[str] = mapped_column(String(36))
    sequence: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(50))
    sent_at: Mapped[datetime] = mapped_column(DateTime)
    payload: Mapped[dict[str, Any]] = mapped_column(BIG_JSON, default=dict)

    __table_args__ = (
        UniqueConstraint("run_id", "event_id", name="uq_run_event_event_id"),
        UniqueConstraint("run_id", "sequence", name="uq_run_event_sequence"),
        # Every reader filters by type; on production this index is built by a
        # maintenance job (CONCURRENTLY), see migration 0051.
        Index("ix_run_events_run_type_seq", "run_id", "type", "sequence"),
    )


class Span(Base):
    """One OTEL span. On PostgreSQL the table is RANGE-partitioned by
    ``run_created_at`` (monthly) so raw-trace retention is a partition drop;
    ``create_all`` (tests) builds a plain table with the same columns.
    """

    __tablename__ = "spans"

    id: Mapped[int] = mapped_column(BIG_ID, primary_key=True, autoincrement=True)
    # Partition key, denormalized from runs.created_at at ingest. On PostgreSQL
    # the physical primary key is (id, run_created_at) — migration 0053 — but the
    # ORM identity stays ``id`` (globally unique via one identity sequence), which
    # also keeps SQLite's single-column autoincrement happy.
    run_created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    # uq_span (run_id, span_id) and ix_span_run_trace already lead with run_id.
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"))
    trace_id: Mapped[str] = mapped_column(String(64))
    span_id: Mapped[str] = mapped_column(String(32))
    parent_span_id: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    name: Mapped[str] = mapped_column(String(500))
    kind: Mapped[str] = mapped_column(String(20), default="INTERNAL")
    start_time_ns: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    end_time_ns: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    duration_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="UNSET")
    attributes: Mapped[dict[str, Any]] = mapped_column(BIG_JSON, default=dict)
    events: Mapped[list] = mapped_column(BIG_JSON, default=list)
    links: Mapped[list] = mapped_column(BIG_JSON, default=list)
    # Promoted from attributes at ingest so statistics/step-latency never load JSON.
    oi_kind: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    usage_scope: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    model_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    tool_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    token_total: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    token_prompt: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    token_completion: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        Index("ix_span_run_trace", "run_id", "trace_id"),
        UniqueConstraint("run_id", "span_id", "run_created_at", name="uq_span"),
    )


class RunTraceAggregate(Base):
    __tablename__ = "run_trace_aggregates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    trace_id: Mapped[str] = mapped_column(String(64))
    span_count: Mapped[int] = mapped_column(Integer, default=0)
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost: Mapped[float] = mapped_column(Float, default=0.0)
    llm_calls: Mapped[int] = mapped_column(Integer, default=0)
    tool_calls: Mapped[int] = mapped_column(Integer, default=0)
    tool_errors: Mapped[int] = mapped_column(Integer, default=0)
    malformed_tool_calls: Mapped[int] = mapped_column(Integer, default=0)
    noisy_reasoning: Mapped[int] = mapped_column(Integer, default=0)
    provider_errors: Mapped[int] = mapped_column(Integer, default=0)
    has_reasoning: Mapped[bool] = mapped_column(Boolean, default=False)
    has_reasoning_tokens: Mapped[bool] = mapped_column(Boolean, default=False)
    reasoning_tokens: Mapped[int] = mapped_column(Integer, default=0)
    # Full span-derived bucket (incl. latency totals/counts) so live trace
    # stats can be rebuilt without reloading every span of the run.
    # Plain JSON on purpose: named outer-scope buckets rely on insertion order,
    # which jsonb does not preserve.
    raw_bucket: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    __table_args__ = (
        Index("ix_run_trace_aggregate_run_trace", "run_id", "trace_id"),
        UniqueConstraint("run_id", "trace_id", name="uq_run_trace_aggregate"),
    )


class CorrectionStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    SUPERSEDED = "superseded"
    WITHDRAWN = "withdrawn"


class RootCauseRevision(Base):
    __tablename__ = "root_cause_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    item_id: Mapped[str] = mapped_column(String(200), index=True)
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    actor_user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    actor_source: Mapped[str] = mapped_column(String(20), nullable=False, default="human")
    before_state: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    after_state: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    backfilled_from_legacy: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("run_id", "item_id", "revision_number", name="uq_root_cause_revision_number"),
        Index("ix_root_cause_revisions_run_item_created", "run_id", "item_id", "created_at"),
    )


class ReviewCorrection(Base):
    __tablename__ = "review_corrections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    item_id: Mapped[str] = mapped_column(String(200), index=True)
    metric_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)
    # NULL identifies the aggregate/classic review; positive values identify a repeat pass.
    pass_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Preserve deleted-pass evidence without associating it with a renumbered pass.
    pass_deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    task: Mapped[str] = mapped_column(String(200), index=True)

    input_snapshot: Mapped[Any] = mapped_column(JSON, nullable=True)
    expected_snapshot: Mapped[Any] = mapped_column(JSON, nullable=True)
    output_snapshot: Mapped[Any] = mapped_column(JSON, nullable=True)
    scores_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    ai_root_cause: Mapped[str] = mapped_column(String(200))
    # Plural category storage. The singular columns remain as the primary
    # category for compatibility with existing queries and clients.
    ai_root_causes: Mapped[Optional[list[str]]] = mapped_column(JSON, nullable=True)
    ai_root_cause_issues: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON, nullable=True
    )
    ai_category_taxonomy: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    ai_root_cause_detail: Mapped[str] = mapped_column(Text, default="")
    ai_root_cause_note: Mapped[str] = mapped_column(Text, default="")
    ai_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ai_solution: Mapped[str] = mapped_column(String(200), default="")
    ai_solution_note: Mapped[str] = mapped_column(Text, default="")

    human_root_cause: Mapped[str] = mapped_column(String(200))
    human_root_causes: Mapped[Optional[list[str]]] = mapped_column(JSON, nullable=True)
    human_root_cause_issues: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(
        JSON, nullable=True
    )
    human_category_taxonomy: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    human_root_cause_detail: Mapped[str] = mapped_column(Text, default="")
    human_root_cause_note: Mapped[str] = mapped_column(Text, default="")
    human_solution: Mapped[str] = mapped_column(String(200), default="")
    human_solution_note: Mapped[str] = mapped_column(Text, default="")

    corrected_by_user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    revision_id: Mapped[Optional[int]] = mapped_column(ForeignKey("root_cause_revisions.id"), nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    status: Mapped[CorrectionStatus] = mapped_column(
        Enum(CorrectionStatus, values_callable=lambda e: [x.value for x in e]),
        default=CorrectionStatus.PENDING,
        index=True,
    )
    reviewed_by_user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    review_comment: Mapped[str] = mapped_column(Text, default="")

    __table_args__ = (
        Index("ix_review_corrections_pass_scope", "run_id", "item_id", "metric_name", "pass_number", "is_active"),
        Index("ix_review_corrections_task_created", "task", "created_at"),
        Index("ix_review_corrections_run_item_active", "run_id", "item_id", "is_active"),
        Index(
            "ix_review_corrections_run_item_metric_active",
            "run_id",
            "item_id",
            "metric_name",
            "is_active",
        ),
    )


class RunTraceSummary(Base):
    """Private numeric accumulator for incremental live trace statistics."""

    __tablename__ = "run_trace_summaries"
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True)
    totals: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class RunTraceContribution(Base):
    """Last applied item contribution, independent of mutable item metadata."""

    __tablename__ = "run_trace_contributions"
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True)
    item_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    item_order: Mapped[int] = mapped_column(BigInteger)
    trace_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    included: Mapped[bool] = mapped_column(Boolean, default=False)
    bucket: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    __table_args__ = (Index("ix_trace_contribution_run_trace", "run_id", "trace_id"),)


class RunTraceNamedContribution(Base):
    """Indexed first-contributor order for named outer-scope trace latencies."""

    __tablename__ = "run_trace_named_contributions"
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True)
    item_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    name: Mapped[str] = mapped_column(String(500), primary_key=True)
    item_order: Mapped[int] = mapped_column(BigInteger)
    name_position: Mapped[int] = mapped_column(Integer)
    __table_args__ = (Index("ix_trace_named_first", "run_id", "name", "item_order", "name_position"),)

# Import projection mappings so Base.metadata includes their durable tables.
from qym_platform.db.maintenance_models import MaintenanceJob  # noqa: E402,F401
from qym_platform.db.dashboard_models import (  # noqa: E402,F401
    DashboardChangeEvent, DashboardEventCause, DashboardRecordState,
    DashboardRecordCause, DashboardRunDimension, DashboardRunSummary,
    DashboardBucketRollup, DashboardHistogram, DashboardPartitionState,
    DashboardDeadLetter,
)
from qym_platform.services.dashboard_outbox import install_dashboard_outbox_hooks
install_dashboard_outbox_hooks()
