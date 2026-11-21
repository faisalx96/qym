"""Data factory: business rules from a dataset, and new items from the rules.

A project dataset is connected to the factory (``DataFactory``). An analysis
job reads the items of the dataset's production (else newest published)
version, groups them by the value of one metadata key and asks the project's
LLM connection, per group and rule category, for the business rules the
inputs and expected outputs follow (``FactoryRule``, non-official until a
person with the ``approve`` level makes them official). A generation job then
branches the base items: layer 1 adds one rule to an item, layer 2 adds one
more rule to a layer-1 item, and so on up to ``max_layers``, writing the new
items at once to a new draft dataset of the project.

Jobs are rows of ``factory_jobs`` executed by :class:`FactoryWorker`, a leased
loop in the workers runtime (``QYM_SERVICE=workers``) or in the API process
(``all``), the way maintenance jobs run: the API only queues. Progress lives
in the row and is committed after every batch, so a cancel request and a pod
restart are honoured at batch granularity.

Permissions are the factory's own (``factory_access_levels``): ``none`` |
``view`` | ``modify`` | ``approve`` | ``manage``, like a dataset's levels with
one more, ``approve``, for who may make a rule official.
"""

from __future__ import annotations

import asyncio
import json
import random
import re
import socket
import threading
from datetime import timedelta
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple
from uuid import uuid4

import jsonschema
from qym_platform.auth import Principal
from qym_platform.datetime_utils import utc_now_naive
from qym_platform.db.models import (FACTORY_ACTIVE_JOB_STATUSES,
                                    FACTORY_LEVELS, DataFactory, Dataset,
                                    DatasetAlias, DatasetGrant, DatasetItem,
                                    DatasetVersion, DatasetVersionChange,
                                    DatasetVersionStatus, FactoryGrant,
                                    FactoryJob, FactoryJobKind, FactoryRule,
                                    FactoryRuleCategory, FactoryRuleLink,
                                    ProjectLlmConnection, ProjectMembership,
                                    ProjectRole)
from qym_platform.item_identity import build_identity_fingerprint
from qym_platform.llm_endpoint_security import (create_llm_http_client,
                                                validate_llm_base_url)
from qym_platform.log import get_logger
from qym_platform.openai_compat import create_chat_completion_compat
from qym_platform.permissions import is_platform_admin
from qym_platform.secrets import resolve_llm_api_key
from qym_platform.services.dataset_meta import metadata_facets
from qym_platform.services.dataset_search import dataset_item_search_text
from qym_platform.settings import PlatformSettings
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

logger = get_logger(__name__)

LEASE_SECONDS = 120
LOG_LINES = 200
# Items of one group sent in one model call, and the most items read per group.
ANALYSIS_BATCH_ITEMS = 25
ANALYSIS_SAMPLE_MAX = 400
ANALYSIS_SAMPLE_DEFAULT = 60
# Generation limits: layers of rules per item, children per parent and layer, items per job.
MAX_LAYERS = 5
MAX_BRANCHING = 10
MAX_ITEMS_PER_JOB = 5000
GENERATION_DEFAULTS = {
    "max_layers": 1,
    "branching": 3,
    "max_items": 500,
    "official_only": True,
}
# Text of one field sent to the model, at most.
FIELD_TEXT_MAX = 2000
UNGROUPED = ""
DEFAULT_CATEGORY_KEY = "general"
DEFAULT_CATEGORY_NAME = "General"
DEFAULT_CATEGORY_DESCRIPTION = (
    "Any business rule the inputs and expected outputs follow: constraints on the "
    "answer, policies the response applies, conditions that change the outcome."
)

_LEVEL_RANK = {name: rank for rank, name in enumerate(FACTORY_LEVELS)}
_INSERT_BATCH = 200


class FactoryConfigError(ValueError):
    """The factory cannot run a job as configured (no model, no published version)."""


class JobCancelled(Exception):
    pass


class JobLeaseLost(Exception):
    pass


# ── Permissions ──────────────────────────────────────────────────────────────


def factory_level_at_least(level: str, need: str) -> bool:
    """Whether access ``level`` is ``need`` or higher."""
    return _LEVEL_RANK.get(level, 0) >= _LEVEL_RANK[need]


def factory_access_levels(
    db: Session, principal: Principal, factories: Iterable[DataFactory]
) -> Dict[str, str]:
    """Access level of ``principal`` on each factory, with a fixed number of queries.

    Platform admins and project managers get ``manage``; a non-member ``none``.
    In ``project`` mode every other member gets ``modify``, lifted to
    ``approve`` by an ``approve`` grant. In ``restricted`` mode the creator gets
    ``modify``, a granted user the grant's level and everyone else ``none``.
    Grants of a removed member are inert because the membership comes first.
    """
    factories = [factory for factory in factories if factory is not None]
    if not factories:
        return {}
    if is_platform_admin(principal):
        return {factory.id: "manage" for factory in factories}
    project_ids = {factory.project_id for factory in factories}
    roles = {
        row.project_id: row.role
        for row in db.query(
            ProjectMembership.project_id, ProjectMembership.role
        ).filter(
            ProjectMembership.user_id == principal.user.id,
            ProjectMembership.project_id.in_(project_ids),
        )
    }
    member_ids = [factory.id for factory in factories if factory.project_id in roles]
    grants: Dict[str, str] = {}
    if member_ids:
        grants = {
            row.factory_id: row.level
            for row in db.query(FactoryGrant.factory_id, FactoryGrant.level).filter(
                FactoryGrant.user_id == principal.user.id,
                FactoryGrant.factory_id.in_(member_ids),
            )
        }
    levels: Dict[str, str] = {}
    for factory in factories:
        role = roles.get(factory.project_id)
        granted = grants.get(factory.id)
        if role is None:
            levels[factory.id] = "none"
        elif role == ProjectRole.VIEWER:
            # A Viewer reads every page and changes nothing (C033); grants never lift it.
            levels[factory.id] = "view"
        elif role == ProjectRole.MANAGER:
            levels[factory.id] = "manage"
        elif factory.access_mode != "restricted":
            levels[factory.id] = "approve" if granted == "approve" else "modify"
        elif granted in ("view", "modify", "approve"):
            levels[factory.id] = granted
        elif factory.created_by_user_id == principal.user.id:
            levels[factory.id] = "modify"
        else:
            levels[factory.id] = "none"
    return levels


def factory_access_level(
    db: Session, principal: Principal, factory: DataFactory
) -> str:
    """``none`` | ``view`` | ``modify`` | ``approve`` | ``manage`` for ``principal`` on ``factory``."""
    return factory_access_levels(db, principal, [factory])[factory.id]


# ── Source dataset ───────────────────────────────────────────────────────────


def resolve_source_version(db: Session, dataset: Dataset) -> Optional[DatasetVersion]:
    """The version the factory reads: the ``production`` alias, else the newest published one."""
    alias = (
        db.query(DatasetAlias)
        .filter(
            DatasetAlias.dataset_id == dataset.id, DatasetAlias.alias == "production"
        )
        .first()
    )
    if alias:
        version = db.get(DatasetVersion, alias.dataset_version_id)
        if version:
            return version
    return (
        db.query(DatasetVersion)
        .filter(
            DatasetVersion.dataset_id == dataset.id,
            DatasetVersion.status == DatasetVersionStatus.PUBLISHED,
        )
        .order_by(
            DatasetVersion.published_at.desc().nullslast(),
            DatasetVersion.created_at.desc(),
        )
        .first()
    )


def _scalar_group_text(value: Any) -> str:
    if value is None or isinstance(value, (dict, list)):
        return UNGROUPED
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return json.dumps(value)
    text = str(value).strip()
    return text[:500]


def group_value_of(metadata: Any, key: Optional[str]) -> str:
    """The group of an item: the scalar at the dotted ``key`` of its metadata, else ungrouped."""
    if not key or not isinstance(metadata, dict):
        return UNGROUPED
    node: Any = metadata
    for part in key.split("."):
        if not isinstance(node, dict) or part not in node:
            return UNGROUPED
        node = node[part]
    return _scalar_group_text(node)


def metadata_key_choices(db: Session, version_id: str) -> List[Dict[str, Any]]:
    """Scalar metadata paths of the version with their distinct values (the group key picker)."""
    facets = metadata_facets(db, version_id)
    out = []
    for path in facets.get("paths", []):
        if path.get("kind") != "scalar":
            continue
        out.append(
            {
                "key": path["path"],
                "values": [row["value"] for row in path.get("values", [])][:12],
                "value_count": len(path.get("values", [])),
                "truncated": bool(path.get("truncated")),
            }
        )
    return out


def source_items(db: Session, version_id: str) -> List[DatasetItem]:
    """Active (not disabled) items of a version in index order."""
    return (
        db.query(DatasetItem)
        .filter(
            DatasetItem.dataset_version_id == version_id,
            DatasetItem.disabled_at.is_(None),
        )
        .order_by(DatasetItem.index.asc(), DatasetItem.id.asc())
        .all()
    )


# ── Rule bodies and schemas ──────────────────────────────────────────────────


def check_json_schema(schema: Any) -> Optional[str]:
    """``None`` when ``schema`` is a usable JSON schema object, else the problem."""
    if schema is None:
        return None
    if not isinstance(schema, dict):
        return "The schema must be a JSON object"
    try:
        jsonschema.Draft202012Validator.check_schema(schema)
    except jsonschema.SchemaError as exc:
        return f"Invalid JSON schema: {exc.message}"
    return None


def body_problem(body: Any, schema: Optional[Dict[str, Any]]) -> Optional[str]:
    """``None`` when ``body`` fits the category's schema (or there is none), else the error."""
    if schema is None:
        if body is not None and not isinstance(body, dict):
            return "The rule body must be a JSON object"
        return None
    if body is None:
        return "This category requires a rule body that follows its schema"
    try:
        jsonschema.validate(body, schema, cls=jsonschema.Draft202012Validator)
    except jsonschema.ValidationError as exc:
        return f"The rule body does not follow the category schema: {exc.message}"
    return None


def normalize_title(title: str) -> str:
    return re.sub(r"\s+", " ", (title or "").strip().lower())


def slugify_key(value: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return key[:100] or "category"


# ── LLM ──────────────────────────────────────────────────────────────────────


def llm_connection_for(db: Session, factory: DataFactory) -> ProjectLlmConnection:
    """The factory's connection, else the project default, else the oldest; raises when none."""
    base = db.query(ProjectLlmConnection).filter(
        ProjectLlmConnection.project_id == factory.project_id
    )
    conn = None
    if factory.llm_connection_id:
        conn = base.filter(ProjectLlmConnection.id == factory.llm_connection_id).first()
    if conn is None:
        conn = base.filter(ProjectLlmConnection.is_default.is_(True)).first()
    if conn is None:
        conn = base.order_by(ProjectLlmConnection.created_at).first()
    if conn is None:
        raise FactoryConfigError(
            "No LLM connection is configured for this project. Add one in Project settings → LLM connections."
        )
    if not conn.llm_api_key_encrypted:
        raise FactoryConfigError(
            f"LLM connection '{conn.name}' has no API key. Update it in Project settings → LLM connections."
        )
    if not conn.llm_model:
        raise FactoryConfigError(f"LLM connection '{conn.name}' names no model.")
    return conn


def build_client(conn: ProjectLlmConnection) -> Tuple[Any, str]:
    """An AsyncOpenAI client for ``conn`` and its model name."""
    from openai import AsyncOpenAI

    settings = PlatformSettings()
    api_key = resolve_llm_api_key(
        {"llm_api_key_encrypted": conn.llm_api_key_encrypted}, settings
    )
    base_url = validate_llm_base_url(
        conn.llm_base_url or "https://api.openai.com/v1",
        allow_private=settings.allow_private_llm_base_urls,
    )
    client = AsyncOpenAI(
        base_url=base_url,
        api_key=api_key,
        http_client=create_llm_http_client(
            allow_private=settings.allow_private_llm_base_urls
        ),
    )
    return client, conn.llm_model


def _parse_json_text(text: str) -> Any:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start >= 0 and end > start:
            return json.loads(raw[start : end + 1])
        raise


async def complete_json(
    client: Any, model: str, system: str, user: str, *, temperature: float = 0.2
) -> Dict[str, Any]:
    """One chat completion that must answer with a JSON object (tests replace this)."""
    response = await create_chat_completion_compat(
        client,
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temperature,
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content if response.choices else ""
    parsed = _parse_json_text(content or "")
    if not isinstance(parsed, dict):
        raise ValueError("The model did not answer with a JSON object")
    return parsed


ANALYSIS_SYSTEM = """You are a business analyst extracting the rules an evaluation dataset follows.
You are given items of one group of a dataset: each item has an input (the question or request) and an expected
output (the correct answer or response). You are also given the rule categories of this factory. Find the business
rules that the expected outputs apply: policies, constraints, conditions that change the answer, formats that are
always respected, exceptions. Every rule must be supported by at least one item and must be specific to this data,
not generic advice.
For each rule choose the categories it belongs to: only those whose description fits the rule, usually one, never
every category by default. The first category is the primary one; when it has a JSON schema, "body" follows that
schema, else "body" is null.
A rule is a "bridge" when it extends an item into other categories rather than constraining its answer: joining
another table in a query, bringing a second product into a conversation, handing over to another process. A bridge
lists in "bridge_to" the categories it opens.
Existing rules are listed with their ids. Never propose a rule that says what an existing one says, even in other
words or with other examples: put the existing rule's id in "same_as" instead, or leave the rule out.
Answer with JSON only, in this shape:
{"rules": [{"title": "<short rule name>", "description": "<the rule, in one to three sentences, as a statement the
answer must satisfy>", "categories": ["<category key>", ...], "kind": "rule" or "bridge", "bridge_to": ["<category
key>", ...], "body": <object or null>, "evidence": ["<item_id>", ...], "same_as": "<existing rule id>" or null}]}
Return {"rules": []} when the items show no new rule."""

CONSOLIDATE_SYSTEM = """You deduplicate business rules. You are given the rules a factory already has (with their ids)
and the candidates an analysis proposed (numbered c0, c1, ...). Two rules are the same when they constrain the
answer in the same way, whatever the wording, the scope words or the examples. Answer with JSON only:
{"duplicates": [{"candidate": "c<n>", "of": "<existing rule id, or c<m> of an earlier candidate>"}]}
List every candidate that repeats an existing rule or an earlier candidate; answer {"duplicates": []} when none does."""

GENERATION_SYSTEM = """You create a new evaluation dataset item from an existing one by applying one business rule.
You are given the base item (its input and expected output), the rules already applied to it, and one new rule.
Write a new input that is a natural variation of the base input in which the new rule matters, and the expected
output that is correct for the new input under all the applied rules. When the new rule is a bridge, the new input
extends the base item into the categories the bridge opens (it joins the other table, brings in the other product,
reaches the other process) and the expected output covers that extension. Keep the language, the domain, the tone
and the exact data shape of the base item: when the input or the expected output is a JSON object, answer with the
same keys.
Answer with JSON only: {"input": <same shape as the base input>, "expected_output": <same shape as the base expected
output>, "note": "<one sentence on what changed>"}."""


def _text(value: Any, limit: int = FIELD_TEXT_MAX) -> str:
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, ensure_ascii=False, sort_keys=True)
        except (TypeError, ValueError):
            text = str(value)
    if len(text) > limit:
        return text[: limit - 1] + "…"
    return text


def _group_label(key: Optional[str], value: str) -> str:
    if not key:
        return "the whole dataset (no grouping key)"
    if value == UNGROUPED:
        return f"items without a value for metadata key '{key}' (ungrouped)"
    return f"items whose metadata '{key}' is '{value}'"


def _category_brief(category: FactoryRuleCategory) -> Dict[str, Any]:
    brief: Dict[str, Any] = {
        "key": category.key,
        "name": category.name,
        "description": category.description or "",
    }
    if category.json_schema is not None:
        brief["body_schema"] = category.json_schema
    return brief


def analysis_prompt(
    *,
    categories: List[FactoryRuleCategory],
    group_key: Optional[str],
    group_value: str,
    items: List[DatasetItem],
    existing: List[Dict[str, Any]],
    instructions: str,
) -> str:
    lines = [
        "Rule categories (choose only the ones that fit each rule):",
        json.dumps([_category_brief(c) for c in categories], ensure_ascii=False),
        f"Group: {_group_label(group_key, group_value)}",
    ]
    if instructions.strip():
        lines.append(f"Extra instructions: {instructions.strip()}")
    lines.append(
        "Existing rules (do not repeat, in any wording): "
        + (json.dumps(existing[:150], ensure_ascii=False) if existing else "none")
    )
    lines.append("Items:")
    for item in items:
        lines.append(
            json.dumps(
                {
                    "item_id": item.item_id,
                    "input": _text(item.input),
                    "expected_output": _text(item.expected_output),
                },
                ensure_ascii=False,
            )
        )
    return "\n".join(lines)


def consolidate_prompt(
    *, existing: List[Dict[str, Any]], candidates: List[Dict[str, Any]]
) -> str:
    return "\n".join(
        [
            "Existing rules: "
            + (json.dumps(existing[:150], ensure_ascii=False) if existing else "none"),
            "Candidates:",
            json.dumps(
                [
                    {
                        "candidate": f"c{n}",
                        "title": c["title"],
                        "description": c["description"],
                        "categories": c["category_keys"],
                        "kind": c["kind"],
                    }
                    for n, c in enumerate(candidates)
                ],
                ensure_ascii=False,
            ),
        ]
    )


def generation_prompt(
    *,
    base_input: Any,
    base_expected: Any,
    applied: List[FactoryRule],
    rule: FactoryRule,
    category_names: List[str],
    bridge_names: List[str],
    instructions: str,
) -> str:
    def rule_json(r: FactoryRule) -> Dict[str, Any]:
        return {"title": r.title, "description": r.description, "body": r.body}

    heading = f"New rule to apply (categories: {', '.join(category_names) or 'none'}"
    if rule.kind == "bridge":
        heading += f"; a bridge into: {', '.join(bridge_names) or 'none'}"
    heading += "):"
    lines = [
        "Base item input:",
        _text(base_input, 6000),
        "Base item expected output:",
        _text(base_expected, 6000),
        "Rules already applied: "
        + (
            json.dumps([rule_json(r) for r in applied], ensure_ascii=False)
            if applied
            else "none"
        ),
        heading,
        json.dumps(rule_json(rule), ensure_ascii=False),
    ]
    if instructions.strip():
        lines.append(f"Extra instructions: {instructions.strip()}")
    return "\n".join(lines)


# ── Job parameters ───────────────────────────────────────────────────────────


def validate_params(kind: str, params: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """The normalized job parameters; raises ``ValueError`` with the problem."""
    raw = dict(params or {})
    if kind == FactoryJobKind.ANALYSIS.value:
        sample = raw.get("sample_per_group", ANALYSIS_SAMPLE_DEFAULT)
        if (
            not isinstance(sample, int)
            or isinstance(sample, bool)
            or not 1 <= sample <= ANALYSIS_SAMPLE_MAX
        ):
            raise ValueError(
                f"sample_per_group must be an integer from 1 to {ANALYSIS_SAMPLE_MAX}"
            )
        categories = raw.get("category_ids")
        if categories is not None and (
            not isinstance(categories, list)
            or not all(isinstance(c, str) for c in categories)
        ):
            raise ValueError("category_ids must be a list of category ids")
        groups = raw.get("group_values")
        if groups is not None and (
            not isinstance(groups, list) or not all(isinstance(g, str) for g in groups)
        ):
            raise ValueError("group_values must be a list of group values")
        return {
            "sample_per_group": sample,
            "category_ids": categories,
            "group_values": groups,
        }
    if kind == FactoryJobKind.GENERATION.value:
        out: Dict[str, Any] = {}
        for name, upper in (
            ("max_layers", MAX_LAYERS),
            ("branching", MAX_BRANCHING),
            ("max_items", MAX_ITEMS_PER_JOB),
        ):
            value = raw.get(name, GENERATION_DEFAULTS[name])
            if (
                not isinstance(value, int)
                or isinstance(value, bool)
                or not 1 <= value <= upper
            ):
                raise ValueError(f"{name} must be an integer from 1 to {upper}")
            out[name] = value
        official_only = raw.get("official_only", GENERATION_DEFAULTS["official_only"])
        if not isinstance(official_only, bool):
            raise ValueError("official_only must be true or false")
        out["official_only"] = official_only
        groups = raw.get("group_values")
        if groups is not None and (
            not isinstance(groups, list) or not all(isinstance(g, str) for g in groups)
        ):
            raise ValueError("group_values must be a list of group values")
        out["group_values"] = groups
        name = raw.get("dataset_name")
        if name is not None and (not isinstance(name, str) or len(name.strip()) > 200):
            raise ValueError("dataset_name must be a string of at most 200 characters")
        out["dataset_name"] = (
            name.strip() if isinstance(name, str) and name.strip() else None
        )
        return out
    raise ValueError("kind must be analysis or generation")


def active_job(db: Session, factory_id: str) -> Optional[FactoryJob]:
    return (
        db.query(FactoryJob)
        .filter(
            FactoryJob.factory_id == factory_id,
            FactoryJob.status.in_(FACTORY_ACTIVE_JOB_STATUSES),
        )
        .order_by(FactoryJob.created_at.desc())
        .first()
    )


def queue_job(
    db: Session,
    factory: DataFactory,
    kind: str,
    params: Dict[str, Any],
    *,
    user_id: Optional[str],
) -> FactoryJob:
    """Insert a queued job (the caller commits); parameters are already validated."""
    now = utc_now_naive()
    job = FactoryJob(
        id=str(uuid4()),
        factory_id=factory.id,
        kind=kind,
        status="queued",
        params=dict(params),
        progress={"message": "Queued"},
        requested_by_user_id=user_id,
        created_at=now,
        updated_at=now,
    )
    db.add(job)
    return job


def request_cancel(job: FactoryJob) -> bool:
    """Mark ``job`` cancelled (queued) or cancel-requested (running); False when finished."""
    if job.status == "queued":
        job.status = "cancelled"
        job.finished_at = utc_now_naive()
        job.progress = dict(job.progress or {}, message="Cancelled before it started")
        return True
    if job.status == "running":
        job.status = "cancel_requested"
        return True
    return job.status == "cancel_requested"


# ── Job runtime ──────────────────────────────────────────────────────────────


class JobContext:
    """What a runner gets: the job's parameters and a way to persist progress under the lease."""

    def __init__(
        self, job: FactoryJob, session_factory: Callable[[], Session], owner: str
    ) -> None:
        self.job_id = job.id
        self.factory_id = job.factory_id
        self.kind = job.kind
        self.params = dict(job.params or {})
        self.progress: Dict[str, Any] = dict(job.progress or {})
        self.owner = owner
        self.session_factory = session_factory
        self.output_dataset_id = job.output_dataset_id
        self.requested_by_user_id = job.requested_by_user_id
        self._log: List[str] = []

    def log(self, message: str) -> None:
        stamp = utc_now_naive().strftime("%H:%M:%S")
        self._log.append(f"{stamp} {message}")

    def commit(self, **progress: Any) -> None:
        """Persist progress and the log, renew the lease, and honour a cancel request."""
        self.progress.update(progress)
        with self.session_factory() as db:
            job = db.get(FactoryJob, self.job_id)
            if job is None or job.lease_owner != self.owner:
                raise JobLeaseLost()
            cancelled = job.status == "cancel_requested"
            job.progress = dict(self.progress)
            if self._log:
                lines = (job.log or "").splitlines()
                lines.extend(self._log)
                job.log = "\n".join(lines[-LOG_LINES:])
                self._log = []
            job.lease_until = utc_now_naive() + timedelta(seconds=LEASE_SECONDS)
            job.output_dataset_id = self.output_dataset_id
            job.updated_at = utc_now_naive()
            db.commit()
        if cancelled:
            raise JobCancelled()


def claim_job(db: Session, owner: str) -> Optional[FactoryJob]:
    """Take the oldest queued job, or a running one whose lease expired (its process died)."""
    now = utc_now_naive()
    stmt = (
        select(FactoryJob)
        .where(
            (FactoryJob.status == "queued")
            | (
                FactoryJob.status.in_(("running", "cancel_requested"))
                & ((FactoryJob.lease_until.is_(None)) | (FactoryJob.lease_until < now))
            )
        )
        .order_by(FactoryJob.created_at)
        .limit(1)
    )
    if db.get_bind().dialect.name == "postgresql":
        stmt = stmt.with_for_update(skip_locked=True)
    job = db.execute(stmt).scalars().first()
    if not job:
        return None
    if job.status == "queued":
        job.status = "running"
        job.started_at = now
    job.lease_owner = owner
    job.lease_until = now + timedelta(seconds=LEASE_SECONDS)
    job.updated_at = now
    db.commit()
    return job


def _finish(
    session_factory: Callable[[], Session],
    job_id: str,
    owner: str,
    status: str,
    error: Optional[str],
    ctx: JobContext,
) -> None:
    with session_factory() as db:
        job = db.get(FactoryJob, job_id)
        if job is None or job.lease_owner != owner:
            return
        job.status = status
        job.error = error
        job.progress = dict(ctx.progress)
        if ctx._log:
            lines = (job.log or "").splitlines()
            lines.extend(ctx._log)
            job.log = "\n".join(lines[-LOG_LINES:])
            ctx._log = []
        job.output_dataset_id = ctx.output_dataset_id
        job.finished_at = utc_now_naive()
        job.lease_owner = None
        job.lease_until = None
        job.updated_at = utc_now_naive()
        if status == "succeeded" and job.kind == FactoryJobKind.ANALYSIS.value:
            factory = db.get(DataFactory, job.factory_id)
            if factory is not None:
                factory.last_analyzed_at = utc_now_naive()
        db.commit()


def run_job(job_id: str, session_factory: Callable[[], Session], *, owner: str) -> str:
    """Drive one claimed job to its end; returns the final status."""
    with session_factory() as db:
        job = db.get(FactoryJob, job_id)
        if job is None:
            return "missing"
        if job.lease_owner != owner:
            return "lease_lost"
        ctx = JobContext(job, session_factory, owner)
        db.expunge(job)
    status = "succeeded"
    error: Optional[str] = None
    try:
        if ctx.kind == FactoryJobKind.ANALYSIS.value:
            asyncio.run(_run_analysis(ctx))
        elif ctx.kind == FactoryJobKind.GENERATION.value:
            asyncio.run(_run_generation(ctx))
        else:
            raise FactoryConfigError(f"Unknown factory job kind: {ctx.kind}")
    except JobLeaseLost:
        logger.warning(
            "factory job %s lost its lease; another worker resumes it", job_id
        )
        return "lease_lost"
    except JobCancelled:
        status = "cancelled"
        ctx.log("Cancelled")
    except FactoryConfigError as exc:
        status = "failed"
        error = str(exc)
        ctx.log(f"FAILED: {error}")
    except Exception as exc:  # noqa: BLE001 - recorded on the job row
        logger.exception("factory job %s (%s) failed", job_id, ctx.kind)
        status = "failed"
        error = f"{type(exc).__name__}: {exc}"[:4000]
        ctx.log(f"FAILED: {error}")
    _finish(session_factory, job_id, owner, status, error, ctx)
    return status


class FactoryWorker:
    """The loop that claims and runs factory jobs (one at a time per process)."""

    def __init__(
        self, session_factory: Callable[[], Session], *, interval: float = 2.0
    ) -> None:
        self.session_factory = session_factory
        self.interval = interval
        self.owner = f"{socket.gethostname()[:24]}:{uuid4().hex}"
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.current_job_id: Optional[str] = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run, name="qym-data-factory", daemon=True
        )
        self._thread.start()

    def is_alive(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def stop(self, *, timeout: float = 10.0) -> bool:
        self._stop.set()
        thread = self._thread
        if thread and thread is not threading.current_thread():
            thread.join(timeout=timeout)
        return not thread or not thread.is_alive()

    def tick(self) -> Optional[str]:
        """Claim and run one job; ``None`` when nothing is queued."""
        with self.session_factory() as db:
            job = claim_job(db, self.owner)
            if not job:
                return None
            job_id = job.id
        self.current_job_id = job_id
        try:
            return run_job(job_id, self.session_factory, owner=self.owner)
        finally:
            self.current_job_id = None

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                result = self.tick()
            except Exception:  # noqa: BLE001
                logger.exception("data factory worker tick failed")
                result = None
            self._stop.wait(0.2 if result else self.interval)


# ── Analysis ─────────────────────────────────────────────────────────────────


def _load_factory(
    db: Session, factory_id: str
) -> Tuple[DataFactory, Dataset, DatasetVersion]:
    factory = db.get(DataFactory, factory_id)
    if factory is None:
        raise FactoryConfigError("The factory was disconnected")
    dataset = db.get(Dataset, factory.dataset_id)
    if dataset is None or dataset.deleted_at is not None:
        raise FactoryConfigError("The connected dataset was deleted")
    version = resolve_source_version(db, dataset)
    if version is None:
        raise FactoryConfigError(
            "The connected dataset has no published version to read"
        )
    return factory, dataset, version


def _group_items(
    items: List[DatasetItem], key: Optional[str]
) -> Dict[str, List[DatasetItem]]:
    groups: Dict[str, List[DatasetItem]] = {}
    for item in items:
        groups.setdefault(group_value_of(item.item_metadata, key), []).append(item)
    return dict(
        sorted(groups.items(), key=lambda entry: (entry[0] == UNGROUPED, entry[0]))
    )


def rule_category_map(
    db: Session, rule_ids: List[str]
) -> Tuple[Dict[str, List[str]], Dict[str, List[str]]]:
    """The further category ids and the bridge target ids of each rule, by rule id."""
    extra: Dict[str, List[str]] = {}
    bridges: Dict[str, List[str]] = {}
    if not rule_ids:
        return extra, bridges
    for link in (
        db.query(FactoryRuleLink)
        .filter(FactoryRuleLink.rule_id.in_(rule_ids))
        .order_by(FactoryRuleLink.id)
    ):
        target = bridges if link.role == "bridge" else extra
        target.setdefault(link.rule_id, []).append(link.category_id)
    return extra, bridges


def _existing_briefs(
    db: Session, factory_id: str, groups: List[str], categories_by_id: Dict[str, str]
) -> List[Dict[str, Any]]:
    rules = (
        db.query(FactoryRule)
        .filter(
            FactoryRule.factory_id == factory_id, FactoryRule.group_value.in_(groups)
        )
        .order_by(FactoryRule.created_at, FactoryRule.id)
        .all()
    )
    extra, bridges = rule_category_map(db, [r.id for r in rules])
    out = []
    for r in rules:
        keys = [categories_by_id.get(r.category_id, "")] + [
            categories_by_id.get(c, "") for c in extra.get(r.id, [])
        ]
        brief: Dict[str, Any] = {
            "id": r.id,
            "title": r.title,
            "description": _text(r.description, 600),
            "categories": [k for k in keys if k],
            "kind": r.kind or "rule",
        }
        if r.kind == "bridge":
            brief["bridge_to"] = [
                categories_by_id.get(c, "") for c in bridges.get(r.id, [])
            ]
        out.append(brief)
    return out


def _rules_from_answer(
    answer: Dict[str, Any],
    *,
    categories: List[FactoryRuleCategory],
    item_ids: set[str],
    existing_ids: set[str],
) -> Tuple[List[Dict[str, Any]], int]:
    """The usable candidate rules of an analysis answer, and how many it marked as existing."""
    rules = answer.get("rules")
    if not isinstance(rules, list):
        return [], 0
    by_key = {c.key: c for c in categories}
    out: List[Dict[str, Any]] = []
    same = 0
    for raw in rules[:50]:
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or "").strip()[:300]
        description = str(raw.get("description") or "").strip()
        if not title:
            continue
        same_as = raw.get("same_as")
        if isinstance(same_as, str) and same_as in existing_ids:
            same += 1
            continue
        raw_keys = raw.get("categories")
        keys: List[str] = []
        for k in raw_keys if isinstance(raw_keys, list) else []:
            k = str(k)
            if k in by_key and k not in keys:
                keys.append(k)
        if not keys:
            keys = [categories[0].key]
        primary = by_key[keys[0]]
        body = raw.get("body")
        if body_problem(body, primary.json_schema) is not None:
            if primary.json_schema is not None:
                continue
            body = None
        kind = "bridge" if raw.get("kind") == "bridge" else "rule"
        bridge_keys: List[str] = []
        raw_bridge = raw.get("bridge_to")
        for k in raw_bridge if isinstance(raw_bridge, list) else []:
            k = str(k)
            if k in by_key and k not in keys and k not in bridge_keys:
                bridge_keys.append(k)
        if kind == "bridge" and not bridge_keys:
            kind = "rule"
        evidence_raw = raw.get("evidence")
        evidence = (
            [str(e) for e in evidence_raw if str(e) in item_ids][:50]
            if isinstance(evidence_raw, list)
            else []
        )
        out.append(
            {
                "title": title,
                "description": description,
                "body": body,
                "evidence": evidence,
                "category_keys": keys,
                "kind": kind,
                "bridge_keys": bridge_keys if kind == "bridge" else [],
            }
        )
    return out, same


def _duplicates_from_answer(answer: Dict[str, Any], count: int) -> set[int]:
    """The candidate indexes a consolidation answer flags as duplicates."""
    flagged: set[int] = set()
    raw = answer.get("duplicates")
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        match = re.fullmatch(r"c(\d+)", str(entry.get("candidate") or ""))
        if not match:
            continue
        index = int(match.group(1))
        if 0 <= index < count and str(entry.get("of") or "") != f"c{index}":
            flagged.add(index)
    return flagged


CONSOLIDATE_CHUNK = 60


async def _run_analysis(ctx: JobContext) -> None:
    settings = PlatformSettings()
    with ctx.session_factory() as db:
        factory, dataset, version = _load_factory(db, ctx.factory_id)
        conn = llm_connection_for(db, factory)
        key = factory.group_metadata_key
        instructions = factory.analysis_instructions or ""
        categories = (
            db.query(FactoryRuleCategory)
            .filter(FactoryRuleCategory.factory_id == factory.id)
            .order_by(FactoryRuleCategory.position, FactoryRuleCategory.created_at)
            .all()
        )
        wanted = ctx.params.get("category_ids")
        if wanted:
            categories = [c for c in categories if c.id in set(wanted)]
        items = source_items(db, version.id)
        db.expunge_all()
    if not categories:
        raise FactoryConfigError("The factory has no rule category to extract")
    if not items:
        raise FactoryConfigError(
            f"Version {version.version} of the dataset has no active items"
        )
    by_key = {c.key: c for c in categories}
    names_by_id = {c.id: c.key for c in categories}
    groups = _group_items(items, key)
    wanted_groups = ctx.params.get("group_values")
    if wanted_groups:
        groups = {g: rows for g, rows in groups.items() if g in set(wanted_groups)}
    sample = int(ctx.params.get("sample_per_group") or ANALYSIS_SAMPLE_DEFAULT)
    batches: Dict[str, List[List[DatasetItem]]] = {}
    for group, rows in groups.items():
        rows = rows[:sample]
        batches[group] = [
            rows[start : start + ANALYSIS_BATCH_ITEMS]
            for start in range(0, len(rows), ANALYSIS_BATCH_ITEMS)
        ]
    # One extraction call per batch, then one consolidation call per group.
    total = sum(len(b) for b in batches.values()) + len(batches)
    ctx.log(
        f"Reading {len(items)} items of {dataset.name} {version.version}: {len(groups)} group(s), "
        f"{len(categories)} categor{'y' if len(categories) == 1 else 'ies'}, {total} model call(s)"
    )
    ctx.commit(
        message="Starting",
        source_version=version.version,
        groups=len(groups),
        categories=len(categories),
        total=total,
        done=0,
        rules_added=0,
        rules_skipped=0,
    )
    client, model = build_client(conn)
    semaphore = asyncio.Semaphore(settings.factory_llm_concurrency)
    added = 0
    skipped = 0
    done = 0

    async def extract(
        group: str, rows: List[DatasetItem], existing: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        prompt = analysis_prompt(
            categories=categories,
            group_key=key,
            group_value=group,
            items=rows,
            existing=existing,
            instructions=instructions,
        )
        async with semaphore:
            return await complete_json(client, model, ANALYSIS_SYSTEM, prompt)

    async def consolidate(
        existing: List[Dict[str, Any]], candidates: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Candidates minus the ones the model says repeat an existing rule or each other."""
        kept: List[Dict[str, Any]] = []
        for start in range(0, len(candidates), CONSOLIDATE_CHUNK):
            chunk = candidates[start : start + CONSOLIDATE_CHUNK]
            prompt = consolidate_prompt(
                existing=existing
                + [
                    {
                        "id": f"kept-{n}",
                        "title": c["title"],
                        "description": c["description"],
                        "categories": c["category_keys"],
                        "kind": c["kind"],
                    }
                    for n, c in enumerate(kept)
                ],
                candidates=chunk,
            )
            async with semaphore:
                answer = await complete_json(client, model, CONSOLIDATE_SYSTEM, prompt)
            flagged = _duplicates_from_answer(answer, len(chunk))
            kept.extend(c for n, c in enumerate(chunk) if n not in flagged)
        return kept

    try:
        for group, group_batches in batches.items():
            scope = [group] if group == UNGROUPED or not key else [group, UNGROUPED]
            with ctx.session_factory() as db:
                existing = _existing_briefs(db, ctx.factory_id, scope, names_by_id)
            existing_ids = {e["id"] for e in existing}
            known = {normalize_title(e["title"]) for e in existing}
            candidates: List[Dict[str, Any]] = []
            same = 0
            for start in range(0, len(group_batches), settings.factory_llm_concurrency):
                chunk = group_batches[start : start + settings.factory_llm_concurrency]
                answers = await asyncio.gather(
                    *(extract(group, rows, existing) for rows in chunk)
                )
                for rows, answer in zip(chunk, answers):
                    item_ids = {row.item_id for row in rows}
                    proposed, marked = _rules_from_answer(
                        answer,
                        categories=categories,
                        item_ids=item_ids,
                        existing_ids=existing_ids,
                    )
                    same += marked
                    fresh = 0
                    for rule in proposed:
                        norm = normalize_title(rule["title"])
                        if norm in known:
                            same += 1
                            continue
                        known.add(norm)
                        candidates.append(rule)
                        fresh += 1
                    done += 1
                    ctx.log(
                        f"{group or 'ungrouped'}: {len(rows)} items, {fresh} new rule(s) proposed"
                        + (f", {marked} marked as existing" if marked else "")
                    )
                ctx.commit(
                    message=f"{done} of {total} model calls done",
                    done=done,
                    rules_added=added,
                    rules_skipped=skipped + same,
                )
            if candidates:
                before = len(candidates)
                candidates = await consolidate(existing, candidates)
                if len(candidates) < before:
                    ctx.log(
                        f"{group or 'ungrouped'}: {before - len(candidates)} reworded duplicate(s) dropped"
                    )
                same += before - len(candidates)
            done += 1
            with ctx.session_factory() as db:
                now = utc_now_naive()
                for rule in candidates:
                    primary = by_key[rule["category_keys"][0]]
                    rule_id = str(uuid4())
                    db.add(
                        FactoryRule(
                            id=rule_id,
                            factory_id=ctx.factory_id,
                            category_id=primary.id,
                            group_value=group,
                            title=rule["title"],
                            description=rule["description"],
                            body=rule["body"],
                            official=False,
                            kind=rule["kind"],
                            source="agent",
                            evidence=rule["evidence"],
                            job_id=ctx.job_id,
                            created_at=now,
                            updated_at=now,
                        )
                    )
                    for k in rule["category_keys"][1:]:
                        db.add(
                            FactoryRuleLink(
                                id=str(uuid4()),
                                rule_id=rule_id,
                                category_id=by_key[k].id,
                                role="category",
                            )
                        )
                    for k in rule["bridge_keys"]:
                        db.add(
                            FactoryRuleLink(
                                id=str(uuid4()),
                                rule_id=rule_id,
                                category_id=by_key[k].id,
                                role="bridge",
                            )
                        )
                    added += 1
                db.commit()
            skipped += same
            ctx.commit(
                message=f"{done} of {total} model calls done",
                done=done,
                rules_added=added,
                rules_skipped=skipped,
            )
    finally:
        try:
            await client.close()
        except Exception:  # noqa: BLE001
            pass
    ctx.log(f"Done: {added} rule(s) added, {skipped} duplicate(s) skipped")
    ctx.commit(
        message=f"{added} rules added",
        done=done,
        rules_added=added,
        rules_skipped=skipped,
    )


# ── Generation ───────────────────────────────────────────────────────────────


def _free_output_slug(db: Session, project_id: str, base_slug: str) -> Tuple[str, int]:
    taken = {
        slug
        for (slug,) in db.query(Dataset.slug).filter(
            Dataset.project_id == project_id, Dataset.slug.like(f"{base_slug}-gen-%")
        )
    }
    n = 1
    while f"{base_slug}-gen-{n}" in taken:
        n += 1
    return f"{base_slug}-gen-{n}", n


def create_output_dataset(
    db: Session,
    *,
    factory: DataFactory,
    source: Dataset,
    source_version: DatasetVersion,
    job: JobContext,
    name: Optional[str],
) -> Tuple[Dataset, DatasetVersion]:
    """A new dataset (draft ``v1``) for the generated items, with the source's access settings."""
    now = utc_now_naive()
    slug, n = _free_output_slug(db, source.project_id, source.slug)
    dataset_name = name or f"{source.name} generated {n}"
    taken_names = {
        row_name.lower()
        for (row_name,) in db.query(Dataset.name).filter(
            Dataset.project_id == source.project_id, Dataset.deleted_at.is_(None)
        )
    }
    if dataset_name.lower() in taken_names:
        dataset_name = f"{dataset_name} ({slug})"
    params = job.params
    dataset = Dataset(
        id=str(uuid4()),
        project_id=source.project_id,
        name=dataset_name[:200],
        slug=slug,
        description=(
            f"Generated by the data factory from {source.name} {source_version.version}: "
            f"up to {params.get('max_layers')} rule layer(s), {params.get('branching')} variation(s) per item and layer"
            f"{', official rules only' if params.get('official_only') else ''}."
        ),
        tags=["factory"],
        private_test_set=False,
        access_mode=source.access_mode or "project",
        created_by_user_id=job.requested_by_user_id or factory.created_by_user_id,
        created_at=now,
        updated_at=now,
    )
    db.add(dataset)
    db.flush()
    for grant in (
        db.query(DatasetGrant).filter(DatasetGrant.dataset_id == source.id).all()
    ):
        db.add(
            DatasetGrant(
                dataset_id=dataset.id,
                user_id=grant.user_id,
                level=grant.level,
                granted_by_user_id=grant.granted_by_user_id,
                created_at=now,
                updated_at=now,
            )
        )
    version = DatasetVersion(
        id=str(uuid4()),
        dataset_id=dataset.id,
        version="v1",
        name="",
        description=f"Factory job {job.job_id}",
        status=DatasetVersionStatus.DRAFT,
        source_type="factory",
        source_uri=f"factory:{factory.id}/jobs/{job.job_id}",
        labels=[],
        item_count=0,
        created_by_user_id=dataset.created_by_user_id,
        created_at=now,
        updated_at=now,
    )
    db.add(version)
    db.flush()
    db.add(
        DatasetVersionChange(
            dataset_version_id=version.id,
            parent_version_id=None,
            change_summary={
                "type": "created",
                "from_version_id": None,
                "factory_job_id": job.job_id,
            },
            created_at=now,
        )
    )
    return dataset, version


class _Node:
    """One item of the generation tree: a base item or a generated one.

    ``open`` is the set of category ids the next rule may come from: empty on
    a base item (any rule), then the categories of the applied rules plus the
    targets of the applied bridges.
    """

    __slots__ = (
        "item_id",
        "base_item_id",
        "input",
        "expected",
        "metadata",
        "group",
        "applied",
        "open",
    )

    def __init__(
        self,
        item_id: str,
        base_item_id: str,
        input_value: Any,
        expected: Any,
        metadata: Dict[str, Any],
        group: str,
        applied: List[FactoryRule],
        open_categories: Optional[set[str]] = None,
    ):
        self.item_id = item_id
        self.base_item_id = base_item_id
        self.input = input_value
        self.expected = expected
        self.metadata = metadata
        self.group = group
        self.applied = applied
        self.open = set(open_categories or ())


def _insert_generated(
    db: Session, version_id: str, rows: List[Dict[str, Any]], start_index: int
) -> None:
    table = DatasetItem.__table__
    now = utc_now_naive()
    batch = []
    for offset, row in enumerate(rows):
        fingerprint = build_identity_fingerprint(
            input_value=row["input"],
            expected_value=row["expected_output"],
            metadata=row["metadata"],
        )
        batch.append(
            {
                "dataset_version_id": version_id,
                "item_id": row["item_id"],
                "index": start_index + offset,
                "input": row["input"],
                "expected_output": row["expected_output"],
                "metadata": row["metadata"],
                "labels": [],
                "fingerprint": fingerprint,
                "search_text": dataset_item_search_text(
                    row["item_id"],
                    row["input"],
                    row["expected_output"],
                    row["metadata"],
                ),
                "created_at": now,
                "updated_at": now,
            }
        )
        if len(batch) >= _INSERT_BATCH:
            db.execute(insert(table), batch)
            batch = []
    if batch:
        db.execute(insert(table), batch)


async def _run_generation(ctx: JobContext) -> None:
    settings = PlatformSettings()
    params = ctx.params
    max_layers = int(params.get("max_layers") or 1)
    branching = int(params.get("branching") or 1)
    max_items = int(params.get("max_items") or GENERATION_DEFAULTS["max_items"])
    official_only = bool(params.get("official_only", True))
    with ctx.session_factory() as db:
        factory, source, version = _load_factory(db, ctx.factory_id)
        conn = llm_connection_for(db, factory)
        key = factory.group_metadata_key
        instructions = factory.generation_instructions or ""
        rules_query = db.query(FactoryRule).filter(FactoryRule.factory_id == factory.id)
        if official_only:
            rules_query = rules_query.filter(FactoryRule.official.is_(True))
        rules = rules_query.order_by(FactoryRule.created_at, FactoryRule.id).all()
        categories = {
            c.id: c
            for c in db.query(FactoryRuleCategory).filter(
                FactoryRuleCategory.factory_id == factory.id
            )
        }
        extra_links, bridge_links = rule_category_map(db, [r.id for r in rules])
        items = source_items(db, version.id)
        db.expunge_all()
    rule_categories = {r.id: {r.category_id, *extra_links.get(r.id, [])} for r in rules}
    rule_bridges = {
        r.id: set(bridge_links.get(r.id, [])) if r.kind == "bridge" else set()
        for r in rules
    }

    def category_names(ids: set[str]) -> List[str]:
        return sorted(categories[c].name for c in ids if c in categories)

    def category_keys(ids: set[str]) -> List[str]:
        return sorted(categories[c].key for c in ids if c in categories)

    if not rules:
        raise FactoryConfigError(
            "No official rule to apply. Approve rules first, or allow non-official rules."
            if official_only
            else "The factory has no rule to apply. Run the analysis first."
        )
    if not items:
        raise FactoryConfigError(
            f"Version {version.version} of the dataset has no active items"
        )
    wanted_groups = params.get("group_values")
    rules_by_group: Dict[str, List[FactoryRule]] = {}
    for rule in rules:
        rules_by_group.setdefault(rule.group_value, []).append(rule)

    def applicable(node: _Node) -> List[FactoryRule]:
        """The rules of the item's group (and the global ones) not yet applied, within its open categories."""
        done_ids = {r.id for r in node.applied}
        pool = list(rules_by_group.get(node.group, []))
        if key and node.group != UNGROUPED:
            pool += rules_by_group.get(UNGROUPED, [])
        return [
            r
            for r in pool
            if r.id not in done_ids
            and (not node.open or rule_categories[r.id] & node.open)
        ]

    frontier: List[_Node] = []
    for item in items:
        group = group_value_of(item.item_metadata, key)
        if wanted_groups and group not in set(wanted_groups):
            continue
        frontier.append(
            _Node(
                item.item_id,
                item.item_id,
                item.input,
                item.expected_output,
                dict(item.item_metadata or {}),
                group,
                [],
            )
        )
    if not frontier:
        raise FactoryConfigError("No base item matches the chosen groups")
    rng = random.Random(ctx.job_id)
    client, model = build_client(conn)
    semaphore = asyncio.Semaphore(settings.factory_llm_concurrency)
    generated = 0
    failed_calls = 0
    existing_ids: set[str] = set()
    try:
        with ctx.session_factory() as db:
            factory_row = db.get(DataFactory, ctx.factory_id)
            source_row = db.get(Dataset, source.id)
            version_row = db.get(DatasetVersion, version.id)
            if ctx.output_dataset_id:
                output = db.get(Dataset, ctx.output_dataset_id)
                out_version = (
                    db.query(DatasetVersion)
                    .filter(DatasetVersion.dataset_id == output.id)
                    .first()
                    if output
                    else None
                )
                if output is None or out_version is None:
                    raise FactoryConfigError(
                        "The output dataset of this job was deleted"
                    )
                generated = int(out_version.item_count or 0)
                # A resumed job (lost lease) never writes an item id twice.
                existing_ids = {
                    item_id
                    for (item_id,) in db.query(DatasetItem.item_id).filter(
                        DatasetItem.dataset_version_id == out_version.id
                    )
                }
            else:
                output, out_version = create_output_dataset(
                    db,
                    factory=factory_row,
                    source=source_row,
                    source_version=version_row,
                    job=ctx,
                    name=params.get("dataset_name"),
                )
                db.commit()
            ctx.output_dataset_id = output.id
            output_id, out_version_id, output_name = (
                output.id,
                out_version.id,
                output.name,
            )
            db.expunge_all()
        ctx.log(
            f"Generating from {len(frontier)} base item(s) of {source.name} {version.version} "
            f"with {len(rules)} rule(s) into {output_name}: up to {max_layers} layer(s), "
            f"{branching} per item and layer, at most {max_items} items"
        )
        ctx.commit(
            message="Starting",
            source_version=version.version,
            output_dataset_id=output_id,
            output_dataset_name=output_name,
            layer=0,
            layers=max_layers,
            generated=generated,
            max_items=max_items,
            base_items=len(frontier),
            rules=len(rules),
            failed_calls=0,
        )

        async def child(
            parent: _Node, rule: FactoryRule, n: int
        ) -> Optional[Dict[str, Any]]:
            prompt = generation_prompt(
                base_input=parent.input,
                base_expected=parent.expected,
                applied=parent.applied,
                rule=rule,
                category_names=category_names(rule_categories[rule.id]),
                bridge_names=category_names(rule_bridges[rule.id]),
                instructions=instructions,
            )
            try:
                async with semaphore:
                    answer = await complete_json(
                        client, model, GENERATION_SYSTEM, prompt, temperature=0.7
                    )
            except (
                Exception
            ) as exc:  # noqa: BLE001 - one failed call never fails the job
                ctx.log(
                    f"{parent.item_id} + {rule.title}: model call failed ({type(exc).__name__}: {str(exc)[:200]})"
                )
                return None
            if "input" not in answer:
                ctx.log(
                    f"{parent.item_id} + {rule.title}: the model answered without an input"
                )
                return None
            layer = len(parent.applied) + 1
            applied = parent.applied + [rule]
            open_categories = (
                parent.open | rule_categories[rule.id] | rule_bridges[rule.id]
            )
            metadata = dict(parent.metadata)
            metadata["factory"] = {
                "job_id": ctx.job_id,
                "layer": layer,
                "base_item_id": parent.base_item_id,
                "parent_item_id": parent.item_id,
                "rule_ids": [r.id for r in applied],
                "rule_titles": [r.title for r in applied],
                "bridges": [r.title for r in applied if r.kind == "bridge"],
                "categories": category_keys(open_categories),
                "note": str(answer.get("note") or "")[:500],
            }
            return {
                "item_id": f"{parent.item_id}~L{layer}.{n}",
                "input": answer.get("input"),
                "expected_output": answer.get("expected_output"),
                "metadata": metadata,
                "node": _Node(
                    f"{parent.item_id}~L{layer}.{n}",
                    parent.base_item_id,
                    answer.get("input"),
                    answer.get("expected_output"),
                    metadata,
                    parent.group,
                    applied,
                    open_categories,
                ),
            }

        for layer in range(1, max_layers + 1):
            if generated >= max_items or not frontier:
                break
            next_frontier: List[_Node] = []
            batch_parents = max(
                1,
                settings.factory_llm_concurrency
                // max(1, min(branching, settings.factory_llm_concurrency)),
            )
            for start in range(0, len(frontier), batch_parents):
                if generated >= max_items:
                    break
                parents = frontier[start : start + batch_parents]
                tasks = []
                for parent in parents:
                    pool = applicable(parent)
                    if not pool:
                        continue
                    chosen = rng.sample(pool, min(branching, len(pool)))
                    for n, rule in enumerate(chosen, start=1):
                        if generated + len(tasks) >= max_items:
                            break
                        tasks.append(child(parent, rule, n))
                if not tasks:
                    continue
                results = await asyncio.gather(*tasks)
                rows = [
                    r
                    for r in results
                    if r is not None and r["item_id"] not in existing_ids
                ]
                failed_calls += sum(1 for r in results if r is None)
                if rows:
                    with ctx.session_factory() as db:
                        _insert_generated(
                            db,
                            out_version_id,
                            [
                                {k: v for k, v in row.items() if k != "node"}
                                for row in rows
                            ],
                            generated,
                        )
                        out_version = db.get(DatasetVersion, out_version_id)
                        generated += len(rows)
                        if out_version is not None:
                            out_version.item_count = generated
                            out_version.updated_at = utc_now_naive()
                        output = db.get(Dataset, output_id)
                        if output is not None:
                            output.updated_at = utc_now_naive()
                        db.commit()
                    next_frontier.extend(row["node"] for row in rows)
                ctx.commit(
                    message=f"Layer {layer} of {max_layers}: {generated} item(s) generated",
                    layer=layer,
                    generated=generated,
                    failed_calls=failed_calls,
                )
            ctx.log(f"Layer {layer}: {len(next_frontier)} item(s) generated")
            frontier = next_frontier
    finally:
        try:
            await client.close()
        except Exception:  # noqa: BLE001
            pass
    ctx.log(
        f"Done: {generated} item(s) in {output_name}"
        + (f", {failed_calls} failed call(s)" if failed_calls else "")
    )
    ctx.commit(
        message=f"{generated} items generated",
        generated=generated,
        failed_calls=failed_calls,
    )


__all__ = [
    "ANALYSIS_SAMPLE_DEFAULT",
    "DEFAULT_CATEGORY_DESCRIPTION",
    "DEFAULT_CATEGORY_KEY",
    "DEFAULT_CATEGORY_NAME",
    "FactoryConfigError",
    "FactoryWorker",
    "GENERATION_DEFAULTS",
    "MAX_BRANCHING",
    "MAX_ITEMS_PER_JOB",
    "MAX_LAYERS",
    "UNGROUPED",
    "active_job",
    "body_problem",
    "check_json_schema",
    "claim_job",
    "complete_json",
    "factory_access_level",
    "factory_access_levels",
    "factory_level_at_least",
    "group_value_of",
    "llm_connection_for",
    "metadata_key_choices",
    "normalize_title",
    "rule_category_map",
    "queue_job",
    "request_cancel",
    "resolve_source_version",
    "run_job",
    "slugify_key",
    "source_items",
    "validate_params",
]
