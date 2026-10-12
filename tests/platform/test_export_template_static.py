"""Guards on the frozen run page the HTML export is built from.

``GET /api/runs/{id}/export-html`` and ``GET /api/compare/export-html`` inline
``export_templates/run/`` (run.html and its CSS/JS) into one offline file. These
checks used to read the vanilla dashboard; the exported page is the only
remaining copy of that markup, so they now read the templates directly.
(The live UI is the React app, covered by frontend/e2e and Vitest.)
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PLATFORM = ROOT / "packages" / "platform" / "qym_platform"
DASHBOARD_DIR = PLATFORM / "export_templates" / "run"
METRICS_JS = DASHBOARD_DIR / "metrics.js"


def _rule(css: str, selector: str) -> str:
    """The body of the first CSS block that starts with `selector`."""
    start = css.index(selector)
    return css[start:css.index("}", css.index("{", start)) + 1]


def test_run_export_page_keeps_an_independent_scroll_container() -> None:
    """Regression guard for the standalone export page (the compare export is
    the same template, one tab per run)."""
    markup = (DASHBOARD_DIR / "run.html").read_text(encoding="utf-8")
    rule = _rule(markup, ".run-container")
    assert "height: calc(100vh - 100px);" in rule
    assert "overflow-y: auto;" in rule


def test_export_html_is_one_self_contained_document(tmp_path) -> None:
    """The export inlines every stylesheet and script of the template: no
    /static stylesheet or script link survives, so the file opens offline (was a source grep of the
    inlining regexes in api/runs.py)."""
    from _support_a2 import source_run_api

    with source_run_api(count=2) as client:
        response = client.get("/api/runs/run-1/export-html")
    assert response.status_code == 200, response.text
    html = response.text
    assert not re.search(r'(?:href|src)="[^"]*/static/', html)
    assert not re.search(r'<link[^>]+rel="stylesheet"', html)
    assert not re.search(r"<script[^>]+src=", html)
    assert html.count("<style>") >= 6
    for inlined in (
        ".run-container",  # run.html
        "window.QymMetrics",  # metrics.js
        "window.QymTraceViewer",  # trace_viewer.js
        "qym-segmented",  # ui_components.css / .js
    ):
        assert inlined in html, inlined
    assert "__QYM_EXPORT_DATA__" in html


def test_run_item_scopes_task_and_metric_errors_to_the_right_surface() -> None:
    """Task errors mark the item; metric errors mark only their metric."""
    source = (DASHBOARD_DIR / "run.html").read_text(encoding="utf-8")
    verdict_block = source.split(
        "// The verdict belongs to the expanded execution", 1
    )[1].split("// Detailed AI analysis", 1)[0]
    metric_strip = source.split("function renderMetricStrip", 1)[1].split(
        "function renderItems", 1
    )[0]
    aggregate_pills = source.split("const aggPills = isExpanded", 1)[1].split(
        "const passNote", 1
    )[0]
    error_distribution = source.split("function collectRowErrors", 1)[1].split(
        "function renderErrorDistributionSection", 1
    )[0]

    # A repeat item's task errors are its failed passes, not the status of
    # the pass that arrived last (metrics.js hasTaskError).
    assert "const hasTaskError = window.QymMetrics.hasTaskError(row);" in verdict_block
    assert "const taskErrorAttempts = isRepeatItem" in verdict_block
    assert "window.QymMetrics.isTaskErrorRow(att)" in verdict_block
    assert (
        "const hasAnyTaskError = hasTaskError || taskErrorAttempts.length > 0;"
        in verdict_block
    )
    assert "const selectedMetricHasError = metric" in verdict_block
    assert "window.QymMetrics.hasMetricError(row, metric)" in verdict_block
    # A lower-is-better metric leaves a scorer error out of its mean: the item
    # shows as an error, never as a (best) score.
    assert (
        "const scorerErrorLeftOut = selectedMetricHasError && errorsLeftOutFor(metric);"
        in verdict_block
    )
    assert "if (hasAnyTaskError || scorerErrorLeftOut)" in verdict_block
    assert "else if (!selectedMetricHasError" in verdict_block
    assert "pfClass = 'error';" in verdict_block
    # Pass/Fail follows the declared direction and the metric's error rule;
    # none = no tag (C008).
    assert "const pfPassed = rowPassesFor(metric, rowScoreFor(row, mIdx, metric));" in verdict_block
    assert "pfClass = pfPassed ? 'pass' : 'fail';" in verdict_block
    assert (
        "const statusLabel = pfClass === 'not-received' ? 'Not received' "
        ": pfClass === 'pass' ? 'Pass' : 'Fail';" in verdict_block
    )
    # An item never received has no verdict: it is neither a pass nor an error.
    assert "const notReceived = window.QymMetrics.isNotReceivedRow(row);" in verdict_block
    assert "if (notReceived) {\n            pfClass = 'not-received';" in verdict_block
    assert "? 'Task execution failed in ' + taskErrorAttempts.length" in verdict_block
    assert ": 'Task execution failed')" in verdict_block
    assert ": 'qym-tag--danger';" in verdict_block
    # Warning is the not-received state's tone only; errors stay danger.
    assert verdict_block.count("qym-tag--warning") == 1
    assert "pfClass === 'not-received'\n            ? 'qym-tag--warning'" in verdict_block
    assert "const statusIconOnlyClass = pfClass === 'error'" in verdict_block
    assert "const statusContent = pfClass === 'error' ? FAILURE_ICON" in verdict_block
    assert "const statusAccessibility = pfClass === 'error'" in verdict_block
    assert 'role="img" aria-label="' in verdict_block
    assert (
        "const executionErrorClass = hasAnyTaskError ? ' item-execution-error' : '';"
        in verdict_block
    )
    assert "hasExecutionError" not in verdict_block
    assert 'class="qym-tag \' + statusTagClass' in verdict_block
    assert 'item-header-expand\' + executionErrorClass' in source
    assert "!isRepeatItem || hasAnyTaskError" in source
    assert '<div class="item-run-output\' + executionErrorClass' in source
    assert 'return \'<div class="item-card" data-item-id="\'' in source
    assert 'return \'<div class="item-card\' + executionErrorClass' not in source

    assert "function renderMetricErrorIndicator(metricName)" in source
    assert 'role="img" aria-label="' in source
    assert "window.QymMetrics.isMetricErrorMeta(fullMetricMeta)" in metric_strip
    assert "!metaKeys.length && !hasMetricExecutionError" in metric_strip
    assert "metric-execution-error" in metric_strip
    assert "renderMetricErrorIndicator(name)" in metric_strip
    assert "window.QymMetrics.hasMetricError(row, name)" in aggregate_pills
    assert "metric-execution-error" in aggregate_pills
    assert "renderMetricErrorIndicator(name)" in aggregate_pills
    repeat_outputs = source.split("function renderAnswerColumns", 1)[1].split(
        "function _parseMetaDeep", 1
    )[0]
    assert "window.QymMetrics.isTaskErrorRow(att)" in repeat_outputs
    assert "const passHasTaskError = window.QymMetrics.isTaskErrorRow(att);" in repeat_outputs
    assert "const passExecutionErrorClass = passHasTaskError" in repeat_outputs
    assert "const borderColor = passHasTaskError ? 'var(--error)' : color;" in repeat_outputs
    assert "qym-output-card' + passExecutionErrorClass" in repeat_outputs

    assert ".item-card.item-execution-error {" not in source
    assert "border-color: var(--error);" in _rule(
        source, ".item-card.item-collapsed.item-execution-error {"
    )
    assert "border-color: var(--error);" in _rule(
        source,
        ".items-grid > .item-card.item-collapsed.item-execution-error:hover {",
    )
    output_error_rule = _rule(source, ".item-run-output.item-execution-error {")
    assert "border: 1px solid var(--error);" in output_error_rule
    assert "border-left-width: 3px;" in output_error_rule
    icon_rule = _rule(source, ".item-failure-icon {")
    assert "width: 12px;" in icon_rule
    assert "height: 12px;" in icon_rule
    assert "stroke: currentColor;" in icon_rule
    icon_only_rule = _rule(source, ".item-error-indicator {")
    assert "min-width: var(--badge-height);" in icon_only_rule
    assert "padding: 0;" in icon_only_rule
    metric_boundary_rule = _rule(source, ".qym-item-metric-cell.metric-execution-error {")
    assert "border: 1px solid var(--error);" in metric_boundary_rule
    metric_row_boundary_rule = _rule(
        source, ".metric-det-chips > .det-toggle.metric-execution-error,"
    )
    assert "border-color: var(--error);" in metric_row_boundary_rule
    metric_icon_rule = _rule(source, ".metric-error-indicator {")
    assert "min-width: var(--badge-height);" in metric_icon_rule
    assert "padding: 0;" in metric_icon_rule

    assert "Metric Errors" in source
    assert "'Metric error'" in source
    assert "const passTaskErrors = isRepeatAggregateView()" in error_distribution
    assert "Array.isArray(row.pass_attempts)" in error_distribution
    assert "for (const attempt of passTaskErrors)" in error_distribution
    assert "attempt.error || attempt.output || ''" in error_distribution
    assert "} else if (window.QymMetrics.isItemTaskError(row)) {" in error_distribution
    assert "const passErrors = Array.isArray(perPass)" in error_distribution
    assert "passErrors.length" in error_distribution


def test_selected_repeat_pass_does_not_inherit_other_pass_metric_errors() -> None:
    """A pass-scoped row must expose only that pass's selected metric metadata."""
    source = (DASHBOARD_DIR / "run.html").read_text(encoding="utf-8")
    scope_block = source.split("function scopeRowToPass", 1)[1].split(
        "function processRun", 1
    )[0]

    assert "metric_meta: passMetricMeta," in scope_block
    assert "pass_metric_meta: null," in scope_block


def test_run_column_wraps_names_at_400px() -> None:
    styles = (DASHBOARD_DIR / "dashboard.css").read_text(encoding="utf-8")

    assert "--runs-col-run-width: 400px;" in styles
    assert "--runs-col-run-min-width: 400px;" in styles
    assert "--runs-col-run-max-width: 400px;" in styles
    run_id_rule = _rule(styles, ".run-cell-content .run-id {")
    assert "overflow-wrap: anywhere;" in run_id_rule
    assert "white-space: normal;" in run_id_rule
    assert "text-overflow: clip;" in run_id_rule


def test_repeat_run_latency_columns_round_to_whole_seconds() -> None:
    source = (DASHBOARD_DIR / "run.html").read_text(encoding="utf-8")

    assert "const latCell = v =>" in source
    assert "Math.round(v / 1000) + 's'" in source
    assert ".toFixed(2) + 's'" not in source


def test_shared_latency_formatter_normalizes_minute_rollover() -> None:
    source = METRICS_JS.read_text(encoding="utf-8")

    assert "const totalSeconds = Math.round(ms / 1000);" in source
    assert "const seconds = totalSeconds % 60;" in source
    assert "return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;" in source


def test_run_detail_includes_non_redundant_intelligence_charts() -> None:
    source = (DASHBOARD_DIR / "run.html").read_text(encoding="utf-8")
    active = source.split("function buildDeepAnalysisCharts(rows)", 1)[1].split("function renderOverview", 1)[0]

    assert "function buildDeepAnalysisCharts(rows)" in source
    assert "Metric Correlation" in active
    assert 'class="ri-chart ri-chart-square"' in active
    correlation_chart_rule = _rule(source, ".ri-chart-square {")
    assert "max-width: var(--analysis-matrix-max-width);" in correlation_chart_rule
    assert "margin-inline: 0;" in correlation_chart_rule
    assert "Metric Relationship" in active
    # Quality vs latency lives in the Latency and traces module now.
    assert "Quality–Latency Frontier" not in active
    assert "ri-frontier" not in source
    assert 'r="3.5" fill="var(--chart-1)"' in active
    assert 'stroke-width="1.5"' in active
    assert "Repeat Stability" not in active
    assert "Score Estimate by Pass Count" not in active
    assert "ri-x-axis" in active
    assert "ri-y-axis" in active
    assert "samplesStatistic" in source
    assert "repeatAnalysisMetric" not in source
    assert "repeatStabilityHiddenMetrics" not in source
    assert "data-ri-repeat-metric" not in active
    assert "data-ri-stability-metric" not in active
    assert "ri-legend-toggle" not in active
    assert "state.samplesMetric = nextMetric;" in source
    repeat_metric_handler = source.split(
        "container.querySelectorAll('.samples-metric-tab').forEach",
        1,
    )[1].split("const samplesThreshold", 1)[0]
    assert "await renderSamplesAnalysis();" in repeat_metric_handler
    assert "renderMetadataBreakdown();" in repeat_metric_handler
    assert "renderOverview(" not in repeat_metric_handler
    assert "rotateMatrixLabels" in active
    assert "const rotateMatrixLabels = series.length > 4;" in active
    assert "truncateMatrixLabel" in active
    assert "const top = series.length <= 4 ? 42 : 58;" in active
    assert 'text-anchor="middle" class="ri-label"' in active
    shared_box_rule = _rule(source, ".metric-card,")
    assert ".samples-group-tiles .model-stat-box," in shared_box_rule
    assert ".ri-panel," in shared_box_rule
    assert ".breakdown-card" in shared_box_rule
    assert "background: var(--bg-surface);" in _rule(source, ".ri-axis-select {")
    assert "Item Performance Matrix" not in active
    assert "Observed Performance by Pass" not in active
    assert "systemCards + intelligenceCharts" in source
    assert "const analysisCharts = buildDeepAnalysisCharts(rows);" in source
    assert "const intelligenceCharts = analysisCharts.deepAnalysisHtml;" in source
    assert "frontierPanel" not in source
    assert "return { deepAnalysisHtml };" in active
    assert 'class="ri-grid deep-analysis-grid"' in active
    assert 'relationshipPanels.push(\'<div class="ri-panel">' in active
    assert "radar" not in source.lower()
    # Latency and traces: one section header, then the module's panel, which
    # moves into each new section and gets the filtered rows (C028).
    assert "runSectionHeadHtml('latency', 'Latency and traces'," in source
    assert "How long each item takes end to end, and where every trace spends that time." in source
    assert "'<div data-latency-traces-slot></div>'" in source
    assert '<div id="latency-traces-panel"></div>' in source
    assert "updateLatencyTraces(filteredItemsOverride, deepSection.querySelector('[data-lt-aside]'))" in source
    assert "QymLatencyTraces.mount(panel, { runId: RUN_ID, passNumber: state.viewPass || null, offline: IS_EXPORT });" in source
    assert "window.QymLatencyTraces.reload({ quiet: true })" in source
    assert re.search(r'<script src="/static/latency_traces\.js\?v=[^"]+"></script>', source)
    assert re.search(r'<link rel="stylesheet" href="/static/latency_traces\.css\?v=[^"]+">', source)
    # The old cards and the step latency panel are gone from the run page.
    for gone in ("system-latency-card", "system-trace-card", "trace-pill", "system-metrics-grid",
                 "step_latency.js", "step-latency-panel", "QymStepLatency", "latency-ruler"):
        assert gone not in source, gone
    assert "Qym Metrics" not in source
    assert "system-metrics-label" not in source


def test_repeat_run_analysis_follows_overview_before_deep_analysis() -> None:
    source = (DASHBOARD_DIR / "run.html").read_text(encoding="utf-8")

    overview_markup = source.split('<div id="overview-section">', 1)[1].split(
        '<div id="metadata-breakdown">',
        1,
    )[0]
    assert (
        overview_markup.index('id="overview-primary-section"')
        < overview_markup.index('id="samples-analysis-section"')
        < overview_markup.index('id="overview-deep-section"')
    )

    render = source.split(
        "function renderOverview(filteredItemsOverride = null)",
        1,
    )[1].split("function getApprovalState", 1)[0]
    assert "primarySection.innerHTML =" in render
    assert "deepSection.innerHTML = systemCards + intelligenceCharts;" in render
    assert "section.innerHTML =" not in render


def test_run_item_detail_offers_virtualized_repeat_heatmap() -> None:
    source = (DASHBOARD_DIR / "run.html").read_text(encoding="utf-8")

    assert "itemDetailView: 'cards'" in source
    assert "itemsViewToggle.hidden = samplesTotal <= 1" in source
    assert "if (samplesTotal <= 1) state.itemDetailView = 'cards';" in source
    assert ".items-view-toggle[hidden] { display: none; }" in source
    assert 'data-items-view="cards"' in source
    assert 'data-items-view="heatmap"' in source
    assert "function renderItemsHeatmap(container, items, metric, metricIndex)" in source
    assert 'class="item-heatmap-viewport"' in source
    assert "Math.floor(viewport.scrollTop / rowHeight)" in source
    assert "Only visible rows are rendered" in source


def test_run_category_breakdown_keeps_cards_and_adds_repeat_aware_compare_view() -> None:
    source = (DASHBOARD_DIR / "run.html").read_text(encoding="utf-8")

    assert "categoryBreakdownView: 'cards'" in source
    assert "function getCategoryMetricScores(row, metric, metricIndex)" in source
    assert "row.pass_scores[metric]" in source
    assert "if (!state.viewPass" in source
    assert 'data-category-view="cards"' in source
    assert 'data-category-view="compare"' in source
    assert 'class="category-breakdown-context"' not in source
    assert 'id="category-breakdown-sort"' not in source
    assert 'class="score-col-performance"' in source
    assert "Avg · pass rate" not in source
    assert "Avg / pass rate" not in source
    assert 'class="breakdown-pass-summary"' not in source
    assert 'class="category-pass-track' in source
    assert "function categoryScoreTrack(score, baseline, direction = 'maximize')" in source
    assert "categoryScoreTrack(group.avgScore, overallAverage, metricDirectionOf(metric))" in source
    assert 'class="category-compare-row"' in source
    assert "<span>Pass rate</span>" not in source
    assert "<span>Rate</span>" not in source
    assert "const metric = state.samplesMetric || state.selectedMetric || state.allMetrics[0];" in source
    assert "Overall metric average score" in source
    assert 'class="category-baseline-score"' in source
    assert "renderMetadataBreakdown();" in source
    assert "'Overall run mean'" not in source
    assert "'Filtered mean'" not in source
    assert "scored results from" not in source
    assert "items across" not in source
    assert "scored items in Pass" not in source
    track_rule = _rule(source, ".category-pass-track {")
    marker_rule = _rule(source, ".category-pass-track.has-baseline::after {")
    assert "background: var(--bg-elevated);" in track_rule
    assert "width: 2px;" in marker_rule
    assert "background: var(--text-secondary);" in marker_rule
    assert ".category-compare-head span:nth-child(2) { text-align: left; }" in source
    assert ".category-compare-head span:nth-child(n + 3) { text-align: right; }" in source
    assert ".category-compare-head span:not(:first-child)" not in source
    assert "<span>| ' + baselineScope" not in source
    # the 6-card cap is gone: every category card renders, no Show-more
    assert "data-category-expand" not in source
    assert "groupStats.slice(0, 6)" not in source
    assert "metricType !== 'numeric'" in source


def test_run_page_supports_single_pass_scope() -> None:
    """?pass=N scopes the run page to one pass: metric values swap to that
    pass's scores at load time (so filters/overview/charts follow), the
    headline pill names the pass and links back to all passes, the cross-pass group
    section is hidden, and score edits target that pass (the run-level score
    is re-reduced server-side)."""
    source = (DASHBOARD_DIR / "run.html").read_text(encoding="utf-8")

    assert "const VIEW_PASS = (() => {" in source
    assert "new URLSearchParams(window.location.search).get('pass')" in source
    assert "scores[passNumber - 1]" in source
    assert "function scopedPassMetricMeta(row, metricNames, passNumber)" in source
    assert "function scopeRowToPass(row, metricNames, passNumber)" in source
    assert "metric_meta: passMetricMeta" in source
    assert "next = scopeRowToPass(next, state.allMetrics, state.viewPass);" in source
    # no banner — the headline pill carries the pass label and the way back
    assert "pass-scope-banner" not in source
    assert "Return to all passes." in source
    # pass pages read as a single run: no group tiles/sweep/curve, no
    # Repeat Stability chart panels, no per-pass dot strips on item cards
    assert "if (samplesCount <= 1 || IS_EXPORT || state.viewPass)" in source
    assert source.count("const repeatSeries = state.viewPass ? [] :") == 1
    assert "const isRepeatItem = !state.viewPass" in source
    # edits are allowed and routed to the viewed pass
    assert "const passNumber = Number(btn.dataset.passNumber) || state.viewPass || null;" in source
    # the validated number is sent, never the raw input text (C009)
    assert "updateMetricScore(filePath, rowIndex, metricName, parsed.value, passNumber)" in source
    assert "...(passNumber ? { pass_number: passNumber, expected_pass_version: currentPassVersion() } : {})," in source
    # applying the server row keeps per-pass fields and re-applies the lens
    assert "let next = { ...rows[pos], ...updatedRow };" in source
    assert "function scopedPassAttempt(row, passNumber)" in source
    assert "Number(candidate.pass_number) === passNumber" in source
    assert "const att = scopedPassAttempt(row, passNumber);" in source
    assert "? 'OUTPUT · PASS ' + state.viewPass" in source
    assert 'class="hero-samples-pill"' in source
    assert "samplesCount > 1 && !state.viewPass" in source
    assert 'class="hero-pass-pill"' in source
    # text-only pills — no decorative dot
    assert "hero-pass-dot" not in source
    assert '<div class="hero-eyebrow">Run Detail</div>' in source
    assert "passEyebrowHtml" not in source
    assert "<strong>x' + samplesCount + '</strong> PASSES" in source
    assert "metaItem('Samples'" not in source
    assert "'samples',\n          'max_metric_concurrency'" in source

    # pass scope swaps outputs/latency/traces too, from per-pass attempts
    assert "const positionalAttempt = attempts[passNumber - 1];" in source
    assert "task_started_at_ms: att?.task_started_at_ms ?? null" in source
    assert "retry_count: Number(att?.retry_count || 0)" in source
    assert "trace_stats: att?.trace_stats || null" in source
    assert "'?pass_number=' + encodeURIComponent(att.pass_number)" in source
    assert "state.viewPass ? '?pass_number=' + encodeURIComponent(state.viewPass)" in source
    # Missing attempts become pending instead of inheriting the latest
    # run-level output/status. Header and trace summary use the pass endpoint.
    assert "output: att ? (att.output ?? null) : null" in source
    assert "fetch(apiUrl('api/runs/' + RUN_ID + '/passes')" in source
    assert "const pass = state.viewPass ? state.passSummary : null;" in source
    assert "let runtimeMs = pass ? pass.duration_ms : run.duration_ms;" in source
    assert "? state.passSummary?.trace_stats" in source
    # A selected pass now has its own diagnosis scope; the aggregate page
    # keeps the read-only root-cause summary visible instead of hiding it.
    assert "function isRepeatAggregateView()" in source
    assert "if (!aggregateRepeatView) {" in source
    assert "pass_metric_analyses" in source
    assert "status: String(analysis.review_status || 'pending').toLowerCase()" in source
    assert "issue.review_status || analysis.review_status || legacyReview.status" in source
    assert "addCurrentPassToPayload(approvalBody);" in source
    assert "id: data.id || correctionId || null" in source
    assert "if (IS_EXPORT || isRepeatAggregateView()) return '';" in source
    assert "window.QymShell?.openConfirmDialog" in source
    assert "Only this sample will be changed." in source
    assert "...(passNumber ? { pass_number: passNumber, expected_pass_version: currentPassVersion() } : {})" in source

    # the lens and its All/pass dot switcher are gone: expanded repeat items
    # use independently visible output cards and one synchronized detail band
    assert "state.itemPassLens" not in source
    assert "pass-dot-switch" not in source
    assert "pass-lensed" not in source
    assert "renderAnswerColumns" in source
    assert 'class="qym-output-toggle"' in source
    assert 'class="qym-output-group__title">Output' in source
    assert 'data-output-metric="' in source
    assert 'data-metric-panel="' in source
    assert 'data-pass-number="' in source
    assert "itemHiddenOutputs" in source
    assert "itemComparedMetric" in source
    assert 'aria-pressed="' in source


def test_run_overview_totals_execution_errors_across_repeat_passes() -> None:
    source = (DASHBOARD_DIR / "run.html").read_text(encoding="utf-8")
    overview = source.split(
        "function renderOverview(filteredItemsOverride = null)", 1
    )[1].split("// ── Gauge color", 1)[0]

    assert "if (!isRepeatAggregateView()) return sum + rowError;" in overview
    assert "const executionErrors = Number(row.execution_error_count);" in overview
    assert (
        "Number.isFinite(executionErrors) ? Math.max(0, executionErrors) : rowError"
        in overview
    )
    assert "summaryItem('errors', 'Errors', String(failed)" in overview


def test_run_metric_diagnosis_popup_uses_solution_dropdown_and_shares_add_edit() -> None:
    run = (DASHBOARD_DIR / "run.html").read_text(encoding="utf-8")
    assert "showMetricIssueDialog(itemId, metricName, { mode: 'edit', focusField });" in run
    assert 'class="metric-analysis-inline"' not in run
    for field in ("category", "subcategory", "finding"):
        assert f'data-issue-field="{field}"' in run
    assert 'data-diagnosis-field="solution"' not in run
    assert 'data-diagnosis-field="solution_note"' not in run
    assert "Solution notes (optional)" not in run
    assert "data-new-solution" in run
    assert "+ Add new solution" in run
    for control in ("data-category-guidance", "data-solution-preset", "data-jump-issues", "data-jump-solution"):
        assert control in run
    assert "new Set(SOLUTION_PRESETS)" in run
    assert "Save changes" in run
    assert "Save and add another" in run
    assert ".metric-issue-dialog__body { display: block; overflow-y: auto; }" in run


def test_metric_issue_delete_is_an_explicit_staged_footer_action() -> None:
    run = (DASHBOARD_DIR / "run.html").read_text(encoding="utf-8")
    fields = run.split("function renderMetricDiagnosisFields", 1)[1].split(
        "function showMetricIssueDialog", 1
    )[0]
    dialog = run.split("function showMetricIssueDialog", 1)[1].split(
        "function showRootCauseIssuesEditor", 1
    )[0]

    assert "data-remove-issue" not in fields
    assert "CLOSE_ICON" not in fields
    assert "data-delete-diagnosis-issue" in dialog
    assert "qym-inline-action--danger metric-issue-dialog__delete" in dialog
    assert "FILTER_TRASH_ICON + '<span>Delete issue</span>" in dialog
    assert "draft.issues = [];" in dialog
    components = (DASHBOARD_DIR / "ui_components.css").read_text(encoding="utf-8")
    danger = _rule(components, ".qym-inline-action.qym-inline-action--danger {")
    assert "background: color-mix(in srgb, var(--error) 12%, transparent);" in danger
    assert "color: var(--error);" in danger
    assert ".qym-inline-action[hidden]" in components
    assert "display: none;" in components.split(".qym-inline-action[hidden]", 1)[1].split("}", 1)[0]
    assert "Deletion staged. Save changes to delete this issue, or restore it." in dialog
    assert "This issue will be removed when you save." in fields
    assert "data-add-issue>Restore issue" in fields


def test_per_metric_analysis_is_separate_from_output_card():
    source = (DASHBOARD_DIR / "run.html").read_text(encoding="utf-8")
    output = source.split("          let outputBlockHtml = '';", 1)[1].split(
        "          // Collapsed header:", 1
    )[0]
    assert "perMetricAnalysisHtml" not in output
    assert "outputBlockHtml +\n            perMetricAnalysisHtml +" in source
    assert '<span>Per-metric root cause analysis</span></h3>' in source
    assert 'No proposed solution yet.' not in source
    assert 'metric-analysis-subcategory-tag">Subcategory</span>' in source
    assert 'metric-analysis-finding-tag">Finding</span>' in source
    issue_divider = _rule(source, ".metric-analysis-issue:not(:last-child) {")
    assert "border-bottom: 1px solid var(--border-subtle);" in issue_divider
    solution_rule = _rule(source, ".metric-analysis-issue-solution {")
    assert "border-top:" not in solution_rule


def test_run_header_status_and_actions_share_one_height() -> None:
    run = (DASHBOARD_DIR / "run.html").read_text(encoding="utf-8")
    components = (DASHBOARD_DIR / "ui_components.css").read_text(encoding="utf-8")

    assert (
        'class="qym-inline-action qym-inline-action--neutral" '
        'id="export-download-btn"'
    ) in run
    # The page URL is the run's link and the HTML file an export (C059), the
    # header's accent action like the items' CSV export; there is no Copy
    # link or Compare with previous button.
    assert (
        'class="qym-inline-action qym-inline-action--accent" '
        'id="export-share-btn"'
    ) in run
    assert "copy-run-link-btn" not in run
    assert "compare-previous-btn" not in run
    # Previous and next are one capsule, ‹ position ›, with a preview and
    # J / K keys.
    assert '<nav class="hero-pager" id="run-pager"' in run
    assert "const RUN_PAGER_KEYS = { previous: 'K', next: 'J' };" in run
    assert 'role="tooltip"' in run.split("function runPagerHtml()", 1)[1].split("\n      }\n", 1)[0]
    assert "qym-inline-action--langfuse" not in run
    assert "View in Langfuse" not in run
    assert "langfuseChip" not in run
    assert "export-html-btn" not in run
    assert "hero-link-btn" not in run
    assert (
        ".qym-inline-action.qym-inline-action--neutral,\n"
        ".qym-inline-action.qym-inline-action--accent {"
    ) in components
    aligned_cluster = run.split(
        ".hero-right .hero-status.qym-badge,\n"
        "    .hero-actions > .qym-inline-action {",
        1,
    )[1].split("}", 1)[0]
    for contract in (
        "min-height: var(--control-height);",
        "height: var(--control-height);",
        "box-sizing: border-box;",
        "margin-top: 0;",
        "padding-top: 0;",
        "padding-bottom: 0;",
    ):
        assert contract in aligned_cluster
