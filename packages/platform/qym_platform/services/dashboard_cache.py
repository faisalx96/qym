"""Bounded, process-local reuse of immutable dashboard projection snapshots."""

from __future__ import annotations

import json
import threading
import time
from collections import OrderedDict
from concurrent.futures import Future


class DashboardSnapshotCache:
    """Share in-flight work without holding the cache lock during database reads.

    Keys must include database identity, authorization scope and projection
    revision. Values contain no principal-specific project permissions. A
    process restart only loses an optimization; PostgreSQL remains authoritative.
    """

    def __init__(self, *, max_entries=32, max_bytes=4 * 1024 * 1024, ttl=15.0):
        self.max_entries, self.max_bytes, self.ttl = max_entries, max_bytes, ttl
        self._lock = threading.Lock()
        self._entries = OrderedDict()
        self._inflight = {}
        self._bytes = 0

    def get_or_compute(self, key, compute):
        now = time.monotonic()
        with self._lock:
            expired = [
                k for k, (deadline, _, _) in self._entries.items() if deadline <= now
            ]
            for k in expired:
                self._bytes -= self._entries.pop(k)[1]
            if key in self._entries:
                self._entries.move_to_end(key)
                return self._entries[key][2]
            future = self._inflight.get(key)
            owner = future is None
            if owner:
                future = self._inflight[key] = Future()
        if not owner:
            return future.result()
        try:
            value = compute()
            size = len(json.dumps(value, separators=(",", ":"), default=str).encode())
            with self._lock:
                if size <= self.max_bytes and self.max_entries > 0:
                    while self._entries and (
                        len(self._entries) >= self.max_entries
                        or self._bytes + size > self.max_bytes
                    ):
                        self._bytes -= self._entries.popitem(last=False)[1][1]
                    self._entries[key] = (time.monotonic() + self.ttl, size, value)
                    self._bytes += size
            future.set_result(value)
            return value
        except BaseException as exc:
            future.set_exception(exc)
            raise
        finally:
            with self._lock:
                self._inflight.pop(key, None)
