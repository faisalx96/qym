"""Worker settings validation, encrypted version history and secret resolution."""

from __future__ import annotations

import hashlib
from copy import deepcopy
from datetime import datetime

import pytest
from cryptography.fernet import Fernet
from sqlalchemy.orm import sessionmaker

from qym_platform.db.models import (
    LiveSource,
    LiveWorkerSettings,
    Project,
    ProjectLlmConnection,
)
from qym_platform.secrets import encrypt_llm_api_key
from qym_platform.services import live_worker_settings as settings

NOW = datetime(2026, 11, 3, 12)
SECRETS = {
    "langfuse_secret_key": "lf-secret-1234",
    "database_password": "db-password-5678",
}


@pytest.fixture()
def session_factory(database, monkeypatch):
    monkeypatch.setenv(
        "QYM_LLM_CONFIG_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8")
    )
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        db.add(
            ProjectLlmConnection(
                id="connection",
                project_id="p",
                name="Gateway",
                llm_base_url="https://gateway.example/v1",
                llm_api_key_encrypted=encrypt_llm_api_key("gateway-secret"),
            )
        )
        db.add(
            LiveSource(
                id="source",
                project_id="p",
                key="worker",
                name="Worker",
                environment="test",
            )
        )
        db.commit()
    return factory


@pytest.fixture()
def values():
    return {
        "evaluation": {
            "chart_vision_enabled": True,
            "chart_design_enabled": True,
            "chart_images_upload": True,
            "dataiku_execution": False,
            "parallel_turns": 2,
            "poll_interval_s": 60,
            "lookback_hours": 24,
        },
        "models": {
            "connection_id": "connection",
            "judge_a": "judge-a",
            "judge_b": "judge-b",
            "vision_judge": "vision",
            "vision_extractor": "extractor",
            "vision_design_judge": "design",
        },
        "langfuse": {"host": "https://langfuse.example", "public_key": "pk-test"},
        "dataiku": {"url": "https://dataiku.example", "database": "analytics"},
        "database": {
            "host": "db.example",
            "port": 5432,
            "database": "analytics",
            "user": "reader",
            "sslmode": "require",
        },
    }


def test_create_version_validates_and_encrypts(session_factory, values):
    with session_factory() as db:
        source = db.get(LiveSource, "source")
        values["models"]["judge_a"] = "  judge-a  "
        row = settings.create_version(
            db, source, values, SECRETS, "initial", "u", now=NOW
        )
        assert row.version == 1
        assert row.values["models"]["judge_a"] == "judge-a"
        for name, plaintext in SECRETS.items():
            assert row.secrets_encrypted[name] != plaintext
            assert row.secret_hints[name] == plaintext[-4:]
        resolved, errors = settings.resolved_secrets(db, source, row)
        assert errors == []
        assert resolved == {
            **SECRETS,
            "gateway_base_url": "https://gateway.example/v1",
            "gateway_api_key": "gateway-secret",
        }
        digest = settings.secrets_digest(resolved)
        assert len(digest) == 64
        assert int(digest, 16) >= 0
        expected = "\n".join(
            f"{key}={value}" for key, value in sorted(resolved.items())
        )
        assert digest == hashlib.sha256(expected.encode()).hexdigest()
        assert settings.secrets_digest(dict(reversed(list(resolved.items())))) == digest
        summary = settings.version_summary(row)
        assert summary == {
            "version": 1,
            "created_at": "2026-11-03T12:00:00Z",
            "created_by": "u",
            "created_by_user_id": "u",
            "note": "initial",
        }
        assert settings.version_payload(row) == {
            **summary,
            "values": row.values,
            "secret_hints": row.secret_hints,
        }
        assert "secrets_encrypted" not in settings.version_payload(row)
        db.get(ProjectLlmConnection, "connection").llm_api_key_encrypted = (
            "invalid-token"
        )
        with pytest.raises(settings.SettingsError) as error:
            settings.resolved_secrets(db, source, row)
        assert (error.value.status, error.value.detail) == (
            500,
            "secret cannot be decrypted",
        )


def test_create_version_rejects_unknown_connection(session_factory, values):
    with session_factory() as db:
        source = db.get(LiveSource, "source")
        values["models"]["connection_id"] = "missing"
        with pytest.raises(settings.SettingsError) as error:
            settings.create_version(db, source, values, SECRETS, None, None)
        assert (error.value.status, error.value.detail) == (422, "connection not found")
        db.add(Project(id="other", name="Other", slug="other", created_by_user_id="u"))
        db.flush()
        db.get(ProjectLlmConnection, "connection").project_id = "other"
        db.flush()
        values["models"]["connection_id"] = "connection"
        with pytest.raises(settings.SettingsError) as error:
            settings.create_version(db, source, values, SECRETS, None, None)
        assert (error.value.status, error.value.detail) == (422, "connection not found")


def test_create_version_reports_field_errors(session_factory, values):
    with session_factory() as db:
        source = db.get(LiveSource, "source")
        for section, name, bad in (
            ("evaluation", "parallel_turns", 9),
            ("models", "judge_a", " "),
            ("langfuse", "host", "relative/path"),
            ("langfuse", "host", "https:///langfuse.example"),
            ("dataiku", "url", "ftp://dataiku.example"),
            ("database", "sslmode", "invalid"),
            ("evaluation", "unknown", True),
        ):
            invalid = deepcopy(values)
            invalid[section][name] = bad
            with pytest.raises(settings.SettingsError) as error:
                settings.create_version(db, source, invalid, SECRETS, None, None)
            assert error.value.status == 422
            assert error.value.detail["code"] == "validation_error"
            assert any(
                item["loc"] == [section, name] for item in error.value.detail["details"]
            )
            assert all(
                set(item) == {"loc", "msg"} for item in error.value.detail["details"]
            )
        with pytest.raises(settings.SettingsError) as error:
            settings.create_version(
                db, source, values, {"unknown": "secret"}, None, None
            )
        assert (error.value.status, error.value.detail) == (
            422,
            "unknown secret unknown",
        )
        assert db.query(LiveWorkerSettings).count() == 0


def test_save_omitted_secret_keeps_previous_token(session_factory, values):
    with session_factory() as db:
        source = db.get(LiveSource, "source")
        first = settings.create_version(db, source, values, SECRETS, None, None)
        second = settings.create_version(
            db, source, values, {"database_password": "xy"}, None, None
        )
        assert second.version == 2
        assert (
            second.secrets_encrypted["langfuse_secret_key"]
            == first.secrets_encrypted["langfuse_secret_key"]
        )
        assert second.secret_hints["database_password"] == "xy"
        assert first.secret_hints["database_password"] == "5678"
        resolved, errors = settings.resolved_secrets(db, source, second)
        assert not errors
        assert resolved["langfuse_secret_key"] == SECRETS["langfuse_secret_key"]
        assert resolved["database_password"] == "xy"


def test_missing_required_secret_is_422(session_factory, values):
    with session_factory() as db:
        source = db.get(LiveSource, "source")
        with pytest.raises(settings.SettingsError) as error:
            settings.create_version(
                db, source, values, {"langfuse_secret_key": "key"}, None, None
            )
        assert (error.value.status, error.value.detail) == (
            422,
            "missing secret database_password",
        )
        first = settings.create_version(db, source, values, SECRETS, None, None)
        for removal in ("", None):
            with pytest.raises(settings.SettingsError) as error:
                settings.create_version(
                    db, source, values, {"langfuse_secret_key": removal}, None, None
                )
            assert (error.value.status, error.value.detail) == (
                422,
                "missing secret langfuse_secret_key",
            )
        assert settings.current_version(db, source) is first


def test_dataiku_key_required_only_when_execution_on(session_factory, values):
    with session_factory() as db:
        source = db.get(LiveSource, "source")
        settings.create_version(db, source, values, SECRETS, None, None)
        values["evaluation"]["dataiku_execution"] = True
        with pytest.raises(settings.SettingsError) as error:
            settings.create_version(db, source, values, {}, None, None)
        assert (error.value.status, error.value.detail) == (
            422,
            "missing secret dataiku_api_key",
        )
        second = settings.create_version(
            db, source, values, {"dataiku_api_key": "dataiku-key"}, None, None
        )
        assert second.version == 2
        values["evaluation"]["dataiku_execution"] = False
        third = settings.create_version(
            db, source, values, {"dataiku_api_key": None}, None, None
        )
        assert "dataiku_api_key" not in third.secrets_encrypted
        assert "dataiku_api_key" not in third.secret_hints
        assert "dataiku_api_key" in second.secrets_encrypted


def test_restore_copies_values_and_secrets(session_factory, values, monkeypatch):
    with session_factory() as db:
        source = db.get(LiveSource, "source")
        first = settings.create_version(db, source, values, SECRETS, "initial", "u")
        values["evaluation"]["parallel_turns"] = 5
        settings.create_version(
            db, source, values, {"database_password": "changed"}, None, None
        )
        monkeypatch.setattr(
            settings.secret_storage,
            "encrypt_llm_api_key",
            lambda value: pytest.fail("restore must not re-encrypt"),
        )
        restored = settings.restore_version(db, source, 1, "u", now=NOW)
        assert restored.version == 3
        assert restored.values == first.values
        assert restored.values is not first.values
        assert restored.secrets_encrypted == first.secrets_encrypted
        assert restored.secret_hints == first.secret_hints
        assert settings.version_summary(restored) == {
            "version": 3,
            "created_at": "2026-11-03T12:00:00Z",
            "created_by": "u",
            "created_by_user_id": "u",
            "note": "restored from v1",
        }
        assert settings.current_version(db, source) is restored
        assert [row.version for row in settings.list_versions(db, source)] == [3, 2, 1]
        assert [row.version for row in settings.list_versions(db, source, limit=1)] == [
            3
        ]
        assert settings.get_version(db, source, 1) is first
        assert settings.get_version(db, source, 4) is None
        with pytest.raises(settings.SettingsError) as error:
            settings.restore_version(db, source, 4, None)
        assert (error.value.status, error.value.detail) == (
            404,
            "settings version not found",
        )


def test_secrets_require_encryption_key(session_factory, values, monkeypatch):
    with session_factory() as db:
        source = db.get(LiveSource, "source")
        first = settings.create_version(db, source, values, SECRETS, None, None)
        monkeypatch.setattr(
            settings.secret_storage, "encryption_available", lambda: False
        )
        monkeypatch.delenv("QYM_LLM_CONFIG_ENCRYPTION_KEY")
        with pytest.raises(settings.SettingsError) as error:
            settings.create_version(db, source, values, SECRETS, None, None)
        assert (error.value.status, error.value.detail) == (
            409,
            "encryption key not configured",
        )
        # Carried-forward required tokens need no encryption operation.
        second = settings.create_version(db, source, values, {}, None, None)
        assert second.version == 2
        assert second.secrets_encrypted == first.secrets_encrypted
        monkeypatch.setattr(settings, "required_secrets", lambda values: set())
        third = settings.create_version(
            db, source, values, dict.fromkeys(SECRETS), None, None
        )
        assert third.secrets_encrypted == {}


def test_resolved_secrets_reports_missing_connection(session_factory, values):
    with session_factory() as db:
        source = db.get(LiveSource, "source")
        row = settings.create_version(db, source, values, SECRETS, None, None)
        db.get(ProjectLlmConnection, "connection").llm_api_key_encrypted = ""
        db.flush()
        resolved, errors = settings.resolved_secrets(db, source, row)
        assert resolved == SECRETS
        assert errors == ["connection has no api key"]
        db.delete(db.get(ProjectLlmConnection, "connection"))
        db.flush()
        resolved, errors = settings.resolved_secrets(db, source, row)
        assert resolved == SECRETS
        assert errors == ["connection missing"]


def test_resolved_secrets_reports_wrong_encryption_key(session_factory, values):
    with session_factory() as db:
        source = db.get(LiveSource, "source")
        row = settings.create_version(db, source, values, SECRETS, None, None)
        row.secrets_encrypted = {
            "database_password": Fernet(Fernet.generate_key()).encrypt(b"secret").decode()
        }
        with pytest.raises(settings.SettingsError) as error:
            settings.resolved_secrets(db, source, row)
        assert (error.value.status, error.value.detail) == (
            500,
            "secret cannot be decrypted",
        )


def test_version_payload_resolves_creator_name(session_factory, values):
    with session_factory() as db:
        source = db.get(LiveSource, "source")
        row = settings.create_version(db, source, values, SECRETS, None, "u")
        names = {"u": "User"}
        assert settings.version_summary(row, names.get)["created_by"] == "User"
        assert settings.version_payload(row, names.get)["created_by"] == "User"
        row.created_by_user_id = None
        assert settings.version_payload(row, names.get)["created_by"] is None


@pytest.mark.parametrize("operation", ["create", "restore"])
def test_version_conflict_is_409(session_factory, values, monkeypatch, operation):
    with session_factory() as db:
        source = db.get(LiveSource, "source")
        first = settings.create_version(db, source, values, SECRETS, None, None)
        settings.create_version(db, source, values, {}, None, None)
        db.commit()
        # Force a stale read to exercise the unique-constraint fallback.
        monkeypatch.setattr(settings, "current_version", lambda db, source: first)
        with pytest.raises(settings.SettingsError) as error:
            if operation == "create":
                settings.create_version(db, source, values, {}, None, None)
            else:
                settings.restore_version(db, source, 1, None)
        assert (error.value.status, error.value.detail) == (
            409,
            "settings changed concurrently, retry",
        )
