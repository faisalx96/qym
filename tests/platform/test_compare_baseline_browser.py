"""Compare tells runs apart and diffs them against a baseline (C055, C057)."""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

from test_performance_views_browser import ViewFixture, payload

NAMES = {
    "run-1": (
        "spider2-lite-sqlite_qwen3-32b_20260902",
        "openrouter/qwen3-32b",
        "2026-09-02T10:00:00Z",
    ),
    "run-2": ("spider2-lite-sqlite_gpt-4o_20260905", "gpt-4o", "2026-09-05T10:00:00Z"),
    "run-3": (
        "spider2-lite-sqlite_qwen3-32b_20260908",
        "qwen3-32b",
        "2026-09-08T10:00:00Z",
    ),
}


def _fixture(browser, count=40, runs=("run-1", "run-2"), samples=1, **overrides):
    fixture = ViewFixture(browser, "compare", count=count, samples=samples)
    for run_id in runs:
        if run_id not in fixture.data:
            fixture.data[run_id] = payload(run_id, count, samples)
        name, model, started = overrides.get(
            run_id, NAMES.get(run_id, (run_id, run_id, "2026-09-01T10:00:00Z"))
        )
        info = fixture.data[run_id]["run"]
        info.update(run_name=name, model_name=model, started_at=started)
    return fixture


def _headers(page):
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('#metrics-thead th')).slice(1).map(th => ({
          label: th.querySelector('.metric-run-label')?.textContent || '',
          pass: th.querySelector('.metric-run-pass')?.textContent || '',
          title: th.getAttribute('title') || '',
          baseline: !!th.querySelector('.metric-run-baseline'),
          colspan: Number(th.getAttribute('colspan') || 1),
        }))"""
    )


def test_columns_are_labelled_by_model_and_date_with_the_full_name_in_a_tooltip(
    browser,
):
    fixture = _fixture(browser, runs=("run-1", "run-2", "run-3"))
    try:
        fixture.goto("&runs=run-3")
        headers = _headers(fixture.page)
        labels = [header["label"] for header in headers]
        assert labels == ["qwen3-32b · Sep 2", "gpt-4o · Sep 5", "qwen3-32b · Sep 8"]
        assert headers[0]["title"].startswith("spider2-lite-sqlite_qwen3-32b_20260902")
        assert len(set(labels)) == 3
    finally:
        fixture.close()


def test_runs_of_one_model_are_labelled_by_what_their_names_do_not_share(browser):
    same = {
        "run-1": (
            "spider2-lite-sqlite_qwen3-32b_20260902",
            "qwen3-32b",
            "2026-09-02T10:00:00Z",
        ),
        "run-2": (
            "spider2-lite-sqlite_qwen3-32b_20260928",
            "qwen3-32b",
            "2026-09-28T10:00:00Z",
        ),
    }
    fixture = _fixture(browser, **same)
    try:
        fixture.goto()
        labels = [header["label"] for header in _headers(fixture.page)]
        # The shared prefix is cut at a separator, never mid-token.
        assert labels == ["20260902", "20260928"]
        # Item cards and the winner filter use the same short labels.
        assert "20260928 Won" in fixture.page.evaluate(
            "Array.from(document.querySelectorAll('#run-winner-filter option'), o => o.textContent).join('|')"
        )
    finally:
        fixture.close()


def test_many_runs_scroll_inside_the_card_with_the_metric_column_pinned(browser):
    runs = tuple("run-%d" % index for index in range(1, 13))
    fixture = _fixture(browser, runs=runs)
    fixture.context.close()
    # 1280 px: the narrowest layout the review measured.
    fixture.context = browser.new_context(
        viewport={"width": 1280, "height": 900}, reduced_motion="reduce"
    )
    fixture.page = fixture.context.new_page()
    fixture.page.on("pageerror", lambda error: fixture.errors.append(str(error)))
    fixture.page.route("**/*", fixture.route)
    try:
        fixture.goto("".join("&runs=%s" % run for run in runs[2:]))
        page = fixture.page
        layout = page.evaluate("""() => {
              const scroll = document.getElementById('metrics-table-scroll');
              const cells = Array.from(document.querySelectorAll('#metrics-thead th')).slice(1);
              const name = document.querySelector('#metrics-tbody td.metric-name');
              const head = document.querySelector('#metrics-thead th');
              return {
                scrolls: scroll.scrollWidth > scroll.clientWidth,
                page: document.documentElement.scrollWidth <= window.innerWidth,
                narrowest: Math.min(...cells.map(cell => cell.getBoundingClientRect().width)),
                pinned: getComputedStyle(name).position,
                sticky: getComputedStyle(head).position,
              };
            }""")
        assert layout["scrolls"] and layout["page"]
        assert layout["narrowest"] >= 130
        assert layout["pinned"] == "sticky" and layout["sticky"] == "sticky"
        page.evaluate(
            "document.getElementById('metrics-table-scroll').scrollLeft = 2000"
        )
        name = page.locator("#metrics-tbody td.metric-name").first
        box = name.bounding_box()
        frame = page.locator("#metrics-table-scroll").bounding_box()
        assert abs(box["x"] - frame["x"]) < 3  # still at the card's left edge
    finally:
        fixture.close()


def test_every_column_shows_its_change_against_the_baseline_and_filters_by_it(browser):
    fixture = _fixture(browser, count=40)
    # run-2 regresses on items 0..9 (1 -> 0) and improves on items 11 and 13.
    rows_1 = fixture.data["run-1"]["snapshot"]["rows"]
    rows_2 = fixture.data["run-2"]["snapshot"]["rows"]
    for index in range(40):
        rows_1[index]["metric_values"][0] = 1 if index < 10 else index % 2
        rows_2[index]["metric_values"][0] = 0 if index < 10 else index % 2
        rows_1[index]["status"] = rows_2[index]["status"] = "completed"
        rows_1[index]["error"] = rows_2[index]["error"] = ""
    for index in (12, 14):
        rows_2[index]["metric_values"][0] = 1
    try:
        fixture.goto()
        page = fixture.page
        headers = _headers(page)
        assert [header["baseline"] for header in headers] == [True, False]
        row = page.locator("#metrics-tbody tr").filter(has_text="accuracy").first
        cells = row.locator("td.metric-value-cell")
        assert cells.nth(0).locator(".metric-delta").count() == 0
        delta = cells.nth(1).locator(".metric-delta")
        assert delta.inner_text().startswith("−20.0 pts")
        assert "metric-delta--regressed" in delta.get_attribute("class")
        assert "noise band" in delta.get_attribute(
            "title"
        ) and "40 paired items" in delta.get_attribute("title")
        regressed = cells.nth(1).locator(".metric-delta-count--regressed")
        improved = cells.nth(1).locator(".metric-delta-count--improved")
        assert regressed.inner_text() == "↓10" and improved.inner_text() == "↑2"

        regressed.click()
        page.wait_for_function(
            "document.querySelector('#filter-count').textContent.startsWith('10 ')"
        )
        banner = page.locator("#baseline-delta-banner")
        assert banner.is_visible() and "regressed on accuracy" in banner.inner_text()
        ids = page.evaluate("__viewTest.getFilteredItems().map(item => item.itemId)")
        assert sorted(ids) == sorted("aligned-%d" % index for index in range(10))
        page.locator("#baseline-delta-clear").click()
        page.wait_for_function(
            "document.querySelector('#filter-count').textContent.startsWith('40')"
        )
        assert banner.is_hidden()

        # Another baseline: the signs flip, and the link keeps the choice.
        page.locator("#metrics-baseline-select").select_option("run-2")
        assert [header["baseline"] for header in _headers(page)] == [False, True]
        delta = (
            page.locator("#metrics-tbody tr")
            .filter(has_text="accuracy")
            .first.locator("td.metric-value-cell")
            .nth(0)
            .locator(".metric-delta")
        )
        assert delta.inner_text().startswith("+20.0 pts")
        assert parse_qs(urlparse(page.url).query)["baseline"] == ["run-2"]
    finally:
        fixture.close()


def test_baseline_from_the_link_and_a_dataset_version_notice(browser):
    fixture = _fixture(browser)
    fixture.data["run-1"]["run"]["dataset_version"] = "v3"
    fixture.data["run-2"]["run"]["dataset_version"] = "v4"
    try:
        fixture.goto("&baseline=run-2")
        page = fixture.page
        assert [header["baseline"] for header in _headers(page)] == [False, True]
        notice = page.locator(".compare-dataset-notice")
        assert notice.is_visible()
        text = notice.inner_text()
        assert "different versions of dataset" in text and "v3" in text and "v4" in text
    finally:
        fixture.close()
    same = _fixture(browser)
    try:
        same.goto()
        assert same.page.locator(".compare-dataset-notice").count() == 0
    finally:
        same.close()


def test_repeat_runs_group_their_pass_columns_or_show_one_run_average(browser):
    fixture = _fixture(browser, count=20, samples=3)
    try:
        fixture.goto()
        page = fixture.page
        # Run average is the default and the first choice; the link says
        # nothing about it.
        options = page.locator("[data-pass-columns]")
        assert options.evaluate_all("buttons => buttons.map(b => b.dataset.passColumns)") == ["run", "each"]
        assert page.locator('[data-pass-columns="run"]').get_attribute("aria-pressed") == "true"
        page.wait_for_function(
            "document.querySelectorAll('#metrics-tbody tr:first-child td.metric-value-cell').length === 2"
        )
        labels = [header["label"] for header in _headers(page)]
        assert labels == ["qwen3-32b · Sep 2 ×3", "gpt-4o · Sep 5 ×3"]
        assert "columns" not in parse_qs(urlparse(page.url).query)
        # Run average: the mean over the passes (Avg@k) of each item.
        means = page.evaluate(
            """() => Array.from(document.querySelectorAll('#metrics-tbody tr:first-child td.metric-value-cell .metric-val'), cell => cell.textContent)"""
        )
        assert means[0] == means[1]  # both runs have the same pass scores

        page.locator('[data-pass-columns="each"]').click()
        page.wait_for_function(
            "document.querySelectorAll('#metrics-tbody tr:first-child td.metric-value-cell').length === 6"
        )
        groups = page.locator("#metrics-thead th.metric-run-group")
        assert groups.count() == 2
        assert groups.nth(0).get_attribute("colspan") == "3"
        assert groups.nth(0).inner_text().strip() == "qwen3-32b · Sep 2"
        passes = page.locator("#metrics-thead .metric-run-pass").all_text_contents()
        assert passes == ["Pass 1", "Pass 2", "Pass 3"] * 2
        assert parse_qs(urlparse(page.url).query)["columns"] == ["passes"]
    finally:
        fixture.close()


def test_object_category_values_read_as_json_not_object_object(browser):
    fixture = _fixture(browser)
    for run_id in ("run-1", "run-2"):
        for row in fixture.data[run_id]["snapshot"]["rows"]:
            row["item_metadata"]["complexity"] = {
                "level": "hard" if row["index"] % 2 else "easy"
            }
    try:
        fixture.goto()
        section = fixture.page.locator("#metadata-breakdown")
        section.locator(".breakdown-card .breakdown-card-label").first.wait_for()
        text = section.inner_text()
        assert "[object Object]" not in text
        assert '{"level":"hard"}' in text
    finally:
        fixture.close()


def test_the_change_and_its_verdict_come_from_the_items_both_runs_scored(browser):
    # run-2 stopped half way: it scored items 0..19 only. Every one of them
    # improved on the baseline (0 -> 0.2/0.3), yet its average (0.25) is
    # below the baseline's (0.5, from items 20..39 it never ran). The change,
    # its color and the noise band must describe the same paired items as the
    # ↑/↓ counts, not the gap between two averages over different items.
    fixture = _fixture(browser, count=40)
    rows_1 = fixture.data["run-1"]["snapshot"]["rows"]
    for index, row in enumerate(rows_1):
        row["metric_values"][0] = 0 if index < 20 else 1
        row["status"], row["error"] = "completed", ""
    rows_2 = fixture.data["run-2"]["snapshot"]["rows"][:20]
    for index, row in enumerate(rows_2):
        row["metric_values"][0] = 0.2 if index % 2 else 0.3
        row["status"], row["error"] = "completed", ""
    fixture.data["run-2"]["snapshot"]["rows"] = rows_2
    try:
        fixture.goto()
        page = fixture.page
        row = page.locator("#metrics-tbody tr").filter(has_text="accuracy").first
        cell = row.locator("td.metric-value-cell").nth(1)
        assert cell.locator(".metric-delta-count--improved").inner_text() == "↑20"
        assert cell.locator(".metric-delta-count--regressed").inner_text() == "↓0"
        delta = cell.locator(".metric-delta")
        assert delta.inner_text().startswith("+25.0 pts")
        assert "metric-delta--improved" in delta.get_attribute("class")
        title = delta.get_attribute("title")
        assert "20 paired items" in title
        # The averages differ by another amount: the tooltip says why.
        assert "−25.0 pts" in title and "20 items" in title
        assert fixture.errors == []
    finally:
        fixture.close()


def test_run_average_is_the_run_mean_when_items_have_unequal_passes(browser):
    # Run average (Avg@k) is the run mean (services/run_means.py): each item
    # is the mean over its passes, then the mean over items. Even items have
    # two scored passes of 1 and an unscored third; odd items three 0s. The
    # run mean is 50%; pooling every pass score would give 20 / 50 = 40%.
    fixture = _fixture(browser, count=20, samples=3)
    for run_id in ("run-1", "run-2"):
        for row in fixture.data[run_id]["snapshot"]["rows"]:
            even = row["index"] % 2 == 0
            row["pass_scores"]["accuracy"] = [1, 1, None] if even else [0, 0, 0]
            row["metric_values"][0] = 1 if even else 0
            row["status"], row["error"] = "completed", ""
    try:
        fixture.goto("&columns=runs")
        page = fixture.page
        page.wait_for_function(
            "document.querySelectorAll('#metrics-tbody tr:first-child td.metric-value-cell').length === 2"
        )
        row = page.locator("#metrics-tbody tr").filter(has_text="accuracy").first
        means = row.locator("td.metric-value-cell .metric-val").all_text_contents()
        assert [value.strip() for value in means] == ["50.0%", "50.0%"], means
        assert fixture.errors == []
    finally:
        fixture.close()
