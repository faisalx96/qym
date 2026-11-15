"""The SDK ships on its own: no SDK source file may import qym_platform."""

import re
from pathlib import Path

SDK_SRC = Path(__file__).resolve().parents[2] / "packages" / "sdk" / "qym"


def test_sdk_does_not_import_qym_platform():
    pattern = re.compile(r"^\s*(from|import)\s+qym_platform")
    violations = [
        f"{path}:{number}: {line.strip()}"
        for path in SDK_SRC.rglob("*.py")
        for number, line in enumerate(path.read_text(errors="replace").splitlines(), 1)
        if pattern.match(line)
    ]
    assert violations == [], "SDK imports qym_platform:\n" + "\n".join(violations)
