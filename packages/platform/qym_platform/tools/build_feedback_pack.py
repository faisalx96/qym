"""Build the ``platform`` knowledge pack of the feedback assistant.

    python -m qym_platform.tools.build_feedback_pack          # rewrite knowledge_platform.json
    python -m qym_platform.tools.build_feedback_pack --check  # exit 1 when the committed file is stale

Sources (spec-e section 4.5): ``docs/USER_GUIDE.md``, ``frontend/src/features/docs/partials/platform-guide/*.html``,
``get-started/what-is-qym.html`` and ``get-started/datasets.html``, plus the titles in ``features/docs/ia.json``.
Output: cards ``{id, title, source, text}`` of at most 1,500 characters, the whole file capped at 60,000
characters by source priority, with the ``source_sha256`` of the inputs so ``tests/platform/test_feedback_pack.py``
fails when the committed file is stale.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from qym_platform.feedback_agent.constants import (DOCS_CARD_CHARS,
                                                   PACK_MAX_CHARS)

PACK_VERSION = 1
OUTPUT = (
    Path(__file__).resolve().parents[1] / "feedback_agent" / "knowledge_platform.json"
)
REPO = Path(__file__).resolve().parents[4]
DOCS_PARTIALS = "frontend/src/features/docs/partials"
USER_GUIDE = "docs/USER_GUIDE.md"
IA = "frontend/src/features/docs/ia.json"
CODE_BLOCK_MAX = 400


def source_files(root: Path) -> list[str]:
    """Input paths relative to ``root`` in priority order."""
    guide = sorted(
        str(p.relative_to(root))
        for p in (root / DOCS_PARTIALS / "platform-guide").glob("*.html")
    )
    started = [
        f"{DOCS_PARTIALS}/get-started/what-is-qym.html",
        f"{DOCS_PARTIALS}/get-started/datasets.html",
    ]
    return [USER_GUIDE, *guide, *started]


def source_sha256(root: Path) -> str:
    digest = hashlib.sha256()
    for rel in [*source_files(root), IA]:
        digest.update(rel.encode("utf-8") + b"\0")
        digest.update((root / rel).read_bytes() + b"\0")
    return digest.hexdigest()


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "section"


class _Html(HTMLParser):
    """HTML to ``[(heading_or_None, level, paragraph_text)]`` in reading order."""

    BLOCK = {
        "p",
        "li",
        "tr",
        "div",
        "section",
        "ul",
        "ol",
        "table",
        "blockquote",
        "br",
        "dd",
        "dt",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.items: list[tuple[str, int, str]] = []  # (kind, level, text) kind: h | p
        self._buf: list[str] = []
        self._heading = 0
        self._skip = 0
        self._pre = 0
        self._cell_sep = False

    def _flush(self, kind: str = "p", level: int = 0) -> None:
        text = re.sub(r"[ \t\r\f\v]+", " ", "".join(self._buf)).strip()
        self._buf = []
        if text:
            self.items.append((kind, level, text))

    def handle_starttag(self, tag: str, attrs: list) -> None:  # noqa: ANN001
        if tag in ("script", "style"):
            self._skip += 1
        elif tag in ("h1", "h2", "h3"):
            self._flush()
            self._heading = int(tag[1])
        elif tag == "pre":
            self._flush()
            self._pre += 1
        elif tag in self.BLOCK:
            self._flush()
        elif tag in ("td", "th"):
            self._buf.append(" | ")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            self._skip = max(0, self._skip - 1)
        elif tag in ("h1", "h2", "h3"):
            self._flush("h", self._heading)
            self._heading = 0
        elif tag == "pre":
            text = "".join(self._buf).strip()
            self._buf = []
            self._pre = max(0, self._pre - 1)
            if text and len(text) <= CODE_BLOCK_MAX:
                self.items.append(("p", 0, re.sub(r"\s+", " ", text)))
        elif tag in self.BLOCK:
            self._flush()

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self._buf.append(data)


def _html_sections(raw: str) -> list[tuple[str, list[str]]]:
    parser = _Html()
    parser.feed(raw)
    parser._flush()
    sections: list[tuple[str, list[str]]] = []
    title, paras = "", []
    for kind, level, text in parser.items:
        if kind == "p" and text.isupper() and len(text) <= 40:
            continue  # the page eyebrow ("PLATFORM GUIDE")
        if kind == "h":
            if level == 1 and not title and not paras:
                title = text
                continue
            if paras or title:
                sections.append((title, paras))
            title, paras = text, []
        else:
            paras.append(html.unescape(text))
    if paras or title:
        sections.append((title, paras))
    return sections


def _md_sections(raw: str) -> list[tuple[str, list[str]]]:
    sections: list[tuple[str, list[str]]] = []
    title, paras, current = "", [], []
    fence: list[str] | None = None

    def end_paragraph() -> None:
        if current:
            paras.append(re.sub(r"\s+", " ", " ".join(current)).strip())
            current.clear()

    for line in raw.splitlines():
        if line.strip().startswith("```"):
            if fence is None:
                end_paragraph()
                fence = []
            else:
                block = "\n".join(fence).strip()
                if block and len(block) <= CODE_BLOCK_MAX:
                    paras.append(re.sub(r"\s+", " ", block))
                fence = None
            continue
        if fence is not None:
            fence.append(line)
            continue
        m = re.match(r"^(#{1,3})\s+(.*)$", line)
        if m:
            end_paragraph()
            if len(m.group(1)) == 1 and not title and not paras:
                title = m.group(2).strip()
                continue
            if paras or title:
                sections.append((title, paras[:]))
            title, paras = m.group(2).strip(), []
            continue
        if not line.strip():
            end_paragraph()
        else:
            current.append(line.strip())
    end_paragraph()
    if paras or title:
        sections.append((title, paras))
    return sections


def _cards(source: str, sections: list[tuple[str, list[str]]]) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    seen: dict[str, int] = {}
    for title, paras in sections:
        title = title or Path(source).stem.replace("-", " ").title()
        if not paras:
            continue
        base = slug(f"{Path(source).stem}-{title}")
        chunks: list[str] = []
        room = DOCS_CARD_CHARS - len(title) - 2
        cur = ""
        for para in paras:
            while (
                len(para) > room
            ):  # split a very long paragraph at a sentence or space
                cut = para.rfind(". ", 0, room)
                cut = cut if cut > room // 2 else para.rfind(" ", 0, room)
                cut = cut if cut > 0 else room
                piece, para = para[: cut + 1].strip(), para[cut + 1 :].strip()
                if cur:
                    chunks.append(cur)
                    cur = ""
                chunks.append(piece)
            if len(cur) + len(para) + 1 > room and cur:
                chunks.append(cur)
                cur = para
            else:
                cur = f"{cur} {para}".strip()
        if cur:
            chunks.append(cur)
        for i, chunk in enumerate(chunks):
            card_id = base if i == 0 else f"{base}-{i + 1}"
            n = seen.get(card_id, 0)
            seen[card_id] = n + 1
            if n:
                card_id = f"{card_id}-{n + 1}"
            cards.append(
                {
                    "id": card_id,
                    "title": title,
                    "source": source,
                    "text": f"{title}: {chunk}",
                }
            )
    return cards


def build_pack(root: Path = REPO) -> dict[str, Any]:
    cards: list[dict[str, Any]] = []
    for rel in source_files(root):
        raw = (root / rel).read_text(encoding="utf-8")
        sections = _md_sections(raw) if rel.endswith(".md") else _html_sections(raw)
        cards.extend(_cards(rel, sections))
    ia = json.loads((root / IA).read_text(encoding="utf-8"))
    titles = [
        {"section": s.get("title", ""), "page": p.get("title", "")}
        for s in ia.get("sections", [])
        for p in s.get("pages", [])
    ]
    pack: dict[str, Any] = {
        "version": PACK_VERSION,
        "subject": "platform",
        "source_sha256": source_sha256(root),
        "doc_titles": titles,
        "cards": [],
    }
    # Priority order; cards beyond the cap are dropped so the whole file stays within it.
    for card in cards:
        pack["cards"].append(card)
        if len(render(pack)) > PACK_MAX_CHARS:
            pack["cards"].pop()
    return pack


def render(pack: dict[str, Any]) -> str:
    return json.dumps(pack, ensure_ascii=False, separators=(",", ":")) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true", help="fail when the committed pack is stale"
    )
    parser.add_argument("--root", default=str(REPO), help="repository root")
    args = parser.parse_args(argv)
    pack = build_pack(Path(args.root))
    text = render(pack)
    if args.check:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != text:
            print(
                "knowledge_platform.json is stale: run python -m qym_platform.tools.build_feedback_pack",
                file=sys.stderr,
            )
            return 1
        return 0
    OUTPUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUTPUT} ({len(pack['cards'])} cards, {len(text)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
