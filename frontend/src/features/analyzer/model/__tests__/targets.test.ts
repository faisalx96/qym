import { describe, expect, it } from 'vitest';
import { buildAnalyzerRows, humanOverwriteTargets, isMetricErrorMeta, matchTargets } from '../targets';
import type { CompactRow } from '@/api/analysis';

const specs = {
  acc: { direction: 'maximize', pass_threshold: 0.8, schema_version: 2, score_type: 'percentage' },
  lat: { direction: 'minimize', pass_threshold: 2, schema_version: 2, score_type: 'number' },
};

function rows(extra: Partial<CompactRow>[]): CompactRow[] {
  return extra.map((e, i) => ({
    index: i,
    item_id: `item-${i + 1}`,
    metric_values: [1, 1],
    metric_meta: {},
    item_metadata: {},
    ...e,
  }));
}

const opts = {
  selectedMetrics: ['acc', 'lat'],
  maxScore: 0.8,
  skipAnalyzed: true,
  allowHumanOverwrite: false,
};

describe('matchTargets', () => {
  it('keeps only failed metrics per threshold and direction', () => {
    const built = buildAnalyzerRows({
      rows: rows([{ metric_values: [0.5, 1] }, { metric_values: [1, 3] }, { metric_values: [1, 1] }]),
      metricNames: ['acc', 'lat'],
      metricSpecs: specs,
      passNumber: null,
    });
    const matched = matchTargets(built, opts);
    expect(matched.map((m) => [m.row.item_id, m.metrics])).toEqual([
      ['item-1', ['acc']],
      ['item-2', ['lat']],
    ]);
  });

  it('skips task errors and metric execution errors', () => {
    const built = buildAnalyzerRows({
      rows: rows([
        { metric_values: [0, 1], error: 'boom' },
        { metric_values: [0, 1], metric_meta: { acc: { status: 'timeout' } } },
      ]),
      metricNames: ['acc', 'lat'],
      metricSpecs: specs,
      passNumber: null,
    });
    expect(matchTargets(built, opts)).toEqual([]);
    expect(isMetricErrorMeta({ status: 'Error' })).toBe(true);
    expect(isMetricErrorMeta({ status: 'ok' })).toBe(false);
  });

  it('applies skip-analyzed and the human overwrite rules', () => {
    const analyzed = {
      metric_analyses: { acc: { root_cause: 'X', source: 'ai' } },
    };
    const human = { metric_analyses: { acc: { root_cause: 'Y', source: 'human' } } };
    const built = buildAnalyzerRows({
      rows: rows([
        { metric_values: [0, 1], item_metadata: analyzed },
        { metric_values: [0, 1], item_metadata: human },
        { metric_values: [0, 1] },
      ]),
      metricNames: ['acc', 'lat'],
      metricSpecs: specs,
      passNumber: null,
    });
    expect(matchTargets(built, opts).map((m) => m.row.item_id)).toEqual(['item-3']);
    const withHuman = matchTargets(built, { ...opts, allowHumanOverwrite: true });
    expect(withHuman.map((m) => m.row.item_id)).toEqual(['item-2', 'item-3']);
    expect(humanOverwriteTargets(withHuman)).toEqual([{ item_id: 'item-2', metric_name: 'acc' }]);
    expect(matchTargets(built, { ...opts, skipAnalyzed: false }).map((m) => m.row.item_id)).toEqual([
      'item-1',
      'item-3',
    ]);
  });

  it('max score caps only maximize metrics', () => {
    const built = buildAnalyzerRows({
      rows: rows([{ metric_values: [0.7, 5] }, { metric_values: [0.2, 1] }]),
      metricNames: ['acc', 'lat'],
      metricSpecs: specs,
      passNumber: null,
    });
    // item-1 acc 0.7 > 0.5 cap but lat is minimize, so it stays; item-2 acc 0.2 <= cap
    const m = matchTargets(built, { ...opts, maxScore: 0.5 });
    expect(m.map((x) => x.row.item_id)).toEqual(['item-1', 'item-2']);
    const only = matchTargets(built, { ...opts, selectedMetrics: ['acc'], maxScore: 0.5 });
    expect(only.map((x) => x.row.item_id)).toEqual(['item-2']);
  });

  it('reads per-pass scores for repeat runs', () => {
    const built = buildAnalyzerRows({
      rows: rows([
        { pass_scores: { acc: [1, 0.1], lat: [1, 1] }, pass_attempts: [{ pass_number: 2, output: 'p2' }] },
      ]),
      metricNames: ['acc', 'lat'],
      metricSpecs: specs,
      passNumber: 2,
    });
    expect(built[0]!.output).toBe('p2');
    expect(matchTargets(built, opts)[0]!.metrics).toEqual(['acc']);
    const pass1 = buildAnalyzerRows({
      rows: rows([{ pass_scores: { acc: [1, 0.1], lat: [1, 1] } }]),
      metricNames: ['acc', 'lat'],
      metricSpecs: specs,
      passNumber: 1,
    });
    expect(matchTargets(pass1, opts)).toEqual([]);
  });
});
