"""Throttle password guessing on the email/password sign-in endpoints.

Failed attempts are counted per email and per client address over a sliding
window. Once either count reaches its limit, further attempts for that email or
from that address are refused with 429 until the oldest failure leaves the
window, whether or not the password is right, so guessing cannot continue
behind the limit. Unknown and known emails are counted the same way, so the
limit does not reveal which accounts exist.

The counters live in the API process. With several replicas each one counts on
its own, which multiplies the budget by the replica count but keeps the
per-process cost of guessing bounded.
"""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from typing import Callable, Deque, Dict, Optional

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
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_per_email = max(1, int(max_per_email))
        self.max_per_client = max(1, int(max_per_client))
        self.window_seconds = max(1, int(window_seconds))
        self._clock = clock
        self._failures: Dict[str, Deque[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> Deque[float]:
        entries = self._failures.get(key)
        if entries is None:
            return deque()
        cutoff = now - self.window_seconds
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
        release_at = entries[len(entries) - limit] + self.window_seconds
        return max(1, math.ceil(release_at - now))

    def check(self, email: str, client: str) -> None:
        """Raise 429 when this email or client used up its failed attempts."""
        now = self._clock()
        with self._lock:
            waits = [
                wait
                for wait in (
                    self._retry_after("email:" + email, self.max_per_email, now),
                    self._retry_after("client:" + client, self.max_per_client, now),
                )
                if wait is not None
            ]
        if waits:
            wait = max(waits)
            raise HTTPException(
                status_code=429,
                detail=f"Too many sign-in attempts. Try again in {_describe_wait(wait)}.",
                headers={"Retry-After": str(wait)},
            )

    def record_failure(self, email: str, client: str) -> None:
        now = self._clock()
        with self._lock:
            if len(self._failures) >= _MAX_TRACKED_KEYS:
                # Drop expired keys first; a flood of distinct keys must not
                # grow memory without bound.
                for key in list(self._failures):
                    self._recent(key, now)
                while len(self._failures) >= _MAX_TRACKED_KEYS:
                    self._failures.pop(next(iter(self._failures)))
            for key in ("email:" + email, "client:" + client):
                self._failures.setdefault(key, deque()).append(now)

    def record_success(self, email: str) -> None:
        with self._lock:
            self._failures.pop("email:" + email, None)


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
        )
        state.login_throttle = throttle
    return throttle


def client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"
