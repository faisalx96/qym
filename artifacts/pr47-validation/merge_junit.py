"""Verify complete collected-test coverage across explicitly ordered test phases."""

import argparse
import copy
import json
from pathlib import Path
import xml.etree.ElementTree as ET


def junit_key(nodeid):
    """Preserve delimiters inside parameter IDs, such as run-1::pass1."""
    path, _, qualified = nodeid.partition("::")
    unparameterized, opening, parameter = qualified.partition("[")
    parts = unparameterized.split("::")
    module = path.removesuffix(".py").replace("/", ".")
    return (".".join([module, *parts[:-1]]), parts[-1] + opening + parameter)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--collection", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--junit-output", type=Path)
    parser.add_argument("phases", nargs="+", type=Path)
    args = parser.parse_args()
    expected = {}
    for line in args.collection.read_text().splitlines():
        if not line.startswith("tests/") or "::" not in line:
            continue
        expected[junit_key(line)] = line
    if not expected:
        parser.error(f"No collected test node IDs found in {args.collection}")

    latest = {}
    latest_cases = {}
    phases = []
    for path in args.phases:
        cases = ET.parse(path).findall(".//testcase")
        counts = {"passed": 0, "skipped": 0, "failed": 0, "errors": 0}
        for case in cases:
            status, message = "passed", ""
            for tag, state in (("skipped", "skipped"), ("failure", "failed"), ("error", "errors")):
                detail = case.find(tag)
                if detail is not None:
                    status, message = state, detail.get("message", "")
            counts[status] += 1
            latest[(case.get("classname"), case.get("name"))] = {
                "status": status, "message": message, "phase": path.name,
            }
            latest_cases[(case.get("classname"), case.get("name"))] = copy.deepcopy(case)
        phases.append({"file": path.name, **counts})

    missing = [node for key, node in expected.items() if key not in latest]
    unexpected = [
        {"classname": key[0], "name": key[1], **result}
        for key, result in latest.items()
        if key not in expected
    ]
    counts = {"passed": 0, "skipped": 0, "failed": 0, "errors": 0}
    skipped, failures = [], []
    for key, node in expected.items():
        result = latest.get(key)
        if result is None:
            continue
        counts[result["status"]] += 1
        if result["status"] == "skipped":
            skipped.append({"node": node, **result})
        if result["status"] in {"failed", "errors"}:
            failures.append({"node": node, **result})
    report = {
        "collection": args.collection.name,
        "collected": len(expected),
        **counts,
        "missing": missing,
        "unexpected": unexpected,
        "failures": failures,
        "skipped_cases": skipped,
        "phases": phases,
        "policy": "For a repeated node, the last explicitly supplied phase is its final result. Earlier failures remain visible in phase counts.",
        "combined_junit": None,
    }
    # A partial selection must never become a green final JUnit artifact.
    # Keep failures when coverage is complete; withhold XML when it has gaps.
    if args.junit_output and not missing and not unexpected:
        suite = ET.Element("testsuite", {
            "name": "qym-final-composite",
            "tests": str(len(expected)),
            "failures": str(counts["failed"]),
            "errors": str(counts["errors"]),
            "skipped": str(counts["skipped"]),
            "time": str(sum(float(latest_cases[key].get("time", "0")) for key in expected)),
        })
        properties = ET.SubElement(suite, "properties")
        ET.SubElement(properties, "property", {"name": "composition", "value": report["policy"]})
        ET.SubElement(properties, "property", {"name": "collection", "value": str(args.collection)})
        ET.SubElement(properties, "property", {"name": "phases", "value": ", ".join(str(path) for path in args.phases)})
        for key in expected:
            suite.append(latest_cases[key])
        root = ET.Element("testsuites")
        root.append(suite)
        ET.ElementTree(root).write(args.junit_output, encoding="utf-8", xml_declaration=True)
        report["combined_junit"] = str(args.junit_output)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: report[k] for k in ("collected", *counts, "missing", "unexpected", "failures", "combined_junit")}))
    return bool(missing or unexpected or failures)


if __name__ == "__main__":
    raise SystemExit(main())
