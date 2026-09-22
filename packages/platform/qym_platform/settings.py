from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class PlatformSettings(BaseSettings):
    """Runtime configuration for the deployed qym platform."""

    model_config = SettingsConfigDict(
        env_prefix="QYM_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Core
    environment: str = Field(default="dev")
    base_url: str = Field(default="http://localhost:8000")
    root_path: str = Field(
        default="",
        description="URL prefix when served behind a reverse proxy (e.g. /qym)",
    )

    # Auth
    auth_mode: str = Field(default="none")  # none|proxy_headers|oidc|saml (SSO later)
    admin_bootstrap_token: str = Field(default="")
    auto_provision_users: bool = Field(default=True)
    allow_legacy_empty_api_key_scopes: bool = Field(default=True)
    auth_session_secret: str = Field(default="")
    auth_local_enabled: bool = Field(default=False)
    auth_google_client_id: str = Field(default="")
    auth_google_client_secret: str = Field(default="")
    auth_github_client_id: str = Field(default="")
    auth_github_client_secret: str = Field(default="")

    # Database (required - no SQLite fallback)
    database_url: str = Field(description="PostgreSQL connection string (required)")
    # Connection pool (PostgreSQL only). API: request handlers; worker: background loops.
    db_pool_size: int = Field(default=10, ge=1)
    db_max_overflow: int = Field(default=10, ge=0)
    db_worker_pool_size: int = Field(default=3, ge=1)
    db_worker_max_overflow: int = Field(default=2, ge=0)
    db_pool_timeout_seconds: int = Field(default=10, ge=1)
    db_pool_recycle_seconds: int = Field(default=1800, ge=60)
    # Server-side guards (ms). A runaway statement or lock wait fails fast
    # instead of holding a pooled connection for minutes.
    db_statement_timeout_ms: int = Field(default=30_000, ge=1000)
    db_worker_statement_timeout_ms: int = Field(default=300_000, ge=1000)
    db_lock_timeout_ms: int = Field(default=5_000, ge=100)
    db_idle_in_transaction_timeout_ms: int = Field(default=60_000, ge=1000)

    # Secrets
    llm_config_encryption_key: str = Field(default="")
    allow_private_llm_base_urls: bool = Field(
        default=False,
        description=(
            "Allow LLM provider URLs that resolve to loopback, private, link-local, "
            "or otherwise non-public addresses. Keep disabled in shared deployments."
        ),
    )

    # Visibility
    hidden_tasks: str = Field(
        default="", description="Comma-separated task names to hide from listings"
    )

    # Storage (raw artifacts)
    artifact_store_path: str = Field(default="./artifacts")

    # Process role: "all" runs the API and the background summary worker in one
    # process (single-container default); "api" serves requests only; "worker"
    # runs only the background loop (separate Deployment/pod).
    role: str = Field(default="all", pattern="^(all|api|worker)$")

    # Observability
    request_timing: bool = Field(
        default=False,
        description="Emit Server-Timing headers and per-request timing logs",
    )
    request_timing_slow_ms: float = Field(default=1000.0, ge=0)

    # Maintenance window: ingest answers 503 + Retry-After (SDKs buffer and
    # retry), the UI stays readable, admin endpoints keep working.
    maintenance_mode: bool = Field(default=False)
    # Retention (days). 0 disables. Derived tables are never pruned.
    span_retention_days: int = Field(default=60, ge=0)
    deleted_run_grace_days: int = Field(default=30, ge=0)

    # Ingest storage policy
    # Spans are stored in full. The ceiling only guards against a runaway
    # payload (a single span above it keeps its scalar attributes and is
    # marked ``qym.span_oversized``) so one bad client cannot wedge ingest.
    span_max_bytes: int = Field(default=1_048_576, ge=65_536)
    # "full" keeps every event payload verbatim in run_events (legacy);
    # "structural" drops item/metric bodies that already live in run_items,
    # run_item_attempts and run_item_scores, keeping ids, numbers and status.
    event_log_mode: str = Field(default="full", pattern="^(full|structural)$")

    # Run lifecycle
    run_stale_timeout_seconds: int = Field(default=60, ge=5)
    analysis_job_max_workers: int = Field(default=2, ge=1)
    analysis_max_concurrency: int = Field(default=20, ge=1, le=20)
    analysis_max_retries: int = Field(default=1, ge=0, le=5)

    # Product eval API
    product_eval_max_workers: int = Field(default=3, ge=1)
    product_eval_max_concurrency: int = Field(default=10, ge=1, le=20)
    product_eval_timeout: int = Field(default=900, ge=1, le=900)
    product_eval_max_retries: int = Field(default=1, ge=0, le=2)
    product_eval_max_parallel_runs: int = Field(default=1, ge=1, le=3)
    product_eval_metric_timeout: int = Field(default=300, ge=1)
    product_eval_run_count: int = Field(default=3, ge=1, le=100)
    product_eval_default_dataset: str = Field(default="playground_set_v2")


class ProductEvalSettings(BaseSettings):
    """Product eval settings that are safe to load before DB config exists."""

    model_config = SettingsConfigDict(
        env_prefix="QYM_PRODUCT_EVAL_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    max_workers: int = Field(default=3, ge=1)
    max_concurrency: int = Field(default=10, ge=1, le=20)
    timeout: int = Field(default=900, ge=1, le=900)
    max_retries: int = Field(default=1, ge=0, le=2)
    max_parallel_runs: int = Field(default=1, ge=1, le=3)
    metric_timeout: int = Field(default=300, ge=1)
    run_count: int = Field(default=3, ge=1, le=100)
    default_dataset: str = Field(default="playground_set_v2")
