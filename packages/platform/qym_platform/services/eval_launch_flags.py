"""Launch-time rules of the experiment dataset read token and latency-sensitive runs.

Pure helpers shared by ``api/experiments.py`` (launch, dry run, retry) and the
environment routes:

- the **latency gate** (owner decision D4): an environment whose
  ``latency_sensitive_min_role`` is ``manager`` accepts a latency-sensitive launch only
  from a project manager or admin (:func:`latency_gate_names`);
- the dry run's launch-level **warnings** (``warnings`` top-level array, decision D-B8):
  ``vllm_ceiling_unset`` and ``dataset_token_not_declared``.

Nothing here touches the database except the dataset lookup of the second warning.
"""

from __future__ import annotations

from typing import Any, Iterable, List, Mapping, Optional, Sequence

from sqlalchemy.orm import Session

from ..db.models import Dataset, EvalEnvironment, EvalEnvironmentSchema
from .eval_dataset_tokens import TOKEN_ENV_KEY
from .eval_schema_form import schema_declares_env_key

LATENCY_ROLE_MEMBER = "member"
LATENCY_ROLE_MANAGER = "manager"
LATENCY_ROLES = (LATENCY_ROLE_MEMBER, LATENCY_ROLE_MANAGER)

# Per-run ceiling on concurrent foreign requests (guide v1.3 section 2.2).
CEILING_KEY = "EVAL_VLLM_POST_RUN_MAX_REQUESTS"
CEILING_MESSAGE = (
    "No post-run request ceiling: steady foreign load would be accepted and skew "
    "latency (guide §2.2)"
)


def latency_gate_names(envs: Iterable[EvalEnvironment], is_manager: bool) -> List[str]:
    """Names of the environments that refuse a latency-sensitive launch by this user."""
    if is_manager:
        return []
    return [
        env.name
        for env in envs
        if (env.latency_sensitive_min_role or LATENCY_ROLE_MEMBER)
        == LATENCY_ROLE_MANAGER
    ]


def latency_gate_message(names: Sequence[str]) -> str:
    """The 403 text and the blocking review item (``Latency-sensitive runs on a, b need ...``)."""
    return f"Latency-sensitive runs on {', '.join(names)} need a project manager"


def _env_value(document: Mapping[str, Any], key: str) -> Any:
    env = document.get("env_overrides")
    return env.get(key) if isinstance(env, Mapping) else None


def vllm_ceiling_warning(
    envs: Sequence[EvalEnvironment],
    schemas: Mapping[str, Optional[EvalEnvironmentSchema]],
    documents: Sequence[Mapping[str, Any]],
) -> Optional[dict]:
    """``vllm_ceiling_unset`` for a latency-sensitive launch, or ``None``.

    Raised for the environments whose schema declares ``EVAL_VLLM_POST_RUN_MAX_REQUESTS``
    while at least one combination's document leaves it unset (absent or ``null``).
    """
    unset = any(_env_value(doc, CEILING_KEY) is None for doc in documents)
    if not unset:
        return None
    ids = [
        env.id
        for env in envs
        if (schema := schemas.get(env.id)) is not None
        and schema_declares_env_key(schema.schema_json, CEILING_KEY)
    ]
    if not ids:
        return None
    return {
        "code": "vllm_ceiling_unset",
        "pointer": "/env_overrides/" + CEILING_KEY,
        "environment_ids": ids,
        "message": CEILING_MESSAGE,
    }


def dataset_token_warnings(
    db: Session,
    project_id: str,
    envs: Sequence[EvalEnvironment],
    schemas: Mapping[str, Optional[EvalEnvironmentSchema]],
    documents: Sequence[Mapping[str, Any]],
) -> List[dict]:
    """``dataset_token_not_declared`` per restricted or private dataset of the launch.

    The environments listed are those whose schema does not declare
    ``QYM_DATASET_READ_TOKEN``: their jobs read the dataset with the worker's own token.
    """
    missing = [
        env
        for env in envs
        if (schema := schemas.get(env.id)) is not None
        and not schema_declares_env_key(schema.schema_json, TOKEN_ENV_KEY)
    ]
    if not missing:
        return []
    refs: List[str] = []
    for doc in documents:
        evaluator = doc.get("evaluator")
        if not isinstance(evaluator, Mapping):
            continue
        listed = evaluator.get("datasets")
        candidates = [evaluator.get("dataset")] + [
            entry.get("dataset")
            for entry in (listed if isinstance(listed, list) else [])
            if isinstance(entry, Mapping)
        ]
        for ref in candidates:
            if isinstance(ref, str) and ref.strip() and ref.strip() not in refs:
                refs.append(ref.strip())
    out: List[dict] = []
    names = ", ".join(env.name for env in missing)
    for ref in refs:
        dataset = (
            db.query(Dataset)
            .filter(
                Dataset.project_id == project_id,
                Dataset.deleted_at.is_(None),
                (Dataset.name == ref) | (Dataset.slug == ref),
            )
            .first()
        )
        if dataset is None:
            continue
        kind = dataset_kind(dataset)
        if kind is None:
            continue
        out.append(
            {
                "code": "dataset_token_not_declared",
                "environment_ids": [env.id for env in missing],
                "message": (
                    f"The schema of {names} does not declare {TOKEN_ENV_KEY}, so "
                    f"“{dataset.name}” ({kind}) is read with the worker’s "
                    "own token."
                ),
            }
        )
    return out


def dataset_kind(dataset: Dataset) -> Optional[str]:
    """``restricted`` (WP-A access mode), ``private`` (private test set) or ``None``."""
    if getattr(dataset, "access_mode", "project") == "restricted":
        return "restricted"
    if dataset.private_test_set:
        return "private"
    return None
