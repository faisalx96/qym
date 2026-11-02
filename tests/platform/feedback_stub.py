"""A scripted OpenAI-compatible server for the feedback tests (and, as ``frontend/scripts/stub_llm.py``, Playwright).

The conversation scripts are ``tests/platform/feedback_scripts/*.json``; select one with the model name
``feedback:<script>``. The same engine (``frontend/scripts/feedback_llm_engine.py``) serves both, so the tests and the
browser specs exercise one behaviour.
"""

from __future__ import annotations

import sys
import threading
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "frontend" / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import stub_llm  # noqa: E402


@contextmanager
def stub_server():
    """Yield the base URL (``http://127.0.0.1:<port>/v1``) of a running stub."""
    stub_llm.Handler.delay = 0.0
    server = ThreadingHTTPServer(("127.0.0.1", 0), stub_llm.Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/v1"
    finally:
        server.shutdown()
        server.server_close()
