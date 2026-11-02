import { describe, expect, it } from 'vitest';
import {
  detectMetricType,
  formatLatency,
  formatNumericValue,
  getRowScore,
  hasTaskError,
  isErrorRow,
  metricPasses,
  parseMetricScoreInput,
  rowMetricErrorCounts,
  rowMetricPasses,
  scoreWithoutMetricErrors,
} from '@/lib/metrics';
import { applyQueryUpdates } from '@/lib/url-state';
import { needsServerReason, pickReason } from '../itemReasons';
import {
  collectErrors,
  errorBucketKey,
  errorFilterUrlValue,
  errorLabelFromUrlValue,
  errorLabelHash,
  normalizeErrorLabel,
} from '../rowErrors';
import {
  applyItemFilters,
  buildFieldDefs,
  countActiveFilters,
  decodeFiltersParam,
  effectiveThresholds,
  emptyView,
  encodeFiltersParam,
  evalFilterNode,
  filterRuleCount,
  readRunView,
  validFilterRule,
  writeRunView,
  type FilterGroup,
} from '../filterRules';
import { buildRunModel } from '../runModel';
import { scopeRowToPass } from '../passScope';
import {
  buildTree,
  buildLangfuseTraceUrl,
  detectRetries,
  extractMessages,
  failingSpan,
  flattenTree,
  normalizeTrace,
  searchVisible,
} from '../traceTree';
import { collation, neighborQuery, normalizeContext, runHref } from '../runsOrder';
import { mergeRow, reuseRows, rowSignature } from '../rowSignature';
import type { Row, RunPayload, Span } from '../../types';

const specs = {
  exact: { score_type: 'boolean', direction: 'maximize', pass_threshold: 1, schema_version: 2 },
  quality: {
    score_type: 'percentage',
    direction: 'maximize',
    pass_threshold: 0.7,
    primary: true,
    schema_version: 2,
  },
  halluc: { score_type: 'percentage', direction: 'minimize', pass_threshold: 0.3, schema_version: 2 },
  tokens: { score_type: 'count', schema_version: 2 },
};
const names = Object.keys(specs);

function row(partial: Partial<Row> & { index: number }): Row {
  return {
    item_id: `item-${partial.index}`,
    status: 'completed',
    metric_values: [1, 0.9, 0.1, 120],
    latency_ms: 500,
    item_metadata: { domain: 'commerce', complexity: 'easy', source: 'human' },
    ...partial,
  } as Row;
}

const rows: Row[] = [
  row({ index: 0 }),
  row({
    index: 1,
    metric_values: [0, 0.5, 0.6, 900],
    latency_ms: 2500,
    item_metadata: { domain: 'finance', complexity: 'hard' },
  }),
  row({
    index: 2,
    status: 'error',
    error: 'TimeoutError: task exceeded 30s',
    metric_values: ['', '', '', ''],
    latency_ms: 3000,
  }),
  row({
    index: 3,
    metric_values: [1, 0, 0.2, 80],
    metric_meta: { quality: { status: 'error', error: 'JudgeError: malformed' } },
    retry_count: 2,
    trace_stats: { tool_errors: 1 },
  }),
  row({
    index: 4,
    status: 'not_received',
    output_received: false,
    metric_values: ['', '', '', ''],
    latency_ms: 0,
  }),
  row({
    index: 5,
    metric_values: [1, 0.8, 0.1, 50],
    metric_meta: { quality: { modified: 'true', original_score: 0.2 } },
  }),
];

const payload: RunPayload = {
  run: { run_id: 'r1', status: 'COMPLETED', metric_names: names, metric_specs: specs, samples: 1 },
  snapshot: {
    rows,
    metric_names: names,
    metric_specs: specs,
    metric_meta_keys: { quality: ['reason', 'explanation', 'status'] },
  },
};

describe('metrics port', () => {
  it('counts task and scorer errors by direction', () => {
    expect(getRowScore(rows[2], 1, 'quality', 'maximize')).toEqual({ score: 0, isError: true });
    expect(getRowScore(rows[2], 2, 'halluc', 'minimize')).toEqual({ score: null, isError: true });
    expect(getRowScore(rows[3], 1, 'quality', 'maximize')).toEqual({ score: 0, isError: true });
    expect(getRowScore(rows[3], 2, 'halluc', 'minimize')).toEqual({ score: 0.2, isError: false });
    expect(getRowScore(rows[4], 1, 'quality', 'maximize')).toEqual({ score: null, isError: false });
    expect(rowMetricErrorCounts(rows[3]!, 'quality')).toEqual({ task: 0, scorer: 1 });
    expect(rowMetricErrorCounts(rows[2]!, 'quality')).toEqual({ task: 1, scorer: 0 });
    expect(scoreWithoutMetricErrors(rows[3]!, 1, 'quality')).toEqual({ score: null, errors: 1 });
    expect(isErrorRow(rows[3])).toBe(true);
    expect(hasTaskError(rows[2])).toBe(true);
  });
  it('judges repeat rows per pass', () => {
    const repeat = row({
      index: 9,
      status: 'completed',
      metric_values: [0.5, 0.6, 0.1, 0],
      pass_scores: { quality: [0.9, 0, 0.9], halluc: [0.1, 0, 0.2] },
      pass_metric_meta: {
        quality: [{}, { label: 'error', task_error: true }, {}],
        halluc: [{}, { label: 'error', task_error: true }, {}],
      },
      pass_attempts: [{ status: 'completed' }, { status: 'failed' }, { status: 'completed' }],
    });
    expect(hasTaskError(repeat)).toBe(true);
    expect(rowMetricErrorCounts(repeat, 'quality')).toEqual({ task: 1, scorer: 0 });
    expect(getRowScore(repeat, 1, 'quality', 'maximize')).toEqual({ score: 0.6, isError: false });
    expect(getRowScore(repeat, 2, 'halluc', 'minimize')).toEqual({
      score: 0.15000000000000002,
      isError: true,
    });
  });
  it('passes, parses and formats', () => {
    expect(metricPasses(0.7, 0.7, 'maximize')).toBe(true);
    expect(metricPasses(0.3, 0.3, 'minimize')).toBe(true);
    expect(metricPasses(0.5, 0.7, null)).toBeNull();
    expect(rowMetricPasses({ score: null, isError: true }, 0.3, 'minimize')).toBe(false);
    expect(parseMetricScoreInput('70%', specs.quality)).toEqual({ ok: true, value: 0.7 });
    expect(parseMetricScoreInput('0,7', specs.quality)).toEqual({
      ok: false,
      message: 'Use a dot for decimals (0.7, not 0,7).',
    });
    expect(parseMetricScoreInput('true', specs.exact)).toEqual({ ok: true, value: 1 });
    expect(parseMetricScoreInput('1.5', specs.tokens).ok).toBe(false);
    expect(formatLatency(1500)).toBe('1.5s');
    expect(formatLatency(65000)).toBe('1m 5s');
    expect(formatNumericValue(12345)).toBe('12.3K');
    expect(detectMetricType(rows, 3)).toBe('numeric');
    expect(detectMetricType(rows, 0)).toBe('boolean');
  });
});

describe('run model and pass scope', () => {
  const model = buildRunModel(payload, null);
  it('derives types, directions, thresholds and keys', () => {
    expect(model.metricTypes).toEqual({
      exact: 'boolean',
      quality: 'score',
      halluc: 'score',
      tokens: 'numeric',
    });
    expect(model.metricDirections.halluc).toBe('minimize');
    expect(model.defaultThresholds.quality).toBe(0.7);
    expect(model.defaultMetric).toBe('quality');
    expect(model.allMetadataKeys).toEqual(['complexity', 'domain', 'source']);
    expect(model.autoCategories).toEqual(['complexity', 'domain', 'source']);
    expect(model.allMetricMetaKeys).toContain('reason');
    expect(model.allMetricMetaKeys).not.toContain('modified');
  });
  it('scopes a repeat row to one pass', () => {
    const repeat = row({
      index: 7,
      metric_values: [0.5, 0.6, 0.1, 0],
      pass_scores: { exact: [1, 0, 1], quality: [0.9, 0, 0.9], halluc: [0.1, 0, 0.2], tokens: [1, 2, 3] },
      pass_metric_meta: { quality: [{ reason: 'a' }, { label: 'error', task_error: true }, { reason: 'c' }] },
      pass_attempts: [
        { pass_number: 1, status: 'completed', latency_ms: 100, output: 'one', trace_id: 't1' },
        { pass_number: 2, status: 'failed', latency_ms: 200, error: 'boom' },
        { pass_number: 3, status: 'completed', latency_ms: 300, output: 'three' },
      ],
    });
    const scoped = scopeRowToPass(repeat, names, 2);
    expect(scoped.status).toBe('error');
    expect(scoped.metric_values).toEqual([0, 0, 0, 2]);
    expect(scoped.error).toBe('boom');
    expect(scoped.__pass_scope).toBe(true);
    expect(scoped.latency_ms).toBe(200);
    const third = scopeRowToPass(repeat, names, 3);
    expect(third.output).toBe('three');
    expect(third.metric_meta?.quality).toEqual({ reason: 'c' });
    const m = buildRunModel(
      { run: { ...payload.run, samples: 3 }, snapshot: { ...payload.snapshot, rows: [repeat] } },
      2,
    );
    expect(m.viewPass).toBe(2);
    expect(m.rows[0]!.status).toBe('error');
    expect(
      buildRunModel(
        { run: { ...payload.run, samples: 3 }, snapshot: { ...payload.snapshot, rows: [repeat] } },
        5,
      ).viewPass,
    ).toBeNull();
  });
});

describe('filter rules', () => {
  const model = buildRunModel(payload, null);
  const view = emptyView();
  const ctx = {
    model,
    thresholds: effectiveThresholds(model, view),
    selectedMetric: 'quality',
    repeatAggregate: false,
  };
  const defs = buildFieldDefs(ctx);
  const defMap = new Map(defs.map((d) => [d.id, d]));

  it('offers the vanilla field list', () => {
    expect(defs.map((d) => d.label)).toEqual([
      'exact',
      'quality',
      'halluc',
      'tokens',
      'Approval',
      'Output text',
      'Complexity',
      'Domain',
      'Source',
      'Has error',
      'Edited metrics',
      'Retries',
      'Trace errors',
      // round 3 P7: the box plot cards filter tokens and cost per item
      'Tokens',
      'Cost ($)',
      'Latency (ms)',
    ]);
    expect(defMap.get('cat:complexity')?.values).toEqual(['easy', 'hard']);
    expect(defMap.get('metric:tokens')?.kind).toBe('number');
  });

  it('evaluates nested AND/OR rules', () => {
    const rules: FilterGroup = {
      op: 'and',
      children: [
        { field: 'metric:quality', oper: 'is', value: 'failed' },
        {
          op: 'or',
          children: [
            { field: 'latency', oper: 'gt', value: '1000' },
            { field: 'cat:complexity', oper: 'in', value: ['hard'] },
          ],
        },
      ],
    };
    expect(filterRuleCount(rules, defMap)).toBe(3);
    expect(evalFilterNode(rules, rows[1]!, defMap)).toBe(true);
    expect(evalFilterNode(rules, rows[0]!, defMap)).toBe(false);
    expect(evalFilterNode({ field: 'metric:quality', oper: '', value: '' }, rows[0]!, defMap)).toBe(true);
    expect(evalFilterNode({ field: 'edited', oper: 'is', value: 'true' }, rows[5]!, defMap)).toBe(true);
    expect(evalFilterNode({ field: 'traceerr', oper: 'gte', value: 1 }, rows[3]!, defMap)).toBe(true);
    expect(evalFilterNode({ field: 'metric:halluc', oper: 'is', value: 'failed' }, rows[2]!, defMap)).toBe(
      true,
    );
  });

  it('applies show buckets, page filters and sorting', () => {
    const items = applyItemFilters(ctx, { ...view, show: 'failed' }, defs);
    expect(items.map((i) => i.row.index)).toEqual([1]);
    expect(applyItemFilters(ctx, { ...view, show: 'metric_errors' }, defs).map((i) => i.row.index)).toEqual([
      2, 3,
    ]);
    expect(applyItemFilters(ctx, { ...view, show: 'errors' }, defs).map((i) => i.row.index)).toEqual([2, 3]);
    expect(applyItemFilters(ctx, { ...view, show: 'retries' }, defs).map((i) => i.row.index)).toEqual([3]);
    const sorted = applyItemFilters(ctx, { ...view, sort: 'score_desc' }, defs).map((i) => i.row.index);
    expect(sorted).toEqual([0, 5, 1, 2, 3, 4]);
    const byLatency = applyItemFilters(ctx, { ...view, sort: 'latency_desc' }, defs).map((i) => i.row.index);
    expect(byLatency[0]).toBe(2);
    const scored = applyItemFilters(
      ctx,
      { ...view, filters: { ...view.filters, score: { min: 0.8, max: 1.01 } } },
      defs,
    );
    expect(scored.map((i) => i.row.index)).toEqual([0, 5]);
    const lat = applyItemFilters(
      ctx,
      { ...view, filters: { ...view.filters, latency: { min: 2000, max: Infinity } } },
      defs,
    );
    expect(lat.map((i) => i.row.index)).toEqual([1, 2]);
    const cat = applyItemFilters(
      ctx,
      { ...view, filters: { ...view.filters, categories: { source: ['unknown'] } } },
      defs,
    );
    expect(cat.map((i) => i.row.index)).toEqual([1]);
    const q = applyItemFilters(ctx, { ...view, q: 'item-5' }, defs);
    expect(q.map((i) => i.row.index)).toEqual([5]);
    expect(countActiveFilters({ ...view, show: 'failed', q: 'x', sort: 'score_asc' }, defs)).toBe(1);
  });

  it('round-trips the filters JSON and view params byte for byte', () => {
    const errors = collectErrors(rows, false);
    const taskBucket = Array.from(errors.values()).find((b) => b.kind === 'Task error')!;
    expect(taskBucket.label).toBe('TimeoutError: task exceeded 30s');
    const filters = {
      ...view.filters,
      rules: { op: 'and' as const, children: [{ field: 'latency', oper: 'gt', value: '1000' }] },
      complexity: ['hard'],
      errors: { task: { kind: 'Task error', label: taskBucket.label } },
      latency: { min: 100, max: Infinity },
      categories: { source: ['human'] },
    };
    const encoded = encodeFiltersParam(filters, defs)!;
    expect(JSON.parse(encoded)).toEqual({
      rules: { op: 'and', children: [{ field: 'latency', oper: 'gt', value: '1000' }] },
      complexity: ['hard'],
      errors: { task: { kind: 'Task error', label: 'TimeoutError: task exceeded 30s' } },
      latency: [100, null],
      categories: { source: ['human'] },
    });
    const decoded = decodeFiltersParam(encoded, {
      metricNames: names,
      metadataKeys: model.allMetadataKeys,
      rows,
      repeatAggregate: false,
    });
    expect(decoded).toEqual(filters);
    expect(validFilterRule({ op: 'xor', children: [] })).toBe(false);
    expect(
      decodeFiltersParam('not json', { metricNames: names, metadataKeys: [], rows, repeatAggregate: false }),
    ).toEqual(view.filters);

    const params = new URLSearchParams(
      'q=hello&sort=latency_asc&metric=halluc&threshold=40&show=failed&page=3&hide_field=domain&hide_field=nope',
    );
    const read = readRunView(params, {
      model,
      metricNames: names,
      metadataKeys: model.allMetadataKeys,
      rows,
      repeatAggregate: false,
    });
    expect(read.q).toBe('hello');
    expect(read.sort).toBe('latency_asc');
    expect(read.metric).toBe('halluc');
    expect(read.threshold).toBeCloseTo(0.4);
    expect(read.show).toBe('failed');
    expect(read.page).toBe(3);
    expect(read.hideFields).toEqual(['domain']);
    const written = writeRunView(read, model, defs);
    expect(written).toEqual({
      q: 'hello',
      sort: 'latency_asc',
      view: null,
      metric: 'halluc',
      threshold: '40',
      show: 'failed',
      dataset: null,
      filters: null,
      page: '3',
      hide_field: ['domain'],
      hide_metric_field: null,
    });
    expect(writeRunView(emptyView(), model, defs).metric).toBeNull();
    const applied = applyQueryUpdates(new URLSearchParams('a=1'), written);
    expect(applied.getAll('hide_field')).toEqual(['domain']);
    expect(applied.get('view')).toBeNull();
  });
});

describe('error labels', () => {
  it('hashes long labels into prefix+hash and finds them back', () => {
    const long = 'RateLimitError: ' + 'x'.repeat(200);
    const hash = errorLabelHash(long);
    expect(hash).toMatch(/^[0-9a-z]+\.60$/);
    const value = errorFilterUrlValue({ kind: 'Task error', label: long });
    expect(value).toEqual({ kind: 'Task error', prefix: long.slice(0, 40), hash });
    const r = row({ index: 1, status: 'error', error: long, metric_values: ['', '', '', ''] });
    expect(errorLabelFromUrlValue([r], false, 'Task error', long.slice(0, 40), hash)).toBe(long);
    expect(errorLabelFromUrlValue([r], false, 'Task error', 'zzz', hash)).toBeNull();
    expect(normalizeErrorLabel('ERROR: a\n b  c')).toBe('a b c');
    expect(errorBucketKey('Task error', 'T: ' + 'd'.repeat(100))).toBe('Task error||T||' + 'd'.repeat(69));
  });
  it('collects every error kind', () => {
    const buckets = Array.from(collectErrors(rows, false).values());
    expect(buckets.map((b) => `${b.kind}|${b.label}|${b.count}`)).toEqual([
      'Task error|TimeoutError: task exceeded 30s|1',
      'Metric error|quality: JudgeError: malformed|1',
      'Trace error|Tool errors|1',
    ]);
  });
});

describe('item reasons', () => {
  it('picks the first source that exists', () => {
    expect(pickReason({ taskError: 'boom' }).kind).toBe('task-error');
    expect(pickReason({ meta: { status: 'error', error: 'bad' } })).toEqual({
      text: 'bad',
      source: 'scorer error',
      kind: 'scorer-error',
    });
    expect(pickReason({ meta: { reason: 'r', error: 'e' } }).text).toBe('r');
    expect(pickReason({ meta: { error: 'e' } }).kind).toBe('verdict-error');
    expect(pickReason({ meta: { explanation: 'x' } }).source).toBe('explanation');
    expect(pickReason({ meta: { label: 'fail' } }).kind).toBe('label');
    expect(pickReason({ score: '42.0%', need: '≥70%' }).text).toBe('Scored 42.0%, pass needs ≥70%');
    expect(needsServerReason(pickReason({ meta: { label: 'fail' } }), ['reason'])).toBe(true);
    expect(needsServerReason(pickReason({ meta: { explanation: 'x' } }), ['reason', 'explanation'])).toBe(
      true,
    );
    expect(needsServerReason(pickReason({ meta: { explanation: 'x' } }), ['explanation'])).toBe(false);
    expect(needsServerReason(pickReason({ meta: { label: 'fail' } }), ['explanation'])).toBe(true);
    expect(needsServerReason(pickReason({ taskError: true }), ['reason'])).toBe(false);
  });
});

describe('trace tree', () => {
  it('builds a 6000-span trace without going quadratic and still drops true duplicates', () => {
    const spans: Span[] = [];
    for (let i = 0; i < 6000; i++) {
      spans.push({
        span_id: `s${i}`,
        parent_span_id: null,
        name: 'llm',
        start_time_ns: i * 1e6,
        end_time_ns: (i + 1) * 1e6 - 1,
        duration_ms: 1,
        status: 'OK',
        attributes: { 'openinference.span.kind': 'LLM', 'llm.model_name': 'm', 'input.value': `q${i}` },
      } as Span);
    }
    // an exact twin of span 10 (same model, input, output, timing)
    spans.push({ ...spans[10]!, span_id: 'twin' });
    const started = performance.now();
    const tree = buildTree(spans);
    expect(performance.now() - started).toBeLessThan(2500);
    expect(flattenTree(tree.roots)).toHaveLength(6000);
  });

  const span = (
    id: string,
    parent: string | null,
    name: string,
    kind: string,
    start: number,
    end: number,
    extra: Partial<Span> = {},
  ): Span => ({
    span_id: id,
    parent_span_id: parent,
    name,
    start_time_ns: start,
    end_time_ns: end,
    duration_ms: (end - start) / 1e6,
    status: 'OK',
    attributes: { 'openinference.span.kind': kind },
    events: [],
    ...extra,
  });
  const spans: Span[] = [
    span('root', null, 'agent', 'AGENT', 0, 10e6),
    span('seq', 'root', 'RunnableSequence', 'CHAIN', 1e6, 9e6),
    span('llm', 'seq', 'ChatOpenAI', 'LLM', 2e6, 6e6, {
      attributes: {
        'openinference.span.kind': 'LLM',
        'llm.model_name': 'openai/gpt-5',
        'llm.token_count.total': 10,
      },
    }),
    span('tool', 'seq', 'lookup', 'TOOL', 6e6, 8e6, {
      status: 'ERROR',
      events: [{ name: 'exception', attributes: { 'exception.message': 'x' } }],
    }),
    span('tool2', 'seq', 'lookup', 'TOOL', 8e6, 9e6),
    span('orphan', 'missing', 'stray', 'CHAIN', 0, 1e6),
  ];
  it('builds, collapses noise and detects retries', () => {
    const tree = buildTree(spans);
    detectRetries(tree);
    expect(tree.roots.map((r) => r.span_id)).toEqual(['root', 'orphan']);
    expect(tree.byId.get('orphan')?._orphan).toBe(true);
    const root = tree.byId.get('root')!;
    // RunnableSequence is a noise name but its subtree holds an error, so it is kept (vanilla rule)
    expect(root._children.map((c) => c.span_id)).toEqual(['seq']);
    expect(root._children[0]!._children.map((c) => c.span_id)).toEqual(['llm', 'tool', 'tool2']);
    expect(root._children[0]!._children[0]!._depth).toBe(2);
    const clean = buildTree(spans.filter((s) => s.span_id !== 'tool'));
    expect(clean.byId.get('root')!._children.map((c) => c.span_id)).toEqual(['llm', 'tool2']);
    expect(tree.byId.get('tool')?._failed).toBe(true);
    expect(tree.byId.get('tool2')?._try).toBe(2);
    expect(failingSpan(tree)?.span_id).toBe('tool');
    expect(flattenTree(tree.roots).map((n) => n.span_id)).toEqual([
      'root',
      'seq',
      'llm',
      'tool',
      'tool2',
      'orphan',
    ]);
    expect(searchVisible(tree, 'lookup')).toEqual(new Set(['tool', 'tool2', 'seq', 'root']));
  });
  it('merges retried attempts into one tree', () => {
    const failed = [
      span('r1', null, 'agent', 'AGENT', 0, 5e6, { status: 'ERROR' }),
      span('l1', 'r1', 'ChatOpenAI', 'LLM', 1e6, 4e6, { status: 'ERROR', events: [{ name: 'exception' }] }),
    ];
    const data = normalizeTrace({
      item: { item_id: 'i', trace_id: 't2' },
      attempts: [
        { attempt_number: 1, status: 'failed', is_last_attempt: false, spans: failed, trace_id: 't1' },
        { attempt_number: 2, status: 'completed', is_last_attempt: true, spans, trace_id: 't2' },
      ],
    });
    expect(data.item.retry_count).toBe(1);
    expect(data.combined?.attemptCount).toBe(2);
    expect(data.combined?.failedCount).toBe(1);
    const root = data.combined!.roots.find((r) => r.span_id === 'root')!;
    expect(root._children.map((c) => c.span_id)).toEqual(['seq', 'l1']);
    expect(root._children[1]!._attemptNumber).toBe(1);
    expect(root._children[0]!._attemptNumber).toBe(2);
  });
  it('extracts messages and builds Langfuse links', () => {
    const msgs = extractMessages(
      {
        'llm.input_messages.0.message.role': 'user',
        'llm.input_messages.0.message.content': 'hi',
        'llm.input_messages.1.message.role': 'assistant',
        'llm.input_messages.1.message.tool_calls.0.tool_call.function.name': 'f',
        'llm.input_messages.1.message.tool_calls.0.tool_call.function.arguments': '{}',
      },
      'llm.input_messages',
    );
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.toolCalls[0]!.name).toBe('f');
    expect(buildLangfuseTraceUrl('https://lf.example/', 'p1', 't 1')).toBe(
      'https://lf.example/project/p1/traces/t%201',
    );
    expect(buildLangfuseTraceUrl(null, 'p1', 't')).toBeNull();
  });
});

describe('runs order', () => {
  it('normalizes contexts and builds neighbour queries', () => {
    expect(normalizeContext('page=3&sort=time-desc&task=a&q=%20x%20%20y&bogus=1')).toBe('task=a&q=x+y');
    expect(runHref('/r/1', 'task=a')).toBe('/r/1?list=task%3Da');
    expect(runHref('/r/1', '')).toBe('/r/1');
    const q = neighborQuery('model=gpt&origin=official&sort=model-asc');
    expect(q.filters.models).toEqual(['gpt|||plain', 'gpt|||reasoning']);
    expect(q.filters.origins).toEqual(['official']);
    expect(q.sort).toBe('model-asc');
    expect(collation('model-asc', ['b/x|||reasoning', 'a/x|||plain'])).toEqual([
      'a/x|||plain',
      'b/x|||reasoning',
    ]);
    expect(collation('time-desc', ['a'])).toBeNull();
  });
});

describe('row identity across refetch', () => {
  it('keeps unchanged rows and loaded bodies', () => {
    const loaded: Row = { ...rows[0]!, input: 'full', __details_loaded: true };
    const prev: RunPayload = { ...payload, snapshot: { ...payload.snapshot, rows: [loaded, rows[1]!] } };
    const next: RunPayload = {
      run: { ...payload.run },
      snapshot: { ...payload.snapshot, rows: [{ ...rows[0]! }, { ...rows[1]!, latency_ms: 1 }] },
    };
    const merged = reuseRows(prev, next);
    expect(merged.snapshot.rows[0]).toBe(loaded);
    expect(merged.snapshot.rows[1]).not.toBe(rows[1]);
    expect(merged.snapshot.rows[1]!.latency_ms).toBe(1);
    expect(rowSignature(rows[0]!)).toBe(rowSignature({ ...rows[0]!, input: 'different' }));
    const same = reuseRows(prev, {
      run: { ...payload.run },
      snapshot: { ...payload.snapshot, rows: [{ ...rows[0]! }, { ...rows[1]! }] },
    });
    expect(same).toBe(prev);
    const patched = mergeRow(prev, { ...rows[0]!, metric_values: [1, 0.5, 0.1, 120] });
    expect(patched.snapshot.rows[0]!.metric_values[1]).toBe(0.5);
    expect(patched.snapshot.rows[0]!.__details_loaded).toBe(true);
  });
});

describe('normalizeTrace retried items', () => {
  const span = (id: string, name: string, parent: string | null, status = 'OK', t = 0) => ({
    trace_id: 't',
    span_id: id,
    parent_span_id: parent,
    name,
    status,
    start_time_ns: t,
    end_time_ns: t + 1e6,
  });
  it('keeps each single attempt free of the merged failed try', () => {
    const norm = normalizeTrace({
      item: { run_id: 'r', item_id: 'i', trace_id: 't', trace_url: '', retry_count: 1 },
      summary: {},
      spans: [],
      attempts: [
        {
          attempt_number: 1,
          status: 'failed',
          is_last_attempt: false,
          spans: [span('a', 'root', null, 'OK'), span('b', 'llm', 'a', 'ERROR', 1e6)],
        },
        {
          attempt_number: 2,
          status: 'completed',
          is_last_attempt: true,
          spans: [span('c', 'root', null), span('d', 'llm', 'c', 'OK', 2e6)],
        },
      ],
    } as never);
    expect(norm.combined!.nodes.length).toBe(3);
    expect(norm.attempts[1]!.tree.nodes.length).toBe(2);
    expect(flattenTree(norm.attempts[1]!.tree.roots).length).toBe(1);
  });
});
