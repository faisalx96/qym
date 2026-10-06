"""C032: gzip level for dynamic responses and once-per-version static compression."""

from __future__ import annotations

import gzip
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.middleware.gzip import GZipMiddleware

from qym_platform import static_files
from qym_platform.app import GZIP_COMPRESSLEVEL, create_app
from qym_platform.static_files import GZipExceptStatic, PrecompressedStaticFiles

STATIC = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "platform"
    / "qym_platform"
    / "_static"
    / "dashboard"
)


def test_dynamic_responses_use_a_balanced_gzip_level() -> None:
    app = create_app()
    gzip_layers = [m for m in app.user_middleware if m.cls in (GZipMiddleware, GZipExceptStatic)]
    assert len(gzip_layers) == 1
    # Starlette's default is 9: ~3x the CPU of 6 on multi-MB JSON for 2-4 %.
    assert gzip_layers[0].kwargs["compresslevel"] == GZIP_COMPRESSLEVEL
    assert 4 <= GZIP_COMPRESSLEVEL <= 6


def test_static_mounts_serve_precompressed_assets() -> None:
    app = create_app()
    mounts = {route.path: route.app for route in app.routes if getattr(route, "path", None) in {"/static", "/ui"}}
    assert mounts and all(isinstance(m, PrecompressedStaticFiles) for m in mounts.values())


@pytest.fixture
def asset_dir(tmp_path: Path) -> Path:
    (tmp_path / "app.js").write_text("console.log('qym');\n" * 400, encoding="utf-8")
    (tmp_path / "tiny.css").write_text("a{}", encoding="utf-8")
    (tmp_path / "logo.png").write_bytes(b"\x89PNG" + os.urandom(4096))
    return tmp_path


def _client(directory: Path) -> TestClient:
    from fastapi import FastAPI

    app = FastAPI()
    app.add_middleware(GZipExceptStatic, minimum_size=1024, compresslevel=GZIP_COMPRESSLEVEL)

    @app.get("/api/big")
    def big():
        return {"rows": ["x" * 40] * 200}

    app.mount("/static", PrecompressedStaticFiles(directory=str(directory)), name="static")
    return TestClient(app)


def test_text_asset_is_compressed_once_and_reused(asset_dir: Path, monkeypatch) -> None:
    calls = []
    real = gzip.compress

    def counting(data, *args, **kwargs):
        calls.append(len(data))
        return real(data, *args, **kwargs)

    monkeypatch.setattr(static_files.gzip, "compress", counting)
    client = _client(asset_dir)
    source = (asset_dir / "app.js").read_bytes()
    for _ in range(3):
        response = client.get("/static/app.js", headers={"Accept-Encoding": "gzip"})
        assert response.status_code == 200
        assert response.headers["content-encoding"] == "gzip"
        assert response.headers["vary"] == "Accept-Encoding"
        assert "javascript" in response.headers["content-type"]
        assert response.content == source  # the client decompresses
        assert int(response.headers["content-length"]) < len(source) / 5
        assert response.headers.get("etag")
    assert calls == [len(source)]

    # An edited file has a new mtime/size, so the stale copy is never served.
    edited = source + b"console.log('edited');\n"
    (asset_dir / "app.js").write_bytes(edited)
    stat = (asset_dir / "app.js").stat()
    os.utime(asset_dir / "app.js", ns=(stat.st_atime_ns, stat.st_mtime_ns + 5_000_000_000))
    response = client.get("/static/app.js", headers={"Accept-Encoding": "gzip"})
    assert response.content == edited
    assert len(calls) == 2


def test_conditional_and_plain_requests_keep_working(asset_dir: Path) -> None:
    client = _client(asset_dir)
    first = client.get("/static/app.js", headers={"Accept-Encoding": "gzip"})
    etag = first.headers["etag"]
    not_modified = client.get(
        "/static/app.js", headers={"Accept-Encoding": "gzip", "If-None-Match": etag}
    )
    assert not_modified.status_code == 304

    plain = client.get("/static/app.js", headers={"Accept-Encoding": "identity"})
    assert plain.status_code == 200
    assert "content-encoding" not in plain.headers
    assert plain.content == (asset_dir / "app.js").read_bytes()

    ranged = client.get(
        "/static/app.js", headers={"Accept-Encoding": "gzip", "Range": "bytes=0-9"}
    )
    assert ranged.status_code == 206
    assert ranged.content == (asset_dir / "app.js").read_bytes()[:10]

    head = client.head("/static/app.js", headers={"Accept-Encoding": "gzip"})
    assert head.status_code == 200
    assert head.content == b""


def test_small_and_binary_assets_are_left_alone(asset_dir: Path) -> None:
    client = _client(asset_dir)
    tiny = client.get("/static/tiny.css", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in tiny.headers
    png = client.get("/static/logo.png", headers={"Accept-Encoding": "gzip"})
    assert png.content == (asset_dir / "logo.png").read_bytes()
    # Neither is kept compressed: too small, or not a text type.
    mount = next(route.app for route in client.app.routes if getattr(route, "path", None) == "/static")
    assert mount._gz_cache == {}


def test_real_dashboard_bundle_round_trips() -> None:
    client = _client(STATIC)
    response = client.get("/static/dashboard.js", headers={"Accept-Encoding": "gzip"})
    assert response.status_code == 200
    assert response.headers["content-encoding"] == "gzip"
    assert response.content == (STATIC / "dashboard.js").read_bytes()


def test_dynamic_responses_are_gzipped_and_static_ones_once(asset_dir: Path) -> None:
    client = _client(asset_dir)
    api = client.get("/api/big", headers={"Accept-Encoding": "gzip"})
    assert api.headers["content-encoding"] == "gzip"
    # The static asset is compressed by the mount alone: one gzip layer.
    raw = client.get("/static/app.js", headers={"Accept-Encoding": "gzip"}, )
    assert raw.content == (asset_dir / "app.js").read_bytes()
    with client.stream("GET", "/static/app.js", headers={"Accept-Encoding": "gzip"}) as stream:
        body = b"".join(stream.iter_raw())
    assert gzip.decompress(body) == (asset_dir / "app.js").read_bytes()
