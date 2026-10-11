"""Local results viewer server for qym.

A small stdlib HTTP server (Python 3.9+, loopback, no auth) that serves the
packaged offline viewer (``_static/ui``) and its JSON/SSE API:

* ``GET  /api/run``                  run block of the live evaluation (``{}`` until set)
* ``GET  /api/snapshot``             latest progress snapshot (``{}`` until set)
* ``GET  /api/rows/stream``          SSE: ``snapshot`` events, ``done`` when the run ends
* ``GET  /api/runs/<file path>``     a saved ``.csv``/``.xlsx`` results file as ``{run, snapshot}``
* ``POST /api/runs/update_metric``   edit one metric score in a saved results file
* ``GET  /run/<anything>``           the viewer page (historical mode)
"""

import json
import mimetypes
import os
import threading
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import unquote, urlparse

try:
    from importlib.resources import files as pkg_files  # py3.9+
except Exception:  # pragma: no cover
    pkg_files = None  # type: ignore

from ..core.run_discovery import DEFAULT_RESULTS_DIR, RunDiscovery

RESULT_FILE_SUFFIXES = (".csv", ".xlsx")
MAX_BODY_BYTES = 1024 * 1024
SSE_HEARTBEAT_SECONDS = 15.0
SSE_WRITE_TIMEOUT_SECONDS = 10.0

_EXTRA_TYPES = {
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
}


@dataclass
class RunState:
    run_info: Dict[str, Any] = field(default_factory=dict)
    snapshot: Dict[str, Any] = field(default_factory=dict)
    lock: threading.RLock = field(default_factory=threading.RLock)

    def set_run_info(self, info: Dict[str, Any]) -> None:
        with self.lock:
            self.run_info = dict(info)

    def set_snapshot(self, snap: Dict[str, Any]) -> None:
        with self.lock:
            self.snapshot = dict(snap)

    def get_run_info(self) -> Dict[str, Any]:
        with self.lock:
            return dict(self.run_info)

    def get_snapshot(self) -> Dict[str, Any]:
        with self.lock:
            return dict(self.snapshot)


class _SSEClient:
    def __init__(self, handler: BaseHTTPRequestHandler):
        self.handler = handler
        self.lock = threading.Lock()
        self.active = True

    def send(self, event: str, data: Dict[str, Any]) -> bool:
        try:
            body = json.dumps(data, ensure_ascii=False)
        except Exception:
            body = "{}"
        payload = f"event: {event}\ndata: {body}\n\n"
        try:
            with self.lock:
                self.handler.wfile.write(payload.encode("utf-8"))
                self.handler.wfile.flush()
            return True
        except Exception:
            self.active = False
            return False


def _content_type(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    return _EXTRA_TYPES.get(ext) or mimetypes.guess_type(path)[0] or "application/octet-stream"


class UIServer:
    """Serves the offline viewer: live evaluation (SSE) and saved results files."""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 0,
        results_dir: str = DEFAULT_RESULTS_DIR,
    ):
        self.host = host
        self.port = port
        self.httpd: Optional[ThreadingHTTPServer] = None
        self.thread: Optional[threading.Thread] = None
        self.clients: List[_SSEClient] = []
        self.clients_lock = threading.Lock()
        self.run_state = RunState()
        self.discovery = RunDiscovery(results_dir)
        self._stop = threading.Event()
        self.static_dir = self._resolve_static_dir()

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}/"

    def _resolve_static_dir(self) -> str:
        env_dir = os.getenv("QYM_STATIC_DIR")
        if env_dir and os.path.isdir(env_dir):
            return env_dir
        here = os.path.dirname(os.path.dirname(__file__))
        fallback = os.path.join(here, "_static", "ui")
        if os.path.isdir(fallback):
            return fallback
        if pkg_files is not None:
            try:
                return str(pkg_files("qym").joinpath("_static/ui"))
            except Exception:
                pass
        return fallback

    def has_viewer(self) -> bool:
        return os.path.isfile(os.path.join(self.static_dir, "index.html"))

    def start(self) -> Tuple[str, int]:
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt: str, *args: Any) -> None:  # quiet
                return

            def _send(self, status: int, body: bytes, ctype: str) -> None:
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(body)

            def _json(self, status: int, data: Any) -> None:
                body = json.dumps(data, ensure_ascii=False).encode("utf-8")
                self._send(status, body, "application/json; charset=utf-8")

            def _static(self, rel_path: str) -> bool:
                root = os.path.abspath(server.static_dir)
                abspath = os.path.abspath(os.path.join(root, rel_path))
                if os.path.commonpath([root, abspath]) != root or not os.path.isfile(abspath):
                    return False
                try:
                    with open(abspath, "rb") as f:
                        data = f.read()
                except OSError:
                    return False
                self._send(HTTPStatus.OK, data, _content_type(abspath))
                return True

            def do_GET(self) -> None:  # noqa: N802
                path = urlparse(self.path).path
                if path == "/api/run":
                    return self._json(HTTPStatus.OK, server.run_state.get_run_info())
                if path == "/api/snapshot":
                    return self._json(HTTPStatus.OK, server.run_state.get_snapshot())
                if path == "/api/rows/stream":
                    return self._stream()
                if path.startswith("/api/runs/"):
                    return self._run_file(path[len("/api/runs/"):])
                if path.startswith("/api/"):
                    return self._json(HTTPStatus.NOT_FOUND, {"error": "Unknown API route"})

                rel = "index.html" if path in ("/", "/index.html") or path.startswith("/run/") else path.lstrip("/")
                if self._static(rel):
                    return
                self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

            def _run_file(self, encoded: str) -> None:
                file_path = unquote(encoded)
                if not file_path.lower().endswith(RESULT_FILE_SUFFIXES):
                    return self._json(
                        HTTPStatus.BAD_REQUEST,
                        {"error": "Only .csv and .xlsx results files can be opened"},
                    )
                data = server.discovery.get_run_data(file_path)
                if data.get("error"):
                    status = HTTPStatus.NOT_FOUND if str(data["error"]).startswith("File not found") else HTTPStatus.BAD_REQUEST
                    return self._json(status, {"error": data["error"]})
                self._json(HTTPStatus.OK, data)

            def _stream(self) -> None:
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.end_headers()
                try:
                    self.connection.settimeout(SSE_WRITE_TIMEOUT_SECONDS)
                except Exception:
                    pass
                client = _SSEClient(self)
                with server.clients_lock:
                    server.clients.append(client)
                snap = server.run_state.get_snapshot()
                if snap:
                    client.send("snapshot", snap)
                try:
                    while not server._stop.is_set() and client.active:
                        if server._stop.wait(SSE_HEARTBEAT_SECONDS):
                            break
                        try:
                            with client.lock:
                                self.wfile.write(b":keep-alive\n\n")
                                self.wfile.flush()
                        except Exception:
                            break
                finally:
                    with server.clients_lock:
                        if client in server.clients:
                            server.clients.remove(client)

            def do_POST(self) -> None:  # noqa: N802
                if urlparse(self.path).path != "/api/runs/update_metric":
                    return self._json(HTTPStatus.NOT_FOUND, {"error": "Unknown API route"})
                try:
                    length = int(self.headers.get("Content-Length", 0))
                    if length > MAX_BODY_BYTES:
                        return self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "Body too large"})
                    data = json.loads(self.rfile.read(length).decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    return self._json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
                file_path = str(data.get("file_path") or "")
                metric_name = data.get("metric_name")
                row_index = data.get("row_index")
                if not file_path or not metric_name or row_index is None:
                    return self._json(HTTPStatus.BAD_REQUEST, {"error": "Missing required fields"})
                if not file_path.lower().endswith(RESULT_FILE_SUFFIXES):
                    return self._json(HTTPStatus.BAD_REQUEST, {"error": "Only .csv and .xlsx results files can be edited"})
                try:
                    row_index = int(row_index)
                except (ValueError, TypeError):
                    return self._json(HTTPStatus.BAD_REQUEST, {"error": "Invalid row_index"})
                try:
                    update = server.discovery.update_metric_score(
                        file_path=file_path,
                        row_index=row_index,
                        metric_name=str(metric_name),
                        new_score=data.get("new_score"),
                    )
                    if update.get("error"):
                        return self._json(HTTPStatus.BAD_REQUEST, {"error": update["error"]})
                    run_data = server.discovery.get_run_data(file_path)
                except Exception as exc:
                    return self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
                rows = (run_data.get("snapshot") or {}).get("rows") or []
                if run_data.get("error") or not 0 <= row_index < len(rows):
                    return self._json(
                        HTTPStatus.INTERNAL_SERVER_ERROR,
                        {"error": run_data.get("error") or "Row index out of range"},
                    )
                self._json(HTTPStatus.OK, {"ok": True, "row": rows[row_index], "run": run_data.get("run", {})})

        self.httpd = ThreadingHTTPServer((self.host, self.port), Handler)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, name="qym-ui", daemon=True)
        self.thread.start()
        return self.host, self.port

    def finish(self) -> None:
        """Tell live viewers the run is over (final snapshot, then ``done``); keeps serving."""
        self.broadcast_snapshot()
        with self.clients_lock:
            for c in list(self.clients):
                c.send("done", {"ok": True})

    def stop(self) -> None:
        self._stop.set()
        self.finish()
        if self.httpd:
            try:
                self.httpd.shutdown()
                self.httpd.server_close()
            except Exception:
                pass
        if self.thread:
            self.thread.join(timeout=2)

    def broadcast_snapshot(self) -> None:
        snap = self.run_state.get_snapshot()
        if not snap:
            return
        with self.clients_lock:
            clients = list(self.clients)
        dead = [c for c in clients if not c.send("snapshot", snap)]
        if dead:
            with self.clients_lock:
                self.clients = [c for c in self.clients if c not in dead]
