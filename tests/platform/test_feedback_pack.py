"""The generated ``platform`` knowledge pack: not stale, bounded (spec-e section 4.5, QE-D10)."""

from __future__ import annotations

import json

from qym_platform.feedback_agent import knowledge
from qym_platform.feedback_agent.constants import (DOCS_CARD_CHARS,
                                                   PACK_MAX_CHARS)
from qym_platform.tools import build_feedback_pack as builder


def test_the_committed_pack_is_current():
    committed = builder.OUTPUT.read_text(encoding="utf-8")
    assert committed == builder.render(
        builder.build_pack()
    ), "knowledge_platform.json is stale: run python -m qym_platform.tools.build_feedback_pack"
    assert json.loads(committed)["source_sha256"] == builder.source_sha256(builder.REPO)
    assert builder.main(["--check"]) == 0


def test_the_pack_is_bounded_and_cards_are_well_formed():
    pack = knowledge.load_platform_pack()
    assert len(builder.render(pack)) <= PACK_MAX_CHARS
    ids = [c["id"] for c in pack["cards"]]
    assert len(ids) == len(set(ids)) and pack["cards"]
    for card in pack["cards"]:
        assert set(card) == {"id", "title", "source", "text"}
        assert 0 < len(card["text"]) <= DOCS_CARD_CHARS
    assert any(c["source"] == "docs/USER_GUIDE.md" for c in pack["cards"])


def test_index_and_lookup():
    index = knowledge.platform_index()
    assert len(index) <= knowledge.INDEX_MAX_CHARS + 100
    cards = knowledge.lookup_platform_docs("compare runs against a baseline")
    assert 0 < len(cards) <= 3 and all(len(c["text"]) <= DOCS_CARD_CHARS for c in cards)
    first = knowledge.load_platform_pack()["cards"][0]
    assert (
        knowledge.lookup_platform_docs(card_id=first["id"])[0]["card_id"] == first["id"]
    )
    assert knowledge.lookup_platform_docs("") == []
