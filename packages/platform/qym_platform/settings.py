from __future__ import annotations

from urllib.parse import urlsplit

from pydantic import Field, field_validator
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
    # Anyone who can reach /login may create a MEMBER account. Off by default:
    # admins add people in Admin > Users. While no active admin exists, sign-up
    # stays open so the first person can create an account and claim admin.
    auth_local_signup: bool = Field(default=False)
    # Failed password sign-ins allowed within the window before further
    # attempts get 429 (login_throttle.py): per email from one client address
    # (only that client is refused), and per client address over all emails.
    auth_login_max_failures_per_email: int = Field(default=5, ge=1)
    auth_login_max_failures_per_client: int = Field(default=30, ge=1)
    auth_login_failure_window_seconds: int = Field(default=300, ge=1)
    # Ceiling per email over every client together: past it, password sign-in
    # for that email pauses from everywhere until failures age out.
    auth_login_email_ceiling: int = Field(default=50, ge=1)
    auth_login_email_ceiling_window_seconds: int = Field(default=900, ge=1)
    auth_google_client_id: str = Field(default="")
    auth_google_client_secret: str = Field(default="")
    auth_github_client_id: str = Field(default="")
    auth_github_client_secret: str = Field(default="")
    # Self-hosted GitLab (OIDC). The URL is the instance issuer, e.g.
    # https://gitlab.example.com; discovery reads /.well-known/openid-configuration.
    auth_gitlab_url: str = Field(default="")
    auth_gitlab_client_id: str = Field(default="")
    auth_gitlab_client_secret: str = Field(default="")

    @field_validator("auth_gitlab_url")
    @classmethod
    def _validate_gitlab_url(cls, value: str) -> str:
        # Fail at startup instead of serving a GitLab button whose discovery 500s.
        value = (value or "").strip()
        if not value:
            return ""
        try:
            parts = urlsplit(value)
            parts.port  # raises ValueError for a malformed port
        except ValueError as exc:
            raise ValueError(f"QYM_AUTH_GITLAB_URL is not a valid URL: {exc}") from exc
        if parts.scheme not in {"http", "https"} or not parts.hostname:
            raise ValueError("QYM_AUTH_GITLAB_URL must be an http(s) URL with a host, e.g. https://gitlab.example.com")
        if "?" in value or "#" in value or any(char.isspace() for char in value):
            raise ValueError("QYM_AUTH_GITLAB_URL must not contain a query, fragment, or whitespace")
        if "/.well-known/" in parts.path + "/":
            raise ValueError("QYM_AUTH_GITLAB_URL is the GitLab base URL, not its /.well-known/ discovery URL")
        return value

    # Database (required - no SQLite fallback)
    database_url: str = Field(description="PostgreSQL connection string (required)")
    # Connection pool (PostgreSQL only). API: request handlers; worker: background loops.
    db_pool_size: int = Field(default=10, ge=1)
    db_max_overflow: int = Field(default=10, ge=0)
    db_worker_pool_size: int = Field(default=3, ge=1)
    db_worker_max_overflow: int = Field(default=2, ge=0)
    db_pool_timeout_seconds: int = Field(default=10, ge=1)
    # Threads AnyIO may use for sync request handlers. Each one may hold an
    # API pool connection, so 0 (default) caps it at db_pool_size +
    # db_max_overflow: excess requests then queue for a thread instead of
    # timing out on the pool (AnyIO's own default is 40 threads).
    http_threadpool_size: int = Field(default=0, ge=0)
    db_pool_recycle_seconds: int = Field(default=1800, ge=60)
    # Server-side guards (ms). A runaway statement or lock wait fails fast
    # instead of holding a pooled connection for minutes.
    db_statement_timeout_ms: int = Field(default=30_000, ge=1000)
    db_worker_statement_timeout_ms: int = Field(default=300_000, ge=1000)
    db_lock_timeout_ms: int = Field(default=5_000, ge=100)
    db_idle_in_transaction_timeout_ms: int = Field(default=60_000, ge=1000)

    # Secrets
    llm_config_encryption_key: str = Field(default="")
    # Rotation: comma-separated Fernet keys that were current before. Values
    # encrypted with them still decrypt (MultiFernet); new values always use
    # ``llm_config_encryption_key``. Drop once ``tools.reencrypt_llm_keys`` ran.
    llm_config_encryption_keys_previous: str = Field(default="")
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

    # Service split (docs/internal/OPERATIONS.md, "Service split deployment").
    # ``QYM_SERVICE`` picks which of the three services this process is:
    # "all" (single server, the default), "main" (UI + regular API),
    # "ingestion" (SDK write path) or "workers" (background loops + job
    # execution). Unset, the legacy ``QYM_ROLE`` decides (api -> main without
    # the job queue, worker -> workers, all -> all); set, it wins over QYM_ROLE.
    service: str = Field(default="", pattern="^(|all|main|ingestion|workers)$")
    # URL prefix each service serves under (joined after ``root_path``).
    main_prefix: str = Field(default="")
    ingestion_prefix: str = Field(default="/ingestion")
    workers_prefix: str = Field(default="/workers")
    # Main keeps the ingest routes so SDKs pointed at it keep working without
    # the ingress rules that send them to the ingestion service.
    main_include_ingest: bool = Field(default=True)
    # Ingestion also serves the legacy paths (/v1/runs, /v1/runs/{id}/events,
    # /v1/runs:upload), so an ingress can route them there transparently.
    ingestion_legacy_paths: bool = Field(default=True)
    # Browser-facing UI URL for links built outside main (live_url, run and
    # compare links). Empty: ``base_url``.
    public_ui_url: str = Field(default="")
    # URL the workers' product-eval runner calls the platform at (ingress or
    # main: the ingress sends ingest paths to ingestion). Empty: ``base_url``.
    internal_platform_url: str = Field(default="")
    # Queued jobs (split mode) no worker claimed within this many seconds are
    # reported failed, so a page never waits forever without a workers service.
    job_queue_timeout_seconds: int = Field(default=1800, ge=30)
    # Workers: how often to look for queued jobs, and the liveness heartbeat.
    job_poll_interval_seconds: float = Field(default=1.0, gt=0, le=60)
    service_heartbeat_seconds: float = Field(default=10.0, ge=1, le=300)

    # Observability
    request_timing: bool = Field(
        default=False,
        description="Emit Server-Timing headers and per-request timing logs",
    )
    request_timing_slow_ms: float = Field(default=1000.0, ge=0)
    # Largest file a multipart upload may carry (datasets, run results). Bigger
    # bodies are refused before parsing, so they are never spooled to /tmp.
    max_upload_bytes: int = Field(default=100 * 1024 * 1024, ge=1)

    # Maintenance window: ingest answers 503 + Retry-After (SDKs buffer and
    # retry), the UI stays readable, admin endpoints keep working.
    maintenance_mode: bool = Field(default=False)
    # Retention (days). 0 disables. Derived tables are never pruned.
    span_retention_days: int = Field(default=60, ge=0)
    deleted_run_grace_days: int = Field(default=30, ge=0)
    # Daily ``spans`` partitions are kept created this many days ahead.
    span_partition_days_ahead: int = Field(default=14, ge=1, le=366)

    # Ingest storage policy
    # Spans are stored in full. The ceiling only guards against a runaway
    # payload (a single span above it keeps its scalar attributes and is
    # marked ``qym.span_oversized``) so one bad client cannot wedge ingest.
    span_max_bytes: int = Field(default=1_048_576, ge=65_536)
    # Largest POST /v1/runs/{id}/events body (HTTP 413 above it); a single
    # event line may use half of it. SDKs send batches of about 2 MB.
    max_ingest_body_bytes: int = Field(default=20 * 1024 * 1024, ge=131_072)
    # "full" keeps every event payload verbatim in run_events (legacy);
    # "structural" drops item/metric bodies that already live in run_items,
    # run_item_attempts and run_item_scores, keeping ids, numbers and status.
    event_log_mode: str = Field(default="full", pattern="^(full|structural)$")

    # Run lifecycle. A RUNNING run with no event for this long is shown STOPPED
    # (lease_timeout) until its next event. The SDK heartbeats every 15s, but a
    # heartbeat can wait behind a slow upload, so keep a wide margin.
    run_stale_timeout_seconds: int = Field(default=180, ge=5)
    analysis_job_max_workers: int = Field(default=2, ge=1)
    analysis_max_concurrency: int = Field(default=20, ge=1, le=20)
    analysis_max_retries: int = Field(default=1, ge=0, le=5)

    # Evaluation Service experiments: launches per user per window (0 disables).
    # Dry-run previews are not counted.
    eval_experiment_create_rate_limit: int = Field(default=30, ge=0)
    eval_experiment_create_rate_window_seconds: int = Field(default=3600, ge=1)
    # Jobs one experiment launch may create (combinations × environments).
    eval_sweep_max_jobs: int = Field(default=64, ge=1)
    # A RUNNING Evaluation Service job with no remote status change and no linked-run
    # activity for this long becomes TIMED_OUT (best-effort remote cancel first). Keep
    # it above the service's own hard limit (Celery time_limit, 7200s by default).
    eval_job_timeout_seconds: int = Field(default=8100, ge=600)

    # Product eval API
    product_eval_max_workers: int = Field(default=3, ge=1)
    product_eval_max_concurrency: int = Field(default=10, ge=1, le=20)
    product_eval_timeout: int = Field(default=900, ge=1, le=900)
    product_eval_max_retries: int = Field(default=1, ge=0, le=2)
    product_eval_max_parallel_runs: int = Field(default=1, ge=1, le=3)
    product_eval_metric_timeout: int = Field(default=300, ge=1)
    product_eval_run_count: int = Field(default=3, ge=1, le=100)
    product_eval_default_dataset: str = Field(default="playground_set_v2")

    @property
    def public_ui_base(self) -> str:
        """Base of browser links (``QYM_PUBLIC_UI_URL``, else ``QYM_BASE_URL``)."""
        return (self.public_ui_url or self.base_url).rstrip("/")

    @property
    def internal_platform_base(self) -> str:
        """Where in-process SDK clients reach the platform (workers' product evals)."""
        return (self.internal_platform_url or self.base_url).rstrip("/")


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
    # Split mode (QYM_SERVICE=main): unfinished product evals (queued or
    # running) allowed in the shared queue before submit answers 429.
    # 0 uses ``max_workers`` (one workers replica's capacity).
    max_queued: int = Field(default=0, ge=0)
    # Finished jobs kept in this process's memory (older ones are served from
    # the shared ``background_jobs`` registry).
    max_retained_jobs: int = Field(default=100, ge=1)
