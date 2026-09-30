"""Static guards for the dashboard's one HTML-escaping layer (C006) and run text (C013).

These fail on the patterns that produced stored XSS: escape helpers built on the
textContent -> innerHTML trick (quotes survive, so attributes break), helpers
that skip quote characters, stored names interpolated into HTML templates
without escaping, and the regex "markdown" renderer that rewrote run outputs.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD_DIR = ROOT / "packages/platform/qym_platform/_static/dashboard"
SAFE_JS = DASHBOARD_DIR / "qym_safe.js"
RUNS_API = ROOT / "packages/platform/qym_platform/api/runs.py"
SKIP = {"codemirror-bundle.js", "docs-hljs.min.js"}


def sources():
    for path in sorted(DASHBOARD_DIR.iterdir()):
        if path.suffix in {".js", ".html"} and path.name not in SKIP:
            yield path, path.read_text(encoding="utf-8")


def inline_scripts(path: Path, text: str):
    """(code, first line) for a .js file or each inline <script> of a page."""
    if path.suffix == ".js":
        yield text, 1
        return
    for match in re.finditer(r"<script(\s[^>]*)?>(.*?)</script>", text, re.S):
        if match.group(1) and "src=" in match.group(1):
            continue
        yield match.group(2), text[: match.start(2)].count("\n") + 1


_REGEX_PREV = set("(,=:[!&|?{};+-*%<>~^")
_REGEX_WORDS = {
    "return",
    "typeof",
    "case",
    "do",
    "else",
    "in",
    "of",
    "void",
    "yield",
    "await",
    "delete",
    "new",
    "instanceof",
}


def template_literals(code: str):
    """Yield (line, static parts, expressions) for every JS template literal.

    A small tokenizer: it skips strings, comments and regex literals, and
    follows nested templates inside ${...}. On these files it finds exactly
    the template literals a real JS parser finds.
    """
    n = len(code)
    found = []

    def previous_token(pos):
        j = pos - 1
        while j >= 0 and code[j] in " \t\r\n":
            j -= 1
        if j < 0:
            return "", ""
        k = j
        while k >= 0 and (code[k].isalnum() or code[k] in "_$"):
            k -= 1
        return code[j], code[k + 1 : j + 1]

    def skip_string(pos, quote):
        pos += 1
        while pos < n and code[pos] not in (quote, "\n"):
            pos += 2 if code[pos] == "\\" else 1
        return pos + 1

    def skip_regex(pos):
        pos += 1
        in_class = False
        while pos < n and code[pos] != "\n":
            char = code[pos]
            if char == "\\":
                pos += 2
                continue
            if in_class:
                in_class = char != "]"
            elif char == "[":
                in_class = True
            elif char == "/":
                pos += 1
                while pos < n and code[pos].isalpha():
                    pos += 1
                return pos
            pos += 1
        return pos

    def scan_code(pos, until_brace):
        depth = 0
        while pos < n:
            char = code[pos]
            if char in "'\"":
                pos = skip_string(pos, char)
            elif char == "`":
                pos = scan_template(pos)
            elif code.startswith("//", pos):
                end = code.find("\n", pos)
                pos = n if end < 0 else end
            elif code.startswith("/*", pos):
                end = code.find("*/", pos + 2)
                pos = n if end < 0 else end + 2
            elif char == "/" and (
                previous_token(pos)[0] in _REGEX_PREV | {""}
                or previous_token(pos)[1] in _REGEX_WORDS
            ):
                pos = skip_regex(pos)
            else:
                if char == "{":
                    depth += 1
                elif char == "}":
                    if depth == 0 and until_brace:
                        return pos
                    depth -= 1
                pos += 1
        return pos

    def scan_template(pos):
        start = pos
        pos += 1
        quasis, exprs, buf = [], [], []
        while pos < n:
            char = code[pos]
            if char == "\\":
                buf.append(code[pos : pos + 2])
                pos += 2
            elif char == "`":
                quasis.append("".join(buf))
                found.append((code.count("\n", 0, start), quasis, exprs))
                return pos + 1
            elif code.startswith("${", pos):
                quasis.append("".join(buf))
                buf = []
                end = scan_code(pos + 2, True)
                exprs.append(code[pos + 2 : end].strip())
                pos = end + 1
            else:
                buf.append(char)
                pos += 1
        return pos

    scan_code(0, False)
    return found


def test_shared_helper_escapes_all_five_characters():
    source = SAFE_JS.read_text(encoding="utf-8")
    escapes = re.search(r"var ESCAPES = (\{.*?\});", source).group(1)
    for char, entity in (
        ("&", "&amp;"),
        ("<", "&lt;"),
        (">", "&gt;"),
        ('"', "&quot;"),
        ("'", "&#39;"),
    ):
        assert entity in escapes, f"qym_safe.js must escape {char}"
    assert "replace(/[&<>\"']/g" in source
    assert "global.QymSafe = {" in source


def test_every_page_loads_the_shared_helper_before_any_other_script():
    pages = [path for path in DASHBOARD_DIR.glob("*.html")]
    assert pages
    for page in pages:
        text = page.read_text(encoding="utf-8")
        scripts = re.findall(r'<script[^>]*\ssrc="([^"]+)"', text)
        assert scripts, page.name
        assert re.search(
            r"/static/qym_safe\.js\?v=[^\"]+$", scripts[0]
        ), f"{page.name} must load qym_safe.js first, got {scripts[0]}"
    not_found_page = RUNS_API.read_text(encoding="utf-8").split(
        "def _project_not_found_page", 1
    )[1]
    assert not_found_page.index("qym_safe.js") < not_found_page.index("shell.js")


def test_self_contained_exports_inline_the_shared_helper():
    runs = RUNS_API.read_text(encoding="utf-8")
    assert (
        'safe_js = (dashboard_dir / "qym_safe.js").read_text(encoding="utf-8")' in runs
    )
    assert r'<script\s+src="/static/qym_safe\.js(?:\?[^"]*)?"></script>' in runs
    compare = (DASHBOARD_DIR / "compare.html").read_text(encoding="utf-8")
    assert r"static\/(?:qym_safe|metrics|trace_viewer|ui_components)\.js" in compare


def test_no_escape_helper_uses_the_textcontent_innerhtml_trick():
    trick = re.compile(
        r"\.textContent\s*=\s*[^;\n]+;\s*(?:\n\s*)?return\s+\w+\.innerHTML", re.S
    )
    offenders = [path.name for path, text in sources() if trick.search(text)]
    assert (
        not offenders
    ), f"quote-unsafe textContent->innerHTML escape helpers: {offenders}"


HELPER_DEF = re.compile(
    r"function\s+(escapeHtml|escapeAttr|esc|_esc|_escAttr|escHtml)\s*\([^)]*\)\s*\{(.*?)\n?\s*\}"
    r"|const\s+(esc|escapeHtml|escapeAttr)\s*=\s*\([^)]*\)\s*=>\s*([^;]+);",
    re.S,
)


def test_local_escape_helpers_delegate_to_the_shared_helper():
    helpers = 0
    for path, text in sources():
        if path == SAFE_JS:
            continue
        for match in HELPER_DEF.finditer(text):
            name = match.group(1) or match.group(3)
            body = match.group(2) if match.group(1) else match.group(4)
            helpers += 1
            delegates = "QymSafe.escapeHtml(" in body or re.fullmatch(
                r"\s*return escapeHtml\(\w+\);\s*", body
            )
            assert (
                delegates
            ), f"{path.name}: {name}() must delegate to QymSafe.escapeHtml"
    assert helpers >= 18


def test_no_hand_rolled_entity_replacement_chains():
    allowed = {
        # Char-for-char JSON highlighter behind an editable overlay; text context only.
        ("datasets.html", "function highlightJSONHtml"),
    }
    offenders = []
    for path, text in sources():
        if path == SAFE_JS:
            continue
        for match in re.finditer(r"\.replace\(/&/g,\s*['\"]&amp;['\"]\)", text):
            window = text[max(0, match.start() - 300) : match.start()]
            if any(path.name == name and marker in window for name, marker in allowed):
                continue
            offenders.append(f"{path.name}:{text.count(chr(10), 0, match.start()) + 1}")
    assert not offenders, f"escape through QymSafe.escapeHtml instead: {offenders}"


# Stored, user- or SDK-controlled values. Interpolating one of these bare into
# an HTML template is exactly the runs-table/charts stored XSS (C006).
DATA_FIELD = re.compile(
    r"(?:^|\.)(?:run_name|model_name|dataset_name|task_name|display_name|email|"
    r"external_run_id|git_branch|git_commit|file_path|dataset|model|task|metric|"
    r"metricName|taskName|datasetName|modelName|runName|name|comment|description|"
    r"category|slug|item_id|itemId|run_id)$"
)
BARE = re.compile(r"^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*$")


def test_html_templates_never_interpolate_stored_names_raw():
    offenders = []
    for path, text in sources():
        for code, first_line in inline_scripts(path, text):
            for line, quasis, exprs in template_literals(code):
                if not re.search(r"</?[a-zA-Z]", "\x00".join(quasis)):
                    continue
                for expr in exprs:
                    if BARE.match(expr) and DATA_FIELD.search(expr):
                        offenders.append(f"{path.name}:{first_line + line} ${{{expr}}}")
    assert not offenders, "escape stored names with escapeHtml()/QymSafe: " + ", ".join(
        offenders
    )


def test_attribute_selectors_escape_stored_ids():
    # A quote in an SDK-supplied id must not make querySelector throw.
    raw_selector = re.compile(
        r"querySelector(?:All)?\(\s*(['\"])[^'\"\n]*=\"\1\s*\+\s*(" + BARE.pattern[1:-1] + r")\s*\+"
    )
    offenders = []
    for path, text in sources():
        for match in raw_selector.finditer(text):
            if DATA_FIELD.search(match.group(2)):
                line = text.count("\n", 0, match.start()) + 1
                offenders.append(f"{path.name}:{line} {match.group(2)}")
    assert not offenders, "wrap stored ids in CSS.escape(): " + ", ".join(offenders)


def test_template_scanner_sees_nested_templates_strings_and_regexes():
    code = r"""
      const re = /`not a template`/g; // `nor this`
      const s = '`nor ${this}`';
      el.innerHTML = `<b>${run.model_name}</b>${ok ? `<i>${d.dataset}</i>` : ''}`;
    """
    found = template_literals(code)
    exprs = sorted(expr for _, _, exprs in found for expr in exprs)
    assert exprs == sorted(
        ["run.model_name", "ok ? `<i>${d.dataset}</i>` : ''", "d.dataset"]
    )


def test_runs_table_names_are_escaped():
    dashboard = (DASHBOARD_DIR / "dashboard.js").read_text(encoding="utf-8")
    truncate = dashboard.split("function truncateText(", 1)[1].split("\n  }\n", 1)[0]
    assert "return escapeHtml(" in truncate


def test_run_text_uses_the_shared_renderer_not_regex_markdown():
    for name in ("run.html", "compare.html"):
        source = (DASHBOARD_DIR / name).read_text(encoding="utf-8")
        renderer = source.split("function renderMarkdownSafe(value) {", 1)[1].split(
            "\n      }\n", 1
        )[0]
        assert "QymSafe.textBlock(str" in renderer, name
        for banned in ("<em>$1</em>", "<strong>$1</strong>", 'href="$2"'):
            assert (
                banned not in source
            ), f"{name} still has the regex markdown renderer ({banned})"
        assert (
            'id="item-text-mode"' in source
        ), f"{name} needs the Raw / Rendered switch"
        assert (
            'data-qym-text-mode="raw" aria-pressed="true"' in source
        ), f"{name} must default to Raw"
        assert "QymSafe.bindTextModeToggle(el('item-text-mode')" in source, name
    safe = SAFE_JS.read_text(encoding="utf-8")
    # Rendered links are http(s) only and every attribute value is escaped.
    assert "/^https?:\\/\\//i.test(m[3]) ? safeUrl(m[3]) : ''" in safe
    assert '\'<a class="qym-text__link" href="\' + escapeHtml(href) + \'"' in safe
    # Code and SQL are shown as stored even in Rendered mode.
    assert (
        "(mode === 'rendered' && !code) ? renderMarkdown(value) : escapeHtml(value)"
        in safe
    )


def test_run_text_recipe_follows_the_design_language():
    components = (DASHBOARD_DIR / "ui_components.css").read_text(encoding="utf-8")
    recipe = components.split("/* Run text (QymSafe.textBlock)", 1)[1].split(
        "/* Grouped outputs", 1
    )[0]
    assert "white-space: pre-wrap;" in recipe
    assert ".qym-text--prose { font-family: var(--font-sans); }" in recipe
    assert ".qym-text--code { font-family: var(--font-mono); }" in recipe
    assert "font-size" not in recipe
