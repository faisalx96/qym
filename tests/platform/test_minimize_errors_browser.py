"""Lower-is-better metrics leave errors out of the mean on every page (C015
amended, C008): the runs list, the run page and Compare say how many were
left out, and no errored item reads as a pass or as the best score."""

import os
from contextlib import contextmanager

import pytest

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")

from test_dashboard_paging_browser import DashboardFixture, make_runs  # noqa: E402
from test_performance_views_browser import ViewFixture  # noqa: E402

pytestmark = pytest.mark.browser

MINIMIZE = {
    "accuracy": {"score_type": "boolean", "direction": "minimize", "schema_version": 2},
    "count": {"score_type": "number", "direction": "maximize"},
}


def test_runs_list_says_errors_are_not_counted_in_a_lower_is_better_mean(browser):
    rows = make_runs(2)
    rows[0].update(
        metric_averages={"accuracy": 0.25},
        metric_specs={
            "accuracy": {
                "score_type": "percentage",
                "direction": "minimize",
                "schema_version": 2,
            }
        },
        task_error_count=1,
        metric_error_count=2,
        metric_error_counts={"accuracy": 2},
        execution_error_count=3,
    )
    fixture = DashboardFixture(browser, runs=rows)
    page = fixture.page
    try:
        page.goto("https://qym.test/projects/demo")
        page.wait_for_function("__dashboardTest.state.flatRuns.length === 2")
        warning = page.locator('tr[data-file="run-000"] .metric-error-indicator')
        assert warning.inner_text() == "⚠"
        label = warning.get_attribute("aria-label")
        # Scorer errors are per metric; task errors are the run's (a failed
        # task a reviewer scored counts), so the note does not sum them.
        assert label == (
            "2 scorer errors are not counted in the accuracy mean (lower is better). "
            "The run also has 1 task error, left out too unless a reviewer scored them."
        )
        assert "counted as 0%" not in label and "Mean without" not in label
        warning.click()
        dialog = page.get_by_role("dialog")
        text = dialog.inner_text()
        assert "Errors are not counted in the accuracy mean." in text
        assert "Task errors in the run\n1" in text
        assert "count as fails in pass rates" in text
        assert "counts as 0%" not in text
    finally:
        fixture.close()


def _errors_in_run_one(fixture):
    """accuracy is lower-is-better. run-1: items 1, 2 scorer errors stored as
    False (0), item 4 a task error; run-2 has no errors."""
    for data in fixture.data.values():
        data["snapshot"]["metric_specs"] = MINIMIZE
        for row in data["snapshot"]["rows"]:
            row["status"], row["error"] = "completed", ""
            row["metric_meta"]["accuracy"] = {}
    for row in fixture.data["run-1"]["snapshot"]["rows"]:
        i = row["index"]
        if i in (1, 2):
            row["metric_values"][0] = 0
            row["metric_meta"]["accuracy"] = {"status": "error", "error": "judge 429"}
        if i == 4:
            row["status"], row["error"] = "error", "task boom"
            row["metric_values"][0] = ""


def test_compare_leaves_errors_out_and_never_counts_them_as_passes(browser):
    fixture = ViewFixture(browser, "compare", count=10)
    _errors_in_run_one(fixture)
    try:
        fixture.goto()
        page = fixture.page
        row = page.locator("#metrics-table tr").filter(has_text="accuracy").first
        cells = row.locator("td.metric-value-cell")
        # run-1 without its 3 errors: items 0, 3, 5..9 -> True on 3, 5, 7, 9.
        assert cells.nth(0).locator(".metric-val").inner_text() == "57.1%"
        indicator = cells.nth(0).locator(".metric-error-indicator")
        assert indicator.inner_text() == "⚠ 3"
        assert "not counted in the accuracy mean" in indicator.get_attribute("title")
        assert cells.nth(1).locator(".metric-error-indicator").count() == 0
        assert cells.nth(1).locator(".metric-val").inner_text() == "50.0%"

        def filtered(item_filter):
            return sorted(page.evaluate(f"""() => {{
                      __viewTest.state.itemFilter = '{item_filter}';
                      return __viewTest.getFilteredItems().map(item =>
                        item.rowData.find(Boolean).index);
                    }}"""))

        # Items 2 and 4 pass (False) only on run-2: run-1's errors fail. When
        # an error counted as 0 (False) both runs passed them, and item 1
        # was a unique solve for run-1.
        assert filtered("all_correct") == [0, 6, 8]
        assert filtered("unique_solve") == [2, 4]
        stats = page.evaluate("__viewTest.state.comparisonStats.accuracy")
        assert stats["correctDistribution"] == [5, 2, 3]
        assert fixture.errors == []
    finally:
        fixture.close()


def test_run_page_histogram_keeps_errors_out_of_the_best_bucket(browser):
    fixture = ViewFixture(browser, "run", count=10)
    specs = {
        "accuracy": {
            "score_type": "percentage",
            "direction": "minimize",
            "schema_version": 2,
        },
        "count": {"score_type": "number", "direction": "maximize"},
    }
    for data in fixture.data.values():
        data["snapshot"]["metric_specs"] = specs
        for row in data["snapshot"]["rows"]:
            i = row["index"]
            row["status"], row["error"] = "completed", ""
            row["metric_values"][0] = 0.55
            row["metric_meta"]["accuracy"] = {}
            if i in (1, 2, 3):
                row["metric_values"][0] = 0
                row["metric_meta"]["accuracy"] = {
                    "status": "error",
                    "error": "judge 429",
                }
    try:
        fixture.goto()
        page = fixture.page
        card = (
            page.locator(".metric-card").filter(has=page.locator(".dist-chart")).first
        )
        assert card.locator(".metric-card-value").inner_text() == "55.0%"
        assert (
            card.locator(".metric-card-error-note")
            .inner_text()
            .endswith("3 errors · not counted in the mean")
        )
        # The 0% bucket (the best for this metric) holds no errored item.
        best = card.locator('.dist-chart-col[data-bucket-min="0"]')
        assert best.locator(".bar-count").inner_text() == ""
        assert card.locator(".bar-fill-errors").count() == 0
        assert "7 scored · 3 err" in card.locator(".metric-card-badge").inner_text()
        assert fixture.errors == []
    finally:
        fixture.close()


def test_run_page_keeps_a_lower_is_better_card_when_every_item_errored(browser):
    fixture = ViewFixture(browser, "run", count=4)
    specs = {
        "accuracy": {
            "score_type": "percentage",
            "direction": "minimize",
            "schema_version": 2,
        },
        "count": {"score_type": "number", "direction": "maximize"},
    }
    for data in fixture.data.values():
        data["snapshot"]["metric_specs"] = specs
        for row in data["snapshot"]["rows"]:
            row["status"], row["error"] = "completed", ""
            row["metric_values"][0] = 0
            row["metric_meta"]["accuracy"] = {"status": "error", "error": "judge 429"}
    try:
        fixture.goto()
        card = fixture.page.locator(".metric-card").filter(has_text="accuracy").first
        assert card.locator(".metric-card-value").inner_text() == "—"
        assert (
            card.locator(".metric-card-error-note")
            .inner_text()
            .endswith("4 errors · not counted in the mean")
        )
        assert fixture.errors == []
    finally:
        fixture.close()


@contextmanager
def _runs_api(seed):
    """The real runs API over the source rows ``seed(db)`` adds."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from qym_platform.api.runs import router
    from qym_platform.auth import Principal, require_ui_principal
    from qym_platform.db.models import Base, Project, User, UserRole
    from qym_platform.deps import get_db
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from sqlalchemy.pool import StaticPool

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        user = User(
            id="u",
            email="owner@example.test",
            display_name="Owner",
            role=UserRole.ADMIN,
        )
        db.add(user)
        db.flush()
        db.add(Project(id="p", name="Project", slug="demo", created_by_user_id="u"))
        db.commit()
        seed(db)
        db.expunge(user)
    app = FastAPI()
    app.include_router(router)

    def session():
        with Session(engine, autoflush=False) as db:
            yield db

    app.dependency_overrides[get_db] = session
    app.dependency_overrides[require_ui_principal] = lambda: Principal(
        user=user, auth_type="local_password"
    )
    try:
        with TestClient(app) as client:
            yield client
    finally:
        engine.dispose()


def test_run_page_pass_distribution_filter_counts_errored_passes_as_fails(browser):
    """Each bar of the repeat pass distribution filters the items the server
    counted in it: an errored pass of the lower-is-better h never passes."""
    from test_minimize_errors import _repeat

    with _runs_api(lambda db: _repeat(db, "run-1")) as client:
        fixture = ViewFixture(browser, "run", count=4, samples=3)
        fixture.api_client = client
        try:
            fixture.goto()
            page = fixture.page
            bars = page.locator(".samples-correct-col")
            bars.first.wait_for()
            # h passes at <= 30%: a 1 of 3 (its scorer error fails), b 2 of 3
            # (its task error fails), c none, d 2 of 3 (/group-metrics).
            assert [
                bars.nth(index).get_attribute("aria-label").split(".")[0]
                for index in range(bars.count())
            ] == [
                "0 of 3 attempts passed: 1 items",
                "1 of 3 attempts passed: 1 items",
                "2 of 3 attempts passed: 2 items",
                "3 of 3 attempts passed: 0 items",
            ]
            filtered = {}
            for index in range(bars.count()):
                bars.nth(index).click()
                fixture.settled()
                filtered[index] = sorted(
                    page.evaluate(
                        "__viewTest.getFilteredItems()"
                        ".map(item => item.itemId || item.row.item_id)"
                    )
                )
            assert filtered == {0: ["c"], 1: ["a"], 2: ["b", "d"], 3: []}
        finally:
            fixture.close()


def _percent(text):
    # "33.3%", or a plain number where the runs' specs differ (Compare then
    # shows the metric neutrally).
    text = text.strip()
    return float(text[:-1]) / 100 if text.endswith("%") else float(text)


def _approx(values):
    return {key: pytest.approx(value, abs=5e-4) for key, value in values.items()}


def _listed_means(client):
    listed = client.get("/api/runs", params={"project_slug": "demo"}).json()
    return {
        row["run_id"]: row["metric_averages"]
        for models in listed["tasks"].values()
        for rows in models.values()
        for row in rows
    }


def _run_page_means(fixture):
    fixture.goto()
    cards = fixture.page.evaluate(
        """() => Object.fromEntries(Array.from(
          document.querySelectorAll('.metric-card'),
          card => [card.querySelector('.metric-card-name')?.textContent,
                   card.querySelector('.metric-card-value')?.textContent],
        ).filter(([name]) => name))"""
    )
    return {name: _percent(value) for name, value in cards.items()}


def test_runs_list_run_page_and_compare_show_the_same_means(browser):
    """Real source rows: h is lower-is-better (errors left out), q higher is
    better and u undeclared (errors count as 0). The repeat run has scorer-
    and task-error passes; the classic run has both kinds of errors."""
    from test_minimize_errors import _classic, _repeat

    fixtures = []
    try:
        with _runs_api(lambda db: _classic(db, "run-1")) as client:
            listed = _listed_means(client)["run-1"]
            assert listed["h"] == pytest.approx(0.4)
            fixture = ViewFixture(browser, "run", count=5)
            fixtures.append(fixture)
            fixture.api_client = client
            assert _run_page_means(fixture) == _approx(listed)

        def seed(db):
            _repeat(db, "run-1")
            _classic(db, "run-2")

        with _runs_api(seed) as client:
            listed = _listed_means(client)
            # Task errors are judged per pass (item d failed its last pass).
            assert listed["run-1"]["h"] == pytest.approx(0.3)
            fixture = ViewFixture(browser, "run", count=4, samples=3)
            fixtures.append(fixture)
            fixture.api_client = client
            assert _run_page_means(fixture) == _approx(listed["run-1"])

            # Compare splits the repeat run into its passes: their means are
            # the server's per-pass means.
            passes = {
                item["pass_number"]: item["metric_means"]
                for item in client.get("/api/runs/run-1/passes").json()["passes"]
            }
            compare = ViewFixture(browser, "compare", count=5)
            fixtures.append(compare)
            compare.api_client = client
            compare.goto()
            table = compare.page.evaluate(
                """() => Object.fromEntries(Array.from(
                  document.querySelectorAll('#metrics-table tr'),
                  row => [row.querySelector('.metric-name')?.textContent,
                          Array.from(row.querySelectorAll('td.metric-value-cell .metric-val'),
                                     cell => cell.textContent)],
                ).filter(([name]) => name))"""
            )
            columns = compare.page.evaluate(
                "__viewTest.state.runs.map(run => run.run.file_path)"
            )
            for metric in ("h", "q"):
                expected = {
                    "run-1::pass" + str(number): passes[number][metric]
                    for number in (1, 2, 3)
                }
                expected["run-2"] = listed["run-2"][metric]
                shown = {
                    ref: _percent(value) for ref, value in zip(columns, table[metric])
                }
                assert shown == _approx(expected), metric
    finally:
        for fixture in fixtures:
            fixture.close()


def _metric_cards(page):
    return page.evaluate(
        """() => Object.fromEntries(Array.from(
          document.querySelectorAll('.metric-card'),
          card => [card.querySelector('.metric-card-name')?.textContent,
                   card.textContent.replace(/\\s+/g, ' ').trim()],
        ).filter(([name]) => name))"""
    )


def test_error_labeled_passes_read_the_same_in_full_compact_and_released_rows(browser):
    """A scorer's own "error" label with a long reason, nested metadata or
    only an explanation is a judged pass; a failed task is not. Full rows,
    index rows, loaded and then released rows give the runs list's mean,
    and the platform's task_error flag is never offered as a metric field."""
    from test_minimize_errors import LABELED_H, _labeled

    shown = {}
    with _runs_api(lambda db: _labeled(db, "run-1")) as client:
        assert _listed_means(client)["run-1"]["h"] == pytest.approx(LABELED_H)
        for compact in (False, True):
            fixture = ViewFixture(browser, "run", compact=compact, count=9, samples=3)
            fixture.api_client = client
            try:
                assert _run_page_means(fixture) == _approx({"h": LABELED_H})
                page = fixture.page
                assert "task_error" not in page.evaluate(
                    "__viewTest.state.allMetricMetaKeys"
                )
                shown[compact, "index"] = _metric_cards(page)
                if compact:
                    # The CSV export loads every row; closing it releases
                    # them back to the index form.
                    page.evaluate("document.getElementById('export-filtered-btn').click()")
                    page.locator("#export-modal-cancel").wait_for()
                    assert page.evaluate(
                        "__viewTest.state.snapshot.rows.every(row => row.__details_loaded)"
                    )
                    page.evaluate("__viewTest.renderItems()")
                    fixture.settled()
                    shown[compact, "loaded"] = _metric_cards(page)
                    page.locator("#export-modal-cancel").click()
                    page.wait_for_function(
                        "__viewTest.state.snapshot.rows.every(row => !row.__details_loaded)"
                    )
                    page.evaluate("__viewTest.renderItems()")
                    fixture.settled()
                    shown[compact, "released"] = _metric_cards(page)
                    flags = page.evaluate(
                        "__viewTest.state.snapshot.rows.map(row => "
                        "[row.item_id, row.pass_metric_meta?.h?.[0]?.task_error ?? null])"
                    )
                    assert dict(flags) == {
                        "long_reason": False,
                        "nested": False,
                        "explained": False,
                        "verdict_marked": False,
                        "failed": True,
                        "legacy_zero_fill": True,
                        "reviewed": False,
                        "scorer_error": False,
                        "imported": False,
                    }
            finally:
                fixture.close()
    assert len({str(cards) for cards in shown.values()}) == 1, shown
