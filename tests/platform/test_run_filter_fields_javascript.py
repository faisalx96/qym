"""Run page Filters fields, executed with Node against the page's own functions.

- Score rules are written as percentages (60 for a stored 0.6).
- Every item metadata key is a field; list values break into their entries.
- Root cause offers only the causes this run's analyses applied, custom ones
  included, and matches through any of an item's analyses.
"""

from __future__ import annotations

from test_root_cause_issue_javascript import _function, _run_javascript


def _filter_functions() -> str:
    return "\n".join(_function("run", name) for name in (
        "categoryValueText", "parseMetaList", "isListCategoryKey", "getMetadataCategoryValues",
        "formatFieldName", "rootCauseCategories", "rootCauseIssues", "isRepeatRun",
        "isRepeatAggregateView", "getRowRootCauseAnalyses", "itemMetadataFilterDefs",
        "itemRootCauses", "appliedRootCauseValues", "itemFilterFieldDefs", "itemFilterFieldById",
        "_filterConditionComplete", "filterRuleCount", "_numCompare", "evalFilterNode",
        "_fbOperSelect", "_fbCondHtml",
    )) + """
        const _isFilterGroup = node => Array.isArray(node.children);
        const runDetails = null;
        const runNeedsFullText = () => false;
        const window = {QymMetrics: {parseScoreValue: v => (v === '' || v == null ? null : Number(v)),
          isErrorRow: () => false}};
        const metricDirectionOf = () => 'maximize';
        const rowPassesFor = () => null, rowScoreFor = () => ({score: null});
        const matchesApprovalFilter = () => false, rowHasEditedMetric = () => false;
        const getRowTraceErrorCount = () => 0, stringify = String;
        const escapeAttr = String, escapeHtml = String, FILTER_TRASH_ICON = '';
        const matching = (state, rule) => state.snapshot.rows
          .filter(row => evalFilterNode({op: 'and', children: [rule]}, row)).map(row => row.item_id);
    """


def test_a_score_rule_is_written_and_shown_as_a_percentage() -> None:
    _run_javascript(_filter_functions() + """
        const state = {allMetrics: ['accuracy', 'tokens'], metricTypes: {accuracy: 'score', tokens: 'numeric'},
          viewPass: null, run: {}, snapshot: {rows: [
            {item_id: 'a', metric_values: ['0.55', '12']}, {item_id: 'b', metric_values: ['0.75', '40']}]}};
        assert.equal(itemFilterFieldById('metric:accuracy').percent, true);
        assert.equal(itemFilterFieldById('metric:tokens').percent, false);
        const rule = {field: 'metric:accuracy', oper: 'gt', value: 0.6};
        assert.deepEqual(matching(state, rule), ['b']);
        const html = _fbCondHtml(rule, '0');
        assert.match(html, /value="60"/);
        assert.match(html, /max="100"/);
        assert.match(html, /class="fb-unit"[^>]*>%</);
        // A count keeps its own units.
        const countHtml = _fbCondHtml({field: 'metric:tokens', oper: 'gte', value: 12}, '0');
        assert.match(countHtml, /value="12"/);
        assert.ok(!countHtml.includes('fb-unit'));
    """)


def test_every_metadata_key_is_a_field_and_lists_break_into_entries() -> None:
    _run_javascript(_filter_functions() + """
        const many = n => Array.from({length: n}, (_, i) => i);
        const rows = many(45).map(i => ({item_id: 'i' + i, metric_values: [], item_metadata: {
          tags: i === 0 ? ['billing', 'refunds'] : (i === 1 ? ['refunds'] : 'billing'),
          // A list key may arrive as text, as Performance by category reads it.
          domain: i === 0 ? "['finance', 'support']" : 'support',
          complexity: ['hard', 'easy', 'medium'][i % 3],
          request_id: 'req-' + i, tokens: 100 + i,
          retry_count: 1, trace_stats: {spans: 3}, task_started_at_ms: 1700000000000 + i,
        }}));
        const state = {allMetrics: [], metricTypes: {}, viewPass: null, run: {}, snapshot: {rows}};
        const fields = Object.fromEntries(itemFilterFieldDefs().filter(f => f.group === 'Metadata').map(f => [f.id, f]));
        assert.deepEqual(Object.keys(fields).sort(),
          ['cat:complexity', 'cat:domain', 'cat:request_id', 'cat:tags', 'cat:tokens']);
        assert.equal(fields['cat:tags'].kind, 'enum');
        assert.deepEqual(fields['cat:tags'].values, ['billing', 'refunds']);
        assert.deepEqual(fields['cat:domain'].values, ['finance', 'support']);
        assert.deepEqual(matching(state, {field: 'cat:domain', oper: 'in', value: ['finance']}), ['i0']);
        assert.deepEqual(fields['cat:complexity'].values, ['easy', 'medium', 'hard']);
        // Too many values for chips: numbers compare, other text matches.
        assert.equal(fields['cat:tokens'].kind, 'number');
        assert.equal(fields['cat:request_id'].kind, 'text');

        assert.deepEqual(matching(state, {field: 'cat:tags', oper: 'in', value: ['refunds']}), ['i0', 'i1']);
        assert.equal(matching(state, {field: 'cat:tags', oper: 'notin', value: ['billing']}).join(), 'i1');
        assert.deepEqual(matching(state, {field: 'cat:tokens', oper: 'gte', value: 143}), ['i43', 'i44']);
        assert.deepEqual(matching(state, {field: 'cat:request_id', oper: 'contains', value: 'req-4'}),
          ['i4', 'i40', 'i41', 'i42', 'i43', 'i44']);
        // Scanned once per row set.
        assert.equal(itemMetadataFilterDefs(), itemMetadataFilterDefs());
    """)


def test_root_cause_offers_only_the_causes_this_run_applied() -> None:
    _run_javascript(_filter_functions() + """
        const issues = (...categories) => ({root_cause_issues: categories.map(category => ({category}))});
        const state = {allMetrics: ['accuracy', 'tone'], metricTypes: {}, viewPass: null, run: {},
          categoryCatalog: {categories: ['Retrieval', 'Prompt', 'Tooling']},
          snapshot: {rows: [
            {item_id: 'a', metric_values: [], item_metadata: {metric_analyses: {accuracy: issues('Retrieval')}}},
            {item_id: 'b', metric_values: [], item_metadata: {metric_analyses: {
              accuracy: issues('Prompt'), tone: issues('Brand voice drift')}}},
            {item_id: 'c', metric_values: [], item_metadata: {}},
          ]}};
        const field = itemFilterFieldById('cat:root_cause');
        // Catalog categories no item carries ("Tooling") are not offered.
        assert.deepEqual(field.values, ['Brand voice drift', 'Prompt', 'Retrieval']);
        // An item matches through any metric's analysis, custom causes included.
        assert.deepEqual(matching(state, {field: 'cat:root_cause', oper: 'in', value: ['Brand voice drift']}), ['b']);
        assert.deepEqual(matching(state, {field: 'cat:root_cause', oper: 'in', value: ['retrieval', 'prompt']}), ['a', 'b']);
        // A run without root causes has no Root cause field.
        const empty = {...state, snapshot: {rows: [{item_id: 'x', metric_values: [], item_metadata: {}}]}};
        Object.assign(state, empty);
        assert.equal(itemFilterFieldById('cat:root_cause'), null);
    """)
