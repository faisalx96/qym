"""The change request document (docs/evaluation-service-change-request-v1.4.md) says what the platform does.

The JSON examples of the document are parsed out of the markdown and run through the platform's own code, so the
document and the platform cannot drift apart unnoticed (review of WP-D, checklist of spec-d section 3 and 4).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from qym_platform.api.eval_environments import _trim_tasks
from qym_platform.services.eval_evaluator_schema import evaluator_capabilities

from test_experiment_datasets import (  # noqa: F401  (fixtures)
    V14,
    _create,
    _jobs,
    client,
    conn,
    encryption,
    env,
    multi_spec,
    session_factory,
    tasks,
    two_envs,
)

DOC = Path(__file__).resolve().parents[2] / "docs" / "evaluation-service-change-request-v1.4.md"
V13 = V14.with_name("eval_evaluator_schema.json")


def _blocks(lang: str):
    return re.findall(r"```" + lang + r"\n(.*?)```", DOC.read_text(), flags=re.S)


def _jsonc(text: str):
    return json.loads(re.sub(r"(^|\s)//[^\n]*", "", text, flags=re.M))


def _example(marker: str, lang: str = "json"):
    for block in _blocks(lang):
        if marker in block:
            return _jsonc(block) if lang == "jsonc" else json.loads(block)
    raise AssertionError(f"no {lang} block with {marker!r}")


def test_schema_additions_of_section_8_declare_both_capabilities():
    additions = _example('"DatasetRef"')
    schema = json.loads(V13.read_text())
    assert evaluator_capabilities(schema) == {"datasets": False, "task": False}
    schema.setdefault("$defs", {}).update(additions["$defs"])
    schema["properties"].update(additions["properties"])
    assert evaluator_capabilities(schema) == {"datasets": True, "task": True}
    assert additions["required"] == schema["required"] == ["dataset"]
    # the platform's own fixture declares the same keys
    assert evaluator_capabilities(json.loads(V14.read_text())) == {"datasets": True, "task": True}
    assert set(additions["properties"]) == {"datasets", "task"}


def test_the_tasks_response_of_section_4_2_passes_the_platform_trimming_unchanged():
    body = _example('"answer-ticket"', "json")
    assert _trim_tasks(body["tasks"]) == body["tasks"]
    assert sum(1 for t in body["tasks"] if t["default"]) == 1


def test_the_request_example_of_section_3_1_is_accepted_and_sent_as_documented(client, session_factory, two_envs):
    example = _example('"datasets"', "jsonc")
    entries = [{k: v for k, v in e.items() if v is not None} for e in example["datasets"]]
    production, _staging = two_envs
    res = _create(client, [production.id], spec=multi_spec(entries, task=example["task"]))
    assert res.status_code == 200, res.text
    (job,) = _jobs(session_factory, res.json()["id"])
    sent = job.request_body["evaluator"]
    # "dataset" and "dataset_version" stay the first entry's, `datasets` is the list, `task` is the id
    assert sent["dataset"] == example["dataset"] == "support-tickets"
    assert sent["dataset_version"] == example["dataset_version"] == "v3"
    assert sent["datasets"] == entries
    assert sent["task"] == example["task"]
    assert "run_shape" not in json.dumps(job.request_body)
    # only the keys of DatasetRef are ever sent
    assert all(set(e) <= {"dataset", "version", "alias"} for e in sent["datasets"])
