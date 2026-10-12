"""Fixture server for the SDK viewer e2e suite (frontend/e2e/sdk-viewer).

Runs REAL qym code against deterministic data and exposes a tiny control API
so tests can drive the scenario step by step (no timing assumptions):

  GET  /health
  POST /ui/bare        bare UIServer on LIVE_PORT (no run registered yet)
  POST /ui/tracker     register a run and publish 3 rows through a LiveTracker
  POST /ui/complete    finish tracker row 0 (live update)
  POST /ui/kill        drop the live server abruptly (no `done` event)
  POST /live/start     real Evaluator(local_ui=True, ui_port=LIVE_PORT); rows 0-4 finish,
                       rows 5-7 wait for /live/release (2 running, 1 pending)
  POST /live/release   let the gated rows finish; the run ends
  GET  /live/state     {"finished": bool}
  POST /file/fresh     a fresh copy of the saved results CSV -> {"path": ...}
  GET  /file/missing   a path that does not exist -> {"path": ...}

Ports: LIVE_PORT 8818 (viewer for the live run), FILE_PORT 8819 (viewer for saved
files), CONTROL_PORT 8820. Everything is written to a temp dir that is removed on exit.
"""

from __future__ import annotations

import atexit
import glob
import json
import os
import shutil
import signal
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional

from qym.core.evaluator import Evaluator
from qym.core.dataset import CsvDataset
from qym.core.progress import ProgressTracker
from qym.server import LiveTracker, UIServer
from qym.utils.errors import NonRetryableError

LIVE_PORT = int(os.environ.get("QYM_SDK_UI_PORT", "8818"))
FILE_PORT = int(os.environ.get("QYM_SDK_FILE_PORT", "8819"))
CONTROL_PORT = int(os.environ.get("QYM_SDK_CONTROL_PORT", "8820"))

LONG_OUTPUT = " ".join(f"word{i}" for i in range(400))  # > 700 chars, collapses in the detail pane

# (input, expected, behaviour) in dataset order. Index shown in the UI = position + 1.
ROWS: List[Dict[str, str]] = [
    {"input": "What is 2+2?", "expected": "4", "kind": "wrong"},  # output "four"
    {"input": "ما هي عاصمة السعودية؟", "expected": "الرياض", "kind": "arabic"},
    {"input": "Describe the fox", "expected": "the quick brown fox", "kind": "diff"},
    {"input": "Explode please", "expected": "never", "kind": "raise"},
    {"input": "Write a very long answer", "expected": "short", "kind": "long"},
    {"input": "slow one", "expected": "gated one", "kind": "gated"},
    {"input": "slow two", "expected": "gated two", "kind": "gated"},
    {"input": "slow three", "expected": "gated three", "kind": "gated"},
]
ERROR_TEXT = "boom: the task exploded"

def _sweep_stale_tmp_dirs() -> None:
    """Remove temp dirs of earlier fixture processes that were killed before they could clean up."""
    for old in glob.glob(os.path.join(tempfile.gettempdir(), "qym-sdk-viewer-e2e-*")):
        try:
            pid = int(open(os.path.join(old, "pid")).read())
            os.kill(pid, 0)
        except ProcessLookupError:
            shutil.rmtree(old, ignore_errors=True)
        except (OSError, ValueError):
            pass


_sweep_stale_tmp_dirs()
TMP = tempfile.mkdtemp(prefix="qym-sdk-viewer-e2e-")
with open(os.path.join(TMP, "pid"), "w") as _f:
    _f.write(str(os.getpid()))
atexit.register(shutil.rmtree, TMP, ignore_errors=True)
GATE = threading.Event()


def _write_dataset() -> str:
    path = os.path.join(TMP, "dataset.csv")
    if not os.path.exists(path):
        import csv

        with open(path, "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["input", "expected_output"])
            for r in ROWS:
                w.writerow([r["input"], r["expected"]])
    return path


def task(input: str) -> str:  # noqa: A002 - the dataset column name
    row = next(r for r in ROWS if r["input"] == input)
    kind = row["kind"]
    if kind == "raise":
        raise NonRetryableError(ERROR_TEXT)
    if kind == "gated":
        GATE.wait(timeout=120)
        return row["expected"]
    if kind == "wrong":
        return "four"
    if kind == "diff":
        return "the slow brown dog"
    if kind == "long":
        return LONG_OUTPUT
    return row["expected"]


def length_ratio(output: Any, expected: Any) -> float:
    """Custom numeric metric: how close in length (0..1)."""
    a, b = len(str(output)), len(str(expected))
    return round(min(a, b) / max(a, b, 1), 2) if max(a, b) else 1.0


def _evaluator(out_dir: str, **config: Any) -> Evaluator:
    return Evaluator(
        task=task,
        dataset=CsvDataset(_write_dataset()),
        metrics=["exact_match", length_ratio],
        config={"output_dir": out_dir, "max_concurrency": 2, "otel_enabled": False, **config},
    )


class State:
    live_server: Optional[UIServer] = None
    evaluator: Optional[Evaluator] = None
    thread: Optional[threading.Thread] = None
    tracker: Optional[LiveTracker] = None
    saved_csv: Optional[str] = None
    file_server: Optional[UIServer] = None
    counter = 0
    lock = threading.RLock()


def _kill(server: Optional[UIServer]) -> None:
    """Drop a server without telling viewers the run is over (a crashed evaluation)."""
    if server is None:
        return
    server._stop.set()
    if server.httpd:
        server.httpd.shutdown()
        server.httpd.server_close()


def _reset_live() -> None:
    GATE.set()  # unblock any waiting task so its thread can end
    if State.thread is not None:
        State.thread.join(timeout=30)
    if State.tracker is not None:
        State.tracker.close()
    srv = State.live_server or getattr(State.evaluator, "_ui_server", None)
    if srv is not None:
        try:
            srv.stop()
        except Exception:
            pass
    State.live_server = State.evaluator = State.thread = State.tracker = None
    GATE.clear()


class _Item:
    def __init__(self, text: str, expected: str):
        self.input, self.expected_output = text, expected


def _saved_results_csv() -> str:
    """One finished, auto-saved run (all rows released), made once and copied per test."""
    if State.saved_csv:
        return State.saved_csv
    out = os.path.join(TMP, "saved")
    GATE.set()
    ev = _evaluator(out, run_name="saved-run", model="fixture-model")
    ev.run(show_tui=False, auto_save=True)
    GATE.clear()
    found = sorted(glob.glob(os.path.join(out, "**", "*.csv"), recursive=True))
    if not found:
        raise RuntimeError(f"no results csv under {out}")
    State.saved_csv = found[0]
    return State.saved_csv


def _ensure_file_server() -> None:
    if State.file_server is None:
        State.file_server = UIServer(port=FILE_PORT, results_dir=TMP)
        State.file_server.start()


def start_live() -> Dict[str, Any]:
    _reset_live()
    out = os.path.join(TMP, f"live-{State.counter}")
    State.counter += 1
    ev = _evaluator(out, local_ui=True, ui_port=LIVE_PORT, run_name="live-run", model="fixture-model")
    State.evaluator = ev
    State.thread = threading.Thread(
        target=lambda: ev.run(show_tui=False, auto_save=False), name="fixture-evaluator", daemon=True
    )
    State.thread.start()
    deadline = time.time() + 30
    while time.time() < deadline:
        srv = getattr(ev, "_ui_server", None)
        if srv is not None:
            snap = srv.run_state.get_snapshot()
            stats = snap.get("stats") or {}
            # wait for the steady state: 4 finished, 2 running, 1 pending
            if stats.get("completed") == 4 and stats.get("failed") == 1 and stats.get("in_progress") == 2:
                State.live_server = srv
                return {"url": srv.url}
        time.sleep(0.05)
    raise RuntimeError("live evaluation did not reach the gated state")


def release_live() -> Dict[str, Any]:
    GATE.set()
    if State.thread is not None:
        State.thread.join(timeout=60)
    return {"finished": not (State.thread and State.thread.is_alive())}


def bare_ui() -> Dict[str, Any]:
    _reset_live()
    srv = UIServer(port=LIVE_PORT, results_dir=TMP)
    srv.start()
    State.live_server = srv
    return {"url": srv.url}


def idle_ui() -> Dict[str, Any]:
    """`qym ui` without a file: a viewer that knows no evaluation will ever register."""
    _reset_live()
    srv = UIServer(port=LIVE_PORT, results_dir=TMP)
    srv.expects_live = False
    srv.start()
    State.live_server = srv
    return {"url": srv.url}


def outside_file() -> Dict[str, Any]:
    """A results file outside the file server's results dir: viewable, never editable."""
    src = _saved_results_csv()
    _ensure_file_server()
    dst_dir = tempfile.mkdtemp(prefix="qym-sdk-viewer-outside-")
    atexit.register(shutil.rmtree, dst_dir, ignore_errors=True)
    dst = os.path.join(dst_dir, os.path.basename(src))
    shutil.copyfile(src, dst)
    return {"path": dst, "port": FILE_PORT}


def tracker_ui() -> Dict[str, Any]:
    srv = State.live_server
    assert srv is not None, "call /ui/bare first"
    items = [_Item(r["input"], r["expected"]) for r in ROWS[:3]]
    srv.run_state.set_run_info(
        {
            "dataset_name": "pushed-set",
            "run_name": "pushed-run",
            "model": "fixture-model",
            "status": "RUNNING",
            "started_at": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
        }
    )
    State.tracker = LiveTracker(items, ["exact_match"], srv, min_interval=0.05)
    return {"rows": len(items)}


def complete_ui() -> Dict[str, Any]:
    tr = State.tracker
    assert tr is not None
    tr.start_item(0)
    tr.complete_item(0, elapsed_time=0.1)
    tr.publish()
    return {"ok": True}


def kill_ui() -> Dict[str, Any]:
    _kill(State.live_server)
    return {"ok": True}


def fresh_file() -> Dict[str, Any]:
    src = _saved_results_csv()
    _ensure_file_server()
    State.counter += 1
    dst_dir = os.path.join(TMP, f"copy-{State.counter}")
    os.makedirs(dst_dir)
    dst = os.path.join(dst_dir, os.path.basename(src))
    shutil.copyfile(src, dst)
    return {"path": dst, "port": FILE_PORT}


def missing_file() -> Dict[str, Any]:
    _ensure_file_server()
    return {"path": os.path.join(TMP, "does-not-exist", "run.csv"), "port": FILE_PORT}


ROUTES = {
    ("GET", "/health"): lambda: {"ok": True},
    ("POST", "/ui/bare"): bare_ui,
    ("POST", "/ui/idle"): idle_ui,
    ("POST", "/file/outside"): outside_file,
    ("POST", "/ui/tracker"): tracker_ui,
    ("POST", "/ui/complete"): complete_ui,
    ("POST", "/ui/kill"): kill_ui,
    ("POST", "/live/start"): start_live,
    ("POST", "/live/release"): release_live,
    ("GET", "/live/state"): lambda: {"finished": not (State.thread and State.thread.is_alive())},
    ("POST", "/file/fresh"): fresh_file,
    ("GET", "/file/missing"): missing_file,
}


class Control(BaseHTTPRequestHandler):
    def log_message(self, *_: Any) -> None:
        return

    def _handle(self, method: str) -> None:
        fn = ROUTES.get((method, self.path.split("?")[0]))
        if fn is None:
            status, body = 404, {"error": "unknown route"}
        else:
            try:
                with State.lock if self.path != "/live/release" else threading.RLock():
                    status, body = 200, fn()
            except Exception as exc:  # surface fixture bugs to the test
                status, body = 500, {"error": f"{type(exc).__name__}: {exc}"}
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        self._handle("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._handle("POST")


def main() -> None:
    _saved_results_csv()  # before serving: it briefly opens the gate, which must not hit a live test
    _ensure_file_server()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))  # Playwright stops us with SIGTERM
    server = ThreadingHTTPServer(("127.0.0.1", CONTROL_PORT), Control)
    print(f"sdk viewer fixture control on {CONTROL_PORT} (tmp {TMP})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        _reset_live()
        if State.file_server:
            State.file_server.stop()


if __name__ == "__main__":
    sys.exit(main())
