"""The turn loop of the feedback assistant (spec-e section 4.2): model calls, tools, streaming, storage.

``TurnRunner`` runs one turn in its own task and its own database session, so it finishes and stores the
answer even when the browser leaves the page (QE-49). It reports through an ``asyncio.Queue`` of
``(event, data)`` pairs (section 4.8) that the route turns into server-sent events; ``None`` ends the stream.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Optional

from qym_platform.db.feedback_models import (FeedbackAgentConnection,
                                             FeedbackMessage, FeedbackRequest)
from qym_platform.feedback_agent import knowledge, prompts, tools
from qym_platform.feedback_agent.connection import (AgentError, build_client,
                                                    map_exception,
                                                    read_api_key)
from qym_platform.feedback_agent.constants import (DEFAULT_MAX_USER_MESSAGES,
                                                   MAX_HISTORY_MESSAGES,
                                                   MAX_HISTORY_TOKENS,
                                                   MAX_MODEL_CALLS_PER_TURN,
                                                   MODEL_CALL_TIMEOUT_SECONDS,
                                                   PROMPT_VERSION)
from qym_platform.feedback_agent.store import add_message
from qym_platform.feedback_agent.text import approx_tokens, clip
from qym_platform.log import get_logger
from sqlalchemy.orm import Session

logger = get_logger(__name__)

_ARABIC = re.compile("[؀-ۿ]")
RUNNING: dict[str, "asyncio.Task[None]"] = {}

FALLBACK_CLOSING = {
    "en": "I prepared a request from what you told me. Review it below, change anything that is wrong, then submit it.",
    "ar": "جهزت طلبًا من خلال ما ذكرته. راجعه أدناه وعدّل ما يلزم ثم أرسله.",
}
FALLBACK_ASK = {
    "en": "Could you tell me a bit more about what you need and why it matters?",
    "ar": "هل يمكنك أن تخبرني أكثر عما تحتاجه ولماذا هو مهم؟",
}
CHECKLIST_REMINDER = (
    "Reminder from the server: call update_checklist now with what you learnt from the person's last message, "
    "then continue."
)


def language_of(text: str) -> str:
    return "ar" if _ARABIC.search(text or "") else "en"


@dataclass
class RoundResult:
    text: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0


def build_context_message(db: Session, req: FeedbackRequest) -> str:
    """First ``user`` message: the knowledge index or project facts, the checklist and any proposal (all data)."""
    parts = [prompts.CONTEXT_HEADER + f". Subject: {req.subject}."]
    if req.subject == "product" and req.project_id:
        parts.append(
            "Facts about the person's project:\n"
            + knowledge.build_project_facts(
                db, req.project_id, req.target_kind, req.target_id
            )
        )
    else:
        parts.append(
            "Documentation cards (read them with lookup_docs):\n"
            + knowledge.platform_index()
        )
    items = tools.checklist_items(req.checklist)
    parts.append(
        "Checklist now: "
        + "; ".join(
            f"{i['key']}={i['state']}" + (f" ({i['value']})" if i["value"] else "")
            for i in items
        )
    )
    if req.proposal and not req.proposal.get("superseded"):
        parts.append("A proposal is stored: " + str(req.proposal.get("title") or ""))
    return "\n\n".join(parts)


def history_messages(rows: list[FeedbackMessage]) -> list[dict[str, Any]]:
    """Stored messages as chat messages, grouped in units that are dropped whole (oldest first)."""
    units: list[list[dict[str, Any]]] = []
    pending: list[FeedbackMessage] = []

    def flush_tools() -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        calls, results = [], []
        for t in pending:
            payload = t.tool_payload if isinstance(t.tool_payload, dict) else {}
            call_id = str(payload.get("call_id") or f"call_{t.seq}")
            calls.append(
                {
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": t.tool_name or "lookup_docs",
                        "arguments": json.dumps(
                            payload.get("arguments") or {}, ensure_ascii=False
                        ),
                    },
                }
            )
            results.append(
                {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": clip(str(payload.get("result") or t.content), 1500),
                }
            )
        pending.clear()
        if calls:
            out.append({"role": "assistant", "content": None, "tool_calls": calls})
            out.extend(results)
        return out

    for row in rows:
        if row.role == "tool":
            if row.tool_name in ("search_requests", "lookup_docs", "propose_request"):
                pending.append(row)
            continue
        if row.role == "user":
            carried = flush_tools()
            if carried:
                units.append(carried)
            units.append([{"role": "user", "content": row.content}])
        else:
            unit = flush_tools()
            unit.append({"role": "assistant", "content": row.content})
            units.append(unit)
    carried = flush_tools()
    if carried:
        units.append(carried)

    # Bound by count and tokens: drop the oldest units, always keeping the first user message.
    def flat(us: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
        return [m for u in us for m in u]

    first = units[0] if units else []
    rest = units[1:]
    while rest and (
        len(flat([first] + rest)) > MAX_HISTORY_MESSAGES
        or sum(
            approx_tokens(json.dumps(m, ensure_ascii=False))
            for m in flat([first] + rest)
        )
        > MAX_HISTORY_TOKENS
    ):
        rest.pop(0)
    return flat([first] + rest)


class TurnRunner:
    def __init__(
        self,
        session_factory: Callable[[], Session],
        request_id: str,
        *,
        queue: "asyncio.Queue[Optional[tuple[str, dict[str, Any]]]]",
        client_factory: Optional[Callable[[str, str, str], Any]] = None,
    ) -> None:
        self.session_factory = session_factory
        self.request_id = request_id
        self.queue = queue
        self.client_factory = client_factory
        self.streamed = ""
        self.result: dict[str, Any] = {}

    # ------------------------------------------------------------------------------------------ plumbing
    def emit(self, event: str, data: dict[str, Any]) -> None:
        self.queue.put_nowait((event, data))

    async def run(self) -> None:
        db = self.session_factory()
        try:
            await self._run(db)
        except asyncio.CancelledError:
            self._stopped(db)
            # QE-153: a stream ends with exactly one terminal event, a stopped turn included.
            self.emit(
                "done",
                {"message_id": None, "seq": None, "phase": "asking", "stopped": True},
            )
            raise
        except Exception as exc:  # noqa: BLE001
            err = map_exception(exc)
            if err.code == "agent_bad_answer":
                logger.exception("feedback turn failed")
            else:
                logger.warning("feedback turn failed: %s", err.code)
            self._fail(db, err)
        finally:
            db.close()
            RUNNING.pop(self.request_id, None)
            self.queue.put_nowait(None)

    def _fail(self, db: Session, err: AgentError) -> None:
        try:
            db.rollback()
            req = db.get(FeedbackRequest, self.request_id)
            if req is not None:
                req.phase = (
                    "asking"
                    if not (req.proposal and not req.proposal.get("superseded"))
                    else "proposed"
                )
                req.turn_started_at = None
                db.commit()
        except Exception:  # noqa: BLE001
            logger.exception("could not reset the feedback draft after a failed turn")
            db.rollback()
        self.result = {"error": err.code}
        self.emit(
            "error",
            {
                "code": err.code,
                "message": err.message,
                "retryable": err.retryable,
                "admin_detail": err.admin_detail,
            },
        )

    def _stopped(self, db: Session) -> None:
        try:
            db.rollback()
            req = db.get(FeedbackRequest, self.request_id)
            if req is None:
                return
            if self.streamed.strip():
                add_message(
                    db,
                    req.id,
                    "assistant",
                    self.streamed.strip(),
                    model=req.model,
                    status="stopped",
                )
            req.phase = "asking"
            req.turn_started_at = None
            req.last_activity_at = datetime.utcnow()
            db.commit()
        except Exception:  # noqa: BLE001
            logger.exception("could not store a stopped feedback turn")
            db.rollback()

    # ------------------------------------------------------------------------------------------- the turn
    async def _run(self, db: Session) -> None:
        req = db.get(FeedbackRequest, self.request_id)
        conn = db.get(FeedbackAgentConnection, 1)
        if req is None:
            raise AgentError(
                "agent_unavailable", "The assistant is not available.", retryable=False
            )
        if conn is None or not (
            conn.llm_base_url and conn.llm_model and conn.llm_api_key_encrypted
        ):
            raise AgentError(
                "agent_unavailable", "The assistant is not set up.", retryable=False
            )
        api_key = read_api_key(conn)
        client = (
            self.client_factory or (lambda url, key, model: build_client(url, key))
        )(conn.llm_base_url, api_key, conn.llm_model)
        self.emit("status", {"phase": "thinking"})
        try:
            await self._loop(db, req, conn, client)
        finally:
            closer = getattr(client, "close", None)
            if closer is not None:
                try:
                    await closer()
                except Exception:  # noqa: BLE001
                    pass

    async def _loop(
        self,
        db: Session,
        req: FeedbackRequest,
        conn: FeedbackAgentConnection,
        client: Any,
    ) -> None:
        max_user = int(conn.max_user_messages or DEFAULT_MAX_USER_MESSAGES)
        rows = (
            db.query(FeedbackMessage)
            .filter(FeedbackMessage.request_id == req.id)
            .order_by(FeedbackMessage.seq)
            .all()
        )
        user_rows = [r for r in rows if r.role == "user"]
        last_user = user_rows[-1].content if user_rows else ""
        ctx = tools.ToolContext(
            db=db,
            req=req,
            user_message_count=len(user_rows),
            max_user_messages=max_user,
            last_user_text=last_user,
            model=conn.llm_model,
        )
        forced_propose = len(user_rows) >= max_user
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": prompts.SYSTEM_PROMPT},
            {"role": "user", "content": build_context_message(db, req)},
            *history_messages(rows),
        ]
        schemas = prompts.tool_schemas(req.subject)
        rounds = 0
        reasked = False
        final_text = ""
        prompt_tokens = completion_tokens = 0
        force_ok = True
        pieces: list[str] = []
        while rounds < MAX_MODEL_CALLS_PER_TURN:
            rounds += 1
            if not ctx.checklist_updated:
                choice: Any = (
                    {"type": "function", "function": {"name": "update_checklist"}}
                    if force_ok
                    else "auto"
                )
            elif ctx.stored_proposal:
                choice = "none"
            elif forced_propose:
                choice = (
                    {"type": "function", "function": {"name": "propose_request"}}
                    if force_ok
                    else "auto"
                )
            else:
                choice = "auto"
            buffer_text = not ctx.checklist_updated
            self.emit("status", {"phase": "thinking"})
            try:
                res = await asyncio.wait_for(
                    self._model_round(
                        client, conn.llm_model, messages, schemas, choice, buffer_text
                    ),
                    MODEL_CALL_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError as exc:
                raise AgentError("agent_timeout", "timed out") from exc
            except Exception as exc:  # noqa: BLE001
                mapped = map_exception(exc)
                if (
                    isinstance(choice, dict)
                    and force_ok
                    and "tool_choice" in str(exc).lower()
                ):
                    force_ok = False
                    rounds -= 1
                    continue
                raise mapped from exc
            prompt_tokens += res.prompt_tokens
            completion_tokens += res.completion_tokens
            if res.tool_calls:
                if res.text and not buffer_text:
                    pieces.append(res.text)
                messages.append(
                    {
                        "role": "assistant",
                        "content": res.text or None,
                        "tool_calls": [
                            {
                                "id": c["id"],
                                "type": "function",
                                "function": {
                                    "name": c["name"],
                                    "arguments": c["arguments"],
                                },
                            }
                            for c in res.tool_calls
                        ],
                    }
                )
                for call in res.tool_calls:
                    ctx.call_id = call["id"]
                    result, args = tools.execute(ctx, call["name"], call["arguments"])
                    if result.status_phase:
                        self.emit("status", {"phase": result.status_phase})
                    if (
                        call["name"] in ("search_requests", "lookup_docs")
                        and result.display
                    ):
                        msg = add_message(
                            db,
                            req.id,
                            "tool",
                            result.display,
                            tool_name=call["name"],
                            tool_payload={
                                "call_id": call["id"],
                                "arguments": args,
                                "result": clip(result.content, 6000),
                                "ids": result.ids,
                                "kind": result.kind,
                            },
                            model=conn.llm_model,
                        )
                        self.emit(
                            "tool",
                            {
                                "seq": msg.seq,
                                "name": call["name"],
                                "summary": result.display,
                                "ids": result.ids,
                            },
                        )
                    if call["name"] == "propose_request" and result.proposal_stored:
                        seq = req.proposal.get("seq") if req.proposal else None
                        self.emit(
                            "tool",
                            {
                                "seq": seq,
                                "name": "propose_request",
                                "summary": f"Proposed request: {req.proposal.get('title', '')}",
                                "ids": [],
                            },
                        )
                    for name, data in result.events:
                        self.emit(name, data)
                    if result.removed_reference:
                        ctx.corrected_events.append("removed")
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call["id"],
                            "content": result.content,
                        }
                    )
                db.commit()
                continue
            # No tool call: the final text of the turn.
            if not ctx.checklist_updated and not reasked:
                reasked = True
                messages.append({"role": "assistant", "content": res.text})
                messages.append({"role": "user", "content": CHECKLIST_REMINDER})
                continue
            if buffer_text and res.text:
                self.emit("delta", {"text": res.text})
            if res.text:
                pieces.append(res.text)
            break
        final_text = "\n\n".join(p.strip() for p in pieces if p.strip()).strip()
        lang = language_of(last_user)
        if not final_text:
            final_text = (
                FALLBACK_CLOSING[lang] if ctx.stored_proposal else FALLBACK_ASK[lang]
            )
            self.emit("delta", {"text": final_text})
        message = add_message(
            db,
            req.id,
            "assistant",
            final_text,
            model=conn.llm_model,
            prompt_tokens=prompt_tokens or None,
            completion_tokens=completion_tokens or None,
        )
        req.model = conn.llm_model
        req.prompt_version = PROMPT_VERSION
        req.phase = (
            "proposed"
            if (req.proposal and not req.proposal.get("superseded"))
            else "asking"
        )
        req.turn_started_at = None
        req.last_activity_at = datetime.utcnow()
        db.commit()
        self.result = {"message_id": message.id, "seq": message.seq, "phase": req.phase}
        self.emit(
            "done", {"message_id": message.id, "seq": message.seq, "phase": req.phase}
        )

    # -------------------------------------------------------------------------------------- one model call
    async def _model_round(
        self,
        client: Any,
        model: str,
        messages: list[dict[str, Any]],
        schemas: list[dict[str, Any]],
        choice: Any,
        buffer_text: bool,
    ) -> RoundResult:
        kwargs: dict[str, Any] = dict(
            model=model,
            messages=messages,
            tools=schemas,
            tool_choice=choice,
            stream=True,
        )
        attempts = 0
        include_usage = True
        while True:
            attempts += 1
            try:
                call_kwargs = dict(kwargs)
                if include_usage:
                    call_kwargs["stream_options"] = {"include_usage": True}
                stream = await client.chat.completions.create(**call_kwargs)
                return await self._consume(stream, buffer_text)
            except Exception as exc:  # noqa: BLE001
                text = str(exc).lower()
                if include_usage and "stream_options" in text:
                    include_usage = False
                    continue
                mapped = map_exception(exc)
                transient = mapped.code == "agent_unavailable" and mapped.retryable
                if attempts < 2 and transient and not self.streamed:
                    await asyncio.sleep(0.2)
                    continue
                raise

    async def _consume(self, stream: Any, buffer_text: bool) -> RoundResult:
        out = RoundResult()
        calls: dict[int, dict[str, str]] = {}
        async for chunk in stream:
            usage = getattr(chunk, "usage", None)
            if usage is not None:
                out.prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
                out.completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
            choices = getattr(chunk, "choices", None) or []
            if not choices:
                continue
            delta = getattr(choices[0], "delta", None)
            if delta is None:
                continue
            text = getattr(delta, "content", None)
            if text:
                out.text += text
                if not buffer_text:
                    self.streamed += text
                    self.emit("delta", {"text": text})
            for tc in getattr(delta, "tool_calls", None) or []:
                idx = int(getattr(tc, "index", 0) or 0)
                slot = calls.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                if getattr(tc, "id", None):
                    slot["id"] = tc.id
                fn = getattr(tc, "function", None)
                if fn is not None:
                    if getattr(fn, "name", None):
                        slot["name"] += fn.name
                    if getattr(fn, "arguments", None):
                        slot["arguments"] += fn.arguments
        for idx in sorted(calls):
            slot = calls[idx]
            if not slot["name"]:
                continue
            out.tool_calls.append(
                {
                    "id": slot["id"] or f"call_{uuid.uuid4().hex[:12]}",
                    "name": slot["name"],
                    "arguments": slot["arguments"] or "{}",
                }
            )
        return out
