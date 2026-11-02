"""Throttle password guessing on the email/password sign-in endpoints.

Failed attempts are counted over sliding windows, under three limits:

- per email from one client address (default 5 in 5 minutes): the strict
  lock. Only the client that made the wrong attempts is refused, so one
  client cannot lock a person out from everywhere; the right password from
  another client still works.
- per client address over every email (default 30 in 5 minutes).
- per email over every client together (default 50 in 15 minutes): a high
  ceiling that bounds guessing spread over many addresses.

Past a limit, attempts are refused with 429 until enough failures leave the
window, whether or not the password is right, so guessing cannot continue
behind the limit. Unknown and known emails are counted the same way, so the
limits do not reveal which accounts exist. "Account already exists" answers
at sign-up count only against the client, never the email.

The endpoints check and count in one step (``begin``): an attempt counts as
a failure from the moment it passes the check until it turns out to be right
(``succeeded``) or ends without a verdict (``cancel``). Checking a password
takes hundreds of milliseconds, so concurrent wrong passwords would otherwise
all pass the check before the first one was counted.

The counters live in the API process. With several replicas each one counts on
its own, which multiplies the budget by the replica count but keeps the
per-process cost of guessing bounded.
"""

from __future__ import annotations

import math
import os
import threading
import time
from collections import deque
from typing import Callable, Deque, Dict, List, Mapping, Optional, Set, Tuple

from fastapi import HTTPException, Request

from qym_platform.log import get_logger
from qym_platform.settings import PlatformSettings

logger = get_logger(__name__)

_MAX_TRACKED_KEYS = 50_000


class Attempt:
    """One attempt in flight, counted as a failure under ``keys`` at ``at``."""

    __slots__ = ("keys", "at", "pair")

    def __init__(self, keys: Tuple[str, ...], at: float, pair: Optional[str]) -> None:
        self.keys = keys
        self.at = at
        self.pair = pair


class LoginThrottle:
    def __init__(
        self,
        *,
        max_per_email: int,
        max_per_client: int,
        window_seconds: int,
        email_ceiling: int = 50,
        email_ceiling_window_seconds: int = 900,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        # ``max_per_email`` is the strict lock: failures for one email from
        # one client address.
        self.max_per_email = max(1, int(max_per_email))
        self.max_per_client = max(1, int(max_per_client))
        self.window_seconds = max(1, int(window_seconds))
        self.email_ceiling = max(1, int(email_ceiling))
        self.email_ceiling_window_seconds = max(1, int(email_ceiling_window_seconds))
        self._clock = clock
        self._failures: Dict[str, Deque[float]] = {}
        self._in_flight: Set[Attempt] = set()
        self._lock = threading.Lock()

    @staticmethod
    def _pair_key(email: str, client: str) -> str:
        return "pair:" + client + "\x00" + email

    def _window(self, key: str) -> int:
        if key.startswith("email:"):
            return self.email_ceiling_window_seconds
        return self.window_seconds

    def _recent(self, key: str, now: float) -> Deque[float]:
        entries = self._failures.get(key)
        if entries is None:
            return deque()
        cutoff = now - self._window(key)
        while entries and entries[0] <= cutoff:
            entries.popleft()
        if not entries:
            self._failures.pop(key, None)
        return entries

    def _retry_after(self, key: str, limit: int, now: float) -> Optional[int]:
        entries = self._recent(key, now)
        if len(entries) < limit:
            return None
        # Allowed again once enough failures have aged out of the window.
        release_at = entries[len(entries) - limit] + self._window(key)
        return max(1, math.ceil(release_at - now))

    def _wait(self, limits: List[Tuple[str, int]], now: float) -> Optional[int]:
        """Seconds until every limit allows one more attempt; None when they
        do now. Call under ``self._lock``."""
        waits = [
            wait
            for wait in (self._retry_after(key, limit, now) for key, limit in limits)
            if wait is not None
        ]
        return max(waits) if waits else None

    def _refuse(self, limits: List[Tuple[str, int]]) -> None:
        now = self._clock()
        with self._lock:
            wait = self._wait(limits, now)
        if wait is not None:
            raise _too_many(wait)

    def _limits(self, email: str, client: str) -> List[Tuple[str, int]]:
        return [
            (self._pair_key(email, client), self.max_per_email),
            ("client:" + client, self.max_per_client),
            ("email:" + email, self.email_ceiling),
        ]

    def check(self, email: str, client: str) -> None:
        """Raise 429 when this client used up its attempts for this email or
        overall, or when the email reached its ceiling across all clients.

        Counts nothing. The endpoints use ``begin``, which checks and counts
        in one step."""
        self._refuse(self._limits(email, client))

    def check_client(self, client: str) -> None:
        """Raise 429 when this client used up its failed attempts (sign-up)."""
        self._refuse([("client:" + client, self.max_per_client)])

    def begin(self, email: str, client: str) -> Attempt:
        """Check the limits for a sign-in and count it as a failure, in one
        step under the lock, or raise 429.

        Until the caller settles it (``succeeded``, ``failed`` or
        ``cancel``), the attempt counts toward the strict lock, the client's
        cap and the email's ceiling, so concurrent wrong passwords cannot all
        pass the check before the first one is counted."""
        return self._begin(self._limits(email, client), self._pair_key(email, client))

    def begin_client(self, client: str) -> Attempt:
        """``begin`` for sign-up: the attempt counts only for the client."""
        return self._begin([("client:" + client, self.max_per_client)], None)

    def _begin(self, limits: List[Tuple[str, int]], pair: Optional[str]) -> Attempt:
        now = self._clock()
        with self._lock:
            wait = self._wait(limits, now)
            if wait is None:
                attempt = Attempt(tuple(key for key, _ in limits), now, pair)
                self._append(attempt.keys, now)
                self._in_flight.add(attempt)
        if wait is not None:
            raise _too_many(wait)
        return attempt

    def failed(self, attempt: Attempt) -> None:
        """The attempt failed: it stays counted."""
        with self._lock:
            self._in_flight.discard(attempt)

    def succeeded(self, attempt: Attempt) -> None:
        """The password was right (at sign-up: the account is new), so the
        attempt is not a failure. A sign-in also clears this client's strict
        lock for the email, except for its attempts still in flight. The
        per-email ceiling and the per-client count only age out."""
        with self._lock:
            self._in_flight.discard(attempt)
            self._uncount(attempt)
            if attempt.pair is not None:
                pending = sorted(
                    other.at for other in self._in_flight if other.pair == attempt.pair
                )
                if pending:
                    self._failures[attempt.pair] = deque(pending)
                else:
                    self._failures.pop(attempt.pair, None)

    def cancel(self, attempt: Attempt) -> None:
        """The request ended without a verdict (an invalid form, an error):
        the attempt is not counted."""
        with self._lock:
            self._in_flight.discard(attempt)
            self._uncount(attempt)

    def _uncount(self, attempt: Attempt) -> None:
        for key in attempt.keys:
            entries = self._failures.get(key)
            if entries is None:
                continue
            try:
                entries.remove(attempt.at)
            except ValueError:
                pass
            if not entries:
                self._failures.pop(key, None)

    def _append(self, keys: Tuple[str, ...], now: float) -> None:
        """Count a failure under ``keys``. Call under ``self._lock``."""
        if len(self._failures) >= _MAX_TRACKED_KEYS:
            # Drop expired keys first; a flood of distinct keys must not
            # grow memory without bound.
            for key in list(self._failures):
                self._recent(key, now)
            while len(self._failures) >= _MAX_TRACKED_KEYS:
                self._failures.pop(next(iter(self._failures)))
        for key in keys:
            self._failures.setdefault(key, deque()).append(now)

    def _record(self, keys: Tuple[str, ...]) -> None:
        now = self._clock()
        with self._lock:
            self._append(keys, now)

    def record_failure(self, email: str, client: str) -> None:
        self._record((self._pair_key(email, client), "client:" + client, "email:" + email))

    def record_client_failure(self, client: str) -> None:
        """A failure that says nothing about the email's password (sign-up)."""
        self._record(("client:" + client,))

    def record_success(self, email: str, client: str) -> None:
        """Clear this client's strict lock for the email. The per-email
        ceiling and the per-client count only age out."""
        with self._lock:
            self._failures.pop(self._pair_key(email, client), None)


def _too_many(wait: int) -> HTTPException:
    # Neither the email nor the client address: the limit itself is the signal.
    logger.warning("sign-in attempts throttled (retry after %ds)", wait)
    return HTTPException(
        status_code=429,
        detail=f"Too many sign-in attempts. Try again in {_describe_wait(wait)}.",
        headers={"Retry-After": str(wait)},
    )


def _describe_wait(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} second{'s' if seconds != 1 else ''}"
    minutes = math.ceil(seconds / 60)
    return f"{minutes} minute{'s' if minutes != 1 else ''}"


_CREATE_LOCK = threading.Lock()


def login_throttle(request: Request) -> LoginThrottle:
    """The app's throttle, created on first use from the platform settings.

    Created under a lock: concurrent first requests must share one throttle,
    or the failures counted in the copies that lose are dropped.
    """
    state = request.app.state
    throttle = getattr(state, "login_throttle", None)
    if throttle is not None:
        return throttle
    with _CREATE_LOCK:
        throttle = getattr(state, "login_throttle", None)
        if throttle is None:
            settings = PlatformSettings()
            throttle = LoginThrottle(
                max_per_email=settings.auth_login_max_failures_per_email,
                max_per_client=settings.auth_login_max_failures_per_client,
                window_seconds=settings.auth_login_failure_window_seconds,
                email_ceiling=settings.auth_login_email_ceiling,
                email_ceiling_window_seconds=settings.auth_login_email_ceiling_window_seconds,
            )
            state.login_throttle = throttle
    return throttle


def client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


_DEV_ENVIRONMENTS = {"dev", "development", "local", "test", "testing"}


def proxy_trust_warning(
    settings: PlatformSettings, environ: Optional[Mapping[str, str]] = None
) -> Optional[str]:
    """A startup warning when the per-client limit will see one shared address.

    uvicorn reads X-Forwarded-For only from FORWARDED_ALLOW_IPS (default
    127.0.0.1). Behind an ingress without that setting every browser has the
    ingress address, so one client's failures lock every password sign-in.
    """
    from qym_platform.auth_oidc import local_auth_enabled

    environ = os.environ if environ is None else environ
    if not local_auth_enabled(settings):
        return None
    if str(settings.environment or "").strip().lower() in _DEV_ENVIRONMENTS:
        return None
    if str(environ.get("FORWARDED_ALLOW_IPS") or "").strip():
        return None
    if "--forwarded-allow-ips" in str(environ.get("QYM_UVICORN_ARGS") or ""):
        return None
    return (
        "Password sign-in is enabled but no proxy is trusted (FORWARDED_ALLOW_IPS "
        "or --forwarded-allow-ips in QYM_UVICORN_ARGS is unset). Behind an ingress "
        "every client shares the ingress address, so the per-client failure limit "
        "applies to all of them together. Set FORWARDED_ALLOW_IPS to the ingress "
        "or pod CIDR."
    )
