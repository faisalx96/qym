import { describe, expect, it } from 'vitest';
import { traceAverages, type ModelCandidate } from '@/api/dashboardModels';
import {
  buildStatGroups,
  clampK,
  defaultMetric,
  defaultPassThreshold,
  distributionSegments,
  formatStat,
  parseModelKey,
  rangeSince,
  rankModels,
  selectedRunIds,
  showsThreshold,
  statTiles,
} from '../modelsLogic';

const model = (key: string, ids: string[]): ModelCandidate => ({
  model_key: key,
  total_runs: ids.length,
  rows: ids.map((run_id, i) => ({ run_id, task_name: 't', timestamp: `2026-01-0${9 - i}` })),
});

describe('defaultPassThreshold', () => {
  it('uses the spec value, else 80% or 20% by direction', () => {
    expect(defaultPassThreshold({ pass_threshold: 0.65 }, 'maximize')).toBe(0.65);
    expect(defaultPassThreshold({}, 'maximize')).toBe(0.8);
    expect(defaultPassThreshold({}, 'minimize')).toBe(0.2);
    expect(defaultPassThreshold({ direction: 'minimize', schema_version: 2 })).toBe(0.2);
    expect(defaultPassThreshold(null, null)).toBe(0.8);
  });
});

describe('controls', () => {
  it('clamps K to 1..100 with default 5', () => {
    expect(clampK('0')).toBe(1);
    expect(clampK(250)).toBe(100);
    expect(clampK('abc')).toBe(5);
    expect(clampK(7.4)).toBe(7);
  });
  it('hides the threshold for boolean, numeric and undirected metrics', () => {
    expect(showsThreshold(false, false, 'maximize')).toBe(true);
    expect(showsThreshold(true, false, 'maximize')).toBe(false);
    expect(showsThreshold(false, true, 'maximize')).toBe(false);
    expect(showsThreshold(false, false, null)).toBe(false);
  });
  it('computes range bounds', () => {
    const now = new Date('2026-03-10T15:00:00Z');
    expect(rangeSince('all', now)).toBeUndefined();
    expect(rangeSince('7d', now)).toBe('2026-03-03T15:00:00.000Z');
    expect(new Date(rangeSince('today', now)!).getHours()).toBe(0);
  });
});

describe('selection and batching input', () => {
  it('takes the newest K without a selection and honours a valid custom one', () => {
    const m = model('a', ['r1', 'r2', 'r3', 'r4']);
    expect(selectedRunIds(m, undefined, 2)).toEqual(['r1', 'r2']);
    expect(selectedRunIds(m, ['r4', 'gone', 'r2'], 5)).toEqual(['r4', 'r2']);
    expect(selectedRunIds(m, ['r4', 'r2', 'r1'], 2)).toEqual(['r4', 'r2']);
  });
  it('builds one stat group per model', () => {
    const groups = buildStatGroups([model('a', ['r1', 'r2']), model('b', ['r3'])], { b: ['r3'] }, 1);
    expect(groups).toEqual([
      { key: 'a', runs: ['r1'] },
      { key: 'b', runs: ['r3'] },
    ]);
  });
});

describe('ranking and labels', () => {
  it('ranks by direction with missing averages last', () => {
    const items = [
      { key: 'b', avg: 0.5 },
      { key: 'c', avg: null },
      { key: 'a', avg: 0.9 },
    ];
    expect(rankModels(items, 'maximize').map((i) => i.key)).toEqual(['a', 'b', 'c']);
    expect(rankModels(items, 'minimize').map((i) => i.key)).toEqual(['b', 'a', 'c']);
  });
  it('parses variant keys and strips providers', () => {
    expect(parseModelKey('openai/gpt-4o|||reasoning')).toEqual({ label: 'gpt-4o', reasoning: true });
    expect(parseModelKey('claude|||plain')).toEqual({ label: 'claude', reasoning: false });
    expect(parseModelKey('plain-name')).toEqual({ label: 'plain-name', reasoning: false });
  });
  it('defaults to the newest primary metric', () => {
    const runs = [
      { run_id: 'a', task_name: 't', timestamp: '2026-01-01', metrics: ['x', 'y'] },
      {
        run_id: 'b',
        task_name: 't',
        timestamp: '2026-02-01',
        metrics: ['y', 'z'],
        metric_specs: { z: { primary: true } },
      },
    ];
    expect(defaultMetric(runs, ['x', 'y', 'z'])).toBe('z');
    expect(defaultMetric([], ['q'])).toBe('q');
  });
});

describe('tiles and distribution', () => {
  it('offers different tiles per metric kind', () => {
    expect(
      statTiles('score', 5, 'maximize', 80, false)
        .map((t) => t.key)
        .slice(0, 2),
    ).toEqual(['passAtK', 'passHatK']);
    expect(statTiles('numeric', 3, 'minimize', 20, false).some((t) => t.label === 'Min@3')).toBe(true);
    expect(statTiles('neutral', 3, null, 80, false).some((t) => t.key === 'passAtK')).toBe(false);
  });
  it('turns the histogram into non-empty segments', () => {
    const segs = distributionSegments([2, 0, 1, 7], 3, 10);
    expect(segs.map((s) => [s.runs, s.tone])).toEqual([
      [0, 'none'],
      [2, 'some'],
      [3, 'all'],
    ]);
    expect(segs[2]!.share).toBeCloseTo(0.7);
    expect(distributionSegments([], 0, 0)).toEqual([]);
  });
});

describe('trace tiles and precision', () => {
  it('adds the four trace tiles only when asked', () => {
    expect(statTiles('score', 5, 'maximize', 80, false).some((t) => t.key.startsWith('trace:'))).toBe(false);
    expect(
      statTiles('score', 5, 'maximize', 80, false, true)
        .filter((t) => t.key.startsWith('trace:'))
        .map((t) => t.key),
    ).toEqual(['trace:avg_tokens', 'trace:avg_llm_calls', 'trace:avg_tool_calls', 'trace:tool_success_rate']);
  });

  it('averages trace statistics over the runs that report them', () => {
    const run = (trace_stats: Record<string, number> | null) => ({ run_id: 'r', trace_stats }) as never;
    expect(traceAverages([run({ avg_tokens: 1000 }), run({ avg_tokens: 2000 }), run(null)])).toEqual({
      avg_tokens: 1500,
    });
  });

  it('formats trace values and keeps one decimal on percentages', () => {
    const stats = {
      traceAverages: { avg_tokens: 1500, avg_llm_calls: 2, tool_success_rate: 0.875 },
    } as never;
    expect(formatStat('trace:avg_tokens', stats, 'score')).toBe('1.5K');
    expect(formatStat('trace:avg_llm_calls', stats, 'score')).toBe('2.0');
    expect(formatStat('trace:tool_success_rate', stats, 'score')).toBe('87.5%');
    expect(formatStat('trace:avg_tool_calls', stats, 'score')).toBe('—');
    expect(formatStat('avgScore', { avgScore: 0.6364 } as never, 'score')).toBe('63.6%');
  });
});
