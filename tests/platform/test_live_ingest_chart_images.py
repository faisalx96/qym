"""Raw PNG uploads for chart refs declared by a live turn."""

from __future__ import annotations

import hashlib
import struct
from datetime import datetime

import pytest
from sqlalchemy.orm import sessionmaker
from test_live_ingest_sources import (  # noqa: F401
    BASE,
    _auth_headers,
    _auth_mode,
    _seed_api_key,
)

from _live_support import _png, seed_week
from qym_platform.db.models import LiveChartImage, LiveSource, LiveTurn, Project
from qym_platform.settings import PlatformSettings

TURN_ID = "turn-2026-11-01-0"
REF = "chart_20261101_abcd1234"
OTHER_REF = "chart_20261101_ffff0000"


@pytest.fixture()
def session_factory(database):
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        _seed_api_key(db)
        source = seed_week(db, "live-project-1")
        turn = db.query(LiveTurn).filter_by(source_id=source.id, turn_id=TURN_ID).one()
        turn.summary = {
            "charts": [
                {"ref": REF, "title": "Sales"},
                {"ref": OTHER_REF, "title": "Orders"},
            ]
        }
        db.commit()
    return factory


def _upload(client, data=None, turn_id=TURN_ID, ref=REF, **kwargs):
    headers = {**_auth_headers(), "Content-Type": "image/png"}
    headers.update(kwargs.pop("headers", {}))
    return client.put(
        f"{BASE}/turns/{turn_id}/charts/{ref}/image",
        headers=headers,
        content=_png() if data is None else data,
        **kwargs,
    )


def test_create_then_replace_image(client, session_factory, monkeypatch):
    now = datetime(2026, 11, 1, 12)
    monkeypatch.setattr("qym_platform.services.live_ingest.utcnow", lambda: now)
    first = _png()
    response = _upload(client, first)
    assert response.status_code == 204, response.text
    assert response.content == b""
    with session_factory() as db:
        row = db.query(LiveChartImage).one()
        original_id, original_sha = row.id, row.sha256
        turn = db.query(LiveTurn).filter_by(turn_id=TURN_ID).one()
        assert row.turn_pk == turn.id and row.ref == REF
        assert (row.width, row.height) == (3, 2)
        assert row.image == first and row.byte_size == len(first)
        assert row.content_type == "image/png"
        assert row.sha256 == hashlib.sha256(first).hexdigest()
        assert row.received_at == now

    now = datetime(2026, 11, 1, 13)
    second = _png(width=2, height=1, color=b"\x00\xff\x00\xff")
    response = _upload(client, second)
    assert response.status_code == 204, response.text
    assert response.content == b""
    with session_factory() as db:
        row = db.query(LiveChartImage).one()
        assert row.id == original_id
        assert row.sha256 != original_sha
        assert row.sha256 == hashlib.sha256(second).hexdigest()
        assert row.image == second and row.byte_size == len(second)
        assert (row.width, row.height) == (2, 1)
        assert row.received_at == now


def test_unknown_turn_is_404(client, session_factory):
    response = _upload(client, turn_id="unknown")
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "turn not found"
    with session_factory() as db:
        assert db.query(LiveChartImage).count() == 0


@pytest.mark.parametrize("charts", [[], None, "invalid", [None, "invalid", {}]])
def test_ref_not_in_charts_is_404(client, session_factory, charts):
    with session_factory() as db:
        db.query(LiveTurn).filter_by(turn_id=TURN_ID).one().summary = {"charts": charts}
        db.commit()
    response = _upload(client)
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "chart not found"


def test_unknown_ref_is_404(client):
    response = _upload(client, ref="unknown")
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "chart not found"


@pytest.mark.parametrize("length", ["declared", "missing", "understated"])
def test_body_over_cap_is_413(client, session_factory, monkeypatch, length):
    limit = 65536
    monkeypatch.setattr(
        "qym_platform.api.live_ingest.ingest_settings",
        lambda: PlatformSettings(live_chart_image_max_bytes=limit),
    )
    png = _png()
    data = png + b"\x00" * (limit + 1 - len(png))
    headers = {"Content-Length": "1"} if length == "understated" else {}
    if length != "declared":
        data = iter([data[:limit], data[limit:]])
    response = _upload(client, data, headers=headers)
    assert response.status_code == 413, response.text
    assert f"{limit} byte limit" in response.json()["detail"]
    assert "send smaller batches" in response.json()["detail"]
    with session_factory() as db:
        assert db.query(LiveChartImage).count() == 0


def test_jpeg_content_type_is_415(client):
    response = _upload(client, headers={"Content-Type": "image/jpeg"})
    assert response.status_code == 415, response.text
    assert response.json()["detail"] == "unsupported content type"


@pytest.mark.parametrize(
    "data",
    [
        b"not a PNG",
        b"\x89PNG\r\n\x1a\n",
        _png()[:24],
        _png()[:12] + b"IDAT" + _png()[16:],
        _png()[:8] + struct.pack(">I", 8) + _png()[12:],
        _png(width=0),
    ],
)
def test_invalid_png_is_422(client, session_factory, data):
    response = _upload(client, data)
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == "invalid PNG"
    with session_factory() as db:
        assert db.query(LiveChartImage).count() == 0


def test_cap_blocks_new_refs_but_allows_replacement(
    client, session_factory, monkeypatch
):
    monkeypatch.setattr(
        "qym_platform.api.live_ingest.ingest_settings",
        lambda: PlatformSettings(live_chart_images_per_turn=1),
    )
    assert _upload(client).status_code == 204
    response = _upload(client, ref=OTHER_REF)
    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "chart image limit reached"
    replacement = _png(width=1)
    assert _upload(client, replacement).status_code == 204
    with session_factory() as db:
        row = db.query(LiveChartImage).one()
        assert row.ref == REF and row.image == replacement


def test_other_project_key_is_403(client, session_factory):
    with session_factory() as db:
        _seed_api_key(db, token="other-live-token", suffix="2")
    response = _upload(client, headers=_auth_headers("other-live-token"))
    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "API key belongs to another project"
    with session_factory() as db:
        assert db.query(LiveChartImage).count() == 0


def test_archived_project_uses_existing_key_refusal(client, session_factory):
    with session_factory() as db:
        db.get(Project, "live-project-1").is_active = False
        db.commit()
    response = _upload(client)
    assert response.status_code == 409, response.text
    assert response.headers["X-Qym-Key-State"] == "project_archived"
    assert (
        response.json()["detail"]
        == "Project is archived; its API keys stop working until an admin unarchives it"
    )
    with session_factory() as db:
        assert db.query(LiveChartImage).count() == 0


def test_turn_id_can_contain_slashes(client, session_factory):
    turn_id = "conversation/turn/1"
    with session_factory() as db:
        db.query(LiveTurn).filter_by(turn_id=TURN_ID).one().turn_id = turn_id
        db.commit()
    response = _upload(client, turn_id=turn_id)
    assert response.status_code == 204, response.text
    with session_factory() as db:
        row = db.query(LiveChartImage).one()
        assert db.get(LiveTurn, row.turn_pk).turn_id == turn_id


def test_image_put_does_not_reach_put_source(client, session_factory, monkeypatch):
    def unexpected_source_write(*args, **kwargs):
        pytest.fail("Image PUT reached put_source")

    monkeypatch.setattr(
        "qym_platform.services.live_ingest.upsert_source", unexpected_source_write
    )
    response = _upload(client)
    assert response.status_code == 204, response.text
    with session_factory() as db:
        assert db.query(LiveSource).one().name == "Production worker"
        assert db.query(LiveChartImage).count() == 1


@pytest.mark.parametrize("ref", ["invalid ref", "x" * 101, "رسم"])
def test_invalid_ref_is_422(client, ref):
    response = _upload(client, ref=ref)
    assert response.status_code == 422, response.text
    assert any(error["loc"] == ["path", "ref"] for error in response.json()["detail"])


def test_maintenance_blocks_image_upload(client, session_factory, monkeypatch):
    monkeypatch.setattr(
        "qym_platform.api.ingest.ingest_settings",
        lambda: PlatformSettings(maintenance_mode=True),
    )
    response = _upload(client)
    assert response.status_code == 503, response.text
    assert response.headers["Retry-After"] == "60"
    with session_factory() as db:
        assert db.query(LiveChartImage).count() == 0


def test_service_returns_created_or_replaced_without_committing(session_factory):
    from qym_platform.services.live_ingest import upsert_chart_image

    settings = PlatformSettings()
    with session_factory() as db:
        source = db.query(LiveSource).one()
        assert upsert_chart_image(db, source, TURN_ID, REF, _png(), settings) == "created"
        db.flush()
        assert upsert_chart_image(db, source, TURN_ID, REF, _png(), settings) == "replaced"
        db.flush()
        assert db.query(LiveChartImage).count() == 1
        db.rollback()
    with session_factory() as db:
        assert db.query(LiveChartImage).count() == 0


@pytest.mark.parametrize("service", ["main", "ingestion"])
def test_openapi_has_binary_png_body_and_204(service):
    from qym_platform.app import create_app, create_ingestion_app

    factory = create_ingestion_app if service == "ingestion" else create_app
    app = factory(PlatformSettings(service=service, database_url="sqlite://"))
    document = app.openapi()
    path = (
        "/v1/projects/{project_id}/live/sources/{key}"
        "/turns/{turn_id}/charts/{ref}/image"
    )
    prefixes = ("", "/ingestion") if service == "ingestion" else ("",)
    for prefix in prefixes:
        operation = document["paths"][prefix + path]["put"]
        assert operation["requestBody"] == {
            "required": True,
            "content": {"image/png": {"schema": {"type": "string", "format": "binary"}}},
        }
        assert "204" in operation["responses"]
        assert "content" not in operation["responses"]["204"]
