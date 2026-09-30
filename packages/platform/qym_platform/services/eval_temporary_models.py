"""Temporary models: a model/base URL/key used by one experiment only (plan §7.5, #12).

A slot binding ``{"temporary": {"label", "model", "base_url", "api_key": {"$secret": ref}}}``
names its key by an opaque ``ref``; the launch request carries the raw keys separately
as ``secrets: {ref: key}``. This module:

- validates temporary bindings for a launch (``temporary_binding_errors``): the base
  URL goes through ``validate_llm_base_url`` (as for project connections) and every
  referenced key must be supplied;
- stores the keys Fernet-encrypted in ``EvalExperiment.secrets_encrypted`` as JSON
  ``{ref: key}`` (``encrypt_secrets``/``decrypt_secrets``/``secret_lookup``), using the
  ``QYM_LLM_CONFIG_ENCRYPTION_KEY`` helper of LLM connections, and refuses to store keys
  without it;
- turns a temporary model into a ``ProjectLlmConnection`` ("Save to project models");
- works out which keys a retry must ask for again (``missing_retry_keys``);
- unbinds temporary slots of a stored config for a best-run reload (``unbind_temporary``,
  #38), since the key is gone by then.

Clearing the blob once every current job has settled lives in
``eval_experiments.clear_secrets_when_settled`` (called whenever the aggregate status is
recomputed).

Where a temporary model shows up:

- ``job.params["slot_bindings"]`` keeps the ``{"$secret": ref}`` ref (never the key):
  the dispatcher resolves it through ``secret_lookup``. Every API response strips refs.
- ``spec`` and ``qym_config`` hold ``{"temporary": {"label", "model", "base_url"}}``.
- Clones and presets copy label/model/base URL only.

Keys are never logged, returned, audited, or put in an error message.
"""

from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass
from typing import Any, Dict, Iterator, List, Mapping, Optional, Tuple

from sqlalchemy.orm import Session

from ..db.models import EvalExperiment, ProjectLlmConnection
from ..llm_endpoint_security import LlmEndpointValidationError, validate_llm_base_url
from ..secrets import (
    build_llm_config_storage,
    decrypt_llm_api_key,
    encrypt_llm_api_key,
    encryption_available,
)
from ..settings import PlatformSettings
from .eval_config import binding_kind, is_sweep
from .eval_schema_form import escape_pointer_segment

KEY_ROLE = "api_key"
MAX_KEY_LENGTH = 4096
MAX_LABEL_LENGTH = 200  # ProjectLlmConnection.name
MAX_MODEL_LENGTH = 200  # ProjectLlmConnection.llm_model
MAX_BASE_URL_LENGTH = 500  # ProjectLlmConnection.llm_base_url
_REF_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")

UNBOUND_REASON = (
    "This run used a temporary model; pick a project model or enter its key again"
)


class TemporaryModelError(ValueError):
    """A temporary-model operation failed. The message never contains a key."""

    def __init__(self, status_code: int, message: str, code: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code


@dataclass(frozen=True)
class TemporaryBinding:
    slot_key: str
    temporary: Mapping[str, Any]

    @property
    def ref(self) -> Optional[str]:
        key = self.temporary.get(KEY_ROLE)
        ref = key.get("$secret") if isinstance(key, Mapping) else None
        return ref if isinstance(ref, str) else None

    @property
    def label(self) -> str:
        label = self.temporary.get("label") or self.temporary.get("model")
        return str(label) if label else self.slot_key

    def summary(self) -> Dict[str, Any]:
        """Secret-free ``{slot_key, label, model, base_url}``."""
        return {
            "slot_key": self.slot_key,
            "label": self.label,
            "model": self.temporary.get("model"),
            "base_url": self.temporary.get("base_url") or None,
        }


def stored_binding(binding: Mapping[str, Any]) -> Dict[str, Any]:
    """A temporary binding as stored in ``params``: known fields and a key *ref* only.

    Anything else, including a (rejected) literal key, is dropped, so an invalid
    request can't echo a key through the preview or be stored.
    """
    temporary = binding.get("temporary")
    temporary = temporary if isinstance(temporary, Mapping) else {}
    out = {k: temporary[k] for k in ("label", "model", "base_url") if k in temporary}
    key = temporary.get(KEY_ROLE)
    if isinstance(key, Mapping) and isinstance(key.get("$secret"), str):
        out[KEY_ROLE] = {"$secret": key["$secret"]}
    return {"temporary": copy.deepcopy(out)}


def iter_temporary_bindings(bindings: Any) -> Iterator[TemporaryBinding]:
    """Temporary bindings of ``slot_bindings``, including values inside a sweep."""
    if not isinstance(bindings, Mapping):
        return
    for slot_key, binding in bindings.items():
        values = binding["sweep"] if is_sweep(binding) else [binding]
        for value in values if isinstance(values, list) else []:
            if binding_kind(value) == "temporary" and isinstance(
                value.get("temporary"), Mapping
            ):
                yield TemporaryBinding(str(slot_key), value["temporary"])


def _error(slot_key: str, code: str, message: str) -> Dict[str, Any]:
    pointer = "/slot_bindings/" + escape_pointer_segment(slot_key)
    return {
        "section": "slot_bindings",
        "pointer": pointer,
        "form_pointer": pointer,
        "field": None,
        "params": {},
        "rule": "binding",
        "code": code,
        "message": message,
        "slot_key": slot_key,
        "environment_id": None,
    }


def _usable_key(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip()) and len(value) <= MAX_KEY_LENGTH


def temporary_binding_errors(
    spec: Mapping[str, Any],
    secrets: Mapping[str, Any],
    settings: Optional[PlatformSettings] = None,
) -> List[Dict[str, Any]]:
    """Launch checks for temporary models (environment independent).

    Codes: ``temporary_base_url_invalid``, ``temporary_key_ref_invalid``,
    ``temporary_key_required`` (a ref without a usable key in ``secrets``),
    ``temporary_field_too_long`` and ``encryption_unavailable``. The binding's shape is
    checked by ``eval_config``.
    """
    settings = settings or PlatformSettings()
    errors: List[Dict[str, Any]] = []
    needs_encryption = False
    for item in iter_temporary_bindings(spec.get("slot_bindings")):
        temporary = item.temporary
        for field, limit in (
            ("label", MAX_LABEL_LENGTH),
            ("model", MAX_MODEL_LENGTH),
            ("base_url", MAX_BASE_URL_LENGTH),
        ):
            value = temporary.get(field)
            if isinstance(value, str) and len(value) > limit:
                errors.append(
                    _error(
                        item.slot_key,
                        "temporary_field_too_long",
                        f"Temporary model {field} is longer than {limit} characters",
                    )
                )
        base_url = temporary.get("base_url")
        if isinstance(base_url, str) and base_url.strip():
            try:
                validate_llm_base_url(
                    base_url, allow_private=settings.allow_private_llm_base_urls
                )
            except LlmEndpointValidationError as exc:
                errors.append(
                    _error(item.slot_key, "temporary_base_url_invalid", str(exc))
                )
        if temporary.get(KEY_ROLE) is None:
            continue
        ref = item.ref
        if ref is None or not _REF_PATTERN.match(ref):
            errors.append(
                _error(
                    item.slot_key,
                    "temporary_key_ref_invalid",
                    "A temporary model key reference must be 1-64 letters, digits "
                    "or ._:-",
                )
            )
            continue
        if not _usable_key(secrets.get(ref)):
            errors.append(
                _error(
                    item.slot_key,
                    "temporary_key_required",
                    f'Enter the API key of temporary model "{item.label}"',
                )
            )
            continue
        needs_encryption = True
    if needs_encryption and not encryption_available(settings):
        errors.append(
            {
                "section": "document",
                "pointer": "",
                "form_pointer": "",
                "field": None,
                "params": {},
                "rule": "binding",
                "code": "encryption_unavailable",
                "message": (
                    "Temporary model keys need QYM_LLM_CONFIG_ENCRYPTION_KEY to be "
                    "configured"
                ),
                "slot_key": None,
                "environment_id": None,
            }
        )
    return errors


def referenced_secrets(
    spec: Mapping[str, Any], secrets: Mapping[str, Any]
) -> Dict[str, str]:
    """The ``{ref: key}`` subset of ``secrets`` that ``spec`` references."""
    out: Dict[str, str] = {}
    for item in iter_temporary_bindings(spec.get("slot_bindings")):
        ref = item.ref
        if ref is not None and _usable_key(secrets.get(ref)):
            out[ref] = str(secrets[ref]).strip()
    return out


# --------------------------------------------------------------------------- storage


def encrypt_secrets(
    secrets: Mapping[str, str], settings: Optional[PlatformSettings] = None
) -> Optional[str]:
    """``secrets_encrypted`` for ``{ref: key}`` (``None`` when empty)."""
    if not secrets:
        return None
    if not encryption_available(settings):
        raise TemporaryModelError(
            400,
            "Temporary model keys need QYM_LLM_CONFIG_ENCRYPTION_KEY to be configured",
            "encryption_unavailable",
        )
    return encrypt_llm_api_key(
        json.dumps(dict(secrets), sort_keys=True, separators=(",", ":")), settings
    )


def decrypt_secrets(
    blob: Optional[str], settings: Optional[PlatformSettings] = None
) -> Dict[str, str]:
    """``{ref: key}`` of a ``secrets_encrypted`` blob; ``{}`` when absent or unreadable."""
    if not blob:
        return {}
    try:
        value = json.loads(decrypt_llm_api_key(blob, settings))
    except Exception:  # noqa: BLE001 - never surface decryption details
        return {}
    if not isinstance(value, dict):
        return {}
    return {k: v for k, v in value.items() if isinstance(k, str) and _usable_key(v)}


def secret_lookup(
    experiment: EvalExperiment, settings: Optional[PlatformSettings] = None
):
    """A ``SecretLookup`` over the experiment's stored keys, or ``None`` if none."""
    secrets = decrypt_secrets(experiment.secrets_encrypted, settings)
    if not secrets:
        return None

    def lookup(ref: str) -> Optional[str]:
        return secrets.get(ref)

    return lookup


# --------------------------------------------------------------------------- retry


def missing_retry_keys(
    params: Any, stored: Mapping[str, str]
) -> List[TemporaryBinding]:
    """Temporary bindings of a job whose key is no longer stored."""
    bindings = params.get("slot_bindings") if isinstance(params, Mapping) else None
    return [
        item
        for item in iter_temporary_bindings(bindings)
        if item.ref is not None and item.ref not in stored
    ]


def retry_secrets(
    params: Any,
    stored: Mapping[str, str],
    provided: Mapping[str, Any],
) -> Tuple[Dict[str, str], List[TemporaryBinding]]:
    """Merge keys re-entered for a retry (``provided`` is ``{slot_key: key}``).

    Returns ``(secrets, still_missing)``: the new ``{ref: key}`` to store and the
    temporary bindings that still have no key.
    """
    secrets = dict(stored)
    bindings = params.get("slot_bindings") if isinstance(params, Mapping) else None
    for item in iter_temporary_bindings(bindings):
        value = provided.get(item.slot_key)
        if item.ref is not None and _usable_key(value):
            secrets[item.ref] = str(value).strip()
    return secrets, missing_retry_keys(params, secrets)


# --------------------------------------------------------------------------- save


def save_as_connection(
    db: Session,
    *,
    project_id: str,
    user_id: Optional[str],
    temporary: Mapping[str, Any],
    api_key: Optional[str],
    settings: Optional[PlatformSettings] = None,
) -> ProjectLlmConnection:
    """Create a ``ProjectLlmConnection`` from a temporary model (flushes, no commit).

    Same rules as the connections API: an absolute, SSRF-checked base URL, a key and
    configured encryption. The caller checks the manage-connections permission.
    """
    settings = settings or PlatformSettings()
    label = temporary.get("label") or temporary.get("model")
    name = str(label or "").strip()
    model = str(temporary.get("model") or "").strip()
    base_url = str(temporary.get("base_url") or "").strip()
    if not name or not model:
        raise TemporaryModelError(
            422, "A saved model needs a name and a model", "temporary_save_invalid"
        )
    if not base_url:
        raise TemporaryModelError(
            422,
            f'Model "{name}" needs a base URL to be saved to project models',
            "temporary_save_invalid",
        )
    if not api_key:
        raise TemporaryModelError(
            422,
            f'Model "{name}" needs an API key to be saved to project models',
            "temporary_save_invalid",
        )
    try:
        base_url = validate_llm_base_url(
            base_url, allow_private=settings.allow_private_llm_base_urls
        )
    except LlmEndpointValidationError as exc:
        raise TemporaryModelError(422, str(exc), "temporary_base_url_invalid")
    if not encryption_available(settings):
        raise TemporaryModelError(
            400, "LLM config encryption is not configured", "encryption_unavailable"
        )
    stored = build_llm_config_storage(
        base_url=base_url, model=model, api_key=api_key, settings=settings
    )
    names = {
        row[0]
        for row in db.query(ProjectLlmConnection.name).filter(
            ProjectLlmConnection.project_id == project_id
        )
    }
    if name in names:
        raise TemporaryModelError(
            409, f'A project model named "{name}" already exists', "name_taken"
        )
    conn = ProjectLlmConnection(
        project_id=project_id,
        created_by_user_id=user_id,
        name=name,
        llm_base_url=stored["llm_base_url"],
        llm_model=stored["llm_model"],
        llm_api_key_encrypted=stored["llm_api_key_encrypted"],
        llm_api_key_last4=stored["llm_api_key_last4"],
        available_for_experiments=True,
        is_default=not names,
    )
    db.add(conn)
    db.flush()  # a concurrent insert of the same name raises IntegrityError
    return conn


# --------------------------------------------------------------------------- reload


def unbind_temporary(config: Any) -> Tuple[Any, List[Dict[str, Any]]]:
    """For a best-run reload (#38): a copy of ``config`` with temporary slots unbound.

    A stored config (``qym_config``, ``params``) never carries a key, so a temporary
    slot is reset to ``None`` (unbound, the launch form shows it empty) and reported
    as ``{slot_key, label, model, base_url, reason}`` so the form can prompt the user
    to pick a saved model or re-enter the key.
    """
    if not isinstance(config, Mapping):
        return copy.deepcopy(config), []
    out = copy.deepcopy(dict(config))
    bindings = out.get("slot_bindings")
    if not isinstance(bindings, Mapping):
        return out, []
    unbound: List[Dict[str, Any]] = []
    new_bindings = dict(bindings)
    for slot_key, binding in bindings.items():
        if binding_kind(binding) != "temporary":
            continue
        temporary = binding.get("temporary")
        item = TemporaryBinding(
            str(slot_key), temporary if isinstance(temporary, Mapping) else {}
        )
        unbound.append({**item.summary(), "reason": UNBOUND_REASON})
        new_bindings[slot_key] = None
    out["slot_bindings"] = new_bindings
    return out, unbound
