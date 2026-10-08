from __future__ import annotations

import asyncio
import json
import math
import os
import random
import sys
import threading
import time
import uuid
from dataclasses import asdict, is_dataclass
from dataclasses import dataclass
from datetime import date, datetime, time as dt_time, timezone
from queue import Empty, Full
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib import request

from .tls import urlopen
from ._backlog import EventBacklog

# Enable debug logging with QYM_PLATFORM_DEBUG=1 or QYM_PLATFORM_DEBUG=/path/to/file.log
_DEBUG = os.environ.get("QYM_PLATFORM_DEBUG", "")
_DEBUG_FILE = None
if _DEBUG and _DEBUG.lower() not in ("0", "false", "no", ""):
    if _DEBUG.lower() in ("1", "true", "yes"):
        _DEBUG_FILE = sys.stderr
    else:
        # Treat as file path
        try:
            _DEBUG_FILE = open(_DEBUG, "a", buffering=1)  # Line-buffered
        except Exception:
            _DEBUG_FILE = sys.stderr


def _spill_limit(client: Any) -> int:
    """Disk spill allowance: QYM_PLATFORM_EVENT_SPILL_BYTES, else the class default."""
    raw = os.environ.get("QYM_PLATFORM_EVENT_SPILL_BYTES", "").strip()
    if raw:
        try:
            value = int(raw)
        except ValueError:
            value = -1
        if value >= 0:
            return value
        _debug(f"ignoring invalid QYM_PLATFORM_EVENT_SPILL_BYTES={raw!r}")
    return client.MAX_PENDING_DISK_BYTES


def _debug(msg: str) -> None:
    if _DEBUG_FILE:
        ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        print(f"[{ts}] [platform-stream] {msg}", file=_DEBUG_FILE, flush=True)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _env_number(name: str, default: float, *, minimum: float = 0.0) -> float:
    """A numeric env override (``name``) or ``default`` when unset/invalid."""
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        _debug(f"ignoring invalid {name}={raw!r}")
        return default
    if not math.isfinite(value) or value < minimum:
        _debug(f"ignoring out-of-range {name}={raw!r}")
        return default
    return value


TRUNCATION_MARKER = "…[truncated by qym: {omitted} bytes omitted]"


class _Truncator:
    """Caps every string in a payload at ``limit`` UTF-8 bytes; counts the cuts."""

    def __init__(self, limit: Optional[int]) -> None:
        self.limit = limit if limit and limit > 0 else None
        self.truncated = 0
        # Characters of string data kept; a cheap bound on payload size.
        self.kept_chars = 0

    def __call__(self, text: str) -> str:
        self.kept_chars += len(text)
        limit = self.limit
        # A str of n chars encodes to at most 4n bytes: skip the encode for
        # the common short value.
        if limit is None or len(text) * 4 <= limit:
            return text
        encoded = text.encode("utf-8", "surrogatepass")
        if len(encoded) <= limit:
            return text
        self.truncated += 1
        head = encoded[:limit].decode("utf-8", "ignore")
        self.kept_chars -= len(text) - len(head)
        return head + TRUNCATION_MARKER.format(omitted=len(encoded) - limit)


def _sanitize_for_json(obj: Any, _cap: Optional[_Truncator] = None) -> Any:
    """Recursively coerce platform event payloads into JSON-safe values.

    With ``_cap``, every string longer than its byte limit is cut and marked
    (``TRUNCATION_MARKER``) so one huge output or span attribute cannot make
    an oversized request.
    """
    if obj is None or isinstance(obj, (int, bool)):
        return obj
    if isinstance(obj, str):
        return _cap(obj) if _cap is not None else obj
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, (datetime, date, dt_time)):
        return obj.isoformat()
    if isinstance(obj, uuid.UUID):
        return str(obj)
    if isinstance(obj, Path):
        return _sanitize_for_json(str(obj), _cap)
    if is_dataclass(obj) and not isinstance(obj, type):
        return _sanitize_for_json(asdict(obj), _cap)
    if isinstance(obj, dict):
        return {str(k): _sanitize_for_json(v, _cap) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_sanitize_for_json(v, _cap) for v in obj]
    if hasattr(obj, "model_dump"):
        try:
            return _sanitize_for_json(obj.model_dump(mode="json"), _cap)
        except Exception:
            try:
                return _sanitize_for_json(obj.model_dump(), _cap)
            except Exception:
                pass
    if hasattr(obj, "dict"):
        try:
            return _sanitize_for_json(obj.dict(), _cap)
        except Exception:
            pass
    return _sanitize_for_json(str(obj), _cap)


def _post_json(
    url: str, payload: Dict[str, Any], api_key: str, *, timeout: float = 30
) -> Dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
        return json.loads(body) if body else {}


def _post_ndjson(
    url: str, ndjson: str, api_key: str, *, timeout: float = 30
) -> Optional[Dict[str, Any]]:
    """POST a batch; return the platform's JSON verdict when it sends one."""
    data = ndjson.encode("utf-8")
    req = request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/x-ndjson",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urlopen(req, timeout=timeout) as resp:
        body = resp.read()
    try:
        parsed = json.loads(body.decode("utf-8")) if body else None
    except (UnicodeDecodeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _rejected_events(response: Any, sent: int) -> "tuple[int, list[dict]]":
    """Events a 2xx batch response says the platform refused.

    Newer platforms apply the valid part of a batch and list the rest; older
    platforms return no ``rejected`` field, which counts as none refused.
    """
    if not isinstance(response, dict):
        return 0, []
    try:
        count = int(response.get("rejected") or 0)
    except (TypeError, ValueError):
        return 0, []
    details = response.get("rejected_events")
    if not isinstance(details, list):
        details = []
    return max(0, min(count, sent)), [row for row in details if isinstance(row, dict)]


def _http_rejection(exc: BaseException) -> "tuple[str, bool]":
    """Reason for a refused request, and whether it refused the events themselves.

    Platforms that validate each event answer a request whose events are all
    invalid with a 4xx listing ``rejected_events``: the platform saw those
    events and refused them. Any other 4xx (unknown run, a proxy's size limit)
    says nothing about the events; they count as undelivered.
    """
    reason = f"HTTP {getattr(exc, 'code', '?')}"
    try:
        body = json.loads(exc.read(65536).decode("utf-8"))  # type: ignore[attr-defined]
    except Exception:
        return reason, False
    if not isinstance(body, dict):
        return reason, False
    rows = body.get("rejected_events")
    verdict = isinstance(rows, list) and bool(body.get("rejected"))
    if isinstance(rows, list) and rows and isinstance(rows[0], dict):
        if rows[0].get("error"):
            return f"{reason}: {rows[0]['error']}", verdict
    if isinstance(body.get("detail"), str):
        return f"{reason}: {body['detail']}", verdict
    return reason, verdict


def _http_error_reason(exc: BaseException) -> str:
    """Best-effort reason for a refused request, read from its JSON body."""
    return _http_rejection(exc)[0]


def _is_poison_error(exc: BaseException) -> bool:
    """True when the server deterministically rejected the payload (4xx).

    Retrying such a request verbatim can never succeed, so the batch should
    be isolated per event instead. 408 (request timeout) and 429 (rate limit)
    are transient despite being 4xx.
    """
    code = getattr(exc, "code", None)
    return isinstance(code, int) and 400 <= code < 500 and code not in (408, 429)


def _response_header(exc: BaseException, name: str) -> str:
    headers = getattr(exc, "headers", None)
    try:
        return str(headers.get(name) or "").strip() if headers is not None else ""
    except Exception:
        return ""


def _run_wide_rejection(exc: BaseException) -> Optional[str]:
    """Why the platform refuses every upload for this run, or None.

    These rejections are about the request, not the events in it: the run is
    closed (410), under review, the key was revoked, or its project archived.
    Resending the batch one event at a time can never succeed, so the stream
    stops instead. Other 4xx answers stay per-event (isolated one by one).
    """
    code = getattr(exc, "code", None)
    if code == 410:
        return "HTTP 410: the run is closed to updates"
    run_state = _response_header(exc, "X-Qym-Run-State").lower()
    if code == 409 and run_state == "in_review":
        status = _response_header(exc, "X-Qym-Run-Status") or "under review"
        return (
            f"HTTP 409: the run is under review ({status}); its results stay "
            "frozen until a project manager withdraws the review decision"
        )
    key_state = _response_header(exc, "X-Qym-Key-State").lower()
    if code == 401 or (isinstance(code, int) and 400 <= code < 500 and key_state):
        return _http_error_reason(exc)
    return None


@dataclass
class PlatformRunHandle:
    run_id: str
    live_url: str


class PlatformEventStream:
    """Background NDJSON event streamer.

    Minimal, dependency-free implementation using stdlib urllib.
    """

    # Overall close() budget: block until the queue drains or this elapses
    # (env override: QYM_PLATFORM_CLOSE_TIMEOUT). Deliberately generous —
    # abandoning the backlog silently loses run items on the platform.
    CLOSE_JOIN_TIMEOUT = 120.0
    # How often close() reports upload progress while draining.
    CLOSE_PROGRESS_INTERVAL = 2.0
    # During shutdown, give up on a dead endpoint after this many consecutive
    # send failures instead of burning the whole close budget.
    CLOSE_GIVEUP_FAILURES = 6
    # Per-request client timeouts. They must clearly exceed the platform's
    # per-request statement budget (30s): a client that gives up first
    # re-sends the batch while the server is still applying it, and the two
    # requests contend for the same run row. Env overrides:
    # QYM_PLATFORM_REQUEST_TIMEOUT (mid-run) and
    # QYM_PLATFORM_DRAIN_REQUEST_TIMEOUT (close() drain and direct sends).
    REQUEST_TIMEOUT = 60.0
    DRAIN_REQUEST_TIMEOUT = 45.0
    SYNC_SEND_TIMEOUT = DRAIN_REQUEST_TIMEOUT
    SYNC_SEND_RETRIES = 3
    HEARTBEAT_INTERVAL = 15.0
    # Default wall-clock budget for flush() barriers between items.
    FLUSH_TIMEOUT = 10.0
    # Batch caps per POST. Count keeps server-side work bounded; bytes keeps
    # requests under common reverse-proxy body limits.
    MAX_BATCH_EVENTS = 200
    MAX_BATCH_BYTES = 2_000_000
    # Cadence flush for live views when the queue is quiet. Each POST is one
    # platform transaction on the run row, so the cadence stays near 1/s and
    # stretches (up to MAX_FLUSH_INTERVAL) while POSTs are slow
    # (> SLOW_POST_SECONDS). Batch caps still flush immediately.
    # Env override: QYM_PLATFORM_FLUSH_INTERVAL.
    FLUSH_INTERVAL = 1.0
    MAX_FLUSH_INTERVAL = 5.0
    SLOW_POST_SECONDS = 1.0
    RETRY_BACKOFF_BASE = 0.5
    RETRY_BACKOFF_MAX = 10.0
    # Any single string in an event payload (task output, span attribute,
    # input) is cut to this many UTF-8 bytes and marked. Env override:
    # QYM_PLATFORM_MAX_FIELD_BYTES (0 disables the cap).
    MAX_FIELD_BYTES = 256 * 1024
    # Whole-event ceiling after field truncation; larger events are cut
    # further (smaller per-field limit) until they fit.
    MAX_EVENT_BYTES = MAX_BATCH_BYTES
    # Span events are best-effort: wait at most this long for backlog room
    # rather than blocking the caller (often the event loop).
    SPAN_ENQUEUE_TIMEOUT = 0.1
    MAX_PENDING_MEMORY_BYTES = 16 * 1024 * 1024
    # Overflow spool in the temp dir; QYM_PLATFORM_EVENT_SPILL_BYTES overrides it
    # (0 = never spill: the platform image sets that, events wait in memory).
    MAX_PENDING_DISK_BYTES = 256 * 1024 * 1024

    def __init__(self, platform_url: str, api_key: str, run_id: str) -> None:
        self.platform_url = platform_url.rstrip("/")
        self.api_key = api_key
        self.run_id = run_id
        # Delivery counters, updated by the flush thread; readable by callers
        # after close() to know whether the platform got everything.
        self.sent_events = 0
        self.dropped_events = 0
        # Subset of dropped_events: events the platform refused as invalid
        # (validation, reused sequence, a value its database refuses).
        # Resending them can never succeed; the platform records them and
        # flags the run, so they do not hold the run's completion.
        self.rejected_events = 0
        self._first_rejection: Optional[str] = None
        self._first_refusal: Optional[str] = None
        # Best-effort span events skipped because the backlog was full. Not
        # part of dropped_events: they never hold the run's completion.
        self.dropped_spans = 0
        # Events whose oversized string fields were cut before upload.
        self.truncated_events = 0
        self._truncation_warned = False
        self._request_timeout = _env_number(
            "QYM_PLATFORM_REQUEST_TIMEOUT", float(self.REQUEST_TIMEOUT), minimum=1.0
        )
        self._drain_request_timeout = _env_number(
            "QYM_PLATFORM_DRAIN_REQUEST_TIMEOUT",
            float(self.DRAIN_REQUEST_TIMEOUT),
            minimum=1.0,
        )
        self._flush_interval = _env_number(
            "QYM_PLATFORM_FLUSH_INTERVAL", float(self.FLUSH_INTERVAL)
        )
        self._max_field_bytes = int(
            _env_number("QYM_PLATFORM_MAX_FIELD_BYTES", float(self.MAX_FIELD_BYTES))
        )
        # Serializes every POST of this run's events: the flush thread's batch
        # and direct sends (run_completed, SIGINT STOPPED, post-close emits)
        # never race each other on the platform's run row.
        self._send_lock = threading.Lock()
        self._sync_send_timeout = _env_number(
            "QYM_PLATFORM_DRAIN_REQUEST_TIMEOUT",
            float(self.SYNC_SEND_TIMEOUT),
            minimum=1.0,
        )
        self._consecutive_failures = 0
        self._seq = 0
        self._seq_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._q = EventBacklog(self.MAX_PENDING_MEMORY_BYTES, _spill_limit(self))
        self._active_emitters = 0
        self._accepting = True
        self._delivery_error: Optional[BaseException] = None
        self._stop = threading.Event()
        self._remote_closed = threading.Event()
        self._closing = False
        self._closed = False
        # Daemonize so a stuck flush cannot pin the CLI after the run has finished.
        self._thread = threading.Thread(
            target=self._loop, name="qym-platform-stream", daemon=True
        )
        self._thread.start()

    def next_sequence(self) -> int:
        with self._seq_lock:
            self._seq += 1
            return self._seq

    def _sanitize_payload(self, type_: str, payload: Dict[str, Any]) -> Any:
        """JSON-safe payload with oversized strings cut to fit one request.

        Strings are capped at ``MAX_FIELD_BYTES``; if the event is still over
        ``MAX_EVENT_BYTES`` (many large fields), the per-field cap shrinks
        until it fits. Truncated payloads carry ``_qym_truncated`` (ignored by
        the platform's payload models, kept in the raw event log).
        """
        limit: Optional[int] = self._max_field_bytes or None
        cap = _Truncator(limit)
        clean = _sanitize_for_json(payload, cap)
        if limit is not None and isinstance(clean, dict):
            # Only payloads carrying lots of string data can be oversized;
            # skip the extra serialization for everything else.
            while (
                limit > 1024
                and cap.kept_chars * 4 > self.MAX_EVENT_BYTES // 2
                and len(json.dumps(clean, ensure_ascii=False).encode("utf-8"))
                > self.MAX_EVENT_BYTES
            ):
                limit //= 4
                cap = _Truncator(limit)
                clean = _sanitize_for_json(payload, cap)
        if cap.truncated and isinstance(clean, dict):
            clean["_qym_truncated"] = {
                "fields": cap.truncated,
                "max_field_bytes": limit,
            }
            self.truncated_events += 1
            if not self._truncation_warned:
                self._truncation_warned = True
                print(
                    f"qym: WARNING: a platform {type_} event had {cap.truncated} "
                    f"string field(s) over {limit} bytes; they were truncated for "
                    "upload (local results keep the full values). Raise "
                    "QYM_PLATFORM_MAX_FIELD_BYTES to send more.",
                    file=sys.stderr,
                )
        return clean

    def _build_event(self, type_: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "schema_version": 1,
            "event_id": str(uuid.uuid4()),
            "sequence": self.next_sequence(),
            "sent_at": _utc_now(),
            "type": type_,
            "run_id": self.run_id,
            "payload": self._sanitize_payload(type_, payload),
        }

    def _post(self, ndjson: str, timeout: float) -> Optional[Dict[str, Any]]:
        """POST events for this run, one request at a time per stream."""
        with self._send_lock:
            return _post_ndjson(
                f"{self.platform_url}/v1/runs/{self.run_id}/events",
                ndjson,
                self.api_key,
                timeout=timeout,
            )

    def _send_event_sync(self, evt: Dict[str, Any], *, reason: str) -> None:
        if self._remote_closed.is_set():
            return
        ndjson = json.dumps(evt, ensure_ascii=False) + "\n"
        _debug(f"direct emit ({reason}): {evt.get('type', '?')}")
        for attempt in range(self.SYNC_SEND_RETRIES):
            if self._remote_closed.is_set():
                return
            try:
                response = self._post(ndjson, self._sync_send_timeout)
                _debug(f"direct emit success: {evt.get('type', '?')}")
                self.sent_events += 1 - self._record_rejections(response, [evt])
                return
            except Exception as e:
                run_wide = _run_wide_rejection(e)
                if run_wide:
                    self.dropped_events += 1
                    self._disable_uploads(run_wide)
                    return
                if _is_poison_error(e):
                    # Deterministic rejection: another attempt cannot succeed.
                    self._record_rejection(evt, *_http_rejection(e))
                    return
                _debug(
                    f"direct emit error (attempt {attempt + 1}/{self.SYNC_SEND_RETRIES}): {e}"
                )
                if attempt + 1 < self.SYNC_SEND_RETRIES:
                    time.sleep(0.5)
        self.dropped_events += 1
        self._delivery_error = RuntimeError("Platform direct event delivery failed")
        print(
            f"qym: WARNING: platform event {evt.get('type', '?')} failed to upload "
            f"after {self.SYNC_SEND_RETRIES} attempts.",
            file=sys.stderr,
        )
        _debug(
            f"direct emit FAILED after {self.SYNC_SEND_RETRIES} attempt(s): {evt.get('type', '?')}"
        )

    def _record_rejection(
        self, evt: Dict[str, Any], reason: str, verdict: bool = True
    ) -> None:
        """Count one event the platform refused; warn once with the reason.

        ``verdict`` is False when the refusal was about the request rather
        than the event (no per-event verdict): the event is dropped and counts
        as undelivered, which holds the run's completion.
        """
        if verdict:
            self.rejected_events += 1
        self.dropped_events += 1
        _debug(
            f"platform {'rejected' if verdict else 'refused to take'} event "
            f"{evt.get('type', '?')} seq={evt.get('sequence', '?')}: {reason}"
        )
        if not verdict:
            if self._first_refusal is None:
                self._first_refusal = f"{evt.get('type', 'event')}: {reason}"
                print(
                    f"qym: WARNING: the platform refused to take a run event "
                    f"({self._first_refusal}); it was not uploaded.",
                    file=sys.stderr,
                )
            return
        if self._first_rejection is None:
            self._first_rejection = f"{evt.get('type', 'event')}: {reason}"
            print(
                f"qym: WARNING: the platform rejected a run event "
                f"({self._first_rejection}). Valid events are still uploaded.",
                file=sys.stderr,
            )

    def _record_rejections(
        self, response: Any, events: "list[Dict[str, Any]]"
    ) -> int:
        """Apply a partial-success batch verdict; return how many were refused."""
        count, details = _rejected_events(response, len(events))
        if not count:
            return 0
        by_id = {str(evt.get("event_id")): evt for evt in events}
        for index in range(count):
            detail = details[index] if index < len(details) else {}
            evt = by_id.get(str(detail.get("event_id"))) or {
                "type": detail.get("type") or "event",
                "sequence": detail.get("sequence", "?"),
            }
            self._record_rejection(evt, str(detail.get("error") or "rejected"))
        return count

    def _disable_uploads(
        self, reason: str = "HTTP 410: the run is closed to updates"
    ) -> None:
        """Latch a permanent server rejection across every delivery path."""
        with self._state_lock:
            if self._remote_closed.is_set():
                return
            self._remote_closed.set()
            self._accepting = False
            self._delivery_error = RuntimeError(
                f"Platform run no longer accepts updates ({reason})"
            )
            self._stop.set()
        self.dropped_events += self._q.discard()
        print(
            f"qym: platform run {self.run_id} no longer accepts updates ({reason}). "
            "Uploads and heartbeats stopped. Local evaluation may continue.",
            file=sys.stderr,
        )

    def _enqueue(
        self, evt: Dict[str, Any], *, block=True, timeout=None, allow_direct=True
    ) -> None:
        with self._state_lock:
            if self._remote_closed.is_set():
                return
            if not self._accepting:
                direct = True
            else:
                direct = False
                self._active_emitters += 1
        if direct:
            if not block or not allow_direct:
                raise Full
            self._send_event_sync(evt, reason="closed")
            return
        try:
            self._q.put(evt, block=block, timeout=timeout)
        except Full:
            raise
        except Exception as exc:
            if self._remote_closed.is_set():
                return
            self._delivery_error = exc
            print(
                f"qym: ERROR: platform event {evt.get('event_id')} could not be buffered "
                f"({type(exc).__name__}). "
                f"Pending spool: {self._q.spool_path or 'memory'}. "
                "Local evaluation checkpoints remain available.",
                file=sys.stderr,
            )
            raise
        finally:
            with self._state_lock:
                self._active_emitters -= 1

    def emit(self, type_: str, payload: Dict[str, Any], *, sync: bool = False) -> None:
        """Queue an event; synchronous overflow spills to a bounded private file.

        When both budgets are full this applies producer backpressure. Async
        callers should use aemit(), which offloads spill and capacity waits.
        """
        if self._remote_closed.is_set():
            return
        evt = self._build_event(type_, payload)
        if sync:
            self._send_event_sync(evt, reason="sync")
        else:
            self._enqueue(evt)

    def emit_nowait(self, type_: str, payload: Dict[str, Any]) -> bool:
        """Best-effort queue for high-volume telemetry (span events).

        Never sends over the network and waits at most
        ``SPAN_ENQUEUE_TIMEOUT`` for backlog room, so a full backlog or a
        closed stream cannot stall the caller (typically the event loop
        thread, from an OTEL span processor). A skipped event is counted in
        ``dropped_spans`` and reported once; it does not hold completion.
        """
        if self._remote_closed.is_set():
            return False
        evt = self._build_event(type_, payload)
        try:
            self._enqueue(evt, timeout=self.SPAN_ENQUEUE_TIMEOUT, allow_direct=False)
            return True
        except Exception as exc:
            self.dropped_spans += 1
            if self.dropped_spans == 1:
                reason = (
                    "the upload backlog is full"
                    if isinstance(exc, Full)
                    else f"{type(exc).__name__}: {exc}"
                )
                print(
                    f"qym: WARNING: skipped a platform {type_} event because "
                    f"{reason}; further skipped span events are counted in the "
                    "run summary (dropped_spans).",
                    file=sys.stderr,
                )
            return False

    async def aemit(
        self, type_: str, payload: Dict[str, Any], *, sync: bool = False
    ) -> None:
        """Queue without disk/network waits on the caller's event loop."""
        if self._remote_closed.is_set():
            return
        evt = self._build_event(type_, payload)
        if sync:
            await asyncio.to_thread(self._send_event_sync, evt, reason="sync")
            return
        # Register before the first asynchronous handoff. Closing must account
        # for an append waiting for an executor thread, not just a running put.
        with self._state_lock:
            registered = self._accepting
            if registered:
                self._active_emitters += 1

        def release_registration():
            with self._state_lock:
                self._active_emitters -= 1

        def finish_cancelled_append(task):
            try:
                task.result()
            except (Exception, asyncio.CancelledError):
                # Full means cancellation won before acceptance. Other failures
                # have already been recorded and reported by _enqueue.
                pass
            finally:
                release_registration()

        try:
            if registered:
                try:
                    self._enqueue(evt, block=False)
                    return
                except Full:
                    pass
            while True:
                pending = asyncio.create_task(
                    asyncio.to_thread(self._enqueue, evt, timeout=0.1)
                )
                try:
                    await asyncio.shield(pending)
                    return
                except asyncio.CancelledError:
                    if registered:
                        # A running thread cannot be cancelled safely. Retain
                        # admission ownership until its short put finishes;
                        # aclose can drain it while this caller returns promptly.
                        pending.add_done_callback(finish_cancelled_append)
                        registered = False
                    else:
                        pending.add_done_callback(
                            lambda task: (
                                task.exception() if not task.cancelled() else None
                            )
                        )
                    raise
                except Full:
                    await asyncio.sleep(0)
        finally:
            if registered:
                release_registration()

    @property
    def undelivered_events(self) -> int:
        """Dropped events the platform never answered for (outage, retries
        exhausted, spool lost, uploads stopped). Events it refused are
        ``rejected_events``: the platform saw them and flags the run instead.
        """
        return max(0, self.dropped_events - self.rejected_events)

    def flush(self, timeout: Optional[float] = None) -> bool:
        """Wait for accepted events; report success only when none went undelivered.

        Events the platform refused (``rejected_events``) do not fail the
        flush: resending them can never succeed, and the platform records
        them and flags the run as incomplete when it completes.
        """
        drained = self._q.wait_drained(
            self.FLUSH_TIMEOUT if timeout is None else timeout
        )
        with self._state_lock:
            admissions_finished = not self._active_emitters
            closing_finished = not (self._closing and self._thread.is_alive())
        return (
            drained
            and admissions_finished
            and closing_finished
            and self._delivery_error is None
            and self.undelivered_events == 0
        )

    async def aflush(self, timeout: Optional[float] = None) -> bool:
        return await asyncio.to_thread(self.flush, timeout)

    async def aclose(self) -> None:
        """Drain off the event loop, including when the caller is cancelled."""
        task = asyncio.create_task(asyncio.to_thread(self.close))
        cancelled = False
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                cancelled = True
        task.result()
        if cancelled:
            raise asyncio.CancelledError

    def _close_timeout(self) -> float:
        raw = os.environ.get("QYM_PLATFORM_CLOSE_TIMEOUT", "")
        if raw:
            try:
                return max(0.0, float(raw))
            except ValueError:
                pass
        return float(self.CLOSE_JOIN_TIMEOUT)

    def close(self) -> None:
        """Block until the event backlog is uploaded (or the budget elapses).

        The eval workers never wait on this stream mid-run, so any queue
        backlog surfaces here, after the last item finished. Draining it is
        the difference between the platform showing the whole run and
        silently missing items — so we wait, show progress, and only give up
        after the (generous, env-tunable) budget with a loud warning.
        """
        with self._state_lock:
            if self._closed:
                return
            self._closing = True
        timeout = self._close_timeout()
        _debug(f"close() called, queue size={self._q.qsize()}, seq={self._seq}")
        # Enter drain mode immediately: the flush loop ignores the send
        # cadence and ships batches back-to-back until the queue is empty.
        self._stop.set()
        deadline = time.monotonic() + timeout
        printed_progress = False
        try:
            while self._thread.is_alive():
                slice_s = min(self.CLOSE_PROGRESS_INTERVAL, deadline - time.monotonic())
                if slice_s <= 0:
                    break
                self._thread.join(timeout=slice_s)
                if self._thread.is_alive():
                    remaining = self._q.qsize()
                    if remaining:
                        printed_progress = True
                        print(
                            f"qym: uploading {remaining} remaining platform events...",
                            file=sys.stderr,
                        )
            if self._thread.is_alive():
                remaining = self._q.qsize()
                _debug(
                    f"WARNING: flush thread still alive after {timeout}s close budget"
                )
                print(
                    f"qym: WARNING: gave up waiting for the platform upload after {timeout:.0f}s; "
                    f"~{self._q.unfinished_tasks} events are still pending — the run page may be missing items. "
                    f"Spool: {self._q.spool_path or 'memory'}. "
                    "Raise QYM_PLATFORM_CLOSE_TIMEOUT to wait longer.",
                    file=sys.stderr,
                )
            else:
                _debug("flush thread joined successfully")
                if self._remote_closed.is_set():
                    pass  # The terminal rejection was already reported once.
                elif self.undelivered_events:
                    rejected = (
                        f" {self.rejected_events} more were rejected by the platform "
                        f"(first: {self._first_rejection})."
                        if self.rejected_events
                        else ""
                    )
                    print(
                        f"qym: WARNING: {self.undelivered_events} platform events failed to upload "
                        "and were dropped — the run page may be missing items."
                        f"{rejected} Set QYM_PLATFORM_DEBUG=1 to log the failures.",
                        file=sys.stderr,
                    )
                elif self.rejected_events:
                    # Every event reached the platform; it refused some. The
                    # run still completes, and the platform flags it.
                    print(
                        f"qym: WARNING: {self.rejected_events} platform events were "
                        f"rejected by the platform (first: {self._first_rejection}). "
                        "The run page does not include them and marks the run as "
                        "incomplete. Set QYM_PLATFORM_DEBUG=1 to log each rejection.",
                        file=sys.stderr,
                    )
                elif printed_progress:
                    print("qym: platform upload complete.", file=sys.stderr)
        except Exception as e:
            _debug(f"close() exception: {e}")
        finally:
            with self._state_lock:
                self._closed = True

    def _send_events_individually(
        self, entries: "list[tuple[dict[str, Any], str, int, bool]]"
    ) -> None:
        """Poison-batch fallback: give every event its own verdict.

        Entered only after the server rejected the whole batch with a
        deterministic 4xx. Events that individually get a 4xx are dropped
        (they can never succeed); a transient blip gets one more attempt.
        """
        _debug(f"falling back to per-event send for {len(entries)} events")
        for index, (evt, line, _, _) in enumerate(entries):
            if self._remote_closed.is_set():
                self.dropped_events += len(entries) - index
                return
            for attempt in range(2):
                if self._remote_closed.is_set():
                    self.dropped_events += len(entries) - index
                    return
                try:
                    response = self._post(line + "\n", self._batch_timeout())
                    self.sent_events += 1 - self._record_rejections(response, [evt])
                    break
                except Exception as e2:
                    run_wide = _run_wide_rejection(e2)
                    if run_wide:
                        self.dropped_events += len(entries) - index
                        self._disable_uploads(run_wide)
                        return
                    if _is_poison_error(e2):
                        self._record_rejection(evt, *_http_rejection(e2))
                        break
                    if attempt == 1:
                        self.dropped_events += 1
                        _debug(
                            f"dropped event {evt.get('type','?')} "
                            f"seq={evt.get('sequence','?')}: {e2}"
                        )
                        break
                    time.sleep(0.5)

    def _batch_timeout(self) -> float:
        """Client timeout for one batch POST (shorter while draining)."""
        if self._stop.is_set():
            return self._drain_request_timeout
        return self._request_timeout

    def _retry_backoff(self, retry_count: int) -> float:
        """Capped exponential backoff with full jitter.

        Jitter keeps many runs that failed together (platform restart, lock
        wait) from retrying in lockstep against the same database.
        """
        ceiling = min(
            self.RETRY_BACKOFF_BASE * (2 ** min(max(retry_count - 1, 0), 10)),
            self.RETRY_BACKOFF_MAX,
        )
        return random.uniform(0.0, ceiling)

    def _next_flush_interval(self, post_seconds: float) -> float:
        """Cadence after a POST took ``post_seconds``: stretch while slow."""
        base = self._flush_interval
        if post_seconds <= self.SLOW_POST_SECONDS:
            return base
        return max(base, min(float(self.MAX_FLUSH_INTERVAL), 2.0 * post_seconds))

    def _loop(self) -> None:
        # Each entry: (event, serialized line, encoded byte length, from_queue).
        # from_queue tells us whether to task_done() it — in-loop heartbeats
        # never went through the Queue, and Queue.join() semantics power flush().
        batch: list[tuple[dict[str, Any], str, int, bool]] = []
        batch_bytes = 0
        queue_items_in_batch = 0
        # A taken event that would push the batch past MAX_BATCH_BYTES. It
        # opens the next batch instead, so a batch only exceeds the byte cap
        # when it holds a single event.
        carry: Optional[tuple[dict[str, Any], str, int, bool]] = None
        # After a transient failure the batch is frozen: the retry resends
        # exactly the same events (same event_ids), and new events wait for
        # the next batch. Growing a batch between retries made every retry a
        # bigger transaction while the timed-out one could still be running.
        frozen = False
        flush_interval = self._flush_interval
        last_flush = time.time()
        last_heartbeat = time.time()
        retry_count = 0
        _debug(f"flush loop started for run {self.run_id}")

        def _add(entry: "tuple[dict[str, Any], str, int, bool]") -> None:
            nonlocal batch_bytes, queue_items_in_batch
            batch.append(entry)
            batch_bytes += entry[2] + 1
            if entry[3]:
                queue_items_in_batch += 1

        def _append(evt: Dict[str, Any], from_queue: bool) -> None:
            nonlocal carry
            line = json.dumps(evt, ensure_ascii=False)
            entry = (evt, line, len(line.encode("utf-8")), from_queue)
            if batch and batch_bytes + entry[2] + 1 > self.MAX_BATCH_BYTES:
                carry = entry
                return
            _add(entry)

        def _take_carry() -> None:
            nonlocal carry
            if carry is not None:
                _add(carry)
                carry = None

        def _clear_batch() -> None:
            """task_done() every queue-sourced event, then reset the batch."""
            nonlocal batch_bytes, queue_items_in_batch, frozen
            for _ in range(queue_items_in_batch):
                try:
                    self._q.task_done()
                except ValueError:
                    # task_done() called more times than items — shouldn't happen
                    # but don't crash the flush loop on a bookkeeping mistake.
                    break
            queue_items_in_batch = 0
            batch.clear()
            batch_bytes = 0
            frozen = False

        def _batch_full() -> bool:
            return (
                carry is not None
                or len(batch) >= self.MAX_BATCH_EVENTS
                or batch_bytes >= self.MAX_BATCH_BYTES
            )

        while True:
            if self._remote_closed.is_set():
                _take_carry()
                self.dropped_events += len(batch)
                _clear_batch()
                break
            if carry is not None and not batch:
                _take_carry()
            if not frozen and not _batch_full():
                try:
                    _append(self._q.get(timeout=0.1), True)
                except Empty:
                    pass
            now = time.time()
            if (
                not self._stop.is_set()
                and not frozen
                and carry is None
                and (now - last_heartbeat) >= self.HEARTBEAT_INTERVAL
            ):
                _append(
                    self._build_event("run_heartbeat", {"heartbeat_at": _utc_now()}),
                    False,
                )
                last_heartbeat = now
            # Flush on a full batch or on cadence; a frozen batch is retried
            # as soon as its backoff has elapsed.
            should_flush = bool(batch) and (
                frozen or _batch_full() or (now - last_flush) >= flush_interval
            )
            if self._stop.is_set():
                # Drain mode: fill up to the caps and ship without waiting.
                if not frozen:
                    try:
                        while not _batch_full():
                            _append(self._q.get_nowait(), True)
                    except Empty:
                        pass
                should_flush = bool(batch)
                if should_flush:
                    _debug(f"final flush: {len(batch)} events")
            if not should_flush and not self._stop.is_set():
                continue
            if self._remote_closed.is_set():
                continue
            if should_flush:
                started = time.monotonic()
                try:
                    ndjson = "\n".join(line for _, line, _, _ in batch) + "\n"
                    response = self._post(ndjson, self._batch_timeout())
                    # Partial success: the platform applied the valid events
                    # and refused the rest; never resend the refused ones.
                    self.sent_events += len(batch) - self._record_rejections(
                        response, [evt for evt, _, _, _ in batch]
                    )
                    _debug(
                        f"flushed {len(batch)} events (total sent: {self.sent_events})"
                    )
                    _clear_batch()
                    last_flush = time.time()
                    last_heartbeat = last_flush
                    retry_count = 0
                    self._consecutive_failures = 0
                    flush_interval = self._next_flush_interval(
                        time.monotonic() - started
                    )
                except Exception as e:
                    retry_count += 1
                    self._consecutive_failures += 1
                    run_wide = _run_wide_rejection(e)
                    if run_wide:
                        self.dropped_events += len(batch)
                        self._disable_uploads(run_wide)
                        _clear_batch()
                    elif _is_poison_error(e):
                        # Deterministic 4xx: retrying the batch verbatim can
                        # never succeed — isolate per event instead.
                        _debug(f"batch rejected ({e}); isolating per event")
                        self._send_events_individually(batch)
                        _clear_batch()
                        retry_count = 0
                        # The batch was handled; keep the send cadence so the
                        # next events batch up again instead of going one by one.
                        last_flush = time.time()
                    elif (
                        self._stop.is_set()
                        and self._consecutive_failures >= self.CLOSE_GIVEUP_FAILURES
                    ):
                        # Shutting down against an endpoint that keeps failing:
                        # stop burning the close budget, count the loss loudly.
                        self.dropped_events += len(batch)
                        _debug(
                            f"DROPPED {len(batch)} events during shutdown after "
                            f"{self._consecutive_failures} consecutive failures "
                            f"(total dropped: {self.dropped_events})"
                        )
                        _clear_batch()
                        retry_count = 0
                    else:
                        # Transient (network/timeout/5xx/429): retry the same
                        # frozen batch with jittered, capped backoff. Never drop
                        # mid-run — the server dedups by event_id, so
                        # redelivery is always safe.
                        frozen = True
                        flush_interval = self._next_flush_interval(
                            time.monotonic() - started
                        )
                        backoff = self._retry_backoff(retry_count)
                        _debug(
                            f"flush error (attempt {retry_count}), retrying "
                            f"{len(batch)} events in {backoff:.2f}s: {e}"
                        )
                        time.sleep(backoff)
            if self._stop.is_set() and not batch:
                if carry is not None:
                    continue
                try:
                    _append(self._q.get_nowait(), True)
                except Empty:
                    with self._state_lock:
                        if self._active_emitters or self._q.qsize():
                            continue
                        self._accepting = False
                    _debug(
                        f"flush loop exiting: sent={self.sent_events}, "
                        f"dropped={self.dropped_events}"
                    )
                    self._q.dispose()
                    break


class PlatformClient:
    CREATE_RUN_TIMEOUT = 5.0

    def __init__(self, platform_url: str, api_key: str) -> None:
        self.platform_url = platform_url.rstrip("/")
        self.api_key = api_key

    def create_run(
        self,
        *,
        external_run_id: Optional[str],
        task: str,
        dataset: str,
        model: Optional[str],
        metrics: list[str],
        run_metadata: Dict[str, Any],
        run_config: Dict[str, Any],
        metric_specs: Optional[Dict[str, Dict[str, Any]]] = None,
        dataset_id: Optional[str] = None,
        dataset_version_id: Optional[str] = None,
        dataset_alias: Optional[str] = None,
        timeout: Optional[float] = None,
        versioning_details: Optional[Dict[str, Any]] = None,
    ) -> PlatformRunHandle:
        """``POST /v1/runs``. ``versioning_details`` is a free-form JSON object
        stored on the run (platforms before it ignore the field)."""
        payload = {
            "external_run_id": external_run_id,
            "task": task,
            "dataset": dataset,
            "model": model,
            "metrics": metrics,
            "metric_specs": metric_specs or {},
            "run_metadata": run_metadata,
            "run_config": run_config,
            "dataset_id": dataset_id,
            "dataset_version_id": dataset_version_id,
            "dataset_alias": dataset_alias,
        }
        if versioning_details:
            payload["versioning_details"] = versioning_details
        data = _post_json(
            f"{self.platform_url}/v1/runs",
            payload,
            self.api_key,
            timeout=timeout if timeout is not None else self.CREATE_RUN_TIMEOUT,
        )
        run_id = str(data.get("run_id") or "")
        live_url = str(data.get("live_url") or "")
        if not run_id or not live_url:
            raise RuntimeError(f"Platform did not return run_id/live_url: {data}")
        return PlatformRunHandle(run_id=run_id, live_url=live_url)

    def list_runs(
        self,
        *,
        origin: Optional[str] = None,
        versioning: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """List runs (``GET /api/runs``), grouped as ``{"tasks": {task: {model: [run]}}}``.

        ``origin`` is ``"official"``, ``"local"`` or ``"all"`` (default: no
        filter). ``versioning`` is a list of ``"KEY=VALUE"`` filters on the
        Evaluation Service's ``versioning_metadata`` (any key, e.g.
        ``["agent_version=v1.12"]``): a repeated key matches any of its values,
        different keys must all match. Invalid values raise ``ValueError`` before
        any request. Each run dict carries ``origin``, ``experiment`` (``{id,
        name, job_id}`` for official runs, ``None`` for local ones),
        ``versioning`` and ``versioning_details`` (the run's free-form keys).
        """
        from ..cli._platform_api import PlatformAPIClient

        return PlatformAPIClient(
            platform_url=self.platform_url, api_key=self.api_key
        ).list_runs(origin=origin, versioning=versioning)

    def get_dataset_items(
        self,
        *,
        dataset: str,
        version: Optional[str] = None,
        alias: Optional[str] = None,
        project_slug: Optional[str] = None,
        limit: int = 1000,
        read_token: Optional[str] = None,
    ) -> Dict[str, Any]:
        import urllib.parse

        from ..core.dataset import DATASET_READ_TOKEN_HEADER

        ref = urllib.parse.quote(dataset, safe="")
        version_ref = urllib.parse.quote(version or alias or "production", safe="")
        params = {"limit": str(limit)}
        if project_slug:
            params["project_slug"] = project_slug
        url = (
            f"{self.platform_url}/v1/datasets/{ref}/versions/{version_ref}/items?"
            + urllib.parse.urlencode(params)
        )
        headers = {"Authorization": f"Bearer {self.api_key}"}
        token = read_token or os.getenv("QYM_DATASET_READ_TOKEN")
        if token:
            headers[DATASET_READ_TOKEN_HEADER] = token
        req = request.Request(url, headers=headers)
        with request.urlopen(req, timeout=self.CREATE_RUN_TIMEOUT) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}

    def upload_dataset(
        self,
        *,
        path: str,
        name: str,
        version: str,
        publish: bool = False,
        set_alias: Optional[str] = None,
        input_col: str = "input",
        expected_col: str = "expected_output",
        id_col: Optional[str] = None,
        metadata_cols: Optional[str] = None,
        labels: Optional[str] = None,
        project_slug: Optional[str] = None,
    ) -> Dict[str, Any]:
        import mimetypes
        import urllib.request
        from pathlib import Path

        file_path = Path(path)
        boundary = "----qym-dataset-" + uuid.uuid4().hex
        fields = {
            "name": name,
            "version": version,
            "publish": "true" if publish else "false",
            "input_col": input_col,
            "expected_col": expected_col,
            "metadata_cols": metadata_cols or "",
            "labels": labels or "",
        }
        if project_slug:
            fields["project_slug"] = project_slug
        if id_col:
            fields["id_col"] = id_col
        if set_alias:
            fields["set_alias"] = set_alias
        lines: list[bytes] = []
        for key, value in fields.items():
            lines.extend(
                [
                    f"--{boundary}".encode(),
                    f'Content-Disposition: form-data; name="{key}"'.encode(),
                    b"",
                    str(value).encode("utf-8"),
                ]
            )
        raw = file_path.read_bytes()
        ctype = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        lines.extend(
            [
                f"--{boundary}".encode(),
                f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"'.encode(),
                f"Content-Type: {ctype}".encode(),
                b"",
                raw,
                f"--{boundary}--".encode(),
                b"",
            ]
        )
        body = b"\r\n".join(lines)
        req = urllib.request.Request(
            f"{self.platform_url}/v1/datasets:upload",
            data=body,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = resp.read().decode("utf-8")
            return json.loads(payload) if payload else {}
