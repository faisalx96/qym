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
from typing import Callable, Deque, Dict, List, Mapping, Optional, Tuple

from fastapi import HTTPException, Request

from qym_platform.settings import PlatformSettings

_MAX_TRACKED_KEYS = 50_000


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

    def _refuse(self, limits: List[Tuple[str, int]]) -> None:
        now = self._clock()
        with self._lock:
            waits = [
                wait
                for wait in (self._retry_after(key, limit, now) for key, limit in limits)
                if wait is not None
            ]
        if waits:
            wait = max(waits)
            raise HTTPException(
                status_code=429,
                detail=f"Too many sign-in attempts. Try again in {_describe_wait(wait)}.",
                headers={"Retry-After": str(wait)},
            )

    def check(self, email: str, client: str) -> None:
        """Raise 429 when this client used up its attempts for this email or
        overall, or when the email reached its ceiling across all clients."""
        self._refuse(
            [
                (self._pair_key(email, client), self.max_per_email),
                ("client:" + client, self.max_per_client),
                ("email:" + email, self.email_ceiling),
            ]
        )

    def check_client(self, client: str) -> None:
        """Raise 429 when this client used up its failed attempts (sign-up)."""
        self._refuse([("client:" + client, self.max_per_client)])

    def _record(self, keys: Tuple[str, ...]) -> None:
        now = self._clock()
        with self._lock:
            if len(self._failures) >= _MAX_TRACKED_KEYS:
                # Drop expired keys first; a flood of distinct keys must not
                # grow memory without bound.
                for key in list(self._failures):
                    self._recent(key, now)
                while len(self._failures) >= _MAX_TRACKED_KEYS:
                    self._failures.pop(next(iter(self._failures)))
            for key in keys:
                self._failures.setdefault(key, deque()).append(now)

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


def _describe_wait(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} second{'s' if seconds != 1 else ''}"
    minutes = math.ceil(seconds / 60)
    return f"{minutes} minute{'s' if minutes != 1 else ''}"


def login_throttle(request: Request) -> LoginThrottle:
    """The app's throttle, created on first use from the platform settings."""
    state = request.app.state
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
