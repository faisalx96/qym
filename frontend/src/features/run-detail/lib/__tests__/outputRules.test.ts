import { describe, expect, it } from 'vitest';
import {
  buildFieldDefs,
  effectiveThresholds,
  emptyView,
  evalFilterNode,
  type FilterGroup,
} from '../filterRules';
import { buildRunModel } from '../runModel';
import type { Row, RunPayload } from '../../types';

/** 260 items whose output text embeds `needle-<i>` (the old full-versus-compact fixture). */
const rows = Array.from({ length: 260 }, (_, i) => ({
  index: i,
  item_id: `item-${i}`,
  status: 'completed',
  metric_values: [i % 2, i],
  output_full: `Answer ${i}\nneedle-${i} ${'a'.repeat(40)}`,
})) as Row[];
const specs = {
  accuracy: { score_type: 'boolean', direction: 'maximize', schema_version: 2 },
  count: { score_type: 'number', direction: 'maximize', schema_version: 2 },
};
const payload: RunPayload = {
  run: {
    run_id: 'run-1',
    status: 'COMPLETED',
    metric_names: ['accuracy', 'count'],
    metric_specs: specs,
    samples: 1,
  },
  snapshot: { rows, metric_names: ['accuracy', 'count'], metric_specs: specs },
};
const model = buildRunModel(payload, null);
const view = emptyView();
const defs = new Map(
  buildFieldDefs({
    model,
    thresholds: effectiveThresholds(model, view),
    selectedMetric: 'accuracy',
    repeatAggregate: false,
  }).map((d) => [d.id, d]),
);

describe('mixed OR / AND rules over output text', () => {
  it('"contains needle-259" OR ("not contains needle-1" AND "contains needle-25") keeps the 11 expected items', () => {
    const rules: FilterGroup = {
      op: 'or',
      children: [
        { field: 'output', oper: 'contains', value: 'needle-259' },
        {
          op: 'and',
          children: [
            { field: 'output', oper: 'notcontains', value: 'needle-1' },
            { field: 'output', oper: 'contains', value: 'needle-25' },
          ],
        },
      ],
    };
    const kept = rows.filter((r) => evalFilterNode(rules, r, defs));
    expect(kept).toHaveLength(11);
    expect(kept.map((r) => r.item_id)).toEqual([
      'item-25',
      ...Array.from({ length: 10 }, (_, i) => `item-${250 + i}`),
    ]);
  });

  it('a matcher supplied by the server search replaces the local text test for the output field', () => {
    const remote = new Set(['item-259']);
    const rules: FilterGroup = {
      op: 'and',
      children: [{ field: 'output', oper: 'contains', value: 'needle-259' }],
    };
    const kept = rows.filter((r) => evalFilterNode(rules, r, defs, (_value, row) => remote.has(row.item_id)));
    expect(kept.map((r) => r.item_id)).toEqual(['item-259']);
  });
});
