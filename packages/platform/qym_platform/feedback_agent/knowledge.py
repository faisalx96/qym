"""What the assistant knows (spec-e section 4.5).

* Subject ``platform``: the committed, generated pack ``knowledge_platform.json`` (cards of at most 1,500
  characters). The prompt carries only an index; ``lookup_docs`` returns cards by id or by query.
* Subject ``product``: ``build_project_facts`` reads one project's names and numbers. Never included: keys,
  tokens, URLs, item inputs or outputs, member emails.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from qym_platform.db.models import (
    Dataset,
    DatasetVersion,
    DatasetVersionStatus,
    EvalEnvironment,
    EvalExperiment,
    EvalRunScore,
    Project,
    Run,
)
from qym_platform.feedback_agent.constants import DOCS_CARD_CHARS, PRODUCT_FACTS_MAX_CHARS
from qym_platform.feedback_agent.text import clip, one_line, stem, tokens

PACK_PATH = Path(__file__).resolve().parent / "knowledge_platform.json"
INDEX_MAX_CHARS = 6000  # about 1,500 tokens
PRODUCT_SECTIONS = ("environments", "datasets", "metrics", "runs", "experiments")

WHAT_IS_QYM = (
    "qym is an evaluation platform for LLM products: a team defines a task, runs it against a versioned dataset, "
    "scores the outputs with metrics, reviews failures, and compares runs and experiments across models and "
    "environments."
)


@lru_cache(maxsize=1)
def load_platform_pack() -> dict[str, Any]:
    return json.loads(PACK_PATH.read_text(encoding="utf-8"))


def platform_index() -> str:
    """One line per card (``id: title``), bounded to about 1,500 tokens."""
    lines, size = [], 0
    for card in load_platform_pack().get("cards", []):
        line = f"- {card['id']}: {card['title']}"
        if size + len(line) > INDEX_MAX_CHARS:
            lines.append(f"- (+{len(load_platform_pack()['cards']) - len(lines)} more cards, use lookup_docs)")
            break
        lines.append(line)
        size += len(line) + 1
    return "\n".join(lines)


def lookup_platform_docs(query: str = "", card_id: str = "", limit: int = 3) -> list[dict[str, str]]:
    cards = load_platform_pack().get("cards", [])
    if card_id:
        found = [c for c in cards if c["id"] == card_id.strip()]
        return [_public(c) for c in found[:limit]]
    q = [stem(t) for t in tokens(query)]
    if not q:
        return []
    scored = []
    for card in cards:
        title_tokens = {stem(t) for t in tokens(card["title"])}
        text_tokens = {stem(t) for t in tokens(card["text"])}
        score = sum((2.0 if t in title_tokens else 0.0) + (1.0 if t in text_tokens else 0.0) for t in q)
        if score > 0:
            scored.append((score, card))
    scored.sort(key=lambda item: -item[0])
    return [_public(c) for _, c in scored[:limit]]


def _public(card: dict[str, Any]) -> dict[str, str]:
    return {"card_id": card["id"], "title": card["title"], "text": clip(card["text"], DOCS_CARD_CHARS)}


# ----------------------------------------------------------------------------------------- product facts


def _env_lines(db: Session, project_id: str) -> list[str]:
    rows = (
        db.query(EvalEnvironment.name)
        .filter(EvalEnvironment.project_id == project_id)
        .order_by(EvalEnvironment.name)
        .limit(20)
        .all()
    )
    return [r[0] for r in rows]


def _datasets(db: Session, project_id: str) -> list[dict[str, Any]]:
    datasets = (
        db.query(Dataset)
        .filter(Dataset.project_id == project_id, Dataset.deleted_at.is_(None))
        .order_by(Dataset.name)
        .limit(30)
        .all()
    )
    out = []
    for ds in datasets:
        latest = (
            db.query(DatasetVersion.version, DatasetVersion.item_count)
            .filter(
                DatasetVersion.dataset_id == ds.id,
                DatasetVersion.status == DatasetVersionStatus.PUBLISHED,
            )
            .order_by(DatasetVersion.created_at.desc())
            .first()
        )
        out.append(
            {
                "name": ds.name,
                "version": latest[0] if latest else "no published version",
                "items": int(latest[1]) if latest else 0,
                "restricted": ds.access_mode == "restricted" or bool(ds.private_test_set),
            }
        )
    return out


def _recent_runs(db: Session, project_id: str, limit: int = 20) -> list[Run]:
    return (
        db.query(Run)
        .filter(Run.project_id == project_id, Run.deleted_at.is_(None))
        .order_by(Run.created_at.desc())
        .limit(limit)
        .all()
    )


def _run_means(db: Session, run_ids: list[str]) -> dict[str, list[tuple[str, float]]]:
    if not run_ids:
        return {}
    rows = (
        db.query(EvalRunScore.run_id, EvalRunScore.metric_name, EvalRunScore.mean_score)
        .filter(EvalRunScore.run_id.in_(run_ids))
        .order_by(EvalRunScore.metric_name)
        .all()
    )
    out: dict[str, list[tuple[str, float]]] = {}
    for run_id, metric, mean in rows:
        out.setdefault(run_id, []).append((metric, float(mean)))
    return out


def _run_line(run: Run, means: list[tuple[str, float]]) -> str:
    status = run.status.value if run.status else "unknown"
    parts = [
        f"{one_line(run.task)[:60]} on {one_line(run.dataset)[:60]}",
        f"model {one_line(run.model or 'unknown')[:60]}",
        status.lower(),
    ]
    if means:
        parts.append(", ".join(f"{m} {v:.2f}" for m, v in means[:3]))
    return "; ".join(parts)


def _experiments(db: Session, project_id: str, limit: int = 5) -> list[str]:
    rows = (
        db.query(EvalExperiment)
        .filter(EvalExperiment.project_id == project_id)
        .order_by(EvalExperiment.created_at.desc())
        .limit(limit)
        .all()
    )
    names = {
        e.id: e.name
        for e in db.query(EvalEnvironment.id, EvalEnvironment.name).filter(
            EvalEnvironment.project_id == project_id
        )
    }
    out = []
    for e in rows:
        envs = ", ".join(names.get(i, "?") for i in (e.environment_ids or [])[:4]) or "none"
        status = e.status.value.lower() if e.status else "unknown"
        out.append(f"{one_line(e.name)[:80]} ({status}; environments: {envs})")
    return out


def _target_line(db: Session, project_id: str, kind: Optional[str], target_id: Optional[str]) -> str:
    if not kind or not target_id:
        return ""
    if kind == "run":
        run = db.query(Run).filter(Run.project_id == project_id, Run.id == target_id).first()
        if run is None:
            return ""
        means = _run_means(db, [run.id]).get(run.id, [])
        return f"Chosen run: {_run_line(run, means)}"
    if kind == "experiment":
        e = (
            db.query(EvalExperiment)
            .filter(EvalExperiment.project_id == project_id, EvalExperiment.id == target_id)
            .first()
        )
        if e is None:
            return ""
        return f"Chosen experiment: {one_line(e.name)[:80]} ({e.status.value.lower() if e.status else 'unknown'})"
    if kind == "dataset":
        ds = (
            db.query(Dataset)
            .filter(Dataset.project_id == project_id, Dataset.id == target_id, Dataset.deleted_at.is_(None))
            .first()
        )
        if ds is None:
            return ""
        versions = (
            db.query(func.count(DatasetVersion.id)).filter(DatasetVersion.dataset_id == ds.id).scalar() or 0
        )
        restricted = "restricted" if ds.access_mode == "restricted" or ds.private_test_set else "open"
        return f"Chosen dataset: {one_line(ds.name)[:80]} ({versions} versions, {restricted})"
    return ""


def build_project_facts(
    db: Session,
    project_id: str,
    target_kind: Optional[str] = None,
    target_id: Optional[str] = None,
    *,
    section: Optional[str] = None,
) -> str:
    """Bounded text block of one project's facts (QE-168). ``section`` returns one part only."""
    project = db.get(Project, project_id)
    if project is None:
        return ""
    runs = _recent_runs(db, project_id, 20)
    means = _run_means(db, [r.id for r in runs[:10]])
    sections: dict[str, list[str]] = {
        "environments": [f"Environments: {', '.join(_env_lines(db, project_id)) or 'none'}"],
        "datasets": ["Datasets:"]
        + [
            f"- {d['name']} ({d['version']}, {d['items']} items, {'restricted' if d['restricted'] else 'open'})"
            for d in _datasets(db, project_id)
        ],
        "metrics": [
            "Metrics seen in the last 20 runs: "
            + (", ".join(sorted({m for r in runs for m in (r.metrics or []) if isinstance(m, str)})[:30]) or "none")
        ],
        "runs": ["Last runs:"] + [f"- {_run_line(r, means.get(r.id, []))}" for r in runs[:10]],
        "experiments": ["Last experiments:"] + [f"- {line}" for line in _experiments(db, project_id)],
    }
    if section in sections:
        return clip("\n".join(sections[section]), PRODUCT_FACTS_MAX_CHARS)
    lines = [f"Project: {one_line(project.name)}"]
    for key in PRODUCT_SECTIONS:
        lines.extend(sections[key])
    target = _target_line(db, project_id, target_kind, target_id)
    if target:
        lines.append(target)
    text = "\n".join(lines)
    if len(text) > PRODUCT_FACTS_MAX_CHARS:
        dropped = len(lines)
        kept, size = [], 0
        for line in lines:
            if size + len(line) + 1 > PRODUCT_FACTS_MAX_CHARS - 20:
                break
            kept.append(line)
            size += len(line) + 1
        text = "\n".join(kept) + f"\n+{dropped - len(kept)} more"
    return text
