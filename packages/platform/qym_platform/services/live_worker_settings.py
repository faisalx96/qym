"""Validate and version worker settings, keeping secrets encrypted at rest."""

from __future__ import annotations

import hashlib
from copy import deepcopy
from datetime import datetime
from typing import Callable, Literal, Optional, Union
from urllib.parse import urlsplit

from cryptography.fernet import InvalidToken
from pydantic import (
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    ValidationError,
    field_validator,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from qym_platform import secrets as secret_storage
from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.models import LiveSource, LiveWorkerSettings, ProjectLlmConnection

SECRET_FIELDS = ("langfuse_secret_key", "dataiku_api_key", "database_password")


class EvaluationValues(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chart_vision_enabled: bool
    chart_design_enabled: bool
    chart_images_upload: bool
    dataiku_execution: bool
    parallel_turns: int = Field(ge=1, le=8)
    poll_interval_s: int = Field(ge=15, le=600)
    lookback_hours: float = Field(ge=0, le=168)


class ModelsValues(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    connection_id: str = Field(min_length=1)
    judge_a: str = Field(min_length=1, max_length=200)
    judge_b: str = Field(min_length=1, max_length=200)
    vision_judge: str = Field(min_length=1, max_length=200)
    vision_extractor: str = Field(min_length=1, max_length=200)
    vision_design_judge: str = Field(min_length=1, max_length=200)


class LangfuseValues(BaseModel):
    model_config = ConfigDict(extra="forbid")

    host: str = Field(max_length=500)
    public_key: str = Field(min_length=1, max_length=200)

    @field_validator("host")
    @classmethod
    def absolute_http_url(cls, value: str) -> str:
        TypeAdapter(AnyHttpUrl).validate_python(value)
        parsed = urlsplit(value)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise ValueError("must be an absolute http(s) URL")
        return value


class DataikuValues(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    database: str = Field(min_length=1, max_length=200)

    @field_validator("url")
    @classmethod
    def absolute_http_url(cls, value: str) -> str:
        TypeAdapter(AnyHttpUrl).validate_python(value)
        parsed = urlsplit(value)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise ValueError("must be an absolute http(s) URL")
        return value


class DatabaseValues(BaseModel):
    model_config = ConfigDict(extra="forbid")

    host: str = Field(min_length=1, max_length=253)
    port: int = Field(ge=1, le=65535)
    database: str = Field(min_length=1, max_length=100)
    user: str = Field(min_length=1, max_length=100)
    sslmode: Literal[
        "disable", "allow", "prefer", "require", "verify-ca", "verify-full"
    ]


class WorkerSettingsValues(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evaluation: EvaluationValues
    models: ModelsValues
    langfuse: LangfuseValues
    dataiku: DataikuValues
    database: DatabaseValues


class SettingsError(Exception):
    def __init__(self, status: int, detail: Union[str, dict]) -> None:
        self.status = status
        self.detail = detail
        super().__init__(detail)


def required_secrets(values: WorkerSettingsValues) -> set:
    required = {"langfuse_secret_key", "database_password"}
    if values.evaluation.dataiku_execution:
        required.add("dataiku_api_key")
    return required


def validate_values(values: dict) -> WorkerSettingsValues:
    try:
        return WorkerSettingsValues.model_validate(values)
    except ValidationError as exc:
        raise SettingsError(
            422,
            {
                "code": "validation_error",
                "message": "Invalid worker settings",
                "details": [
                    {"loc": list(error["loc"]), "msg": error["msg"]}
                    for error in exc.errors()
                ],
            },
        ) from None


def _connection(
    db: Session, source: LiveSource, connection_id: str
) -> Optional[ProjectLlmConnection]:
    return (
        db.query(ProjectLlmConnection)
        .filter_by(id=connection_id, project_id=source.project_id)
        .first()
    )


def current_version(db: Session, source: LiveSource) -> Optional[LiveWorkerSettings]:
    return (
        db.query(LiveWorkerSettings)
        .filter_by(source_id=source.id)
        .order_by(LiveWorkerSettings.version.desc())
        .first()
    )


def list_versions(db: Session, source: LiveSource, limit: int = 50) -> list:
    return (
        db.query(LiveWorkerSettings)
        .filter_by(source_id=source.id)
        .order_by(LiveWorkerSettings.version.desc())
        .limit(limit)
        .all()
    )


def get_version(
    db: Session, source: LiveSource, version: int
) -> Optional[LiveWorkerSettings]:
    return (
        db.query(LiveWorkerSettings)
        .filter_by(source_id=source.id, version=version)
        .first()
    )


def _flush_version(db: Session, row: LiveWorkerSettings) -> None:
    db.add(row)
    try:
        db.flush()
    except IntegrityError as exc:
        constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if constraint == "uq_live_worker_settings_version" or str(exc.orig) == (
            "UNIQUE constraint failed: live_worker_settings.source_id, "
            "live_worker_settings.version"
        ):
            raise SettingsError(409, "settings changed concurrently, retry") from exc
        raise


def create_version(
    db: Session,
    source: LiveSource,
    values: dict,
    secrets: dict,
    note: Optional[str],
    actor_user_id: Optional[str],
    now: Optional[datetime] = None,
) -> LiveWorkerSettings:
    validated = validate_values(values)
    if _connection(db, source, validated.models.connection_id) is None:
        raise SettingsError(422, "connection not found")
    source = db.query(LiveSource).filter_by(id=source.id).with_for_update().one()
    previous = current_version(db, source)
    encrypted = dict(previous.secrets_encrypted) if previous else {}
    hints = dict(previous.secret_hints) if previous else {}
    for name, value in secrets.items():
        if name not in SECRET_FIELDS:
            raise SettingsError(422, f"unknown secret {name}")
        if value is None or value == "":
            encrypted.pop(name, None)
            hints.pop(name, None)
        elif not isinstance(value, str):
            raise SettingsError(
                422,
                {
                    "code": "validation_error",
                    "message": "Invalid worker secrets",
                    "details": [
                        {
                            "loc": ["secrets", name],
                            "msg": "Input should be a valid string",
                        }
                    ],
                },
            )
        else:
            if not secret_storage.encryption_available():
                raise SettingsError(409, "encryption key not configured")
            encrypted[name] = secret_storage.encrypt_llm_api_key(value)
            hints[name] = value[-4:]
    for name in sorted(required_secrets(validated)):
        if not encrypted.get(name):
            raise SettingsError(422, f"missing secret {name}")
    row = LiveWorkerSettings(
        source_id=source.id,
        version=previous.version + 1 if previous else 1,
        values=validated.model_dump(),
        secrets_encrypted=encrypted,
        secret_hints=hints,
        note=note,
        created_by_user_id=actor_user_id,
        created_at=now if now is not None else datetime.utcnow(),
    )
    _flush_version(db, row)
    return row


def restore_version(
    db: Session,
    source: LiveSource,
    version: int,
    actor_user_id: Optional[str],
    now: Optional[datetime] = None,
) -> LiveWorkerSettings:
    source = db.query(LiveSource).filter_by(id=source.id).with_for_update().one()
    original = get_version(db, source, version)
    if original is None:
        raise SettingsError(404, "settings version not found")
    previous = current_version(db, source)
    # Copies are written with the current key, so a restore during a key
    # rotation never recreates tokens of the retired key.
    secrets_encrypted = {
        name: (
            token
            if secret_storage.is_encrypted_with_current_key(token)
            else secret_storage.reencrypt_llm_api_key(token)
        )
        for name, token in original.secrets_encrypted.items()
    }
    row = LiveWorkerSettings(
        source_id=source.id,
        version=previous.version + 1,
        values=deepcopy(original.values),
        secrets_encrypted=secrets_encrypted,
        secret_hints=deepcopy(original.secret_hints),
        note=f"restored from v{version}",
        created_by_user_id=actor_user_id,
        created_at=now if now is not None else datetime.utcnow(),
    )
    _flush_version(db, row)
    return row


def resolved_secrets(
    db: Session, source: LiveSource, row: LiveWorkerSettings
) -> tuple[dict, list]:
    connection = _connection(db, source, row.values["models"]["connection_id"])
    try:
        resolved = {
            name: secret_storage.decrypt_llm_api_key(token)
            for name, token in row.secrets_encrypted.items()
        }
        if connection is not None and connection.llm_api_key_encrypted:
            resolved["gateway_base_url"] = connection.llm_base_url
            resolved["gateway_api_key"] = secret_storage.decrypt_llm_api_key(
                connection.llm_api_key_encrypted
            )
    except (RuntimeError, ValueError, TypeError, InvalidToken) as exc:
        raise SettingsError(500, "secret cannot be decrypted") from exc
    if connection is None:
        return resolved, ["connection missing"]
    if not connection.llm_api_key_encrypted:
        return resolved, ["connection has no api key"]
    return resolved, []


def secrets_digest(resolved: dict) -> str:
    content = "\n".join(f"{key}={value}" for key, value in sorted(resolved.items()))
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def version_summary(
    row: LiveWorkerSettings,
    user_name: Optional[Callable[[Optional[str]], Optional[str]]] = None,
) -> dict:
    return {
        "version": row.version,
        "created_at": to_api_timestamp(row.created_at),
        "created_by": (
            user_name(row.created_by_user_id)
            if user_name is not None
            else row.created_by_user_id
        ),
        "created_by_user_id": row.created_by_user_id,
        "note": row.note,
    }


def version_payload(
    row: LiveWorkerSettings,
    user_name: Optional[Callable[[Optional[str]], Optional[str]]] = None,
) -> dict:
    return {
        **version_summary(row, user_name),
        "values": row.values,
        "secret_hints": row.secret_hints,
    }
