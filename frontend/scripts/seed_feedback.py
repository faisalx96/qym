"""Seed the Feedback list through the public API (stub model, QYM_AUTH_MODE=none or an admin session).

    python frontend/scripts/seed_feedback.py http://127.0.0.1:9008 [--drafts 2]

Creates eight requests like the design mocks (one confirmed duplicate pair, statuses, priorities, two
projects' worth of subjects) and optional drafts. Idempotent by title: a title that exists is skipped. The
platform must have a feedback connection to the scripted stub (``model='feedback:ask_then_propose'``).
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

REQUESTS = [
    # title, priority, complexity, status, subject, note
    ("Show cost per run in the runs list", "medium", "M", "new", "platform"),
    ("Flag runs that regress on refund-cases", "high", "M", "accepted", "product"),
    ("PDF export of the compare page", "medium", "M", "new", "platform"),
    ("Notes on each dataset version", "low", "S", "planned", "product"),
    ("Export run comparison to PDF", "high", "M", "accepted", "platform"),
    (
        "Restricted datasets must not be exportable",
        "critical",
        "L",
        "planned",
        "platform",
    ),
    ("Right-to-left output in the playground", "medium", "S", "done", "product"),
    ("Light theme", "low", "XL", "declined", "platform"),
]


class Api:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")

    def call(self, method: str, path: str, body=None, accept="application/json"):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            self.base + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json", "Accept": accept},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read().decode()
                return r.status, (
                    json.loads(raw)
                    if raw and "json" in r.headers.get("Content-Type", "")
                    else raw
                )
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, raw


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("--drafts", type=int, default=0)
    args = ap.parse_args()
    api = Api(args.base)
    _, listing = api.call("GET", "/v1/feedback?page_size=100")
    have = {i["title"] for i in listing["items"]} | {
        c["title"] for kids in listing["children"].values() for c in kids
    }
    _, me = api.call("GET", "/v1/me")
    projects = [p for p in me.get("projects", []) if p.get("is_active", True)]
    if not projects:
        code, made = api.call("POST", "/v1/projects", {"name": "Support agent"})
        if code in (200, 201):
            projects = [made]
    project = projects[0]["slug"] if projects else None
    refs: dict[str, str] = {}
    for title, priority, complexity, status, subject in REQUESTS:
        if title in have:
            continue
        body = {
            "subject": subject,
            "message": f"Seed: {title}. We need this for a weekly review.",
        }
        if subject == "product":
            if not project:
                continue
            body["project_id"] = project
        code, created = api.call("POST", "/v1/feedback", body)
        if code != 201:
            print("create failed", code, created, file=sys.stderr)
            return 1
        rid = created["id"]
        api.call("POST", f"/v1/feedback/{rid}/turn", accept="application/json")
        code, reply = api.call(
            "POST",
            f"/v1/feedback/{rid}/messages",
            {"content": "Five analysts, every week. A PDF is enough. No deadline."},
            accept="application/json",
        )
        proposal = (reply or {}).get("proposal") if isinstance(reply, dict) else None
        if not proposal:
            print("no proposal", code, reply, file=sys.stderr)
            return 1
        seq = proposal["proposal"]["seq"]
        code, done = api.call(
            "POST",
            f"/v1/feedback/{rid}/confirm",
            {
                "title": title,
                "description": proposal["proposal"]["description"],
                "priority": priority,
                "complexity": complexity,
                "proposal_seq": seq,
            },
        )
        if code != 200:
            print("confirm failed", code, done, file=sys.stderr)
            return 1
        refs[title] = done["request"]["ref"]
        if status != "new":
            patch = {
                "status": status,
                "expected_updated_at": done["request"]["updated_at"],
            }
            if status == "declined":
                patch["decline_reason"] = (
                    "We are moving PDF export to the accepted request and will not build a second one."
                )
            code, out = api.call("PATCH", f"/v1/feedback/{refs[title]}/triage", patch)
            if code != 200:
                print("triage failed", code, out, file=sys.stderr)
                return 1
    dup, canon = refs.get("PDF export of the compare page"), refs.get(
        "Export run comparison to PDF"
    )
    if dup and canon:
        _, d = api.call("GET", f"/v1/feedback/{dup}")
        code, out = api.call(
            "PATCH",
            f"/v1/feedback/{dup}/triage",
            {
                "duplicate_of": canon,
                "note": "Same ask. Keep the accepted request as the one to plan.",
                "expected_updated_at": d["request"]["updated_at"],
            },
        )
        if code != 200:
            print("duplicate failed", code, out, file=sys.stderr)
            return 1
    for i in range(args.drafts):
        titles = ["Bulk re-run failed items", "Slack alert for failed nightly runs"]
        code, created = api.call(
            "POST",
            "/v1/feedback",
            {"subject": "platform", "message": f"Draft: {titles[i % 2]}"},
        )
        if code == 201:
            api.call("POST", f"/v1/feedback/{created['id']}/turn")
    print(f"seeded {len(refs)} requests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
