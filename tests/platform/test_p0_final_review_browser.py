"""Run page, Compare and Models details from the P0 final review (C008, C015,
C009, C001).

- Metric cards keep their badge inside the card when a card has an error note.
- Maximize and undeclared cards say when a failed task counts as 0.
- A lower-is-better scorer error never shows as the best score in a
  collapsed pill, and its score editor opens empty.
- Compare keeps a lower-is-better metric that every run errored on, and pass
  columns name their pass first.
- The run page's Display popover closes on Escape.
- The repeat Performance curve leaves a k without a scored pass empty.
- Models labels the best value of a lower-is-better metric Min@K.
"""

import os
import re

import pytest

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")

from test_minimize_errors_browser import _runs_api  # noqa: E402
from test_models_paging_browser import ModelsFixture  # noqa: E402
from test_performance_views_browser import ViewFixture  # noqa: E402

pytestmark = pytest.mark.browser

NAMES = ["exact", "hallucination_rate", "latency_cost", "verbosity", "judge_quality"]
SPECS = {
    "exact": {"score_type": "boolean", "direction": "maximize", "schema_version": 2},
    "hallucination_rate": {"score_type": "percentage", "direction": "minimize", "schema_version": 2},
    "latency_cost": {"score_type": "number", "direction": "minimize", "schema_version": 2},
    "verbosity": {"score_type": "number", "schema_version": 2},
    "judge_quality": {"score_type": "percentage", "direction": "maximize", "schema_version": 2},
}


def _five_metrics(fixture, repeat=False):
    for data in fixture.data.values():
        data["run"]["metric_names"] = NAMES
        data["snapshot"]["metric_names"] = NAMES
        data["snapshot"]["metric_specs"] = SPECS
        for row in data["snapshot"]["rows"]:
            i = row["index"]
            row["status"], row["error"] = "completed", ""
            row["metric_values"] = [i % 2, (i % 10) / 10, 1.0 + i / 10, 10 + i, 0.5 + (i % 5) / 10]
            row["metric_meta"] = {name: {} for name in NAMES}
            if i in (1, 2):
                row["metric_values"][1] = 0
                row["metric_meta"]["hallucination_rate"] = {"status": "error", "error": "judge 429"}
            if i == 3:
                row["metric_values"][4] = 0
                row["metric_meta"]["judge_quality"] = {"status": "error", "error": "judge 429"}
            if repeat:
                row["pass_scores"] = {
                    "exact": [i % 2, 1, 0],
                    "hallucination_rate": [0.1, 0 if i < 4 else 0.2, 0.0],
                    "latency_cost": [1.0, 1.2, 1.4],
                    "verbosity": [10, 11, 12],
                    "judge_quality": [0 if i == 5 else 0.7, 0.8, 0.9],
                }
                row["pass_metric_meta"] = {name: [{}, {}, {}] for name in NAMES}
                if i < 4:
                    row["pass_metric_meta"]["hallucination_rate"][1] = {"status": "error"}
                    row["pass_metric_meta"]["latency_cost"][2] = {"status": "error"}
                if i == 5:
                    row["pass_metric_meta"]["judge_quality"][0] = {"status": "error"}


BADGE_OVERFLOW = """() => Array.from(document.querySelectorAll('.metric-card')).map(card => {
  const badge = card.querySelector('.metric-card-badge');
  if (!badge) return null;
  return {
    metric: card.querySelector('.metric-card-name')?.innerText,
    note: card.querySelector('.metric-card-error-note')?.innerText || '',
    overflow: badge.getBoundingClientRect().right - card.getBoundingClientRect().right,
  };
}).filter(Boolean)"""


@pytest.mark.parametrize("samples", [1, 3])
@pytest.mark.parametrize("width", [1088, 1248])
def test_metric_card_badges_stay_inside_their_cards(browser, samples, width):
    """1088/1248px is a 1280/1440 screen beside the app sidebar."""
    fixture = ViewFixture(browser, "run", count=24, samples=samples)
    _five_metrics(fixture, repeat=samples > 1)
    try:
        fixture.page.set_viewport_size({"width": width, "height": 1100})
        fixture.goto()
        cards = fixture.page.evaluate(BADGE_OVERFLOW)
        assert any(card["note"] for card in cards)
        assert all(card["overflow"] <= 0.5 for card in cards), cards
        assert fixture.errors == []
    finally:
        fixture.close()


def test_maximize_and_undeclared_cards_say_a_failed_task_counts_as_zero(browser):
    fixture = ViewFixture(browser, "run", count=10)
    for data in fixture.data.values():
        data["snapshot"]["metric_specs"] = {
            "accuracy": {"score_type": "percentage", "direction": "maximize", "schema_version": 2},
            "count": {"score_type": "number", "schema_version": 2},
        }
        for row in data["snapshot"]["rows"]:
            i = row["index"]
            row["status"], row["error"] = "completed", ""
            row["metric_values"] = [0.5 + 0.05 * i, 3 + i]
            row["metric_meta"] = {"accuracy": {}, "count": {}}
            if i == 4:
                row["status"], row["error"] = "error", "task boom"
                row["metric_values"] = ["", ""]
    try:
        fixture.goto()
        page = fixture.page
        def card(name):
            name_cell = page.locator(".metric-card-name", has_text=re.compile("^" + name + "$"))
            return page.locator(".metric-card").filter(has=name_cell).first

        accuracy = card("accuracy")
        assert accuracy.locator(".metric-card-error-note").inner_text().endswith(
            "1 task error · counted as 0%"
        )
        assert accuracy.locator(".metric-card-badge").inner_text() == "9 scored · 1 err"
        zero = accuracy.locator('.dist-chart-col[data-bucket-min="0"]')
        assert "1 task error, counted as 0%" in zero.get_attribute("title")
        count = card("count")
        note = count.locator(".metric-card-error-note")
        assert note.inner_text().endswith("1 task error · counted as 0")
        assert "in Min" in note.get_attribute("title")
        assert fixture.errors == []
    finally:
        fixture.close()


def _item(page, item_id):
    return page.locator(f'#items-grid .item-card[data-item-id="{item_id}"]')


def test_lower_is_better_scorer_error_is_an_error_in_the_pill_and_the_editor(browser):
    """Item c's h scorer error is stored as 0: the collapsed pill read '0.0%'
    in the best-score color, and its editor opened holding that 0."""
    from test_minimize_errors import _classic

    with _runs_api(lambda db: _classic(db, "run-1")) as client:
        fixture = ViewFixture(browser, "run", count=5)
        fixture.api_client = client
        try:
            fixture.goto()
            page = fixture.page
            pill = _item(page, "c").locator(".item-agg-pill").first
            assert pill.locator(".metric-score-name").inner_text() == "h"
            value = pill.locator(".metric-score-value")
            assert value.inner_text() == "Error"
            assert "score-5" not in value.get_attribute("class")

            _item(page, "c").click()
            chip = _item(page, "c").locator(".metric-compare-row").filter(
                has=page.locator(".det-metric", has_text=re.compile("^h$"))
            ).first
            chip.locator(".metric-edit-open").click()
            editor = chip.locator(".metric-edit-input")
            assert editor.input_value() == ""
            assert editor.get_attribute("placeholder") == "Enter a score"
            chip.locator(".metric-edit-save").click()
            assert "Enter a score" in chip.locator(".metric-edit-status").inner_text()
            assert not [entry for entry in fixture.requests if entry[1] == "update"]
            chip.locator(".metric-edit-cancel").click()

            # Sorting by score puts the errored items (c, d, and the task
            # error e) last in both directions, never before the best.
            for order in ("score_asc", "score_desc"):
                page.evaluate(f"() => {{ const s = document.getElementById('sort-select'); s.value = '{order}'; s.dispatchEvent(new Event('change')); }}")
                fixture.settled()
                ids = page.locator("#items-grid .item-card").evaluate_all(
                    "nodes => nodes.map(node => node.dataset.itemId)"
                )
                assert sorted(ids[-3:]) == ["c", "d", "e"], (order, ids)
                assert ids[:2] == (["a", "b"] if order == "score_asc" else ["b", "a"]), (order, ids)
            assert fixture.errors == []
        finally:
            fixture.close()


def test_compare_keeps_a_lower_is_better_metric_every_run_errored_on(browser):
    fixture = ViewFixture(browser, "compare", count=4)
    for data in fixture.data.values():
        data["snapshot"]["metric_specs"] = {
            "accuracy": {"score_type": "percentage", "direction": "minimize", "schema_version": 2},
            "count": {"score_type": "number", "direction": "maximize"},
        }
        for row in data["snapshot"]["rows"]:
            row["status"], row["error"] = "completed", ""
            row["metric_values"][0] = 0
            row["metric_meta"]["accuracy"] = {"status": "error", "error": "judge 429"}
    try:
        fixture.goto()
        row = fixture.page.locator("#metrics-table tr").filter(has_text="accuracy").first
        cells = row.locator("td.metric-value-cell")
        assert cells.count() == 2
        for index in range(2):
            assert cells.nth(index).locator(".metric-val").inner_text() == "—"
            assert cells.nth(index).locator(".metric-error-indicator").inner_text() == "⚠ 4"
        assert fixture.errors == []
    finally:
        fixture.close()


def test_compare_pass_columns_name_their_pass_first(browser):
    from test_minimize_errors import _classic, _repeat

    def seed(db):
        _repeat(db, "run-1")
        _classic(db, "run-2")

    with _runs_api(seed) as client:
        fixture = ViewFixture(browser, "compare", count=5)
        fixture.api_client = client
        try:
            # Pass columns are the "Each pass" view (Run average is the default).
            fixture.goto("&columns=passes")
            headers = fixture.page.locator("#metrics-table th[title]")
            titles = headers.evaluate_all("nodes => nodes.map(node => node.getAttribute('title'))")
            assert [title.split(" · ")[-1] for title in titles if " · pass " in title] == [
                "pass 1",
                "pass 2",
                "pass 3",
            ]
            passes = fixture.page.locator("#metrics-table .metric-run-pass")
            assert [text.strip() for text in passes.all_text_contents()] == ["Pass 1", "Pass 2", "Pass 3"]
            for index in range(3):
                assert passes.nth(index).is_visible()
            assert fixture.errors == []
        finally:
            fixture.close()


def test_display_popover_closes_on_escape(browser):
    fixture = ViewFixture(browser, "run", count=6)
    try:
        fixture.goto()
        page = fixture.page
        button = page.locator("#btn-item-display")
        popover = page.locator("#item-display-pop")
        button.click()
        assert popover.is_visible()
        page.locator("#sort-select").focus()
        page.keyboard.press("Escape")
        assert popover.is_hidden()
        assert button.get_attribute("aria-expanded") == "false"
        assert page.evaluate("document.activeElement.id") == "btn-item-display"
        assert fixture.errors == []
    finally:
        fixture.close()


def test_repeat_curve_leaves_a_k_without_a_scored_pass_empty(browser):
    """Every h pass errored: the band has no average, not 0 (h's best value)."""
    from qym_platform.db.models import (
        Run,
        RunItem,
        RunItemPassScore,
        RunItemScore,
        RunMetricSpec,
        RunWorkflowStatus,
    )

    def seed(db):
        db.add(
            Run(
                id="run-1", project_id="p", created_by_user_id="u", owner_user_id="u",
                task="t", dataset="d", metrics=["h"], samples=2, run_metadata={},
                run_config={}, status=RunWorkflowStatus.COMPLETED,
            )
        )
        db.add(
            RunMetricSpec(
                run_id="run-1", metric_name="h", position=0, schema_version=2,
                score_type="number", direction="minimize",
            )
        )
        for index, item_id in enumerate("ab"):
            db.add(RunItem(run_id="run-1", item_id=item_id, index=index, input="q", output="a"))
            db.add(
                RunItemScore(run_id="run-1", item_id=item_id, metric_name="h", score_numeric=None, meta={})
            )
            for number in (1, 2):
                db.add(
                    RunItemPassScore(
                        run_id="run-1", item_id=item_id, metric_name="h", pass_number=number,
                        score_numeric=0.0, meta={"status": "error"},
                    )
                )
        db.commit()

    with _runs_api(seed) as client:
        fixture = ViewFixture(browser, "run", count=2, samples=2)
        fixture.api_client = client
        try:
            fixture.goto()
            page = fixture.page
            empty = page.locator(".samples-curve-empty")
            empty.wait_for()
            assert "Every pass errored" in empty.inner_text()
            assert page.locator("svg.samples-curve circle").count() == 0
            page.locator('.samples-view-btn[data-view="table"]').click()
            cells = page.locator(".samples-band-table .samples-band-cell-main")
            assert set(cells.all_inner_texts()) == {"—"}
            assert fixture.errors == []
        finally:
            fixture.close()


def test_models_label_the_best_value_of_a_lower_is_better_metric_min(browser):
    fixture = ModelsFixture(browser)
    for row in fixture.rows:
        row["metric_specs"] = {"count": {"score_type": "number", "direction": "minimize", "schema_version": 2}}
    try:
        fixture.open()
        page = fixture.page
        page.locator("#models-metric-select").select_option("count")
        page.wait_for_function("__modelsTest.state.modelsViewState.metricIsNumeric")
        # Labels are shown upper-case.
        labels = [label.upper() for label in page.locator(".model-card .stat-label").all_inner_texts()]
        assert any(label.startswith("MIN@") for label in labels), labels
        assert not any(label.startswith("MAX@") for label in labels), labels
        options = page.evaluate(
            "window.__modelsTest.state.modelsViewState.metricDirection"
        )
        assert options == "minimize"
    finally:
        fixture.close()
