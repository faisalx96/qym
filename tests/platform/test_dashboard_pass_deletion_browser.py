"""Keep dashboard pass selections tied to the version the user saw."""

import os
from urllib.parse import parse_qs, urlparse

import pytest

os.environ.setdefault("QYM_DATABASE_URL", "sqlite://")

from test_dashboard_paging_browser import DashboardFixture, make_runs
from test_performance_views_browser import source_run_api

pytestmark = pytest.mark.browser


class PassDashboard(DashboardFixture):
    def __init__(self, browser, client):
        self.client = client
        self.hold_passes = False
        self.held = None
        row = make_runs(1)[0]
        row.update(run_id="run-1", file_path="run-1", samples=3, pass_revision=0)
        super().__init__(browser, runs=[row])
        self.refresh_descriptor()

    def refresh_descriptor(self):
        data = self.client.get("/api/runs/run-1").json()
        passes = self.client.get("/api/runs/run-1/passes").json()
        self.runs[0].update(
            samples=data["run"]["samples"],
            pass_revision=data["run"]["metadata"].get("pass_revision", 0),
            pass_summaries=passes["passes"],
        )

    def route(self, route):
        request = route.request
        url = urlparse(request.url)
        if url.path.startswith("/api/runs/"):
            response = self.client.request(
                request.method,
                url.path,
                params=parse_qs(url.query),
                json=(
                    request.post_data_json
                    if request.method == "DELETE" and request.post_data
                    else None
                ),
            )
            if (
                self.hold_passes
                and url.path.endswith("/passes")
                and request.method == "GET"
            ):
                self.hold_passes = False
                self.held = (route, response)
                return
            route.fulfill(
                status=response.status_code,
                body=response.content,
                content_type="application/json",
            )
            return
        super().route(route)

    def open_passes(self):
        self.page.goto("https://qym.test/projects/demo")
        self.page.wait_for_function("__dashboardTest.state.flatRuns.length === 1")
        self.page.evaluate(
            "__dashboardTest.state.selectMode = true; __dashboardTest.render()"
        )
        self.page.locator('.samples-toggle[data-run-id="run-1"]').click()
        self.page.wait_for_function(
            "__dashboardTest.state._samplesData['run-1']?.passes.samples === 3"
        )

    def delete_first_elsewhere_and_poll(self):
        response = self.client.delete("/api/runs/run-1/passes/1")
        assert response.status_code == 200, response.text
        self.refresh_descriptor()
        self.page.evaluate("__dashboardTest.fetchRuns()")
        self.page.wait_for_function(
            "__dashboardTest.state.flatRuns[0].pass_revision === 1"
        )


@pytest.mark.parametrize("mode", ["single", "bulk"])
def test_confirmation_keeps_old_pass_version_when_poll_renumbers(browser, mode):
    with source_run_api(count=2) as client:
        fixture = PassDashboard(browser, client)
        try:
            fixture.open_passes()
            page = fixture.page
            if mode == "single":
                page.evaluate("""window.QymShell = {
                  openConfirmDialog: () => new Promise(resolve => { window.confirmPassDeletion = resolve; })
                }""")
                page.locator('.pass-delete-action[data-delete-pass="2"]').click()
            else:
                page.locator('.pass-checkbox[data-pass-ref="run-1::pass2"]').check()
                page.locator("#delete-selected").click()
                assert page.locator("#delete-modal").is_visible()

            fixture.delete_first_elsewhere_and_poll()
            assert not page.evaluate(
                "__dashboardTest.state.selectedRuns.has('run-1::pass2')"
            )
            with page.expect_response(
                lambda response: response.request.method == "DELETE"
            ) as rejected:
                if mode == "single":
                    page.evaluate("confirmPassDeletion({confirmed:true})")
                else:
                    page.locator("#confirm-delete-btn").click()
            response = rejected.value
            assert response.status == 409
            if mode == "single":
                assert parse_qs(urlparse(response.url).query)[
                    "expected_pass_version"
                ] == ["0"]
            else:
                assert response.request.post_data_json == {
                    "pass_numbers": [2],
                    "expected_pass_version": 0,
                }
            assert client.get("/api/runs/run-1").json()["run"]["samples"] == 2
        finally:
            fixture.close()


def test_poll_clears_old_selection_and_rejects_delayed_pass_details(browser):
    with source_run_api(count=2) as client:
        fixture = PassDashboard(browser, client)
        try:
            fixture.open_passes()
            page = fixture.page
            page.locator('.pass-checkbox[data-pass-ref="run-1::pass2"]').check()
            assert page.evaluate(
                "__dashboardTest.state.selectedRuns.has('run-1::pass2')"
            )
            fixture.hold_passes = True
            with page.expect_request("**/api/runs/run-1/passes"):
                page.evaluate(
                    "delete __dashboardTest.state._samplesData['run-1']; __dashboardTest.render()"
                )
            page.wait_for_function(
                "__dashboardTest.state._samplesLoads['run-1'] === true"
            )
            fixture.delete_first_elsewhere_and_poll()
            assert not page.evaluate(
                "__dashboardTest.state.selectedRuns.has('run-1::pass2')"
            )
            assert page.evaluate("__dashboardTest.state._samplesData['run-1'] == null")
            assert fixture.held is not None
            route, response = fixture.held
            assert response.json()["samples"] == 3
            route.fulfill(
                status=response.status_code,
                body=response.content,
                content_type="application/json",
            )
            page.wait_for_function(
                "__dashboardTest.state._samplesData['run-1']?.passes.samples === 2"
            )
            assert (
                page.locator(
                    '.pass-checkbox[data-pass-ref="run-1::pass2"]'
                ).is_checked()
                is False
            )
            assert (
                page.locator('.pass-checkbox[data-pass-ref="run-1::pass3"]').count()
                == 0
            )
            assert client.get("/api/runs/run-1").json()["run"]["samples"] == 2
        finally:
            fixture.close()


class DeleteDashboard(DashboardFixture):
    """Runs list whose run deletes answer like the platform (soft delete)."""

    def __init__(self, browser):
        super().__init__(browser)
        self.deleted = []

    def route(self, route):
        url = urlparse(route.request.url)
        if url.path == "/api/runs/delete" and route.request.method == "POST":
            self.deleted.append(route.request.post_data_json["file_path"])
            route.fulfill(json={"ok": True, "purge_after_days": 30})
            return
        super().route(route)


@pytest.mark.parametrize("mode", ["single", "bulk"])
def test_run_delete_dialog_offers_restore_and_no_cannot_be_undone(browser, mode):
    """C020: deleted runs can be restored, so the dialog must not also say
    "This action cannot be undone", and the bulk toast states the window."""
    fixture = DeleteDashboard(browser)
    try:
        fixture.open()
        page = fixture.page
        if mode == "single":
            page.evaluate(
                "document.querySelector('#runs-tbody tr[data-idx] .delete-run').click()"
            )
        else:
            page.evaluate(
                "() => { const t=window.__dashboardTest; t.state.selectMode=true;"
                " t.toggleSelect(t.state.filteredRuns[0].file_path); t.render(); }"
            )
            page.locator("#delete-selected").click()
        assert page.locator("#delete-modal").is_visible()
        assert "can restore" in page.locator("#delete-modal-description").inner_text()
        assert "cannot be undone" not in page.locator("#delete-modal").inner_text()
        page.locator("#confirm-delete-btn").click()
        toast = page.locator(".toast").filter(has_text="30 days")
        toast.wait_for()
        assert len(fixture.deleted) == 1
    finally:
        fixture.close()


def test_pass_delete_dialog_warns_that_passes_are_permanent(browser):
    with source_run_api(count=2) as client:
        fixture = PassDashboard(browser, client)
        try:
            fixture.open_passes()
            page = fixture.page
            page.locator('.pass-checkbox[data-pass-ref="run-1::pass2"]').check()
            page.locator("#delete-selected").click()
            warning = page.locator("#delete-modal-warning")
            assert warning.is_visible()
            assert warning.inner_text() == "Deleted passes cannot be restored."
        finally:
            fixture.close()


class PublishingDashboard(DashboardFixture):
    """The page answer says the projection is still publishing; the overview
    (cached for 60 s by the client) does not."""

    def __init__(self, browser):
        super().__init__(browser)
        self.page_updating = False
        self.runs_requests = 0

    def route(self, route):
        url = urlparse(route.request.url)
        if url.path.endswith("/api/dashboard/runs"):
            self.runs_requests += 1
            if self.page_updating:
                self.page_updating = False
                original = route.fulfill

                def fulfill(**kwargs):
                    body = kwargs.get("json")
                    if isinstance(body, dict):
                        body["freshness"] = {"updating": True}
                    return original(**kwargs)

                route.fulfill = fulfill
        super().route(route)


def test_runs_list_polls_again_while_its_page_is_still_publishing(browser):
    """C012/C014: after a review action the row kept its old status for the
    60 s idle poll although the page said the projection was updating."""
    fixture = PublishingDashboard(browser)
    try:
        fixture.open()
        page = fixture.page
        fixture.page_updating = True
        page.evaluate("window.__dashboardTest.fetchRuns()")
        page.wait_for_function(
            "window.__dashboardTest.state.dashboardPage?.freshness?.updating === true"
        )
        before = fixture.runs_requests
        page.wait_for_timeout(3500)
        assert fixture.runs_requests > before, "no follow-up poll within 3.5 s"
    finally:
        fixture.close()


def test_status_bar_names_filtered_models_like_the_dropdown(browser):
    """The footer printed internal keys such as "gpt-4.1-mini|||plain"."""
    fixture = DashboardFixture(browser)
    try:
        fixture.open()
        page = fixture.page
        page.evaluate(
            "() => { const t = window.__dashboardTest;"
            " t.state.filterModels = new Set(['openai/gpt-4.1-mini|||plain',"
            " 'anthropic/claude-sonnet-5|||reasoning']); t.render(); }"
        )
        # A changed model filter refetches; the footer updates after that.
        page.wait_for_function(
            "document.querySelector('#status-filter').textContent.includes('model:')"
        )
        text = page.locator("#status-filter").inner_text()
        assert "|||" not in text
        assert "model: gpt-4.1-mini, claude-sonnet-5 (reasoning)" in text
    finally:
        fixture.close()


def test_single_pass_delete_removes_that_pass_and_keeps_the_others(browser):
    pass_rows = """() => Array.from(
      document.querySelectorAll('tr.pass-member[data-samples-for="run-1"]')
    ).map(row => [
      row.querySelector('.pass-member-id').textContent.trim(),
      row.querySelector('.col-metric-value').textContent.trim(),
    ])"""
    with source_run_api(count=2) as client:
        fixture = PassDashboard(browser, client)
        page = fixture.page
        console_errors = []
        confirmations = []
        page.on(
            "console",
            lambda message: message.type == "error"
            and console_errors.append(message.text),
        )

        def accept_confirmation(dialog):
            confirmations.append(dialog.message)
            dialog.accept()

        def delete_then_publish(route):
            if route.request.method != "DELETE":
                route.fallback()
                return
            # Real deletion; the stubbed runs list then serves the new pass
            # revision, as the dashboard API does after a delete.
            url = urlparse(route.request.url)
            response = client.delete(url.path, params=parse_qs(url.query))
            fixture.refresh_descriptor()
            route.fulfill(
                status=response.status_code,
                body=response.content,
                content_type="application/json",
            )

        try:
            fixture.open_passes()
            page.on("dialog", accept_confirmation)
            page.route("**/api/runs/run-1/passes/*", delete_then_publish)
            before = page.evaluate(pass_rows)
            assert [label for label, _ in before] == ["Pass 1", "Pass 2", "Pass 3"]
            # Distinct per-pass scores identify the survivors after renumbering.
            assert len({score for _, score in before}) == 3
            page.locator('.pass-checkbox[data-pass-ref="run-1::pass3"]').check()
            assert page.locator("#compare-panel").is_visible()

            with page.expect_response(
                lambda response: response.request.method == "DELETE"
            ) as deleted:
                page.locator('.pass-delete-action[data-delete-pass="2"]').click()

            response = deleted.value
            assert response.status == 200
            request_url = urlparse(response.url)
            assert request_url.path == "/api/runs/run-1/passes/2"
            assert parse_qs(request_url.query) == {"expected_pass_version": ["0"]}
            assert len(confirmations) == 1 and "Pass 2" in confirmations[0]
            toast = page.locator(".toast").first
            toast.wait_for()
            assert "toast-success" in toast.get_attribute("class"), toast.inner_text()
            assert "Pass deleted" in toast.inner_text()
            page.wait_for_function(
                "__dashboardTest.state._samplesData['run-1']?.passes.samples === 2"
            )
            assert page.evaluate(pass_rows) == [
                ["Pass 1", before[0][1]],
                ["Pass 2", before[2][1]],
            ]
            assert page.locator(".toast-error").count() == 0
            # The old Pass 3 selection must not carry over to the renumbered
            # Pass 2 or keep the selection actions open.
            assert page.locator(".pass-checkbox:checked").count() == 0
            assert not page.locator("#compare-panel").is_visible()
            assert client.get("/api/runs/run-1").json()["run"]["samples"] == 2
            assert console_errors == []
        finally:
            fixture.close()
