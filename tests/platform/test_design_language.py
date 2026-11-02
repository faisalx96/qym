"""Enforce docs/DESIGN_LANGUAGE.md over the UI.

The rules live in one place: ``frontend/src/__tests__/design-language.test.ts``
(Vitest; ESLint and Stylelint add the TSX/CSS rules, see ``npm run check``).
This module runs that test from pytest so ``pytest tests/platform`` and the
AGENTS.md checklist keep covering the design language. It skips when Node or
``frontend/node_modules`` is unavailable (``npm ci`` in ``frontend/`` fixes it).
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


def test_frontend_design_language_lint_passes():
    npx = shutil.which("npx")
    if npx is None or not (FRONTEND / "node_modules").is_dir():
        pytest.skip("Node or frontend/node_modules not available (run `npm ci` in frontend/)")
    result = subprocess.run(
        [npx, "vitest", "run", "src/__tests__/design-language.test.ts"],
        cwd=FRONTEND,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert result.returncode == 0, result.stdout[-4000:] + result.stderr[-2000:]
