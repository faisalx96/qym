"""``RequestSearch``: the assistant's view of existing confirmed requests (spec-e section 4.4, QE-161).

Lexical ranking over title, summary and business need, Arabic aware. The interface is deliberately narrow so
an embedding index can replace ``LexicalRequestSearch`` later (decision QE-D11).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol

from sqlalchemy import or_
from sqlalchemy.orm import Session

from qym_platform.db.feedback_models import FeedbackRequest
from qym_platform.feedback_agent.constants import SEARCH_MAX_RESULTS, SEARCH_MIN_SCORE
from qym_platform.feedback_agent.text import normalize, stem, tokens

# Field weights: a query word in the title counts more than in the summary or the need.
_W_TITLE, _W_SUMMARY, _W_NEED = 3.0, 2.0, 1.0
_CANDIDATES = 400


@dataclass(frozen=True)
class SearchHit:
    request_id: str  # uuid
    number: int
    title: str
    summary: str
    status: str
    priority: Optional[str]
    subject: str
    project_id: Optional[str]
    score: float


class RequestSearch(Protocol):
    def search(
        self,
        query: str,
        *,
        subject: Optional[str] = None,
        project_id: Optional[str] = None,
        exclude_id: Optional[str] = None,
        limit: int = 5,
    ) -> list[SearchHit]: ...


def _field_score(query_stems: list[str], field_tokens: list[str]) -> list[float]:
    """Per query word: 1.0 for an exact token, 0.7 for a stem match, else 0."""
    exact = set(field_tokens)
    stems = {stem(t) for t in field_tokens}
    out = []
    for q in query_stems:
        if q in exact:
            out.append(1.0)
        elif stem(q) in stems:
            out.append(0.7)
        else:
            out.append(0.0)
    return out


class LexicalRequestSearch:
    def __init__(self, db: Session) -> None:
        self.db = db

    def search(
        self,
        query: str,
        *,
        subject: Optional[str] = None,
        project_id: Optional[str] = None,
        exclude_id: Optional[str] = None,
        limit: int = 5,
    ) -> list[SearchHit]:
        limit = max(1, min(int(limit or 5), SEARCH_MAX_RESULTS))
        q_tokens = tokens(query)[:12]
        if not q_tokens:
            return []
        needles = sorted({stem(t) for t in q_tokens}, key=len, reverse=True)[:8]
        needles = [n for n in needles if len(n) >= 2]
        if not needles:
            return []
        q = self.db.query(FeedbackRequest).filter(
            FeedbackRequest.status != "draft",
            or_(*[FeedbackRequest.search_text.like(f"%{n}%") for n in needles]),
        )
        if subject in ("platform", "product"):
            q = q.filter(FeedbackRequest.subject == subject)
        if exclude_id:
            q = q.filter(FeedbackRequest.id != exclude_id)
        rows = q.order_by(FeedbackRequest.created_at.desc()).limit(_CANDIDATES).all()
        q_stems = list(dict.fromkeys(q_tokens))
        hits: list[SearchHit] = []
        for row in rows:
            title_t = tokens(row.title)
            summary_t = tokens(row.summary)
            need_t = tokens(row.business_need)
            ts = _field_score(q_stems, title_t)
            ss = _field_score(q_stems, summary_t)
            ns = _field_score(q_stems, need_t)
            total = 0.0
            for a, b, c in zip(ts, ss, ns):
                total += max(a * _W_TITLE, b * _W_SUMMARY, c * _W_NEED)
            score = total / (_W_TITLE * len(q_stems))
            if score < SEARCH_MIN_SCORE:
                continue
            hits.append(
                SearchHit(
                    request_id=row.id,
                    number=row.number or 0,
                    title=row.title,
                    summary=row.summary,
                    status=row.status,
                    priority=row.priority,
                    subject=row.subject,
                    project_id=row.project_id,
                    score=round(score, 3),
                )
            )
        hits.sort(
            key=lambda h: (
                0 if project_id and h.project_id == project_id else 1,
                -h.score,
                -(h.number or 0),
            )
        )
        return hits[:limit]


def request_ref(number: Optional[int]) -> str:
    return f"FB-{int(number):04d}" if number else ""
