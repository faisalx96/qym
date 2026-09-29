"""Resolve model-slot bindings to real values at dispatch time (plan §7.4, R3).

A config document binds each model slot (``eval_model_slots``) to a project model
(``{"connection_id": …}``), a temporary model (``{"temporary": {…}}``, §7.5) or nothing
(``{"inherit": true}``/``null``: the slot is omitted and the worker keeps its own env).
``eval_config`` materializes bound slots as placeholders; this module turns them into
the connection's **current** model, base URL and decrypted key.

Entry points:

- ``resolve_slot_bindings(db, environment, slot_bindings, slots)`` → ``SlotResolution``.
  Reads every referenced ``ProjectLlmConnection`` fresh from the database (nothing is
  cached), so a rotated key or a changed model is picked up on the next dispatch or
  retry. ``decrypt=False`` performs the same checks without decrypting, which is what
  launch-time validation (#13) wants; ``SlotResolution.to_errors()`` yields
  ``eval_config``-shaped error objects for it.
- ``SlotResolution.resolver`` is an ``eval_config.BindingResolver`` for
  ``materialize_job_body``; ``SlotResolution.fill_placeholders(body)`` resolves a body
  that was materialized earlier with placeholders (the stored ``request_body``).
- ``prepare_dispatch(...)`` does both steps for the dispatcher (#15) and returns a
  ``DispatchPreparation``: either a ready body or the problems that block the job.
- ``mark_job_blocked(job, problems)`` applies a blocking outcome to a job row
  (``BLOCKED`` + ``wait_reason``). Resolution itself never writes to the database; the
  dispatcher decides when to call this and owns the transaction and the lease.
- ``connection_options(db, environment, slots)`` is the model picker's data (#23): each
  experiment connection with ``available``/``reason`` overall and per slot.

Blocking problems (``BindingProblem.code``), each with a user-facing message:

``connection_missing``      deleted (or from another project): ``Model "X" no longer exists``
``connection_unavailable``  ``available_for_experiments`` was turned off
``connection_no_model``     the connection has no model name
``keys_not_allowed``        a key would be sent to an env without ``allow_connection_keys``
``key_unavailable``         the stored key cannot be decrypted (or encryption is off)
``temporary_key_missing``   a temporary model's key is no longer stored (re-enter it)
``invalid_binding``         the binding is malformed or still a sweep

Key policy (``allow_connection_keys``, D1). A key is "sent" when the slot maps an
``api_key`` field and the bound model has a key. Without the opt-in such a binding is
refused as a whole: model and base URL are **not** sent without the key, because the
worker would then call the connection's base URL with its own inherited key (leaking
the environment's key to a user-chosen URL, or silently using the wrong account). A
binding that sends no key is allowed on any environment: a slot without an ``api_key``
field (e.g. a model-only flat slot, which sends just the model name), or a connection
that stores no key (e.g. a keyless local endpoint). Temporary-model keys follow the
same opt-in (§7.5).

Secrets: decrypted keys live only inside ``SlotResolution`` (hidden from ``repr``) and
the in-memory body returned by the resolver/``fill_placeholders``/``prepare_dispatch``
(``DispatchPreparation`` hides it from ``repr`` too). They are never logged, never put
in messages or exceptions, and never written to a job row.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Optional, Sequence

from sqlalchemy.orm import Session

from ..db.models import (
    EvalEnvironment,
    EvalExperimentJob,
    EvalJobStatus,
    ProjectLlmConnection,
)
from ..secrets import decrypt_llm_api_key
from ..settings import PlatformSettings
from .eval_config import (  # _PLACEHOLDER: the one placeholder grammar
    _PLACEHOLDER,
    BindingResolver,
    _slot_for,
    _slot_index,
    binding_kind,
    is_sweep,
)
from .eval_schema_form import escape_pointer_segment
from .llm_connections import list_experiment_connections

WAIT_REASON_MAX = 200  # EvalExperimentJob.wait_reason is String(200)
KEY_ROLE = "api_key"

KEYS_NOT_ALLOWED_REASON = (
    "This environment does not accept model API keys. A manager can enable "
    '"Allow connection keys" in its settings.'
)
NO_MODEL_REASON = "This model has no model name"

SecretLookup = Callable[[str], Optional[str]]
"""``lookup(ref) -> key | None`` for temporary-model ``{"$secret": ref}`` keys (#12)."""


class BindingResolutionError(RuntimeError):
    """A binding was used although it did not resolve. Never carries a secret."""


@dataclass(frozen=True)
class BindingProblem:
    """Why one slot binding cannot be dispatched. Contains no secret."""

    slot_key: str
    code: str
    message: str

    def to_error(self) -> dict[str, Any]:
        """An ``eval_config`` error object (section ``slot_bindings``)."""
        pointer = "/slot_bindings/" + escape_pointer_segment(self.slot_key)
        return {
            "section": "slot_bindings",
            "pointer": pointer,
            "form_pointer": pointer,
            "field": None,
            "params": {},
            "rule": "binding",
            "code": self.code,
            "message": self.message,
            "slot_key": self.slot_key,
        }

    def to_dict(self) -> dict[str, str]:
        return {"slot_key": self.slot_key, "code": self.code, "message": self.message}


class _ResolvedSlot:
    """Real values for one bound slot; ``repr`` never shows the key."""

    __slots__ = ("kind", "model", "base_url", "_api_key", "display")

    def __init__(
        self,
        kind: str,
        model: str,
        base_url: Optional[str],
        api_key: Optional[str],
        display: dict[str, Any],
    ) -> None:
        self.kind = kind
        self.model = model
        self.base_url = base_url or None
        self._api_key = api_key or None
        self.display = display

    def value(self, role: str) -> Any:
        if role == "model":
            return self.model
        if role == "base_url":
            return self.base_url
        if role == KEY_ROLE:
            return self._api_key
        return None

    def __repr__(self) -> str:
        return f"_ResolvedSlot(kind={self.kind!r}, model={self.model!r})"


def _join_reasons(problems: Sequence[BindingProblem]) -> str:
    return "; ".join(dict.fromkeys(p.message for p in problems))


def wait_reason_for(problems: Sequence[BindingProblem]) -> str:
    """The short ``wait_reason`` shown in the queue (fits ``String(200)``)."""
    reason = _join_reasons(problems) or "Model binding could not be resolved"
    if len(reason) > WAIT_REASON_MAX:
        reason = reason[: WAIT_REASON_MAX - 1] + "…"
    return reason


@dataclass
class SlotResolution:
    """Outcome of ``resolve_slot_bindings``.

    ``problems`` block dispatch. ``models`` is a secret-free summary per bound slot
    (``{"kind", "model", "base_url", "connection_id"/"label", "name"}``), safe for
    ``params``/logs. Inherited slots appear in neither.
    """

    problems: list[BindingProblem] = field(default_factory=list)
    models: dict[str, dict[str, Any]] = field(default_factory=dict)
    _slots: dict[str, _ResolvedSlot] = field(default_factory=dict, repr=False)

    @property
    def ok(self) -> bool:
        return not self.problems

    @property
    def wait_reason(self) -> Optional[str]:
        return wait_reason_for(self.problems) if self.problems else None

    def to_errors(self) -> list[dict[str, Any]]:
        return [p.to_error() for p in self.problems]

    def value(self, slot_key: str, role: str) -> Any:
        slot = self._slots.get(slot_key)
        if slot is None:
            raise BindingResolutionError(
                f"Model slot {slot_key!r} has no resolved binding"
            )
        return slot.value(role)

    @property
    def resolver(self) -> BindingResolver:
        """A ``BindingResolver`` for ``materialize_job_body``.

        Raises ``BindingResolutionError`` for a slot that did not resolve, so a
        blocked binding can never be materialized by mistake.
        """

        def resolve(slot_key: str, binding: Mapping[str, Any], role: str) -> Any:
            return self.value(slot_key, role)

        return resolve

    def fill_placeholders(self, body: Mapping[str, Any]) -> dict[str, Any]:
        """A copy of ``body`` with every ``{{qym:slot:…}}`` placeholder resolved.

        A placeholder whose value is unset (no base URL, no key) is removed, so the
        field inherits. Raises ``BindingResolutionError`` for a placeholder of a slot
        that did not resolve.
        """

        def walk(value: Any) -> Any:
            if isinstance(value, Mapping):
                out = {}
                for key, child in value.items():
                    resolved = walk(child)
                    if resolved is not _UNSET:
                        out[key] = resolved
                return out
            if isinstance(value, list):
                return [None if v is _UNSET else v for v in map(walk, value)]
            match = _PLACEHOLDER.match(value) if isinstance(value, str) else None
            if match:
                resolved = self.value(match.group("slot"), match.group("role"))
                return _UNSET if resolved is None else resolved
            return value

        return walk(copy.deepcopy(dict(body)))

    def unresolved_slots(self, body: Any) -> list[str]:
        """Slot keys that have placeholders in ``body`` but no resolved binding."""
        return sorted({s for s in _placeholder_slot_keys(body) if s not in self._slots})


_UNSET = object()


def _display_name(binding: Mapping[str, Any], fallback: str) -> str:
    name = binding.get("name")
    return name if isinstance(name, str) and name.strip() else fallback


def _slot_sends_key(
    slot_key: str,
    index: dict[str, dict[str, Any]],
    descriptor: Optional[Mapping[str, Any]],
) -> bool:
    """Whether the slot maps an ``api_key`` field. Unknown slots count as yes."""
    slot = _slot_for(slot_key, index, descriptor or {})
    if slot is None:
        return True  # fail closed
    pointer = slot["field_map"].get(KEY_ROLE)
    return isinstance(pointer, str) and bool(pointer)


def resolve_slot_bindings(
    db: Session,
    environment: EvalEnvironment,
    slot_bindings: Optional[Mapping[str, Any]],
    slots: Sequence[Any] = (),
    *,
    descriptor: Optional[Mapping[str, Any]] = None,
    secret_lookup: Optional[SecretLookup] = None,
    decrypt: bool = True,
    settings: Optional[PlatformSettings] = None,
) -> SlotResolution:
    """Resolve one combination's ``slot_bindings`` for ``environment``.

    ``slots`` are the environment schema's slot rows or dicts; ``descriptor`` is only
    needed for extra endpoint slots missing from them. Connections are looked up in
    the environment's project only. ``secret_lookup`` resolves temporary-model key refs
    (#12); without it such keys count as missing. ``decrypt=False`` skips decryption
    (launch-time checks), and the resolver then returns no keys.
    """
    result = SlotResolution()
    if not isinstance(slot_bindings, Mapping):
        return result
    index = _slot_index(slots)
    allow_keys = bool(environment.allow_connection_keys)

    connection_ids = {
        b["connection_id"]
        for b in slot_bindings.values()
        if binding_kind(b) == "connection" and isinstance(b.get("connection_id"), str)
    }
    connections: dict[str, ProjectLlmConnection] = {}
    if connection_ids:
        rows = (
            db.query(ProjectLlmConnection)
            .filter(
                ProjectLlmConnection.project_id == environment.project_id,
                ProjectLlmConnection.id.in_(sorted(connection_ids)),
            )
            .all()
        )
        connections = {row.id: row for row in rows}

    def problem(slot_key: str, code: str, message: str) -> None:
        result.problems.append(BindingProblem(slot_key, code, message))

    for slot_key, binding in slot_bindings.items():
        slot_key = str(slot_key)
        kind = binding_kind(binding)
        if kind == "inherit":
            continue
        if kind is None:
            problem(
                slot_key,
                "invalid_binding",
                (
                    f"Model slot {slot_key!r} still holds a sweep"
                    if is_sweep(binding)
                    else f"Model slot {slot_key!r} has an invalid binding"
                ),
            )
            continue
        sends_key_field = _slot_sends_key(slot_key, index, descriptor)

        if kind == "connection":
            cid = binding.get("connection_id")
            name = _display_name(binding, str(cid))
            conn = connections.get(cid) if isinstance(cid, str) else None
            if conn is None:
                problem(
                    slot_key, "connection_missing", f'Model "{name}" no longer exists'
                )
                continue
            name = conn.name or name
            if not conn.available_for_experiments:
                problem(
                    slot_key,
                    "connection_unavailable",
                    f'Model "{name}" is no longer available for experiments',
                )
                continue
            if not (conn.llm_model or "").strip():
                problem(
                    slot_key, "connection_no_model", f'Model "{name}" has no model name'
                )
                continue
            has_key = bool(conn.llm_api_key_encrypted)
            if sends_key_field and has_key and not allow_keys:
                problem(
                    slot_key,
                    "keys_not_allowed",
                    f'Model "{name}" needs its API key, but this environment does '
                    "not accept model keys",
                )
                continue
            api_key: Optional[str] = None
            if sends_key_field and has_key and decrypt:
                try:
                    api_key = decrypt_llm_api_key(conn.llm_api_key_encrypted, settings)
                except Exception:  # never surface the cause: it may echo the token
                    problem(
                        slot_key,
                        "key_unavailable",
                        f'The API key of model "{name}" could not be decrypted',
                    )
                    continue
            display = {
                "kind": "connection",
                "connection_id": conn.id,
                "name": conn.name,
                "model": conn.llm_model.strip(),
                "base_url": conn.llm_base_url or None,
            }
            result._slots[slot_key] = _ResolvedSlot(
                "connection",
                conn.llm_model.strip(),
                conn.llm_base_url,
                api_key,
                display,
            )
            result.models[slot_key] = display
            continue

        # Temporary model (§7.5). Its secret storage is #12; keys come from the hook.
        temporary = binding.get("temporary")
        temporary = temporary if isinstance(temporary, Mapping) else {}
        model = temporary.get("model")
        label = temporary.get("label") or model or slot_key
        if not isinstance(model, str) or not model.strip():
            problem(
                slot_key,
                "invalid_binding",
                f'Temporary model "{label}" has no model name',
            )
            continue
        key_ref = temporary.get(KEY_ROLE)
        ref = key_ref.get("$secret") if isinstance(key_ref, Mapping) else None
        api_key = None
        if sends_key_field and ref is not None:
            if not allow_keys:
                problem(
                    slot_key,
                    "keys_not_allowed",
                    f'Temporary model "{label}" needs its API key, but this '
                    "environment does not accept model keys",
                )
                continue
            if decrypt:
                try:
                    api_key = secret_lookup(ref) if secret_lookup else None
                except Exception:  # the hook's error may carry the secret blob
                    api_key = None
                if not isinstance(api_key, str) or not api_key:
                    problem(
                        slot_key,
                        "temporary_key_missing",
                        f'The API key of temporary model "{label}" is no longer '
                        "stored; enter it again",
                    )
                    continue
        base_url = temporary.get("base_url")
        display = {
            "kind": "temporary",
            "label": label,
            "model": model.strip(),
            "base_url": base_url if isinstance(base_url, str) and base_url else None,
        }
        result._slots[slot_key] = _ResolvedSlot(
            "temporary",
            model.strip(),
            display["base_url"],
            api_key,
            display,
        )
        result.models[slot_key] = display
    return result


# --------------------------------------------------------------------------- dispatch


@dataclass
class DispatchPreparation:
    """``body`` is ready to submit (holds decrypted keys, hidden from ``repr``) when
    ``ok``; otherwise ``problems``/``wait_reason`` say why the job is blocked."""

    body: Optional[dict[str, Any]] = field(default=None, repr=False)
    problems: list[BindingProblem] = field(default_factory=list)
    models: dict[str, dict[str, Any]] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.problems and self.body is not None

    @property
    def wait_reason(self) -> Optional[str]:
        return wait_reason_for(self.problems) if self.problems else None


def prepare_dispatch(
    db: Session,
    environment: EvalEnvironment,
    *,
    body: Mapping[str, Any],
    slot_bindings: Optional[Mapping[str, Any]],
    slots: Sequence[Any] = (),
    descriptor: Optional[Mapping[str, Any]] = None,
    secret_lookup: Optional[SecretLookup] = None,
    settings: Optional[PlatformSettings] = None,
) -> DispatchPreparation:
    """Resolve a stored placeholder ``body`` (the job's ``request_body``) for submit.

    Call on every submit attempt (never cache the result): that is what picks up a
    rotated key and notices a deleted connection. On problems apply
    ``mark_job_blocked(job, prep.problems)``. The returned body must only be handed to
    the service client; never store or log it.
    """
    resolution = resolve_slot_bindings(
        db,
        environment,
        slot_bindings,
        slots,
        descriptor=descriptor,
        secret_lookup=secret_lookup,
        settings=settings,
    )
    if not resolution.ok:
        return DispatchPreparation(
            problems=resolution.problems, models=resolution.models
        )
    # A placeholder of a slot the combination does not bind means the stored body and
    # its bindings disagree: block instead of submitting a literal placeholder.
    unresolved = resolution.unresolved_slots(body)
    if unresolved:
        return DispatchPreparation(
            problems=[
                BindingProblem(
                    key, "invalid_binding", f"Model slot {key!r} has no binding"
                )
                for key in unresolved
            ],
            models=resolution.models,
        )
    return DispatchPreparation(
        body=resolution.fill_placeholders(body), models=resolution.models
    )


def _placeholder_slot_keys(value: Any) -> set[str]:
    if isinstance(value, Mapping):
        value = list(value.values())
    if isinstance(value, list):
        return set().union(*(_placeholder_slot_keys(v) for v in value))
    match = _PLACEHOLDER.match(value) if isinstance(value, str) else None
    return {match.group("slot")} if match else set()


def mark_job_blocked(
    job: EvalExperimentJob, problems: Sequence[BindingProblem]
) -> None:
    """Move ``job`` to ``BLOCKED`` with a ``wait_reason`` (does not flush/commit).

    ``error`` keeps the full, untruncated message list. Clearing the lease is left to
    the dispatcher, which owns it.
    """
    job.status = EvalJobStatus.BLOCKED
    job.wait_reason = wait_reason_for(problems)
    job.error = _join_reasons(problems) or job.wait_reason
    job.next_attempt_at = None


# --------------------------------------------------------------------------- picker


def _connection_slot_state(
    conn: ProjectLlmConnection, allow_keys: bool, sends_key_field: bool
) -> tuple[bool, Optional[str], Optional[str]]:
    if not (conn.llm_model or "").strip():
        return False, "connection_no_model", NO_MODEL_REASON
    if sends_key_field and conn.llm_api_key_encrypted and not allow_keys:
        return False, "keys_not_allowed", KEYS_NOT_ALLOWED_REASON
    return True, None, None


def connection_options(
    db: Session,
    environment: EvalEnvironment,
    slots: Sequence[Any] = (),
    *,
    descriptor: Optional[Mapping[str, Any]] = None,
) -> dict[str, Any]:
    """Model-picker data for one environment (#23). Secret-free.

    Lists the project's ``available_for_experiments`` connections. Each option has
    ``available``/``reason_code``/``reason`` for a slot with an API-key field (the usual
    endpoint slot) and, per slot in ``slots``, the same triple under ``slots``. Also
    returns ``temporary_keys_allowed`` and its ``temporary_keys_reason`` for the
    "+ Temporary model" form.
    """
    allow_keys = bool(environment.allow_connection_keys)
    index = _slot_index(slots)
    slot_keys = list(index)
    options = []
    for conn in list_experiment_connections(db, environment.project_id):
        available, code, reason = _connection_slot_state(conn, allow_keys, True)
        per_slot = {}
        for key in slot_keys:
            ok, slot_code, slot_reason = _connection_slot_state(
                conn, allow_keys, _slot_sends_key(key, index, descriptor)
            )
            per_slot[key] = {
                "available": ok,
                "reason_code": slot_code,
                "reason": slot_reason,
            }
        options.append(
            {
                "connection_id": conn.id,
                "name": conn.name,
                "model": conn.llm_model,
                "base_url": conn.llm_base_url or None,
                "api_key_set": bool(conn.llm_api_key_encrypted),
                "api_key_hint": (
                    "••••" + conn.llm_api_key_last4 if conn.llm_api_key_last4 else ""
                ),
                "is_default": bool(conn.is_default),
                "available": available,
                "reason_code": code,
                "reason": reason,
                "slots": per_slot,
            }
        )
    return {
        "environment_id": environment.id,
        "allow_connection_keys": allow_keys,
        "temporary_keys_allowed": allow_keys,
        "temporary_keys_reason": None if allow_keys else KEYS_NOT_ALLOWED_REASON,
        "connections": options,
    }
