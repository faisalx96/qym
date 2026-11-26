"""Keep the published runner guide in step with the routes, the rules and its own example."""

from __future__ import annotations

import io
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

import pytest
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from _performance_support import (
    NOW,
    RUNNER_TOKEN,
    at_time,
    get_run,
    make_run,
    seed_performance,
    use_encryption_key,
)
from qym_platform.api import performance_ingest as routes
from qym_platform.api.performance_ingest import performance_ingest_router
from qym_platform.db.models import (
    PERFORMANCE_RUN_STATUSES,
    PerformanceLogLine,
    PerformanceQuestion,
    PerformanceReport,
    PerformanceRunner,
)
from qym_platform.services import performance_control, performance_ingest
from qym_platform.settings import PlatformSettings

GUIDE = Path(__file__).resolve().parents[2] / "docs/performance-runner-protocol-v1.0.md"
PREFIX = "/v1/projects/{project_id}/performance"


@pytest.fixture(scope="module")
def guide() -> str:
    return GUIDE.read_text(encoding="utf-8")


def _section(guide: str, number: str) -> str:
    """The text of one numbered ``###`` section."""
    return (
        guide.split(f"\n### {number} ", 1)[1].split("\n### ", 1)[0].split("\n---", 1)[0]
    )


def _route_of(section: str) -> tuple[str, str]:
    method, path = re.match(r"`(\w+) ([^`]+)`", section).groups()
    return method, path


def _curl_json(section: str):
    """The JSON a section's curl example sends with ``-d '...'``."""
    return json.loads(re.search(r"-d '(.*)'\n", section).group(1))


def _json_blocks(section: str) -> list:
    return [
        json.loads(block)
        for block in re.findall(r"```json\n(.*?)\n```", section, flags=re.DOTALL)
    ]


def _table_fields(section: str) -> set[str]:
    return set(re.findall(r"^\| `([a-z_]+)` \|", section, flags=re.MULTILINE))


def test_quick_reference_lists_exactly_the_mounted_routes(guide):
    reference = guide.split("## 9. Quick reference", 1)[1]
    rows = re.findall(
        r"^\| (\d+) \| `(\w+)` \| `([^`]+)` \|", reference, flags=re.MULTILINE
    )
    assert [int(number) for number, _method, _path in rows] == list(range(1, 13))
    documented = {(method, path) for _number, method, path in rows}
    mounted = {
        (method, route.path)
        for route in performance_ingest_router.routes
        for method in route.methods
    }
    assert documented == mounted
    assert len(mounted) == 12 and performance_ingest_router.prefix == PREFIX
    assert f"The router prefix is `{PREFIX}`" in guide


def test_each_route_section_names_its_route_and_its_success_code(guide):
    app = FastAPI()
    app.include_router(performance_ingest_router)
    paths = app.openapi()["paths"]
    reference = guide.split("## 9. Quick reference", 1)[1]
    success = dict(
        (path, codes)
        for path, codes in re.findall(
            r"^\| \d+ \| `\w+` \| `([^`]+)` \| [^|]+\| ([^|]+) \|",
            reference,
            flags=re.MULTILINE,
        )
    )
    seen = set()
    for number in range(1, 13):
        method, path = _route_of(_section(guide, f"3.{number}"))
        operation = paths[PREFIX + path][method.lower()]
        seen.add((method, PREFIX + path))
        for code in re.findall(r"`(\d+)`", success[PREFIX + path]):
            if code != "304":
                assert code in operation["responses"] or code == "201", (path, code)
    assert len(seen) == 12


def test_the_request_examples_are_valid_requests(guide):
    cases = {
        "3.1": routes.PerformanceRegisterBody,
        "3.2": routes.PerformanceHeartbeatBody,
        "3.7": routes.PerformanceLogBody,
        "3.8": routes.PerformanceEventsBody,
        "3.12": routes.PerformanceTokenBody,
    }
    for number, model in cases.items():
        section = _section(guide, number)
        body = model.model_validate(_curl_json(section))
        for field in model.model_fields:
            assert f"`{field}`" in section, (number, field)
        assert body is not None
    assert (
        routes.PerformanceClaimBody.model_validate(_curl_json(_section(guide, "3.4")))
        is not None
    )
    log = routes.PerformanceLogBody.model_validate(_curl_json(_section(guide, "3.7")))
    routes.PerformanceLogLineBody.model_validate(log.lines[0])
    assert _table_fields(_section(guide, "4.5")) == set(
        routes.PerformanceLogLineBody.model_fields
    )
    assert _table_fields(_section(guide, "4.6")) == set(
        routes.PerformanceEventBody.model_fields
    )

    progress_section = _section(guide, "3.5")
    envelope = _json_blocks(progress_section)[0]
    routes.PerformanceProgressBody.model_validate(envelope)
    assert set(routes.PerformanceProgressBody.model_fields) <= _table_fields(
        progress_section
    )
    answer = _json_blocks(progress_section)[1]
    assert set(answer) == {
        "id",
        "status",
        "accepted",
        "stop_requested",
        "stop_reason",
        "token_needed",
        "token_versions",
    }
    (full_progress,) = _json_blocks(_section(guide, "4.3"))
    performance_ingest.check_progress_shape(full_progress)
    assert set(performance_ingest.ANSWER_COUNTERS) <= set(full_progress["answers"])

    record_section = _section(guide, "4.4")
    (record,) = _json_blocks(record_section)
    routes.PerformanceQuestionRecordBody.model_validate(record)
    assert _table_fields(record_section) == set(
        routes.PerformanceQuestionRecordBody.model_fields
    )

    summary_section = _section(guide, "4.7")
    (summary,) = _json_blocks(summary_section)
    checked = routes.PerformanceSummaryBody.model_validate(summary)
    assert checked.headline.safe_load_users == 40
    headline = summary_section.split("`headline`, every field", 1)[1].split(
        "An entry of `thresholds`", 1
    )[0]
    documented = set(re.findall(r"`([a-z0-9_]+)`", headline)) - {
        "latency",
        "errors",
        "both",
    }
    assert documented == set(performance_ingest.HEADLINE_COLUMNS)
    for word, verdicts in routes.VERDICTS.items():
        for verdict in verdicts:
            assert f"`{verdict}`" in summary_section, (word, verdict)


def test_the_control_examples_match_the_document(guide):
    section = _section(guide, "4.1")
    idle, queued, *others = _json_blocks(section)
    assert idle["limits"] == performance_control.limits(PlatformSettings())
    assert set(idle) == {"state", "run", "last_run", "limits"}
    assert set(queued["run"]) == {
        "id",
        "status",
        "requested_at",
        "stop_requested",
        "stop_reason",
        "config",
        "tokens",
        "tokens_digest",
        "token_needed",
    }
    assert {document["state"] for document in [idle, queued, *others]} == {
        "idle",
        "queued",
        "active",
        "stopping",
    }
    # The frozen settings of the example are in the shape the runs are seeded with.
    config = queued["run"]["config"]
    assert set(config) == {
        "schema",
        "test_type",
        "target",
        "tokens",
        "plan",
        "mix",
        "dataset",
        "options",
        "note",
    }
    assert all(set(token) == {"name", "hint", "version"} for token in config["tokens"])


def test_the_state_tables_match_the_rules(guide):
    states = _section(guide, "2.2")
    listed = re.findall(
        r"^\| `(\w+)` \| [^|]+ \| (?:yes|no) \|", states, flags=re.MULTILINE
    )
    assert tuple(listed) == PERFORMANCE_RUN_STATUSES
    documented = set()
    for sources, reported in re.findall(
        r"^\| ((?:`\w+`(?:, )?)+) \| Progress with `(\w+)`[^|]*\| `\w+` \| runner \|",
        states,
        flags=re.MULTILINE,
    ):
        documented |= {(source, reported) for source in re.findall(r"`(\w+)`", sources)}
    rules = {
        (stored, reported)
        for stored, allowed in performance_ingest.FOLLOWS.items()
        for reported in allowed
        if reported != stored
    }
    assert documented == rules
    assert "`finished` straight from `starting` is refused" in states


def test_the_error_table_has_every_refusal_with_its_exact_words(guide):
    errors = guide.split("## 7. Errors", 1)[1].split("\n---", 1)[0]
    rows = [line for line in errors.splitlines() if line.startswith("| `")]
    for code, (status, detail) in performance_ingest.REFUSALS.items():
        assert any(
            line.startswith(f"| `{status}` |")
            and f"`{code}`" in line
            and f"`{detail}`" in line
            for line in rows
        ), code
    assert "`Performance data conflicts with existing data`" in errors
    assert "`Platform is in maintenance mode; retry later`" in errors


def test_the_settings_named_in_the_guide_exist_with_those_defaults(guide):
    named = guide.split("Settings named in this guide:", 1)[1].split("Changelog", 1)[0]
    settings = PlatformSettings()
    pairs = re.findall(r"`QYM_(PERFORMANCE_[A-Z_]+)` \((\d+)\)", named)
    assert len(pairs) == 7
    for name, value in pairs:
        assert getattr(settings, name.lower()) == int(value), name


def test_the_guide_names_no_planning_paper_as_a_file(guide):
    for name in (
        "OPEN-POINTS.md",
        "REVIEW-2026-11-22.md",
        "plan-cases.json",
        "nothing is built yet",
    ):
        assert name not in guide


# --------------------------------------------------------------------------- the example


@pytest.fixture(autouse=True)
def _auth_mode(monkeypatch):
    monkeypatch.setenv("QYM_AUTH_MODE", "proxy_headers")


@pytest.fixture()
def session_factory(database, monkeypatch):
    use_encryption_key(monkeypatch)
    at_time(monkeypatch, NOW)
    factory = sessionmaker(bind=database, autoflush=False)
    with factory() as db:
        seed_performance(db)
        # The runner key was chosen in the page; no runner has connected yet.
        runner = db.scalars(select(PerformanceRunner)).one()
        runner.instance_id = runner.registered_at = runner.registered_key_id = None
        runner.last_heartbeat_at = runner.reported_state = None
        db.commit()
    return factory


def test_guide_python_example_runs_against_the_app(
    client, session_factory, monkeypatch, capsys, guide
):
    run_id = make_run(session_factory)
    example = re.search(
        r"^```python\s*\n(.*?)^```", guide, flags=re.MULTILINE | re.DOTALL
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
                response.text,
                response.headers,
                io.BytesIO(response.content),
            )
        return Response(response.content, response.status_code)

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    namespace = {
        "BASE_URL": base_url,
        "API_KEY": RUNNER_TOKEN,
        "PROJECT_ID": "performance-project-1",
        "__name__": "__main__",
    }
    exec(compile(code, str(GUIDE), "exec"), namespace)

    assert capsys.readouterr().out.strip() == "finished"
    assert namespace["run_id"] == run_id
    run = get_run(session_factory, run_id)
    assert (run.status, run.verdict, run.exit_code) == (
        "finished",
        "invalid_no_data",
        0,
    )
    assert (run.claim_instance_id, run.progress_seq) == (namespace["INSTANCE"], 2)
    assert (run.questions_received, run.log_lines_received) == (1, 1)
    assert (run.answers_measured, run.p95_ms, run.report_received_at) == (1, 4200, NOW)
    assert len(namespace["items"]) == 6
    with session_factory() as db:
        runner = db.scalars(select(PerformanceRunner)).one()
        assert (runner.key, runner.name, runner.instance_id) == (
            "example-runner",
            "Example runner",
            namespace["INSTANCE"],
        )
        question = db.scalars(select(PerformanceQuestion)).one()
        assert (question.question_id, question.question, question.tier) == (
            "simple-1",
            "Question simple-1?",
            "simple",
        )
        assert db.scalars(select(PerformanceLogLine.message)).all() == [
            "runner: example run"
        ]
        assert db.get(PerformanceReport, run_id).html_size == 59


def test_the_guide_states_the_limits_of_the_review_fixes(guide):
    from qym_platform.services import performance_redaction

    section_3 = guide.split("\n## 3. ", 1)[1].split("\n## 4. ", 1)[0]
    assert f"at most **{routes.JSON_DEPTH_MAX}** levels" in section_3
    assert '"type":"json_too_deep"' in section_3
    assert routes._TOO_DEEP["msg"].replace(" ", "") in section_3.replace(
        "\n", ""
    ).replace(" ", "")
    assert "removes every NUL character" in section_3
    assert "between the years 1 and 9999 in UTC" in section_3
    section_6 = guide.split("\n## 6. ", 1)[1].split("\n## 7. ", 1)[0]
    assert f"shorter than **{performance_redaction.HINT_MIN_CHARS}** characters" in (
        section_6
    )
    rule_4 = guide.split("4. **120 seconds of silence, qym's side.**", 1)[1]
    rule_4 = rule_4.split("5. **", 1)[0]
    for state in performance_ingest.WORKING_STATES:
        assert f"`{state}`" in rule_4
    assert '`state: "idle"`' in rule_4
    assert set(performance_ingest.LIMIT_EVENTS.values()) <= set(
        re.findall(r"`([a-z_]+_limit_reached)`", guide)
    )
