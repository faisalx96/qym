"""Manual score edits are validated by metric type and never store text (C009)."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi import HTTPException
from qym_platform.api import runs as runs_api
from qym_platform.auth import Principal
from qym_platform.db.models import (
    RunItemPassScore,
    RunItemScore,
    RunMetricSpec,
    RunWorkflowStatus,
    User,
)
from qym_platform.services.score_edits import (
    HINTS,
    ScoreEditError,
    parse_score_edit,
)
from sqlalchemy.orm import Session
from test_dashboard_durable_summaries import item, run

REPO = Path(__file__).resolve().parents[2]

# (input, score_type, expected value or the ScoreEditError message)
CASES = [
    ("0.6", None, 0.6),
    (" 0.25 ", "percentage", 0.25),
    ("80%", "percentage", 0.8),
    ("80%", None, 0.8),
    (".5", "number", 0.5),
    ("1e2", "number", 100.0),
    (-3, "number", -3.0),
    (1, "boolean", 1.0),
    ("true", "boolean", 1.0),
    ("No", "boolean", 0.0),
    (False, None, 0.0),
    ("7", "count", 7.0),
    ("abc", None, HINTS["legacy"]),
    ("", None, "Enter a score. " + HINTS["legacy"]),
    (None, None, HINTS["legacy"]),
    ("0,7", None, "Use a dot for decimals (0.7, not 0,7)."),
    ("1_000", "number", HINTS["number"]),
    ("nan", "number", HINTS["number"]),
    ("inf", None, HINTS["legacy"]),
    (float("inf"), "number", HINTS["number"]),
    ("1.5", "percentage", HINTS["percentage"]),
    ("150%", "percentage", HINTS["percentage"]),
    ("0.5", "boolean", HINTS["boolean"]),
    ("maybe", "boolean", HINTS["boolean"]),
    ("true", "percentage", HINTS["percentage"]),
    (True, "count", HINTS["count"]),
    ("2.5", "count", HINTS["count"]),
    ("-1", "count", HINTS["count"]),
    ("50%", "count", HINTS["count"]),
]


@pytest.mark.parametrize("raw, score_type, expected", CASES)
def test_parse_score_edit(raw, score_type, expected):
    if isinstance(expected, str):
        with pytest.raises(ScoreEditError) as exc:
            parse_score_edit(raw, score_type)
        assert str(exc.value) == expected
    else:
        assert parse_score_edit(raw, score_type) == pytest.approx(expected)


def test_run_page_validator_matches_the_server():
    """metrics.js parseMetricScoreInput applies the same rules before posting."""
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required to check metrics.js")
    script = """
const fs = require('fs'), vm = require('vm');
const ctx = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), ctx);
const m = ctx.window.QymMetrics;
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(cases.map(([raw, type]) =>
  m.parseMetricScoreInput(raw, type ? { score_type: type } : null))));
"""
    js_cases = [
        (raw, score_type)
        for raw, score_type, _ in CASES
        if not isinstance(raw, float) and raw is not None
    ]
    result = subprocess.run(
        [
            node,
            "-e",
            script,
            str(REPO / "packages/platform/qym_platform/_static/dashboard/metrics.js"),
        ],
        input=json.dumps(js_cases),
        text=True,
        capture_output=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    outcomes = json.loads(result.stdout)
    expected = {
        (json.dumps(raw), score_type): value
        for raw, score_type, value in CASES
    }
    for (raw, score_type), outcome in zip(js_cases, outcomes):
        want = expected[(json.dumps(raw), score_type)]
        if isinstance(want, str):
            assert outcome == {"ok": False, "message": want}, (raw, score_type)
        else:
            assert outcome["ok"] is True, (raw, score_type, outcome)
            assert outcome["value"] == pytest.approx(want), (raw, score_type)


def _principal(db):
    return Principal(user=db.get(User, "u"), auth_type="none")


def _edit(db, metric, value, **extra):
    return runs_api.update_metric(
        {
            "file_path": "r",
            "row_index": 0,
            "metric_name": metric,
            "new_score": value,
            **extra,
        },
        db=db,
        principal=_principal(db),
    )


def _seed(db, samples=1):
    run(
        db,
        metrics=["closeness", "exact"],
        samples=samples,
        status=RunWorkflowStatus.COMPLETED,
    )
    item(db, item_id="i", index=0)
    db.add(
        RunMetricSpec(
            run_id="r", metric_name="exact", position=1, score_type="boolean"
        )
    )
    for metric, score in (("closeness", 0.6), ("exact", 1.0)):
        db.add(
            RunItemScore(
                run_id="r",
                item_id="i",
                metric_name=metric,
                score_numeric=score,
                score_raw=score,
                meta={},
            )
        )
        if samples > 1:
            db.add(
                RunItemPassScore(
                    run_id="r",
                    item_id="i",
                    metric_name=metric,
                    pass_number=1,
                    score_numeric=score,
                    meta={},
                )
            )
    db.commit()


def _score(db, metric):
    db.expire_all()
    return (
        db.query(RunItemScore)
        .filter(RunItemScore.run_id == "r", RunItemScore.metric_name == metric)
        .one_or_none()
    )


@pytest.mark.parametrize(
    "metric, value, message",
    [
        ("closeness", "abc", HINTS["legacy"]),
        ("closeness", "0,7", "Use a dot for decimals (0.7, not 0,7)."),
        ("closeness", "", "Enter a score. " + HINTS["legacy"]),
        ("exact", "0.5", HINTS["boolean"]),
        ("exact", "80%", HINTS["boolean"]),
    ],
)
def test_invalid_edit_is_rejected_without_writing(database, metric, value, message):
    with Session(database) as db:
        _seed(db)
        with pytest.raises(HTTPException) as exc:
            _edit(db, metric, value)
        assert exc.value.status_code == 422
        assert exc.value.detail == message
        db.rollback()
        score = _score(db, metric)
        assert score.score_numeric == (0.6 if metric == "closeness" else 1.0)
        assert score.meta == {}


def test_valid_edits_store_numbers_only(database):
    with Session(database) as db:
        _seed(db)
        row = _edit(db, "closeness", "80%")["row"]
        assert row["metric_values"][0] == pytest.approx(0.8)
        score = _score(db, "closeness")
        assert score.score_numeric == pytest.approx(0.8)
        assert score.score_raw == pytest.approx(0.8)
        assert score.meta["original_score"] == pytest.approx(0.6)
        _edit(db, "exact", "false")
        assert _score(db, "exact").score_numeric == 0.0


def test_unknown_metric_is_rejected_and_creates_no_row(database):
    with Session(database) as db:
        _seed(db)
        with pytest.raises(HTTPException) as exc:
            _edit(db, "made_up", "1")
        assert exc.value.status_code == 422
        assert "made_up" in exc.value.detail
        db.rollback()
        assert _score(db, "made_up") is None


def test_repeat_run_item_value_is_a_rate(database):
    """A repeat run's item value is the mean over passes: 0.5 is a valid boolean rate."""
    with Session(database) as db:
        _seed(db, samples=2)
        _edit(db, "exact", "0.5")
        assert _score(db, "exact").score_numeric == pytest.approx(0.5)
        with pytest.raises(HTTPException) as exc:
            _edit(db, "exact", "1.5")
        assert exc.value.detail == HINTS["percentage"]
    run_metrics_js = shutil.which("node")
    if not run_metrics_js:
        return
    script = """
const fs = require('fs'), vm = require('vm');
const ctx = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), ctx);
const m = ctx.window.QymMetrics;
const spec = { score_type: 'boolean' };
process.stdout.write(JSON.stringify([
  m.parseMetricScoreInput('0.5', spec, { reduced: true }),
  m.parseMetricScoreInput('0.5', spec),
  m.parseMetricScoreInput('2.5', { score_type: 'count' }, { reduced: true }),
]));
"""
    result = subprocess.run(
        [
            run_metrics_js,
            "-e",
            script,
            str(REPO / "packages/platform/qym_platform/_static/dashboard/metrics.js"),
        ],
        text=True,
        capture_output=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    reduced, single, count = json.loads(result.stdout)
    assert reduced == {"ok": True, "value": 0.5}
    assert single == {"ok": False, "message": HINTS["boolean"]}
    assert count == {"ok": True, "value": 2.5}


def test_pass_edit_uses_the_same_rules(database):
    with Session(database) as db:
        _seed(db, samples=2)
        run_row = db.get(runs_api.Run, "r")
        run_row.run_metadata = {**(run_row.run_metadata or {}), "has_repeat_pass_context": True}
        db.commit()
        with pytest.raises(HTTPException) as exc:
            _edit(db, "exact", "yes please", pass_number=1, expected_pass_version=0)
        assert exc.value.status_code == 422
        assert exc.value.detail == HINTS["boolean"]
