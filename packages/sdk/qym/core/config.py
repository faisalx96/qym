import json
from datetime import datetime
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..metrics.spec import Metric


#: Bounds on ``versioning_details`` (the platform enforces the same ones).
MAX_VERSIONING_DETAIL_KEYS = 50
MAX_VERSIONING_DETAIL_KEY_LENGTH = 100
MAX_VERSIONING_DETAILS_CHARS = 16_000


def normalize_versioning_details(raw: Any) -> Dict[str, Any]:
    """A validated, JSON-safe copy of a ``versioning_details`` mapping.

    ``None`` is ``{}``. Keys are trimmed, non-blank strings of at most 100
    characters; ``None`` values are dropped; values may be any JSON (other
    objects become strings). At most 50 keys and 16,000 characters of compact
    JSON. Raises ``ValueError`` otherwise.
    """
    if raw is None:
        return {}
    if not isinstance(raw, Mapping):
        raise ValueError("versioning_details must be a mapping of key to value")
    result: Dict[str, Any] = {}
    for key, value in raw.items():
        name = key.strip() if isinstance(key, str) else ""
        if not name or len(name) > MAX_VERSIONING_DETAIL_KEY_LENGTH:
            raise ValueError(
                "versioning_details keys must be non-blank strings of at most "
                f"{MAX_VERSIONING_DETAIL_KEY_LENGTH} characters"
            )
        if value is not None:
            result[name] = value
    if len(result) > MAX_VERSIONING_DETAIL_KEYS:
        raise ValueError(
            f"versioning_details has more than {MAX_VERSIONING_DETAIL_KEYS} keys"
        )
    try:
        text = json.dumps(result, separators=(",", ":"), default=str, allow_nan=False)
    except ValueError:
        raise ValueError("versioning_details must be valid JSON (no NaN)") from None
    if len(text) > MAX_VERSIONING_DETAILS_CHARS:
        raise ValueError(
            "versioning_details is larger than "
            f"{MAX_VERSIONING_DETAILS_CHARS} characters of JSON"
        )
    return json.loads(text)


class EvaluatorConfig(BaseModel):
    """Configuration for a single evaluation run."""
    model_config = ConfigDict(arbitrary_types_allowed=True)

    run_name: Optional[str] = None
    task_name: Optional[str] = None  # #15: Override the auto-derived task name
    max_concurrency: int = Field(default=10, ge=1)
    # Metrics run in their own queue, separate from task execution: a task
    # worker hands its output to the metric queue and immediately picks up the
    # next item. ``metric_concurrency`` is how many items are scored at the
    # same time (``max_metric_concurrency`` still caps the metrics running in
    # parallel for ONE item). Unset: the ``QYM_METRIC_CONCURRENCY`` env var,
    # else ``max_concurrency``.
    metric_concurrency: Optional[int] = Field(default=None, ge=1)
    max_metric_concurrency: int = Field(default=1, ge=1)
    timeout: Optional[float] = Field(default=300, gt=0)
    # Hard wall-clock cap per metric attempt. Timed-out attempts retry according
    # to metric_max_retries; an exhausted timeout is recorded through the normal
    # metric-error path (score 0 + error status). It counts as 0 in the mean of
    # a higher-is-better metric, is left out of a lower-is-better one, and never
    # counts as a pass. Set to None to disable the cap and timeout retries.
    metric_timeout: Optional[float] = Field(default=60.0, gt=0)
    # Retries for a metric call that hits metric_timeout. After the last
    # attempt the timeout is recorded through the ordinary metric-error path
    # (score 0 + error traceback), so the UI shows it like any other error.
    metric_max_retries: int = Field(default=2, ge=0)
    max_retries: int = Field(default=2, ge=0)
    # Repeat runs: evaluate every dataset item `samples` times (k sequential
    # passes over the dataset) inside ONE logical run. Per-pass scores are
    # kept; the run-level number is the mean per pass, and the group metrics
    # (Pass@k, Pass^k, Avg@k, Max@k, Consistency, Reliability) are reported
    # with k = samples. See qym.core.reducers.
    samples: int = Field(default=1, ge=1)
    # Publish pass@k / pass^k at this k, estimated (unbiased) from all
    # `samples` stored passes — run 9, report pass@3. Must be <= samples.
    # None keeps the historical behavior (k = samples).
    report_k: Optional[int] = Field(default=None, ge=1)
    # The run's headline metric. The platform opens Compare, Sweep, Models
    # and the run page on it; without it they use the first metric.
    primary_metric: Optional[str] = None
    run_metadata: Dict[str, Any] = Field(default_factory=dict)
    # Free-form versioning of what was evaluated (e.g. {"agent_version": "v2",
    # "prompt": "p-17"}). Sent when the platform run is created and shown on
    # the run page and in `qym run get/list --json`.
    versioning_details: Dict[str, Any] = Field(default_factory=dict)
    should_stop: Optional[Callable[[], bool]] = Field(default=None, exclude=True)
    git_branch: Optional[str] = None   # Override auto-detected git branch
    git_commit: Optional[str] = None   # Override auto-detected git commit hash
    model: Optional[str] = None
    model_full: Optional[str] = None  # Full provider-prefixed ID (e.g. qwen/qwen3.5-397b-a17b) for API calls
    models: Optional[List[str]] = None
    force_model_override: bool = False  # Replace hardcoded OpenAI chat completion model at the SDK boundary
    
    # Platform dataset selection
    dataset_version: Optional[str] = None
    dataset_alias: Optional[str] = None
    
    # UI settings
    ui_port: int = 0
    cli_invocation: Optional[str] = None
    
    # Output settings
    output_dir: str = "qym_results"
    checkpoint_enabled: bool = True
    checkpoint_format: str = "csv"
    checkpoint_flush_each_item: bool = True
    checkpoint_fsync: bool = False
    resume_from: Optional[str] = None
    resume_rerun_errors: bool = False
    interrupt_grace_seconds: float = 2.0

    # OpenTelemetry auto-instrumentation (optional)
    otel_enabled: bool = True  # auto-enable if instrumentors installed; no-op if not

    # Phoenix tracing (optional OTLP export)
    phoenix_enabled: bool = False
    phoenix_endpoint: Optional[str] = None  # e.g. "http://localhost:6006/v1/traces"

    # Platform integration (deployed web app)
    platform_url: Optional[str] = None
    platform_api_key: Optional[str] = None
    platform_timeout: float = Field(default=5.0, gt=0)
    # Default policy: stream to platform. Users may explicitly opt out via live_mode="local".
    live_mode: str = "platform"  # local|platform|auto

    @field_validator("versioning_details", mode="before")
    @classmethod
    def _validate_versioning_details(cls, v: Any) -> Dict[str, Any]:
        return normalize_versioning_details(v)

    @field_validator("models", mode="before")
    @classmethod
    def normalize_models(cls, v: Any) -> Optional[List[str]]:
        if v is None:
            return None
        if isinstance(v, str):
            return [m.strip() for m in v.split(",") if m.strip()]
        if isinstance(v, (list, tuple)):
            return [str(m).strip() for m in v if m]
        return v

class RunSpec(BaseModel):
    """Specification for one entry in a parallel run."""
    model_config = ConfigDict(arbitrary_types_allowed=True)

    name: str
    display_name: Optional[str] = None
    task: Any
    dataset: Union[str, Any]
    metrics: List[Union[str, Callable, Metric]]
    config: EvaluatorConfig = Field(default_factory=EvaluatorConfig)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    input_mapping: Dict[str, str] = Field(default_factory=dict)
    output_path: Optional[str] = None
    
    # Derived fields for display/logging
    task_file: str = "<unknown>"
    task_function: str = "<unknown>"

    @field_validator("metrics", mode="before")
    @classmethod
    def validate_metrics(cls, v: Any) -> List[Union[str, Callable, Metric]]:
        if isinstance(v, str):
            return [m.strip() for m in v.split(",") if m.strip()]
        if isinstance(v, (list, tuple)):
            return list(v)
        raise ValueError("metrics must be a string or list")
