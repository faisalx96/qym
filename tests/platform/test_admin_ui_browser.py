"""Run the actual admin UI with delayed, rejected and successful requests."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.browser


def _unavailable(reason: str) -> None:
    # CI installs Node Playwright; a missing toolchain there is a broken
    # pipeline, not a reason to silently drop the contract.
    if os.environ.get("CI"):
        pytest.fail(reason)
    pytest.skip(reason)


@pytest.mark.parametrize(
    "fixture",
    [
        "admin_force_stop_contract.cjs",
        "admin_password_reset_contract.cjs",
    ],
)
def test_admin_ui_contract(fixture: str) -> None:
    node = shutil.which("node")
    if not node:
        _unavailable("Node.js is required for the browser contract")
    available = subprocess.run(
        [node, "-e", "require.resolve('playwright')"], capture_output=True
    )
    if available.returncode:
        _unavailable("Node Playwright is required for the browser contract")
    root = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        [node, str(root / "tests/platform/fixtures" / fixture), str(root)],
        capture_output=True,
        text=True,
        timeout=45,
    )
    assert result.returncode == 0, result.stdout + result.stderr
