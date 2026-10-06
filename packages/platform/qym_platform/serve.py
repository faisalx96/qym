"""Serve HTTP from several processes: ``python -m qym_platform.serve``.

One Python process serves every request on one GIL, so CPU-heavy responses
(run detail, compare) make every other request wait. ``QYM_WEB_WORKERS=N``
(N > 1) runs N uvicorn worker processes instead. The background loops (the
dashboard summary worker and the maintenance worker) must still run in one
place, so with the default ``QYM_ROLE=all`` this launcher starts:

* ``uvicorn --workers N`` with ``QYM_ROLE=api`` (HTTP only), and
* one ``python -m qym_platform.worker`` process with ``QYM_ROLE=worker``
  (the loops), restarted with a back-off if it exits.

With ``QYM_ROLE=api`` (loops in a separate worker Deployment) only the web
workers start. The launcher forwards SIGTERM/SIGINT to both children, and
exits when uvicorn exits so the container restarts as before.

``docker/entrypoint.sh`` uses this launcher only when ``QYM_WEB_WORKERS`` is
above 1; the default stays the single ``uvicorn`` process.
"""

from __future__ import annotations

import logging
import os
import shlex
import socket
import signal
import subprocess
import sys
import threading
import time
from typing import Dict, List, Optional

logger = logging.getLogger("qym_platform.serve")


def web_workers(env: Optional[Dict[str, str]] = None) -> int:
    env = os.environ if env is None else env
    raw = str(env.get("QYM_WEB_WORKERS", "1") or "1").strip()
    try:
        value = int(raw)
    except ValueError:
        raise SystemExit(f"QYM_WEB_WORKERS must be a whole number, got {raw!r}")
    if value < 1:
        raise SystemExit("QYM_WEB_WORKERS must be 1 or more")
    return value


def _set_nodelay(transport) -> None:
    sock = transport.get_extra_info("socket")
    if sock is None or sock.family not in (socket.AF_INET, socket.AF_INET6):
        return
    try:
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except OSError:  # pragma: no cover - platform without the option
        pass


try:  # uvicorn's own "auto" choice: httptools when installed, else h11
    from uvicorn.protocols.http.httptools_impl import HttpToolsProtocol as _BaseHttpProtocol
except ImportError:
    from uvicorn.protocols.http.h11_impl import H11Protocol as _BaseHttpProtocol


class HttpProtocol(_BaseHttpProtocol):  # type: ignore[misc, valid-type]
    """uvicorn's HTTP protocol with Nagle off on every connection.

    Single-process uvicorn gets TCP_NODELAY from asyncio. With ``--workers``
    each child rebuilds the listening socket from a shared descriptor whose
    ``proto`` reads 0, asyncio then skips TCP_NODELAY, and every keep-alive
    response waits about 40 ms for the client's delayed ACK.
    """

    def connection_made(self, transport) -> None:  # type: ignore[override]
        _set_nodelay(transport)
        super().connection_made(transport)


def run_uvicorn(argv: List[str]) -> int:
    """``uvicorn`` CLI with :class:`HttpProtocol` unless ``--http`` is given.

    The CLI only accepts protocol names, so the arguments are parsed by
    uvicorn's own command and the class is passed to ``uvicorn.run``.
    """
    from uvicorn.main import main as uvicorn_cli

    ctx = uvicorn_cli.make_context("uvicorn", list(argv))
    params = dict(ctx.params)
    if not any(arg == "--http" or arg.startswith("--http=") for arg in argv):
        params["http"] = HttpProtocol
    with ctx:
        uvicorn_cli.callback(**params)
    return 0


def plan(env: Optional[Dict[str, str]] = None) -> Dict[str, object]:
    """The processes to start: uvicorn's argv/env and the optional loop process."""
    env = dict(os.environ if env is None else env)
    role = (env.get("QYM_ROLE") or "all").strip().lower()
    if role == "worker":
        raise SystemExit("QYM_ROLE=worker runs `python -m qym_platform.worker`, not the web launcher")
    workers = web_workers(env)
    extra = shlex.split(env.get("QYM_UVICORN_ARGS", ""))
    uvicorn_argv: List[str] = [
        sys.executable,
        "-m",
        "qym_platform.serve",
        "--uvicorn",
        "qym_platform.main:app",
        "--host",
        env.get("QYM_HOST", "0.0.0.0"),
        "--port",
        env.get("QYM_PORT", "8000"),
        "--workers",
        str(workers),
    ] + extra
    web_env = dict(env)
    loops_env: Optional[Dict[str, str]] = None
    if role == "all" and workers > 1:
        # HTTP workers leave the loops to the single loop process below.
        web_env["QYM_ROLE"] = "api"
        loops_env = dict(env)
        loops_env["QYM_ROLE"] = "worker"
    return {
        "workers": workers,
        "uvicorn_argv": uvicorn_argv,
        "web_env": web_env,
        "loops_argv": [sys.executable, "-m", "qym_platform.worker"] if loops_env else None,
        "loops_env": loops_env,
    }


class _Supervisor:
    def __init__(self, spec: Dict[str, object]) -> None:
        self.spec = spec
        self.stopping = threading.Event()
        self.web: Optional[subprocess.Popen] = None
        self.loops: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()

    def _start_loops(self) -> None:
        self.loops = subprocess.Popen(self.spec["loops_argv"], env=self.spec["loops_env"])  # type: ignore[arg-type]
        logger.info("background loops started (pid %s)", self.loops.pid)

    def _watch_loops(self) -> None:
        delay = 1.0
        while not self.stopping.is_set():
            loops = self.loops
            if loops is None:
                return
            started = time.monotonic()
            code = loops.wait()
            if self.stopping.is_set():
                return
            # A process that ran for a while restarts at once; a crash loop backs off.
            delay = 1.0 if time.monotonic() - started > 60 else min(delay * 2, 30.0)
            logger.error("background loops exited with %s; restarting in %.0fs", code, delay)
            if self.stopping.wait(delay):
                return
            with self._lock:
                if not self.stopping.is_set():
                    self._start_loops()

    def _signal(self, signum, _frame) -> None:
        self.stopping.set()
        for proc in (self.web, self.loops):
            if proc is not None and proc.poll() is None:
                try:
                    proc.send_signal(signum)
                except ProcessLookupError:  # pragma: no cover - raced with exit
                    pass

    def run(self) -> int:
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, self._signal)
        if self.spec["loops_argv"]:
            self._start_loops()
            threading.Thread(target=self._watch_loops, name="qym-loops-watch", daemon=True).start()
        self.web = subprocess.Popen(self.spec["uvicorn_argv"], env=self.spec["web_env"])  # type: ignore[arg-type]
        code = self.web.wait()
        self.stopping.set()
        loops = self.loops
        if loops is not None and loops.poll() is None:
            loops.terminate()
            try:
                loops.wait(timeout=20)
            except subprocess.TimeoutExpired:
                loops.kill()
        return code


def main() -> int:
    if sys.argv[1:2] == ["--uvicorn"]:
        return run_uvicorn(sys.argv[2:])
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    spec = plan()
    logger.info(
        "starting %s web worker(s)%s",
        spec["workers"],
        " and one background-loop process" if spec["loops_argv"] else "",
    )
    return _Supervisor(spec).run()


if __name__ == "__main__":
    raise SystemExit(main())
