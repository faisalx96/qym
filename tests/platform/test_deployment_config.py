from __future__ import annotations

import os
import subprocess
from pathlib import Path

from qym_platform.settings import PlatformSettings


ROOT = Path(__file__).resolve().parents[2]


def test_base_compose_is_production_safe() -> None:
    compose = (ROOT / "docker" / "docker-compose.yml").read_text(encoding="utf-8")
    # auth mode is env-driven — never hardcoded off
    assert "QYM_AUTH_MODE: ${QYM_AUTH_MODE}" in compose
    assert "QYM_AUTH_MODE: none" not in compose
    assert "QYM_LLM_CONFIG_ENCRYPTION_KEY" in compose
    # production image must not bind-mount source
    assert "../packages/platform" not in compose
    # the api container runs the background loops by default; the split
    # layout is opt-in via the worker profile
    assert "QYM_ROLE: ${QYM_ROLE:-all}" in compose
    assert "QYM_ROLE: ${QYM_ROLE:-api}" not in compose
    assert 'profiles: ["worker"]' in compose


def test_dev_override_restores_reload_and_bind_mounts() -> None:
    compose = (ROOT / "docker" / "docker-compose.dev.yml").read_text(encoding="utf-8")
    assert "QYM_AUTH_MODE: ${QYM_AUTH_MODE}" in compose
    assert "../packages/platform:/app/packages/platform" in compose
    assert "../packages/sdk:/app/packages/sdk" in compose
    assert "--reload" in compose


def test_entrypoint_defaults_to_non_reload_uvicorn() -> None:
    entrypoint = (ROOT / "docker" / "entrypoint.sh").read_text(encoding="utf-8")
    assert "--reload" not in entrypoint
    assert 'if [ "$#" -gt 0 ]; then' in entrypoint


def test_compose_forwards_the_sign_in_settings_with_their_defaults() -> None:
    compose = (ROOT / "docker" / "docker-compose.yml").read_text(encoding="utf-8")
    for name in (
        "auth_local_signup",
        "auth_login_max_failures_per_email",
        "auth_login_max_failures_per_client",
        "auth_login_failure_window_seconds",
        "auth_login_email_ceiling",
        "auth_login_email_ceiling_window_seconds",
    ):
        env = "QYM_" + name.upper()
        default = str(PlatformSettings.model_fields[name].default).lower()
        assert f"{env}: ${{{env}:-{default}}}" in compose, env
    assert "FORWARDED_ALLOW_IPS: ${FORWARDED_ALLOW_IPS:-}" in compose
    # An empty value reaches the API unset, so uvicorn keeps its default trust.
    probe = 'echo "${FORWARDED_ALLOW_IPS-unset}"'
    for value, seen in (("", "unset"), ("10.0.0.0/8", "10.0.0.0/8")):
        result = subprocess.run(
            ["sh", str(ROOT / "docker" / "entrypoint.sh"), "sh", "-c", probe],
            env={**os.environ, "QYM_SKIP_MIGRATIONS": "1", "FORWARDED_ALLOW_IPS": value},
            capture_output=True, text=True, check=True,
        )
        assert result.stdout.splitlines()[-1] == seen