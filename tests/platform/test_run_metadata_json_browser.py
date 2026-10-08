"""Run metadata that holds JSON opens in the shared JSON viewer.

Objects, arrays and strings holding JSON show a compact preview in the run
summary; clicking it opens a collapsible, syntax-colored tree with expand /
collapse all and copy. Scalars keep their plain text cell.
"""

from __future__ import annotations

import json

from test_performance_views_browser import ViewFixture

METADATA = {
    "prompt_version": "v7",
    "retrieval": {
        "top_k": 5,
        "rerank": True,
        "filters": {"lang": ["ar", "en"], "since": None},
        "index": "docs-2026",
    },
    "tags": ["nightly", "baseline"],
    "pipeline_json": json.dumps({"stages": [{"name": "plan"}, {"name": "act"}]}),
    "not_json": "{broken",
    "empty_obj": {},
}


def open_run(browser):
    view = ViewFixture(browser, "run", count=4)
    view.data["run-1"]["run"]["metadata"] = METADATA
    view.goto()
    view.page.wait_for_selector("#run-summary .context-cell")
    return view


def cell(page, label):
    return page.locator("#run-summary .context-cell").filter(
        has=page.locator(".context-cell-key", has_text=label)
    )


def test_structured_metadata_shows_a_preview_and_scalars_stay_plain(browser):
    view = open_run(browser)
    try:
        page = view.page
        previews = page.locator("#run-summary .qjv-preview")
        assert previews.count() == 3  # retrieval, tags, pipeline_json

        retrieval = cell(page, "Retrieval").locator(".qjv-preview")
        assert retrieval.locator(".qjv-preview__count").inner_text() == "4 keys"
        assert '"top_k":5' in retrieval.locator(".qjv-preview__text").inner_text()
        assert (
            cell(page, "Tags").locator(".qjv-preview__count").inner_text() == "2 items"
        )
        assert cell(page, "Pipeline Json").locator(".qjv-preview").count() == 1

        # Scalars, invalid JSON and empty containers keep the plain text cell.
        assert cell(page, "Prompt Version").locator(".qjv-preview").count() == 0
        assert cell(page, "Prompt Version").locator(".context-cell-val").inner_text() == "v7"
        assert cell(page, "Not Json").locator(".context-cell-val").inner_text() == "{broken"
        assert cell(page, "Empty Obj").locator(".context-cell-val").inner_text() == "{}"
    finally:
        view.close()


def test_preview_opens_a_collapsible_tree_with_copy(browser):
    view = open_run(browser)
    try:
        page = view.page
        trigger = cell(page, "Retrieval").locator(".qjv-preview")
        trigger.click()
        modal = page.locator(".qjv-modal")
        modal.wait_for()
        assert modal.get_attribute("role") == "dialog"
        assert modal.locator(".qjv-modal__title").inner_text() == "Retrieval"
        assert modal.locator(".qjv-modal__meta").inner_text() == "4 keys"

        tree = modal.locator(".qjv-tree")
        # Syntax roles are colored by class.
        assert tree.locator(".qjv-key", has_text='"top_k"').count() == 1
        assert tree.locator(".qjv-number", has_text="5").count() == 1
        assert tree.locator(".qjv-boolean", has_text="true").count() == 1
        assert tree.locator(".qjv-string", has_text='"docs-2026"').count() == 1

        # Two levels open by default; deeper nodes start collapsed and lazy.
        filters = tree.locator(".qjv-node", has=page.locator(":scope > .qjv-line > .qjv-key", has_text='"filters"'))
        assert filters.get_attribute("aria-expanded") == "true"
        lang = filters.locator(".qjv-node", has=page.locator(":scope > .qjv-line > .qjv-key", has_text='"lang"')).first
        assert lang.get_attribute("aria-expanded") == "false"
        assert lang.locator(".qjv-string").count() == 0
        lang.locator(":scope > .qjv-line > .qjv-toggle").click()
        assert lang.get_attribute("aria-expanded") == "true"
        assert lang.locator(".qjv-string", has_text='"ar"').is_visible()
        assert filters.locator(".qjv-null", has_text="null").is_visible()

        # Collapse all keeps the root open but folds every child.
        modal.locator("[data-qjv-collapse]").click()
        assert filters.get_attribute("aria-expanded") == "false"
        assert not lang.is_visible()
        modal.locator("[data-qjv-expand]").click()
        assert lang.locator(".qjv-string", has_text='"en"').is_visible()

        # The test origin is not a secure context: copy uses the textarea
        # fallback, so record what it hands to execCommand.
        page.evaluate(
            """() => {
              document.execCommand = (cmd) => {
                window.__copied = document.body.lastElementChild.value;
                return true;
              };
            }"""
        )
        modal.locator("[data-qjv-copy]").click()
        page.wait_for_function(
            "() => document.querySelector('[data-qjv-copy]').classList.contains('copied')"
        )
        copied = page.evaluate("() => window.__copied")
        assert json.loads(copied) == METADATA["retrieval"]

        # Escape closes it and returns focus to the preview.
        page.keyboard.press("Escape")
        modal.wait_for(state="detached")
        assert page.evaluate(
            "() => document.activeElement && document.activeElement.classList.contains('qjv-preview')"
        )

        # A string holding JSON opens parsed.
        cell(page, "Pipeline Json").locator(".qjv-preview").click()
        modal.wait_for()
        modal.locator("[data-qjv-expand]").click()
        assert modal.locator(".qjv-string", has_text='"plan"').is_visible()
        modal.locator("[data-qjv-close]").click()
        modal.wait_for(state="detached")
    finally:
        view.close()


def test_run_export_inlines_the_json_viewer():
    from test_performance_views_browser import source_run_api

    with source_run_api(count=2) as client:
        response = client.get("/api/runs/run-1/export-html")
    assert response.status_code == 200, response.text
    html = response.text
    assert "window.QymJsonViewer = {" in html
    assert ".qjv-tree {" in html
    assert "/static/json_viewer.js" not in html
    assert "/static/json_viewer.css" not in html
