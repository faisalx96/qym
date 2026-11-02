import { describe, expect, it } from 'vitest';
import {
  buildGroups,
  compareSortValues,
  computeGroupAgg,
  effectiveGroupMode,
  groupMetricName,
  groupStatRule,
  isGroupMetricBoolean,
  modelLabel,
  prefersBar,
  sortRuns,
  versionGroupOf,
  type ChartRun,
} from '../chartModel';

const spec = { direction: 'maximize', score_type: 'percentage', schema_version: 2 };
function run(id: string, model: string, acc: number, ts: string, commit = 'abc', lat = 100): ChartRun {
  return {
    run_id: id,
    run_name: id,
    model,
    timestamp: ts,
    metric_averages: { accuracy: acc, cost: 3 },
    metric_specs: { accuracy: spec, cost: { direction: undefined } },
    metrics: ['accuracy', 'cost'],
    trace_stats: null,
    latency: lat,
    median_latency: lat,
    git_branch: commit ? 'main' : '',
    git_commit: commit,
    samples: 1,
    status: 'COMPLETED',
  };
}
const runs = [
  run('a', 'openai/gpt-4o|||plain', 0.9, '2026-10-01', 'abc', 100),
  run('b', 'claude|||plain', 0.7, '2026-10-02', 'abc', 300),
  run('c', 'claude|||reasoning', 0.8, '2026-10-03', 'def', 200),
  run('d', 'openai/gpt-4o|||plain', 0.6, '2026-10-04', '', 50),
];

describe('chart model', () => {
  it('sorts runs with missing values last and model ties by newest', () => {
    expect(sortRuns(runs, 'accuracy', 'desc').map((r) => r.run_id)).toEqual(['a', 'c', 'b', 'd']);
    expect(sortRuns(runs, 'model', 'asc').map((r) => r.run_id)).toEqual(['c', 'b', 'd', 'a']);
    expect(compareSortValues(null, 1, 'desc')).toBe(1);
    expect(compareSortValues('b', 'a', 'desc')).toBe(-1);
  });
  it('aggregates groups and picks group mode', () => {
    const agg = computeGroupAgg(runs, ['accuracy', 'cost'], []);
    expect(agg.metricAverages.accuracy).toBeCloseTo(0.75);
    expect(agg.avgLatency).toBeCloseTo(162.5);
    expect(agg.medianLatency).toBe(150);
    expect(effectiveGroupMode('version', false)).toBe('run');
    expect(effectiveGroupMode('model', false)).toBe('model');
    expect(versionGroupOf(run('x', 'm', 1, '', ''))).toEqual({ key: '__no_version__', label: 'No version' });
    expect(modelLabel('claude|||reasoning')).toBe('claude (reasoning)');
    expect(modelLabel('openai/gpt-4o|||plain')).toBe('gpt-4o');
  });
  it('builds nested groups sorted by the card sort', () => {
    const groups = buildGroups(
      runs,
      'version-model',
      ['accuracy'],
      [],
      'card',
      { key: 'accuracy', dir: 'desc' },
      () => null,
    );
    expect(groups.map((g) => g.label)).toEqual(['main/abc', 'main/def', 'No version']);
    expect(groups[0]!.children!.map((c) => c.label)).toEqual(['gpt-4o', 'claude']);
    const byModel = buildGroups(
      runs,
      'model',
      ['accuracy'],
      [],
      'card',
      { key: 'model', dir: 'asc' },
      () => null,
    );
    expect(byModel.map((g) => g.label)).toEqual(['claude', 'claude (reasoning)', 'gpt-4o']);
    expect(byModel[2]!.runs.map((r) => r.run_id)).toEqual(['d', 'a']);
  });
  it('derives the group statistics rule', () => {
    expect(groupMetricName(runs, ['cost', 'accuracy'], { cost: 'numeric', accuracy: 'score' })).toBe(
      'accuracy',
    );
    expect(isGroupMetricBoolean(runs, 'accuracy')).toBe(false);
    expect(groupStatRule(runs, 'accuracy')).toEqual({
      metric: 'accuracy',
      threshold: 0.8,
      is_boolean: false,
      direction: 'maximize',
    });
    expect(groupStatRule(runs, 'cost')).toBeNull();
    const bool = [run('x', 'm', 1, '2026-01-01'), run('y', 'm', 0, '2026-01-02')];
    expect(groupStatRule(bool, 'accuracy')?.threshold).toBe(0.9999);
  });
  it('decides bar vs number per metric type', () => {
    expect(prefersBar('accuracy', 'score')).toBe(true);
    expect(prefersBar('cost', 'numeric')).toBe(false);
    expect(prefersBar('p95_latency_ms', 'numeric')).toBe(true);
    expect(prefersBar('total_tokens', 'numeric')).toBe(true);
  });
});
