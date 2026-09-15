"""Deterministic generators for production-shaped evaluation content.

Everything here is pure (seeded ``random.Random`` in, plain dicts out) so the
same shapes can be bulk-loaded by ``synth.py`` and streamed live through the
SDK client by ``live_stream.py``.

The shape reproduces what the SDK's OpenTelemetry instrumentation actually
records for an agentic task: every LLM call carries the *whole conversation so
far* in ``input.value`` and ``llm.input_messages.*`` (so a trace with ``n``
LLM turns stores O(n^2) message bytes), tool calls sit between LLM turns, and
each metric adds an LLM-as-judge span whose prompt embeds the item input and
output. See ``packages/sdk/qym/core/otel.py``.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

_WORDS = (
    "invoice customer ledger balance settlement reconcile portfolio exposure "
    "quarter forecast variance policy compliance audit approval workflow "
    "shipment warehouse inventory backlog dispatch carrier tariff clearance "
    "ticket escalation resolution outage latency throughput retry timeout "
    "schema column table query join index partition vacuum replica failover "
    "prompt completion context window token temperature retrieval embedding"
).split()

_TOOLS = ("search_documents", "sql_query", "fetch_customer", "calculator", "http_get")
_MODELS = ("gpt-4o-mini", "gpt-4.1", "claude-sonnet-4", "gemini-2.5-flash", "qwen3-32b")
_JUDGE_MODEL = "gpt-4o-mini"
_METRIC_POOL = (
    "accuracy",
    "faithfulness",
    "relevance",
    "completeness",
    "conciseness",
    "tone",
    "sql_validity",
)
_TASKS = ("support-agent", "text2sql", "rag-qa", "summarizer", "policy-checker")


def prose(rng: random.Random, chars: int) -> str:
    """Pseudo-random prose of roughly ``chars`` characters."""
    out: List[str] = []
    size = 0
    while size < chars:
        w = rng.choice(_WORDS)
        out.append(w)
        size += len(w) + 1
    return " ".join(out)


@dataclass
class MetricSpec:
    name: str
    score_type: str = "numeric"
    direction: str = "maximize"
    pass_threshold: Optional[float] = 0.7


@dataclass
class RunShape:
    task: str
    dataset: str
    model: str
    metrics: List[MetricSpec]
    samples: int
    item_count: int
    status: str  # COMPLETED | FAILED | RUNNING


@dataclass
class SpanShape:
    span_id: str
    parent_span_id: Optional[str]
    name: str
    kind: str
    oi_kind: str
    start_ns: int
    end_ns: int
    status: str
    attributes: Dict[str, Any]
    usage_scope: Optional[str] = None


@dataclass
class PassShape:
    pass_number: int
    trace_id: str
    started_at_ms: int
    latency_ms: float
    output: Any
    error: Optional[str]
    spans: List[SpanShape]
    scores: Dict[str, Dict[str, Any]]  # metric -> {score, explanation, meta}


@dataclass
class ItemShape:
    item_id: str
    index: int
    input: Dict[str, Any]
    expected: Any
    item_metadata: Dict[str, Any]
    passes: List[PassShape] = field(default_factory=list)


def _hex(rng: random.Random, n: int) -> str:
    return "".join(rng.choice("0123456789abcdef") for _ in range(n))


def run_shape(rng: random.Random, *, project_index: int, repeat_share: float = 0.15) -> RunShape:
    task = _TASKS[(project_index + rng.randrange(2)) % len(_TASKS)]
    metric_count = rng.randint(3, 5)
    metrics = [MetricSpec(name=m) for m in rng.sample(_METRIC_POOL, metric_count)]
    samples = rng.choice((3, 5, 8, 12)) if rng.random() < repeat_share else 1
    roll = rng.random()
    status = "COMPLETED" if roll < 0.90 else "FAILED" if roll < 0.95 else "RUNNING"
    return RunShape(
        task=task,
        dataset=f"{task}-golden-v{rng.randint(1, 4)}",
        model=rng.choice(_MODELS),
        metrics=metrics,
        samples=samples,
        item_count=rng.randint(50, 100),
        status=status,
    )


def item_shape(rng: random.Random, index: int) -> ItemShape:
    question = prose(rng, rng.randint(80, 300))
    context = prose(rng, rng.randint(300, 1500))
    return ItemShape(
        item_id=f"item-{index:04d}",
        index=index,
        input={"question": question, "context": context},
        expected={"answer": prose(rng, rng.randint(60, 400))},
        item_metadata={"domain": rng.choice(("commerce", "finance", "support")), "complexity": rng.choice(("easy", "medium", "hard"))},
    )


def _message_attrs(attrs: Dict[str, Any], prefix: str, messages: List[Dict[str, str]]) -> None:
    for i, msg in enumerate(messages[:50]):
        attrs[f"{prefix}.{i}.message.role"] = msg["role"]
        if msg.get("content"):
            attrs[f"{prefix}.{i}.message.content"] = msg["content"]


def agent_trace(
    rng: random.Random,
    *,
    item: ItemShape,
    model: str,
    started_at_ms: int,
    llm_turns: Optional[int] = None,
) -> tuple[List[SpanShape], str, Any, float]:
    """One agentic execution: root chain -> task chain -> (LLM, TOOL)* LLM.

    Returns (spans, trace_id, output, latency_ms). Conversation grows every
    turn and is re-sent in full — the real O(n^2) shape.
    """
    trace_id = _hex(rng, 32)
    turns = llm_turns if llm_turns is not None else rng.randint(3, 12)
    t0 = started_at_ms * 1_000_000
    now = t0
    spans: List[SpanShape] = []

    root_id = _hex(rng, 16)
    task_id = _hex(rng, 16)
    system_prompt = prose(rng, rng.randint(400, 1200))
    messages: List[Dict[str, str]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(item.input, ensure_ascii=False)},
    ]
    total_tokens = 0
    final_answer = ""
    for turn in range(turns):
        # LLM turn
        llm_id = _hex(rng, 16)
        dur = rng.randint(400, 3500) * 1_000_000
        request_payload = {"model": model, "messages": messages, "temperature": 0.2}
        is_last = turn == turns - 1
        if is_last:
            final_answer = prose(rng, rng.randint(500, 3000))
            assistant = {"role": "assistant", "content": final_answer}
        else:
            tool = rng.choice(_TOOLS)
            assistant = {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": f"call_{_hex(rng, 12)}",
                        "type": "function",
                        "function": {"name": tool, "arguments": json.dumps({"q": prose(rng, 60)})},
                    }
                ],
            }
        result_payload = {
            "id": f"chatcmpl-{_hex(rng, 12)}",
            "model": model,
            "choices": [{"index": 0, "message": assistant, "finish_reason": "stop"}],
            "usage": {},
        }
        prompt_tokens = sum(len(m.get("content") or "") for m in messages) // 4
        completion_tokens = max(8, len(assistant.get("content") or "") // 4)
        total_tokens += prompt_tokens + completion_tokens
        attrs: Dict[str, Any] = {
            "openinference.span.kind": "LLM",
            "llm.model_name": model,
            "llm.provider": "openai",
            "llm.token_count.prompt": prompt_tokens,
            "llm.token_count.completion": completion_tokens,
            "llm.token_count.total": prompt_tokens + completion_tokens,
            "input.mime_type": "application/json",
            "output.mime_type": "application/json",
            "input.value": json.dumps(request_payload, ensure_ascii=False)[:64000],
            "output.value": json.dumps(result_payload, ensure_ascii=False)[:64000],
        }
        _message_attrs(attrs, "llm.input_messages", messages)
        _message_attrs(attrs, "llm.output_messages", [assistant])
        spans.append(
            SpanShape(
                span_id=llm_id,
                parent_span_id=task_id,
                name="ChatCompletion",
                kind="INTERNAL",
                oi_kind="LLM",
                start_ns=now,
                end_ns=now + dur,
                status="OK",
                attributes=attrs,
            )
        )
        now += dur
        messages.append(assistant)
        if is_last:
            break
        # Tool turn
        tool_name = assistant["tool_calls"][0]["function"]["name"]
        tool_id = _hex(rng, 16)
        tdur = rng.randint(50, 1200) * 1_000_000
        tool_output = prose(rng, rng.randint(300, 2000))
        failed = rng.random() < 0.04
        spans.append(
            SpanShape(
                span_id=tool_id,
                parent_span_id=task_id,
                name=f"tool:{tool_name}",
                kind="INTERNAL",
                oi_kind="TOOL",
                start_ns=now,
                end_ns=now + tdur,
                status="ERROR" if failed else "OK",
                attributes={
                    "openinference.span.kind": "TOOL",
                    "tool.name": tool_name,
                    "input.value": assistant["tool_calls"][0]["function"]["arguments"],
                    "output.value": ("error: upstream timeout" if failed else tool_output),
                },
            )
        )
        now += tdur
        messages.append({"role": "tool", "content": tool_output, "tool_call_id": assistant["tool_calls"][0]["id"]})

    output = {"answer": final_answer, "tokens": total_tokens}
    spans.insert(
        0,
        SpanShape(
            span_id=task_id,
            parent_span_id=root_id,
            name="task",
            kind="INTERNAL",
            oi_kind="CHAIN",
            start_ns=t0,
            end_ns=now,
            status="OK",
            attributes={"openinference.span.kind": "CHAIN", "input.value": json.dumps(item.input, ensure_ascii=False), "output.value": json.dumps(output, ensure_ascii=False)},
        ),
    )
    latency_ms = (now - t0) / 1e6
    return spans, trace_id, output, latency_ms, root_id


def judge_spans(
    rng: random.Random,
    *,
    item: ItemShape,
    output: Any,
    metrics: List[MetricSpec],
    parent_root_id: str,
    start_ns: int,
) -> tuple[List[SpanShape], Dict[str, Dict[str, Any]], int]:
    """LLM-as-judge spans under an ``eval_metrics`` chain, plus their scores."""
    metrics_chain_id = _hex(rng, 16)
    spans: List[SpanShape] = []
    scores: Dict[str, Dict[str, Any]] = {}
    now = start_ns
    for spec in metrics:
        criteria = prose(rng, rng.randint(200, 600))
        prompt = (
            f"You are grading {spec.name}.\nCriteria: {criteria}\n\nInput:\n"
            f"{json.dumps(item.input, ensure_ascii=False)}\n\nExpected:\n"
            f"{json.dumps(item.expected, ensure_ascii=False)}\n\nOutput:\n"
            f"{json.dumps(output, ensure_ascii=False)}\n\nReturn JSON {{score, explanation}}."
        )
        score = round(min(1.0, max(0.0, rng.gauss(0.72, 0.18))), 3)
        explanation = prose(rng, rng.randint(300, 800))
        verdict = {"score": score, "explanation": explanation}
        dur = rng.randint(600, 2500) * 1_000_000
        messages = [{"role": "system", "content": "You are a strict evaluator."}, {"role": "user", "content": prompt}]
        attrs: Dict[str, Any] = {
            "openinference.span.kind": "LLM",
            "qym.usage_scope": "metric",
            "llm.model_name": _JUDGE_MODEL,
            "llm.token_count.prompt": len(prompt) // 4,
            "llm.token_count.completion": len(explanation) // 4,
            "llm.token_count.total": (len(prompt) + len(explanation)) // 4,
            "input.value": json.dumps({"model": _JUDGE_MODEL, "messages": messages}, ensure_ascii=False)[:64000],
            "output.value": json.dumps({"choices": [{"message": {"role": "assistant", "content": json.dumps(verdict)}}]}, ensure_ascii=False)[:64000],
        }
        _message_attrs(attrs, "llm.input_messages", messages)
        spans.append(
            SpanShape(
                span_id=_hex(rng, 16),
                parent_span_id=metrics_chain_id,
                name=f"metric:{spec.name}",
                kind="INTERNAL",
                oi_kind="LLM",
                start_ns=now,
                end_ns=now + dur,
                status="OK",
                attributes=attrs,
                usage_scope="metric",
            )
        )
        now += dur
        scores[spec.name] = {
            "score": score,
            "explanation": explanation,
            "meta": {"status": "ok", "judge_model": _JUDGE_MODEL, "criteria": criteria, "raw": verdict},
        }
    spans.insert(
        0,
        SpanShape(
            span_id=metrics_chain_id,
            parent_span_id=parent_root_id,
            name="eval_metrics",
            kind="INTERNAL",
            oi_kind="CHAIN",
            start_ns=start_ns,
            end_ns=now,
            status="OK",
            attributes={"openinference.span.kind": "CHAIN"},
        ),
    )
    return spans, scores, now


def item_pass(
    rng: random.Random,
    *,
    item: ItemShape,
    run: RunShape,
    pass_number: int,
    started_at_ms: int,
    fail_rate: float = 0.03,
) -> PassShape:
    spans, trace_id, output, latency_ms, root_id = agent_trace(rng, item=item, model=run.model, started_at_ms=started_at_ms)
    task_end_ns = spans[0].end_ns
    error = None
    scores: Dict[str, Dict[str, Any]] = {}
    if rng.random() < fail_rate:
        error = rng.choice(("TimeoutError: task exceeded 60s", "RateLimitError: 429 Too Many Requests", "ValueError: malformed tool arguments"))
        output = None
        end_ns = task_end_ns
    else:
        jspans, scores, end_ns = judge_spans(rng, item=item, output=output, metrics=run.metrics, parent_root_id=root_id, start_ns=task_end_ns)
        spans.extend(jspans)
    spans.insert(
        0,
        SpanShape(
            span_id=root_id,
            parent_span_id=None,
            name="eval_item",
            kind="INTERNAL",
            oi_kind="CHAIN",
            start_ns=spans[0].start_ns,
            end_ns=end_ns,
            status="ERROR" if error else "OK",
            attributes={"openinference.span.kind": "CHAIN", "qym.item_id": item.item_id, "qym.pass_number": pass_number},
        ),
    )
    return PassShape(
        pass_number=pass_number,
        trace_id=trace_id,
        started_at_ms=started_at_ms,
        latency_ms=latency_ms,
        output=output,
        error=error,
        spans=spans,
        scores=scores,
    )
