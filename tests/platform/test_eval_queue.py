"""Queue cancel service and experiment aggregate status (plan §4.5, §13.1, issue #19)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PLATFORM_SRC = ROOT / "packages" / "platform"
if str(PLATFORM_SRC) not in sys.path:
    sys.path.insert(0, str(PLATFORM_SRC))

from qym_platform.db.models import EvalExperimentStatus, EvalJobStatus
from qym_platform.services import eval_dispatcher
from qym_platform.services.eval_experiments import aggregate_status

# --------------------------------------------------------------------------- aggregate

Q, BL = "QUEUED", "BLOCKED"
SG, SD, RU, CG = "SUBMITTING", "SUBMITTED", "RUNNING", "CANCELLING"
OK, FA, CA, TO = "SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"


@pytest.mark.parametrize(
    "statuses, expected",
    [
        # Nothing has moved yet.
        ([], "QUEUED"),
        ([Q], "QUEUED"),
        ([Q, Q, Q], "QUEUED"),
        # Anything in flight.
        ([SG], "RUNNING"),
        ([SD, Q], "RUNNING"),
        ([RU, OK], "RUNNING"),
        ([CG], "RUNNING"),
        ([CG, CA], "RUNNING"),
        ([SG, BL], "RUNNING"),
        # Queued jobs next to jobs that have moved on.
        ([Q, OK], "RUNNING"),
        ([Q, CA], "RUNNING"),
        ([Q, BL], "RUNNING"),
        ([Q, FA], "RUNNING"),
        # Settled: terminal or BLOCKED.
        ([OK], "COMPLETED"),
        ([OK, OK], "COMPLETED"),
        ([OK, FA], "PARTIAL"),
        ([OK, CA], "PARTIAL"),
        ([OK, TO], "PARTIAL"),
        ([OK, BL], "PARTIAL"),
        ([CA], "CANCELLED"),
        ([CA, CA], "CANCELLED"),
        ([CA, FA], "FAILED"),
        ([CA, BL], "FAILED"),
        ([FA], "FAILED"),
        ([TO], "FAILED"),
        ([BL], "FAILED"),
        ([BL, BL], "FAILED"),
    ],
)
def test_aggregate_status_table(statuses, expected):
    jobs = [EvalJobStatus(s) for s in statuses]
    assert aggregate_status(jobs) == EvalExperimentStatus(expected)
    assert aggregate_status(reversed(jobs)) == EvalExperimentStatus(expected)


def test_dispatcher_uses_the_shared_aggregate_status():
    assert eval_dispatcher.aggregate_status is aggregate_status
    assert not hasattr(eval_dispatcher, "_counted_jobs")
