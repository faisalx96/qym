"""Write tests/.test_durations.json from the CI JUnit files (python job artifacts).

Usage: python scripts/test_durations.py junit-1.xml junit-2.xml ...
Download the files with: gh run download <run id> --pattern 'junit-python-*'
tests/conftest.py reads the result to give each CI slice about the same time.
"""

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "tests" / ".test_durations.json"


def main(paths: list[str]) -> None:
    times: dict[str, float] = {}
    for path in paths:
        for case in ET.parse(path).getroot().iter("testcase"):
            if case.find("skipped") is not None:
                continue
            key = f"{case.get('classname')}::{case.get('name')}"
            times[key] = round(float(case.get("time") or 0), 3)
    OUT.write_text(json.dumps(dict(sorted(times.items())), indent=0) + "\n")
    print(f"wrote {OUT} ({len(times)} tests, {sum(times.values()):.0f} s)")


if __name__ == "__main__":
    main(sys.argv[1:])
