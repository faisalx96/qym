"""Execute the production issue-to-solution flow and pass scoping code."""

import pytest

from test_root_cause_issue_javascript import DASHBOARD, _function, _run_javascript


@pytest.mark.parametrize("page", ["run", "compare"])
def test_flow_uses_each_issue_solution_and_refreshes_after_changes(page):
    functions = "\n".join(_function(page, name) for name in (
        "rootCauseCategories", "rootCauseIssues", "getRowRootCauseAnalyses",
        "renderSankeyDiagram", "drawSankeyPaths",
    ))
    _run_javascript(functions + r"""
        const state = {allMetrics: ['accuracy', 'style'], runs: []};
        const MAX_ROOT_CAUSE_CATEGORIES = 3;
        const UNASSIGNED_SOLUTION_LABEL = 'No solution assigned';
        const SOLUTION_COLORS = Object.create(null);
        const isRepeatAggregateView = () => false;
        const rootCauseColor = () => '#00ccaa';
        const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        const escapeAttr = escapeHtml;
        const getRowCompareId = row => row.item_id;
        const wireSankeyHover = () => {};
        const requestAnimationFrame = callback => callback();
        const svg = {innerHTML: '', style: {}, parentElement: {clientHeight: 240}, setAttribute() {}};
        const container = {
          innerHTML: '',
          querySelector(selector) {
            if (selector === '#sankey-svg') return svg;
            return {getBoundingClientRect: () => ({top: 0, width: 900})};
          },
          querySelectorAll(selector) {
            const kind = selector.includes('-rc') ? 'rc' : 'sol';
            const pattern = new RegExp('data-sankey-' + kind + '="([^"]*)"', 'g');
            return [...this.innerHTML.matchAll(pattern)].map((match, i) => ({
              dataset: {[kind === 'rc' ? 'sankeyRc' : 'sankeySol']: match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&')},
              getBoundingClientRect: () => ({top: 40 * i, height: 32}),
            }));
          },
        };
        const document = {getElementById: () => container};
        const issueA = {category: 'Agent', solution: 'Prompt fix', solution_note: 'Keep these notes', review_status: 'pending'};
        const issueB = {category: 'Evaluator', solution: 'Judge fix', review_status: 'approved'};
        const accuracy = {root_cause_issues: [issueA, issueB], solution: 'Hidden old shared', solution_note: 'Old notes'};
        const row = {item_id: 'one', item_metadata: {metric_analyses: {
          accuracy, style: {root_cause_issues: [{category: 'Style', solution: 'Style fix'}]},
        }}};
        const excluded = {item_id: 'excluded', item_metadata: {metric_analyses: {accuracy: {root_cause_issues: [{category: 'Exclude', solution: 'Exclude fix'}]}}}};
        const rows = [row, excluded];
        state.runs = [{snapshot: {rows}}];
        const render = metric => {
          svg.innerHTML = '';
          if (renderSankeyDiagram.length === 3) renderSankeyDiagram(rows, new Set(['one']), metric);
          else renderSankeyDiagram(new Set(['one']), metric);
          return [...svg.innerHTML.matchAll(/data-sankey-link-rc="([^"]*)" data-sankey-link-sol="([^"]*)" data-sankey-count="(\d+)"/g)]
            .map(match => [match[1], match[2], Number(match[3])]);
        };
        const original = JSON.stringify(rows);
        assert.deepEqual(render('accuracy'), [['Agent', 'Prompt fix', 1], ['Evaluator', 'Judge fix', 1]]);
        assert.equal(JSON.stringify(rows), original, 'Rendering must not mutate stored data');
        assert.ok(!container.innerHTML.includes('Hidden old shared'));
        assert.deepEqual(render('style'), [['Style', 'Style fix', 1]]);
        assert.equal(render('all').length, 3);
        assert.equal(rootCauseIssues(accuracy)[0].solution_note, 'Keep these notes');

        // Add two issues, including a duplicate category, then edit and clear.
        accuracy.root_cause_issues.push({category: 'Agent', solution: 'Prompt fix'}, {category: 'Agent', solution: 'Guardrail fix'});
        assert.deepEqual(render('accuracy'), [['Agent', 'Prompt fix', 2], ['Evaluator', 'Judge fix', 1], ['Agent', 'Guardrail fix', 1]]);
        issueA.solution = 'New prompt';
        assert.ok(render('accuracy').some(([rc, sol, count]) => rc === 'Agent' && sol === 'New prompt' && count === 1));
        issueA.solution = '   ';
        assert.ok(!render('accuracy').some(([, sol]) => sol === 'New prompt' || sol === 'Hidden old shared'));
        assert.ok(render('accuracy').some(([rc, sol, count]) => rc === 'Agent' && sol === 'No solution assigned' && count === 1));
        accuracy.root_cause_issues = [issueA];
        assert.deepEqual(render('accuracy'), [['Agent', 'No solution assigned', 1]]);
        assert.ok(container.innerHTML.includes('1 issue'));
        accuracy.root_cause_issues = [];
        accuracy.root_causes = ['Stale category'];
        assert.deepEqual(render('accuracy'), []);
        delete accuracy.root_cause_issues;
        assert.deepEqual(render('accuracy'), [], 'Legacy category plus shared solution is not an issue-owned fix');

        // User text must remain a complete pair and never become markup.
        accuracy.root_cause_issues = [{category: 'Agent|||detail', solution: 'Fix|||<tag> & "quote"'}];
        assert.deepEqual(render('accuracy'), [['Agent|||detail', 'Fix|||&lt;tag> &amp; &quot;quote&quot;', 1]]);
        assert.ok(!container.innerHTML.includes('<tag>'));
        accuracy.error = 'Analysis failed';
        assert.deepEqual(render('accuracy'), []);
    """)


def test_run_flow_sums_issue_solutions_across_passes_without_parent_fallback():
    functions = "\n".join(_function("run", name) for name in (
        "rootCauseCategories", "rootCauseIssues", "getRowRootCauseAnalyses",
    ))
    _run_javascript(functions + """
        const state = {allMetrics: ['accuracy', 'style']};
        const MAX_ROOT_CAUSE_CATEGORIES = 3;
        const UNASSIGNED_SOLUTION_LABEL = 'No solution assigned';
        const isRepeatAggregateView = () => true;
        const diagnosis = solution => ({root_cause_issues: [{category: 'Agent', solution}]});
        const row = {
          item_metadata: {metric_analyses: {accuracy: diagnosis('Parent only')}},
          pass_metric_analyses: {accuracy: [diagnosis('Pass 1 fix'), diagnosis('Pass 2 fix'), null], style: [null, diagnosis('Style fix')]},
        };
        const analyses = getRowRootCauseAnalyses(row, 'accuracy');
        assert.deepEqual(analyses.map(value => value.pass_number), [1, 2]);
        assert.deepEqual(analyses.flatMap(value => rootCauseIssues(value).map(issue => issue.solution)), ['Pass 1 fix', 'Pass 2 fix']);
        assert.equal(getRowRootCauseAnalyses(row, 'all').length, 3);
    """)


@pytest.mark.parametrize("page", ["run", "compare"])
def test_pass_diagnosis_metadata_never_inherits_parent_solutions(page):
    _run_javascript(_function(page, "scopedPassItemMetadata") + """
        const one = {root_cause_issues: [{category: 'Agent', solution: 'First'}]};
        const two = {root_cause_issues: [{category: 'Agent', solution: 'Second'}]};
        const row = {item_metadata: {
          custom: {keep: true}, root_cause: 'Stale', root_causes: ['Stale'], root_cause_categories: ['Stale'],
          root_cause_issues: [{category: 'Stale', solution: 'Stale fix'}], root_cause_reason: 'Stale reason',
          solution: 'Shared', solution_note: 'Preserve in source', metric_analyses: {accuracy: {solution: 'Parent'}},
        }, pass_metric_analyses: {accuracy: [one, two]}};
        const before = JSON.stringify(row);
        assert.deepEqual(scopedPassItemMetadata(row.item_metadata, row, ['accuracy'], 1), {custom: {keep: true}, metric_analyses: {accuracy: one}});
        assert.deepEqual(scopedPassItemMetadata(row.item_metadata, row, ['accuracy'], 2), {custom: {keep: true}, metric_analyses: {accuracy: two}});
        assert.deepEqual(scopedPassItemMetadata(row.item_metadata, row, ['accuracy'], 3), {custom: {keep: true}});
        assert.equal(JSON.stringify(row), before);
    """)


def test_compare_pass_load_and_save_keep_chart_solution_scope():
    functions = "\n".join(_function("compare", name) for name in (
        "rootCauseCategories", "rootCauseIssues", "getRowRootCauseAnalyses",
        "scopedPassItemMetadata", "sliceRunToPass", "passRefBase",
        "invalidateComparisonRowIndex", "applyUpdatedRowToRun",
    ))
    _run_javascript(functions + """
        const PASS_REF_SEP = '::pass';
        const MAX_ROOT_CAUSE_CATEGORIES = 3;
        const getCompareRowSummary = () => ({failed: 0});
        const comparisonRowIndexes = new WeakMap();
        const comparisonDetails = new Map();
        const window = {QymMetrics: {isErrorRow: () => false, isTaskErrorRow: () => false}};
        const diagnosis = solution => ({root_cause_issues: [{category: 'Agent', solution}]});
        const row = {index: 0, item_id: 'one', item_metadata: {metric_analyses: {accuracy: diagnosis('Parent')}}, pass_metric_analyses: {accuracy: [diagnosis('First'), diagnosis('Second')]}};
        const parent = {run: {file_path: 'run', samples: 2}, snapshot: {metric_names: ['accuracy'], rows: [row]}};
        const state = {allMetrics: ['accuracy'], runs: [1, 2, 3].map(pass => sliceRunToPass(parent, 'run::pass' + pass, pass))};
        const solutions = index => getRowRootCauseAnalyses(state.runs[index].snapshot.rows[0], 'all').flatMap(analysis => rootCauseIssues(analysis).map(issue => issue.solution));
        assert.deepEqual(solutions(0), ['First']);
        assert.deepEqual(solutions(1), ['Second']);
        assert.deepEqual(solutions(2), []);
        const updated = JSON.parse(JSON.stringify(row));
        updated.pass_metric_analyses.accuracy[1] = diagnosis('Updated second');
        applyUpdatedRowToRun(1, updated);
        assert.deepEqual(solutions(1), ['Updated second']);
        assert.deepEqual(solutions(0), ['First']);
        assert.equal(row.item_metadata.metric_analyses.accuracy.root_cause_issues[0].solution, 'Parent');
    """)


def test_legacy_shared_solution_block_is_not_rendered():
    source = (DASHBOARD / "run.html").read_text()
    assert 'Shared · legacy' not in source
    assert 'metric-analysis-shared-solution' not in source
    assert 'renderMetricRootCauseIssues(analysis, itemId, metricName, legacyReview)' in source
    assert 'renderMetricAnalysisCard(itemId, metricName, metricAnalyses[metricName], row.review_corrections?.[metricName])' in source


@pytest.mark.parametrize("page", ["run", "compare"])
def test_flow_resize_preserves_issue_solution_pairs(page):
    _run_javascript(_function(page, "wireSankeyHover") + """
        let _sankeyResizeObserver = null, _sankeyResizeTimeout = null;
        const clearTimeout = () => {};
        const setTimeout = callback => callback();
        const ResizeObserver = class {
          constructor(callback) { this.callback = callback; }
          observe() { this.callback(); }
          disconnect() {}
        };
        let decoded;
        const drawSankeyPaths = (container, entries) => { decoded = entries.map(([key, count]) => [...JSON.parse(key), count]); };
        const container = {
          isConnected: true, addEventListener() {}, removeEventListener() {},
          querySelector: () => ({}),
          querySelectorAll: () => [{dataset: {sankeyLinkRc: 'Agent|||one', sankeyLinkSol: 'Fix|||two', sankeyCount: '3'}}],
        };
        wireSankeyHover(container);
        assert.deepEqual(decoded, [['Agent|||one', 'Fix|||two', 3]]);
    """)
