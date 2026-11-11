/** C009: a repeat run's trace drawer opens on one pass: the first that fails the page metric, else pass 1. */
import { describe, expect, it } from 'vitest';
import { effectiveThresholds, emptyView, type FilterContext } from '../lib/filterRules';
import { buildRunModel } from '../lib/runModel';
import type { Row, RunPayload } from '../types';
import { defaultTracePass } from './TraceHost';

const specs = {
  accuracy: { score_type: 'percentage', direction: 'maximize', pass_threshold: 0.8, schema_version: 2 },
};

function ctxFor(passScores: number[]): FilterContext {
  const row = {
    index: 0,
    item_id: 'item-1',
    status: 'completed',
    metric_values: [passScores.reduce((a, b) => a + b, 0) / passScores.length],
    metric_meta: {},
    pass_scores: { accuracy: passScores },
  } as unknown as Row;
  const payload = {
    run: {
      run_id: 'r',
      status: 'COMPLETED',
      samples: passScores.length,
      metric_names: ['accuracy'],
      metric_specs: specs,
    },
    snapshot: { rows: [row], metric_names: ['accuracy'], metric_specs: specs },
  } as unknown as RunPayload;
  const model = buildRunModel(payload, null);
  return {
    model,
    thresholds: effectiveThresholds(model, emptyView()),
    selectedMetric: 'accuracy',
    repeatAggregate: true,
  };
}

describe('defaultTracePass', () => {
  it('opens on the first pass that fails the page metric', () => {
    const ctx = ctxFor([0.9, 0.5, 0.95, 0.2]);
    expect(defaultTracePass(ctx.model, ctx, 'accuracy', 'item-1')).toBe(2);
  });

  it('opens on pass 1 when every pass passes, the item is unknown or no metric is picked', () => {
    const ctx = ctxFor([0.9, 0.85, 0.95]);
    expect(defaultTracePass(ctx.model, ctx, 'accuracy', 'item-1')).toBe(1);
    expect(defaultTracePass(ctx.model, ctx, 'accuracy', 'nope')).toBe(1);
    expect(defaultTracePass(ctx.model, ctx, null, 'item-1')).toBe(1);
  });
});
