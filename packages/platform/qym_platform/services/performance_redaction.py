"""Keep sign-in tokens out of everything a performance run stores (guide section 6).

Token values leave qym only in the control document. Whatever the runner sent:
log lines, event messages, the runner's name, question ids, the summary and a
run's ``error`` are masked before they are stored; string keys and values of
``info``, ``progress`` and event ``details`` too; a report file that holds a
current token value is refused, because masking could break the file;
credential keys are dropped from ``info`` and event ``details``.

A current token value is found in every spelling qym can predict: as it is,
escaped for JSON (also with ``\\/``), for markup and for a URL (upper or lower
case hex), and inside base64 text.
"""

from __future__ import annotations

import base64
import html
import json
import re
from typing import Any, Iterable, Optional, Pattern
from urllib.parse import quote, quote_plus, unquote

from cryptography.fernet import InvalidToken
from qym_platform import secrets as secret_storage
from qym_platform.db.models import (
    PERFORMANCE_DEFAULT_REFRESH_COOKIE_NAME,
    PERFORMANCE_TOKEN_NAMES,
    PerformanceTarget,
    PerformanceTargetToken,
)
from qym_platform.services.live_events import redact_details
from sqlalchemy import select
from sqlalchemy.orm import Session

MASK = "[REDACTED]"
# A hint shows the last four characters only of a token at least this long.
HINT_MIN_CHARS = 12
# Base64 text shorter than this would match unrelated text.
_BASE64_MIN_CHARS = 8

_MASKED = re.escape(MASK)
# Quotes (also JSON-escaped ones) and brackets in front of a value: "[Bearer x]", "<x>", "(x)".
_OPEN = r"(?:(?!" + _MASKED + r")(?:\\?[\"']|[\[<({]))*"
# A value ends at a space, a quote, a backslash, a separator or a closing bracket.
_VALUE = r"(?:" + _MASKED + r"|[^\s\"'\\,;&\]>)}]+)"
_SEPARATOR = r"(?:\\?[\"'])?\s*[:=]\s*"

# Three base64url parts joined by dots, the first starting like a JSON object.
_JWT = re.compile(r"eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*")
_BEARER = re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._~+/=-]+")
# "Authorization: Bearer abc", "authorization=abc", '"Authorization": "Basic abc"',
# "Authorization: [Bearer abc]", "Authorization:<Bearer abc>".
_AUTHORIZATION = re.compile(
    r"(?i)\b((?:proxy-)?authorization" + _SEPARATOR + _OPEN + r")"
    r"(?:(?:bearer|basic|token|digest|negotiate)\s+" + _OPEN + r")?" + _VALUE
)
# A cookie header carries the refresh token of the target: the whole value is masked.
_COOKIE = re.compile(
    r"(?i)\b((?:set-)?cookies?" + _SEPARATOR + r"(?:\\?[\"'])?)[^\r\n\"'\\]+"
)


def drop_credential_keys(value: Any) -> Any:
    """Drop, at any depth, every key whose name says it holds a credential."""
    return redact_details(value)


def hint_for(value: str) -> str:
    """The part of a token a page may show: its last 4 characters, or nothing for a short one."""
    return value[-4:] if len(value) >= HINT_MIN_CHARS else ""


def token_values(
    db: Session,
    *,
    target_id: Optional[str] = None,
    project_id: Optional[str] = None,
) -> list[str]:
    """The current token values of one target, or of every target of a project.

    For masking only: a token that cannot be decrypted is left out, because its
    value is unknown here too. Never log or return these to a caller outside
    this package.
    """
    query = select(
        PerformanceTargetToken.token_encrypted,
        PerformanceTargetToken.history_encrypted,
        PerformanceTargetToken.name,
    )
    if target_id is not None:
        query = query.where(PerformanceTargetToken.target_id == target_id)
    elif project_id is not None:
        query = query.join(
            PerformanceTarget, PerformanceTarget.id == PerformanceTargetToken.target_id
        ).where(PerformanceTarget.project_id == project_id)
    else:
        return []
    values = []
    for encrypted, historical, name in db.execute(query):
        jars = []
        try:
            if encrypted:
                jars.append(secret_storage.decrypt_llm_api_key(encrypted))
            if historical:
                jars.extend(
                    item if isinstance(item, str) else item["value"]
                    for item in json.loads(
                        secret_storage.decrypt_llm_api_key(historical)
                    )
                )
        except (RuntimeError, ValueError, TypeError, InvalidToken):
            continue
        for value in jars:
            if value:
                values.append(value)
                if name == "session_cookie":
                    for pair in value.split(";"):
                        if "=" in pair:
                            values.append(pair.strip())
                            item = pair.split("=", 1)[1].strip()
                            if item:
                                values.append(item)
    # Longest first, so a token that contains another is masked whole.
    return sorted(set(values), key=len, reverse=True)


def cookie_names(
    db: Session,
    *,
    target_id: Optional[str] = None,
    project_id: Optional[str] = None,
) -> list[str]:
    """The refresh cookie names of one target, or of every target of a project."""
    query = select(PerformanceTarget.settings)
    if target_id is not None:
        query = query.where(PerformanceTarget.id == target_id)
    elif project_id is not None:
        query = query.where(PerformanceTarget.project_id == project_id)
    else:
        return [PERFORMANCE_DEFAULT_REFRESH_COOKIE_NAME]
    names = {PERFORMANCE_DEFAULT_REFRESH_COOKIE_NAME}
    for settings in db.scalars(query):
        name = (settings or {}).get("refresh_cookie_name")
        if isinstance(name, str) and name.strip():
            names.add(name.strip())
    for value in token_values(db, target_id=target_id, project_id=project_id):
        for pair in value.split(";"):
            if "=" in pair:
                name = pair.split("=", 1)[0].strip()
                if re.fullmatch(r"[A-Za-z0-9!#$%&'*+.^_`|~-]+", name):
                    names.add(name)
    return sorted(names)


# --------------------------------------------------------------------------- spellings


def _base64_parts(token: str) -> set[str]:
    """The base64 text of ``token`` at each of the three byte offsets it can start at.

    Only the characters that do not depend on the bytes around the token are
    kept, so the part is found inside the base64 text of a longer string.
    """
    data = token.encode("utf-8")
    parts = set()
    for shift in range(3):
        encoded = base64.b64encode(b"\0" * shift + data).decode("ascii")
        part = encoded[4 if shift else 0 : 4 * ((shift + len(data)) // 3)]
        if len(part) >= _BASE64_MIN_CHARS:
            parts.add(part)
            parts.add(part.replace("+", "-").replace("/", "_"))
    return parts


def _spellings(token: str) -> tuple[set[str], set[str]]:
    """``(exact spellings, URL spellings)`` of a token; URL hex may be in either case."""
    in_json = {
        json.dumps(token)[1:-1],
        json.dumps(token, ensure_ascii=False)[1:-1],
    }
    exact = {
        token,
        *in_json,
        *(text.replace("/", "\\/") for text in in_json),
        html.escape(token),
        html.escape(token, quote=False),
        *_base64_parts(token),
    }
    in_url = {quote(token, safe=""), quote(token), quote_plus(token)} - exact
    return exact, in_url


def _token_pattern(tokens: Iterable[str]) -> Optional[Pattern[str]]:
    exact: set[str] = set()
    in_url: set[str] = set()
    for token in tokens:
        if token:
            more_exact, more_url = _spellings(token)
            exact |= more_exact
            in_url |= more_url
    in_url -= exact
    if not exact and not in_url:
        return None
    # Longest first, so a longer spelling is masked whole.
    parts = sorted(exact | in_url, key=len, reverse=True)
    return re.compile(
        "|".join(
            "(?i:" + re.escape(part) + ")" if part in in_url else re.escape(part)
            for part in parts
        )
    )


def _pairs_pattern(names: Iterable[str]) -> Pattern[str]:
    """``<name>=value`` and ``"<name>": "value"`` for the token and cookie names."""
    words = sorted({*PERFORMANCE_TOKEN_NAMES, *names}, key=len, reverse=True)
    return re.compile(
        r"(?i)(?<![A-Za-z0-9_.-])((?:"
        + "|".join(re.escape(word) for word in words)
        + r")"
        + _SEPARATOR
        + _OPEN
        + r")"
        + _VALUE
    )


# At most eight linear shrinking passes, regardless of escape nesting. Reports
# that still change at this depth fail closed; no spelling combinations are built.
NORMALIZE_PASSES = 8
_ESCAPE = re.compile(
    r"(?:%[0-9a-fA-F]{2})+|\\u[0-9a-fA-F]{4}(?:\\u[0-9a-fA-F]{4})?"
    r"|\\[\"\\/bfnrt]|&(?:\#[xX][0-9a-fA-F]+|\#[0-9]+|[A-Za-z][A-Za-z0-9]{0,31});?"
)


def _decode_escapes(text: str) -> str:
    """Decode one layer; each match consumes more characters than it emits."""

    def decode(match):
        value = match.group()
        if value.startswith("%"):
            return unquote(value)
        if value.startswith("&#"):
            digits = value[2:].rstrip(";")
            hexadecimal = digits[:1].lower() == "x"
            if hexadecimal:
                digits = digits[1:]
            digits = digits.lstrip("0") or "0"
            # HTML permits arbitrarily zero-padded entities. Strip padding
            # before conversion, and never parse an unbounded integer.
            if len(digits) > (6 if hexadecimal else 7):
                return "\ufffd"
            return html.unescape("&#" + ("x" if hexadecimal else "") + digits + ";")
        if value.startswith("&"):
            return html.unescape(value)
        return json.loads('"' + value + '"')

    return _ESCAPE.sub(decode, text)


def _normalized(text: str) -> tuple[str, bool]:
    for _ in range(NORMALIZE_PASSES):
        decoded = _decode_escapes(text)
        if decoded == text:
            return text, True
        text = decoded
    # Reject excessive nesting even if the final pass happened to finish it.
    return text, False


class Masker:
    """Masking with one set of token values and cookie names, compiled once."""

    def __init__(self, tokens: Iterable[str] = (), cookies: Iterable[str] = ()):
        tokens = tuple(tokens)
        self._tokens = _token_pattern(tokens)
        self._normalized_tokens = _token_pattern(
            _normalized(token)[0] for token in tokens
        )
        self._pairs = _pairs_pattern(cookies)

    def exact(self, text: str) -> str:
        """Mask only the token values, in every spelling; for measured content."""
        if self._tokens is None:
            return text
        # Preserve ordinary text/legacy canonical masking when no additional
        # escaped occurrence exists. Decode only for matching, not storage.
        masked = self._tokens.sub(MASK, text)
        decoded, complete = _normalized(masked)
        if not complete:
            return MASK
        if self._normalized_tokens is not None and self._normalized_tokens.search(
            decoded
        ):
            return self._normalized_tokens.sub(MASK, decoded)
        return masked

    def contains(self, text: str) -> bool:
        """True when ``text`` holds a token value in one of its spellings."""
        if self._tokens is None:
            return False
        if self._tokens.search(text) is not None:
            return True
        decoded, complete = _normalized(text)
        return not complete or (
            self._normalized_tokens is not None
            and self._normalized_tokens.search(decoded) is not None
        )

    def text(self, text: str) -> str:
        """Mask token values and token-shaped text.

        Every spelling of the token values, JWT-shaped strings, whatever follows
        ``Bearer``, the value of an ``Authorization`` or ``Cookie`` header, and
        the value after a token or refresh cookie name.
        """
        text = self.exact(text)
        text = _JWT.sub(MASK, text)
        text = _BEARER.sub(lambda match: match.group(1) + " " + MASK, text)
        text = _AUTHORIZATION.sub(lambda match: match.group(1) + MASK, text)
        text = _COOKIE.sub(lambda match: match.group(1) + MASK, text)
        return self._pairs.sub(lambda match: match.group(1) + MASK, text)

    def json(self, value: Any) -> Any:
        """``text`` on every string of a JSON value, keys included."""
        if isinstance(value, str):
            return self.text(value)
        if isinstance(value, dict):
            return {
                (self.text(key) if isinstance(key, str) else key): self.json(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [self.json(item) for item in value]
        return value


def masker(
    db: Session, *, target_id: Optional[str] = None, project_id: Optional[str] = None
) -> Masker:
    """The masking of one target's or one project's current tokens and cookie names."""
    return Masker(
        token_values(db, target_id=target_id, project_id=project_id),
        cookie_names(db, target_id=target_id, project_id=project_id),
    )


def mask_text(
    text: str, tokens: Iterable[str] = (), cookies: Iterable[str] = ()
) -> str:
    """Replace token values and token-shaped text with ``[REDACTED]`` (``Masker.text``)."""
    return Masker(tokens, cookies).text(text)


def mask_exact(text: str, tokens: Iterable[str]) -> str:
    """Replace only the token values, in every spelling; for text that is measured content."""
    return Masker(tokens).exact(text)


def mask_json(
    value: Any, tokens: Iterable[str] = (), cookies: Iterable[str] = ()
) -> Any:
    """``mask_text`` on every string of a JSON value, keys included."""
    return Masker(tokens, cookies).json(value)


def contains_jwt(text: str) -> bool:
    """True when ``text`` holds a JWT-shaped string: a token qym may never have seen."""
    return _JWT.search(text) is not None


def contains_token(text: str, tokens: Iterable[str]) -> bool:
    """True when ``text`` holds one of ``tokens``, plain or in an escaped or encoded spelling."""
    return Masker(tokens).contains(text)


def json_contains_token(value: Any, tokens: Iterable[str]) -> bool:
    """True when a key or a string value of a JSON value holds one of ``tokens``."""
    found = Masker(tokens)
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            if found.contains(item):
                return True
        elif isinstance(item, dict):
            stack.extend(item.keys())
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
    return False
