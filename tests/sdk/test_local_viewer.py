"""The SDK's offline results viewer: server endpoints, live tracker, Evaluator and CLI wiring."""

from __future__ import annotations

import csv
import http.client
import json
import threading
import time
from pathlib import Path
from urllib.parse import quote

import pytest
from typer.testing import CliRunner

from qym.cli.app import app
from qym.core.checkpoint import build_checkpoint_header, serialize_checkpoint_row
from qym.core.dataset import CsvDataset
from qym.core.evaluator import Evaluator
from qym.server import LiveTracker, UIServer


class _Item:
    def __init__(self, text: str):
        self.input = text
        self.expected_output = text.upper()


@pytest.fixture
def static_dir(tmp_path, monkeypatch):
    d = tmp_path / "ui"
    d.mkdir()
    (d / "index.html").write_text("<!doctype html><title>viewer</title>", encoding="utf-8")
    (d / "app.js").write_text("console.log(1)", encoding="utf-8")
    (d / "app.css").write_text("body{}", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("nope", encoding="utf-8")
    monkeypatch.setenv("QYM_STATIC_DIR", str(d))
    return d


@pytest.fixture
def server(static_dir, tmp_path):
    srv = UIServer(port=0, results_dir=str(tmp_path / "qym_results"))
    srv.start()
    yield srv
    srv.stop()


def _get(srv: UIServer, path: str, method: str = "GET", body: object = None):
    conn = http.client.HTTPConnection(srv.host, srv.port, timeout=5)
    payload = json.dumps(body) if body is not None else None
    conn.request(method, path, body=payload)
    resp = conn.getresponse()
    data = resp.read()
    conn.close()
    return resp.status, resp.getheader("Content-Type"), data


def _json(srv: UIServer, path: str, method: str = "GET", body: object = None):
    status, _, data = _get(srv, path, method, body)
    return status, json.loads(data)


def _results_csv(tmp_path: Path) -> Path:
    path = tmp_path / "qym_results" / "task" / "model" / "2026-01-01" / "run-1.csv"
    path.parent.mkdir(parents=True)
    rows = [
        serialize_checkpoint_row(
            dataset_name="ds",
            run_name="run-1",
            run_metadata={"total_items": 2},
            run_config={},
            trace_id=f"t{i}",
            item_id=f"item-{i}",
            item_input=f"input {i}",
            item_metadata={},
            output=f"out {i}",
            expected_output="exp",
            time_seconds=0.5,
            task_started_at_ms=1,
            scores={"accuracy": float(i)},
            metric_meta={},
        )
        for i in range(2)
    ]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=build_checkpoint_header(["accuracy"]))
        writer.writeheader()
        writer.writerows(rows)
    return path


class TestStaticAndLiveApi:
    def test_serves_index_assets_and_run_route(self, server):
        for path in ("/", "/index.html", "/run/anything%2Fhere.csv"):
            status, ctype, body = _get(server, path)
            assert status == 200 and b"<title>viewer</title>" in body, path
            assert ctype.startswith("text/html")
        status, ctype, _ = _get(server, "/app.js")
        assert status == 200 and ctype.startswith("application/javascript")
        status, ctype, _ = _get(server, "/app.css")
        assert status == 200 and ctype.startswith("text/css")

    def test_unknown_file_and_traversal_are_404(self, server):
        assert _get(server, "/missing.js")[0] == 404
        assert _get(server, "/..%2Fsecret.txt")[0] == 404
        assert _get(server, "/../secret.txt")[0] == 404
        assert _get(server, "/api/nope")[0] == 404

    def test_run_and_snapshot_start_empty_then_follow_state(self, server):
        assert _json(server, "/api/run") == (200, {})
        assert _json(server, "/api/snapshot") == (200, {})
        server.run_state.set_run_info({"run_name": "r1", "status": "RUNNING"})
        server.run_state.set_snapshot({"rows": [], "stats": {"total": 0}, "metric_names": []})
        assert _json(server, "/api/run")[1]["run_name"] == "r1"
        assert _json(server, "/api/snapshot")[1]["stats"]["total"] == 0

    def test_sse_sends_current_snapshot_updates_and_done(self, server):
        server.run_state.set_snapshot({"rows": [], "stats": {"total": 1}, "metric_names": []})
        conn = http.client.HTTPConnection(server.host, server.port, timeout=5)
        conn.request("GET", "/api/rows/stream")
        resp = conn.getresponse()
        assert resp.status == 200 and resp.getheader("Content-Type") == "text/event-stream"

        def read_event() -> tuple:
            name, data = None, None
            while True:
                line = resp.fp.readline().decode("utf-8").rstrip("\n")
                if line.startswith("event: "):
                    name = line[7:]
                elif line.startswith("data: "):
                    data = json.loads(line[6:])
                elif line == "" and name:
                    return name, data

        assert read_event() == ("snapshot", {"rows": [], "stats": {"total": 1}, "metric_names": []})
        deadline = time.time() + 2
        while not server.clients and time.time() < deadline:
            time.sleep(0.01)
        server.run_state.set_snapshot({"rows": [], "stats": {"total": 2}, "metric_names": []})
        server.broadcast_snapshot()
        assert read_event()[1]["stats"]["total"] == 2
        server.finish()  # final snapshot, then done
        assert read_event()[0] == "snapshot"
        assert read_event() == ("done", {"ok": True})
        conn.close()


class TestSavedFileApi:
    def test_run_file_returns_run_and_snapshot(self, server, tmp_path):
        path = _results_csv(tmp_path)
        status, data = _json(server, f"/api/runs/{quote(str(path), safe='')}")
        assert status == 200
        assert data["run"]["file_path"] == str(path)
        assert data["run"]["metric_names"] == ["accuracy"]
        assert data["snapshot"]["stats"]["total"] == 2
        assert [r["input"] for r in data["snapshot"]["rows"]] == ["input 0", "input 1"]

    def test_missing_file_is_404_with_message(self, server):
        status, data = _json(server, "/api/runs/nope.csv")
        assert status == 404 and "File not found" in data["error"]

    def test_only_results_files_can_be_opened(self, server):
        status, data = _json(server, "/api/runs/%2Fetc%2Fpasswd")
        assert status == 400 and ".csv" in data["error"]

    def test_update_metric_edits_the_file_and_returns_the_row(self, server, tmp_path):
        path = _results_csv(tmp_path)
        status, data = _json(
            server,
            "/api/runs/update_metric",
            "POST",
            {"file_path": str(path), "metric_name": "accuracy", "row_index": 0, "new_score": 0.25},
        )
        assert status == 200 and data["ok"] is True
        assert float(data["row"]["metric_values"][0]) == 0.25
        reread = _json(server, f"/api/runs/{quote(str(path), safe='')}")[1]
        assert float(reread["snapshot"]["rows"][0]["metric_values"][0]) == 0.25

    @pytest.mark.parametrize(
        "body, fragment",
        [
            ({"file_path": "x.csv"}, "Missing"),
            ({"file_path": "x.txt", "metric_name": "m", "row_index": 0}, ".csv"),
            ({"file_path": "x.csv", "metric_name": "m", "row_index": "a"}, "row_index"),
        ],
    )
    def test_update_metric_rejects_bad_requests(self, server, body, fragment):
        status, data = _json(server, "/api/runs/update_metric", "POST", body)
        assert status == 400 and fragment in data["error"]

    def test_update_metric_unknown_metric_is_400(self, server, tmp_path):
        path = _results_csv(tmp_path)
        status, data = _json(
            server,
            "/api/runs/update_metric",
            "POST",
            {"file_path": str(path), "metric_name": "nope", "row_index": 0, "new_score": 1},
        )
        assert status == 400 and "Metric not found" in data["error"]

    def test_unknown_post_route_is_404(self, server):
        assert _json(server, "/api/other", "POST", {})[0] == 404


class TestLiveTracker:
    def test_changes_are_coalesced_and_the_last_one_is_published(self, server):
        tracker = LiveTracker([_Item("a"), _Item("b")], ["m"], server, min_interval=0.05)
        assert server.run_state.get_snapshot()["stats"]["pending"] == 2
        tracker.start_item(0)
        tracker.update_output(0, "A")
        tracker.update_metric(0, "m", 1.0)
        tracker.complete_item(0, elapsed_time=0.1)
        tracker.start_item(1)
        tracker.fail_item(1, "boom", elapsed_time=0.1)
        deadline = time.time() + 2
        while server.run_state.get_snapshot()["stats"]["failed"] != 1 and time.time() < deadline:
            time.sleep(0.01)
        stats = server.run_state.get_snapshot()["stats"]
        assert (stats["completed"], stats["failed"], stats["pending"]) == (1, 1, 0)
        tracker.close()

    def test_close_publishes_the_final_state_without_waiting(self, server):
        tracker = LiveTracker([_Item("a")], ["m"], server, min_interval=30)
        tracker.start_item(0)
        tracker.complete_item(0, elapsed_time=0.1)
        tracker.close()
        assert server.run_state.get_snapshot()["stats"]["completed"] == 1

    def test_pending_markup_never_reaches_the_viewer(self, server):
        LiveTracker([_Item("a")], ["m"], server)
        row = server.run_state.get_snapshot()["rows"][0]
        assert row["output_full"] == "pending" and "[dim]" not in json.dumps(row)


class TestStreamLifecycle:
    def test_stream_socket_closes_when_the_server_stops_without_done(self, server):
        """A dropped server must be visible to the browser (EventSource error -> reconnect banner)."""
        import socket

        sock = socket.create_connection((server.host, server.port), timeout=5)
        sock.sendall(b"GET /api/rows/stream HTTP/1.1\r\nHost: x\r\n\r\n")
        assert b"text/event-stream" in sock.recv(512)
        server._stop.set()  # what an abrupt stop does, without the `done` event
        sock.settimeout(5)
        try:
            while sock.recv(4096):
                pass  # EOF (b"") means the server closed the connection
        finally:
            sock.close()


class TestEvaluatorLocalUi:
    def test_local_ui_serves_the_live_run_and_marks_it_completed(self, static_dir, tmp_path):
        ds = tmp_path / "ds.csv"
        ds.write_text("input,expected_output\nhello,HELLO\nمرحبا,x\n", encoding="utf-8")
        evaluator = Evaluator(
            task=lambda input: input.upper(),
            dataset=CsvDataset(str(ds)),
            metrics=["exact_match"],
            config={"local_ui": True, "output_dir": str(tmp_path / "out")},
        )
        evaluator.run(show_tui=False, auto_save=False)
        srv = evaluator._ui_server
        try:
            assert srv is not None and evaluator.local_ui_url == srv.url
            status, run = _json(srv, "/api/run")
            assert status == 200 and run["status"] == "COMPLETED" and run["ended_at"]
            # both timestamps are UTC ("Z"): the viewer's elapsed time is their difference
            assert run["started_at"].endswith("Z") and run["ended_at"].endswith("Z")
            assert run["started_at"] <= run["ended_at"]
            snap = _json(srv, "/api/snapshot")[1]
            assert snap["stats"]["completed"] == 2 and snap["metric_names"] == ["exact_match"]
        finally:
            srv.stop()

    def test_default_run_starts_no_server(self, tmp_path):
        ds = tmp_path / "ds.csv"
        ds.write_text("input,expected_output\nhello,HELLO\n", encoding="utf-8")
        evaluator = Evaluator(
            task=lambda input: input,
            dataset=CsvDataset(str(ds)),
            metrics=["exact_match"],
            config={"output_dir": str(tmp_path / "out")},
        )
        evaluator.run(show_tui=False, auto_save=False)
        assert evaluator._ui_server is None


class TestCliWiring:
    def test_run_create_local_ui_flags_reach_the_config(self, tmp_path, monkeypatch):
        seen = {}

        class FakeEvaluator:
            _ui_server = None

            def __init__(self, **kwargs):
                seen.update(kwargs["config"])

            def run(self, **kwargs):
                seen["run_kwargs"] = kwargs
                raise SystemExit(0)

        monkeypatch.setattr("qym.core.evaluator.Evaluator", FakeEvaluator)
        task = tmp_path / "task.py"
        task.write_text("def f(input):\n    return input\n", encoding="utf-8")
        ds = tmp_path / "ds.csv"
        ds.write_text("input,expected_output\na,A\n", encoding="utf-8")
        CliRunner().invoke(
            app,
            [
                "run", "create", "--task-file", str(task), "--task-function", "f",
                "--dataset-file", str(ds), "--metrics", "exact_match",
                "--local-ui", "--ui-port", "8818", "--no-open",
            ],
        )
        assert seen["local_ui"] is True and seen["ui_port"] == 8818
        assert seen["local_ui_open"] is False
        assert seen["run_kwargs"] == {"show_tui": True}

    def test_run_create_without_flag_does_not_enable_the_viewer(self, tmp_path, monkeypatch):
        seen = {}

        class FakeEvaluator:
            _ui_server = None

            def __init__(self, **kwargs):
                seen.update(kwargs["config"])

            def run(self, **kwargs):
                raise SystemExit(0)

        monkeypatch.setattr("qym.core.evaluator.Evaluator", FakeEvaluator)
        task = tmp_path / "task.py"
        task.write_text("def f(input):\n    return input\n", encoding="utf-8")
        ds = tmp_path / "ds.csv"
        ds.write_text("input,expected_output\na,A\n", encoding="utf-8")
        CliRunner().invoke(
            app,
            ["run", "create", "--task-file", str(task), "--task-function", "f",
             "--dataset-file", str(ds), "--metrics", "exact_match"],
        )
        assert "local_ui" not in seen

    def test_ui_command_reports_missing_file(self, tmp_path):
        result = CliRunner().invoke(app, ["ui", str(tmp_path / "nope.csv"), "--no-open"])
        assert result.exit_code == 3

    def test_ui_command_serves_the_file_url(self, static_dir, tmp_path, monkeypatch):
        path = _results_csv(tmp_path)
        started = {}
        original_start = UIServer.start

        def start(self):
            result = original_start(self)
            started["server"] = self
            threading.Timer(0.2, self._stop.set).start()  # end the blocking wait
            return result

        monkeypatch.setattr(UIServer, "start", start)
        result = CliRunner().invoke(app, ["--json", "ui", str(path), "--port", "0"])
        assert result.exit_code == 0, result.output
        url = json.loads(result.stdout)["viewer_url"]
        assert url.startswith(f"http://127.0.0.1:{started['server'].port}/run/")
        assert quote(str(path), safe="") in url

    def test_ui_command_explains_a_missing_build(self, tmp_path, monkeypatch):
        monkeypatch.setenv("QYM_STATIC_DIR", str(tmp_path / "does-not-exist"))
        monkeypatch.setattr(UIServer, "has_viewer", lambda self: False)
        result = CliRunner().invoke(app, ["ui", "--no-open"])
        assert result.exit_code == 1
