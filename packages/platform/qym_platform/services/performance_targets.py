"""Targets of performance runs and their sign-in tokens.

A target is a system a Manager added: a name, an address (scheme and host), two
paths, optional limits and a production switch. Among the targets of a project
that are not archived, name (in any case) and address (in its canonical form)
are each unique. Changing the address, or where and how the sign-in is renewed,
removes the saved tokens. A target is archived, never deleted.

Token values are stored encrypted with the platform's key and never leave this
module in a payload: pages get the name, the last 4 characters, the version and
the dates. Every write adds its audit row in the caller's transaction; the
caller commits. ``now`` is naive UTC.
"""

from __future__ import annotations

import ipaddress
import re
from datetime import datetime
from typing import Any, Iterable, Mapping, Optional
from urllib.parse import urlsplit

from sqlalchemy import func, inspect as sa_inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, defer, selectinload
from sqlalchemy.orm.attributes import flag_modified

from qym_platform import secrets as secret_storage
from qym_platform.datetime_utils import to_api_timestamp
from qym_platform.db.models import (
    PERFORMANCE_ACTIVE_RUN_STATUSES,
    PERFORMANCE_DEFAULT_AUTH_PATH,
    PERFORMANCE_DEFAULT_CHAT_PATH,
    PERFORMANCE_DEFAULT_REFRESH_COOKIE_NAME,
    PERFORMANCE_TOKEN_NAMES,
    AuditLog,
    PerformanceRun,
    PerformanceTarget,
    PerformanceTargetToken,
    Project,
    User,
)
from qym_platform.services import performance_state as state
from qym_platform.services.performance_runs import PerformanceError
from qym_platform.settings import PlatformSettings

ENTITY = "performance_target"
REFRESH_TOKEN = "refresh_token"
MIN_DURATION_S = 60
TOKEN_MAX_CHARS = 16384
_COOKIE_NAME = re.compile(r"^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$")


class FieldError(Exception):
    """One field of a request is not usable; the route answers 422 with its place."""

    def __init__(self, loc: tuple[str, ...], message: str) -> None:
        self.loc = loc
        self.message = message
        super().__init__(message)


def touch(row: Any, now: datetime) -> None:
    """Set ``updated_at`` to qym's clock, also when the value does not differ.

    The column refreshes itself with the wall clock on every update that leaves
    it out; marking it as changed keeps the time the caller passed.
    """
    row.updated_at = now
    if sa_inspect(row).persistent:
        flag_modified(row, "updated_at")


def target_not_found() -> PerformanceError:
    return PerformanceError("target_not_found", 404, "Target not found")


def encryption_ready() -> bool:
    """The platform's encryption key is set, so tokens can be stored."""
    return secret_storage.encryption_available()


DEFAULT_PORTS = {"http": 80, "https": 443}
# White space, control characters, a backslash or percent-encoding: an address
# with any of them can be read as another host than the one shown.
_UNSAFE_IN_ADDRESS = re.compile(r"[\s\x00-\x1f\x7f\\%]")
_HOST_LABEL = re.compile(r"^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$")


def _ipv4_number(part: str) -> Optional[int]:
    """One part of an IPv4 address as browsers read it: decimal, 0x hex or 0 octal."""
    if part[:2] == "0x":
        digits = part[2:]
        if not digits:
            return 0
        return int(digits, 16) if re.fullmatch(r"[0-9a-f]+", digits) else None
    if len(part) > 1 and part[0] == "0":
        return int(part[1:], 8) if re.fullmatch(r"[0-7]+", part[1:]) else None
    return int(part) if part.isdigit() else None


def _ipv4(labels: list[str]) -> Optional[str]:
    """The dotted form of a host that reads as an IPv4 address (``0x7f.1``); ``None`` for a name.

    Follows the rule of the URL standard the runner's HTTP client uses: a host
    whose last part is a number is an IPv4 address, and must then be a valid one.
    """
    last = labels[-1]
    if not last.isdigit() and _ipv4_number(last) is None:
        return None
    numbers = [_ipv4_number(part) for part in labels]
    if (
        len(numbers) > 4
        or any(number is None for number in numbers)
        or any(number > 255 for number in numbers[:-1])  # type: ignore[operator]
        or numbers[-1] >= 256 ** (5 - len(numbers))  # type: ignore[operator]
    ):
        raise ValueError("not an IPv4 address")
    value = numbers[-1]
    for index, number in enumerate(numbers[:-1]):
        value += number * 256 ** (3 - index)  # type: ignore[operator]
    return str(ipaddress.IPv4Address(value))


def normalize_origin(value: Any, field: str = "base_url") -> str:
    """An address in the one form it is stored and compared in, so a system has one spelling.

    Scheme and host in lower case, no trailing dot, an IPv4 host in dotted
    decimal (``0x7f.1`` is ``127.0.0.1``), an IPv6 host compressed, the port
    only when it is not the scheme's default (443 for https, 80 for http).
    Refused: a path, query or fragment, a user name or password, white space, a
    backslash, percent-encoding, a character outside a host name, port 0, and a
    link-local or cloud metadata host (``_link_local_or_metadata``).
    """
    text = str(value or "").strip()
    if _UNSAFE_IN_ADDRESS.search(text):
        raise FieldError(
            (field,), "Enter the address without spaces, backslashes or % signs"
        )
    try:
        parts = urlsplit(text)
        port = parts.port
    except ValueError as exc:
        raise FieldError(
            (field,), "Enter an address like https://host.example, port 1 to 65535"
        ) from exc
    scheme = parts.scheme.lower()
    if scheme not in DEFAULT_PORTS or not parts.hostname:
        raise FieldError(
            (field,), "Enter an address that starts with http:// or https://"
        )
    if "@" in parts.netloc:
        raise FieldError((field,), "The address must not carry a user name or password")
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        raise FieldError(
            (field,), "Enter the address without a path: scheme and host only"
        )
    if port is not None and port < 1:
        raise FieldError((field,), "Enter a port from 1 to 65535")
    host = parts.hostname.lower()
    try:
        if "[" in parts.netloc:
            host = f"[{ipaddress.IPv6Address(host).compressed}]"
        else:
            if host.endswith("."):
                host = host[:-1]
            labels = host.split(".")
            if len(host) > 253 or not all(_HOST_LABEL.match(label) for label in labels):
                raise ValueError("not a host name")
            host = _ipv4(labels) or host
    except ValueError as exc:
        raise FieldError(
            (field,), "Enter a host name of letters, digits, hyphens and dots"
        ) from exc
    if _link_local_or_metadata(host):
        raise FieldError(
            (field,),
            "This is a link-local or cloud metadata address, not a system to test. "
            "Enter the target's own address",
        )
    origin = f"{scheme}://{host}"
    return origin if port in (None, DEFAULT_PORTS[scheme]) else f"{origin}:{port}"


# First labels of the host names cloud metadata services answer under.
_METADATA_NAMES = frozenset({"metadata", "instance-data"})
# Cloud metadata addresses outside the link-local ranges: these exact addresses,
# not their ranges (100.64.0.0/10 and fd00::/8 stay allowed).
_METADATA_ADDRESSES = frozenset(
    {ipaddress.ip_address("100.100.100.200"), ipaddress.ip_address("fd00:ec2::254")}
)


def _link_local_or_metadata(host: str) -> bool:
    """A host the runner must never get tokens or questions for.

    Link-local addresses (169.254.0.0/16, fe80::/10, also IPv4-mapped), the two
    metadata addresses above, and the host names of cloud metadata services.
    Private ranges and ``localhost`` stay allowed: test environments live there.
    """
    if host.startswith("["):
        address = ipaddress.IPv6Address(host[1:-1])
        mapped = address.ipv4_mapped
        return (
            address.is_link_local
            or address in _METADATA_ADDRESSES
            or bool(mapped and (mapped.is_link_local or mapped in _METADATA_ADDRESSES))
        )
    try:
        address4 = ipaddress.IPv4Address(host)
    except ValueError:
        return host.split(".")[0] in _METADATA_NAMES
    return address4.is_link_local or address4 in _METADATA_ADDRESSES


def comparable_origin(address: str) -> str:
    """An address as it is compared for uniqueness; one stored before the rule stays as it is."""
    try:
        return normalize_origin(address)
    except FieldError:
        return address


def sign_in_route(
    base_url: str, auth_path: str, settings: Optional[Mapping[str, Any]]
) -> tuple[Any, ...]:
    """What decides where a saved token is sent and how: when it changes, the tokens go.

    The runner posts the refresh token to the sign-in host (the address when
    there is none) and the renewal path, in the cookie of that name.
    """
    stored = settings or {}
    return (
        comparable_origin(base_url),
        comparable_origin(stored["auth_server"]) if stored.get("auth_server") else None,
        auth_path,
        stored.get("refresh_cookie_name") or PERFORMANCE_DEFAULT_REFRESH_COOKIE_NAME,
    )


def normalize_path(value: Any, field: str) -> str:
    """A path of the target: starts with a slash, no host, no spaces."""
    text = str(value or "").strip()
    if not text.startswith("/") or text.startswith("//") or re.search(r"\s", text):
        raise FieldError((field,), "Enter a path that starts with /")
    if len(text) > 500:
        raise FieldError((field,), "The path is longer than 500 characters")
    return text


def _clean_values(
    values: Mapping[str, Any], current: Optional[PerformanceTarget] = None
) -> dict[str, Any]:
    """Validated column values of a save; raises ``FieldError`` or ``PerformanceError``."""
    from qym_platform.services import performance_platform as platform

    kind = values.get("kind") or (current.kind if current else "chat")
    if current is not None and kind != current.kind:
        raise platform.refusal("target_kind_immutable")
    if kind == platform.KIND:
        return platform.clean_target(values, current)
    if kind != "chat":
        raise FieldError(("kind",), "Unknown target kind")
    settings = PlatformSettings()
    name = " ".join(str(values.get("name") or "").split())
    if not 1 <= len(name) <= 200:
        raise FieldError(("name",), "Enter a name of 1 to 200 characters")
    chat_path = values.get("chat_path")
    auth_path = values.get("token_refresh_path")
    stored = dict(current.settings or {}) if current is not None else {}
    merged = {
        "auth_server": stored.get("auth_server"),
        "refresh_cookie_name": stored.get("refresh_cookie_name")
        or PERFORMANCE_DEFAULT_REFRESH_COOKIE_NAME,
    }
    given = values.get("settings") or {}
    if "auth_server" in given:
        server = given["auth_server"]
        merged["auth_server"] = (
            None
            if server in (None, "")
            else normalize_origin(server, "settings.auth_server")
        )
    if given.get("refresh_cookie_name") is not None:
        cookie = str(given["refresh_cookie_name"]).strip()
        if not _COOKIE_NAME.match(cookie):
            raise FieldError(
                ("settings", "refresh_cookie_name"), "Enter a valid cookie name"
            )
        merged["refresh_cookie_name"] = cookie
    max_users = values.get("max_users")
    if max_users is not None:
        if max_users < 1:
            raise FieldError(("max_users",), "Enter at least 1 user, or leave it empty")
        if max_users > settings.performance_max_users:
            raise PerformanceError(
                "over_platform_limit",
                422,
                f"This platform allows at most {settings.performance_max_users} users; "
                f"the target cannot allow {max_users}.",
                {
                    "field": "max_users",
                    "limit": settings.performance_max_users,
                    "value": max_users,
                },
            )
    max_duration_s = values.get("max_duration_s")
    if max_duration_s is not None:
        if max_duration_s < MIN_DURATION_S:
            raise FieldError(
                ("max_duration_s",),
                f"Enter at least {MIN_DURATION_S} seconds, or leave it empty",
            )
        if max_duration_s > settings.performance_max_duration_seconds:
            raise PerformanceError(
                "over_platform_limit",
                422,
                "This platform allows runs of at most "
                f"{settings.performance_max_duration_seconds} seconds; the target cannot "
                f"allow {max_duration_s}.",
                {
                    "field": "max_duration_s",
                    "limit": settings.performance_max_duration_seconds,
                    "value": max_duration_s,
                },
            )
    return {
        "name": name,
        "base_url": normalize_origin(values.get("base_url")),
        "chat_path": normalize_path(
            (
                chat_path
                if chat_path is not None
                else (current.chat_path if current else PERFORMANCE_DEFAULT_CHAT_PATH)
            ),
            "chat_path",
        ),
        "auth_path": normalize_path(
            (
                auth_path
                if auth_path is not None
                else (current.auth_path if current else PERFORMANCE_DEFAULT_AUTH_PATH)
            ),
            "token_refresh_path",
        ),
        "is_production": bool(values.get("is_production")),
        "max_users": max_users,
        "max_duration_s": max_duration_s,
        "settings": merged,
    }


def _snapshot(target: PerformanceTarget) -> dict[str, Any]:
    """What the audit log keeps of a target: no token, not even a hint."""
    return {
        "name": target.name,
        "base_url": target.base_url,
        "chat_path": target.chat_path,
        "token_refresh_path": target.auth_path,
        "is_production": target.is_production,
        "max_users": target.max_users,
        "max_duration_s": target.max_duration_s,
        "settings": dict(target.settings or {}),
        "archived": target.archived_at is not None,
    }


def _token_snapshot(token: Optional[PerformanceTargetToken]) -> dict[str, Any]:
    if token is None:
        return {}
    return {"name": token.name, "hint": token.token_hint, "version": token.version}


def _audit(
    db: Session,
    user: Optional[User],
    action: str,
    target: PerformanceTarget,
    before: dict[str, Any],
    after: dict[str, Any],
) -> None:
    if target.kind == "estishraf_platform":
        from qym_platform.services.performance_redaction import masker

        mask = masker(db, target_id=target.id)
        before, after = mask.json(before), mask.json(after)
    db.add(
        AuditLog(
            actor_user_id=user.id if user else None,
            action=action,
            entity_type=ENTITY,
            entity_id=target.id,
            before=before,
            after=after,
        )
    )


def list_targets(
    db: Session, project_id: str, *, include_archived: bool = True
) -> list[PerformanceTarget]:
    """The project's targets with their tokens, in two statements: active first, by name."""
    query = (
        select(PerformanceTarget)
        .where(PerformanceTarget.project_id == project_id)
        .options(selectinload(PerformanceTarget.tokens))
        .order_by(
            PerformanceTarget.archived_at.is_not(None),
            func.lower(PerformanceTarget.name),
            PerformanceTarget.id,
        )
    )
    if not db.info.get("performance_platform_read"):
        query = query.where(PerformanceTarget.kind == "chat")
    if not include_archived:
        query = query.where(PerformanceTarget.archived_at.is_(None))
    return list(db.scalars(query).all())


def get_target(
    db: Session, project_id: str, target_id: str, *, lock: bool = False
) -> PerformanceTarget:
    """One target of the project; ``lock`` holds its row until the commit (see ``hold_target``).

    Every page route that writes a target (change, archive, restore, token save
    and removal) reads it with ``lock`` before anything else.
    """
    query = select(PerformanceTarget).where(
        PerformanceTarget.id == target_id, PerformanceTarget.project_id == project_id
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    target = db.scalars(query).first()
    if target is None:
        raise target_not_found()
    if lock:
        db.expire(target, ["tokens"])
    return target


def hold_target(db: Session, target_id: str) -> Optional[PerformanceTarget]:
    """Hold one target row until the commit and read it, with its tokens, as it is now.

    The one lock order of the Performance area: the project's runner row, then
    the target row, then its token rows, then run rows. A start holds the runner
    and then the target from its last checks to its commit; every writer of a
    target holds the target. So a Manager's change either waits for the start
    and then sees its run, or commits first and the start sees the change.
    SQLite has no row locks and lets one writer at a time.
    """
    target = db.scalars(
        select(PerformanceTarget)
        .where(PerformanceTarget.id == target_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).first()
    if target is not None:
        db.expire(target, ["tokens"])
    return target


def active_run(
    db: Session,
    *,
    now: datetime,
    target_id: Optional[str] = None,
    runner_id: Optional[str] = None,
) -> Optional[PerformanceRun]:
    """The run that is queued or active on a target or a runner now, by the rules derived on read."""
    query = select(PerformanceRun).where(
        PerformanceRun.status.in_(PERFORMANCE_ACTIVE_RUN_STATUSES)
    )
    if target_id is not None:
        query = query.where(PerformanceRun.target_id == target_id)
    if runner_id is not None:
        query = query.where(PerformanceRun.runner_id == runner_id)
    for run in db.scalars(query.order_by(PerformanceRun.requested_at.desc())):
        if state.effective_status(run, now=now) in state.ACTIVE_STATUSES:
            return run
    return None


def _busy(run: PerformanceRun, words: str) -> PerformanceError:
    return PerformanceError(
        "target_busy",
        409,
        f"Run {run.number} is in progress on this target. Stop it or wait until it "
        f"ends, then {words}.",
        {"run_id": run.id},
    )


def _conflict(
    db: Session, project_id: str, values: Mapping[str, Any], own_id: Optional[str]
) -> Optional[PerformanceError]:
    """The refusal when another target that is not archived has the name or the address.

    Addresses are compared in their canonical form (also one stored before the
    rule, for example by a restore) and names without regard to case.
    """
    others = db.scalars(
        select(PerformanceTarget).where(
            PerformanceTarget.project_id == project_id,
            PerformanceTarget.archived_at.is_(None),
            PerformanceTarget.id != (own_id or ""),
        )
    ).all()
    address = comparable_origin(values["base_url"])
    for other in others:
        if (
            other.kind == values.get("kind", "chat")
            and comparable_origin(other.base_url) == address
        ):
            return PerformanceError(
                "target_address_taken",
                409,
                f'The target "{other.name}" already uses this address.',
                {"target_id": other.id, "name": other.name},
            )
    name = values["name"].casefold()
    for other in others:
        if other.name.casefold() == name:
            return PerformanceError(
                "target_name_taken", 409, "Another target already has this name."
            )
    return None


def _flush_unique(
    db: Session, project_id: str, values: Mapping[str, Any], own_id: Optional[str]
) -> None:
    """Flush, and turn a lost race on the unique indexes into the same refusal as the check."""
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise (
            _conflict(db, project_id, values, own_id)
            or PerformanceError(
                "target_name_taken", 409, "Another target already has this name."
            )
        ) from exc


def create_target(
    db: Session,
    *,
    project: Project,
    user: User,
    values: Mapping[str, Any],
    now: datetime,
) -> PerformanceTarget:
    """Add a target; refuses a name or address another active target has."""
    clean = _clean_values(values)
    if clean.get("kind") == "estishraf_platform":
        from qym_platform.services.performance_redaction import masker

        clean["name"] = masker(db, project_id=project.id).text(clean["name"])[:200]
    conflict = _conflict(db, project.id, clean, None)
    if conflict:
        raise conflict
    target = PerformanceTarget(
        project_id=project.id,
        created_by_user_id=user.id,
        created_at=now,
        updated_at=now,
        **clean,
    )
    db.add(target)
    _flush_unique(db, project.id, clean, None)
    _audit(db, user, "performance.target.create", target, {}, _snapshot(target))
    return target


def update_target(
    db: Session,
    *,
    target: PerformanceTarget,
    user: User,
    values: Mapping[str, Any],
    now: datetime,
) -> PerformanceTarget:
    """Change a target.

    A change of what decides where the saved tokens are sent (the address, the
    sign-in host, the renewal path, the refresh cookie's name) removes the
    tokens and needs a target without a queued or active run. The caller holds
    the target row (``get_target(lock=True)``).
    """
    if target.archived_at is not None:
        raise PerformanceError(
            "target_archived", 409, "This target is archived. Restore it to change it."
        )
    clean = _clean_values(values, target)
    if target.kind == "estishraf_platform":
        from qym_platform.services.performance_redaction import masker

        clean["name"] = masker(db, project_id=target.project_id).text(clean["name"])[
            :200
        ]
    conflict = _conflict(db, target.project_id, clean, target.id)
    if conflict:
        raise conflict
    address_changed = sign_in_route(
        target.base_url, target.auth_path, target.settings
    ) != sign_in_route(clean["base_url"], clean["auth_path"], clean["settings"])
    if target.kind == "estishraf_platform":
        from types import SimpleNamespace
        from qym_platform.services.performance_platform import auth_settings

        address_changed = auth_settings(target) != auth_settings(
            SimpleNamespace(**clean)
        )
    if address_changed:
        run = active_run(db, now=now, target_id=target.id)
        if run is not None:
            raise _busy(run, "change the address or the sign-in settings")
    before = _snapshot(target)
    project_id, target_id = target.project_id, target.id
    for name, value in clean.items():
        setattr(target, name, value)
    touch(target, now)
    removed = []
    if address_changed:
        removed = [_token_snapshot(token) for token in target.tokens]
        if target.kind == "estishraf_platform":
            from qym_platform.services.performance_platform import clear_cookie

            for token in target.tokens:
                clear_cookie(token, now)
        else:
            target.tokens.clear()
    _flush_unique(db, project_id, clean, target_id)
    after = _snapshot(target)
    if removed:
        after["tokens_removed"] = removed
    _audit(db, user, "performance.target.update", target, before, after)
    return target


def archive_target(
    db: Session, *, target: PerformanceTarget, user: User, now: datetime
) -> PerformanceTarget:
    """Hide a target from new runs and keep it for the history. A repeat changes nothing."""
    if target.archived_at is not None:
        return target
    run = active_run(db, now=now, target_id=target.id)
    if run is not None:
        raise _busy(run, "archive the target")
    before = _snapshot(target)
    target.archived_at = now
    touch(target, now)
    db.flush()
    _audit(db, user, "performance.target.archive", target, before, _snapshot(target))
    return target


def restore_target(
    db: Session, *, target: PerformanceTarget, user: User, now: datetime
) -> PerformanceTarget:
    """Bring an archived target back, unless an active target took its name or address."""
    if target.archived_at is None:
        return target
    values = {"name": target.name, "base_url": target.base_url, "kind": target.kind}
    conflict = _conflict(db, target.project_id, values, target.id)
    if conflict:
        raise conflict
    before = _snapshot(target)
    project_id, target_id = target.project_id, target.id
    target.archived_at = None
    touch(target, now)
    _flush_unique(db, project_id, values, target_id)
    _audit(db, user, "performance.target.restore", target, before, _snapshot(target))
    return target


def clean_token(value: Any) -> str:
    """The token a person pasted, without the white space around it; refuses an empty one."""
    text = value.strip() if isinstance(value, str) else ""
    if not text:
        raise PerformanceError(
            "token_empty", 422, "Paste the token: the field is empty."
        )
    if len(text) > TOKEN_MAX_CHARS:
        raise FieldError(
            ("token",), f"The token is longer than {TOKEN_MAX_CHARS} characters"
        )
    return text


def save_token(
    db: Session,
    *,
    target: PerformanceTarget,
    name: str,
    value: Any,
    expires_at: Optional[datetime],
    user: Optional[User],
    now: datetime,
    action: Optional[str] = "performance.target.token",
) -> PerformanceTargetToken:
    """Save or replace one token: encrypted, with its last 4 characters and the next version.

    ``action`` names the audit row; ``None`` leaves the audit to the caller.
    """
    from qym_platform.services import performance_platform as platform

    if target.kind != platform.KIND and name == "session_cookie":
        raise FieldError(("name",), "Unknown token name")
    if target.kind == platform.KIND and name != "session_cookie":
        raise platform.refusal("wrong_target_kind")
    if name not in (*PERFORMANCE_TOKEN_NAMES, "session_cookie"):
        raise FieldError(("name",), "Unknown token name")
    if target.archived_at is not None:
        raise PerformanceError(
            "target_archived",
            409,
            "This target is archived. Restore it to save a token.",
        )
    if not encryption_ready():
        raise PerformanceError(
            "encryption_key_missing",
            409,
            "Tokens cannot be stored: this platform has no encryption key configured.",
        )
    text = (
        platform.clean_cookie(value) if name == "session_cookie" else clean_token(value)
    )
    token = db.scalars(
        select(PerformanceTargetToken)
        .where(
            PerformanceTargetToken.target_id == target.id,
            PerformanceTargetToken.name == name,
        )
        .with_for_update()
    ).first()
    before = _token_snapshot(token)
    if token is None:
        token = PerformanceTargetToken(
            target_id=target.id, name=name, version=0, created_at=now
        )
        db.add(token)
    if name == "session_cookie":
        platform.remember_cookie(token, now, text)
    token.token_encrypted = secret_storage.encrypt_llm_api_key(text)
    from qym_platform.services.performance_redaction import hint_for

    token.token_hint = (
        platform.cookie_hint(text, now) if name == "session_cookie" else hint_for(text)
    )
    token.version = int(token.version or 0) + 1
    token.expires_at = expires_at
    token.updated_by_user_id = user.id if user else None
    touch(token, now)
    db.flush()
    db.expire(target, ["tokens"])
    if action:
        _audit(db, user, action, target, before, _token_snapshot(token))
    return token


def delete_token(
    db: Session, *, target: PerformanceTarget, name: str, user: User, now: datetime
) -> bool:
    """Remove one saved token; False when there was none. Refused while a run uses the target."""
    from qym_platform.services import performance_platform as platform

    if target.kind != platform.KIND and name == "session_cookie":
        raise FieldError(("name",), "Unknown token name")
    if target.kind == platform.KIND and name != "session_cookie":
        raise platform.refusal("wrong_target_kind")
    token = db.scalars(
        select(PerformanceTargetToken).where(
            PerformanceTargetToken.target_id == target.id,
            PerformanceTargetToken.name == name,
        )
    ).first()
    if token is None or (target.kind == platform.KIND and not token.token_encrypted):
        return False
    run = active_run(db, now=now, target_id=target.id)
    if run is not None:
        raise _busy(run, "remove the token")
    before = _token_snapshot(token)
    if target.kind == "estishraf_platform":
        from qym_platform.services.performance_platform import clear_cookie

        clear_cookie(token, now)
    else:
        db.delete(token)
    db.flush()
    db.expire(target, ["tokens"])
    _audit(db, user, "performance.target.token.delete", target, before, {})
    return True


# ---------------------------------------------------------------------------
# Payloads
# ---------------------------------------------------------------------------


def user_names(db: Session, user_ids: Iterable[Optional[str]]) -> dict[str, str]:
    """Display names of the given users, in one statement."""
    ids = {user_id for user_id in user_ids if user_id}
    if not ids:
        return {}
    rows = db.execute(
        select(User.id, User.display_name, User.email).where(User.id.in_(ids))
    ).all()
    return {row[0]: row[1] or row[2] for row in rows}


def token_expired(token: PerformanceTargetToken, now: datetime) -> bool:
    return token.expires_at is not None and token.expires_at <= now


def sign_in_ready(target: PerformanceTarget, now: datetime) -> bool:
    """A refresh token is saved and has not run out."""
    return any(
        token.name
        == ("session_cookie" if target.kind == "estishraf_platform" else REFRESH_TOKEN)
        and bool(token.token_encrypted)
        and not token_expired(token, now)
        for token in target.tokens
    )


def token_hint(
    token: PerformanceTargetToken, names: Mapping[str, str], now: datetime
) -> dict[str, Any]:
    """One saved token as a page sees it: never the value."""
    return {
        "name": token.name,
        "hint": token.token_hint,
        "version": token.version,
        "expires_at": to_api_timestamp(token.expires_at),
        "expired": token_expired(token, now),
        "updated_at": to_api_timestamp(token.updated_at),
        "updated_by": names.get(token.updated_by_user_id or ""),
        "updated_by_user_id": token.updated_by_user_id,
    }


def host_of(base_url: str) -> str:
    return urlsplit(base_url).netloc or base_url


def active_run_ids(
    db: Session, target_ids: Iterable[str], now: datetime
) -> dict[str, str]:
    """``{target id: run id}`` for targets with a queued or active run, in one statement."""
    ids = list(target_ids)
    if not ids:
        return {}
    runs = db.scalars(
        select(PerformanceRun).where(
            PerformanceRun.target_id.in_(ids),
            PerformanceRun.status.in_(PERFORMANCE_ACTIVE_RUN_STATUSES),
        )
    ).all()
    return {
        run.target_id: run.id
        for run in runs
        if state.effective_status(run, now=now) in state.ACTIVE_STATUSES
    }


def _last_runs(
    db: Session, target_ids: list[str], now: datetime
) -> dict[str, dict[str, Any]]:
    """The newest run of each target, in one statement."""
    if not target_ids:
        return {}
    newest = (
        select(
            PerformanceRun.target_id.label("target_id"),
            func.max(PerformanceRun.number).label("number"),
        )
        .where(PerformanceRun.target_id.in_(target_ids))
        .group_by(PerformanceRun.target_id)
        .subquery()
    )
    runs = db.scalars(
        select(PerformanceRun).join(
            newest,
            (PerformanceRun.target_id == newest.c.target_id)
            & (PerformanceRun.number == newest.c.number),
        )
        # Only the status and the times are read: leave the large columns alone.
        .options(
            defer(PerformanceRun.config),
            defer(PerformanceRun.progress),
            defer(PerformanceRun.summary),
        )
    ).all()
    return {
        run.target_id: {
            "id": run.id,
            "number": run.number,
            "status": state.effective_status(run, now=now),
            "verdict": run.verdict,
            "finished_at": to_api_timestamp(state.effective_finished_at(run, now=now)),
        }
        for run in runs
    }


def target_payloads(
    db: Session,
    targets: list[PerformanceTarget],
    *,
    now: datetime,
    can_write: bool,
    is_manager: bool,
    full: bool = False,
) -> list[dict[str, Any]]:
    """Targets as the New run page sees them; ``full`` adds what the Targets list shows.

    A fixed number of statements whatever the number of targets.
    """
    ids = [target.id for target in targets]
    busy = active_run_ids(db, ids, now)
    names = user_names(
        db,
        [
            *(target.created_by_user_id for target in targets),
            *(
                token.updated_by_user_id
                for target in targets
                for token in target.tokens
            ),
        ],
    )
    last = _last_runs(db, ids, now) if full else {}
    rows = []
    for target in targets:
        stored = target.settings or {}
        allowed = (
            can_write
            and target.archived_at is None
            and (is_manager or not target.is_production)
        )
        row: dict[str, Any] = {
            "id": target.id,
            "name": target.name,
            "is_production": target.is_production,
            "base_url": target.base_url,
            "chat_path": target.chat_path,
            "token_refresh_path": target.auth_path,
            "max_users": target.max_users,
            "max_duration_s": target.max_duration_s,
            "settings": {
                "auth_server": stored.get("auth_server"),
                "refresh_cookie_name": stored.get("refresh_cookie_name")
                or PERFORMANCE_DEFAULT_REFRESH_COOKIE_NAME,
            },
            "tokens": [
                token_hint(token, names, now)
                for token in target.tokens
                if token.token_encrypted
            ],
            "sign_in_ready": sign_in_ready(target, now),
            "active_run_id": busy.get(target.id),
            "can_start": allowed,
            "can_save_tokens": allowed,
        }
        if target.kind == "estishraf_platform":
            row.pop("chat_path")
            row.pop("token_refresh_path")
            row.update(kind=target.kind, settings=stored)
        if full or target.kind == "estishraf_platform":
            row.update(
                archived_at=to_api_timestamp(target.archived_at),
                created_by=names.get(target.created_by_user_id or ""),
                created_by_user_id=target.created_by_user_id,
                created_at=to_api_timestamp(target.created_at),
                updated_at=to_api_timestamp(target.updated_at),
                last_run=last.get(target.id),
            )
        if target.kind == "estishraf_platform":
            from qym_platform.services import performance_views as views

            latest = db.scalar(
                select(PerformanceRun)
                .where(PerformanceRun.target_id == target.id)
                .order_by(
                    PerformanceRun.requested_at.desc(), PerformanceRun.number.desc()
                )
                .limit(1)
            )
            row["last_run"] = (
                views.run_row(
                    latest,
                    now=now,
                    names=views._run_names(db, [latest]),
                    reports=views._report_ids(db, [latest.id]),
                )
                if latest
                else None
            )
        rows.append(row)
    return rows


def target_summaries(
    db: Session, targets: list[PerformanceTarget], now: datetime
) -> list[dict[str, Any]]:
    """Targets in short, for Home and the history filter; archived ones too."""
    busy = active_run_ids(db, [target.id for target in targets], now)
    return [
        {
            "id": target.id,
            "name": target.name,
            "is_production": target.is_production,
            "host": host_of(target.base_url),
            "sign_in_ready": sign_in_ready(target, now),
            "active_run_id": busy.get(target.id),
            "archived": target.archived_at is not None,
        }
        for target in targets
    ]
