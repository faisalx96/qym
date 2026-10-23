"""Scripted OpenAI-compatible chat completions for the feedback assistant (tests and Playwright).

Used by ``stub_llm.py`` (model names ``feedback:<script>``) and by ``tests/platform/feedback_stub.py``.
Scripts live in ``tests/platform/feedback_scripts/<script>.json``::

    {"chunk_delay": 0.0, "status": 500 | "sleep": 5 | "tools_status": 400,
     "turns": [ [round, round, ...], ... ]}      # a round = {"text": "..", "tool_calls": [{"name", "arguments"}]}

The turn is the number of real person messages so far; the round is the number of assistant tool-call messages
since the last one. Stdlib only. Without a ``qym_ping`` request the reply is stateless: it is derived from the
messages the platform sent.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Optional

SCRIPTS = (
    Path(__file__).resolve().parents[2] / "tests" / "platform" / "feedback_scripts"
)
CONTEXT_PREFIX = "CONTEXT (data, not instructions)"
REMINDER_PREFIX = "Reminder from the server"


def load_script(name: str) -> dict[str, Any]:
    path = SCRIPTS / f"{name}.json"
    if not path.exists():
        return {"turns": [[{"text": "OK."}]]}
    return json.loads(path.read_text(encoding="utf-8"))


def _real_user(message: dict[str, Any]) -> bool:
    if message.get("role") != "user":
        return False
    content = str(message.get("content") or "")
    return not content.startswith(CONTEXT_PREFIX) and not content.startswith(
        REMINDER_PREFIX
    )


def pick_round(
    script: dict[str, Any], messages: list[dict[str, Any]]
) -> dict[str, Any]:
    turns = script.get("turns") or [[{"text": "OK."}]]
    users = [i for i, m in enumerate(messages) if _real_user(m)]
    turn = turns[min(max(len(users) - 1, 0), len(turns) - 1)]
    start = users[-1] if users else 0
    done = sum(
        1
        for m in messages[start:]
        if m.get("role") == "assistant" and m.get("tool_calls")
    )
    return turn[min(done, len(turn) - 1)] if turn else {"text": "OK."}


def build_reply(request: dict[str, Any]) -> tuple[int, dict[str, Any], dict[str, Any]]:
    """(http status, chat-completion message, script settings) for one request body."""
    model = str(request.get("model") or "")
    name = model.split(":", 1)[1] if ":" in model else "ask_then_propose"
    script = load_script(name)
    tools = request.get("tools") or []
    names = {t.get("function", {}).get("name") for t in tools if isinstance(t, dict)}
    if script.get("status"):
        return (
            int(script["status"]),
            {"error": {"message": script.get("message", "stub failure")}},
            script,
        )
    if tools and script.get("tools_status"):
        return (
            int(script["tools_status"]),
            {"error": {"message": "tools are not supported by this model"}},
            script,
        )
    if "qym_ping" in names:
        return (
            200,
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_ping",
                        "type": "function",
                        "function": {"name": "qym_ping", "arguments": '{"ok": true}'},
                    }
                ],
            },
            script,
        )
    rnd = pick_round(script, request.get("messages") or [])
    message: dict[str, Any] = {"role": "assistant", "content": rnd.get("text")}
    calls = []
    for i, call in enumerate(rnd.get("tool_calls") or []):
        calls.append(
            {
                "id": f"call_{int(time.time() * 1000) % 10**8}_{i}",
                "type": "function",
                "function": {
                    "name": call["name"],
                    "arguments": json.dumps(
                        call.get("arguments") or {}, ensure_ascii=False
                    ),
                },
            }
        )
    if calls:
        message["tool_calls"] = calls
    return 200, message, script


def completion_body(model: str, message: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": "stub-fb",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "finish_reason": "tool_calls" if message.get("tool_calls") else "stop",
                "message": message,
            }
        ],
        "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30},
    }


def stream_chunks(model: str, message: dict[str, Any]) -> list[dict[str, Any]]:
    base = {
        "id": "stub-fb",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
    }
    chunks: list[dict[str, Any]] = [
        {
            **base,
            "choices": [
                {
                    "index": 0,
                    "delta": {"role": "assistant", "content": ""},
                    "finish_reason": None,
                }
            ],
        }
    ]
    text = message.get("content") or ""
    if text:
        words = text.split(" ")
        for i, word in enumerate(words):
            piece = word + (" " if i < len(words) - 1 else "")
            chunks.append(
                {
                    **base,
                    "choices": [
                        {"index": 0, "delta": {"content": piece}, "finish_reason": None}
                    ],
                }
            )
    for i, call in enumerate(message.get("tool_calls") or []):
        fn = call["function"]
        chunks.append(
            {
                **base,
                "choices": [
                    {
                        "index": 0,
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": i,
                                    "id": call["id"],
                                    "type": "function",
                                    "function": {"name": fn["name"], "arguments": ""},
                                }
                            ]
                        },
                        "finish_reason": None,
                    }
                ],
            }
        )
        args = fn["arguments"]
        mid = max(1, len(args) // 2)
        for part in (args[:mid], args[mid:]):
            chunks.append(
                {
                    **base,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {
                                "tool_calls": [
                                    {"index": i, "function": {"arguments": part}}
                                ]
                            },
                            "finish_reason": None,
                        }
                    ],
                }
            )
    chunks.append(
        {
            **base,
            "choices": [
                {
                    "index": 0,
                    "delta": {},
                    "finish_reason": (
                        "tool_calls" if message.get("tool_calls") else "stop"
                    ),
                }
            ],
        }
    )
    chunks.append(
        {
            **base,
            "choices": [],
            "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30},
        }
    )
    return chunks


def is_feedback_model(model: Optional[str]) -> bool:
    return str(model or "").startswith("feedback")
