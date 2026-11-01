"""Keep the published live ingest routes and executable example in sync."""

from __future__ import annotations

import io
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

import pytest
from qym_platform.api.live_ingest import live_ingest_router
from qym_platform.db.models import LiveTurn
from sqlalchemy.orm import sessionmaker
from test_live_ingest_sources import TOKEN, _auth_headers, _seed_api_key

GUIDE = Path(__file__).resolve().parents[2] / "docs/live-evaluation-ingest-v1.0.md"


@pytest.fixture()
def session_factory(database, monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as session:
        _seed_api_key(session)
    return factory


def test_guide_lists_every_route():
    reference = GUIDE.read_text(encoding="utf-8").split("## 8. Quick reference", 1)[1]
    documented = set(
        re.findall(r"^\| `(\w+)` \| `([^`]+)` \|", reference, flags=re.MULTILINE)
    )
    expected = {
        (method, route.path)
        for route in live_ingest_router.routes
        for method in route.methods
    }
    assert expected <= documented, f"Missing routes: {expected - documented}"


def test_guide_python_example_runs_against_the_app(
    client, session_factory, monkeypatch, capsys
):
    example = re.search(
        r"^```python\s*\n(.*?)^```",
        GUIDE.read_text(encoding="utf-8"),
        flags=re.MULTILINE | re.DOTALL,
    )
    assert example is not None, "Guide must contain a runnable Python example"
    code, assignments = re.subn(
        r"^(?:BASE_URL|API_KEY|PROJECT_ID)\s*=.*$",
        "",
        example.group(1),
        flags=re.MULTILINE,
    )
    assert assignments == 3, "Example must define its three connection settings"
    base_url = "http://guide.test"

    class Response(io.BytesIO):
        def __init__(self, content, status):
            super().__init__(content)
            self.status = status

    def urlopen(request, timeout=None):
        assert request.full_url.startswith(base_url + "/")
        response = client.request(
            request.get_method(),
            request.full_url[len(base_url) :],
            headers=dict(request.header_items()),
            content=request.data,
        )
        if response.status_code >= 400:
            raise urllib.error.HTTPError(
                request.full_url,
                response.status_code,
                response.reason_phrase,
                response.headers,
                io.BytesIO(response.content),
            )
        return Response(response.content, response.status_code)

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    namespace = {
        "BASE_URL": base_url,
        "API_KEY": TOKEN,
        "PROJECT_ID": "live-project-1",
        "__name__": "__main__",
    }
    exec(compile(code, str(GUIDE), "exec"), namespace)

    assert json.loads(capsys.readouterr().out) == ["turn-1", "turn-2"]
    response = client.get(
        "/v1/projects/live-project-1/live/sources/example-worker/turns/ids"
        f"?day={namespace['day']}",
        headers=_auth_headers(),
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"turn_ids": ["turn-1", "turn-2"]}
    with session_factory() as session:
        turns = session.query(LiveTurn).order_by(LiveTurn.turn_id).all()
        assert [turn.turn_id for turn in turns] == ["turn-1", "turn-2"]
