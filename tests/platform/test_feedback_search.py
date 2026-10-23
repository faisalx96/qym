"""RequestSearch: lexical, Arabic aware, confirmed requests only, bounded (QE-161)."""

from __future__ import annotations

import time

import pytest

from _feedback_support import make_env
from qym_platform.feedback_agent.text import normalize, tokens


def test_normalisation_unifies_arabic_forms_and_strips_marks():
    assert normalize("أَحْمَد") == normalize("احمد")
    assert normalize("مدرسة") == normalize("مدرسه")
    assert normalize("على") == normalize("علي")
    assert tokens("The PDF-export of Compare!") == ["pdf", "export", "compare"]


@pytest.fixture(params=["sqlite", "postgres"])
def env(request, monkeypatch):
    with make_env(monkeypatch, request.param) as e:
        yield e


def search(env, query, **kw):
    from qym_platform.feedback_agent.search import LexicalRequestSearch

    with env.db() as db:
        return LexicalRequestSearch(db).search(query, **kw)


def test_ranks_title_matches_first_and_ignores_unrelated_requests(env):
    env.confirmed("omar", "Export the compare page as PDF", number=1)
    env.confirmed("omar", "Dark mode for the charts", number=2, business_need="pdf export of chart images")
    env.confirmed("omar", "Weekly digest email", number=3)
    hits = search(env, "pdf export of compare")
    assert [h.number for h in hits][:2] == [1, 2] and 3 not in [h.number for h in hits]
    assert all(0 < h.score <= 1 for h in hits)
    assert search(env, "xyzzy nothing") == []
    assert search(env, "") == []


def test_matches_plural_forms_and_arabic_variants(env):
    env.confirmed("omar", "تصدير النتائج الى ملفات", number=1)
    env.confirmed("omar", "Exports of the result files", number=2)
    assert [h.number for h in search(env, "export file")] == [2]
    assert [h.number for h in search(env, "تصدير النتائج")] == [1]


def test_never_returns_drafts_the_request_itself_and_at_most_eight(env):
    from qym_platform.db.feedback_models import FeedbackRequest

    ids = [env.confirmed("omar", f"Export option number {i}", number=i + 1) for i in range(12)]
    with env.db() as db:
        db.add(FeedbackRequest(subject="platform", status="draft", title="Export draft secret", search_text="export draft secret",
                               submitter_user_id=env.users["sara"], checklist={}, conflicts=[], agent_reasoning={}))
        db.commit()
    hits = search(env, "export option", limit=20, exclude_id=ids[0])
    assert len(hits) == 8
    assert ids[0] not in [h.request_id for h in hits] and all(h.status != "draft" for h in hits)
    assert "secret" not in " ".join(h.title for h in search(env, "export draft secret"))


def test_same_project_requests_rank_first_for_product_feedback(env):
    from qym_platform.db.models import Project

    with env.db() as db:
        db.add(Project(id="p1", name="P1", slug="p1", created_by_user_id=env.users["admin"]))
        db.commit()
    env.confirmed("omar", "Export results", number=1, subject="product", project_id="p1")
    env.confirmed("omar", "Export results to PDF files", number=2, subject="platform")
    hits = search(env, "export results pdf", project_id="p1")
    assert hits[0].number == 1


def test_five_thousand_requests_answer_quickly(env):
    from datetime import datetime

    from qym_platform.db.feedback_models import FeedbackRequest
    from qym_platform.feedback_agent.text import search_text

    now = datetime.utcnow()
    with env.db() as db:
        db.bulk_save_objects(
            [
                FeedbackRequest(
                    number=i + 1, subject="platform", status="new", title=f"Request {i} about topic{i % 50}", summary=f"summary of {i}",
                    business_need="needs", search_text=search_text(f"Request {i} about topic{i % 50}", f"summary of {i}", "needs"),
                    submitter_user_id=env.users["omar"], checklist={}, conflicts=[], agent_reasoning={}, last_activity_at=now,
                    created_at=now, updated_at=now,
                )
                for i in range(5000)
            ]
        )
        db.commit()
    start = time.perf_counter()
    hits = search(env, "request about topic7")
    assert time.perf_counter() - start < 0.2
    assert 0 < len(hits) <= 8
