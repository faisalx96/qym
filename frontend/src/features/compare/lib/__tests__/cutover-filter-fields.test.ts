/**
 * Cutover of tests/platform/test_compare_filter_fields_javascript.py (the vanilla Compare Filters
 * fields and view URL, executed with Node): score rules are percentages, every item metadata key
 * of any compared run is a field (an item matches when any run's row does), Root cause offers
 * only the causes the runs' analyses applied, and rules + page filters round-trip the URL value.
 */
import { describe, expect, it } from 'vitest';
import type { Row } from '@/features/run-detail/types';
import { buildCompareModel, type ComparePayload } from '../model';
import {
  applyFilters,
  decodeFiltersParam,
  emptyFilters,
  emptyView,
  encodeFiltersParam,
  fieldDefsFor,
  type FilterNode,
} from '../filters';

const SPECS = {
  accuracy: { score_type: 'percentage', direction: 'maximize', schema_version: 2 },
  tokens: { score_type: 'number', schema_version: 2 },
};

function run(id: string, rows: Array<Partial<Row> & { item_id: string; score?: number }>) {
  const built = rows.map(
    (r, index) =>
      ({
        index,
        compare_item_id: r.item_id,
        status: 'completed',
        metric_values: [r.score ?? '', ''],
        metric_meta: {},
        item_metadata: {},
        ...r,
      }) as unknown as Row,
  );
  return {
    run: {
      run_id: id,
      file_path: id,
      run_name: id,
      model_name: id,
      metric_names: ['accuracy', 'tokens'],
      metric_specs: SPECS,
      status: 'COMPLETED',
      samples: 1,
      config: {},
      metadata: {},
    },
    snapshot: { rows: built, metric_names: ['accuracy', 'tokens'], metric_specs: SPECS },
  } as unknown as ComparePayload['runs'][number];
}

const modelOf = (...runs: ComparePayload['runs']) =>
  buildCompareModel(
    { runs, compare_alignment_status: 'aligned', unalignable_runs: [], missing_runs: [] },
    runs.map((r) => r.run.run_id),
  );

const matching = (model: ReturnType<typeof modelOf>, rule: FilterNode, metric = 'accuracy') => {
  const filters = emptyFilters();
  filters.rules = { op: 'and', children: [rule] };
  return applyFilters({
    model,
    view: { ...emptyView(), filters },
    metric,
    thresholds: {},
    groups: null,
  }).items.map((i) => i.itemId);
};

describe('compare Filters fields', () => {
  it('a score rule is a percentage for a score metric and keeps units for a count', () => {
    const model = modelOf(
      run('A', [
        { item_id: 'a', score: 0.55 },
        { item_id: 'b', score: 0.75 },
      ]),
      run('B', [
        { item_id: 'a', score: 0.9 },
        { item_id: 'b', score: 0.2 },
      ]),
    );
    expect(fieldDefsFor(model, 'accuracy').find((f) => f.id === 'score:0')!.percent).toBe(true);
    // stored 0.6 is "60%": run A scores b above it
    expect(matching(model, { field: 'score:0', oper: 'gt', value: '0.6' })).toEqual(['b']);
    expect(fieldDefsFor(model, 'tokens').find((f) => f.id === 'score:1')!.percent).toBe(false);
  });

  it('every metadata key of any run is a field and any run matches', () => {
    const many = Array.from({ length: 45 }, (_, i) => i);
    const rowsA = many.map((i) => ({
      item_id: `i${i}`,
      item_metadata: {
        complexity: ['hard', 'easy', 'medium'][i % 3],
        domain: i === 0 ? "['finance', 'support']" : 'support',
        request_id: `req-${i}`,
        tokens: 100 + i,
        retry_count: 1,
        trace_stats: { spans: 3 },
      },
    }));
    // The second run tagged two items the first run did not.
    const rowsB = many.map((i) => ({
      item_id: `i${i}`,
      item_metadata: {
        complexity: ['hard', 'easy', 'medium'][i % 3],
        ...(i < 2 ? { tags: i === 0 ? ['billing', 'refunds'] : 'refunds' } : {}),
        tokens: i === 3 ? 900 : 100 + i,
      },
    }));
    const model = modelOf(run('A', rowsA), run('B', rowsB));
    const defs = new Map(fieldDefsFor(model, 'accuracy').map((d) => [d.id, d]));
    const metadata = [...defs.values()].filter((f) => f.group === 'Metadata');
    expect(metadata.map((f) => f.id).sort()).toEqual([
      'cat:complexity',
      'cat:domain',
      'cat:request_id',
      'cat:tags',
      'cat:tokens',
    ]);
    expect(defs.get('cat:complexity')!.choices!.map((c) => c.value)).toEqual(['easy', 'medium', 'hard']);
    expect(defs.get('cat:tags')!.choices!.map((c) => c.value)).toEqual(['billing', 'refunds']);
    expect(defs.get('cat:tokens')!.kind).toBe('number');
    expect(defs.get('cat:request_id')!.kind).toBe('text');
    // A value only one run carries still matches the item.
    expect(matching(model, { field: 'cat:tags', oper: 'in', value: ['refunds'] })).toEqual(['i0', 'i1']);
    expect(matching(model, { field: 'cat:domain', oper: 'in', value: ['finance'] })).toEqual(['i0']);
    // Numbers compare per run: run B's 900 lets i3 through.
    expect(matching(model, { field: 'cat:tokens', oper: 'gte', value: '143' })).toEqual(['i3', 'i43', 'i44']);
    expect(matching(model, { field: 'cat:request_id', oper: 'contains', value: 'req-4' })).toEqual([
      'i4',
      'i40',
      'i41',
      'i42',
      'i43',
      'i44',
    ]);
    // Fields follow the compared rows: drop the tagged items and the Tags field goes with them.
    const untagged = modelOf(run('A', rowsA), run('B', rowsB.slice(2)));
    expect(fieldDefsFor(untagged, 'accuracy').some((f) => f.id === 'cat:tags')).toBe(false);
  });

  it('Root cause offers the causes the compared runs applied and matches through any analysis of any run', () => {
    const issues = (...categories: string[]) => ({
      root_cause_issues: categories.map((category) => ({ category })),
    });
    const model = modelOf(
      run('A', [
        { item_id: 'a', item_metadata: { metric_analyses: { accuracy: issues('Retrieval') } } },
        { item_id: 'b', item_metadata: {} },
        { item_id: 'c', item_metadata: {} },
      ]),
      run('B', [
        { item_id: 'a', item_metadata: {} },
        {
          item_id: 'b',
          item_metadata: {
            metric_analyses: { accuracy: issues('Prompt'), tokens: issues('Brand voice drift') },
          },
        },
        { item_id: 'c', item_metadata: {} },
      ]),
    );
    const field = fieldDefsFor(model, 'accuracy').find((f) => f.id === 'cat:root_cause')!;
    expect(field.choices!.map((c) => c.value)).toEqual(['Brand voice drift', 'Prompt', 'Retrieval']);
    // An item whose cause only an analysis holds matches (Compare used to read item_metadata.root_cause only).
    expect(matching(model, { field: 'cat:root_cause', oper: 'in', value: ['Brand voice drift'] })).toEqual([
      'b',
    ]);
    expect(matching(model, { field: 'cat:root_cause', oper: 'in', value: ['Retrieval', 'Prompt'] })).toEqual([
      'a',
      'b',
    ]);
    // Runs without root causes have no Root cause field.
    const none = modelOf(run('A', [{ item_id: 'x', item_metadata: {} }]), run('B', []));
    expect(fieldDefsFor(none, 'accuracy').some((f) => f.id === 'cat:root_cause')).toBe(false);
  });

  it('rules and page filters round-trip the filters URL value, long error labels shortened', () => {
    const longError = 'x'.repeat(120);
    const rows = [{ item_id: 'a', item_metadata: { tags: ['billing'] }, status: 'error', error: longError }];
    const model = modelOf(run('A', rows), run('B', rows));
    const ctx = {
      metrics: model.metrics,
      metadataKeys: model.metadataKeys,
      runCount: 2,
      rows: model.runs.flatMap((r) => r.rows),
    };
    const f = emptyFilters();
    expect(encodeFiltersParam(f)).toBeNull();
    f.rules = {
      op: 'and',
      children: [
        { field: 'score:0', oper: 'gte', value: '0.7' },
        { field: '', oper: '', value: '' },
      ],
    };
    f.approval = 'not_approved';
    f.complexity = ['hard'];
    f.domain = ['finance'];
    f.domainMode = 'exclude';
    f.errors = {
      task: { kind: 'Task error', label: 'TimeoutError' },
      metric: { kind: 'Metric error', label: `accuracy: ${longError}` },
    };
    f.passRate = ['gte', 1];
    f.baseline = { metric: 'accuracy', columnKey: 'B', baselineKey: 'A', kind: 'regressed' };
    f.categories = { tags: ['billing'] };
    const raw = encodeFiltersParam(f)!;
    const saved = JSON.parse(raw);
    // A long error label goes in as its start plus a hash of the whole.
    expect(saved.errors.metric.label).toBeUndefined();
    expect(saved.errors.metric.prefix.length).toBe(40);
    expect(saved.categories).toEqual({ tags: ['billing'] });
    const back = decodeFiltersParam(raw, ctx);
    expect(back.approval).toBe('not_approved');
    expect(back.complexity).toEqual(['hard']);
    expect(back.domainMode).toBe('exclude');
    expect(back.errors.task).toEqual({ kind: 'Task error', label: 'TimeoutError' });
    expect(back.passRate).toEqual(['gte', 1]);
    expect(back.baseline?.kind).toBe('regressed');
    expect(back.categories).toEqual({ tags: ['billing'] });
    // Anything malformed is left off.
    const bad = decodeFiltersParam(
      JSON.stringify({
        rules: { op: 'xor', children: [] },
        approval: 'maybe',
        passRate: ['gte', 9],
        baseline: { metric: 'unknown', columnKey: 'a', baselineKey: 'b', kind: 'same' },
      }),
      ctx,
    );
    expect(bad.rules.children).toEqual([]);
    expect(bad.approval).toBeNull();
    expect(bad.passRate).toBeNull();
    expect(bad.baseline).toBeNull();
    expect(decodeFiltersParam('{not json', ctx)).toEqual(emptyFilters());
  });
});
