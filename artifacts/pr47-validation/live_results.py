"""Durable pytest reports; opt in with QYM_TEST_RESULTS_PATH and -p live_results.

Add this directory to PYTHONPATH when loading the plugin. Reports are appended
and fsynced after every stage, so SIGTERM or a backend stall preserves completed
tests. read_results() and write_junit() combine completed cases from multiple
JSONL files, with the latest completed result for each node ID taking precedence.
"""

import json
import os
import platform
import time
import uuid
from pathlib import Path
from xml.etree import ElementTree as ET


_stream = None
_session_id = None
_reports = {}


def _write(event):
    if _stream is None:
        return
    event = dict(event, session_id=_session_id, timestamp=time.time())
    _stream.write(json.dumps(event, ensure_ascii=False) + "\n")
    _stream.flush()
    os.fsync(_stream.fileno())


def pytest_configure(config):
    global _stream, _session_id
    destination = os.environ.get("QYM_TEST_RESULTS_PATH")
    if not destination:
        return
    path = Path(destination).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    _stream = path.open("a", encoding="utf-8")
    _session_id = str(uuid.uuid4())
    _reports.clear()
    _write({
        "event": "session_start",
        "python": platform.python_version(),
        "arguments": list(config.invocation_params.args),
        "directory": str(config.invocation_params.dir),
    })


def pytest_runtest_logstart(nodeid, location):
    _reports[nodeid] = {}
    _write({"event": "test_start", "nodeid": nodeid})


def pytest_runtest_logreport(report):
    if _stream is None:
        return
    payload = {
        "event": "test_report",
        "nodeid": report.nodeid,
        "when": report.when,
        "outcome": report.outcome,
        "duration": report.duration,
    }
    if report.longrepr:
        payload["longrepr"] = str(report.longrepr)
    if hasattr(report, "wasxfail"):
        payload["wasxfail"] = report.wasxfail
    _write(payload)
    stages = _reports.setdefault(report.nodeid, {})
    stages[report.when] = payload
    if report.when != "teardown":
        return
    if any(stages.get(stage, {}).get("outcome") == "failed" for stage in ("setup", "teardown")):
        outcome = "error"
    elif stages.get("call", {}).get("outcome") == "failed":
        outcome = "failure"
    elif any(stage["outcome"] == "skipped" for stage in stages.values()):
        outcome = "skipped"
    elif "setup" not in stages or "call" not in stages:
        outcome = "incomplete"
    else:
        outcome = "passed"
    _write({
        "event": "test_complete",
        "nodeid": report.nodeid,
        "outcome": outcome,
        "duration": sum(stage["duration"] for stage in stages.values()),
        "reports": list(stages.values()),
    })
    _reports.pop(report.nodeid, None)


def pytest_collectreport(report):
    if report.failed:
        _write({"event": "collection_error", "nodeid": report.nodeid, "longrepr": str(report.longrepr)})


def pytest_sessionfinish(session, exitstatus):
    _write({"event": "session_finish", "exitstatus": int(exitstatus), "testscollected": session.testscollected})


def pytest_unconfigure(config):
    global _stream
    if _stream is not None:
        _stream.close()
        _stream = None


def read_results(paths):
    """Read ordered JSONL paths, keeping only cases whose teardown completed."""
    completed = {}
    active = {}
    collection_errors = []
    truncated_lines = []
    for value in paths:
        path = Path(value)
        lines = path.read_text(encoding="utf-8").splitlines()
        for number, line in enumerate(lines, 1):
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                if number != len(lines):
                    raise
                truncated_lines.append({"path": str(path), "line": number})
                continue
            kind = event.get("event")
            key = (event.get("session_id"), event.get("nodeid"))
            if kind == "test_start":
                active[key] = event
            elif kind == "test_complete":
                if event["outcome"] != "incomplete":
                    completed[event["nodeid"]] = event
                    active.pop(key, None)
            elif kind == "collection_error":
                collection_errors.append(event)
    return {
        "completed": completed,
        "unfinished": list(active.values()),
        "collection_errors": collection_errors,
        "truncated_lines": truncated_lines,
    }


def write_junit(paths, destination):
    """Write composite JUnit from completed JSONL cases and return full evidence."""
    evidence = read_results(paths)
    completed = evidence["completed"]
    suite = ET.Element("testsuite", {
        "name": "durable-composite",
        "tests": str(len(completed)),
        "errors": str(sum(case["outcome"] == "error" for case in completed.values())),
        "failures": str(sum(case["outcome"] == "failure" for case in completed.values())),
        "skipped": str(sum(case["outcome"] == "skipped" for case in completed.values())),
        "time": str(sum(case["duration"] for case in completed.values())),
    })
    for nodeid, case in completed.items():
        path, _, qualified = nodeid.partition("::")
        unparameterized, opening, parameter = qualified.partition("[")
        parts = unparameterized.split("::")
        classname = ".".join([path[:-3].replace("/", ".")] + parts[:-1])
        name = parts[-1] + opening + parameter
        element = ET.SubElement(suite, "testcase", {"classname": classname, "name": name, "time": str(case["duration"])})
        if case["outcome"] != "passed":
            reasons = "\n".join(report["longrepr"] for report in case["reports"] if report.get("longrepr"))
            child = ET.SubElement(element, case["outcome"], {"message": reasons.splitlines()[0] if reasons else case["outcome"]})
            child.text = reasons
    root = ET.Element("testsuites")
    root.append(suite)
    ET.ElementTree(root).write(destination, encoding="utf-8", xml_declaration=True)
    return evidence
