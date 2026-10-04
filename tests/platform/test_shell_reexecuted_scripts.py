"""shell.js re-runs page scripts on every in-app navigation.

A classic script that declares a top-level ``const``/``let``/``class`` throws
"Identifier ... has already been declared" the second time, which skips the
whole script and leaves the first load's globals in place (C009 regression).
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

DASHBOARD = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "platform"
    / "qym_platform"
    / "_static"
    / "dashboard"
)


def _shared_scripts():
    return sorted(
        path for path in DASHBOARD.glob("*.js") if not path.name.endswith(".min.js")
    )


def test_shared_scripts_declare_no_top_level_const_let_or_class():
    offenders = []
    for path in _shared_scripts():
        for number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            if re.match(r"(const|let|class)\s", line):
                offenders.append(f"{path.name}:{number}: {line.strip()[:60]}")
    assert offenders == []


@pytest.mark.parametrize("name", ["metrics.js", "qym_safe.js"])
def test_library_scripts_can_run_twice_in_one_page(name):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required")
    script = """
const fs = require('fs'), vm = require('vm');
const ctx = vm.createContext({ window: {}, console });
const source = fs.readFileSync(process.argv[1], 'utf8');
vm.runInContext(source, ctx);
const first = Object.keys(ctx.window).sort().join(',');
ctx.window.__marker = 1;
vm.runInContext(source, ctx);
process.stdout.write(first);
"""
    result = subprocess.run(
        [node, "-e", script, str(DASHBOARD / name)],
        text=True,
        capture_output=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout
