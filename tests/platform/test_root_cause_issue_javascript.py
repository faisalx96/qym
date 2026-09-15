"""Execute production dashboard functions with Node, including real events."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest


DASHBOARD = (
    Path(__file__).resolve().parents[2]
    / "packages/platform/qym_platform/_static/dashboard"
)


def _function(page: str, name: str) -> str:
    source = (DASHBOARD / f"{page}.html").read_text()
    start = re.search(rf"^      (?:async )?function {name}\(", source, re.MULTILINE)
    assert start, name
    end = re.search(r"^      }$", source[start.start() :], re.MULTILINE)
    assert end, name
    return source[start.start() : start.start() + end.end()]


def _run_javascript(script: str) -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required for dashboard behavior tests")
    result = subprocess.run(
        [node],
        input=(
            "const assert = require('node:assert/strict');\n"
            "async function test() {\n" + script + "\n}\n"
            "test().catch(error => { console.error(error); process.exitCode = 1; });"
        ),
        text=True,
        capture_output=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def _playground_with_test_exports(*names: str) -> str:
    """Expose selected closure helpers only inside a Node regression test."""
    source = (DASHBOARD / "playground.js").read_text(encoding="utf-8")
    marker = "  return {\n    init: init,"
    assert marker in source
    exports = "".join(f"    __test_{name}: {name},\n" for name in names)
    return source.replace(marker, "  return {\n" + exports + "    init: init,", 1)


def test_playground_keeps_failed_verdicts_available_for_analysis() -> None:
    playground = _playground_with_test_exports("_getMatchedItems").replace(
        "  var _opts = {};", "  var _opts = {getRows: () => rows};", 1
    )
    _run_javascript(
        """
        const document = {getElementById: () => null};
        const window = {};
        const rows = [null, false, 0, '', '   '].map((error, index) => ({
          item_id: String(index), metric_scores: {accuracy: 0},
          metric_metadata_by_metric: {accuracy: {label: 'failed', error}},
        }));
        rows.push({item_id:'metric-error', metric_scores:{accuracy:0},
          metric_metadata_by_metric:{accuracy:{status:'error'}}});
        rows.push({item_id:'task-error', error:'Task failed', metric_scores:{accuracy:0}});
        """
        + f"eval({json.dumps(playground)});\n"
        + """
        const matched = window.QymPlayground.__test__getMatchedItems();
        assert.deepEqual(matched.map(row => row.item_id), ['0','1','2','3','4']);
        assert.ok(matched.every(row => row._matched_metric_names.join() === 'accuracy'));
        """
    )


def test_auto_analysis_completion_reports_errors_instead_of_success() -> None:
    playground = _playground_with_test_exports(
        "_analysisCompletionState",
        "_analysisErrorSummaryMarkup",
    )
    _run_javascript(
        """
        const document = {createElement: () => {
          let escaped = '';
          return {
            set textContent(value) {
              escaped = String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            },
            get innerHTML() { return escaped; },
          };
        }};
        const window = {};
        """
        + f"eval({json.dumps(playground)});\n"
        + """
        const completionState = window.QymPlayground.__test__analysisCompletionState;
        const errorMarkup = window.QymPlayground.__test__analysisErrorSummaryMarkup;

        const failed = completionState({
          total_analyzed: 1,
          total_attempted: 1,
          total_persisted: 0,
          total_analysis_failed: 1,
          errors: 1,
          results: [{
            item_id: 'item-1',
            metric_name: 'accuracy_score',
            error_code: 'context_limit_exceeded',
            error: 'Prompt is too large <unsafe>',
          }],
        });
        assert.equal(failed.attemptedCount, 1);
        assert.equal(failed.successfulCount, 0);
        assert.equal(failed.errorCount, 1);
        assert.equal(failed.allAnalysisFailed, true);
        const html = errorMarkup(failed.errorResults, failed.errorCount, failed.attemptedCount);
        assert.match(html, /context_limit_exceeded/);
        assert.ok(!html.includes('item-1'));
        assert.ok(!html.includes('accuracy_score'));
        assert.ok(!html.includes('Prompt is too large'));
        assert.ok(!html.includes('1 error'));

        const partial = completionState({
          total_attempted: 3,
          total_persisted: 2,
          errors: 1,
          results: [{error: 'Timed out'}],
        });
        assert.equal(partial.successfulCount, 2);
        assert.equal(partial.allAnalysisFailed, false);
        assert.equal(partial.hasAnalysisErrors, true);

        const protectedSuccess = completionState({
          total_attempted: 1,
          total_persisted: 0,
          total_skipped_human: 1,
          errors: 0,
          results: [{persistence_status: 'skipped_human_protection'}],
        });
        assert.equal(protectedSuccess.successfulCount, 1);
        assert.equal(protectedSuccess.hasAnalysisErrors, false);

        const mixedHtml = errorMarkup([
          {error_code: 'context_limit_exceeded', error: 'First description', item_id: 'hidden-1'},
          {error_code: 'context_limit_exceeded', error: 'Second description', item_id: 'hidden-2'},
          {error_code: 'analysis_timeout', error: 'Third description', item_id: 'hidden-3'},
        ], 3, 5);
        assert.equal((mixedHtml.match(/context_limit_exceeded/g) || []).length, 1);
        assert.equal((mixedHtml.match(/analysis_timeout/g) || []).length, 1);
        assert.ok(mixedHtml.includes('2 errors'));
        assert.ok(mixedHtml.includes('1 error'));
        assert.ok(!mixedHtml.includes('description'));
        assert.ok(!mixedHtml.includes('hidden-'));
        """
    )


def test_metric_analysis_is_shown_only_for_failed_or_errored_judges() -> None:
    function = _function("run", "shouldRenderMetricAnalysis")
    _run_javascript(
        function
        + """
        const metricErrors = new Set();
        const state = {
          metricTypes: {
            passing_boolean: 'boolean',
            failing_boolean: 'boolean',
            passing_score: 'score',
            failing_score: 'score',
            zero_threshold: 'score',
            observation: 'numeric',
            broken_judge: 'score',
          },
          metricIsBoolean: {
            passing_boolean: true,
            failing_boolean: true,
          },
          metricThresholds: {
            passing_score: 0.8,
            failing_score: 0.8,
            zero_threshold: 0,
          },
        };
        const window = {QymMetrics: {
          isTaskErrorRow: row => ['error', 'failed'].includes(String(row?.status || '').toLowerCase()),
          hasMetricError: (_row, metricName) => metricErrors.has(metricName),
          parseScoreValue: value => {
            if (value === true || String(value).toLowerCase() === 'true') return 1;
            if (value === false || String(value).toLowerCase() === 'false') return 0;
            if (value == null || String(value).trim() === '') return null;
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
          },
        }};
        const completedRow = {status: 'completed'};

        assert.equal(shouldRenderMetricAnalysis(completedRow, 'passing_boolean', true), false);
        assert.equal(shouldRenderMetricAnalysis(completedRow, 'failing_boolean', false), true);
        assert.equal(shouldRenderMetricAnalysis(completedRow, 'passing_score', 0.8), false);
        assert.equal(shouldRenderMetricAnalysis(completedRow, 'failing_score', 0.79), true);
        assert.equal(shouldRenderMetricAnalysis(completedRow, 'zero_threshold', 0), false);
        assert.equal(shouldRenderMetricAnalysis(completedRow, 'observation', 0), false);
        assert.equal(shouldRenderMetricAnalysis(completedRow, 'passing_score', null), false);

        metricErrors.add('broken_judge');
        assert.equal(shouldRenderMetricAnalysis(completedRow, 'broken_judge', 0), true);

        // Task errors own the failure: metric analysis must stay hidden even
        // if stale metric-error metadata is present on the same row.
        assert.equal(shouldRenderMetricAnalysis({status: 'error'}, 'broken_judge', 0), false);
        assert.equal(shouldRenderMetricAnalysis(completedRow, 'broken_judge', 0, true), false);

        const allPassingMetrics = [
          ['passing_boolean', true],
          ['passing_score', 0.95],
          ['observation', 42],
        ].filter(([name, value]) => shouldRenderMetricAnalysis(completedRow, name, value));
        assert.deepEqual(allPassingMetrics, []);
        """
    )


@pytest.mark.parametrize("page", ["run", "compare"])
def test_item_level_chart_preserves_all_issues(page: str) -> None:
    functions = "\n".join(
        _function(page, name)
        for name in (
            "rootCauseCategories",
            "rootCauseIssues",
            "getRowRootCauseAnalyses",
        )
    )
    _run_javascript(
        functions
        + """
        const state = { allMetrics: ['accuracy'] };
        const MAX_ROOT_CAUSE_CATEGORIES = 3;
        const isRepeatAggregateView = () => false;
        const issues = [
          {category: 'Agent', subcategory: 'Lookup', finding: 'First finding'},
          {category: 'Agent', subcategory: 'Filter', finding: 'Second finding'},
        ];
        const row = {item_metadata: {
          root_cause_issues: issues, root_causes: ['Agent'],
          root_cause: 'Agent', root_cause_detail: 'Lookup', root_cause_note: 'First finding',
        }};
        const chartIssues = getRowRootCauseAnalyses(row, 'all').flatMap(rootCauseIssues);
        assert.equal(chartIssues.length, 2);
        assert.deepEqual(chartIssues.map(issue => issue.subcategory), ['Lookup', 'Filter']);
        assert.deepEqual(chartIssues.map(issue => issue.finding), ['First finding', 'Second finding']);
        row.item_metadata.root_cause_issues = [];
        assert.deepEqual(getRowRootCauseAnalyses(row, 'all'), []);
        delete row.item_metadata.root_cause_issues;
        row.item_metadata.root_causes = ['Agent', 'Evaluator'];
        const legacy = getRowRootCauseAnalyses(row, 'all').flatMap(rootCauseIssues);
        assert.deepEqual(legacy.map(issue => issue.finding), ['First finding', 'First finding']);
    """
    )


@pytest.mark.parametrize("scope_kind", ["metric", "pass", "legacy", "new"])
def test_compare_displays_and_saves_the_same_scope(scope_kind: str) -> None:
    functions = "\n".join(
        _function("compare", name)
        for name in (
            "rootCauseCategories",
            "rootCauseIssues",
            "rootCauseIssuePatch",
            "passRefBase",
            "compareRootCauseScope",
            "compareExecutionErrorInfo",
            "renderCompareOutputGroup",
            "wireRootCauseHandlers",
            "saveRootCauseIssues",
        )
    )
    _run_javascript(
        "const window = {};\n"
        + (DASHBOARD / "metrics.js").read_text()
        + "\n"
        + functions
        + f"\nconst scopeKind = '{scope_kind}';\n"
        + """
        const PASS_REF_SEP = '::pass';
        const MAX_ROOT_CAUSE_CATEGORIES = 3;
        const IS_COMPARE_EXPORT = false;
        const issues = finding => [{category: 'Agent', subcategory: 'Lookup', finding}];
        const row = {
          item_id: 'raw-item', status: 'completed', metric_values: [0, 0],
          item_metadata: {
            root_cause_issues: issues('Stale summary'), root_cause_metric_name: 'accuracy',
            metric_analyses: {
              accuracy: {root_cause_issues: issues('Accuracy finding')},
              style: {root_cause_issues: issues('Style finding')},
            },
          },
          pass_metric_analyses: {
            style: [
              {root_cause_issues: issues('First pass finding')},
              {root_cause_issues: issues('Second pass finding')},
            ],
          },
        };
        const expectedFinding = scopeKind === 'pass' ? 'Second pass finding'
          : scopeKind === 'legacy' ? 'Legacy finding' : 'Style finding';
        if (scopeKind === 'legacy') row.item_metadata = {root_cause_issues: issues('Legacy finding')};
        if (scopeKind === 'new') row.item_metadata = {};
        const state = {
          selectedItemsMetric: 'style', allMetrics: ['accuracy', 'style'],
          metricIsBoolean: {}, metricThresholds: {}, visibleMetricMetaFields: {},
          rootCauseValues: [], runs: [{
            run: {file_path: scopeKind === 'pass' ? 'run-1::pass2' : 'run-1'},
            snapshot: {metric_names: ['accuracy', 'style'], rows: [row]},
          }],
        };
        const COLORS = ['green'];
        const OPEN_LINK_ICON = '', COPY_ICON = '', SAVE_ICON = '', CLOSE_ICON = '', EDIT_ICON = '';
        const escapeAttr = value => String(value || '');
        const escapeHtml = escapeAttr, renderMarkdownSafe = escapeAttr, apiUrl = escapeAttr;
        const rootCauseColor = () => 'green';
        const buildLangfuseTraceUrl = () => '';
        const buildLangfuseTraceUrlFromRun = () => '';
        const html = renderCompareOutputGroup('compare-item', [row]);
        if (scopeKind !== 'new') assert.ok(html.includes(expectedFinding), html);
        assert.ok(!html.includes('Stale summary'));
        assert.ok(!html.includes('Accuracy finding'));
        const metricName = scopeKind === 'legacy' ? '' : 'style';
        assert.ok(html.includes('data-rc-issues-metric="' + metricName + '"'));

        const trigger = new EventTarget();
        trigger.dataset = {rcIssuesItem: 'compare-item', rcIssuesRunIdx: '0', rcIssuesMetric: metricName};
        let opened;
        const showRootCauseIssuesEditor = (...args) => { opened = args; };
        wireRootCauseHandlers({querySelectorAll: selector => selector === '[data-rc-issues-item]' ? [trigger] : []});
        trigger.dispatchEvent(new Event('click'));
        assert.deepEqual(opened, ['compare-item', 0, metricName]);

        // Changing the page selection must not retarget an already open editor.
        state.selectedItemsMetric = 'accuracy';
        let request;
        const fetch = async (_url, options) => {
          request = JSON.parse(options.body);
          return {ok: true, json: async () => ({ok: true})};
        };
        const findRowByCompareId = rows => rows[0];
        const buildCategoryDropdowns = () => {};
        const renderItems = () => {};
        const edited = issues('Reviewed finding');
        assert.equal(await saveRootCauseIssues('compare-item', 0, edited, metricName), true);
        assert.equal(request.run_id, 'run-1');
        assert.equal(request.item_id, 'raw-item');
        assert.equal(request.metric_name, metricName || undefined);
        assert.equal(request.pass_number, scopeKind === 'pass' ? 2 : undefined);
        assert.deepEqual(request.root_cause_issues, edited);
        const updated = compareRootCauseScope(row, 0, metricName);
        assert.deepEqual(updated.analysis.root_cause_issues, edited);
        if (scopeKind === 'metric' || scopeKind === 'pass') {
          assert.equal(row.item_metadata.metric_analyses.accuracy.root_cause_issues[0].finding, 'Accuracy finding');
          assert.equal(row.item_metadata.root_cause_issues[0].finding, 'Stale summary');
        }
        if (scopeKind === 'pass') {
          assert.equal(row.pass_metric_analyses.style[0].root_cause_issues[0].finding, 'First pass finding');
        }
    """
    )


@pytest.mark.parametrize("page", ["compare"])
@pytest.mark.parametrize("failure", ["false", "reject"])
def test_issue_editor_restores_save_button_and_allows_retry(
    page: str, failure: str
) -> None:
    editor = _function(page, "showRootCauseIssuesEditor")
    start = editor.index("editor.querySelector('[data-save-issues]').addEventListener(")
    end = editor.index("\n        });", start) + len("\n        });")
    handler = editor[start:end]
    _run_javascript(
        f"const failure = '{failure}';\n"
        + """
        const button = new EventTarget();
        const editor = {querySelector: () => button};
        const classes = new Set();
        const status = {textContent: '', classList: {
          add: value => classes.add(value), remove: value => classes.delete(value),
        }};
        const issues = [{category: 'Agent', subcategory: 'Lookup', finding: 'Finding'}];
        const itemId = 'item-1', metricName = 'accuracy', runIdx = 0;
        const readRows = () => {};
        let closed = false;
        const cleanup = () => { closed = true; };
        let resolveSave, rejectSave;
        const saveRootCauseIssues = () => new Promise((resolve, reject) => {
          resolveSave = resolve; rejectSave = reject;
        });
    """
        + handler
        + """
        button.dispatchEvent(new Event('click'));
        assert.equal(button.disabled, true);
        if (failure === 'reject') rejectSave(new Error('Connection lost'));
        else resolveSave(false);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(button.disabled, false);
        assert.equal(closed, false);
        assert.equal(status.textContent, 'Could not save these issues.');
        assert.ok(classes.has('is-error'));
        button.dispatchEvent(new Event('click'));
        assert.equal(button.disabled, true);
        resolveSave(true);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(button.disabled, false);
        assert.equal(closed, true);
        assert.ok(!classes.has('is-error'));
    """
    )


def _diagnosis_functions() -> str:
    return "\n".join(_function("run", name) for name in (
        "rootCauseCategories", "rootCauseIssues", "rootCauseIssuePatch",
        "metricIssueContent", "metricAnalysisKey", "createMetricDiagnosisDraft", "selectMetricDiagnosisSolution",
        "saveMetricDiagnosisDraft"))


def test_issue_popup_preserves_draft_and_blocks_duplicate_save() -> None:
    _run_javascript(_diagnosis_functions() + """
        const state = {run:{file_path:'run-1'},viewPass:2,snapshot:{rows:[{item_id:'item-1',
          item_metadata:{metric_analyses:{accuracy:{root_cause_issues:[{category:'Agent',finding:'Saved'}]}}}}]}};
        const draft = createMetricDiagnosisDraft('item-1','accuracy');
        draft.issues[0].finding = ' Missing filter '; draft.solution = ' Add a filter ';
        let resolveSave, rejectSave, request, calls = 0;
        const saveMetricIssueAction = (itemId,metricName,payload) => {
          calls++; request={itemId,metricName,payload};
          return new Promise((resolve,reject)=>{resolveSave=resolve;rejectSave=reject;});
        };
        const first=saveMetricDiagnosisDraft('item-1','accuracy',draft);
        assert.equal(draft.saving,true);
        assert.equal(await saveMetricDiagnosisDraft('item-1','accuracy',draft),false);
        assert.equal(calls,1);
        rejectSave(new Error('Connection interrupted'));
        assert.equal(await first,false); assert.equal(draft.saving,false);
        assert.equal(draft.issues[0].finding,' Missing filter ');
        assert.match(draft.message,/Your draft is still here/);
        const retry=saveMetricDiagnosisDraft('item-1','accuracy',draft);resolveSave(true);
        assert.equal(await retry,true);
        assert.deepEqual(request.payload.issue,{category:'Agent',subcategory:'',finding:'Missing filter',solution:'Add a filter',solution_note:''});
        assert.equal(request.payload.issue_index,0);assert.equal(request.payload.action,'edit');
        assert.equal(request.payload.expected_issue.finding,'Saved');
    """)


@pytest.mark.parametrize("mode", ["add", "edit"])
def test_issue_popup_requires_category(mode: str) -> None:
    _run_javascript(_diagnosis_functions() + f"\nconst mode='{mode}';\n" + """
        const state={run:{file_path:'run-1'},snapshot:{rows:[{item_id:'item-1',item_metadata:{metric_analyses:{accuracy:{root_cause_issues:[{category:'Agent'}]}}}}]}};
        const saveMetricIssueAction=()=>{throw new Error('Must not send invalid issues');};
        const draft=createMetricDiagnosisDraft('item-1','accuracy',mode);
        draft.issues=[{category:'  ',finding:'No category'}];
        assert.equal(await saveMetricDiagnosisDraft('item-1','accuracy',draft),false);
        assert.equal(draft.invalidIndex,0);assert.match(draft.message,/Every issue needs a category/);
    """)


def test_edit_opens_only_selected_issue_with_own_fields_and_does_not_mutate_siblings() -> None:
    _run_javascript(_diagnosis_functions() + """
        const one={issue_id:'one',category:'Agent',finding:'First',solution:'First fix',review_status:'approved'};
        const two={issue_id:'two',category:'Evaluator',subcategory:'Subtype',finding:'Second',solution:'Second fix',solution_note:'Second note',category_reason:'Saved why',confidence:.9};
        const analysis={root_cause_issues:[one,two],solution:'Legacy shared'};
        const state={run:{file_path:'run-1'},viewPass:1,snapshot:{rows:[{item_id:'item-1',item_metadata:{metric_analyses:{accuracy:analysis}}}]}};
        const draft=createMetricDiagnosisDraft('item-1','accuracy','edit',1);
        assert.equal(draft.issues.length,1);assert.equal(draft.issueId,'two');assert.equal(draft.issueIndex,1);
        assert.equal(draft.issues[0].finding,'Second');assert.equal(draft.issues[0].category_reason,'Saved why');
        assert.equal(draft.solution,'Second fix');assert.equal(draft.solution_note,'Second note');
        draft.issues[0].finding='Unsaved';draft.solution='Unsaved fix';
        assert.equal(two.finding,'Second');assert.equal(one.review_status,'approved');
        const added=createMetricDiagnosisDraft('item-1','accuracy','add');
        assert.deepEqual(added.issues,[{}]);assert.equal(added.solution,'');assert.equal(added.solution_note,'');
        assert.equal(createMetricDiagnosisDraft('item-1','missing','edit'),null);
        state.viewPass=2;
        assert.equal(await saveMetricDiagnosisDraft('item-1','accuracy',draft),false);
        assert.match(draft.message,/run or pass changed/);
    """)


def test_open_issue_draft_is_rejected_when_refresh_renumbers_the_same_pass() -> None:
    _run_javascript(_diagnosis_functions() + """
        const state={run:{file_path:'run-1',metadata:{pass_revision:0}},viewPass:2,
          snapshot:{rows:[{item_id:'item-1',item_metadata:{metric_analyses:{accuracy:{root_cause_issues:[]}}}}]}};
        const draft=createMetricDiagnosisDraft('item-1','accuracy','add');
        draft.issues=[{category:'Agent',finding:'Draft for the original second pass'}];
        let writes=0;
        const saveMetricIssueAction=async()=>{writes++;return true;};
        // The post-aggregation GET refreshes the run, while the popup remains open.
        state.run={file_path:'run-1',metadata:{pass_revision:1}};
        assert.equal(state.viewPass,2);
        assert.equal(await saveMetricDiagnosisDraft('item-1','accuracy',draft),false);
        assert.equal(writes,0);
        assert.match(draft.message,/run or pass changed/);
        const fresh=createMetricDiagnosisDraft('item-1','accuracy','add');
        fresh.issues=[{category:'Agent',finding:'Fresh draft for the current second pass'}];
        assert.equal(await saveMetricDiagnosisDraft('item-1','accuracy',fresh),true);
        assert.equal(writes,1);
    """)


def test_issue_solution_only_and_noop_save_preserve_other_issue_evidence() -> None:
    _run_javascript(_diagnosis_functions() + """
        const ADD_NEW_SOLUTION_VALUE='__qym_add_new_solution__';
        const issue={issue_id:'one',category:'Agent',finding:'Evidence',solution:'Existing fix',solution_note:'Notes',category_reason:'Trace',review_status:'approved'};
        const state={run:{file_path:'run-1'},snapshot:{rows:[{item_id:'item-1',item_metadata:{metric_analyses:{accuracy:{root_cause_issues:[issue]}}}}]}};
        const requests=[];const saveMetricIssueAction=async(_item,_metric,request)=>{requests.push(request);return true;};
        const draft=createMetricDiagnosisDraft('item-1','accuracy');
        assert.equal(await saveMetricDiagnosisDraft('item-1','accuracy',draft),true);assert.equal(requests.length,0);
        selectMetricDiagnosisSolution(draft,'');
        assert.equal(await saveMetricDiagnosisDraft('item-1','accuracy',draft),true);
        assert.equal(requests[0].issue.solution,'');assert.equal(requests[0].issue.solution_note,'');
        assert.equal(requests[0].issue_id,'one');assert.equal(requests[0].expected_issue.solution,'Existing fix');
        assert.ok(!('review_status' in requests[0].issue));assert.equal(issue.review_status,'approved');
    """)


def test_add_many_issue_requests_never_send_the_existing_issue_list() -> None:
    _run_javascript(_diagnosis_functions() + """
        const original={category:'Agent',finding:'Original',solution:'First fix',review_status:'approved'};
        const analysis={root_cause_issues:[original],solution:'Legacy shared'};
        const state={run:{file_path:'run-1'},snapshot:{rows:[{item_id:'item-1',item_metadata:{metric_analyses:{accuracy:analysis}}}]}};
        const saveMetricIssueAction=async(_item,_metric,request)=>{
          assert.equal(request.action,'add');assert.ok(!('root_cause_issues' in request));
          analysis.root_cause_issues.push(request.issue);return true;
        };
        for(let index=0;index<6;index++){
          const draft=createMetricDiagnosisDraft('item-1','accuracy','add');
          draft.issues[0]={category:'Evaluator',finding:'Added '+index};draft.solution='Fix '+index;
          assert.equal(await saveMetricDiagnosisDraft('item-1','accuracy',draft),true);
        }
        assert.equal(analysis.root_cause_issues.length,7);assert.equal(analysis.root_cause_issues[0],original);
        assert.equal(original.review_status,'approved');assert.equal(analysis.solution,'Legacy shared');
    """)


def test_remove_issue_request_carries_only_its_stable_target() -> None:
    _run_javascript(_diagnosis_functions() + """
        const state={run:{file_path:'run-1'},snapshot:{rows:[{item_id:'item-1',item_metadata:{metric_analyses:{accuracy:{root_cause_issues:[{issue_id:'one',category:'Agent'},{issue_id:'two',category:'Agent'}]}}}}]}};
        let request;const saveMetricIssueAction=async(_item,_metric,value)=>{request=value;return true;};
        const draft=createMetricDiagnosisDraft('item-1','accuracy','edit',1);draft.issues=[];
        assert.equal(await saveMetricDiagnosisDraft('item-1','accuracy',draft),true);
        assert.equal(request.action,'delete');assert.equal(request.issue_id,'two');assert.equal(request.issue_index,1);
    """)


def test_add_and_issue_edit_share_popup_with_all_original_fields() -> None:
    functions="\n".join(_function("run",name) for name in (
        "rootCauseIssues","wireMetricAnalysisHandlers","showRootCauseIssuesEditor","metricDiagnosisSolutionOptions","selectMetricDiagnosisSolution","metricIssueGuidanceHtml","renderMetricDiagnosisFields"))
    _run_javascript(functions + """
        const add=new EventTarget(),edit=new EventTarget();
        add.dataset={metricAddIssue:'item-1',metricName:'accuracy'};
        edit.dataset={metricIssuesItem:'item-1',metricName:'accuracy',issueIndex:'1'};
        const document={querySelectorAll:selector=>({'[data-metric-add-issue]':[add],'[data-metric-issues-item]':[edit]}[selector]||[])};
        const opened=[];const showMetricIssueDialog=(...args)=>opened.push(args);
        wireMetricAnalysisHandlers();add.dispatchEvent(new Event('click'));edit.dispatchEvent(new Event('click'));
        assert.deepEqual(opened,[['item-1','accuracy'],['item-1','accuracy',{mode:'edit',issueIndex:1}]]);
        const SOLUTION_PRESETS=['Add Guardrails'];
        const state={snapshot:{rows:[{item_metadata:{metric_analyses:{accuracy:{solution:'Shared',root_cause_issues:[{category:'Agent',solution:'Issue fix'}]}}}}]}};
        assert.deepEqual(metricDiagnosisSolutionOptions(),['Add Guardrails','Shared','Issue fix']);
        const ADD_NEW_SOLUTION_VALUE='__qym_add_new_solution__';
        const escapeAttr=String,escapeHtml=String,CLOSE_ICON='';
        const categoryCatalogEntry=()=>({description:'Meaning',when_to_use:'Usage guidance'});
        const categoryCatalogDetails=()=>['Saved subtype'];
        const draft={mode:'edit',issueIndex:1,issues:[{category:'Agent',subcategory:'Subtype',finding:'Evidence',category_reason:'Why saved',confidence:.9}],originalIssue:{solution:'Fix',solution_note:'Notes'},solution:'Fix',solution_note:'Notes',addingNewSolution:false};
        const html=renderMetricDiagnosisFields(draft);
        for(const field of ['category','subcategory','finding'])assert.ok(html.includes('data-issue-field="'+field+'"'));
        for(const field of ['solution','solution_note'])assert.ok(!html.includes('data-diagnosis-field="'+field+'"'));
        assert.ok(!html.includes('Solution notes (optional)'));
        assert.ok(!html.includes('data-new-solution'));
        for(const text of ['Issue 2','Choose a saved solution','Meaning','Usage guidance','Why saved','90% confidence','Saved subtype','Add Guardrails','+ Add new solution','value="Fix" selected'])assert.ok(html.includes(text),text);
        selectMetricDiagnosisSolution(draft,ADD_NEW_SOLUTION_VALUE);
        assert.equal(draft.addingNewSolution,true);assert.equal(draft.solution,'');assert.equal(draft.solution_note,'');
        const customHtml=renderMetricDiagnosisFields(draft);
        assert.ok(customHtml.includes('data-new-solution'));assert.ok(customHtml.includes('New solution'));
        draft.solution='Custom & safe';
        assert.ok(renderMetricDiagnosisFields(draft).includes('value="Custom & safe"'));
        selectMetricDiagnosisSolution(draft,'Fix');
        assert.equal(draft.addingNewSolution,false);assert.equal(draft.solution,'Fix');assert.equal(draft.solution_note,'Notes');
        assert.ok(!html.includes('data-add-issue'));
    """)


def test_add_new_solution_requires_a_value_and_saves_without_notes() -> None:
    _run_javascript(_diagnosis_functions() + """
        const ADD_NEW_SOLUTION_VALUE='__qym_add_new_solution__';
        const state={run:{file_path:'run-1'},snapshot:{rows:[{item_id:'item-1',item_metadata:{metric_analyses:{accuracy:{root_cause_issues:[]}}}}]}};
        let request=null;const saveMetricIssueAction=async(_item,_metric,value)=>{request=value;return true;};
        const draft=createMetricDiagnosisDraft('item-1','accuracy','add');
        draft.issues[0]={category:'Agent',finding:'Evidence'};
        selectMetricDiagnosisSolution(draft,ADD_NEW_SOLUTION_VALUE);
        assert.equal(await saveMetricDiagnosisDraft('item-1','accuracy',draft),false);
        assert.equal(draft.invalidSolution,true);assert.match(draft.message,/Enter the new solution/);assert.equal(request,null);
        draft.solution='  New custom fix  ';
        assert.equal(await saveMetricDiagnosisDraft('item-1','accuracy',draft),true);
        assert.equal(request.issue.solution,'New custom fix');assert.equal(request.issue.solution_note,'');
    """)


@pytest.mark.parametrize("switch_pass", [False, True])
def test_issue_action_request_targets_the_correct_pass_and_ignores_late_reply(switch_pass: bool) -> None:
    functions="\n".join(_function("run",name) for name in ("metricAnalysisKey","currentPassVersion","addCurrentPassToPayload","saveMetricIssueAction"))
    _run_javascript(functions + f"\nconst switchPass={str(switch_pass).lower()};\n" + """
        const IS_EXPORT=false,RUN_ID='run-1';
        const state={run:{file_path:'run-1',metadata:{pass_revision:7}},viewPass:2,rootCauseValues:[]};
        const apiUrl=String;let body,finish,applied=0;
        const applyUpdatedRow=()=>applied++;
        const fetch=async(url,options)=>{assert.equal(url,'api/runs/update_root_cause_issue');body=JSON.parse(options.body);return new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({ok:true,row:{item_id:'item-1'}})});});};
        const result=saveMetricIssueAction('item-1','accuracy',{action:'approve',issue_id:'two',expected_issue:{category:'Agent'}});
        assert.equal(body.pass_number,2);assert.equal(body.issue_id,'two');assert.equal(body.metric_name,'accuracy');
        assert.equal(body.expected_pass_version,7);
        if(switchPass)state.viewPass=1;finish();assert.equal(await result,true);assert.equal(applied,switchPass?0:1);
    """)


@pytest.mark.parametrize("switch_pass", [False, True])
def test_metric_save_targets_viewed_pass_without_overwriting_a_new_view(switch_pass: bool) -> None:
    functions = "\n".join(_function("run", name) for name in (
        "metricAnalysisKey", "currentPassVersion", "addCurrentPassToPayload", "saveMetricAnalysisPatch"))
    _run_javascript(functions + f"\nconst switchPass = {str(switch_pass).lower()};\n" + """
        const IS_EXPORT = false;
        const state = {run: {file_path: 'run-1', metadata: {pass_revision: 7}}, viewPass: 2,
          snapshot: {rows: [{item_id: 'item-1'}]}, rootCauseValues: []};
        const apiUrl = value => value;
        const rootCauseCategories = () => [];
        const buildCategoryDropdowns = () => {};
        const renderItems = () => {};
        const showToast = () => {throw new Error('Unexpected error toast');};
        let request, finish, applied = 0;
        const applyUpdatedRow = () => {applied++;};
        const fetch = async (_url, options) => {
          request = JSON.parse(options.body);
          return new Promise(resolve => {finish = () => resolve({ok:true, json:async()=>({row:{item_id:'item-1'}})});});
        };
        const pending = saveMetricAnalysisPatch('item-1', 'accuracy', {solution:'Use a date filter'}, {silent:true});
        assert.equal(request.pass_number, 2);
        assert.equal(request.expected_pass_version, 7);
        assert.equal(request.metric_name, 'accuracy');
        assert.equal(request.item_id, 'item-1');
        assert.equal(request.run_id, 'run-1');
        if (switchPass) state.viewPass = 3;
        finish();
        assert.equal(await pending, true);
        assert.equal(applied, switchPass ? 0 : 1);
    """)

def test_failed_analysis_card_matches_unanalysed_without_changing_saved_data():
    functions = "\n".join(_function("run", name) for name in (
        "rootCauseIssues", "renderMetricRootCauseIssues", "metricAnalysisKey",
        "renderMetricAnalysisCard",
    ))
    _run_javascript(functions + r"""
        const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        const escapeAttr = escapeHtml;
        const rootCauseColor = () => 'var(--error)';
        const IS_EXPORT = false;
        const state = {viewPass: null};
        const render = analysis => renderMetricAnalysisCard('sample', 'accuracy', analysis, {status: 'approved'});
        const empty = render(undefined);
        assert.ok(empty.includes('No root-cause issues assigned.'));
        assert.ok(empty.includes('data-metric-add-issue="sample"'));
        for (const code of ['context_limit_exceeded', 'timeout', 'provider_error']) {
          const analysis = Object.freeze({error: 'Provider failure <private>', error_code: code,
            warning: 'Failed attempt warning', source: 'ai', confidence: 0.8});
          const before = JSON.stringify(analysis);
          assert.equal(render(analysis), empty);
          assert.equal(JSON.stringify(analysis), before);
        }
        const issue = {issue_id: 'issue-1', category: 'Retrieval', finding: 'Missing evidence',
          solution: 'Improve retrieval', solution_note: 'Add a filter', review_status: 'approved'};
        const human = {source: 'human', root_cause_issues: [issue]};
        const humanBefore = JSON.stringify(human);
        const html = render(human);
        for (const text of ['1 issue', 'Human edited', 'Missing evidence', 'Improve retrieval', 'Add a filter', 'Approved', 'Edit']) {
          assert.ok(html.includes(text), text);
        }
        assert.equal(JSON.stringify(human), humanBefore);
        assert.ok(render({source: 'ai', confidence: 0.9, root_cause_issues: [issue]}).includes('90% confidence'));
        assert.equal(render({error: ''}), empty);
        assert.ok(!empty.includes('Approved'));
    """)


def test_failed_analysis_warnings_are_not_repeated_in_item_details():
    source = (DASHBOARD / "run.html").read_text()
    warning_block = source.split('          const itemAnalysisWarnings = [];', 1)[1].split(
        "          const itemAnalysisWarning = itemAnalysisWarnings.join('; ');", 1
    )[0]
    _run_javascript("""
        function warnings(metadata) {
          const row = {item_metadata: metadata};
          const metricAnalyses = metadata.metric_analyses || {};
          const itemAnalysisWarnings = [];
    """ + warning_block + """
          return itemAnalysisWarnings;
        }
        const failed = {error: 'Timed out', warning: 'Failed attempt warning'};
        assert.deepEqual(warnings({analysis_warning: failed.warning, metric_analyses: {accuracy: failed}}), []);
        assert.deepEqual(warnings({analysis_error: 'Legacy failure', analysis_warning: failed.warning}), []);
        assert.deepEqual(warnings({analysis_warning: 'Legacy taxonomy warning'}), ['Legacy taxonomy warning']);
        const good = {warning: 'No taxonomy'};
        const mixed = {analysis_warning: 'Failed attempt warning; No taxonomy',
          metric_analyses: {accuracy: failed, quality: good}};
        const before = JSON.stringify(mixed);
        assert.deepEqual(warnings(mixed), ['No taxonomy']);
        assert.equal(JSON.stringify(mixed), before);
        assert.deepEqual(warnings({analysis_warning: 'No taxonomy', metric_analyses: {quality: good}}), ['No taxonomy']);
    """)

def test_issue_tags_and_solution_only_render_when_solution_has_text():
    functions = "\n".join(_function("run", name) for name in (
        "rootCauseIssues", "renderMetricRootCauseIssues",
    ))
    _run_javascript(functions + r"""
        const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        const escapeAttr = escapeHtml;
        const rootCauseColor = () => 'var(--warning)';
        const IS_EXPORT = false;
        const issue = {issue_id: 'issue-1', category: 'Retrieval', subcategory: 'Document coverage', finding: 'Missing evidence', review_status: 'pending'};
        const render = issue => renderMetricRootCauseIssues({root_cause_issues: [issue]}, 'item-1', 'accuracy');
        for (const solution of [undefined, null, '', '  \n\t']) {
          const saved = {...issue, solution, solution_note: 'Saved note without a solution'};
          const before = JSON.stringify(saved);
          const html = render(saved);
          assert.ok(html.includes('metric-analysis-problem-tag">Problem</span>'));
          assert.ok(html.includes('metric-analysis-subcategory-tag">Subcategory</span>'));
          assert.ok(html.includes('Document coverage'));
          assert.ok(html.includes('metric-analysis-finding-tag">Finding</span>'));
          assert.ok(html.includes('Missing evidence'));
          assert.ok(html.includes('Approve'));
          assert.ok(html.includes('Edit'));
          assert.ok(!html.includes('metric-analysis-issue-solution'));
          assert.ok(!html.includes('No proposed solution yet.'));
          assert.equal(JSON.stringify(saved), before);
        }
        const saved = {...issue, solution: 'Use <verified> evidence', solution_note: 'Keep <filters>'};
        const before = JSON.stringify(saved);
        const html = render(saved);
        assert.ok(html.includes('qym-tag--accent">Solution</span>'));
        assert.ok(html.includes('Use &lt;verified> evidence'));
        assert.ok(html.includes('Keep &lt;filters>'));
        assert.ok(!html.includes('<verified>'));
        assert.equal(JSON.stringify(saved), before);

        const withoutOptionalFields = render({...issue, subcategory: '', finding: ''});
        assert.ok(!withoutOptionalFields.includes('metric-analysis-subcategory-tag'));
        assert.ok(!withoutOptionalFields.includes('metric-analysis-finding-tag'));
    """)
