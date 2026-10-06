"""Compare Filters fields and view URL, executed with Node against the page's own functions.

The run page's Filters changes, as Compare applies them to aligned items:

- Score rules are written as percentages (60 for a stored 0.6).
- Every item metadata key of any compared run is a field; an item matches
  when any compared run's row does.
- Root cause offers only the causes the compared runs' analyses applied and
  matches through any analysis of any run.
- Rules and page filters round-trip through the ``filters`` URL value.
"""

from __future__ import annotations

from test_root_cause_issue_javascript import _function, _run_javascript


def _filter_functions() -> str:
    return "\n".join(_function("compare", name) for name in (
        "categoryValueText", "parseMetaList", "isListCategoryKey", "getMetadataCategoryValues",
        "formatFieldName", "rootCauseCategories", "rootCauseIssues", "getRowRootCauseAnalyses",
        "compareRowSets", "sameRowSets", "compareMetadataFilterDefs", "compareRowRootCauses",
        "compareAppliedRootCauseValues", "compareFilterChoices", "compareFilterFieldDefs",
        "compareFilterFieldById", "compareFilterConditionComplete", "filterRuleCount",
        "compareNumberMatches", "evalFilterNode", "compareFilterOperator", "compareFilterConditionHtml",
        "compareFilterContext", "compareErrorLabelHash", "compareErrorFilterUrlValue",
        "compareViewFiltersParam", "_validFilterRule", "applyCompareViewFiltersParam",
    )) + """
        const _isFilterGroup = node => Array.isArray(node.children);
        const _isStringList = value => Array.isArray(value) && value.length <= 500 && value.every(item => typeof item === 'string');
        const COMPARE_FILTER_SKIPPED_METADATA = new Set(['root_cause', 'root_causes', 'root_cause_issues',
          'root_cause_detail', 'root_cause_reason', 'root_cause_note', 'root_cause_source',
          'root_cause_confidence', 'root_cause_metric_name', 'solution', 'solution_note', 'solution_source',
          'metric_analyses', 'analysis_error', 'task_started_at_ms', 'trace_stats', 'retry_count']);
        const COMPARE_VIEW_ERROR_SLOTS = [
          ['task', 'taskErrorFilter'], ['metric', 'metricErrorFilter'],
          ['trace', 'traceErrorFilter'], ['analysis', 'analysisErrorFilter'],
        ];
        const COMPARE_VIEW_ERROR_LABEL_MAX = 80, COMPARE_VIEW_ERROR_PREFIX = 40;
        let pendingCompareCategoryFilters = null;
        const MAX_ROOT_CAUSE_CATEGORIES = 3;
        // The compared runs' errors, as collectRowErrors buckets them.
        const LONG_ERROR = 'x'.repeat(120);
        const compareErrorLabelFromUrlValue = (kind, prefix, hash) =>
          LONG_ERROR.startsWith(prefix) && compareErrorLabelHash(LONG_ERROR) === hash ? LONG_ERROR : null;
        const window = {QymMetrics: {isErrorRow: () => false}};
        const el = () => null;
        const compareRunShortLabel = index => 'Run ' + 'AB'[index];
        const metricPassesFor = () => null, metricDirectionFor = () => 'maximize';
        const comparisonOutputIdentity = () => '', rowHasEditedMetric = () => false;
        const matchesApprovalFilter = () => false;
        const hasComparisonDetails = () => false;
        const escapeAttr = String, escapeHtml = String, FILTER_TRASH_ICON = '';
        // Items aligned by id across the compared runs, as getFilteredItems builds them.
        const matching = (state, rule) => {
          const ids = [...new Set(state.runs.flatMap(run => run.snapshot.rows.map(row => row.item_id)))];
          return ids.filter(id => {
            const rowData = state.runs.map(run => run.snapshot.rows.find(row => row.item_id === id) || null);
            const scores = rowData.map(row => row && row.score != null ? row.score : null);
            return evalFilterNode({op: 'and', children: [rule]}, compareFilterContext(id, rowData, scores, null));
          });
        };
        const compareState = (rowsA, rowsB, extra = {}) => ({
          runs: [{snapshot: {rows: rowsA}}, {snapshot: {rows: rowsB}}],
          allMetrics: ['accuracy', 'tokens'], metricTypes: {accuracy: 'score', tokens: 'numeric'},
          selectedItemsMetric: 'accuracy', itemIdToIndex: {}, ...extra,
        });
    """


def test_a_score_rule_is_written_and_shown_as_a_percentage() -> None:
    _run_javascript(_filter_functions() + """
        const state = compareState(
          [{item_id: 'a', score: 0.55}, {item_id: 'b', score: 0.75}],
          [{item_id: 'a', score: 0.9}, {item_id: 'b', score: 0.2}]);
        assert.equal(compareFilterFieldById('score:0').percent, true);
        const rule = {field: 'score:0', oper: 'gt', value: 0.6};
        assert.deepEqual(matching(state, rule), ['b']);
        const html = compareFilterConditionHtml(rule, '0');
        assert.match(html, /value="60"/);
        assert.match(html, /max="100"/);
        assert.match(html, /class="fb-unit"[^>]*>%</);
        // A numeric metric keeps its own units.
        state.selectedItemsMetric = 'tokens';
        assert.equal(compareFilterFieldById('score:1').percent, false);
        const countHtml = compareFilterConditionHtml({field: 'score:1', oper: 'gte', value: 12}, '0');
        assert.match(countHtml, /value="12"/);
        assert.ok(!countHtml.includes('fb-unit'));
    """)


def test_every_metadata_key_of_any_run_is_a_field_and_any_run_matches() -> None:
    _run_javascript(_filter_functions() + """
        const many = n => Array.from({length: n}, (_, i) => i);
        const rowsA = many(45).map(i => ({item_id: 'i' + i, item_metadata: {
          complexity: ['hard', 'easy', 'medium'][i % 3],
          domain: i === 0 ? "['finance', 'support']" : 'support',
          request_id: 'req-' + i, tokens: 100 + i, retry_count: 1, trace_stats: {spans: 3},
        }}));
        // The second run tagged two items the first run did not.
        const rowsB = many(45).map(i => ({item_id: 'i' + i, item_metadata: {
          complexity: ['hard', 'easy', 'medium'][i % 3],
          ...(i < 2 ? {tags: i === 0 ? ['billing', 'refunds'] : 'refunds'} : {}),
          tokens: i === 3 ? 900 : 100 + i,
        }}));
        const state = compareState(rowsA, rowsB);
        const fields = Object.fromEntries(compareFilterFieldDefs().filter(f => f.group === 'Metadata').map(f => [f.id, f]));
        assert.deepEqual(Object.keys(fields).sort(),
          ['cat:complexity', 'cat:domain', 'cat:request_id', 'cat:tags', 'cat:tokens']);
        assert.deepEqual(fields['cat:complexity'].choices.map(c => c.value), ['easy', 'medium', 'hard']);
        assert.deepEqual(fields['cat:tags'].choices.map(c => c.value), ['billing', 'refunds']);
        assert.equal(fields['cat:tokens'].kind, 'number');
        assert.equal(fields['cat:request_id'].kind, 'text');

        // A value only one run carries still matches the item.
        assert.deepEqual(matching(state, {field: 'cat:tags', oper: 'in', value: ['refunds']}), ['i0', 'i1']);
        assert.deepEqual(matching(state, {field: 'cat:domain', oper: 'in', value: ['finance']}), ['i0']);
        // Numbers compare per run: run B's 900 lets i3 through.
        assert.deepEqual(matching(state, {field: 'cat:tokens', oper: 'gte', value: 143}), ['i3', 'i43', 'i44']);
        assert.deepEqual(matching(state, {field: 'cat:request_id', oper: 'contains', value: 'req-4'}),
          ['i4', 'i40', 'i41', 'i42', 'i43', 'i44']);
        // Scanned once per row set, again for a new one.
        const first = compareMetadataFilterDefs();
        assert.equal(compareMetadataFilterDefs(), first);
        state.runs[1].snapshot.rows = rowsB.slice(2);
        assert.notEqual(compareMetadataFilterDefs(), first);
        assert.ok(!compareMetadataFilterDefs().some(f => f.id === 'cat:tags'));
    """)


def test_root_cause_offers_the_causes_the_compared_runs_applied() -> None:
    _run_javascript(_filter_functions() + """
        const issues = (...categories) => ({root_cause_issues: categories.map(category => ({category}))});
        const state = compareState(
          [{item_id: 'a', item_metadata: {metric_analyses: {accuracy: issues('Retrieval')}}},
           {item_id: 'b', item_metadata: {}}, {item_id: 'c', item_metadata: {}}],
          [{item_id: 'a', item_metadata: {}},
           {item_id: 'b', item_metadata: {metric_analyses: {accuracy: issues('Prompt'), tokens: issues('Brand voice drift')}}},
           {item_id: 'c', item_metadata: {}}]);
        const field = compareFilterFieldById('cat:root_cause');
        assert.deepEqual(field.choices.map(c => c.value), ['Brand voice drift', 'Prompt', 'Retrieval']);
        // An item whose cause only an analysis holds matches (Compare used to
        // read item_metadata.root_cause only).
        assert.deepEqual(matching(state, {field: 'cat:root_cause', oper: 'in', value: ['Brand voice drift']}), ['b']);
        assert.deepEqual(matching(state, {field: 'cat:root_cause', oper: 'in', value: ['Retrieval', 'Prompt']}), ['a', 'b']);
        // Runs without root causes have no Root cause field.
        state.runs = [{snapshot: {rows: [{item_id: 'x', item_metadata: {}}]}}, {snapshot: {rows: []}}];
        assert.equal(compareFilterFieldById('cat:root_cause'), null);
    """)


def test_rules_and_page_filters_round_trip_through_the_url() -> None:
    _run_javascript(_filter_functions() + """
        const blank = () => ({
          ...compareState([], []), filterRoot: {op: 'and', children: []},
          approvalFilter: null, complexityFilter: null, domainFilter: null, domainFilterMode: 'include',
          domainExclusive: new Set(), rootCauseFilter: null, rootCauseMetric: 'all',
          taskErrorFilter: null, metricErrorFilter: null, traceErrorFilter: null, analysisErrorFilter: null,
          passRateOp: '', passRateValue: 0, baselineDeltaFilter: null, categoryFilters: {},
        });
        let state = blank();
        assert.equal(compareViewFiltersParam(), null);
        Object.assign(state, {
          filterRoot: {op: 'and', children: [{field: 'score:0', oper: 'gte', value: 0.7}, {field: '', oper: '', value: ''}]},
          approvalFilter: 'not_approved', complexityFilter: ['hard'],
          domainFilter: ['finance'], domainFilterMode: 'exclude',
          taskErrorFilter: {kind: 'Task error', label: 'TimeoutError'},
          metricErrorFilter: {kind: 'Metric error', label: LONG_ERROR},
          passRateOp: 'gte', passRateValue: 1,
          baselineDeltaFilter: {metric: 'accuracy', columnKey: 'run-b', baselineKey: 'run-a', kind: 'regressed'},
          categoryFilters: {tags: ['billing'], unused: null},
        });
        const raw = compareViewFiltersParam();
        const saved = JSON.parse(raw);
        // A long error label goes in as its start plus a hash of the whole.
        assert.equal(saved.errors.metric.label, undefined);
        assert.equal(saved.errors.metric.prefix.length, 40);
        assert.deepEqual(saved.categories, {tags: ['billing']});

        state = blank();
        applyCompareViewFiltersParam(raw);
        assert.equal(filterRuleCount(state.filterRoot), 1);
        assert.equal(state.approvalFilter, 'not_approved');
        assert.deepEqual(state.complexityFilter, ['hard']);
        assert.equal(state.domainFilterMode, 'exclude');
        assert.deepEqual(state.taskErrorFilter, {kind: 'Task error', label: 'TimeoutError'});
        assert.deepEqual(state.metricErrorFilter, {kind: 'Metric error', label: LONG_ERROR});
        assert.deepEqual([state.passRateOp, state.passRateValue], ['gte', 1]);
        assert.equal(state.baselineDeltaFilter.kind, 'regressed');
        // Categories wait for the compared runs' metadata keys.
        assert.deepEqual(pendingCompareCategoryFilters, {tags: ['billing']});

        // Anything malformed is left off.
        state = blank();
        applyCompareViewFiltersParam(JSON.stringify({
          rules: {op: 'xor', children: []}, approval: 'maybe', passRate: ['gte', 9],
          baseline: {metric: 'unknown', columnKey: 'a', baselineKey: 'b', kind: 'same'},
        }));
        applyCompareViewFiltersParam('{not json');
        assert.deepEqual(state.filterRoot, {op: 'and', children: []});
        assert.equal(state.approvalFilter, null);
        assert.equal(state.passRateOp, '');
        assert.equal(state.baselineDeltaFilter, null);
    """)
