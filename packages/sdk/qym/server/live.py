"""Progress tracker that mirrors every change to the local viewer."""

import threading
from typing import Any, Callable, List, Optional

from ..core.progress import ProgressTracker
from .app import UIServer

_MUTATORS = (
    "start_item",
    "update_trace_info",
    "update_output",
    "set_metric_computing",
    "update_metric",
    "set_metric_error",
    "complete_item",
    "fail_item",
    "fail_item_timeout",
)


class LiveTracker(ProgressTracker):
    """A ``ProgressTracker`` that publishes throttled snapshots to a ``UIServer``.

    Snapshots carry every row, so changes are coalesced: at most one publish per
    ``min_interval`` seconds, with a trailing publish so the last change is never lost.
    """

    def __init__(self, items: List[Any], metrics: List[str], server: UIServer, min_interval: float = 0.3):
        super().__init__(items, metrics)
        self._server = server
        self._min_interval = min_interval
        self._pub_lock = threading.Lock()
        self._timer: Optional[threading.Timer] = None
        self._closed = False
        self.publish()

    def publish(self) -> None:
        with self._pub_lock:
            self._timer = None
        try:
            self._server.run_state.set_snapshot(self.get_snapshot())
        except RuntimeError:  # a row changed mid-read; the next change republishes
            return
        self._server.broadcast_snapshot()

    def _schedule(self) -> None:
        with self._pub_lock:
            if self._timer is not None or self._closed:
                return
            self._timer = threading.Timer(self._min_interval, self.publish)
            self._timer.daemon = True
            self._timer.start()

    def close(self) -> None:
        """Publish the final state immediately and stop the throttle timer."""
        with self._pub_lock:
            self._closed = True
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
        self._server.run_state.set_snapshot(self.get_snapshot())


def _wrap(name: str) -> Callable[..., Any]:
    base = getattr(ProgressTracker, name)

    def method(self: LiveTracker, *args: Any, **kwargs: Any) -> Any:
        result = base(self, *args, **kwargs)
        self._schedule()
        return result

    method.__name__ = name
    return method


for _name in _MUTATORS:
    setattr(LiveTracker, _name, _wrap(_name))
