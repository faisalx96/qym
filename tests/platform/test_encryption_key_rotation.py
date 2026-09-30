"""Encryption key rotation: MultiFernet decryption, launch tokens, re-encryption tool."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("QYM_DATABASE_URL", "sqlite:///:memory:")
ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))

from qym_platform.db.base import Base
from qym_platform.db.models import (
    EvalEnvironment,
    EvalExperiment,
    Project,
    ProjectLlmConnection,
    User,
)
from qym_platform.secrets import (
    decrypt_llm_api_key,
    encrypt_llm_api_key,
    encryption_keys,
    is_encrypted_with_current_key,
    previous_encryption_keys,
    reencrypt_llm_api_key,
)
from qym_platform.services.eval_experiments import (
    body_with_launch_token,
    hash_launch_token,
    launch_token_for_job,
)
from qym_platform.services.eval_temporary_models import decrypt_secrets, encrypt_secrets
from qym_platform.settings import PlatformSettings
from qym_platform.tools import reencrypt_llm_keys

CONN_KEY = "sk-conn-secret-AAAA1111"
ENV_KEY = "env-service-secret-BBBB2222"
TEMP_KEY = "sk-temp-secret-CCCC3333"


def _key() -> str:
    return Fernet.generate_key().decode("utf-8")


def _settings(current: str, previous: str = "") -> PlatformSettings:
    return PlatformSettings(
        database_url="sqlite:///:memory:",
        llm_config_encryption_key=current,
        llm_config_encryption_keys_previous=previous,
    )


# --------------------------------------------------------------------------- secrets


def test_previous_keys_are_parsed_and_current_comes_first():
    old1, old2, current = _key(), _key(), _key()
    settings = _settings(current, f" {old1} ,,{old2},{old1},{current}")
    assert previous_encryption_keys(settings) == [old1, old2]
    assert encryption_keys(settings) == [current, old1, old2]
    assert encryption_keys(_settings("", old1)) == []


def test_decrypts_with_a_previous_key_and_encrypts_with_the_current_one():
    old, current = _key(), _key()
    before = encrypt_llm_api_key(CONN_KEY, _settings(old))
    rotated = _settings(current, old)

    assert decrypt_llm_api_key(before, rotated) == CONN_KEY
    assert not is_encrypted_with_current_key(before, rotated)

    after = encrypt_llm_api_key(CONN_KEY, rotated)
    # Only the current key can read what is encrypted now.
    assert Fernet(current.encode()).decrypt(after.encode()).decode() == CONN_KEY
    with pytest.raises(Exception):
        Fernet(old.encode()).decrypt(after.encode())
    assert is_encrypted_with_current_key(after, rotated)

    # Without the previous key the old value no longer decrypts.
    with pytest.raises(RuntimeError, match="could not be decrypted"):
        decrypt_llm_api_key(before, _settings(current))


def test_env_var_previous_keys_reach_default_settings_and_temp_blobs(monkeypatch):
    old, current = _key(), _key()
    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", old)
    blob = encrypt_secrets({"ref-1": TEMP_KEY})
    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEY", current)
    monkeypatch.setenv("QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS", old)
    assert decrypt_secrets(blob) == {"ref-1": TEMP_KEY}
    monkeypatch.delenv("QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS")
    assert decrypt_secrets(blob) == {}


def test_malformed_previous_key_error_never_echoes_it():
    bad = "not-a-fernet-key-SECRETISH"
    with pytest.raises(RuntimeError) as info:
        decrypt_llm_api_key("x", _settings(_key(), bad))
    assert bad not in str(info.value)
    assert "QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS" in str(info.value)


def test_reencrypt_value_uses_current_key():
    old, current = _key(), _key()
    before = encrypt_llm_api_key(CONN_KEY, _settings(old))
    after = reencrypt_llm_api_key(before, _settings(current, old))
    assert is_encrypted_with_current_key(after, _settings(current))
    assert decrypt_llm_api_key(after, _settings(current)) == CONN_KEY


# --------------------------------------------------------------------------- launch tokens


def test_launch_token_picks_the_previous_key_matching_the_stored_hash():
    old, current = _key(), _key()
    job_id = str(uuid4())
    old_token = launch_token_for_job(job_id, _settings(old))
    stored_hash = hash_launch_token(old_token)
    rotated = _settings(current, old)

    assert launch_token_for_job(job_id, rotated) != old_token
    assert launch_token_for_job(job_id, rotated, expected_hash=stored_hash) == old_token
    body = body_with_launch_token({}, job_id, rotated, expected_hash=stored_hash)
    assert body["evaluator"]["config"]["run_metadata"]["qym_launch"]["token"] == old_token
    # A current-key hash keeps using the current key.
    current_token = launch_token_for_job(job_id, rotated)
    assert (
        launch_token_for_job(
            job_id, rotated, expected_hash=hash_launch_token(current_token)
        )
        == current_token
    )


# --------------------------------------------------------------------------- tool


@pytest.fixture()
def sessions():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    try:
        yield sessionmaker(bind=engine, autoflush=False, autocommit=False)
    finally:
        engine.dispose()


def _seed(sessions, settings: PlatformSettings, *, connections: int = 3) -> dict:
    with sessions() as db:
        user = User(id="u1", email="u1@example.com")
        db.add(user)
        db.flush()
        project = Project(id="p1", name="P", slug="p", created_by_user_id=user.id)
        db.add(project)
        db.flush()
        for index in range(connections):
            db.add(
                ProjectLlmConnection(
                    project_id=project.id,
                    name=f"c{index}",
                    llm_base_url="https://api.example.com/v1",
                    llm_model="m",
                    llm_api_key_encrypted=encrypt_llm_api_key(CONN_KEY, settings),
                )
            )
        # A connection without a key is skipped.
        db.add(ProjectLlmConnection(project_id=project.id, name="empty", llm_api_key_encrypted=""))
        db.add(
            EvalEnvironment(
                project_id=project.id,
                name="staging",
                base_url="https://staging.example",
                api_key_encrypted=encrypt_llm_api_key(ENV_KEY, settings),
            )
        )
        db.add(
            EvalExperiment(
                project_id=project.id,
                created_by_user_id=user.id,
                name="exp",
                secrets_encrypted=encrypt_secrets({"ref-1": TEMP_KEY}, settings),
            )
        )
        db.add(
            EvalExperiment(
                project_id=project.id, created_by_user_id=user.id, name="settled"
            )
        )
        db.commit()
    return {}


def _stored(sessions) -> list[str]:
    with sessions() as db:
        return [
            *(c.llm_api_key_encrypted for c in db.query(ProjectLlmConnection).all()),
            *(e.api_key_encrypted for e in db.query(EvalEnvironment).all()),
            *(x.secrets_encrypted for x in db.query(EvalExperiment).all()),
        ]


def _run_tool(sessions, settings, argv, capsys):
    code = reencrypt_llm_keys.main(argv, session_factory=sessions, settings=settings)
    out = capsys.readouterr()
    return code, json.loads(out.out), out.out + out.err


def _assert_no_secrets(text: str, *keys: str) -> None:
    for secret in (CONN_KEY, ENV_KEY, TEMP_KEY, *keys):
        assert secret not in text


def test_tool_dry_run_counts_and_writes_nothing(sessions, capsys):
    old, current = _key(), _key()
    _seed(sessions, _settings(old))
    before = _stored(sessions)
    rotated = _settings(current, old)

    code, stats, text = _run_tool(sessions, rotated, ["--dry-run", "--batch-size", "2"], capsys)

    assert code == 0
    assert stats["dry_run"] is True
    assert stats["totals"]["reencrypted"] == 5
    assert stats["totals"]["scanned"] == 5
    assert stats["columns"]["project_llm_connections.llm_api_key_encrypted"]["reencrypted"] == 3
    assert stats["columns"]["eval_environments.api_key_encrypted"]["reencrypted"] == 1
    assert stats["columns"]["eval_experiments.secrets_encrypted"]["reencrypted"] == 1
    assert _stored(sessions) == before
    _assert_no_secrets(text, old, current)
    for value in before:
        if value:
            assert value not in text


def test_tool_rotates_everything_and_is_idempotent(sessions, capsys):
    old, current = _key(), _key()
    _seed(sessions, _settings(old))
    rotated = _settings(current, old)

    code, stats, text = _run_tool(sessions, rotated, ["--batch-size", "2"], capsys)
    assert code == 0
    assert stats["totals"]["reencrypted"] == 5
    assert stats["totals"]["failed"] == 0
    _assert_no_secrets(text, old, current)

    # Everything now reads with the current key alone.
    only_current = _settings(current)
    with sessions() as db:
        for conn in db.query(ProjectLlmConnection).filter(ProjectLlmConnection.name != "empty"):
            assert decrypt_llm_api_key(conn.llm_api_key_encrypted, only_current) == CONN_KEY
        (env,) = db.query(EvalEnvironment).all()
        assert decrypt_llm_api_key(env.api_key_encrypted, only_current) == ENV_KEY
        exp = db.query(EvalExperiment).filter_by(name="exp").one()
        assert decrypt_secrets(exp.secrets_encrypted, only_current) == {"ref-1": TEMP_KEY}

    after_first = _stored(sessions)
    code, stats, _ = _run_tool(sessions, rotated, [], capsys)
    assert code == 0
    assert stats["totals"]["reencrypted"] == 0
    assert stats["totals"]["already_current"] == 5
    assert _stored(sessions) == after_first


def test_tool_reports_unreadable_values_without_secrets(sessions, capsys):
    lost, current = _key(), _key()
    _seed(sessions, _settings(lost), connections=1)

    code, stats, text = _run_tool(sessions, _settings(current), [], capsys)

    assert code == 1
    assert stats["totals"]["failed"] == 3
    assert stats["totals"]["reencrypted"] == 0
    assert len(stats["columns"]["project_llm_connections.llm_api_key_encrypted"]["failed_ids"]) == 1
    _assert_no_secrets(text, lost, current)


def test_tool_without_a_key_exits_2(sessions, capsys):
    code, stats, _ = _run_tool(sessions, _settings(""), [], capsys)
    assert code == 2
    assert "QYM_LLM_CONFIG_ENCRYPTION_KEY" in stats["error"]
