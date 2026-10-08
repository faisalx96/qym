from __future__ import annotations

from functools import lru_cache
from typing import Any

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from qym_platform.log import get_logger
from qym_platform.settings import PlatformSettings

logger = get_logger(__name__)


def llm_config_has_api_key(cfg: dict[str, Any] | None) -> bool:
    if not isinstance(cfg, dict):
        return False
    return bool(cfg.get("llm_api_key_encrypted") or cfg.get("llm_api_key"))


def llm_config_api_key_hint(cfg: dict[str, Any] | None) -> str:
    if not isinstance(cfg, dict):
        return ""
    last4 = str(cfg.get("llm_api_key_last4") or "")
    if last4:
        return "••••" + last4
    raw_key = str(cfg.get("llm_api_key") or "")
    if len(raw_key) >= 4:
        return "••••" + raw_key[-4:]
    return ""


def _encryption_key(settings: PlatformSettings | None = None) -> str:
    runtime_settings = settings or PlatformSettings()
    return (runtime_settings.llm_config_encryption_key or "").strip()


def previous_encryption_keys(settings: PlatformSettings | None = None) -> list[str]:
    """``QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS`` as a list (order kept, deduplicated).

    The current key is left out, so a key listed in both places is only tried once.
    """
    runtime_settings = settings or PlatformSettings()
    raw = getattr(runtime_settings, "llm_config_encryption_keys_previous", "") or ""
    current = _encryption_key(runtime_settings)
    keys: list[str] = []
    for part in raw.split(","):
        key = part.strip()
        if key and key != current and key not in keys:
            keys.append(key)
    return keys


def encryption_keys(settings: PlatformSettings | None = None) -> list[str]:
    """The current key followed by the previous ones (empty without a current key)."""
    runtime_settings = settings or PlatformSettings()
    current = _encryption_key(runtime_settings)
    if not current:
        return []
    return [current, *previous_encryption_keys(runtime_settings)]


@lru_cache(maxsize=4)
def _fernet_for_key(key: str) -> Fernet:
    return Fernet(key.encode("utf-8"))


@lru_cache(maxsize=4)
def _multi_fernet_for_keys(keys: tuple[str, ...]) -> MultiFernet:
    fernets = []
    for index, key in enumerate(keys):
        try:
            fernets.append(_fernet_for_key(key))
        except (ValueError, TypeError) as exc:
            # Never echo the key itself.
            label = "QYM_LLM_CONFIG_ENCRYPTION_KEY" if index == 0 else (
                f"QYM_LLM_CONFIG_ENCRYPTION_KEYS_PREVIOUS entry {index}"
            )
            logger.error("%s is not a valid Fernet key", label)
            raise RuntimeError(f"{label} is not a valid Fernet key") from exc
    return MultiFernet(fernets)


def encryption_available(settings: PlatformSettings | None = None) -> bool:
    return bool(_encryption_key(settings))


def encrypt_llm_api_key(api_key: str, settings: PlatformSettings | None = None) -> str:
    """Encrypt with the current key only."""
    key = _encryption_key(settings)
    if not key:
        raise RuntimeError("LLM config encryption is not configured")
    return _fernet_for_key(key).encrypt(api_key.encode("utf-8")).decode("utf-8")


def decrypt_llm_api_key(token: str, settings: PlatformSettings | None = None) -> str:
    """Decrypt with the current key, then each previous key (``MultiFernet``)."""
    keys = encryption_keys(settings)
    if not keys:
        raise RuntimeError("LLM config encryption is not configured")
    try:
        return _multi_fernet_for_keys(tuple(keys)).decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        logger.error("stored LLM API key could not be decrypted with any configured encryption key", exc_info=True)
        raise RuntimeError("Stored LLM API key could not be decrypted") from exc


def is_encrypted_with_current_key(token: str, settings: PlatformSettings | None = None) -> bool:
    """Whether ``token`` already decrypts with the current key (no rotation needed)."""
    key = _encryption_key(settings)
    if not key or not token:
        return False
    try:
        _multi_fernet_for_keys((key,)).decrypt(token.encode("utf-8"))
    except InvalidToken:
        return False
    return True


def reencrypt_llm_api_key(token: str, settings: PlatformSettings | None = None) -> str:
    """``token`` re-encrypted with the current key (raises ``RuntimeError`` if unreadable).

    The plaintext never leaves this function.
    """
    keys = encryption_keys(settings)
    if not keys:
        raise RuntimeError("LLM config encryption is not configured")
    try:
        return _multi_fernet_for_keys(tuple(keys)).rotate(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        logger.error("stored LLM API key could not be decrypted with any configured encryption key", exc_info=True)
        raise RuntimeError("Stored LLM API key could not be decrypted") from exc


def resolve_llm_api_key(cfg: dict[str, Any] | None, settings: PlatformSettings | None = None) -> str:
    if not isinstance(cfg, dict):
        return ""
    encrypted = str(cfg.get("llm_api_key_encrypted") or "")
    if encrypted:
        return decrypt_llm_api_key(encrypted, settings)
    return str(cfg.get("llm_api_key") or "")


def build_llm_config_storage(
    *,
    base_url: str,
    model: str,
    api_key: str,
    settings: PlatformSettings | None = None,
) -> dict[str, Any]:
    encrypted_key = encrypt_llm_api_key(api_key, settings)
    return {
        "llm_base_url": base_url.strip().rstrip("/"),
        "llm_api_key_encrypted": encrypted_key,
        "llm_api_key_last4": api_key[-4:] if len(api_key) >= 4 else api_key,
        "llm_model": model.strip(),
    }
