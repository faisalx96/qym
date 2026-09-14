"""Exercise error-group visibility with the shipped collectors and renderers."""

import pytest

from test_root_cause_issue_javascript import DASHBOARD, _function, _run_javascript


@pytest.mark.parametrize("page", ["run", "compare"])
def test_error_groups_appear_only_when_the_filtered_results_contain_them(page):
    functions = "\n".join(_function(page, name) for name in (
        "normalizeErrorLabel", "splitErrorLabel", "getErrorBucketKey",
        "addErrorBucket", "getErrorFilterSlot", "collectRowErrors",
        "rowMatchesErrorFilter", "rowMatchesActiveErrorFilters",
        "renderErrorDetailHtml", "renderErrorDistributionSection",
    ))
    _run_javascript("const window = {};\n" + (DASHBOARD / "metrics.js").read_text() + functions +
        f"\nconst aggregateMetricErrors = {str(page == 'compare').lower()};\n" + r"""
        const state = {
          runs: [{run: {run_name: 'Run 1'}}], page: 1,
          allMetrics: ['accuracy', 'quality'], selectedItemsMetric: 'accuracy',
        };
        const isRepeatAggregateView = () => false;
        const stringify = value => typeof value === 'string' ? value : JSON.stringify(value);
        const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        const escapeAttr = escapeHtml;
        let aligned = true;
        const canRenderItemComparison = () => aligned;
        const getAlignmentWarningHtml = title => title;
        let cards = [];
        const section = {
          hidden: false, html: '',
          set innerHTML(html) {
            this.html = html;
            cards = [...html.matchAll(/data-error-kind="([^"]*)" data-error-label="([^"]*)"/g)].map(match => ({
              dataset: {errorKind: match[1], errorLabel: match[2]},
              handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; },
            }));
          },
          get innerHTML() { return this.html; },
          querySelectorAll(selector) { return selector === '.error-card[data-error-kind]' ? cards : []; },
        };
        const itemsMetricSelect = {value: 'accuracy'};
        const el = id => id === 'items-metric-select' ? itemsMetricSelect : section;
        const good = {item_id: 'good', status: 'completed', metric_values: [0]};
        const task = {item_id: 'task', status: 'error', error: 'HTTPError: Bad request'};
        const metric = {item_id: 'metric', status: 'completed', metric_meta: {accuracy: {status: 'error', error: 'Judge timed out'}}};
        const trace = {item_id: 'trace', status: 'completed', trace_stats: {provider_errors: 2}};
        const analysis = {item_id: 'analysis', status: 'completed', item_metadata: {analysis_error: 'accuracy: Context limit exceeded'}};
        let rows = [good];
        const getFilteredItems = () => rows.filter(row => rowMatchesActiveErrorFilters(row, 'Run 1', row.item_id))
          .map(row => ({row, rowData: [row], itemId: row.item_id}));
        const renderItems = () => renderErrorDistributionSection();
        const groups = () => [...section.innerHTML.matchAll(/ (Task|Metric|Trace|Analysis) Errors /g)].map(match => match[1]);

        renderItems();
        assert.equal(section.hidden, true);
        assert.equal(section.innerHTML, '');
        rows = [];
        renderItems();
        assert.equal(section.hidden, true);

        for (const [row, name] of [[task, 'Task'], [metric, 'Metric'], [trace, 'Trace'], [analysis, 'Analysis']]) {
          rows = [good, row]; renderItems();
          assert.equal(section.hidden, false);
          assert.deepEqual(groups(), [name]);
          assert.ok(!section.innerHTML.includes('No errors in'));
        }

        if (aggregateMetricErrors) {
          const secondMetric = {item_id: 'metric-2', status: 'completed', metric_meta: {accuracy: {status: 'error', error: 'Judge quota exhausted'}}};
          rows = [metric, secondMetric]; renderItems();
          assert.deepEqual(groups(), ['Metric']);
          assert.equal(cards.length, 1);
          assert.equal(cards[0].dataset.errorLabel, 'accuracy');
          assert.ok(section.innerHTML.includes('Judge timed out · Judge quota exhausted'));
          assert.ok(section.innerHTML.includes('class="error-card-count">2<span'));
          cards[0].handlers.click({target: {closest: () => null}});
          assert.equal(state.metricErrorFilter.label, 'accuracy');
          assert.equal(state.selectedItemsMetric, 'accuracy');
          assert.equal(itemsMetricSelect.value, 'accuracy');
          assert.ok(section.innerHTML.includes('class="error-card-count">2<span'));
          state.metricErrorFilter = null;

          const qualityMetric = {item_id: 'quality-metric', status: 'completed', metric_meta: {quality: {status: 'error', error: 'Quality judge failed'}}};
          rows = [metric, qualityMetric]; renderItems();
          const qualityCard = cards.find(card => card.dataset.errorLabel === 'quality');
          qualityCard.handlers.click({target: {closest: () => null}});
          assert.equal(state.metricErrorFilter.label, 'quality');
          assert.equal(state.selectedItemsMetric, 'quality');
          assert.equal(itemsMetricSelect.value, 'quality');
          state.metricErrorFilter = null;
        }

        // Same shape as the screenshot: 28 analysis errors and no other kinds.
        rows = Array.from({length: 28}, (_, index) => ({...analysis, item_id: 'analysis-' + index}));
        renderItems();
        assert.deepEqual(groups(), ['Analysis']);
        assert.ok(section.innerHTML.includes('class="breakdown-metric">28</span>'));

        rows = [good, task, metric, trace, analysis]; renderItems();
        assert.deepEqual(groups(), ['Task', 'Metric', 'Trace', 'Analysis']);
        assert.ok(section.innerHTML.includes('class="breakdown-metric">2</span>'));
        const analysisCard = cards.find(card => card.dataset.errorKind === 'Analysis error');
        analysisCard.handlers.click({target: {closest: () => null}});
        assert.deepEqual(groups(), ['Analysis']);
        assert.equal(state.analysisErrorFilter.kind, 'Analysis error');
        assert.ok(section.innerHTML.includes('aria-pressed="true"'));
        const activeCard = cards[0];
        activeCard.handlers.keydown({target: activeCard, key: 'Enter', preventDefault() {}});
        assert.equal(state.analysisErrorFilter, null);
        assert.deepEqual(groups(), ['Task', 'Metric', 'Trace', 'Analysis']);

        rows = [good]; renderItems();
        assert.equal(section.hidden, true);
        assert.equal(section.innerHTML, '');
        rows = [task]; renderItems();
        assert.equal(section.hidden, false);
        assert.deepEqual(groups(), ['Task']);
    """ + (r"""
        rows = []; renderItems();
        aligned = false; renderItems();
        assert.equal(section.hidden, true);
        assert.equal(section.innerHTML, '');
        aligned = true; renderItems();
        assert.equal(section.hidden, true);
        rows = [task]; renderItems();
        assert.equal(section.hidden, false);
        assert.deepEqual(groups(), ['Task']);
    """ if page == "compare" else ""))
