"""The proposal the assistant submits through ``propose_request`` (spec-e section 4.6), validated server side."""

from __future__ import annotations

import re
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from qym_platform.feedback_agent.constants import CHECKLIST_KEYS, MAX_RELATED


def _line(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


class PriorityChoice(BaseModel):
    model_config = ConfigDict(extra="ignore")
    level: Literal["low", "medium", "high", "critical"]
    reasoning: str = Field(min_length=1, max_length=400)

    @field_validator("reasoning", mode="before")
    @classmethod
    def _strip(cls, v: object) -> str:
        return str(v or "").strip()


class ComplexityChoice(BaseModel):
    model_config = ConfigDict(extra="ignore")
    level: Literal["S", "M", "L", "XL"]
    reasoning: str = Field(min_length=1, max_length=400)

    @field_validator("reasoning", mode="before")
    @classmethod
    def _strip(cls, v: object) -> str:
        return str(v or "").strip()


class RelatedItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    request_id: str = Field(min_length=1, max_length=40)
    kind: Literal["duplicate", "conflict", "related"]
    note: str = Field(min_length=1, max_length=300)


class ProposalArgs(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str = Field(min_length=1, max_length=80)
    summary: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=40, max_length=2000)
    business_need: str = Field(min_length=1, max_length=600)
    justification: str = Field(min_length=1, max_length=600)
    priority: PriorityChoice
    complexity: ComplexityChoice
    related: List[RelatedItem] = Field(default_factory=list, max_length=MAX_RELATED)
    open_gaps: List[str] = Field(default_factory=list)
    user_requested_submit: bool = False

    @field_validator("title", "summary", mode="before")
    @classmethod
    def _one_line(cls, v: object) -> str:
        return _line(str(v or ""))

    @field_validator("description", "business_need", "justification", mode="before")
    @classmethod
    def _text(cls, v: object) -> str:
        return str(v or "").strip()

    @field_validator("open_gaps")
    @classmethod
    def _gaps(cls, v: List[str]) -> List[str]:
        bad = [k for k in v if k not in CHECKLIST_KEYS]
        if bad:
            raise ValueError(f"unknown checklist keys: {', '.join(bad)}")
        return list(dict.fromkeys(v))


class ChecklistUpdateItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    key: Literal[
        "business_need", "affected", "workaround", "outcome", "urgency", "scope"
    ]
    state: Literal["open", "partial", "filled", "declined"]
    value: Optional[str] = None


class ChecklistUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    items: List[ChecklistUpdateItem] = Field(min_length=1, max_length=6)


def validation_message(exc: Exception) -> str:
    """A short, model-readable summary of a pydantic error."""
    errors = getattr(exc, "errors", None)
    if not callable(errors):
        return str(exc)[:300]
    parts = []
    for err in errors()[:6]:
        loc = ".".join(str(x) for x in err.get("loc", ()))
        parts.append(f"{loc}: {err.get('msg', 'invalid')}")
    return "; ".join(parts)[:500]
