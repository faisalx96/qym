/**
 * Cutover of tests/platform/test_run_filter_fields_javascript.py (the vanilla run page Filters fields,
 * executed with Node): score rules are percentages, every metadata key is a field with list values
 * broken into entries, and Root cause offers only the causes this run's analyses applied.
 */
import { describe, expect, it } from 'vitest';
import { buildRunModel } from '../runModel';
import {
  buildFieldDefs,
  decodeFiltersParam,
  effectiveThresholds,
  emptyView,
  evalFilterNode,
  type FieldDef,
  type FilterContext,
  type FilterNode,
} from '../filterRules';
import type { Row, RunPayload } from '../../types';

function contextOf(rows: Row[], metricNames: string[], specs: Record<string, Record<string, unknown>>): { ctx: FilterContext; defs: Map<string, FieldDef> } {
  const payload = {
    run: { run_id: 'r', status: 'COMPLETED', samples: 1, metric_names: metricNames, metric_specs: specs },
    snapshot: { rows, metric_names: metricNames, metric_specs: specs },
  } as unknown as RunPayload;
  const model = buildRunModel(payload, null);
  const ctx: FilterContext = {
    model,
    thresholds: effectiveThresholds(model, emptyView()),
    selectedMetric: model.defaultMetric,
    repeatAggregate: false,
  };
  return { ctx, defs: new Map(buildFieldDefs(ctx).map((d) => [d.id, d])) };
}

const matching = (rows: Row[], defs: Map<string, FieldDef>, rule: FilterNode) =>
  rows.filter((row) => evalFilterNode({ op: 'and', children: [rule] }, row, defs)).map((r) => r.item_id);

describe('run page Filters fields', () => {
  it('a score rule is written as a percentage; a count keeps its own units', () => {
    const rows = [
      { item_id: 'a', metric_values: ['0.55', '12'] },
      { item_id: 'b', metric_values: ['0.75', '40'] },
    ] as unknown as Row[];
    const { defs } = contextOf(rows, ['accuracy', 'tokens'], {
      accuracy: { score_type: 'percentage', direction: 'maximize', schema_version: 2 },
      tokens: { score_type: 'number', schema_version: 2 },
    });
    expect(defs.get('metric:accuracy')!.percent).toBe(true);
    expect(defs.get('metric:tokens')!.percent).toBe(false);
    // stored 0.6 means "60%": only 0.75 is above it
    expect(matching(rows, defs, { field: 'metric:accuracy', oper: 'gt', value: '0.6' })).toEqual(['b']);
  });

  it('every metadata key is a field and lists break into entries', () => {
    const many = Array.from({ length: 45 }, (_, i) => i);
    const rows = many.map(
      (i) =>
        ({
          item_id: `i${i}`,
          metric_values: [],
          item_metadata: {
            tags: i === 0 ? ['billing', 'refunds'] : i === 1 ? ['refunds'] : 'billing',
            // A list key may arrive as text, as Performance by category reads it.
            domain: i === 0 ? "['finance', 'support']" : 'support',
            complexity: ['hard', 'easy', 'medium'][i % 3],
            request_id: `req-${i}`,
            tokens: 100 + i,
            retry_count: 1,
            trace_stats: { spans: 3 },
            task_started_at_ms: 1700000000000 + i,
          },
        }) as unknown as Row,
    );
    const { defs } = contextOf(rows, [], {});
    const metadata = [...defs.values()].filter((f) => f.group === 'Metadata');
    expect(metadata.map((f) => f.id).sort()).toEqual(['cat:complexity', 'cat:domain', 'cat:request_id', 'cat:tags', 'cat:tokens']);
    const field = (id: string) => defs.get(id)!;
    expect(field('cat:tags').kind).toBe('enum');
    expect(field('cat:tags').values).toEqual(['billing', 'refunds']);
    expect(field('cat:domain').values).toEqual(['finance', 'support']);
    expect(matching(rows, defs, { field: 'cat:domain', oper: 'in', value: ['finance'] })).toEqual(['i0']);
    expect(field('cat:complexity').values).toEqual(['easy', 'medium', 'hard']);
    // Too many values for chips: numbers compare, other text matches.
    expect(field('cat:tokens').kind).toBe('number');
    expect(field('cat:request_id').kind).toBe('text');
    expect(matching(rows, defs, { field: 'cat:tags', oper: 'in', value: ['refunds'] })).toEqual(['i0', 'i1']);
    expect(matching(rows, defs, { field: 'cat:tags', oper: 'notin', value: ['billing'] }).join()).toBe('i1');
    expect(matching(rows, defs, { field: 'cat:tokens', oper: 'gte', value: '143' })).toEqual(['i43', 'i44']);
    expect(matching(rows, defs, { field: 'cat:request_id', oper: 'contains', value: 'req-4' })).toEqual([
      'i4',
      'i40',
      'i41',
      'i42',
      'i43',
      'i44',
    ]);
  });

  it('Root cause offers only the causes this run applied, custom ones included', () => {
    const issues = (...categories: string[]) => ({ root_cause_issues: categories.map((category) => ({ category })) });
    const rows = [
      { item_id: 'a', metric_values: [], item_metadata: { metric_analyses: { accuracy: issues('Retrieval') } } },
      { item_id: 'b', metric_values: [], item_metadata: { metric_analyses: { accuracy: issues('Prompt'), tone: issues('Brand voice drift') } } },
      { item_id: 'c', metric_values: [], item_metadata: {} },
    ] as unknown as Row[];
    const { defs } = contextOf(rows, ['accuracy', 'tone'], {});
    // Catalog categories no item carries ("Tooling") are not offered.
    expect(defs.get('cat:root_cause')!.values).toEqual(['Brand voice drift', 'Prompt', 'Retrieval']);
    // An item matches through any metric's analysis, custom causes included.
    expect(matching(rows, defs, { field: 'cat:root_cause', oper: 'in', value: ['Brand voice drift'] })).toEqual(['b']);
    expect(matching(rows, defs, { field: 'cat:root_cause', oper: 'in', value: ['retrieval', 'prompt'] })).toEqual(['a', 'b']);
    // A run without root causes has no Root cause field.
    const empty = contextOf([{ item_id: 'x', metric_values: [], item_metadata: {} }] as unknown as Row[], ['accuracy', 'tone'], {});
    expect(empty.defs.get('cat:root_cause')).toBeUndefined();
  });
});

describe('a category filter in the URL (test_run_page_nav_browser.py)', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    item_id: `item-${i}`,
    metric_values: [],
    item_metadata: { lang: ['en', 'ar'][i % 2], tier: ['gold', 'silver', 'bronze'][i % 3] },
  })) as unknown as Row[];
  const decodeCtx = { metricNames: [], metadataKeys: ['lang', 'tier'], rows, repeatAggregate: false };

  it('keeps a category of this run and ignores one the run does not have', () => {
    const known = decodeFiltersParam(JSON.stringify({ categories: { tier: ['gold'] } }), decodeCtx);
    expect(known.categories).toEqual({ tier: ['gold'] });
    for (const foreign of [{ nosuch: ['x'] }, { __proto__: ['x'] }, JSON.parse('{"__proto__":["x"]}')]) {
      const out = decodeFiltersParam(JSON.stringify({ categories: foreign }), decodeCtx);
      expect(Object.keys(out.categories ?? {})).toEqual([]);
    }
  });
});
