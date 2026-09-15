"""Run the actual admin UI with delayed, rejected and successful requests."""

import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.browser
def test_admin_force_stop_browser():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required for the browser contract")
    available = subprocess.run(
        [node, "-e", "require.resolve('playwright')"], capture_output=True
    )
    if available.returncode:
        pytest.skip("Node Playwright is required for the browser contract")
    root = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        [
            node,
            str(root / "tests/platform/fixtures/admin_force_stop_contract.cjs"),
            str(root),
        ],
        capture_output=True,
        text=True,
        timeout=45,
    )
    assert result.returncode == 0, result.stdout + result.stderr
