"""Tiny OpenAI-compatible stub for analyzer e2e/dev walks (no real LLM key needed).

    python frontend/scripts/stub_llm.py --port 9806 [--delay 0.4]

POST /v1/chat/completions answers with a JSON object that satisfies both the
root-cause analyzer (root_cause_issues) and the rule writer (rules). The model
name "slow-model" sleeps 5 s so cancel flows can be driven; "bad-model"
returns 500. Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ANALYSIS = {
    "root_cause_issues": [
        {
            "category": "Retrieval",
            "subcategory": "Missing context",
            "finding": "The answer does not use the supplied context.",
            "confidence": 0.82,
        }
    ],
    "root_cause_detail": "The model answered without grounding in the expected value.",
    "confidence": 0.82,
    "solution": "Add the missing grounding step.",
    "category_taxonomy": {
        "Retrieval": {"description": "Context was not found or used.", "when_to_use": "The answer lacks grounding."}
    },
    "rules": [
        {
            "title": "Ground every answer",
            "instruction": "Check that the output cites the supplied context before blaming the metric.",
            "inferred_from": "stub",
            "explanation": "Stub rule for tests.",
        }
    ],
}


class Handler(BaseHTTPRequestHandler):
    delay = 0.3

    def log_message(self, *args):  # quiet
        return

    def do_GET(self):
        body = json.dumps({"object": "list", "data": [{"id": "stub-model", "object": "model"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            req = json.loads(raw)
        except ValueError:
            req = {}
        model = str(req.get("model") or "")
        if model == "bad-model":
            self.send_response(500)
            self.end_headers()
            self.wfile.write(b'{"error":{"message":"stub failure"}}')
            return
        time.sleep(5.0 if model == "slow-model" else self.delay)
        payload = ANALYSIS
        # The aggregation pass uses structured parsing (json_schema): no merges.
        if (req.get("response_format") or {}).get("type") == "json_schema":
            payload = {"category_clusters": [], "detail_clusters": []}
        body = json.dumps(
            {
                "id": "stub-1",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": model,
                "choices": [
                    {"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": json.dumps(payload)}}
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
            }
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9806)
    parser.add_argument("--delay", type=float, default=0.3)
    args = parser.parse_args()
    Handler.delay = args.delay
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
