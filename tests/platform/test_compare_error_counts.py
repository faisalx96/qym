"""Run the shipped Compare JavaScript against task/metric/pass error fixtures."""

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


def run_compare_js(body: str, *, render: bool = False) -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required for Compare behavior tests")
    source = (DASHBOARD / "compare.html").read_text()
    names = (
        "getRowCompareId", "findRowByCompareId", "getCompareRowSummary",
        "scopedPassItemMetadata", "sliceRunToPass", "calculateComparisonStatsForMetric", "collectRowErrors",
        "stringify", "normalizeErrorLabel", "splitErrorLabel",
        "getErrorBucketKey", "addErrorBucket",
        "rowMatchesErrorFilter", "rowMatchesActiveErrorFilters", "getErrorFilterSlot",
    )
    if render:
        names += (
            "escapeAttr", "makeSafeDomId", "_parseMetaDeep", "passRefBase",
            "compareExecutionErrorInfo", "renderCompareErrorIndicator",
            "renderCompareMetricErrorIndicator", "renderCompareOutputGroup",
            "renderItemComparisonCard",
        )
    functions = []
    if render:
        for name in (
            "PASS_REF_SEP", "COMPARE_FAILURE_ICON", "COPY_ICON", "EDIT_ICON",
            "SAVE_ICON", "CLOSE_ICON", "OPEN_LINK_ICON", "CLOCK_ICON",
        ):
            match = re.search(rf"^      const {name} = .*;$", source, re.M)
            assert match, f"Missing production constant: {name}"
            functions.append(match.group())
    for name in names:
        match = re.search(
            rf"^      function {name}\([^\n]*\n.*?^      }}$", source, re.M | re.S
        )
        assert match, f"Missing production function: {name}"
        functions.append(match.group())
        script = (
            "const assert = require('node:assert/strict'); const window = {}; "
            "const comparisonRowIndexes = new WeakMap();\n"
            + (DASHBOARD / "metrics.js").read_text()
        + "\n" + "\n".join(functions) + "\n"
        + (RENDER_FIXTURE_JS if render else "") + body
    )
    result = subprocess.run([node], input=script, text=True, capture_output=True, timeout=15)
    assert result.returncode == 0, result.stdout + result.stderr


# Only unrelated formatting, navigation and root-cause services are stubbed.
# Error classification, pass slicing, scores, icons and both card renderers
# execute the production JavaScript, rather than copies of the UI logic.
RENDER_FIXTURE_JS = r"""
    const COLORS = ['teal','blue','purple'];
    let IS_COMPARE_EXPORT = false;
    const escapeHtml = escapeAttr;
    const renderMarkdownSafe = escapeAttr;
    const formatObjectAsHtml = value => escapeAttr(JSON.stringify(value));
    const apiUrl = path => '/' + path;
    const buildLangfuseTraceUrl = () => '';
    const buildLangfuseTraceUrlFromRun = () => '';
    const compareRootCauseScope = () => ({analysis:null,metricName:state.selectedItemsMetric});
    const rootCauseIssues = () => [];
    const state = {
      runs:[], allMetrics:['accuracy','quality'], selectedItemsMetric:'accuracy',
      metricTypes:{accuracy:'score',quality:'score'},
      metricThresholds:{accuracy:.8,quality:.8}, metricIsBoolean:{},
      visibleMetricMetaFields:{}, visibleMetadataFields:{}, itemExpanded:{},
    };
    const row = (overrides={}) => ({index:2,item_id:'item_2',status:'completed',
      input:'Task completed; metric crashed',output:'SELECT 4',metric_values:[0,1],
      metric_meta:{accuracy:{status:'error',error:'Judge unavailable'}},...overrides});
    const configureRuns = rows => {
      state.runs = rows.map((value,i) => ({run:{run_name:'Run '+(i+1)},
        snapshot:{metric_names:['accuracy','quality'],rows:value ? [value] : []}}));
    };
    const outputCards = html => Array.from(html.matchAll(
      /<article class="item-run-output([^"]*)"[^>]*>([\s\S]*?)<\/article>/g
    ), match => ({classes:match[1],html:match[2]}));
    const metricRows = html => Array.from(html.matchAll(
      /<div class="det-toggle metric-compare-row([^"]*)"><button[^>]*data-output-metric="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g
    ), match => ({classes:match[1],name:match[2],html:match[3]}));
"""


@pytest.mark.parametrize("metric_type", ["boolean", "score", "numeric"])
@pytest.mark.parametrize("score", [0, None])
@pytest.mark.parametrize("error_meta", [
    {"status": "error", "error": "Judge unavailable"},
    {"status": "timeout"},
    {"error": "Legacy metric exception"},
])
def test_metric_error_marks_only_its_own_surfaces(metric_type, score, error_meta) -> None:
    run_compare_js(
        "state.metricTypes.accuracy=" + json.dumps(metric_type) + ";\n"
        + "const value=" + json.dumps(score) + "; const meta=" + json.dumps(error_meta)
        + ";\n" + r"""
        const rows=[row({metric_values:[value,1],metric_meta:{accuracy:meta}})];
        configureRuns(rows);
        // Hiding details or lacking a score must not hide the error indicator.
        state.visibleMetricMetaFields={status:false,error:false};
        const collapsed=renderItemComparisonCard('item_2',rows);
        assert.ok(!collapsed.includes('item-execution-error'));
        assert.ok(!collapsed.includes('item-error-indicator'));
        assert.ok(collapsed.includes('qym-item-metric-cell--selected metric-execution-error'));
        assert.ok(collapsed.includes('aria-label="Metric execution failed: accuracy"'));
        assert.ok(!collapsed.includes('metric-score-value'));
        assert.equal(getCompareRowSummary(rows).failed,1);

        const expanded=renderItemComparisonCard('item_2',rows,{forceExpanded:true});
        assert.ok(!expanded.includes('item-execution-error'));
        assert.ok(!expanded.includes('item-error-indicator'));
        assert.ok(!expanded.includes('title="Fail on accuracy"'));
        assert.ok(!expanded.includes('title="Pass on accuracy"'));
        const metrics=metricRows(expanded);
        assert.equal(metrics.length,2);
        assert.ok(metrics[0].classes.includes('metric-execution-error'));
        assert.ok(metrics[0].html.includes('metric-error-indicator'));
        assert.ok(!metrics[0].html.includes('metric-score-value'));
        assert.ok(metrics[1].html.includes('metric-score-value'));
        assert.ok(!metrics[1].classes.includes('metric-execution-error'));
        assert.ok(!metrics[1].html.includes('metric-error-indicator'));
        assert.equal(rows[0].output,'SELECT 4');
        assert.equal(rows[0].metric_values[0],value);
        """, render=True,
    )


@pytest.mark.parametrize(("metric_type", "expected"), [
    ("boolean", "False"), ("score", "0.0%"), ("numeric", "0"),
])
@pytest.mark.parametrize("error_value", [None, False, 0, "", "   "])
def test_judged_zero_without_exception_keeps_its_display(metric_type, expected, error_value) -> None:
    run_compare_js(
        "state.metricTypes.accuracy=" + json.dumps(metric_type) + ";\n"
        + "const expected=" + json.dumps(expected) + ";\n"
        + "const errorValue=" + json.dumps(error_value) + ";\n" + r"""
        const rows=[row({metric_meta:{accuracy:{label:'failed',error:errorValue}}})];
        configureRuns(rows);
        const collapsed=renderItemComparisonCard('item_2',rows);
        assert.match(collapsed,new RegExp('metric-score-value[^>]*>'+expected+'<'));
        assert.ok(!collapsed.includes('metric-error-indicator'));
        const metrics=metricRows(renderCompareOutputGroup('item_2',rows));
        assert.match(metrics[0].html,new RegExp('metric-score-value[^>]*>'+expected+'<'));
        assert.ok(!metrics[0].html.includes('metric-error-indicator'));
        assert.equal(getCompareRowSummary(rows).failed,0);
    """, render=True)


def test_nonselected_metric_error_overrides_green_summary_but_not_metric_scope() -> None:
    run_compare_js(r"""
        const rows=[row()];
        configureRuns(rows);
        state.selectedItemsMetric='quality';
        const collapsed=renderItemComparisonCard('item_2',rows);
        assert.ok(!collapsed.includes('item-execution-error'));
        assert.ok(collapsed.includes('qym-item-metric-cell--selected metric-execution-error'));
        assert.ok(collapsed.includes('aria-label="Metric execution failed: accuracy"'));
        assert.ok(!collapsed.includes('100.0%'));
        let expanded=renderCompareOutputGroup('item_2',rows);
        assert.ok(!expanded.includes('title="Pass on quality"'));
        assert.ok(expanded.includes('aria-label="Metric execution failed: accuracy"'));
        assert.equal(metricRows(expanded).filter(metric=>metric.classes.includes('metric-execution-error')).length,1);

        state.selectedItemsMetric='accuracy';
        rows[0].metric_meta={accuracy:{label:'failed'}};
        expanded=renderCompareOutputGroup('item_2',rows);
        assert.ok(expanded.includes('title="Fail on accuracy"'));
        assert.ok(!expanded.includes('execution-error'));
        assert.ok(!expanded.includes('error-indicator'));
        assert.equal(getCompareRowSummary(rows).failed,0);
    """, render=True)


@pytest.mark.parametrize("export", [False, True])
def test_mixed_task_and_metric_errors_have_scoped_borders(export: bool) -> None:
    run_compare_js("IS_COMPARE_EXPORT=" + json.dumps(export) + ";\n" + r"""
        const rows=[row({status:'error',output:'Task rejected',metric_meta:{},metric_values:[]}),row(),null];
        configureRuns(rows);
        const collapsed=renderItemComparisonCard('item_2',rows);
        assert.ok(collapsed.startsWith('<div class="item-comparison-row item-collapsed item-header-expand item-execution-error"'));
        assert.ok(collapsed.includes('aria-label="Task execution failed"'));
        assert.ok(collapsed.includes('aria-label="Metric execution failed: accuracy"'));
        const expanded=renderItemComparisonCard('item_2',rows,{forceExpanded:true});
        assert.ok(expanded.trimStart().startsWith('<div class="item-comparison-row">'));
        const cards=outputCards(expanded);
        assert.equal(cards.length,3);
        assert.ok(cards[0].classes.includes('item-execution-error'));
        assert.ok(!cards[1].classes.includes('item-execution-error'));
        assert.ok(!cards[2].classes.includes('item-execution-error'));
        assert.ok(!cards[1].html.includes('item-error-indicator'));
        assert.ok(cards[1].html.includes('metric-error-indicator'));
        assert.ok(cards[2].html.includes('No data'));
        assert.equal(getCompareRowSummary(rows.filter(Boolean)).failed,2);
    """, render=True)


def test_pass_styling_does_not_leak_another_pass_error() -> None:
    run_compare_js(r"""
        const source={run:{run_name:'Repeated',file_path:'r',samples:3},snapshot:{metric_names:['accuracy','quality'],rows:[row({
          status:'error',pass_attempts:[{pass_number:1,status:'error'},
            {pass_number:2,status:'completed',output:'SELECT 4'},
            {pass_number:3,status:'completed',output:'SELECT 4'}],
          pass_scores:{accuracy:[0,0,1],quality:[0,1,1]},
          pass_metric_meta:{accuracy:[{label:'error'},{status:'error',error:'Judge crashed'},{}],quality:[{label:'error'},{},{}]},
        })]}};
        state.runs=[1,2,3].map(pass=>sliceRunToPass(source,'r::pass'+pass,pass));
        const rows=state.runs.map(run=>run.snapshot.rows[0]);
        const cards=outputCards(renderCompareOutputGroup('item_2',rows));
        assert.deepEqual(cards.map(card=>card.classes.includes('item-execution-error')),[true,false,false]);
        assert.deepEqual(cards.map(card=>card.html.includes('metric-error-indicator')),[false,true,false]);
        assert.ok(cards[2].html.includes('title="Pass on accuracy"'));
        assert.deepEqual(state.runs.map(run=>run.snapshot.stats.failed),[1,1,0]);
    """, render=True)


def test_summary_counts_errors_once_and_completed_means_finished() -> None:
    run_compare_js("""
        const meta = {status:'error', error:'Metric unavailable'};
        const rows = [
          {status:'completed', metric_values:[1]},
          {status:'completed', metric_values:[0], metric_meta:{accuracy:{label:'failed'}}},
          {status:'completed', metric_values:[0,0], metric_meta:{accuracy:meta,quality:meta}},
          {status:'error', error:'Task failed', metric_meta:{accuracy:meta}},
          {status:'failed', error:'Task timed out'},
          {status:'pending'}, {status:'in_progress'},
        ];
        assert.deepEqual(getCompareRowSummary(rows), {total:7, completed:5, failed:3});
        assert.deepEqual(getCompareRowSummary([]), {total:0, completed:0, failed:0});
        // A trace/provider warning alone is not a task or metric exception.
        assert.equal(getCompareRowSummary([{status:'completed',trace_stats:{provider_errors:2}}]).failed,0);
    """)


def test_pass_summaries_use_that_pass_only_without_mutating_parent() -> None:
    run_compare_js("""
        const parent = {run:{file_path:'run',run_name:'Run',samples:3,error_count:2,execution_error_count:9},
          snapshot:{metric_names:['accuracy'],stats:{total:2,completed:99,failed:99},rows:[
            {item_id:'a',compare_item_id:'a',status:'error',execution_error_count:3,
              metric_values:[0],metric_meta:{accuracy:{status:'error'}},
              pass_scores:{accuracy:[1,0,null]},
              pass_metric_meta:{accuracy:[{}, {status:'error',error:'metric failed'}, null]},
              pass_attempts:[{pass_number:2,status:'completed',output:'ok'}, {pass_number:1,status:'completed',output:'ok'}]},
            {item_id:'b',compare_item_id:'b',status:'error',execution_error_count:3,
              pass_scores:{accuracy:[0,0,null]},pass_metric_meta:{accuracy:[{label:'error'},{label:'error'},null]},
              pass_attempts:[{pass_number:1,status:'error',error:'task failed'}, {pass_number:2,status:'error',error:'task failed'}]},
          ]}};
        const before = JSON.stringify(parent);
        const one = sliceRunToPass(parent,'run::pass1',1);
        const two = sliceRunToPass(parent,'run::pass2',2);
        const missing = sliceRunToPass(parent,'run::pass3',3);
        assert.deepEqual(one.snapshot.stats,{total:2,completed:2,failed:1});
        assert.deepEqual(two.snapshot.stats,{total:2,completed:2,failed:2});
        assert.deepEqual(missing.snapshot.stats,{total:2,completed:0,failed:0});
        assert.equal(one.run.execution_error_count,1);
        assert.equal(two.run.execution_error_count,2);
        assert.equal(missing.run.execution_error_count,0);
        assert.equal(one.run.error_count,1);
        assert.equal(two.run.error_count,1);
        assert.deepEqual(one.snapshot.rows.map(row=>row.execution_error_count),[0,1]);
        assert.deepEqual(two.snapshot.rows.map(row=>row.execution_error_count),[1,1]);
        assert.deepEqual(missing.snapshot.rows.map(row=>row.execution_error_count),[0,0]);
        assert.equal(JSON.stringify(parent),before);
    """)


@pytest.mark.parametrize("metric_name", ["accuracy", "quality", "missing"])
def test_three_plus_three_matches_overview_for_every_metric(metric_name: str) -> None:
    run_compare_js("const metricName=" + json.dumps(metric_name) + ";\n" + """
        const fixture = () => ({run:{metric_names:['accuracy','quality']},snapshot:{metric_names:['accuracy','quality'],rows:[
          {compare_item_id:'pass',status:'completed',metric_values:[1,1]},
          {compare_item_id:'judge',status:'completed',metric_values:[0,0]},
          {compare_item_id:'metric',status:'completed',metric_values:[0,1],metric_meta:{accuracy:{status:'error'}}},
          {compare_item_id:'task',status:'error',metric_values:[]},
          {compare_item_id:'timeout',status:'error',metric_values:[]},
        ]}});
        const state = {runs:[fixture(),fixture()],compareItemIds:['pass','judge','metric','task','timeout'],
          metricIsBoolean:{accuracy:true,quality:true,missing:true},metricThresholds:{accuracy:.8,quality:.8,missing:.8}};
        const summaries=state.runs.map(run=>getCompareRowSummary(run.snapshot.rows));
        assert.deepEqual(summaries.map(s=>s.failed),[3,3]);
        const overview=calculateComparisonStatsForMetric(metricName);
        assert.equal(overview.failedCount,6);
        assert.equal(overview.failedCount,summaries.reduce((sum,s)=>sum+s.failed,0));
        assert.equal(calculateComparisonStatsForMetric(metricName,['metric']).failedCount,2);
        assert.equal(calculateComparisonStatsForMetric(metricName,['judge']).failedCount,0);
        if(metricName==='accuracy') assert.equal(overview.overallAvgScore,.2);
        if(metricName==='quality') assert.equal(overview.overallAvgScore,.4);
    """)


def test_error_distribution_includes_metric_errors_and_filters_them_separately() -> None:
    run_compare_js("""
        const state={taskErrorFilter:null,metricErrorFilter:null,traceErrorFilter:null,analysisErrorFilter:null};
        const row={compare_item_id:'a',status:'completed',metric_meta:{accuracy:{status:'timeout',error:'Provider timed out'}}};
        const buckets={};
        collectRowErrors(row,buckets,'Pass 1','a');
        collectRowErrors(row,buckets,'Pass 2','a');
        collectRowErrors({compare_item_id:'b',status:'error',error:'Task failed'},buckets,'Pass 1','b');
        collectRowErrors({compare_item_id:'b',status:'error',error:'Task failed'},buckets,'Pass 2','b');
        collectRowErrors({compare_item_id:'c',status:'failed',error:'Task failed'},buckets,'Pass 1','c');
        collectRowErrors({compare_item_id:'c',status:'failed',error:'Task failed'},buckets,'Pass 2','c');
        collectRowErrors({status:'completed',metric_meta:{accuracy:{label:'failed'}}},buckets,'Pass 1','judge');
        const entries=Object.values(buckets);
        assert.equal(entries.reduce((sum,entry)=>sum+entry.count,0),6);
        const metric=entries.find(entry=>entry.kind==='Metric error');
        assert.equal(metric.count,2);
        assert.equal(metric.itemKeys.size,2);
        assert.equal(getErrorFilterSlot('Metric error'),'metricErrorFilter');
        state.metricErrorFilter={kind:metric.kind,label:metric.label};
        assert.equal(rowMatchesActiveErrorFilters(row,'Pass 1','a'),true);
        assert.equal(rowMatchesActiveErrorFilters({status:'completed'},'Pass 1','b'),false);
        assert.equal(state.traceErrorFilter,null);
    """)


def test_metric_error_distribution_aggregates_by_metric_across_messages() -> None:
    run_compare_js("""
        const state={taskErrorFilter:null,metricErrorFilter:null,traceErrorFilter:null,analysisErrorFilter:null};
        const first={compare_item_id:'a',status:'completed',metric_meta:{accuracy_score:{status:'error',error:'Run 2 judge request failed'}}};
        const second={compare_item_id:'b',status:'completed',metric_meta:{accuracy_score:{status:'timeout',error:'Run 3 judge timed out'}}};
        const third={compare_item_id:'c',status:'completed',metric_meta:{valid_sql:{status:'error',error:'Parser unavailable'}}};
        const buckets={};
        collectRowErrors(first,buckets,'Run 2','a');
        collectRowErrors(first,buckets,'Run 2','a');
        collectRowErrors(second,buckets,'Run 3','b');
        collectRowErrors(second,buckets,'Run 3','b');
        collectRowErrors(third,buckets,'Run 3','c');

        const metrics=Object.values(buckets).filter(entry=>entry.kind==='Metric error');
        assert.equal(metrics.length,2);
        const accuracy=metrics.find(entry=>entry.label==='accuracy_score');
        assert.equal(accuracy.count,4);
        assert.equal(accuracy.itemKeys.size,2);
        assert.deepEqual(Array.from(accuracy.details),['Run 2 judge request failed','Run 3 judge timed out']);
        assert.deepEqual(accuracy.runCounts,{'Run 2':2,'Run 3':2});

        state.metricErrorFilter={kind:'Metric error',label:'accuracy_score'};
        assert.equal(rowMatchesActiveErrorFilters(first,'Run 2','a'),true);
        assert.equal(rowMatchesActiveErrorFilters(second,'Run 3','b'),true);
        assert.equal(rowMatchesActiveErrorFilters(third,'Run 3','c'),false);
    """)


def test_compare_renders_recomputed_summaries_and_metric_error_section() -> None:
    source = (DASHBOARD / "compare.html").read_text()
    summary = source.split("function renderSummaries()", 1)[1].split(
        "function renderMetricsTable()", 1
    )[0]
    assert "getCompareRowSummary(run.snapshot?.rows || [])" in summary
    assert "run.snapshot?.stats" not in summary
    assert "renderErrorGroup('Metric Errors', 'metric', metricStats)" in source
    assert "if (entries.length === 0) return '';" in source
    assert "state.metricErrorFilter = null;" in source
    assert "state.taskErrorFilter || state.metricErrorFilter || state.traceErrorFilter" in source
    assert source.count("if (state.metricErrorFilter !== null) n++;") == 2
